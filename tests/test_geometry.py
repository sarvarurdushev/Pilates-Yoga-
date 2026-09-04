import math

import numpy as np
import pytest

from pilates import keypoints as kp
from pilates.geometry import (
    contains, iou, joint_angle, overlap_fraction, posture, standard_angles,
    symmetry, trunk_angle,
)
from pilates.types import Detection
from conftest import make_detection


class TestIoU:
    def test_identical_boxes(self):
        assert iou((0, 0, 10, 10), (0, 0, 10, 10)) == pytest.approx(1.0)

    def test_disjoint_boxes(self):
        assert iou((0, 0, 10, 10), (20, 20, 30, 30)) == 0.0

    def test_touching_edges_do_not_overlap(self):
        assert iou((0, 0, 10, 10), (10, 0, 20, 10)) == 0.0

    def test_half_overlap(self):
        # Two 10x10 boxes sharing a 5x10 strip: 50 / (100 + 100 - 50).
        assert iou((0, 0, 10, 10), (5, 0, 15, 10)) == pytest.approx(50 / 150)

    def test_degenerate_box_is_safe(self):
        assert iou((5, 5, 5, 5), (0, 0, 10, 10)) == 0.0


class TestRegions:
    def test_contains(self):
        assert contains((0, 0, 100, 100), (10, 10, 20, 20))
        assert not contains((0, 0, 100, 100), (90, 90, 110, 110))

    def test_overlap_fraction_full(self):
        assert overlap_fraction((10, 10, 20, 20), (0, 0, 100, 100)) == pytest.approx(1.0)

    def test_overlap_fraction_half(self):
        assert overlap_fraction((0, 0, 10, 10), (5, 0, 100, 100)) == pytest.approx(0.5)

    def test_overlap_fraction_none(self):
        assert overlap_fraction((0, 0, 10, 10), (50, 50, 60, 60)) == 0.0


class TestTrunkAngle:
    def test_standing_is_near_vertical(self):
        angle = trunk_angle(make_detection(lying=False))
        assert angle is not None and angle > 60.0

    def test_lying_is_near_horizontal(self):
        angle = trunk_angle(make_detection(lying=True))
        assert angle is not None and angle < 30.0

    def test_returns_none_when_torso_not_visible(self):
        det = make_detection()
        scores = det.scores.copy()
        scores[kp.L_HIP] = 0.05
        assert trunk_angle(Detection(det.keypoints, scores)) is None

    def test_posture_labels(self):
        assert posture(make_detection(lying=False)) == "upright"
        assert posture(make_detection(lying=True)) == "lying"

    def test_posture_unknown_without_torso(self):
        det = make_detection()
        scores = det.scores.copy()
        scores[kp.R_SHOULDER] = 0.0
        assert posture(Detection(det.keypoints, scores)) == "unknown"


class TestJointAngle:
    def test_right_angle(self):
        pts = np.zeros((kp.NUM_KEYPOINTS, 2), dtype=np.float32)
        pts[kp.L_HIP] = (0, 0)
        pts[kp.L_KNEE] = (0, 10)
        pts[kp.L_ANKLE] = (10, 10)
        det = Detection(pts, np.ones(kp.NUM_KEYPOINTS, dtype=np.float32))
        assert joint_angle(det, kp.L_HIP, kp.L_KNEE, kp.L_ANKLE) == pytest.approx(90.0, abs=1e-3)

    def test_straight_limb_is_180(self):
        pts = np.zeros((kp.NUM_KEYPOINTS, 2), dtype=np.float32)
        pts[kp.L_HIP] = (0, 0)
        pts[kp.L_KNEE] = (0, 10)
        pts[kp.L_ANKLE] = (0, 20)
        det = Detection(pts, np.ones(kp.NUM_KEYPOINTS, dtype=np.float32))
        assert joint_angle(det, kp.L_HIP, kp.L_KNEE, kp.L_ANKLE) == pytest.approx(180.0, abs=1e-3)

    def test_none_when_a_joint_is_hidden(self):
        pts = np.zeros((kp.NUM_KEYPOINTS, 2), dtype=np.float32)
        scores = np.ones(kp.NUM_KEYPOINTS, dtype=np.float32)
        scores[kp.L_ANKLE] = 0.1
        assert joint_angle(Detection(pts, scores), kp.L_HIP, kp.L_KNEE, kp.L_ANKLE) is None

    def test_coincident_points_do_not_crash(self):
        pts = np.zeros((kp.NUM_KEYPOINTS, 2), dtype=np.float32)
        det = Detection(pts, np.ones(kp.NUM_KEYPOINTS, dtype=np.float32))
        assert joint_angle(det, kp.L_HIP, kp.L_KNEE, kp.L_ANKLE) is None


class TestSymmetry:
    def test_reports_absolute_difference(self):
        out = symmetry({"left_knee": 100.0, "right_knee": 85.0})
        assert out["knee"] == pytest.approx(15.0)

    def test_none_when_one_side_missing(self):
        assert symmetry({"left_knee": 100.0, "right_knee": None})["knee"] is None

    def test_standard_angles_cover_both_sides(self):
        angles = standard_angles(make_detection())
        for name in ("left_knee", "right_knee", "left_hip", "right_hip",
                     "left_elbow", "right_elbow"):
            assert name in angles


class TestWholeBody:
    """An exercise works a whole body. Eight weeks of recording produced three
    lines on a chart because only six joints were being measured."""

    def test_every_angle_comes_back_in_one_call(self):
        from pilates.geometry import SEGMENT_ANGLES, STANDARD_ANGLES, whole_body

        angles = whole_body(make_detection())
        for name, *_ in STANDARD_ANGLES:
            assert name in angles
        for name in SEGMENT_ANGLES:
            assert name in angles

    def test_shoulders_are_measured_now(self):
        from pilates.geometry import whole_body

        angles = whole_body(make_detection())
        assert angles["left_shoulder"] is not None
        assert angles["right_shoulder"] is not None

    def test_an_arm_by_the_side_is_a_small_shoulder_angle(self):
        from pilates.geometry import whole_body

        detection = make_detection()
        points = detection.keypoints.copy()
        # Elbow directly below the shoulder, along the torso.
        points[kp.L_ELBOW] = points[kp.L_SHOULDER] + np.array([0.0, 40.0])
        angles = whole_body(Detection(points, detection.scores.copy()))
        assert angles["left_shoulder"] < 30.0

    def test_an_arm_overhead_is_a_large_one(self):
        from pilates.geometry import whole_body

        detection = make_detection()
        points = detection.keypoints.copy()
        points[kp.L_ELBOW] = points[kp.L_SHOULDER] - np.array([0.0, 40.0])
        angles = whole_body(Detection(points, detection.scores.copy()))
        assert angles["left_shoulder"] > 150.0

    def test_level_shoulders_read_as_level(self):
        from pilates.geometry import shoulder_tilt

        assert abs(shoulder_tilt(make_detection())) < 1.0

    def test_a_dropped_shoulder_is_measured_and_signed(self):
        from pilates.geometry import shoulder_tilt

        detection = make_detection()
        points = detection.keypoints.copy()
        points[kp.R_SHOULDER] = points[kp.R_SHOULDER] + np.array([0.0, 20.0])
        tilt = shoulder_tilt(Detection(points, detection.scores.copy()))
        assert tilt > 5.0            # positive: the left shoulder sits higher

    def test_the_pelvis_is_measured_separately_from_the_shoulders(self):
        from pilates.geometry import pelvis_tilt, shoulder_tilt

        detection = make_detection()
        points = detection.keypoints.copy()
        points[kp.R_HIP] = points[kp.R_HIP] + np.array([0.0, 15.0])
        moved = Detection(points, detection.scores.copy())
        assert pelvis_tilt(moved) > 5.0
        assert abs(shoulder_tilt(moved)) < 1.0

    def test_a_head_stacked_on_the_spine_is_about_straight(self):
        from pilates.geometry import neck_angle

        assert neck_angle(make_detection()) > 160.0

    def test_a_head_pushed_forward_is_not(self):
        from pilates.geometry import neck_angle

        detection = make_detection(lying=True)
        points = detection.keypoints.copy()
        shoulders = (points[kp.L_SHOULDER] + points[kp.R_SHOULDER]) / 2
        points[kp.L_EAR] = points[kp.R_EAR] = shoulders + np.array([0.0, -50.0])
        assert neck_angle(Detection(points, detection.scores.copy())) < 130.0

    def test_the_neck_is_measured_against_the_torso_not_the_world(self):
        """So it stays meaningful lying down, which is most of a mat class."""
        from pilates.geometry import neck_angle

        assert neck_angle(make_detection(lying=True)) is not None

    def test_an_unseen_joint_yields_none_rather_than_a_guess(self):
        from pilates.geometry import whole_body

        detection = make_detection(visible=5)
        angles = whole_body(detection)
        assert angles["left_knee"] is None and angles["neck"] is None

    def test_symmetry_now_covers_the_shoulders(self):
        from pilates.geometry import symmetry, whole_body

        pairs = symmetry(whole_body(make_detection()))
        assert "shoulder" in pairs

    def test_no_ankle_angle_is_claimed(self):
        """It needs a foot keypoint to form the third point, and COCO-17 has
        none. Nothing here can say whether an ankle was dorsiflexed."""
        from pilates.geometry import whole_body

        assert not any("ankle" in name for name in whole_body(make_detection()))
