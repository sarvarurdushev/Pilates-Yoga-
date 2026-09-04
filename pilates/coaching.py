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
    #: True where the two sides are *meant* to differ -- a lunge, a single leg
    #: stretch, any warrior. Flagging asymmetry there would be telling a student
    #: off for doing the exercise correctly.
    asymmetric_by_design: bool = False

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

    if standard.asymmetric_by_design:
        # Belt and braces: a symmetry target on a lunge would tell a student
        # off for doing the exercise correctly.
        symmetry_targets: list[SymmetryTarget] = []
    else:
        symmetry_targets = standard.symmetry

    for target in symmetry_targets:
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


#: Exercises a single camera cannot judge, and why. Named explicitly so that
#: asking for one gets an explanation rather than "unknown exercise" -- these
#: are not gaps waiting to be filled, they are measurements a flat image does
#: not contain.
UNSUITABLE: dict[str, str] = {
    "spine_twist": "rotation happens in the camera's depth axis and barely "
                   "changes the image",
    "seated_twist": "rotation happens in the camera's depth axis and barely "
                    "changes the image",
    "saw": "the rotation that defines it is invisible from a single view",
    "corkscrew": "the circling is mostly toward and away from the camera",
    "side_kick": "the leg moves along the depth axis when filmed from the front",
    "eagle": "the crossed limbs occlude each other, so the joints cannot be "
             "located reliably",
    "triangle": "like a side bend, it is confusable with a back bend from one "
                "camera; the plane of the lean is not recorded",
    "savasana": "lying still has nothing to measure beyond that it is still",
    # Moved here from the standards after a review against a second library.
    # Its only targets were "the knees stayed straight" and "the arms stayed
    # straight", which the general movement-quality check already covers
    # without needing a name -- and the trunk, the one thing that would make it
    # this exercise rather than any other, is exactly what a single camera
    # cannot place, for the same reason as triangle above.
    "standing_back_bend": "the arch is in the camera's depth axis when filmed "
                          "from the side and confusable with a side bend when "
                          "filmed from the front; what is left to check is true "
                          "of any standing movement",
}


def _straight(joint: str, cue: str, praise: str = "") -> AngleTarget:
    """A limb that should be extended."""
    return AngleTarget(joint, 160, 185, cue, praise)


#: Starting standards, covering the classical Pilates mat order (Joseph
#: Pilates, *Return to Life Through Contrology*) and the yoga poses that recur
#: in almost every class -- the sun salutation and the standing series.
#:
#: These encode **pose geometry**, which is definitional: a plank has a straight
#: line from shoulder to hip, a warrior two has a front knee near a right angle.
#: They are not clinical judgements, and the tolerances are round numbers chosen
#: to be generous rather than prescriptive. An instructor should read them
#: before they are used with students, and they are stored as data so they can
#: be changed without touching code.
#:
#: Conventions: knee, hip and elbow are the interior angles at that joint, so
#: 180 degrees is straight. Trunk is measured against horizontal, so 90 is
#: upright and 0 is lying flat.
DEFAULT_STANDARDS: dict[str, ExerciseStandard] = {
    # ---- Yoga: sun salutation ----
    "mountain": ExerciseStandard(
        exercise="mountain",
        angles=[
            AngleTarget("trunk", 82, 90, "the torso drifted off vertical",
                        "the torso stayed tall and vertical"),
            _straight("left_knee", "the left knee stayed bent", "the left leg was straight"),
            _straight("right_knee", "the right knee stayed bent", "the right leg was straight"),
        ],
        symmetry=[SymmetryTarget("knee", 8, "one knee was noticeably more bent than the other"),
                  SymmetryTarget("hip", 8, "the hips were not level")],
    ),
    "upward_salute": ExerciseStandard(
        exercise="upward_salute",
        angles=[
            AngleTarget("trunk", 80, 90, "the torso leaned rather than reaching straight up",
                        "the torso stayed tall"),
            _straight("left_elbow", "the left arm stayed bent", "the arms reached long"),
            _straight("right_elbow", "the right arm stayed bent"),
            _straight("left_knee", "the knees stayed bent"),
            _straight("right_knee", "the knees stayed bent"),
        ],
        symmetry=[SymmetryTarget("elbow", 12, "one arm reached higher than the other")],
    ),
    "forward_fold": ExerciseStandard(
        exercise="forward_fold",
        angles=[
            AngleTarget("left_hip", 20, 70, "the fold did not come from the hips",
                        "the fold came from the hips"),
            AngleTarget("right_hip", 20, 70, "the fold did not come from the hips"),
            _straight("left_knee", "the left knee bent to reach further"),
            _straight("right_knee", "the right knee bent to reach further"),
        ],
        symmetry=[SymmetryTarget("hip", 10, "the fold was deeper on one side")],
    ),
    "half_lift": ExerciseStandard(
        exercise="half_lift",
        angles=[
            AngleTarget("left_hip", 70, 110, "the back was not brought to horizontal",
                        "the back came to a flat, horizontal line"),
            AngleTarget("right_hip", 70, 110, "the back was not brought to horizontal"),
            _straight("left_knee", "the knees stayed bent"),
            _straight("right_knee", "the knees stayed bent"),
        ],
    ),
    "chaturanga": ExerciseStandard(
        exercise="chaturanga",
        angles=[
            AngleTarget("left_elbow", 70, 110, "the elbows did not reach a right angle",
                        "the elbows bent to about a right angle"),
            AngleTarget("right_elbow", 70, 110, "the elbows did not reach a right angle"),
            AngleTarget("left_hip", 160, 185, "the hips dropped or piked out of line",
                        "the body held one straight line"),
            AngleTarget("right_hip", 160, 185, "the hips dropped or piked out of line"),
        ],
        symmetry=[SymmetryTarget("elbow", 10, "one elbow bent more than the other")],
    ),
    "upward_dog": ExerciseStandard(
        exercise="upward_dog",
        angles=[
            _straight("left_elbow", "the arms stayed bent", "the arms were straight"),
            _straight("right_elbow", "the arms stayed bent"),
            _straight("left_knee", "the legs were not extended"),
            _straight("right_knee", "the legs were not extended"),
        ],
    ),
    "downward_dog": ExerciseStandard(
        exercise="downward_dog",
        angles=[
            AngleTarget("left_hip", 45, 100, "the hips were not lifted into a clear pike",
                        "the hips lifted into a clear inverted V"),
            AngleTarget("right_hip", 45, 100, "the hips were not lifted into a clear pike"),
            _straight("left_elbow", "the arms stayed bent", "the arms were straight"),
            _straight("right_elbow", "the arms stayed bent"),
            _straight("left_knee", "the left knee stayed bent"),
            _straight("right_knee", "the right knee stayed bent"),
        ],
        symmetry=[SymmetryTarget("hip", 10, "one hip sat higher than the other"),
                  SymmetryTarget("knee", 10, "one knee was more bent than the other")],
    ),
    "plank": ExerciseStandard(
        exercise="plank",
        angles=[
            AngleTarget("left_hip", 160, 185, "the hips dropped or lifted out of line",
                        "the body held a straight line from shoulder to hip"),
            AngleTarget("right_hip", 160, 185, "the hips dropped or lifted out of line"),
            _straight("left_elbow", "the left arm was not fully supporting"),
            _straight("right_elbow", "the right arm was not fully supporting"),
        ],
        symmetry=[SymmetryTarget("hip", 8, "one hip sat lower than the other")],
    ),
    "cobra": ExerciseStandard(
        exercise="cobra",
        angles=[
            AngleTarget("left_elbow", 90, 165, "the arms locked straight, which is upward "
                                               "dog rather than cobra"),
            AngleTarget("right_elbow", 90, 165, "the arms locked straight"),
            _straight("left_knee", "the legs were not extended"),
            _straight("right_knee", "the legs were not extended"),
        ],
    ),
    # ---- Yoga: standing series ----
    "warrior_one": ExerciseStandard(
        exercise="warrior_one",
        angles=[
            AngleTarget("trunk", 75, 95, "the torso leaned forward over the front leg",
                        "the torso stayed upright"),
            _straight("left_elbow", "the arms stayed bent"),
            _straight("right_elbow", "the arms stayed bent"),
        ],
        asymmetric_by_design=True,
        notes="Front and back leg are meant to differ, so the legs are not compared.",
    ),
    "warrior_two": ExerciseStandard(
        exercise="warrior_two",
        angles=[
            AngleTarget("trunk", 80, 100, "the torso leaned rather than staying upright",
                        "the torso stayed upright over the hips"),
        ],
        asymmetric_by_design=True,
        notes="One knee should be near a right angle and the other straight, so "
              "which is which depends on the side being worked. The legs are "
              "measured but not compared.",
    ),
    "warrior_three": ExerciseStandard(
        exercise="warrior_three",
        angles=[
            AngleTarget("trunk", 0, 25, "the torso was not brought parallel to the floor",
                        "the torso came parallel to the floor"),
        ],
        asymmetric_by_design=True,
    ),
    "chair": ExerciseStandard(
        exercise="chair",
        angles=[
            AngleTarget("left_knee", 90, 140, "the knees did not bend into the pose",
                        "the knees bent well into the pose"),
            AngleTarget("right_knee", 90, 140, "the knees did not bend into the pose"),
            _straight("left_elbow", "the arms stayed bent"),
            _straight("right_elbow", "the arms stayed bent"),
        ],
        symmetry=[SymmetryTarget("knee", 8, "one knee bent more than the other")],
    ),
    "low_lunge": ExerciseStandard(
        exercise="low_lunge",
        angles=[AngleTarget("trunk", 70, 95, "the torso collapsed forward",
                            "the torso stayed lifted")],
        asymmetric_by_design=True,
    ),
    "high_lunge": ExerciseStandard(
        exercise="high_lunge",
        angles=[AngleTarget("trunk", 70, 95, "the torso collapsed forward",
                            "the torso stayed lifted")],
        asymmetric_by_design=True,
    ),
    "tree": ExerciseStandard(
        exercise="tree",
        angles=[AngleTarget("trunk", 82, 90, "the torso tilted to counterbalance",
                            "the torso stayed vertical")],
        asymmetric_by_design=True,
        notes="One leg is standing and the other is folded, so the legs are not compared.",
    ),
    "childs_pose": ExerciseStandard(
        exercise="childs_pose",
        angles=[
            AngleTarget("left_knee", 20, 70, "the knees were not fully folded",
                        "the knees folded in fully"),
            AngleTarget("right_knee", 20, 70, "the knees were not fully folded"),
        ],
        symmetry=[SymmetryTarget("knee", 10, "one knee folded further than the other")],
    ),
    "standing_side_bend": ExerciseStandard(
        exercise="standing_side_bend",
        angles=[
            _straight("left_knee", "the left knee bent as the torso tilted",
                      "the legs stayed straight through the bend"),
            _straight("right_knee", "the right knee bent as the torso tilted"),
        ],
        symmetry=[SymmetryTarget("hip", 12, "the hips shifted rather than staying square")],
        notes="Trunk angle is deliberately not checked: a side bend and a back "
              "bend look alike from one camera, so a trunk target here would "
              "confidently measure the wrong thing.",
    ),
    "the_hundred": ExerciseStandard(
        exercise="the_hundred",
        angles=[
            _straight("left_knee", "the legs were not fully extended", "the legs stayed long"),
            _straight("right_knee", "the legs were not fully extended"),
            AngleTarget("left_hip", 30, 90, "the legs were not held at a steady angle"),
            AngleTarget("right_hip", 30, 90, "the legs were not held at a steady angle"),
        ],
        symmetry=[SymmetryTarget("knee", 8, "one leg was more bent than the other"),
                  SymmetryTarget("hip", 8, "one leg was held higher than the other")],
    ),
    "roll_up": ExerciseStandard(
        exercise="roll_up",
        angles=[
            _straight("left_knee", "the knees bent to help the roll up",
                      "the legs stayed straight throughout"),
            _straight("right_knee", "the knees bent to help the roll up"),
        ],
        symmetry=[SymmetryTarget("knee", 8, "one knee bent more than the other")],
        tempo_seconds=(4.0, 8.0),
    ),
    "single_leg_circle": ExerciseStandard(
        exercise="single_leg_circle",
        angles=[AngleTarget("trunk", 0, 20, "the torso lifted off the mat",
                            "the torso stayed settled on the mat")],
        asymmetric_by_design=True,
        notes="One leg circles while the other stays down, so the legs are not compared.",
    ),
    "rolling_like_a_ball": ExerciseStandard(
        exercise="rolling_like_a_ball",
        angles=[
            AngleTarget("left_knee", 20, 80, "the tuck opened up during the roll",
                        "the tuck stayed tight"),
            AngleTarget("right_knee", 20, 80, "the tuck opened up during the roll"),
        ],
        symmetry=[SymmetryTarget("knee", 10, "the tuck was uneven")],
        tempo_seconds=(2.0, 5.0),
    ),
    "single_leg_stretch": ExerciseStandard(
        exercise="single_leg_stretch",
        angles=[AngleTarget("trunk", 5, 45, "the head and chest dropped back to the mat",
                            "the curl was held throughout")],
        asymmetric_by_design=True,
        notes="One knee is drawn in while the other extends, so the legs "
              "differing is the exercise working, not a fault.",
        tempo_seconds=(1.0, 3.0),
    ),
    "double_leg_stretch": ExerciseStandard(
        exercise="double_leg_stretch",
        angles=[
            _straight("left_knee", "the legs did not fully extend", "the legs reached long"),
            _straight("right_knee", "the legs did not fully extend"),
            AngleTarget("trunk", 5, 45, "the curl was lost as the legs extended",
                        "the curl held as the legs extended"),
        ],
        symmetry=[SymmetryTarget("knee", 8, "one leg extended further than the other")],
        tempo_seconds=(2.0, 5.0),
    ),
    "spine_stretch_forward": ExerciseStandard(
        exercise="spine_stretch_forward",
        angles=[
            _straight("left_knee", "the knees bent during the reach",
                      "the legs stayed straight"),
            _straight("right_knee", "the knees bent during the reach"),
            AngleTarget("left_hip", 30, 90, "the fold did not come from the hips"),
            AngleTarget("right_hip", 30, 90, "the fold did not come from the hips"),
        ],
        symmetry=[SymmetryTarget("hip", 10, "the reach was further on one side")],
        tempo_seconds=(4.0, 8.0),
    ),
    "swan": ExerciseStandard(
        exercise="swan",
        angles=[
            AngleTarget("left_hip", 160, 190, "the hips lifted off the mat",
                        "the hips stayed down as the chest lifted"),
            AngleTarget("right_hip", 160, 190, "the hips lifted off the mat"),
            _straight("left_knee", "the legs were not held long"),
            _straight("right_knee", "the legs were not held long"),
        ],
        symmetry=[SymmetryTarget("elbow", 12, "the arms pressed unevenly")],
    ),
    "single_leg_kick": ExerciseStandard(
        exercise="single_leg_kick",
        angles=[AngleTarget("left_hip", 150, 190, "the hips lifted off the mat",
                            "the hips stayed down")],
        asymmetric_by_design=True,
        notes="The legs alternate, so they are not compared.",
        tempo_seconds=(1.0, 3.0),
    ),
    "neck_pull": ExerciseStandard(
        exercise="neck_pull",
        angles=[
            _straight("left_knee", "the knees bent to assist", "the legs stayed straight"),
            _straight("right_knee", "the knees bent to assist"),
        ],
        symmetry=[SymmetryTarget("knee", 8, "one knee bent more than the other")],
        tempo_seconds=(4.0, 8.0),
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
        symmetry=[SymmetryTarget("hip", 8, "one hip lifted higher than the other"),
                  SymmetryTarget("knee", 8, "the feet were not level")],
        tempo_seconds=(3.0, 6.0),
    ),
    "teaser": ExerciseStandard(
        exercise="teaser",
        angles=[
            _straight("left_knee", "the knees bent to reach the position",
                      "the legs stayed straight in the V"),
            _straight("right_knee", "the knees bent to reach the position"),
            AngleTarget("left_hip", 40, 100, "the V shape was not reached"),
            AngleTarget("right_hip", 40, 100, "the V shape was not reached"),
        ],
        symmetry=[SymmetryTarget("knee", 8, "one leg was more bent than the other")],
        tempo_seconds=(4.0, 9.0),
    ),
    "swimming": ExerciseStandard(
        exercise="swimming",
        angles=[
            _straight("left_knee", "the legs were not held long"),
            _straight("right_knee", "the legs were not held long"),
        ],
        asymmetric_by_design=True,
        notes="Opposite arm and leg lift together, so the sides are meant to differ.",
        tempo_seconds=(0.5, 2.0),
    ),
    "leg_pull_front": ExerciseStandard(
        exercise="leg_pull_front",
        angles=[
            AngleTarget("left_hip", 160, 185, "the hips dropped out of the plank line",
                        "the plank line held as the leg lifted"),
            AngleTarget("right_hip", 160, 185, "the hips dropped out of the plank line"),
            _straight("left_elbow", "the supporting arms bent"),
            _straight("right_elbow", "the supporting arms bent"),
        ],
        asymmetric_by_design=True,
        notes="One leg lifts at a time, so the legs are not compared.",
    ),
    "side_plank": ExerciseStandard(
        exercise="side_plank",
        angles=[
            _straight("left_knee", "the legs were not held straight",
                      "the legs stayed long"),
            _straight("right_knee", "the legs were not held straight"),
        ],
        asymmetric_by_design=True,
        notes="Only one arm supports, so the arms are not compared.",
    ),
    "seal": ExerciseStandard(
        exercise="seal",
        angles=[
            AngleTarget("left_knee", 30, 90, "the tuck opened up during the roll"),
            AngleTarget("right_knee", 30, 90, "the tuck opened up during the roll"),
        ],
        symmetry=[SymmetryTarget("knee", 12, "the tuck was uneven")],
        tempo_seconds=(2.0, 5.0),
    ),
    "push_up": ExerciseStandard(
        exercise="push_up",
        angles=[
            AngleTarget("left_hip", 160, 185, "the hips dropped or piked",
                        "the body held one line"),
            AngleTarget("right_hip", 160, 185, "the hips dropped or piked"),
        ],
        symmetry=[SymmetryTarget("elbow", 10, "one arm bent more than the other")],
        tempo_seconds=(1.5, 4.0),
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
