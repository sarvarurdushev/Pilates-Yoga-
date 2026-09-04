"""Deciding which enrolled person a tracked body belongs to.

This is the load-bearing question for everything long-term. Measurements filed
against the wrong person corrupt two histories at once -- one gains a stranger's
numbers, the other loses its own -- and neither is detectable later, because
both still look like plausible records of a real person. A trend built on that
is worse than no trend, and a model trained on it is worse than no model.

So the rule this module is built around: **a wrong identity is worse than no
identity.** Everything else follows from it.

What the camera can and cannot contribute
-----------------------------------------

*Faces are out.* Not on legal grounds first but practical ones: in a wide shot
of a full class a student is between 15 and 60 pixels tall, so a face is a
handful of pixels. Nothing can be recognised from that. The privacy question
never arises because the capability does not exist.

*Clothing works within a session and fails between them.* The tracker already
uses a torso colour histogram to hold identity through an occlusion. People
wear different clothes next week, so it is worthless across sessions.

*Body proportions carry across sessions.* Ratios between limb lengths are
scale-invariant, so they do not change with distance from the camera, and they
do not change with clothing. They are a real signal. They are also a weak one:
plenty of people share proportions, and pose estimation noise moves them.

*The studio already knows who is in the room.* Whoever booked the class is the
candidate set. That turns an impossible open-set recognition problem into a
small matching problem, which is a different and much easier thing.

How the pieces combine
----------------------

A proposal, never a decision. The system ranks the enrolled people who could be
this track and hands that list to somebody who can see the video. A confirmed
assignment is a fact recorded with who confirmed it and when; an unconfirmed
one is a suggestion, and nothing unconfirmed ever reaches a long-term history.

The proposal refuses in the same way the exercise recogniser does, and for the
same reason: low confidence, a narrow margin between the top two candidates, or
a signature unlike anyone enrolled. A shrug is a useful answer here. A
confident wrong answer is the one outcome that cannot be recovered from.
"""
from __future__ import annotations

import json
import statistics
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from . import keypoints as kp
from .movement import TrackHistory
from .types import Detection

#: A link the system worked out but nobody has checked.
PROPOSED = "proposed"
#: A link a person confirmed. The only kind that reaches a long-term history.
CONFIRMED = "confirmed"
#: A link a person looked at and rejected. Kept, because a rejection is
#: evidence: it stops the same wrong proposal being made again.
REJECTED = "rejected"

#: Proportion ratios, all scale-invariant. Distance from the camera divides out,
#: which is what makes them comparable between a front-row and a back-row
#: session.
RATIOS: dict[str, tuple[tuple[int, int], tuple[int, int]]] = {
    "shoulder_to_torso": ((kp.L_SHOULDER, kp.R_SHOULDER), (kp.L_SHOULDER, kp.L_HIP)),
    "hip_to_torso": ((kp.L_HIP, kp.R_HIP), (kp.L_SHOULDER, kp.L_HIP)),
    "thigh_to_torso": ((kp.L_HIP, kp.L_KNEE), (kp.L_SHOULDER, kp.L_HIP)),
    "shank_to_thigh": ((kp.L_KNEE, kp.L_ANKLE), (kp.L_HIP, kp.L_KNEE)),
    "upper_arm_to_torso": ((kp.L_SHOULDER, kp.L_ELBOW), (kp.L_SHOULDER, kp.L_HIP)),
    "forearm_to_upper_arm": ((kp.L_ELBOW, kp.L_WRIST), (kp.L_SHOULDER, kp.L_ELBOW)),
    "leg_to_arm": ((kp.L_HIP, kp.L_ANKLE), (kp.L_SHOULDER, kp.L_WRIST)),
}

#: Frames a signature needs before it means anything.
MIN_SIGNATURE_FRAMES = 20
#: Ratios that must be measurable before a signature is usable at all.
MIN_RATIOS = 4
#: Distance, in typical-variation units, beyond which a track is nobody
#: enrolled. Everyone in the room may be a guest.
MAX_DISTANCE = 3.0
#: The best candidate must beat the second by this much, or the two are too
#: alike to choose between and the system says so instead.
MIN_MARGIN = 0.25
#: Typical spread of each ratio across different people, used to put every
#: ratio on the same scale. A rough population figure, deliberately not fitted
#: to any one studio's members.
RATIO_SCALE = 0.12


def _length(detection: Detection, a: int, b: int, threshold: float) -> float | None:
    if detection.scores[a] < threshold or detection.scores[b] < threshold:
        return None
    value = float(np.linalg.norm(detection.keypoints[a] - detection.keypoints[b]))
    return value if value > 1.0 else None


@dataclass
class Signature:
    """Body proportions for one person, as ratios that survive distance.

    Not a biometric identifier in the sense that matters: it cannot pick a
    stranger out of a crowd, and it is not meant to. It narrows a known roster,
    and a person makes the call.
    """

    ratios: dict[str, float] = field(default_factory=dict)
    frames: int = 0

    @property
    def usable(self) -> bool:
        return self.frames >= MIN_SIGNATURE_FRAMES and len(self.ratios) >= MIN_RATIOS

    @classmethod
    def from_history(cls, history: TrackHistory, detections: list[Detection],
                     threshold: float = 0.4) -> "Signature":
        """The median of each ratio across a clip. A median, so one badly
        estimated frame cannot move it."""
        gathered: dict[str, list[float]] = {}
        for detection in detections:
            for name, ((a, b), (c, d)) in RATIOS.items():
                numerator = _length(detection, a, b, threshold)
                denominator = _length(detection, c, d, threshold)
                if numerator and denominator:
                    gathered.setdefault(name, []).append(numerator / denominator)
        return cls(
            ratios={k: statistics.median(v) for k, v in gathered.items()
                    if len(v) >= 3},
            frames=len(detections),
        )

    def distance(self, other: "Signature") -> float | None:
        """Typical-variation units between two signatures, or None if too few
        ratios are shared to compare them at all."""
        shared = sorted(set(self.ratios) & set(other.ratios))
        if len(shared) < MIN_RATIOS:
            return None
        gaps = [abs(self.ratios[k] - other.ratios[k]) / RATIO_SCALE for k in shared]
        return float(statistics.mean(gaps))

    def merge(self, other: "Signature") -> "Signature":
        """Fold a new session's measurements into a person's running signature.

        Weighted by how many frames each came from, so a long clear session
        counts for more than a brief one at the back of the room.
        """
        total = self.frames + other.frames
        if total == 0:
            return Signature()
        ratios: dict[str, float] = {}
        for name in set(self.ratios) | set(other.ratios):
            mine, theirs = self.ratios.get(name), other.ratios.get(name)
            if mine is None:
                ratios[name] = theirs
            elif theirs is None:
                ratios[name] = mine
            else:
                ratios[name] = (mine * self.frames + theirs * other.frames) / total
        return Signature(ratios=ratios, frames=total)

    def to_dict(self) -> dict:
        return {"ratios": self.ratios, "frames": self.frames}

    @classmethod
    def from_dict(cls, data: dict) -> "Signature":
        return cls(ratios={k: float(v) for k, v in data.get("ratios", {}).items()},
                   frames=int(data.get("frames", 0)))


@dataclass
class Person:
    """Somebody who signed up, and whatever is known about their shape."""

    username: str
    display_name: str = ""
    signature: Signature = field(default_factory=Signature)
    enrolled_at: str = ""
    #: Sessions this person's signature has been confirmed on. The number that
    #: says how much to trust a proposal.
    confirmations: int = 0
    notes: str = ""

    @property
    def name(self) -> str:
        return self.display_name or self.username

    def to_dict(self) -> dict:
        return {
            "username": self.username, "display_name": self.display_name,
            "signature": self.signature.to_dict(), "enrolled_at": self.enrolled_at,
            "confirmations": self.confirmations, "notes": self.notes,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "Person":
        return cls(
            username=data["username"],
            display_name=data.get("display_name", ""),
            signature=Signature.from_dict(data.get("signature", {})),
            enrolled_at=data.get("enrolled_at", ""),
            confirmations=int(data.get("confirmations", 0)),
            notes=data.get("notes", ""),
        )


@dataclass
class Candidate:
    """One enrolled person a track might be, and how good the case is."""

    person: Person
    distance: float
    #: Plain-language reasons, for whoever has to make the call.
    reasons: list[str] = field(default_factory=list)

    #: Nothing here is ever certain, so nothing here ever prints as certain.
    #: A perfect proportion match is still a proposal about a person seen from
    #: across a room, and "100% confident" invites a reader to stop checking.
    MAX_SHOWN_CONFIDENCE = 0.95

    @property
    def confidence(self) -> float:
        """Zero to one, from the distance.

        Presentation only: the decision is made on distance and margin, which
        are the quantities with meaning. Capped below one, because a proposal
        that reads as certain stops being checked, and being checked is the
        entire safeguard.
        """
        raw = max(0.0, 1.0 - self.distance / MAX_DISTANCE)
        return min(raw, self.MAX_SHOWN_CONFIDENCE)


@dataclass
class Proposal:
    """Who the system thinks a track is, or its reason for not saying."""

    track_id: int
    candidates: list[Candidate] = field(default_factory=list)
    #: Why no candidate is being put forward, when none is.
    withheld_reason: str = ""

    @property
    def best(self) -> Candidate | None:
        return self.candidates[0] if self.candidates and not self.withheld_reason else None

    @property
    def named(self) -> bool:
        return self.best is not None

    def describe(self) -> str:
        if self.best is None:
            return f"track {self.track_id}: no proposal — {self.withheld_reason}"
        lines = [f"track {self.track_id}: probably {self.best.person.name} "
                 f"({self.best.confidence:.0%} confident)"]
        for reason in self.best.reasons:
            lines.append(f"    {reason}")
        for other in self.candidates[1:3]:
            lines.append(f"    or {other.person.name} ({other.confidence:.0%})")
        return "\n".join(lines)


def propose(
    signature: Signature,
    roster: list[Person],
    track_id: int = 0,
    max_distance: float = MAX_DISTANCE,
    min_margin: float = MIN_MARGIN,
) -> Proposal:
    """Rank the enrolled people this track could be.

    Refuses in three ways, all of which are useful answers:

    * the signature is too thin to compare -- the student was barely visible;
    * nobody enrolled is close -- a guest, a drop-in, or somebody not yet
      enrolled;
    * the top two are too alike -- two people of similar build, which is
      common, and where a coin flip would put a session in the wrong history.
    """
    result = Proposal(track_id=track_id)
    if not signature.usable:
        result.withheld_reason = (
            f"only {signature.frames} frames and {len(signature.ratios)} usable "
            f"proportions; not enough to compare with anybody")
        return result

    scored: list[Candidate] = []
    for person in roster:
        distance = signature.distance(person.signature)
        if distance is None:
            continue
        reasons = [f"body proportions {distance:.1f} typical-variations away"]
        if person.confirmations:
            reasons.append(f"confirmed {person.confirmations} time(s) before")
        else:
            reasons.append("never confirmed before, so this shape is a first guess")
        scored.append(Candidate(person=person, distance=distance, reasons=reasons))

    scored.sort(key=lambda c: c.distance)
    result.candidates = scored
    if not scored:
        result.withheld_reason = "nobody enrolled has a signature to compare against"
        return result
    if scored[0].distance > max_distance:
        result.withheld_reason = (
            f"the closest enrolled person is {scored[0].distance:.1f} away, "
            f"beyond {max_distance:.1f}; this is probably somebody not enrolled")
        return result
    if len(scored) > 1 and (scored[1].distance - scored[0].distance) < min_margin:
        result.withheld_reason = (
            f"{scored[0].person.name} and {scored[1].person.name} are too alike "
            f"in build to choose between from a wide shot")
    return result


@dataclass
class Link:
    """A track in one session tied to a person, and how that was decided."""

    session: str
    track_id: int
    username: str
    status: str = PROPOSED
    method: str = "proportions"
    distance: float | None = None
    confirmed_by: str = ""
    confirmed_at: str = ""

    @property
    def trustworthy(self) -> bool:
        """Whether this link may be written into a long-term history."""
        return self.status == CONFIRMED

    def confirm(self, by: str) -> "Link":
        return Link(
            session=self.session, track_id=self.track_id, username=self.username,
            status=CONFIRMED, method=self.method, distance=self.distance,
            confirmed_by=by,
            confirmed_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        )

    def reject(self, by: str) -> "Link":
        return Link(
            session=self.session, track_id=self.track_id, username=self.username,
            status=REJECTED, method=self.method, distance=self.distance,
            confirmed_by=by,
            confirmed_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        )

    def to_dict(self) -> dict:
        return {
            "session": self.session, "track_id": self.track_id,
            "username": self.username, "status": self.status,
            "method": self.method, "distance": self.distance,
            "confirmed_by": self.confirmed_by, "confirmed_at": self.confirmed_at,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "Link":
        return cls(
            session=data["session"], track_id=int(data["track_id"]),
            username=data["username"], status=data.get("status", PROPOSED),
            method=data.get("method", "proportions"),
            distance=data.get("distance"),
            confirmed_by=data.get("confirmed_by", ""),
            confirmed_at=data.get("confirmed_at", ""),
        )


@dataclass
class Directory:
    """Everyone enrolled at a studio, as a file a person can read and correct."""

    people: dict[str, Person] = field(default_factory=dict)

    def enrol(self, username: str, display_name: str = "") -> Person:
        if username in self.people:
            return self.people[username]
        person = Person(
            username=username, display_name=display_name,
            enrolled_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        )
        self.people[username] = person
        return person

    def get(self, username: str) -> Person | None:
        return self.people.get(username)

    @property
    def roster(self) -> list[Person]:
        """Enrolled people with a signature worth matching against."""
        return [p for p in self.people.values() if p.signature.usable]

    def learn(self, username: str, signature: Signature) -> Person:
        """Fold a confirmed session's shape into a person's signature.

        Only ever called for a confirmed link. Learning from an unconfirmed one
        would let a single wrong guess drag a person's signature towards
        somebody else, and every later proposal would inherit the error.
        """
        person = self.people[username]
        person.signature = person.signature.merge(signature)
        person.confirmations += 1
        return person

    @classmethod
    def load(cls, path: str | Path) -> "Directory":
        file = Path(path)
        if not file.exists():
            return cls()
        data = json.loads(file.read_text())
        return cls(people={p["username"]: Person.from_dict(p)
                           for p in data.get("people", [])})

    def save(self, path: str | Path) -> None:
        Path(path).write_text(json.dumps(
            {"people": [p.to_dict() for p in
                        sorted(self.people.values(), key=lambda p: p.username)]},
            indent=2) + "\n")
