/** Room anatomy viewer: how much it draws, before and after the room-only performance mode.
 * It measures; it asserts nothing. One run prints one JSON document (and writes it to $SEDENS_PERF_OUT).
 *
 * The same script runs against any build (the one with the mode and the one without), so the
 * counting does not rely on code the older build does not have:
 *  - drawn frame = an animation-frame callback in the anatomy iframe during which the page issued at
 *    least one WebGL draw call (drawElements/drawArrays, instanced or range variants). requestAnimationFrame
 *    and the draw calls are wrapped by an init script in the iframe only; loop ticks are counted too.
 *  - long tasks: PerformanceObserver("longtask") in the room page (the thread both documents share)
 *    and in the iframe; count and total duration.
 *  - hidden page: the headless browser never really hides a tab, so document.visibilityState is
 *    overridden in the iframe and visibilitychange is dispatched. This tests what the viewer does
 *    when the page is hidden but its animation loop still runs (a browser that does not pause
 *    requestAnimationFrame for hidden pages, or an embedder that hides the window without pausing it).
 *  - when the build exposes window.__sedensAnatomyPerf (room=1&perf=1), a second page checks that
 *    counter against the same wrapper.
 * Windows: idle with the plan screen shown, idle with the workout running, N room changes (a "show"
 * op to different structures), a repeated show (same state), a real step change (Done), a hidden window,
 * and the professional viewer (/anatomy.html without room=1) idle and hidden, which must not change.
 * The counts are what to compare; times in software WebGL are not representative of a GPU.
 *
 * Usage: MOTION_BASE_URL=http://127.0.0.1:8762 CHROMIUM=/path/to/chrome \
 *   [SEDENS_PERF_OUT=run.json] [IDLE_MS=20000] [HIDDEN_MS=10000] [CHANGES=5] [DPR=1] node test/sedens-anatomy-performance.browser.mjs
 * Start the server with SEDENS_MODE=demo_free (the demonstration scan).
 */
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { chromium } from "playwright";

const base = process.env.MOTION_BASE_URL || "http://127.0.0.1:8145";
const IDLE_MS = Number(process.env.IDLE_MS || 20000);
const HIDDEN_MS = Number(process.env.HIDDEN_MS || 10000);
const CHANGES = Number(process.env.CHANGES || 5);
const DPR = Number(process.env.DPR || 1);
const CHANGE_WINDOW_MS = 3500;

const browser = await chromium.launch({
  ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}),
  args: ["--no-sandbox", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
});
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, deviceScaleFactor: DPR, permissions: ["camera"] });

function probe() {
  // Runs in every frame before any page script.
  const isAnatomy = /\/anatomy\.html$/.test(location.pathname);
  if (window === window.top && !isAnatomy) {
    window.__top = { long: 0, longMs: 0 };
    window.__anatomy = [];
    window.addEventListener("message", (e) => {
      if (String(e.data?.type || "").startsWith("sedens-anatomy")) window.__anatomy.push({ ...e.data, at: performance.now() });
    });
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) { window.__top.long += 1; window.__top.longMs += e.duration; }
      }).observe({ type: "longtask", buffered: true });
    } catch { /* not supported */ }
    return;
  }
  if (!isAnatomy) return;
  const P = (window.__probe = { frames: 0, drawn: 0, long: 0, longMs: 0, flag: false });
  for (const C of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
    if (!C) continue;
    for (const fn of ["drawElements", "drawArrays", "drawElementsInstanced", "drawArraysInstanced", "drawRangeElements"]) {
      const original = C.prototype[fn];
      if (!original) continue;
      C.prototype[fn] = function (...args) { P.flag = true; return original.apply(this, args); };
    }
  }
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (callback) => raf((t) => {
    P.flag = false;
    try { callback(t); } finally { P.frames += 1; if (P.flag) P.drawn += 1; P.flag = false; }
  });
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) { P.long += 1; P.longMs += e.duration; }
    }).observe({ type: "longtask", buffered: true });
  } catch { /* not supported */ }
  let state = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  Object.defineProperty(document, "hidden", { configurable: true, get: () => state === "hidden" });
  window.__setVisibility = (next) => { state = next; document.dispatchEvent(new Event("visibilitychange", { bubbles: true })); };
}

await ctx.addInitScript(probe);
await ctx.addInitScript((k) => {
  if (window !== window.top) return;
  sessionStorage.setItem("motion-demo-key", k);
  localStorage.setItem("sedens-lang", "en");
  window.__anatomyReady = 0;
  window.addEventListener("message", (e) => {
    if (e.data?.type === "sedens-anatomy-ready") window.__anatomyReady = performance.now();
  });
}, randomBytes(16).toString("hex"));

const page = await ctx.newPage();
let anatomyRequests = 0;
page.on("request", (r) => { if (r.frame() !== page.mainFrame() && !/anatomy\.html/.test(r.url())) anatomyRequests += 1; });
const frame = () => page.frames().find((f) => /\/anatomy\.html/.test(f.url()));
const journey = async () => page.evaluate(async () => (await (await fetch("/sedens/room/journey")).json()).journey);
const act = async (locator, path) => {
  const answered = page.waitForResponse((r) => r.url().includes(`/sedens/room/journey/${path}`));
  await locator.click();
  await answered;
};

// ---- the journey to the player (as in sedens-room-performance.browser.mjs) ----
await page.goto(base + "/room.html");
await page.locator("#demo-room").waitFor();
await page.locator("#demo-room").click();
await page.getByRole("button", { name: /DEMO-1001/ }).waitFor({ timeout: 180000 });
await page.getByRole("button", { name: /DEMO-1001/ }).click();
await page.locator('[data-act="readiness/start"]').waitFor();
await act(page.locator('[data-act="readiness/start"]'), "readiness/start");
while ((await journey()).state === "readiness") await act(page.locator('[data-answer="no"]'), "readiness/answer");
await page.locator('[data-consent="scan_capture"]').click();
await page.locator('[data-consent="scan_capture"][aria-checked="true"]').waitFor();
await page.locator('[data-start="demo_precomputed"]').click();
await page.locator('[data-cam="take"]').waitFor();
await page.waitForFunction(() => document.querySelector("video")?.readyState >= 2);
for (let n = 0; n < 4; n += 1) {
  await page.locator('[data-cam="take"]').click();
  await page.locator('[data-cam="use"]').click({ timeout: 20000 });
  await page.waitForTimeout(300);
}
await page.locator('[data-result="scan/continue"]').waitFor({ timeout: 60000 });
await act(page.locator('[data-result="scan/continue"]'), "scan/continue");
await act(page.locator("[data-personal]"), "plan/personalized");
await page.locator('input[name="duration"][value="30"]').check({ force: true });
await page.locator('input[name="intensity"][value="light"]').check({ force: true });
await page.locator('input[name="goal"][value="pilates"]').check({ force: true });
await act(page.locator('#rj-setup button[type="submit"]'), "plan/request");
await page.locator("[data-accept]").waitFor();
await act(page.locator("[data-accept]"), "plan/accept");
await page.locator('.rp[data-mode="ready"]').waitFor();
await page.waitForFunction(() => window.__anatomyReady > 0, null, { timeout: 180000 });
await page.waitForFunction(() => window.__anatomy.some((m) => m.type === "sedens-anatomy-state" && m.op === "show"), null, { timeout: 120000 });
await page.waitForTimeout(4000);

// ---- helpers ----
const snap = async () => {
  const f = frame();
  const probeNow = await f.evaluate(() => ({ ...window.__probe }));
  const topNow = await page.evaluate(() => ({ ...window.__top }));
  return { t: Date.now(), probe: probeNow, top: topNow, requests: anatomyRequests };
};
const diff = (a, b) => {
  const seconds = (b.t - a.t) / 1000;
  const drawn = b.probe.drawn - a.probe.drawn;
  return {
    seconds: +seconds.toFixed(2),
    drawn, ticks: b.probe.frames - a.probe.frames,
    drawnPerSecond: +(drawn / seconds).toFixed(3),
    longTasksPage: b.top.long - a.top.long, longTaskMsPage: Math.round(b.top.longMs - a.top.longMs),
    longTasksFrame: b.probe.long - a.probe.long, longTaskMsFrame: Math.round(b.probe.longMs - a.probe.longMs),
    assetRequests: b.requests - a.requests,
  };
};
const windowOf = async (ms) => {
  const a = await snap();
  await page.waitForTimeout(ms);
  return diff(a, await snap());
};
const shows = () => page.evaluate(() => window.__anatomy.filter((m) => m.type === "sedens-anatomy-state" && m.op === "show").length);
const result = { base, dpr: DPR, idleMs: IDLE_MS, hiddenMs: HIDDEN_MS, windows: {}, changes: [] };

// 1. idle, plan screen shown
{
  const before = await shows();
  result.windows.idleReady = await windowOf(IDLE_MS);
  result.windows.idleReady.showsDuringWindow = (await shows()) - before;
}

// the steps' structures, from the workout the server built
const steps = (await journey()).workout.steps.map((s) => (s.content.anatomy?.structures || []).map((x) => x.key));

// 2. idle, workout running
await act(page.locator('.rp-controls [data-act="start"]'), "workout/start");
await page.locator("[data-count]").filter({ hasText: /Exercise 1 of/ }).waitFor();
await page.waitForTimeout(5000);
{
  const before = await shows();
  result.windows.idleRunning = await windowOf(IDLE_MS);
  result.windows.idleRunning.showsDuringWindow = (await shows()) - before;
}

// 3. room changes: a "show" op to alternating structure sets
const sets = [steps[0], steps[1], steps[2], steps[3]].filter((s) => s && s.length);
const sendShow = (keys, mode = "highlight") => page.evaluate(([structures, m]) => {
  const frameEl = document.querySelector("iframe.rp-anatomy-frame");
  window.__seq = (window.__seq || 9000) + 1;
  frameEl.contentWindow.postMessage({ type: "sedens-anatomy", seq: window.__seq, op: "show", structures, focus: structures.slice(0, 1), mode: m, layer: "" }, location.origin);
  return window.__seq;
}, [keys, mode]);
async function change(keys, mode) {
  const a = await snap();
  const seq = await sendShow(keys, mode);
  await page.waitForFunction((s) => window.__anatomy.some((m) => m.type === "sedens-anatomy-state" && m.seq === s), seq, { timeout: 60000 });
  const replied = Date.now() - a.t;
  const reply = await page.evaluate((s) => window.__anatomy.find((m) => m.type === "sedens-anatomy-state" && m.seq === s), seq);
  await page.waitForTimeout(Math.max(0, CHANGE_WINDOW_MS - replied));
  return { ...diff(a, await snap()), repliedAfterMs: replied, skipped: !!reply.skipped, missing: reply.missing };
}
for (let n = 0; n < CHANGES; n += 1) result.changes.push(await change(sets[(n + 1) % sets.length], "highlight"));
result.windows.repeatedShow = await change(sets[(CHANGES) % sets.length], "highlight"); // identical to the one just applied
result.windows.isolateShow = await change(sets[0].slice(0, 1), "isolate");

// 4. a real step change (Done)
{
  const a = await snap();
  await act(page.locator('.rp-controls-main [data-act="done"]'), "workout/step");
  await page.locator("[data-count]").filter({ hasText: /Exercise 2 of/ }).waitFor();
  await page.waitForTimeout(CHANGE_WINDOW_MS);
  result.windows.stepChange = diff(a, await snap());
}

// 5. hidden page (simulated)
await page.waitForTimeout(2000);
await frame().evaluate(() => window.__setVisibility("hidden"));
result.windows.hidden = await windowOf(HIDDEN_MS);
await frame().evaluate(() => window.__setVisibility("visible"));
await page.waitForTimeout(1500);
result.windows.afterReturn = await windowOf(3000);

// 6. quality level (from the viewer's own export) and the pixel ratio it ended with
result.quality = await frame().evaluate(async () => {
  const atlas = await import("/src/main.js");
  return { ...(atlas.qualityLevel?.() || {}), devicePixelRatio: window.devicePixelRatio, canvas: [document.querySelector("canvas")?.width, document.querySelector("canvas")?.height] };
});

// 7. the build's own counter, when it has one (room=1&perf=1), against the wrapper
{
  const second = await ctx.newPage();
  await second.goto(base + "/anatomy.html?room=1&embed=1&perf=1");
  await second.waitForFunction(() => window.__probe && window.__probe.drawn > 0, null, { timeout: 120000 }).catch(() => {});
  await second.waitForTimeout(4000);
  const a = await second.evaluate(() => ({ probe: { ...window.__probe }, counter: window.__sedensAnatomyPerf ? { ...window.__sedensAnatomyPerf } : null }));
  await second.waitForTimeout(8000);
  const b = await second.evaluate(() => ({ probe: { ...window.__probe }, counter: window.__sedensAnatomyPerf ? { ...window.__sedensAnatomyPerf } : null }));
  result.counterCheck = b.counter && a.counter
    ? { counterDrawn: b.counter.drawn - a.counter.drawn, wrapperDrawn: b.probe.drawn - a.probe.drawn, counterFrames: b.counter.frames - a.counter.frames, wrapperTicks: b.probe.frames - a.probe.frames, seconds: 8 }
    : { counter: "not exposed by this build" };
  await second.close();
}

// 8. the professional viewer (no room=1): its heartbeat and its behaviour while hidden must be what they were
{
  const pro = await ctx.newPage();
  await pro.goto(base + "/anatomy.html?platform=1&embed=1");
  await pro.waitForFunction(() => window.__probe && window.__probe.drawn > 0, null, { timeout: 120000 });
  await pro.waitForTimeout(8000);
  const read = () => pro.evaluate(() => ({ t: Date.now(), probe: { ...window.__probe }, top: { long: 0, longMs: 0 }, requests: 0 }));
  const a = await read();
  await pro.waitForTimeout(Math.min(IDLE_MS, 10000));
  const b = await read();
  result.windows.professionalIdle = diff(a, b);
  await pro.evaluate(() => window.__setVisibility("hidden"));
  const c = await read();
  await pro.waitForTimeout(Math.min(HIDDEN_MS, 5000));
  const d = await read();
  result.windows.professionalHidden = diff(c, d);
  result.professionalQuality = await pro.evaluate(async () => {
    const atlas = await import("/src/main.js");
    return { ...(atlas.qualityLevel?.() || {}), perfCounter: typeof window.__sedensAnatomyPerf };
  });
  await pro.close();
}

const text = JSON.stringify(result, null, 2);
if (process.env.SEDENS_PERF_OUT) writeFileSync(process.env.SEDENS_PERF_OUT, text);
console.log(text);
await browser.close();
