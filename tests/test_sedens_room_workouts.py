"""Guided workouts in the room (Phase 3D/3E): stepping through a SEDENS Standard plan
or one session of a guided course, pausing and refreshing, easier/harder options,
stopping for safety, the customer's own feedback, and what reaches the Fitness
Passport (``p_training_sessions`` + ``p_session_exercise_events``) and course progress.

Logic runs through the journey actions exactly as ``POST /sedens/room/journey/<action>``
runs them (see ``Visit`` in test_sedens_room_plans.py); the room routes themselves
(``GET room/journey`` after a refresh, ``POST room/course/complete``) run over HTTP.
All people, facilities and courses are fictional.
"""

from __future__ import annotations

from datetime import timedelta
import io
import json

import pytest

from pilates import assessment
from pilates.sedens import course_review, courses, http as sedens_http, readiness, scans, standard, workouts
from pilates.sedens.util import decode, iso, utcnow
from course_support import (build_guided, coach_creator, facility_setting, professor_studio, publish,
                            sedens_staff, submit, approve)
from sedens_support import Client, facility, make_sedens, pair, room_code, running_server
from test_sedens_room_plans import BY_ID, RULES, Visit, room_world, visit

KRW_29000 = {"price_type": "paid", "amount_minor": 29000, "currency": "KRW", "sale_state": "active"}
NOTE_MARKER = "fictional-note-zebra-42"
# plans.history() reads the last workout's frozen plan with s["exercise_id"], but

@pytest.fixture()
def world(tmp_path):
    return room_world(tmp_path, "local_room")


# -- helpers ---------------------------------------------------------------------------------


def standard_workout(v, goal="general", duration=30, intensity="moderate", start=True):
    """A SEDENS Standard plan, accepted (and started)."""
    if v.state == "scan_intro" or v.state == "identified":
        if v.state == "identified":
            v.ready()
        v.act("scan/skip")
    v.request(goal, duration, intensity)
    v.act("plan/accept", recommendation=v.view["recommendation"]["id"])
    if start:
        v.act("workout/start")
    return v.view["workout"]


def workout_row(v):
    return v.one("SELECT * FROM s_workouts WHERE room_session_id=? AND end_reason<>'replaced' "
                 "ORDER BY created_at DESC, rowid DESC LIMIT 1", v.ctx.room_session_id)


def step_rows(v, workout_id):
    return v.all("SELECT * FROM s_workout_steps WHERE workout_id=? ORDER BY position", workout_id)


def passport_events(v, session_id):
    return v.all("SELECT * FROM p_session_exercise_events WHERE session_id=? ORDER BY sequence", session_id)


def passport_completed(v, session_id):
    return decode(v.one("SELECT completed FROM p_training_sessions WHERE id=?", session_id)["completed"], [])


def finish(v, skip=()):
    """Finish every remaining step from the current one, skipping the given positions."""
    while v.state == "exercise":
        position = v.view["workout"]["current_index"]
        v.act("workout/step", position=position, outcome="skipped" if position in skip else "completed")


def step_ago(v, seconds):
    """``seconds`` of exercise have passed in the running segment."""
    with v.sedens.db() as db:
        db.execute("UPDATE s_workouts SET segment_started_at=? WHERE id=?",
                   (iso(utcnow() - timedelta(seconds=seconds)), workout_row(v)["id"]))


# == stepping and the Passport ===================================================================


def test_finishing_a_step_twice_writes_it_once(world):
    sedens, fac, device = world
    v = visit(sedens, fac, device)
    w = standard_workout(v)
    assert v.state == "exercise" and w["current_index"] == 0 and w["steps"][0]["state"] == "active"
    key = w["steps"][0]["content"]["catalog_key"]
    v.act("workout/step", position=0, outcome="completed")
    v.act("workout/step", position=0, outcome="completed")  # a retry or a double tap
    v.act("workout/step", position=0, outcome="skipped")  # nor does another answer for a finished step
    row = workout_row(v)
    assert row["current_index"] == 1 and v.view["workout"]["current_index"] == 1
    assert [s["state"] for s in step_rows(v, row["id"])[:2]] == ["completed", "active"]
    events = passport_events(v, row["training_session_id"])
    assert [(e["sequence"], e["completed_key"]) for e in events] == [(1, key)]
    assert passport_completed(v, row["training_session_id"]) == [key]
    assert len(v.events("exercise_completed")) == 1 and v.events("exercise_skipped") == []
    assert [decode(e["props"], {})["position"] for e in v.events("exercise_started")] == [0, 1]
    # A step ahead of the current one means the screen is out of date.
    refused = v.refused("workout/step", position=3, outcome="completed")
    assert (refused.status, refused.code) == (409, "journey_changed")
    for body in ({"position": "1", "outcome": "completed"}, {"position": True, "outcome": "completed"},
                 {"position": 1, "outcome": "done"}, {"position": 99, "outcome": "completed"},
                 {"position": -1, "outcome": "completed"}, {"outcome": "completed"}):
        refused = v.refused("workout/step", **body)
        assert (refused.status, refused.code) == (400, "invalid"), body
    assert workout_row(v)["current_index"] == 1 and len(passport_events(v, row["training_session_id"])) == 1


def test_going_back_and_finishing_a_step_again_writes_nothing_new(world):
    sedens, fac, device = world
    v = visit(sedens, fac, device)
    standard_workout(v)
    assert v.refused("workout/previous").code == "invalid_transition"  # nothing before the first step
    v.act("workout/step", position=0, outcome="completed")
    v.act("workout/step", position=1, outcome="completed")
    row = workout_row(v)
    before = passport_events(v, row["training_session_id"])
    v.act("workout/previous")
    assert v.state == "exercise" and v.view["workout"]["current_index"] == 1 and v.view["workout"]["position_ms"] == 0
    v.act("workout/step", position=1, outcome="completed")
    v.act("workout/previous")
    v.act("workout/previous")
    assert v.view["workout"]["current_index"] == 0
    v.act("workout/step", position=0, outcome="skipped")  # first answer stays the only one
    v.act("workout/step", position=1, outcome="completed")
    assert workout_row(v)["current_index"] == 2
    assert passport_events(v, row["training_session_id"]) == before and len(before) == 2
    assert [s["state"] for s in step_rows(v, row["id"])[:3]] == ["completed", "completed", "active"]
    assert len(v.events("exercise_completed")) == 2 and v.events("exercise_skipped") == []


def test_a_skipped_step_writes_no_passport_event(world):
    sedens, fac, device = world
    v = visit(sedens, fac, device)
    w = standard_workout(v)
    v.act("workout/step", position=0, outcome="skipped")
    row = workout_row(v)
    assert step_rows(v, row["id"])[0]["state"] == "skipped"
    assert passport_events(v, row["training_session_id"]) == []
    assert passport_completed(v, row["training_session_id"]) == []
    assert len(v.events("exercise_skipped")) == 1 and v.events("exercise_completed") == []
    v.act("workout/step", position=1, outcome="completed")
    assert passport_completed(v, row["training_session_id"]) == [w["steps"][1]["content"]["catalog_key"]]


def test_finishing_the_last_step_completes_the_workout_and_writes_the_passport(world):
    sedens, fac, device = world
    v = visit(sedens, fac, device)
    w = standard_workout(v)
    finish(v, skip={1, 3})
    assert v.state == "session_complete"
    row = workout_row(v)
    assert (row["state"], row["end_reason"], row["safety_category"]) == ("completed", "completed", None)
    assert row["ended_at"] and row["segment_started_at"] is None
    done = [s["content"]["catalog_key"] for s in w["steps"] if s["position"] not in (1, 3)]
    events = passport_events(v, row["training_session_id"])
    assert [e["completed_key"] for e in events] == done == passport_completed(v, row["training_session_id"])
    assert [e["sequence"] for e in events] == list(range(1, len(done) + 1))
    recorder = v.one("SELECT * FROM p_session_recorders WHERE session_id=?", row["training_session_id"])
    assert (recorder["name"], recorder["role"], recorder["user_id"]) == ("SEDENS AI Private Room", "room", None)
    assert v.one("SELECT training_session_id FROM s_room_journeys WHERE room_session_id=?",
                 v.ctx.room_session_id)["training_session_id"] == row["training_session_id"]
    [event] = v.events("workout_completed")
    assert decode(event["props"], {}) == {"kind": "standard", "completed": len(done), "skipped": 2}
    summary = v.view["workout"]["summary"]
    assert summary["outcome"] == "completed" and summary["kind"] == "standard"
    assert summary["steps"] == {"completed": len(done), "skipped": 2, "total": len(w["steps"])}
    assert summary["focus"] == RULES["goals"]["general"]["label"]["en"] and summary["intensity"] == "Moderate"
    assert v.view["workout"]["feedback"]["effort"]["question"] and v.view["workout"]["feedback_saved"] is False
    assert v.refused("workout/step", position=0, outcome="completed").code == "invalid_transition"


def test_one_training_session_per_visit_with_a_scan_analysis_and_two_workouts(world, monkeypatch):
    sedens, fac, device = world
    v = visit(sedens, fac, device)
    v.ready()
    # A real room scan, analysed (the pose model faked) as the background job would.
    v.consent_to_scan()
    v.act("scan/begin")
    jobs = []
    monkeypatch.setattr(scans, "_start_job", lambda _sedens, scan_id: jobs.append(scan_id))
    monkeypatch.setattr(assessment, "photo", lambda payload, **_: {"people": [], "model": "fixture"})
    png = b"\x89PNG\r\n\x1a\n" + b"\0" * 64
    for view in ("front", "left", "back", "right"):
        scans.upload_image(sedens, v.ctx, view, io.BytesIO(png), len(png))
        v.act("scan/view", view=view)
    assert v.state == "scan_processing" and len(jobs) == 1
    scans.run_analysis(sedens, jobs[0])
    v.refresh()
    assert v.state == "scan_result"
    scan = v.one("SELECT * FROM s_room_scans WHERE id=?", jobs[0])
    visit_row = v.one("SELECT session_id FROM p_session_analyses WHERE analysis_id=?", scan["analysis_id"])["session_id"]
    v.act("scan/continue")

    first = standard_workout(v, "general", 30, "moderate")
    finish(v, skip={2})
    v.act("workout/another")
    second = standard_workout(v, "mobility", 30, "light")
    finish(v)
    sessions = v.all("SELECT id FROM p_training_sessions WHERE student_id=?", v.ctx.student_id)
    assert [s["id"] for s in sessions] == [visit_row]
    workouts_here = v.all("SELECT * FROM s_workouts WHERE room_session_id=? ORDER BY created_at, rowid",
                          v.ctx.room_session_id)
    assert [w["state"] for w in workouts_here] == ["completed", "completed"]
    assert {w["training_session_id"] for w in workouts_here} == {visit_row}
    keys = [s["content"]["catalog_key"] for s in first["steps"] if s["position"] != 2] + \
        [s["content"]["catalog_key"] for s in second["steps"]]
    assert passport_completed(v, visit_row) == keys
    assert [e["completed_key"] for e in passport_events(v, visit_row)] == keys
    assert [e["sequence"] for e in passport_events(v, visit_row)] == list(range(1, len(keys) + 1))


# == pause, resume and refresh ===================================================================


def test_pause_banks_active_time_and_keeps_the_position(world):
    sedens, fac, device = world
    v = visit(sedens, fac, device)
    standard_workout(v)
    v.act("workout/step", position=0, outcome="completed")
    step_ago(v, 90)
    v.act("workout/pause", position_ms=4200, reason="anatomy")
    row = workout_row(v)
    assert (row["state"], row["position_ms"], row["segment_started_at"]) == ("paused", 4200, None)
    assert 90 <= row["active_seconds"] <= 95
    assert v.state == "exercise_paused" and v.view["workout"]["current_index"] == 1
    assert decode(v.events("workout_paused")[0]["props"], {}) == {"reason": "anatomy", "position": 1}
    # A refresh (a new read of the journey) restores the same step and position.
    again = Visit(sedens, v.ctx)
    assert again.state == "exercise_paused"
    assert (again.view["workout"]["current_index"], again.view["workout"]["position_ms"]) == (1, 4200)
    assert [s["state"] for s in again.view["workout"]["steps"][:2]] == ["completed", "active"]
    # Time spent paused is not active time.
    v.act("workout/resume")
    row = workout_row(v)
    assert row["state"] == "active" and row["segment_started_at"] and 90 <= row["active_seconds"] <= 95
    assert v.state == "exercise" and len(v.events("workout_resumed")) == 1
    step_ago(v, 30)
    v.act("workout/pause", position_ms="not a number", reason="sleepy")
    row = workout_row(v)
    assert row["position_ms"] == 0 and 120 <= row["active_seconds"] <= 126
    assert decode(v.events("workout_paused")[-1]["props"], {})["reason"] == "customer"
    v.act("workout/resume")
    v.act("workout/pause", position_ms=10 ** 12)
    assert workout_row(v)["position_ms"] == 4 * 3600 * 1000
    assert v.refused("workout/pause").code == "invalid_transition"  # already paused
    assert v.refused("workout/step", position=1, outcome="completed").code == "invalid_transition"


# == easier and harder ===========================================================================


def test_standard_variants_come_only_from_the_library_links(world):
    sedens, fac, device = world
    v = visit(sedens, fac, device)
    w = standard_workout(v)
    for step in w["steps"]:
        entry = BY_ID[step["content"]["ref"]]
        links = {k: entry[k] for k in ("easier", "harder") if entry[k]}
        assert {k: c["ref"] for k, c in step["variants"].items()} == links, entry["id"]
    linked = next(s for s in w["steps"] if BY_ID[s["content"]["ref"]]["harder"])
    unlinked = w["steps"][0]
    assert not unlinked["variants"]
    refused = v.refused("workout/variant", position=0, variant="harder")
    assert (refused.status, refused.code) == (409, "variant_unavailable")
    assert v.refused("workout/variant", position=0, variant="easier").code == "variant_unavailable"
    assert v.refused("workout/variant", position=linked["position"], variant="harder").code == "journey_changed"
    assert v.refused("workout/variant", position=0, variant="hardest").status == 409
    finish_until(v, linked["position"])
    harder = BY_ID[BY_ID[linked["content"]["ref"]]["harder"]]
    v.act("workout/variant", position=linked["position"], variant="harder")
    row = workout_row(v)
    step = step_rows(v, row["id"])[linked["position"]]
    assert (step["variant"], step["exercise_ref"]) == ("harder", harder["catalog_key"])
    assert v.view["workout"]["steps"][linked["position"]]["variant"] == "harder"
    # Back to the planned exercise, then the harder one again, while paused.
    v.act("workout/variant", position=linked["position"], variant="standard")
    assert step_rows(v, row["id"])[linked["position"]]["exercise_ref"] == linked["content"]["catalog_key"]
    v.act("workout/pause", position_ms=1000)
    v.act("workout/variant", position=linked["position"], variant="harder")
    assert v.state == "exercise_paused"
    v.act("workout/resume")
    v.act("workout/step", position=linked["position"], outcome="completed")
    assert passport_completed(v, row["training_session_id"])[-1] == harder["catalog_key"]


def finish_until(v, position):
    while v.view["workout"]["current_index"] < position:
        v.act("workout/step", position=v.view["workout"]["current_index"], outcome="completed")


def complete_with_feedback(v, **feedback):
    finish(v)
    assert v.state == "session_complete"
    v.act("workout/feedback", **feedback)


def test_a_returning_customer_can_ask_for_a_plan_after_a_standard_workout(world):
    sedens, fac, device = world
    first = visit(sedens, fac, device)
    w = standard_workout(first)
    finish(first)
    first.leave()
    second = visit(sedens, fac, device)
    second.to_choice()
    second.request("general", 30, "moderate")  # KeyError: 'exercise_id' in plans.history
    rec = second.one("SELECT * FROM s_recommendations WHERE room_session_id=?", second.ctx.room_session_id)
    stored = decode(rec["inputs"], {})
    assert stored["last_plan"] == [s["content"]["ref"] for s in w["steps"]] and stored["last_days"] == 0
    assert "VARIETY_LAST_PLAN" in decode(rec["rules_fired"], [])


def test_reported_discomfort_keeps_the_next_visit_light_with_no_harder_options(world):
    sedens, fac, device = world
    first = visit(sedens, fac, device)
    standard_workout(first)
    complete_with_feedback(first, effort=5, discomfort="yes", urgent=False, regions=["lower_back"])
    first.leave()

    second = visit(sedens, fac, device)
    second.to_choice()
    second.request("general", 30, "moderate")
    rec = second.one("SELECT * FROM s_recommendations WHERE room_session_id=?", second.ctx.room_session_id)
    assert decode(rec["inputs"], {})["discomfort_hold"] is True
    assert "RECENT_DISCOMFORT_HOLD" in decode(rec["rules_fired"], [])
    assert [r["rule"] for r in decode(rec["rationale"], [])][2] == "RECENT_DISCOMFORT_HOLD"
    assert RULES["rules"][[r["id"] for r in RULES["rules"]].index("RECENT_DISCOMFORT_HOLD")][
        "customer_explanation"]["en"] in second.view["recommendation"]["reasons"]
    assert {BY_ID[s["exercise_id"]]["effort"] for s in second.view["recommendation"]["steps"]} == {"light"}
    second.act("plan/accept", recommendation=rec["id"])
    second.act("workout/start")
    steps = second.view["workout"]["steps"]
    assert any(BY_ID[s["content"]["ref"]]["harder"] for s in steps)  # the library would offer harder ones
    assert not any("harder" in s["variants"] for s in steps)
    target = next(s for s in steps if BY_ID[s["content"]["ref"]]["harder"])
    finish_until(second, target["position"])
    assert second.refused("workout/variant", position=target["position"], variant="harder").code == \
        "variant_unavailable"
    second.act("workout/end")
    second.leave()

    # Past the 30-day window the hold no longer applies.
    with sedens.db() as db:
        db.execute("UPDATE s_workouts SET ended_at=?, created_at=? WHERE room_session_id=?",
                   (iso(utcnow() - timedelta(days=31)), iso(utcnow() - timedelta(days=31)), first.ctx.room_session_id))
        db.execute("DELETE FROM s_workouts WHERE room_session_id=?", (second.ctx.room_session_id,))
    third = visit(sedens, fac, device)
    third.to_choice()
    third.request("general", 30, "moderate")
    rec = third.one("SELECT * FROM s_recommendations WHERE room_session_id=?", third.ctx.room_session_id)
    assert decode(rec["inputs"], {})["discomfort_hold"] is False and decode(rec["inputs"], {})["last_days"] == 31
    assert "RECENT_DISCOMFORT_HOLD" not in decode(rec["rules_fired"], [])
    assert "Your last session: 31 days ago" in third.view["recommendation"]["reasons"]


@pytest.mark.parametrize("effort,steps_down", [(8, True), (7, False)])
def test_a_session_that_felt_much_harder_than_planned_steps_down_next_time(world, effort, steps_down):
    sedens, fac, device = world
    first = visit(sedens, fac, device)
    standard_workout(first, intensity="moderate")
    complete_with_feedback(first, effort=effort, discomfort="no")
    first.leave()
    second = visit(sedens, fac, device)
    second.to_choice()
    second.request("general", 30, "moderate")
    rec = second.one("SELECT * FROM s_recommendations WHERE room_session_id=?", second.ctx.room_session_id)
    assert decode(rec["inputs"], {})["hard_step_down"] is steps_down
    assert ("RECENT_HARD_STEP_DOWN" in decode(rec["rules_fired"], [])) is steps_down
    reasons = second.view["recommendation"]["reasons"]
    assert any(r.startswith("Your last session felt harder") for r in reasons) is steps_down
    assert "Your last session: earlier today" in reasons


# == stopping =====================================================================================


@pytest.mark.parametrize("body,category,where", [
    ({"urgent": True}, "urgent", "exercise"),
    ({"urgent": False, "category": "pain"}, "pain", "exercise"),
    ({"urgent": False, "category": "dizzy"}, "dizzy", "exercise_paused"),
    ({"urgent": False, "category": "unwell"}, "unwell", "ready_to_train"),
    ({"urgent": False, "category": "other"}, "other", "exercise"),
])
def test_i_dont_feel_well_stops_for_safety_and_no_other_session_follows(world, body, category, where):
    sedens, fac, device = world
    v = visit(sedens, fac, device)
    standard_workout(v, start=where != "ready_to_train")
    if where != "ready_to_train":
        v.act("workout/step", position=0, outcome="completed")
    if where == "exercise_paused":
        v.act("workout/pause", position_ms=500)
    for bad in ({}, {"urgent": "yes"}, {"urgent": 1}, {"urgent": False}, {"urgent": False, "category": "bored"},
                {"urgent": False, "category": "urgent"}):
        assert v.refused("workout/unwell", **bad).code == "invalid", bad
    assert v.state == where and v.events("safety_stop") == []
    v.act("workout/unwell", **body)
    assert v.state == "session_complete"
    row = workout_row(v)
    assert (row["state"], row["end_reason"], row["safety_category"]) == ("stopped", "safety_stop", category)
    assert row["ended_at"] and row["segment_started_at"] is None
    [stop] = v.events("safety_stop")
    assert decode(stop["props"], {}) == {"category": category, "position": 1 if where != "ready_to_train" else 0}
    assert v.events("workout_completed") == []
    assert decode(v.events("session_abandoned")[0]["props"], {})["reason"] == "safety_stop"
    shown = v.view["workout"]
    assert shown["summary"]["outcome"] == "stopped" and shown["summary"]["safety_category"] == category
    copy = workouts.feedback_copy()
    if category == "urgent":  # get help now (119), and no questionnaire
        assert shown["safety"] == {"title": copy["urgent"]["title"]["en"], "body": copy["urgent"]["body"]["en"]}
        assert "119" in shown["safety"]["body"] and shown["feedback"] is None
    else:  # the calm stop guidance, then the usual questions
        assert shown["safety"]["body"] == readiness.unwell_copy("en")["guidance"] and shown["safety"]["body"]
        assert shown["feedback"]["effort"]["question"]
    # What was done before the stop stays done; nothing else is written.
    done = passport_events(v, row["training_session_id"]) if row["training_session_id"] else []
    assert len(done) == (0 if where == "ready_to_train" else 1)
    # No other session follows in this visit, and the stopped workout never continues.
    for name in ("workout/another", "workout/resume", "workout/start"):
        refused = v.refused(name)
        assert refused.status == 409 and v.state == "session_complete", name
    assert v.refused("workout/another").code == "safety_stopped"
    assert v.refused("workout/step", position=1, outcome="completed").code == "invalid_transition"
    assert workout_row(v)["state"] == "stopped"


def test_ending_the_workout_early_is_saved_as_stopped(world):
    sedens, fac, device = world
    v = visit(sedens, fac, device)
    standard_workout(v)
    v.act("workout/step", position=0, outcome="completed")
    v.act("workout/end")
    row = workout_row(v)
    assert (v.state, row["state"], row["end_reason"], row["safety_category"]) == \
        ("session_complete", "stopped", "customer_ended", None)
    assert decode(v.events("session_abandoned")[0]["props"], {})["reason"] == "customer_ended"
    assert len(passport_events(v, row["training_session_id"])) == 1  # what was done stays done
    v.act("workout/feedback", effort=None, discomfort="no")
    assert v.notice == {"code": "thanks"}
    fb = v.one("SELECT * FROM s_session_feedback WHERE workout_id=?", row["id"])
    assert (fb["effort"], fb["outcome"], fb["completed_steps"]) == (None, "stopped", 1)
    v.act("workout/another")
    assert v.state == "session_choice"


def test_ending_the_visit_mid_workout_keeps_it_as_abandoned(world):
    sedens, fac, device = world
    v = visit(sedens, fac, device)
    w = standard_workout(v)
    v.act("workout/step", position=0, outcome="completed")
    step_ago(v, 40)
    v.leave()
    row = workout_row(v)
    assert (row["state"], row["end_reason"], row["segment_started_at"]) == ("abandoned", "visit_ended", None)
    assert row["ended_at"] and 40 <= row["active_seconds"] <= 45
    assert passport_completed(v, row["training_session_id"]) == [w["steps"][0]["content"]["catalog_key"]]
    j = v.one("SELECT * FROM s_room_journeys WHERE room_session_id=?", v.ctx.room_session_id)
    assert (j["state"], j["end_reason"]) == ("ended", "visit_ended")
    assert v.one("SELECT state FROM s_room_sessions WHERE id=?", v.ctx.room_session_id)["state"] == "ended"


def test_an_expired_room_session_keeps_its_open_workout_as_abandoned(world):
    sedens, fac, device = world
    v = visit(sedens, fac, device)
    standard_workout(v)
    with sedens.db() as db:
        db.execute("UPDATE s_room_sessions SET state='expired' WHERE id=?", (v.ctx.room_session_id,))
    visit(sedens, fac, device)  # the customer's next visit closes what the last one left open
    row = workout_row(v)
    assert (row["state"], row["end_reason"]) == ("abandoned", "room_session_closed")


# == session feedback =============================================================================


BAD_FEEDBACK = [
    {"effort": True}, {"effort": "5"}, {"effort": 11}, {"effort": -1}, {"effort": 5.5},
    {"effort": 5, "discomfort": "maybe"}, {"effort": 5, "discomfort": True},
    {"discomfort": "yes"}, {"discomfort": "yes", "urgent": "no"},
    {"discomfort": "yes", "urgent": False, "regions": ["elbow"]},
    {"discomfort": "yes", "urgent": False, "regions": "lower_back"},
    {"discomfort": "yes", "urgent": False, "regions": ["hip"], "when": "yesterday"},
    {"discomfort": "yes", "urgent": False, "regions": ["hip"], "strength": "extreme"},
    {"discomfort": "yes", "urgent": False, "regions": ["hip"], "still": "yes"},
    {"effort": 4, "note": "x" * 281}, {"effort": 4, "note": 123},
]


def test_feedback_is_validated_saved_once_and_its_note_never_reaches_analytics(world):
    sedens, fac, device = world
    v = visit(sedens, fac, device)
    standard_workout(v, intensity="moderate")
    finish(v, skip={0})
    row = workout_row(v)
    for body in BAD_FEEDBACK:
        refused = v.refused("workout/feedback", **body)
        assert (refused.status, refused.code) == (400, "invalid"), body
        assert v.one("SELECT 1 FROM s_session_feedback WHERE workout_id=?", row["id"]) is None
    note = (NOTE_MARKER + " my left hip felt tight on the side-lying work. ") * 6
    note = note[:280]
    v.act("workout/feedback", effort=6, discomfort="yes", urgent=False, regions=["hip", "lower_back", "hip"],
          when="after", strength="mild", still=False, note=note)
    assert v.notice == {"code": "discomfort"}
    fb = v.one("SELECT * FROM s_session_feedback WHERE workout_id=?", row["id"])
    assert (fb["effort"], fb["discomfort"], fb["discomfort_urgent"], fb["discomfort_when"], fb["discomfort_strength"],
            fb["discomfort_still"]) == (6, "yes", 0, "after", "mild", 0)
    assert decode(fb["discomfort_regions"], []) == ["lower_back", "hip"]  # the listed order, once each
    assert fb["note"] == note.strip() and fb["target_intensity"] == "moderate"
    assert fb["questions_version"] == workouts.FEEDBACK_VERSION and fb["outcome"] == "completed"
    assert (fb["completed_steps"], fb["skipped_steps"]) == (len(step_rows(v, row["id"])) - 1, 1)
    assert fb["training_session_id"] == row["training_session_id"]
    # Once only.
    refused = v.refused("workout/feedback", effort=3, discomfort="no")
    assert (refused.status, refused.code) == (409, "feedback_recorded")
    assert v.one("SELECT effort FROM s_session_feedback WHERE workout_id=?", row["id"])["effort"] == 6
    assert v.view["workout"]["feedback"] is None and v.view["workout"]["feedback_saved"] is True
    assert v.view["workout"]["after_feedback"]
    # The note stays in the feedback record: no event of any kind carries it.
    [event] = v.events("session_feedback_submitted")
    assert decode(event["props"], {}) == {"effort": 6, "discomfort": True, "urgent": False, "skipped_effort": False}
    with sedens.db() as db:
        for event_row in db.execute("SELECT * FROM s_events"):
            assert not any(NOTE_MARKER in str(value) for value in tuple(event_row)), dict(event_row)


def test_urgent_discomfort_is_answered_with_help_now(world):
    sedens, fac, device = world
    v = visit(sedens, fac, device)
    standard_workout(v)
    finish(v)
    v.act("workout/feedback", effort=9, discomfort="yes", urgent=True, regions=["elbow"])  # follow-ups not asked
    assert v.notice == {"code": "urgent"}
    fb = v.one("SELECT * FROM s_session_feedback WHERE workout_id=?", workout_row(v)["id"])
    assert (fb["discomfort_urgent"], decode(fb["discomfort_regions"], [])) == (1, [])
    assert v.view["workout"]["after_feedback"] == workouts.feedback_copy()["urgent"]["body"]["en"]


def test_feedback_only_on_the_completion_screen(world):
    sedens, fac, device = world
    v = visit(sedens, fac, device)
    standard_workout(v)
    assert v.refused("workout/feedback", effort=5, discomfort="no").code == "invalid_transition"
    assert v.all("SELECT * FROM s_session_feedback") == []


# == guided courses ===============================================================================


@pytest.fixture()
def course_world(tmp_path):
    sedens = make_sedens(tmp_path / "s.db")
    _, reviewer, _ = sedens_staff(sedens)
    fac = facility(sedens, "A")
    coach = coach_creator(sedens, fac)
    return sedens, reviewer, fac, coach, pair(sedens, fac)


def guided_course(sedens, reviewer, fac, coach, title="Core Basics", sessions=2,
                  steps=("std-pelvic-curl", "std-breathing"), easier=None):
    """A free guided course, included by the facility. ``easier`` adds a creator-authored
    easier variant (that Standard exercise) to the first step of every session."""
    view = build_guided(sedens, coach, title, sessions=sessions, steps=steps)
    if easier:
        for n in range(sessions):
            session = view["modules"][0]["sessions"][n]
            with sedens.db() as db:
                view = courses.save_step(sedens, db, coach, {
                    "course_id": view["course"]["id"], "revision": view["revision"], "session_id": session["id"],
                    "exercise_source": "standard", "exercise_ref": easier, "reps": 6, "variant": "easier",
                    "variant_of": session["steps"][0]["id"], "customer_cue": "A smaller movement."})
    view = publish(sedens, coach, reviewer, view, "selected_facilities", [{"org_id": fac["org_id"], "free": True}])
    facility_setting(sedens, fac, view["course"]["id"], enabled=True, included=True)
    return view


def course_visit(sedens, fac, device, token_key="customer_token"):
    v = visit(sedens, fac, device, demo=False, token_key=token_key)
    v.to_choice()
    return v


def progress_rows(v, course_id):
    return v.all("SELECT p.* FROM s_course_progress p JOIN s_enrollments e ON e.id=p.enrollment_id "
                 "WHERE e.user_id=? AND e.course_id=?", v.ctx.student_id, course_id)


def test_course_start_plays_the_enrolled_version_never_silently_a_newer_one(course_world):
    sedens, reviewer, fac, coach, device = course_world
    view = guided_course(sedens, reviewer, fac, coach)
    cid = view["course"]["id"]
    first_session, second_session = (s["id"] for s in view["modules"][0]["sessions"])
    v1_steps = [s["id"] for s in view["modules"][0]["sessions"][0]["steps"]]

    v = course_visit(sedens, fac, device)
    offered = {c["course_id"]: c for c in v.view["choice"]["courses"]}
    assert offered[cid]["enrolled"] is False
    v.act("course/start", course_id=cid)
    assert v.state == "ready_to_train" and v.view["path"] == "course"
    row = workout_row(v)
    assert (row["kind"], row["course_version"], row["course_session_id"]) == ("course", 1, first_session)
    assert v.one("SELECT version FROM s_enrollments WHERE user_id=? AND course_id=?", v.ctx.student_id, cid)["version"] == 1
    assert v.view["workout"]["course_version"] == 1
    assert [s["content"]["ref"] for s in v.view["workout"]["steps"]] == v1_steps
    v.act("workout/start")
    finish(v)
    v.leave()

    # The creator changes the first session; version 2 is reviewed and published.
    with sedens.db() as db:
        editor = courses.editor_view(sedens, db, coach, cid)
        editor = courses.save_step(sedens, db, coach, {"course_id": cid, "revision": editor["revision"],
                                                       "session_id": first_session, "exercise_source": "standard",
                                                       "exercise_ref": "std-clam", "reps": 8, "sides": "each_side"})
    approve(sedens, reviewer, submit(sedens, coach, editor)["course"]["id"])
    with sedens.db() as db:
        assert courses.row(db, cid)["published_version"] == 2

    v = course_visit(sedens, fac, device)
    offered = {c["course_id"]: c for c in v.view["choice"]["courses"]}
    assert offered[cid]["enrolled"] is True and offered[cid]["progress"]["version"] == 1
    assert offered[cid]["progress"]["next"]["session_id"] == second_session
    v.act("course/start", course_id=cid)  # the next session, from version 1
    assert (workout_row(v)["course_version"], workout_row(v)["course_session_id"]) == (1, second_session)
    v.act("workout/cancel")
    v.act("course/start", course_id=cid, session_id=first_session)  # repeating the changed session
    row = workout_row(v)
    assert (row["course_version"], row["course_session_id"]) == (1, first_session)
    assert [s["content"]["ref"] for s in v.view["workout"]["steps"]] == v1_steps  # not version 2's three steps
    assert decode(row["plan"], {})["version"] == 1 and v.view["workout"]["course_version"] == 1
    replaced = v.all("SELECT state, end_reason FROM s_workouts WHERE room_session_id=? ORDER BY created_at, rowid",
                     v.ctx.room_session_id)
    assert replaced == [{"state": "abandoned", "end_reason": "replaced"}, {"state": "ready", "end_reason": ""}]

    # The control: someone enrolling now gets version 2 and its three steps.
    other = course_visit(sedens, fac, pair(sedens, fac, name="Second screen"), token_key="other_token")
    other.act("course/start", course_id=cid, session_id=first_session)
    assert workout_row(other)["course_version"] == 2 and len(other.view["workout"]["steps"]) == 3


def test_course_progress_is_written_only_when_the_workout_completes(course_world):
    sedens, reviewer, fac, coach, device = course_world
    view = guided_course(sedens, reviewer, fac, coach)
    cid = view["course"]["id"]
    first_session = view["modules"][0]["sessions"][0]["id"]

    v = course_visit(sedens, fac, device)
    v.act("course/start", course_id=cid)
    assert progress_rows(v, cid) == []
    v.act("workout/start")
    v.act("workout/step", position=0, outcome="completed")
    assert progress_rows(v, cid) == []
    v.act("workout/unwell", urgent=False, category="pain")
    assert progress_rows(v, cid) == []
    assert v.view["workout"]["summary"]["course_progress"] == {"completed": 0, "total": 2, "version": 1}
    v.leave()

    v = course_visit(sedens, fac, device)
    v.act("course/start", course_id=cid)
    assert workout_row(v)["course_session_id"] == first_session  # still the first session
    v.act("workout/start")
    v.act("workout/end")
    assert progress_rows(v, cid) == []
    v.act("workout/another")
    v.act("course/start", course_id=cid)
    v.act("workout/start")
    finish(v, skip={1})
    assert v.state == "session_complete"
    [done] = progress_rows(v, cid)
    assert (done["item_kind"], done["item_id"]) == ("session", first_session)
    assert v.view["workout"]["summary"]["course_progress"] == {"completed": 1, "total": 2, "version": 1}
    assert v.view["workout"]["title"] == "Core Basics" and "Session 1" in v.view["workout"]["subtitle"]


def test_course_variants_only_where_the_creator_authored_them(course_world):
    sedens, reviewer, fac, coach, device = course_world
    view = guided_course(sedens, reviewer, fac, coach, sessions=1, easier="std-imprint-release")
    cid = view["course"]["id"]
    session = view["modules"][0]["sessions"][0]
    main, variant = session["steps"][0], next(s for s in session["steps"] if s["variant_of"])
    assert BY_ID["std-pelvic-curl"]["harder"]  # the Standard library links a harder one; the course did not

    v = course_visit(sedens, fac, device)
    v.act("course/start", course_id=cid)
    v.act("workout/start")
    steps = v.view["workout"]["steps"]
    assert len(steps) == 2  # the variant is an option, not a step of its own
    assert {k: c["ref"] for k, c in steps[0]["variants"].items()} == {"easier": variant["id"]}
    assert steps[1]["variants"] == {}
    assert v.refused("workout/variant", position=0, variant="harder").code == "variant_unavailable"
    v.act("workout/variant", position=0, variant="easier")
    row = workout_row(v)
    imprint = BY_ID["std-imprint-release"]["catalog_key"]
    assert step_rows(v, row["id"])[0]["variant"] == "easier" and step_rows(v, row["id"])[0]["exercise_ref"] == imprint
    v.act("workout/step", position=0, outcome="completed")
    assert v.refused("workout/variant", position=1, variant="easier").code == "variant_unavailable"
    v.act("workout/step", position=1, outcome="completed")
    assert passport_completed(v, row["training_session_id"]) == [imprint, BY_ID["std-breathing"]["catalog_key"]]
    assert main["id"] == steps[0]["content"]["ref"]


def test_a_course_step_shows_the_library_instructions_and_the_creators_own_cue_once(course_world):
    sedens, reviewer, fac, coach, device = course_world
    view = guided_course(sedens, reviewer, fac, coach, sessions=1, easier="std-imprint-release")
    cid = view["course"]["id"]
    authored = view["modules"][0]["sessions"][0]["steps"][0]
    v = course_visit(sedens, fac, device)
    v.act("course/start", course_id=cid)
    step = v.view["workout"]["steps"][0]
    content, entry = step["content"], BY_ID["std-pelvic-curl"]
    # How to do it comes from the SEDENS Standard exercise the creator picked ...
    assert content["setup"] == entry["setup"]["en"]
    assert content["instructions"] == [x["en"] for x in entry["steps"]]
    assert content["breath"] == entry["breath"]["en"] and content["stop_if"] == entry["stop_if"]["en"]
    # ... and what the creator wrote stays theirs, shown once, not as the setup too.
    assert content["cue"] == authored["customer_cue"] and content["setup"] != content["cue"]
    assert step["variants"]["easier"]["setup"] == BY_ID["std-imprint-release"]["setup"]["en"]
    # The instructions are frozen with the workout, so a resumed page shows the same text.
    plan = json.loads(workout_row(v)["plan"])
    assert plan["steps"][0]["library"]["ref"] == "std-pelvic-curl"
    assert plan["steps"][0]["library"]["standard_version"] == standard.document()["version"]


def test_discomfort_after_a_course_session_keeps_the_next_standard_plan_light(course_world):
    """RECENT_DISCOMFORT_HOLD end to end: discomfort reported within 30 days gives a
    light-only Standard plan, and its workout offers no harder variants."""
    sedens, reviewer, fac, coach, device = course_world
    cid = guided_course(sedens, reviewer, fac, coach)["course"]["id"]
    first = course_visit(sedens, fac, device)
    first.act("course/start", course_id=cid)
    first.act("workout/start")
    complete_with_feedback(first, effort=4, discomfort="yes", urgent=False, regions=["lower_back"])
    assert first.notice == {"code": "discomfort"}
    first.leave()

    second = visit(sedens, fac, device)  # a demonstration room: today's library is unreviewed
    second.to_choice()
    second.request("general", 30, "moderate")
    rec = second.one("SELECT * FROM s_recommendations WHERE room_session_id=?", second.ctx.room_session_id)
    stored = decode(rec["inputs"], {})
    assert (stored["discomfort_hold"], stored["hard_step_down"], stored["last_days"]) == (True, False, 0)
    assert stored["experience"] == "new" and stored["last_plan"] == []  # a course plan is not Standard history
    assert "RECENT_DISCOMFORT_HOLD" in decode(rec["rules_fired"], [])
    assert [r["rule"] for r in decode(rec["rationale"], [])] == [
        "GOAL_PHASE_CATEGORIES", "INTENSITY_EFFORT", "RECENT_DISCOMFORT_HOLD", "LAST_SESSION_CONTEXT"]
    hold_text = next(r for r in RULES["rules"] if r["id"] == "RECENT_DISCOMFORT_HOLD")["customer_explanation"]["en"]
    assert hold_text in second.view["recommendation"]["reasons"]
    plan_steps = second.view["recommendation"]["steps"]
    assert {BY_ID[s["exercise_id"]]["effort"] for s in plan_steps} == {"light"}
    assert 27 <= second.view["recommendation"]["estimated_minutes"] <= 33
    second.act("plan/accept", recommendation=rec["id"])
    second.act("workout/start")
    steps = second.view["workout"]["steps"]
    linked = [s for s in steps if BY_ID[s["content"]["ref"]]["harder"]]
    assert linked  # the library links harder exercises for some of these steps
    assert not any("harder" in s["variants"] for s in steps)
    # Easier options stay where the library links them.
    for s in steps:
        easier = BY_ID[s["content"]["ref"]]["easier"]
        assert {k: c["ref"] for k, c in s["variants"].items()} == ({"easier": easier} if easier else {})
    target = linked[0]
    finish_until(second, target["position"])
    refused = second.refused("workout/variant", position=target["position"], variant="harder")
    assert (refused.status, refused.code) == (409, "variant_unavailable")
    assert step_rows(second, workout_row(second)["id"])[target["position"]]["variant"] == "standard"
    second.act("workout/end")
    second.leave()

    # Outside the 30-day window the hold no longer applies (the course session is the
    # last workout: the visit above ended its own workout early, so drop that one).
    with sedens.db() as db:
        db.execute("DELETE FROM s_workouts WHERE room_session_id=?", (second.ctx.room_session_id,))
        db.execute("UPDATE s_workouts SET ended_at=?, created_at=? WHERE room_session_id=?",
                   (iso(utcnow() - timedelta(days=31)), iso(utcnow() - timedelta(days=31)), first.ctx.room_session_id))
    third = visit(sedens, fac, device)
    third.to_choice()
    third.request("general", 30, "moderate")
    rec = third.one("SELECT * FROM s_recommendations WHERE room_session_id=?", third.ctx.room_session_id)
    assert decode(rec["inputs"], {})["discomfort_hold"] is False and decode(rec["inputs"], {})["last_days"] == 31
    assert "RECENT_DISCOMFORT_HOLD" not in decode(rec["rules_fired"], [])
    assert "moderate" in {BY_ID[s["exercise_id"]]["effort"] for s in third.view["recommendation"]["steps"]}
    assert "Your last session: 31 days ago" in third.view["recommendation"]["reasons"]


def test_courses_the_room_may_not_play_cannot_be_started(course_world):
    sedens, reviewer, fac, coach, device = course_world
    disabled = guided_course(sedens, reviewer, fac, coach, "Disabled Here")["course"]["id"]
    facility_setting(sedens, fac, disabled, enabled=False, included=False, featured=False)
    suspended = guided_course(sedens, reviewer, fac, coach, "Suspended Course")["course"]["id"]
    with sedens.db() as db:
        course_review.suspend(sedens, db, reviewer, {"course_id": suspended, "reason": "Rights question."})
    professor = professor_studio(sedens)
    paid = publish(sedens, professor, reviewer, build_guided(sedens, professor, "Mobility Foundations"),
                   "marketplace", price=KRW_29000)["course"]["id"]
    facility_setting(sedens, fac, paid, enabled=True)

    v = course_visit(sedens, fac, device)
    assert not {disabled, suspended, paid} & {c["course_id"] for c in v.view["choice"]["courses"]}
    for course_id, reason in ((disabled, "not_enabled_here"), (suspended, "not_available"), (paid, "purchase_required")):
        refused = v.refused("course/start", course_id=course_id)
        assert (refused.status, refused.code) == (403, reason), course_id
        assert v.state == "session_choice"
    assert v.all("SELECT * FROM s_workouts WHERE room_session_id=?", v.ctx.room_session_id) == []
    assert v.all("SELECT * FROM s_enrollments WHERE user_id=?", v.ctx.student_id) == []


def test_a_course_disabled_after_it_was_prepared_cannot_start(course_world):
    sedens, reviewer, fac, coach, device = course_world
    cid = guided_course(sedens, reviewer, fac, coach)["course"]["id"]
    v = course_visit(sedens, fac, device)
    v.act("course/start", course_id=cid)
    facility_setting(sedens, fac, cid, enabled=False, included=False, featured=False)
    refused = v.refused("workout/start")
    assert (refused.status, refused.code) == (403, "not_available")
    assert v.state == "ready_to_train" and workout_row(v)["state"] == "ready"


# == the room routes over HTTP ====================================================================


class Screen:
    """The room screen's own calls: the paired-device cookie, then the room cookie."""

    def __init__(self, base, device_token):
        self.client = Client(base)
        self.client.jar["sedens_device"] = device_token
        self.j = None

    def enter(self, code):
        status, body = self.client.call("POST", "/sedens/room/enter", {"method": "access_code", "credential": code})
        assert status == 200, body
        return self.get()

    def get(self):
        status, body = self.client.call("GET", "/sedens/room/journey?lang=en")
        assert status == 200, body
        self.j = body["journey"]
        return self.j

    def act(self, name, **body):
        body.setdefault("expect", self.j["state"])
        body.setdefault("lang", "en")
        status, out = self.client.call("POST", "/sedens/room/journey/" + name, body)
        assert status == 200, (name, out)
        self.j = out["journey"]
        return out

    def post(self, path, body):
        return self.client.call("POST", path, body)


@pytest.fixture()
def http_course(course_world):
    sedens, reviewer, fac, coach, device = course_world
    view = guided_course(sedens, reviewer, fac, coach, steps=("std-pelvic-curl", "std-breathing", "std-cat-cow"))
    sedens_http._LIMITS.clear()
    server, base = running_server(sedens.repo.path)
    yield sedens, fac, device, base, view
    server.shutdown()
    server.server_close()


def test_over_http_a_refresh_restores_the_paused_step_and_completion_needs_a_played_session(http_course):
    sedens, fac, device, base, view = http_course
    cid = view["course"]["id"]
    first_session, second_session = (s["id"] for s in view["modules"][0]["sessions"])
    screen = Screen(base, device)
    assert screen.enter(room_code(sedens, fac["customer_token"]))["state"] == "identified"
    screen.act("readiness/start")
    while screen.j["state"] == "readiness":
        ask = screen.j["readiness"]["next"]
        screen.act("readiness/answer", item=ask["item"], **({"follow_up": False} if ask["follow_up"] else
                                                             {"answer": False}))
    screen.act("scan/skip")
    complete = {"course_id": cid, "session_id": first_session}
    status, body = screen.post("/sedens/room/course/complete", complete)
    assert (status, body["code"]) == (409, "play_first")

    screen.act("course/start", course_id=cid)
    screen.act("workout/start")
    screen.act("workout/step", position=0, outcome="completed")
    screen.act("workout/pause", position_ms=4200, reason="customer")
    # The browser reloads: the same step, paused at the same place.
    fresh = Screen(base, device)
    fresh.client.jar.update(screen.client.jar)
    j = fresh.get()
    assert j["state"] == "exercise_paused" and j["path"] == "course"
    assert (j["workout"]["current_index"], j["workout"]["position_ms"], j["workout"]["course_version"]) == (1, 4200, 1)
    assert [s["state"] for s in j["workout"]["steps"]] == ["completed", "active", "pending"]
    assert j["stop_card"] and j["unwell"]
    status, body = screen.post("/sedens/room/course/complete", complete)
    assert (status, body["code"]) == (409, "play_first")  # started is not played to the end

    fresh.act("workout/resume")
    for position in (1, 2):
        fresh.act("workout/step", position=position, outcome="completed")
    assert fresh.j["state"] == "session_complete"
    status, body = screen.post("/sedens/room/course/complete", complete)
    assert status == 200, body
    assert body["progress"]["version"] == 1 and body["progress"]["completed_items"] == 1
    assert body["progress"]["done"] == [f"session:{first_session}"]
    status, body = screen.post("/sedens/room/course/complete", complete)  # confirming twice changes nothing
    assert status == 200 and body["progress"]["completed_items"] == 1
    status, body = screen.post("/sedens/room/course/complete", {"course_id": cid, "session_id": second_session})
    assert (status, body["code"]) == (409, "play_first")
    with sedens.db() as db:
        assert db.execute("SELECT count(*) FROM s_course_progress").fetchone()[0] == 1
    # A phone that is not the paired room screen reads nothing.
    phone = Client(base)
    phone.jar["motion_session"] = fac["customer_token"]
    status, body = phone.call("GET", "/sedens/room/journey")
    assert status == 403 and body["code"] == "device_not_paired"


def test_readiness_is_required_before_any_workout_action(world):
    sedens, fac, device = world
    v = visit(sedens, fac, device)
    with sedens.db() as db:  # a journey that reached the choice without this visit's check
        db.execute("UPDATE s_room_journeys SET state='session_choice' WHERE room_session_id=?", (v.ctx.room_session_id,))
    v.refresh()
    for name, body in (("plan/personalized", {}), ("course/start", {"course_id": "anything"})):
        refused = v.refused(name, **body)
        assert (refused.status, refused.code) == (409, "readiness_required"), name
        assert v.state == "session_choice"
    with sedens.db() as db:
        assert readiness.latest(db, v.ctx.room_session_id) is None
    assert v.all("SELECT * FROM s_workouts WHERE room_session_id=?", v.ctx.room_session_id) == []
