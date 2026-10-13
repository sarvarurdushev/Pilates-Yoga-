// Pure timing for one workout step: what the player shows at time t (which set,
// which side, rep pacing or hold countdown, rest) and when the step's work is done.
// No DOM, no clocks of its own: callers pass elapsed milliseconds, so pause,
// resume, repeat and refresh-resume are just different values of t.
//
// Rep "counting" is a pace guide (reps x seconds per rep), never a count of the
// customer's movements: the camera is off during the workout (brief §33).

export const DEFAULT_SECONDS_PER_REP = 5;
export const SIDE_SWITCH_SECONDS = 5;
export const TRANSITION_SECONDS = 10;
export const PRESENCE_AFTER_AUTO_ADVANCES = 3;

const SIDES = { none: [null], both: [null], each_side: ["left", "right"], alternate: ["alternate"] };

/** The ordered segments of a step: work (per set and side), side switches and rests. */
export function segments(dose) {
  const d = dose || {};
  const sets = Math.max(1, d.sets || 1);
  const isHold = d.mode === "hold" || (!!d.hold_seconds && !d.reps);
  const spr = d.seconds_per_rep || DEFAULT_SECONDS_PER_REP;
  const sides = SIDES[d.sides] || SIDES.none;
  const setRest = d.set_rest ?? d.rest_seconds ?? 0;
  const out = [];
  for (let set = 1; set <= sets; set += 1) {
    sides.forEach((side, i) => {
      if (i > 0) out.push({ kind: "switch", set, side, seconds: SIDE_SWITCH_SECONDS });
      let seconds;
      if (d.work_seconds) seconds = d.work_seconds * (d.sides === "alternate" ? 2 : 1);
      else if (isHold) seconds = (d.hold_seconds || 0) * (d.sides === "alternate" ? 2 : 1);
      else seconds = (d.reps || 0) * spr * (d.sides === "alternate" ? 2 : 1);
      out.push({ kind: isHold ? "hold" : "reps", set, side, seconds: Math.max(1, Math.round(seconds)),
                 reps: isHold ? 0 : (d.reps || 0) * (d.sides === "alternate" ? 2 : 1), seconds_per_rep: spr });
    });
    if (set < sets && setRest > 0) out.push({ kind: "rest", set, side: null, seconds: setRest });
  }
  return out;
}

/** Total work time of the step in ms (what the clock runs before "done"). */
export function workMs(dose) {
  return segments(dose).reduce((sum, s) => sum + s.seconds * 1000, 0);
}

/** What to show at `ms` into the step. */
export function positionAt(dose, ms) {
  const list = segments(dose);
  const total = list.reduce((sum, s) => sum + s.seconds * 1000, 0);
  const at = Math.max(0, Math.min(Number(ms) || 0, total));
  let start = 0;
  for (const [index, seg] of list.entries()) {
    const end = start + seg.seconds * 1000;
    if (at < end || index === list.length - 1) {
      const into = Math.min(at - start, seg.seconds * 1000);
      const out = {
        index, kind: seg.kind, set: seg.set, sets: Math.max(1, dose?.sets || 1), side: seg.side,
        remaining_s: Math.max(0, Math.ceil((end - Math.max(at, start)) / 1000)),
        progress: total ? at / total : 1, done: at >= total,
      };
      if (seg.kind === "reps" && seg.reps) {
        // Pace guide: which repetition the pace is on (1-based).
        out.rep = Math.min(seg.reps, Math.floor(into / (seg.seconds_per_rep * 1000)) + 1);
        out.reps = seg.reps;
      }
      return out;
    }
    start = end;
  }
  return { index: 0, kind: "done", set: 1, sets: 1, side: null, remaining_s: 0, progress: 1, done: true };
}

/** After the work is done: automatic next shows a transition, otherwise wait for a tap. */
export function afterWork({ autoNext, isLast }) {
  if (isLast) return { action: "finish" };
  return autoNext ? { action: "transition", seconds: TRANSITION_SECONDS } : { action: "wait" };
}

/** Counts automatic advances without any touch; asks "still with us?" at the limit. */
export function presenceTracker(limit = PRESENCE_AFTER_AUTO_ADVANCES) {
  let count = 0;
  return {
    touched() { count = 0; },
    autoAdvanced() { count += 1; return count >= limit; },
    get count() { return count; },
  };
}
