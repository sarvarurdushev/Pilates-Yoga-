"""Phase 4: which room scans may be compared (pilates/sedens/scan_history.py), and what a
comparison says. Each reason code has its own case; version strings here are made up, so
a change to the real measurement version never touches these tests."""

from __future__ import annotations

import json

import pytest

from pilates import assessment
from pilates.sedens import feedback, scan_history, scans
from pilates.sedens.util import encode, uid
from sedens_support import facility, make_sedens

EVALUATED = [{"rule_id": "shoulder_line", "metric": "shoulder_tilt", "outcome": "shown"}]


def measured(front, back):
    def view(value):
        return {"people": 1, "suitable": True, "metrics": {"shoulder_tilt": {
            "value": value, "unit": "deg", "confidence": 0.9, "status": "measured"}}}
    return {"front": view(front), "back": view(back)}


def scan(front=-3.0, back=-3.0, **over):
    row = {"id": uid(), "student_id": "customer-1", "org_id": "org-1", "source": "room_capture", "origin": "room",
           "state": "complete", "reliability": "clear", "protocol": scans.PROTOCOL,
           "measurement_version": "version-a", "model": "model-a", "feedback_rules_version": feedback.CURRENT,
           "completed_at": "2026-10-01T09:00:00+00:00",
           "summary": encode({"evaluated": EVALUATED, "measurements": measured(front, back)})}
    row.update(over)
    return row


def test_two_alike_scans_are_comparable():
    assert scan_history.comparable(scan(), scan()) == (True, [])
    assert scan_history.comparable(scan(source="experimental_real"), scan(source="room_capture"))[0]


@pytest.mark.parametrize("change,code", [
    ({"student_id": "customer-2"}, "different_customer"),
    ({"org_id": "org-2"}, "different_customer"),
    ({"reliability": "limited"}, "low_quality"),
    ({"reliability": "retake"}, "low_quality"),
    ({"reliability": None}, "low_quality"),
    ({"state": "failed"}, "low_quality"),
    ({"state": "processing"}, "low_quality"),
    ({"source": "demo_precomputed"}, "demo_vs_real"),
    ({"origin": "demo_seed"}, "demo_vs_real"),
    ({"protocol": "workspace_v1"}, "different_protocol"),
    ({"measurement_version": "version-b"}, "different_measurement_version"),
    ({"model": "model-b"}, "different_model"),
    ({"feedback_rules_version": "sedens-feedback-0.9.0"}, "different_rules_version"),
    ({"summary": encode({"evaluated": [{"rule_id": "shoulder_line", "outcome": "withheld"}]})}, "observation_withheld"),
    ({"summary": encode({"evaluated": []})}, "observation_withheld"),
    ({"summary": encode({})}, "observation_withheld"),
])
def test_each_rule_has_its_own_reason_code(change, code):
    for a, b in ((scan(), scan(**change)), (scan(**change), scan())):  # the order does not matter
        ok, reasons = scan_history.comparable(a, b)
        assert ok is False and reasons == [code]
        assert set(scan_history.REASONS[code]) == {"en", "ko"}


def test_below_threshold_still_counts_as_evaluated():
    quiet = scan(summary=encode({"evaluated": [{"rule_id": "shoulder_line", "outcome": "below_threshold"}]}))
    assert scan_history.comparable(scan(), quiet) == (True, [])


def test_a_different_measurement_version_is_never_comparable_even_with_the_real_version():
    a, b = scan(measurement_version=assessment.VERSION), scan(measurement_version=assessment.VERSION + "-next")
    assert scan_history.comparable(a, b) == (False, ["different_measurement_version"])
    assert scan_history.comparable(a, scan(measurement_version=assessment.VERSION))[0]


def test_demonstration_and_seeded_history_are_three_separate_worlds():
    real = scan()
    room_demo = scan(source="demo_precomputed", measurement_version="demo", model="demo")
    seed = scan(source="demo_precomputed", origin="demo_seed", measurement_version="demo", model="demo")
    seed_real = scan(origin="demo_seed")
    assert scan_history.comparable(room_demo, scan(source="demo_precomputed", measurement_version="demo",
                                                   model="demo")) == (True, [])
    assert scan_history.comparable(seed, scan(source="demo_precomputed", origin="demo_seed",
                                              measurement_version="demo", model="demo")) == (True, [])
    for a, b in ((real, room_demo), (real, seed), (room_demo, seed), (real, seed_real)):
        ok, reasons = scan_history.comparable(a, b)
        assert not ok and "demo_vs_real" in reasons, (a["source"], a["origin"], b["source"], b["origin"])


def test_every_failing_rule_is_named_in_order():
    ok, reasons = scan_history.comparable(scan(), scan(student_id="other", reliability="limited", protocol="x",
                                                        measurement_version="version-b", model="model-b",
                                                        feedback_rules_version="old", source="demo_precomputed",
                                                        summary="{}"))
    assert not ok
    assert reasons == ["different_customer", "low_quality", "demo_vs_real", "different_protocol",
                       "different_measurement_version", "different_model", "different_rules_version",
                       "observation_withheld"]


# == the comparison itself ====================================================================


@pytest.mark.parametrize("locale", ["en", "ko"])
def test_a_comparison_states_values_and_difference_never_better_or_worse(locale):
    earlier = scan(front=-4.0, back=-4.0, completed_at="2026-10-01T09:00:00+00:00")
    later = scan(front=-1.0, back=-1.2, completed_at="2026-10-20T09:00:00+00:00")
    result = scan_history.compare(earlier, later, locale)
    assert result["comparable"] is True
    assert result["earlier_date"] < result["later_date"]
    assert result["earlier_values"] == {"views": {"front": -4.0, "back": -4.0}, "mean": -4.0, "unit": "deg"}
    assert result["later_values"]["mean"] == -1.1
    assert result["difference"] == 2.9
    assert result["measured"]["views"] == ["front", "back"]
    assert result["versions"] == {"measurement": "version-a", "feedback_rules": feedback.CURRENT,
                                  "protocol": scans.PROTOCOL}
    text = json.dumps(result, ensure_ascii=False).lower()
    for word in ("improve", "better than", "worse than", "score", "개선", "점수", "호전"):
        assert word not in text, word
    assert len(result["limitations"]) == 2  # the measurement's limitation, and that repeatability is not established
    assert result["limitations"][1] == scan_history.NOT_ESTABLISHED[locale]


def test_a_small_difference_is_reported_as_within_usual_variation():
    result = scan_history.compare(scan(-3.0, -3.0), scan(-3.1, -2.9, completed_at="2026-10-20T09:00:00+00:00"), "en")
    assert result["comparable"] and result["text"] == feedback.rules()["comparison"]["no_difference"]["en"]


def test_a_refusal_gives_the_plain_message_and_every_reason():
    result = scan_history.compare(scan(), scan(measurement_version="version-b", model="model-b"), "en")
    assert result["comparable"] is False
    assert result["message"] == "There isn't enough comparable information yet."
    assert [r["code"] for r in result["reasons"]] == ["different_measurement_version", "different_model"]
    assert all(r["text"] for r in result["reasons"])
    ko = scan_history.compare(scan(), scan(protocol="x"), "ko")
    assert ko["message"] == scan_history.NOT_ENOUGH["ko"] and ko["reasons"][0]["text"]


# == scans._previous follows the same rules ====================================================


def test_the_in_room_comparison_uses_the_same_predicate(tmp_path):
    sedens = make_sedens(tmp_path / "s.db")
    fac = facility(sedens, "A")
    me, org = fac["customer_id"], fac["org_id"]

    def store(marker, completed, evaluated="shown", **over):
        row = {"id": uid(), "org_id": org, "student_id": me, "protocol": scans.PROTOCOL, "source": "room_capture",
               "state": "complete", "reliability": "clear", "feedback_rules_version": feedback.CURRENT,
               "measurement_version": "version-a", "model": "model-a", "origin": "room"}
        row.update(over)
        with sedens.db() as db:
            db.execute("INSERT INTO s_room_scans(id,org_id,student_id,protocol,source,state,reliability,"
                       "feedback_rules_version,measurement_version,model,origin,summary,started_at,completed_at) "
                       "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                       (row["id"], row["org_id"], row["student_id"], row["protocol"], row["source"], row["state"],
                        row["reliability"], row["feedback_rules_version"], row["measurement_version"], row["model"],
                        row["origin"], encode({"measurements": {"marker": marker},
                                               "evaluated": [{"rule_id": "shoulder_line", "outcome": evaluated}]}),
                        completed, completed))

    store("withheld", "2026-10-06T09:00:00+00:00", evaluated="withheld")
    store("older-version", "2026-10-05T09:00:00+00:00", measurement_version="version-b")
    store("other-model", "2026-10-04T09:00:00+00:00", model="model-b")
    store("seeded", "2026-10-03T09:00:00+00:00", origin="demo_seed")
    store("match", "2026-10-02T09:00:00+00:00")
    current = {"id": uid(), "org_id": org, "student_id": me, "protocol": scans.PROTOCOL, "source": "room_capture",
               "measurement_version": "version-a", "model": "model-a"}
    with sedens.db() as db:
        # The newer scans are skipped for what they differ in; the matching one is found.
        assert scans._previous(db, current) == {"marker": "match"}
        assert scans._previous(db, {**current, "measurement_version": "version-c"}) is None
        assert scans._previous(db, {**current, "model": "model-c"}) is None
        assert scans._previous(db, {**current, "measurement_version": "version-b"}) == {"marker": "older-version"}
        assert scans._previous(db, {**current, "origin": "demo_seed"}) == {"marker": "seeded"}
        assert scans._previous(db, {**current, "org_id": "another-org"}) is None
        # The scan being completed is judged too: a limited one, or one whose shoulder line
        # was withheld, is not compared with anything.
        assert scans._previous(db, {**current, "reliability": "limited"}) is None
        assert scans._previous(db, {**current, "summary": {"evaluated": [
            {"rule_id": "shoulder_line", "outcome": "withheld"}]}}) is None


def test_a_withheld_shoulder_line_is_never_compared_in_the_room(tmp_path):
    """Front and back disagree on the earlier scan, so its shoulder line was withheld: the
    room screen must not compare against it, exactly as the history refuses the pair."""
    sedens = make_sedens(tmp_path / "s.db")
    fac = facility(sedens, "A")

    rule = next(o for o in feedback.rules(feedback.CURRENT)["observations"] if o["id"] == "shoulder_line")

    def metrics(front, back):
        return {v: {"metrics": {rule["metric"]: {"value": x, "status": "measured", "confidence": 0.9}}}
                for v, x in (("front", front), ("back", back))}

    earlier = metrics(6.0, -1.0)
    first = feedback.interpret(earlier, locale="en")
    assert next(e for e in first["evaluated"] if e["rule_id"] == "shoulder_line")["outcome"] == "withheld"
    with sedens.db() as db:
        db.execute("INSERT INTO s_room_scans(id,org_id,student_id,protocol,source,state,reliability,"
                   "feedback_rules_version,measurement_version,model,origin,summary,started_at,completed_at) "
                   "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                   (uid(), fac["org_id"], fac["customer_id"], scans.PROTOCOL, "room_capture", "complete",
                    first["quality"], feedback.CURRENT, "v", "m", "room",
                    encode({"measurements": earlier, "evaluated": first["evaluated"]}),
                    "2026-10-01T09:00:00+00:00", "2026-10-01T09:00:00+00:00"))
        current = {"id": uid(), "org_id": fac["org_id"], "student_id": fac["customer_id"],
                   "protocol": scans.PROTOCOL, "source": "room_capture", "measurement_version": "v", "model": "m",
                   "reliability": "clear", "summary": {"evaluated": [{"rule_id": "shoulder_line",
                                                                      "outcome": "shown"}]}}
        assert scans._previous(db, current) is None
