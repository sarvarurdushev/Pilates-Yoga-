import test from "node:test";
import assert from "node:assert/strict";
import { visitAtAGlance, visitMetricLabel, loggedMovementSummary } from "../src/platform/visit-evidence.js";
import { withSavedProgressEvidence } from "./progress-fixtures.mjs";

const client = () => withSavedProgressEvidence({
  id: "sarah",
  analyses: [
    { id: "older", kind: "posture", protocol: "Standing posture", demo: false },
    { id: "current", kind: "posture", protocol: "Standing posture", demo: false },
    { id: "other", kind: "posture", protocol: "Different pose", demo: false },
  ],
  progress: [
    { analysis_id: "older", metric: "front:shoulder_tilt", unit: "deg", value: 4,
      recorded_at: "2026-09-01T10:00:00Z" },
    { analysis_id: "current", metric: "front:shoulder_tilt", unit: "deg", value: 2,
      recorded_at: "2026-09-14T10:00:00Z" },
    { analysis_id: "other", metric: "front:shoulder_tilt", unit: "deg", value: 99,
      recorded_at: "2026-09-10T10:00:00Z" },
  ],
});

test("visit summary names historical logged movements without inventing missing names", () => {
  assert.equal(loggedMovementSummary([{ name: "Earlier arm arcs" }, {}, {}, { name: "Bridge" }], [
    { name: "Renamed arm arcs" }, { name: "Bird dog" }, null, { name: "Bridge" },
  ]), "4 movements logged: Earlier arm arcs, Bird dog, Historical movement name unavailable, and 1 more");
  assert.equal(loggedMovementSummary([{ name: "Bridge" }]), "1 movement logged: Bridge");
});

test("visit strip chooses saved, same-protocol source and explains the value", () => {
  const c = client();
  const result = visitAtAGlance(c, { analyses: [c.analyses[1]] }, {
    regions: ["left_shoulder"],
    notes: [{ id: "coach-note", created_at: "2026-09-14T10:30:00Z", text: "Repeat at an easy range." }],
  });
  assert.equal(result.capture.id, "current");
  assert.equal(result.view, "front");
  assert.equal(result.measurement.value, 2);
  assert.equal(result.measurement.previous.value, 4);
  assert.match(result.measurement.meaning, /visible shoulder landmarks/);
  assert.equal(result.note.id, "coach-note");
});

test("practice-only and unsupported archived numbers stay unavailable", () => {
  const c = client();
  assert.equal(visitAtAGlance(c, { session: { id: "practice" }, analyses: [] }).measurement, null);
  c.progress.find((row) => row.analysis_id === "current").evidence.confidence = 0.1;
  const result = visitAtAGlance(c, { analyses: [c.analyses[1]] });
  assert.equal(result.capture.id, "current");
  assert.equal(result.view, "");
  assert.equal(result.measurement, null);
});

test("a same-date different-protocol capture cannot become the prior value", () => {
  const c = client();
  c.progress = c.progress.filter((row) => row.analysis_id !== "older");
  const result = visitAtAGlance(c, { analyses: [c.analyses[1]] });
  assert.equal(result.measurement.value, 2);
  assert.equal(result.measurement.previous, null);
});


test("the first linked coach region breaks otherwise equal measurement relevance", () => {
  const c = client();
  c.progress.push({
    ...c.progress.find((row) => row.analysis_id === "current"),
    metric: "front:right_shoulder_rom", value: 8,
    evidence: {
      ...c.progress.find((row) => row.analysis_id === "current").evidence,
      metric_id: "right_shoulder_rom", value: 8,
    },
  });
  const result = visitAtAGlance(c, { analyses: [c.analyses[1]] }, {
    regions: ["right_shoulder", "left_shoulder"],
  });
  assert.equal(result.measurement.metric, "right_shoulder_rom");
  assert.equal(result.measurement.value, 8);
});


test("visit metric labels explain ROM and preserve the camera interpretation", () => {
  assert.equal(visitMetricLabel("right_shoulder_rom"), "Right shoulder range of motion");
  assert.equal(visitMetricLabel("front:left_knee_angle"), "Left knee angle");
  assert.equal(visitMetricLabel(""), "Measurement");
  const c = client();
  const result = visitAtAGlance(c, { analyses: [c.analyses[1]] });
  assert.match(result.measurement.interpretation, /photograph|camera|same view|comparison/i);
});
