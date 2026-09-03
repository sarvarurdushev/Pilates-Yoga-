"""Load, not shape: what the body is actually having to hold.

Joint angles say what a position looked like. They say nothing about effort. A
leg held at 45 degrees by someone tall and heavy is a different demand from the
same angle on someone small, and a knee angle cannot tell them apart. This
module computes the mechanical load instead, and attributes it to the muscle
group that must be producing it.

**What this computes, and how far it can be trusted.**

*Joint moments from inverse dynamics* are standard biomechanics and validated
against force plates: OpenCap reports joint-moment errors of 1.34% of body mass
times height from smartphone video. That is the tier this module works in.

*Which muscle group is working* follows from the moment by mechanics, not by
guesswork: a net knee-extension moment must be produced by the knee extensors,
because nothing else crosses that joint in that direction. Naming the **group**
is sound. Splitting the load between individual muscles inside a group is not
observable and is not attempted.

*Individual muscle activation* is deliberately **not** computed. Estimating it
requires static optimisation, which correlates with measured EMG at roughly
0.26 to 0.48 and is documented as frequently failing to represent real muscle
activity. A number that weak, presented per-student, would be invention.

Nerve activity and cognitive effect are not computable from video at all and
are not attempted anywhere in this codebase. See ``docs/what-cannot-be-measured.md``.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np

from . import keypoints as kp
from .types import Detection

GRAVITY = 9.81  # m/s^2


@dataclass(frozen=True)
class SegmentSpec:
    """One body segment, as proportions of whole-body mass and segment length.

    Values are Winter's anthropometric table (*Biomechanics and Motor Control
    of Human Movement*), the standard reference for exactly this estimate. They
    are population averages: an individual's true segment masses differ, which
    is a real and irreducible source of error in any video-based estimate.
    """

    name: str
    proximal: int          # keypoint index
    distal: int            # keypoint index
    mass_fraction: float   # of total body mass
    com_fraction: float    # centre of mass, as a fraction from proximal to distal


#: Winter's segment parameters, for the limbs a camera can see.
SEGMENTS: dict[str, SegmentSpec] = {
    "left_upper_arm": SegmentSpec("left_upper_arm", kp.L_SHOULDER, kp.L_ELBOW, 0.028, 0.436),
    "right_upper_arm": SegmentSpec("right_upper_arm", kp.R_SHOULDER, kp.R_ELBOW, 0.028, 0.436),
    "left_forearm": SegmentSpec("left_forearm", kp.L_ELBOW, kp.L_WRIST, 0.022, 0.682),
    "right_forearm": SegmentSpec("right_forearm", kp.R_ELBOW, kp.R_WRIST, 0.022, 0.682),
    "left_thigh": SegmentSpec("left_thigh", kp.L_HIP, kp.L_KNEE, 0.100, 0.433),
    "right_thigh": SegmentSpec("right_thigh", kp.R_HIP, kp.R_KNEE, 0.100, 0.433),
    "left_shank": SegmentSpec("left_shank", kp.L_KNEE, kp.L_ANKLE, 0.0465, 0.433),
    "right_shank": SegmentSpec("right_shank", kp.R_KNEE, kp.R_ANKLE, 0.0465, 0.433),
}

#: Which segments hang below each joint, for the gravitational moment.
DISTAL_CHAIN: dict[str, list[str]] = {
    "left_elbow": ["left_forearm"],
    "right_elbow": ["right_forearm"],
    "left_shoulder": ["left_upper_arm", "left_forearm"],
    "right_shoulder": ["right_upper_arm", "right_forearm"],
    "left_knee": ["left_shank"],
    "right_knee": ["right_shank"],
    "left_hip": ["left_thigh", "left_shank"],
    "right_hip": ["right_thigh", "right_shank"],
}

#: The joint each moment is taken about.
JOINT_CENTRE: dict[str, int] = {
    "left_elbow": kp.L_ELBOW, "right_elbow": kp.R_ELBOW,
    "left_shoulder": kp.L_SHOULDER, "right_shoulder": kp.R_SHOULDER,
    "left_knee": kp.L_KNEE, "right_knee": kp.R_KNEE,
    "left_hip": kp.L_HIP, "right_hip": kp.R_HIP,
}


@dataclass(frozen=True)
class MuscleGroup:
    """A group of muscles that together produce one direction of joint moment.

    Named at group level on purpose. Which individual muscle inside a group
    takes what share is not observable from video, and any split would be a
    modelling assumption dressed as a measurement.
    """

    name: str
    members: tuple[str, ...]
    action: str


#: What must be producing a moment at each joint, in each direction. This is
#: anatomy: these are the muscles that cross that joint in that direction.
MUSCLE_GROUPS: dict[tuple[str, str], MuscleGroup] = {
    ("knee", "extension"): MuscleGroup(
        "knee extensors", ("rectus femoris", "vastus lateralis", "vastus medialis",
                           "vastus intermedius"), "straightening the knee"),
    ("knee", "flexion"): MuscleGroup(
        "knee flexors", ("biceps femoris", "semitendinosus", "semimembranosus",
                         "gastrocnemius"), "bending the knee"),
    ("hip", "extension"): MuscleGroup(
        "hip extensors", ("gluteus maximus", "biceps femoris", "semitendinosus",
                          "semimembranosus"), "driving the thigh backwards"),
    ("hip", "flexion"): MuscleGroup(
        "hip flexors", ("iliopsoas", "rectus femoris", "sartorius",
                        "tensor fasciae latae"), "lifting the thigh forwards"),
    ("elbow", "flexion"): MuscleGroup(
        "elbow flexors", ("biceps brachii", "brachialis", "brachioradialis"),
        "bending the elbow"),
    ("elbow", "extension"): MuscleGroup(
        "elbow extensors", ("triceps brachii", "anconeus"), "straightening the elbow"),
    ("shoulder", "flexion"): MuscleGroup(
        "shoulder flexors", ("anterior deltoid", "pectoralis major (clavicular)",
                             "coracobrachialis"), "raising the arm forwards"),
    ("shoulder", "extension"): MuscleGroup(
        "shoulder extensors", ("latissimus dorsi", "teres major",
                               "posterior deltoid"), "drawing the arm backwards"),
}


class NotComputable(Exception):
    """Raised where a load cannot be estimated honestly from what is visible."""


#: Segment lengths as a fraction of standing height (Winter). Used for scale,
#: because a segment is the same length whatever position the body is in.
SEGMENT_LENGTH_FRACTION: dict[str, tuple[int, int, float]] = {
    "thigh_left": (kp.L_HIP, kp.L_KNEE, 0.245),
    "thigh_right": (kp.R_HIP, kp.R_KNEE, 0.245),
    "shank_left": (kp.L_KNEE, kp.L_ANKLE, 0.246),
    "shank_right": (kp.R_KNEE, kp.R_ANKLE, 0.246),
    "upper_arm_left": (kp.L_SHOULDER, kp.L_ELBOW, 0.186),
    "upper_arm_right": (kp.R_SHOULDER, kp.R_ELBOW, 0.186),
    "forearm_left": (kp.L_ELBOW, kp.L_WRIST, 0.146),
    "forearm_right": (kp.R_ELBOW, kp.R_WRIST, 0.146),
}


def metres_per_pixel(detection: Detection, height_m: float, threshold: float = 0.4) -> float:
    """Image scale, from limb lengths rather than overall extent.

    The obvious approach -- divide body height by the skeleton's vertical span
    -- is wrong, and wrong in a way that looks fine. It silently assumes the
    person is standing. On a mat, where the body is horizontal, the vertical
    span collapses and the scale inflates: an early version of this reported
    354 Nm at the hip of a 62 kg student, which is elite-athlete territory and
    would have needed a four-metre thigh.

    A limb is the same length whoever is lying on it, so the scale comes from
    segment lengths against Winter's proportions instead, taking the median of
    whatever is visible so one badly-placed keypoint cannot set the scale for
    the whole body.
    """
    if height_m <= 0:
        raise NotComputable("body height must be positive")

    estimates: list[float] = []
    for proximal, distal, fraction in SEGMENT_LENGTH_FRACTION.values():
        if detection.scores[proximal] < threshold or detection.scores[distal] < threshold:
            continue
        length_px = float(np.linalg.norm(
            detection.keypoints[distal] - detection.keypoints[proximal]))
        if length_px < 10:
            continue
        estimates.append((fraction * height_m) / length_px)

    if not estimates:
        raise NotComputable(
            "no limb was visible at a usable size, so the image scale cannot "
            "be established"
        )
    return float(np.median(estimates))


@dataclass
class JointLoad:
    """The mechanical demand at one joint, and who is meeting it."""

    joint: str                 # "left_knee"
    moment_nm: float           # magnitude of the gravitational moment
    direction: str             # "flexion" or "extension" — the moment the muscles resist
    group: MuscleGroup | None
    contraction: str           # "isometric", "concentric", "eccentric", "unknown"
    lever_m: float             # horizontal distance from joint to the load's centre of mass
    load_kg: float             # mass of everything distal to the joint
    #: Whether the limb was free to be analysed this way.
    open_chain: bool = True
    notes: str = ""

    @property
    def side(self) -> str:
        return self.joint.split("_")[0]

    @property
    def articulation(self) -> str:
        return self.joint.split("_", 1)[1]


def _point(detection: Detection, index: int, threshold: float) -> np.ndarray | None:
    if detection.scores[index] < threshold:
        return None
    return detection.keypoints[index].astype(np.float64)


def gravitational_moment(
    detection: Detection,
    joint: str,
    body_mass_kg: float,
    scale_m_per_px: float,
    threshold: float = 0.4,
) -> JointLoad | None:
    """The moment gravity applies at one joint, from the limb hanging below it.

    This is the honest, tractable case: a limb held in the air, where the only
    external force is its own weight. It covers most of what mat work asks of
    people -- a leg held up, a torso lifted, an arm extended.

    It is **not** valid when the limb is bearing weight through the floor,
    because then an unmeasured ground reaction force dominates. That case needs
    force plates or a pressure mat, and is reported as not computable rather
    than estimated.
    """
    if joint not in DISTAL_CHAIN:
        raise NotComputable(f"no segment chain defined for {joint!r}")
    if body_mass_kg <= 0:
        raise NotComputable("body mass must be positive")

    centre = _point(detection, JOINT_CENTRE[joint], threshold)
    if centre is None:
        return None

    total_mass = 0.0
    weighted_x = 0.0
    for segment_name in DISTAL_CHAIN[joint]:
        spec = SEGMENTS[segment_name]
        proximal = _point(detection, spec.proximal, threshold)
        distal = _point(detection, spec.distal, threshold)
        if proximal is None or distal is None:
            return None
        com = proximal + (distal - proximal) * spec.com_fraction
        mass = body_mass_kg * spec.mass_fraction
        total_mass += mass
        weighted_x += mass * com[0]

    if total_mass <= 0:
        return None

    com_x = weighted_x / total_mass
    # Only the horizontal offset produces a gravitational moment: a limb hanging
    # straight down has none, however heavy it is.
    lever_px = com_x - centre[0]
    lever_m = abs(lever_px) * scale_m_per_px
    moment = total_mass * GRAVITY * lever_m

    articulation = joint.split("_", 1)[1]
    resisting = _resisted_direction(detection, joint, lever_px, threshold)
    group = MUSCLE_GROUPS.get((articulation, resisting)) if resisting else None

    return JointLoad(
        joint=joint, moment_nm=moment, direction=resisting, group=group,
        contraction="unknown", lever_m=lever_m, load_kg=total_mass,
    )


#: The proximal joint of each articulation, needed to know which way it bends.
_PROXIMAL_OF: dict[str, int] = {
    "left_elbow": kp.L_SHOULDER, "right_elbow": kp.R_SHOULDER,
    "left_knee": kp.L_HIP, "right_knee": kp.R_HIP,
    "left_hip": kp.L_SHOULDER, "right_hip": kp.R_SHOULDER,
    "left_shoulder": kp.L_HIP, "right_shoulder": kp.R_HIP,
}

#: The distal joint that defines the articulation's angle.
_DISTAL_OF: dict[str, int] = {
    "left_elbow": kp.L_WRIST, "right_elbow": kp.R_WRIST,
    "left_knee": kp.L_ANKLE, "right_knee": kp.R_ANKLE,
    "left_hip": kp.L_KNEE, "right_hip": kp.R_KNEE,
    "left_shoulder": kp.L_ELBOW, "right_shoulder": kp.R_ELBOW,
}


def _resisted_direction(
    detection: Detection, joint: str, lever_px: float, threshold: float
) -> str | None:
    """Which muscle group must be working, from where gravity would take the limb.

    The sign of the lever arm is not enough on its own: it says which side of
    the joint the weight sits, not which way that rotates the limb. Lying on
    your back with a leg raised and lying face down with a leg lifted put the
    weight on opposite sides of the hip while loading opposite muscle groups.

    So this asks the question directly. Nudge the distal end the way gravity
    pulls it, and see whether the joint angle closes (flexion, resisted by the
    extensors) or opens (extension, resisted by the flexors).
    """
    proximal = _point(detection, _PROXIMAL_OF[joint], threshold)
    centre = _point(detection, JOINT_CENTRE[joint], threshold)
    distal = _point(detection, _DISTAL_OF[joint], threshold)
    if proximal is None or centre is None or distal is None:
        return None
    if abs(lever_px) < 1e-6:
        return None   # hanging straight down: no moment, nothing to attribute

    def angle_at(distal_point: np.ndarray) -> float:
        a = proximal - centre
        b = distal_point - centre
        na, nb = np.linalg.norm(a), np.linalg.norm(b)
        if na < 1e-9 or nb < 1e-9:
            return float("nan")
        cosine = float(np.dot(a, b) / (na * nb))
        return math.degrees(math.acos(max(-1.0, min(1.0, cosine))))

    before = angle_at(distal)
    # Image coordinates put +y downwards, so this is the direction of gravity.
    after = angle_at(distal + np.array([0.0, 1.0]))
    if math.isnan(before) or math.isnan(after) or abs(after - before) < 1e-9:
        return None
    # Gravity closing the joint is flexion, which the extensors must resist.
    return "extension" if after < before else "flexion"


def classify_contraction(
    moment_now: float, moment_before: float, angle_now: float, angle_before: float,
    still_threshold: float = 2.0,
) -> str:
    """Whether the working muscle was shortening, lengthening or holding.

    This is the distinction that matters for coaching and is invisible in a
    joint angle: lowering under control is eccentric work, and it is where most
    of the training effect and most of the injury risk sit.
    """
    change = angle_now - angle_before
    if abs(change) < still_threshold:
        return "isometric"
    if moment_now <= 0:
        return "unknown"
    # The joint is closing against a load that resists closing, or opening
    # against one that resists opening.
    return "eccentric" if change < 0 else "concentric"


def is_weight_bearing(
    detection: Detection, joint: str, threshold: float = 0.4, margin_px: float = 40.0
) -> bool:
    """Whether this limb looks like it is carrying weight through the floor.

    A crude but honest test: the distal end of the chain sits at the bottom of
    the visible body. When that is true the gravitational estimate is invalid,
    because an unmeasured ground reaction force is doing most of the work.
    """
    chain = DISTAL_CHAIN.get(joint, [])
    if not chain:
        return False
    end = SEGMENTS[chain[-1]].distal
    tip = _point(detection, end, threshold)
    if tip is None:
        return False
    visible = detection.keypoints[detection.scores >= threshold]
    if len(visible) < 4:
        return False
    return bool(tip[1] >= visible[:, 1].max() - margin_px)


@dataclass
class LoadReport:
    """Every joint load computable for one person in one frame."""

    loads: list[JointLoad] = field(default_factory=list)
    skipped: dict[str, str] = field(default_factory=dict)
    body_mass_kg: float = 0.0

    @property
    def hardest(self) -> JointLoad | None:
        return max(self.loads, key=lambda l: l.moment_nm) if self.loads else None

    def by_group(self) -> dict[str, float]:
        """Peak moment carried by each named muscle group."""
        out: dict[str, float] = {}
        for load in self.loads:
            if load.group is None:
                continue
            out[load.group.name] = max(out.get(load.group.name, 0.0), load.moment_nm)
        return dict(sorted(out.items(), key=lambda kv: -kv[1]))


def analyse_frame(
    detection: Detection,
    body_mass_kg: float,
    height_m: float,
    threshold: float = 0.4,
) -> LoadReport:
    """Joint loads for one person in one frame, skipping what cannot be trusted."""
    report = LoadReport(body_mass_kg=body_mass_kg)
    try:
        scale = metres_per_pixel(detection, height_m, threshold)
    except NotComputable as exc:
        report.skipped["scale"] = str(exc)
        return report

    for joint in DISTAL_CHAIN:
        if is_weight_bearing(detection, joint, threshold):
            report.skipped[joint] = (
                "bearing weight through the floor; the ground reaction force is "
                "unmeasured, so the load cannot be estimated from video"
            )
            continue
        try:
            load = gravitational_moment(detection, joint, body_mass_kg, scale, threshold)
        except NotComputable as exc:
            report.skipped[joint] = str(exc)
            continue
        if load is None:
            report.skipped[joint] = "some of the limb was not visible"
        else:
            report.loads.append(load)
    return report
