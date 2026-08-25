import json

import pytest

from pilates.labels import (
    NON_EXERCISE, VOCABULARY, LabelError, LabelSet, Segment, scaffold,
)


def seg(start, end, exercise="downward_dog", notes=""):
    return Segment(start=start, end=end, exercise=exercise, notes=notes)


class TestSegment:
    def test_duration(self):
        assert seg(10, 25).duration == 15

    def test_contains_is_half_open(self):
        s = seg(10, 20)
        assert s.contains(10) and s.contains(19.9)
        assert not s.contains(20)      # belongs to whatever comes next
        assert not s.contains(9.9)

    def test_overlap_detection(self):
        assert seg(0, 10).overlaps(seg(5, 15))
        assert not seg(0, 10).overlaps(seg(10, 20))   # touching is not overlapping

    def test_structural_labels_are_not_exercises(self):
        assert seg(0, 5, "downward_dog").is_exercise
        assert not seg(0, 5, "transition").is_exercise
        assert not seg(0, 5, "instruction").is_exercise


class TestValidation:
    def _labels(self, segments, duration=120.0, extra=None):
        return LabelSet(video="c.mp4", duration=duration, segments=segments,
                        extra_vocabulary=extra or [])

    def test_a_good_file_has_no_problems(self):
        assert self._labels([seg(0, 30), seg(30, 60, "warrior_two")]).validate() == []

    def test_backwards_segment_is_caught(self):
        problems = self._labels([seg(40, 20)]).validate()
        assert any("before it starts" in p for p in problems)

    def test_segment_past_the_end_is_caught(self):
        problems = self._labels([seg(0, 300)], duration=120).validate()
        assert any("but the video is" in p for p in problems)

    def test_negative_start_is_caught(self):
        assert any("before the video does" in p for p in self._labels([seg(-5, 10)]).validate())

    def test_overlapping_segments_are_caught(self):
        problems = self._labels([seg(0, 40), seg(30, 60, "warrior_two")]).validate()
        assert any("overlaps" in p for p in problems)

    def test_unknown_exercise_is_caught(self):
        problems = self._labels([seg(0, 30, "interpretive_dance")]).validate()
        assert any("not in the vocabulary" in p for p in problems)

    def test_a_typo_gets_a_suggestion(self):
        """The failure this prevents is silent: three spellings of one pose
        become three classes and none of them has enough data."""
        problems = self._labels([seg(0, 30, "downward_dg")]).validate()
        assert any("Did you mean 'downward_dog'" in p for p in problems)

    def test_studio_specific_names_can_be_declared(self):
        labels = self._labels([seg(0, 30, "reformer_footwork")], extra=["reformer_footwork"])
        assert labels.validate() == []

    def test_every_problem_is_reported_at_once(self):
        problems = self._labels([seg(40, 20, "nonsense_pose")]).validate()
        assert len(problems) >= 2

    def test_check_raises_on_a_bad_file(self):
        with pytest.raises(LabelError):
            self._labels([seg(40, 20)]).check()

    def test_check_is_silent_on_a_good_one(self):
        self._labels([seg(0, 30)]).check()


class TestSummaries:
    def test_coverage_and_totals(self):
        labels = LabelSet(video="c.mp4", duration=100.0, segments=[
            seg(0, 30, "downward_dog"), seg(30, 50, "transition"), seg(50, 80, "warrior_two"),
        ])
        assert labels.labelled_seconds == 80
        assert labels.exercise_seconds == 60      # transition excluded
        assert labels.coverage == pytest.approx(0.8)

    def test_counts_are_ordered_by_time(self):
        labels = LabelSet(video="c.mp4", duration=100.0, segments=[
            seg(0, 10, "warrior_two"), seg(10, 50, "downward_dog"),
        ])
        assert list(labels.counts()) == ["downward_dog", "warrior_two"]

    def test_lookup_by_timestamp(self):
        labels = LabelSet(video="c.mp4", segments=[seg(0, 10), seg(10, 20, "warrior_two")])
        assert labels.at(5).exercise == "downward_dog"
        assert labels.at(15).exercise == "warrior_two"
        assert labels.at(25) is None


class TestRoundTrip:
    def test_saves_and_reloads(self, tmp_path):
        original = LabelSet(video="c.mp4", duration=60.0, size_bytes=123,
                            segments=[seg(0, 30, "teaser", "second set")],
                            extra_vocabulary=["reformer_footwork"], notes="tuesday")
        path = tmp_path / "l.json"
        original.save(path)
        loaded = LabelSet.load(path)
        assert loaded.video == "c.mp4"
        assert loaded.size_bytes == 123
        assert loaded.segments[0].exercise == "teaser"
        assert loaded.segments[0].notes == "second set"
        assert loaded.extra_vocabulary == ["reformer_footwork"]

    def test_the_file_is_human_editable(self, tmp_path):
        path = tmp_path / "l.json"
        LabelSet(video="c.mp4", segments=[seg(0, 30)]).save(path)
        data = json.loads(path.read_text())
        assert data["segments"][0]["start"] == 0
        assert data["segments"][0]["exercise"] == "downward_dog"


class TestScaffold:
    class _Shot:
        def __init__(self, a, b):
            self.start_seconds, self.end_seconds = a, b

    def test_one_segment_per_shot(self):
        labels = scaffold("c.mp4", [self._Shot(0, 30), self._Shot(30, 75)], 25.0, 75.0, 999)
        assert len(labels.segments) == 2
        assert labels.segments[1].start == 30

    def test_an_unfilled_scaffold_is_valid(self):
        """It must not fail validation before anyone has touched it."""
        labels = scaffold("c.mp4", [self._Shot(0, 30)], 25.0, 30.0, 999)
        assert labels.validate() == []

    def test_an_unfilled_scaffold_contributes_no_training_data(self):
        labels = scaffold("c.mp4", [self._Shot(0, 30)], 25.0, 30.0, 999)
        assert labels.exercise_seconds == 0.0
        assert all(s.exercise in NON_EXERCISE for s in labels.segments)

    def test_it_records_the_video_fingerprint(self):
        labels = scaffold("c.mp4", [self._Shot(0, 30)], 25.0, 30.0, 4242)
        assert labels.size_bytes == 4242
        assert labels.duration == 30.0


class TestContactSheetTimes:
    """Labelling a 31-second shot from one frame is how a standing back bend
    got recorded as an upward salute in this project's own dataset."""

    def test_samples_across_the_whole_segment(self):
        from pilates.labels import contact_sheet_times
        times = contact_sheet_times(Segment(60.0, 90.0, "mountain"), count=6)
        assert len(times) == 6
        assert times[0] < 61.0
        assert times[-1] > 89.0
        assert times == sorted(times)

    def test_stays_inside_the_segment(self):
        from pilates.labels import contact_sheet_times
        for t in contact_sheet_times(Segment(10.0, 20.0, "mountain"), count=8):
            assert 10.0 <= t <= 20.0

    def test_single_frame_takes_the_middle(self):
        from pilates.labels import contact_sheet_times
        assert contact_sheet_times(Segment(10.0, 20.0, "mountain"), count=1) == [15.0]

    def test_rejects_a_silly_count(self):
        from pilates.labels import contact_sheet_times
        with pytest.raises(ValueError):
            contact_sheet_times(Segment(10.0, 20.0, "mountain"), count=0)
