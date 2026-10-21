"""Guided workouts in the room: a SEDENS Standard plan or one session of a guided course.

* A course session plays from the **exact version the customer is enrolled in**
  (``access.effective_version``), frozen into the workout when it starts; the
  scan never changes it. Easier and harder options appear only where the creator
  authored them (or, for SEDENS Standard, where the audited library links them).
* Every step is finished once: completing or skipping a step that is already
  finished changes nothing, so a refresh, a retry or a double tap never writes a
  second completion. A refresh restores the current step and its paused position.
* The customer can always stop ("I don't feel well"). A safety stop ends the
  workout as incomplete and never continues by itself.
* The Passport is written as the workout runs: each completed step becomes a
  ``p_session_exercise_events`` row of the visit's ``p_training_sessions`` row
  (shared with the coaching workspace); course progress is written at completion.
* No camera runs during a workout, and nothing here judges how an exercise was done.
"""

from __future__ import annotations

from functools import lru_cache
import json
from pathlib import Path
import re

from . import access, analytics, courses, journey, marketplace, plans, readiness, standard, video_providers
from .util import Denied, decode, encode, now, uid

DATA = Path(__file__).resolve().parents[2] / "data"
FEEDBACK_VERSION = "sedens-session-feedback-1.0.0"
FEEDBACK_FILES = {"sedens-session-feedback-1.0.0": "sedens_session_feedback.v1.json"}
OPEN = ("ready", "active", "paused")
SAFETY = ("pain", "dizzy", "unwell", "other")
MAX_NOTE = 280
ANATOMY_LABEL = {"en": "Educational anatomy — not measured muscle activation.",
                 "ko": "교육용 해부학 — 측정된 근육 활성도가 아닙니다."}
ROOM_RECORDER = "SEDENS AI Private Room"


@lru_cache(maxsize=None)
def feedback_copy(version: str = FEEDBACK_VERSION) -> dict:
    data = json.loads((DATA / FEEDBACK_FILES[version]).read_text(encoding="utf-8"))
    assert data["version"] == version
    return data


def _t(value, locale):
    return (value.get(locale) or value.get("en")) if isinstance(value, dict) else value


def _event(db, ctx, name, **props):
    analytics.record(db, name, org_id=ctx.org_id, user_id=ctx.student_id, room_id=ctx.room_id,
                     device_id=ctx.device_id, room_session_id=ctx.room_session_id, demo=ctx.demo, props=props)


def _seconds_between(start, end) -> int:
    from datetime import datetime

    if not start or not end:
        return 0
    return max(0, int((datetime.fromisoformat(end) - datetime.fromisoformat(start)).total_seconds()))


def current(db, ctx) -> dict | None:
    """This visit's latest workout that was not replaced before it started."""
    row = db.execute("SELECT * FROM s_workouts WHERE room_session_id=? AND end_reason<>'replaced' "
                     "ORDER BY created_at DESC, rowid DESC LIMIT 1", (ctx.room_session_id,)).fetchone()
    return dict(row) if row else None


def _steps(db, workout_id) -> list[dict]:
    return [dict(r) for r in db.execute("SELECT * FROM s_workout_steps WHERE workout_id=? ORDER BY position",
                                        (workout_id,))]


# -- creating a workout -----------------------------------------------------------------


def _insert(db, ctx, *, kind, plan, planned, recommendation_id=None, course=None, steps):
    # A workout prepared earlier in this visit but never started is replaced.
    db.execute("UPDATE s_workouts SET state='abandoned', end_reason='replaced', ended_at=? WHERE room_session_id=? "
               "AND state='ready'", (now(), ctx.room_session_id))
    workout_id = uid()
    course = course or {}
    db.execute("INSERT INTO s_workouts(id,room_session_id,org_id,student_id,kind,recommendation_id,course_id,"
               "course_version,course_session_id,enrollment_id,state,planned_seconds,plan,created_at) "
               "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
               (workout_id, ctx.room_session_id, ctx.org_id, ctx.student_id, kind, recommendation_id,
                course.get("course_id"), course.get("version"), course.get("session_id"), course.get("enrollment_id"),
                "ready", planned, encode(plan), now()))
    for s in steps:
        db.execute("INSERT INTO s_workout_steps(workout_id,position,step_ref,phase,exercise_ref,planned_seconds) "
                   "VALUES (?,?,?,?,?,?)", (workout_id, s["position"], s["ref"], s["phase"], s["exercise_ref"],
                                            s["seconds"]))
    return workout_id


def create_standard(sedens, db, ctx, rec) -> str:
    plan = decode(rec["plan"], {})
    r = plans.rules(rec["rules_version"])
    inputs = decode(rec["inputs"], {})
    steps = []
    for i, s in enumerate(plan.get("steps", [])):
        entry = standard.get(s["exercise_id"])
        if entry is None:
            raise Denied("This plan's exercises are no longer available. Ask for a new plan.", 409, "plan_unavailable")
        steps.append({"position": i, "ref": entry["id"], "phase": s["phase"], "sets": s["sets"],
                      "seconds": s["seconds"], "exercise_ref": entry["catalog_key"]})
    frozen = {"kind": "standard", "library_version": rec["library_version"], "rules_version": rec["rules_version"],
              "goal": rec["goal"], "intensity": rec["intensity"], "duration_minutes": rec["duration_minutes"],
              "rest_between_sets": plan.get("rest_between_sets") or r["intensities"][rec["intensity"]]["rest_between_sets"],
              "no_harder": bool(inputs.get("discomfort_hold")), "steps": steps}
    return _insert(db, ctx, kind="standard", plan=frozen, planned=rec["estimated_seconds"],
                   recommendation_id=rec["id"], steps=steps)


def _course_step_seconds(step, timing, previous_phase) -> int:
    # One formula for the room plan and the creator's narration cue bound.
    return courses.step_seconds(step)


def _next_course_session(db, course, enrollment, snapshot) -> str | None:
    if enrollment is None:
        first = next((s for m in snapshot.get("modules", []) for s in m.get("sessions", [])), None)
        return first["id"] if first else None
    from . import passport

    found = passport.next_session(db, course, enrollment)
    return found["next"]["session_id"] if found and found["next"] else None


def course_plan(sedens, db, ctx, course, session_id) -> dict:
    """The frozen plan and step rows of one session of a guided course, from the version the
    customer is enrolled in (enrolling them on first play). ``ctx`` needs ``org_id``,
    ``location_id`` and ``student_id``. Shared by the room and by the demonstration persona's
    seeded history, so a seeded course workout is exactly what the room would have written."""
    played = marketplace.room_session_plan(sedens, db, ctx, course["id"], session_id)  # enrolls on first play
    enrolled = access.enrollment(db, ctx.student_id, course["id"])
    session = played["session"]
    module = next((m for m in decode(db.execute("SELECT snapshot FROM s_course_versions WHERE course_id=? AND version=?",
                                                (course["id"], played["version"])).fetchone()[0], {}).get("modules", [])
                   if any(s["id"] == session_id for s in m.get("sessions", []))), {})
    timing = plans.rules()["timing"]
    variants: dict = {}
    for s in session.get("steps", []):
        if s.get("variant_of") and s.get("variant") in ("easier", "harder"):
            variants.setdefault(s["variant_of"], {})[s["variant"]] = s
    main = [s for s in session.get("steps", []) if not s.get("variant_of")]
    steps, frozen_steps = [], []
    for i, s in enumerate(main):
        seconds = _course_step_seconds(s, timing, None)
        key = (s.get("exercise") or {}).get("catalog_key") or (s.get("exercise") or {}).get("ref") or ""
        steps.append({"position": i, "ref": s["id"], "phase": s.get("phase") or "main", "seconds": seconds,
                      "exercise_ref": key})
        frozen_steps.append({**s, "library": _library_text(s), "planned_seconds": seconds,
                             "variants": {k: {**v, "library": _library_text(v)} for k, v in variants.get(s["id"], {}).items()}})
    snapshot = marketplace._snapshot(db, course["id"], played["version"])
    frozen = {"kind": "course", "course_id": course["id"], "version": played["version"], "session_id": session_id,
              "course_title": snapshot.get("course", {}).get("title") or course["title"],
              "module_title": module.get("title", ""), "session_title": session.get("title", ""),
              "steps": frozen_steps}
    return {"frozen": frozen, "steps": steps, "planned": sum(s["seconds"] for s in steps),
            "course": {"course_id": course["id"], "version": played["version"], "session_id": session_id,
                       "enrollment_id": enrolled["id"] if enrolled else None}}


def choose_course(sedens, db, ctx, journey_row, data):
    """session_choice → ready_to_train with one session of a guided course the
    customer may play here, from the version they are enrolled in."""
    journey.require_ready(db, ctx)
    journey.require(journey_row, "session_choice")
    course = courses.row(db, data.get("course_id"))
    decision = access.can_play_in_room(sedens, db, ctx, course)
    if not decision["ok"]:
        raise Denied({"purchase_required": "Buy this course on your phone to play it here.",
                      "not_enabled_here": "This course is not offered in this room."}
                     .get(decision["reason"], "This course cannot be played here."), 403, decision["reason"])
    enrolled = access.enrollment(db, ctx.student_id, course["id"])
    number = access.effective_version(db, course, enrolled)
    snapshot = marketplace._snapshot(db, course["id"], number)
    session_id = data.get("session_id") or _next_course_session(db, course, enrolled, snapshot)
    if not session_id:
        raise Denied("You have finished every session of this course. Choose a session to repeat.", 409,
                     "course_finished")
    plan = course_plan(sedens, db, ctx, course, session_id)  # enrolls on first play
    _insert(db, ctx, kind="course", plan=plan["frozen"], planned=plan["planned"], course=plan["course"],
            steps=plan["steps"])
    _event(db, ctx, "session_choice", choice="course", version=plan["course"]["version"])
    return journey.move(db, journey_row, "ready_to_train", expect=data.get("expect"), path="course")


# -- the Passport ------------------------------------------------------------------------


def _training_session(db, ctx, journey_row) -> str:
    """The visit's p_training_sessions row: the one a real scan created, or a new one."""
    found = journey_row.get("training_session_id")
    if found:
        row = db.execute("SELECT student_id FROM p_training_sessions WHERE id=?", (found,)).fetchone()
        if row is not None and row[0] == ctx.student_id:
            return found
    session_id = uid()
    db.execute("INSERT INTO p_training_sessions VALUES (?,?,?,?,?,?,?,?)",
               (session_id, ctx.student_id, None, None, None, now(), "[]", ""))
    db.execute("INSERT INTO p_session_recorders(session_id,user_id,name,role,recorded_at) VALUES (?,?,?,?,?) "
               "ON CONFLICT(session_id) DO NOTHING", (session_id, None, ROOM_RECORDER, "room", now()))
    db.execute("UPDATE s_room_journeys SET training_session_id=? WHERE room_session_id=?",
               (session_id, ctx.room_session_id))
    return session_id


def _passport_step(db, workout, step) -> None:
    """One completed exercise in the shared visit history (never twice: callers only
    reach here on a step's first completion)."""
    session_id = workout["training_session_id"]
    if not session_id or not step["exercise_ref"]:
        return
    sequence = db.execute("SELECT COALESCE(MAX(sequence),0)+1 FROM p_session_exercise_events WHERE session_id=?",
                          (session_id,)).fetchone()[0]
    stamp = now()
    db.execute("INSERT INTO p_session_exercise_events VALUES (?,?,?,?,?,?)",
               (uid(), session_id, sequence, step["exercise_ref"], stamp, stamp))
    completed = decode(db.execute("SELECT completed FROM p_training_sessions WHERE id=?", (session_id,)).fetchone()[0], [])
    completed.append(step["exercise_ref"])
    db.execute("UPDATE p_training_sessions SET completed=? WHERE id=?", (encode(completed), session_id))


# -- running ----------------------------------------------------------------------------


def _require_workout(db, ctx, *states) -> dict:
    w = current(db, ctx)
    if w is None or w["state"] not in states:
        raise Denied("That step is not available now.", 409, "invalid_transition")
    return w


def _bank_time(db, w) -> None:
    """Add the running segment to active time (pauses are not active time)."""
    if w["state"] == "active" and w["segment_started_at"]:
        cap = max(w["planned_seconds"] * 3, 3600)
        add = min(_seconds_between(w["segment_started_at"], now()), cap)
        db.execute("UPDATE s_workouts SET active_seconds=MIN(active_seconds+?, ?), segment_started_at=NULL WHERE id=?",
                   (add, cap, w["id"]))


def _position_ms(data) -> int:
    value = data.get("position_ms", 0)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return 0
    return int(max(0, min(value, 4 * 3600 * 1000)))


def start(sedens, db, ctx, journey_row, data):
    """ready_to_train → exercise."""
    journey.require_ready(db, ctx)
    journey.require(journey_row, "ready_to_train")
    w = _require_workout(db, ctx, "ready")
    if w["kind"] == "course":
        course = courses.row(db, w["course_id"])
        if not access.can_play_in_room(sedens, db, ctx, course)["ok"]:
            raise Denied("This course cannot be played here.", 403, "not_available")
    session_id = _training_session(db, ctx, journey_row)
    stamp = now()
    db.execute("UPDATE s_workouts SET state='active', started_at=?, segment_started_at=?, training_session_id=? "
               "WHERE id=? AND state='ready'", (stamp, stamp, session_id, w["id"]))
    db.execute("UPDATE s_workout_steps SET state='active', started_at=? WHERE workout_id=? AND position=0",
               (stamp, w["id"]))
    _event(db, ctx, "workout_started", kind=w["kind"], steps=len(_steps(db, w["id"])))
    _event(db, ctx, "exercise_started", position=0)
    return journey.move(db, journey_row, "exercise", expect=data.get("expect"))


def step(sedens, db, ctx, journey_row, data):
    """Finish the current step (completed or skipped) and move to the next one."""
    journey.require(journey_row, "exercise")
    w = _require_workout(db, ctx, "active")
    position = data.get("position")
    outcome = data.get("outcome")
    if isinstance(position, bool) or not isinstance(position, int) or outcome not in ("completed", "skipped"):
        raise Denied("Choose a step.", 400, "invalid")
    rows = _steps(db, w["id"])
    if not 0 <= position < len(rows):
        raise Denied("Choose a step.", 400, "invalid")
    row = rows[position]
    if position != w["current_index"]:
        if row["state"] in ("completed", "skipped"):
            return journey_row  # already done: a retry or a second tap changes nothing
        raise Denied("The room moved on in another window. Showing the current step.", 409, "journey_changed")
    stamp = now()
    if row["state"] in ("pending", "active"):
        db.execute("UPDATE s_workout_steps SET state=?, finished_at=?, started_at=COALESCE(started_at, ?) "
                   "WHERE workout_id=? AND position=? AND state IN ('pending','active')",
                   (outcome, stamp, stamp, w["id"], position))
        if outcome == "completed":
            _passport_step(db, w, row)
        _event(db, ctx, "exercise_completed" if outcome == "completed" else "exercise_skipped", position=position,
               phase=row["phase"])
    if position + 1 < len(rows):
        db.execute("UPDATE s_workouts SET current_index=?, position_ms=0 WHERE id=?", (position + 1, w["id"]))
        db.execute("UPDATE s_workout_steps SET state='active', started_at=? WHERE workout_id=? AND position=? "
                   "AND state='pending'", (stamp, w["id"], position + 1))
        _event(db, ctx, "exercise_started", position=position + 1)
        return journey.move(db, journey_row, "exercise", expect=data.get("expect"))
    return _finish(sedens, db, ctx, journey_row, w, "completed", expect=data.get("expect"))


def previous(sedens, db, ctx, journey_row, data):
    """Back one step to do it again. Its first completion stays the only one."""
    journey.require(journey_row, "exercise")
    w = _require_workout(db, ctx, "active")
    if w["current_index"] == 0:
        raise Denied("This is the first exercise.", 409, "invalid_transition")
    db.execute("UPDATE s_workouts SET current_index=current_index-1, position_ms=0 WHERE id=?", (w["id"],))
    return journey.move(db, journey_row, "exercise", expect=data.get("expect"))


def pause(sedens, db, ctx, journey_row, data):
    journey.require(journey_row, "exercise")
    w = _require_workout(db, ctx, "active")
    reason = data.get("reason") if data.get("reason") in ("customer", "anatomy", "presence") else "customer"
    _bank_time(db, w)
    db.execute("UPDATE s_workouts SET state='paused', position_ms=? WHERE id=?", (_position_ms(data), w["id"]))
    _event(db, ctx, "workout_paused", reason=reason, position=w["current_index"])
    return journey.move(db, journey_row, "exercise_paused", expect=data.get("expect"))


def resume(sedens, db, ctx, journey_row, data):
    journey.require(journey_row, "exercise_paused")
    w = _require_workout(db, ctx, "paused")
    db.execute("UPDATE s_workouts SET state='active', segment_started_at=? WHERE id=?", (now(), w["id"]))
    _event(db, ctx, "workout_resumed", position=w["current_index"])
    return journey.move(db, journey_row, "exercise", expect=data.get("expect"))


def _variant_options(w, plan, row, locale=None) -> dict:
    """{'easier': ref|None, 'harder': ref|None} for one step, only where authored."""
    if w["kind"] == "standard":
        entry = standard.get(row["step_ref"]) or {}
        return {"easier": entry.get("easier"), "harder": None if plan.get("no_harder") else entry.get("harder")}
    frozen = next((s for s in plan.get("steps", []) if s["id"] == row["step_ref"]), {})
    variants = frozen.get("variants") or {}
    return {"easier": variants.get("easier", {}).get("id"), "harder": variants.get("harder", {}).get("id")}


def choose_variant(sedens, db, ctx, journey_row, data):
    journey.require(journey_row, "exercise", "exercise_paused")
    w = _require_workout(db, ctx, "active", "paused")
    position, variant = data.get("position"), data.get("variant")
    if position != w["current_index"] or variant not in ("standard", "easier", "harder"):
        raise Denied("Choose an option for the current exercise.", 409, "journey_changed")
    plan = decode(w["plan"], {})
    row = _steps(db, w["id"])[position]
    if variant != "standard" and not _variant_options(w, plan, row)[variant]:
        raise Denied("This exercise has no such option.", 409, "variant_unavailable")
    ref = row["exercise_ref"]
    if w["kind"] == "standard":
        chosen = standard.get(_variant_options(w, plan, row)[variant]) if variant != "standard" else standard.get(row["step_ref"])
        ref = chosen["catalog_key"]
    else:
        frozen = next(s for s in plan["steps"] if s["id"] == row["step_ref"])
        chosen = frozen if variant == "standard" else frozen["variants"][variant]
        ref = (chosen.get("exercise") or {}).get("catalog_key") or ref
    db.execute("UPDATE s_workout_steps SET variant=?, exercise_ref=? WHERE workout_id=? AND position=? "
               "AND state IN ('pending','active')", (variant, ref, w["id"], position))
    if journey_row["state"] == "exercise":
        return journey.move(db, journey_row, "exercise", expect=data.get("expect"))
    return journey_row


def settings(sedens, db, ctx, journey_row, data):
    journey.require(journey_row, "ready_to_train", "exercise", "exercise_paused")
    w = _require_workout(db, ctx, *OPEN)
    if not isinstance(data.get("auto_next"), bool):
        raise Denied("Choose on or off.", 400, "invalid")
    db.execute("UPDATE s_workouts SET auto_next=? WHERE id=?", (int(data["auto_next"]), w["id"]))
    return journey_row


def _finish(sedens, db, ctx, journey_row, w, outcome, *, reason="completed", category=None, expect=None):
    """End the workout (completed or stopped) and show the completion screen."""
    _bank_time(db, w)
    stamp = now()
    db.execute("UPDATE s_workouts SET state=?, ended_at=?, end_reason=?, safety_category=?, segment_started_at=NULL "
               "WHERE id=? AND state IN ('ready','active','paused')",
               ("completed" if outcome == "completed" else "stopped", stamp, reason, category, w["id"]))
    done = db.execute("SELECT state, count(*) FROM s_workout_steps WHERE workout_id=? GROUP BY state",
                      (w["id"],)).fetchall()
    counts = {r[0]: r[1] for r in done}
    # A step the customer skipped was not performed: a course session in which every step
    # was skipped ends as a stored fact but does not move the course forward.
    if outcome == "completed" and w["kind"] == "course" and counts.get("completed", 0) > 0:
        enrolled = access.enrollment(db, ctx.student_id, w["course_id"])
        if enrolled is not None:
            marketplace._complete(db, enrolled, "session", w["course_session_id"],
                                  marketplace._snapshot(db, w["course_id"], w["course_version"]))
    if outcome == "completed":
        _event(db, ctx, "workout_completed", kind=w["kind"], completed=counts.get("completed", 0),
               skipped=counts.get("skipped", 0))
    else:
        _event(db, ctx, "session_abandoned", kind=w["kind"], reason=reason, completed=counts.get("completed", 0))
    return journey.move(db, journey_row, "session_complete", expect=expect)


def safety_stop(sedens, db, ctx, journey_row, data):
    """"I don't feel well": stop now, save as incomplete, show simple guidance."""
    journey.require(journey_row, "ready_to_train", "exercise", "exercise_paused")
    w = _require_workout(db, ctx, *OPEN)
    urgent = data.get("urgent")
    category = data.get("category")
    if not isinstance(urgent, bool) or (not urgent and category not in SAFETY):
        raise Denied("Choose what is happening.", 400, "invalid")
    category = "urgent" if urgent else category
    _event(db, ctx, "safety_stop", category=category, position=w["current_index"])
    return _finish(sedens, db, ctx, journey_row, w, "stopped", reason="safety_stop", category=category,
                   expect=data.get("expect"))


def end_workout(sedens, db, ctx, journey_row, data):
    """The customer ends the workout early (not a safety stop)."""
    journey.require(journey_row, "ready_to_train", "exercise", "exercise_paused")
    w = _require_workout(db, ctx, *OPEN)
    return _finish(sedens, db, ctx, journey_row, w, "stopped", reason="customer_ended", expect=data.get("expect"))


def _choices(value, allowed) -> list:
    if not isinstance(value, list) or len(value) > len(allowed) or any(v not in allowed for v in value):
        raise Denied("Choose from the listed options.", 400, "invalid")
    return sorted(set(value), key=list(allowed).index)


def submit_feedback(sedens, db, ctx, journey_row, data):
    """Effort (0-10, optional) and discomfort, once per workout."""
    journey.require(journey_row, "session_complete")
    w = _require_workout(db, ctx, "completed", "stopped")
    copy = feedback_copy()
    effort = data.get("effort")
    if effort is not None and (isinstance(effort, bool) or not isinstance(effort, int) or not 0 <= effort <= 10):
        raise Denied("Choose a number from 0 to 10, or skip.", 400, "invalid")
    discomfort = data.get("discomfort")
    if discomfort not in (None, "no", "yes"):
        raise Denied("Choose Yes or No.", 400, "invalid")
    urgent = regions = when = strength = still = None
    if discomfort == "yes":
        urgent = data.get("urgent")
        if not isinstance(urgent, bool):
            raise Denied("Choose Yes or No.", 400, "invalid")
        if not urgent:
            regions = _choices(data.get("regions") or [], tuple(copy["discomfort"]["regions"]))
            when = data.get("when")
            strength = data.get("strength")
            still = data.get("still")
            if when not in (None, *copy["discomfort"]["when"]) or strength not in (None, *copy["discomfort"]["strength"]) \
                    or still not in (None, True, False):
                raise Denied("Choose from the listed options.", 400, "invalid")
    note = data.get("note") or ""
    if not isinstance(note, str) or len(note) > MAX_NOTE:
        raise Denied(f"Keep the note under {MAX_NOTE} characters.", 400, "invalid")
    counts = {r[0]: r[1] for r in db.execute("SELECT state, count(*) FROM s_workout_steps WHERE workout_id=? GROUP BY state",
                                             (w["id"],))}
    target = decode(w["plan"], {}).get("intensity")
    inserted = db.execute(
        "INSERT OR IGNORE INTO s_session_feedback(workout_id,room_session_id,org_id,student_id,training_session_id,"
        "questions_version,locale,target_intensity,effort,discomfort,discomfort_urgent,discomfort_regions,"
        "discomfort_when,discomfort_strength,discomfort_still,note,outcome,completed_steps,skipped_steps,"
        "active_seconds,submitted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (w["id"], ctx.room_session_id, ctx.org_id, ctx.student_id, w["training_session_id"], FEEDBACK_VERSION,
         data.get("lang") if data.get("lang") in ("en", "ko") else "ko", target if target in plans.INTENSITIES else None,
         effort, discomfort, None if urgent is None else int(urgent), encode(regions or []), when, strength,
         None if still is None else int(still), note.strip(), "completed" if w["state"] == "completed" else "stopped",
         counts.get("completed", 0), counts.get("skipped", 0),
         db.execute("SELECT active_seconds FROM s_workouts WHERE id=?", (w["id"],)).fetchone()[0], now())).rowcount
    if not inserted:
        raise Denied("Your answers for this session are already saved.", 409, "feedback_recorded")
    _event(db, ctx, "session_feedback_submitted", effort=effort, discomfort=discomfort == "yes",
           urgent=bool(urgent), skipped_effort=effort is None)
    notice = {"code": "urgent"} if urgent else ({"code": "discomfort"} if discomfort == "yes" else {"code": "thanks"})
    return journey_row, notice


def cancel(sedens, db, ctx, journey_row, data):
    """ready_to_train → session_choice: the prepared workout is set aside unstarted."""
    journey.require(journey_row, "ready_to_train")
    w = _require_workout(db, ctx, "ready")
    db.execute("UPDATE s_workouts SET state='abandoned', end_reason='replaced', ended_at=? WHERE id=? AND state='ready'",
               (now(), w["id"]))
    return journey.move(db, journey_row, "session_choice", expect=data.get("expect"))


def another(sedens, db, ctx, journey_row, data):
    """session_complete → session_choice: choose another session in this visit."""
    journey.require(journey_row, "session_complete")
    w = current(db, ctx)
    if w is not None and w["safety_category"]:
        raise Denied("After a safety stop, the room does not start another session.", 409, "safety_stopped")
    return journey.move(db, journey_row, "session_choice", expect=data.get("expect"))


def abandon_open(db, room_session_id, reason) -> None:
    """The visit ended with a workout still open: keep it as an incomplete record."""
    for row in db.execute("SELECT * FROM s_workouts WHERE room_session_id=? AND state IN ('ready','active','paused')",
                          (room_session_id,)).fetchall():
        _bank_time(db, dict(row))
        db.execute("UPDATE s_workouts SET state='abandoned', ended_at=?, end_reason=?, segment_started_at=NULL "
                   "WHERE id=?", (now(), reason, row["id"]))


# -- what the screen shows ---------------------------------------------------------------


def _lines(text, limit=6) -> list[str]:
    parts = [p.strip() for p in re.split(r"(?<=[.!?。])\s+|\n+", text or "") if p.strip()]
    return parts[:limit]


# SEDENS Standard narration: the first line is spoken as the step starts, later lines
# every 8 seconds, at most three spoken lines a step and none after its planned time;
# every other line is a subtitle only. Nobody is talked at for the whole step.
STANDARD_SPOKEN_EVERY, STANDARD_MAX_SPOKEN = 8, 3


def _narration(lines, *, mode, cues=None, audio=None) -> dict:
    """The narration part of a step's content.

    ``narration`` keeps its old meaning (lines spoken in order when the step starts);
    ``narration_cues`` are every line with its time on the step clock and whether it is
    spoken, so subtitles are all cues; ``narration_audio`` is the creator's recording."""
    cues = cues if cues is not None else [{"text": line, "at_ms": 0, "speak": True} for line in lines]
    return {"narration": [c["text"] for c in cues if c["speak"]] if mode == "timed" else lines,
            "narration_mode": mode, "narration_cues": cues, "narration_audio": audio}


def _standard_cues(lines, planned_seconds) -> list[dict]:
    cues = []
    for index, line in enumerate(lines):
        at = index * STANDARD_SPOKEN_EVERY
        speak = index < STANDARD_MAX_SPOKEN and (not planned_seconds or index == 0 or at <= planned_seconds)
        cues.append({"text": line, "at_ms": at * 1000, "speak": speak})
    return cues


def _course_narration(s, locale) -> dict:
    """A course step's narration from the enrolled version: the creator's timed cues and
    recording, or, for a step without cues, its narration text exactly as before."""
    audio = _media(s.get("narration_audio"), s.get("narration_audio_media_id"), locale)
    cues = [c for c in s.get("narration_cues") or [] if isinstance(c, dict) and c.get("text")]
    if cues:
        timed = [{"text": c["text"], "at_ms": int(round(float(c.get("at_seconds") or 0) * 1000)),
                  "speak": bool(c.get("speak"))} for c in cues]
        return _narration([], mode="timed", cues=timed, audio=audio)
    return _narration(_lines(s.get("narration") or s.get("customer_cue") or ""), mode="sequence", audio=audio)


def _standard_step(entry, locale, *, sets, rest_between, planned=None) -> dict:
    media = []
    sources = {a["id"]: a for a in _content_assets()}
    for asset_id in entry.get("media") or []:
        a = sources.get(asset_id)
        if a:
            media.append({"kind": a["kind"], "url": "/" + a["path"].removeprefix("web/"), "mime": a["mime"],
                          "label": _t(a.get("label"), locale), "description": _t(a.get("description"), locale)})
    dose = dict(entry["dose"])
    dose.update(sets=sets, seconds_per_rep=entry.get("seconds_per_rep"), set_rest=rest_between)
    lines = [_t(n, locale) for n in (entry.get("narration") or [])] or [_t(entry["steps"][0], locale),
                                                                       _t(entry["cue"], locale)]
    return {
        "source": "standard", "ref": entry["id"], "catalog_key": entry["catalog_key"],
        "title": _t(entry["title"], locale), "setup": _t(entry.get("setup") or entry["steps"][0], locale),
        "instructions": [_t(s, locale) for s in entry["steps"]], "cue": _t(entry["cue"], locale),
        "breath": _t(entry.get("breath"), locale), "stop_if": _t(entry.get("stop_if"), locale),
        **_narration(lines, mode="timed", cues=_standard_cues(lines, planned)),
        "dose": dose, "equipment": entry.get("equipment") or [], "position": entry.get("position"),
        "video": next((m for m in media if m["kind"] == "video"), None),
        "image": next((m for m in media if m["kind"] == "image"), None),
        "anatomy": {"exercise": entry["anatomy"]["exercise"], "depth": entry["anatomy"].get("atlas_depth"),
                    "structures": entry["anatomy"]["structures"], "timeline": [], "label": _t(ANATOMY_LABEL, locale)},
        "review": entry["review"]["status"],
        "easier_text": [_t(x, locale) for x in entry.get("regressions") or []],
        "harder_text": [_t(x, locale) for x in entry.get("progressions") or []],
    }


@lru_cache(maxsize=1)
def _content_assets_cached() -> tuple:
    data = json.loads((DATA / "content_sources.json").read_text(encoding="utf-8"))
    return tuple(data.get("assets", []))


def _content_assets() -> list[dict]:
    return list(_content_assets_cached())


def _media(summary, media_id, locale) -> dict | None:
    if not media_id:
        return None
    s = summary or {}
    label = video_providers.label_for(s.get("source"), s.get("licence_type"), None, s.get("sha256"))
    return {"kind": s.get("kind") or "", "url": f"/sedens/media/file?id={media_id}", "mime": s.get("mime"),
            "source": s.get("source"), "title": s.get("title"), "licence_type": s.get("licence_type"),
            "original_creator": s.get("original_creator"), "identifiable_person": s.get("identifiable_person"),
            "label": _t(label, locale)}


def _library_text(step) -> dict | None:
    """How to do the SEDENS Standard exercise a course step points at, frozen into the
    workout when the session starts. Only the library's own instructions: everything the
    creator wrote (cue, narration, dose, media, anatomy) comes from the enrolled version."""
    ex = step.get("exercise") or {}
    entry = standard.get(ex.get("ref")) if ex.get("source") == "standard" else None
    if entry is None:
        return None
    return {"ref": entry["id"], "standard_version": standard.document().get("version"),
            "setup": entry.get("setup"), "steps": entry.get("steps") or [], "breath": entry.get("breath"),
            "stop_if": entry.get("stop_if")}


def _course_step(s, locale) -> dict:
    ex = s.get("exercise") or {}
    lib = s.get("library") or {}
    title = s.get("title") or _t(ex.get("title") or {}, locale) or ""
    steps = [_t(x, locale) for x in lib.get("steps") or []]
    return {
        "source": "course", "ref": s["id"], "catalog_key": ex.get("catalog_key"),
        "title": title, "setup": _t(lib.get("setup"), locale) or "",
        "instructions": steps or _lines(s.get("narration") or ""), "cue": s.get("customer_cue") or "",
        "breath": _t(lib.get("breath"), locale) or "", "stop_if": _t(lib.get("stop_if"), locale) or "",
        **_course_narration(s, locale),
        "dose": {"mode": "hold" if s.get("hold_seconds") and not s.get("reps") else "reps", "sets": s.get("sets") or 1,
                 "reps": s.get("reps") or 0, "hold_seconds": s.get("hold_seconds") or 0,
                 "work_seconds": s.get("work_seconds") or 0, "rest_seconds": s.get("rest_seconds") or 0,
                 "sides": s.get("sides") or "none", "seconds_per_rep": None, "set_rest": s.get("rest_seconds") or 0},
        "equipment": s.get("equipment") or [], "position": None, "advance": s.get("advance") or "manual",
        "video": _media(s.get("video"), s.get("video_media_id"), locale),
        "image": _media(s.get("image"), s.get("image_media_id"), locale),
        "anatomy": {"exercise": ex.get("anatomy_exercise") or ex.get("catalog_key"), "depth": s.get("atlas_depth"),
                    "structures": s.get("anatomy") or ex.get("structures") or [], "timeline": s.get("timeline") or [],
                    "label": _t(ANATOMY_LABEL, locale)},
        "review": (ex.get("review") or {}).get("status", "unreviewed"),
        "easier_text": [s["regression"]] if s.get("regression") else [],
        "harder_text": [s["progression"]] if s.get("progression") else [],
    }


def player_steps(w, rows, locale) -> list[dict]:
    plan = decode(w["plan"], {})
    out = []
    for row in rows:
        options = _variant_options(w, plan, row)
        if w["kind"] == "standard":
            base = standard.get(row["step_ref"])
            sets = next((s["sets"] for s in plan["steps"] if s["position"] == row["position"]), 1)
            item = _standard_step(base, locale, sets=sets, rest_between=plan.get("rest_between_sets"),
                                  planned=row["planned_seconds"])
            variants = {k: _standard_step(standard.get(v), locale, sets=sets, rest_between=plan.get("rest_between_sets"),
                                          planned=row["planned_seconds"])
                        for k, v in options.items() if v and standard.get(v)}
        else:
            frozen = next(s for s in plan["steps"] if s["id"] == row["step_ref"])
            item = _course_step(frozen, locale)
            variants = {k: _course_step(frozen["variants"][k], locale) for k, v in options.items() if v}
        out.append({"position": row["position"], "phase": row["phase"], "state": row["state"],
                    "variant": row["variant"], "planned_seconds": row["planned_seconds"],
                    "content": item, "variants": variants})
    return out


def summary(db, w, locale) -> dict:
    rows = _steps(db, w["id"])
    plan = decode(w["plan"], {})
    counts = {"completed": sum(r["state"] == "completed" for r in rows),
              "skipped": sum(r["state"] == "skipped" for r in rows), "total": len(rows)}
    out = {"outcome": w["state"], "end_reason": w["end_reason"], "safety_category": w["safety_category"],
           "kind": w["kind"], "active_minutes": round(w["active_seconds"] / 60),
           "planned_minutes": round(w["planned_seconds"] / 60),
           "duration_minutes": round(_seconds_between(w["started_at"], w["ended_at"]) / 60) if w["started_at"] else 0,
           "steps": counts}
    if w["kind"] == "standard":
        r = plans.rules(plan.get("rules_version") or plans.CURRENT)
        out["title"] = _t(r["messages"]["label"], locale)
        out["focus"] = _t(r["goals"][plan["goal"]]["label"], locale)
        out["intensity"] = _t(r["intensities"][plan["intensity"]]["label"], locale)
    else:
        out["title"] = plan.get("course_title")
        out["focus"] = f"{plan.get('module_title', '')} · {plan.get('session_title', '')}".strip(" ·")
        enrolled = db.execute("SELECT * FROM s_enrollments WHERE id=?", (w["enrollment_id"],)).fetchone() \
            if w["enrollment_id"] else None
        if enrolled is not None:
            progress = marketplace.progress(db, enrolled, marketplace._snapshot(db, w["course_id"], w["course_version"]),
                                            w["course_version"])
            out["course_progress"] = {"completed": progress["completed_items"], "total": progress["total_items"],
                                      "version": w["course_version"]}
    return out


def view_part(sedens, db, ctx, journey_row, locale) -> dict:
    state = journey_row["state"]
    if state not in ("ready_to_train", "exercise", "exercise_paused", "session_complete"):
        return {}
    w = current(db, ctx)
    if w is None:
        return {}
    plan = decode(w["plan"], {})
    out = {"id": w["id"], "kind": w["kind"], "state": w["state"], "current_index": w["current_index"],
           "position_ms": w["position_ms"], "auto_next": bool(w["auto_next"]),
           "planned_minutes": round(w["planned_seconds"] / 60), "anatomy_label": _t(ANATOMY_LABEL, locale)}
    if w["kind"] == "standard":
        r = plans.rules(plan.get("rules_version") or plans.CURRENT)
        out.update(title=_t(r["messages"]["label"], locale), content_label=_t(standard.label(), locale),
                   subtitle=_t(r["goals"][plan["goal"]]["label"], locale))
    else:
        out.update(title=plan.get("course_title"), subtitle=f"{plan.get('module_title', '')} · {plan.get('session_title', '')}"
                   .strip(" ·"), course_version=w["course_version"])
    if state == "session_complete":
        out["summary"] = summary(db, w, locale)
        given = db.execute("SELECT effort, discomfort, discomfort_urgent FROM s_session_feedback WHERE workout_id=?",
                           (w["id"],)).fetchone()
        out["feedback_saved"] = given is not None
        copy = feedback_copy()
        out["feedback"] = None if given is not None or w["safety_category"] == "urgent" else _feedback_questions(copy, locale)
        if w["safety_category"]:
            out["safety"] = (_urgent(copy, locale) if w["safety_category"] == "urgent"
                             else {"title": None, "body": readiness.unwell_copy(locale)["guidance"]})
        if given is not None:
            out["after_feedback"] = (_urgent(copy, locale)["body"] if given["discomfort_urgent"] else
                                     _t(copy["discomfort"]["closing"], locale) if given["discomfort"] == "yes" else
                                     _t(copy["thanks"], locale))
        return {"workout": out}
    out["steps"] = player_steps(w, _steps(db, w["id"]), locale)
    return {"workout": out}


def _urgent(copy, locale) -> dict:
    return {"title": _t(copy["urgent"]["title"], locale), "body": _t(copy["urgent"]["body"], locale)}


def _feedback_questions(copy, locale) -> dict:
    e, d = copy["effort"], copy["discomfort"]
    return {
        "version": copy["version"],
        "effort": {"question": _t(e["question"], locale), "helper": _t(e["helper"], locale),
                   "labels": [{"from": x["from"], "to": x["to"], "text": x[locale] if locale in x else x["en"]}
                              for x in e["labels"]],
                   "footnote": _t(e["footnote"], locale), "skip": _t(e["skip"], locale)},
        "discomfort": {"question": _t(d["question"], locale), "helper": _t(d["helper"], locale),
                       "urgent_question": _t(d["urgent_question"], locale),
                       "regions_question": _t(d["regions_question"], locale),
                       "regions": [{"id": k, "label": _t(v, locale)} for k, v in d["regions"].items()],
                       "when_question": _t(d["when_question"], locale),
                       "when": [{"id": k, "label": _t(v, locale)} for k, v in d["when"].items()],
                       "strength_question": _t(d["strength_question"], locale),
                       "strength": [{"id": k, "label": _t(v, locale)} for k, v in d["strength"].items()],
                       "still_question": _t(d["still_question"], locale)},
        "note_label": _t(copy["note_label"], locale),
    }


def notice_text(notice, locale) -> str | None:
    if not notice:
        return None
    copy = feedback_copy()
    return {"urgent": _urgent(copy, locale)["body"], "discomfort": _t(copy["discomfort"]["closing"], locale),
            "thanks": _t(copy["thanks"], locale)}.get(notice["code"])


plans.ACCEPT_HOOKS.append(create_standard)
journey.register({"course/start": choose_course, "workout/start": start, "workout/step": step,
                  "workout/previous": previous, "workout/pause": pause, "workout/resume": resume,
                  "workout/variant": choose_variant, "workout/settings": settings, "workout/unwell": safety_stop,
                  "workout/end": end_workout, "workout/feedback": submit_feedback, "workout/another": another,
                  "workout/cancel": cancel}, view_part=view_part, on_close=abandon_open)
