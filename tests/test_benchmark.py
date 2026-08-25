import pytest

from pilates.benchmark import (
    MAX_NEIGHBOUR_OVERLAP, MIN_PERSON_PX, ScaleResult, crowding,
    format_table, minimum_person_height, required_sensor_height,
)


def result(**kw) -> ScaleResult:
    base = dict(
        scale=1.0, width=1920, height=1080, frames=100, median_person_px=150.0,
        mean_people=3.0, distinct_ids=3, fragmentation=1.0, churn=1.0,
        median_track_life=95.0, mean_confidence=0.79, mean_visible_joints=14.0,
    )
    base.update(kw)
    return ScaleResult(**base)


class TestIdentityVerdict:
    def test_clean_tracking_holds(self):
        assert result(churn=1.02).identity_holds

    def test_heavy_churn_breaks(self):
        assert not result(churn=3.35).identity_holds

    def test_boundary_is_inclusive(self):
        assert result(churn=1.5).identity_holds
        assert not result(churn=1.51).identity_holds

    def test_good_fragmentation_cannot_rescue_bad_churn(self):
        """The metric flaw this replaced: a run that finds a fraction of the
        room and loses all of them scores well on fragmentation alone."""
        poor = result(fragmentation=1.03, churn=3.56)
        assert not poor.identity_holds


class TestRecall:
    def test_recall_is_relative_to_expected(self):
        assert result(_recall=0.96).detection_recall == pytest.approx(0.96)


class TestMinimumHeight:
    def test_picks_the_smallest_holding_scale(self):
        results = [
            result(median_person_px=150, churn=1.0),
            result(median_person_px=40, churn=1.1),
            result(median_person_px=18, churn=2.9),
        ]
        assert minimum_person_height(results) == 40

    def test_none_when_nothing_held(self):
        assert minimum_person_height([result(median_person_px=18, churn=4.0)]) is None

    def test_ignores_scales_that_found_nobody(self):
        results = [result(median_person_px=0.0, churn=0.0), result(median_person_px=60, churn=1.0)]
        assert minimum_person_height(results) == 60


class TestCrowding:
    def test_none_for_fewer_than_two_people(self):
        assert crowding([(0, 0, 50, 150)]) is None

    def test_well_separated_students_do_not_overlap(self):
        boxes = [(0, 0, 50, 150), (400, 0, 450, 150)]
        separation, overlap = crowding(boxes)
        assert overlap == 0.0
        assert separation > 1.0

    def test_stacked_students_overlap_heavily(self):
        boxes = [(0, 0, 100, 150), (20, 0, 120, 150)]
        separation, overlap = crowding(boxes)
        assert overlap > 0.5
        assert separation < 0.5

    def test_overlap_is_symmetric_for_equal_boxes(self):
        _, overlap = crowding([(0, 0, 100, 100), (50, 0, 150, 100)])
        assert overlap == pytest.approx(0.5)


class TestSensorSpec:
    def test_quarter_frame_student_needs_four_times_the_rows(self):
        assert required_sensor_height(100, 0.25) == 400

    def test_full_frame_student_needs_exactly_the_rows(self):
        assert required_sensor_height(120, 1.0) == 120

    def test_rejects_impossible_fractions(self):
        with pytest.raises(ValueError):
            required_sensor_height(100, 0.0)
        with pytest.raises(ValueError):
            required_sensor_height(100, 1.5)

    def test_published_limits_are_sane(self):
        assert 0 < MIN_PERSON_PX < 200
        assert 0.0 < MAX_NEIGHBOUR_OVERLAP < 1.0


class TestTable:
    def test_renders_a_row_per_scale(self):
        text = format_table([result(scale=1.0), result(scale=0.5, churn=3.0)])
        assert "HOLDS" in text and "breaks" in text
        assert len(text.splitlines()) == 4  # header, rule, two rows
