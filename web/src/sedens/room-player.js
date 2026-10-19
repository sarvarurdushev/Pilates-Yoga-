// Room workout player (ready_to_train, exercise, exercise_paused). It stays mounted
// across steps and language changes so video, narration, music and the anatomy
// viewer are never torn down by a re-render. Contract: docs/SEDENS_ROOM_FLOW.md §3;
// behaviour: docs/SEDENS_SESSION_PLAYER.md.
//
// The server owns the workout: this page asks for every change through ctx.act()
// (workout/start, step, previous, pause, resume, variant, settings, unwell, end,
// cancel) and redraws from what comes back. No camera runs here, and nothing here
// judges how an exercise was done.
import { esc } from "./ui.js";
import { anatomyStateAt, AnatomyPanel } from "./room-anatomy.js";
import { createNarrator } from "./room-narration.js";
import { createMusic, MODES as MUSIC_MODES } from "./room-music.js";
import { positionAt, workMs, afterWork, presenceTracker, TRANSITION_SECONDS } from "./room-player-clock.js";

const TICK_MS = 250;
const PHASE_KEYS = { warm_up: "rp.phase_warm_up", main: "rp.phase_main", cool_down: "rp.phase_cool_down" };

export function mountPlayer(ctx) {
  const player = new Player(ctx);
  player.update(ctx);
  return { update: (next) => player.update(next), destroy: () => player.destroy() };
}

const now = () => (globalThis.performance ? performance.now() : Date.now());

class Player {
  constructor(ctx) {
    this.ctx = ctx;
    this.t = ctx.t;
    this.main = ctx.main;
    this.key = null; // workout id + step + variant currently shown
    this.lang = String(ctx.lang);
    this.elapsed = 0; // ms of the current step's work already done
    this.started = null; // performance.now() when the clock last started
    this.phase = "work"; // work | transition | waiting | presence
    this.countdown = 0;
    this.busy = false;
    this.expanded = false;
    this.lastSpoken = null;
    this.presence = presenceTracker();
    this.timer = null;
    this.narrationOn = true;
    this.narrationVolume = 0.9;
    this.musicVolume = 0.5;
    this.music = createMusic();
    this.narrator = createNarrator({
      lang: this.lang,
      onCaption: (text) => this.caption(text),
      onSpeaking: (on) => this.music.duck(on),
    });
    this.touch = () => this.presence.touched();
    document.addEventListener("pointerdown", this.touch, { passive: true });
    document.addEventListener("keydown", this.touch);
    this.keys = (event) => this.onKey(event);
    document.addEventListener("keydown", this.keys);
    this.build();
  }

  // -- the persistent page -------------------------------------------------------------

  build() {
    const t = this.t;
    this.main.innerHTML = `<div class="rp" data-mode="ready">
  <section class="rp-ready" aria-labelledby="rp-ready-title">
    <p class="sd-eyebrow" data-ready-eyebrow></p>
    <h1 class="rj-title" id="rp-ready-title" data-ready-title></h1>
    <p class="sd-lead" data-ready-subtitle></p>
    <p class="rp-label" data-ready-label></p>
    <ol class="rp-steps" data-ready-steps></ol>
  </section>
  <section class="rp-stage" aria-labelledby="rp-step-title" hidden>
    <div class="rp-top">
      <p class="rp-count" data-count></p>
      <div class="rp-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" data-progress-bar><span data-progress></span></div>
    </div>
    <div class="rp-media" data-media></div>
    <p class="rp-caption" aria-live="polite" data-caption></p>
    <div class="rp-overlay" data-overlay hidden></div>
  </section>
  <aside class="rp-side">
    <div class="rp-info" data-info hidden>
      <p class="rp-phase" data-phase></p>
      <h1 class="rp-step-title" id="rp-step-title" data-step-title tabindex="-1"></h1>
      <p class="rp-setline" data-setline></p>
      <p class="rp-big" aria-live="off" data-big></p>
      <p class="rp-note" data-note></p>
      <p class="rp-next" data-next></p>
    </div>
    <div class="rp-anatomy" data-anatomy-host>
      <div class="rp-anatomy-bar">
        <h2 class="rp-anatomy-title">${esc(t("rp.anatomy_title"))}</h2>
        <button class="rp-small" data-anatomy-expand>${esc(t("rp.anatomy_expand"))}</button>
      </div>
      <p class="rp-anatomy-status" data-anatomy-status role="status">${esc(t("rp.anatomy_loading"))}</p>
      <div class="rp-anatomy-tools" data-anatomy-tools hidden>
        <button data-view="anterior">${esc(t("rp.anatomy_front"))}</button>
        <button data-view="lateral">${esc(t("rp.anatomy_side"))}</button>
        <button data-view="posterior">${esc(t("rp.anatomy_back"))}</button>
        <button data-zoom="1.25" aria-label="${esc(t("rp.zoom_in"))}">+</button>
        <button data-zoom="0.8" aria-label="${esc(t("rp.zoom_out"))}">−</button>
        <button data-skeleton>${esc(t("rp.anatomy_skeleton"))}</button>
        <button data-whole>${esc(t("rp.anatomy_whole"))}</button>
        <button class="sd-primary" data-anatomy-return>${esc(t("rp.anatomy_return"))}</button>
        <button class="rp-unwell" data-act="unwell" data-anatomy-unwell>${esc(t("rp.unwell"))}</button>
      </div>
      <p class="rp-anatomy-hint" data-anatomy-hint hidden>${esc(t("rp.anatomy_tap"))}</p>
      <p class="rp-anatomy-cue" data-anatomy-cue></p>
      <p class="rp-anatomy-label" data-anatomy-label></p>
    </div>
  </aside>
  <div class="rp-controls" data-controls></div>
  <div class="rp-settings" data-settings></div>
  <dialog class="rp-dialog" data-unwell-dialog aria-labelledby="rp-unwell-title"></dialog>
  <dialog class="rp-dialog" data-end-dialog aria-labelledby="rp-end-title"></dialog>
</div>`;
    this.root = this.main.querySelector(".rp");
    this.$ = (sel) => this.root.querySelector(sel);
    this.anatomyHost = this.$("[data-anatomy-host]");
    this.anatomy = new AnatomyPanel(this.anatomyHost, {
      lang: this.lang,
      onReady: () => {
        this.$("[data-anatomy-status]").textContent = "";
        this.syncAnatomy(true);
      },
      onSelect: (key, name) => this.onStructure(key, name),
      onError: () => {
        this.$("[data-anatomy-status]").textContent = this.t("rp.anatomy_failed");
      },
    });
    this.root.addEventListener("click", (event) => this.onClick(event));
    this.root.addEventListener("change", (event) => this.onChange(event));
    this.root.addEventListener("input", (event) => this.onInput(event));
  }

  // -- server state -> screen ----------------------------------------------------------

  update(ctx) {
    this.ctx = ctx;
    this.t = ctx.t;
    const j = ctx.journey;
    const w = j && j.workout;
    if (!w || !this.root) return;
    this.workout = w;
    this.journeyState = j.state;
    const lang = String(ctx.lang);
    const langChanged = lang !== this.lang;
    if (langChanged) {
      this.lang = lang;
      this.anatomy.setLang(lang);
      this.narrator.setLang(lang);
      this.relabel();
    }
    if (j.state === "ready_to_train") {
      this.stopClock();
      this.root.dataset.mode = "ready";
      this.renderReady();
      return;
    }
    this.root.dataset.mode = j.state === "exercise_paused" ? "paused" : "exercise";
    this.$(".rp-ready").hidden = true;
    this.$(".rp-stage").hidden = false;
    this.$("[data-info]").hidden = false;
    const step = w.steps[w.current_index];
    if (!step) return;
    const key = `${w.id}:${step.position}:${step.variant}`;
    const fresh = key !== this.key;
    if (fresh) {
      this.key = key;
      this.step = step;
      this.content = (step.variant !== "standard" && step.variants[step.variant]) || step.content;
      // A new step starts its own clock; a resumed page continues from the saved position.
      this.elapsed = j.state === "exercise_paused" || this.firstPaint === undefined ? w.position_ms || 0 : 0;
      this.firstPaint = false;
      this.phase = "work";
      this.renderStep(true);
    } else if (langChanged) {
      this.content = (step.variant !== "standard" && step.variants[step.variant]) || step.content;
      this.step = step;
      this.renderStep(false);
    }
    this.renderControls();
    this.renderSettings();
    if (j.state === "exercise_paused") {
      this.stopClock();
      this.media("pause");
      this.music.pause();
      this.narrator.stop();
      if (this.phase !== "presence") this.overlay("paused");
    } else {
      if (this.phase === "presence") this.phase = "work";
      const shown = this.$("[data-overlay]").dataset.kind;
      if (this.phase === "work" || shown === "paused" || shown === "presence") this.overlay(null);
      this.music.resume();
      this.startClock();
      if (fresh) this.speakStep();
    }
  }

  relabel() {
    // Static labels of the persistent page (the rest is redrawn from server copy).
    const t = this.t;
    this.$(".rp-anatomy-title").textContent = t("rp.anatomy_title");
    this.$("[data-anatomy-expand]").textContent = this.expanded ? t("rp.anatomy_return") : t("rp.anatomy_expand");
    this.$("[data-anatomy-hint]").textContent = t("rp.anatomy_tap");
    const tools = this.$("[data-anatomy-tools]");
    tools.querySelector('[data-view="anterior"]').textContent = t("rp.anatomy_front");
    tools.querySelector('[data-view="lateral"]').textContent = t("rp.anatomy_side");
    tools.querySelector('[data-view="posterior"]').textContent = t("rp.anatomy_back");
    tools.querySelector("[data-skeleton]").textContent = t("rp.anatomy_skeleton");
    tools.querySelector("[data-whole]").textContent = t("rp.anatomy_whole");
    tools.querySelector("[data-anatomy-return]").textContent = t("rp.anatomy_return");
    tools.querySelector("[data-anatomy-unwell]").textContent = t("rp.unwell");
    tools.querySelector('[data-zoom="1.25"]').setAttribute("aria-label", t("rp.zoom_in"));
    tools.querySelector('[data-zoom="0.8"]').setAttribute("aria-label", t("rp.zoom_out"));
  }

  renderReady() {
    const t = this.t;
    const w = this.workout;
    this.$(".rp-ready").hidden = false;
    this.$(".rp-stage").hidden = true;
    this.$("[data-info]").hidden = true;
    this.$("[data-ready-eyebrow]").textContent = t("rp.ready_eyebrow");
    this.$("[data-ready-title]").textContent = w.title || "";
    const minutes = t("rp.ready_minutes", { minutes: w.planned_minutes });
    this.$("[data-ready-subtitle]").textContent = [w.subtitle, minutes, t("rp.ready_steps", { count: w.steps.length })]
      .filter(Boolean).join(" · ");
    this.$("[data-ready-label]").textContent = w.kind === "course"
      ? t("rp.version", { version: w.course_version }) : (w.content_label || "");
    let phase = null;
    this.$("[data-ready-steps]").innerHTML = w.steps.map((s) => {
      const head = s.phase !== phase ? `<li class="rp-steps-phase" aria-hidden="true">${esc(t(PHASE_KEYS[s.phase] || "rp.phase_main"))}</li>` : "";
      phase = s.phase;
      const mins = Math.max(1, Math.round((s.planned_seconds || 0) / 60));
      return `${head}<li class="rp-steps-item"><span>${esc(s.content.title)}</span><span class="rp-steps-min">${esc(t("rp.minutes_short", { minutes: mins }))}</span></li>`;
    }).join("");
    this.renderControls();
    this.renderSettings();
    // Warm the viewer with the first exercise so the first step shows it at once.
    const first = w.steps[0];
    if (first) this.anatomy.show(anatomyStateAt(first.content, 0));
    this.$("[data-anatomy-label]").textContent = w.anatomy_label || "";
  }

  renderStep(restart) {
    const t = this.t;
    const w = this.workout;
    const c = this.content;
    const step = this.step;
    this.$("[data-count]").textContent = t("rp.exercise_of", { n: step.position + 1, total: w.steps.length });
    this.$("[data-phase]").textContent = t(PHASE_KEYS[step.phase] || "rp.phase_main");
    this.$("[data-step-title]").textContent = c.title || "";
    const next = w.steps[step.position + 1];
    this.$("[data-next]").textContent = next ? t("rp.next", { title: next.content.title }) : t("rp.last");
    this.$("[data-anatomy-label]").textContent = c.anatomy?.label || w.anatomy_label || "";
    if (restart) {
      this.renderMedia();
      this.lastAnatomy = null;
      this.syncAnatomy(true);
      if (next) this.anatomy.preload((next.content.anatomy?.structures || []).map((s) => s.key));
      this.$("[data-step-title]").focus({ preventScroll: true });
    } else {
      this.renderMedia(true);
    }
    this.tick();
  }

  renderMedia(keepVideo = false) {
    const t = this.t;
    const c = this.content;
    const box = this.$("[data-media]");
    const instructions = (c.instructions || []).length
      ? `<ol class="rp-instructions">${c.instructions.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>` : "";
    const details = `<div class="rp-card">
      ${c.setup ? `<p class="rp-setup"><strong>${esc(t("rp.setup"))}</strong> ${esc(c.setup)}</p>` : ""}
      ${instructions}
      ${c.cue ? `<p class="rp-cue">${esc(c.cue)}</p>` : ""}
      ${c.breath ? `<p class="rp-breath"><strong>${esc(t("rp.breath"))}</strong> ${esc(c.breath)}</p>` : ""}
      ${c.stop_if ? `<p class="rp-stopif"><strong>${esc(t("rp.stop_if"))}</strong> ${esc(c.stop_if)}</p>` : ""}
    </div>`;
    if (c.video && c.video.url) {
      const existing = box.querySelector("video");
      if (keepVideo && existing && existing.dataset.src === c.video.url) {
        box.querySelector(".rp-card")?.replaceWith(fragment(details));
        return;
      }
      box.innerHTML = `<video class="rp-video" playsinline loop preload="auto" data-src="${esc(c.video.url)}" src="${esc(c.video.url)}"></video>${details}`;
      const video = box.querySelector("video");
      video.addEventListener("seeked", () => this.syncAnatomy());
      video.addEventListener("timeupdate", () => this.syncAnatomy());
      if (this.root.dataset.mode === "exercise") video.play().catch(() => {});
      return;
    }
    const picture = c.image && c.image.url
      ? `<figure class="rp-figure"><img src="${esc(c.image.url)}" alt="${esc(c.image.description || c.title || "")}"><figcaption>${esc(c.image.label || "")}</figcaption></figure>`
      : `<p class="rp-nomedia">${esc(t("rp.no_media"))}</p>`;
    box.innerHTML = picture + details;
  }

  video() {
    return this.$("[data-media] video");
  }

  media(action) {
    const video = this.video();
    if (!video) return;
    if (action === "pause") video.pause();
    else if (action === "play") video.play().catch(() => {});
    else if (action === "restart") {
      video.currentTime = 0;
      video.play().catch(() => {});
    }
  }

  // -- the clock ---------------------------------------------------------------------

  running() {
    return this.started !== null;
  }

  startClock() {
    if (this.running() || this.phase !== "work") return;
    this.started = now();
    this.media("play");
    clearInterval(this.timer);
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  stopClock() {
    if (this.running()) this.elapsed += now() - this.started;
    this.started = null;
    clearInterval(this.timer);
    this.timer = null;
  }

  ms() {
    return this.elapsed + (this.running() ? now() - this.started : 0);
  }

  tick() {
    if (!this.content) return;
    const t = this.t;
    const dose = this.content.dose || {};
    const at = this.ms();
    const p = positionAt(dose, at);
    const sides = { left: t("rp.side_left"), right: t("rp.side_right"), alternate: t("rp.side_alternate") };
    this.$("[data-setline]").textContent = [t("rp.set_of", { set: p.set, sets: p.sets }), sides[p.side] || ""]
      .filter(Boolean).join(" · ");
    let big = "";
    let note = "";
    if (p.kind === "reps") {
      big = t("rp.rep_pace", { rep: p.rep || 1, reps: p.reps || dose.reps || 0 });
      note = t("rp.pace_note");
    } else if (p.kind === "hold") {
      big = t("rp.hold_seconds", { s: p.remaining_s });
    } else if (p.kind === "rest") {
      big = t("rp.rest_seconds", { s: p.remaining_s });
    } else if (p.kind === "switch") {
      big = t("rp.switch_sides");
    }
    this.$("[data-big]").textContent = big;
    this.$("[data-note]").textContent = note;
    const w = this.workout;
    const overall = ((this.step.position + Math.min(1, p.progress)) / Math.max(1, w.steps.length)) * 100;
    this.$("[data-progress]").style.width = `${overall.toFixed(1)}%`;
    this.$("[data-progress-bar]").setAttribute("aria-valuenow", String(Math.round(overall)));
    if (!this.video()) this.syncAnatomy();
    if (this.phase === "work" && this.running() && at >= workMs(dose)) this.workDone();
  }

  syncAnatomy(force = false) {
    if (!this.content || this.expanded) return;
    const video = this.video();
    const ms = video ? video.currentTime * 1000 : this.ms();
    const state = anatomyStateAt(this.content, ms);
    if (force) this.anatomy.lastKey = null;
    this.anatomy.show(state);
    this.$("[data-anatomy-cue]").textContent = state.cue || "";
  }

  speakStep() {
    if (!this.content || this.lastSpoken === this.key) return;
    this.lastSpoken = this.key;
    const lines = this.content.narration && this.content.narration.length ? this.content.narration : [this.content.setup || this.content.title];
    this.narrator.speak(lines.filter(Boolean));
  }

  caption(text) {
    const box = this.$("[data-caption]");
    if (box) box.textContent = text || "";
  }

  workDone() {
    this.stopClock();
    this.media("pause");
    const w = this.workout;
    const decision = afterWork({ autoNext: w.auto_next, isLast: this.step.position === w.steps.length - 1 });
    if (decision.action === "finish") {
      this.phase = "waiting";
      this.overlay("finish");
    } else if (decision.action === "transition") {
      this.phase = "transition";
      this.countdown = decision.seconds || TRANSITION_SECONDS;
      this.overlay("transition");
      const next = w.steps[this.step.position + 1];
      if (next) this.narrator.speak([this.t("rp.next", { title: next.content.title })]);
      clearInterval(this.timer);
      this.timer = setInterval(() => {
        this.countdown -= 1;
        const count = this.root.querySelector("[data-countdown]");
        if (count) count.textContent = this.t("rp.transition_count", { s: Math.max(0, this.countdown) });
        if (this.countdown <= 0) {
          clearInterval(this.timer);
          this.timer = null;
          this.autoAdvance();
        }
      }, 1000);
    } else {
      this.phase = "waiting";
      this.overlay("waiting");
    }
  }

  autoAdvance() {
    if (this.presence.autoAdvanced()) {
      // Three automatic advances and no touch: ask, and let the room idle if nobody answers.
      this.phase = "presence";
      this.overlay("presence");
      this.request("workout/pause", { position_ms: Math.round(this.ms()), reason: "presence" });
      return;
    }
    this.ctx.markActivity?.();
    this.complete("completed");
  }

  // -- requests ------------------------------------------------------------------------

  async request(name, body = {}) {
    if (this.busy) return null;
    this.busy = true;
    this.root.setAttribute("aria-busy", "true");
    try {
      return await this.ctx.act(name, body);
    } catch {
      return null; // the shell's banner has explained it
    } finally {
      this.busy = false;
      this.root?.removeAttribute("aria-busy");
    }
  }

  complete(outcome) {
    this.overlay(null);
    this.narrator.stop();
    this.phase = "work";
    return this.request("workout/step", { position: this.step.position, outcome });
  }

  pause(reason = "customer") {
    this.stopClock();
    // A pause also stops a "get ready" countdown. On resume the clock sees the work is
    // done and shows the countdown (or the Done prompt) again from the start.
    clearInterval(this.timer);
    this.timer = null;
    if (this.phase === "transition" || this.phase === "waiting") this.phase = "work";
    return this.request("workout/pause", { position_ms: Math.round(this.elapsed), reason });
  }

  resume() {
    return this.request("workout/resume");
  }

  // -- controls ------------------------------------------------------------------------

  renderControls() {
    const t = this.t;
    const box = this.$("[data-controls]");
    const w = this.workout;
    if (this.root.dataset.mode === "ready") {
      box.innerHTML = `<button class="sd-primary sd-large rp-go" data-act="start">${esc(t("rp.start"))}</button>
        <button class="sd-large" data-act="cancel">${esc(t("rp.choose_other"))}</button>
        <button class="sd-large rp-unwell" data-act="unwell">${esc(t("rp.unwell"))}</button>`;
      return;
    }
    const step = this.step;
    const paused = this.root.dataset.mode === "paused";
    const variants = step.variants || {};
    const variantButtons = [
      variants.easier ? `<button data-act="variant" data-variant="${step.variant === "easier" ? "standard" : "easier"}" aria-pressed="${step.variant === "easier"}">${esc(step.variant === "easier" ? t("rp.standard") : t("rp.easier"))}</button>` : "",
      variants.harder ? `<button data-act="variant" data-variant="${step.variant === "harder" ? "standard" : "harder"}" aria-pressed="${step.variant === "harder"}">${esc(step.variant === "harder" ? t("rp.standard") : t("rp.harder"))}</button>` : "",
    ].join("");
    box.innerHTML = `<div class="rp-controls-main">
        <button class="sd-primary sd-large rp-go" data-act="${paused ? "resume" : "pause"}">${esc(paused ? t("rp.continue") : t("rp.pause"))}</button>
        <button class="sd-large" data-act="done">${esc(step.position === w.steps.length - 1 ? t("rp.finish") : t("rp.done_next"))}</button>
      </div>
      <div class="rp-controls-more">
        <button data-act="previous" ${step.position === 0 ? "disabled" : ""}>${esc(t("rp.previous"))}</button>
        <button data-act="repeat">${esc(t("rp.repeat"))}</button>
        <button data-act="skip">${esc(t("rp.skip"))}</button>
        ${variantButtons}
        <button data-act="anatomy">${esc(t("rp.anatomy"))}</button>
        <button data-act="end">${esc(t("rp.end"))}</button>
        <button class="rp-unwell" data-act="unwell">${esc(t("rp.unwell"))}</button>
      </div>`;
  }

  renderSettings() {
    const t = this.t;
    const w = this.workout;
    const musicOptions = MUSIC_MODES.map((m) => `<option value="${m}" ${this.music.mode === m ? "selected" : ""}>${esc(t(`rp.music_${m}`))}</option>`).join("");
    this.$("[data-settings]").innerHTML = `<details class="rp-sound" ${this.root.dataset.mode === "ready" ? "open" : ""}>
      <summary>${esc(t("rp.settings"))}</summary>
      <div class="rp-sound-grid">
        <label class="rp-toggle"><input type="checkbox" data-setting="auto_next" ${w.auto_next ? "checked" : ""}> <span>${esc(t("rp.auto_next"))}</span></label>
        <p class="rp-hint">${esc(t("rp.auto_next_hint"))}</p>
        <label class="rp-toggle"><input type="checkbox" data-setting="narration" ${this.narrationOn ? "checked" : ""}> <span>${esc(t("rp.narration"))}</span></label>
        ${this.narrator.available ? "" : `<p class="rp-hint">${esc(t("rp.narration_unavailable"))}</p>`}
        <label class="rp-range"><span>${esc(t("rp.volume_narration"))}</span><input type="range" min="0" max="1" step="0.05" value="${this.narrationVolume}" data-volume="narration"></label>
        <label class="rp-select"><span>${esc(t("rp.music"))}</span><select data-setting="music" ${this.music.available ? "" : "disabled"}>${musicOptions}</select></label>
        ${this.music.available ? "" : `<p class="rp-hint">${esc(t("rp.music_unavailable"))}</p>`}
        <label class="rp-file" ${this.music.mode === "own" ? "" : "hidden"} data-own-file><span>${esc(t("rp.music_own_hint"))}</span><input type="file" accept="audio/*" data-setting="music_file"></label>
        <label class="rp-range"><span>${esc(t("rp.volume_music"))}</span><input type="range" min="0" max="1" step="0.05" value="${this.musicVolume}" data-volume="music"></label>
      </div>
    </details>`;
  }

  overlay(kind) {
    const box = this.$("[data-overlay]");
    const t = this.t;
    if (!kind) {
      box.hidden = true;
      box.innerHTML = "";
      delete box.dataset.kind;
      return;
    }
    const w = this.workout;
    const next = w.steps[this.step.position + 1];
    let html = "";
    if (kind === "paused") {
      html = `<h2>${esc(t("rp.paused_title"))}</h2><p>${esc(t("rp.paused_body"))}</p><button class="sd-primary sd-large" data-act="resume">${esc(t("rp.continue"))}</button>`;
    } else if (kind === "presence") {
      html = `<h2>${esc(t("rp.presence_title"))}</h2><p>${esc(t("rp.presence_body"))}</p><button class="sd-primary sd-large" data-act="presence">${esc(t("rp.continue"))}</button>`;
    } else if (kind === "transition" && next) {
      const c = next.content;
      const equipment = (c.equipment || []).map((e) => t(`rp.equipment_${e}`) === `rp.equipment_${e}` ? e : t(`rp.equipment_${e}`)).join(", ");
      html = `<p class="sd-eyebrow">${esc(t("rp.transition_title"))}</p><h2>${esc(c.title)}</h2>
        ${c.setup ? `<p>${esc(c.setup)}</p>` : ""}${equipment ? `<p class="rp-hint">${esc(t("rp.equipment", { items: equipment }))}</p>` : ""}
        <p class="rp-countdown" aria-live="assertive" data-countdown>${esc(t("rp.transition_count", { s: this.countdown }))}</p>
        <div class="rj-actions"><button class="sd-primary sd-large" data-act="start-now">${esc(t("rp.start_now"))}</button><button class="sd-large" data-act="pause">${esc(t("rp.pause"))}</button></div>`;
    } else if (kind === "waiting") {
      html = `<h2>${esc(t("rp.well_done"))}</h2>${next ? `<p>${esc(t("rp.next", { title: next.content.title }))}</p>` : ""}<button class="sd-primary sd-large" data-act="done">${esc(t("rp.done_next"))}</button>`;
    } else if (kind === "finish") {
      html = `<h2>${esc(t("rp.last_done"))}</h2><button class="sd-primary sd-large" data-act="done">${esc(t("rp.finish"))}</button>`;
    }
    box.innerHTML = html;
    box.hidden = !html;
    box.dataset.kind = kind;
    box.querySelector("button")?.focus({ preventScroll: true });
  }

  async onClick(event) {
    const button = event.target.closest("button");
    if (!button || button.disabled || !this.root.contains(button)) return;
    if (button.matches("[data-anatomy-expand]")) return this.toggleAnatomy(!this.expanded);
    if (button.matches("[data-anatomy-return]")) return this.toggleAnatomy(false);
    if (button.dataset.view) return this.anatomy.view(button.dataset.view);
    if (button.dataset.zoom) return this.anatomy.zoom(Number(button.dataset.zoom));
    if (button.matches("[data-skeleton]")) return this.anatomy.skeleton();
    if (button.matches("[data-whole]")) {
      this.$("[data-anatomy-cue]").textContent = "";
      this.anatomy.clear();
      return;
    }
    const act = button.dataset.act;
    switch (act) {
      case "start":
        // The Start tap is the user gesture that lets sound play.
        if (this.music.mode !== "off") this.music.setMode(this.music.mode);
        return this.request("workout/start");
      case "cancel":
        return this.request("workout/cancel");
      case "pause":
        return this.pause("customer");
      case "resume":
        return this.resume();
      case "presence":
        this.presence.touched();
        this.phase = "work";
        await this.resume();
        // The step's work was already done when the room asked: move on now.
        if (this.ms() >= workMs(this.content.dose || {})) this.complete("completed");
        return;
      case "start-now":
        clearInterval(this.timer);
        this.timer = null;
        return this.complete("completed");
      case "done":
        return this.complete("completed");
      case "skip":
        return this.complete("skipped");
      case "previous":
        return this.request("workout/previous");
      case "repeat":
        this.elapsed = 0;
        if (this.running()) this.started = now();
        this.phase = "work";
        this.overlay(null);
        this.media("restart");
        this.lastSpoken = null;
        this.speakStep();
        this.syncAnatomy(true);
        if (this.root.dataset.mode === "exercise") this.startClock();
        return;
      case "variant":
        return this.request("workout/variant", { position: this.step.position, variant: button.dataset.variant });
      case "anatomy":
        return this.toggleAnatomy(true);
      case "end":
        return this.openEnd();
      case "unwell":
        return this.openUnwell();
      default:
    }
  }

  onChange(event) {
    const input = event.target;
    const setting = input.dataset.setting;
    if (setting === "auto_next") {
      this.request("workout/settings", { auto_next: input.checked });
    } else if (setting === "narration") {
      this.narrationOn = input.checked;
      this.narrator.setEnabled(input.checked);
      this.ctx.event?.("narration_toggled", { on: input.checked });
    } else if (setting === "music") {
      const mode = this.music.setMode(input.value);
      this.root.querySelector("[data-own-file]").hidden = mode !== "own";
      this.ctx.event?.("music_changed", { mode });
      if (this.root.dataset.mode !== "exercise") this.music.pause();
    } else if (setting === "music_file" && input.files && input.files[0]) {
      this.music.useFile(input.files[0]);
      this.music.setMode("own");
    }
  }

  onInput(event) {
    const kind = event.target.dataset.volume;
    if (kind === "narration") {
      this.narrationVolume = Number(event.target.value);
      this.narrator.setVolume(this.narrationVolume);
    } else if (kind === "music") {
      this.musicVolume = Number(event.target.value);
      this.music.setVolume(this.musicVolume);
    }
  }

  onKey(event) {
    if (!this.root || this.root.dataset.mode === "ready") return;
    if (event.target.closest?.("input, select, textarea, dialog")) return;
    if (event.key === " " || event.key === "Spacebar") {
      event.preventDefault();
      if (this.root.dataset.mode === "paused") this.resume();
      else this.pause("customer");
    } else if (event.key === "Escape" && this.expanded) {
      this.toggleAnatomy(false);
    }
  }

  // -- anatomy expanded ----------------------------------------------------------------

  async toggleAnatomy(open) {
    if (open === this.expanded) return;
    this.expanded = open;
    this.anatomy.setExpanded(open);
    this.root.classList.toggle("rp-expanded", open);
    this.$("[data-anatomy-tools]").hidden = !open;
    this.$("[data-anatomy-hint]").hidden = !open;
    this.$("[data-anatomy-expand]").textContent = open ? this.t("rp.anatomy_return") : this.t("rp.anatomy_expand");
    if (open) {
      this.ctx.event?.("anatomy_opened", { position: this.step ? this.step.position : 0 });
      // The workout pauses while anatomy is open (brief §32) and continues on return.
      if (this.root.dataset.mode === "exercise") {
        this.resumeAfterAnatomy = true;
        await this.pause("anatomy");
      }
      this.$("[data-anatomy-return]").focus({ preventScroll: true });
    } else {
      this.anatomy.view("anterior");
      this.syncAnatomy(true);
      if (this.resumeAfterAnatomy && this.root.dataset.mode === "paused") await this.resume();
      this.resumeAfterAnatomy = false;
      this.$("[data-anatomy-expand]").focus({ preventScroll: true });
    }
  }

  onStructure(key, name) {
    if (!this.expanded) return;
    this.anatomy.isolate(key);
    this.$("[data-anatomy-cue]").textContent = this.t("rp.anatomy_isolated", { name: name || key });
    this.ctx.event?.("structure_isolated", { source: "room" });
  }

  // -- dialogs -------------------------------------------------------------------------

  openUnwell() {
    const t = this.t;
    const u = this.ctx.journey.unwell || {};
    const card = this.ctx.journey.stop_card || {};
    const dialog = this.$("[data-unwell-dialog]");
    const wasRunning = this.root.dataset.mode === "exercise";
    if (wasRunning) {
      this.stopClock();
      this.media("pause");
    }
    dialog.innerHTML = `<h2 id="rp-unwell-title">${esc(t("rp.unwell_title"))}</h2>
      <p class="sd-lead">${esc(u.urgent_question || "")}</p>
      <ul class="rp-signs">${(u.urgent_signs || []).map((s) => `<li>${esc(s)}</li>`).join("")}</ul>
      <p class="rp-urgent-now">${esc(t("rp.urgent_now"))}</p>
      <div class="rj-actions"><button class="rp-urgent sd-large" data-unwell="urgent">${esc(t("rp.urgent_yes"))}</button>
      <button class="sd-large" data-unwell="no">${esc(t("rp.urgent_no"))}</button></div>
      <div data-unwell-categories hidden><p class="sd-lead">${esc(u.category_question || "")}</p>
        <div class="rj-actions">${(u.categories || []).map((c) => `<button class="sd-large" data-category="${esc(c.id)}">${esc(c.label)}</button>`).join("")}</div></div>
      ${card.title ? `<details class="rp-stopcard"><summary>${esc(card.title)}</summary><ul>${(card.items || []).map((s) => `<li>${esc(s)}</li>`).join("")}</ul><p>${esc(card.action || "")}</p></details>` : ""}
      <div class="rj-actions"><button class="sd-ghost" data-unwell="cancel">${esc(t("rp.back_to_session"))}</button></div>`;
    const close = () => {
      dialog.close();
      if (wasRunning && this.root.dataset.mode === "exercise") this.startClock();
    };
    dialog.onclick = async (event) => {
      const b = event.target.closest("button");
      if (!b) return;
      if (b.dataset.unwell === "urgent") {
        dialog.close();
        await this.request("workout/unwell", { urgent: true });
      } else if (b.dataset.unwell === "no") {
        dialog.querySelector("[data-unwell-categories]").hidden = false;
        dialog.querySelector("[data-category]")?.focus();
      } else if (b.dataset.category) {
        dialog.close();
        await this.request("workout/unwell", { urgent: false, category: b.dataset.category });
      } else if (b.dataset.unwell === "cancel") {
        close();
      }
    };
    dialog.oncancel = (event) => {
      event.preventDefault();
      close();
    };
    if (dialog.showModal) dialog.showModal();
    dialog.querySelector("button")?.focus();
  }

  openEnd() {
    const t = this.t;
    const dialog = this.$("[data-end-dialog]");
    dialog.innerHTML = `<h2 id="rp-end-title">${esc(t("rp.end_title"))}</h2><p class="sd-lead">${esc(t("rp.end_body"))}</p>
      <div class="rj-actions"><button class="sd-primary sd-large" data-end="yes">${esc(t("rp.end_confirm"))}</button>
      <button class="sd-large" data-end="no">${esc(t("rp.keep_going"))}</button></div>`;
    dialog.onclick = async (event) => {
      const b = event.target.closest("button");
      if (!b) return;
      dialog.close();
      if (b.dataset.end === "yes") await this.request("workout/end");
    };
    if (dialog.showModal) dialog.showModal();
    dialog.querySelector("button")?.focus();
  }

  destroy() {
    this.stopClock();
    clearInterval(this.timer);
    document.removeEventListener("pointerdown", this.touch);
    document.removeEventListener("keydown", this.touch);
    document.removeEventListener("keydown", this.keys);
    this.narrator.stop();
    this.music.destroy();
    this.anatomy.destroy();
    this.media("pause");
    this.root = null;
  }
}

function fragment(html) {
  const template = document.createElement("template");
  template.innerHTML = html;
  return template.content;
}
