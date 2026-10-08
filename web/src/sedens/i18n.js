import { STRINGS } from "./strings.js";

const KEY = "sedens-lang";
export const LANGUAGES = ["ko", "en"];

function stored() {
  try {
    return globalThis.localStorage?.getItem(KEY);
  } catch {
    return null;
  }
}

let current = LANGUAGES.includes(stored())
  ? stored()
  : String(globalThis.navigator?.language || "ko").toLowerCase().startsWith("en") ? "en" : "ko";

export const lang = () => current;

export function setLang(value) {
  if (!LANGUAGES.includes(value)) return;
  current = value;
  try {
    globalThis.localStorage?.setItem(KEY, value);
  } catch {
    // Private mode or blocked storage: the choice lasts for this page only.
  }
  if (globalThis.document?.documentElement) document.documentElement.lang = value;
}

/** Translate a key, substituting {name} placeholders. Missing keys fall back to English, then the key. */
export function t(key, vars = {}) {
  const text = STRINGS[current]?.[key] ?? STRINGS.en[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (_, name) => (name in vars ? String(vars[name]) : `{${name}}`));
}
