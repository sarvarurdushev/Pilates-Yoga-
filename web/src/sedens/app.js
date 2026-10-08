// SEDENS home. Routes live in the hash as "#/name"; any other hash or any query
// string is a legacy coaching-workspace link and was already redirected by the
// inline script in index.html before this module loaded.
import { sedens, platform, demoKey, ApiError } from "./api.js";
import { t, lang } from "./i18n.js";
import { $, esc, header, bindHeader, footer, formData, time } from "./ui.js";

const state = { me: null, config: null };
const root = () => $("#sedens");

async function loadMe() {
  try {
    state.me = await sedens("me");
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error;
    state.me = null;
  }
}

function route() {
  const hash = location.hash.replace(/^#\/?/, "");
  return hash.split("?")[0] || "home";
}

function page(body) {
  document.documentElement.lang = lang();
  root().innerHTML = header({ me: state.me, config: state.config }) + `<main class="sd-main">${body}</main>` + footer();
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
    : `<section class="sd-panel sd-auth"><div><h2>${esc(t("auth.signin"))}</h2><form id="signin">${field("email", t("auth.email"), "email", "username")}${field("password", t("auth.password"), "password", "current-password")}<p class="sd-error" role="alert"></p><button class="sd-primary">${esc(t("auth.signin"))}</button></form></div><div><h2>${esc(t("auth.demo_title"))}</h2><p class="sd-muted">${esc(t("auth.demo_body"))}</p><div class="sd-actions">${["student", "coach", "admin"].map((role) => `<button data-demo="${role}">${esc(t("auth.demo_" + (role === "student" ? "customer" : role)))}</button>`).join("")}</div><p id="demo-status" class="sd-muted" role="status"></p><details><summary>${esc(t("auth.creator_signup"))}</summary><form id="creator-signup">${field("name", t("auth.name"), "text", "name")}${field("display_name", t("auth.display_name"), "text", "nickname")}${field("email", t("auth.email"), "email", "email")}${field("password", t("auth.password"), "password", "new-password", 'minlength="10"')}<label class="sd-field"><span>${esc(t("auth.creator_type"))}</span><select name="creator_type"><option value="professor">${esc(t("auth.type_professor"))}</option><option value="expert">${esc(t("auth.type_expert"))}</option></select></label><p class="sd-error" role="alert"></p><button>${esc(t("auth.create"))}</button></form></details></div></section>`;
  const roomCode =
    me?.role === "student" && me.organization.kind === "facility"
      ? `<section class="sd-panel"><h2>${esc(t("home.code_title"))}</h2><p class="sd-muted">${esc(t("home.code_body"))}</p><div id="room-code"></div><button class="sd-primary" id="get-code">${esc(t("home.code_get"))}</button></section>`
      : "";
  page(`<section class="sd-hero"><p class="sd-eyebrow">${esc(t("brand.product"))}</p><h1>${esc(t("home.title"))}</h1><p class="sd-lead">${esc(t("home.lead"))}</p><a class="sd-primary sd-large" href="/room.html">${esc(t("home.enter"))}</a><p class="sd-muted">${esc(t("home.enter_hint"))}</p></section>${roomCode}${signin}<h2 class="sd-section-title">${esc(t("home.cards"))}</h2><section class="sd-grid">${card(t("home.passport"), t("home.passport_body"), "#/passport", true)}${card(t("home.creator"), t("home.creator_body"), "#/creator")}${card(t("home.facility"), t("home.facility_body"), "#/facility")}${card(t("home.workspace"), t("home.workspace_body"), "/workspace.html")}</section>`);
  $("#get-code")?.addEventListener("click", async () => {
    try {
      const issued = await sedens("access-code", {});
      $("#room-code").innerHTML = `<p class="sd-code">${esc(issued.code)}</p><p class="sd-muted">${esc(t("home.code_value", { code: issued.code }))} · ${esc(t("home.code_expires"))}</p>`;
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
        const result = await sedens("demo/enter", { key: demoKey(), role: button.dataset.demo });
        state.me = result.me;
        location.hash = button.dataset.demo === "admin" ? "#/facility" : button.dataset.demo === "coach" ? "#/creator" : "#/";
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
  page(`${backLink()}<h1>${esc(t("facility.title"))}</h1><p class="sd-muted">${esc(state.me.organization.display_name)}</p><div id="facility-body">${notice(t("common.loading"))}</div>`);
  const [roomsData, crm, people, affiliations] = await Promise.all([
    sedens("facility/rooms"),
    sedens("facility/crm"),
    sedens("facility/people"),
    sedens("facility/affiliations"),
  ]);
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
  const affList = affiliations.items.length
    ? affiliations.items
        .map((a) => `<li><span>${esc(a.creator.display_name)} <span class="sd-muted">${esc(a.creator.creator_type)} · ${esc(t("creator.state_" + a.creator.verification_state))}</span></span><span class="sd-muted">${esc(a.status)}</span>${a.status === "requested" ? `<span><button data-decide="${esc(a.id)}" data-decision="approve">${esc(t("facility.approve"))}</button> <button class="sd-ghost" data-decide="${esc(a.id)}" data-decision="decline">${esc(t("facility.decline"))}</button></span>` : ""}</li>`)
        .join("")
    : `<li class="sd-muted">${esc(t("facility.no_affiliations"))}</li>`;
  $("#facility-body").innerHTML = `<section class="sd-panel"><h2>${esc(t("facility.rooms"))}</h2><p class="sd-muted">${esc(t("facility.rooms_hint"))}</p>${roomList}${rooms.length ? `<form id="pair" class="sd-inline"><label class="sd-field"><span>${esc(t("facility.pair_code"))}</span><input name="code" required autocomplete="off" placeholder="ABCD-EFGH"></label><label class="sd-field"><span>${esc(t("facility.pair_room"))}</span><select name="room_id">${rooms.map((r) => `<option value="${esc(r.id)}">${esc(r.name)} · ${esc(r.location)}</option>`).join("")}</select></label><label class="sd-field"><span>${esc(t("facility.pair_name"))}</span><input name="name" maxlength="80"></label><button class="sd-primary">${esc(t("facility.pair"))}</button><p class="sd-error" role="alert"></p></form>` : ""}</section><section class="sd-panel"><h2>${esc(t("facility.crm"))}</h2><p>${esc(provider)}</p>${crm.simulated ? `<span class="sd-badge warn">${esc(t("common.simulated"))}</span>` : ""}<form id="crm" class="sd-inline"><label class="sd-check"><input type="checkbox" name="require_booking" ${crm.require_booking ? "checked" : ""}> ${esc(t("facility.require_booking"))}</label><label class="sd-field"><span>${esc(t("facility.grace"))}</span><input type="number" min="0" max="120" name="booking_grace_minutes" value="${esc(crm.booking_grace_minutes)}"></label><button>${esc(t("common.save"))}</button></form></section><section class="sd-panel"><h2>${esc(t("facility.creators"))}</h2><p class="sd-muted">${esc(t("facility.creators_hint"))}</p><ul class="sd-list">${creatorsList}</ul></section><section class="sd-panel"><h2>${esc(t("facility.affiliations"))}</h2><p class="sd-muted">${esc(t("facility.affiliations_hint"))}</p><p>${esc(t("facility.code", { code: state.me.organization.id }))}</p><ul class="sd-list">${affList}</ul></section>`;
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
  $("#crm").onsubmit = async (event) => {
    event.preventDefault();
    const form = event.target;
    await sedens("facility/crm", {
      require_booking: form.require_booking.checked,
      booking_grace_minutes: Number(form.booking_grace_minutes.value),
    });
    render();
  };
  document.querySelectorAll("[data-revoke]").forEach((b) => (b.onclick = async () => { await sedens("facility/devices/revoke", { device_id: b.dataset.revoke }); render(); }));
  document.querySelectorAll("[data-grant]").forEach((b) => (b.onclick = async () => { await sedens("facility/capabilities", { user_id: b.dataset.grant, capability: "creator", grant: b.dataset.on === "1" }); render(); }));
  document.querySelectorAll("[data-decide]").forEach((b) => (b.onclick = async () => { await sedens("facility/affiliations/decide", { id: b.dataset.decide, decision: b.dataset.decision }); render(); }));
}

async function creatorView() {
  if (!state.me) {
    page(`${backLink()}<h1>${esc(t("creator.title"))}</h1>${notice(t("creator.need_capability"))}`);
    return;
  }
  const data = await sedens("creator/profile");
  if (!data.capabilities.includes("creator")) {
    page(`${backLink()}<h1>${esc(t("creator.title"))}</h1>${notice(t("creator.need_capability"))}`);
    return;
  }
  const p = data.profile || { display_name: state.me.user.name, bio: "", institution: "", creator_type: "", verification_state: "unverified" };
  const affiliations = (await sedens("creator/affiliations")).items;
  page(`${backLink()}<h1>${esc(t("creator.title"))}</h1><section class="sd-panel"><h2>${esc(t("creator.profile"))}</h2><p>${esc(t("creator.verification", { state: t("creator.state_" + p.verification_state) }))}</p><form id="profile"><label class="sd-field"><span>${esc(t("creator.display_name"))}</span><input name="display_name" required maxlength="80" value="${esc(p.display_name)}"></label><label class="sd-field"><span>${esc(t("creator.institution"))}</span><input name="institution" maxlength="160" value="${esc(p.institution)}"></label><label class="sd-field"><span>${esc(t("creator.bio"))}</span><textarea name="bio" maxlength="2000" rows="4">${esc(p.bio)}</textarea></label><p class="sd-muted">${esc(t("creator.type"))}: ${esc(p.creator_type || "—")}</p><p class="sd-error" role="alert"></p><button class="sd-primary">${esc(t("common.save"))}</button> ${data.profile && ["unverified", "rejected"].includes(p.verification_state) ? `<button type="button" id="verify">${esc(t("creator.verify_request"))}</button>` : ""}</form></section><section class="sd-panel"><h2>${esc(t("creator.affiliations"))}</h2><p class="sd-muted">${esc(t("creator.affiliation_hint"))}</p><ul class="sd-list">${data.distribution_targets.some((d) => d.basis === "home_facility") ? `<li>${esc(state.me.organization.display_name)} <span class="sd-muted">home</span></li>` : ""}${affiliations.map((a) => `<li>${esc(a.facility_name)} <span class="sd-muted">${esc(a.status)}</span></li>`).join("")}</ul>${data.profile ? `<form id="affiliate" class="sd-inline"><label class="sd-field"><span>${esc(t("creator.facility_code"))}</span><input name="org_id" required></label><button>${esc(t("creator.request"))}</button><p class="sd-error" role="alert"></p></form>` : ""}</section>${notice(t("creator.courses_soon"))}`);
  $("#profile").onsubmit = async (event) => {
    event.preventDefault();
    try {
      await sedens("creator/profile", formData(event.target));
      render();
    } catch (error) {
      event.target.querySelector(".sd-error").textContent = error.message;
    }
  };
  $("#verify")?.addEventListener("click", async () => { await sedens("creator/verification/request", {}); render(); });
  const affiliate = $("#affiliate");
  if (affiliate)
    affiliate.onsubmit = async (event) => {
      event.preventDefault();
      try {
        await sedens("creator/affiliations/request", formData(affiliate));
        render();
      } catch (error) {
        affiliate.querySelector(".sd-error").textContent = error.message;
      }
    };
}

async function accountView() {
  if (!state.me) return homeView();
  const data = await sedens("consents");
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
  try {
    // A sign-in made elsewhere (another tab, the coaching workspace) is picked up on navigation.
    if (!state.me) await loadMe();
    const name = route();
    if (name === "facility") await facilityView();
    else if (name === "creator") await creatorView();
    else if (name === "account") await accountView();
    else homeView();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      state.me = null;
      homeView();
      return;
    }
    page(`${backLink()}${notice(error.message || t("common.error"), "error")}`);
  }
}

async function start() {
  try {
    state.config = await sedens("config");
  } catch {
    state.config = null;
  }
  await loadMe().catch(() => {});
  await render();
  window.addEventListener("hashchange", render);
}

start();
