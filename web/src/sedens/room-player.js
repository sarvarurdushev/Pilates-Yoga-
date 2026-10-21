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
import { anatomyStateAt, AnatomyPanel, stepStructures } from "./room-anatomy.js";
import { sedens } from "./api.js";
import { createNarrator } from "./room-narration.js";
import { cuesOf, subtitleAt, dueCue, hasSpoken, recordingStartMs, recordingSync, pickProvider } from "./room-cues.js";
import { effectiveVolume, narrationLanguage, textLanguage, loadSound, saveSound, soundKey } from "./room-sound.js";
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
    this.sel = null; // expanded anatomy: { mode, keys, skeleton }
    this.names = {}; // structure key -> name in the viewer's language (drawn structures only)
    this.asked = new Set(); // keys whose name has been asked for in this language
    this.absent = new Set(); // keys this atlas does not draw (selecting one would show nothing)
    this.stepState = null;
    this.presence = presenceTracker();
    this.timer = null;
    // Sound settings live for the room visit (session storage keyed by it), so a step, a language
    // change or a page reload keeps them.
    this.soundKey = soundKey(ctx.session && ctx.session.expires_at);
    this.sound = loadSound(browserStorage(), this.soundKey);
    // Timed narration of the current step (room-cues.js).
    this.cues = [];
    this.handled = new Set();
    this.shownCue = -2;
    this.recStart = 0;
    this.recordingFailed = false;
    this.audioBlockedUntil = 0;
    this.recSettled = false;
    this.alt = {}; // narration language -> that language's steps (SEDENS Standard only)
    this.altAsked = new Set();
    this.altWorkout = null;
    this.music = createMusic();
    this.narrator = createNarrator({
      lang: narrationLanguage(this.sound.lang, this.lang),
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
    <p class="rp-caption" aria-live="polite" aria-atomic="true" data-caption></p>
    <div class="rp-soundbar" role="group" data-soundbar>
      <button type="button" class="rp-small" data-act="mute-all" aria-pressed="false"></button>
      <button type="button" class="rp-small" data-act="subtitles" aria-pressed="true"></button>
      <span class="rp-sound-status" role="status" data-sound-status></span>
    </div>
    <audio class="rp-narration-audio" data-narration-audio preload="auto"></audio>
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
        <div class="rp-tool-group" role="group" data-group="mode" aria-label="${esc(t("rp.anatomy_mode_group"))}">
          <button data-mode="highlight" aria-pressed="true">${esc(t("rp.anatomy_mode_highlight"))}</button>
          <button data-mode="isolate" aria-pressed="false">${esc(t("rp.anatomy_mode_isolate"))}</button>
        </div>
        <div class="rp-tool-group" role="group" data-group="picks" aria-label="${esc(t("rp.anatomy_picks"))}" data-anatomy-picks hidden></div>
        <div class="rp-tool-group" role="group" data-group="move" aria-label="${esc(t("rp.anatomy_move_group"))}">
          <button data-view="anterior">${esc(t("rp.anatomy_front"))}</button>
          <button data-view="lateral">${esc(t("rp.anatomy_side"))}</button>
          <button data-view="posterior">${esc(t("rp.anatomy_back"))}</button>
          <button data-turn="-45">${esc(t("rp.anatomy_turn_left"))}</button>
          <button data-turn="45">${esc(t("rp.anatomy_turn_right"))}</button>
          <button data-zoom="1.25" aria-label="${esc(t("rp.zoom_in"))}">+</button>
          <button data-zoom="0.8" aria-label="${esc(t("rp.zoom_out"))}">−</button>
        </div>
        <div class="rp-tool-group" role="group" data-group="body" aria-label="${esc(t("rp.anatomy_body_group"))}">
          <button data-skeleton aria-pressed="false">${esc(t("rp.anatomy_skeleton"))}</button>
          <button data-whole>${esc(t("rp.anatomy_whole"))}</button>
        </div>
        <div class="rp-tool-group" role="group" data-group="leave">
          <button class="sd-primary" data-anatomy-return>${esc(t("rp.anatomy_return"))}</button>
          <button class="rp-unwell" data-act="unwell" data-anatomy-unwell>${esc(t("rp.unwell"))}</button>
        </div>
      </div>
      <p class="rp-anatomy-hint" data-anatomy-hint hidden>${esc(t("rp.anatomy_tap"))}</p>
      <p class="rp-anatomy-selection" data-anatomy-selection role="status" aria-live="polite"></p>
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
        this.requestNames();
      },
      onSelect: (key, name) => this.onStructure(key, name),
      onNames: (names) => this.onNames(names),
      onError: () => {
        this.$("[data-anatomy-status]").textContent = this.t("rp.anatomy_failed");
      },
    });
    this.root.addEventListener("click", (event) => this.onClick(event));
    this.root.addEventListener("change", (event) => this.onChange(event));
    this.root.addEventListener("input", (event) => this.onInput(event));
    // The creator's recording follows the step clock; the ducking and a failed file are noticed here.
    const recording = this.audioEl();
    recording.addEventListener("playing", () => this.music.duck(true));
    recording.addEventListener("pause", () => this.music.duck(false));
    recording.addEventListener("ended", () => this.music.duck(false));
    recording.addEventListener("error", () => {
      // A recording the browser cannot decode (for example AAC in some builds): speech or subtitles take over.
      this.recordingFailed = true;
      this.music.duck(false);
      this.renderVoiceSource();
    });
    this.applySound(false);
  }

  // -- server state -> screen ----------------------------------------------------------

  update(ctx) {
    this.ctx = ctx;
    this.t = ctx.t;
    const j = ctx.journey;
    const w = j && j.workout;
    if (!w || !this.root) return;
    this.workout = w;
    if (this.altWorkout !== w.id) {
      this.altWorkout = w.id;
      this.alt = {};
      this.altAsked.clear();
    }
    this.journeyState = j.state;
    const lang = String(ctx.lang);
    const langChanged = lang !== this.lang;
    if (langChanged) {
      this.lang = lang;
      this.anatomy.setLang(lang);
      this.narrator.setLang(this.narrLang());
      // The previous names stay until the viewer's reply replaces them, so the list does not blink out.
      this.asked.clear();
      this.requestNames();
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
      this.resetNarration();
      this.renderStep(true);
    } else if (langChanged) {
      this.content = (step.variant !== "standard" && step.variants[step.variant]) || step.content;
      this.step = step;
      this.rebuildCues();
      this.renderStep(false);
    }
    this.renderControls();
    this.renderSettings();
    if (j.state === "exercise_paused") {
      this.stopClock();
      this.media("pause");
      this.music.pause();
      this.silence();
      if (this.phase !== "presence") this.overlay("paused");
    } else {
      if (this.phase === "presence") this.phase = "work";
      const shown = this.$("[data-overlay]").dataset.kind;
      if (this.phase === "work" || shown === "paused" || shown === "presence") this.overlay(null);
      this.music.resume();
      this.startClock();
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
    tools.querySelector('[data-mode="highlight"]').textContent = t("rp.anatomy_mode_highlight");
    tools.querySelector('[data-mode="isolate"]').textContent = t("rp.anatomy_mode_isolate");
    tools.querySelector('[data-turn="-45"]').textContent = t("rp.anatomy_turn_left");
    tools.querySelector('[data-turn="45"]').textContent = t("rp.anatomy_turn_right");
    tools.querySelector('[data-group="mode"]').setAttribute("aria-label", t("rp.anatomy_mode_group"));
    tools.querySelector('[data-group="picks"]').setAttribute("aria-label", t("rp.anatomy_picks"));
    tools.querySelector('[data-group="move"]').setAttribute("aria-label", t("rp.anatomy_move_group"));
    tools.querySelector('[data-group="body"]').setAttribute("aria-label", t("rp.anatomy_body_group"));
    tools.querySelector("[data-whole]").textContent = t("rp.anatomy_whole");
    tools.querySelector("[data-anatomy-return]").textContent = t("rp.anatomy_return");
    tools.querySelector("[data-anatomy-unwell]").textContent = t("rp.unwell");
    tools.querySelector('[data-zoom="1.25"]').setAttribute("aria-label", t("rp.zoom_in"));
    tools.querySelector('[data-zoom="0.8"]').setAttribute("aria-label", t("rp.zoom_out"));
    this.renderAnatomyTools();
    this.renderSoundBar();
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
    if (first) {
      this.stepState = anatomyStateAt(first.content, 0);
      this.anatomy.show(this.stepState);
      this.requestNames(first.content);
      this.renderAnatomyTools();
    }
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
    this.renderVoiceSource();
    if (restart) {
      this.renderMedia();
      this.lastAnatomy = null;
      this.requestNames();
      if (this.expanded) {
        // The step changed while the anatomy view is open: its structures, in the current mode.
        this.initAnatomySelection(true);
        this.applyAnatomySelection();
      } else {
        this.syncAnatomy(true);
      }
      if (next) this.anatomy.preload(stepStructures(next.content));
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
        const caption = box.querySelector("[data-media-label]");
        if (caption) caption.textContent = c.video.label || "";
        return;
      }
      box.innerHTML = `<video class="rp-video" playsinline loop preload="auto" data-src="${esc(c.video.url)}" src="${esc(c.video.url)}"></video><p class="rp-media-label" data-media-label>${esc(c.video.label || "")}</p>${details}`;
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
    this.tick();
  }

  stopClock() {
    if (this.running()) this.elapsed += now() - this.started;
    this.started = null;
    clearInterval(this.timer);
    this.timer = null;
    // A stopped clock never speaks: no voice, no recording.
    this.silence();
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
    if (this.phase === "work") this.narrationTick(at);
    if (this.phase === "work" && this.running() && at >= workMs(dose)) this.workDone();
  }

  // -- narration: subtitles, voice and the creator's recording, all by the step clock -----------

  audioEl() {
    return this.root ? this.root.querySelector("[data-narration-audio]") : null;
  }

  narrLang() {
    return narrationLanguage(this.sound.lang, this.lang);
  }

  /** The content whose narration is used: the chosen narration language's text for SEDENS Standard
   *  (read once from the server in that language), otherwise the step's own. */
  narrationContent() {
    const l = this.narrLang();
    const w = this.workout;
    if (w && w.kind === "standard" && this.step && l !== this.lang) {
      const alt = this.alt[l] && this.alt[l][this.step.position];
      if (alt) return (this.step.variant !== "standard" && alt.variants && alt.variants[this.step.variant]) || alt.content;
      this.askAlt(l);
    }
    return this.content;
  }

  askAlt(l) {
    if (this.altAsked.has(l)) return;
    this.altAsked.add(l);
    const workout = this.altWorkout;
    sedens("room/journey?lang=" + l)
      .then((result) => {
        const steps = result && result.journey && result.journey.workout && result.journey.workout.steps;
        if (!steps || !this.root || workout !== this.altWorkout) return;
        this.alt[l] = steps;
        this.rebuildCues();
      })
      .catch(() => {
        // The step keeps its text in the room language; subtitles and voice still work.
      });
  }

  /** Cues of the current step. A language change keeps what was already said. */
  rebuildCues() {
    if (!this.content) return;
    const { cues } = cuesOf(this.narrationContent());
    this.cues = cues;
    this.recStart = recordingStartMs(cues);
    this.shownCue = -2;
    this.renderVoiceSource();
  }

  /** A new step (or Repeat): the cues, the recording and what was said start over. */
  resetNarration() {
    this.silence();
    this.recordingFailed = false;
    this.rebuildCues();
    // Lines before the position this step resumes from (a reloaded, paused workout) are not said again.
    this.handled = new Set(this.cues.flatMap((c, i) => (c.at_ms < this.elapsed ? [i] : [])));
    const a = this.audioEl();
    const url = (this.content && this.content.narration_audio && this.content.narration_audio.url) || "";
    if (!a) return;
    if (url) {
      if (a.dataset.src !== url) {
        a.dataset.src = url;
        a.src = url;
      } else {
        try {
          a.currentTime = 0;
        } catch {
          // Not loaded yet: it starts at the beginning anyway.
        }
      }
    } else if (a.dataset.src) {
      delete a.dataset.src;
      a.removeAttribute("src");
      a.load();
    }
  }

  /** No voice and no recording (the clock stopped, or narration was turned off or muted). */
  silence() {
    this.narrator.stop();
    const a = this.audioEl();
    if (a && !a.paused) a.pause();
  }

  usesRecording() {
    const a = this.audioEl();
    return !!(a && a.dataset.src && !this.recordingFailed && this.sound.narration && hasSpoken(this.cues));
  }

  narrationTick(ms) {
    const cues = this.cues;
    this.showSubtitle(subtitleAt(cues, ms));
    const running = this.running();
    if (this.usesRecording()) {
      this.syncRecording(ms, running);
      return;
    }
    const a = this.audioEl();
    if (a && !a.paused) a.pause();
    const plan = dueCue({ cues, ms, paused: !running, busy: this.narrator.speaking, handled: this.handled });
    this.handled = plan.handled;
    if (plan.speak !== null) this.sayCue(cues[plan.speak]);
  }

  showSubtitle(index) {
    if (index === this.shownCue) return;
    this.shownCue = index;
    const box = this.$("[data-caption]");
    if (box) box.textContent = index >= 0 ? this.cues[index].text : "";
  }

  sayCue(cue) {
    const provider = pickProvider({
      speak: cue.speak, hasRecording: false, speechAvailable: this.narrator.available,
      enabled: this.sound.narration, muted: this.sound.muted, volume: this.sound.voice,
    });
    if (provider !== "speech") return;
    // A creator's course is written in one language; the voice follows the text.
    this.narrator.speakCue(cue.text, { lang: textLanguage(cue.text, this.narrLang()) });
  }

  syncRecording(ms, running) {
    const a = this.audioEl();
    if (!a) return;
    a.volume = effectiveVolume(this.sound.voice, false);
    a.muted = this.sound.muted;
    // The first tick on which a started recording is really moving: put it in step closely, once.
    const settling = !this.recSettled && !a.paused && a.currentTime > 0;
    if (settling) this.recSettled = true;
    const sync = recordingSync({ ms, startMs: this.recStart, duration: a.duration, current: a.currentTime, running, settling });
    if (sync.seekTo !== null) {
      try {
        a.currentTime = sync.seekTo;
      } catch {
        // Metadata not loaded yet; the next tick tries again.
      }
    }
    if (sync.play) {
      if (a.paused && now() >= this.audioBlockedUntil) {
        this.recSettled = false;
        const played = a.play();
        if (played && played.catch) played.catch(() => (this.audioBlockedUntil = now() + 2000));
      }
    } else if (!a.paused) a.pause();
  }

  /** Which voice this step has, in words: the recording, the screen's speech, or subtitles only. */
  renderVoiceSource() {
    const line = this.root && this.root.querySelector("[data-voice-source]");
    if (!line) return;
    let key = "rp.voice_none";
    if (!this.sound.narration) key = "rp.voice_off";
    else if (this.content && hasSpoken(this.cues)) {
      const a = this.audioEl();
      if (a && a.dataset.src && !this.recordingFailed) key = "rp.voice_recording";
      else if (this.narrator.available) key = "rp.voice_speech";
    }
    line.textContent = this.t(key);
  }

  syncAnatomy(force = false) {
    // A video's last "timeupdate" arrives after the player was destroyed (pausing it fires one).
    if (!this.root || !this.content || this.expanded) return;
    const video = this.video();
    const ms = video ? video.currentTime * 1000 : this.ms();
    const state = anatomyStateAt(this.content, ms);
    if (force) this.anatomy.lastKey = null;
    this.anatomy.show(state);
    this.$("[data-anatomy-cue]").textContent = state.cue || "";
    this.stepState = state;
    this.renderAnatomyTools();
  }

  /** The step's anatomy at the moment on screen (the state the workout would show). */
  currentAnatomyState() {
    const content = this.anatomyContent();
    if (!content) return null;
    if (content !== this.content) return anatomyStateAt(content, 0);
    const video = this.video();
    return anatomyStateAt(content, video ? video.currentTime * 1000 : this.ms());
  }

  /** The step whose anatomy is on screen: the current one, or the first before the workout starts. */
  anatomyContent() {
    return this.content || (this.workout && this.workout.steps && this.workout.steps[0] && this.workout.steps[0].content) || null;
  }

  // -- anatomy selection: mode, structures, status ------------------------------------

  nameOf(key) {
    return this.names[key] || key;
  }

  requestNames(content = this.anatomyContent()) {
    const keys = content ? stepStructures(content) : [];
    const unasked = keys.filter((k) => !this.asked.has(k));
    if (!unasked.length) return;
    unasked.forEach((k) => this.asked.add(k));
    this.anatomy.names(unasked);
  }

  onNames(names, missing = []) {
    this.names = { ...this.names, ...names };
    missing.forEach((k) => this.absent.add(k));
    this.renderAnatomyTools();
  }

  drawable(keys) {
    return keys.filter((k) => !this.absent.has(k));
  }

  /** The status line, the pressed states and the structure buttons follow this.sel (expanded)
   *  or the step's own state (side panel). */
  renderAnatomyTools() {
    if (!this.root) return;
    const t = this.t;
    const line = this.$("[data-anatomy-selection]");
    const sel = this.sel;
    if (!this.expanded || !sel) {
      const state = this.stepState;
      const keys = state ? this.drawable(state.mode === "isolate" ? state.structures : state.focus) : [];
      line.textContent = keys.length
        ? t(state.mode === "isolate" ? "rp.anatomy_status_isolate" : "rp.anatomy_status_highlight", { name: keys.map((k) => this.nameOf(k)).join(", ") })
        : "";
      return;
    }
    for (const b of this.root.querySelectorAll("[data-mode]"))
      b.setAttribute("aria-pressed", String(b.dataset.mode === sel.mode));
    this.$("[data-skeleton]").setAttribute("aria-pressed", String(sel.skeleton));
    const names = sel.keys.map((k) => this.nameOf(k)).join(", ");
    let text;
    if (sel.skeleton) text = t("rp.anatomy_status_skeleton");
    else if (!sel.keys.length) text = t("rp.anatomy_status_whole");
    else text = t(sel.mode === "isolate" ? "rp.anatomy_status_isolate" : "rp.anatomy_status_highlight", { name: names });
    line.textContent = text;
    // The structures of this exercise, as buttons; rebuilt only when the list changes.
    const box = this.$("[data-anatomy-picks]");
    // Only what this atlas draws is offered: a name it cannot find would select nothing.
    const keys = stepStructures(this.anatomyContent()).filter((k) => this.names[k]);
    const signature = keys.join("|");
    if (box.dataset.sig !== signature) {
      box.dataset.sig = signature;
      box.innerHTML = keys.map((k) => `<button data-pick="${esc(k)}" aria-pressed="false"></button>`).join("");
    }
    box.hidden = !keys.length;
    for (const b of box.querySelectorAll("[data-pick]")) {
      b.textContent = this.names[b.dataset.pick] || b.dataset.pick;
      b.setAttribute("aria-pressed", String(!sel.skeleton && sel.keys.includes(b.dataset.pick)));
    }
  }

  /** Start (or restart, on a step change) the expanded selection from the step's own anatomy,
   *  keeping the mode the customer chose. */
  initAnatomySelection(keepMode) {
    const state = this.currentAnatomyState() || { mode: "highlight", structures: [], focus: [] };
    const mode = keepMode && this.sel ? this.sel.mode : state.mode;
    const pool = this.drawable(state.focus.length ? state.focus : state.structures.slice(0, 1));
    const keys = mode === "isolate" ? pool : pool.slice(0, 1);
    this.sel = { mode, keys, skeleton: false };
    this.requestNames();
  }

  /** Send the current selection to the viewer. */
  applyAnatomySelection() {
    const sel = this.sel;
    if (!sel) return;
    if (sel.skeleton) {
      this.anatomy.skeleton();
      this.anatomy.view("wholeBody");
    }
    else if (!sel.keys.length) this.anatomy.clear();
    else this.anatomy.select(sel.keys, sel.mode);
    this.renderAnatomyTools();
  }

  selectAnatomy(keys, { skeleton = false } = {}) {
    this.sel = { ...(this.sel || { mode: "highlight" }), keys, skeleton };
    this.applyAnatomySelection();
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
        <label class="rp-toggle"><input type="checkbox" data-setting="muted" ${this.sound.muted ? "checked" : ""}> <span>${esc(t("rp.mute_all"))}</span></label>
        <p class="rp-hint">${esc(t("rp.mute_hint"))}</p>
        <label class="rp-toggle"><input type="checkbox" data-setting="narration" ${this.sound.narration ? "checked" : ""}> <span>${esc(t("rp.narration"))}</span></label>
        <p class="rp-hint" data-voice-source></p>
        ${this.narrator.available ? "" : `<p class="rp-hint">${esc(t("rp.narration_unavailable"))}</p>`}
        <label class="rp-toggle"><input type="checkbox" data-setting="subtitles" ${this.sound.subtitles ? "checked" : ""}> <span>${esc(t("rp.subtitles"))}</span></label>
        ${w.kind === "standard"
    ? `<label class="rp-select"><span>${esc(t("rp.narration_lang"))}</span><select data-setting="narration_lang">${["auto", "ko", "en"].map((l) => `<option value="${l}" ${this.sound.lang === l ? "selected" : ""}>${esc(t(`rp.lang_${l}`))}</option>`).join("")}</select></label>`
    : `<p class="rp-hint">${esc(t("rp.lang_course"))}</p>`}
        <label class="rp-range"><span>${esc(t("rp.volume_narration"))}</span><input type="range" min="0" max="1" step="0.05" value="${this.sound.voice}" data-volume="narration"></label>
        <label class="rp-select"><span>${esc(t("rp.music"))}</span><select data-setting="music" ${this.music.available ? "" : "disabled"}>${musicOptions}</select></label>
        ${this.music.available ? "" : `<p class="rp-hint">${esc(t("rp.music_unavailable"))}</p>`}
        <label class="rp-file" ${this.music.mode === "own" ? "" : "hidden"} data-own-file><span>${esc(t("rp.music_own_hint"))}</span><input type="file" accept="audio/*" data-setting="music_file"></label>
        <label class="rp-range"><span>${esc(t("rp.volume_music"))}</span><input type="range" min="0" max="1" step="0.05" value="${this.sound.music}" data-volume="music"></label>
      </div>
    </details>`;
    this.renderVoiceSource();
  }

  // -- sound settings: one place that applies them and keeps them -------------------------------

  /** Apply this.sound to the voice, the recording, the music and the screen; keep it for the visit. */
  applySound(save = true) {
    const s = this.sound;
    this.narrator.setEnabled(s.narration);
    this.narrator.setMuted(s.muted);
    this.narrator.setVolume(s.voice);
    this.narrator.setLang(this.narrLang());
    this.music.setVolume(effectiveVolume(s.music, s.muted));
    const a = this.audioEl();
    if (a) {
      a.volume = effectiveVolume(s.voice, false);
      a.muted = s.muted;
    }
    const caption = this.$("[data-caption]");
    if (caption) caption.hidden = !s.subtitles;
    this.renderSoundBar();
    if (save) saveSound(browserStorage(), this.soundKey, s);
    if (this.root && this.content && this.step && this.phase === "work") this.narrationTick(this.ms());
  }

  renderSoundBar() {
    if (!this.root) return;
    const t = this.t;
    const mute = this.$('[data-act="mute-all"]');
    const subtitles = this.$('[data-act="subtitles"]');
    mute.textContent = t("rp.mute_all_short");
    mute.setAttribute("aria-pressed", String(this.sound.muted));
    mute.setAttribute("aria-keyshortcuts", "M");
    subtitles.textContent = t("rp.subtitles");
    subtitles.setAttribute("aria-pressed", String(this.sound.subtitles));
    this.$("[data-soundbar]").setAttribute("aria-label", t("rp.sound_bar"));
    this.$("[data-sound-status]").textContent = this.sound.muted ? t("rp.muted_status") : "";
    for (const box of this.root.querySelectorAll("[data-setting]")) {
      if (box.dataset.setting === "muted") box.checked = this.sound.muted;
      if (box.dataset.setting === "subtitles") box.checked = this.sound.subtitles;
    }
  }

  setSound(change) {
    this.sound = { ...this.sound, ...change };
    this.applySound();
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
    if (button.dataset.turn) return this.anatomy.turn(Number(button.dataset.turn));
    if (button.dataset.mode) return this.setAnatomyMode(button.dataset.mode);
    if (button.dataset.pick) return this.selectAnatomy([button.dataset.pick]);
    if (button.matches("[data-skeleton]")) {
      if (!this.sel) this.initAnatomySelection(false);
      return this.selectAnatomy(this.sel.keys, { skeleton: !this.sel.skeleton });
    }
    if (button.matches("[data-whole]")) {
      this.$("[data-anatomy-cue]").textContent = "";
      return this.selectAnatomy([]);
    }
    const act = button.dataset.act;
    switch (act) {
      case "start":
        // The Start tap is the user gesture that lets sound play.
        if (this.music.mode !== "off") this.music.setMode(this.music.mode);
        return this.request("workout/start");
      case "mute-all":
        return this.setSound({ muted: !this.sound.muted });
      case "subtitles":
        return this.setSound({ subtitles: !this.sound.subtitles });
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
        this.resetNarration();
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
      this.setSound({ narration: input.checked });
      this.renderVoiceSource();
      this.ctx.event?.("narration_toggled", { on: input.checked });
    } else if (setting === "muted") {
      this.setSound({ muted: input.checked });
    } else if (setting === "subtitles") {
      this.setSound({ subtitles: input.checked });
    } else if (setting === "narration_lang") {
      this.setSound({ lang: input.value });
      this.rebuildCues();
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
    if (kind === "narration") this.setSound({ voice: Number(event.target.value) });
    else if (kind === "music") this.setSound({ music: Number(event.target.value) });
  }

  onKey(event) {
    if (!this.root) return;
    if (event.target.closest?.("input, select, textarea, dialog")) return;
    // M mutes and unmutes everything (voice, recording and music) from anywhere on the page.
    if ((event.key === "m" || event.key === "M") && !event.ctrlKey && !event.metaKey && !event.altKey) {
      this.setSound({ muted: !this.sound.muted });
      return;
    }
    if (this.root.dataset.mode === "ready") return;
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
      this.initAnatomySelection(false);
      this.renderAnatomyTools();
      // The workout pauses while anatomy is open (brief §32) and continues on return.
      if (this.root.dataset.mode === "exercise") {
        this.resumeAfterAnatomy = true;
        await this.pause("anatomy");
      }
      this.$("[data-anatomy-return]").focus({ preventScroll: true });
    } else {
      this.sel = null;
      this.anatomy.view("anterior");
      this.syncAnatomy(true);
      if (!this.content && this.stepState) {
        // Plan screen (before Start): there is no running step, so show the first exercise again.
        this.anatomy.lastKey = null;
        this.anatomy.show(this.stepState);
        this.renderAnatomyTools();
      }
      if (this.resumeAfterAnatomy && this.root.dataset.mode === "paused") await this.resume();
      this.resumeAfterAnatomy = false;
      this.$("[data-anatomy-expand]").focus({ preventScroll: true });
    }
  }

  /** The customer tapped a structure in the viewer. */
  onStructure(key, name) {
    if (!this.expanded) return;
    if (!this.sel) this.initAnatomySelection(false);
    if (name) this.names = { ...(this.names || {}), [key]: name };
    const wasSkeleton = this.sel.skeleton;
    this.sel = { ...this.sel, keys: [key], skeleton: false };
    // In "Highlight in the body" the viewer has already selected it. After skeleton-only, or in
    // "Show only this", the viewer is told so the picture matches the mode.
    if (wasSkeleton || this.sel.mode === "isolate") this.applyAnatomySelection();
    else this.renderAnatomyTools();
    this.$("[data-anatomy-cue]").textContent = "";
    if (this.sel.mode === "isolate") this.ctx.event?.("structure_isolated", { source: "room" });
  }

  setAnatomyMode(mode) {
    if (!this.sel) this.initAnatomySelection(false);
    let keys = this.sel.keys;
    // "Show only this" needs something to show: the step's main structure.
    if (!keys.length) {
      const state = this.currentAnatomyState();
      keys = state ? this.drawable(state.focus.length ? state.focus : state.structures.slice(0, 1)).slice(0, 1) : [];
    }
    this.sel = { mode: mode === "isolate" ? "isolate" : "highlight", keys, skeleton: false };
    this.applyAnatomySelection();
    if (this.sel.mode === "isolate" && keys.length) this.ctx.event?.("structure_isolated", { source: "room" });
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
    this.silence();
    const recording = this.audioEl();
    if (recording) recording.removeAttribute("src");
    this.music.destroy();
    this.anatomy.destroy();
    this.media("pause");
    this.root = null;
  }
}

function browserStorage() {
  try {
    return globalThis.sessionStorage || null;
  } catch {
    return null;
  }
}

function fragment(html) {
  const template = document.createElement("template");
  template.innerHTML = html;
  return template.content;
}
