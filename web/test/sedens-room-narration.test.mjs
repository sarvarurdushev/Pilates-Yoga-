// Narration and music must never be required: with no SpeechSynthesis and no
// WebAudio the session still works and captions are still shown (brief §25-26).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createNarrator, pickVoice } from "../src/sedens/room-narration.js";
import { createMusic, MODES } from "../src/sedens/room-music.js";

test("without speechSynthesis narration only captions, and never throws", async () => {
  const captions = [];
  const n = createNarrator({ lang: "ko", win: {}, onCaption: (t) => captions.push(t) });
  assert.equal(n.available, false);
  await n.speak(["누워서 무릎을 세워 주세요.", "편하게 호흡하세요."]);
  assert.deepEqual(captions, ["누워서 무릎을 세워 주세요.", "편하게 호흡하세요."]);
  n.stop();
  n.setVolume(2);
  n.setEnabled(false);
  await n.speak("Breathe normally.");
  assert.equal(captions.at(-1), "Breathe normally.");
});

test("with a speech engine, lines are spoken in the room language and stop interrupts", async () => {
  const spoken = [];
  class Utterance { constructor(text) { this.text = text; } }
  const synth = {
    getVoices: () => [{ lang: "en-US", localService: true, name: "en" }, { lang: "ko-KR", localService: false, name: "ko" }],
    speak(u) { spoken.push([u.text, u.lang, u.voice?.name]); setTimeout(() => u.onend?.(), 0); },
    cancel() {},
    addEventListener() {},
  };
  const n = createNarrator({ lang: "ko", win: { speechSynthesis: synth, SpeechSynthesisUtterance: Utterance } });
  assert.equal(n.available, true);
  await n.speak(["하나", "둘"]);
  assert.deepEqual(spoken, [["하나", "ko-KR", "ko"], ["둘", "ko-KR", "ko"]]);
  n.setLang("en");
  await n.speak("One");
  assert.deepEqual(spoken.at(-1), ["One", "en-US", "en"]);
});

test("voice choice prefers the exact language", () => {
  assert.equal(pickVoice([{ lang: "en-GB" }, { lang: "en-US" }], "en").lang, "en-US");
  assert.equal(pickVoice([{ lang: "ko" }], "ko").lang, "ko");
  assert.equal(pickVoice([], "ko"), null);
});

test("without WebAudio music is unavailable, stays off and never throws", () => {
  const m = createMusic({ win: {} });
  assert.equal(m.available, false);
  assert.equal(m.setMode("calm"), "off");
  m.setVolume(0.3);
  m.duck(true);
  m.pause();
  m.resume();
  m.destroy();
  assert.deepEqual(MODES, ["off", "calm", "focus", "energy", "own"]);
});
