import pytest

from pilates.coaching import DEFAULT_STANDARDS, assess
from pilates.history import (
    LOWER_IS_BETTER, MIN_SESSIONS_FOR_TREND, HistoryStore, Measurement,
    SessionRecord, measure_session, progress_report,
)
from pilates.movement import TrackHistory
from conftest import make_detection


def history(angles: dict, frames=30, trunk=88.0, jitter=0.0):
    h = TrackHistory(track_id=1)
    det = make_detection(x=100, y=100)
    for i in range(frames):
        h.add(i * 0.1, det, 0.4)
        wobble = jitter * (1 if i % 2 else -1)
        for name, value in angles.items():
            h.samples[-1].angles[name] = value + wobble
        h.samples[-1].trunk = trunk
    return h


STRAIGHT = {"left_knee": 175.0, "right_knee": 175.0,
            "left_hip": 172.0, "right_hip": 172.0,
            "left_elbow": 170.0, "right_elbow": 170.0}


def record(student, date, subject_values, exercise="mountain", spread=2.0):
    return SessionRecord(
        student=student, date=date, exercise=exercise,
        measurements=[
            Measurement(subject=s, median=v, spread=spread, samples=30)
            for s, v in subject_values.items()
        ],
    )


class TestMeasurement:
    def test_spread_is_the_interquartile_range(self):
        m = Measurement.from_values("left_knee", [10, 20, 30, 40, 50, 60, 70, 80])
        assert m.median == pytest.approx(45.0)
        assert m.spread > 0

    def test_a_steady_value_has_no_spread(self):
        assert Measurement.from_values("left_knee", [90.0] * 20).spread == 0.0

    def test_too_few_values(self):
        assert Measurement.from_values("left_knee", [90.0, 91.0]) is None


class TestMeasureSession:
    def test_records_what_was_assessed(self):
        h = history(STRAIGHT)
        measurements = measure_session(h, assess(h, DEFAULT_STANDARDS["mountain"]))
        subjects = {m.subject for m in measurements}
        assert "left_knee" in subjects
        assert "knee symmetry" in subjects

    def test_spread_reflects_within_session_wobble(self):
        steady = history(STRAIGHT, jitter=0.0)
        wobbly = history(STRAIGHT, jitter=6.0)
        a = measure_session(steady, assess(steady, DEFAULT_STANDARDS["mountain"]))
        b = measure_session(wobbly, assess(wobbly, DEFAULT_STANDARDS["mountain"]))
        knee_a = next(m for m in a if m.subject == "left_knee")
        knee_b = next(m for m in b if m.subject == "left_knee")
        assert knee_b.spread > knee_a.spread


class TestStore:
    def test_round_trips(self, tmp_path):
        store = HistoryStore()
        store.add(record("Anna", "2026-01-05", {"left_knee": 170.0}))
        path = tmp_path / "h.json"
        store.save(path)
        loaded = HistoryStore.load(path)
        assert loaded.students() == ["Anna"]
        assert loaded.records[0].measurements[0].median == 170.0

    def test_missing_file_is_an_empty_store(self, tmp_path):
        assert HistoryStore.load(tmp_path / "nope.json").records == []

    def test_sessions_come_back_oldest_first(self):
        store = HistoryStore()
        store.add(record("Anna", "2026-03-01", {"left_knee": 1.0}))
        store.add(record("Anna", "2026-01-01", {"left_knee": 2.0}))
        assert [r.date for r in store.for_student("Anna")] == ["2026-01-01", "2026-03-01"]

    def test_students_are_kept_apart(self):
        store = HistoryStore()
        store.add(record("Anna", "2026-01-01", {"left_knee": 1.0}))
        store.add(record("Ben", "2026-01-01", {"left_knee": 2.0}))
        assert store.students() == ["Anna", "Ben"]
        assert len(store.for_student("Anna")) == 1

    def test_exercises_are_kept_apart(self):
        """A knee angle in a plank is not comparable with one in a warrior two."""
        store = HistoryStore()
        store.add(record("Anna", "2026-01-01", {"left_knee": 175.0}, exercise="plank"))
        store.add(record("Anna", "2026-01-08", {"left_knee": 95.0}, exercise="warrior_two"))
        assert len(store.for_student("Anna", "plank")) == 1
        assert store.exercises_for("Anna") == ["plank", "warrior_two"]


class TestTrends:
    """Two numbers that differ by less than the measurement wobbles inside a
    single class are not progress."""

    def _store(self, values, spread=2.0, subject="hip symmetry"):
        store = HistoryStore()
        for i, v in enumerate(values):
            store.add(record("Anna", f"2026-01-{i + 1:02d}", {subject: v}, spread=spread))
        return store

    def test_two_sessions_is_not_a_trend(self):
        trend = self._store([20.0, 5.0]).trends("Anna", "mountain")[0]
        assert trend.verdict == "too few sessions"
        assert not trend.meaningful

    def test_a_change_inside_the_noise_floor_is_not_a_change(self):
        trend = self._store([12.0, 11.0, 10.5], spread=6.0).trends("Anna", "mountain")[0]
        assert trend.verdict == "no measurable change"
        assert not trend.meaningful

    def test_a_change_clearing_the_noise_floor_counts(self):
        trend = self._store([20.0, 14.0, 6.0], spread=2.0).trends("Anna", "mountain")[0]
        assert trend.verdict == "improved"
        assert trend.meaningful

    def test_direction_is_respected_for_asymmetry(self):
        assert "hip symmetry" in LOWER_IS_BETTER
        worse = self._store([5.0, 12.0, 20.0], spread=2.0).trends("Anna", "mountain")[0]
        assert worse.verdict == "worsened"

    def test_a_plain_angle_gets_no_good_or_bad_direction(self):
        """There is no universal right direction for a knee angle, so only the
        size of the change is asserted."""
        trend = self._store([150.0, 160.0, 175.0], spread=2.0,
                            subject="left_knee").trends("Anna", "mountain")[0]
        assert trend.verdict == "changed"

    def test_noise_floor_is_the_typical_within_session_spread(self):
        trend = self._store([20.0, 14.0, 6.0], spread=3.0).trends("Anna", "mountain")[0]
        assert trend.noise == pytest.approx(3.0)

    def test_describe_explains_a_null_result(self):
        trend = self._store([12.0, 11.0, 10.5], spread=6.0).trends("Anna", "mountain")[0]
        assert "no measurable change" in trend.describe()
        assert "inside a single" in trend.describe()

    def test_describe_says_how_many_sessions_are_needed(self):
        text = self._store([20.0, 5.0]).trends("Anna", "mountain")[0].describe()
        assert str(MIN_SESSIONS_FOR_TREND) in text


class TestReport:
    def test_no_sessions(self):
        assert "No sessions recorded" in progress_report(HistoryStore(), "Anna", "mountain")

    def test_lists_the_dates(self):
        store = HistoryStore()
        for i in range(3):
            store.add(record("Anna", f"2026-01-{i + 1:02d}", {"hip symmetry": 10.0}))
        text = progress_report(store, "Anna", "mountain")
        assert "2026-01-01" in text and "3 session(s)" in text

    def test_reports_a_real_improvement(self):
        store = HistoryStore()
        for i, v in enumerate((20.0, 13.0, 5.0)):
            store.add(record("Anna", f"2026-01-{i + 1:02d}", {"hip symmetry": v}))
        text = progress_report(store, "Anna", "mountain")
        assert "Real change:" in text and "improved" in text

    def test_says_plainly_when_nothing_moved(self):
        store = HistoryStore()
        for i, v in enumerate((12.0, 11.5, 12.5)):
            store.add(record("Anna", f"2026-01-{i + 1:02d}", {"hip symmetry": v}, spread=5.0))
        text = progress_report(store, "Anna", "mountain")
        assert "Nothing has moved" in text


class TestPracticalFloor:
    """A very steady student has a tiny noise floor, which would otherwise let a
    one-degree drift qualify as progress: true of the arithmetic, useless to the
    person being told."""

    def _store(self, values, spread, subject="left_knee"):
        store = HistoryStore()
        for i, v in enumerate(values):
            store.add(record("Anna", f"2026-01-{i + 1:02d}", {subject: v}, spread=spread))
        return store

    def test_a_tiny_change_is_not_progress_however_steady_the_student(self):
        from pilates.history import MIN_PRACTICAL_CHANGE
        trend = self._store([85.0, 85.6, 86.2], spread=0.4).trends("Anna", "mountain")[0]
        assert abs(trend.change) < MIN_PRACTICAL_CHANGE
        assert trend.verdict == "no measurable change"

    def test_the_explanation_names_the_practical_floor(self):
        trend = self._store([85.0, 85.6, 86.2], spread=0.4).trends("Anna", "mountain")[0]
        assert "worth mentioning" in trend.describe()

    def test_a_real_change_still_counts_for_a_steady_student(self):
        trend = self._store([150.0, 162.0, 175.0], spread=0.4).trends("Anna", "mountain")[0]
        assert trend.verdict == "changed"

    def test_a_wobbly_student_needs_a_bigger_change(self):
        """Noise floor still governs when it is the larger of the two."""
        trend = self._store([20.0, 16.0, 12.0], spread=12.0,
                            subject="hip symmetry").trends("Anna", "mountain")[0]
        assert trend.verdict == "no measurable change"
        assert "inside a single session" in trend.describe()
