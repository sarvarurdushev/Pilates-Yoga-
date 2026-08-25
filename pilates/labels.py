"""Exercise labels: the format an instructor edits, and its validation.

Exercise recognition needs footage annotated with what was performed. The
format is deliberately plain JSON with times in seconds, because the person
who knows what a movement was called is an instructor, not an engineer, and
they will be editing it in a text editor between classes.

Two things are enforced rather than left to discipline, because both quietly
ruin a dataset:

* **A controlled vocabulary.** "downward dog", "Down Dog" and "downward-facing
  dog" are one exercise to a teacher and three classes to a classifier.
* **A content fingerprint.** Labels record the size and duration of the video
  they were written against, so a re-encoded or swapped file is caught rather
  than silently mislabelling every frame.
"""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path

#: Canonical exercise names. Extend per studio via ``LabelSet.extra_vocabulary``
#: rather than by inventing spellings in individual files.
VOCABULARY: frozenset[str] = frozenset({
    # Mat Pilates
    "the_hundred", "roll_up", "roll_over", "single_leg_circle", "rolling_like_a_ball",
    "single_leg_stretch", "double_leg_stretch", "scissors", "lower_lift",
    "criss_cross", "spine_stretch_forward", "open_leg_rocker", "corkscrew", "saw",
    "swan_dive", "single_leg_kick", "double_leg_kick", "neck_pull", "shoulder_bridge",
    "spine_twist", "teaser", "swimming", "leg_pull_front", "leg_pull_back",
    "side_kick", "seal", "push_up", "plank", "side_plank",
    # Yoga
    "mountain", "upward_salute", "forward_fold", "half_lift", "chaturanga",
    "upward_dog", "downward_dog", "low_lunge", "high_lunge", "warrior_one",
    "warrior_two", "warrior_three", "reverse_warrior", "extended_side_angle",
    "triangle", "half_moon", "chair", "tree", "eagle", "pigeon", "bridge",
    "camel", "cobra", "locust", "boat", "seated_twist", "childs_pose",
    "savasana", "cat_cow", "standing_side_bend", "standing_back_bend",
    # Structural, not exercises -- but they must be labellable or they end up
    # mislabelled as whatever came before.
    "transition", "instruction", "rest", "setup",
})

#: Labels that describe the class rather than a movement. Excluded from
#: training data by default.
NON_EXERCISE: frozenset[str] = frozenset({"transition", "instruction", "rest", "setup"})


class LabelError(ValueError):
    """A label file that would corrupt a dataset if used."""


@dataclass
class Segment:
    """One stretch of a class in which one thing was happening."""

    start: float          # seconds
    end: float            # seconds
    exercise: str
    notes: str = ""

    @property
    def duration(self) -> float:
        return self.end - self.start

    @property
    def is_exercise(self) -> bool:
        return self.exercise not in NON_EXERCISE

    def overlaps(self, other: "Segment") -> bool:
        return self.start < other.end and other.start < self.end

    def contains(self, timestamp: float) -> bool:
        return self.start <= timestamp < self.end


@dataclass
class LabelSet:
    """Every segment annotated for one video."""

    video: str
    duration: float = 0.0
    #: Bytes on disk when the labels were written. Catches a swapped file.
    size_bytes: int = 0
    segments: list[Segment] = field(default_factory=list)
    #: Studio-specific exercise names, added to :data:`VOCABULARY`.
    extra_vocabulary: list[str] = field(default_factory=list)
    notes: str = ""

    @property
    def vocabulary(self) -> frozenset[str]:
        return VOCABULARY | frozenset(self.extra_vocabulary)

    @property
    def labelled_seconds(self) -> float:
        return sum(s.duration for s in self.segments)

    @property
    def exercise_seconds(self) -> float:
        return sum(s.duration for s in self.segments if s.is_exercise)

    @property
    def coverage(self) -> float:
        return self.labelled_seconds / self.duration if self.duration else 0.0

    def at(self, timestamp: float) -> Segment | None:
        for segment in self.segments:
            if segment.contains(timestamp):
                return segment
        return None

    def validate(self) -> list[str]:
        """Every problem with this file, as readable sentences.

        Returns all of them rather than raising on the first, so an instructor
        fixes one file once instead of running the checker six times.
        """
        problems: list[str] = []
        vocabulary = self.vocabulary

        for i, segment in enumerate(self.segments):
            where = f"segment {i + 1} ({segment.exercise!r} at {segment.start:.1f}s)"
            if segment.end <= segment.start:
                problems.append(f"{where}: ends at or before it starts")
            if segment.start < 0:
                problems.append(f"{where}: starts before the video does")
            if self.duration and segment.end > self.duration + 0.5:
                problems.append(
                    f"{where}: ends at {segment.end:.1f}s but the video is "
                    f"{self.duration:.1f}s long"
                )
            if segment.exercise not in vocabulary:
                near = _closest(segment.exercise, vocabulary)
                hint = f" Did you mean {near!r}?" if near else ""
                problems.append(
                    f"{where}: {segment.exercise!r} is not in the vocabulary.{hint} "
                    f"Add it to extra_vocabulary if it is a real name."
                )

        ordered = sorted(self.segments, key=lambda s: s.start)
        for a, b in zip(ordered, ordered[1:]):
            if a.overlaps(b):
                problems.append(
                    f"{a.exercise!r} ({a.start:.1f}-{a.end:.1f}s) overlaps "
                    f"{b.exercise!r} ({b.start:.1f}-{b.end:.1f}s)"
                )
        return problems

    def check(self) -> None:
        """Raise :class:`LabelError` if this file would corrupt a dataset."""
        problems = self.validate()
        if problems:
            raise LabelError("\n".join(problems))

    def counts(self) -> dict[str, float]:
        """Seconds of footage per exercise, most first."""
        totals: dict[str, float] = {}
        for segment in self.segments:
            totals[segment.exercise] = totals.get(segment.exercise, 0.0) + segment.duration
        return dict(sorted(totals.items(), key=lambda kv: -kv[1]))

    @classmethod
    def from_dict(cls, data: dict) -> "LabelSet":
        payload = dict(data)
        segments = [Segment(**s) for s in payload.pop("segments", [])]
        return cls(segments=segments, **payload)

    @classmethod
    def load(cls, path: str | Path) -> "LabelSet":
        return cls.from_dict(json.loads(Path(path).read_text()))

    def to_dict(self) -> dict:
        data = asdict(self)
        data["segments"] = [asdict(s) for s in self.segments]
        return data

    def save(self, path: str | Path) -> None:
        Path(path).write_text(json.dumps(self.to_dict(), indent=2) + "\n")


def _closest(word: str, options: frozenset[str]) -> str | None:
    """Nearest vocabulary entry, for typo hints. None if nothing is close."""
    import difflib

    matches = difflib.get_close_matches(word, sorted(options), n=1, cutoff=0.7)
    return matches[0] if matches else None


def scaffold(video: str, shots, fps: float, duration: float, size_bytes: int) -> LabelSet:
    """A label file pre-split at the cuts, ready to have names filled in.

    Every segment starts as ``transition`` -- a real label meaning "not an
    exercise" rather than a blank. An unfilled scaffold therefore validates
    cleanly and contributes nothing to training, instead of failing or, worse,
    training on placeholder text.
    """
    return LabelSet(
        video=Path(video).name,
        duration=duration,
        size_bytes=size_bytes,
        segments=[
            Segment(
                start=round(shot.start_seconds, 2),
                end=round(shot.end_seconds, 2),
                exercise="transition",
                notes="replace with the exercise performed, or split into several segments",
            )
            for shot in shots
        ],
    )


def contact_sheet_times(segment: Segment, count: int = 6) -> list[float]:
    """Evenly spaced timestamps inside a segment, for visual verification.

    Labelling a thirty-second shot from a single frame is how a standing back
    bend gets recorded as an upward salute: both have the arms overhead, and
    the frame that was checked happened to be the upright one at the start.
    Sampling across the segment makes that mistake visible before it reaches
    the training set.
    """
    if count < 1:
        raise ValueError("count must be at least 1")
    if count == 1:
        return [segment.start + segment.duration / 2]
    span = segment.duration
    return [segment.start + span * i / (count - 1) * 0.98 + span * 0.01
            for i in range(count)]
