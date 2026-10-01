import test from "node:test";
import assert from "node:assert/strict";
import { programVersionChanges } from "../src/platform/program-version-diff.js";
import { revisionChangeHTML } from "../src/platform/programs.js";

const revision = (version, snapshot) => ({version, snapshot});
const movement = (id, exercise_id, exercise_name, reps, extra = {}) => ({
  id, exercise_id, exercise_name, sets: 2, reps, seconds: 40, rest: 20,
  detail: {side: "Both", program_phase: "Foundation", section: "Mobility", ...extra},
});

test("history compares saved prescriptions by unique exercise, not recreated step row ID", () => {
  const original = revision(1, {
    name: "Shoulder mobility", goal: "Easy range", region_id: "right_shoulder",
    detail: {phase: "Foundation", sessions_per_week: 2, duration_weeks: 4,
      target_region_ids: ["right_shoulder"]},
    steps: [movement("old-row", "arcs", "Arm Arcs", 6)],
  });
  const updated = revision(2, {
    name: "Shoulder mobility", goal: "Easy range", region_id: "right_shoulder",
    detail: {phase: "Strength", sessions_per_week: 3, duration_weeks: 4,
      target_region_ids: ["right_shoulder", "thoracic_spine"]},
    steps: [
      movement("new-row", "arcs", "Arm Arcs", 9, {side: "Right", program_phase: "Strength"}),
      movement("bridge-row", "bridge", "Bridge", 8),
    ],
  });
  const {lines} = programVersionChanges(updated, original);
  assert.ok(lines.some((line) => line === "Phase: Foundation → Strength."));
  assert.ok(lines.some((line) => line === "Sessions per week: 2 → 3."));
  assert.ok(lines.some((line) => line === "Body target added: Thoracic Spine."));
  assert.ok(lines.some((line) => /Bridge: 1 assignment added/.test(line)));
  assert.ok(lines.some((line) => /Arm Arcs: repetitions 6 → 9; side Both → Right; phase Foundation → Strength/.test(line)));
  assert.ok(!lines.some((line) => /Arm Arcs: .*assignment/.test(line)), "a recreated row ID is not an added movement");
});

test("history names the first saved plan and never invents a missing predecessor", () => {
  const first = revision(1, {detail: {phase: "Foundation"}, steps: [movement("a", "arcs", "Arm Arcs", 6)]});
  assert.deepEqual(programVersionChanges(first, null),
    {kind: "initial", lines: ["Starting plan: 1 movement in Foundation phase."]});
  assert.deepEqual(programVersionChanges(revision(3, first.snapshot), first),
    {kind: "missing", lines: ["The immediately preceding saved version is unavailable for comparison."]});
  assert.equal(programVersionChanges({version: 2, snapshot: null}, first).kind, "missing");
});

test("history describes removal and continuing movement order without treating insertion as reorder", () => {
  const a = movement("a1", "a", "Arm Arcs", 8);
  const b = movement("b1", "b", "Bridge", 8);
  const c = movement("c1", "c", "Chair Squat", 8);
  const before = revision(1, {detail: {}, steps: [a, b, c]});
  const after = revision(2, {detail: {}, steps: [
    movement("b2", "b", "Bridge", 8), movement("a2", "a", "Arm Arcs", 8),
  ]});
  const {lines} = programVersionChanges(after, before);
  assert.ok(lines.some((line) => line === "Chair Squat: 1 assignment removed."));
  assert.ok(lines.some((line) => line === "The order of continuing movements changed."));
  const inserted = revision(2, {detail: {}, steps: [a, movement("d", "d", "Dead Bug", 8), b, c]});
  assert.ok(!programVersionChanges(inserted, before).lines.some((line) => /order of continuing/.test(line)));
});

test("duplicate movements do not get a guessed one-to-one dose history", () => {
  const first = revision(1, {detail: {}, steps: [
    movement("old-one", "arcs", "Arm Arcs", 6), movement("old-two", "arcs", "Arm Arcs", 12),
  ]});
  const next = revision(2, {detail: {}, steps: [
    movement("new-one", "arcs", "Arm Arcs", 8), movement("new-two", "arcs", "Arm Arcs", 12),
  ]});
  const {lines} = programVersionChanges(next, first);
  assert.ok(lines.some((line) => /repeated assignments or prescriptions changed/.test(line)));
  assert.ok(!lines.some((line) => /repetitions 6 → 8/.test(line)));
});

test("the renderer escapes saved labels and compares only supplied visible snapshots", () => {
  const before = revision(1, {detail: {}, steps: [movement("one", "arcs", "Arm Arcs", 6)]});
  const after = revision(2, {detail: {}, steps: [movement("two", "arcs", "<img src=x onerror=alert(1)>", 9)]});
  const html = revisionChangeHTML(after, [after, before]);
  assert.match(html, /What changed/);
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<img/);
  const studentBefore = revision(1, {detail: {}, steps: [movement("old", "arcs", "Arm Arcs", 6)]});
  const studentAfter = revision(2, {detail: {}, steps: [movement("new", "arcs", "Arm Arcs", 6)]});
  assert.equal(programVersionChanges(studentAfter, studentBefore).kind, "unchanged");
  assert.match(revisionChangeHTML(studentAfter, [studentAfter, studentBefore]), /No plan, sequence or prescription change/);
});

test("history reports media, coaching and schedule edits rather than falsely saying unchanged", () => {
  const before = revision(1, {
    detail: {phase: "Foundation", phases: [{name: "Foundation", weeks_start: 1, weeks_end: 4}]},
    steps: [movement("old", "arcs", "Arm Arcs", 8, {
      media: [{media_id: "photo-one", caption: "Start"}],
      student_instructions: "Raise comfortably",
    })],
  });
  const after = revision(2, {
    detail: {phase: "Foundation", phases: [{name: "Foundation", weeks_start: 1, weeks_end: 6}]},
    steps: [movement("new", "arcs", "Arm Arcs", 8, {
      media: [{media_id: "photo-two", caption: "New start"}],
      student_instructions: "Raise slowly and comfortably",
    })],
  });
  const {kind, lines} = programVersionChanges(after, before);
  assert.equal(kind, "changed");
  assert.ok(lines.some((line) => /Scheduled phase weeks or goals changed/.test(line)));
  assert.ok(lines.some((line) => /Arm Arcs: photos or videos changed; movement guidance changed/.test(line)));
});

test("moving an unchanged practice reminder is visible in the saved sequence history", () => {
  const a = movement("old-a", "arcs", "Arm Arcs", 8);
  const b = movement("old-b", "bridge", "Bridge", 8);
  const reminder = {type: "note", text: "Pause and check comfort", visibility: "student", section: "Mobility"};
  const before = revision(1, {detail: {}, steps: [a, reminder, b]});
  const after = revision(2, {detail: {}, steps: [
    movement("new-a", "arcs", "Arm Arcs", 8), movement("new-b", "bridge", "Bridge", 8), reminder,
  ]});
  const {lines} = programVersionChanges(after, before);
  assert.ok(lines.includes("The placement of practice reminders changed."));
  assert.ok(!lines.includes("The order of continuing movements changed."));
});


test("history avoids doubled punctuation and case-only section changes", () => {
  const reminder = {type: "note", text: "Pause if uncomfortable", visibility: "student", section: "Practice"};
  const before = revision(1, {goal: "Use an easy range.", detail: {}, steps: [
    movement("old", "arcs", "Arm Arcs", 8, {section: "Practice"}), reminder,
  ]});
  const after = revision(2, {goal: "Keep a steady range.", detail: {}, steps: [
    movement("new", "arcs", "Arm Arcs", 8, {section: "PRACTICE"}),
    {...reminder, section: "PRACTICE"},
  ]});
  const {lines} = programVersionChanges(after, before);
  assert.deepEqual(lines, ["Goal: Use an easy range. → Keep a steady range."]);
});


test("history names changed assessment sources and ignores demo seed metadata", () => {
  const before = revision(1, {detail: {demo: true, provenance: "seed-a"}, steps: [
    movement("old", "arcs", "Arm Arcs", 8, {source: {kind: "analysis", id: "capture-a"}}),
  ]});
  const after = revision(2, {detail: {demo: false, provenance: "seed-b"}, steps: [
    movement("new", "arcs", "Arm Arcs", 8, {source: {kind: "analysis", id: "capture-b"}}),
  ]});
  const {lines} = programVersionChanges(after, before);
  assert.deepEqual(lines, ["Arm Arcs: source assessment changed."]);
  const metadataOnly = revision(2, {detail: {demo: false, provenance: "seed-b"}, steps: [
    movement("new", "arcs", "Arm Arcs", 8, {source: {kind: "analysis", id: "capture-a"}}),
  ]});
  assert.equal(programVersionChanges(metadataOnly, before).kind, "unchanged");
});
