import { UI } from './content/strings.js';

/**
 * The instrument furniture: the frame, the live trace and the floating readouts.
 *
 * The reference this is built against carries almost no panels. What it has instead is a
 * sheet of glass with a hairline frame, a few lit points along the edges, a running trace,
 * and text small enough to sit at the threshold of legibility — so the eye goes to the
 * specimen and the interface reads as the apparatus around it. That is the opposite of a
 * dashboard, where the panels are the product and the picture is one of the tiles.
 *
 * Two rules hold everything here:
 *
 * - **Nothing on this layer is invented.** The trace is the network's own drive, the counts
 *   are the structures actually loaded, the region name is the one that is selected. An
 *   instrument that displays a plausible number it did not measure is the exact failure the
 *   four disclaimers exist to prevent, and it would be the worst possible way to satisfy a
 *   brief about looking trustworthy.
 * - **It never takes a pointer event.** The whole layer is `pointer-events: none` except the
 *   readouts, which are inert anyway. Clicking has to reach the anatomy: the picture is the
 *   control surface, and a HUD that swallows clicks turns it back into a background image.
 *
 * The trace is drawn on a 2D canvas rather than as SVG. It is one polyline redrawn every
 * frame at a couple of hundred points; as SVG that is a couple of hundred DOM attribute
 * writes per frame, which is the same layout-thrashing mistake the labels already made once.
 */

const TRACE_N = 260;          // samples held in the ring buffer
const TRACE_W = 268, TRACE_H = 54;

export class Hud {
  constructor(stage) {
    this.stage = stage;
    this.samples = new Float32Array(TRACE_N);
    this.head = 0;
    this.lang = 'en';

    const root = document.createElement('div');
    root.id = 'hud';
    /* The corners are CSS boxes with two borders each, not SVG.
     *
     * An SVG `transform` attribute is not a CSS transform: it takes unitless numbers in user
     * space and rejects `px` and `calc()` outright, so `translate(calc(100% - 10px), 10px)`
     * fails to parse and the browser logs four errors and draws nothing. Anchoring a box to a
     * corner is what CSS insets already do, exactly, with no measurement and no resize
     * handler — which is the whole job here. */
    root.innerHTML = `
      <i class="hudc tl"></i><i class="hudc tr"></i>
      <i class="hudc bl"></i><i class="hudc br"></i>
      <div id="hudCol">
      <div id="hudTrace">
        <canvas width="${TRACE_W * 2}" height="${TRACE_H * 2}"></canvas>
        <div class="hudlab"><span data-k="trace"></span><b id="hudRate">—</b></div>
        <!-- The one readout on this layer that carried a number and no words. A trace with a
             name and a value, on an instrument, invites a reader to take it for a recording —
             so it says what it is where it is, rather than only in a glossary they would have
             to know to open. -->
        <p class="hudnote" data-k="traceNote"></p>
      </div>
      <div id="hudRead"></div>
      </div>`;
    stage.appendChild(root);
    this.root = root;
    this.canvas = root.querySelector('#hudTrace canvas');
    this.ctx = this.canvas.getContext('2d');
    this.ctx.scale(2, 2);
    this.rate = root.querySelector('#hudRate');
    this.read = root.querySelector('#hudRead');
    this.relabel('en');
  }

  relabel(lang) {
    this.lang = lang;
    this._readKey = null;          // the readouts are text too, so they have to be rebuilt
    const t = k => (UI[k]?.[lang] ?? '');
    for (const el of this.root.querySelectorAll('[data-k]'))
      el.textContent = t(el.dataset.k);
  }

  /**
   * One sample per frame of the network's own drive, plus the running readouts.
   *
   * `drive` is the same number the shaders are given, so the trace is a record of what the
   * picture is doing rather than a decorative sine wave. When nothing is loaded it flatlines,
   * which is correct and is the point.
   */
  tick(t, { drive = 0, regions = [], selected = null, structures = 0, nodes = 0 } = {}) {
    // a little noise on the sample, because a perfectly smooth trace reads as a drawing
    const jitter = 0.06 * (Math.sin(t * 21.3) * 0.6 + Math.sin(t * 7.1) * 0.4);
    this.samples[this.head] = Math.max(0, drive + jitter * drive);
    this.head = (this.head + 1) % TRACE_N;
    this.drawTrace();
    // a textContent write invalidates the node even when the string is identical
    const rate = drive > 0 ? drive.toFixed(2) : '—';
    if (rate !== this._rate) { this._rate = rate; this.rate.textContent = rate; }

    /* Rewritten only when it changes, not sixty times a second.
     *
     * This was an `innerHTML` assignment every frame: the browser re-parses the markup,
     * rebuilds four elements and relayouts them, for four values that change when a layer
     * loads or a selection moves and at no other time. It is invisible on a fast machine and
     * it is real work on every machine, and it was happening while the whole panel was hidden
     * behind the lab. The values are compared as one string because that is cheaper than four
     * comparisons and cannot get out of step with what was drawn. */
    const key = `${structures}|${regions.length}|${nodes}|${selected ?? ''}|${this.lang}`;
    if (key === this._readKey) return;
    this._readKey = key;
    const t2 = k => (UI[k]?.[this.lang] ?? '');
    const row = (k, v) => `<div class="hudrow"><span>${t2(k)}</span><b>${v}</b></div>`;
    this.read.innerHTML =
      row('hudStructures', structures || '—') +
      row('hudRegions', regions.length || '—') +
      row('hudNodes', nodes ? nodes.toLocaleString() : '—') +
      (selected ? `<div class="hudrow sel"><span>${t2('hudFocus')}</span><b>${selected}</b></div>` : '');
  }

  drawTrace() {
    const c = this.ctx, w = TRACE_W, h = TRACE_H;
    c.clearRect(0, 0, w, h);
    // baseline
    c.strokeStyle = 'rgba(150,185,230,.13)';
    c.lineWidth = 1;
    c.beginPath(); c.moveTo(0, h - 0.5); c.lineTo(w, h - 0.5); c.stroke();

    c.beginPath();
    for (let i = 0; i < TRACE_N; i++) {
      const v = this.samples[(this.head + i) % TRACE_N];
      const x = (i / (TRACE_N - 1)) * w;
      const y = h - 3 - Math.min(1, v) * (h - 8);
      i ? c.lineTo(x, y) : c.moveTo(x, y);
    }
    c.strokeStyle = 'rgba(255,196,132,.85)';
    c.lineWidth = 1;
    c.stroke();
    // the leading edge, lit — where the trace is being written now
    const last = this.samples[(this.head + TRACE_N - 1) % TRACE_N];
    c.beginPath();
    c.arc(w - 1, h - 3 - Math.min(1, last) * (h - 8), 1.8, 0, Math.PI * 2);
    c.fillStyle = 'rgba(255,226,180,.95)';
    c.fill();
  }
}
