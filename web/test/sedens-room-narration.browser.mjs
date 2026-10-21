/** Timed narration, from the Creator Studio to the room.
 *
 * In a demonstration organization a creator builds a three-step course session in the Studio:
 *   step 1: four timed lines (two spoken, two subtitles only) and an uploaded MP3 narration recording
 *           (a short ffmpeg tone), uploaded through the step editor with the rights attestation;
 *   step 2: three timed lines (two spoken) and no recording, so the browser's speech is used;
 *   step 3: two lines and an M4A recording (AAC): a browser without an AAC decoder cannot play it, and
 *           the room falls back to speech.
 * The Studio refuses two spoken lines less than four seconds apart, inline. The demonstration reviewer
 * accepts the recordings' rights and approves the version; the facility includes it; the customer enrols.
 * In the room (speech is replaced by a recording stub, so every utterance is counted):
 *   - step 1: the <audio> element plays the creator's file along the step clock, no utterance is made,
 *     the subtitle changes at the cue times, the recording is paused with the workout and resumes in step,
 *     M mutes it (and again unmutes), the voice slider sets its volume, Subtitles hides and shows the caption;
 *   - step 2: spoken lines are spoken, subtitle-only lines are not; nothing is spoken while paused or muted,
 *     and the voice volume set in step 1 is still in force;
 *   - step 3: a recording the browser cannot decode falls back to speech;
 *   - the sound settings survive a page reload, and the Korean room shows Korean labels.
 *
 * Needs the free demonstration host's modes: start the server with SEDENS_MODE=demo_free.
 * Usage: MOTION_BASE_URL=http://127.0.0.1:8752 CHROMIUM=/path/to/chrome \
 *   [SEDENS_SHOTS=/path/to/folder] node test/sedens-room-narration.browser.mjs
 * Screenshots (when SEDENS_SHOTS is set) are written as narration-*.png.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const base = process.env.MOTION_BASE_URL || "http://127.0.0.1:8752";
const shots = process.env.SEDENS_SHOTS || "";
const key = randomBytes(16).toString("hex");
const org = "demo-" + key;
const stamp = Date.now().toString(36);
const courseTitle = `Narration Check ${stamp}`;

// -- the recordings: short tones made with ffmpeg ----------------------------------------------
const dir = mkdtempSync(join(tmpdir(), "sedens-narration-"));
const mp3 = join(dir, "narration-step-1.mp3");
const m4a = join(dir, "narration-step-3.m4a");
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=330:duration=20", "-c:a", "libmp3lame", "-b:a", "64k", mp3]);
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=8", "-c:a", "aac", "-b:a", "64k", m4a]);

const browser = await chromium.launch({
  ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}),
  args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
});
const errors = [];

// Every utterance the page makes is recorded; a real voice would be silent in a test run.
const speechStub = () => {
  window.__spoken = [];
  window.__cancels = 0;
  const stub = {
    getVoices: () => [{ lang: "en-US", localService: true, name: "stub-en" }, { lang: "ko-KR", localService: true, name: "stub-ko" }],
    speak(u) {
      window.__spoken.push({ text: u.text, volume: u.volume, lang: u.lang, at: performance.now() });
      setTimeout(() => u.onend && u.onend(), 250);
    },
    cancel() { window.__cancels += 1; },
    addEventListener() {},
    removeEventListener() {},
  };
  Object.defineProperty(window, "speechSynthesis", { value: stub, configurable: true });
  // The real utterance class refuses a stand-in voice object (and some headless builds have none): use a plain one.
  window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
};

async function open({ viewport = { width: 1366, height: 900 }, name = "page", speech = false } = {}) {
  const ctx = await browser.newContext({ viewport, locale: "en-US" });
  await ctx.addInitScript(([k]) => {
    sessionStorage.setItem("motion-demo-key", k);
    localStorage.setItem("sedens-lang", "en");
  }, [key]);
  if (speech) await ctx.addInitScript(speechStub);
  const page = await ctx.newPage();
  page.on("pageerror", (error) => errors.push(`${name}: ${error.message}\n${error.stack || ""}`));
  page.on("dialog", (dialog) => dialog.accept());
  return page;
}
const shot = async (page, file) => shots && page.screenshot({ path: `${shots}/${file}.png`, fullPage: true });
const api = (page, method, path, body) => page.evaluate(async ([m, p, b]) => {
  const response = await fetch(`/sedens/${p}`, {
    method: m, headers: { "Content-Type": "application/json", "X-Sedens-Request": "1" }, body: b === undefined ? undefined : JSON.stringify(b),
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}, [method, path, body]);
const ok = async (page, method, path, body) => {
  const result = await api(page, method, path, body);
  assert.equal(result.status, 200, `${method} ${path}: ${result.status} ${JSON.stringify(result.body)}`);
  return result.body;
};
async function signIn(role, name, extra = {}) {
  const page = await open({ name, ...extra });
  await page.goto(base + "/");
  const entered = await api(page, "POST", "demo/enter", { key, role });
  assert.equal(entered.status, 200, `${role} could not enter the demonstration: ${JSON.stringify(entered.body)}`);
  return page;
}

// -- 0. What this browser can decode ---------------------------------------------------------------
const probe = await open({ name: "probe" });
await probe.goto(base + "/");
const codecs = await probe.evaluate(() => {
  const a = document.createElement("audio");
  return { mp3: a.canPlayType("audio/mpeg"), aac: a.canPlayType('audio/mp4; codecs="mp4a.40.2"'), opus: a.canPlayType('audio/webm; codecs="opus"') };
});
console.log("canPlayType:", JSON.stringify(codecs));
assert.ok(codecs.mp3, "this browser cannot decode MP3, so the test cannot prove playback");
const aacDecodes = Boolean(codecs.aac);
console.log(aacDecodes ? "this browser decodes AAC: step 3 plays its recording" : "this browser has no AAC decoder: step 3 must fall back to speech");

// -- 1. The creator builds the course ----------------------------------------------------------------
const creator = await signIn("creator", "creator");
let view = await ok(creator, "POST", "creator/courses/create", { title: courseTitle, course_type: "guided_training", language: "en", category: "mobility" });
const courseId = view.course.id;
view = await ok(creator, "POST", "creator/course/module", { course_id: courseId, revision: view.revision, title: "Week 1" });
view = await ok(creator, "POST", "creator/course/session", { course_id: courseId, revision: view.revision, module_id: view.modules[0].id, title: "Three voices" });
const sessionId = view.modules[0].sessions[0].id;
const cue = (text, at_seconds, speak) => ({ text, at_seconds, speak });
const STEP2 = [cue("Press your feet into the mat.", 1, true), cue("Keep your neck long.", 5, false), cue("Lift your hips a little.", 9, true)];
const STEP3 = [cue("Slowly lower down.", 1, true), cue("Rest for a moment.", 6, false)];
const stepBody = (i, extra) => ({
  course_id: courseId, session_id: sessionId, exercise_source: "standard", exercise_ref: i === 2 ? "std-pelvic-curl" : "std-breathing",
  title: `Step ${i}`, sets: 1, work_seconds: [24, 14, 10][i - 1], rest_seconds: 0, customer_cue: "Slow, even breaths.", advance: "auto", ...extra,
});
for (const [i, cues] of [[1, undefined], [2, STEP2], [3, STEP3]]) {
  view = await ok(creator, "POST", "creator/course/step", { ...stepBody(i, cues ? { narration_cues: cues } : {}), revision: view.revision });
}
let steps = view.modules[0].sessions[0].steps;
assert.equal(steps.length, 3);
assert.deepEqual(steps[0].narration_cues, [], "step 1 starts with no timed lines");
const stepIds = steps.map((s) => s.id);

// The session editor: add the lines of step 1 by hand, in the Studio.
await creator.goto(base + `/#/creator/courses/${courseId}/sessions/${sessionId}`);
const card = (n) => creator.locator(`[data-step="${stepIds[n]}"]`);
await card(0).locator("summary", { hasText: "Edit this step" }).first().click();
const narration = card(0).locator("[data-narration]");
await narration.waitFor();
assert.match(await narration.innerText(), /Only lines marked .Speak aloud. are spoken, so keep those few/, "the hint says spoken lines should be few");
assert.match(await narration.innerText(), /Every line shows as a subtitle/, "the hint says unspoken lines appear as subtitles");
assert.match(await narration.innerText(), /No timed lines yet/);
const LINES = [
  { text: "Lie on your back and bend your knees.", at: "0.8", speak: true },
  { text: "Let your shoulders soften.", at: "6", speak: false },
  { text: "Breathe in slowly through your nose.", at: "11", speak: true },
  { text: "Breathe out and rest.", at: "18", speak: false },
];
const rows = narration.locator("[data-cue]");
for (const [i, line] of LINES.entries()) {
  await narration.locator('[data-act="cue-add"]').click();
  assert.equal(await rows.count(), i + 1);
  assert.equal(await rows.nth(i).locator("[data-cue-text]").evaluate((el) => el === document.activeElement), true, "the new line's words field has the focus");
  await rows.nth(i).locator("[data-cue-text]").fill(line.text);
  await rows.nth(i).locator("[data-cue-at]").fill(line.at);
  await rows.nth(i).locator("[data-cue-speak]").setChecked(line.speak);
}
// Keyboard: Enter in a line does not save the step; every control is a native, labelled input or button.
const saved = [];
creator.on("response", (r) => r.url().includes("/sedens/creator/course/step") && r.request().method() === "POST" && saved.push(r.status()));
await rows.nth(0).locator("[data-cue-text]").press("Enter");
await creator.waitForTimeout(300);
assert.equal(saved.length, 0, "Enter in a narration line does not save the step");
for (const control of await rows.nth(0).locator("input, button").all()) {
  const named = await control.evaluate((el) => Boolean(el.labels?.length || el.getAttribute("aria-label") || el.textContent.trim()));
  assert.ok(named, "every control in a line has a label");
}
// A time out of order moves its line into place, and back.
await rows.nth(1).locator("[data-cue-at]").fill("13");
await rows.nth(1).locator("[data-cue-at]").press("Tab");
assert.deepEqual(await rows.locator("[data-cue-at]").evaluateAll((els) => els.map((e) => e.value)), ["0.8", "11", "13", "18"], "lines are kept in time order");
await rows.nth(2).locator("[data-cue-at]").fill("6");
await rows.nth(2).locator("[data-cue-at]").press("Tab");
const texts = () => rows.locator("[data-cue-text]").evaluateAll((els) => els.map((e) => e.value));
assert.deepEqual(await texts(), LINES.map((l) => l.text), "and back again");
// Two spoken lines 2.2 seconds apart: refused inline, before anything is sent.
await rows.nth(2).locator("[data-cue-at]").fill("3");
await rows.nth(2).locator("[data-cue-at]").press("Tab");
const save = (n) => card(n).locator('form[data-form="step"] button.sd-primary');
await save(0).click();
await narration.locator("[data-narration-error]").filter({ hasText: /at least 4 seconds between spoken lines/ }).waitFor();
assert.equal(saved.length, 0, "the refusal came before anything was sent");
assert.equal(await narration.locator("[data-narration-error]").getAttribute("role"), "alert");
await shot(creator, "narration-01-studio-cue-error");
await rows.nth(1).locator("[data-cue-at]").fill("11");
await rows.nth(1).locator("[data-cue-at]").press("Tab");
assert.deepEqual(await texts(), LINES.map((l) => l.text));
console.log("PASS 1: the Studio's timed-narration editor adds, sorts and checks lines, with a hint that spoken lines should be few");

// A narration recording: uploaded in the step editor with the rights questions and the attestation.
async function uploadRecording(n, file, title, mime) {
  const editor = card(n).locator('details[data-open^="edit:"]');
  if (!(await editor.evaluate((el) => el.open))) await editor.locator("summary").first().click();
  const box = card(n).locator('details[data-open^="audio:"]');
  if (!(await box.evaluate((el) => el.open))) await box.locator("summary").click();
  const form = box.locator('form[data-form="audio-upload"]');
  await form.locator('input[type="file"]').setInputFiles(file);
  await form.locator('input[name="title"]').fill(title);
  await form.locator('select[name="licence_type"]').selectOption("own_work");
  await form.locator('input[name="original_creator"]').fill("SEDENS repository (synthetic test tone)");
  await form.locator('select[name="identifiable_person"]').selectOption("none");
  const button = form.locator("[data-needs-attest]");
  assert.equal(await button.isDisabled(), true, "the upload waits for the attestation");
  await form.locator("[data-attest]").check();
  const answered = creator.waitForResponse((r) => r.url().includes("/sedens/creator/media/upload") && r.request().method() === "POST");
  await button.click();
  const response = await answered;
  assert.equal(response.status(), 200, `upload of ${title} was refused with ${response.status()}`);
  assert.match(new URL(response.request().url()).searchParams.get("kind"), /^audio$/);
  await form.locator("[data-status]").filter({ hasText: title }).waitFor();
  const found = (await ok(creator, "GET", "creator/studio")).media.find((m) => m.title === title);
  assert.ok(found, `${title} is in the media library`);
  assert.equal(found.kind, "audio");
  assert.equal(found.mime, mime, "the server decided the type from the bytes");
  assert.equal(found.size, statSync(file).size);
  assert.equal(found.rights.licence_type, "own_work");
  assert.equal(found.rights.review_status, "unreviewed");
  const chosen = await card(n).locator('select[name="narration_audio_media_id"]').inputValue();
  assert.equal(chosen, found.id, "the new recording is chosen in the step's recording list");
  return found;
}
const recording1 = await uploadRecording(0, mp3, "Step 1 narration (MP3 tone)", "audio/mpeg");
await shot(creator, "narration-02-studio-recording-uploaded");
let answered = creator.waitForResponse((r) => r.url().includes("/sedens/creator/course/step") && r.request().method() === "POST");
await save(0).click();
assert.equal((await answered).status(), 200);
await card(0).locator("[data-status]").filter({ hasText: "Saved" }).first().waitFor();
const recording3 = await uploadRecording(2, m4a, "Step 3 narration (M4A tone)", "audio/mp4");
answered = creator.waitForResponse((r) => r.url().includes("/sedens/creator/course/step") && r.request().method() === "POST");
await save(2).click();
assert.equal((await answered).status(), 200);
view = await ok(creator, "GET", `creator/course?id=${courseId}`);
steps = view.modules[0].sessions[0].steps;
assert.deepEqual(steps[0].narration_cues, LINES.map((l) => ({ text: l.text, at_seconds: Number(l.at), speak: l.speak })), "the lines were saved in time order");
assert.equal(steps[0].narration_audio_media_id, recording1.id);
assert.deepEqual(steps[1].narration_cues.map((c) => c.speak), [true, false, true]);
assert.equal(steps[1].narration_audio_media_id, null);
assert.equal(steps[2].narration_audio_media_id, recording3.id);
assert.deepEqual(steps[2].narration_cues.map((c) => c.text), STEP3.map((c) => c.text), "saving the editor kept the lines of step 3");
console.log("PASS 2: an MP3 and an M4A recording uploaded in the step editor with own-work rights and the attestation, and saved with the lines");

// A refusal from the server is shown inline too (the editor's own check is bypassed through the API).
const refused = await api(creator, "POST", "creator/course/step", { ...stepBody(1, { id: stepIds[0], narration_cues: [cue("A", 1, true), cue("B", 2, true)], narration_audio_media_id: recording1.id }), revision: view.revision });
assert.equal(refused.status, 400);
assert.equal(refused.body.code, "narration_too_close");

// -- 2. Submit, review, include, enrol ----------------------------------------------------------------
view = await ok(creator, "POST", "creator/course/access", {
  id: courseId, revision: view.revision, distribution: "selected_facilities", facilities: [{ org_id: org, free: true }], price: { price_type: "free" },
});
view = await ok(creator, "POST", "creator/course/submit", { id: courseId, revision: view.revision });
assert.equal(view.review_state, "submitted");
const reviewer = await signIn("reviewer", "reviewer");
const detail = await ok(reviewer, "GET", `review/course?id=${courseId}&version=1`);
assert.equal(detail.media_rights.length, 2, "the reviewer sees the two recordings the course uses, with their rights");
for (const item of detail.media_rights) await ok(reviewer, "POST", "review/media/decide", { object_id: item.object_id, decision: "approved" });
const checklist = Object.fromEntries(["creator_identity", "rights_licensing", "medical_claims", "safety_wording", "exercise_instructions",
  "demonstration_quality", "anatomy_mappings", "source_provenance", "price_access"].map((item) => [item, { result: "pass" }]));
await ok(reviewer, "POST", "review/course/decide", { course_id: courseId, version: 1, decision: "approved", snapshot_sha256: detail.snapshot_sha256, checklist });
const admin = await signIn("admin", "admin");
await ok(admin, "POST", "facility/courses/setting", { course_id: courseId, enabled: true, included: true });
const phone = await signIn("student", "phone");
const enrolled = await api(phone, "POST", "courses/enroll", { course_id: courseId });
assert.ok([200, 409].includes(enrolled.status), `enrol: ${enrolled.status} ${JSON.stringify(enrolled.body)}`);
const mediaUrl = (id) => `/sedens/media/file?id=${id}`;
for (const id of [recording1.id, recording3.id]) {
  assert.equal(await phone.evaluate(async (url) => (await fetch(url)).status, mediaUrl(id)), 404, "a recording is not served outside the room");
}
console.log("PASS 3: submitted, the two recordings' rights and the version approved, included, enrolled; the recordings are refused outside the room");

// -- 3. In the room ---------------------------------------------------------------------------------
const room = await open({ name: "room", speech: true });
const journeyView = () => room.evaluate(async () => (await (await fetch("/sedens/room/journey")).json()).journey);
async function act(locator, path) {
  const response = room.waitForResponse((r) => r.url().includes(`/sedens/room/journey/${path}`) && r.request().method() === "POST");
  await locator.click();
  const done = await response;
  assert.ok(done.ok(), `${path}: ${done.status()} ${await done.text()}`);
  await room.waitForTimeout(250);
}
await room.goto(base + "/room.html");
for (let attempt = 0; attempt < 2; attempt += 1) {
  await room.locator("#demo-room").click();
  const which = await Promise.race([
    room.getByRole("button", { name: /DEMO-1001/ }).waitFor({ timeout: 60000 }).then(() => "in"),
    room.getByText(/Too many attempts|시도가 너무 많습니다/).waitFor({ timeout: 60000 }).then(() => "wait"),
  ]);
  if (which === "in") break;
  await room.waitForTimeout(61000);
}
await room.getByRole("button", { name: /DEMO-1001/ }).click();
await room.locator('[data-act="readiness/start"]').waitFor();
await act(room.locator('[data-act="readiness/start"]'), "readiness/start");
for (let n = 0; n < 10 && (await journeyView()).state === "readiness"; n += 1) await act(room.locator('[data-answer="no"]'), "readiness/answer");
await act(room.locator("[data-skip]"), "scan/skip");
const courseCard = room.locator("article", { has: room.getByRole("heading", { name: courseTitle }) });
await courseCard.waitFor();
await act(courseCard.locator("[data-course]"), "course/start");
await room.locator('.rp[data-mode="ready"]').waitFor();

// What the player sends for each step.
const workout = (await journeyView()).workout;
assert.deepEqual(workout.steps.map((s) => s.content.narration_mode), ["timed", "timed", "timed"]);
assert.equal(workout.steps[0].content.narration_audio.url, mediaUrl(recording1.id));
assert.equal(workout.steps[1].content.narration_audio, null);
assert.deepEqual(workout.steps[0].content.narration_cues.map((c) => [c.at_ms, c.speak]), [[800, true], [6000, false], [11000, true], [18000, false]]);

// Record every subtitle change with the recording's position at that moment, and every utterance.
await room.evaluate(() => {
  window.__caps = [];
  // When the room enters exercise mode. The step clock starts at or after this moment, so a subtitle
  // measured from here can only be late, never early.
  window.__exerciseAt = null;
  const rp = document.querySelector(".rp");
  new MutationObserver(() => {
    if (window.__exerciseAt === null && rp.dataset.mode === "exercise") window.__exerciseAt = performance.now();
  }).observe(rp, { attributes: true, attributeFilter: ["data-mode"] });
  const box = document.querySelector("[data-caption]");
  const audio = document.querySelector("[data-narration-audio]");
  new MutationObserver(() => {
    const text = box.textContent;
    if (text) window.__caps.push({ at: performance.now(), text, audioT: audio.currentTime, audioPaused: audio.paused, spoken: window.__spoken.length });
  }).observe(box, { childList: true, characterData: true, subtree: true });
});
const caps = () => room.evaluate(() => window.__caps.slice());
// The "Next: ..." line of the get-ready screen is the player's own announcement, not a narration cue.
const spoken = () => room.evaluate(() => window.__spoken.filter((u) => !u.text.startsWith("Next:")));
const audio = () => room.evaluate(() => {
  const a = document.querySelector("[data-narration-audio]");
  return { src: a.currentSrc, hasSrc: a.hasAttribute("src"), paused: a.paused, t: a.currentTime, muted: a.muted, volume: a.volume, ready: a.readyState, error: a.error ? a.error.code : null };
});
const captionNow = () => room.locator("[data-caption]").textContent();
const waitCaption = (text, timeout = 30000) => room.waitForFunction((t) => document.querySelector("[data-caption]").textContent === t, text, { timeout });
const mute = room.locator('[data-act="mute-all"]');
const voiceSource = () => room.locator("[data-voice-source]").textContent();
await shot(room, "narration-00-room-ready");

await act(room.locator('.rp-controls [data-act="start"]'), "workout/start");
await room.locator('.rp[data-mode="exercise"]').waitFor();

// Step 1: the creator's recording.
await waitCaption(LINES[0].text);
await room.waitForFunction(() => { const a = document.querySelector("[data-narration-audio]"); return !a.paused && a.currentTime > 0.3 && a.readyState >= 3; }, null, { timeout: 15000 });
let a = await audio();
assert.ok(a.src.endsWith(mediaUrl(recording1.id)), `the audio element plays ${a.src}`);
assert.equal(a.error, null);
assert.equal(a.paused, false, "the recording plays");
assert.equal((await spoken()).length, 0, "no speech synthesis when the step has the creator's recording");
assert.equal(await voiceSource(), "Voice: the creator's recording.");
await shot(room, "narration-03-room-recording-and-subtitle");
await waitCaption(LINES[1].text);
// Paused: the recording stops with the clock and nothing is said.
await room.locator('.rp-controls-main [data-act="pause"]').click();
await room.locator('[data-overlay][data-kind="paused"]').waitFor();
const p1 = await audio();
assert.equal(p1.paused, true, "the recording is paused with the workout");
await room.waitForTimeout(1500);
const p2 = await audio();
assert.ok(p2.paused && Math.abs(p2.t - p1.t) < 0.05, `the paused recording did not move (${p1.t} -> ${p2.t})`);
assert.equal((await spoken()).length, 0);
assert.equal(await captionNow(), LINES[1].text, "the subtitle stays while paused");
await shot(room, "narration-04-room-paused");
await room.locator('[data-overlay] [data-act="resume"]').click();
await room.locator('[data-overlay]').waitFor({ state: "hidden" });
await room.waitForFunction((t) => { const x = document.querySelector("[data-narration-audio]"); return !x.paused && x.currentTime > t + 0.6; }, p1.t, { timeout: 8000 });
// Mute-all: M, then M again.
await room.keyboard.press("m");
a = await audio();
assert.equal(a.muted, true, "M mutes the recording");
assert.equal(a.paused, false, "a muted recording keeps running, so it stays in step");
assert.equal(await mute.getAttribute("aria-pressed"), "true");
assert.equal(await room.locator("[data-sound-status]").textContent(), "Sound is muted.");
await shot(room, "narration-05-room-muted");
await room.keyboard.press("m");
a = await audio();
assert.equal(a.muted, false);
assert.equal(await mute.getAttribute("aria-pressed"), "false");
await mute.click();
assert.equal((await audio()).muted, true, "the Mute all button does the same");
await mute.click();
assert.equal((await audio()).muted, false);
// Voice volume (its own slider); music has another.
await room.locator(".rp-sound > summary").click();
await room.locator('[data-volume="narration"]').fill("0.3");
a = await audio();
assert.ok(Math.abs(a.volume - 0.3) < 0.001, `the voice slider sets the recording's volume (${a.volume})`);
await room.locator('[data-volume="music"]').fill("0.1");
assert.ok(Math.abs((await audio()).volume - 0.3) < 0.001, "the music slider does not change the voice");
const stored = await room.evaluate(() => Object.entries(sessionStorage).filter(([k]) => k.startsWith("sedens.room.sound:")).map(([, v]) => JSON.parse(v)));
assert.equal(stored.length, 1, "the settings are kept for this room visit");
assert.deepEqual([stored[0].voice, stored[0].music, stored[0].muted], [0.3, 0.1, false]);
assert.match(await room.locator(".rp-sound-grid").innerText(), /Narration is in the course's language\./);
await shot(room, "narration-06-room-sound-settings");
await room.locator(".rp-sound > summary").click();
// Subtitles can be hidden.
await room.locator('[data-act="subtitles"]').click();
assert.equal(await room.locator("[data-caption]").isHidden(), true);
assert.equal(await room.locator('[data-act="subtitles"]').getAttribute("aria-pressed"), "false");
await room.locator('[data-act="subtitles"]').click();
assert.equal(await room.locator("[data-caption]").isVisible(), true);
assert.equal(await room.locator("[data-caption]").getAttribute("aria-live"), "polite");
// The rest of the step, then the get-ready screen.
await waitCaption(LINES[3].text, 40000);
await room.locator('[data-overlay][data-kind="transition"]').waitFor({ timeout: 40000 });
assert.equal((await audio()).paused, true, "the recording stops when the step ends");
const step1 = (await caps()).filter((c) => LINES.some((l) => l.text === c.text));
assert.deepEqual(step1.map((c) => c.text), LINES.map((l) => l.text), "the subtitle changed at each cue, in order");
console.log("  step 1 subtitle changes:", step1.map((c) => `${c.text.slice(0, 12)}… +${((c.at - step1[0].at) / 1000).toFixed(2)}s recording ${c.audioT.toFixed(2)}s`).join(" | "));
const exerciseAt = await room.evaluate(() => window.__exerciseAt);
assert.ok(exerciseAt !== null, "exercise mode was seen");
const cueOffset = (i) => (Number(LINES[i].at) - Number(LINES[0].at));
// A subtitle changes on the clock's next tick, which a busy machine can delay by a second: the tolerance
// is one-sided (never early, up to about a second and a half late).
const late = (seconds, wanted) => seconds >= wanted - 0.35 && seconds <= wanted + 1.6;
// Cues 1 and 2 come before the pause, so wall time since exercise mode began is the step clock plus
// the clock's start-up delay. Measured from there, not from cue 1, which may itself be shown late.
for (const i of [0, 1]) {
  const shownAt = (step1[i].at - exerciseAt) / 1000;
  assert.ok(late(shownAt, Number(LINES[i].at)), `cue ${i + 1} appeared ${shownAt.toFixed(2)}s into the step, wanted ${LINES[i].at}`);
}
for (const [i, c] of step1.entries()) {
  // The recording starts at the first spoken line and follows the step clock, pause and mute included.
  assert.ok(late(c.audioT, cueOffset(i)), `at cue ${i + 1} the recording was at ${c.audioT.toFixed(2)}s, wanted about ${cueOffset(i)}s`);
  assert.equal(c.spoken, 0, "nothing was spoken");
}
console.log("PASS 4: step 1 plays the creator's recording along the clock; subtitles change at 0.8, 6, 11 and 18 s; paused and muted behave; no speech synthesis");

// Step 2: no recording, so the browser's speech.
await room.locator("[data-count]").filter({ hasText: /Exercise 2 of/ }).waitFor({ timeout: 60000 });
await waitCaption(STEP2[0].text, 20000);
await room.waitForFunction(() => window.__spoken.some((u) => u.text === "Press your feet into the mat."), null, { timeout: 5000 });
assert.ok((await room.evaluate(() => window.__spoken.some((u) => u.text === "Next: Step 2"))), "the get-ready screen announced the next step");
let said = await spoken();
assert.equal(said[0].text, STEP2[0].text);
assert.ok(Math.abs(said[0].volume - 0.3) < 0.001, `the voice volume set in step 1 is still in force (${said[0].volume})`);
assert.equal(said[0].lang, "en-US");
assert.equal((await audio()).hasSrc, false, "no recording on this step");
assert.equal(await voiceSource(), "Voice: this screen's speech.");
await waitCaption(STEP2[1].text, 20000);
await room.locator('.rp-controls-main [data-act="pause"]').click();
await room.locator('[data-overlay][data-kind="paused"]').waitFor();
await room.waitForTimeout(4200); // the clock would have reached the second spoken line (9 s) by now
assert.equal((await spoken()).length, 1, "nothing is spoken while paused");
assert.equal(await captionNow(), STEP2[1].text);
await room.locator('[data-overlay] [data-act="resume"]').click();
await room.locator('[data-overlay]').waitFor({ state: "hidden" });
await room.keyboard.press("m"); // muted before the second spoken line
await waitCaption(STEP2[2].text, 20000);
await shot(room, "narration-07-room-speech-step-muted");
await room.waitForTimeout(1500);
said = await spoken();
assert.equal(said.length, 1, "muted: the line is shown as a subtitle and not spoken");
await room.keyboard.press("m");
assert.equal(said.some((u) => u.text === STEP2[1].text), false, "a subtitle-only line is never spoken");
console.log("PASS 5: step 2 speaks the spoken lines at their times with the chosen volume, never the subtitle-only line, nothing while paused or muted");

// Step 3: a recording the browser cannot decode.
await room.locator("[data-count]").filter({ hasText: /Exercise 3 of/ }).waitFor({ timeout: 60000 });
await waitCaption(STEP3[0].text, 20000);
if (aacDecodes) {
  await room.waitForFunction(() => { const x = document.querySelector("[data-narration-audio]"); return !x.paused && x.currentTime > 0.2; }, null, { timeout: 10000 });
  assert.equal((await spoken()).length, 1, "a playable recording needs no speech (only step 2's line was spoken)");
} else {
  await room.waitForFunction(() => document.querySelector("[data-narration-audio]").error !== null, null, { timeout: 10000 });
  await room.waitForFunction(() => window.__spoken.some((u) => u.text === "Slowly lower down."), null, { timeout: 8000 });
  assert.equal(await voiceSource(), "Voice: this screen's speech.", "the player says speech is the voice now");
  console.log("  step 3: the M4A recording could not be decoded here (MediaError " + (await audio()).error + "); the line was spoken with the screen's voice");
}
await shot(room, "narration-08-room-recording-fallback");

// The sound settings survive a reload of the room page.
await room.keyboard.press("m");
await room.reload();
await room.locator('.rp[data-mode="exercise"], .rp[data-mode="paused"]').waitFor({ timeout: 30000 });
assert.equal(await mute.getAttribute("aria-pressed"), "true", "mute survived the reload");
assert.equal(await room.locator('[data-volume="narration"]').inputValue(), "0.3");
assert.equal(await room.locator('[data-volume="music"]').inputValue(), "0.1");
await room.keyboard.press("m");
assert.equal(await mute.getAttribute("aria-pressed"), "false");
// Korean.
await room.locator(".rj-header [data-lang]").click();
await room.waitForFunction(() => document.querySelector('[data-act="mute-all"]').textContent.includes("모두 끄기"));
assert.equal(await mute.textContent(), "모두 끄기 (M)");
assert.equal(await room.locator('[data-act="subtitles"]').textContent(), "자막");
assert.match(await room.locator(".rp-sound-grid").textContent(), /안내는 이 코스의 언어로 나와요\./);
await shot(room, "narration-09-room-korean");
await room.locator(".rj-header [data-lang]").click();
await room.waitForFunction(() => document.querySelector('[data-act="mute-all"]').textContent.includes("Mute all"));
console.log("PASS 6: step 3 falls back to speech when the recording cannot be decoded; settings survive a reload; the Korean room is labelled");

assert.deepEqual(errors, [], `page errors: ${errors.join("; ")}`);
await browser.close();
rmSync(dir, { recursive: true, force: true });
console.log("PASS: timed narration from the Creator Studio (cues, recording with rights) to the room (recording, speech, subtitles, mute, volume)");
