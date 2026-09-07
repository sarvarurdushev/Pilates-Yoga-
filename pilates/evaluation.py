"""What a coach scores after a class, on the axes they already teach in.

The observations module holds what a coach *writes*. This holds what a coach
*rates* -- and the two are different jobs. A note is prose about one moment; an
evaluation is the same five judgements made every time, so that the third one
can be compared with the first.

**The five axes are not invented here.** They are the STOTT PILATES Five Basic
Principles, which is what contemporary instructor training is built on and what
an instructor is already watching for, in this order, on every repetition:
breathing, pelvic placement, rib cage placement, scapular movement and
stabilisation, head and cervical placement. Published instructor guidance
describes exactly this: *every movement is monitored and corrected in real time
-- pelvic alignment, rib cage position, scapular control, breath pattern.* A
studio that scores anything else has to invent a vocabulary; a studio that
scores these is writing down the lesson it just taught.

Two things follow from that, and they are the design:

1. **The axes are fixed and closed.** A coach who can add their own axis ends up
   with fifteen, each used twice, and nothing that can be charted. Five, always
   the same five, is what makes a line.
2. **Every score carries a note field, and the note is the valuable half.**
   *"3 -- rib cage flares on the second half of every roll-down"* is worth more
   than the 3, and a rubric that only takes the number throws it away.

An evaluation is an ``observed`` claim like any other: it says who made it and
when, and it is never displayed as though a camera produced it.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone

#: The five, in the order an instructor works through them. The key is stored;
#: the label is what a person reads; the watch-for is what the coach is actually
#: looking at, taken from instructor training material rather than paraphrased.
PRINCIPLES: dict[str, dict] = {
    "breathing": {
        "label": "Breathing",
        "watch": "Three-dimensional rib expansion, in synch with the deep "
                 "abdominals and pelvic floor. Are they holding it?",
    },
    "pelvic": {
        "label": "Pelvic placement",
        "watch": "Neutral or imprint, held on purpose rather than by gripping. "
                 "Everything upstream depends on this.",
    },
    "ribcage": {
        "label": "Rib cage placement",
        "watch": "Ribs staying knitted as the arms move, rather than flaring "
                 "into spinal extension.",
    },
    "scapular": {
        "label": "Scapular movement",
        "watch": "Organised on the rib cage and still free to move. Not "
                 "permanently pinned down and back.",
    },
    "cervical": {
        "label": "Head and cervical",
        "watch": "The curve of the neck continuing the curve of the spine, "
                 "chin neither jammed down nor poking forward.",
    },
}

#: One to five. Bounded and small on purpose: an instructor asked for a number
#: out of ten gives sevens, and a scale nobody uses the ends of is a scale with
#: three points and extra typing.
SCALE = 5

#: What each point means, so that two coaches at the same studio mean the same
#: thing by a 3 -- which is the only way the line is worth drawing at all.
ANCHORS: dict[int, str] = {
    1: "not there yet; needs hands-on cueing every repetition",
    2: "finds it when cued, loses it immediately",
    3: "holds it with a reminder, loses it under load or fatigue",
    4: "holds it unprompted through the whole exercise",
    5: "holds it under load, under fatigue, and in new movements",
}

#: How the class went as a whole, which is not the average of the five and
#: should not be computed as one -- a session can be technically poor and
#: exactly the right session for somebody who came in exhausted.
EFFORT = {
    "light": "took it easy, deliberately or otherwise",
    "steady": "worked at their usual level",
    "hard": "pushed, and it showed",
}

MAX_TEXT = 600


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def today() -> str:
    return datetime.now(timezone.utc).date().isoformat()


@dataclass
class Evaluation:
    """One class, scored on the five, by one coach, on one date.

    Every field except the scores is optional, because a coach with ninety
    seconds between classes will fill in three of them and a form that refuses
    that is a form that gets filled in never.
    """

    username: str
    by: str
    scores: dict = field(default_factory=dict)
    notes: dict = field(default_factory=dict)
    #: What they actually did, in the coach's shorthand.
    did: str = ""
    #: Springs, footbar, box, props. The thing that is always forgotten by the
    #: next class and always needed at the start of it.
    settings: str = ""
    #: The cue that worked, in the student's own words where possible.
    cue: str = ""
    #: What to do next time. The single most re-read line in any studio note.
    plan: str = ""
    effort: str = "steady"
    session: str = ""
    made_on: str = field(default_factory=today)
    made_at: str = field(default_factory=now)
    id: int | None = None

    def __post_init__(self) -> None:
        if not (self.username or "").strip():
            raise ValueError("an evaluation has to be about somebody")
        if not (self.by or "").strip():
            raise ValueError("an evaluation has to say who made it")

        unknown = set(self.scores) - set(PRINCIPLES)
        if unknown:
            raise ValueError(f"not one of the five principles: {sorted(unknown)}")
        cleaned = {}
        for key, value in self.scores.items():
            if value in (None, ""):
                continue
            try:
                score = int(value)
            except (TypeError, ValueError) as exc:
                raise ValueError(f"{value!r} is not a score") from exc
            if not 1 <= score <= SCALE:
                raise ValueError(f"a score is 1 to {SCALE}, not {score}")
            cleaned[key] = score
        self.scores = cleaned

        self.notes = {k: str(v).strip()[:MAX_TEXT]
                      for k, v in (self.notes or {}).items()
                      if k in PRINCIPLES and str(v).strip()}
        if self.effort not in EFFORT:
            raise ValueError(f"{self.effort!r} is not one of {sorted(EFFORT)}")
        for name in ("did", "settings", "cue", "plan"):
            setattr(self, name, (getattr(self, name) or "").strip()[:MAX_TEXT])

        if not self.scores and not any((self.did, self.settings, self.cue,
                                        self.plan)):
            raise ValueError("an evaluation with nothing in it says nothing")

    @property
    def average(self) -> float | None:
        """Only where all five were scored.

        A mean of the two axes somebody happened to fill in is not comparable
        with a mean of five, and putting them on the same line is the kind of
        quiet nonsense this project exists to avoid.
        """
        if len(self.scores) != len(PRINCIPLES):
            return None
        return round(sum(self.scores.values()) / len(self.scores), 2)

    @property
    def weakest(self) -> str:
        """The axis to work on next, which is what the coach opens this for."""
        if not self.scores:
            return ""
        key = min(self.scores, key=lambda k: self.scores[k])
        return PRINCIPLES[key]["label"]

    def to_dict(self) -> dict:
        from .observations import OBSERVED

        return {"id": self.id, "username": self.username, "by": self.by,
                "tier": OBSERVED, "scores": dict(self.scores),
                "notes": dict(self.notes), "did": self.did,
                "settings": self.settings, "cue": self.cue, "plan": self.plan,
                "effort": self.effort, "session": self.session,
                "made_on": self.made_on, "made_at": self.made_at,
                "average": self.average, "weakest": self.weakest,
                "complete": len(self.scores) == len(PRINCIPLES)}


def series(evaluations: list[Evaluation]) -> dict:
    """Each principle as a line, oldest first, for the charts.

    Only scored points appear. A principle a coach skipped is a gap in the line
    and not a zero -- the difference between *not looked at* and *bad* is the
    whole reason for scoring anything.
    """
    ordered = sorted(evaluations, key=lambda e: (e.made_on, e.made_at))
    out = {}
    for key, meta in PRINCIPLES.items():
        points = [{"date": e.made_on, "value": e.scores[key], "by": e.by,
                   "note": e.notes.get(key, "")}
                  for e in ordered if key in e.scores]
        out[key] = {"label": meta["label"], "watch": meta["watch"],
                    "points": points, "scale": SCALE,
                    "latest": points[-1]["value"] if points else None,
                    "moved": (points[-1]["value"] - points[0]["value"])
                             if len(points) > 1 else 0}
    return out


def summary(evaluations: list[Evaluation]) -> dict:
    """What the coach needs before the next class, in one glance.

    Not an average of averages: the last complete evaluation, what has moved
    since the first one, and the axis that is furthest behind.
    """
    ordered = sorted(evaluations, key=lambda e: (e.made_on, e.made_at))
    lines = series(ordered)
    scored = [(key, line) for key, line in lines.items() if line["points"]]
    focus = min(scored, key=lambda kv: kv[1]["latest"])[0] if scored else ""
    # Nobody scored yet is the same shape with nothing in it, not a shorter
    # dictionary. The first version returned four keys for an empty history and
    # eight otherwise, and the caller that read the ninth got a KeyError the
    # first time it met a student nobody had evaluated -- which is every student
    # in their first week.
    return {
        "evaluations": len(ordered),
        "latest": ordered[-1].to_dict() if ordered else None,
        "first_on": ordered[0].made_on if ordered else "",
        "focus": focus,
        "focus_label": PRINCIPLES[focus]["label"] if focus else "",
        "lines": lines,
        "anchors": ANCHORS,
        "principles": PRINCIPLES,
    }
