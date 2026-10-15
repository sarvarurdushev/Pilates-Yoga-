// Live framing guidance for the room scan: simple, honest camera heuristics.
//
// What this does: it looks at a tiny grey copy of the camera picture (64 x 36
// pixels, a few times a second) and answers two questions only:
//   1. Is there enough light, and not too much light behind the person?
//   2. Has the picture been steady for about a second?
// It does NOT find a body, count people or check which way someone faces. A pose
// model (for example MediaPipe Tasks Vision) could, but it needs a WASM runtime and
// a model download the room must not depend on at playback, so v1 does not claim it.
//
// A future model plugs in through the same interface: any object with
// evaluate(frame) -> {ready: boolean, message_key: string} (a Promise is fine too).
// frame = {gray, width, height, time, source}; `source` is the live <video>, for a
// model that needs the full picture. combineGuidance() runs several in order.
//
// Everything below the browser helpers is pure, so it is tested in Node with
// synthetic frames (web/test/sedens-room-scan.test.mjs).

/** The size the camera picture is shrunk to before it is looked at. */
export const GUIDANCE_SIZE = Object.freeze({ width: 64, height: 36 });

export const DEFAULTS = Object.freeze({
  windowMs: 1000, // how long the picture must stay steady
  darkMean: 40, // mean brightness (0-255) below this: too dark
  brightLevel: 245, // a pixel at or above this counts as blown out
  brightShare: 0.35, // more than this share of blown-out pixels: too bright
  backlightEdge: 175, // edges brighter than this...
  backlightGap: 60, // ...and this much brighter than the centre: light behind the person
  changeLevel: 20, // a pixel that changed by more than this (after exposure drift) moved
  motionShare: 0.04, // more than this share of moved pixels between frames: not steady
});

/** Customer copy keys (strings-room-scan.js). Never technical wording. */
export const MESSAGES = Object.freeze({
  dark: "rs.guide.dark",
  bright: "rs.guide.bright",
  backlit: "rs.guide.backlit",
  hold: "rs.guide.hold",
  ready: "rs.guide.ready",
});

/** RGBA pixels (ImageData.data) → one luma byte per pixel (BT.601 weights). */
export function toGray(rgba, width, height) {
  const count = width * height;
  const gray = new Uint8Array(count);
  for (let i = 0, p = 0; i < count; i += 1, p += 4) gray[i] = (rgba[p] * 77 + rgba[p + 1] * 150 + rgba[p + 2] * 29) >> 8;
  return gray;
}

export function meanBrightness(gray) {
  if (!gray.length) return 0;
  let sum = 0;
  for (let i = 0; i < gray.length; i += 1) sum += gray[i];
  return sum / gray.length;
}

/** Share of pixels at or above `level` (blown-out highlights). */
export function brightShare(gray, level = DEFAULTS.brightLevel) {
  if (!gray.length) return 0;
  let n = 0;
  for (let i = 0; i < gray.length; i += 1) if (gray[i] >= level) n += 1;
  return n / gray.length;
}

/** Mean brightness of the centre (where the person stands) and of the outer ring. */
export function centreAndEdge(gray, width, height) {
  const x0 = Math.floor(width * 0.3), x1 = Math.ceil(width * 0.7);
  const y0 = Math.floor(height * 0.15), y1 = Math.ceil(height * 0.85);
  let c = 0, cn = 0, e = 0, en = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const v = gray[y * width + x];
      if (x >= x0 && x < x1 && y >= y0 && y < y1) {
        c += v;
        cn += 1;
      } else {
        e += v;
        en += 1;
      }
    }
  }
  return { centre: cn ? c / cn : 0, edge: en ? e / en : 0 };
}

/** 'ok' | 'dark' | 'bright' | 'backlit' for one frame. */
export function lighting(gray, width, height, options = {}) {
  const o = { ...DEFAULTS, ...options };
  const mean = meanBrightness(gray);
  if (mean < o.darkMean) return "dark";
  if (brightShare(gray, o.brightLevel) > o.brightShare) return "bright";
  const { centre, edge } = centreAndEdge(gray, width, height);
  if (edge > o.backlightEdge && edge - centre > o.backlightGap) return "backlit";
  return "ok";
}

/** Share of pixels that changed between two frames, ignoring an even brightness
 * shift of the whole picture (camera auto-exposure settling is not movement). */
export function motionShare(previous, next, changeLevel = DEFAULTS.changeLevel) {
  const count = Math.min(previous.length, next.length);
  if (!count) return 0;
  let drift = 0;
  for (let i = 0; i < count; i += 1) drift += next[i] - previous[i];
  drift /= count;
  let moved = 0;
  for (let i = 0; i < count; i += 1) if (Math.abs(next[i] - previous[i] - drift) > changeLevel) moved += 1;
  return moved / count;
}

/** The default heuristics. evaluate(frame) → {ready, message_key, light, motion}.
 * `ready` means: lit well enough, and steady for the last `windowMs`. */
export function createGuidance(options = {}) {
  const o = { ...DEFAULTS, ...options };
  let previous = null;
  let history = []; // [{time, motion}] for the last windowMs
  return {
    name: "light-and-steadiness",
    evaluate(frame) {
      const { gray, width, height, time } = frame;
      const light = lighting(gray, width, height, o);
      let motion = null;
      if (previous && previous.length === gray.length) {
        motion = motionShare(previous, gray, o.changeLevel);
        history.push({ time, motion });
      }
      previous = gray;
      history = history.filter((h) => time - h.time <= o.windowMs);
      if (light !== "ok") return { ready: false, message_key: MESSAGES[light], light, motion };
      const covered = history.length ? time - history[0].time : 0;
      const moving = history.some((h) => h.motion > o.motionShare);
      // Steady only once the window is (nearly) full of calm frames.
      const steady = !moving && history.length >= 3 && covered >= o.windowMs * 0.6;
      return { ready: steady, message_key: steady ? MESSAGES.ready : MESSAGES.hold, light, motion };
    },
    reset() {
      previous = null;
      history = [];
    },
  };
}

/** Run several guidance providers in order; the first that is not ready speaks.
 * Use it to put a future pose model after (or before) the light checks. */
export function combineGuidance(...providers) {
  return {
    name: providers.map((p) => p.name || "custom").join("+"),
    async evaluate(frame) {
      let last = { ready: true, message_key: MESSAGES.ready };
      for (const provider of providers) {
        const result = await provider.evaluate(frame);
        if (!result?.ready) return { ...result, ready: false, message_key: result?.message_key || MESSAGES.hold };
        last = result;
      }
      return last;
    },
    reset() {
      for (const provider of providers) provider.reset?.();
    },
  };
}

// The scan asks this factory for its guidance. A future pose model registers a
// factory (for example () => combineGuidance(createGuidance(), poseGuidance())).
let factory = () => createGuidance();
export function setGuidanceFactory(next) {
  factory = typeof next === "function" ? next : () => createGuidance();
}
export const makeGuidance = () => factory();

// -- browser helpers ----------------------------------------------------------------

/** A sampler that shrinks the live video to 64 x 36 and returns a frame for
 * evaluate(). Returns null while the video has no picture yet. */
export function createSampler(video, size = GUIDANCE_SIZE) {
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  return (time = performance.now()) => {
    if (!video || video.readyState < 2 || !video.videoWidth) return null;
    context.drawImage(video, 0, 0, size.width, size.height);
    const { data } = context.getImageData(0, 0, size.width, size.height);
    return { gray: toGray(data, size.width, size.height), width: size.width, height: size.height, time, source: video };
  };
}
