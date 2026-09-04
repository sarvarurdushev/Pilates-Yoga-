"""Turning a page of measurements into a number out of a hundred.

A score is what a student actually asks for, and it is also the easiest thing
in this system to fake. Two rules keep it honest.

**A score is only ever the average of checks that were really made.** Nothing
is assumed, defaulted, or filled in. A knee that was never visible does not
score zero and does not score a hundred; it is not in the average at all.

**A score never travels without its coverage.** "82 out of 100" from four
checks on a partly-visible body is a different statement from the same number
out of twenty checks on a clear one, and printing them identically is the
single most misleading thing this module could do. Every score carries how many
checks it came from and how much of the body they covered, and below a
threshold it refuses to produce a headline number at all.

The components are the things a teacher would actually name -- form, symmetry,
control, consistency, tempo -- so a low score can always be traced to which of
them cost it, and from there to the individual measurement.
"""
from __future__ import annotations

import statistics
from dataclasses import dataclass, field

from .coaching import NOTABLE_DEGREES, SIGNIFICANT_DEGREES, Assessment, Finding
from .geometry import ANGLE_PAIRS, SEGMENT_ANGLES, STANDARD_ANGLES

#: Deviation at which a check scores zero. Twice "significant", so a deviation
#: the coaching layer calls significant lands at 50 -- the two scales agree by
#: construction rather than by coincidence.
ZERO_AT = SIGNIFICANT_DEGREES * 2.0

#: Checks needed before a headline score is shown. Below this the number would
#: swing on any one of them.
MIN_CHECKS = 5
#: Share of the measurable body that must have been visible. A score from a
#: student half out of frame describes the half that was in it.
MIN_COVERAGE = 0.4

#: Every quantity a whole-body score can draw on. Fixed here so coverage is a
#: fraction of a known total rather than of whatever happened to be measured.
MEASURABLE = tuple(name for name, *_ in STANDARD_ANGLES) + SEGMENT_ANGLES


def _from_deviation(deviation: float) -> float:
    """One check, as a number out of a hundred.

    Linear rather than curved: a student asking why they lost eight points can
    be told, and a curve would make that answer arithmetic nobody can follow.
    """
    return max(0.0, min(100.0, 100.0 * (1.0 - deviation / ZERO_AT)))


@dataclass
class Component:
    """One named part of a score, and what it was computed from."""

    name: str
    checks: list[tuple[str, float]] = field(default_factory=list)
    note: str = ""

    @property
    def n(self) -> int:
        return len(self.checks)

    @property
    def score(self) -> float | None:
        if not self.checks:
            return None
        return statistics.mean(value for _, value in self.checks)

    @property
    def weakest(self) -> tuple[str, float] | None:
        return min(self.checks, key=lambda c: c[1]) if self.checks else None

    def describe(self) -> str:
        if self.score is None:
            return f"{self.name}: nothing measurable"
        text = f"{self.name}: {self.score:.0f} from {self.n} check(s)"
        if self.weakest and self.weakest[1] < 70:
            text += f", weakest {self.weakest[0].replace('_', ' ')} at {self.weakest[1]:.0f}"
        return text


@dataclass
class Score:
    """A session's score, with everything needed to argue with it."""

    components: dict[str, Component] = field(default_factory=dict)
    #: Quantities that could have been measured and were not.
    missing: list[str] = field(default_factory=list)
    measurable: int = len(MEASURABLE)

    @property
    def checks(self) -> int:
        return sum(c.n for c in self.components.values())

    @property
    def measured(self) -> int:
        return self.measurable - len(self.missing)

    @property
    def coverage(self) -> float:
        """Share of the measurable body that was actually visible."""
        return self.measured / self.measurable if self.measurable else 0.0

    @property
    def reliable(self) -> bool:
        return self.checks >= MIN_CHECKS and self.coverage >= MIN_COVERAGE

    @property
    def value(self) -> float | None:
        """The headline number, or None when it would mislead.

        Components are weighted by how many checks each contains, so a score
        is the mean of the checks rather than the mean of the categories --
        otherwise one tempo check would count as much as eight joint angles.
        """
        scored = [(c.score, c.n) for c in self.components.values() if c.score is not None]
        if not scored or not self.reliable:
            return None
        total = sum(n for _, n in scored)
        return sum(s * n for s, n in scored) / total if total else None

    @property
    def withheld_reason(self) -> str:
        if self.reliable:
            return ""
        if self.checks < MIN_CHECKS:
            return (f"only {self.checks} check(s) could be made; a score from "
                    f"that few swings on any one of them")
        return (f"only {self.measured} of {self.measurable} measurable "
                f"quantities were visible ({self.coverage:.0%}); a score would "
                f"describe the part of the body that was in frame")

    def describe(self) -> str:
        if self.value is None:
            return f"No score: {self.withheld_reason}"
        lines = [f"{self.value:.0f} out of 100, from {self.checks} checks "
                 f"covering {self.measured} of {self.measurable} measurable "
                 f"quantities"]
        for component in sorted(self.components.values(),
                                key=lambda c: (c.score is None, c.score or 0)):
            lines.append("  " + component.describe())
        if self.missing:
            lines.append(f"  not visible often enough: "
                         f"{', '.join(m.replace('_', ' ') for m in sorted(self.missing))}")
        return "\n".join(lines)


def score_assessment(
    assessment: Assessment,
    measured_subjects: set[str] | None = None,
) -> Score:
    """Score a library-based assessment: how close each target was met.

    ``measured_subjects`` says which whole-body quantities were visible at all,
    which is how coverage is known. Without it, coverage is computed from the
    assessment alone and will flatter a standard that only targets three
    joints.
    """
    result = Score()
    form = Component("form")
    symmetry = Component("symmetry")

    for finding in assessment.findings:
        if finding.kind == "not_measured":
            continue
        # By the deviation the comparison actually produced, whatever the
        # finding is called. A near miss is not a perfect score and it is not
        # nothing; treating every non-"improve" finding as zero deviation meant
        # the moment a joint crossed the notable threshold its check dropped
        # from 100 to about 70 in one step.
        value = _from_deviation(finding.deviation)
        target = symmetry if "symmetry" in finding.subject else form
        target.checks.append((finding.subject, value))

    for component in (form, symmetry):
        if component.n:
            result.components[component.name] = component

    seen = measured_subjects if measured_subjects is not None else {
        f.subject for f in assessment.findings if f.kind != "not_measured"}
    result.missing = [name for name in MEASURABLE if name not in seen]
    return result


def score_quality(findings: list[Finding]) -> dict[str, Component]:
    """Score the exercise-independent checks: control, consistency, tempo.

    These need no standard, so they are scored the same way whether or not the
    exercise was recognised -- which is the point of having them.
    """
    named = {"control": Component("control"),
             "consistency": Component("consistency"),
             "tempo": Component("tempo")}
    for finding in findings:
        component = named.get(finding.subject)
        if component is None:
            continue
        value = (_from_deviation(finding.deviation) if finding.kind == "improve"
                 else 100.0)
        component.checks.append((finding.subject, value))
    return {k: v for k, v in named.items() if v.n}


def score_session(
    assessment: Assessment | None = None,
    quality: list[Finding] | None = None,
    versus_class: list[Finding] | None = None,
    measured_subjects: set[str] | None = None,
) -> Score:
    """Everything that can be scored about one person in one session.

    The three sources are kept as separate components rather than pooled: a
    target from a library, a comparison against the room, and a check that
    needs neither are different kinds of claim, and a student who wants to know
    why a number moved is owed the distinction.
    """
    result = (score_assessment(assessment, measured_subjects) if assessment
              else Score())
    if quality:
        result.components.update(score_quality(quality))
    if versus_class:
        component = Component(
            "against the class",
            note="how far this differed from the rest of the room")
        for finding in versus_class:
            component.checks.append((finding.subject, _from_deviation(finding.deviation)))
        if component.n:
            result.components["against the class"] = component
    if measured_subjects is not None:
        result.missing = [n for n in MEASURABLE if n not in measured_subjects]
    return result


def score_from_store(store, username: str, session_key: str) -> Score:
    """Rebuild a session's score from what was archived.

    Scores are derived rather than stored, so a change to how one is computed
    applies to every session ever recorded instead of only to new ones. That is
    only possible because the components were archived rather than the number.
    """
    from .coaching import Finding

    session_id = store.session_id(session_key)
    rows = [dict(r) for r in store.db.execute(
        "SELECT f.* FROM findings f JOIN links l "
        "ON l.session_id = f.session_id AND l.track_id = f.track_id "
        "WHERE l.username = ? AND l.status = 'confirmed' AND f.session_id = ?",
        (username, session_id))]
    quality = [Finding(kind=r["kind"], subject=r["subject"], message=r["message"],
                       measured=r["measured"], target=r["target"],
                       deviation=r["deviation"])
               for r in rows if r["source"] == "quality"]
    versus = [Finding(kind=r["kind"], subject=r["subject"], message=r["message"],
                      measured=r["measured"], target=r["target"],
                      deviation=r["deviation"])
              for r in rows if r["source"] == "class"]
    standard = [Finding(kind=r["kind"], subject=r["subject"], message=r["message"],
                        measured=r["measured"], target=r["target"],
                        deviation=r["deviation"])
                for r in rows if r["source"] == "standard"]

    measured = {r["subject"] for r in store.db.execute(
        "SELECT DISTINCT m.subject FROM measurements m JOIN links l "
        "ON l.session_id = m.session_id AND l.track_id = m.track_id "
        "WHERE l.username = ? AND l.status = 'confirmed' AND m.session_id = ? "
        "AND m.valid = 1", (username, session_id))}

    assessment = Assessment(exercise="", findings=standard) if standard else None
    return score_session(assessment, quality, versus, measured)
