"""Exercise recognition, and an evaluation that does not lie about it.

The model here is deliberately modest: a window of pose features is reduced to
summary statistics and classified with a linear model. With a few hundred
labelled windows that is the right size of tool. A temporal network has far
more capacity than this data can constrain and would memorise the students
rather than learn the exercises, while reporting a beautiful training score.

The evaluation matters more than the model, because this data leaks in three
ways at once and a naive split hides all of them:

* **Overlapping windows.** Windows hop by less than their length, so
  neighbours share frames. Split at random and near-copies of the same moment
  land on both sides.
* **The same student.** One person appears in many windows. A model can
  recognise *them* -- their proportions, their clothing-independent posture --
  and score well without knowing anything about the exercise.
* **The same session.** One room, one camera, one lighting condition, one
  teacher's cueing. Everything incidental is shared.

So the honest question is never "can it classify a held-out window", it is
"can it classify a student it has never seen", and beyond that "a class it has
never seen". Both are reported, alongside the inflated random-split number, so
the gap is visible rather than assumed away.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

#: Statistics taken over each feature's trajectory through a window.
STATISTIC_NAMES = ("mean", "std", "min", "max", "first", "last", "motion")


def window_features(window: np.ndarray) -> np.ndarray:
    """Reduce one (frames, features) window to a fixed vector.

    Keeps what distinguishes exercises at this data size: the average pose,
    how much it varied, its extremes, where it started and ended, and how much
    movement there was. ``motion`` -- mean absolute frame-to-frame change --
    is what separates a held pose from a moving one when their average
    positions are similar.
    """
    if window.ndim != 2:
        raise ValueError(f"expected a (frames, features) window, got {window.shape}")
    deltas = np.abs(np.diff(window, axis=0)) if len(window) > 1 else np.zeros_like(window[:1])
    return np.concatenate([
        window.mean(axis=0),
        window.std(axis=0),
        window.min(axis=0),
        window.max(axis=0),
        window[0],
        window[-1],
        deltas.mean(axis=0),
    ]).astype(np.float32)


def featurise(windows: np.ndarray) -> np.ndarray:
    """Apply :func:`window_features` across a stack of windows."""
    return np.stack([window_features(w) for w in windows])


@dataclass
class Evaluation:
    """What a model scored, and under which split."""

    protocol: str
    accuracy: float
    per_class: dict[str, tuple[float, float, int]] = field(default_factory=dict)
    confusion: np.ndarray | None = None
    labels: list[str] = field(default_factory=list)
    folds: int = 0
    note: str = ""

    def format(self) -> str:
        lines = [f"{self.protocol}: {self.accuracy * 100:.1f}% accuracy"
                 + (f" over {self.folds} folds" if self.folds else "")]
        if self.note:
            lines.append(f"  {self.note}")
        if self.per_class:
            lines.append(f"  {'exercise':28s} {'precision':>10s} {'recall':>8s} {'n':>6s}")
            for name, (precision, recall, support) in self.per_class.items():
                lines.append(f"  {name:28s} {precision * 100:9.0f}% {recall * 100:7.0f}% {support:6d}")
        return "\n".join(lines)


def _score(y_true, y_pred, names) -> tuple[float, dict, np.ndarray]:
    from sklearn.metrics import confusion_matrix, precision_recall_fscore_support

    accuracy = float((y_true == y_pred).mean())
    precision, recall, _, support = precision_recall_fscore_support(
        y_true, y_pred, labels=range(len(names)), zero_division=0
    )
    per_class = {
        names[i]: (float(precision[i]), float(recall[i]), int(support[i]))
        for i in range(len(names))
    }
    return accuracy, per_class, confusion_matrix(y_true, y_pred, labels=range(len(names)))


def build_model(kind: str = "linear", seed: int = 0):
    """A scikit-learn pipeline sized for a few hundred examples."""
    from sklearn.ensemble import RandomForestClassifier
    from sklearn.linear_model import LogisticRegression
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import StandardScaler

    if kind == "forest":
        return RandomForestClassifier(
            n_estimators=300, min_samples_leaf=2, random_state=seed, n_jobs=-1
        )
    if kind != "linear":
        raise ValueError(f"unknown model {kind!r}; choose 'linear' or 'forest'")
    return make_pipeline(
        StandardScaler(),
        LogisticRegression(max_iter=2000, C=0.5, random_state=seed),
    )


def evaluate(
    features: np.ndarray,
    labels: np.ndarray,
    names: list[str],
    groups: np.ndarray | None = None,
    protocol: str = "grouped by student",
    kind: str = "linear",
    seed: int = 0,
) -> Evaluation:
    """Cross-validate, holding out whole groups rather than random windows.

    ``groups`` is what must not be split across the train/test boundary --
    student ids for the "unseen student" question, session ids for "unseen
    class". Pass None for the deliberately optimistic random split.
    """
    from sklearn.model_selection import GroupKFold, StratifiedKFold

    unique_groups = len(np.unique(groups)) if groups is not None else 0
    if groups is not None and unique_groups < 2:
        return Evaluation(
            protocol=protocol, accuracy=float("nan"), labels=names,
            note=f"only {unique_groups} group in the data -- nothing to hold out",
        )

    if groups is not None:
        folds = min(5, unique_groups)
        splitter = GroupKFold(n_splits=folds).split(features, labels, groups)
    else:
        counts = np.bincount(labels)
        folds = int(min(5, counts[counts > 0].min()))
        if folds < 2:
            return Evaluation(protocol=protocol, accuracy=float("nan"), labels=names,
                              note="a class has too few examples to split")
        splitter = StratifiedKFold(n_splits=folds, shuffle=True, random_state=seed).split(
            features, labels
        )

    truths: list[np.ndarray] = []
    predictions: list[np.ndarray] = []
    for train_idx, test_idx in splitter:
        if len(np.unique(labels[train_idx])) < 2:
            continue
        model = build_model(kind, seed)
        model.fit(features[train_idx], labels[train_idx])
        truths.append(labels[test_idx])
        predictions.append(model.predict(features[test_idx]))

    if not truths:
        return Evaluation(protocol=protocol, accuracy=float("nan"), labels=names,
                          note="no fold contained more than one exercise")

    y_true = np.concatenate(truths)
    y_pred = np.concatenate(predictions)
    accuracy, per_class, confusion = _score(y_true, y_pred, names)
    return Evaluation(
        protocol=protocol, accuracy=accuracy, per_class=per_class,
        confusion=confusion, labels=names, folds=folds,
    )


def majority_baseline(labels: np.ndarray) -> float:
    """Accuracy from always guessing the most common exercise.

    Any model that does not clear this has learned nothing, and on an
    unbalanced set a mediocre model can look respectable without it.
    """
    if len(labels) == 0:
        return 0.0
    return float(np.bincount(labels).max() / len(labels))


class ExerciseClassifier:
    """Fit, predict and persist an exercise recogniser."""

    def __init__(self, kind: str = "linear", seed: int = 0):
        self.kind = kind
        self.seed = seed
        self.model = None
        self.names: list[str] = []

    def fit(self, windows: np.ndarray, labels: np.ndarray, names: list[str]) -> "ExerciseClassifier":
        self.names = list(names)
        self.model = build_model(self.kind, self.seed)
        self.model.fit(featurise(windows), labels)
        return self

    def predict(self, windows: np.ndarray) -> list[str]:
        if self.model is None:
            raise RuntimeError("classifier has not been fitted")
        return [self.names[i] for i in self.model.predict(featurise(windows))]

    def predict_with_confidence(self, windows: np.ndarray) -> list[tuple[str, float]]:
        """Predictions paired with the model's probability.

        A recogniser that cannot say "I am not sure" will confidently name an
        exercise for footage of somebody adjusting their mat.
        """
        if self.model is None:
            raise RuntimeError("classifier has not been fitted")
        features = featurise(windows)
        probabilities = self.model.predict_proba(features)
        return [
            (self.names[int(np.argmax(row))], float(np.max(row))) for row in probabilities
        ]

    def save(self, path: str) -> None:
        import joblib

        joblib.dump({"model": self.model, "names": self.names, "kind": self.kind}, path)

    @classmethod
    def load(cls, path: str) -> "ExerciseClassifier":
        import joblib

        payload = joblib.load(path)
        classifier = cls(kind=payload.get("kind", "linear"))
        classifier.model = payload["model"]
        classifier.names = payload["names"]
        return classifier
