"""Standing-alignment measurement, and the refusals that keep it honest.

The measurements themselves are simple trigonometry, so most of what is worth
testing is the *other* half of the module: that a metric the camera cannot see
returns a documented refusal rather than a number, that the front/rear sign
convention survives a body turning round, and that a comparison between two
visits refuses to manufacture progress.

**The sign convention, once, because every fixture depends on it.** A COCO
model labels keypoints anatomically. Someone facing the camera has their
anatomical left on the *viewer's right*, so ``L_SHOULDER.x > R_SHOULDER.x``.
Turned away, the two swap. That single fact is what :func:`estimate_view` reads
to tell front from rear, and getting it backwards in a fixture produces tests
that pass against a module that is wrong.
"""
from __future__ import annotations

import numpy as np
import pytest

from pilates import alignment as al
from pilates import keypoints as kp
from pilates.types import Detection


def standing(*, facing: str = "front", shoulder_tilt: float = 0.0,
             hip_tilt: float = 0.0, lean: float = 0.0, cx: float = 300.0,
             knee_in: float = 0.0) -> Detection:
    """A synthetic upright body, built to the convention in the module docstring.

    ``shoulder_tilt`` and ``hip_tilt`` raise the person's *left* side in pixels;
    ``lean`` shifts the shoulders toward image right; ``knee_in`` pulls both
    knees toward the midline.
    """
    k = np.zeros((kp.NUM_KEYPOINTS, 2), np.float32)
    s = np.ones(kp.NUM_KEYPOINTS, np.float32)
    # facing the camera, anatomical left is drawn to the right of centre
    left = 1.0 if facing == "front" else -1.0
    k[kp.L_SHOULDER] = (cx + left * 40 + lean, 200 - shoulder_tilt)
    k[kp.R_SHOULDER] = (cx - left * 40 + lean, 200 + shoulder_tilt)
    k[kp.L_HIP] = (cx + left * 25, 400 - hip_tilt)
    k[kp.R_HIP] = (cx - left * 25, 400 + hip_tilt)
    k[kp.L_KNEE] = (cx + left * (25 - knee_in), 520)
    k[kp.R_KNEE] = (cx - left * (25 - knee_in), 520)
    k[kp.L_ANKLE] = (cx + left * 25, 640)
    k[kp.R_ANKLE] = (cx - left * 25, 640)
    k[kp.L_ELBOW] = (cx + left * 58, 300)
    k[kp.R_ELBOW] = (cx - left * 58, 300)
    k[kp.L_WRIST] = (cx + left * 64, 390)
    k[kp.R_WRIST] = (cx - left * 64, 390)
    k[kp.L_EAR] = (cx + left * 12, 150)
    k[kp.R_EAR] = (cx - left * 12, 150)
    k[kp.L_EYE] = (cx + left * 7, 148)
    k[kp.R_EYE] = (cx - left * 7, 148)
    k[kp.NOSE] = (cx, 155)
    if facing == "rear":
        s[kp.NOSE] = 0.05          # the back of a head has no nose to find
    s[np.all(k == 0, axis=1)] = 0
    return Detection(k, s)


def side_on(*, facing_image_left: bool = True, ear_ahead: float = 0.0,
            cx: float = 300.0) -> Detection:
    """A body seen from one side, its shoulder span collapsed to nearly nothing."""
    k = np.zeros((kp.NUM_KEYPOINTS, 2), np.float32)
    s = np.ones(kp.NUM_KEYPOINTS, np.float32)
    d = -1.0 if facing_image_left else 1.0
    for joint, y in ((kp.L_SHOULDER, 200), (kp.R_SHOULDER, 200),
                     (kp.L_HIP, 400), (kp.R_HIP, 400),
                     (kp.L_KNEE, 520), (kp.R_KNEE, 520),
                     (kp.L_ANKLE, 640), (kp.R_ANKLE, 640)):
        k[joint] = (cx, y)
    k[kp.R_SHOULDER] = (cx + 3, 200)          # a few pixels of visible offset
    k[kp.R_HIP] = (cx + 3, 400)
    k[kp.NOSE] = (cx + d * 30, 155)
    # facing image-left shows the camera the person's right side
    near, far = (kp.R_EAR, kp.L_EAR) if facing_image_left else (kp.L_EAR, kp.R_EAR)
    k[near] = (cx + d * ear_ahead, 150)
    s[far] = 0.05
    s[np.all(k == 0, axis=1)] = 0
    return Detection(k, s)


class TestViewEstimation:
    def test_a_body_facing_the_camera_reads_as_front(self):
        assert al.estimate_view(standing(facing="front")).view is al.View.FRONT

    def test_the_same_body_turned_round_reads_as_rear(self):
        assert al.estimate_view(standing(facing="rear")).view is al.View.REAR

    @pytest.mark.parametrize("image_left,expected",
                             [(True, al.View.SIDE_RIGHT), (False, al.View.SIDE_LEFT)])
    def test_a_side_on_body_names_the_side_the_camera_can_see(self, image_left, expected):
        """Facing image-left presents the person's right side to the lens."""
        assert al.estimate_view(side_on(facing_image_left=image_left)).view is expected

    def test_a_body_turned_part_way_is_refused_rather_than_guessed(self):
        """Neither plane faces the lens, so neither set of metrics is honest."""
        det = standing(facing="front")
        pts = det.keypoints.copy()
        for joint in (kp.L_SHOULDER, kp.R_SHOULDER):        # squeeze toward side-on
            pts[joint][0] = 300.0 + (pts[joint][0] - 300.0) * 0.75
        estimate = al.estimate_view(Detection(pts, det.scores))
        assert estimate.view is al.View.THREE_QUARTER
        assert "turned part-way" in estimate.note

    def test_no_shoulders_means_no_view(self):
        det = standing()
        scores = det.scores.copy()
        scores[kp.L_SHOULDER] = 0.05
        estimate = al.estimate_view(Detection(det.keypoints, scores))
        assert estimate.view is al.View.UNKNOWN
        assert estimate.confidence == 0.0


class TestMetrics:
    def test_a_raised_left_shoulder_measures_positive_from_the_front(self):
        m = al.shoulder_tilt(standing(facing="front", shoulder_tilt=8.0), al.View.FRONT)
        assert m.measured and m.value > 0

    def test_the_same_body_from_behind_reports_the_same_side_raised(self):
        """The sign convention is about the person, not about the picture.

        Seen from the rear the person's left is drawn on the left of the frame,
        so the raw tilt flips. If the module did not flip it back, a student
        photographed from behind would be told the wrong shoulder is high.
        """
        front = al.shoulder_tilt(standing(facing="front", shoulder_tilt=8.0), al.View.FRONT)
        rear = al.shoulder_tilt(standing(facing="rear", shoulder_tilt=8.0), al.View.REAR)
        assert front.value == pytest.approx(rear.value, abs=0.01)

    def test_a_level_body_measures_level(self):
        for name in ("shoulder_tilt", "pelvic_obliquity", "head_lateral_tilt"):
            metric = al.assess(standing()).metrics[name]
            assert metric.measured
            assert metric.value == pytest.approx(0.0, abs=0.01)
            assert not metric.notable

    def test_zero_is_never_reported_as_negative_zero(self):
        """``-0.0`` in a report reads as a direction, and there is no direction."""
        for metric in al.assess(standing()).metrics.values():
            if metric.measured:
                assert not (metric.value == 0 and str(metric.value).startswith("-"))

    def test_forward_head_needs_a_side_view(self):
        front = al.assess(standing(facing="front")).metrics["forward_head"]
        assert not front.measured
        assert front.availability is al.Availability.UNAVAILABLE
        assert "depth" in front.reason

    def test_forward_head_is_measured_from_the_side(self):
        near = al.assess(side_on(facing_image_left=True, ear_ahead=40.0))
        metric = near.metrics["forward_head"]
        assert metric.measured and metric.value > 0

    def test_shoulder_level_needs_a_frontal_view(self):
        metric = al.assess(side_on()).metrics["shoulder_tilt"]
        assert not metric.measured
        assert "edge-on" in metric.reason

    def test_knee_deviation_is_positive_when_the_knees_fall_inward(self):
        metric = al.assess(standing(knee_in=12.0)).metrics["left_knee_deviation"]
        assert metric.measured and metric.value > 0

    def test_sagittal_pelvic_tilt_is_refused_with_its_reason(self):
        """The measurement everyone wants and a 17-point model cannot give."""
        metric = al.assess(side_on()).metrics["sagittal_pelvic_tilt"]
        assert not metric.measured
        assert "ASIS" in metric.reason

    def test_weight_bias_is_flagged_as_an_estimate(self):
        """A camera sees where the torso stands, not where the load goes."""
        metric = al.assess(standing()).metrics["lateral_weight_bias"]
        assert metric.availability is al.Availability.ESTIMATED
        assert metric.reason

    def test_a_missing_joint_removes_its_metric_and_not_the_others(self):
        det = standing()
        scores = det.scores.copy()
        scores[kp.L_EAR] = 0.05
        assessed = al.assess(Detection(det.keypoints, scores))
        assert not assessed.metrics["head_lateral_tilt"].measured
        assert assessed.metrics["shoulder_tilt"].measured


class TestReliability:
    def test_a_person_too_small_in_frame_is_warned_about(self):
        """At a twelfth of frame height a degree of tilt is under a pixel."""
        assessed = al.assess(standing(), frame_height=20_000)
        assert any("frame height" in w for w in assessed.warnings)
        assert not assessed.reliable

    def test_a_person_large_in_frame_carries_no_size_warning(self):
        assessed = al.assess(standing(), frame_height=720)
        assert not any("frame height" in w for w in assessed.warnings)
        assert assessed.reliable

    def test_low_confidence_joints_make_the_whole_assessment_unreliable(self):
        det = standing()
        assessed = al.assess(Detection(det.keypoints, det.scores * 0.2))
        assert not assessed.reliable

    def test_coverage_is_measured_against_what_the_view_could_show(self):
        """Charging a frontal assessment for forward-head would be charging it
        for a metric no frontal camera has ever been able to produce."""
        assessed = al.assess(standing(), frame_height=720)
        assert assessed.score().coverage == pytest.approx(1.0)
        assert "forward_head" not in assessed.expected


class TestScore:
    def test_a_well_aligned_body_scores_near_a_hundred(self):
        score = al.assess(standing(), frame_height=720).score()
        assert score.value is not None and score.value > 95

    def test_a_deviation_costs_the_region_it_belongs_to(self):
        score = al.assess(standing(shoulder_tilt=10.0), frame_height=720).score()
        assert score.components["shoulders"].score < score.components["pelvis"].score

    def test_the_worst_measurement_is_surfaced_for_attention(self):
        assessed = al.assess(standing(shoulder_tilt=12.0), frame_height=720)
        assert assessed.attention()
        assert assessed.attention()[0].name == "shoulder_tilt"

    def test_a_score_is_withheld_when_almost_nothing_was_visible(self):
        """The rule inherited from `scoring.Score`, checked here because this
        module chooses the denominator it is applied against."""
        det = side_on()
        scores = det.scores.copy()
        scores[kp.L_EAR] = scores[kp.R_EAR] = 0.05
        score = al.assess(Detection(det.keypoints, scores)).score()
        assert score.value is None
        assert score.withheld_reason


class TestOverTime:
    def test_repeated_frames_aggregate_to_a_median(self):
        frames = [al.assess(standing(shoulder_tilt=t), frame_height=720)
                  for t in (7.0, 8.0, 9.0, 8.0, 40.0, 8.0)]
        merged = al.aggregate(frames)
        assert merged is not None
        # the 40-pixel outlier must not drag the answer
        assert merged.metrics["shoulder_tilt"].value == pytest.approx(
            al.assess(standing(shoulder_tilt=8.0)).metrics["shoulder_tilt"].value, abs=0.6)

    def test_a_wandering_measurement_reports_lower_confidence(self):
        steady = al.aggregate([al.assess(standing(shoulder_tilt=8.0), frame_height=720)] * 8)
        noisy = al.aggregate([al.assess(standing(shoulder_tilt=t), frame_height=720)
                              for t in (2.0, 30.0, 4.0, 28.0, 6.0, 26.0, 8.0, 24.0)])
        assert steady is not None and noisy is not None
        assert (noisy.metrics["shoulder_tilt"].confidence
                < steady.metrics["shoulder_tilt"].confidence)

    def test_too_few_frames_aggregate_to_nothing(self):
        assert al.aggregate([al.assess(standing())] * 2) is None


class TestComparison:
    def test_a_metric_measured_twice_is_compared(self):
        before = al.assess(standing(shoulder_tilt=10.0), frame_height=720)
        after = al.assess(standing(shoulder_tilt=4.0), frame_height=720)
        change = al.compare(before, after).changes["shoulder_tilt"]
        assert change.comparable
        assert change.toward_neutral is True
        assert change.absolute < 0

    def test_a_metric_missing_from_one_visit_is_not_compared(self):
        """Absence is not improvement, and this is where that error would live."""
        before = al.assess(standing(), frame_height=720)
        det = standing()
        scores = det.scores.copy()
        scores[kp.L_EAR] = 0.05
        after = al.assess(Detection(det.keypoints, scores), frame_height=720)
        change = al.compare(before, after).changes["head_lateral_tilt"]
        assert not change.comparable
        assert change.absolute is None
        assert "not measured" in change.reason

    def test_two_different_views_are_never_compared(self):
        front = al.assess(standing(facing="front"), frame_height=720)
        rear = al.assess(standing(facing="rear"), frame_height=720)
        comparison = al.compare(front, rear)
        assert comparison.comparable_count == 0
        assert not comparison.to_dict()["same_view"]

    def test_a_percentage_is_withheld_when_the_baseline_was_near_zero(self):
        """0.1 degrees to 0.4 is not a 300% deterioration; it is noise."""
        before = al.assess(standing(shoulder_tilt=0.1), frame_height=720)
        after = al.assess(standing(shoulder_tilt=0.4), frame_height=720)
        assert al.compare(before, after).changes["shoulder_tilt"].percent is None


class TestMultiPerson:
    def test_each_person_is_assessed_separately(self):
        """Averaging alignment across a class describes nobody in it."""
        people = [standing(shoulder_tilt=0.0, cx=200.0),
                  standing(shoulder_tilt=12.0, cx=600.0),
                  standing(shoulder_tilt=-9.0, cx=1000.0)]
        assessed = al.assess_frame(people, frame_height=720)
        assert len(assessed) == 3
        tilts = [a.metrics["shoulder_tilt"].value for a in assessed]
        assert tilts[0] == pytest.approx(0.0, abs=0.01)
        assert tilts[1] > 5 and tilts[2] < -5
        assert len({a.person_id for a in assessed}) == 3

    def test_a_caller_may_override_the_estimated_view(self):
        """A studio that knows where its camera points beats any estimator."""
        assessed = al.assess(standing(facing="front"), view=al.View.REAR)
        assert assessed.view.view is al.View.REAR
        assert assessed.view.confidence == 1.0


class TestPayload:
    def test_the_api_shape_carries_confidence_and_warnings(self):
        payload = al.assess(standing(shoulder_tilt=9.0), frame_height=720,
                            person_id="track-3").to_dict()
        for key in ("person_id", "view", "overall_score", "metrics",
                    "confidence", "availability", "warnings", "attention"):
            assert key in payload
        assert payload["person_id"] == "track-3"
        assert payload["metrics"]["forward_head"] is None
        assert payload["availability"]["forward_head"] == "unavailable"
        assert payload["reasons"]["forward_head"]

    def test_every_unavailable_metric_states_why(self):
        payload = al.assess(side_on()).to_dict()
        for name, availability in payload["availability"].items():
            if availability == "unavailable":
                assert payload["reasons"].get(name), f"{name} refuses without a reason"


def built(rear: bool, shift: float = 0.0, knee_in: float = 0.0,
          cx: float = 300.0) -> Detection:
    """One physical body, photographed from in front or from behind.

    Built in the person's *own* coordinates rather than the picture's, which
    is what :func:`standing` does not do: there, ``lean`` shifts the shoulders
    toward image right in both fixtures, so the front and rear versions are
    not the same body and cannot be used to check a sign convention.

    Here world X is the person's left-positive axis. A front camera maps world
    X straight to image x -- their left lands on the viewer's right -- and a
    rear camera mirrors it. Landmark labels stay anatomical either way, which
    is the fact the whole front/rear corroboration design rests on.
    """
    k = np.zeros((kp.NUM_KEYPOINTS, 2), np.float32)
    s = np.ones(kp.NUM_KEYPOINTS, np.float32)
    mirror = -1.0 if rear else 1.0

    def put(joint: int, world_x: float, y: float) -> None:
        k[joint] = (cx + mirror * world_x, y)

    put(kp.L_EAR, 12 + shift, 150);      put(kp.R_EAR, -12 + shift, 150)
    put(kp.L_SHOULDER, 40 + shift, 200); put(kp.R_SHOULDER, -40 + shift, 200)
    put(kp.L_HIP, 25, 400);              put(kp.R_HIP, -25, 400)
    put(kp.L_KNEE, 25 - knee_in, 520);   put(kp.R_KNEE, -25 + knee_in, 520)
    put(kp.L_ANKLE, 25, 640);            put(kp.R_ANKLE, -25, 640)
    put(kp.NOSE, shift, 155)
    if rear:
        s[kp.NOSE] = 0.05
    s[np.all(k == 0, axis=1)] = 0
    return Detection(k, s)


#: Every measurement built on image x, and what a positive value means.
#:
#: These are the ones a camera moving to the other side of the person can
#: invert, and inverting one means naming the wrong side of somebody's body in
#: a report -- the single most harmful thing this system can get wrong, because
#: it is actionable and it looks right. ``lateral_weight_bias`` was inverted
#: from the day it was written and nothing caught it: no test compared the two
#: views, and the two existing conventions in the module disagreed with each
#: other, one flipping on FRONT and one on REAR.
SIDED = ("trunk_lean_lateral", "lateral_weight_bias", "lateral_head_shift",
         "lateral_shoulder_shift", "lateral_pelvis_shift",
         "left_knee_deviation", "right_knee_deviation")


class TestWhichSideIsWhich:
    @pytest.mark.parametrize("name", SIDED)
    def test_the_front_and_the_back_agree(self, name):
        """The same body from two cameras is the same body."""
        front = al.assess(built(False, shift=30.0, knee_in=8.0),
                          view=al.View.FRONT).metrics[name]
        rear = al.assess(built(True, shift=30.0, knee_in=8.0),
                         view=al.View.REAR).metrics[name]
        assert front.measured and rear.measured, name
        assert front.value == pytest.approx(rear.value, abs=1e-6), name

    @pytest.mark.parametrize("name", ["trunk_lean_lateral", "lateral_weight_bias",
                                      "lateral_head_shift", "lateral_shoulder_shift"])
    def test_a_body_shifted_left_reads_positive(self, name):
        """Positive is toward the person's own left, everywhere. A metric that
        disagrees names the wrong side in front of a student."""
        for rear in (False, True):
            view = al.View.REAR if rear else al.View.FRONT
            value = al.assess(built(rear, shift=30.0), view=view).metrics[name].value
            assert value > 0, f"{name} from {view.value}"

    @pytest.mark.parametrize("name", ["left_knee_deviation", "right_knee_deviation"])
    def test_a_knee_rolled_inward_reads_positive(self, name):
        for rear in (False, True):
            view = al.View.REAR if rear else al.View.FRONT
            value = al.assess(built(rear, knee_in=8.0), view=view).metrics[name].value
            assert value > 0, f"{name} from {view.value}"

    def test_a_square_body_reads_zero_either_way(self):
        for rear in (False, True):
            view = al.View.REAR if rear else al.View.FRONT
            metrics = al.assess(built(rear), view=view).metrics
            for name in SIDED:
                assert metrics[name].value == pytest.approx(0.0, abs=1e-6), name


class TestThePlumbChain:
    """Ear, shoulder, hip, knee, ankle -- the five points a standing
    assessment drops a vertical through. All five are in COCO-17, and the
    first version of this module used two of them."""

    def test_a_side_photograph_measures_the_whole_chain(self):
        out = al.assess(side_on(facing_image_left=False, ear_ahead=40.0),
                        view=al.View.SIDE_LEFT)
        for name in ("sagittal_ear_offset", "sagittal_shoulder_offset",
                     "sagittal_hip_offset", "sagittal_knee_offset"):
            assert out.metrics[name].measured, name

    def test_a_frontal_photograph_measures_the_lateral_chain(self):
        out = al.assess(built(False, shift=30.0), view=al.View.FRONT)
        for name in ("lateral_head_shift", "lateral_shoulder_shift",
                     "lateral_pelvis_shift"):
            assert out.metrics[name].measured, name

    def test_the_chains_do_not_cross_planes(self):
        """A sagittal shift is not measurable from the front and the reverse."""
        front = al.assess(built(False), view=al.View.FRONT).metrics
        side = al.assess(side_on(facing_image_left=False),
                         view=al.View.SIDE_LEFT).metrics
        assert not front["sagittal_ear_offset"].measured
        assert not side["lateral_head_shift"].measured

    def test_the_head_ahead_of_the_ankle_reads_forward_from_either_side(self):
        for facing, view in ((False, al.View.SIDE_LEFT),
                             (True, al.View.SIDE_RIGHT)):
            det = side_on(facing_image_left=facing, ear_ahead=40.0)
            value = al.assess(det, view=view).metrics["sagittal_ear_offset"].value
            assert value > 0, view.value

    def test_no_ankle_means_no_vertical_to_measure_against(self):
        det = side_on(facing_image_left=False, ear_ahead=40.0)
        scores = det.scores.copy()
        scores[kp.L_ANKLE] = scores[kp.R_ANKLE] = 0.05
        blind = Detection(det.keypoints, scores)
        metric = al.assess(blind, view=al.View.SIDE_LEFT).metrics["sagittal_ear_offset"]
        assert not metric.measured
        assert "visible" in metric.reason or "visibility" in metric.reason

    def test_every_chain_metric_has_a_band_to_be_judged_against(self):
        for name in ("sagittal_ear_offset", "sagittal_shoulder_offset",
                     "sagittal_hip_offset", "sagittal_knee_offset",
                     "lateral_head_shift", "lateral_shoulder_shift",
                     "lateral_pelvis_shift"):
            assert name in al.NORMAL_BANDS, name


def head_crop(cx: float = 640.0, cy: float = 300.0, conf: float = 0.85):
    """What a pose model returns for a head-and-shoulders photograph.

    It does not refuse one. It finds the head and invents the rest of the body
    a few dozen pixels below the chin -- hips, knees, ankles, stacked in the
    right order, every joint at high confidence, because that is what it
    learned bodies look like. This is the shape of the landmark set that
    produced a report saying a studio's client had perfect legs.
    """
    points = np.zeros((kp.NUM_KEYPOINTS, 2), dtype=np.float32)
    points[kp.NOSE] = (cx, cy)
    points[kp.L_EYE] = (cx - 14, cy - 8)
    points[kp.R_EYE] = (cx + 14, cy - 8)
    points[kp.L_EAR] = (cx - 30, cy - 2)
    points[kp.R_EAR] = (cx + 30, cy - 2)
    points[kp.L_SHOULDER] = (cx - 52, cy + 70)
    points[kp.R_SHOULDER] = (cx + 52, cy + 70)
    points[kp.L_ELBOW] = (cx - 60, cy + 110)
    points[kp.R_ELBOW] = (cx + 60, cy + 110)
    points[kp.L_WRIST] = (cx - 64, cy + 140)
    points[kp.R_WRIST] = (cx + 64, cy + 140)
    points[kp.L_HIP] = (cx - 40, cy + 150)
    points[kp.R_HIP] = (cx + 40, cy + 150)
    points[kp.L_KNEE] = (cx - 38, cy + 180)
    points[kp.R_KNEE] = (cx + 38, cy + 180)
    points[kp.L_ANKLE] = (cx - 36, cy + 205)
    points[kp.R_ANKLE] = (cx + 36, cy + 205)
    return Detection(points, np.full(kp.NUM_KEYPOINTS, conf, dtype=np.float32))


class TestIsThisAWholeBody:
    """The check that stops a photograph of a head being measured as a body.

    A studio uploaded a set cropped close and was handed a report saying
    shoulders 100/100, pelvis 100/100, legs and feet 100/100. The numbers were
    all real arithmetic over landmarks the model had invented below the chin,
    and every existing guard passed: confidence was high, the joints were
    stacked in the right order, and the pixels were there because the head was
    large. Only the proportions gave it away.
    """

    def test_a_head_crop_is_not_a_body(self):
        problems = al.not_a_standing_body(head_crop())
        assert problems
        assert "not a whole body" in problems[0]

    def test_it_says_the_photograph_is_cropped_too_close(self):
        """A receptionist has to know what to do differently."""
        assert "cropped" in al.not_a_standing_body(head_crop())[0]

    def test_the_head_is_what_gives_it_away(self):
        """A head is about a seventh of shoulder-to-ankle and does not
        foreshorten. In a head crop it is half."""
        assert "ear to shoulder" in al.not_a_standing_body(head_crop())[0]

    @pytest.mark.parametrize("body", [
        standing(cx=540),
        standing(shoulder_tilt=13.0, hip_tilt=9.0, cx=540),
        standing(facing="rear", shoulder_tilt=8.0, cx=540),
        side_on(facing_image_left=False, ear_ahead=60.0, cx=540),
        side_on(facing_image_left=True, cx=540),
    ])
    def test_a_real_body_passes(self, body):
        """The gate is worthless if it refuses the photographs a studio
        actually takes."""
        assert al.not_a_standing_body(body) == []

    def test_a_body_lying_down_is_not_judged_by_standing_proportions(self):
        """They describe standing, and would condemn a correct photograph of
        somebody on a mat."""
        from conftest import make_detection

        lying = make_detection(lying=True)
        assert al.not_a_standing_body(lying) == []

    def test_landmarks_that_are_not_there_are_not_judged(self):
        """A missing ankle is a measurement that cannot be made, not evidence
        that the body is the wrong shape."""
        det = head_crop()
        scores = det.scores.copy()
        for joint in (kp.L_EAR, kp.R_EAR):
            scores[joint] = 0.05
        assert al.not_a_standing_body(Detection(det.keypoints, scores)) == []

    def test_the_proportions_come_from_the_same_source_as_the_load_model(self):
        """Two tables describing how a body is shaped is two tables that
        disagree. Winter's, in both places."""
        from pilates import biomechanics as bio

        import inspect

        source = inspect.getsource(al)
        assert "Winter" in source, "the table cites no source"
        assert bio.SEGMENT_LENGTH_FRACTION["thigh_left"][2] == pytest.approx(
            0.245)
        # Thigh over shoulder-to-ankle: 0.245 of stature over 0.779 of stature.
        assert al.SEGMENT_SHARE["thigh"][1] == pytest.approx(0.245 / 0.779,
                                                             abs=0.01)

    def test_the_shares_of_a_standing_body_add_up(self):
        """Shoulder to hip to knee to ankle is the whole span, by
        construction. A table where they do not sum is a table with a typo."""
        total = sum(al.SEGMENT_SHARE[name][1]
                    for name in ("trunk", "thigh", "shank"))
        assert total == pytest.approx(1.0, abs=0.01)
