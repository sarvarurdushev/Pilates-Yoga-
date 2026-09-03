import math

import numpy as np
import pytest

from pilates import keypoints as kp
from pilates.biomechanics import (
    GRAVITY, MUSCLE_GROUPS, SEGMENTS, JointLoad, NotComputable, analyse_frame,
    classify_contraction, gravitational_moment, is_weight_bearing,
    metres_per_pixel,
)
from pilates.types import Detection


def person(points: dict, confidence=0.9):
    """A skeleton with only the given keypoints visible.

    Unset joints get zero confidence, not position (0, 0) at full confidence --
    otherwise every skeleton silently includes a keypoint in the corner of the
    frame, which drags the scale and every lever arm.
    """
    kps = np.zeros((kp.NUM_KEYPOINTS, 2), dtype=np.float32)
    scores = np.zeros(kp.NUM_KEYPOINTS, dtype=np.float32)
    for index, (x, y) in points.items():
        kps[index] = (x, y)
        scores[index] = confidence
    return Detection(kps, scores)


def lying_with_leg_raised(hip_x=500, hip_y=600, leg_px=300, angle_deg=0.0):
    """Supine, one leg held out horizontally: the classic loaded hip position."""
    rad = math.radians(angle_deg)
    knee = (hip_x + leg_px * 0.5 * math.cos(rad), hip_y - leg_px * 0.5 * math.sin(rad))
    ankle = (hip_x + leg_px * math.cos(rad), hip_y - leg_px * math.sin(rad))
    return person({
        kp.NOSE: (hip_x - 250, hip_y - 20),
        kp.L_SHOULDER: (hip_x - 180, hip_y - 30), kp.R_SHOULDER: (hip_x - 180, hip_y + 30),
        kp.L_HIP: (hip_x, hip_y - 10), kp.R_HIP: (hip_x, hip_y + 10),
        kp.L_KNEE: knee, kp.R_KNEE: knee,
        kp.L_ANKLE: ankle, kp.R_ANKLE: ankle,
        kp.L_ELBOW: (hip_x - 200, hip_y - 60), kp.R_ELBOW: (hip_x - 200, hip_y + 60),
        kp.L_WRIST: (hip_x - 230, hip_y - 80), kp.R_WRIST: (hip_x - 230, hip_y + 80),
    })


class TestScale:
    def test_derives_metres_per_pixel_from_a_limb(self):
        # Only a thigh visible: 100 px, and Winter puts it at 0.245 of height.
        det = person({kp.L_HIP: (100, 300), kp.L_KNEE: (100, 400)})
        assert metres_per_pixel(det, 1.60) == pytest.approx(0.245 * 1.60 / 100, rel=1e-6)

    def test_rejects_a_nonsense_height(self):
        with pytest.raises(NotComputable):
            metres_per_pixel(lying_with_leg_raised(), 0.0)

    def test_refuses_when_no_limb_is_visible(self):
        det = person({kp.NOSE: (10, 10)}, confidence=0.05)
        with pytest.raises(NotComputable, match="no limb"):
            metres_per_pixel(det, 1.7)

    def test_lying_and_standing_give_the_same_scale(self):
        """The bug this pins: dividing height by vertical extent assumes the
        person is standing, and inflates the scale for anyone on a mat."""
        standing = person({kp.L_HIP: (500, 400), kp.L_KNEE: (500, 500),
                           kp.L_ANKLE: (500, 600), kp.NOSE: (500, 200)})
        lying = person({kp.L_HIP: (400, 600), kp.L_KNEE: (500, 600),
                        kp.L_ANKLE: (600, 600), kp.NOSE: (200, 600)})
        assert metres_per_pixel(standing, 1.7) == pytest.approx(
            metres_per_pixel(lying, 1.7), rel=1e-6)

    def test_one_bad_keypoint_does_not_set_the_scale(self):
        det = person({
            kp.L_HIP: (500, 400), kp.L_KNEE: (500, 500), kp.L_ANKLE: (500, 600),
            kp.R_HIP: (520, 400), kp.R_KNEE: (520, 500), kp.R_ANKLE: (520, 600),
            kp.L_SHOULDER: (500, 200), kp.L_ELBOW: (500, 2000),   # wildly wrong
        })
        assert metres_per_pixel(det, 1.7) == pytest.approx(0.245 * 1.7 / 100, rel=0.1)

    def test_refuses_when_the_person_is_tiny(self):
        det = person({kp.NOSE: (100, 100), kp.L_HIP: (100, 105),
                      kp.L_KNEE: (100, 108), kp.L_ANKLE: (100, 110)})
        with pytest.raises(NotComputable, match="usable size"):
            metres_per_pixel(det, 1.7)


class TestGravitationalMoment:
    """The thing a joint angle cannot tell you: how hard this actually is."""

    def _load(self, angle_deg, mass=70.0, height=1.7, leg_px=300):
        det = lying_with_leg_raised(angle_deg=angle_deg, leg_px=leg_px)
        scale = metres_per_pixel(det, height)
        return gravitational_moment(det, "left_hip", mass, scale)

    def test_a_horizontal_leg_loads_the_hip(self):
        load = self._load(0.0)
        assert load is not None
        assert load.moment_nm > 10.0

    def test_a_vertical_leg_barely_loads_it(self):
        """Straight up, the weight passes through the joint: no lever, no moment."""
        assert self._load(90.0).moment_nm < self._load(0.0).moment_nm * 0.1

    def test_the_moment_matches_the_hand_calculation(self):
        mass, height, leg_px = 70.0, 1.7, 300.0
        load = self._load(0.0, mass=mass, height=height, leg_px=leg_px)
        limb_kg = mass * (SEGMENTS["left_thigh"].mass_fraction
                          + SEGMENTS["left_shank"].mass_fraction)
        assert load.load_kg == pytest.approx(limb_kg, rel=1e-6)
        assert load.moment_nm == pytest.approx(limb_kg * GRAVITY * load.lever_m, rel=1e-6)

    def test_a_heavier_person_is_under_more_load_at_the_same_angle(self):
        """Same picture, same joint angle, different demand."""
        assert self._load(0.0, mass=90.0).moment_nm > self._load(0.0, mass=55.0).moment_nm

    def test_a_taller_person_has_a_longer_lever(self):
        short = self._load(0.0, mass=70.0, height=1.55)
        tall = self._load(0.0, mass=70.0, height=1.90)
        assert tall.lever_m > short.lever_m

    def test_it_names_the_muscle_group_that_must_be_working(self):
        load = self._load(0.0)
        assert load.group is not None
        assert load.group.name == "hip flexors"
        assert "iliopsoas" in load.group.members

    def test_an_invisible_limb_yields_nothing(self):
        det = lying_with_leg_raised()
        scores = det.scores.copy()
        scores[kp.L_KNEE] = 0.05
        scale = 1.7 / 400
        assert gravitational_moment(Detection(det.keypoints, scores),
                                    "left_hip", 70.0, scale) is None

    def test_an_unknown_joint_is_refused(self):
        with pytest.raises(NotComputable):
            gravitational_moment(lying_with_leg_raised(), "left_neck", 70.0, 0.004)

    def test_a_nonsense_mass_is_refused(self):
        with pytest.raises(NotComputable):
            gravitational_moment(lying_with_leg_raised(), "left_hip", 0.0, 0.004)


class TestMuscleAttribution:
    def test_every_group_names_real_muscles(self):
        for (joint, direction), group in MUSCLE_GROUPS.items():
            assert group.members and all(m for m in group.members)
            assert group.action

    def test_both_directions_exist_for_each_joint(self):
        joints = {j for j, _ in MUSCLE_GROUPS}
        for joint in joints:
            assert (joint, "flexion") in MUSCLE_GROUPS
            assert (joint, "extension") in MUSCLE_GROUPS

    def test_knee_extension_is_attributed_to_the_quadriceps(self):
        group = MUSCLE_GROUPS[("knee", "extension")]
        assert "rectus femoris" in group.members
        assert "vastus lateralis" in group.members


class TestContraction:
    """The distinction that matters for coaching and is invisible in an angle."""

    def test_a_held_position_is_isometric(self):
        assert classify_contraction(20.0, 20.0, 90.0, 90.5) == "isometric"

    def test_closing_against_a_load_is_eccentric(self):
        assert classify_contraction(20.0, 20.0, 70.0, 90.0) == "eccentric"

    def test_opening_against_a_load_is_concentric(self):
        assert classify_contraction(20.0, 20.0, 110.0, 90.0) == "concentric"

    def test_no_load_means_no_claim(self):
        assert classify_contraction(0.0, 0.0, 70.0, 90.0) == "unknown"


class TestWeightBearing:
    """Standing on a leg makes the gravitational estimate invalid, because an
    unmeasured ground reaction force is doing most of the work."""

    def test_a_standing_leg_is_detected(self):
        det = person({
            kp.NOSE: (100, 100), kp.L_SHOULDER: (100, 200), kp.R_SHOULDER: (120, 200),
            kp.L_HIP: (100, 400), kp.R_HIP: (120, 400),
            kp.L_KNEE: (100, 600), kp.R_KNEE: (120, 600),
            kp.L_ANKLE: (100, 800), kp.R_ANKLE: (120, 800),
        })
        assert is_weight_bearing(det, "left_hip")

    def test_a_raised_leg_is_not(self):
        assert not is_weight_bearing(lying_with_leg_raised(angle_deg=0.0), "left_hip")


class TestFrameReport:
    def test_reports_loads_and_names_what_it_skipped(self):
        report = analyse_frame(lying_with_leg_raised(), body_mass_kg=70.0, height_m=1.7)
        assert report.loads
        assert report.hardest is not None

    def test_groups_are_summarised(self):
        report = analyse_frame(lying_with_leg_raised(), body_mass_kg=70.0, height_m=1.7)
        groups = report.by_group()
        assert groups
        assert all(v >= 0 for v in groups.values())

    def test_a_standing_person_has_weight_bearing_joints_skipped(self):
        det = person({
            kp.NOSE: (100, 100), kp.L_SHOULDER: (100, 200), kp.R_SHOULDER: (120, 200),
            kp.L_HIP: (100, 400), kp.R_HIP: (120, 400),
            kp.L_KNEE: (100, 600), kp.R_KNEE: (120, 600),
            kp.L_ANKLE: (100, 800), kp.R_ANKLE: (120, 800),
        })
        report = analyse_frame(det, body_mass_kg=70.0, height_m=1.7)
        assert "left_hip" in report.skipped
        assert "ground reaction force" in report.skipped["left_hip"]

    def test_an_unusable_frame_reports_why(self):
        det = person({kp.NOSE: (10, 10)}, confidence=0.05)
        report = analyse_frame(det, body_mass_kg=70.0, height_m=1.7)
        assert report.loads == []
        assert "scale" in report.skipped


class TestOrientationDependence:
    """The bug this pins: which muscle group works depends on how the body is
    oriented, not on which side of the joint the weight sits. A supine leg
    raise and a prone leg lift put the weight on opposite sides of the hip and
    load opposite groups; an earlier version read the sign of the lever arm and
    got one of them backwards."""

    def _hip_group(self, shoulder_y, knee_y):
        """Hip load for a horizontal leg, with the torso above or below it."""
        det = person({
            kp.NOSE: (200, shoulder_y), 
            kp.L_SHOULDER: (250, shoulder_y), kp.R_SHOULDER: (250, shoulder_y),
            kp.L_HIP: (500, 600), kp.R_HIP: (500, 600),
            kp.L_KNEE: (650, knee_y), kp.R_KNEE: (650, knee_y),
            kp.L_ANKLE: (800, knee_y), kp.R_ANKLE: (800, knee_y),
        })
        scale = metres_per_pixel(det, 1.7)
        load = gravitational_moment(det, "left_hip", 70.0, scale)
        assert load is not None and load.group is not None
        return load.group.name

    def test_supine_leg_raise_loads_the_hip_flexors(self):
        # Lying on the back: shoulders and the raised leg both above the hip.
        assert self._hip_group(shoulder_y=600, knee_y=560) == "hip flexors"

    def test_prone_leg_lift_loads_the_hip_extensors(self):
        # Face down: gravity now pulls the lifted leg the other way about the hip.
        assert self._hip_group(shoulder_y=600, knee_y=640) == "hip extensors"

    def test_the_two_are_genuinely_different(self):
        assert self._hip_group(600, 560) != self._hip_group(600, 640)

    def test_a_limb_hanging_straight_down_gets_no_attribution(self):
        """No lever, no moment, nothing to attribute to anyone."""
        det = person({
            kp.NOSE: (500, 100),
            kp.L_SHOULDER: (500, 200), kp.R_SHOULDER: (500, 200),
            kp.L_HIP: (500, 400), kp.R_HIP: (500, 400),
            kp.L_KNEE: (500, 600), kp.R_KNEE: (500, 600),
            kp.L_ANKLE: (500, 790), kp.R_ANKLE: (500, 790),
        })
        scale = metres_per_pixel(det, 1.7)
        load = gravitational_moment(det, "left_hip", 70.0, scale)
        assert load is not None
        assert load.moment_nm < 1.0
        assert load.group is None
