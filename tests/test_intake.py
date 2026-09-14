"""The four-photograph pre-session assessment.

Most of what matters here is not arithmetic -- the alignment layer's tests
cover that -- but the merge: that two photographs of the same quantity are
treated as two measurements rather than as one measurement and a spare, that
the two agreeing is recorded as agreeing and the two disagreeing is recorded as
disagreeing, and that a set uploaded out of order is noticed rather than
measured cleanly into a mirrored report.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))

from pilates import alignment as al  # noqa: E402
from pilates import intake as ik  # noqa: E402
from pilates.alignment import View  # noqa: E402
from test_alignment import side_on, standing  # noqa: E402

FRAME = (1080, 1440)


def photo(view: View, det, **kw) -> ik.Photo:
    return ik.Photo(view, det, FRAME[0], FRAME[1], **kw)


def four(**kw) -> list[ik.Photo]:
    """A complete set of the same body, photographed from all four sides."""
    tilt = kw.pop("shoulder_tilt", 0.0)
    hip = kw.pop("hip_tilt", 0.0)
    ahead = kw.pop("ear_ahead", 0.0)
    return [
        photo(View.FRONT, standing(shoulder_tilt=tilt, hip_tilt=hip, cx=540)),
        photo(View.SIDE_LEFT, side_on(facing_image_left=False,
                                      ear_ahead=ahead, cx=540)),
        photo(View.SIDE_RIGHT, side_on(facing_image_left=True,
                                       ear_ahead=ahead, cx=540)),
        photo(View.REAR, standing(facing="rear", shoulder_tilt=tilt,
                                  hip_tilt=hip, cx=540)),
    ]


class TestTheProtocol:
    def test_four_photographs_are_the_protocol(self):
        assert ik.PROTOCOL == (View.FRONT, View.SIDE_LEFT, View.SIDE_RIGHT,
                               View.REAR)

    def test_every_photograph_has_an_instruction_in_both_languages(self):
        for view in ik.PROTOCOL:
            for lang in ("en", "ko"):
                title, how = ik.instructions(view, lang)
                assert title and len(how) > 20

    def test_the_two_languages_name_four_different_photographs(self):
        """A table that repeats a name makes two slots indistinguishable."""
        for lang in ("en", "ko"):
            titles = {ik.instructions(v, lang)[0] for v in ik.PROTOCOL}
            assert len(titles) == 4

    def test_every_metric_is_owned_by_at_least_one_photograph(self):
        for names in al.VIEW_METRICS.values():
            for name in names:
                assert ik.MEASURED_BY[name]

    def test_a_complete_set_reports_itself_complete(self):
        assert ik.assess_photos(four()).complete

    def test_a_missing_photograph_is_named_and_costed(self):
        held = ik.assess_photos(four()[:2])
        assert View.REAR in held.missing_photos
        assert any("no back photograph" in w for w in held.warnings)


class TestTheMerge:
    def test_two_photographs_of_one_quantity_are_averaged(self):
        """Front and back both see the shoulder line; neither is discarded."""
        out = ik.assess_photos(four(shoulder_tilt=8.0))
        reading = out.readings["shoulder_tilt"]
        assert set(reading.sources) == {View.FRONT, View.REAR}
        assert len(reading.values) == 2

    def test_agreement_is_recorded_as_agreement(self):
        out = ik.assess_photos(four(shoulder_tilt=8.0))
        assert out.readings["shoulder_tilt"].corroborated
        assert not out.readings["shoulder_tilt"].contested

    def test_disagreement_is_recorded_rather_than_averaged_away(self):
        """The student moved between the two shots. That has to be visible."""
        out = ik.assess_photos([
            photo(View.FRONT, standing(shoulder_tilt=2.0, cx=540)),
            photo(View.REAR, standing(facing="rear", shoulder_tilt=14.0,
                                      cx=540)),
        ])
        reading = out.readings["shoulder_tilt"]
        assert reading.contested and not reading.corroborated
        assert reading.spread > ik.TOLERANCE["deg"]

    def test_a_contested_reading_loses_confidence_in_proportion(self):
        steady = ik.assess_photos(four(shoulder_tilt=8.0))
        moved = ik.assess_photos([
            photo(View.FRONT, standing(shoulder_tilt=2.0, cx=540)),
            photo(View.REAR, standing(facing="rear", shoulder_tilt=14.0,
                                      cx=540)),
        ])
        assert (moved.readings["shoulder_tilt"].metric.confidence
                < steady.readings["shoulder_tilt"].metric.confidence)

    def test_one_photograph_carries_no_spread_which_is_not_no_disagreement(self):
        out = ik.assess_photos([photo(View.FRONT, standing(shoulder_tilt=8.0,
                                                           cx=540))])
        reading = out.readings["shoulder_tilt"]
        assert reading.spread is None
        assert not reading.corroborated and not reading.contested

    def test_the_front_and_the_back_agree_about_which_shoulder_is_high(self):
        """The one sign error that would mirror every report."""
        out = ik.assess_photos(four(shoulder_tilt=8.0))
        values = list(out.readings["shoulder_tilt"].values.values())
        assert all(v > 0 for v in values), values

    def test_the_two_sides_agree_about_which_way_the_head_sits(self):
        out = ik.assess_photos(four(ear_ahead=40.0))
        values = list(out.readings["forward_head"].values.values())
        assert len(values) == 2 and all(v > 0 for v in values), values

    def test_an_estimate_merged_with_a_measurement_stays_an_estimate(self):
        out = ik.assess_photos(four())
        assert (out.readings["lateral_weight_bias"].metric.availability
                is al.Availability.ESTIMATED)

    def test_evidence_names_the_photographs_it_came_from(self):
        out = ik.assess_photos(four(shoulder_tilt=8.0))
        text = out.readings["shoulder_tilt"].evidence()
        assert "front" in text and "back" in text

    def test_evidence_is_written_in_korean_when_asked(self):
        out = ik.assess_photos(four(shoulder_tilt=8.0))
        text = out.readings["shoulder_tilt"].evidence("ko")
        assert "정면" in text and "후면" in text


class TestWhatIsStillRefused:
    def test_sagittal_pelvic_tilt_is_refused_however_many_photographs(self):
        """The measurement every posture product is asked for."""
        out = ik.assess_photos(four())
        reading = out.readings["sagittal_pelvic_tilt"]
        assert not reading.measured
        assert "ASIS" in reading.metric.reason

    def test_a_refusal_carries_the_reason_from_a_view_that_could_have_seen_it(self):
        """Not 'edge-on from the side' when a front photograph was supplied."""
        det = standing(cx=540)
        scores = det.scores.copy()
        scores[al.kp.L_EAR] = 0.05
        blind = al.Detection(det.keypoints, scores)
        out = ik.assess_photos([photo(View.FRONT, blind),
                                photo(View.SIDE_LEFT, side_on(cx=540))])
        assert "ears" in out.readings["head_lateral_tilt"].metric.reason

    def test_coverage_counts_only_what_the_supplied_photographs_could_show(self):
        """A front-only set is not charged for forward head."""
        out = ik.assess_photos([photo(View.FRONT, standing(cx=540))])
        assert "forward_head" not in out.expected
        assert set(out.expected) == set(al.VIEW_METRICS[View.FRONT])

    def test_a_full_set_expects_the_union_of_both_planes(self):
        out = ik.assess_photos(four())
        assert "forward_head" in out.expected
        assert "shoulder_tilt" in out.expected


class TestAPhotographThatCannotBeUsed:
    def test_an_unmeasurable_photograph_does_not_fail_the_others(self):
        photos = four()
        photos[1] = ik.Photo(View.SIDE_LEFT, None, 0, 0,
                             problem="no person was found")
        out = ik.assess_photos(photos)
        assert View.SIDE_LEFT not in out.supplied
        assert out.readings["shoulder_tilt"].measured

    def test_the_reason_a_photograph_was_refused_reaches_the_warnings(self):
        out = ik.assess_photos([ik.Photo(View.FRONT, None, 0, 0,
                                         problem="no person was found")])
        assert any("no person was found" in w for w in out.warnings)

    def test_a_note_travels_without_refusing_the_photograph(self):
        photos = four()
        photos[0] = photo(View.FRONT, standing(cx=540), note="3 people found")
        out = ik.assess_photos(photos)
        assert out.photos[View.FRONT].usable
        assert any("3 people found" in w for w in out.warnings)


class TestTheSetInTheWrongOrder:
    def test_a_back_photograph_labelled_front_is_noticed(self):
        """Otherwise every left and right in the report is reversed, and every
        number is plausible."""
        out = ik.assess_photos([photo(View.FRONT, standing(facing="rear",
                                                           cx=540))])
        assert any("looks like a rear view" in w for w in out.warnings)

    def test_a_side_photograph_labelled_front_says_so_differently(self):
        out = ik.assess_photos([photo(View.FRONT, side_on(cx=540))])
        assert any("square to the camera" in w for w in out.warnings)

    def test_a_correctly_labelled_set_raises_nothing(self):
        assert ik.assess_photos(four()).warnings == []

    def test_the_label_is_used_for_the_measurement_not_the_estimate(self):
        """A studio knows where its camera is; an estimator is guessing from
        the same landmarks being measured."""
        out = ik.assess_photos([photo(View.REAR, standing(facing="rear",
                                                          cx=540))])
        assert out.per_view[View.REAR].view.view is View.REAR
        assert out.per_view[View.REAR].view.confidence == 1.0


class TestTheScore:
    def test_a_level_body_scores_high(self):
        score = ik.assess_photos(four()).score()
        assert score.value is not None and score.value > 90

    def test_a_crooked_body_scores_lower_than_a_level_one(self):
        level = ik.assess_photos(four()).score().value
        crooked = ik.assess_photos(four(shoulder_tilt=14.0,
                                        hip_tilt=10.0)).score().value
        assert crooked < level

    def test_one_photograph_withholds_the_headline(self):
        """Too few checks to put a number on."""
        out = ik.assess_photos([photo(View.SIDE_LEFT, side_on(cx=540))])
        assert out.score().value is None
        assert out.score().withheld_reason

    def test_the_payload_carries_the_refusals_as_well_as_the_numbers(self):
        out = ik.assess_photos(four()).to_dict()
        for key in ("overall_score", "readings", "refused", "warnings",
                    "supplied", "missing_photos", "coverage"):
            assert key in out
        assert "sagittal_pelvic_tilt" in out["refused"]


class TestComparingTwoVisits:
    def test_the_same_metric_across_two_visits_is_compared(self):
        before = ik.assess_photos(four(shoulder_tilt=12.0))
        after = ik.assess_photos(four(shoulder_tilt=4.0))
        change = ik.compare(before, after).changes["shoulder_tilt"]
        assert change.comparable and change.toward_neutral

    def test_a_metric_missing_from_one_visit_is_not_a_result(self):
        before = ik.assess_photos(four(ear_ahead=40.0))
        after = ik.assess_photos([photo(View.FRONT, standing(cx=540))])
        change = ik.compare(before, after).changes["forward_head"]
        assert not change.comparable
        assert "not measured" in change.reason

    def test_two_visits_photographed_to_different_protocols_still_compare(self):
        """What one visit did not measure is refused metric by metric, which is
        a better refusal than throwing the whole comparison away."""
        before = ik.assess_photos(four(shoulder_tilt=12.0))
        after = ik.assess_photos([photo(View.FRONT,
                                        standing(shoulder_tilt=4.0, cx=540))])
        comparison = ik.compare(before, after)
        assert comparison.changes["shoulder_tilt"].comparable
        assert not comparison.changes["forward_head"].comparable


@pytest.mark.parametrize("view", list(ik.PROTOCOL))
def test_a_missing_photograph_says_what_it_would_have_measured(view):
    cost = ik._lost(view)
    assert cost and cost[0].islower()


class TestNothingMeasuredIsNotAllClear:
    """The failure the studio saw: four photographs refused, and a report that
    said every measurement sat inside its usual range. Nothing had been
    measured. That is the same lie as a score over an unusable photograph, one
    sentence further down the page."""

    def test_a_set_where_no_photograph_could_be_used_says_so(self):
        from pilates import guidance as gd

        dead = [ik.Photo(v, None, 0, 0, problem="too small")
                for v in ik.PROTOCOL]
        report = gd.report(ik.assess_photos(dead))
        assert report["findings"] == []
        assert "nothing was measured" in report["findings_note"]
        assert report["findings_note_ko"]

    def test_a_body_genuinely_inside_every_band_still_says_all_clear(self):
        from pilates import guidance as gd

        report = gd.report(ik.assess_photos(four()))
        assert report["findings"] == []
        assert report["findings_note"] == "", "nothing is being held back"


class TestTheSizeOfTheBody:
    """A fraction of the frame is not the same question as a number of pixels,
    and the report needs both answered."""

    def test_a_body_too_few_pixels_across_is_flagged_in_absolute_terms(self):
        """A body filling a thumbnail passes every fractional test and is
        still a thumbnail's worth of body."""
        det = standing(cx=40)
        tiny = al.Detection(det.keypoints * 0.18, det.scores)
        out = ik.assess_photos([ik.Photo(View.FRONT, tiny, 30, 100)])
        assert any("inside the landmark noise" in w for w in out.doubts)

    def test_a_body_of_a_workable_size_is_not_flagged(self):
        out = ik.assess_photos([photo(View.FRONT, standing(cx=540))])
        assert not any("landmark noise" in w for w in out.doubts)


class TestTheLimbCheckAndTheCameraAngle:
    def test_two_legs_of_different_lengths_are_flagged_from_the_front(self):
        det = standing(cx=540)
        points = det.keypoints.copy()
        points[al.kp.R_KNEE] = (points[al.kp.R_KNEE][0], 450)
        out = ik.assess_photos([photo(View.FRONT,
                                      al.Detection(points, det.scores))])
        assert any("differ in length" in w for w in out.doubts)

    def test_they_are_not_flagged_from_the_side(self):
        """Side-on, one leg is behind the other by construction: the far one
        is occluded and placed by a model that is guessing at it. Flagging
        that would withhold the score on both side photographs of every set a
        studio ever takes."""
        det = side_on(facing_image_left=False, cx=540)
        points = det.keypoints.copy()
        points[al.kp.L_KNEE] = (points[al.kp.L_KNEE][0], 470)
        out = ik.assess_photos([ik.Photo(View.SIDE_LEFT,
                                         al.Detection(points, det.scores),
                                         FRAME[0], FRAME[1])])
        assert not any("differ in length" in w for w in out.doubts)
