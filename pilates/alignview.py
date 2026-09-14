"""Drawing an alignment assessment: skeleton, plumb line, and what was refused.

SVG, for the same reason :mod:`pilates.report` emits self-contained HTML. It
needs no plotting library in a runtime that is deliberately four packages deep,
it prints at any size, it embeds in the report that already exists, and a
studio can open it in a browser with nothing installed.

**The picture has to be as honest as the numbers.** A posture overlay is the
most persuasive thing this system produces -- lines drawn on a photograph of
your own body read as fact -- so the drawing rules follow the measurement
rules exactly:

* a measurement that was refused is *drawn* as refused, in the margin, with its
  reason, rather than left off the picture where its absence cannot be seen;
* an ESTIMATED measurement is drawn dashed, so the eye can tell it from one
  the camera could see directly;
* the plumb line is drawn from the ankles because that is where it is dropped
  from, and it is labelled as a reference rather than as a target -- nobody
  stands exactly on it and a line implying they should is a line that invents
  a fault;
* low-confidence joints are drawn hollow. A joint the model was unsure of
  should not look like one it was sure of.
"""
from __future__ import annotations

import html

from . import keypoints as kp
from .alignment import Availability, Metric, PostureAssessment, View
from .types import Detection

#: Ink. Deliberately not a brand palette: this is a measurement drawing, and
#: colour carries meaning here rather than identity.
INK = {
    "bone": "#3f4d5a",
    "joint": "#1f6feb",
    "plumb": "#8899a6",
    "ok": "#2f9e63",
    "notable": "#d1791f",
    "refused": "#8e9aa5",
    "estimated": "#6b7fd7",
    "text": "#1b2733",
    "paper": "#ffffff",
}


#: Said on every drawing this module produces, and kept whole in a `<desc>` so
#: a wrap can never leave half of it. This is the one string in the codebase
#: that a studio might be asked to account for.
DISCLAIMER = "Measured alignment from one camera. Not a medical assessment."


def _e(text: object) -> str:
    return html.escape(str(text), quote=True)


def _confident(det: Detection, joint: int, threshold: float) -> bool:
    return bool(det.scores[joint] >= threshold)


def _skeleton(det: Detection, threshold: float) -> list[str]:
    def real(joint: int) -> bool:
        """Confident *and* somewhere. A landmark at exactly (0, 0) is a slot a
        backend never filled; drawing to it rakes a line to the frame corner."""
        x, y = det.keypoints[joint]
        return _confident(det, joint, threshold) and not (x == 0.0 and y == 0.0)

    out = []
    for a, b in kp.SKELETON:
        if not (real(a) and real(b)):
            continue
        (x0, y0), (x1, y1) = det.keypoints[a], det.keypoints[b]
        out.append(f'<line x1="{x0:.1f}" y1="{y0:.1f}" x2="{x1:.1f}" y2="{y1:.1f}" '
                   f'stroke="{INK["bone"]}" stroke-width="2.5" stroke-linecap="round" '
                   f'opacity="0.85"/>')
    for joint in range(kp.NUM_KEYPOINTS):
        x, y = det.keypoints[joint]
        if real(joint):
            out.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="4" '
                       f'fill="{INK["joint"]}" opacity="0.9"/>')
        elif det.scores[joint] > 0.05 and not (x == 0.0 and y == 0.0):
            # found but not trusted: hollow, so the eye can tell the difference
            out.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="4" fill="none" '
                       f'stroke="{INK["joint"]}" stroke-width="1.2" '
                       f'stroke-dasharray="2 2" opacity="0.55"/>')
    return out


def _mid(det: Detection, a: int, b: int) -> tuple[float, float]:
    return (float((det.keypoints[a][0] + det.keypoints[b][0]) / 2.0),
            float((det.keypoints[a][1] + det.keypoints[b][1]) / 2.0))


def _plumb(det: Detection, height: int, threshold: float) -> list[str]:
    """A vertical reference dropped through the midpoint of the ankles."""
    if not (_confident(det, kp.L_ANKLE, threshold) and _confident(det, kp.R_ANKLE, threshold)):
        return []
    x, _ = _mid(det, kp.L_ANKLE, kp.R_ANKLE)
    return [
        f'<line x1="{x:.1f}" y1="0" x2="{x:.1f}" y2="{height}" stroke="{INK["plumb"]}" '
        f'stroke-width="1.2" stroke-dasharray="6 5" opacity="0.8"/>',
        f'<text x="{x + 6:.1f}" y="16" font-size="11" fill="{INK["plumb"]}">'
        f'vertical reference</text>',
    ]


def _level_line(det: Detection, left: int, right: int, metric: Metric,
                threshold: float) -> list[str]:
    """The measured line, plus the level one it is being compared against."""
    if not metric.measured:
        return []
    if not (_confident(det, left, threshold) and _confident(det, right, threshold)):
        return []
    (x0, y0), (x1, y1) = det.keypoints[left], det.keypoints[right]
    colour = INK["notable"] if metric.notable else INK["ok"]
    dash = ' stroke-dasharray="5 4"' if metric.availability is Availability.ESTIMATED else ""
    mid_y = (y0 + y1) / 2.0
    label_x, label_y = max(x0, x1) + 10, mid_y - 4
    return [
        f'<line x1="{x0:.1f}" y1="{mid_y:.1f}" x2="{x1:.1f}" y2="{mid_y:.1f}" '
        f'stroke="{INK["plumb"]}" stroke-width="1" stroke-dasharray="3 4" opacity="0.7"/>',
        f'<line x1="{x0:.1f}" y1="{y0:.1f}" x2="{x1:.1f}" y2="{y1:.1f}" '
        f'stroke="{colour}" stroke-width="3"{dash} stroke-linecap="round"/>',
        f'<text x="{label_x:.1f}" y="{label_y:.1f}" font-size="13" font-weight="600" '
        f'fill="{colour}">{metric.value:+.1f}°</text>',
    ]


def _legend(assessment: PostureAssessment, x: int, y: int, width: int) -> list[str]:
    """The margin: the score, what needs attention, and what could not be seen."""
    score = assessment.score()
    out = [f'<rect x="{x}" y="{y}" width="{width}" height="1" fill="none"/>']
    cursor = y + 18

    headline = ("—" if score.value is None else f"{score.value:.0f}")
    out.append(f'<text x="{x}" y="{cursor}" font-size="30" font-weight="700" '
               f'fill="{INK["text"]}">{headline}<tspan font-size="13" '
               f'font-weight="400" fill="{INK["refused"]}"> / 100 alignment</tspan></text>')
    cursor += 18
    out.append(f'<text x="{x}" y="{cursor}" font-size="11" fill="{INK["refused"]}">'
               f'{_e(assessment.view.describe())}</text>')
    cursor += 14
    if score.value is None:
        for line in _wrap(f"No score: {score.withheld_reason}", 46):
            out.append(f'<text x="{x}" y="{cursor}" font-size="11" '
                       f'fill="{INK["notable"]}">{_e(line)}</text>')
            cursor += 13
    else:
        out.append(f'<text x="{x}" y="{cursor}" font-size="11" fill="{INK["refused"]}">'
                   f'from {score.checks} checks, {score.coverage:.0%} of what this '
                   f'view can show</text>')
        cursor += 18

    for region, component in sorted(score.components.items()):
        if component.score is None:
            continue
        colour = INK["notable"] if component.score < 70 else INK["text"]
        out.append(f'<text x="{x}" y="{cursor}" font-size="12" fill="{INK["text"]}">'
                   f'{_e(region.replace("_", " "))}</text>')
        out.append(f'<text x="{x + width - 4}" y="{cursor}" font-size="12" '
                   f'text-anchor="end" font-weight="600" fill="{colour}">'
                   f'{component.score:.0f}</text>')
        cursor += 16

    attention = assessment.attention()
    if attention:
        cursor += 8
        out.append(f'<text x="{x}" y="{cursor}" font-size="11" font-weight="600" '
                   f'fill="{INK["notable"]}">measured deviation</text>')
        cursor += 15
        for metric in attention[:5]:
            out.append(f'<text x="{x}" y="{cursor}" font-size="11" fill="{INK["text"]}">'
                       f'{_e(metric.describe())}</text>')
            cursor += 14

    refused = [m for m in assessment.metrics.values() if not m.measured]
    if refused:
        cursor += 8
        out.append(f'<text x="{x}" y="{cursor}" font-size="11" font-weight="600" '
                   f'fill="{INK["refused"]}">not measurable here</text>')
        cursor += 15
        for metric in refused[:6]:
            for line in _wrap(f"{metric.name.replace('_', ' ')} — {metric.reason}", 52):
                out.append(f'<text x="{x}" y="{cursor}" font-size="10" '
                           f'fill="{INK["refused"]}">{_e(line)}</text>')
                cursor += 12
            cursor += 2
    return out


def _wrap(text: str, width: int) -> list[str]:
    words, lines, line = text.split(), [], ""
    for word in words:
        if len(line) + len(word) + 1 > width and line:
            lines.append(line)
            line = word
        else:
            line = f"{line} {word}".strip()
    if line:
        lines.append(line)
    return lines


def render(assessment: PostureAssessment, detection: Detection, *,
           width: int, height: int, threshold: float = 0.4,
           image_href: str = "") -> str:
    """One assessment as an SVG, sized to the frame the detection came from.

    ``image_href`` may be a data URI of the original frame, which is how a
    studio gets the overlay on the photograph. Left empty the drawing stands on
    its own, which is what a report keeps when the footage is not retained --
    and this pipeline does not retain it.
    """
    panel = 300
    total = width + panel
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{total}" height="{height}" '
        f'viewBox="0 0 {total} {height}" font-family="system-ui, -apple-system, sans-serif">',
        f'<rect width="{total}" height="{height}" fill="{INK["paper"]}"/>',
    ]
    if image_href:
        parts.append(f'<image href="{_e(image_href)}" x="0" y="0" '
                     f'width="{width}" height="{height}"/>')
    parts += _plumb(detection, height, threshold)
    parts += _skeleton(detection, threshold)

    view = assessment.view.view
    if view.is_frontal:
        parts += _level_line(detection, kp.L_EAR, kp.R_EAR,
                             assessment.metrics["head_lateral_tilt"], threshold)
        parts += _level_line(detection, kp.L_SHOULDER, kp.R_SHOULDER,
                             assessment.metrics["shoulder_tilt"], threshold)
        parts += _level_line(detection, kp.L_HIP, kp.R_HIP,
                             assessment.metrics["pelvic_obliquity"], threshold)

    parts.append(f'<line x1="{width}" y1="0" x2="{width}" y2="{height}" '
                 f'stroke="{INK["refused"]}" stroke-width="1" opacity="0.35"/>')
    parts += _legend(assessment, width + 18, 10, panel - 36)
    # Written twice on purpose. The visible copy is wrapped to the panel, which
    # splits it across elements; `<desc>` keeps the sentence whole and
    # machine-readable, so nothing downstream can end up with half a
    # disclaimer and no way to tell.
    parts.append(f'<desc>{_e(DISCLAIMER)}</desc>')
    footer = _wrap(DISCLAIMER, 44)
    for i, line in enumerate(footer):
        parts.append(f'<text x="{width + 18}" y="{height - 10 - 11 * (len(footer) - 1 - i)}" '
                     f'font-size="9" fill="{INK["refused"]}">{_e(line)}</text>')
    parts.append("</svg>")
    return "\n".join(parts)


def render_comparison(comparison, *, width: int = 420) -> str:
    """Before and after as one drawing: every metric, both readings, the change.

    A table rather than two skeletons side by side, because the question a
    second visit asks is "what moved", and two body outlines answer it worse
    than two numbers and a difference. Metrics that could not be compared are
    listed with the reason, so the eye cannot mistake a gap for a result.
    """
    changes = list(comparison.changes.values())
    comparable = [c for c in changes if c.comparable]
    refused = [c for c in changes if not c.comparable]
    rows = len(comparable) + len(refused)
    height = 96 + rows * 22 + 30
    delta = comparison.score_change

    out = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}" font-family="system-ui, -apple-system, sans-serif">',
        f'<rect width="{width}" height="{height}" fill="{INK["paper"]}"/>',
        f'<text x="16" y="26" font-size="15" font-weight="700" fill="{INK["text"]}">'
        f'Before and after</text>',
    ]
    if delta is None:
        out.append(f'<text x="16" y="46" font-size="11" fill="{INK["refused"]}">'
                   f'no score change: one of the two was withheld</text>')
    else:
        colour = INK["ok"] if delta > 0 else (INK["notable"] if delta < 0 else INK["text"])
        out.append(f'<text x="16" y="46" font-size="11" fill="{INK["refused"]}">'
                   f'alignment score <tspan fill="{colour}" font-weight="700">'
                   f'{delta:+.1f}</tspan> over the two assessments</text>')
    if not comparison.to_dict()["same_view"]:
        out.append(f'<text x="16" y="62" font-size="11" fill="{INK["notable"]}">'
                   f'assessed from different views — nothing is compared</text>')

    y = 88
    out.append(f'<text x="16" y="{y}" font-size="10" fill="{INK["refused"]}">metric</text>')
    for label, x in (("before", 220), ("after", 290), ("change", 370)):
        out.append(f'<text x="{x}" y="{y}" font-size="10" text-anchor="end" '
                   f'fill="{INK["refused"]}">{label}</text>')
    y += 8
    out.append(f'<line x1="16" y1="{y}" x2="{width - 16}" y2="{y}" '
               f'stroke="{INK["refused"]}" stroke-width="0.8" opacity="0.4"/>')
    y += 16

    for change in comparable:
        toward = change.toward_neutral
        colour = INK["ok"] if toward else INK["notable"]
        out.append(f'<text x="16" y="{y}" font-size="11" fill="{INK["text"]}">'
                   f'{_e(change.name.replace("_", " "))}</text>')
        out.append(f'<text x="220" y="{y}" font-size="11" text-anchor="end" '
                   f'fill="{INK["text"]}">{change.before:+.2f}</text>')
        out.append(f'<text x="290" y="{y}" font-size="11" text-anchor="end" '
                   f'fill="{INK["text"]}">{change.after:+.2f}</text>')
        out.append(f'<text x="370" y="{y}" font-size="11" text-anchor="end" '
                   f'font-weight="600" fill="{colour}">{change.absolute:+.2f}</text>')
        y += 22
    for change in refused:
        out.append(f'<text x="16" y="{y}" font-size="11" fill="{INK["refused"]}">'
                   f'{_e(change.name.replace("_", " "))}</text>')
        out.append(f'<text x="{width - 16}" y="{y}" font-size="10" text-anchor="end" '
                   f'fill="{INK["refused"]}">{_e(change.reason)}</text>')
        y += 22

    out.append(f'<text x="16" y="{height - 10}" font-size="9" fill="{INK["refused"]}">'
               f'A smaller deviation is a smaller deviation. Whether it is an '
               f'improvement is a judgement for the person teaching.</text>')
    out.append("</svg>")
    return "\n".join(out)
