// The room screen (kiosk). It shows only what the server authorizes: every
// room-only request is checked on the server against the paired device, the
// room session and the customer. This page never decides access itself.
import { sedens, platform, demoKey, ApiError } from "./api.js";
import { t, lang, setLang } from "./i18n.js";
import { $, esc, wordmark, time, formData } from "./ui.js";

const state = { config: null, device: null, session: null, poll: null, credentials: null };
const root = () => $("#room");

function frame(body, { help = true } = {}) {
  document.documentElement.lang = lang();
  const simulated = state.device?.device?.simulated || state.session?.simulated;
  root().innerHTML = `<header class="sd-header sd-room-header"><span class="sd-brand">${wordmark()}</span><div class="sd-header-right">${state.device?.facility?.demo ? `<span class="sd-badge warn">${esc(t("common.demo"))}</span>` : ""}${simulated ? `<span class="sd-badge warn">${esc(t("common.simulated"))}</span>` : ""}<button class="sd-ghost" data-lang>${esc(t("lang.toggle"))}</button></div></header><main class="sd-room-main">${body}</main>${help ? `<footer class="sd-footer"><p>${esc(t("room.help"))}</p><p class="sd-muted">${esc(t("notice.fitness"))}</p>${simulated ? `<p class="sd-muted">${esc(t("room.simulated_access"))}</p>` : ""}</footer>` : ""}`;
  root().querySelector("[data-lang]").onclick = () => {
    setLang(lang() === "ko" ? "en" : "ko");
    render();
  };
}

function stopPolling() {
  clearInterval(state.poll);
  state.poll = null;
}

function unpairedView(message = "") {
  const demo = state.config?.mode?.features?.demo_workspaces;
  frame(`<section class="sd-room-card"><p class="sd-eyebrow">${esc(t("room.title"))}</p><h1>${esc(t("room.not_paired"))}</h1><p class="sd-lead">${esc(t("room.not_paired_body"))}</p>${message ? `<p class="sd-notice">${esc(message)}</p>` : ""}<div class="sd-actions"><button class="sd-primary sd-large" id="pair">${esc(t("room.start_pairing"))}</button>${demo ? `<button class="sd-large" id="demo-room">${esc(t("room.use_demo"))}</button>` : ""}</div><p class="sd-error" role="alert"></p></section>`);
  $("#pair").onclick = startPairing;
  $("#demo-room")?.addEventListener("click", async () => {
    try {
      const result = await sedens("demo/room-device", { key: demoKey() });
      state.credentials = result.credentials;
      await render();
    } catch (error) {
      root().querySelector(".sd-error").textContent = error.message;
    }
  });
}

async function startPairing() {
  stopPolling();
  try {
    const started = await sedens("room/pairing/start", {});
    frame(`<section class="sd-room-card"><p class="sd-eyebrow">${esc(t("room.pairing_code"))}</p><p class="sd-code" aria-live="polite">${esc(started.code)}</p><p class="sd-lead">${esc(t("room.pairing_instructions"))}</p></section>`);
    state.poll = setInterval(async () => {
      try {
        const status = await sedens("room/pairing/status");
        if (status.state === "paired") {
          stopPolling();
          await render();
        } else if (status.state !== "pending") {
          stopPolling();
          unpairedView(t("room.pairing_expired"));
        }
      } catch {
        // Keep showing the code; the next poll retries.
      }
    }, 3000);
  } catch (error) {
    unpairedView(error.message);
  }
}

function demoCards() {
  const creds = state.credentials;
  if (!creds) return "";
  const label = { room: t("room.demo_booked"), none: t("room.demo_no_booking"), other_room: t("room.demo_other_room") };
  return `<section class="sd-demo-codes"><h2>${esc(t("room.demo_codes"))}</h2><div class="sd-grid">${creds.members
    .map((m) => `<button class="sd-code-card" data-code="${esc(m.qr_code)}"><strong>${esc(m.member_ref)}</strong><span>${esc(m.membership === "active" ? label[m.booking] : t("room.demo_inactive"))}</span><code>${esc(m.qr_code)}</code></button>`)
    .join("")}</div></section>`;
}

async function entryView(message = "", decision = null) {
  const d = state.device;
  if (d.facility.demo && !state.credentials) {
    state.credentials = await sedens("demo/credentials").catch(() => null);
  }
  const methods = d.entry_methods || [];
  const codeForm = methods.some((m) => ["access_code", "qr", "reservation"].includes(m))
    ? `<form id="enter-code" class="sd-entry"><label class="sd-field"><span>${esc(t("room.entry_code"))}</span><input name="credential" autocomplete="off" autofocus required></label><p class="sd-muted">${esc(t("room.entry_code_hint"))}</p><button class="sd-primary sd-large">${esc(t("room.enter"))}</button></form>`
    : "";
  const memberForm = methods.includes("member_id")
    ? `<details><summary>${esc(t("room.entry_member"))}</summary><form id="enter-member" class="sd-entry"><label class="sd-field"><span>${esc(t("room.entry_member"))}</span><input name="credential" autocomplete="off" required></label><label class="sd-field"><span>${esc(t("room.entry_pin"))}</span><input name="pin" type="password" inputmode="numeric" autocomplete="off" required></label><button>${esc(t("room.enter"))}</button></form></details>`
    : "";
  // Customers never sign in on the shared screen. An account left signed in
  // here is shown so it can be signed out before anyone enters.
  const account = d.screen_account
    ? `<p class="sd-notice error" role="alert">${esc(t("room.screen_account"))}</p><button id="sign-out-screen">${esc(t("room.sign_out_screen"))}</button>`
    : "";
  frame(`<section class="sd-room-card"><p class="sd-eyebrow">${esc(t("room.facility_line", { facility: d.facility.name, location: d.location.name }))}</p><h1>${esc(t("room.welcome", { room: d.room.name }))}</h1><h2>${esc(t("room.entry_title"))}</h2>${account}${message ? `<p class="sd-notice" role="alert">${esc(message)}</p>` : ""}${decision?.booking?.exists ? `<p class="sd-muted">${esc(time(decision.booking.starts_at))}–${esc(time(decision.booking.ends_at))}</p>` : ""}${codeForm}${memberForm}</section>${demoCards()}`);
  const submit = async (body) => {
    try {
      const result = await sedens("room/enter", body);
      state.session = result.session;
      sessionView();
    } catch (error) {
      if (error instanceof ApiError && error.code === "device_not_paired") return render();
      entryView(error.message, error.body?.decision);
    }
  };
  $("#enter-code")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = formData(event.target).credential.trim();
    const method = /^[A-Za-z0-9]{4}-?[A-Za-z0-9]{4}$/.test(value) ? "access_code" : /^BK-/i.test(value) ? "reservation" : "qr";
    submit({ method, credential: value });
  });
  $("#enter-member")?.addEventListener("submit", (event) => {
    event.preventDefault();
    submit({ method: "member_id", ...formData(event.target) });
  });
  $("#sign-out-screen")?.addEventListener("click", async () => {
    await platform("auth/logout", {}).catch(() => {});
    await render();
  });
  document.querySelectorAll("[data-code]").forEach((b) => (b.onclick = () => submit({ method: "qr", credential: b.dataset.code })));
}

async function sessionView() {
  const s = state.session;
  let library = null;
  try {
    library = await sedens("room/library");
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return render();
  }
  sedens("room/event", { name: "room_screen_viewed", props: { screen: "session_home" } }).catch(() => {});
  const step = (text) => `<li><span>${esc(text)}</span><span class="sd-badge">${esc(t("room.coming"))}</span></li>`;
  frame(`<section class="sd-room-card"><p class="sd-eyebrow">${esc(t("room.facility_line", { facility: s.facility.name, location: s.location.name }))} · ${esc(s.room.name)}</p><h1>${esc(t("room.session_title", { name: s.customer.first_name }))}</h1><p class="sd-lead">${esc(t("room.session_body", { time: time(s.expires_at) }))}</p><h2>${esc(t("room.next_steps"))}</h2><ol class="sd-steps">${step(t("room.step_readiness"))}${step(t("room.step_scan"))}${step(t("room.step_session"))}</ol>${library ? `<p class="sd-muted">${esc(t("room.library_count", { count: library.items.length }))}</p>` : ""}<button class="sd-large" id="end">${esc(t("room.end"))}</button></section>`);
  $("#end").onclick = async () => {
    await sedens("room/end", {}).catch(() => {});
    state.session = null;
    await entryView(t("room.ended"));
  };
}

async function render() {
  stopPolling();
  try {
    state.device = await sedens("room/device");
    if (!state.device.paired) return unpairedView();
    try {
      state.session = await sedens("room/session");
      return sessionView();
    } catch (error) {
      if (!(error instanceof ApiError) || error.status >= 500) throw error;
      state.session = null;
      return entryView(["room_session_expired", "room_session_ended", "customer_signed_out"].includes(error.code) ? error.message : "");
    }
  } catch (error) {
    frame(`<section class="sd-room-card"><p class="sd-notice error">${esc(error.message || t("common.error"))}</p><button id="retry">${esc(t("common.back"))}</button></section>`);
    $("#retry").onclick = render;
  }
}

async function start() {
  try {
    state.config = await sedens("config");
  } catch {
    state.config = null;
  }
  await render();
}

start();
