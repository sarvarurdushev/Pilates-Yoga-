"""A coach's reading of one structure, written the coach's way.

The first version of this guessed. It shipped five fixed questions per kind of
structure -- recruitment, timing, endurance, length, symmetry for every muscle
in the body -- and that is wrong twice over. It is wrong because the psoas and
the anconeus do not raise the same questions, and it is wrong because a person
who has taught for fifteen years does not need a form telling them what to look
at. Guessing a rubric and calling it anatomy is worse than admitting the rubric
is the coach's to write.

So the shape here is deliberately thin:

**The coach names what they watched.** A *check* is a line of their own words --
"ribs against the pelvis", "does it let go at the bottom", "left vs right at the
top" -- and it belongs to them, not to this file. Whatever they type for a
structure comes back the next time that structure is opened, so the second
reading is one press and the vocabulary is theirs.

**The verdict is three values, and that is the only thing fixed.** ``fine`` /
``watch`` / ``problem``. Three rather than five because the reliability
literature on visual movement assessment is consistent that agreement improves
with coarse rating and collapses on fine graded scales -- and because a scale
nobody uses the ends of is a three-point scale with extra typing anyway.

**Suggestions, not requirements.** Each kind of structure carries a short list of
starting points, because a blank box is its own kind of hostile. They are chips
to press, edit or ignore. Nothing here is mandatory except saying *something*.

The one place this file still asserts something is a nerve. A coach does not
assess a nerve; they notice a symptom in its area and decide whether to carry
on, modify, or send the person to somebody qualified. That is not a rubric, it
is a scope-of-practice boundary, and the suggestions for a nerve are written to
lead to that decision. A brain and an organ take no reading at all, and the
panel says why rather than greying a form out.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone

MAX_TEXT = 600
MAX_LABEL = 90
MAX_CHECKS = 24

#: What each kind of structure is called when spoken to a coach.
KIND_LABEL = {"muscle": "muscle", "bone": "bone", "nerve": "nerve",
              "organ": "organ", "brain": "brain region"}

#: The whole fixed vocabulary. Three values, because agreement on visual
#: movement judgements improves with coarse rating and falls apart on fine ones,
#: and because a coach with ninety seconds is not going to weigh a 3 against a 4.
VERDICTS = {
    "fine": "fine",
    "watch": "worth watching",
    "problem": "a problem",
}

#: Starting points, per kind. Chips to press, edit or ignore -- never a form to
#: complete. Short on purpose: a long list of suggestions is a form wearing a
#: disguise.
SUGGESTED = {
    "muscle": [
        "how much work it's doing",
        "when it comes in",
        "does it hold through the set",
        "left against right",
        "what took over instead",
        "does it let go between reps",
    ],
    "bone": [
        "where it sits at the start",
        "does it stay there under load",
        "how much range",
        "where the control goes",
        "against the segment above and below",
    ],
    "nerve": [
        "what they reported",
        "what brought it on",
        "how long it lasted",
        "carried on / modified / sent them to get it looked at",
    ],
}

#: The kinds a coach may not assess, and the reason -- shown instead of a form.
#: Saying "not available" would be a bug report; saying why is a design.
CLOSED = {
    "brain": "Nothing in a Pilates class measures a brain, and a coach is not "
             "the person to judge one. What is drawn here is published anatomy: "
             "where a movement of this kind has involved this region in other "
             "people. It is not a reading of anybody in this room.",
    "organ": "An organ is not assessed from the outside of a body in a "
             "movement class. It is drawn so the structures around it make "
             "sense, and for no other reason.",
}

#: The one line this file insists on, and only for a nerve. Not a banner and not
#: a colour: a sentence under the heading, in the same grey as everything else.
NERVE_NOTE = ("A symptom, not a diagnosis. If it outlasted the class, is "
              "spreading, or happens away from class, that is a referral.")

OPEN_KINDS = ("muscle", "bone", "nerve")


def form_for(kind: str, seen: list[str] | None = None) -> dict:
    """What to offer for this kind of structure.

    ``seen`` is what this coach has already written about *this* structure, and
    it comes first: their own words beat anything suggested here.
    """
    kind = (kind or "").lower()
    if kind in CLOSED:
        return {"kind": kind, "open": False, "why": CLOSED[kind],
                "suggested": [], "verdicts": VERDICTS, "note": ""}
    if kind not in OPEN_KINDS:
        # An unknown kind gets a free note and nothing invented. Making up
        # checks for something nobody has thought about is how a form ends up
        # asking a coach to rate the recruitment of a ligament.
        return {"kind": kind, "open": True, "suggested": [],
                "verdicts": VERDICTS, "note": ""}
    mine = [s for s in (seen or []) if s]
    extra = [s for s in SUGGESTED[kind] if s not in mine]
    return {"kind": kind, "open": True,
            "suggested": mine + extra, "yours": len(mine),
            "verdicts": VERDICTS,
            "note": NERVE_NOTE if kind == "nerve" else ""}


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def today() -> str:
    return datetime.now(timezone.utc).date().isoformat()


@dataclass
class StructureEval:
    """One reading: some free words, and any number of the coach's own checks."""

    username: str
    by: str
    structure: str
    kind: str
    fma: str = ""
    side: str = ""
    #: Free prose. The only thing that is ever required is that *something* is
    #: here or in a check -- a coach who only wants to write a sentence should
    #: never have to press a button first.
    note: str = ""
    #: ``[{"label": ..., "verdict": ..., "note": ...}]`` -- the labels are the
    #: coach's own words, in the order they wrote them.
    checks: list = field(default_factory=list)
    session: str = ""
    made_on: str = field(default_factory=today)
    made_at: str = field(default_factory=now)
    id: int | None = None

    def __post_init__(self) -> None:
        if not (self.username or "").strip():
            raise ValueError("a reading has to be about somebody")
        if not (self.by or "").strip():
            raise ValueError("a reading has to say who made it")
        if not (self.structure or "").strip():
            raise ValueError("a reading has to say which structure")
        kind = (self.kind or "").lower()
        if kind in CLOSED:
            raise ValueError(f"a {kind} is not assessable here: {CLOSED[kind]}")
        self.kind = kind
        self.note = (self.note or "").strip()[:MAX_TEXT]

        cleaned = []
        for raw in (self.checks or [])[:MAX_CHECKS]:
            if isinstance(raw, str):
                raw = {"label": raw}
            label = str(raw.get("label", "")).strip()[:MAX_LABEL]
            if not label:
                continue
            verdict = str(raw.get("verdict", "")).strip()
            if verdict and verdict not in VERDICTS:
                raise ValueError(f"{verdict!r} is not one of {sorted(VERDICTS)}")
            cleaned.append({"label": label, "verdict": verdict,
                            "note": str(raw.get("note", "")).strip()[:MAX_TEXT]})
        self.checks = cleaned

        if not self.note and not self.checks:
            raise ValueError("a reading with nothing in it says nothing")

    @property
    def flagged(self) -> list[str]:
        """The checks that were not fine.

        What a coach wants back is not every answer, it is the ones that were
        not fine -- so this is what the list of readings shows.
        """
        return [f"{c['label']} — {VERDICTS[c['verdict']]}"
                for c in self.checks
                if c["verdict"] in ("watch", "problem")]

    @property
    def urgent(self) -> bool:
        """A nerve called a problem, and nothing else.

        Only a nerve escalates. An over-working psoas is a note; a system that
        alarms on everything gets switched off.
        """
        return self.kind == "nerve" and any(
            c["verdict"] == "problem" for c in self.checks)

    @property
    def labels(self) -> list[str]:
        return [c["label"] for c in self.checks]

    def to_dict(self) -> dict:
        from .observations import OBSERVED

        return {"id": self.id, "username": self.username, "by": self.by,
                "structure": self.structure, "kind": self.kind,
                "fma": self.fma, "side": self.side, "tier": OBSERVED,
                "note": self.note,
                "checks": [dict(c) for c in self.checks],
                "session": self.session, "made_on": self.made_on,
                "made_at": self.made_at, "flagged": self.flagged,
                "urgent": self.urgent}


def history(evaluations: list[StructureEval]) -> dict:
    """This structure over time, and the vocabulary to offer for it again.

    ``labels`` is the point: whatever this coach called things last time comes
    back as a chip, so the second reading of a psoas is one press rather than
    typing the same phrase again.
    """
    ordered = sorted(evaluations, key=lambda e: (e.made_on, e.made_at))
    labels: list[str] = []
    for one in ordered:          # newest last, so later wording wins the order
        for label in one.labels:
            if label in labels:
                labels.remove(label)
            labels.append(label)
    labels.reverse()
    if not ordered:
        return {"count": 0, "latest": None, "labels": [], "runs": {},
                "urgent": False}

    # How each check has gone, oldest first. The same label coming back
    # `problem` four classes running is the finding -- once is a bad day.
    runs: dict[str, list] = {}
    for one in ordered:
        for check in one.checks:
            if not check["verdict"]:
                continue
            runs.setdefault(check["label"], []).append({
                "date": one.made_on, "verdict": check["verdict"],
                "note": check["note"], "by": one.by})
    return {"count": len(ordered), "latest": ordered[-1].to_dict(),
            "first_on": ordered[0].made_on, "labels": labels, "runs": runs,
            "urgent": any(e.urgent for e in ordered[-3:])}
