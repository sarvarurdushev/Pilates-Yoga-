import numpy as np
import pytest

from pilates.classifier import (
    ExerciseClassifier, evaluate, featurise, majority_baseline, window_features,
)

FRAMES, FEATURES = 24, 41
NAMES = ["mountain", "warrior_two"]


def held(value=0.5, frames=FRAMES):
    return np.full((frames, FEATURES), value, dtype=np.float32)


def moving(amplitude=1.0, frames=FRAMES, phase=0.0):
    t = np.linspace(0, 2 * np.pi, frames)
    base = np.sin(t + phase)[:, None] * amplitude
    return np.tile(base, (1, FEATURES)).astype(np.float32)


class TestWindowFeatures:
    def test_length_is_seven_statistics_per_feature(self):
        assert window_features(held()).shape == (FEATURES * 7,)

    def test_a_held_pose_has_no_motion(self):
        out = window_features(held())
        assert np.allclose(out[-FEATURES:], 0.0)

    def test_a_moving_pose_does(self):
        assert window_features(moving())[-FEATURES:].mean() > 0.01

    def test_motion_separates_poses_with_the_same_average(self):
        """A held pose and a movement swinging either side of it have the same
        mean. Only the motion statistic tells them apart."""
        still, swinging = held(0.0), moving(1.0)
        assert np.allclose(window_features(still)[:FEATURES],
                           window_features(swinging)[:FEATURES], atol=0.1)
        assert window_features(swinging)[-FEATURES:].mean() > \
               window_features(still)[-FEATURES:].mean()

    def test_rejects_a_non_window(self):
        with pytest.raises(ValueError):
            window_features(np.zeros(FEATURES, dtype=np.float32))

    def test_single_frame_window_is_safe(self):
        assert window_features(np.zeros((1, FEATURES), np.float32)).shape == (FEATURES * 7,)

    def test_featurise_stacks(self):
        assert featurise(np.stack([held(), moving()])).shape == (2, FEATURES * 7)


class TestBaseline:
    def test_reflects_the_biggest_class(self):
        assert majority_baseline(np.array([0, 0, 0, 1])) == pytest.approx(0.75)

    def test_balanced_two_class(self):
        assert majority_baseline(np.array([0, 1])) == pytest.approx(0.5)

    def test_empty(self):
        assert majority_baseline(np.array([], dtype=int)) == 0.0


class TestEvaluationProtocol:
    """The point of the split, demonstrated: build data where the label is
    predictable only from a per-student quirk, never from the movement. A
    random split scores well on it; holding students out cannot."""

    def _leaky_data(self, students=6, per_student=20):
        rng = np.random.default_rng(0)
        windows, labels, groups = [], [], []
        for student in range(students):
            label = student % 2
            # The signature identifies the student, not the exercise.
            signature = rng.normal(size=FEATURES) * 5.0
            for _ in range(per_student):
                w = np.tile(signature, (FRAMES, 1)) + rng.normal(scale=0.01, size=(FRAMES, FEATURES))
                windows.append(w.astype(np.float32))
                labels.append(label)
                groups.append(student)
        return featurise(np.stack(windows)), np.array(labels), np.array(groups)

    def test_random_split_is_fooled(self):
        features, labels, _ = self._leaky_data()
        assert evaluate(features, labels, NAMES, groups=None).accuracy > 0.9

    def test_holding_students_out_is_not(self):
        features, labels, groups = self._leaky_data()
        honest = evaluate(features, labels, NAMES, groups=groups).accuracy
        assert honest < 0.9

    def test_a_real_signal_survives_grouping(self):
        """The complement: when the label really is in the movement, holding
        students out should not destroy the score."""
        rng = np.random.default_rng(1)
        windows, labels, groups = [], [], []
        for student in range(6):
            for i in range(20):
                label = i % 2
                w = (moving(1.0) if label else held(0.0))
                w = w + rng.normal(scale=0.05, size=(FRAMES, FEATURES))
                windows.append(w.astype(np.float32))
                labels.append(label)
                groups.append(student)
        features = featurise(np.stack(windows))
        assert evaluate(features, np.array(labels), NAMES,
                        groups=np.array(groups)).accuracy > 0.9

    def test_reports_per_class_numbers(self):
        features, labels, groups = self._leaky_data()
        result = evaluate(features, labels, NAMES, groups=groups)
        assert set(result.per_class) == set(NAMES)
        assert result.confusion.shape == (2, 2)

    def test_a_single_group_cannot_be_held_out(self):
        features, labels, _ = self._leaky_data(students=1, per_student=20)
        result = evaluate(features, labels, NAMES, groups=np.zeros(len(labels), dtype=int))
        assert np.isnan(result.accuracy)
        assert "nothing to hold out" in result.note

    def test_format_is_readable(self):
        features, labels, groups = self._leaky_data()
        text = evaluate(features, labels, NAMES, groups=groups).format()
        assert "accuracy" in text and "mountain" in text


class TestClassifier:
    def _data(self, n=40):
        rng = np.random.default_rng(2)
        windows, labels = [], []
        for i in range(n):
            label = i % 2
            w = (moving(1.0) if label else held(0.0))
            windows.append((w + rng.normal(scale=0.05, size=(FRAMES, FEATURES))).astype(np.float32))
            labels.append(label)
        return np.stack(windows), np.array(labels)

    def test_fit_and_predict_names(self):
        windows, labels = self._data()
        model = ExerciseClassifier().fit(windows, labels, NAMES)
        assert set(model.predict(windows)) <= set(NAMES)

    def test_learns_a_separable_task(self):
        windows, labels = self._data()
        model = ExerciseClassifier().fit(windows, labels, NAMES)
        predicted = [NAMES.index(p) for p in model.predict(windows)]
        assert (np.array(predicted) == labels).mean() > 0.9

    def test_confidence_accompanies_predictions(self):
        windows, labels = self._data()
        model = ExerciseClassifier().fit(windows, labels, NAMES)
        for name, confidence in model.predict_with_confidence(windows):
            assert name in NAMES
            assert 0.0 <= confidence <= 1.0

    def test_predicting_before_fitting_is_an_error(self):
        with pytest.raises(RuntimeError):
            ExerciseClassifier().predict(np.zeros((1, FRAMES, FEATURES), np.float32))

    def test_round_trips_through_disk(self, tmp_path):
        windows, labels = self._data()
        path = str(tmp_path / "m.joblib")
        ExerciseClassifier().fit(windows, labels, NAMES).save(path)
        loaded = ExerciseClassifier.load(path)
        assert loaded.names == NAMES
        assert set(loaded.predict(windows)) <= set(NAMES)

    def test_forest_is_also_available(self):
        windows, labels = self._data()
        model = ExerciseClassifier(kind="forest").fit(windows, labels, NAMES)
        assert set(model.predict(windows)) <= set(NAMES)

    def test_unknown_model_is_rejected(self):
        with pytest.raises(ValueError):
            ExerciseClassifier(kind="transformer").fit(*self._data(), NAMES)
