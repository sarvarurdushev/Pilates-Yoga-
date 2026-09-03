import math

import pytest

from pilates.coaching import (
    DEFAULT_STANDARDS, NOTABLE_DEGREES, SIGNIFICANT_DEGREES, AngleTarget,
    ExerciseStandard, Finding, SymmetryTarget, assess, assess_tempo,
    load_standards, narrate, save_standards,
)
from pilates.movement import MovementSummary, TrackHistory
from conftest import make_detection


def history(angles: dict, frames=30, trunk=88.0, confidence=0.9):
    """A student holding a fixed set of joint angles."""
    h = TrackHistory(track_id=1)
    det = make_detection(x=100, y=100, confidence=confidence)
    for i in range(frames):
        h.add(i * 0.1, det, 0.4)
        for name, value in angles.items():
            h.samples[-1].angles[name] = value
        h.samples[-1].trunk = trunk
    return h


STRAIGHT = {"left_knee": 175.0, "right_knee": 175.0,
            "left_hip": 172.0, "right_hip": 172.0,
            "left_elbow": 170.0, "right_elbow": 170.0}


class TestAngleTarget:
    def test_inside_the_range_is_zero(self):
        assert AngleTarget("left_knee", 165, 185, "x").deviation(175) == 0.0

    def test_below_the_range(self):
        assert AngleTarget("left_knee", 165, 185, "x").deviation(150) == 15.0

    def test_above_the_range(self):
        assert AngleTarget("left_knee", 165, 185, "x").deviation(190) == 5.0

    def test_boundaries_are_inside(self):
        target = AngleTarget("left_knee", 165, 185, "x")
        assert target.deviation(165) == 0.0 and target.deviation(185) == 0.0


class TestAssess:
    def test_a_good_position_is_praised(self):
        result = assess(history(STRAIGHT), DEFAULT_STANDARDS["mountain"])
        assert result.good
        assert not result.improve

    def test_a_bent_knee_is_flagged_with_its_number(self):
        angles = dict(STRAIGHT, left_knee=140.0)
        result = assess(history(angles), DEFAULT_STANDARDS["mountain"])
        knee = [f for f in result.improve if f.subject == "left_knee"]
        assert knee
        assert knee[0].measured == pytest.approx(140.0)
        assert knee[0].deviation == pytest.approx(25.0)

    def test_nothing_is_said_without_a_measurement(self):
        """Every claim must carry the number it came from."""
        result = assess(history(STRAIGHT), DEFAULT_STANDARDS["mountain"])
        for finding in result.good + result.improve:
            assert finding.measured is not None

    def test_an_invisible_joint_is_reported_as_unmeasured(self):
        angles = dict(STRAIGHT)
        angles["left_knee"] = None
        h = TrackHistory(track_id=1)
        det = make_detection()
        for i in range(30):
            h.add(i * 0.1, det, 0.4)
            for name, value in angles.items():
                h.samples[-1].angles[name] = value
            h.samples[-1].trunk = 88.0
        result = assess(h, DEFAULT_STANDARDS["mountain"])
        assert any(f.subject == "left_knee" for f in result.unmeasured)
        assert not any(f.subject == "left_knee" for f in result.improve)

    def test_a_small_deviation_is_not_worth_saying(self):
        angles = dict(STRAIGHT, left_knee=163.0)   # 2 degrees under
        result = assess(history(angles), DEFAULT_STANDARDS["mountain"])
        assert not [f for f in result.improve if f.subject == "left_knee"]

    def test_asymmetry_is_detected(self):
        angles = dict(STRAIGHT, left_knee=175.0, right_knee=150.0)
        result = assess(history(angles), DEFAULT_STANDARDS["mountain"])
        assert any(f.subject == "knee symmetry" for f in result.improve)

    def test_symmetry_within_tolerance_is_praised(self):
        result = assess(history(STRAIGHT), DEFAULT_STANDARDS["mountain"])
        assert any(f.subject == "knee symmetry" for f in result.good)

    def test_too_few_samples_measures_nothing(self):
        result = assess(history(STRAIGHT, frames=2), DEFAULT_STANDARDS["mountain"])
        assert result.improve == []
        assert result.unmeasured

    def test_the_median_resists_one_bad_frame(self):
        h = history(STRAIGHT, frames=30)
        h.samples[10].angles["left_knee"] = 20.0    # a single wild estimate
        result = assess(h, DEFAULT_STANDARDS["mountain"])
        assert not [f for f in result.improve if f.subject == "left_knee"]

    def test_priority_is_the_worst_deviation(self):
        angles = dict(STRAIGHT, left_knee=160.0, right_knee=120.0)
        result = assess(history(angles), DEFAULT_STANDARDS["mountain"])
        assert result.priority.subject == "right_knee"

    def test_no_priority_when_everything_is_fine(self):
        assert assess(history(STRAIGHT), DEFAULT_STANDARDS["mountain"]).priority is None


class TestTempo:
    def _summary(self, kind="repetitive", duration=4.0):
        return MovementSummary(
            track_id=1, signal="left_hip", kind=kind, samples=100, duration=30.0,
            repetitions=6, mean_range=40.0, range_consistency=3.0,
            mean_rep_duration=duration, mean_tempo_ratio=1.0, control_ratio=1.1,
            signal_confidence=0.9, longest_hold=None,
        )

    def test_a_good_pace_is_praised(self):
        finding = assess_tempo(self._summary(duration=4.0), DEFAULT_STANDARDS["bridge"])
        assert finding.kind == "good"

    def test_too_fast_is_flagged(self):
        finding = assess_tempo(self._summary(duration=1.0), DEFAULT_STANDARDS["bridge"])
        assert finding.kind == "improve" and finding.deviation == pytest.approx(2.0)

    def test_not_judged_for_a_sequence(self):
        """Pace is meaningless when there were no repetitions to pace."""
        assert assess_tempo(self._summary(kind="sequence"), DEFAULT_STANDARDS["bridge"]) is None

    def test_not_judged_without_a_tempo_standard(self):
        assert assess_tempo(self._summary(), DEFAULT_STANDARDS["mountain"]) is None


class TestNarration:
    def test_reports_both_sides(self):
        angles = dict(STRAIGHT, left_knee=140.0)
        text = narrate(assess(history(angles), DEFAULT_STANDARDS["mountain"]))
        assert "Going well" in text and "Worth working on" in text

    def test_includes_the_measurement(self):
        angles = dict(STRAIGHT, left_knee=140.0)
        text = narrate(assess(history(angles), DEFAULT_STANDARDS["mountain"]))
        assert "140" in text and "165-185" in text

    def test_says_so_when_nothing_is_wrong(self):
        text = narrate(assess(history(STRAIGHT), DEFAULT_STANDARDS["mountain"]))
        assert "Nothing stood out" in text

    def test_offers_one_priority(self):
        angles = dict(STRAIGHT, left_knee=130.0)
        text = narrate(assess(history(angles), DEFAULT_STANDARDS["mountain"]))
        assert "One thing for next time" in text

    def test_an_untracked_student_gets_no_notes(self):
        empty = TrackHistory(track_id=9)
        assert "not tracked long enough" in narrate(assess(empty, DEFAULT_STANDARDS["mountain"]))


class TestStandardsAreData:
    def test_round_trip(self, tmp_path):
        path = tmp_path / "s.json"
        save_standards(DEFAULT_STANDARDS, path)
        loaded = load_standards(path)
        assert set(loaded) == set(DEFAULT_STANDARDS)
        assert loaded["bridge"].tempo_seconds == (3.0, 6.0)
        assert loaded["mountain"].angles[0].joint == "trunk"

    def test_a_studio_can_supply_its_own(self, tmp_path):
        custom = {"my_move": ExerciseStandard(
            exercise="my_move",
            angles=[AngleTarget("left_knee", 100, 120, "bend more")],
        )}
        path = tmp_path / "c.json"
        save_standards(custom, path)
        loaded = load_standards(path)
        result = assess(history(dict(STRAIGHT)), loaded["my_move"])
        assert result.improve[0].message == "bend more"

    def test_side_bend_deliberately_omits_trunk(self):
        """A side bend and a back bend look alike from one camera, so a trunk
        target here would be measuring the wrong thing."""
        joints = {a.joint for a in DEFAULT_STANDARDS["standing_side_bend"].angles}
        assert "trunk" not in joints
        assert DEFAULT_STANDARDS["standing_side_bend"].notes
