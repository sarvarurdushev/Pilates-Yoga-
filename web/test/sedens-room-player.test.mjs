// Pure player timing: sets, sides, holds, rests, rep pacing, automatic next and the
// presence check. Time is passed in, so pause/resume/repeat/refresh are just values.
import { test } from "node:test";
import assert from "node:assert/strict";
import { segments, workMs, positionAt, afterWork, presenceTracker, SIDE_SWITCH_SECONDS } from "../src/sedens/room-player-clock.js";

test("reps on each side: work per side with a switch between, set rest between sets", () => {
  const dose = { mode: "reps", sets: 2, reps: 8, seconds_per_rep: 4, sides: "each_side", set_rest: 35 };
  const s = segments(dose);
  assert.deepEqual(s.map((x) => x.kind), ["reps", "switch", "reps", "rest", "reps", "switch", "reps"]);
  assert.equal(workMs(dose), (4 * 32 + 2 * SIDE_SWITCH_SECONDS + 35) * 1000);
});

test("a hold counts down; alternate sides double the work of one segment", () => {
  const hold = { mode: "hold", sets: 1, hold_seconds: 30, sides: "none" };
  assert.equal(workMs(hold), 30000);
  const p = positionAt(hold, 12000);
  assert.equal(p.kind, "hold");
  assert.equal(p.remaining_s, 18);
  const alt = { mode: "reps", sets: 1, reps: 6, seconds_per_rep: 4, sides: "alternate" };
  assert.equal(workMs(alt), 48000);
});

test("the rep pace guide follows time and never exceeds the planned reps", () => {
  const dose = { mode: "reps", sets: 1, reps: 8, seconds_per_rep: 5, sides: "none" };
  assert.equal(positionAt(dose, 0).rep, 1);
  assert.equal(positionAt(dose, 5000).rep, 2);
  assert.equal(positionAt(dose, 39999).rep, 8);
  assert.equal(positionAt(dose, 99999).rep, 8);
  assert.equal(positionAt(dose, 40000).done, true);
});

test("set and side are reported for every moment; seeking back restores them", () => {
  const dose = { mode: "reps", sets: 2, reps: 4, seconds_per_rep: 5, sides: "each_side", set_rest: 30 };
  assert.deepEqual([positionAt(dose, 1000).set, positionAt(dose, 1000).side], [1, "left"]);
  assert.deepEqual([positionAt(dose, 26000).set, positionAt(dose, 26000).side], [1, "right"]);
  assert.equal(positionAt(dose, 46000).kind, "rest");
  assert.deepEqual([positionAt(dose, 80000).set, positionAt(dose, 80000).side], [2, "left"]);
  assert.deepEqual([positionAt(dose, 1000).set, positionAt(dose, 1000).side], [1, "left"]);
});

test("automatic next: transition when on, wait when off, finish on the last step", () => {
  assert.deepEqual(afterWork({ autoNext: true, isLast: false }), { action: "transition", seconds: 10 });
  assert.deepEqual(afterWork({ autoNext: false, isLast: false }), { action: "wait" });
  assert.deepEqual(afterWork({ autoNext: true, isLast: true }), { action: "finish" });
});

test("presence check after three automatic advances without a touch", () => {
  const p = presenceTracker();
  assert.equal(p.autoAdvanced(), false);
  assert.equal(p.autoAdvanced(), false);
  p.touched();
  assert.equal(p.autoAdvanced(), false);
  assert.equal(p.autoAdvanced(), false);
  assert.equal(p.autoAdvanced(), true);
});

test("odd doses are safe", () => {
  assert.ok(workMs({}) >= 1000);
  assert.equal(positionAt(null, 5000).done, true);
});
