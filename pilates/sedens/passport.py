"""The Fitness Passport: what a customer's history says, read from the records that
already hold it. Phase 3 writes correct records; Phase 4 reads them back to the
customer, on their own phone.

There is one historical truth per fact:

* a visit and its completed exercises: ``p_training_sessions`` and
  ``p_session_exercise_events`` (shared with the coaching workspace);
* readiness, scan summaries, plans, workouts and session feedback: the SEDENS
  tables of each (``s_readiness_checks``, ``s_room_scans``, ``s_recommendations``,
  ``s_workouts``, ``s_session_feedback``), each linked to the room visit and, for a
  workout, to its ``p_training_sessions`` row;
* course progress: ``s_course_progress`` of the enrollment.

This module only reads them (the customer's own writes are in
:mod:`pilates.sedens.passport_privacy`). Everything here is about one customer:
the signed-in one, scoped by ``user_id`` and ``org_id`` on every query. It shows
only what was recorded: no calories, scores, strength, injury or health claims.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from . import access, marketplace, modes, plans, scan_history, standard
from .util import Denied, decode, parse, utcnow


def summary(db, student_id) -> dict:
    """A short summary for the shared room screen: counts and the last visit date only."""
    visits = db.execute("SELECT count(*), max(performed_at) FROM p_training_sessions WHERE student_id=?",
                        (student_id,)).fetchone()
    room = db.execute("SELECT count(*) FROM s_workouts WHERE student_id=? AND state='completed'",
                      (student_id,)).fetchone()[0] if _has(db, "s_workouts") else 0
    # The Passport's own definition of a visit: a room visit in which an exercise was performed. The room
    # welcome shows this, so it agrees with the Passport; "visits" also counts coach-recorded sessions.
    done = db.execute("SELECT count(*), max(s.started_at) FROM s_room_sessions s WHERE s.student_id=? AND EXISTS "
                      f"(SELECT 1 FROM s_workouts w WHERE w.room_session_id=s.id AND w.student_id=s.student_id AND {PERFORMED})",
                      (student_id,)).fetchone() if _has(db, "s_workouts") else (0, None)
    return {"visits": visits[0], "last_visit": visits[1], "room_sessions_completed": room,
            "completed_visits": done[0], "last_completed_visit": done[1]}


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


# == the customer's own Passport (phone) ======================================================
#
# Definitions (docs/SEDENS_PHASE_4_DESIGN.md section 3.1):
#   completed visit    a room visit of the customer with at least one workout in state 'completed';
#   workout card       completed, stopped early ('stopped', safety stops included) or not finished
#                      (abandoned after it started); a draft ('ready', replaced) never appears, and a
#                      workout still running is not a record yet;
#   exercise time      the sum of active_seconds (pauses excluded), shown in minutes;
#   completed/skipped  the state of each s_workout_steps row: a skipped step was never performed;
#   effort             the customer's own 0-10 answer, never a measurement;
#   consistency        weeks with a completed visit, out of the last 8 weeks.

LANGUAGES = ("ko", "en")
WEEKS = 8
STATUS = {
    "completed": {"en": "Completed", "ko": "완료"},
    "stopped": {"en": "Stopped early", "ko": "도중에 멈춤"},
    "not_finished": {"en": "Not finished", "ko": "끝내지 않음"},
}
ORIGINS = {
    "facility_included": {"en": "Included by your facility", "ko": "시설에서 제공"},
    "facility_free": {"en": "Free at your facility", "ko": "시설에서 무료 제공"},
    "marketplace_free": {"en": "Free course", "ko": "무료 코스"},
    "demo_purchase": {"en": "Demo purchase (no real payment)", "ko": "시연용 구매 (실제 결제 없음)"},
}
ENTITLEMENT = {"active": {"en": "You can use this course", "ko": "이용할 수 있는 코스예요"},
               "revoked": {"en": "Access ended", "ko": "이용이 종료됐어요"},
               "ended": {"en": "Access ended", "ko": "이용이 종료됐어요"},
               "none": {"en": "No access record", "ko": "이용 기록이 없어요"}}
CATEGORIES = {"mobility": {"en": "Mobility", "ko": "모빌리티"}, "pilates": {"en": "Pilates", "ko": "필라테스"},
              "core": {"en": "Core", "ko": "코어"}, "stability": {"en": "Stability", "ko": "안정성"},
              "breathing": {"en": "Breathing", "ko": "호흡"}}
DEPLOYMENT_NOTICE = {
    "en": "This is a free demonstration. Its data may disappear whenever the server restarts.",
    "ko": "무료 시연 서비스예요. 서버가 다시 시작되면 데이터가 사라질 수 있어요."}
ROOM_ONLY = {"en": "Guided sessions play only on a room screen at your facility.",
             "ko": "가이드 세션은 시설의 룸 화면에서만 재생돼요."}
FACTS = {
    "first_workout": {"en": "You completed your first room workout.", "ko": "첫 룸 운동을 마쳤어요."},
    "visits": {"en": "You have completed {n} room visits.", "ko": "룸 방문을 {n}회 마쳤어요."},
    "first_course_session": {"en": "You completed your first course session.", "ko": "첫 코스 세션을 마쳤어요."},
    "course_completed": {"en": "You completed every session of {title}.", "ko": "{title}의 모든 세션을 마쳤어요."},
    "four_weeks": {"en": "You had a room visit in 4 weeks in a row.", "ko": "4주 연속으로 룸을 방문했어요."},
}
VISIT_MILESTONES = (5, 10, 25)


def lang(value) -> str:
    return value if value in LANGUAGES else "ko"


def _t(value, locale):
    return (value.get(locale) or value.get("en")) if isinstance(value, dict) else value


def customer(sedens, db, actor) -> dict:
    """The signed-in customer, about themself only: a student account of the organization
    the session belongs to. Staff, creators and reviewers are refused (the coaching
    workspace keeps its own access); no function here takes a customer id."""
    if actor is None or actor.role != "student" or db.execute(
            "SELECT 1 FROM p_users u JOIN p_students s ON s.id=u.id JOIN p_roles r ON r.user_id=u.id AND r.role='student' "
            "WHERE u.id=? AND u.org_id=? AND u.active=1", (actor.user_id, actor.org_id)).fetchone() is None:
        raise Denied("The Passport is for the signed-in customer only.", 403, "passport_customer_only")
    return {"user_id": actor.user_id, "org_id": actor.org_id}


def frame(sedens, db, actor, locale) -> dict:
    """What every response says about where the data lives: demonstration or not, and
    whether this deployment may lose it."""
    free = sedens.mode.name == modes.DEMO_FREE
    return {"demo": bool(sedens.org(db, actor.org_id)["demo"]),
            "deployment": {"mode": sedens.mode.name, "demo_free": free,
                           "notice": DEPLOYMENT_NOTICE[locale] if free else None}}


def _timezone(db, org_id):
    from zoneinfo import ZoneInfo

    row = db.execute("SELECT timezone FROM s_org_profiles WHERE org_id=?", (org_id,)).fetchone()
    try:
        return ZoneInfo(row[0]) if row else timezone.utc
    except Exception:  # an unknown zone name falls back to UTC
        return timezone.utc


def _monday(value, tz) -> date:
    day = parse(value).astimezone(tz).date()
    return day - timedelta(days=day.weekday())


# -- the records -----------------------------------------------------------------------


def _workouts(db, me) -> list[dict]:
    """Workout records, newest first: started workouts that ended. Drafts and replaced
    workouts never started; a running one is not a record yet."""
    return [dict(r) for r in db.execute(
        "SELECT * FROM s_workouts WHERE student_id=? AND org_id=? AND started_at IS NOT NULL "
        "AND state IN ('completed','stopped','abandoned') ORDER BY started_at DESC, rowid DESC",
        (me["user_id"], me["org_id"]))]


def _step_counts(db, me) -> dict:
    out: dict = {}
    for r in db.execute("SELECT st.workout_id, st.state, count(*) FROM s_workout_steps st "
                        "JOIN s_workouts w ON w.id=st.workout_id WHERE w.student_id=? AND w.org_id=? "
                        "GROUP BY st.workout_id, st.state", (me["user_id"], me["org_id"])):
        out.setdefault(r[0], {})[r[1]] = r[2]
    return out


def _feedback(db, me) -> dict:
    return {r["workout_id"]: dict(r) for r in db.execute(
        "SELECT * FROM s_session_feedback WHERE student_id=? AND org_id=?", (me["user_id"], me["org_id"]))}


# A workout that counts as done: it ended as completed and at least one of its steps was
# performed. A workout in which every step was skipped is still a record (its card says so)
# but is not counted as a completed visit or a first workout.
PERFORMED = ("w.state='completed' AND EXISTS "
             "(SELECT 1 FROM s_workout_steps st WHERE st.workout_id=w.id AND st.state='completed')")


def _visits(db, me) -> list[dict]:
    """Completed visits, oldest first."""
    return [dict(r) for r in db.execute(
        "SELECT s.id, s.started_at, s.origin FROM s_room_sessions s WHERE s.student_id=? AND s.org_id=? AND EXISTS "
        f"(SELECT 1 FROM s_workouts w WHERE w.room_session_id=s.id AND w.student_id=s.student_id AND {PERFORMED}) "
        "ORDER BY s.started_at, s.rowid", (me["user_id"], me["org_id"]))]


def _status(w) -> str:
    return {"completed": "completed", "stopped": "stopped"}.get(w["state"], "not_finished")


def _titles(w, plan, locale) -> tuple:
    """(title, focus) of a workout as played, from its frozen plan."""
    try:
        if w["kind"] == "standard":
            r = plans.rules(plan.get("rules_version") or plans.CURRENT)
            return _t(r["messages"]["label"], locale), _t(r["goals"][plan["goal"]]["label"], locale)
        return plan.get("course_title") or "", f"{plan.get('module_title', '')} · {plan.get('session_title', '')}".strip(" ·")
    except (KeyError, ValueError):
        return ("SEDENS Standard" if w["kind"] == "standard" else ""), ""


def _effort(row, locale):
    if row is None or row["effort"] is None:
        return None
    n = row["effort"]
    return {"value": n, "text": f"You rated it {n}/10" if locale == "en" else f"{n}/10으로 평가했어요"}


def _workout_card(w, counts, fb, locale) -> dict:
    plan = decode(w["plan"], {})
    title, focus = _titles(w, plan, locale)
    c = counts.get(w["id"], {})
    status = _status(w)
    return {
        "kind": "room", "id": w["id"], "date": w["started_at"], "sort": w["started_at"], "origin": w["origin"],
        "status": status, "status_label": STATUS[status][locale], "title": title, "focus": focus,
        "workout_kind": w["kind"],
        "course": {"course_id": w["course_id"], "version": w["course_version"]} if w["kind"] == "course" else None,
        "active_minutes": round(w["active_seconds"] / 60),
        "exercises_completed": c.get("completed", 0), "exercises_skipped": c.get("skipped", 0),
        "exercises_total": sum(c.values()),
        "effort": _effort(fb.get(w["id"]), locale),
        "ended_for_safety": bool(w["safety_category"]),
    }


def _studio(db, me) -> list[dict]:
    """Coach-recorded studio sessions: visits recorded in the coaching workspace, not by the room."""
    org_demo = bool(db.execute("SELECT demo FROM p_organizations WHERE id=?", (me["org_id"],)).fetchone()[0])
    out = []
    for r in db.execute(
            "SELECT ts.id, ts.performed_at, ts.completed, sr.name AS recorder, "
            "(SELECT count(*) FROM p_session_exercise_events e WHERE e.session_id=ts.id) AS events "
            "FROM p_training_sessions ts LEFT JOIN p_session_recorders sr ON sr.session_id=ts.id "
            "WHERE ts.student_id=? AND COALESCE(sr.role,'')<>'room' "
            "AND NOT EXISTS (SELECT 1 FROM s_workouts w WHERE w.training_session_id=ts.id) "
            "AND NOT EXISTS (SELECT 1 FROM s_room_journeys j WHERE j.training_session_id=ts.id) "
            "ORDER BY ts.performed_at DESC, ts.rowid DESC", (me["user_id"],)):
        out.append({"kind": "studio", "id": r["id"], "date": r["performed_at"], "sort": r["performed_at"],
                    "origin": "demo_seed" if org_demo else "studio", "recorder": r["recorder"],
                    "exercises_completed": r["events"] or len(decode(r["completed"], []))})
    return out


def _cards(db, me, locale) -> list[dict]:
    counts, fb = _step_counts(db, me), _feedback(db, me)
    cards = [_workout_card(w, counts, fb, locale) for w in _workouts(db, me)] + _studio(db, me)
    return sorted(cards, key=lambda c: (c["sort"] or "", c["id"]), reverse=True)


# -- history -----------------------------------------------------------------------------


def history(sedens, db, actor, locale, before=None, limit=20) -> dict:
    me = customer(sedens, db, actor)
    if not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= 50:
        raise Denied("Choose a number of items from 1 to 50.", 400, "invalid")
    cards = _cards(db, me, locale)
    if before:
        stamp, _, ident = str(before).partition("|")
        cards = [c for c in cards if ((c["sort"] or ""), c["id"]) < (stamp, ident)]
    page, rest = cards[:limit], cards[limit:]
    for c in page:
        c.pop("sort")
    last = page[-1] if page else None
    return {**frame(sedens, db, actor, locale), "items": page,
            "next_before": f"{last['date'] or ''}|{last['id']}" if last and rest else None}


# -- one workout -------------------------------------------------------------------------


def _step_title(w, plan, row, locale) -> str:
    if w["kind"] == "standard":
        entry = next((e for e in standard.exercises() if e["catalog_key"] == row["exercise_ref"]), None) \
            or standard.get(row["step_ref"])
        return _t(entry["title"], locale) if entry else ""
    frozen = next((s for s in plan.get("steps", []) if s.get("id") == row["step_ref"]), {})
    ex = frozen.get("exercise") or {}
    return frozen.get("title") or _t(ex.get("title") or {}, locale) or ""


def workout(sedens, db, actor, locale, workout_id) -> dict:
    me = customer(sedens, db, actor)
    w = db.execute("SELECT * FROM s_workouts WHERE id=? AND student_id=? AND org_id=? AND started_at IS NOT NULL "
                   "AND state IN ('completed','stopped','abandoned')", (workout_id, me["user_id"], me["org_id"])).fetchone() \
        if isinstance(workout_id, str) and workout_id else None
    if w is None:
        raise Denied("That workout was not found.", 404, "unknown_workout")
    w = dict(w)
    plan = decode(w["plan"], {})
    card = _workout_card(w, _step_counts(db, me), _feedback(db, me), locale)
    card.pop("sort")
    steps = [{"position": r["position"], "phase": r["phase"], "title": _step_title(w, plan, r, locale),
              "state": r["state"], "variant": r["variant"], "planned_seconds": r["planned_seconds"],
              "finished_at": r["finished_at"]}
             for r in db.execute("SELECT * FROM s_workout_steps WHERE workout_id=? ORDER BY position", (w["id"],))]
    where = {"facility": sedens.org(db, me["org_id"])["display_name"], "location": None, "room": None}
    visit = db.execute("SELECT s.started_at, s.origin, l.name AS location, r.name AS room FROM s_room_sessions s "
                       "LEFT JOIN p_locations l ON l.id=s.location_id LEFT JOIN p_rooms r ON r.id=s.room_id "
                       "WHERE s.id=? AND s.student_id=? AND s.org_id=?",
                       (w["room_session_id"], me["user_id"], me["org_id"])).fetchone() if w["room_session_id"] else None
    if visit is not None:
        where.update(location=visit["location"], room=visit["room"])
    given = _feedback(db, me).get(w["id"])
    feedback_part = None
    if given is not None:
        # The customer's own answers, shown to them on their own workout only.
        feedback_part = {
            "effort": _effort(given, locale), "discomfort": given["discomfort"],
            "discomfort_urgent": None if given["discomfort_urgent"] is None else bool(given["discomfort_urgent"]),
            "regions": decode(given["discomfort_regions"], []), "when": given["discomfort_when"],
            "discomfort_level": given["discomfort_strength"],
            "still_present": None if given["discomfort_still"] is None else bool(given["discomfort_still"]),
            "note": given["note"], "submitted_at": given["submitted_at"]}
    scan = None
    if w["room_session_id"]:
        row = db.execute("SELECT id, completed_at, origin, source, reliability FROM s_room_scans WHERE room_session_id=? "
                         "AND student_id=? AND org_id=? AND state='complete' ORDER BY completed_at DESC, rowid DESC LIMIT 1",
                         (w["room_session_id"], me["user_id"], me["org_id"])).fetchone()
        scan = dict(row) if row else None
    detail = {**card, "visit_date": visit["started_at"] if visit else w["started_at"], "ended_at": w["ended_at"],
              "where": where, "planned_minutes": round(w["planned_seconds"] / 60), "steps": steps,
              "feedback": feedback_part, "scan": scan}
    if w["kind"] == "course":
        detail["course"] = {"course_id": w["course_id"], "version": w["course_version"],
                            "title": plan.get("course_title"), "module_title": plan.get("module_title"),
                            "session_title": plan.get("session_title")}
    return {**frame(sedens, db, actor, locale), "workout": detail}


# -- scans -------------------------------------------------------------------------------


def _scan_rows(db, me) -> list[dict]:
    """The customer's finished scans, oldest first."""
    return [dict(r) for r in db.execute(
        "SELECT * FROM s_room_scans WHERE student_id=? AND org_id=? AND state='complete' "
        "ORDER BY completed_at, rowid", (me["user_id"], me["org_id"]))]


def scans(sedens, db, actor, locale) -> dict:
    me = customer(sedens, db, actor)
    rows = _scan_rows(db, me)
    items = []
    for i, scan in enumerate(rows):
        shown = decode(scan["summary"], {}).get("shown", {}).get(locale) or {}
        before = rows[i - 1] if i else None
        ok, reasons = scan_history.comparable(before, scan) if before else (False, [])
        items.append({
            "id": scan["id"], "date": scan["completed_at"], "origin": scan["origin"], "source": scan["source"],
            "label": shown.get("label"), "reliability": scan["reliability"],
            "measurement_version": scan["measurement_version"], "feedback_rules_version": scan["feedback_rules_version"],
            "photos_kept": bool(scan["images_retained"]), "summary": shown,
            "previous": None if before is None else {
                "id": before["id"], "comparable": ok,
                "reasons": [{"code": c, "text": scan_history.REASONS[c][locale]} for c in reasons]}})
    return {**frame(sedens, db, actor, locale), "items": list(reversed(items))}


def scan_comparison(sedens, db, actor, locale, earlier=None, later=None) -> dict:
    me = customer(sedens, db, actor)
    rows = _scan_rows(db, me)
    by_id = {r["id"]: r for r in rows}
    if earlier or later:
        if earlier not in by_id or later not in by_id:
            raise scan_history.refuse_unknown()
        if earlier == later:
            raise Denied("Choose two different scans to compare.", 400, "invalid")
        pair = sorted((by_id[earlier], by_id[later]), key=lambda r: (r["completed_at"] or "", r["id"]))
    elif len(rows) >= 2:
        pair = rows[-2:]
    else:
        return {**frame(sedens, db, actor, locale), "comparison": {
            "comparable": False, "message": scan_history.NOT_ENOUGH[locale], "reasons": []}}
    return {**frame(sedens, db, actor, locale), "comparison": scan_history.compare(pair[0], pair[1], locale)}


# -- courses -----------------------------------------------------------------------------


def _entitlement(sedens, db, me, e, course) -> tuple[dict | None, str]:
    """The entitlement to show for an enrollment, and whether it still stands. The same
    test as playback (:func:`access.entitlements`): a stored row that is not revoked can
    still have ended, for instance when the facility stopped offering the course or a
    demonstration purchase was refunded. A standing entitlement is preferred, the
    enrollment's own first. Status: ``active``, ``revoked`` (revoked_at set), ``ended``
    (the row exists but no longer stands) or ``none``."""
    standing = {s["id"] for s in access.entitlements(sedens, db, me["user_id"], course)}
    own = db.execute("SELECT * FROM s_entitlements WHERE id=? AND user_id=?", (e["entitlement_id"], me["user_id"])).fetchone() \
        if e["entitlement_id"] else None
    if own is not None and own["id"] in standing:
        return dict(own), "active"
    rows = [dict(r) for r in db.execute("SELECT * FROM s_entitlements WHERE user_id=? AND course_id=? "
                                        "ORDER BY granted_at DESC, rowid DESC", (me["user_id"], e["course_id"]))]
    for row in rows:
        if row["id"] in standing:
            return row, "active"
    row = dict(own) if own is not None else (rows[0] if rows else None)
    if row is None:
        return None, "none"
    return row, "revoked" if row["revoked_at"] else "ended"


def _cover(sedens, db, actor, course) -> str | None:
    """A URL only when the course's published cover is already readable by this customer."""
    if not course["cover_media_id"]:
        return None
    try:
        access.media_access(sedens, db, actor, None, course["cover_media_id"])
    except Denied:
        return None
    return f"/sedens/media/file?id={course['cover_media_id']}"


def programs(sedens, db, actor, locale) -> dict:
    me = customer(sedens, db, actor)
    items = []
    for e in db.execute("SELECT * FROM s_enrollments WHERE user_id=? AND org_id=? ORDER BY enrolled_at DESC, rowid DESC",
                        (me["user_id"], me["org_id"])).fetchall():
        course = db.execute("SELECT * FROM s_courses WHERE id=?", (e["course_id"],)).fetchone()
        if course is None:
            continue
        number = access.effective_version(db, course, e)
        snapshot = marketplace._snapshot(db, course["id"], number) if number else {}
        meta = snapshot.get("course") or {}
        found = next_session(db, course, e) if number else None
        sessions = {s["id"]: (m["title"], s) for m in snapshot.get("modules", []) for s in m.get("sessions", [])}
        entitlement, status = _entitlement(sedens, db, me, e, course)
        source = entitlement["source"] if entitlement else None
        creator = db.execute("SELECT display_name, verification_state FROM s_creator_profiles WHERE id=?",
                             (course["creator_id"],)).fetchone()
        history_rows = []
        for p in db.execute("SELECT * FROM s_course_progress WHERE enrollment_id=? AND item_kind='session' "
                            "ORDER BY completed_at, rowid", (e["id"],)):
            module_title, session = sessions.get(p["item_id"], (None, {}))
            played = db.execute("SELECT id FROM s_workouts WHERE student_id=? AND org_id=? AND course_id=? "
                                "AND course_session_id=? AND state='completed' ORDER BY ended_at DESC, rowid DESC",
                                (me["user_id"], me["org_id"], course["id"], p["item_id"])).fetchone()
            history_rows.append({"session_id": p["item_id"], "title": session.get("title"), "module_title": module_title,
                                 "completed_at": p["completed_at"], "workout_id": played[0] if played else None})
        progress = marketplace.progress(db, e, snapshot, number) if number else None
        done = found["done"] if found else 0
        total = found["total"] if found else 0
        eligible = status == "active" and access.published(course) and bool(found and found["next"])
        items.append({
            "course_id": course["id"], "title": meta.get("title") or course["title"], "course_type": course["course_type"],
            "cover_url": _cover(sedens, db, actor, course),
            "creator": {"display_name": creator["display_name"], "verification_state": creator["verification_state"],
                        "verified": creator["verification_state"] == "verified"} if creator else None,
            "origin": {"code": source, "label": ORIGINS[source][locale]} if source else None,
            "entitlement": {"status": status, "label": ENTITLEMENT[status][locale], "source": source,
                            "granted_at": entitlement["granted_at"] if entitlement else None},
            "weeks": meta.get("weeks"), "sessions_per_week": meta.get("sessions_per_week"),
            "pinned_version": number, "enrolled_version": e["version"], "enrolled_at": e["enrolled_at"],
            "completed_at": e["completed_at"], "available": access.published(course),
            "sessions": {"done": done, "total": total, "remaining": max(0, total - done)},
            "items": {"done": progress["completed_items"], "total": progress["total_items"]} if progress else None,
            "last_completed": history_rows[-1] if history_rows else None,
            "next_session": found["next"] if found else None, "next_eligible": eligible,
            "offered_at_facility": access.enabled_at(sedens, db, course, me["org_id"]) is not None,
            "history": history_rows,
            "room_only": ROOM_ONLY[locale],
        })
    return {**frame(sedens, db, actor, locale), "items": items}


# -- achievements ------------------------------------------------------------------------


def _weeks(visits, tz) -> list[date]:
    return sorted({_monday(v["started_at"], tz) for v in visits})


def _four_in_a_row(visits, tz):
    """The first visit of the fourth week of the earliest run of 4 consecutive weeks."""
    weeks = _weeks(visits, tz)
    for i in range(len(weeks) - 3):
        if all(weeks[i + k + 1] - weeks[i + k] == timedelta(days=7) for k in range(3)):
            return next(v for v in visits if _monday(v["started_at"], tz) == weeks[i + 3])
    return None


def achievements(sedens, db, actor, locale) -> dict:
    me = customer(sedens, db, actor)
    tz = _timezone(db, me["org_id"])
    visits = _visits(db, me)
    found = []
    first = db.execute("SELECT w.ended_at, w.origin FROM s_workouts w WHERE w.student_id=? AND w.org_id=? AND "
                       f"{PERFORMED} ORDER BY w.ended_at, w.rowid LIMIT 1", (me["user_id"], me["org_id"])).fetchone()
    if first:
        found.append({"id": "first_workout", "date": first["ended_at"], "origin": first["origin"],
                      "fact": FACTS["first_workout"][locale]})
    for n in VISIT_MILESTONES:
        if len(visits) >= n:
            found.append({"id": f"visits_{n}", "date": visits[n - 1]["started_at"], "origin": visits[n - 1]["origin"],
                          "fact": FACTS["visits"][locale].format(n=n)})
    session = db.execute("SELECT p.completed_at, p.item_id, e.course_id FROM s_course_progress p JOIN s_enrollments e "
                         "ON e.id=p.enrollment_id WHERE e.user_id=? AND e.org_id=? AND p.item_kind='session' "
                         "AND EXISTS (SELECT 1 FROM s_workouts w WHERE w.student_id=e.user_id AND w.org_id=e.org_id "
                         f"AND w.course_id=e.course_id AND w.course_session_id=p.item_id AND {PERFORMED}) "
                         "ORDER BY p.completed_at, p.rowid LIMIT 1", (me["user_id"], me["org_id"])).fetchone()
    if session:
        played = db.execute("SELECT origin FROM s_workouts WHERE student_id=? AND org_id=? AND course_id=? "
                            "AND course_session_id=? AND state='completed' ORDER BY ended_at LIMIT 1",
                            (me["user_id"], me["org_id"], session["course_id"], session["item_id"])).fetchone()
        found.append({"id": "first_course_session", "date": session["completed_at"],
                      "origin": played["origin"] if played else "room", "fact": FACTS["first_course_session"][locale]})
    for e in db.execute("SELECT e.*, c.title FROM s_enrollments e JOIN s_courses c ON c.id=e.course_id WHERE e.user_id=? "
                        "AND e.org_id=? AND e.completed_at IS NOT NULL ORDER BY e.completed_at", (me["user_id"], me["org_id"])):
        played = db.execute("SELECT w.origin FROM s_workouts w WHERE w.student_id=? AND w.org_id=? AND w.course_id=? "
                            f"AND {PERFORMED} ORDER BY w.ended_at DESC, w.rowid DESC LIMIT 1",
                            (me["user_id"], me["org_id"], e["course_id"])).fetchone()
        found.append({"id": "course_completed", "course_id": e["course_id"], "date": e["completed_at"],
                      "origin": played["origin"] if played else "room",
                      "fact": FACTS["course_completed"][locale].format(title=e["title"])})
    run = _four_in_a_row(visits, tz)
    if run:
        found.append({"id": "four_weeks", "date": run["started_at"], "origin": run["origin"],
                      "fact": FACTS["four_weeks"][locale]})
    return {**frame(sedens, db, actor, locale), "items": sorted(found, key=lambda a: a["date"] or "")}


# -- overview ----------------------------------------------------------------------------


def _categories(db, me, locale) -> list[dict]:
    by_key = {e["catalog_key"]: e for e in standard.exercises()}
    counts: dict = {}
    for r in db.execute("SELECT st.step_ref, st.exercise_ref FROM s_workout_steps st JOIN s_workouts w ON w.id=st.workout_id "
                        "WHERE w.student_id=? AND w.org_id=? AND w.kind='standard' AND st.state='completed'",
                        (me["user_id"], me["org_id"])):
        entry = by_key.get(r["exercise_ref"]) or standard.get(r["step_ref"])
        for category in (entry or {}).get("categories", []):
            counts[category] = counts.get(category, 0) + 1
    return [{"id": c, "label": CATEGORIES.get(c, {}).get(locale, c), "completed": n}
            for c, n in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))]


def consistency(db, me, visits) -> dict:
    tz = _timezone(db, me["org_id"])
    this_week = _monday(utcnow().isoformat(), tz)
    starts = [this_week - timedelta(days=7 * k) for k in range(WEEKS - 1, -1, -1)]
    visited = set(_weeks(visits, tz))
    weeks = [{"week_start": d.isoformat(), "visited": d in visited} for d in starts]
    return {"weeks_with_visit": sum(w["visited"] for w in weeks), "of": WEEKS, "weeks": weeks}


def overview(sedens, db, actor, locale) -> dict:
    me = customer(sedens, db, actor)
    workouts = _workouts(db, me)
    visits = _visits(db, me)
    cards = _cards(db, me, locale)
    for c in cards:
        c.pop("sort")
    mine = programs(sedens, db, actor, locale)["items"]
    live = [p for p in mine if p["next_eligible"]]
    # The programme being followed: the one most recently worked on.
    current = max(live, key=lambda p: ((p["last_completed"] or {}).get("completed_at") or p["enrolled_at"]), default=None)
    scan_rows = _scan_rows(db, me)
    comparable_pair = len(scan_rows) >= 2 and scan_history.comparable(scan_rows[-2], scan_rows[-1])[0]
    last_effort = db.execute("SELECT f.workout_id, f.effort, f.submitted_at FROM s_session_feedback f WHERE f.student_id=? "
                             "AND f.org_id=? AND f.effort IS NOT NULL ORDER BY f.submitted_at DESC, f.rowid DESC LIMIT 1",
                             (me["user_id"], me["org_id"])).fetchone()
    studio = [c for c in cards if c["kind"] == "studio"]
    states = [_status(w) for w in workouts]
    totals = {
        "completed_visits": len(visits),
        # The visits performed in a room, without the fictional history a demonstration was seeded with.
        "room_visits": sum(v["origin"] == "room" for v in visits),
        "workouts": {s: states.count(s) for s in ("completed", "stopped", "not_finished")},
        "active_minutes": round(sum(w["active_seconds"] for w in workouts) / 60),
        "studio_sessions": len(studio),
        "demo_seed": {"visits": sum(v["origin"] == "demo_seed" for v in visits),
                      "workouts": sum(w["origin"] == "demo_seed" for w in workouts),
                      "scans": sum(s["origin"] == "demo_seed" for s in scan_rows),
                      "studio_sessions": sum(c["origin"] == "demo_seed" for c in studio)},
    }
    return {
        **frame(sedens, db, actor, locale),
        "totals": totals,
        "latest_workout": next((c for c in cards if c["kind"] == "room"), None),
        "recent": cards[:3],
        "consistency": consistency(db, me, visits),
        "categories": _categories(db, me, locale),
        "current_program": current,
        "next_session": None if current is None else {"course_id": current["course_id"], "title": current["title"],
                                                      "pinned_version": current["pinned_version"],
                                                      **current["next_session"], "room_only": ROOM_ONLY[locale]},
        "scans": {"complete": len(scan_rows), "latest": None if not scan_rows else {
            "id": scan_rows[-1]["id"], "date": scan_rows[-1]["completed_at"], "origin": scan_rows[-1]["origin"]},
                  "comparable_pair": comparable_pair,
                  "photos_kept": sum(bool(s["images_retained"]) for s in scan_rows)},
        "last_effort": None if last_effort is None else {
            "workout_id": last_effort["workout_id"], "date": last_effort["submitted_at"],
            **_effort({"effort": last_effort["effort"]}, locale)},
        "courses": [{"course_id": p["course_id"], "title": p["title"], "sessions": p["sessions"],
                     "completed_at": p["completed_at"]} for p in mine],
    }
