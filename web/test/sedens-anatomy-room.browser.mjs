/** The room's expanded anatomy view in a real browser: two labelled modes with a pressed state, a status line
 * naming what is highlighted or isolated, picking a structure (from the list and by tapping the model), turning
 * the model, skeleton only, whole body, and back to the workout. English and Korean.
 *
 * Start the server with SEDENS_MODE=demo_free (the demonstration scan). The camera is Chromium's fake device.
 * Usage: MOTION_BASE_URL=http://127.0.0.1:8145 CHROMIUM=/path/to/chrome [SEDENS_SHOTS=/path/to/folder] \
 *   node test/sedens-anatomy-room.browser.mjs
 * (Software WebGL: each frame takes a few hundred ms, so the waits are generous.)
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { chromium } from "playwright";

const base = process.env.MOTION_BASE_URL || "http://127.0.0.1:8145";
const shots = process.env.SEDENS_SHOTS || "";
const browser = await chromium.launch({
  ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}),
  args: ["--no-sandbox", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
});
const errors = [];

async function toPlayer(lang, { start = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: lang === "ko" ? "ko-KR" : "en-US", permissions: ["camera"] });
  const key = randomBytes(16).toString("hex");
  await ctx.addInitScript(([k, l]) => {
    sessionStorage.setItem("motion-demo-key", k);
    localStorage.setItem("sedens-lang", l);
    window.__anatomy = [];
    window.addEventListener("message", (event) => {
      if (String(event.data?.type || "").startsWith("sedens-anatomy")) window.__anatomy.push(event.data);
    });
  }, [key, lang]);
  const page = await ctx.newPage();
  page.on("pageerror", (error) => errors.push(String(error)));
  const journey = async () => page.evaluate(async () => (await (await fetch("/sedens/room/journey")).json()).journey);
  const act = async (locator, path) => {
    const answered = page.waitForResponse((r) => r.url().includes(`/sedens/room/journey/${path}`));
    await locator.click();
    await answered;
  };
  await page.goto(base + "/room.html");
  await page.locator("#demo-room").click();
  await page.getByRole("button", { name: /DEMO-1001/ }).click({ timeout: 180000 });
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
  await page.waitForFunction(() => window.__anatomy.some((m) => m.type === "sedens-anatomy-ready"), null, { timeout: 180000 });
  if (!start) return { ctx, page };
  await act(page.locator('.rp-controls [data-act="start"]'), "workout/start");
  await page.locator('.rp[data-mode="exercise"]').waitFor();
  return { ctx, page };
}

const shot = async (page, name) => { if (shots) await page.screenshot({ path: `${shots}/anatomy-${name}.png` }); };
const frameOf = (page) => page.frames().find((f) => /\/anatomy\.html/.test(f.url()));
const lastState = (page) => page.evaluate(() => window.__anatomy.filter((m) => m.type === "sedens-anatomy-state").at(-1) || null);
const settle = (page, ms = 2500) => page.waitForTimeout(ms);
const text = async (page, sel) => (await page.locator(sel).first().textContent()).trim();
const pressed = (page, sel) => page.locator(sel).first().getAttribute("aria-pressed");

// ---- Plan screen (before Start): closing Explore restores the first exercise ----
{
  const { ctx, page } = await toPlayer("en", { start: false });
  await page.waitForFunction(() => /^Highlighted in the body: .+/.test(document.querySelector("[data-anatomy-selection]")?.textContent || ""), null, { timeout: 60000 });
  const before = await text(page, "[data-anatomy-selection]");
  await page.locator("[data-anatomy-expand]").click();
  await page.locator("[data-anatomy-tools]:not([hidden])").waitFor();
  await page.locator("[data-skeleton]").click();
  assert.equal(await text(page, "[data-anatomy-selection]"), "Showing the skeleton only.");
  await page.locator("[data-anatomy-return]").click();
  assert.equal(await page.locator(".rp").getAttribute("data-mode"), "ready", "still on the plan screen");
  assert.equal(await text(page, "[data-anatomy-selection]"), before, "the side panel names the first exercise again");
  await page.waitForFunction(() => {
    const last = window.__anatomy.filter((m) => m.type === "sedens-anatomy-state").at(-1);
    return last && last.op === "show";
  }, null, { timeout: 60000 });
  await ctx.close();
}

// ---- English ----
{
  const { ctx, page } = await toPlayer("en");
  await page.waitForTimeout(3000);
  // compact panel: the status line already names what is highlighted for this exercise
  await page.waitForFunction(() => /^Highlighted in the body: .+/.test(document.querySelector("[data-anatomy-selection]")?.textContent || ""), null, { timeout: 60000 });
  await shot(page, "01-panel-compact");

  await page.locator("[data-anatomy-expand]").click();
  await page.locator("[data-anatomy-tools]:not([hidden])").waitFor();
  assert.equal(await page.locator(".rp").getAttribute("data-mode"), "paused", "the workout pauses while anatomy is open");
  assert.equal(await pressed(page, '[data-mode="highlight"]'), "true");
  assert.equal(await pressed(page, '[data-mode="isolate"]'), "false");
  assert.match(await text(page, "[data-anatomy-selection]"), /^Highlighted in the body: .+/);
  assert.equal(await text(page, '[data-mode="highlight"]'), "✓ Highlight in the body".replace("✓ ", ""), "label text");
  assert.equal(await text(page, '[data-mode="isolate"]'), "Show only this");
  assert.equal(await text(page, "[data-anatomy-return]"), "Back to the workout");
  const picks = await page.locator("[data-pick]").count();
  assert.ok(picks >= 2, `the exercise's structures are offered (${picks})`);
  await settle(page, 4000);
  await shot(page, "02-highlight");

  // Show only this: the viewer isolates
  await page.locator('[data-mode="isolate"]').click();
  assert.equal(await pressed(page, '[data-mode="isolate"]'), "true");
  assert.equal(await pressed(page, '[data-mode="highlight"]'), "false");
  assert.match(await text(page, "[data-anatomy-selection]"), /^Showing only: .+/);
  await page.waitForFunction(() => window.__anatomy.filter((m) => m.type === "sedens-anatomy-state").at(-1)?.isolated?.length > 0, null, { timeout: 60000 });
  await settle(page, 4000);
  await shot(page, "03-isolate");

  // select another structure from the list: the mode stays
  const second = page.locator("[data-pick]").nth(1);
  const secondName = await second.textContent();
  await second.click();
  assert.equal(await second.getAttribute("aria-pressed"), "true");
  assert.equal(await pressed(page, '[data-mode="isolate"]'), "true");
  assert.ok((await text(page, "[data-anatomy-selection]")).includes(secondName.trim()), "the status names the second structure");
  await settle(page);
  assert.deepEqual((await lastState(page)).missing, [], "every structure offered in the list is drawn by the atlas");
  await shot(page, "04-isolate-another");

  // back to Highlight: the whole body returns, the structure stays selected
  await page.locator('[data-mode="highlight"]').click();
  await page.waitForFunction(() => window.__anatomy.filter((m) => m.type === "sedens-anatomy-state").at(-1)?.isolated?.length === 0, null, { timeout: 60000 });
  assert.match(await text(page, "[data-anatomy-selection]"), /^Highlighted in the body: /);
  assert.ok((await text(page, "[data-anatomy-selection]")).includes(secondName.trim()));
  await settle(page, 3000);

  // tap a muscle on the model
  const box = await page.locator("iframe.rp-anatomy-frame").boundingBox();
  let tapped = null;
  for (const [fx, fy] of [[0.5, 0.42], [0.5, 0.5], [0.46, 0.38], [0.54, 0.46], [0.5, 0.3], [0.5, 0.6], [0.44, 0.52], [0.56, 0.4]]) {
    const before = await page.evaluate(() => window.__anatomy.filter((m) => m.type === "sedens-anatomy-selection").length);
    await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
    try {
      await page.waitForFunction((n) => window.__anatomy.filter((m) => m.type === "sedens-anatomy-selection").length > n, before, { timeout: 5000 });
      tapped = await page.evaluate(() => window.__anatomy.filter((m) => m.type === "sedens-anatomy-selection").at(-1));
      break;
    } catch { /* nothing under that point */ }
  }
  assert.ok(tapped, "tapping the model selects a structure");
  assert.ok((await text(page, "[data-anatomy-selection]")).includes(tapped.name), `the status names the tapped structure (${tapped.name})`);
  await settle(page, 3000);
  await shot(page, "05-tapped");

  // turn the model
  const camera = () => frameOf(page).evaluate(async () => (await import("/src/main.js")).cameraState());
  const c0 = await camera();
  await page.locator('[data-turn="45"]').click();
  await page.waitForTimeout(3500);
  const c1 = await camera();
  assert.notDeepEqual(c0.p, c1.p, "turn right moves the camera round the body");
  const radius = (c) => Math.hypot(c.p[0] - c.t[0], c.p[2] - c.t[2]);
  assert.ok(Math.abs(radius(c0) - radius(c1)) / radius(c0) < 0.02, "the distance is kept");
  await page.locator('[data-turn="-45"]').click();
  await page.waitForTimeout(3500);
  const c2 = await camera();
  assert.ok(Math.hypot(c2.p[0] - c0.p[0], c2.p[2] - c0.p[2]) < 0.05, "turn left undoes turn right");
  await shot(page, "06-turned");

  // skeleton only, and back
  await page.locator("[data-skeleton]").click();
  assert.equal(await pressed(page, "[data-skeleton]"), "true");
  assert.equal(await text(page, "[data-anatomy-selection]"), "Showing the skeleton only.");
  await settle(page, 4000);
  await shot(page, "07-skeleton");
  await page.locator("[data-skeleton]").click();
  assert.equal(await pressed(page, "[data-skeleton]"), "false");
  assert.match(await text(page, "[data-anatomy-selection]"), /^Highlighted in the body: /);

  // whole body
  await page.locator("[data-whole]").click();
  assert.match(await text(page, "[data-anatomy-selection]"), /^Showing the whole body/);
  assert.equal(await page.locator('[data-pick][aria-pressed="true"]').count(), 0);
  await settle(page, 3000);
  await shot(page, "08-whole");

  // keyboard: the mode buttons are real buttons in the tab order, and Enter/Space work
  await page.locator('[data-mode="isolate"]').focus();
  await page.keyboard.press("Enter");
  assert.equal(await pressed(page, '[data-mode="isolate"]'), "true", "Enter on the mode button");
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-mode")), null, "focus moved on");

  // a phone-sized screen: nothing overflows sideways and the buttons stay reachable
  await page.setViewportSize({ width: 390, height: 844 });
  await settle(page, 2500);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "no sideways scroll on a phone");
  await shot(page, "11-phone");
  await page.setViewportSize({ width: 1366, height: 900 });
  await settle(page, 1500);

  // back to the workout
  await page.locator("[data-anatomy-return]").click();
  await page.locator("[data-anatomy-tools][hidden]").waitFor({ state: "attached" });
  await page.waitForFunction(() => document.querySelector(".rp")?.dataset.mode === "exercise", null, { timeout: 30000 });
  await page.waitForFunction(() => /^Highlighted in the body: /.test(document.querySelector("[data-anatomy-selection]")?.textContent || ""), null, { timeout: 30000 });
  await settle(page, 2500);
  await shot(page, "09-back-to-workout");
  // reopening starts from the exercise again, in the exercise's own mode
  await page.locator("[data-anatomy-expand]").click();
  assert.equal(await pressed(page, '[data-mode="highlight"]'), "true");
  await page.locator("[data-anatomy-return]").click();
  await ctx.close();
}

// ---- Korean ----
{
  const { ctx, page } = await toPlayer("ko");
  await page.waitForTimeout(3000);
  await page.locator("[data-anatomy-expand]").click();
  await page.locator("[data-anatomy-tools]:not([hidden])").waitFor();
  assert.equal(await text(page, '[data-mode="highlight"]'), "몸 안에서 강조");
  assert.equal(await text(page, '[data-mode="isolate"]'), "이것만 보기");
  assert.equal(await text(page, "[data-anatomy-return]"), "운동으로 돌아가기");
  assert.match(await text(page, "[data-anatomy-selection]"), /^몸 안에서 강조하고 있어요: .+/);
  await page.waitForFunction(() => [...document.querySelectorAll("[data-pick]")].some((b) => /[가-힣]/.test(b.textContent)), null, { timeout: 60000 });
  await page.locator('[data-mode="isolate"]').click();
  assert.match(await text(page, "[data-anatomy-selection]"), /^이것만 보고 있어요: .+/);
  await settle(page, 4000);
  await shot(page, "10-isolate-ko");
  await ctx.close();
}

assert.deepEqual(errors, []);
console.log("sedens-anatomy-room: ok");
await browser.close();
