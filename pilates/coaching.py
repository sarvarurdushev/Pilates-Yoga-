"""Turning measurements into coaching.

The last layer of the original architecture, and the one where it is easiest to
produce something that sounds authoritative and is not. Three rules hold
throughout:

* **Nothing is said that was not measured.** Every observation carries the
  number it came from and the target it was compared against, so an instructor
  can check it or disagree with it. A joint that was not visible produces
  "not measured", never a guess.
* **The wording is generated from the finding, not the other way round.**
  Templates are filled from structured findings. A language model can phrase
  these more naturally later, but it must never be the thing that decides
  whether a knee was out of line.
* **This describes movement, not health.** Findings are geometric: an angle was
  outside a range. Whether that matters for a particular body is a judgement
  for the person teaching the class.

The standards below are starting points from general movement principles, not
received truth. They are data, so a studio can replace them with its own.
"""
from __future__ import annotations

import json
import statistics
from dataclasses import asdict, dataclass, field
from pathlib import Path

from .geometry import standard_angles
from .movement import MovementSummary, TrackHistory

#: How far outside a target range something must be before it is worth saying.
NOTABLE_DEGREES = 5.0
#: And how far before it is the main thing to work on.
SIGNIFICANT_DEGREES = 15.0


@dataclass(frozen=True)
class AngleTarget:
    """A joint angle that should sit within a range during an exercise."""

    joint: str                 # a key from geometry.standard_angles, or "trunk"
    low: float
    high: float
    cue: str                   # what to say when it is outside
    praise: str = ""           # what to say when it is comfortably inside

    def deviation(self, value: float) -> float:
        """Degrees outside the range. Zero when inside."""
        if value < self.low:
            return self.low - value
        if value > self.high:
            return value - self.high
        return 0.0


@dataclass(frozen=True)
class SymmetryTarget:
    """A left/right pair that should match within a tolerance."""

    pair: str                  # "knee", "hip" or "elbow"
    tolerance: float
    cue: str


@dataclass
class ExerciseStandard:
    """What good looks like for one exercise, in measurable terms."""

    exercise: str
    angles: list[AngleTarget] = field(default_factory=list)
    symmetry: list[SymmetryTarget] = field(default_factory=list)
    #: Ideal seconds per repetition, if the exercise is a counted set.
    tempo_seconds: tuple[float, float] | None = None
    notes: str = ""

    def to_dict(self) -> dict:
        data = asdict(self)
        data["tempo_seconds"] = list(self.tempo_seconds) if self.tempo_seconds else None
        return data

    @classmethod
    def from_dict(cls, data: dict) -> "ExerciseStandard":
        payload = dict(data)
        tempo = payload.pop("tempo_seconds", None)
        return cls(
            angles=[AngleTarget(**a) for a in payload.pop("angles", [])],
            symmetry=[SymmetryTarget(**s) for s in payload.pop("symmetry", [])],
            tempo_seconds=tuple(tempo) if tempo else None,
            **payload,
        )


@dataclass
class Finding:
    """One thing observed about one student, with the evidence behind it."""

    kind: str                  # "good", "improve", "not_measured"
    subject: str               # the joint or quality this is about
    message: str
    measured: float | None = None
    target: str = ""
    deviation: float = 0.0

    @property
    def significant(self) -> bool:
        return self.kind == "improve" and self.deviation >= SIGNIFICANT_DEGREES


@dataclass
class Assessment:
    """Everything found for one student in one exercise."""

    exercise: str
    findings: list[Finding] = field(default_factory=list)
    samples: int = 0
    confidence: float = 0.0

    @property
    def good(self) -> list[Finding]:
        return [f for f in self.findings if f.kind == "good"]

    @property
    def improve(self) -> list[Finding]:
        return sorted(
            (f for f in self.findings if f.kind == "improve"),
            key=lambda f: -f.deviation,
        )

    @property
    def unmeasured(self) -> list[Finding]:
        return [f for f in self.findings if f.kind == "not_measured"]

    @property
    def priority(self) -> Finding | None:
        """The single thing most worth saying, or None if nothing stands out."""
        worst = self.improve
        return worst[0] if worst and worst[0].deviation >= NOTABLE_DEGREES else None


def _series(history: TrackHistory, joint: str, threshold: float) -> list[float]:
    if joint == "trunk":
        return [s.trunk for s in history.samples if s.trunk is not None]
    return [
        s.angles[joint] for s in history.samples
        if s.angles.get(joint) is not None
    ]


def assess(
    history: TrackHistory,
    standard: ExerciseStandard,
    keypoint_threshold: float = 0.4,
    min_samples: int = 5,
) -> Assessment:
    """Compare what a student did against a standard.

    Uses the median of each angle across the clip rather than the mean, so one
    badly-estimated frame cannot move a verdict.
    """
    assessment = Assessment(
        exercise=standard.exercise,
        samples=len(history.samples),
        confidence=(
            statistics.mean([s.confidence for s in history.samples])
            if history.samples else 0.0
        ),
    )

    for target in standard.angles:
        values = _series(history, target.joint, keypoint_threshold)
        if len(values) < min_samples:
            assessment.findings.append(Finding(
                kind="not_measured",
                subject=target.joint,
                message=f"{_human(target.joint)} was not visible often enough to judge",
            ))
            continue
        median = statistics.median(values)
        deviation = target.deviation(median)
        if deviation >= NOTABLE_DEGREES:
            assessment.findings.append(Finding(
                kind="improve", subject=target.joint, message=target.cue,
                measured=median, target=f"{target.low:.0f}-{target.high:.0f}deg",
                deviation=deviation,
            ))
        elif deviation == 0.0 and target.praise:
            assessment.findings.append(Finding(
                kind="good", subject=target.joint, message=target.praise,
                measured=median, target=f"{target.low:.0f}-{target.high:.0f}deg",
            ))

    for target in standard.symmetry:
        gaps = [
            abs(s.angles[f"left_{target.pair}"] - s.angles[f"right_{target.pair}"])
            for s in history.samples
            if s.angles.get(f"left_{target.pair}") is not None
            and s.angles.get(f"right_{target.pair}") is not None
        ]
        if len(gaps) < min_samples:
            assessment.findings.append(Finding(
                kind="not_measured", subject=f"{target.pair} symmetry",
                message=f"could not compare left and right {target.pair}",
            ))
            continue
        median = statistics.median(gaps)
        if median > target.tolerance:
            assessment.findings.append(Finding(
                kind="improve", subject=f"{target.pair} symmetry", message=target.cue,
                measured=median, target=f"within {target.tolerance:.0f}deg",
                deviation=median - target.tolerance,
            ))
        else:
            assessment.findings.append(Finding(
                kind="good", subject=f"{target.pair} symmetry",
                message=f"left and right {target.pair} matched closely",
                measured=median, target=f"within {target.tolerance:.0f}deg",
            ))

    return assessment


def assess_tempo(summary: MovementSummary, standard: ExerciseStandard) -> Finding | None:
    """Judge pace, but only for a genuine counted set."""
    if standard.tempo_seconds is None or summary.kind != "repetitive":
        return None
    if summary.mean_rep_duration is None:
        return None
    low, high = standard.tempo_seconds
    value = summary.mean_rep_duration
    if value < low:
        return Finding(
            kind="improve", subject="tempo",
            message="the repetitions were faster than the movement is meant to be taken",
            measured=value, target=f"{low:.0f}-{high:.0f}s per repetition",
            deviation=low - value,
        )
    if value > high:
        return Finding(
            kind="improve", subject="tempo",
            message="the repetitions were slower than intended, which can mean the "
                    "position is being held rather than moved through",
            measured=value, target=f"{low:.0f}-{high:.0f}s per repetition",
            deviation=value - high,
        )
    return Finding(
        kind="good", subject="tempo", message="the pace was even and controlled",
        measured=value, target=f"{low:.0f}-{high:.0f}s per repetition",
    )


def _human(joint: str) -> str:
    return joint.replace("_", " ")


def narrate(assessment: Assessment, name: str = "") -> str:
    """Plain sentences from structured findings.

    Deliberately templated. The numbers decide what is said; this only decides
    how it reads. A language model can take the same findings and phrase them
    more warmly, but it must not be what determines whether a knee was out of
    line.
    """
    who = name or "This student"
    lines: list[str] = []

    if assessment.samples == 0:
        return f"{who} was not tracked long enough to say anything."

    good = assessment.good
    if good:
        lines.append("Going well:")
        for finding in good:
            detail = f" ({finding.measured:.0f}deg)" if finding.measured is not None else ""
            lines.append(f"  - {finding.message}{detail}")

    improve = assessment.improve
    if improve:
        lines.append("Worth working on:")
        for finding in improve:
            detail = ""
            if finding.measured is not None:
                detail = f" (measured {finding.measured:.0f}deg, target {finding.target})"
            lines.append(f"  - {finding.message}{detail}")

    unmeasured = assessment.unmeasured
    if unmeasured:
        lines.append("Could not judge:")
        for finding in unmeasured:
            lines.append(f"  - {finding.message}")

    priority = assessment.priority
    if priority:
        lines.append(f"\nOne thing for next time: {priority.message}.")
    elif good and not improve:
        lines.append("\nNothing stood out as needing correction in what was measured.")

    return "\n".join(lines)


#: Starting standards. General movement principles rather than received truth --
#: a studio should replace these with its own and they are stored as data so it
#: can. Angles follow geometry.standard_angles: 180 degrees is a straight limb,
#: and trunk is measured against horizontal so 90 is upright.
DEFAULT_STANDARDS: dict[str, ExerciseStandard] = {
    "mountain": ExerciseStandard(
        exercise="mountain",
        angles=[
            AngleTarget("trunk", 82, 90, "the torso drifted off vertical",
                        "the torso stayed tall and vertical"),
            AngleTarget("left_knee", 165, 185, "the left knee stayed bent",
                        "the left leg was straight"),
            AngleTarget("right_knee", 165, 185, "the right knee stayed bent",
                        "the right leg was straight"),
        ],
        symmetry=[SymmetryTarget("knee", 8, "one knee was noticeably more bent than the other"),
                  SymmetryTarget("hip", 8, "the hips were not level")],
    ),
    "standing_side_bend": ExerciseStandard(
        exercise="standing_side_bend",
        angles=[
            AngleTarget("left_knee", 165, 185, "the left knee bent as the torso tilted",
                        "the legs stayed straight through the bend"),
            AngleTarget("right_knee", 165, 185, "the right knee bent as the torso tilted"),
        ],
        symmetry=[SymmetryTarget("hip", 12, "the hips shifted rather than staying square")],
        notes="Trunk angle is not checked: a side bend and a back bend look alike "
              "from one camera, so a trunk target here would be measuring the wrong thing.",
    ),
    "plank": ExerciseStandard(
        exercise="plank",
        angles=[
            AngleTarget("left_hip", 160, 185, "the hips dropped or lifted out of line",
                        "the body held a straight line from shoulder to hip"),
            AngleTarget("right_hip", 160, 185, "the hips dropped or lifted out of line"),
            AngleTarget("left_elbow", 160, 185, "the left arm was not fully supporting"),
            AngleTarget("right_elbow", 160, 185, "the right arm was not fully supporting"),
        ],
        symmetry=[SymmetryTarget("hip", 8, "one hip sat lower than the other")],
    ),
    "warrior_two": ExerciseStandard(
        exercise="warrior_two",
        angles=[
            AngleTarget("left_knee", 85, 110, "the front knee was not bent to a right angle",
                        "the front knee was well bent"),
            AngleTarget("right_knee", 160, 185, "the back leg was not straight",
                        "the back leg stayed long"),
            AngleTarget("trunk", 80, 100, "the torso leaned rather than staying upright",
                        "the torso stayed upright over the hips"),
        ],
    ),
    "bridge": ExerciseStandard(
        exercise="bridge",
        angles=[
            AngleTarget("left_hip", 150, 185, "the hips did not lift to full extension",
                        "the hips reached full extension"),
            AngleTarget("right_hip", 150, 185, "the hips did not lift to full extension"),
            AngleTarget("left_knee", 80, 110, "the feet were too far from the hips"),
            AngleTarget("right_knee", 80, 110, "the feet were too far from the hips"),
        ],
        symmetry=[SymmetryTarget("hip", 8, "one hip lifted higher than the other")],
        tempo_seconds=(3.0, 6.0),
    ),
    "the_hundred": ExerciseStandard(
        exercise="the_hundred",
        angles=[
            AngleTarget("left_knee", 160, 185, "the legs were not fully extended",
                        "the legs stayed long"),
            AngleTarget("right_knee", 160, 185, "the legs were not fully extended"),
        ],
        symmetry=[SymmetryTarget("knee", 8, "one leg was more bent than the other")],
    ),
}


def load_standards(path: str | Path) -> dict[str, ExerciseStandard]:
    """Load studio-specific standards, replacing the defaults."""
    data = json.loads(Path(path).read_text())
    return {name: ExerciseStandard.from_dict(entry) for name, entry in data.items()}


def save_standards(standards: dict[str, ExerciseStandard], path: str | Path) -> None:
    """Write standards out so a studio can edit them."""
    Path(path).write_text(
        json.dumps({k: v.to_dict() for k, v in standards.items()}, indent=2) + "\n"
    )
