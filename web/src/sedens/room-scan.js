// Room scan: consent and the four-view camera wizard (scan_intro ... scan_processing)
// and the customer scan result (scan_result). Built against the contract in
// docs/SEDENS_ROOM_FLOW.md; the room shell (room.js) calls these with a ctx.
//
// The server owns the state. This module only asks for transitions (ctx.act) and
// shows what the server says. Customer copy is in strings-room-scan.js ("rs.*");
// copy the server sends (consent texts, labels, the scan summary) is already in
// the customer's language and is shown as given, escaped.
//
// Camera: the live preview is mirrored like a mirror; the still that is uploaded is
// the camera's own (unmirrored) picture, at most 1280 px wide. For the demonstration
// scan (needs_images false) no photo ever leaves the browser: each still is shown for
// review and then discarded.
import { t as i18nT, lang as i18nLang } from "./i18n.js";
import { esc } from "./ui.js";
import { ApiError, sedens, upload as apiUpload } from "./api.js";
import { makeGuidance, createSampler, MESSAGES, DEFAULTS as GUIDE } from "./room-scan-guidance.js";

const VIEWS = ["front", "left", "back", "right"];
const CONSENTS = ["scan_capture", "scan_image_retention", "product_analytics"];
const COUNTDOWN = 5; // seconds before a photo
const REVIEW_SECONDS = 6; // a reviewed photo is used after this, unless the customer touches the screen
const ARM_MS = 2500; // time to step back or turn before automatic capture may begin
const ARM_IDLE_MS = 8000; // with no movement seen at all, automatic capture may begin after this
const SAMPLE_MS = 150; // guidance looks at the picture about 6-7 times a second
const STATUS_MS = 1200; // the spoken status changes at most this often (not every frame)
const POLL_MS = 3000;
const MOTION_SEEN = GUIDE.motionShare * 2; // clear movement (someone turning or stepping back)
const MAX_WIDTH = 1280;
const JPEG_QUALITY = 0.85;
// Where each view faces, seen from above with the screen at the top: 0 = facing the
// screen; each next view is a quarter turn to the customer's right.
const ANGLE = { front: 0, left: 90, back: 180, right: 270 };

let t = i18nT;
let current = null; // the ctx of the latest render
let renders = 0; // every render counts; async work started earlier checks it
let drawnState = null;
let firstDraw = false; // true when this render shows a state the screen was not showing

const camera = {
  root: null, stage: null, video: null, still: null, stream: null,
  starting: false, error: null, noCamera: false, token: 0,
  sampler: null, guidance: null, sampleTimer: null, evaluating: false,
  guide: { ready: false, message_key: MESSAGES.hold }, cost: [], spokenAt: 0, spokenKey: "",
};
const shot = {
  view: null, phase: "aim", count: 0, forced: false, autoArmed: true, viewStartedAt: 0,
  tickTimer: null, reviewTimer: null, reviewLeft: 0, error: "", token: 0, autoStartTimer: null, sawMotion: false,
};
const intro = { busy: null, message: "", focus: null, attention: false };
const processing = { timer: null, clock: null, startedAt: 0, failures: 0, token: 0 };
const sentResults = new Set();

// -- shared helpers -------------------------------------------------------------------

function bind(ctx) {
  current = ctx;
  t = typeof ctx.t === "function" ? ctx.t : i18nT;
  renders += 1;
  const state = ctx.journey?.state || null;
  firstDraw = state !== drawnState;
  drawnState = state;
}

// The page title is focused when a new step appears (screen readers announce it),
// never on a re-render of the same step (a language change, a status poll).
function focusTitle(ctx) {
  if (!firstDraw) return;
  toTop();
  ctx.main.querySelector("h1")?.focus({ preventScroll: true });
}

// A new step starts at the top of the page (on a phone the button that led here was
// far down the previous step).
function toTop() {
  try {
    globalThis.scrollTo?.({ top: 0 });
  } catch {
    // Not every browser takes options; the page still works.
  }
}

const langOf = (ctx) => (typeof ctx?.lang === "function" ? ctx.lang() : ctx?.lang) || i18nLang();
const viewOf = (state) => (typeof state === "string" && state.startsWith("scan_") ? state.slice(5) : null);
const isCameraState = (state) => VIEWS.includes(viewOf(state));

function activity(ctx = current) {
  try {
    ctx?.markActivity?.();
  } catch {
    // The idle watcher is the shell's; a failure there never blocks the scan.
  }
}

function friendly(error) {
  if (error instanceof ApiError) {
    if (error.code === "consent_required") return t("rs.intro.need_consent");
    if (error.code === "stale_consent_text") return t("rs.consent.stale_saved");
    if (error.code === "image_required" || error.code === "upload_interrupted") return t("rs.cam.upload_failed");
    if (error.code === "media_too_large" || error.code === "media_type_mismatch") return t("rs.cam.upload_failed");
    if (error.status === 0 || error.status >= 500) return t("rs.error.connection");
  }
  if (error instanceof TypeError) return t("rs.error.connection"); // fetch failed: offline
  return t("rs.error.generic");
}

// After an action, the shell normally draws the new state itself. If it did not
// (renders unchanged), draw it here so the screen never waits on a stale view.
async function settle(ctx, before, result) {
  await Promise.resolve();
  if (renders !== before || !result?.journey) return;
  const state = result.journey.state;
  if (!isCameraState(state)) releaseCamera();
  if (state === drawnState && !isCameraState(state)) return;
  const next = { ...ctx, journey: result.journey };
  if (state === "scan_result") renderScanResult(next);
  else if (state === "scan_intro" || state === "scan_processing" || isCameraState(state)) renderScan(next);
  else {
    stopScan();
    ctx.rerender?.();
  }
}

// Errors the shell has already shown to the customer (its banner). The shell's ctx.act
// rejects with error.shown = true after explaining a refusal, and resolves when the visit
// ended or the server moved on (it then draws the right screen itself). A shell that
// resolves {error} instead works too. Either way a failed action throws here, so each
// screen can restore its controls.
const reported = new WeakSet();
const wasShown = (error) => Boolean(error && typeof error === "object" && (error.shown === true || reported.has(error)));

async function act(ctx, name, body = {}) {
  const before = renders;
  activity(ctx);
  let result;
  try {
    result = await ctx.act(name, body);
  } catch (error) {
    if (error && typeof error === "object" && error.shown === true) reported.add(error);
    throw error;
  }
  if (result?.error) {
    const error = result.error;
    if (error && typeof error === "object") reported.add(error);
    throw error;
  }
  if (result?.journey && !isCameraState(result.journey.state)) releaseCamera();
  await settle(ctx, before, result);
  return result;
}

/** The words to show next to the controls: nothing when the shell's banner already said it. */
function inline(error) {
  return wasShown(error) ? "" : friendly(error);
}

function sendEvent(ctx, name, props) {
  try {
    const sent = ctx.event ? ctx.event(name, props) : sedens("room/event", { name, props });
    Promise.resolve(sent).catch(() => {});
  } catch {
    // Analytics never break the room.
  }
}

// Keep keyboard focus on the same control across a re-render of part of the screen.
function keepFocus(container, draw) {
  const active = document.activeElement;
  const key = active && container.contains(active) ? active.getAttribute("data-focus") : null;
  draw();
  if (!key) return false;
  const target = container.querySelector(`[data-focus="${key}"]`) || container.querySelector("[data-focus]:not([disabled])");
  target?.focus({ preventScroll: true });
  return true;
}

// -- drawings ---------------------------------------------------------------------------

// The framing guide: a standing figure as capsules (x1, y1, x2, y2, width) and a head.
const FIGURES = {
  front: {
    head: [100, 40, 21, 26],
    parts: [
      [100, 60, 100, 88, 22], [76, 100, 124, 100, 30], [100, 104, 100, 206, 62], [88, 222, 112, 222, 46],
      [70, 104, 56, 186, 22], [56, 186, 46, 262, 18], [46, 262, 44, 280, 16],
      [130, 104, 144, 186, 22], [144, 186, 154, 262, 18], [154, 262, 156, 280, 16],
      [88, 232, 84, 328, 32], [84, 328, 82, 410, 22], [82, 414, 78, 424, 18],
      [112, 232, 116, 328, 32], [116, 328, 118, 410, 22], [118, 414, 122, 424, 18],
    ],
  },
  side: {
    head: [102, 40, 22, 26],
    parts: [
      [122, 40, 126, 46, 8], [98, 60, 100, 90, 22], [100, 100, 98, 210, 50], [104, 108, 104, 160, 40],
      [96, 218, 100, 226, 46], [98, 104, 100, 186, 20], [100, 186, 104, 258, 17], [104, 258, 105, 276, 15],
      [99, 232, 101, 328, 32], [101, 328, 98, 410, 22], [96, 418, 122, 420, 14],
    ],
  },
};

function figureShapes(figure, extra, color) {
  const [cx, cy, rx, ry] = figure.head;
  const lines = figure.parts
    .map(([x1, y1, x2, y2, w]) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke-width="${w + extra}"/>`)
    .join("");
  return `<g stroke="${color}" fill="${color}" stroke-linecap="round">${lines}<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" stroke-width="${extra}"/></g>`;
}

/** The silhouette for a view, as the customer sees it in the mirrored preview: the left
 * view (left shoulder to the screen) shows a profile facing right, the right view a
 * profile facing left. Front and back share the outline. */
export function silhouette(view) {
  const figure = view === "left" || view === "right" ? FIGURES.side : FIGURES.front;
  const flip = view === "right" ? ` transform="translate(200 0) scale(-1 1)"` : "";
  return `<svg class="rs-figure" viewBox="-40 -30 280 500" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false"><defs><mask id="rs-figure-mask" maskUnits="userSpaceOnUse" x="-40" y="-30" width="280" height="500"><g${flip}>${figureShapes(figure, 7, "#fff")}${figureShapes(figure, 0, "#000")}</g></mask></defs><g class="rs-figure-fill"${flip}>${figureShapes(figure, 0, "currentColor")}</g><rect class="rs-figure-line" x="-40" y="-30" width="280" height="500" fill="currentColor" mask="url(#rs-figure-mask)"/></svg>`;
}

let orientIds = 0;
/** Seen from above: the screen at the top, the customer on the floor mark, the nose
 * showing which way to face, and (when turning) a quarter-turn arrow to the right. */
export function orientation(view, { turn = false } = {}) {
  const angle = ANGLE[view] ?? 0;
  const id = `rs-turn-${(orientIds += 1)}`;
  let arrow = "";
  if (turn && angle > 0) {
    const r = 60;
    const point = (deg) => {
      const rad = (deg * Math.PI) / 180;
      return `${(80 + r * Math.sin(rad)).toFixed(1)} ${(96 - r * Math.cos(rad)).toFixed(1)}`;
    };
    arrow = `<defs><marker id="${id}" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="currentColor"/></marker></defs><path class="rs-orient-turn" d="M ${point(angle - 70)} A ${r} ${r} 0 0 1 ${point(angle - 15)}" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" marker-end="url(#${id})"/>`;
  }
  return `<svg class="rs-orient" viewBox="0 0 160 170" aria-hidden="true" focusable="false"><rect class="rs-orient-screen" x="30" y="8" width="100" height="9" rx="4.5"/><text class="rs-orient-label" x="80" y="34" text-anchor="middle">${esc(t("rs.orient.screen"))}</text><circle class="rs-orient-mark" cx="80" cy="96" r="44"/>${arrow}<g transform="rotate(${angle} 80 96)"><ellipse class="rs-orient-body" cx="80" cy="96" rx="30" ry="11"/><circle class="rs-orient-head" cx="80" cy="96" r="12"/><path class="rs-orient-nose" d="M73 87 L80 72 L87 87 z"/></g></svg>`;
}

// -- scan_intro -------------------------------------------------------------------------

function consentState(record) {
  if (!record) return { on: false, stale: false };
  if (!record.current_version) return { on: false, stale: true };
  return { on: Boolean(record.granted), stale: false };
}

/** The scan_intro page as HTML (pure: the tests render it in Node). `busy` is the
 * consent being saved, `message` a problem to show next to the buttons, `attention`
 * marks the "agree first" hint after a start without the camera agreement. */
export function introHTML(journey, { busy = null, message = "", attention = false } = {}) {
  const j = journey || {};
  const consent = j.consent || { texts: {}, current: {} };
  const options = Array.isArray(j.scan_options) && j.scan_options.length ? j.scan_options : ["room_capture"];
  const capture = consentState(consent.current?.scan_capture);
  const views = VIEWS.map(
    (v, i) => `<li class="rs-view-card">${orientation(v)}<div><h3><span class="rs-view-n" aria-hidden="true">${i + 1}</span>${esc(t("rs.view." + v))}</h3><p>${esc(t("rs.why." + v))}</p></div></li>`,
  ).join("");
  const decisions = CONSENTS.filter((kind) => consent.texts?.[kind])
    .map((kind) => {
      const state = consentState(consent.current?.[kind]);
      const saving = busy === kind;
      const required = kind === "scan_capture";
      return `<li class="rs-consent${state.on ? " is-on" : ""}"><div class="rs-consent-head"><h3 id="rs-c-${kind}">${esc(t("rs.consent." + kind))}</h3><span class="sd-badge${required ? " info" : ""}">${esc(t(required ? "rs.consent.required" : "rs.consent.optional"))}</span></div><p class="rs-consent-text" id="rs-ct-${kind}">${esc(consent.texts[kind].text)}</p>${state.stale ? `<p class="rs-consent-stale">${esc(t("rs.consent.stale"))}</p>` : ""}<div class="rs-consent-row"><button type="button" class="rs-switch" role="switch" aria-checked="${state.on}" aria-labelledby="rs-c-${kind} rs-sw-${kind}" aria-describedby="rs-ct-${kind}" data-consent="${kind}" data-focus="consent-${kind}"${saving ? " disabled" : ""}><span class="rs-switch-track" aria-hidden="true"><span class="rs-switch-thumb"></span></span><span id="rs-sw-${kind}">${esc(t("rs.consent.agree"))}</span></button><span class="rs-consent-state">${esc(saving ? t("rs.consent.saving") : state.on ? t("rs.consent.on") : t(required ? "rs.consent.off_required" : "rs.consent.off"))}</span></div></li>`;
    })
    .join("");
  const demoHost = options.includes("demo_precomputed");
  const startBlocks = options
    .map((source, index) => {
      const primary = index === 0;
      const label = source === "room_capture" ? "" : `<p class="rs-label">${esc(t("rs.label." + source))}</p>`;
      return `<div class="rs-option${primary ? " is-primary" : ""}">${label}<h3>${esc(t("rs.option." + source))}</h3><p class="${source === "experimental_real" ? "rs-caution" : ""}">${esc(t("rs.option." + source + "_body"))}</p><button type="button" class="${primary ? "sd-primary " : ""}sd-large" data-start="${esc(source)}" data-focus="start-${esc(source)}"${capture.on ? "" : ` aria-describedby="rs-need"`}>${esc(t("rs.start." + source))}</button></div>`;
    })
    .join("");
  const hint = capture.on ? "" : `<p class="rs-need${attention ? " is-attention" : ""}" id="rs-need">${esc(t("rs.intro.need_consent_hint"))}</p>`;
  return `<div class="rs rs-wide rs-intro"><section class="rs-intro-about" aria-labelledby="rs-intro-title"><p class="sd-eyebrow">${esc(t("rs.eyebrow"))}</p><h1 id="rs-intro-title" tabindex="-1">${esc(t("rs.intro.title"))}</h1><p class="sd-lead">${esc(t("rs.intro.lead"))}</p><ol class="rs-view-cards">${views}</ol><p class="rs-tip">${esc(t("rs.intro.tips"))} ${esc(t("rs.intro.result"))}</p></section><section class="rs-intro-decide" aria-labelledby="rs-decide-title"><h2 id="rs-decide-title">${esc(t("rs.consent.title"))}</h2><p class="rs-decide-lead">${esc(t("rs.consent.lead"))}</p><ul class="rs-consents">${decisions}</ul></section><section class="rs-intro-start" aria-labelledby="rs-start-title"><h2 id="rs-start-title">${esc(t(demoHost ? "rs.option.title_demo" : "rs.option.title"))}</h2>${hint}<div class="rs-options">${startBlocks}</div><p class="sd-error rs-message" role="alert">${esc(message)}</p><div class="rs-skip-row"><button type="button" class="sd-ghost sd-large" data-skip data-focus="skip">${esc(t("rs.skip"))}</button></div></section></div>`;
}

function renderIntro(ctx) {
  ctx.main.innerHTML = introHTML(ctx.journey, intro);
  for (const button of ctx.main.querySelectorAll("[data-consent]")) {
    button.addEventListener("click", () => decide(ctx, button.dataset.consent, button.getAttribute("aria-checked") !== "true"));
  }
  for (const button of ctx.main.querySelectorAll("[data-start]")) button.addEventListener("click", () => start(ctx, button.dataset.start));
  ctx.main.querySelector("[data-skip]").addEventListener("click", () => skip(ctx));
  if (intro.focus) {
    ctx.main.querySelector(`[data-focus="${intro.focus}"]`)?.focus({ preventScroll: true });
    intro.focus = null;
  } else focusTitle(ctx);
}

async function decide(ctx, kind, granted) {
  const text = ctx.journey.consent?.texts?.[kind];
  if (!text || intro.busy) return;
  activity(ctx);
  intro.busy = kind;
  intro.message = "";
  intro.focus = `consent-${kind}`;
  renderIntro(ctx);
  const before = renders;
  let saved = null;
  let fresh = null;
  try {
    saved = await sedens("room/consent", { kind, granted, text_version: text.version });
  } catch (error) {
    intro.message = friendly(error);
  } finally {
    intro.busy = null;
  }
  try {
    // The decision is read back from the server (the shell redraws this step).
    fresh = await ctx.refresh?.();
  } catch {
    // The decision itself was saved (or its error shown); the next action re-reads.
  }
  if (renders === before && current?.journey?.state === "scan_intro") {
    intro.focus = `consent-${kind}`;
    let journey = fresh?.state === "scan_intro" ? fresh : ctx.journey;
    if (journey === ctx.journey && saved?.current) journey = { ...journey, consent: { ...journey.consent, current: saved.current } };
    renderScan({ ...ctx, journey });
  }
}

async function start(ctx, source) {
  intro.message = "";
  intro.attention = false;
  intro.focus = `start-${source}`;
  try {
    await act(ctx, "scan/begin", { source });
  } catch (error) {
    if (current?.journey?.state !== "scan_intro") return;
    const needConsent = error instanceof ApiError && error.code === "consent_required";
    // The hint next to the buttons is marked (the shell's banner may be out of sight on a
    // phone) and focus moves to the camera switch, the one thing to do now.
    intro.attention = needConsent;
    intro.message = needConsent ? (wasShown(error) ? "" : t("rs.intro.need_consent")) : inline(error);
    if (needConsent) intro.focus = "consent-scan_capture";
    renderIntro(current);
  }
}

const isScanState = (state) => state === "scan_intro" || state === "scan_processing" || state === "scan_result" || isCameraState(state);

async function skip(ctx) {
  try {
    await act(ctx, "scan/skip");
    if (!isScanState(current?.journey?.state)) stopScan();
  } catch (error) {
    showError(ctx, inline(error));
  }
}

function showError(ctx, message) {
  const box = ctx.main.querySelector(".rs-message");
  if (box) box.textContent = message;
}

// -- scan_front / left / back / right -------------------------------------------------------

function resetShot(view) {
  clearTimeout(shot.autoStartTimer);
  clearInterval(shot.tickTimer);
  clearInterval(shot.reviewTimer);
  stopReviewListeners();
  Object.assign(shot, {
    view, phase: "aim", count: 0, forced: false, autoArmed: true, viewStartedAt: performance.now(),
    tickTimer: null, reviewTimer: null, reviewLeft: 0, error: "", autoStartTimer: null, sawMotion: false,
  });
  shot.token += 1;
  camera.guidance?.reset?.();
  camera.guide = { ready: false, message_key: MESSAGES.hold };
  clearStill();
}

function buildCamera(ctx) {
  const root = document.createElement("div");
  root.className = "rs rs-wide rs-camera";
  root.innerHTML = `<div class="rs-stage" data-phase="aim"><video class="rs-video" playsinline muted autoplay></video><canvas class="rs-still" hidden></canvas><div class="rs-guide"></div><p class="rs-stage-note" aria-hidden="true"></p><p class="rs-count" aria-hidden="true"></p><div class="rs-flash" aria-hidden="true"></div></div><div class="rs-panel"><div class="rs-panel-top"></div><p class="rs-status" role="status" aria-live="polite"></p><div class="rs-panel-bottom"></div></div>`;
  camera.root = root;
  camera.stage = root.querySelector(".rs-stage");
  camera.video = root.querySelector(".rs-video");
  camera.still = root.querySelector(".rs-still");
  camera.video.addEventListener("loadedmetadata", () => {
    const { videoWidth: w, videoHeight: h } = camera.video;
    if (w && h) camera.stage.style.setProperty("--rs-aspect", `${w} / ${h}`);
  });
  camera.root.addEventListener("click", (event) => {
    const button = event.target.closest("[data-cam]");
    if (button && !button.disabled) cameraAction(button.dataset.cam);
  });
  return root;
}

function renderCamera(ctx, view) {
  if (shot.view !== view) resetShot(view);
  if (!camera.root) buildCamera(ctx);
  if (!ctx.main.contains(camera.root)) {
    delete camera.root.querySelector(".rs-panel-top").dataset.view; // drawn as a new view
    ctx.main.replaceChildren(camera.root);
    camera.video.play?.().catch(() => {});
  }
  camera.root.querySelector(".rs-guide").innerHTML = silhouette(view);
  camera.root.dataset.view = view;
  paintCamera();
  if (camera.noCamera) {
    if (shot.phase === "aim" && !shot.autoStartTimer) {
      const token = shot.token;
      shot.autoStartTimer = setTimeout(() => token === shot.token && shot.phase === "aim" && beginCountdown(false), 1500);
    }
  } else if (!camera.stream && !camera.starting && !camera.error) {
    startCamera();
  }
}

function scanOf(ctx = current) {
  return ctx?.journey?.scan || {};
}

function paintCamera() {
  if (!camera.root || !current) return;
  const ctx = current;
  const scan = scanOf(ctx);
  const view = shot.view;
  const index = VIEWS.indexOf(view);
  const stage = camera.stage;
  const phase = camera.error && !camera.noCamera ? "error" : camera.starting ? "starting" : shot.phase;
  stage.dataset.phase = phase;
  stage.classList.toggle("is-nocam", camera.noCamera);
  stage.classList.toggle("is-ready", Boolean(camera.guide.ready) && !camera.noCamera);
  camera.video.hidden = camera.noCamera || Boolean(camera.error);
  camera.still.hidden = shot.phase !== "review";

  const progress = VIEWS.map((v, i) => {
    const captured = scan.views?.[v]?.captured || i < index;
    const state = v === view ? "current" : captured ? "done" : "todo";
    return `<li class="rs-dot is-${state}"${v === view ? ` aria-current="step"` : ""}><span class="rs-dot-mark" aria-hidden="true"></span><span>${esc(t("rs.view." + v))}</span>${state === "done" ? `<span class="sd-visually-hidden">${esc(t("rs.progress.done"))}</span>` : ""}</li>`;
  }).join("");
  const label = scan.label ? `<p class="rs-label">${esc(scan.label)}</p>` : "";
  const top = `${label}<ol class="rs-progress" aria-label="${esc(t("rs.progress.label"))}">${progress}</ol><p class="sd-eyebrow">${esc(t("rs.progress.step", { n: index + 1, total: VIEWS.length, view: t("rs.view." + view) }))}</p><h1 tabindex="-1">${esc(t("rs.face." + view))}</h1><p class="rs-why">${esc(t("rs.why." + view))}</p><div class="rs-orient-row">${orientation(view, { turn: index > 0 })}<p>${esc(t(camera.noCamera ? "rs.cam.nocam_position" : "rs.cam.position"))}</p></div>`;
  const panelTop = camera.root.querySelector(".rs-panel-top");
  const newView = panelTop.dataset.view !== view;
  panelTop.innerHTML = top;
  panelTop.dataset.view = view;

  const bottom = camera.root.querySelector(".rs-panel-bottom");
  const kept = keepFocus(bottom, () => {
    bottom.innerHTML = cameraActions(scan, index, phase);
  });
  // A new view: the picture is in sight and the instruction is the first thing a screen
  // reader hears.
  if (newView) toTop();
  if (newView && !kept) panelTop.querySelector("h1")?.focus({ preventScroll: true });
  paintStage();
}

function cameraActions(scan, index, phase) {
  const demo = scan.needs_images === false;
  const parts = [];
  if (phase === "error") {
    parts.push(`<div class="rs-problem" role="alert"><h2>${esc(t("rs.cam.error_title." + camera.error))}</h2><p>${esc(t("rs.cam.error_body." + camera.error))}</p><p class="sd-muted">${esc(t("rs.cam.error_staff"))}</p></div>`);
    parts.push(`<div class="rs-actions">${demo ? `<button type="button" class="sd-primary sd-large" data-cam="nocam" data-focus="nocam">${esc(t("rs.cam.nocam"))}</button><button type="button" class="sd-large" data-cam="retry" data-focus="retry">${esc(t("rs.cam.retry"))}</button>` : `<button type="button" class="sd-primary sd-large" data-cam="retry" data-focus="retry">${esc(t("rs.cam.retry"))}</button>`}</div>`);
    if (demo) parts.push(`<p class="rs-note">${esc(t("rs.cam.nocam_note"))}</p>`);
  } else if (phase === "starting") {
    parts.push(`<p class="rs-note">${esc(t("rs.cam.starting"))}</p>`);
  } else if (phase === "aim") {
    parts.push(`<div class="rs-actions"><button type="button" class="sd-primary sd-large" data-cam="take" data-focus="take">${esc(t(camera.noCamera ? "rs.cam.take_nocam" : "rs.cam.take"))}</button></div><p class="rs-note">${esc(t(camera.noCamera ? "rs.cam.auto_nocam" : "rs.cam.auto"))}</p>`);
  } else if (phase === "countdown") {
    parts.push(`<div class="rs-actions"><button type="button" class="sd-large" data-cam="stop" data-focus="stop">${esc(t("rs.cam.stop"))}</button></div>`);
  } else if (phase === "review") {
    parts.push(`<h2 class="rs-review-title">${esc(t("rs.cam.review"))}</h2><div class="rs-actions"><button type="button" class="sd-primary sd-large" data-cam="use" data-focus="use">${esc(t("rs.cam.use"))}</button><button type="button" class="sd-large" data-cam="retake" data-focus="retake">${esc(t("rs.cam.retake"))}</button></div>${shot.reviewTimer ? `<p class="rs-note rs-auto-use">${esc(t("rs.cam.auto_use", { n: shot.reviewLeft }))}</p>` : ""}`);
  } else if (phase === "sending") {
    parts.push(`<p class="rs-note">${esc(t(demo ? "rs.cam.next" : "rs.cam.sending"))}</p>`);
  }
  if (phase !== "error") parts.push(`<p class="rs-privacy">${esc(t(demo ? (camera.noCamera ? "rs.cam.privacy_nocam" : "rs.cam.privacy_demo") : "rs.cam.privacy_real"))}</p>`);
  parts.push(`<p class="sd-error rs-message" role="alert">${esc(shot.error)}</p>`);
  const busy = phase === "sending";
  parts.push(`<div class="rs-skip-row">${index > 0 ? `<button type="button" class="sd-ghost" data-cam="back" data-focus="back"${busy ? " disabled" : ""}>${esc(t("rs.cam.back", { view: t("rs.view." + VIEWS[index - 1]) }))}</button>` : ""}<button type="button" class="sd-ghost" data-cam="skip" data-focus="skip"${busy ? " disabled" : ""}>${esc(t("rs.skip"))}</button></div>`);
  return parts.join("");
}

// The big text on the picture (readable from the floor marks) and the countdown.
function paintStage() {
  if (!camera.stage) return;
  const note = camera.stage.querySelector(".rs-stage-note");
  const count = camera.stage.querySelector(".rs-count");
  let text = "";
  if (camera.starting) text = t("rs.cam.starting");
  else if (camera.noCamera) text = shot.phase === "countdown" ? t("rs.cam.nocam_stage") : "";
  else if (camera.error) text = "";
  else if (shot.phase === "aim" || shot.phase === "countdown") text = t(camera.guide.message_key || MESSAGES.hold);
  else if (shot.phase === "review") text = t("rs.cam.review");
  note.textContent = text;
  note.hidden = !text;
  count.textContent = shot.phase === "countdown" ? String(shot.count) : "";
  count.hidden = shot.phase !== "countdown";
}

// The spoken status: the countdown each second, guidance only when it changes (and
// not more often than STATUS_MS), so a screen reader is not flooded.
function say(text, { force = false } = {}) {
  const status = camera.root?.querySelector(".rs-status");
  if (!status) return;
  const now = performance.now();
  if (!force && (text === camera.spokenKey || now - camera.spokenAt < STATUS_MS)) return;
  camera.spokenAt = now;
  camera.spokenKey = text;
  status.textContent = text;
}

async function startCamera() {
  const token = (camera.token += 1);
  camera.starting = true;
  camera.error = null;
  paintCamera();
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error("no camera"), { name: "NotFoundError" });
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    if (token !== camera.token) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    camera.stream = stream;
    for (const track of stream.getVideoTracks()) {
      track.addEventListener("ended", () => {
        if (camera.stream !== stream) return;
        releaseCamera();
        camera.error = "lost";
        paintCamera();
      });
    }
    camera.video.srcObject = stream;
    await camera.video.play().catch(() => {});
    camera.sampler = createSampler(camera.video);
    camera.guidance = makeGuidance();
    camera.sampleTimer = setInterval(sample, SAMPLE_MS);
  } catch (error) {
    if (token !== camera.token) return;
    const name = error?.name || "";
    camera.error = name === "NotAllowedError" || name === "SecurityError" ? "denied"
      : name === "NotReadableError" || name === "AbortError" ? "busy" : "unavailable";
  } finally {
    if (token === camera.token) {
      camera.starting = false;
      paintCamera();
      if (!camera.error) say(t(MESSAGES.hold), { force: true });
    }
  }
}

function releaseCamera() {
  camera.token += 1;
  clearInterval(camera.sampleTimer);
  camera.sampleTimer = null;
  camera.stream?.getTracks().forEach((track) => track.stop());
  camera.stream = null;
  camera.starting = false;
  camera.sampler = null;
  camera.evaluating = false;
  if (camera.video) {
    camera.video.pause?.();
    camera.video.srcObject = null;
  }
}

async function sample() {
  if (camera.evaluating || !camera.sampler || !camera.guidance) return;
  camera.evaluating = true;
  try {
    const began = performance.now();
    const frame = camera.sampler(began);
    if (!frame) return;
    const result = (await camera.guidance.evaluate(frame)) || { ready: false, message_key: MESSAGES.hold };
    const cost = performance.now() - began;
    camera.cost.push(cost);
    if (camera.cost.length > 60) camera.cost.shift();
    if (camera.stage) camera.stage.dataset.guidanceMs = (camera.cost.reduce((a, b) => a + b, 0) / camera.cost.length).toFixed(2);
    const changed = result.ready !== camera.guide.ready || result.message_key !== camera.guide.message_key;
    camera.guide = result;
    if (changed) {
      camera.stage?.classList.toggle("is-ready", Boolean(result.ready));
      if (shot.phase === "aim" || shot.phase === "countdown") paintStage();
    }
    if (shot.phase === "aim") say(t(result.message_key));
    // Automatic capture: someone moved into place (or nobody moved for a while), and
    // the picture is now lit and steady. It never claims to have found a body.
    if (typeof result.motion === "number" && result.motion > MOTION_SEEN) shot.sawMotion = true;
    const waited = performance.now() - shot.viewStartedAt;
    const armed = (shot.sawMotion && waited > ARM_MS) || waited > ARM_IDLE_MS;
    if (shot.phase === "aim" && shot.autoArmed && result.ready && armed) beginCountdown(false);
  } catch {
    // A frame that could not be read is skipped.
  } finally {
    camera.evaluating = false;
  }
}

function beginCountdown(forced) {
  if (shot.phase !== "aim") return;
  clearTimeout(shot.autoStartTimer);
  shot.phase = "countdown";
  shot.count = COUNTDOWN;
  shot.forced = forced;
  shot.error = "";
  paintCamera();
  say(t("rs.cam.count_start", { n: COUNTDOWN }), { force: true });
  const token = shot.token;
  shot.tickTimer = setInterval(() => {
    if (token !== shot.token || shot.phase !== "countdown") return clearInterval(shot.tickTimer);
    // Automatic capture waits while the picture is not steady or lit; a photo the
    // customer asked for (forced) goes ahead, with the same advice on screen.
    if (!forced && !camera.noCamera && !camera.guide.ready) {
      say(t(camera.guide.message_key || MESSAGES.hold));
      return;
    }
    shot.count -= 1;
    if (shot.count <= 0) {
      clearInterval(shot.tickTimer);
      shot.tickTimer = null;
      capture();
      return;
    }
    paintStage();
    say(String(shot.count), { force: true });
  }, 1000);
}

function stopCountdown() {
  clearInterval(shot.tickTimer);
  clearTimeout(shot.autoStartTimer);
  shot.tickTimer = null;
  shot.autoStartTimer = 1; // in the no-camera demonstration, do not start again by itself
  shot.phase = "aim";
  shot.autoArmed = false; // until the customer asks for a photo again
  paintCamera();
  say(t("rs.cam.stopped"), { force: true });
}

function flash() {
  const el = camera.stage?.querySelector(".rs-flash");
  if (!el) return;
  el.classList.remove("is-on");
  void el.offsetWidth;
  el.classList.add("is-on");
}

function capture() {
  activity();
  if (camera.noCamera) {
    flash();
    usePhoto();
    return;
  }
  const video = camera.video;
  const width = video?.videoWidth || 0;
  const height = video?.videoHeight || 0;
  if (!width || !height) {
    shot.phase = "aim";
    shot.error = t("rs.cam.capture_failed");
    paintCamera();
    return;
  }
  const scale = Math.min(1, MAX_WIDTH / width);
  const canvas = camera.still;
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
  shot.phase = "review";
  flash();
  startReviewTimer();
  paintCamera();
  say(t("rs.cam.taken"), { force: true });
  camera.root.querySelector('[data-cam="use"]')?.focus({ preventScroll: true });
}

// The reviewed photo is used after REVIEW_SECONDS, so a customer standing on the floor
// marks need not walk to the screen four times. Any touch or key stops that.
function startReviewTimer() {
  shot.reviewLeft = REVIEW_SECONDS;
  const token = shot.token;
  shot.reviewTimer = setInterval(() => {
    if (token !== shot.token || shot.phase !== "review") return clearInterval(shot.reviewTimer);
    shot.reviewLeft -= 1;
    if (shot.reviewLeft <= 0) {
      clearInterval(shot.reviewTimer);
      shot.reviewTimer = null;
      stopReviewListeners();
      usePhoto();
      return;
    }
    const line = camera.root?.querySelector(".rs-auto-use");
    if (line) line.textContent = t("rs.cam.auto_use", { n: shot.reviewLeft });
  }, 1000);
  document.addEventListener("pointerdown", holdReview, true);
  document.addEventListener("keydown", holdReview, true);
}

function holdReview() {
  if (!shot.reviewTimer) return stopReviewListeners();
  clearInterval(shot.reviewTimer);
  shot.reviewTimer = null;
  stopReviewListeners();
  camera.root?.querySelector(".rs-auto-use")?.remove();
  say(t("rs.cam.auto_stopped"), { force: true });
}

function stopReviewListeners() {
  document.removeEventListener("pointerdown", holdReview, true);
  document.removeEventListener("keydown", holdReview, true);
}

function clearStill() {
  if (camera.still) {
    camera.still.getContext("2d")?.clearRect(0, 0, camera.still.width, camera.still.height);
    camera.still.width = 0;
    camera.still.height = 0;
  }
}

function jpeg(canvas) {
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("encode"))), "image/jpeg", JPEG_QUALITY),
  );
}

async function sendPhoto(ctx, view, blob) {
  if (ctx.upload) return ctx.upload(view, blob);
  return apiUpload("room/scan/image", blob, { view });
}

async function usePhoto() {
  const ctx = current;
  if (!ctx || (shot.phase !== "review" && !(camera.noCamera && shot.phase === "countdown"))) return;
  clearInterval(shot.reviewTimer);
  shot.reviewTimer = null;
  stopReviewListeners();
  activity(ctx);
  const view = shot.view;
  const token = shot.token;
  const needsImages = scanOf(ctx).needs_images === true;
  shot.phase = "sending";
  shot.error = "";
  paintCamera();
  say(t(needsImages ? "rs.cam.sending" : "rs.cam.next"), { force: true });
  try {
    let blob = null;
    if (needsImages) {
      blob = await jpeg(camera.still);
      await sendPhoto(ctx, view, blob);
      if (token !== shot.token) return;
    }
    // The photo is no longer needed in the browser (in the demonstration it never left it).
    clearStill();
    try {
      await act(ctx, "scan/view", { view });
    } catch (error) {
      // The server has not got this view's photo (for example it was dropped): send it once more.
      if (!(needsImages && blob && error instanceof ApiError && error.code === "image_required")) throw error;
      await sendPhoto(ctx, view, blob);
      await act(ctx, "scan/view", { view });
    }
    // Still on this view (the shell re-read a journey that had not moved on): aim again.
    if (token === shot.token && shot.phase === "sending") backToAim();
  } catch (error) {
    if (token !== shot.token) return;
    shot.error = inline(error);
    // With the still gone (demonstration) or unsendable, take the photo again.
    shot.phase = camera.still?.width ? "review" : "aim";
    shot.viewStartedAt = performance.now();
    shot.autoArmed = false;
    paintCamera();
  }
}

function backToAim() {
  clearStill();
  shot.phase = "aim";
  shot.autoArmed = false;
  shot.viewStartedAt = performance.now();
  paintCamera();
}

async function retakePhoto() {
  const ctx = current;
  clearInterval(shot.reviewTimer);
  shot.reviewTimer = null;
  stopReviewListeners();
  clearStill();
  shot.phase = "aim";
  shot.error = "";
  shot.autoArmed = true;
  shot.sawMotion = false;
  shot.viewStartedAt = performance.now();
  camera.guidance?.reset?.();
  paintCamera();
  say(t("rs.cam.retake_said"), { force: true });
  // Recorded on the server (scan_retake); the state stays on this view.
  try {
    await ctx.act("scan/retake", { view: shot.view });
  } catch {
    // Nothing was sent for this view yet, so there is nothing to undo.
  }
}

async function cameraAction(name) {
  const ctx = current;
  if (!ctx) return;
  activity(ctx);
  if (name === "take") {
    if (shot.phase !== "aim") return;
    shot.autoArmed = true;
    beginCountdown(true);
  } else if (name === "stop") stopCountdown();
  else if (name === "use") usePhoto();
  else if (name === "retake") retakePhoto();
  else if (name === "retry") {
    camera.error = null;
    startCamera();
  } else if (name === "nocam") {
    camera.noCamera = true;
    camera.error = null;
    releaseCamera();
    resetShot(shot.view);
    renderCamera(ctx, shot.view);
  } else if (name === "back" || name === "skip") {
    const index = VIEWS.indexOf(shot.view);
    shot.phase = "sending";
    paintCamera();
    const token = shot.token;
    try {
      if (name === "back") await act(ctx, "scan/retake", { view: VIEWS[Math.max(0, index - 1)] });
      else {
        await act(ctx, "scan/skip");
        if (!isScanState(current?.journey?.state)) stopScan();
      }
      if (token === shot.token && shot.phase === "sending") backToAim();
    } catch (error) {
      shot.phase = "aim";
      shot.error = inline(error);
      paintCamera();
    }
  }
}

// -- scan_processing ----------------------------------------------------------------------

function stopPolling() {
  processing.token += 1;
  clearTimeout(processing.timer);
  clearInterval(processing.clock);
  processing.timer = null;
  processing.clock = null;
}

function elapsed(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function renderProcessing(ctx) {
  const scan = scanOf(ctx);
  const freeHost = scan.source === "experimental_real";
  if (!processing.startedAt) processing.startedAt = Date.now();
  const label = scan.label ? `<p class="rs-label">${esc(scan.label)}</p>` : "";
  ctx.main.innerHTML = `<div class="rs rs-processing"><section class="sd-room-card">${label}<div class="rs-breathe" aria-hidden="true"><span></span></div><p class="sd-eyebrow">${esc(t("rs.eyebrow"))}</p><h1 tabindex="-1">${esc(t("rs.proc.title"))}</h1><p class="sd-lead">${esc(t(freeHost ? "rs.proc.free_host" : "rs.proc.room"))}</p><p class="rs-elapsed">${esc(t("rs.proc.elapsed"))} <span data-elapsed>${elapsed(Date.now() - processing.startedAt)}</span></p><p>${esc(t("rs.proc.breathe"))}</p><p class="sd-muted">${esc(t("rs.proc.photos"))}</p><p class="sd-error rs-message" role="alert">${processing.failures >= 2 ? esc(t("rs.proc.reconnecting")) : ""}</p><div class="sd-actions"><button type="button" class="sd-large" data-skip data-focus="skip">${esc(t("rs.proc.skip"))}</button></div></section></div>`;
  ctx.main.querySelector("[data-skip]").addEventListener("click", () => skip(ctx));
  focusTitle(ctx);
  if (processing.timer === null) startPolling(ctx);
  clearInterval(processing.clock);
  processing.clock = setInterval(() => {
    const out = current?.main?.querySelector("[data-elapsed]");
    if (out) out.textContent = elapsed(Date.now() - processing.startedAt);
  }, 1000);
}

function startPolling(ctx) {
  const token = (processing.token += 1);
  const poll = async () => {
    if (token !== processing.token) return;
    const before = renders;
    let journey = null;
    try {
      journey = await ctx.refresh();
      processing.failures = 0;
    } catch {
      processing.failures += 1;
      const box = current?.main?.querySelector(".rs-processing .rs-message");
      if (box && processing.failures >= 2) box.textContent = t("rs.proc.reconnecting");
    }
    if (token !== processing.token) return;
    if (journey && journey.state !== "scan_processing") {
      stopPolling();
      processing.startedAt = 0;
      await settle(current || ctx, before, { journey });
      return;
    }
    processing.timer = setTimeout(poll, POLL_MS);
  };
  processing.timer = setTimeout(poll, POLL_MS);
}

// -- scan_result ---------------------------------------------------------------------------

const QUALITY_ICON = { clear: "✓", limited: "–", retake: "↻" };

function number(value, unit, locale) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const digits = unit === "ratio" ? 2 : 1;
  const text = new Intl.NumberFormat(locale === "ko" ? "ko-KR" : "en-US", {
    minimumFractionDigits: digits, maximumFractionDigits: digits,
  }).format(value);
  if (unit === "deg") return `${text}°`;
  if (unit === "ratio") return `${text} ${t("rs.adv.unit_ratio")}`;
  return unit ? `${text} ${unit}` : text;
}

function resultBody(scan, locale) {
  const s = scan.summary || {};
  const chips = VIEWS.filter((v) => s.views?.[v])
    .map((v) => {
      const q = QUALITY_ICON[s.views[v].quality] ? s.views[v].quality : "limited";
      const reason = s.views[v].reason ? `<span class="rs-chip-reason">${esc(s.views[v].reason)}</span>` : "";
      return `<li class="rs-chip is-${esc(q)}"><span class="rs-chip-view">${esc(t("rs.view." + v))}</span><span class="rs-chip-value"><span class="rs-chip-icon" aria-hidden="true">${QUALITY_ICON[q]}</span>${esc(t("rs.quality." + q))}</span>${reason}</li>`;
    })
    .join("");
  const observations = (s.observations || [])
    .map((o) => `<li class="rs-observation"><div class="rs-observation-head"><h3>${esc(o.heading)}</h3>${o.provisional ? `<span class="sd-badge">${esc(t("rs.result.provisional"))}</span>` : ""}</div><p>${esc(o.text)}</p>${o.limitation ? `<p class="rs-small">${esc(o.limitation)}</p>` : ""}</li>`)
    .join("");
  const provisional = (s.observations || []).some((o) => o.provisional)
    ? `<p class="rs-small">${esc(t("rs.result.provisional_note"))}</p>` : "";
  const notes = (s.notes || [])
    .map((n) => `<li class="rs-observation is-note">${n.heading ? `<h3>${esc(n.heading)}</h3>` : ""}<p>${esc(n.text)}</p></li>`)
    .join("");
  const nothing = !observations && !notes ? `<p>${esc(t("rs.result.none"))}</p>` : "";
  const focus = s.focus || {};
  const rows = (s.advanced || [])
    .map((m) => `<tr><td>${esc(t("rs.view." + m.view))}</td><td>${esc(m.label)}</td><td class="rs-num">${esc(number(m.value, m.unit, locale))}</td><td>${esc(m.limitation || "")}</td></tr>`)
    .join("");
  const advanced = rows
    ? `<details class="rs-advanced"><summary>${esc(t("rs.adv.title"))}</summary><p class="rs-small">${esc(t("rs.adv.note"))}</p><div class="rs-table-wrap"><table class="sd-table"><caption class="sd-visually-hidden">${esc(t("rs.adv.title"))}</caption><thead><tr><th scope="col">${esc(t("rs.adv.view"))}</th><th scope="col">${esc(t("rs.adv.measure"))}</th><th scope="col">${esc(t("rs.adv.value"))}</th><th scope="col">${esc(t("rs.adv.limit"))}</th></tr></thead><tbody>${rows}</tbody></table></div></details>`
    : "";
  return `<div class="rs-result-grid"><section class="rs-block rs-span" aria-labelledby="rs-a"><h2 id="rs-a">${esc(t("rs.result.quality"))}</h2><p class="rs-quality-text">${esc(s.quality_text || "")}</p><ul class="rs-chips">${chips}</ul></section><section class="rs-block" aria-labelledby="rs-b"><h2 id="rs-b">${esc(t("rs.result.observed"))}</h2>${nothing}<ul class="rs-observations">${observations}${notes}</ul>${provisional}</section><section class="rs-block" aria-labelledby="rs-c"><h2 id="rs-c">${esc(t("rs.result.meaning"))}</h2><p>${esc(s.meaning || "")}</p></section>${focus.heading || focus.text ? `<section class="rs-block" aria-labelledby="rs-d"><h2 id="rs-d">${esc(focus.heading || t("rs.result.focus"))}</h2><p>${esc(focus.text || "")}</p></section>` : ""}${focus.why ? `<section class="rs-block" aria-labelledby="rs-e"><h2 id="rs-e">${esc(focus.why_heading || t("rs.result.why"))}</h2><p>${esc(focus.why)}</p></section>` : ""}${s.comparison?.text ? `<section class="rs-block rs-compare rs-span" aria-labelledby="rs-cmp"><h2 id="rs-cmp">${esc(t("rs.result.compare"))}</h2><p>${esc(s.comparison.text)}</p></section>` : ""}</div>${advanced}`;
}

const failedScan = (scan) => scan?.failed === true || !scan?.summary;

/** The scan_result page as HTML (pure: the tests render it in Node). */
export function resultHTML(journey, { lang: locale = i18nLang() } = {}) {
  const scan = journey?.scan || {};
  const s = scan.summary || null;
  const failed = failedScan(scan);
  const label = s?.label || scan.label;
  const source = s?.source || scan.source;
  const note = s?.label_note || (source === "experimental_real" ? t("rs.result.note_experimental") : "");
  const banner = label
    ? `<div class="rs-banner" role="note"><p class="rs-label">${esc(label)}</p>${note ? `<p>${esc(note)}</p>` : ""}</div>`
    : "";
  // One primary action: Continue, unless the analysis failed or suggests a retake.
  const againFirst = failed || s?.quality === "retake";
  const body = failed
    ? `<section class="rs-block rs-failed" role="alert"><p>${esc(t("rs.result.failed_body"))}</p></section>`
    : resultBody(scan, locale);
  const actions = againFirst
    ? `<button type="button" class="sd-primary sd-large" data-result="scan/again" data-focus="again">${esc(t("rs.result.again"))}</button><button type="button" class="sd-large" data-result="scan/continue" data-focus="continue">${esc(t(failed ? "rs.result.continue_anyway" : "rs.result.continue"))}</button>`
    : `<button type="button" class="sd-primary sd-large" data-result="scan/continue" data-focus="continue">${esc(t("rs.result.continue"))}</button><button type="button" class="sd-large" data-result="scan/again" data-focus="again">${esc(t("rs.result.again"))}</button>`;
  return `<div class="rs rs-result">${banner}<p class="sd-eyebrow">${esc(t("rs.eyebrow"))}</p><h1 tabindex="-1">${esc(t(failed ? "rs.result.failed_heading" : "rs.result.title"))}</h1>${failed ? "" : `<p class="sd-lead">${esc(t("rs.result.lead"))}</p>`}${body}<p class="sd-error rs-message" role="alert"></p><div class="rs-result-actions">${actions}</div></div>`;
}

export function renderScanResult(ctx) {
  bind(ctx);
  releaseCamera();
  resetShot(null);
  stopPolling();
  camera.noCamera = false;
  camera.error = null;
  processing.startedAt = 0;
  const scan = ctx.journey?.scan || {};
  const s = scan.summary || null;
  const failed = failedScan(scan);
  ctx.main.innerHTML = resultHTML(ctx.journey, { lang: langOf(ctx) });
  for (const button of ctx.main.querySelectorAll("[data-result]")) {
    button.addEventListener("click", async () => {
      for (const b of ctx.main.querySelectorAll("[data-result]")) b.disabled = true;
      try {
        await act(ctx, button.dataset.result);
      } catch (error) {
        for (const b of ctx.main.querySelectorAll("[data-result]")) b.disabled = false;
        showError(ctx, inline(error));
      }
    });
  }
  focusTitle(ctx);
  const source = s?.source || scan.source || "unknown";
  const quality = failed ? "failed" : s.quality || "unknown";
  const key = `${source}:${quality}:${ctx.journey?.revision ?? ""}`;
  if (!sentResults.has(key)) {
    sentResults.add(key);
    sendEvent(ctx, "scan_result_viewed", { source, quality });
  }
}

// -- entry points ---------------------------------------------------------------------------

/** Render scan_intro, scan_front/left/back/right and scan_processing into ctx.main. */
export function renderScan(ctx) {
  bind(ctx);
  const state = ctx.journey?.state;
  if (state === "scan_intro") {
    releaseCamera();
    resetShot(null);
    stopPolling();
    camera.noCamera = false;
    camera.error = null;
    processing.startedAt = 0;
    if (firstDraw) Object.assign(intro, { message: "", attention: false });
    renderIntro(ctx);
    return;
  }
  if (state === "scan_processing") {
    releaseCamera();
    resetShot(null);
    renderProcessing(ctx);
    return;
  }
  const view = viewOf(state);
  if (VIEWS.includes(view)) {
    stopPolling();
    renderCamera(ctx, view);
    return;
  }
  stopScan();
}

/** Stop the camera and any timers (called by the shell before it leaves a scan screen). */
export function stopScan() {
  releaseCamera();
  clearTimeout(shot.autoStartTimer);
  clearInterval(shot.tickTimer);
  clearInterval(shot.reviewTimer);
  shot.tickTimer = null;
  shot.reviewTimer = null;
  shot.autoStartTimer = null;
  shot.token += 1;
  shot.view = null; // the next camera view starts fresh
  stopReviewListeners();
  clearStill();
  stopPolling();
  camera.error = null;
  intro.busy = null;
}
