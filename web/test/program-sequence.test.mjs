import test from "node:test";
import assert from "node:assert/strict";
import {
  exerciseStep,
  configureStep,
  reorderStep,
  removeStep,
} from "../src/platform/program-sequence.js";

test("a custom movement remains configurable, reorderable and removable in one sequence", () => {
  const custom = {
    id: "custom-bridge",
    region_id: "right_shoulder",
    detail: { instructions: "Raise the arm through a comfortable range." },
  };
  const library = { id: "library-breathing", detail: { instructions: "Breathe naturally." } };
  const first = exerciseStep(library, { uid: "card-a", section: "Warm-up" });
  const created = exerciseStep(custom, {
    uid: "card-b",
    section: "Practice",
    targets: ["right_shoulder"],
    analysisId: "assessment-1",
  });

  assert.equal(created._uid, "card-b");
  assert.notEqual(created._uid, first._uid);
  assert.equal(created.exercise_id, "custom-bridge");
  assert.equal(created.detail.student_instructions, custom.detail.instructions);
  assert.deepEqual(created.detail.target_region_ids, ["right_shoulder"]);
  assert.deepEqual(created.detail.source, { kind: "analysis", id: "assessment-1" });

  const configured = configureStep(created, {
    sets: "3",
    reps: "8",
    seconds: "45",
    rest: "20",
    notes: "Watch shoulder control",
    detail: { purpose: "Observe comfortable shoulder control", section: "Practice" },
  });
  assert.equal(configured._uid, "card-b");
  assert.equal(configured.sets, 3);
  assert.equal(configured.seconds, 45);
  assert.equal(configured.detail.purpose, "Observe comfortable shoulder control");
  assert.equal(configured.detail.student_instructions, custom.detail.instructions);

  const moved = reorderStep([first, configured], "card-b", -1);
  assert.deepEqual(moved.map((step) => step._uid), ["card-b", "card-a"]);
  assert.equal(moved[0].detail.section, "Warm-up");
  assert.equal(moved[0].detail.source.id, "assessment-1");
  assert.deepEqual(removeStep(moved, "card-b").map((step) => step.exercise_id), ["library-breathing"]);
  assert.equal(created.detail.section, "Practice", "reordering must not mutate the previous card state");
});

test("invalid custom movement cannot create an unaddressable card", () => {
  assert.throws(() => exerciseStep({ id: "custom" }, { uid: "" }), /card identity/);
  assert.throws(() => configureStep({ exercise_id: "custom" }, { sets: 2 }), /movement card/);
});
