// Fitness Passport: the route table, and the pages rendered from fixture API payloads (no browser).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compile, match } from "../src/sedens/router.js";
import { PASSPORT_ROUTES, PASSPORT_MODULES, PASSPORT_SECTIONS } from "../src/sedens/passport-routes.js";
import { setLang } from "../src/sedens/i18n.js";
import * as view from "../src/sedens/passport-render.js";

const table = compile(PASSPORT_ROUTES);
const frame = { demo: false, deployment: { mode: "local_room", demo_free: false, notice: null } };
const FORBIDDEN = /calorie|\bscores?\b|improv|strength gain|injury prevention|fitness age|칼로리|점수|개선|근력 향상|부상 예방|체력 나이/i;
const PLAY = /\b(play|start|begin|resume)\b|재생|시작하/i;

const completed = {
  kind: "room", id: "w3", date: "2026-10-19T09:00:00+00:00", origin: "room", status: "completed", status_label: "Completed",
  title: "SEDENS Standard session", focus: "Mobility", workout_kind: "standard", course: null, active_minutes: 28,
  exercises_completed: 14, exercises_skipped: 1, exercises_total: 15, effort: { value: 6, text: "You rated it 6/10" }, ended_for_safety: false,
};
const stopped = { ...completed, id: "w2", date: "2026-10-12T09:00:00+00:00", status: "stopped", status_label: "Stopped early", active_minutes: 9, exercises_completed: 4, exercises_skipped: 0, exercises_total: 15, effort: null, ended_for_safety: true };
const abandoned = { ...completed, id: "w1", date: "2026-10-05T09:00:00+00:00", status: "not_finished", status_label: "Not finished", active_minutes: 3, exercises_completed: 1, exercises_skipped: 0, exercises_total: 15, effort: null };
const studio = { kind: "studio", id: "s1", date: "2026-09-28T09:00:00+00:00", origin: "demo_seed", recorder: "Coach Min", exercises_completed: 5 };
const program = {
  course_id: "c1", title: "4-Week Core Foundations", course_type: "guided_training", cover_url: "/sedens/media/file?id=m1",
  creator: { display_name: "Coach Min", verification_state: "unverified", verified: false }, origin: { code: "facility_included", label: "Included by your facility" },
  entitlement: { status: "active", label: "You can use this course", source: "facility_included", granted_at: "2026-09-01T00:00:00+00:00" },
  weeks: 4, sessions_per_week: 3, pinned_version: 2, enrolled_version: 2, enrolled_at: "2026-09-01T00:00:00+00:00", completed_at: null, available: true,
  sessions: { done: 3, total: 12, remaining: 9 }, last_completed: { session_id: "x", title: "Core Basics", module_title: "Week 1", completed_at: "2026-10-10T09:00:00+00:00", workout_id: "w3" },
  next_session: { module_title: "Week 2", module_number: 2, session_title: "Side Plank Prep", session_number: 1, session_id: "y", estimated_minutes: 20 },
  next_eligible: true, offered_at_facility: true,
  history: [{ session_id: "x", title: "Core Basics", module_title: "Week 1", completed_at: "2026-10-10T09:00:00+00:00", workout_id: "w3" }],
  room_only: "Guided sessions play only on a room screen at your facility.",
};
const overviewData = {
  ...frame, demo: true, deployment: { mode: "demo_free", demo_free: true, notice: "x" },
  totals: { completed_visits: 6, room_visits: 2, workouts: { completed: 6, stopped: 1, not_finished: 1 }, active_minutes: 140, studio_sessions: 3, demo_seed: { visits: 4, workouts: 4, scans: 2, studio_sessions: 3 } },
  latest_workout: completed, recent: [completed, stopped, studio], categories: [{ id: "mobility", label: "Mobility", completed: 6 }],
  current_program: program, next_session: { course_id: "c1", title: "4-Week Core Foundations", pinned_version: 2, ...program.next_session, room_only: "x" },
  scans: { complete: 2, latest: { id: "sc2", date: "2026-10-18T09:00:00+00:00", origin: "demo_seed" }, comparable_pair: true, photos_kept: 0 },
  last_effort: { workout_id: "w3", date: "2026-10-19T10:00:00+00:00", value: 6, text: "You rated it 6/10" },
  courses: [{ course_id: "c1", title: "4-Week Core Foundations", sessions: { done: 3, total: 12, remaining: 9 }, completed_at: null }],
};
const emptyOverview = {
  ...frame, totals: { completed_visits: 0, room_visits: 0, workouts: { completed: 0, stopped: 0, not_finished: 0 }, active_minutes: 0, studio_sessions: 0, demo_seed: { visits: 0, workouts: 0, scans: 0, studio_sessions: 0 } },
  latest_workout: null, recent: [], categories: [], current_program: null, next_session: null,
  scans: { complete: 0, latest: null, comparable_pair: false, photos_kept: 0 }, last_effort: null, courses: [],
};
const comparison = {
  comparable: true, earlier: "sc1", later: "sc2", earlier_date: "2026-09-18T09:00:00+00:00", later_date: "2026-10-18T09:00:00+00:00",
  measured: { id: "shoulder_line", heading: "Shoulder line", metric: "shoulder_tilt", views: ["front", "back"], unit: "deg" },
  earlier_values: { views: { front: 1.1, back: 1.3 }, mean: 1.2, unit: "deg" }, later_values: { views: { front: 1.5, back: 1.7 }, mean: 1.6, unit: "deg" },
  difference: 0.4, text: "x", limitations: ["Measured from estimated keypoints in two still photos.", "We don't know yet how much this measurement varies from one scan to the next."],
  versions: { measurement: "2.1", feedback_rules: "sedens-feedback-1.0.0", protocol: "four_view_v1" }, demo: true,
};
const REASONS = ["different_customer", "low_quality", "demo_vs_real", "different_protocol", "different_measurement_version", "different_model", "different_rules_version", "observation_withheld"];
const scan = (id, over = {}) => ({
  id, date: "2026-10-18T09:00:00+00:00", origin: "demo_seed", source: "demo_precomputed", label: "DEMO", reliability: "clear", measurement_version: "2.1",
  feedback_rules_version: "sedens-feedback-1.0.0", photos_kept: false, previous: null,
  summary: { quality_text: "Your scan was captured clearly.", observations: [{ id: "shoulder_line", heading: "Shoulder line", text: "In both your front and back photos, your left shoulder sat slightly higher than the other one." }], notes: [], meaning: "This is general fitness information." }, ...over,
});

for (const lang of ["en", "ko"]) {
  // -- routes ---------------------------------------------------------------------------------
  test(`[${lang}] the Passport routes resolve to their pages`, () => {
    const expected = {
      "#/passport": "passport", "#/passport/history": "passport_history", "#/passport/workout/w-1_2": "passport_workout",
      "#/passport/scans": "passport_scans", "#/passport/scans?scan=abc": "passport_scans", "#/passport/programs": "passport_programs",
      "#/passport/achievements": "passport_achievements", "#/passport/preferences": "passport_preferences", "#/passport/privacy": "passport_privacy",
    };
    for (const [hash, name] of Object.entries(expected)) assert.equal(match(table, hash).name, name, hash);
    assert.deepEqual(match(table, "#/passport/workout/w-1_2").params, { id: "w-1_2" });
    assert.equal(match(table, "#/passport/scans?scan=abc").query.scan, "abc");
    for (const hash of ["#/passport/nope", "#/passport/workout", "#/passport/workout/a b", "#/passport/workout/../x"]) assert.equal(match(table, hash).name, "not_found", hash);
  });
}
test("every route has a module, every module has a page function, and the section bar covers the list pages", () => {
  const source = readFileSync(new URL("../src/sedens/passport.js", import.meta.url), "utf8");
  for (const [, [file, fn]] of Object.entries(PASSPORT_MODULES)) {
    assert.equal(file, "./passport.js");
    assert.match(source, new RegExp(`export (const|async function|function) ${fn}\\b`), fn);
  }
  const names = new Set(PASSPORT_ROUTES.map(([, n]) => n));
  assert.deepEqual([...names].sort(), Object.keys(PASSPORT_MODULES).sort());
  for (const [, path] of PASSPORT_SECTIONS) assert.ok(PASSPORT_ROUTES.some(([p]) => p === path), path);
  const app = readFileSync(new URL("../src/sedens/app.js", import.meta.url), "utf8");
  assert.match(app, /\.\.\.PASSPORT_ROUTES/);
  assert.match(app, /\.\.\.PASSPORT_MODULES/);
  assert.match(app, /t\("home\.passport_body"\), "#\/passport"\)/, "the home card links to the Passport");
  assert.doesNotMatch(app, /home\.passport_body"\), "#\/passport", true/);
});

for (const lang of ["en", "ko"]) {
  test(`[${lang}] overview: the facts, one next action, a demo banner, no measurements and no play button`, () => {
    setLang(lang);
    const html = view.overview(overviewData, { facility: "SEDENS Demo Fitness Center", back: "" });
    assert.equal((html.match(/<h1[ >]/g) || []).length, 1);
    assert.match(html, /aria-current="page">/);
    assert.match(html, /role="progressbar"/);
    assert.match(html, /aria-valuetext="/);
    assert.match(html, /pp-banner-demo/);
    assert.match(html, /4/, "the fictional visits are counted");
    assert.equal((html.match(/class="sd-primary/g) || []).length, 1, "one obvious next action");
    assert.doesNotMatch(html.replace(/<[^>]+>/g, " "), FORBIDDEN);
    assert.doesNotMatch(html, /<button/, "nothing to press on the overview");
    assert.doesNotMatch(html.replace(/<[^>]+>/g, " ").replace(/Available in the AI Private Room|AI 프라이빗 룸에서 이용할 수 있어요/g, ""), PLAY);
    assert.doesNotMatch(html, /\bdeg\b|°/, "no engineer-oriented measurement on the overview");
    assert.doesNotMatch(html, /free demo may lose|무료 시연은 서버/, "the site-wide storage banner already says it");
    assert.match(html, /Available in the AI Private Room|AI 프라이빗 룸에서 이용할 수 있어요/);
    assert.equal((html.match(/id="pp-courses"/g) || []).length, 0, "the followed program is not repeated as a course bar");
    const other = { ...overviewData, courses: [...overviewData.courses, { course_id: "c9", title: "Other course", sessions: { done: 1, total: 4, remaining: 3 }, completed_at: null }] };
    const more = view.overview(other, {});
    assert.match(more, /id="pp-courses"/);
    assert.match(more, /Other course/);
    assert.equal((more.match(/4-Week Core Foundations/g) || []).length, (html.match(/4-Week Core Foundations/g) || []).length, "still shown once");
    const sections = [...html.matchAll(/<section[^>]*aria-labelledby="(pp-[a-z-]+)"/g)].map((m) => m[1]);
    assert.deepEqual(sections.slice(0, 3), ["pp-latest", "pp-stats", "pp-program"], "the latest workout and totals come first");
  });

  test(`[${lang}] banners: the overview keeps the demo notice short; other pages list the fictional counts; no free-demo repeat`, () => {
    setLang(lang);
    const data = { demo: true, deployment: { mode: "demo_free", demo_free: true }, totals: { demo_seed: { visits: 20, studio_sessions: 0, scans: 1 } } };
    assert.doesNotMatch(view.banners(data, { seeds: false }), /fictional demo visits|가상의 시연 방문/);
    assert.match(view.banners(data), /fictional demo visits|가상의 시연 방문/);
    assert.doesNotMatch(view.banners(data), /free demo may lose|무료 시연은 서버/);
    assert.match(view.banners(data), /pp-banner-demo/);
  });

  test(`[${lang}] overview: an empty Passport reads well and points to courses, not to a session`, () => {
    setLang(lang);
    const html = view.overview(emptyOverview, { facility: "" });
    assert.doesNotMatch(html, /pp-banner/);
    assert.match(html, /pp-empty/);
    assert.match(html, /href="#\/courses"/);
    assert.doesNotMatch(html, /Infinity|NaN|undefined|null/);
    assert.equal((html.match(/class="sd-primary/g) || []).length, 1);
  });

  test(`[${lang}] history: completed, stopped, not finished and studio cards, and an empty state`, () => {
    setLang(lang);
    const html = view.historyPage({ ...frame, items: [completed, stopped, abandoned, studio], next_before: "2026-09-28|s1" }, { facility: "Demo Gym" });
    assert.equal((html.match(/<article/g) || []).length, 4);
    assert.match(html, /data-status="completed"/);
    assert.match(html, /data-status="stopped"/);
    assert.match(html, /data-status="not_finished"/);
    assert.match(html, /data-kind="studio"/);
    assert.match(html, /Demo Gym/);
    assert.match(html, /data-before="2026-09-28\|s1"/, "the cursor is kept for the next page");
    const studioCard = view.historyCard(studio);
    assert.match(studioCard, /Coach Min/);
    assert.doesNotMatch(studioCard, /<a |effort|강도|skipped|건너뛴/i, "a studio card shows the recorder and the exercises only");
    assert.match(view.historyCard(stopped), /safety stop|안전을 위해/);
    assert.doesNotMatch(html.replace(/<[^>]+>/g, " "), FORBIDDEN);
    const empty = view.historyPage({ ...frame, items: [], next_before: null });
    assert.match(empty, /pp-empty/);
    assert.doesNotMatch(empty, /id="pp-more"/);
    assert.match(view.historyPage({ ...frame, items: [completed], next_before: null }), /pp-end/);
  });

  test(`[${lang}] workout detail: steps with completed and skipped markers, course version, scan link, own answers`, () => {
    setLang(lang);
    const html = view.workoutDetail({
      ...frame,
      workout: {
        ...completed, workout_kind: "course", visit_date: completed.date, ended_at: completed.date, where: { facility: "Demo Gym", location: "Songdo", room: "Room 01" }, planned_minutes: 30,
        course: { course_id: "c1", version: 2, title: "4-Week Core Foundations", module_title: "Week 1", session_title: "Core Basics" },
        steps: [
          { position: 1, phase: "warm_up", title: "Pilates Breathing", state: "completed", variant: "standard", planned_seconds: 60 },
          { position: 2, phase: "main", title: "Pelvic Curl", state: "skipped", variant: "easier", planned_seconds: 60 },
          { position: 3, phase: "main", title: "Clam", state: "pending", variant: "standard", planned_seconds: 60 },
        ],
        feedback: { effort: completed.effort, discomfort: "yes", discomfort_urgent: false, regions: ["lower_back", "knee"], when: "after", discomfort_level: "mild", still_present: false, note: "a bit tight" },
        scan: { id: "sc2", completed_at: "2026-10-19", origin: "room", source: "demo_precomputed", reliability: "clear" },
      },
    });
    assert.equal((html.match(/class="pp-step"/g) || []).length, 3);
    assert.match(html, /data-state="completed"/);
    assert.match(html, /data-state="skipped"/);
    assert.match(html, /data-state="pending"/);
    assert.match(html, /pp-step-state/, "every step has a text label, not only a marker");
    assert.match(html, /href="#\/passport\/scans\?scan=sc2"/);
    assert.match(html, /Demo Gym/);
    assert.match(html, /Songdo/);
    assert.match(html, /a bit tight/);
    assert.match(html, /How strong: Mild|정도: 약함/, "the discomfort level line is shown");
    assert.match(html, /\b2\b/, "the pinned course version");
    assert.doesNotMatch(html.replace(/<[^>]+>/g, " "), FORBIDDEN);
    // Discomfort is neutral: reported as given, never classified.
    assert.doesNotMatch(html, /diagnos|진단|injur|부상|serious|심각/i);
  });

  test(`[${lang}] scans: the comparison shows two values and a difference and never calls either better`, () => {
    setLang(lang);
    const html = view.scansPage({ ...frame, items: [scan("sc2", { previous: { id: "sc1", comparable: true, reasons: [] } }), scan("sc1")] }, comparison);
    assert.match(html, /\+1\.20°/);
    assert.match(html, /\+1\.60°/);
    assert.match(html, /\+0\.40°/);
    assert.match(html, /2\.1/, "versions are shown");
    assert.match(html, /scan-sc2/);
    assert.match(html, /know yet how much this measurement varies|확인되지 않았어요/);
    assert.match(html, /not better or worse|더 낫거나 나쁜 것은 아니에요/);
    assert.doesNotMatch(html, /class="[^"]*(good|bad|better|worse|ok|danger|warn)[^"]*"[^>]*>[^<]*[+−]\d/, "a value is never coloured");
    assert.doesNotMatch(html.replace(/<[^>]+>/g, " "), FORBIDDEN);
    assert.doesNotMatch(html, /closer to level|further from level|수평에 가깝게/, "the server's directional wording is not shown");
  });

  test(`[${lang}] scans: every refusal reason code has its plain sentence and no values are shown`, () => {
    setLang(lang);
    const seen = new Set();
    for (const code of REASONS) {
      const html = view.comparisonPanel({ comparable: false, message: "x", reasons: [{ code, text: "SERVER TEXT" }] });
      assert.match(html, /isn(&#39;|')t enough comparable information yet|충분하지 않아요/);
      assert.doesNotMatch(html, /SERVER TEXT/, `${code} is mapped to the app's own copy`);
      assert.doesNotMatch(html, /pp-table/);
      seen.add(view.reasonText({ code, text: "SERVER TEXT" }));
    }
    assert.equal(seen.size, REASONS.length, "each code has its own sentence");
    assert.equal(view.reasonText({ code: "unknown_code", text: "Plain server text" }), "Plain server text");
    // With fewer than two scans there are no reasons, only the plain need for two scans.
    assert.match(view.comparisonPanel({ comparable: false, message: "x", reasons: [] }), /two scans|스캔가? 두 개/);
  });

  test(`[${lang}] scans: empty state, a scan that cannot be compared with the one before, labels and small print`, () => {
    setLang(lang);
    assert.match(view.scansPage({ ...frame, items: [] }, null), /pp-empty/);
    const html = view.scansPage({ ...frame, items: [scan("b", { origin: "room", source: "room_capture", previous: { id: "a", comparable: false, reasons: [{ code: "demo_vs_real", text: "" }] } }), scan("a")] }, null);
    assert.match(html, /<details class="pp-why">/);
    assert.match(html, /Camera scan|카메라 스캔/);
    assert.match(html, /Fictional demo scan|가상의 시연 스캔/);
    assert.match(html, /sedens-feedback-1\.0\.0/);
    assert.match(html, /left shoulder|왼쪽|slightly higher/);
  });

  test(`[${lang}] programs: a card has the facts and no play button`, () => {
    setLang(lang);
    const html = view.programsPage({ ...frame, items: [program, { ...program, course_id: "c2", cover_url: null, completed_at: "2026-10-01", next_session: null, next_eligible: false, creator: { display_name: "Prof", verification_state: "verified", verified: true }, origin: { code: "demo_purchase", label: "x" }, entitlement: { status: "revoked" } }] });
    assert.equal((html.match(/<article/g) || []).length, 2);
    assert.match(html, /src="\/sedens\/media\/file\?id=m1"/, "only the cover URL the API gave");
    assert.equal((html.match(/<img/g) || []).length, 1);
    assert.doesNotMatch(html, /<button/);
    assert.doesNotMatch(html, /<video|<audio/);
    assert.doesNotMatch(html, /href="\/room\.html"/);
    assert.match(html, /aria-valuenow="3"/);
    assert.match(html, /Core Basics/);
    assert.match(html, /Side Plank Prep/);
    assert.match(html, /Available in the AI Private Room|AI 프라이빗 룸에서 이용할 수 있어요/);
    assert.match(html, /Self-declared|본인이 밝힌 정보/);
    assert.match(html, /Verified by SEDENS|SEDENS 인증 완료/);
    assert.match(html, /never applied|적용되지 않아요/);
    const controls = [...html.matchAll(/<a [^>]*>([^<]*)<\/a>/g)].map((m) => m[1]);
    for (const text of controls) assert.doesNotMatch(text, PLAY, `link "${text}"`);
    assert.match(view.programsPage({ ...frame, items: [] }), /pp-empty/);
  });

  test(`[${lang}] achievements and preferences and privacy render, with only the controls the API supports`, () => {
    setLang(lang);
    const ach = view.achievementsPage({ ...frame, items: [{ id: "first_workout", date: "2026-10-01T00:00:00+00:00", origin: "demo_seed", fact: "You completed your first room workout." }] });
    assert.match(ach, /pp-timeline/);
    assert.match(ach, /pp-banner|sd-badge warn/);
    assert.match(view.achievementsPage({ ...frame, items: [] }), /pp-empty/);
    const prefs = view.preferencesPage({ ...frame, preferences: { exercise_style: "core", intensity: null, music: "calm", language: "ko", updated_at: null }, options: { exercise_style: ["pilates", "mobility", "core", "mixed"], intensity: ["light", "moderate"], music: ["off", "calm", "focus", "energy"], language: ["ko", "en"] } });
    assert.match(prefs, /<option value="core" selected>/);
    assert.match(prefs, /aria-live="polite"/);
    const texts = { scan_image_retention: { version: "v2", en: "Keep my photos.", ko: "사진 보관." }, scan_capture: { version: "v2", en: "Use the camera.", ko: "카메라." } };
    const privacy = (over = {}) => view.privacyPage({ ...frame, consent: { texts, current: { scan_capture: { granted: true, text_version: "v2", recorded_at: "2026-10-01T00:00:00+00:00", current_version: true }, scan_image_retention: { granted: true, text_version: "v2", recorded_at: "2026-10-02T00:00:00+00:00", current_version: true } } }, stored: ["Your room visits."], erasure_notice: "x", photos: { retained: 4, scans: 1 }, requests: [], ...over });
    const html = privacy();
    assert.match(html, /data-withdraw="scan_image_retention"/);
    assert.equal((html.match(/data-withdraw=/g) || []).length, 1, "only the optional photo keeping can be withdrawn here");
    assert.match(html, /data-photos-delete/);
    assert.match(html, /id="pp-photos-confirm"[^>]* hidden/, "the delete needs a confirm step");
    assert.match(html, /measurements|측정값/, "the confirm says measurements stay");
    assert.match(html, /v2/, "the text version is shown");
    assert.match(html, /href="\/sedens\/passport\/export"/);
    assert.match(html, /id="pp-erase"/);
    assert.match(html, /attendance and purchase records|출석과 구매 기록/);
    const noPhotos = privacy({ photos: { retained: 0, scans: 0 }, consent: { texts, current: { scan_capture: null, scan_image_retention: { granted: false, text_version: "v2", recorded_at: "2026-10-02T00:00:00+00:00", current_version: true } } } });
    assert.doesNotMatch(noPhotos, /data-photos-delete|data-withdraw=/, "no button for what there is nothing to do with");
    const open = privacy({ requests: [{ id: "r1", kind: "erase_passport", state: "received", requested_at: "2026-10-10T00:00:00+00:00", decided_at: null, message: "" }] });
    assert.match(open, /data-withdraw-request="r1"/);
    assert.doesNotMatch(open, /id="pp-erase"/, "one open request at a time");
    assert.doesNotMatch(html.replace(/<[^>]+>/g, " "), FORBIDDEN);
  });

  test(`[${lang}] the sign-in prompt and the staff explanation are plain pages with one h1`, () => {
    setLang(lang);
    for (const kind of ["signin", "staff"]) {
      const html = view.gate(kind);
      assert.equal((html.match(/<h1[ >]/g) || []).length, 1);
    }
    assert.match(view.gate("signin"), /href="#\/"/);
    assert.doesNotMatch(view.gate("staff"), /href="#\/"/);
  });
}

test("rendering escapes what the API sends", () => {
  setLang("en");
  const html = view.historyCard({ ...completed, title: '<img src=x onerror="alert(1)">' });
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(view.programCard({ ...program, title: "<script>x</script>" }), /<script>/);
});

test("progress bars carry a text equivalent and never overflow", () => {
  setLang("en");
  assert.match(view.progress(3, 12), /aria-valuetext="3 of 12 sessions done"/);
  assert.match(view.progress(3, 12), /width:25%/);
  assert.match(view.progress(15, 12), /width:100%/);
  assert.doesNotMatch(view.progress(0, 0), /progressbar/);
  assert.match(view.progress(0, 0), /No sessions/);
});

test("the stylesheet is linked, and its colours are tokens of the teal-silver identity", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /href="\/src\/sedens\/passport\.css"/);
  const css = readFileSync(new URL("../src/sedens/passport.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /#9fc0dd|#c9d8e6|159, 192, 221/i, "no old blue-silver accent");
  assert.doesNotMatch(css, /transition|animation/, "nothing moves in the Passport, so reduced motion has nothing to switch off");
  const base = readFileSync(new URL("../src/sedens/sedens.css", import.meta.url), "utf8");
  assert.match(base, /--sd-accent: #5dbdb1/);
});

test("the accent has enough contrast: 4.5:1 for text and 3:1 for controls", () => {
  const lum = (hex) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
  const surfaces = ["#0b0c0e", "#15171b", "#1d2026", "#12201f"];
  for (const s of surfaces) {
    assert.ok(ratio("#5dbdb1", s) >= 4.5, `accent on ${s}`);
    assert.ok(ratio("#b4d7d3", s) >= 4.5, `accent-strong on ${s}`);
    assert.ok(ratio("#9aa3ad", s) >= 4.5, `muted on ${s}`);
  }
  for (const s of surfaces.slice(0, 3)) assert.ok(ratio("#6b7480", s) >= 3, `control line on ${s}`);
  assert.ok(ratio("#0b0c0e", "#5dbdb1") >= 4.5, "dark text on the accent");
});

for (const lang of ["en", "ko"]) {
  test(`[${lang}] a workout shorter than a minute reads "under a minute"; only a workout with nothing recorded reads 0`, () => {
    setLang(lang);
    const under = /under a minute|1분 미만/;
    const zero = lang === "en" ? /\b0 min\b/ : /(^|[^\d])0분/;
    const short = { ...completed, active_minutes: 0, active_seconds: 40 };
    for (const html of [view.historyCard(short), view.workoutDetail({ ...frame, workout: { ...short, steps: [], feedback: null, where: {} } })]) {
      assert.match(html, under);
      assert.doesNotMatch(html.replace(/<[^>]+>/g, " "), zero);
    }
    const nothing = view.historyCard({ ...completed, active_minutes: 0, active_seconds: 0, exercises_total: 0 });
    assert.doesNotMatch(nothing, under);
    assert.match(nothing.replace(/<[^>]+>/g, " "), zero);
    const noSeconds = view.historyCard({ ...completed, active_minutes: 0, exercises_total: 0 });
    assert.match(noSeconds.replace(/<[^>]+>/g, " "), zero, "an older server without seconds keeps the minutes it sent");
    const totals = view.overview({ ...overviewData, totals: { ...overviewData.totals, active_minutes: 0, active_seconds: 25 } }, {});
    assert.match(totals, under);
    assert.match(view.overview({ ...overviewData, totals: { ...overviewData.totals, active_minutes: 140, active_seconds: 8400 } }, {}), lang === "en" ? /140 min/ : /140분/);
  });

  test(`[${lang}] scan version strings are behind a details control, not in the default text`, () => {
    setLang(lang);
    const html = view.scanCard(scan("sc1"));
    const [, visible] = html.split(/<details class="pp-why pp-tech">/);
    assert.ok(visible, "a details control holds the versions");
    assert.doesNotMatch(html.split("<details")[0].replace(/<[^>]+>/g, " "), /sedens-feedback|2\.1/);
  });
}
