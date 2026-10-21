// Customer sign-in pieces as HTML strings (no DOM, no network), so tests render fixtures:
// the "Sign-in activity" section of the Passport privacy page, the facility console's customer
// list, and the one-time link box. account.js fetches, draws and binds them.
import { t } from "./i18n.js";
import { esc, date, time } from "./ui.js";

const list = (value) => (Array.isArray(value) ? value : []);
const when = (iso) => t("acct.ev_when", { date: date(iso), time: time(iso) });

/** One activity line, e.g. "Mina Park created a sign-in link for you." */
export function activityText(item) {
  const who = item?.staff_name || t("acct.who_facility");
  const kind = item?.kind === "link_issued" ? `link_issued_${item.purpose === "reset" ? "reset" : "setup"}` : item?.kind;
  const key = "acct.ev_" + kind;
  const text = t(key, { who });
  return text === key ? "" : text;
}

/** The Passport privacy page's "Sign-in activity" card. ``activity`` null means it could not be loaded. */
export function activitySection(activity) {
  const items = list(activity?.items).filter((item) => activityText(item));
  const body =
    activity == null
      ? `<p class="pp-muted">${esc(t("acct.activity_unavailable"))}</p>`
      : items.length
        ? `<ul class="pp-plain pp-activity">${items.map((item) => `<li><p>${esc(activityText(item))}</p><p class="pp-muted"><time datetime="${esc(item.at)}">${esc(when(item.at))}</time></p></li>`).join("")}</ul>`
        : `<p>${esc(t("acct.activity_none"))}</p>`;
  return `<section class="pp-card" aria-labelledby="pp-activity-h"><h2 id="pp-activity-h">${esc(t("acct.activity_title"))}</h2><p class="pp-muted">${esc(t("acct.activity_lead"))}</p>${body}</section>`;
}

/** The facility console's customer list with a link button per customer (none in a demonstration). */
export function customerList(data) {
  const items = list(data?.items);
  const intro = `<h2 id="customer-signin-title">${esc(t("acct.links_title"))}</h2><p class="sd-muted">${esc(t("acct.links_hint"))}</p>`;
  if (data?.demo) return `${intro}${`<p class="sd-notice" role="note">${esc(t("acct.demo_note"))}</p>`}`;
  if (!items.length) return `${intro}<p class="sd-muted">${esc(t("acct.links_none"))}</p>`;
  const rows = items
    .map((c) => {
      const state = c.open_link
        ? t("acct.open_link", { time: when(c.open_link.expires_at) })
        : c.has_password ? t("acct.can_sign_in") : t("acct.not_set_up");
      const purpose = c.has_password ? "reset" : "setup";
      const label = t(purpose === "reset" ? "acct.create_reset" : "acct.create_setup");
      return `<li data-customer="${esc(c.id)}"><span>${esc(c.name)} <span class="sd-muted">${esc(state)}</span></span><button class="sd-ghost" data-link-for="${esc(c.id)}" data-purpose="${purpose}" data-name="${esc(c.name)}" aria-label="${esc(label + " · " + c.name)}">${esc(label)}</button></li>`;
    })
    .join("");
  return `${intro}<div id="customer-link-result" tabindex="-1"></div><ul class="sd-list">${rows}</ul>`;
}

/** The link, shown once: a read-only field, a copy button and when it stops working. */
export function linkBox(issued, origin) {
  const url = origin + issued.link;
  const name = issued.customer?.name || "";
  return `<div class="sd-notice sd-link-box" role="group" aria-labelledby="customer-link-title"><h3 id="customer-link-title">${esc(t("acct.link_for", { name }))}</h3><label class="sd-field"><span>${esc(t("acct.link_label"))}</span><input id="customer-link" type="text" readonly value="${esc(url)}" autocomplete="off" spellcheck="false"></label><p><button class="sd-primary" data-copy-link>${esc(t("acct.copy"))}</button> <span id="customer-link-status" role="status"></span></p><p>${esc(t("acct.link_once", { name, time: when(issued.expires_at) }))}</p><p class="sd-muted">${esc(t("acct.link_choose"))}</p><p class="sd-muted">${esc(t("acct.link_replaces"))}</p></div>`;
}

/** The page where the link holder chooses a password. ``state``: form | no_token | done. */
export function setupPage(state, back = "") {
  if (state === "done")
    return `${back}<h1>${esc(t("acct.done_title"))}</h1><section class="sd-panel"><p role="status">${esc(t("acct.done_body"))}</p><a class="sd-primary" href="#/">${esc(t("acct.done_signin"))}</a></section>`;
  if (state === "no_token")
    return `${back}<h1>${esc(t("acct.no_token_title"))}</h1><section class="sd-panel"><p>${esc(t("acct.no_token_body"))}</p></section>`;
  return `${back}<h1>${esc(t("acct.setup_title"))}</h1><section class="sd-panel"><p>${esc(t("acct.setup_lead"))}</p><form id="account-setup" novalidate><label class="sd-field"><span>${esc(t("acct.new_password"))}</span><input name="password" type="password" autocomplete="new-password" minlength="10" maxlength="1024" required aria-describedby="account-hint"></label><label class="sd-field"><span>${esc(t("acct.confirm_password"))}</span><input name="confirm" type="password" autocomplete="new-password" minlength="10" maxlength="1024" required></label><p id="account-hint" class="sd-muted">${esc(t("acct.password_hint"))}</p><p class="sd-error" role="alert"></p><button class="sd-primary">${esc(t("acct.save"))}</button></form></section>`;
}
