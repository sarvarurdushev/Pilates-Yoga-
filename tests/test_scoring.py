"""Turning a page of measurements into a number out of a hundred.

A score is what a student asks for and the easiest thing here to fake. Two
rules: it is only ever the average of checks really made, and it never travels
without its coverage.
"""
import pytest

from pilates.coaching import Assessment, Finding
from pilates.scoring import (MEASURABLE, MIN_CHECKS, MIN_COVERAGE, ZERO_AT,
                             Component, Score, score_assessment, score_quality,
                             score_session)


def finding(subject, deviation=0.0, kind="improve", source="standard"):
    return Finding(kind=kind, subject=subject, message="x", measured=10.0,
                   target="y", deviation=deviation)


def full_coverage():
    return set(MEASURABLE)


class TestOneCheck:
    def test_meeting_a_target_scores_full_marks(self):
        from pilates.scoring import _from_deviation

        assert _from_deviation(0.0) == 100.0

    def test_a_significant_deviation_scores_half(self):
        """The coaching layer's "significant" and this scale agree by
        construction rather than by coincidence."""
        from pilates.coaching import SIGNIFICANT_DEGREES
        from pilates.scoring import _from_deviation

        assert _from_deviation(SIGNIFICANT_DEGREES) == pytest.approx(50.0)

    def test_a_large_deviation_bottoms_out_rather_than_going_negative(self):
        from pilates.scoring import _from_deviation

        assert _from_deviation(ZERO_AT * 3) == 0.0

    def test_the_scale_is_linear_so_a_student_can_be_told_why(self):
        from pilates.scoring import _from_deviation

        a, b, c = (_from_deviation(d) for d in (0.0, 10.0, 20.0))
        assert (a - b) == pytest.approx(b - c)


class TestScoringAnAssessment:
    def _assessment(self, findings):
        return Assessment(exercise="bridge", findings=findings, samples=200,
                          confidence=0.9)

    def test_perfect_form_scores_a_hundred(self):
        assessment = self._assessment([finding(j, 0.0, kind="good")
                                       for j in list(MEASURABLE)[:6]])
        assert score_assessment(assessment, full_coverage()).value == 100.0

    def test_deviations_pull_it_down(self):
        assessment = self._assessment([finding(j, 15.0)
                                       for j in list(MEASURABLE)[:6]])
        assert score_assessment(assessment, full_coverage()).value == pytest.approx(50.0)

    def test_symmetry_is_its_own_component(self):
        assessment = self._assessment(
            [finding("left_knee", 0.0, kind="good"),
             finding("knee symmetry", 20.0)] +
            [finding(j, 0.0, kind="good") for j in list(MEASURABLE)[:4]])
        result = score_assessment(assessment, full_coverage())
        assert "symmetry" in result.components and "form" in result.components

    def test_an_unmeasured_joint_is_not_scored_at_all(self):
        """It does not score zero and does not score a hundred."""
        assessment = self._assessment(
            [finding(j, 0.0, kind="good") for j in list(MEASURABLE)[:6]]
            + [Finding(kind="not_measured", subject="neck", message="x")])
        assert score_assessment(assessment, full_coverage()).value == 100.0

    def test_the_weakest_check_is_named(self):
        assessment = self._assessment(
            [finding("left_knee", 25.0)]
            + [finding(j, 0.0, kind="good") for j in list(MEASURABLE)[:5]])
        component = score_assessment(assessment, full_coverage()).components["form"]
        assert component.weakest[0] == "left_knee"
        assert "weakest left knee" in component.describe()


class TestCoverage:
    """"82 out of 100" from four checks on a partly-visible body is a different
    statement from the same number out of twenty on a clear one."""

    def test_too_few_checks_withholds_the_number(self):
        assessment = Assessment(exercise="x", findings=[finding("left_knee", 0.0)])
        result = score_assessment(assessment, full_coverage())
        assert result.value is None
        assert "swings on any one" in result.withheld_reason

    def test_too_little_of_the_body_withholds_it_too(self):
        seen = set(list(MEASURABLE)[:2])
        assessment = Assessment(
            exercise="x",
            findings=[finding(j, 0.0, kind="good") for j in list(MEASURABLE)[:6]])
        result = score_assessment(assessment, seen)
        assert result.value is None
        assert "in frame" in result.withheld_reason

    def test_the_reason_names_the_numbers(self):
        assessment = Assessment(
            exercise="x",
            findings=[finding(j, 0.0, kind="good") for j in list(MEASURABLE)[:6]])
        reason = score_assessment(assessment, set(list(MEASURABLE)[:2])).withheld_reason
        assert "2 of" in reason

    def test_coverage_is_out_of_a_fixed_total_not_what_happened_to_be_seen(self):
        result = score_assessment(
            Assessment(exercise="x", findings=[finding("left_knee", 0.0)]),
            {"left_knee"})
        assert result.measurable == len(MEASURABLE)
        assert result.coverage < 0.2

    def test_what_was_not_visible_is_listed(self):
        result = score_assessment(
            Assessment(exercise="x", findings=[finding("left_knee", 0.0)]),
            {"left_knee"})
        assert "neck" in result.missing

    def test_the_description_carries_the_coverage(self):
        assessment = Assessment(
            exercise="x",
            findings=[finding(j, 0.0, kind="good") for j in MEASURABLE])
        text = score_assessment(assessment, full_coverage()).describe()
        assert "out of 100" in text and "measurable quantities" in text

    def test_the_thresholds_are_explicit(self):
        assert MIN_CHECKS >= 5 and 0.0 < MIN_COVERAGE < 1.0


class TestQualityChecks:
    """These need no standard, so they score the same way whether or not the
    exercise was recognised."""

    def test_a_clean_movement_scores_full_marks(self):
        components = score_quality([finding("control", kind="good")])
        assert components["control"].score == 100.0

    def test_a_fault_costs_in_proportion(self):
        components = score_quality([finding("control", deviation=ZERO_AT / 2)])
        assert components["control"].score == pytest.approx(50.0)

    def test_only_named_qualities_are_scored(self):
        assert score_quality([finding("left_knee", 5.0)]) == {}

    def test_each_quality_is_its_own_component(self):
        components = score_quality([finding("control"), finding("tempo"),
                                    finding("consistency")])
        assert set(components) == {"control", "tempo", "consistency"}


class TestWholeSession:
    def test_the_three_sources_stay_separate(self):
        """A library target, a comparison against the room, and a check that
        needs neither are different kinds of claim."""
        result = score_session(
            assessment=Assessment(exercise="x", findings=[finding("left_knee")]),
            quality=[finding("control", kind="good")],
            versus_class=[finding("left_hip", 10.0)],
            measured_subjects=full_coverage())
        assert {"form", "control", "against the class"} <= set(result.components)

    def test_components_are_weighted_by_how_many_checks_they_hold(self):
        """Otherwise one tempo check counts as much as eight joint angles."""
        result = score_session(
            assessment=Assessment(exercise="x", findings=[
                finding(j, 0.0, kind="good") for j in list(MEASURABLE)[:8]]),
            quality=[finding("tempo", deviation=ZERO_AT)],
            measured_subjects=full_coverage())
        assert result.value > 80.0

    def test_a_session_with_nothing_scoreable_withholds(self):
        assert score_session(measured_subjects=full_coverage()).value is None

    def test_coverage_comes_from_what_was_measured_not_what_was_scored(self):
        result = score_session(
            quality=[finding("control", kind="good")],
            measured_subjects={"left_knee", "right_knee"})
        assert result.coverage < 0.3

    def test_the_description_orders_the_weakest_component_first(self):
        result = score_session(
            assessment=Assessment(exercise="x", findings=[
                finding(j, 0.0, kind="good") for j in list(MEASURABLE)[:6]]),
            quality=[finding("control", deviation=ZERO_AT)],
            measured_subjects=full_coverage())
        lines = result.describe().split("\n")
        assert "control" in lines[1]


class TestFromTheStore:
    """Scores are derived rather than stored, so a change to how one is
    computed applies to every session ever recorded."""

    def test_a_score_is_rebuilt_from_archived_findings(self):
        from pilates.identity import Link
        from pilates.scoring import score_from_store
        from pilates.store import SessionMeta, Store

        with Store.memory() as store:
            store.enrol("anna")
            store.record_session(SessionMeta(key="s1", date="2026-01-01"))
            for subject in list(MEASURABLE)[:6]:
                store.add_finding("s1", 4, "good", "x", subject=subject,
                                  source="standard")
                store.add_measurement("s1", 4, subject, 100.0)
            for subject in MEASURABLE[6:]:
                store.add_measurement("s1", 4, subject, 100.0)
            store.put_link(Link(session="s1", track_id=4,
                                username="anna").confirm("t"))
            result = score_from_store(store, "anna", "s1")
        assert result.value == 100.0

    def test_it_separates_the_sources_it_finds(self):
        from pilates.identity import Link
        from pilates.scoring import score_from_store
        from pilates.store import SessionMeta, Store

        with Store.memory() as store:
            store.enrol("anna")
            store.record_session(SessionMeta(key="s1", date="2026-01-01"))
            store.add_finding("s1", 4, "good", "x", subject="control",
                              source="quality")
            store.add_finding("s1", 4, "improve", "x", subject="left_hip",
                              deviation=10.0, source="class")
            for subject in MEASURABLE:
                store.add_measurement("s1", 4, subject, 100.0)
            store.put_link(Link(session="s1", track_id=4,
                                username="anna").confirm("t"))
            result = score_from_store(store, "anna", "s1")
        assert "control" in result.components
        assert "against the class" in result.components
