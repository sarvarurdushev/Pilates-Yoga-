"""Combining two libraries written by different people.

Where two sources overlap, one is better on each field, and it is not the same
one every time. Picking a winner per source throws away what the loser was good
at.
"""
from pathlib import Path

import pytest

from pilates.coaching import AngleTarget, ExerciseStandard, SymmetryTarget
from pilates.merge import (
    POLICY, merge_libraries, merge_standard, review_local_only,
)

SAMPLE = str(Path(__file__).parent / "data" / "neuro_wellness_sample.json")


def standard(name="plank", angles=(), symmetry=(), **kwargs):
    return ExerciseStandard(
        exercise=name,
        angles=[AngleTarget(joint=j, low=lo, high=hi, cue="x")
                for j, (lo, hi) in angles],
        symmetry=[SymmetryTarget(pair=p, tolerance=8, cue="y") for p in symmetry],
        **kwargs)


def record(pose, actions=("knee-flexion", "hip-flexion", "elbow-flexion"), **kwargs):
    return {"key": "x", "pose": pose, "actions": list(actions), **kwargs}


class TestPolicy:
    """Each line is a claim about which source is in a position to know, and
    can be argued with."""

    def test_every_field_names_a_source_and_a_reason(self):
        for name, (source, reason) in POLICY.items():
            assert source in ("local", "imported", "both"), name
            assert len(reason) > 20, name

    def test_anatomy_comes_from_the_import(self):
        assert POLICY["muscles"][0] == "imported"
        assert POLICY["nerves"][0] == "imported"

    def test_coaching_prose_stays_local(self):
        assert POLICY["cues"][0] == "local"
        assert POLICY["symmetry"][0] == "local"

    def test_angle_targets_belong_to_neither_alone(self):
        assert POLICY["angles"][0] == "both"


class TestMergingOneExercise:
    def test_a_target_only_the_import_has_is_added(self):
        merged = merge_standard("x", standard(), record({"knee_angle_l": 90}), None)
        assert "left_knee" in [a.joint for a in merged.standard.angles]
        assert merged.added_joints == ["left_knee"]

    def test_only_joints_the_exercise_is_about_are_added(self):
        """A target pose sets every joint the rig needs. Importing the
        incidental ones would flag a student for resting their arms differently
        during a leg exercise."""
        merged = merge_standard(
            "x", standard(),
            record({"elbow_flex_l": 10}, actions=["knee-flexion"]), None)
        assert merged.added_joints == []

    def test_the_record_says_which_joints_it_is_about(self):
        merged = merge_standard(
            "x", standard(),
            record({"elbow_flex_l": 10}, actions=["elbow-flexion"]), None)
        assert merged.added_joints == ["left_elbow"]

    def test_agreement_adds_nothing_and_contests_nothing(self):
        merged = merge_standard(
            "x", standard(angles=[("left_knee", (70, 110))]),
            record({"knee_angle_l": 90}), None)
        assert merged.added_joints == [] and merged.conflicts == []

    def test_disagreement_is_carried_not_resolved(self):
        """The midpoint of two incompatible claims is a third claim neither
        source makes."""
        merged = merge_standard(
            "x", standard(angles=[("left_knee", (160, 185))]),
            record({"knee_angle_l": 90}), None)
        assert merged.contested
        assert [a.low for a in merged.standard.angles if a.joint == "left_knee"] == [160]

    def test_local_cues_survive_the_merge(self):
        merged = merge_standard(
            "x", standard(angles=[("left_knee", (70, 110))]),
            record({"knee_angle_l": 90}), None)
        assert all(a.cue for a in merged.standard.angles)

    def test_symmetry_targets_survive_it(self):
        merged = merge_standard("x", standard(symmetry=["knee"]),
                                record({"knee_angle_l": 90}), None)
        assert merged.standard.symmetry

    def test_asymmetric_by_design_survives_it(self):
        """Losing this would mean correcting a student for doing a lunge."""
        merged = merge_standard("x", standard(asymmetric_by_design=True),
                                record({"knee_angle_l": 90}), None)
        assert merged.standard.asymmetric_by_design

    def test_a_hold_target_is_taken_from_the_import(self):
        merged = merge_standard("x", standard(), record({}, hold=45), None)
        assert merged.hold_seconds == 45.0

    def test_with_no_counterpart_the_standard_is_untouched(self):
        original = standard(angles=[("left_knee", (160, 185))])
        merged = merge_standard("x", original, None, None)
        assert merged.standard is original
        assert merged.provenance["angles"] == "local"


class TestMergingLibraries:
    def test_it_merges_the_real_sample(self):
        from pilates.coaching import DEFAULT_STANDARDS

        report = merge_libraries(DEFAULT_STANDARDS, SAMPLE)
        assert len(report.merged) == len(DEFAULT_STANDARDS)

    def test_an_import_never_deletes_an_exercise(self):
        """"The other library does not contain it" is not evidence that it is
        wrong."""
        report = merge_libraries({"moon_salutation": standard("moon_salutation")},
                                 SAMPLE)
        assert report.local_only == ["moon_salutation"]
        assert "moon_salutation" in report.merged

    def test_imported_exercises_with_no_standard_are_counted(self):
        report = merge_libraries({"tree": standard("tree")}, SAMPLE)
        assert report.imported_only

    def test_the_summary_lists_every_conflict(self):
        from pilates.coaching import DEFAULT_STANDARDS

        report = merge_libraries(DEFAULT_STANDARDS, SAMPLE)
        text = report.describe()
        for merged in report.contested:
            assert merged.exercise in text

    def test_anatomy_is_attached_where_it_matched(self):
        from pilates.coaching import DEFAULT_STANDARDS

        report = merge_libraries(DEFAULT_STANDARDS, SAMPLE)
        assert any(m.anatomy is not None for m in report.merged.values())


class TestKeepOrDrop:
    """Absence from one library is weak evidence. The question asked instead is
    whether the standard says something a general check does not."""

    def test_a_classical_exercise_is_kept_regardless(self):
        verdicts = review_local_only(["the_hundred"], {"the_hundred": standard("the_hundred")})
        assert verdicts[0].keep and "classical" in verdicts[0].reason

    def test_a_standard_of_only_straight_limbs_is_dropped(self):
        """The general movement-quality check already covers it, and keeping
        the name costs a class the recogniser can confuse."""
        only_straight = standard("invented", angles=[("left_knee", (160, 185)),
                                                     ("right_knee", (160, 185))])
        verdict = review_local_only(["invented"], {"invented": only_straight})[0]
        assert not verdict.keep

    def test_a_specific_target_earns_its_keep(self):
        specific = standard("invented", angles=[("left_knee", (70, 110))])
        assert review_local_only(["invented"], {"invented": specific})[0].keep

    def test_a_symmetry_target_earns_it_too(self):
        """The general check cannot make that call without knowing the exercise
        is meant to be even."""
        even = standard("invented", angles=[("left_knee", (160, 185))],
                        symmetry=["knee"])
        verdict = review_local_only(["invented"], {"invented": even})[0]
        assert verdict.keep and "left/right" in verdict.reason

    def test_the_verdict_explains_itself_either_way(self):
        verdicts = review_local_only(
            ["a", "b"],
            {"a": standard("a", angles=[("left_knee", (160, 185))]),
             "b": standard("b", angles=[("left_knee", (70, 110))])})
        assert all(len(v.reason) > 30 for v in verdicts)

    def test_an_unknown_name_is_skipped_rather_than_judged(self):
        assert review_local_only(["ghost"], {}) == []

    def test_the_dropped_one_was_actually_acted_on(self):
        """standing_back_bend was reviewed, dropped, and moved to the refusal
        list rather than deleted, so labelling a video with it still explains
        itself."""
        from pilates.coaching import DEFAULT_STANDARDS, UNSUITABLE

        assert "standing_back_bend" not in DEFAULT_STANDARDS
        assert "standing_back_bend" in UNSUITABLE
        assert "depth axis" in UNSUITABLE["standing_back_bend"]
