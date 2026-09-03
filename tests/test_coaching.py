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
        standard = DEFAULT_STANDARDS["mountain"]
        target = next(t for t in standard.angles if t.joint == "left_knee")
        result = assess(history(dict(STRAIGHT, left_knee=140.0)), standard)
        knee = [f for f in result.improve if f.subject == "left_knee"]
        assert knee
        assert knee[0].measured == pytest.approx(140.0)
        assert knee[0].deviation == pytest.approx(target.deviation(140.0))

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
        standard = DEFAULT_STANDARDS["mountain"]
        target = next(t for t in standard.angles if t.joint == "left_knee")
        text = narrate(assess(history(dict(STRAIGHT, left_knee=140.0)), standard))
        assert "140" in text
        assert f"{target.low:.0f}-{target.high:.0f}" in text

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


class TestStandardsCoverage:
    def test_covers_the_classical_pilates_mat_order(self):
        for name in ("the_hundred", "roll_up", "single_leg_circle",
                     "rolling_like_a_ball", "single_leg_stretch",
                     "double_leg_stretch", "spine_stretch_forward", "swan",
                     "single_leg_kick", "neck_pull", "bridge", "teaser",
                     "swimming", "leg_pull_front", "seal"):
            assert name in DEFAULT_STANDARDS, name

    def test_covers_the_sun_salutation(self):
        for name in ("mountain", "upward_salute", "forward_fold", "half_lift",
                     "chaturanga", "upward_dog", "downward_dog", "plank"):
            assert name in DEFAULT_STANDARDS, name

    def test_every_standard_names_its_own_exercise(self):
        for name, standard in DEFAULT_STANDARDS.items():
            assert standard.exercise == name

    def test_every_target_uses_a_real_signal(self):
        from pilates.movement import CANDIDATE_SIGNALS
        for standard in DEFAULT_STANDARDS.values():
            for target in standard.angles:
                assert target.joint in CANDIDATE_SIGNALS, target.joint

    def test_every_cue_is_written_for_a_person(self):
        for standard in DEFAULT_STANDARDS.values():
            for target in standard.angles:
                assert len(target.cue.split()) >= 3, target.cue
                assert not target.cue.endswith("."), target.cue

    def test_ranges_are_the_right_way_round(self):
        for standard in DEFAULT_STANDARDS.values():
            for target in standard.angles:
                assert target.low < target.high, f"{standard.exercise}/{target.joint}"


class TestAsymmetricByDesign:
    """A lunge, a single leg stretch and any warrior are meant to be uneven.
    Flagging that would be telling a student off for doing it correctly."""

    def test_one_sided_exercises_are_marked(self):
        for name in ("warrior_two", "low_lunge", "tree", "single_leg_stretch",
                     "single_leg_kick", "single_leg_circle", "leg_pull_front"):
            assert DEFAULT_STANDARDS[name].asymmetric_by_design, name

    def test_two_sided_exercises_are_not(self):
        for name in ("mountain", "plank", "bridge", "the_hundred", "downward_dog"):
            assert not DEFAULT_STANDARDS[name].asymmetric_by_design, name

    def test_no_symmetry_finding_is_produced_for_them(self):
        angles = dict(STRAIGHT, left_knee=90.0, right_knee=175.0)   # a lunge shape
        result = assess(history(angles, trunk=88.0), DEFAULT_STANDARDS["warrior_two"])
        assert not any("symmetry" in f.subject for f in result.findings)

    def test_the_same_shape_is_flagged_where_it_should_be(self):
        angles = dict(STRAIGHT, left_knee=90.0, right_knee=175.0)
        result = assess(history(angles), DEFAULT_STANDARDS["mountain"])
        assert any("symmetry" in f.subject for f in result.improve)

    def test_a_symmetry_target_is_ignored_if_wrongly_added(self):
        from pilates.coaching import ExerciseStandard, SymmetryTarget
        standard = ExerciseStandard(
            exercise="x", symmetry=[SymmetryTarget("knee", 2, "uneven")],
            asymmetric_by_design=True,
        )
        angles = dict(STRAIGHT, left_knee=90.0, right_knee=175.0)
        assert assess(history(angles), standard).findings == []


class TestUnsuitable:
    """Some exercises are not gaps waiting to be filled: the measurement is not
    in a flat image."""

    def test_rotation_exercises_are_excluded(self):
        from pilates.coaching import UNSUITABLE
        for name in ("spine_twist", "seated_twist", "saw", "corkscrew"):
            assert name in UNSUITABLE

    def test_exclusions_are_not_also_standards(self):
        from pilates.coaching import UNSUITABLE
        assert not set(UNSUITABLE) & set(DEFAULT_STANDARDS)

    def test_every_exclusion_gives_a_reason(self):
        from pilates.coaching import UNSUITABLE
        for name, reason in UNSUITABLE.items():
            assert len(reason.split()) >= 5, name

    def test_triangle_is_excluded_for_the_measured_reason(self):
        from pilates.coaching import UNSUITABLE
        assert "back bend" in UNSUITABLE["triangle"]
