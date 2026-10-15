"""SEDENS Standard personalized sessions (Phase 3C): the deterministic plan builder
and the plan/* journey actions that store and explain what was recommended.

The builder is tested as a pure function against the real library and rules
(``data/sedens_standard/exercises.v1.json``, ``data/sedens_recommendation_rules.v1.json``),
with small fictional library edits where a rule needs one. The journey actions run
exactly as ``POST /sedens/room/journey/<action>`` runs them (inside ``sedens.batch()``,
after ``rooms.enter`` opened a real room session on a paired screen).

The helpers here (``Visit``, ``room_world``, ``visit``) are shared with
``test_sedens_room_workouts.py``.
"""

from __future__ import annotations

import copy
import dataclasses
import inspect
from pathlib import Path

import pytest

from pilates.sedens import http as sedens_http  # registers every journey action, as the server does
from pilates.sedens import consent, journey, plans, readiness, rooms, scans, standard
from pilates.sedens.util import Denied, decode
from sedens_support import Client, enter_with_code, facility, make_sedens, pair, running_server

LIB = standard.exercises()
BY_ID = {e["id"]: e for e in LIB}
RULES = plans.rules()
TIMING = RULES["timing"]
DEMO = plans.allowed_statuses(True)
PRODUCTION = plans.allowed_statuses(False)
BASE_RULES = ["READINESS_REQUIRED", "GOAL_PHASE_CATEGORIES", "INTENSITY_EFFORT", "DURATION_BUDGET",
              "EXPERIENCE_SETS", "ROOM_EQUIPMENT", "REVIEW_POLICY"]
COMBOS = [(g, i, x) for g in plans.GOALS for i in plans.INTENSITIES for x in ("new", "returning")]


def inputs(goal="general", duration=30, intensity="moderate", experience="new", **extra):
    return {"goal": goal, "duration": duration, "intensity": intensity, "experience": experience,
            "allowed_statuses": DEMO, **extra}


def ids(plan, phase=None):
    return [s["exercise_id"] for s in plan["steps"] if phase is None or s["phase"] == phase]


def edited(changes: dict) -> list[dict]:
    """A copy of the library with some entries changed (fictional edits for one rule)."""
    out = copy.deepcopy(LIB)
    for e in out:
        for key, value in changes.get(e["id"], {}).items():
            if key == "dose":
                e["dose"].update(value)
            else:
                e[key] = value
    return out


# -- an independent reading of the documented duration formula -----------------------------
# step = transition in + first demonstration + sets x one set + (sets - 1) x rest between
# sets + the entry's own rest. One set: reps x seconds per rep (or one hold) on each side
# worked, plus a side switch for each_side. Rest between sets: the hold rest for holds,
# the intensity's rest otherwise. Transitions: same position, floor to floor, or to/from
# standing; the session starts standing.


def expected_seconds(entry, sets, previous, rest_between):
    dose = entry["dose"]
    sides = 2 if dose["sides"] in ("each_side", "alternate") else 1
    hold = dose["mode"] == "hold"
    if dose.get("work_seconds"):
        one_set = dose["work_seconds"] * sides
    elif hold:
        one_set = dose["hold_seconds"] * sides
    else:
        one_set = dose["reps"] * (entry["seconds_per_rep"] or TIMING["seconds_per_rep_default"]) * sides
    if dose["sides"] == "each_side":
        one_set += TIMING["side_switch"]
    between = TIMING["hold_rest_between_sets"] if hold else rest_between
    here = entry["position"]
    if previous is None:
        move = TIMING["transition_same_position"] if here == "standing" else TIMING["transition_standing"]
    elif previous == here:
        move = TIMING["transition_same_position"]
    elif "standing" in (previous, here):
        move = TIMING["transition_standing"]
    else:
        move = TIMING["transition_floor"]
    return move + TIMING["first_demo"] + sets * one_set + (sets - 1) * between + dose["rest_seconds"]


# -- the room: a visit driven through the journey actions ----------------------------------


class Visit:
    """One customer visit on a paired room screen. Each action runs as the HTTP route
    runs it: one transaction, the live room session re-checked, then the action and the
    view of the resulting state."""

    def __init__(self, sedens, ctx, lang="en"):
        self.sedens, self.ctx, self.lang = sedens, ctx, lang
        self.notice = None
        self.refresh()

    @property
    def state(self):
        return self.view["state"]

    def refresh(self):
        with self.sedens.batch(), self.sedens.db() as db:
            journey.require_live(db, self.ctx)
            row = journey.ensure(db, self.ctx)
            self.view = journey.view(self.sedens, db, self.ctx, row, self.lang)
        return self.view

    def act(self, name, **body):
        body.setdefault("lang", self.lang)
        body.setdefault("expect", self.view["state"])
        with self.sedens.batch(), self.sedens.db() as db:
            journey.require_live(db, self.ctx)
            row = journey.ensure(db, self.ctx)
            result = journey.ACTIONS[name](self.sedens, db, self.ctx, row, body)
            row, self.notice = result if isinstance(result, tuple) else (result, None)
            self.view = journey.view(self.sedens, db, self.ctx, row, self.lang)
        return self.view

    def refused(self, name, **body) -> Denied:
        """The action is refused, and (one transaction) nothing it began is kept."""
        with pytest.raises(Denied) as caught:
            self.act(name, **body)
        self.refresh()
        return caught.value

    def ready(self):
        self.act("readiness/start")
        while self.state == "readiness":
            ask = self.view["readiness"]["next"]
            if ask["follow_up"]:
                self.act("readiness/answer", item=ask["item"], follow_up=False)
            else:
                self.act("readiness/answer", item=ask["item"], answer=False)
        assert self.state == "scan_intro"
        return self

    def consent_to_scan(self):
        with self.sedens.db() as db:
            consent.record(db, org_id=self.ctx.org_id, user_id=self.ctx.student_id, kind="scan_capture",
                           granted=True, text_version=consent.TEXTS["scan_capture"]["version"], channel="room",
                           room_session_id=self.ctx.room_session_id, room_id=self.ctx.room_id,
                           device_id=self.ctx.device_id, demo=self.ctx.demo)

    def demo_scan(self):
        """The labelled precomputed demonstration scan (demo_free mode), to the session choice."""
        self.consent_to_scan()
        self.act("scan/begin", source="demo_precomputed")
        for view in journey.SCAN_VIEWS:
            self.act("scan/view", view=view)
        assert self.state == "scan_result"
        return self.act("scan/continue")

    def to_choice(self):
        self.ready()
        return self.act("scan/skip")

    def request(self, goal="general", duration=30, intensity="moderate"):
        if self.state == "session_choice":
            self.act("plan/personalized")
        return self.act("plan/request", goal=goal, duration=duration, intensity=intensity)

    def one(self, sql, *args):
        with self.sedens.db() as db:
            row = db.execute(sql, args).fetchone()
        return dict(row) if row is not None else None

    def all(self, sql, *args):
        with self.sedens.db() as db:
            return [dict(r) for r in db.execute(sql, args)]

    def events(self, name):
        return self.all("SELECT * FROM s_events WHERE room_session_id=? AND name=? ORDER BY id",
                        self.ctx.room_session_id, name)

    def leave(self):
        """The customer ends the visit (POST room/journey/end)."""
        self.act("end")
        rooms.end(self.sedens, self.ctx, "customer_ended")


def room_world(tmp_path, mode="demo_free"):
    sedens = make_sedens(tmp_path / "s.db", mode)
    fac = facility(sedens, "A")
    return sedens, fac, pair(sedens, fac)


def visit(sedens, fac, device, *, demo=True, token_key="customer_token"):
    """A customer enters with a code from their phone. ``demo`` makes it a
    demonstration room (the review policy that lets unreviewed content be used)."""
    ctx = enter_with_code(sedens, device, fac[token_key])["context"]
    return Visit(sedens, dataclasses.replace(ctx, demo=True) if demo else ctx)


@pytest.fixture()
def world(tmp_path):
    return room_world(tmp_path)


# == the pure builder =========================================================================


def test_build_is_pure_and_deterministic():
    for args in (inputs(), inputs("mobility", 60, "light", "returning", scan_focus="shoulder_mobility",
                                  last_plan=["std-arm-arcs", "std-cat-cow"]),
                 inputs("core", 30, "moderate", "new", discomfort_hold=True)):
        library, given = copy.deepcopy(LIB), copy.deepcopy(args)
        first = plans.build(given, library)
        second = plans.build(copy.deepcopy(args), copy.deepcopy(LIB))
        assert first == second
        assert library == LIB and given == args  # nothing passed in is changed
    # No randomness and no clock in the builder (a grep of the module, and of every
    # function a plan is computed with).
    source = Path(plans.__file__).read_text(encoding="utf-8")
    for word in ("import random", "from random", "random.", "shuffle", "secrets", "uuid", "time.time"):
        assert word not in source, word
    for fn in (plans.build, plans._timeline, plans._order, plans._total, plans.entry_seconds, plans.set_seconds,
               plans.transition, plans._between_sets):
        code = inspect.getsource(fn)
        for word in ("now(", "uid(", "datetime", "random", "time."):
            assert word not in code, (fn.__name__, word)


@pytest.mark.parametrize("goal,intensity,experience", COMBOS)
def test_every_30_minute_plan_lands_within_27_to_33_minutes(goal, intensity, experience):
    plan = plans.build(inputs(goal, 30, intensity, experience), LIB)
    assert plan["ok"] and not plan["short"] and plan["reason"] is None
    assert 27 * 60 <= plan["estimated_seconds"] <= 33 * 60
    assert "SHORTER_PLAN_OFFERED" not in plan["fired"]
    # Warm-up, main block and cool-down, in that order, each present.
    phases = [s["phase"] for s in plan["steps"]]
    assert phases == sorted(phases, key=plans.PHASES.index) and set(phases) == set(plans.PHASES)
    assert len(set(ids(plan))) == len(plan["steps"])  # an exercise appears once


@pytest.mark.parametrize("goal", plans.GOALS)
def test_60_minute_moderate_plans_for_returning_customers_land_within_55_to_65(goal):
    plan = plans.build(inputs(goal, 60, "moderate", "returning"), LIB)
    assert plan["ok"] and not plan["short"]
    assert 55 * 60 <= plan["estimated_seconds"] <= 65 * 60


@pytest.mark.parametrize("goal,intensity,experience", COMBOS)
def test_a_plan_that_cannot_fill_60_minutes_is_offered_short_never_relabelled(goal, intensity, experience):
    plan = plans.build(inputs(goal, 60, intensity, experience), LIB)
    assert plan["ok"]
    if plan["short"]:
        assert 20 * 60 <= plan["estimated_seconds"] < 55 * 60
        assert plan["fired"][-1] == "SHORTER_PLAN_OFFERED"
    else:
        assert 55 * 60 <= plan["estimated_seconds"] <= 65 * 60
        assert "SHORTER_PLAN_OFFERED" not in plan["fired"]
    # The estimate is always the steps' own sum, whatever the label.
    assert plan["estimated_seconds"] == sum(s["seconds"] for s in plan["steps"])


def test_first_visits_cannot_fill_an_hour_and_say_so():
    for goal in plans.GOALS:
        for intensity in plans.INTENSITIES:
            plan = plans.build(inputs(goal, 60, intensity, "new"), LIB)
            assert plan["short"] and "SHORTER_PLAN_OFFERED" in plan["fired"]


def test_a_library_that_cannot_reach_20_minutes_offers_nothing():
    tiny = [BY_ID[i] for i in ("std-breathing", "std-chest-lift", "std-childs-pose")]
    plan = plans.build(inputs(), tiny)
    assert plan["ok"] is False and plan["reason"] == "cannot_fill"
    assert 0 < plan["estimated_seconds"] < 20 * 60 and "SHORTER_PLAN_OFFERED" not in plan["fired"]


@pytest.mark.parametrize("args", [inputs(), inputs("mobility", 30, "light"), inputs("core", 60, "moderate", "returning"),
                                  inputs("pilates", 60, "light", "new"), inputs("general", 30, "light", "returning")])
def test_estimated_seconds_follow_the_documented_formula(args):
    plan = plans.build(args, LIB)
    rest = RULES["intensities"][args["intensity"]]["rest_between_sets"]
    assert plan["rest_between_sets"] == rest
    previous, total = None, 0
    for step in plan["steps"]:
        entry = BY_ID[step["exercise_id"]]
        seconds = expected_seconds(entry, step["sets"], previous, rest)
        assert step["seconds"] == seconds, step
        assert step["position"] == entry["position"]
        previous, total = entry["position"], total + seconds
    assert plan["estimated_seconds"] == total


def test_the_formula_by_hand():
    # Pilates Breathing first: in from standing 30 + demonstration 15 + 6 reps x 8 s + rest 15.
    plan = plans.build(inputs(), LIB)
    first = plan["steps"][0]
    assert (first["exercise_id"], first["sets"], first["seconds"]) == ("std-breathing", 1, 30 + 15 + 48 + 15)
    # Clam after a supine exercise: floor transition 20 + 15 + (8 x 4 s x 2 sides + 5 s switch) + 20.
    clam = next(s for s in plan["steps"] if s["exercise_id"] == "std-clam")
    assert clam["seconds"] == 20 + 15 + (8 * 4 * 2 + 5) + 20
    # Two sets of a 20 s hold: 2 x 20 + one 10 s hold rest between them.
    assert plans.entry_seconds(BY_ID["std-sphinx"], 2, previous_position="prone", intensity_rest=35,
                               timing=TIMING) == 10 + 15 + 2 * 20 + 10 + 10


def test_production_policy_with_todays_unreviewed_library_gives_no_reviewed_content():
    assert PRODUCTION == ["sedens_reviewed", "expert_reviewed"] and "unreviewed" in DEMO
    assert {e["review"]["status"] for e in LIB} == {"unreviewed"}  # nothing is reviewed yet (1.0.0)
    plan = plans.build({**inputs(), "allowed_statuses": PRODUCTION}, LIB)
    assert plan["ok"] is False and plan["reason"] == "no_reviewed_content" and plan["steps"] == []
    assert plan["estimated_seconds"] == 0
    # Once entries carry a recorded review, production plans use those and only those.
    reviewed = {i: {"review": {**BY_ID[i]["review"], "status": "sedens_reviewed"}}
                for i in ("std-breathing", "std-cat-cow", "std-pelvic-curl", "std-chest-lift", "std-childs-pose")}
    plan = plans.build({**inputs(), "allowed_statuses": PRODUCTION}, edited(reviewed))
    assert plan["steps"] and set(ids(plan)) <= set(reviewed)


def test_equipment_beyond_the_mat_is_excluded():
    assert RULES["room_equipment"] == ["mat"]
    baseline = plans.build(inputs(), LIB)
    needs_more = ["std-pelvic-curl", "std-chest-lift", "std-cat-cow"]
    assert set(needs_more) <= set(ids(baseline))  # the control: chosen when only a mat is needed
    plan = plans.build(inputs(), edited({i: {"equipment": ["mat", "resistance_band"]} for i in needs_more}))
    assert plan["ok"] and not set(needs_more) & set(ids(plan))


def test_light_intensity_uses_only_light_effort_entries():
    for goal in plans.GOALS:
        for duration in plans.DURATIONS:
            for experience in ("new", "returning"):
                plan = plans.build(inputs(goal, duration, "light", experience), LIB)
                assert {BY_ID[i]["effort"] for i in ids(plan)} == {"light"}, (goal, duration, experience)
                assert plan["rest_between_sets"] == RULES["intensities"]["light"]["rest_between_sets"]
    # The control: Moderate does use moderate-effort exercises.
    assert "moderate" in {BY_ID[i]["effort"] for i in ids(plans.build(inputs(), LIB))}


def test_new_customers_get_foundation_exercises_and_at_most_2_sets_returning_at_most_3():
    seen_intermediate = False
    for goal, intensity, experience in COMBOS:
        for duration in plans.DURATIONS:
            plan = plans.build(inputs(goal, duration, intensity, experience), LIB)
            sets = [s["sets"] for s in plan["steps"]]
            levels = {BY_ID[i]["level"] for i in ids(plan)}
            if experience == "new":
                assert levels == {"foundation"} and max(sets) <= 2
            else:
                assert levels <= {"foundation", "intermediate"} and max(sets) <= 3
                seen_intermediate |= "intermediate" in levels
    assert seen_intermediate  # the control: returning customers can be given intermediate entries


def test_the_set_cap_also_holds_for_entries_whose_dose_has_more_sets():
    # A valid library entry (standard.py allows 1-5 sets) prescribing 3 sets.
    library = edited({"std-sphinx": {"dose": {"sets": 3}}, "std-kneeling-plank": {"dose": {"sets": 3}}})
    plan = plans.build(inputs(), library)
    assert max(s["sets"] for s in plan["steps"]) <= RULES["experience"]["max_sets"]["new"]


def test_recent_discomfort_hold_keeps_the_plan_light():
    for goal in plans.GOALS:
        plan = plans.build(inputs(goal, 30, "moderate", "returning", discomfort_hold=True, hard_step_down=True), LIB)
        assert plan["ok"] and 27 * 60 <= plan["estimated_seconds"] <= 33 * 60
        assert {BY_ID[i]["effort"] for i in ids(plan)} == {"light"}
        assert "RECENT_DISCOMFORT_HOLD" in plan["fired"]
        assert "RECENT_HARD_STEP_DOWN" not in plan["fired"]  # the hold already covers it


def test_recent_hard_step_down_prefers_light_exercises_without_forbidding_moderate():
    more_light = False
    for goal in plans.GOALS:
        for duration in plans.DURATIONS:
            for experience in ("new", "returning"):
                args = inputs(goal, duration, "moderate", experience)
                base, stepped = plans.build(args, LIB), plans.build({**args, "hard_step_down": True}, LIB)
                assert "RECENT_HARD_STEP_DOWN" in stepped["fired"] and "RECENT_HARD_STEP_DOWN" not in base["fired"]
                light = [sum(BY_ID[i]["effort"] == "light" for i in ids(p)) for p in (base, stepped)]
                assert light[1] >= light[0], (goal, duration, experience)
                more_light |= light[1] > light[0]
    assert more_light
    # Unlike the discomfort hold, moderate exercises are still allowed.
    stepped = plans.build({**inputs(), "hard_step_down": True}, LIB)
    assert "moderate" in {BY_ID[i]["effort"] for i in ids(stepped)}


@pytest.mark.parametrize("experience", ["new", "returning"])
@pytest.mark.parametrize("goal", ["mobility", "pilates", "general"])
def test_the_scan_rule_adds_at_most_one_shoulder_mobility_warm_up_exercise(goal, experience):
    args = inputs(goal, 30, "moderate", experience)
    base = plans.build(args, LIB)
    plan = plans.build({**args, "scan_focus": "shoulder_mobility"}, LIB)
    marked = [s for s in plan["steps"] if s["scan_rule"]]
    assert len(marked) == 1 and plan["scan_added"] == marked[0]["exercise_id"]
    entry = BY_ID[marked[0]["exercise_id"]]
    assert marked[0]["phase"] == "warm_up" and "shoulder_mobility" in entry["scan_tags"]
    assert "mobility" in entry["categories"]
    assert "SCAN_SHOULDER_LINE_VARIETY_V1" in plan["fired"]
    tagged = [sum("shoulder_mobility" in BY_ID[i]["scan_tags"] for i in ids(p, "warm_up")) for p in (base, plan)]
    assert tagged[1] <= tagged[0] + 1
    assert ids(plan, "main") == ids(base, "main")  # the goal's main block is untouched
    assert 27 * 60 <= plan["estimated_seconds"] <= 33 * 60


def test_the_scan_rule_brings_in_a_shoulder_exercise_the_plan_would_not_have_had():
    # Variety: last time's shoulder exercise moves behind unused exercises, so without
    # the scan the warm-up has no shoulder exercise; with it, exactly one is added.
    shoulder = {e["id"] for e in LIB if "shoulder_mobility" in e["scan_tags"]}
    for goal in ("mobility", "pilates", "general"):
        args = inputs(goal, 30, "moderate", "new", last_plan=["std-arm-arcs"])
        base = plans.build(args, LIB)
        plan = plans.build({**args, "scan_focus": "shoulder_mobility"}, LIB)
        assert not set(ids(base, "warm_up")) & shoulder
        assert set(ids(plan, "warm_up")) & shoulder == {plan["scan_added"]}
        assert [s["exercise_id"] for s in plan["steps"] if s["scan_rule"]] == [plan["scan_added"]]
        assert plan["scan_added"] not in ids(base)
        # The main block still follows the goal (only its time budget can shift).
        for i in ids(plan, "main"):
            assert set(BY_ID[i]["categories"]) & set(RULES["goals"][goal]["phases"]["main"])
        assert 27 * 60 <= plan["estimated_seconds"] <= 33 * 60


def test_the_scan_rule_never_applies_to_core_or_without_a_shown_observation():
    for args in (inputs("core", 30, "moderate", scan_focus="shoulder_mobility"), inputs("general", 30, "moderate")):
        plan = plans.build(args, LIB)
        assert plan["scan_added"] is None and not any(s["scan_rule"] for s in plan["steps"])
        assert "SCAN_SHOULDER_LINE_VARIETY_V1" not in plan["fired"]
    core = inputs("core")
    assert plans.build({**core, "scan_focus": "shoulder_mobility"}, LIB) == plans.build(core, LIB)


def test_rationale_gives_2_to_4_reasons_goal_and_effort_first():
    def reasons(**extra):
        args = inputs(**extra)
        return plans.rationale(args, plans.build(args, LIB), RULES)

    plain = reasons(goal="mobility", intensity="light")
    assert [r["rule"] for r in plain] == ["GOAL_PHASE_CATEGORIES", "INTENSITY_EFFORT", "DURATION_BUDGET"]
    assert plain[0]["params"] == {"goal": "mobility"} and plain[1]["params"] == {"intensity": "light"}
    everything = reasons(goal="general", discomfort_hold=True, scan_focus="shoulder_mobility", last_days=3)
    assert [r["rule"] for r in everything] == ["GOAL_PHASE_CATEGORIES", "INTENSITY_EFFORT", "RECENT_DISCOMFORT_HOLD",
                                               "SCAN_SHOULDER_LINE_VARIETY_V1"]  # at most four
    for extra in ({}, {"hard_step_down": True}, {"last_days": 0}, {"scan_focus": "shoulder_mobility", "last_days": 8},
                  {"goal": "core", "scan_focus": "shoulder_mobility", "hard_step_down": True, "last_days": 2}):
        got = reasons(**extra)
        assert 2 <= len(got) <= 4 and [r["rule"] for r in got[:2]] == ["GOAL_PHASE_CATEGORIES", "INTENSITY_EFFORT"]
    # Rendered for the customer, in either language.
    goal_en = RULES["goals"]["mobility"]["label"]["en"]
    assert plans.render_reason(plain[0], "en") == f"Your goal: {goal_en}"
    assert plans.render_reason(plain[1], "ko") == "선택한 강도: " + RULES["intensities"]["light"]["label"]["ko"]
    assert plans.render_reason({"rule": "LAST_SESSION_CONTEXT", "params": {"days": 0}}, "en") == \
        "Your last session: earlier today"
    assert plans.render_reason({"rule": "LAST_SESSION_CONTEXT", "params": {"days": 8}}, "en") == \
        "Your last session: 8 days ago"


# == the journey actions =======================================================================


def recommendations(v):
    return v.all("SELECT * FROM s_recommendations WHERE room_session_id=? ORDER BY created_at, rowid",
                 v.ctx.room_session_id)


def test_a_requested_plan_is_stored_with_its_inputs_rules_versions_and_reasons(world):
    sedens, fac, device = world
    v = visit(sedens, fac, device)
    v.to_choice()
    assert v.view["choice"]["personalized"] is True
    v.act("plan/personalized")
    assert v.state == "session_setup" and [g["id"] for g in v.view["setup"]["goals"]] == list(plans.GOALS)
    assert v.view["setup"]["durations"] == [30, 60]
    v.request("general", 30, "moderate")
    assert v.state == "recommendation" and v.notice is None
    [row] = recommendations(v)
    check = v.one("SELECT * FROM s_readiness_checks WHERE room_session_id=?", v.ctx.room_session_id)
    assert row["state"] == "shown" and row["decided_at"] is None
    assert row["rules_version"] == plans.CURRENT == "sedens-recommend-1.0.0"
    assert row["library_version"] == standard.document()["version"] == "1.0.0"
    assert row["readiness_check_id"] == check["id"] and row["scan_id"] is None
    assert (row["goal"], row["duration_minutes"], row["intensity"]) == ("general", 30, "moderate")
    stored = decode(row["inputs"], {})
    assert {k: stored[k] for k in ("goal", "duration", "intensity", "experience", "demo", "allowed_statuses",
                                   "discomfort_hold", "hard_step_down", "last_plan", "last_days", "scan_focus",
                                   "room_equipment")} == {
        "goal": "general", "duration": 30, "intensity": "moderate", "experience": "new", "demo": True,
        "allowed_statuses": DEMO, "discomfort_hold": False, "hard_step_down": False, "last_plan": [],
        "last_days": None, "scan_focus": None, "room_equipment": ["mat"]}
    assert stored["readiness"] == {"version": readiness.CURRENT, "outcome": "ready"}
    # The stored inputs reproduce the stored plan exactly: the record explains itself.
    again = plans.build(stored, standard.exercises())
    plan = decode(row["plan"], {})
    assert plan["steps"] == again["steps"] and decode(row["rules_fired"], []) == again["fired"]
    assert decode(row["rules_fired"], [])[:7] == BASE_RULES
    assert row["estimated_seconds"] == again["estimated_seconds"] == sum(s["seconds"] for s in plan["steps"])
    assert plan["short"] is False and plan["rest_between_sets"] == 35
    assert [r["rule"] for r in decode(row["rationale"], [])] == ["GOAL_PHASE_CATEGORIES", "INTENSITY_EFFORT",
                                                                  "DURATION_BUDGET"]
    # What the screen shows.
    shown = v.view["recommendation"]
    assert shown["id"] == row["id"] and shown["estimated_minutes"] == round(row["estimated_seconds"] / 60)
    assert 27 <= shown["estimated_minutes"] <= 33 and shown["shorter"] is False and shown["shorter_text"] is None
    assert shown["reasons"] == [f"Your goal: {RULES['goals']['general']['label']['en']}",
                                "Your selected effort: Moderate", "Your time: about 30 minutes"]
    assert [s["exercise_id"] for s in shown["steps"]] == [s["exercise_id"] for s in plan["steps"]]
    assert all(s["review"] == "unreviewed" for s in shown["steps"])
    assert shown["content_label"] == standard.label()["en"] and shown["rules_version"] == plans.CURRENT
    [event] = v.events("recommendation_shown")
    assert decode(event["props"], {})["rules_version"] == plans.CURRENT


def test_asking_again_leaves_one_shown_plan_and_only_it_can_be_accepted(world):
    sedens, fac, device = world
    v = visit(sedens, fac, device)
    v.to_choice()
    v.request("general", 30, "moderate")
    first = v.view["recommendation"]["id"]
    v.act("plan/change")
    assert v.state == "session_setup"
    v.request("mobility", 30, "light")
    second = v.view["recommendation"]["id"]
    rows = {r["id"]: r for r in recommendations(v)}
    assert rows[first]["state"] == "declined" and rows[first]["decided_at"]
    assert rows[second]["state"] == "shown"
    assert [r["id"] for r in rows.values() if r["state"] == "shown"] == [second]
    # The plan that was on the screen before is not the one accepted.
    for stale in (first, "not-a-plan"):
        refused = v.refused("plan/accept", recommendation=stale)
        assert (refused.status, refused.code) == (409, "journey_changed")
        assert v.state == "recommendation" and v.one("SELECT state FROM s_recommendations WHERE id=?",
                                                     second)["state"] == "shown"
    assert v.all("SELECT * FROM s_workouts WHERE room_session_id=?", v.ctx.room_session_id) == []
    v.act("plan/accept", recommendation=second)
    assert v.state == "ready_to_train"
    assert v.one("SELECT state FROM s_recommendations WHERE id=?", second)["state"] == "accepted"
    workout = v.one("SELECT * FROM s_workouts WHERE room_session_id=?", v.ctx.room_session_id)
    assert workout["recommendation_id"] == second and workout["kind"] == "standard" and workout["state"] == "ready"
    plan = decode(v.one("SELECT plan FROM s_recommendations WHERE id=?", second)["plan"], {})
    assert [s["exercise_id"] for s in plan["steps"]] == \
        [s["content"]["ref"] for s in v.view["workout"]["steps"]]
    assert len(v.events("recommendation_accepted")) == 1
    # Accepted once: the screen cannot accept it again.
    assert v.refused("plan/accept", recommendation=second).code == "invalid_transition"


def test_accepting_needs_the_id_of_the_plan_on_the_screen(world):
    sedens, fac, device = world
    v = visit(sedens, fac, device)
    v.to_choice()
    v.request()
    refused = v.refused("plan/accept")
    assert refused.status in (400, 409) and v.state == "recommendation"


def test_back_to_the_choice_declines_the_plan(world):
    sedens, fac, device = world
    v = visit(sedens, fac, device)
    v.to_choice()
    v.request()
    v.act("plan/back")
    assert v.state == "session_choice"
    assert [r["state"] for r in recommendations(v)] == ["declined"]


def test_a_new_plan_supersedes_any_plan_still_marked_shown(world):
    """Only one plan is ever on offer: should the setup screen be reached with a plan
    still marked shown, asking again supersedes it (and the old id cannot be accepted)."""
    sedens, fac, device = world
    v = visit(sedens, fac, device)
    v.to_choice()
    v.request("general", 30, "moderate")
    first = v.view["recommendation"]["id"]
    with sedens.db() as db:
        db.execute("UPDATE s_room_journeys SET state='session_setup' WHERE room_session_id=?", (v.ctx.room_session_id,))
    v.refresh()
    v.request("core", 30, "light")
    second = v.view["recommendation"]["id"]
    rows = {r["id"]: r for r in recommendations(v)}
    assert (rows[first]["state"], bool(rows[first]["decided_at"])) == ("superseded", True)
    assert [i for i, r in rows.items() if r["state"] == "shown"] == [second]
    assert v.refused("plan/accept", recommendation=first).code == "journey_changed"
    assert len(v.events("recommendation_shown")) == 2


BAD_REQUESTS = [
    {"goal": "strength", "duration": 30, "intensity": "moderate"},
    {"goal": None, "duration": 30, "intensity": "moderate"},
    {"goal": "General", "duration": 30, "intensity": "moderate"},
    {"duration": 30, "intensity": "moderate"},
    {"goal": "general", "duration": 45, "intensity": "moderate"},
    {"goal": "general", "duration": "30", "intensity": "moderate"},
    {"goal": "general", "duration": True, "intensity": "moderate"},
    {"goal": "general", "duration": None, "intensity": "moderate"},
    {"goal": "general", "duration": 30, "intensity": "vigorous"},
    {"goal": "general", "duration": 30, "intensity": None},
    {"goal": "general", "duration": 30, "intensity": ["moderate"]},
]


def test_plan_request_refuses_bad_choices(world):
    sedens, fac, device = world
    v = visit(sedens, fac, device)
    v.to_choice()
    v.act("plan/personalized")
    for body in BAD_REQUESTS:
        refused = v.refused("plan/request", **body)
        assert (refused.status, refused.code) == (400, "invalid"), body
        assert v.state == "session_setup" and recommendations(v) == []
    assert v.events("recommendation_shown") == []


def test_plan_request_refuses_a_fractional_duration(world):
    sedens, fac, device = world
    v = visit(sedens, fac, device)
    v.to_choice()
    v.act("plan/personalized")
    refused = v.refused("plan/request", goal="general", duration=30.0, intensity="moderate")
    assert (refused.status, refused.code) == (400, "invalid")


def test_cannot_fill_is_a_notice_that_keeps_the_setup_screen(world, monkeypatch):
    sedens, fac, device = world
    v = visit(sedens, fac, device)
    v.to_choice()
    v.act("plan/personalized")
    revision = v.view["revision"]
    tiny = [BY_ID[i] for i in ("std-breathing", "std-chest-lift", "std-childs-pose")]
    monkeypatch.setattr(standard, "exercises", lambda: tiny)
    v.request("core", 30, "moderate")
    assert v.state == "session_setup" and v.view["revision"] == revision
    assert v.notice["code"] == "cannot_fill" and v.notice["minutes"] == 30 and 0 < v.notice["available"] < 20
    assert "30-minute" in plans.notice_text(v.notice, "en") and "30분" in plans.notice_text(v.notice, "ko")
    assert recommendations(v) == [] and v.events("recommendation_shown") == []
    monkeypatch.undo()
    v.request("core", 30, "moderate")
    assert v.state == "recommendation" and v.notice is None


def test_a_real_facility_room_offers_no_plan_until_the_library_is_reviewed(world):
    sedens, fac, device = world
    v = visit(sedens, fac, device, demo=False)
    assert v.ctx.demo is False
    v.to_choice()
    v.request()
    assert v.state == "session_setup" and v.notice["code"] == "no_reviewed_content"
    assert plans.notice_text(v.notice, "en") == RULES["messages"]["no_reviewed_content"]["en"]
    assert recommendations(v) == []


def test_a_shorter_plan_is_shown_with_its_real_length(world):
    sedens, fac, device = world
    v = visit(sedens, fac, device)
    v.to_choice()
    v.request("mobility", 60, "light")
    row = recommendations(v)[0]
    minutes = round(row["estimated_seconds"] / 60)
    assert 20 <= minutes < 55 and row["duration_minutes"] == 60
    assert v.notice == {"code": "shorter_plan", "minutes": 60, "available": minutes}
    shown = v.view["recommendation"]
    assert shown["shorter"] is True and shown["estimated_minutes"] == minutes and shown["duration_minutes"] == 60
    assert f"{minutes} minutes" in shown["shorter_text"] and "60 minutes" in shown["shorter_text"]
    assert "SHORTER_PLAN_OFFERED" in decode(row["rules_fired"], [])
    v.act("plan/accept", recommendation=shown["id"])
    assert v.view["workout"]["planned_minutes"] == minutes  # never relabelled as an hour


def test_plan_steps_need_this_visits_ready_check(world):
    sedens, fac, device = world
    v = visit(sedens, fac, device)
    with sedens.db() as db:  # a journey that reached the setup screen without a check
        db.execute("UPDATE s_room_journeys SET state='session_setup' WHERE room_session_id=?", (v.ctx.room_session_id,))
    v.refresh()
    refused = v.refused("plan/request", goal="general", duration=30, intensity="moderate")
    assert (refused.status, refused.code) == (409, "readiness_required")
    assert recommendations(v) == []


# -- what the scan may change -------------------------------------------------------------------


def scan_reasons(v):
    return [r["rule"] for r in decode(recommendations(v)[-1]["rationale"], [])]


def test_a_shown_shoulder_line_adds_one_shoulder_exercise_for_general(world):
    sedens, fac, device = world
    v = visit(sedens, fac, device)
    v.ready()
    v.demo_scan()
    assert v.one("SELECT outcome FROM s_room_scan_observations WHERE rule_id='shoulder_line'")["outcome"] == "shown"
    v.request("general", 30, "moderate")
    row = recommendations(v)[0]
    scan = v.one("SELECT * FROM s_room_scans WHERE room_session_id=?", v.ctx.room_session_id)
    assert row["scan_id"] == scan["id"] and decode(row["inputs"], {})["scan_focus"] == "shoulder_mobility"
    marked = [s for s in v.view["recommendation"]["steps"] if s["scan_rule"]]
    assert len(marked) == 1 and marked[0]["phase"] == "warm_up"
    assert "shoulder_mobility" in BY_ID[marked[0]["exercise_id"]]["scan_tags"]
    assert "SCAN_SHOULDER_LINE_VARIETY_V1" in decode(row["rules_fired"], [])
    assert "SCAN_SHOULDER_LINE_VARIETY_V1" in scan_reasons(v)
    assert any(r.startswith("Today's scan:") for r in v.view["recommendation"]["reasons"])


def test_the_scan_never_changes_a_core_plan(world):
    sedens, fac, device = world
    v = visit(sedens, fac, device)
    v.ready()
    v.demo_scan()
    v.request("core", 30, "moderate")
    row = recommendations(v)[0]
    assert row["scan_id"] is not None  # the scan is linked, it just does not apply
    assert not any(s["scan_rule"] for s in v.view["recommendation"]["steps"])
    assert "SCAN_SHOULDER_LINE_VARIETY_V1" not in decode(row["rules_fired"], [])
    assert decode(row["plan"], {})["steps"] == plans.build({**decode(row["inputs"], {}), "scan_focus": None},
                                                           standard.exercises())["steps"]


def test_a_skipped_scan_adds_nothing(world):
    sedens, fac, device = world
    v = visit(sedens, fac, device)
    v.to_choice()
    v.request("general", 30, "moderate")
    row = recommendations(v)[0]
    assert row["scan_id"] is None and decode(row["inputs"], {})["scan_focus"] is None
    assert "SCAN_SHOULDER_LINE_VARIETY_V1" not in decode(row["rules_fired"], [])
    assert not any(s["scan_rule"] for s in v.view["recommendation"]["steps"])


@pytest.mark.parametrize("change,outcome", [
    (lambda views: views["back"].update(suitable=False), "withheld"),
    (lambda views: views["back"]["metrics"]["shoulder_tilt"].update(confidence=0.2), "withheld"),
    (lambda views: (views["front"]["metrics"]["shoulder_tilt"].update(value=-0.5),
                    views["back"]["metrics"]["shoulder_tilt"].update(value=-0.4)), "below_threshold"),
])
def test_a_withheld_or_small_shoulder_line_adds_nothing(world, monkeypatch, change, outcome):
    sedens, fac, device = world
    data = copy.deepcopy(scans.demo_scan())
    change(data["views"])
    monkeypatch.setattr(scans, "demo_scan", lambda: data)
    v = visit(sedens, fac, device)
    v.ready()
    v.demo_scan()
    assert v.one("SELECT outcome FROM s_room_scan_observations WHERE rule_id='shoulder_line'")["outcome"] == outcome
    v.request("general", 30, "moderate")
    row = recommendations(v)[0]
    assert row["scan_id"] is not None and decode(row["inputs"], {})["scan_focus"] is None
    assert "SCAN_SHOULDER_LINE_VARIETY_V1" not in decode(row["rules_fired"], [])
    assert not any(s["scan_rule"] for s in v.view["recommendation"]["steps"])


# -- the same, over HTTP, in a real demonstration room --------------------------------------------

DEMO_KEY = "5" * 32


@pytest.fixture()
def demo_room(tmp_path, monkeypatch):
    """The free demonstration host: a simulated room screen of a demonstration facility."""
    monkeypatch.setenv("SEDENS_MODE", "demo_free")
    sedens_http._LIMITS.clear()
    server, base = running_server(tmp_path / "s.db")
    yield base
    server.shutdown()
    server.server_close()


def test_over_http_a_demonstration_room_recommends_explains_and_accepts_only_the_plan_on_screen(demo_room):
    screen = Client(demo_room)
    state = {}

    def call(name, **body):
        body.setdefault("expect", state["j"]["state"])
        body.setdefault("lang", "en")
        status, out = screen.call("POST", "/sedens/room/journey/" + name, body)
        if status == 200:
            state["j"] = out["journey"]
        return status, out

    def act(name, **body):
        status, out = call(name, **body)
        assert status == 200, (name, out)
        return out

    def server_state():
        return screen.call("GET", "/sedens/room/journey?lang=en")[1]["journey"]

    assert screen.call("POST", "/sedens/demo/room-device", {"key": DEMO_KEY})[0] == 200
    status, entered = screen.call("POST", "/sedens/room/enter", {"method": "qr", "credential": "SEDENS-QR-1001"})
    assert status == 200, entered
    state["j"] = server_state()
    act("readiness/start")
    while state["j"]["state"] == "readiness":
        ask = state["j"]["readiness"]["next"]
        act("readiness/answer", item=ask["item"], **({"follow_up": False} if ask["follow_up"] else {"answer": False}))
    assert state["j"]["scan_options"][0] == "demo_precomputed"
    status, _ = screen.call("POST", "/sedens/room/consent", {"kind": "scan_capture", "granted": True,
                                                             "text_version": consent.TEXTS["scan_capture"]["version"]})
    assert status == 200
    act("scan/begin", source="demo_precomputed")
    for view in journey.SCAN_VIEWS:
        act("scan/view", view=view)
    act("scan/continue")
    assert state["j"]["choice"]["personalized"] is True  # a demonstration facility may use unreviewed content
    act("plan/personalized")

    status, out = call("plan/request", goal="general", duration=45, intensity="moderate")
    assert (status, out["code"]) == (400, "invalid") and server_state()["state"] == "session_setup"
    out = act("plan/request", goal="general", duration=30, intensity="moderate")
    rec = state["j"]["recommendation"]
    assert out["notice"] is None and state["j"]["state"] == "recommendation"
    assert 27 <= rec["estimated_minutes"] <= 33 and 2 <= len(rec["reasons"]) <= 4
    assert rec["reasons"][:2] == [f"Your goal: {RULES['goals']['general']['label']['en']}",
                                  "Your selected effort: Moderate"]
    assert sum(s["scan_rule"] for s in rec["steps"]) == 1  # the demonstration scan shows the shoulder line
    assert any(r.startswith("Today's scan:") for r in rec["reasons"])
    assert {s["review"] for s in rec["steps"]} == {"unreviewed"} and rec["content_label"]
    # A refresh shows the same plan; it is not rebuilt.
    again = server_state()
    assert again["state"] == "recommendation" and again["recommendation"] == rec

    act("plan/change")
    out = act("plan/request", goal="mobility", duration=60, intensity="light")
    shorter = state["j"]["recommendation"]
    assert out["notice"]["code"] == "shorter_plan" and str(shorter["estimated_minutes"]) in out["notice"]["text"]
    assert shorter["shorter"] is True and 20 <= shorter["estimated_minutes"] < 55
    status, out = call("plan/accept", recommendation=rec["id"])
    assert (status, out["code"]) == (409, "journey_changed")
    assert server_state()["recommendation"]["id"] == shorter["id"]
    act("plan/accept", recommendation=shorter["id"])
    assert state["j"]["state"] == "ready_to_train"
    assert state["j"]["workout"]["planned_minutes"] == shorter["estimated_minutes"]
    assert [s["content"]["ref"] for s in state["j"]["workout"]["steps"]] == [s["exercise_id"] for s in shorter["steps"]]
