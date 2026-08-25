import numpy as np
import pytest

from pilates import keypoints as kp
from pilates.dataset import FEATURE_SIZE
from pilates.multiview import (
    FUSED_FEATURE_SIZE, Association, CalibrationError, FloorHomography,
    associate, floor_point, fuse_frame, fuse_window,
)
from pilates.types import Detection, TrackedPerson
from conftest import make_detection


def square(scale=1.0, dx=0.0, dy=0.0):
    return np.array([[0, 0], [100, 0], [100, 100], [0, 100]], np.float32) * scale + [dx, dy]


def person(track_id, ankle_x, ankle_y, visible=True):
    det = make_detection(x=ankle_x - 30, y=ankle_y - 180, width=60, height=180)
    points = det.keypoints.copy()
    scores = det.scores.copy()
    points[kp.L_ANKLE] = (ankle_x - 5, ankle_y)
    points[kp.R_ANKLE] = (ankle_x + 5, ankle_y)
    if not visible:
        scores[kp.L_ANKLE] = scores[kp.R_ANKLE] = 0.05
    return TrackedPerson(track_id=track_id, detection=Detection(points, scores))


class TestFloorPoint:
    def test_midpoint_of_both_ankles(self):
        point = floor_point(person(1, 400, 600).detection)
        assert point == pytest.approx([400, 600], abs=1e-3)

    def test_falls_back_to_one_visible_ankle(self):
        p = person(1, 400, 600)
        scores = p.detection.scores.copy()
        scores[kp.R_ANKLE] = 0.05
        point = floor_point(Detection(p.detection.keypoints, scores))
        assert point == pytest.approx([395, 600], abs=1e-3)

    def test_none_when_feet_are_hidden(self):
        """Guessing would associate this student with the wrong person."""
        assert floor_point(person(1, 400, 600, visible=False).detection) is None


class TestHomography:
    def test_maps_a_known_transform(self):
        h = FloorHomography.fit(square(), square(scale=2.0, dx=50, dy=30))
        out = h.project(np.array([[50, 50]], np.float32))
        assert out[0] == pytest.approx([150, 130], abs=1.0)

    def test_identity_when_views_agree(self):
        h = FloorHomography.fit(square(), square())
        assert h.project(np.array([[37, 61]], np.float32))[0] == pytest.approx([37, 61], abs=1.0)

    def test_residual_is_reported(self):
        h = FloorHomography.fit(square(), square(scale=2.0))
        assert h.residual < 1.0
        assert h.points_used == 4

    def test_too_few_points(self):
        with pytest.raises(CalibrationError, match="at least 4"):
            FloorHomography.fit(square()[:3], square()[:3])

    def test_mismatched_counts(self):
        with pytest.raises(CalibrationError, match="source points"):
            FloorHomography.fit(square(), square()[:3])

    def test_four_points_cannot_be_validated(self):
        """Any four points map exactly onto any other four, so a zero residual
        from four points confirms nothing about the ordering."""
        h = FloorHomography.fit(square(), square(scale=2.0))
        assert h.residual < 1.0
        assert not h.validated

    def test_six_points_can_be(self):
        source = np.vstack([square(), [[30, 70]], [[80, 20]]]).astype(np.float32)
        target = (source * 1.5 + [20, 10]).astype(np.float32)
        h = FloorHomography.fit(source, target)
        assert h.validated and h.residual < 1.0

    def test_points_clicked_in_the_wrong_order_are_rejected(self):
        """The commonest installation mistake -- detectable only once the fit
        is over-determined."""
        source = np.vstack([square(), [[30, 70]], [[80, 20]]]).astype(np.float32)
        target = (source * 1.5 + [20, 10]).astype(np.float32)
        scrambled = target[[2, 0, 3, 1, 5, 4]]
        with pytest.raises(CalibrationError, match="different order"):
            FloorHomography.fit(source, scrambled)

    def test_duplicate_points_are_rejected(self):
        source = np.vstack([square(), square()[:1]]).astype(np.float32)
        target = np.vstack([square(scale=2.0), square(scale=2.0)[:1]]).astype(np.float32)
        with pytest.raises(CalibrationError, match="twice"):
            FloorHomography.fit(source, target)

    def test_round_trips_through_a_dict(self):
        h = FloorHomography.fit(square(), square(scale=1.5))
        back = FloorHomography.from_dict(h.to_dict())
        assert np.allclose(back.matrix, h.matrix)
        assert back.points_used == 4


class TestAssociation:
    def _identity(self):
        return FloorHomography.fit(square(), square())

    def test_matches_students_across_views(self):
        h = self._identity()
        a = [person(1, 100, 500), person(2, 400, 500), person(3, 700, 500)]
        b = [person(11, 105, 502), person(12, 398, 498), person(13, 703, 504)]
        pairs, left, right = associate(a, b, h)
        assert {(p.primary_id, p.secondary_id) for p in pairs} == {(1, 11), (2, 12), (3, 13)}
        assert left == [] and right == []

    def test_each_student_is_used_once(self):
        h = self._identity()
        a = [person(1, 400, 500), person(2, 410, 500)]
        b = [person(11, 405, 500)]
        pairs, left, _ = associate(a, b, h)
        assert len(pairs) == 1
        assert len(left) == 1

    def test_a_distant_candidate_is_not_forced(self):
        """A wrong association fuses two people's movement into one record."""
        h = self._identity()
        pairs, left, right = associate([person(1, 100, 500)], [person(11, 900, 500)], h)
        assert pairs == []
        assert left == [1] and right == [11]

    def test_students_without_visible_feet_are_unmatched(self):
        h = self._identity()
        a = [person(1, 400, 500, visible=False)]
        b = [person(11, 400, 500)]
        pairs, left, right = associate(a, b, h)
        assert pairs == [] and left == [1] and right == [11]

    def test_empty_views(self):
        h = self._identity()
        assert associate([], [], h) == ([], [], [])

    def test_extra_students_in_one_view(self):
        h = self._identity()
        a = [person(1, 100, 500)]
        b = [person(11, 102, 500), person(12, 700, 500)]
        pairs, left, right = associate(a, b, h)
        assert len(pairs) == 1 and left == [] and right == [12]

    def test_closest_pairing_wins(self):
        h = self._identity()
        a = [person(1, 400, 500), person(2, 600, 500)]
        b = [person(11, 610, 500), person(12, 405, 500)]
        pairs, _, _ = associate(a, b, h)
        assert {(p.primary_id, p.secondary_id) for p in pairs} == {(1, 12), (2, 11)}


class TestFusion:
    def test_frame_shape(self):
        a = np.ones(FEATURE_SIZE, np.float32)
        assert fuse_frame(a, a).shape == (FUSED_FEATURE_SIZE,)

    def test_validity_flags_mark_a_missing_view(self):
        a = np.ones(FEATURE_SIZE, np.float32)
        assert fuse_frame(a, None)[-2:].tolist() == [1.0, 0.0]
        assert fuse_frame(None, a)[-2:].tolist() == [0.0, 1.0]
        assert fuse_frame(a, a)[-2:].tolist() == [1.0, 1.0]

    def test_a_missing_view_contributes_zeros(self):
        a = np.ones(FEATURE_SIZE, np.float32)
        assert np.allclose(fuse_frame(a, None)[FEATURE_SIZE:FEATURE_SIZE * 2], 0.0)

    def test_both_views_missing_is_an_error(self):
        with pytest.raises(ValueError):
            fuse_frame(None, None)

    def test_window_fusion_summarises_each_view_separately(self):
        window = np.ones((24, FEATURE_SIZE), np.float32)
        out = fuse_window(window, window)
        assert out.shape == ((FEATURE_SIZE * 7 + 1) * 2,)

    def test_window_fusion_flags_a_missing_view(self):
        window = np.ones((24, FEATURE_SIZE), np.float32)
        out = fuse_window(window, None)
        per_view = FEATURE_SIZE * 7 + 1
        assert out[per_view - 1] == 1.0     # primary present
        assert out[-1] == 0.0               # secondary absent

    def test_two_views_carry_more_than_one(self):
        """The whole point: a second view adds information, not padding."""
        from pilates.classifier import window_features
        rng = np.random.default_rng(0)
        front = rng.normal(size=(24, FEATURE_SIZE)).astype(np.float32)
        side = rng.normal(size=(24, FEATURE_SIZE)).astype(np.float32)
        fused = fuse_window(front, side)
        single = window_features(front)
        assert len(fused) > len(single)
        assert not np.allclose(fused[:len(single)], fused[len(single) + 1:-1])
