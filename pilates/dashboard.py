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
from .scoring import MEASURABLE, Score, score_from_store
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


#: Units that read as part of the number ("62deg") rather than as a word after
#: it. Anything else is a description of the quantity, not a unit to print: a
#: control figure of 1.5 is not "1.5 ratio".
ATTACHED_UNITS = ("deg", "Nm", "s", "%")


def unit_suffix(unit: str) -> str:
    return unit if unit in ATTACHED_UNITS else ""


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
        parts.append(
            f"<circle class='dot' cx='{x:.1f}' cy='{y:.1f}' r='4.5' "
            f"data-date='{_e(point.date)}' data-value='{point.value:.1f}' "
            f"data-spread='{point.spread:.1f}' data-samples='{point.samples}' "
            f"data-unit='{_e(unit_suffix(series.unit))}'>"
            f"<title>{_e(point.date)}: {point.value:.1f}"
            f"{_e(unit_suffix(series.unit))} (varied {point.spread:.1f} within "
            f"the session, {point.samples} frames)</title></circle>")
        # A hit target the size of a fingertip, invisible, so hovering a line
        # does not require landing on a 9-pixel dot. Kept strictly inside the
        # plot: the SVG overflows visibly so the axis labels are not clipped,
        # and a hit area that stuck out above the plot caught pointer events
        # meant for the card's heading.
        parts.append(f"<rect class='hit' x='{x - 14:.1f}' y='0' width='28' "
                     f"height='{plot_h:.1f}' data-index='{i}'/>")
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


def bar_chart(rows, width: int = 880, bar_h: int = 14, label_h: int = 19,
              gap: int = 16) -> str:
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
    biggest = max(row[1] for row in rows)

    parts = [f"<svg viewBox='0 0 {width} {height}' role='img' "
             f"aria-label='corrections by number of sessions'>"]
    for i, row in enumerate(rows):
        label, count = row[0], row[1]
        # A third element, when present, is the body-map markers this
        # correction belongs to. Selecting a joint should bring its own
        # corrections forward -- somebody who clicked a hip wants the hip's.
        markers = row[2] if len(row) > 2 else ""
        top = i * row_h
        w = max(3.0, count / biggest * plot_w)
        parts.append(f"<g class='barrow' data-subjects='{_e(markers)}'>"
                     f"<title>{_e(label)}: {count} session(s)</title>")
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
# The body map: which parts of a body were measured, and how each one scored.
# ---------------------------------------------------------------------------

#: The figure, as named anchors. Everything else on the map is derived from
#: these rather than written out again: the first version listed marker
#: positions separately and they drifted a few pixels off the limbs they were
#: supposed to sit on, which looked like a rendering fault and was really two
#: copies of the same numbers disagreeing.
_ANCHORS: dict[str, tuple[float, float]] = {
    "head": (100, 28), "neck": (100, 60),
    "l_shoulder": (70, 82), "r_shoulder": (130, 82),
    "l_elbow": (56, 132), "r_elbow": (144, 132),
    "l_wrist": (50, 180), "r_wrist": (150, 180),
    "l_hip": (82, 172), "r_hip": (118, 172),
    "l_knee": (79, 244), "r_knee": (121, 244),
    "l_ankle": (78, 312), "r_ankle": (122, 312),
}


def _between(a: str, b: str) -> tuple[float, float]:
    (x1, y1), (x2, y2) = _ANCHORS[a], _ANCHORS[b]
    return ((x1 + x2) / 2, (y1 + y2) / 2)


#: Where each measured quantity sits on the figure. Drawn rather than posed:
#: the map answers "which part of you", and a real pose would answer "what were
#: you doing", which the charts already do.
BODY_POINTS: dict[str, tuple[float, float]] = {
    "neck": _ANCHORS["neck"],
    "shoulder_tilt": _between("l_shoulder", "r_shoulder"),
    "left_shoulder": _ANCHORS["l_shoulder"],
    "right_shoulder": _ANCHORS["r_shoulder"],
    "left_elbow": _ANCHORS["l_elbow"], "right_elbow": _ANCHORS["r_elbow"],
    "trunk": (100.0, (_ANCHORS["neck"][1] + _ANCHORS["l_hip"][1]) / 2),
    "pelvis_tilt": _between("l_hip", "r_hip"),
    "left_hip": _ANCHORS["l_hip"], "right_hip": _ANCHORS["r_hip"],
    "left_knee": _ANCHORS["l_knee"], "right_knee": _ANCHORS["r_knee"],
}
_BONES = (
    ("head", "neck"), ("neck", "l_shoulder"), ("neck", "r_shoulder"),
    ("l_shoulder", "r_shoulder"), ("l_shoulder", "l_elbow"),
    ("r_shoulder", "r_elbow"), ("l_elbow", "l_wrist"), ("r_elbow", "r_wrist"),
    ("l_shoulder", "l_hip"), ("r_shoulder", "r_hip"), ("l_hip", "r_hip"),
    ("l_hip", "l_knee"), ("r_hip", "r_knee"), ("l_knee", "l_ankle"),
    ("r_knee", "r_ankle"),
)

#: Score bands. Three states rather than a continuous ramp, because the
#: question a body map answers is "which parts need attention", and a ramp
#: makes the parts that are fine the most prominent thing on the picture.
#: Each band is named in the legend, so colour never carries it alone.
BANDS = ((80.0, "good", "on target"), (60.0, "watch", "worth watching"),
         (0.0, "work", "needs work"))


#: Joints a body-map marker stands for. A quantity is linked to a marker when
#: it is about that joint, so clicking a knee brings up the knee angle, the
#: knee symmetry gap and the moments the knee muscles carried -- which is what
#: a person means when they point at a knee.
JOINT_WORDS = ("knee", "hip", "elbow", "shoulder", "neck", "trunk", "pelvis")


def body_subjects_for(subject: str) -> set[str]:
    """Which body-map markers a measured quantity belongs to.

    Whole-body qualities -- repetitions, control, tempo -- belong to no marker
    and return an empty set. They are not about a joint, and pretending they
    are would put a tempo chart under a knee.
    """
    if subject in BODY_POINTS:
        return {subject}
    for word in JOINT_WORDS:
        if word in subject:
            sides = {f"left_{word}", f"right_{word}"} & set(BODY_POINTS)
            return sides or ({word} if word in BODY_POINTS else set())
    return set()


def band(value: float | None) -> tuple[str, str]:
    """Which band a score falls in, and the words for it."""
    if value is None:
        return "unmeasured", "not measured"
    for floor, key, label in BANDS:
        if value >= floor:
            return key, label
    return "work", "needs work"


def body_map(scores: dict[str, float | None], width: int = 260,
             height: int = 360, label_worst: int = 3) -> str:
    """A figure with every measurable quantity marked and scored.

    Grey is a real state here and a common one: a joint out of frame is not a
    joint that scored badly, and the two must never look alike.
    """
    parts = [f"<svg viewBox='0 0 200 {height}' class='bodymap' role='img' "
             f"aria-label='body map of measured quantities'>"]
    for a, b in _BONES:
        (x1, y1), (x2, y2) = _ANCHORS[a], _ANCHORS[b]
        parts.append(f"<line class='bone' x1='{x1}' y1='{y1}' x2='{x2}' "
                     f"y2='{y2}'/>")
    # Drawn over the bones, so the neck segment does not show through it.
    parts.append(f"<circle class='bone-fill' cx='{_ANCHORS['head'][0]}' "
                 f"cy='{_ANCHORS['head'][1]}' r='16'/>")

    ranked = sorted(((n, v) for n, v in scores.items() if v is not None),
                    key=lambda kv: kv[1])
    call_out = {name for name, _ in ranked[:label_worst]}

    for name, (x, y) in BODY_POINTS.items():
        value = scores.get(name)
        key, label = band(value)
        shown = f"{value:.0f}" if value is not None else "—"
        parts.append(
            f"<g class='mark {key}' data-subject='{_e(name)}' role='button' "
            f"tabindex='0' aria-label='{_e(_human(name))}, {_e(label)}"
            f"{f', {value:.0f} out of 100' if value is not None else ''}'>"
            f"<title>{_e(_human(name))}: "
            f"{shown if value is not None else 'not measured often enough'}"
            f"{' out of 100' if value is not None else ''} — {_e(label)}</title>"
            f"<circle class='halo' cx='{x}' cy='{y}' r='15'/>"
            f"<circle cx='{x}' cy='{y}' r='9'/>")
        if name in call_out:
            parts.append(f"<text class='mark-label' x='{x}' y='{y - 13}' "
                         f"text-anchor='middle'>{shown}</text>")
        parts.append("</g>")
    parts.append("</svg>")
    return "".join(parts)


def score_ring(score: Score, size: int = 132) -> str:
    """The headline number, as a number rather than a gauge.

    A ring around it reads at a glance; the ring is a plain proportion of a
    circle, not a dial with an implied scale nobody defined.
    """
    value = score.value
    radius = size / 2 - 10
    circumference = 2 * 3.14159 * radius
    filled = circumference * ((value or 0.0) / 100.0)
    key, _ = band(value)
    return (
        f"<svg viewBox='0 0 {size} {size}' class='ring {key}' role='img' "
        f"aria-label='session score'>"
        f"<circle class='ring-track' cx='{size/2}' cy='{size/2}' r='{radius}'/>"
        f"<circle class='ring-fill' cx='{size/2}' cy='{size/2}' r='{radius}' "
        f"stroke-dasharray='{filled:.1f} {circumference:.1f}' "
        f"transform='rotate(-90 {size/2} {size/2})'/>"
        f"<text class='ring-value' x='{size/2}' y='{size/2 + 3}' "
        f"text-anchor='middle'>{value:.0f}</text>"
        f"<text class='ring-unit' x='{size/2}' y='{size/2 + 22}' "
        f"text-anchor='middle'>out of 100</text></svg>"
        if value is not None else
        f"<svg viewBox='0 0 {size} {size}' class='ring unmeasured' role='img' "
        f"aria-label='no score'>"
        f"<circle class='ring-track' cx='{size/2}' cy='{size/2}' r='{radius}'/>"
        f"<text class='ring-value' x='{size/2}' y='{size/2 + 3}' "
        f"text-anchor='middle'>—</text>"
        f"<text class='ring-unit' x='{size/2}' y='{size/2 + 22}' "
        f"text-anchor='middle'>no score</text></svg>")


# ---------------------------------------------------------------------------
# The page
# ---------------------------------------------------------------------------

STYLE = """
.viz-root { color-scheme: light;
  --surface:#fcfcfb; --panel:#ffffff; --ink:#0b0b0b; --muted:#52514e;
  --rule:#e3e0da; --series1:#2a78d6; --band:#dbe8f8;
  --good:#0ca30c; --watch:#fab219; --work:#d03b3b; }
@media (prefers-color-scheme: dark) {
  :root:where(:not([data-theme="light"])) .viz-root { color-scheme: dark;
    --surface:#1a1a19; --panel:#232322; --ink:#ffffff; --muted:#c3c2b7;
    --rule:#3a3a37; --series1:#3987e5; --band:#20344c;
    --good:#0ca30c; --watch:#fab219; --work:#d03b3b; } }
:root[data-theme="dark"] .viz-root { color-scheme: dark;
  --surface:#1a1a19; --panel:#232322; --ink:#ffffff; --muted:#c3c2b7;
  --rule:#3a3a37; --series1:#3987e5; --band:#20344c;
  --good:#0ca30c; --watch:#fab219; --work:#d03b3b; }
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
.lede { margin:0 0 6px; font-size:15px; }
.card h3 { margin:0 0 10px; font-size:13px; text-transform:uppercase;
  letter-spacing:0.08em; color:var(--muted); }
.grid-2 { display:grid; grid-template-columns:repeat(auto-fit,minmax(300px,1fr));
  gap:14px; }
.card { background:var(--panel); border:1px solid var(--rule); border-radius:8px;
  padding:14px 16px; }
.grid-2 > .card { align-self:start; }
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
.hero { display:grid; grid-template-columns:auto 1fr; gap:22px; align-items:center;
  background:var(--panel); border:1px solid var(--rule); border-radius:8px;
  padding:18px 20px; }
.hero .ring { width:132px; height:132px; }
.ring-track { fill:none; stroke:var(--rule); stroke-width:9; }
.ring-fill { fill:none; stroke-width:9; stroke-linecap:round; }
.ring.good .ring-fill { stroke:var(--good); }
.ring.watch .ring-fill { stroke:var(--watch); }
.ring.work .ring-fill { stroke:var(--work); }
.ring-value { fill:var(--ink); font-size:34px; font-weight:680;
  font-variant-numeric:tabular-nums; }
.ring-unit { fill:var(--muted); font-size:11px; }
.bodymap { width:100%; max-width:236px; height:auto; margin:0 auto; display:block; }
.bone { stroke:var(--rule); stroke-width:5; stroke-linecap:round; }
.bone-fill { fill:var(--rule); stroke:none; }
.mark circle { stroke:var(--panel); stroke-width:2.5; }
.mark.good circle { fill:var(--good); }
.mark.watch circle { fill:var(--watch); }
.mark.work circle { fill:var(--work); }
.mark.unmeasured circle { fill:var(--rule); }
.mark:hover circle { r:11; }
.mark-label { fill:var(--ink); font-size:11px; font-weight:650;
  font-variant-numeric:tabular-nums; }
.key { display:flex; flex-wrap:wrap; gap:12px; margin-top:10px; }
.key span { display:inline-flex; align-items:center; gap:6px; font-size:12px;
  color:var(--muted); }
.key i { width:10px; height:10px; border-radius:50%; display:inline-block; }
.comp { display:flex; align-items:center; gap:10px; margin:7px 0; font-size:13.5px; }
.comp .n { font-variant-numeric:tabular-nums; font-weight:650; width:34px;
  text-align:right; }
.comp .track { display:block; flex:1; height:8px; background:var(--rule);
  border-radius:4px; overflow:hidden; }
.comp .fill { display:block; height:8px; border-radius:4px; }
.comp .cnt { color:var(--muted); font-size:12px; white-space:nowrap; }

/* --- interaction ------------------------------------------------------- */
.picker { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:20px; }
.pick { font:inherit; font-size:12.5px; cursor:pointer; padding:5px 10px;
  border:1px solid var(--rule); background:var(--panel); color:var(--muted);
  border-radius:6px; display:inline-flex; align-items:baseline; gap:7px; }
.pick em { font-style:normal; font-weight:650; font-variant-numeric:tabular-nums;
  color:var(--ink); }
.pick:hover { border-color:var(--series1); }
.pick.on { border-color:var(--series1); color:var(--ink);
  box-shadow:inset 0 0 0 1px var(--series1); }
.mark { cursor:pointer; }
.mark .halo { fill:transparent; }
.mark:hover circle:last-of-type, .mark:focus-visible circle:last-of-type { r:11; }
.mark:focus-visible .halo { fill:none; stroke:var(--series1); stroke-width:2; }
.mark.picked circle:last-of-type { stroke:var(--ink); stroke-width:2.5; r:11; }
.hit { fill:transparent; cursor:crosshair; }
/* Its own line with the height always reserved. Inside the heading, showing
   this text reflowed the heading, which moved the chart out from under the
   pointer, which cleared the text, which moved it back -- a loop. */
.readout { font-size:12px; color:var(--series1); margin:0 0 6px;
  font-variant-numeric:tabular-nums; min-height:1.35em; line-height:1.35;
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.card h3 { display:flex; align-items:baseline; gap:8px; flex-wrap:wrap; }
.filterbar { display:flex; align-items:center; gap:14px; margin:0 0 14px;
  padding:9px 14px; background:var(--panel); border:1px solid var(--series1);
  border-radius:6px; font-size:13.5px; }
.filterbar .what { color:var(--ink); }
.clear { font:inherit; font-size:13px; cursor:pointer; padding:4px 11px;
  border:1px solid var(--rule); background:var(--surface); color:var(--ink);
  border-radius:5px; margin-left:auto; }
.clear:hover { border-color:var(--series1); }
.card.chart.dim { display:none; }
/* Corrections fade rather than vanish: a person who clicked a hip still wants
   to see that this correction is third of thirteen, not first of two. */
.barrow.dim { opacity:0.22; }
@media (prefers-reduced-motion: no-preference) { .barrow { transition:opacity .15s ease; } }
button:focus-visible, .mark:focus-visible { outline:2px solid var(--series1);
  outline-offset:2px; }
@media (prefers-reduced-motion: no-preference) {
  /* Named properties, not "all": transitioning everything animates fill
     changes and confuses anything measuring whether the page has settled. */
  .pick, .clear { transition:border-color .12s ease, box-shadow .12s ease; }
  .dot, .mark circle { transition:r .12s ease; }
}
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




def _session_keys(store: Store, username: str) -> list[tuple[str, str]]:
    """This person's confirmed sessions as (key, date), oldest first."""
    return [(r["session_key"], r["date"]) for r in store.db.execute(
        "SELECT DISTINCT session_key, date FROM attributed_measurements "
        "WHERE username = ? ORDER BY date, session_key", (username,))]


def _subject_scores(score: Score) -> dict[str, float | None]:
    """Per-quantity scores for the body map, with unmeasured left as None."""
    out: dict[str, float | None] = {name: None for name in MEASURABLE}
    for component in score.components.values():
        for subject, value in component.checks:
            base = subject.replace(" symmetry", "")
            for name in (subject, f"left_{base}", f"right_{base}"):
                if name in out:
                    out[name] = value if out[name] is None else min(out[name], value)
    return out


def _band_key() -> str:
    keys = "".join(
        f"<span><i style='background:var(--{k})'></i>{_e(label)}</span>"
        for _, k, label in BANDS)
    return (f"<div class='key'>{keys}"
            f"<span><i style='background:var(--rule)'></i>not measured</span>"
            f"</div>")


def _score_history(scores: list) -> str:
    """Every session's score, if there is more than one to draw.

    A session where less of the body was visible has fewer checks behind it, so
    each point carries its own count on hover rather than pretending the line
    is made of like-for-like numbers.
    """
    points = [Point(date=date, value=item.value, spread=0.0, samples=item.checks)
              for date, item in scores if item.value is not None]
    if len(points) < 2:
        return ""
    return ("<div class='card'><h3>Score, session by session</h3>"
            + line_chart(Series(subject="score", unit="", points=points))
            + "<p class='note'>Hover a point for the number of checks it came "
              "from. A score is only as comparable as its coverage.</p></div>")


def _session_picker(scores: list) -> str:
    """Every session, selectable. The page opens on the most recent one.

    Rendered as buttons rather than a dropdown: a dozen dates is a thing to
    scan, and a person comparing two sessions wants to see both labels at
    once.
    """
    if len(scores) < 2:
        return "<h2>Latest session</h2>"
    buttons = "".join(
        f"<button type='button' class='pick{' on' if i == len(scores) - 1 else ''}' "
        f"data-session='{i}'>{_e(date)}"
        + (f"<em>{score.value:.0f}</em>" if score.value is not None else "<em>—</em>")
        + "</button>"
        for i, (date, score) in enumerate(scores))
    return ("<h2>Session</h2><div class='picker' role='group' "
            "aria-label='choose a session'>" + buttons + "</div>")


def _components(score: Score) -> str:
    """The parts the headline number is made of, weakest first."""
    rows = ["<h3>What made up the score</h3>"]
    for component in sorted(score.components.values(),
                            key=lambda c: (c.score is None, c.score or 0)):
        if component.score is None:
            continue
        key, _ = band(component.score)
        rows.append(
            f"<div class='comp'><span class='n'>{component.score:.0f}</span>"
            f"<span class='track'><span class='fill' style='width:"
            f"{component.score:.0f}%;background:var(--{key})'></span></span>"
            f"<span class='cnt'>{_e(component.name)}, {component.n} check"
            f"{'s' if component.n != 1 else ''}</span></div>")
    weakest = min((c for c in score.components.values() if c.weakest),
                  key=lambda c: c.weakest[1], default=None)
    if weakest is not None and weakest.weakest[1] < 70:
        rows.append(f"<p class='note'>The single weakest check was "
                    f"{_e(_human(weakest.weakest[0]))} at "
                    f"{weakest.weakest[1]:.0f} out of 100.</p>")
    return "".join(rows)


def _score_summary(score: Score, history: list) -> str:
    """The sentence beside the headline number."""
    lines = [f"<p class='lede'>{score.checks} checks were made, covering "
             f"{score.measured} of {score.measurable} measurable quantities "
             f"({score.coverage:.0%} of the body).</p>"]
    scored = [s for _, s in history if s.value is not None]
    if len(scored) > 1:
        change = scored[-1].value - scored[-2].value
        word = "up" if change > 0 else ("down" if change < 0 else "level")
        lines.append(f"<p class='note'>{word.title()} {abs(change):.0f} on the "
                     f"session before. A score is only as comparable as the "
                     f"coverage behind it: that one had {scored[-2].checks} "
                     f"checks.</p>")
    if score.missing:
        lines.append(f"<p class='note'>Not visible often enough to judge: "
                     f"{_e(', '.join(_human(m) for m in sorted(score.missing)))}."
                     f"</p>")
    return "".join(lines)




#: The page works without this. Everything is rendered and readable with
#: scripting off -- the script adds linking between the two views, a live
#: readout on the charts, and the session picker. A page about somebody's body
#: measurements should not go blank because a script failed to run.
SCRIPT = """
(function () {
  var sheet = document.querySelector('.sheet');
  if (!sheet) return;

  /* ---- session picker: panels are pre-rendered, this only toggles them --- */
  var picks = sheet.querySelectorAll('.pick');
  var panels = sheet.querySelectorAll('.session');
  function showSession(index) {
    panels.forEach(function (p) { p.hidden = p.dataset.session !== index; });
    picks.forEach(function (b) { b.classList.toggle('on', b.dataset.session === index); });
  }
  picks.forEach(function (b) {
    b.addEventListener('click', function () { showSession(b.dataset.session); });
  });

  /* ---- linked selection: one subject, both views ------------------------ */
  var charts = sheet.querySelectorAll('.card.chart');
  var bar = sheet.querySelector('.filterbar');
  var what = bar ? bar.querySelector('.what') : null;
  var selected = null;

  function human(name) { return name.replace(/_/g, ' '); }

  function apply() {
    var shown = 0;
    charts.forEach(function (card) {
      var owns = (card.dataset.subjects || '').split(' ').filter(Boolean);
      var match = !selected || card.dataset.subject === selected
                  || owns.indexOf(selected) !== -1;
      card.classList.toggle('dim', !match);
      if (match) shown++;
    });
    sheet.querySelectorAll('.mark').forEach(function (m) {
      m.classList.toggle('picked', !!selected && m.dataset.subject === selected);
    });
    sheet.querySelectorAll('.barrow').forEach(function (row) {
      var owns = (row.dataset.subjects || '').split(' ').filter(Boolean);
      row.classList.toggle('dim', !!selected && owns.indexOf(selected) === -1);
    });
    if (bar) {
      bar.hidden = !selected;
      if (selected && what) {
        what.textContent = 'Showing ' + shown + ' of ' + charts.length
          + ' quantities, for the ' + human(selected) + '.';
      }
    }
  }

  function select(subject) {
    selected = (selected === subject) ? null : subject;
    apply();
    if (selected) {
      var heading = document.getElementById('over-time');
      var still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (heading) {
        heading.scrollIntoView({ behavior: still ? 'auto' : 'smooth',
                                 block: 'start' });
      }
    }
  }

  sheet.addEventListener('click', function (event) {
    var mark = event.target.closest('.mark');
    if (mark && mark.dataset.subject) { select(mark.dataset.subject); return; }
    var head = event.target.closest('.card.chart h3');
    if (head) { select(head.parentElement.dataset.subject); }
  });

  sheet.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && selected) { selected = null; apply(); return; }
    if (event.key !== 'Enter' && event.key !== ' ') return;
    var mark = event.target.closest('.mark');
    if (mark && mark.dataset.subject) { event.preventDefault(); select(mark.dataset.subject); }
  });

  var clear = sheet.querySelector('.clear');
  if (clear) clear.addEventListener('click', function () { selected = null; apply(); });

  /* ---- live readout: hovering a chart names the session under the cursor - */
  charts.forEach(function (card) {
    var readout = card.querySelector('.readout');
    var dots = card.querySelectorAll('.dot');
    if (!readout || !dots.length) return;
    card.querySelectorAll('.hit').forEach(function (hit) {
      hit.addEventListener('mouseenter', function () {
        var dot = dots[+hit.dataset.index];
        if (!dot) return;
        var unit = dot.dataset.unit || '';
        readout.textContent = dot.dataset.date + ' · ' + dot.dataset.value + unit
          + ' (varied ' + dot.dataset.spread + unit + ' over '
          + dot.dataset.samples + ' frames)';
        dot.setAttribute('r', '6.5');
      });
      hit.addEventListener('mouseleave', function () {
        var dot = dots[+hit.dataset.index];
        if (dot) dot.setAttribute('r', '4.5');
        readout.textContent = '';
      });
    });
  });
})();
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
    # Carried as (date, score): a chart axis shows a person a date, never the
    # internal key a session happens to be filed under.
    scores = [(date, score_from_store(store, username, key))
              for key, date in _session_keys(store, username)]

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

    latest = scores[-1][1] if scores else None
    if latest is not None:
        parts.append(_session_picker(scores))
        for index, (date, score) in enumerate(scores):
            last = index == len(scores) - 1
            parts.append(
                f"<div class='session' data-session='{index}'"
                + ("" if last else " hidden") + ">"
                + "<div class='hero'>" + score_ring(score)
                + "<div>" + _score_summary(score, scores[:index + 1]) + "</div></div>"
                + "<p class='note map-note'>Every quantity this system can "
                  "measure, and how each one scored. Grey is not a low score — "
                  "it is a part of the body that was not visible often enough "
                  "to judge. Click any marker to see its charts.</p>"
                + "<div class='grid-2'><div class='card'>"
                + body_map(_subject_scores(score)) + _band_key()
                + "</div><div>"
                + "<div class='card'>" + _components(score) + "</div>"
                + _score_history(scores) + "</div></div></div>")

    moving = [s for s in series if s.verdict in ("improved", "worsened", "changed")]
    parts.append("<h2>At a glance</h2><div class='tiles'>")
    parts.append(_tile(str(len(dates)), "sessions recorded"))
    parts.append(_tile(str(len(series)), "quantities tracked"))
    parts.append(_tile(str(len(moving)), "with a change clear of the noise"))
    parts.append(_tile(str(len(recurring)), "corrections seen more than once"))
    parts.append("</div>")



    if series:
        parts.append(
            "<h2 id='over-time'>Over time</h2>"
            "<p class='note'>The shaded band behind each line is how much that "
            "quantity varied inside a single session. A move that stays inside "
            "the band is not a move.</p>"
            "<div class='filterbar' hidden>"
            "<span class='what'></span>"
            "<button type='button' class='clear'>Show all quantities</button>"
            "</div>"
            "<div class='grid-2' id='charts'>")
        for item in sorted(series, key=lambda s: s.subject):
            markers = " ".join(sorted(body_subjects_for(item.subject)))
            parts.append(
                f"<div class='card chart' data-subjects='{_e(markers)}' "
                f"data-subject='{_e(item.subject)}'>"
                f"<h3>{_e(_human(item.subject))} {_chip(item.verdict)}</h3>"
                f"<p class='note'>{_e(item.explain())}</p>"
                f"<p class='readout' aria-live='polite'></p>"
                + line_chart(item) + "</div>")
        parts.append("</div>")

    if recurring:
        parts.append("<h2>What keeps coming back</h2><div class='card'>")
        parts.append("<p class='note'>Corrections given in more than one "
                     "session, by how many sessions they appeared in.</p>")
        parts.append(bar_chart([
            (e["message"], e["sessions"],
             " ".join(sorted(body_subjects_for(e["subject"] or e["message"]))))
            for e in recurring]))
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

    if latest is not None and latest.value is None:
        parts.append(f"<h2>Latest session</h2><div class='card'>"
                     f"<p class='note'>No score: {_e(latest.withheld_reason)}."
                     f"</p></div>")

    parts.append(
        "<footer>Every number here was measured from video and is geometric: "
        "angles, ranges and timings. It is not health advice. A change is only "
        "called a change once it clears both the spread within a single session "
        f"and {MIN_PRACTICAL_CHANGE:.0f} degrees outright, and a direction is "
        f"only called after {MIN_SESSIONS_FOR_TREND} sessions."
        "<br>A score is the average of the checks that could actually be made, "
        "weighted by how many each part contributed. Nothing unmeasured is "
        "counted as either good or bad, and no score is shown when too little "
        "of the body was visible for one to mean anything."
        "<br>Only sessions where somebody confirmed which tracked body was this "
        "person appear here.</footer></div>"
        f"<script>{SCRIPT}</script></body></html>")
    return "".join(parts)
