// SEDENS review: the queue of submitted versions, creator verification, published
// courses (suspend / reinstate) and the decision on one exact, frozen version.
// The page shows the snapshot the server froze at submission; the decision is
// sent with that snapshot's fingerprint so a reviewer can only decide what they read.
import { sedens, ApiError } from "./api.js";
import { t, lang } from "./i18n.js";
import { $, esc, money, date, values, safeLink } from "./ui.js";
import { href } from "./router.js";
import { word, fail, lines, creatorLine, creatorType, verificationBadge, typeWord, distributionWord, perWeek } from "./catalog.js";

const TABS = ["courses", "creators", "published"];
const ERRORS = ["review.err_", "catalog.err_"];
const RESULTS = ["pass", "needs_work", "not_applicable"];
const DECISIONS = ["approved", "needs_revision", "rejected"];
const isReviewer = (me) => Boolean(me?.capabilities?.includes("sedens_reviewer"));

function gate(ctx) {
  if (isReviewer(ctx.me)) return true;
  ctx.page(`${ctx.backLink()}<h1>${esc(t("review.title"))}</h1>${ctx.notice(t(ctx.me ? "review.need_capability" : "review.need_signin"))}`);
  return false;
}

// A 403 means the reviewer capability was removed since sign-in.
async function load(ctx, route) {
  try {
    return await sedens(route);
  } catch (error) {
    if (ctx.stale()) return null;
    if (error instanceof ApiError && error.status === 403) {
      ctx.page(`${ctx.backLink()}<h1>${esc(t("review.title"))}</h1>${ctx.notice(t("review.need_capability"))}`);
      return null;
    }
    throw error;
  }
}

/** Disable the button while the call runs; show a refusal in the form's alert. */
async function run(ctx, button, errorBox, call) {
  button.disabled = true;
  errorBox.textContent = "";
  try {
    await call();
  } catch (error) {
    if (ctx.stale()) return;
    button.disabled = false;
    errorBox.textContent = fail(error, ERRORS);
  }
}

// -- #/review ------------------------------------------------------------------------

export async function reviewHome(ctx) {
  if (!gate(ctx)) return;
  const tab = TABS.includes(ctx.query.tab) ? ctx.query.tab : "courses";
  const data = await load(ctx, tab === "creators" ? "review/creators" : "review/courses");
  if (!data || ctx.stale()) return;
  const tabs = TABS.map((name) => `<a href="#/review?tab=${name}" ${name === tab ? 'aria-current="page"' : ""}>${esc(t("review.tab_" + name))}</a>`).join("");
  ctx.page(`${ctx.backLink()}<h1>${esc(t("review.title"))}</h1><p class="sd-muted">${esc(t("review.lead"))}</p><nav class="sd-tabs" aria-label="${esc(t("review.tabs"))}">${tabs}</nav><div id="review-body"></div>`);
  if (tab === "courses") drawQueue(data);
  else if (tab === "creators") drawCreators(ctx, data.items);
  else drawPublished(ctx, data.published);
}

function drawQueue(data) {
  const items = data.items.map((c) => {
    const link = href("review", "courses", c.course_id, c.version);
    return `<article class="sd-panel"><div class="sd-row"><span class="sd-badge">${esc(typeWord(c.course_type))}</span><span class="sd-badge info">${esc(t("review.version", { n: c.version }))}</span></div><h2>${esc(c.title)}</h2><p>${creatorLine(c.creator)}</p><p class="sd-muted">${esc(t("review.submitted", { date: date(c.submitted_at) }))} · ${esc(money(c.price))} · ${esc(t("review.offered", { who: distributionWord(c.distribution) }))}</p>${c.note ? `<h3>${esc(t("review.creator_note"))}</h3><blockquote>${lines(c.note)}</blockquote>` : ""}<a class="sd-primary" href="${link}" aria-label="${esc(t("review.open_aria", { title: c.title, version: c.version }))}">${esc(t("review.open"))}</a></article>`;
  });
  $("#review-body").innerHTML = items.length ? items.join("") : `<p class="sd-notice" role="status">${esc(t("review.queue_empty"))}</p>`;
}

function drawCreators(ctx, profiles, flash = "") {
  const field = (label, value) => pair(label, esc(value || t("catalog.not_given")));
  const panel = (p) => {
    const name = p.display_name;
    const action = (decision, label, aria, primary = false) =>
      `<button type="button" class="${primary ? "sd-primary" : "sd-ghost"}" data-decision="${decision}" aria-label="${esc(t(aria, { name }))}">${esc(t(label))}</button>`;
    const buttons = p.verification_state === "pending"
      ? action("verified", "review.verify", "review.verify_aria", true) + action("rejected", "review.reject", "review.reject_aria")
      : p.verification_state === "verified" ? action("suspended", "review.suspend", "review.suspend_aria") : "";
    const form = buttons
      ? `<form class="sd-decide" data-creator="${esc(p.id)}" data-version="${esc(p.version)}"><label class="sd-field"><span>${esc(t("review.decision_note"))} · ${esc(t("review.decision_note_hint"))}</span><textarea name="note" rows="2" maxlength="1000"></textarea></label><div class="sd-actions">${buttons}</div><p class="sd-error" role="alert"></p></form>`
      : `<p class="sd-muted">${esc(t("review.no_action"))}</p>`;
    return `<article class="sd-panel"><div class="sd-spread"><h2>${esc(name)}</h2>${verificationBadge(p)}</div><p>${esc(creatorType(p))}</p>${p.bio ? `<p>${lines(p.bio)}</p>` : ""}<div class="sd-grid-2">${field("review.institution", p.institution)}${field("review.qualifications", (p.qualifications || []).join(", "))}${field("review.specialties", (p.specialties || []).join(", "))}</div>${evidenceList(p.evidence)}${form}</article>`;
  };
  $("#review-body").innerHTML = `${flash}${ctx.notice(t("review.creators_note"))}${profiles.length ? profiles.map(panel).join("") : `<p class="sd-muted">${esc(t("review.creators_empty"))}</p>`}`;
  document.querySelectorAll("form.sd-decide").forEach((form) => {
    form.onsubmit = (event) => event.preventDefault();
    form.querySelectorAll("[data-decision]").forEach((button) => {
      button.onclick = () => {
        const decision = button.dataset.decision;
        const note = form.note.value.trim();
        const errorBox = form.querySelector(".sd-error");
        if (decision !== "verified" && !note) {
          errorBox.textContent = t("review.note_required");
          form.note.focus();
          return;
        }
        run(ctx, button, errorBox, async () => {
          const saved = await sedens("review/creators/decide", { creator_id: form.dataset.creator, decision, note, version: form.dataset.version });
          const next = await sedens("review/creators");
          if (ctx.stale()) return;
          drawCreators(ctx, next.items, ctx.notice(t("review.creator_saved", { name: saved.display_name })));
        });
      };
    });
  });
}

function drawPublished(ctx, published, flash = "") {
  const row = (c) => {
    const state = c.suspended ? `<span class="sd-badge danger">${esc(t("review.state_suspended_course"))}</span>` : `<span class="sd-badge ok">${esc(t("review.state_live"))}</span>`;
    const view = c.published_version
      ? `<a href="${href("review", "courses", c.course_id, c.published_version)}" aria-label="${esc(t("review.view_version_aria", { title: c.title }))}">${esc(t("review.view_version"))}</a>`
      : "";
    const button = c.suspended
      ? `<button type="button" data-suspend="0" aria-label="${esc(t("review.reinstate_aria", { title: c.title }))}">${esc(t("review.reinstate"))}</button>`
      : `<button type="button" class="sd-ghost" data-suspend="1" aria-label="${esc(t("review.suspend_course_aria", { title: c.title }))}">${esc(t("review.suspend_course"))}</button>`;
    return `<article class="sd-panel"><div class="sd-row"><span class="sd-badge">${esc(typeWord(c.course_type))}</span>${c.published_version ? `<span class="sd-badge info">${esc(t("review.version", { n: c.published_version }))}</span>` : ""}${state}</div><h2>${esc(c.title)}</h2>${view}<form class="sd-suspend" data-course="${esc(c.course_id)}" data-title="${esc(c.title)}"><label class="sd-field"><span>${esc(t("review.reason"))}${c.suspended ? "" : " · " + esc(t("review.reason_hint"))}</span><textarea name="reason" rows="2" maxlength="1000"></textarea></label><div class="sd-actions">${button}</div><p class="sd-error" role="alert"></p></form></article>`;
  };
  $("#review-body").innerHTML = `${flash}${ctx.notice(t("review.published_hint"))}${published.length ? published.map(row).join("") : `<p class="sd-muted">${esc(t("review.published_empty"))}</p>`}`;
  document.querySelectorAll("form.sd-suspend").forEach((form) => {
    form.onsubmit = (event) => event.preventDefault();
    const button = form.querySelector("[data-suspend]");
    button.onclick = () => {
      const suspend = button.dataset.suspend === "1";
      const reason = form.reason.value.trim();
      const errorBox = form.querySelector(".sd-error");
      if (suspend && !reason) {
        errorBox.textContent = t("review.reason_required");
        form.reason.focus();
        return;
      }
      run(ctx, button, errorBox, async () => {
        await sedens("review/course/suspend", { course_id: form.dataset.course, suspend, reason });
        const next = await sedens("review/courses");
        if (ctx.stale()) return;
        drawPublished(ctx, next.published, ctx.notice(t("review.course_saved", { title: form.dataset.title })));
      });
    };
  });
}

// -- #/review/courses/:course/:version ---------------------------------------------------

export async function reviewCourse(ctx) {
  if (!gate(ctx)) return;
  const { course, version } = ctx.params;
  let detail;
  try {
    detail = await load(ctx, `review/course?id=${encodeURIComponent(course)}&version=${encodeURIComponent(version)}`);
  } catch (error) {
    if (ctx.stale()) return;
    if (!(error instanceof ApiError) || error.status !== 404) throw error;
    ctx.page(`${backToReview()}<h1>${esc(t("review.title"))}</h1>${ctx.notice(fail(error, ERRORS), "error")}`);
    return;
  }
  if (!detail || ctx.stale()) return;
  drawReview(ctx, detail);
}

const backToReview = () => `<a class="sd-back" href="#/review">← ${esc(t("review.back"))}</a>`;
const section = (title, body) => `<section class="sd-panel"><h2>${esc(t(title))}</h2>${body}</section>`;
// Label above value (no <dd> indent, which would squeeze narrow columns).
const pair = (label, value) => `<div><span class="sd-muted">${esc(t(label))}</span><br>${value}</div>`;
const text = (value) => (value ? lines(value) : `<span class="sd-muted">${esc(t("catalog.not_given"))}</span>`);
const exerciseTitle = (exercise) => exercise?.title?.[lang()] || exercise?.title?.en || exercise?.ref || "";

function details(snap) {
  const c = snap.course || {};
  const list = (prefix, codes) => text((codes || []).map((code) => word(prefix, code)).join(", "));
  const fields = [
    ["catalog.f_subtitle", text(c.subtitle)],
    ["catalog.f_description", text(c.description)],
    ["catalog.f_audience", text(c.audience)],
    ["catalog.f_prerequisites", text(c.prerequisites)],
    ["catalog.f_safety", text(c.safety)],
    ["catalog.f_outcomes", text(c.outcomes)],
    ["catalog.f_goals", text((c.goals || []).join("\n"))],
  ];
  const facts = [
    ["catalog.f_equipment", list("catalog.eq_", c.equipment)],
    ["catalog.f_body_areas", list("catalog.area_", c.body_areas)],
    ["catalog.f_duration", text(c.estimated_minutes ? t("catalog.minutes", { n: c.estimated_minutes }) : "")],
    ["catalog.f_weeks", text(c.weeks ? t("catalog.weeks", { n: c.weeks }) : "")],
    ["catalog.f_per_week", text(perWeek(c.sessions_per_week))],
    ["catalog.f_language", esc(word("catalog.lang_", c.language))],
    ["catalog.f_category", esc(word("catalog.cat_", c.category))],
    ["catalog.f_level", esc(word("catalog.level_", c.level))],
  ];
  const cover = snap.cover ? `<img class="sd-cover" src="/sedens/media/file?id=${esc(encodeURIComponent(snap.cover.id))}" alt="${esc(c.title)}" loading="lazy">` : "";
  return section("review.details", `${cover}<div class="sd-list">${fields.map(([l, v]) => pair(l, v)).join("")}</div><div class="sd-grid-4">${facts.map(([l, v]) => pair(l, v)).join("")}</div>`);
}

function priceAccess(snap) {
  const price = snap.price || {};
  const sale = price.price_type === "paid" && price.sale_state !== "active"
    ? ` · ${esc(t(price.sale_state === "paused" ? "review.sale_paused" : "review.sale_not_for_sale"))}`
    : "";
  const facilities = (snap.facilities || [])
    .map((f) => `<li><span>${esc(f.facility_name)}${f.location_name ? ` · ${esc(f.location_name)}` : ""}</span><span class="sd-muted">${esc(t(f.free ? "review.facility_free" : "review.facility_paid"))}</span></li>`)
    .join("");
  const list = facilities
    ? `<h3>${esc(t("review.facilities"))}</h3><ul class="sd-list">${facilities}</ul>`
    : snap.distribution === "selected_facilities" ? `<p class="sd-muted">${esc(t("review.no_facilities"))}</p>` : "";
  return section("review.price_access", `<div class="sd-grid-2">${pair("review.price", esc(money(price)) + sale)}${pair("review.who", esc(distributionWord(snap.distribution)))}</div>${list}`);
}

function exerciseStatus(exercise) {
  const status = exercise?.review?.status || "unreviewed";
  // SEDENS Standard v0 is demo content; say so in the server's own words.
  if (exercise?.source === "standard" && status === "unreviewed") return t("review.ex_standard_unreviewed");
  return word("review.ex_", status);
}

function dose(step) {
  const parts = [
    step.sets ? t("review.dose_sets", { n: step.sets }) : "",
    step.reps ? t("review.dose_reps", { n: step.reps }) : "",
    step.hold_seconds ? t("review.dose_hold", { n: step.hold_seconds }) : "",
    step.work_seconds ? t("review.dose_work", { n: step.work_seconds }) : "",
    step.rest_seconds ? t("review.dose_rest", { n: step.rest_seconds }) : "",
    step.sides && step.sides !== "none" ? word("review.sides_", step.sides) : "",
  ];
  return parts.filter(Boolean).join(" · ");
}

const fileTitle = (media) => media?.title || t("review.untitled_file");

function stepItem(step, n) {
  const ex = step.exercise || {};
  const title = step.title || exerciseTitle(ex);
  const facts = [
    [ "review.dose", esc(dose(step)) ],
    [ "review.cue", step.customer_cue ? lines(step.customer_cue) : "" ],
    [ "review.narration", step.narration ? lines(step.narration) : "" ],
    [ "review.easier", step.regression ? lines(step.regression) : "" ],
    [ "review.harder", step.progression ? lines(step.progression) : "" ],
    [ "catalog.f_equipment", esc((step.equipment || []).map((code) => word("catalog.eq_", code)).join(", ")) ],
    [ "review.step_video", step.video ? esc(fileTitle(step.video)) : "" ],
    [ "review.step_image", step.image ? esc(fileTitle(step.image)) : "" ],
  ].filter(([, value]) => value);
  const anatomy = (step.anatomy || []).length
    ? `<p><strong>${esc(t("review.anatomy"))}</strong></p><p class="sd-muted">${esc(t("review.anatomy_label"))}</p><div class="sd-chips">${step.anatomy.map((a) => `<span class="sd-chip">${esc(a.key)} · ${esc(word("review.role_", a.role))}</span>`).join("")}</div>`
    : "";
  const timeline = (step.timeline || []).length
    ? `<p><strong>${esc(t("review.timeline"))}</strong></p><ul>${step.timeline.map((m) => `<li>${esc(t("review.moment", { start: (m.start_ms / 1000).toFixed(1), end: (m.end_ms / 1000).toFixed(1) }))} · ${esc(word("review.mode_", m.mode))}${m.layer ? ` · ${esc(word("review.layer_", m.layer))}` : ""}${(m.structures || []).length ? ` · ${esc(m.structures.join(", "))}` : ""}${m.cue ? `<br>${lines(m.cue)}` : ""}</li>`).join("")}</ul>`
    : "";
  const variant = step.variant && step.variant !== "standard" ? `<span class="sd-badge">${esc(word("review.variant_", step.variant))}</span>` : "";
  return `<article class="sd-step"><h5>${esc(t("review.step", { n, title }))}</h5><div class="sd-row"><span class="sd-badge">${esc(word("review.phase_", step.phase))}</span><span class="sd-badge info">${esc(word("review.source_", ex.source))}</span><span class="sd-badge warn">${esc(exerciseStatus(ex))}</span>${variant}</div>${step.title && step.title !== exerciseTitle(ex) ? `<p class="sd-muted">${esc(exerciseTitle(ex))}</p>` : ""}<div class="sd-list">${facts.map(([l, v]) => pair(l, v)).join("")}</div>${anatomy}${timeline}</article>`;
}

function lessonItem(lesson, n) {
  const file = lesson.media ? pair("review.lesson_file", `${esc(fileTitle(lesson.media))} · ${esc(word("review.kind_", lesson.media.kind))}`) : "";
  const exercise = lesson.exercise ? pair("review.exercise", `${esc(exerciseTitle(lesson.exercise))} · ${esc(word("review.source_", lesson.exercise.source))}`) : "";
  return `<article class="sd-step"><h4>${esc(t("review.lesson", { n, title: lesson.title }))}</h4><div class="sd-row"><span class="sd-badge">${esc(word("catalog.lesson_", lesson.kind))}</span></div>${lesson.body ? `<p>${lines(lesson.body)}</p>` : ""}<div class="sd-list">${file}${exercise}</div></article>`;
}

function outline(snap) {
  const modules = (snap.modules || []).map((m, i) => {
    const sessions = (m.sessions || []).map((s, j) => `<section><h4>${esc(t("review.session", { n: j + 1, title: s.title }))} <span class="sd-muted">· ${esc(t("catalog.minutes", { n: s.estimated_minutes || 0 }))}</span></h4>${s.summary ? `<p class="sd-muted">${lines(s.summary)}</p>` : ""}${(s.steps || []).length ? s.steps.map((step, k) => stepItem(step, k + 1)).join("") : `<p class="sd-muted">${esc(t("review.no_steps"))}</p>`}</section>`).join("");
    const lessons = (m.lessons || []).map((x, j) => lessonItem(x, j + 1)).join("");
    const empty = !sessions && !lessons ? `<p class="sd-muted">${esc(t(snap.course?.course_type === "professional_education" ? "review.no_lessons" : "review.no_steps"))}</p>` : "";
    return `<li><h3>${esc(t("review.module", { n: i + 1, title: m.title }))}</h3>${m.summary ? `<p class="sd-muted">${lines(m.summary)}</p>` : ""}${sessions}${lessons}${empty}</li>`;
  });
  return section("review.outline", modules.length ? `<ol class="sd-tree">${modules.join("")}</ol>` : `<p class="sd-muted">${esc(t("review.outline_empty"))}</p>`);
}

/** The evidence a creator offered: its kind, description, link and attached file. */
function evidenceList(items) {
  const rows = (items || []).map((e) => `<li><span><strong>${esc(word("review.ev_", e.kind))}</strong> · ${esc(e.description)}</span><span>${e.url ? safeLink(e.url) : ""}${e.object_id ? ` <a href="/sedens/media/file?id=${esc(encodeURIComponent(e.object_id))}" target="_blank" rel="noopener noreferrer">${esc(t("review.evidence_file"))}</a>` : ""}</span></li>`).join("");
  return `<h3>${esc(t("review.evidence"))}</h3>${rows ? `<ul class="sd-list">${rows}</ul>` : `<p class="sd-muted">${esc(t("review.evidence_none"))}</p>`}`;
}

function creatorSection(creator) {
  return section("review.creator", `<p>${creatorLine(creator)}</p><p class="sd-muted">${esc(t("review.creators_note"))}</p><div class="sd-grid-2">${pair("review.creator_type", esc(creatorType(creator)))}${pair("review.institution", text(creator.institution))}${pair("review.qualifications", text((creator.qualifications || []).join(", ")))}</div>${evidenceList(creator.evidence)}`);
}

// Titles and kinds come from the snapshot's media summaries (the rights rows carry neither).
function mediaIndex(snap) {
  const index = {};
  const add = (media) => media?.id && (index[media.id] = media);
  add(snap.cover);
  for (const m of snap.modules || []) {
    for (const s of m.sessions || []) for (const step of s.steps || []) [step.video, step.image].forEach(add);
    for (const lesson of m.lessons || []) add(lesson.media);
  }
  return index;
}

const RIGHTS_BADGE = { approved: "ok", rejected: "danger" };
const rightsStatus = (status) => `<span class="sd-badge ${RIGHTS_BADGE[status] || "warn"}">${esc(word("review.rights_", status))}</span>`;

function filesSection(detail) {
  const index = mediaIndex(detail.snapshot || {});
  const rows = (detail.media_rights || []).map((r) => {
    const media = index[r.object_id] || {};
    const title = fileTitle(media);
    const links = [r.source_url ? safeLink(r.source_url, t("review.source_link")) : "", r.licence_url ? safeLink(r.licence_url, t("review.licence_link")) : ""].filter(Boolean).join(" · ");
    const rights = `<div class="sd-list">${pair("review.licence", esc(word("review.lic_", r.licence_type)))}${pair("review.original_creator", text(r.original_creator))}${links ? pair("review.links", links) : ""}${pair("review.restrictions", text(r.restrictions))}${pair("review.people", esc(word("review.people_", r.identifiable_person)))}</div>`;
    const form = `<form class="sd-rights" data-object="${esc(r.object_id)}"><label class="sd-field"><span>${esc(t("review.rights_note"))}</span><textarea name="note" rows="2" maxlength="1000"></textarea></label><div class="sd-actions"><button type="button" data-rights="approved" aria-label="${esc(t("review.rights_approve_aria", { title }))}">${esc(t("review.rights_approve"))}</button><button type="button" class="sd-ghost" data-rights="rejected" aria-label="${esc(t("review.rights_reject_aria", { title }))}">${esc(t("review.rights_reject"))}</button></div><p class="sd-error" role="alert"></p><p class="sd-muted" role="status"></p></form>`;
    const thumb = media.kind === "image" ? `<img class="sd-thumb" src="/sedens/media/file?id=${esc(encodeURIComponent(r.object_id))}" alt="${esc(title)}" loading="lazy"><br>` : "";
    return `<tr><th scope="row">${thumb}${esc(title)}${media.kind ? `<br><span class="sd-muted">${esc(word("review.kind_", media.kind))}</span>` : ""}${media.source === "repo" ? `<br><span class="sd-badge warn">${esc(t("review.ai_illustration"))}</span>` : ""}</th><td>${rights}</td></tr><tr><td colspan="2"><p data-status><span class="sd-muted">${esc(t("review.col_review"))}:</span> ${rightsStatus(r.review_status)}</p>${form}</td></tr>`;
  });
  return section("review.files", rows.length
    ? `<p class="sd-muted">${esc(t("review.files_first"))}</p><table class="sd-table"><thead><tr><th scope="col">${esc(t("review.col_file"))}</th><th scope="col">${esc(t("review.col_rights"))}</th></tr></thead><tbody>${rows.join("")}</tbody></table>`
    : `<p class="sd-muted">${esc(t("review.files_none"))}</p>`);
}

function wordingSection(notes) {
  return section("review.wording", (notes || []).length
    ? `<p class="sd-muted">${esc(t("review.wording_hint"))}</p><div class="sd-chips">${notes.map((n) => `<span class="sd-chip">${esc(n)}</span>`).join("")}</div>`
    : `<p class="sd-muted">${esc(t("review.wording_none"))}</p>`);
}

function earlierSection(reviews, items) {
  const entry = (r) => {
    const checks = Object.entries(r.checklist || {});
    const list = checks.length
      ? `<details><summary>${esc(t("review.past_checklist"))}</summary><ul>${items.filter((i) => r.checklist[i]).map((i) => `<li>${esc(t("review.check_" + i))}: ${esc(word("review.result_", r.checklist[i].result))}${r.checklist[i].note ? ` — ${esc(r.checklist[i].note)}` : ""}</li>`).join("")}</ul></details>`
      : "";
    return `<li class="sd-consent"><p><strong>${esc(word("review.past_", r.decision))}</strong> <span class="sd-muted">· ${esc(date(r.created_at))}</span></p>${r.comment ? `<p>${lines(r.comment)}</p>` : ""}${list}</li>`;
  };
  return section("review.earlier", (reviews || []).length ? `<ul class="sd-list">${reviews.map(entry).join("")}</ul>` : `<p class="sd-muted">${esc(t("review.earlier_none"))}</p>`);
}

function decisionForm(items) {
  const radio = (name, value, label) => `<label class="sd-check"><input type="radio" name="${name}" value="${value}"> ${esc(t(label))}</label>`;
  const checks = items.map((item) => `<fieldset id="check-${item}"><legend>${esc(t("review.check_" + item))}</legend><p class="sd-muted">${esc(t("review.check_" + item + "_hint"))}</p><div class="sd-row">${RESULTS.map((r) => radio("result_" + item, r, "review.result_" + r)).join("")}</div><label class="sd-field"><span>${esc(t("review.check_note"))}</span><textarea name="note_${item}" rows="1" maxlength="1000"></textarea></label></fieldset>`).join("");
  return `<form id="decide" novalidate><h3>${esc(t("review.checklist"))}</h3><div class="sd-checklist">${checks}</div><fieldset class="sd-step" id="overall"><legend>${esc(t("review.overall"))}</legend><div class="sd-row">${DECISIONS.map((d) => radio("decision", d, "review.dec_" + d)).join("")}</div></fieldset><label class="sd-field"><span>${esc(t("review.comment"))} · ${esc(t("review.comment_hint"))}</span><textarea name="comment" rows="4" maxlength="4000"></textarea></label><ul class="sd-muted"><li>${esc(t("review.approve_publishes"))}</li><li>${esc(t("review.not_medical"))}</li></ul><p class="sd-error" role="alert"></p><div class="sd-actions"><button class="sd-primary">${esc(t("review.submit"))}</button></div></form>`;
}

// Long codes get break points every 16 characters so they wrap on a phone.
const breakable = (code) => esc(code).replace(/(.{16})(?=.)/g, "$1<wbr>");

function advanced(detail) {
  const snap = detail.snapshot || {};
  return `<details class="sd-advanced"><summary>${esc(t("review.advanced"))}</summary><div class="sd-list">${pair("review.fingerprint", `<code>${breakable(detail.snapshot_sha256)}</code>`)}${pair("review.course_code", `<code>${breakable(detail.course_id)}</code>`)}${snap.standard_version ? pair("review.standard_version", esc(snap.standard_version)) : ""}${snap.atlas_hash ? pair("review.atlas_version", `<code>${esc(snap.atlas_hash)}</code>`) : ""}</div></details>`;
}

function drawReview(ctx, detail, flash = "") {
  const snap = detail.snapshot || {};
  const course = snap.course || {};
  const items = detail.checklist_items || [];
  const waiting = detail.state === "submitted";
  const state = word("review.vstate_", detail.state);
  ctx.page(`${backToReview()}<div class="sd-row"><span class="sd-badge">${esc(typeWord(course.course_type))}</span><span class="sd-badge info">${esc(t("review.version", { n: detail.version }))}</span><span class="sd-badge ${waiting ? "warn" : ""}">${esc(state)}</span></div><h1>${esc(course.title)}</h1>${flash}<p>${esc(t("review.exact", { version: detail.version, date: date(detail.submitted_at) }))}</p><p class="sd-muted">${esc(t("review.not_medical"))}</p>${detail.note ? `<h2>${esc(t("review.creator_note"))}</h2><blockquote>${lines(detail.note)}</blockquote>` : ""}${details(snap)}${priceAccess(snap)}${outline(snap)}${creatorSection(detail.creator || snap.creator || {})}${filesSection(detail)}${wordingSection(detail.wording_notes)}${earlierSection(detail.reviews, items)}<section class="sd-panel"><h2>${esc(t("review.decision"))}</h2>${waiting ? decisionForm(items) : ctx.notice(t("review.not_waiting"))}</section>${advanced(detail)}`);
  bindRights(ctx);
  if (waiting) bindDecision(ctx, detail, items);
}

function bindRights(ctx) {
  document.querySelectorAll("form.sd-rights").forEach((form) => {
    form.onsubmit = (event) => event.preventDefault();
    form.querySelectorAll("[data-rights]").forEach((button) => {
      button.onclick = () => {
        const decision = button.dataset.rights;
        const note = form.note.value.trim();
        const errorBox = form.querySelector(".sd-error");
        if (decision === "rejected" && !note) {
          errorBox.textContent = t("review.rights_note_required");
          form.note.focus();
          return;
        }
        // Updated in place: the decision form below may already hold typed notes.
        run(ctx, button, errorBox, async () => {
          const saved = await sedens("review/media/decide", { object_id: form.dataset.object, decision, note });
          if (ctx.stale()) return;
          form.closest("td").querySelector("[data-status]").innerHTML = `<span class="sd-muted">${esc(t("review.col_review"))}:</span> ${rightsStatus(saved.review_status)}`;
          form.querySelector("[role=status]").textContent = t("review.rights_saved");
          form.querySelectorAll("button").forEach((b) => (b.disabled = false));
        });
      };
    });
  });
}

function bindDecision(ctx, detail, items) {
  const form = $("#decide");
  const errorBox = form.querySelector(".sd-error");
  const refuse = (message, focus) => {
    errorBox.textContent = message;
    focus?.focus();
  };
  form.onsubmit = async (event) => {
    event.preventDefault();
    const v = values(form);
    const missing = items.find((item) => !v["result_" + item]);
    if (missing) return refuse(t("review.missing_result", { item: t("review.check_" + missing) }), form.querySelector(`#check-${missing} input`));
    if (!v.decision) return refuse(t("review.missing_decision"), form.querySelector("#overall input"));
    const comment = (v.comment || "").trim();
    if (v.decision === "approved" && items.some((item) => v["result_" + item] === "needs_work")) return refuse(t("review.needs_work_blocks"), form.querySelector("#overall input"));
    if (v.decision !== "approved" && !comment) return refuse(t("review.comment_required"), form.comment);
    const checklist = Object.fromEntries(items.map((item) => [item, { result: v["result_" + item], note: (v["note_" + item] || "").trim() }]));
    const button = form.querySelector("button.sd-primary");
    button.disabled = true;
    errorBox.textContent = "";
    try {
      const result = await sedens("review/course/decide", {
        course_id: detail.course_id, version: detail.version, decision: v.decision,
        snapshot_sha256: detail.snapshot_sha256, checklist, comment,
      });
      const next = await sedens(`review/course?id=${encodeURIComponent(detail.course_id)}&version=${encodeURIComponent(detail.version)}`);
      if (ctx.stale()) return;
      drawReview(ctx, next, ctx.notice(t("review.decided", { state: word("review.vstate_", result.state) })));
    } catch (error) {
      if (ctx.stale()) return;
      button.disabled = false;
      errorBox.textContent = fail(error, ERRORS);
      // Decided or changed elsewhere: only a reload shows the real state.
      if (["version_changed", "not_submitted"].includes(error?.code)) {
        errorBox.insertAdjacentHTML("beforeend", ` <button type="button" class="sd-ghost" data-reload>${esc(t("review.reload"))}</button>`);
        errorBox.querySelector("[data-reload]").onclick = () => ctx.refresh();
      }
    }
  };
}
