"""What the coach saw, which the camera cannot.

A fourth kind of claim, alongside the three the rest of this system already
keeps apart:

* ``measured``  computed from this person's video, with the frames behind it
* ``reference`` anatomy, true of everybody
* ``research``  a population finding with a tier and a citation
* ``observed``  **a person said this, on this date** -- and that is the whole of
  its authority

An observation is the most useful thing in the record and the least mechanical.
It is not weaker than a measurement, it is a different kind of statement: a
camera can say a knee was at 152 degrees and cannot say that this student
guards that knee because of an old injury, that "reach the heel away" works for
them where "straighten the leg" does not, or that today they were exhausted. The
one rule is that the two are never displayed as though they came from the same
place. An observation always carries who made it and when.

**The shape comes from what instructors actually record**, not from what was
convenient to store. Clinical note-taking for Pilates uses SOAP -- subjective,
objective, assessment, plan -- and the working advice is that a note should make
the next session better in under thirty seconds of reading. What that means in
practice, from published instructor guidance: the cues that worked in this
person's own language, what was modified and why, the springs and footbar and
props, safety flags, one to three live goals, and a date to review them.

So the kinds below are not a generic tagging scheme. Each one is a thing a
coach already writes down, and each is stored separately because each is read
back at a different moment: a contraindication before the class, a cue during
it, a goal at the review.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date as _date

#: The tier every observation carries. Never mixed with a measurement.
OBSERVED = "observed"

#: What a coach can write down, and when each is read back.
#:
#: Deliberately a closed set. Free-text tags become a hundred spellings of
#: "tight hamstrings" and nothing can ever be counted or surfaced at the right
#: moment again.
KINDS: dict[str, str] = {
    # Read before the class starts. The only kind that is loud by default.
    "contraindication": "something to avoid, and why",
    # Read during the class.
    "cue": "words that work for this person",
    "modification": "what was changed for them, and why",
    "setting": "springs, footbar, box, props",
    # Read after it, and at the review.
    "subjective": "what they said about how it felt",
    "assessment": "what the coach made of it",
    "goal": "what they are working towards",
    "note": "anything else worth remembering",
}

#: Kinds that stay true until somebody retires them, rather than describing one
#: class. A contraindication from March is still a contraindication in August,
#: and a coach who has to scroll back six sessions to find it will not.
STANDING = ("contraindication", "goal", "cue", "setting")

#: A rating is optional and, when given, is out of five. One scale, because two
#: scales in one record is a unit error waiting to happen: a 7 means nothing
#: unless the reader knows whether it was out of ten.
SCALE = 5

#: How long a note is allowed to be. Not a database limit -- a design one. The
#: guidance is thirty seconds of reading, and a coach who writes an essay writes
#: it once and never again.
MAX_TEXT = 600


@dataclass(frozen=True)
class Observation:
    """One thing a coach wrote down, about a person, on a date."""

    username: str
    kind: str
    text: str
    by: str
    #: Blank when the note is about the person rather than one class.
    session: str = ""
    made_on: str = ""
    #: What it is about. A structure picked off the 3D body, a measured
    #: quantity, an exercise -- or nothing, when it is about the whole person.
    structure: str = ""
    fma: str = ""
    subject: str = ""
    exercise: str = ""
    #: 1..5, or None. What it rates is named, because "4" alone is not data.
    rating: int | None = None
    rates: str = ""
    #: A goal's review date, or a contraindication's expiry. Empty means it
    #: stands until somebody retires it.
    review_on: str = ""
    retired: bool = False
    id: int = 0

    def __post_init__(self):
        if self.kind not in KINDS:
            raise ValueError(f"{self.kind!r} is not one of {sorted(KINDS)}")
        if self.rating is not None and not 1 <= self.rating <= SCALE:
            raise ValueError(f"a rating is 1 to {SCALE}, not {self.rating}")
        if self.rating is not None and not self.rates:
            # A number with nothing attached is the thing this project exists
            # not to produce.
            raise ValueError("a rating has to say what it rates")
        if not self.text.strip():
            raise ValueError("an observation with no text says nothing")
        if not self.by.strip():
            raise ValueError("an observation has to say who made it")
        object.__setattr__(self, "text", self.text.strip()[:MAX_TEXT])
        if not self.made_on:
            object.__setattr__(self, "made_on", _date.today().isoformat())

    @property
    def standing(self) -> bool:
        """Whether this outlives the class it was written in."""
        return self.kind in STANDING and not self.retired

    @property
    def about(self) -> str:
        """The one thing it concerns, for grouping and for display."""
        return self.structure or self.subject or self.exercise or "the whole person"

    def to_dict(self) -> dict:
        out = {
            "id": self.id, "kind": self.kind, "text": self.text,
            "by": self.by, "made_on": self.made_on, "tier": OBSERVED,
            "about": self.about, "standing": self.standing,
        }
        for name in ("session", "structure", "fma", "subject", "exercise",
                     "rates", "review_on"):
            if getattr(self, name):
                out[name] = getattr(self, name)
        if self.rating is not None:
            out["rating"] = self.rating
            out["scale"] = SCALE
        if self.retired:
            out["retired"] = True
        return out


@dataclass
class Sheet:
    """Everything a coach should see before this person's next class.

    Assembled in the order it is read rather than the order it was written:
    what to avoid, then what works, then what they are working towards, then
    the last class. That order is the whole point of the object -- a list
    sorted by date puts a March contraindication six screens below a note about
    a warm-up.
    """

    username: str
    display_name: str = ""
    flags: list[Observation] = field(default_factory=list)
    cues: list[Observation] = field(default_factory=list)
    settings: list[Observation] = field(default_factory=list)
    goals: list[Observation] = field(default_factory=list)
    recent: list[Observation] = field(default_factory=list)

    @property
    def urgent(self) -> bool:
        return bool(self.flags)

    def due(self, on: str = "") -> list[Observation]:
        """Goals whose review date has passed."""
        today = on or _date.today().isoformat()
        return [g for g in self.goals if g.review_on and g.review_on <= today]

    def to_dict(self) -> dict:
        return {
            "username": self.username, "display_name": self.display_name,
            "flags": [o.to_dict() for o in self.flags],
            "cues": [o.to_dict() for o in self.cues],
            "settings": [o.to_dict() for o in self.settings],
            "goals": [o.to_dict() for o in self.goals],
            "recent": [o.to_dict() for o in self.recent],
            "due": [o.to_dict() for o in self.due()],
        }


def sheet(observations: list[Observation], username: str,
          display_name: str = "", recent: int = 8) -> Sheet:
    """Group a person's observations into the order a coach reads them."""
    mine = [o for o in observations if o.username == username]
    mine.sort(key=lambda o: (o.made_on, o.id), reverse=True)
    standing = [o for o in mine if o.standing]
    return Sheet(
        username=username, display_name=display_name,
        flags=[o for o in standing if o.kind == "contraindication"],
        cues=[o for o in standing if o.kind == "cue"],
        settings=[o for o in standing if o.kind == "setting"],
        goals=[o for o in standing if o.kind == "goal"],
        recent=[o for o in mine if o.kind not in STANDING][:recent],
    )


def ratings_over_time(observations: list[Observation], username: str,
                      rates: str = "") -> list[dict]:
    """A rated subject as a series, oldest first.

    Coach ratings are the one number in this system a person chose rather than
    a camera produced, and they are worth plotting for exactly that reason: a
    measurement says the knee reached 170 degrees, and only a coach can say the
    movement looked better. Kept in its own series and never averaged into a
    score -- one is an instrument, the other is an opinion, and a number that
    mixes them can be neither checked nor argued with.
    """
    rows = [o for o in observations
            if o.username == username and o.rating is not None
            and (not rates or o.rates == rates)]
    rows.sort(key=lambda o: (o.made_on, o.id))
    return [{"date": o.made_on, "value": float(o.rating), "scale": SCALE,
             "rates": o.rates, "by": o.by, "text": o.text,
             "about": o.about} for o in rows]
