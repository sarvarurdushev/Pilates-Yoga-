// The room screen (kiosk). It shows only what the server authorizes: every
// room-only request is checked on the server against the paired device, the
// room session and the customer. This page never decides access itself.
//
// Before anyone is identified it shows pairing and entry. After entry the server
// owns the customer's journey (docs/SEDENS_ROOM_FLOW.md): this page reads the
// current state from GET room/journey, draws the screens it owns, hands the scan
// and the workout player a ctx, and asks for every transition with act().
import { sedens, platform, withDemo, upload as uploadFile, ApiError } from "./api.js";
import { t, lang, setLang } from "./i18n.js";
import { $, esc, wordmark, time, date, formData } from "./ui.js";
import { renderScan, renderScanResult, stopScan } from "./room-scan.js";
import { mountPlayer } from "./room-player.js";
import * as J from "./room-journey.js";

// view: re-draws the current screen in place (used by the language button while
// a pairing code is shown, so the code and its polling survive).
// run: bumped whenever a visit's screens are left, so a late reply is ignored.
const state = {
  config: null, device: null, session: null, poll: null, credentials: null, activity: null, view: null, pairing: 0,
  mark: null, run: 0, journey: null, owner: null, player: null, ctx: null, viewed: null,
  setup: {}, notice: null, fb: null, urgent: null, busy: false,
};
const ENDED_CODES = J.ENDED_CODES;
const ROOM_DENIALS = ["device_not_paired", "room_scope_mismatch", "customer_not_active", "not_assigned_to_location", "account_signed_in", "staff_signed_in"];
const ACTIVITY_EVENTS = ["pointerdown", "keydown", "touchstart"];
const URGENT_KEY = "sedens-room-urgent-feedback";
const root = () => $("#room");
const main = () => $("#rj-main");

// A failed ctx.act() that the shell has already explained in its banner rejects with
// error.shown = true; if the screen that asked does not catch it, it is not an uncaught error.
window.addEventListener("unhandledrejection", (event) => {
  if (event.reason && event.reason.shown === true) event.preventDefault();
});

function frame(body, { help = true } = {}) {
  leaveJourney();
  document.documentElement.lang = lang();
  const simulated = state.device?.device?.simulated || state.session?.simulated;
  root().innerHTML = `<header class="sd-header sd-room-header"><span class="sd-brand">${wordmark()}</span><div class="sd-header-right">${state.device?.facility?.demo ? `<span class="sd-badge warn">${esc(t("common.demo"))}</span>` : ""}${simulated ? `<span class="sd-badge warn">${esc(t("common.simulated"))}</span>` : ""}<button class="sd-ghost" data-lang>${esc(t("lang.toggle"))}</button></div></header><main class="sd-room-main">${body}</main>${help ? `<footer class="sd-footer"><p>${esc(t("room.help"))}</p><p class="sd-muted">${esc(t("notice.fitness"))}</p>${simulated ? `<p class="sd-muted">${esc(t("room.simulated_access"))}</p>` : ""}</footer>` : ""}`;
  root().querySelector("[data-lang]").onclick = () => {
    setLang(lang() === "ko" ? "en" : "ko");
    (state.view || render)();
  };
}

function stopPolling() {
  clearInterval(state.poll);
  state.poll = null;
  state.view = null;
  state.pairing += 1; // any pairing poll still in flight is now stale
  if (state.activity) ACTIVITY_EVENTS.forEach((name) => document.removeEventListener(name, state.activity));
  state.activity = null;
  state.mark = null;
}

// The server closes a room session after idle_minutes without a room request.
// Touching the screen tells it someone is still here, and so does real progress
// in the room (a workout step, a scan view: ctx.markActivity() and every accepted
// act()). With neither, the screen ends the session itself so the next person
// starts from the entry view. Nothing here keeps a session alive on a timer alone.
function watchActivity(idleMinutes) {
  const idleMs = Math.max(1, idleMinutes || 15) * 60000;
  let lastTouch = Date.now();
  let lastPing = Date.now();
  // served: the server has just accepted a room request, so no ping is needed.
  const mark = (served = false) => {
    lastTouch = Date.now();
    if (served) {
      lastPing = Date.now();
      return;
    }
    if (Date.now() - lastPing < 60000) return;
    lastPing = Date.now();
    sedens("room/session").catch((error) => {
      if (error instanceof ApiError && error.status < 500) render({ gone: t("room.ended") });
    });
  };
  state.activity = () => mark();
  state.mark = mark;
  ACTIVITY_EVENTS.forEach((name) => document.addEventListener(name, state.activity, { passive: true }));
  const expiresAt = Date.parse(state.session?.expires_at || "") || Infinity;
  state.poll = setInterval(async () => {
    // Past the session's own end the server has closed it: show the real state.
    if (Date.now() >= expiresAt) return render();
    if (Date.now() - lastTouch < idleMs - 30000) return;
    stopPolling();
    await endSession(t("room.idle_ended"));
  }, 15000);
}

// "Session ended" is shown only once the server has ended it (or it was already
// gone). On any other failure the screen re-reads the real state from the server.
async function endSession(message) {
  stopPolling();
  try {
    await sedens("room/end", {});
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 401)) {
      await render();
      showBanner(t("rj.end_failed"), "error");
      return;
    }
  }
  state.session = null;
  rememberUrgent(null);
  await entryView(message);
}

function unpairedView(message = "") {
  const demo = state.config?.mode?.features?.demo_workspaces;
  frame(`<section class="sd-room-card"><p class="sd-eyebrow">${esc(t("room.title"))}</p><h1>${esc(t("room.not_paired"))}</h1><p class="sd-lead">${esc(t("room.not_paired_body"))}</p>${message ? `<p class="sd-notice">${esc(message)}</p>` : ""}<div class="sd-actions"><button class="sd-primary sd-large" id="pair">${esc(t("room.start_pairing"))}</button>${demo ? `<button class="sd-large" id="demo-room">${esc(t("room.use_demo"))}</button>` : ""}</div><p class="sd-error" role="alert"></p></section>`);
  $("#pair").onclick = startPairing;
  $("#demo-room")?.addEventListener("click", async () => {
    try {
      const result = await withDemo("demo/room-device");
      state.credentials = result.credentials;
      await render();
    } catch (error) {
      root().querySelector(".sd-error").textContent = error.message;
    }
  });
}

async function startPairing() {
  stopPolling();
  const run = state.pairing;
  try {
    const started = await sedens("room/pairing/start", {});
    if (run !== state.pairing) return;
    const view = () =>
      frame(`<section class="sd-room-card"><p class="sd-eyebrow">${esc(t("room.pairing_code"))}</p><p class="sd-code" aria-live="polite">${esc(started.code)}</p><p class="sd-lead">${esc(t("room.pairing_instructions"))}</p></section>`);
    view();
    state.view = view;
    // One poll at a time; a reply that arrives after pairing stopped is ignored.
    const poll = async () => {
      let status = null;
      try {
        status = await sedens("room/pairing/status");
      } catch {
        // Keep showing the code; the next poll retries.
      }
      if (run !== state.pairing) return;
      if (status?.state === "pending" || status === null) {
        setTimeout(poll, 3000);
      } else if (status.state === "paired" || status.state === "claimed") {
        await render();
      } else {
        stopPolling();
        unpairedView(t("room.pairing_expired"));
      }
    };
    setTimeout(poll, 3000);
  } catch (error) {
    if (run === state.pairing) unpairedView(error.message);
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
  // The server refuses entry while any account is signed in here, so the forms
  // are replaced by the sign-out button until the screen is clear.
  frame(`<section class="sd-room-card"><p class="sd-eyebrow">${esc(t("room.facility_line", { facility: d.facility.name, location: d.location.name }))}</p><h1>${esc(t("room.welcome", { room: d.room.name }))}</h1><h2>${esc(t("room.entry_title"))}</h2>${account}${message ? `<p class="sd-notice" role="alert">${esc(message)}</p>` : ""}${decision?.booking?.exists ? `<p class="sd-muted">${esc(time(decision.booking.starts_at))}–${esc(time(decision.booking.ends_at))}</p>` : ""}${d.screen_account ? "" : codeForm + memberForm}</section>${d.screen_account ? "" : demoCards()}`);
  // autofocus applies once per document; keyboard-wedge QR scanners type into the focused field.
  $("#enter-code [name=credential]")?.focus();
  const submit = async (body) => {
    try {
      const result = await sedens("room/enter", body);
      state.session = result.session;
      await startJourney();
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

const endedMessage = (error) => t(error?.code === "room_session_idle" ? "room.idle_ended" : "room.ended");

// -- the visit: shell, ctx and transitions ---------------------------------------------------

/** Leave the visit's screens: the player and the camera stop, late replies are ignored. */
function leaveJourney() {
  state.run += 1;
  release(null);
  Object.assign(state, { journey: null, owner: null, ctx: null, viewed: null, setup: {}, notice: null, fb: null, busy: false });
}

function headerHTML() {
  const s = state.session;
  const simulated = state.device?.device?.simulated || s?.simulated;
  const demo = state.device?.facility?.demo || s?.facility?.demo;
  const other = lang() === "ko" ? "en" : "ko";
  return `<header class="sd-header sd-room-header rj-header"><span class="sd-brand">${wordmark()}</span><div class="sd-header-right">${s?.room?.name ? `<span class="rj-header-room">${esc(s.room.name)}</span>` : ""}${demo ? `<span class="sd-badge warn">${esc(t("common.demo"))}</span>` : ""}${simulated ? `<span class="sd-badge warn">${esc(t("common.simulated"))}</span>` : ""}<button class="rj-header-button" data-end-visit>${esc(t("rj.end_visit"))}</button><button class="sd-ghost rj-header-button" data-lang lang="${other}">${esc(t("lang.toggle"))}</button></div></header>`;
}

function footerHTML() {
  const simulated = state.device?.device?.simulated || state.session?.simulated;
  return `<footer class="sd-footer rj-footer"><p>${esc(t("room.help"))}</p><p class="sd-muted">${esc(t("notice.fitness"))}</p>${simulated ? `<p class="sd-muted">${esc(t("room.simulated_access"))}</p>` : ""}</footer>`;
}

function dialogHTML() {
  return `<dialog class="rj-dialog" id="rj-end-dialog" aria-labelledby="rj-end-title"><h2 id="rj-end-title">${esc(t("rj.end_confirm_title"))}</h2><p class="sd-lead">${esc(t("rj.end_confirm_body"))}</p><div class="rj-actions"><button class="sd-primary sd-large" data-end-confirm>${esc(t("rj.end_visit"))}</button><button class="sd-large" data-end-cancel>${esc(t("rj.keep_going"))}</button></div></dialog>`;
}

/** The visit's page: header, a notice banner, the <main> every screen draws into, the footer. */
function shell() {
  document.documentElement.lang = lang();
  root().innerHTML = `${headerHTML()}<div class="rj-banner-wrap"><div id="rj-banner" class="rj-banner" aria-live="polite"></div></div><main class="sd-room-main rj-main" id="rj-main" data-owner="shell" aria-live="off"></main>${footerHTML()}${dialogHTML()}`;
  bindChrome();
}

/** Re-draw the header, footer and dialog in the current language, leaving <main> untouched. */
function paintChrome() {
  document.documentElement.lang = lang();
  const r = root();
  r.querySelector(".rj-header")?.replaceWith(fragment(headerHTML()));
  r.querySelector(".rj-footer")?.replaceWith(fragment(footerHTML()));
  r.querySelector("#rj-end-dialog")?.remove();
  r.insertAdjacentHTML("beforeend", dialogHTML());
  bindChrome();
}

function fragment(html) {
  const template = document.createElement("template");
  template.innerHTML = html;
  return template.content;
}

function bindChrome() {
  const r = root();
  r.querySelector(".rj-header [data-lang]").onclick = switchLanguage;
  r.querySelector("[data-end-visit]").onclick = () => {
    const dialog = $("#rj-end-dialog");
    if (dialog?.showModal) dialog.showModal();
    else endSession(t("room.ended"));
  };
  r.querySelector("[data-end-confirm]").onclick = () => {
    $("#rj-end-dialog")?.close();
    endSession(t("room.ended"));
  };
  r.querySelector("[data-end-cancel]").onclick = () => $("#rj-end-dialog")?.close();
}

/** A calm notice under the header (never blocks the screen); errors are announced as alerts. */
function showBanner(text, kind = "info") {
  if (!text) return;
  const box = $("#rj-banner");
  if (!box) {
    root()?.querySelector(".sd-room-card")?.insertAdjacentHTML("afterbegin", `<p class="sd-notice error" role="alert">${esc(text)}</p>`);
    return;
  }
  box.innerHTML = `<div class="rj-banner-inner ${kind === "error" ? "error" : "info"}"${kind === "error" ? ' role="alert"' : ""}><p>${esc(text)}</p><button class="sd-ghost" data-dismiss>${esc(t("rj.dismiss"))}</button></div>`;
  box.querySelector("[data-dismiss]").onclick = clearBanner;
}

function clearBanner() {
  const box = $("#rj-banner");
  if (box) box.innerHTML = "";
}

/** A function that also reads as the current language code (ctx.lang() or `${ctx.lang}`). */
const ctxLang = Object.assign(() => lang(), { toString: () => lang(), [Symbol.toPrimitive]: () => lang() });

function makeCtx() {
  return {
    journey: state.journey,
    act: (name, body) => act(name, body),
    upload: (view, blob) => uploadImage(view, blob),
    event: (name, props) => sendEvent(name, props),
    t,
    lang: ctxLang,
    markActivity: () => state.mark?.(),
    main: main(),
    session: state.session,
    refresh: () => refresh(),
    rerender: () => renderState(),
  };
}

function setJourney(journey) {
  state.journey = journey;
  if (state.ctx) {
    state.ctx.journey = journey;
    state.ctx.session = state.session;
  }
}

/** Entry succeeded, or the page was reloaded with a live room session. */
async function startJourney() {
  stopPolling();
  leaveJourney();
  watchActivity(state.session?.idle_minutes);
  shell();
  main().innerHTML = loadingHTML();
  state.ctx = makeCtx();
  restoreUrgent();
  if (await loadJourney()) renderState();
}

/** GET room/journey in the current language. Resolves the journey, or null when the visit
 * is over (the entry view is showing). Other failures, by `onError`: "screen" replaces the
 * screen with a Try again card, "banner" keeps the screen and explains, "throw" rejects. */
async function loadJourney({ onError = "screen" } = {}) {
  const run = state.run;
  try {
    const result = await sedens("room/journey?lang=" + lang());
    if (run !== state.run) return null;
    setJourney(result.journey);
    return result.journey;
  } catch (error) {
    if (run !== state.run) return null;
    if (await leaveIfOver(error)) return null;
    if (onError === "throw") throw error;
    if (onError === "banner") showBanner(problem(error), "error");
    else failedScreen();
    return null;
  }
}

/** ctx.refresh(): read the journey again (a scan poll, a consent decision). Redraws when the
 * state changed. Rejects on a network or server failure so the caller can say "reconnecting";
 * resolves null when the visit is over. Never counts as activity. */
async function refresh() {
  const before = state.journey?.state;
  const journey = await loadJourney({ onError: "throw" });
  if (journey && journey.state !== before) renderState();
  return journey;
}

/** POST room/journey/<name> with {expect, lang, ...body}.
 * - Accepted: the new state is drawn (or the mounted player updated); resolves {journey, notice}.
 * - The visit ended, or the server moved on (409): the shell shows the right screen and
 *   resolves {journey: what is now shown (null at entry), notice: null}.
 * - Anything else leaves the state as it was: the banner explains, and the promise rejects
 *   (error.shown = true) so the screen that asked can restore its controls. */
async function act(name, body = {}) {
  const run = state.run;
  setBusy(true);
  try {
    const result = await sedens("room/journey/" + name, { expect: state.journey?.state, lang: lang(), ...body });
    if (run !== state.run) return { journey: null, notice: null };
    if (result.ended) {
      stopPolling();
      state.session = null;
      rememberUrgent(null);
      await entryView(t("room.ended"));
      return { journey: null, notice: null };
    }
    state.mark?.(true);
    if (!result.journey) {
      if (await loadJourney()) renderState();
      return { journey: run === state.run ? state.journey : null, notice: null };
    }
    clearBanner();
    const notice = result.notice || null;
    state.notice = notice ? { ...notice, state: result.journey.state } : null;
    setJourney(result.journey);
    renderState();
    if (notice) showBanner(J.bannerText(notice, main()?.textContent), "info");
    return { journey: result.journey, notice };
  } catch (error) {
    if (run !== state.run) return { journey: null, notice: null };
    if (await handleError(error)) return { journey: run === state.run ? state.journey : null, notice: null };
    if (error && typeof error === "object") error.shown = true;
    throw error;
  } finally {
    if (run === state.run) setBusy(false);
  }
}

/** The shell's own buttons: act() and forget (the banner has already explained a failure). */
const go = (name, body) => act(name, body).catch(() => null);

/** One scan photo (raw JPEG or PNG). Rejects on failure so the scan screen can offer a retake. */
async function uploadImage(view, blob) {
  try {
    const result = await uploadFile("room/scan/image", blob, { view });
    state.mark?.(true);
    return result;
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || ENDED_CODES.includes(error.code) || ROOM_DENIALS.includes(error.code))) {
      await handleError(error);
    }
    throw error;
  }
}

/** Client analytics: listed names, snake_case keys and short codes only. Never breaks the screen. */
function sendEvent(name, props = {}) {
  if (!J.CLIENT_EVENTS.includes(name)) return Promise.resolve(false);
  return sedens("room/event", { name, props: J.safeProps(props) }).then(() => true, () => false);
}

function problem(error) {
  const key = J.errorKey(error);
  if (key) return t(key);
  return lang() === "en" && error?.message ? error.message : t("rj.err_generic");
}

/** The visit is over (ended, expired, idle) or this screen may no longer serve it: show the
 * entry view (or re-read the device) and say so. True when the screen was left. */
async function leaveIfOver(error) {
  if (!(error instanceof ApiError)) return false;
  if (ENDED_CODES.includes(error.code)) {
    stopPolling();
    state.session = null;
    rememberUrgent(null);
    await entryView(endedMessage(error));
    return true;
  }
  if (error.status === 401 || ROOM_DENIALS.includes(error.code)) {
    // The visit on screen is gone (ended in another window, or the cookie was cleared):
    // the entry view says so; a device problem shows its own screen.
    await render({ gone: error.code === "room_session_required" ? t("room.ended") : "" });
    return true;
  }
  return false;
}

/** A refused or failed act(). True when the shell moved the screen (entry, or the state the
 * server holds after a 409); false when the screen stays and only the banner explains. */
async function handleError(error) {
  if (await leaveIfOver(error)) return true;
  if (error instanceof ApiError && error.status === 409 && J.RESYNC_CODES.includes(error.code)) {
    const run = state.run;
    if (await loadJourney()) renderState();
    if (run === state.run) showBanner(problem(error), "info");
    return true;
  }
  showBanner(problem(error), "error");
  return false;
}

function failedScreen() {
  const m = main();
  if (!m) return;
  release(null);
  state.owner = null;
  state.viewed = null;
  m.dataset.owner = "shell";
  m.innerHTML = `<section class="rj-screen rj-center"><h1 class="rj-title">${esc(t("rj.load_failed"))}</h1><div class="rj-actions"><button class="sd-primary sd-large" data-retry>${esc(t("rj.retry"))}</button></div></section>`;
  m.querySelector("[data-retry]").onclick = async () => {
    m.innerHTML = loadingHTML();
    if (await loadJourney()) renderState();
  };
  focusTitle();
}

function setBusy(on) {
  state.busy = on;
  const m = main();
  if (!m) return;
  m.setAttribute("aria-busy", on ? "true" : "false");
  if (state.owner !== "shell") return;
  m.querySelectorAll("button").forEach((b) => (b.disabled = on));
}

/** Stop what the previous owner left running when the screen passes to `next`: the camera
 * when the scan screens are left, the player when training is left. */
function release(next) {
  const previous = state.owner;
  if ((previous === "scan" || previous === "scan_result") && next !== previous) {
    try {
      stopScan();
    } catch (error) {
      console.error(error);
    }
  }
  if (state.player && next !== "player") {
    try {
      state.player.destroy();
    } catch (error) {
      console.error(error);
    }
    state.player = null;
  }
}

/** Draw the current state. The player stays mounted while the state stays in training.
 * focus: move focus to the new screen's heading (not when only the language changed). */
function renderState({ focus = true } = {}) {
  const j = state.journey;
  const m = main();
  if (!j || !m) return;
  const owner = J.ownerOf(j.state);
  const previous = state.owner;
  release(owner);
  if (owner === "ended") {
    endSession(t("room.ended"));
    return;
  }
  if (owner !== previous) {
    m.replaceChildren();
    m.removeAttribute("aria-busy");
  }
  state.owner = owner;
  m.dataset.owner = owner || "shell";
  m.dataset.state = j.state;
  if (j.state !== "session_setup") state.setup.notice = "";
  const changed = state.viewed !== j.state;
  if (changed) {
    state.viewed = j.state;
    sendEvent("room_screen_viewed", { screen: j.state });
  }
  try {
    if (owner === "scan") renderScan(state.ctx);
    else if (owner === "scan_result") renderScanResult(state.ctx);
    else if (owner === "player") {
      if (state.player) state.player.update(state.ctx);
      else state.player = mountPlayer(state.ctx);
    } else if (owner === "shell") {
      SCREENS[j.state](j);
      if (focus) focusTitle();
      else document.title = (main().querySelector("h1")?.textContent.trim().slice(0, 80) || "SEDENS") + " · SEDENS";
    } else unknownScreen();
  } catch (error) {
    console.error(error);
    showBanner(t("rj.err_generic"), "error");
  }
}

function focusTitle() {
  const h1 = main()?.querySelector("h1");
  if (!h1) return;
  h1.setAttribute("tabindex", "-1");
  h1.focus({ preventScroll: true });
  window.scrollTo?.({ top: 0 });
  document.title = h1.textContent.trim().slice(0, 80) + " · SEDENS";
}

/** The language button after entry: the server sends its copy again in the new language;
 * the mounted player is updated in place, any other screen is drawn again. */
async function switchLanguage() {
  setLang(lang() === "ko" ? "en" : "ko");
  paintChrome();
  clearBanner();
  root().querySelector(".rj-header [data-lang]")?.focus();
  const journey = await loadJourney({ onError: "banner" });
  if (!journey) return;
  if (state.player && J.ownerOf(journey.state) === "player") {
    try {
      state.player.update(state.ctx);
    } catch (error) {
      console.error(error);
    }
  } else renderState({ focus: false });
}

const loadingHTML = () => `<section class="rj-screen rj-center" aria-busy="true"><p class="sd-lead" role="status">${esc(t("rj.loading"))}</p></section>`;

function unknownScreen() {
  main().innerHTML = `<section class="rj-screen rj-center"><h1 class="rj-title">${esc(t("rj.unknown_state"))}</h1><div class="rj-actions"><button class="sd-primary sd-large" data-retry>${esc(t("rj.retry"))}</button></div></section>`;
  main().querySelector("[data-retry]").onclick = async () => {
    if (await loadJourney()) renderState();
  };
  focusTitle();
}

/** Put a screen's HTML in <main> and wire the common controls. */
function draw(html) {
  const m = main();
  m.innerHTML = html;
  m.querySelectorAll("[data-act]").forEach((b) => (b.onclick = () => go(b.dataset.act)));
  m.querySelectorAll("[data-end]").forEach((b) => (b.onclick = () => endSession(t("room.ended"))));
  return m;
}

const sessionLabel = (next) => [next?.module_title, next?.session_title].filter(Boolean).join(" · ");
const minutesText = (minutes) => (J.minutesValue(minutes) ? t("rj.min", { n: J.minutesValue(minutes) }) : t("rj.under_minute"));
const endButton = (primary = true) => `<button class="${primary ? "sd-primary " : ""}sd-large" data-end>${esc(t("rj.end_visit"))}</button>`;

function urgentCard(title, body, heading = "h1") {
  return `<section class="rj-urgent" role="alert"><${heading} class="rj-urgent-title">${esc(title)}</${heading}><p class="rj-urgent-body">${esc(body)}</p><p class="rj-119"><span class="rj-119-number">119</span><span>${esc(t("rj.call_119"))}</span></p><p>${esc(t("rj.ask_staff"))}</p></section>`;
}

// -- identified -------------------------------------------------------------------------------

function welcomeScreen(j) {
  const s = state.session || {};
  const w = j.welcome || {};
  const p = w.passport || {};
  const when = w.booking?.starts_at && w.booking?.ends_at
    ? t("rj.booking", { start: time(w.booking.starts_at), end: time(w.booking.ends_at) })
    : s.expires_at ? t("rj.open_until", { time: time(s.expires_at) }) : "";
  // The Passport's own count of completed visits when the server gives it, so both screens agree.
  const visits = p.completed_visits ?? p.visits;
  const lastVisit = p.completed_visits !== undefined ? p.last_completed_visit : p.last_visit;
  const passport = visits > 0
    ? lastVisit ? t("rj.passport_visits", { count: visits, date: date(lastVisit) }) : t("rj.passport_count", { count: visits })
    : t("rj.passport_first");
  const courses = Array.isArray(w.courses) ? w.courses : [];
  const followed = courses.filter((c) => c.enrolled && c.progress);
  const others = courses.filter((c) => !(c.enrolled && c.progress));
  const programs = followed
    .map((c) => `<li><strong>${esc(c.title)}</strong><span>${esc(c.progress.next ? t("rj.program_next", { session: sessionLabel(c.progress.next) }) : t("rj.program_finished"))}</span><span class="sd-muted">${esc(t("rj.program_progress", { done: c.progress.done || 0, total: c.progress.total || 0 }))}</span></li>`)
    .join("");
  const titles = others.map((c) => `<li>${esc(c.title)}</li>`).join("");
  const also = !others.length ? "" : programs
    ? `<p class="sd-muted">${esc(t("rj.also_here", { courses: others.map((c) => c.title).join(", ") }))}</p>`
    : `<ul class="rj-course-names">${titles}</ul>`;
  draw(`<section class="rj-screen rj-welcome">
    <div class="rj-welcome-main">
      <p class="sd-eyebrow">${esc(t("rj.welcome_eyebrow", { room: s.room?.name || "", facility: s.facility?.name || "" }))}</p>
      <h1 class="rj-hello">${esc(t("room.session_title", { name: s.customer?.first_name || "" }))}</h1>
      <p class="sd-lead">${esc(t("rj.welcome_lead"))}</p>
      ${when ? `<p class="rj-meta">${esc(when)}</p>` : ""}
      <div class="rj-actions rj-primary-actions"><button class="sd-primary sd-large rj-go" data-act="readiness/start">${esc(t("rj.start"))}</button></div>
      <p class="sd-muted">${esc(t("rj.start_hint"))}</p>
    </div>
    <div class="rj-welcome-side">
      <section class="rj-card"><h2>${esc(t("rj.visit_title"))}</h2><ol class="rj-visit-steps"><li>${esc(t("rj.visit_check"))}</li><li>${esc(t("rj.visit_scan"))}</li><li>${esc(t("rj.visit_session"))}</li></ol></section>
      <section class="rj-card"><h2>${esc(t("rj.passport_title"))}</h2><p>${esc(passport)}</p></section>
      ${programs || also ? `<section class="rj-card"><h2>${esc(t(programs ? "rj.programs_title" : "rj.courses_here"))}</h2>${programs ? `<ul class="rj-programs">${programs}</ul>` : ""}${also}</section>` : ""}
    </div>
  </section>`);
}

// -- readiness --------------------------------------------------------------------------------

function readinessScreen(j) {
  const r = j.readiness || {};
  const next = r.next;
  if (!next) return unknownScreen();
  const total = r.total || 0;
  const n = next.position || (r.answered || 0) + 1;
  const done = total ? Math.max(0, Math.min(100, Math.round(((n - 1) / total) * 100))) : 0;
  const intro = (r.answered || 0) === 0 && !next.follow_up && r.intro ? `<p class="sd-lead rj-intro">${esc(r.intro)}</p>` : "";
  const count = t("rj.readiness_count", { n, total });
  const m = draw(`<section class="rj-screen rj-readiness">
    <p class="sd-eyebrow">${esc(t("rj.readiness_eyebrow"))} · ${esc(count)}${next.follow_up ? ` · ${esc(t("rj.readiness_more"))}` : ""}</p>
    <div class="rj-progress" aria-hidden="true"><span style="width:${done}%"></span></div>
    ${intro}
    <h1 class="rj-question" id="rj-question">${esc(next.question)}</h1>
    <div class="rj-yesno" role="group" aria-labelledby="rj-question">
      <button class="rj-answer sd-large" data-answer="yes">${esc(t("rj.yes"))}</button>
      <button class="rj-answer sd-large" data-answer="no">${esc(t("rj.no"))}</button>
    </div>
    ${next.why ? `<details class="rj-why-ask"><summary>${esc(t("rj.why_ask"))}</summary><p>${esc(next.why)}</p></details>` : ""}
  </section>`);
  m.querySelectorAll("[data-answer]").forEach((b) => (b.onclick = () => {
    const yes = b.dataset.answer === "yes";
    go("readiness/answer", next.follow_up ? { item: next.item, follow_up: yes } : { item: next.item, answer: yes });
  }));
}

function blockedScreen(j) {
  const r = j.readiness || {};
  const result = r.result || {};
  if (r.outcome === "urgent_help") {
    draw(`<section class="rj-screen rj-blocked">${urgentCard(result.title || t("rj.urgent_title"), result.body || "")}<div class="rj-actions">${endButton(false)}</div></section>`);
    return;
  }
  draw(`<section class="rj-screen rj-blocked">
    <div class="rj-card rj-calm">
      <p class="sd-eyebrow">${esc(t("rj.blocked_eyebrow"))}</p>
      <h1 class="rj-title">${esc(result.title || "")}</h1>
      ${result.body ? `<p class="sd-lead">${esc(result.body)}</p>` : ""}
      ${result.next_action ? `<p class="rj-next-action">${esc(result.next_action)}</p>` : ""}
      ${result.small ? `<p class="sd-muted">${esc(result.small)}</p>` : ""}
      ${result.emergency ? `<p class="rj-emergency">${esc(result.emergency)}</p>` : ""}
    </div>
    <p class="sd-muted">${esc(t("rj.blocked_hint"))}</p>
    <div class="rj-actions">${endButton(true)}</div>
  </section>`);
}

// -- session choice ---------------------------------------------------------------------------

function reasonBadge(reason) {
  if (reason === "entitled") return `<span class="sd-badge ok">${esc(t("rj.reason_entitled"))}</span>`;
  if (reason === "free_here") return `<span class="sd-badge ok">${esc(t("rj.reason_free_here"))}</span>`;
  return "";
}

function courseCard(course, primary) {
  const progress = course.enrolled ? course.progress : null;
  const next = progress?.next || null;
  const finished = Boolean(progress && !next);
  const badges = `${course.featured ? `<span class="sd-badge info">${esc(t("rj.featured"))}</span>` : ""}${reasonBadge(course.reason)}`;
  const line = next ? `${sessionLabel(next)} · ${t("rj.session_of", { n: J.nextSessionNumber(progress), total: progress.total })}` : finished ? t("rj.course_done") : "";
  const minutes = next?.estimated_minutes ? t("rj.about_minutes", { n: next.estimated_minutes }) : "";
  const button = finished
    ? ""
    : `<button class="${primary ? "sd-primary " : ""}sd-large" data-course="${esc(course.course_id)}"${next ? ` data-session="${esc(next.session_id)}"` : ""}>${esc(t(next ? "rj.start_next" : "rj.start_course"))}</button>`;
  return `<article class="rj-option"><div class="rj-badges">${badges}</div><h3>${esc(course.title)}</h3>${line ? `<p>${esc(line)}</p>` : ""}${minutes ? `<p class="sd-muted">${esc(minutes)}</p>` : ""}${button}</article>`;
}

function choiceScreen(j) {
  const { resume, others, personalized } = J.choicePaths(j.choice);
  let hero = "";
  if (resume) {
    const next = resume.progress.next;
    hero = `<article class="rj-hero"><p class="sd-eyebrow">${esc(t("rj.resume_eyebrow"))}</p><h2 class="rj-hero-title">${esc(resume.title)}</h2><p class="rj-hero-line">${esc(sessionLabel(next))}</p><p class="sd-muted">${esc(t("rj.session_of", { n: J.nextSessionNumber(resume.progress), total: resume.progress.total }))}${next.estimated_minutes ? " · " + esc(t("rj.about_minutes", { n: next.estimated_minutes })) : ""}</p><div class="rj-actions"><button class="sd-primary sd-large rj-go" data-course="${esc(resume.course_id)}" data-session="${esc(next.session_id)}">${esc(t("rj.continue"))}</button></div></article>`;
  } else if (personalized) {
    hero = personalCard(true);
  }
  const firstPrimary = !hero;
  const courses = others.length
    ? `<section class="rj-section"><h2>${esc(t(resume ? "rj.others_title" : "rj.courses_here"))}</h2><div class="rj-options">${others.map((c, i) => courseCard(c, firstPrimary && i === 0)).join("")}</div></section>`
    : "";
  const personal = personalized && resume ? `<section class="rj-section">${personalCard(false)}</section>` : "";
  const empty = !hero && !others.length ? `<p class="sd-notice">${esc(t("rj.choice_empty"))}</p><div class="rj-actions">${endButton(true)}</div>` : "";
  const m = draw(`<section class="rj-screen rj-session-choice">
    <p class="sd-eyebrow">${esc(t("rj.choice_eyebrow"))}</p>
    <h1 class="rj-title">${esc(t("rj.choice_title"))}</h1>
    ${hero}${courses}${personal}${empty}
  </section>`);
  m.querySelectorAll("[data-course]").forEach((b) => (b.onclick = () => {
    const body = { course_id: b.dataset.course };
    if (b.dataset.session) body.session_id = b.dataset.session;
    go("course/start", body);
  }));
  m.querySelectorAll("[data-personal]").forEach((b) => (b.onclick = () => go("plan/personalized")));
}

function personalCard(hero) {
  const title = hero ? `<h2 class="rj-hero-title">${esc(t("rj.personal_title"))}</h2>` : `<h3>${esc(t("rj.personal_title"))}</h3>`;
  const button = `<button class="${hero ? "sd-primary rj-go " : ""}sd-large" data-personal>${esc(t("rj.personal_start"))}</button>`;
  return `<article class="${hero ? "rj-hero" : "rj-option rj-option-wide"}"><p class="sd-eyebrow">${esc(t("rj.personal_eyebrow"))}</p>${title}<p class="${hero ? "rj-hero-line" : ""}">${esc(t("rj.personal_body"))}</p><div class="rj-actions">${button}</div></article>`;
}

// -- session setup ----------------------------------------------------------------------------

function setupScreen(j) {
  const s = j.setup || {};
  const pick = state.setup;
  const goals = Array.isArray(s.goals) ? s.goals : [];
  const efforts = Array.isArray(s.intensities) ? s.intensities : [];
  const durations = Array.isArray(s.durations) && s.durations.length ? s.durations : [30, 60];
  if (!durations.includes(pick.duration)) pick.duration = durations[0];
  if (!goals.some((g) => g.id === pick.goal)) pick.goal = null;
  if (!efforts.some((e) => e.id === pick.intensity)) pick.intensity = null;
  if (state.notice?.state === "session_setup" && state.notice.text) {
    pick.notice = state.notice.text;
    state.notice = null;
  }
  const choice = (name, value, title, description, big = false) =>
    `<label class="rj-pick${big ? " rj-pick-big" : ""}"><input type="radio" name="${name}" value="${esc(value)}"${String(pick[name]) === String(value) ? " checked" : ""}><span class="rj-pick-title">${esc(title)}</span>${description ? `<span class="rj-pick-desc">${esc(description)}</span>` : ""}</label>`;
  const m = draw(`<section class="rj-screen rj-setup">
    <p class="sd-eyebrow">${esc(t("rj.personal_title"))}${s.label ? ` <span class="sd-badge">${esc(s.label)}</span>` : ""}</p>
    <h1 class="rj-title">${esc(t("rj.setup_title"))}</h1>
    <form id="rj-setup" class="rj-setup-form" novalidate>
      <fieldset class="rj-group rj-group-duration"><legend>${esc(t("rj.setup_duration"))}</legend><div class="rj-picks rj-two">${durations.map((d) => choice("duration", d, t("rj.minutes", { n: d }), "", true)).join("")}</div></fieldset>
      <fieldset class="rj-group rj-group-effort"><legend>${esc(t("rj.setup_effort"))}</legend><div class="rj-picks rj-two">${efforts.map((e) => choice("intensity", e.id, e.label, e.description)).join("")}</div>${s.intensity_footer ? `<p class="sd-muted">${esc(s.intensity_footer)}</p>` : ""}</fieldset>
      <fieldset class="rj-group rj-group-goal"><legend>${esc(t("rj.setup_goal"))}</legend><div class="rj-picks rj-goals">${goals.map((g) => choice("goal", g.id, g.label, g.description)).join("")}</div></fieldset>
      <p class="rj-inline-notice" id="rj-setup-notice" role="status"${pick.notice ? "" : " hidden"}>${esc(pick.notice || "")}</p>
      <div class="rj-actions rj-setup-actions"><button class="sd-primary sd-large rj-go" type="submit">${esc(t("rj.setup_submit"))}</button><button class="sd-large" type="button" data-act="plan/back">${esc(t("rj.back"))}</button></div>
    </form>
  </section>`);
  const form = m.querySelector("#rj-setup");
  form.addEventListener("change", (event) => {
    const input = event.target;
    if (input.name === "duration") pick.duration = Number(input.value);
    else if (input.name) pick[input.name] = input.value;
    const note = m.querySelector("#rj-setup-notice");
    if (pick.goal && pick.intensity && note.dataset.kind === "missing") {
      note.hidden = true;
      note.textContent = "";
      delete note.dataset.kind;
    }
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!pick.goal || !pick.intensity) {
      const note = m.querySelector("#rj-setup-notice");
      note.textContent = t("rj.setup_missing");
      note.dataset.kind = "missing";
      note.hidden = false;
      note.setAttribute("role", "alert");
      m.querySelector(!pick.intensity ? "[name=intensity]" : "[name=goal]")?.focus();
      return;
    }
    pick.notice = "";
    go("plan/request", { goal: pick.goal, duration: pick.duration, intensity: pick.intensity });
  });
}

// -- recommendation ---------------------------------------------------------------------------

function recommendationScreen(j) {
  const rec = j.recommendation;
  if (!rec) return unknownScreen();
  const minutes = rec.phase_minutes || {};
  const phases = ["warm_up", "main", "cool_down"].filter((p) => minutes[p] > 0);
  const bar = phases.map((p) => `<span class="rj-bar-${p}" style="flex-grow:${Math.max(1, minutes[p])}"></span>`).join("");
  const legend = phases
    .map((p) => `<li><span class="rj-dot rj-bar-${p}" aria-hidden="true"></span><span>${esc(t("rj.phase_" + p))}</span><strong>${esc(t("rj.min", { n: minutes[p] }))}</strong></li>`)
    .join("");
  let count = 0;
  const groups = J.stepsByPhase(rec.steps)
    .map((g) => {
      const start = count + 1;
      count += g.steps.length;
      return `<section class="rj-plan-phase"><h3>${esc(t("rj.phase_" + g.phase))}${minutes[g.phase] ? ` <span class="rj-plan-min">${esc(t("rj.min", { n: minutes[g.phase] }))}</span>` : ""}</h3><ol class="rj-plan-steps" start="${start}">${g.steps
        .map((s) => `<li><span class="rj-step-title">${esc(s.title)}</span>${s.sets > 1 ? ` <span class="rj-step-sets">${esc(t("rj.sets", { n: s.sets }))}</span>` : ""}${s.scan_rule ? ` <span class="rj-tag">${esc(t("rj.from_scan"))}</span>` : ""}</li>`)
        .join("")}</ol></section>`;
    })
    .join("");
  const reasons = (rec.reasons || []).map((r) => `<li>${esc(r)}</li>`).join("");
  const sub = [rec.goal, rec.intensity, rec.estimated_minutes ? t("rj.rec_about", { n: rec.estimated_minutes }) : ""].filter(Boolean).join(" · ");
  const m = draw(`<section class="rj-screen rj-rec">
    <div class="rj-rec-side">
      <p class="sd-eyebrow">${esc(t("rj.rec_eyebrow"))}</p>
      <h1 class="rj-title">${esc(rec.label || t("rj.personal_title"))}</h1>
      <p class="sd-lead">${esc(sub)}</p>
      ${rec.content_label ? `<p><span class="sd-badge rj-content-label">${esc(rec.content_label)}</span></p>` : ""}
      ${rec.shorter && rec.shorter_text ? `<p class="rj-inline-notice rj-shorter">${esc(rec.shorter_text)}</p>` : ""}
      ${bar ? `<div class="rj-timeline"><div class="rj-bar" aria-hidden="true">${bar}</div><ul class="rj-legend">${legend}</ul></div>` : ""}
      <div class="rj-actions rj-rec-actions"><button class="sd-primary sd-large rj-go" data-accept>${esc(t("rj.accept"))}</button><button class="sd-large" data-why aria-haspopup="dialog">${esc(t("rj.why"))}</button><button class="sd-large" data-act="plan/change">${esc(t("rj.change"))}</button><button class="sd-large sd-ghost" data-act="plan/back">${esc(t("rj.back"))}</button></div>
    </div>
    <div class="rj-rec-plan">
      <h2>${esc(t("rj.exercises", { n: (rec.steps || []).length }))}</h2>
      <div class="rj-plan">${groups}</div>
    </div>
    <dialog class="rj-dialog rj-why-dialog" id="rj-why" aria-labelledby="rj-why-title">
      <h2 id="rj-why-title">${esc(t("rj.why"))}</h2>
      <ul class="rj-reasons">${reasons}</ul>
      <p class="sd-muted rj-versions">${esc(t("rj.versions", { rules: String(rec.rules_version || "").replace(/^sedens-recommend-/, ""), library: rec.library_version || "" }))}</p>
      <div class="rj-actions"><button class="sd-primary sd-large" data-why-close>${esc(t("rj.close"))}</button></div>
    </dialog>
  </section>`);
  m.querySelector("[data-accept]").onclick = () => go("plan/accept", { recommendation: rec.id });
  const dialog = m.querySelector("#rj-why");
  const why = m.querySelector("[data-why]");
  why.onclick = () => (dialog.showModal ? dialog.showModal() : dialog.setAttribute("open", ""));
  m.querySelector("[data-why-close]").onclick = () => (dialog.close ? dialog.close() : dialog.removeAttribute("open"));
  dialog.addEventListener("close", () => why.focus());
}

// -- session complete -------------------------------------------------------------------------

function restoreUrgent() {
  try {
    state.urgent = sessionStorage.getItem(URGENT_KEY);
  } catch {
    state.urgent = null;
  }
}

function rememberUrgent(workoutId) {
  state.urgent = workoutId;
  try {
    if (workoutId) sessionStorage.setItem(URGENT_KEY, workoutId);
    else sessionStorage.removeItem(URGENT_KEY);
  } catch {
    // The urgent card still shows for this page.
  }
}

function completeScreen(j) {
  const w = j.workout || {};
  const sum = w.summary || {};
  const stopped = sum.outcome === "stopped" || J.safetyStopped(w);
  const urgentAfter = Boolean(w.feedback_saved && state.urgent && state.urgent === w.id);
  const safety = w.safety
    ? J.urgentStop(w)
      ? urgentCard(w.safety.title || t("rj.urgent_title"), w.safety.body || "")
      : `<section class="rj-stopped" role="status"><h1 class="rj-title">${esc(w.safety.title || t("rj.stopped_title"))}</h1><p class="sd-lead">${esc(w.safety.body || "")}</p></section>`
    : "";
  const urgent = urgentAfter ? urgentCard(t("rj.urgent_title"), w.after_feedback || "") : "";
  const titleTag = safety || urgent ? "h2" : "h1";
  const steps = sum.steps || {};
  const rows = [
    [t("rj.sum_duration"), minutesText(sum.duration_minutes)],
    [t("rj.sum_active"), minutesText(sum.active_minutes)],
    [t("rj.sum_exercises"), t("rj.sum_done_of", { done: steps.completed || 0, total: steps.total || 0 }) + (steps.skipped ? ` · ${t("rj.sum_skipped", { n: steps.skipped })}` : "")],
    sum.focus ? [t(sum.kind === "course" ? "rj.sum_session" : "rj.sum_goal"), sum.focus] : null,
    sum.intensity ? [t("rj.sum_effort"), sum.intensity] : null,
    sum.course_progress ? [t("rj.sum_course"), t("rj.sum_course_of", { done: sum.course_progress.completed, total: sum.course_progress.total })] : null,
  ].filter(Boolean);
  const pending = Boolean(w.feedback && !w.feedback_saved);
  if (!pending) state.fb = null;
  else if (state.fb?.id !== w.id) state.fb = { id: w.id, step: "effort", effort: null, discomfort: null, urgent: null, regions: [], when: null, strength: null, still: null, note: "" };
  const after = w.feedback_saved && w.after_feedback && !urgentAfter ? `<section class="rj-card rj-after"><p class="sd-lead">${esc(w.after_feedback)}</p></section>` : "";
  // What happens next time, once the answers are saved: the program being followed and its next session; a personalized
  // session says plainly that it is kept in the Passport and does not move a program.
  const upcoming = w.feedback_saved && !urgentAfter && !J.safetyStopped(w)
    ? `${w.next_up ? `<p class="rj-next-time">${esc(t("rj.next_time", { program: w.next_up.program, session: w.next_up.session }))}</p>` : ""}${w.kind === "standard" ? `<p class="sd-muted rj-personal-note">${esc(t("rj.personal_note"))}</p>` : ""}`
    : "";
  // The server refuses another session after a safety stop; an early end is not one.
  const another = !urgentAfter && !J.safetyStopped(w);
  const actions = pending ? "" : `<div class="rj-actions rj-complete-actions">${endButton(true)}${another ? `<button class="sd-large" data-act="workout/another">${esc(t("rj.another"))}</button>` : ""}</div>`;
  const m = draw(`<section class="rj-screen rj-complete">
    ${safety}${urgent}
    <header class="rj-complete-head">
      <p class="sd-eyebrow">${esc(t(stopped ? "rj.stopped_eyebrow" : "rj.done_eyebrow"))}</p>
      <${titleTag} class="rj-title">${esc(sum.title || w.title || "")}</${titleTag}>
      ${!stopped && !urgentAfter ? `<p class="sd-lead">${esc(t("rj.done_lead"))}</p>` : ""}
    </header>
    <dl class="rj-summary">${rows.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join("")}</dl>
    <p class="sd-muted rj-saved">${esc(t(stopped ? "rj.saved_incomplete" : "rj.saved"))}</p>
    ${pending ? `<section class="rj-card rj-feedback" id="rj-feedback" aria-live="polite"></section>` : ""}
    ${after}${upcoming ? `<section class="rj-card rj-upcoming">${upcoming}</section>` : ""}${actions}
  </section>`);
  if (pending) feedbackStep(w, m.querySelector("#rj-feedback"), false);
}

/** One feedback question at a time: effort, discomfort, (urgent), details, note. */
function feedbackStep(w, box, focus = true) {
  const q = w.feedback;
  const fb = state.fb;
  const e = q.effort || {};
  const d = q.discomfort || {};
  const pressed = (field, id) => (field === "regions" ? fb.regions.includes(id) : field === "still" ? fb.still !== null && fb.still === (id === "yes") : fb[field] === id);
  const back = (to) => `<button class="sd-ghost rj-back" data-back="${to}">← ${esc(t("rj.back"))}</button>`;
  const yesNo = (name) => `<div class="rj-yesno" role="group" aria-labelledby="rj-fb-q"><button class="rj-answer sd-large" data-${name}="yes">${esc(t("rj.yes"))}</button><button class="rj-answer sd-large" data-${name}="no">${esc(t("rj.no"))}</button></div>`;
  let html = "";
  if (fb.step === "effort") {
    const labels = J.effortLabels(e.labels);
    const bands = J.effortBands(e.labels);
    html = `<p class="sd-eyebrow">${esc(t("rj.fb_eyebrow"))}</p><h2 id="rj-fb-q" class="rj-fb-question">${esc(e.question || "")}</h2>${e.helper ? `<p class="sd-muted">${esc(e.helper)}</p>` : ""}
      <div class="rj-effort"><div class="rj-effort-scale" role="group" aria-labelledby="rj-fb-q">${labels
        .map((label, n) => `<button class="rj-effort-button" data-effort="${n}" aria-pressed="${fb.effort === n}" aria-label="${esc(label ? `${n} — ${label}` : String(n))}"><span class="rj-effort-n">${n}</span><span class="rj-effort-l">${esc(label)}</span></button>`)
        .join("")}</div><div class="rj-effort-bands" aria-hidden="true">${bands
        .map((b) => `<span style="grid-column:${b.from + 1} / span ${b.span}">${esc(b.text)}</span>`)
        .join("")}</div></div>
      ${e.footnote ? `<p class="sd-muted rj-footnote">${esc(e.footnote)}</p>` : ""}
      <div class="rj-actions"><button class="sd-large sd-ghost" data-effort-skip>${esc(e.skip || t("rj.fb_next"))}</button></div>`;
  } else if (fb.step === "discomfort") {
    html = `${back("effort")}<h2 id="rj-fb-q" class="rj-fb-question">${esc(d.question || "")}</h2>${d.helper ? `<p class="sd-muted">${esc(d.helper)}</p>` : ""}${yesNo("discomfort")}`;
  } else if (fb.step === "urgent") {
    html = `${back("discomfort")}<h2 id="rj-fb-q" class="rj-fb-question">${esc(d.urgent_question || "")}</h2>${yesNo("urgent")}`;
  } else if (fb.step === "details") {
    const chips = (field, options, multi, label) => `<div class="rj-chips" role="group" aria-labelledby="${label}">${(options || [])
      .map((o) => `<button class="rj-chip" data-field="${field}" data-value="${esc(o.id)}" data-multi="${multi}" aria-pressed="${pressed(field, o.id)}">${esc(o.label)}</button>`)
      .join("")}</div>`;
    const still = [{ id: "yes", label: t("rj.yes") }, { id: "no", label: t("rj.no") }];
    html = `${back("urgent")}<p class="sd-muted">${esc(t("rj.fb_optional"))}</p>
      <h2 id="rj-fb-q" class="rj-fb-sub">${esc(d.regions_question || "")}</h2>${chips("regions", d.regions, true, "rj-fb-q")}
      <h3 id="rj-fb-when" class="rj-fb-sub">${esc(d.when_question || "")}</h3>${chips("when", d.when, false, "rj-fb-when")}
      <h3 id="rj-fb-strength" class="rj-fb-sub">${esc(d.strength_question || "")}</h3>${chips("strength", d.strength, false, "rj-fb-strength")}
      <h3 id="rj-fb-still" class="rj-fb-sub">${esc(d.still_question || "")}</h3>${chips("still", still, false, "rj-fb-still")}
      <div class="rj-actions"><button class="sd-primary sd-large" data-next="note">${esc(t("rj.fb_next"))}</button></div>`;
  } else {
    const left = J.NOTE_MAX - fb.note.length;
    html = `${back(fb.discomfort === "yes" ? "details" : "discomfort")}<label class="sd-field rj-note"><span id="rj-fb-q" class="rj-fb-sub">${esc(q.note_label || "")}</span><textarea name="note" rows="3" maxlength="${J.NOTE_MAX}" aria-describedby="rj-note-left">${esc(fb.note)}</textarea></label><p class="sd-muted" id="rj-note-left">${esc(t("rj.fb_chars", { n: left }))}</p>
      <div class="rj-actions"><button class="sd-primary sd-large rj-go" data-submit>${esc(t("rj.fb_submit"))}</button></div>`;
  }
  box.innerHTML = html;
  const show = (step) => {
    fb.step = step;
    feedbackStep(w, box);
  };
  box.querySelectorAll("[data-back]").forEach((b) => (b.onclick = () => show(b.dataset.back)));
  box.querySelectorAll("[data-effort]").forEach((b) => (b.onclick = () => {
    fb.effort = Number(b.dataset.effort);
    show("discomfort");
  }));
  box.querySelector("[data-effort-skip]")?.addEventListener("click", () => {
    fb.effort = null;
    show("discomfort");
  });
  box.querySelectorAll("[data-discomfort]").forEach((b) => (b.onclick = () => {
    fb.discomfort = b.dataset.discomfort;
    show(fb.discomfort === "yes" ? "urgent" : "note");
  }));
  box.querySelectorAll("[data-urgent]").forEach((b) => (b.onclick = () => {
    fb.urgent = b.dataset.urgent === "yes";
    if (fb.urgent) submitFeedback(w);
    else show("details");
  }));
  box.querySelectorAll(".rj-chip").forEach((b) => (b.onclick = () => {
    const { field, value } = b.dataset;
    if (b.dataset.multi === "true") {
      fb[field] = fb[field].includes(value) ? fb[field].filter((v) => v !== value) : [...fb[field], value];
      b.setAttribute("aria-pressed", String(fb[field].includes(value)));
      return;
    }
    const chosen = field === "still" ? value === "yes" : value;
    fb[field] = fb[field] === chosen ? null : chosen; // a second tap clears an optional answer
    b.parentElement.querySelectorAll(".rj-chip").forEach((c) => c.setAttribute("aria-pressed", String(pressed(field, c.dataset.value))));
  }));
  box.querySelector("[data-next]")?.addEventListener("click", () => show("note"));
  const note = box.querySelector("textarea[name=note]");
  note?.addEventListener("input", () => {
    fb.note = note.value.slice(0, J.NOTE_MAX);
    box.querySelector("#rj-note-left").textContent = t("rj.fb_chars", { n: J.NOTE_MAX - fb.note.length });
  });
  box.querySelector("[data-submit]")?.addEventListener("click", () => submitFeedback(w));
  if (focus) {
    const heading = box.querySelector("#rj-fb-q");
    if (heading?.tagName !== "SPAN") {
      heading?.setAttribute("tabindex", "-1");
      heading?.focus({ preventScroll: false });
    } else note?.focus();
  }
}

/** Save the answers once. An urgent "Yes" is remembered for this workout (this tab only), so
 * after a reload the screen still shows the urgent help card and only End visit. */
async function submitFeedback(w) {
  const body = J.feedbackBody(state.fb);
  if (body.urgent) rememberUrgent(w.id);
  try {
    await act("workout/feedback", body);
  } catch {
    if (body.urgent) rememberUrgent(null); // not saved: the questions stay on screen
  }
}

const SCREENS = {
  identified: welcomeScreen,
  readiness: readinessScreen,
  readiness_blocked: blockedScreen,
  session_choice: choiceScreen,
  session_setup: setupScreen,
  recommendation: recommendationScreen,
  session_complete: completeScreen,
};

/** Read the device and the room session from the server and show what they allow.
 * gone: the message for the entry view when a visit that was on screen no longer exists. */
async function render({ gone = "" } = {}) {
  stopPolling();
  try {
    state.device = await sedens("room/device");
    if (!state.device.paired) return unpairedView();
    try {
      state.session = await sedens("room/session");
      return startJourney();
    } catch (error) {
      if (!(error instanceof ApiError) || error.status >= 500) throw error;
      state.session = null;
      if (gone) rememberUrgent(null);
      return entryView(ENDED_CODES.includes(error.code) ? endedMessage(error) : gone);
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
