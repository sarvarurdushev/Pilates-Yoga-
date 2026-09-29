import test from "node:test";
import assert from "node:assert/strict";
import { acceptedFrameSummary, coordinateTraceChart, movementDerivativeCharts, selectPostureObservation } from "../src/platform/reports.js";

test("advanced movement derivatives label their absolute summaries and signed traces", () => {
  const html = movementDerivativeCharts({
    mean_speed_deg_s: 12.5,
    mean_acceleration_deg_s2: 7.3,
    velocity: [[0, null], [0.2, -9], [0.4, 16]],
    acceleration: [[0, null], [0.2, null], [0.4, 7.3]],
  }, false);
  assert.match(html, /12.5 deg\/s/);
  assert.match(html, /7.3 deg\/s²/);
  assert.match(html, /mean absolute change in the projected angle/);
  assert.match(html, /mean absolute change in angular velocity/);
  assert.match(html, /Signed angular velocity over clip time/);
  assert.match(html, /Signed angular acceleration over clip time/);
  assert.match(html, /Raw projected-angle samples from accepted uploaded-video frames/);
  assert.match(html, /not effort or strength/);
  assert.match(html, /gaps are not interpolated/);
  assert.match(html, /No earlier clip is plotted here/);
  assert.doesNotMatch(html, /Previous [0-9]/);
  assert.doesNotMatch(html, /No earlier comparable measurement/);
});

test("missing derivative samples stay unavailable rather than receiving a fabricated speed", () => {
  const html = movementDerivativeCharts({}, true);
  assert.match(html, /Demo simulated raw projected-angle samples/);
  assert.match(html, /No reliable values available for this trace/);
  assert.match(html, /<strong>Unavailable<\/strong>/);
  assert.doesNotMatch(html, /[0-9]+ deg\/s/);
});

test("2D coordinates explain frame axes and do not invent depth", () => {
  const x = coordinateTraceChart({
    axis: "x", space: "image_px", selected: { x: 141, z: 50 },
    trajectory: [{ time: 0, x: 141 }, { time: 0.5, x: 145 }],
    landmarkName: "Left shoulder", kind: "movement",
  });
  const y = coordinateTraceChart({
    axis: "y", space: "image_px", selected: { y: 62 },
    trajectory: [{ time: 0, y: 62 }], landmarkName: "Left shoulder",
  });
  const z = coordinateTraceChart({
    axis: "z", space: "image_px", selected: { z: 50 },
    trajectory: [{ time: 0, z: 50 }], landmarkName: "Left shoulder", kind: "movement",
  });
  assert.match(x, /141 px/);
  assert.match(x, /left edge of the original frame/);
  assert.match(x, /accepted 2D pose landmarks from the original video frames/i);
  assert.match(x, /Camera movement, crop and perspective/);
  assert.match(y, /top edge of the original frame/);
  assert.match(y, /A photograph provides one position/);
  assert.match(z, /image-plane Z is unavailable/);
  assert.match(z, /No measured image-plane depth trace is available/);
  assert.doesNotMatch(z, /50 px/);
});

test("3D trace identifies inferred scale, source, units and missing depth", () => {
  const html = coordinateTraceChart({
    axis: "z", space: "model_estimated_m", selected: { z: 0.225 },
    trajectory: [{ time: 0, z: null }, { time: 0.3, z: 0.225 }],
    landmarkName: "Pelvis centre", kind: "movement", demo: true,
  });
  assert.match(html, /0.225 m/);
  assert.match(html, /Model-estimated depth offset from the hip centre/);
  assert.match(html, /Demo simulated 3D model coordinates; the illustration is separate/);
  assert.match(html, /learned scale/);
  assert.match(html, /not calibrated body measurements or a scan/);
  assert.match(html, /Pelvis centre Z position over clip time/);
  assert.match(html, /this clip only/);
});

test("coordinate labels are escaped in the advanced card", () => {
  const html = coordinateTraceChart({
    axis: "x", space: "image_px", selected: { x: 12 },
    landmarkName: "<script>alert(1)</script>",
  });
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.throws(() => coordinateTraceChart({ axis: "q", space: "image_px" }), /Unknown coordinate axis/);
});

test("accepted frame span excludes rejected decoded endpoints", () => {
  assert.deepEqual(acceptedFrameSummary([
    { time: 0, suitable: false },
    { time: 1, suitable: true },
    { time: 2, suitable: true },
    { time: 10, suitable: false },
  ]), { accepted: 2, span: "1 s" });
  assert.deepEqual(acceptedFrameSummary([
    { time: 0, suitable: false },
    { time: 1, suitable: true },
  ]), { accepted: 1, span: "Not enough accepted frames" });
});

test("featured posture angle comes from supported evidence rather than metric list order", () => {
  const metrics = [
    { id: "shoulder_tilt", name: "Shoulder height asymmetry", value: 0, unit: "deg", status: "measured", confidence: 0.92 },
    { id: "pelvic_obliquity", name: "Hip height asymmetry", value: -4.3, unit: "deg", status: "measured", confidence: 0.89 },
    { id: "head_lateral_tilt", value: 1.2, unit: "deg", status: "measured", confidence: 0.91 },
  ];
  assert.equal(selectPostureObservation(metrics), metrics[1]);
  assert.equal(metrics.length, 3, "selection must leave all original measurements available");
  assert.equal(metrics[0].value, 0);
});

test("featured posture ranking respects confidence, provenance and unit families", () => {
  const lowConfidence = [
    { id: "shoulder_tilt", value: 2, unit: "deg", status: "measured", confidence: 0.9 },
    { id: "pelvic_obliquity", value: 12, unit: "deg", status: "measured", confidence: 0.4 },
    { id: "head_lateral_tilt", value: 20, unit: "deg", status: "unavailable", confidence: 0.9 },
    { id: "trunk_lean_lateral", value: 9, unit: "deg", status: "estimated", confidence: 0.9 },
  ];
  assert.equal(selectPostureObservation(lowConfidence), lowConfidence[0]);
  const fallback = [
    { id: "shoulder_tilt", value: 0, unit: "deg", status: "measured", confidence: 0.9 },
    { id: "forward_head", value: 0.16, unit: "ratio", status: "estimated", confidence: 0.9 },
  ];
  assert.equal(selectPostureObservation(fallback), fallback[1]);
  assert.equal(selectPostureObservation([{ id: "shoulder_tilt", value: 0, unit: "deg", status: "measured" }]).value, 0);
  assert.equal(selectPostureObservation([]), null);
});

test("equal visible angles have deterministic ordering without clinical cutoffs", () => {
  const angles = [
    { id: "pelvic_obliquity", value: -3, unit: "deg", status: "measured" },
    { id: "shoulder_tilt", value: 3, unit: "deg", status: "measured" },
  ];
  assert.equal(selectPostureObservation(angles), angles[1]);
});
