"""Hands-on adjustments, props and equipment: when a measurement stops being true.

An instructor pressing a student's back is not a complication to be modelled
around. It changes what the number means. The student's hip flexors are no
longer producing the moment that holds their leg up -- somebody else's hands
are taking part of it -- so a load figure computed from body geometry alone is
simply wrong for those seconds, by an amount nothing in the image reveals.

The same is true of props. A block under the hips, a ball under the back, a
strap around a foot: each adds an unmeasured external force at an unknown
point. And a reformer carriage does not merely add force, it changes the
mechanics entirely.

So this module's job is not to estimate through these situations. It is to
notice them and mark the affected measurements as not valid, so a wrong number
is never quietly averaged into a student's history.

The one case that *can* be handled properly is a known hand weight, because
its mass is declared rather than guessed and it acts at a keypoint the camera
can see.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from . import keypoints as kp
from .types import Detection, TrackedPerson

#: A hand within this many body-scales of another person is touching them.
CONTACT_DISTANCE = 0.35
#: Keypoints that count as "a hand doing the adjusting".
HANDS = (kp.L_WRIST, kp.R_WRIST)

#: How long a contact must last before it is treated as an adjustment.
#: One camera cannot see depth, so a hand that merely passes in front of
#: somebody standing further back looks exactly like a hand on their shoulder.
#: What separates them is time: an instructor's correction lasts seconds, a
#: near-miss lasts a frame or two.
MIN_ADJUSTMENT_SECONDS = 0.5
#: A gap this short inside one adjustment is bridged rather than splitting it.
#: Wrist keypoints drop out constantly, and without this one correction is
#: recorded as five.
CONTACT_GAP_SECONDS = 0.5


@dataclass
class Contact:
    """One person's hands on another, in one frame."""

    toucher_id: int
    touched_id: int
    #: Nearest distance, in multiples of the touched person's torso length.
    distance: float
    #: Which of the touched person's keypoints is nearest the hand.
    at_keypoint: int

    @property
    def region(self) -> str:
        """Roughly where on the body, for a note in the report."""
        index = self.at_keypoint
        if index in (kp.L_ANKLE, kp.R_ANKLE, kp.L_KNEE, kp.R_KNEE):
            return "leg"
        if index in (kp.L_HIP, kp.R_HIP):
            return "hip"
        if index in (kp.L_SHOULDER, kp.R_SHOULDER):
            return "shoulder"
        if index in (kp.L_WRIST, kp.R_WRIST, kp.L_ELBOW, kp.R_ELBOW):
            return "arm"
        return "torso"


def _body_scale(detection: Detection, threshold: float) -> float | None:
    """Torso length in pixels, used to make distances size-independent."""
    if any(detection.scores[j] < threshold for j in kp.TRUNK):
        return None
    shoulders = (detection.keypoints[kp.L_SHOULDER] + detection.keypoints[kp.R_SHOULDER]) / 2
    hips = (detection.keypoints[kp.L_HIP] + detection.keypoints[kp.R_HIP]) / 2
    scale = float(np.linalg.norm(shoulders - hips))
    return scale if scale > 1.0 else None


def find_contacts(
    people: list[TrackedPerson],
    threshold: float = 0.4,
    contact_distance: float = CONTACT_DISTANCE,
) -> list[Contact]:
    """Who is touching whom, in one frame.

    Detected from hands rather than from overlapping boxes. Two students on
    neighbouring mats overlap constantly without touching; an instructor
    adjusting someone is specifically a *hand* arriving at their body.

    This still fires on people who are merely close, because one camera has no
    depth: a hand passing in front of somebody standing further back is the
    same picture as a hand on their shoulder. :class:`ContactLog` is what
    resolves that, using duration.
    """
    contacts: list[Contact] = []
    for toucher in people:
        for hand in HANDS:
            if toucher.detection.scores[hand] < threshold:
                continue
            hand_point = toucher.detection.keypoints[hand]
            for touched in people:
                if touched.track_id == toucher.track_id:
                    continue
                scale = _body_scale(touched.detection, threshold)
                if scale is None:
                    continue
                visible = [
                    j for j in range(kp.NUM_KEYPOINTS)
                    if touched.detection.scores[j] >= threshold and j not in HANDS
                ]
                if not visible:
                    continue
                points = touched.detection.keypoints[visible]
                distances = np.linalg.norm(points - hand_point, axis=1) / scale
                nearest = int(np.argmin(distances))
                if float(distances[nearest]) <= contact_distance:
                    contacts.append(Contact(
                        toucher_id=toucher.track_id,
                        touched_id=touched.track_id,
                        distance=float(distances[nearest]),
                        at_keypoint=visible[nearest],
                    ))
    return contacts


def touched_ids(contacts: list[Contact]) -> set[int]:
    """Everyone whose body a hand is near, this frame."""
    return {c.touched_id for c in contacts}


@dataclass
class Adjustment:
    """A contact that lasted long enough to be real, over a span of time."""

    touched_id: int
    toucher_id: int
    start: float
    end: float
    region: str

    @property
    def duration(self) -> float:
        return self.end - self.start

    def contains(self, timestamp: float) -> bool:
        return self.start <= timestamp <= self.end

    def describe(self) -> str:
        return (f"the {self.region}, for {self.duration:.1f}s "
                f"({self.start:.1f}-{self.end:.1f}s)")


@dataclass
class ContactLog:
    """Per-frame contacts turned into adjustments that lasted.

    Proximity in one frame is not evidence of anything. This accumulates it,
    bridges the dropouts, and discards anything too brief to have been a
    correction.
    """

    min_duration: float = MIN_ADJUSTMENT_SECONDS
    gap_tolerance: float = CONTACT_GAP_SECONDS
    #: (touched, toucher) -> list of [start, end, region] runs, newest last.
    _runs: dict[tuple[int, int], list[list]] = field(default_factory=dict)

    def observe(self, timestamp: float, contacts: list[Contact]) -> None:
        for contact in contacts:
            key = (contact.touched_id, contact.toucher_id)
            runs = self._runs.setdefault(key, [])
            if runs and timestamp - runs[-1][1] <= self.gap_tolerance:
                runs[-1][1] = timestamp
                runs[-1][2] = contact.region
            else:
                runs.append([timestamp, timestamp, contact.region])

    def adjustments(self) -> list["Adjustment"]:
        """Every contact that lasted, earliest first."""
        out = [
            Adjustment(touched, toucher, start, end, region)
            for (touched, toucher), runs in self._runs.items()
            for start, end, region in runs
            if end - start >= self.min_duration
        ]
        return sorted(out, key=lambda a: (a.start, a.touched_id))

    def for_student(self, student_id: int) -> list["Adjustment"]:
        return [a for a in self.adjustments() if a.touched_id == student_id]

    def adjusted_at(self, student_id: int, timestamp: float) -> "Adjustment | None":
        for adjustment in self.for_student(student_id):
            if adjustment.contains(timestamp):
                return adjustment
        return None

    def touch_profile(self) -> dict[int, tuple[int, float]]:
        """Per track: how many different people they put hands on, for how long."""
        people: dict[int, set[int]] = {}
        seconds: dict[int, float] = {}
        for adjustment in self.adjustments():
            people.setdefault(adjustment.toucher_id, set()).add(adjustment.touched_id)
            seconds[adjustment.toucher_id] = (
                seconds.get(adjustment.toucher_id, 0.0) + adjustment.duration)
        return {t: (len(who), seconds[t]) for t, who in people.items()}

    def likely_instructor(self, min_people: int = 2) -> int | None:
        """Whoever moved between students putting hands on them.

        This is behaviour, not appearance: nothing here recognises a face or a
        uniform. An instructor circulates, and one person laying hands on
        several different people over a class is a pattern students do not
        produce. Two students helping each other is why the bar is more than
        one person rather than more than none.

        Returns None whenever the evidence is thin -- one adjustment, or a tie.
        Naming the wrong person the instructor is worse than naming nobody,
        because their measurements would then be quietly discarded.
        """
        profile = self.touch_profile()
        ranked = sorted(profile.items(), key=lambda kv: (-kv[1][0], -kv[1][1]))
        if not ranked or ranked[0][1][0] < min_people:
            return None
        if len(ranked) > 1 and ranked[1][1][0] == ranked[0][1][0]:
            return None
        return ranked[0][0]


#: Equipment a studio can declare, and what it does to a load estimate.
EQUIPMENT_EFFECT: dict[str, str] = {
    "hand_weights": "handled — the declared mass is added at the wrists",
    "ankle_weights": "handled — the declared mass is added at the ankles",
    "block": "invalidates load — it supports part of the body at an unknown point",
    "bolster": "invalidates load — it supports part of the body at an unknown point",
    "ball": "invalidates load — it supports part of the body at an unknown point",
    "strap": "invalidates load — it carries tension that cannot be seen",
    "resistance_band": "invalidates load — band tension is unknown and varies with stretch",
    "reformer": "invalidates load — the carriage changes the mechanics entirely, "
                "not just the forces",
    "chair": "invalidates load — spring resistance is unknown",
    "cadillac": "invalidates load — spring resistance is unknown",
}

#: Equipment whose effect can be modelled rather than merely refused.
MODELLABLE = ("hand_weights", "ankle_weights")


@dataclass
class EquipmentDeclaration:
    """What the studio says was in use. Declared, not detected.

    Detecting equipment from video is possible in principle and unreliable in
    practice: a block under a hip is occluded by the hip. Asking is both more
    accurate and honest about where the knowledge came from.
    """

    items: dict[str, float] = field(default_factory=dict)   # name -> kg, where relevant

    @property
    def invalidating(self) -> list[str]:
        """Declared items that make a gravity-only load estimate untrue."""
        return sorted(name for name in self.items if name not in MODELLABLE)

    @property
    def blocks_load(self) -> bool:
        return bool(self.invalidating)

    def explain(self) -> str:
        if not self.items:
            return "No equipment declared."
        lines = []
        for name in sorted(self.items):
            effect = EQUIPMENT_EFFECT.get(name, "unknown to this system — load not estimated")
            mass = self.items[name]
            weight = f" ({mass:.1f} kg)" if name in MODELLABLE and mass else ""
            lines.append(f"  {name}{weight}: {effect}")
        return "\n".join(lines)

    def added_mass(self) -> dict[int, float]:
        """Extra mass to attach at specific keypoints, for what can be modelled."""
        out: dict[int, float] = {}
        if (kg := self.items.get("hand_weights", 0.0)) > 0:
            out[kp.L_WRIST] = kg
            out[kp.R_WRIST] = kg
        if (kg := self.items.get("ankle_weights", 0.0)) > 0:
            out[kp.L_ANKLE] = kg
            out[kp.R_ANKLE] = kg
        return out


@dataclass
class ValidityNote:
    """Why a measurement was or was not kept."""

    valid: bool
    reason: str = ""

    def __bool__(self) -> bool:
        return self.valid


def load_validity(
    student_id: int,
    contacts: list[Contact],
    equipment: EquipmentDeclaration | None = None,
) -> ValidityNote:
    """Whether a load estimate for this student, this frame, means anything.

    Frame-level and therefore deliberately cautious: it refuses on a single
    frame's proximity. Use :meth:`ContactLog.adjusted_at` when a whole clip is
    available, which only refuses over spans that actually lasted.
    """
    if equipment is not None and equipment.blocks_load:
        items = ", ".join(equipment.invalidating)
        return ValidityNote(False, f"{items} in use, which carries part of the load")
    for contact in contacts:
        if contact.touched_id == student_id:
            return ValidityNote(False, _supported_reason(contact.region))
    return ValidityNote(True)


def _supported_reason(region: str) -> str:
    return (f"an instructor was supporting the {region}, so the student was "
            f"not producing this load alone")


def session_validity(
    student_id: int,
    timestamp: float,
    log: ContactLog | None = None,
    equipment: EquipmentDeclaration | None = None,
) -> ValidityNote:
    """Validity for one student at one moment, judged over the whole clip.

    This is the version to use for anything that reaches a student's history.
    A load measured while somebody's hands were on them is not a slightly noisy
    reading of that student's strength; it is a reading of two people, and
    averaging it into a trend makes the trend wrong rather than imprecise.
    """
    if equipment is not None and equipment.blocks_load:
        items = ", ".join(equipment.invalidating)
        return ValidityNote(False, f"{items} in use, which carries part of the load")
    if log is not None:
        adjustment = log.adjusted_at(student_id, timestamp)
        if adjustment is not None:
            return ValidityNote(False, _supported_reason(adjustment.region))
    return ValidityNote(True)
