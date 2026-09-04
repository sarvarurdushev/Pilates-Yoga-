/**
 * Loads the real app in headless Chromium, drives a few interactions, and fails on any
 * console error. A static site with no build step has no compiler to catch a bad import or
 * a missing element id, so this is the compiler.
 *
 * Usage: node test/smoke.mjs [outdir]
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';

const ROOT = new URL('../', import.meta.url).pathname;
const OUT = process.argv[2] || join(ROOT, '.render', 'smoke');
mkdirSync(OUT, { recursive: true });

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
               '.json': 'application/json', '.glb': 'model/gltf-binary', '.css': 'text/css' };

const server = createServer(async (req, res) => {
  let p = normalize(decodeURI(req.url.split('?')[0]));
  if (p === '/') p = '/index.html';
  try {
    const body = await readFile(join(ROOT, p));
    res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404).end('not found'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--disable-gpu-sandbox', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const errors = [], warnings = [];
page.on('console', m => {
  if (m.type() === 'error') errors.push(m.text());
  if (m.type() === 'warning') warnings.push(m.text());
});
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
page.on('requestfailed', r => errors.push(`request failed: ${r.url()} ${r.failure()?.errorText}`));

const shot = async (name) => {
  // caret/animations disabled and a long timeout: the default screenshot path waits on
  // font loading and flakes under swiftshader while the GPU thread is busy
  try {
    await page.screenshot({ path: join(OUT, `${name}.png`), timeout: 90000,
                            animations: 'disabled', caret: 'hide' });
    console.log(`  shot ${name}`);
  } catch (e) {
    console.log(`  shot ${name} FAILED: ${e.message.split('\n')[0]}`);
  }
};

await page.goto(`http://127.0.0.1:${port}/index.html`);
await page.waitForFunction('document.body.classList.contains("ready")', null, { timeout: 120000 });
console.log('app ready');

// the skeleton and superficial muscles load on first paint
await page.waitForFunction(
  '!document.getElementById("loading") || document.getElementById("loading").offsetParent === null',
  null, { timeout: 180000 }).catch(() => {});
await page.waitForTimeout(4000);
await shot('01-default');

const measureFps = async (label) => {
  const r = await page.evaluate(async () => {
    const m = await import('/src/main.js');
    const a = m.frameStats().frames, t0 = Date.now();
    await new Promise(res => setTimeout(res, 5000));
    return { fps: +(((m.frameStats().frames - a) * 1000) / (Date.now() - t0)).toFixed(2),
             labels: m.frameStats().labels };
  });
  console.log(`fps ${label}:`, JSON.stringify(r));
};
// swiftshader, not a GPU — useful only as a relative number between states
await measureFps('skeleton + superficial muscles');

// how many structures made it into the registry, and did the frame put them anywhere sane
const stats = await page.evaluate(async () => {
  const s = await import('/src/structures.js');
  const { app } = await import('/src/main.js');
  const reg = s.registry();
  const ys = [], layers = {};
  for (const [id, r] of reg.byId) {
    layers[r.layer] = (layers[r.layer] ?? 0) + 1;
    const c = app.centroids[id];
    if (c) ys.push([r.name.en, +c.y.toFixed(3)]);
  }
  return { total: reg.byId.size, layers, placed: ys.length,
           yMin: Math.min(...ys.map(v => v[1])), yMax: Math.max(...ys.map(v => v[1])) };
});
console.log('registry:', JSON.stringify(stats));

// exercise -> activation
await page.click('#tabExercise');
await page.waitForTimeout(300);
await page.click('[data-ex="hundred"]');
await page.waitForTimeout(5000);
await shot('02-exercise');

const act = await page.evaluate(async () => {
  const { app, activationOf } = await import('/src/main.js');
  const s = await import('/src/structures.js');
  const on = [];
  for (const [id] of s.registry().byId) if (activationOf(id)) on.push(s.nameOf(id, 'en'));
  return { exercise: app.exercise, activated: on };
});
console.log('activation:', JSON.stringify(act));

/* Every label has to fit inside the stage it is drawn on. The right-hand lane is placed from
 * the width the label reported, so anything that changes a label's width without changing its
 * text puts it off the edge — and one did: the label element is a <button> carrying `act` for
 * an activated muscle, and the panel's primary-button rule is `.act{width:100%}`. Same
 * specificity, later in the sheet, so every working muscle's label stretched to its 240px
 * max-width and hung up to 150px under the panel, where its own name could not be read. It
 * only happened during an exercise, which is the one state the smoke test had not measured. */
const overhang = await page.evaluate(() => {
  const stage = document.getElementById('labels').getBoundingClientRect();
  const out = [];
  for (const el of document.querySelectorAll('.lab3d')) {
    if (el.hidden || el.style.opacity === '0' || !el.textContent) continue;
    const b = el.getBoundingClientRect();
    const over = Math.max(b.right - stage.right, stage.left - b.left);
    if (over > 0) out.push(`${el.textContent.trim()} +${Math.round(over)}px`);
  }
  return out;
});
if (overhang.length)
  errors.push(`labels hang off the stage during an exercise: ${overhang.slice(0, 5).join(', ')}`);
console.log('label overhang:', overhang.length ? JSON.stringify(overhang.slice(0, 5)) : 'none');

/* The role tag on a working muscle's label. This is checked because the first version of it
 * never drew at all and nothing said so: the label was handed `activation.has(id)` — a
 * boolean, because it is sorted on arithmetically — and looked the role up in a table keyed
 * by 'prime' / 'synergists' / 'stabilisers', so every lookup was `TABLE[true]`, every tag was
 * undefined, and the picture was exactly what it had been. A field that renders nothing is
 * indistinguishable from a field that is not there. */
const roleTags = await page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll('.lab3d')) {
    if (el.style.opacity === '0') continue;
    const t = el.querySelector('.labrole');
    if (t && t.textContent.trim()) out.push(`${el.querySelector('.labname').textContent.trim()}: ${t.textContent.trim()}`);
  }
  return out;
});
if (!roleTags.length)
  errors.push('no label carries a role tag during an exercise');
console.log('label role tags:', roleTags.length, JSON.stringify(roleTags.slice(0, 3)));

/* The plot of muscle role across the movement.
 *
 * Checked here for the same reason as the role tag above: it is a canvas, so it fails silently
 * and looks exactly like a plot with nothing to say. Four things, and each one caught something
 * while it was being built. The buffer must match the box it is displayed in, because the panel
 * is a `clamp` on the viewport and a canvas sized to a constant would be resampled. It must
 * have ink, because a redraw guard that skips a frame it should have drawn leaves last frame's
 * pixels — or none. The readout beside it must have rows, because the panel is rebuilt from
 * innerHTML and the guard nearly left that div empty for ever. And moving the pointer across it
 * must change the numbers, which is the only assertion that proves the plot is reading the clip
 * rather than drawing a shape. */
const plot = await page.evaluate(async () => {
  const c = document.querySelector('#actPlot canvas');
  if (!c) return { missing: true };
  c.scrollIntoView({ block: 'center' });
  const read = () => document.getElementById('actRead').textContent.replace(/\s+/g, ' ').trim();
  const ink = () => {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++;
    return n;
  };
  const before = read();
  c.onpointermove({ offsetX: c.clientWidth * 0.8 });
  const after = read();
  c.onpointerleave();
  return { missing: false, ink: ink(), px: c.width * c.height,
           sized: c.width === Math.round(c.clientWidth * Math.min(2, devicePixelRatio || 1)),
           rows: document.querySelectorAll('#actRead .ard').length,
           reads: before !== after };
});
if (plot.missing) errors.push('the exercise has a clip but no activation plot');
else {
  if (!plot.ink) errors.push('the activation plot drew nothing');
  if (!plot.sized) errors.push('the activation plot canvas does not match its box');
  if (!plot.rows) errors.push('the activation plot has no readout beside it');
  if (!plot.reads) errors.push('the activation plot does not read the clip under the pointer');
}
console.log('activation plot:', JSON.stringify(plot));

/* The probe on a cell.
 *
 * Written because the role tag shipped once rendering nothing and nothing said so, and this is
 * the same shape of feature: a field that only appears on hover, over a specific object, in a
 * state the test suite had no reason to enter. A probe that never draws looks exactly like a
 * probe that was never asked for.
 *
 * It hovers the middle of the brain rather than a guessed pixel, and asserts three things: the
 * note appears, it names a real parcel, and its firing bar reports a number in range. The last
 * one is the guard against `fireAt` and the vertex shader drifting apart — the two compute the
 * same value in two languages and only this notices if one of them stops. */
const cellProbe = await page.evaluate(async () => {
  const m = await import('/src/main.js');
  const THREE = await import('three');
  for (const l of ['organs', 'muscles_superficial', 'muscles_deep', 'nervous', 'skeleton'])
    await m.setLayer(l, false);
  await m.setLayer('brain', true);
  m.setExercise(null);
  m.selectStructure(null);
  await new Promise(r => setTimeout(r, 2500));
  m.setView('head', true);
  await new Promise(r => setTimeout(r, 2500));

  const c = document.getElementById('view');
  const r = c.getBoundingClientRect();
  const note = document.getElementById('cellnote');
  /* Sweep a short line across the middle of the brain rather than trusting one pixel: a soma
   * is a few pixels across and the head view is not pinned to the centre of the canvas. */
  for (let i = 0; i <= 40; i++) {
    const x = r.left + r.width * (0.30 + 0.40 * (i / 40));
    const y = r.top + r.height * 0.50;
    c.dispatchEvent(new PointerEvent('pointermove',
      { clientX: x, clientY: y, bubbles: true }));
    if (!note.hidden) break;
  }
  const out = note.hidden ? { shown: false } : {
    shown: true,
    name: note.querySelector('.cnname').textContent.trim(),
    id: note.querySelector('.cnid').textContent.trim(),
    fire: note.querySelector('.cnbar b').style.width,
  };
  /* The section strip, measured in the same visit rather than in one of its own: it needs
   * exactly the state this check has already paid for — every body layer off and the brain
   * on — and loading the brain twice is a minute of SwiftShader for nothing.
   *
   * The sections are drawn into canvases by the app's own renderer, so they fail the way
   * every canvas fails: silently, looking like a section with nothing in it. What is asserted
   * is that they have ink, that they carry millimetre captions, that clicking one moves the
   * real plane in the picture — that is what makes them a control rather than an image — and
   * that a different plane produces different pictures. The last is the one that proves they
   * are sections of the geometry: if the strip drew the same thing for sagittal as for axial,
   * it would be drawing a decoration. */
  const strip = document.getElementById('sections');
  const shot = () => [...document.querySelectorAll('#sections .sect')].map(b => {
    const c = b.firstChild, d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let lit = 0;
    for (let i = 0; i < d.length; i += 4) if (Math.max(d[i], d[i+1], d[i+2]) > 10) lit++;
    return { lit, mm: b.lastChild.textContent };
  });
  m.setScan('axial', 0);
  await new Promise(r => setTimeout(r, 1200));
  const axial = shot();
  document.querySelectorAll('#sections .sect')[3]?.click();
  await new Promise(r => setTimeout(r, 800));
  const moved = m.scanState().at;
  m.setScan('sagittal', 0);
  await new Promise(r => setTimeout(r, 1200));
  const sagittal = shot();
  m.setScan(null, 0);
  /* Can a reader reach all of them? Nine cuts are wider than the space beside the console on
   * any screen this runs on, and the strip shipped once with `max-width:calc(100% - 300px)` —
   * which runs *under* the panel, so the last four thumbnails were behind the glass with no
   * scroll and no arrow to say they existed. Both halves are asserted: the strip's box ends
   * before the console's begins, and where the row overflows, the arrow that pages it is on. */
  const row = document.getElementById('sectRow');
  const panel = document.getElementById('panel');
  const sb = strip?.getBoundingClientRect(), pb = panel?.getBoundingClientRect();
  out.sections = { hidden: strip?.hidden !== false, axial, sagittal, movedTo: moved,
                   differ: JSON.stringify(axial.map(t => t.lit)) !==
                           JSON.stringify(sagittal.map(t => t.lit)),
                   overflows: row ? row.scrollWidth > row.clientWidth + 4 : null,
                   canScroll: !!document.getElementById('sectNext')?.classList.contains('on'),
                   underPanel: sb && pb ? Math.round(sb.right - pb.left) : null,
                   scrolledTo: 0 };
  /* And the arrow has to actually move it. An arrow that is drawn, lights when there is
   * somewhere to go, and does nothing when clicked is indistinguishable from a strip that
   * cannot scroll — which is what shipped, because the click was wired inside the row's build
   * and lost a race with it. */
  if (out.sections.overflows) {
    document.getElementById('sectNext')?.click();
    await new Promise(r => setTimeout(r, 1500));
    out.sections.scrolledTo = Math.round(row.scrollLeft);
    row.scrollLeft = 0;
  }

  /* The two looks, and the region network. Measured in this visit for the same reason as the
   * sections: it already has the brain loaded and every body layer off.
   *
   * The looks are two materials over one geometry, and the failure they had was silent — the
   * lit surface carries no `uOpacity`, so writing the volume's uniform set onto it threw and
   * took the switch down with it. What is asserted is that the switch actually changes the
   * pixels, that it comes back, and that no error is raised on the way (the harness fails on
   * any console error already, so the throw would surface there).
   *
   * The network graph is a canvas, so it fails the way every canvas fails. It has to have ink,
   * it has to report how many regions and links it drew, and — the assertion that makes it a
   * reading rather than a drawing — every node must be a real region id that resolves to a
   * name, because a node standing for unparcellated cortex has no name and nothing to say. */
  const frameInk = () => {
    const cv = document.getElementById('view');
    const o = document.createElement('canvas'); o.width = cv.width; o.height = cv.height;
    o.getContext('2d').drawImage(cv, 0, 0);
    const d = o.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    let lit = 0, sum = 0;
    for (let i = 0; i < d.length; i += 4) {
      const v = d[i] + d[i + 1] + d[i + 2];
      if (v > 150) { lit++; sum += v; }
    }
    return { lit, mean: lit ? Math.round(sum / lit) : 0 };
  };
  const tissue = frameInk();
  m.setBrainLook('anatomical');
  await new Promise(r => setTimeout(r, 3000));
  const anat = frameInk();
  const g = m.regionGraph();
  const s2 = await import('/src/structures.js');
  m.setBrainLook('tissue');
  await new Promise(r => setTimeout(r, 2000));
  out.looks = {
    tissueMean: tissue.mean, anatMean: anat.mean,
    changed: Math.abs(tissue.mean - anat.mean) > 8,
    back: m.app.brainLook,
  };
  out.graph = g ? {
    nodes: g.nodes.length, edges: g.edges.length,
    unnamed: g.nodes.filter(n => !s2.nameOf(n.region, 'en')).length,
    canvasInk: (() => {
      const c = document.querySelector('#connPlot canvas');
      if (!c) return -1;
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++;
      return n;
    })(),
    read: document.getElementById('connRead')?.textContent.trim() ?? '',
  } : null;

  /* Put the app back. This check is the only one that turns every body layer off, and the
   * scans that follow it measure the *body* — leaving it on a bare brain would have made them
   * measure nothing while still passing their own assertions. */
  await m.setLayer('brain', false);
  for (const l of ['muscles_superficial', 'skeleton']) await m.setLayer(l, true);
  m.resetView(true);
  await new Promise(r => setTimeout(r, 1500));
  return out;
});
console.log('cell probe:', JSON.stringify(cellProbe));
if (!cellProbe.shown) errors.push('hovering the brain never produced a cell probe');
else {
  if (!cellProbe.name) errors.push('the cell probe named no region');
  const pct = parseFloat(cellProbe.fire);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100)
    errors.push(`the cell probe's firing bar is ${cellProbe.fire}, which is not a share`);
}

/* The lab screen.
 *
 * Six canvases behind a button, which is six ways to fail silently. Every panel has to have
 * ink, the tiles have to carry real counts, and — the one that caught a real bug — the joint
 * panel has to plot something for a clip that moves. `sample()` returns the *converted*
 * coordinates, radians for an angle, so reading them as degrees made the Hundred's largest
 * excursion 0.09 and every trace fell under the "does this joint move" threshold: the panel
 * drew an empty grid and said "choose an exercise" for an exercise that was already chosen. */
const lab = await page.evaluate(async () => {
  const m = await import('/src/main.js');
  await m.setExercise('hundred');
  /* Choosing an exercise has to *choose* a brain region, not only mark the set of them. Every
   * panel that goes deeper — the cells of one region, the traced cell, where it sits in the
   * cuts, the 3D pair — is keyed on the selection, so marking without selecting left a reader
   * to click through the list one at a time, which is exactly what was asked not to happen. */
  const chosen = { id: m.app.selected ?? -1, marked: m.exerciseBrainRegions() };
  m.poseFromClip(0.45);
  document.getElementById('labBtn').click();
  await new Promise(r => setTimeout(r, 1400));
  const panels = {};
  /* `.labhost` only: the section figures carry canvases too, and they are checked separately
   * below. Scanning every canvas in the lab keyed them all by an empty parent id, so five
   * pictures collapsed into one entry and whichever happened to be last decided the result. */
  for (const c of document.querySelectorAll('#lab .labhost canvas')) {
    /* The connectome is a WebGL canvas with its own renderer, so it has no 2D context and is
     * copied into one to be read. It keeps its drawing buffer for exactly this reason: without
     * that, a presented WebGL canvas reads back blank and a broken scene is indistinguishable
     * from a working one. */
    let d;
    const ctx2 = c.getContext('2d');
    if (ctx2) d = ctx2.getImageData(0, 0, c.width, c.height).data;
    else {
      const o = document.createElement('canvas');
      o.width = c.width; o.height = c.height;
      o.getContext('2d').drawImage(c, 0, 0);
      d = o.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    }
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 24) n++;
    panels[c.parentNode.id] = n;
  }
  const tiles = [...document.querySelectorAll('.labtile b')].map(b => b.textContent);
  /* The evidence panel is a table rather than a canvas — a count of claims per tier told a
   * reader nothing about what any claim said. Every row has to carry the claim, its tier and
   * the paper it came from, or the panel is back to being a decorative number. */
  /* The enlarged sections: five real renders, each with a millimetre caption, and the key that
   * says what a pixel in one of them is. The panel exists because "what do those cut parts
   * mean" was asked five times, so a blank one is a regression on the answer rather than on a
   * picture. */
  const figs = [...document.querySelectorAll('#labSectRow .sectfig')];
  const sectInk = f => {
    const cv = f.firstChild;
    const o = document.createElement('canvas');
    o.width = cv.width; o.height = cv.height;
    o.getContext('2d').drawImage(cv, 0, 0);
    const d = o.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 24) n++;
    return n;
  };
  const sect = {
    figs: figs.length,
    /* Read from the module rather than written here, because the count is a tuning decision
     * that has moved once already and a test asserting a stale literal fails for the wrong
     * reason. */
    want: (await import('/src/sections.js')).SLICE_COUNT,
    blank: figs.filter(f => sectInk(f) < 200).length,
    noMm: figs.filter(f => !/-?\d+ mm/.test(f.lastChild.textContent || '')).length,
    keys: document.querySelectorAll('#labSectWhat .sectitem').length,
    // scoped: the fibre plot's own view buttons are a different control with a different class
    planes: document.querySelectorAll('#labSectPlanes .sectplane').length,
  };

  /* The fibre plot's three projections. From the side the two hemispheres superimpose — that
   * is what the projection axis means — and from above they separate, so the spread across the
   * midline has to actually change between the two. A picture that did not change would mean
   * the button was decoration. */
  /* A coarse signature of where the ink is, not a summary statistic of it. Both projections
   * are fitted to their own data, so they fill similar boxes and the spread barely moves — a
   * threshold on that would pass a button that did nothing. A 16x16 grid of lit counts is what
   * actually differs when the picture changes. */
  const fibSpread = () => {
    const cv = document.querySelector('#labP8 canvas');
    const o = document.createElement('canvas');
    o.width = cv.width; o.height = cv.height;
    o.getContext('2d').drawImage(cv, 0, 0);
    const d = o.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    const N = 16, grid = new Array(N * N).fill(0);
    let lit = 0;
    for (let y = 0; y < cv.height; y++)
      for (let x = 0; x < cv.width; x++) {
        const i = (y * cv.width + x) * 4;
        if (d[i] + d[i + 1] + d[i + 2] <= 30) continue;
        lit++;
        grid[Math.min(N - 1, (y * N / cv.height) | 0) * N + Math.min(N - 1, (x * N / cv.width) | 0)]++;
      }
    return { lit, grid };
  };
  /* The tour: the worked structures ranked, named, grouped, and walking on their own.
   *
   * Read before anything in this block touches the screen, because touching it stops the tour
   * — which is the behaviour that matters most here and is checked below against the reader's
   * own route in. Read after it, "did it start itself?" would be a question about the order of
   * the checks rather than about the panel. */
  const chipEls = [...document.querySelectorAll('#detChips .detchip')];
  const tour = {
    chips: chipEls.length,
    groups: [...document.querySelectorAll('#detChips .detgroup')].map(g => g.textContent),
    current: document.querySelector('#detChips .detchip[aria-current="true"]')?.textContent ?? '',
    first: chipEls[0]?.textContent ?? '',
    playing: document.querySelector('#detPlay')?.textContent ?? '',
  };

  const fib = { views: document.querySelectorAll('#labFibViews button').length };
  fib.side = fibSpread();
  document.querySelectorAll('#labFibViews button')[1]?.click();
  await new Promise(r => setTimeout(r, 700));
  fib.above = fibSpread();
  document.querySelectorAll('#labFibViews button')[0]?.click();
  await new Promise(r => setTimeout(r, 700));

  /* The region cell picker and the cuts locating a structure. Both are driven by selecting
   * something, and the test selects the way a reader does rather than by calling
   * selectStructure, which bypasses the lab's redraw and would test a route nobody has.
   *
   * First a cortical parcel, by clicking the first row of the roster — the biggest region —
   * because that is where the cells are and the picker has nothing to draw for a deep
   * structure. The Panel's context is scaled by dpr, so its drawing coordinates are CSS
   * pixels and offsetX lands where the row was drawn. */
  const inkOf = sel => {
    const cv = document.querySelector(sel);
    if (!cv) return 0;
    const o = document.createElement('canvas');
    o.width = cv.width; o.height = cv.height;
    o.getContext('2d').drawImage(cv, 0, 0);
    const d = o.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 30) n++;
    return n;
  };
  const roster = document.querySelector('#labP7 canvas');
  if (roster) {
    const r = roster.getBoundingClientRect();
    roster.dispatchEvent(new MouseEvent('click',
      { clientX: r.left + 60, clientY: r.top + 20, bubbles: true }));
    await new Promise(r2 => setTimeout(r2, 900));
  }
  const rc = { ink: inkOf('#labP10 canvas'),
               read: document.querySelector('#labF10')?.textContent ?? '' };
  /* Clicking a region in the roster is a reader choosing a structure, and it has to stop the
   * tour — otherwise the panel takes that choice back four seconds later and the whole screen
   * follows it somewhere the reader did not ask to go. */
  tour.stopped = document.querySelector('#detPlay')?.textContent ?? '';

  /* The cuts, before and after choosing a structure. The structure is meant to light up in
   * the picture itself — the section shader lifts its gain and holds everything else back —
   * so the test is that the pictures actually change, not that a marker element appeared. A
   * signature per thumbnail, so a cut that does not contain it is allowed to change too (the
   * cortex is held back everywhere) while the one that does has to change more. */
  const sig = () => [...document.querySelectorAll('#labSectRow .sectfig canvas')].map(cv => {
    const o = document.createElement('canvas');
    o.width = cv.width; o.height = cv.height;
    o.getContext('2d').drawImage(cv, 0, 0);
    const d = o.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2];
    return sum;
  });
  const before = sig();
  const hipChip = document.querySelector('#labSectKey .sectkey[data-id="20"]');
  hipChip?.click();
  await new Promise(r => setTimeout(r, 1200));
  const after = sig();
  const marks = [...document.querySelectorAll('#labSectRow .sectfig')]
    .map(f => f.classList.contains('hasit'));
  const locate = {
    chip: !!hipChip,
    where: document.querySelector('#labSectWhere')?.textContent ?? '',
    marked: marks.filter(Boolean).length,
    // how much each thumbnail's total brightness moved, as a share of what it was
    moved: before.map((b, i) => (b ? Math.abs(after[i] - b) / b : 0)),
    inMarked: marks.map((m, i) => (m ? (before[i] ? Math.abs(after[i] - before[i]) / before[i] : 0) : null))
                   .filter(v => v != null),
  };

  /* And a cortical parcel, which is the case that was broken outright. The cortex is one mesh
   * carrying every Desikan-Killiany parcel, and `locate` looked its argument up among the
   * meshes that have a region id of their own — so all thirteen cortical regions answered
   * null and the panel told the reader the temporal lobe was "not one of the structures this
   * series can cut", when it is most of what these cuts pass through. Selected through the
   * app's own entry point, because that is how a reader reaches it: from the picture, from the
   * panel, from an exercise's own list of regions — none of which is the lab's region map. */
  const M = await import('/src/main.js');
  M.selectStructure(3);
  await new Promise(r => setTimeout(r, 1500));
  const cort = sig();
  const cortical = {
    located: !!M.locateInSections(3),
    where: document.querySelector('#labSectWhere')?.textContent ?? '',
    marked: [...document.querySelectorAll('#labSectRow .sectfig')]
              .filter(f => f.classList.contains('hasit')).length,
    moved: before.map((b, i) => (b ? Math.abs(cort[i] - b) / b : 0)),
  };

  /* The 3D pair: one structure alone and where it sits in the body. Two things are tested and
   * they are different. That both canvases carry ink is the easy half. The one that matters is
   * that choosing a *cortical parcel* draws only that parcel and not the whole cortex — the
   * cortex is one mesh carrying every parcel, so "show the motor cortex on its own" by showing
   * its mesh shows all of it, under a caption saying otherwise. A parcel is a fraction of the
   * sheet, so what is drawn has to be a fraction of the mesh's triangles — read off the
   * geometry through `parcelShare`, never off the pixels. */
  const inkOfCv = cv => {
    if (!cv) return 0;
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 90) n++;
    return n;
  };
  const detA = () => inkOfCv(document.querySelector('#labP13a canvas'));
  /* Generous waits: the three panels that borrow the renderer share one budget priced on what
   * a render actually costs, and under a software rasteriser that is most of a second each. */
  M.selectStructure(9);                            // Broca's area — a small cortical parcel
  await new Promise(r => setTimeout(r, 5000));
  /* How bright it is, not only whether anything is lit.
   *
   * Both offscreen renders came out of three with neither tone mapping nor the sRGB encode —
   * a render target gets neither — so they were raw linear radiance shown as sRGB, which
   * darkens every midtone by more than half. Ink alone could not see it: the picture had
   * thousands of lit pixels and read as an almost black box, mean 3.4 of 255 on the wide view
   * with nothing anywhere above 126. So the mean and the peak are measured too. */
  const levelOf = cv => {
    if (!cv) return { mean: 0, max: 0 };
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    let sum = 0, max = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) {
      const v = (d[i] + d[i + 1] + d[i + 2]) / 3;
      sum += v; n++;
      if (v > max) max = v;
    }
    return { mean: +(sum / Math.max(1, n)).toFixed(1), max: Math.round(max) };
  };
  const detail = {
    read: document.querySelector('#labF13')?.textContent ?? '',
    alone: detA(),
    body: inkOfCv(document.querySelector('#labP13b canvas')),
    ring: !document.querySelector('#labRing13')?.hidden,
    /* Read off the geometry, not off the pixels — see `parcelShare`. Both views are framed to
     * their own subject, so a small parcel and the whole cortex fill the same fraction of the
     * panel and no pixel count can tell them apart. */
    share: M.parcelShare(9),
    levelA: levelOf(document.querySelector('#labP13a canvas')),
    levelB: levelOf(document.querySelector('#labP13b canvas')),
  };

  /* The cuts answer the other direction: point at a shape and it says what that shape is.
   * Driven through the same entry point the pointer uses, over a grid, because a pointer sweep
   * on a page rendering at one frame a second is a timing test and not a behaviour test. */
  const grid = [];
  for (let j = 1; j < 12; j++) for (let i = 1; i < 12; i++)
    grid.push([-1 + (2 * i) / 12, -1 + (2 * j) / 12]);
  const hits = new Set();
  for (const at of [-0.31, 0, 0.31])
    for (const [sx, sy] of grid) {
      const h = M.pickInSection('axial', at, sx, sy);
      if (h?.name) hits.add(h.name);
    }
  const cutPick = { named: [...hits].slice(0, 8), count: hits.size,
                    miss: M.pickInSection('axial', 0, 0.98, 0.98) };

  const rows = [...document.querySelectorAll('#labEv .evrow')];
  const ev = {
    rows: rows.length,
    heads: document.querySelectorAll('#labEv .evhead').length,
    strip: document.querySelectorAll('#labP5 .evseg').length,
    noClaim: rows.filter(r => !r.querySelector('.evclaim')?.textContent.trim()).length,
    noCite: rows.filter(r => !r.querySelector('.evcite')?.textContent.trim()).length,
    noFacts: rows.filter(r => !r.querySelector('.evfacts div')).length,
  };
  const open = !document.getElementById('lab').hidden;
  document.getElementById('labClose').click();
  await new Promise(r => setTimeout(r, 500));
  return { open, closed: document.getElementById('lab').hidden, chosen, panels, tiles, ev, sect, fib, locate, cortical, detail, tour, cutPick, rc };
});
console.log('lab:', JSON.stringify(lab));
if (!lab.open) errors.push('the lab button did not open the lab');
if (!lab.closed) errors.push('the lab did not close');
{
  const blank = Object.entries(lab.panels).filter(([, n]) => n < 500).map(([k]) => k);
  if (Object.keys(lab.panels).length < 6)
    errors.push(`the lab drew ${Object.keys(lab.panels).length} panels, expected 6`);
  if (blank.length) errors.push(`lab panels with nothing in them: ${blank.join(', ')}`);
  if (lab.tiles.some(t => !/\d/.test(t))) errors.push('a lab tile carries no number');
}
{
  const ev = lab.ev ?? {};
  console.log('evidence table:', JSON.stringify(ev));
  if (!(ev.rows >= 8)) errors.push(`the evidence table drew ${ev.rows} claims`);
  if (!(ev.heads >= 2)) errors.push('the evidence table grouped nothing by tier');
  if (!(ev.strip >= 2)) errors.push('the evidence distribution strip is missing');
  if (ev.noClaim) errors.push(`${ev.noClaim} evidence rows carry no claim`);
  if (ev.noCite) errors.push(`${ev.noCite} evidence rows carry no citation`);
  if (ev.noFacts) errors.push(`${ev.noFacts} evidence rows carry no effect or population`);
}
{
  const sect = lab.sect ?? {};
  console.log('lab sections:', JSON.stringify(sect));
  if (sect.figs !== sect.want)
    errors.push(`the lab enlarged ${sect.figs} sections, and SectionStrip cuts ${sect.want}`);
  /* Enough of them to catch a small structure. The thalamus is about 30 mm across and the
   * amygdala under 20, so cuts spaced further apart than that can miss one entirely and report
   * it as in none of them — which reads as absence rather than as a gap in the sampling. */
  if (!(sect.want >= 7)) errors.push(`only ${sect.want} cuts: too coarse for a small structure`);
  if (sect.blank) errors.push(`${sect.blank} enlarged sections drew nothing`);
  if (sect.noMm) errors.push(`${sect.noMm} enlarged sections carry no millimetre caption`);
  if (!(sect.keys >= 5)) errors.push('the sections panel does not say what the picture means');
  if (sect.planes !== 3) errors.push(`the sections panel offers ${sect.planes} planes, expected 3`);
}
{
  const fib = lab.fib ?? {};
  console.log('fibre plot:', JSON.stringify(fib));
  if (fib.views !== 4) errors.push(`the fibre plot offers ${fib.views} view buttons, expected 4`);
  if (!(fib.side?.lit > 2000)) errors.push('the fibre plot drew nothing from the side');
  if (!(fib.above?.lit > 2000)) errors.push('the fibre plot drew nothing from above');
  /* And it has to fill its box rather than collapse against one edge. A panel laid out for a
   * width of zero — which is what `Panel.w` reads before `fit()` has run — puts four thousand
   * cells in a stripe down the left, which is plenty of lit pixels and completely wrong. So
   * the test is that the ink is spread across the columns, not merely that there is some. */
  for (const [name, v] of [['side', fib.side], ['above', fib.above]]) {
    if (!v?.grid) continue;
    const cols = new Array(16).fill(0);
    v.grid.forEach((n, i) => { cols[i % 16] += n; });
    const used = cols.filter(n => n > v.lit * 0.005).length;
    if (used < 6)
      errors.push(`the fibre plot "${name}" collapsed into ${used} of 16 columns — it was laid out before its panel had a width`);
  }
  /* The two hemispheres separate from above, so it is a different picture — compared cell by
   * cell of a coarse grid, as a share of the ink, rather than by a statistic that barely moves
   * between two plots each fitted to its own data. */
  if (fib.side?.grid && fib.above?.grid) {
    let diff = 0;
    for (let i = 0; i < fib.side.grid.length; i++)
      diff += Math.abs(fib.side.grid[i] - fib.above.grid[i]);
    const share = diff / Math.max(1, fib.side.lit + fib.above.lit);
    console.log('projection difference:', share.toFixed(3));
    if (share < 0.12)
      errors.push(`the projection buttons barely changed the picture: ${share.toFixed(3)} of the ink moved`);
  }
}
{
  const lo = lab.locate ?? {};
  console.log('cuts locate:', JSON.stringify(lo));
  if (!lo.chip) errors.push('the cut legend has no hippocampus to select');
  else {
    // it is a real structure with a real extent, so the cuts must find it and say where
    if (!/-?\d+ mm/.test(lo.where)) errors.push(`selecting a structure said nothing useful: "${lo.where}"`);
    if (!lo.marked) errors.push('no cut was marked as containing the selected structure');
    /* The cut that holds it has to look different afterwards — that is the whole of "make the
     * chosen part stand out by being lighter", and a marker class alone would pass while the
     * picture stayed identical. */
    if (!lo.inMarked?.some(v => v > 0.05))
      errors.push(`choosing a structure did not change the cut it is in: ${JSON.stringify(lo.inMarked)}`);
  }
  const co = lab.cortical ?? {};
  console.log('cuts locate, cortical parcel:', JSON.stringify(co));
  if (!co.located)
    errors.push('a cortical parcel cannot be located in the cuts — the cortex is one mesh carrying every parcel, and every parcel has to be findable in it');
  if (!(co.marked >= 1))
    errors.push(`a cortical parcel marked no cut, and these cuts are mostly cortex: ${co.marked}`);
  if (!co.moved?.some(v => v > 0.05))
    errors.push(`choosing a cortical parcel changed no thumbnail: ${JSON.stringify(co.moved)}`);
  const ch = lab.chosen ?? {};
  console.log('exercise chose a brain region:', JSON.stringify(ch));
  if (!(ch.id > 0))
    errors.push('choosing an exercise marked its brain regions but selected none of them');
  else if (!ch.marked?.includes(ch.id))
    errors.push(`the exercise selected region ${ch.id}, which is not one its own claims name: ${JSON.stringify(ch.marked)}`);

  const de = lab.detail ?? {};
  console.log('structure in 3D:', JSON.stringify({ ...de, read: de.read?.slice(0, 80) }));
  if (!(de.alone > 200)) errors.push(`the structure-alone view drew ${de.alone} lit pixels`);
  if (!(de.body > 200)) errors.push(`the where-in-the-body view drew ${de.body} lit pixels`);
  if (!de.ring) errors.push('the body view did not mark where the structure is');
  /* Broca's area is a small parcel of one mesh carrying every parcel, so drawn "on its own" it
   * must be a fraction of that mesh's triangles and not all of them. A share of 1 is the
   * failure this exists for: the close view showing the whole cortex under a caption saying
   * otherwise. Measured off the geometry, because both views are framed to their own subject
   * and no pixel count can tell a small parcel from a large one. */
  if (!(de.share > 0 && de.share < 0.5))
    errors.push(`"on its own" drew ${de.share} of the cortex mesh for one small parcel`);
  if (!de.read) errors.push('the structure-in-3D panel says nothing about what it is showing');
  /* Bright enough to look at. The bar is the peak rather than the mean: this is one small
   * structure on a near-black ground, so the mean is properly low and a mean-based bar would
   * either pass the black version or fail a correct one. A picture whose brightest pixel is
   * under half scale has had its tone map or its colour-space encode dropped — which is
   * exactly what a render into a target loses, silently, with the geometry all correct. */
  for (const [k, v] of [['alone', de.levelA], ['in the body', de.levelB]])
    if (!(v?.max >= 150))
      errors.push(`the structure-${k} view peaks at ${v?.max} of 255 — it is drawing dark`);

  const to = lab.tour ?? {};
  console.log('tour:', JSON.stringify(to));
  if (!(to.chips > 4)) errors.push(`the structure tour lists ${to.chips} structures`);
  if (!(to.groups?.length >= 3))
    errors.push(`the tour is not grouped by kind: ${JSON.stringify(to.groups)}`);
  if (!to.current) errors.push('the tour is showing nothing — no structure is marked as current');
  /* It plays by itself, which is the whole of "I don't want to choose one by one myself". The
   * button reads as pause while it is playing. */
  if (to.playing !== '❚❚') errors.push('the structure tour did not start itself');
  if (to.stopped !== '▶')
    errors.push('choosing a structure did not stop the tour — it will take the choice back');
  /* Ranked, hardest-worked first, and the number is the one it is ranked on. Checked against
   * the analysis rather than assumed, because a list in the wrong order still looks like a
   * list. */
  if (!/^1/.test(to.first)) errors.push(`the tour does not start at rank 1: "${to.first}"`);

  const cp = lab.cutPick ?? {};
  console.log('cuts pick:', JSON.stringify(cp));
  /* Pointing at a cut has to name what is there. More than one structure across three cuts, or
   * it is answering with whatever is nearest to everything. */
  if (!(cp.count >= 2))
    errors.push(`pointing into the cuts named ${cp.count} structures across three of them`);
  /* And it must refuse: the corner of a thumbnail is outside the head, and a pick that answers
   * there is answering about a place with no surface in it. */
  if (cp.miss) errors.push(`the cuts named "${cp.miss.name}" in an empty corner`);

  const rc = lab.rc ?? {};
  console.log('region cells:', JSON.stringify({ ink: rc.ink, read: rc.read?.slice(0, 90) }));
  if (!(rc.ink > 400)) errors.push(`the region cell picker drew ${rc.ink} lit pixels`);
  if (!rc.read) errors.push('the region cell picker says nothing about what it is showing');
}

const looks = cellProbe.looks ?? {};
console.log('brain looks:', JSON.stringify(looks));
if (!looks.changed)
  errors.push(`switching the brain look did not change the picture: ${JSON.stringify(looks)}`);
if (looks.back !== 'tissue') errors.push('the brain look did not switch back');

const graph = cellProbe.graph;
console.log('region network:', JSON.stringify(graph));
if (!graph) errors.push('the brain is on but there is no region network');
else {
  if (graph.nodes < 5) errors.push(`the region network has only ${graph.nodes} nodes`);
  if (!graph.edges) errors.push('the region network has no links');
  if (graph.unnamed) errors.push(`${graph.unnamed} region-network nodes have no name`);
  if (!(graph.canvasInk > 0)) errors.push('the region network drew nothing');
  if (!/\d+/.test(graph.read)) errors.push('the region network reports no counts');
}

const sect = cellProbe.sections ?? { hidden: true };
console.log('sections:', JSON.stringify(sect));
if (sect.hidden) errors.push('the brain is on but the section strip is not there');
else {
  if (!sect.axial?.length) errors.push('the section strip drew no slices');
  const blank = (sect.axial ?? []).filter(t => t.lit < 20).length;
  if (blank) errors.push(`${blank} of ${sect.axial.length} sections are blank`);
  /* Anchored at the *start*, not the end. The caption carries the position and then what the
   * cut passes through — "−28 mm" followed by "Amygdala, Basal ganglia, Brainstem" — so an
   * end-anchored test went red the moment the anatomy was added, which is the test doing its
   * job on a real change rather than a bug. The millimetres still have to be there. */
  if ((sect.axial ?? []).some(t => !/^[+-]?\d+ mm/.test(t.mm)))
    errors.push('a section is not labelled with its position in millimetres');
  // and it has to say what it crosses, which is the half that makes it a section not a number
  if ((sect.axial ?? []).some(t => !/mm\S/.test(t.mm) && !/mm.+\w/.test(t.mm)))
    errors.push('a section says where it is but not what it passes through');
  if (!(Math.abs(sect.movedTo) > 0.05))
    errors.push(`clicking a section left the plane at ${sect.movedTo}`);
  if (!sect.differ) errors.push('two different planes drew the same sections');
  /* Reachable. The strip must not run under the console, and where it is wider than the space
   * it has, there must be a control that pages it — otherwise the cuts past the edge exist
   * only in the DOM. */
  if (sect.underPanel > 0)
    errors.push(`the section strip runs ${sect.underPanel}px under the console panel`);
  if (sect.overflows && !sect.canScroll)
    errors.push('the section strip overflows and offers no way to scroll it');
  if (sect.overflows && !(sect.scrolledTo > 0))
    errors.push(`the section strip's scroll arrow left it at ${sect.scrolledTo}`);
}

/* §9: does the clip actually move the skeleton? A pose that silently does nothing looks
 * exactly like a pose that works, so this compares a bone's world position before and after
 * scrubbing rather than trusting the screenshot. */
const motion = await page.evaluate(async () => {
  const m = await import('/src/main.js');
  const s = await import('/src/structures.js');
  const femur = s.registry().byName.get('femur').id;
  // compare the model's own default standing pose against the clip, not one instant of the
  // clip against another — the Hundred deliberately keeps the legs still
  await m.setExercise(null);
  const before = m.app.centroids[femur]?.clone();
  await m.setExercise('hundred');
  m.poseFromClip(0.5);
  m.frameRig(true);
  const after = m.app.centroids[femur]?.clone();
  const rep = m.musclePathReport('gluteus maximus');
  return {
    hasMotion: m.app.hasMotion,
    femurMovedMm: before && after ? +(before.distanceTo(after) * 1655).toFixed(1) : null,
    // the spine is 24 joints now, so read the region rather than one coordinate, and read
    // each level too — a peel means the levels disagree, which is the whole point
    lumbarDeg: (m.rig?.data?.spine?.regions?.lumbar ?? [])
      .map(seg => +((m.rig.values[`${seg}_flex`] ?? 0) * 180 / Math.PI).toFixed(1)),
    hipFlexion: +(m.rig?.values?.hip_flexion_r ?? 0).toFixed(3),
    pathLenCm: rep ? +(rep.lengthM * 100).toFixed(1) : null,
    pathNormalised: rep ? +rep.normalised.toFixed(3) : null,
    maxForceN: rep ? Math.round(rep.maxIsometricForce) : null,
    liveAct: m.liveActivationOf('transversus abdominis'),
  };
});
console.log('motion:', JSON.stringify(motion));
if (!motion.hasMotion) errors.push('the Hundred has no motion clip');
if (!(motion.femurMovedMm > 80)) errors.push(`clip did not move the skeleton (${motion.femurMovedMm} mm)`);
if (!motion.pathLenCm) errors.push('no OpenSim muscle path for gluteus maximus');
if (!motion.lumbarDeg?.length) errors.push('the segmented spine did not reach the rig');

/* The limitation this release removes: the roll-up used to flex the trunk as one block.
 * Proof is that partway through the peel the lumbar levels hold *different* angles, and
 * that the cranial end leads. Reading one coordinate could never have shown either. */
const peel = await page.evaluate(async () => {
  const m = await import('/src/main.js');
  await m.setExercise('rollup');
  const read = () => (m.rig.data.spine.regions.lumbar)
    .map(seg => +((m.rig.values[`${seg}_flex`] ?? 0) * 180 / Math.PI).toFixed(2));
  m.poseFromClip(0.30); const mid = read();
  m.poseFromClip(0.60); const top = read();
  return { mid, top };
});
console.log('segmental articulation, L5..L1:', JSON.stringify(peel));
const spread = Math.max(...peel.mid) - Math.min(...peel.mid);
if (!(spread > 1)) errors.push(`the roll-up is still flexing as a block (spread ${spread}°)`);
if (!(peel.mid[peel.mid.length - 1] > peel.mid[0]))
  errors.push('the peel is running the wrong way: L5 should trail L1 on the way up');
if (!(Math.min(...peel.top) > 0)) errors.push('the peel never reached the bottom of the lumbar spine');

/* The library browser. Two hundred entries only work if the search and the facets do. */
const library = await page.evaluate(async () => {
  const click = sel => document.querySelector(sel)?.click();
  const type = (sel, v) => {
    const el = document.querySelector(sel);
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  document.getElementById('tabExercise').click();
  const back = document.getElementById('exBack');
  if (back) back.click();
  const total = document.querySelectorAll('[data-ex]').length;
  type('#libQ', 'trikon');
  const searched = [...document.querySelectorAll('[data-ex]')].map(b => b.dataset.ex);
  type('#libQ', '');
  click('[data-facet="discipline"][data-value="yoga"]');
  const yoga = document.querySelectorAll('[data-ex]').length;
  const families = document.querySelectorAll('[data-facet="family"]').length;
  click('#libClear');
  const cleared = document.querySelectorAll('[data-ex]').length;
  return { total, searched, yoga, families, cleared };
});
console.log('library:', JSON.stringify(library));
if (!(library.total > 150)) errors.push(`the library shows only ${library.total} entries`);
if (!library.searched.includes('trikonasana'))
  errors.push(`search for "trikon" missed Trikonasana (got ${library.searched.join(',')})`);
if (!(library.yoga > 50)) errors.push(`the yoga facet returned ${library.yoga}`);
if (!(library.families > 5)) errors.push('the family facet did not narrow to yoga families');
if (library.cleared !== library.total) errors.push('clearing the filters did not restore the list');
await shot('10-library');

/* A yoga pose end to end: the discipline the library doubled in size for, driven through
 * the same rig, so a broken pose shows up as a picture rather than as a passing test. */
const asana = await page.evaluate(async () => {
  const m = await import('/src/main.js');
  await m.setExercise('trikonasana');
  m.poseFromClip(0.5);
  m.frameRig(true);
  const spine = ['lumbar', 'thoracic'].flatMap(r => m.rig.data.spine.regions[r])
    .map(seg => +((m.rig.values[`${seg}_bend`] ?? 0) * 180 / Math.PI).toFixed(2));
  return { hasMotion: m.app.hasMotion, bendSum: +spine.reduce((a, b) => a + b, 0).toFixed(1),
           hipAbduction: +(m.rig.values.hip_adduction_r ?? 0).toFixed(3) };
});
console.log('yoga:', JSON.stringify(asana));
if (!asana.hasMotion) errors.push('Extended Triangle has no clip');
if (!(Math.abs(asana.bendSum) > 20)) errors.push(`the triangle did not side-bend (${asana.bendSum}°)`);
await shot('11-yoga');

// Put the panel back where the rest of this script expects it. Browsing the library
// deselects the exercise, and the movement-view check below reads that state — awaited
// rather than clicked, because setExercise resolves after two layer loads.
await page.evaluate(async () => {
  const m = await import('/src/main.js');
  await m.setExercise('hundred');
});
const shown = await page.evaluate(async () => {
  const m = await import('/src/main.js');
  const THREE = await import('three');
  let visibleMuscleMeshes = 0;
  // the skinned muscle meshes are added to the rig root's *parent*, not the root: a
  // SkinnedMesh is positioned by its bones, not by its place in the hierarchy. Counting
  // inside rig.root finds none of them, which is how the old assertion passed trivially.
  m.rig.root.parent.traverse(o => {
    if (o.isMesh && String(o.userData.layer || '').startsWith('muscles') && o.visible)
      visibleMuscleMeshes++;
  });
  return { paths: m.app.showPaths, meshes: m.app.showMeshes,
           pathsVisible: !!m.musclePathsVisible?.(), visibleMuscleMeshes };
});
console.log('movement view:', JSON.stringify(shown));
// The movement view opens on meshes now. It used to open on paths because a muscle mesh
// bound rigidly to one bone tore open the moment a joint moved, and then because the
// skinning weights dragged the layer into a blob; weights now run along each muscle's own
// span and the meshes hold their shape. The paths remain one toggle away and remain the
// source of truth for anything numeric.
if (shown.paths || !shown.meshes || shown.visibleMuscleMeshes < 50)
  errors.push(`movement view should show muscle meshes, got ${JSON.stringify(shown)}`);
await page.waitForTimeout(4000);
await shot('09-motion');

// pathway
await page.click('#pDesc');
await page.waitForTimeout(6000);
await shot('03-pathway');

/* Is the muscle layer actually blending dual quaternions?
 *
 * `onBeforeCompile` patches the shader by string replacement, and a replacement that stops
 * matching — a three upgrade renaming a chunk, a typo — does nothing at all and silently
 * leaves linear blend skinning in place. That failure looks like "the fix did not work"
 * rather than like an error, so it is worth an assertion: the compiled vertex shader for a
 * skinned muscle has to carry the dual quaternion sampler. */
const dqOn = await page.evaluate(async () => {
  const m = await import('/src/main.js');
  const THREE = await import('three');
  let src = null, mesh = null;
  m.rig.root.parent.traverse(o => {
    if (!mesh && o.isSkinnedMesh && String(o.userData.layer || '').startsWith('muscles')) mesh = o;
  });
  if (!mesh) return { found: false };
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.physical.vertexShader,
                   fragmentShader: THREE.ShaderLib.physical.fragmentShader };
  mesh.material.onBeforeCompile(shader);
  src = shader.vertexShader;
  return { found: true, hasSampler: src.includes('dqTexture'),
           hasBlend: src.includes('dqTranslate'),
           lbsGone: !src.includes('#include <skinning_vertex>'),
           bones: m.boneDQ ? m.boneDQ.data.length / 8 : 0 };
});
console.log('dual quaternion skinning:', JSON.stringify(dqOn));
if (!dqOn.found || !dqOn.hasSampler || !dqOn.hasBlend || !dqOn.lbsGone)
  errors.push(`the muscle shader is not using dual quaternion skinning: ${JSON.stringify(dqOn)}`);

/* Does the picture fit the box it is drawn in?
 *
 * This is the rule the clickability check was really measuring. `resize()` used to read the
 * stage and only ran on a window resize, so when the header's disclaimer chips wrapped onto a
 * second line — after load, with no window resize — the stage lost thirty pixels and the
 * renderer kept the taller buffer. The image was squashed four per cent vertically and every
 * ray `pick` cast went through a point up to thirty pixels from the pixel under the pointer.
 * A whole band of the body was drawn in one place and picked in another. */
const fit = await page.evaluate(async () => (await import('/src/main.js')).viewFit());
console.log('view fit:', JSON.stringify(fit));
if (Math.abs(fit.aspect - fit.boxAspect) > 0.005)
  errors.push(`the drawing buffer ${fit.buffer.join('x')} does not fit its box ${fit.box.join('x')}`);

/* Can you still click the model?
 *
 * `rig.attach` reparents every bound mesh out of its layer group, and picking used to
 * raycast the groups — so once the rig finished loading the whole body, bones and brain
 * became unclickable, and nothing in the suite noticed because every other test selects
 * from the panel. This clicks the picture. */
const clickable = await page.evaluate(async () => {
  const m = await import('/src/main.js');
  const c = document.getElementById('view');
  const off = document.createElement('canvas');
  const ctx = off.getContext('2d', { willReadFrequently: true });
  /* Measure the canvas inside the scan, not once at the top. Opening an exercise opens the
   * panel beside it and the stage resizes, so a rect taken before that samples pixels in one
   * place and casts rays through another — which is what the "13% of the posed body cannot be
   * clicked" reading was: an offset picture, not a picking failure. */
  const scan = () => {
    const r = c.getBoundingClientRect();
    off.width = c.width; off.height = c.height;
    ctx.clearRect(0, 0, off.width, off.height);
    ctx.drawImage(c, 0, 0);
    // per axis, because the two used to disagree and reading one for both is how a squashed
    // buffer looked like a picking failure for as long as it did
    const sx = c.width / r.width, sy = c.height / r.height;
    let painted = 0, dead = 0;
    // a point counts as "on the body" only when its neighbours are too: an antialiased
    // silhouette edge is half background, and a ray through it legitimately misses
    const lit = (cx, cy) => {
      const p = ctx.getImageData(Math.round(cx), Math.round(cy), 1, 1).data;
      return p[0] + p[1] + p[2] > 150;
    };
    /* Find the subject first, then sample it.
     *
     * The dense grid used to be spread over the whole canvas, which made the number of hits a
     * function of how much page surrounded the figure — so widening the stage to full-bleed
     * dropped it from 77 to 48 and failed a floor that exists only to keep the ratio below
     * meaningful. That is the second time this count has drifted into being a claim about
     * composition; measuring inside the body's own painted box is what stops it being one. */
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 1; i < 48; i++) for (let j = 1; j < 32; j++) {
      const cx = c.width * i / 48, cy = c.height * j / 32;
      if (!lit(cx, cy)) continue;
      x0 = Math.min(x0, cx); x1 = Math.max(x1, cx);
      y0 = Math.min(y0, cy); y1 = Math.max(y1, cy);
    }
    if (!Number.isFinite(x0) || x1 - x0 < 8 || y1 - y0 < 8) return { painted: 0, dead: 0 };

    // a dense grid on purpose: at two dozen samples a single thin finger is four per cent
    // of the statistic, and the bar below is a ratio
    for (let i = 1; i < 60; i++) for (let j = 1; j < 40; j++) {
      const cx = x0 + (x1 - x0) * i / 60, cy = y0 + (y1 - y0) * j / 40;
      const x = r.left + cx / sx, y = r.top + cy / sy;
      if (!lit(cx, cy) || !lit(cx - 6, cy) || !lit(cx + 6, cy)
          || !lit(cx, cy - 6) || !lit(cx, cy + 6)) continue;
      painted++;
      if (m.pickAt(x, y) == null) dead++;
    }
    return { painted, dead };
  };
  /* Wait for frames, not for milliseconds. This scan compares what is *painted* against what
   * `pickAt` raycasts, and the raycaster answers about the scene as it is now while the canvas
   * still holds the last frame drawn — so on swiftshader, where a frame takes about a second,
   * a 200 ms sleep reads a stale picture against a fresh scene and invents dead pixels. That
   * put the standing ratio anywhere between 7% and 13% against a 12% bar, run to run. */
  const settle = async (n = 3) => {
    const from = m.frameStats().frames;
    const until = Date.now() + 15000;
    while (m.frameStats().frames - from < n && Date.now() < until)
      await new Promise(r2 => requestAnimationFrame(r2));
  };
  /* And scan from the plain view. The pathway shot just before this one leaves a highlight
   * up, which dims the layers it is not about — those stay painted and stop being pick
   * targets, which is correct behaviour and a meaningless thing to measure here. */
  await m.setPathway(null);
  await m.setExercise(null);
  m.selectStructure(null);
  await settle();
  const standing = scan();
  await m.setExercise('chestLift');
  m.poseFromClip(0.5);
  await settle();
  const posed = scan();
  await m.setExercise(null);
  return { standing, posed };
});
console.log('clickable:', JSON.stringify(clickable));

/* Does a leader rope actually land on the thing it names?
 *
 * It did not, and nothing said so, because a rope drawn to the wrong place is still a rope.
 * The anchor was projected into *lane* pixels — the canvas minus whatever the console covers —
 * and then drawn into the label layer, which is the size of the canvas. That is a pure scaling
 * toward x = 0 by the ratio between them: 0.78 on a 1848-wide window with a 400-wide console,
 * so a ring belonging to a structure at x 881 was drawn at 690. Every anchor was displaced,
 * the error grew with the window's width, and on the wide screen it was two hundred pixels —
 * rings sitting on a different part of the brain from the structure they marked.
 *
 * Two assertions, both about pixels rather than about arithmetic. Every visible anchor ring
 * has to sit on painted subject, because a ring in empty space is the bug. And no label plate
 * may sit on the subject, because the lane is supposed to be beside it — that is the one that
 * catches a lane sized from the anchors instead of from the silhouette. */
const anchors = await page.evaluate(async () => {
  const m = await import('/src/main.js');
  const c = document.getElementById('view');
  const r = c.getBoundingClientRect();
  const off = document.createElement('canvas');
  off.width = c.width; off.height = c.height;
  const ctx = off.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(c, 0, 0);
  const sx = c.width / r.width, sy = c.height / r.height;
  const px = ctx.getImageData(0, 0, c.width, c.height).data;
  // the same bar the pick scan uses, so "painted" means one thing in this file
  const lit = (x, y) => {
    const ix = Math.round(x * sx), iy = Math.round(y * sy);
    if (ix < 0 || iy < 0 || ix >= c.width || iy >= c.height) return false;
    const i = (iy * c.width + ix) * 4;
    return px[i] + px[i + 1] + px[i + 2] > 150;
  };
  // a ring is a few pixels across and sits on a silhouette that is antialiased, so a small
  // neighbourhood counts rather than the single pixel under its centre
  const near = (x, y) => {
    for (let dx = -5; dx <= 5; dx += 5) for (let dy = -5; dy <= 5; dy += 5)
      if (lit(x + dx, y + dy)) return true;
    return false;
  };
  let box = { x0: Infinity, x1: -Infinity };
  for (let i = 1; i < 64; i++) for (let j = 1; j < 40; j++) {
    const x = r.width * i / 64, y = r.height * j / 40;
    if (!lit(x, y)) continue;
    box.x0 = Math.min(box.x0, x); box.x1 = Math.max(box.x1, x);
  }
  const onSubject = [];
  for (const el of document.querySelectorAll('.lab3d')) {
    if (el.hidden || el.style.opacity === '0') continue;
    const b = el.getBoundingClientRect();
    if (Number.isFinite(box.x0) && b.right - r.left > box.x0 + 6 && b.left - r.left < box.x1 - 6)
      onSubject.push(el.querySelector('.labname')?.textContent.trim() ?? '?');
  }
  /* The dots carry their position as an inline left/top, so they are read straight off the
   * style rather than paired back to their plates — every visible one has to be on the
   * subject whichever label owns it. */
  let dots = 0, off2 = 0;
  for (const d of document.querySelectorAll('.labdot')) {
    if (d.style.opacity === '0' || !d.style.left) continue;
    dots++;
    if (!near(parseFloat(d.style.left), parseFloat(d.style.top))) off2++;
  }
  return { subject: [Math.round(box.x0), Math.round(box.x1)],
           dots, adriftDots: off2, platesOnSubject: onSubject };
});
console.log('label anchors:', JSON.stringify(anchors));
if (!anchors.dots) errors.push('no label anchor is drawn at all');
else if (anchors.adriftDots / anchors.dots > 0.25)
  errors.push(`${anchors.adriftDots} of ${anchors.dots} label anchors are not on the subject`);
if (anchors.platesOnSubject.length > 2)
  errors.push(`label plates sit on the subject: ${anchors.platesOnSubject.slice(0, 5).join(', ')}`);
/* Both states are held tight now.
 *
 * The seventh of the posed body that used to be unclickable was not a picking bug at all: the
 * drawing buffer was 30 px taller than the box it was displayed in, so the picture was
 * squashed and every ray went through a point up to 30 px from the pixel under it. See the
 * viewFit check above, which is the rule that actually prevents it. */
const BAR = { standing: 0.04, posed: 0.05 };
/* The floor is a sample-size guard for the ratio below, and nothing else.
 *
 * It became a claim about composition twice — once when `deriveHome` replaced a hand-written
 * crop and put more page around the figure, and again when the stage went full-bleed. The grid
 * is laid inside the body's own painted box now, so the count reflects how much of the subject
 * is pickable rather than how much of the window the subject fills, and a change of layout
 * cannot move it. */
for (const [when, st] of Object.entries(clickable)) {
  if (!(st.painted > 200))
    errors.push(`${when}: only ${st.painted} sampled points show the body`);
  else if (st.dead / st.painted >= BAR[when])
    errors.push(`${when}: ${st.dead} of ${st.painted} points show the body but cannot be clicked`);
}

/* Does anything shoot out of the body?
 *
 * A peripheral nerve is the longest structure in the model and crosses five joints, and it
 * used to be bound rigidly to whichever segment its centroid happened to sit nearest — so
 * the moment a knee bent, the nerve stayed pointing where the pelvis pointed and left the
 * body as a yellow spike. Nerves are skinned now. This measures the failure directly: no
 * structure's posed bulk may sit far from every joint in the rig. */
const strays = await page.evaluate(async () => {
  const m = await import('/src/main.js');
  const THREE = await import('three');
  await m.setLayer('nervous', true);
  await m.setExercise('chestLift');
  m.poseFromClip(0.5);
  await new Promise(r => setTimeout(r, 400));
  const joints = [];
  for (const [, rec] of m.rig.nodes)
    joints.push(new THREE.Vector3().setFromMatrixPosition(rec.body.matrixWorld));
  const box = new THREE.Box3(), sph = new THREE.Sphere();
  const acc = new THREE.Vector3(), tmp = new THREE.Vector3(), mat = new THREE.Matrix4();
  const worst = [];
  m.rig.root.parent.traverse(o => {
    if (!o.isMesh || !o.visible || o.userData.layer !== 'nervous') return;
    const geo = o.geometry, pos = geo.getAttribute('position');
    const si = geo.getAttribute('skinIndex'), sw = geo.getAttribute('skinWeight');
    box.makeEmpty();
    const step = Math.max(1, Math.floor(pos.count / 160));
    for (let i = 0; i < pos.count; i += step) {
      tmp.set(pos.getX(i), pos.getY(i), pos.getZ(i));
      if (si && o.isSkinnedMesh) {
        acc.set(0, 0, 0);
        for (let k = 0; k < 4; k++) {
          const w = sw.getComponent(i, k);
          if (!w) continue;
          const bi = si.getComponent(i, k);
          mat.multiplyMatrices(o.skeleton.bones[bi].matrixWorld, o.skeleton.boneInverses[bi]);
          acc.addScaledVector(tmp.clone().applyMatrix4(mat), w);
        }
        box.expandByPoint(acc);
      } else box.expandByPoint(tmp.clone().applyMatrix4(o.matrixWorld));
    }
    if (box.isEmpty()) return;
    box.getBoundingSphere(sph);
    let near = Infinity;
    for (const j of joints) near = Math.min(near, sph.center.distanceTo(j));
    worst.push([o.name || '(unnamed)', +near.toFixed(3)]);
  });
  await m.setExercise(null);
  worst.sort((a, b) => b[1] - a[1]);
  return worst.slice(0, 4);
});
console.log('nerves furthest from any joint:', JSON.stringify(strays));
if (strays[0] && strays[0][1] > 0.22)
  errors.push(`${strays[0][0]} sits ${strays[0][1]} from the nearest joint — it left the body`);

/* Pick a muscle from the panel.
 *
 * By `[data-id]`, which is what actually carries the structure, rather than by the class the
 * list happened to use — this went looking for `.chip` and quietly found nothing the day
 * Explore's list became a grid of swatches, logged `selected: null`, and passed. A check that
 * silently stops checking is worse than no check, so the result is asserted now: the click has
 * to name the muscle it meant *and* the application has to end up with it selected. */
await page.click('#tabExplore');
await page.waitForTimeout(400);
const picked = await page.evaluate(async () => {
  const b = [...document.querySelectorAll('#panelBody [data-id]')]
    .find(x => /Transversus/i.test(x.textContent));
  if (!b) return { clicked: null };
  b.click();
  await new Promise(r => setTimeout(r, 600));
  const m = await import('/src/main.js');
  const s = await import('/src/structures.js');
  return { clicked: b.textContent.trim(),
           selected: m.app.selected == null ? null : s.nameOf(m.app.selected, 'en') };
});
await page.waitForTimeout(3500);
await shot('04-muscle');
console.log('selected:', JSON.stringify(picked));
if (!picked.clicked) errors.push('no structure in the Explore list could be clicked');
else if (!picked.selected)
  errors.push(`clicking ${picked.clicked} in the Explore list selected nothing`);

// korean
await page.click('#langBtn');
await page.waitForTimeout(1200);
await shot('05-korean');

// evidence tab
await page.click('#tabEvidence');
await page.waitForTimeout(800);
await shot('06-evidence');

/* Brain layer, head view, then x-ray — in that order, and asserting arrival in between.
 * Under swiftshader a fully translucent scene of 400-odd meshes plus a 300k-triangle cortex
 * runs at a couple of frames per second, so applying x-ray first starves the camera flight
 * and the assertion below fails on the renderer rather than on anything the app did wrong. */
await page.click('#langBtn');
await page.evaluate(async () => {
  const m = await import('/src/main.js');
  // leave the exercise first: the brain does not ride the rig, so a posed body and a head
  // view are two different framings and running them together tests neither
  await m.setExercise(null);
  await m.setLayer('brain', true);
});
await page.waitForTimeout(3000);
// immediate: an animated move needs frames to land, and this scene renders at a frame every
// few seconds under swiftshader, so animating here would test the rasteriser
await page.evaluate(async () => { (await import('/src/main.js')).setView('head', true); });
await page.waitForTimeout(2000);
await measureFps('all layers + brain, head close-up');
const cam = await page.evaluate(async () => {
  const m = await import('/src/main.js');
  const f = await import('/src/frame.js');
  return { brainCentre: f.BRAIN_TO_BODY.translation.map(v => +v.toFixed(3)), ...m.cameraState() };
});
console.log('camera:', JSON.stringify(cam));
if (Math.abs(cam.t[1] - cam.brainCentre[1]) > 0.02)
  errors.push(`head view did not arrive: target y ${cam.t[1]} vs brain ${cam.brainCentre[1]}`);
await shot('07-brain');

await page.evaluate(async () => { (await import('/src/main.js')).setXray(0.85); });
await page.waitForTimeout(15000);
await shot('08-xray');

/* And does it work on a phone?
 *
 * Every screenshot this project has been reported against came from one, and nothing here
 * had ever loaded it narrow. It was broken in a way one property caused: `.disc` is
 * `white-space:nowrap`, so the longest disclaimer chip set a minimum content width of 476px
 * for the whole document, the browser widened the layout viewport to fit it, and the view
 * bar, the language toggle, the About tab and every structure label were pushed off the side
 * of a 390px screen — along with all four disclaimers, each cut off mid-sentence. Those four
 * lines are the ones that must not move.
 *
 * So the check is the cause, not the symptom: at 390 CSS pixels the layout viewport has to
 * *be* 390, and nothing may hang off the edge of it. */
const phone = await browser.newPage({ viewport: { width: 390, height: 844 },
                                      deviceScaleFactor: 2, isMobile: true, hasTouch: true });
phone.on('console', m => { if (m.type() === 'error') errors.push(`phone: ${m.text()}`); });
// generous: this is a second WebGL context on a software rasteriser
phone.setDefaultNavigationTimeout(180000);
await phone.goto(`http://127.0.0.1:${port}/index.html`);
await phone.waitForFunction('document.body.classList.contains("ready")', null, { timeout: 180000 });
await phone.waitForTimeout(4000);
const narrow = await phone.evaluate(() => {
  const W = innerWidth, out = [];
  for (const e of document.querySelectorAll('*')) {
    const b = e.getBoundingClientRect();
    // a label dot is 7px wide and centred on its point, so it may sit a few pixels over
    if (b.width < 8 || b.height === 0) continue;
    if (b.right > W + 1)
      out.push(`${e.id ? '#' + e.id : '.' + String(e.className).split(' ')[0]} ` +
               `"${(e.textContent || '').trim().slice(0, 24)}"`);
  }
  return { W, over: [...new Set(out)].slice(0, 6),
           discs: [...document.querySelectorAll('.disc')].map(d => Math.round(d.getBoundingClientRect().right)) };
});
console.log('phone:', JSON.stringify(narrow));
if (narrow.W !== 390)
  errors.push(`at a 390px viewport the layout is ${narrow.W}px wide — something sets a minimum`);
if (narrow.over.length)
  errors.push(`off the right of a phone screen: ${narrow.over.join(', ')}`);
if (narrow.discs.some(r => r > narrow.W))
  errors.push('a disclaimer runs off the side of a phone screen');
await phone.close();

await browser.close();
server.close();

/* Everything that failed, whichever kind. `errors` holds browser console errors *and* failed
 * assertions, and calling the total "console errors" sent me looking for a browser fault that
 * was never there. */
console.log(`\nfailures: ${errors.length}`);
for (const e of errors.slice(0, 20)) console.log('  ✗', e);
if (warnings.length) {
  console.log(`warnings: ${warnings.length}`);
  for (const w of warnings.slice(0, 8)) console.log('  !', w);
}
process.exit(errors.length ? 1 : 0);
