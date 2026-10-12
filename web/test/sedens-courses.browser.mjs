/** Local end-to-end check of the Phase 2 course journey and its access rules, in a browser.
 * Usage: MOTION_BASE_URL=http://127.0.0.1:8145 CHROMIUM=/path/to/chrome \
 *   [SEDENS_SHOTS=/path/to/folder] node test/sedens-courses.browser.mjs
 *
 * 1. Coach Minji Lee builds a guided course in the Creator Studio: module, session,
 *    ordered steps, a picture uploaded with its rights, anatomy, free for the demo
 *    facility, submitted. A SEDENS reviewer approves it, the facility admin enables and
 *    includes it, and a customer sees it as included.
 * 2. The fictional professor builds a 29,000 won course, it is approved and enabled; the
 *    customer buys it in a DEMO purchase and sees it and its progress outside the room,
 *    with no way to launch the workout.
 * 3. Access checks: another visitor's demonstration, an outsider and the wrong roles.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const base = process.env.MOTION_BASE_URL || "http://127.0.0.1:8145";
const shots = process.env.SEDENS_SHOTS || "";
const key = randomBytes(16).toString("hex");
const browser = await chromium.launch({
  ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}),
  args: ["--no-sandbox"],
});
const errors = [];
const stamp = Date.now().toString(36);
const guidedTitle = `Morning Mobility ${stamp}`;
const paidTitle = `Hip Mobility Lab ${stamp}`;

// A tiny valid PNG (1x1) for the upload.
const picture = join(mkdtempSync(join(tmpdir(), "sedens-")), "cue.png");
writeFileSync(picture, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64"));

async function person(role, { demoKey = key, lang = "en", viewport = { width: 1280, height: 900 } } = {}) {
  const ctx = await browser.newContext({ viewport, locale: lang === "en" ? "en-US" : "ko-KR" });
  await ctx.addInitScript(([k, l]) => {
    sessionStorage.setItem("motion-demo-key", k);
    localStorage.setItem("sedens-lang", l);
  }, [demoKey, lang]);
  const page = await ctx.newPage();
  page.on("pageerror", (error) => errors.push(`${role}: ${error.message}`));
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto(base + "/");
  // The server allows ten demonstration entries a minute from one address; this journey
  // makes eight, so a second run straight after the first waits out the minute once.
  const settled = () => page.waitForFunction(() => {
    const status = document.querySelector("#demo-status")?.textContent || "";
    return !status || /Too many attempts|시도가 너무 많습니다/.test(status);
  });
  const said = () => page.evaluate(() => document.querySelector("#demo-status")?.textContent || "");
  await page.locator(`[data-demo="${role}"]`).click();
  await settled();
  if (/Too many attempts|시도가 너무 많습니다/.test(await said())) {
    await page.waitForTimeout(61_000);
    await page.locator(`[data-demo="${role}"]`).click();
    await settled();
  }
  const status = await said();
  if (status) throw new Error(`${role} could not enter the demonstration: ${status}`);
  await page.waitForLoadState("networkidle");
  return page;
}
const shot = async (page, name) => shots && page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
const go = async (page, hash) => {
  // The same address again is no navigation at all: load it afresh instead.
  if (page.url() === base + "/" + hash) await page.reload();
  else await page.goto(base + "/" + hash);
  await page.waitForLoadState("networkidle");
};
const button = (page, name) => page.getByRole("button", { name, exact: true });
// A hash change renders after the navigation settles: wait for the page to say it.
const says = (page, pattern) => page.locator("main").filter({ hasText: pattern }).waitFor({ timeout: 10000 });

// -- 1. Coach Minji Lee: a guided course ------------------------------------------------
const coach = await person("creator");
await go(coach, "#/creator");
await coach.getByRole("heading", { name: "Creator Studio" }).waitFor();
assert.equal(await coach.getByLabel("Public name").inputValue(), "Minji Lee");
await shot(coach, "p2-01-studio-home");

// Media library: upload a picture with its rights.
await go(coach, "#/creator/media");
await coach.locator('#upload-form input[type="file"]').setInputFiles(picture);
await coach.getByLabel("Original creator").fill("Minji Lee");
const upload = coach.locator("#upload-form [data-needs-attest]");
assert.equal(await upload.isDisabled(), true, "upload waits for the attestation");
await coach.locator("#upload-form [data-attest]").check();
await upload.click();
await coach.locator("#upload-form [data-status]").filter({ hasText: /cue/ }).waitFor();
await shot(coach, "p2-02-media-library");

// New course wizard.
await go(coach, "#/creator/courses/new");
await coach.locator('input[name="course_type"][value="guided_training"]').check();
await button(coach, "Continue").click();
await coach.getByLabel("Title", { exact: true }).fill(guidedTitle);
await coach.locator('textarea[name="description"]').fill("Gentle breathing and core work for a calm start.");
await button(coach, "Create course").click();
await coach.locator("#course-title").filter({ hasText: guidedTitle }).waitFor();
const guidedId = coach.url().split("/").pop().split("?")[0];

// Structure: a module and a session.
await coach.getByRole("tab", { name: "Structure" }).click();
await coach.getByLabel("New module title").fill("Week 1");
await button(coach, "Add module").click();
await coach.getByLabel("New session title").fill("Breath and brace");
await button(coach, "Add session").click();
await coach.getByRole("link", { name: /Breath and brace/ }).click();
await coach.locator("#add-step").waitFor();

// Two ordered steps from the exercise library.
for (const [i, query] of ["breathing", "dead bug"].entries()) {
  await coach.locator('[data-search="add"]').fill(query);
  await coach.locator('[data-act="add-search"]').click();
  await coach.locator('#add-step [data-act="add-step"]').first().click();
  await coach.locator("[data-step]").nth(i).waitFor();
}
assert.equal(await coach.locator("[data-step]").count(), 2);

// First step: the uploaded picture.
const first = coach.locator("[data-step]").first();
const editForm = first.locator('form[data-form="step"]');
if (!(await editForm.isVisible())) await first.locator("summary").first().click();
const pictureChoice = editForm.locator('select[name="image_media_id"]');
const optionValue = await pictureChoice.locator("option", { hasText: "cue" }).first().getAttribute("value");
await pictureChoice.selectOption(optionValue);
await editForm.getByRole("button", { name: "Save step" }).click();
await first.locator("form [data-status]").filter({ hasText: /Saved/ }).waitFor();

// First step: anatomy (the exercise's own structures, saved as reviewed).
await first.locator("summary", { hasText: "Anatomy" }).click();
await first.locator('[data-act="moment-add"]').click();
await first.locator('[data-act="anatomy-save"]').click();
await first.locator("[data-anatomy] [data-status]").filter({ hasText: /Saved/ }).waitFor();
await shot(coach, "p2-03-session-editor");

// Access: free for the demonstration facility, then submit.
await go(coach, `#/creator/courses/${guidedId}?tab=access`);
await coach.locator('input[name="distribution"][value="selected_facilities"]').check();
await coach.locator('input[name="include_0"]').check();
await coach.locator('input[name="free_0"]').check();
await button(coach, "Save who can offer it & price").click();
await coach.locator('#panel-access [data-status]').filter({ hasText: /Saved/ }).waitFor();
await coach.getByRole("tab", { name: "Submit for review" }).click();
await button(coach, "Submit for SEDENS review").click();
await coach.locator("#panel-submit [data-status]").filter({ hasText: /./ }).waitFor();
await shot(coach, "p2-04-submitted");

// -- SEDENS review --------------------------------------------------------------------------
async function approve(reviewer, title) {
  await go(reviewer, "#/review");
  await reviewer.getByRole("link", { name: new RegExp(title) }).click();
  await reviewer.locator("#decide").waitFor();
  for (const fieldset of await reviewer.locator("#decide .sd-checklist fieldset").all())
    await fieldset.locator('input[value="pass"]').check();
  await reviewer.locator('#decide input[name="decision"][value="approved"]').check();
  const files = reviewer.locator("form.sd-rights");
  if (await files.count()) {
    // No file reaches customers before its rights are accepted: the decision waits.
    await reviewer.locator("#decide button.sd-primary").click();
    await reviewer.locator("#decide .sd-error").filter({ hasText: /rights of every file/ }).waitFor();
    for (const form of await files.all()) {
      await form.locator('[data-rights="approved"]').click();
      await form.locator("[role=status]").filter({ hasText: /./ }).waitFor();
    }
  }
  await reviewer.locator("#decide button.sd-primary").click();
  await reviewer.locator("main .sd-notice").filter({ hasText: /Published|published/ }).first().waitFor();
}
const reviewer = await person("reviewer");
await approve(reviewer, guidedTitle);
await shot(reviewer, "p2-05-review-decided");

// -- Facility admin enables and includes it -------------------------------------------------
async function facilityToggle(admin, title, name) {
  await go(admin, "#/facility/courses");
  const row = admin.locator("section[data-course]", { has: admin.getByRole("heading", { name: title }) });
  await row.locator(`input[name="${name}"]`).check();
  await row.locator("[role=status]").filter({ hasText: /Saved/ }).waitFor();
}
const admin = await person("admin");
await facilityToggle(admin, guidedTitle, "enabled");
await facilityToggle(admin, guidedTitle, "included");
await shot(admin, "p2-06-facility-courses");

// -- The customer sees it as included --------------------------------------------------------
const customer = await person("student");
await go(customer, "#/courses");
const card = customer.locator("article", { has: customer.getByRole("heading", { name: guidedTitle }) });
assert.match(await card.textContent(), /Included with your membership/);
await shot(customer, "p2-07-catalog");

// -- 2. The fictional professor's 29,000 won course ----------------------------------------
const professor = await person("professor");
await go(professor, "#/creator/courses/new");
await professor.locator('input[name="course_type"][value="guided_training"]').check();
await button(professor, "Continue").click();
await professor.getByLabel("Title", { exact: true }).fill(paidTitle);
await button(professor, "Create course").click();
await professor.locator("#course-title").filter({ hasText: paidTitle }).waitFor();
const paidId = professor.url().split("/").pop().split("?")[0];
await professor.getByRole("tab", { name: "Structure" }).click();
await professor.getByLabel("New module title").fill("Hips");
await button(professor, "Add module").click();
await professor.getByLabel("New session title").fill("Open the hips");
await button(professor, "Add session").click();
await professor.getByRole("link", { name: /Open the hips/ }).click();
await professor.locator('[data-search="add"]').fill("clam");
await professor.locator('[data-act="add-search"]').click();
await professor.locator('#add-step [data-act="add-step"]').first().click();
await professor.locator("[data-step]").first().waitFor();
await go(professor, `#/creator/courses/${paidId}?tab=access`);
await professor.locator('input[name="distribution"][value="marketplace"]').check();
await professor.locator('input[name="price_type"][value="paid"]').check();
await professor.locator("[data-amount]").fill("29000");
assert.equal(await professor.locator('select[name="sale_state"]').inputValue(), "active", "a course made paid is offered on sale");
await button(professor, "Save who can offer it & price").click();
await professor.locator('#panel-access [data-status]').filter({ hasText: /Saved/ }).waitFor();
assert.match(await professor.textContent("#course-head"), /29,000/);
await professor.getByRole("tab", { name: "Submit for review" }).click();
await button(professor, "Submit for SEDENS review").click();
await professor.locator("#panel-submit [data-status]").filter({ hasText: /./ }).waitFor();
await approve(reviewer, paidTitle);
await facilityToggle(admin, paidTitle, "enabled");

// The customer buys it in a demonstration purchase.
await go(customer, `#/courses/${paidId}`);
await button(customer, "Buy (demonstration)").click();
const confirm = customer.locator("#confirm");
assert.match(await confirm.textContent(), /DEMO — no real payment occurred\./);
assert.match(await confirm.textContent(), /No card details/);
await shot(customer, "p2-08-demo-purchase-confirm");
await customer.locator("#buy-confirm").click();
await customer.locator("#flash").filter({ hasText: "DEMO — no real payment occurred." }).waitFor();
const detail = await customer.textContent("main");
assert.match(detail, /play only in an AI Private Room|only in an AI Private Room/);
assert.equal(await customer.getByRole("button", { name: /start workout|play|launch/i }).count(), 0, "no way to launch outside a room");
await shot(customer, "p2-09-purchased");
await go(customer, "#/my");
await says(customer, new RegExp(paidTitle));
await shot(customer, "p2-10-my-courses");
// Outside a room the guided session itself is refused by the server.
const outside = await customer.evaluate(async (course) => {
  const response = await fetch("/sedens/room/course/session", {
    method: "POST", headers: { "Content-Type": "application/json", "X-Sedens-Request": "1" },
    body: JSON.stringify({ course_id: course, session_id: "any" }),
  });
  return response.status;
}, paidId);
assert.equal(outside, 403);

// -- 3. Access checks ----------------------------------------------------------------------
const stranger = await person("student", { demoKey: randomBytes(16).toString("hex") });
for (const id of [guidedId, paidId]) {
  await go(stranger, `#/courses/${id}`);
  await says(stranger, /does not exist|not available/i); // another visitor's course stays hidden
}
const media = await coach.evaluate(async () => (await (await fetch("/sedens/creator/studio")).json()).media.map((m) => m.id));
for (const id of media) {
  const status = await stranger.evaluate(async (object) => (await fetch("/sedens/media/file?id=" + encodeURIComponent(object))).status, id);
  assert.equal(status, 404, "course files stay private");
}
await go(customer, "#/review");
await says(customer, /SEDENS reviewers/);
await go(customer, "#/facility/courses");
await says(customer, /facility's administrator/);
await go(professor, `#/creator/courses/${guidedId}`);
await says(professor, /does not exist/i); // a creator never opens another creator's course

// The Korean catalog and a phone-sized Creator Studio render too.
const korean = await person("student", { lang: "ko" });
await go(korean, "#/courses");
await korean.getByRole("heading", { name: "코스", exact: true }).waitFor();
await shot(korean, "p2-11-catalog-ko");
const phone = await person("creator", { viewport: { width: 390, height: 844 } });
await go(phone, `#/creator/courses/${guidedId}?tab=versions`);
await phone.locator("#panel-versions").filter({ hasText: /./ }).waitFor();
await shot(phone, "p2-12-studio-phone");

assert.deepEqual(errors, []);
await browser.close();
console.log("Phase 2 course journey passed.");
