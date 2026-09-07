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

#: Every axis is scored 0 to 10, which is what makes it chartable -- a verdict
#: cannot be drawn as a line. The page anchors both ends in the structure's own
#: terms; this end only enforces the range.
SCALE = 10

#: What each kind of structure is called when spoken to a coach.
KIND_LABEL = {"muscle": "muscle", "bone": "bone", "nerve": "nerve",
              "organ": "organ", "brain": "brain region"}

#: A word beside the number, because a score with no verdict cannot be sorted
#: and a verdict with no score cannot be drawn. Both are optional; a check with
#: neither is just a note about something the coach looked at.
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
    #: ``[{"label", "axis", "score", "verdict", "note"}]``. ``axis`` is the key
    #: the page derived from this structure's anatomy, so the same question
    #: about the same muscle lines up across classes and can be charted;
    #: ``label`` is what it was called on screen. A coach's own free-typed check
    #: has a label and no axis, and is charted by label instead.
    checks: list = field(default_factory=list)
    #: The one line the student is allowed to read. Everything else on this row
    #: is the coach's working record: the scores reach the student as a chart,
    #: and the prose reaches them only if it was written here on purpose.
    shared: str = ""
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
        self.shared = (self.shared or "").strip()[:MAX_TEXT]

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
            score = raw.get("score", None)
            if score not in (None, ""):
                try:
                    score = int(score)
                except (TypeError, ValueError) as exc:
                    raise ValueError(f"{score!r} is not a score") from exc
                if not 0 <= score <= SCALE:
                    raise ValueError(f"a score is 0 to {SCALE}, not {score}")
            else:
                score = None
            cleaned.append({"label": label,
                            "axis": str(raw.get("axis", "")).strip()[:MAX_LABEL],
                            "score": score, "verdict": verdict,
                            "note": str(raw.get("note", "")).strip()[:MAX_TEXT]})
        self.checks = cleaned

        if not self.note and not self.shared and not self.checks:
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

    def to_dict(self, private: bool = True) -> dict:
        """The row. ``private=False`` is what a student is allowed to see.

        A student gets the scores -- which is what the charts are drawn from --
        and the one line the coach wrote for them. They do not get the coach's
        own note, the per-check notes, or the verdict language: that is working
        material, and a coach who knows it will be read writes less of it.
        """
        from .observations import OBSERVED

        base = {"id": self.id, "username": self.username,
                "structure": self.structure, "kind": self.kind,
                "fma": self.fma, "side": self.side, "tier": OBSERVED,
                "shared": self.shared, "session": self.session,
                "made_on": self.made_on, "made_at": self.made_at}
        if not private:
            return {**base, "checks": [
                {"label": c["label"], "axis": c["axis"], "score": c["score"]}
                for c in self.checks if c["score"] is not None]}
        return {**base, "by": self.by, "note": self.note,
                "checks": [dict(c) for c in self.checks],
                "flagged": self.flagged, "average": self.average,
                "urgent": self.urgent}

    @property
    def average(self) -> float | None:
        """The mean of whatever was scored, for one dot on the overall line.

        Deliberately not weighted and deliberately not a grade: it is the
        centre of this reading, and the per-axis lines are where the meaning
        is. A single number is how the last three versions of this went wrong.
        """
        scored = [c["score"] for c in self.checks if c["score"] is not None]
        return round(sum(scored) / len(scored), 1) if scored else None


def history(evaluations: list[StructureEval], private: bool = True) -> dict:
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
                "lines": {}, "overall": [], "scale": SCALE, "urgent": False,
                "shared": []}

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
    # The scored lines, one per axis, which is what gets drawn. Keyed by the
    # axis the page derived from this structure's anatomy where there is one,
    # so the same question about the same muscle lines up across classes even
    # if the wording on screen changes.
    lines: dict = {}
    for one in ordered:
        for check in one.checks:
            if check["score"] is None:
                continue
            key = check["axis"] or check["label"]
            line = lines.setdefault(key, {"label": check["label"],
                                          "points": []})
            line["label"] = check["label"]
            point = {"date": one.made_on, "score": check["score"]}
            if private:
                point.update(verdict=check["verdict"], note=check["note"],
                             by=one.by)
            line["points"].append(point)
    for line in lines.values():
        points = line["points"]
        line["latest"] = points[-1]["score"]
        line["moved"] = (points[-1]["score"] - points[0]["score"]
                         if len(points) > 1 else 0)

    overall = [{"date": one.made_on, "score": one.average}
               for one in ordered if one.average is not None]
    shared = [{"date": one.made_on, "text": one.shared}
              for one in ordered if one.shared]

    out = {"count": len(ordered),
           "latest": ordered[-1].to_dict(private=private),
           "first_on": ordered[0].made_on, "lines": lines,
           "overall": overall, "scale": SCALE, "shared": shared}
    if not private:
        # A student gets the drawing and the lines it is drawn from. The
        # coach's vocabulary, notes and verdicts are not theirs to read.
        return out
    return {**out, "labels": labels, "runs": runs,
            "urgent": any(e.urgent for e in ordered[-3:])}
