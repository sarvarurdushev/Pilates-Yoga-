"""Tracking one student across sessions.

Two things make this harder than appending rows to a file.

**Identity across sessions is a human decision, not a computer-vision one.**
Track ids are per-video: student 4 this week is a different person from student
4 last week. Rather than recognising faces, a session is filed against a name
the instructor supplies at recording time. That keeps the system out of
biometric identification entirely, and it is also simply more reliable than
inferring identity from a wide shot.

**Two sessions is not a trend.** The tempting failure is reporting "your knee
alignment improved 12%" from two numbers that differ by less than the
measurement wobbles within a single class. So every stored measurement carries
the spread it had *within* its own session, and that spread becomes the noise
floor a between-session change has to clear before it is called a change at
all.
"""
from __future__ import annotations

import json
import statistics
from dataclasses import asdict, dataclass, field
from datetime import date as Date
from pathlib import Path

from .coaching import Assessment
from .movement import TrackHistory

#: Sessions needed before any direction is reported.
MIN_SESSIONS_FOR_TREND = 3
#: A change must exceed this multiple of the within-session spread to count.
NOISE_MULTIPLE = 1.0
#: And it must exceed this many degrees outright. A very steady student has a
#: small noise floor, which would otherwise let a one-degree drift qualify as
#: progress -- true of the arithmetic, useless to the person being told.
MIN_PRACTICAL_CHANGE = 3.0


@dataclass
class Measurement:
    """One quantity, for one student, in one session."""

    subject: str          # "left_knee", "hip symmetry", ...
    median: float
    #: How much this quantity varied within the session, as an inter-quartile
    #: range. The noise floor for comparing against other sessions.
    spread: float
    samples: int

    @classmethod
    def from_values(cls, subject: str, values: list[float]) -> "Measurement | None":
        if len(values) < 3:
            return None
        ordered = sorted(values)
        lower = ordered[len(ordered) // 4]
        upper = ordered[(3 * len(ordered)) // 4]
        return cls(
            subject=subject,
            median=statistics.median(values),
            spread=float(upper - lower),
            samples=len(values),
        )


@dataclass
class SessionRecord:
    """What one student did in one class."""

    student: str
    date: str                       # ISO date
    exercise: str
    measurements: list[Measurement] = field(default_factory=list)
    video: str = ""
    track_id: int | None = None
    notes: str = ""

    def get(self, subject: str) -> Measurement | None:
        for measurement in self.measurements:
            if measurement.subject == subject:
                return measurement
        return None

    @classmethod
    def from_dict(cls, data: dict) -> "SessionRecord":
        payload = dict(data)
        measurements = [Measurement(**m) for m in payload.pop("measurements", [])]
        return cls(measurements=measurements, **payload)


@dataclass
class Trend:
    """How one quantity moved across sessions, and whether that means anything."""

    subject: str
    sessions: int
    first: float
    last: float
    #: Typical within-session spread, part of the noise floor.
    noise: float
    #: "improved", "worsened", "no measurable change", or "too few sessions".
    verdict: str
    #: Whether the target is to increase this number (range of motion) or
    #: decrease it (an asymmetry gap).
    lower_is_better: bool = True

    @property
    def change(self) -> float:
        return self.last - self.first

    @property
    def meaningful(self) -> bool:
        return self.verdict in ("improved", "worsened")

    def describe(self) -> str:
        if self.verdict == "too few sessions":
            return (f"{self.subject}: {self.sessions} session(s) so far, "
                    f"need {MIN_SESSIONS_FOR_TREND} before calling a direction")
        floor = max(self.noise * NOISE_MULTIPLE, MIN_PRACTICAL_CHANGE)
        if self.verdict == "no measurable change":
            reason = (f"under the {MIN_PRACTICAL_CHANGE:.0f}deg worth mentioning"
                      if self.noise * NOISE_MULTIPLE < MIN_PRACTICAL_CHANGE
                      else f"within the {self.noise:.1f}deg it varies inside a "
                           f"single session")
            return (f"{self.subject}: {self.first:.1f} to {self.last:.1f}deg, "
                    f"{reason} -- no measurable change")
        return (f"{self.subject}: {self.first:.1f} to {self.last:.1f}deg "
                f"({self.change:+.1f}deg, needed more than {floor:.1f}deg) -- "
                f"{self.verdict}")


#: Quantities where a smaller number is better. Everything else is assumed to
#: be an angle where movement towards its target is what matters, and is only
#: reported as a raw change.
LOWER_IS_BETTER = ("knee symmetry", "hip symmetry", "elbow symmetry")


def measure_session(
    history: TrackHistory, assessment: Assessment
) -> list[Measurement]:
    """Extract storable measurements, each with its within-session spread."""
    out: list[Measurement] = []
    subjects = {f.subject for f in assessment.findings if f.measured is not None}

    for subject in sorted(subjects):
        if subject.endswith(" symmetry"):
            pair = subject.split()[0]
            values = [
                abs(s.angles[f"left_{pair}"] - s.angles[f"right_{pair}"])
                for s in history.samples
                if s.angles.get(f"left_{pair}") is not None
                and s.angles.get(f"right_{pair}") is not None
            ]
        elif subject == "trunk":
            values = [s.trunk for s in history.samples if s.trunk is not None]
        else:
            values = [
                s.angles[subject] for s in history.samples
                if s.angles.get(subject) is not None
            ]
        measurement = Measurement.from_values(subject, values)
        if measurement is not None:
            out.append(measurement)
    return out


class HistoryStore:
    """A studio's records, as one readable JSON file.

    A file rather than a database on purpose: a studio can open it, correct a
    misfiled name, and hand the whole thing to a student who asks what is held
    about them.
    """

    def __init__(self, records: list[SessionRecord] | None = None):
        self.records: list[SessionRecord] = records or []

    @classmethod
    def load(cls, path: str | Path) -> "HistoryStore":
        file = Path(path)
        if not file.exists():
            return cls()
        data = json.loads(file.read_text())
        return cls([SessionRecord.from_dict(r) for r in data.get("sessions", [])])

    def save(self, path: str | Path) -> None:
        Path(path).write_text(json.dumps(
            {"sessions": [asdict(r) for r in self.records]}, indent=2
        ) + "\n")

    def add(self, record: SessionRecord) -> None:
        self.records.append(record)

    def students(self) -> list[str]:
        return sorted({r.student for r in self.records})

    def for_student(self, student: str, exercise: str | None = None) -> list[SessionRecord]:
        """That student's sessions, oldest first.

        Filtered by exercise by default at the call site, because comparing a
        knee angle in a plank against one in a warrior two is comparing nothing.
        """
        matching = [
            r for r in self.records
            if r.student == student and (exercise is None or r.exercise == exercise)
        ]
        return sorted(matching, key=lambda r: r.date)

    def exercises_for(self, student: str) -> list[str]:
        return sorted({r.exercise for r in self.records if r.student == student})

    def trends(self, student: str, exercise: str) -> list[Trend]:
        """How each measured quantity moved, with noise taken seriously."""
        sessions = self.for_student(student, exercise)
        subjects: list[str] = []
        for record in sessions:
            for measurement in record.measurements:
                if measurement.subject not in subjects:
                    subjects.append(measurement.subject)

        out: list[Trend] = []
        for subject in subjects:
            points = [
                (r.date, m) for r in sessions
                if (m := r.get(subject)) is not None
            ]
            if not points:
                continue
            lower_better = subject in LOWER_IS_BETTER
            first, last = points[0][1].median, points[-1][1].median
            noise = statistics.median([m.spread for _, m in points])

            floor = max(noise * NOISE_MULTIPLE, MIN_PRACTICAL_CHANGE)
            if len(points) < MIN_SESSIONS_FOR_TREND:
                verdict = "too few sessions"
            elif abs(last - first) <= floor:
                verdict = "no measurable change"
            elif lower_better:
                verdict = "improved" if last < first else "worsened"
            else:
                # For a plain angle there is no universal good direction, so
                # only the size of the change is asserted.
                verdict = "changed"

            out.append(Trend(
                subject=subject, sessions=len(points), first=first, last=last,
                noise=noise, verdict=verdict, lower_is_better=lower_better,
            ))
        return out


def progress_report(store: HistoryStore, student: str, exercise: str) -> str:
    """Plain text on how one student has moved over time."""
    sessions = store.for_student(student, exercise)
    if not sessions:
        return f"No sessions recorded for {student} doing {exercise}."

    lines = [
        f"{student} -- {exercise}",
        f"  {len(sessions)} session(s): "
        f"{', '.join(r.date for r in sessions)}",
        "",
    ]
    trends = store.trends(student, exercise)
    if not trends:
        lines.append("  Nothing was measured consistently enough to compare.")
        return "\n".join(lines)

    moved = [t for t in trends if t.meaningful]
    flat = [t for t in trends if t.verdict == "no measurable change"]
    early = [t for t in trends if t.verdict == "too few sessions"]
    changed = [t for t in trends if t.verdict == "changed"]

    for label, group in (("Real change:", moved), ("Changed:", changed),
                         ("Steady:", flat), ("Not enough sessions yet:", early)):
        if group:
            lines.append(label)
            for trend in group:
                lines.append(f"  - {trend.describe()}")
            lines.append("")

    if not moved and not changed and len(sessions) >= MIN_SESSIONS_FOR_TREND:
        lines.append("Nothing has moved by more than this student's own "
                     "session-to-session variation.")
    return "\n".join(lines).rstrip()
