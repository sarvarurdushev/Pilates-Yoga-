"""What a coach can judge about *this* structure, which depends on what it is.

The five-principle rubric in ``evaluation.py`` scores a class. This scores a
**structure** -- the thing on the screen when a coach clicks a muscle -- and the
whole point is that the questions are not the same for every structure.

Asking "score the breathing, 1 to 5" about the sciatic nerve is nonsense. Asking
"is it over-recruiting" about the fifth lumbar vertebra is nonsense. A form that
asks the same thing everywhere is a form that is wrong almost everywhere, and the
coach fills it in wrong or not at all.

So the form is a function of the structure's kind, and each kind's axes come from
what that discipline actually assesses:

**Muscles** are judged by *recruitment*, and specifically by too much of it.
Instructor material is consistent that the characteristic fault in Pilates is not
weakness but over-gripping and substitution -- "muscling through" with the
shoulders or the quadriceps, hip flexors taking over from the abdominals in the
teaser and the double leg stretch, over-gripping the abdominals so hard that the
breath stops. So the recruitment axis is symmetrical around *about right*, with
failure modes on both sides. Timing, endurance, length and side-to-side symmetry
are the other four things a coach can see without instruments.

**Bones** are not recruited; they are *placed*. What a coach judges is position
against neutral, the range actually available, where in that range control is
lost, and whether the segment tolerates load. Clinical joint assessment records
active and passive range, end feel, and -- explicitly -- whether pain limited the
motion, which matters as much as the number. A coach cannot take an end feel
through a reformer, so this asks for what they can see.

**Nerves are not scored at all.** No coach evaluates a nerve. What they can
observe is a *symptom in a distribution*, and what they must do about it is
decided by a framework the fitness professions already use: **stop, modify, or
refer**. Radiating or tingling symptoms fall outside exercise-based management,
and the discriminator that the literature keeps naming is *time*: tingling that
clears within five to ten minutes of stopping is generally unremarkable, while
tingling that persists, spreads, or appears unrelated to activity warrants a
look by somebody qualified to give it. That is exactly what this form asks, and
it ends at a referral rather than a rating.

**Brains and organs cannot be assessed here at all**, and the form says so
instead of offering fields. This is the same promise the bundle makes in its own
notice: nothing in this application measured a nerve, a bone's load, or anything
about a brain.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone

MAX_TEXT = 600

#: What each kind of structure is called when spoken to a coach.
KIND_LABEL = {"muscle": "muscle", "bone": "bone", "nerve": "nerve",
              "organ": "organ", "brain": "brain region"}


def _axis(key, label, ask, options, *, note=True, mid=None):
    """One question, its wording, and the answers it accepts.

    ``mid`` names the answer that means *nothing to do here*, which is what the
    interface uses to decide whether a structure shows up on the follow-up list.
    Not every axis has one -- "where is control lost" has no good answer.
    """
    return {"key": key, "label": label, "ask": ask, "options": options,
            "note": note, "mid": mid}


#: -------------------------------------------------------------------- muscle
#:
#: Ordered the way a coach works: what it did, when it did it, how long it held,
#: how long it is, and whether the two sides agree.
MUSCLE_AXES = [
    _axis("recruitment", "Recruitment",
          "How much work is it doing for this exercise?",
          [("silent", "not firing at all", "nothing happening here when it should be"),
           ("under", "under-working", "contributing, but something else is carrying it"),
           ("right", "about right", "doing its share and no more"),
           ("over", "over-working", "doing somebody else's job as well as its own"),
           ("gripping", "gripping", "held hard and continuously — the breath usually goes with it")],
          mid="right"),
    _axis("timing", "Timing",
          "When does it come in, relative to the movement?",
          [("early", "fires first", "dominant — it starts the movement it should be assisting"),
           ("ontime", "on time", ""),
           ("late", "comes in late", "the movement has already started without it"),
           ("never", "never comes in", "")],
          mid="ontime"),
    _axis("endurance", "Endurance",
          "Does it hold across the set?",
          [("holds", "holds throughout", ""),
           ("fades_late", "fades near the end", "usually normal, and worth knowing"),
           ("fades_early", "fades in the first few reps", "the load is probably wrong"),
           ("na", "couldn't tell", "")],
          mid="holds"),
    _axis("length", "Length",
          "How much range does it allow?",
          [("short", "restricted", "the range stops here rather than at the joint"),
           ("normal", "normal", ""),
           ("lax", "very long / lax", "range is available but uncontrolled"),
           ("na", "didn't test", "")],
          mid="normal"),
    _axis("symmetry", "Side to side",
          "Compared with the other side.",
          [("weaker", "this side is doing less", ""),
           ("even", "even", ""),
           ("stronger", "this side is doing more", ""),
           ("na", "not paired / couldn't tell", "")],
          mid="even"),
]

MUSCLE_FIELDS = [
    ("substitutes", "What took over instead",
     "e.g. hip flexors and the front of the neck", "line"),
    ("cue", "The cue that worked", "their words if you have them", "line"),
    ("plan", "Next time", "", "area"),
]

#: ---------------------------------------------------------------------- bone
BONE_AXES = [
    _axis("alignment", "Where it sits",
          "Position at the start, and whether it stays there.",
          [("neutral", "neutral, and holds", ""),
           ("neutral_drifts", "starts neutral, drifts under load", "the commonest finding"),
           ("anterior", "tipped / translated forward", ""),
           ("posterior", "tipped / translated back", ""),
           ("rotated", "rotated", ""),
           ("side", "shifted or tilted to one side", ""),
           ("na", "couldn't see it", "")],
          mid="neutral"),
    _axis("range", "Range",
          "How much movement is available at the joints it makes?",
          [("limited", "limited", "the range genuinely is not there"),
           ("full", "full and useful", ""),
           ("hyper", "beyond useful", "moves further than it can control"),
           ("na", "didn't test", "")],
          mid="full"),
    _axis("control", "Where control is lost",
          "Not whether — where. It is almost never at the end.",
          [("start", "at the start of the range", ""),
           ("mid", "through the middle", ""),
           ("end", "at the end range", ""),
           ("throughout", "never really had it", ""),
           ("held", "held throughout", "")],
          mid="held"),
    _axis("load", "Under load",
          "What happens when the spring, the lever or the body weight goes on.",
          [("tolerates", "takes it", ""),
           ("guards", "guards or braces", "protective, and worth naming"),
           ("gives", "gives way at one segment", "a hinge point"),
           ("sore", "they reported discomfort", "record what they said, not a diagnosis"),
           ("na", "not loaded today", "")],
          mid="tolerates"),
    _axis("stacking", "Against the segment above and below",
          "A bone is only ever in a relationship.",
          [("stacked", "stacked", ""),
           ("hinge", "the movement hinges here", "one segment doing the work of several"),
           ("blocked", "moves as a block with its neighbours", ""),
           ("na", "couldn't tell", "")],
          mid="stacked"),
]

BONE_FIELDS = [
    ("landmark", "What you were watching", "e.g. the lower ribs against the pelvis", "line"),
    ("cue", "The cue that worked", "their words if you have them", "line"),
    ("plan", "Next time", "", "area"),
]

#: --------------------------------------------------------------------- nerve
#:
#: Not a rating. A symptom report and a decision.
NERVE_AXES = [
    _axis("symptom", "What they reported",
          "In the area this nerve supplies. Their words, not your conclusion.",
          [("none", "nothing today", ""),
           ("tingling", "tingling / pins and needles", ""),
           ("numb", "numbness or a dead patch", ""),
           ("burning", "burning", ""),
           ("shooting", "shooting or electric", ""),
           ("weak", "weakness or heaviness", ""),
           ("other", "something else — write it below", "")],
          mid="none"),
    _axis("provoked", "What brought it on",
          "",
          [("position", "one position", ""),
           ("load", "load", ""),
           ("endrange", "the end of a range", ""),
           ("sustained", "holding still for a while", ""),
           ("nothing", "nothing we could find", ""),
           ("na", "not applicable", "")],
          mid="na"),
    _axis("settled", "How long it lasted",
          "This is the question that decides what happens next.",
          [("seconds", "gone within seconds of changing position", ""),
           ("under10", "cleared within about ten minutes of stopping", "generally unremarkable"),
           ("persisted", "still there when they left", "needs somebody qualified to look"),
           ("spreading", "spreading, or bigger than last time", "needs somebody qualified to look, now"),
           ("unrelated", "they get it away from class too", "needs somebody qualified to look"),
           ("na", "not applicable", "")],
          mid="na"),
    _axis("action", "What you did",
          "Stop, modify, or refer — the decision, recorded.",
          [("carried", "carried on", ""),
           ("modified", "modified the exercise", ""),
           ("stopped", "stopped the exercise", ""),
           ("referred", "told them to get it looked at", ""),
           ("referred_urgent", "told them to get it looked at today", "")],
          mid="carried"),
]

NERVE_FIELDS = [
    ("where", "Where they felt it", "their description of the area", "line"),
    ("said", "What they actually said", "", "area"),
    ("plan", "What happens next", "", "area"),
]

#: The kinds a coach may not assess, and the reason, which is shown instead of
#: a form. Saying "not available" would be a bug report; saying why is a design.
CLOSED = {
    "brain": "Nothing in a Pilates class measures a brain, and a coach is not "
             "the person to judge one. What is shown here is published anatomy "
             "-- where a movement of this kind has been seen to involve this "
             "region in other people. It is not a reading of anybody in this "
             "room, so there is nothing here to score.",
    "organ": "An organ is not assessed from the outside of a body in a "
             "movement class. It is drawn here so that the structures around "
             "it make sense, and for no other reason.",
}

#: The prompt on every axis's note box. Per kind, because "what did you see" is
#: the wrong question about a nerve: a coach does not see a symptom, they are
#: told about one, and a note box that asks them to have seen it invites them to
#: write down an inference as an observation.
NOTE_HINT = {
    "muscle": "What did you actually see? (optional, and the useful half)",
    "bone": "What did you actually see? (optional, and the useful half)",
    "nerve": "Their words, if you have them (optional, and the useful half)",
}

FORMS = {
    "muscle": {"axes": MUSCLE_AXES, "fields": MUSCLE_FIELDS,
               "lede": "What this muscle did in this class. The usual finding is "
                       "not weakness -- it is a muscle doing somebody else's job."},
    "bone": {"axes": BONE_AXES, "fields": BONE_FIELDS,
             "lede": "Where this sat, how much it moved, and where the control "
                     "went. A bone is judged by placement, not by effort."},
    "nerve": {"axes": NERVE_AXES, "fields": NERVE_FIELDS,
              "lede": "Not a score. What they reported in this nerve's area, how "
                      "long it lasted, and what you decided to do.",
              "banner": "This is a symptom record, not a diagnosis. Nothing here "
                        "measured a nerve. If it persisted after class, if it is "
                        "spreading, or if they get it away from class, the answer "
                        "is somebody qualified to look at it -- not a modification."},
}


def form_for(kind: str) -> dict:
    """The whole form for a kind of structure, ready to render."""
    kind = (kind or "").lower()
    if kind in CLOSED:
        return {"kind": kind, "open": False, "why": CLOSED[kind],
                "axes": [], "fields": []}
    shape = FORMS.get(kind)
    if shape is None:
        # An unknown kind is closed rather than guessed at. Inventing axes for
        # something we have not thought about is how a form ends up asking a
        # coach to rate the recruitment of a ligament.
        return {"kind": kind, "open": False,
                "why": "There is no rubric for this kind of structure yet, so "
                       "there is nothing honest to ask. Write a note instead.",
                "axes": [], "fields": []}
    return {"kind": kind, "open": True, "lede": shape["lede"],
            "banner": shape.get("banner", ""),
            "note_hint": NOTE_HINT.get(kind, NOTE_HINT["muscle"]),
            "axes": shape["axes"], "fields": shape["fields"]}


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def today() -> str:
    return datetime.now(timezone.utc).date().isoformat()


@dataclass
class StructureEval:
    """One coach's reading of one structure, on one date."""

    username: str
    by: str
    structure: str
    kind: str
    fma: str = ""
    side: str = ""
    marks: dict = field(default_factory=dict)
    fields: dict = field(default_factory=dict)
    session: str = ""
    made_on: str = field(default_factory=today)
    made_at: str = field(default_factory=now)
    id: int | None = None

    def __post_init__(self) -> None:
        if not (self.username or "").strip():
            raise ValueError("an evaluation has to be about somebody")
        if not (self.by or "").strip():
            raise ValueError("an evaluation has to say who made it")
        if not (self.structure or "").strip():
            raise ValueError("an evaluation has to say which structure")
        shape = form_for(self.kind)
        if not shape["open"]:
            raise ValueError(f"a {self.kind} is not assessable here: {shape['why']}")

        allowed = {a["key"]: {o[0] for o in a["options"]} for a in shape["axes"]}
        cleaned = {}
        for key, value in (self.marks or {}).items():
            if key not in allowed:
                raise ValueError(f"{key!r} is not an axis for a {self.kind}")
            if isinstance(value, dict):
                choice, note = value.get("choice", ""), value.get("note", "")
            else:
                choice, note = value, ""
            note = str(note or "").strip()[:MAX_TEXT]
            if choice in (None, ""):
                # No button pressed. Keep it anyway if they wrote something:
                # every axis's note is described in the interface as the useful
                # half, and throwing away the half we asked for because the
                # other half is blank is not a validation rule, it is data loss.
                if note:
                    cleaned[key] = {"choice": "", "note": note}
                continue
            if choice not in allowed[key]:
                raise ValueError(f"{choice!r} is not an answer to {key!r}")
            cleaned[key] = {"choice": choice, "note": note}
        self.marks = cleaned

        names = {f[0] for f in shape["fields"]}
        self.fields = {k: str(v).strip()[:MAX_TEXT]
                       for k, v in (self.fields or {}).items()
                       if k in names and str(v).strip()}
        if not self.marks and not self.fields:
            raise ValueError("an evaluation with nothing in it says nothing")

    @property
    def findings(self) -> list[str]:
        """The answers that are not "nothing to do here".

        What a coach wants back is not five answers, it is the two that were not
        fine -- so this is what the roster and the follow-up list read.
        """
        shape = form_for(self.kind)
        out = []
        for axis in shape["axes"]:
            mark = self.marks.get(axis["key"])
            # No choice at all is not a finding. A note kept without one is a
            # coach's words about something they did not commit to an answer on,
            # and reporting it as "recruitment:" with nothing after the colon is
            # worse than not reporting it.
            if not mark or not mark["choice"] or mark["choice"] == axis["mid"]:
                continue
            label = next((o[1] for o in axis["options"]
                          if o[0] == mark["choice"]), mark["choice"])
            out.append(f"{axis['label'].lower()}: {label}")
        return out

    @property
    def urgent(self) -> bool:
        """A nerve symptom that outlived the class, or a referral made.

        The only thing in this module that is allowed to shout.
        """
        if self.kind != "nerve":
            return False
        settled = (self.marks.get("settled") or {}).get("choice", "")
        action = (self.marks.get("action") or {}).get("choice", "")
        return (settled in {"persisted", "spreading", "unrelated"}
                or action.startswith("referred"))

    def to_dict(self) -> dict:
        from .observations import OBSERVED

        return {"id": self.id, "username": self.username, "by": self.by,
                "structure": self.structure, "kind": self.kind,
                "fma": self.fma, "side": self.side, "tier": OBSERVED,
                "marks": {k: dict(v) for k, v in self.marks.items()},
                "fields": dict(self.fields), "session": self.session,
                "made_on": self.made_on, "made_at": self.made_at,
                "findings": self.findings, "urgent": self.urgent}


def history(evaluations: list[StructureEval]) -> dict:
    """This structure, over time, for the panel that just opened.

    Grouped per axis so a coach can see that the recruitment answer has been
    ``over`` for four classes running, which is the finding -- one class of
    over-recruitment is a bad day.
    """
    ordered = sorted(evaluations, key=lambda e: (e.made_on, e.made_at))
    if not ordered:
        return {"count": 0, "latest": None, "axes": {}, "urgent": False}
    kind = ordered[-1].kind
    shape = form_for(kind)
    axes = {}
    for axis in shape["axes"]:
        points = []
        for one in ordered:
            mark = one.marks.get(axis["key"])
            if not mark:
                continue
            label = next((o[1] for o in axis["options"]
                          if o[0] == mark["choice"]), mark["choice"])
            points.append({"date": one.made_on, "choice": mark["choice"],
                           "label": label or "noted, not answered",
                           "note": mark["note"], "by": one.by,
                           # A note with no answer counts as settled: it is not
                           # a flag, and the run of dots beside an axis should
                           # not light up for something nobody asserted.
                           "settled": (not mark["choice"]
                                       or mark["choice"] == axis["mid"])})
        if points:
            axes[axis["key"]] = {"label": axis["label"], "points": points,
                                 "unsettled": sum(1 for p in points
                                                  if not p["settled"])}
    return {"count": len(ordered), "latest": ordered[-1].to_dict(),
            "first_on": ordered[0].made_on, "axes": axes,
            "urgent": any(e.urgent for e in ordered[-3:])}
