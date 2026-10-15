// The room journey shell's rules (web/src/sedens/room-journey.js): which module draws
// each state, how the session choice is split, the effort scale, the feedback body,
// analytics hygiene and which problems have reviewed copy.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as J from "../src/sedens/room-journey.js";
import { STRINGS } from "../src/sedens/strings.js";

test("every server state has exactly one owner on the room screen", () => {
  const states = ["identified", "readiness", "readiness_blocked", "scan_intro", "scan_front", "scan_left", "scan_back",
    "scan_right", "scan_processing", "scan_result", "session_choice", "session_setup", "recommendation",
    "ready_to_train", "exercise", "exercise_paused", "session_complete", "ended"];
  const owners = Object.fromEntries(states.map((s) => [s, J.ownerOf(s)]));
  assert.deepEqual(owners, {
    identified: "shell", readiness: "shell", readiness_blocked: "shell",
    scan_intro: "scan", scan_front: "scan", scan_left: "scan", scan_back: "scan", scan_right: "scan", scan_processing: "scan",
    scan_result: "scan_result", session_choice: "shell", session_setup: "shell", recommendation: "shell",
    ready_to_train: "player", exercise: "player", exercise_paused: "player", session_complete: "shell", ended: "ended",
  });
  assert.equal(J.ownerOf("waiting"), null);
  assert.equal(J.ownerOf(undefined), null);
});

test("the journey states match the server's list", () => {
  const source = readFileSync(new URL("../../pilates/sedens/journey.py", import.meta.url), "utf8");
  const block = source.match(/STATES = \(([\s\S]*?)\)\n/)[1];
  const server = [...block.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]).sort();
  const client = [...J.SHELL_STATES, ...J.SCAN_STATES, "scan_result", ...J.TRAINING_STATES, "ended"].sort();
  assert.deepEqual(client, server);
});

const course = (id, extra) => ({ course_id: id, title: id, enrolled: false, featured: false, reason: "free_here", progress: null, ...extra });
const next = { module_title: "Weeks 1–2", module_number: 1, session_title: "Breath and brace", session_number: 1, session_id: "s1", estimated_minutes: 25 };

test("Path A is the enrolled course with a next session; Path B the other playable courses", () => {
  const enrolled = course("core", { enrolled: true, reason: "entitled", progress: { version: 1, next, done: 1, total: 4 } });
  const finished = course("done", { enrolled: true, reason: "entitled", progress: { version: 1, next: null, done: 2, total: 2 } });
  const paid = course("mobility", { reason: "purchase_required" });
  const free = course("standard");
  const paths = J.choicePaths({ courses: [free, finished, enrolled, paid], personalized: true });
  assert.equal(paths.resume, enrolled);
  assert.deepEqual(paths.others.map((c) => c.course_id), ["standard", "done"]);
  assert.equal(paths.personalized, true);
  assert.equal(J.nextSessionNumber(enrolled.progress), 2);
  assert.equal(J.nextSessionNumber(finished.progress), null);
});

test("without an enrolled course there is no Path A, and nothing breaks on an empty choice", () => {
  const paths = J.choicePaths({ courses: [course("core", { featured: true }), course("standard")], personalized: false });
  assert.equal(paths.resume, null);
  assert.equal(paths.others.length, 2);
  assert.equal(paths.personalized, false);
  assert.deepEqual(J.choicePaths(undefined), { resume: null, others: [], personalized: false });
});

const labels = [
  { from: 0, to: 0, text: "Sitting still" }, { from: 1, to: 2, text: "Barely working" }, { from: 3, to: 4, text: "Comfortable" },
  { from: 5, to: 6, text: "Steady" }, { from: 7, to: 8, text: "Tough" }, { from: 9, to: 9, text: "Near my limit" },
  { from: 10, to: 10, text: "All-out" },
];

test("each of the eleven effort numbers carries the server's band label", () => {
  const each = J.effortLabels(labels);
  assert.equal(each.length, 11);
  assert.equal(each[0], "Sitting still");
  assert.equal(each[2], "Barely working");
  assert.equal(each[6], "Steady");
  assert.equal(each[10], "All-out");
  const bands = J.effortBands([...labels].reverse());
  assert.deepEqual(bands.map((b) => [b.from, b.span]), [[0, 1], [1, 2], [3, 2], [5, 2], [7, 2], [9, 1], [10, 1]]);
  assert.equal(bands.reduce((sum, b) => sum + b.span, 0), 11);
  assert.deepEqual(J.effortBands([{ from: 4, to: 2, text: "bad" }, { from: 0, to: 11, text: "bad" }]), []);
});

test("the feedback body sends only what was answered", () => {
  assert.deepEqual(J.feedbackBody({ effort: 5, discomfort: "no", note: "  " }), { effort: 5, discomfort: "no" });
  assert.deepEqual(J.feedbackBody({ effort: null, discomfort: "no", note: " Lovely room " }), { effort: null, discomfort: "no", note: "Lovely room" });
  assert.deepEqual(J.feedbackBody({ effort: 11, discomfort: "maybe" }), { effort: null, discomfort: null });
  assert.deepEqual(J.feedbackBody({ effort: 7, discomfort: "yes", urgent: true, regions: ["knee"], note: "help" }),
    { effort: 7, discomfort: "yes", urgent: true });
  assert.deepEqual(J.feedbackBody({ effort: 3, discomfort: "yes", urgent: false, regions: ["knee", "knee", "hip"], when: "during", strength: null, still: false }),
    { effort: 3, discomfort: "yes", urgent: false, regions: ["knee", "hip"], when: "during", still: false });
  assert.equal(J.feedbackBody({ discomfort: "no", note: "x".repeat(400) }).note.length, J.NOTE_MAX);
});

test("analytics props keep snake_case keys and short codes, never free text or personal keys", () => {
  assert.deepEqual(J.safeProps({ screen: "session_choice", step_index: 3, ok: true }), { screen: "session_choice", step_index: 3, ok: true });
  assert.deepEqual(J.safeProps({ note: "abc", first_name: "Sarah", answer: "yes", text: "x", pin: "1" }), {});
  assert.deepEqual(J.safeProps({ screen: "I felt dizzy today", Screen: "x", "bad-key": "x", value: Infinity, obj: { a: 1 } }), {});
  const many = Object.fromEntries(Array.from({ length: 30 }, (_, i) => ["k" + i, i]));
  assert.equal(Object.keys(J.safeProps(many)).length, 16);
  assert.deepEqual([...J.CLIENT_EVENTS].sort(), ["anatomy_opened", "exercise_skipped", "exercise_started", "music_changed",
    "narration_toggled", "room_screen_viewed", "scan_result_viewed", "structure_isolated"]);
});

test("the client event list matches the server's CLIENT_EVENTS", () => {
  const source = readFileSync(new URL("../../pilates/sedens/analytics.py", import.meta.url), "utf8");
  const block = source.match(/CLIENT_EVENTS = frozenset\(\{([\s\S]*?)\}\)/)[1];
  assert.deepEqual([...block.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]).sort(), [...J.CLIENT_EVENTS].sort());
});

test("every known problem has reviewed copy in both languages; unknown ones fall back safely", () => {
  for (const code of J.KNOWN_ERRORS) {
    for (const language of ["en", "ko"]) assert.ok(STRINGS[language]["rj.err_" + code], `${language} rj.err_${code}`);
  }
  assert.equal(J.errorKey({ status: 409, code: "journey_changed" }), "rj.err_journey_changed");
  assert.equal(J.errorKey({ status: 400, code: "something_new" }), null);
  assert.equal(J.errorKey({ status: 503, code: "" }), "rj.err_generic");
  assert.equal(J.errorKey({ status: 0, code: "upload_interrupted" }), "rj.err_network");
  assert.equal(J.errorKey(new TypeError("Failed to fetch")), "rj.err_network");
  assert.ok(J.ENDED_CODES.includes("room_session_idle"));
});

test("dynamic copy keys used by the room screen exist", () => {
  for (const phase of ["warm_up", "main", "cool_down"]) assert.ok(STRINGS.en["rj.phase_" + phase] && STRINGS.ko["rj.phase_" + phase]);
});

test("a notice already on the screen is not repeated in the banner", () => {
  const notice = { code: "thanks", text: "Thank you. Your session is saved." };
  assert.equal(J.bannerText(notice, "Session complete … Thank you. Your session is saved."), "");
  assert.equal(J.bannerText(notice, "Something else"), "Thank you. Your session is saved.");
  assert.equal(J.bannerText(null, "x"), "");
  assert.equal(J.bannerText({ code: "x" }, "x"), "");
});

test("safety stops are recognised, and only an urgent one counts as urgent", () => {
  assert.equal(J.safetyStopped({ summary: { end_reason: "customer_ended", safety_category: null } }), false);
  assert.equal(J.safetyStopped({ summary: { end_reason: "safety_stop", safety_category: "dizzy" } }), true);
  assert.equal(J.safetyStopped({ safety: { title: null, body: "Rest" }, summary: {} }), true);
  assert.equal(J.urgentStop({ summary: { safety_category: "dizzy" } }), false);
  assert.equal(J.urgentStop({ summary: { safety_category: "urgent" } }), true);
});

test("plan steps are grouped by phase in order", () => {
  const groups = J.stepsByPhase([
    { title: "a", phase: "warm_up" }, { title: "b", phase: "main" }, { title: "c", phase: "cool_down" }, { title: "d", phase: "main" },
  ]);
  assert.deepEqual(groups.map((g) => [g.phase, g.steps.map((s) => s.title).join("")]), [["warm_up", "a"], ["main", "bd"], ["cool_down", "c"]]);
  assert.equal(J.minutesValue(0), 0);
  assert.equal(J.minutesValue(29.6), 30);
});

test("the room screen keeps tokens out of page storage and asks the server for the session", () => {
  const room = readFileSync(new URL("../src/sedens/room.js", import.meta.url), "utf8");
  assert.doesNotMatch(room, /document\.cookie/);
  assert.doesNotMatch(room, /localStorage/);
  assert.match(room, /sedens\("room\/session"\)/);
  // The placeholder home of Phase 2 is gone: courses play through course/start and the player.
  assert.doesNotMatch(room, /room\/library|room\/course\/complete|room\/course\/session/);
});

test("the shell hands the scan and the player the full ctx of docs/SEDENS_ROOM_FLOW.md §3", () => {
  const room = readFileSync(new URL("../src/sedens/room.js", import.meta.url), "utf8");
  const body = room.match(/function makeCtx\(\) \{\s*return \{([\s\S]*?)\n  \};/)[1];
  const keys = [...body.matchAll(/^\s{4}([a-zA-Z]+)[,:]/gm)].map((m) => m[1]).sort();
  assert.deepEqual(keys, ["act", "event", "journey", "lang", "main", "markActivity", "refresh", "rerender", "session", "t", "upload"]);
  // The scan and the player are driven only through their fixed entry points.
  assert.match(room, /import \{ renderScan, renderScanResult, stopScan \} from "\.\/room-scan\.js"/);
  assert.match(room, /import \{ mountPlayer \} from "\.\/room-player\.js"/);
  assert.match(room, /state\.player\.update\(state\.ctx\)/);
});

test("the room journey copy makes no body grades, medical claims or form judgements", () => {
  const banned = [
    /score/i, /\d\s*%/, /grade/i, /correct|fix(es)? your posture/i, /prevents? injur/i, /injury risk/i, /clinical/i,
    /supervised by/i, /muscle activation/i, /diagnos/i, /perfect form/i, /is wrong/i, /\b(red|yellow|green)\b/i,
    /점수/, /등급/, /진단/, /임상/, /부상 예방/, /자세 교정/, /근육 활성/,
  ];
  for (const language of ["en", "ko"]) {
    for (const [key, value] of Object.entries(STRINGS[language])) {
      if (!key.startsWith("rj.")) continue;
      for (const pattern of banned) assert.doesNotMatch(value, pattern, `${language}.${key}`);
    }
  }
  assert.match(STRINGS.en["room.help"], /119/);
  assert.match(STRINGS.ko["room.help"], /119/);
});

test("the texts the entry flow relies on are still drawn by the room screen", () => {
  const room = readFileSync(new URL("../src/sedens/room.js", import.meta.url), "utf8");
  for (const key of ["room.not_paired", "room.use_demo", "room.welcome", "room.enter", "room.session_title", "room.ended", "room.idle_ended", "common.simulated"]) {
    assert.ok(room.includes(`t("${key}"`), key);
  }
  assert.equal(STRINGS.en["room.not_paired"], "This screen is not a SEDENS room yet");
  assert.equal(STRINGS.en["room.ended"], "Session ended. Thank you.");
});
