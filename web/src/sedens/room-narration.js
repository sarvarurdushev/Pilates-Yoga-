// Narration for the room player, with no paid speech service (brief §25).
//
// Providers, in order: (a) the creator's recording (a step's narration audio, played by the
// player along the step clock; see room-cues.js), (b) the browser's own SpeechSynthesis,
// (c) subtitles only. Subtitles are ALWAYS available, so the session works fully with no
// speech at all; nothing here ever throws. Timed cues are spoken one at a time with
// speakCue(): it never queues, a new cue replaces the one still being said.

const VOICE_LANG = { ko: "ko-KR", en: "en-US" };

export function pickVoice(voices, lang) {
  const wanted = VOICE_LANG[lang] || lang;
  const list = Array.from(voices || []);
  return list.find((v) => v.lang === wanted && v.localService)
    || list.find((v) => v.lang === wanted)
    || list.find((v) => String(v.lang || "").toLowerCase().startsWith(lang))
    || null;
}

export function createNarrator({ lang = "ko", win = globalThis, onCaption = () => {}, onSpeaking = () => {} } = {}) {
  const synth = win && win.speechSynthesis;
  const Utterance = win && win.SpeechSynthesisUtterance;
  const speechAvailable = !!(synth && typeof Utterance === "function");
  let enabled = true;
  let volume = 0.9;
  let current = lang;
  let voice = null;
  let token = 0;
  let audio = null;
  let muted = false;
  let speaking = false;
  let utterance = null; // held so the engine's onend is not lost to garbage collection
  const audible = () => enabled && !muted && volume > 0;

  const refreshVoice = () => {
    try {
      voice = speechAvailable ? pickVoice(synth.getVoices(), current) : null;
    } catch {
      voice = null;
    }
  };
  refreshVoice();
  try {
    if (speechAvailable && typeof synth.addEventListener === "function") synth.addEventListener("voiceschanged", refreshVoice);
  } catch {
    // Older browsers: the first speak() will still find a voice.
  }

  function stopSound() {
    token += 1;
    speaking = false;
    try {
      if (speechAvailable) synth.cancel();
    } catch {
      // ignore
    }
    if (audio) {
      try {
        audio.pause();
      } catch {
        // ignore
      }
      audio = null;
    }
    onSpeaking(false);
  }

  function voiceFor(l) {
    if (!l || l === current) {
      if (!voice) refreshVoice();
      return voice;
    }
    try {
      return speechAvailable ? pickVoice(synth.getVoices(), l) : null;
    } catch {
      return null;
    }
  }

  function sayOne(line, mine, { caption = true, lang: spoken } = {}) {
    return new Promise((resolve) => {
      const text = typeof line === "string" ? line : line?.text || "";
      if (caption) onCaption(text);
      if (!audible() || mine !== token) return resolve();
      if (line && typeof line === "object" && line.audio && typeof win.Audio === "function") {
        try {
          audio = new win.Audio(line.audio);
          audio.volume = volume;
          audio.onended = audio.onerror = () => resolve();
          onSpeaking(true);
          audio.play().catch(() => resolve());
          return;
        } catch {
          return resolve();
        }
      }
      if (!speechAvailable || !text) return resolve();
      try {
        const u = new Utterance(text);
        const l = spoken || current;
        u.lang = VOICE_LANG[l] || l;
        const v = voiceFor(l);
        if (v) u.voice = v;
        u.volume = volume;
        u.rate = 0.95;
        u.onend = u.onerror = () => {
          if (utterance === u) utterance = null;
          resolve();
        };
        utterance = u;
        onSpeaking(true);
        synth.speak(u);
        // Some engines never fire onend; never block the player on narration.
        setTimeout(resolve, Math.min(15000, 1500 + text.length * 90));
      } catch {
        resolve();
      }
    });
  }

  return {
    get available() {
      return speechAvailable;
    },
    get enabled() {
      return enabled;
    },
    /** True while an utterance is being said. */
    get speaking() {
      return speaking;
    },
    /** Speak short lines in order (captions follow along). Interrupts what was playing. */
    async speak(lines) {
      stopSound();
      const mine = token;
      for (const line of [].concat(lines || [])) {
        if (mine !== token) return;
        await sayOne(line, mine);
      }
      if (mine === token) onSpeaking(false);
    },
    /** Say one timed cue (the player decided it is due). Replaces anything still being said, so
     * there is never more than one utterance. Resolves when it ends. No caption is written:
     * subtitles follow the step clock, not the voice. */
    async speakCue(text, { lang: spoken } = {}) {
      stopSound();
      const mine = token;
      speaking = true;
      await sayOne(String(text || ""), mine, { caption: false, lang: spoken });
      if (mine === token) {
        speaking = false;
        onSpeaking(false);
      }
    },
    stop: stopSound,
    setMuted(on) {
      muted = !!on;
      if (muted) stopSound();
    },
    setEnabled(on) {
      enabled = !!on;
      if (!enabled) stopSound();
    },
    setVolume(v) {
      volume = Math.max(0, Math.min(1, Number(v) || 0));
      if (audio) audio.volume = volume;
    },
    setLang(l) {
      current = l;
      refreshVoice();
    },
  };
}
