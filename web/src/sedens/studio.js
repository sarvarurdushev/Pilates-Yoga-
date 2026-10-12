// Creator Studio: the creator's home, the new-course wizard, the course editor,
// the guided-training session editor and the media library. Every course edit
// sends the revision of the editor view this page last rendered, so two windows
// never overwrite each other silently; the answer to a save is the new state.
import { sedens, upload } from "./api.js";
import { t, lang } from "./i18n.js";
import { $, esc, money, date, values, problem, safeLink } from "./ui.js";
import { href } from "./router.js";

const T = (key, vars) => t("studio." + key, vars);
const fileUrl = (id) => "/sedens/media/file?id=" + encodeURIComponent(id);
const pick = (pair) => (pair && (pair[lang()] || pair.en)) || "";
const commaList = (text) => String(text || "").split(/[,，、]/).map((s) => s.trim()).filter(Boolean);
const mb = (bytes) => Math.round((bytes / 1048576) * 10) / 10;

// -- small builders -------------------------------------------------------------------

const field = (label, control, hint = "") =>
  `<label class="sd-field"><span>${esc(label)}</span>${control}${hint ? `<small class="sd-muted">${esc(hint)}</small>` : ""}</label>`;
const text = (name, value = "", attrs = "") => `<input name="${name}" value="${esc(value)}" ${attrs}>`;
const area = (name, value = "", attrs = "") => `<textarea name="${name}" rows="3" ${attrs}>${esc(value)}</textarea>`;
const whole = (name, value, attrs = "") =>
  `<input name="${name}" type="number" inputmode="numeric" step="1" data-type="int" value="${esc(value ?? "")}" ${attrs}>`;
const options = (pairs, selected) =>
  pairs.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(selected ?? "") ? "selected" : ""}>${esc(l)}</option>`).join("");
const select = (name, pairs, selected, attrs = "") => `<select name="${name}" ${attrs}>${options(pairs, selected)}</select>`;
const words = (prefix, codes) => codes.map((c) => [c, T(prefix + "." + c)]);
const errorLine = () => `<p class="sd-error" role="alert"></p>`;
// .sd-checklist gives a fieldset the studio's border and spacing.
const group = (legend, body) => `<div class="sd-checklist"><fieldset><legend>${esc(legend)}</legend>${body}</fieldset></div>`;
const checks = (legend, name, pairs, chosen = []) =>
  group(legend, `<div class="sd-grid-4">${pairs.map(([v, l]) => `<label class="sd-check"><input type="checkbox" name="${name}" value="${esc(v)}" data-list ${chosen.includes(v) ? "checked" : ""}> ${esc(l)}</label>`).join("")}</div>`);
const radios = (name, pairs, chosen, explain = null) =>
  pairs.map(([v, l]) => `<label class="sd-check"><input type="radio" name="${name}" value="${esc(v)}" ${v === chosen ? "checked" : ""}> <span>${esc(l)}${explain ? `<br><span class="sd-muted">${esc(explain(v))}</span>` : ""}</span></label>`).join("");

const STATE_BADGE = { draft: "info", submitted: "info", needs_revision: "warn", published: "ok", suspended: "danger", archived: "" };
const stateBadge = (state) => `<span class="sd-badge ${STATE_BADGE[state] ?? ""}">${esc(T("state." + state))}</span>`;
const VERIFY_BADGE = { unverified: "", pending: "info", verified: "ok", rejected: "danger", suspended: "danger" };
const verifyBadge = (state) => `<span class="sd-badge ${VERIFY_BADGE[state] ?? ""}">${esc(T("verify." + state))}</span>`;

/** A refusal in the person's words. Medical-claim refusals keep the server's
 * sentence, because it names the exact phrase to rephrase. */
function fail(error) {
  if (error?.code === "medical_claim_wording") {
    if (lang() === "en") return error.message;
    const phrases = String(error.message || "").split(":").slice(1).join(":").trim();
    return phrases ? `${t("error.medical_claim_wording")} ${T("claim_phrases", { phrases })}` : t("error.medical_claim_wording");
  }
  const own = "studio.error." + (error?.code || "");
  return t(own) !== own ? t(own) : problem(error);
}

function report(ctx, target, error) {
  const where = target || $("#studio-error");
  if (!where) return;
  where.textContent = fail(error);
  if (error?.code === "course_changed") {
    const reload = document.createElement("button");
    reload.type = "button";
    reload.className = "sd-button";
    reload.textContent = T("reload");
    reload.onclick = () => ctx.refresh();
    where.append(" ", reload);
  }
}

/** Run one call for a form or a scope: its buttons wait, a refusal shows in its own
 * error line, and buttons that were disabled on purpose stay disabled. */
async function attempt(ctx, scope, run) {
  const error = scope?.querySelector(":scope > .sd-error") || null;
  const buttons = [...(scope?.querySelectorAll("button") || [])];
  const was = buttons.map((b) => b.disabled);
  buttons.forEach((b) => (b.disabled = true));
  if (error) error.textContent = "";
  try {
    await run();
  } catch (e) {
    if (!ctx.stale()) report(ctx, error, e);
  } finally {
    buttons.forEach((b, i) => (b.disabled = was[i]));
  }
}

const scopeOf = (el) => el.closest("form") || el.closest("[data-scope]");

/** Re-render part of a page and put keyboard focus back on the same control: the same
 * data-focus key, the same action on the same item, or the same field of the same form. */
function keepFocus(container, render, fallback = "") {
  const active = document.activeElement;
  const { act, id, focus: key } = active?.dataset || {};
  const form = active?.closest?.("form[data-form]");
  const formKey = form
    ? `form[data-form="${form.dataset.form}"]` + (form.dataset.id ? `[data-id="${CSS.escape(form.dataset.id)}"]` : ":not([data-id])") + (form.dataset.module ? `[data-module="${CSS.escape(form.dataset.module)}"]` : "")
    : "";
  const wasButton = active?.tagName === "BUTTON";
  render();
  let again =
    (key && container.querySelector(`[data-focus="${CSS.escape(key)}"]`)) ||
    (act && id && container.querySelector(`button[data-act="${CSS.escape(act)}"][data-id="${CSS.escape(id)}"]:not(:disabled)`)) ||
    (id && container.querySelector(`button[data-id="${CSS.escape(id)}"]:not(:disabled)`));
  const twin = !again && formKey ? container.querySelector(formKey) : null;
  if (twin) {
    // A form for a new item comes back empty: start typing the next one.
    const fresh = !form.dataset.id && twin.querySelector("[data-focus]");
    const named = active.name ? twin.elements[active.name] : null;
    again = fresh || (wasButton ? twin.querySelector("button:not([type=button])") : named?.focus ? named : null);
  }
  again ||= fallback ? container.querySelector(fallback) : null;
  again?.focus?.({ preventScroll: true });
}

function signedOut(ctx) {
  ctx.page(`${ctx.backLink()}<h1>${esc(T("title"))}</h1>${ctx.notice(T("signed_out"))}`);
}

function noAccess(ctx) {
  ctx.page(
    `${ctx.backLink()}<h1>${esc(T("title"))}</h1>${ctx.notice(T("need_capability"))}<p>${esc(T("need_capability_professor"))}</p><p><a class="sd-button" href="#/">${esc(T("go_home"))}</a></p>`,
  );
}

/** Load what a studio page needs; answers false (after explaining) when the person has no creator tools. */
async function load(ctx, calls) {
  try {
    return await Promise.all(calls.map((route) => sedens(route)));
  } catch (error) {
    if (ctx.stale()) return null;
    if (error?.status === 403) {
      noAccess(ctx);
      return null;
    }
    if (error?.status === 404) {
      ctx.page(`<a class="sd-back" href="#/creator">← ${esc(T("back_studio"))}</a><h1>${esc(T("title"))}</h1>${ctx.notice(fail(error), "error")}`);
      return null;
    }
    throw error;
  }
}

function loading(ctx, title) {
  ctx.page(`<a class="sd-back" href="#/creator">← ${esc(T("back_studio"))}</a><h1>${esc(title)}</h1>${ctx.notice(t("common.loading"))}`);
}

const studioBack = () => `<a class="sd-back" href="#/creator">← ${esc(T("back_studio"))}</a>`;

// -- the course metadata form (wizard step 2 and the editor's Details) --------------------

function metadataFields(course, vocab, type) {
  const guided = type === "guided_training";
  return `<div class="sd-grid-2">${field(T("f.title"), text("title", course.title, 'required maxlength="120"'))}${field(T("f.subtitle"), text("subtitle", course.subtitle, 'maxlength="160"'))}</div>` +
    field(T("f.description"), area("description", course.description, 'rows="5" maxlength="4000"'), T("f.plain_text")) +
    `<div class="sd-grid-4">${field(T("f.language"), select("language", words("language", vocab.languages), course.language))}${field(T("f.category"), select("category", words("category", vocab.categories), course.category))}${field(T("f.level"), select("level", words("level", vocab.levels), course.level))}</div>` +
    field(T("f.audience"), area("audience", course.audience, 'maxlength="2000"')) +
    field(T("f.prerequisites"), area("prerequisites", course.prerequisites, 'maxlength="2000"')) +
    checks(T("f.equipment"), "equipment", words("equipment", vocab.equipment), course.equipment || []) +
    field(T("f.goals"), text("goals", (course.goals || []).join(", "), 'maxlength="900"'), T("f.comma_hint")) +
    checks(T("f.body_areas"), "body_areas", words("body_area", vocab.body_areas), course.body_areas || []) +
    `<div class="sd-grid-4">${field(T("f.minutes"), whole("estimated_minutes", course.estimated_minutes || "", 'min="0" max="600"'))}${field(T("f.weeks"), whole("weeks", course.weeks || "", 'min="0" max="52"'))}${field(guided ? T("f.sessions_per_week") : T("f.lessons_per_week"), whole("sessions_per_week", course.sessions_per_week || "", 'min="0" max="14"'))}</div>` +
    field(T("f.safety"), area("safety", course.safety, 'maxlength="2000"'), T("f.safety_hint")) +
    field(T("f.outcomes"), area("outcomes", course.outcomes, 'maxlength="2000"'), T("f.outcomes_hint"));
}

function readMetadata(form) {
  const v = values(form);
  return {
    title: v.title.trim(), subtitle: v.subtitle, description: v.description, language: v.language,
    category: v.category, level: v.level, audience: v.audience, prerequisites: v.prerequisites,
    safety: v.safety, outcomes: v.outcomes, equipment: v.equipment || [], goals: commaList(v.goals),
    body_areas: v.body_areas || [], estimated_minutes: v.estimated_minutes ?? 0, weeks: v.weeks ?? 0,
    sessions_per_week: v.sessions_per_week ?? 0,
  };
}

const kindOf = (mime) =>
  ({ "video/mp4": "video", "video/webm": "video", "image/jpeg": "image", "image/png": "image", "image/webp": "image", "application/pdf": "pdf" })[mime] || null;
const ready = (media, kind) => media.filter((m) => m.state === "ready" && (!kind || m.kind === kind));

function mediaInfo(m) {
  if (!m) return "";
  const licence = m.rights?.licence_type || "none";
  return `<span class="sd-muted">${esc(T("licence." + licence))} · ${esc(T("rights_review." + (m.rights?.review_status || "unreviewed")))}</span>${m.label ? `<br><span class="sd-demo-label">${esc(pick(m.label))}</span>` : ""}`;
}

function mediaSelect(name, kind, chosen, media, label) {
  const pairs = [["", T("no_file")], ...ready(media, kind).map((m) => [m.id, m.title || m.filename || T("kind." + m.kind)])];
  if (chosen && !pairs.some(([id]) => id === chosen)) pairs.push([chosen, T("file_missing")]);
  const found = media.find((m) => m.id === chosen);
  return `${field(label, select(name, pairs, chosen || "", `data-media-kind="${kind}"`))}<p class="sd-muted" data-media-info="${name}">${mediaInfo(found)}</p>`;
}

function exerciseList(items, label, act) {
  if (!items.length) return `<p class="sd-muted">${esc(T("no_exercises"))}</p>`;
  return `<ul class="sd-list">${items
    .map((x) => {
      const name = pick(x.title);
      const source = x.source === "standard" ? `${T("source_standard")} · ${pick(label)}` : T("source_catalog");
      return `<li><div><strong>${esc(name)}</strong><div class="sd-muted">${esc(source)}</div></div><button type="button" data-act="${act}" data-source="${esc(x.source)}" data-ref="${esc(x.ref)}" data-title="${esc(name)}" aria-label="${esc(T("choose_named", { name }))}">${esc(T("choose"))}</button></li>`;
    })
    .join("")}</ul>`;
}

async function searchExercises(query) {
  return sedens("creator/exercises?" + new URLSearchParams({ q: query.trim() }));
}

// -- #/creator ----------------------------------------------------------------------------

const GROUPS = ["draft", "submitted", "needs_revision", "published", "suspended", "archived"];

export async function studioHome(ctx) {
  if (!ctx.me) return signedOut(ctx);
  loading(ctx, T("title"));
  const loaded = await load(ctx, ["creator/studio"]);
  if (!loaded || ctx.stale()) return;
  const data = loaded[0];
  ctx.page(
    `${ctx.backLink()}<div class="sd-spread"><h1>${esc(T("title"))}</h1><div class="sd-row"><a class="sd-primary" href="#/creator/courses/new">${esc(T("new_course"))}</a><a class="sd-button" href="#/creator/media">${esc(T("media_library"))}</a></div></div><p class="sd-lead">${esc(T("home_lead"))}</p><p class="sd-error" role="alert" id="studio-error"></p>` +
      `<section class="sd-panel" id="home-courses"></section><section class="sd-panel" id="home-profile" data-scope></section><section class="sd-panel" id="home-evidence"></section><section class="sd-panel" id="home-facilities" data-scope></section>`,
  );
  const allowed = ctx.me.organization?.kind === "creator_studio" ? ["professor", "expert"] : ["coach", "professor", "expert"];

  const courses = () => {
    const items = data.courses || [];
    const groups = GROUPS.map((g) => [g, items.filter((c) => c.review_state === g)]).filter(([, list]) => list.length);
    $("#home-courses").innerHTML = `<h2>${esc(T("your_courses"))}</h2>${
      groups.length
        ? groups
            .map(([g, list]) => `<h3>${esc(T("group." + g))} <span class="sd-muted">(${list.length})</span></h3><ul class="sd-list">${list.map(courseRow).join("")}</ul>`)
            .join("")
        : `<p class="sd-muted">${esc(T("no_courses"))}</p><a class="sd-primary" href="#/creator/courses/new">${esc(T("new_course"))}</a>`
    }`;
  };
  const courseRow = (c) =>
    `<li><div><strong>${esc(c.title)}</strong><div class="sd-muted">${esc(T("type." + c.course_type))} · ${esc(T("language." + c.language))} · ${esc(money(c.price))} · ${esc(T("offered_by", { who: T("distribution." + c.distribution) }))} · ${esc(T("updated", { date: date(c.updated_at) }))}</div></div><a class="sd-button" href="${href("creator", "courses", c.id)}" aria-label="${esc(T("open_named", { name: c.title }))}">${esc(T("open"))}</a></li>`;

  const profile = () => {
    const p = data.profile;
    const state = p?.verification_state || "unverified";
    const types = [...new Set([...allowed, ...(p ? [p.creator_type] : [])])];
    $("#home-profile").innerHTML =
      `<h2>${esc(T("profile"))}</h2>` +
      (p
        ? `<p>${esc(T("verification"))} ${verifyBadge(state)}</p><p class="sd-muted">${esc(T("verify_hint." + state))}</p>${["unverified", "rejected"].includes(state) ? `<p><button type="button" data-act="verify">${esc(T("verify_request"))}</button></p>` : ""}`
        : `<p class="sd-muted">${esc(T("profile_create_hint"))}</p>`) +
      `<form id="profile-form">${field(T("p.display_name"), text("display_name", p?.display_name || ctx.me.user.name, 'required maxlength="80"'))}${field(T("p.creator_type"), select("creator_type", words("creator_type", types), p?.creator_type || types[0]), T("p.creator_type_hint"))}${field(T("p.institution"), text("institution", p?.institution, 'maxlength="160"'))}${field(T("p.bio"), area("bio", p?.bio, 'rows="4" maxlength="2000"'))}${field(T("p.qualifications"), text("qualifications", (p?.qualifications || []).join(", ")), T("f.comma_hint"))}${field(T("p.specialties"), text("specialties", (p?.specialties || []).join(", ")), T("f.comma_hint"))}${p && state !== "unverified" ? `<p class="sd-muted">${esc(T("profile_edit_resets"))}</p>` : ""}<div class="sd-actions"><button class="sd-primary">${esc(p ? t("common.save") : T("profile_create"))}</button></div><p class="sd-muted" role="status" data-status></p>${errorLine()}</form>${errorLine()}`;
  };

  const evidence = () => {
    const files = new Map((data.media || []).map((m) => [m.id, m]));
    const items = data.evidence || [];
    $("#home-evidence").innerHTML =
      `<h2>${esc(T("evidence"))}</h2><p class="sd-muted">${esc(T("evidence_hint"))}</p>` +
      (items.length
        ? `<ul class="sd-list">${items.map((e) => `<li><div><strong>${esc(T("evidence_kind." + e.kind))}</strong><div>${esc(e.description)}</div><div class="sd-muted">${e.url ? safeLink(e.url, T("evidence_link")) + " · " : ""}${e.object_id ? esc(T("evidence_file", { name: files.get(e.object_id)?.title || T("file_missing") })) + " · " : ""}${esc(date(e.created_at))}</div></div></li>`).join("")}</ul>`
        : `<p class="sd-muted">${esc(T("no_evidence"))}</p>`) +
      (data.profile
        ? `<details><summary>${esc(T("evidence_add"))}</summary><form id="evidence-form">${field(T("evidence_kind_label"), select("kind", words("evidence_kind", ["qualification", "institution", "identity", "other"]), "qualification"))}${field(T("evidence_description"), area("description", "", 'required maxlength="1000"'))}${field(T("evidence_url"), text("url", "", 'type="url" inputmode="url" placeholder="https://" maxlength="500"'), T("evidence_url_hint"))}${field(T("evidence_object"), select("object_id", [["", T("no_file")], ...ready(data.media || []).filter((m) => m.source !== "repo").map((m) => [m.id, m.title || m.filename])], ""), T("evidence_object_hint"))}<div class="sd-actions"><button class="sd-primary">${esc(T("evidence_save"))}</button></div>${errorLine()}</form></details>`
        : "");
  };

  const facilities = () => {
    const targets = data.targets || [];
    const affiliations = data.affiliations || [];
    $("#home-facilities").innerHTML =
      `<h2>${esc(T("facilities"))}</h2><p class="sd-muted">${esc(T("facilities_hint"))}</p>` +
      (targets.length
        ? `<ul class="sd-list">${targets.map((x) => `<li><div><strong>${esc(x.facility_name)}</strong><div class="sd-muted">${esc(T("basis." + x.basis))}${x.locations?.length ? " · " + esc(x.locations.map((l) => l.name).join(", ")) : ""}</div></div></li>`).join("")}</ul>`
        : `<p class="sd-muted">${esc(T("no_targets"))}</p>`) +
      `<h3>${esc(T("affiliations"))}</h3><p class="sd-muted">${esc(t("creator.affiliation_hint"))}</p>` +
      (affiliations.length
        ? `<ul class="sd-list">${affiliations.map((a) => `<li><div><strong>${esc(a.facility_name)}</strong><div class="sd-muted">${esc(T("affiliation." + a.status))} · ${esc(T("requested_on", { date: date(a.requested_at) }))}</div></div>${["requested", "approved"].includes(a.status) ? `<button type="button" class="sd-ghost" data-act="withdraw" data-id="${esc(a.id)}" aria-label="${esc(T("withdraw_named", { name: a.facility_name }))}">${esc(T("withdraw"))}</button>` : ""}</li>`).join("")}</ul>`
        : `<p class="sd-muted">${esc(T("no_affiliations"))}</p>`) +
      (data.profile
        ? `<form id="affiliation-form" class="sd-inline">${field(T("facility_code"), text("org_id", "", 'required autocomplete="off" maxlength="120"'), T("facility_code_hint"))}${field(T("affiliation_note"), text("note", "", 'maxlength="500"'))}<button>${esc(T("affiliation_request"))}</button>${errorLine()}</form>`
        : "") +
      errorLine();
  };

  courses();
  profile();
  evidence();
  facilities();

  const reload = async () => {
    const next = await sedens("creator/studio");
    if (ctx.stale()) return false;
    Object.assign(data, next);
    return true;
  };

  const main = $(".sd-main");
  main.addEventListener("submit", (event) => {
    const form = event.target;
    event.preventDefault();
    if (form.id === "profile-form")
      attempt(ctx, form, async () => {
        const v = values(form);
        const created = !data.profile;
        const saved = await sedens("creator/profile", {
          display_name: v.display_name.trim(), creator_type: v.creator_type, institution: v.institution, bio: v.bio,
          qualifications: commaList(v.qualifications), specialties: commaList(v.specialties),
        });
        if (ctx.stale()) return;
        if (created) return ctx.refresh();
        data.profile = saved;
        profile();
        $("#home-profile [data-status]").textContent = T("profile_saved");
      });
    else if (form.id === "evidence-form")
      attempt(ctx, form, async () => {
        const v = values(form);
        const result = await sedens("creator/evidence", { kind: v.kind, description: v.description.trim(), url: v.url.trim(), object_id: v.object_id || null });
        if (ctx.stale()) return;
        data.evidence = result.items;
        evidence();
      });
    else if (form.id === "affiliation-form")
      attempt(ctx, form, async () => {
        const v = values(form);
        await sedens("creator/affiliations/request", { org_id: v.org_id.trim(), note: v.note });
        if (await reload()) keepFocus($("#home-facilities"), facilities);
      });
  });
  main.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-act]");
    if (!button) return;
    if (button.dataset.act === "verify")
      attempt(ctx, scopeOf(button), async () => {
        data.profile = await sedens("creator/verification/request", {});
        if (!ctx.stale()) profile();
      });
    if (button.dataset.act === "withdraw")
      attempt(ctx, scopeOf(button), async () => {
        await sedens("creator/affiliations/revoke", { id: button.dataset.id });
        if (await reload()) facilities();
      });
  });
}

// -- #/creator/courses/new ----------------------------------------------------------------

export async function courseNew(ctx) {
  if (!ctx.me) return signedOut(ctx);
  loading(ctx, T("new_course"));
  const loaded = await load(ctx, ["creator/studio"]);
  if (!loaded || ctx.stale()) return;
  const vocab = loaded[0].vocabulary;
  let type = vocab.course_types.includes(ctx.query.type) ? ctx.query.type : null;
  let draft = { language: ctx.me.organization?.default_language || lang(), level: "beginner" };

  const chooseType = () => {
    ctx.page(
      `${studioBack()}<h1>${esc(T("new_course"))}</h1><p class="sd-muted">${esc(T("wizard_step", { step: 1, total: 2 }))} · ${esc(T("wizard_type"))}</p>` +
        `<form id="type-form"><div class="sd-grid-2">${vocab.course_types
          .map((c) => `<label class="sd-card"><span class="sd-row"><input type="radio" name="course_type" value="${esc(c)}" ${c === (type || "guided_training") ? "checked" : ""}> <strong>${esc(T("type." + c))}</strong></span><span class="sd-muted">${esc(T("type_explain." + c))}</span></label>`)
          .join("")}</div><div class="sd-actions"><button class="sd-primary">${esc(T("continue"))}</button></div></form>`,
    );
    $("#type-form").onsubmit = (event) => {
      event.preventDefault();
      type = values(event.target).course_type;
      describe();
    };
  };

  const describe = () => {
    const course = {
      title: "", subtitle: "", description: "", audience: "", prerequisites: "", safety: "", outcomes: "",
      equipment: [], goals: [], body_areas: [], category: type === "professional_education" ? "education" : "mobility", ...draft,
    };
    ctx.page(
      `${studioBack()}<h1>${esc(T("new_course"))}</h1><p class="sd-muted">${esc(T("wizard_step", { step: 2, total: 2 }))} · ${esc(T("wizard_describe"))}</p>` +
        `<div class="sd-notice"><strong>${esc(T("type." + type))}</strong> — ${esc(T("type_explain." + type))} <button type="button" class="sd-ghost" id="change-type">${esc(T("change_type"))}</button></div>` +
        `<form id="meta-form" class="sd-panel">${metadataFields(course, vocab, type)}<div class="sd-actions"><button class="sd-primary">${esc(T("create_course"))}</button></div>${errorLine()}</form>`,
    );
    const form = $("#meta-form");
    $("#change-type").onclick = () => {
      draft = { ...draft, ...readMetadata(form) };
      chooseType();
    };
    form.onsubmit = (event) => {
      event.preventDefault();
      attempt(ctx, form, async () => {
        const view = await sedens("creator/courses/create", { course_type: type, ...readMetadata(form) });
        if (!ctx.stale()) ctx.go(href("creator", "courses", view.course.id));
      });
    };
  };

  if (type) describe();
  else chooseType();
}

// -- #/creator/courses/:course --------------------------------------------------------------

const TABS = ["details", "structure", "access", "submit", "versions", "files"];
const READINESS_TAB = { no_modules: "structure", no_sessions: "structure", empty_session: "structure", no_lessons: "structure", no_distribution: "access", price_not_on_sale: "access" };

export async function courseEdit(ctx) {
  if (!ctx.me) return signedOut(ctx);
  loading(ctx, T("course_editor"));
  const loaded = await load(ctx, ["creator/course?id=" + encodeURIComponent(ctx.params.course), "creator/studio"]);
  if (!loaded || ctx.stale()) return;
  let [view, studio] = loaded;
  const vocab = studio.vocabulary;
  const guided = view.course.course_type === "guided_training";
  const archived = view.review_state === "archived";
  const tabs = archived ? ["versions", "files"] : TABS;
  let tab = tabs.includes(ctx.query.tab) ? ctx.query.tab : tabs[0];
  const open = new Set();

  ctx.page(
    `${studioBack()}<p class="sd-eyebrow">${esc(T("type." + view.course.course_type))}</p><h1 id="course-title">${esc(view.course.title)}</h1><div id="course-head"></div><p class="sd-error" role="alert" id="studio-error"></p>` +
      `<div class="sd-tabs" role="tablist" aria-label="${esc(T("sections"))}">${tabs.map((name) => `<button type="button" role="tab" id="tab-${name}" aria-controls="panel-${name}" aria-selected="${name === tab}" tabindex="${name === tab ? 0 : -1}">${esc(T("tab." + name))}</button>`).join("")}</div>` +
      tabs.map((name) => `<section class="sd-panel" role="tabpanel" id="panel-${name}" aria-labelledby="tab-${name}" ${name === tab ? "" : "hidden"}></section>`).join(""),
  );
  const main = $(".sd-main");
  const panel = (name) => $("#panel-" + name);

  const showTab = (name, focus = false) => {
    tab = name;
    for (const other of tabs) {
      const button = $("#tab-" + other);
      button.setAttribute("aria-selected", String(other === name));
      button.tabIndex = other === name ? 0 : -1;
      panel(other).hidden = other !== name;
    }
    if (focus) $("#tab-" + name).focus();
    // Remember the section across a reload without a navigation (and its refetch).
    history.replaceState(null, "", href("creator", "courses", view.course.id) + "?tab=" + name);
  };

  const head = () => {
    $("#course-title").textContent = view.course.title;
    const notes = view.wording_notes || [];
    const checklist = view.readiness.length
      ? `<h2>${esc(T("readiness_title"))}</h2><ul class="sd-list">${view.readiness
          .map((code) => `<li><span>${esc(T("readiness." + code))}</span>${READINESS_TAB[code] ? `<button type="button" class="sd-ghost" data-act="goto" data-tab="${READINESS_TAB[code]}">${esc(T("go_to", { section: T("tab." + READINESS_TAB[code]) }))}</button>` : `<a class="sd-button" href="#/creator/media">${esc(T("media_library"))}</a>`}</li>`)
          .join("")}</ul>`
      : ["draft", "needs_revision"].includes(view.review_state)
        ? `<p class="sd-notice" role="status">${esc(T("readiness_ok"))}</p>`
        : view.review_state === "published" ? `<p class="sd-muted">${esc(T("submit_versions"))}</p>` : "";
    $("#course-head").innerHTML =
      `<p class="sd-row">${stateBadge(view.review_state)}<span class="sd-muted">${esc(T("language." + view.course.language))} · ${esc(money(view.price))} · ${esc(T("offered_by", { who: T("distribution." + view.course.distribution) }))}${view.published_version ? " · " + esc(T("live_version", { n: view.published_version })) : ""}</span></p>` +
      (view.suspended_reason ? ctx.notice(T("suspended_because", { reason: view.suspended_reason }), "error") : "") +
      (archived ? ctx.notice(T("archived_note")) : checklist) +
      (notes.length ? `<div class="sd-notice"><strong>${esc(T("wording_title"))}</strong><p>${esc(T("wording_body"))}</p><div class="sd-chips">${notes.map((n) => `<span class="sd-chip">${esc(n)}</span>`).join("")}</div></div>` : "");
  };

  // Details --------------------------------------------------------------
  const details = () => {
    const images = ready(studio.media || [], "image");
    const cover = view.course.cover_media_id || "";
    panel("details").innerHTML =
      `<h2>${esc(T("tab.details"))}</h2><form data-form="details">${metadataFields(view.course, vocab, view.course.course_type)}` +
      group(
        T("cover"),
        `<p class="sd-muted">${esc(T("cover_hint"))}</p><div class="sd-grid-2"><label class="sd-check"><input type="radio" name="cover_media_id" value="" ${cover ? "" : "checked"}> ${esc(T("no_cover"))}</label>${images
          .map((m) => `<label class="sd-check"><input type="radio" name="cover_media_id" value="${esc(m.id)}" ${m.id === cover ? "checked" : ""}> <img class="sd-thumb" src="${fileUrl(m.id)}" alt="" loading="lazy"> <span>${esc(m.title || m.filename)}${m.label ? `<br><span class="sd-demo-label">${esc(pick(m.label))}</span>` : ""}</span></label>`)
          .join("")}</div>${images.length ? "" : `<p><a href="#/creator/media">${esc(T("add_pictures"))}</a></p>`}`,
      ) +
      `<div class="sd-actions"><button class="sd-primary">${esc(T("save_details"))}</button></div><p class="sd-muted" role="status" data-status></p>${errorLine()}</form>`;
  };

  // Structure ------------------------------------------------------------
  const moveButtons = (kind, item, index, count, name) =>
    `<button type="button" class="sd-ghost" data-act="move" data-kind="${kind}" data-id="${esc(item.id)}" data-pos="${index - 1}" ${index === 0 ? "disabled" : ""} aria-label="${esc(T("move_up_named", { name }))}">${esc(T("move_up"))}</button>` +
    `<button type="button" class="sd-ghost" data-act="move" data-kind="${kind}" data-id="${esc(item.id)}" data-pos="${index + 1}" ${index === count - 1 ? "disabled" : ""} aria-label="${esc(T("move_down_named", { name }))}">${esc(T("move_down"))}</button>` +
    `<button type="button" class="sd-ghost" data-act="remove" data-kind="${kind}" data-id="${esc(item.id)}" data-name="${esc(name)}" aria-label="${esc(T("remove_named", { name }))}">${esc(T("remove"))}</button>`;
  const editBox = (key, summary, body) => `<details data-open="${esc(key)}" ${open.has(key) ? "open" : ""}><summary>${esc(summary)}</summary>${body}</details>`;

  const sessionItem = (module, s, i, count) =>
    `<li data-scope><div><strong>${esc(s.title)}</strong><div class="sd-muted">${esc(T("session_meta", { minutes: s.estimated_minutes || 0, steps: s.steps.length }))}</div>${editBox(
      "session:" + s.id,
      T("edit_session"),
      `<form data-form="session" data-module="${esc(module.id)}" data-id="${esc(s.id)}">${field(T("session_title"), text("title", s.title, 'required maxlength="120"'))}${field(T("session_summary"), area("summary", s.summary, 'maxlength="1000"'))}${field(T("session_minutes"), whole("estimated_minutes", s.estimated_minutes || "", 'min="0" max="240"'))}<button class="sd-primary">${esc(T("save_session"))}</button>${errorLine()}</form>`,
    )}</div><div class="sd-row"><a class="sd-button" href="${href("creator", "courses", view.course.id, "sessions", s.id)}" aria-label="${esc(T("edit_steps_named", { name: s.title }))}">${esc(T("edit_steps", { n: s.steps.length }))}</a>${moveButtons("session", s, i, count, s.title)}</div>${errorLine()}</li>`;

  const lessonForm = (module, lesson) => {
    const kind = lesson?.kind || "article";
    const ex = lesson?.exercise;
    return `<form data-form="lesson" data-module="${esc(module.id)}" ${lesson ? `data-id="${esc(lesson.id)}"` : ""}>` +
      `<div class="sd-grid-2">${field(T("lesson_kind"), select("kind", words("lesson_kind", vocab.lesson_kinds), kind))}${field(T("lesson_title"), text("title", lesson?.title, 'required maxlength="120"'))}</div>` +
      field(T("lesson_body"), area("body", lesson?.body, 'rows="6" maxlength="20000"'), T("f.plain_text")) +
      `<div data-lesson-media>${lessonMedia(kind, lesson?.media_id)}</div>` +
      group(
        T("lesson_exercise"),
        `<input type="hidden" name="exercise_source" value="${esc(ex?.source || "")}"><input type="hidden" name="exercise_ref" value="${esc(ex?.ref || "")}"><p data-exercise-name>${esc(ex ? pick(ex.title) : T("no_exercise"))}</p><div class="sd-inline"><label class="sd-field"><span>${esc(T("exercise_search"))}</span><input type="search" data-search="lesson" maxlength="80"></label><button type="button" data-act="lesson-search">${esc(T("search"))}</button><button type="button" class="sd-ghost" data-act="lesson-clear">${esc(T("exercise_clear"))}</button></div><div data-results></div>`,
      ) +
      `<div class="sd-actions"><button class="sd-primary">${esc(lesson ? T("save_lesson") : T("add_lesson"))}</button></div>${errorLine()}</form>`;
  };
  const lessonMedia = (kind, chosen) => {
    const fileKind = { video: "video", pdf: "pdf" }[kind] || "image";
    return mediaSelect("media_id", fileKind, chosen, studio.media || [], T("lesson_file." + fileKind));
  };
  const lessonItem = (module, lesson, i, count) =>
    `<li data-scope><div><span class="sd-badge info">${esc(T("lesson_kind." + lesson.kind))}</span> <strong>${esc(lesson.title)}</strong>${lesson.exercise ? `<div class="sd-muted">${esc(T("lesson_with_exercise", { name: pick(lesson.exercise.title) }))}</div>` : ""}${editBox("lesson:" + lesson.id, T("edit_lesson"), lessonForm(module, lesson))}</div><div class="sd-row">${moveButtons("lesson", lesson, i, count, lesson.title)}</div>${errorLine()}</li>`;

  const structure = () => {
    const modules = view.modules;
    panel("structure").innerHTML =
      `<h2>${esc(T("tab.structure"))}</h2><p class="sd-muted">${esc(T(guided ? "structure_guided" : "structure_education"))}</p>` +
      (modules.length
        ? `<ol class="sd-tree">${modules
            .map((m, i) => {
              const inner = guided
                ? `<h4>${esc(T("sessions"))}</h4>${m.sessions.length ? `<ul class="sd-list">${m.sessions.map((s, j) => sessionItem(m, s, j, m.sessions.length)).join("")}</ul>` : `<p class="sd-muted">${esc(T("no_sessions"))}</p>`}<form data-form="session" data-module="${esc(m.id)}" class="sd-inline">${field(T("new_session"), text("title", "", `required maxlength="120" data-focus="new-session-${esc(m.id)}"`))}${field(T("session_minutes"), whole("estimated_minutes", "", 'min="0" max="240"'))}<button>${esc(T("add_session"))}</button>${errorLine()}</form>`
                : `<h4>${esc(T("lessons"))}</h4>${m.lessons.length ? `<ul class="sd-list">${m.lessons.map((l, j) => lessonItem(m, l, j, m.lessons.length)).join("")}</ul>` : `<p class="sd-muted">${esc(T("no_lessons"))}</p>`}${editBox("new-lesson:" + m.id, T("add_lesson_in", { name: m.title }), lessonForm(m, null))}`;
              return `<li data-scope><div class="sd-spread"><h3>${esc(T("module_n", { n: i + 1, name: m.title }))}</h3><div class="sd-row">${moveButtons("module", m, i, modules.length, m.title)}</div></div>${m.summary ? `<p class="sd-muted">${esc(m.summary)}</p>` : ""}${editBox("module:" + m.id, T("edit_module"), `<form data-form="module" data-id="${esc(m.id)}">${field(T("module_title"), text("title", m.title, 'required maxlength="120"'))}${field(T("module_summary"), area("summary", m.summary, 'maxlength="1000"'))}<button class="sd-primary">${esc(T("save_module"))}</button>${errorLine()}</form>`)}${inner}${errorLine()}</li>`;
            })
            .join("")}</ol>`
        : `<p class="sd-muted">${esc(T("no_modules"))}</p>`) +
      `<form data-form="module" class="sd-inline">${field(T("new_module"), text("title", "", 'required maxlength="120" data-focus="new-module"'))}${field(T("module_summary"), text("summary", "", 'maxlength="1000"'))}<button class="sd-primary">${esc(T("add_module"))}</button>${errorLine()}</form>`;
  };

  // Who can offer it & price ----------------------------------------------
  const access = () => {
    const targets = studio.targets || [];
    const price = view.price;
    const amount = price.price_type === "paid" ? (price.currency === "KRW" ? price.amount_minor : (price.amount_minor / 100).toFixed(2)) : "";
    const termFor = (x) => view.facilities.find((f) => f.org_id === x.org_id && (!x.location_id || f.location_id === x.location_id));
    panel("access").innerHTML =
      `<h2>${esc(T("tab.access"))}</h2><form data-form="access">` +
      group(T("distribution_title"), radios("distribution", words("distribution", vocab.distributions), view.course.distribution, (d) => T("distribution_explain." + d))) +
      group(
        T("facilities_title"),
        `<p class="sd-muted">${esc(T("facilities_decide"))}</p>` +
          (targets.length
            ? `<ul class="sd-list">${targets
                .map((x, i) => {
                  const term = termFor(x);
                  const chooser = !x.location_id && x.locations.length > 1;
                  return `<li><div><strong>${esc(x.facility_name)}</strong><div class="sd-muted">${esc(T("basis." + x.basis))}${x.location_id && x.locations[0] ? " · " + esc(x.locations[0].name) : ""}</div></div><div class="sd-row"><label class="sd-check"><input type="checkbox" name="include_${i}" ${term ? "checked" : ""}> ${esc(T("include"))}</label><label class="sd-check"><input type="checkbox" name="free_${i}" ${term?.free ? "checked" : ""}> ${esc(T("free_here"))}</label>${chooser ? field(T("location"), select("location_" + i, [["", T("all_locations")], ...x.locations.map((l) => [l.id, l.name])], term?.location_id || "")) : ""}</div></li>`;
                })
                .join("")}</ul>`
            : `<p class="sd-muted">${esc(T("no_targets"))}</p>`),
      ) +
      group(
        T("price_title"),
        `<p>${esc(T("price_now", { price: money(price) }))}</p>${radios("price_type", [["free", T("price_free")], ["paid", T("price_paid")]], price.price_type)}<div class="sd-grid-4">${field(T(price.currency === "USD" ? "amount_usd" : "amount_krw"), `<input name="amount" type="number" min="0" inputmode="decimal" step="${price.currency === "USD" ? "0.01" : "1"}" value="${esc(amount)}" data-amount>`)}${field(T("currency"), select("currency", words("currency", vocab.currencies), price.currency))}${field(T("sale_state"), select("sale_state", words("sale_state", vocab.sale_states), price.sale_state))}</div><p class="sd-muted">${esc(T("price_rules"))}</p><p class="sd-muted">${esc(t("error.payments_unavailable"))}</p>`,
      ) +
      `<div class="sd-actions"><button class="sd-primary">${esc(T("save_access"))}</button></div><p class="sd-muted" role="status" data-status></p>${errorLine()}</form>`;
  };

  const readAccess = (form) => {
    const v = values(form);
    const targets = studio.targets || [];
    const facilities = targets
      .map((x, i) => (v["include_" + i] ? { org_id: x.org_id, location_id: x.location_id || v["location_" + i] || null, free: Boolean(v["free_" + i]) } : null))
      .filter(Boolean);
    if (v.distribution === "selected_facilities" && !facilities.length) throw new Error(T("need_facility"));
    const typed = Number.parseFloat(String(v.amount || "").replace(",", "."));
    const paid = v.price_type === "paid";
    if (paid && !(typed > 0)) throw new Error(T("price_above_zero"));
    // KRW has no minor unit; USD is kept in cents.
    const amount_minor = paid ? Math.round(v.currency === "USD" ? typed * 100 : typed) : 0;
    return { distribution: v.distribution, facilities, price: { price_type: paid ? "paid" : "free", amount_minor, currency: v.currency, sale_state: v.sale_state } };
  };

  // Submit -----------------------------------------------------------------
  const submit = () => {
    const waiting = view.versions.find((v) => v.state === "submitted");
    const blocked = view.readiness.length > 0;
    panel("submit").innerHTML =
      `<h2>${esc(T("tab.submit"))}</h2><p>${esc(T("submit_explain"))}</p><p class="sd-muted">${esc(T("submit_versions"))}</p>` +
      (waiting ? ctx.notice(T("submit_waiting", { n: waiting.version })) : "") +
      (blocked ? `<p class="sd-notice">${esc(T("submit_blocked"))}</p>` : "") +
      `<form data-form="submit">${field(T("submit_note"), area("note", "", 'maxlength="1000"'), T("submit_note_hint"))}<div class="sd-actions"><button class="sd-primary" ${blocked ? "disabled" : ""}>${esc(T("submit_button"))}</button></div><p class="sd-muted" role="status" data-status></p>${errorLine()}</form>`;
  };

  // Versions & reviewer comments ---------------------------------------------
  const versions = () => {
    const needsWork = (r) => Object.entries(r.checklist || {}).filter(([, item]) => item?.result === "needs_work");
    panel("versions").innerHTML =
      `<h2>${esc(T("tab.versions"))}</h2>` +
      (view.versions.length
        ? `<ul class="sd-list">${view.versions
            .map((v) => `<li><div><strong>${esc(T("version_n", { n: v.version }))}</strong> <span class="sd-muted">${esc(T("version_state." + v.state))}</span><div class="sd-muted">${esc(T("submitted_on", { date: date(v.submitted_at) }))}${v.decided_at ? " · " + esc(T("decided_on", { date: date(v.decided_at) })) : ""}</div>${v.note ? `<div>${esc(T("your_note", { note: v.note }))}</div>` : ""}</div><button type="button" class="sd-ghost" data-act="view-version" data-id="v${v.version}" data-version="${v.version}" aria-label="${esc(T("view_version_named", { n: v.version }))}">${esc(T("view_version"))}</button></li>`)
            .join("")}</ul>`
        : `<p class="sd-muted">${esc(T("no_versions"))}</p>`) +
      `<h3>${esc(T("reviews"))}</h3>` +
      (view.reviews.length
        ? view.reviews
            .map((r) => {
              const items = needsWork(r);
              return `<article class="sd-step"><p><strong>${esc(T("version_n", { n: r.version }))}</strong> · ${esc(T("decision." + r.decision))} · <span class="sd-muted">${esc(date(r.created_at))}</span></p>${r.comment ? `<p>${esc(r.comment)}</p>` : ""}${items.length ? `<p class="sd-muted">${esc(T("needs_work"))}</p><ul>${items.map(([code, item]) => `<li><strong>${esc(T("check." + code))}</strong>${item.note ? ": " + esc(item.note) : ""}</li>`).join("")}</ul>` : ""}</article>`;
            })
            .join("")
        : `<p class="sd-muted">${esc(T("no_reviews"))}</p>`) +
      `<div id="version-view" data-scope>${errorLine()}</div>`;
  };

  const outline = (found) => {
    const snap = found.snapshot || {};
    const modules = snap.modules || [];
    return `<section class="sd-panel"><div class="sd-spread"><h3 tabindex="-1" id="version-heading">${esc(T("version_view_title", { n: found.version, state: T("version_state." + found.state) }))}</h3><button type="button" class="sd-ghost" data-act="close-version">${esc(T("close"))}</button></div><p class="sd-muted">${esc(T("version_frozen"))}</p><p><strong>${esc(snap.course?.title || "")}</strong>${snap.course?.subtitle ? " — " + esc(snap.course.subtitle) : ""}</p><p class="sd-muted">${esc(money(snap.price))} · ${esc(T("offered_by", { who: T("distribution." + (snap.distribution || "creator_only")) }))}</p><ol class="sd-tree">${modules
      .map((m) => `<li><strong>${esc(m.title)}</strong>${m.sessions ? `<ol>${m.sessions.map((s) => `<li>${esc(s.title)} <span class="sd-muted">${esc(T("session_meta", { minutes: s.estimated_minutes || 0, steps: s.steps.length }))}</span><ol>${s.steps.map((step) => `<li>${esc(step.title || pick(step.exercise?.title))} <span class="sd-muted">${esc(dose(step))}</span></li>`).join("")}</ol></li>`).join("")}</ol>` : ""}${m.lessons ? `<ol>${m.lessons.map((l) => `<li>${esc(l.title)} <span class="sd-muted">${esc(T("lesson_kind." + l.kind))}</span></li>`).join("")}</ol>` : ""}</li>`)
      .join("")}</ol><details class="sd-advanced"><summary>${esc(T("advanced"))}</summary><p class="sd-muted">${esc(T("fingerprint", { value: found.snapshot_sha256 || "" }))}</p></details></section>`;
  };

  // Export, import, archive --------------------------------------------------
  const files = () => {
    panel("files").innerHTML =
      `<h2>${esc(T("tab.files"))}</h2><h3>${esc(T("export_title"))}</h3><p class="sd-muted">${esc(T("export_body"))}</p><p><a class="sd-button" href="/sedens/creator/course/export?id=${encodeURIComponent(view.course.id)}" download>${esc(T("export_button"))}</a></p>` +
      `<h3>${esc(T("import_title"))}</h3><p class="sd-muted">${esc(T("import_body"))}</p><form data-form="import">${field(T("import_file"), '<input type="file" name="archive" accept=".zip,application/zip">')}<label class="sd-check"><input type="checkbox" name="attest" data-attest> ${esc(pick(vocab.attestation))}</label><progress max="1" value="0" hidden aria-label="${esc(T("uploading"))}"></progress><div class="sd-actions"><button class="sd-primary" disabled data-needs-attest>${esc(T("import_button"))}</button></div>${errorLine()}</form>` +
      (archived ? "" : `<h3>${esc(T("archive_title"))}</h3><p class="sd-muted">${esc(T("archive_body"))}</p><div data-scope><button type="button" class="sd-ghost" data-act="archive">${esc(T("archive_button"))}</button>${errorLine()}</div>`);
  };

  const RENDER = { details, structure, access, submit, versions, files };
  const rerender = (...names) => {
    head();
    for (const name of new Set([...names, "submit", "versions"])) if (tabs.includes(name)) keepFocus(panel(name), RENDER[name]);
  };
  head();
  for (const name of tabs) RENDER[name]();

  const edit = async (route, body, key = "course_id") => {
    const next = await sedens("creator/course/" + route, { [key]: view.course.id, revision: view.revision, ...body });
    if (ctx.stale()) return null;
    view = next;
    return next;
  };
  const say = (form, message) => {
    const status = form.querySelector("[data-status]");
    if (status) status.textContent = message;
  };

  main.addEventListener("toggle", (event) => {
    const box = event.target;
    if (box.dataset?.open) box.open ? open.add(box.dataset.open) : open.delete(box.dataset.open);
  }, true);

  main.addEventListener("keydown", (event) => {
    const tabButton = event.target.closest?.('[role="tab"]');
    if (tabButton && ["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const index = tabs.indexOf(tab);
      const next = { ArrowRight: (index + 1) % tabs.length, ArrowLeft: (index - 1 + tabs.length) % tabs.length, Home: 0, End: tabs.length - 1 }[event.key];
      showTab(tabs[next], true);
    }
    if (event.key === "Enter" && event.target.dataset?.search === "lesson") {
      event.preventDefault();
      event.target.closest("form").querySelector('[data-act="lesson-search"]').click();
    }
  });

  main.addEventListener("change", (event) => {
    const el = event.target;
    const form = el.closest("form");
    if (el.dataset.attest !== undefined) form.querySelector("[data-needs-attest]").disabled = !el.checked;
    if (form?.dataset.form === "lesson" && el.name === "kind") form.querySelector("[data-lesson-media]").innerHTML = lessonMedia(el.value, "");
    if (el.dataset.mediaKind) form.querySelector(`[data-media-info="${el.name}"]`).innerHTML = mediaInfo((studio.media || []).find((m) => m.id === el.value));
    if (form?.dataset.form === "access" && el.name === "currency") {
      const amount = form.querySelector("[data-amount]");
      amount.step = el.value === "USD" ? "0.01" : "1";
      amount.previousElementSibling.textContent = T(el.value === "USD" ? "amount_usd" : "amount_krw");
    }
    // A course that just became paid is meant to be sold: offer "On sale" rather than leave
    // the free course's "Not for sale", which would stop the submission.
    if (form?.dataset.form === "access" && el.name === "price_type" && el.value === "paid" && form.elements.sale_state.value === "not_for_sale")
      form.elements.sale_state.value = "active";
  });

  main.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.target;
    const kind = form.dataset.form;
    const v = () => values(form);
    if (kind === "details")
      attempt(ctx, form, async () => {
        if (await edit("update", { ...readMetadata(form), cover_media_id: v().cover_media_id || null }, "id")) {
          rerender("details");
          say(panel("details").querySelector("form"), T("saved"));
        }
      });
    if (kind === "module")
      attempt(ctx, form, async () => {
        const data = v();
        if (await edit("module", { id: form.dataset.id || undefined, title: data.title.trim(), summary: data.summary })) rerender("structure");
      });
    if (kind === "session")
      attempt(ctx, form, async () => {
        const data = v();
        const body = { module_id: form.dataset.module, id: form.dataset.id || undefined, title: data.title.trim(), estimated_minutes: data.estimated_minutes ?? 0 };
        if (form.dataset.id) body.summary = data.summary;
        if (await edit("session", body)) rerender("structure");
      });
    if (kind === "lesson")
      attempt(ctx, form, async () => {
        const data = v();
        const module = view.modules.find((m) => m.id === form.dataset.module);
        const existing = module?.lessons.find((l) => l.id === form.dataset.id);
        const before = new Set(module?.lessons.map((l) => l.id));
        const next = await edit("lesson", {
          module_id: form.dataset.module, id: form.dataset.id || undefined, kind: data.kind, title: data.title.trim(), body: data.body,
          media_id: data.media_id || null, exercise_source: data.exercise_source || undefined, exercise_ref: data.exercise_ref || "",
          detail: existing?.detail || {},
        });
        if (!next) return;
        if (!form.dataset.id) {
          open.delete("new-lesson:" + form.dataset.module);
          const added = next.modules.find((m) => m.id === form.dataset.module)?.lessons.find((l) => !before.has(l.id));
          if (added) open.add("lesson:" + added.id);
        }
        rerender("structure");
      });
    if (kind === "access")
      attempt(ctx, form, async () => {
        if (await edit("access", readAccess(form), "id")) {
          rerender("access");
          say(panel("access").querySelector("form"), T("saved"));
        }
      });
    if (kind === "submit")
      attempt(ctx, form, async () => {
        if (await edit("submit", { note: v().note }, "id")) {
          rerender();
          say(panel("submit").querySelector("form"), T("submitted"));
        }
      });
    if (kind === "import")
      attempt(ctx, form, async () => {
        const file = form.elements.archive.files[0];
        if (!file) throw new Error(T("import_choose"));
        const progress = form.querySelector("progress");
        progress.hidden = false;
        try {
          const next = await upload("creator/course/import", file, { attest: "1", attestation_version: vocab.attestation_version }, (p) => (progress.value = p));
          if (!ctx.stale()) ctx.go(href("creator", "courses", next.course.id));
        } finally {
          progress.hidden = true;
        }
      });
  });

  main.addEventListener("click", (event) => {
    const tabButton = event.target.closest('[role="tab"]');
    if (tabButton) return showTab(tabButton.id.slice(4));
    const button = event.target.closest("button[data-act]");
    if (!button) return;
    const act = button.dataset.act;
    const scope = scopeOf(button);
    if (act === "goto") showTab(button.dataset.tab, true);
    if (act === "move")
      attempt(ctx, scope, async () => {
        if (await edit("move", { kind: button.dataset.kind, id: button.dataset.id, position: Number(button.dataset.pos) })) rerender("structure");
      });
    if (act === "remove") {
      if (!confirm(T("remove_confirm." + button.dataset.kind, { name: button.dataset.name }))) return;
      attempt(ctx, scope, async () => {
        if (await edit("remove", { kind: button.dataset.kind, id: button.dataset.id })) rerender("structure");
      });
    }
    if (act === "lesson-search")
      attempt(ctx, scope, async () => {
        const query = scope.querySelector('[data-search="lesson"]').value;
        const found = await searchExercises(query);
        if (ctx.stale()) return;
        scope.querySelector("[data-results]").innerHTML = exerciseList(found.items.slice(0, 12), found.label, "lesson-pick");
      });
    if (act === "lesson-pick" || act === "lesson-clear") {
      const picked = act === "lesson-pick";
      scope.elements.exercise_source.value = picked ? button.dataset.source : "";
      scope.elements.exercise_ref.value = picked ? button.dataset.ref : "";
      scope.querySelector("[data-exercise-name]").textContent = picked ? T("exercise_chosen", { name: button.dataset.title }) : T("no_exercise");
      scope.querySelector("[data-results]").innerHTML = "";
      scope.querySelector('[data-search="lesson"]').focus();
    }
    if (act === "view-version")
      attempt(ctx, scope, async () => {
        const found = await sedens("creator/course/version?" + new URLSearchParams({ id: view.course.id, version: button.dataset.version }));
        if (ctx.stale()) return;
        $("#version-view").innerHTML = outline(found) + errorLine();
        $("#version-heading").focus();
      });
    if (act === "close-version") {
      $("#version-view").innerHTML = errorLine();
      panel("versions").querySelector('[data-act="view-version"]')?.focus();
    }
    if (act === "archive") {
      if (!confirm(T("archive_confirm", { name: view.course.title }))) return;
      attempt(ctx, scope, async () => {
        await sedens("creator/course/archive", { id: view.course.id, revision: view.revision });
        if (!ctx.stale()) ctx.go("#/creator");
      });
    }
  });
}

function dose(step) {
  const parts = [];
  if (step.sets > 1) parts.push(T("dose.sets", { n: step.sets }));
  if (step.reps) parts.push(T("dose.reps", { n: step.reps }));
  if (step.hold_seconds) parts.push(T("dose.hold", { n: step.hold_seconds }));
  if (step.work_seconds) parts.push(T("dose.work", { n: step.work_seconds }));
  if (step.rest_seconds) parts.push(T("dose.rest", { n: step.rest_seconds }));
  if (step.sides && step.sides !== "none") parts.push(T("sides." + step.sides));
  return parts.join(" · ");
}

const stepName = (step) => step.title || pick(step.exercise?.title) || T("untitled_step");

// -- #/creator/courses/:course/sessions/:session -----------------------------------------------

export async function sessionEdit(ctx) {
  if (!ctx.me) return signedOut(ctx);
  loading(ctx, T("session_editor"));
  const loaded = await load(ctx, ["creator/course?id=" + encodeURIComponent(ctx.params.course), "creator/studio"]);
  if (!loaded || ctx.stale()) return;
  let [view, studio] = loaded;
  const vocab = studio.vocabulary;
  const media = studio.media || [];
  const back = href("creator", "courses", view.course.id) + "?tab=structure";
  const findSession = () => {
    for (const m of view.modules) for (const s of m.sessions || []) if (s.id === ctx.params.session) return { module: m, session: s };
    return null;
  };
  let found = findSession();
  if (!found) {
    ctx.page(`<a class="sd-back" href="${back}">← ${esc(T("back_course"))}</a><h1>${esc(T("session_editor"))}</h1>${ctx.notice(T("session_missing"), "error")}`);
    return;
  }
  // Unsaved anatomy edits per step, kept while other steps are saved or moved.
  const anatomy = new Map();
  const local = (step) => {
    if (!anatomy.has(step.id))
      anatomy.set(step.id, { structures: step.anatomy.map((a) => ({ ...a })), timeline: step.timeline.map((m) => ({ ...m, structures: [...m.structures] })), results: [] });
    return anatomy.get(step.id);
  };
  const open = new Set();
  const archived = view.review_state === "archived";

  ctx.page(
    `<a class="sd-back" href="${back}">← ${esc(T("back_course"))}</a><p class="sd-eyebrow">${esc(view.course.title)}</p><h1 id="session-title">${esc(found.session.title)}</h1><p class="sd-muted" id="session-meta"></p>` +
      `<p class="sd-notice">${esc(T("room_only"))}</p><p class="sd-demo-label">${esc(pick(vocab.anatomy_label))}</p>${archived ? ctx.notice(T("archived_note")) : ""}<p class="sd-error" role="alert" id="studio-error"></p>` +
      `<div id="steps"></div>` +
      `<section class="sd-panel" id="add-step" data-scope><h2>${esc(T("add_step"))}</h2><p class="sd-muted">${esc(T("add_step_hint"))}</p><div class="sd-inline"><label class="sd-field"><span>${esc(T("exercise_search"))}</span><input type="search" data-search="add" maxlength="80" data-focus="add-search"></label><button type="button" data-act="add-search">${esc(T("search"))}</button></div><div data-results></div>${errorLine()}</section>` +
      `<section class="sd-panel" id="preview-panel" data-scope hidden><div class="sd-spread"><h2 tabindex="-1" id="preview-heading">${esc(T("preview_title"))}</h2><button type="button" class="sd-ghost" data-act="preview-back">${esc(T("preview_back"))}</button></div><p class="sd-demo-label">${esc(pick(vocab.anatomy_label))}</p><p role="status" id="preview-status"></p><div id="preview-picked"></div><div id="preview-slot"></div>${errorLine()}</section>`,
  );
  const main = $(".sd-main");
  const steps = () => found.session.steps;
  const stepById = (id) => steps().find((s) => s.id === id);

  const meta = () => {
    $("#session-title").textContent = found.session.title;
    $("#session-meta").textContent = T("session_page_meta", { module: found.module.title, steps: steps().length, minutes: found.session.estimated_minutes || 0 });
  };

  const stepForm = (step) => {
    const others = steps().filter((s) => s.id !== step.id && !s.variant_of);
    const ex = step.exercise;
    return `<form data-form="step" data-id="${esc(step.id)}">` +
      `<fieldset><legend>${esc(T("fs.exercise"))}</legend><input type="hidden" name="exercise_source" value="${esc(ex?.source || "")}"><input type="hidden" name="exercise_ref" value="${esc(ex?.ref || "")}"><p data-exercise-name><strong>${esc(pick(ex?.title) || T("no_exercise"))}</strong> <span class="sd-muted">${esc(ex ? (ex.source === "standard" ? `${T("source_standard")} · ${pick(vocab.standard_label)}` : T("source_catalog")) : "")}</span></p>${field(T("step_title"), text("title", step.title, 'maxlength="120"'), T("step_title_hint"))}<div class="sd-inline"><label class="sd-field"><span>${esc(T("exercise_change"))}</span><input type="search" data-search="step" maxlength="80"></label><button type="button" data-act="step-search">${esc(T("search"))}</button></div><div data-results></div></fieldset>` +
      `<fieldset><legend>${esc(T("fs.phase"))}</legend>${radios("phase", words("phase", vocab.phases), step.phase)}</fieldset>` +
      `<fieldset><legend>${esc(T("fs.dose"))}</legend><div class="sd-grid-4">${field(T("sets"), whole("sets", step.sets, 'min="1" max="20"'))}${field(T("reps"), whole("reps", step.reps, 'min="0" max="100"'))}${field(T("hold_seconds"), whole("hold_seconds", step.hold_seconds, 'min="0" max="600"'))}${field(T("work_seconds"), whole("work_seconds", step.work_seconds, 'min="0" max="3600"'))}${field(T("rest_seconds"), whole("rest_seconds", step.rest_seconds, 'min="0" max="600"'))}${field(T("sides_label"), select("sides", words("sides", vocab.sides), step.sides))}</div><p class="sd-muted">${esc(T("dose_hint"))}</p></fieldset>` +
      `<fieldset><legend>${esc(T("fs.options"))}</legend><div class="sd-grid-2">${field(T("regression"), area("regression", step.regression, 'maxlength="600"'))}${field(T("progression"), area("progression", step.progression, 'maxlength="600"'))}</div></fieldset>` +
      `<fieldset><legend>${esc(T("fs.variant"))}</legend><div class="sd-grid-2">${field(T("variant"), select("variant", words("variant", ["standard", "easier", "harder"]), step.variant))}${field(T("variant_of"), select("variant_of", [["", T("variant_none")], ...others.map((s) => [s.id, T("step_n", { n: s.position + 1, name: stepName(s) })])], step.variant_of || ""))}</div><p class="sd-muted">${esc(T("variant_hint"))}</p></fieldset>` +
      `<fieldset><legend>${esc(T("fs.words"))}</legend>${field(T("customer_cue"), text("customer_cue", step.customer_cue, 'maxlength="280"'), T("customer_cue_hint"))}${field(T("narration"), area("narration", step.narration, 'rows="4" maxlength="2000"'), T("narration_hint"))}</fieldset>` +
      `<fieldset><legend>${esc(T("fs.media"))}</legend><div class="sd-grid-2"><div>${mediaSelect("video_media_id", "video", step.video_media_id, media, T("demo_video"))}</div><div>${mediaSelect("image_media_id", "image", step.image_media_id, media, T("demo_picture"))}</div></div><p><a href="#/creator/media">${esc(T("media_library"))}</a></p></fieldset>` +
      `<fieldset><legend>${esc(T("fs.equipment"))}</legend><div class="sd-grid-4">${vocab.equipment.map((e) => `<label class="sd-check"><input type="checkbox" name="equipment" value="${esc(e)}" data-list ${step.equipment.includes(e) ? "checked" : ""}> ${esc(T("equipment." + e))}</label>`).join("")}</div></fieldset>` +
      `<fieldset><legend>${esc(T("fs.flow"))}</legend><div class="sd-grid-2">${field(T("advance"), select("advance", words("advance", ["manual", "auto"]), step.advance))}${field(T("atlas_depth"), select("atlas_depth", words("depth", ["taught", "complete"]), step.atlas_depth))}</div></fieldset>` +
      `<div class="sd-actions"><button class="sd-primary">${esc(T("save_step"))}</button></div><p class="sd-muted" role="status" data-status></p>${errorLine()}</form>`;
  };

  const anatomyPanel = (step) => {
    const state = local(step);
    const key = (name) => esc(name + ":" + step.id);
    const roleSelect = (s, i) => `<select data-role="${i}" data-focus="${key("role-" + i)}" aria-label="${esc(T("role_of", { name: s.key }))}">${options(words("role", vocab.roles), s.role)}</select>`;
    const moment = (m, j) =>
      `<fieldset data-moment="${j}"><legend>${esc(T("moment_n", { n: j + 1 }))}</legend><div class="sd-grid-4">${field(T("moment_start"), `<input type="number" min="0" step="0.1" inputmode="decimal" data-m="start" value="${esc(m.start_ms / 1000)}">`)}${field(T("moment_end"), `<input type="number" min="0" step="0.1" inputmode="decimal" data-m="end" value="${esc(m.end_ms / 1000)}">`)}${field(T("moment_mode"), `<select data-m="mode">${options(words("mode", ["highlight", "isolate"]), m.mode)}</select>`)}</div>` +
      (state.structures.length
        ? `<div class="sd-grid-2">${state.structures.map((s) => `<label class="sd-check"><input type="checkbox" data-m="structure" value="${esc(s.key)}" ${m.structures.includes(s.key) ? "checked" : ""}> ${esc(s.key)}</label>`).join("")}</div>`
        : `<p class="sd-muted">${esc(T("moment_needs_structures"))}</p>`) +
      `${field(T("moment_cue"), `<input data-m="cue" maxlength="280" value="${esc(m.cue)}">`)}<button type="button" class="sd-ghost" data-act="moment-remove" data-index="${j}" aria-label="${esc(T("moment_remove_named", { n: j + 1 }))}">${esc(T("moment_remove"))}</button></fieldset>`;
    return `<p class="sd-demo-label">${esc(pick(vocab.anatomy_label))}</p><h4>${esc(T("structures"))}</h4>` +
      (state.structures.length
        ? `<div class="sd-chips">${state.structures.map((s, i) => `<span class="sd-chip">${esc(s.key)} ${roleSelect(s, i)}<button type="button" data-act="structure-remove" data-index="${i}" aria-label="${esc(T("remove_named", { name: s.key }))}">×</button></span>`).join("")}</div>`
        : `<p class="sd-muted">${esc(T("no_structures"))}</p>`) +
      `<div class="sd-inline"><label class="sd-field"><span>${esc(T("structure_search"))}</span><input type="search" data-search="anatomy" maxlength="80" data-focus="${key("anatomy-q")}"></label><label class="sd-field"><span>${esc(T("atlas_depth"))}</span><select data-depth>${options(words("depth", ["taught", "complete"]), step.atlas_depth)}</select></label><button type="button" data-act="anatomy-search" data-focus="${key("anatomy-search")}">${esc(T("search"))}</button></div>` +
      (state.results.length ? `<ul class="sd-list">${state.results.map((r) => `<li><span>${esc(r.key)}${LAYER_WORDS.includes(r.layer) ? ` <span class="sd-muted">${esc(T("layer." + r.layer))}</span>` : ""}</span>${state.structures.some((s) => s.key === r.key) ? `<span class="sd-muted">${esc(T("already_added"))}</span>` : `<button type="button" data-act="structure-add" data-key="${esc(r.key)}" aria-label="${esc(T("add_named", { name: r.key }))}">${esc(T("add"))}</button>`}</li>`).join("")}</ul>` : "") +
      `<h4>${esc(T("timeline"))}</h4><p class="sd-muted">${esc(T("timeline_hint"))}</p>${state.timeline.map(moment).join("")}<p><button type="button" data-act="moment-add" data-focus="${key("moment-add")}">${esc(T("moment_add"))}</button></p>` +
      `<div class="sd-actions"><button type="button" class="sd-primary" data-act="anatomy-save" data-focus="${key("anatomy-save")}">${esc(T("anatomy_save"))}</button><button type="button" data-act="preview">${esc(T("preview"))}</button><button type="button" data-act="play" ${step.exercise?.anatomy_exercise ? "" : "disabled"}>${esc(T("play_motion"))}</button></div><p class="sd-muted" role="status" data-status></p>${errorLine()}`;
  };

  const stepCard = (step, i, count) => {
    const name = stepName(step);
    const variant = step.variant !== "standard" && step.variant_of ? stepById(step.variant_of) : null;
    return `<article class="sd-step" id="step-${esc(step.id)}" data-step="${esc(step.id)}" data-scope><div class="sd-spread"><h2 tabindex="-1">${esc(T("step_n", { n: i + 1, name }))}</h2><div class="sd-row">` +
      `<button type="button" class="sd-ghost" data-act="move" data-id="${esc(step.id)}" data-pos="${i - 1}" ${i === 0 ? "disabled" : ""} aria-label="${esc(T("move_up_named", { name }))}">${esc(T("move_up"))}</button><button type="button" class="sd-ghost" data-act="move" data-id="${esc(step.id)}" data-pos="${i + 1}" ${i === count - 1 ? "disabled" : ""} aria-label="${esc(T("move_down_named", { name }))}">${esc(T("move_down"))}</button><button type="button" class="sd-ghost" data-act="remove" data-id="${esc(step.id)}" data-name="${esc(name)}" aria-label="${esc(T("remove_named", { name }))}">${esc(T("remove"))}</button></div></div>` +
      `<p class="sd-muted">${esc(T("phase." + step.phase))} · ${esc(dose(step))}${variant ? " · " + esc(T("variant_line", { kind: T("variant." + step.variant), name: stepName(variant) })) : ""}</p>${step.customer_cue ? `<p>“${esc(step.customer_cue)}”</p>` : ""}` +
      `<details data-open="edit:${esc(step.id)}" ${open.has("edit:" + step.id) ? "open" : ""}><summary>${esc(T("edit_step"))}</summary>${stepForm(step)}</details>` +
      `<details data-open="anatomy:${esc(step.id)}" ${open.has("anatomy:" + step.id) ? "open" : ""}><summary>${esc(T("anatomy_summary", { n: local(step).structures.length }))}</summary><section data-anatomy="${esc(step.id)}" data-scope>${anatomyPanel(step)}</section></details>${errorLine()}</article>`;
  };

  const list = () => {
    const all = steps();
    $("#steps").innerHTML = all.length ? all.map((s, i) => stepCard(s, i, all.length)).join("") : `<p class="sd-notice">${esc(T("no_steps"))}</p>`;
    meta();
  };
  const card = (id) => {
    const all = steps();
    const index = all.findIndex((s) => s.id === id);
    const el = $("#step-" + CSS.escape(id));
    if (index < 0 || !el) return list();
    keepFocus($("#steps"), () => (el.outerHTML = stepCard(all[index], index, all.length)));
  };
  const anatomyOf = (id) => {
    const section = main.querySelector(`[data-anatomy="${CSS.escape(id)}"]`);
    if (section) keepFocus(section, () => (section.innerHTML = anatomyPanel(stepById(id))), '[data-search="anatomy"]');
    const summary = section?.closest("details")?.querySelector("summary");
    if (summary) summary.textContent = T("anatomy_summary", { n: anatomy.get(id).structures.length });
  };
  list();

  const apply = (next) => {
    view = next;
    found = findSession() || found;
  };
  const edit = async (route, body) => {
    const next = await sedens("creator/course/" + route, { course_id: view.course.id, revision: view.revision, ...body });
    if (ctx.stale()) return null;
    apply(next);
    return next;
  };

  // Read the timeline rows typed so far into the step's local state.
  const syncMoments = (id) => {
    const section = main.querySelector(`[data-anatomy="${CSS.escape(id)}"]`);
    const state = anatomy.get(id);
    if (!section || !state) return;
    section.querySelectorAll("[data-moment]").forEach((row) => {
      const m = state.timeline[Number(row.dataset.moment)];
      if (!m) return;
      const seconds = (name) => Number.parseFloat(row.querySelector(`[data-m="${name}"]`).value);
      m.start_ms = Math.round((seconds("start") || 0) * 1000);
      m.end_ms = Math.round((seconds("end") || 0) * 1000);
      m.mode = row.querySelector('[data-m="mode"]').value;
      m.cue = row.querySelector('[data-m="cue"]').value;
      m.structures = [...row.querySelectorAll('[data-m="structure"]:checked')].map((c) => c.value);
    });
  };

  const checkMoments = (timeline) => {
    const sorted = [...timeline].map((m, j) => ({ ...m, n: j + 1 })).sort((a, b) => a.start_ms - b.start_ms);
    let lastEnd = 0;
    for (const m of sorted) {
      if (!(m.end_ms > m.start_ms)) throw new Error(T("moment_order", { n: m.n }));
      if (m.start_ms < lastEnd) throw new Error(T("moment_overlap", { n: m.n }));
      if (!m.structures.length) throw new Error(T("moment_structures", { n: m.n }));
      lastEnd = m.end_ms;
    }
  };

  // The anatomy preview: one viewer per page, created on first use.
  let frame = null;
  let previewing = null;
  let message = null;
  const post = () => frame?.contentWindow?.postMessage(message, location.origin);
  const preview = async (step, withMotion) => {
    syncMoments(step.id);
    const keys = local(step).structures.map((s) => s.key);
    const answer = await sedens("creator/anatomy/preview?" + new URLSearchParams({ keys: JSON.stringify(keys) }));
    if (ctx.stale()) return;
    previewing = step.id;
    message = {
      type: "motion-context",
      client: { id: "sedens-preview", name: view.course.title },
      region: { id: "sedens-preview", name: stepName(step), explanation: "", structures: answer.ids.map((id) => ({ id })) },
      regions: [],
      layer: "region",
      exercise: withMotion ? step.exercise?.anatomy_exercise || null : null,
    };
    const box = $("#preview-panel");
    box.hidden = false;
    $("#preview-picked").innerHTML = "";
    $("#preview-status").textContent = T(withMotion ? "preview_motion_for" : "preview_for", { name: stepName(step) }) + (answer.missing?.length ? " " + T("preview_missing", { n: answer.missing.length }) : "");
    if (!frame) {
      frame = document.createElement("iframe");
      frame.className = "sd-preview-frame";
      frame.title = T("preview_frame");
      frame.addEventListener("load", post);
      frame.src = "/anatomy.html?platform=1&embed=1";
      $("#preview-slot").append(frame);
    } else post();
    box.scrollIntoView({ block: "start" });
    $("#preview-heading").focus({ preventScroll: true });
  };
  const onMessage = async (event) => {
    if (ctx.stale()) return window.removeEventListener("message", onMessage);
    if (!frame || event.source !== frame.contentWindow || event.origin !== location.origin) return;
    const type = event.data?.type;
    if (type === "motion-atlas-error") $("#preview-status").textContent = T("preview_error");
    if (type === "motion-atlas-selection") {
      const id = Number(event.data.structure_id);
      if (!Number.isInteger(id)) return;
      try {
        const answer = await sedens("creator/anatomy/preview?" + new URLSearchParams({ keys: "[]", id: String(id) }));
        if (ctx.stale()) return;
        const step = stepById(previewing);
        const key = answer.picked;
        const has = step && local(step).structures.some((s) => s.key === key);
        $("#preview-picked").innerHTML = !key
          ? `<p class="sd-muted">${esc(T("picked_unknown"))}</p>`
          : `<p>${esc(T("picked", { name: key }))}</p>${has ? `<p class="sd-muted">${esc(T("already_added"))}</p>` : step ? `<button type="button" data-act="picked-add" data-key="${esc(key)}">${esc(T("add_named", { name: key }))}</button>` : ""}`;
      } catch (error) {
        if (!ctx.stale()) $("#preview-status").textContent = fail(error);
      }
    }
  };
  window.addEventListener("message", onMessage);

  const addStructure = (stepId, key) => {
    const state = anatomy.get(stepId);
    if (!state || state.structures.some((s) => s.key === key)) return;
    syncMoments(stepId);
    state.structures.push({ key, role: "assisting" });
    anatomyOf(stepId);
  };

  main.addEventListener("toggle", (event) => {
    const box = event.target;
    if (box.dataset?.open) box.open ? open.add(box.dataset.open) : open.delete(box.dataset.open);
  }, true);

  main.addEventListener("keydown", (event) => {
    const kind = event.target.dataset?.search;
    if (event.key !== "Enter" || !kind) return;
    event.preventDefault();
    const scope = scopeOf(event.target);
    scope.querySelector({ add: '[data-act="add-search"]', step: '[data-act="step-search"]', anatomy: '[data-act="anatomy-search"]' }[kind])?.click();
  });

  main.addEventListener("change", (event) => {
    const el = event.target;
    if (el.dataset.mediaKind) el.closest("form").querySelector(`[data-media-info="${el.name}"]`).innerHTML = mediaInfo(media.find((m) => m.id === el.value));
    if (el.dataset.role !== undefined) {
      const id = el.closest("[data-anatomy]").dataset.anatomy;
      anatomy.get(id).structures[Number(el.dataset.role)].role = el.value;
    }
  });

  main.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.target;
    if (form.dataset.form !== "step") return;
    attempt(ctx, form, async () => {
      const v = values(form);
      if (!v.reps && !v.hold_seconds && !v.work_seconds) throw new Error(T("dose_needed"));
      if (v.variant !== "standard" && !v.variant_of) throw new Error(T("variant_needs_step"));
      if (v.variant === "standard") v.variant_of = "";
      const id = form.dataset.id;
      if (!(await edit("step", { session_id: found.session.id, id, ...v, video_media_id: v.video_media_id || null, image_media_id: v.image_media_id || null, variant_of: v.variant_of || null }))) return;
      card(id);
      const status = $("#step-" + CSS.escape(id))?.querySelector("form [data-status]");
      if (status) status.textContent = T("saved");
    });
  });

  main.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-act]");
    if (!button) return;
    const act = button.dataset.act;
    const scope = scopeOf(button);
    const stepEl = button.closest("[data-step]");
    const step = stepEl ? stepById(stepEl.dataset.step) : null;
    const anatomyScope = button.closest("[data-anatomy]");

    if (act === "add-search" || act === "step-search")
      attempt(ctx, scope, async () => {
        const box = act === "add-search" ? $("#add-step") : scope;
        const found = await searchExercises(box.querySelector("[data-search]").value);
        if (ctx.stale()) return;
        box.querySelector("[data-results]").innerHTML = exerciseList(found.items.slice(0, 12), found.label, act === "add-search" ? "add-step" : "step-pick");
      });
    if (act === "add-step")
      attempt(ctx, scope, async () => {
        const next = await edit("step", {
          session_id: found.session.id, exercise_source: button.dataset.source, exercise_ref: button.dataset.ref, phase: "main",
          sets: 1, reps: 8, hold_seconds: 0, work_seconds: 0, rest_seconds: 15, sides: "none", equipment: [], advance: "manual",
          variant: "standard", variant_of: null, atlas_depth: "taught",
        });
        if (!next) return;
        open.add("edit:" + next.saved_step_id);
        $("#add-step [data-results]").innerHTML = "";
        list();
        const added = $("#step-" + CSS.escape(next.saved_step_id));
        added?.scrollIntoView({ block: "start" });
        added?.querySelector("h2").focus({ preventScroll: true });
      });
    if (act === "step-pick") {
      scope.elements.exercise_source.value = button.dataset.source;
      scope.elements.exercise_ref.value = button.dataset.ref;
      scope.querySelector("[data-exercise-name]").innerHTML = `<strong>${esc(button.dataset.title)}</strong> <span class="sd-muted">${esc(T("exercise_unsaved"))}</span>`;
      scope.querySelector("[data-results]").innerHTML = "";
      scope.querySelector('[data-search="step"]').focus();
    }
    if (act === "move")
      attempt(ctx, scope, async () => {
        if (await edit("move", { kind: "step", id: button.dataset.id, position: Number(button.dataset.pos) })) keepFocus($("#steps"), list);
      });
    if (act === "remove") {
      if (!confirm(T("remove_confirm.step", { name: button.dataset.name }))) return;
      attempt(ctx, scope, async () => {
        if (!(await edit("remove", { kind: "step", id: button.dataset.id }))) return;
        anatomy.delete(button.dataset.id);
        list();
        $("#add-step [data-search]").focus();
      });
    }
    if (!step || !anatomyScope) {
      if (act === "picked-add" && previewing) {
        addStructure(previewing, button.dataset.key);
        button.replaceWith(Object.assign(document.createElement("p"), { className: "sd-muted", textContent: T("added_unsaved") }));
      }
      if (act === "preview-back" && previewing) {
        const target = $("#step-" + CSS.escape(previewing));
        target?.scrollIntoView({ block: "start" });
        target?.querySelector("h2").focus({ preventScroll: true });
      }
      return;
    }
    // Anatomy panel actions for one step.
    const state = local(step);
    if (act === "anatomy-search")
      attempt(ctx, anatomyScope, async () => {
        const q = anatomyScope.querySelector('[data-search="anatomy"]').value.trim();
        const depth = anatomyScope.querySelector("[data-depth]").value;
        const answer = await sedens("creator/anatomy?" + new URLSearchParams({ q, depth }));
        if (ctx.stale()) return;
        syncMoments(step.id);
        state.results = answer.items.slice(0, 20);
        anatomyOf(step.id);
        main.querySelector(`[data-anatomy="${CSS.escape(step.id)}"] [data-search="anatomy"]`).value = q;
      });
    if (act === "structure-add") addStructure(step.id, button.dataset.key);
    if (act === "structure-remove") {
      syncMoments(step.id);
      const [gone] = state.structures.splice(Number(button.dataset.index), 1);
      for (const m of state.timeline) m.structures = m.structures.filter((k) => k !== gone.key);
      anatomyOf(step.id);
    }
    if (act === "moment-add") {
      syncMoments(step.id);
      const last = state.timeline.reduce((end, m) => Math.max(end, m.end_ms), 0);
      state.timeline.push({ start_ms: last, end_ms: last + 5000, mode: "highlight", layer: "", structures: state.structures.slice(0, 1).map((s) => s.key), cue: "" });
      anatomyOf(step.id);
    }
    if (act === "moment-remove") {
      syncMoments(step.id);
      state.timeline.splice(Number(button.dataset.index), 1);
      anatomyOf(step.id);
    }
    if (act === "anatomy-save")
      attempt(ctx, anatomyScope, async () => {
        syncMoments(step.id);
        checkMoments(state.timeline);
        const next = await edit("anatomy", {
          step_id: step.id,
          structures: state.structures,
          timeline: state.timeline.map((m) => ({ start_ms: m.start_ms, end_ms: m.end_ms, mode: m.mode, layer: m.layer || "", structures: m.structures, cue: m.cue })),
        });
        if (!next) return;
        anatomy.delete(step.id);
        card(step.id);
        const status = main.querySelector(`[data-anatomy="${CSS.escape(step.id)}"] [data-status]`);
        if (status) status.textContent = T("saved");
      });
    if (act === "preview" || act === "play") attempt(ctx, anatomyScope, () => preview(step, act === "play"));
  });
}

const LAYER_WORDS = ["skeleton", "muscles_superficial", "muscles_deep", "organs", "connective", "detail", "nervous"];

// -- #/creator/media --------------------------------------------------------------------------

const ACCEPT = "video/mp4,video/webm,image/jpeg,image/png,image/webp,application/pdf";
const NEEDS_SOURCE = ["pexels", "pixabay", "cc0", "cc_by", "cc_by_sa", "other"];

export async function mediaLibrary(ctx) {
  if (!ctx.me) return signedOut(ctx);
  loading(ctx, T("media_library"));
  const loaded = await load(ctx, ["creator/studio", "creator/media/sources"]);
  if (!loaded || ctx.stale()) return;
  const [studio, sources] = loaded;
  const vocab = studio.vocabulary;
  const limits = studio.limits || vocab.limits;
  const providers = sources.providers || {};
  let media = studio.media || [];

  ctx.page(
    `${studioBack()}<h1>${esc(T("media_library"))}</h1><p class="sd-lead">${esc(T("media_lead"))}</p><p class="sd-error" role="alert" id="studio-error"></p>` +
      `<section class="sd-panel" id="media-files" data-scope></section><section class="sd-panel" id="media-upload"></section><section class="sd-panel" id="media-repo" data-scope></section><section class="sd-panel" id="media-sources"></section>`,
  );
  if (!studio.profile) $("#media-files").insertAdjacentHTML("beforebegin", ctx.notice(T("profile_first")));

  const filesView = () => {
    const items = media.filter((m) => m.state === "ready");
    $("#media-files").innerHTML =
      `<h2>${esc(T("your_files"))}</h2>` +
      (items.length
        ? `<ul class="sd-list">${items
            .map((m) => {
              const review = m.rights?.review_status || "unreviewed";
              const name = m.title || m.filename;
              return `<li><div class="sd-row">${m.kind === "image" ? `<img class="sd-thumb" src="${fileUrl(m.id)}" alt="" loading="lazy">` : `<span class="sd-badge info">${esc(T("kind." + m.kind))}</span>`}<div><strong>${esc(name)}</strong><div class="sd-muted">${esc(T("kind." + m.kind))} · ${esc(T("licence." + (m.rights?.licence_type || "none")))} · ${esc(T("rights_review." + review))}</div>${m.label ? `<div class="sd-demo-label">${esc(pick(m.label))}</div>` : ""}${review === "rejected" && m.rights?.review_note ? `<div>${esc(T("review_note", { note: m.rights.review_note }))}</div>` : ""}${m.rights?.original_creator ? `<div class="sd-muted">${esc(T("made_by", { name: m.rights.original_creator }))}</div>` : ""}<details class="sd-advanced"><summary>${esc(T("advanced"))}</summary><p class="sd-muted">${esc(T("file_details", { name: m.filename || "", size: mb(m.size || 0) }))}${m.rights?.source_url ? " · " + safeLink(m.rights.source_url, T("source_link")) : ""}${m.rights?.licence_url ? " · " + safeLink(m.rights.licence_url, T("licence_link")) : ""}</p></details></div></div><button type="button" class="sd-ghost" data-act="retire" data-id="${esc(m.id)}" data-name="${esc(name)}" aria-label="${esc(T("retire_named", { name }))}">${esc(T("retire"))}</button></li>`;
            })
            .join("")}</ul>`
        : `<p class="sd-muted">${esc(T("no_files"))}</p>`) +
      errorLine();
  };

  const uploadView = () => {
    const stock = pick(sources.stock_label);
    $("#media-upload").innerHTML =
      `<h2>${esc(T("upload_title"))}</h2><p class="sd-muted">${esc(T("upload_limits", { video: mb(limits.video), image: mb(limits.image), pdf: mb(limits.pdf) }))}</p>` +
      `<form id="upload-form">${field(T("upload_file"), `<input type="file" name="file" accept="${ACCEPT}">`)}<p class="sd-muted" role="status" data-kind></p>${field(T("upload_name"), text("title", "", 'maxlength="120"'), T("upload_name_hint"))}` +
      group(
        T("rights_title"),
        `${field(T("licence_label"), select("licence_type", words("licence", vocab.licences), "own_work"))}<p class="sd-demo-label" data-stock hidden>${esc(T("stock_note", { label: stock }))}</p>${field(T("original_creator"), text("original_creator", "", 'maxlength="160"'), T("original_creator_hint"))}${field(T("source_url"), text("source_url", "", 'type="url" inputmode="url" placeholder="https://" maxlength="500"'), T("source_url_hint"))}${field(T("licence_url"), text("licence_url", "", 'type="url" inputmode="url" placeholder="https://" maxlength="500"'), T("licence_url_hint"))}${field(T("restrictions"), area("restrictions", "", 'maxlength="1000"'), T("restrictions_hint"))}${field(T("person_label"), select("identifiable_person", words("person", ["none", "consented", "unknown"]), "none"))}`,
      ) +
      `<label class="sd-check"><input type="checkbox" name="attest" data-attest> ${esc(pick(vocab.attestation))}</label><progress max="1" value="0" hidden aria-label="${esc(T("uploading"))}"></progress><div class="sd-actions"><button class="sd-primary" disabled data-needs-attest>${esc(T("upload_button"))}</button></div><p class="sd-muted" role="status" data-status></p>${errorLine()}</form>`;
  };

  const repoView = () => {
    const assets = (providers.assets || []).filter((a) => /^web\/assets\/[\w/.-]+$/.test(a.path || ""));
    const have = new Set(media.filter((m) => m.source === "repo" && m.state === "ready").map((m) => m.title));
    $("#media-repo").innerHTML =
      `<h2>${esc(T("repo_title"))}</h2><p class="sd-muted">${esc(T("repo_body"))}</p>` +
      (assets.length
        ? `<div class="sd-grid">${assets
            .map((a) => {
              const added = have.has(String(a.description?.en || "").slice(0, 120));
              return `<article class="sd-card"><img class="sd-cover" src="/${esc(a.path.replace(/^web\//, ""))}" alt="${esc(pick(a.description))}" loading="lazy"><p>${esc(pick(a.description))}</p><span class="sd-demo-label">${esc(pick(a.label))}</span>${added ? `<span class="sd-badge ok">${esc(T("in_library"))}</span>` : `<button type="button" data-act="repo-add" data-id="${esc(a.id)}" aria-label="${esc(T("repo_add_named", { name: pick(a.description) }))}">${esc(T("repo_add"))}</button>`}</article>`;
            })
            .join("")}</div>`
        : `<p class="sd-muted">${esc(T("repo_none"))}</p>`) +
      errorLine();
  };

  const sourcesView = () => {
    const list = providers.sources || [];
    const generated = list.find((s) => s.kind === "generated");
    $("#media-sources").innerHTML =
      `<h2>${esc(T("sources_title"))}</h2><p>${esc(T("no_auto_download"))}</p>${generated && !generated.enabled ? `<p class="sd-notice">${esc(T("generated_inactive"))}</p>` : ""}` +
      `<ul class="sd-list">${list
        .map((s) => `<li><div><strong>${esc(T("source." + s.id) !== "studio.source." + s.id ? T("source." + s.id) : s.name)}</strong><div class="sd-muted">${esc(T("source_kind." + s.kind))}${s.licence_url ? " · " + safeLink(s.licence_url, T("licence_link")) : ""}</div></div><span class="sd-badge ${s.enabled ? "ok" : ""}">${esc(T(s.enabled ? "source_on" : "source_off"))}</span></li>`)
        .join("")}</ul><p class="sd-muted">${esc(T("stock_rule", { label: pick(sources.stock_label) }))}</p>`;
  };

  filesView();
  uploadView();
  repoView();
  sourcesView();

  const reload = async () => {
    const next = await sedens("creator/studio");
    if (ctx.stale()) return false;
    media = next.media || [];
    return true;
  };

  const main = $(".sd-main");
  main.addEventListener("change", (event) => {
    const el = event.target;
    const form = el.closest("form");
    if (el.dataset.attest !== undefined) form.querySelector("[data-needs-attest]").disabled = !el.checked;
    if (el.name === "licence_type") form.querySelector("[data-stock]").hidden = !["pexels", "pixabay"].includes(el.value);
    if (el.name === "file") {
      const file = el.files[0];
      const kind = file ? kindOf(file.type) : null;
      form.querySelector("[data-kind]").textContent = !file ? "" : kind ? T("upload_kind", { kind: T("kind." + kind), size: mb(file.size) }) : t("error.media_type_mismatch");
      if (file && !form.elements.title.value) form.elements.title.value = file.name.replace(/\.[^.]+$/, "").slice(0, 120);
    }
  });

  main.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.target;
    if (form.id !== "upload-form") return;
    attempt(ctx, form, async () => {
      const file = form.elements.file.files[0];
      if (!file) throw new Error(T("upload_choose"));
      const kind = kindOf(file.type);
      if (!kind) throw new Error(t("error.media_type_mismatch"));
      if (file.size > limits[kind]) throw new Error(T("upload_too_large", { size: mb(limits[kind]) }));
      const v = values(form);
      if (!v.original_creator.trim()) throw new Error(T("need_original_creator"));
      if (NEEDS_SOURCE.includes(v.licence_type) && !v.source_url.trim()) throw new Error(T("need_source_url"));
      if (NEEDS_SOURCE.includes(v.licence_type) && v.licence_type !== "other" && !v.licence_url.trim()) throw new Error(T("need_licence_url"));
      const rights = {
        attest: v.attest === true, attestation_version: vocab.attestation_version, licence_type: v.licence_type,
        original_creator: v.original_creator.trim(), source_url: v.source_url.trim(), licence_url: v.licence_url.trim(),
        restrictions: v.restrictions, identifiable_person: v.identifiable_person,
      };
      const progress = form.querySelector("progress");
      progress.hidden = false;
      progress.value = 0;
      let saved;
      try {
        saved = await upload("creator/media/upload", file, { kind, filename: file.name, title: v.title.trim(), rights: JSON.stringify(rights) }, (p) => (progress.value = p));
      } finally {
        progress.hidden = true;
      }
      if (ctx.stale() || !(await reload())) return;
      filesView();
      uploadView();
      $("#upload-form [data-status]").textContent = T("uploaded", { name: saved.title || saved.filename });
    });
  });

  main.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-act]");
    if (!button) return;
    const scope = scopeOf(button);
    if (button.dataset.act === "retire") {
      if (!confirm(T("retire_confirm", { name: button.dataset.name }))) return;
      attempt(ctx, scope, async () => {
        await sedens("creator/media/retire", { id: button.dataset.id });
        if (await reload()) {
          filesView();
          repoView();
          $("#media-files h2").setAttribute("tabindex", "-1");
          $("#media-files h2").focus();
        }
      });
    }
    if (button.dataset.act === "repo-add")
      attempt(ctx, scope, async () => {
        await sedens("creator/media/repo-asset", { asset_id: button.dataset.id });
        if (await reload()) {
          filesView();
          keepFocus($("#media-repo"), repoView);
        }
      });
  });
}
