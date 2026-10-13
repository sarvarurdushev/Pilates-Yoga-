// The room's anatomy timeline: what the viewer shows depends only on (step, time),
// so play, pause, seek back, repeat, restart and skip always land on the right state,
// and a new step never inherits the previous step's structures (brief §31).
import { test } from "node:test";
import assert from "node:assert/strict";
import { anatomyStateAt, stateKey, boundaries } from "../src/sedens/room-anatomy.js";
import { keysToIds } from "../src/sedens/anatomy-room-bridge.js";

const step = {
  anatomy: {
    structures: [
      { key: "rectus abdominis", role: "prime" },
      { key: "transversus abdominis", role: "assisting" },
      { key: "diaphragm", role: "steadying" },
    ],
    timeline: [
      { id: "m1", start_ms: 2000, end_ms: 6000, mode: "highlight", layer: "", structures: ["diaphragm"], cue: "Breathe in" },
      { id: "m2", start_ms: 6000, end_ms: 9000, mode: "isolate", layer: "muscles_deep", structures: ["transversus abdominis"], cue: "" },
    ],
  },
};
const other = { anatomy: { structures: [{ key: "gluteus maximus", role: "focus" }], timeline: [] } };

test("outside any moment the exercise-level mapping is shown, focus = focus/prime roles", () => {
  const s = anatomyStateAt(step, 0);
  assert.deepEqual(s.structures, ["rectus abdominis", "transversus abdominis", "diaphragm"]);
  assert.deepEqual(s.focus, ["rectus abdominis"]);
  assert.equal(s.mode, "highlight");
  assert.equal(s.moment, null);
  assert.equal(anatomyStateAt(step, 9500).moment, null);
});

test("an authored moment applies from start (inclusive) to end (exclusive)", () => {
  assert.equal(anatomyStateAt(step, 1999).moment, null);
  assert.equal(anatomyStateAt(step, 2000).moment, "m1");
  assert.equal(anatomyStateAt(step, 5999).cue, "Breathe in");
  const iso = anatomyStateAt(step, 6000);
  assert.equal(iso.moment, "m2");
  assert.equal(iso.mode, "isolate");
  assert.equal(iso.layer, "muscles_deep");
  assert.deepEqual(iso.focus, ["transversus abdominis"]);
});

test("seeking back restores the earlier moment; repeat/restart return to the start state", () => {
  const forward = [0, 2500, 7000].map((t) => stateKey(anatomyStateAt(step, t)));
  const back = stateKey(anatomyStateAt(step, 2500));
  assert.equal(back, forward[1]);
  assert.equal(stateKey(anatomyStateAt(step, 0)), forward[0]);
  assert.notEqual(forward[1], forward[2]);
});

test("a new step never inherits the previous step's structures", () => {
  const a = anatomyStateAt(step, 7000);
  const b = anatomyStateAt(other, 7000);
  assert.deepEqual(b.structures, ["gluteus maximus"]);
  assert.ok(!b.structures.includes("transversus abdominis"));
  assert.notEqual(stateKey(a), stateKey(b));
});

test("no intensity or activation value is ever produced", () => {
  for (const t of [0, 2500, 7000]) {
    const s = anatomyStateAt(step, t);
    assert.deepEqual(Object.keys(s).sort(), ["cue", "focus", "layer", "mode", "moment", "structures"]);
  }
});

test("bad or missing input is safe", () => {
  assert.deepEqual(anatomyStateAt(null, 0).structures, []);
  assert.deepEqual(anatomyStateAt({}, NaN).structures, []);
  assert.equal(stateKey(null), "clear");
  assert.deepEqual(boundaries(step), [0, 2000, 6000, 9000]);
});

test("the in-frame bridge resolves names to drawn ids and reports unknown names", () => {
  const table = { "rectus abdominis": [10], deltoid: [21, 22, 23] };
  const lookup = (k) => table[k] || [];
  assert.deepEqual(keysToIds(["deltoid", "rectus abdominis", "deltoid", "nope"], lookup), { ids: [21, 22, 23, 10], missing: ["nope"] });
});
