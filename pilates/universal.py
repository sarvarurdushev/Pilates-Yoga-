"""Assessing an exercise nobody has written a standard for.

A library of named exercises will never be finished. There are hundreds of
Pilates and yoga movements before anyone counts machine variations, prop
variations, and whatever a particular teacher invented last week. A system that
can only speak about what somebody has entered is a system that says nothing
for most of a real class.

Two things can be said without a name, and between them they cover most of what
a teacher actually corrects.

**Movement quality is exercise-independent.** Whether the repetitions were the
same size as each other, whether the movement was smooth or wobbled, whether it
was lowered under control or dropped, whether a hold drifted -- none of these
need to know what the exercise is. They are properties of *how* a movement was
performed, and they are wrong in the same way in a teaser and in a squat.

**The class is the standard.** Everyone in the room is doing the same thing at
the same time, on the teacher's count. That makes the cohort a reference that
needs no library and is better than one in two ways: it is whatever the teacher
actually taught rather than what a book says, and it adapts automatically to a
variation, a prop, or a machine.

The cohort also settles a question a library cannot. A single camera cannot
tell an exercise that is asymmetric by design from a student who is lopsided --
but if fifteen of eighteen students show the same left-right gap, the gap
belongs to the exercise. That inference is only available with a room full of
people, which is exactly the setting this system is built for.

Both mechanisms refuse rather than guess when their preconditions fail: too few
students, or a class that did not actually agree on what it was doing.
"""
from __future__ import annotations

import statistics
from dataclasses import dataclass, field

from .coaching import Finding
from .movement import MovementSummary, TrackHistory

#: Students needed before a cohort median means anything. With three people the
#: median is one person's opinion.
MIN_COHORT = 4
#: A class whose spread on a joint exceeds this did not agree on what it was
#: doing, so it cannot be the standard for any one member of it.
MAX_CLASS_SPREAD = 25.0
#: Degrees from the class a student must be before it is worth saying. Below
#: this it is measurement noise and normal human variation.
MIN_DEVIATION = 12.0
#: ...and it must also clear this multiple of the class's own spread, so a
#: tight class and a loose one are not held to the same absolute bar.
SPREAD_MULTIPLE = 2.0

#: Reversals per repetition above which a movement was not under control. Two
#: is one complete repetition; more means the joint changed direction inside it.
CONTROL_LIMIT = 1.6
#: Repetition-to-repetition range spread, as a fraction of the mean range,
#: above which the repetitions were not the same movement.
RANGE_SPREAD_LIMIT = 0.35
#: Below this, the return phase was faster than the lifting phase, which is
#: what dropping a weight rather than lowering it looks like.
TEMPO_RATIO_FLOOR = 0.8


def _human(joint: str) -> str:
    return joint.replace("_", " ")


def _mad(values: list[float]) -> float:
    """Median absolute deviation: spread that one outlier cannot inflate."""
    if len(values) < 2:
        return 0.0
    middle = statistics.median(values)
    return statistics.median([abs(v - middle) for v in values])


def _travel(values: list[float]) -> float:
    """How far a joint moved across a clip, ignoring the extreme frames.

    The tenth to ninetieth percentile rather than the full span, because one
    badly-estimated frame at each end would otherwise set the answer.
    """
    if len(values) < 5:
        return 0.0
    ordered = sorted(values)
    low = ordered[int(len(ordered) * 0.1)]
    high = ordered[min(len(ordered) - 1, int(len(ordered) * 0.9))]
    return high - low


def assess_quality(summary: MovementSummary) -> list[Finding]:
    """What can be said about how a movement was performed, without its name.

    Nothing here needs a standard, because none of it is about the shape being
    aimed at. Wobble, uneven repetitions and a dropped return are faults in a
    teaser and in a squat alike.
    """
    findings: list[Finding] = []
    if summary.kind == "repetitive":
        if summary.control_ratio is not None:
            if summary.control_ratio > CONTROL_LIMIT:
                findings.append(Finding(
                    kind="improve", subject="control",
                    message="the movement changed direction inside a repetition "
                            "rather than travelling smoothly",
                    measured=summary.control_ratio,
                    target=f"below {CONTROL_LIMIT:.1f}",
                    deviation=(summary.control_ratio - CONTROL_LIMIT) * 10.0,
                ))
            else:
                findings.append(Finding(
                    kind="good", subject="control",
                    message="the movement was smooth through each repetition",
                    measured=summary.control_ratio,
                ))
        if summary.mean_range and summary.range_consistency is not None:
            spread = summary.range_consistency / summary.mean_range
            if spread > RANGE_SPREAD_LIMIT:
                findings.append(Finding(
                    kind="improve", subject="consistency",
                    message="the repetitions were not the same size as each other",
                    measured=summary.range_consistency,
                    target=f"within {RANGE_SPREAD_LIMIT * summary.mean_range:.0f}deg",
                    deviation=summary.range_consistency
                              - RANGE_SPREAD_LIMIT * summary.mean_range,
                ))
        if summary.mean_tempo_ratio is not None and \
                summary.mean_tempo_ratio < TEMPO_RATIO_FLOOR:
            findings.append(Finding(
                kind="improve", subject="tempo",
                message="the return was quicker than the effort, which is a "
                        "movement being released rather than controlled",
                measured=summary.mean_tempo_ratio,
                target=f"at least {TEMPO_RATIO_FLOOR:.1f}",
                deviation=(TEMPO_RATIO_FLOOR - summary.mean_tempo_ratio) * 10.0,
            ))
    elif summary.kind == "held" and summary.longest_hold is not None:
        findings.append(Finding(
            kind="good", subject="hold",
            message=f"the position was held for {summary.longest_hold:.0f} seconds",
            measured=summary.longest_hold,
        ))
    return findings


@dataclass
class ClassBaseline:
    """What the room did, used as the standard for what any one member did.

    Built from the students themselves, so it needs no library and describes
    whatever the teacher actually taught rather than what a book says.
    """

    #: Joint -> the class median angle.
    medians: dict[str, float] = field(default_factory=dict)
    #: Joint -> the class's own spread, as a median absolute deviation.
    spread: dict[str, float] = field(default_factory=dict)
    #: Pair ("knee", "hip", "elbow") -> the class median left/right gap.
    symmetry: dict[str, float] = field(default_factory=dict)
    #: Joint -> the class median travel, and its spread. Position and travel
    #: are different questions: a student swinging twice as far as everyone
    #: else has the same median angle as them, so comparing middles alone
    #: cannot see it, and travel is what most differs across a room.
    travel: dict[str, float] = field(default_factory=dict)
    travel_spread: dict[str, float] = field(default_factory=dict)
    students: int = 0

    @property
    def usable(self) -> bool:
        return self.students >= MIN_COHORT

    def agreed_on_travel(self, joint: str) -> bool:
        return (joint in self.travel
                and self.travel_spread.get(joint, 0.0) <= MAX_CLASS_SPREAD)

    def agreed_on(self, joint: str) -> bool:
        """Whether the class was consistent enough to be a standard here.

        A class strung out over forty degrees was not doing one thing, and
        calling its middle "correct" would invent a target nobody was aiming
        at.
        """
        return joint in self.medians and self.spread.get(joint, 0.0) <= MAX_CLASS_SPREAD

    def asymmetric_by_design(self, pair: str, threshold: float = 15.0) -> bool:
        """Whether the *exercise* is uneven, rather than the student.

        A single camera cannot tell a lunge from a lopsided squat by looking at
        one person. A room can: if the class median gap is large, the gap is
        the exercise. This is the one inference a cohort gives that no library
        lookup does, because it holds for a variation nobody has named.
        """
        return self.symmetry.get(pair, 0.0) >= threshold

    def explain(self) -> str:
        if not self.usable:
            return (f"Only {self.students} student(s) measured; at least "
                    f"{MIN_COHORT} are needed before the class can be a "
                    f"standard for any one of them.")
        loose = sorted(j for j in self.medians if not self.agreed_on(j))
        text = f"Class baseline from {self.students} students."
        if loose:
            text += (f" The class did not agree on {', '.join(_human(j) for j in loose)}"
                     f", so nothing is judged against it there.")
        uneven = sorted(p for p in self.symmetry if self.asymmetric_by_design(p))
        if uneven:
            text += (f" The {', '.join(uneven)} gap is large across the whole "
                     f"class, so this movement is uneven by design and a "
                     f"student matching it is doing it right.")
        return text


def build_baseline(
    histories: list[TrackHistory],
    keypoint_threshold: float = 0.4,
    min_samples: int = 5,
) -> ClassBaseline:
    """The cohort's own middle, per joint, from everyone measured well enough."""
    from .coaching import _series

    per_student: dict[str, list[float]] = {}
    per_travel: dict[str, list[float]] = {}
    per_pair: dict[str, list[float]] = {}
    counted = 0
    for history in histories:
        joints = {}
        travelled = {}
        for joint in ("left_knee", "right_knee", "left_hip", "right_hip",
                      "left_elbow", "right_elbow", "trunk"):
            values = _series(history, joint, keypoint_threshold)
            if len(values) >= min_samples:
                joints[joint] = statistics.median(values)
                travelled[joint] = _travel(values)
        if not joints:
            continue
        counted += 1
        for joint, value in joints.items():
            per_student.setdefault(joint, []).append(value)
        for joint, value in travelled.items():
            per_travel.setdefault(joint, []).append(value)
        for pair in ("knee", "hip", "elbow"):
            left, right = joints.get(f"left_{pair}"), joints.get(f"right_{pair}")
            if left is not None and right is not None:
                per_pair.setdefault(pair, []).append(abs(left - right))

    return ClassBaseline(
        medians={j: statistics.median(v) for j, v in per_student.items()},
        spread={j: _mad(v) for j, v in per_student.items()},
        symmetry={p: statistics.median(v) for p, v in per_pair.items()},
        travel={j: statistics.median(v) for j, v in per_travel.items()},
        travel_spread={j: _mad(v) for j, v in per_travel.items()},
        students=counted,
    )


def assess_against_class(
    history: TrackHistory,
    baseline: ClassBaseline,
    keypoint_threshold: float = 0.4,
    min_samples: int = 5,
) -> list[Finding]:
    """How one student compared with the rest of the room.

    Two gates before anything is said, both of which have to clear: a fixed
    floor in degrees, and a multiple of the class's own spread. The first stops
    normal human variation being reported as a fault; the second stops a tight
    class and a loose one being held to the same bar.
    """
    from .coaching import _series

    findings: list[Finding] = []
    if not baseline.usable:
        return findings

    for joint, middle in sorted(baseline.medians.items()):
        if not baseline.agreed_on(joint):
            continue
        values = _series(history, joint, keypoint_threshold)
        if len(values) < min_samples:
            continue
        value = statistics.median(values)
        gap = abs(value - middle)
        bar = max(MIN_DEVIATION, baseline.spread.get(joint, 0.0) * SPREAD_MULTIPLE)
        if gap < bar:
            continue
        direction = "further than" if value > middle else "less than"
        findings.append(Finding(
            kind="improve", subject=joint,
            message=f"the {_human(joint)} was open {direction} the rest of the class",
            measured=value,
            target=f"class median {middle:.0f}deg",
            deviation=gap,
        ))

    for joint, expected in sorted(baseline.travel.items()):
        if not baseline.agreed_on_travel(joint):
            continue
        values = _series(history, joint, keypoint_threshold)
        if len(values) < min_samples:
            continue
        moved = _travel(values)
        gap = abs(moved - expected)
        bar = max(MIN_DEVIATION,
                  baseline.travel_spread.get(joint, 0.0) * SPREAD_MULTIPLE)
        if gap < bar:
            continue
        further = moved > expected
        findings.append(Finding(
            kind="improve", subject=f"{joint}_range",
            message=(f"the {_human(joint)} travelled "
                     f"{'further' if further else 'less far'} than the rest of "
                     f"the class through the same movement"),
            measured=moved,
            target=f"class median {expected:.0f}deg of travel",
            deviation=gap,
        ))

    for pair in sorted(baseline.symmetry):
        left = _series(history, f"left_{pair}", keypoint_threshold)
        right = _series(history, f"right_{pair}", keypoint_threshold)
        if len(left) < min_samples or len(right) < min_samples:
            continue
        gap = abs(statistics.median(left) - statistics.median(right))
        expected = baseline.symmetry[pair]
        # Against the class's gap, not against zero. An exercise that is uneven
        # by design gives the whole room a large gap, and a student matching it
        # is doing it right.
        excess = gap - expected
        if excess >= MIN_DEVIATION:
            findings.append(Finding(
                kind="improve", subject=f"{pair}_symmetry",
                message=(f"the two {pair}s were further apart than the rest of "
                         f"the class had them"),
                measured=gap,
                target=f"class median gap {expected:.0f}deg",
                deviation=excess,
            ))
    return findings


@dataclass
class UnnamedAssessment:
    """Everything sayable about a movement with no standard behind it."""

    track_id: int
    description: str
    quality: list[Finding] = field(default_factory=list)
    versus_class: list[Finding] = field(default_factory=list)
    baseline_note: str = ""

    @property
    def findings(self) -> list[Finding]:
        return self.quality + self.versus_class

    @property
    def improve(self) -> list[Finding]:
        return sorted((f for f in self.findings if f.kind == "improve"),
                      key=lambda f: -f.deviation)

    @property
    def good(self) -> list[Finding]:
        return [f for f in self.findings if f.kind == "good"]

    def summarise(self) -> str:
        """A page that never depends on knowing what the exercise was called."""
        lines = [self.description]
        for finding in self.improve:
            detail = (f" (measured {finding.measured:.0f}, {finding.target})"
                      if finding.measured is not None and finding.target else "")
            lines.append(f"  work on: {finding.message}{detail}")
        for finding in self.good:
            lines.append(f"  going well: {finding.message}")
        if not self.improve and not self.good:
            lines.append("  nothing measurable stood out, in either direction")
        if self.baseline_note:
            lines.append(f"  {self.baseline_note}")
        return "\n".join(lines)


def assess_unnamed(
    history: TrackHistory,
    summary: MovementSummary,
    description: str,
    baseline: ClassBaseline | None = None,
    keypoint_threshold: float = 0.4,
) -> UnnamedAssessment:
    """Coach a movement without knowing what it is called."""
    result = UnnamedAssessment(
        track_id=history.track_id,
        description=description,
        quality=assess_quality(summary),
    )
    if baseline is not None:
        result.versus_class = assess_against_class(
            history, baseline, keypoint_threshold)
        result.baseline_note = baseline.explain()
    return result
