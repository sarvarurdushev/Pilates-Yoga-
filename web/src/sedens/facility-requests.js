// Facility data requests: the customers' requests to erase their Passport, for the administrator
// of that facility to decide. SEDENS deletes nothing when a request is decided; "completed" means
// the facility handled it outside SEDENS, and the page says so. Only the customer's display name
// is shown. Rendering is pure (requestsHtml) so it can be tested.
import { sedens, ApiError } from "./api.js";
import { t } from "./i18n.js";
import { esc, date, problem } from "./ui.js";

const STATES = ["received", "completed", "declined", "withdrawn"];
const isFacilityAdmin = (me) => me?.role === "admin" && me.organization?.kind === "facility";

export const stateLabel = (state) => t("req.state_" + (STATES.includes(state) ? state : "received"));

/** What SEDENS does not do, what it can delete today, and what needs a retention policy first. */
export function policyHtml() {
  return `<section class="sd-panel" aria-labelledby="req-policy"><p id="req-policy"><strong>${esc(t("req.no_deletion"))}</strong></p><h3>${esc(t("req.can_title"))}</h3><ul><li>${esc(t("req.can_photos"))}</li></ul><h3>${esc(t("req.policy_title"))}</h3><p>${esc(t("req.policy_list"))}</p><p class="sd-muted">${esc(t("req.policy_body"))}</p></section>`;
}

function decideForm(item, max) {
  const id = esc(item.id);
  return `<form class="sd-stack" data-decide-form="${id}"><label class="sd-field"><span>${esc(t("req.note"))}</span><textarea name="note" rows="2" maxlength="${esc(max)}" aria-describedby="note-hint-${id}"></textarea></label><p class="sd-muted" id="note-hint-${id}">${esc(t("req.note_hint"))}</p><div class="sd-actions"><button class="sd-primary" type="submit" value="completed">${esc(t("req.complete"))}</button><button class="sd-ghost" type="submit" value="declined">${esc(t("req.decline"))}</button></div><p class="sd-muted">${esc(t("req.complete_hint"))}</p><p class="sd-error" role="alert"></p></form>`;
}

export function itemHtml(item, max = 500) {
  const lines = [
    `<span>${esc(t("req.requested", { date: date(item.requested_at) }))}</span>`,
    item.decided_at ? `<span>${esc(t("req.decided_on", { date: date(item.decided_at) }))}</span>` : "",
    item.message ? `<span>${esc(t("req.message", { text: item.message }))}</span>` : "",
    item.note ? `<span>${esc(t("req.your_note", { text: item.note }))}</span>` : "",
  ].filter(Boolean);
  return `<li class="sd-request" data-request="${esc(item.id)}"><div><strong>${esc(item.customer || t("req.customer"))}</strong> <span class="sd-badge">${esc(stateLabel(item.state))}</span></div><div class="sd-muted">${lines.join(" · ")}</div>${item.state === "received" ? decideForm(item, max) : ""}</li>`;
}

/** The whole page body (after the title) for the list the server sent. */
export function requestsHtml(data) {
  const items = Array.isArray(data?.items) ? data.items : [];
  const open = items.filter((i) => i.state === "received");
  const decided = items.filter((i) => i.state !== "received");
  const list = (rows) => `<ul class="sd-list">${rows.map((i) => itemHtml(i, data.max_note ?? 500)).join("")}</ul>`;
  return `<p>${esc(t("req.lead"))}</p>${policyHtml()}<section class="sd-panel"><h2>${esc(t("req.open"))}</h2>${open.length ? list(open) : `<p class="sd-muted">${esc(items.length ? t("req.none_open") : t("req.none"))}</p>`}</section>${decided.length ? `<section class="sd-panel"><h2>${esc(t("req.decided"))}</h2>${list(decided)}</section>` : ""}`;
}

/** The note a decision needs: a decline must carry one. Returns an error key or "". */
export function decisionProblem(decision, note) {
  return decision === "declined" && !String(note ?? "").trim() ? "req.decline_needs_note" : "";
}

export async function facilityRequests(ctx) {
  const head = `<a class="sd-back" href="#/facility">← ${esc(t("facility.title"))}</a><h1>${esc(t("req.title"))}</h1>`;
  if (!isFacilityAdmin(ctx.me)) return ctx.page(`${head}${ctx.notice(t("req.need_admin"))}`);
  let data;
  try {
    data = await sedens("facility/data-requests");
  } catch (error) {
    if (ctx.stale()) return;
    if (error instanceof ApiError && (error.status === 403 || error.status === 401)) {
      return ctx.page(`${head}${ctx.notice(t("req.need_admin"))}`);
    }
    return ctx.page(`${head}${ctx.notice(problem(error), "error")}`);
  }
  if (ctx.stale()) return;
  ctx.page(`${head}<p class="sd-muted">${esc(ctx.me.organization.display_name)}</p>${requestsHtml(data)}`);
  document.querySelectorAll("[data-decide-form]").forEach((form) => {
    form.onsubmit = async (event) => {
      event.preventDefault();
      const decision = event.submitter?.value;
      const error = form.querySelector(".sd-error");
      const note = form.elements.note.value;
      const missing = decisionProblem(decision, note);
      if (missing) {
        error.textContent = t(missing);
        form.elements.note.focus();
        return;
      }
      form.querySelectorAll("button").forEach((b) => (b.disabled = true));
      try {
        await sedens("facility/data-requests/decide", { id: form.dataset.decideForm, decision, note });
        ctx.refresh();
      } catch (failure) {
        form.querySelectorAll("button").forEach((b) => (b.disabled = false));
        error.textContent = problem(failure);
      }
    };
  });
}
