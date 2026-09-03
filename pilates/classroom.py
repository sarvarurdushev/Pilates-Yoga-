"""Running a whole class in one pass.

Everything below this module works on one student at a time, which is right for
the analysis and wrong for the studio. A teacher has twenty minutes between
classes, not the patience to run four commands per person.

Two things are added here rather than composed from what exists.

**A roster.** Track ids are meaningless to a human: nobody knows who student 7
is. A roster maps ids to names, and is generated as a stub with a face crop per
student so the teacher can fill it in by looking rather than guessing. Names
come from a person; nothing here tries to recognise anybody.

**A view across the class.** Individual reports do not show that six of eight
students had the same problem, which is the observation that changes what gets
taught next week. Aggregates are reported as counts out of the number actually
measured -- never as a bare percentage, which would hide that "75%" meant three
students out of four.
"""
from __future__ import annotations

import json
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

from .coaching import Assessment, ExerciseStandard, assess
from .labels import LabelSet, Segment
from .movement import MovementSummary, TrackHistory, summarise


#: Fraction of tracked students a roster must name before a class run is
#: trusted. Below this, the roster almost certainly describes a different part
#: of the video than the one being analysed.
MIN_ROSTER_COVERAGE = 0.5


@dataclass
class Roster:
    """Who each tracked student is. Supplied by a person, never inferred.

    A roster is only valid for **one continuous shot**. Track ids restart at
    every cut, so a roster built from one segment of an edited video maps onto
    nothing in another: student 4 in the first shot and student 4 in the third
    are different people. :func:`check_coverage` catches that, rather than
    letting it quietly produce a handful of reports and drop everyone else.
    """

    names: dict[int, str] = field(default_factory=dict)
    video: str = ""
    #: The frame range this roster was built from, when it is known.
    start_frame: int = 0
    end_frame: int | None = None
    notes: str = ""

    def name_for(self, track_id: int) -> str | None:
        return self.names.get(track_id)

    @property
    def named(self) -> int:
        return sum(1 for n in self.names.values() if n and not n.startswith("?"))

    @property
    def range_note(self) -> str:
        if self.end_frame is None:
            return "the whole video"
        return f"frames {self.start_frame}-{self.end_frame}"

    @classmethod
    def stub(cls, track_ids: list[int], video: str = "",
             start_frame: int = 0, end_frame: int | None = None) -> "Roster":
        """A blank roster to be filled in, with placeholders that stay unnamed.

        Placeholders begin with "?" so an unfilled roster produces no reports
        rather than a stack of pages addressed to "student 7".
        """
        return cls(
            names={t: f"?student_{t}" for t in sorted(track_ids)},
            video=video, start_frame=start_frame, end_frame=end_frame,
            notes="Replace each ?student_N with the person's name. Rows still "
                  "starting with ? are skipped. This roster is only valid for "
                  "the frame range it was built from: track ids restart at "
                  "every cut in the video.",
        )

    @classmethod
    def load(cls, path: str | Path) -> "Roster":
        data = json.loads(Path(path).read_text())
        return cls(
            names={int(k): v for k, v in data.get("names", {}).items()},
            video=data.get("video", ""),
            start_frame=int(data.get("start_frame", 0)),
            end_frame=data.get("end_frame"),
            notes=data.get("notes", ""),
        )

    def save(self, path: str | Path) -> None:
        Path(path).write_text(json.dumps({
            "video": self.video,
            "start_frame": self.start_frame,
            "end_frame": self.end_frame,
            "notes": self.notes,
            "names": {str(k): v for k, v in sorted(self.names.items())},
        }, indent=2) + "\n")


@dataclass
class CoverageCheck:
    """Whether a roster plausibly describes the students that were tracked."""

    tracked: int
    named: int
    ok: bool
    message: str = ""


def check_coverage(roster: Roster, tracked_ids: list[int]) -> CoverageCheck:
    """Catch a roster that describes a different part of the video.

    Track ids restart at every cut, so running a whole edited video against a
    roster built from one shot names a handful of people and silently drops the
    rest. That is worse than failing outright: the studio gets a
    plausible-looking stack of reports with no sign that most of the class is
    missing from it.
    """
    named = sum(1 for t in tracked_ids
                if (n := roster.name_for(t)) and not n.startswith("?"))
    total = len(tracked_ids)
    if total == 0:
        return CoverageCheck(0, 0, False, "no student was tracked at all")
    if named / total >= MIN_ROSTER_COVERAGE:
        return CoverageCheck(total, named, True)
    return CoverageCheck(
        total, named, False,
        f"the roster names {named} of the {total} students tracked here. "
        f"Track ids restart at every cut in a video, so a roster built from "
        f"one shot does not describe another. Build the roster over the same "
        f"range you are analysing, and run one continuous shot at a time."
    )


@dataclass
class StudentResult:
    """One student, one exercise, within one class."""

    track_id: int
    name: str
    exercise: str
    assessment: Assessment
    summary: MovementSummary | None
    frames: int
    #: The samples this result was computed from, kept so history can record
    #: each measurement's within-session spread without re-reading the video.
    history: TrackHistory | None = None


@dataclass
class ClassResult:
    """Everything found in one class."""

    video: str
    date: str
    students: list[StudentResult] = field(default_factory=list)
    skipped_unnamed: list[int] = field(default_factory=list)
    exercises: list[str] = field(default_factory=list)
    #: Whether the roster plausibly described the students actually tracked.
    coverage: "CoverageCheck | None" = None

    def by_exercise(self, exercise: str) -> list[StudentResult]:
        return [s for s in self.students if s.exercise == exercise]

    @property
    def names(self) -> list[str]:
        return sorted({s.name for s in self.students})


@dataclass
class ClassPattern:
    """One observation, and how much of the class it applied to."""

    exercise: str
    message: str
    affected: int
    measured: int
    students: list[str] = field(default_factory=list)

    @property
    def share(self) -> float:
        return self.affected / self.measured if self.measured else 0.0

    def describe(self) -> str:
        # Counts, never a bare percentage: "75%" hides three students out of four.
        return (f"{self.message} — {self.affected} of {self.measured} students "
                f"({', '.join(self.students)})")


def class_patterns(result: ClassResult, min_affected: int = 2) -> list[ClassPattern]:
    """Problems more than one student had, most widespread first.

    A single student with an uneven hip is a note for that student. Six of eight
    is a note about the teaching, and that is the distinction worth surfacing.
    """
    patterns: list[ClassPattern] = []
    for exercise in sorted({s.exercise for s in result.students}):
        cohort = result.by_exercise(exercise)
        counts: Counter[str] = Counter()
        who: dict[str, list[str]] = {}
        for student in cohort:
            for finding in student.assessment.improve:
                counts[finding.message] += 1
                who.setdefault(finding.message, []).append(student.name)
        for message, count in counts.items():
            if count >= min_affected:
                patterns.append(ClassPattern(
                    exercise=exercise, message=message, affected=count,
                    measured=len(cohort), students=sorted(who[message]),
                ))
    return sorted(patterns, key=lambda p: (-p.share, -p.affected))


def run_class(
    video: str,
    labels: LabelSet,
    roster: Roster,
    config,
    standards: dict[str, ExerciseStandard],
    date: str | None = None,
    min_samples: int = 10,
    start_frame: int = 0,
    end_frame: int | None = None,
    progress=None,
) -> ClassResult:
    """Analyse every labelled exercise for every named student, in one pass.

    The video is read once. Each student's history is sliced per labelled
    segment afterwards, which is both faster than re-reading and the only way
    to keep track ids consistent across exercises.

    ``start_frame`` and ``end_frame`` scope the run to one continuous shot,
    which is the only range a roster is valid over.
    """
    from .movement import SessionRecorder
    from .pipeline import Pipeline, VideoSource

    pipeline = Pipeline(config)
    recorder = SessionRecorder(keypoint_threshold=config.keypoint_threshold)

    with VideoSource(video, stride=config.frame_stride,
                     start_frame=start_frame, end_frame=end_frame) as source:
        for frame_result in pipeline.run(source):
            recorder.observe(frame_result)
            if progress:
                progress(frame_result)

    result = ClassResult(video=Path(video).name, date=date or "")
    tracked = [t for t, h in recorder.histories.items() if len(h.samples) >= min_samples]
    result.coverage = check_coverage(roster, tracked)
    assessable = [
        s for s in labels.segments
        if s.is_exercise and s.exercise in standards
    ]
    result.exercises = sorted({s.exercise for s in assessable})

    for track_id, history in sorted(recorder.histories.items()):
        name = roster.name_for(track_id)
        if not name or name.startswith("?"):
            # Only worth reporting if they were tracked long enough to be a
            # person rather than a flicker; otherwise the studio is handed a
            # list of forty "skipped students" that are mostly fragments.
            if track_id in tracked:
                result.skipped_unnamed.append(track_id)
            continue
        for segment in assessable:
            sliced = _slice(history, segment)
            if len(sliced.samples) < min_samples:
                continue
            result.students.append(StudentResult(
                track_id=track_id, name=name, exercise=segment.exercise,
                assessment=assess(sliced, standards[segment.exercise],
                                  config.keypoint_threshold),
                summary=summarise(sliced),
                frames=len(sliced.samples),
                history=sliced,
            ))
    return result


def _slice(history: TrackHistory, segment: Segment) -> TrackHistory:
    """Just the samples falling inside one labelled segment."""
    out = TrackHistory(track_id=history.track_id)
    out.samples = [s for s in history.samples if segment.contains(s.timestamp)]
    return out
