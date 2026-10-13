"""The room journey: what the customer is doing inside an authorized room.

The server owns the state. The screen shows what :func:`view` returns and asks for
transitions; anything not in :data:`TRANSITIONS`, asked from a stale state, or
missing its precondition (a ready readiness check before the scan, capture consent
before the camera, an accepted plan before training...) is refused. A refresh
reads the same state back, so a workout never restarts from the beginning.

Authorization is unchanged: every call first passes ``rooms.authorize`` (outside
any transaction, so an expiry is written), then works inside ``sedens.batch()``,
re-checking that the room session is still active.

States (brief §4): identified → readiness → (readiness_blocked | scan_intro) →
scan_front → scan_left → scan_back → scan_right → scan_processing → scan_result →
session_choice → (session_setup → recommendation →) ready_to_train → exercise ⇄
exercise_paused → session_complete → ended. ``waiting`` is the entry screen
before anyone is identified, so it has no journey row.
"""

from __future__ import annotations

from . import analytics, consent, readiness
from .util import Denied, now

STATES = (
    "identified", "readiness", "readiness_blocked",
    "scan_intro", "scan_front", "scan_left", "scan_back", "scan_right", "scan_processing", "scan_result",
    "session_choice", "session_setup", "recommendation", "ready_to_train",
    "exercise", "exercise_paused", "session_complete", "ended",
)
SCAN_VIEWS = ("front", "left", "back", "right")
_SCAN = {f"scan_{v}" for v in SCAN_VIEWS}
_LEAVE_SCAN = {"scan_intro", "session_choice", "ended"}
TRANSITIONS = {
    "identified": {"readiness", "ended"},
    "readiness": {"readiness_blocked", "scan_intro", "ended"},
    "readiness_blocked": {"ended"},
    "scan_intro": {"scan_front", "session_choice", "ended"},
    "scan_front": {"scan_left"} | _LEAVE_SCAN,
    "scan_left": {"scan_back", "scan_front"} | _LEAVE_SCAN,
    "scan_back": {"scan_right", "scan_left"} | _LEAVE_SCAN,
    "scan_right": {"scan_processing", "scan_back"} | _LEAVE_SCAN,
    "scan_processing": {"scan_result"} | _LEAVE_SCAN,
    "scan_result": {"session_choice", "scan_intro", "ended"},
    "session_choice": {"session_setup", "ready_to_train", "ended"},
    "session_setup": {"recommendation", "session_choice", "ended"},
    "recommendation": {"ready_to_train", "session_setup", "session_choice", "ended"},
    "ready_to_train": {"exercise", "session_choice", "session_complete", "ended"},
    "exercise": {"exercise", "exercise_paused", "session_complete", "ended"},
    "exercise_paused": {"exercise", "session_complete", "ended"},
    "session_complete": {"session_choice", "ended"},
    "ended": set(),
}
TRAINING = {"ready_to_train", "exercise", "exercise_paused"}


def _event(db, ctx, name, **props):
    analytics.record(db, name, org_id=ctx.org_id, user_id=ctx.student_id, room_id=ctx.room_id,
                     device_id=ctx.device_id, room_session_id=ctx.room_session_id, demo=ctx.demo, props=props)


def require_live(db, ctx) -> None:
    """Inside the transaction: the room session is still the active one."""
    row = db.execute("SELECT state, student_id FROM s_room_sessions WHERE id=?", (ctx.room_session_id,)).fetchone()
    if row is None or row["state"] != "active" or row["student_id"] != ctx.student_id:
        raise Denied("This room session has ended.", 401, "room_session_ended")


def get(db, ctx) -> dict | None:
    found = db.execute("SELECT * FROM s_room_journeys WHERE room_session_id=?", (ctx.room_session_id,)).fetchone()
    return dict(found) if found else None


def ensure(db, ctx, *, booking=None) -> dict:
    """This visit's journey, created at ``identified`` on first use. Earlier
    journeys of the same customer whose room session is no longer active are
    closed first (their unfinished workout is saved as incomplete)."""
    found = get(db, ctx)
    if found is not None:
        return found
    _close_stale(db, ctx.student_id)
    stamp = now()
    db.execute("INSERT INTO s_room_journeys(room_session_id,org_id,student_id,state,booking_starts_at,booking_ends_at,"
               "created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
               (ctx.room_session_id, ctx.org_id, ctx.student_id, "identified",
                (booking or {}).get("starts_at"), (booking or {}).get("ends_at"), stamp, stamp))
    return get(db, ctx)


def _close_stale(db, student_id) -> None:
    for row in db.execute(
            "SELECT j.room_session_id FROM s_room_journeys j JOIN s_room_sessions s ON s.id=j.room_session_id "
            "WHERE j.student_id=? AND j.state<>'ended' AND s.state<>'active'", (student_id,)).fetchall():
        close(db, row["room_session_id"], "room_session_closed")


def close(db, room_session_id, reason) -> None:
    """End a visit's journey. Each later module closes what it holds first (an
    open workout is kept as incomplete, a scan still capturing is abandoned)."""
    for hook in CLOSE_HOOKS:
        hook(db, room_session_id, reason)
    db.execute("UPDATE s_room_journeys SET state='ended', revision=revision+1, updated_at=?, ended_at=?, end_reason=? "
               "WHERE room_session_id=? AND state<>'ended'", (now(), now(), reason, room_session_id))


def move(db, journey, to, *, expect=None, **fields) -> dict:
    """Apply one transition. ``expect`` is the state the screen believed it was in."""
    if expect is not None and expect != journey["state"]:
        raise Denied("The room moved on in another window. Showing the current step.", 409, "journey_changed")
    if to not in TRANSITIONS[journey["state"]]:
        raise Denied("That step is not available now.", 409, "invalid_transition")
    sets = ["state=?", "revision=revision+1", "updated_at=?"]
    args = [to, now()]
    for key, value in fields.items():
        if key not in ("path", "scan_skipped", "end_reason"):
            raise ValueError(key)
        sets.append(f"{key}=?")
        args.append(value)
    if to == "ended":
        sets.append("ended_at=?")
        args.append(now())
    changed = db.execute(f"UPDATE s_room_journeys SET {', '.join(sets)} WHERE room_session_id=? AND state=? "
                         f"AND revision=?", (*args, journey["room_session_id"], journey["state"],
                                             journey["revision"])).rowcount
    if not changed:
        raise Denied("The room moved on in another window. Showing the current step.", 409, "journey_changed")
    return dict(db.execute("SELECT * FROM s_room_journeys WHERE room_session_id=?",
                           (journey["room_session_id"],)).fetchone())


def require(journey, *states) -> None:
    if journey["state"] not in states:
        raise Denied("That step is not available now.", 409, "invalid_transition")


# -- actions (each runs inside sedens.batch(), after rooms.authorize) ---------------------


def start_readiness(sedens, db, ctx, journey, data):
    journey = move(db, journey, "readiness", expect=data.get("expect"))
    readiness.start(db, org_id=ctx.org_id, student_id=ctx.student_id, room_session_id=ctx.room_session_id,
                    locale=data.get("lang"))
    _event(db, ctx, "readiness_started", version=readiness.CURRENT)
    return journey


def answer_readiness(sedens, db, ctx, journey, data):
    require(journey, "readiness")
    check = readiness.latest(db, ctx.room_session_id)
    if check is None:
        raise Denied("Start the readiness check first.", 409, "invalid_transition")
    result = readiness.answer(db, check, data.get("item"), data.get("answer"), data.get("follow_up"))
    outcome = result.get("outcome")
    if outcome == "ready":
        _event(db, ctx, "readiness_completed", outcome="ready", version=check["questionnaire_version"])
        return move(db, journey, "scan_intro")
    if outcome in ("do_not_start", "urgent_help"):
        _event(db, ctx, "readiness_blocked", outcome=outcome, item=result["triggered_item"],
               version=check["questionnaire_version"])
        return move(db, journey, "readiness_blocked")
    return journey


def ready(db, ctx) -> bool:
    """Whether this visit's readiness check ended ``ready`` (needed for every later step)."""
    check = readiness.latest(db, ctx.room_session_id)
    return bool(check and check["outcome"] == "ready")


def require_ready(db, ctx) -> None:
    if not ready(db, ctx):
        raise Denied("Complete the readiness check first.", 409, "readiness_required")


def end_visit(sedens, db, ctx, journey, data):
    """The customer ends the visit (the HTTP route then ends the room session)."""
    close(db, ctx.room_session_id, "visit_ended")
    return get(db, ctx)


ACTIONS = {
    "readiness/start": start_readiness,
    "readiness/answer": answer_readiness,
    "end": end_visit,
}
# Later modules (scans, plans, workouts) plug in their actions, the part of the
# screen they own, and what to close when a visit ends.
VIEW_PARTS: list = []
CLOSE_HOOKS: list = []


def register(actions: dict, *, view_part=None, on_close=None) -> None:
    for name, fn in actions.items():
        if name in ACTIONS:
            raise ValueError(f"duplicate journey action {name}")
        ACTIONS[name] = fn
    if view_part is not None:
        VIEW_PARTS.append(view_part)
    if on_close is not None:
        CLOSE_HOOKS.append(on_close)


# -- what the screen shows ----------------------------------------------------------------


def view(sedens, db, ctx, journey, locale) -> dict:
    """Everything the room screen needs for the current state, in the customer's
    language. No technical identifiers beyond what the screen needs to call back."""
    locale = locale if locale in ("en", "ko") else "ko"
    state = journey["state"]
    out = {"state": state, "revision": journey["revision"], "path": journey["path"],
           "scan_skipped": bool(journey["scan_skipped"]), "views": list(SCAN_VIEWS)}
    if state == "identified":
        out["welcome"] = welcome(sedens, db, ctx, journey)
    check = readiness.latest(db, ctx.room_session_id)
    if check is not None and state in ("readiness", "readiness_blocked"):
        out["readiness"] = readiness.progress(db, check, locale)
    if state == "scan_intro":
        out["consent"] = {"texts": {k: {"version": v["version"], "text": v.get(locale) or v["en"]}
                                    for k, v in consent.TEXTS.items()},
                          "current": consent.current(db, ctx.student_id)}
    for part in VIEW_PARTS:
        out.update(part(sedens, db, ctx, journey, locale))
    if state in TRAINING or state == "session_complete":
        out["stop_card"] = readiness.stop_card(locale)
        out["unwell"] = readiness.unwell_copy(locale)
    return out


def welcome(sedens, db, ctx, journey) -> dict:
    """The identified screen: who, which room, booking, a short Passport summary and
    the courses this customer can continue here. Nothing more private."""
    from . import passport

    return {"booking": {"starts_at": journey["booking_starts_at"], "ends_at": journey["booking_ends_at"]}
            if journey["booking_ends_at"] else None,
            "passport": passport.summary(db, ctx.student_id),
            "courses": passport.active_courses(sedens, db, ctx)}
