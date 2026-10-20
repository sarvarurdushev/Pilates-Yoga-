"""Phase 4, Part 13: facility usage and the non-invoicing fee simulation
(pilates/sedens/usage.py, usage_http.py, migration 0020).

Rows are inserted with exact timestamps so the billable-session definition, the month window in
the facility's timezone and the licensed-room rule are tested on their edges; one test runs a real
room visit and asks the same question again. Authorization runs over HTTP. All people, facilities
and courses are fictional.
"""

from __future__ import annotations

from datetime import datetime, timezone
import json
from zoneinfo import ZoneInfo

import pytest

from pilates.sedens import http as sedens_http, usage
from pilates.sedens.util import Denied, encode, uid
from course_support import build_guided, coach_creator, professor_studio, sedens_staff
from sedens_support import PASSWORD, Client, add_user, facility, make_sedens, pair, running_server
from test_sedens_passport_integrity import standard_visit
from test_sedens_room_workouts import finish, workout_row

SEPT = "2026-09"
IN_SEPT = "2026-09-10T03:00:00+00:00"  # 12:00 in Seoul


class World:
    pass


@pytest.fixture()
def world(tmp_path):
    sedens_http._LIMITS.clear()
    w = World()
    w.sedens = sedens = make_sedens(tmp_path / "s.db")
    w.root, w.reviewer, w.reviewer_token = sedens_staff(sedens)
    w.root_token = sedens.repo.login("root@sedens.test", PASSWORD)
    w.a, w.b = facility(sedens, "A"), facility(sedens, "B")
    w.org = w.a["org_id"]
    server, base = running_server(sedens.repo.path)
    w.base = base
    w.server = server
    yield w
    server.shutdown()
    server.server_close()


# -- helpers ----------------------------------------------------------------------------------

def customer(w, fac=None, db=None):
    """A new fictional customer (inside the caller's transaction when it has one open)."""
    if db is None:
        with w.sedens.db() as own:
            return customer(w, fac, own)
    fac = fac or w.a
    user_id = uid()
    db.execute("INSERT INTO p_users(id,org_id,name,email) VALUES (?,?,?,?)",
               (user_id, fac["org_id"], "Fictional Customer", f"{user_id}@example.test"))
    db.execute("INSERT INTO p_roles VALUES (?,?)", (user_id, "student"))
    db.execute("INSERT INTO p_students(id) VALUES (?)", (user_id,))
    db.execute("INSERT INTO p_student_locations VALUES (?,?)", (user_id, fac["location_id"]))
    return user_id


def visit(db, w, student=None, at=IN_SEPT, *, origin="room", org=None, room=None, simulated=0):
    visit_id = uid()
    db.execute("INSERT INTO s_room_sessions(id,org_id,room_id,student_id,token_hash,entry_method,crm_provider,state,"
               "simulated,started_at,expires_at,ended_at,end_reason,origin) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
               (visit_id, org or w.org, room, student or customer(w, db=db), uid(), "access_code", "none", "ended", simulated,
                at, at, at, "customer_ended", origin))
    return visit_id


def workout(db, w, visit_id, state="completed", steps=("completed",), *, active=600, end_reason=None, origin="room",
            kind="standard", course=None, started=True, started_at=IN_SEPT, org=None, student=None):
    workout_id = uid()
    end_reason = end_reason if end_reason is not None else {
        "completed": "completed", "stopped": "customer_ended", "abandoned": "room_session_closed",
        "ready": "", "active": "", "paused": ""}[state]
    student = student or db.execute("SELECT student_id FROM s_room_sessions WHERE id=?", (visit_id,)).fetchone()[0]
    db.execute("INSERT INTO s_workouts(id,room_session_id,org_id,student_id,kind,course_id,state,planned_seconds,"
               "active_seconds,plan,created_at,started_at,ended_at,end_reason,origin) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
               (workout_id, visit_id, org or w.org, student, kind, course, state, 900, active, encode({}), started_at,
                started_at if started else None, started_at, end_reason, origin))
    for position, step in enumerate(steps):
        db.execute("INSERT INTO s_workout_steps(workout_id,position,step_ref,phase,exercise_ref,state,planned_seconds) "
                   "VALUES (?,?,?,?,?,?,?)", (workout_id, position, f"s{position}", "main", "breathing", step, 60))
    return workout_id


def device(db, w, room, created="2026-01-05T00:00:00+00:00", revoked=None, simulated=0, fac=None):
    fac = fac or w.a
    device_id = uid()
    db.execute("INSERT INTO s_room_devices(id,org_id,location_id,room_id,name,status,token_hash,simulated,created_at,revoked_at) "
               "VALUES (?,?,?,?,?,?,?,?,?,?)",
               (device_id, fac["org_id"], fac["location_id"], room, "Screen", "revoked" if revoked else "active",
                uid(), simulated, created, revoked))
    return device_id


def new_room(w, name="Room"):
    room_id = uid()
    with w.sedens.db() as db:
        db.execute("INSERT INTO p_rooms VALUES (?,?,?,?)", (room_id, w.a["location_id"], name, 1))
    return room_id


def meter(w, month=SEPT, fac=None):
    fac = fac or w.a
    with w.sedens.db() as db:
        return usage.usage(w.sedens, db, w.sedens.repo.actor(fac["admin_token"]), month)


def metrics(w, month=SEPT):
    return meter(w, month)["metrics"]


def get(w, path, token):
    client = Client(w.base)
    if token:
        client.jar["motion_session"] = token
    return client.call("GET", "/sedens/" + path)


def post(w, path, token, body):
    client = Client(w.base)
    if token:
        client.jar["motion_session"] = token
    return client.call("POST", "/sedens/" + path, body)


# -- the plan data --------------------------------------------------------------------------------

def test_the_proposed_plan_is_seeded_data(world):
    with world.sedens.db() as db:
        row = dict(db.execute("SELECT * FROM s_usage_price_plans WHERE id='proposal-2026-10'").fetchone())
    assert (row["currency"], row["room_month_minor"], row["per_session_minor"], row["vat_included"],
            row["billable_unit"]) == ("KRW", 99000, 250, 0, "visit_with_completed_workout")


def test_a_facility_without_an_assignment_uses_the_default_plan(world):
    plan = meter(world)["simulation"]["plan"]
    assert plan["id"] == "proposal-2026-10" and plan["assigned"] is False and plan["vat_included"] is False


# -- the billable session -------------------------------------------------------------------------

def test_the_billable_session_definition_on_its_edges(world):
    w = world
    with w.sedens.db() as db:
        # 1. a completed workout with a completed step: billable
        workout(db, w, visit(db, w))
        # 2. stopped only, 3. abandoned only, 4. a draft that never started, 5. a draft replaced by a newer one
        workout(db, w, visit(db, w), "stopped", ("completed", "pending"))
        workout(db, w, visit(db, w), "abandoned", ("pending",))
        workout(db, w, visit(db, w), "ready", ("pending",), started=False, active=0)
        workout(db, w, visit(db, w), "abandoned", ("pending",), started=False, active=0, end_reason="replaced")
        # 6. completed, but every step was skipped
        workout(db, w, visit(db, w), "completed", ("skipped", "skipped"))
        # 7. completed with no step rows at all
        workout(db, w, visit(db, w), "completed", ())
        # 8. state completed but another end reason
        workout(db, w, visit(db, w), "completed", ("completed",), end_reason="visit_ended")
        # 9. two completed workouts in one visit: one billable session
        two = visit(db, w)
        workout(db, w, two, "completed", ("completed",), active=300)
        workout(db, w, two, "completed", ("completed", "completed"), active=400)
        # 10. a visit with no workout at all
        visit(db, w)
    m = metrics(w)
    assert m["room_sessions"] == 10
    assert m["billable_sessions"] == 2
    # Completed workouts by state and end reason (the all-skipped one is state completed).
    assert m["completed_workouts"] == 5
    # Stopped and abandoned workouts that had started: a draft or a replaced draft is never one.
    assert m["incomplete_workouts"] == 2


def test_a_workout_of_another_origin_or_organization_does_not_make_a_visit_billable(world):
    w = world
    with w.sedens.db() as db:
        seeded = visit(db, w, origin="demo_seed")
        workout(db, w, seeded, origin="demo_seed")
        # A real visit whose only completed workout is a seeded one.
        mixed = visit(db, w)
        workout(db, w, mixed, origin="demo_seed")
        # A visit of another organization.
        other = visit(db, w, student=customer(w, w.b, db), org=w.b["org_id"])
        workout(db, w, other, org=w.b["org_id"])
    m = metrics(w)
    assert (m["room_sessions"], m["billable_sessions"], m["completed_workouts"]) == (1, 0, 0)
    assert metrics_b(w)["billable_sessions"] == 1


def metrics_b(w, month=SEPT):
    return meter(w, month, w.b)["metrics"]


def test_seeded_demo_history_is_never_counted(world):
    w = world
    with w.sedens.db() as db:
        v = visit(db, w, origin="demo_seed")
        workout(db, w, v, origin="demo_seed", active=1800)
        db.execute("INSERT INTO s_room_scans(id,room_session_id,org_id,student_id,protocol,source,state,started_at,origin,error) "
                   "VALUES (?,?,?,?,?,?,?,?,?,?)", (uid(), v, w.org, w.a["customer_id"], "p", "demo_precomputed", "failed",
                                                     IN_SEPT, "demo_seed", "x"))
    m = metrics(w)
    assert all(value == 0 for key, value in m.items() if key != "licensed_rooms"), m


def test_analytics_events_are_ignored_even_when_forged(world):
    w = world
    with w.sedens.db() as db:
        for name in ("room_entered", "room_session_started", "workout_started", "workout_completed", "scan_retake",
                     "session_abandoned", "safety_stop"):
            for _ in range(5):
                db.execute("INSERT INTO s_events(org_id,name,at,source,props) VALUES (?,?,?,?,?)",
                           (w.org, name, IN_SEPT, "client", "{}"))
    m = metrics(w)
    assert all(value == 0 for value in m.values()), m
    assert meter(w)["simulation"]["inputs"]["billable_sessions"] == 0


def test_a_repeated_completion_request_cannot_add_a_billable_session(tmp_path):
    """A real visit: the workout is completed, then every completion request is repeated."""
    class V:
        pass
    sedens = make_sedens(tmp_path / "real.db", "demo_free")
    _, _, _ = sedens_staff(sedens)
    fac = facility(sedens, "A")
    w = V()
    w.sedens, w.a, w.device = sedens, fac, pair(sedens, fac)
    v = standard_visit(w, feedback=False)
    row = workout_row(v)
    for position in range(len(v.all("SELECT 1 FROM s_workout_steps WHERE workout_id=?", row["id"]))):
        for outcome in ("completed", "skipped"):
            assert v.refused("workout/step", position=position, outcome=outcome).code == "invalid_transition"
    assert v.refused("workout/start").code == "invalid_transition"
    v.leave()
    with sedens.db() as db:
        result = usage.usage(sedens, db, sedens.repo.actor(fac["admin_token"]))
    m = result["metrics"]
    assert m["room_sessions"] == 1 and m["billable_sessions"] == 1 and m["completed_workouts"] == 1
    assert m["licensed_rooms"] == 1
    assert result["simulation"]["total"] == 99000 + 250


def test_a_real_visit_with_a_second_workout_is_still_one_session(tmp_path):
    class V:
        pass
    sedens = make_sedens(tmp_path / "real.db", "demo_free")
    sedens_staff(sedens)
    fac = facility(sedens, "A")
    w = V()
    w.sedens, w.a, w.device = sedens, fac, pair(sedens, fac)
    v = standard_visit(w, feedback=False)
    v.act("workout/another")
    v.request("core", 30, "moderate")
    v.act("plan/accept", recommendation=v.view["recommendation"]["id"])
    v.act("workout/start")
    finish(v)
    v.leave()
    with sedens.db() as db:
        assert db.execute("SELECT count(*) FROM s_workouts WHERE state='completed'").fetchone()[0] == 2
        m = usage.usage(sedens, db, sedens.repo.actor(fac["admin_token"]))["metrics"]
    assert m["completed_workouts"] == 2 and m["billable_sessions"] == 1 and m["room_sessions"] == 1


# -- the month ------------------------------------------------------------------------------------

def test_the_month_is_the_facility_month_and_a_visit_belongs_to_the_month_it_started_in(world):
    w = world
    edge = [
        ("2026-08-31T14:59:59+00:00", "2026-08"),  # 23:59:59 on 31 August in Seoul
        ("2026-08-31T15:00:00+00:00", "2026-09"),  # 00:00 on 1 September in Seoul
        ("2026-09-15T00:00:00Z", "2026-09"),       # a stored 'Z' timestamp
        ("2026-09-30T14:59:59+00:00", "2026-09"),  # 23:59:59 on 30 September in Seoul
        ("2026-09-30T15:00:00+00:00", "2026-10"),  # 00:00 on 1 October in Seoul
    ]
    with w.sedens.db() as db:
        for at, _ in edge:
            workout(db, w, visit(db, w, at=at), started_at=at)
    got = {month: metrics(w, month)["billable_sessions"] for month in ("2026-08", "2026-09", "2026-10")}
    assert got == {"2026-08": 1, "2026-09": 3, "2026-10": 1}


def test_a_workout_completed_after_midnight_stays_in_the_month_its_visit_started(world):
    w = world
    started = "2026-09-30T14:50:00+00:00"  # 23:50 on 30 September in Seoul
    finished = "2026-09-30T15:10:00+00:00"  # 00:10 on 1 October in Seoul
    with w.sedens.db() as db:
        v = visit(db, w, at=started)
        workout(db, w, v, started_at=started)
        db.execute("UPDATE s_workouts SET ended_at=? WHERE room_session_id=?", (finished, v))
    assert metrics(w, "2026-09")["billable_sessions"] == 1
    assert metrics(w, "2026-10")["billable_sessions"] == 0
    assert metrics(w, "2026-10")["completed_workouts"] == 0


def test_the_organization_timezone_decides_the_month(world):
    w = world
    with w.sedens.db() as db:
        w.sedens.set_org_profile(db, w.org, "facility", "Facility A")
        db.execute("UPDATE s_org_profiles SET timezone='America/New_York' WHERE org_id=?", (w.org,))
        # 01:00 UTC on 1 September is still 31 August (21:00) in New York.
        workout(db, w, visit(db, w, at="2026-09-01T01:00:00+00:00"))
    assert metrics(w, "2026-08")["billable_sessions"] == 1
    assert metrics(w, "2026-09")["billable_sessions"] == 0
    assert meter(w, "2026-08")["timezone"] == "America/New_York"


def test_month_validation(world):
    w = world
    now = datetime.now(timezone.utc).astimezone(ZoneInfo("Asia/Seoul"))
    this = f"{now.year:04d}-{now.month:02d}"
    assert meter(w, None)["month"] == this
    assert meter(w, this)["month"] == this
    future = f"{now.year + 1:04d}-01"
    for bad in ("2026-9", "2026-13", "2026-00", "26-09", "2026/09", "2026-09-01", "september", "2024-12", future,
                "0000-01", " 2026-09", "2026-09\n", "２０２６-０９"):
        with pytest.raises(Denied) as caught:
            meter(w, bad)
        assert caught.value.code == "invalid_month", bad
    status, body = get(w, "facility/usage?month=2026-13", w.a["admin_token"])
    assert status == 400 and body["code"] == "invalid_month"
    assert get(w, "facility/usage?month=2026-09", w.a["admin_token"])[0] == 200


def test_the_response_names_the_window(world):
    result = meter(world)
    assert result["window"] == {"from": "2026-09-01", "to": "2026-09-30"} and result["timezone"] == "Asia/Seoul"
    assert result["months"]["first"] == "2025-01"


# -- licensed rooms -------------------------------------------------------------------------------

def test_licensed_rooms_are_rooms_with_a_screen_active_in_the_month(world):
    w = world
    rooms = [new_room(w, f"R{n}") for n in range(6)]
    other_room = new_room(w, "Other")
    with w.sedens.db() as db:
        device(db, w, rooms[0])                                                       # active all month
        device(db, w, rooms[0], created="2026-02-01T00:00:00+00:00")                  # a second screen, same room
        device(db, w, rooms[1], revoked="2026-08-20T00:00:00+00:00")                  # revoked before the month
        device(db, w, rooms[2], revoked="2026-09-15T00:00:00+00:00")                  # revoked mid-month
        device(db, w, rooms[3], created="2026-09-20T00:00:00+00:00")                  # paired mid-month
        device(db, w, rooms[4], created="2026-10-01T00:00:00+00:00")                  # paired after the month
        device(db, w, rooms[5], created="2026-08-31T15:00:00+00:00", revoked="2026-08-31T15:00:00+00:00")  # revoked at the start
        device(db, w, other_room, fac=w.b)                                  # another organization's room
    assert metrics(w)["licensed_rooms"] == 4
    # August: rooms 0, 1 and 2; room 5 was paired at the very end of the month, which belongs to September.
    assert metrics(w, "2026-08")["licensed_rooms"] == 3


def test_a_screen_revoked_before_the_month_started_is_not_licensed(world):
    w = world
    room = new_room(w)
    with w.sedens.db() as db:
        device(db, w, room, revoked="2026-08-31T14:59:59+00:00")
    assert metrics(w, "2026-09")["licensed_rooms"] == 0
    assert metrics(w, "2026-08")["licensed_rooms"] == 1


def test_a_screen_revoked_in_the_month_is_still_licensed_for_it(world):
    w = world
    room = new_room(w)
    with w.sedens.db() as db:
        device(db, w, room, revoked="2026-09-02T00:00:00+00:00")
    assert metrics(w, "2026-09")["licensed_rooms"] == 1
    assert metrics(w, "2026-10")["licensed_rooms"] == 0


# -- the other metrics ----------------------------------------------------------------------------

def test_used_minutes_bands_and_repeat_customers(world):
    w = world
    me, other = customer(w), customer(w)
    with w.sedens.db() as db:
        # (active seconds of its workouts) -> band
        for student, seconds in ((me, (599,)), (me, (300, 300)), (other, (1199,)), (other, (1200,)),
                                 (customer(w, db=db), (1799,)), (customer(w, db=db), (1800,)), (customer(w, db=db), (3000, 600))):
            v = visit(db, w, student)
            for active in seconds:
                workout(db, w, v, active=active)
        # A stopped workout is used time but its visit is not billable.
        workout(db, w, visit(db, w, customer(w, db=db)), "stopped", ("completed", "pending"), active=120)
    result = meter(w)
    bands = {b["band"]: b["sessions"] for b in result["duration_bands"]}
    # 599 -> <10; 600 -> 10-20; 1199 -> 10-20; 1200 -> 20-30; 1799 -> 20-30; 1800 -> 30+; 3600 -> 30+
    assert bands == {"under_10": 1, "from_10_to_20": 2, "from_20_to_30": 2, "over_30": 2}
    assert result["metrics"]["billable_sessions"] == 7 == sum(bands.values())
    total = 599 + 600 + 1199 + 1200 + 1799 + 1800 + 3600 + 120
    assert result["metrics"]["used_minutes"] == int(total / 60 + 0.5)
    # me and other each came twice; the rest once.
    assert result["metrics"]["repeat_customers"] == 2


def test_program_types_use_the_creator_type_as_currently_declared(world):
    w = world
    coach = coach_creator(w.sedens, w.a)
    professor = professor_studio(w.sedens)
    coach_course = build_guided(w.sedens, coach)["course"]["id"]
    professor_course = build_guided(w.sedens, professor, title="Mobility lab")["course"]["id"]
    with w.sedens.db() as db:
        v = visit(db, w)
        workout(db, w, v)
        workout(db, w, v, kind="course", course=coach_course)
        workout(db, w, v, kind="course", course=coach_course)
        workout(db, w, v, kind="course", course=professor_course)
        workout(db, w, v, kind="course", course=None)  # a course that has since been deleted
        workout(db, w, v, "ready", started=False, active=0)  # a draft is no program use
    split = {row["type"]: row["workouts"] for row in meter(w)["program_types"]}
    assert split == {"standard": 1, "coach": 2, "professor": 1, "expert": 0, "editorial": 0, "other": 1}
    assert meter(w)["definitions"]["creator_type"] == "as_currently_declared"
    with w.sedens.db() as db:
        db.execute("UPDATE s_creator_profiles SET creator_type='expert' WHERE id=(SELECT creator_id FROM s_courses WHERE id=?)",
                   (professor_course,))
    assert {r["type"]: r["workouts"] for r in meter(w)["program_types"]}["expert"] == 1


def test_scan_failures_and_retakes(world):
    w = world
    me = w.a["customer_id"]
    with w.sedens.db() as db:
        def scan(state, at=IN_SEPT, origin="room", retakes=(0, 0, 0, 0), org=None):
            scan_id = uid()
            db.execute("INSERT INTO s_room_scans(id,org_id,student_id,protocol,source,state,started_at,origin) VALUES (?,?,?,?,?,?,?,?)",
                       (scan_id, org or w.org, me, "p", "room_capture", state, at, origin))
            for view, n in zip(("front", "left", "back", "right"), retakes):
                db.execute("INSERT INTO s_room_scan_views(scan_id,view,retakes) VALUES (?,?,?)", (scan_id, view, n))
        scan("failed", retakes=(1, 0, 2, 0))
        scan("complete", retakes=(0, 1, 0, 0))
        scan("abandoned")
        scan("failed", at="2026-10-03T03:00:00+00:00", retakes=(5, 5, 5, 5))      # another month
        scan("failed", origin="demo_seed", retakes=(9, 9, 9, 9))                  # seeded history
    m = metrics(w)
    assert m["technical_failures"] == 1 and m["scan_retakes"] == 4


# -- the fee --------------------------------------------------------------------------------------

def test_the_simulation_multiplies_rooms_and_billable_sessions_and_never_invoices(world):
    w = world
    second = new_room(w)
    with w.sedens.db() as db:
        device(db, w, w.a["room_id"])
        device(db, w, second)
        for _ in range(7):
            workout(db, w, visit(db, w))
        workout(db, w, visit(db, w), "stopped", ("pending",))
    sim = meter(w)["simulation"]
    assert sim["inputs"] == {"licensed_rooms": 2, "billable_sessions": 7}
    assert (sim["room_fee"], sim["session_fee"], sim["total"]) == (2 * 99000, 7 * 250, 2 * 99000 + 7 * 250)
    assert sim["currency"] == "KRW" and sim["vat_included"] is False
    assert sim["invoice"] is False and sim["payment_taken"] is False
    assert sim["formula"] == "licensed_rooms * room_month + billable_sessions * per_session"
    # A month before the screens existed and with no visits costs nothing.
    assert meter(w, "2025-12")["simulation"]["total"] == 0


def test_an_assigned_plan_replaces_the_default(world):
    w = world
    with w.sedens.db() as db:
        db.execute("INSERT INTO s_usage_price_plans VALUES ('pilot-1','Pilot','KRW',50000,100,1,"
                   "'visit_with_completed_workout','2026-10-21T00:00:00Z')")
        device(db, w, w.a["room_id"])
        for _ in range(3):
            workout(db, w, visit(db, w))
    assert meter(w)["simulation"]["total"] == 99000 + 3 * 250
    status, body = post(w, "admin/usage-plan", w.root_token, {"org_id": w.org, "plan_id": "pilot-1"})
    assert status == 200 and body["plan"]["id"] == "pilot-1"
    sim = meter(w)["simulation"]
    assert sim["plan"]["id"] == "pilot-1" and sim["plan"]["assigned"] is True and sim["vat_included"] is True
    assert sim["total"] == 50000 + 3 * 100
    # Another facility keeps the default.
    assert meter(w, SEPT, w.b)["simulation"]["plan"]["id"] == "proposal-2026-10"


# -- demonstrations -------------------------------------------------------------------------------

def test_demonstrations_are_computed_flagged_and_never_invoiced(world):
    w = world
    room = new_room(w)
    with w.sedens.db() as db:
        device(db, w, room, simulated=1)
        workout(db, w, visit(db, w, simulated=1))
    result = meter(w)
    assert result["metrics"]["billable_sessions"] == 1 and result["metrics"]["licensed_rooms"] == 1
    assert result["demonstration"]["flagged"] is True and result["demonstration"]["never_invoiced"] is True
    assert result["demonstration"]["simulated_devices"] == 1 and result["demonstration"]["simulated_visits"] == 1
    assert result["simulation"]["total"] == 99000 + 250
    # A real organization with real devices is not flagged, and the statement is still true.
    clean = meter(w, SEPT, w.b)
    assert clean["demonstration"]["flagged"] is False and clean["demonstration"]["never_invoiced"] is True
    with w.sedens.db() as db:
        db.execute("UPDATE p_organizations SET demo=1 WHERE id=?", (w.b["org_id"],))
    assert meter(w, SEPT, w.b)["demonstration"]["flagged"] is True


# -- who may see it, who may change the plan -------------------------------------------------------

def test_authorization_matrix(world):
    w = world
    coach_token = w.a["coach_token"]
    studio_token = w.sedens.repo.issue(professor_studio(w.sedens).user_id, "admin")
    path = "facility/usage?month=2026-09"
    assert get(w, path, w.a["admin_token"])[0] == 200
    assert get(w, path, w.b["admin_token"])[0] == 200  # their own organization
    for who, token in (("coach", coach_token), ("customer", w.a["customer_token"]),
                       ("creator studio admin", studio_token), ("SEDENS admin", w.root_token),
                       ("reviewer", w.reviewer_token)):
        status, body = get(w, path, token)
        assert status == 403, (who, status, body)
    status, body = get(w, path, None)
    assert status == 401
    # A room screen's device token is not a person.
    device_token = pair(w.sedens, w.a)
    client = Client(w.base)
    client.jar["sedens_device"] = device_token
    assert client.call("GET", "/sedens/" + path)[0] in (401, 403)


def test_the_organization_comes_from_the_session_never_from_the_request(world):
    w = world
    with w.sedens.db() as db:
        workout(db, w, visit(db, w))
    for extra in (f"&org_id={w.org}", f"&org={w.org}", f"&organization_id={w.org}"):
        status, body = get(w, "facility/usage?month=2026-09" + extra, w.b["admin_token"])
        assert status == 200 and body["metrics"]["room_sessions"] == 0
    assert get(w, "facility/usage?month=2026-09", w.a["admin_token"])[1]["metrics"]["billable_sessions"] == 1


def test_a_creator_studio_or_the_sedens_organization_has_no_facility_usage(world):
    w = world
    with w.sedens.db() as db:
        studio = professor_studio(w.sedens)
        assert w.sedens.org(db, studio.org_id)["kind"] == "creator_studio"
        with pytest.raises(Denied) as caught:
            usage.usage(w.sedens, db, studio, SEPT)
        assert caught.value.code == "facility_required"
        with pytest.raises(Denied):
            usage.usage(w.sedens, db, w.root, SEPT)


def test_only_a_sedens_admin_assigns_a_plan_and_it_is_audited(world):
    w = world
    body = {"org_id": w.org, "plan_id": "proposal-2026-10"}
    for who, token in (("facility admin", w.a["admin_token"]), ("other facility admin", w.b["admin_token"]),
                       ("coach", w.a["coach_token"]), ("customer", w.a["customer_token"]),
                       ("reviewer", w.reviewer_token)):
        status, answer = post(w, "admin/usage-plan", token, body)
        assert status == 403 and answer["code"] == "capability_required", (who, status, answer)
        assert get(w, "admin/usage-plans", token)[0] == 403
    assert post(w, "admin/usage-plan", None, body)[0] == 401
    with w.sedens.db() as db:
        assert db.execute("SELECT count(*) FROM s_org_usage_plans").fetchone()[0] == 0
        db.execute("INSERT INTO s_usage_price_plans VALUES ('pilot-1','Pilot','KRW',1,1,0,'visit_with_completed_workout','2026-10-21T00:00:00Z')")
    status, listing = get(w, "admin/usage-plans", w.root_token)
    assert status == 200 and {p["id"] for p in listing["items"]} == {"proposal-2026-10", "pilot-1"}
    status, answer = post(w, "admin/usage-plan", w.root_token, {"org_id": w.org, "plan_id": "pilot-1"})
    assert status == 200 and answer["plan"]["id"] == "pilot-1"
    status, answer = post(w, "admin/usage-plan", w.root_token, {"org_id": w.org, "plan_id": "proposal-2026-10"})
    assert status == 200
    with w.sedens.db() as db:
        rows = db.execute("SELECT plan_id, assigned_by FROM s_org_usage_plans WHERE org_id=?", (w.org,)).fetchall()
        assert [tuple(r) for r in rows] == [("proposal-2026-10", w.root.user_id)]
        audit = db.execute("SELECT detail FROM p_audit WHERE action='sedens:usage_plan:assign' AND subject_id=? AND org_id=? "
                           "AND actor_id IS NULL ORDER BY rowid", (w.org, w.org)).fetchall()
    details = [json.loads(r[0]) for r in audit]
    assert [d["plan_id"] for d in details] == ["pilot-1", "proposal-2026-10"] and details[1]["previous"] == "pilot-1"


def test_plan_assignment_refuses_unknown_targets(world):
    w = world
    for body in ({"org_id": "nope", "plan_id": "proposal-2026-10"}, {"org_id": w.org, "plan_id": "nope"},
                 {"org_id": w.org}, {"plan_id": "proposal-2026-10"}, {"org_id": 5, "plan_id": ["x"]},
                 {"org_id": w.root.org_id, "plan_id": "proposal-2026-10"}):
        status, _ = post(w, "admin/usage-plan", w.root_token, body)
        assert status in (400, 404), body
    with w.sedens.db() as db:
        assert db.execute("SELECT count(*) FROM s_org_usage_plans").fetchone()[0] == 0


def test_a_plan_cannot_be_assigned_across_the_demo_boundary(world):
    w = world
    with w.sedens.db() as db:
        db.execute("UPDATE p_organizations SET demo=1 WHERE id=?", (w.b["org_id"],))
    status, answer = post(w, "admin/usage-plan", w.root_token, {"org_id": w.b["org_id"], "plan_id": "proposal-2026-10"})
    assert status == 403 and answer["code"] == "environment_mismatch"


# -- aggregates only ------------------------------------------------------------------------------

def test_the_response_is_aggregate_only(world):
    w = world
    me = w.a["customer_id"]
    secret = "discomfort-note-marker-lime"
    with w.sedens.db() as db:
        v = visit(db, w, me)
        wid = workout(db, w, v)
        db.execute("INSERT INTO s_session_feedback(workout_id,room_session_id,org_id,student_id,questions_version,locale,"
                   "effort,discomfort,discomfort_regions,note,outcome,submitted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                   (wid, v, w.org, me, "q", "en", 5, "yes", '["lower_back"]', secret, "completed", IN_SEPT))
        scan_id = uid()
        db.execute("INSERT INTO s_room_scans(id,room_session_id,org_id,student_id,protocol,source,state,started_at,images_retained) "
                   "VALUES (?,?,?,?,?,?,?,?,?)", (scan_id, v, w.org, me, "p", "room_capture", "failed", IN_SEPT, 1))
        db.execute("INSERT INTO s_room_scan_views(scan_id,view,image_key,retakes) VALUES (?,?,?,?)",
                   (scan_id, "front", "front-image-key.png", 2))
        visit(db, w, me)  # a repeat customer
    status, body = get(w, "facility/usage?month=2026-09", w.a["admin_token"])
    assert status == 200
    text = json.dumps(body)
    for forbidden in (me, v, wid, scan_id, w.a["coach_id"], w.a["other_id"], "Customer A", "Coach A", "example.test", secret,
                      "lower_back", "front-image-key", "image", "email", "student", "name"):
        assert forbidden not in text, forbidden

    def numbers(value, where="response"):
        if isinstance(value, dict):
            for key, item in value.items():
                yield from numbers(item, f"{where}.{key}")
        elif isinstance(value, list):
            for item in value:
                yield from numbers(item, where)
        else:
            yield where, value
    leaves = dict(numbers(body))
    assert not [k for k in leaves if "revenue" in k or "sales" in k]
    assert body["metrics"]["repeat_customers"] == 1 and body["metrics"]["scan_retakes"] == 2


def test_the_billable_unit_and_definitions_are_stated(world):
    result = meter(world)
    d = result["definitions"]
    assert d["billable_unit"] == "visit_with_completed_workout" and result["simulation"]["plan"]["billable_unit"] == d["billable_unit"]
    assert set(d["not_counted"]) >= {"stopped_or_abandoned_only", "all_steps_skipped", "retry_or_repeat_request",
                                     "second_workout_same_visit", "seeded_demo_history", "analytics_events"}
    assert d["month_timezone"] == "facility_timezone" and d["amounts"] == "whole_won_vat_excluded"


def test_the_meter_only_reads(world):
    w = world
    with w.sedens.db() as db:
        workout(db, w, visit(db, w))
        before = [tuple(r) for r in db.execute("SELECT name, count(*) FROM sqlite_master GROUP BY name")]
        counts = {t: db.execute(f"SELECT count(*) FROM {t}").fetchone()[0]
                  for t in ("s_room_sessions", "s_workouts", "s_workout_steps", "s_events", "p_audit", "s_org_usage_plans")}
    meter(w)
    get(w, "facility/usage?month=2026-09", w.a["admin_token"])
    with w.sedens.db() as db:
        assert {t: db.execute(f"SELECT count(*) FROM {t}").fetchone()[0] for t in counts} == counts
        assert [tuple(r) for r in db.execute("SELECT name, count(*) FROM sqlite_master GROUP BY name")] == before


# -- restore ----------------------------------------------------------------------------------------

def test_a_restore_neither_copies_billable_history_nor_licenses_its_screens(world, tmp_path):
    """A restore into a new organization (while the original still exists) brings history of another
    organization: its visits are not counted again and its screens are not licensed until paired here."""
    from pilates.platform.backup import restore_archive
    from test_sedens_backup import fresh_org, save

    w = world
    room = new_room(w, "Restored room")
    with w.sedens.db() as db:
        workout(db, w, visit(db, w, room=room))
        device(db, w, room, created="2026-10-02T00:00:00+00:00")
        scan = uid()
        db.execute("INSERT INTO s_room_scans(id,room_session_id,org_id,student_id,protocol,source,state,started_at,origin,error) "
                   "VALUES (?,?,?,?,?,?,?,?,?,?)",
                   (scan, db.execute("SELECT id FROM s_room_sessions WHERE org_id=?", (w.org,)).fetchone()[0], w.org,
                    db.execute("SELECT student_id FROM s_room_sessions WHERE org_id=?", (w.org,)).fetchone()[0],
                    "standard", "room_capture", "failed", IN_SEPT, "room", "camera"))
    original = (metrics(w, SEPT), metrics(w, "2026-10"))
    assert original[0]["billable_sessions"] == 1 and original[0]["technical_failures"] == 1
    assert original[1]["licensed_rooms"] == 1
    path = save(w.sedens.repo, w.a["admin"], tmp_path / "a.zip")
    owner = fresh_org(w.sedens, "usage")
    restore_archive(w.sedens.repo, owner, path)
    with w.sedens.db() as db:
        assert db.execute("SELECT count(*) FROM s_room_sessions WHERE org_id=?", (owner.org_id,)).fetchone()[0] == 1
        assert db.execute("SELECT count(*) FROM s_room_devices WHERE org_id=?", (owner.org_id,)).fetchone()[0] == 1
        for month in (SEPT, "2026-10"):
            result = usage.usage(w.sedens, db, owner, month)
            for name in ("room_sessions", "billable_sessions", "completed_workouts", "licensed_rooms", "technical_failures"):
                assert result["metrics"][name] == 0, (month, name)
            assert result["simulation"]["total"] == 0
    # The original organization is untouched; the restored rows say why they are not counted.
    assert (metrics(w, SEPT), metrics(w, "2026-10")) == original
    with w.sedens.db() as db:
        for table in ("s_room_sessions", "s_room_devices"):
            details = [json.loads(r[0]) for r in db.execute(f"SELECT detail FROM {table} WHERE org_id=?", (owner.org_id,))]
            assert details and all(d.get("restored") is True for d in details), table
            assert not any(json.loads(r[0]).get("restored") for r in db.execute(f"SELECT detail FROM {table} WHERE org_id=?", (w.org,)))
