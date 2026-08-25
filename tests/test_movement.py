import math

import pytest

from pilates.movement import (
    Repetition, TrackHistory, control_ratio, direction_changes, dominant_signal,
    find_repetitions, hold_durations, smooth, summarise,
)
from conftest import make_detection


def wave(cycles: int, amplitude: float, samples_per_cycle: int = 20, offset: float = 90.0):
    """A clean sinusoid: `cycles` repetitions of `amplitude` degrees peak-to-peak."""
    n = cycles * samples_per_cycle
    times = [i * 0.1 for i in range(n + 1)]
    values = [
        offset + (amplitude / 2) * math.sin(2 * math.pi * i / samples_per_cycle)
        for i in range(n + 1)
    ]
    return times, values


class TestSmooth:
    def test_window_of_one_is_a_passthrough(self):
        assert smooth([1.0, 5.0, 2.0], window=1) == [1.0, 5.0, 2.0]

    def test_short_series_is_untouched(self):
        assert smooth([1.0, 2.0], window=5) == [1.0, 2.0]

    def test_spike_is_flattened(self):
        spiky = [10.0] * 5 + [40.0] + [10.0] * 5
        assert max(smooth(spiky, 5)) < 40.0

    def test_length_is_preserved(self):
        assert len(smooth([float(i) for i in range(20)], 5)) == 20


class TestRepetitions:
    def test_counts_a_clean_set(self):
        times, values = wave(cycles=5, amplitude=60)
        reps = find_repetitions(times, values, min_range=15)
        assert len(reps) == pytest.approx(5, abs=1)

    def test_measures_range_of_motion(self):
        times, values = wave(cycles=4, amplitude=60)
        reps = find_repetitions(times, values, min_range=15)
        assert reps
        assert statistics_mean([r.range_of_motion for r in reps]) == pytest.approx(60, abs=8)

    def test_noise_does_not_become_repetitions(self):
        times = [i * 0.1 for i in range(120)]
        values = [90.0 + (2.0 if i % 2 else -2.0) for i in range(120)]
        assert find_repetitions(times, values, min_range=15) == []

    def test_movement_below_threshold_is_ignored(self):
        times, values = wave(cycles=5, amplitude=8)
        assert find_repetitions(times, values, min_range=15) == []

    def test_too_few_samples(self):
        assert find_repetitions([0.0, 0.1], [90.0, 95.0]) == []

    def test_rep_timings_are_ordered(self):
        times, values = wave(cycles=3, amplitude=50)
        for rep in find_repetitions(times, values, min_range=15):
            assert rep.start < rep.end
            assert rep.duration > 0


def statistics_mean(xs):
    return sum(xs) / len(xs)


class TestTempoRatio:
    def test_symmetric_rep(self):
        rep = Repetition(start=0, end=4, range_of_motion=50, out_duration=2, back_duration=2)
        assert rep.tempo_ratio == pytest.approx(1.0)

    def test_dropped_return_reads_below_one(self):
        rep = Repetition(start=0, end=3, range_of_motion=50, out_duration=2, back_duration=1)
        assert rep.tempo_ratio == pytest.approx(0.5)

    def test_no_out_phase_is_undefined(self):
        rep = Repetition(start=0, end=1, range_of_motion=50, out_duration=0, back_duration=1)
        assert rep.tempo_ratio is None


class TestControl:
    def test_clean_movement_scores_about_one(self):
        _, values = wave(cycles=4, amplitude=60)
        reps = len(find_repetitions(*wave(cycles=4, amplitude=60), min_range=15))
        assert control_ratio(values, reps) == pytest.approx(1.0, abs=0.4)

    def test_jittery_movement_scores_higher(self):
        times, clean = wave(cycles=4, amplitude=60)
        jittery = [v + (6.0 if i % 2 else -6.0) for i, v in enumerate(clean)]
        reps = len(find_repetitions(times, clean, min_range=15))
        assert control_ratio(jittery, reps) > control_ratio(clean, reps)

    def test_speed_does_not_change_the_score(self):
        """The flaw this replaced: a raw per-sample rate made fast repetitions
        look less controlled than slow ones."""
        scores = []
        for spc in (10, 20, 40):
            times, values = wave(cycles=4, amplitude=60, samples_per_cycle=spc)
            reps = len(find_repetitions(times, values, min_range=15))
            scores.append(control_ratio(values, reps))
        assert max(scores) - min(scores) < 0.4

    def test_undefined_without_repetitions(self):
        assert control_ratio([90.0] * 30, 0) is None

    def test_direction_changes_on_a_flat_signal(self):
        assert direction_changes([90.0] * 30) == 0

    def test_direction_changes_too_short(self):
        assert direction_changes([1.0, 2.0]) is None


class TestHolds:
    def test_finds_a_sustained_hold(self):
        times = [i * 0.1 for i in range(60)]
        values = [90.0] * 60
        holds = hold_durations(times, values, tolerance=5, minimum=1.0)
        assert holds and holds[0] == pytest.approx(5.9, abs=0.2)

    def test_continuous_movement_has_no_holds(self):
        times = [i * 0.1 for i in range(60)]
        values = [float(i * 3) for i in range(60)]
        assert hold_durations(times, values, tolerance=5, minimum=1.0) == []

    def test_brief_pause_is_not_a_hold(self):
        times = [i * 0.1 for i in range(10)]
        values = [90.0] * 4 + [130.0] * 6
        assert hold_durations(times, values, tolerance=5, minimum=1.0) == []


class TestHistoryAndSummary:
    def _history(self, n=60):
        history = TrackHistory(track_id=7)
        for i in range(n):
            # Knee opening and closing, everything else still.
            bend = 90 + 40 * math.sin(2 * math.pi * i / 20)
            det = make_detection(x=100, y=100, width=60, height=180)
            history.add(i * 0.1, det, 0.4)
            history.samples[-1].angles["left_knee"] = bend
            history.samples[-1].angles["right_knee"] = bend
        return history

    def test_series_skips_unmeasured_frames(self):
        history = TrackHistory(track_id=1)
        det = make_detection()
        history.add(0.0, det, 0.4)
        history.samples[-1].angles["left_knee"] = None
        history.add(0.1, det, 0.4)
        history.samples[-1].angles["left_knee"] = 100.0
        times, values = history.series("left_knee")
        assert times == [0.1] and values == [100.0]

    def test_duration_spans_the_samples(self):
        history = self._history(n=60)
        assert history.duration == pytest.approx(5.9, abs=0.01)

    def test_dominant_signal_picks_the_moving_joint(self):
        assert dominant_signal(self._history()) in ("left_knee", "right_knee")

    def test_summary_reports_repetitions(self):
        summary = summarise(self._history(n=100))
        assert summary is not None
        assert summary.track_id == 7
        assert summary.repetitions >= 3
        assert summary.mean_range == pytest.approx(80, abs=12)

    def test_summary_reports_symmetry(self):
        summary = summarise(self._history())
        assert summary.mean_symmetry["knee"] == pytest.approx(0.0, abs=1e-6)

    def test_summary_is_none_without_enough_data(self):
        history = TrackHistory(track_id=3)
        history.add(0.0, make_detection(), 0.4)
        assert summarise(history) is None


class TestSignalSelection:
    """Picking the widest-ranging joint selects an elbow on real mat footage,
    because arm keypoints are the least stable in the skeleton."""

    def _history_with(self, knee, elbow):
        history = TrackHistory(track_id=1)
        det = make_detection()
        for i, (k, e) in enumerate(zip(knee, elbow)):
            history.add(i * 0.1, det, 0.4)
            history.samples[-1].angles["left_knee"] = k
            history.samples[-1].angles["right_knee"] = k
            history.samples[-1].angles["left_elbow"] = e
            history.samples[-1].angles["right_elbow"] = e
            history.samples[-1].trunk = 90.0
        return history

    def test_purposeful_joint_beats_a_noisier_wider_one(self):
        n = 80
        knee = [90 + 25 * math.sin(2 * math.pi * i / 20) for i in range(n)]
        # Wider raw spread, but pure frame-to-frame jitter.
        elbow = [90 + (45 if i % 2 else -45) for i in range(n)]
        from pilates.movement import signal_quality
        assert signal_quality(elbow) < signal_quality(knee)
        assert dominant_signal(self._history_with(knee, elbow)) in ("left_knee", "right_knee")

    def test_still_joints_are_not_selected(self):
        n = 60
        knee = [90.0] * n
        elbow = [90.0] * n
        assert dominant_signal(self._history_with(knee, elbow)) is None

    def test_quality_is_zero_for_a_short_series(self):
        from pilates.movement import signal_quality
        assert signal_quality([1.0, 2.0]) == 0.0


class TestStaticStudents:
    """Half of mat work is isometric. A student who holds a position must be
    reported as holding it, not dropped and not given invented repetitions."""

    def _still_history(self, n=60):
        history = TrackHistory(track_id=5)
        det = make_detection(x=100, y=100)
        for i in range(n):
            history.add(i * 0.1, det, 0.4)
            for name in ("left_knee", "right_knee", "left_hip", "right_hip",
                         "left_elbow", "right_elbow"):
                history.samples[-1].angles[name] = 90.0
            history.samples[-1].trunk = 88.0
        return history

    def test_a_held_position_has_no_dominant_signal(self):
        assert dominant_signal(self._still_history()) is None

    def test_the_student_is_still_reported(self):
        summary = summarise(self._still_history())
        assert summary is not None
        assert summary.signal is None
        assert summary.repetitions == 0

    def test_no_invented_movement_numbers(self):
        summary = summarise(self._still_history())
        assert summary.mean_range is None
        assert summary.control_ratio is None

    def test_the_hold_is_measured(self):
        summary = summarise(self._still_history())
        assert summary.longest_hold is not None and summary.longest_hold > 1.0


class TestSignalConfidence:
    def test_confidence_is_carried_into_the_summary(self):
        history = TrackHistory(track_id=2)
        for i in range(60):
            det = make_detection(x=100, y=100)
            history.add(i * 0.1, det, 0.4)
            bend = 90 + 40 * math.sin(2 * math.pi * i / 20)
            history.samples[-1].angles["left_knee"] = bend
            history.samples[-1].angles["right_knee"] = bend
        summary = summarise(history)
        assert summary.signal_confidence > 0.5

    def test_low_confidence_signals_are_rejected(self):
        """A wide-ranging angle built on joints the model was unsure of is not
        evidence of movement."""
        history = TrackHistory(track_id=3)
        det = make_detection(x=100, y=100, confidence=0.2)
        for i in range(60):
            history.add(i * 0.1, det, 0.4)
            history.samples[-1].angles["left_knee"] = 90 + 40 * math.sin(2 * math.pi * i / 20)
        assert dominant_signal(history) is None


class TestSessionQuality:
    """Without this gate the session layer returns confident report cards for a
    room it never tracked -- output that looks plausible and describes nobody."""

    class _Result:
        def __init__(self, timestamp, people):
            self.timestamp = timestamp
            self.people = people

    def _person(self, track_id):
        from pilates.types import TrackedPerson
        return TrackedPerson(track_id=track_id, detection=make_detection(x=100, y=100))

    def _record(self, frames_of_ids):
        from pilates.movement import SessionRecorder
        recorder = SessionRecorder()
        for i, ids in enumerate(frames_of_ids):
            recorder.observe(self._Result(i * 0.1, [self._person(t) for t in ids]))
        return recorder

    def test_stable_class_is_reliable(self):
        quality = self._record([[1, 2, 3]] * 40).quality()
        assert quality.churn == pytest.approx(1.0)
        assert quality.coverage == pytest.approx(1.0)
        assert quality.reliable

    def test_churning_class_is_not_reliable(self):
        # Three people present, but a fresh identity every frame.
        frames = [[i * 3, i * 3 + 1, i * 3 + 2] for i in range(1, 41)]
        quality = self._record(frames).quality()
        assert quality.churn > 1.5
        assert not quality.reliable

    def test_explanation_names_the_problem(self):
        frames = [[i * 3, i * 3 + 1, i * 3 + 2] for i in range(1, 41)]
        text = self._record(frames).quality().explain()
        assert "too unstable" in text
        assert "fragment" in text

    def test_explanation_is_positive_when_sound(self):
        assert "sound" in self._record([[1, 2]] * 30).quality().explain()

    def test_empty_session_does_not_divide_by_zero(self):
        from pilates.movement import SessionRecorder
        quality = SessionRecorder().quality()
        assert quality.churn == 0.0 and quality.coverage == 0.0

    def test_coverage_reflects_short_tracks(self):
        # Each identity lives two frames of a twenty-frame clip.
        frames = [[i // 2] for i in range(20)]
        quality = self._record(frames).quality()
        assert quality.coverage < 0.2
