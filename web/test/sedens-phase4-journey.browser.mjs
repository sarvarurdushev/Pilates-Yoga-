/** Phase 4 stop condition, in a real browser: the customer's Fitness Passport on a phone, a workout in the
 * AI Private Room, and the Passport again; then the same for the facility coach's and the professor's
 * programs; then the facility administrator's usage page.
 *
 * The demonstration customer DEMO-1001 (Sarah Kim) has a seeded, labelled "Demo data" history (pilates/sedens/
 * demo_history.py): six earlier visits, three enrolled programs, two comparable demonstration scans. Everything
 * below is asserted on the screen, not only through the API:
 *
 *  1-7   phone (390x844): open the Passport, see recent sessions and the current program, open a previous
 *        visit, see the exercises completed and skipped and the effort reported, open the scan history, see
 *        the comparison of the two seeded scans, see done / total for each program
 *  8     leave the phone (sign out)
 *  9-12  room display (1920x1080): the demonstration room screen, the customer's entry credential, consent,
 *        the demonstration scan, a personalized SEDENS Standard session, a real exercise (it runs to its end
 *        and the next one starts by itself), the instruction card, the interactive anatomy (a structure is
 *        selected), the rest fast-forwarded, the effort question
 *  13-15 phone again: the new visit is first in the history, completed visits +1, exercise minutes not lower,
 *        program progress
 *  16    no score, calorie, improvement, injury, fitness-age, strength-gain or diagnosis wording on any Passport
 *        page or on the room's completion screen, in English and in Korean (the standard negations, such as
 *        "not better or worse", are the only exceptions)
 *  17    outside the room nothing plays: every room route is refused with its documented code for the phone's
 *        session, a program's picture is not served to it, and the Passport has no play or start control
 *  then  4-Week Core Foundations (coach Minji Lee, free for the facility) and Mobility Foundations (the
 *        fictional professor, bought through the demonstration checkout): the next session is played in the
 *        room and completed, and the Passport's progress moves by one on the version the customer is pinned to
 *        (the program's version is really pinned: a version 2 of the coach's program is published first, and the room and
 *        the Passport still play and show version 1; the coach's program is the one the Passport calls current, and
 *        the phone and the room name the next session the same way)
 *  last  the facility administrator's usage page (#/facility/usage): the counts are exactly what this run did
 *        (three completed visits; the seeded history is not counted), the definitions are shown, and the
 *        simulation is rooms x 99,000 won + billable visits x 250 won, "not an invoice", VAT excluded
 *
 * Start the server with SEDENS_MODE=demo_free and a fresh data directory (the demonstration scan option and the
 * seeded history belong to that mode). This Chromium has no H.264 decoder; nothing here plays an H.264 file.
 * Usage: MOTION_BASE_URL=http://127.0.0.1:8412 CHROMIUM=/path/to/chrome [SEDENS_SHOTS=/path/to/folder] \
 *   node test/sedens-phase4-journey.browser.mjs
 * Pictures are written as <folder>/journey-*.png.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const base = process.env.MOTION_BASE_URL || "http://127.0.0.1:8412";
const shots = process.env.SEDENS_SHOTS
  || "/tmp/claude-0/-home-user-Pilates-Yoga-/a114dcf3-dd14-5b01-8c6b-c8b3dbcd1269/scratchpad/p4shots";
mkdirSync(shots, { recursive: true });
const PHONE = { width: 390, height: 844 };
const ROOM = { width: 1920, height: 1080 };
const DESKTOP = { width: 1280, height: 900 };
const key = randomBytes(16).toString("hex");
const errors = [];
const browser = await chromium.launch({
  ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}),
  args: ["--no-sandbox", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
    "--autoplay-policy=no-user-gesture-required"],
});

async function open({ viewport, lang = "en", name }) {
  const phone = viewport.width < 600;
  const ctx = await browser.newContext({
    viewport, locale: lang === "ko" ? "ko-KR" : "en-US", hasTouch: phone, permissions: phone ? [] : ["camera"],
  });
  await ctx.addInitScript(([k, l]) => {
    sessionStorage.setItem("motion-demo-key", k);
    localStorage.setItem("sedens-lang", l);
    // The room player's anatomy frame reports what it shows; the checks below read these messages.
    window.__anatomy = [];
    window.addEventListener("message", (event) => {
      if (String(event.data?.type || "").startsWith("sedens-anatomy")) window.__anatomy.push(event.data);
    });
  }, [key, lang]);
  const page = await ctx.newPage();
  page.on("pageerror", (error) => errors.push(`${name}: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const where = message.location().url || "";
    // A signed-out visit asks /sedens/me and an unpaired room screen asks /sedens/room/session: both are told 401
    // and handle it, and the browser logs that as an error. The refusals this test provokes are logged too.
    if (/Unauthorized|Forbidden|Not Found|Failed to load resource/.test(message.text())
      && /\/sedens\/(me|room\/|media\/)/.test(where)) return;
    if (where.endsWith("/favicon.ico")) return;
    errors.push(`${name}: console: ${message.text()} ${where}`);
  });
  page.on("dialog", (dialog) => dialog.accept());
  return { ctx, page };
}

const shot = async (page, name, full = true) => {
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
  await page.screenshot({ path: `${shots}/journey-${name}.png`, fullPage: full });
};
const noOverflow = async (page, where) => {
  const [scroll, client] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  assert.ok(scroll <= client, `${where}: the page is ${scroll}px wide on a ${client}px screen`);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Sign in as a demonstration role by its button. The server allows ten demonstration entries a minute from one
 * address, so a refusal is waited out once. */
async function signIn(page, role) {
  await page.goto(base + "/");
  const status = () => page.evaluate(() => document.querySelector("#demo-status")?.textContent || "");
  const tooMany = /Too many attempts|시도가 너무 많습니다/;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.locator(`[data-demo="${role}"]`).click();
    await page.waitForFunction(() => {
      const text = document.querySelector("#demo-status")?.textContent || "";
      return !text || /Too many attempts|시도가 너무 많습니다/.test(text) || !document.querySelector("[data-demo]");
    }, null, { timeout: 60000 });
    if (!tooMany.test(await status())) break;
    await sleep(61000);
  }
  assert.equal(await status(), "", `${role} entered the demonstration`);
  await page.waitForLoadState("networkidle");
}

// -- Passport helpers ---------------------------------------------------------------------------------------

const bodyText = (page) => page.locator("body").innerText();
const mainText = (page) => page.locator("main").innerText();
async function passportPage(page, hash, heading) {
  // A fresh load, so the page shows what the server holds now.
  await page.goto(`${base}/#/${hash}`);
  await page.reload();
  await page.locator("main h1", { hasText: heading }).waitFor();
  assert.equal(await page.locator("main h1").count(), 1, `${hash}: one h1`);
  await noOverflow(page, hash);
}
async function tab(page, id, heading) {
  await page.locator(`.pp-nav a[href="#/passport${id ? "/" + id : ""}"]`).click();
  await page.locator("main h1", { hasText: heading }).waitFor();
  await page.waitForTimeout(400);
  await noOverflow(page, id || "overview");
}
/** The overview's totals as numbers. */
async function totals(page) {
  const rows = await page.evaluate(() => [...document.querySelectorAll(".pp-stats > div")].map((d) => [d.querySelector("dt").textContent, d.querySelector("dd").textContent]));
  const find = (label) => (rows.find(([k]) => k === label) || [])[1];
  const visits = find("Completed visits");
  const minutes = find("Exercise minutes");
  assert.match(visits, /^\d+$/, "completed visits is a number");
  assert.match(minutes, /^(\d+ min|under a minute)$/, "exercise minutes is a number or 'under a minute'");
  return { visits: Number(visits), minutes: minutes === "under a minute" ? 0 : parseInt(minutes, 10), effort: find("Last reported effort") };
}
/** Every program card on the Programs page: done / total, the pinned version and the next session. */
async function programs(page) {
  await passportPage(page, "passport/programs", "Programs");
  await page.locator(".pp-program").first().waitFor();
  const cards = await page.evaluate(() => [...document.querySelectorAll(".pp-program")].map((c) => ({
    title: c.querySelector("h2").textContent.trim(), text: c.innerText,
  })));
  const out = {};
  for (const { title, text } of cards) {
    const progress = text.match(/(\d+) of (\d+) sessions done/);
    assert.ok(progress, `${title}: shows done / total`);
    out[title] = {
      done: Number(progress[1]), total: Number(progress[2]),
      version: Number((text.match(/You are on version (\d+)/) || [])[1] || 0),
      next: (text.match(/Next session: (.+)/) || [])[1] || "",
      text,
    };
  }
  return out;
}
/** The newest visit card in the history, parsed. */
async function topVisit(page) {
  await passportPage(page, "passport/history", "Workout history");
  const first = page.locator("#pp-history-list > article").first();
  await first.waitFor();
  const text = await first.innerText();
  const num = (label) => Number((text.match(new RegExp(`${label}\\s+(\\d+)`)) || [])[1] ?? NaN);
  return {
    text, kind: await first.getAttribute("data-kind"),
    href: await first.getByRole("link", { name: /View details/ }).getAttribute("href").catch(() => null),
    completed: num("Exercises completed"), skipped: num("Exercises skipped"),
    effort: (text.match(/Reported effort\s+(\d+) out of 10/) || [])[1],
    count: await page.locator('#pp-history-list > article[data-kind="room"]').count(),
  };
}

// The words a Passport page or the room's completion screen must never use about the customer, except inside the
// standard negations (each exception is a whole sentence of the product's own copy).
const FORBIDDEN = {
  en: /calorie|\bkcal\b|\bburn(?:ed|s|ing)?\b|\bscore|\bimprov\w*|\binjur\w*|\bprevent\w*|fitness age|strength gain|muscle activation|\bstronger\b|\bfitter\b|\bhealthier\b|\bdiagnos\w*|\bbetter\b|\bworse\b/gi,
  ko: /칼로리|체지방|점수|개선|향상|부상|예방|체력 나이|근력 향상|근육 활성|활성도|더 건강|진단|좋아지|좋아졌|나아지|나아졌|나빠지|나빠졌/g,
};
const NEGATIONS = {
  en: [/(?:is|does) not (?:mean )?better or worse/gi, /can't tell us anything about pain, injury or your health/gi,
    /does not diagnose or treat any condition/gi, /not measured muscle activation/gi],
  ko: [/좋아지거나 나빠졌다는 뜻이 아니에요/g, /통증이나 부상, 건강 상태에 대해서는 알 수 없어요/g,
    /진단하거나 치료하지 (?:않아요|않습니다)/g, /측정된 근육 활성도가 아닙니다/g],
};
function calm(text, language, where) {
  let rest = text;
  for (const negation of NEGATIONS[language]) rest = rest.replace(negation, " ");
  const found = [...rest.matchAll(FORBIDDEN[language])].map((m) => rest.slice(Math.max(0, m.index - 50), m.index + 60).replace(/\s+/g, " "));
  assert.deepEqual(found, [], `${where} (${language}): forbidden wording outside the standard negations`);
}
const PASSPORT_PAGES = [
  ["passport", "Fitness Passport", "피트니스 패스포트"],
  ["passport/history", "Workout history", "운동 기록"],
  ["passport/scans", "Room scans", "룸 스캔"],
  ["passport/programs", "Programs", "프로그램"],
  ["passport/achievements", "Achievements", "이정표"],
  ["passport/preferences", "Preferences", "내 설정"],
  ["passport/privacy", "Privacy and your data", "개인정보와 내 데이터"],
];
/** Open every Passport section (and one visit's details) and check the words on each. Returns the number checked. */
async function sweep(page, language, detailHref) {
  const index = language === "ko" ? 2 : 1;
  for (const entry of PASSPORT_PAGES) {
    await passportPage(page, entry[0], entry[index]);
    await page.waitForTimeout(500);
    calm(await bodyText(page), language, entry[0]);
  }
  if (detailHref) {
    await page.goto(base + "/" + detailHref);
    await page.reload();
    await page.locator(".pp-steps").waitFor();
    calm(await bodyText(page), language, "visit details");
  }
  return PASSPORT_PAGES.length + (detailHref ? 1 : 0);
}

// -- room helpers (as in sedens-room-journey.browser.mjs) ---------------------------------------------------------

const owner = (page) => page.locator("#rj-main").getAttribute("data-owner");
const roomText = (page) => page.locator("#rj-main").innerText();
const journeyView = (page) => page.evaluate(async () => (await (await fetch("/sedens/room/journey")).json()).journey);
const journeyState = async (page) => (await journeyView(page)).state;
async function act(page, locator, path) {
  const answered = page.waitForResponse((r) => r.url().includes(`/sedens/room/journey/${path}`) && r.request().method() === "POST");
  await locator.click();
  const response = await answered;
  assert.ok(response.ok(), `${path}: ${response.status()} ${await response.text()}`);
  await page.waitForTimeout(250); // the screen redraws right after the answer
}
async function enterRoom(page) {
  await page.goto(base + "/room.html");
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.locator("#demo-room").click();
    const which = await Promise.race([
      page.getByRole("button", { name: /DEMO-1001/ }).waitFor({ timeout: 180000 }).then(() => "in"),
      page.getByText(/Too many attempts|시도가 너무 많습니다/).waitFor({ timeout: 180000 }).then(() => "wait"),
    ]);
    if (which === "in") break;
    await sleep(61000);
  }
  await identify(page);
}
async function identify(page) {
  await page.getByRole("button", { name: /DEMO-1001/ }).click();
  await page.locator('[data-act="readiness/start"]').waitFor();
}
async function readiness(page) {
  await act(page, page.locator('[data-act="readiness/start"]'), "readiness/start");
  for (let n = 0; n < 10 && (await journeyState(page)) === "readiness"; n += 1)
    await act(page, page.locator('[data-answer="no"]'), "readiness/answer");
  assert.equal(await journeyState(page), "scan_intro");
}
async function finishWorkout(page) {
  for (let n = 0; n < 40 && (await owner(page)) === "player"; n += 1)
    await act(page, page.locator(".rp-controls-main [data-act=done]"), "workout/step");
  assert.equal(await journeyState(page), "session_complete");
}
async function anatomyShown(page, predicate, what) {
  await page.waitForFunction(predicate, null, { timeout: 120000 }).catch(async () => {
    throw new Error(`${what}: ${JSON.stringify((await page.evaluate(() => window.__anatomy)).slice(-4))}`);
  });
}
/** Answer the two feedback questions (effort optional) and wait for the saved screen. */
async function giveFeedback(page, effort) {
  if (effort === null) await page.locator("[data-effort-skip]").click();
  else await page.locator(`[data-effort="${effort}"]`).click();
  await page.locator('[data-discomfort="no"]').click();
  await act(page, page.locator("[data-submit]"), "workout/feedback");
}
async function endVisit(page) {
  await page.locator("[data-end-visit]").click();
  await page.locator("[data-end-confirm]").click();
  await page.getByRole("button", { name: /DEMO-1001/ }).waitFor();
}
/** The numbers on the room's completion screen. */
async function completion(page) {
  const text = await roomText(page);
  const of = text.match(/(\d+) of (\d+) completed/);
  assert.ok(of, "the completion screen says how many exercises were completed");
  return { completed: Number(of[1]), total: Number(of[2]), skipped: Number((text.match(/(\d+) skipped/) || [])[1] || 0) };
}
/** The room screen's words, in English and (by the language switch) in Korean. */
async function calmRoom(page, where) {
  calm(await bodyText(page), "en", `${where} (room)`);
  await page.getByRole("button", { name: "한국어", exact: true }).click();
  await page.getByRole("button", { name: "English", exact: true }).waitFor();
  const korean = await bodyText(page);
  assert.match(korean, /[가-힣]/, "the room switched to Korean");
  calm(korean, "ko", `${where} (room)`);
  await shot(page, `room-${where}-ko`, false);
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page.getByRole("button", { name: "한국어", exact: true }).waitFor();
}
/** The player's first look: a video or instruction card, and the anatomy panel with its honest label. */
async function playerShows(page, what) {
  assert.ok(await page.locator(".rp-media video, .rp-media img, .rp-media .rp-figure, .rp-media .rp-card").first().isVisible(), `${what}: video or instruction card`);
  assert.match(await page.locator("[data-anatomy-label]").innerText(), /not measured muscle activation/);
  await anatomyShown(page, () => window.__anatomy.some((m) => m.type === "sedens-anatomy-state" && m.op === "show" && m.selected != null),
    `${what}: the anatomy panel highlights the exercise's structures`);
}
/** A visit on the Passport: a new top card with the same counts the room showed. */
function sameVisit(top, expected, before, what) {
  assert.equal(top.kind, "room", `${what}: the newest history card is the room visit`);
  assert.ok(top.href && top.href !== before.href, `${what}: it is a new visit`);
  assert.equal(top.count, before.count + 1, `${what}: one more room visit in the history`);
  assert.match(top.text, /Completed/, `${what}: completed`);
  assert.equal(top.completed, expected.completed, `${what}: exercises completed as the room showed`);
  assert.equal(top.skipped, expected.skipped, `${what}: exercises skipped as the room showed`);
  assert.equal(top.effort, expected.effort, `${what}: the effort the customer reported`);
}

// ======================================================================================
// 1-7. The Passport on a phone
// ======================================================================================
let phone = await open({ viewport: PHONE, name: "phone" });
let p = phone.page;
await signIn(p, "student");
assert.deepEqual(await p.evaluate(() => [innerWidth, innerHeight]), [390, 844], "a 390x844 phone viewport");
await p.locator(".sd-card", { hasText: "Fitness Passport" }).getByRole("link", { name: "Open" }).click();
await p.locator("main h1", { hasText: "Fitness Passport" }).waitFor();
await p.locator("#pp-latest").waitFor();
await noOverflow(p, "overview");
await shot(p, "01-phone-overview");
console.log("PASS 1: the Passport opens on a 390x844 phone");

// 2. Recent sessions and the current program.
const overview = await mainText(p);
assert.match(overview, /Demo data/, "the history is labelled as demonstration data");
assert.match(overview, /Recent activity/);
assert.ok((await p.locator('[aria-labelledby="pp-recent"] li').count()) >= 3, "recent sessions are listed");
assert.match(overview, /Current program/);
assert.match(await p.locator('[aria-labelledby="pp-program"]').innerText(), /SEDENS Standard: Foundations[\s\S]*of 3 sessions done[\s\S]*Next session: /);
assert.match(await p.locator('[aria-labelledby="pp-courses"]').innerText(), /Mobility Foundations[\s\S]*4-Week Core Foundations/);
// What the Passport names as the program being followed; the room's "Continue your program" must say the same.
const currentPassport = {
  title: (await p.locator('[aria-labelledby="pp-program"] .pp-hero-title').innerText()).trim(),
  next: (await p.locator('[aria-labelledby="pp-program"] .pp-next-session').innerText()).replace(/^Next session:\s*/, "").trim(),
  position: (await p.locator('[aria-labelledby="pp-program"] .pp-next-session + p').innerText()).split("·")[0].trim(),
  courseId: await p.evaluate(async () => (await (await fetch("/sedens/passport/overview")).json()).current_program.course_id),
};
assert.match(currentPassport.position, /^Session \d+ of \d+$/, "the phone numbers the next session the way the room does");
const start = await totals(p);
assert.equal(start.visits, 6, "six seeded visits");
assert.ok(start.minutes > 0, "the seeded visits have exercise minutes");
await shot(p, "02-phone-overview-sessions-program");
console.log(`PASS 2: recent sessions and the current program are on the overview (visits ${start.visits}, minutes ${start.minutes})`);

// 3. A previous visit.
await tab(p, "history", "Workout history");
const historyBefore = await topVisit(p);
await shot(p, "03-phone-history");
await p.locator('#pp-history-list > article[data-kind="room"]').first().getByRole("link", { name: /View details/ }).click();
await p.locator("main h1", { hasText: "Workout" }).waitFor();
await p.locator(".pp-steps").waitFor();
await noOverflow(p, "visit details");

// 4. The exercises completed and skipped, and the effort reported.
const detail = await mainText(p);
const marks = await p.locator(".pp-step").evaluateAll((rows) => rows.map((row) => row.dataset.state));
assert.ok(marks.includes("completed") && marks.includes("skipped"), `the steps show completed and skipped exercises: ${marks}`);
const summary = (label) => Number((detail.match(new RegExp(`${label}\\s+(\\d+)`)) || [])[1]);
assert.equal(summary("Exercises completed"), marks.filter((m) => m === "completed").length, "the total matches the steps");
assert.equal(summary("Exercises skipped"), marks.filter((m) => m === "skipped").length, "the total matches the steps");
assert.match(detail, /Reported effort\s+4 out of 10/, "the effort the customer reported");
assert.match(detail, /These are your own answers\. SEDENS does not interpret them\./);
assert.match(detail, /Course version 1, the version you enrolled in/);
await shot(p, "04-phone-visit-details");
console.log(`PASS 3-4: a previous visit shows its steps (${marks.join(", ")}) and the reported effort`);

// 5-6. Scan history and the comparison of the two seeded scans.
await tab(p, "scans", "Room scans");
const scansText = await mainText(p);
assert.match(scansText, /Comparing your two latest scans/);
assert.match(scansText, /These are demonstration scans\./);
assert.match(scansText, /Earlier scan\s+Sep 10, 2026/);
assert.match(scansText, /Recent scan\s+Oct 8, 2026/);
assert.match(scansText, /Difference\s+\+0\.15°/);
assert.match(scansText, /Recent value minus earlier value\./);
assert.ok(scansText.indexOf("a plus sign means the left shoulder point was higher") > 0
  && scansText.indexOf("a plus sign means the left shoulder point was higher") < scansText.indexOf("Difference"),
"the sign note belongs to the two values, so it sits above the difference and not under it");
assert.match(scansText, /not better or worse/, "a difference is never framed as better or worse");
assert.match(scansText, /All scans/, "the scan history is listed");
assert.ok((scansText.match(/Fictional demo scan/g) || []).length >= 2, "both scans are listed and marked as demonstration scans");
await shot(p, "05-phone-scans-comparison");
console.log("PASS 5-6: scan history with the eligible comparison of the two seeded demonstration scans (difference +0.15°, not better or worse)");

// 7. Program progress: done / total per program.
const seeded = await programs(p);
assert.deepEqual(Object.fromEntries(Object.entries(seeded).map(([k, v]) => [k, [v.done, v.total]])), {
  "Mobility Foundations": [1, 3], "4-Week Core Foundations": [1, 2], "SEDENS Standard: Foundations": [2, 3],
});
for (const card of Object.values(seeded)) {
  assert.ok(card.version >= 1, "each program says which version the customer is on");
  assert.match(card.text, /Available in the AI Private Room\./);
}
assert.equal(await p.getByRole("button", { name: /^(start|play|begin|resume|continue)/i }).count(), 0, "no play or start button");
assert.equal(await p.getByRole("link", { name: /^(start|play|begin|resume|continue)/i }).count(), 0, "no play or start link");
await shot(p, "06-phone-programs");
console.log("PASS 7: course progress per program (Standard 2 of 3, Mobility 1 of 3, Core 1 of 2)");

// 8. Leave the phone experience: sign out, and the Passport asks for a sign-in.
await p.getByRole("button", { name: "Account" }).click(); // on a phone, the name and "Sign out" sit behind the account button
await p.getByRole("button", { name: "Sign out" }).click();
await p.locator("[data-demo=\"student\"]").waitFor(); // the home screen offers the sign-in again
await p.goto(base + "/#/passport");
await p.reload();
await p.locator("main h1", { hasText: "Sign in to see your Passport" }).waitFor();
await shot(p, "07-phone-signed-out");
await phone.ctx.close();
console.log("PASS 8: signed out of the phone");

// ======================================================================================
// 9-12. The AI Private Room: a personalized SEDENS Standard session
// ======================================================================================
const room = await open({ viewport: ROOM, name: "room" });
const r = room.page;
await enterRoom(r);
assert.deepEqual(await r.evaluate(() => [innerWidth, innerHeight]), [1920, 1080], "a 1920x1080 room display");
assert.match(await roomText(r), /Hello, Sarah/);
assert.match(await bodyText(r), /SIMULATED/, "the demonstration room is marked as simulated");
assert.match(await roomText(r), /6 visits/, "the room welcome knows the six seeded visits");
await shot(r, "10-room-welcome", false);
console.log("PASS 9: the authorized room (demonstration screen, member credential DEMO-1001) opens for Sarah");

await readiness(r);
// Consent: camera consent is a switch, off until the customer turns it on.
const capture = r.locator('[data-consent="scan_capture"]');
await capture.waitFor();
assert.equal(await capture.getAttribute("aria-checked"), "false", "camera consent is off until the customer agrees (the seeded history records none)");
await shot(r, "11-room-consent", false);
const saved = r.waitForResponse((x) => x.url().includes("/sedens/room/consent") && x.request().method() === "POST");
await capture.click();
await saved;
await r.locator('[data-consent="scan_capture"][aria-checked="true"]').waitFor();
const startScan = r.locator('[data-start="demo_precomputed"]');
assert.ok(await startScan.count(), "the free demonstration host offers the demonstration scan (run the server with SEDENS_MODE=demo_free)");
await act(r, startScan, "scan/begin");
for (let view = 0; view < 4; view += 1) {
  await r.locator('[data-cam="take"]').click();
  await r.locator('[data-cam="use"]').click({ timeout: 20000 });
  await r.waitForTimeout(400);
}
await r.locator('[data-result="scan/continue"]').waitFor({ timeout: 60000 });
assert.match(await roomText(r), /demo precomputed analysis/i, "the demonstration scan result is labelled");
await shot(r, "12-room-scan-result", false);
await act(r, r.locator('[data-result="scan/continue"]'), "scan/continue");

// Choosing a session: the customer has programs, so the choice offers the next session and a personalized one.
const choice = await roomText(r);
assert.match(choice, /Continue your program/i);
assert.match(choice, /SEDENS Personalized Session/);
const hero = r.locator(".rj-hero");
assert.equal(await hero.locator(".rj-go").getAttribute("data-course"), currentPassport.courseId, "the room continues the program the Passport calls current");
assert.equal((await hero.locator(".rj-hero-title").innerText()).trim(), currentPassport.title);
assert.equal((await hero.locator(".rj-hero-line").innerText()).trim(), currentPassport.next, "the phone and the room name the next session the same way");
assert.ok((await hero.innerText()).includes(currentPassport.position), `the room numbers it "${currentPassport.position}", as the phone does`);
await shot(r, "13-room-choice", false);
await act(r, r.locator("[data-personal]"), "plan/personalized");
await r.locator('input[name="duration"][value="30"]').check({ force: true });
await r.locator('input[name="intensity"][value="moderate"]').check({ force: true });
await r.locator('input[name="goal"][value="general"]').check({ force: true });
await act(r, r.locator('#rj-setup button[type="submit"]'), "plan/request");
assert.match(await roomText(r), /SEDENS Standard/);
await act(r, r.locator("[data-accept]"), "plan/accept");

// 10-11. The player: instruction card or video, interactive anatomy.
await r.locator('.rp[data-mode="ready"]').waitFor();
await act(r, r.locator('.rp-controls [data-act="start"]'), "workout/start");
await r.locator('.rp[data-mode="exercise"]').waitFor();
assert.match(await r.locator("[data-count]").innerText(), /Exercise 1 of \d+/);
await playerShows(r, "personalized session");
await shot(r, "14-room-player-instruction-anatomy", false);
// Every control and the anatomy caption are on the 1920x1080 room display without scrolling.
for (const selector of ['.rp-controls-more [data-act="skip"]', '.rp-controls-more [data-act="end"]', '.rp-controls-more [data-act="unwell"]', "[data-anatomy-label]"]) {
  const spot = await r.locator(selector).boundingBox();
  assert.ok(spot && spot.y + spot.height <= 1080, `${selector} is on the first screen of the room display (bottom ${spot && Math.round(spot.y + spot.height)} px)`);
}
assert.doesNotMatch(await roomText(r), /There's no video/i, "a step without a film is a calm instruction card, not an apology");
// Interactive anatomy: open it full screen (the workout pauses), tap a structure, return (it continues).
await r.locator('.rp-controls [data-act="anatomy"]').click();
await r.locator(".rp-anatomy.is-expanded").waitFor();
await r.locator('.rp[data-mode="paused"]').waitFor();
await r.waitForTimeout(1500);
const frame = r.locator(".rp-anatomy-frame");
const box = await frame.boundingBox();
for (const [dx, dy] of [[0.5, 0.42], [0.5, 0.5], [0.48, 0.36], [0.53, 0.6], [0.47, 0.7]]) {
  await r.mouse.click(box.x + box.width * dx, box.y + box.height * dy);
  await r.waitForTimeout(800);
  if (await r.evaluate(() => window.__anatomy.some((m) => m.type === "sedens-anatomy-selection"))) break;
}
await anatomyShown(r, () => window.__anatomy.some((m) => m.type === "sedens-anatomy-selection"), "a tap selects a structure");
assert.match(await r.locator("[data-anatomy-selection]").innerText(), /^Highlighted in the body: /, "the selected structure is named");
await shot(r, "15-room-anatomy-selected", false);
await r.locator("[data-anatomy-return]").click();
await r.locator('.rp[data-mode="exercise"]').waitFor();

// One exercise for real: it runs to its end and the next starts by itself.
await r.locator('[data-overlay][data-kind="transition"]').waitFor({ timeout: 150000 });
await r.locator("[data-count]").filter({ hasText: /Exercise 2 of/ }).waitFor({ timeout: 30000 });
await act(r, r.locator('.rp-controls-more [data-act="skip"]'), "workout/step"); // exercise 2 is skipped
await r.locator("[data-count]").filter({ hasText: /Exercise 3 of/ }).waitFor();
await finishWorkout(r); // the rest is fast-forwarded the way the room journey test does
console.log("PASS 10-11: a personalized SEDENS Standard session with an exercise performed to its end, one skipped, the instruction card and the interactive anatomy (a structure selected)");

// 12. Complete the workout and answer the effort question.
const personalDone = await completion(r);
assert.ok(personalDone.completed >= 2 && personalDone.skipped === 1, `the completion screen counts: ${JSON.stringify(personalDone)}`);
const doneText = await roomText(r);
assert.match(doneText, /Session complete/i);
assert.match(doneText, /Saved to your Fitness Passport/);
await shot(r, "16-room-complete", false);
await calmRoom(r, "complete");
await giveFeedback(r, 6);
assert.match(await roomText(r), /Another session/);
const savedText = await roomText(r);
assert.ok(savedText.includes(`Next time: ${currentPassport.title} — ${currentPassport.next}`), `the saved screen says what comes next time: ${savedText.slice(-400)}`);
assert.match(savedText, /Personalized sessions are saved to your Passport and do not count toward a program\./);
await shot(r, "17-room-feedback-saved", false);
await calmRoom(r, "saved");
console.log("PASS 12: the session is completed and the effort is reported");

// ======================================================================================
// 13-16. The Passport again, on the phone
// ======================================================================================
phone = await open({ viewport: PHONE, name: "phone-2" });
p = phone.page;
await signIn(p, "student");
await passportPage(p, "passport", "Fitness Passport");
await p.locator("#pp-latest").waitFor();
const after1 = await totals(p);
await shot(p, "20-phone-overview-after-visit");
const top1 = await topVisit(p);
sameVisit(top1, { ...personalDone, effort: "6" }, historyBefore, "personalized session");
assert.match(top1.text, /SEDENS Standard session/);
assert.doesNotMatch(top1.text, /Demo data/, "the new visit is a real room visit, not seeded history");
await shot(p, "21-phone-history-new-visit-first");
console.log("PASS 13-14: the new completed visit is first in the history, with the room's counts and the reported effort");

assert.equal(after1.visits, start.visits + 1, "completed visits +1");
assert.ok(after1.minutes >= start.minutes, `exercise minutes are not lower (${start.minutes} -> ${after1.minutes})`);
assert.equal(after1.effort, "6 / 10", "the last reported effort is the new one");
const programs1 = await programs(p);
for (const [title, card] of Object.entries(seeded)) assert.deepEqual([programs1[title].done, programs1[title].total], [card.done, card.total], `${title}: a personalized session is not a program session`);
await shot(p, "22-phone-programs-after-visit");
// The new visit's own details: the performed and skipped exercises.
await passportPage(p, "passport/history", "Workout history");
await p.locator("#pp-history-list > article").first().getByRole("link", { name: /View details/ }).click();
await p.locator(".pp-steps").waitFor();
const newMarks = await p.locator(".pp-step").evaluateAll((rows) => rows.map((row) => row.dataset.state));
assert.equal(newMarks.filter((m) => m === "completed").length, personalDone.completed);
assert.equal(newMarks.filter((m) => m === "skipped").length, 1);
assert.match(await mainText(p), /Reported effort\s+6 out of 10/);
await shot(p, "23-phone-new-visit-details");
console.log(`PASS 15: completed visits ${start.visits} -> ${after1.visits}, exercise minutes ${start.minutes} -> ${after1.minutes}, program progress shown`);

// ======================================================================================
// The coach's program, then the professor's, each in a new room visit
// ======================================================================================
const catalog = await p.evaluate(async () => (await (await fetch("/sedens/courses/catalog")).json()).items);
const coachId = catalog.find((c) => c.title === "4-Week Core Foundations").id;
const professorId = catalog.find((c) => c.title === "Mobility Foundations").id;
let lastTop = top1;
let lastVisits = after1.visits;
let programNow = programs1;
let mediaUrl = "";

/** The coach publishes version 2 of 4-Week Core Foundations (the second session gets a new title) and SEDENS reviews it,
 * through the Creator Studio and review routes. The customer is enrolled in version 1 and must stay on it. */
const REVISED = "Bridge and twist (revised)";
async function publishVersion2(courseId) {
  const post = (page, path, body) => page.evaluate(async ([u, b]) => {
    const response = await fetch(u, { method: "POST", headers: { "Content-Type": "application/json", "X-Sedens-Request": "1" }, body: JSON.stringify(b) });
    return { status: response.status, json: await response.json().catch(() => ({})) };
  }, [path, body]);
  const get = (page, path) => page.evaluate(async (u) => (await fetch(u)).json(), path);
  const creator = await open({ viewport: DESKTOP, name: "creator" });
  const c = creator.page;
  await signIn(c, "creator");
  let editor = await get(c, `/sedens/creator/course?id=${courseId}`);
  assert.equal(editor.published_version, 1, "the coach's program starts at version 1");
  const module = editor.modules[1];
  const session = module.sessions[0];
  assert.equal(session.title, "Bridge and twist");
  const saved = await post(c, "/sedens/creator/course/session", {
    course_id: courseId, revision: editor.revision, module_id: module.id, id: session.id, title: REVISED,
    summary: session.summary || "", estimated_minutes: session.estimated_minutes || 0 });
  assert.equal(saved.status, 200, `the coach renames the session: ${JSON.stringify(saved.json)}`);
  const submitted = await post(c, "/sedens/creator/course/submit", { id: courseId, revision: saved.json.revision, note: "Version 2: one session renamed." });
  assert.equal(submitted.status, 200, `version 2 is submitted: ${JSON.stringify(submitted.json)}`);
  await creator.ctx.close();

  const reviewer = await open({ viewport: DESKTOP, name: "reviewer" });
  const v = reviewer.page;
  await signIn(v, "reviewer");
  const waiting = await get(v, `/sedens/review/course?id=${courseId}&version=2`);
  assert.equal(waiting.state, "submitted");
  for (const right of waiting.media_rights || []) {
    if (right.review_status === "approved") continue;
    const media = await post(v, "/sedens/review/media/decide", { object_id: right.object_id, decision: "approved", note: "Demonstration review." });
    assert.equal(media.status, 200, `media rights approved: ${JSON.stringify(media.json)}`);
  }
  const checklist = Object.fromEntries(waiting.checklist_items.map((item) => [item, { result: "pass", note: "Demonstration review." }]));
  const decided = await post(v, "/sedens/review/course/decide", {
    course_id: courseId, version: 2, decision: "approved", snapshot_sha256: waiting.snapshot_sha256, checklist,
    comment: "Demonstration review: fictional content." });
  assert.equal(decided.status, 200, `version 2 is approved: ${JSON.stringify(decided.json)}`);
  assert.equal(decided.json.published_version, 2, "version 2 is now the published version");
  await reviewer.ctx.close();
}

async function courseVisit(title, courseId, tag, effort, newer = "") {
  await endVisit(r);
  await identify(r);
  await readiness(r);
  await act(r, r.locator("[data-skip]"), "scan/skip");
  assert.equal(await journeyState(r), "session_choice");
  const before = programNow[title];
  assert.ok(before.next, `${title}: the Passport names the next session`);
  const choiceCard = r.locator(`[data-course="${courseId}"]`);
  assert.equal(await choiceCard.count(), 1, `${title}: offered once in the room`);
  assert.notEqual(await choiceCard.getAttribute("data-session"), null, "the next session is the one started");
  await shot(r, `${tag}-room-choice`, false);
  await act(r, choiceCard, "course/start");
  await r.locator('.rp[data-mode="ready"]').waitFor();
  const workout = (await journeyView(r)).workout;
  assert.equal(workout.kind, "course");
  assert.equal(workout.course_version, before.version, `${title}: the room plays the version the customer is pinned to`);
  assert.match(await r.locator("[data-ready-label]").innerText(), new RegExp(`^Version ${before.version}$`));
  if (newer) {
    // A newer version is published, and this customer is still on the one they enrolled in.
    assert.equal(before.version, 1);
    assert.notEqual(workout.course_version, 2, `${title}: the room does not silently play the newer version`);
    const visible = (await roomText(r)) + JSON.stringify(await journeyView(r));
    assert.ok(!visible.includes(newer), `${title}: the room shows version 1's session title, not "${newer}"`);
  }
  await act(r, r.locator('.rp-controls [data-act="start"]'), "workout/start");
  await r.locator('.rp[data-mode="exercise"]').waitFor();
  await playerShows(r, title);
  if (!mediaUrl) {
    const view = JSON.stringify(await journeyView(r));
    mediaUrl = (view.match(/\/sedens\/media\/file\?id=[0-9a-f]{32}/) || [])[0] || "";
  }
  await shot(r, `${tag}-room-player`, false);
  await finishWorkout(r);
  const done = await completion(r);
  assert.equal(done.skipped, 0);
  assert.match(await roomText(r), /Course progress/);
  await shot(r, `${tag}-room-complete`, false);
  await calmRoom(r, tag);
  await giveFeedback(r, effort);
  assert.match(await roomText(r), /Another session/);
  // The Passport on the phone.
  const top = await topVisit(p);
  sameVisit(top, { ...done, effort: String(effort) }, lastTop, title);
  assert.match(top.text, new RegExp(escapeRe(title)));
  assert.match(top.text, new RegExp(escapeRe(before.next)), `${title}: the visit is the session the Passport named as next`);
  await passportPage(p, "passport", "Fitness Passport");
  const totalsNow = await totals(p);
  assert.equal(totalsNow.visits, lastVisits + 1, `${title}: completed visits +1`);
  lastVisits = totalsNow.visits;
  const now = await programs(p);
  assert.equal(now[title].done, before.done + 1, `${title}: progress +1`);
  assert.equal(now[title].total, before.total);
  assert.equal(now[title].version, before.version, `${title}: still the pinned version`);
  for (const [other, card] of Object.entries(programNow)) if (other !== title) assert.equal(now[other].done, card.done, `${other} did not move`);
  await shot(p, `${tag}-phone-programs`);
  await passportPage(p, "passport/history", "Workout history");
  await shot(p, `${tag}-phone-history`);
  lastTop = top;
  programNow = now;
  console.log(`PASS ${tag}: ${title} next session (${before.next}) played in the room and completed; Passport progress ${before.done} -> ${now[title].done} of ${now[title].total} on version ${before.version}`);
}
await publishVersion2(coachId);
{
  // The Passport still says version 1 and names version 1's session.
  const pinned = await programs(p);
  const core = pinned["4-Week Core Foundations"];
  assert.equal(core.version, 1, "the Passport says the customer is on version 1");
  assert.equal(core.total, 2, "version 1's two sessions");
  assert.ok(!core.text.includes(REVISED) && /Bridge and twist/.test(core.text), "the Passport names version 1's session");
  assert.match(core.text, /A newer revision is never applied unless you choose it\./);
  await shot(p, "29-phone-programs-version2-published");
  programNow = pinned;
}
await courseVisit("4-Week Core Foundations", coachId, "30-coach", 5, REVISED);
await courseVisit("Mobility Foundations", professorId, "40-professor", 4);

// ======================================================================================
// 16. The words, in English and Korean, on every Passport page
// ======================================================================================
const checkedEn = await sweep(p, "en", lastTop.href);
await passportPage(p, "passport/scans", "Room scans");
assert.ok(/Comparing your two latest scans|There isn't enough comparable information yet|No room scans yet/.test(await mainText(p)), "the scans page compares or explains why it does not");
await shot(p, "50-phone-scans-after-room-scan");
const korean = await open({ viewport: PHONE, lang: "ko", name: "phone-ko" });
await signIn(korean.page, "student");
await passportPage(korean.page, "passport", "피트니스 패스포트");
assert.match(await mainText(korean.page), /시연 데이터/);
await shot(korean.page, "51-phone-overview-ko");
const checkedKo = await sweep(korean.page, "ko", lastTop.href);
await passportPage(korean.page, "passport/history", "운동 기록");
await shot(korean.page, "52-phone-history-ko");
await korean.ctx.close();
console.log(`PASS 16: no score, calorie, improvement, injury, fitness-age, strength-gain or diagnosis wording on ${checkedEn} English and ${checkedKo} Korean Passport pages, nor on the room's screens after each workout (English and Korean)`);

// ======================================================================================
// 17. Outside the room nothing plays
// ======================================================================================
const probe = (method, path, body) => p.evaluate(async ([m, u, b]) => {
  const response = await fetch(u, {
    method: m, headers: { "Content-Type": "application/json", "X-Sedens-Request": "1" }, body: b ? JSON.stringify(b) : undefined,
  });
  let json = {};
  try { json = await response.json(); } catch { /* no body */ }
  return { status: response.status, code: json.code || "", steps: Boolean(json.steps || json.workout || json.journey || json.session) };
}, [method, path, body]);
const refused = [
  ["GET", "/sedens/room/session", undefined],
  ["GET", "/sedens/room/journey", undefined],
  ["GET", "/sedens/room/courses", undefined],
  ["POST", "/sedens/room/course/session", { course_id: coachId }],
  ["POST", "/sedens/room/course/complete", { course_id: coachId }],
  ["POST", "/sedens/room/journey/course/start", { course_id: coachId }],
  ["POST", "/sedens/room/journey/workout/start", {}],
  ["POST", "/sedens/room/journey/workout/step", { position: 0, outcome: "completed" }],
  ["POST", "/sedens/room/journey/plan/personalized", {}],
];
for (const [method, path, body] of refused) {
  const answer = await probe(method, path, body);
  assert.deepEqual([answer.status, answer.code, answer.steps], [403, "device_not_paired", false], `${method} ${path} from the phone's session: ${JSON.stringify(answer)}`);
}
assert.match(mediaUrl, /^\/sedens\/media\/file\?id=[0-9a-f]{32}$/, "the coach's program has a picture to try (found while it played in the room)");
const inRoom = await r.evaluate(async (u) => {
  const response = await fetch(u);
  return [response.status, response.headers.get("content-type") || "", (await response.arrayBuffer()).byteLength];
}, mediaUrl);
assert.equal(inRoom[0], 200, `the same file is served inside the authorized room (${JSON.stringify(inRoom)})`);
assert.match(inRoom[1], /^(image|video)\//);
assert.ok(inRoom[2] > 0, "and it has content");
const media = await probe("GET", mediaUrl);
assert.deepEqual([media.status, media.code], [404, "media_not_found"], "the same picture is not served outside the room");
const detailOutside = await p.evaluate(async (id) => (await (await fetch(`/sedens/courses/detail?id=${id}`)).json()), coachId);
assert.deepEqual(detailOutside.play_here, { ok: false, reason: "room_only" }, "the program's own page says playback is room-only");
assert.equal(JSON.stringify(detailOutside).includes('"steps":['), false, "no session steps outside the room");
// The Passport has no play or start control anywhere.
for (const [hash, heading] of [["passport", "Fitness Passport"], ["passport/programs", "Programs"], ["passport/history", "Workout history"]]) {
  await passportPage(p, hash, heading);
  assert.equal(await p.getByRole("button", { name: /^(start|play|begin|resume|continue)/i }).count(), 0, `${hash}: no play or start button`);
  assert.equal(await p.getByRole("link", { name: /^(start|play|begin|resume|continue)/i }).count(), 0, `${hash}: no play or start link`);
  assert.equal(await p.locator("video, audio").count(), 0, `${hash}: no player`);
}
console.log(`PASS 17: ${refused.length} room routes refused for the phone (403 device_not_paired), the program's picture 404 media_not_found, play_here room_only, no play or start control in the Passport`);

// The customer's own records of this run (the usage page below must agree with them).
const mine = (await p.evaluate(async () => (await (await fetch("/sedens/passport/history?limit=30")).json()).items || []))
  .filter((item) => item.kind === "room" && item.origin !== "demo_seed");
await phone.ctx.close();

// ======================================================================================
// The facility administrator's usage page
// ======================================================================================
const adminSession = await open({ viewport: DESKTOP, name: "admin" });
const a = adminSession.page;
await signIn(a, "admin");
await a.goto(`${base}/#/facility/usage`);
await a.reload();
await a.locator("main h1", { hasText: "Facility usage" }).waitFor();
await a.locator(".sd-tiles").waitFor();
const tiles = await a.evaluate(() => Object.fromEntries([...document.querySelectorAll(".sd-tile")].map((t) => [t.querySelector("dt").textContent.trim(), t.querySelector("dd").textContent.trim()])));
// What this run did: three room visits, each with one completed workout (the seeded history is not counted).
assert.equal(mine.length, 3, "this run made three room visits");
const exact = mine.every((item) => Number.isFinite(item.active_seconds));
const seconds = mine.reduce((sum, item) => sum + (exact ? item.active_seconds : 60 * item.active_minutes), 0);
assert.equal(tiles["Billable visits"], "3", "billable visits = the completed room visits of this run (the seeded history is not counted)");
assert.equal(tiles["Room visits"], "3");
assert.equal(tiles["Completed workouts"], "3");
assert.equal(tiles["Workouts not finished"], "0");
// The Passport gives each workout's active time in seconds (and in rounded minutes); the usage page sums the seconds.
assert.ok(Math.abs(Number(tiles["Exercise minutes"]) - Math.floor(seconds / 60 + 0.5)) <= (exact ? 0 : 2), `exercise minutes = the active time of the three workouts (${seconds} s)`);
assert.equal(tiles["Licensed rooms"], "1", "one room screen was active");
assert.equal(tiles["Returning customers"], "1");
assert.equal(tiles["Scan retakes"], "0");
// The two breakdowns are fully determined by this run: one personalized Standard session, one coach course and one
// professor course (workouts started by program), each with a visit length given by its active seconds.
const bars = (heading) => a.locator("section.sd-panel", { has: a.locator("h2", { hasText: heading }) }).locator(".sd-bars li").evaluateAll((items) =>
  Object.fromEntries(items.map((li) => [li.querySelector(".sd-bar-label").textContent.trim(), parseInt(li.querySelector(".sd-bar-count").textContent, 10)])));
assert.deepEqual(await bars(/^Programs used$/), {
  "SEDENS Standard": 1, "Coach courses": 1, "Professor courses": 1, "Expert courses": 0, "SEDENS editorial courses": 0, "Other courses": 0,
}, "programs used = what this run started");
const band = (item) => { const minutes = (Number.isFinite(item.active_seconds) ? item.active_seconds : 60 * item.active_minutes) / 60;
  return minutes < 10 ? "Under 10 min" : minutes < 20 ? "10 to 20 min" : minutes < 30 ? "20 to 30 min" : "30 min or more"; };
const expectedBands = { "Under 10 min": 0, "10 to 20 min": 0, "20 to 30 min": 0, "30 min or more": 0 };
for (const item of mine) expectedBands[band(item)] += 1;
assert.deepEqual(await bars(/^Visit length$/), expectedBands, "visit length = the active time of the three visits");
const usageText = await mainText(a);
assert.match(usageText, /\b(January|February|March|April|May|June|July|August|September|October|November|December) 20\d\d\b/, "the current month is shown in English");
assert.match(usageText, /DEMONSTRATION/);
assert.match(usageText, /Demonstrations are never invoiced/);
// The definitions.
assert.match(usageText, /What counts as a billable visit/);
assert.match(usageText, /One room visit that started in this month and in which a workout was completed with at least one step done\./);
assert.match(usageText, /What does not count/);
assert.match(usageText, /Sample history added for a demonstration\./, "the seeded history is said not to count");
assert.match(usageText, /A second workout in the same visit\./);
assert.match(usageText, /A visit counts once, however many workouts were completed in it\./);
// The fee simulation: rooms x 99,000 won + billable visits x 250 won, not an invoice, VAT excluded.
const money = (text) => Number(text.replace(/[^\d]/g, ""));
const sim = await a.locator(".sd-sim").innerText();
assert.match(sim, /Simulation — not an invoice\. VAT excluded\. No payment is taken\./);
const rows = await a.locator(".sd-sim-table tbody tr").evaluateAll((trs) => trs.map((tr) => [tr.querySelector("th").textContent, tr.querySelector("td").textContent]));
assert.match(rows[0][0], /Rooms: 1 × ₩99,000 a month/);
assert.match(rows[1][0], /Billable visits: 3 × ₩250/);
assert.equal(money(rows[0][1]), 1 * 99000);
assert.equal(money(rows[1][1]), 3 * 250);
assert.equal(money(rows[2][1]), 1 * 99000 + 3 * 250, "total = rooms x 99,000 + billable visits x 250");
assert.equal(money(rows[2][1]), 99750);
assert.match(sim, /Licensed rooms × monthly room price \+ billable visits × price per visit/);
assert.doesNotMatch(sim, /VAT included/, "VAT is never presented as included");
assert.doesNotMatch(usageText, /Sarah|DEMO-1001|Kim\b/, "totals only: no customer names");
await shot(a, "60-facility-usage");
console.log(`PASS usage: billable 3, room visits 3, completed 3, minutes ${tiles["Exercise minutes"]}, rooms 1, simulation ₩99,000 + 3 × ₩250 = ₩99,750 (not an invoice, VAT excluded), definitions shown, seeded history not counted`);
await adminSession.ctx.close();

// Korean usage page.
const adminKo = await open({ viewport: DESKTOP, lang: "ko", name: "admin-ko" });
await signIn(adminKo.page, "admin");
await adminKo.page.goto(`${base}/#/facility/usage`);
await adminKo.page.reload();
await adminKo.page.locator("main h1").first().waitFor();
await adminKo.page.locator(".sd-tiles").waitFor();
const usageKo = await mainText(adminKo.page);
assert.match(usageKo, /\d{4}년 \d{1,2}월/);
assert.equal(await adminKo.page.locator(".sd-sim-table tbody tr").count(), 3);
const rowsKo = await adminKo.page.locator(".sd-sim-table tbody tr td").allInnerTexts();
assert.equal(money(rowsKo[2]), 99750, "the Korean page shows the same simulation");
assert.match(usageKo, /₩99,750/);
assert.doesNotMatch(usageKo, /\b(Billable visits|Simulation|not an invoice)\b/, "no English left on the Korean usage page");
await shot(adminKo.page, "61-facility-usage-ko");
await adminKo.ctx.close();
console.log("PASS usage (Korean): the same numbers in Korean");

await room.ctx.close();
assert.deepEqual(errors, [], "no page or console errors");
await browser.close();
console.log("PASS phase 4 journey: Passport on a phone -> the AI Private Room -> Passport; coach and professor programs; facility usage");
