"""Coaching an exercise nobody has written a standard for.

A library of named exercises will never be finished, so most of a real class is
something it does not contain. These are the two things that can still be said.
"""
import statistics

import pytest

from pilates.movement import MovementSummary, TrackHistory
from pilates.universal import (
    CONTROL_LIMIT, MAX_CLASS_SPREAD, MIN_COHORT, MIN_DEVIATION, ClassBaseline,
    assess_against_class, assess_quality, assess_unnamed, build_baseline,
)
from conftest import make_detection


def summary(**kwargs):
    fields = dict(
        track_id=1, signal="left_knee", kind="repetitive", samples=100,
        duration=30.0, repetitions=8, mean_range=60.0, range_consistency=5.0,
        mean_rep_duration=3.0, mean_tempo_ratio=1.2, control_ratio=1.0,
        signal_confidence=0.9, longest_hold=None, mean_symmetry={},
    )
    fields.update(kwargs)
    return MovementSummary(**fields)


def history(track_id=1, n=40, threshold=0.4, **angles):
    """A student holding a fixed set of joint angles, in image geometry.

    Angles are imposed directly on the samples rather than posed, because what
    is under test is the comparison, not the geometry that feeds it.
    """
    out = TrackHistory(track_id=track_id)
    for i in range(n):
        out.add(i / 10.0, make_detection(), threshold)
        for joint, value in angles.items():
            out.samples[-1].angles[joint] = value
    return out


class TestQualityWithoutAName:
    """Wobble, uneven repetitions and a dropped return are faults in a teaser
    and in a squat alike."""

    def test_a_wobbly_movement_is_flagged(self):
        findings = assess_quality(summary(control_ratio=2.4))
        assert any(f.subject == "control" and f.kind == "improve" for f in findings)

    def test_a_smooth_one_is_praised(self):
        findings = assess_quality(summary(control_ratio=1.0))
        assert any(f.subject == "control" and f.kind == "good" for f in findings)

    def test_uneven_repetitions_are_flagged(self):
        findings = assess_quality(summary(mean_range=60.0, range_consistency=30.0))
        assert any(f.subject == "consistency" for f in findings)

    def test_consistency_is_judged_against_the_size_of_the_movement(self):
        """Five degrees of variation in a sixty-degree movement is tight; in a
        ten-degree movement it is not the same movement twice."""
        assert not any(f.subject == "consistency"
                       for f in assess_quality(summary(mean_range=60.0,
                                                       range_consistency=5.0)))
        assert any(f.subject == "consistency"
                   for f in assess_quality(summary(mean_range=10.0,
                                                   range_consistency=5.0)))

    def test_a_dropped_return_is_flagged(self):
        findings = assess_quality(summary(mean_tempo_ratio=0.5))
        assert any(f.subject == "tempo" for f in findings)

    def test_a_controlled_return_is_not(self):
        assert not any(f.subject == "tempo"
                       for f in assess_quality(summary(mean_tempo_ratio=1.5)))

    def test_repetition_qualities_are_not_claimed_for_a_held_position(self):
        """Reps per minute means nothing in a plank."""
        findings = assess_quality(summary(kind="held", longest_hold=45.0,
                                          control_ratio=9.0))
        assert not any(f.subject == "control" for f in findings)

    def test_a_hold_is_reported_as_what_it_was(self):
        findings = assess_quality(summary(kind="held", longest_hold=45.0))
        assert any("45 seconds" in f.message for f in findings)

    def test_a_sequence_gets_no_repetition_findings(self):
        assert assess_quality(summary(kind="sequence")) == []

    def test_nothing_is_invented_from_missing_numbers(self):
        findings = assess_quality(summary(control_ratio=None, mean_range=None,
                                          range_consistency=None,
                                          mean_tempo_ratio=None))
        assert findings == []


class TestClassBaseline:
    """Everyone in the room is doing the same thing at the same time, so the
    cohort is a standard that needs no library."""

    def _cohort(self, values, joint="left_knee"):
        return [history(track_id=i, **{joint: v}) for i, v in enumerate(values)]

    def test_the_median_becomes_the_standard(self):
        baseline = build_baseline(self._cohort([80, 90, 100, 110, 120]))
        assert baseline.medians["left_knee"] == pytest.approx(100.0)

    def test_too_few_students_is_not_a_class(self):
        """With three people the median is one person's opinion."""
        baseline = build_baseline(self._cohort([80, 90, 100]))
        assert not baseline.usable
        assert f"{MIN_COHORT}" in baseline.explain()

    def test_a_class_that_did_not_agree_is_no_standard(self):
        """Strung out over forty degrees, the room was not doing one thing, and
        calling its middle correct invents a target nobody aimed at."""
        baseline = build_baseline(self._cohort([20, 60, 100, 140, 180]))
        assert baseline.usable
        assert not baseline.agreed_on("left_knee")

    def test_a_tight_class_is(self):
        baseline = build_baseline(self._cohort([88, 90, 92, 94, 96]))
        assert baseline.agreed_on("left_knee")

    def test_the_spread_survives_one_outlier(self):
        """A median absolute deviation, so one badly tracked student cannot
        disqualify the whole class."""
        baseline = build_baseline(self._cohort([88, 90, 92, 94, 5]))
        assert baseline.agreed_on("left_knee")

    def test_the_explanation_names_what_was_not_agreed(self):
        baseline = build_baseline(self._cohort([20, 60, 100, 140, 180]))
        assert "did not agree" in baseline.explain()

    def test_students_with_nothing_measurable_are_not_counted(self):
        empty = [TrackHistory(track_id=9) for _ in range(3)]
        baseline = build_baseline(self._cohort([88, 90, 92, 94]) + empty)
        assert baseline.students == 4


class TestAsymmetryByDesign:
    """The one inference a room gives that no library lookup does: it holds for
    a variation nobody has named."""

    def _lunge_class(self, n=6, gap=40.0):
        return [history(track_id=i, left_knee=170.0, right_knee=170.0 - gap)
                for i in range(n)]

    def test_a_gap_shared_by_the_whole_class_belongs_to_the_exercise(self):
        baseline = build_baseline(self._lunge_class())
        assert baseline.asymmetric_by_design("knee")

    def test_an_even_class_is_not_called_asymmetric(self):
        baseline = build_baseline([history(track_id=i, left_knee=170.0,
                                           right_knee=168.0) for i in range(6)])
        assert not baseline.asymmetric_by_design("knee")

    def test_a_student_matching_an_uneven_class_is_not_corrected(self):
        """Flagging them would be telling somebody off for doing a lunge."""
        cohort = self._lunge_class()
        baseline = build_baseline(cohort)
        assert not [f for f in assess_against_class(cohort[0], baseline)
                    if f.subject == "knee_symmetry"]

    def test_a_student_more_uneven_than_the_class_still_is(self):
        cohort = self._lunge_class()
        odd = history(track_id=99, left_knee=170.0, right_knee=100.0)
        baseline = build_baseline(cohort)
        assert [f for f in assess_against_class(odd, baseline)
                if f.subject == "knee_symmetry"]

    def test_the_explanation_says_the_movement_is_uneven_by_design(self):
        assert "uneven by design" in build_baseline(self._lunge_class()).explain()


class TestAgainstTheClass:
    def _cohort(self, n=6, value=90.0):
        return [history(track_id=i, left_knee=value + i) for i in range(n)]

    def test_a_student_far_from_the_class_is_flagged(self):
        cohort = self._cohort()
        baseline = build_baseline(cohort)
        odd = history(track_id=99, left_knee=160.0)
        assert [f for f in assess_against_class(odd, baseline)
                if f.subject == "left_knee"]

    def test_a_student_inside_the_class_is_not(self):
        cohort = self._cohort()
        baseline = build_baseline(cohort)
        assert assess_against_class(cohort[2], baseline) == []

    def test_the_finding_names_the_class_median_as_the_target(self):
        baseline = build_baseline(self._cohort())
        odd = history(track_id=99, left_knee=160.0)
        finding = assess_against_class(odd, baseline)[0]
        assert "class median" in finding.target

    def test_a_small_gap_is_below_the_floor(self):
        """Normal human variation is not a fault."""
        baseline = build_baseline(self._cohort())
        near = history(track_id=99, left_knee=95.0)
        assert assess_against_class(near, baseline) == []
        assert MIN_DEVIATION > 5.0

    def test_a_loose_class_holds_its_members_to_a_wider_bar(self):
        """A tight class and a loose one cannot use the same absolute bar."""
        tight = build_baseline([history(track_id=i, left_knee=90.0 + i)
                                for i in range(6)])
        loose = build_baseline([history(track_id=i, left_knee=90.0 + i * 7)
                                for i in range(6)])
        student = history(track_id=99, left_knee=112.0)
        assert assess_against_class(student, tight)
        assert not assess_against_class(student, loose)

    def test_nothing_is_said_when_the_class_is_too_small(self):
        baseline = build_baseline([history(track_id=i, left_knee=90.0)
                                   for i in range(2)])
        odd = history(track_id=99, left_knee=160.0)
        assert assess_against_class(odd, baseline) == []

    def test_nothing_is_said_about_a_joint_the_class_disagreed_on(self):
        baseline = build_baseline([history(track_id=i, left_knee=20.0 + i * 40)
                                   for i in range(6)])
        odd = history(track_id=99, left_knee=175.0)
        assert assess_against_class(odd, baseline) == []

    def test_a_student_not_visible_enough_is_skipped_rather_than_judged(self):
        baseline = build_baseline(self._cohort())
        thin = history(track_id=99, n=2, left_knee=160.0)
        assert assess_against_class(thin, baseline) == []


class TestUnnamedAssessment:
    def _built(self, **kwargs):
        cohort = [history(track_id=i, left_knee=90.0 + i) for i in range(6)]
        baseline = build_baseline(cohort)
        return assess_unnamed(
            history(track_id=99, left_knee=160.0),
            summary(**kwargs), "A repeated movement, lying", baseline)

    def test_it_leads_with_what_was_measured_not_a_name(self):
        assert self._built().summarise().startswith("A repeated movement, lying")

    def test_it_carries_both_kinds_of_finding(self):
        result = self._built(control_ratio=2.4)
        assert any(f.subject == "control" for f in result.quality)
        assert any(f.subject == "left_knee" for f in result.versus_class)

    def test_the_biggest_problem_comes_first(self):
        result = self._built(control_ratio=2.4)
        assert result.improve[0].deviation >= result.improve[-1].deviation

    def test_it_says_so_when_nothing_stood_out(self):
        cohort = [history(track_id=i, left_knee=90.0 + i) for i in range(6)]
        result = assess_unnamed(cohort[2], summary(control_ratio=None),
                                "A repeated movement", build_baseline(cohort))
        assert "nothing measurable stood out" in result.summarise()

    def test_it_works_with_no_class_at_all(self):
        """One student in a private lesson still gets the quality findings."""
        result = assess_unnamed(history(left_knee=90.0), summary(control_ratio=2.4),
                                "A repeated movement")
        assert result.versus_class == []
        assert any(f.subject == "control" for f in result.quality)

    def test_the_baseline_note_travels_with_the_assessment(self):
        assert "Class baseline from" in self._built().summarise()

    def test_it_never_names_an_exercise(self):
        text = self._built().summarise()
        assert "exercise" not in text.lower() or "the exercise" not in text.lower()


class TestTravelAgainstTheClass:
    """Position and travel are different questions. A student swinging twice as
    far as everyone else has the same median angle as them, so comparing
    middles alone cannot see it — and travel is what most differs in a room."""

    def _moving(self, track_id, amplitude, centre=120.0, n=60, cycles=3):
        """A whole number of cycles, so the median really is the centre and the
        two students genuinely differ only in how far they travelled."""
        import math

        out = TrackHistory(track_id=track_id)
        for i in range(n):
            out.add(i / 10.0, make_detection(), 0.4)
            out.samples[-1].angles["left_knee"] = \
                centre + amplitude * math.sin(2 * math.pi * cycles * i / n)
        return out

    def _cohort(self, n=6, amplitude=20.0):
        return [self._moving(i, amplitude + i) for i in range(n)]

    def test_the_class_travel_is_recorded(self):
        baseline = build_baseline(self._cohort())
        assert baseline.travel["left_knee"] > 0

    def test_a_student_moving_much_further_is_flagged(self):
        cohort = self._cohort()
        baseline = build_baseline(cohort)
        wide = self._moving(99, 70.0)
        assert [f for f in assess_against_class(wide, baseline)
                if f.subject == "left_knee_range"]

    def test_a_student_barely_moving_is_flagged_too(self):
        cohort = self._cohort()
        baseline = build_baseline(cohort)
        small = self._moving(99, 2.0)
        findings = [f for f in assess_against_class(small, baseline)
                    if f.subject == "left_knee_range"]
        assert findings and "less far" in findings[0].message

    def test_a_student_in_the_middle_is_not(self):
        cohort = self._cohort()
        baseline = build_baseline(cohort)
        assert not [f for f in assess_against_class(cohort[2], baseline)
                    if f.subject == "left_knee_range"]

    def test_the_median_angle_is_identical_which_is_the_whole_point(self):
        """Both students sit at the same centre. Only travel separates them."""
        narrow, wide = self._moving(1, 5.0), self._moving(2, 70.0)
        baseline = build_baseline(self._cohort())
        assert abs(statistics.median([s.angles["left_knee"] for s in narrow.samples])
                   - statistics.median([s.angles["left_knee"] for s in wide.samples])) < 5.0
        assert [f for f in assess_against_class(wide, baseline)
                if f.subject == "left_knee_range"]

    def test_a_class_that_did_not_agree_on_travel_judges_nobody(self):
        cohort = [self._moving(i, 5.0 + i * 25) for i in range(6)]
        baseline = build_baseline(cohort)
        assert not baseline.agreed_on_travel("left_knee")
        assert not [f for f in assess_against_class(self._moving(99, 90.0), baseline)
                    if f.subject == "left_knee_range"]

    def test_travel_ignores_the_extreme_frames(self):
        """One badly-estimated frame at each end would otherwise set it."""
        from pilates.universal import _travel

        clean = [100.0] * 20 + [140.0] * 20
        spiked = [5.0] + clean + [179.0]
        assert abs(_travel(clean) - _travel(spiked)) < 10.0
