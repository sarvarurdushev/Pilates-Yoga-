"""The Fitness Passport: what a customer's history says, read from the records that
already hold it. Phase 3 writes correct records; Phase 4 polishes the Passport page.

There is one historical truth per fact:

* a visit and its completed exercises: ``p_training_sessions`` and
  ``p_session_exercise_events`` (shared with the coaching workspace);
* readiness, scan summaries, plans, workouts and session feedback: the SEDENS
  tables of each (``s_readiness_checks``, ``s_room_scans``, ``s_recommendations``,
  ``s_workouts``, ``s_session_feedback``), each linked to the room visit and, for a
  workout, to its ``p_training_sessions`` row;
* course progress: ``s_course_progress`` of the enrollment.

This module only reads them.
"""

from __future__ import annotations

from . import access, marketplace
from .util import decode


def summary(db, student_id) -> dict:
    """A short summary for the shared room screen: counts and the last visit date only."""
    visits = db.execute("SELECT count(*), max(performed_at) FROM p_training_sessions WHERE student_id=?",
                        (student_id,)).fetchone()
    room = db.execute("SELECT count(*) FROM s_workouts WHERE student_id=? AND state='completed'",
                      (student_id,)).fetchone()[0] if _has(db, "s_workouts") else 0
    return {"visits": visits[0], "last_visit": visits[1], "room_sessions_completed": room}


def _has(db, table) -> bool:
    return db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone() is not None


def next_session(db, course, enrollment) -> dict | None:
    """The first session of the customer's own (enrolled) version not yet done."""
    number = access.effective_version(db, course, enrollment)
    if not number:
        return None
    snapshot = decode(db.execute("SELECT snapshot FROM s_course_versions WHERE course_id=? AND version=?",
                                 (course["id"], number)).fetchone()[0], {})
    done = {r[0] for r in db.execute("SELECT item_id FROM s_course_progress WHERE enrollment_id=? AND item_kind='session'",
                                     (enrollment["id"],))}
    total = 0
    found = None
    for m_index, module in enumerate(snapshot.get("modules", [])):
        for s_index, session in enumerate(module.get("sessions", [])):
            total += 1
            if found is None and session["id"] not in done:
                found = {"module_title": module["title"], "module_number": m_index + 1,
                         "session_title": session["title"], "session_number": s_index + 1,
                         "session_id": session["id"], "estimated_minutes": session.get("estimated_minutes") or 0}
    return {"version": number, "next": found, "done": len(done), "total": total,
            "title": snapshot.get("course", {}).get("title") or course["title"]}


def active_courses(sedens, db, ctx) -> list[dict]:
    """Guided courses this customer can play in this room, with the next session of
    the version they are enrolled in (never silently a newer one)."""
    out = []
    for item in marketplace.room_courses(sedens, db, ctx):
        if not item["playable"]:
            continue
        course = db.execute("SELECT * FROM s_courses WHERE id=?", (item["id"],)).fetchone()
        enrollment = access.enrollment(db, ctx.student_id, item["id"])
        if enrollment is None:
            out.append({"course_id": item["id"], "title": item["title"], "enrolled": False, "featured": item["featured"],
                        "reason": item["reason"], "progress": None})
            continue
        progress = next_session(db, course, enrollment)
        out.append({"course_id": item["id"], "title": progress["title"] if progress else item["title"],
                    "enrolled": True, "featured": item["featured"], "reason": item["reason"],
                    "progress": progress})
    # A course the customer is already following comes first.
    return sorted(out, key=lambda c: (not c["enrolled"], not c["featured"], c["title"]))
