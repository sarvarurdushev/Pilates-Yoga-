"""The same fact in two registers: what you would say out loud, and the term.

A dashboard that only speaks in "shoulder_tilt: 6.2deg, clear of the 3.0deg
noise floor" is written for the person who built it. The student it is actually
for reads that and learns nothing, and a number nobody understands is worse
than no number: it looks authoritative and cannot be argued with.

So every user-facing phrase exists twice. The pattern is borrowed from the
Neuro Wellness reader, which carries a plain and a clinical half for every
structure and lets the reader pick -- including picking *both*, which is how
somebody grows into the vocabulary rather than being handed it.

Three rules for writing the plain half:

* **Say what was looked at, not what it is called.** "How far the left hip
  opened", not "left hip angle".
* **Never lose the honesty.** The technical half refuses to call a change a
  change unless it clears the noise floor; the plain half has to refuse just as
  hard, in words -- "less than it wobbles anyway, so nothing really changed".
  A plain register that quietly drops the caveats is a worse lie than the
  jargon it replaced.
* **No new claims.** The plain half describes the same measurement. If it needs
  a fact the technical half does not have, it is not a translation.
"""
from __future__ import annotations

import html
from dataclasses import dataclass

#: Only the plain half. The default, because the student is the reader.
PLAIN = "plain"
#: Only the terms. For an instructor who wants the numbers named properly.
TECHNICAL = "technical"
#: Both, plain first. How somebody learns the vocabulary instead of being
#: handed it.
BOTH = "both"

REGISTERS = (PLAIN, BOTH, TECHNICAL)


def _e(text: object) -> str:
    return html.escape(str(text))


def dual(plain: str, technical: str) -> str:
    """One phrase in both registers, for the page to show either or both.

    Rendered together and switched in CSS rather than re-rendered: the toggle
    is instant, and a page with scripting off still shows whichever register it
    was written with.
    """
    if plain == technical:
        return _e(plain)
    return (f"<span class='pl'>{_e(plain)}</span>"
            f"<span class='tc'>{_e(technical)}</span>")


@dataclass(frozen=True)
class Phrase:
    plain: str
    technical: str

    def html(self) -> str:
        return dual(self.plain, self.technical)


def _p(plain: str, technical: str) -> Phrase:
    return Phrase(plain, technical)


#: What each measured quantity is, said out loud. The technical half is the
#: name the rest of the system uses, so a person switching registers can still
#: find the number in an export.
QUANTITIES: dict[str, Phrase] = {
    "left_knee":       _p("how straight the left knee was", "left knee angle"),
    "right_knee":      _p("how straight the right knee was", "right knee angle"),
    "left_hip":        _p("how open the left hip was", "left hip angle"),
    "right_hip":       _p("how open the right hip was", "right hip angle"),
    "left_elbow":      _p("how straight the left elbow was", "left elbow angle"),
    "right_elbow":     _p("how straight the right elbow was", "right elbow angle"),
    "left_shoulder":   _p("how far the left arm was lifted", "left shoulder angle"),
    "right_shoulder":  _p("how far the right arm was lifted", "right shoulder angle"),
    "neck":            _p("how the head sat on the spine", "neck angle"),
    "trunk":           _p("how upright the body was", "trunk angle"),
    "shoulder_tilt":   _p("whether the shoulders were level", "shoulder line tilt"),
    "pelvis_tilt":     _p("whether the hips were level", "pelvis line tilt"),
    "knee symmetry":   _p("the difference between the two knees", "knee symmetry gap"),
    "hip symmetry":    _p("the difference between the two hips", "hip symmetry gap"),
    "elbow symmetry":  _p("the difference between the two elbows", "elbow symmetry gap"),
    "shoulder symmetry": _p("the difference between the two shoulders",
                            "shoulder symmetry gap"),
    "range of motion": _p("how far you moved", "range of motion"),
    "range consistency": _p("whether every repetition was the same size",
                            "range consistency"),
    "repetitions":     _p("how many you did", "repetitions"),
    "control":         _p("how smooth the movement was", "control ratio"),
    "tempo ratio":     _p("whether you lowered as slowly as you lifted", "tempo ratio"),
    "seconds per repetition": _p("how long each one took", "seconds per repetition"),
    "longest hold":    _p("the longest you held it", "longest hold"),
    "score":           _p("your score", "score"),
}

#: Muscle groups, said the way a teacher would point at them.
MUSCLE_PLAIN: dict[str, str] = {
    "knee extensors":     "the front of the thigh",
    "knee flexors":       "the back of the thigh",
    "hip extensors":      "the glutes and hamstrings",
    "hip flexors":        "the front of the hip",
    "elbow flexors":      "the front of the upper arm",
    "elbow extensors":    "the back of the upper arm",
    "shoulder flexors":   "the front of the shoulder",
    "shoulder extensors": "the back of the shoulder",
}


def quantity(subject: str) -> Phrase:
    """A measured quantity in both registers, including derived names.

    Peak-moment subjects are built from a muscle group name, so they are
    translated rather than listed: "hip flexors peak moment" becomes "how hard
    the front of the hip worked".
    """
    if subject in QUANTITIES:
        return QUANTITIES[subject]
    if subject.endswith(" peak moment"):
        group = subject[: -len(" peak moment")]
        spoken = MUSCLE_PLAIN.get(group)
        if spoken:
            return _p(f"how hard {spoken} worked", subject)
    return _p(subject.replace("_", " "), subject.replace("_", " "))


#: What a trend verdict means, without the word "verdict".
VERDICTS: dict[str, Phrase] = {
    "improved": _p("better than before", "improved"),
    "worsened": _p("not as good as before", "worsened"),
    "changed":  _p("different from before", "changed"),
    "steady":   _p("about the same", "steady"),
    "too few sessions": _p("not enough classes yet", "too few sessions"),
}

#: The parts a score is made of.
COMPONENTS: dict[str, Phrase] = {
    "form":        _p("positions", "form"),
    "symmetry":    _p("left and right matching", "symmetry"),
    "control":     _p("smoothness", "control"),
    "consistency": _p("repeating the same size", "consistency"),
    "tempo":       _p("lowering under control", "tempo"),
    "against the class": _p("compared with everyone else", "against the class"),
}

#: Headings and standing explanations.
COPY: dict[str, Phrase] = {
    "where_from": _p("What made your score", "Where it came from"),
    "over_time":  _p("How you have changed", "Over time"),
    "numbers":    _p("All the numbers", "The numbers behind the charts"),
    "session":    _p("Class", "Session"),
    "latest":     _p("Your last class", "Latest session"),
    "glance":     _p("At a glance", "At a glance"),
    "recurring":  _p("What keeps coming back", "What keeps coming back"),
    "band_note": _p(
        "The shaded area behind each line is how much this naturally wobbles "
        "during one class. If a line stays inside it, nothing really changed.",
        "The shaded band behind each line is how much that quantity varied "
        "inside a single session. A move that stays inside the band is not a "
        "move."),
    "map_note": _p(
        "Every part of the body this can measure, and how each one did. Grey "
        "means it could not be seen well enough to judge — not that it did "
        "badly. Tap any dot to see its charts.",
        "Every quantity this system can measure, and how each one scored. Grey "
        "is not a low score — it is a part of the body that was not visible "
        "often enough to judge. Click any marker to see its charts."),
    "made_up":    _p("What your score is made of", "What made up the score"),
    "score_hist": _p("Your score, class by class", "Score, session by session"),
    "score_hist_note": _p(
        "Hover a dot to see how many things were checked that class. A score "
        "means more when more could be seen.",
        "Hover a point for the number of checks it came from. A score is only "
        "as comparable as its coverage."),
    "recurring_note": _p(
        "Things you were told about in more than one class, and how many "
        "classes each came up in.",
        "Corrections given in more than one session, by how many sessions they "
        "appeared in."),
    "nothing_recorded": _p(
        "Nothing is saved for you yet. Your classes are measured straight "
        "away, but the numbers only get attached to your name once somebody "
        "confirms which person on the video was you.",
        "Nothing is recorded against this person yet. Measurements are stored "
        "as soon as a class is analysed, but they are only attributed once "
        "somebody confirms which tracked body was whom — so an unconfirmed "
        "session shows here as nothing rather than as a guess."),
}


#: Abbreviations belong in the technical half. A plain reader gets the word.
#: "ratio" and "count" are not units at all -- they describe what the number
#: is, and "less than the 3 ratio it wobbles" is not English.
PLAIN_UNITS = {"deg": " degrees", "Nm": " Nm", "s": " seconds"}
#: Units that read as part of the number in the technical half. Anything else
#: is a description of the quantity, not a unit to print after it.
ATTACHED_UNITS = ("deg", "Nm", "s", "%")


def plain_unit(unit: str) -> str:
    return PLAIN_UNITS.get(unit, "")


def technical_unit(unit: str) -> str:
    return unit if unit in ATTACHED_UNITS else ""


def change_note(change: float, floor: float, unit: str, steady: bool,
                sessions: int, needed: int) -> Phrase:
    """How a quantity moved, and whether that counts as moving.

    The plain half refuses exactly as hard as the technical one. Dropping the
    caveat would be a worse lie than the jargon it replaced.
    """
    if sessions < needed:
        # "class(es)" is a form-filling convention, not something to say to a
        # person. The technical half keeps it; the plain half counts properly.
        word = "class" if sessions == 1 else "classes"
        return _p(f"only {sessions} {word} so far — {needed} are needed before "
                  f"saying which way this is going",
                  f"{sessions} session(s); {needed} are needed before a "
                  f"direction is called")
    spoken, term = plain_unit(unit), technical_unit(unit)
    # A quantity with no unit gets no figure in the plain half: "less than the
    # 3 it wobbles anyway" reads as a typo, where "less than it wobbles
    # anyway" is the same claim in English.
    floor_said = f"the {floor:.0f}{spoken} it wobbles" if spoken else "it wobbles"
    if steady:
        return _p(f"barely moved — less than {floor_said} anyway, so nothing "
                  f"really changed",
                  f"moved {change:+.1f}{term}, inside the {floor:.1f}{term} it "
                  f"varies anyway")
    direction = "up" if change > 0 else "down"
    moved = f"about {abs(change):.0f}{spoken}" if spoken else "noticeably"
    return _p(f"{direction} {moved} — more than {floor_said} anyway, so this "
              f"is a real change",
              f"moved {change:+.1f}{term}, clear of the {floor:.1f}{term} "
              f"noise floor")


def coverage_note(checks: int, measured: int, measurable: int,
                  share: float) -> Phrase:
    whole = "your whole body" if measured == measurable else \
        f"{measured} of the {measurable} parts"
    return _p(f"This class we could see {whole}, and checked {checks} things "
              f"about it.",
              f"{checks} checks were made, covering {measured} of "
              f"{measurable} measurable quantities ({share:.0%} of the body).")
