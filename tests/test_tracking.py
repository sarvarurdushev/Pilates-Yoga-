from pilates.tracking import IoUTracker, TrackerConfig
from conftest import make_detection

FAST = TrackerConfig(min_hits=1, max_misses=5)


def run(tracker, frames):
    """Feed a list of detection-lists and return the reported people per frame."""
    return [tracker.update(dets) for dets in frames]


class TestIdentity:
    def test_a_still_student_keeps_one_id(self):
        tracker = IoUTracker(FAST)
        det = make_detection(x=100, y=100)
        out = run(tracker, [[det]] * 10)
        ids = {p.track_id for frame in out for p in frame}
        assert ids == {1}

    def test_a_drifting_student_keeps_their_id(self):
        tracker = IoUTracker(FAST)
        frames = [[make_detection(x=100 + i * 3, y=100)] for i in range(12)]
        out = run(tracker, frames)
        ids = {p.track_id for frame in out for p in frame}
        assert ids == {1}

    def test_two_students_get_distinct_stable_ids(self):
        tracker = IoUTracker(FAST)
        frames = [
            [make_detection(x=100, y=100), make_detection(x=800, y=100)]
            for _ in range(8)
        ]
        out = run(tracker, frames)
        for frame in out:
            assert {p.track_id for p in frame} == {1, 2}

    def test_ids_are_not_swapped_between_neighbours(self):
        tracker = IoUTracker(FAST)
        left_ids, right_ids = set(), set()
        for _ in range(10):
            people = tracker.update(
                [make_detection(x=100, y=100), make_detection(x=400, y=100)]
            )
            by_x = sorted(people, key=lambda p: p.detection.centroid(0.4)[0])
            left_ids.add(by_x[0].track_id)
            right_ids.add(by_x[1].track_id)
        assert len(left_ids) == 1 and len(right_ids) == 1
        assert left_ids != right_ids


class TestOcclusion:
    def test_id_survives_a_brief_disappearance(self):
        tracker = IoUTracker(TrackerConfig(min_hits=1, max_misses=10))
        det = make_detection(x=100, y=100)
        run(tracker, [[det]] * 5)
        run(tracker, [[]] * 3)              # hidden behind the front row
        after = tracker.update([det])
        assert [p.track_id for p in after] == [1]

    def test_id_is_retired_after_a_long_absence(self):
        tracker = IoUTracker(TrackerConfig(min_hits=1, max_misses=3))
        det = make_detection(x=100, y=100)
        run(tracker, [[det]] * 4)
        run(tracker, [[]] * 6)              # left the room
        after = tracker.update([det])
        assert [p.track_id for p in after] == [2]


class TestConfirmation:
    def test_single_frame_flicker_is_not_reported(self):
        tracker = IoUTracker(TrackerConfig(min_hits=3, max_misses=5))
        assert tracker.update([make_detection(x=100)]) == []

    def test_track_is_reported_once_confirmed(self):
        tracker = IoUTracker(TrackerConfig(min_hits=3, max_misses=5))
        det = make_detection(x=100)
        assert tracker.update([det]) == []
        assert tracker.update([det]) == []
        assert len(tracker.update([det])) == 1

    def test_new_arrival_gets_the_next_id(self):
        tracker = IoUTracker(FAST)
        run(tracker, [[make_detection(x=100)]] * 3)
        people = tracker.update([make_detection(x=100), make_detection(x=900)])
        assert sorted(p.track_id for p in people) == [1, 2]


class TestLifecycle:
    def test_reset_clears_ids(self):
        tracker = IoUTracker(FAST)
        run(tracker, [[make_detection(x=100)]] * 3)
        tracker.reset()
        people = tracker.update([make_detection(x=100)])
        assert [p.track_id for p in people] == [1]

    def test_empty_input_is_safe(self):
        assert IoUTracker(FAST).update([]) == []

    def test_hits_accumulate(self):
        tracker = IoUTracker(FAST)
        det = make_detection(x=100)
        out = run(tracker, [[det]] * 5)
        assert out[-1][0].hits == 5


import numpy as np

from pilates.appearance import DESCRIPTOR_SIZE


def wearing(colour: int):
    """A one-hot appearance descriptor standing in for a distinct outfit."""
    d = np.zeros(DESCRIPTOR_SIZE, dtype=np.float32)
    d[colour] = 1.0
    return d


def dressed(colour: int, **kw):
    return make_detection(**kw).with_appearance(wearing(colour))


APPEARANCE = TrackerConfig(min_hits=1, max_misses=5, appearance_weight=0.5, min_iou_gate=0.1)
GEOMETRY_ONLY = TrackerConfig(min_hits=1, max_misses=5, appearance_weight=0.0)


def ids_by_colour(people, tracker_view):
    return {tracker_view[p.track_id]: p.track_id for p in people}


class TestAppearanceMatching:
    """Box overlap alone cannot separate students standing shoulder to
    shoulder; clothing colour breaks the tie."""

    def test_crossing_students_keep_their_own_ids(self):
        tracker = IoUTracker(APPEARANCE)
        # Establish: red on the left, blue on the right, boxes close enough
        # that each will overlap the other's next position.
        first = tracker.update([
            dressed(0, x=100, y=100, width=80, height=180),
            dressed(9, x=150, y=100, width=80, height=180),
        ])
        red_id = [p.track_id for p in first if p.detection.appearance[0] == 1.0][0]
        blue_id = [p.track_id for p in first if p.detection.appearance[9] == 1.0][0]
        assert red_id != blue_id

        # They swap places. Geometry alone would hand each ID to the other.
        second = tracker.update([
            dressed(0, x=150, y=100, width=80, height=180),
            dressed(9, x=100, y=100, width=80, height=180),
        ])
        now_red = [p.track_id for p in second if p.detection.appearance[0] == 1.0][0]
        now_blue = [p.track_id for p in second if p.detection.appearance[9] == 1.0][0]
        assert now_red == red_id
        assert now_blue == blue_id

    def test_colour_alone_cannot_match_across_the_room(self):
        """The spatial gate: same outfit, opposite ends of the studio."""
        tracker = IoUTracker(APPEARANCE)
        run(tracker, [[dressed(0, x=100, y=100)]] * 3)
        people = tracker.update([dressed(0, x=1400, y=100)])
        # A brand-new track, not the original teleported across the frame.
        assert [p.track_id for p in people] == [] or people[0].track_id != 1

    def test_missing_descriptors_fall_back_to_geometry(self):
        tracker = IoUTracker(APPEARANCE)
        det = make_detection(x=100, y=100)  # no appearance attached
        out = run(tracker, [[det]] * 5)
        assert {p.track_id for frame in out for p in frame} == {1}

    def test_weight_zero_ignores_clothing_entirely(self):
        tracker = IoUTracker(GEOMETRY_ONLY)
        out = run(tracker, [[dressed(0, x=100, y=100)], [dressed(9, x=100, y=100)]])
        # Same position, opposite outfits: pure geometry keeps one identity.
        assert {p.track_id for frame in out for p in frame} == {1}

    def test_appearance_model_is_seeded_on_creation(self):
        tracker = IoUTracker(APPEARANCE)
        tracker.update([dressed(3, x=100, y=100)])
        assert tracker.active_tracks[0].appearance is not None

    def test_sparse_room_is_unaffected_by_the_default(self):
        """Two well-separated students track identically with and without
        appearance -- the measured no-regression result."""
        for config in (APPEARANCE, GEOMETRY_ONLY):
            tracker = IoUTracker(config)
            frames = [[dressed(0, x=100, y=100), dressed(9, x=900, y=100)] for _ in range(6)]
            out = run(tracker, frames)
            assert all({p.track_id for p in f} == {1, 2} for f in out)
