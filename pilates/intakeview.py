"""Drawing the pre-session report: four annotated photographs and the findings.

The measurement is the same measurement whether it is printed or drawn. What
this module adds is the part a studio actually hands to a student, and the
quality bar for it is a page somebody will put on a wall -- not a stick figure
with the joints joined up.

**What an annotation has to do.** A line drawn over a photograph of somebody's
own body is the most persuasive artefact this system produces, so every mark on
it earns its place:

* the **vertical reference** is dropped from between the ankles and labelled as
  a reference, never as a target -- nobody stands on it and a line implying
  they should invents a fault;
* a **level line** is drawn beside every measured line that ought to be level,
  because "six degrees" means nothing until the eye can see six degrees against
  something;
* **callouts** name what was found, on the landmark it was found at, in the
  margin where they do not cover the body. They carry the number and the
  direction, and they are coloured by how far outside its range the
  measurement is, on the same scale :mod:`pilates.guidance` grades findings;
* a **landmark the model was unsure of is drawn hollow**, and one that could
  not be found is not drawn at all rather than drawn at the frame corner;
* the **caption** names the photograph, because a report whose four pictures
  are not labelled is a report where left and right get swapped by the reader.

**Callouts are laid out, not placed.** Anchors cluster -- ears, shoulders and
the head sit within a few dozen pixels of each other -- so chips are assigned
to the nearer margin and then pushed apart vertically until none overlaps,
keeping the leader lines short and the order the same as the body. Without that
pass the head callouts write on top of each other, which is what makes most
generated posture reports look generated.

**SVG, self-contained**, for the reasons :mod:`pilates.alignview` gives: no
plotting library in a four-package runtime, prints at any size, opens in a
browser with nothing installed, and embeds in the HTML report that already
exists.
"""
from __future__ import annotations

import html

from . import guidance as gd
from . import intake as ik
from . import keypoints as kp
from .alignment import Availability, View
from .alignview import INK, _skeleton
from .intake import PhotoAssessment, Photo
from .types import Detection

#: Severity to ink. Four steps rather than good/bad, because the middle two are
#: where a studio does its work and collapsing them loses the distinction
#: between "watch this" and "this is the session".
SEVERITY_INK: dict[str, str] = {
    gd.WITHIN: "#2f9e63",
    gd.WATCH: "#c9a227",
    gd.NOTABLE: "#d1791f",
    gd.MARKED: "#c0392b",
}

#: Where each measurement is anchored on the body, as the joints to average.
#: A measurement drawn at the wrong landmark is worse than one not drawn: the
#: reader believes the picture over the text.
ANCHORS: dict[str, tuple[int, ...]] = {
    "head_lateral_tilt": (kp.L_EAR, kp.R_EAR),
    "forward_head": (kp.L_EAR, kp.R_EAR),
    "shoulder_tilt": (kp.L_SHOULDER, kp.R_SHOULDER),
    "pelvic_obliquity": (kp.L_HIP, kp.R_HIP),
    "trunk_lean_lateral": kp.TRUNK,
    "trunk_lean_sagittal": kp.TRUNK,
    "left_knee_deviation": (kp.L_KNEE,),
    "right_knee_deviation": (kp.R_KNEE,),
    "lateral_weight_bias": (kp.L_ANKLE, kp.R_ANKLE),
}

#: Short names for the callout chips. The metric names are written for a
#: developer reading a payload; these are written for a student reading a wall.
CHIP: dict[str, tuple[str, str]] = {
    "head_lateral_tilt": ("head tilt", "머리 기울기"),
    "forward_head": ("head forward", "머리 전방"),
    "shoulder_tilt": ("shoulder level", "어깨 수평"),
    "pelvic_obliquity": ("hip level", "골반 수평"),
    "trunk_lean_lateral": ("trunk lean", "몸통 기울기"),
    "trunk_lean_sagittal": ("trunk lean", "몸통 기울기"),
    "left_knee_deviation": ("left knee", "왼쪽 무릎"),
    "right_knee_deviation": ("right knee", "오른쪽 무릎"),
    "lateral_weight_bias": ("weight carried", "체중 쏠림"),
}

#: Every fixed phrase this module draws, in both languages.
#:
#: One table rather than conditionals at each call site, because the failure
#: mode of the scattered version is a page that is Korean everywhere except the
#: four headings somebody forgot -- and a reader who has to switch languages
#: mid-page stops trusting both halves. ``say`` is the only way a string
#: reaches the drawing.
TEXT: dict[str, tuple[str, str]] = {
    "title": ("Standing assessment", "체형 분석 결과"),
    "measured": ("What the photographs measured", "사진에서 측정한 내용"),
    "pattern": ("What the measurements add up to", "측정값이 말하는 것"),
    "regions": ("By part of the body", "부위별 결과"),
    "priorities": ("What to work on first", "개선 우선순위"),
    "evenness": ("Left against right", "좌우 균형"),
    "comeBack": ("Photograph again", "다음 촬영"),
    "checksN": ("{n} checks", "{n}개 항목"),
    "all_clear": ("every measurement sits inside its unremarkable range",
                  "측정한 모든 항목이 정상 범위 안에 있습니다"),
    "usually": ("usually seen with: ", "함께 나타나는 경우가 많음: "),
    "plan": ("Where a first session could start", "첫 세션 시작 지점"),
    "habits": ("Between sessions", "세션 사이에 할 일"),
    "cannot": ("What these photographs cannot measure", "이 사진으로 측정할 수 없는 것"),
    "not_supplied": ("Photographs not supplied", "촬영되지 않은 사진"),
    "check": ("Worth checking", "확인이 필요한 사항"),
    "usual": ("Inside its usual range", "정상 범위 안"),
    "out_of": ("out of 100", "100점 만점"),
    "missing": ("not supplied", "사진 없음"),
    "not_kept": ("photograph not kept", "사진은 보관하지 않습니다"),
    "confidence": ("landmarks found at {joint} mean confidence; "
                   "orientation {view}",
                   "관절 인식 평균 신뢰도 {joint} · 방향 판정 {view}"),
}


def say(key: str, lang: str = "en", **fields: object) -> str:
    """One fixed phrase, in one language, with its blanks filled."""
    english, korean = TEXT[key]
    return (korean if lang == "ko" and korean else english).format(**fields)


#: Height of a callout chip, and the gap the layout keeps between two of them.
CHIP_H = 26.0
CHIP_GAP = 6.0


#: Roughly how wide one character is, as a share of the font size.
#:
#: Latin in a system sans at these sizes runs about half the font size per
#: character averaged over ordinary prose; a Hangul syllable or a CJK ideograph
#: is square, so it is a whole one. Counting characters and dividing by a fixed
#: number -- which is what a naive wrap does -- therefore overruns a Korean
#: column by about two to one, and the Korean report was running its findings
#: column straight through the one beside it before this existed.
#:
#: These are estimates, not metrics: SVG has no way to measure text without a
#: layout engine, and shipping one to wrap a paragraph would be absurd. They
#: are deliberately a little generous so a line ends early rather than late.
_LATIN_EM = 0.52
_WIDE_EM = 1.0


def _wide(char: str) -> bool:
    """Whether a character occupies a full em: Hangul, kana, CJK, and their
    punctuation. The ranges are the ones this application's two languages
    actually produce, not the whole of Unicode's east-asian-width table."""
    code = ord(char)
    return (0x1100 <= code <= 0x115F or 0x2E80 <= code <= 0xA4CF
            or 0xAC00 <= code <= 0xD7A3 or 0xF900 <= code <= 0xFAFF
            or 0xFE30 <= code <= 0xFE6F or 0xFF00 <= code <= 0xFF60
            or 0xFFE0 <= code <= 0xFFE6)


def _em(text: str) -> float:
    """The width of a string in ems, by the estimate above."""
    return sum(_WIDE_EM if _wide(c) else _LATIN_EM for c in text)


def _fit(text: str, width: float, font: float) -> list[str]:
    """Wrap to a pixel width at a font size, rather than to a character count.

    Breaks on spaces where there are any, and between characters where there
    are not -- Korean prose has far fewer spaces than English and a word-only
    wrap leaves a single unbreakable run wider than the column.
    """
    budget = max(1.0, width / font)
    lines: list[str] = []
    line = ""
    for word in text.split():
        candidate = f"{line} {word}".strip()
        if line and _em(candidate) > budget:
            lines.append(line)
            line = word
        else:
            line = candidate
        while _em(line) > budget:            # one word longer than the column
            cut = len(line)
            while cut > 1 and _em(line[:cut]) > budget:
                cut -= 1
            lines.append(line[:cut])
            line = line[cut:]
    if line:
        lines.append(line)
    return lines


def _e(text: object) -> str:
    return html.escape(str(text), quote=True)


def _chip_label(name: str, lang: str) -> str:
    english, korean = CHIP.get(name, (name.replace("_", " "), ""))
    return korean if lang == "ko" and korean else english


def _real(det: Detection, joint: int, threshold: float) -> bool:
    """Confident, and somewhere. ``(0, 0)`` is a slot the backend never filled."""
    x, y = det.keypoints[joint]
    return bool(det.scores[joint] >= threshold) and not (x == 0.0 and y == 0.0)


def _anchor(det: Detection, joints: tuple[int, ...],
            threshold: float) -> tuple[float, float] | None:
    """The mean of the joints that were actually found, or None."""
    found = [det.keypoints[j] for j in joints if _real(det, j, threshold)]
    if not found:
        return None
    return (float(sum(p[0] for p in found) / len(found)),
            float(sum(p[1] for p in found) / len(found)))


def _reading_text(reading: ik.Reading) -> str:
    """The number as a chip carries it. Formatted once, in :mod:`pilates.guidance`."""
    return gd.format_value(reading.name, reading.value, reading.metric.unit)


def _body_centre(det: Detection, threshold: float) -> float:
    """The middle of the body in the picture, not the middle of the picture.

    Which margin a callout goes to is decided against this. A student standing
    off to one side of the frame -- which is most photographs a studio takes --
    would otherwise have every callout assigned to the same margin, and the
    column that had to hold all of them would be a stack of chips with leader
    lines raking across the body.
    """
    xs = [float(det.keypoints[j][0]) for j in range(kp.NUM_KEYPOINTS)
          if _real(det, j, threshold)]
    return sum(xs) / len(xs) if xs else 0.0


def _spread(items: list[dict], top: float, bottom: float) -> None:
    """Push overlapping chips apart, in place, keeping body order.

    A single downward pass settles a cluster, then one upward pass pulls the
    stack back inside the frame if the first pass pushed it past the bottom.
    Two passes are enough for the handful of chips a column ever holds, and an
    iterative solver here would be machinery for a problem that does not exist.
    """
    items.sort(key=lambda c: c["y"])
    for index, chip in enumerate(items):
        if index == 0:
            chip["y"] = max(chip["y"], top)
            continue
        floor = items[index - 1]["y"] + CHIP_H + CHIP_GAP
        chip["y"] = max(chip["y"], floor)
    overflow = items[-1]["y"] + CHIP_H - bottom if items else 0.0
    if overflow > 0:
        for chip in reversed(items):
            chip["y"] -= overflow
        for index in range(len(items) - 2, -1, -1):
            ceiling = items[index + 1]["y"] - CHIP_H - CHIP_GAP
            items[index]["y"] = min(items[index]["y"], ceiling)
        for chip in items:
            chip["y"] = max(chip["y"], top)


def _balance(chips: list[dict]) -> dict[str, list[dict]]:
    """Split callouts between the two margins so neither is a wall of chips.

    First choice is the nearer margin, which keeps leader lines short and stops
    them crossing the body. Then the fuller column gives up whichever of its
    chips is least committed to it -- smallest distance from the body's middle
    -- until the two are within one of each other. Balancing by count rather
    than by height is enough because every chip is the same height.
    """
    columns: dict[str, list[dict]] = {"left": [], "right": []}
    for chip in chips:
        columns["left" if chip["bias"] < 0 else "right"].append(chip)
    while len(columns["left"]) - len(columns["right"]) > 1:
        moved = max(columns["left"], key=lambda c: c["bias"])
        columns["left"].remove(moved)
        columns["right"].append(moved)
    while len(columns["right"]) - len(columns["left"]) > 1:
        moved = min(columns["right"], key=lambda c: c["bias"])
        columns["right"].remove(moved)
        columns["left"].append(moved)
    return columns


def _callouts(assessment: PhotoAssessment, photo: Photo, scale: float,
              box: tuple[float, float, float, float], margin: float,
              threshold: float, lang: str = "en") -> list[str]:
    """The named findings, anchored on the body, chipped in the margin.

    Only what *this* photograph could measure is drawn on it. A front
    photograph carrying a forward-head callout would be claiming a measurement
    it did not make, and a reader has no way to know the number came from
    another picture.
    """
    left_x, top_y, width, height = box
    mid_x = left_x + _body_centre(photo.detection, threshold) * scale
    found: list[dict] = []

    for name in ik.MEASURED_BY:
        if photo.view not in ik.MEASURED_BY.get(name, ()):
            continue
        reading = assessment.readings.get(name)
        if reading is None or not reading.measured or name not in ANCHORS:
            continue
        spot = _anchor(photo.detection, ANCHORS[name], threshold)
        if spot is None:
            continue
        x = left_x + spot[0] * scale
        y = top_y + spot[1] * scale
        way = gd.direction(reading)
        found.append({
            "name": name, "x": x, "y": y - CHIP_H / 2.0,
            "text": _chip_label(name, lang),
            "value": _reading_text(reading),
            "side_note": gd.SHORT.get(way, ("", ""))[0 if lang != "ko" else 1]
            if gd.severity(reading) is not gd.WITHIN else "",
            "ink": SEVERITY_INK[gd.severity(reading)],
            "estimated": reading.metric.availability is Availability.ESTIMATED,
            "contested": reading.contested,
            "bias": x - mid_x,
        })
    columns = _balance(found)

    out: list[str] = []
    for side, chips in columns.items():
        if not chips:
            continue
        _spread(chips, top_y + 2.0, top_y + height - CHIP_H - 2.0)
        chip_w = margin - 14.0
        chip_x = (left_x - margin + 6.0) if side == "left" else (left_x + width + 8.0)
        elbow = chip_x + chip_w + 6.0 if side == "left" else chip_x - 6.0
        for chip in chips:
            cy = chip["y"] + CHIP_H / 2.0
            dash = ' stroke-dasharray="3 3"' if chip["estimated"] else ""
            out.append(
                f'<path d="M {chip["x"]:.1f} {chip["y"] + CHIP_H / 2:.1f} '
                f'L {elbow:.1f} {cy:.1f}" fill="none" stroke="{chip["ink"]}" '
                f'stroke-width="1" opacity="0.75"{dash}/>')
            out.append(f'<circle cx="{chip["x"]:.1f}" '
                       f'cy="{chip["y"] + CHIP_H / 2:.1f}" r="4.5" '
                       f'fill="{chip["ink"]}" stroke="#fff" stroke-width="1.5"/>')
            out.append(
                f'<rect x="{chip_x:.1f}" y="{chip["y"]:.1f}" width="{chip_w:.1f}" '
                f'height="{CHIP_H}" rx="5" fill="#ffffff" stroke="{chip["ink"]}" '
                f'stroke-width="1.1" opacity="0.97"/>')
            out.append(
                f'<text x="{chip_x + 8:.1f}" y="{chip["y"] + 11:.1f}" font-size="9.5" '
                f'fill="{INK["text"]}">{_e(chip["text"])}</text>')
            # Which way it points goes on the second line beside the number,
            # not beside the name: the names are long enough to collide with
            # it, and a label that overlaps the thing it qualifies is worse
            # than no label.
            # Dropped rather than overlapped when the margin is narrow. The
            # finding list carries the direction in full; a chip that runs its
            # own two labels together carries nothing.
            if chip["side_note"] and chip_w >= 86.0:
                out.append(
                    f'<text x="{chip_x + chip_w - 8:.1f}" y="{chip["y"] + 21:.1f}" '
                    f'font-size="8" text-anchor="end" fill="{chip["ink"]}">'
                    f'{_e(chip["side_note"])}</text>')
            # A reading the two photographs disagreed about is marked on the
            # chip itself. It is the one place a reader is looking, and a
            # caveat that lives only in the payload is a caveat nobody reads.
            disputed = ('<tspan font-size="8" font-weight="400" '
                        'fill="#8e9aa5"> disputed</tspan>'
                        if chip["contested"] else "")
            out.append(
                f'<text x="{chip_x + 8:.1f}" y="{chip["y"] + 21:.1f}" font-size="10.5" '
                f'font-weight="700" fill="{chip["ink"]}">{_e(chip["value"])}'
                f'{disputed}</text>')
    return out


def _level_marks(photo: Photo, assessment: PhotoAssessment, scale: float,
                 box: tuple[float, float, float, float],
                 threshold: float) -> list[str]:
    """Measured line against level line, wherever the view can show one.

    Frontal photographs only. From the side these lines are edge-on and drawing
    them would be drawing a measurement the photograph did not make.
    """
    if not photo.view.is_frontal:
        return []
    left_x, top_y, _, _ = box
    det = photo.detection
    out: list[str] = []
    pairs = (("head_lateral_tilt", kp.L_EAR, kp.R_EAR),
             ("shoulder_tilt", kp.L_SHOULDER, kp.R_SHOULDER),
             ("pelvic_obliquity", kp.L_HIP, kp.R_HIP))
    for name, left, right in pairs:
        reading = assessment.readings.get(name)
        if reading is None or not reading.measured:
            continue
        if not (_real(det, left, threshold) and _real(det, right, threshold)):
            continue
        x0 = left_x + float(det.keypoints[left][0]) * scale
        y0 = top_y + float(det.keypoints[left][1]) * scale
        x1 = left_x + float(det.keypoints[right][0]) * scale
        y1 = top_y + float(det.keypoints[right][1]) * scale
        mid_y = (y0 + y1) / 2.0
        ink = SEVERITY_INK[gd.severity(reading)]
        # Two strokes for the level reference: a dark one under a white dashed
        # one. A single colour disappears into either a light wall or a dark
        # leotard, and which of those a photograph holds is not knowable here.
        out.append(f'<line x1="{x0:.1f}" y1="{mid_y:.1f}" x2="{x1:.1f}" '
                   f'y2="{mid_y:.1f}" stroke="{INK["text"]}" stroke-width="1.8" '
                   f'opacity="0.35"/>')
        out.append(f'<line x1="{x0:.1f}" y1="{mid_y:.1f}" x2="{x1:.1f}" '
                   f'y2="{mid_y:.1f}" stroke="#ffffff" stroke-width="1" '
                   f'stroke-dasharray="3 3" opacity="0.9"/>')
        out.append(f'<line x1="{x0:.1f}" y1="{y0:.1f}" x2="{x1:.1f}" y2="{y1:.1f}" '
                   f'stroke="{ink}" stroke-width="2.2" stroke-linecap="round"/>')
    return out


def _plumb_line(photo: Photo, scale: float,
                box: tuple[float, float, float, float],
                threshold: float) -> list[str]:
    """The vertical reference, dropped from between the feet."""
    left_x, top_y, width, height = box
    det = photo.detection
    feet = [j for j in (kp.L_ANKLE, kp.R_ANKLE) if _real(det, j, threshold)]
    if not feet:
        return []
    x = left_x + scale * float(sum(det.keypoints[j][0] for j in feet) / len(feet))
    return [
        f'<line x1="{x:.1f}" y1="{top_y:.1f}" x2="{x:.1f}" '
        f'y2="{top_y + height:.1f}" stroke="#ffffff" stroke-width="1.4" '
        f'stroke-dasharray="7 5" opacity="0.75"/>',
        f'<line x1="{x:.1f}" y1="{top_y:.1f}" x2="{x:.1f}" '
        f'y2="{top_y + height:.1f}" stroke="{INK["plumb"]}" stroke-width="0.7" '
        f'stroke-dasharray="7 5" opacity="0.9"/>',
    ]


def render_photo(assessment: PhotoAssessment, view: View, *,
                 width: float = 300.0, margin: float = 96.0,
                 image_href: str = "", threshold: float = 0.4,
                 lang: str = "en") -> str:
    """One photograph of the set, annotated, as a standalone SVG.

    ``image_href`` is a data URI of the photograph. Left empty, the skeleton is
    drawn on a plain ground -- which is what a stored report keeps, because the
    photographs are not retained any more than the video is.
    """
    photo = assessment.photos.get(view)
    if photo is None or not photo.usable:
        return _missing_photo(view, width, margin, lang)

    source_w = float(photo.width or 1080)
    source_h = float(photo.height or 1440)
    scale = width / source_w
    height = source_h * scale
    box = (margin, 22.0, width, height)
    total_w = width + 2 * margin
    total_h = height + 22.0 + 30.0

    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{total_w:.0f}" '
        f'height="{total_h:.0f}" viewBox="0 0 {total_w:.0f} {total_h:.0f}" '
        f'font-family="system-ui, -apple-system, sans-serif">',
        f'<rect width="{total_w:.0f}" height="{total_h:.0f}" fill="{INK["paper"]}"/>',
    ]
    if image_href:
        parts.append(f'<image href="{_e(image_href)}" x="{margin:.1f}" y="22" '
                     f'width="{width:.1f}" height="{height:.1f}" '
                     f'preserveAspectRatio="xMidYMid slice"/>')
    else:
        parts.append(f'<rect x="{margin:.1f}" y="22" width="{width:.1f}" '
                     f'height="{height:.1f}" fill="#f2f4f7"/>')
        parts.append(f'<text x="{margin + width / 2:.1f}" y="{22 + height / 2:.1f}" '
                     f'font-size="10" text-anchor="middle" fill="{INK["refused"]}">'
                     f'{_e(say("not_kept", lang))}</text>')

    parts.append(f'<g transform="translate({margin:.1f},22) scale({scale:.5f})">')
    parts += _skeleton(photo.detection, threshold, scale)
    parts.append("</g>")
    parts += _plumb_line(photo, scale, box, threshold)
    parts += _level_marks(photo, assessment, scale, box, threshold)
    parts += _callouts(assessment, photo, scale, box, margin, threshold, lang)

    title = ik.instructions(view, lang)[0]
    parts.append(f'<rect x="{margin:.1f}" y="{22 + height:.1f}" width="{width:.1f}" '
                 f'height="22" fill="#22303d"/>')
    parts.append(f'<text x="{margin + width / 2:.1f}" y="{22 + height + 15:.1f}" '
                 f'font-size="11" font-weight="600" text-anchor="middle" '
                 f'fill="#ffffff">{_e(title)}</text>')
    confidence = assessment.per_view[view].view.confidence
    found = f"{photo.detection.confidence:.0%}"
    parts.append(f'<text x="{margin:.1f}" y="16" font-size="9" '
                 f'fill="{INK["refused"]}">'
                 f'{_e(say("confidence", lang, joint=found, view=f"{confidence:.0%}"))}'
                 f'</text>')
    parts.append("</svg>")
    return "\n".join(parts)


def _missing_photo(view: View, width: float, margin: float, lang: str) -> str:
    """A photograph that was not supplied, drawn as a gap rather than omitted.

    A report with three pictures where four were asked for looks like a report
    that only needs three. This is the slot, with the instruction for taking
    it, so the gap is legible as a gap.
    """
    title, how = ik.instructions(view, lang)
    total_w = width + 2 * margin
    height = 200.0
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{total_w:.0f}" '
        f'height="{height + 52:.0f}" viewBox="0 0 {total_w:.0f} {height + 52:.0f}" '
        f'font-family="system-ui, -apple-system, sans-serif">',
        f'<rect width="{total_w:.0f}" height="{height + 52:.0f}" fill="{INK["paper"]}"/>',
        f'<rect x="{margin:.1f}" y="22" width="{width:.1f}" height="{height:.1f}" '
        f'fill="none" stroke="{INK["refused"]}" stroke-width="1.2" '
        f'stroke-dasharray="6 5" rx="4"/>',
        f'<text x="{margin + width / 2:.1f}" y="{22 + height / 2 - 6:.1f}" '
        f'font-size="12" font-weight="600" text-anchor="middle" '
        f'fill="{INK["refused"]}">{_e(say("missing", lang))}</text>',
    ]
    y = 22 + height / 2 + 12
    for line in _fit(how, width, 9.0):
        parts.append(f'<text x="{margin + width / 2:.1f}" y="{y:.1f}" font-size="9" '
                     f'text-anchor="middle" fill="{INK["refused"]}">{_e(line)}</text>')
        y += 11
    parts.append(f'<rect x="{margin:.1f}" y="{22 + height:.1f}" width="{width:.1f}" '
                 f'height="22" fill="#95a3b0"/>')
    parts.append(f'<text x="{margin + width / 2:.1f}" y="{22 + height + 15:.1f}" '
                 f'font-size="11" font-weight="600" text-anchor="middle" '
                 f'fill="#ffffff">{_e(title)}</text>')
    parts.append("</svg>")
    return "\n".join(parts)


def _dial(value: float | None, cx: float, cy: float, radius: float,
          band: str, lang: str = "en") -> list[str]:
    """The headline score as an arc, because a number alone has no scale.

    Drawn as a 240-degree sweep with the track behind it, so the reader sees
    how much of the range the score occupies rather than only what it is.
    """
    import math

    start, sweep = 150.0, 240.0

    def point(angle: float) -> tuple[float, float]:
        radians = math.radians(angle)
        return cx + radius * math.cos(radians), cy + radius * math.sin(radians)

    x0, y0 = point(start)
    x1, y1 = point(start + sweep)
    out = [f'<path d="M {x0:.1f} {y0:.1f} A {radius} {radius} 0 1 1 {x1:.1f} '
           f'{y1:.1f}" fill="none" stroke="#e6eaee" stroke-width="11" '
           f'stroke-linecap="round"/>']
    if value is not None:
        filled = sweep * max(0.0, min(100.0, value)) / 100.0
        fx, fy = point(start + filled)
        ink = _BAND_INK.get(band, INK["text"])
        out.append(f'<path d="M {x0:.1f} {y0:.1f} A {radius} {radius} 0 '
                   f'{1 if filled > 180 else 0} 1 {fx:.1f} {fy:.1f}" fill="none" '
                   f'stroke="{ink}" stroke-width="11" stroke-linecap="round"/>')
        out.append(f'<text x="{cx:.1f}" y="{cy + 6:.1f}" font-size="34" '
                   f'font-weight="700" text-anchor="middle" fill="{INK["text"]}">'
                   f'{value:.0f}</text>')
        out.append(f'<text x="{cx:.1f}" y="{cy + 24:.1f}" font-size="10" '
                   f'text-anchor="middle" fill="{INK["refused"]}">'
                   f'{_e(say("out_of", lang))}</text>')
    else:
        out.append(f'<text x="{cx:.1f}" y="{cy + 6:.1f}" font-size="26" '
                   f'font-weight="700" text-anchor="middle" '
                   f'fill="{INK["refused"]}">—</text>')
    return out


_BAND_INK = {
    "Excellent": "#2f9e63", "Good": "#5aa96b", "Fair": "#c9a227",
    "Needs attention": "#d1791f", "Needs work": "#c0392b",
}


def render_report(assessment: PhotoAssessment, *,
                  images: dict[View, str] | None = None,
                  photo_width: float = 210.0, lang: str = "en") -> str:
    """The whole pre-session assessment as one printable page.

    Four annotated photographs across the top; underneath, in four columns, the
    score and the band it falls in, what was found, what the first session
    might work on, and what these photographs could not measure. The last of
    those is given a column of its own rather than a footnote, because the
    difference between a report and a claim is whether the gaps are visible.
    """
    images = images or {}
    report = gd.report(assessment)
    photo_margin = 112.0
    cell_w = photo_width + 2 * photo_margin
    photos = [render_photo(assessment, view, width=photo_width,
                           margin=photo_margin, image_href=images.get(view, ""),
                           lang=lang)
              for view in ik.PROTOCOL]
    photo_h = max(_svg_height(svg) for svg in photos)
    width = cell_w * 4
    body_top = photo_h + 92.0

    columns = _columns(report, assessment, width, body_top, lang)
    height = body_top + max(c["height"] for c in columns) + 66.0

    out = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width:.0f}" '
        f'height="{height:.0f}" viewBox="0 0 {width:.0f} {height:.0f}" '
        f'font-family="system-ui, -apple-system, sans-serif">',
        f'<rect width="{width:.0f}" height="{height:.0f}" fill="{INK["paper"]}"/>',
        f'<text x="28" y="36" font-size="18" font-weight="700" '
        f'fill="{INK["text"]}">{_e(say("title", lang))}</text>',
    ]
    subtitle = " · ".join(x for x in (assessment.person_id, assessment.taken_on) if x)
    if subtitle:
        out.append(f'<text x="28" y="55" font-size="11.5" fill="{INK["refused"]}">'
                   f'{_e(subtitle)}</text>')
    out.append(f'<line x1="28" y1="68" x2="{width - 28:.0f}" y2="68" '
               f'stroke="{INK["refused"]}" stroke-width="0.8" opacity="0.3"/>')

    for index, svg in enumerate(photos):
        out.append(f'<g transform="translate({index * cell_w:.1f},78)">')
        out.append(_inner(svg))
        out.append("</g>")
    out.append(f'<line x1="28" y1="{body_top - 22:.1f}" x2="{width - 28:.0f}" '
               f'y2="{body_top - 22:.1f}" stroke="{INK["refused"]}" '
               f'stroke-width="0.8" opacity="0.3"/>')
    for column in columns:
        out += column["parts"]

    # Whole in `<desc>` as well as wrapped on the page, so nothing downstream
    # can end up holding half a disclaimer with no way to tell.
    disclaimer = gd.DISCLAIMER_KO if lang == "ko" else gd.DISCLAIMER
    out.append(f'<desc>{_e(disclaimer)}</desc>')
    y = height - 38.0
    for line in _fit(disclaimer, width - 56, 9.5):
        out.append(f'<text x="28" y="{y:.1f}" font-size="9.5" '
                   f'fill="{INK["refused"]}">{_e(line)}</text>')
        y += 12
    out.append("</svg>")
    return "\n".join(out)


def _heading(text: str, x: float, y: float, ink: str = "") -> str:
    return (f'<text x="{x:.0f}" y="{y:.1f}" font-size="12" font-weight="700" '
            f'fill="{ink or INK["text"]}">{_e(text)}</text>')


def _columns(report: dict, assessment: PhotoAssessment, width: float,
             top: float, lang: str) -> list[dict]:
    """The four panels under the photographs, each measured as it is built.

    Each returns its own height so the page can be sized to the tallest rather
    than to a guess, which is what stops a long findings list running off the
    bottom of a printed sheet.
    """
    gap = 26.0
    left = 28.0
    score_w = 190.0
    rest = width - left * 2 - score_w - gap * 3
    finding_w = rest * 0.42
    plan_w = rest * 0.31
    limit_w = rest - finding_w - plan_w
    xs = [left,
          left + score_w + gap,
          left + score_w + gap + finding_w + gap,
          left + score_w + gap + finding_w + gap + plan_w + gap]
    return [
        _score_column(report, xs[0], top, score_w, lang),
        _findings_column(report, xs[1], top, finding_w, lang),
        _plan_column(report, xs[2], top, plan_w, lang),
        _limits_column(report, assessment, xs[3], top, limit_w, lang),
    ]


def _score_column(report: dict, x: float, top: float, w: float,
                  lang: str = "en") -> dict:
    score = report["score"]
    cx = x + w / 2
    parts = _dial(score["value"], cx, top + 66.0, 60.0, score["band"], lang)
    parts.append(f'<text x="{cx:.1f}" y="{top + 152:.1f}" font-size="14" '
                 f'font-weight="700" text-anchor="middle" '
                 f'fill="{_BAND_INK.get(score["band"], INK["text"])}">'
                 f'{_e(score["band_ko"] if score["band_ko"] else score["band"])}'
                 f'<tspan font-size="11" font-weight="400" '
                 f'fill="{INK["refused"]}"> {_e(score["band"])}</tspan></text>')
    y = top + 172.0
    note = score["note_ko"] if lang == "ko" else score["note"]
    for line in _fit(note, w, 9.0):
        parts.append(f'<text x="{cx:.1f}" y="{y:.1f}" font-size="9" '
                     f'text-anchor="middle" fill="{INK["refused"]}">'
                     f'{_e(line)}</text>')
        y += 11
    y += 8
    balance = report.get("balance") or {}
    if balance.get("evenness") is not None:
        parts.append(_heading(say("evenness", lang), x, y))
        y += 18
        ink = (_BAND_INK["Excellent"] if balance["evenness"] >= 90
               else (_BAND_INK["Fair"] if balance["evenness"] >= 75
                     else _BAND_INK["Needs attention"]))
        parts.append(f'<text x="{x:.0f}" y="{y:.1f}" font-size="19" '
                     f'font-weight="700" fill="{ink}">'
                     f'{balance["evenness"]:.0f}</text>')
        parts.append(f'<text x="{x + 34:.0f}" y="{y:.1f}" font-size="9" '
                     f'fill="{INK["refused"]}">'
                     f'{balance["from_checks"]} sided checks</text>')
        y += 18
    for region in report.get("regions") or ():
        score_value = region["score"]
        ink = (INK["refused"] if score_value is None
               else (_BAND_INK["Excellent"] if score_value >= 85
                     else (_BAND_INK["Fair"] if score_value >= 65
                           else _BAND_INK["Needs attention"])))
        label = region["name_ko"] if lang == "ko" else region["name"]
        parts.append(f'<text x="{x:.0f}" y="{y:.1f}" font-size="10" '
                     f'fill="{INK["text"]}">{_e(label)}</text>')
        parts.append(f'<text x="{x + w:.0f}" y="{y:.1f}" font-size="10" '
                     f'text-anchor="end" font-weight="700" fill="{ink}">'
                     f'{"—" if score_value is None else round(score_value)}</text>')
        y += 5
        parts.append(f'<rect x="{x:.0f}" y="{y:.1f}" width="{w:.0f}" height="3" '
                     f'rx="1.5" fill="#e6eaee"/>')
        parts.append(f'<rect x="{x:.0f}" y="{y:.1f}" '
                     f'width="{max(2.0, w * (score_value or 0) / 100):.1f}" '
                     f'height="3" rx="1.5" fill="{ink}"/>')
        y += 13
    y += 8
    for floor, english, korean in gd.SCORE_BANDS:
        current = english == score["band"]
        ink = _BAND_INK.get(english, INK["refused"])
        parts.append(f'<rect x="{x:.1f}" y="{y - 8:.1f}" width="8" height="8" '
                     f'rx="2" fill="{ink}" opacity="{1 if current else 0.45}"/>')
        parts.append(f'<text x="{x + 14:.1f}" y="{y:.1f}" font-size="9" '
                     f'font-weight="{600 if current else 400}" '
                     f'fill="{INK["text"] if current else INK["refused"]}">'
                     f'{_e(korean)} · {_e(english)}</text>')
        parts.append(f'<text x="{x + w:.1f}" y="{y:.1f}" font-size="9" '
                     f'text-anchor="end" fill="{INK["refused"]}">'
                     f'{floor:.0f}+</text>')
        y += 14
    return {"parts": parts, "height": y - top}


def _findings_column(report: dict, x: float, top: float, w: float,
                     lang: str) -> dict:
    findings = report["findings"]
    parts: list[str] = []
    y = top
    shape = report.get("pattern") or {}
    if shape.get("shape"):
        # Above the findings, because it is what they add up to and a reader
        # who takes only the first line should take this one.
        parts.append(_heading(say("pattern", lang), x, y, INK["joint"]))
        y += 20
        for line in _fit(shape["shape_ko"] if lang == "ko" else shape["shape"],
                         w, 12.0):
            parts.append(f'<text x="{x:.0f}" y="{y:.1f}" font-size="12" '
                         f'font-weight="600" fill="{INK["text"]}">'
                         f'{_e(line)}</text>')
            y += 15
        note = shape["start_at_ko"] if lang == "ko" else shape["start_at"]
        for line in _fit(note, w, 9.5):
            parts.append(f'<text x="{x:.0f}" y="{y:.1f}" font-size="9.5" '
                         f'fill="{INK["refused"]}">{_e(line)}</text>')
            y += 11
        y += 16
    parts.append(_heading(say("measured", lang), x, y))
    y += 22.0
    if not findings:
        for line in _fit(say("all_clear", lang), w, 11.0):
            parts.append(f'<text x="{x:.0f}" y="{y:.1f}" font-size="11" '
                         f'fill="{INK["ok"]}">{_e(line)}</text>')
            y += 14
    for finding in findings:
        ink = SEVERITY_INK[finding["severity"]]
        title = (finding["title_ko"] if lang == "ko" and finding["title_ko"]
                 else finding["title"])
        block = y
        parts.append(f'<text x="{x + 12:.0f}" y="{y:.1f}" font-size="12" '
                     f'font-weight="600" fill="{INK["text"]}">{_e(title)}</text>')
        y += 15
        parts.append(f'<text x="{x + 12:.0f}" y="{y:.1f}" font-size="11" '
                     f'font-weight="700" fill="{ink}">'
                     f'{_e(finding["measurement_ko"] if lang == "ko" else finding["measurement"])}'
                     f'</text>')
        y += 14
        for line in _fit(finding["evidence_ko"] if lang == "ko"
                         else finding["evidence"], w - 12, 9.5):
            parts.append(f'<text x="{x + 12:.0f}" y="{y:.1f}" font-size="9.5" '
                         f'fill="{INK["refused"]}">{_e(line)}</text>')
            y += 11
        usually = (finding["usually_ko"] if lang == "ko" and finding["usually_ko"]
                   else finding["usually"])
        if usually:
            for line in _fit(say("usually", lang) + usually, w - 12, 9.5)[:3]:
                parts.append(f'<text x="{x + 12:.0f}" y="{y:.1f}" font-size="9.5" '
                             f'fill="{INK["refused"]}" font-style="italic">'
                             f'{_e(line)}</text>')
                y += 11
        parts.append(f'<rect x="{x:.0f}" y="{block - 11:.1f}" width="4" '
                     f'height="{y - block + 4:.1f}" rx="2" fill="{ink}"/>')
        y += 16
    return {"parts": parts, "height": y - top}


def _plan_column(report: dict, x: float, top: float, w: float,
                 lang: str) -> dict:
    parts: list[str] = []
    y = top
    ranked = report.get("priorities") or ()
    if ranked:
        parts.append(_heading(say("priorities", lang), x, y))
        y += 20
        for index, entry in enumerate(ranked, 1):
            ink = SEVERITY_INK.get(entry["severity"], INK["text"])
            parts.append(f'<text x="{x:.0f}" y="{y:.1f}" font-size="10" '
                         f'font-weight="700" fill="{ink}">{index}</text>')
            title = entry["title_ko"] if lang == "ko" else entry["title"]
            for offset, line in enumerate(_fit(title, w - 16, 10.5)):
                parts.append(f'<text x="{x + 14:.0f}" y="{y:.1f}" '
                             f'font-size="10.5" font-weight="600" '
                             f'fill="{INK["text"]}">{_e(line)}</text>')
                y += 12
                del offset
            parts.append(f'<text x="{x + 14:.0f}" y="{y:.1f}" font-size="9.5" '
                         f'font-weight="700" fill="{ink}">'
                         f'{_e(entry["measurement_ko"] if lang == "ko" else entry["measurement"])}'
                         f'</text>')
            y += 15
        y += 10
    review = report.get("review") or {}
    if review.get("on"):
        parts.append(f'<text x="{x:.0f}" y="{y:.1f}" font-size="10.5" '
                     f'font-weight="700" fill="{INK["text"]}">'
                     f'{_e(say("comeBack", lang))}: {_e(review["on"])}</text>')
        y += 13
        for line in _fit(review["why_ko"] if lang == "ko" else review["why"],
                         w, 9.0):
            parts.append(f'<text x="{x:.0f}" y="{y:.1f}" font-size="9" '
                         f'fill="{INK["refused"]}">{_e(line)}</text>')
            y += 10.5
        y += 14
    parts.append(_heading(say("plan", lang), x, y))
    y += 22.0
    for index, entry in enumerate(report["programme"], 1):
        parts.append(f'<text x="{x:.0f}" y="{y:.1f}" font-size="10" '
                     f'font-weight="700" fill="{INK["joint"]}">{index}</text>')
        label = (entry["name_ko"] if lang == "ko" and entry["name_ko"]
                 else entry["name"])
        parts.append(f'<text x="{x + 16:.0f}" y="{y:.1f}" font-size="11" '
                     f'font-weight="600" fill="{INK["text"]}">'
                     f'{_e(label)}</text>')
        parts.append(f'<text x="{x + w:.0f}" y="{y:.1f}" font-size="8.5" '
                     f'text-anchor="end" fill="{INK["refused"]}">'
                     f'{_e(entry["discipline"])}</text>')
        y += 12
        reason = (entry["why_ko"][0] if lang == "ko" and entry["why_ko"][0]
                  else entry["why"][0])
        for line in _fit(reason, w - 16, 9.0)[:3]:
            parts.append(f'<text x="{x + 16:.0f}" y="{y:.1f}" font-size="9" '
                         f'fill="{INK["refused"]}">{_e(line)}</text>')
            y += 10.5
        y += 9
    if report["habits"]:
        y += 8
        parts.append(_heading(say("habits", lang), x, y))
        y += 20
        for habit in report["habits"]:
            text = habit["ko"] if lang == "ko" and habit["ko"] else habit["en"]
            first = True
            for line in _fit(text, w - 10, 9.5):
                parts.append(f'<text x="{x + (0 if first else 9):.0f}" '
                             f'y="{y:.1f}" font-size="9.5" '
                             f'fill="{INK["text"]}">'
                             f'{"· " if first else ""}{_e(line)}</text>')
                y += 11
                first = False
            y += 4
    return {"parts": parts, "height": y - top}


def _limits_column(report: dict, assessment: PhotoAssessment, x: float,
                   top: float, w: float, lang: str = "en") -> dict:
    """What the photographs could not measure, and what would have to change.

    A column, not a footnote. Every posture product is asked for sagittal
    pelvic tilt and this one refuses it; a reader who cannot see the refusal
    will assume it is in there somewhere.
    """
    parts = [_heading(say("cannot", lang), x, top, INK["refused"])]
    y = top + 22.0
    for entry in report["refused_detail"]:
        reason = entry["reason_ko"] if lang == "ko" else entry["reason"]
        label = entry["name_ko"] if lang == "ko" else entry["name"]
        parts.append(f'<text x="{x:.0f}" y="{y:.1f}" font-size="10.5" '
                     f'font-weight="600" fill="{INK["text"]}">'
                     f'{_e(label)}</text>')
        y += 13
        for line in _fit(reason, w, 9.5):
            parts.append(f'<text x="{x:.0f}" y="{y:.1f}" font-size="9.5" '
                         f'fill="{INK["refused"]}">{_e(line)}</text>')
            y += 11
        y += 8

    missing = report["missing_photos"]
    if missing:
        y += 6
        parts.append(_heading(say("not_supplied", lang), x, y, INK["notable"]))
        y += 20
        for slot in missing:
            parts.append(f'<text x="{x:.0f}" y="{y:.1f}" font-size="10.5" '
                         f'font-weight="600" fill="{INK["text"]}">'
                         f'{_e(slot["title_ko"] if lang == "ko" else slot["title"])}'
                         f'</text>')
            y += 13
            for line in _fit(slot["how_ko"] if lang == "ko" else slot["how"],
                             w, 9.5):
                parts.append(f'<text x="{x:.0f}" y="{y:.1f}" font-size="9.5" '
                             f'fill="{INK["refused"]}">{_e(line)}</text>')
                y += 11
            y += 8

    warnings = [w for w in report["warnings"] if "no " not in w[:4]]
    if warnings:
        y += 6
        parts.append(_heading(say("check", lang), x, y, INK["notable"]))
        y += 20
        for warning in warnings:
            for line in _fit(warning, w, 9.5):
                parts.append(f'<text x="{x:.0f}" y="{y:.1f}" font-size="9.5" '
                             f'fill="{INK["notable"]}">{_e(line)}</text>')
                y += 11
            y += 6

    unremarkable = [e["name_ko"] if lang == "ko" else e["name"]
                    for e in report["unremarkable_detail"]]
    if unremarkable:
        y += 6
        parts.append(_heading(say("usual", lang), x, y, INK["ok"]))
        y += 20
        for line in _fit(", ".join(unremarkable), w, 9.5):
            parts.append(f'<text x="{x:.0f}" y="{y:.1f}" font-size="9.5" '
                         f'fill="{INK["refused"]}">{_e(line)}</text>')
            y += 11
    return {"parts": parts, "height": y - top}


def _inner(svg: str) -> str:
    """The body of a standalone SVG, for nesting it inside another one.

    Nesting `<svg>` elements works and renders differently in enough viewers to
    be a bad bet for a document a studio prints, so the wrapper is stripped and
    the contents are placed in a `<g>` by the caller.
    """
    start = svg.index(">", svg.index("<svg")) + 1
    end = svg.rindex("</svg>")
    return svg[start:end]


def _svg_height(svg: str) -> float:
    marker = 'height="'
    start = svg.index(marker) + len(marker)
    return float(svg[start:svg.index('"', start)])
