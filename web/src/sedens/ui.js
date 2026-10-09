import { t, lang, setLang } from "./i18n.js";

export const $ = (selector, root = document) => root.querySelector(selector);
export const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const wordmark = () =>
  `<span class="sd-mark" aria-hidden="true"><svg viewBox="0 0 32 32"><path d="M6 22c4 4 16 4 20-2 3-5-2-8-10-8S4 9 7 4c4-5 15-3 19 1" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg></span><span class="sd-word">SEDENS</span>`;

export function header({ me = null, config = null, onLang } = {}) {
  const mode = config?.mode;
  const badge = mode ? `<span class="sd-badge ${mode.name === "demo_free" ? "warn" : ""}">${esc(t("mode." + mode.name))}</span>` : "";
  const demo = me?.organization?.demo ? `<span class="sd-badge warn">${esc(t("common.demo"))}</span>` : "";
  return `<header class="sd-header"><a class="sd-brand" href="/" aria-label="${esc(t("brand.product"))}">${wordmark()}</a><div class="sd-header-right">${badge}${demo}${me ? `<span class="sd-muted">${esc(t("auth.signed_in_as", { name: me.user.name }))}</span><button class="sd-ghost" data-signout>${esc(t("auth.signout"))}</button>` : ""}<button class="sd-ghost" data-lang>${esc(t("lang.toggle"))}</button></div></header>${
    mode && !mode.storage.persistent ? `<div class="sd-banner" role="note">${esc(t("mode.storage_warning"))}</div>` : ""
  }`;
}

export function bindHeader(root, { onLang, onSignOut }) {
  root.querySelector("[data-lang]")?.addEventListener("click", () => {
    setLang(lang() === "ko" ? "en" : "ko");
    onLang?.();
  });
  root.querySelector("[data-signout]")?.addEventListener("click", () => onSignOut?.());
}

export const footer = () => `<footer class="sd-footer"><p>${esc(t("notice.fitness"))}</p><p class="sd-muted">${esc(t("brand.company"))}</p></footer>`;

export function formData(form) {
  return Object.fromEntries(new FormData(form));
}

export function time(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString(lang() === "ko" ? "ko-KR" : "en-US", { hour: "2-digit", minute: "2-digit" });
}

export function date(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(lang() === "ko" ? "ko-KR" : "en-US", { year: "numeric", month: "short", day: "numeric" });
}

/** A price as people read it: "Free", "₩29,000", "$12.00". amount_minor is in the
 * currency's smallest unit (KRW has none, so 29000 means ₩29,000). */
export function money(price) {
  if (!price || price.price_type !== "paid") return t("price.free");
  const digits = price.currency === "KRW" ? 0 : 2;
  const amount = price.currency === "KRW" ? price.amount_minor : price.amount_minor / 100;
  return new Intl.NumberFormat(lang() === "ko" ? "ko-KR" : "en-US", {
    style: "currency", currency: price.currency, minimumFractionDigits: digits, maximumFractionDigits: digits,
  }).format(amount);
}

/** Read a form with types: data-type="int" → number (or null when empty), checkboxes →
 * booleans, and checkboxes sharing a name with data-list → an array of the checked values. */
export function values(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled || el.type === "submit" || el.type === "button" || el.type === "file") continue;
    if (el.type === "checkbox" && el.dataset.list !== undefined) {
      out[el.name] = out[el.name] || [];
      if (el.checked) out[el.name].push(el.value);
    } else if (el.type === "checkbox") {
      out[el.name] = el.checked;
    } else if (el.type === "radio") {
      if (el.checked) out[el.name] = el.value;
    } else if (el.dataset.type === "int") {
      out[el.name] = el.value === "" ? null : Number.parseInt(el.value, 10);
    } else {
      out[el.name] = el.value;
    }
  }
  return out;
}

/** The message to show for a failed call: the known code's translation, else the server's text. */
export function problem(error) {
  const key = "error." + (error?.code || "");
  const translated = t(key);
  return translated !== key ? translated : error?.message || t("common.error");
}

/** Move focus to the page title after a route change (screen readers announce it). */
export function focusTitle(root = document) {
  const h1 = root.querySelector("main h1");
  if (h1) {
    h1.setAttribute("tabindex", "-1");
    h1.focus({ preventScroll: true });
    document.title = h1.textContent + " · SEDENS";
  }
}

/** Only https or same-origin links reach an href; anything else becomes inert text. */
export function safeLink(url, label) {
  const text = esc(label || url);
  try {
    const parsed = new URL(url, location.origin);
    if (parsed.protocol === "https:" || parsed.origin === location.origin)
      return `<a href="${esc(parsed.href)}" target="_blank" rel="noopener noreferrer">${text}</a>`;
  } catch {
    // fall through
  }
  return text;
}
