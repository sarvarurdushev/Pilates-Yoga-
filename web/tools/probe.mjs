/**
 * Open the real app in headless Chromium and hand back a page to ask questions of.
 *
 * Every investigation of this app that could not be settled by reading the code has been the
 * same fifteen lines of setup — a static server, swiftshader flags, a wait for `body.ready`,
 * a wait for the scene to settle — followed by three lines of the actual question. Written
 * out each time, those fifteen lines are also where the environment's traps live, and they
 * were rediscovered on almost every probe. They are all handled here now, and the notes say
 * which ones and why, because the next person to hit one will be looking at this file.
 *
 * A probe is not a test. `test/smoke.mjs` is the thing that runs in CI and fails the build;
 * this is for answering a question in the middle of a change — "does clicking that actually
 * select anything", "how long does one body render cost", "did the drag move the picture" —
 * and it should stay cheap enough to write, run and throw away.
 *
 * Typical use, from a file in `.render/`:
 *
 *     import { openApp } from '../tools/probe.mjs';
 *     const { page, say, ink, done } = await openApp({ exercise: 'hundred', lab: true });
 *     say('selected: ' + await page.evaluate(async () => {
 *       const m = await import('/src/main.js');
 *       return m.app.selected;
 *     }));
 *     await done();
 *
 * Run it detached and read the file, never through a pipe — see `runNote` below.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.glb': 'model/gltf-binary', '.css': 'text/css',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm',
};

/* Swiftshader renders this scene at about one frame a second. That is the software
 * rasteriser and not the app, and it is the single fact that decides every timeout below:
 * a wait measured in frames has to be measured in seconds here, and generously. */
const LAUNCH = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
                '--disable-gpu-sandbox', '--no-sandbox'];

/**
 * Serve the repo, open it, wait until it is genuinely ready, and optionally set the scene up.
 *
 * @param {object}  [o]
 * @param {number}  [o.width]     viewport width  (default 1600)
 * @param {number}  [o.height]    viewport height (default 1000)
 * @param {string}  [o.exercise]  load this exercise before returning
 * @param {number}  [o.t]         pose the clip at this normalised time (needs `exercise`)
 * @param {boolean} [o.lab]       open the lab screen before returning
 * @param {boolean} [o.brain]     turn the brain layer on (implied by `lab`)
 * @param {boolean} [o.rotate]    leave the idle turntable running (default false — a moving
 *                                camera makes every before/after pixel comparison noise)
 * @param {number}  [o.settle]    extra ms to let the scene settle after each step
 */
export async function openApp(o = {}) {
  const {
    width = 1600, height = 1000, exercise = null, t = null,
    lab = false, brain = false, rotate = false, settle = 12000,
  } = o;

  const server = createServer(async (q, r) => {
    let p = normalize(decodeURI(q.url.split('?')[0]));
    if (p === '/') p = '/index.html';
    try {
      const b = await readFile(join(ROOT, p));
      r.writeHead(200, { 'content-type': MIME[extname(p)] ?? 'application/octet-stream' });
      r.end(b);
    } catch { r.writeHead(404).end('not found'); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const browser = await chromium.launch({ args: LAUNCH });
  const page = await browser.newPage({ viewport: { width, height } });

  /* Surfaced, always. A probe that quietly runs against a page throwing on every frame
   * reports confident numbers about a broken app, which is worse than reporting nothing. */
  const errors = [];
  page.on('pageerror', e => {
    const line = `PAGEERROR ${e.message}\n${String(e.stack ?? '').split('\n').slice(0, 4).join('\n')}`;
    errors.push(line); console.log(line);
  });
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const line = `CONSOLE ${m.text()}`;
    errors.push(line); console.log(line);
  });

  await page.goto(`http://127.0.0.1:${port}/index.html`, { timeout: 120000 });
  /* `body.ready` is set once the rig, the layers and the panel are all up. Waiting on `load`
   * instead returns a page with no body in it, and swiftshader takes well over playwright's
   * 30 s default to get even that far. */
  await page.waitForFunction('document.body.classList.contains("ready")', null, { timeout: 180000 });

  const main = async (fn, arg) => page.evaluate(
    async ([src, a]) => {
      const m = await import('/src/main.js');
      // eslint-disable-next-line no-new-func
      return await new Function('m', 'a', `return (${src})(m, a);`)(m, a);
    }, [fn.toString(), arg ?? null]);

  await main(m => { m.app.rotate = false; });
  if (rotate) await main(m => { m.app.rotate = true; });
  if (brain && !lab) await main(m => m.setLayer('brain', true));
  await page.waitForTimeout(settle);

  if (exercise) {
    await main(async (m, a) => { await m.setExercise(a.k); if (a.t != null) m.poseFromClip(a.t); },
               { k: exercise, t });
    await page.waitForTimeout(settle);
  }
  if (lab) {
    await page.click('#labBtn');
    await page.waitForTimeout(settle);
  }

  return {
    page, browser, server, port, errors, main,
    say: m => console.log(m),

    /** Lit pixels on a canvas, above a brightness floor — the usual "did the picture change". */
    ink: (sel, floor = 90) => page.$eval(sel, (c, f) => {
      const g = c.getContext('2d');
      let d;
      if (g) d = g.getImageData(0, 0, c.width, c.height).data;
      else {                       // a WebGL canvas has no 2d context; copy it into one
        const o = document.createElement('canvas');
        o.width = c.width; o.height = c.height;
        o.getContext('2d').drawImage(c, 0, 0);
        d = o.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      }
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > f) n++;
      return n;
    }, floor),

    /**
     * Screenshot a region of the page.
     *
     * A *page* clip, never `elementHandle.screenshot()`: that one waits for the element to be
     * stable, and this page repaints continuously, so it times out rather than returning a
     * picture. Ask for the element's box and clip to it instead.
     */
    async shot(path, sel = null, pad = 0) {
      let clip;
      if (sel) {
        /* Scrolled into view first, and the box read *after* the scroll. A page clip is in
         * viewport coordinates, so an element further down the lab than the window is tall
         * has a rect outside the image and playwright refuses the shot rather than scrolling
         * for you. Clamped to the viewport for the same reason. */
        await page.$eval(sel, e => e.scrollIntoView({ block: 'start' }));
        await page.waitForTimeout(1200);
        const b = await page.$eval(sel, e => {
          const r = e.getBoundingClientRect();
          return { x: r.x, y: r.y, w: r.width, h: r.height,
                   vw: innerWidth, vh: innerHeight };
        });
        const x = Math.max(0, b.x - pad), y = Math.max(0, b.y - pad);
        clip = { x, y,
                 width: Math.max(1, Math.min(b.w + pad * 2, b.vw - x)),
                 height: Math.max(1, Math.min(b.h + pad * 2, b.vh - y)) };
      }
      await page.screenshot({ path, clip, timeout: 180000 });
      console.log(`shot ${path}`);
    },

    /** Wait for real frames rather than for wall-clock, where what you measure is a redraw. */
    async frames(n = 3, capMs = 20000) {
      const from = await main(m => m.frameStats?.().frames ?? 0);
      const until = Date.now() + capMs;
      while (Date.now() < until) {
        const now = await main(m => m.frameStats?.().frames ?? 0);
        if (now - from >= n) return now - from;
        await page.waitForTimeout(400);
      }
      return -1;
    },

    async done() { await browser.close(); server.close(); },
  };
}

/**
 * How to run a probe, and why it is not obvious.
 *
 * - **Write to a file, do not pipe.** `node probe.mjs | head -20` shows nothing until the
 *   run ends: `head` cannot flush, and node buffers stdout to a pipe. A probe that takes ten
 *   minutes then looks like a probe that has hung.
 * - **Detach it, and never `pkill -f` it.** A pattern like `pkill -f "probe.mjs"` matches the
 *   shell running the command as well as the probe, so it kills itself and reports exit 144.
 *   Start it with `nohup setsid ... &` and stop it with `kill` on a pid from `pgrep`.
 * - **Wait on a marker in the output, not on a duration.** Have the probe print a last line
 *   and poll for it; the same probe takes two minutes on one machine and twenty on another.
 *
 *     nohup setsid node .render/mine.mjs > /tmp/mine.txt 2>&1 < /dev/null & disown
 *     until grep -q "DONE\|PAGEERROR" /tmp/mine.txt; do sleep 15; done; cat /tmp/mine.txt
 */
export const runNote = 'see the comment above this export';
