import { MOTION, BREATH, sample } from './content/motion.js';
import { UI } from './content/strings.js';

/**
 * What the movement asks of each muscle, across the movement.
 *
 * The brief this was built against wants performance graphs — thin luminous lines, a faint
 * grid, a live playhead, hover inspection, a current value. It also shows those graphs
 * plotting a learner's weekly scores, and there are no learner scores in this application and
 * no honest way to invent one. So this plots the series the app actually has, and it is a real
 * one: every clip carries per-muscle activation at each keyframe, and `sample()` interpolates
 * between them, so a muscle's line here is the same number the shader is using to light it.
 * The playhead is the scrubber. Moving one moves the other because they are the same value.
 *
 * **The y axis is a role, not an amplitude.** The clips state which muscles the movement works
 * and how hard, taken from the exercise records; they are not EMG. The panel's legend already
 * says so in as many words and the caption here repeats it, because a chart is exactly the
 * thing that makes a number look measured. Anyone who wants to change this file should read
 * that sentence twice: a line going up is a claim about what the exercise asks of a muscle,
 * not a claim about a person.
 *
 * Drawn on a 2D canvas rather than as SVG: it is redrawn on every scrub and while the clip
 * plays, and a couple of hundred DOM attribute writes per frame is the layout-thrashing
 * mistake the labels already made once.
 */

const W = 288, H = 128;          // fallback width, and the height; the width is measured
const PAD_L = 4, PAD_R = 4, PAD_T = 11, PAD_B = 15;
const SAMPLES = 72;              // points per line across the clip
const MAX_LINES = 6;             // above this the plot is a thicket, not a reading

/* Warm for the muscles, so the chart belongs to the same instrument as the tissue. Ordered so
 * the strongest line is the brightest — the ranking is by peak, so this is not arbitrary. */
const LINE = ['#FFC98A', '#F2A96A', '#E88C5A', '#C9784E', '#A96444', '#8B523A'];

export class ActChart {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'actcanvas';
    this.ctx = this.canvas.getContext('2d');
    this.w = 0;
    this.dpr = 0;
    this.sig = null;
    this.key = null;
    this.series = [];
    this.phases = [];
  }

  /* The panel is rebuilt from innerHTML on every render, so the host element the canvas was
   * appended to is thrown away and a new empty one arrives. Re-parenting the same canvas
   * keeps the sampled series and the 2D context: building a fresh one per render would
   * re-sample the clip on every keystroke in the library search. */
  attach(host, onResize) {
    if (this.canvas.parentNode !== host) host.appendChild(this.canvas);
    this.onResize = onResize;
    /* The panel's width is a `clamp` on the viewport, so this box changes without the clip
     * changing and without a panel render. Measuring it per frame would be the layout
     * thrash the labels already made once, so it is measured when it actually moves. */
    if (!this.ro && typeof ResizeObserver !== 'undefined')
      this.ro = new ResizeObserver(() => { if (this.fit()) this.onResize?.(); });
    if (this.ro) { this.ro.disconnect(); this.ro.observe(host); }
    this.fit();
    /* A new host means the panel was rebuilt, so the readout beside the plot is an empty
     * div again even though the canvas still holds last frame's pixels. Without this the
     * skip-if-unchanged guard would leave that div empty, and a field that renders nothing
     * looks exactly like a field that is not there. */
    this.sig = null;
  }

  /** Match the drawing buffer to the box the canvas is shown in. True if it moved. */
  fit() {
    const w = Math.max(120, Math.round(this.canvas.parentNode?.clientWidth || W));
    // dpr as well as width: a window dragged to a second display changes one and not the other
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    if (w === this.w && dpr === this.dpr) return false;
    this.w = w; this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(H * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${H}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.sig = null;
    return true;
  }

  /** Normalised time under a pointer at `offsetX` CSS pixels, or null outside the plot. */
  uAt(offsetX) {
    const x0 = PAD_L, x1 = this.w - PAD_R;
    if (x1 <= x0 || offsetX < x0 || offsetX > x1) return null;
    return (offsetX - x0) / (x1 - x0);
  }

  /** Re-sample a clip. Cheap, but only worth doing when the exercise changes. */
  load(key) {
    if (this.key === key) return;
    this.key = key;
    this.sig = null;
    this.series = [];
    this.phases = [];
    const clip = key && MOTION[key];
    if (!clip) return;
    this.phases = clip.phases ?? [];

    /* Every muscle the clip ever names, sampled across it. A muscle that appears in one
     * keyframe and not the next is absent, not zero — `sample` interpolates what is there —
     * so the series is built from the union of the names and read back through `sample`. */
    const names = new Set();
    for (const k of clip.keys) for (const n of Object.keys(k.act ?? {})) names.add(n);
    const rows = [...names].map(name => ({ name, pts: [] }));
    for (let i = 0; i < SAMPLES; i++) {
      const t = i / (SAMPLES - 1);
      const a = sample(key, t).activation ?? {};
      for (const r of rows) r.pts.push(a[r.name] ?? 0);
    }
    // the busiest muscles first: six lines is a reading, twenty is a thicket
    rows.sort((a, b) => Math.max(...b.pts) - Math.max(...a.pts));
    this.series = rows.slice(0, MAX_LINES);
  }

  /**
   * @param t   where the clip is, 0..1 — the same value the scrubber holds
   * @param at  normalised x under the pointer, or null
   */
  draw(t, at = null, lang = 'en') {
    const c = this.ctx;
    if (!this.w) this.fit();
    /* Redrawn from the render loop, so it is asked to draw sixty times a second while the
     * clip plays and the playhead moves a fraction of a pixel between most of them. Six
     * glowing strokes and a gradient fill is not free, and neither is the readout's
     * innerHTML beside it, so a frame that would land on the same pixel is skipped. */
    const sig = `${this.key}|${this.w}|${lang}|${Math.round(t * this.w)}|${
      at == null ? '-' : Math.round(at * this.w)}`;
    if (sig === this.sig) return false;
    this.sig = sig;
    c.clearRect(0, 0, this.w, H);
    const x0 = PAD_L, x1 = this.w - PAD_R, y0 = PAD_T, y1 = H - PAD_B;
    const X = u => x0 + (x1 - x0) * u;
    const Y = v => y1 - (y1 - y0) * Math.min(1, Math.max(0, v));

    // the grid: four rules and nothing else, kept under the threshold of being a pattern
    c.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = Math.round(Y(i / 4)) + 0.5;
      c.strokeStyle = i === 0 || i === 4 ? 'rgba(150,185,230,.16)' : 'rgba(150,185,230,.07)';
      c.beginPath(); c.moveTo(x0, y); c.lineTo(x1, y); c.stroke();
    }

    /* The breath phases, in their own colours, at the same places the marks above the
     * scrubber are. The x axis is the movement rather than abstract time, so where the
     * breath turns over is part of reading the plot. */
    for (const p of this.phases ?? []) {
      if (p.at <= 0) continue;
      const bx = Math.round(X(p.at)) + 0.5;
      c.strokeStyle = BREATH[p.breath]?.color ?? 'rgba(150,185,230,.2)';
      c.globalAlpha = 0.22;
      c.beginPath(); c.moveTo(bx, y0); c.lineTo(bx, y1); c.stroke();
      c.globalAlpha = 1;
    }

    if (!this.series.length) {
      c.fillStyle = 'rgba(150,185,230,.35)';
      c.font = '9px "Helvetica Neue", Helvetica, Arial, sans-serif';
      c.fillText(UI.chartNone?.[lang] ?? '', x0 + 2, (y0 + y1) / 2);
      return true;
    }

    /* The busiest line gets a wash under it, so the plot has a subject rather than being
     * six equal threads. It is the same series drawn twice, not extra data. */
    const lead = this.series[0];
    if (lead) {
      const g = c.createLinearGradient(0, y0, 0, y1);
      g.addColorStop(0, 'rgba(255,201,138,.16)');
      g.addColorStop(1, 'rgba(255,201,138,0)');
      c.beginPath(); c.moveTo(x0, y1);
      lead.pts.forEach((v, j) => c.lineTo(X(j / (SAMPLES - 1)), Y(v)));
      c.lineTo(x1, y1); c.closePath();
      c.fillStyle = g; c.fill();
    }

    /* Drawn faintest first so the strongest muscle ends up on top. The glow is a shadow on
     * the stroke rather than a second wider stroke: one path, and it stays a hairline at
     * its core, which is what keeps six of them readable in a hundred-pixel box. */
    for (let i = this.series.length - 1; i >= 0; i--) {
      const s = this.series[i];
      const col = LINE[i] ?? LINE[LINE.length - 1];
      c.beginPath();
      s.pts.forEach((v, j) => {
        const x = X(j / (SAMPLES - 1)), y = Y(v);
        j ? c.lineTo(x, y) : c.moveTo(x, y);
      });
      c.strokeStyle = col;
      c.shadowColor = col;
      c.shadowBlur = i === 0 ? 7 : 3;
      c.globalAlpha = i === 0 ? 1 : 0.68 - i * 0.06;
      c.lineWidth = i === 0 ? 1.5 : 1;
      c.lineJoin = 'round';
      c.stroke();
      c.shadowBlur = 0;
      c.globalAlpha = 1;
    }

    /* The playhead. It is the scrubber's own value, so this line is where the body on screen
     * actually is in the movement — not a cursor over a picture of one. */
    const px = Math.round(X(t)) + 0.5;
    c.strokeStyle = 'rgba(191,233,255,.6)';
    c.shadowColor = 'rgba(140,200,255,.85)'; c.shadowBlur = 5;
    c.beginPath(); c.moveTo(px, y0 - 3); c.lineTo(px, y1 + 3); c.stroke();
    c.shadowBlur = 0;
    this.series.forEach((s, i) => {
      const v = s.pts[Math.round(t * (SAMPLES - 1))];
      const col = LINE[i] ?? LINE[LINE.length - 1];
      c.fillStyle = col; c.shadowColor = col; c.shadowBlur = i === 0 ? 6 : 3;
      c.beginPath(); c.arc(X(t), Y(v), i === 0 ? 2.4 : 1.7, 0, Math.PI * 2);
      c.fill();
      c.shadowBlur = 0;
    });

    // the inspection line, when a pointer is over the plot
    if (at != null) {
      const ax = Math.round(X(at)) + 0.5;
      c.strokeStyle = 'rgba(255,255,255,.22)';
      c.beginPath(); c.moveTo(ax, y0 - 2); c.lineTo(ax, y1 + 2); c.stroke();
    }

    /* The axes. x is the clip, from its start to its end; y is the role scale, which is the
     * same 0–1 as the ramp legend above. Both ends are labelled, because an unlabelled axis
     * is the thing that lets a picture imply a measurement. */
    c.fillStyle = 'rgba(150,185,230,.45)';
    c.font = '8px "Helvetica Neue", Helvetica, Arial, sans-serif';
    c.fillText('0', x0, H - 4);
    c.fillText('1.0', x1 - 13, H - 4);
    c.fillStyle = 'rgba(150,185,230,.32)';
    c.fillText('1.0', x0 + 1, y0 - 3);
    return true;
  }

  /** What every plotted muscle is doing at a normalised time, for the readout beside it. */
  readAt(u) {
    const j = Math.round(Math.min(1, Math.max(0, u)) * (SAMPLES - 1));
    return this.series.map((s, i) => ({
      name: s.name, value: s.pts[j], colour: LINE[i] ?? LINE[LINE.length - 1],
    }));
  }
}
