"""The demonstration customer's history: a modest, believable past, clearly marked "Demo data".

The room demo signs in as the first demonstration member (DEMO-1001, a student of the
demonstration facility). So that the Fitness Passport and the room welcome have something to
show, and so that "why would I come back to this room next week" is easy to see, this layer
seeds, once per demonstration, the history a customer who has visited about weekly for six
weeks would have:

* six earlier room visits, one a week, each with one workout of what the room really writes
  (a ``s_workouts`` row with its steps, a few of them skipped, a ``s_session_feedback`` row with
  the customer's own effort rating, and the matching ``p_training_sessions`` /
  ``p_session_exercise_events`` rows the coaching workspace shares);
* three programs the customer is following, each created by the real functions: "SEDENS
  Standard: Foundations" and the coach's "4-Week Core Foundations" (both free for the
  facility's members), and the fictional professor's "Mobility Foundations", bought through the
  demonstration checkout (a simulated purchase: no payment exists). Every program has sessions
  left, so the next visit continues it;
* two precomputed demonstration scans four weeks apart under the same protocol, versions and
  wording rules, both clear, with a small difference between them that is not framed as better
  or worse.

What this is not: nothing here invents a dramatic posture change, weight loss, strength gain or
health benefit. Efforts are the middling 4 to 6, the difference between the scans is far below the
measurement's own variation, and course sessions last as long as the course says they do.

Everything seeded has ``origin='demo_seed'`` (visits, workouts, scans), so the Passport labels it
"Demo data" and the facility usage meter never counts it. No analytics event is written for it
(``s_events`` is product analytics of what actually happened in a room). The rows the Passport
shows with a date and that real functions stamp with the time of seeding (enrollment, entitlement,
purchase) are moved to the day they belong to. The audit log is not: it records when the seed
actually ran. The seeded scans carry ``measurement_version='demo'``, as the room's own demo scan
does: the numbers are made up and are never presented as coming from the measurement code.

Known gap, on purpose: the seed writes no camera consent, readiness check or recommendation rows.
Seeding a consent would skip the consent step the live demo is meant to show, so a fresh demo
shows two stored scans with no consent record, and the seeded personalized workouts have
``recommendation_id`` NULL. The first real visit asks for consent as usual
(``tests/test_sedens_demo_history.py`` pins this).

The layer is versioned like :mod:`demo_marketplace`: a higher ``LAYER_VERSION`` replaces the
seeded rows (only the ``demo_seed`` ones; nothing a visitor did in the room is touched).
"""

from __future__ import annotations

from datetime import timedelta
from types import SimpleNamespace
from zoneinfo import ZoneInfo

from ..platform.repository import Actor
from . import access, demo_marketplace, marketplace, plans, scans, standard, workouts
from .util import decode, digest, encode, iso, uid, utcnow

LAYER, LAYER_VERSION = "history", 1
LABEL = "Demo data · 데모 데이터"
SEOUL = ZoneInfo("Asia/Seoul")
SCAN_NOTE = "Demo data"

# One visit a week, oldest first. ``days_ago`` is a multiple of seven, so every visit falls in its
# own calendar week; ``at`` is the local (Asia/Seoul) time of day the customer came in. ``skip`` are
# the positions of steps the customer skipped; ``active`` is the exercise time in seconds. A
# personalized workout is the room's 30 minute plan; a course session lasts about as long as the
# course says (its steps are a few minutes), so those visits are short.
VISITS = (
    {"days_ago": 41, "at": (7, 40), "plan": ("mobility", "light"), "active": 1320, "skip": (5, 11), "effort": 4,
     "scan": 0},
    {"days_ago": 34, "at": (19, 15), "course": "standard", "session": 0, "active": 330, "skip": (), "effort": 5},
    {"days_ago": 27, "at": (12, 30), "plan": ("pilates", "light"), "active": 1500, "skip": (9,), "effort": 5,
     "discomfort": True},
    {"days_ago": 20, "at": (18, 50), "course": "coach", "session": 0, "active": 250, "skip": (), "effort": 6},
    {"days_ago": 13, "at": (7, 55), "course": "professor", "session": 0, "active": 220, "skip": (), "effort": 5,
     "scan": 1},
    {"days_ago": 6, "at": (19, 30), "course": "standard", "session": 1, "active": 290, "skip": (2,), "effort": 4},
)
# The professor's course is bought on the phone the evening before its first room visit.
PURCHASE = {"days_ago": 14, "at": (21, 5)}
# Two fictional measurements, each a few tenths of a degree from data/sedens_demo_scan.v1.json.
# The shoulder-line difference (+0.15 deg on the mean of the front and back views) is a twentieth
# of the measurement's own variation (2.7 deg) and is never described as an improvement.
SCAN_VALUES = (
    {"front": {"shoulder_tilt": -3.2, "pelvic_obliquity": 0.8, "head_lateral_tilt": -0.5, "trunk_lean_lateral": 0.4},
     "back": {"shoulder_tilt": -2.9, "pelvic_obliquity": 0.6, "trunk_lean_lateral": 0.3},
     "left": {"forward_head": 0.04}, "right": {"forward_head": 0.05}},
    {"front": {"shoulder_tilt": -3.0, "pelvic_obliquity": 0.7, "head_lateral_tilt": -0.6, "trunk_lean_lateral": 0.3},
     "back": {"shoulder_tilt": -2.8, "pelvic_obliquity": 0.6, "trunk_lean_lateral": 0.3},
     "left": {"forward_head": 0.05}, "right": {"forward_head": 0.05}},
)


def _moment(base, days_ago, at, *, minutes=0, seconds=0):
    local = (base.astimezone(SEOUL) - timedelta(days=days_ago)).replace(hour=at[0], minute=at[1], second=0,
                                                                         microsecond=0)
    return local + timedelta(minutes=minutes, seconds=seconds)


def _layer_current(db, org_id) -> bool:
    return db.execute("SELECT 1 FROM s_demo_layers WHERE org_id=? AND layer=? AND version>=?",
                      (org_id, LAYER, LAYER_VERSION)).fetchone() is not None


def _programs(db, org_id) -> dict:
    n = demo_marketplace.ids(org_id)
    where = {"standard": ("SEDENS Standard: Foundations", n["sedens_org"]),
             "coach": ("4-Week Core Foundations", org_id),
             "professor": ("Mobility Foundations", n["studio_org"])}
    found = {}
    for key, (title, owner) in where.items():
        row = db.execute("SELECT * FROM s_courses WHERE title=? AND owner_org_id=? AND published_version IS NOT NULL "
                         "AND suspended_at IS NULL AND archived_at IS NULL", (title, owner)).fetchone()
        if row is None:
            return {}
        found[key] = row
    return found


def ensure(sedens, org_id, *, customer_id, room_id) -> None:
    """Seed once per demonstration (inside ``demo.ensure``'s batch), after the marketplace layer."""
    with sedens.db() as db:
        if not (sedens.org(db, org_id) or {}).get("demo"):
            raise ValueError("SEDENS demonstration data belongs only in demonstration organizations")
        if _layer_current(db, org_id):
            return
        # The demonstration is editable: a customer, room or course the visitor removed is not seeded.
        if db.execute("SELECT 1 FROM s_demo_layers WHERE org_id=? AND layer=?",
                      (org_id, demo_marketplace.LAYER)).fetchone() is None:
            return
        customer = db.execute("SELECT 1 FROM p_users u JOIN p_students s ON s.id=u.id JOIN p_roles r ON r.user_id=u.id "
                              "AND r.role='student' WHERE u.id=? AND u.org_id=? AND u.active=1",
                              (customer_id, org_id)).fetchone()
        room = db.execute("SELECT location_id FROM p_rooms WHERE id=?", (room_id,)).fetchone()
        programs = _programs(db, org_id)
        if customer is None or room is None or not programs:
            return
        actor = Actor(customer_id, org_id, "student", True)
        for key, course in programs.items():
            if access.enrollment(db, customer_id, course["id"]) is not None:
                continue
            if key == "professor":
                ok = access.on_sale(db, course) and not access.entitlements(sedens, db, customer_id, course)
            else:
                ok = access.enroll_option(sedens, db, actor, course)["ok"]
            if not ok:
                return  # the visitor changed what the facility offers; leave their demonstration as it is
        # A course the visitor has since edited may no longer have the session a visit needs: leave things as they are.
        for visit in VISITS:
            if "course" in visit and _course_session(db, customer_id, programs[visit["course"]], visit["session"]) is None:
                return
        _clear(db, org_id, customer_id)
        _seed(sedens, db, actor, org_id, room_id, room["location_id"], programs)
        db.execute("INSERT INTO s_demo_layers(org_id,layer,version,seeded_at) VALUES (?,?,?,?) "
                   "ON CONFLICT(org_id,layer) DO UPDATE SET version=excluded.version, seeded_at=excluded.seeded_at",
                   (org_id, LAYER, LAYER_VERSION, iso(utcnow())))


# -- replacing an earlier seed ----------------------------------------------------------------


def _clear(db, org_id, customer_id) -> None:
    """Remove this customer's earlier seeded history (``origin='demo_seed'`` only) before seeding again.
    Course progress is removed only for sessions the seed completed and the customer has not since
    completed in a room; enrollments and entitlements stay."""
    me = (customer_id, org_id)
    for course_id, session_id in db.execute(
            "SELECT DISTINCT course_id, course_session_id FROM s_workouts WHERE student_id=? AND org_id=? "
            "AND origin='demo_seed' AND kind='course'", me).fetchall():
        if db.execute("SELECT 1 FROM s_workouts WHERE student_id=? AND org_id=? AND course_id=? AND course_session_id=? "
                      "AND origin='room' AND state='completed'", (*me, course_id, session_id)).fetchone():
            continue
        db.execute("DELETE FROM s_course_progress WHERE item_kind='session' AND item_id=? AND enrollment_id IN "
                   "(SELECT id FROM s_enrollments WHERE user_id=? AND course_id=?)", (session_id, customer_id, course_id))
        db.execute("UPDATE s_enrollments SET completed_at=NULL WHERE user_id=? AND course_id=?", (customer_id, course_id))
    visits = "SELECT id FROM s_room_sessions WHERE student_id=? AND org_id=? AND origin='demo_seed'"
    training = {r[0] for r in db.execute(
        "SELECT training_session_id FROM s_workouts WHERE student_id=? AND org_id=? AND origin='demo_seed' "
        "AND training_session_id IS NOT NULL", me)}
    training |= {r[0] for r in db.execute(
        f"SELECT training_session_id FROM s_room_journeys WHERE training_session_id IS NOT NULL AND room_session_id IN ({visits})", me)}
    db.execute("DELETE FROM s_workouts WHERE student_id=? AND org_id=? AND origin='demo_seed'", me)
    db.execute("DELETE FROM s_room_scans WHERE student_id=? AND org_id=? AND origin='demo_seed'", me)
    db.execute("DELETE FROM s_room_sessions WHERE student_id=? AND org_id=? AND origin='demo_seed'", me)
    for session_id in training:
        db.execute("DELETE FROM p_training_sessions WHERE id=? AND student_id=?", (session_id, customer_id))


# -- seeding ------------------------------------------------------------------------------------


def _seed(sedens, db, actor, org_id, room_id, location_id, programs) -> None:
    base = utcnow()
    me = actor.user_id
    # The programs, through the real functions: an enrollment in each free course, and the demo checkout for
    # the professor's.
    for key in ("standard", "coach", "professor"):
        course = programs[key]
        if access.enrollment(db, me, course["id"]) is not None:
            continue
        if key == "professor":
            marketplace.purchase(sedens, db, actor, course["id"])
        else:
            marketplace.enroll(sedens, db, actor, course["id"])
    previous_plan: list = []
    first_play: dict = {}
    scan_rows: list = []
    for number, visit in enumerate(VISITS):
        key = visit.get("course")
        started = _moment(base, visit["days_ago"], visit["at"])
        has_scan = "scan" in visit
        created = started + timedelta(minutes=7 if has_scan else 3)
        begun = created + timedelta(minutes=1)
        room_session_id = uid()
        ctx = SimpleNamespace(room_session_id=room_session_id, org_id=org_id, student_id=me, location_id=location_id,
                              room_id=room_id, device_id=None, demo=True)
        # The visit ends after the workout (a short pause, then the two feedback questions).
        active = visit["active"]
        ended = begun + timedelta(seconds=active + 45)
        left = ended + timedelta(seconds=120)
        db.execute(
            "INSERT INTO s_room_sessions(id,org_id,location_id,room_id,device_id,student_id,token_hash,entry_method,"
            "crm_provider,crm_reference,reservation_id,state,simulated,started_at,expires_at,ended_at,end_reason,"
            "detail,last_activity_at,origin) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (room_session_id, org_id, location_id, room_id, None, me, digest("demo-seed:" + room_session_id),
             "member_id", "demo", "", None, "ended", 1, iso(started), iso(started + timedelta(minutes=120)), iso(left),
             "ended", encode({"demo_seed": True, "label": LABEL}), iso(left), "demo_seed"))
        if has_scan:
            _scan(db, org_id, me, room_session_id, started, visit["scan"], scan_rows)
        if key is None:
            goal, intensity = visit["plan"]
            workout_id, previous_plan = _personalized(db, ctx, goal, intensity, previous_plan, created)
        else:
            course = programs[key]
            workout_id = _course_workout(sedens, db, ctx, course, visit["session"], created)
            first_play.setdefault(key, created)
        _play(db, ctx, workout_id, begun, ended, active, visit["skip"])
        training = _training_session(db, me, workout_id, begun)
        _feedback(db, ctx, workout_id, training, ended + timedelta(seconds=40), visit)
        db.execute("INSERT INTO s_room_journeys(room_session_id,org_id,student_id,state,revision,path,scan_skipped,"
                   "training_session_id,created_at,updated_at,ended_at,end_reason) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                   (room_session_id, org_id, me, "ended", 12, "personalized" if key is None else "course",
                    0 if has_scan else 1, training, iso(started), iso(left), iso(left), "ended"))
        if key is not None:
            enrolled = access.enrollment(db, me, programs[key]["id"])
            session_id = decode(db.execute("SELECT plan FROM s_workouts WHERE id=?", (workout_id,)).fetchone()[0], {})["session_id"]
            existing = db.execute("SELECT 1 FROM s_course_progress WHERE enrollment_id=? AND item_kind='session' "
                                  "AND item_id=?", (enrolled["id"], session_id)).fetchone()
            marketplace._complete(db, enrolled, "session", session_id,
                                  marketplace._snapshot(db, programs[key]["id"], enrolled["version"]))
            if not existing:
                db.execute("UPDATE s_course_progress SET completed_at=? WHERE enrollment_id=? AND item_kind='session' "
                           "AND item_id=?", (iso(ended), enrolled["id"], session_id))
    _backdate(db, base, me, programs, first_play)


def _personalized(db, ctx, goal, intensity, last_plan, created):
    """A SEDENS Standard personalized workout: the room's 30 minute plan, built by the same rules."""
    rules = plans.rules()
    inputs = {"goal": goal, "duration": 30, "intensity": intensity, "experience": "new", "demo": True,
              "allowed_statuses": plans.allowed_statuses(True), "discomfort_hold": False, "hard_step_down": False,
              "last_plan": last_plan, "last_days": None, "scan_focus": None, "room_equipment": rules["room_equipment"]}
    result = plans.build(inputs, standard.exercises(), rules)
    if not result["ok"]:
        raise RuntimeError("The demonstration history could not build its personalized plan")
    rec = {"id": None, "rules_version": plans.CURRENT, "library_version": plans.library_version(), "goal": goal,
           "intensity": intensity, "duration_minutes": 30, "estimated_seconds": result["estimated_seconds"],
           "inputs": encode(inputs),
           "plan": encode({"steps": result["steps"], "rest_between_sets": result["rest_between_sets"],
                           "short": result["short"]})}
    workout_id = workouts.create_standard(None, db, ctx, rec)  # reads nothing from the server object
    db.execute("UPDATE s_workouts SET created_at=?, origin='demo_seed' WHERE id=?", (iso(created), workout_id))
    return workout_id, [s["exercise_id"] for s in result["steps"]]


def _course_session(db, customer_id, course, session_index):
    """The id of the course's n-th session in the version the customer plays (their own once enrolled)."""
    version = access.effective_version(db, course, access.enrollment(db, customer_id, course["id"]))
    snapshot = marketplace._snapshot(db, course["id"], version)
    sessions = [s for m in snapshot.get("modules", []) for s in m.get("sessions", [])]
    return sessions[session_index]["id"] if session_index < len(sessions) else None


def _course_workout(sedens, db, ctx, course, session_index, created):
    """One session of an enrolled course, frozen from the version the customer is on, exactly as the room does."""
    plan = workouts.course_plan(sedens, db, ctx, course, _course_session(db, ctx.student_id, course, session_index))
    workout_id = workouts._insert(db, ctx, kind="course", plan=plan["frozen"], planned=plan["planned"],
                                  course=plan["course"], steps=plan["steps"])
    db.execute("UPDATE s_workouts SET created_at=?, origin='demo_seed' WHERE id=?", (iso(created), workout_id))
    return workout_id


def _play(db, ctx, workout_id, begun, ended, active, skipped) -> None:
    """Play the workout through: each step completed or skipped in order, then completed."""
    rows = [dict(r) for r in db.execute("SELECT * FROM s_workout_steps WHERE workout_id=? ORDER BY position",
                                        (workout_id,))]
    skip = {p for p in skipped if p < len(rows)}
    done = [r for r in rows if r["position"] not in skip]
    spare = max(0, active - 3 * len(skip))
    weight = sum(r["planned_seconds"] for r in done) or 1
    cursor, used = begun, 0
    for r in rows:
        if r["position"] in skip:
            seconds = 3
        else:
            seconds = round(spare * r["planned_seconds"] / weight)
            used += seconds
            if r is done[-1]:
                seconds += spare - used
        finished = cursor + timedelta(seconds=seconds)
        db.execute("UPDATE s_workout_steps SET state=?, started_at=?, finished_at=? WHERE workout_id=? AND position=?",
                   ("skipped" if r["position"] in skip else "completed", iso(cursor), iso(finished), workout_id,
                    r["position"]))
        cursor = finished
    db.execute("UPDATE s_workouts SET state='completed', end_reason='completed', started_at=?, ended_at=?, "
               "active_seconds=?, current_index=?, segment_started_at=NULL WHERE id=?",
               (iso(begun), iso(ended), active, len(rows) - 1, workout_id))


def _training_session(db, student_id, workout_id, begun) -> str:
    """The shared visit record, as :func:`workouts._training_session` and ``_passport_step`` write it."""
    session_id = uid()
    db.execute("INSERT INTO p_training_sessions VALUES (?,?,?,?,?,?,?,?)",
               (session_id, student_id, None, None, None, iso(begun), "[]", LABEL))
    db.execute("INSERT INTO p_session_recorders(session_id,user_id,name,role,recorded_at) VALUES (?,?,?,?,?)",
               (session_id, None, workouts.ROOM_RECORDER, "room", iso(begun)))
    completed = []
    for sequence, r in enumerate(db.execute(
            "SELECT exercise_ref, finished_at FROM s_workout_steps WHERE workout_id=? AND state='completed' "
            "AND exercise_ref<>'' ORDER BY position", (workout_id,)).fetchall(), start=1):
        db.execute("INSERT INTO p_session_exercise_events VALUES (?,?,?,?,?,?)",
                   (uid(), session_id, sequence, r["exercise_ref"], r["finished_at"], r["finished_at"]))
        completed.append(r["exercise_ref"])
    db.execute("UPDATE p_training_sessions SET completed=? WHERE id=?", (encode(completed), session_id))
    db.execute("UPDATE s_workouts SET training_session_id=? WHERE id=?", (session_id, workout_id))
    return session_id


def _feedback(db, ctx, workout_id, training_session_id, submitted, visit) -> None:
    """The customer's own answers, as ``workouts.submit_feedback`` stores them: an effort rating from 4 to 6 and,
    once, a mild discomfort that was gone by the end of the day. The free-text note stays empty: it is the
    customer's own words, and the workout's origin already carries the "Demo data" label."""
    w = db.execute("SELECT * FROM s_workouts WHERE id=?", (workout_id,)).fetchone()
    counts = {r[0]: r[1] for r in db.execute("SELECT state, count(*) FROM s_workout_steps WHERE workout_id=? GROUP BY state",
                                             (workout_id,))}
    target = decode(w["plan"], {}).get("intensity")
    mild = bool(visit.get("discomfort"))
    db.execute(
        "INSERT INTO s_session_feedback(workout_id,room_session_id,org_id,student_id,training_session_id,"
        "questions_version,locale,target_intensity,effort,discomfort,discomfort_urgent,discomfort_regions,"
        "discomfort_when,discomfort_strength,discomfort_still,note,outcome,completed_steps,skipped_steps,"
        "active_seconds,submitted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (workout_id, ctx.room_session_id, ctx.org_id, ctx.student_id, training_session_id, workouts.FEEDBACK_VERSION,
         "ko", target if target in plans.INTENSITIES else None, visit["effort"], "yes" if mild else "no",
         0 if mild else None, encode(["lower_back"] if mild else []), "after" if mild else None,
         "mild" if mild else None, 0 if mild else None, "", "completed", counts.get("completed", 0),
         counts.get("skipped", 0), w["active_seconds"], iso(submitted)))


def _scan(db, org_id, student_id, room_session_id, visit_start, index, done) -> str:
    """One precomputed demonstration scan, stored as the room stores one, from data/sedens_demo_scan.v1.json
    with each value moved a few tenths of a degree. The second is judged against the first, as the room does."""
    views = {}
    for view, base in scans.demo_scan()["views"].items():
        views[view] = {**base, "metrics": {m: {**base["metrics"][m], "value": value}
                                           for m, value in SCAN_VALUES[index][view].items()}}
    scan_id = uid()
    began = visit_start + timedelta(minutes=2)
    db.execute("INSERT INTO s_room_scans(id,room_session_id,org_id,student_id,protocol,source,state,images_retained,"
               "started_at,origin) VALUES (?,?,?,?,?,?,?,?,?,?)",
               (scan_id, room_session_id, org_id, student_id, scans.PROTOCOL, "demo_precomputed", "processing", 0,
                iso(began), "demo_seed"))
    for number, view in enumerate(scans.VIEWS):
        db.execute("INSERT INTO s_room_scan_views(scan_id,view,captured_at) VALUES (?,?,?)",
                   (scan_id, view, iso(began + timedelta(seconds=30 * (number + 1)))))
    scan = dict(db.execute("SELECT * FROM s_room_scans WHERE id=?", (scan_id,)).fetchone())
    previous = done[-1] if done else None
    scans.store_result(db, scan, views, previous, measurement_version="demo", model="demo",
                       completed_at=iso(began + timedelta(minutes=3)))
    done.append(views)
    return scan_id


def _backdate(db, base, student_id, programs, first_play) -> None:
    """Real functions stamp enrollments, entitlements and the purchase with the moment of seeding; move them to
    the day each belongs to (a free course when its first session was chosen in the room; the paid one when it was
    bought on the phone the evening before). The audit log keeps the true time."""
    bought = _moment(base, PURCHASE["days_ago"], PURCHASE["at"])
    when = {"standard": first_play.get("standard"), "coach": first_play.get("coach"), "professor": bought}
    for key, course in programs.items():
        stamp = when[key]
        if stamp is None:
            continue
        # Only what this seed created: an enrollment a visitor made later is not moved.
        row = db.execute("SELECT id, entitlement_id FROM s_enrollments WHERE user_id=? AND course_id=?",
                         (student_id, course["id"])).fetchone()
        if row is None or db.execute("SELECT 1 FROM s_workouts WHERE student_id=? AND course_id=? AND origin='room'",
                                     (student_id, course["id"])).fetchone():
            continue
        db.execute("UPDATE s_enrollments SET enrolled_at=? WHERE id=?", (iso(stamp), row["id"]))
        db.execute("UPDATE s_entitlements SET granted_at=? WHERE id=?", (iso(stamp), row["entitlement_id"]))
        db.execute("UPDATE s_purchases SET created_at=? WHERE user_id=? AND course_id=?",
                   (iso(stamp), student_id, course["id"]))
