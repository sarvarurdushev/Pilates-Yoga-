// The room's anatomy panel: one embedded viewer for the whole workout, driven by
// the step on screen. The step's authored timeline decides what is shown at each
// moment; outside a moment (or with no timeline) the exercise-level mapping is shown.
// Nothing here has an intensity: the panel is educational anatomy, not measured
// muscle activation (brief §30).
//
// Verified in headless Chromium (bridge ready in about 6 s locally; highlight,
// isolate, skeleton, clear and unknown names all behave): keep the host element ON
// SCREEN. Chromium pauses rendering of an off-screen iframe and the viewer then shows
// a stale picture. To warm the viewer up early, give the host its real size with
// opacity 0 (not display:none, not off-screen). Expanding restyles the host
// (`is-expanded`: position fixed, inset 0); never move the iframe in the DOM, which
// would reload the whole viewer.

export const ANATOMY_SRC = "/anatomy.html?room=1&embed=1";
const FOCUS_ROLES = new Set(["focus", "prime"]);

/** What the viewer should show for `content` (a player step) at `ms` into the step.
 *  Pure: the result depends only on (content, ms), so seeking back, repeating,
 *  restarting or skipping always lands on the right state. */
export function anatomyStateAt(content, ms) {
  const anatomy = (content && content.anatomy) || {};
  const at = Number.isFinite(ms) && ms > 0 ? ms : 0;
  const moment = (anatomy.timeline || []).find((m) => m.start_ms <= at && at < m.end_ms);
  if (moment) {
    const structures = [...(moment.structures || [])];
    return {
      structures,
      focus: moment.mode === "isolate" ? structures : structures.slice(0, 1),
      mode: moment.mode === "isolate" ? "isolate" : "highlight",
      layer: moment.layer || "",
      cue: moment.cue || "",
      moment: moment.id ?? `${moment.start_ms}-${moment.end_ms}`,
    };
  }
  const all = (anatomy.structures || []).map((s) => s.key);
  const focus = (anatomy.structures || []).filter((s) => FOCUS_ROLES.has(s.role)).map((s) => s.key);
  return { structures: all, focus: focus.length ? focus : all.slice(0, 1), mode: "highlight", layer: "", cue: "", moment: null };
}

/** A comparable signature: a new message is sent only when this changes. */
export function stateKey(state) {
  if (!state) return "clear";
  return JSON.stringify([state.mode, state.layer, state.structures, state.focus]);
}

/** Every structure key a step mentions (exercise-level mapping first, then its authored
 *  moments), without repeats: the list the customer can pick from in the expanded view. */
export function stepStructures(content) {
  const anatomy = (content && content.anatomy) || {};
  const keys = (anatomy.structures || []).map((s) => s.key);
  for (const m of anatomy.timeline || []) keys.push(...(m.structures || []));
  return [...new Set(keys)];
}

/** What the expanded view does with a structure, per mode (pure, for tests): "highlight" tints it in
 *  the whole body, "isolate" shows only it. */
export function selectionMessage(keys, mode) {
  const list = [].concat(keys).filter(Boolean);
  const isolate = mode === "isolate";
  return { op: "show", structures: list, focus: isolate ? list : list.slice(0, 1), mode: isolate ? "isolate" : "highlight", layer: "" };
}

/** The moments' boundaries in a step, for scheduling checks without polling every frame. */
export function boundaries(content) {
  const out = new Set([0]);
  for (const m of (content && content.anatomy && content.anatomy.timeline) || []) {
    out.add(m.start_ms);
    out.add(m.end_ms);
  }
  return [...out].sort((a, b) => a - b);
}

/** The embedded viewer. `host` is the element that holds the iframe; expanding the
 *  panel restyles `host` (an iframe that is moved in the DOM reloads, so it never moves). */
export class AnatomyPanel {
  constructor(host, { lang = "ko", onReady, onSelect, onError, onNames } = {}) {
    this.host = host;
    this.lang = lang;
    this.ready = false;
    this.seq = 0;
    this.lastKey = null;
    this.queue = [];
    this.onReady = onReady;
    this.onSelect = onSelect;
    this.onError = onError;
    this.onNames = onNames;
    this.frame = document.createElement("iframe");
    this.frame.className = "rp-anatomy-frame";
    this.frame.title = "Anatomy";
    // No top navigation: the kiosk never leaves the room screen from the viewer.
    this.frame.setAttribute("sandbox", "allow-scripts allow-same-origin");
    this.frame.setAttribute("loading", "eager");
    this.frame.src = `${ANATOMY_SRC}&lang=${encodeURIComponent(lang)}`;
    this.listener = (event) => this.receive(event);
    window.addEventListener("message", this.listener);
    host.append(this.frame);
  }

  receive(event) {
    if (event.origin !== location.origin || event.source !== this.frame.contentWindow) return;
    const data = event.data || {};
    if (data.type === "sedens-anatomy-ready") {
      this.ready = true;
      this.queue.splice(0).forEach((m) => this.post(m));
      this.onReady?.();
    } else if (data.type === "sedens-anatomy-selection" && data.key) {
      this.onSelect?.(data.key, data.name);
    } else if (data.type === "sedens-anatomy-names" && data.names) {
      this.onNames?.(data.names, data.missing || []);
    } else if (data.type === "sedens-anatomy-error") {
      this.onError?.(data.message);
    }
  }

  post(message) {
    const full = { type: "sedens-anatomy", seq: ++this.seq, ...message };
    if (!this.ready) {
      // Only the latest show/clear matters before the viewer is ready.
      if (message.op === "show" || message.op === "clear")
        this.queue = this.queue.filter((m) => m.op !== "show" && m.op !== "clear");
      this.queue.push(message);
      return;
    }
    this.frame.contentWindow?.postMessage(full, location.origin);
  }

  /** Show a state from anatomyStateAt (sent only when it changed). */
  show(state) {
    const key = stateKey(state);
    if (key === this.lastKey) return false;
    this.lastKey = key;
    if (!state || !state.structures.length) this.post({ op: "clear" });
    else this.post({ op: "show", structures: state.structures, focus: state.focus, mode: state.mode, layer: state.layer });
    return true;
  }

  /** Leave the current step's anatomy behind (the next step starts from nothing). */
  clear() {
    this.lastKey = null;
    this.post({ op: "clear" });
  }

  isolate(key) {
    this.select(key, "isolate");
  }

  /** Select a structure (or a few) in a mode: "highlight" (tinted in the whole body) or "isolate" (only it). */
  select(keys, mode) {
    this.lastKey = null;
    this.post(selectionMessage(keys, mode));
  }

  skeleton() {
    this.lastKey = null;
    this.post({ op: "show", structures: [], focus: [], mode: "highlight", layer: "skeleton" });
  }

  setLang(lang) {
    this.lang = lang;
    this.post({ op: "lang", lang });
  }

  rotate(on, seconds) { this.post({ op: "rotate", on: !!on, ...(seconds ? { seconds } : {}) }); }
  turn(degrees) { this.post({ op: "turn", degrees }); }
  names(structures) { if (structures && structures.length) this.post({ op: "names", structures }); }
  view(name) { this.post({ op: "view", name }); }
  zoom(factor) { this.post({ op: "zoom", factor }); }
  fit() { this.post({ op: "fit" }); }
  preload(structures) { if (structures && structures.length) this.post({ op: "preload", structures }); }

  setExpanded(on) {
    this.host.classList.toggle("is-expanded", !!on);
  }

  destroy() {
    window.removeEventListener("message", this.listener);
    this.frame.remove();
  }
}
