"""Phase 4 (brief Part 12): the records a real room visit writes all belong to the right
customer and organization, mean what they say, and show up in the Fitness Passport.

A real flow runs through the same journey actions the room's HTTP routes run (the ``Visit``
helper): readiness, a (demonstration) scan, a SEDENS Standard recommendation, a workout with a
skipped step, the customer's feedback, and one session of a guided course. Retries, a refresh and a
failure in the middle of the end-of-session write are tested against the stored records. All people,
facilities and courses are fictional.
"""

from __future__ import annotations

import json

import pytest

from pilates.sedens import feedback, marketplace, passport, workouts
from pilates.sedens.util import Denied, decode, encode, iso, utcnow
from course_support import coach_creator, sedens_staff
from sedens_support import facility, make_sedens, pair
from test_sedens_passport import add_scan, add_visit, add_workout, FORBIDDEN
from test_sedens_room_plans import visit
from test_sedens_room_workouts import (course_visit, finish, guided_course, passport_completed, passport_events,
                                       progress_rows, step_rows, workout_row)


class World:
    pass


@pytest.fixture()
def world(tmp_path):
    w = World()
    w.sedens = sedens = make_sedens(tmp_path / "s.db", "demo_free")  # the labelled demonstration scan runs here
    _, w.reviewer, _ = sedens_staff(sedens)
    w.a, w.b = facility(sedens, "A"), facility(sedens, "B")
    w.coach = coach_creator(sedens, w.a)
    w.device = pair(sedens, w.a)
    w.device_b = pair(sedens, w.b)
    w.me, w.org = w.a["customer_id"], w.a["org_id"]
    return w


def rows(w, sql, *args):
    with w.sedens.db() as db:
        return [dict(r) for r in db.execute(sql, args)]


def one(w, sql, *args):
    found = rows(w, sql, *args)
    return found[0] if found else None


def actor(w, fac=None, key="customer_token"):
    return w.sedens.repo.actor((fac or w.a)[key])


def read(w, fn, *args, fac=None, key="customer_token", lang="en"):
    with w.sedens.db() as db:
        return fn(w.sedens, db, actor(w, fac, key), lang, *args)


def standard_visit(w, *, goal="core", skip=(3,), feedback=True, stop=None):
    """A full visit: readiness, a demonstration scan, a recommendation, the workout, feedback."""
    v = visit(w.sedens, w.a, w.device)
    v.ready()
    v.demo_scan()
    v.request(goal, 30, "moderate")
    v.act("plan/accept", recommendation=v.view["recommendation"]["id"])
    v.act("workout/start")
    if stop == "customer":
        v.act("workout/step", position=0, outcome="completed")
        v.act("workout/end")
    elif stop == "safety":
        v.act("workout/step", position=0, outcome="completed")
        v.act("workout/unwell", urgent=False, category="pain")
    elif stop == "leave":
        v.act("workout/step", position=0, outcome="completed")
    else:
        finish(v, skip=set(skip))
        if feedback:
            v.act("workout/feedback", effort=7, discomfort="no")
    return v


# == one real visit, record by record ============================================================


def test_a_real_visit_points_everything_at_the_right_customer_and_organization(world):
    w = world
    v = standard_visit(w)
    session = v.ctx.room_session_id
    w1 = workout_row(v)
    v.leave()
    # Another customer of the same facility, and one of the other facility, visit too.
    other = visit(w.sedens, w.a, pair(w.sedens, w.a, name="Second screen"), token_key="other_token")
    other.ready()
    other.demo_scan()
    other.request("mobility", 30, "light")
    other.act("plan/accept", recommendation=other.view["recommendation"]["id"])
    other.act("workout/start")
    finish(other)
    other.leave()
    stranger = visit(w.sedens, w.b, w.device_b)
    stranger.to_choice()
    stranger.request("core", 30, "moderate")
    stranger.act("plan/accept", recommendation=stranger.view["recommendation"]["id"])
    stranger.act("workout/start")
    finish(stranger)
    stranger.leave()

    mine = {"s_room_sessions": "id", "s_room_journeys": "room_session_id", "s_room_scans": "room_session_id",
            "s_recommendations": "room_session_id", "s_workouts": "room_session_id",
            "s_session_feedback": "room_session_id", "s_readiness_checks": "room_session_id"}
    for table, column in mine.items():
        found = rows(w, f"SELECT * FROM {table} WHERE {column}=?", session)
        assert found, table
        assert {(r["student_id"], r["org_id"]) for r in found} == {(w.me, w.org)}, table
    # Nothing links across customers or facilities: every record agrees with its visit.
    for table in ("s_room_journeys", "s_room_scans", "s_recommendations", "s_workouts", "s_session_feedback",
                  "s_readiness_checks"):
        assert rows(w, f"SELECT count(*) AS n FROM {table} t JOIN s_room_sessions s ON s.id=t.room_session_id "
                       f"WHERE t.student_id<>s.student_id OR t.org_id<>s.org_id")[0]["n"] == 0, table
    assert rows(w, "SELECT count(*) AS n FROM s_workouts x JOIN p_training_sessions t ON t.id=x.training_session_id "
                   "WHERE t.student_id<>x.student_id")[0]["n"] == 0
    assert rows(w, "SELECT count(*) AS n FROM s_session_feedback f JOIN s_workouts x ON x.id=f.workout_id "
                   "WHERE f.student_id<>x.student_id OR f.org_id<>x.org_id OR f.room_session_id<>x.room_session_id")[0]["n"] == 0
    assert rows(w, "SELECT count(*) AS n FROM s_recommendations r JOIN s_workouts x ON x.recommendation_id=r.id "
                   "WHERE r.student_id<>x.student_id OR r.org_id<>x.org_id OR r.room_session_id<>x.room_session_id")[0]["n"] == 0

    scan = one(w, "SELECT * FROM s_room_scans WHERE room_session_id=?", session)
    rec = one(w, "SELECT * FROM s_recommendations WHERE room_session_id=?", session)
    fb = one(w, "SELECT * FROM s_session_feedback WHERE workout_id=?", w1["id"])
    assert rec["scan_id"] == scan["id"] and w1["recommendation_id"] == rec["id"]
    assert (scan["origin"], scan["state"], scan["source"]) == ("room", "complete", "demo_precomputed")
    assert (w1["origin"], w1["state"], w1["end_reason"], w1["kind"]) == ("room", "completed", "completed", "standard")
    assert one(w, "SELECT origin FROM s_room_sessions WHERE id=?", session)["origin"] == "room"
    assert fb["effort"] == 7 and fb["training_session_id"] == w1["training_session_id"]
    recorded = [s["state"] for s in step_rows(v, w1["id"])]
    assert (fb["completed_steps"], fb["skipped_steps"]) == (recorded.count("completed"), 1)

    # What the Passport says is exactly that.
    detail = read(w, passport.workout, w1["id"])["workout"]
    states = [s["state"] for s in detail["steps"]]
    assert states.count("skipped") == 1 and states.count("completed") == len(states) - 1
    assert detail["feedback"]["effort"]["value"] == 7 and detail["scan"]["id"] == scan["id"]
    assert detail["status"] == "completed" and detail["origin"] == "room"
    overview = read(w, passport.overview)
    assert overview["totals"]["completed_visits"] == 1 and overview["totals"]["room_visits"] == 1
    assert overview["totals"]["workouts"] == {"completed": 1, "stopped": 0, "not_finished": 0}
    assert overview["scans"]["complete"] == 1 and overview["latest_workout"]["id"] == w1["id"]
    # The other customers see only their own.
    other_overview = read(w, passport.overview, key="other_token")
    assert other_overview["totals"]["completed_visits"] == 1 and other_overview["latest_workout"]["id"] != w1["id"]
    assert read(w, passport.overview, fac=w.b)["latest_workout"]["id"] not in (w1["id"], other_overview["latest_workout"]["id"])
    assert read(w, passport.history, None, 50, fac=w.b)["items"][0]["id"] not in {i["id"] for i in
                                                                                  read(w, passport.history, None, 50)["items"]}


def test_a_course_session_points_at_the_enrolled_version_and_the_same_customer(world):
    w = world
    view = guided_course(w.sedens, w.reviewer, w.a, w.coach, "Core Basics", sessions=2)
    cid = view["course"]["id"]
    first = view["modules"][0]["sessions"][0]["id"]
    v = course_visit(w.sedens, w.a, w.device)
    v.act("course/start", course_id=cid)
    v.act("workout/start")
    finish(v, skip={1})
    v.act("workout/feedback", effort=4, discomfort="no")
    row = workout_row(v)
    assert (row["kind"], row["course_id"], row["course_version"], row["course_session_id"]) == ("course", cid, 1, first)
    enrolled = one(w, "SELECT * FROM s_enrollments WHERE user_id=? AND course_id=?", w.me, cid)
    assert (enrolled["org_id"], enrolled["version"], row["enrollment_id"]) == (w.org, 1, enrolled["id"])
    assert one(w, "SELECT * FROM s_entitlements WHERE id=?", enrolled["entitlement_id"])["user_id"] == w.me
    [done] = progress_rows(v, cid)
    assert (done["item_kind"], done["item_id"]) == ("session", first)
    steps = step_rows(v, row["id"])
    assert [s["state"] for s in steps] == ["completed", "skipped"]
    events = passport_events(v, row["training_session_id"])
    assert [e["completed_key"] for e in events] == [steps[0]["exercise_ref"]]  # the skipped step is not an exercise
    assert one(w, "SELECT student_id FROM p_training_sessions WHERE id=?", row["training_session_id"])["student_id"] == w.me
    v.leave()
    [program] = read(w, passport.programs)["items"]
    assert program["pinned_version"] == 1 and program["sessions"] == {"done": 1, "total": 2, "remaining": 1}
    assert program["history"][0]["session_id"] == first and program["history"][0]["workout_id"] == row["id"]
    assert program["origin"]["code"] == "facility_included"
    card = read(w, passport.workout, row["id"])["workout"]
    assert card["course"]["version"] == 1 and card["course"]["title"] == "Core Basics"
    # The customer's course record is theirs alone.
    assert read(w, passport.programs, key="other_token")["items"] == []
    assert read(w, passport.programs, fac=w.b)["items"] == []


# == completed, stopped, abandoned =================================================================


def test_only_a_completed_workout_makes_a_completed_visit(world):
    w = world
    for stop in ("customer", "safety", "leave"):
        v = standard_visit(w, stop=stop)
        v.leave()
    assert read(w, passport.overview)["totals"]["completed_visits"] == 0
    statuses = [(i["status"], i["exercises_completed"]) for i in read(w, passport.history, None, 50)["items"]]
    assert sorted(statuses) == sorted([("stopped", 1), ("stopped", 1), ("not_finished", 1)])
    assert read(w, passport.achievements)["items"] == []
    # A completed workout in a visit makes it a completed visit, once, however many workouts it holds.
    v = standard_visit(w)
    v.act("workout/another")
    v.request("mobility", 30, "light")
    v.act("plan/accept", recommendation=v.view["recommendation"]["id"])
    v.act("workout/start")
    finish(v)
    v.leave()
    totals = read(w, passport.overview)["totals"]
    assert totals["completed_visits"] == 1 and totals["workouts"] == {"completed": 2, "stopped": 2, "not_finished": 1}
    assert {a["id"] for a in read(w, passport.achievements)["items"]} == {"first_workout"}


def test_a_workout_with_every_step_skipped_is_not_a_completed_visit(world):
    w = world
    v = standard_visit(w, skip=set(range(60)), feedback=False)
    v.leave()
    [card] = read(w, passport.history, None, 50)["items"]
    assert card["exercises_completed"] == 0 and card["exercises_skipped"] > 0
    totals = read(w, passport.overview)["totals"]
    # The record stays (its card says what happened) but nothing was performed, so it earns nothing.
    assert totals["completed_visits"] == 0
    assert read(w, passport.achievements)["items"] == []


def test_a_skipped_step_is_never_a_performed_exercise(world):
    w = world
    v = standard_visit(w, skip=(0, 2), feedback=False)
    row = workout_row(v)
    steps = step_rows(v, row["id"])
    skipped = {s["exercise_ref"] for s in steps if s["state"] == "skipped"}
    done = [s["exercise_ref"] for s in steps if s["state"] == "completed"]
    assert len(skipped) == 2
    events = passport_events(v, row["training_session_id"])
    assert [e["completed_key"] for e in events] == done and not skipped & {e["completed_key"] for e in events}
    assert passport_completed(v, row["training_session_id"]) == done
    v.leave()
    card = read(w, passport.history, None, 10)["items"][0]
    assert (card["exercises_completed"], card["exercises_skipped"]) == (len(done), 2)
    # Categories come only from completed steps: the count is the number of completed steps' categories.
    from pilates.sedens import standard
    by_key = {e["catalog_key"]: e for e in standard.exercises()}
    expected = sum(len(by_key[key]["categories"]) for key in done)
    assert sum(c["completed"] for c in read(w, passport.overview)["categories"]) == expected


# == retries ======================================================================================


def test_repeating_a_request_never_writes_a_second_completion_event_or_feedback(world):
    w = world
    v = standard_visit(w, feedback=False)
    row = workout_row(v)
    count = len(step_rows(v, row["id"]))
    snapshot = (len(passport_events(v, row["training_session_id"])), len(v.events("workout_completed")),
                len(v.events("exercise_completed")), len(v.events("exercise_skipped")))
    # The last step again, and every step again, after the workout is done: refused, nothing written.
    for position in range(count):
        for outcome in ("completed", "skipped"):
            refused = v.refused("workout/step", position=position, outcome=outcome)
            assert refused.code == "invalid_transition"
    assert v.refused("workout/start").code == "invalid_transition"
    # Feedback once; the same request again is refused and leaves one row.
    v.act("workout/feedback", effort=5, discomfort="no")
    for _ in range(3):
        assert v.refused("workout/feedback", effort=9, discomfort="yes", urgent=False, regions=[]).code == "feedback_recorded"
    [fb] = v.all("SELECT * FROM s_session_feedback WHERE workout_id=?", row["id"])
    assert fb["effort"] == 5 and len(v.events("session_feedback_submitted")) == 1
    after = (len(passport_events(v, row["training_session_id"])), len(v.events("workout_completed")),
             len(v.events("exercise_completed")), len(v.events("exercise_skipped")))
    assert after == snapshot
    assert len(v.all("SELECT * FROM s_workouts WHERE room_session_id=?", v.ctx.room_session_id)) == 1
    assert len(v.all("SELECT * FROM p_training_sessions WHERE student_id=?", w.me)) == 1
    v.leave()
    assert read(w, passport.overview)["totals"]["completed_visits"] == 1
    assert read(w, passport.overview)["totals"]["workouts"]["completed"] == 1


def test_repeating_a_course_completion_adds_no_progress_and_does_not_complete_twice(world):
    w = world
    view = guided_course(w.sedens, w.reviewer, w.a, w.coach, "One Session Course", sessions=1)
    cid, session = view["course"]["id"], view["modules"][0]["sessions"][0]["id"]
    v = course_visit(w.sedens, w.a, w.device)
    v.act("course/start", course_id=cid)
    v.act("workout/start")
    finish(v)
    [done] = progress_rows(v, cid)
    enrolled = one(w, "SELECT * FROM s_enrollments WHERE user_id=? AND course_id=?", w.me, cid)
    assert enrolled["completed_at"]  # the only session of the course
    # The room's own "complete" route, called again and again (a retry), and the last step again.
    for _ in range(3):
        with w.sedens.db() as db:
            marketplace.complete_room_session(w.sedens, db, v.ctx, cid, session)
        assert v.refused("workout/step", position=1, outcome="completed").code == "invalid_transition"
    assert progress_rows(v, cid) == [done]
    assert one(w, "SELECT completed_at FROM s_enrollments WHERE id=?", enrolled["id"])["completed_at"] == enrolled["completed_at"]
    assert len(v.events("workout_completed")) == 1
    assert len(v.all("SELECT * FROM s_workouts WHERE room_session_id=? AND state='completed'", v.ctx.room_session_id)) == 1
    v.leave()
    [program] = read(w, passport.programs)["items"]
    assert program["sessions"] == {"done": 1, "total": 1, "remaining": 0} and program["completed_at"] == enrolled["completed_at"]
    assert [a["id"] for a in read(w, passport.achievements)["items"] if a["id"].startswith("course")] == ["course_completed"]


def test_a_course_session_with_every_step_skipped_does_not_move_the_course(world):
    w = world
    view = guided_course(w.sedens, w.reviewer, w.a, w.coach, "Skip Course", sessions=2)
    cid = view["course"]["id"]
    first, second = (s["id"] for s in view["modules"][0]["sessions"])
    v = course_visit(w.sedens, w.a, w.device)
    v.act("course/start", course_id=cid)
    v.act("workout/start")
    finish(v, skip={0, 1, 2, 3, 4, 5, 6, 7, 8, 9})
    assert v.state == "session_complete"
    assert one(w, "SELECT state FROM s_workouts WHERE room_session_id=?", v.ctx.room_session_id)["state"] == "completed"
    assert progress_rows(v, cid) == []
    v.leave()
    [program] = read(w, passport.programs)["items"]
    assert program["sessions"]["done"] == 0 and program["next_session"]["session_id"] == first and program["history"] == []
    assert [a["id"] for a in read(w, passport.achievements)["items"] if a["id"].startswith("first_course")] == []
    # Next time, one performed step is enough: the progress is written once, a retry changes nothing.
    v = course_visit(w.sedens, w.a, w.device)
    v.act("course/start", course_id=cid)
    v.act("workout/start")
    finish(v, skip={1})
    [done] = progress_rows(v, cid)
    assert done["item_id"] == first
    with w.sedens.db() as db:
        marketplace.complete_room_session(w.sedens, db, v.ctx, cid, first)
    assert progress_rows(v, cid) == [done]
    v.leave()
    [program] = read(w, passport.programs)["items"]
    assert program["sessions"]["done"] == 1 and program["next_session"]["session_id"] == second
    assert [a["id"] for a in read(w, passport.achievements)["items"] if a["id"].startswith("first_course")] == \
        ["first_course_session"]


def test_the_course_completed_origin_comes_from_the_workouts_that_completed_it(world):
    w = world
    view = guided_course(w.sedens, w.reviewer, w.a, w.coach, "Origin Course", sessions=1)
    cid = view["course"]["id"]
    v = course_visit(w.sedens, w.a, w.device)
    v.act("course/start", course_id=cid)
    v.act("workout/start")
    finish(v)
    v.leave()
    got = {a["id"]: a["origin"] for a in read(w, passport.achievements)["items"]}
    assert got["course_completed"] == "room" and got["first_course_session"] == "room"
    with w.sedens.db() as db:
        db.execute("UPDATE s_workouts SET origin='demo_seed' WHERE course_id=?", (cid,))
    got = {a["id"]: a["origin"] for a in read(w, passport.achievements)["items"]}
    assert got["course_completed"] == "demo_seed" and got["first_course_session"] == "demo_seed"


# == refresh =====================================================================================


def test_the_end_of_session_data_is_readable_after_a_refresh(world):
    w = world
    v = standard_visit(w)
    before = v.view
    assert v.state == "session_complete" and before["workout"]["feedback_saved"] is True
    refreshed = v.refresh()  # a new GET of the journey
    assert refreshed["state"] == "session_complete" and refreshed["workout"]["summary"] == before["workout"]["summary"]
    assert refreshed["workout"]["feedback_saved"] is True and refreshed["workout"]["feedback"] is None
    from test_sedens_room_plans import Visit
    fresh = Visit(w.sedens, v.ctx, "en")  # a brand-new screen session for the same visit
    assert fresh.view["workout"]["summary"] == before["workout"]["summary"] and fresh.state == "session_complete"
    # The Passport, read before the visit ends and again after, says the same.
    first = read(w, passport.overview)
    v.leave()
    again = read(w, passport.overview)
    assert first["totals"] == again["totals"] and first["latest_workout"] == again["latest_workout"]
    assert again["latest_workout"]["effort"]["value"] == 7
    detail = read(w, passport.workout, again["latest_workout"]["id"])["workout"]
    assert detail["feedback"]["effort"]["value"] == 7 and detail["active_minutes"] == again["latest_workout"]["active_minutes"]
    # And through HTTP, on a phone, with its own request.
    from sedens_support import Client, running_server
    server, base = running_server(w.sedens.repo.path)
    try:
        phone = Client(base)
        phone.jar["motion_session"] = w.a["customer_token"]
        status, body = phone.call("GET", "/sedens/passport/overview?lang=en")
        assert status == 200 and body["totals"]["completed_visits"] == 1
        status, body = phone.call("GET", "/sedens/passport/history?lang=en")
        assert status == 200 and body["items"][0]["status"] == "completed"
        text = json.dumps([phone.call("GET", f"/sedens/passport/{p}?lang={lang}")[1]
                           for p in ("overview", "history", "scans", "achievements") for lang in ("en", "ko")],
                          ensure_ascii=False)
        # The scan summary's own disclaimer says the observation is "not about pain, injury or your health".
        for lang in ("en", "ko"):
            assert feedback.rules()["meaning"][lang] in text
            text = text.replace(json.dumps(feedback.rules()["meaning"][lang], ensure_ascii=False)[1:-1], "")
        text = text.lower()
        for word in FORBIDDEN:  # the real scan summary and the real workout titles say nothing medical or scored
            assert word not in text, word
    finally:
        server.shutdown()
        server.server_close()


# == a failure in the middle of the end-of-session write ===============================================


def snapshot(w, v):
    row = workout_row(v)
    return {
        "workout": rows(w, "SELECT state, current_index, ended_at, end_reason, active_seconds FROM s_workouts WHERE id=?", row["id"]),
        "steps": [(s["state"], s["finished_at"]) for s in step_rows(v, row["id"])],
        "events": passport_events(v, row["training_session_id"]),
        "completed": passport_completed(v, row["training_session_id"]),
        "analytics": rows(w, "SELECT name FROM s_events WHERE room_session_id=? ORDER BY id", v.ctx.room_session_id),
        "journey": v.one("SELECT state, revision FROM s_room_journeys WHERE room_session_id=?", v.ctx.room_session_id),
        "progress": rows(w, "SELECT * FROM s_course_progress"),
        "enrollments": rows(w, "SELECT completed_at FROM s_enrollments"),
    }


def test_a_failure_while_finishing_a_workout_leaves_no_partial_completion(world, monkeypatch):
    w = world
    v = visit(w.sedens, w.a, w.device)
    v.ready()
    v.demo_scan()
    v.request("core", 30, "moderate")
    v.act("plan/accept", recommendation=v.view["recommendation"]["id"])
    v.act("workout/start")
    last = len(step_rows(v, workout_row(v)["id"])) - 1
    for position in range(last):
        v.act("workout/step", position=position, outcome="completed")
    before = snapshot(w, v)
    real = workouts._event

    def failing(db, ctx, name, **props):
        if name == "workout_completed":
            raise RuntimeError("the disk failed in the middle of the write")
        return real(db, ctx, name, **props)
    monkeypatch.setattr(workouts, "_event", failing)
    with pytest.raises(RuntimeError):
        v.act("workout/step", position=last, outcome="completed")
    v.refresh()
    assert snapshot(w, v) == before  # the last step, the Passport event and the end of the workout: none kept
    assert v.state == "exercise" and v.view["workout"]["current_index"] == last
    assert read(w, passport.overview)["totals"]["completed_visits"] == 0
    monkeypatch.setattr(workouts, "_event", real)
    v.act("workout/step", position=last, outcome="completed")  # the retry completes it, exactly once
    assert v.state == "session_complete"
    after = snapshot(w, v)
    assert after["workout"][0]["state"] == "completed" and len(after["events"]) == len(before["events"]) + 1
    assert [s[0] for s in after["steps"]] == ["completed"] * (last + 1)
    v.leave()
    assert read(w, passport.overview)["totals"]["completed_visits"] == 1


def test_a_failure_while_recording_course_progress_leaves_the_workout_unfinished(world, monkeypatch):
    w = world
    view = guided_course(w.sedens, w.reviewer, w.a, w.coach, "One Session Course", sessions=1)
    cid = view["course"]["id"]
    v = course_visit(w.sedens, w.a, w.device)
    v.act("course/start", course_id=cid)
    v.act("workout/start")
    v.act("workout/step", position=0, outcome="completed")
    before = snapshot(w, v)
    real = marketplace._complete

    def failing(*args, **kwargs):
        real(*args, **kwargs)  # the progress row and the enrollment's completion are written ...
        raise RuntimeError("... and then the write fails")
    monkeypatch.setattr(marketplace, "_complete", failing)
    with pytest.raises(RuntimeError):
        v.act("workout/step", position=1, outcome="completed")
    v.refresh()
    assert snapshot(w, v) == before
    assert progress_rows(v, cid) == [] and one(w, "SELECT completed_at FROM s_enrollments")["completed_at"] is None
    monkeypatch.setattr(marketplace, "_complete", real)
    v.act("workout/step", position=1, outcome="completed")
    assert len(progress_rows(v, cid)) == 1 and one(w, "SELECT completed_at FROM s_enrollments")["completed_at"]
    v.leave()
    assert read(w, passport.programs)["items"][0]["sessions"]["done"] == 1


# == seeded demonstration history ======================================================================


def test_seeded_demonstration_history_is_not_room_activity(world):
    w = world
    with w.sedens.db() as db:
        v = add_visit(db, w.org, w.me, 30, origin="demo_seed")
        add_workout(db, w.org, w.me, v, "completed", 30, active=900, steps=("completed",) * 3, origin="demo_seed")
        add_scan(db, w.org, w.me, v, 30, origin="demo_seed", source="demo_precomputed", version="demo", model="demo",
                 sedens=w.sedens)
    events_before = rows(w, "SELECT count(*) AS n FROM s_events")[0]["n"]
    real = standard_visit(w)
    real.leave()
    totals = read(w, passport.overview)["totals"]
    assert totals["completed_visits"] == 2 and totals["room_visits"] == 1
    assert totals["demo_seed"] == {"visits": 1, "workouts": 1, "scans": 1, "studio_sessions": 0}
    # What is counted as activity actually performed in a room (what a usage meter would count) leaves the seed out.
    billable = rows(w, "SELECT count(DISTINCT s.id) AS n FROM s_room_sessions s JOIN s_workouts x ON x.room_session_id=s.id "
                       "WHERE s.org_id=? AND s.origin='room' AND x.origin='room' AND x.state='completed' "
                       "AND x.end_reason='completed'", w.org)[0]["n"]
    assert billable == 1
    items = read(w, passport.history, None, 50)["items"]
    assert sorted(i["origin"] for i in items) == ["demo_seed", "room"]
    # The seed wrote no analytics events of its own: only the real visit did.
    real_events = rows(w, "SELECT count(*) AS n FROM s_events WHERE room_session_id=?", real.ctx.room_session_id)[0]["n"]
    assert rows(w, "SELECT count(*) AS n FROM s_events")[0]["n"] == events_before + real_events
    assert not rows(w, "SELECT 1 FROM s_events e JOIN s_room_sessions s ON s.id=e.room_session_id WHERE s.origin='demo_seed'")
    # The seeded scan is never compared with the demonstration scan of the real visit.
    pair_ = read(w, passport.scans)["items"]
    assert [i["origin"] for i in pair_] == ["room", "demo_seed"]
    assert pair_[0]["previous"]["comparable"] is False and "demo_vs_real" in [r["code"] for r in pair_[0]["previous"]["reasons"]]
