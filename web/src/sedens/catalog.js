// The customer catalog, one course, "my courses" and the facility course console.
// Customers read published snapshots only; guided workouts never play here (the
// server answers play_here: room_only), so these pages show courses and progress.
import { sedens, ApiError } from "./api.js";
import { t, lang } from "./i18n.js";
import { $, esc, money, date, problem } from "./ui.js";
import { href } from "./router.js";

const fileUrl = (id) => "/sedens/media/file?id=" + encodeURIComponent(id);
const SELF_DECLARED = ["professor", "expert"];
const STATE_BADGE = { verified: "ok", pending: "info", rejected: "danger", suspended: "danger" };

// -- words shared with review.js -------------------------------------------------------

/** A server code as words; an unknown code reads "Other", never the raw code. */
export function word(prefix, code) {
  const key = prefix + code;
  const text = t(key);
  return text === key ? t("catalog.other") : text;
}

/** Our sentence for a refusal we expect (first prefix that knows the code), else problem(). */
export function fail(error, prefixes = ["catalog.err_"]) {
  for (const prefix of error?.code ? prefixes : []) {
    const key = prefix + error.code;
    if (t(key) !== key) return t(key);
  }
  return problem(error);
}

/** Multi-line creator text as escaped paragraphs-with-line-breaks. */
export const lines = (text) => esc(text).replace(/\r?\n/g, "<br>");

// "verified" only when the server says so: a card carries verified, a snapshot only the state.
function verification(creator) {
  const state = creator?.verification_state || "unverified";
  return state === "verified" && creator.verified === false ? "unverified" : state;
}

/** "Professor (self-declared)" until SEDENS verifies the profile. */
export function creatorType(creator) {
  const type = word("catalog.ctype_", creator?.creator_type);
  return SELF_DECLARED.includes(creator?.creator_type) && verification(creator) !== "verified"
    ? t("catalog.self_declared", { type })
    : type;
}

export function verificationBadge(creator) {
  const state = verification(creator);
  return `<span class="sd-badge ${STATE_BADGE[state] || ""}">${esc(word("creator.state_", state))}</span>`;
}

export function creatorLine(creator) {
  if (!creator) return "";
  return `<span>${esc(creator.display_name)}</span> <span class="sd-muted">· ${esc(creatorType(creator))}</span> ${verificationBadge(creator)}`;
}

export const typeWord = (type) => word("catalog.type_", type);
export const distributionWord = (code) => word("catalog.dist_", code);
export const perWeek = (n) => (!n ? "" : n === 1 ? t("catalog.per_week_one") : t("catalog.per_week", { n }));
const listWords = (prefix, codes) => (codes || []).map((c) => word(prefix, c)).join(", ");

function facts(card) {
  return [
    typeWord(card.course_type),
    word("catalog.level_", card.level),
    word("catalog.cat_", card.category),
    card.estimated_minutes ? t("catalog.minutes", { n: card.estimated_minutes }) : "",
    card.weeks ? t("catalog.weeks", { n: card.weeks }) : "",
    perWeek(card.sessions_per_week),
  ].filter(Boolean);
}

/** What this person pays: their facility's terms first, then the creator's price. */
function priceWords(card) {
  if (card.included_here) return t("catalog.included_here");
  if (card.free_here) return t("catalog.free_here");
  if (card.price?.price_type === "paid" && card.price.sale_state !== "active") return t("catalog.not_on_sale");
  return money(card.price);
}

function badges(card) {
  return [
    `<span class="sd-badge info">${esc(word("catalog.badge_", card.badge))}</span>`,
    card.demo ? `<span class="sd-badge warn">${esc(t("catalog.demo_label"))}</span>` : "",
    card.featured_here ? `<span class="sd-badge ok">${esc(t("catalog.featured"))}</span>` : "",
    card.enrolled ? `<span class="sd-badge ok">${esc(t("catalog.enrolled"))}</span>` : "",
    card.purchased ? `<span class="sd-badge warn">${esc(t("catalog.purchased"))}</span>` : "",
    card.sales_paused && !card.purchased && !card.enrolled ? `<span class="sd-badge">${esc(t("catalog.sales_paused"))}</span>` : "",
  ].join(" ");
}

const cover = (card) =>
  card.cover_media_id ? `<img class="sd-cover" src="${esc(fileUrl(card.cover_media_id))}" alt="${esc(card.title)}" loading="lazy">` : "";

function progressBar(progress) {
  const total = progress?.total_items || 0;
  const done = progress?.completed_items || 0;
  const percent = total ? Math.round((done / total) * 100) : 0;
  return `<p>${esc(t("catalog.progress", { done, total }))}</p><div class="sd-progress" role="progressbar" aria-label="${esc(t("catalog.progress_aria"))}" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${done}"><span style="width:${percent}%"></span></div>`;
}

function courseCard(card, { extra = "", link = "catalog.view", aria = "catalog.view_aria" } = {}) {
  return `<article class="sd-card">${cover(card)}<div class="sd-row">${badges(card)}</div><h3>${esc(card.title)}</h3>${card.subtitle ? `<div class="sd-muted">${esc(card.subtitle)}</div>` : ""}<div>${creatorLine(card.creator)}</div><div class="sd-muted">${esc(facts(card).join(" · "))}</div><p class="sd-price">${esc(priceWords(card))}</p>${extra}<a class="sd-button" href="${href("courses", card.id)}" aria-label="${esc(t(aria, { title: card.title }))}">${esc(t(link))}</a></article>`;
}

function signedOut(ctx, title) {
  ctx.page(`${ctx.backLink()}<h1>${esc(t(title))}</h1><section class="sd-panel"><h2>${esc(t("catalog.signin_title"))}</h2><p>${esc(t("catalog.signin_body"))}</p><a class="sd-primary" href="#/">${esc(t("catalog.signin_link"))}</a></section>`);
}

// -- #/courses -----------------------------------------------------------------------

const FILTERS = { type: ["", "guided_training", "professional_education"], price: ["", "free", "paid"], here: ["", "1"] };

function readFilters(query) {
  return Object.fromEntries(Object.entries(FILTERS).map(([name, allowed]) => [name, allowed.includes(query[name]) ? query[name] : ""]));
}

function matches(card, filters) {
  const free = card.price?.price_type !== "paid" || card.free_here || card.included_here;
  if (filters.type && card.course_type !== filters.type) return false;
  if (filters.price === "free" && !free) return false;
  if (filters.price === "paid" && free) return false;
  if (filters.here && !card.enabled_here) return false;
  return true;
}

export async function catalog(ctx) {
  if (!ctx.me) return signedOut(ctx, "catalog.title");
  const data = await sedens("courses/catalog");
  if (ctx.stale()) return;
  const filters = readFilters(ctx.query);
  const option = (name, value, label) => `<option value="${value}" ${filters[name] === value ? "selected" : ""}>${esc(t(label))}</option>`;
  const form = data.items.length
    ? `<form id="filters" class="sd-inline sd-actions" role="search" aria-label="${esc(t("catalog.filters"))}"><label class="sd-field"><span>${esc(t("catalog.filter_type"))}</span><select name="type">${option("type", "", "catalog.type_all")}${option("type", "guided_training", "catalog.type_guided_training")}${option("type", "professional_education", "catalog.type_professional_education")}</select></label><label class="sd-field"><span>${esc(t("catalog.filter_price"))}</span><select name="price">${option("price", "", "catalog.price_all")}${option("price", "free", "catalog.price_free")}${option("price", "paid", "catalog.price_paid")}</select></label><label class="sd-check"><input type="checkbox" name="here" ${filters.here ? "checked" : ""}> ${esc(t("catalog.filter_here"))}</label></form>`
    : "";
  ctx.page(`${ctx.backLink()}<h1>${esc(t("catalog.title"))}</h1><p class="sd-lead">${esc(t("catalog.lead"))}</p>${ctx.notice(t("catalog.room_only"))}${form}<div id="results"></div>`);
  const show = () => {
    const items = data.items.filter((card) => matches(card, filters));
    $("#results").innerHTML = items.length
      ? `<section class="sd-grid">${items.map((card) => courseCard(card)).join("")}</section>`
      : `<p class="sd-notice" role="status">${esc(t(data.items.length ? "catalog.empty_filtered" : "catalog.empty"))}</p>`;
  };
  show();
  const filterForm = $("#filters");
  if (!filterForm) return;
  filterForm.onchange = () => {
    filters.type = filterForm.type.value;
    filters.price = filterForm.price.value;
    filters.here = filterForm.here.checked ? "1" : "";
    // The filters live in the hash so a shared or reloaded link shows the same list;
    // replaceState changes it without a hashchange, so the list redraws in place.
    const query = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString();
    history.replaceState(null, "", "#/courses" + (query ? "?" + query : ""));
    show();
  };
}

// -- #/courses/:course ------------------------------------------------------------------

export async function courseDetail(ctx) {
  if (!ctx.me) return signedOut(ctx, "catalog.title");
  let detail;
  try {
    detail = await sedens("courses/detail?id=" + encodeURIComponent(ctx.params.course));
  } catch (error) {
    if (ctx.stale()) return;
    if (!(error instanceof ApiError) || error.status !== 404) throw error;
    ctx.page(`<a class="sd-back" href="#/courses">← ${esc(t("catalog.all_courses"))}</a><h1>${esc(t("catalog.title"))}</h1>${ctx.notice(fail(error), "error")}`);
    return;
  }
  if (ctx.stale()) return;
  drawDetail(ctx, detail);
}

function overview(detail) {
  const o = detail.overview || {};
  const card = detail.card;
  const text = (label, value) => (value ? `<h3>${esc(t(label))}</h3><p>${lines(value)}</p>` : "");
  const facts = [
    ["catalog.f_type", typeWord(card.course_type)],
    ["catalog.f_level", word("catalog.level_", card.level)],
    ["catalog.f_category", word("catalog.cat_", card.category)],
    ["catalog.f_duration", card.estimated_minutes ? t("catalog.minutes", { n: card.estimated_minutes }) : ""],
    ["catalog.f_weeks", card.weeks ? t("catalog.weeks", { n: card.weeks }) : ""],
    ["catalog.f_per_week", perWeek(card.sessions_per_week)],
    ["catalog.f_language", word("catalog.lang_", card.language)],
    ["catalog.f_equipment", listWords("catalog.eq_", card.equipment)],
    ["catalog.f_body_areas", listWords("catalog.area_", o.body_areas)],
  ].filter(([, value]) => value);
  const goals = (o.goals || []).length ? `<h3>${esc(t("catalog.f_goals"))}</h3><ul>${o.goals.map((g) => `<li>${esc(g)}</li>`).join("")}</ul>` : "";
  return `<section class="sd-panel"><h2>${esc(t("catalog.overview"))}</h2>${text("catalog.f_description", o.description)}${text("catalog.f_audience", o.audience)}${text("catalog.f_prerequisites", o.prerequisites)}${text("catalog.f_outcomes", o.outcomes)}${goals}${text("catalog.f_safety", o.safety)}<div class="sd-grid-4">${facts.map(([label, value]) => `<div><span class="sd-muted">${esc(t(label))}</span><br>${esc(value)}</div>`).join("")}</div></section>`;
}

function lessonItem(detail, lesson, done) {
  const enrolled = Boolean(detail.progress);
  const educational = detail.card.course_type === "professional_education";
  // Lesson files are served only to enrolled people; the outline may carry the id.
  const fileId = lesson.media_id || lesson.media?.id;
  let file = "";
  if (fileId && ["pdf", "video", "image"].includes(lesson.kind)) {
    if (!enrolled) file = `<p class="sd-muted">${esc(t("catalog.lesson_file_after"))}</p>`;
    else if (lesson.kind === "image") file = `<img class="sd-cover" src="${esc(fileUrl(fileId))}" alt="${esc(lesson.title)}" loading="lazy">`;
    else if (lesson.kind === "video") file = `<video class="sd-cover" controls preload="metadata" src="${esc(fileUrl(fileId))}" aria-label="${esc(lesson.title)}"></video>`;
    else file = `<p><a class="sd-button" href="${esc(fileUrl(fileId))}" download>${esc(t("catalog.lesson_open"))}</a></p>`;
  }
  const body = lesson.body ? `<p>${lines(lesson.body)}</p>` : "";
  const action = enrolled && educational && !done
    ? `<button class="sd-ghost" data-lesson="${esc(lesson.id)}" aria-label="${esc(t("catalog.lesson_done_aria", { title: lesson.title }))}">${esc(t("catalog.lesson_done"))}</button>`
    : "";
  return `<li><div class="sd-spread"><span>${esc(lesson.title)} <span class="sd-muted">· ${esc(word("catalog.lesson_", lesson.kind))}</span></span>${done ? `<span class="sd-badge ok">${esc(t("catalog.done"))}</span>` : action}</div>${body}${file}</li>`;
}

function outline(detail) {
  const done = new Set(detail.progress?.done || []);
  const perModule = Object.fromEntries((detail.progress?.modules || []).map((m) => [m.id, m]));
  const steps = (n) => (n === 1 ? t("catalog.steps_one") : t("catalog.steps_many", { n }));
  const modules = (detail.outline || []).map((m) => {
    const p = perModule[m.id];
    const sessions = (m.sessions || []).map((s) => `<li><div class="sd-spread"><span>${esc(s.title)} <span class="sd-muted">· ${esc([s.estimated_minutes ? t("catalog.minutes", { n: s.estimated_minutes }) : "", steps(s.steps)].filter(Boolean).join(" · "))}</span></span>${done.has("session:" + s.id) ? `<span class="sd-badge ok">${esc(t("catalog.done"))}</span>` : ""}</div></li>`).join("");
    const lessons = (m.lessons || []).map((x) => lessonItem(detail, x, done.has("lesson:" + x.id))).join("");
    return `<li><div class="sd-spread"><h3>${esc(m.title)}</h3>${p ? `<span class="sd-muted">${esc(t("catalog.module_progress", { done: p.completed, total: p.total }))}</span>` : ""}</div>${m.summary ? `<p class="sd-muted">${lines(m.summary)}</p>` : ""}${sessions || lessons ? `<ol>${sessions}${lessons}</ol>` : ""}</li>`;
  });
  return `<section class="sd-panel"><h2>${esc(t("catalog.outline"))}</h2>${modules.length ? `<ol class="sd-tree">${modules.join("")}</ol>` : `<p class="sd-muted">${esc(t("catalog.outline_empty"))}</p>`}<p class="sd-error" role="alert" id="outline-error"></p></section>`;
}

function actionPanel(ctx, detail) {
  const card = detail.card;
  const option = detail.enroll || {};
  const guided = card.course_type === "guided_training";
  const price = `<p class="sd-price">${esc(priceWords(card))}</p>`;
  if (detail.progress) {
    const p = detail.progress;
    return `<section class="sd-panel" aria-labelledby="action-title"><h2 id="action-title">${esc(t("catalog.progress_title"))}</h2>${progressBar(p)}<p class="sd-muted">${esc(t("catalog.enrolled_since", { date: date(p.enrolled_at) }))}</p>${p.completed_at ? `<p>${esc(t("catalog.progress_finished"))}</p>` : guided ? `<p>${esc(t("catalog.start_in_room"))}</p>` : ""}</section>`;
  }
  let body;
  if (option.ok) {
    const why = { facility: option.source === "facility_included" ? "catalog.why_facility_included" : "catalog.why_facility_free", free: "catalog.why_free", entitled: "catalog.why_entitled" }[option.reason];
    body = `${why ? `<p>${esc(t(why))}</p>` : ""}<button class="sd-primary" id="enroll">${esc(t(option.reason === "entitled" ? "catalog.start" : "catalog.enroll"))}</button><p class="sd-error" role="alert"></p>`;
  } else if (option.reason === "purchase_required" && ctx.me.organization?.demo) {
    body = `<button class="sd-primary" id="buy" aria-expanded="false" aria-controls="confirm">${esc(t("catalog.buy_demo"))}</button><div id="confirm" class="sd-panel" hidden><h3>${esc(t("catalog.confirm_title"))}</h3><p>${esc(t("catalog.confirm_price", { price: money(card.price) }))}</p><p class="sd-demo-label">${esc(t("catalog.payment_notice"))}</p><p>${esc(t("catalog.no_card"))}</p><div class="sd-actions"><button class="sd-primary" id="buy-confirm">${esc(t("catalog.confirm_buy"))}</button><button class="sd-ghost" id="buy-cancel">${esc(t("common.cancel"))}</button></div><p class="sd-error" role="alert"></p></div>`;
  } else if (option.reason === "purchase_required") {
    body = ctx.notice(t("catalog.purchase_unavailable"));
  } else {
    body = ctx.notice(t({ customers_only: "catalog.reason_customers_only", already_enrolled: "catalog.reason_already_enrolled", sales_paused: "catalog.reason_sales_paused" }[option.reason] || "catalog.reason_not_available"));
  }
  return `<section class="sd-panel">${price}${body}</section>`;
}

function drawDetail(ctx, detail, flash = "") {
  const card = detail.card;
  ctx.page(`<a class="sd-back" href="#/courses">← ${esc(t("catalog.all_courses"))}</a>${cover(card)}<div class="sd-row">${badges(card)}</div><h1>${esc(card.title)}</h1>${card.subtitle ? `<p class="sd-lead">${esc(card.subtitle)}</p>` : ""}<p>${creatorLine(card.creator)}</p><p class="sd-muted">${esc(facts(card).join(" · "))}</p>${card.course_type === "guided_training" ? ctx.notice(t("catalog.room_note")) : ""}<div id="action">${flash ? `<div id="flash">${flash}</div>` : ""}${actionPanel(ctx, detail)}</div>${overview(detail)}${outline(detail)}`);
  // After an action the page is redrawn where the person was; bring the result into view.
  if (flash) $("#flash")?.scrollIntoView({ block: "center" });
  bindDetail(ctx, detail);
}

function bindDetail(ctx, detail) {
  const course = detail.card.id;
  const panel = $("#action");
  const busy = async (button, errorBox, call) => {
    button.disabled = true;
    try {
      await call();
    } catch (error) {
      if (ctx.stale()) return;
      button.disabled = false;
      errorBox.textContent = fail(error);
    }
  };
  const enroll = $("#enroll");
  if (enroll)
    enroll.onclick = () => busy(enroll, panel.querySelector(".sd-error"), async () => {
      const next = await sedens("courses/enroll", { course_id: course });
      if (!ctx.stale()) drawDetail(ctx, next, ctx.notice(t("catalog.enrolled_notice")));
    });
  const buy = $("#buy");
  if (buy) {
    const confirm = $("#confirm");
    const toggle = (open) => {
      confirm.hidden = !open;
      buy.hidden = open;
      buy.setAttribute("aria-expanded", String(open));
      (open ? $("#buy-confirm") : buy).focus();
    };
    buy.onclick = () => toggle(true);
    $("#buy-cancel").onclick = () => toggle(false);
    const go = $("#buy-confirm");
    go.onclick = () => busy(go, confirm.querySelector(".sd-error"), async () => {
      const result = await sedens("courses/demo-purchase", { course_id: course });
      if (ctx.stale()) return;
      const notice = result.purchase?.notice?.[lang()] || t("catalog.payment_notice");
      drawDetail(ctx, result.course, `<div class="sd-notice" role="status"><p class="sd-demo-label">${esc(notice)}</p><p>${esc(t("catalog.purchase_done"))}</p></div>`);
    });
  }
  document.querySelectorAll("[data-lesson]").forEach((button) => {
    button.onclick = () => busy(button, $("#outline-error"), async () => {
      const next = await sedens("courses/lesson/complete", { course_id: course, lesson_id: button.dataset.lesson });
      if (!ctx.stale()) drawDetail(ctx, next, ctx.notice(t("catalog.lesson_marked")));
    });
  });
}

// -- #/my ----------------------------------------------------------------------------------

export async function myCourses(ctx) {
  if (!ctx.me) return signedOut(ctx, "catalog.my_title");
  const data = await sedens("courses/mine");
  if (ctx.stale()) return;
  const cards = data.items.map(({ card, progress, available }) =>
    courseCard(card, {
      extra: `${progress ? progressBar(progress) : ""}${available ? "" : `<p class="sd-notice">${esc(t("catalog.no_longer"))}</p>`}`,
      link: "catalog.details",
      aria: "catalog.details_aria",
    }),
  );
  ctx.page(`${ctx.backLink()}<h1>${esc(t("catalog.my_title"))}</h1>${
    cards.length
      ? `<section class="sd-grid">${cards.join("")}</section>`
      : `<section class="sd-panel"><p>${esc(t("catalog.my_empty"))}</p><a class="sd-primary" href="#/courses">${esc(t("catalog.browse"))}</a></section>`
  }`);
}

// -- #/facility/courses --------------------------------------------------------------------

const isFacilityAdmin = (me) => me?.role === "admin" && me.organization?.kind === "facility";

export async function facilityCourses(ctx) {
  const back = `<a class="sd-back" href="#/facility">← ${esc(t("facility.title"))}</a>`;
  const denied = () => ctx.page(`${back}<h1>${esc(t("fcourses.title"))}</h1>${ctx.notice(t("fcourses.need_admin"))}`);
  if (!isFacilityAdmin(ctx.me)) return denied();
  let data;
  try {
    data = await sedens("facility/courses");
  } catch (error) {
    if (ctx.stale()) return;
    if (error instanceof ApiError && error.status === 403) return denied();
    throw error;
  }
  if (ctx.stale()) return;
  ctx.page(`${back}<h1>${esc(t("fcourses.title"))}</h1><p class="sd-muted">${esc(ctx.me.organization.display_name)}</p><section class="sd-panel"><ul>${["fcourses.intro_enable", "fcourses.intro_include", "fcourses.intro_edit"].map((k) => `<li>${esc(t(k))}</li>`).join("")}</ul></section><div id="fcourses"></div>`);
  drawFacility(ctx, data.items);
}

function facilityRow(item) {
  const s = item.setting || {};
  const basis = item.own_program ? "home_facility" : item.basis;
  // One hint per reason, shared by every box it disables.
  const hints = [!item.free_here ? "fcourses.included_paid" : "", !s.enabled ? "fcourses.enable_first" : ""].filter(Boolean);
  const hintId = (k) => `hint-${k.split(".")[1]}-${esc(item.id)}`;
  const toggle = (name, checked, reasons) =>
    `<label class="sd-check"><input type="checkbox" name="${name}" ${checked ? "checked" : ""} ${reasons.length ? `disabled aria-describedby="${reasons.map(hintId).join(" ")}"` : ""}> ${esc(t("fcourses." + name))}</label>`;
  return `<section class="sd-panel" data-course="${esc(item.id)}"><div class="sd-row">${badges({ ...item, enrolled: false, purchased: false, featured_here: false })}</div><h2>${esc(item.title)}</h2>${item.subtitle ? `<p class="sd-muted">${esc(item.subtitle)}</p>` : ""}<p>${creatorLine(item.creator)}</p><p class="sd-muted">${esc(facts(item).join(" · "))}</p><p>${esc(t("fcourses.why", { basis: word("fcourses.basis_", basis) }))}</p><p>${esc(t("fcourses.price", { price: money(item.price) }))} · ${esc(t(item.free_here ? "fcourses.free_members" : "fcourses.paid_members"))}</p><form class="sd-setting"><fieldset><legend class="sd-visually-hidden">${esc(t("fcourses.settings", { title: item.title }))}</legend>${toggle("enabled", s.enabled, [])}${toggle("included", s.included, hints)}${toggle("featured", s.featured, hints.filter((k) => k === "fcourses.enable_first"))}</fieldset>${hints.map((k) => `<p class="sd-muted" id="${hintId(k)}">${esc(t(k))}</p>`).join("")}<p class="sd-muted" role="status"></p><p class="sd-error" role="alert"></p></form></section>`;
}

function drawFacility(ctx, items, focus = null, flash = "") {
  $("#fcourses").innerHTML = items.length ? items.map(facilityRow).join("") : ctx.notice(t("fcourses.empty"));
  document.querySelectorAll("#fcourses form.sd-setting").forEach((form) => {
    form.onsubmit = (event) => event.preventDefault();
    form.onchange = async (event) => {
      const course = form.closest("[data-course]").dataset.course;
      const enabled = form.enabled.checked;
      // Switching a course off also clears including and featuring (the server requires it).
      const body = { course_id: course, enabled, included: enabled && form.included.checked, featured: enabled && form.featured.checked };
      const status = form.querySelector("[role=status]");
      const error = form.querySelector(".sd-error");
      form.querySelectorAll("input").forEach((input) => (input.disabled = true));
      status.textContent = t("fcourses.saving");
      error.textContent = "";
      try {
        const result = await sedens("facility/courses/setting", body);
        if (ctx.stale()) return;
        drawFacility(ctx, result.items, { course, name: event.target.name }, t("fcourses.saved"));
      } catch (failure) {
        if (ctx.stale()) return;
        // Redraw from the last known state so the boxes show what is really saved.
        drawFacility(ctx, items, { course, name: event.target.name });
        const again = document.querySelector(`#fcourses [data-course="${CSS.escape(course)}"] .sd-error`);
        if (again) again.textContent = fail(failure, ["fcourses.err_", "catalog.err_"]);
      }
    };
  });
  if (focus) {
    const form = document.querySelector(`#fcourses [data-course="${CSS.escape(focus.course)}"] form`);
    form?.elements[focus.name]?.focus();
    if (form && flash) form.querySelector("[role=status]").textContent = flash;
  }
}
