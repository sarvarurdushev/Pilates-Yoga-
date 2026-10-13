"""SEDENS Standard personalized sessions: a deterministic, explainable plan builder.

No language model and no randomness: :func:`build` is a pure function of its
inputs, the SEDENS Standard library and the versioned rules in
``data/sedens_recommendation_rules.v<n>.json``. The same inputs always give the
same plan, and every plan is stored with the exact inputs, the rules that fired,
the rules and library versions, and the reasons shown (``s_recommendations``).

Priority (brief §21): readiness gates everything; then the customer's goal,
duration, experience, room equipment, recent sessions, scan observations and
variety, in that order. A scan observation can add at most one variety exercise
and never overrides the goal. Creator courses never pass through this module.

Duration is calculated, never labelled: every step's seconds come from its dose
(sets, reps x seconds per rep or holds, sides), rests, transitions and a first
demonstration. A plan that cannot land inside the duration's range is not
offered; the customer is told how long the library can honestly fill instead.
"""

from __future__ import annotations

from datetime import datetime, timezone
from functools import lru_cache
import json
from pathlib import Path

from . import analytics, journey, standard
from .util import Denied, decode, encode, now, uid

DATA = Path(__file__).resolve().parents[2] / "data"
CURRENT = "sedens-recommend-1.0.0"
FILES = {"sedens-recommend-1.0.0": "sedens_recommendation_rules.v1.json"}
GOALS = ("mobility", "pilates", "core", "general")
DURATIONS = (30, 60)
INTENSITIES = ("light", "moderate")
PHASES = ("warm_up", "main", "cool_down")
DEFAULT_POLICY = {"demo_allowed_statuses": ["unreviewed", "sedens_reviewed", "expert_reviewed"],
                  "production_allowed_statuses": ["sedens_reviewed", "expert_reviewed"]}


@lru_cache(maxsize=None)
def rules(version: str = CURRENT) -> dict:
    data = json.loads((DATA / FILES[version]).read_text(encoding="utf-8"))
    if data["version"] != version:
        raise ValueError(f"{FILES[version]} declares {data['version']}, expected {version}")
    return data


def _t(value, locale):
    return (value.get(locale) or value.get("en")) if isinstance(value, dict) else value


def _rule(r, rule_id) -> dict:
    return next(x for x in r["rules"] if x["id"] == rule_id)


def library_version() -> str:
    return str(standard.document().get("version", ""))


def allowed_statuses(demo: bool) -> list[str]:
    policy = standard.document().get("policy") or DEFAULT_POLICY
    return list(policy["demo_allowed_statuses" if demo else "production_allowed_statuses"])


def options(locale) -> dict:
    """What the session setup screen offers, in the customer's language."""
    r = rules()
    return {
        "goals": [{"id": g, "label": _t(r["goals"][g]["label"], locale),
                   "description": _t(r["goals"][g]["description"], locale)} for g in GOALS],
        "durations": list(DURATIONS),
        "intensities": [{"id": i, "label": _t(r["intensities"][i]["label"], locale),
                         "description": _t(r["intensities"][i]["description"], locale)} for i in INTENSITIES],
        "intensity_footer": _t(r["intensity_footer"], locale),
        "label": _t(standard.label(), locale),
    }


# -- timing ------------------------------------------------------------------------------


def _sides(sides) -> int:
    return 2 if sides in ("each_side", "alternate") else 1


def set_seconds(dose, seconds_per_rep, timing) -> int:
    """One set's work, both sides included."""
    mult = _sides(dose.get("sides"))
    if dose.get("work_seconds"):
        work = dose["work_seconds"] * mult
    elif dose.get("mode") == "hold" or (dose.get("hold_seconds") and not dose.get("reps")):
        work = (dose.get("hold_seconds") or 0) * mult
    else:
        work = (dose.get("reps") or 0) * (seconds_per_rep or timing["seconds_per_rep_default"]) * mult
    if dose.get("sides") == "each_side":
        work += timing["side_switch"]
    return int(work)


def _between_sets(dose, intensity_rest, timing) -> int:
    if dose.get("mode") == "hold" or (dose.get("hold_seconds") and not dose.get("reps")):
        return timing["hold_rest_between_sets"]
    return intensity_rest


def transition(previous, position, timing) -> int:
    if previous is None:
        return timing["transition_standing"] if position != "standing" else timing["transition_same_position"]
    if previous == position:
        return timing["transition_same_position"]
    if "standing" in (previous, position):
        return timing["transition_standing"]
    return timing["transition_floor"]


def entry_seconds(entry, sets, *, previous_position, intensity_rest, timing) -> int:
    """Transition in, a first demonstration, the sets with rests between them, and
    the entry's own rest before the next exercise."""
    dose = entry["dose"]
    return (transition(previous_position, entry["position"], timing) + timing["first_demo"]
            + sets * set_seconds(dose, entry.get("seconds_per_rep"), timing)
            + (sets - 1) * _between_sets(dose, intensity_rest, timing) + (dose.get("rest_seconds") or 0))


# -- the pure builder ---------------------------------------------------------------------


def _order(phase, picked, r):
    """Floor flow: positions in a fixed order (fewer transitions); breathing closes
    the cool-down and opens the warm-up. Ties keep their preference order."""
    positions = r["positions"]
    rank = {e["id"]: i for i, (e, _) in enumerate(picked)}

    def key(item):
        e, _ = item
        place = positions.index(e["position"]) if e["position"] in positions else len(positions)
        breathing = "breathing" in e.get("categories", [])
        first = (0 if breathing else 1) if phase == "warm_up" else (1 if breathing else 0) if phase == "cool_down" else 0
        return (first, place, rank[e["id"]])

    return sorted(picked, key=key)


def _timeline(phases, r, intensity_rest) -> list[dict]:
    timing = r["timing"]
    out, previous = [], None
    for phase in PHASES:
        for e, sets in _order(phase, phases[phase], r):
            seconds = entry_seconds(e, sets, previous_position=previous, intensity_rest=intensity_rest, timing=timing)
            out.append({"exercise_id": e["id"], "phase": phase, "sets": sets, "seconds": seconds,
                        "position": e["position"]})
            previous = e["position"]
    return out


def _total(phases, r, intensity_rest) -> int:
    return sum(s["seconds"] for s in _timeline(phases, r, intensity_rest))


def build(inputs: dict, library: list[dict], r: dict | None = None) -> dict:
    """The plan for ``inputs`` (goal, duration, intensity, experience, demo,
    discomfort_hold, hard_step_down, last_plan, scan_focus). Pure and deterministic."""
    r = r or rules()
    goal = r["goals"][inputs["goal"]]
    span = r["durations"][str(inputs["duration"])]
    intensity = r["intensities"][inputs["intensity"]]
    timing = r["timing"]
    fired = ["READINESS_REQUIRED", "GOAL_PHASE_CATEGORIES", "INTENSITY_EFFORT", "DURATION_BUDGET",
             "EXPERIENCE_SETS", "ROOM_EQUIPMENT", "REVIEW_POLICY"]
    efforts = set(intensity["efforts"])
    if inputs.get("discomfort_hold"):
        efforts = {"light"}
        fired.append("RECENT_DISCOMFORT_HOLD")
    prefer_light = bool(inputs.get("discomfort_hold") or inputs.get("hard_step_down"))
    if inputs.get("hard_step_down") and not inputs.get("discomfort_hold"):
        fired.append("RECENT_HARD_STEP_DOWN")
    statuses = set(inputs["allowed_statuses"])
    equipment = set(r["room_equipment"])
    order = {e["id"]: i for i, e in enumerate(library)}
    levels = set(r["experience"]["levels"][inputs.get("experience", "new")])
    pool = [e for e in library
            if e["review"]["status"] in statuses and e.get("level") in levels
            and set(e.get("equipment") or []) <= equipment and e.get("effort", "light") in efforts]
    if not pool:
        return {"ok": False, "reason": "no_reviewed_content", "fired": fired, "steps": [], "estimated_seconds": 0}
    recent = set(inputs.get("last_plan") or [])
    max_sets = r["experience"]["max_sets"][inputs.get("experience", "new")]
    rest = intensity["rest_between_sets"]
    target = inputs["duration"] * 60
    low, high = span["min_minutes"] * 60, span["max_minutes"] * 60
    slack = timing["phase_slack"]

    def candidates(phase, used):
        cats = goal["phases"][phase]
        found = []
        for e in pool:
            if e["id"] in used or phase not in e.get("phases", []):
                continue
            match = [c for c in cats if c in e.get("categories", [])]
            if not match:
                continue
            # Warm-up and cool-down prefer exercises the main block cannot use.
            reserved = 1 if phase != "main" and "main" in e.get("phases", []) else 0
            found.append(((cats.index(match[0]), reserved,
                           0 if (not prefer_light or e.get("effort") == "light") else 1,
                           1 if e["id"] in recent else 0, order[e["id"]]), e))
        return [e for _, e in sorted(found, key=lambda x: x[0])]

    scan_rule = _rule(r, "SCAN_SHOULDER_LINE_VARIETY_V1")
    phases: dict = {p: [] for p in PHASES}
    used: set = set()
    scan_added = None
    # Warm-up and cool-down first (fixed shares), the main block takes the rest.
    for phase in ("warm_up", "cool_down"):
        cands = candidates(phase, used)
        if phase == "warm_up" and inputs.get("scan_focus") == "shoulder_mobility" and inputs["goal"] in scan_rule["goals"]:
            tagged = [e for e in cands if "shoulder_mobility" in (e.get("scan_tags") or [])
                      and set(e.get("categories", [])) & set(scan_rule["allowed_categories"])]
            if tagged:
                scan_added = tagged[0]["id"]
                cands = [tagged[0]] + [e for e in cands if e["id"] != scan_added]
        budget = target * span["split"][phase]
        for e in cands:
            trial = dict(phases)
            trial[phase] = phases[phase] + [(e, e["dose"].get("sets") or 1)]
            if sum(s["seconds"] for s in _timeline(trial, r, rest) if s["phase"] == phase) <= budget + slack:
                phases = trial
                used.add(e["id"])
            if sum(s["seconds"] for s in _timeline(phases, r, rest) if s["phase"] == phase) >= budget - slack:
                break
    if scan_added and scan_added not in {e["id"] for e, _ in phases["warm_up"]}:
        scan_added = None
    if scan_added:
        fired.append("SCAN_SHOULDER_LINE_VARIETY_V1")
    for e in candidates("main", used):
        trial = dict(phases)
        trial["main"] = phases["main"] + [(e, e["dose"].get("sets") or 1)]
        if _total(trial, r, rest) <= target + slack:
            phases = trial
            used.add(e["id"])
        if _total(phases, r, rest) >= target - slack:
            break
    # Still short: add sets to main exercises in order, one at a time, up to the cap.
    grew = True
    while _total(phases, r, rest) < target - slack and grew:
        grew = False
        for i, (e, sets) in enumerate(phases["main"]):
            if sets >= max_sets:
                continue
            trial = dict(phases)
            trial["main"] = list(phases["main"])
            trial["main"][i] = (e, sets + 1)
            if _total(trial, r, rest) <= target + slack:
                phases = trial
                grew = True
                if _total(phases, r, rest) >= target - slack:
                    break
    # Over the range: drop the last main exercise (never the cool-down).
    while _total(phases, r, rest) > high and len(phases["main"]) > 1:
        phases["main"] = phases["main"][:-1]
    if recent and any(e["id"] not in recent for p in PHASES for e, _ in phases[p]):
        fired.append("VARIETY_LAST_PLAN")
    steps = _timeline(phases, r, rest)
    total = sum(s["seconds"] for s in steps)
    for s in steps:
        s["scan_rule"] = s["exercise_id"] == scan_added
    out = {"ok": True, "reason": None, "fired": fired, "steps": steps, "estimated_seconds": total,
           "scan_added": scan_added, "rest_between_sets": rest, "short": False}
    if not phases["main"] or total < r["shorter_plan"]["min_minutes"] * 60:
        return {**out, "ok": False, "reason": "cannot_fill"}
    if total < low:
        # The library cannot honestly fill the time: offer the shorter plan, labelled
        # with its real length, never padded or relabelled (brief §45).
        fired.append("SHORTER_PLAN_OFFERED")
        return {**out, "short": True}
    return out


# -- inputs from the visit and the customer's history -------------------------------------


def _days_since(stamp) -> int | None:
    if not stamp:
        return None
    when = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
    if when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)
    return max(0, (datetime.now(timezone.utc) - when).days)


def history(db, student_id, *, exclude_room_session=None) -> dict:
    """What earlier room workouts say: count, last one, its feedback, last plan."""
    r = rules()
    out = {"completed_sessions": 0, "last_days": None, "discomfort_hold": False, "hard_step_down": False,
           "last_plan": [], "last_effort": None}
    if not _has(db, "s_workouts"):
        return out
    completed = db.execute("SELECT count(*) FROM s_workouts WHERE student_id=? AND state='completed'",
                           (student_id,)).fetchone()[0]
    last = db.execute("SELECT * FROM s_workouts WHERE student_id=? AND state IN ('completed','stopped') "
                      "AND (room_session_id IS NULL OR room_session_id<>?) ORDER BY COALESCE(ended_at, created_at) DESC "
                      "LIMIT 1", (student_id, exclude_room_session or "")).fetchone()
    out["completed_sessions"] = completed
    if last is None:
        return out
    out["last_days"] = _days_since(last["ended_at"] or last["created_at"])
    fb = db.execute("SELECT * FROM s_session_feedback WHERE workout_id=?", (last["id"],)).fetchone()
    if fb is not None:
        out["last_effort"] = fb["effort"]
        window = _rule(r, "RECENT_DISCOMFORT_HOLD")["window_days"]
        if fb["discomfort"] == "yes" and out["last_days"] is not None and out["last_days"] <= window:
            out["discomfort_hold"] = True
        band = r["intensities"].get(fb["target_intensity"] or "", {}).get("effort_band")
        hard_window = _rule(r, "RECENT_HARD_STEP_DOWN")["window_days"]
        if band and fb["effort"] is not None and fb["effort"] >= band[1] + 2 and out["last_days"] is not None \
                and out["last_days"] <= hard_window:
            out["hard_step_down"] = True
    if last["kind"] == "standard":
        plan = decode(last["plan"], {})
        out["last_plan"] = [s["exercise_id"] for s in plan.get("steps", [])]
    return out


def _has(db, table) -> bool:
    return db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone() is not None


def _scan_focus(db, ctx):
    """The latest completed scan of this visit, only when its shoulder-line rule was shown."""
    from . import scans

    scan = scans.latest_complete(db, ctx.room_session_id)
    if scan is None or scan["state"] != "complete":
        return None, None
    shown = db.execute("SELECT 1 FROM s_room_scan_observations WHERE scan_id=? AND rule_id='shoulder_line' "
                       "AND outcome='shown'", (scan["id"],)).fetchone()
    return scan["id"], ("shoulder_mobility" if shown else None)


def _choice(value, allowed, label):
    if value not in allowed:
        raise Denied(f"Choose a {label}.", 400, "invalid")
    return value


# -- journey actions (inside sedens.batch(), after rooms.authorize) ------------------------


def choose_personalized(sedens, db, ctx, journey_row, data):
    """session_choice → session_setup."""
    journey.require_ready(db, ctx)
    journey.require(journey_row, "session_choice")
    _event(db, ctx, "session_choice", choice="personalized")
    return journey.move(db, journey_row, "session_setup", expect=data.get("expect"), path="personalized")


def back_to_choice(sedens, db, ctx, journey_row, data):
    journey.require(journey_row, "session_setup", "recommendation")
    db.execute("UPDATE s_recommendations SET state='declined', decided_at=? WHERE room_session_id=? AND state='shown'",
               (now(), ctx.room_session_id))
    return journey.move(db, journey_row, "session_choice", expect=data.get("expect"))


def request(sedens, db, ctx, journey_row, data):
    """session_setup → recommendation, with a stored, explained plan."""
    journey.require_ready(db, ctx)
    journey.require(journey_row, "session_setup")
    goal = _choice(data.get("goal"), GOALS, "goal")
    intensity = _choice(data.get("intensity"), INTENSITIES, "effort level")
    duration = data.get("duration")
    if isinstance(duration, bool) or duration not in DURATIONS:
        raise Denied("Choose 30 or 60 minutes.", 400, "invalid")
    from . import readiness

    check = readiness.latest(db, ctx.room_session_id)
    past = history(db, ctx.student_id, exclude_room_session=ctx.room_session_id)
    scan_id, focus = _scan_focus(db, ctx)
    r = rules()
    experience = "returning" if past["completed_sessions"] >= r["experience"]["returning_after_sessions"] else "new"
    inputs = {"goal": goal, "duration": duration, "intensity": intensity, "experience": experience,
              "demo": bool(ctx.demo), "allowed_statuses": allowed_statuses(ctx.demo),
              "discomfort_hold": past["discomfort_hold"], "hard_step_down": past["hard_step_down"],
              "last_plan": past["last_plan"], "last_days": past["last_days"], "scan_focus": focus,
              "readiness": {"version": check["questionnaire_version"], "outcome": check["outcome"]},
              "room_equipment": r["room_equipment"]}
    result = build(inputs, standard.exercises(), r)
    available = round(result["estimated_seconds"] / 60) if result["estimated_seconds"] else 0
    if not result["ok"]:
        return journey_row, {"code": result["reason"], "minutes": duration, "available": available}
    reasons = rationale(inputs, result, r)
    db.execute("UPDATE s_recommendations SET state='superseded', decided_at=? WHERE room_session_id=? AND state='shown'",
               (now(), ctx.room_session_id))
    rec_id = uid()
    db.execute("INSERT INTO s_recommendations(id,room_session_id,org_id,student_id,rules_version,library_version,"
               "readiness_check_id,scan_id,goal,duration_minutes,intensity,estimated_seconds,inputs,rules_fired,plan,"
               "rationale,state,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
               (rec_id, ctx.room_session_id, ctx.org_id, ctx.student_id, CURRENT, library_version(),
                check["id"] if check else None, scan_id, goal, duration, intensity, result["estimated_seconds"],
                encode(inputs), encode(result["fired"]),
                encode({"steps": result["steps"], "rest_between_sets": result["rest_between_sets"],
                        "short": result["short"]}),
                encode(reasons), "shown", now()))
    _event(db, ctx, "recommendation_shown", goal=goal, duration=duration, intensity=intensity,
           steps=len(result["steps"]), scan_rule=bool(result.get("scan_added")), rules_version=CURRENT)
    moved = journey.move(db, journey_row, "recommendation", expect=data.get("expect"))
    if result["short"]:
        return moved, {"code": "shorter_plan", "minutes": duration, "available": available}
    return moved


def change(sedens, db, ctx, journey_row, data):
    """recommendation → session_setup (the plan shown is declined)."""
    journey.require(journey_row, "recommendation")
    db.execute("UPDATE s_recommendations SET state='declined', decided_at=? WHERE room_session_id=? AND state='shown'",
               (now(), ctx.room_session_id))
    return journey.move(db, journey_row, "session_setup", expect=data.get("expect"))


# Called with (sedens, db, ctx, recommendation) when a plan is accepted; the
# workout module registers the step that turns the plan into a workout.
ACCEPT_HOOKS: list = []


def accept(sedens, db, ctx, journey_row, data):
    """recommendation → ready_to_train with a workout built from the stored plan."""
    journey.require_ready(db, ctx)
    journey.require(journey_row, "recommendation")
    rec = current(db, ctx)
    if rec is None or rec["state"] != "shown":
        raise Denied("Ask for a new plan.", 409, "invalid_transition")
    if data.get("recommendation") and data["recommendation"] != rec["id"]:
        raise Denied("The plan on the screen changed. Showing the current plan.", 409, "journey_changed")
    db.execute("UPDATE s_recommendations SET state='accepted', decided_at=? WHERE id=? AND state='shown'",
               (now(), rec["id"]))
    for hook in ACCEPT_HOOKS:
        hook(sedens, db, ctx, rec)
    _event(db, ctx, "recommendation_accepted", goal=rec["goal"], duration=rec["duration_minutes"],
           intensity=rec["intensity"], rules_version=rec["rules_version"])
    return journey.move(db, journey_row, "ready_to_train", expect=data.get("expect"))




def _event(db, ctx, name, **props):
    analytics.record(db, name, org_id=ctx.org_id, user_id=ctx.student_id, room_id=ctx.room_id,
                     device_id=ctx.device_id, room_session_id=ctx.room_session_id, demo=ctx.demo, props=props)


def current(db, ctx) -> dict | None:
    row = db.execute("SELECT * FROM s_recommendations WHERE room_session_id=? ORDER BY created_at DESC, rowid DESC "
                     "LIMIT 1", (ctx.room_session_id,)).fetchone()
    return dict(row) if row else None


# -- explanation ------------------------------------------------------------------------


def rationale(inputs, result, r) -> list[dict]:
    """2-4 reasons, as rule ids with parameters (rendered in either language later).
    Safety-related history first, then the scan, then the last session."""
    reasons = [{"rule": "GOAL_PHASE_CATEGORIES", "params": {"goal": inputs["goal"]}},
               {"rule": "INTENSITY_EFFORT", "params": {"intensity": inputs["intensity"]}}]
    extra = []
    if "RECENT_DISCOMFORT_HOLD" in result["fired"]:
        extra.append({"rule": "RECENT_DISCOMFORT_HOLD", "params": {}})
    elif "RECENT_HARD_STEP_DOWN" in result["fired"]:
        extra.append({"rule": "RECENT_HARD_STEP_DOWN", "params": {}})
    if result.get("scan_added"):
        extra.append({"rule": "SCAN_SHOULDER_LINE_VARIETY_V1", "params": {}})
    if inputs.get("last_days") is not None:
        extra.append({"rule": "LAST_SESSION_CONTEXT", "params": {"days": inputs["last_days"]}})
    if not extra:
        extra.append({"rule": "DURATION_BUDGET", "params": {"minutes": inputs["duration"]}})
    return reasons + extra[:2]


def render_reason(reason, locale, r=None) -> str:
    r = r or rules()
    rule = _rule(r, reason["rule"])
    params = dict(reason.get("params") or {})
    if reason["rule"] == "LAST_SESSION_CONTEXT" and params.get("days") == 0:
        return _t(rule["customer_explanation_today"], locale)
    text = _t(rule["customer_explanation"], locale)
    if "goal" in params:
        params["goal"] = _t(r["goals"][params["goal"]]["label"], locale)
    if "intensity" in params:
        params["intensity"] = _t(r["intensities"][params["intensity"]]["label"], locale)
    for key, value in params.items():
        text = text.replace("{" + key + "}", str(value))
    return text


def describe(rec, locale) -> dict:
    """The recommendation screen and its "Why this session" panel."""
    r = rules(rec["rules_version"])
    plan = decode(rec["plan"], {})
    phases = {p: 0 for p in PHASES}
    steps = []
    for s in plan.get("steps", []):
        entry = standard.get(s["exercise_id"])
        phases[s["phase"]] += s["seconds"]
        steps.append({"exercise_id": s["exercise_id"], "phase": s["phase"], "sets": s["sets"],
                      "minutes": round(s["seconds"] / 60, 1),
                      "title": _t(entry["title"], locale) if entry else s["exercise_id"],
                      "position": s["position"], "scan_rule": bool(s.get("scan_rule")),
                      "review": entry["review"]["status"] if entry else "unreviewed"})
    return {
        "id": rec["id"], "goal": _t(r["goals"][rec["goal"]]["label"], locale),
        "intensity": _t(r["intensities"][rec["intensity"]]["label"], locale),
        "duration_minutes": rec["duration_minutes"], "estimated_minutes": round(rec["estimated_seconds"] / 60),
        "shorter": bool(plan.get("short")),
        "shorter_text": notice_text({"code": "shorter_plan", "minutes": rec["duration_minutes"],
                                     "available": round(rec["estimated_seconds"] / 60)}, locale)
        if plan.get("short") else None,
        "phase_minutes": {p: round(v / 60) for p, v in phases.items()},
        "steps": steps,
        "reasons": [render_reason(x, locale, r) for x in decode(rec["rationale"], [])],
        "rules_version": rec["rules_version"], "library_version": rec["library_version"],
        "label": _t(r["messages"]["label"], locale), "content_label": _t(standard.label(), locale),
    }


def notice_text(notice, locale) -> str | None:
    if not notice:
        return None
    message = rules()["messages"].get(notice["code"])
    if message is None:
        return None
    return _t(message, locale).replace("{minutes}", str(notice.get("minutes", ""))).replace(
        "{available}", str(notice.get("available", "")))


def view_part(sedens, db, ctx, journey_row, locale) -> dict:
    from . import passport

    state = journey_row["state"]
    out = {}
    if state == "session_choice":
        out["choice"] = {"courses": passport.active_courses(sedens, db, ctx),
                         "personalized": bool(allowed_statuses(ctx.demo))}
    if state == "session_setup":
        out["setup"] = options(locale)
    if state == "recommendation":
        rec = current(db, ctx)
        if rec is not None and rec["state"] == "shown":
            out["recommendation"] = describe(rec, locale)
    return out


journey.register({"plan/personalized": choose_personalized, "plan/back": back_to_choice, "plan/request": request,
                  "plan/change": change, "plan/accept": accept}, view_part=view_part)
