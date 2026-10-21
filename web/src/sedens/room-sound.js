// Sound settings of the room player: voice volume, music volume, one mute-all, spoken guidance
// on or off, subtitles on or off, and the narration language. They are kept for the room
// session (this tab's session storage, keyed by the visit), so a step, a language change or a
// reload of the page does not reset them. Storage may be missing or blocked: nothing here throws.

export const NARRATION_LANGS = ["auto", "ko", "en"];

export const DEFAULT_SOUND = Object.freeze({ narration: true, subtitles: true, voice: 0.9, music: 0.5, muted: false, lang: "auto" });

const clamp01 = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback;
};

/** Any stored value, made into valid settings (unknown keys dropped, bad values defaulted). */
export function normalizeSound(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  return {
    narration: typeof r.narration === "boolean" ? r.narration : DEFAULT_SOUND.narration,
    subtitles: typeof r.subtitles === "boolean" ? r.subtitles : DEFAULT_SOUND.subtitles,
    voice: clamp01(r.voice, DEFAULT_SOUND.voice),
    music: clamp01(r.music, DEFAULT_SOUND.music),
    muted: typeof r.muted === "boolean" ? r.muted : DEFAULT_SOUND.muted,
    lang: NARRATION_LANGS.includes(r.lang) ? r.lang : DEFAULT_SOUND.lang,
  };
}

/** The level a sound actually plays at: mute-all wins over every slider. */
export function effectiveVolume(volume, muted) {
  return muted ? 0 : clamp01(volume, 0);
}

/** The language narration is in: the room's, unless the customer chose one. */
export function narrationLanguage(choice, roomLang) {
  return choice === "ko" || choice === "en" ? choice : roomLang === "en" ? "en" : "ko";
}

/** The language of a line of text: Korean when it has Hangul, otherwise `fallback`. Used for a
 * creator's course, which is written in one language whatever the room language is. */
export function textLanguage(text, fallback = "ko") {
  const s = String(text || "");
  if (/[ᄀ-ᇿ㄰-㆏가-힯]/.test(s)) return "ko";
  return /[A-Za-z]/.test(s) ? "en" : fallback;
}

export const soundKey = (sessionId) => "sedens.room.sound:" + String(sessionId || "visit");

export function loadSound(storage, key) {
  try {
    return normalizeSound(JSON.parse(storage.getItem(key)));
  } catch {
    return normalizeSound(null);
  }
}

export function saveSound(storage, key, sound) {
  try {
    storage.setItem(key, JSON.stringify(normalizeSound(sound)));
    return true;
  } catch {
    return false;
  }
}
