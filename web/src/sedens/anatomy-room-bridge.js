// SEDENS room anatomy bridge. Runs INSIDE /anatomy.html, and only when the URL has
// room=1 (the room screen's player embeds "/anatomy.html?room=1&embed=1").
//
// Protocol (same origin, from the parent window only):
//   in : {type: "sedens-anatomy", seq, op, ...}
//        op "show"    {structures: [key], focus: [key], mode: "highlight"|"isolate", layer: ""|"skeleton"|"muscles_superficial"|"muscles_deep"}
//        op "clear"   restore the default whole body (no isolation, no selection)
//        op "lang"    {lang: "en"|"ko"}
//        op "rotate"  {on: bool, seconds}   continuous turning; stops by itself after `seconds` (default 12, at most 30)
//        op "turn"    {degrees}              one camera move round the body (positive = the body turns to the right)
//        op "names"   {structures: [key]}    reply with the drawn structures' names in the viewer's language
//        op "view"    {name: "anterior"|"posterior"|"lateral"|"superior"|"head"|"wholeBody"}
//        op "zoom"    {factor}            op "fit"
//        op "preload" {structures: [key]} load what those structures need without showing them
//   out: {type: "sedens-anatomy-ready"}
//        {type: "sedens-anatomy-state", seq, isolated: [id], selected, missing: [key]}
//        {type: "sedens-anatomy-selection", key, name}   (the customer tapped a structure)
//        {type: "sedens-anatomy-names", names: {key: name}, missing: [key]}   (missing: not drawn by this atlas)
//        {type: "sedens-anatomy-error", message}
//
// Structures travel by registry key (names), never by numeric id: ids are renumbered
// whenever the atlas is rebuilt (pilates/sedens/atlas.py). This bridge never calls
// setExercise or plays motion clips: those paint per-role activation levels, and the
// room shows educational anatomy, not measured muscle activation.

const ROOM_LAYERS = ["skeleton", "muscles_superficial", "muscles_deep"];
const DEFAULT_ON = new Set(["skeleton", "muscles_superficial"]);

// The room shows the body only: no professional panels, no links out of the room.
const ROOM_CSS = `
#topbar, #rail, #panel, #lab, #viewbar, #sections, #orient, #discBar, #bodyPick, .assessment-home { display: none !important; }
#stage { position: fixed !important; inset: 0 !important; }
html, body { background: transparent; }
#loading { font: 600 15px system-ui, sans-serif; }
`;

/** The identity of a "show": what it would draw. A repeat of the state already drawn is skipped. */
export function showSignature(message) {
  const mode = message.mode === "isolate" ? "isolate" : "highlight";
  return JSON.stringify([
    mode, ROOM_LAYERS.includes(message.layer) ? message.layer : "",
    message.structures || [], message.focus && message.focus.length ? message.focus : (message.structures || []),
  ]);
}

export const ROTATE_DEFAULT_SECONDS = 12;
export const ROTATE_MAX_SECONDS = 30;

export function keysToIds(keys, drawnIds) {
  const ids = [];
  const missing = [];
  for (const key of keys || []) {
    const found = drawnIds(key);
    if (found.length) ids.push(...found);
    else missing.push(key);
  }
  return { ids: [...new Set(ids)], missing };
}

function start() {
  const style = document.createElement("style");
  style.textContent = ROOM_CSS;
  document.head.append(style);
  let atlas = null;
  let registry = null;
  let ready = false;
  let chain = Promise.resolve();
  let pendingShow = null;
  const beforeReady = [];
  // What the last "show" drew and the viewer state it left behind. A repeat "show" is skipped
  // only while the live state still matches (a tap on a structure, a clear or a layer change
  // makes the next "show" a real one). Any camera move also forgets it: an isolate show frames
  // the camera on the structure, so a repeat after the camera moved must frame it again.
  let applied = null;
  let rotateTimer = 0;

  const tell = (type, extra = {}) => {
    if (parent !== window) parent.postMessage({ type, ...extra }, location.origin);
  };

  async function layersFor(only) {
    for (const name of ROOM_LAYERS) {
      const on = only ? name === only : DEFAULT_ON.has(name);
      if (atlas.app.layers[name] && atlas.app.layers[name].on !== on) await atlas.setLayer(name, on);
    }
  }

  const liveState = () => JSON.stringify([
    [...(atlas.isolated?.() || [])], atlas.app.selected ?? null,
    ROOM_LAYERS.map((name) => !!atlas.app.layers[name]?.on),
  ]);

  async function show(message) {
    const signature = showSignature(message);
    if (applied && applied.signature === signature && applied.live === liveState()) {
      return { missing: applied.missing, skipped: true };
    }
    const { ids, missing } = keysToIds(message.structures, registry.drawnIds);
    const focus = keysToIds(message.focus && message.focus.length ? message.focus : message.structures, registry.drawnIds).ids;
    if (message.mode === "isolate" && ids.length) {
      await atlas.setIsolate(ids);
    } else {
      if ((atlas.isolated?.() || []).length) await atlas.setIsolate(null);
      await layersFor(ROOM_LAYERS.includes(message.layer) ? message.layer : null);
      // Highlight: the whole body stays, and the focus structure is shown through it
      // without moving the camera (an automatic selection, not a deliberate one).
      atlas.selectStructure(focus[0] ?? null, { auto: true });
    }
    applied = { signature, live: liveState(), missing };
    return { missing, skipped: false };
  }

  function namesFor(keys) {
    const names = {};
    const missing = [];
    const lang = atlas.app.lang || "en";
    for (const key of keys || []) {
      const [id] = registry.drawnIds(key);
      if (id == null) missing.push(key);
      else names[key] = registry.nameOf(id, lang) || key;
    }
    return { names, missing };
  }

  function rotate(on, seconds) {
    clearTimeout(rotateTimer);
    atlas.setRotate(!!on);
    // Turning means drawing continuously: it stops by itself.
    if (on) {
      const limit = Math.min(ROTATE_MAX_SECONDS, Math.max(1, Number(seconds) || ROTATE_DEFAULT_SECONDS));
      rotateTimer = setTimeout(() => {
        atlas.setRotate(false);
        tell("sedens-anatomy-state", { op: "rotate", isolated: [...(atlas.isolated?.() || [])], selected: atlas.app.selected ?? null, missing: [], rotating: false });
      }, limit * 1000);
    }
  }

  async function clear() {
    if ((atlas.isolated?.() || []).length) await atlas.setIsolate(null);
    atlas.selectStructure(null, { auto: true });
    await layersFor(null);
    atlas.resetView?.();
  }

  async function run(message) {
    let missing = [];
    let skipped = false;
    switch (message.op) {
      case "show":
        ({ missing, skipped } = await show(message));
        break;
      case "clear":
        applied = null;
        await clear();
        break;
      case "lang":
        if (message.lang === "en" || message.lang === "ko") atlas.setLang(message.lang);
        break;
      case "rotate":
        applied = null;
        rotate(message.on, message.seconds);
        break;
      case "turn":
        applied = null;
        rotate(false);
        atlas.turnBy(Number(message.degrees) || 0);
        break;
      case "names":
        tell("sedens-anatomy-names", namesFor(message.structures));
        break;
      case "view":
        applied = null;
        atlas.setView(String(message.name || "anterior"));
        break;
      case "zoom":
        applied = null;
        atlas.zoomBy(Number(message.factor) || 1);
        break;
      case "fit":
        applied = null;
        atlas.fitView();
        break;
      case "preload":
        await atlas.ensureStructureAnchors(keysToIds(message.structures, registry.drawnIds).ids);
        break;
      default:
        return;
    }
    // The viewer redraws only while something animates; setRotate also invalidates the
    // frame, so the picture always matches the state just applied. A "show" that was
    // skipped as a repeat changed nothing, so it asks for no frames either.
    if (!skipped) atlas.setRotate(!!atlas.app.rotate);
    tell("sedens-anatomy-state", {
      seq: message.seq, op: message.op, isolated: [...(atlas.isolated?.() || [])],
      selected: atlas.app.selected ?? null, missing, ...(skipped ? { skipped: true } : {}),
    });
  }

  function enqueue(message) {
    if (!ready) {
      // Before the viewer is ready only the latest "show" matters; settings are kept in order.
      if (message.op === "show" || message.op === "clear") pendingShow = message;
      else beforeReady.push(message);
      return;
    }
    if (message.op === "show") {
      // Seek storms: only the most recent "show" waiting in the queue is applied.
      const fresh = !pendingShow;
      pendingShow = message;
      if (!fresh) return;
      chain = chain.then(() => {
        const latest = pendingShow;
        pendingShow = null;
        return run(latest);
      }).catch((error) => tell("sedens-anatomy-error", { message: String(error?.message || error) }));
      return;
    }
    chain = chain.then(() => run(message))
      .catch((error) => tell("sedens-anatomy-error", { message: String(error?.message || error) }));
  }

  window.addEventListener("message", (event) => {
    if (event.origin !== location.origin || event.source !== parent) return;
    const data = event.data;
    if (!data || data.type !== "sedens-anatomy" || typeof data.op !== "string") return;
    enqueue(data);
  });

  // A tap on a structure (a deliberate selection) is reported by its key.
  document.addEventListener("motion-anatomy-selection", (event) => {
    const id = event.detail?.structure_id;
    const record = id != null && registry ? registry.get(id) : null;
    if (!record) return;
    const key = record.key ?? (typeof record.name === "string" ? record.name : record.name?.en);
    tell("sedens-anatomy-selection", { key, name: registry.nameOf(id, atlas.app.lang || "en") || key });
  });

  (async () => {
    try {
      atlas = await import("../main.js");
      registry = await import("../structures.js");
      if (!atlas.isAnatomyReady())
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("The anatomy viewer took too long to load.")), 120000);
          document.addEventListener("motion-anatomy-ready", () => { clearTimeout(timer); resolve(); }, { once: true });
        });
      // A quiet stage by default: auto-rotation would keep the GPU busy all session.
      atlas.setRotate(false);
      const lang = new URLSearchParams(location.search).get("lang");
      if (lang === "en" || lang === "ko") atlas.setLang(lang);
      ready = true;
      tell("sedens-anatomy-ready");
      beforeReady.splice(0).forEach(enqueue);
      if (pendingShow) {
        const first = pendingShow;
        pendingShow = null;
        enqueue(first);
      }
    } catch (error) {
      tell("sedens-anatomy-error", { message: String(error?.message || error) });
    }
  })();
}

if (typeof location !== "undefined" && new URLSearchParams(location.search).get("room") === "1") start();
