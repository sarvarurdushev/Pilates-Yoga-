"""Combining two exercise libraries written by different people.

Where two curated sources overlap, one of them is better on each field, and it
is not the same one every time. Picking a winner per source throws away what
the loser was good at; picking per field keeps both.

The policy below is not a preference. Each line is a claim about which source
is *in a position to know*, and can be argued with:

======================  ========  ====================================
Field                   From      Because
======================  ========  ====================================
muscle roles            imported  marked emg or inferred per muscle
nerve supply            imported  sourced to an anatomy text
contraindications       imported  this side records none
expected activation     imported  this side records none
research claims         imported  tiered, cited, with caveats
angle targets           neither   see below
coaching cues           local     the imported records carry no prose
symmetry targets        local     the imported schema has no such idea
asymmetric by design    local     likewise, and it protects a student
camera refusals         local     the imported side has no camera model
hold targets            imported  it records seconds; this side does not
======================  ========  ====================================

Angle targets are the interesting case, and the answer is that a merge must not
resolve them. Two independently written targets that agree are mutually
confirming and either will do. Two that disagree mean one source is wrong about
an exercise, and quietly taking one would destroy the only evidence that
anything is wrong. Conflicts are carried on the merged record and left for a
teacher.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from .anatomy import AnatomyEntry
from .coaching import AngleTarget, ExerciseStandard
from .neurowellness import Disagreement, pose_angles, pose_targets

#: Which source each field is taken from, and why. Data rather than prose so a
#: report can print it and a test can check the merge obeys it.
POLICY: dict[str, tuple[str, str]] = {
    "muscles": ("imported", "roles are marked measured or inferred per muscle"),
    "nerves": ("imported", "sourced to an anatomy text"),
    "contraindications": ("imported", "this side records none"),
    "expected_activation": ("imported", "this side records none"),
    "research": ("imported", "claims carry a tier, a citation and a caveat"),
    "hold_seconds": ("imported", "it records a hold in seconds; this side does not"),
    "angles": ("both", "independently written, so agreement confirms and "
                       "disagreement is evidence rather than a tie to break"),
    "cues": ("local", "the imported records carry no coaching prose"),
    "symmetry": ("local", "the imported schema has no left/right target"),
    "asymmetric_by_design": ("local", "likewise, and it stops a student being "
                                      "corrected for doing a lunge"),
    "unsuitable": ("local", "the imported side has no model of what one camera "
                            "can see"),
    "tempo_seconds": ("local", "the imported records give repetitions, not "
                               "seconds per repetition"),
}


@dataclass
class Merged:
    """One exercise, assembled from whichever source knows each part."""

    exercise: str
    standard: ExerciseStandard
    anatomy: AnatomyEntry | None = None
    #: Target hold in seconds, where the imported record gives one.
    hold_seconds: float | None = None
    #: Angle targets the two sources disagree about. Carried, not resolved.
    conflicts: list[Disagreement] = field(default_factory=list)
    #: Joints only the imported side targets, added because nothing here
    #: contradicted them.
    added_joints: list[str] = field(default_factory=list)
    #: Field -> where it came from.
    provenance: dict[str, str] = field(default_factory=dict)

    @property
    def contested(self) -> bool:
        return bool(self.conflicts)

    def describe(self) -> str:
        parts = [f"{self.exercise}: {len(self.standard.angles)} angle targets"]
        if self.added_joints:
            parts.append(f"{len(self.added_joints)} added from the import "
                         f"({', '.join(self.added_joints)})")
        if self.conflicts:
            parts.append(f"{len(self.conflicts)} contested, left unresolved")
        if self.anatomy is not None:
            parts.append(f"{len(self.anatomy.muscles)} muscles")
        if self.hold_seconds:
            parts.append(f"hold {self.hold_seconds:.0f}s")
        return " — ".join(parts)


@dataclass
class MergeReport:
    """What the merge did, in enough detail to argue with."""

    merged: dict[str, Merged] = field(default_factory=dict)
    #: Exercises only this side has. Kept: an import cannot delete knowledge.
    local_only: list[str] = field(default_factory=list)
    #: Exercises only the imported side has, and no standard was written for.
    imported_only: list[str] = field(default_factory=list)

    @property
    def contested(self) -> list[Merged]:
        return [m for m in self.merged.values() if m.contested]

    def describe(self) -> str:
        added = sum(len(m.added_joints) for m in self.merged.values())
        lines = [
            f"{len(self.merged)} exercises merged, {added} angle targets added "
            f"from the import, {len(self.contested)} left contested.",
        ]
        for item in self.contested:
            for conflict in item.conflicts:
                lines.append("  contested: " + conflict.describe())
        if self.local_only:
            lines.append(f"  {len(self.local_only)} kept from this side alone: "
                         f"{', '.join(sorted(self.local_only))}")
        if self.imported_only:
            lines.append(f"  {len(self.imported_only)} imported exercises have no "
                         f"standard here and are not assessed.")
        return "\n".join(lines)


def merge_standard(
    name: str,
    standard: ExerciseStandard,
    record: dict | None,
    anatomy: AnatomyEntry | None,
    tolerance: float = 20.0,
) -> Merged:
    """One exercise, taking each field from whichever source knows it.

    Angle targets the imported record has and this side does not are added --
    but only for joints the record's own ``actions`` say the exercise is about.
    A target pose sets every joint the rig needs, including the ones the
    exercise has no opinion on, and importing those wholesale would flag a
    student for resting their arms differently during a leg exercise. The
    record already states which joints it is about; that is the filter.

    Targets both sides have and disagree about are carried as conflicts, never
    averaged -- the midpoint of two incompatible claims is a third claim
    neither source makes.
    """
    result = Merged(exercise=name, standard=standard, anatomy=anatomy,
                    provenance={f: src for f, (src, _) in POLICY.items()})
    if record is None:
        result.provenance["angles"] = "local"
        return result

    theirs = pose_targets(record, tolerance)
    exact = pose_angles(record)
    ours = {a.joint: a for a in standard.angles}
    angles = list(standard.angles)
    about = _joints_the_exercise_is_about(record)

    for joint, (low, high) in sorted(theirs.items()):
        mine = ours.get(joint)
        if mine is None:
            if joint.split("_", 1)[1] not in about:
                continue
            angles.append(AngleTarget(
                joint=joint, low=low, high=high,
                cue=f"the {joint.replace('_', ' ')} was outside the range this "
                    f"movement is normally held in",
            ))
            result.added_joints.append(joint)
        elif mine.high < low or high < mine.low:
            result.conflicts.append(
                Disagreement(name, joint, (mine.low, mine.high), (low, high),
                             exact.get(joint)))

    result.standard = ExerciseStandard(
        exercise=standard.exercise,
        angles=angles,
        symmetry=list(standard.symmetry),
        tempo_seconds=standard.tempo_seconds,
        notes=standard.notes,
        asymmetric_by_design=standard.asymmetric_by_design,
    )
    hold = record.get("hold")
    result.hold_seconds = float(hold) if hold else None
    return result


def merge_libraries(
    standards: dict[str, ExerciseStandard],
    export_path,
    tolerance: float = 20.0,
) -> MergeReport:
    """Combine this side's standards with an imported library.

    An import never deletes: an exercise only this side has keeps its standard,
    because "the other library does not contain it" is not evidence that it is
    wrong. Whether to keep it is a judgement for a person, and
    :func:`review_local_only` lays out the case rather than acting on it.
    """
    import json
    from pathlib import Path

    from .neurowellness import _find, _index, load_export

    payload = json.loads(Path(export_path).read_text())
    by_name, by_squash = _index(payload.get("exercises", []))
    library, _ = load_export(export_path, wanted=sorted(standards))

    report = MergeReport()
    matched: set[str] = set()
    for name, standard in sorted(standards.items()):
        record = _find(name, by_name, by_squash)
        if record is None:
            report.local_only.append(name)
        else:
            matched.add(record.get("key", ""))
        report.merged[name] = merge_standard(
            name, standard, record, library.get(name), tolerance)

    report.imported_only = sorted(
        r.get("key", "") for r in payload.get("exercises", [])
        if r.get("key") not in matched)
    return report


def _joints_the_exercise_is_about(record: dict) -> set[str]:
    """The joints the record's own action list says this exercise works."""
    from .neurowellness import ACTION_JOINT

    return {ACTION_JOINT[a] for a in record.get("actions", ())
            if a in ACTION_JOINT}


@dataclass
class Verdict:
    """The case for and against keeping an exercise the other library lacks."""

    exercise: str
    keep: bool
    reason: str

    def describe(self) -> str:
        return f"{'keep  ' if self.keep else 'drop  '} {self.exercise}: {self.reason}"


#: Exercises whose place in the repertoire is not in question, so absence from
#: another library is a gap there rather than evidence against them here.
CLASSICAL_MAT = {
    "the_hundred", "roll_up", "roll_over", "single_leg_circle",
    "rolling_like_a_ball", "single_leg_stretch", "double_leg_stretch",
    "spine_stretch_forward", "corkscrew", "saw", "swan", "single_leg_kick",
    "neck_pull", "bridge", "spine_twist", "teaser", "swimming",
    "leg_pull_front", "side_plank", "seal", "push_up",
}


def review_local_only(
    names: list[str],
    standards: dict[str, ExerciseStandard],
) -> list[Verdict]:
    """Whether an exercise the other library lacks is worth keeping.

    Absence from one library is weak evidence of anything, so this asks a
    different question: does the standard say something a camera can actually
    check, and is the exercise part of a repertoire people teach?

    A standard whose only targets are "the limb stayed straight" is not doing
    work a general movement-quality check does not already do, and keeping it
    costs a name that the recogniser can then get wrong.
    """
    verdicts: list[Verdict] = []
    for name in sorted(names):
        standard = standards.get(name)
        if standard is None:
            continue
        if name in CLASSICAL_MAT:
            verdicts.append(Verdict(
                name, True,
                "part of the classical mat repertoire, so its absence "
                "elsewhere is a gap there rather than a case against it"))
            continue
        specific = [a for a in standard.angles if not (a.low >= 160 and a.high >= 180)]
        if specific:
            verdicts.append(Verdict(
                name, True,
                f"{len(specific)} target(s) beyond 'the limb stayed straight', "
                f"which is a claim about this exercise rather than about "
                f"movement in general"))
        elif standard.symmetry:
            verdicts.append(Verdict(
                name, True,
                f"no angle target beyond 'the limb stayed straight', but "
                f"{len(standard.symmetry)} left/right target(s), which the "
                f"general check cannot make without knowing the exercise is "
                f"meant to be even"))
        else:
            verdicts.append(Verdict(
                name, False,
                "every target is 'the limb stayed straight', which the general "
                "movement-quality check already covers. Keeping the name costs "
                "a class the recogniser can confuse and buys nothing"))
    return verdicts
