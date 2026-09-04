"""A person's whole record, as one page.

Verbal feedback answers "what happened today". A dashboard answers the
questions a single session cannot: is this moving, is it moving enough to
mean anything, and what keeps coming back. Those need the long-term store
behind them, and they need to be shown rather than described -- twelve
sessions of hip range is a line, not a paragraph.

Self-contained HTML with inline SVG and no external asset of any kind, for the
same reason as the student report: a studio emails it, prints it, or opens it
on a tablet with no network, and nothing about a person's body measurements
should be fetched from somebody else's server to render.

The design rule that shapes every chart here is the one from
:mod:`pilates.history`: a change is only a change once it clears the noise. So
every line carries the band it varied by *within* each session, drawn behind
it. A rise that stays inside its own band is visibly not a rise, which is
harder to misread than a sentence saying so underneath.
"""
from __future__ import annotations

import html
import statistics
from dataclasses import dataclass, field
from datetime import date as Date

from .history import (LOWER_IS_BETTER, MIN_PRACTICAL_CHANGE,
                      MIN_SESSIONS_FOR_TREND, NOISE_MULTIPLE)
from .store import Row, Store

#: Validated in both modes with the palette validator: worst adjacent pair
#: CVD delta-E 24.7 light / 26.8 dark, normal-vision 33.6 / 31.8, both slots
#: above 3:1 against their surface.
PALETTE = {
    "light": {"surface": "#fcfcfb", "panel": "#ffffff", "ink": "#0b0b0b",
              "muted": "#52514e", "rule": "#e3e0da",
              "series1": "#2a78d6", "series2": "#eb6834", "band": "#dbe8f8"},
    "dark": {"surface": "#1a1a19", "panel": "#232322", "ink": "#ffffff",
             "muted": "#c3c2b7", "rule": "#3a3a37",
             "series1": "#3987e5", "series2": "#d95926", "band": "#20344c"},
}
#: Fixed, never themed, and never used for a series. Each ships with a word
#: beside it, so the colour never carries the meaning alone.
#:
#: Only "improved" and "worsened" get a status colour, because only those two
#: are judgements. A bare joint angle moving has no universally good direction
#: -- that is why the verdict for one is "changed" rather than "improved" --
#: and colouring it amber would assert exactly the thing the wording refuses
#: to. "changed" and "steady" are both neutral, and the word is the difference.
STATUS = {"improved": "#0ca30c", "worsened": "#d03b3b",
          "changed": "#52514e", "steady": "#52514e",
          "too few sessions": "#52514e"}


def _e(text: object) -> str:
    return html.escape(str(text))


def _human(subject: str) -> str:
    return subject.replace("_", " ")


@dataclass
class Point:
    """One session's value for one quantity, with the spread behind it."""

    date: str
    value: float
    spread: float
    samples: int


@dataclass
class Series:
    """One quantity across a person's sessions, and what it did."""

    subject: str
    unit: str
    points: list[Point] = field(default_factory=list)
    lower_is_better: bool = False

    @property
    def noise(self) -> float:
        """Typical within-session spread: the floor a change has to clear."""
        return statistics.median([p.spread for p in self.points]) if self.points else 0.0

    @property
    def floor(self) -> float:
        return max(self.noise * NOISE_MULTIPLE, MIN_PRACTICAL_CHANGE)

    @property
    def change(self) -> float:
        return self.points[-1].value - self.points[0].value if len(self.points) > 1 else 0.0

    @property
    def verdict(self) -> str:
        """The same rule the written progress report uses, so the picture and
        the sentence can never disagree."""
        if len(self.points) < MIN_SESSIONS_FOR_TREND:
            return "too few sessions"
        if abs(self.change) <= self.floor:
            return "steady"
        if self.lower_is_better:
            return "improved" if self.change < 0 else "worsened"
        return "changed"

    def explain(self) -> str:
        if self.verdict == "too few sessions":
            return (f"{len(self.points)} session(s); {MIN_SESSIONS_FOR_TREND} "
                    f"are needed before a direction is called")
        if self.verdict == "steady":
            return (f"moved {self.change:+.1f}{self.unit}, inside the "
                    f"{self.floor:.1f}{self.unit} it varies anyway")
        return (f"moved {self.change:+.1f}{self.unit}, clear of the "
                f"{self.floor:.1f}{self.unit} noise floor")


def collect(store: Store, username: str, exercise: str | None = None) -> list[Series]:
    """One person's measurements, grouped into series ready to draw."""
    out: list[Series] = []
    for subject in store.subjects(username):
        rows: list[Row] = store.history(username, subject=subject, exercise=exercise)
        if not rows:
            continue
        by_date: dict[str, Row] = {}
        for row in rows:
            by_date[row.date] = row          # one point per session, latest wins
        points = [Point(date=d, value=r.value, spread=r.spread, samples=r.samples)
                  for d, r in sorted(by_date.items())]
        out.append(Series(subject=subject, unit=rows[0].unit, points=points,
                          lower_is_better=subject in LOWER_IS_BETTER))
    return out


# ---------------------------------------------------------------------------
# Charts. Inline SVG, no library, no request.
# ---------------------------------------------------------------------------

def _scale(values: list[float], size: float, pad: float = 0.0):
    low, high = min(values), max(values)
    if high - low < 1e-6:
        low, high = low - 1.0, high + 1.0
    low, high = low - pad, high + pad
    return lambda v: size - (v - low) / (high - low) * size, low, high


def line_chart(series: Series, width: int = 460, height: int = 170) -> str:
    """One quantity over time, with its within-session spread drawn behind it.

    The band is the point. A rise that stays inside the band is visibly not a
    rise, which is harder to misread than a sentence saying so underneath.
    """
    left, bottom, top, right = 46, 26, 12, 12
    plot_w, plot_h = width - left - right, height - top - bottom
    values = ([p.value for p in series.points]
              + [p.value + p.spread for p in series.points]
              + [p.value - p.spread for p in series.points])
    y_of, low, high = _scale(values, plot_h, pad=1.0)
    n = len(series.points)
    x_of = (lambda i: (plot_w / 2 if n == 1 else i / (n - 1) * plot_w))

    parts = [f"<svg viewBox='0 0 {width} {height}' role='img' "
             f"aria-label='{_e(_human(series.subject))} across "
             f"{n} sessions'>"]
    parts.append(f"<g transform='translate({left},{top})'>")

    for fraction in (0.0, 0.5, 1.0):
        y = plot_h * fraction
        value = high - (high - low) * fraction
        parts.append(f"<line class='grid' x1='0' y1='{y:.1f}' x2='{plot_w}' "
                     f"y2='{y:.1f}'/>")
        parts.append(f"<text class='tick' x='-8' y='{y + 4:.1f}' "
                     f"text-anchor='end'>{value:.0f}</text>")

    if n > 1:
        upper = " ".join(f"{x_of(i):.1f},{y_of(p.value + p.spread):.1f}"
                         for i, p in enumerate(series.points))
        lower = " ".join(f"{x_of(i):.1f},{y_of(p.value - p.spread):.1f}"
                         for i, p in reversed(list(enumerate(series.points))))
        parts.append(f"<polygon class='band' points='{upper} {lower}'/>")
        path = " ".join(f"{'M' if i == 0 else 'L'}{x_of(i):.1f},"
                        f"{y_of(p.value):.1f}" for i, p in enumerate(series.points))
        parts.append(f"<path class='line' d='{path}'/>")

    for i, point in enumerate(series.points):
        x, y = x_of(i), y_of(point.value)
        parts.append(f"<circle class='dot' cx='{x:.1f}' cy='{y:.1f}' r='4.5'>"
                     f"<title>{_e(point.date)}: {point.value:.1f}"
                     f"{_e(series.unit)} (varied {point.spread:.1f} within the "
                     f"session, {point.samples} frames)</title></circle>")
        if i in (0, n - 1):
            anchor = "start" if i == 0 else "end"
            parts.append(f"<text class='point-label' x='{x:.1f}' "
                         f"y='{y - 11:.1f}' text-anchor='{anchor}'>"
                         f"{point.value:.0f}</text>")

    for i in (0, n - 1) if n > 1 else (0,):
        anchor = "start" if i == 0 else "end"
        parts.append(f"<text class='tick' x='{x_of(i):.1f}' "
                     f"y='{plot_h + 18:.1f}' text-anchor='{anchor}'>"
                     f"{_e(series.points[i].date)}</text>")

    parts.append("</g></svg>")
    return "".join(parts)


def bar_chart(rows: list[tuple[str, int]], width: int = 880,
              bar_h: int = 14, label_h: int = 19, gap: int = 16) -> str:
    """How many sessions each recurring correction has appeared in.

    Each label sits directly above its own bar in the same group. Listing the
    labels separately and the bars below them, which is what this did first,
    leaves a reader matching two ordered lists by eye.
    """
    if not rows:
        return ""
    left, right, value_w = 2, 2, 40
    row_h = label_h + bar_h + gap
    height = len(rows) * row_h
    plot_w = width - left - right - value_w
    biggest = max(count for _, count in rows)

    parts = [f"<svg viewBox='0 0 {width} {height}' role='img' "
             f"aria-label='corrections by number of sessions'>"]
    for i, (label, count) in enumerate(rows):
        top = i * row_h
        w = max(3.0, count / biggest * plot_w)
        parts.append(f"<g><title>{_e(label)}: {count} session(s)</title>")
        parts.append(f"<text class='bar-label' x='{left}' y='{top + 13}'>"
                     f"{_e(label)}</text>")
        parts.append(f"<rect class='bar' x='{left}' y='{top + label_h}' "
                     f"width='{w:.1f}' height='{bar_h}' rx='4'/>")
        parts.append(f"<text class='bar-value' x='{left + w + 8:.1f}' "
                     f"y='{top + label_h + bar_h - 2}'>{count}</text>")
        parts.append("</g>")
    parts.append("</svg>")
    return "".join(parts)


# ---------------------------------------------------------------------------
# The page
# ---------------------------------------------------------------------------

STYLE = """
.viz-root { color-scheme: light;
  --surface:#fcfcfb; --panel:#ffffff; --ink:#0b0b0b; --muted:#52514e;
  --rule:#e3e0da; --series1:#2a78d6; --band:#dbe8f8; }
@media (prefers-color-scheme: dark) {
  :root:where(:not([data-theme="light"])) .viz-root { color-scheme: dark;
    --surface:#1a1a19; --panel:#232322; --ink:#ffffff; --muted:#c3c2b7;
    --rule:#3a3a37; --series1:#3987e5; --band:#20344c; } }
:root[data-theme="dark"] .viz-root { color-scheme: dark;
  --surface:#1a1a19; --panel:#232322; --ink:#ffffff; --muted:#c3c2b7;
  --rule:#3a3a37; --series1:#3987e5; --band:#20344c; }
* { box-sizing:border-box; }
body { margin:0; padding:28px 20px; background:var(--surface); color:var(--ink);
  font:15px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif; }
.sheet { max-width:1000px; margin:0 auto; }
header { border-bottom:2px solid var(--ink); padding-bottom:14px; margin-bottom:22px; }
h1 { margin:0 0 4px; font-size:24px; letter-spacing:-0.01em; }
.sub { color:var(--muted); font-size:14px; }
h2 { font-size:12px; text-transform:uppercase; letter-spacing:0.09em;
  margin:30px 0 8px; color:var(--muted); }
h2 + .note { margin:0 0 12px; color:var(--muted); font-size:12.5px; }
.tiles { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr));
  gap:12px; }
.tile { background:var(--panel); border:1px solid var(--rule); border-radius:8px;
  padding:14px 16px; }
.tile .n { font-size:28px; font-weight:650; letter-spacing:-0.02em;
  font-variant-numeric:tabular-nums; }
.tile .k { color:var(--muted); font-size:12px; margin-top:2px; }
.grid-2 { display:grid; grid-template-columns:repeat(auto-fit,minmax(300px,1fr));
  gap:14px; }
.card { background:var(--panel); border:1px solid var(--rule); border-radius:8px;
  padding:14px 16px; }
.card h3 { margin:0 0 2px; font-size:15px; font-weight:620; }
.card .note { color:var(--muted); font-size:12.5px; margin:0 0 8px; }
svg { width:100%; height:auto; display:block; overflow:visible; }
.grid { stroke:var(--rule); stroke-width:1; }
.tick { fill:var(--muted); font-size:11px; }
.band { fill:var(--band); }
.line { fill:none; stroke:var(--series1); stroke-width:2;
  stroke-linejoin:round; stroke-linecap:round; }
.dot { fill:var(--series1); stroke:var(--panel); stroke-width:2; }
.dot:hover { r:6; }
.point-label { fill:var(--ink); font-size:11.5px; font-weight:600;
  font-variant-numeric:tabular-nums; }
.bar { fill:var(--series1); }
.bar-value { fill:var(--ink); font-size:12px; font-weight:650;
  font-variant-numeric:tabular-nums; }
.bar-label { fill:var(--ink); font-size:12.5px; }
.bar:hover { opacity:0.85; }
.chip { display:inline-flex; align-items:center; gap:5px; font-size:11.5px;
  font-weight:650; padding:2px 9px; border-radius:10px; border:1px solid var(--rule); }
.chip .dot-mark { width:8px; height:8px; border-radius:50%; display:inline-block; }
table { width:100%; border-collapse:collapse; font-size:13.5px; }
th { text-align:left; font-size:11px; text-transform:uppercase;
  letter-spacing:0.07em; color:var(--muted); padding:0 8px 6px 0; }
td { padding:7px 8px 7px 0; border-top:1px solid var(--rule);
  font-variant-numeric:tabular-nums; }
.recur { margin:0 0 4px; font-size:13.5px; }
footer { margin-top:34px; padding-top:14px; border-top:1px solid var(--rule);
  color:var(--muted); font-size:12.5px; }
"""


def _chip(verdict: str) -> str:
    colour = STATUS.get(verdict, STATUS["steady"])
    return (f"<span class='chip'><span class='dot-mark' "
            f"style='background:{colour}'></span>{_e(verdict)}</span>")


def _tile(number: str, label: str) -> str:
    return f"<div class='tile'><div class='n'>{_e(number)}</div>" \
           f"<div class='k'>{_e(label)}</div></div>"


def render(
    store: Store,
    username: str,
    display_name: str = "",
    studio: str = "",
    exercise: str | None = None,
) -> str:
    """One person's whole record as a self-contained page."""
    series = collect(store, username, exercise)
    dates = store.session_dates(username)
    recurring = store.recurring_findings(username)
    name = display_name or username

    parts = [
        "<!doctype html><html lang='en'><head><meta charset='utf-8'>",
        "<meta name='viewport' content='width=device-width,initial-scale=1'>",
        f"<title>{_e(name)} — progress</title>",
        f"<style>{STYLE}</style></head><body class='viz-root'><div class='sheet'>",
        f"<header><h1>{_e(name)}</h1><div class='sub'>",
        f"{len(dates)} session(s)"
        + (f" · {_e(dates[0])} to {_e(dates[-1])}" if dates else "")
        + (f" · {_e(studio)}" if studio else "")
        + (f" · {_e(exercise.replace('_', ' '))}" if exercise else "")
        + "</div></header>",
    ]

    if not dates:
        parts.append(
            "<p class='sub'>Nothing is recorded against this person yet. "
            "Measurements are stored as soon as a class is analysed, but they "
            "are only attributed once somebody confirms which tracked body was "
            "whom — so an unconfirmed session shows here as nothing rather than "
            "as a guess.</p></div></body></html>")
        return "".join(parts)

    moving = [s for s in series if s.verdict in ("improved", "worsened", "changed")]
    parts.append("<h2>At a glance</h2><div class='tiles'>")
    parts.append(_tile(str(len(dates)), "sessions recorded"))
    parts.append(_tile(str(len(series)), "quantities tracked"))
    parts.append(_tile(str(len(moving)), "with a change clear of the noise"))
    parts.append(_tile(str(len(recurring)), "corrections seen more than once"))
    parts.append("</div>")

    if series:
        parts.append(
            "<h2>Over time</h2><p class='note'>The shaded band behind each line "
            "is how much that quantity varied inside a single session. A move "
            "that stays inside the band is not a move.</p><div class='grid-2'>")
        for item in sorted(series, key=lambda s: s.subject):
            parts.append(
                f"<div class='card'><h3>{_e(_human(item.subject))} "
                f"{_chip(item.verdict)}</h3>"
                f"<p class='note'>{_e(item.explain())}</p>"
                + line_chart(item) + "</div>")
        parts.append("</div>")

    if recurring:
        parts.append("<h2>What keeps coming back</h2><div class='card'>")
        parts.append("<p class='note'>Corrections given in more than one "
                     "session, by how many sessions they appeared in.</p>")
        parts.append(bar_chart([(e["message"], e["sessions"]) for e in recurring]))
        parts.append("</div>")

    parts.append("<h2>The numbers behind the charts</h2><div class='card'><table>"
                 "<thead><tr><th>Date</th><th>Quantity</th><th>Value</th>"
                 "<th>Varied by</th><th>Frames</th><th>From</th></tr></thead><tbody>")
    for item in sorted(series, key=lambda s: s.subject):
        for point in item.points:
            parts.append(
                f"<tr><td>{_e(point.date)}</td><td>{_e(_human(item.subject))}</td>"
                f"<td>{point.value:.1f}{_e(item.unit)}</td>"
                f"<td>{point.spread:.1f}{_e(item.unit)}</td>"
                f"<td>{point.samples}</td><td>measured</td></tr>")
    parts.append("</tbody></table></div>")

    parts.append(
        "<footer>Every number here was measured from video and is geometric: "
        "angles, ranges and timings. It is not health advice. A change is only "
        "called a change once it clears both the spread within a single session "
        f"and {MIN_PRACTICAL_CHANGE:.0f} degrees outright, and a direction is "
        f"only called after {MIN_SESSIONS_FOR_TREND} sessions."
        "<br>Only sessions where somebody confirmed which tracked body was this "
        "person appear here.</footer></div></body></html>")
    return "".join(parts)
