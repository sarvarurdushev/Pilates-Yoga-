/** Room screen timings for docs/SEDENS_FREE_DEPLOYMENT.md (brief §48). It measures; it asserts nothing.
 *
 * first page load, demonstration entry, demonstration scan start, the player and its anatomy viewer,
 * the first exercise, and the move to the next exercise, with the bytes transferred for each part.
 * Usage: MOTION_BASE_URL=http://127.0.0.1:8145 CHROMIUM=/path/to/chrome node test/sedens-room-performance.browser.mjs
 * (start the server with SEDENS_MODE=demo_free for the demonstration scan).
 */
import { randomBytes } from "node:crypto";
import { chromium } from "playwright";

const base = process.env.MOTION_BASE_URL || "http://127.0.0.1:8145";
const browser = await chromium.launch({
  ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}),
  args: ["--no-sandbox", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
});
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, permissions: ["camera"] });
await ctx.addInitScript((k) => {
  sessionStorage.setItem("motion-demo-key", k);
  localStorage.setItem("sedens-lang", "en");
  window.__anatomyReady = 0;
  window.__anatomy = [];
  window.addEventListener("message", (e) => {
    if (e.data?.type === "sedens-anatomy-ready") window.__anatomyReady = performance.now();
    if (String(e.data?.type || "").startsWith("sedens-anatomy")) window.__anatomy.push(e.data);
  });
}, randomBytes(16).toString("hex"));
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send("Network.enable");
let bytes = 0;
let requests = 0;
cdp.on("Network.loadingFinished", (e) => { bytes += e.encodedDataLength; requests += 1; });
const rows = [];
async function measure(name, run) {
  const [b0, r0, t0] = [bytes, requests, Date.now()];
  await run();
  await page.waitForTimeout(300);
  rows.push({ step: name, ms: Date.now() - t0 - 300, kB: Math.round((bytes - b0) / 1024), requests: requests - r0 });
}
const journey = async () => page.evaluate(async () => (await (await fetch("/sedens/room/journey")).json()).journey.state);
const act = async (locator, path) => {
  const answered = page.waitForResponse((r) => r.url().includes(`/sedens/room/journey/${path}`));
  await locator.click();
  await answered;
};

await measure("first page load (room screen ready)", async () => {
  await page.goto(base + "/room.html");
  await page.locator("#demo-room").waitFor();
});
await measure("demonstration entry (new visitor: seeds the demo facility)", async () => {
  await page.locator("#demo-room").click();
  await page.getByRole("button", { name: /DEMO-1001/ }).waitFor({ timeout: 180000 });
});
await measure("identify the customer (welcome shown)", async () => {
  await page.getByRole("button", { name: /DEMO-1001/ }).click();
  await page.locator('[data-act="readiness/start"]').waitFor();
});
await act(page.locator('[data-act="readiness/start"]'), "readiness/start");
while ((await journey()) === "readiness") await act(page.locator('[data-answer="no"]'), "readiness/answer");
await page.locator('[data-consent="scan_capture"]').click();
await page.locator('[data-consent="scan_capture"][aria-checked="true"]').waitFor();
await measure("demonstration scan start (camera preview live)", async () => {
  await page.locator('[data-start="demo_precomputed"]').click();
  await page.locator('[data-cam="take"]').waitFor();
  await page.waitForFunction(() => document.querySelector("video")?.readyState >= 2);
});
for (let n = 0; n < 4; n += 1) {
  await page.locator('[data-cam="take"]').click();
  await page.locator('[data-cam="use"]').click({ timeout: 20000 });
  await page.waitForTimeout(300);
}
await measure("demonstration result shown after the fourth photo", async () => {
  await page.locator('[data-result="scan/continue"]').waitFor({ timeout: 60000 });
});
await act(page.locator('[data-result="scan/continue"]'), "scan/continue");
await act(page.locator("[data-personal]"), "plan/personalized");
await page.locator('input[name="duration"][value="30"]').check({ force: true });
await page.locator('input[name="intensity"][value="light"]').check({ force: true });
await page.locator('input[name="goal"][value="pilates"]').check({ force: true });
await measure("plan built (recommendation shown)", async () => {
  await act(page.locator('#rj-setup button[type="submit"]'), "plan/request");
  await page.locator("[data-accept]").waitFor();
});
const accepted = Date.now();
await measure("player shown (ready screen)", async () => {
  await act(page.locator("[data-accept]"), "plan/accept");
  await page.locator('.rp[data-mode="ready"]').waitFor();
});
await measure("anatomy viewer ready (from accepting the plan)", async () => {
  await page.waitForFunction(() => window.__anatomyReady > 0, null, { timeout: 180000 });
});
rows[rows.length - 1].ms = Date.now() - accepted;
// The viewer then loads the first exercise's structures while the customer reads the plan.
await measure("first exercise's anatomy loaded (while the plan is read)", async () => {
  await page.waitForFunction(() => window.__anatomy?.some?.((m) => m.type === "sedens-anatomy-state" && m.op === "show"), null, { timeout: 60000 })
    .catch(() => page.waitForTimeout(6000));
});
await measure("first exercise shown (Start session)", async () => {
  await act(page.locator('.rp-controls [data-act="start"]'), "workout/start");
  await page.locator("[data-count]").filter({ hasText: /Exercise 1 of/ }).waitFor();
});
await measure("next exercise shown (Done — next exercise)", async () => {
  await act(page.locator('.rp-controls-main [data-act="done"]'), "workout/step");
  await page.locator("[data-count]").filter({ hasText: /Exercise 2 of/ }).waitFor();
});
console.table(rows);
console.log(JSON.stringify(rows));
await browser.close();
