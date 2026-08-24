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
