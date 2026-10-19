/** Phase 3 investor journey in a real browser: the AI Private Room from entry to the Passport.
 *
 * A. a personalized SEDENS session (readiness, consent, four-view demonstration scan,
 *    plan, "Why this session", player with anatomy, automatic next, skip, feedback);
 * B. the coach's included course; C. the professor's course after a simulated purchase;
 * D. the access checks; then the Korean room and a phone-sized room.
 *
 * The scan step needs the free demonstration host's scan options, so start the server with
 * SEDENS_MODE=demo_free. The camera is Chromium's fake device.
 * Usage: MOTION_BASE_URL=http://127.0.0.1:8145 CHROMIUM=/path/to/chrome \
 *   [SEDENS_SHOTS=/path/to/folder] node test/sedens-room-journey.browser.mjs
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { chromium } from "playwright";

const base = process.env.MOTION_BASE_URL || "http://127.0.0.1:8145";
const shots = process.env.SEDENS_SHOTS || "";
const browser = await chromium.launch({
  ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}),
  args: ["--no-sandbox", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
    "--autoplay-policy=no-user-gesture-required"],
});
const errors = [];
const key = randomBytes(16).toString("hex");
const TV = { width: 1366, height: 900 };
const PHONE = { width: 390, height: 844 };

async function open({ viewport = TV, lang = "en", demoKey = key, name = "room" } = {}) {
  const ctx = await browser.newContext({ viewport, locale: lang === "ko" ? "ko-KR" : "en-US", permissions: ["camera"] });
  await ctx.addInitScript(([k, l]) => {
    sessionStorage.setItem("motion-demo-key", k);
    localStorage.setItem("sedens-lang", l);
    // The player's anatomy frame reports what it shows; keep the messages for the checks below.
    window.__anatomy = [];
    window.addEventListener("message", (event) => {
      if (String(event.data?.type || "").startsWith("sedens-anatomy")) window.__anatomy.push(event.data);
    });
  }, [demoKey, lang]);
  const page = await ctx.newPage();
  page.on("pageerror", (error) => errors.push(`${name}: ${error.message}`));
  page.on("dialog", (dialog) => dialog.accept());
  return { ctx, page };
}
const shot = async (page, file, fullPage = true) => shots && page.screenshot({ path: `${shots}/${file}.png`, fullPage });
const owner = (page) => page.locator("#rj-main").getAttribute("data-owner");
const text = (page) => page.locator("#rj-main").innerText();
const journeyView = (page) => page.evaluate(async () => (await (await fetch("/sedens/room/journey")).json()).journey);
const journeyState = async (page) => (await journeyView(page)).state;
/** Click and wait for the room's answer to that action. */
async function act(page, locator, path) {
  const answered = page.waitForResponse((r) => r.url().includes(`/sedens/room/journey/${path}`) && r.request().method() === "POST");
  await locator.click();
  const response = await answered;
  assert.ok(response.ok(), `${path}: ${response.status()} ${await response.text()}`);
  // The screen redraws right after the answer (the anatomy viewer may still be streaming
  // its models, so the network is not necessarily idle).
  await page.waitForTimeout(250);
}
/** POST a room action straight from the page, as a forged client would. */
const raw = (page, path, body) => page.evaluate(async ([p, b]) => {
  const response = await fetch(`/sedens/room/journey/${p}`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-Sedens-Request": "1" }, body: JSON.stringify(b),
  });
  let code = "";
  try { code = (await response.json()).code || ""; } catch { /* no body */ }
  return { status: response.status, code };
}, [path, body]);
const post = (page, path, body) => page.evaluate(async ([p, b]) => {
  const response = await fetch(`/sedens/${p}`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-Sedens-Request": "1" }, body: JSON.stringify(b),
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}, [path, body]);
const noOverflow = async (page, where) => {
  const [scroll, client] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  assert.ok(scroll <= client, `${where}: the page is ${scroll}px wide on a ${client}px screen`);
};

async function enterRoom(page, customer = /DEMO-1001/) {
  await page.goto(base + "/room.html");
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.locator("#demo-room").click();
    const which = await Promise.race([
      page.getByRole("button", { name: customer }).waitFor({ timeout: 180000 }).then(() => "in"),
      page.getByText(/Too many attempts|시도가 너무 많습니다/).waitFor({ timeout: 180000 }).then(() => "wait"),
    ]);
    if (which === "in") break;
    await page.waitForTimeout(61000); // the server allows ten demonstration entries a minute
  }
  await identify(page, customer);
}
async function identify(page, customer = /DEMO-1001/) {
  await page.getByRole("button", { name: customer }).click();
  await page.locator('[data-act="readiness/start"]').waitFor();
}
async function readiness(page) {
  await act(page, page.locator('[data-act="readiness/start"]'), "readiness/start");
  for (let n = 0; n < 10 && (await journeyState(page)) === "readiness"; n += 1)
    await act(page, page.locator('[data-answer="no"]'), "readiness/answer");
  assert.equal(await journeyState(page), "scan_intro");
}
/** Turn camera consent on (only if it is off: a customer's consent carries over between visits). */
async function agreeToCapture(page) {
  const capture = page.locator('[data-consent="scan_capture"]');
  await capture.waitFor();
  if ((await capture.getAttribute("aria-checked")) !== "true") {
    const saved = page.waitForResponse((r) => r.url().includes("/sedens/room/consent") && r.request().method() === "POST");
    await capture.click();
    await saved;
  }
  await page.locator('[data-consent="scan_capture"][aria-checked="true"]').waitFor();
}
async function skipScan(page) {
  await act(page, page.locator("[data-skip]"), "scan/skip");
  assert.equal(await journeyState(page), "session_choice");
}
async function finishWorkout(page) {
  for (let n = 0; n < 40 && (await owner(page)) === "player"; n += 1) {
    const done = page.locator(".rp-controls-main [data-act=done]");
    await act(page, done, "workout/step");
  }
  assert.equal(await journeyState(page), "session_complete");
}
async function anatomyShown(page, predicate, what) {
  await page.waitForFunction(predicate, null, { timeout: 120000 }).catch(async () => {
    throw new Error(`${what}: ${JSON.stringify((await page.evaluate(() => window.__anatomy)).slice(-4))}`);
  });
}
const passportVisits = async (page) => Number(((await text(page)).match(/(\d+) visits/) || [])[1] || 0);

// ======================================================================================
// A. A personalized SEDENS session
// ======================================================================================
const room = await open();
const { page } = room;
await enterRoom(page);
assert.match(await text(page), /Hello, Sarah/);
assert.match(await page.locator("body").innerText(), /SIMULATED/);
const visitsBefore = await passportVisits(page);
await shot(page, "p3-01-welcome");

await act(page, page.locator('[data-act="readiness/start"]'), "readiness/start");
assert.match(await text(page), /Question 1 of 10/i);
assert.match(await text(page), /not a medical check/);
await shot(page, "p3-02-readiness");
while ((await journeyState(page)) === "readiness") await act(page, page.locator('[data-answer="no"]'), "readiness/answer");
await page.locator('#rj-main[data-owner="scan"]').waitFor();

// Camera consent, then the four-view demonstration scan.
await shot(page, "p3-03-scan-intro");
const startScan = page.locator('[data-start="demo_precomputed"]');
assert.ok(await startScan.count(), "the free demonstration host offers the demonstration scan (run the server with SEDENS_MODE=demo_free)");
await agreeToCapture(page);
await act(page, startScan, "scan/begin");
for (let view = 0; view < 4; view += 1) {
  await page.locator('[data-cam="take"]').click();
  if (view === 0) await shot(page, "p3-04-scan-guidance");
  await page.locator('[data-cam="use"]').click({ timeout: 20000 });
  await page.waitForTimeout(400);
}
await page.locator('[data-result="scan/continue"]').waitFor({ timeout: 60000 });
const result = await text(page);
assert.match(result, /demo precomputed analysis/i, "the demonstration result is labelled");
assert.match(result, /Shoulder line/);
assert.match(result, /It is not a score/);
assert.doesNotMatch(result, /posture score|\b\d{1,3}\s*\/\s*100\b|\b\d{1,3}\s*%/i, "no overall score or percentage");
await shot(page, "p3-05-scan-result");
await page.screenshot({ path: shots ? `${shots}/p3-05b-scan-result-viewport.png` : "/dev/null" });
await act(page, page.locator('[data-result="scan/continue"]'), "scan/continue");

// Choice, setup (30 min, Moderate, a supported goal), the plan and why.
assert.match(await text(page), /SEDENS Personalized Session/);
await shot(page, "p3-06-choice");
await act(page, page.locator("[data-personal]"), "plan/personalized");
await page.locator('input[name="duration"][value="30"]').check({ force: true });
await page.locator('input[name="intensity"][value="moderate"]').check({ force: true });
await page.locator('input[name="goal"][value="general"]').check({ force: true });
await shot(page, "p3-07-setup");
await act(page, page.locator('#rj-setup button[type="submit"]'), "plan/request");
assert.equal(await journeyState(page), "recommendation");
assert.match(await text(page), /SEDENS Standard/);
await shot(page, "p3-08-recommendation");
await page.locator("[data-why]").click();
const reasons = page.locator("dialog[open] .rj-reasons li");
await reasons.first().waitFor();
assert.ok((await reasons.count()) >= 2, "Why this session gives its reasons");
await shot(page, "p3-09-why", false);
await page.locator("[data-why-close]").click();
await act(page, page.locator("[data-accept]"), "plan/accept");

// The player.
await page.locator('.rp[data-mode="ready"]').waitFor();
await shot(page, "p3-10-player-ready");
await act(page, page.locator('.rp-controls [data-act="start"]'), "workout/start");
await page.locator('.rp[data-mode="exercise"]').waitFor();
assert.match(await page.locator("[data-count]").innerText(), /Exercise 1 of \d+/);
assert.ok(await page.locator(".rp-media video, .rp-media .rp-figure, .rp-media .rp-card").first().isVisible(), "video or instructions");
assert.match(await page.locator("[data-anatomy-label]").innerText(), /not measured muscle activation/);
await anatomyShown(page, () => window.__anatomy.some((m) => m.type === "sedens-anatomy-state" && m.op === "show" && m.selected != null),
  "the anatomy panel highlights the exercise's structures");
await shot(page, "p3-11-player");

// Anatomy: open, turn, tap a muscle to isolate it, return; the workout pauses and continues.
await page.locator('.rp-controls [data-act="anatomy"]').click();
await page.locator(".rp-anatomy.is-expanded").waitFor();
await page.locator('.rp[data-mode="paused"]').waitFor();
assert.ok(await page.locator('.rp-anatomy.is-expanded [data-act="unwell"]').isVisible(), "I don't feel well stays reachable in full-screen anatomy");
await page.locator('[data-view="lateral"]').click();
await anatomyShown(page, () => window.__anatomy.some((m) => m.type === "sedens-anatomy-state" && m.op === "view"), "the view turns");
await page.locator('[data-view="anterior"]').click();
await page.waitForTimeout(1500);
const frame = page.locator(".rp-anatomy-frame");
const box = await frame.boundingBox();
for (const [dx, dy] of [[0.5, 0.42], [0.5, 0.5], [0.48, 0.36], [0.53, 0.6], [0.47, 0.7]]) {
  await page.mouse.click(box.x + box.width * dx, box.y + box.height * dy);
  await page.waitForTimeout(800);
  if (await page.evaluate(() => window.__anatomy.some((m) => m.type === "sedens-anatomy-selection"))) break;
}
await anatomyShown(page, () => window.__anatomy.some((m) => m.type === "sedens-anatomy-selection"), "a tap selects a muscle");
await anatomyShown(page, () => window.__anatomy.some((m) => m.type === "sedens-anatomy-state" && m.isolated?.length),
  "the tapped muscle is isolated");
assert.match(await page.locator("[data-anatomy-cue]").innerText(), /^Showing /);
await shot(page, "p3-12-anatomy-expanded", false);
await page.locator("[data-anatomy-return]").click();
await page.locator('.rp[data-mode="exercise"]').waitFor();
assert.equal(await page.locator(".rp-anatomy.is-expanded").count(), 0);

// Automatic next: the work ends, a short "get ready" countdown, then exercise 2.
await page.locator('[data-overlay][data-kind="transition"]').waitFor({ timeout: 150000 });
await shot(page, "p3-13-transition");
await page.locator("[data-count]").filter({ hasText: /Exercise 2 of/ }).waitFor({ timeout: 30000 });
// Skip one, then finish the session.
await act(page, page.locator('.rp-controls-more [data-act="skip"]'), "workout/step");
await page.locator("[data-count]").filter({ hasText: /Exercise 3 of/ }).waitFor();
await finishWorkout(page);
const complete = await text(page);
assert.match(complete, /Session complete/i);
assert.match(complete, /Saved to your Fitness Passport/);
assert.match(complete, /completed/);
await shot(page, "p3-14-complete");
await page.locator('[data-effort="6"]').click();
await page.locator('[data-discomfort="no"]').click();
await act(page, page.locator("[data-submit]"), "workout/feedback");
assert.match(await text(page), /Another session/);
await shot(page, "p3-15-feedback-saved");
console.log("PASS A: readiness, consent, four-view demonstration scan with no score, 30 min Moderate plan, why, player, anatomy turn and isolate, automatic next, skip, completion, effort");

// ======================================================================================
// B. The coach's included course, on a new visit
// ======================================================================================
await page.locator("[data-end-visit]").click();
await page.locator("[data-end-confirm]").click();
await page.getByRole("button", { name: /DEMO-1001/ }).waitFor();
await identify(page);
assert.equal(await passportVisits(page), visitsBefore + 1, "the finished session is a new visit in the Passport");
await readiness(page);
await skipScan(page);
const views = (await journeyView(page)).choice.courses;
const core = views.find((c) => c.title === "4-Week Core Foundations");
assert.ok(core, "the coach's course is offered here");
const coreCard = page.locator("article", { has: page.getByRole("heading", { name: "4-Week Core Foundations" }) });
assert.match(await coreCard.innerText(), /Included with your membership/);
await act(page, coreCard.locator("[data-course]"), "course/start");
await page.locator('.rp[data-mode="ready"]').waitFor();
assert.match(await page.locator("[data-ready-label]").innerText(), /^Version \d+$/);
const coreVersion = (await journeyView(page)).workout.course_version;
assert.ok(Number.isInteger(coreVersion) && coreVersion >= 1);
await shot(page, "p3-16-course-ready");
await page.evaluate(() => { window.__anatomy = []; });
await act(page, page.locator('.rp-controls [data-act="start"]'), "workout/start");
await anatomyShown(page, () => window.__anatomy.some((m) => m.type === "sedens-anatomy-state" && m.op === "show" && m.selected != null),
  "the creator's anatomy mapping is shown");
assert.match(await page.locator(".rp-card").innerText(), /Set up:/, "the library's setup is shown with the creator's cue");
await shot(page, "p3-17-course-player");
await finishWorkout(page);
await page.locator("[data-effort-skip]").click();
await page.locator('[data-discomfort="no"]').click();
await act(page, page.locator("[data-submit]"), "workout/feedback");
await act(page, page.locator('[data-act="workout/another"]'), "workout/another");
const progress = ((await journeyView(page)).choice.courses)
  .find((c) => c.course_id === core.course_id);
assert.equal(progress.progress.done, 1, "completing the session updates the course progress");
console.log("PASS B: the coach's included course plays its enrolled version with its anatomy mapping, and completion updates progress");

// ======================================================================================
// D (part). A paid course without the entitlement cannot start
// ======================================================================================
const phone = await open({ viewport: PHONE, name: "phone" });
await phone.page.goto(base + "/");
await phone.page.locator('[data-demo="student"]').click();
await phone.page.waitForLoadState("networkidle");
const catalog = await phone.page.evaluate(async () => (await (await fetch("/sedens/courses/catalog")).json()));
const mobility = (catalog.courses || catalog.items || catalog).find((c) => c.title === "Mobility Foundations");
assert.ok(mobility, "the professor's course is in the catalog");
const mobilityId = mobility.id || mobility.course_id;
// Before the purchase the room does not offer it, and refuses it if asked directly.
assert.ok(!(await journeyView(page)).choice.courses.some((c) => c.course_id === mobilityId), "not offered before the purchase");
assert.equal(await page.locator("article", { has: page.getByRole("heading", { name: "Mobility Foundations" }) }).count(), 0);
let refused = await raw(page, "course/start", { expect: "session_choice", course_id: mobilityId });
assert.equal(refused.status, 403);
assert.equal(refused.code, "purchase_required");
// Outside the room, the customer's own phone cannot launch guided training either.
refused = await raw(phone.page, "course/start", { course_id: core.course_id });
assert.ok([401, 403].includes(refused.status), `phone outside the room: ${refused.status}`);

// ======================================================================================
// C. The professor's course after a simulated purchase on the phone
// ======================================================================================
await phone.page.goto(`${base}/#/courses/${mobilityId}`);
await phone.page.getByRole("button", { name: "Buy (demonstration)", exact: true }).click();
await phone.page.locator("#buy-confirm").click();
await phone.page.locator("#flash").filter({ hasText: "DEMO — no real payment occurred." }).waitFor();
await page.reload();
const mobilityCard = page.locator("article", { has: page.getByRole("heading", { name: "Mobility Foundations" }) });
await mobilityCard.waitFor();
await act(page, mobilityCard.locator("[data-course]"), "course/start");
await page.locator('.rp[data-mode="ready"]').waitFor();
const mobilityWorkout = (await journeyView(page)).workout;
assert.equal(mobilityWorkout.kind, "course");
assert.match(await page.locator("[data-ready-label]").innerText(), new RegExp(`^Version ${mobilityWorkout.course_version}$`));
await shot(page, "p3-18-professor-course");
await act(page, page.locator('.rp-controls [data-act="start"]'), "workout/start");
await finishWorkout(page);
await page.locator("[data-effort-skip]").click();
await page.locator('[data-discomfort="no"]').click();
await act(page, page.locator("[data-submit]"), "workout/feedback");
await act(page, page.locator('[data-act="workout/another"]'), "workout/another");
const mobilityProgress = ((await journeyView(page)).choice.courses)
  .find((c) => c.course_id === mobilityId);
assert.equal(mobilityProgress.progress.done, 1);
console.log("PASS C: the purchased professor's course is offered only after the purchase, plays its enrolled version, and completion updates progress");

// ======================================================================================
// D. Access checks
// ======================================================================================
const admin = await open({ name: "admin" });
await admin.page.goto(base + "/");
await admin.page.locator('[data-demo="admin"]').click();
await admin.page.waitForLoadState("networkidle");
let changed = await post(admin.page, "facility/courses/setting", { course_id: core.course_id, enabled: false, included: false, featured: false });
assert.equal(changed.status, 200);
refused = await raw(page, "course/start", { expect: "session_choice", course_id: core.course_id });
assert.equal(refused.status, 403, "a course the facility disabled cannot start");
changed = await post(admin.page, "facility/courses/setting", { course_id: core.course_id, enabled: true, included: true, featured: true });
assert.equal(changed.status, 200);

const reviewer = await open({ name: "reviewer" });
await reviewer.page.goto(base + "/");
await reviewer.page.locator('[data-demo="reviewer"]').click();
await reviewer.page.waitForLoadState("networkidle");
changed = await post(reviewer.page, "review/course/suspend", { course_id: core.course_id, reason: "Demonstration access check." });
assert.equal(changed.status, 200, JSON.stringify(changed.body));
refused = await raw(page, "course/start", { expect: "session_choice", course_id: core.course_id });
assert.ok([403, 404].includes(refused.status), `a suspended course cannot start: ${refused.status}`);
changed = await post(reviewer.page, "review/course/suspend", { course_id: core.course_id, suspend: false });
assert.equal(changed.status, 200);

// Another facility's room cannot start this facility's course.
const stranger = await open({ demoKey: randomBytes(16).toString("hex"), name: "stranger" });
await enterRoom(stranger.page);
await readiness(stranger.page);
await skipScan(stranger.page);
refused = await raw(stranger.page, "course/start", { expect: "session_choice", course_id: core.course_id });
assert.ok([403, 404].includes(refused.status), `another facility: ${refused.status}`);

// A closed room session cannot start anything.
await page.locator("[data-end-visit]").click();
await page.locator("[data-end-confirm]").click();
await page.getByRole("button", { name: /DEMO-1001/ }).waitFor();
refused = await raw(page, "course/start", { expect: "session_choice", course_id: core.course_id });
assert.ok([401, 403].includes(refused.status), `after the room session ended: ${refused.status}`);
console.log("PASS D: no launch from a phone, another facility, an ended room session, a disabled or suspended course, or without the purchase");

// ======================================================================================
// Korean room
// ======================================================================================
const korean = await open({ lang: "ko", name: "korean" });
const ko = korean.page;
await ko.goto(base + "/room.html");
await ko.locator("#demo-room").click();
await ko.getByRole("button", { name: /DEMO-1001/ }).click({ timeout: 180000 });
await ko.locator('[data-act="readiness/start"]').waitFor();
assert.match(await text(ko), /님/);
await shot(ko, "p3-ko-01-welcome");
await act(ko, ko.locator('[data-act="readiness/start"]'), "readiness/start");
assert.match(await text(ko), /10개 중 1번째 질문/);
await shot(ko, "p3-ko-02-readiness");
while ((await journeyState(ko)) === "readiness") await act(ko, ko.locator('[data-answer="no"]'), "readiness/answer");
await shot(ko, "p3-ko-03-scan-intro");
await skipScan(ko);
await shot(ko, "p3-ko-04-choice");
await act(ko, ko.locator("[data-personal]"), "plan/personalized");
await ko.locator('input[name="duration"][value="30"]').check({ force: true });
await ko.locator('input[name="intensity"][value="light"]').check({ force: true });
await ko.locator('input[name="goal"][value="mobility"]').check({ force: true });
await act(ko, ko.locator('#rj-setup button[type="submit"]'), "plan/request");
await shot(ko, "p3-ko-05-recommendation");
await act(ko, ko.locator("[data-accept]"), "plan/accept");
await ko.locator('.rp[data-mode="ready"]').waitFor();
const ENGLISH = /\b(Exercise|Pause|Skip|Anatomy|Session|Previous|Repeat|Explore|Start|Continue|Next|Finish|Done|Settings|Music|Warm-up|Cool-down)\b/;
assert.doesNotMatch(await ko.locator(".rp").innerText(), ENGLISH, "no English on the Korean ready screen");
await act(ko, ko.locator('.rp-controls [data-act="start"]'), "workout/start");
assert.match(await ko.locator("[data-count]").innerText(), /번째 운동/);
assert.doesNotMatch(await ko.locator(".rp").innerText(), ENGLISH, "no English on the Korean player");
assert.match(await ko.locator("[data-anatomy-label]").innerText(), /측정된 근육 활성도가 아닙니다/);
await shot(ko, "p3-ko-06-player");
await ko.locator('.rp-controls-more [data-act="unwell"]').click();
assert.match(await ko.locator("dialog[open]").innerText(), /119에 전화하거나 직원에게 알리세요/);
assert.doesNotMatch(await ko.locator("dialog[open]").innerText(), ENGLISH, "no English in the Korean unwell dialog");
await shot(ko, "p3-ko-07-unwell", false);
await ko.locator('[data-unwell="cancel"]').click();
await ko.locator('.rp-controls-more [data-act="end"]').click();
await act(ko, ko.locator('[data-end="yes"]'), "workout/end");
assert.equal(await journeyState(ko), "session_complete");
await shot(ko, "p3-ko-08-complete");
const koText = await ko.locator("body").innerText();
assert.doesNotMatch(koText, ENGLISH, "no English on the Korean completion screen");
console.log("PASS Korean: welcome, readiness, choice, plan, player, unwell dialog and completion in Korean");

// ======================================================================================
// Phone-sized room screen
// ======================================================================================
const small = await open({ viewport: PHONE, name: "phone-room" });
const sp = small.page;
await sp.goto(base + "/room.html");
await sp.locator("#demo-room").click();
await sp.getByRole("button", { name: /DEMO-1001/ }).click({ timeout: 180000 });
await sp.locator('[data-act="readiness/start"]').waitFor();
await noOverflow(sp, "welcome");
await act(sp, sp.locator('[data-act="readiness/start"]'), "readiness/start");
await noOverflow(sp, "readiness question");
while ((await journeyState(sp)) === "readiness") await act(sp, sp.locator('[data-answer="no"]'), "readiness/answer");
await sp.locator('#rj-main[data-owner="scan"]').waitFor();
await noOverflow(sp, "scan intro");
await agreeToCapture(sp); // already agreed in part A: consent is kept per customer
await act(sp, sp.locator('[data-start="demo_precomputed"]'), "scan/begin");
for (let view = 0; view < 4; view += 1) {
  await sp.locator('[data-cam="take"]').waitFor();
  await noOverflow(sp, `scan capture ${view + 1}`);
  await sp.locator('[data-cam="take"]').click();
  await sp.locator('[data-cam="use"]').click({ timeout: 20000 });
  await sp.waitForTimeout(400);
}
await sp.locator('[data-result="scan/continue"]').waitFor({ timeout: 60000 });
await noOverflow(sp, "scan result");
await shot(sp, "p3-phone-00-scan-result");
await act(sp, sp.locator('[data-result="scan/continue"]'), "scan/continue");
await noOverflow(sp, "choice");
await act(sp, sp.locator("[data-personal]"), "plan/personalized");
await noOverflow(sp, "setup");
await sp.locator('input[name="duration"][value="30"]').check({ force: true });
await sp.locator('input[name="intensity"][value="light"]').check({ force: true });
await sp.locator('input[name="goal"][value="core"]').check({ force: true });
await act(sp, sp.locator('#rj-setup button[type="submit"]'), "plan/request");
await noOverflow(sp, "recommendation");
await act(sp, sp.locator("[data-accept]"), "plan/accept");
await sp.locator('.rp[data-mode="ready"]').waitFor();
await noOverflow(sp, "player ready");
await act(sp, sp.locator('.rp-controls [data-act="start"]'), "workout/start");
await noOverflow(sp, "player");
for (const b of await sp.locator(".rp-controls button").all()) {
  const size = await b.boundingBox();
  if (size) assert.ok(size.height >= 56, `a ${size.height}px control on the phone`);
}
await shot(sp, "p3-phone-01-player");
await sp.locator('.rp-controls [data-act="anatomy"]').click();
await sp.locator(".rp-anatomy.is-expanded").waitFor();
await noOverflow(sp, "anatomy expanded");
await shot(sp, "p3-phone-02-anatomy", false);
await sp.locator("[data-anatomy-return]").click();
await sp.locator('.rp[data-mode="exercise"]').waitFor();
await sp.locator('.rp-controls-more [data-act="end"]').click();
await act(sp, sp.locator('[data-end="yes"]'), "workout/end");
await sp.locator("[data-effort]").first().waitFor();
await noOverflow(sp, "completion and effort question");
await shot(sp, "p3-phone-03-complete");
console.log("PASS phone: welcome, readiness, the scan (intro, four captures, result), choice, setup, plan, player, anatomy and completion all fit a 390px screen; player controls are at least 56px tall");

assert.deepEqual(errors, [], "no page errors");
await browser.close();
