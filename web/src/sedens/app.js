// SEDENS home. Routes live in the hash as "#/name"; any other hash or any
// non-tracking query parameter is a legacy coaching-workspace link and was
// already redirected by the inline script in index.html before this module loaded.
import { sedens, platform, withDemo, ApiError } from "./api.js";
import { t, lang } from "./i18n.js";
import { $, esc, header, bindHeader, footer, formData, time, focusTitle, problem } from "./ui.js";
import { compile, match } from "./router.js";

// seq: each render() takes a number; a view whose number is no longer current
// stops writing, so a slow response never overwrites the page the user moved to.
const state = { me: null, config: null, seq: 0 };
const stale = (seq) => seq !== state.seq;
const root = () => $("#sedens");

async function loadMe() {
  try {
    state.me = await sedens("me");
  } catch (error) {
    // demo_disabled: a workspace demonstration sign-in on a server whose SEDENS
    // demonstrations are off. SEDENS treats it as signed out, so the home still
    // offers sign-in instead of a dead-end error page.
    const signedOut = error instanceof ApiError && (error.status === 401 || error.code === "demo_disabled");
    if (!signedOut) throw error;
    state.me = null;
  }
}

// Hash routes. Each Phase 2 area lives in its own module, loaded when first opened.
const ROUTES = compile([
  ["facility", "facility"],
  ["facility/courses", "facility_courses"],
  ["creator", "creator"],
  ["creator/courses/new", "course_new"],
  ["creator/courses/:course", "course_edit"],
  ["creator/courses/:course/sessions/:session", "session_edit"],
  ["creator/media", "media"],
  ["review", "review"],
  ["review/courses/:course/:version", "review_course"],
  ["courses", "catalog"],
  ["courses/:course", "course_detail"],
  ["my", "my_courses"],
  ["account", "account"],
]);
const MODULES = {
  creator: ["./studio.js", "studioHome"],
  course_new: ["./studio.js", "courseNew"],
  course_edit: ["./studio.js", "courseEdit"],
  session_edit: ["./studio.js", "sessionEdit"],
  media: ["./studio.js", "mediaLibrary"],
  review: ["./review.js", "reviewHome"],
  review_course: ["./review.js", "reviewCourse"],
  facility_courses: ["./catalog.js", "facilityCourses"],
  catalog: ["./catalog.js", "catalog"],
  course_detail: ["./catalog.js", "courseDetail"],
  my_courses: ["./catalog.js", "myCourses"],
};

function route() {
  return match(ROUTES, location.hash);
}

/** What a page module receives: the signed-in person, the page writer and helpers. */
function context(found, seq) {
  return {
    me: state.me,
    config: state.config,
    params: found.params,
    query: found.query,
    stale: () => stale(seq),
    page: (body) => {
      if (!stale(seq)) page(body);
    },
    notice,
    backLink,
    refresh: render,
    go: (hash) => {
      location.hash = hash;
    },
  };
}

function page(body) {
  document.documentElement.lang = lang();
  root().innerHTML = header({ me: state.me, config: state.config }) + `<main class="sd-main">${body}</main>` + footer();
  focusTitle(root());
  bindHeader(root(), {
    onLang: render,
    onSignOut: async () => {
      await platform("auth/logout", {}).catch(() => {});
      state.me = null;
      location.hash = "#/";
      render();
    },
  });
}

function notice(text, kind = "") {
  return `<p class="sd-notice ${kind}" role="status">${esc(text)}</p>`;
}

function homeView() {
  const me = state.me;
  const card = (title, body, href, soon = false) =>
    `<article class="sd-card"><h3>${esc(title)}</h3><p>${esc(body)}</p>${soon ? `<span class="sd-badge">${esc(t("home.soon"))}</span>` : `<a class="sd-button" href="${href}">${esc(t("home.open"))}</a>`}</article>`;
  const signin = me
    ? ""
    : `<section class="sd-panel sd-auth"><div><h2>${esc(t("auth.signin"))}</h2><form id="signin">${field("email", t("auth.email"), "email", "username")}${field("password", t("auth.password"), "password", "current-password")}<p class="sd-error" role="alert"></p><button class="sd-primary">${esc(t("auth.signin"))}</button></form></div><div><h2>${esc(t("auth.demo_title"))}</h2><p class="sd-muted">${esc(t("auth.demo_body"))}</p><div class="sd-actions">${["student", "coach", "admin"].map((role) => `<button data-demo="${role}">${esc(t("auth.demo_" + (role === "student" ? "customer" : role)))}</button>`).join("")}</div><p class="sd-muted">${esc(t("auth.demo_market"))}</p><div class="sd-actions">${["creator", "professor", "reviewer"].map((role) => `<button data-demo="${role}">${esc(t("auth.demo_" + role))}</button>`).join("")}</div><p id="demo-status" class="sd-muted" role="status"></p><details><summary>${esc(t("auth.creator_signup"))}</summary><form id="creator-signup">${field("name", t("auth.name"), "text", "name")}${field("display_name", t("auth.display_name"), "text", "nickname")}${field("email", t("auth.email"), "email", "email")}${field("password", t("auth.password"), "password", "new-password", 'minlength="10"')}<label class="sd-field"><span>${esc(t("auth.creator_type"))}</span><select name="creator_type"><option value="professor">${esc(t("auth.type_professor"))}</option><option value="expert">${esc(t("auth.type_expert"))}</option></select></label><p class="sd-error" role="alert"></p><button>${esc(t("auth.create"))}</button></form></details></div></section>`;
  const roomCode =
    me?.role === "student" && me.organization.kind === "facility"
      ? `<section class="sd-panel"><h2>${esc(t("home.code_title"))}</h2><p class="sd-muted">${esc(t("home.code_body"))}</p><div id="room-code"></div><button class="sd-primary" id="get-code">${esc(t("home.code_get"))}</button></section>`
      : "";
  page(`<section class="sd-hero"><p class="sd-eyebrow">${esc(t("brand.product"))}</p><h1>${esc(t("home.title"))}</h1><p class="sd-lead">${esc(t("home.lead"))}</p><a class="sd-primary sd-large" href="/room.html">${esc(t("home.enter"))}</a><p class="sd-muted">${esc(t("home.enter_hint"))}</p></section>${roomCode}${signin}<h2 class="sd-section-title">${esc(t("home.cards"))}</h2><section class="sd-grid">${card(t("home.courses"), t("home.courses_body"), "#/courses")}${me ? card(t("home.my_courses"), t("home.my_courses_body"), "#/my") : ""}${card(t("home.passport"), t("home.passport_body"), "#/passport", true)}${card(t("home.creator"), t("home.creator_body"), "#/creator")}${card(t("home.facility"), t("home.facility_body"), "#/facility")}${me?.capabilities?.includes("sedens_reviewer") ? card(t("home.review"), t("home.review_body"), "#/review") : ""}${card(t("home.workspace"), t("home.workspace_body"), "/workspace.html")}</section>`);
  $("#get-code")?.addEventListener("click", async () => {
    try {
      const issued = await sedens("access-code", {});
      $("#room-code").innerHTML = `<p class="sd-code">${esc(issued.code)}</p><p>${esc(t("home.code_for", { name: issued.customer.first_name, facility: issued.facility.name }))}</p><p class="sd-muted">${esc(t("home.code_value", { code: issued.code }))} · ${esc(t("home.code_expires"))}</p>`;
    } catch (error) {
      $("#room-code").innerHTML = `<p class="sd-notice error">${esc(error.message)}</p>`;
    }
  });
  const form = $("#signin");
  if (form)
    form.onsubmit = async (event) => {
      event.preventDefault();
      try {
        await platform("auth/login", formData(form));
        await loadMe();
        render();
      } catch (error) {
        form.querySelector(".sd-error").textContent = error.message;
      }
    };
  document.querySelectorAll("[data-demo]").forEach((button) => {
    button.onclick = async () => {
      $("#demo-status").textContent = t("auth.demo_preparing");
      document.querySelectorAll("[data-demo]").forEach((b) => (b.disabled = true));
      try {
        const result = await withDemo("demo/enter", { role: button.dataset.demo });
        state.me = result.me;
        const role = button.dataset.demo;
        location.hash = { admin: "#/facility", coach: "#/creator", creator: "#/creator", professor: "#/creator", reviewer: "#/review" }[role] || "#/";
        render();
      } catch (error) {
        $("#demo-status").textContent = error.message;
        document.querySelectorAll("[data-demo]").forEach((b) => (b.disabled = false));
      }
    };
  });
  const signup = $("#creator-signup");
  if (signup)
    signup.onsubmit = async (event) => {
      event.preventDefault();
      try {
        const result = await sedens("auth/register-creator", formData(signup));
        state.me = result.me;
        location.hash = "#/creator";
        render();
      } catch (error) {
        signup.querySelector(".sd-error").textContent = error.message;
      }
    };
}

function field(name, label, type = "text", autocomplete = "", extra = "") {
  return `<label class="sd-field"><span>${esc(label)}</span><input name="${name}" type="${type}" autocomplete="${autocomplete}" required ${extra}></label>`;
}

function backLink() {
  return `<a class="sd-back" href="#/">← ${esc(t("common.back"))}</a>`;
}

async function facilityView() {
  if (!state.me || state.me.role !== "admin" || state.me.organization.kind !== "facility") {
    page(`${backLink()}<h1>${esc(t("facility.title"))}</h1>${notice(t("facility.need_admin"))}`);
    return;
  }
  const seq = state.seq;
  page(`${backLink()}<h1>${esc(t("facility.title"))}</h1><p class="sd-muted">${esc(state.me.organization.display_name)}</p><p><a class="sd-button" href="#/facility/courses">${esc(t("facility.courses_link"))}</a></p><div id="facility-body">${notice(t("common.loading"))}</div>`);
  const [roomsData, crm, people, affiliations] = await Promise.all([
    sedens("facility/rooms"),
    sedens("facility/crm"),
    sedens("facility/people"),
    sedens("facility/affiliations"),
  ]);
  if (stale(seq)) return;
  const rooms = roomsData.locations.flatMap((loc) => loc.rooms.map((room) => ({ ...room, location: loc.name })));
  const deviceRow = (d) =>
    `<li><span>${esc(d.name)} ${d.simulated ? `<span class="sd-badge warn">${esc(t("common.simulated"))}</span>` : ""}</span><span class="sd-muted">${esc(d.status === "revoked" ? t("facility.device_revoked") : d.paired ? t("facility.device_active") : t("facility.device_waiting"))}${d.last_seen_at ? " · " + esc(t("facility.last_seen", { time: time(d.last_seen_at) })) : ""}</span>${d.status === "active" ? `<button class="sd-ghost" data-revoke="${esc(d.id)}">${esc(t("facility.revoke"))}</button>` : ""}</li>`;
  const roomList = rooms.length
    ? rooms.map((room) => `<div class="sd-room"><h3>${esc(room.name)} <span class="sd-muted">· ${esc(room.location)}</span></h3><ul class="sd-list">${room.devices.map(deviceRow).join("")}</ul></div>`).join("")
    : notice(t("facility.no_rooms"));
  const provider = crm.provider === "demo" ? t("facility.crm_demo") : t("facility.crm_none");
  const creatorsList = people.items
    .map((p) => {
      const has = p.capabilities.includes("creator");
      return `<li><span>${esc(p.name)} <span class="sd-muted">${esc(p.roles.join(", "))}</span></span><button class="sd-ghost" data-grant="${esc(p.id)}" data-on="${has ? "0" : "1"}">${esc(has ? t("facility.revoke_creator") : t("facility.grant"))}</button></li>`;
    })
    .join("");
  const locationName = (id) => roomsData.locations.find((loc) => loc.id === id)?.name;
  const affList = affiliations.items.length
    ? affiliations.items
        .map((a) => {
          const where = a.location_id ? t("facility.aff_location", { name: locationName(a.location_id) || "—" }) : t("facility.all_locations");
          const actions =
            a.status === "requested"
              ? `<span><button data-decide="${esc(a.id)}" data-decision="approve" aria-label="${esc(t("facility.approve") + " · " + a.creator.display_name)}">${esc(t("facility.approve"))}</button> <button class="sd-ghost" data-decide="${esc(a.id)}" data-decision="decline" aria-label="${esc(t("facility.decline") + " · " + a.creator.display_name)}">${esc(t("facility.decline"))}</button></span>`
              : a.status === "approved"
                ? `<button class="sd-ghost" data-end-affiliation="${esc(a.id)}" aria-label="${esc(t("facility.revoke_affiliation") + " · " + a.creator.display_name)}">${esc(t("facility.revoke_affiliation"))}</button>`
                : "";
          return `<li><span>${esc(a.creator.display_name)} <span class="sd-muted">${esc(t("creator.type_" + a.creator.creator_type))} · ${esc(t("creator.state_" + a.creator.verification_state))} · ${esc(where)}</span></span><span class="sd-badge">${esc(t("affiliation.status_" + a.status))}</span>${actions}</li>`;
        })
        .join("")
    : `<li class="sd-muted">${esc(t("facility.no_affiliations"))}</li>`;
  $("#facility-body").innerHTML = `<section class="sd-panel"><h2>${esc(t("facility.rooms"))}</h2><p class="sd-muted">${esc(t("facility.rooms_hint"))}</p>${roomList}${rooms.length ? `<form id="pair" class="sd-inline"><label class="sd-field"><span>${esc(t("facility.pair_code"))}</span><input name="code" required autocomplete="off" placeholder="ABCD-EFGH"></label><label class="sd-field"><span>${esc(t("facility.pair_room"))}</span><select name="room_id">${rooms.map((r) => `<option value="${esc(r.id)}">${esc(r.name)} · ${esc(r.location)}</option>`).join("")}</select></label><label class="sd-field"><span>${esc(t("facility.pair_name"))}</span><input name="name" maxlength="80"></label><button class="sd-primary">${esc(t("facility.pair"))}</button><p class="sd-error" role="alert"></p></form>` : ""}</section><section class="sd-panel"><h2>${esc(t("facility.crm"))}</h2><p>${esc(provider)}</p>${crm.simulated ? `<span class="sd-badge warn">${esc(t("common.simulated"))}</span>` : ""}${crm.booking_rules ? `<form id="crm" class="sd-inline"><label class="sd-check"><input type="checkbox" name="require_booking" ${crm.require_booking ? "checked" : ""}> ${esc(t("facility.require_booking"))}</label><label class="sd-field"><span>${esc(t("facility.grace"))}</span><input type="number" min="0" max="120" name="booking_grace_minutes" value="${esc(crm.booking_grace_minutes)}"></label><button>${esc(t("common.save"))}</button></form>` : `<p class="sd-muted">${esc(t("facility.no_booking_rules"))}</p>`}</section><section class="sd-panel"><h2>${esc(t("facility.creators"))}</h2><p class="sd-muted">${esc(t("facility.creators_hint"))}</p><ul class="sd-list">${creatorsList}</ul></section><section class="sd-panel"><h2>${esc(t("facility.affiliations"))}</h2><p class="sd-muted">${esc(t("facility.affiliations_hint"))}</p><p class="sd-muted">${esc(t("facility.aff_grants"))}</p><p>${esc(state.me.organization.demo ? t("facility.code_demo") : t("facility.code", { code: state.me.organization.id }))}</p><ul class="sd-list">${affList}</ul></section>`;
  const pair = $("#pair");
  if (pair)
    pair.onsubmit = async (event) => {
      event.preventDefault();
      try {
        await sedens("facility/devices/confirm", formData(pair));
        render();
      } catch (error) {
        pair.querySelector(".sd-error").textContent = error.message;
      }
    };
  const crmForm = $("#crm");
  if (crmForm)
    crmForm.onsubmit = async (event) => {
      event.preventDefault();
      const form = event.target;
      await sedens("facility/crm", {
        require_booking: form.require_booking.checked,
        booking_grace_minutes: Number(form.booking_grace_minutes.value),
      });
      render();
    };
  // Every action reports a failure instead of leaving an unhandled rejection.
  const act = (selector, call) =>
    document.querySelectorAll(selector).forEach((b) => (b.onclick = async () => {
      b.disabled = true;
      try {
        await call(b);
        render();
      } catch (error) {
        b.disabled = false;
        b.insertAdjacentHTML("afterend", `<span class="sd-error" role="alert">${esc(problem(error))}</span>`);
      }
    }));
  act("[data-revoke]", (b) => sedens("facility/devices/revoke", { device_id: b.dataset.revoke }));
  act("[data-grant]", (b) => sedens("facility/capabilities", { user_id: b.dataset.grant, capability: "creator", grant: b.dataset.on === "1" }));
  act("[data-decide]", (b) => sedens("facility/affiliations/decide", { id: b.dataset.decide, decision: b.dataset.decision }));
  act("[data-end-affiliation]", (b) => sedens("facility/affiliations/revoke", { id: b.dataset.endAffiliation }));
}

async function accountView() {
  if (!state.me) return homeView();
  const seq = state.seq;
  const data = await sedens("consents");
  if (stale(seq)) return;
  const rows = Object.entries(data.texts)
    .map(([kind, text]) => {
      const current = data.current[kind];
      const choice = current ? (current.granted ? t("account.agree") : t("account.disagree")) : t("account.none");
      return `<li class="sd-consent"><p>${esc(text[lang()] || text.en)}</p><p class="sd-muted">${esc(t("account.current", { choice }))}</p><button data-consent="${kind}" data-version="${esc(text.version)}" data-granted="1">${esc(t("account.agree"))}</button> <button class="sd-ghost" data-consent="${kind}" data-version="${esc(text.version)}" data-granted="0">${esc(t("account.disagree"))}</button></li>`;
    })
    .join("");
  page(`${backLink()}<h1>${esc(t("account.consents"))}</h1><ul class="sd-list">${rows}</ul>`);
  document.querySelectorAll("[data-consent]").forEach((b) => (b.onclick = async () => {
    await sedens("consents", { kind: b.dataset.consent, text_version: b.dataset.version, granted: b.dataset.granted === "1" });
    render();
  }));
}

async function render() {
  const seq = ++state.seq;
  try {
    // A sign-in or sign-out made elsewhere (another tab, the coaching workspace)
    // is picked up on every navigation.
    await loadMe();
    if (stale(seq)) return;
    const found = route();
    const name = found.name;
    if (name === "facility") await facilityView();
    else if (name === "account") await accountView();
    else if (MODULES[name]) {
      const [path, view] = MODULES[name];
      const module = await import(path);
      if (stale(seq)) return;
      await module[view](context(found, seq));
    } else if (name === "not_found") page(`${backLink()}<h1>${esc(t("common.not_found"))}</h1>`);
    else homeView();
  } catch (error) {
    if (stale(seq)) return;
    if (error instanceof ApiError && error.status === 401) {
      state.me = null;
      homeView();
      return;
    }
    page(`${backLink()}${notice(problem(error), "error")}`);
  }
}

// A legacy workspace link pasted while the SEDENS home is open is a same-page
// hash change; it opens the workspace exactly as on first load.
function onHashChange() {
  const target = window.sedensLegacyWorkspaceTarget?.(location.search, location.hash);
  if (target) location.replace(target);
  else render();
}

async function start() {
  try {
    state.config = await sedens("config");
  } catch {
    state.config = null;
  }
  await render();
  window.addEventListener("hashchange", onHashChange);
}

start();
