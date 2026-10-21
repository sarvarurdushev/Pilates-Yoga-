// Timed narration for one workout step: which line is on screen as a subtitle, which one
// to speak now, and where the creator's recording should be. Pure: callers pass the step
// clock's position (ms) and whether the clock is paused, so pause, resume, repeat and seek
// are only different values of `ms`. The player owns the sound; nothing here touches a DOM.
//
// Rules (brief §25, design §7):
//  - Every cue is a subtitle. Only a cue with speak=true is ever spoken.
//  - A paused workout never speaks, and a cue whose time has passed (a pause and a seek,
//    a throttled tab) is skipped, not replayed late.
//  - At most one utterance at a time: a due cue waits while another is still speaking and
//    is dropped once it is too late. Nothing is ever queued.
//  - The creator's recording comes first, then the browser's speech, then subtitles only.

/** A spoken cue more than this late is skipped (a tick is 250 ms; this is a few ticks). */
export const CUE_LATE_MS = 1500;
/** Old-style steps say their lines one after another; each may wait for the one before. */
export const SEQUENCE_LATE_MS = 30000;
/** How far the recording may drift from the step clock before it is moved. */
export const AUDIO_DRIFT_S = 0.6;
/** When the recording has just started (or restarted) playing, it is put in step more closely, once:
 * play() takes a moment, and a late start would otherwise leave it behind for the whole step. */
export const AUDIO_START_DRIFT_S = 0.15;

const finite = (n, fallback = 0) => (Number.isFinite(Number(n)) ? Number(n) : fallback);

/** Time to say a line (also the pause before the next line of an old-style step). */
export function readMs(text) {
  return Math.min(9000, Math.max(2500, 1200 + String(text || "").length * 70));
}

/** How long a subtitle stays up if no later cue replaces it. */
export function holdMs(text) {
  return Math.min(12000, Math.max(4000, 1500 + String(text || "").length * 80));
}

/**
 * The step's cues, normalized: [{text, at_ms, speak, late_ms}] sorted by time.
 * - "timed" steps (course steps with cues, SEDENS Standard) come as they are.
 * - "sequence" steps (no cues, or an older server) have only lines: they are said in order
 *   from the start, one after the other.
 */
export function cuesOf(content) {
  const c = content || {};
  const raw = Array.isArray(c.narration_cues) ? c.narration_cues : null;
  if (c.narration_mode === "timed" && raw) {
    const cues = raw
      .filter((x) => x && typeof x.text === "string" && x.text.trim())
      .map((x) => ({ text: x.text.trim(), at_ms: Math.max(0, Math.round(finite(x.at_ms))), speak: x.speak === true, late_ms: CUE_LATE_MS }));
    return { mode: "timed", cues: cues.sort((a, b) => a.at_ms - b.at_ms) };
  }
  const lines = (Array.isArray(c.narration) ? c.narration : []).filter((x) => typeof x === "string" && x.trim());
  const fallback = lines.length ? lines : [c.setup || c.title].filter(Boolean);
  let at = 0;
  const cues = fallback.map((text) => {
    const cue = { text: text.trim(), at_ms: at, speak: true, late_ms: SEQUENCE_LATE_MS };
    at += readMs(text) + 400;
    return cue;
  });
  return { mode: "sequence", cues };
}

/** Index of the cue to show as the subtitle at `ms`, or -1: the latest cue that has started
 * and is still within its display time. */
export function subtitleAt(cues, ms) {
  const at = finite(ms);
  let found = -1;
  for (let i = 0; i < cues.length; i += 1) {
    if (cues[i].at_ms > at) break;
    found = i;
  }
  if (found < 0) return -1;
  return at < cues[found].at_ms + holdMs(cues[found].text) ? found : -1;
}

/**
 * What to do with the spoken cues at this moment.
 * `handled` is the set of cue indexes already spoken or skipped; the answer carries the new set.
 * Returns { speak: index | null, handled: Set }.
 */
export function dueCue({ cues, ms, paused = false, busy = false, handled = new Set() }) {
  const at = finite(ms);
  const next = new Set();
  // Moving back in time (repeat, previous) makes the later cues due again.
  for (const i of handled) if (cues[i] && cues[i].at_ms <= at) next.add(i);
  for (let i = 0; i < cues.length; i += 1) {
    const cue = cues[i];
    if (cue.at_ms > at) break;
    if (next.has(i)) continue;
    if (!cue.speak) {
      next.add(i);
      continue;
    }
    if (at - cue.at_ms > (cue.late_ms ?? CUE_LATE_MS)) {
      next.add(i); // its time has passed: it is skipped, never spoken late
      continue;
    }
    if (paused || busy) continue; // not now; it may still be in time on a later tick
    next.add(i);
    return { speak: i, handled: next };
  }
  return { speak: null, handled: next };
}

/** True when the step has anything to say aloud. */
export const hasSpoken = (cues) => cues.some((c) => c.speak);

/** Where the creator's recording starts on the step clock: the first spoken cue. */
export function recordingStartMs(cues) {
  const first = cues.find((c) => c.speak);
  return first ? first.at_ms : 0;
}

/**
 * What the recording should do now. `current` and `duration` are the audio element's, in seconds.
 * Returns { play: boolean, seekTo: seconds | null }.
 */
export function recordingSync({ ms, startMs = 0, duration = NaN, current = 0, running = true, settling = false }) {
  const target = (finite(ms) - finite(startMs)) / 1000;
  if (target < 0) return { play: false, seekTo: finite(current) > 0 ? 0 : null };
  if (Number.isFinite(duration) && duration > 0 && target >= duration) return { play: false, seekTo: null };
  if (!running) return { play: false, seekTo: null };
  const drift = settling ? AUDIO_START_DRIFT_S : AUDIO_DRIFT_S;
  return { play: true, seekTo: Math.abs(finite(current) - target) > drift ? target : null };
}

/**
 * Who says a cue: "audio" (the creator's recording), "speech" (the browser's voice) or
 * "subtitles" (text only). Muted or silent voices fall back to subtitles for speech; a recording
 * keeps running (silently) so it stays in step with the clock.
 */
export function pickProvider({ speak = true, hasRecording = false, recordingFailed = false, speechAvailable = false, enabled = true, muted = false, volume = 1 }) {
  if (!speak || !enabled) return "subtitles";
  if (hasRecording && !recordingFailed) return "audio";
  if (speechAvailable && !muted && volume > 0) return "speech";
  return "subtitles";
}
