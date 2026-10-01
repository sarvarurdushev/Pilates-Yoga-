import test from "node:test";
import assert from "node:assert/strict";
import { withSavedProgressEvidence } from "./progress-fixtures.mjs";
import { programMeasurementCopy, programProgressCard } from "../src/platform/library.js";

globalThis.location = { hash: "" };

const series = (metric, overrides = {}) => ({
  metric, kind: "movement", protocol: "Arm raise", demo: false, unit: "deg",
  ...overrides,
});

test("movement progress explains the captured range, unit, source, and direction", () => {
  const copy = programMeasurementCopy(series("front:right_shoulder_rom"));
  assert.match(copy.definition, /largest and smallest smoothed, accepted projected joint angles/);
  assert.match(copy.source, /Arm raise · Front view · Accepted visible pose landmarks from the uploaded movement video/);
  assert.equal(copy.unit, "degrees (°)");
  assert.match(copy.meaning, /wider visible range/);
  assert.match(copy.meaning, /Neither is automatically better/);
});

test("demo posture progress identifies simulated coordinates rather than its illustrative picture", () => {
  const copy = programMeasurementCopy(series("rear:shoulder_tilt", {
    kind: "posture", protocol: "Standing posture", demo: true,
  }));
  assert.match(copy.definition, /line between the two visible shoulder landmarks/);
  assert.match(copy.source, /Back view · Simulated pose coordinates/);
  assert.match(copy.source, /Sample imagery is illustrative and was not measured/);
  assert.doesNotMatch(copy.source, /uploaded posture photograph/);
  assert.match(copy.meaning, /does not by itself show benefit, harm or a diagnosis/);
});

test("timing, range variation, and repetition count have distinct explanations", () => {
  const timing = programMeasurementCopy(series("side_left:left_knee_tempo_cv", {unit: "ratio"}));
  const spread = programMeasurementCopy(series("side_left:left_knee_rep_rom_sd"));
  const reps = programMeasurementCopy(series("side_left:left_knee_repetitions", {unit: "cycles"}));
  assert.match(timing.definition, /repetition durations/);
  assert.equal(timing.unit, "ratio (unitless)");
  assert.match(timing.meaning, /similar amounts of time/);
  assert.match(spread.definition, /spread of the measured angle range/);
  assert.match(spread.meaning, /ranges varied more/);
  assert.match(reps.definition, /complete movement cycles/);
  assert.equal(reps.unit, "completed movement cycles");
  assert.match(reps.meaning, /does not indicate better form/);
});

test("the rendered program chart labels first and latest comparable assessments", () => {
  const client = {
    id: "student",
    analyses: [
      {id: "one", kind: "movement", protocol: "Arm raise", demo: false},
      {id: "two", kind: "movement", protocol: "Arm raise", demo: false},
      {id: "other", kind: "movement", protocol: "Arm raise", demo: true},
    ],
    progress: [
      {analysis_id: "one", recorded_at: "2026-05-01T10:00:00", metric: "front:right_shoulder_rom", value: 61, unit: "deg"},
      {analysis_id: "two", recorded_at: "2026-05-10T10:00:00", metric: "front:right_shoulder_rom", value: 68, unit: "deg"},
      {analysis_id: "other", recorded_at: "2026-05-11T10:00:00", metric: "front:right_shoulder_rom", value: 99, unit: "deg"},
    ],
  };
  const html = programProgressCard(withSavedProgressEvidence(client), {starts_on: "2026-05-01"}, {
    region_id: "right_shoulder", detail: {target_region_ids: ["right_shoulder"]},
  });
  assert.match(html, /First since plan start · May 1, 2026<\/dt><dd>61°/);
  assert.match(html, /Latest · May 10, 2026<\/dt><dd>68°/);
  assert.match(html, /measured change 7° increased/);
  assert.match(html, /What this measures/);
  assert.match(html, /What to notice/);
  assert.match(html, /What does this mean\?/);
  assert.match(html, /Source: Arm raise · Front view/);
  assert.match(html, /Unit:<\/strong> degrees \(°\)/);
  assert.match(html, /assessment=one/);
  assert.match(html, /assessment=two/);
  assert.doesNotMatch(html, /99°/);
});

