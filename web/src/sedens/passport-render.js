// Fitness Passport pages as HTML strings. Pure functions of an API payload (no DOM, no network), so the
// tests render fixtures. passport.js fetches the payloads, draws them and binds the buttons.
//
// What this file never does: show a calorie, a score, a muscle or strength figure, an injury claim, or a
// judgement of a measured difference. It shows what was recorded and when. Guided sessions are never
// started from here: a program says its next session is available in the AI Private Room.
import { t, lang } from "./i18n.js";
import { esc, date } from "./ui.js";
import { PASSPORT_SECTIONS } from "./passport-routes.js";
import { activitySection } from "./account-render.js";

const number = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const list = (value) => (Array.isArray(value) ? value : []);
/** A translated label for a code, falling back to the server's text, then the code itself. */
const word = (prefix, code, fallback) => {
  const key = prefix + code;
  const text = t(key);
  return text !== key ? text : fallback || String(code ?? "");
};
/** Minutes as people read them. A workout of 1 to 59 seconds is "under a minute", not "0 min"; 0 stays 0 (nothing recorded). */
const minutes = (n, seconds) => {
  const s = Number(seconds);
  return Number.isFinite(s) && s > 0 && s < 60 ? t("pp.under_minute") : t("pp.unit_minutes", { n: number(n) });
};
const badge = (text, kind = "") => `<span class="sd-badge ${kind}">${esc(text)}</span>`;
const demoBadge = (origin) => (origin === "demo_seed" ? badge(t("pp.demo_badge"), "warn") : "");

// -- shell ----------------------------------------------------------------------------------

export function nav(active) {
  const items = PASSPORT_SECTIONS.map(
    ([id, path]) => `<li><a href="#/${path}"${id === active ? ' aria-current="page"' : ""}>${esc(t("pp.nav_" + id))}</a></li>`,
  ).join("");
  return `<nav class="pp-nav" aria-label="${esc(t("pp.nav_label"))}"><ul>${items}</ul></nav>`;
}

/**
 * The demonstration notice that belongs on every Passport page. The free-deployment warning is not repeated
 * here: the site-wide storage banner (ui.js header) already shows it on every page in demo_free. The overview
 * keeps the notice to one short paragraph; the counts of fictional records are listed on the other pages.
 */
export function banners(data = {}, { seeds = true } = {}) {
  const seed = data.totals?.demo_seed || {};
  const lines = !seeds ? [] : [
    number(seed.visits) > 0 ? t("pp.demo_seed_visits", { n: number(seed.visits) }) : "",
    number(seed.studio_sessions) > 0 ? t("pp.demo_seed_studio", { n: number(seed.studio_sessions) }) : "",
    number(seed.scans) > 0 ? t("pp.demo_seed_scans", { n: number(seed.scans) }) : "",
  ].filter(Boolean);
  const demo = data.demo
    ? `<div class="pp-banner pp-banner-demo" role="note"><p><strong>${esc(t("pp.demo_banner_title"))}</strong> ${esc(t("pp.demo_banner_body"))}</p>${lines.map((l) => `<p>${esc(l)}</p>`).join("")}</div>`
    : "";
  return demo;
}

/** One Passport page: eyebrow, the page's only h1, the section bar, the notices and the body. */
export function shell({ title, active, body, data = {}, eyebrow = "", back = "", wide = false }) {
  return `<div class="pp">${back}<p class="sd-eyebrow">${esc(eyebrow || t("pp.eyebrow"))}</p><h1>${esc(title)}</h1>${nav(active)}${banners(data, { seeds: active !== "overview" })}<div class="pp-body${wide ? " pp-overview" : ""}">${body}</div></div>`;
}

/** A progress bar with its text next to it (the bar alone is not the information). */
export function progress(done, total) {
  const d = number(done);
  const n = number(total);
  if (n <= 0) return `<p class="pp-progress-text">${esc(t("pp.progress_none"))}</p>`;
  const text = t("pp.progress_text", { done: d, total: n });
  const percent = Math.max(0, Math.min(100, Math.round((d / n) * 100)));
  return `<div class="pp-progress"><div class="pp-bar" role="progressbar" aria-label="${esc(text)}" aria-valuemin="0" aria-valuemax="${n}" aria-valuenow="${Math.min(d, n)}" aria-valuetext="${esc(text)}"><span style="width:${percent}%"></span></div><p class="pp-progress-text">${esc(text)}</p></div>`;
}

const section = (id, heading, body, extra = "") =>
  `<section class="pp-card ${extra}" aria-labelledby="${id}"><h2 id="${id}">${esc(heading)}</h2>${body}</section>`;

// -- cards shared by the overview and the history -----------------------------------------------

export const statusLabel = (code, fallback) => word("pp.status_", code, fallback);

export function effortText(effort) {
  return effort && effort.value !== null && effort.value !== undefined ? t("pp.effort_value", { n: number(effort.value) }) : "";
}

const roomTitle = (card) => card.title || t("pp.card_room");

/** The facts of one room workout as a definition list. */
function roomFacts(card, facility) {
  const rows = [
    [t("pp.f_status"), statusLabel(card.status, card.status_label)],
    facility ? [t("pp.f_facility"), facility] : null,
    [t("pp.f_program"), [roomTitle(card), card.focus].filter(Boolean).join(" · ")],
    [t("pp.f_duration"), minutes(card.active_minutes, card.active_seconds)],
    [t("pp.f_completed"), String(number(card.exercises_completed))],
    [t("pp.f_skipped"), String(number(card.exercises_skipped))],
    [t("pp.f_effort"), effortText(card.effort) || t("pp.effort_none")],
  ].filter(Boolean);
  return `<dl class="pp-facts">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>`;
}

function studioFacts(card) {
  const by = card.recorder ? t("pp.card_by", { name: card.recorder }) : t("pp.card_by_unknown");
  return `<dl class="pp-facts"><div><dt>${esc(t("pp.card_studio"))}</dt><dd>${esc(by)}</dd></div><div><dt>${esc(t("pp.f_completed"))}</dt><dd>${esc(String(number(card.exercises_completed)))}</dd></div></dl>`;
}

/** One history card. Studio cards show who recorded the session and the exercises only. */
export function historyCard(card, { facility = "" } = {}) {
  const when = date(card.date);
  if (card.kind === "studio") {
    return `<article class="pp-item pp-studio" data-kind="studio"><header><h2 tabindex="-1">${esc(when)}</h2>${demoBadge(card.origin)}</header>${studioFacts(card)}</article>`;
  }
  const ended = card.ended_for_safety ? `<p class="pp-muted">${esc(t("pp.safety_stop"))}</p>` : "";
  return `<article class="pp-item pp-room" data-kind="room" data-status="${esc(card.status)}"><header><h2 tabindex="-1">${esc(when)}</h2>${demoBadge(card.origin)}</header>${roomFacts(card, facility)}${ended}<a class="sd-button pp-link" href="#/passport/workout/${encodeURIComponent(card.id)}" aria-label="${esc(t("pp.card_open_aria", { date: when }))}">${esc(t("pp.card_open"))}</a></article>`;
}

export function historyPage(data, { facility = "" } = {}) {
  const items = list(data.items);
  const body = items.length
    ? `<div id="pp-history-list" class="pp-list">${items.map((c) => historyCard(c, { facility })).join("")}</div>`
    : `<p class="pp-empty">${esc(t("pp.hist_empty"))}</p>`;
  const more = data.next_before
    ? `<button class="pp-more" id="pp-more" data-before="${esc(data.next_before)}">${esc(t("pp.hist_more"))}</button>`
    : items.length
      ? `<p class="pp-muted" id="pp-end">${esc(t("pp.hist_end"))}</p>`
      : "";
  return `<p class="pp-lead">${esc(t("pp.hist_lead"))}</p>${body}${more}<p id="pp-status" class="sd-visually-hidden" role="status" aria-live="polite" tabindex="-1"></p>`;
}

// -- overview ---------------------------------------------------------------------------------

function latestWorkout(card, facility) {
  if (!card) return section("pp-latest", t("pp.ov_latest"), `<p class="pp-empty">${esc(t("pp.ov_latest_empty"))}</p>`, "pp-hero");
  const when = date(card.date);
  const effort = effortText(card.effort);
  const counts = card.exercises_total
    ? `${minutes(card.active_minutes, card.active_seconds)} · ${t("pp.card_exercises", { n: number(card.exercises_completed) })}`
    : minutes(card.active_minutes, card.active_seconds);
  return section(
    "pp-latest",
    t("pp.ov_latest"),
    `<p class="pp-hero-title">${esc(roomTitle(card))} ${demoBadge(card.origin)}</p><p class="pp-muted">${esc([card.focus, when, facility].filter(Boolean).join(" · "))}</p><p class="pp-hero-line">${badge(statusLabel(card.status, card.status_label), card.status === "completed" ? "ok" : "info")} <span>${esc(counts)}</span>${effort ? ` <span>${esc(t("pp.f_effort"))}: ${esc(effort)}</span>` : ""}</p><a class="sd-button" href="#/passport/workout/${encodeURIComponent(card.id)}" aria-label="${esc(t("pp.ov_details_aria", { date: when }))}">${esc(t("pp.ov_details"))}</a>`,
    "pp-hero",
  );
}

/** The one obvious next action: never a way to start a guided session outside the room. */
export function nextAction(data) {
  let key = "history";
  let href = "#/passport/history";
  if (data.next_session) {
    key = "program";
    href = "#/passport/programs";
  } else if (!number(data.totals?.workouts?.completed) && !number(data.totals?.workouts?.stopped) && !number(data.totals?.workouts?.not_finished)) {
    key = "browse";
    href = "#/courses";
  }
  return section(
    "pp-next",
    t("pp.ov_next"),
    `<p>${esc(t(`pp.next_${key}_body`))}</p><a class="sd-primary pp-cta" href="${href}">${esc(t(`pp.next_${key}_action`))}</a>`,
    "pp-next",
  );
}

function stats(data) {
  const totals = data.totals || {};
  const effort = data.last_effort;
  const items = [
    [t("pp.stat_visits"), String(number(totals.completed_visits))],
    [t("pp.stat_minutes"), minutes(totals.active_minutes, totals.active_seconds)],
    [t("pp.stat_effort"), effort ? t("pp.stat_effort_value", { n: number(effort.value) }) : t("pp.stat_effort_none"), !effort],
  ];
  return `<section class="pp-card" aria-labelledby="pp-stats"><h2 id="pp-stats" class="sd-visually-hidden">${esc(t("pp.ov_stats"))}</h2><dl class="pp-stats">${items.map(([k, v, none]) => `<div><dt>${esc(k)}</dt><dd${none ? ' class="pp-stat-none"' : ""}>${esc(v)}</dd></div>`).join("")}</dl></section>`;
}

/** The next session as the room names it: "<module> · <session>", then "Session n of total" on the next line. */
const sessionLabel = (next) => [next?.module_title, next?.session_title].filter(Boolean).join(" · ");
const sessionNumber = (sessions) => Math.min(sessions?.total || 0, (sessions?.done || 0) + 1);

/** The program being followed with its next session, or null when there is none (nextAction takes its place). */
function currentProgram(data) {
  const program = data.current_program;
  const next = data.next_session;
  if (!program || !next) return null;
  const place = t("pp.session_of", { n: number(sessionNumber(program.sessions)), total: number(program.sessions?.total) });
  return section(
    "pp-program",
    t("pp.ov_program"),
    `<p class="pp-hero-title">${esc(program.title || next.title)}</p>${progress(program.sessions?.done, program.sessions?.total)}<p class="pp-next-session"><strong>${esc(t("pp.ov_program_next"))}:</strong> ${esc(sessionLabel(next))}</p><p class="pp-muted">${esc(place)}${next.estimated_minutes ? ` · ${esc(minutes(next.estimated_minutes))}` : ""}</p><p class="pp-room-only">${esc(t("pp.room_only"))}</p><a class="sd-primary pp-cta" href="#/passport/programs">${esc(t("pp.next_program_action"))}</a>`,
    "pp-next",
  );
}

function recent(data) {
  const items = list(data.recent);
  const rows = items
    .map((c) => {
      const when = date(c.date);
      if (c.kind === "studio") {
        return `<li><span class="pp-when">${esc(when)}</span><span>${esc(t("pp.card_studio"))} · ${esc(t("pp.card_exercises", { n: number(c.exercises_completed) }))} ${demoBadge(c.origin)}</span></li>`;
      }
      return `<li><span class="pp-when">${esc(when)}</span><span>${esc(roomTitle(c))} · ${esc(statusLabel(c.status, c.status_label))} · ${esc(minutes(c.active_minutes, c.active_seconds))} ${demoBadge(c.origin)}</span></li>`;
    })
    .join("");
  return section(
    "pp-recent",
    t("pp.ov_recent"),
    `${rows ? `<ul class="pp-plain pp-rows">${rows}</ul>` : `<p class="pp-empty">${esc(t("pp.ov_recent_empty"))}</p>`}${rows ? `<a class="pp-textlink" href="#/passport/history">${esc(t("pp.ov_see_history"))}</a>` : ""}`,
  );
}

function categories(data) {
  const items = list(data.categories);
  const body = items.length
    ? `<p class="pp-muted">${esc(t("pp.ov_categories_note"))}</p><ul class="pp-chips">${items.map((c) => `<li class="pp-chip">${esc(t("pp.ov_category_item", { label: c.label || c.id, n: number(c.completed) }))}</li>`).join("")}</ul>`
    : `<p class="pp-empty">${esc(t("pp.ov_categories_empty"))}</p>`;
  return section("pp-categories", t("pp.ov_categories"), body);
}

function scanLine(data) {
  const scans = data.scans || {};
  const n = number(scans.complete);
  let line = t("pp.ov_scans_none");
  if (n === 1) line = t("pp.ov_scans_have_one", { date: date(scans.latest?.date) });
  else if (n > 1) line = t("pp.ov_scans_have", { n, date: date(scans.latest?.date) });
  return section("pp-scan-line", t("pp.ov_scans"), `<p>${esc(line)}</p>${n ? `<a class="pp-textlink" href="#/passport/scans">${esc(t("pp.ov_scans_open"))}</a>` : ""}`);
}

/** Other courses only: the program shown above is not repeated. Nothing at all when there are none. */
function courseBars(data) {
  const shown = data.next_session ? data.current_program?.course_id : null;
  const items = list(data.courses).filter((c) => c.course_id === undefined || c.course_id !== shown);
  if (!items.length) return "";
  const body = `<ul class="pp-plain">${items.map((c) => `<li><p class="pp-course-title">${esc(c.title)}</p>${progress(c.sessions?.done, c.sessions?.total)}</li>`).join("")}</ul><a class="pp-textlink" href="#/passport/programs">${esc(t("pp.ov_courses_all"))}</a>`;
  return section("pp-courses", t("pp.ov_courses"), body);
}

/** The overview: what a customer should take in within seconds. No measurements. */
export function overview(data, { facility = "", back = "" } = {}) {
  // The latest workout and the totals come first; the program (or the one next step) follows, once.
  const program = currentProgram(data);
  const body = `${latestWorkout(data.latest_workout, facility)}${stats(data)}${program || nextAction(data)}${courseBars(data)}${recent(data)}${categories(data)}${scanLine(data)}`;
  return shell({ title: t("pp.title"), eyebrow: facility ? t("pp.at_facility", { facility }) : "", active: "overview", body, data, back, wide: true });
}

// -- one workout ------------------------------------------------------------------------------

const STEP_MARK = { completed: "✓", skipped: "–", pending: "○", active: "…" };

export function stepRow(step) {
  const state = STEP_MARK[step.state] ? step.state : "pending";
  const variant = step.variant && step.variant !== "standard" ? ` · ${word("pp.variant_", step.variant)}` : "";
  const phase = step.phase ? `${word("pp.phase_", step.phase)}${variant}` : variant.slice(3);
  return `<li class="pp-step" data-state="${state}"><span class="pp-mark pp-mark-${state}" aria-hidden="true">${STEP_MARK[state]}</span><span class="pp-step-main"><span class="pp-step-title">${esc(step.title || "")}</span><span class="pp-muted">${esc(phase)}</span></span><span class="pp-step-state">${esc(word("pp.step_", state))}</span></li>`;
}

function feedbackBlock(feedback) {
  if (!feedback) return "";
  const lines = [];
  if (feedback.effort) lines.push(`${t("pp.f_effort")}: ${effortText(feedback.effort)}`);
  if (feedback.discomfort === "no") lines.push(t("pp.dc_none"));
  if (feedback.discomfort === "yes") {
    lines.push(t("pp.dc_some"));
    if (feedback.discomfort_urgent) lines.push(t("pp.dc_urgent"));
    const regions = list(feedback.regions).map((r) => word("pp.region_", r));
    if (regions.length) lines.push(t("pp.dc_regions", { list: regions.join(", ") }));
    if (feedback.when) lines.push(t("pp.dc_when", { value: word("pp.when_", feedback.when) }));
    if (feedback.discomfort_level) lines.push(t("pp.dc_level", { value: word("pp.level_", feedback.discomfort_level) }));
    if (feedback.still_present === true) lines.push(t("pp.dc_still_yes"));
    if (feedback.still_present === false) lines.push(t("pp.dc_still_no"));
  }
  if (feedback.note) lines.push(t("pp.dc_note", { note: feedback.note }));
  const help = feedback.discomfort === "yes" ? `<p class="pp-muted">${esc(t("pp.dc_help"))}</p>` : "";
  return section(
    "pp-feedback",
    t("pp.wk_feedback"),
    `<p class="pp-muted">${esc(t("pp.wk_feedback_note"))}</p><ul class="pp-plain">${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>${help}`,
  );
}

/** One workout: the visit, the steps with completed/skipped markers, the course version and the customer's own answers. */
export function workoutDetail(data, { back = "" } = {}) {
  const w = data.workout || {};
  const where = w.where || {};
  const course = w.workout_kind === "course" ? w.course || {} : null;
  const facts = [
    [t("pp.f_status"), statusLabel(w.status, w.status_label)],
    [t("pp.wk_when"), date(w.visit_date || w.date)],
    [t("pp.f_facility"), where.facility],
    [t("pp.f_room"), [where.location, where.room].filter(Boolean).join(" · ")],
    [t("pp.f_program"), course ? course.title || w.title : [roomTitle(w), w.focus].filter(Boolean).join(" · ")],
    [t("pp.f_duration"), `${minutes(w.active_minutes, w.active_seconds)}${w.planned_minutes ? ` (${t("pp.wk_planned", { n: number(w.planned_minutes) })})` : ""}`],
    [t("pp.f_completed"), String(number(w.exercises_completed))],
    [t("pp.f_skipped"), String(number(w.exercises_skipped))],
    [t("pp.f_effort"), effortText(w.effort) || t("pp.effort_none")],
  ].filter(([, v]) => v);
  const courseBlock = course
    ? section(
        "pp-wk-course",
        t("pp.wk_course"),
        `<p>${esc(course.title || "")}</p>${course.session_title || course.module_title ? `<p class="pp-muted">${esc(t("pp.wk_course_session", { module: course.module_title || "", session: course.session_title || "" }))}</p>` : ""}${course.version ? `<p class="pp-muted">${esc(t("pp.wk_version", { n: number(course.version) }))}</p>` : ""}`,
      )
    : "";
  const steps = list(w.steps);
  const stepsBlock = section(
    "pp-steps",
    t("pp.wk_steps"),
    steps.length ? `<ol class="pp-steps">${steps.map(stepRow).join("")}</ol>` : `<p class="pp-empty">${esc(t("pp.wk_steps_empty"))}</p>`,
  );
  const scanBlock = w.scan
    ? section(
        "pp-wk-scan",
        t("pp.wk_scan"),
        `<p>${esc(t("pp.wk_scan_body"))}</p><a class="pp-textlink" href="#/passport/scans?scan=${encodeURIComponent(w.scan.id)}">${esc(t("pp.wk_scan_link"))}</a>`,
      )
    : "";
  const safety = w.ended_for_safety ? `<p class="pp-muted">${esc(t("pp.safety_stop"))}</p>` : "";
  const body = `${section("pp-wk-facts", t("pp.wk_details"), `<p>${demoBadge(w.origin)}</p><dl class="pp-facts">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>${safety}`)}${courseBlock}${stepsBlock}${feedbackBlock(w.feedback)}${scanBlock}`;
  return shell({ title: t("pp.wk_title"), active: "history", body, data, back });
}

// -- scans -----------------------------------------------------------------------------------

export const REASON_CODES = [
  "different_customer",
  "low_quality",
  "demo_vs_real",
  "different_protocol",
  "different_measurement_version",
  "different_model",
  "different_rules_version",
  "observation_withheld",
];

/** The plain sentence for a refusal reason code (the server's text only for a code this build does not know). */
export const reasonText = (reason) => word("pp.reason_", reason?.code, reason?.text);

const reasonList = (reasons) => `<ul class="pp-plain pp-reasons">${list(reasons).map((r) => `<li>${esc(reasonText(r))}</li>`).join("")}</ul>`;

const unit = (u) => (u === "deg" ? "°" : u ? ` ${u}` : "");
/** A measured value as signed text with two decimals, e.g. "+1.20°" (the sign is the direction, not a verdict). */
export function signed(value, u) {
  const n = number(value);
  const text = Math.abs(n).toFixed(2);
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}${text}${unit(u)}`;
}

const viewsText = (views) => list(views).map((v) => word("pp.cmp_view_", v)).join(lang() === "ko" ? ", " : " and ");

function valueCell(values, u) {
  const views = Object.entries(values?.views || {}).map(([view, v]) => `${word("pp.cmp_view_", view)} ${signed(v, u)}`);
  return `<strong>${esc(signed(values?.mean, u))}</strong>${views.length ? `<small class="pp-muted">${esc(views.join(" · "))}</small>` : ""}`;
}

/** The comparison of two comparable scans, or the refusal with its plain reasons. Never colours a value. */
export function comparisonPanel(c) {
  if (!c) return "";
  if (!c.comparable) {
    const reasons = list(c.reasons);
    return section(
      "pp-cmp",
      t("pp.cmp_title"),
      `<p class="pp-refusal">${esc(t("pp.not_enough"))}</p>${reasons.length ? reasonList(reasons) : `<p class="pp-muted">${esc(t("pp.cmp_need_two"))}</p>`}`,
    );
  }
  const u = c.measured?.unit;
  const limits = list(c.limitations);
  const v = c.versions || {};
  return section(
    "pp-cmp",
    t("pp.cmp_title"),
    `${c.demo ? `<p>${badge(t("pp.cmp_demo"), "warn")}</p>` : ""}<p>${esc(t("pp.cmp_neutral"))}</p><h3>${esc(t("pp.cmp_measured"))}</h3><p>${esc(t("pp.cmp_measured_value", { heading: c.measured?.heading || "", views: viewsText(c.measured?.views) }))}</p><table class="pp-table"><caption class="sd-visually-hidden">${esc(t("pp.cmp_title"))}</caption><thead><tr><td></td><th scope="col">${esc(t("pp.cmp_earlier"))}<small class="pp-muted">${esc(date(c.earlier_date))}</small></th><th scope="col">${esc(t("pp.cmp_later"))}<small class="pp-muted">${esc(date(c.later_date))}</small></th></tr></thead><tbody><tr><th scope="row">${esc(t("pp.cmp_value"))}</th><td>${valueCell(c.earlier_values, u)}</td><td>${valueCell(c.later_values, u)}</td></tr><tr class="pp-sign-row"><td colspan="3"><small class="pp-muted">${esc(t("pp.cmp_sign"))}</small></td></tr><tr><th scope="row">${esc(t("pp.cmp_difference"))}</th><td colspan="2"><strong>${esc(signed(c.difference, u))}</strong><small class="pp-muted">${esc(t("pp.cmp_difference_note"))}</small></td></tr></tbody></table><h3>${esc(t("pp.cmp_limits"))}</h3><ul class="pp-plain">${limits.map((l) => `<li>${esc(l)}</li>`).join("")}${limits.length < 2 ? `<li>${esc(t("pp.cmp_repeat"))}</li>` : ""}</ul><details class="pp-why pp-tech"><summary>${esc(t("pp.tech_details"))}</summary><p class="pp-small">${esc(t("pp.cmp_versions", { m: v.measurement || "", r: v.feedback_rules || "", p: v.protocol || "" }))}</p></details>`,
  );
}

export function scanOrigin(scan) {
  if (scan.origin === "demo_seed") return t("pp.scan_origin_seed");
  return scan.source === "demo_precomputed" ? t("pp.scan_origin_demo") : t("pp.scan_origin_real");
}

export function scanCard(scan) {
  const shown = scan.summary || {};
  const observed = [...list(shown.observations), ...list(shown.notes)];
  const text = observed.length
    ? `<ul class="pp-plain">${observed.map((o) => `<li>${esc(o.text)}</li>`).join("")}</ul>`
    : `<p>${esc(shown.quality_text || t("pp.scan_no_text"))}</p>`;
  const previous = scan.previous;
  const why = previous && !previous.comparable
    ? `<details class="pp-why"><summary>${esc(t("pp.scan_why_not"))}</summary>${reasonList(previous.reasons)}</details>`
    : previous
      ? `<p class="pp-muted">${esc(t("pp.scan_compare_ok"))}</p>`
      : "";
  const reliability = word("pp.rel_", scan.reliability, scan.reliability);
  return `<article class="pp-item pp-scan" id="scan-${esc(scan.id)}" tabindex="-1"><header><h3>${esc(date(scan.date))}</h3>${badge(scanOrigin(scan), scan.origin === "demo_seed" || scan.source === "demo_precomputed" ? "warn" : "info")}</header>${text}${shown.meaning ? `<p class="pp-muted">${esc(shown.meaning)}</p>` : ""}${why}<p class="pp-small">${esc(t("pp.scan_reliability", { value: reliability }))} · ${esc(scan.photos_kept ? t("pp.scan_photos_kept") : t("pp.scan_photos_gone"))}</p><details class="pp-why pp-tech"><summary>${esc(t("pp.tech_details"))}</summary><p class="pp-small">${esc(t("pp.scan_versions", { m: scan.measurement_version || "", r: scan.feedback_rules_version || "" }))}</p></details></article>`;
}

export function scansPage(scansData, comparison, { back = "" } = {}) {
  const items = list(scansData.items);
  const body = items.length
    ? `<p class="pp-lead">${esc(t("pp.scans_lead"))}</p>${comparisonPanel(comparison)}<section aria-labelledby="pp-scan-list"><h2 id="pp-scan-list">${esc(t("pp.scan_list"))}</h2><div class="pp-list">${items.map(scanCard).join("")}</div></section>`
    : `<p class="pp-empty">${esc(t("pp.scans_empty"))}</p>`;
  return shell({ title: t("pp.scans_title"), active: "scans", body, data: scansData, back });
}

// -- programs ---------------------------------------------------------------------------------

export function creatorLine(creator) {
  if (!creator) return "";
  const state = creator.verified ? "verified" : creator.verification_state === "pending" ? "pending" : "unverified";
  return `<p>${esc(t("pp.prog_creator", { name: creator.display_name }))} ${badge(t("pp.creator_" + state), state === "verified" ? "ok" : "")}</p>`;
}

/** One enrolled course. There is no play control: a session is available in the room. */
export function programCard(p) {
  const s = p.sessions || {};
  // The real number of sessions the customer's version holds, with the creator's suggested pace; the declared number of
  // weeks is not shown, because it need not match the sessions that were actually published.
  const length = s.total
    ? p.sessions_per_week ? t("pp.prog_length", { total: number(s.total), per: number(p.sessions_per_week) }) : t("pp.prog_length_total", { total: number(s.total) })
    : p.weeks ? t("pp.prog_length_weeks", { weeks: number(p.weeks) }) : "";
  const last = p.last_completed
    ? p.last_completed.title
      ? t("pp.prog_last", { title: p.last_completed.title, date: date(p.last_completed.completed_at) })
      : t("pp.prog_last_untitled", { date: date(p.last_completed.completed_at) })
    : "";
  let next = "";
  if (p.completed_at) next = `<p>${esc(t("pp.prog_done", { date: date(p.completed_at) }))}</p>`;
  else if (p.next_session) {
    const n = p.next_session;
    next = `<p class="pp-next-session"><strong>${esc(t("pp.prog_next"))}:</strong> ${esc(sessionLabel(n))}</p><p class="pp-muted">${esc(t("pp.session_of", { n: number(sessionNumber(s)), total: number(s.total) }))}${n.estimated_minutes ? ` · ${esc(minutes(n.estimated_minutes))}` : ""}</p>${p.next_eligible ? `<p class="pp-room-only">${esc(t("pp.room_only"))}</p>` : ""}`;
  }
  const status =
    p.entitlement && p.entitlement.status !== "active"
      ? `<p class="sd-notice">${esc(t("pp.prog_ended"))}</p>`
      : !p.available || !p.offered_at_facility
        ? `<p class="sd-notice">${esc(t("pp.prog_unavailable"))}</p>`
        : "";
  const history = list(p.history);
  const done = history.length
    ? `<ul class="pp-plain pp-rows">${history.map((h) => `<li><span class="pp-when">${esc(date(h.completed_at))}</span><span>${esc(h.title || "")}${h.module_title ? ` <span class="pp-muted">· ${esc(h.module_title)}</span>` : ""}${h.workout_id ? ` <a class="pp-textlink" href="#/passport/workout/${encodeURIComponent(h.workout_id)}">${esc(t("pp.prog_history_workout"))}</a>` : ""}</span></li>`).join("")}</ul>`
    : `<p class="pp-muted">${esc(t("pp.prog_history_empty"))}</p>`;
  const origin = p.origin ? badge(word("pp.origin_", p.origin.code, p.origin.label), "info") : "";
  return `<article class="pp-item pp-program" data-course="${esc(p.course_id)}">${/^\/sedens\//.test(p.cover_url || "") ? `<img class="pp-cover" src="${esc(p.cover_url)}" alt="${esc(t("pp.prog_cover_alt", { title: p.title }))}" loading="lazy">` : ""}<h2>${esc(p.title)}</h2>${creatorLine(p.creator)}<p class="pp-badges">${origin}${length ? ` <span class="pp-muted">${esc(length)}</span>` : ""}</p><p class="pp-muted">${esc(t("pp.prog_version", { n: number(p.pinned_version || p.enrolled_version) }))}</p>${progress(s.done, s.total)}<p class="pp-muted">${esc(t("pp.prog_remaining", { left: number(s.remaining) }))}</p>${last ? `<p>${esc(last)}</p>` : ""}${next}${status}<details class="pp-why"><summary>${esc(t("pp.prog_history"))}</summary>${done}</details><a class="pp-textlink" href="#/courses/${encodeURIComponent(p.course_id)}" aria-label="${esc(t("pp.prog_details_aria", { title: p.title }))}">${esc(t("pp.prog_details"))}</a></article>`;
}

export function programsPage(data, { back = "" } = {}) {
  const items = list(data.items);
  const body = items.length
    ? `<p class="pp-lead">${esc(t("pp.prog_lead"))}</p><div class="pp-list">${items.map(programCard).join("")}</div>`
    : `<p class="pp-empty">${esc(t("pp.prog_empty"))}</p><a class="sd-primary pp-cta" href="#/courses">${esc(t("pp.prog_browse"))}</a>`;
  return shell({ title: t("pp.prog_title"), active: "programs", body, data, back });
}

// -- achievements -----------------------------------------------------------------------------

export function achievementsPage(data, { back = "" } = {}) {
  const items = list(data.items);
  const body = items.length
    ? `<p class="pp-lead">${esc(t("pp.ach_lead"))}</p><ul class="pp-timeline">${items.map((a) => `<li><span class="pp-when">${esc(date(a.date))}</span><span>${esc(a.fact)} ${demoBadge(a.origin)}</span></li>`).join("")}</ul>`
    : `<p class="pp-empty">${esc(t("pp.ach_empty"))}</p>`;
  return shell({ title: t("pp.ach_title"), active: "achievements", body, data, back });
}

// -- preferences ------------------------------------------------------------------------------

export const PREFERENCE_KEYS = [
  ["exercise_style", "style"],
  ["intensity", "intensity"],
  ["music", "music"],
  ["language", "language"],
];

export function preferencesPage(data, { back = "" } = {}) {
  const prefs = data.preferences || {};
  const options = data.options || {};
  const fields = PREFERENCE_KEYS.map(([name, short]) => {
    const choices = list(options[name]);
    return `<label class="sd-field"><span>${esc(t("pp.pref_" + short))}</span><select name="${name}"><option value="">${esc(t("pp.pref_none"))}</option>${choices.map((c) => `<option value="${esc(c)}"${prefs[name] === c ? " selected" : ""}>${esc(word(`pp.pref_${short}_`, c))}</option>`).join("")}</select></label>`;
  }).join("");
  const saved = prefs.updated_at ? `<p class="pp-muted">${esc(t("pp.pref_saved_at", { date: date(prefs.updated_at) }))}</p>` : "";
  const body = `<p class="pp-lead">${esc(t("pp.pref_lead"))}</p><form id="pp-prefs" class="pp-form pp-card">${fields}<p class="pp-muted">${esc(t("pp.pref_language_note"))}</p><button class="sd-primary">${esc(t("pp.pref_save"))}</button>${saved}<p id="pp-status" class="pp-status" role="status" aria-live="polite" tabindex="-1"></p></form>`;
  return shell({ title: t("pp.pref_title"), active: "preferences", body, data, back });
}

// -- privacy ----------------------------------------------------------------------------------

const CONSENT_KINDS = ["scan_capture", "scan_image_retention", "product_analytics"];

function consentRows(consent) {
  const texts = consent?.texts || {};
  const current = consent?.current || {};
  const kinds = [...CONSENT_KINDS.filter((k) => k in texts), ...Object.keys(texts).filter((k) => !CONSENT_KINDS.includes(k))];
  const rows = kinds
    .map((kind) => {
      const now = current[kind];
      const label = word("pp.consent_", kind, kind);
      const choice = now ? (now.granted ? t("pp.consent_agreed") : t("pp.consent_withdrawn")) : "";
      const state = now
        ? t("pp.consent_on", { choice, date: date(now.recorded_at), version: now.text_version })
        : t("pp.consent_none");
      const old = now && now.current_version === false ? `<p class="pp-muted">${esc(t("pp.consent_old_version"))}</p>` : "";
      const wording = texts[kind]?.[lang()] || texts[kind]?.en || "";
      const withdraw =
        kind === "scan_image_retention" && now?.granted
          ? `<p class="pp-muted">${esc(t("pp.consent_withdraw_note"))}</p><button data-withdraw="${esc(kind)}">${esc(t("pp.consent_withdraw"))}</button>`
          : "";
      return `<li class="pp-consent" data-kind="${esc(kind)}"><h3>${esc(label)}</h3><p>${esc(state)}</p>${old}<details class="pp-why"><summary>${esc(t("pp.consent_read"))}</summary><p>${esc(wording)}</p></details>${withdraw}</li>`;
    })
    .join("");
  return section("pp-consents", t("pp.priv_consents"), `<ul class="pp-plain">${rows}</ul>`);
}

function photosBlock(photos) {
  const n = number(photos?.retained);
  if (!n) return section("pp-photos", t("pp.photos_title"), `<p>${esc(t("pp.photos_none"))}</p>`);
  return section(
    "pp-photos",
    t("pp.photos_title"),
    `<p>${esc(t("pp.photos_kept", { n, scans: number(photos.scans) }))}</p><button data-photos-delete aria-controls="pp-photos-confirm">${esc(t("pp.photos_delete"))}</button><div id="pp-photos-confirm" class="pp-confirm" role="group" aria-labelledby="pp-photos-confirm-title" hidden><h3 id="pp-photos-confirm-title" tabindex="-1">${esc(t("pp.photos_confirm_title", { n }))}</h3><p>${esc(t("pp.photos_confirm_body"))}</p><div class="sd-actions"><button class="sd-primary" data-photos-confirm>${esc(t("pp.photos_confirm_yes"))}</button><button class="sd-ghost" data-photos-cancel>${esc(t("pp.photos_cancel"))}</button></div></div>`,
  );
}

export const requestState = (state) => word("pp.req_", state, state);

function erasureBlock(requests) {
  const rows = list(requests);
  const open = rows.find((r) => r.state === "received");
  const history = rows
    .map((r) => `<li>${esc(t("pp.req_state", { date: date(r.requested_at), state: requestState(r.state) }))}${r.state === "received" ? ` <button class="sd-ghost" data-withdraw-request="${esc(r.id)}">${esc(t("pp.erase_withdraw"))}</button>` : ""}${r.note ? `<br><span class="pp-muted">${esc(t("pp.req_note", { text: r.note }))}</span>` : ""}</li>`)
    .join("");
  const form = open
    ? ""
    : `<form id="pp-erase" class="pp-form"><label class="sd-field"><span>${esc(t("pp.erase_message"))}</span><textarea name="message" maxlength="500" rows="3"></textarea></label><button>${esc(t("pp.erase_send"))}</button></form>`;
  return section("pp-erase-h", t("pp.erase_title"), `<p>${esc(t("pp.erase_explain"))}</p>${history ? `<ul class="pp-plain">${history}</ul>` : ""}${form}`);
}

export function privacyBody(data) {
  const stored = list(data.stored);
  return `${section("pp-stored", t("pp.priv_stored"), `<ul class="pp-bullets">${stored.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>`)}${consentRows(data.consent)}${"sign_in_activity" in data ? activitySection(data.sign_in_activity) : ""}${photosBlock(data.photos)}${erasureBlock(data.requests)}${section("pp-export", t("pp.export_title"), `<p>${esc(t("pp.export_body"))}</p><p class="pp-muted">${esc(t("pp.export_photos", { n: number(data.photos?.retained) }))}</p><a class="sd-button" href="/sedens/passport/export" download>${esc(t("pp.export_link"))}</a>`)}`;
}

export function privacyPage(data, { back = "" } = {}) {
  const body = `<p class="pp-lead">${esc(t("pp.priv_lead"))}</p><p id="pp-status" class="pp-status" role="status" aria-live="polite" tabindex="-1"></p><div id="pp-body">${privacyBody(data)}</div>`;
  return shell({ title: t("pp.priv_title"), active: "privacy", body, data, back });
}

// -- not available ----------------------------------------------------------------------------

/** Signed out, or an account that is not a customer's. The title is the page's only h1. */
export function gate(kind, { back = "" } = {}) {
  const staff = kind === "staff";
  return `<div class="pp">${back}<p class="sd-eyebrow">${esc(t("pp.eyebrow"))}</p><h1>${esc(t(staff ? "pp.staff_title" : "pp.signin_title"))}</h1><section class="pp-card"><p>${esc(t(staff ? "pp.staff_body" : "pp.signin_body"))}</p>${staff ? "" : `<a class="sd-primary pp-cta" href="#/">${esc(t("pp.signin_link"))}</a>`}</section></div>`;
}
