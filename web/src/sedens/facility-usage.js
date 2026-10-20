// Facility usage: how the AI Private Room was used in one month, and a fee simulation that is
// never an invoice. Totals only: the server sends no customer names, ids, scans or answers,
// and this page shows no revenue or sales figures. Rendering is pure (usageHtml) so it can be tested.
import { sedens, ApiError } from "./api.js";
import { t } from "./i18n.js";
import { esc, money, problem } from "./ui.js";

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
// Keys the server names in `definitions`; each has its own sentence in strings-usage.js.
export const COUNTED = ["completed_workout_step", "one_per_visit"];
export const NOT_COUNTED = [
  "stopped_or_abandoned_only", "all_steps_skipped", "retry_or_repeat_request", "second_workout_same_visit",
  "seeded_demo_history", "analytics_events", "drafts",
];
const TILES = [
  ["billable_sessions", "usage.m_billable", "usage.m_billable_hint"],
  ["room_sessions", "usage.m_room_sessions", "usage.m_room_sessions_hint"],
  ["completed_workouts", "usage.m_completed", ""],
  ["incomplete_workouts", "usage.m_incomplete", "usage.m_incomplete_hint"],
  ["used_minutes", "usage.m_minutes", "usage.m_minutes_hint"],
  ["licensed_rooms", "usage.m_rooms", "usage.m_rooms_hint"],
  ["repeat_customers", "usage.m_repeat", "usage.m_repeat_hint"],
  ["technical_failures", "usage.m_failures", "usage.m_failures_hint"],
  ["scan_retakes", "usage.m_retakes", "usage.m_retakes_hint"],
];

const isFacilityAdmin = (me) => me?.role === "admin" && me.organization?.kind === "facility";
const number = (n, locale) => new Intl.NumberFormat(locale === "ko" ? "ko-KR" : "en-US").format(n ?? 0);
const won = (amount) => money({ price_type: "paid", amount_minor: amount, currency: "KRW" });

/** "YYYY-MM" moved by whole months, or null when the text is not a month. */
export function shiftMonth(month, delta) {
  const found = MONTH.exec(String(month ?? ""));
  if (!found) return null;
  const index = Number(found[1]) * 12 + (Number(found[2]) - 1) + delta;
  return `${String(Math.floor(index / 12)).padStart(4, "0")}-${String((index % 12) + 1).padStart(2, "0")}`;
}

export const monthHref = (month) => "#/facility/usage?month=" + encodeURIComponent(month);

/** "September 2026" / "2026년 9월", without time-zone surprises. */
export function monthLabel(month, locale) {
  const found = MONTH.exec(String(month ?? ""));
  if (!found) return "";
  const [year, number] = [Number(found[1]), Number(found[2])];
  if (locale === "ko") return `${year}년 ${number}월`;
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, number - 1, 1)));
}

/** Previous and next month links; a month outside the server's range is a disabled control. */
export function monthNav(data, locale) {
  const prev = shiftMonth(data.month, -1);
  const next = shiftMonth(data.month, 1);
  const link = (target, label, arrow, ok) =>
    ok
      ? `<a class="sd-button sd-ghost" href="${esc(monthHref(target))}">${arrow}<span class="sd-sr"> ${esc(label)}</span></a>`
      : `<span class="sd-button sd-ghost" aria-disabled="true" aria-label="${esc(label)}">${arrow}</span>`;
  const first = data.months?.first || "0000-00";
  const last = data.months?.last || data.month;
  return `<nav class="sd-monthnav" aria-label="${esc(t("usage.month_nav"))}">${link(prev, t("usage.prev"), "←", prev && prev >= first)}<strong class="sd-month" aria-live="polite">${esc(monthLabel(data.month, locale))}</strong>${link(next, t("usage.next"), "→", next && next <= last)}</nav>`;
}

export function tiles(metrics, locale) {
  return TILES.map(([key, label, hint]) =>
    `<div class="sd-tile${key === "billable_sessions" ? " sd-tile-main" : ""}"><dt>${esc(t(label))}</dt><dd>${esc(number(metrics?.[key], locale))}</dd>${hint ? `<dd class="sd-muted sd-tile-hint">${esc(t(hint))}</dd>` : ""}</div>`).join("");
}

/** A labelled row with a bar scaled to the largest row; the number is always printed as text. */
function bars(rows, labelOf, countKey, locale) {
  const most = Math.max(1, ...rows.map((r) => r.count));
  const countText = (r) => t(r.count === 1 ? countKey + "_one" : countKey, { n: number(r.count, locale) });
  return `<ul class="sd-bars">${rows.map((r) => `<li><span class="sd-bar-label">${esc(labelOf(r))}</span><span class="sd-bar" aria-hidden="true"><span style="width:${Math.round((r.count / most) * 100)}%"></span></span><span class="sd-bar-count">${esc(countText(r))}</span></li>`).join("")}</ul>`;
}

export function bandRows(data) {
  return (data.duration_bands || []).map((b) => ({ key: b.band, count: b.sessions }));
}

export function programRows(data) {
  return (data.program_types || []).map((p) => ({ key: p.type, count: p.workouts }));
}

export function simulationHtml(sim, locale) {
  if (!sim) return `<p class="sd-notice">${esc(t("usage.sim_none"))}</p>`;
  const plan = sim.plan;
  const banner = sim.vat_included ? t("usage.sim_banner_vat") : t("usage.sim_banner");
  return `<p class="sd-sim-banner" role="note"><strong>${esc(banner)}</strong></p><p>${esc(t("usage.sim_plan", { label: plan.label }))} <span class="sd-muted">· ${esc(t(plan.assigned ? "usage.sim_plan_assigned" : "usage.sim_plan_default"))}</span></p><table class="sd-table sd-sim-table"><tbody><tr><th scope="row">${esc(t("usage.sim_rooms", { n: number(sim.inputs.licensed_rooms, locale), unit: won(plan.room_month_minor) }))}</th><td>${esc(won(sim.room_fee))}</td></tr><tr><th scope="row">${esc(t("usage.sim_sessions", { n: number(sim.inputs.billable_sessions, locale), unit: won(plan.per_session_minor) }))}</th><td>${esc(won(sim.session_fee))}</td></tr><tr class="sd-sim-total"><th scope="row">${esc(t("usage.sim_total"))}</th><td>${esc(won(sim.total))}</td></tr></tbody></table><p class="sd-muted">${esc(t("usage.sim_formula"))}</p>`;
}

export function definitionsHtml(data) {
  const keep = (known, wanted) => known.filter((key) => wanted === undefined || wanted.includes(key));
  const counted = keep(COUNTED, data.definitions?.counts);
  const notCounted = keep(NOT_COUNTED, data.definitions?.not_counted);
  return `<p>${esc(t("usage.def_unit"))}</p><ul>${counted.map((k) => `<li>${esc(t("usage.def_counts_" + k))}</li>`).join("")}</ul><h3>${esc(t("usage.def_not_title"))}</h3><ul>${notCounted.map((k) => `<li>${esc(t("usage.def_no_" + k))}</li>`).join("")}</ul><ul class="sd-muted"><li>${esc(t("usage.def_month", { tz: data.timezone }))}</li><li>${esc(t("usage.def_room"))}</li><li>${esc(t("usage.def_creator"))}</li><li>${esc(t("usage.def_amounts"))}</li></ul>`;
}

/** The whole page body for one month of usage (everything after the title). */
export function usageHtml(data, locale) {
  const demo = data.demonstration?.flagged
    ? `<p class="sd-notice" role="note"><span class="sd-badge warn">${esc(t("usage.demo"))}</span> ${esc(t("usage.demo_note"))}</p>`
    : "";
  const bandLabel = (r) => t("usage.band_" + r.key);
  const programLabel = (r) => t("usage.program_" + r.key);
  return `${monthNav(data, locale)}<p class="sd-muted">${esc(t("usage.period", { from: data.window.from, to: data.window.to, tz: data.timezone }))}</p>${demo}<section class="sd-panel"><h2>${esc(t("usage.tiles"))}</h2><dl class="sd-tiles">${tiles(data.metrics, locale)}</dl><p class="sd-muted">${esc(t("usage.totals_only"))}</p></section><section class="sd-panel sd-sim" aria-labelledby="usage-sim"><h2 id="usage-sim">${esc(t("usage.sim"))}</h2>${simulationHtml(data.simulation, locale)}</section><section class="sd-panel"><h2>${esc(t("usage.bands"))}</h2><p class="sd-muted">${esc(t("usage.bands_hint"))}</p>${bars(bandRows(data), bandLabel, "usage.sessions", locale)}</section><section class="sd-panel"><h2>${esc(t("usage.programs"))}</h2><p class="sd-muted">${esc(t("usage.programs_hint"))}</p>${bars(programRows(data), programLabel, "usage.workouts", locale)}</section><section class="sd-panel"><h2>${esc(t("usage.defs"))}</h2>${definitionsHtml(data)}</section>`;
}

export async function facilityUsage(ctx) {
  const back = `<a class="sd-back" href="#/facility">← ${esc(t("facility.title"))}</a>`;
  const head = `${back}<h1>${esc(t("usage.title"))}</h1>`;
  if (!isFacilityAdmin(ctx.me)) return ctx.page(`${head}${ctx.notice(t("usage.need_admin"))}`);
  const month = MONTH.test(ctx.query?.month ?? "") ? ctx.query.month : "";
  let data;
  try {
    data = await sedens("facility/usage" + (month ? "?month=" + encodeURIComponent(month) : ""));
  } catch (error) {
    if (ctx.stale()) return;
    if (error instanceof ApiError && error.status === 403) return ctx.page(`${head}${ctx.notice(t("usage.need_admin"))}`);
    const text = error instanceof ApiError && error.code === "invalid_month" ? t("usage.err_invalid_month") : problem(error);
    return ctx.page(`${head}${ctx.notice(text, "error")}`);
  }
  if (ctx.stale()) return;
  ctx.page(`${head}<p class="sd-muted">${esc(ctx.me.organization.display_name)}</p>${usageHtml(data, document.documentElement.lang === "ko" ? "ko" : "en")}`);
}
