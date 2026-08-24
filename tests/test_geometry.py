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
