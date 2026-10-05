import { href } from "./core.js";

// An absent visit must stay absent: neither the note date nor the current
// client route proves which visit a historical or general note belongs to.
export function feedbackVisitDisclosure(note, { role, clientId, inlineEdit = false } = {}) {
  if (note.session_id || note.analysis_id) return "";
  const repair = role === "student" ? "" : inlineEdit
    ? " Use Edit feedback to connect the exact visit when it is known."
    : clientId ? ` <a href="${href("client", { client: clientId, tab: "notes", note: note.id })}">Open feedback to connect a known visit →</a>` : "";
  return `<p class="muted">Source visit not recorded. This feedback is not part of a saved visit.${repair}</p>`;
}
