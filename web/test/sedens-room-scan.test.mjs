// The room scan (web/src/sedens/room-scan.js, room-scan-guidance.js, strings-room-scan.js):
// the live framing guidance on synthetic frames (and what it costs per frame), the
// scan_intro and scan_result pages rendered from server-shaped journeys, the copy in
// both languages, and the rules the screen keeps (no score, no red for the body,
// analytics codes only, no tokens in page storage).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

globalThis.localStorage = { getItem: () => "en", setItem() {} };
const G = await import("../src/sedens/room-scan-guidance.js");
const { STRINGS } = await import("../src/sedens/strings.js");
const { ROOM_SCAN } = await import("../src/sedens/strings-room-scan.js");
const { setLang } = await import("../src/sedens/i18n.js");
const { CLIENT_EVENTS } = await import("../src/sedens/room-journey.js");
const scan = await import("../src/sedens/room-scan.js");

const source = readFileSync(new URL("../src/sedens/room-scan.js", import.meta.url), "utf8");
const guidanceSource = readFileSync(new URL("../src/sedens/room-scan-guidance.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/sedens/room-scan.css", import.meta.url), "utf8");

// -- synthetic frames ---------------------------------------------------------------------

const W = G.GUIDANCE_SIZE.width;
const H = G.GUIDANCE_SIZE.height;

/** A grey frame: value(x, y) → 0-255. */
function frame(value, time = 0) {
  const gray = new Uint8Array(W * H);
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) gray[y * W + x] = Math.max(0, Math.min(255, Math.round(value(x, y))));
  return { gray, width: W, height: H, time };
}

// A lit room with a person-shaped darker block in the middle and some texture.
const room = (x, y) => 130 + ((x * 7 + y * 13) % 23) - (x > 26 && x < 38 && y > 4 && y < 34 ? 40 : 0);
// The same room with the person shifted sideways (somebody moving).
const moved = (dx) => (x, y) => 130 + ((x * 7 + y * 13) % 23) - (x > 26 + dx && x < 38 + dx && y > 4 && y < 34 ? 40 : 0);

/** Feed frames every `step` ms and return the last result. */
function feed(guidance, value, { from = 0, count = 10, step = 150 } = {}) {
  let result = null;
  for (let i = 0; i < count; i += 1) result = guidance.evaluate(frame(value, from + i * step));
  return result;
}

test("RGBA pixels become one grey byte each (white 255, black 0)", () => {
  const rgba = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 255, 0, 255, 0, 255]);
  const gray = G.toGray(rgba, 4, 1);
  assert.deepEqual([...gray], [255, 0, 76, 149]);
});

test("light: too dark, too bright, light behind the person, or fine", () => {
  assert.equal(G.lighting(frame(() => 18).gray, W, H), "dark");
  assert.equal(G.lighting(frame(() => 252).gray, W, H), "bright");
  // A bright window all around and a darker person in the middle: backlit.
  const backlit = frame((x, y) => (x > 19 && x < 45 && y > 5 && y < 31 ? 95 : 235));
  assert.equal(G.lighting(backlit.gray, W, H), "backlit");
  assert.equal(G.lighting(frame(room).gray, W, H), "ok");
  // An evenly bright (not blown-out) room is fine.
  assert.equal(G.lighting(frame(() => 200).gray, W, H), "ok");
  assert.ok(Math.abs(G.meanBrightness(frame(() => 100).gray) - 100) < 1e-9);
});

test("movement is pixels that changed; an even exposure change is not movement", () => {
  const a = frame(room).gray;
  assert.equal(G.motionShare(a, frame(room).gray), 0);
  // Auto-exposure brightens the whole picture by 30: not movement.
  assert.equal(G.motionShare(a, frame((x, y) => room(x, y) + 30).gray), 0);
  // The person moves sideways: a clear share of the picture changes.
  const share = G.motionShare(a, frame(moved(6)).gray);
  assert.ok(share > G.DEFAULTS.motionShare, `moved share ${share}`);
  // Sensor noise of a few levels is not movement.
  const noisy = frame((x, y) => room(x, y) + (((x * 31 + y * 17) % 7) - 3)).gray;
  assert.ok(G.motionShare(a, noisy) <= G.DEFAULTS.motionShare);
});

test("ready only after about a second of steady, well-lit pictures", () => {
  const guidance = G.createGuidance();
  const first = guidance.evaluate(frame(room, 0));
  assert.deepEqual([first.ready, first.message_key], [false, G.MESSAGES.hold]);
  // 300 ms of calm is not enough yet.
  const early = feed(guidance, room, { from: 150, count: 2 });
  assert.equal(early.ready, false);
  const settled = feed(guidance, room, { from: 450, count: 6 });
  assert.deepEqual([settled.ready, settled.message_key], [true, G.MESSAGES.ready]);
  // Somebody moves: hold still again, for a full window.
  const moving = guidance.evaluate(frame(moved(8), 1400));
  assert.deepEqual([moving.ready, moving.message_key], [false, G.MESSAGES.hold]);
  assert.ok(moving.motion > G.DEFAULTS.motionShare);
  const shortly = feed(guidance, moved(8), { from: 1550, count: 4 });
  assert.equal(shortly.ready, false, "the move is still inside the last second");
  const again = feed(guidance, moved(8), { from: 2150, count: 8 });
  assert.equal(again.ready, true);
});

test("light problems come first and are never ready, however steady", () => {
  const guidance = G.createGuidance();
  const dark = feed(guidance, () => 15, { count: 12 });
  assert.deepEqual([dark.ready, dark.message_key, dark.light], [false, G.MESSAGES.dark, "dark"]);
  const bright = feed(G.createGuidance(), () => 254, { count: 12 });
  assert.deepEqual([bright.ready, bright.message_key], [false, G.MESSAGES.bright]);
  const back = feed(G.createGuidance(), (x, y) => (x > 19 && x < 45 && y > 5 && y < 31 ? 95 : 235), { count: 12 });
  assert.deepEqual([back.ready, back.message_key], [false, G.MESSAGES.backlit]);
});

test("reset forgets the steady history (a new view starts over)", () => {
  const guidance = G.createGuidance();
  assert.equal(feed(guidance, room, { count: 10 }).ready, true);
  guidance.reset();
  assert.equal(guidance.evaluate(frame(room, 2000)).ready, false);
});

test("a future pose model plugs in through evaluate(frame) → {ready, message_key}", async () => {
  const seen = [];
  const pose = {
    name: "pose",
    evaluate: async (f) => {
      seen.push(f.time);
      return { ready: false, message_key: "rs.guide.hold" };
    },
    reset() {
      seen.length = 0;
    },
  };
  const ready = { name: "always", evaluate: () => ({ ready: true, message_key: G.MESSAGES.ready }) };
  const combined = G.combineGuidance(ready, pose);
  const out = await combined.evaluate(frame(room, 5));
  assert.deepEqual([out.ready, out.message_key], [false, "rs.guide.hold"]);
  assert.deepEqual(seen, [5]);
  // The light check speaks first when it is not ready; the model is not asked.
  const lightFirst = G.combineGuidance(G.createGuidance(), pose);
  const dark = await lightFirst.evaluate(frame(() => 10, 9));
  assert.deepEqual([dark.ready, dark.message_key], [false, G.MESSAGES.dark]);
  assert.deepEqual(seen, [5]);
  combined.reset();
  assert.deepEqual(seen, []);
  assert.equal((await G.combineGuidance(ready, ready).evaluate(frame(room))).ready, true);
  // The scan asks the factory; a registered model replaces the default, null restores it.
  G.setGuidanceFactory(() => combined);
  assert.equal(G.makeGuidance(), combined);
  G.setGuidanceFactory(null);
  assert.equal(G.makeGuidance().name, "light-and-steadiness");
});

test("guidance costs well under a millisecond per frame (64 x 36)", () => {
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < rgba.length; i += 1) rgba[i] = (i * 37) % 251;
  const guidance = G.createGuidance();
  const frames = [frame(room), frame(moved(5))].map((f) => f.gray);
  for (let i = 0; i < 200; i += 1) guidance.evaluate({ gray: G.toGray(rgba, W, H), width: W, height: H, time: i * 150 });
  const runs = 2000;
  const began = performance.now();
  for (let i = 0; i < runs; i += 1) {
    const gray = i % 50 === 0 ? G.toGray(rgba, W, H) : frames[i % 2];
    guidance.evaluate({ gray, width: W, height: H, time: 30000 + i * 150 });
  }
  const each = (performance.now() - began) / runs;
  console.log(`# guidance.evaluate: ${(each * 1000).toFixed(1)} µs per 64x36 frame (node ${process.version})`);
  assert.ok(each < 1, `${each} ms per frame`);
});

test("the guidance never claims to find a body, and speaks customer language only", () => {
  for (const key of Object.values(G.MESSAGES)) {
    assert.ok(STRINGS.en[key] && STRINGS.ko[key], key);
    assert.doesNotMatch(STRINGS.en[key], /landmark|confidence|detect|keypoint|pose/i);
  }
  // Pure: no DOM or network outside the browser sampler.
  const pure = guidanceSource.slice(0, guidanceSource.indexOf("// -- browser helpers"));
  assert.doesNotMatch(pure, /document\.|window\.|fetch\(|navigator\./);
});

// -- copy ------------------------------------------------------------------------------------

const rsKeys = (lang) => Object.keys(ROOM_SCAN[lang]).sort();
const placeholders = (text) => (text.match(/\{\w+\}/g) || []).sort().join(",");

test("every scan string is in both languages, with the same placeholders, and starts with rs.", () => {
  assert.deepEqual(rsKeys("ko"), rsKeys("en"));
  for (const key of rsKeys("en")) {
    assert.match(key, /^rs\./);
    assert.equal(placeholders(ROOM_SCAN.ko[key]), placeholders(ROOM_SCAN.en[key]), key);
    assert.ok(ROOM_SCAN.ko[key].trim() && ROOM_SCAN.en[key].trim(), key);
  }
});

const BANNED = [
  /posture score/i, /alignment score/i, /health score/i, /\bscore of\b/i, /\d\s*%|%\s*\d/, /\bgrade[sd]?\b/i,
  /\b(red|yellow|green)\b/i, /correct (your )?posture/i, /fix(es)? your posture/i, /prevents? injur/i, /injury risk/i,
  /clinically/i, /supervised by/i, /muscle activation/i, /diagnos/i, /perfect form/i, /your knee is wrong/i,
  /bad posture/i, /landmark/i, /confidence/i,
  /자세 점수/, /정렬 점수/, /건강 점수/, /자세 교정/, /부상 예방/, /부상 위험/, /임상적/, /진단/, /근육 활성/, /빨간|노란|초록/, /완벽한 자세/,
];

test("no score, grade, traffic light, diagnosis or medical claim in the scan copy", () => {
  for (const lang of ["en", "ko"]) {
    for (const [key, value] of Object.entries(ROOM_SCAN[lang])) {
      for (const pattern of BANNED) assert.doesNotMatch(value, pattern, `${lang}.${key}`);
    }
  }
});

test("Korean guidance is polite and natural (해요체), never a literal English order", () => {
  for (const key of rsKeys("ko").filter((k) => /^rs\.(guide|cam\.(stopped|taken|count_start|retake_said)|proc\.(title|free_host|room))/.test(k))) {
    assert.match(ROOM_SCAN.ko[key], /(요|요\.|요…|세요\.?)$/, key);
  }
  for (const view of ["front", "left", "back", "right"]) assert.match(ROOM_SCAN.ko["rs.face." + view], /주세요$/);
});

test("every copy key the scan builds at run time exists", () => {
  const keys = [];
  for (const v of ["front", "left", "back", "right"]) keys.push(`rs.view.${v}`, `rs.why.${v}`, `rs.face.${v}`);
  for (const kind of ["scan_capture", "scan_image_retention", "product_analytics"]) keys.push(`rs.consent.${kind}`);
  for (const s of ["demo_precomputed", "experimental_real", "room_capture"]) keys.push(`rs.option.${s}`, `rs.option.${s}_body`, `rs.start.${s}`);
  for (const s of ["demo_precomputed", "experimental_real"]) keys.push(`rs.label.${s}`);
  for (const q of ["clear", "limited", "retake"]) keys.push(`rs.quality.${q}`);
  for (const e of ["denied", "unavailable", "busy", "lost"]) keys.push(`rs.cam.error_title.${e}`, `rs.cam.error_body.${e}`);
  for (const key of keys) assert.ok(key in STRINGS.en && key in STRINGS.ko, key);
  // The scan labels match the server's (pilates/sedens/scans.py LABELS), so the intro and the result say the same.
  const server = readFileSync(new URL("../../pilates/sedens/scans.py", import.meta.url), "utf8");
  for (const s of ["demo_precomputed", "experimental_real"]) {
    assert.ok(server.includes(`"en": "${ROOM_SCAN.en["rs.label." + s]}"`), s);
    assert.ok(server.includes(`"ko": "${ROOM_SCAN.ko["rs.label." + s]}"`), s);
  }
});

// -- the intro and the result, rendered from server-shaped journeys --------------------------------

const TEXTS = {
  scan_capture: { version: "2026-10-v2", text: "Use this room's camera to take four still photos. SEDENS does not diagnose or treat any condition." },
  scan_image_retention: { version: "2026-10-v2", text: "Keep my four scan photos in my facility's SEDENS records." },
  product_analytics: { version: "2026-10-v1", text: "Link my use of SEDENS screens and steps to my account <b>only</b>." },
};
const introJourney = (current = {}, options = ["demo_precomputed", "experimental_real"]) => ({
  state: "scan_intro", revision: 3, path: null, scan_skipped: false, views: ["front", "left", "back", "right"],
  consent: { texts: TEXTS, current: { scan_capture: null, scan_image_retention: null, product_analytics: null, ...current } },
  scan_options: options,
});
const decided = (granted, current_version = true) => ({ granted, text_version: "x", recorded_at: "2026-10-13T00:00:00Z", channel: "room", current_version });

test("scan_intro: four views, three separate decisions in full, demo first, experimental second", () => {
  setLang("en");
  const html = scan.introHTML(introJourney());
  for (const view of ["Front", "Left side", "Back", "Right side"]) assert.match(html, new RegExp(`<h3><span class="rs-view-n" aria-hidden="true">\\d</span>${view}</h3>`), view);
  const escaped = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&#39;");
  for (const kind of Object.keys(TEXTS)) assert.ok(html.includes(escaped(TEXTS[kind].text)), `${kind} in full`);
  // Server text is escaped, never markup.
  assert.ok(html.includes("&lt;b&gt;only&lt;/b&gt;") && !html.includes("<b>only</b>"));
  // Nothing decided: every switch is off; the optional ones are marked optional.
  assert.equal((html.match(/role="switch" aria-checked="false"/g) || []).length, 3);
  assert.equal((html.match(/>Optional</g) || []).length, 2);
  assert.ok(html.includes("Needed for the scan"));
  assert.ok(html.includes("rs-need"), "the hint says what to do to start");
  const demo = html.indexOf('data-start="demo_precomputed"');
  const real = html.indexOf('data-start="experimental_real"');
  assert.ok(demo > 0 && real > demo, "the demonstration scan comes first");
  assert.match(html, /class="sd-primary sd-large" data-start="demo_precomputed"/);
  assert.doesNotMatch(html, /class="sd-primary sd-large" data-start="experimental_real"/);
  assert.ok(html.includes("DEMO PRECOMPUTED ANALYSIS") && html.includes("EXPERIMENTAL REAL ANALYSIS"));
  assert.match(html, /no photo leaves this screen/);
  assert.match(html, /about two minutes/);
  assert.ok(html.includes("data-skip"), "skipping is always offered");
  assert.equal((html.match(/<h1/g) || []).length, 1);
});

test("scan_intro shows the current decisions, a changed wording, and only the room capture in a local room", () => {
  setLang("en");
  const on = scan.introHTML(introJourney({ scan_capture: decided(true), product_analytics: decided(false) }));
  assert.match(on, /aria-checked="true"[^>]*data-consent="scan_capture"/);
  assert.match(on, /aria-checked="false"[^>]*data-consent="product_analytics"/);
  assert.ok(!on.includes('id="rs-need"'));
  const stale = scan.introHTML(introJourney({ scan_capture: decided(true, false) }));
  assert.match(stale, /aria-checked="false"[^>]*data-consent="scan_capture"/);
  assert.ok(stale.includes(STRINGS.en["rs.consent.stale"]));
  const local = scan.introHTML(introJourney({}, ["room_capture"]));
  assert.equal((local.match(/data-start=/g) || []).length, 1);
  assert.ok(local.includes('data-start="room_capture"'));
  assert.ok(!local.includes("PRECOMPUTED") && !local.includes("EXPERIMENTAL"));
  const saving = scan.introHTML(introJourney(), { busy: "scan_capture", message: "Problem <here>" });
  assert.match(saving, /data-consent="scan_capture" data-focus="consent-scan_capture" disabled/);
  assert.ok(saving.includes("Problem &lt;here&gt;"));
  setLang("ko");
  const ko = scan.introHTML(introJourney());
  assert.ok(ko.includes("데모 사전 계산 분석") && ko.includes("시연용 스캔 시작") && ko.includes("스캔 건너뛰기"));
  setLang("en");
});

const summary = (lang = "en") => ({
  rules_version: "sedens-feedback-1.0.0",
  quality: "clear",
  quality_text: lang === "ko" ? "스캔이 선명하게 촬영되었어요." : "Your scan was captured clearly.",
  views: { front: { quality: "clear", reason: null }, left: { quality: "clear", reason: null }, back: { quality: "clear", reason: null }, right: { quality: "clear", reason: null } },
  observations: [{
    id: "shoulder_line",
    heading: lang === "ko" ? "어깨선" : "Shoulder line",
    text: lang === "ko" ? "앞모습과 뒷모습 사진 모두에서 오른쪽 어깨가 반대쪽보다 약간 높게 보였어요." : "In both your front and back photos, your right shoulder sat slightly higher than the other one.",
    limitation: "Measured from estimated keypoints in two still photos.",
    provisional: true,
  }],
  notes: [],
  meaning: "Small side-to-side differences are common. This is one camera observation.",
  focus: { heading: "Today's exercise focus", text: "Your goal leads.", why_heading: "Why", why: "A shoulder-line difference was visible in both photos." },
  comparison: { available: false, text: "There's no earlier scan taken under the same conditions yet." },
  advanced: [
    { view: "front", metric: "shoulder_tilt", label: "Shoulder line angle", value: -3.1, unit: "deg", limitation: "Estimated keypoints, not bony landmarks." },
    { view: "left", metric: "forward_head", label: "Ear-to-shoulder offset (side view)", value: 0.04, unit: "ratio", limitation: "Not a craniovertebral angle." },
  ],
  label: lang === "ko" ? "데모 사전 계산 분석" : "DEMO PRECOMPUTED ANALYSIS",
  label_note: "Fictional precomputed measurements for this demonstration.",
  source: "demo_precomputed",
});
const resultJourney = (s, extra = {}) => ({
  state: "scan_result", revision: 9, path: null, scan_skipped: false, views: ["front", "left", "back", "right"],
  scan: { source: "demo_precomputed", needs_images: false, views: {}, label: s?.label ?? null, state: "complete", summary: s, failed: false, ...extra },
});

const order = (html, parts) => parts.map((p) => html.indexOf(p));

test("scan_result: label, then the five areas in order, then the comparison and Advanced (collapsed)", () => {
  setLang("en");
  const html = scan.resultHTML(resultJourney(summary()), { lang: "en" });
  const at = order(html, ["DEMO PRECOMPUTED ANALYSIS", "Fictional precomputed", ">Scan quality<", ">What we observed<",
    ">What it means<", ">Today&#39;s exercise focus<", ">Why<", ">Compared with earlier scans<", "Advanced measurements"]);
  assert.ok(at.every((i) => i >= 0), JSON.stringify(at));
  assert.deepEqual([...at].sort((a, b) => a - b), at, "in this order");
  assert.match(html, /<details class="rs-advanced"><summary>/, "Advanced is collapsed by default");
  assert.doesNotMatch(html, /<details[^>]* open/);
  assert.equal((html.match(/<tr><td>/g) || []).length, 2);
  assert.ok(html.includes("-3.1°") && html.includes("0.04 ratio"));
  assert.equal((html.match(/rs-chip is-clear/g) || []).length, 4);
  assert.ok(html.includes(">Provisional<"));
  // Continue is the one primary action; Scan again is offered.
  assert.match(html, /class="sd-primary sd-large" data-result="scan\/continue"/);
  assert.ok(html.includes('data-result="scan/again"'));
});

test("scan_result never shows a score, a percentage or a traffic light, in either language", () => {
  for (const lang of ["en", "ko"]) {
    setLang(lang);
    const html = scan.resultHTML(resultJourney(summary(lang)), { lang });
    // Saying what it is not ("It is not a score.") is allowed; anything else that scores is not.
    const text = html.replace(/<[^>]+>/g, " ").replace(/(are |is )?not a score|점수가 아니(에요|며)/gi, "");
    assert.doesNotMatch(text, /%|score|grade|점수|등급/i, lang);
    assert.doesNotMatch(html, /\b(red|green|yellow)\b/i);
  }
  setLang("ko");
  const ko = scan.resultHTML(resultJourney(summary("ko")), { lang: "ko" });
  assert.ok(ko.includes(">스캔 품질<") && ko.includes(">관찰한 내용<") && ko.includes(">이 결과의 의미<") && ko.includes("0.04 비율"));
  setLang("en");
});

test("scan_result: per-view chips with the reason, amber only for a retake; server text escaped", () => {
  setLang("en");
  const s = summary();
  s.quality = "limited";
  s.views.left = { quality: "retake", reason: "We couldn't see your whole body. Step back a little." };
  s.views.back = { quality: "limited", reason: null };
  s.views.right = { quality: "something_new", reason: null };
  s.observations[0].heading = '<img src=x onerror="alert(1)">';
  const html = scan.resultHTML(resultJourney(s), { lang: "en" });
  assert.match(html, /rs-chip is-retake[\s\S]*Retake suggested[\s\S]*We couldn&#39;t see your whole body/);
  assert.equal((html.match(/rs-chip is-limited/g) || []).length, 2, "an unknown quality reads as limited");
  assert.ok(!html.includes("<img") && html.includes("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"));
});

test("a failed analysis says so plainly and offers Scan again first, then Continue", () => {
  setLang("en");
  const html = scan.resultHTML(resultJourney(summary(), { failed: true }), { lang: "en" });
  assert.ok(html.includes("We couldn&#39;t finish the analysis"));
  assert.match(html, /class="sd-primary sd-large" data-result="scan\/again"[\s\S]*data-result="scan\/continue"/);
  assert.ok(!html.includes("What we observed"));
  const none = scan.resultHTML(resultJourney(null), { lang: "en" });
  assert.ok(none.includes("We couldn&#39;t finish the analysis"));
});

test("scan_result with nothing to report says so instead of an empty list", () => {
  setLang("en");
  const s = summary();
  s.observations = [];
  s.advanced = [];
  const html = scan.resultHTML(resultJourney(s), { lang: "en" });
  assert.ok(html.includes(STRINGS.en["rs.result.none"].replace(/'/g, "&#39;")));
  assert.ok(!html.includes("rs-advanced"), "no empty Advanced section");
});

test("the framing guide and the orientation drawing are decorative SVG for every view", () => {
  for (const view of ["front", "left", "back", "right"]) {
    assert.match(scan.silhouette(view), /^<svg class="rs-figure"[^>]*aria-hidden="true"/);
    assert.match(scan.orientation(view), /^<svg class="rs-orient"[^>]*aria-hidden="true"/);
  }
  assert.match(scan.silhouette("right"), /scale\(-1 1\)/);
  assert.doesNotMatch(scan.silhouette("left"), /scale\(-1 1\)/);
  assert.match(scan.orientation("left"), /rotate\(90 80 96\)/);
  assert.match(scan.orientation("back", { turn: true }), /rs-orient-turn/);
  assert.doesNotMatch(scan.orientation("front", { turn: true }), /rs-orient-turn/);
});

// -- rules the module keeps ------------------------------------------------------------------

test("analytics: only listed events, with short codes, never free text", () => {
  const names = [...source.matchAll(/sendEvent\(ctx, "([a-z_]+)"/g)].map((m) => m[1]);
  assert.ok(names.length > 0);
  for (const name of names) assert.ok(CLIENT_EVENTS.includes(name), name);
  assert.match(source, /sendEvent\(ctx, "scan_result_viewed", \{ source, quality \}\)/);
});

test("no tokens or photos in page storage, and every photo goes through ctx.upload before scan/view", () => {
  assert.doesNotMatch(source + guidanceSource, /localStorage|sessionStorage|document\.cookie|indexedDB/);
  const upload = source.indexOf("await sendPhoto(ctx, view, blob)");
  const viewDone = source.indexOf('await act(ctx, "scan/view", { view })');
  assert.ok(upload > 0 && viewDone > upload);
  // The photo is only encoded when the scan needs photos.
  assert.match(source, /if \(needsImages\) \{\s*blob = await jpeg\(camera\.still\);/);
  assert.match(source, /"image\/jpeg", JPEG_QUALITY/);
});

test("colours: no red anywhere in the scan, amber only for capture problems", () => {
  assert.doesNotMatch(css, /--sd-danger|#f0a39b|\bred\b|#(?:f00|ff0000)\b/i);
  for (const rule of css.split("}")) {
    if (!/--sd-warn|#5c4e2c|#221d10/.test(rule)) continue;
    const selector = rule.slice(0, rule.indexOf("{"));
    assert.match(selector, /retake|problem|failed|stale|attention/, selector.trim());
  }
  assert.match(css, /prefers-reduced-motion/);
});
