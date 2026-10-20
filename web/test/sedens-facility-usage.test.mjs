// Facility usage page (src/sedens/facility-usage.js): the pure rendering helpers, the copy in both
// languages, and what the page must never show (revenue, scores, customer identities).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let language = "en";
globalThis.localStorage = { getItem: () => language, setItem() {} };
const { setLang } = await import("../src/sedens/i18n.js");
const { STRINGS } = await import("../src/sedens/strings.js");
const { USAGE } = await import("../src/sedens/strings-usage.js");
const page = await import("../src/sedens/facility-usage.js");

const use = (value) => {
  language = value;
  setLang(value);
};

const sample = (over = {}) => ({
  month: "2026-09",
  timezone: "Asia/Seoul",
  window: { from: "2026-09-01", to: "2026-09-30" },
  months: { first: "2025-01", last: "2026-10" },
  demonstration: { flagged: false, organization: false, simulated_devices: 0, simulated_visits: 0, never_invoiced: true },
  metrics: {
    room_sessions: 12, completed_workouts: 9, incomplete_workouts: 3, used_minutes: 215, billable_sessions: 8,
    licensed_rooms: 2, repeat_customers: 3, technical_failures: 1, scan_retakes: 4,
  },
  duration_bands: [
    { band: "under_10", from_seconds: 0, to_seconds: 600, sessions: 1 },
    { band: "from_10_to_20", from_seconds: 600, to_seconds: 1200, sessions: 4 },
    { band: "from_20_to_30", from_seconds: 1200, to_seconds: 1800, sessions: 2 },
    { band: "over_30", from_seconds: 1800, to_seconds: null, sessions: 1 },
  ],
  program_types: ["standard", "coach", "professor", "expert", "editorial", "other"].map((type, i) => ({ type, workouts: i })),
  simulation: {
    invoice: false, payment_taken: false, vat_included: false, currency: "KRW",
    plan: { id: "proposal-2026-10", label: "Proposed B2B pricing (October 2026)", currency: "KRW", room_month_minor: 99000, per_session_minor: 250, vat_included: false, assigned: false },
    inputs: { licensed_rooms: 2, billable_sessions: 8 }, room_fee: 198000, session_fee: 2000, total: 200000,
    formula: "licensed_rooms * room_month + billable_sessions * per_session",
  },
  definitions: {
    billable_unit: "visit_with_completed_workout",
    counts: ["completed_workout_step", "one_per_visit"],
    not_counted: ["stopped_or_abandoned_only", "all_steps_skipped", "retry_or_repeat_request", "second_workout_same_visit", "seeded_demo_history", "analytics_events", "drafts"],
    month_timezone: "facility_timezone", visit_month: "visit_start", licensed_room: "screen_active_in_month",
    creator_type: "as_currently_declared", amounts: "whole_won_vat_excluded",
  },
  ...over,
});

test("months shift across a year and refuse text that is not a month", () => {
  assert.equal(page.shiftMonth("2026-09", -1), "2026-08");
  assert.equal(page.shiftMonth("2026-01", -1), "2025-12");
  assert.equal(page.shiftMonth("2026-12", 1), "2027-01");
  for (const bad of ["2026-13", "2026-9", "", null, "2026-09-01", "abc"]) assert.equal(page.shiftMonth(bad, 1), null);
  assert.equal(page.monthHref("2026-09"), "#/facility/usage?month=2026-09");
});

test("the month label reads naturally in both languages", () => {
  assert.equal(page.monthLabel("2026-09", "en"), "September 2026");
  assert.equal(page.monthLabel("2026-09", "ko"), "2026년 9월");
  assert.equal(page.monthLabel("nope", "en"), "");
});

test("the month picker links to both neighbours and disables the ends of the range", () => {
  use("en");
  const middle = page.monthNav(sample(), "en");
  assert.match(middle, /href="#\/facility\/usage\?month=2026-08"/);
  assert.match(middle, /href="#\/facility\/usage\?month=2026-10"/);
  assert.match(middle, /September 2026/);
  const newest = page.monthNav(sample({ month: "2026-10" }), "en");
  assert.match(newest, /aria-disabled="true"/);
  assert.doesNotMatch(newest, /month=2026-11/);
  const oldest = page.monthNav(sample({ month: "2025-01" }), "en");
  assert.match(oldest, /aria-disabled="true"/);
  assert.doesNotMatch(oldest, /month=2024-12/);
});

test("the tiles show every count the server sends, billable visits first", () => {
  use("en");
  const html = page.tiles(sample().metrics, "en");
  assert.ok(html.indexOf("Billable visits") < html.indexOf("Room visits"));
  for (const label of ["Billable visits", "Room visits", "Completed workouts", "Workouts not finished", "Exercise minutes", "Licensed rooms", "Returning customers", "Scan problems", "Scan retakes"]) {
    assert.ok(html.includes(label), label);
  }
  assert.match(html, /<dd>215<\/dd>/);
  assert.equal((html.match(/<dt>/g) || []).length, 9);
});

test("the duration bands and the program split list every band and type in order", () => {
  use("en");
  const html = page.usageHtml(sample(), "en");
  const order = ["Under 10 min", "10 to 20 min", "20 to 30 min", "30 min or more"].map((s) => html.indexOf(s));
  assert.ok(order.every((n) => n > 0) && [...order].sort((a, b) => a - b).join() === order.join());
  for (const label of ["SEDENS Standard", "Coach courses", "Professor courses", "Expert courses", "SEDENS editorial courses", "Other courses"]) {
    assert.ok(html.includes(label), label);
  }
  assert.match(html, /as currently declared|currently declares/);
  assert.deepEqual(page.bandRows(sample()).map((r) => r.count), [1, 4, 2, 1]);
  assert.equal(page.programRows(sample()).length, 6);
  assert.match(html, /width:100%/);
});

test("the simulation is labelled as not an invoice, VAT excluded, with the plan and the arithmetic", () => {
  use("en");
  const html = page.usageHtml(sample(), "en");
  assert.ok(html.includes("Simulation — not an invoice. VAT excluded. No payment is taken."));
  assert.ok(html.includes("Proposed B2B pricing (October 2026)"));
  assert.match(html, /Rooms: 2 × ₩99,000 a month/);
  assert.match(html, /Billable visits: 8 × ₩250/);
  assert.match(html, /₩198,000/);
  assert.match(html, /₩2,000/);
  assert.match(html, /₩200,000/);
  assert.ok(html.includes("Licensed rooms × monthly room price + billable visits × price per visit"));
  use("ko");
  const ko = page.usageHtml(sample(), "ko");
  assert.ok(ko.includes("시뮬레이션이에요 — 청구서가 아니에요. 부가세 별도. 결제는 이뤄지지 않아요."));
  assert.match(ko, /₩200,000/);
  use("en");
});

test("a plan that includes VAT says so, and a facility without a plan is told there is nothing to simulate", () => {
  use("en");
  const vat = sample();
  vat.simulation.vat_included = true;
  assert.ok(page.usageHtml(vat, "en").includes("VAT included"));
  assert.doesNotMatch(page.usageHtml(vat, "en"), /VAT excluded/);
  assert.match(page.usageHtml(sample({ simulation: null }), "en"), /No price plan is set up yet/);
});

test("the definitions explain what counts and what does not, in plain words", () => {
  use("en");
  const html = page.definitionsHtml(sample());
  for (const phrase of [
    "started in this month", "counts once, however many workouts", "stopped early or left unfinished", "every step was skipped",
    "retry or a repeated completion request", "second workout in the same visit", "Sample history added for a demonstration",
    "analytics events", "time zone (Asia/Seoul)", "currently declared by each creator",
  ]) assert.ok(html.includes(phrase) || html.toLowerCase().includes(phrase.toLowerCase()), phrase);
  assert.equal((html.match(/<li>/g) || []).length, 2 + 7 + 4);
});

test("a demonstration is flagged and said never to be invoiced; a real facility is not", () => {
  use("en");
  const demo = page.usageHtml(sample({ demonstration: { flagged: true, organization: true, simulated_devices: 1, simulated_visits: 0, never_invoiced: true } }), "en");
  assert.match(demo, /Demonstrations are never invoiced/);
  assert.doesNotMatch(page.usageHtml(sample(), "en"), /never invoiced/);
});

test("the page shows totals only: no revenue, sales, scores or customer identities", () => {
  for (const value of ["en", "ko"]) {
    use(value);
    const html = page.usageHtml(sample(), value);
    assert.doesNotMatch(html, /revenue|sales|score|calorie|profit|매출|판매|점수|칼로리|수익/i);
    assert.match(html, /Totals only|합계만/);
  }
  use("en");
  // Markup built from server text is escaped.
  const evil = sample();
  evil.simulation.plan.label = "<img src=x onerror=alert(1)>";
  assert.doesNotMatch(page.usageHtml(evil, "en"), /<img/);
});

test("every usage string exists in English and Korean with the same placeholders, and is merged once", () => {
  const keys = (l) => Object.keys(USAGE[l]).sort();
  assert.deepEqual(keys("ko"), keys("en"));
  const holders = (s) => (s.match(/\{\w+\}/g) || []).sort().join();
  for (const key of keys("en")) {
    assert.ok(USAGE.en[key].trim() && USAGE.ko[key].trim(), key);
    assert.equal(holders(USAGE.en[key]), holders(USAGE.ko[key]), key);
    assert.equal(STRINGS.en[key], USAGE.en[key], key);
    assert.equal(STRINGS.ko[key], USAGE.ko[key], key);
  }
});

test("every key the page can compose has copy: tiles, bands, programs, definitions", () => {
  const data = sample();
  const needed = [
    ...data.duration_bands.map((b) => "usage.band_" + b.band),
    ...data.program_types.map((p) => "usage.program_" + p.type),
    ...page.COUNTED.map((k) => "usage.def_counts_" + k),
    ...page.NOT_COUNTED.map((k) => "usage.def_no_" + k),
  ];
  for (const key of needed) for (const l of ["en", "ko"]) assert.ok(STRINGS[l][key], `${l}.${key}`);
});

test("the definition keys match what the server reports", () => {
  const source = readFileSync(new URL("../../pilates/sedens/usage.py", import.meta.url), "utf8");
  const block = (name) => {
    const found = new RegExp(`"${name}": \\(([^)]*)\\)`).exec(source);
    return [...found[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  };
  assert.deepEqual(block("counts"), page.COUNTED);
  assert.deepEqual(block("not_counted"), page.NOT_COUNTED);
});

test("the Korean copy keeps the polite spoken register and avoids outcome claims", () => {
  for (const [key, value] of Object.entries(USAGE.ko)) assert.ok(!/습니다|합니다/.test(value), key);
  assert.ok(USAGE.ko["usage.sim_banner"].includes("청구서가 아니에요"));
});

test("the page is routed from the facility console and the route is registered", () => {
  const app = readFileSync(new URL("../src/sedens/app.js", import.meta.url), "utf8");
  assert.match(app, /\["facility\/usage", "facility_usage"\]/);
  assert.match(app, /facility_usage: \["\.\/facility-usage\.js", "facilityUsage"\]/);
  assert.match(app, /href="#\/facility\/usage"/);
});
