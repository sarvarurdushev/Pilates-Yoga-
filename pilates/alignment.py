"""Standing posture: alignment measured from one camera, and what it cannot see.

The movement layer answers "how did that rep go". This one answers the other
question a studio is asked constantly -- *stand still; what does my alignment
look like, and has it changed since last time* -- and it is a different problem
with different failure modes.

**The division of labour, which is the whole design.** The pose model produces
landmarks and per-joint confidence. Nothing else. Every number below is
deterministic geometry over those landmarks: an angle, a distance, a ratio, a
difference between two sides. No model is asked to judge alignment, and no
language model invents a measurement. That separation is what makes each number
checkable by a teacher with a protractor, and it is why this module imports
:mod:`pilates.geometry` rather than growing maths of its own -- the trunk,
shoulder, pelvis and neck angles were already written and already tested there.

**A single camera cannot see every plane.** Shoulder level is measurable from
the front and meaningless from the side; forward-head is the reverse. Pretending
otherwise is the characteristic failure of posture software, so every metric
here declares itself AVAILABLE, ESTIMATED or UNAVAILABLE for the view it was
asked in, and an UNAVAILABLE metric carries the reason rather than a number.
See :class:`Availability` and :func:`estimate_view`.

**Depth is not recoverable from one lens.** Anything that would need it --
true pelvic tilt in the sagittal plane, rotation about the long axis, real
distances in millimetres -- is either marked ESTIMATED with its assumption
written down, or is not offered. ``docs/what-cannot-be-measured.md`` is the
longer form of this argument and applies here unchanged.

**This is not a medical instrument.** It measures geometry: an angle between
two landmarks, a difference between two sides. It does not diagnose scoliosis,
leg-length discrepancy, or any other condition, and the wording throughout --
"measured asymmetry", "estimated alignment", "joint-angle deviation" -- is
chosen so a report cannot be read as a diagnosis. See :mod:`pilates.wording`.

**On the name.** This is the posture-assessment layer, and it is not called
``posture`` because :func:`pilates.geometry.posture` already is -- that one
answers "upright or lying down", which the pipeline has asked since the
beginning. Two meanings of the word in one package is the confusion this module
spends a docstring warning about in :func:`pelvic_obliquity`; it would be poor
form to create it in the module list.
"""
from __future__ import annotations

import math
import statistics
from dataclasses import dataclass, field
from enum import Enum

import numpy as np

from . import geometry as geo
from . import keypoints as kp
from .scoring import ZERO_AT, Component, Score
from .types import Detection

#: Confidence a joint needs before a measurement is allowed to use it. Matches
#: the default the geometry layer has used since the beginning, so a metric
#: computed here and the same angle computed there agree about visibility.
THRESHOLD = 0.4

#: A person shorter than this fraction of the frame is too few pixels for
#: alignment work. Measured on the shoulder-to-ankle span rather than the
#: bounding box, which a raised arm inflates. At a twelfth of frame height a
#: 1080p frame gives about 90 px of body, and a one-degree shoulder tilt is
#: then well under a pixel of rise across the shoulders -- unmeasurable, and
#: worse, unmeasurable in a way that still produces a number.
MIN_BODY_FRACTION = 1 / 12

#: And the same question in absolute terms: how many pixels of body there are.
#:
#: A fraction alone is not enough -- a body filling a 120 px thumbnail passes
#: the fraction test and is still 120 px of body. This is the number the
#: arithmetic gives:
#:
#: * the finest distinction any of this makes is a normal band edge, and the
#:   tightest of those is +/-2.0 degrees of shoulder tilt;
#: * the shoulders span roughly 0.32 of the shoulder-to-ankle height;
#: * so 2 degrees lifts one shoulder by ``0.32 * span * tan(2deg)``, which is
#:   ``0.0112 * span`` pixels;
#: * landmark noise is a pixel or two, so that rise needs to clear 2 px:
#:   ``span >= 179``.
#:
#: Hence 180. Below it a two-degree difference is inside the noise, which is
#: exactly the size of difference this report is built to notice, so the
#: assessment says so rather than reporting one.
MIN_BODY_PIXELS = 180

#: How far from level a line has to be before it is worth a teacher's attention.
#: Shared with the score: a deviation of `ZERO_AT` scores zero, by construction.
NOTABLE_DEGREES = 3.0

#: Past this, a knee is not tracking off line -- a landmark is wrong.
#:
#: Standing knee deviation is a few per cent of leg length; a quarter of it is
#: a knee somewhere the hip and the ankle are not. This is not a clinical
#: threshold and is not doing clinical work: it is the point past which the
#: measurement stops being about the person, and it exists because a pose model
#: reports full confidence in a landmark it has taken from somebody standing
#: behind. See :func:`implausible`.
MAX_KNEE_DEVIATION = 0.25

#: How far apart the feet must be, as a share of hip width, before stance width
#: can be the denominator of anything.
#:
#: Lateral bias is the torso's offset over the base of support, and with the
#: feet together there is no base to speak of: a two-centimetre offset over a
#: one-centimetre stance is four hundred per cent of nothing. Below this the
#: measurement is refused rather than scaled, and the refusal is actionable --
#: the intake instructions already ask for the feet under the hips.
MIN_STANCE_OVER_HIPS = 0.33

#: How different two legs may measure before the landmark set is not one body.
#: Generous, because perspective and a foot turned out really do change the
#: projected length; it catches a limb that has latched onto another person,
#: which is the failure that actually happens in a studio with two people in
#: the frame.
MAX_LIMB_ASYMMETRY = 0.45


#: What counts as unremarkable, per metric. In one table because two places
#: needed it -- the metric functions and :func:`pilates.api.posture_comparison`,
#: which rebuilds an assessment from its payload -- and a band that disagrees
#: between them would make a metric notable on the way out and unremarkable on
#: the way back in.
#:
#: These are working thresholds for drawing a teacher's eye, not clinical
#: norms. Two degrees off level is roughly where a shoulder difference becomes
#: visible to the naked eye across a studio; they are deliberately conservative
#: and a studio can argue with them, which is why they are a table and not
#: scattered through the code.
NORMAL_BANDS: dict[str, tuple[float, float]] = {
    "head_lateral_tilt": (-2.0, 2.0),
    "shoulder_tilt": (-2.0, 2.0),
    "pelvic_obliquity": (-2.0, 2.0),
    "trunk_lean_lateral": (-3.0, 3.0),
    "trunk_lean_sagittal": (-3.0, 3.0),
    "forward_head": (-0.05, 0.15),
    "left_knee_deviation": (-0.04, 0.04),
    "right_knee_deviation": (-0.04, 0.04),
    "lateral_weight_bias": (-0.10, 0.10),
    # The plumb chain, fore and aft. A standing assessment drops a vertical
    # just in front of the ankle bone and asks where the ear, the shoulder,
    # the hip and the knee sit against it; ideally near it, with the head
    # allowed a little forward. Expressed as a share of the shoulder-to-ankle
    # span, so 0.03 on a 170 cm person is about four centimetres.
    "sagittal_ear_offset": (-0.04, 0.08),
    "sagittal_shoulder_offset": (-0.04, 0.06),
    "sagittal_hip_offset": (-0.05, 0.05),
    "sagittal_knee_offset": (-0.04, 0.04),
    # And the same chain side to side: does the head sit over the shoulders,
    # the shoulders over the pelvis, the pelvis over the feet.
    "lateral_head_shift": (-0.03, 0.03),
    "lateral_shoulder_shift": (-0.03, 0.03),
    "lateral_pelvis_shift": (-0.03, 0.03),
}


class Availability(str, Enum):
    """Whether a metric could be measured at all, and how directly."""

    AVAILABLE = "available"
    #: Measurable in principle from this view, but resting on an assumption
    #: the camera cannot check -- depth, or a body proportion taken as typical.
    ESTIMATED = "estimated"
    UNAVAILABLE = "unavailable"


class View(str, Enum):
    """Which way the person is facing the camera."""

    FRONT = "front"
    REAR = "rear"
    SIDE_LEFT = "side_left"      # the person's left side is toward the camera
    SIDE_RIGHT = "side_right"
    UNKNOWN = "unknown"

    @property
    def is_frontal(self) -> bool:
        """Front or rear: the coronal plane faces the lens."""
        return self in (View.FRONT, View.REAR)

    @property
    def is_sagittal(self) -> bool:
        """Either side: the sagittal plane faces the lens."""
        return self in (View.SIDE_LEFT, View.SIDE_RIGHT)


@dataclass(frozen=True)
class ViewEstimate:
    """The estimated orientation, with the evidence that produced it."""

    view: View
    confidence: float
    #: Shoulder width over torso height. Near zero side-on, near 0.6 face-on.
    aspect: float | None = None
    note: str = ""

    def describe(self) -> str:
        if self.view is View.UNKNOWN:
            return f"view could not be estimated ({self.note})"
        return f"{self.view.value} view, confidence {self.confidence:.2f}"


@dataclass(frozen=True)
class Metric:
    """One alignment measurement, or a documented refusal to make one.

    ``value`` is ``None`` exactly when ``availability`` is UNAVAILABLE. A metric
    never carries a number it does not trust: the point of the type is that the
    caller cannot accidentally read a guess as a measurement.
    """

    name: str
    value: float | None
    unit: str                       # "deg" | "ratio"
    availability: Availability
    confidence: float = 0.0
    reason: str = ""
    #: What counts as unremarkable for this metric, when such a band exists.
    normal: tuple[float, float] | None = None

    @property
    def measured(self) -> bool:
        return self.value is not None and self.availability is not Availability.UNAVAILABLE

    @property
    def deviation(self) -> float | None:
        """Distance outside the normal band, or from zero when there is none."""
        if not self.measured:
            return None
        if self.normal is None:
            return abs(float(self.value))
        low, high = self.normal
        if self.value < low:
            return float(low - self.value)
        if self.value > high:
            return float(self.value - high)
        return 0.0

    @property
    def notable(self) -> bool:
        dev = self.deviation
        return dev is not None and dev >= NOTABLE_DEGREES

    def describe(self) -> str:
        pretty = self.name.replace("_", " ")
        if not self.measured:
            return f"{pretty}: not measured — {self.reason}"
        unit = "°" if self.unit == "deg" else ""
        text = f"{pretty}: {self.value:+.1f}{unit}"
        if self.availability is Availability.ESTIMATED:
            text += " (estimated)"
        return text


# --------------------------------------------------------------------- views

def _confident(det: Detection, *joints: int, threshold: float = THRESHOLD) -> bool:
    return all(det.scores[j] >= threshold for j in joints)


def _mid(det: Detection, left: int, right: int) -> np.ndarray:
    return (det.keypoints[left] + det.keypoints[right]) / 2.0


def body_height_px(det: Detection, threshold: float = THRESHOLD) -> float | None:
    """Shoulder-to-ankle span in pixels, the scale every ratio is taken against.

    Not the bounding box: an overhead reach makes the box half as tall again
    while the body is the same size, and a ratio normalised by that would
    shrink every deviation exactly when the arms move.
    """
    if not _confident(det, kp.L_SHOULDER, kp.R_SHOULDER, threshold=threshold):
        return None
    shoulders = _mid(det, kp.L_SHOULDER, kp.R_SHOULDER)
    feet = []
    for ankle in (kp.L_ANKLE, kp.R_ANKLE):
        if det.scores[ankle] >= threshold:
            feet.append(det.keypoints[ankle])
    if not feet:
        # fall back to the hips and scale up by a typical shoulder-hip share of
        # standing height; marked by the caller as an estimate, never as fact
        if not _confident(det, kp.L_HIP, kp.R_HIP, threshold=threshold):
            return None
        hips = _mid(det, kp.L_HIP, kp.R_HIP)
        trunk = float(abs(hips[1] - shoulders[1]))
        return trunk / 0.30 if trunk > 0 else None
    ankle_y = float(np.mean([f[1] for f in feet]))
    span = abs(ankle_y - float(shoulders[1]))
    return span if span > 0 else None


def estimate_view(det: Detection, threshold: float = THRESHOLD) -> ViewEstimate:
    """Which way the person is facing, from the landmarks alone.

    Three cues, in the order they are trusted:

    * **Shoulder width against torso height.** Face-on, the shoulders span
      roughly six tenths of the shoulder-to-hip height; turned side-on they
      collapse toward zero. This separates frontal from sagittal and is the
      only cue that does not depend on a single joint being found.
    * **Which way the nose sits from the shoulder midline** decides left from
      right once the pose is sagittal.
    * **The sign of the shoulder pair in image x** decides front from rear.
      A COCO model labels left and right *anatomically*, so seen from behind
      the person's left shoulder appears on the right of the picture and the
      difference changes sign. This is a real cue and a fragile one -- it is a
      few pixels wide when someone is turned only slightly -- so it is reported
      with the confidence it earns, and the ears break the tie: both ears found
      with the nose lost is the back of a head.
    """
    if not _confident(det, kp.L_SHOULDER, kp.R_SHOULDER, threshold=threshold):
        return ViewEstimate(View.UNKNOWN, 0.0, note="shoulders not visible")
    if not _confident(det, kp.L_HIP, kp.R_HIP, threshold=threshold):
        return ViewEstimate(View.UNKNOWN, 0.0, note="hips not visible")

    left_s, right_s = det.keypoints[kp.L_SHOULDER], det.keypoints[kp.R_SHOULDER]
    shoulders, hips = _mid(det, kp.L_SHOULDER, kp.R_SHOULDER), _mid(det, kp.L_HIP, kp.R_HIP)
    torso = float(np.linalg.norm(shoulders - hips))
    if torso <= 0:
        return ViewEstimate(View.UNKNOWN, 0.0, note="torso has no length on screen")
    width = float(abs(right_s[0] - left_s[0]))
    aspect = width / torso

    # Face-on is about 0.6; side-on tends to zero. The band between is a turn,
    # where neither a frontal nor a sagittal measurement is honest.
    if aspect >= 0.40:
        signed = float(right_s[0] - left_s[0])
        # anatomical right drawn to the left of anatomical left => facing us
        facing_front = signed < 0
        nose_seen = det.scores[kp.NOSE] >= threshold
        ears_seen = sum(det.scores[e] >= threshold for e in (kp.L_EAR, kp.R_EAR))
        confidence = min(1.0, 0.45 + 0.55 * min(1.0, abs(signed) / max(1e-6, 0.35 * torso)))
        if ears_seen == 2 and not nose_seen:
            facing_front, confidence = False, max(confidence, 0.7)
        elif nose_seen and ears_seen == 2:
            confidence = min(1.0, confidence + 0.15)
        view = View.FRONT if facing_front else View.REAR
        return ViewEstimate(view, round(confidence, 3), round(aspect, 3),
                            note="shoulder span is frontal")
    if aspect <= 0.22:
        # Sagittal. The nose leads the way the person faces; without it, the
        # ear that survived does the same job, since the far ear is occluded.
        lead = None
        if det.scores[kp.NOSE] >= threshold:
            lead = float(det.keypoints[kp.NOSE][0] - shoulders[0])
        elif det.scores[kp.L_EAR] >= threshold and det.scores[kp.R_EAR] < threshold:
            lead = float(det.keypoints[kp.L_EAR][0] - shoulders[0])
        elif det.scores[kp.R_EAR] >= threshold and det.scores[kp.L_EAR] < threshold:
            lead = float(det.keypoints[kp.R_EAR][0] - shoulders[0])
        if lead is None:
            return ViewEstimate(View.UNKNOWN, 0.2, round(aspect, 3),
                                note="side-on but the head could not be located")
        # facing image-left means the camera sees the person's right side
        view = View.SIDE_RIGHT if lead < 0 else View.SIDE_LEFT
        confidence = min(1.0, 0.5 + 0.5 * min(1.0, abs(lead) / max(1e-6, 0.25 * torso)))
        return ViewEstimate(view, round(confidence, 3), round(aspect, 3),
                            note="shoulder span has collapsed")
    return ViewEstimate(View.UNKNOWN, 0.25, round(aspect, 3),
                        note=f"turned part-way ({aspect:.2f} of torso); neither "
                             "plane faces the lens")


# ------------------------------------------------------------------- metrics

#: Why the level metrics carry no front/rear correction, stated once.
#:
#: A COCO model labels keypoints *anatomically*: ``L_SHOULDER`` is the person's
#: left shoulder whichever way they are facing. Turning round swaps where the
#: two land in the picture but not which is which, and a tilt compares their
#: heights -- so the answer is already about the person and flipping it would
#: report the wrong shoulder as the high one to every student photographed from
#: behind. The metrics that *do* need the correction are the ones built on
#: image x, where left and right really do change hands: knee deviation,
#: lateral weight bias, and lateral trunk lean.
_LEVEL_METRICS_ARE_VIEW_INDEPENDENT = True

def implausible(det: Detection, threshold: float = THRESHOLD) -> list[str]:
    """Ways this landmark set is not one person standing still.

    Written after running the pipeline on a photograph with two people in it.
    The pose model put the subject's right knee 180 pixels to the side of the
    body and their right ankle *above* that knee -- landmarks taken from the
    person standing behind -- and reported both at confidence 1.00. Every
    metric downstream then computed cleanly on nonsense and produced a
    four-hundred-per-cent weight bias, which is the worst kind of wrong number:
    specific, confident, and about nobody.

    **Confidence cannot catch this and geometry can.** A pose model's score
    says how sure it is that a knee looks like a knee, not that it belongs to
    the body it has been attached to. So these checks ask the one question the
    model never does: *is this arrangement of joints a body?*

    * A standing leg goes hip, knee, ankle, downward. An ankle above its own
      knee is not a stance, it is a mistake.
    * Shoulders are above hips.
    * Two legs of the same person measure roughly the same, allowing for
      perspective -- see :data:`MAX_LIMB_ASYMMETRY`.

    The ordering checks only run on a body that reads as upright, because a
    person lying down fails all of them correctly and for the wrong reason;
    :func:`pilates.geometry.posture` is what decides, so the two modules cannot
    disagree about what upright means.

    Returns sentences a receptionist can act on, not codes. An empty list means
    nothing here looks impossible, which is not the same as everything being
    right.
    """
    problems: list[str] = []
    span = body_height_px(det, threshold)
    if not span:
        return problems
    slack = 0.03 * span                 # noise, not a straightened knee

    if geo.posture(det, threshold) == "upright":
        if _confident(det, kp.L_SHOULDER, kp.R_SHOULDER, kp.L_HIP, kp.R_HIP,
                      threshold=threshold):
            shoulders = _mid(det, kp.L_SHOULDER, kp.R_SHOULDER)
            hips = _mid(det, kp.L_HIP, kp.R_HIP)
            if shoulders[1] > hips[1] + slack:
                problems.append("the shoulders are below the hips; this is not "
                                "a standing body")
        for side, (hip, knee, ankle) in (
                ("left", (kp.L_HIP, kp.L_KNEE, kp.L_ANKLE)),
                ("right", (kp.R_HIP, kp.R_KNEE, kp.R_ANKLE))):
            if not _confident(det, hip, knee, ankle, threshold=threshold):
                continue
            hy = float(det.keypoints[hip][1])
            ky = float(det.keypoints[knee][1])
            ay = float(det.keypoints[ankle][1])
            if ky < hy + slack:
                problems.append(f"the {side} knee is level with or above the "
                                f"{side} hip; the landmark is in the wrong place")
            if ay < ky + slack:
                problems.append(f"the {side} ankle is level with or above the "
                                f"{side} knee: either the foot is not on the "
                                f"floor, so this is not a standing "
                                f"photograph, or the landmark has been taken "
                                f"from another person in the frame")

    # Frontal photographs only. Side-on, one leg is *behind* the other by
    # construction: the far one is occluded, foreshortened differently, and
    # placed by a model that is guessing at it. Two thighs measuring half a
    # thigh apart is then the expected consequence of the camera angle, not
    # evidence of anything, and flagging it would withhold the score on both
    # side photographs of every set a studio ever takes.
    sagittal = estimate_view(det, threshold).view.is_sagittal
    for part, (left, right) in (() if sagittal else (
            ("thigh", ((kp.L_HIP, kp.L_KNEE), (kp.R_HIP, kp.R_KNEE))),
            ("shin", ((kp.L_KNEE, kp.L_ANKLE), (kp.R_KNEE, kp.R_ANKLE))))):
        if not _confident(det, *left, *right, threshold=threshold):
            continue
        a = float(np.linalg.norm(det.keypoints[left[0]] - det.keypoints[left[1]]))
        b = float(np.linalg.norm(det.keypoints[right[0]] - det.keypoints[right[1]]))
        longer = max(a, b)
        if longer <= 0:
            continue
        if abs(a - b) / longer > MAX_LIMB_ASYMMETRY:
            problems.append(f"the two {part} landmarks differ in length by "
                            f"{abs(a - b) / longer:.0%}; one of them is "
                            f"probably not this person's")
    return problems


def _unavailable(name: str, unit: str, reason: str) -> Metric:
    return Metric(name, None, unit, Availability.UNAVAILABLE, 0.0, reason)


def _joint_confidence(det: Detection, *joints: int) -> float:
    return float(min(det.scores[j] for j in joints)) if joints else 0.0


def _signed_tilt(det: Detection, left: int, right: int, threshold: float) -> float | None:
    """Degrees a left-right line sits off level, positive when left is higher.

    Delegates to the geometry layer so this module cannot drift from the
    shoulder and pelvis tilts the rest of the pipeline already reports.
    """
    return geo._line_tilt(det, left, right, threshold)


def _vertical_lean(det: Detection, upper: np.ndarray, lower: np.ndarray) -> float:
    """Degrees a segment leans off vertical. Positive leans toward image right."""
    dx = float(upper[0] - lower[0])
    dy = float(lower[1] - upper[1])          # image y grows downward
    return float(math.degrees(math.atan2(dx, abs(dy)))) if dy != 0 else 0.0


def head_tilt(det: Detection, view: View, threshold: float = THRESHOLD) -> Metric:
    """Lateral tilt of the ear line, in degrees. Positive: left ear higher."""
    name = "head_lateral_tilt"
    if not view.is_frontal:
        return _unavailable(name, "deg", "the ear line is edge-on from the side")
    if not _confident(det, kp.L_EAR, kp.R_EAR, threshold=threshold):
        return _unavailable(name, "deg", "one or both ears were not found")
    value = _signed_tilt(det, kp.L_EAR, kp.R_EAR, threshold)
    if value is None:
        return _unavailable(name, "deg", "the ears fell on the same point")
    return Metric(name, _zero(round(value, 2)), "deg", Availability.AVAILABLE,
                  _joint_confidence(det, kp.L_EAR, kp.R_EAR), normal=NORMAL_BANDS[name])


def forward_head(det: Detection, view: View, threshold: float = THRESHOLD) -> Metric:
    """How far the ear sits ahead of the shoulder, as a share of torso height.

    The measurement a side view exists for. Reported as a ratio rather than in
    centimetres because converting to a distance needs a scale this camera does
    not have -- see :func:`pilates.biomechanics.metres_per_pixel`, which needs
    the student's height typed in before it will answer.
    """
    name = "forward_head"
    if not view.is_sagittal:
        return _unavailable(name, "ratio", "front-on, the head's depth is along the lens axis")
    ear = kp.L_EAR if view is View.SIDE_LEFT else kp.R_EAR
    shoulder = kp.L_SHOULDER if view is View.SIDE_LEFT else kp.R_SHOULDER
    hip = kp.L_HIP if view is View.SIDE_LEFT else kp.R_HIP
    if not _confident(det, ear, shoulder, hip, threshold=threshold):
        return _unavailable(name, "ratio", "the ear, shoulder or hip on the camera side was not found")
    torso = float(abs(det.keypoints[shoulder][1] - det.keypoints[hip][1]))
    if torso <= 0:
        return _unavailable(name, "ratio", "the torso has no height on screen")
    ahead = float(det.keypoints[ear][0] - det.keypoints[shoulder][0])
    if view is View.SIDE_RIGHT:
        ahead = -ahead                      # facing image-left; forward is -x
    return Metric(name, _zero(round(ahead / torso, 3)), "ratio", Availability.AVAILABLE,
                  _joint_confidence(det, ear, shoulder, hip), normal=NORMAL_BANDS[name])


def shoulder_tilt(det: Detection, view: View, threshold: float = THRESHOLD) -> Metric:
    """Degrees the shoulder line is off level. Positive: the left shoulder is higher."""
    name = "shoulder_tilt"
    if not view.is_frontal:
        return _unavailable(name, "deg", "the shoulder line is edge-on from the side")
    value = geo.shoulder_tilt(det, threshold)
    if value is None:
        return _unavailable(name, "deg", "one or both shoulders were not found")
    return Metric(name, _zero(round(value, 2)), "deg", Availability.AVAILABLE,
                  _joint_confidence(det, kp.L_SHOULDER, kp.R_SHOULDER), normal=NORMAL_BANDS[name])


def pelvic_obliquity(det: Detection, view: View, threshold: float = THRESHOLD) -> Metric:
    """Degrees the hip line is off level. Positive: the left hip is higher.

    Named for what it is. "Pelvic tilt" in a clinic usually means the sagittal
    one, which a frontal camera cannot see at all, and using the same words for
    both is how a report gets read as saying something it did not say.
    """
    name = "pelvic_obliquity"
    if not view.is_frontal:
        return _unavailable(name, "deg", "the hip line is edge-on from the side")
    value = geo.pelvis_tilt(det, threshold)
    if value is None:
        return _unavailable(name, "deg", "one or both hips were not found")
    return Metric(name, _zero(round(value, 2)), "deg", Availability.AVAILABLE,
                  _joint_confidence(det, kp.L_HIP, kp.R_HIP), normal=NORMAL_BANDS[name])


def trunk_lean(det: Detection, view: View, threshold: float = THRESHOLD) -> Metric:
    """Degrees the shoulder-to-hip line leans off vertical.

    Lateral lean seen from the front or rear; forward or backward lean seen
    from the side. Both are the same measurement in the plane that happens to
    face the camera, which is why they share a name and differ only in what the
    sign means -- stated in the returned metric rather than assumed.
    """
    name = "trunk_lean_lateral" if view.is_frontal else "trunk_lean_sagittal"
    if view is View.UNKNOWN:
        return _unavailable(name, "deg", "the view could not be established")
    if not _confident(det, *kp.TRUNK, threshold=threshold):
        return _unavailable(name, "deg", "the shoulders or hips were not found")
    value = _vertical_lean(det, _mid(det, kp.L_SHOULDER, kp.R_SHOULDER),
                           _mid(det, kp.L_HIP, kp.R_HIP))
    if view in (View.REAR, View.SIDE_RIGHT):
        value = -value
    return Metric(name, _zero(round(value, 2)), "deg", Availability.AVAILABLE,
                  _joint_confidence(det, *kp.TRUNK), normal=NORMAL_BANDS[name])


def knee_alignment(det: Detection, view: View, side: str,
                   threshold: float = THRESHOLD) -> Metric:
    """Deviation of the knee from the hip-ankle line, as a share of leg length.

    Positive is the knee falling inward -- toward the body's midline -- which
    is the direction a teacher watches for in a squat or a single-leg stance.
    Reported as a ratio of leg length so it does not change with how far the
    student stands from the camera.

    Frontal views only. From the side this offset is the knee's natural
    flexion, which is a different quantity with a different meaning, and
    reporting it under this name would be a straightforward error.
    """
    name = f"{side}_knee_deviation"
    if not view.is_frontal:
        return _unavailable(name, "ratio", "from the side this offset is knee flexion, not alignment")
    hip, knee, ankle = ((kp.L_HIP, kp.L_KNEE, kp.L_ANKLE) if side == "left"
                        else (kp.R_HIP, kp.R_KNEE, kp.R_ANKLE))
    if not _confident(det, hip, knee, ankle, threshold=threshold):
        return _unavailable(name, "ratio", f"the {side} hip, knee or ankle was not found")
    h, k, a = det.keypoints[hip], det.keypoints[knee], det.keypoints[ankle]
    leg = float(np.linalg.norm(h - a))
    if leg <= 0:
        return _unavailable(name, "ratio", "the leg has no length on screen")
    # signed perpendicular distance of the knee from the hip-ankle line
    span = a - h
    rel = k - h
    cross = float(span[0] * rel[1] - span[1] * rel[0])
    offset = cross / max(1e-6, float(np.linalg.norm(span)))
    # inward is toward the midline, which flips with the side and with the view
    inward = offset if side == "left" else -offset
    if view is View.REAR:
        inward = -inward
    value = inward / leg
    if abs(value) > MAX_KNEE_DEVIATION:
        # Not a finding. A knee a quarter of a leg length off the hip-ankle
        # line is a landmark in the wrong place -- most often taken from
        # somebody standing behind -- and the pose model will have reported it
        # at full confidence, so confidence cannot catch this and geometry can.
        return _unavailable(
            name, "ratio",
            f"the {side} knee sits {abs(value):.0%} of a leg length off the "
            f"hip-to-ankle line, which is not a knee: the landmark is wrong")
    return Metric(name, _zero(round(value, 3)), "ratio", Availability.AVAILABLE,
                  _joint_confidence(det, hip, knee, ankle), normal=NORMAL_BANDS[name])


def weight_bias(det: Detection, view: View, threshold: float = THRESHOLD) -> Metric:
    """Where the shoulders sit over the feet, as a share of stance width.

    Positive means the upper body is carried toward the person's left. It is an
    *estimate*: a camera sees where the body is, not where the load goes, and
    the two part company the moment someone leans without shifting their feet.
    A force plate measures weight distribution; this measures where the torso
    is standing, which is a different and more modest claim.
    """
    name = "lateral_weight_bias"
    if not view.is_frontal:
        return _unavailable(name, "ratio", "stance width is not visible from the side")
    if not _confident(det, kp.L_ANKLE, kp.R_ANKLE, kp.L_SHOULDER, kp.R_SHOULDER,
                      threshold=threshold):
        return _unavailable(name, "ratio", "the ankles or shoulders were not found")
    ankles = _mid(det, kp.L_ANKLE, kp.R_ANKLE)
    shoulders = _mid(det, kp.L_SHOULDER, kp.R_SHOULDER)
    stance = float(abs(det.keypoints[kp.L_ANKLE][0] - det.keypoints[kp.R_ANKLE][0]))
    hips = float(abs(det.keypoints[kp.L_HIP][0] - det.keypoints[kp.R_HIP][0])) \
        if _confident(det, kp.L_HIP, kp.R_HIP, threshold=threshold) else 0.0
    floor = max(1.0, MIN_STANCE_OVER_HIPS * hips)
    if stance < floor:
        return _unavailable(
            name, "ratio",
            "the feet are too close together for stance width to mean "
            "anything; ask for the photograph again with the feet under "
            "the hips")
    offset = float(shoulders[0] - ankles[0])
    if view is View.REAR:
        # Seen from the front the person's left is toward image right, so a
        # positive offset already means "carried toward their left". Seen from
        # behind it is the other way round and only then needs negating.
        #
        # This flipped on FRONT until a constructed body -- shifted a known
        # distance toward its own left, photographed from both sides -- was
        # measured against the docstring. It had reported the wrong side since
        # it was written, and :mod:`pilates.guidance` turns the sign into the
        # word "left" or "right" in front of a student.
        offset = -offset
    return Metric(name, _zero(round(offset / stance, 3)), "ratio", Availability.ESTIMATED,
                  _joint_confidence(det, kp.L_ANKLE, kp.R_ANKLE,
                                    kp.L_SHOULDER, kp.R_SHOULDER),
                  reason="where the torso stands, not where the load goes",
                  normal=NORMAL_BANDS[name])


def torso_rotation(det: Detection, view: View, threshold: float = THRESHOLD) -> Metric:
    """Shoulder span against hip span: an indication of rotation about the spine.

    ESTIMATED, and deliberately so. Shoulders really are wider than hips, by an
    amount that differs between people, so the ratio only means rotation once a
    baseline for *this* student exists. Useful compared against their own
    earlier assessment; not useful as an absolute.
    """
    name = "torso_rotation_index"
    if not view.is_frontal:
        return _unavailable(name, "ratio", "both spans are foreshortened from the side")
    if not _confident(det, *kp.TRUNK, threshold=threshold):
        return _unavailable(name, "ratio", "the shoulders or hips were not found")
    shoulder_w = float(abs(det.keypoints[kp.R_SHOULDER][0] - det.keypoints[kp.L_SHOULDER][0]))
    hip_w = float(abs(det.keypoints[kp.R_HIP][0] - det.keypoints[kp.L_HIP][0]))
    if hip_w < 1.0:
        return _unavailable(name, "ratio", "the hips project to nearly a point")
    return Metric(name, round(shoulder_w / hip_w, 3), "ratio", Availability.ESTIMATED,
                  _joint_confidence(det, *kp.TRUNK),
                  reason="needs this student's own baseline to mean rotation")


#: The plumb chain, from the ground up. Each landmark, and what to call it.
#:
#: These are the five points a standing assessment drops a vertical through --
#: ear, shoulder, hip, knee, ankle -- and COCO-17 marks every one of them. The
#: first version of this module measured two of them, which is why a side
#: photograph produced two numbers and a studio asked where the analysis was.
_CHAIN = (("ear", (kp.L_EAR, kp.R_EAR)),
          ("shoulder", (kp.L_SHOULDER, kp.R_SHOULDER)),
          ("hip", (kp.L_HIP, kp.R_HIP)),
          ("knee", (kp.L_KNEE, kp.R_KNEE)))

#: What each link is called in each plane. The knee has no lateral entry: side
#: to side its offset is the knee tracking already measured against the
#: hip-to-ankle line, and reporting the same quantity twice under two names
#: would flatter the coverage without measuring anything more.
_SAGITTAL_CHAIN = {"ear": "sagittal_ear_offset",
                   "shoulder": "sagittal_shoulder_offset",
                   "hip": "sagittal_hip_offset",
                   "knee": "sagittal_knee_offset"}
_LATERAL_CHAIN = {"ear": "lateral_head_shift",
                  "shoulder": "lateral_shoulder_shift",
                  "hip": "lateral_pelvis_shift"}


def _plumb_x(det: Detection, threshold: float) -> float | None:
    """Where the vertical reference is dropped: between the ankles.

    A postural plumb line hangs just in front of the lateral malleolus. The
    ankle landmark is the nearest thing a 17-point model has to it, and using
    the same origin the drawing uses means the number and the picture agree.
    """
    feet = [det.keypoints[j][0] for j in (kp.L_ANKLE, kp.R_ANKLE)
            if det.scores[j] >= threshold]
    return float(sum(feet) / len(feet)) if feet else None


def _facing(det: Detection, view: View, threshold: float) -> float:
    """Which way is forward in image x: +1 toward image right, -1 toward left.

    Read from the view rather than from the landmarks, because the view is
    told by the studio and a landmark-based guess would disagree with it on
    exactly the photographs where it matters.
    """
    return -1.0 if view is View.SIDE_RIGHT else 1.0


def _chain_offset(det: Detection, pair: tuple[int, int], origin: float,
                  span: float, threshold: float) -> tuple[float, float] | None:
    """One landmark's horizontal offset from the plumb, and its confidence.

    The pair is averaged where both are found and taken singly where one is:
    side-on the far ear is behind the head and the far hip behind the near
    one, so insisting on both would refuse the measurement on exactly the
    photograph it is for.
    """
    found = [j for j in pair if det.scores[j] >= threshold]
    if not found or span <= 0:
        return None
    x = sum(float(det.keypoints[j][0]) for j in found) / len(found)
    confidence = min(float(det.scores[j]) for j in found)
    return (x - origin) / span, confidence


def plumb_chain(det: Detection, view: View,
                threshold: float = THRESHOLD) -> list[Metric]:
    """Where each landmark sits against the vertical, in the plane on view.

    **Two planes, one chain.** From the side this is the classic postural
    assessment: a vertical through the ankle, and the ear, shoulder, hip and
    knee measured fore or aft of it -- which is what a side photograph is
    taken for and what separates a forward head from a whole body leaning.
    From the front or the back it is the same question turned ninety degrees:
    does the head sit over the shoulders, the shoulders over the pelvis, the
    pelvis over the feet.

    **Offsets, not angles**, expressed as a share of the shoulder-to-ankle
    span. An angle at the ankle would be tiny and hard to read; a share of
    body height is the number a teacher can convert in their head -- three per
    cent is about four centimetres on a person of average height -- and it
    does not change with how far away the camera stood.

    **The chain is the point, not the individual numbers.** A head four
    centimetres forward of a shoulder that is itself four centimetres forward
    is a different body from a head four centimetres forward of a shoulder
    over the ankle, and only a chain shows the difference. See
    :func:`pilates.guidance.pattern`.
    """
    lateral = view.is_frontal
    names = (_LATERAL_CHAIN if lateral else _SAGITTAL_CHAIN)
    # Every name, every time. A metric the plane cannot show is refused with
    # its reason rather than left out, the way the rest of this module refuses
    # forward-head from the front -- so a report can show the gap instead of
    # quietly having one, and so a comparison between two visits finds the
    # same keys on both sides.
    other = (_SAGITTAL_CHAIN if lateral else _LATERAL_CHAIN)
    plane = "side" if lateral else "front or back"
    out: list[Metric] = [
        _unavailable(name, "ratio",
                     f"this offset is along the lens axis here; it needs a "
                     f"photograph from the {plane}")
        for name in sorted(set(other.values()) - set(names.values()))]
    if view is View.UNKNOWN:
        return out + [_unavailable(name, "ratio",
                                   "the view could not be established")
                      for name in sorted(set(names.values()))]

    origin = _plumb_x(det, threshold)
    span = body_height_px(det, threshold) or 0.0
    for part, pair in _CHAIN:
        name = names.get(part)
        if name is None:
            continue
        if origin is None:
            out.append(_unavailable(name, "ratio",
                                    "neither ankle was found, so there is "
                                    "nothing to drop a vertical from"))
            continue
        found = _chain_offset(det, pair, origin, span, threshold)
        if found is None:
            pretty = "knee" if part == "knee" else part
            out.append(_unavailable(name, "ratio",
                                    f"the {pretty} was not found"))
            continue
        value, confidence = found
        if lateral:
            # Positive is toward the person's left. From the front that is
            # already the +x direction; from behind it is -x. See the same
            # correction in :func:`weight_bias`, and the constructed-body test
            # in ``tests/test_alignment.py`` that pins both.
            if view is View.REAR:
                value = -value
        else:
            value *= _facing(det, view, threshold)
        out.append(Metric(name, _zero(round(value, 3)), "ratio",
                          Availability.AVAILABLE, confidence,
                          normal=NORMAL_BANDS[name]))
    return out


def sagittal_pelvic_tilt(det: Detection, view: View, threshold: float = THRESHOLD) -> Metric:
    """Anterior/posterior pelvic tilt. Not offered, and this says why.

    The measurement everyone wants from a side view. It needs the angle of a
    line between two bony landmarks -- the anterior and posterior superior
    iliac spines -- that no COCO-17 model marks and no amount of arithmetic on
    a single hip point can recover. Approximating it from the hip-knee-trunk
    angle produces a number that moves with hip flexion, which is not the same
    thing and would be read as if it were.

    Returned as a metric rather than omitted so that a report can show the gap
    instead of quietly having one.
    """
    return _unavailable(
        "sagittal_pelvic_tilt", "deg",
        "needs the ASIS and PSIS landmarks, which a 17-point model does not mark")


# ---------------------------------------------------------------- assessment

#: Which metrics make up each named part of the score. Grouped the way a
#: teacher would name them, so a low score can be traced to a region of the
#: body and from there to one measurement.
REGIONS: dict[str, tuple[str, ...]] = {
    "head": ("head_lateral_tilt", "forward_head", "sagittal_ear_offset",
             "lateral_head_shift"),
    "shoulders": ("shoulder_tilt", "sagittal_shoulder_offset",
                  "lateral_shoulder_shift"),
    "pelvis": ("pelvic_obliquity", "sagittal_hip_offset",
               "lateral_pelvis_shift"),
    "trunk": ("trunk_lean_lateral", "trunk_lean_sagittal"),
    "lower_body": ("left_knee_deviation", "right_knee_deviation",
                   "lateral_weight_bias", "sagittal_knee_offset"),
}

#: Ratios are scored against a different yardstick from degrees: a tenth of a
#: torso height is a lot, three degrees is not much. One tenth maps onto the
#: degree scale's zero point so the two land on the same 0-100 line.
RATIO_ZERO_AT = 0.10


@dataclass
class PostureAssessment:
    """One person, one view, one moment: every alignment metric and its score."""

    view: ViewEstimate
    metrics: dict[str, Metric] = field(default_factory=dict)
    #: Why the whole assessment is untrustworthy, when it is. Empty is good.
    warnings: list[str] = field(default_factory=list)
    person_id: str = ""
    #: Fraction of the frame height the body spanned, for the size gate.
    body_fraction: float | None = None
    #: What this assessment could have measured, when the caller knows better
    #: than :data:`VIEW_METRICS` does. A set of photographs covers the union of
    #: its views, and scoring it against one view's row would charge it for
    #: nothing or flatter it -- see :func:`pilates.intake.PhotoAssessment.expected`.
    #: None means "ask the table", which is the case for every single frame.
    expected_override: tuple[str, ...] | None = None

    @property
    def reliable(self) -> bool:
        return not self.warnings and self.view.view is not View.UNKNOWN

    @property
    def measured(self) -> dict[str, Metric]:
        return {n: m for n, m in self.metrics.items() if m.measured}

    def component(self, region: str) -> Component:
        """One region of the body as a scoring component."""
        comp = Component(region)
        for name in REGIONS.get(region, ()):
            metric = self.metrics.get(name)
            if metric is None or not metric.measured:
                continue
            dev = metric.deviation
            if dev is None:
                continue
            scale = ZERO_AT if metric.unit == "deg" else RATIO_ZERO_AT
            comp.checks.append((name, max(0.0, min(100.0, 100.0 * (1.0 - dev / scale)))))
        return comp

    @property
    def expected(self) -> tuple[str, ...]:
        """The metrics this view could have provided. See :data:`VIEW_METRICS`."""
        if self.expected_override is not None:
            return self.expected_override
        return VIEW_METRICS.get(self.view.view, ())

    def score(self) -> Score:
        """The alignment score, on the same machinery as every other score here.

        Reusing :class:`pilates.scoring.Score` is not tidiness. It carries the
        coverage rule -- a headline number is withheld when too little of the
        body was visible -- and writing a second scorer would have been writing
        a second place for that rule to be forgotten.
        """
        score = Score(measurable=max(1, len(self.expected)))
        for region in REGIONS:
            comp = self.component(region)
            if comp.n:
                score.components[region] = comp
        score.missing = [n for n in self.expected
                         if not self.metrics.get(n) or not self.metrics[n].measured]
        return score

    def attention(self) -> list[Metric]:
        """The measurements a teacher should look at, worst first."""
        notable = [m for m in self.measured.values() if m.notable]
        return sorted(notable, key=lambda m: -(m.deviation or 0.0))

    def to_dict(self) -> dict:
        """The API shape. See :func:`pilates.api.posture_payload`."""
        score = self.score()
        return {
            "person_id": self.person_id,
            "view": self.view.view.value,
            "view_confidence": round(self.view.confidence, 3),
            "overall_score": None if score.value is None else round(score.value, 1),
            "score_withheld_reason": score.withheld_reason,
            "coverage": round(score.coverage, 3),
            "components": {n: (None if c.score is None else round(c.score, 1))
                           for n, c in score.components.items()},
            "metrics": {n: m.value for n, m in self.metrics.items()},
            "units": {n: m.unit for n, m in self.metrics.items()},
            "availability": {n: m.availability.value for n, m in self.metrics.items()},
            "confidence": {n: round(m.confidence, 3) for n, m in self.metrics.items()},
            "reasons": {n: m.reason for n, m in self.metrics.items() if m.reason},
            "attention": [m.name for m in self.attention()],
            "warnings": list(self.warnings),
            "reliable": self.reliable,
        }


_ALL_METRIC_NAMES: tuple[str, ...] = tuple(
    name for names in REGIONS.values() for name in names
) + ("torso_rotation_index", "sagittal_pelvic_tilt")

#: What each view can provide at all, which is the only honest denominator for
#: coverage. Scoring a frontal assessment out of every metric in the module
#: would charge it for forward-head -- which no frontal camera can see -- and
#: report a body in full view as two thirds covered. The question coverage
#: answers is "of what this view could have shown, how much did it".
VIEW_METRICS: dict[View, tuple[str, ...]] = {
    View.FRONT: ("head_lateral_tilt", "shoulder_tilt", "pelvic_obliquity",
                 "trunk_lean_lateral", "left_knee_deviation", "right_knee_deviation",
                 "lateral_weight_bias", "torso_rotation_index",
                 "lateral_head_shift", "lateral_shoulder_shift",
                 "lateral_pelvis_shift"),
    View.REAR: ("head_lateral_tilt", "shoulder_tilt", "pelvic_obliquity",
                "trunk_lean_lateral", "left_knee_deviation", "right_knee_deviation",
                "lateral_weight_bias", "torso_rotation_index",
                "lateral_head_shift", "lateral_shoulder_shift",
                "lateral_pelvis_shift"),
    View.SIDE_LEFT: ("forward_head", "trunk_lean_sagittal",
                     "sagittal_ear_offset", "sagittal_shoulder_offset",
                     "sagittal_hip_offset", "sagittal_knee_offset"),
    View.SIDE_RIGHT: ("forward_head", "trunk_lean_sagittal",
                      "sagittal_ear_offset", "sagittal_shoulder_offset",
                      "sagittal_hip_offset", "sagittal_knee_offset"),
    View.UNKNOWN: (),
}


def _zero(value: float) -> float:
    """Fold negative zero into zero. ``-0.0`` in a report reads as a direction."""
    return 0.0 if value == 0 else value


def assess(det: Detection, *, view: View | None = None, person_id: str = "",
           frame_height: int | None = None, threshold: float = THRESHOLD) -> PostureAssessment:
    """Measure one person's standing alignment from one frame.

    ``view`` overrides the estimator, for the case a studio knows where its
    camera is pointed -- which is the common case and always more reliable than
    inferring it.
    """
    estimate = (ViewEstimate(view, 1.0, note="supplied by the caller")
                if view is not None else estimate_view(det, threshold))
    warnings: list[str] = []

    span = body_height_px(det, threshold)
    fraction = None
    if span and span < MIN_BODY_PIXELS:
        # The absolute check, which the fractional one cannot make: a body
        # filling a thumbnail is still a thumbnail's worth of body.
        warnings.append(
            f"the body is {span:.0f} px from shoulder to ankle; below "
            f"{MIN_BODY_PIXELS} px a two-degree difference is inside the "
            f"landmark noise. Take the photograph closer, or larger")
    if frame_height and span:
        fraction = span / float(frame_height)
        if fraction < MIN_BODY_FRACTION:
            warnings.append(
                f"the body spans {fraction:.1%} of frame height; below "
                f"{MIN_BODY_FRACTION:.0%} a one-degree tilt is under a pixel")
    if estimate.view is View.UNKNOWN:
        warnings.append(f"view not established: {estimate.note}")
    if det.confidence < 0.35:
        warnings.append(f"mean joint confidence {det.confidence:.2f} is too low to build on")
    # Confidence is not correctness. See :func:`implausible`, which exists
    # because a model returned 1.00 on a landmark belonging to somebody else.
    warnings.extend(implausible(det, threshold))

    v = estimate.view
    metrics = [
        head_tilt(det, v, threshold),
        forward_head(det, v, threshold),
        shoulder_tilt(det, v, threshold),
        pelvic_obliquity(det, v, threshold),
        trunk_lean(det, v, threshold),
        knee_alignment(det, v, "left", threshold),
        knee_alignment(det, v, "right", threshold),
        weight_bias(det, v, threshold),
        torso_rotation(det, v, threshold),
        sagittal_pelvic_tilt(det, v, threshold),
        *plumb_chain(det, v, threshold),
    ]
    return PostureAssessment(
        view=estimate,
        metrics={m.name: m for m in metrics},
        warnings=warnings,
        person_id=person_id,
        body_fraction=None if fraction is None else round(fraction, 4),
    )


def assess_frame(detections: list[Detection], *, view: View | None = None,
                 frame_height: int | None = None,
                 threshold: float = THRESHOLD) -> list[PostureAssessment]:
    """Every person in one frame, assessed separately.

    Separately is the whole point. Averaging alignment across a class produces
    a number describing nobody, and a class is exactly where the temptation to
    do it arises.
    """
    return [assess(d, view=view, person_id=str(i), frame_height=frame_height,
                   threshold=threshold)
            for i, d in enumerate(detections)]


# ------------------------------------------------------------------ over time

def aggregate(assessments: list[PostureAssessment], *,
              min_frames: int = 5) -> PostureAssessment | None:
    """Combine repeated assessments of one person into a steadier one.

    A standing assessment taken from video should not rest on whichever frame
    happened to be sampled. The median is used rather than the mean because one
    frame where an arm crossed the body moves a mean and does not move a median,
    and that frame is exactly the kind that occurs.

    A metric is carried through only when it was measurable in at least half
    the frames; the spread across frames becomes the metric's confidence, so a
    measurement that wandered is reported as one that wandered.
    """
    usable = [a for a in assessments if a.view.view is not View.UNKNOWN]
    if len(usable) < min_frames:
        return None
    views = [a.view.view for a in usable]
    winner = max(set(views), key=views.count)
    agreed = [a for a in usable if a.view.view is winner]
    if len(agreed) < min_frames:
        return None

    merged: dict[str, Metric] = {}
    for name in _ALL_METRIC_NAMES:
        seen = [a.metrics[name] for a in agreed
                if name in a.metrics and a.metrics[name].measured]
        if len(seen) < max(2, len(agreed) // 2):
            template = next((a.metrics[name] for a in agreed if name in a.metrics), None)
            merged[name] = _unavailable(
                name, template.unit if template else "deg",
                f"measurable in only {len(seen)} of {len(agreed)} frames")
            continue
        values = [float(m.value) for m in seen]
        middle = statistics.median(values)
        spread = statistics.pstdev(values) if len(values) > 1 else 0.0
        scale = ZERO_AT if seen[0].unit == "deg" else RATIO_ZERO_AT
        steadiness = max(0.0, 1.0 - spread / scale)
        merged[name] = Metric(
            name, _zero(round(middle, 3)), seen[0].unit, seen[0].availability,
            round(min(statistics.mean(m.confidence for m in seen), steadiness), 3),
            reason=seen[0].reason, normal=seen[0].normal)

    warnings = sorted({w for a in agreed for w in a.warnings})
    confidence = statistics.mean(a.view.confidence for a in agreed)
    return PostureAssessment(
        view=ViewEstimate(winner, round(confidence, 3),
                          note=f"agreed by {len(agreed)} of {len(assessments)} frames"),
        metrics=merged, warnings=warnings,
        person_id=agreed[0].person_id,
        body_fraction=agreed[0].body_fraction,
    )


# -------------------------------------------------------------- before/after

@dataclass(frozen=True)
class MetricChange:
    """One metric, then and now."""

    name: str
    before: float | None
    after: float | None
    unit: str
    comparable: bool
    reason: str = ""

    @property
    def absolute(self) -> float | None:
        if not self.comparable:
            return None
        return round(float(self.after) - float(self.before), 3)

    @property
    def percent(self) -> float | None:
        """Change as a percentage of the earlier value's magnitude.

        ``None`` when the earlier value was near zero: a shoulder tilt that
        went from 0.1 to 0.4 degrees has not worsened by 300%, it has not
        meaningfully changed, and printing a percentage there is the classic
        way a report manufactures a finding.
        """
        if not self.comparable or abs(float(self.before)) < 1e-6:
            return None
        if abs(float(self.before)) < 0.5:
            return None
        return round(100.0 * (float(self.after) - float(self.before))
                     / abs(float(self.before)), 1)

    @property
    def toward_neutral(self) -> bool | None:
        """Whether the measurement moved closer to level. Not whether it improved.

        A smaller deviation is a smaller deviation. Calling that an improvement
        is a clinical judgement this module does not make and a teacher does.
        """
        if not self.comparable:
            return None
        return abs(float(self.after)) < abs(float(self.before))


@dataclass
class Comparison:
    """Two assessments of the same person, side by side."""

    before: PostureAssessment
    after: PostureAssessment
    changes: dict[str, MetricChange] = field(default_factory=dict)

    @property
    def score_change(self) -> float | None:
        a, b = self.before.score().value, self.after.score().value
        return None if a is None or b is None else round(b - a, 1)

    @property
    def comparable_count(self) -> int:
        return sum(1 for c in self.changes.values() if c.comparable)

    def to_dict(self) -> dict:
        return {
            "before": self.before.to_dict(),
            "after": self.after.to_dict(),
            "score_change": self.score_change,
            "same_view": self.before.view.view is self.after.view.view,
            "comparable_metrics": self.comparable_count,
            "changes": {
                n: {"before": c.before, "after": c.after, "unit": c.unit,
                    "absolute": c.absolute, "percent": c.percent,
                    "toward_neutral": c.toward_neutral,
                    "comparable": c.comparable, "reason": c.reason}
                for n, c in self.changes.items()
            },
        }


def compare(before: PostureAssessment, after: PostureAssessment) -> Comparison:
    """Put two assessments side by side, comparing only what is comparable.

    Two rules, both there to stop a comparison inventing progress:

    * **A metric is compared only when both sides measured it.** A shoulder
      tilt that was visible in March and not in June has not improved to
      nothing; it is simply not part of the comparison, and says so.
    * **Different views are not compared at all.** Shoulder tilt from the front
      and shoulder tilt from the rear differ in sign by construction, and a
      camera moved between visits would otherwise read as a transformation.
    """
    same_view = before.view.view is after.view.view
    changes: dict[str, MetricChange] = {}
    for name in _ALL_METRIC_NAMES:
        a, b = before.metrics.get(name), after.metrics.get(name)
        unit = (a or b).unit if (a or b) else "deg"
        if a is None or b is None or not a.measured or not b.measured:
            missing = "the earlier" if (a is None or not a.measured) else "the later"
            changes[name] = MetricChange(name, a.value if a else None,
                                         b.value if b else None, unit, False,
                                         f"not measured in {missing} assessment")
        elif not same_view:
            changes[name] = MetricChange(name, a.value, b.value, unit, False,
                                         f"assessed from different views "
                                         f"({before.view.view.value} then "
                                         f"{after.view.view.value})")
        else:
            changes[name] = MetricChange(name, a.value, b.value, unit, True)
    return Comparison(before, after, changes)
