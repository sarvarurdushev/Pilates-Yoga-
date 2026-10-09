"""The customer catalog, enrollment, progress, the facility course console, and
the room-only launch of a guided session.

Every decision goes through :mod:`pilates.sedens.access`. Customers read the
published version snapshot (or the version they enrolled in), never draft rows.
Outside a room a customer sees a course's overview, module and session titles,
their enrollment and progress, but a guided session's steps are returned only
inside an authorized room (``room_session_plan``).
"""

from __future__ import annotations

from . import access, courses, payments
from .util import Denied, decode, now, uid


def _published_courses(sedens, db, viewer_org):
    env = access.environment(viewer_org)
    for c in db.execute("SELECT * FROM s_courses WHERE published_version IS NOT NULL AND suspended_at IS NULL "
                        "AND archived_at IS NULL ORDER BY updated_at DESC"):
        owner = sedens.org(db, c["owner_org_id"])
        if owner and access.environment(owner) == env:
            yield c


def _snapshot(db, course_id, number):
    found = db.execute("SELECT snapshot FROM s_course_versions WHERE course_id=? AND version=?",
                       (course_id, number)).fetchone()
    return decode(found[0], {}) if found else {}


def catalog(sedens, db, actor) -> list[dict]:
    viewer = sedens.org(db, actor.org_id)
    cards = [access.course_card(sedens, db, actor, c) for c in _published_courses(sedens, db, viewer)
             if access.can_view_metadata(sedens, db, actor, c)]
    order = {"sedens_standard": 0, "facility_program": 1, "premium_expert": 2}
    return sorted(cards, key=lambda c: (not c["featured_here"], not c["enabled_here"], order[c["badge"]], c["title"]))


def _outline(snapshot) -> list[dict]:
    """Module, session and lesson titles only: the parts anyone who may see the course sees."""
    out = []
    for m in snapshot.get("modules", []):
        out.append({"id": m["id"], "title": m["title"], "summary": m["summary"],
                    "sessions": [{"id": s["id"], "title": s["title"], "estimated_minutes": s["estimated_minutes"],
                                  "steps": len(s["steps"])} for s in m.get("sessions", [])],
                    "lessons": [{"id": x["id"], "title": x["title"], "kind": x["kind"]} for x in m.get("lessons", [])]})
    return out


def progress(db, enrollment, snapshot, number=None) -> dict:
    if enrollment is None:
        return None
    done = {(p["item_kind"], p["item_id"]): p["completed_at"] for p in db.execute(
        "SELECT * FROM s_course_progress WHERE enrollment_id=?", (enrollment["id"],))}
    modules, total, finished = [], 0, 0
    for m in snapshot.get("modules", []):
        items = [("session", s["id"]) for s in m.get("sessions", [])] + [("lesson", x["id"]) for x in m.get("lessons", [])]
        count = sum(1 for i in items if i in done)
        modules.append({"id": m["id"], "title": m["title"], "completed": count, "total": len(items)})
        total, finished = total + len(items), finished + count
    return {"version": number or enrollment["version"], "enrolled_at": enrollment["enrolled_at"],
            "completed_items": finished, "total_items": total, "modules": modules,
            "completed_at": enrollment["completed_at"],
            "done": sorted(f"{k}:{i}" for (k, i) in done)}


def detail(sedens, db, actor, course_id) -> dict:
    course = courses.row(db, course_id)
    if not access.can_view_metadata(sedens, db, actor, course) or not course["published_version"]:
        raise Denied("This course does not exist.", 404, "unknown_course")
    enrolled = access.enrollment(db, actor.user_id, course_id)
    number = access.effective_version(db, course, enrolled)
    snapshot = _snapshot(db, course_id, number)
    meta = snapshot["course"]
    return {
        "card": access.course_card(sedens, db, actor, course),
        "overview": {k: meta[k] for k in ("description", "audience", "prerequisites", "safety", "outcomes", "goals",
                                           "body_areas")},
        "outline": _outline(snapshot),
        "version": number,
        "enroll": access.enroll_option(sedens, db, actor, course),
        "progress": progress(db, enrolled, snapshot, number),
        # Guided workouts launch only inside an authorized room.
        "play_here": access.can_play_in_room(sedens, db, None, course),
        "room_only": course["course_type"] == "guided_training",
        "demo_marketplace": bool(sedens.org(db, course["owner_org_id"])["demo"]),
    }


def enroll(sedens, db, actor, course_id) -> dict:
    course = courses.row(db, course_id)
    option = access.enroll_option(sedens, db, actor, course)
    if not option["ok"]:
        messages = {"purchase_required": ("This course is paid. Buy it first.", 402),
                    "already_enrolled": ("You are already enrolled.", 409),
                    "customers_only": ("Guided training is for customers.", 403)}
        message, status = messages.get(option["reason"], ("This course is not available to you.", 404))
        raise Denied(message, status, option["reason"])
    stamp = now()
    entitlement_id = option.get("entitlement_id")
    if entitlement_id is None:
        entitlement_id = uid()
        db.execute("INSERT INTO s_entitlements(id,user_id,org_id,course_id,source,facility_id,granted_at) VALUES (?,?,?,?,?,?,?) "
                   "ON CONFLICT(user_id,course_id,source) DO UPDATE SET revoked_at=NULL, granted_at=excluded.granted_at, "
                   "facility_id=excluded.facility_id",
                   (entitlement_id, actor.user_id, actor.org_id, course_id, option["source"], option.get("facility_id"), stamp))
        entitlement_id = db.execute("SELECT id FROM s_entitlements WHERE user_id=? AND course_id=? AND source=?",
                                    (actor.user_id, course_id, option["source"])).fetchone()[0]
    db.execute("INSERT INTO s_enrollments(id,user_id,org_id,course_id,version,entitlement_id,enrolled_at) VALUES (?,?,?,?,?,?,?)",
               (uid(), actor.user_id, actor.org_id, course_id, course["published_version"], entitlement_id, stamp))
    sedens.audit(db, actor.org_id, actor.user_id, "course:enroll", course_id,
                 {"source": option["source"], "version": course["published_version"]})
    return detail(sedens, db, actor, course_id)


def purchase(sedens, db, actor, course_id) -> dict:
    """A simulated purchase (demonstrations only), then enrollment in the published version."""
    course = courses.row(db, course_id)
    receipt = payments.PROVIDER.purchase(sedens, db, actor, course)
    if access.enrollment(db, actor.user_id, course_id) is None:
        enroll(sedens, db, actor, course_id)
    return {"purchase": receipt, "course": detail(sedens, db, actor, course_id)}


def my_courses(sedens, db, actor) -> list[dict]:
    out = []
    for e in db.execute("SELECT * FROM s_enrollments WHERE user_id=? ORDER BY enrolled_at DESC", (actor.user_id,)):
        course = courses.row(db, e["course_id"])
        number = access.effective_version(db, course, e)
        snapshot = _snapshot(db, e["course_id"], number) if number else {}
        out.append({"card": access.course_card(sedens, db, actor, course), "progress": progress(db, e, snapshot, number),
                    "available": access.published(course)})
    return out


def _complete(db, enrollment, kind, item_id, snapshot):
    module = next((m["id"] for m in snapshot.get("modules", [])
                   for x in m.get("sessions" if kind == "session" else "lessons", []) if x["id"] == item_id), None)
    if module is None:
        raise Denied("This part is not in your version of the course.", 404, "unknown_item")
    db.execute("INSERT OR IGNORE INTO s_course_progress(enrollment_id,item_kind,item_id,module_id,completed_at) VALUES (?,?,?,?,?)",
               (enrollment["id"], kind, item_id, module, now()))
    state = progress(db, enrollment, snapshot)
    if state["total_items"] and state["completed_items"] == state["total_items"] and not enrollment["completed_at"]:
        db.execute("UPDATE s_enrollments SET completed_at=? WHERE id=?", (now(), enrollment["id"]))


def complete_lesson(sedens, db, actor, course_id, lesson_id) -> dict:
    """Professional-education lessons are completed where they are read."""
    course = courses.row(db, course_id)
    enrolled = access.enrollment(db, actor.user_id, course_id)
    if course["course_type"] != "professional_education" or enrolled is None \
            or not access.entitlements(sedens, db, actor.user_id, course):
        raise Denied("Enroll in this course first.", 404, "not_enrolled")
    _complete(db, enrolled, "lesson", lesson_id, _snapshot(db, course_id, access.effective_version(db, course, enrolled)))
    return detail(sedens, db, actor, course_id)


# -- the room ---------------------------------------------------------------------------


def room_courses(sedens, db, room) -> list[dict]:
    """Guided courses this customer may launch on this room's screen."""
    org = sedens.org(db, room.org_id)
    out = []
    for c in _published_courses(sedens, db, org):
        if c["course_type"] != "guided_training":
            continue
        decision = access.can_play_in_room(sedens, db, room, c)
        if decision["reason"] == "not_enabled_here":
            continue
        snapshot = _snapshot(db, c["id"], c["published_version"])
        featured = access.facility_setting(db, room.org_id, c["id"])["featured"]
        out.append({"id": c["id"], "title": snapshot["course"]["title"], "playable": decision["ok"],
                    "reason": decision["reason"], "featured": featured, "outline": _outline(snapshot)})
    # What the facility features comes first, then what this customer can play.
    return sorted(out, key=lambda c: (not c["featured"], not c["playable"], c["title"]))


def room_session_plan(sedens, db, room, course_id, session_id) -> dict:
    """The steps of one guided session, for the room screen only.

    Free courses enroll the customer on first launch; the version they are on
    stays theirs until they deliberately move to a newer one."""
    course = courses.row(db, course_id)
    decision = access.can_play_in_room(sedens, db, room, course)
    if not decision["ok"]:
        raise Denied({"purchase_required": "Buy this course on your phone to play it here.",
                      "not_enabled_here": "This course is not offered in this room."}
                     .get(decision["reason"], "This course cannot be played here."), 403, decision["reason"])
    enrolled = access.enrollment(db, room.student_id, course_id)
    if enrolled is None:
        stamp = now()
        held = access.entitlements(sedens, db, room.student_id, course)
        offer = access.enabled_at(sedens, db, course, room.org_id, room.location_id)
        source = held[0]["source"] if held else ("facility_included" if offer and offer["included"] else "facility_free")
        entitlement = held[0]["id"] if held else uid()
        if not held:
            db.execute("INSERT INTO s_entitlements(id,user_id,org_id,course_id,source,facility_id,granted_at) VALUES (?,?,?,?,?,?,?) "
                       "ON CONFLICT(user_id,course_id,source) DO UPDATE SET revoked_at=NULL",
                       (entitlement, room.student_id, room.org_id, course_id, source, room.org_id, stamp))
            entitlement = db.execute("SELECT id FROM s_entitlements WHERE user_id=? AND course_id=? AND source=?",
                                     (room.student_id, course_id, source)).fetchone()[0]
        db.execute("INSERT INTO s_enrollments(id,user_id,org_id,course_id,version,entitlement_id,enrolled_at) VALUES (?,?,?,?,?,?,?)",
                   (uid(), room.student_id, room.org_id, course_id, course["published_version"], entitlement, stamp))
        enrolled = access.enrollment(db, room.student_id, course_id)
    number = access.effective_version(db, course, enrolled)
    snapshot = _snapshot(db, course_id, number)
    session = next((s for m in snapshot.get("modules", []) for s in m.get("sessions", []) if s["id"] == session_id), None)
    if session is None:
        raise Denied("This session is not in your version of the course.", 404, "unknown_item")
    return {"course_id": course_id, "version": number, "session": session,
            "anatomy_label": {"en": "Educational anatomy — not measured muscle activation.",
                              "ko": "교육용 해부학 — 측정된 근육 활성도가 아닙니다."}}


def complete_room_session(sedens, db, room, course_id, session_id) -> dict:
    course = courses.row(db, course_id)
    if not access.can_play_in_room(sedens, db, room, course)["ok"]:
        raise Denied("This course cannot be played here.", 403, "not_available")
    enrolled = access.enrollment(db, room.student_id, course_id)
    if enrolled is None:
        raise Denied("Start the session first.", 409, "not_enrolled")
    number = access.effective_version(db, course, enrolled)
    snapshot = _snapshot(db, course_id, number)
    _complete(db, enrolled, "session", session_id, snapshot)
    return {"progress": progress(db, access.enrollment(db, room.student_id, course_id), snapshot, number)}


# -- the facility -----------------------------------------------------------------------


def _admin(sedens, db, actor):
    if actor.role != "admin" or sedens.org(db, actor.org_id)["kind"] != "facility":
        raise Denied("Only a facility administrator manages its courses.", 403, "admin_required")


def facility_courses(sedens, db, actor) -> list[dict]:
    _admin(sedens, db, actor)
    org = sedens.org(db, actor.org_id)
    out = []
    for c in _published_courses(sedens, db, org):
        offer = access.offered_to(sedens, db, c, actor.org_id)
        if offer is None:
            continue
        card = access.course_card(sedens, db, actor, c, facility_id=actor.org_id)
        out.append({**card, "basis": offer["basis"], "own_program": offer["own_program"],
                    "free_here": offer["free"], "setting": access.facility_setting(db, actor.org_id, c["id"])})
    return out


def set_facility_course(sedens, db, actor, data) -> dict:
    _admin(sedens, db, actor)
    course = courses.row(db, data.get("course_id"))
    offer = access.offered_to(sedens, db, course, actor.org_id)
    if offer is None:
        # A facility cannot switch on a course that is not offered to it.
        raise Denied("This course is not offered to your facility.", 404, "not_offered")
    current = access.facility_setting(db, actor.org_id, course["id"])
    enabled = bool(data.get("enabled", current["enabled"]))
    included = bool(data.get("included", current["included"]))
    featured = bool(data.get("featured", current["featured"]))
    if included and not offer["free"]:
        raise Denied("A paid course cannot be included for members. Members buy it themselves.", 400, "paid_not_includable")
    if (included or featured) and not enabled:
        raise Denied("Enable the course before including or featuring it.", 400, "enable_first")
    db.execute("INSERT INTO s_facility_course_settings(org_id,course_id,enabled,included,featured,updated_by,updated_at) "
               "VALUES (?,?,?,?,?,?,?) ON CONFLICT(org_id,course_id) DO UPDATE SET enabled=excluded.enabled, "
               "included=excluded.included, featured=excluded.featured, updated_by=excluded.updated_by, "
               "updated_at=excluded.updated_at",
               (actor.org_id, course["id"], int(enabled), int(included), int(featured), actor.user_id, now()))
    sedens.audit(db, actor.org_id, actor.user_id, "facility:course", course["id"],
                 {"enabled": enabled, "included": included, "featured": featured})
    return {"items": facility_courses(sedens, db, actor)}
