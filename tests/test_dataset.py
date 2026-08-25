import numpy as np
import pytest

from pilates import keypoints as kp
from pilates.dataset import (
    FEATURE_SIZE, Example, _resample, feature_vector, normalise_keypoints,
    summarise_dataset, save_dataset, windows_for_track,
)
from pilates.labels import Segment
from pilates.movement import TrackHistory
from pilates.types import Detection
from conftest import make_detection


class TestNormalisation:
    """Raw pixel coordinates encode mat position and distance from the camera.
    A model trained on them learns the room, not the movement."""

    def test_same_pose_at_different_positions_matches(self):
        near = normalise_keypoints(make_detection(x=100, y=100, width=60, height=180))
        far = normalise_keypoints(make_detection(x=900, y=300, width=60, height=180))
        assert np.allclose(near, far, atol=1e-5)

    def test_same_pose_at_different_scales_matches(self):
        # Scale the actual geometry rather than the helper's width/height,
        # which keeps some arm offsets fixed and so is not a similar pose.
        small = make_detection(x=100, y=100, width=60, height=180)
        big = Detection(small.keypoints * 2.5, small.scores)
        assert np.allclose(normalise_keypoints(big), normalise_keypoints(small), atol=1e-5)

    def test_scale_and_position_together(self):
        small = make_detection(x=100, y=100, width=60, height=180)
        moved = Detection(small.keypoints * 1.8 + np.array([420.0, -60.0], np.float32),
                          small.scores)
        assert np.allclose(normalise_keypoints(moved), normalise_keypoints(small), atol=1e-5)

    def test_different_poses_do_not_match(self):
        standing = normalise_keypoints(make_detection(lying=False))
        lying = normalise_keypoints(make_detection(lying=True))
        assert not np.allclose(standing, lying, atol=0.1)

    def test_hips_land_at_the_origin(self):
        out = normalise_keypoints(make_detection())
        hips = (out[kp.L_HIP] + out[kp.R_HIP]) / 2
        assert np.allclose(hips, [0.0, 0.0], atol=1e-5)

    def test_none_without_a_visible_torso(self):
        det = make_detection()
        scores = det.scores.copy()
        scores[kp.L_HIP] = 0.05
        assert normalise_keypoints(Detection(det.keypoints, scores)) is None

    def test_none_when_the_torso_has_no_length(self):
        points = np.zeros((kp.NUM_KEYPOINTS, 2), dtype=np.float32)
        det = Detection(points, np.ones(kp.NUM_KEYPOINTS, dtype=np.float32))
        assert normalise_keypoints(det) is None


class TestFeatureVector:
    def test_shape_is_fixed(self):
        assert feature_vector(make_detection()).shape == (FEATURE_SIZE,)

    def test_position_invariant(self):
        a = feature_vector(make_detection(x=100, y=100))
        b = feature_vector(make_detection(x=800, y=400))
        assert np.allclose(a, b, atol=1e-5)

    def test_none_without_a_torso(self):
        det = make_detection()
        scores = det.scores.copy()
        scores[kp.R_SHOULDER] = 0.0
        assert feature_vector(Detection(det.keypoints, scores)) is None

    def test_values_stay_in_a_sane_range(self):
        v = feature_vector(make_detection())
        assert np.all(np.abs(v) < 20.0)


class TestResample:
    def test_stretches_a_short_window(self):
        out = _resample([np.full(FEATURE_SIZE, float(i)) for i in range(5)], 24)
        assert out.shape == (24, FEATURE_SIZE)

    def test_squeezes_a_long_window(self):
        out = _resample([np.full(FEATURE_SIZE, float(i)) for i in range(60)], 24)
        assert out.shape == (24, FEATURE_SIZE)

    def test_exact_length_is_untouched(self):
        frames = [np.full(FEATURE_SIZE, float(i)) for i in range(24)]
        assert np.allclose(_resample(frames, 24), np.stack(frames))

    def test_endpoints_are_preserved(self):
        out = _resample([np.full(FEATURE_SIZE, float(i)) for i in range(10)], 24)
        assert out[0][0] == pytest.approx(0.0)
        assert out[-1][0] == pytest.approx(9.0)


class TestWindowing:
    def _track(self, start=0.0, end=12.0, step=0.1):
        history = TrackHistory(track_id=3)
        detections = {}
        t = start
        while t < end:
            det = make_detection(x=100, y=100)
            history.add(t, det, 0.4)
            detections[t] = det
            t = round(t + step, 3)
        return history, detections

    def test_windows_tile_the_segment(self):
        history, detections = self._track()
        out = windows_for_track(history, detections, Segment(0, 12, "downward_dog"),
                                window_seconds=3, hop_seconds=3, frames_per_window=24)
        assert len(out) == 4
        assert all(e.features.shape == (24, FEATURE_SIZE) for e in out)

    def test_overlapping_hops_produce_more_windows(self):
        history, detections = self._track()
        dense = windows_for_track(history, detections, Segment(0, 12, "downward_dog"),
                                  window_seconds=3, hop_seconds=1.5, frames_per_window=24)
        assert len(dense) > 4

    def test_no_window_straddles_the_segment_end(self):
        """A window spanning two exercises carries both and is labelled one."""
        history, detections = self._track()
        out = windows_for_track(history, detections, Segment(0, 10, "downward_dog"),
                                window_seconds=3, hop_seconds=3, frames_per_window=24)
        assert all(e.end <= 10 + 1e-6 for e in out)

    def test_the_label_is_carried(self):
        history, detections = self._track()
        out = windows_for_track(history, detections, Segment(0, 12, "warrior_two"),
                                window_seconds=3, hop_seconds=3, frames_per_window=24)
        assert {e.label for e in out} == {"warrior_two"}
        assert {e.track_id for e in out} == {3}

    def test_a_student_absent_from_the_segment_contributes_nothing(self):
        history, detections = self._track(start=100.0, end=112.0)
        out = windows_for_track(history, detections, Segment(0, 12, "downward_dog"),
                                window_seconds=3, hop_seconds=3, frames_per_window=24)
        assert out == []

    def test_sparse_coverage_is_dropped_not_padded(self):
        history = TrackHistory(track_id=1)
        detections = {}
        for t in (0.0, 0.1, 5.9, 6.0):     # present at the edges only
            det = make_detection(x=100, y=100)
            history.add(t, det, 0.4)
            detections[t] = det
        out = windows_for_track(history, detections, Segment(0, 6, "downward_dog"),
                                window_seconds=3, hop_seconds=3, frames_per_window=24)
        assert len(out) <= 1


class TestDatasetIO:
    def _examples(self):
        return [
            Example(np.zeros((24, FEATURE_SIZE), np.float32), "downward_dog", 1, 0.0, 3.0),
            Example(np.ones((24, FEATURE_SIZE), np.float32), "downward_dog", 2, 0.0, 3.0),
            Example(np.ones((24, FEATURE_SIZE), np.float32), "warrior_two", 1, 3.0, 6.0),
        ]

    def test_counts_are_ordered(self):
        assert list(summarise_dataset(self._examples())) == ["downward_dog", "warrior_two"]

    def test_saves_a_loadable_archive(self, tmp_path):
        path = tmp_path / "d.npz"
        save_dataset(self._examples(), str(path))
        data = np.load(path, allow_pickle=False)
        assert data["features"].shape == (3, 24, FEATURE_SIZE)
        assert list(data["label_names"]) == ["downward_dog", "warrior_two"]
        assert data["labels"].tolist() == [0, 0, 1]
        assert data["track_ids"].tolist() == [1, 2, 1]

    def test_empty_dataset_is_refused(self, tmp_path):
        with pytest.raises(ValueError):
            save_dataset([], str(tmp_path / "d.npz"))
