// Narration for the room player, with no paid speech service (brief §25).
//
// Providers, in order: (a) recorded audio when a line carries an `audio` URL
// (authored recordings; none exist yet, the hook is kept), (b) the browser's own
// SpeechSynthesis, (c) captions only. Captions are ALWAYS shown, so the session
// works fully with no speech at all; nothing here ever throws.

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

  function sayOne(line, mine) {
    return new Promise((resolve) => {
      const text = typeof line === "string" ? line : line?.text || "";
      onCaption(text);
      if (!enabled || mine !== token) return resolve();
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
        u.lang = VOICE_LANG[current] || current;
        if (!voice) refreshVoice();
        if (voice) u.voice = voice;
        u.volume = volume;
        u.rate = 0.95;
        u.onend = u.onerror = () => resolve();
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
    stop: stopSound,
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
