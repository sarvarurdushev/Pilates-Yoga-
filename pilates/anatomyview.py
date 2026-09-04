"""A body with one person's session on it, drawn without a 3D engine.

The companion to :mod:`pilates.bundle` and ``viewer/bundle.js``. That pair
hands a session to the 3D anatomy model; this draws the same session as a flat
figure that prints, opens on a phone with no WebGL, and survives being emailed.
Both were asked for -- the 2D beside the 3D, not instead of it -- and they are
built from the same file so they cannot drift apart: everything here reads the
bundle's own ``structures``, ``lighting`` and ``because`` fields and adds no
claim of its own.

**The figure is a diagram, not an anatomical drawing.** Eight muscle groups are
drawn as bands laid along the limb each one moves, offset to either side of the
bone so a flexor and an extensor are distinguishable. Where the muscle actually
sits, what shape it is and what it wraps around are questions the 3D model
answers properly; a front-facing stick figure cannot, and pretending otherwise
would be a worse picture than an obviously schematic one. The caption says so.

**Measured and reference never differ only in colour.** A measured band is
filled solid and carries a number and a date. A reference structure is drawn
hatched with no number at all, and the panel row for one has an empty number
column rather than a dash -- there is no figure to put there, and a dash reads
as zero. That rule comes from the integration plan and it is the one thing in
this file that must not be relaxed for the sake of a tidier layout.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

from .activation import MEASURED, Plan, group_of
from .bridge import meshes_for_group
from .activation import plan as activation_plan
from .dashboard import _ANCHORS, _BONES, STYLE, _e
from .wording import MUSCLE_PLAIN, PLAIN, REGISTERS, TECHNICAL, dual

#: Where each muscle group is drawn: the segment it is laid along, and which
#: stretch of that segment it takes.
#:
#: **Why the four groups on a limb are stacked and not straddled.** The first
#: version put flexors on one side of the bone and extensors on the other, two
#: bands abreast. On a thigh that is only thirty-six pixels from its neighbour
#: the medial bands of the two legs ended up closer to each other than to their
#: own leg, and the whole pelvis read as one block of four bands. It was also a
#: quiet anatomical falsehood: flexors and extensors sit in front of and behind
#: a limb, not inside and outside it, and a front view cannot show that at all.
#: So each group takes its own stretch of the limb, which is an index rather
#: than a position, and the caption says so.
@dataclass(frozen=True)
class Placement:
    """One band on the figure. Schematic, and deliberately so."""

    #: Anchor names, without the side prefix.
    frm: str
    to: str
    #: Which stretch of that segment the band covers, 0 at ``frm``.
    start: float
    end: float


PLACEMENTS: dict[str, Placement] = {
    "hip flexors":        Placement("hip", "knee", 0.02, 0.23),
    "hip extensors":      Placement("hip", "knee", 0.27, 0.48),
    "knee extensors":     Placement("hip", "knee", 0.52, 0.73),
    "knee flexors":       Placement("hip", "knee", 0.77, 0.98),
    # The four arm groups sit on the upper arm for the same reason the four leg
    # groups sit on the thigh: that is the segment they all act across. An
    # earlier version put the shoulder pair on the collarbone, where they read
    # as muscles of the chest.
    "shoulder flexors":   Placement("shoulder", "elbow", 0.02, 0.23),
    "shoulder extensors": Placement("shoulder", "elbow", 0.27, 0.48),
    "elbow flexors":      Placement("shoulder", "elbow", 0.52, 0.73),
    "elbow extensors":    Placement("shoulder", "elbow", 0.77, 0.98),
}

#: Which drawn segments a named bone is. Bones are hatched only where the
#: bundle names them, so the picture shows the bones a measured joint actually
#: articulates. The first version matched on the anchor names ending in a joint
#: word, which lit almost every segment on the body -- including the neck, from
#: "l_shoulder" -- and the reference hatch drowned the thing it was meant to sit
#: behind.
BONE_SEGMENTS: dict[str, tuple[tuple[str, str], ...]] = {
    "femur":    (("l_hip", "l_knee"), ("r_hip", "r_knee")),
    "tibia":    (("l_knee", "l_ankle"), ("r_knee", "r_ankle")),
    "fibula":   (("l_knee", "l_ankle"), ("r_knee", "r_ankle")),
    "patella":  (),
    "humerus":  (("l_shoulder", "l_elbow"), ("r_shoulder", "r_elbow")),
    "radius":   (("l_elbow", "l_wrist"), ("r_elbow", "r_wrist")),
    "ulna":     (("l_elbow", "l_wrist"), ("r_elbow", "r_wrist")),
    "clavicle": (("neck", "l_shoulder"), ("neck", "r_shoulder")),
    "scapula":  (("l_shoulder", "r_shoulder"),),
}

#: Which joint's bones a group's reference structures hang off, for placing the
#: hatched overlay that says "this bone articulates something measured".
GROUP_JOINT: dict[str, str] = {
    "hip flexors": "hip", "hip extensors": "hip",
    "knee extensors": "knee", "knee flexors": "knee",
    "elbow flexors": "elbow", "elbow extensors": "elbow",
    "shoulder flexors": "shoulder", "shoulder extensors": "shoulder",
}

BAND_WIDTH = 9.0
MIDLINE = 100.0
#: How far a number sits off the band it belongs to.
LABEL_GAP = BAND_WIDTH / 2 + 2.0
#: Cropped to what is actually drawn. The figure ends at the ankles and starts
#: at the crown; a box the full height of the page left a hand's depth of empty
#: card under the feet.
VIEWBOX = "0 8 200 312"


def _anchor(side: str, name: str) -> tuple[float, float]:
    if name == "neck":
        return _ANCHORS["neck"]
    return _ANCHORS[f"{side[0]}_{name}"]


def _band_ends(side: str, place: Placement) -> tuple[float, float, float, float]:
    """The two ends of a band, laid along the bone it belongs to."""
    (x1, y1) = _anchor(side, place.frm)
    (x2, y2) = _anchor(side, place.to)
    dx, dy = x2 - x1, y2 - y1
    return (x1 + dx * place.start, y1 + dy * place.start,
            x1 + dx * place.end, y1 + dy * place.end)


def _opacity(level: float, floor: float, ceiling: float) -> float:
    """How solid a measured band is drawn.

    The bundle's level runs from the band floor to 1.0. Redrawing that straight
    into opacity would make the dimmest measured group nearly transparent and so
    indistinguishable from a group that was not measured at all -- the one
    confusion this whole view exists to prevent. It is stretched into a range
    that starts unmistakably visible instead, which is the same reasoning the
    level itself is built on, applied once more at the point of drawing.
    """
    if ceiling <= floor:
        return 1.0
    share = max(0.0, min(1.0, (level - floor) / (ceiling - floor)))
    return 0.45 + 0.55 * share


def figure(plan: Plan, scheme: dict) -> str:
    """The body, with every measured group filled and every bone it moves marked."""
    floor, ceiling = scheme.get("measured_band", [0.7, 1.0])
    by_group: dict[str, object] = {}
    for light in plan.measured:
        by_group.setdefault(group_of(light.source), light)
    named_bones = {l.name for l in plan.reference if l.name in BONE_SEGMENTS}

    parts = [
        f"<svg viewBox='{VIEWBOX}' class='figure' role='img' "
        f"aria-label='muscle groups measured in this session'>",
        "<defs><pattern id='ref' width='4.5' height='4.5' "
        "patternUnits='userSpaceOnUse' patternTransform='rotate(45)'>"
        "<line x1='0' y1='0' x2='0' y2='4.5' class='hatch'/></pattern></defs>",
    ]
    for a, b in _BONES:
        (x1, y1), (x2, y2) = _ANCHORS[a], _ANCHORS[b]
        parts.append(f"<line class='bone' x1='{x1}' y1='{y1}' x2='{x2}' "
                     f"y2='{y2}'/>")
    parts.append(f"<circle class='bone-fill' cx='{_ANCHORS['head'][0]}' "
                 f"cy='{_ANCHORS['head'][1]}' r='16'/>")

    # Reference, under the measured bands: a bone the bundle named, hatched and
    # never numbered.
    drawn: set[tuple[str, str]] = set()
    for bone in sorted(named_bones):
        for a, b in BONE_SEGMENTS[bone]:
            if (a, b) in drawn:
                continue
            drawn.add((a, b))
            (x1, y1), (x2, y2) = _ANCHORS[a], _ANCHORS[b]
            parts.append(
                f"<line class='refbone' data-structure='{_e(bone)}' "
                f"x1='{x1}' y1='{y1}' x2='{x2}' y2='{y2}'>"
                f"<title>{_e(bone)}: it meets a joint that was measured. "
                f"Nothing here estimated what this bone carried.</title></line>")

    labels: list[str] = []
    for group, light in sorted(by_group.items()):
        place = PLACEMENTS.get(group)
        if place is None:
            continue
        opacity = _opacity(light.level, floor, ceiling)
        spoken = MUSCLE_PLAIN.get(group, group)
        for side in ("left", "right"):
            ax, ay, bx, by = _band_ends(side, place)
            parts.append(
                f"<g class='group' data-group='{_e(group)}' role='button' "
                f"tabindex='0' aria-label='{_e(group)}, {light.value:.0f} "
                f"newton metres'>"
                f"<line class='hit' x1='{ax:.1f}' y1='{ay:.1f}' x2='{bx:.1f}' "
                f"y2='{by:.1f}'/>"
                # A dimmer band is drawn part-transparent, and the hatched bone
                # underneath showed through it as stripes -- a measured group
                # wearing the reference treatment, which is the one mistake this
                # picture may not make. An opaque backing first.
                f"<line class='bandbg' x1='{ax:.1f}' y1='{ay:.1f}' "
                f"x2='{bx:.1f}' y2='{by:.1f}'/>"
                f"<line class='band' x1='{ax:.1f}' y1='{ay:.1f}' "
                f"x2='{bx:.1f}' y2='{by:.1f}' opacity='{opacity:.2f}'/>"
                f"<title>{_e(spoken)} ({_e(group)}): {light.value:.0f} Nm, the "
                f"hardest this group worked on either side in this "
                f"session</title></g>")
        # One number per group, not one per side: the measurement is the peak
        # across both, so a figure on each leg would be the same figure twice
        # and read as two separate readings.
        #
        # Put it at the proximal end of a medial band and the distal end of a
        # lateral one. The two groups sharing a stretch of limb are drawn side
        # by side, so labelling both at the midpoint left "24 21" sitting
        # together with nothing to say which band each belonged to.
        ax, ay, bx, by = _band_ends("right", place)
        x, y = (ax + bx) / 2, (ay + by) / 2
        # Beside the band's middle, on the outside of the right-hand limb. Only
        # one band occupies each stretch of a limb now, so a number can sit
        # level with its own band and belong to nothing else.
        labels.append(
            f"<g class='numg' data-group='{_e(group)}'>"
            f"<line class='leader' x1='{x + LABEL_GAP - 2:.1f}' y1='{y:.1f}' "
            f"x2='{x + LABEL_GAP + 2:.1f}' y2='{y:.1f}'/>"
            f"<text class='num' text-anchor='start' x='{x + LABEL_GAP + 5:.1f}' "
            f"y='{y + 3.5:.1f}'>{light.value:.0f}</text></g>")
    parts.extend(labels)
    parts.append("</svg>")
    return "".join(parts)


def legend(scheme: dict) -> str:
    """Three states, and the third one is the point of the whole exercise."""
    rows = [
        ("meas", "Measured in this class",
         "Filled in, with a number and the date beside it. Computed from this "
         "person's own video.", True),
        ("ref", "Connected to something measured",
         "Hatched, never numbered. Anatomy that is true of everybody: it says "
         "where to look next, not what was observed.", False),
        ("un", "Nothing measured here",
         "Not “zero effort” — this class produced no measurement "
         "that reaches it.", False),
    ]
    out = ["<ul class='legend'>"]
    sample = "<em class='has-num'>42 Nm</em>"
    for key, title, note, numbered in rows:
        out.append(
            f"<li><i class='sw {key}'></i><span><b>{_e(title)}</b>"
            + (f" {sample}" if numbered else "")
            + f"<br>{_e(note)}</span></li>")
    out.append("</ul>")
    out.append(f"<p class='note'>{_e(scheme.get('note', ''))}</p>")
    return "".join(out)


def groups(plan: Plan) -> str:
    """The measured groups, hardest first, with what each one is made of.

    The picture says where; this says how much and out of what. It is also
    where the "every muscle in a group shares its level" rule stops being an
    assertion in the legend and becomes visible: each row names its own
    muscles, and they all sit behind one number.
    """
    ranked: dict[str, object] = {}
    for light in plan.measured:
        ranked.setdefault(group_of(light.source), light)
    if not ranked:
        return ""
    out = ["<ul class='groups'>"]
    for group, light in sorted(ranked.items(), key=lambda kv: -kv[1].value):
        share = light.share or 0.0
        spoken = MUSCLE_PLAIN.get(group, group)
        # The group's own membership, not the muscles whose largest effort
        # happened to be this one. Listing the winners made the knee flexors
        # read as "the back of the thigh: gastrocnemius" -- the hamstrings had
        # been taken by the hip extensors, which worked seven times harder, and
        # the row lost three of its four muscles without saying so.
        members = ", ".join(mesh.name for mesh in meshes_for_group(group))
        out.append(
            f"<li data-group='{_e(group)}' role='button' tabindex='0'>"
            f"<span class='gname'>{dual(spoken, group)}</span>"
            f"<span class='gnum'>{light.value:.0f}<em>Nm</em></span>"
            f"<span class='gtrack'><span class='gfill' "
            f"style='width:{share * 100:.0f}%'></span></span>"
            f"<span class='gmus'>{_e(members)}</span></li>")
    out.append("</ul>")
    return "".join(out)


def _rows(plan: Plan, date: str) -> str:
    """One row per structure, measured first, numbers only where earned."""
    out = ["<table class='structures'><thead><tr>"
           f"<th>{dual('Body part', 'Structure')}</th>"
           f"<th>{dual('What we measured', 'Tier')}</th>"
           "<th class='r'>Nm</th><th>When</th>"
           f"<th>{dual('Why it is lit', 'Provenance')}</th>"
           "</tr></thead><tbody>"]
    for light in sorted(plan.lights,
                        key=lambda l: (l.tier != MEASURED, -l.level, l.name)):
        measured = light.tier == MEASURED
        klass = "meas" if measured else "ref"
        # A reference row's number cell is empty, not a dash: there is no
        # figure to put there and a dash reads as a measurement of zero.
        number = f"{light.value:.1f}" if light.carries_a_number else ""
        group = group_of(light.source) if measured else ""
        tier = (dual(f"how hard {MUSCLE_PLAIN.get(group, group)} worked",
                     f"{light.source}")
                if measured else dual("looked up, not measured", "reference"))
        out.append(
            f"<tr class='{klass}' data-structure='{_e(light.name)}'"
            + (f" data-group='{_e(group)}'" if group else "")
            + f"><td><b>{_e(light.name)}</b>"
            + (f"<span class='fma'>{_e(light.fma)}</span>" if light.fma else
               "<span class='fma none'>no FMA id</span>")
            + f"</td><td>{tier}</td>"
            f"<td class='r num'>{number}</td>"
            f"<td class='when'>{_e(date) if measured else ''}</td>"
            f"<td class='why'>{dual(light.plain, light.because)}</td></tr>")
    out.append("</tbody></table>")
    return "".join(out)


EXTRA_STYLE = """
.figure { width:100%; max-width:272px; height:auto; margin:0 auto; display:block; }
/* Reference has to stay quieter than measurement. The first hatch was as heavy
   as the bands and the figure read as a hatched skeleton with a few blue bits
   on it -- the reference layer shouting over the thing it sits behind. */
.hatch { stroke:var(--muted); stroke-width:1.2; }
.refbone { stroke:url(#ref); stroke-width:5.5; stroke-linecap:round;
  opacity:0.6; }
.bandbg { stroke:var(--panel); stroke-width:9.5; stroke-linecap:round; }
.band { stroke:var(--series1); stroke-width:9; stroke-linecap:round; }
.leader { stroke:var(--muted); stroke-width:1; }
.hit { stroke:transparent; stroke-width:20; stroke-linecap:round; cursor:pointer; }
.group:hover .band, .group.on .band { stroke:var(--ink); opacity:1 !important; }
.group:focus-visible .band { stroke:var(--ink); }
.num { fill:var(--ink); font-size:11px; font-weight:680;
  font-variant-numeric:tabular-nums; }
.legend { list-style:none; margin:0; padding:0; display:grid; gap:10px; }
.legend li { display:flex; gap:9px; align-items:flex-start; font-size:12.5px;
  color:var(--muted); }
.legend b { color:var(--ink); font-weight:620; }
.legend .has-num { font-style:normal; font-weight:680; margin-left:6px;
  font-variant-numeric:tabular-nums; background:var(--band); color:var(--ink);
  padding:0 5px; border-radius:4px; }
.sw { width:22px; height:12px; border-radius:3px; flex:none; margin-top:2px; }
.sw.meas { background:var(--series1); }
.sw.ref { background:repeating-linear-gradient(45deg,var(--muted) 0 2px,
  transparent 2px 5px); border:1px solid var(--rule); }
.sw.un { background:var(--rule); }
.structures { width:100%; border-collapse:collapse; font-size:13px; }
.structures th { text-align:left; font-size:11px; text-transform:uppercase;
  letter-spacing:0.07em; color:var(--muted); font-weight:600;
  border-bottom:1px solid var(--rule); padding:0 8px 6px 0; }
.structures td { padding:7px 8px 7px 0; border-bottom:1px solid var(--rule);
  vertical-align:top; }
.structures td.r, .structures th.r { text-align:right; }
.structures td.num { font-variant-numeric:tabular-nums; font-weight:650;
  white-space:nowrap; }
.structures .when { color:var(--muted); white-space:nowrap; font-size:12px; }
.structures .why { color:var(--muted); font-size:12.5px; }
.structures tr.ref td b { font-weight:520; }
.structures tr.on { background:var(--band); }
.fma { display:block; color:var(--muted); font-size:11px;
  font-variant-numeric:tabular-nums; }
.fma.none { font-style:italic; }
.split { display:grid; grid-template-columns:minmax(240px,310px) 1fr; gap:20px;
  align-items:start; }
.split > .card { align-self:start; }
@media (max-width:720px) { .split { grid-template-columns:1fr; } }
.stack { display:grid; gap:14px; align-content:start; }
.groups { list-style:none; margin:0; padding:0; display:grid; gap:12px; }
.groups li { display:grid; grid-template-columns:1fr auto; gap:2px 10px;
  cursor:pointer; padding:6px 8px; margin:0 -8px; border-radius:6px; }
.groups li:hover, .groups li.on { background:var(--band); }
.gname { font-weight:600; }
.gnum { font-variant-numeric:tabular-nums; font-weight:680; text-align:right;
  white-space:nowrap; }
.gnum em { font-style:normal; font-weight:500; color:var(--muted);
  font-size:11px; margin-left:3px; }
.gtrack { grid-column:1 / -1; height:6px; border-radius:3px;
  background:var(--rule); overflow:hidden; }
.gfill { display:block; height:100%; background:var(--series1); }
.gmus { grid-column:1 / -1; color:var(--muted); font-size:12px; }
.caption { color:var(--muted); font-size:12px; margin:10px 0 0; }
/* The register switch and the plain/technical rules come from the dashboard's
   own stylesheet -- one definition, so the two pages cannot end up disagreeing
   about what "both" looks like. Only the margin differs here. */
.regswitch { margin:0 0 16px; }
"""

SCRIPT = """
(function () {
  var root = document.querySelector('.viz-root');
  var KEY = 'pilates-register';
  try { var saved = localStorage.getItem(KEY); if (saved) setRegister(saved); }
  catch (e) { /* private browsing; the page keeps the register it rendered with */ }

  function setRegister(r) {
    root.setAttribute('data-register', r);
    root.querySelectorAll('.reg').forEach(function (b) {
      b.classList.toggle('on', b.dataset.register === r);
    });
    try { localStorage.setItem(KEY, r); } catch (e) {}
  }
  root.querySelectorAll('.reg').forEach(function (b) {
    b.addEventListener('click', function () { setRegister(b.dataset.register); });
  });

  /* One selection, two views -- click a band, its muscles highlight in the
     table; click a row, the band it belongs to highlights. A reference row has
     no band to light, and selecting one clears rather than leaving the last
     muscle lit, which would read as "this nerve lit that muscle". */
  function select(group) {
    root.querySelectorAll('.group').forEach(function (g) {
      g.classList.toggle('on', !!group && g.dataset.group === group);
    });
    root.querySelectorAll('.structures tbody tr, .groups li').forEach(function (el) {
      el.classList.toggle('on', !!group && el.dataset.group === group);
    });
    var first = group && root.querySelector('.structures tr.on');
    if (first) first.scrollIntoView({ block: 'nearest' });
  }
  var current = null;
  function toggle(group) { current = current === group ? null : group; select(current); }
  root.querySelectorAll('.group').forEach(function (g) {
    g.addEventListener('click', function () { toggle(g.dataset.group); });
    g.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(g.dataset.group); }
    });
  });
  root.querySelectorAll('.structures tbody tr').forEach(function (tr) {
    tr.addEventListener('click', function () { toggle(tr.dataset.group || null); });
  });
  root.querySelectorAll('.groups li').forEach(function (li) {
    li.addEventListener('click', function () { toggle(li.dataset.group); });
    li.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(li.dataset.group); }
    });
  });
})();
"""


def render(bundle: dict, register: str = PLAIN) -> str:
    """The whole page: one session, on a body, in the reader's own words."""
    if register not in REGISTERS:
        raise ValueError(f"register must be one of {REGISTERS}, not {register!r}")
    structures = bundle.get("structures", [])
    scheme = bundle.get("lighting", {})
    plan = activation_plan(structures)
    person = bundle.get("person", {})
    session = bundle.get("session", {})
    name = person.get("display_name") or person.get("username", "")
    date = session.get("date", "")

    counts = (len(plan.measured), len(plan.reference))
    scale = scheme.get("scale") or {}
    top = ""
    if scale.get("value") is not None:
        group = group_of(scale.get("from", ""))
        top = dual(
            f"The hardest anything worked was {MUSCLE_PLAIN.get(group, group)}, "
            f"at {scale['value']:.0f} {scale.get('unit', '')}. Everything else "
            f"on the body is drawn against that.",
            f"Scale set by {scale.get('from', '')} at "
            f"{scale['value']:.1f} {scale.get('unit', '')}.")

    switch = "".join(
        f"<button type='button' class='reg{' on' if r == register else ''}' "
        f"data-register='{r}'>{label}</button>"
        for r, label in ((PLAIN, "Plain"), ("both", "Both"),
                         (TECHNICAL, "Technical")))

    return f"""<!DOCTYPE html>
<html lang='en'><head><meta charset='utf-8'>
<meta name='viewport' content='width=device-width, initial-scale=1'>
<title>{_e(name)} — {_e(date)} — on the body</title>
<style>{STYLE}{EXTRA_STYLE}</style></head>
<body class='viz-root' data-register='{register}'>
<div class='sheet'>
<header>
  <h1>{_e(name)}</h1>
  <div class='sub'>{_e(session.get('key', ''))} · {_e(date)}
    · {counts[0]} {dual('body parts we measured', 'structures measured')}
    · {counts[1]} {dual('connected to them', 'reference')}</div>
</header>
<div class='regswitch' role='group' aria-label='how much detail'>
  <span class='reglab'>Wording</span>{switch}</div>

<h2>{dual('What worked in this class', 'Measured structures')}</h2>
<p class='lede'>{top}</p>
<div class='split'>
  <div class='card'>
    {figure(plan, scheme)}
    <p class='caption'>{dual(
      'A diagram, not a drawing of a real body. Each band sits on the limb '
      'those muscles move, spaced out along it so you can tell them apart — '
      'the muscles that bend a joint are really in front of and behind the '
      'limb, which you cannot see from the front. The 3D model is where the '
      'real shapes are.',
      'Schematic. Each group takes a stretch of the segment it acts across; '
      'the position along the limb is an index, not an anatomical location — '
      'flexor and extensor compartments are anterior and posterior and a '
      'coronal view cannot separate them. Geometry lives in the 3D model.')}</p>
    <p class='caption'>{dual(
      'Both legs and both arms are drawn the same because the number is the '
      'hardest either side worked — we did not measure them separately.',
      'The peak is taken across both sides, so left and right are lit '
      'identically; the number is not attributed to a side.')}</p>
  </div>
  <div class='stack'>
    <div class='card'>
      <h3>{dual('What the colours mean', 'Legend')}</h3>
      {legend(scheme)}
    </div>
    <div class='card'>
      <h3>{dual('What worked hardest', 'Measured groups, by peak moment')}</h3>
      <p class='note'>{dual(
        'Each bar is that group next to the hardest-working one in this class. '
        'The muscles listed under it all share the one number, because we '
        'measured the joint and cannot tell them apart.',
        'Bar is the share of the session peak. Every member of a group carries '
        'the group moment: a net joint moment is not attributable to '
        'individual muscles.')}</p>
      {groups(plan)}
    </div>
  </div>
</div>

<h2>{dual('Everything on the picture', 'Structures, with provenance')}</h2>
<p class='note'>{_e(bundle.get('notice', ''))}</p>
{_rows(plan, date)}
</div>
<script>{SCRIPT}</script>
</body></html>
"""
