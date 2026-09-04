import { MOTION, sample, BREATH, isAngle, coordLabel } from './content/motion.js';
import { EXERCISE } from './content/exercises.js';
import { EXERCISE_BRAIN, TIERS, claimsForRegion } from './content/evidence.js';
import { get, nameOf, registry } from './structures.js';
import { UI } from './content/strings.js';
import { HELP } from './content/help.js';
import { Connectome3D } from './connectome3d.js';
import { FRAME } from './frame.js';
import { REGION_INFO } from './regionData.js';
import { jointLabel } from './content/analysis.js';
import { NeuralNet } from './neuralNet.js';
/* How many cuts to enlarge. Imported rather than written down: the lab makes the canvases and
 * the strip fills whichever of them it is handed, so a number kept in two places would show a
 * row of empty boxes — or index past the row — the day the series changed length. */
import { SLICE_COUNT as SECT_BIG } from './sections.js';

/**
 * The lab screen: the network and the movement, off the stage and at full size.
 *
 * The panel beside the 3D view is three hundred pixels wide, which is enough for a readout and
 * not enough for a graph you want to read. This is the same data given room — one screen, six
 * panels, all of them drawn from what the application actually holds.
 *
 * **What is plotted here, and what is not.** The brief this was built against shows a
 * dashboard of a learner's weekly assessment scores. There are no learner scores in this
 * application, there is no way to obtain one, and inventing a series that looked like a
 * measurement would be the one thing this project must never ship. So the panels plot the
 * things that are real: the node and edge counts of the network that is on screen, each
 * region's own cell population, the joint angles a clip drives through its own range, the role
 * each muscle is given across the movement, and the distribution of evidence tiers across every
 * brain claim in the library. Each of those is either a measurement of this model or a figure
 * with a citation attached.
 *
 * Everything is a 2D canvas rather than SVG. Six panels of a few hundred elements each,
 * redrawn on hover, is the layout thrash the labels already made once.
 */

const PAD = 26;

/* One warm ramp for anything that is a quantity, and a cool accent for anything that is a
 * position or a playhead — the same division the rest of the instrument uses. */
/* Two ramps, because two charts sit one above the other and were both drawn in one of them.
 * "Joint angles through the movement" and "muscle role through the movement" share an x axis,
 * a shape and a playhead, so drawn in the same six oranges they read as one chart in two
 * halves and a reader has nothing but the legend to tell them apart. Muscles keep the warm
 * ramp — it is the colour activation is lit in everywhere else in this application, so the
 * chart and the picture agree. Joints get a cool one, which is also the colour the playhead
 * and the scan already use for "a position in the movement". */
const WARM = ['#FFC98A', '#F2A96A', '#E88C5A', '#C9784E', '#A96444', '#8B523A'];
const JOINTC = ['#8FD8FF', '#6FBCEA', '#5AA0D6', '#4E86BE', '#4A6FA0', '#42597F'];
const COOL = '#9FD4FF';
const PLAY = '#FFD9A0';   // the playhead on the cool chart, so it is not one of the traces
const GRID = 'rgba(150,185,230,.08)';
const RULE = 'rgba(150,185,230,.16)';
const INK = '#E6ECF6';
const DIM = '#93A1B8';
const DIM2 = '#5F6C82';

/* The region map's name lanes: text size, the gap between the silhouette and the text, and
 * the row pitch a packed lane uses. */
/* The axon shader's own band rate, so the trace's traversal time is the number the picture is
 * animating with rather than a second one written down beside it. */
const BAND_RATE = NeuralNet.BAND_RATE;

const NAME_PX = 10;
const LEAD = 16;
const ROW_PX = 15;

/* The 3D connectome's height. It is the screen's hero panel and it is full width, so at 380
 * the brain was a small shape in the middle of a very wide box — the fit is by height on a
 * 3.7:1 stage. Kept here rather than only in the stylesheet because `resize` has to agree with
 * it: a drawing buffer that does not match its box squashes the picture and misses the ray.*/
const C3D_H = 520;

/* The three role names, singular — the panel headings read wrong on one muscle. */
const ROLE_TAG = { prime: 'roleTagPrime', synergists: 'roleTagSyn', stabilisers: 'roleTagStab' };

/* How many times a second the lab's body panel re-renders the scene. See `drawBody`: each one
 * is a full scene render plus a readback, and a readback is a pipeline stall. */
const BODY_FPS = 6;
/* How much of the frame the body panel may not have. At 3 it costs at most a quarter of wall
 * time on a machine that finds it expensive, and nothing at all on one that does not — five
 * milliseconds of stand-down is well inside the 167 `BODY_FPS` already asks for. */
const BODY_SHARE = 3;
/* How long each structure of the tour is held. Long enough to read the name, turn it a little
 * and look at where the ring is; short enough that a list of twenty is a minute rather than a
 * sitting. Any touch of the panel stops it. */
const TOUR_MS = 4200;
const JOINT_SPAN = 0.05;   // body heights, half-extent of the box the joint view is fitted to
/* And the cell key's band. It is a 2D canvas rather than a readback so it is far cheaper, but
 * twelve is already smooth for a dot sliding along a line and it halves the work. */
const KEY_FPS = 12;


/** A canvas that keeps its backing store equal to the box it is shown in. */
class Panel {
  constructor(host, h) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'labcv';
    this.h = h;
    host.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.w = 0; this.dpr = 0;
  }
  fit() {
    const w = Math.max(160, Math.round(this.canvas.parentNode?.clientWidth || 400));
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    if (w === this.w && dpr === this.dpr) return false;
    this.w = w; this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${this.h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return true;
  }
  clear() {
    this.fit();
    this.ctx.clearRect(0, 0, this.w, this.h);
    return this.ctx;
  }
}

/** A faint rule grid, and nothing that could be mistaken for data. */
function grid(c, x0, y0, x1, y1, rows = 4, cols = 6) {
  c.lineWidth = 1;
  for (let i = 0; i <= rows; i++) {
    const y = Math.round(y0 + ((y1 - y0) * i) / rows) + 0.5;
    c.strokeStyle = i === 0 || i === rows ? RULE : GRID;
    c.beginPath(); c.moveTo(x0, y); c.lineTo(x1, y); c.stroke();
  }
  c.strokeStyle = GRID;
  for (let i = 1; i < cols; i++) {
    const x = Math.round(x0 + ((x1 - x0) * i) / cols) + 0.5;
    c.beginPath(); c.moveTo(x, y0); c.lineTo(x, y1); c.stroke();
  }
}

/** A luminous polyline: a hairline core with its own glow, never a thick stroke. */
function trace(c, pts, colour, { width = 1.4, glow = 7, alpha = 1 } = {}) {
  if (pts.length < 2) return;
  c.beginPath();
  pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
  c.strokeStyle = colour;
  c.shadowColor = colour;
  c.shadowBlur = glow;
  c.globalAlpha = alpha;
  c.lineWidth = width;
  c.lineJoin = 'round';
  c.stroke();
  c.shadowBlur = 0;
  c.globalAlpha = 1;
}

function label(c, text, x, y, { colour = DIM2, size = 9, caps = true, align = 'left' } = {}) {
  c.fillStyle = colour;
  c.font = `${size}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
  c.textAlign = align;
  c.fillText(caps ? text.toUpperCase() : text, x, y);
  c.textAlign = 'left';
}

export class Lab {
  /**
   * @param host the screen's own element
   * @param ctx  getters onto the live application: the region graph, what is selected, what
   *             the clip is doing. Getters rather than values, because the lab is built once
   *             and the network arrives later.
   */
  constructor(host, ctx) {
    this.host = host;
    this.ctx = ctx;
    this.hover = { radial: -1, region: -1, joint: -1 };
    this.open = false;
    this.built = false;
  }

  build() {
    if (this.built) return;
    this.built = true;
    const T = k => UI[k]?.[this.ctx.lang()] ?? k;
    this.host.innerHTML = `
      <div class="labtop">
        <div>
          <h2 id="labTitle"></h2>
          <p class="labsub" id="labSub"></p>
        </div>
        <nav class="labtabs">
          <button id="labTabCharts" aria-selected="true"></button>
          <button id="labTabRef"></button>
        </nav>
        <button class="labclose" id="labClose">✕</button>
      </div>
      <div class="labtiles" id="labTiles"></div>
      <div class="labgrid" id="labCharts">
        <!-- What the chosen exercise works, in four columns: the muscles it asks for, the
             joints it travels through, the nerves that supply those muscles, and the brain
             regions its own claims are about. Four sources, four different kinds of warrant,
             and each column says which one it is standing on. -->
        <section class="labpanel labwide"><h3 id="labH11"></h3>
          <div class="anal" id="labAnal"></div><p class="labnote" id="labN11"></p></section>
        <!-- One structure of that list, in 3D: what it looks like on its own, and where it
             sits in the whole figure. Two questions that were being asked as one — "I need
             the 3D look of this external oblique alone, and also where it is located in the
             body" — and two renders of the scene that is already loaded, so neither is a
             second copy that could disagree with the first. -->
        <section class="labpanel labwide"><h3 id="labH13"></h3>
          <!-- The worked structures in order, stepped through on their own. "Show the names of
               the muscles that are working the most to the least and show the 3D version of
               each one by one" — so the list is the control and it plays by itself, and any
               touch of the panel pauses it rather than fighting the reader for it. -->
          <div class="dettour">
            <div class="detctl">
              <button id="detPrev" class="detbtn">‹</button>
              <button id="detPlay" class="detbtn"></button>
              <button id="detNext" class="detbtn">›</button>
            </div>
            <div class="detchips" id="detChips"></div>
          </div>
          <p class="dethint" id="labDetHint"></p>
          <div class="detpair">
            <figure class="detfig">
              <div class="labhost" id="labP13a"></div>
              <figcaption id="labC13a"></figcaption>
            </figure>
            <figure class="detfig">
              <!-- The ring is positioned against the canvas's own box, not the figure's: the
                   figure includes a caption, so a percentage measured against it would put the
                   mark a caption's height off the structure it is pointing at. -->
              <div class="detbox">
                <div class="labhost" id="labP13b"></div>
                <i class="detring" id="labRing13" hidden></i>
              </div>
              <figcaption id="labC13b"></figcaption>
            </figure>
          </div>
          <div class="fibread" id="labF13"></div><p class="labnote" id="labN13"></p></section>
        <section class="labpanel labwide"><h3 id="labH1"></h3>
          <div class="labhost c3dhost" id="labP1">
            <div class="c3dread" id="c3dRead"></div>
            <div class="c3dhint" id="c3dHint"></div>
          </div><p class="labnote" id="labN1"></p></section>
        <section class="labpanel"><h3 id="labH2"></h3>
          <div class="labhost" id="labP2"></div><p class="labnote" id="labN2"></p></section>
        <section class="labpanel"><h3 id="labH8"></h3>
          <div class="sectplanes" id="labFibViews"></div>
          <div class="labhost" id="labP8"></div>
          <div class="fibread" id="labF8"></div><p class="labnote" id="labN8"></p></section>
        <!-- Only the chosen region's cells, with no brain behind them, laid out big enough
             to pick one by eye. The whole-brain plot is where a region is found; this is
             where a cell inside it is chosen. -->
        <section class="labpanel"><h3 id="labH10"></h3>
          <div class="labhost" id="labP10"></div>
          <div class="fibread" id="labF10"></div><p class="labnote" id="labN10"></p></section>
        <!-- Beside it, the same population counted: which regions hold how many cells. The
             two answer each other — one region opened up, and where it sits among the rest. -->
        <section class="labpanel"><h3 id="labH7"></h3>
          <div class="labhost" id="labP7"></div><p class="labnote" id="labN7"></p></section>
        <!-- The trace sits directly under the plot it is driven from: "click a cell here,
             read it there" is not a sentence a reader should have to scroll to test. -->
        <section class="labpanel labwide"><h3 id="labH6"></h3>
          <div class="labhost" id="labP6"></div><p class="labnote" id="labN6"></p></section>
        <!-- The sections, at a size you can read them at, with what each part of the picture
             means spelled out beside it. The strip on the stage is 136 px a slice, which is
             enough to see that a cut changed and not enough to see what it cut. -->
        <section class="labpanel labwide"><h3 id="labH9"></h3>
          <div class="sectplanes" id="labSectPlanes"></div>
          <!-- The hovered name lives beside the row, not inside it: the row is rebuilt from
               its child count and anything extra in it would be counted as a figure and
               wiped on the next draw. -->
          <div class="sectbigwrap">
            <div class="sectbig" id="labSectRow"></div>
            <i class="sectname" id="labSectName" hidden></i>
          </div>
          <div class="sectlegend" id="labSectKey"></div>
          <div class="sectwhere" id="labSectWhere"></div>
          <div class="sectwhat" id="labSectWhat"></div>
          <p class="labnote" id="labN9"></p></section>
        <section class="labpanel"><h3 id="labH3"></h3>
          <div class="labhost" id="labP3"></div><p class="labnote" id="labN3"></p></section>
        <!-- The body and the chart of what it is doing, side by side in one panel. The body
             is not a second copy: renderStageInto draws the live scene, so it is the same
             geometry at the same instant of the same clip, already lit by the same activation
             the chart is plotting. Two pictures of one thing, which is the only way they
             cannot disagree. -->
        <section class="labpanel labwide"><h3 id="labH4"></h3>
          <div class="labpair">
            <div class="labhost" id="labP12"></div>
            <div class="labhost" id="labP4"></div>
          </div>
          <div class="fibread" id="labF12"></div><p class="labnote" id="labN4"></p></section>
        <section class="labpanel labwide"><h3 id="labH5"></h3>
          <div class="evsum" id="labP5"></div>
          <div class="evtable" id="labEv"></div><p class="labnote" id="labN5"></p></section>
      </div>
      <!-- The reading. Everything long-form lives here rather than in the console beside the
           picture: a reader who came to look at anatomy should not have to scroll past an
           essay to reach a control, and a reader who came to read wants a page rather than a
           three-hundred-pixel column. -->
      <div class="labref" id="labRef" hidden></div>`;
    void T;
    /* The connectome is a real scene with its own renderer and its own camera, not a canvas
     * this class draws into — see `connectome3d.js`. Everything else here is 2D. */
    this.c3d = new Connectome3D();
    this.host.querySelector('#labP1').appendChild(this.c3d.canvas);
    this.p2 = new Panel(this.host.querySelector('#labP2'), 460);   // region map
    this.p3 = new Panel(this.host.querySelector('#labP3'), 300);   // joint angles
    this.p4 = new Panel(this.host.querySelector('#labP4'), 300);   // muscle role
    this.p6 = new Panel(this.host.querySelector('#labP6'), 330);   // one cell, traced
    this.p7 = new Panel(this.host.querySelector('#labP7'), 300);   // cells by region
    this.p8 = new Panel(this.host.querySelector('#labP8'), 460);   // every cell, every fibre
    this.p10 = new Panel(this.host.querySelector('#labP10'), 420);  // one region's cells
    this.p12 = new Panel(this.host.querySelector('#labP12'), 300);  // the live body
    this.p13a = new Panel(this.host.querySelector('#labP13a'), 340); // one structure, alone
    this.p13b = new Panel(this.host.querySelector('#labP13b'), 340); // and where it sits
    this.host.querySelector('#labClose').onclick = () => this.ctx.close();
    for (const [id, view] of [['labTabCharts', 'charts'], ['labTabRef', 'reference']])
      this.host.querySelector(`#${id}`).onclick = () => this.setView(view);
    this.view = 'charts';

    /* Hover on the two graphs. Both are hit-tested against the laid-out points, which are
     * kept from the last draw, so the test is against what is on screen rather than against a
     * recomputed layout that might have moved. */
    /* Hover names a region, click selects it. `pointermove` is also what OrbitControls is
     * listening to, so this must not swallow the event — it reads and returns. */
    this.c3d.canvas.addEventListener('pointermove', e => {
      const r = this.c3d.canvas.getBoundingClientRect();
      const h = this.c3d.regionAt(e.clientX - r.left, e.clientY - r.top);
      if (h === this.c3d.hover) return;
      this.c3d.hover = h ?? -1;
      this.c3d.canvas.style.cursor = h != null ? 'pointer' : 'grab';
      this.readout3d();
    });
    this.c3d.canvas.addEventListener('pointerleave', () => {
      this.c3d.hover = -1; this.readout3d();
    });
    /* A click, not a drag: OrbitControls owns dragging, and selecting a region every time
     * someone finished turning the view would make the panel unusable. */
    let down = null;
    this.p7.canvas.onclick = e => {
      const r = (this.rosterRows ?? []).find(q =>
        e.offsetX >= q.x && e.offsetX <= q.x + q.w && e.offsetY >= q.y && e.offsetY <= q.y + q.h);
      if (r) this.ctx.select(r.region);
    };
    this.p7.canvas.style.cursor = 'pointer';
    this.c3d.canvas.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; });
    this.c3d.canvas.addEventListener('pointerup', e => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
      const r = this.c3d.canvas.getBoundingClientRect();
      const h = this.c3d.regionAt(e.clientX - r.left, e.clientY - r.top);
      if (h != null) this.ctx.select(h);
    });
    this.p2.canvas.onpointermove = e => {
      const h = nearest(this.regionPts, e.offsetX, e.offsetY, 16);
      if (h === this.hover.region) return;
      this.hover.region = h;
      this.p2.canvas.style.cursor = h >= 0 ? 'pointer' : '';
      this.draw();
    };
    this.p2.canvas.onpointerleave = () => { this.hover.region = -1; this.draw(); };
    this.p2.canvas.onclick = () => {
      const n = this.regionPts[this.hover.region];
      if (n) this.ctx.select(n.region);
    };

    /* The fibre chart is where a cell is picked. Clicking one traces it — the panel below
     * follows every fibre out of it — and also selects its region, so the 3D scene, the map
     * and the roster all move to the same place. Clicking empty page clears the trace rather
     * than leaving a readout describing a cell nobody is looking at. */
    let fdrag = null, fmoved = 0;
    this.p8.canvas.onpointerdown = e => {
      fdrag = { x: e.offsetX, y: e.offsetY, px: this.fibPan?.x ?? 0, py: this.fibPan?.y ?? 0 };
      fmoved = 0;
      this.p8.canvas.setPointerCapture?.(e.pointerId);
    };
    this.p8.canvas.onpointermove = e => {
      if (fdrag) {
        /* Panning. The threshold is what keeps a drag from also being a click: without it,
         * every attempt to move the view picked whatever cell the pointer went down on. */
        const dx = e.offsetX - fdrag.x, dy = e.offsetY - fdrag.y;
        fmoved = Math.max(fmoved, Math.hypot(dx, dy));
        this.fibPan = { x: fdrag.px + dx, y: fdrag.py + dy };
        this.p8.canvas.style.cursor = 'grabbing';
        this.drawFibres(this.ctx.lang());
        return;
      }
      const i = this.cellAtFibre(e.offsetX, e.offsetY);
      this.p8.canvas.style.cursor = i >= 0 ? 'pointer' : 'grab';
      if (i === this.fibHover) return;
      this.fibHover = i;
      this.drawFibres(this.ctx.lang());
    };
    const endDrag = e => {
      if (!fdrag) return;
      const moved = fmoved;
      fdrag = null;
      this.p8.canvas.releasePointerCapture?.(e.pointerId);
      this.p8.canvas.style.cursor = 'grab';
      if (moved > 4) return;                       // a drag, not a click
      const i = this.cellAtFibre(e.offsetX, e.offsetY);
      this.tracedCell = i >= 0 ? i : -1;
      this._traceAuto = false;
      if (i >= 0) {
        const reg = this.ctx.cells2?.()?.region(i) ?? -1;
        if (reg > 0) { this.ctx.select(reg); return; }   // select() redraws everything
      }
      this.draw();
    };
    this.p8.canvas.onpointerup = endDrag;
    this.p8.canvas.onpointerleave = () => {
      if (this.fibHover === -1) return;
      this.fibHover = -1;
      this.drawFibres(this.ctx.lang());
    };
    /* Both structure views turn. A render of one muscle from one fixed angle is a picture of a
     * shape you cannot read — half of what a muscle *is* is which way its fibres run and what
     * it wraps around, and neither survives a single vantage. Dragging swings the eye about
     * the fitted target rather than changing the fit, so the framing does not jump as you
     * turn; the wheel moves it in and out. Any of it pauses the tour: a reader who has taken
     * hold of the picture is not asking to be moved on in four seconds. */
    for (const [panel, which] of [[this.p13a, 'a'], [this.p13b, 'b']]) {
      const cv = panel?.canvas;
      if (!cv) continue;
      cv.style.cursor = 'grab';
      let drag = null;
      cv.onpointerdown = e => {
        drag = { x: e.clientX, y: e.clientY, o: { ...this.orbit(which) } };
        cv.setPointerCapture?.(e.pointerId);
        cv.style.cursor = 'grabbing';
        this.pauseTour();
      };
      cv.onpointermove = e => {
        if (!drag) return;
        const o = this.orbit(which);
        o.yaw = drag.o.yaw - (e.clientX - drag.x) * 0.008;
        o.pitch = drag.o.pitch + (e.clientY - drag.y) * 0.006;
        this.drawDetail(this.ctx.lang(), true);
      };
      const end = e => {
        if (!drag) return;
        drag = null;
        cv.releasePointerCapture?.(e.pointerId);
        cv.style.cursor = 'grab';
      };
      cv.onpointerup = end;
      cv.onpointercancel = end;
      cv.onwheel = e => {
        e.preventDefault();
        const o = this.orbit(which);
        o.zoom = Math.max(0.25, Math.min(6, o.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
        this.pauseTour();
        this.drawDetail(this.ctx.lang(), true);
      };
    }
    const ctl = (id, fn) => {
      const b = this.host.querySelector(id);
      if (b) b.onclick = fn;
    };
    ctl('#detPrev', () => this.stepTour(-1, true));
    ctl('#detNext', () => this.stepTour(1, true));
    ctl('#detPlay', () => {
      this.tourPlaying = !this.tourPlaying;
      this.tourAt = performance.now();
      this.drawDetail(this.ctx.lang());
    });

    /* The region panel is a picker and nothing else: hover names, click traces. No pan and no
     * zoom, because it is already framed on exactly the cells it is about. */
    this.p10.canvas.onpointermove = e => {
      const i = nearest(this.rcPts, e.offsetX, e.offsetY, 14);
      const id = i >= 0 ? this.rcPts[i].i : -1;
      this.p10.canvas.style.cursor = id >= 0 ? 'pointer' : '';
      if (id === this.rcHover) return;
      this.rcHover = id;
      this.drawRegionCells(this.ctx.lang());
    };
    this.p10.canvas.onpointerleave = () => {
      if (this.rcHover === -1 || this.rcHover == null) return;
      this.rcHover = -1;
      this.drawRegionCells(this.ctx.lang());
    };
    /* Hovering a fibre row lights that fibre in the plot beside it, and hovering the target
     * cell in the plot lights its row. One object, two places, so a reader does not have to
     * count down a list to find which line a row is about. */
    this.p6.canvas.onpointermove = e => {
      const pts = this.tracePts ?? [];
      let hit = -1;
      for (const q of pts) {
        if (q.row) {
          const [rx, ry, rw, rh] = q.row;
          if (e.offsetX >= rx && e.offsetX <= rx + rw && e.offsetY >= ry && e.offsetY <= ry + rh)
            { hit = q.i; break; }
        } else if (q.r && Math.hypot(q.x - e.offsetX, q.y - e.offsetY) <= q.r) { hit = q.i; break; }
      }
      this.p6.canvas.style.cursor = hit >= 0 ? 'pointer' : '';
      if (hit === this.traceHover) return;
      this.traceHover = hit;
      this.drawCellKey(this.ctx.lang());
    };
    this.p6.canvas.onpointerleave = () => {
      if ((this.traceHover ?? -1) === -1) return;
      this.traceHover = -1;
      this.drawCellKey(this.ctx.lang());
    };
    /* Clicking a target follows it: the trace moves to that cell, which is what "track where
     * it goes" means once you have looked at where the first one went. */
    this.p6.canvas.onclick = e => {
      const pts = this.tracePts ?? [];
      for (const q of pts) {
        const inRow = q.row && e.offsetX >= q.row[0] && e.offsetX <= q.row[0] + q.row[2]
                            && e.offsetY >= q.row[1] && e.offsetY <= q.row[1] + q.row[3];
        const inDot = q.r && Math.hypot(q.x - e.offsetX, q.y - e.offsetY) <= q.r;
        if (!inRow && !inDot) continue;
        this.tracedCell = q.i;
        this._traceAuto = false;
        this.traceHover = -1;
        const reg = this.ctx.cells2?.()?.region(q.i) ?? -1;
        if (reg > 0) { this.ctx.select(reg); return; }
        this.draw();
        return;
      }
    };

    this.p10.canvas.onclick = e => {
      const i = nearest(this.rcPts, e.offsetX, e.offsetY, 14);
      if (i < 0) return;
      this.tracedCell = this.rcPts[i].i;
      this._traceAuto = false;
      this.draw();
    };

    /* Zoom about the pointer, not about the middle: zooming to the centre when the thing you
     * want is at the edge walks it off the plot, which is the whole reason zoom felt useless. */
    this.p8.canvas.onwheel = e => {
      e.preventDefault();
      const F = this.fibProj;
      if (!F) return;
      const before = this.fibZoom ?? 1;
      const after = Math.min(24, Math.max(1, before * Math.exp(-e.deltaY * 0.0016)));
      if (after === before) return;
      const k = after / before;

      /* **Pin the hovered cell, not the pixel.** A pixel is `b + (u − c)·s` about the plot's own
       * centre `b`, so scaling `s` by k and putting the same pixel back means `b' = p − k·(p − b)`,
       * and the pan is `b` measured from the box centre — which is what `drawFibres` adds it to.
       * Using the canvas centre instead is off by the axis gutter and makes a zoom crawl sideways.
       *
       * Anchoring on the raw pointer is correct and still wrong for this panel: the cell the
       * reader is pointing at was picked within a few pixels of the pointer rather than exactly
       * under it, and that gap is in *data* units, so it multiplies. Eight wheel notches later
       * the cell they were aiming at is off the screen and the readout has gone blank, which is
       * the opposite of "let me look closer at that one". Anchoring on the cell keeps the gap at
       * the pixels it started as, so the cell stays put and stays picked. */
      const cells = this.ctx.cells2?.();
      let ax = e.offsetX, ay = e.offsetY;
      if (this.fibHover >= 0 && cells?.count && this.fibHover < cells.count) {
        const p = cells.pos(this.fibHover);
        ax = F.PX(F.P.u(p)); ay = F.Y(F.P.v(p));
      }
      this.fibPan = { x: ax - k * (ax - F.bx) - F.baseX,
                      y: ay - k * (ay - F.by) - F.baseY };
      this.fibZoom = after;
      this.drawFibres(this.ctx.lang());

      /* No pointermove follows a wheel, so the hover has to be recomputed here or the ring and
       * the name stay on whatever used to be under the pointer — a readout describing something
       * the reader is not pointing at. The second draw is free: the same cache key guards it,
       * so it does nothing unless the cell actually changed. */
      const now = this.cellAtFibre(e.offsetX, e.offsetY);
      if (now !== this.fibHover) {
        this.fibHover = now;
        this.drawFibres(this.ctx.lang());
      }
    };
  }

  relabel() {
    if (!this.built) return;
    const lang = this.ctx.lang();
    const T = k => UI[k]?.[lang] ?? k;
    const set = (id, v) => { const el = this.host.querySelector(id); if (el) el.textContent = v; };
    set('#labTitle', T('labTitle'));
    set('#labSub', T('labSub'));

    /* Every panel explained the way every control is explained: what it does, then what it is,
     * in whichever register the reader chose. A single paragraph per chart was what shipped
     * first and it was not enough — "explain those charts in plain and technical knowledge
     * because i didn't understand what it means" is a report that the caption was written for
     * someone who already knew what a chord diagram was. Built as nodes rather than as a
     * string, so nothing here can go near a parser. */
    const reg = this.ctx.register();
    const explain = (host, key) => {
      const el = this.host.querySelector(host);
      const h = HELP[key];
      if (!el) return;
      el.textContent = '';
      if (!h) return;
      const add = (labelKey, text) => {
        if (!text) return;
        if (reg === 'both') {
          const b = document.createElement('b');
          b.textContent = T(labelKey);
          el.appendChild(b);
        }
        el.appendChild(document.createTextNode(text));
      };
      if (reg !== 'clinical') add('helpPlain', h.plain?.[lang]);
      if (reg !== 'plain') add('helpTech', h.tech?.[lang]);
    };
    const tab = (id, k) => {
      const el = this.host.querySelector(id);
      if (el) el.textContent = T(k);
    };
    tab('#labTabCharts', 'labTabCharts');
    tab('#labTabRef', 'labTabRef');
    for (const [h, n, title, key] of [
      ['#labH1', '#labN1', 'labConnectome', 'labConnectome'],
      ['#labH2', '#labN2', 'labRegionMap', 'labRegionMap'],
      ['#labH3', '#labN3', 'labJoints', 'labJoints'],
      ['#labH4', '#labN4', 'labMuscles', 'labMuscles'],
      ['#labH5', '#labN5', 'labEvidence', 'labEvidence'],
      ['#labH6', '#labN6', 'labCellKey', 'labCellKey'],
      ['#labH7', '#labN7', 'labRoster', 'labRoster'],
      ['#labH8', '#labN8', 'labFibres', 'labFibres'],
      ['#labH9', '#labN9', 'labSections', 'labSectionsBig'],
      ['#labH10', '#labN10', 'labRegionCells', 'labRegionCells'],
      ['#labH11', '#labN11', 'labAnalysis', 'labAnalysis'],
      ['#labH13', '#labN13', 'labDetail', 'labDetail'],
    ]) { set(h, T(title)); explain(n, key); }
  }

  /** Charts or reading. Two different jobs and two different layouts. */
  setView(view) {
    this.view = view === 'reference' ? 'reference' : 'charts';
    const charts = this.view === 'charts';
    this.host.querySelector('#labCharts').hidden = !charts;
    this.host.querySelector('#labTiles').hidden = !charts;
    this.host.querySelector('#labRef').hidden = charts;
    this.host.querySelector('#labTabCharts').setAttribute('aria-selected', charts);
    this.host.querySelector('#labTabRef').setAttribute('aria-selected', !charts);
    this.host.scrollTo(0, 0);
    if (charts) this.draw(); else this.drawReference();
  }

  show(on, view = null) {
    this.open = !!on;
    this.host.hidden = !this.open;
    if (!this.open) return;
    this.build();
    this.relabel();
    this.setView(view ?? this.view ?? 'charts');
  }

  /**
   * The reference: every control explained both ways, and where every number comes from.
   *
   * This is the page the About tab used to be, given a page's width. It is built from the same
   * `HELP` table the console's own inline notes come from, so a control cannot be documented
   * here and undocumented there — there is one description of each thing and two places it is
   * shown at two lengths.
   */
  drawReference() {
    const lang = this.ctx.lang();
    const T = k => UI[k]?.[lang] ?? k;
    const host = this.host.querySelector('#labRef');
    const ref = this.ctx.reference?.() ?? { groups: [], sources: [] };
    host.textContent = '';

    const head = document.createElement('div');
    head.className = 'refhead';
    const h = document.createElement('h3'); h.textContent = T('readingHead');
    const p = document.createElement('p'); p.textContent = T('readingIntro');
    head.append(h, p);
    host.appendChild(head);

    const grid = document.createElement('div');
    grid.className = 'refgrid';
    for (const g of ref.groups) {
      const sec = document.createElement('section');
      sec.className = 'refsec';
      const sh = document.createElement('h4'); sh.textContent = g.title;
      sec.appendChild(sh);
      for (const item of g.items) {
        const card = document.createElement('div');
        card.className = 'refcard';
        const b = document.createElement('b'); b.textContent = item.name;
        card.appendChild(b);
        for (const [labelKey, text] of [['helpPlain', item.plain], ['helpTech', item.tech]]) {
          if (!text) continue;
          const t = document.createElement('em'); t.textContent = T(labelKey);
          const d = document.createElement('p'); d.textContent = text;
          card.append(t, d);
        }
        sec.appendChild(card);
      }
      grid.appendChild(sec);
    }
    host.appendChild(grid);

    if (ref.sources.length) {
      const sh = document.createElement('h3');
      sh.textContent = T('sources');
      sh.className = 'refsources';
      host.appendChild(sh);
      const sg = document.createElement('div');
      sg.className = 'refgrid';
      for (const src of ref.sources) {
        const sec = document.createElement('section');
        sec.className = 'refsec';
        const t = document.createElement('h4'); t.textContent = src.title;
        sec.appendChild(t);
        for (const line of src.lines) {
          const d = document.createElement('p');
          d.className = 'refline';
          d.textContent = line;
          sec.appendChild(d);
        }
        sg.appendChild(sec);
      }
      host.appendChild(sg);
    }
  }

  /**
   * Run `fn` if the renderer can be borrowed right now, and price what it cost.
   *
   * Three panels on this screen render the whole scene and read it back — the body, and the two
   * halves of the structure pair — and each is the most expensive thing here after the others.
   * They share one budget rather than each holding their own, because three separate quarters
   * of wall time is three quarters of it. After any of them runs, all three stand down for
   * `BODY_SHARE` times what that one took, so together they can never be more than one part in
   * `1 + BODY_SHARE` and on a slow machine they take turns instead of competing.
   *
   * The caller's stamp is set inside `fn`, so a panel that was refused this frame still has a
   * stale stamp and asks again on the next one rather than skipping the update entirely.
   *
   * `force` is for the two cases where waiting is worse than paying: a panel that has never
   * drawn anything — an empty box is not a slower picture, it is no picture — and a drag in
   * progress, where the budget would make the one thing the reader has hold of lag behind
   * their pointer.
   */
  borrowScene(fn, force = false) {
    if (!force && performance.now() < (this._sceneIdle ?? 0)) return false;
    const t0 = performance.now();
    fn();
    this._sceneIdle = performance.now() + (performance.now() - t0) * BODY_SHARE;
    return true;
  }

  /** The connectome animates, so it is driven from the app's own loop while the lab is open. */
  tick(t) {
    if (!this.open || !this.built || this.view !== 'charts') return;
    const host = this.host.querySelector('#labP1');
    if (host) this.c3d.resize(host.clientWidth, C3D_H);
    this.c3d.tick(t);
    /* The cell key animates, so it is redrawn — but only when its band would land somewhere
     * new, which at this size is a few times a second rather than sixty. */
    const step = Math.round(t * KEY_FPS);
    if (step !== this._keyStep) { this._keyStep = step; this.clock = t; this.drawCellKey(this.ctx.lang()); }
    /* The body follows the clip while it plays. Its own stamp is quantised on the clip time,
     * so a paused lab costs nothing and a playing one re-renders a few times a second rather
     * than sixty — a full scene render plus a readback is not a per-frame operation. */
    this.drawBody(this.ctx.lang());
    /* The tour walks the list on its own. Driven from the lab's tick rather than a timer, so it
     * cannot keep stepping in a closed lab or a background tab, and so a slow machine steps
     * slowly instead of queueing renders it will never catch up on. */
    if (this.tourPlaying && (this._tour?.length ?? 0) > 1 &&
        performance.now() - (this.tourAt ?? 0) > TOUR_MS) {
      this.tourAt = performance.now();
      this.applyTour((this.tourI ?? 0) + 1);
    }
    /* The pair follows the clip for the same reason the body does: it is a picture of where a
     * structure *is*, and where it is changes with the pose. They share one budget, so this
     * costs the frame nothing it was not already paying. */
    this.drawDetail(this.ctx.lang());
  }

  draw() {
    if (!this.open || !this.built || this.view !== 'charts') return;
    const lang = this.ctx.lang();
    const g = this.ctx.graph();
    this.tiles(g);
    this.drawRadial(g, lang);
    this.drawRegionMap(g, lang);
    this.drawJoints(lang);
    this.drawMuscles(lang);
    this.drawEvidence(lang);
    this.drawCellKey(lang);
    this.drawRoster(lang);
    this.drawFibres(lang);
    this.drawRegionCells(lang);
    this.drawAnalysis(lang);
    this.drawBody(lang);
    this.drawDetail(lang);
    this.drawSections(lang);
  }

  /* ------------------------------------------------------- the cuts, explained
   * The five sections at four times the area, with what every part of the picture means
   * written out beside them.
   *
   * This exists because the same question came back five times: "I understand that the scan
   * plane cuts it and shows those parts, but so what? What are those cut parts? It shows black
   * dots — what are those?" The strip beside the stage names the structures a cut passes
   * through, and that was not the question. The question is what a *pixel* in one of those
   * pictures is: why some of it is bright, why most of it is black, and what a reader is meant
   * to take away from having looked. So the answer is on the screen, next to the thing it is
   * about, in the register the reader chose — rather than in a help panel they would have to
   * know to open.
   *
   * The renders are the application's own: `drawSections` in `main.js` hands these canvases to
   * the same `SectionStrip` the stage uses, so what is enlarged here is the picture that is
   * down there, not a second one made for this panel. Clicking a slice moves the real plane.
   */
  drawSections(lang) {
    const T = k => UI[k]?.[lang] ?? k;
    const row = this.host.querySelector('#labSectRow');
    const planes = this.host.querySelector('#labSectPlanes');
    const what = this.host.querySelector('#labSectWhat');
    if (!row || !planes || !what) return;

    const plane = this.sectPlane ?? this.ctx.scanPlane?.() ?? 'axial';

    /* One button per plane. All three, always: a reader who has only ever seen the axial cut
     * has no way to discover that the same control produces two other series, and the shape of
     * the brain in each is most of what a section teaches. */
    planes.textContent = '';
    for (const key of ['sagittal', 'coronal', 'axial']) {
      const b = document.createElement('button');
      b.className = 'sectplane';
      b.textContent = T(`scan${key[0].toUpperCase()}${key.slice(1)}`);
      b.setAttribute('aria-pressed', String(key === plane));
      b.onclick = () => { this.sectPlane = key; this.drawSections(this.ctx.lang()); };
      planes.appendChild(b);
    }

    /* The canvases are made once and kept: they hold GPU-blitted pixels, and rebuilding the
     * row on every draw would throw away the render and leave a frame of empty boxes. */
    if (row.childElementCount !== SECT_BIG) {
      row.textContent = '';
      this._sectDrawn = null;      // new canvases are blank until something renders into them
      for (let i = 0; i < SECT_BIG; i++) {
        const fig = document.createElement('button');
        fig.className = 'sectfig';
        const cv = document.createElement('canvas');
        cv.width = 320; cv.height = 320;
        const cap = document.createElement('span');
        fig.append(cv, cap);
        row.appendChild(fig);
      }
    }
    /* Rendered only when the plane changes, never on a redraw.
     *
     * `draw()` runs on every pointer move over the region map, and this is five renders of the
     * whole brain plus five 320-pixel readbacks — two megabytes off the GPU per mouse move,
     * mid-frame, through the renderer the live scene is using. The pictures are identical
     * between those calls: the sections live in the brain's own frame, so they do not change
     * when the camera moves, when the head is posed, or while a clip plays. Same rule as
     * `refreshSections` on the stage, which learned it first.
     *
     * The captions and the key are rebuilt every time regardless, because those change with
     * the language and cost nothing. */
    const figs = [...row.children];
    const focus = this.ctx.selected();
    /* Keyed on the plane *and* the selection, because the selection changes the render: the
     * chosen structure is drawn brighter and everything else is held back. Keyed on the plane
     * alone, choosing a structure would light it only after the plane was changed and back. */
    const stamp = `${plane}|${focus}`;
    let info = this._sectInfo;
    if (this._sectDrawn !== stamp || !info) {
      info = this.ctx.sections?.(figs.map(f => f.firstChild), plane, focus);
      if (info) { this._sectDrawn = stamp; this._sectInfo = info; }
    }
    if (!info) {
      for (const f of figs) f.lastChild.textContent = '';
      what.textContent = '';
      return;
    }

    /* Where the selected structure is in this series, if anything is selected. This is the
     * whole of "when I choose hippocampus it needs to highlight in one of those five cuts
     * where it is": the cuts that pass through it are marked, its centroid is ringed inside
     * each of those pictures, and the sentence under the strip says which cuts and over what
     * range in millimetres. Measured off the geometry by `SectionStrip.locate`, so it is a
     * statement about this model rather than an atlas sentence dressed as a caption. */
    const sel = this.ctx.selected();
    const at = sel > 0 ? this.ctx.locate?.(sel, plane) : null;
    const selName = sel > 0 ? nameOf(sel, lang) : '';
    const selCol = get(sel)?.color ?? '#FFC98A';
    const inCuts = [];

    info.slices.forEach((sl, i) => {
      const fig = figs[i];
      const cap = fig.lastChild;
      cap.textContent = `${sl.mm > 0 ? '+' : ''}${sl.mm} mm`;
      const names = sl.ids.map(id => nameOf(id, lang)).filter(Boolean).sort();
      const it = document.createElement('i');
      it.textContent = names.slice(0, 3).join(', ') || T('sectCortexOnly');
      cap.appendChild(it);
      /* Pointing at the picture, which is the thing these cuts never let you do.
       *
       * A cut named what it passed through and lit whatever was already chosen; the picture
       * itself was inert, so a reader looking at a bright shape had no way to ask what it was.
       * Hovering names the structure under the pointer and clicking chooses it everywhere in
       * the application. Clicking anywhere that is not a structure still moves the big plane to
       * that depth, which is what the click used to do and is still worth having — the two do
       * not collide, because one needs a crossing under the pointer and the other does not. */
      const cv = fig.firstChild;
      const norm = e => {
        const r = cv.getBoundingClientRect();
        return [((e.clientX - r.left) / r.width) * 2 - 1, 1 - ((e.clientY - r.top) / r.height) * 2];
      };
      fig.onpointermove = e => {
        const [sx, sy] = norm(e);
        const hit = this.ctx.pickCut?.(plane, sl.at, sx, sy);
        fig.classList.toggle('onpart', !!hit);
        this.showCutName(hit, e, fig);
      };
      fig.onpointerleave = () => { fig.classList.remove('onpart'); this.showCutName(null); };
      fig.onclick = e => {
        const [sx, sy] = norm(e);
        const hit = this.ctx.pickCut?.(plane, sl.at, sx, sy);
        if (hit) { this.focusJoint = null; this.focusLevel = null; this.ctx.select(hit.id); }
        else this.ctx.scanTo?.(plane, sl.at);
      };
      fig.title = names.join(', ');

      /* Which cuts contain it. The structure itself is what stands out — `setFocus` lifts its
       * gain in the render and holds everything else back — so this is only the frame around
       * the thumbnails that have it, which is a mark on the furniture rather than over the
       * picture. A ring drawn on top was the first answer and it was the wrong one: it points
       * at a place instead of showing the thing, and on an image this dense a circle is one
       * more mark among the marks. */
      const here = at && sl.at >= at.lo && sl.at <= at.hi;
      fig.classList.toggle('hasit', !!here);
      if (here) inCuts.push(sl.mm);
    });

    /* The sentence. Which cuts it is in, and how far it runs along the axis of the cut — the
     * two things a reader is asking when they say "where is it". */
    const where = this.host.querySelector('#labSectWhere');
    if (where) {
      where.textContent = '';
      if (sel > 0 && at) {
        const dot = document.createElement('i');
        dot.style.background = selCol;
        where.appendChild(dot);
        const b = document.createElement('b');
        b.textContent = selName;
        where.appendChild(b);
        const q = v => `${v > 0 ? '+' : ''}${v}`;
        where.appendChild(document.createTextNode(
          inCuts.length
            ? ` ${T(inCuts.length > 1 ? 'labSectInPl' : 'labSectIn')} ` +
              `${inCuts.map(q).join(', ')} mm, ${T('labSectSpans')} ` +
              `${q(at.loMm)} ${T('labSectTo')} ${q(at.hiMm)} mm ` +
              `(${Math.abs(at.hiMm - at.loMm)} mm ${T('labSectThick')}).`
            : ` ${T('labSectBetween')} ${q(at.loMm)} ${T('labSectTo')} ${q(at.hiMm)} mm — ` +
              `${T('labSectMissed')}`));

        /* And what it is, not only where. The same two sentences the rest of the application
         * uses for that structure — where it sits and what it does — so "explain what it means
         * and where it is" is answered on the picture rather than somewhere else. */
        const ri = REGION_INFO[sel]?.[lang] ?? REGION_INFO[sel]?.en;
        if (ri?.where || ri?.does) {
          const em = document.createElement('em');
          em.textContent = [ri.where, ri.does].filter(Boolean).join(' ');
          where.appendChild(em);
        }
      } else if (sel > 0) {
        where.appendChild(document.createTextNode(`${selName} — ${T('labSectNoMesh')}`));
      } else {
        where.appendChild(document.createTextNode(T('labSectChoose')));
      }
    }

    /* The legend, from the union across all five cuts: the colours are what tells a reader
     * which bright shape is which, and without a key they are decoration. Clickable, so a
     * structure found in a section can be selected everywhere else. */
    const legend = this.host.querySelector('#labSectKey');
    if (legend) {
      const seen = new Map();
      for (const sl of info.slices) for (const id of sl.ids) if (!seen.has(id)) seen.set(id, get(id));
      legend.textContent = '';
      for (const [id, r] of seen) {
        if (!r) continue;
        const el = document.createElement('button');
        el.className = 'sectkey';
        el.dataset.id = String(id);
        const dot = document.createElement('i');
        dot.style.background = r.color;
        const nm = document.createElement('span');
        nm.textContent = nameOf(id, lang);
        el.append(dot, nm);
        el.onclick = () => this.ctx.select(id);
        legend.appendChild(el);
      }
      // the cortex is in every cut and has no id of its own, so it is named once, last
      const cx = document.createElement('span');
      cx.className = 'sectkey cortexkey';
      const dot = document.createElement('i');
      dot.style.background = '#FFC98A';
      const nm = document.createElement('span');
      nm.textContent = T('sectCortex');
      cx.append(dot, nm);
      legend.appendChild(cx);
    }

    /* What you are looking at. Each row is one thing a reader can see in the picture and what
     * it is — the bright line, the bright patch, the black, the colour, the number. Written to
     * be true rather than reassuring: the black is the one that matters most, because it looks
     * like absence of tissue and is absence of *surface*, and a reader who takes it the first
     * way has learned something false from a picture that looks like an instrument. */
    what.textContent = '';
    const KEYS = ['sectWhatLine', 'sectWhatBright', 'sectWhatDark', 'sectWhatColour',
                  'sectWhatNumber', 'sectWhatPoint'];
    for (const k of KEYS) {
      const item = document.createElement('div');
      item.className = 'sectitem';
      const head = document.createElement('b');
      head.textContent = T(`${k}H`);
      const body = document.createElement('span');
      body.textContent = T(k);
      item.append(head, body);
      what.appendChild(item);
    }
  }

  /* ------------------------------------------------ every cell, every fibre
   * The connectome as a chart rather than as a scene: an XY plot of the whole network,
   * projected onto the sagittal plane, with millimetre axes.
   *
   * The 3D view answers "what shape is it". This answers "where is everything, and how much of
   * it is there" — which is the question a plot with numbered axes can answer and an orbiting
   * scene cannot, because in a scene you can never be sure whether something is small or far
   * away. Every one of the four thousand cells is a point and every one of its fibres is a
   * line; nothing is summarised, binned or sampled down, so the density on the page is the
   * density of the network.
   *
   * The axes are real millimetres in the fsaverage volume the cortex was built from, measured
   * from its own centroid, converted through `FRAME.scale` — the same conversion the section
   * captions use. They are distances in this model, not a coordinate looked up in an atlas.
   *
   * Clicking a cell traces it: the panel below follows every fibre out of that cell to where
   * it lands. That is the other half of "I should be able to choose the cell and track where
   * it goes" — this picture is where you choose it.
   */
  drawFibres(lang) {
    /* Fit before reading the size, not after.
     *
     * `Panel.w` is 0 until `fit()` has run, and `fit()` runs inside `clear()` — which is
     * called further down, after the whole layout has been computed from `w`. So the first
     * draw laid the plot out for a width of zero: `availW` came out negative, the scale
     * inverted, and four thousand cells collapsed into a stripe against the left edge. It
     * corrected itself on whatever redraw happened next, which is why it looked intermittent
     * rather than broken, and it is also why the size belongs in the cache key only after it
     * is real. `drawRegionMap` and the rest already clear first; these two did not. */
    this.p8.fit();
    const { w, h } = this.p8;
    const T = k => UI[k]?.[lang] ?? k;
    const cell = this.ctx.cells2?.();
    const plate = this.ctx.plate?.();
    const view = this.fibView ?? 'side';
    this.fibreViewButtons(lang, view);
    const z = this.fibZoom ?? 1;
    const pan = this.fibPan ?? { x: 0, y: 0 };
    const hov = this.fibHover ?? -1;

    /* Eight thousand lines and four thousand points, each with its own alpha. `draw()` runs on
     * every pointer move over the region map, and nothing here answers to *that* — so it is
     * redrawn only when something it is actually a picture of has changed. The hovered cell is
     * in the key because hovering this panel is a change to this picture. */
    const key = [lang, w, h, cell?.count ?? 0, this.ctx.selected(), this.tracedCell ?? -1,
                 plate ? 1 : 0, view, z.toFixed(3), pan.x.toFixed(1), pan.y.toFixed(1),
                 hov].join('|');
    if (key === this._fibKey) return;
    this._fibKey = key;

    const c = this.p8.clear();
    if (!cell?.count) { label(c, T('connNone'), PAD, h / 2, { colour: DIM }); return; }

    /* **Which way you are looking at it.** Seen from the side the two hemispheres land on top
     * of each other — the projection is down the left–right axis, so every cell of the right
     * half is drawn over its partner on the left. That is not "only one side of the brain",
     * and the fix is not to throw a hemisphere away: it is to let the reader turn the
     * projection. From above and from the front, left and right separate. */
    const PROJ = {
      side:  { u: p => p.z, v: p => p.y, ux: 'labFibreX',  vx: 'labFibreY' },
      above: { u: p => p.z, v: p => -p.x, ux: 'labFibreX', vx: 'labFibreLR' },
      front: { u: p => -p.x, v: p => p.y, ux: 'labFibreLR2', vx: 'labFibreY' },
    };
    const P = PROJ[view] ?? PROJ.side;

    const AX = 46, AY = 30;                       // room for the two axes
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    const bump = (u, v) => { u0 = Math.min(u0, u); u1 = Math.max(u1, u);
                             v0 = Math.min(v0, v); v1 = Math.max(v1, v); };
    for (let i = 0; i < cell.count; i++) { const p = cell.pos(i); bump(P.u(p), P.v(p)); }
    /* The plate is a lateral render, so it only belongs under the lateral projection. Under
     * the other two it would be a picture of the brain from the wrong angle laid under points
     * plotted from the right one, which is worse than no backdrop. */
    const usePlate = view === 'side' && plate?.image && plate.rect;
    if (usePlate) { bump(plate.rect.z0, plate.rect.y0); bump(plate.rect.z1, plate.rect.y1); }

    const availW = w - AX - 16, availH = h - AY - 14;
    const fit = Math.min(availW / ((u1 - u0) || 1), availH / ((v1 - v0) || 1));
    const s = fit * z;
    const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
    // the plot box's own centre, and the pan in pixels away from it
    const baseX = AX + availW / 2, baseY = 8 + availH / 2;
    const bx = baseX + pan.x, by = baseY + pan.y;
    // screen y grows downward, so the vertical axis is mirrored through the box centre
    const PX = u => bx + (u - cu) * s;
    const Y = v => by + (cv - v) * s;
    this.fibProj = { PX, Y, s, P, view, bx, by, baseX, baseY };

    c.save();
    c.beginPath();
    c.rect(AX, 4, w - AX - 6, h - AY - 4);
    c.clip();

    if (usePlate) {
      const r = plate.rect;
      c.save();
      c.globalAlpha = 0.26;
      c.drawImage(plate.image, PX(r.z0), Y(r.y1), PX(r.z1) - PX(r.z0), Y(r.y0) - Y(r.y1));
      c.restore();
    }

    const sel = this.ctx.selected();
    const traced = this.tracedCell ?? -1;

    /* Every fibre. Additive and faint, so where many run together the page fills in and the
     * tracts read as density rather than as a hairball — the same reason the tissue shader
     * sums its walls. Drawn in the source cell's own region colour. */
    const pairs = cell.pairs ?? [];
    c.globalCompositeOperation = 'lighter';
    c.lineWidth = 0.6 * Math.min(2, Math.sqrt(z));
    let drawn = 0;
    for (let k = 0; k + 1 < pairs.length; k += 2) {
      const i = pairs[k], j = pairs[k + 1];
      const a = cell.pos(i), b = cell.pos(j);
      const reg = cell.region(i);
      const lit = (sel > 0 && (reg === sel || cell.region(j) === sel))
               || i === traced || j === traced || i === hov || j === hov;
      c.strokeStyle = lit ? '#FFE9C6' : (get(reg)?.color ?? '#6E86A8');
      c.globalAlpha = lit ? 0.9 : 0.20;
      c.beginPath();
      c.moveTo(PX(P.u(a)), Y(P.v(a)));
      c.lineTo(PX(P.u(b)), Y(P.v(b)));
      c.stroke();
      drawn++;
    }
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;

    /* And every cell body. They grow with the zoom, because "even if I zoom in there is no way
     * to understand which cell I am choosing" is a report about points that stayed one pixel
     * however far in you went. Capped, for the reason the somas in the scene are capped: a
     * cell stands for a population far below this model's resolution, so its size is a symbol
     * and not a measurement. */
    const dot = Math.min(4.5, 0.6 + z * 0.75);
    for (let i = 0; i < cell.count; i++) {
      const p = cell.pos(i);
      const reg = cell.region(i);
      const lit = sel > 0 && reg === sel;
      c.fillStyle = lit ? '#FFF3DA' : (get(reg)?.color ?? '#7C8EA8');
      c.globalAlpha = lit ? 0.95 : 0.34;
      const x = PX(P.u(p)), y = Y(P.v(p));
      if (dot <= 1.4) c.fillRect(x - dot / 2, y - dot / 2, dot, dot);
      else { c.beginPath(); c.arc(x, y, dot / 2, 0, Math.PI * 2); c.fill(); }
    }
    c.globalAlpha = 1;

    /* The cell under the pointer, ringed and named. This is the whole of "as my pointer goes
     * through I need to know which cell that is": a ring the pointer cannot be mistaken about,
     * plus the name in the readout under the plot. */
    const mark = (i, colour, r, wgt) => {
      const p = cell.pos(i);
      const x = PX(P.u(p)), y = Y(P.v(p));
      c.strokeStyle = colour; c.lineWidth = wgt;
      c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.stroke();
      return [x, y];
    };
    if (hov >= 0 && hov !== traced) {
      const [x, y] = mark(hov, 'rgba(255,255,255,.75)', 8, 1);
      const nm = nameOf(cell.region(hov), lang) || T('labNoParcel');
      c.font = `10px "Helvetica Neue", Helvetica, Arial, sans-serif`;
      const tw = c.measureText(nm).width;
      const lx = Math.min(x + 13, w - tw - 10), ly = Math.max(y - 11, 14);
      c.fillStyle = 'rgba(6,11,20,.82)';
      c.fillRect(lx - 4, ly - 10, tw + 8, 14);
      label(c, nm, lx, ly, { colour: INK, size: 10, caps: false });
    }
    if (traced >= 0 && traced < cell.count) {
      const [x, y] = mark(traced, 'rgba(255,255,255,.92)', 9, 1.4);
      c.beginPath();
      c.moveTo(x - 15, y); c.lineTo(x - 11, y);
      c.moveTo(x + 11, y); c.lineTo(x + 15, y);
      c.moveTo(x, y - 15); c.lineTo(x, y - 11);
      c.moveTo(x, y + 11); c.lineTo(x, y + 15);
      c.stroke();
    }
    c.restore();

    /* The axes. Millimetres from the cortex centroid, ticked at whatever spacing keeps the
     * labels apart at this zoom — a chart whose axes carry no unit is a picture with numbers
     * on it, and one whose numbers collide is a picture with a smear on it. */
    const mm = q => q / FRAME.scale;
    const step = [5, 10, 20, 40, 80].find(v => v * FRAME.scale * s > 42) ?? 80;
    c.strokeStyle = RULE; c.lineWidth = 1;
    c.beginPath();
    c.moveTo(AX, 6); c.lineTo(AX, h - AY); c.lineTo(w - 6, h - AY);
    c.stroke();
    const tick = (lo, hi, place, horiz) => {
      const a = Math.ceil(mm(lo) / step) * step, b = Math.floor(mm(hi) / step) * step;
      for (let val = a; val <= b; val += step) {
        const q = place(val * FRAME.scale);
        if (horiz ? (q < AX || q > w - 6) : (q < 6 || q > h - AY)) continue;
        c.strokeStyle = GRID; c.lineWidth = 1;
        c.beginPath();
        if (horiz) { c.moveTo(q, 6); c.lineTo(q, h - AY); }
        else { c.moveTo(AX, q); c.lineTo(w - 6, q); }
        c.stroke();
        c.strokeStyle = RULE;
        c.beginPath();
        if (horiz) { c.moveTo(q, h - AY); c.lineTo(q, h - AY + 4); }
        else { c.moveTo(AX - 4, q); c.lineTo(AX, q); }
        c.stroke();
        const txt = `${val > 0 ? '+' : ''}${val}`;
        if (horiz) label(c, txt, q, h - AY + 15, { colour: DIM2, size: 9, align: 'center' });
        else label(c, txt, AX - 7, q + 3, { colour: DIM2, size: 9, align: 'right' });
      }
    };
    // the visible range, which is what the ticks have to cover once the plot can pan and zoom
    tick(cu + (AX - bx) / s, cu + (w - 6 - bx) / s, PX, true);
    tick(cv - (h - AY - by) / s, cv + (by - 6) / s, Y, false);
    label(c, T(P.ux), (AX + w) / 2, h - 4, { colour: DIM2, size: 9, align: 'center' });
    c.save();
    c.translate(11, (h - AY) / 2); c.rotate(-Math.PI / 2);
    label(c, T(P.vx), 0, 0, { colour: DIM2, size: 9, align: 'center' });
    c.restore();

    this.fibreReadout(lang, cell, drawn, hov);
  }

  /**
   * Which way to look at it, and a way back to the start.
   *
   * Three projections, because the lateral one lands the two hemispheres on top of each other
   * and a reader is entitled to ask where the other side went. From above and from the front
   * they separate. Reset is here because a plot you can zoom into is a plot you can get lost
   * in, and hunting for the way out is not exploration.
   */
  fibreViewButtons(lang, view) {
    const host = this.host.querySelector('#labFibViews');
    if (!host) return;
    const T = k => UI[k]?.[lang] ?? k;
    const state = `${lang}|${view}|${(this.fibZoom ?? 1).toFixed(2)}`;
    if (host.dataset.state === state) return;
    host.dataset.state = state;
    host.textContent = '';
    for (const key of ['side', 'above', 'front']) {
      const b = document.createElement('button');
      b.className = 'fibview';
      b.textContent = T(`fibView${key[0].toUpperCase()}${key.slice(1)}`);
      b.setAttribute('aria-pressed', String(key === view));
      b.onclick = () => {
        if (this.fibView === key) return;
        this.fibView = key;
        // a new projection is a new picture, so the old pan and zoom mean nothing in it
        this.fibZoom = 1; this.fibPan = { x: 0, y: 0 }; this.fibHover = -1;
        this.drawFibres(this.ctx.lang());
      };
      host.appendChild(b);
    }
    const r = document.createElement('button');
    r.className = 'fibview fibreset';
    r.textContent = `${T('fibReset')}${(this.fibZoom ?? 1) > 1.01 ? ` ${(this.fibZoom).toFixed(1)}×` : ''}`;
    r.onclick = () => {
      this.fibZoom = 1; this.fibPan = { x: 0, y: 0 };
      this.drawFibres(this.ctx.lang());
    };
    host.appendChild(r);
  }

  /** The line under the fibre plot: what it drew, and what the pointer is on. */
  fibreReadout(lang, cell, drawn, hov) {
    const T = k => UI[k]?.[lang] ?? k;
    const read = this.host.querySelector('#labF8');
    if (!read) return;
    read.textContent = '';
    const add = (text, cls) => {
      const el = document.createElement('span');
      if (cls) el.className = cls;
      el.textContent = text;
      read.appendChild(el);
      return el;
    };
    add(`${cell.count.toLocaleString()} ${T('labCells')} · ${drawn.toLocaleString()} ${T('labFibreCount')}`);
    if (hov >= 0 && hov < cell.count) {
      const p = cell.pos(hov);
      const reg = cell.region(hov);
      const dot = add('', 'fibdot');
      dot.style.background = get(reg)?.color ?? '#7C8EA8';
      // the coloured dot is the separator; the flex gap does the spacing
      add(`${T('labCellNo')} ${String(hov).padStart(5, '0')} · ` +
          `${nameOf(reg, lang) || T('labNoParcel')} · ${this.mmOf(p)}`, 'fibhit');
    } else {
      add(` · ${T('labFibrePick')}`, 'fibhint');
    }
  }

  /** A cell's position as the three millimetre coordinates it actually has. */
  mmOf(p) {
    const q = v => `${v > 0 ? '+' : ''}${Math.round(v / FRAME.scale)}`;
    return `${q(-p.x)}, ${q(p.z)}, ${q(p.y)} mm`;
  }



  /* ---------------------------------------------------- the body, in the lab
   * The live scene, rendered into this panel beside the chart of what it is doing.
   *
   * It is not a second copy of the body. `renderStageInto` in `main.js` renders the scene that
   * is already loaded, from the camera that is already framed, into an offscreen target and
   * hands back the pixels — so this is the same geometry, the same skinning, the same instant
   * of the same clip and the same palette. The muscles the exercise works are already lit in
   * it, by the activation the chart beside it is plotting, which means the two pictures cannot
   * disagree about what is working. Nothing is highlighted twice and nothing is highlighted
   * here that is not highlighted there.
   *
   * **Not per frame.** A full scene render plus a readback is what the stage does once a frame
   * for the whole window; doing it again for a panel every frame would halve the frame rate
   * for a picture that only changes when the pose does. It redraws when the clip time has
   * moved enough to matter, and otherwise leaves the last one up.
   */
  drawBody(lang) {
    const T = k => UI[k]?.[lang] ?? k;
    const p = this.p12;
    if (!p) return;
    p.fit();
    const t = this.ctx.t?.() ?? 0;
    const ex = this.ctx.exercise?.();
    /* Quantised hard. This is the most expensive thing on the screen — a full render of the
     * whole body scene into an offscreen target plus a pixel readback — and a readback stalls
     * the GPU pipeline by design: it has to wait for the frame it is reading. At twenty-four
     * steps a second that was a stall two dozen times a second on top of everything else the
     * lab draws. Six is enough for a pose to look like it is moving and leaves the rest of the
     * frame budget to the connectome, which is the thing on this screen that has to be smooth.
     *
     * The selection is in the key because selecting a structure changes what is lit. */
    const stamp = `${ex ?? ''}|${Math.round(t * BODY_FPS)}|${p.w}|${this.ctx.selected()}`;
    /* And paced against what it actually costs, not against a number written here.
     *
     * Six a second is a budget only if a render is cheap, and how cheap it is depends entirely
     * on the machine: the same call is a handful of milliseconds on a discrete GPU and most of
     * a second on a software rasteriser. Asked for six of those a second, a slow machine spent
     * its whole frame budget on this one panel and the lab measured 0.29 frames a second with
     * a clip playing — three times slower than the stage it is drawn over. So the panel is
     * made to pay for itself: after a render it stands down for `BODY_SHARE` times as long as
     * that render took, so it can never be more than one part in `1 + BODY_SHARE` of wall
     * time. Nothing about the picture changes — it is the same render at the same size — only
     * how often a machine that cannot afford one is asked.
     *
     * Standing down for exactly as long as the render took was the first version and it did
     * nothing at all: the rest of the frame is itself about as long as the render, so by the
     * time the next tick came round the stand-down had already expired and every frame still
     * paid. Measured before and after, the number did not move by a hundredth of a frame. The
     * budget has to be counted against the whole frame, not against the panel's own share. */
    if (stamp !== this._bodyStamp) this.borrowScene(() => {
      this._bodyStamp = stamp;
      this._bodyDrawn = this.ctx.stage?.(p.canvas, p.w * p.dpr, p.h * p.dpr) ?? false;
    }, !this._bodyStamp);
    if (!this._bodyDrawn) {
      const c = p.clear();
      label(c, T('labBodyNone'), p.w / 2, p.h / 2,
            { colour: DIM, size: 12, caps: false, align: 'center' });
    }
    const read = this.host.querySelector('#labF12');
    if (read) {
      const a = this.ctx.analysis?.(lang);
      read.textContent = '';
      const add = (text, cls) => {
        const el = document.createElement('span');
        if (cls) el.className = cls;
        el.textContent = text;
        read.appendChild(el);
      };
      if (!a?.key) { add(T('labBodyNone')); return; }
      const lit = a.muscles.filter(m => m.mean > 0.01).length || a.muscles.length;
      const moving = a.joints.filter(j => j.travel > 1).length;
      add(`${lit} ${T('labBodyLit')} · ${moving} ${T('labBodyMoving')} · ${T('labBodySame')}`);
    }
  }

  /* ------------------------------------------- one structure, alone and in place
   * "For the muscles or nerves that are working, is it possible to see the 3D version of how
   * it looks? For example if external oblique I need the 3D looks of this external oblique
   * alone, and also where it is located in the body — show the whole body and where it is
   * standing. The same for the nerves and cord levels and joints."
   *
   * Two questions, so two pictures. On the left the structure by itself, framed on its own
   * extent with everything else hidden, which is the only way to read a shape that in the body
   * is buried under three other sheets. On the right the whole figure as it stands in this
   * exercise, with the structure lit where it sits and a ring on it, because "where is it" is
   * not answered by a close-up however good the close-up is.
   *
   * Neither is a model made for this panel. `renderStructureInto` renders the scene that is
   * already loaded, from the pose that is already on screen, so the muscle here is the muscle
   * there — same geometry, same skinning, same instant of the same clip.
   *
   * Four kinds of thing arrive here and they are not the same kind of thing, so the caption
   * says which one it is showing:
   * - a **muscle** or a **nerve** is a mesh, and both pictures are of it;
   * - a **cord level** is not a mesh — a nerve root is not a structure in this model — so what
   *   is shown is the vertebra at that level, and the caption says exactly that. Calling the
   *   C5 vertebra "C5" and leaving the reader to conclude it is the root would be the kind of
   *   quiet substitution this application exists not to make;
   * - a **joint** is not a mesh either. It is a centre of rotation, so the close view is the
   *   body framed on that point with the flesh around it left in place, and the ring is the
   *   point itself.
   *
   * Paced exactly as the body panel is, and for the same reason: two more full scene renders
   * with a readback each is the most expensive thing on this screen after that one.
   */
  /** The orbit each of the two views is turned to, created on first use. */
  orbit(which) {
    this._orbit ??= {};
    return (this._orbit[which] ??= { yaw: 0, pitch: 0, zoom: 1 });
  }

  /**
   * The worked structures in the order the analysis ranks them, as one list to walk.
   *
   * Muscles first and hardest-worked first, because that is the question the panel above it
   * answers and the order it answers it in. Then the joints the movement travels through, then
   * the nerves that supply those muscles and the cord levels they come from, then the brain
   * regions this exercise's own claims are about. Nothing is invented to fill the list: an
   * entry exists only where this model carries something to draw for it, so a nerve with no
   * route in the model and a cranial level with no vertebra are simply not in it.
   */
  tourList(lang) {
    const a = this.ctx.analysis?.(lang);
    if (!a?.key) return [];
    const out = [];
    const T = k => UI[k]?.[lang] ?? k;
    for (const m of a.muscles.slice(0, 10)) {
      const r = registry()?.byName.get(m.name);
      if (!r) continue;
      out.push({ kind: 'structure', id: r.id, group: T('labAnalMuscles'),
                 label: nameOf(r.id, lang) || m.name,
                 sub: m.mean > 0 ? m.mean.toFixed(2) : '—' });
    }
    for (const j of a.joints.filter(x => x.travel > 1).slice(0, 6))
      out.push({ kind: 'joint', coord: j.coord, group: T('labAnalJoints'),
                 label: jointLabel(j.coord, lang), sub: `${j.travel.toFixed(0)}°` });
    /* Two groups where the column has one heading, because these draw two different things.
     * A nerve chip shows the nerve, against the nervous system; a cord-level chip shows the
     * *vertebra* at that level, against the skeleton, because a nerve root is not a shape in
     * this model. Under one heading reading "Nerves" the second of those is a picture that
     * contradicts its own label, and it was read exactly that way. */
    for (const n of a.nerves.slice(0, 7)) {
      const id = nerveFor(n.text);
      if (id) out.push({ kind: 'structure', id, group: T('labTourNerves'),
                         label: nameOf(id, lang), sub: '' });
    }
    /* Capped like the nerves and the joints. The Hundred's muscles between them are supplied
     * from C2 to S1, and all twenty of those are real and are all listed in the column — but
     * the tour is "show me the 3D of each, one at a time", and twenty vertebrae one at a time
     * is eighty seconds of vertebrae between the nerves and the brain. */
    for (const r of (a.roots ?? []).slice(0, 6)) {
      const id = vertebraFor(r.root);
      if (id) out.push({ kind: 'level', id, root: r.root, group: T('labTourLevels'),
                         label: r.root, sub: '' });
    }
    for (const r of a.regions)
      out.push({ kind: 'structure', id: r.region, group: T('labAnalBrain'),
                 label: nameOf(r.region, lang) || `#${r.region}`, sub: r.best });
    /* One entry per thing. A muscle can be named by two nerves and a level by two muscles, and
     * the same picture twice in a row reads as the tour being stuck. */
    const seen = new Set();
    return out.filter(e => {
      const k = `${e.kind}|${e.id ?? e.coord}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  /** Show entry `i` of the tour: the panel's focus, and the app's selection, follow it. */
  applyTour(i) {
    const list = this._tour ?? [];
    if (!list.length) return;
    this.tourI = ((i % list.length) + list.length) % list.length;
    const e = list[this.tourI];
    this.focusJoint = e.kind === 'joint' ? e.coord : null;
    this.focusLevel = e.kind === 'level' ? e.root : null;
    this.focusLevelId = e.kind === 'level' ? e.id : null;
    /* What the tour believes is chosen, recorded before it chooses it — `selectQuiet` redraws
     * synchronously, so setting this afterwards would let the redraw compare against the
     * previous entry and stop the tour on its own step. */
    this._tourSel = e.id ?? this.ctx.selected();
    /* Quietly. The tour changes what is chosen every few seconds, and a deliberate selection
     * flies the camera and peels the body apart — behind a full-screen overlay, twenty times
     * in a row, for a reader who is looking at this panel and not at the stage. */
    if (e.id != null) this.ctx.selectQuiet?.(e.id);
    else this.draw();
  }

  stepTour(by, stop = false) {
    if (stop) this.pauseTour();
    this.tourAt = performance.now();
    this.applyTour((this.tourI ?? 0) + by);
  }

  pauseTour() {
    if (!this.tourPlaying) return;
    this.tourPlaying = false;
    this.drawDetail(this.ctx.lang());
  }

  drawDetail(lang, force = false) {
    const T = k => UI[k]?.[lang] ?? k;
    const a = this.p13a, b = this.p13b;
    if (!a || !b) return;
    a.fit(); b.fit();

    /* The list is rebuilt when the exercise changes, and the tour starts itself. "I don't want
     * to choose one by one myself" is a request for the panel to do the walking; it plays from
     * the moment an exercise is loaded and stops the instant the reader touches it. */
    const ex = this.ctx.exercise?.() ?? '';
    if (this._tourKey !== `${ex}|${lang}`) {
      this._tourKey = `${ex}|${lang}`;
      this._tour = this.tourList(lang);
      this.tourI = 0;
      this.tourPlaying = this._tour.length > 1;
      this.tourAt = performance.now();
      if (this._tour.length) this.applyTour(0);
    }
    /* A selection the tour did not make stops it.
     *
     * Without this the panel takes the reader's choice back: click the hippocampus in the cut
     * legend, and four seconds later the tour steps to the next muscle and the whole screen
     * follows it. Anything that chooses a structure — the legend, a cut, the region map, the
     * picture on the stage, a row of the analysis — lands here as a selection the tour did not
     * ask for, so one rule covers every route in. */
    if (this.tourPlaying && this._tourSel != null && this.ctx.selected() !== this._tourSel)
      this.tourPlaying = false;
    this.drawTourStrip(lang);
    const hint = this.host.querySelector('#labDetHint');
    if (hint) hint.textContent = T('labDetTurn');

    const det = this.detailOf();
    const read = this.host.querySelector('#labF13');
    const ring = this.host.querySelector('#labRing13');
    const capA = this.host.querySelector('#labC13a');
    const capB = this.host.querySelector('#labC13b');

    const stamp = `${lang}|${det?.kind ?? ''}|${det?.id ?? ''}|${det?.coord ?? ''}|` +
                  `${Math.round((this.ctx.t?.() ?? 0) * BODY_FPS)}|${a.w}`;
    const oa = this.orbit('a'), ob = this.orbit('b');
    const stamp2 = `${stamp}|${oa.yaw.toFixed(2)},${oa.pitch.toFixed(2)},${oa.zoom.toFixed(2)}` +
                   `|${ob.yaw.toFixed(2)},${ob.pitch.toFixed(2)},${ob.zoom.toFixed(2)}`;
    /* `force` is a drag in progress, and a drag is worth a frame: the shared budget exists to
     * stop three panels quietly eating the frame between them, not to make the one thing the
     * reader has hold of lag behind their pointer. */
    if (stamp2 !== this._detStamp) {
      const run = () => { this._detStamp = stamp2; this._det = this.paintDetail(det); };
      this.borrowScene(run, force || !this._detStamp);
    }
    const got = this._det;

    /* A caption over an empty box is worse than no caption: the left picture can be missing on
     * its own — a structure whose layer has not finished loading, or one this model carries no
     * separate shape for — while the right one is fine. */
    if (capA) capA.textContent = got?.close ? T(det.kind === 'joint' ? 'labDetClose' : 'labDetAlone') : '';
    if (capB) capB.textContent = got?.body ? T('labDetInBody') : '';
    /* The ring is a DOM element over the canvas, never painted into it: the renders are kept
     * and only redrawn when the pose or the structure moves, so a mark drawn onto the pixels
     * would either vanish on the next blit or pile up on the one before. Same rule the cuts
     * learned. */
    if (ring) {
      const at = got?.body;
      const on = !!(at && at.sx > 0.02 && at.sx < 0.98 && at.sy > 0.02 && at.sy < 0.98);
      ring.hidden = !on;
      if (on) {
        ring.style.left = `${at.sx * 100}%`;
        ring.style.top = `${at.sy * 100}%`;
        ring.style.color = det.colour ?? '#FFC98A';
      }
    }
    if (!read) return;
    read.textContent = '';
    const add = (text, cls) => {
      const el = document.createElement('span');
      if (cls) el.className = cls;
      el.textContent = text;
      read.appendChild(el);
    };
    if (!det) { add(T('labDetPick')); return; }
    add(det.name, 'detname');
    add(T(det.warrant));
    if (det.note) add(det.note);
    /* "No shape for it" is false while the layer is still arriving, and it is the sentence a
     * reader is most likely to believe — it sounds like a considered statement about the
     * model rather than a race with a load. */
    if (!got?.close) add(T(this.ctx.pending?.(det.id) ? 'labDetLoading' : 'labDetNoMesh'));
  }

  /**
   * The tour as a strip of chips, grouped and ranked, with the current one marked.
   *
   * The list *is* the answer to "show the names of the muscles that are working the most to
   * the least" — it is the ranking, written out, in order, with the number each is ranked on
   * beside it. It is also the control: clicking a chip jumps the pictures to that structure and
   * stops the tour, so the panel walks by itself and can be taken over at any point.
   */
  drawTourStrip(lang) {
    const host = this.host.querySelector('#detChips');
    const play = this.host.querySelector('#detPlay');
    if (!host) return;
    const T = k => UI[k]?.[lang] ?? k;
    if (play) {
      play.textContent = this.tourPlaying ? '❚❚' : '▶';
      play.title = T(this.tourPlaying ? 'labDetPause' : 'labDetPlay');
    }
    const list = this._tour ?? [];
    const stamp = `${this._tourKey}|${this.tourI}|${list.length}`;
    if (host.dataset.stamp === stamp) return;
    host.dataset.stamp = stamp;
    host.textContent = '';
    let group = null, n = 0;
    list.forEach((e, i) => {
      if (e.group !== group) {
        group = e.group; n = 0;
        const g = document.createElement('span');
        g.className = 'detgroup';
        g.textContent = group;
        host.appendChild(g);
      }
      n++;
      const b = document.createElement('button');
      b.className = 'detchip';
      if (i === this.tourI) b.setAttribute('aria-current', 'true');
      const r = document.createElement('i');
      r.textContent = n;
      b.append(r, document.createTextNode(e.label));
      if (e.sub) {
        const s2 = document.createElement('em');
        s2.textContent = e.sub;
        b.appendChild(s2);
      }
      b.onclick = () => { this.pauseTour(); this.tourAt = performance.now(); this.applyTour(i); };
      host.appendChild(b);
    });
  }

  /**
   * The name of whatever the pointer is over in a cut, floating beside it.
   *
   * A DOM element over the strip, never painted into a thumbnail — the renders are cached and
   * re-blitted only when the plane or the selection changes, so a mark drawn onto the pixels
   * would either vanish on the next blit or pile up on the one before. Same rule the focus
   * highlight and the `hasit` frame already follow.
   */
  showCutName(hit, e, fig) {
    const el = this.host.querySelector('#labSectName');
    if (!el) return;
    if (!hit) { el.hidden = true; return; }
    const rr = el.parentNode.getBoundingClientRect();
    el.hidden = false;
    el.textContent = nameOf(hit.id, this.ctx.lang()) || `#${hit.id}`;
    el.style.color = get(hit.id)?.color ?? '#FFC98A';
    el.style.left = `${e.clientX - rr.left + 12}px`;
    el.style.top = `${e.clientY - rr.top - 8}px`;
  }

  /**
   * What the pair of renders is currently about.
   *
   * A joint the reader has clicked wins over the selection, because a joint has no id and
   * cannot be the selection; anything else follows it, so the pair always agrees with the rest
   * of the screen rather than keeping a second idea of what is chosen.
   */
  detailOf() {
    const lang = this.ctx.lang();
    const j = this.focusJoint;
    if (j) {
      return { kind: 'joint', coord: j, name: jointLabel(j, lang),
               warrant: 'labDetJointW', colour: '#8FC2E8' };
    }
    const id = this.ctx.selected();
    if (!(id > 0)) return null;
    const r = get(id);
    /* A level names a vertebra, so it stops applying the moment something else is selected —
     * otherwise picking a muscle from the picture would keep the caption saying "the vertebra
     * at that level" over a muscle. */
    const level = this.focusLevelId === id ? this.focusLevel : null;
    return {
      kind: level ? 'level' : 'structure',
      id,
      name: nameOf(id, lang) || `#${id}`,
      note: level ? `${level} — ${UI.labDetLevelOf?.[lang] ?? ''}` : '',
      warrant: level ? 'labDetLevelW'
             : r?.layer === 'nervous' ? 'labDetNerveW'
             : r?.layer === 'brain' ? 'labDetBrainW' : 'labDetMuscleW',
      colour: r?.color ?? '#FFC98A',
    };
  }

  /** The two renders. Returns what was drawn, or null when there was nothing to draw. */
  paintDetail(det) {
    if (!det) {
      this.p13a.clear(); this.p13b.clear();
      return null;
    }
    const a = this.p13a, b = this.p13b;
    const at = det.kind === 'joint' ? this.ctx.jointAt?.(det.coord) : null;
    if (det.kind === 'joint' && !at) { a.clear(); b.clear(); return null; }
    /* `coord` is what lets the close view show the joint's *own* bones rather than the whole
     * skeleton framed tightly — "you must isolate that bone and show that bone only" — and the
     * frame is then solved against those bones' posed boxes by `boneVantage`.
     *
     * `JOINT_SPAN` is the fallback for a joint whose segments carry no bone mesh. It is small
     * for a reason worth keeping: `frameFor` fits a sphere into a panel twice as wide as it is
     * tall by its *height* and then shows that much again either side, so the 0.14 it started
     * at framed 1.17 body-heights wide — the whole supine figure — while calling itself a
     * close-up. Measured rather than reasoned about: see `.render/joint.mjs`. */
    const opts = det.kind === 'joint' ? { at, span: JOINT_SPAN, coord: det.coord } : {};
    const close = this.ctx.structure?.(a.canvas, a.w * a.dpr, a.h * a.dpr, det.id ?? null,
                                       { ...opts, alone: true, orbit: this.orbit('a') });
    const body = this.ctx.structure?.(b.canvas, b.w * b.dpr, b.h * b.dpr, det.id ?? null,
                                      { ...opts, alone: false, orbit: this.orbit('b') });
    if (!close) a.clear();
    if (!body) b.clear();
    return close || body ? { close, body } : null;
  }

  /* ------------------------------------------ what this exercise actually works
   * Four columns, four different kinds of warrant, each column saying which one it stands on.
   *
   * The request was "automatically choose which brain parts, which muscles, which bones and
   * which nerves are being used, and how it is helping". Every one of those has an honest
   * answer in this repository and `content/analysis.js` assembles them: the exercise's own
   * authored muscle roles and activation curve, the clip's own joint angles measured through
   * the movement, each muscle's innervation quoted from Gray's Anatomy, and the exercise's own
   * brain claims with their tiers and citations.
   *
   * What makes this panel worth having rather than dangerous is that the four are *not* the
   * same kind of statement, and it says so on each one. A muscle's share is a share of an
   * authored curve. A joint's travel is a real measurement of this animation. A nerve is
   * anatomy quoted from a textbook and carries no activity at all — there is no way in this
   * repository to say how hard a nerve is firing, and the column says that in as many words.
   * A brain region's number is a count of this exercise's claims, not an activation.
   *
   * DOM rather than canvas: this is names, numbers, citations and buttons that select things,
   * and on a canvas every one of those would be unselectable and invisible to a screen reader.
   */
  drawAnalysis(lang) {
    const T = k => UI[k]?.[lang] ?? k;
    const host = this.host.querySelector('#labAnal');
    if (!host) return;
    const a = this.ctx.analysis?.(lang);
    const stamp = `${lang}|${a?.key ?? ''}|${this.ctx.selected()}`;
    if (host.dataset.stamp === stamp) return;
    host.dataset.stamp = stamp;
    host.textContent = '';

    if (!a?.key) {
      const p = document.createElement('p');
      p.className = 'analnone';
      p.textContent = T('labAnalPick');
      host.appendChild(p);
      return;
    }

    const sel = this.ctx.selected();
    const col = (titleKey, warrantKey) => {
      const d = document.createElement('div');
      d.className = 'analcol';
      const h = document.createElement('h4');
      h.textContent = T(titleKey);
      const w = document.createElement('p');
      w.className = 'analwarrant';
      w.textContent = T(warrantKey);
      d.append(h, w);
      host.appendChild(d);
      return d;
    };
    /* One row shape for all four columns: a name, a bar where there is a number the bar can
     * honestly stand for, and the number itself. Where there is no such number — a nerve — the
     * bar is simply absent rather than drawn at some default, because a bar at a length nobody
     * measured is the fabrication this whole panel is trying not to be. */
    const row = (parent, { name, sub, frac, value, colour, onclick, tier }) => {
      const r = document.createElement(onclick ? 'button' : 'div');
      r.className = 'analrow';
      if (onclick) r.onclick = onclick;
      const top = document.createElement('span');
      top.className = 'analname';
      if (colour) {
        const dot = document.createElement('i');
        dot.style.background = colour;
        top.appendChild(dot);
      }
      top.appendChild(document.createTextNode(name));
      if (tier) {
        const t = document.createElement('em');
        t.className = 'analtier';
        t.textContent = tier;
        t.style.background = TIERS[tier]?.color ?? '#888';
        top.appendChild(t);
      }
      r.appendChild(top);
      if (frac != null) {
        const bar = document.createElement('i');
        bar.className = 'analbar';
        const fill = document.createElement('b');
        fill.style.width = `${Math.max(2, Math.min(100, frac * 100))}%`;
        if (colour) fill.style.background = colour;
        bar.appendChild(fill);
        r.appendChild(bar);
      }
      if (value != null) {
        const v = document.createElement('span');
        v.className = 'analval';
        v.textContent = value;
        r.appendChild(v);
      }
      if (sub) {
        const s2 = document.createElement('span');
        s2.className = 'analsub';
        s2.textContent = sub;
        r.appendChild(s2);
      }
      parent.appendChild(r);
      return r;
    };

    /* --- the muscles, by how much of the movement they are asked for --- */
    {
      const c = col('labAnalMuscles', 'labAnalMusclesW');
      const top = a.muscles.slice(0, 10);
      const max = Math.max(...top.map(m => m.mean), 0.01);
      for (const m of top) {
        const r = registry().byName.get(m.name);
        const nm = r ? nameOf(r.id, lang) : m.name;
        const el = row(c, {
          name: nm || m.name,
          frac: m.mean / max,
          value: m.mean > 0 ? m.mean.toFixed(2) : '—',
          colour: r ? get(r.id)?.color : null,
          /* The role and the evidence marker travel with the number, because the number is a
           * share of an authored curve and the marker is what says whether a study measured
           * that muscle in this movement or it was reasoned from the anatomy. */
          sub: `${T(ROLE_TAG[m.role] ?? 'roleTagStab')}` +
               `${m.evidence ? ` · ${m.evidence === 'emg' ? T('evEmg') : T('evInferred')}` : ''}`,
          onclick: r ? () => {
            this.focusJoint = null; this.focusLevel = null; this.ctx.select(r.id);
          } : null,
        });
        if (r && sel === r.id) el.classList.add('on');
      }
    }

    /* --- the joints, measured off the clip --- */
    {
      const c = col('labAnalJoints', 'labAnalJointsW');
      const top = a.joints.filter(j => j.travel > 1).slice(0, 10);
      const max = Math.max(...top.map(j => j.travel), 1);
      if (!top.length) {
        const p = document.createElement('p');
        p.className = 'analsub';
        p.textContent = T('labAnalHeld');
        c.appendChild(p);
      }
      for (const j of top) {
        const el = row(c, {
          name: jointLabel(j.coord, lang),
          frac: j.travel / max,
          value: `${j.travel.toFixed(0)}°`,
          sub: `${T('labAnalRange')} ${j.min.toFixed(0)}° ${T('labSectTo')} ${j.max.toFixed(0)}°`,
          /* A joint is not a structure and cannot be the selection, so it sets its own focus
           * and the 3D pair prefers that over whatever is selected. */
          onclick: () => { this.focusJoint = j.coord; this.focusLevel = null; this.draw(); },
        });
        if (this.focusJoint === j.coord) el.classList.add('on');
      }
    }

    /* --- the nerves, quoted, with no number attached to any of them --- */
    {
      const c = col('labAnalNerves', 'labAnalNervesW');
      if (a.roots?.length) {
        const strip = document.createElement('div');
        strip.className = 'analroots';
        for (const r of a.roots) {
          /* A cord level has no mesh — a nerve root is not a structure in this model — so a
           * chip shows the **vertebra at that level** instead, and the detail panel says so in
           * those words. Where there is no vertebra for it (a cranial nerve, say) the chip
           * stays a plain label rather than pointing at something that is not what it says. */
          const vid = vertebraFor(r.root);
          const b = document.createElement(vid ? 'button' : 'span');
          b.textContent = r.root;
          b.title = r.muscles.join(', ');
          if (vid) {
            b.onclick = () => {
              this.focusJoint = null;
              this.focusLevel = r.root;
              this.focusLevelId = vid;
              this.ctx.select(vid);
            };
            if (this.focusLevel === r.root) b.setAttribute('aria-current', 'true');
          }
          strip.appendChild(b);
        }
        c.appendChild(strip);
      }
      for (const n of a.nerves.slice(0, 7)) {
        const nid = nerveFor(n.text);
        const el = row(c, {
          name: n.text,
          sub: n.muscles.slice(0, 3).join(', '),
          colour: nid ? get(nid)?.color : null,
          onclick: nid ? () => {
            this.focusJoint = null; this.focusLevel = null; this.ctx.select(nid);
          } : null,
        });
        if (nid && sel === nid) el.classList.add('on');
      }
      if (!a.nerves.length) {
        const p = document.createElement('p');
        p.className = 'analsub';
        p.textContent = T('labAnalNoNerve');
        c.appendChild(p);
      }
    }

    /* --- the brain, by how many of this exercise's own claims name each region --- */
    {
      const c = col('labAnalBrain', 'labAnalBrainW');
      for (const r of a.regions) {
        const el = row(c, {
          name: nameOf(r.region, lang) || `#${r.region}`,
          frac: r.weight,
          value: `${r.claims.length}/${a.claims.length}`,
          colour: get(r.region)?.color,
          tier: r.best,
          sub: r.info?.[lang]?.does ?? r.info?.en?.does ?? '',
          onclick: () => {
            this.focusJoint = null; this.focusLevel = null; this.ctx.select(r.region);
          },
        });
        if (sel === r.region) el.classList.add('on');
      }
      if (!a.regions.length) {
        const p = document.createElement('p');
        p.className = 'analsub';
        p.textContent = T('labAnalNoBrain');
        c.appendChild(p);
      }
    }

    /* The claims themselves, under the four columns: a region name and a tier is a pointer,
     * and the thing it points at is a sentence with a citation on it. Without them this panel
     * would be four rankings with nothing to check. */
    if (a.claims.length) {
      const wrap = document.createElement('div');
      wrap.className = 'analclaims';
      const h = document.createElement('h4');
      h.textContent = `${T('labAnalWhy')} — ${a.claims.length}`;
      wrap.appendChild(h);
      for (const cl of a.claims) {
        const d = document.createElement('div');
        d.className = 'analclaim';
        const t = document.createElement('em');
        t.textContent = cl.tier;
        t.style.background = TIERS[cl.tier]?.color ?? '#888';
        const p = document.createElement('p');
        p.textContent = cl[lang]?.claim ?? cl.en?.claim ?? '';
        const cite = document.createElement('span');
        cite.textContent = cl.citation ?? '';
        d.append(t, p, cite);
        wrap.appendChild(d);
      }
      host.appendChild(wrap);
    }
  }
  /* -------------------------------------------------- the cells of one region
   * Every cell of the selected region, alone, with no brain behind it.
   *
   * The whole-brain plot is where a region is *found*; four thousand cells in a head-shaped
   * cloud is the right picture for "where is the wiring dense" and the wrong one for "let me
   * pick that cell". So this takes the region the reader has selected, drops everything else,
   * and spreads its few hundred cells across a full-width panel at a size you can aim at.
   *
   * The layout is the region's own geometry, not a graph drawing: each cell keeps its position
   * in the parcel, rotated into the plane the parcel is flattest against and scaled to the
   * panel. A cortical parcel is a sheet, so its own principal plane is very nearly the sheet
   * itself — which means this is a view of the patch face-on rather than an arrangement
   * invented to fill a box. Where two cells still land on the same pixel the layout says so
   * rather than nudging them apart, because a nudged position is a lie about a coordinate the
   * panel prints in millimetres.
   *
   * Fibres between two cells of the region are drawn; a fibre leaving the region is drawn as a
   * short stub pointing the way it goes, with the count of them in the readout — the reader
   * needs to see that the patch is not a closed world, and drawing the far end would put a
   * cell outside its own panel.
   */
  drawRegionCells(lang) {
    const T = k => UI[k]?.[lang] ?? k;
    this.p10.fit();                 // same as `drawFibres`: `w` is 0 until this has run
    const { w, h } = this.p10;
    const cell = this.ctx.cells2?.();
    const sel = this.ctx.selected();
    const hov = this.rcHover ?? -1;

    /* The region's own cells, found before the cache key rather than after it, because one of
     * them gets traced without being asked for and the key has to know which.
     *
     * A panel that says "click a cell to trace it" and shows nothing until you do leaves the
     * reader to work through several hundred identical specks looking for one worth opening.
     * So the panel opens on the region's **most connected** cell — the one with the most of
     * this network's own fibres on it — and the trace beside it says that is why it was
     * picked. A count of edges is a fact about the model and is printed as a count; it is not
     * a claim that this cell matters more than another in a brain, and the trace's own caption
     * already says what a cell in this network stands for.
     *
     * It only fires when nothing is traced or the trace belongs to another region. Clicking a
     * cell anywhere — this panel, the whole-brain plot, a row of the trace — selects that
     * cell's region too, so a reader's own pick always satisfies the guard and is never
     * overridden by this. */
    const mine = [];
    if (cell?.count && sel > 0)
      for (let i = 0; i < cell.count; i++) if (cell.region(i) === sel) mine.push(i);
    if (mine.length && !(this.tracedCell >= 0 && cell.region(this.tracedCell) === sel)) {
      this.tracedCell = hubOf(cell, mine);
      this._traceAuto = true;      // the heading has to say so: "the cell you picked" would be false
    }
    const traced = this.tracedCell ?? -1;

    const key = [lang, w, h, cell?.count ?? 0, sel, traced, hov].join('|');
    if (key === this._rcKey) return;
    this._rcKey = key;

    const c = this.p10.clear();
    this.rcPts = [];
    const read = this.host.querySelector('#labF10');
    if (read) read.textContent = '';

    if (!cell?.count) { label(c, T('connNone'), PAD, h / 2, { colour: DIM }); return; }
    /* No region chosen is a state, not a failure: say which way round it works, on the canvas
     * and in the readout both, rather than leaving an empty box that looks broken. */
    if (!mine.length) {
      const msg = sel > 0 ? T('labRegionNoCells') : T('labRegionPick');
      for (const [k, line] of wrapTo(c, msg, Math.min(560, w - 40), 12).entries())
        label(c, line, w / 2, h / 2 + k * 17, { colour: DIM, size: 12, caps: false, align: 'center' });
      if (read) read.textContent = msg;
      return;
    }

    /* The parcel's own principal plane. Two passes of a covariance on the cell positions: the
     * smallest eigenvector is the sheet's normal, so the other two span the sheet. Done as a
     * power iteration on the 3x3 rather than pulling in a solver — three axes, twenty
     * iterations, and it runs when the selection changes rather than per frame. */
    const n = mine.length;
    let mx = 0, my = 0, mz = 0;
    for (const i of mine) { const p = cell.pos(i); mx += p.x; my += p.y; mz += p.z; }
    mx /= n; my /= n; mz /= n;
    const C = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (const i of mine) {
      const p = cell.pos(i);
      const d = [p.x - mx, p.y - my, p.z - mz];
      for (let a = 0; a < 3; a++) for (let b2 = 0; b2 < 3; b2++) C[a * 3 + b2] += d[a] * d[b2];
    }
    const mul = (M, v) => [M[0] * v[0] + M[1] * v[1] + M[2] * v[2],
                           M[3] * v[0] + M[4] * v[1] + M[5] * v[2],
                           M[6] * v[0] + M[7] * v[1] + M[8] * v[2]];
    const norm = v => { const L = Math.hypot(...v) || 1; return [v[0] / L, v[1] / L, v[2] / L]; };
    const dot3 = (a, b2) => a[0] * b2[0] + a[1] * b2[1] + a[2] * b2[2];
    const power = (M, seed) => {
      let v = norm(seed);
      for (let k = 0; k < 24; k++) v = norm(mul(M, v));
      return v;
    };
    const e1 = power(C, [1, 0.3, 0.2]);
    // deflate, so the second axis is the largest one orthogonal to the first
    const l1 = dot3(e1, mul(C, e1));
    const D = C.map((v, k) => v - l1 * e1[(k / 3) | 0] * e1[k % 3]);
    const e2raw = power(D, [0.2, 1, 0.3]);
    const p2 = dot3(e2raw, e1);
    const e2 = norm([e2raw[0] - p2 * e1[0], e2raw[1] - p2 * e1[1], e2raw[2] - p2 * e1[2]]);

    const uv = i => {
      const p = cell.pos(i);
      const d = [p.x - mx, p.y - my, p.z - mz];
      return [dot3(d, e1), dot3(d, e2)];
    };

    const M = 34;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const i of mine) {
      const [u, v] = uv(i);
      u0 = Math.min(u0, u); u1 = Math.max(u1, u);
      v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
    const s = Math.min((w - M * 2) / ((u1 - u0) || 1), (h - M * 2) / ((v1 - v0) || 1));
    const ox = (w - (u1 - u0) * s) / 2, oy = (h - (v1 - v0) * s) / 2;
    const PX = u => ox + (u - u0) * s;
    const PY = v => h - (oy + (v - v0) * s);

    const col = get(sel)?.color ?? WARM[0];
    const inside = new Set(mine);

    /* The fibres. Inside the region drawn whole; leaving it drawn as a stub, because the far
     * end is not on this panel and a line running off the edge says nothing about where. */
    const pairs = cell.pairs ?? [];
    let out = 0, within = 0;
    c.lineWidth = 1;
    for (let k = 0; k + 1 < pairs.length; k += 2) {
      const i = pairs[k], j = pairs[k + 1];
      const ai = inside.has(i), aj = inside.has(j);
      if (!ai && !aj) continue;
      const lit = i === hov || j === hov || i === traced || j === traced;
      if (ai && aj) {
        within++;
        const [ux, uy] = uv(i), [vx, vy] = uv(j);
        c.strokeStyle = lit ? '#FFE9C6' : col;
        c.globalAlpha = lit ? 0.95 : 0.22;
        c.beginPath();
        c.moveTo(PX(ux), PY(uy)); c.lineTo(PX(vx), PY(vy));
        c.stroke();
      } else {
        out++;
        const src = ai ? i : j, far = ai ? j : i;
        const [ux, uy] = uv(src);
        const p = cell.pos(far), q = cell.pos(src);
        const d = [p.x - q.x, p.y - q.y, p.z - q.z];
        // the stub points the way the fibre goes, in this panel's own plane
        const du = dot3(d, e1), dv = dot3(d, e2);
        const L = Math.hypot(du, dv) || 1;
        const x = PX(ux), y = PY(uy);
        c.strokeStyle = lit ? '#FFE9C6' : '#9FD4FF';
        c.globalAlpha = lit ? 0.9 : 0.30;
        c.beginPath();
        c.moveTo(x, y);
        c.lineTo(x + (du / L) * 14, y - (dv / L) * 14);
        c.stroke();
      }
    }
    c.globalAlpha = 1;

    /* The cells, big. This panel exists because a cell in the whole-brain plot is a point you
     * cannot aim at; a dot here that was the same size would be the same failure moved. */
    const r = Math.max(3.2, Math.min(9, 380 / Math.sqrt(n * 12)));
    for (const i of mine) {
      const [u, v] = uv(i);
      const x = PX(u), y = PY(v);
      this.rcPts.push({ i, x, y, r });
      const on = i === traced, over = i === hov;
      c.fillStyle = on ? '#FFF3DA' : col;
      c.globalAlpha = on || over ? 1 : 0.85;
      c.shadowColor = col; c.shadowBlur = on ? 14 : (over ? 9 : 0);
      c.beginPath(); c.arc(x, y, r + (on ? 1.6 : 0), 0, Math.PI * 2); c.fill();
      c.shadowBlur = 0;
      if (on || over) {
        c.strokeStyle = on ? 'rgba(255,255,255,.95)' : 'rgba(255,255,255,.6)';
        c.lineWidth = on ? 1.4 : 1;
        c.beginPath(); c.arc(x, y, r + 5, 0, Math.PI * 2); c.stroke();
      }
    }
    c.globalAlpha = 1;

    // the name of the cell under the pointer, on the picture, beside it
    if (hov >= 0) {
      const pt = this.rcPts.find(q => q.i === hov);
      if (pt) {
        const txt = `${T('labCellNo')} ${String(hov).padStart(5, '0')}`;
        c.font = '10px "Helvetica Neue", Helvetica, Arial, sans-serif';
        const tw = c.measureText(txt).width;
        const lx = Math.min(pt.x + pt.r + 8, w - tw - 8);
        const ly = Math.max(pt.y + 3, 12);
        c.fillStyle = 'rgba(6,11,20,.85)';
        c.fillRect(lx - 4, ly - 10, tw + 8, 14);
        label(c, txt, lx, ly, { colour: INK, size: 10, caps: false });
      }
    }

    /* A scale bar, because this is a real patch of cortex at a real size and without one the
     * panel reads as a diagram. It is the parcel's own extent, so a small parcel is drawn as
     * large as a big one and only the bar says which is which. */
    const bar = 10 * FRAME.scale * s;
    if (bar > 20 && bar < w - M * 2) {
      c.strokeStyle = RULE; c.lineWidth = 1;
      const yb = h - 16;
      c.beginPath();
      c.moveTo(M, yb); c.lineTo(M + bar, yb);
      c.moveTo(M, yb - 3); c.lineTo(M, yb + 3);
      c.moveTo(M + bar, yb - 3); c.lineTo(M + bar, yb + 3);
      c.stroke();
      label(c, '10 mm', M + bar + 7, yb + 3, { colour: DIM2, size: 9 });
    }

    if (read) {
      const add = (text, cls) => {
        const el = document.createElement('span');
        if (cls) el.className = cls;
        el.textContent = text;
        read.appendChild(el);
      };
      const dot = document.createElement('span');
      dot.className = 'fibdot';
      dot.style.background = col;
      read.appendChild(dot);
      add(`${nameOf(sel, lang)} · ${n.toLocaleString()} ${T('labCells')} · ` +
          `${within.toLocaleString()} ${T('labRcWithin')} · ${out.toLocaleString()} ${T('labRcOut')}`);
      if (hov >= 0) {
        add(` · ${T('labCellNo')} ${String(hov).padStart(5, '0')} · ${this.mmOf(cell.pos(hov))}`,
            'fibhit');
      } else {
        add(` · ${T('labRcPick')}`, 'fibhint');
      }
    }
  }
  /**
   * Which cell is under a point of the fibre chart, or -1.
   *
   * Scans all four thousand, which is nothing beside what the panel draws, and takes the
   * nearest within a radius that grows with the dot — at high zoom the cells are far apart and
   * a fixed pick radius makes the reader aim at a target smaller than the thing they can see.
   */
  cellAtFibre(x, y) {
    const cell = this.ctx.cells2?.();
    const F = this.fibProj;
    if (!cell?.count || !F) return -1;
    const r = Math.max(7, Math.min(4.5, 0.6 + (this.fibZoom ?? 1) * 0.75) + 5);
    let best = -1, bd = r * r;
    for (let i = 0; i < cell.count; i++) {
      const p = cell.pos(i);
      const d = (F.PX(F.P.u(p)) - x) ** 2 + (F.Y(F.P.v(p)) - y) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  /* ------------------------------------------------------- anatomy of a cell
   * What one speck and one thread actually are, drawn once at a size you can see.
   *
   * The report this answers was "I can see small lights going through the cells very fast — I
   * want to understand where they start, where they flow and where they end up", and no amount
   * of prose beside a four-thousand-point cloud was going to answer it. One cell, one fibre,
   * one band, labelled, moving at the speed the picture moves at.
   *
   * The honest part is the caption underneath, and it has to stay: the band is an animation of
   * *direction*, not a recorded signal. There is no electrophysiology in this application.
   */
  drawCellKey(lang) {
    const c = this.p6.clear();
    const { w, h } = this.p6;
    const T = k => UI[k]?.[lang] ?? k;
    const cell = this.ctx.cells2?.();
    const t = this.clock ?? 0;
    const traced = this.tracedCell ?? -1;

    /* Which cell is being traced, on the panel's own host, so a probe can tell the traced
     * state from the key state without reading pixels — the two look different and a test
     * that could not tell them apart would pass on either. */
    const host6 = this.host.querySelector('#labP6');
    if (cell?.count && traced >= 0 && traced < cell.count) {
      if (host6) host6.dataset.cell = String(traced);
      this.drawTrace(c, w, h, cell, traced, t, lang);
      return;
    }
    if (host6) delete host6.dataset.cell;

    /* Nothing picked yet: the key, which is what one speck and one thread are. It stays,
     * because a reader who has not clicked anything needs to know what they are looking at
     * before they can decide which one to click. */
    const y = h * 0.46;
    const ax = Math.max(96, w * 0.16), bx = Math.min(w - 96, w * 0.84);

    // the fibre
    c.strokeStyle = 'rgba(255,158,94,.55)';
    c.lineWidth = 1.6;
    c.beginPath(); c.moveTo(ax, y); c.lineTo(bx, y); c.stroke();

    // the travelling band, at the same speed and shape the shader draws
    const head = (t * 0.28) % 1;
    for (let i = 0; i < 90; i++) {
      const u = i / 89;
      let d = Math.abs(u - head); d = Math.min(d, 1 - d);
      const spike = Math.exp(-d * d * 900);
      if (spike < 0.02) continue;
      c.fillStyle = `rgba(255,240,206,${spike})`;
      c.shadowColor = '#FFF0CE'; c.shadowBlur = 10 * spike;
      c.fillRect(ax + (bx - ax) * u - 1.5, y - 2, 3, 4);
      c.shadowBlur = 0;
    }

    // the two cell bodies, with an arbor on the sending one
    const soma = (x, lit) => {
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2 + 0.4;
        c.strokeStyle = 'rgba(255,158,94,.30)'; c.lineWidth = 1;
        c.beginPath(); c.moveTo(x, y);
        c.lineTo(x + Math.cos(a) * 26, y + Math.sin(a) * 22);
        c.stroke();
      }
      c.fillStyle = lit ? '#FFF0D2' : '#E07B45';
      c.shadowColor = lit ? '#FFF0D2' : '#E07B45'; c.shadowBlur = lit ? 16 : 8;
      c.beginPath(); c.arc(x, y, 6.5, 0, Math.PI * 2); c.fill();
      c.shadowBlur = 0;
    };
    soma(ax, head < 0.12);
    soma(bx, head > 0.88);

    label(c, T('keySoma'), ax, y + 52, { colour: DIM, size: 10, caps: false, align: 'center' });
    label(c, T('keyArbor'), ax, y + 66, { colour: DIM2, size: 9, caps: false, align: 'center' });
    label(c, T('keyFibre'), (ax + bx) / 2, y - 22, { colour: DIM, size: 10, caps: false,
                                                     align: 'center' });
    label(c, T('keyBand'), (ax + bx) / 2, y + 30, { colour: '#FFD9A0', size: 10, caps: false,
                                                    align: 'center' });
    label(c, T('keyTarget'), bx, y + 52, { colour: DIM, size: 10, caps: false, align: 'center' });
    // the direction, so "where does it start and where does it end" has an answer on the picture
    c.strokeStyle = 'rgba(255,217,160,.55)'; c.lineWidth = 1;
    const ay2 = y + 14;
    c.beginPath(); c.moveTo(ax + 20, ay2); c.lineTo(bx - 20, ay2);
    c.moveTo(bx - 26, ay2 - 4); c.lineTo(bx - 20, ay2); c.lineTo(bx - 26, ay2 + 4);
    c.stroke();
    label(c, T('labTraceHint'), w / 2, h - 10, { colour: DIM2, size: 9, caps: false,
                                                 align: 'center' });
  }

  /**
   * One chosen cell, everything true of it, and every fibre that actually leaves it.
   *
   * Not a diagram of a neuron — a trace of *this* cell. The fibres are the network's own index
   * pairs, the targets are the cells at the other end of them, the lengths are the real
   * distances between the two, and the band's traversal time is the number the shader is
   * animating with. Where the key above says what a cell is, this says what this one is, where
   * it goes, how fast the thing you can see on it moves, why the fibre is there at all, and
   * what the region it sits in is understood to do.
   *
   * **Five answers, and what each of them is allowed to be.** "Which cell" is its index and its
   * Desikan-Killiany parcel, both real. "Where does it go" is the target cell and its parcel,
   * real. "How far" is Euclidean distance in fsaverage millimetres, real. "How fast" is the
   * band's own traversal time and the screen speed that implies — an animation rate, stated as
   * one, beside the published conduction velocities of real axons so the reader can see the
   * six orders of magnitude between them. "Why is it there" is which of the build's two rules
   * put it there, which is a fact about this model and not about a brain. And "what does it
   * mean" is the parcel's documented function and the evidence tier of the claims attached to
   * it, both cited.
   *
   * What none of them may be is a measurement of a neuron. There is no electrophysiology in
   * this repository, a cell here stands for a population far below the resolution of anything
   * in it, and the fibres are a nearest-neighbour construction rather than tractography.
   */
  drawTrace(c, w, h, cell, idx, t, lang) {
    const T = k => UI[k]?.[lang] ?? k;
    const src = cell.pos(idx);
    const reg = cell.region(idx);
    const pairs = cell.pairs ?? [];

    /* Its own fibres, from the network's index pairs. Undirected in the buffer, so both
     * orderings count — a fibre that arrives at this cell is one of its fibres too.
     *
     * Cached on the index, because this panel is redrawn a couple of dozen times a second to
     * animate the band and the scan is over every edge in the network. Nothing about the
     * answer changes between frames. */
    let outs;
    if (this._traceOf === idx) {
      outs = this._traceOuts;
    } else {
      outs = [];
      for (let k = 0; k + 1 < pairs.length; k += 2) {
        const i = pairs[k], j = pairs[k + 1];
        const other = i === idx ? j : (j === idx ? i : -1);
        if (other < 0) continue;
        const p = cell.pos(other);
        const rate = cell.rate?.(k >> 1) ?? 0;
        outs.push({
          i: other, p, region: cell.region(other),
          d: Math.hypot(p.x - src.x, p.y - src.y, p.z - src.z),
          long: cell.long?.(k >> 1) ?? false,
          // one traversal of the band, in seconds of screen time: head = fract(t·rate·BAND)
          secs: rate > 0 ? 1 / (rate * BAND_RATE) : 0,
        });
      }
      outs.sort((a, b) => a.d - b.d);
      this._traceOf = idx;
      this._traceOuts = outs;
    }

    /* The plot half. Framed on the cell and its own targets rather than on the whole brain:
     * this is a close-up of one neighbourhood, and at brain scale every fibre here is a few
     * pixels long. */
    const PW = Math.round(w * 0.40);
    let z0 = src.z, z1 = src.z, y0 = src.y, y1 = src.y;
    for (const o of outs) {
      z0 = Math.min(z0, o.p.z); z1 = Math.max(z1, o.p.z);
      y0 = Math.min(y0, o.p.y); y1 = Math.max(y1, o.p.y);
    }
    const M = 26;
    const span = Math.max(z1 - z0, y1 - y0, 1e-4) * 1.18;
    const cz = (z0 + z1) / 2, cy = (y0 + y1) / 2;
    const s = Math.min(PW - M * 2, h - M * 2) / span;
    const PX = z => PW / 2 + (z - cz) * s;
    const PY = y => h / 2 - (y - cy) * s;

    const head = (t * 0.28) % 1;
    const col = get(reg)?.color ?? '#E07B45';
    const hov = this.traceHover ?? -1;
    this.tracePts = [];

    for (const o of outs) {
      const ax = PX(src.z), ay = PY(src.y), bx = PX(o.p.z), by = PY(o.p.y);
      const lit = o.i === hov;
      /* A long-range fibre is drawn as one: the build makes a small minority of them and they
       * are the reason the network reads as connected rather than as a mesh, so a reader
       * should be able to see which is which without reading the row. */
      c.setLineDash(o.long ? [4, 3] : []);
      c.strokeStyle = lit ? '#FFE9C6' : 'rgba(255,158,94,.42)';
      c.lineWidth = lit ? 1.8 : 1.1;
      c.beginPath(); c.moveTo(ax, ay); c.lineTo(bx, by); c.stroke();
      c.setLineDash([]);
      // the band, at the rate the shader runs this fibre at
      const u = (t / (o.secs || 1)) % 1;
      c.fillStyle = 'rgba(255,240,206,.95)';
      c.shadowColor = '#FFF0CE'; c.shadowBlur = 8;
      c.beginPath(); c.arc(ax + (bx - ax) * u, ay + (by - ay) * u, 2.2, 0, Math.PI * 2); c.fill();
      c.shadowBlur = 0;
      // the target cell, in its own region's colour
      const oc = get(o.region)?.color ?? '#7C8EA8';
      c.fillStyle = oc; c.shadowColor = oc; c.shadowBlur = lit ? 12 : 6;
      c.beginPath(); c.arc(bx, by, lit ? 5.5 : 4, 0, Math.PI * 2); c.fill();
      c.shadowBlur = 0;
      this.tracePts.push({ i: o.i, x: bx, y: by, r: 8 });
    }

    // the chosen cell, with its arbor
    const sx = PX(src.z), sy = PY(src.y);
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2 + 0.4;
      c.strokeStyle = 'rgba(255,158,94,.26)'; c.lineWidth = 1;
      c.beginPath(); c.moveTo(sx, sy);
      c.lineTo(sx + Math.cos(a) * 20, sy + Math.sin(a) * 18);
      c.stroke();
    }
    c.fillStyle = '#FFF0D2'; c.shadowColor = col; c.shadowBlur = 18;
    c.beginPath(); c.arc(sx, sy, 7, 0, Math.PI * 2); c.fill();
    c.shadowBlur = 0;
    c.strokeStyle = 'rgba(255,255,255,.85)'; c.lineWidth = 1;
    c.beginPath(); c.arc(sx, sy, 12, 0, Math.PI * 2); c.stroke();

    const mm = u => u / FRAME.scale;
    const bar = 10 * FRAME.scale * s;    // a 10 mm rule, so the close-up carries its own scale
    c.strokeStyle = RULE; c.lineWidth = 1;
    c.beginPath(); c.moveTo(M, h - 22); c.lineTo(M + bar, h - 22);
    c.moveTo(M, h - 25); c.lineTo(M, h - 19);
    c.moveTo(M + bar, h - 25); c.lineTo(M + bar, h - 19);
    c.stroke();
    label(c, '10 mm', M + bar + 7, h - 19, { colour: DIM2, size: 9 });
    label(c, T('labTraceDash'), M, 18, { colour: DIM2, size: 9, caps: false });

    /* The reading. Which cell, where it is, what its parcel does, then the fibres one row
     * each: where it goes, how far, how long the band takes, and which rule made it. The
     * middle column is the part a picture cannot say. */
    const LX = PW + 16;
    const CW = Math.floor((w - LX - 16) / 2) - 12;
    let ly = 22;
    /* "The cell you picked" is false when the panel picked it, and a heading that says a
     * reader did something they did not is the small kind of lie that makes the honest parts
     * harder to trust. */
    label(c, T(this._traceAuto ? 'labTraceAutoCell' : 'labTraceCell'), LX, ly,
          { colour: DIM2, size: 9 });
    ly += 18;
    c.fillStyle = col;
    c.beginPath(); c.arc(LX + 5, ly - 4, 5, 0, Math.PI * 2); c.fill();
    label(c, `${T('labCellNo')} ${String(idx).padStart(5, '0')} · ${nameOf(reg, lang) || T('labNoParcel')}`,
          LX + 16, ly, { colour: INK, size: 12.5, caps: false });
    ly += 16;
    label(c, `${T('labTraceAt')} ${this.mmOf(src)}`, LX, ly, { colour: DIM, size: 10, caps: false });
    ly += 20;

    /* What the parcel does, from REGION_INFO — the same sentence the cell probe on the stage
     * shows, so one structure is described one way wherever it is met. */
    const info = REGION_INFO[reg]?.[lang] ?? REGION_INFO[reg]?.en;
    if (info?.does) {
      for (const line of wrapTo(c, info.does, CW * 2 + 24, 10.5).slice(0, 3)) {
        label(c, line, LX, ly, { colour: DIM, size: 10.5, caps: false });
        ly += 14;
      }
      ly += 6;
    }

    /* The best evidence behind anything this application claims about that region. A tier and
     * a citation, never a number without one. */
    const claims = claimsForRegion(reg);
    if (claims.length) {
      const best = ['A', 'B', 'C', 'D', 'E'].find(x => claims.some(q => q.tier === x)) ?? 'E';
      const chip = TIERS[best]?.color ?? '#888';
      c.fillStyle = chip;
      c.fillRect(LX, ly - 8, 14, 12);
      c.fillStyle = '#06121c';
      c.font = '9px "Helvetica Neue", Helvetica, Arial, sans-serif';
      c.textAlign = 'center';
      c.fillText(best, LX + 7, ly + 1);
      c.textAlign = 'left';
      label(c, `${claims.length} ${T('labTraceClaims')} · ${T('labTraceBest')} ${best}`,
            LX + 20, ly, { colour: DIM, size: 10, caps: false });
      ly += 20;
    }

    /* How fast the band moves, and what that is not. The traversal time is the shader's own
     * number; the screen speed follows from it and the fibre's real length; the comparison is
     * literature and is labelled as literature. Six orders of magnitude apart, which is the
     * point of printing both. */
    const meanSecs = outs.length ? outs.reduce((a, o) => a + o.secs, 0) / outs.length : 0;
    const meanMm = outs.length ? mm(outs.reduce((a, o) => a + o.d, 0) / outs.length) : 0;
    if (meanSecs > 0) {
      label(c, T('labTraceSpeedH'), LX, ly, { colour: DIM2, size: 9 });
      ly += 15;
      const line = `${meanSecs.toFixed(1)} s ${T('labTraceCross')} · ` +
                   `${(meanMm / meanSecs).toFixed(1)} mm/s ${T('labTraceOnScreen')}`;
      label(c, line, LX, ly, { colour: INK, size: 11, caps: false });
      ly += 15;
      for (const l of wrapTo(c, T('labTraceSpeedNote'), CW * 2 + 24, 10)) {
        label(c, l, LX, ly, { colour: DIM2, size: 10, caps: false });
        ly += 13;
      }
      ly += 8;
    }

    /* The fibres, one row each, in the second column when there is room for two. */
    const col2 = LX + CW + 24;
    const rowsLeft = Math.max(0, Math.floor((h - ly - 22) / 15));
    label(c, `${outs.length} ${T('labTraceFibres')}`, col2, 22, { colour: DIM2, size: 9 });
    let ry = 37;
    const others = new Set(outs.map(o => o.region).filter(r => r !== reg));
    label(c, others.size
            ? `${T('labTraceReaches')} ${others.size} ${T('labTraceOther')}`
            : T('labTraceLocal'),
          col2, ry, { colour: DIM, size: 10, caps: false });
    ry += 18;
    const room = Math.max(0, Math.floor((h - ry - 26) / 15));
    for (const o of outs.slice(0, room)) {
      const oc = get(o.region)?.color ?? '#7C8EA8';
      const lit = o.i === hov;
      if (lit) {
        c.fillStyle = 'rgba(255,233,198,.10)';
        c.fillRect(col2 - 4, ry - 11, w - col2 - 8, 15);
      }
      c.fillStyle = oc;
      c.fillRect(col2, ry - 7, 6, 6);
      const name = nameOf(o.region, lang) || T('labNoParcel');
      label(c, `${String(o.i).padStart(5, '0')} · ${name}`, col2 + 13, ry,
            { colour: lit ? INK : DIM, size: 10, caps: false });
      label(c, `${mm(o.d).toFixed(1)} mm · ${o.secs.toFixed(1)} s${o.long ? ' ·' : ''}`,
            w - (o.long ? 22 : 10), ry, { colour: DIM2, size: 10, caps: false, align: 'right' });
      if (o.long) label(c, '⋯', w - 10, ry, { colour: '#9FD4FF', size: 11, caps: false, align: 'right' });
      this.tracePts.push({ i: o.i, x: col2 + 60, y: ry - 4, r: 0, row: [col2 - 4, ry - 11, w - col2 - 8, 15] });
      ry += 15;
    }
    if (outs.length > room) {
      label(c, `+${outs.length - room} ${T('labTraceMore')}`, col2, ry + 4,
            { colour: DIM2, size: 9, caps: false });
    }
    void rowsLeft;
    label(c, T('labTraceClear'), LX, h - 10, { colour: DIM2, size: 9, caps: false });
  }

  /* --------------------------------------------------------- cells by region
   * The four thousand cells, grouped and counted. "Is it possible to explain them in detail and
   * in group" — this is the group half: every parcel the network samples, how many cells it
   * holds, and what share of the whole that is. Clicking a row selects it everywhere.
   */
  drawRoster(lang) {
    const c = this.p7.clear();
    const { w, h } = this.p7;
    const g = this.ctx.graph();
    this.rosterRows = [];
    if (!g?.nodes.length) { label(c, UI.connNone?.[lang] ?? '', PAD, h / 2, { colour: DIM }); return; }
    const rows = [...g.nodes].sort((a, b) => b.count - a.count);
    const total = rows.reduce((a, n) => a + n.count, 0) || 1;
    const max = rows[0].count || 1;
    const cols = w > 900 ? 2 : 1;
    const colW = (w - PAD * 2 - (cols - 1) * 26) / cols;
    const rowH = Math.min(22, (h - 20) / Math.ceil(rows.length / cols));
    const focus = this.ctx.selected();
    rows.forEach((n, i) => {
      const col = Math.floor(i / Math.ceil(rows.length / cols));
      const idx = i % Math.ceil(rows.length / cols);
      const x = PAD + col * (colW + 26);
      const y = 12 + idx * rowH;
      const on = focus === n.region;
      const name = nameOf(n.region, lang);
      c.font = '11px "Helvetica Neue", Helvetica, Arial, sans-serif';
      const labW = 138;
      label(c, name, x, y + 11, { colour: on ? INK : DIM, size: 11, caps: false });
      const bx = x + labW, bw = colW - labW - 46;
      c.fillStyle = 'rgba(150,185,230,.08)';
      c.fillRect(bx, y + 3, bw, 9);
      const col2 = get(n.region)?.color ?? WARM[0];
      c.fillStyle = col2;
      c.shadowColor = col2; c.shadowBlur = on ? 10 : 4;
      c.fillRect(bx, y + 3, bw * (n.count / max), 9);
      c.shadowBlur = 0;
      label(c, `${n.count}`, x + colW, y + 11,
            { colour: on ? INK : DIM2, size: 10.5, caps: false, align: 'right' });
      this.rosterRows.push({ region: n.region, x, y, w: colW, h: rowH });
      void total;
    });
  }

  /* ------------------------------------------------------------------ tiles */
  tiles(g) {
    const lang = this.ctx.lang();
    const T = k => UI[k]?.[lang] ?? k;
    const reg = registry();
    const ex = this.ctx.exercise();
    const rows = [
      [T('hudStructures'), reg ? reg.byId.size : 0],
      /* The network's own node count, so this agrees with the readout on the stage. The
       * connectome panel below counts only the cells in *named* parcels, which is a smaller
       * number for a good reason and is explained where it is used — two different numbers
       * both labelled "cells" on one screen would be a puzzle rather than a reading. */
      [T('hudNodes'), (this.ctx.cells?.() ?? 0).toLocaleString()],
      [T('connCount'), g ? g.nodes.length : '—'],
      [T('connLinks'), g ? g.edges.length : '—'],
      [T('labClaims'), Object.keys(EXERCISE_BRAIN).length],
      [T('labExercises'), Object.keys(EXERCISE).length],
    ];
    const host = this.host.querySelector('#labTiles');
    host.innerHTML = rows.map(([k, v]) =>
      `<div class="labtile"><b></b><span></span></div>`).join('');
    [...host.children].forEach((el, i) => {
      el.querySelector('b').textContent = String(rows[i][1]);
      el.querySelector('span').textContent = rows[i][0];
    });
    void ex;
  }

  /* ------------------------------------------------------- the connectome
   * A real scene: the cells where they actually are, the fibres between them, and the cortex's
   * own surface around them, turned with the mouse. See `connectome3d.js`.
   *
   * The ring it replaced was a projection, and a projection is exactly what a reader kept
   * asking to get out of — "I want to see it from different angles and choose the parts, just
   * like the brain". A region here is a place rather than a slice of a circle.
   */
  drawRadial(g, lang) {
    void g;
    if (!this.c3d.init()) return;
    const host = this.host.querySelector('#labP1');
    this.c3d.resize(host.clientWidth, C3D_H);
    const cell = this.ctx.cells2?.();
    if (cell?.count) this.c3d.build(cell, this.ctx.cortex?.());
    const sel = this.ctx.selected();
    this.c3d.setSelected(sel);
    /* Turn to it, but only when the choice is new. Lighting a region's cells is not enough by
     * itself: a region on the far side of the head is lit behind the near hemisphere and
     * nothing appears to happen. Guarded on a change because this runs on every draw, and a
     * view that re-aims itself every frame cannot be turned by the reader at all. */
    if (sel !== this._c3dSel) { this._c3dSel = sel; this.c3d.faceRegion(sel); }
    this.readout3d(lang);
  }

  /** The name of whatever is under the pointer, over the scene rather than beside it. */
  readout3d(lang = this.ctx.lang()) {
    const el = this.host.querySelector('#c3dRead');
    const hint = this.host.querySelector('#c3dHint');
    if (!el) return;
    const id = this.c3d.hover >= 0 ? this.c3d.hover : this.ctx.selected();
    const g = this.ctx.graph();
    const node = g?.nodes.find(n => n.region === id);
    /* A region with no node in this network is not a failure to display and must not look like
     * one. The network is built from the *cortex's own vertices*, so it carries the thirteen
     * Desikan-Killiany parcels and nothing else: the cerebellum and the brainstem come out of
     * the segmentation as their own meshes, and every deep structure — hippocampus, amygdala,
     * thalamus, basal ganglia — has no cortical vertex to be sampled from. Selecting one used
     * to print its name against an unchanged picture, which reads as broken; seeding cells for
     * it so the picture responded would be worse, because those cells would be invented.
     * So it says which it is. */
    const name = id >= 0 ? nameOf(id, lang) : '';
    el.textContent = !name ? ''
      : node ? `${name} · ${node.count.toLocaleString()} ${UI.labCells?.[lang] ?? ''}`
      : `${name} — ${UI.labNoCells?.[lang] ?? ''}`;
    el.classList.toggle('nocells', !!name && !node);
    if (hint) hint.textContent = UI.c3dHint?.[lang] ?? '';
  }

  /* ------------------------------------------------------------- region map
   * The same network with each region where it actually is, seen from the side.
   *
   * The point of it beside the connectome is that the ring throws the anatomy away — a parcel's
   * place on a circle is an ordering, not a position — and this puts it back. So it is worth
   * spending the space on making it legible as a *brain*: the cell cloud's own outline behind
   * the nodes, so a reader can see which end is the front without being told, and every region
   * named on the picture rather than only on hover.
   */
  drawRegionMap(g, lang) {
    const c = this.p2.clear();
    const { w, h } = this.p2;
    this.regionPts = [];
    if (!g?.nodes.length) { label(c, UI.connNone?.[lang] ?? '', PAD, h / 2, { colour: DIM }); return; }

    const cell = this.ctx.cells2?.();
    /* A lateral render of the real brain, in the cortex geometry's own frame — the frame the
     * nodes are in — with the rectangle it covers, so it is placed rather than fitted. See
     * `brainPlate.js`: it is the fsaverage surface and every deep structure, drawn by the
     * app's own renderer from the same buffers the scene uses. The outline this replaced was
     * traced from the cell cloud, which is honest and is also a blob: the cells sample a
     * folded sheet, so their hull carries none of the shape a reader recognises as a brain. */
    const plate = this.ctx.plate?.();

    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    const bump = (z, y) => { x0 = Math.min(x0, z); x1 = Math.max(x1, z);
                             y0 = Math.min(y0, y); y1 = Math.max(y1, y); };
    /* Framed on the brain rather than on the nodes when there is a brain to frame on. The
     * parcel centroids sit well inside the surface, so fitting the panel to them and then
     * drawing the plate underneath pushes the temporal pole and the occiput off the edge. */
    if (plate?.rect) { bump(plate.rect.z0, plate.rect.y0); bump(plate.rect.z1, plate.rect.y1); }
    else if (cell?.count) for (let i = 0; i < cell.count; i += 7) { const p = cell.pos(i); bump(p.z, p.y); }
    else for (const n of g.nodes) bump(n.z, n.y);

    /* The names go in a lane on each side of the brain rather than on top of it, so the
     * margins are what the longest name needs and the subject gets everything else. Placed
     * against the silhouette, not against the edges of the panel: a rope that runs a hundred
     * pixels across empty page reads as a line drawn over the picture, which is the mistake
     * the stage's own label lanes made once and had to be measured out of. */
    c.font = `${NAME_PX}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
    const named = g.nodes.map(n => nameOf(n.region, lang)).filter(Boolean);
    const lane = Math.min(Math.max(...named.map(t => c.measureText(t).width), 40) + LEAD + 10,
                          w * 0.26);
    const MY = 18;
    const s = Math.min((w - lane * 2) / ((x1 - x0) || 1), (h - MY * 2) / ((y1 - y0) || 1));
    const ox = (w - (x1 - x0) * s) / 2, oy = (h - (y1 - y0) * s) / 2;
    const PX = z => ox + (z - x0) * s;
    const PY = y => h - (oy + (y - y0) * s);

    if (plate?.image && plate.rect) {
      const { z0, z1, y0: ry0, y1: ry1 } = plate.rect;
      /* The plate's alpha is its own mask, so it composites with no matte. Drawn at a low
       * opacity because it is the ground and the graph is the subject: at full strength the
       * folds are busier than the edges laid over them and the network stops reading. */
      c.save();
      c.globalAlpha = 0.74;
      c.drawImage(plate.image, PX(z0), PY(ry1), PX(z1) - PX(z0), PY(ry0) - PY(ry1));
      c.restore();
    } else if (cell?.count) {
      /* No plate yet — the brain layer has not loaded, or the renderer refused the readback.
       * Fall back to the cloud's own silhouette: the furthest cell in each of a hundred and
       * twenty directions round the centroid. Still a measurement of this model, never a
       * drawn brain shape. */
      const N = 120, far = new Float32Array(N), fx = new Float32Array(N), fy = new Float32Array(N);
      const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
      for (let i = 0; i < cell.count; i++) {
        const p = cell.pos(i);
        const dz = p.z - mx, dy = p.y - my;
        const d = Math.hypot(dz, dy);
        const k = ((Math.round(((Math.atan2(dy, dz) + Math.PI) / (Math.PI * 2)) * N)) % N + N) % N;
        if (d > far[k]) { far[k] = d; fx[k] = p.z; fy[k] = p.y; }
      }
      const pts = [];
      for (let k = 0; k < N; k++) if (far[k] > 0) pts.push([PX(fx[k]), PY(fy[k])]);
      if (pts.length > 8) {
        c.beginPath();
        pts.forEach(([px, py], i) => (i ? c.lineTo(px, py) : c.moveTo(px, py)));
        c.closePath();
        c.fillStyle = 'rgba(146,178,222,.045)';
        c.fill();
        c.strokeStyle = 'rgba(150,185,230,.18)';
        c.lineWidth = 1;
        c.stroke();
      }
    }

    const maxC = Math.max(...g.nodes.map(n => n.count), 1);
    const byRegion = new Map();
    for (const n of g.nodes) {
      const p = { region: n.region, count: n.count, x: PX(n.z), y: PY(n.y),
                  r: 4 + 10 * Math.sqrt(n.count / maxC) };
      this.regionPts.push(p);
      byRegion.set(n.region, p);
    }
    const hoverR = this.regionPts[this.hover.region]?.region ?? -1;
    const focus = hoverR >= 0 ? hoverR : this.ctx.selected();
    const maxW = Math.max(...g.edges.map(e => e.w), 1);

    /* Bowed away from the straight line between the two, so two links to the same neighbour do
     * not lie on top of one another and the picture reads as a network rather than as a mesh. */
    c.globalCompositeOperation = 'lighter';
    for (const e of g.edges) {
      const a = byRegion.get(e.a), b = byRegion.get(e.b);
      if (!a || !b) continue;
      const lit = focus === e.a || focus === e.b;
      const mxp = (a.x + b.x) / 2, myp = (a.y + b.y) / 2;
      const nx = -(b.y - a.y), ny = b.x - a.x;
      const len = Math.hypot(nx, ny) || 1;
      const bow = 0.10 * Math.hypot(b.x - a.x, b.y - a.y);
      c.beginPath();
      c.moveTo(a.x, a.y);
      c.quadraticCurveTo(mxp + (nx / len) * bow, myp + (ny / len) * bow, b.x, b.y);
      c.strokeStyle = lit ? COOL : '#6E86A8';
      c.globalAlpha = lit ? 0.85 : 0.10 + (e.w / maxW) * 0.30;
      c.lineWidth = lit ? 1.5 : 0.5 + (e.w / maxW) * 1.3;
      c.stroke();
    }
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;

    for (const p of this.regionPts) {
      const col = get(p.region)?.color ?? WARM[0];
      const on = focus === p.region;
      c.beginPath(); c.arc(p.x, p.y, p.r + (on ? 3 : 0), 0, Math.PI * 2);
      c.fillStyle = col; c.shadowColor = col; c.shadowBlur = on ? 16 : 7;
      c.fill(); c.shadowBlur = 0;
      if (on) {
        c.strokeStyle = 'rgba(255,255,255,.92)'; c.lineWidth = 1.2;
        c.beginPath(); c.arc(p.x, p.y, p.r + 6, 0, Math.PI * 2); c.stroke();
      }
    }

    /* Named on the picture, not only on hover — a graph whose nodes you have to interrogate
     * one at a time to identify is a puzzle. Every region gets a name, in the lane on its own
     * side of the brain, at its own height, connected by a hairline in its own colour. Nothing
     * is dropped: the previous version placed outward from the centre and abandoned whatever
     * collided, so the crowded parietal names — which are the ones a reader is least sure of —
     * were the ones that disappeared.
     *
     * The lanes are packed rather than placed: rows are assigned in height order with a
     * minimum spacing, and the block is centred on the labels' own mean so a lane of four does
     * not sit at the top of the panel. */
    const mid = (PX(x0) + PX(x1)) / 2;
    for (const side of [-1, 1]) {
      const lot = this.regionPts
        .filter(p => (p.x < mid ? -1 : 1) === side && nameOf(p.region, lang))
        .sort((a, b) => a.y - b.y);
      if (!lot.length) continue;
      const rows = lot.length;
      const span = (rows - 1) * ROW_PX;
      const want = lot.reduce((a, p) => a + p.y, 0) / rows;
      let top = Math.min(Math.max(want - span / 2, 10), h - span - 6);
      for (let i = 0; i < rows; i++) {
        const p = lot[i];
        const ty = top + i * ROW_PX;
        const on = focus === p.region;
        const name = nameOf(p.region, lang);
        const tw = c.measureText(name).width;
        const tx = side < 0 ? Math.max(3, PX(x0) - LEAD - tw) : Math.min(w - tw - 3, PX(x1) + LEAD);
        const col = get(p.region)?.color ?? WARM[0];

        /* The rope: out of the node, to the lane, then level into the text. Drawn in the
         * region's own colour so the name, the node and the line are one object. */
        const ex = side < 0 ? tx + tw + 4 : tx - 4;
        c.beginPath();
        c.moveTo(p.x + (side < 0 ? -p.r : p.r), p.y);
        c.lineTo(ex + side * -6, ty - 3);
        c.lineTo(ex, ty - 3);
        c.strokeStyle = col;
        c.globalAlpha = on ? 0.9 : 0.34;
        c.lineWidth = on ? 1.4 : 0.7;
        c.stroke();
        c.globalAlpha = 1;

        label(c, name, tx, ty, { colour: on ? INK : DIM, size: NAME_PX, caps: false });
        if (on) {
          c.fillStyle = col;
          c.fillRect(tx - (side < 0 ? 5 : -tw - 1), ty - NAME_PX + 1, 2, NAME_PX + 1);
        }
      }
    }

    label(c, UI.labAnterior?.[lang] ?? '', w - 8, h - 6, { colour: DIM2, align: 'right' });
    label(c, UI.labPosterior?.[lang] ?? '', 8, h - 6, { colour: DIM2 });
  }

  /* ----------------------------------------------------------- joint angles */
  drawJoints(lang) {
    const c = this.p3.clear();
    const { w, h } = this.p3;
    const key = this.ctx.exercise();
    const clip = key && MOTION[key];
    const x0 = PAD + 24, x1 = w - PAD, y0 = 18, y1 = h - 30;
    grid(c, x0, y0, x1, y1);
    if (!clip) { label(c, UI.labNoClip?.[lang] ?? '', x0, (y0 + y1) / 2, { colour: DIM }); return; }

    /* Every *angle* the clip drives, in degrees.
     *
     * `sample()` returns the converted values — radians for an angle, metres for a pelvis
     * translation, a fraction for a spine wave — so three different units arrive through one
     * object. Plotting them together on an axis marked in degrees would put a 0.94 m standing
     * height beside a 0.09 rad arm swing and call both of them degrees; and reading the radian
     * as a degree is what made the Hundred look like a clip in which nothing moves, since its
     * largest excursion is 0.09 of anything. `isAngle` is the same test the writer uses. */
    const DEG = 180 / Math.PI;
    const names = new Set();
    for (const k of clip.keys) for (const n of Object.keys(k.c ?? {})) if (isAngle(n)) names.add(n);
    const N = 80;
    const series = [...names].map(name => ({ name, pts: [] }));
    for (let i = 0; i < N; i++) {
      const s = sample(key, i / (N - 1)).coordinates ?? {};
      for (const r of series) r.pts.push((s[r.name] ?? 0) * DEG);
    }
    // the ones that actually move: a coordinate held flat is a straight line and no information
    const range = r => Math.max(...r.pts) - Math.min(...r.pts);
    series.sort((a, b) => range(b) - range(a));
    const shown = series.filter(r => range(r) > 1.5).slice(0, 6);
    if (!shown.length) { label(c, UI.labNoMotion?.[lang] ?? '', x0, (y0 + y1) / 2, { colour: DIM }); return; }

    let lo = Infinity, hi = -Infinity;
    for (const r of shown) for (const v of r.pts) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    const pad = Math.max(4, (hi - lo) * 0.08);
    lo -= pad; hi += pad;
    const X = u => x0 + (x1 - x0) * u;
    const Y = v => y1 - ((v - lo) / (hi - lo || 1)) * (y1 - y0);

    // the breath, behind the traces, in its own colours
    for (const p of clip.phases ?? []) {
      if (p.at <= 0) continue;
      const bx = Math.round(X(p.at)) + 0.5;
      c.strokeStyle = BREATH[p.breath]?.color ?? GRID;
      c.globalAlpha = 0.25;
      c.beginPath(); c.moveTo(bx, y0); c.lineTo(bx, y1); c.stroke();
      c.globalAlpha = 1;
    }
    // zero degrees, if it is on the plot: the line a joint's neutral sits on
    if (lo < 0 && hi > 0) {
      const zy = Math.round(Y(0)) + 0.5;
      c.strokeStyle = 'rgba(150,185,230,.3)';
      c.setLineDash([3, 3]);
      c.beginPath(); c.moveTo(x0, zy); c.lineTo(x1, zy); c.stroke();
      c.setLineDash([]);
    }

    shown.forEach((r, i) => {
      trace(c, r.pts.map((v, j) => [X(j / (N - 1)), Y(v)]),
            JOINTC[i] ?? JOINTC[JOINTC.length - 1],
            { width: i === 0 ? 1.6 : 1.1, glow: i === 0 ? 8 : 3, alpha: i === 0 ? 1 : 0.75 });
    });

    const t = this.ctx.t();
    const px = Math.round(X(t)) + 0.5;
    // the playhead is warm here, because the traces are cool: it has to be the odd one out
    c.strokeStyle = PLAY; c.shadowColor = PLAY; c.shadowBlur = 6;
    c.beginPath(); c.moveTo(px, y0 - 3); c.lineTo(px, y1 + 3); c.stroke();
    c.shadowBlur = 0;

    label(c, `${Math.round(hi)}°`, x0 - 6, y0 + 4, { colour: DIM2, align: 'right', caps: false });
    label(c, `${Math.round(lo)}°`, x0 - 6, y1, { colour: DIM2, align: 'right', caps: false });
    // a legend, because six unnamed traces is a pattern rather than a reading
    let lx = x0;
    shown.forEach((r, i) => {
      // named for a reader, not for the rig: "right hip, thigh forward", not "hip_flexion_r"
      const txt = coordLabel(r.name, lang);
      c.font = '9px "Helvetica Neue", Helvetica, Arial, sans-serif';
      const tw = c.measureText(txt).width + 16;
      if (lx + tw > x1) return;
      c.fillStyle = JOINTC[i] ?? JOINTC[JOINTC.length - 1];   // the legend has to match the trace
      c.fillRect(lx, h - 14, 7, 2);
      label(c, txt, lx + 11, h - 11, { colour: DIM, caps: false });
      lx += tw + 8;
    });
  }

  /* ------------------------------------------------------------ muscle role */
  drawMuscles(lang) {
    const c = this.p4.clear();
    const { w, h } = this.p4;
    const key = this.ctx.exercise();
    const clip = key && MOTION[key];
    const x0 = PAD + 18, x1 = w - PAD, y0 = 18, y1 = h - 30;
    grid(c, x0, y0, x1, y1);
    if (!clip) { label(c, UI.labNoClip?.[lang] ?? '', x0, (y0 + y1) / 2, { colour: DIM }); return; }

    const names = new Set();
    for (const k of clip.keys) for (const n of Object.keys(k.act ?? {})) names.add(n);
    const N = 80;
    const series = [...names].map(name => ({ name, pts: [] }));
    for (let i = 0; i < N; i++) {
      const a = sample(key, i / (N - 1)).activation ?? {};
      for (const r of series) r.pts.push(a[r.name] ?? 0);
    }
    series.sort((a, b) => Math.max(...b.pts) - Math.max(...a.pts));
    const shown = series.slice(0, 6);
    const X = u => x0 + (x1 - x0) * u;
    const Y = v => y1 - Math.min(1, Math.max(0, v)) * (y1 - y0);

    for (const p of clip.phases ?? []) {
      if (p.at <= 0) continue;
      const bx = Math.round(X(p.at)) + 0.5;
      c.strokeStyle = BREATH[p.breath]?.color ?? GRID;
      c.globalAlpha = 0.25;
      c.beginPath(); c.moveTo(bx, y0); c.lineTo(bx, y1); c.stroke();
      c.globalAlpha = 1;
    }
    if (shown[0]) {
      const gr = c.createLinearGradient(0, y0, 0, y1);
      gr.addColorStop(0, 'rgba(255,201,138,.18)');
      gr.addColorStop(1, 'rgba(255,201,138,0)');
      c.beginPath(); c.moveTo(x0, y1);
      shown[0].pts.forEach((v, j) => c.lineTo(X(j / (N - 1)), Y(v)));
      c.lineTo(x1, y1); c.closePath(); c.fillStyle = gr; c.fill();
    }
    for (let i = shown.length - 1; i >= 0; i--) {
      trace(c, shown[i].pts.map((v, j) => [X(j / (N - 1)), Y(v)]),
            WARM[i] ?? WARM[WARM.length - 1],
            { width: i === 0 ? 1.6 : 1.1, glow: i === 0 ? 8 : 3, alpha: i === 0 ? 1 : 0.72 });
    }
    const t = this.ctx.t();
    const px = Math.round(X(t)) + 0.5;
    c.strokeStyle = COOL; c.shadowColor = COOL; c.shadowBlur = 6;
    c.beginPath(); c.moveTo(px, y0 - 3); c.lineTo(px, y1 + 3); c.stroke();
    c.shadowBlur = 0;
    shown.forEach((r, i) => {
      const v = r.pts[Math.round(t * (N - 1))];
      const col = WARM[i] ?? WARM[WARM.length - 1];
      c.fillStyle = col; c.shadowColor = col; c.shadowBlur = i === 0 ? 7 : 3;
      c.beginPath(); c.arc(X(t), Y(v), i === 0 ? 3 : 2, 0, Math.PI * 2); c.fill();
      c.shadowBlur = 0;
    });
    label(c, '1.0', x0 - 6, y0 + 4, { colour: DIM2, align: 'right', caps: false });
    label(c, '0', x0 - 6, y1, { colour: DIM2, align: 'right', caps: false });
    let lx = x0;
    shown.forEach((r, i) => {
      const st = registry()?.byName.get(r.name);
      const txt = st ? st.name[lang] : r.name;
      c.font = '9px "Helvetica Neue", Helvetica, Arial, sans-serif';
      const tw = c.measureText(txt).width + 16;
      if (lx + tw > x1) return;
      c.fillStyle = WARM[i] ?? WARM[WARM.length - 1];
      c.fillRect(lx, h - 14, 7, 2);
      label(c, txt, lx + 11, h - 11, { colour: DIM, caps: false });
      lx += tw + 8;
    });
  }

  /* --------------------------------------------------------------- evidence
   * Every claim this application makes about exercise and the brain, with the evidence behind
   * it, as a table.
   *
   * It was a bar chart of counts per tier, and the report on it was fair: five bars labelled A
   * to E teach a reader nothing they can check, and "7" is not a finding. What is useful is the
   * claims themselves — what is asserted, in whom, how large the effect was, over what
   * timescale, and where it was published. The distribution survives as one thin strip, because
   * the *shape* of the evidence is worth a glance and is not worth a panel.
   *
   * DOM rather than canvas: this is sentences and citations, and on a canvas they would be
   * unselectable, unsearchable and invisible to a screen reader.
   */
  drawEvidence(lang) {
    const T = k => UI[k]?.[lang] ?? k;
    const claims = Object.entries(EXERCISE_BRAIN)
      .map(([key, c]) => ({ key, ...c }))
      .sort((a, b) => (a.tier < b.tier ? -1 : a.tier > b.tier ? 1 : 0));
    const order = Object.keys(TIERS);
    const counts = order.map(t => claims.filter(c => c.tier === t).length);
    const total = claims.length || 1;

    const sum = this.host.querySelector('#labP5');
    sum.textContent = '';
    order.forEach((t, i) => {
      if (!counts[i]) return;
      const seg = document.createElement('div');
      seg.className = 'evseg';
      seg.style.flexGrow = String(counts[i]);
      seg.style.background = TIERS[t]?.color ?? '#888';
      const b = document.createElement('b'); b.textContent = t;
      const n = document.createElement('span');
      n.textContent = `${counts[i]} ${T('labOf')} ${total}`;
      seg.append(b, n);
      seg.title = TIERS[t]?.[lang] ?? '';
      sum.appendChild(seg);
    });

    const host = this.host.querySelector('#labEv');
    host.textContent = '';
    const val = f => (typeof f === 'string' ? f : (f?.[lang] ?? f?.en ?? ''));
    let lastTier = null;
    for (const c of claims) {
      if (c.tier !== lastTier) {
        lastTier = c.tier;
        const h = document.createElement('div');
        h.className = 'evhead';
        const chip = document.createElement('b');
        chip.textContent = c.tier;
        chip.style.background = TIERS[c.tier]?.color ?? '#888';
        const plain = document.createElement('span');
        plain.textContent = UI[`tierPlain${c.tier}`]?.[lang] ?? '';
        const tech = document.createElement('em');
        tech.textContent = TIERS[c.tier]?.[lang] ?? '';
        h.append(chip, plain, tech);
        host.appendChild(h);
      }
      const row = document.createElement('div');
      row.className = 'evrow';
      const claim = document.createElement('p');
      claim.className = 'evclaim';
      claim.textContent = c[lang]?.claim ?? c.en?.claim ?? '';
      row.appendChild(claim);

      const facts = document.createElement('div');
      facts.className = 'evfacts';
      const WORD = { human: 'labSpHuman', animal: 'labSpAnimal',
                     acute: 'labTsAcute', chronic: 'labTsChronic' };
      const word = v => (WORD[v] ? T(WORD[v]) : val(v));
      for (const [k, v] of [
        [T('labEffect'), val(c.effect)],
        [T('labWho'), val(c.population)],
        [T('labSpecies'), word(c.species)],
        [T('labOver'), word(c.timescale)],
      ]) {
        if (!v) continue;
        const f = document.createElement('div');
        const kk = document.createElement('b'); kk.textContent = k;
        const vv = document.createElement('span'); vv.textContent = v;
        f.append(kk, vv);
        facts.appendChild(f);
      }
      row.appendChild(facts);

      /* The caveat and the citation are what make a claim checkable rather than assertable, so
       * neither is optional and neither is folded away behind anything. */
      const cav = val(c.caveat);
      if (cav) {
        const p2 = document.createElement('p');
        p2.className = 'evcaveat';
        const lab = document.createElement('b'); lab.textContent = T('labCaveat');
        const txt = document.createElement('span'); txt.textContent = cav;
        p2.append(lab, txt);
        row.appendChild(p2);
      }
      const cite = document.createElement('p');
      cite.className = 'evcite';
      cite.textContent = c.citation ?? '';
      row.appendChild(cite);

      // which structures it is about, clickable, so a claim leads back to the anatomy
      if (c.structures?.length) {
        const st = document.createElement('div');
        st.className = 'evstructs';
        const lb = document.createElement('b'); lb.textContent = T('labAbout');
        st.appendChild(lb);
        for (const id of c.structures) {
          const name = nameOf(id, lang);
          if (!name) continue;
          const bb = document.createElement('button');
          const dot = document.createElement('i');
          dot.style.background = get(id)?.color ?? '#888';
          const sp = document.createElement('span');
          sp.textContent = name;
          bb.append(dot, sp);
          bb.onclick = () => this.ctx.select(id);
          st.appendChild(bb);
        }
        row.appendChild(st);
      }
      host.appendChild(row);
    }
  }
}

/** Break a sentence to a width, at the size it will be drawn. */
function wrapTo(c, text, width, size) {
  c.font = `${size}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
  const out = [];
  let line = '';
  for (const word of String(text ?? '').split(' ')) {
    const test = line ? `${line} ${word}` : word;
    if (c.measureText(test).width > width && line) { out.push(line); line = word; }
    else line = test;
  }
  if (line) out.push(line);
  return out;
}

/* ------------------------------------------- naming a level and naming a nerve
 * Two lookups that turn a row of the analysis into something the 3D pair can render.
 *
 * Both go through the registry **by name**, which is the rule everywhere in this project: a
 * rebuild renumbers ids and content keyed to a number would silently detach, so nothing here
 * is keyed to one.
 */

/* A cord level, as the vertebra at that level. BodyParts3D names the first two by their own
 * names rather than by number, which is anatomy and not an exception to work around. */
const ORDINAL = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh',
                 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth'];
function vertebraFor(root) {
  const m = /^([CTLS])(\d{1,2})$/.exec(String(root).trim());
  if (!m) return null;                            // a cranial nerve has no vertebral level
  const [, band, nStr] = m;
  const n = +nStr;
  let name = null;
  if (band === 'C') name = n === 1 ? 'atlas' : n === 2 ? 'axis' : `${ORDINAL[n]} cervical vertebra`;
  else if (band === 'T') name = `${ORDINAL[n]} thoracic vertebra`;
  else if (band === 'L') name = `${ORDINAL[n]} lumbar vertebra`;
  else if (band === 'S') name = 'sacrum';         // the sacral levels are fused into one bone
  return name ? (registry()?.byName.get(name)?.id ?? null) : null;
}

/**
 * The nerve mesh an innervation sentence is about, matched on **whole words only**.
 *
 * A plain substring test is what put the shoulder's nerve inside the skull once already:
 * "Maxillary nerve" contains "axillary nerve", and the build silently gave the axillary route
 * the trigeminal's maxillary division. The same trap is here — the innervation strings name
 * dozens of nerves and the twenty routes this model carries are short words inside longer
 * ones — so a match has to start and end at a word boundary, and the longest match wins so
 * that "common fibular nerve" is not answered by "fibular".
 */
function nerveFor(text) {
  const reg = registry();
  if (!reg || !text) return null;
  const hay = ` ${String(text).toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
  let best = null, len = 0;
  for (const [name, r] of reg.byName) {
    if (r.layer !== 'nervous') continue;
    const key = ` ${name.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
    if (key.length > len && hay.includes(key)) { best = r.id; len = key.length; }
  }
  return best;
}

/**
 * The cell in `mine` carrying the most of this network's own fibres.
 *
 * A degree count, nothing more: `pairs` is the undirected edge buffer the picture is drawn
 * from, so this counts the lines a reader can see leaving each speck. It is a property of this
 * model's wiring and not a statement about a brain — there are no per-neuron measurements in
 * this repository and a cell here stands for a population far below the resolution of anything
 * in it. What it buys is a first cell worth opening rather than an empty panel.
 */
function hubOf(cell, mine) {
  const want = new Set(mine);
  const deg = new Map();
  const pairs = cell.pairs ?? [];
  for (let k = 0; k < pairs.length; k++) {
    const i = pairs[k];
    if (want.has(i)) deg.set(i, (deg.get(i) ?? 0) + 1);
  }
  let best = mine[0], bd = -1;
  for (const i of mine) {
    const d = deg.get(i) ?? 0;
    if (d > bd) { bd = d; best = i; }
  }
  return best;
}

function nearest(pts, x, y, r) {
  if (!pts?.length) return -1;
  let best = -1, bd = r * r;
  pts.forEach((p, i) => {
    const d = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}
