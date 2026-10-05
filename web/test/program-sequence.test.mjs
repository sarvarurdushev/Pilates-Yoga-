import test from "node:test";
import assert from "node:assert/strict";
import {
  exerciseStep,
  configureStep,
  orderedStepsBySection,
  reorderStep,
  moveStepBefore,
  moveStepToSectionEnd,
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

test("arrows and drops follow visible section order even when a legacy sequence is interleaved", () => {
  const sections = ["Warm-up", "Practice", "Cooldown"];
  const card = (uid, section) => exerciseStep({ id: `exercise-${uid}` }, { uid, section });
  const legacy = [card("a", "Warm-up"), card("c", "Practice"), card("b", "Warm-up"), card("d", "Practice")];
  const ids = (steps) => steps.map((step) => step._uid);
  assert.deepEqual(ids(orderedStepsBySection(legacy, sections)), ["a", "b", "c", "d"]);

  const arrow = reorderStep(legacy, "b", 1, sections);
  assert.deepEqual(ids(arrow), ["a", "c", "b", "d"]);
  assert.equal(arrow[2].detail.section, "Practice");
  assert.equal(legacy[2].detail.section, "Warm-up", "moving must not mutate saved card evidence");

  const dropped = moveStepBefore(arrow, "d", "c", sections);
  assert.deepEqual(ids(dropped), ["a", "d", "c", "b"]);
  assert.deepEqual(ids(moveStepBefore(dropped, "d", "d", sections)), ids(dropped),
    "dropping a card on itself cannot send it to the wrong position");

  const note = { _uid: "note", type: "note", section: "Warm-up", text: "Breathe naturally" };
  const movedNote = moveStepToSectionEnd([note, ...dropped], "note", "Practice", sections);
  assert.deepEqual(ids(movedNote), ["a", "d", "c", "b", "note"]);
  assert.equal(movedNote.at(-1).section, "Practice");
});
