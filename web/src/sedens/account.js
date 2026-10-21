// Customer sign-in (Phase 4): the #/account/setup page where a customer chooses their own password
// from a one-time link, and the facility console's "Customer sign-in" panel where an administrator
// creates that link. The server decides everything (pilates/sedens/accounts.py); this file only draws.
//
// The link's secret arrives in the address after "#", which browsers never send to a server. It is
// read once, removed from the address bar, and sent only in the body of POST /sedens/account/password.
import { sedens } from "./api.js";
import { t } from "./i18n.js";
import { $, esc, problem } from "./ui.js";
import * as view from "./account-render.js";

const STORE = "sedens-account-link";
let held = null;
let done = false;

function remember(value) {
  try {
    if (value) sessionStorage.setItem(STORE, value);
    else sessionStorage.removeItem(STORE);
  } catch {
    // Private mode or blocked storage: the link works until this page is reloaded.
  }
}

function takeToken(query) {
  const fromAddress = typeof query?.token === "string" ? query.token.trim() : "";
  if (fromAddress) {
    held = fromAddress;
    done = false;
    remember(fromAddress);
    // Keep the secret out of the address bar and this tab's history from here on.
    history.replaceState(null, "", `${location.pathname}${location.search}#/account/setup`);
  }
  if (!held) {
    try {
      held = sessionStorage.getItem(STORE);
    } catch {
      held = null;
    }
  }
  return held;
}

/** #/account/setup — anyone holding the link; no sign-in needed. */
export async function setupPage(ctx) {
  const token = takeToken(ctx.query);
  if (done) return ctx.page(view.setupPage("done", ctx.backLink()));
  if (!token) return ctx.page(view.setupPage("no_token", ctx.backLink()));
  ctx.page(view.setupPage("form", ctx.backLink()));
  const form = $("#account-setup");
  if (!form) return;
  const error = form.querySelector(".sd-error");
  const button = form.querySelector("button");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const password = form.elements.password.value;
    if (password.length < 10) {
      error.textContent = t("acct.too_short");
      form.elements.password.focus();
      return;
    }
    if (password !== form.elements.confirm.value) {
      error.textContent = t("acct.mismatch");
      form.elements.confirm.focus();
      return;
    }
    error.textContent = "";
    button.disabled = true;
    button.textContent = t("acct.saving");
    try {
      await sedens("account/password", { token: held, password });
      held = null;
      remember(null);
      done = true;
      // Every sign-in of this customer ended, this browser's too: reload who is signed in, then say so.
      ctx.refresh();
    } catch (failure) {
      if (ctx.stale()) return;
      if (failure?.code === "link_not_valid") {
        // A refused link is never tried again: do not keep it for the rest of the tab.
        held = null;
        remember(null);
      }
      error.textContent = problem(failure);
      button.disabled = false;
      button.textContent = t("acct.save");
    }
  });
}

async function copy(input, status) {
  try {
    await navigator.clipboard.writeText(input.value);
    status.textContent = t("acct.copied");
  } catch {
    input.focus();
    input.select();
    status.textContent = t("acct.copy_failed");
  }
}

/** The facility console's "Customer sign-in" panel, drawn into ``panel``. ``stale`` stops a late draw. */
export async function customerSignIn(panel, stale = () => false) {
  if (!panel) return;
  const draw = async () => {
    const data = await sedens("facility/customers");
    if (stale()) return false;
    panel.innerHTML = view.customerList(data);
    return true;
  };
  try {
    await draw();
  } catch (failure) {
    if (!stale()) panel.innerHTML = `<p class="sd-notice error">${esc(problem(failure))}</p>`;
    return;
  }
  panel.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-link-for], [data-copy-link]");
    if (!button) return;
    if (button.matches("[data-copy-link]")) {
      copy($("#customer-link", panel), $("#customer-link-status", panel));
      return;
    }
    button.disabled = true;
    try {
      const issued = await sedens("facility/people/link", { user_id: button.dataset.linkFor, purpose: button.dataset.purpose });
      if (!(await draw())) return;
      const result = $("#customer-link-result", panel);
      result.innerHTML = view.linkBox(issued, location.origin);
      result.focus();
    } catch (failure) {
      button.disabled = false;
      const note = document.createElement("span");
      note.className = "sd-error";
      note.setAttribute("role", "alert");
      note.textContent = problem(failure);
      button.after(note);
    }
  });
}
