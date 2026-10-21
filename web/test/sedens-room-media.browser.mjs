/** The room player plays real local MP4 and WebM files, uploaded the way a creator uploads them.
 *
 * In a demonstration organization: a creator uploads the three synthetic test clips from
 * tests/data/media/ through the Creator Studio's media library (rights: own work, with the
 * attestation), attaches one to each of three steps of a course session, submits it; the
 * demonstration reviewer accepts each file's rights and approves the version; the facility
 * includes it; the demonstration customer enrols. In the room that customer starts the session:
 *   - the <video> loads (readyState >= 3), its clock advances, it has no media error, and the
 *     server answered with the right type, in byte ranges;
 *   - it is labelled "not yet expert reviewed" and nothing on the screen says expert-approved;
 *   - each step ends and the player moves on by itself to the next step with that step's own file;
 *     the last step finishes with Next. The steps are: an MP4 (H.264), an MP4 (VP9) and a WebM (VP9).
 *     A browser without an H.264 decoder (Playwright's open-source Chromium) does not decode the first
 *     step's clip; the test then checks the room is served those exact bytes, in ranges.
 * Outside the room (a phone session, a visitor who is not signed in) the same media address is
 * refused by the server, and a <video> pointed at it fails.
 *
 * Needs the free demonstration host's modes: start the server with SEDENS_MODE=demo_free.
 * Usage: MOTION_BASE_URL=http://127.0.0.1:8145 CHROMIUM=/path/to/chrome \
 *   [SEDENS_SHOTS=/path/to/folder] node test/sedens-room-media.browser.mjs
 * Screenshots (when SEDENS_SHOTS is set) are written as media-*.png.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const base = process.env.MOTION_BASE_URL || "http://127.0.0.1:8145";
const shots = process.env.SEDENS_SHOTS || "";
const here = dirname(fileURLToPath(import.meta.url));
const clips = join(here, "..", "..", "tests", "data", "media");
// A: MP4 with H.264. B: WebM with VP9. C: MP4 container with VP9 (for a browser that cannot decode H.264,
// such as Playwright's open-source Chromium). All three go through the real upload.
const CLIPS = [
  { key: "a", file: join(clips, "sedens-test-pattern-a.mp4"), title: "Test pattern A (MP4, H.264)", mime: "video/mp4", exercise: "std-breathing" },
  { key: "b", file: join(clips, "sedens-test-pattern-b.webm"), title: "Test pattern B (WebM, VP9)", mime: "video/webm", exercise: "std-pelvic-curl" },
  { key: "c", file: join(clips, "sedens-test-pattern-c-vp9.mp4"), title: "Test pattern C (MP4, VP9)", mime: "video/mp4", exercise: "std-breathing" },
];
for (const clip of CLIPS) assert.ok(existsSync(clip.file), `${clip.file} is missing`);
const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

const key = randomBytes(16).toString("hex");
const org = "demo-" + key;
const stamp = Date.now().toString(36);
const courseTitle = `Media Check ${stamp}`;
const CREATOR_LABEL = "Creator-uploaded media — movement not yet expert reviewed";
const browser = await chromium.launch({
  ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}),
  args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
});
const errors = [];

async function open({ viewport = { width: 1366, height: 900 }, name = "page" } = {}) {
  const ctx = await browser.newContext({ viewport, locale: "en-US" });
  await ctx.addInitScript(([k]) => {
    sessionStorage.setItem("motion-demo-key", k);
    localStorage.setItem("sedens-lang", "en");
  }, [key]);
  const page = await ctx.newPage();
  page.on("pageerror", (error) => errors.push(`${name}: ${error.message}\n${error.stack || ""}`));
  page.on("dialog", (dialog) => dialog.accept());
  return page;
}
const shot = async (page, file) => shots && page.screenshot({ path: `${shots}/${file}.png`, fullPage: true });
/** A SEDENS API call made by the page itself, with its sign-in cookies and the request header the server requires. */
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
/** A role's demonstration sign-in through the API (the server allows ten demonstration entries a minute). */
async function signIn(role, name) {
  const page = await open({ name });
  await page.goto(base + "/");
  const entered = await api(page, "POST", "demo/enter", { key, role });
  assert.equal(entered.status, 200, `${role} could not enter the demonstration: ${JSON.stringify(entered.body)}`);
  return page;
}

// -- 0. What this browser can decode -------------------------------------------------------------
const probe = await open({ name: "probe" });
await probe.goto(base + "/");
const codecs = await probe.evaluate(() => {
  const v = document.createElement("video");
  return {
    mp4_h264: v.canPlayType('video/mp4; codecs="avc1.42E01E"'), webm_vp9: v.canPlayType('video/webm; codecs="vp9"'),
    webm_vp8: v.canPlayType('video/webm; codecs="vp8"'),
  };
});
console.log("canPlayType:", JSON.stringify(codecs));
assert.ok(codecs.webm_vp9, "this browser cannot decode VP9 WebM, so the test cannot prove playback");
// Playwright's open-source Chromium has no H.264 decoder: then the MP4 step plays the VP9-in-MP4 file, and the
// H.264 file is proven on the server's side only (uploaded, served in ranges, identical bytes).
const h264 = Boolean(codecs.mp4_h264);
console.log(h264 ? "this browser decodes H.264: the MP4 step plays the H.264 file" : "this browser has no H.264 decoder: the MP4 step plays the VP9 MP4 file; the H.264 file is checked on the server side only");

// -- 1. The creator uploads all three clips through the media library ---------------------------------
const creator = await signIn("creator", "creator");
await creator.goto(base + "/#/creator/media");
await creator.locator('#upload-form input[type="file"]').waitFor();
const uploaded = [];
for (const clip of CLIPS) {
  const form = creator.locator("#upload-form");
  await form.locator('input[type="file"]').setInputFiles(clip.file);
  await form.locator('input[name="title"]').fill(clip.title);
  await form.locator('select[name="licence_type"]').selectOption("own_work");
  await form.locator('input[name="original_creator"]').fill("SEDENS repository (synthetic test pattern)");
  await form.locator('select[name="identifiable_person"]').selectOption("none");
  const button = form.locator("[data-needs-attest]");
  assert.equal(await button.isDisabled(), true, "the upload waits for the attestation");
  await form.locator("[data-attest]").check();
  const answered = creator.waitForResponse((r) => r.url().includes("/sedens/creator/media/upload") && r.request().method() === "POST");
  await button.click();
  const response = await answered;
  assert.equal(response.status(), 200, `upload of ${clip.title} was refused with ${response.status()}`);
  await form.locator("[data-status]").filter({ hasText: clip.title }).waitFor();
  // What the server recorded for the file (the media library lists it).
  const saved = (await ok(creator, "GET", "creator/studio")).media.find((m) => m.title === clip.title);
  assert.ok(saved, `${clip.title} is in the media library`);
  assert.equal(saved.mime, clip.mime, "the server decided the type from the bytes");
  assert.equal(saved.kind, "video");
  assert.equal(saved.size, statSync(clip.file).size);
  assert.equal(saved.rights.licence_type, "own_work");
  assert.equal(saved.rights.review_status, "unreviewed");
  assert.equal(saved.label.en, CREATOR_LABEL, "a creator's upload carries the not-yet-reviewed label");
  uploaded.push({ ...clip, id: saved.id, sha: sha256(clip.file) });
}
await shot(creator, "media-01-uploaded-in-media-library");
console.log("PASS 1: all three clips uploaded through the Creator Studio with own-work rights and the attestation");

// Three steps, one clip each: the H.264 MP4, the VP9 MP4 and the VP9 WebM.
const byKey = Object.fromEntries(uploaded.map((u) => [u.key, u]));
const played = [byKey.a, byKey.c, byKey.b];
const decodes = (clip) => clip.key !== "a" || h264;

// -- 2. A course session with one clip on each step ----------------------------------------------
let view = await ok(creator, "POST", "creator/courses/create", { title: courseTitle, course_type: "guided_training", language: "en", category: "mobility" });
const courseId = view.course.id;
view = await ok(creator, "POST", "creator/course/module", { course_id: courseId, revision: view.revision, title: "Week 1" });
view = await ok(creator, "POST", "creator/course/session", { course_id: courseId, revision: view.revision, module_id: view.modules[0].id, title: "Two clips" });
const sessionId = view.modules[0].sessions[0].id;
for (const [i, clip] of played.entries()) {
  view = await ok(creator, "POST", "creator/course/step", {
    course_id: courseId, revision: view.revision, session_id: sessionId, exercise_source: "standard", exercise_ref: clip.exercise,
    title: `Step ${i + 1}`, sets: 1, work_seconds: 8, rest_seconds: 0, customer_cue: "Slow, even breaths.",
    video_media_id: clip.id, advance: "auto",
  });
}
const steps = view.modules[0].sessions[0].steps;
assert.deepEqual(steps.map((s) => s.video_media_id), played.map((u) => u.id));
view = await ok(creator, "POST", "creator/course/access", {
  id: courseId, revision: view.revision, distribution: "selected_facilities", facilities: [{ org_id: org, free: true }], price: { price_type: "free" },
});
view = await ok(creator, "POST", "creator/course/submit", { id: courseId, revision: view.revision });
assert.equal(view.review_state, "submitted");

// -- 3. The reviewer accepts the files' rights, then approves exactly that version ----------------
const reviewer = await signIn("reviewer", "reviewer");
const detail = await ok(reviewer, "GET", `review/course?id=${courseId}&version=1`);
assert.equal(detail.media_rights.length, 3, "the reviewer sees the three files the course uses, with their rights");
for (const item of detail.media_rights) await ok(reviewer, "POST", "review/media/decide", { object_id: item.object_id, decision: "approved" });
const checklist = Object.fromEntries(["creator_identity", "rights_licensing", "medical_claims", "safety_wording", "exercise_instructions",
  "demonstration_quality", "anatomy_mappings", "source_provenance", "price_access"].map((item) => [item, { result: "pass" }]));
await ok(reviewer, "POST", "review/course/decide", { course_id: courseId, version: 1, decision: "approved", snapshot_sha256: detail.snapshot_sha256, checklist });

// -- 4. The facility includes it; the customer enrols --------------------------------------------
const admin = await signIn("admin", "admin");
await ok(admin, "POST", "facility/courses/setting", { course_id: courseId, enabled: true, included: true });
const phone = await signIn("student", "phone");
await phone.setViewportSize({ width: 390, height: 844 });
const enrolled = await api(phone, "POST", "courses/enroll", { course_id: courseId });
assert.ok([200, 409].includes(enrolled.status), `enrol: ${enrolled.status} ${JSON.stringify(enrolled.body)}`);
console.log("PASS 2-4: a course with three video steps is submitted, its files' rights and the version approved, included, and the customer enrolled");

// -- 5. Outside the room the same media address is refused ---------------------------------------
const mediaUrl = (id) => `/sedens/media/file?id=${id}`;
for (const clip of uploaded) {
  const phoneAnswer = await phone.evaluate(async (url) => (await fetch(url, { headers: { Range: "bytes=0-9" } })).status, mediaUrl(clip.id));
  assert.equal(phoneAnswer, 404, `${clip.title}: a phone session must not read guided-training media (got ${phoneAnswer})`);
  const adminAnswer = await admin.evaluate(async (url) => (await fetch(url)).status, mediaUrl(clip.id));
  assert.equal(adminAnswer, 404, `${clip.title}: the facility administrator must not read it either (got ${adminAnswer})`);
  const outsider = await open({ name: "visitor" });
  await outsider.goto(base + "/");
  const outsiderAnswer = await outsider.evaluate(async (url) => (await fetch(url)).status, mediaUrl(clip.id));
  assert.equal(outsiderAnswer, 404, `${clip.title}: a visitor who is not signed in must not read it (got ${outsiderAnswer})`);
  await outsider.context().close();
  // A <video> pointed at it, in the phone's own session, does not load: nothing is revealed.
  const failure = await phone.evaluate((url) => new Promise((resolve) => {
    const video = document.createElement("video");
    video.preload = "auto";
    video.addEventListener("error", () => resolve({ code: video.error?.code, readyState: video.readyState }));
    video.addEventListener("loadeddata", () => resolve({ loaded: true }));
    video.src = url;
    setTimeout(() => resolve({ timeout: true }), 8000);
  }), mediaUrl(clip.id));
  assert.ok(failure.code && !failure.loaded, `${clip.title}: a video in the phone session must fail to load: ${JSON.stringify(failure)}`);
}
const phoneCourse = await ok(phone, "GET", `courses/detail?id=${courseId}`);
assert.deepEqual(phoneCourse.play_here, { ok: false, reason: "room_only" }, "the phone can see the course but not play it");
await phone.goto(base + `/#/courses/${courseId}`);
await phone.locator("main").filter({ hasText: courseTitle }).waitFor();
await shot(phone, "media-02-phone-course-no-playback");
console.log("PASS 5: the same media address answers 404 to a phone session, the facility administrator and a visitor, and a video there fails to load");

// -- 6. In the room ------------------------------------------------------------------------------
const room = await open({ name: "room" });
const served = [];
room.on("response", (response) => {
  if (response.url().includes("/sedens/media/file")) {
    served.push({ url: response.url(), status: response.status(), type: response.headers()["content-type"], range: response.headers()["accept-ranges"] });
  }
});
const owner = () => room.locator("#rj-main").getAttribute("data-owner");
const journeyView = () => room.evaluate(async () => (await (await fetch("/sedens/room/journey")).json()).journey);
async function act(locator, path) {
  const answered = room.waitForResponse((r) => r.url().includes(`/sedens/room/journey/${path}`) && r.request().method() === "POST");
  await locator.click();
  const response = await answered;
  assert.ok(response.ok(), `${path}: ${response.status()} ${await response.text()}`);
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
assert.equal((await journeyView()).state, "session_choice");
const card = room.locator("article", { has: room.getByRole("heading", { name: courseTitle }) });
await card.waitFor();
await act(card.locator("[data-course]"), "course/start");
await room.locator('.rp[data-mode="ready"]').waitFor();
await act(room.locator('.rp-controls [data-act="start"]'), "workout/start");

/** What the <video> on screen is doing, after it had a moment to run. */
async function playing(clip, step) {
  await room.locator('.rp[data-mode="exercise"] video.rp-video').waitFor({ timeout: 30000 });
  const label = await room.locator("[data-media-label]").innerText();
  assert.equal(label, CREATOR_LABEL, `step ${step}: the label under the video`);
  const page = await room.locator("body").innerText();
  assert.doesNotMatch(page, /expert[- ](approved|verified|certified)|approved by (an )?expert|expert-reviewed/i, `step ${step}: the screen must not claim expert approval`);
  assert.match(page, /not yet expert reviewed/);
  assert.match(await room.locator(".rp-card").innerText(), /Slow, even breaths\./, `step ${step}: the creator's cue is shown`);
  const src = await room.evaluate(() => document.querySelector("[data-media] video").currentSrc);
  assert.ok(src.endsWith(mediaUrl(clip.id)), `step ${step}: the video plays ${src}, not ${mediaUrl(clip.id)}`);
  if (!decodes(clip)) {
    // This browser cannot decode the file: prove what the server side does with it, in the room.
    const bytes = await room.evaluate(async (url) => {
      const ranged = await fetch(url, { headers: { Range: "bytes=0-99" } });
      const whole = await fetch(url);
      const data = new Uint8Array(await whole.arrayBuffer());
      const digest = await crypto.subtle.digest("SHA-256", data);
      return { rangedStatus: ranged.status, rangedLength: (await ranged.arrayBuffer()).byteLength, contentRange: ranged.headers.get("Content-Range"),
        type: whole.headers.get("Content-Type"), sha: [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join(""),
        brand: new TextDecoder().decode(data.slice(4, 12)) };
    }, mediaUrl(clip.id));
    assert.equal(bytes.rangedStatus, 206);
    assert.equal(bytes.rangedLength, 100);
    assert.match(bytes.contentRange, /^bytes 0-99\//);
    assert.equal(bytes.type, clip.mime);
    assert.equal(bytes.sha, clip.sha, `step ${step}: the room is served the uploaded bytes`);
    assert.equal(bytes.brand.slice(0, 4), "ftyp");
    console.log(`  step ${step}: ${clip.mime} H.264 served by the room (206 ranges, identical bytes); NOT decoded here, this browser has no H.264 decoder`);
    return;
  }
  await room.waitForFunction(() => {
    const v = document.querySelector("[data-media] video");
    return v && v.readyState >= 3;
  }, null, { timeout: 30000 });
  const first = await room.evaluate(() => {
    const v = document.querySelector("[data-media] video");
    return { time: v.currentTime, error: v.error ? v.error.code : null, readyState: v.readyState, width: v.videoWidth, height: v.videoHeight, duration: v.duration };
  });
  await room.waitForTimeout(900);
  const later = await room.evaluate(() => {
    const v = document.querySelector("[data-media] video");
    return { time: v.currentTime, paused: v.paused, error: v.error ? v.error.code : null, ended: v.ended, readyState: v.readyState };
  });
  assert.equal(first.error, null, `step ${step}: media error ${first.error}`);
  assert.equal(later.error, null, `step ${step}: media error ${later.error}`);
  assert.ok(first.readyState >= 3 && later.readyState >= 3, `step ${step}: readyState ${first.readyState}/${later.readyState}`);
  assert.equal(`${first.width}x${first.height}`, "320x180", `step ${step}: the decoded frame size`);
  assert.ok(first.duration > 3 && first.duration < 5, `step ${step}: duration ${first.duration}`);
  assert.equal(later.paused, false, `step ${step}: the video is playing`);
  assert.ok(later.time !== first.time, `step ${step}: the clock did not advance (${first.time} -> ${later.time})`);
  const hit = served.filter((x) => x.url.endsWith(mediaUrl(clip.id)));
  assert.ok(hit.length > 0, `step ${step}: the server streamed ${mediaUrl(clip.id)}`);
  assert.ok(hit.every((x) => x.status === 200 || x.status === 206), `step ${step}: statuses ${hit.map((x) => x.status)}`);
  assert.ok(hit.every((x) => x.type === clip.mime && x.range === "bytes"), `step ${step}: ${JSON.stringify(hit)}`);
  console.log(`  step ${step}: ${clip.mime} (${clip.title}) playing, ${first.width}x${first.height}, t ${first.time.toFixed(2)} -> ${later.time.toFixed(2)}`);
}

assert.equal((await journeyView()).workout.course_version, 1);
const shotNames = ["media-03-step1-mp4-h264-in-room", "media-05-step2-mp4-vp9-in-room", "media-06-step3-webm-vp9-in-room"];
for (const [i, clip] of played.entries()) {
  if (i > 0) {
    // Each step is 8 seconds of work with the next step automatic: the "get ready" countdown, then the next exercise.
    await room.locator('[data-overlay][data-kind="transition"]').waitFor({ timeout: 90000 });
    if (i === 1) await shot(room, "media-04-transition-to-next-step");
    await room.locator("[data-count]").filter({ hasText: new RegExp(`Exercise ${i + 1} of`) }).waitFor({ timeout: 60000 });
  }
  await playing(clip, i + 1);
  await shot(room, shotNames[i]);
  const current = await room.evaluate(() => document.querySelector("[data-media] video").currentSrc);
  if (i > 0) assert.ok(!current.endsWith(mediaUrl(played[i - 1].id)), `step ${i + 1} shows its own file, not the previous one`);
  console.log(`PASS 6.${i + 1}: step ${i + 1} (${clip.title}) is shown with its own file and the not-yet-reviewed label` +
    (i > 0 ? "; the player moved on by itself at the end of the previous step" : ""));
}

// The last step ends with Next.
await act(room.locator(".rp-controls-main [data-act=done]"), "workout/step");
assert.equal((await journeyView()).state, "session_complete");
assert.match(await room.locator("#rj-main").innerText(), /Session complete/i);
await shot(room, "media-07-session-complete");
console.log("PASS 6.4: Next on the last step completes the session");

assert.deepEqual(errors, [], `page errors: ${errors.join("; ")}`);
await browser.close();
console.log(`PASS: the room player plays real MP4 (${h264 ? "H.264 and " : ""}VP9) and WebM (VP9) files from creator uploads, labelled, in the room only` +
  (h264 ? "" : "; the H.264 file was proven on the server side only (this browser cannot decode H.264)"));
