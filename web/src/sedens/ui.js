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
