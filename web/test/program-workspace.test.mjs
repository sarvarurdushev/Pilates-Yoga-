import test from "node:test";
import assert from "node:assert/strict";
import { comparableProgramMeasurements } from "../src/platform/library.js";

const analysis = (id, protocol, demo = false, kind = "movement") =>
  ({id, protocol, demo, kind});
const measure = (analysis_id, at, metric, value, unit = "deg") =>
  ({analysis_id, recorded_at: at, metric, value, unit});

test("program progress compares only the same sourced metric after assignment start", () => {
  const client = {
    analyses: [
      analysis("before", "arm raise", true),
      analysis("one", "arm raise", true),
      analysis("two", "arm raise", true),
      analysis("real", "arm raise", false),
      analysis("other-protocol", "squat", true),
      analysis("other-kind", "arm raise", true, "posture"),
    ],
    progress: [
      measure("before", "2026-04-30T10:00:00", "front:right_shoulder_rom", 50),
      measure("one", "2026-05-01T10:00:00", "front:right_shoulder_rom", 61),
      measure("two", "2026-05-10T10:00:00", "front:right_shoulder_rom", 68),
      measure("two", "2026-05-10T10:00:00", "side_left:right_shoulder_rom", 91),
      measure("real", "2026-05-11T10:00:00", "front:right_shoulder_rom", 99),
      measure("other-protocol", "2026-05-12T10:00:00", "front:right_shoulder_rom", 15),
      measure("other-kind", "2026-05-13T10:00:00", "front:right_shoulder_rom", 18),
      measure("unknown", "2026-05-14T10:00:00", "front:right_shoulder_rom", 200),
      measure("two", "not-a-date", "front:right_shoulder_rom", 300),
    ],
  };
  const groups = comparableProgramMeasurements(
    client,
    {starts_on: "2026-05-01"},
    {region_id: "right_shoulder", detail: {target_region_ids: ["right_shoulder"]}},
  );
  const paired = groups.filter((series) => series.rows.length > 1);
  assert.equal(paired.length, 1);
  assert.equal(paired[0].metric, "front:right_shoulder_rom");
  assert.equal(paired[0].demo, true);
  assert.deepEqual(paired[0].rows.map((row) => row.value), [61, 68]);
  assert.equal(paired[0].first.analysis_id, "one");
  assert.equal(paired[0].latest.analysis_id, "two");
  assert.equal(groups.find((series) => !series.demo && series.metric === "front:right_shoulder_rom").rows.length, 1);
});

test("one measurement remains visible without inventing a trend", () => {
  const groups = comparableProgramMeasurements(
    {analyses: [analysis("only", "squat")],
      progress: [measure("only", "2026-07-02T08:30:00", "side_left:knee_rom", 90)]},
    {starts_on: "2026-07-01"},
    {region_id: "left_knee", detail: {}},
  );
  assert.equal(groups.length, 1);
  assert.equal(groups[0].rows.length, 1);
  assert.equal(groups[0].first, groups[0].latest);
});
