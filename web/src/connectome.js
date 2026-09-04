import { get, nameOf } from './structures.js';
import { UI } from './content/strings.js';

/**
 * The network drawn as a graph: one node per anatomical region, edges weighted by how many
 * axons run between them.
 *
 * The reference this was built against carries two of these — a "connectome" and a "region
 * topology". This is the honest version of both, and the honesty is in what it draws from:
 * `NeuralNet.regionGraph()` counts the buffers the picture is actually made of, so a node's
 * size is how many of its cells exist and an edge's weight is how many of its links exist.
 * Nothing here is a connectivity matrix and nothing is invented.
 *
 * **It is not a connectome, and the caption says so.** A real one comes from tractography on
 * diffusion imaging; this network's edges are nearest-neighbour links plus a small fraction of
 * long-range ones, which is a schematic of local connectivity and nothing more. What it does
 * show truthfully: which parcels are large, which lie near each other, and which ones the scan
 * or a selection is driving right now.
 *
 * **The layout is anatomy, not a force simulation.** Each node sits at its region's own
 * centroid, projected onto the sagittal plane, so a node is where that part of the cortex
 * actually is. A spring layout would have looked more like the reference and would have been
 * a picture of an algorithm rather than of a brain.
 */

const H = 250;                   // CSS pixels tall; the width is measured
const PAD = 16;
const R_MIN = 2.4, R_MAX = 9;

export class Connectome {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'conncanvas';
    this.ctx = this.canvas.getContext('2d');
    this.w = 0; this.dpr = 0;
    this.graph = null;
    this.laid = [];
    this.hover = -1;
    this.sig = null;
  }

  attach(host, onResize) {
    if (this.canvas.parentNode !== host) host.appendChild(this.canvas);
    this.onResize = onResize;
    if (!this.ro && typeof ResizeObserver !== 'undefined')
      this.ro = new ResizeObserver(() => { if (this.fit()) this.onResize?.(); });
    if (this.ro) { this.ro.disconnect(); this.ro.observe(host); }
    this.fit();
    this.sig = null;             // a rebuilt panel means an empty readout beside it
  }

  fit() {
    const w = Math.max(160, Math.round(this.canvas.parentNode?.clientWidth || 300));
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    if (w === this.w && dpr === this.dpr) return false;
    this.w = w; this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(H * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${H}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.sig = null;
    this.layout();
    return true;
  }

  /** Take the graph from the live network. Cheap, but only worth doing when it changes. */
  load(graph) {
    this.graph = graph;
    this.sig = null;
    this.layout();
  }

  /**
   * Place each region at its own centroid, projected onto the sagittal plane.
   *
   * `+Z` is anterior and `+Y` superior in this project's frame, so plotting z rightward and y
   * upward gives a left-facing lateral view — the same orientation the head view opens on, so
   * a reader who has been looking at the brain recognises the shape rather than having to
   * re-learn it from a layout.
   */
  layout() {
    this.laid = [];
    if (!this.graph?.nodes.length || !this.w) return;
    const ns = this.graph.nodes;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const n of ns) {
      x0 = Math.min(x0, n.z); x1 = Math.max(x1, n.z);
      y0 = Math.min(y0, n.y); y1 = Math.max(y1, n.y);
    }
    const sx = (x1 - x0) || 1, sy = (y1 - y0) || 1;
    // one scale for both axes, so the shape is the brain's proportions rather than stretched
    const s = Math.min((this.w - PAD * 2) / sx, (H - PAD * 2) / sy);
    const ox = (this.w - sx * s) / 2, oy = (H - sy * s) / 2;
    const maxC = Math.max(...ns.map(n => n.count), 1);
    this.laid = ns.map(n => ({
      ...n,
      px: ox + (n.z - x0) * s,
      py: H - (oy + (n.y - y0) * s),
      r: R_MIN + (R_MAX - R_MIN) * Math.sqrt(n.count / maxC),
    }));
    this.byRegion = new Map(this.laid.map(n => [n.region, n]));
  }

  /** The region under a pointer at these CSS pixels, or -1. */
  hit(x, y) {
    let best = -1, bd = 14 * 14;
    for (const n of this.laid) {
      const d = (n.px - x) ** 2 + (n.py - y) ** 2;
      if (d < bd) { bd = d; best = n.region; }
    }
    return best;
  }

  /**
   * @param selected the region the app has selected, or -1
   * @param act      region id -> 0..1, the same activity the shaders are given
   * @returns false when the frame it would draw is the one already on screen
   */
  draw(selected = -1, act = null, lang = 'en') {
    if (!this.w) this.fit();
    const c = this.ctx;
    const actSig = act ? [...act.keys()].sort().map(k => `${k}:${act.get(k).toFixed(2)}`).join() : '';
    const sig = `${this.laid.length}|${this.w}|${selected}|${this.hover}|${lang}|${actSig}`;
    if (sig === this.sig) return false;
    this.sig = sig;

    c.clearRect(0, 0, this.w, H);
    if (!this.laid.length) {
      c.fillStyle = 'rgba(150,185,230,.35)';
      c.font = '10px "Helvetica Neue", Helvetica, Arial, sans-serif';
      c.fillText(UI.connNone?.[lang] ?? '', PAD, H / 2);
      return true;
    }

    const maxW = Math.max(...this.graph.edges.map(e => e.w), 1);
    const lit = r => (this.hover === r || selected === r);
    for (const e of this.graph.edges) {
      const a = this.byRegion.get(e.a), b = this.byRegion.get(e.b);
      if (!a || !b) continue;
      const on = lit(e.a) || lit(e.b);
      // weight sets the width; the pair being touched sets whether it is lit at all
      c.strokeStyle = on ? 'rgba(191,233,255,.75)' : 'rgba(150,185,230,.16)';
      c.lineWidth = on ? 1.2 : 0.55 + (e.w / maxW) * 1.1;
      c.beginPath(); c.moveTo(a.px, a.py); c.lineTo(b.px, b.py); c.stroke();
    }

    for (const n of this.laid) {
      const rec = get(n.region);
      const col = rec?.color ?? '#FFC98A';
      const a = act?.get(n.region) ?? 0;
      const on = lit(n.region);
      c.beginPath(); c.arc(n.px, n.py, n.r + (on ? 2 : 0), 0, Math.PI * 2);
      c.fillStyle = col;
      c.globalAlpha = on ? 1 : 0.55 + a * 0.45;
      c.shadowColor = col; c.shadowBlur = on ? 10 : 3 + a * 9;
      c.fill();
      c.shadowBlur = 0; c.globalAlpha = 1;
      if (on) {
        c.strokeStyle = 'rgba(255,255,255,.85)'; c.lineWidth = 1;
        c.beginPath(); c.arc(n.px, n.py, n.r + 4.5, 0, Math.PI * 2); c.stroke();
      }
    }

    // the name of whichever node is being touched, on the plot, so the graph is readable alone
    const show = this.hover >= 0 ? this.hover : selected;
    const n = this.byRegion.get(show);
    if (n) {
      const label = nameOf(n.region, lang) ?? '';
      c.font = '11px "Helvetica Neue", Helvetica, Arial, sans-serif';
      const tw = c.measureText(label).width;
      const tx = Math.min(Math.max(PAD, n.px - tw / 2), this.w - PAD - tw);
      const ty = n.py - n.r - 9;
      c.fillStyle = 'rgba(6,11,20,.82)';
      c.fillRect(tx - 4, ty - 11, tw + 8, 15);
      c.fillStyle = '#E6ECF6';
      c.fillText(label, tx, ty);
    }
    return true;
  }
}
