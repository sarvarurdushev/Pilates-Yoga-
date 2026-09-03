"""A written report a student can take away.

Self-contained HTML with no external assets, so a studio can email it, print
it, or hand it over on a tablet without anything phoning home.

The honesty rules from the coaching layer carry through, because this is where
they matter most -- a printed page is read as more authoritative than a
terminal, and a student has no way to check it:

* every observation shows the number behind it and the range it was compared
  against;
* anything that could not be measured says so, in its own section, rather than
  being quietly dropped;
* progress is only claimed where a change cleared that student's own
  session-to-session variation;
* the page says plainly that these are geometric observations, not health
  advice.
"""
from __future__ import annotations

import html
from dataclasses import dataclass
from datetime import date as Date
from pathlib import Path

from .coaching import Assessment, Finding
from .history import HistoryStore, Trend
from .movement import MovementSummary


@dataclass
class StudentReport:
    """Everything one report needs. Assembled by the caller, rendered here."""

    student: str
    exercise: str
    date: str
    assessment: Assessment
    summary: MovementSummary | None = None
    trends: list[Trend] | None = None
    sessions_recorded: int = 0
    studio: str = ""


def _e(text: object) -> str:
    return html.escape(str(text))


def _subject(name: str) -> str:
    """A measurement name as a reader would say it: left_knee -> left knee."""
    return name.replace("_", " ")


def _finding_row(finding: Finding) -> str:
    if finding.measured is None:
        detail = "<td class='num'>&mdash;</td><td class='num'>&mdash;</td>"
    else:
        target = _e(finding.target) if finding.target else "&mdash;"
        detail = (f"<td class='num'>{finding.measured:.0f}&deg;</td>"
                  f"<td class='num'>{target}</td>")
    return f"<tr><td>{_e(finding.message)}</td>{detail}</tr>"


def _section(title: str, rows: list[str], empty: str = "") -> str:
    if not rows:
        return f"<h2>{_e(title)}</h2><p class='muted'>{_e(empty)}</p>" if empty else ""
    return (
        f"<h2>{_e(title)}</h2>"
        "<table><thead><tr><th>Observation</th><th class='num'>Measured</th>"
        "<th class='num'>Target</th></tr></thead><tbody>"
        + "".join(rows) + "</tbody></table>"
    )


def _movement_block(summary: MovementSummary) -> str:
    rows: list[str] = []

    def add(label: str, value: str) -> None:
        rows.append(f"<tr><td>{_e(label)}</td><td class='num'>{value}</td></tr>")

    add("Time tracked", f"{summary.duration:.0f}s")
    if summary.kind == "held":
        add("Movement", "held a position")
    elif summary.kind == "sequence":
        add("Movement", "a sequence of poses, not a repeated exercise")
    else:
        add("Repetitions", str(summary.repetitions))
        if summary.mean_range is not None:
            add("Range of motion", f"{summary.mean_range:.0f}&deg;")
        if summary.mean_rep_duration is not None:
            add("Seconds per repetition", f"{summary.mean_rep_duration:.1f}")
        if summary.control_ratio is not None:
            add("Smoothness", f"{summary.control_ratio:.1f} (1.0 is ideal)")
    if summary.longest_hold is not None:
        add("Longest hold", f"{summary.longest_hold:.1f}s")

    return ("<h2>What you did</h2><table><tbody>" + "".join(rows) + "</tbody></table>")


def _progress_block(trends: list[Trend], sessions: int) -> str:
    moved = [t for t in trends if t.meaningful or t.verdict == "changed"]
    steady = [t for t in trends if t.verdict == "no measurable change"]
    early = [t for t in trends if t.verdict == "too few sessions"]

    parts = [f"<h2>Compared with your earlier sessions</h2>"
             f"<p class='muted'>Based on {sessions} recorded session"
             f"{'s' if sessions != 1 else ''}.</p>"]

    if moved:
        parts.append("<ul>")
        for trend in moved:
            parts.append(f"<li><strong>{_e(_subject(trend.subject))}</strong>: "
                         f"{trend.first:.0f}&deg; &rarr; {trend.last:.0f}&deg; "
                         f"({_e(trend.verdict)})</li>")
        parts.append("</ul>")

    if steady:
        parts.append("<p>Steady, within your normal session-to-session variation: "
                     + _e(", ".join(_subject(t.subject) for t in steady)) + ".</p>")
    if early:
        parts.append("<p class='muted'>Not enough sessions yet to say anything about: "
                     + _e(", ".join(_subject(t.subject) for t in early)) + ".</p>")
    if not moved and not steady and not early:
        parts.append("<p class='muted'>Nothing has been measured consistently "
                     "enough to compare yet.</p>")
    return "".join(parts)


STYLE = """
:root { --ink:#1a1a1a; --muted:#6b6b6b; --rule:#e3e0da; --paper:#fdfcfa;
        --good:#2e6b46; --work:#8a5a1b; --accent:#3b5f8a; }
* { box-sizing:border-box; }
body { margin:0; padding:32px 20px; background:var(--paper); color:var(--ink);
       font:16px/1.55 Georgia,'Iowan Old Style',serif; }
.sheet { max-width:640px; margin:0 auto; }
header { border-bottom:2px solid var(--ink); padding-bottom:14px; margin-bottom:26px; }
h1 { margin:0 0 4px; font-size:26px; letter-spacing:-0.01em; }
.sub { color:var(--muted); font-size:14px; }
h2 { font-size:13px; text-transform:uppercase; letter-spacing:0.09em;
     margin:30px 0 10px; color:var(--accent);
     font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; }
h2.good { color:var(--good); } h2.work { color:var(--work); }
table { width:100%; border-collapse:collapse; font-size:15px; }
th { text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:0.07em;
     color:var(--muted); font-weight:600; padding:0 0 6px;
     font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; }
td { padding:8px 0; border-top:1px solid var(--rule); vertical-align:top; }
td.num, th.num { text-align:right; white-space:nowrap;
     font-variant-numeric:tabular-nums; padding-left:14px; }
ul { margin:8px 0; padding-left:20px; } li { margin:5px 0; }
.muted { color:var(--muted); font-size:14px; }
.headline { background:#fff; border:1px solid var(--rule); border-left:3px solid var(--accent);
            padding:14px 16px; margin:22px 0; }
.headline strong { display:block; font-size:11px; text-transform:uppercase;
            letter-spacing:0.09em; color:var(--accent); margin-bottom:5px;
            font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; }
footer { margin-top:36px; padding-top:14px; border-top:1px solid var(--rule);
         color:var(--muted); font-size:13px; }
@media print { body { background:#fff; padding:0; } .sheet { max-width:none; } }
"""


def render(report: StudentReport) -> str:
    """Build the whole page as one self-contained HTML string."""
    parts: list[str] = [
        "<!doctype html><html lang='en'><head><meta charset='utf-8'>",
        "<meta name='viewport' content='width=device-width,initial-scale=1'>",
        f"<title>{_e(report.student)} &mdash; {_e(report.exercise.replace('_', ' '))}</title>",
        f"<style>{STYLE}</style></head><body><div class='sheet'>",
        "<header>",
        f"<h1>{_e(report.student)}</h1>",
        f"<div class='sub'>{_e(report.exercise.replace('_', ' '))} &middot; "
        f"{_e(report.date)}"
        + (f" &middot; {_e(report.studio)}" if report.studio else "")
        + "</div></header>",
    ]

    priority = report.assessment.priority
    if priority is not None:
        parts.append(
            "<div class='headline'><strong>One thing for next time</strong>"
            f"{_e(priority.message)}"
            + (f" &mdash; measured {priority.measured:.0f}&deg;, "
               f"target {_e(priority.target)}." if priority.measured is not None else ".")
            + "</div>"
        )
    elif report.assessment.good:
        parts.append(
            "<div class='headline'><strong>Summary</strong>"
            "Nothing stood out as needing correction in what could be measured.</div>"
        )

    good = _section("Going well", [_finding_row(f) for f in report.assessment.good])
    parts.append(good.replace("<h2>", "<h2 class='good'>", 1) if good else "")
    work = _section("Worth working on", [_finding_row(f) for f in report.assessment.improve])
    parts.append(work.replace("<h2>", "<h2 class='work'>", 1) if work else "")

    if report.summary is not None:
        parts.append(_movement_block(report.summary))

    if report.trends:
        parts.append(_progress_block(report.trends, report.sessions_recorded))

    if report.assessment.unmeasured:
        parts.append(
            "<h2>Could not be judged</h2><ul>"
            + "".join(f"<li>{_e(f.message)}</li>" for f in report.assessment.unmeasured)
            + "</ul>"
        )

    parts.append(
        "<footer>These are geometric observations about how the movement looked "
        "to a camera &mdash; angles measured against a target range. They are not "
        "health advice, and whether any of them matters for your body is a "
        "question for your instructor."
        f"<br>Based on {report.assessment.samples} analysed frames "
        f"(pose confidence {report.assessment.confidence:.2f})."
        "</footer></div></body></html>"
    )
    return "".join(p for p in parts if p)


def write(report: StudentReport, path: str | Path) -> Path:
    """Render and save. Returns the path written."""
    out = Path(path)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(render(report), encoding="utf-8")
    return out


def build(
    student: str,
    exercise: str,
    assessment: Assessment,
    summary: MovementSummary | None = None,
    store: HistoryStore | None = None,
    date: str | None = None,
    studio: str = "",
) -> StudentReport:
    """Assemble a report, pulling progress from a history store if there is one."""
    trends = None
    sessions = 0
    if store is not None:
        sessions = len(store.for_student(student, exercise))
        if sessions:
            trends = store.trends(student, exercise)
    return StudentReport(
        student=student, exercise=exercise,
        date=date or Date.today().isoformat(),
        assessment=assessment, summary=summary,
        trends=trends, sessions_recorded=sessions, studio=studio,
    )


CLASS_STYLE = STYLE + """
.pattern { border-left:3px solid var(--work); background:#fff; padding:12px 14px;
           margin:10px 0; border:1px solid var(--rule); }
.pattern .who { color:var(--muted); font-size:13px; margin-top:4px; }
.count { font-variant-numeric:tabular-nums; font-weight:700; color:var(--work); }
.roll td:first-child { font-weight:600; }
.pill { display:inline-block; font-size:12px; padding:1px 7px; border-radius:9px;
        background:#eef2f7; color:var(--accent); margin-left:6px;
        font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; }
.pill.work { background:#fdf2e3; color:var(--work); }
"""


def render_class_summary(result, patterns, studio: str = "") -> str:
    """The teacher's page: what the class as a whole did.

    Individual reports do not show that six of eight students had the same
    problem, which is the observation that changes what gets taught next week.
    """
    parts: list[str] = [
        "<!doctype html><html lang='en'><head><meta charset='utf-8'>",
        "<meta name='viewport' content='width=device-width,initial-scale=1'>",
        f"<title>Class summary &mdash; {_e(result.video)}</title>",
        f"<style>{CLASS_STYLE}</style></head><body><div class='sheet'>",
        "<header><h1>Class summary</h1>",
        f"<div class='sub'>{_e(result.video)}"
        + (f" &middot; {_e(result.date)}" if result.date else "")
        + (f" &middot; {_e(studio)}" if studio else "")
        + "</div></header>",
    ]

    names = result.names
    parts.append(
        f"<p class='muted'>{len(names)} student"
        f"{'s' if len(names) != 1 else ''} assessed across "
        f"{len(result.exercises)} exercise"
        f"{'s' if len(result.exercises) != 1 else ''}: "
        f"{_e(', '.join(e.replace('_', ' ') for e in result.exercises))}.</p>"
    )
    if result.skipped_unnamed:
        parts.append(
            "<p class='muted'>Not reported on, because the roster has no name for "
            f"them: {_e(', '.join(f'student {t}' for t in result.skipped_unnamed))}."
            "</p>"
        )

    if patterns:
        parts.append("<h2 class='work'>What the class found hard</h2>")
        for pattern in patterns:
            parts.append(
                "<div class='pattern'>"
                f"<span class='count'>{pattern.affected} of {pattern.measured}</span> "
                f"students &mdash; {_e(pattern.message)}"
                f"<span class='pill'>{_e(pattern.exercise.replace('_', ' '))}</span>"
                f"<div class='who'>{_e(', '.join(pattern.students))}</div></div>"
            )
    else:
        parts.append(
            "<h2>What the class found hard</h2>"
            "<p class='muted'>No correction applied to more than one student. "
            "Anything flagged was individual, and is in that student's own "
            "report.</p>"
        )

    rows: list[str] = []
    for name in names:
        entries = [s for s in result.students if s.name == name]
        improve = sum(len(s.assessment.improve) for s in entries)
        good = sum(len(s.assessment.good) for s in entries)
        pill = (f"<span class='pill work'>{improve} to work on</span>" if improve
                else "<span class='pill'>nothing flagged</span>")
        rows.append(
            f"<tr><td>{_e(name)}{pill}</td>"
            f"<td class='num'>{good}</td><td class='num'>{improve}</td></tr>"
        )
    parts.append(
        "<h2>Every student</h2><table class='roll'><thead><tr><th>Student</th>"
        "<th class='num'>Going well</th><th class='num'>To work on</th></tr></thead>"
        "<tbody>" + "".join(rows) + "</tbody></table>"
    )

    parts.append(
        "<footer>Counts are out of the students actually measured in each "
        "exercise, not the whole register &mdash; somebody who was occluded or "
        "arrived late is not counted as having done it well. These are geometric "
        "observations, not health advice."
        "</footer></div></body></html>"
    )
    return "".join(parts)
