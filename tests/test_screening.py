"""Movement screening: range of motion, symmetry, control and balance.

The arithmetic here has one failure mode that matters more than the rest, and
most of this file is about it. The geometry layer reports the angle *at* a
joint -- a straight knee is 180 and a folded one approaches 0 -- and a clinic
reports flexion the other way up, where a straight knee is 0. A screening that
compared one against the other would report a student who never moved as
having full range, confidently, with a number beside it. So the bodies below
are built to a *known* clinical angle and the tests check that the number that
comes back is that angle.

The rest is refusal: too few frames, joints the estimator was not sure of, a
body too small in frame, and a movement filmed from the wrong side. Each of
those produces a clean, plausible number if nobody checks for it.
"""
from __future__ import annotations

import math

import numpy as np
import pytest

from pilates import keypoints as kp
from pilates import movement as mv
from pilates import screening as sc
from pilates.alignment import Availability, View
from pilates.types import Detection

SHOULDER_Y, HIP_Y, KNEE_Y, ANKLE_Y = 100.0, 250.0, 380.0, 500.0
UPPER_ARM, FOREARM, THIGH, SHIN = 80.0, 70.0, 130.0, 120.0


def _from(origin: np.ndarray, base: tuple[float, float], degrees: float,
          length: float, facing: float) -> np.ndarray:
    """A point ``length`` away, ``degrees`` from ``base``, turned ``facing``.

    ``base`` is a unit vector. The rotation is taken in image coordinates,
    where y grows downward, and ``facing`` picks which of the two solutions is
    used -- the same angle can put a knee in front of a body or behind it.
    """
    angle = math.radians(degrees)
    bx, by = base
    # Rotate the base vector by ``angle`` in the direction ``facing``.
    cos, sin = math.cos(angle), math.sin(angle) * facing
    direction = (bx * cos - by * sin, bx * sin + by * cos)
    return origin + np.array(direction, dtype=np.float32) * length


def body(*, left_shoulder: float = 0.0, right_shoulder: float = 0.0,
         left_hip: float = 0.0, right_hip: float = 0.0,
         left_knee: float = 0.0, right_knee: float = 0.0,
         lift: float = 0.0, sway: float = 0.0, cx: float = 300.0,
         scale: float = 1.0, confidence: float = 0.9) -> Detection:
    """A standing body at named *clinical* angles, in degrees.

    Zero everywhere is a person standing straight with their arms by their
    sides. ``lift`` raises the left foot, for the balance screen. ``scale``
    shrinks the whole body toward the top of the frame, for the too-small
    check.
    """
    points = np.zeros((kp.NUM_KEYPOINTS, 2), dtype=np.float32)
    scores = np.full(kp.NUM_KEYPOINTS, confidence, dtype=np.float32)

    def y(value: float) -> float:
        return SHOULDER_Y + (value - SHOULDER_Y) * scale

    cx = cx + sway
    for side, sign, shoulder_a, hip_a, knee_a in (
            ("L", -1.0, left_shoulder, left_hip, left_knee),
            ("R", +1.0, right_shoulder, right_hip, right_knee)):
        s_idx = getattr(kp, f"{side}_SHOULDER")
        # Shoulder and hip share an x so the torso is exactly vertical: the
        # angle at the shoulder is measured from the shoulder-to-hip line, and
        # a torso leaning three degrees puts three degrees into every arm
        # angle the fixture claims to build.
        shoulder = np.array([cx + sign * 24.0, y(SHOULDER_Y)], dtype=np.float32)
        points[s_idx] = shoulder
        points[getattr(kp, f"{side}_EAR")] = (cx + sign * 12.0, y(SHOULDER_Y - 55))

        # Arm: the angle carried from the torso, 0 by the side, 180 overhead.
        elbow = _from(shoulder, (0.0, 1.0), shoulder_a,
                      UPPER_ARM * scale, facing=-1.0)
        points[getattr(kp, f"{side}_ELBOW")] = elbow
        points[getattr(kp, f"{side}_WRIST")] = _from(
            elbow, (0.0, 1.0), shoulder_a, FOREARM * scale, facing=-1.0)

        hip = np.array([cx + sign * 24.0, y(HIP_Y)], dtype=np.float32)
        points[getattr(kp, f"{side}_HIP")] = hip
        # Thigh: the interior angle at the hip is 180 less the flexion.
        thigh_dir = (math.sin(math.radians(180.0 - hip_a)) * -1.0,
                     -math.cos(math.radians(180.0 - hip_a)))
        knee = hip + np.array(thigh_dir, dtype=np.float32) * (THIGH * scale)
        points[getattr(kp, f"{side}_KNEE")] = knee
        # Shin: the same conversion, measured from the thigh it hangs off.
        back = (-thigh_dir[0], -thigh_dir[1])
        shin = _from(np.zeros(2, dtype=np.float32), back, 180.0 - knee_a,
                     1.0, facing=+1.0)
        ankle = knee + shin * (SHIN * scale)
        if side == "L":
            ankle = ankle - np.array([0.0, lift], dtype=np.float32)
        points[getattr(kp, f"{side}_ANKLE")] = ankle

    points[kp.NOSE] = (cx, y(SHOULDER_Y - 60))
    points[kp.L_EYE] = (cx - 8, y(SHOULDER_Y - 62))
    points[kp.R_EYE] = (cx + 8, y(SHOULDER_Y - 62))
    return Detection(points, scores)


def clip(frames: list[Detection], fps: float = 30.0,
         threshold: float = 0.4) -> mv.TrackHistory:
    history = mv.TrackHistory(track_id=1)
    for i, det in enumerate(frames):
        history.add(i / fps, det, threshold)
    return history


def raises(peak: float, joint: str = "shoulder", reps: int = 3,
           per_rep: int = 40, side: str = "left", **kw) -> mv.TrackHistory:
    """A clip of one joint travelling from 0 to ``peak`` and back, ``reps`` times."""
    frames = []
    for i in range(reps * per_rep + 1):
        phase = (1.0 - math.cos(2 * math.pi * i / per_rep)) / 2.0
        frames.append(body(**{f"{side}_{joint}": peak * phase}, **kw))
    return clip(frames)


class TestTheBodyBuilder:
    """If the fixture is wrong every assertion below is measuring the fixture."""

    @pytest.mark.parametrize("degrees", [0.0, 45.0, 90.0, 140.0, 180.0])
    def test_a_shoulder_is_built_to_the_angle_it_is_asked_for(self, degrees):
        from pilates.geometry import standard_angles
        angles = standard_angles(body(left_shoulder=degrees))
        assert angles["left_shoulder"] == pytest.approx(degrees, abs=0.5)

    @pytest.mark.parametrize("degrees", [0.0, 30.0, 90.0, 120.0])
    def test_a_hip_is_built_to_the_flexion_it_is_asked_for(self, degrees):
        from pilates.geometry import standard_angles
        angles = standard_angles(body(left_hip=degrees))
        # Clinical flexion is 180 less the interior angle at the joint.
        assert 180.0 - angles["left_hip"] == pytest.approx(degrees, abs=0.5)

    @pytest.mark.parametrize("degrees", [0.0, 45.0, 135.0])
    def test_a_knee_is_built_to_the_flexion_it_is_asked_for(self, degrees):
        from pilates.geometry import standard_angles
        angles = standard_angles(body(left_knee=degrees))
        assert 180.0 - angles["left_knee"] == pytest.approx(degrees, abs=0.5)

    def test_the_body_is_large_enough_in_frame_to_measure(self):
        from pilates.geometry import body_height_px
        assert body_height_px(body()) > sc.MIN_BODY_PIXELS


class TestTheInversion:
    """The one mistake that would make every number in this module wrong."""

    def test_a_straight_knee_is_no_flexion_not_full_flexion(self):
        screen = sc.SCREENS["knee_flexion"]
        # The geometry says 180 for a straight leg; the clinic says 0.
        assert screen.clinical(180.0) == pytest.approx(0.0)
        assert screen.clinical(45.0) == pytest.approx(135.0)

    def test_an_arm_by_the_side_is_no_flexion_and_the_two_agree_there(self):
        screen = sc.SCREENS["shoulder_flexion"]
        assert screen.clinical(0.0) == pytest.approx(0.0)
        assert screen.clinical(180.0) == pytest.approx(180.0)

    def test_a_student_who_never_moved_scores_nothing_not_everything(self):
        still = clip([body() for _ in range(90)])
        out = sc.measure_side(still, sc.SCREENS["knee_flexion"], "left",
                              view=View.SIDE_LEFT)
        assert out.measured
        assert out.peak.value == pytest.approx(0.0, abs=2.0)
        assert out.shortfall.value == pytest.approx(135.0, abs=2.0)


class TestMeasuringARange:
    def test_the_peak_is_what_the_joint_actually_reached(self):
        out = sc.measure_side(raises(164.0), sc.SCREENS["shoulder_flexion"],
                              "left", view=View.SIDE_LEFT)
        assert out.measured
        assert out.peak.value == pytest.approx(164.0, abs=4.0)

    def test_the_shortfall_is_the_reference_less_what_was_reached(self):
        """The number the brief asks for: 180 expected, 164 observed, -16."""
        out = sc.measure_side(raises(164.0), sc.SCREENS["shoulder_flexion"],
                              "left", view=View.SIDE_LEFT)
        assert out.shortfall.value == pytest.approx(16.0, abs=4.0)

    def test_going_past_the_reference_is_no_shortfall_not_a_negative_one(self):
        """The reference is a ceiling. Passing it is not credit to bank: a
        squat below parallel is a squat that met the benchmark, and a negative
        shortfall would quietly pay for a shallow one elsewhere."""
        deep = sc.measure_side(raises(115.0, joint="hip"),
                               sc.SCREENS["squat_depth"], "left",
                               view=View.SIDE_LEFT)
        assert deep.peak.value > 90.0
        assert deep.shortfall.value == pytest.approx(0.0, abs=0.01)

    def test_smoothing_costs_a_degree_or_two_at_the_turn(self):
        """Stated rather than hidden: a moving average clips the very tip of a
        turn, so a full 180 reads a couple of degrees under. That is the price
        of not letting one noisy frame set the range, and it is paid in the
        direction that understates."""
        out = sc.measure_side(raises(180.0), sc.SCREENS["shoulder_flexion"],
                              "left", view=View.SIDE_LEFT)
        assert 175.0 <= out.peak.value <= 180.0

    def test_the_peak_is_read_off_the_smoothed_signal(self):
        """Otherwise the reported range is the most optimistic piece of
        keypoint noise in the clip, every time, in every report."""
        frames = []
        for i in range(121):
            phase = (1.0 - math.cos(2 * math.pi * i / 40)) / 2.0
            spike = 25.0 if i == 20 else 0.0
            frames.append(body(left_shoulder=min(180.0, 120.0 * phase + spike)))
        out = sc.measure_side(clip(frames), sc.SCREENS["shoulder_flexion"],
                              "left", view=View.SIDE_LEFT)
        assert out.peak.value < 135.0, "the one-frame spike did not set the peak"

    def test_repetitions_are_counted(self):
        out = sc.measure_side(raises(150.0, reps=3),
                              sc.SCREENS["shoulder_flexion"], "left",
                              view=View.SIDE_LEFT)
        assert out.repetitions == pytest.approx(3, abs=1)

    def test_every_repetition_is_measured_not_just_the_best_one(self):
        out = sc.measure_side(raises(150.0, reps=3),
                              sc.SCREENS["shoulder_flexion"], "left",
                              view=View.SIDE_LEFT)
        assert len(out.excursions) == out.repetitions
        assert all(e > sc.MIN_EXCURSION for e in out.excursions)

    def test_repetitions_of_the_same_size_are_consistent(self):
        out = sc.measure_side(raises(150.0, reps=4),
                              sc.SCREENS["shoulder_flexion"], "left",
                              view=View.SIDE_LEFT)
        assert out.consistency is not None
        assert out.consistency.value == pytest.approx(0.0, abs=4.0)

    def test_a_student_fading_over_a_set_shows_it(self):
        """A mean that stays respectable while each rep gets smaller is the
        thing a set of repetitions exists to reveal."""
        frames = []
        for rep, peak in enumerate((160.0, 130.0, 95.0)):
            for i in range(40):
                phase = (1.0 - math.cos(2 * math.pi * i / 40)) / 2.0
                frames.append(body(left_shoulder=peak * phase))
        out = sc.measure_side(clip(frames), sc.SCREENS["shoulder_flexion"],
                              "left", view=View.SIDE_LEFT)
        assert out.consistency is not None
        assert out.consistency.value > 10.0

    def test_tempo_is_reported_in_seconds_per_repetition(self):
        out = sc.measure_side(raises(150.0, reps=3, per_rep=60),
                              sc.SCREENS["shoulder_flexion"], "left",
                              view=View.SIDE_LEFT)
        assert out.tempo is not None
        assert out.tempo.value == pytest.approx(2.0, abs=0.4)

    def test_a_hip_flexion_is_reported_as_flexion_not_as_a_joint_angle(self):
        out = sc.measure_side(raises(110.0, joint="hip"),
                              sc.SCREENS["hip_flexion"], "left",
                              view=View.SIDE_LEFT)
        assert out.peak.value == pytest.approx(110.0, abs=5.0)

    def test_a_knee_flexion_is_reported_as_flexion_not_as_a_joint_angle(self):
        out = sc.measure_side(raises(120.0, joint="knee"),
                              sc.SCREENS["knee_flexion"], "left",
                              view=View.SIDE_LEFT)
        assert out.peak.value == pytest.approx(120.0, abs=5.0)

    def test_a_squat_is_measured_against_thigh_parallel(self):
        out = sc.measure_side(raises(75.0, joint="hip"),
                              sc.SCREENS["squat_depth"], "left",
                              view=View.SIDE_LEFT)
        assert out.peak.value == pytest.approx(75.0, abs=5.0)
        assert out.shortfall.value == pytest.approx(15.0, abs=5.0)


class TestRefusing:
    """A screen that cannot be measured says so. It does not return a number."""

    def test_a_clip_too_short_to_contain_a_movement(self):
        short = clip([body(left_shoulder=90.0) for _ in range(6)])
        out = sc.measure_side(short, sc.SCREENS["shoulder_flexion"], "left",
                              view=View.SIDE_LEFT)
        assert not out.measured
        assert out.peak.availability is Availability.UNAVAILABLE
        assert str(sc.MIN_FRAMES) in out.peak.reason

    def test_joints_the_estimator_was_not_sure_of(self):
        # Above the threshold at which the geometry will compute an angle at
        # all, and below the one at which the answer is worth printing: the
        # gap where a plausible number comes out of joints nobody could see.
        unsure = clip([body(left_shoulder=90.0, confidence=0.45)
                       for _ in range(90)])
        out = sc.measure_side(unsure, sc.SCREENS["shoulder_flexion"], "left",
                              view=View.SIDE_LEFT)
        assert not out.measured
        assert "confidence" in out.peak.reason

    def test_a_body_too_small_in_frame_to_measure_a_degree(self):
        tiny = clip([body(left_shoulder=90.0, scale=0.3) for _ in range(90)])
        out = sc.measure_side(tiny, sc.SCREENS["shoulder_flexion"], "left",
                              view=View.SIDE_LEFT)
        assert not out.measured
        assert "px" in out.peak.reason

    def test_a_movement_filmed_from_the_wrong_plane(self):
        """Shoulder flexion travels toward the camera in a front view, and a
        camera cannot see toward itself. The number would be plausible."""
        out = sc.measure_side(raises(164.0), sc.SCREENS["shoulder_flexion"],
                              "left", view=View.FRONT)
        assert not out.measured
        assert "plane" in out.peak.reason

    def test_the_same_movement_from_the_right_plane_is_measured(self):
        out = sc.measure_side(raises(164.0), sc.SCREENS["shoulder_abduction"],
                              "left", view=View.FRONT)
        assert out.measured

    def test_a_clip_with_no_stated_view_is_estimated_never_asserted(self):
        out = sc.measure_side(raises(164.0), sc.SCREENS["shoulder_flexion"],
                              "left", view=None)
        assert out.measured
        assert out.peak.availability is Availability.ESTIMATED
        assert any("camera angle was not stated" in n for n in out.notes)

    def test_a_refusal_has_the_same_shape_as_a_measurement(self):
        """A caller that has to branch on whether the answer exists will one
        day forget to, and print a blank where a reason belongs."""
        out = sc.measure_side(clip([body() for _ in range(4)]),
                              sc.SCREENS["shoulder_flexion"], "left",
                              view=View.SIDE_LEFT)
        payload = out.to_dict()
        assert payload["peak"]["value"] is None
        assert payload["peak"]["reason"]
        assert payload["shortfall"]["value"] is None


def both(left_peak: float, right_peak: float, joint: str = "shoulder",
         **kw) -> dict[str, mv.TrackHistory]:
    return {"left": raises(left_peak, joint=joint, side="left", **kw),
            "right": raises(right_peak, joint=joint, side="right", **kw)}


class TestTheTwoSides:
    def test_two_sides_are_kept_whole_never_averaged(self):
        """A body with one shoulder at 180 and the other at 120 averages to
        150 and looks unremarkable. The difference is the finding."""
        out = sc.measure(both(120.0, 180.0), sc.SCREENS["shoulder_flexion"],
                         view=View.SIDE_LEFT)
        assert out.left.peak.value == pytest.approx(120.0, abs=5.0)
        assert out.right.peak.value == pytest.approx(180.0, abs=5.0)

    def test_the_difference_between_them_is_measured(self):
        out = sc.measure(both(120.0, 170.0), sc.SCREENS["shoulder_flexion"],
                         view=View.SIDE_LEFT)
        assert out.difference.value == pytest.approx(50.0, abs=6.0)

    def test_the_side_that_went_less_far_is_named(self):
        out = sc.measure(both(120.0, 170.0), sc.SCREENS["shoulder_flexion"],
                         view=View.SIDE_LEFT)
        assert out.shorter_side == "left"

    def test_a_difference_inside_the_measurement_error_is_not_a_difference(self):
        """Goniometry repeats to about five degrees and a camera is not
        better, so a gap has to clear twice that to be about the body."""
        out = sc.measure(both(150.0, 155.0), sc.SCREENS["shoulder_flexion"],
                         view=View.SIDE_LEFT)
        assert out.difference.value < sc.SIDE_TOLERANCE
        assert out.shorter_side == ""

    def test_one_side_missing_leaves_nothing_to_compare_against(self):
        out = sc.measure({"left": raises(150.0)},
                         sc.SCREENS["shoulder_flexion"], view=View.SIDE_LEFT)
        assert not out.difference.measured
        assert "nothing to compare" in out.difference.reason
        assert out.left.measured, "the side that was filmed is still measured"

    def test_an_unsided_screen_reports_no_asymmetry_rather_than_zero(self):
        screen = sc.SCREENS["shoulder_flexion"]
        result = sc.ScreenResult(screen=screen.key)
        assert not result.difference.measured
        assert "not measured per side" in result.difference.reason


def balance(seconds: float, *, side: str = "left", sway: float = 0.0,
            fps: float = 30.0) -> mv.TrackHistory:
    """A clip of somebody standing on one leg, wobbling ``sway`` pixels."""
    frames = []
    n = int(seconds * fps)
    lift = 60.0 if side == "right" else 0.0   # the *other* foot comes up
    for i in range(n):
        drift = sway * math.sin(2 * math.pi * i / 37.0)
        if side == "right":
            frames.append(body(lift=60.0, sway=drift))
        else:
            # Standing on the left means the right foot is up; the builder
            # lifts the left one, so mirror it by lifting nothing and moving
            # the right ankle instead.
            det = body(sway=drift)
            det.keypoints[kp.R_ANKLE] = det.keypoints[kp.R_ANKLE] - np.array(
                [0.0, 60.0], dtype=np.float32)
            frames.append(det)
    return clip(frames, fps=fps)


class TestBalance:
    def test_how_long_the_foot_stayed_up_is_the_measurement(self):
        out = sc.measure_side(balance(12.0), sc.SCREENS["single_leg_balance"],
                              "left", view=View.FRONT)
        assert out.measured
        assert out.held.value == pytest.approx(12.0, abs=0.5)

    def test_a_hold_longer_than_the_test_stops_at_the_test_ceiling(self):
        """Thirty seconds is where the single-leg stance test stops. Forty is
        not a score of 133."""
        out = sc.measure_side(balance(40.0), sc.SCREENS["single_leg_balance"],
                              "left", view=View.FRONT)
        assert out.peak.value == pytest.approx(30.0, abs=0.1)
        assert out.held.value == pytest.approx(40.0, abs=0.5)

    def test_putting_the_foot_down_ends_the_hold(self):
        """A student who wobbles for four seconds, puts the foot down and
        stands there for twenty has balanced for four. Measuring the clip
        would report twenty, and the number would be wrong the flattering
        way."""
        up = balance(4.0).samples
        history = mv.TrackHistory(track_id=1)
        for i, sample in enumerate(up):
            history.samples.append(sample)
        for i in range(600):
            history.add((len(up) + i) / 30.0, body(), 0.4)
        out = sc.measure_side(history, sc.SCREENS["single_leg_balance"],
                              "left", view=View.FRONT)
        assert out.held.value == pytest.approx(4.0, abs=0.4)

    def test_never_standing_on_one_leg_is_refused_not_scored(self):
        out = sc.measure_side(clip([body() for _ in range(300)]),
                              sc.SCREENS["single_leg_balance"], "left",
                              view=View.FRONT)
        assert not out.measured
        assert "clear of the floor" in out.peak.reason

    def test_a_steadier_hold_sways_less_than_a_wobbly_one(self):
        steady = sc.measure_side(balance(12.0, sway=1.0),
                                 sc.SCREENS["single_leg_balance"], "left",
                                 view=View.FRONT)
        wobbly = sc.measure_side(balance(12.0, sway=25.0),
                                 sc.SCREENS["single_leg_balance"], "left",
                                 view=View.FRONT)
        assert steady.sway.measured and wobbly.sway.measured
        assert wobbly.sway.value > steady.sway.value * 3

    def test_sway_carries_no_reference_band_because_none_was_published(self):
        """Inventing one would be the single thing this module exists not to
        do. It is a number to compare against the same person later."""
        out = sc.measure_side(balance(12.0, sway=10.0),
                              sc.SCREENS["single_leg_balance"], "left",
                              view=View.FRONT)
        assert out.sway.normal is None

    def test_sway_is_a_share_of_the_body_not_a_count_of_pixels(self):
        """Pixels are a fact about where the camera was standing."""
        near = sc.measure_side(balance(12.0, sway=20.0),
                               sc.SCREENS["single_leg_balance"], "left",
                               view=View.FRONT)
        assert 0.0 < near.sway.value < 1.0


def session(**peaks) -> sc.ScreeningAssessment:
    """A screening of one student with the given peaks, filmed side-on."""
    clips, views = {}, {}
    for key, (left, right) in peaks.items():
        screen = sc.SCREENS[key]
        joint = screen.signal.split("_", 1)[1]
        clips[key] = {"left": raises(left, joint=joint, side="left"),
                      "right": raises(right, joint=joint, side="right")}
        views[key] = screen.views[0]
    return sc.screen_all(clips, views=views, person_id="test",
                         taken_on="2026-09-14")


class TestTheScore:
    def test_one_screen_is_too_few_to_carry_a_headline(self):
        """Three checks, and the shared coverage rule withholds rather than
        averaging a whole body out of one shoulder. The screen's own numbers
        are all still there to read."""
        out = session(shoulder_flexion=(180.0, 180.0))
        assert out.score().value is None
        assert "check" in out.score().withheld_reason
        assert out.checks, "and every check it did make is still listed"

    def test_a_body_at_the_reference_scores_near_a_hundred(self):
        out = session(shoulder_flexion=(180.0, 180.0),
                      knee_flexion=(135.0, 135.0))
        assert out.score().value > 95

    def test_a_range_at_half_the_reference_scores_that_check_near_half(self):
        """Reached over reference, and nothing else. Arithmetic a reader can
        repeat on the numbers printed beside it, which is the whole
        requirement a score here has to meet.

        Deliberately checked per range rather than on the headline: a body
        that reaches half as far *evenly* scores full marks for evenness, and
        the headline is the two answers together. Reading the headline as
        "half" would be reading it as something it is not."""
        out = session(shoulder_flexion=(90.0, 90.0),
                      knee_flexion=(67.5, 67.5))
        ranges = [v for n, v in out.checks if not n.endswith("_symmetry")]
        assert ranges and all(45 < v < 55 for v in ranges)

    def test_an_even_body_is_credited_for_evenness_even_when_it_is_stiff(self):
        """The two questions a screening asks are how far, and whether the
        sides match. Collapsing them would hide the second."""
        out = session(shoulder_flexion=(90.0, 90.0),
                      knee_flexion=(67.5, 67.5))
        symmetry = [v for n, v in out.checks if n.endswith("_symmetry")]
        assert symmetry and all(v == pytest.approx(100.0) for v in symmetry)

    def test_every_check_is_named_and_its_number_shown(self):
        out = session(shoulder_flexion=(140.0, 140.0))
        names = {name for name, _ in out.checks}
        assert names == {"shoulder_flexion_left", "shoulder_flexion_right",
                         "shoulder_flexion_symmetry"}

    def test_the_score_is_the_mean_of_the_checks_and_nothing_else(self):
        out = session(shoulder_flexion=(140.0, 150.0),
                      knee_flexion=(120.0, 125.0))
        values = [v for _, v in out.checks]
        assert out.score().value == pytest.approx(sum(values) / len(values),
                                                  abs=0.2)

    def test_a_lopsided_body_loses_marks_a_symmetrical_one_keeps(self):
        even = session(shoulder_flexion=(150.0, 150.0),
                       knee_flexion=(120.0, 120.0)).score().value
        odd = session(shoulder_flexion=(120.0, 180.0),
                      knee_flexion=(120.0, 120.0)).score().value
        assert odd < even, "the same mean range, and one of them is a finding"

    def test_a_screening_is_scored_out_of_what_it_filmed(self):
        """Not out of the whole catalogue: a studio that had time for one
        screen is not punished for the five it did not film."""
        out = session(shoulder_flexion=(180.0, 180.0))
        assert out.measurable == 3
        assert out.score().coverage == pytest.approx(1.0)

    def test_a_screen_nobody_filmed_is_simply_absent(self):
        out = session(shoulder_flexion=(150.0, 150.0))
        assert out.attempted == ("shoulder_flexion",)
        assert "knee_flexion" in out.to_dict()["not_screened"]

    def test_a_doubtful_screening_withholds_the_headline(self):
        """A score printed beside a warning that the clip is unusable is the
        worst thing this can put on a screen: the number gets read and the
        warning gets skipped."""
        out = sc.screen_all(
            {"shoulder_flexion": {
                "left": raises(150.0, side="left"),
                "right": raises(150.0, side="right")}},
            views={"shoulder_flexion": View.FRONT})
        assert out.doubts
        assert out.score().value is None
        assert "again" in out.score().blocked

    def test_a_screen_nobody_filmed_is_a_gap_and_not_a_doubt(self):
        """Coverage records it and everything measured is still true. Only a
        clip that produced a number about nothing withholds the headline."""
        out = sc.measure({"left": raises(150.0)},
                         sc.SCREENS["shoulder_flexion"], view=View.SIDE_LEFT)
        assessment = sc.ScreeningAssessment(
            results={"shoulder_flexion": out},
            views={"shoulder_flexion": View.SIDE_LEFT})
        assert assessment.doubts == []
        assert assessment.score().blocked == ""
        assert assessment.reliable


class TestFindings:
    def test_a_joint_inside_its_reference_produces_no_finding(self):
        """Reaching the published range is not an achievement to report. It
        is the absence of one."""
        assert session(shoulder_flexion=(180.0, 180.0)).findings() == []

    def test_a_shortfall_is_reported_with_the_arithmetic_behind_it(self):
        found = session(shoulder_flexion=(120.0, 120.0)).findings()
        assert found
        first = found[0]
        assert first.kind == "range"
        assert first.reference == 180.0
        assert first.reached == pytest.approx(120.0, abs=5.0)
        assert "reference 180" in first.measurement()
        assert "short" in first.measurement()

    def test_the_measurement_reads_in_korean_too(self):
        found = session(shoulder_flexion=(120.0, 120.0)).findings()
        assert "기준 180°" in found[0].measurement("ko")
        assert "부족" in found[0].measurement("ko")

    def test_a_bigger_shortfall_outranks_a_smaller_one(self):
        found = session(shoulder_flexion=(60.0, 60.0),
                        knee_flexion=(130.0, 130.0)).findings()
        assert found[0].screen == "shoulder_flexion"

    def test_a_grade_means_the_same_amount_of_missing_movement(self):
        """A tenth of the range being measured, not a flat five degrees: five
        degrees is a finding on a shoulder line and nothing on a shoulder that
        travels through 180 of them."""
        assert sc.step_for(sc.SCREENS["shoulder_flexion"]) == pytest.approx(18.0)
        assert sc.step_for(sc.SCREENS["squat_depth"]) == pytest.approx(9.0)
        assert sc.step_for(sc.SCREENS["single_leg_balance"]) == pytest.approx(3.0)

    def test_an_uneven_pair_is_a_finding_in_its_own_right(self):
        found = session(shoulder_flexion=(120.0, 175.0)).findings()
        gaps = [f for f in found if f.kind == "asymmetry"]
        assert gaps and gaps[0].side == "left"
        assert "between the sides" in gaps[0].measurement()

    def test_nothing_in_a_finding_names_a_cause(self):
        """A joint that did not travel as far may be stiff, may be guarded,
        may be a student who misheard the instruction. The report says what
        was measured."""
        payload = session(shoulder_flexion=(90.0, 90.0)).to_dict()
        text = repr(payload)
        for word in ("injur", "scolio", "diagnos", "syndrome", "disease",
                     "impingement", "pathol"):
            assert word not in text.lower()


class TestTheReference:
    def test_every_screen_says_where_its_number_came_from(self):
        for screen in sc.SCREENS.values():
            assert len(screen.reference_source) > 20

    def test_a_functional_benchmark_is_not_dressed_as_a_clinical_normal(self):
        assert sc.SCREENS["squat_depth"].reference_kind == "functional"
        assert sc.SCREENS["shoulder_flexion"].reference_kind == "clinical"
        assert "Not a clinical normal" in sc.SCREENS["squat_depth"].reference_source

    def test_the_source_travels_with_the_finding(self):
        found = session(squat_depth=(40.0, 40.0)).findings()
        assert found[0].to_dict()["reference_kind"] == "functional"
        assert found[0].to_dict()["reference_source"]

    def test_every_screen_names_the_plane_it_must_be_filmed_in(self):
        for screen in sc.SCREENS.values():
            assert screen.views

    def test_every_screen_reads_in_both_languages(self):
        for screen in sc.SCREENS.values():
            for lang in ("en", "ko"):
                assert screen.named(lang)
                assert len(screen.how(lang)) > 20
        assert len({s.name_ko for s in sc.SCREENS.values()}) == len(sc.SCREENS)


class TestThenAndNow:
    def test_the_same_joint_six_weeks_apart_is_compared(self):
        before = session(shoulder_flexion=(120.0, 120.0))
        after = session(shoulder_flexion=(150.0, 150.0))
        out = sc.compare(before, after)
        left = [c for c in out["changes"] if c["side"] == "left"][0]
        assert left["comparable"]
        assert left["difference"] == pytest.approx(30.0, abs=6.0)

    def test_nothing_calls_a_larger_range_an_improvement(self):
        before = session(shoulder_flexion=(120.0, 120.0))
        after = session(shoulder_flexion=(150.0, 150.0))
        out = sc.compare(before, after)
        assert "further" in out["changes"][0]["sentence"]
        assert "judgement for the person teaching" in out["judgement"]
        rendered = repr([c["sentence"] for c in out["changes"]])
        assert "improve" not in rendered.lower()

    def test_a_screen_filmed_from_a_different_plane_is_not_compared(self):
        """A foreshortening error put into a progress number and called a
        change in the body."""
        clips = {"shoulder_flexion": {"left": raises(150.0, side="left"),
                                      "right": raises(150.0, side="right")}}
        before = sc.screen_all(clips, views={"shoulder_flexion": View.SIDE_LEFT})
        after = sc.screen_all(clips, views={"shoulder_flexion": View.FRONT})
        out = sc.compare(before, after)
        assert all(not c["comparable"] for c in out["changes"])
        assert "different plane" in out["changes"][0]["reason"]

    def test_a_screen_only_one_visit_filmed_is_not_compared(self):
        before = session(shoulder_flexion=(120.0, 120.0))
        after = session(shoulder_flexion=(150.0, 150.0),
                        knee_flexion=(120.0, 120.0))
        out = sc.compare(before, after)
        assert {c["screen"] for c in out["changes"]} == {"shoulder_flexion"}

    def test_no_headline_difference_when_either_side_withheld_its_score(self):
        before = sc.screen_all(
            {"shoulder_flexion": {"left": raises(150.0, side="left"),
                                  "right": raises(150.0, side="right")}},
            views={"shoulder_flexion": View.FRONT})
        after = session(shoulder_flexion=(150.0, 150.0))
        out = sc.compare(before, after)
        assert out["score_change"] is None

    def test_the_comparison_reads_in_korean(self):
        before = session(shoulder_flexion=(120.0, 120.0))
        after = session(shoulder_flexion=(150.0, 150.0))
        out = sc.compare(before, after)
        assert "어깨 굽힘" in out["changes"][0]["sentence_ko"]
        assert "지도하는 사람이 판단할 일입니다" in out["judgement_ko"]


class TestThePayload:
    def test_every_number_carries_its_unit_availability_and_confidence(self):
        """The brief's requirement, checked on every metric rather than on a
        sample of them."""
        payload = session(shoulder_flexion=(150.0, 150.0)).to_dict()
        side = payload["results"]["shoulder_flexion"]["left"]
        for name in ("peak", "shortfall"):
            metric = side[name]
            assert metric["unit"]
            assert metric["availability"] in {"available", "estimated",
                                              "unavailable"}
            assert metric["confidence"] > 0

    def test_the_view_requirement_travels_with_the_screen(self):
        payload = session(shoulder_flexion=(150.0, 150.0)).to_dict()
        assert payload["results"]["shoulder_flexion"]["views"] == ["side_left",
                                                                  "side_right"]

    def test_a_refusal_is_listed_with_its_reason(self):
        out = sc.measure({"left": raises(150.0)},
                         sc.SCREENS["shoulder_flexion"], view=View.SIDE_LEFT)
        assessment = sc.ScreeningAssessment(results={"shoulder_flexion": out})
        refused = assessment.to_dict()["refused"]
        assert refused and refused[0]["reason"]

    def test_an_unknown_screen_is_refused_rather_than_measured(self):
        with pytest.raises(KeyError):
            sc.screen_all({"backflip": {"left": raises(90.0)}})


class TestWhatToWorkOn:
    """A measurement a studio can act on, from the library it already has."""

    def test_a_shortfall_suggests_exercises_for_that_range(self):
        plan = sc.programme(session(shoulder_flexion=(110.0, 110.0)))
        assert plan
        assert all(row["screen"] == "shoulder_flexion" for row in plan)

    def test_a_body_at_the_reference_is_suggested_nothing(self):
        """Reaching the published range needs no exercises prescribed for it."""
        assert sc.programme(session(shoulder_flexion=(180.0, 180.0))) == []

    def test_two_short_screens_are_both_worked_before_either_is_twice(self):
        """Five shoulder exercises for a body whose shoulder and knee were both
        short is a plan that ignores half of what was measured."""
        plan = sc.programme(session(shoulder_flexion=(110.0, 110.0),
                                    knee_flexion=(70.0, 70.0)))
        assert [row["screen"] for row in plan[:2]] == ["shoulder_flexion",
                                                       "knee_flexion"]

    def test_the_worst_screen_is_worked_first(self):
        plan = sc.programme(session(shoulder_flexion=(60.0, 60.0),
                                    knee_flexion=(128.0, 128.0)))
        assert plan[0]["screen"] == "shoulder_flexion"

    def test_it_stops_where_it_is_told_to(self):
        plan = sc.programme(session(shoulder_flexion=(60.0, 60.0),
                                    knee_flexion=(40.0, 40.0)), limit=3)
        assert len(plan) == 3

    def test_no_exercise_is_named_twice(self):
        plan = sc.programme(session(shoulder_flexion=(60.0, 60.0),
                                    knee_flexion=(40.0, 40.0)), limit=10)
        assert len({row["key"] for row in plan}) == len(plan)

    def test_every_exercise_named_is_one_the_studio_actually_has(self):
        """A key nothing matches is a button that opens nothing."""
        from pilates import guidance as gd

        library = gd.repertoire()
        for screen in sc.SCREENS.values():
            assert screen.works, f"{screen.key} points at no exercise"
            for key in screen.works:
                assert key in library, f"{screen.key} names {key}, which is not there"

    def test_the_names_are_read_from_the_library_not_typed_here(self):
        """A studio that renames an exercise renames it once."""
        plan = sc.programme(session(shoulder_flexion=(110.0, 110.0)))
        source = (pytest.importorskip("pathlib").Path(sc.__file__).read_text())
        for row in plan:
            assert row["name"] not in source
            assert row["name_ko"] not in source

    def test_the_plan_reads_in_both_languages(self):
        plan = sc.programme(session(shoulder_flexion=(110.0, 110.0)))
        for row in plan:
            assert row["name"] and row["name_ko"]
            assert row["screen_name"] and row["screen_name_ko"]

    def test_the_plan_travels_with_the_measurement(self):
        payload = session(shoulder_flexion=(110.0, 110.0)).to_dict()
        assert payload["programme"]
        assert payload["programme"][0]["key"]
