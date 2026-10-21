// Timed narration in the room player: which cue shows and which is spoken at a moment of the step
// clock, who says it (the creator's recording, the browser's voice, or subtitles only), volumes and
// mute, and the narration language. All pure; nothing here needs a browser.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cuesOf, subtitleAt, dueCue, hasSpoken, recordingStartMs, recordingSync, pickProvider, holdMs, readMs,
  CUE_LATE_MS, AUDIO_DRIFT_S, AUDIO_START_DRIFT_S,
} from "../src/sedens/room-cues.js";
import {
  normalizeSound, effectiveVolume, narrationLanguage, textLanguage, loadSound, saveSound, soundKey, DEFAULT_SOUND,
} from "../src/sedens/room-sound.js";
import { createNarrator } from "../src/sedens/room-narration.js";

const timed = (cues) => ({ narration_mode: "timed", narration_cues: cues });
const cue = (text, at_ms, speak = false) => ({ text, at_ms, speak });

test("timed cues are sorted by time; empty lines and non-boolean speak flags are not spoken", () => {
  const { mode, cues } = cuesOf(timed([cue("Late", 9000, true), cue("  ", 100, true), cue("Early", 1000, true), { text: "Maybe", at_ms: 3000, speak: "yes" }]));
  assert.equal(mode, "timed");
  assert.deepEqual(cues.map((c) => [c.text, c.at_ms, c.speak]), [["Early", 1000, true], ["Maybe", 3000, false], ["Late", 9000, true]]);
  assert.equal(hasSpoken(cues), true);
  assert.equal(hasSpoken(cuesOf(timed([cue("Only a subtitle", 0)])).cues), false);
});

test("a step without cues keeps its lines, said in order from the start", () => {
  const { mode, cues } = cuesOf({ narration_mode: "sequence", narration: ["Lie down.", "Breathe."], narration_cues: [{ text: "x", at_ms: 0, speak: true }] });
  assert.equal(mode, "sequence");
  assert.deepEqual(cues.map((c) => c.text), ["Lie down.", "Breathe."]);
  assert.equal(cues[0].at_ms, 0);
  assert.ok(cues[1].at_ms >= readMs("Lie down."), "the second line waits for the first");
  assert.ok(cues.every((c) => c.speak));
  // An older server (no mode) and a step with no lines at all still say something sensible.
  assert.deepEqual(cuesOf({ narration: ["One."] }).cues.map((c) => c.text), ["One."]);
  assert.deepEqual(cuesOf({ narration: [], setup: "Set up on the mat." }).cues.map((c) => c.text), ["Set up on the mat."]);
  assert.deepEqual(cuesOf(null).cues, []);
});

test("the subtitle is the latest cue that has started, until it times out or the next replaces it", () => {
  const cues = cuesOf(timed([cue("First", 2000), cue("Second", 5000), cue("Third", 30000)])).cues;
  assert.equal(subtitleAt(cues, 0), -1);
  assert.equal(subtitleAt(cues, 1999), -1);
  assert.equal(subtitleAt(cues, 2000), 0);
  assert.equal(subtitleAt(cues, 4999), 0);
  assert.equal(subtitleAt(cues, 5000), 1, "the next cue replaces it");
  assert.equal(subtitleAt(cues, 5000 + holdMs("Second") - 1), 1);
  assert.equal(subtitleAt(cues, 5000 + holdMs("Second")), -1, "nothing stays on screen for ever");
  assert.equal(subtitleAt(cues, 20000), -1, "a quiet stretch has no subtitle");
  assert.equal(subtitleAt(cues, 30000), 2);
  assert.equal(subtitleAt(cues, Number.NaN), -1);
});

test("a spoken cue is spoken once when its time comes; a subtitle-only cue is never spoken", () => {
  const cues = cuesOf(timed([cue("Say this", 1000, true), cue("Just show this", 6000, false), cue("Say that", 12000, true)])).cues;
  let handled = new Set();
  const step = (ms, extra = {}) => {
    const plan = dueCue({ cues, ms, handled, ...extra });
    handled = plan.handled;
    return plan.speak;
  };
  assert.equal(step(0), null);
  assert.equal(step(999), null);
  assert.equal(step(1000), 0);
  assert.equal(step(1250), null, "not again");
  assert.equal(step(6000), null, "a subtitle-only cue is not spoken");
  assert.equal(step(12100), 2);
  assert.equal(step(12350), null);
});

test("a paused workout never speaks, and a cue whose time passed while paused is skipped", () => {
  const cues = cuesOf(timed([cue("At five", 5000, true), cue("At twenty", 20000, true)])).cues;
  // Paused exactly at the cue: nothing is said while paused ...
  let plan = dueCue({ cues, ms: 5000, paused: true, handled: new Set() });
  assert.equal(plan.speak, null);
  // ... and it is said on resume, because it is still in time.
  plan = dueCue({ cues, ms: 5100, paused: false, handled: plan.handled });
  assert.equal(plan.speak, 0);
  // Paused, then moved forward past a cue and resumed: the cue is skipped, not said late.
  plan = dueCue({ cues, ms: 20000 + CUE_LATE_MS + 1, paused: true, handled: new Set([0]) });
  assert.equal(plan.speak, null);
  plan = dueCue({ cues, ms: 20000 + CUE_LATE_MS + 1, paused: false, handled: plan.handled });
  assert.equal(plan.speak, null);
  assert.ok(plan.handled.has(1));
});

test("never more than one utterance: a cue waits while another is spoken, and is dropped when late", () => {
  const cues = cuesOf(timed([cue("A", 0, true), cue("B", 500, true)])).cues;
  let plan = dueCue({ cues, ms: 600, busy: false, handled: new Set() });
  assert.equal(plan.speak, 0, "the earliest due cue goes first");
  plan = dueCue({ cues, ms: 700, busy: true, handled: plan.handled });
  assert.equal(plan.speak, null, "B waits for A to end");
  plan = dueCue({ cues, ms: 900, busy: false, handled: plan.handled });
  assert.equal(plan.speak, 1, "and is said once A is done, still in time");
  // Still talking when B's time is up: B is skipped, never queued.
  plan = dueCue({ cues, ms: 500 + CUE_LATE_MS + 1, busy: true, handled: new Set([0]) });
  assert.equal(plan.speak, null);
  plan = dueCue({ cues, ms: 500 + CUE_LATE_MS + 300, busy: false, handled: plan.handled });
  assert.equal(plan.speak, null);
});

test("an old-style step says each line after the one before, however long it takes", () => {
  const cues = cuesOf({ narration_mode: "sequence", narration: ["One.", "Two."] }).cues;
  let plan = dueCue({ cues, ms: 0, handled: new Set() });
  assert.equal(plan.speak, 0);
  // The second line's time has come but the first is still being said (a slow voice).
  const at = cues[1].at_ms + 8000;
  plan = dueCue({ cues, ms: at, busy: true, handled: plan.handled });
  assert.equal(plan.speak, null);
  plan = dueCue({ cues, ms: at + 250, busy: false, handled: plan.handled });
  assert.equal(plan.speak, 1);
});

test("moving back in time (Repeat, Previous) makes the later cues due again", () => {
  const cues = cuesOf(timed([cue("A", 1000, true), cue("B", 9000, true)])).cues;
  let plan = dueCue({ cues, ms: 9100, handled: new Set([0]) });
  assert.equal(plan.speak, 1);
  plan = dueCue({ cues, ms: 1100, handled: plan.handled });
  assert.equal(plan.speak, null);
  assert.deepEqual([...plan.handled], [0], "B is armed again, A (already said) stays said");
  plan = dueCue({ cues, ms: 9050, handled: plan.handled });
  assert.equal(plan.speak, 1);
});

test("the creator's recording follows the step clock: it starts at the first spoken line and is moved when it drifts", () => {
  const cues = cuesOf(timed([cue("Subtitle", 0, false), cue("Spoken", 4000, true), cue("Spoken 2", 15000, true)])).cues;
  const start = recordingStartMs(cues);
  assert.equal(start, 4000);
  assert.deepEqual(recordingSync({ ms: 1000, startMs: start, current: 0 }), { play: false, seekTo: null }, "not yet");
  assert.deepEqual(recordingSync({ ms: 4000, startMs: start, current: 0 }), { play: true, seekTo: null });
  assert.deepEqual(recordingSync({ ms: 7000, startMs: start, current: 3.1 }), { play: true, seekTo: null }, "small drift is left alone");
  assert.equal(recordingSync({ ms: 7000, startMs: start, current: 3 - AUDIO_DRIFT_S - 0.2 }).seekTo, 3, "a seek puts it back in step");
  assert.deepEqual(recordingSync({ ms: 7000, startMs: start, current: 3, running: false }), { play: false, seekTo: null }, "paused is silent");
  assert.deepEqual(recordingSync({ ms: 60000, startMs: start, duration: 20, current: 20 }), { play: false, seekTo: null }, "it ended");
  assert.deepEqual(recordingSync({ ms: 500, startMs: start, current: 6 }), { play: false, seekTo: 0 }, "rewound before its start");
  // A recording that started late is put in step closely once, as soon as it moves.
  assert.ok(AUDIO_START_DRIFT_S < AUDIO_DRIFT_S);
  assert.equal(recordingSync({ ms: 7000, startMs: start, current: 2.55, settling: true }).seekTo, 3, "a late start is corrected");
  assert.equal(recordingSync({ ms: 7000, startMs: start, current: 2.95, settling: true }).seekTo, null, "a tiny lag is left alone");
  assert.equal(recordingSync({ ms: 7000, startMs: start, current: 2.55 }).seekTo, null, "after settling, small drift is left alone");
  assert.equal(recordingStartMs(cuesOf({ narration_mode: "sequence", narration: ["x"] }).cues), 0);
  assert.equal(recordingStartMs([]), 0);
});

test("recording, then browser speech, then subtitles only", () => {
  const base = { speak: true, hasRecording: true, recordingFailed: false, speechAvailable: true, enabled: true, muted: false, volume: 0.9 };
  assert.equal(pickProvider(base), "audio");
  assert.equal(pickProvider({ ...base, recordingFailed: true }), "speech", "a recording that cannot play falls back to speech");
  assert.equal(pickProvider({ ...base, hasRecording: false }), "speech");
  assert.equal(pickProvider({ ...base, hasRecording: false, speechAvailable: false }), "subtitles");
  assert.equal(pickProvider({ ...base, recordingFailed: true, speechAvailable: false }), "subtitles");
  assert.equal(pickProvider({ ...base, speak: false }), "subtitles", "a cue not marked spoken is never spoken");
  assert.equal(pickProvider({ ...base, enabled: false }), "subtitles");
  assert.equal(pickProvider({ ...base, hasRecording: false, muted: true }), "subtitles", "mute-all silences speech");
  assert.equal(pickProvider({ ...base, hasRecording: false, volume: 0 }), "subtitles");
  assert.equal(pickProvider({ ...base, muted: true }), "audio", "a muted recording keeps running so it stays in step");
});

test("mute-all wins over the sliders; voice and music volumes are separate", () => {
  assert.equal(effectiveVolume(0.8, false), 0.8);
  assert.equal(effectiveVolume(0.8, true), 0);
  assert.equal(effectiveVolume(7, false), 1);
  assert.equal(effectiveVolume("x", false), 0);
  const s = normalizeSound({ voice: 0.2, music: 0.7, muted: true });
  assert.deepEqual([s.voice, s.music, s.muted], [0.2, 0.7, true]);
});

test("sound settings are checked on the way in and kept per room visit", () => {
  assert.deepEqual(normalizeSound(null), DEFAULT_SOUND);
  assert.deepEqual(normalizeSound({ voice: 9, music: -1, lang: "fr", muted: "yes", narration: 0, subtitles: false, extra: 1 }),
    { ...DEFAULT_SOUND, voice: 1, music: 0, subtitles: false });
  const store = new Map();
  const storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v) };
  const key = soundKey("2026-10-21T09:00:00Z");
  assert.deepEqual(loadSound(storage, key), DEFAULT_SOUND);
  assert.equal(saveSound(storage, key, { ...DEFAULT_SOUND, voice: 0.3, muted: true, lang: "en" }), true);
  assert.deepEqual(loadSound(storage, key), { ...DEFAULT_SOUND, voice: 0.3, muted: true, lang: "en" });
  assert.deepEqual(loadSound(storage, soundKey("another visit")), DEFAULT_SOUND, "another visit starts fresh");
  // No storage, blocked storage, or broken contents never throw.
  assert.deepEqual(loadSound(null, key), DEFAULT_SOUND);
  assert.equal(saveSound({ setItem() { throw new Error("blocked"); } }, key, DEFAULT_SOUND), false);
  store.set(key, "{not json");
  assert.deepEqual(loadSound(storage, key), DEFAULT_SOUND);
});

test("narration language follows the room unless one is chosen; a course voice follows its text", () => {
  assert.equal(narrationLanguage("auto", "ko"), "ko");
  assert.equal(narrationLanguage("auto", "en"), "en");
  assert.equal(narrationLanguage("en", "ko"), "en");
  assert.equal(narrationLanguage("ko", "en"), "ko");
  assert.equal(narrationLanguage(undefined, "xx"), "ko");
  assert.equal(textLanguage("무릎을 세워 주세요.", "en"), "ko");
  assert.equal(textLanguage("Bend your knees.", "ko"), "en");
  assert.equal(textLanguage("Bend 무릎", "en"), "ko");
  assert.equal(textLanguage("12 : 30", "ko"), "ko");
});

function fakeSpeech() {
  const spoken = [];
  let cancelled = 0;
  class Utterance { constructor(text) { this.text = text; } }
  const synth = {
    getVoices: () => [{ lang: "en-US", localService: true, name: "en" }, { lang: "ko-KR", localService: true, name: "ko" }],
    speak(u) { spoken.push({ text: u.text, lang: u.lang, voice: u.voice?.name, volume: u.volume, end: () => u.onend?.() }); },
    cancel() { cancelled += 1; },
    addEventListener() {},
  };
  return { win: { speechSynthesis: synth, SpeechSynthesisUtterance: Utterance }, spoken, cancelled: () => cancelled };
}

test("speakCue says one cue at a time in the cue's language, and a new cue replaces the old", async () => {
  const f = fakeSpeech();
  const captions = [];
  const states = [];
  const n = createNarrator({ lang: "ko", win: f.win, onCaption: (t) => captions.push(t), onSpeaking: (on) => states.push(on) });
  const first = n.speakCue("Bend your knees.", { lang: "en" });
  assert.equal(n.speaking, true);
  assert.deepEqual([f.spoken[0].text, f.spoken[0].lang, f.spoken[0].voice], ["Bend your knees.", "en-US", "en"]);
  const second = n.speakCue("무릎을 세워 주세요.", { lang: "ko" });
  assert.deepEqual([f.spoken[1].lang, f.spoken[1].voice], ["ko-KR", "ko"]);
  assert.ok(f.cancelled() >= 1, "the first utterance was cancelled, not queued");
  f.spoken[0].end();
  assert.equal(n.speaking, true, "the cancelled one ending does not end the new one");
  f.spoken[1].end();
  await Promise.all([first, second]);
  assert.equal(n.speaking, false);
  assert.equal(states.at(-1), false);
  assert.deepEqual(captions, [], "subtitles follow the step clock, not the voice");
});

test("mute, volume and turning guidance off are respected by the voice", async () => {
  const f = fakeSpeech();
  const n = createNarrator({ lang: "en", win: f.win });
  n.setVolume(0.4);
  const a = n.speakCue("Quiet.");
  assert.equal(f.spoken[0].volume, 0.4);
  f.spoken[0].end();
  await a;
  n.setMuted(true);
  await n.speakCue("Not said.");
  assert.equal(f.spoken.length, 1, "muted: nothing is spoken");
  n.setMuted(false);
  n.setVolume(0);
  await n.speakCue("Not said either.");
  assert.equal(f.spoken.length, 1, "volume 0: nothing is spoken");
  n.setVolume(0.7);
  n.setEnabled(false);
  await n.speakCue("Off.");
  assert.equal(f.spoken.length, 1);
  n.setEnabled(true);
  const b = n.speakCue("Back on.");
  assert.equal(f.spoken.length, 2);
  n.stop();
  assert.equal(n.speaking, false, "stop ends it at once (a paused workout)");
  f.spoken[1].end();
  await b;
});

test("without speech, speakCue is harmless", async () => {
  const n = createNarrator({ lang: "ko", win: {} });
  await n.speakCue("Nobody hears this.");
  assert.equal(n.speaking, false);
});
