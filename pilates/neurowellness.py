"""Importing the Neuro Wellness exercise library.

That project holds 190 Pilates and yoga exercises with per-muscle roles, an
innervation table sourced to Gray's Anatomy, and brain-effect claims each
carrying an evidence tier, citation, effect size, population and caveat. It is
better curated than anything that could be written here from scratch, and its
provenance discipline is stricter than this module's was: it marks every muscle
role ``emg`` or ``inferred``, per muscle, per exercise.

So this maps it in rather than reimplementing it. Three things the mapping has
to get right, and each is a place where imported data quietly acquires errors:

**Names.** Their keys are camelCase and their titles are studio English
("Warrior II", "Child's Pose"). Matching is by normalised name, plus a small
explicit alias table. Anything that does not match is **reported, not forced**:
mapping "standing side bend" onto their side-lying "Side Bend" would attach a
real muscle list to the wrong movement, which is the exact failure this whole
layer exists to avoid.

**Apparatus.** 32 of their 190 exercises are on a reformer, cadillac, chair or
barrel. Importing that field wires straight into the equipment rules: an
exercise recognised as reformer work invalidates its own load estimate without
anyone remembering to declare it.

**Activation.** Their records carry an expected activation per muscle. That is
a reference expectation from the source library, not a measurement, and it is
imported into a field named so it cannot be mistaken for one. Nothing here can
see muscle activation.

The export itself is done by ``tools/export_neuro_wellness.mjs``, which dumps
their ES modules verbatim. All schema translation lives here, where the tests
are.
"""
from __future__ import annotations

import json
import re
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path

from .anatomy import (EMG, INFERRED, AnatomyEntry, AnatomyLibrary, Innervation,
                      ResearchNote, bones_for, extract_roots)

#: Their action vocabulary -> the joint it acts at. Anything unlisted
#: contributes no joint, which keeps a new action from silently inventing one.
ACTION_JOINT: dict[str, str] = {
    "hip-flexion": "hip", "hip-extension": "hip", "hip-abduction": "hip",
    "hip-adduction": "hip", "hip-rotation": "hip", "hip-external-rotation": "hip",
    "knee-flexion": "knee", "knee-extension": "knee",
    "ankle-dorsiflexion": "ankle", "ankle-plantarflexion": "ankle",
    "ankle-stability": "ankle",
    "shoulder-flexion": "shoulder", "shoulder-extension": "shoulder",
    "shoulder-abduction": "shoulder", "shoulder-adduction": "shoulder",
    "shoulder-external-rotation": "shoulder", "scapular-stability": "shoulder",
    "elbow-flexion": "elbow", "elbow-extension": "elbow",
    "trunk-flexion": "spine", "trunk-extension": "spine", "trunk-lateral": "spine",
    "trunk-rotation": "spine", "segmental-articulation": "spine",
    "forward-fold": "spine", "lateral-reach": "spine", "chest-expansion": "spine",
}

#: Their position vocabulary -> the posture this system measures.
POSITION_POSTURE: dict[str, str] = {
    "supine": "lying", "prone": "lying", "sidelying": "lying",
    "plank": "lying", "plankSupine": "lying", "quadruped": "lying",
    "seated": "reclined", "crossLegged": "reclined", "chairSeated": "reclined",
    "supported": "lying", "kneelingFold": "lying", "inverted": "unknown",
    "armBalance": "unknown", "pike": "unknown",
    "standing": "upright", "standingFold": "upright", "balance": "upright",
    "lunge": "upright", "lowLunge": "upright", "squat": "upright",
    "kneeling": "upright", "reformer": "lying",
}

#: Apparatus that carries part of the load, so a gravity-only estimate is not
#: true of it. Matches the vocabulary in :mod:`pilates.interaction`.
APPARATUS_EQUIPMENT: dict[str, str] = {
    "reformer": "reformer", "cadillac": "cadillac", "chair": "chair",
    "barrel": "barrel",
}

#: Names that normalisation cannot bridge. Kept short and explicit; every entry
#: here is a judgement somebody should be able to check.
ALIASES: dict[str, str] = {
    # No entry for "the_hundred". It was aliased to their "Hundred
    # Preparation" until the pose cross-check caught it: the classical Hundred
    # holds the legs long, their preparation holds them in tabletop, and the
    # knee targets are 50 degrees apart. Two different exercises with similar
    # names is exactly the mismatch an alias table is most likely to create.
    "childs_pose": "balasana",
    "forward_fold": "uttanasana",
    "half_lift": "ardhaUttanasana",
    "single_leg_circle": "oneLegCircle",
}

_ROMAN = ((" iii", " three"), (" ii", " two"), (" i", " one"))
_DROP = {"pose", "the", "facing"}


def normalise(title: str) -> str:
    """A name in a form both libraries can be looked up by.

    "Warrior II" and "warrior_two" have to meet somewhere, and camelCase keys
    have to split into words before they can.
    """
    text = unicodedata.normalize("NFKD", title.replace("’", "'"))
    text = re.sub(r"'s\b", "", text)
    text = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", text)
    text = text.lower().replace("&", " and ")
    for roman, word in _ROMAN:
        if text.endswith(roman):
            text = text[: -len(roman)] + word
            break
    text = re.sub(r"[^a-z0-9]+", " ", text).strip()
    return "_".join(w for w in text.split() if w not in _DROP)


def squash(title: str) -> str:
    """A name with every separator removed, for a last-resort exact match.

    "Jackknife" and "jack_knife" are the same word written two ways, and
    normalisation cannot join them because there is no boundary to split on.
    Comparing them letter for letter can only merge names that are already
    identical, so it adds no fuzziness -- which matters, because fuzziness here
    attaches a muscle list to the wrong exercise.
    """
    return normalise(title).replace("_", "")


@dataclass
class ImportReport:
    """What came across, and what did not. Both matter."""

    entries: int = 0
    muscles: int = 0
    research: int = 0
    #: Names in the target vocabulary with no match in the source library.
    unmatched: list[str] = field(default_factory=list)
    #: Muscles the source names with no innervation recorded anywhere.
    without_nerves: list[str] = field(default_factory=list)
    #: Exercises whose apparatus makes a load estimate untrue.
    on_apparatus: list[str] = field(default_factory=list)

    def describe(self) -> str:
        lines = [
            f"{self.entries} exercises, {self.muscles} muscles with innervation, "
            f"{self.research} research claims.",
        ]
        if self.on_apparatus:
            lines.append(f"{len(self.on_apparatus)} on apparatus, where a load "
                         f"estimate is not valid: "
                         f"{', '.join(sorted(self.on_apparatus)[:6])}"
                         + (" ..." if len(self.on_apparatus) > 6 else ""))
        if self.unmatched:
            lines.append(f"No entry found for {', '.join(sorted(self.unmatched))}. "
                         f"Those keep whatever anatomy they already had rather "
                         f"than being matched to something close.")
        if self.without_nerves:
            lines.append(f"No nerve supply recorded for "
                         f"{', '.join(sorted(self.without_nerves))}. Those are "
                         f"named without one rather than given a guess.")
        return "\n".join(lines)


def _muscle_roles(record: dict) -> tuple[dict[str, list[str]], dict[str, str]]:
    """Split their [name, support] pairs into roles and per-muscle evidence."""
    roles: dict[str, list[str]] = {"prime": [], "synergists": [], "stabilisers": []}
    evidence: dict[str, str] = {}
    for role in roles:
        for item in record.get("muscles", {}).get(role, ()):
            name, support = (item + [INFERRED])[:2] if isinstance(item, list) \
                else (item, INFERRED)
            roles[role].append(name)
            # A muscle in two roles keeps the stronger claim: measured once is
            # measured, and downgrading it because it also appears as a
            # stabiliser would lose the study.
            if evidence.get(name) != EMG:
                evidence[name] = EMG if support == EMG else INFERRED
    return roles, evidence


def _entry_from(record: dict, name: str) -> AnatomyEntry:
    roles, evidence = _muscle_roles(record)
    joints: list[str] = []
    for action in record.get("actions", ()):
        joint = ACTION_JOINT.get(action)
        if joint and joint not in joints:
            joints.append(joint)
    apparatus = record.get("apparatus", "")
    note = f"starting position: {record.get('position', 'unstated')}"
    if apparatus in APPARATUS_EQUIPMENT:
        note = (f"{note}, on the {apparatus}. The apparatus carries part of the "
                f"load, so a load estimate from body geometry is not valid here")
    return AnatomyEntry(
        exercise=name,
        prime_movers=tuple(roles["prime"]),
        synergists=tuple(roles["synergists"]),
        stabilisers=tuple(roles["stabilisers"]),
        joints=tuple(joints),
        bones=bones_for(joints),
        note=note,
        source="Neuro Wellness exercise library",
        evidence=evidence,
        expected_activation=dict(record.get("activation", {})),
        contraindications=tuple(record.get("contra", ())),
        research_keys=tuple(record.get("brain", ())),
    )


def _research_from(payload: dict) -> dict[str, list[ResearchNote]]:
    return {
        key: [ResearchNote(
            claim=entry.get("claim", ""),
            population=entry.get("population", ""),
            citation=entry.get("citation", ""),
            tier=entry.get("tier", ""),
            effect=entry.get("effect", ""),
            mechanism=entry.get("mechanism", ""),
            species=entry.get("species", ""),
            timescale=entry.get("timescale", ""),
            caveat=entry.get("caveat", ""),
        )]
        for key, entry in payload.items()
    }


def nerve_table(payload: dict) -> dict[str, Innervation]:
    """Their innervation table, in this module's shape.

    Sourced to Gray's Anatomy 42nd edition, and it corrected several entries
    that had been written here from memory -- adductor magnus is supplied by
    two nerves reaching S1, not one stopping at L4.
    """
    table: dict[str, Innervation] = {}
    for name, info in payload.items():
        levels = tuple(info.get("roots", ()))
        if not levels and info.get("nerves"):
            # Some references spell the levels out in the nerve description and
            # carry no separate list. Reading them out of the prose beats
            # recording a muscle with no levels at all.
            levels = extract_roots(info["nerves"])
        table[name] = Innervation(info.get("nerves", ""), levels)
    return table


def _index(records: list[dict]) -> tuple[dict[str, dict], dict[str, dict]]:
    """Look-up tables for a set of records, by normalised and squashed name."""
    by_name: dict[str, dict] = {}
    by_squash: dict[str, dict] = {}
    for record in records:
        for candidate in (record.get("key", ""), record.get("name", "")):
            if not candidate:
                continue
            key = normalise(candidate)
            if key:
                by_name.setdefault(key, record)
                by_squash.setdefault(squash(candidate), record)
    return by_name, by_squash


def _find(name: str, by_name: dict[str, dict],
          by_squash: dict[str, dict]) -> dict | None:
    """An alias first, then a normalised name, then the same letters."""
    target = ALIASES.get(name, name)
    return (by_name.get(normalise(target))
            or by_name.get(normalise(name))
            or by_squash.get(squash(target))
            or by_squash.get(squash(name)))


def load_export(
    path: str | Path,
    wanted: list[str] | None = None,
) -> tuple[AnatomyLibrary, ImportReport]:
    """Read an export and build a library from it.

    ``wanted`` names the exercises this system can assess. When given, the
    result is keyed by those names and anything unmatched is reported rather
    than approximated.
    """
    payload = json.loads(Path(path).read_text())
    records = payload.get("exercises", [])
    table = nerve_table(payload.get("muscles", {}))

    by_name, by_squash = _index(records)

    report = ImportReport(muscles=len(table))
    entries: dict[str, AnatomyEntry] = {}

    def take(name: str, record: dict) -> None:
        entry = _entry_from(record, name)
        entries[name] = entry
        if record.get("apparatus") in APPARATUS_EQUIPMENT:
            report.on_apparatus.append(name)

    if wanted is None:
        for record in records:
            take(record.get("key", ""), record)
    else:
        for name in wanted:
            record = _find(name, by_name, by_squash)
            if record is None:
                report.unmatched.append(name)
                continue
            take(name, record)

    report.entries = len(entries)
    library = AnatomyLibrary(entries=entries,
                             research=_research_from(payload.get("brain", {})),
                             nerves=table)
    report.research = sum(len(v) for v in library.research.values())
    report.without_nerves = library.unknown_muscles()
    return library, report


# ---------------------------------------------------------------------------
# Target poses: their rig coordinates against these angle targets.
# ---------------------------------------------------------------------------

#: Their rig's joint coordinates -> the angles this system measures. Only the
#: joints an interior angle between three keypoints can express appear here;
#: their rig also carries a 24-joint spine that a single trunk angle cannot.
POSE_JOINT: dict[str, str] = {
    "knee_angle_l": "left_knee", "knee_angle_r": "right_knee",
    "hip_flexion_l": "left_hip", "hip_flexion_r": "right_hip",
    "elbow_flex_l": "left_elbow", "elbow_flex_r": "right_elbow",
}

#: Degrees either side of a target pose that still count as doing it.
#: Their records give one exact angle; a target has to be a range, because a
#: student holding a knee at 88 degrees instead of 90 is not doing it wrong.
POSE_TOLERANCE = 20.0
#: A limb cannot look straighter than straight to a camera. Slightly above 180
#: because pose noise pushes a genuinely straight limb over.
MAX_INTERIOR = 185.0


def interior_angle(flexion: float) -> float:
    """A joint flexion in rig coordinates as the angle a camera would measure.

    An interior angle between three keypoints is 180 degrees when the limb is
    straight and closes as the joint flexes, so the two are complements.

    Hyperextension clamps at straight, and that is a real limitation rather
    than a rounding choice: a hip extended past neutral and a hip exactly at
    neutral produce the same interior angle in an image. The rig can express
    the difference; a camera cannot see it.
    """
    return max(0.0, min(MAX_INTERIOR, 180.0 - flexion))


def pose_angles(record: dict) -> dict[str, float]:
    """One record's target pose as the angles a camera would measure.

    Kept separate from the ranges built around them. A range is clipped at
    straight, so its midpoint is not the angle it was built from -- and taking
    the midpoint as the target made a comparison move when the tolerance
    changed, which is exactly the property it was supposed not to have.
    """
    out: dict[str, float] = {}
    for coordinate, value in record.get("pose", {}).items():
        joint = POSE_JOINT.get(coordinate)
        if joint is not None:
            out[joint] = interior_angle(float(value))
    return out


def pose_targets(record: dict, tolerance: float = POSE_TOLERANCE) -> dict[str, tuple[float, float]]:
    """One record's target pose as angle ranges this system can check."""
    return {
        joint: (max(0.0, angle - tolerance), min(MAX_INTERIOR, angle + tolerance))
        for joint, angle in pose_angles(record).items()
    }


@dataclass
class Disagreement:
    """One joint where two independently written targets do not overlap."""

    exercise: str
    joint: str
    ours: tuple[float, float]
    theirs: tuple[float, float]
    #: The angle their pose actually specifies, before a tolerance band was
    #: built around it and clipped at straight.
    their_angle: float | None = None

    @property
    def gap(self) -> float:
        """Degrees between the two ranges. Zero when they touch."""
        if self.ours[1] < self.theirs[0]:
            return self.theirs[0] - self.ours[1]
        if self.theirs[1] < self.ours[0]:
            return self.ours[0] - self.theirs[1]
        return 0.0

    @property
    def centres(self) -> float:
        """Degrees between the two target angles.

        The number to rank by, because it does not depend on the tolerance the
        comparison happened to be run with. Two targets 44 degrees apart are
        describing different positions whether or not a wide enough band makes
        their edges touch.
        """
        theirs = (sum(self.theirs) / 2 if self.their_angle is None
                  else self.their_angle)
        return abs(sum(self.ours) / 2 - theirs)

    def describe(self) -> str:
        theirs = (sum(self.theirs) / 2 if self.their_angle is None
                  else self.their_angle)
        return (f"{self.exercise} {self.joint}: "
                f"ours {sum(self.ours) / 2:.0f} deg "
                f"({self.ours[0]:.0f}-{self.ours[1]:.0f}), "
                f"theirs {theirs:.0f} deg "
                f"({self.theirs[0]:.0f}-{self.theirs[1]:.0f}) "
                f"— {self.centres:.0f} apart")


@dataclass
class Crosscheck:
    """Two independently written sets of angle targets, compared.

    Agreement is weak evidence that both are right. Disagreement is strong
    evidence that one is wrong, and which one is a question for a person --
    this reports, it does not adjudicate.
    """

    agreed: list[tuple[str, str]] = field(default_factory=list)
    disagreed: list[Disagreement] = field(default_factory=list)
    #: Joints one side targets and the other says nothing about.
    only_ours: list[tuple[str, str]] = field(default_factory=list)
    only_theirs: list[tuple[str, str]] = field(default_factory=list)
    #: Exercises with no counterpart to compare against.
    unmatched: list[str] = field(default_factory=list)

    @property
    def compared(self) -> int:
        return len(self.agreed) + len(self.disagreed)

    def describe(self) -> str:
        lines = [f"{self.compared} joint targets compared across "
                 f"{len({e for e, _ in self.agreed} | {d.exercise for d in self.disagreed})} "
                 f"exercises: {len(self.agreed)} agree, {len(self.disagreed)} do not."]
        for item in sorted(self.disagreed, key=lambda d: -d.centres):
            lines.append("  " + item.describe())
        if self.only_ours:
            lines.append(f"  {len(self.only_ours)} joints only this side targets; "
                         f"{len(self.only_theirs)} only theirs.")
        if self.unmatched:
            lines.append(f"  no counterpart for {', '.join(sorted(self.unmatched))}")
        return "\n".join(lines)


def crosscheck_poses(
    path: str | Path,
    standards: dict,
    tolerance: float = POSE_TOLERANCE,
) -> Crosscheck:
    """Compare this system's hand-written angle targets against theirs.

    The two were written independently from the same tradition, which is what
    makes this worth running: where they agree, both are probably right, and
    where they do not, one of them is wrong about an exercise.
    """
    payload = json.loads(Path(path).read_text())
    by_name, by_squash = _index(payload.get("exercises", []))

    result = Crosscheck()
    for name, standard in sorted(standards.items()):
        record = _find(name, by_name, by_squash)
        if record is None:
            result.unmatched.append(name)
            continue
        theirs = pose_targets(record, tolerance)
        exact = pose_angles(record)
        ours = {a.joint: (a.low, a.high) for a in standard.angles}
        for joint in sorted(set(ours) | set(theirs)):
            if joint not in theirs:
                result.only_ours.append((name, joint))
            elif joint not in ours:
                result.only_theirs.append((name, joint))
            elif ours[joint][1] >= theirs[joint][0] and theirs[joint][1] >= ours[joint][0]:
                result.agreed.append((name, joint))
            else:
                result.disagreed.append(Disagreement(
                    name, joint, ours[joint], theirs[joint], exact.get(joint)))
    return result
