/**
 * The session panel writes into the column it is watching, and must not chase itself.
 *
 * `attachPanel` renders the reading for the selected structure by *watching* the
 * application's own panel with a `MutationObserver` rather than by forking `ui.js`
 * — see the header of `src/session/panel.js`. That makes its own writing an input
 * to itself, and the only thing standing between it and an infinite loop is the
 * guard that says "this column has already been written for this selection".
 *
 * That guard was defeated once, and the failure is worth a test rather than a
 * comment. It read `detail.querySelector('.ss-panel')`, while the block was being
 * inserted as a *sibling* of `.detail` — because the anchors it looked for,
 * `.dwhere` and `.dname`, live in `.shead`, which is `.detail`'s sibling and never
 * matched, so the insertion fell through to `detail.insertAdjacentHTML('afterend')`.
 * The guard therefore never saw its own output, painted again on the mutation it
 * had just caused, and painted again on that one.
 *
 * Observer callbacks are microtasks. A microtask that queues another microtask
 * never yields to the event loop: no animation frame, no timer, no render, and one
 * more copy of the reading in the DOM per turn until the tab is killed for memory.
 * From the outside it is a click on a body part that freezes the whole application,
 * which is exactly how it was reported.
 *
 * So this asserts three things about one selection: the observer settles, exactly
 * one reading is written, and it is written *inside* the column. A runaway is
 * caught by capping the callbacks rather than by waiting for the page to die —
 * a starved event loop cannot fail a test, it can only hang it.
 *
 * Run with a browser because the subject is a DOM contract: `MutationObserver`
 * delivery order and `insertAdjacentHTML` placement are the whole of the bug, and
 * neither survives a stub.
 *
 * Usage: node test/panel.test.mjs
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';

const ROOT = new URL('../', import.meta.url).pathname;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
               '.json': 'application/json', '.css': 'text/css' };

const server = createServer(async (req, res) => {
  let p = normalize(decodeURI(req.url.split('?')[0]));
  if (p === '/') p = '/index.html';
  try {
    const body = await readFile(join(ROOT, p));
    res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404).end('not found'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const browser = await chromium.launch({
  ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}),
  args: ['--no-sandbox'],
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

/* A page of nothing, so the only thing under test is the panel. The application
 * is not loaded: `attachPanel` takes what it needs through its arguments, and the
 * column it watches is the one built below. */
await page.goto(`http://127.0.0.1:${port}/test/panel.fixture.html`);

const PAINT_CAP = 60;

const run = (id) => page.evaluate(async ({ cap, structure }) => {
  /* The cap, installed before the module is imported so it wraps the observer
   * the module makes. A runaway is stopped here and reported, rather than being
   * left to starve the event loop -- which would hang this test instead of
   * failing it, and say nothing about why. */
  window.__paints = 0;
  window.__runaway = false;
  const Native = window.MutationObserver;
  window.MutationObserver = class extends Native {
    constructor(cb) {
      super(function wrapped(records, self) {
        if (++window.__paints > cap) { window.__runaway = true; self.disconnect(); return; }
        return cb.call(this, records, self);
      });
    }
  };

  const record = { id: structure, key: 'rectus_abdominis', kind: 'muscle', layer: 'muscles_superficial',
                   name: { en: 'Rectus abdominis', ko: '배곧은근' }, color: '#c86' };
  /* No entry for it, which is the ordinary case for a structure this class did
   * not measure -- and the case that has no role chip, so it is the one whose
   * insertion had nowhere anchored to go. */
  const session = { about: () => null, history: () => null,
                    registry: { byId: new Map([[structure, record]]) },
                    person: { username: 'demo' }, key: '' };
  /* Counted, because the pacing in `drawViews` is the other half of this fix and
   * it is invisible from the DOM: a panel render is a full scene render into an
   * offscreen buffer ending in `readRenderTargetPixels`, which is a pipeline
   * stall. One thumbnail is a fair price for a selection; the burst of them that
   * a repainting panel asked for is not. */
  window.__renders = 0;
  const nw = { app: { selected: structure },
               renderStructureInto: () => { window.__renders += 1; return { sx: 0.5, sy: 0.5 }; },
               selectStructure: () => {} };

  const { attachPanel } = await import('/src/session/panel.js');
  const detach = attachPanel(session, nw, {});

  /* The column the application draws for a chosen structure: the heading is a
   * *sibling* of the detail block, which is the shape that broke the anchor. */
  document.getElementById('panelBody').innerHTML = `
    <div class="shead">
      <div class="dname">Rectus abdominis</div>
      <div class="dwhere">Muscle · Superficial</div>
    </div>
    <div class="detail">
      <div class="blk"><h4>Does</h4><p>Flexes the trunk.</p></div>
      <div class="empty small"><h2>Nothing yet</h2></div>
    </div>`;

  await new Promise((r) => setTimeout(r, 400));
  const out = {
    runaway: window.__runaway,
    paints: window.__paints,
    panels: document.querySelectorAll('.ss-panel').length,
    inDetail: document.querySelectorAll('.detail .ss-panel').length,
    renders: window.__renders,
    views: document.querySelectorAll('canvas[data-view]').length,
    // and the event loop still has turns to give: a frame, and a timer
    framed: await new Promise((r) => {
      const t = setTimeout(() => r(false), 2000);
      requestAnimationFrame(() => { clearTimeout(t); r(true); });
    }),
  };
  detach();
  window.MutationObserver = Native;
  return out;
}, { cap: PAINT_CAP, structure: id });

const first = await run(263);
assert.equal(first.runaway, false,
  `the panel repainted more than ${PAINT_CAP} times: it is watching its own writing`);
assert.equal(first.panels, 1, `one reading per selection, got ${first.panels}`);
assert.equal(first.inDetail, 1, 'the reading goes inside the column, not beside it');
assert.equal(first.framed, true, 'the event loop still runs after the panel has painted');
assert.equal(first.views, 1, `one view canvas per reading, got ${first.views}`);
assert.equal(first.renders, 1,
  `one scene render for one selection, got ${first.renders}`);
console.log(`  panel settles in ${first.paints} observer callback(s), one reading, inside .detail,`
          + ` drawn with ${first.renders} scene render`);

assert.deepEqual(errors, [], `console errors: ${errors.join(' | ')}`);

await browser.close();
server.close();
console.log('panel: ok');
