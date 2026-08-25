import numpy as np
import pytest

from pilates.config import StudioConfig
from pilates.filters import ExclusionZone
from pilates.pipeline import Pipeline
from pilates.pose import StubBackend
from pilates.tracking import TrackerConfig
from conftest import make_detection

BLANK = np.zeros((1080, 1920, 3), dtype=np.uint8)


def build(frames, **kwargs):
    config = StudioConfig(tracker=TrackerConfig(min_hits=1, max_misses=5), **kwargs)
    return Pipeline(config=config, backend=StubBackend(frames))


def drive(pipeline, n):
    return [pipeline.process_frame(BLANK, i, i / 30.0) for i in range(n)]


class TestEndToEnd:
    def test_two_students_are_tracked(self):
        frames = [[make_detection(x=600, y=400), make_detection(x=1100, y=400)] for _ in range(6)]
        results = drive(build(frames), 6)
        assert all(r.n_people == 2 for r in results)
        assert {p.track_id for p in results[-1].people} == {1, 2}

    def test_mirror_reflection_never_becomes_a_student(self):
        """The headline failure from the real-footage benchmark."""
        mirror = ExclusionZone("left_mirror", (0, 0, 430, 1080))
        frames = [
            [
                make_detection(x=80, y=200, width=60, height=400, confidence=0.81),   # reflection
                make_detection(x=900, y=200, width=60, height=400, confidence=0.77),  # real
            ]
            for _ in range(6)
        ]
        results = drive(build(frames, exclusion_zones=[mirror]), 6)
        assert all(r.n_people == 1 for r in results)
        assert all(r.n_excluded == 1 for r in results)
        assert {p.track_id for r in results for p in r.people} == {1}

    def test_duplicate_skeleton_does_not_create_a_second_student(self):
        frames = [
            [
                make_detection(x=900, y=400, width=60, height=200, confidence=0.70),
                make_detection(x=904, y=402, width=60, height=200, confidence=0.66),
            ]
            for _ in range(6)
        ]
        results = drive(build(frames), 6)
        assert all(r.n_people == 1 for r in results)
        assert all(r.n_duplicates == 1 for r in results)

    def test_sparse_skeleton_is_discarded(self):
        frames = [[make_detection(x=900, visible=3)] for _ in range(4)]
        results = drive(build(frames, min_visible_keypoints=8), 4)
        assert all(r.n_people == 0 for r in results)

    def test_reflection_and_duplicate_together(self):
        mirror = ExclusionZone("left_mirror", (0, 0, 430, 1080))
        frames = [
            [
                make_detection(x=80, y=200, width=60, height=400, confidence=0.81),
                make_detection(x=900, y=200, width=60, height=400, confidence=0.77),
                make_detection(x=905, y=203, width=60, height=400, confidence=0.72),
            ]
            for _ in range(6)
        ]
        results = drive(build(frames, exclusion_zones=[mirror]), 6)
        assert all(r.n_people == 1 for r in results)


class TestStats:
    def test_counters_add_up(self):
        mirror = ExclusionZone("left_mirror", (0, 0, 430, 1080))
        frames = [
            [
                make_detection(x=80, y=200, width=60, height=400),
                make_detection(x=900, y=200, width=60, height=400, confidence=0.8),
                make_detection(x=903, y=202, width=60, height=400, confidence=0.7),
            ]
            for _ in range(5)
        ]
        pipeline = build(frames, exclusion_zones=[mirror])
        drive(pipeline, 5)
        stats = pipeline.stats
        assert stats.frames == 5
        assert stats.raw_detections == 15
        assert stats.excluded == 5
        assert stats.duplicates == 5
        assert stats.exclusion_rate == 1 / 3
        assert stats.duplicate_rate == 1 / 3

    def test_reset_clears_state(self):
        frames = [[make_detection(x=900)] for _ in range(4)]
        pipeline = build(frames)
        drive(pipeline, 2)
        pipeline.reset()
        assert pipeline.stats.frames == 0


class TestConfigRoundTrip:
    def test_serialises_and_reloads(self, tmp_path):
        config = StudioConfig(
            name="fitzrovia",
            exclusion_zones=[ExclusionZone("left_mirror", (0, 0, 430, 1080), 0.5)],
        )
        path = tmp_path / "studio.json"
        config.save(path)
        loaded = StudioConfig.load(path)
        assert loaded.name == "fitzrovia"
        assert len(loaded.exclusion_zones) == 1
        assert loaded.exclusion_zones[0].name == "left_mirror"
        assert loaded.exclusion_zones[0].box == (0.0, 0.0, 430.0, 1080.0)
        assert loaded.exclusion_zones[0].min_overlap == 0.5

    def test_tracker_threshold_follows_studio_threshold(self):
        config = StudioConfig(keypoint_threshold=0.55)
        assert config.tracker.keypoint_threshold == 0.55


class TestTiling:
    """Tiling exists because RTMO's ONNX input is fixed at 640x640, so distant
    students in a wide shot of a full class are downsampled out of existence."""

    def test_disabled_by_default(self):
        assert StudioConfig().tiling_enabled is False

    def test_enabled_when_a_grid_is_set(self):
        assert StudioConfig(tile_cols=3, tile_rows=3).tiling_enabled is True

    def test_tiles_cover_the_whole_frame(self):
        from pilates.pose import TiledBackend
        tiled = TiledBackend(StubBackend([]), cols=3, rows=3, overlap=0.0)
        tiles = list(tiled._tiles(900, 600))
        assert len(tiles) == 9
        assert min(t[0] for t in tiles) == 0
        assert max(t[2] for t in tiles) == 900
        assert max(t[3] for t in tiles) == 600

    def test_overlap_widens_tiles(self):
        from pilates.pose import TiledBackend
        plain = list(TiledBackend(StubBackend([]), cols=2, rows=1, overlap=0.0)._tiles(800, 400))
        lapped = list(TiledBackend(StubBackend([]), cols=2, rows=1, overlap=0.25)._tiles(800, 400))
        assert (lapped[0][2] - lapped[0][0]) > (plain[0][2] - plain[0][0])

    def test_keypoints_are_mapped_back_to_frame_coordinates(self):
        from pilates.pose import TiledBackend

        class OneCentredDetection:
            """Returns a detection at a fixed spot inside whatever crop it is given."""
            def __call__(self, crop):
                return [make_detection(x=10, y=10, width=20, height=40)]

        tiled = TiledBackend(OneCentredDetection(), cols=2, rows=1, scale=2.0, overlap=0.0)
        out = tiled(np.zeros((400, 800, 3), dtype=np.uint8))
        assert len(out) == 2
        # Whatever the local box is, tile 0 sits at x=0 and tile 1 at x=400,
        # and scale 2 halves the local offset before the tile origin is added.
        local_x0 = make_detection(x=10, y=10, width=20, height=40).bbox(0.4)[0]
        xs = sorted(d.bbox(0.4)[0] for d in out)
        assert xs[0] == pytest.approx(local_x0 / 2.0)
        assert xs[1] == pytest.approx(local_x0 / 2.0 + 400.0)

    def test_rejects_bad_parameters(self):
        from pilates.pose import TiledBackend
        with pytest.raises(ValueError):
            TiledBackend(StubBackend([]), cols=0)
        with pytest.raises(ValueError):
            TiledBackend(StubBackend([]), scale=0)
        with pytest.raises(ValueError):
            TiledBackend(StubBackend([]), overlap=0.5)
