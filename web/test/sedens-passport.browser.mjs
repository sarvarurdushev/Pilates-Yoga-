/** The customer's Fitness Passport on a phone (390x844), signed in as the demonstration customer.
 *
 * Opens the overview and every section, then checks: one h1 per page with focus on it, the section bar by
 * keyboard, no sideways scrolling, no console errors, touch targets of 44px or more, no play button for a
 * guided session, the demo and free-demo notices, the preferences save (and the language switch), the privacy
 * page (decisions, erasure request and withdrawal, export link) and Korean copy. With PASSPORT_ROOM_WORKOUT=1 it
 * first finishes one real room workout through the room screen, so the Passport has a visit to show.
 *
 * Start the server with SEDENS_MODE=demo_free (a fresh data directory). Usage:
 *   MOTION_BASE_URL=http://127.0.0.1:8231 CHROMIUM=/path/to/chrome \
 *   [SEDENS_SHOTS=/path/to/folder] [PASSPORT_ROOM_WORKOUT=1] node test/sedens-passport.browser.mjs
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const base = process.env.MOTION_BASE_URL || "http://127.0.0.1:8231";
const shots = process.env.SEDENS_SHOTS || "/tmp/claude-0/-home-user-Pilates-Yoga-/a114dcf3-dd14-5b01-8c6b-c8b3dbcd1269/scratchpad/p4shots";
mkdirSync(shots, { recursive: true });
const PHONE = { width: 390, height: 844 };
const key = randomBytes(16).toString("hex");
const errors = [];
const browser = await chromium.launch({
  ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}),
  args: ["--no-sandbox"],
});

async function open({ viewport = PHONE, lang = "en", name = "phone" } = {}) {
  const ctx = await browser.newContext({ viewport, locale: lang === "ko" ? "ko-KR" : "en-US", hasTouch: viewport.width < 600 });
  await ctx.addInitScript(([k, l]) => {
    sessionStorage.setItem("motion-demo-key", k);
    localStorage.setItem("sedens-lang", l);
  }, [key, lang]);
  const page = await ctx.newPage();
  page.on("pageerror", (error) => errors.push(`${name}: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    // A signed-out visit asks /sedens/me, and an unpaired room screen asks /sedens/room/session; both are told 401 and handle it, and the browser logs that as an error.
    const where = message.location().url || "";
    if (/Unauthorized/.test(message.text()) && (where.endsWith("/sedens/me") || where.endsWith("/sedens/room/session"))) return;
    if (where.endsWith("/favicon.ico")) return; // the site has no icon file; not part of the Passport
    errors.push(`${name}: console: ${message.text()} ${where}`);
  });
  page.on("dialog", (dialog) => dialog.accept());
  return { ctx, page };
}
const shot = async (page, file) => {
  await page.evaluate(() => window.scrollTo(0, 0)); // the sticky section bar belongs at the top of a full-page picture
  await page.screenshot({ path: `${shots}/passport-${file}.png`, fullPage: true });
};
const noOverflow = async (page, where) => {
  const [scroll, client] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  assert.ok(scroll <= client, `${where}: the page is ${scroll}px wide on a ${client}px screen`);
};
/** Go to a Passport route and wait for its page: the one h1 has the expected text and has focus. */
async function visit(page, hash, heading) {
  await page.evaluate((h) => { location.hash = h; }, hash);
  await page.locator("main h1", { hasText: heading }).waitFor();
  await page.waitForFunction(() => document.activeElement === document.querySelector("main h1"));
  assert.equal(await page.locator("main h1").count(), 1, `${hash}: exactly one h1`);
  assert.equal(await page.locator("main .pp-nav").count(), 1, `${hash}: the section bar`);
  await noOverflow(page, hash);
}
const bodyText = (page) => page.locator("main").innerText();
const FORBIDDEN = /calorie|\bscore|improv|strength gain|injury prevention|fitness age|칼로리|점수|개선|근력 향상|부상 예방|체력 나이/i;
/** Every visible link, button and field in the Passport is at least 44px tall. */
async function touchTargets(page, where) {
  const small = await page.evaluate(() =>
    [...document.querySelectorAll(".pp a, .pp button, .pp select, .pp textarea, .pp summary")]
      .filter((el) => el.offsetParent !== null)
      .map((el) => [el.textContent.trim().slice(0, 40), Math.round(el.getBoundingClientRect().height)])
      .filter(([, h]) => h < 44));
  assert.deepEqual(small, [], `${where}: touch targets under 44px`);
}

async function roomWorkout() {
  // One real standard workout through the room screen, finished with a skipped step and an effort answer.
  const room = await open({ viewport: { width: 1366, height: 900 }, name: "room" });
  const { page } = room;
  const act = async (locator, path) => {
    const answered = page.waitForResponse((r) => r.url().includes(`/sedens/room/journey/${path}`) && r.request().method() === "POST");
    await locator.click();
    assert.ok((await answered).ok(), path);
    await page.waitForTimeout(250);
  };
  const state = () => page.evaluate(async () => (await (await fetch("/sedens/room/journey")).json()).journey.state);
  await page.goto(base + "/room.html");
  await page.locator("#demo-room").click();
  await page.getByRole("button", { name: /DEMO-1001/ }).waitFor({ timeout: 180000 });
  await page.getByRole("button", { name: /DEMO-1001/ }).click();
  await act(page.locator('[data-act="readiness/start"]'), "readiness/start");
  for (let n = 0; n < 10 && (await state()) === "readiness"; n += 1) await act(page.locator('[data-answer="no"]'), "readiness/answer");
  await act(page.locator("[data-skip]"), "scan/skip");
  await act(page.locator("[data-personal]"), "plan/personalized");
  await page.locator('input[name="duration"][value="30"]').check({ force: true });
  await page.locator('input[name="intensity"][value="moderate"]').check({ force: true });
  await page.locator('input[name="goal"][value="general"]').check({ force: true });
  await act(page.locator('#rj-setup button[type="submit"]'), "plan/request");
  await act(page.locator("[data-accept]"), "plan/accept");
  await page.locator('.rp[data-mode="ready"]').waitFor();
  await act(page.locator('.rp-controls [data-act="start"]'), "workout/start");
  await page.locator('.rp[data-mode="exercise"]').waitFor();
  await act(page.locator('.rp-controls-more [data-act="skip"]'), "workout/step");
  for (let n = 0; n < 40 && (await page.locator("#rj-main").getAttribute("data-owner")) === "player"; n += 1) await act(page.locator(".rp-controls-main [data-act=done]"), "workout/step");
  await page.locator('[data-effort="6"]').click();
  await page.locator('[data-discomfort="no"]').click();
  await act(page.locator("[data-submit]"), "workout/feedback");
  await room.ctx.close();
}

if (process.env.PASSPORT_ROOM_WORKOUT === "1") {
  await roomWorkout();
  console.log("one real room workout finished");
}

const { page } = await open();
await page.goto(base + "/");

// -- signed out: a sign-in prompt, not an error --------------------------------------------------
await page.evaluate(() => { location.hash = "#/passport"; });
await page.locator("main h1", { hasText: "Sign in to see your Passport" }).waitFor();
assert.equal(await page.locator("main h1").count(), 1);
assert.ok(await page.getByRole("link", { name: "Go to sign in" }).isVisible());
await shot(page, "00-signed-out");

// -- the demonstration customer -------------------------------------------------------------------
const entered = await page.evaluate(async (k) => {
  const response = await fetch("/sedens/demo/enter", {
    method: "POST", headers: { "Content-Type": "application/json", "X-Sedens-Request": "1" }, body: JSON.stringify({ role: "student", key: k }),
  });
  return response.status;
}, key);
assert.equal(entered, 200, "the demonstration customer can sign in");
await page.goto(base + "/#/");
await page.locator("main h1").first().waitFor();
const homeCard = page.locator(".sd-card", { hasText: "Fitness Passport" });
assert.equal(await homeCard.locator(".sd-badge").count(), 0, "the home card is no longer marked as a later phase");
await homeCard.getByRole("link", { name: "Open" }).click();
await page.locator("main h1", { hasText: "Fitness Passport" }).waitFor();

// -- overview -------------------------------------------------------------------------------------
await visit(page, "#/passport", "Fitness Passport");
let overview = await bodyText(page);
assert.match(overview, /Demo data/);
assert.doesNotMatch(overview, /free demo may lose its data when the server restarts/, "the site-wide storage banner says it once");
assert.equal(await page.locator(".sd-banner", { hasText: "Demonstration storage" }).count(), 1, "the site banner shows the free-demo storage warning");
const latestBox = await page.locator("#pp-latest").boundingBox();
assert.ok(latestBox && latestBox.y + 120 < PHONE.height, "the latest workout starts on the first screen");
assert.ok((await page.locator("#pp-next").count()) + (await page.locator("#pp-program").count()) <= 1, "one next-step card: the program or the next step, not both");
assert.match(overview, /Latest workout/);
assert.match(overview, /Completed visits/);
assert.match(overview, /Exercise minutes/);
assert.match(overview, /Last reported effort/);
assert.match(overview, /Next step|Current program/);
assert.match(overview, /Categories practised/);
assert.match(overview, /Room scans/);
assert.doesNotMatch(overview, FORBIDDEN, "no forbidden vocabulary on the overview");
assert.equal(await page.locator(".pp a.sd-primary, .pp .sd-primary").count(), 1, "one obvious next action");
await touchTargets(page, "overview");
await shot(page, "01-overview");
// A guided session is never started from the Passport.
assert.equal(await page.getByRole("button", { name: /^(start|play|begin|resume)/i }).count(), 0, "no play or start button");
assert.equal(await page.getByRole("link", { name: /^(start|play|begin|resume)/i }).count(), 0, "no play or start link");

// The section bar works by keyboard: focus a link, press Enter.
await page.locator('.pp-nav a[href="#/passport/history"]').focus();
await page.keyboard.press("Enter");
await page.locator("main h1", { hasText: "Workout history" }).waitFor();
await page.waitForFunction(() => document.activeElement === document.querySelector("main h1"));
assert.equal(await page.locator('.pp-nav a[aria-current="page"]').innerText(), "History");

// -- history --------------------------------------------------------------------------------------
await visit(page, "#/passport/history", "Workout history");
const cards = await page.locator("#pp-history-list > article").count();
assert.ok(cards > 0 || (await bodyText(page)).includes("No visits recorded yet"), "cards or the empty state");
if (cards) {
  assert.ok(await page.locator("article[data-kind]").first().isVisible());
  const more = page.locator("#pp-more");
  if (await more.count()) {
    await more.click();
    await page.locator("#pp-status", { hasText: "Older visits added." }).waitFor({ state: "attached" });
    assert.ok((await page.locator("#pp-history-list > article").count()) > cards, "older visits were added");
  }
}
await touchTargets(page, "history");
await shot(page, "02-history");
const roomCard = page.locator('article[data-kind="room"]').first();
if (await roomCard.count()) {
  // -- one workout -----------------------------------------------------------------------------
  await roomCard.getByRole("link", { name: /View details/ }).click();
  await page.locator("main h1", { hasText: "Workout" }).waitFor();
  await page.waitForFunction(() => document.activeElement === document.querySelector("main h1"));
  const detail = await bodyText(page);
  assert.match(detail, /Steps/);
  assert.match(detail, /Completed|Skipped/);
  assert.doesNotMatch(detail, FORBIDDEN);
  await noOverflow(page, "workout");
  await touchTargets(page, "workout");
  await shot(page, "03-workout");
}

// -- scans ----------------------------------------------------------------------------------------
await visit(page, "#/passport/scans", "Room scans");
const scans = await bodyText(page);
assert.ok(/No room scans yet/.test(scans) || /There isn't enough comparable information yet|Comparing your two latest scans/.test(scans));
assert.doesNotMatch(scans, FORBIDDEN);
await touchTargets(page, "scans");
await shot(page, "04-scans");

// -- programs -------------------------------------------------------------------------------------
await visit(page, "#/passport/programs", "Programs");
// The demonstration customer follows the programs the Phase 4 persona was seeded with; if seeding broke, this fails.
// (Enrolling is covered by the DEMO-1002 flow in sedens-room-journey.browser.mjs.)
assert.ok(/of \d+ sessions done/.test(await bodyText(page)), "the seeded persona follows programs (no 'not enrolled' sentence)");
assert.doesNotMatch(await bodyText(page), /You are not enrolled in a course yet/);
await page.reload();
await page.locator("main h1", { hasText: "Programs" }).waitFor();
await page.locator(".pp-program").first().waitFor();
const programs = await bodyText(page);
assert.match(programs, /4-Week Core Foundations/);
assert.match(programs, /of 2 sessions done/);
assert.match(programs, /Available in the AI Private Room/);
assert.match(programs, /never applied/);
assert.equal(await page.locator(".pp-program button, .pp-program [role=button]").count(), 0, "a program card has no buttons");
assert.equal(await page.locator(".pp-program a", { hasText: /play|start|begin/i }).count(), 0, "a program card has no play link");
await touchTargets(page, "programs");
await shot(page, "05-programs");

// -- achievements ---------------------------------------------------------------------------------
await visit(page, "#/passport/achievements", "Achievements");
assert.match(await bodyText(page), /Milestones/);
await touchTargets(page, "achievements");
await shot(page, "06-achievements");

// -- preferences ----------------------------------------------------------------------------------
await visit(page, "#/passport/preferences", "Preferences");
await page.locator('select[name="exercise_style"]').selectOption("mobility");
await page.locator('select[name="intensity"]').selectOption("light");
await page.locator('select[name="music"]').selectOption("calm");
await page.locator('select[name="language"]').selectOption("en");
await touchTargets(page, "preferences");
await shot(page, "07-preferences");
await page.getByRole("button", { name: "Save preferences" }).click();
await page.locator("#pp-status", { hasText: "Saved." }).waitFor();
const saved = await page.evaluate(async () => (await (await fetch("/sedens/passport/preferences?lang=en")).json()).preferences);
assert.deepEqual([saved.exercise_style, saved.intensity, saved.music, saved.language], ["mobility", "light", "calm", "en"]);

// -- privacy --------------------------------------------------------------------------------------
await visit(page, "#/passport/privacy", "Privacy and your data");
const privacy = await bodyText(page);
assert.match(privacy, /What is stored/);
assert.match(privacy, /Attendance and purchase records|attendance and purchase records/i);
assert.match(privacy, /the facility decides|it decides what to erase/i);
assert.ok(await page.getByRole("link", { name: "Download my data" }).isVisible());
assert.equal(await page.locator('a[download]').getAttribute("href"), "/sedens/passport/export");
assert.doesNotMatch(privacy, FORBIDDEN);
await touchTargets(page, "privacy");
await shot(page, "08-privacy");
// An erasure request: sent, shown with its state, and withdrawn.
await page.locator('#pp-erase textarea[name="message"]').fill("Please erase my Passport.");
await page.getByRole("button", { name: "Send the request" }).click();
await page.locator("#pp-status", { hasText: "Your request was recorded." }).waitFor();
assert.match(await page.locator("#pp-body").innerText(), /received, the facility has not decided yet/);
assert.equal(await page.locator("#pp-erase").count(), 0, "one open request at a time");
await shot(page, "09-privacy-requested");
await page.getByRole("button", { name: "Withdraw this request" }).click();
await page.locator("#pp-status", { hasText: "The request was withdrawn." }).waitFor();
assert.match(await page.locator("#pp-body").innerText(), /withdrawn by you/);
// Photos: none kept here, so there is no delete button (a button only for what the API supports).
assert.equal(await page.locator("[data-photos-delete]").count(), 0);
assert.equal(await page.locator("[data-withdraw]").count(), 0);
await noOverflow(page, "privacy after actions");

// The export is a real attachment of the customer's own data.
const exported = await page.evaluate(async () => {
  const response = await fetch("/sedens/passport/export");
  return { status: response.status, disposition: response.headers.get("content-disposition"), body: response.ok ? await response.json() : null };
});
assert.equal(exported.status, 200, "the export link works");
assert.match(exported.disposition, /attachment/);
assert.equal(exported.body.format, "sedens-passport-export-1");

// -- a staff account gets a plain explanation -----------------------------------------------------
const staff = await open({ name: "staff" });
await staff.page.goto(base + "/");
await staff.page.evaluate(async (k) => {
  await fetch("/sedens/demo/enter", { method: "POST", headers: { "Content-Type": "application/json", "X-Sedens-Request": "1" }, body: JSON.stringify({ role: "coach", key: k }) });
}, key);
await staff.page.goto(base + "/#/passport/privacy");
await staff.page.evaluate(() => location.reload());
await staff.page.locator("main h1", { hasText: "The Passport is for customers" }).waitFor();
await shot(staff.page, "10-staff");
await staff.ctx.close();

// -- Korean ---------------------------------------------------------------------------------------
await page.evaluate(() => { location.hash = "#/passport/preferences"; });
await page.locator('select[name="language"]').selectOption("ko");
await page.getByRole("button", { name: "Save preferences" }).click();
await page.locator("main h1", { hasText: "내 설정" }).waitFor();
assert.equal(await page.evaluate(() => document.documentElement.lang), "ko", "saving the language switched the page");
await visit(page, "#/passport", "피트니스 패스포트");
overview = await bodyText(page);
assert.match(overview, /시연 데이터/);
assert.doesNotMatch(overview, /서버가 다시 시작되면 데이터가 사라질 수 있어요/, "the site-wide storage banner says it once");
assert.doesNotMatch(overview, FORBIDDEN);
await touchTargets(page, "overview (ko)");
await shot(page, "11-overview-ko");
for (const [hash, heading] of [["#/passport/history", "운동 기록"], ["#/passport/scans", "룸 스캔"], ["#/passport/programs", "프로그램"], ["#/passport/achievements", "이정표"], ["#/passport/privacy", "개인정보와 내 데이터"]]) {
  await visit(page, hash, heading);
  assert.doesNotMatch(await bodyText(page), FORBIDDEN, hash);
}
await shot(page, "12-privacy-ko");

// -- a tablet and a desktop width -----------------------------------------------------------------
for (const [name, viewport] of [["tablet", { width: 820, height: 1100 }], ["desktop", { width: 1280, height: 900 }]]) {
  await page.setViewportSize(viewport);
  await visit(page, "#/passport", "피트니스 패스포트");
  await shot(page, `13-overview-${name}`);
}

assert.deepEqual(errors, [], "no console or page errors");
await browser.close();
console.log("PASS passport: signed out, overview, keyboard section bar, history, workout, scans, programs, achievements, preferences, privacy, staff, Korean, tablet, desktop");
