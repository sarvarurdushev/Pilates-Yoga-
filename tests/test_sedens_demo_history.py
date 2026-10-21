"""The demonstration customer's history (pilates/sedens/demo_history.py): a modest, believable, clearly
labelled past that the Passport reads, that the facility usage meter never counts, and that leaves with the
demonstration. All people, courses and measurements are fictional."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import json
from zoneinfo import ZoneInfo

import pytest

from pilates.sedens import (access, consent, demo, demo_cleanup, demo_history, feedback, passport, scan_history, scans,
                            usage)
from pilates.sedens.util import parse, utcnow
from sedens_support import make_sedens

KEY, SECOND, THIRD = "a1" * 16, "b2" * 16, "c3" * 16
SEOUL = ZoneInfo("Asia/Seoul")
COURSES = ("SEDENS Standard: Foundations", "4-Week Core Foundations", "Mobility Foundations")
OVERCLAIMS = ("improv", "progress", "better", "worse", "stronger", "weight", "calorie", "fat", "healthier",
              "corrected", "fixed", "posture score")


def seed(sedens, key):
    sedens.repo.logout(sedens.repo.demo_login(key, "admin"))
    demo.ensure(sedens, "demo-" + key)


@pytest.fixture(scope="module")
def sedens(tmp_path_factory):
    sedens = make_sedens(tmp_path_factory.mktemp("history") / "s.db", "demo_free")
    seed(sedens, KEY)
    return sedens


def org(key=KEY):
    return "demo-" + key


def customer(key=KEY):
    return f"{org(key)}-student00"


def student(sedens, key=KEY):
    return sedens.repo.actor(sedens.repo.demo_login(key, "student"))


def q(sedens, sql, *args):
    with sedens.db() as db:
        return [dict(r) for r in db.execute(sql, args)]


def counts(sedens, key=KEY):
    me = customer(key)
    return {name: q(sedens, f"SELECT count(*) AS n FROM {table} WHERE {where}", me)[0]["n"] for name, table, where in (
        ("visits", "s_room_sessions", "student_id=? AND origin='demo_seed'"),
        ("workouts", "s_workouts", "student_id=? AND origin='demo_seed'"),
        ("steps", "s_workout_steps", "workout_id IN (SELECT id FROM s_workouts WHERE student_id=?)"),
        ("feedback", "s_session_feedback", "student_id=?"),
        ("scans", "s_room_scans", "student_id=? AND origin='demo_seed'"),
        ("journeys", "s_room_journeys", "student_id=?"),
        ("enrollments", "s_enrollments", "user_id=?"),
        ("entitlements", "s_entitlements", "user_id=?"),
        ("progress", "s_course_progress", "enrollment_id IN (SELECT id FROM s_enrollments WHERE user_id=?)"),
        ("recorded", "p_session_recorders", "role='room' AND session_id IN (SELECT id FROM p_training_sessions WHERE student_id=?)"),
        ("events", "p_session_exercise_events", "session_id IN (SELECT id FROM p_training_sessions WHERE student_id=?)"))}


def visits(sedens, key=KEY):
    return q(sedens, "SELECT * FROM s_room_sessions WHERE student_id=? ORDER BY started_at", customer(key))


# -- what is seeded, and that it is seeded once ---------------------------------------------------


def test_the_history_is_seeded_once_and_a_second_call_changes_nothing(sedens):
    first = counts(sedens)
    assert first["visits"] == first["workouts"] == first["feedback"] == first["journeys"] == 6
    assert first["scans"] == 2 and first["enrollments"] == first["entitlements"] == 3 and first["progress"] == 4
    completed = q(sedens, "SELECT count(*) AS n FROM s_workout_steps WHERE state='completed' AND exercise_ref<>'' AND workout_id "
                          "IN (SELECT id FROM s_workouts WHERE student_id=?)", customer())[0]["n"]
    assert first["recorded"] == 6 and first["events"] == completed > 0
    for _ in range(3):
        demo.ensure(sedens, org())
    assert counts(sedens) == first
    layer = q(sedens, "SELECT version FROM s_demo_layers WHERE org_id=? AND layer=?", org(), demo_history.LAYER)
    assert layer == [{"version": demo_history.LAYER_VERSION}]


def test_the_demo_room_signs_in_this_customer(sedens):
    first = demo.MEMBERS[0]
    assert first[0] == "DEMO-1001" and student(sedens).user_id == customer() == f"{org()}-{first[1]}"


def test_everything_seeded_is_marked_demo_and_belongs_to_a_demonstration(sedens):
    assert q(sedens, "SELECT demo FROM p_organizations WHERE id=?", org()) == [{"demo": 1}]
    assert {v["origin"] for v in visits(sedens)} == {"demo_seed"}
    assert {w["origin"] for w in q(sedens, "SELECT origin FROM s_workouts WHERE student_id=?", customer())} == {"demo_seed"}
    assert {s["origin"] for s in q(sedens, "SELECT origin FROM s_room_scans WHERE student_id=?", customer())} == {"demo_seed"}
    for v in visits(sedens):
        assert v["state"] == "ended" and v["simulated"] == 1 and "Demo data" in v["detail"]
    # The free-text note is the customer's own words: the seed never writes any (the origin carries the label).
    notes = q(sedens, "SELECT note FROM s_session_feedback WHERE student_id=?", customer())
    assert notes and all(n["note"] == "" for n in notes)
    sessions = q(sedens, "SELECT notes FROM p_training_sessions WHERE id IN (SELECT training_session_id FROM s_workouts "
                         "WHERE student_id=?)", customer())
    assert len(sessions) == 6 and all("Demo data" in s["notes"] for s in sessions)


def test_the_audit_log_keeps_the_true_time_of_the_seed(sedens):
    rows = q(sedens, "SELECT created_at FROM p_audit WHERE actor_id=? AND action LIKE 'sedens:course:%'", customer())
    assert rows
    created = q(sedens, "SELECT seeded_at FROM s_demo_layers WHERE org_id=? AND layer=?", org(), demo_history.LAYER)[0]
    assert all(abs((parse(r["created_at"]) - parse(created["seeded_at"])).total_seconds()) < 600 for r in rows)


def test_the_seed_writes_no_consent_readiness_or_recommendation(sedens):
    # A known, documented gap: seeding a consent would skip the step the live demo shows (see the module docstring).
    me = customer()
    assert q(sedens, "SELECT count(*) AS n FROM s_readiness_checks WHERE student_id=?", me) == [{"n": 0}]
    assert q(sedens, "SELECT count(*) AS n FROM s_recommendations WHERE student_id=?", me) == [{"n": 0}]
    assert {w["recommendation_id"] for w in q(sedens, "SELECT recommendation_id FROM s_workouts WHERE student_id=?", me)} \
        == {None}
    with sedens.db() as db:
        assert consent.current(db, me)["scan_capture"] is None
        assert db.execute("SELECT count(*) FROM s_room_scans WHERE student_id=?", (me,)).fetchone()[0] == 2


def test_the_history_refuses_an_organization_that_is_not_a_demonstration(sedens):
    with pytest.raises(ValueError):
        demo_history.ensure(sedens, "no-such-org", customer_id=customer(), room_id="x")


def test_no_analytics_event_exists_for_the_seeded_history(sedens):
    mine = {v["id"] for v in visits(sedens)}
    marks = ",".join("?" * len(mine))
    assert q(sedens, f"SELECT count(*) AS n FROM s_events WHERE room_session_id IN ({marks})", *mine)[0]["n"] == 0
    assert q(sedens, "SELECT count(*) AS n FROM s_events WHERE org_id=? AND name IN ('workout_started','workout_completed',"
                     "'exercise_completed','scan_completed','session_feedback_submitted')", org())[0]["n"] == 0


# -- six believable visits --------------------------------------------------------------------------


def test_six_weekly_visits_in_the_six_weeks_before_seeding(sedens):
    rows = visits(sedens)
    assert len(rows) == 6
    starts = [parse(v["started_at"]) for v in rows]
    assert all(timedelta(days=6) < b - a < timedelta(days=8) for a, b in zip(starts, starts[1:]))  # about weekly
    now = utcnow()
    assert all(timedelta(days=5) < now - s < timedelta(days=43) for s in starts)  # past, within six weeks
    assert len({(s.astimezone(SEOUL).isocalendar().year, s.astimezone(SEOUL).isocalendar().week) for s in starts}) == 6
    hours = [s.astimezone(SEOUL).hour for s in starts]
    assert all(6 <= h <= 21 for h in hours) and len(set(hours)) >= 4  # ordinary times of day, not the same hour
    room = demo.room_id(org())
    assert {v["room_id"] for v in rows} == {room}
    for v in rows:
        assert parse(v["started_at"]) < parse(v["ended_at"]) < parse(v["expires_at"])
    assert q(sedens, "SELECT state FROM s_room_sessions WHERE student_id=? AND state='active'", customer()) == []


def test_each_visit_has_one_modest_completed_workout(sedens):
    for v in visits(sedens):
        found = q(sedens, "SELECT * FROM s_workouts WHERE room_session_id=?", v["id"])
        assert len(found) == 1
        w = found[0]
        assert w["state"] == "completed" and w["end_reason"] == "completed" and w["safety_category"] is None
        assert parse(v["started_at"]) < parse(w["started_at"]) < parse(w["ended_at"]) < parse(v["ended_at"])
        steps = q(sedens, "SELECT * FROM s_workout_steps WHERE workout_id=? ORDER BY position", w["id"])
        states = [s["state"] for s in steps]
        assert set(states) <= {"completed", "skipped"} and "completed" in states
        if w["kind"] == "standard":
            assert 15 * 60 <= w["active_seconds"] <= 30 * 60  # the room's 30 minute plan, a few steps skipped
            assert 1 <= states.count("skipped") <= 2
        else:
            # A guided course session lasts about as long as the course says; it is not stretched.
            assert 0.8 * w["planned_seconds"] <= w["active_seconds"] <= 1.5 * w["planned_seconds"]
            assert w["course_id"] and w["course_version"] == 1 and w["course_session_id"] and w["enrollment_id"]
        assert sum(s["finished_at"] is not None for s in steps) == len(steps)
        assert all(parse(a["finished_at"]) <= parse(b["started_at"]) for a, b in zip(steps, steps[1:]))
    total = q(sedens, "SELECT sum(active_seconds) AS s FROM s_workouts WHERE student_id=?", customer())[0]["s"]
    assert 45 * 60 <= total <= 90 * 60  # a modest total, not a heavy training log


def test_effort_values_are_middling_and_discomfort_is_at_most_one_mild_answer(sedens):
    rows = q(sedens, "SELECT f.*, w.started_at FROM s_session_feedback f JOIN s_workouts w ON w.id=f.workout_id "
                     "WHERE f.student_id=? ORDER BY w.started_at", customer())
    assert len(rows) == 6 and all(4 <= r["effort"] <= 6 for r in rows)
    efforts = [r["effort"] for r in rows]
    assert efforts != sorted(efforts) and len(set(efforts)) >= 2  # not an upward story
    uncomfortable = [r for r in rows if r["discomfort"] == "yes"]
    assert len(uncomfortable) <= 1
    for r in uncomfortable:
        assert r["discomfort_strength"] == "mild" and r["discomfort_urgent"] == 0 and r["discomfort_still"] == 0
    assert rows[-1]["discomfort"] == "no"  # the most recent visit leaves the next plan unrestricted
    for r in rows:
        steps = q(sedens, "SELECT state, count(*) AS n FROM s_workout_steps WHERE workout_id=? GROUP BY state", r["workout_id"])
        got = {s["state"]: s["n"] for s in steps}
        assert (r["completed_steps"], r["skipped_steps"]) == (got.get("completed", 0), got.get("skipped", 0))
        assert r["questions_version"] and r["outcome"] == "completed"


def test_the_shared_visit_records_agree_with_the_workouts(sedens):
    for w in q(sedens, "SELECT * FROM s_workouts WHERE student_id=?", customer()):
        session = q(sedens, "SELECT * FROM p_training_sessions WHERE id=?", w["training_session_id"])[0]
        recorder = q(sedens, "SELECT * FROM p_session_recorders WHERE session_id=?", session["id"])[0]
        assert recorder["role"] == "room" and recorder["user_id"] is None and recorder["name"]
        done = q(sedens, "SELECT exercise_ref FROM s_workout_steps WHERE workout_id=? AND state='completed' "
                         "AND exercise_ref<>'' ORDER BY position", w["id"])
        events = q(sedens, "SELECT * FROM p_session_exercise_events WHERE session_id=? ORDER BY sequence", session["id"])
        assert [e["completed_key"] for e in events] == [d["exercise_ref"] for d in done]
        assert [e["sequence"] for e in events] == list(range(1, len(events) + 1))
        assert json.loads(session["completed"]) == [e["completed_key"] for e in events]
        assert session["student_id"] == customer() and session["performed_at"] == w["started_at"]
    with sedens.db() as db:
        assert passport.summary(db, customer())["completed_visits"] == 6


# -- programs --------------------------------------------------------------------------------------


def test_the_three_programs_use_the_real_enrollment_entitlement_and_demo_checkout(sedens):
    with sedens.db() as db:
        me = student(sedens)
        rows = {r["title"]: dict(r) for r in db.execute(
            "SELECT e.*, c.title, c.published_version FROM s_enrollments e JOIN s_courses c ON c.id=e.course_id "
            "WHERE e.user_id=?", (customer(),))}
        assert set(rows) == set(COURSES)
        grants = {t: dict(db.execute("SELECT * FROM s_entitlements WHERE id=?", (r["entitlement_id"],)).fetchone())
                  for t, r in rows.items()}
        assert grants["SEDENS Standard: Foundations"]["source"] == "facility_included"
        assert grants["4-Week Core Foundations"]["source"] == "facility_included"
        assert grants["Mobility Foundations"]["source"] == "demo_purchase"
        purchase = dict(db.execute("SELECT * FROM s_purchases WHERE id=?",
                                   (grants["Mobility Foundations"]["purchase_id"],)).fetchone())
        assert purchase["provider"] == "demo" and purchase["state"] == "demo_completed"
        assert purchase["amount_minor"] == 29000 and purchase["currency"] == "KRW"
        for title, row in rows.items():
            course = db.execute("SELECT * FROM s_courses WHERE id=?", (row["course_id"],)).fetchone()
            assert row["version"] == row["published_version"] == 1  # the version the customer is pinned to
            assert access.entitlements(sedens, db, customer(), course)  # the entitlement stands today
            first = db.execute("SELECT min(started_at) FROM s_workouts WHERE student_id=? AND course_id=?",
                               (customer(), row["course_id"])).fetchone()[0]
            assert parse(row["enrolled_at"]) <= parse(first) and parse(grants[title]["granted_at"]) <= parse(first)
        assert parse(purchase["created_at"]) < utcnow() - timedelta(days=10)
        assert db.execute("SELECT count(*) FROM s_purchases WHERE user_id=?", (customer(),)).fetchone()[0] == 1
        assert me.demo and me.org_id == org()


def test_every_program_has_a_next_session_and_none_is_finished(sedens):
    with sedens.db() as db:
        items = {p["title"]: p for p in passport.programs(sedens, db, student(sedens), "en")["items"]}
    assert set(items) == set(COURSES)
    done = {t: (p["sessions"]["done"], p["sessions"]["total"]) for t, p in items.items()}
    assert done == {"SEDENS Standard: Foundations": (2, 3), "4-Week Core Foundations": (1, 2),
                    "Mobility Foundations": (1, 3)}
    for p in items.values():
        assert p["next_session"] and p["next_eligible"] and p["entitlement"]["status"] == "active"
        assert p["completed_at"] is None and p["pinned_version"] == 1
    assert items["Mobility Foundations"]["origin"]["code"] == "demo_purchase"
    assert items["4-Week Core Foundations"]["creator"]["display_name"] == "Minji Lee"


# -- scans -----------------------------------------------------------------------------------------


def test_the_two_seeded_scans_are_comparable_and_nearly_the_same(sedens):
    rows = q(sedens, "SELECT * FROM s_room_scans WHERE student_id=? ORDER BY completed_at", customer())
    assert len(rows) == 2
    for r in rows:
        assert r["source"] == "demo_precomputed" and r["origin"] == "demo_seed" and r["state"] == "complete"
        assert r["reliability"] == "clear" and r["protocol"] == scans.PROTOCOL and r["images_retained"] == 0
        assert r["measurement_version"] == "demo" and r["feedback_rules_version"] == feedback.CURRENT
        assert r["analysis_id"] is None
        evaluated = {e["rule_id"]: e["outcome"] for e in json.loads(r["summary"])["evaluated"]}
        assert evaluated[scan_history.OBSERVATION] in ("shown", "below_threshold")
        assert len(q(sedens, "SELECT * FROM s_room_scan_views WHERE scan_id=?", r["id"])) == 4
    ok, reasons = scan_history.comparable(rows[0], rows[1])
    assert ok and reasons == []
    weeks = (parse(rows[1]["completed_at"]) - parse(rows[0]["completed_at"])).days
    assert 21 <= weeks <= 28
    with sedens.db() as db:
        shown = passport.scan_comparison(sedens, db, student(sedens), "en")["comparison"]
        ko = passport.scan_comparison(sedens, db, student(sedens), "ko")["comparison"]
    rule = next(o for o in feedback.rules()["observations"] if o["id"] == "shoulder_line")
    assert shown["comparable"] and abs(shown["difference"]) < rule["change_threshold_deg"] / 4
    assert shown["demo"] is True and shown["versions"]["measurement"] == "demo"
    for text in (shown["text"], ko["text"]):
        assert not any(w in text.lower() for w in OVERCLAIMS)
    assert "didn't measure a difference larger" in shown["text"]
    for r in rows:
        for locale in ("en", "ko"):
            text = json.dumps(json.loads(r["summary"])["shown"][locale]["comparison"], ensure_ascii=False).lower()
            assert not any(w in text for w in OVERCLAIMS)
    # Each value stays within a few tenths of a degree of the demonstration scan the room uses.
    base = scans.demo_scan()["views"]
    for r in rows:
        for view, part in json.loads(r["summary"])["measurements"].items():
            for metric, m in part["metrics"].items():
                assert abs(m["value"] - base[view]["metrics"][metric]["value"]) <= 0.31


def test_a_scan_taken_in_the_room_is_never_compared_with_the_seeded_ones(sedens):
    seeded = q(sedens, "SELECT * FROM s_room_scans WHERE student_id=? ORDER BY completed_at", customer())[-1]
    live = {**seeded, "id": "live", "origin": "room"}
    ok, reasons = scan_history.comparable(seeded, live)
    assert not ok and "demo_vs_real" in reasons


# -- what the Passport shows -----------------------------------------------------------------------


def test_the_passport_reads_the_seed_and_flags_it_as_demo(sedens):
    me = student(sedens)
    with sedens.db() as db:
        o = passport.overview(sedens, db, me, "en")
        h = passport.history(sedens, db, me, "en", limit=50)
        s = passport.scans(sedens, db, me, "en")
        a = passport.achievements(sedens, db, me, "en")
        newest = next(c for c in h["items"] if c["kind"] == "room")
        workout = passport.workout(sedens, db, me, "en", newest["id"])["workout"]
    assert o["demo"] is True and o["totals"]["completed_visits"] == 6 and o["totals"]["room_visits"] == 0
    assert o["totals"]["demo_seed"]["visits"] == 6 and o["totals"]["demo_seed"]["workouts"] == 6
    assert o["totals"]["demo_seed"]["scans"] == 2 and o["scans"]["comparable_pair"] is True
    assert o["totals"]["workouts"] == {"completed": 6, "stopped": 0, "not_finished": 0}
    assert 45 <= o["totals"]["active_minutes"] <= 90
    assert o["consistency"]["weeks_with_visit"] == 6 and o["consistency"]["of"] == 8
    assert o["last_effort"]["value"] in (4, 5, 6) and o["latest_workout"]["origin"] == "demo_seed"
    assert o["current_program"]["title"] and o["next_session"]["session_title"]  # the next visit is obvious
    rooms_cards = [c for c in h["items"] if c["kind"] == "room"]
    assert len(rooms_cards) == 6 and {c["origin"] for c in rooms_cards} == {"demo_seed"}
    assert all(c["effort"]["value"] in (4, 5, 6) for c in rooms_cards)
    assert len(s["items"]) == 2 and {i["origin"] for i in s["items"]} == {"demo_seed"}
    assert s["items"][0]["previous"]["comparable"] is True and s["items"][1]["previous"] is None
    assert {x["id"] for x in a["items"]} >= {"first_workout", "first_course_session"}
    assert all(x["origin"] == "demo_seed" for x in a["items"])
    assert not any(w in json.dumps(a, ensure_ascii=False).lower() for w in OVERCLAIMS)
    assert workout["origin"] == "demo_seed" and workout["feedback"]["note"] == ""


# -- the facility meter and cleanup ----------------------------------------------------------------


def test_the_usage_meter_counts_nothing_of_the_seed(sedens):
    admin = sedens.repo.actor(sedens.repo.demo_login(KEY, "admin"))
    now = utcnow().astimezone(SEOUL)
    months = {(now - timedelta(days=30 * k)).strftime("%Y-%m") for k in range(3)}
    with sedens.db() as db:
        for month in sorted(months):
            report = usage.usage(sedens, db, admin, month)
            m = report["metrics"]
            assert m["billable_sessions"] == m["room_sessions"] == m["completed_workouts"] == 0
            assert m["used_minutes"] == m["repeat_customers"] == m["scan_retakes"] == m["technical_failures"] == 0
            assert report["demonstration"]["organization"] is True and report["demonstration"]["never_invoiced"]


def test_a_real_visit_after_the_seed_is_still_counted_apart_from_it(sedens):
    """A row with the default origin ('room') is billable; the seeded rows beside it are not."""
    tmp = "d4" * 16
    seed(sedens, tmp)
    me, stamp = customer(tmp), datetime.now(timezone.utc).replace(hour=3, minute=0, second=0, microsecond=0)
    with sedens.batch(), sedens.db() as db:
        base = dict(db.execute("SELECT * FROM s_room_sessions WHERE student_id=? ORDER BY started_at LIMIT 1", (me,)).fetchone())
        db.execute("INSERT INTO s_room_sessions(id,org_id,location_id,room_id,device_id,student_id,token_hash,entry_method,"
                   "crm_provider,state,simulated,started_at,expires_at,ended_at,end_reason) "
                   "VALUES ('live-visit',?,?,?,NULL,?,'live-hash','member_id','demo','ended',1,?,?,?, 'ended')",
                   (base["org_id"], base["location_id"], base["room_id"], me, stamp.isoformat(),
                    (stamp + timedelta(hours=2)).isoformat(), (stamp + timedelta(hours=1)).isoformat()))
        db.execute("INSERT INTO s_workouts(id,room_session_id,org_id,student_id,kind,state,active_seconds,plan,created_at,"
                   "started_at,ended_at,end_reason) VALUES ('live-workout','live-visit',?,?,'standard','completed',900,'{}',?,?,?,'completed')",
                   (base["org_id"], me, stamp.isoformat(), stamp.isoformat(), (stamp + timedelta(minutes=15)).isoformat()))
        db.execute("INSERT INTO s_workout_steps(workout_id,position,step_ref,phase,state) VALUES ('live-workout',0,'x','main','completed')")
        report = usage.usage(sedens, db, sedens.repo.actor(sedens.repo.demo_login(tmp, "admin")),
                             stamp.astimezone(SEOUL).strftime("%Y-%m"))
    assert report["metrics"]["billable_sessions"] == 1 and report["metrics"]["room_sessions"] == 1


def test_a_higher_layer_version_replaces_only_the_seeded_rows(sedens, monkeypatch):
    seed(sedens, SECOND)
    first = counts(sedens, SECOND)
    me, stamp = customer(SECOND), utcnow().isoformat()
    with sedens.batch(), sedens.db() as db:
        base = dict(db.execute("SELECT * FROM s_room_sessions WHERE student_id=? LIMIT 1", (me,)).fetchone())
        # What the visitor then did in the room: a visit of their own.
        db.execute("INSERT INTO s_room_sessions(id,org_id,location_id,room_id,device_id,student_id,token_hash,entry_method,"
                   "crm_provider,state,simulated,started_at,expires_at) VALUES ('mine',?,?,?,NULL,?,'mine-hash','member_id',"
                   "'demo','ended',1,?,?)", (base["org_id"], base["location_id"], base["room_id"], me, stamp, stamp))
    old = {r["id"] for r in q(sedens, "SELECT id FROM s_room_sessions WHERE origin='demo_seed' AND student_id=?", me)}
    monkeypatch.setattr(demo_history, "LAYER_VERSION", 2)
    demo.ensure(sedens, org(SECOND))
    demo.ensure(sedens, org(SECOND))
    assert counts(sedens, SECOND) == first
    new = {r["id"] for r in q(sedens, "SELECT id FROM s_room_sessions WHERE origin='demo_seed' AND student_id=?", me)}
    assert len(new) == 6 and not (old & new)  # replaced, not added to
    assert q(sedens, "SELECT origin FROM s_room_sessions WHERE id='mine'") == [{"origin": "room"}]
    assert q(sedens, "SELECT version FROM s_demo_layers WHERE org_id=? AND layer=?", org(SECOND), demo_history.LAYER) \
        == [{"version": 2}]
    assert q(sedens, "SELECT count(*) AS n FROM p_training_sessions WHERE student_id=? AND notes LIKE '%Demo data%'", me) \
        == [{"n": 6}]
    # The same customer, programs and sessions: the next one of each program is still open.
    with sedens.db() as db:
        items = passport.programs(sedens, db, student(sedens, SECOND), "en")["items"]
    assert len(items) == 3 and all(p["next_eligible"] for p in items)


def test_a_demonstration_without_its_customer_is_left_alone(sedens):
    key = "e5" * 16
    sedens.repo.logout(sedens.repo.demo_login(key, "admin"))
    with sedens.batch(), sedens.db() as db:
        db.execute("DELETE FROM p_users WHERE id=?", (customer(key),))
    demo.ensure(sedens, org(key))
    assert q(sedens, "SELECT * FROM s_demo_layers WHERE org_id=? AND layer=?", org(key), demo_history.LAYER) == []
    assert q(sedens, "SELECT count(*) AS n FROM s_room_sessions WHERE org_id=? AND origin='demo_seed'", org(key)) == [{"n": 0}]


def test_cleanup_removes_the_whole_demonstration_with_its_history(sedens):
    seed(sedens, THIRD)
    assert counts(sedens, THIRD)["visits"] == 6
    report = demo_cleanup.remove(sedens, THIRD)
    assert report["removed"] is True
    me = customer(THIRD)
    with sedens.db() as db:
        assert db.execute("PRAGMA foreign_key_check").fetchall() == []
        for table, column in (("s_room_sessions", "student_id"), ("s_workouts", "student_id"), ("s_room_scans", "student_id"),
                              ("s_session_feedback", "student_id"), ("s_enrollments", "user_id"),
                              ("s_entitlements", "user_id"), ("s_purchases", "user_id"),
                              ("p_training_sessions", "student_id"), ("s_room_journeys", "student_id")):
            assert db.execute(f"SELECT count(*) FROM {table} WHERE {column}=?", (me,)).fetchone()[0] == 0, table
        assert db.execute("SELECT count(*) FROM p_organizations WHERE id LIKE ?", (f"demo-{THIRD}%",)).fetchone()[0] == 0
        assert db.execute("SELECT count(*) FROM s_demo_layers WHERE org_id LIKE ?", (f"demo-{THIRD}%",)).fetchone()[0] == 0
    # The other demonstration is untouched.
    assert counts(sedens)["visits"] == 6
