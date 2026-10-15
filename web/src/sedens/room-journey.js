// Pure helpers for the room journey shell (room.js). No DOM and no network here,
// so the rules the screens follow can be tested in node (test/sedens-room-journey.test.mjs).

/** Which part of the room screen draws each journey state (docs/SEDENS_ROOM_FLOW.md §1). */
export const SCAN_STATES = Object.freeze(["scan_intro", "scan_front", "scan_left", "scan_back", "scan_right", "scan_processing"]);
export const TRAINING_STATES = Object.freeze(["ready_to_train", "exercise", "exercise_paused"]);
export const SHELL_STATES = Object.freeze([
  "identified", "readiness", "readiness_blocked", "session_choice", "session_setup", "recommendation", "session_complete",
]);

/** "shell" (room.js draws it), "scan", "scan_result", "player", "ended", or null for an unknown state. */
export function ownerOf(state) {
  if (SCAN_STATES.includes(state)) return "scan";
  if (state === "scan_result") return "scan_result";
  if (TRAINING_STATES.includes(state)) return "player";
  if (state === "ended") return "ended";
  if (SHELL_STATES.includes(state)) return "shell";
  return null;
}

/** The server's room-ended denial codes: the visit is over and the screen returns to entry. */
export const ENDED_CODES = Object.freeze(["room_session_expired", "room_session_ended", "room_session_idle"]);

/** Denial codes that have reviewed copy in both languages (key "rj.err_<code>"). */
export const KNOWN_ERRORS = Object.freeze([
  "journey_changed", "invalid_transition", "readiness_required", "readiness_out_of_order", "readiness_complete",
  "purchase_required", "not_enabled_here", "not_available", "course_finished", "plan_unavailable",
  "feedback_recorded", "safety_stopped", "consent_required", "stale_consent_text", "invalid",
  "variant_unavailable", "image_required",
]);

/** After these refusals the screen re-reads the journey and shows the state the server holds. */
export const RESYNC_CODES = Object.freeze(["journey_changed", "invalid_transition", "feedback_recorded", "safety_stopped",
  "readiness_out_of_order", "readiness_complete", "readiness_required"]);

/** The copy key for a failed request, or null when the server's own message should be shown (English only). */
export function errorKey(error) {
  if (!error) return "rj.err_generic";
  if (!("status" in error) || error.status === 0) return "rj.err_network";
  if (error.status >= 500) return "rj.err_generic";
  return KNOWN_ERRORS.includes(error.code) ? "rj.err_" + error.code : null;
}

/** Split the session_choice courses into Path A (continue the enrolled program), Path B
 * (other courses this room may play) and whether Path C (personalized) is offered. */
export function choicePaths(choice) {
  const courses = Array.isArray(choice?.courses) ? choice.courses : [];
  const playable = courses.filter((c) => c && (c.reason === "entitled" || c.reason === "free_here"));
  const resume = playable.find((c) => c.enrolled && c.progress?.next) || null;
  return {
    resume,
    others: playable.filter((c) => c !== resume),
    personalized: Boolean(choice?.personalized),
  };
}

/** The 1-based number of a course's next session within the enrolled version, or null. */
export function nextSessionNumber(progress) {
  if (!progress?.next || !progress.total) return null;
  return Math.min(progress.total, (progress.done || 0) + 1);
}

/** The server's effort band label for each number 0-10 ({from, to, text} bands). */
export function effortLabels(labels) {
  const bands = Array.isArray(labels) ? labels : [];
  return Array.from({ length: 11 }, (_, n) => bands.find((b) => b.from <= n && n <= b.to)?.text || "");
}

/** The bands in order, each with its column span on the 0-10 scale (for the wide layout). */
export function effortBands(labels) {
  return (Array.isArray(labels) ? labels : [])
    .filter((b) => Number.isInteger(b.from) && Number.isInteger(b.to) && b.from <= b.to && b.from >= 0 && b.to <= 10)
    .sort((a, b) => a.from - b.from)
    .map((b) => ({ from: b.from, to: b.to, span: b.to - b.from + 1, text: b.text }));
}

export const NOTE_MAX = 280;

/** The workout/feedback body from what the customer chose. Only answered questions are sent;
 * the note is trimmed and capped (it is stored with the session, never sent to analytics). */
export function feedbackBody(answers) {
  const a = answers || {};
  const body = { effort: Number.isInteger(a.effort) && a.effort >= 0 && a.effort <= 10 ? a.effort : null };
  body.discomfort = a.discomfort === "yes" || a.discomfort === "no" ? a.discomfort : null;
  if (body.discomfort === "yes") {
    body.urgent = a.urgent === true;
    if (!body.urgent) {
      if (Array.isArray(a.regions) && a.regions.length) body.regions = [...new Set(a.regions)];
      if (a.when) body.when = a.when;
      if (a.strength) body.strength = a.strength;
      if (a.still === true || a.still === false) body.still = a.still;
    }
  }
  const note = typeof a.note === "string" ? a.note.trim().slice(0, NOTE_MAX) : "";
  if (note && !body.urgent) body.note = note;
  return body;
}

/** True when the finished workout ended with a safety stop (no other session is offered). */
export function safetyStopped(workout) {
  return Boolean(workout?.safety || workout?.summary?.end_reason === "safety_stop" || workout?.summary?.safety_category);
}

/** True when the safety stop asked for urgent help (119). */
export function urgentStop(workout) {
  return workout?.summary?.safety_category === "urgent";
}

// -- client analytics: names the server accepts, keys that are simple snake_case and values that are short codes --

export const CLIENT_EVENTS = Object.freeze([
  "room_screen_viewed", "scan_result_viewed", "exercise_started", "exercise_skipped",
  "anatomy_opened", "structure_isolated", "narration_toggled", "music_changed",
]);
const KEY = /^[a-z][a-z0-9_]{0,39}$/;
const PERSONAL = /(email|phone|name|address|password|token|credential|pin|answer|note|comment|text|birth|born)/i;
const CODE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/;

/** Keep only props the server accepts and that cannot carry free text. */
export function safeProps(props) {
  const out = {};
  for (const [key, value] of Object.entries(props || {})) {
    if (!KEY.test(key) || PERSONAL.test(key)) continue;
    if (typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) out[key] = value;
    else if (typeof value === "string" && CODE.test(value)) out[key] = value;
    if (Object.keys(out).length >= 16) break;
  }
  return out;
}

/** Show a notice in the banner only when the screen does not already say the same thing. */
export function bannerText(notice, screenText) {
  const text = typeof notice?.text === "string" ? notice.text.trim() : "";
  if (!text) return "";
  return String(screenText || "").includes(text) ? "" : text;
}

/** Minutes for people: 0 becomes "under a minute" (key), otherwise the number. */
export function minutesValue(minutes) {
  const n = Number(minutes);
  return Number.isFinite(n) && n >= 1 ? Math.round(n) : 0;
}

/** Group recommendation steps by phase, keeping the plan's order. */
export function stepsByPhase(steps) {
  const order = ["warm_up", "main", "cool_down"];
  const groups = order.map((phase) => ({ phase, steps: [] }));
  for (const step of Array.isArray(steps) ? steps : []) {
    const group = groups.find((g) => g.phase === step.phase) || groups[1];
    group.steps.push(step);
  }
  return groups.filter((g) => g.steps.length);
}
