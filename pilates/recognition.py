"""Naming an exercise, and being useful when it cannot be named.

There are hundreds of Pilates and yoga exercises and no training set will cover
them all, so a recogniser trained on forty will meet something else constantly.
The naive handling is to print "unknown exercise", which is both useless and,
shown to a paying student, actively bad.

The fix is not to guess a name. It is to notice that the name was never the
only thing worth saying. Posture, load, which joints did the work, symmetry,
tempo and control are all measured directly and do not depend on knowing what
the movement is called. A recogniser that declines to name something can still
say a great deal about it.

So :class:`Recognition` always carries a description. The name is present when
it is trustworthy and absent when it is not, and the description reads the same
either way -- a student is never shown a failure message, and is never shown a
confident wrong label either.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

#: Below this probability the top class is not trusted.
MIN_CONFIDENCE = 0.55
#: And the runner-up must be this far behind, or the model is really guessing
#: between two classes rather than recognising one.
MIN_MARGIN = 0.15
#: How far outside the training distribution a window may sit, in standard
#: deviations, before it is treated as something the model has never seen.
MAX_NOVELTY = 4.0


@dataclass
class Recognition:
    """What the system concluded about one window of movement."""

    #: The exercise name, or None when nothing was confident enough.
    name: str | None
    confidence: float
    #: Why the name was withheld, for logs. Never shown to a student.
    withheld_reason: str = ""
    #: The runner-up, useful when two exercises genuinely look alike.
    alternative: str | None = None
    alternative_confidence: float = 0.0
    #: How far outside the training data this window sat.
    novelty: float = 0.0

    @property
    def named(self) -> bool:
        return self.name is not None

    def headline(self, fallback: str) -> str:
        """What to show a person.

        Never "unknown". When the exercise is recognised, its name; otherwise a
        description of what was measured, which is a real observation rather
        than an apology.
        """
        if self.name is not None:
            return self.name.replace("_", " ")
        return fallback


@dataclass
class MovementDescription:
    """What can be said about a movement without knowing its name.

    Every field here is measured directly, so this is available for an
    exercise the recogniser has never seen -- which is the point.
    """

    posture: str = "unknown"          # lying, reclined, upright
    kind: str = "unknown"             # repetitive, sequence, held
    repetitions: int = 0
    leading_joint: str | None = None
    range_of_motion: float | None = None
    hardest_joint: str | None = None
    peak_moment: float | None = None
    working_group: str | None = None
    symmetric: bool | None = None
    duration: float = 0.0

    def summarise(self) -> str:
        """One sentence a person can read, built only from what was measured."""
        posture = {"lying": "lying", "reclined": "half-reclined",
                   "upright": "upright"}.get(self.posture, "in an unclear position")

        if self.kind == "held":
            opening = f"A held position, {posture}"
        elif self.kind == "repetitive":
            opening = (f"{self.repetitions} repetitions of a movement, {posture}"
                       if self.repetitions else f"A repeated movement, {posture}")
        elif self.kind == "sequence":
            opening = f"A sequence of positions, {posture}"
        else:
            opening = f"Movement {posture}"

        parts = [opening]
        if self.leading_joint:
            led = self.leading_joint.replace("_", " ")
            if self.range_of_motion:
                parts.append(f"led by the {led} through {self.range_of_motion:.0f} degrees")
            else:
                parts.append(f"led by the {led}")
        if self.working_group and self.peak_moment:
            parts.append(f"loading the {self.working_group} to {self.peak_moment:.0f} Nm")
        elif self.hardest_joint and self.peak_moment:
            joint = self.hardest_joint.replace("_", " ")
            parts.append(f"with the {joint} carrying {self.peak_moment:.0f} Nm")
        if self.symmetric is False:
            parts.append("noticeably uneven between left and right")
        elif self.symmetric is True:
            parts.append("evenly balanced left and right")

        return ", ".join(parts) + "."


@dataclass
class OpenSetRecogniser:
    """Wraps a trained classifier with a decision about when not to answer.

    Three independent reasons to withhold a name, because they catch different
    failures:

    * **Low confidence** -- the model is unsure of everything.
    * **A narrow margin** -- the model is confident between two classes, which
      is a different error and is common between exercises that genuinely look
      alike from one camera.
    * **Novelty** -- the window sits far outside anything in the training data,
      which is what an unseen exercise looks like. A classifier with a softmax
      will happily assign 0.99 to a movement it has never met; distance to the
      training distribution is what catches that.
    """

    classifier: object
    #: Mean and standard deviation of training features, for the novelty test.
    train_mean: np.ndarray | None = None
    train_std: np.ndarray | None = None
    min_confidence: float = MIN_CONFIDENCE
    min_margin: float = MIN_MARGIN
    max_novelty: float = MAX_NOVELTY

    @classmethod
    def fit(cls, classifier, train_features: np.ndarray, **kwargs) -> "OpenSetRecogniser":
        """Record where the training data sits, so novelty can be measured."""
        return cls(
            classifier=classifier,
            train_mean=train_features.mean(axis=0),
            train_std=train_features.std(axis=0) + 1e-6,
            **kwargs,
        )

    def novelty(self, features: np.ndarray) -> float:
        """Distance from the training distribution, in standard deviations."""
        if self.train_mean is None or self.train_std is None:
            return 0.0
        z = np.abs((features - self.train_mean) / self.train_std)
        # The median rather than the mean: a couple of unusual features is
        # normal variation, most of them being unusual is a new movement.
        return float(np.median(z))

    def recognise(self, window: np.ndarray) -> Recognition:
        """Name this window, or decline to and say why."""
        from .classifier import window_features

        features = window_features(window)
        probabilities = self.classifier.model.predict_proba(features.reshape(1, -1))[0]
        # Column order follows the model's own class list, not the order names
        # happen to be listed in. They differ the moment a class is absent from
        # a training split, and the mix-up is silent: every name shifts by one.
        classes = getattr(self.classifier.model, "classes_", None)
        labels = ([int(c) for c in classes] if classes is not None
                  else list(range(len(probabilities))))

        order = np.argsort(probabilities)[::-1]
        best = int(order[0])
        second = int(order[1]) if len(order) > 1 else best
        confidence = float(probabilities[best])
        runner_up = float(probabilities[second]) if second != best else 0.0
        novelty = self.novelty(features)

        name = self.classifier.names[labels[best]]
        alternative = self.classifier.names[labels[second]] if second != best else None

        if novelty > self.max_novelty:
            return Recognition(None, confidence,
                               f"unlike anything in training ({novelty:.1f} sd away)",
                               alternative, runner_up, novelty)
        if confidence < self.min_confidence:
            return Recognition(None, confidence,
                               f"top class only {confidence:.2f}",
                               alternative, runner_up, novelty)
        if confidence - runner_up < self.min_margin:
            return Recognition(None, confidence,
                               f"too close to {alternative!r} "
                               f"({confidence:.2f} vs {runner_up:.2f})",
                               alternative, runner_up, novelty)
        return Recognition(name, confidence, "", alternative, runner_up, novelty)


def describe(
    summary=None, load_report=None, posture: str = "unknown"
) -> MovementDescription:
    """Build a description from whatever the other layers measured."""
    description = MovementDescription(posture=posture)

    if summary is not None:
        description.kind = summary.kind
        description.repetitions = summary.repetitions
        description.leading_joint = summary.signal
        description.range_of_motion = summary.mean_range
        description.duration = summary.duration
        gaps = [v for v in summary.mean_symmetry.values() if v is not None]
        if gaps:
            description.symmetric = max(gaps) <= 10.0

    if load_report is not None and load_report.loads:
        hardest = load_report.hardest
        if hardest is not None:
            description.hardest_joint = hardest.joint
            description.peak_moment = hardest.moment_nm
            if hardest.group is not None:
                description.working_group = hardest.group.name

    return description
