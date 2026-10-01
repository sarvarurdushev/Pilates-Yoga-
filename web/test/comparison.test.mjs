import test from "node:test";
import assert from "node:assert/strict";
import {
  comparableMeasurements, findComparableVisits, matchingPriorSummaries,
  nearestComparableMeasurement, selectedComparablePerson,
} from "../src/platform/comparison.js";

const metric = (value, status = "measured", unit = "deg", confidence = 0.92) =>
  ({ id: "shoulder_tilt", name: "Shoulder tilt", value, status, unit, confidence });
const person = (id, measurements = [metric(2)], suitable = true) =>
  ({ person_id: id, suitable, metrics: measurements });
const current = { id: "now", student_id: "client", kind: "posture", protocol: "Neutral standing", demo: false, created_at: "2026-09-20T12:00:00Z" };
const summary = (id, created_at, extra = {}) => ({ ...current, id, created_at, ...extra });
const full = (item, cameraView, people, selected = null) => ({
  ...item, detail: selected == null ? {} : { selected_people: { [cameraView]: selected } },
  result: { views: [{ view: cameraView, report: { people } }] },
});

test("prior metadata is sorted by actual time and excludes other clients, kinds, protocols and simulations", () => {
  const records = [
    summary("old", "2026-09-01T12:00:00Z"),
    summary("wrong-person", "2026-09-19T12:00:00Z", { student_id: "someone-else" }),
    summary("later", "2026-09-21T12:00:00Z"),
    summary("wrong-protocol", "2026-09-18T12:00:00Z", { protocol: "Controlled squat" }),
    summary("nearest", "2026-09-19T12:00:00Z"),
    summary("wrong-kind", "2026-09-17T12:00:00Z", { kind: "movement" }),
    summary("wrong-source", "2026-09-16T12:00:00Z", { demo: true }),
  ];
  assert.deepEqual(matchingPriorSummaries(current, records).map((entry) => entry.id), ["nearest", "old"]);
});

test("a recorded person wins only when suitable; multiple unselected people are ambiguous", () => {
  const earlier = summary("earlier", "2026-09-10T12:00:00Z");
  assert.equal(selectedComparablePerson(full(earlier, "front", [person("1"), person("2")]), "front"), null);
  assert.equal(selectedComparablePerson(full(earlier, "front", [person("1"), person("2", [], false)]), "front"), null);
  assert.equal(selectedComparablePerson(full(earlier, "back", [person("1")]), "front"), null);
  assert.equal(selectedComparablePerson(full(earlier, "front", [person("1"), person("2", [], false)], "2"), "front"), null);
  assert.equal(selectedComparablePerson(full(earlier, "front", [person("1"), person("2")], "2"), "front").person.person_id, "2");
  assert.equal(selectedComparablePerson(full(earlier, "front", [person("1")]), "front").person.person_id, "1");
});

test("numeric deltas require supported same-unit same-provenance evidence", () => {
  const now = person("1", [metric(4), { id: "head_offset", value: 0.1, status: "estimated", unit: "ratio", confidence: 0.9 }]);
  const then = person("1", [metric(2), { id: "head_offset", value: 4, status: "estimated", unit: "cm", confidence: 0.9 }]);
  assert.deepEqual(comparableMeasurements(now, then, "posture"), [
    { id: "shoulder_tilt", name: "Shoulder tilt", current: 4, previous: 2, unit: "deg" },
  ]);
  assert.deepEqual(comparableMeasurements(person("1", [metric(4, "estimated")]), then, "posture"), []);
  assert.deepEqual(comparableMeasurements(person("1", [metric(4, "unavailable")]), then, "posture"), []);
  assert.deepEqual(comparableMeasurements(person("1", [metric(4, "measured", "deg", 0.4)]), then, "posture"), []);
  assert.deepEqual(comparableMeasurements(now, person("1", [metric(2)], false), "posture"), []);
  assert.deepEqual(comparableMeasurements(
    { person_id: "1", suitable: true, signals: { left_knee: { rom: 42, status: "estimated", unit: "deg", confidence: 0.9 } } },
    { person_id: "1", suitable: true, signals: { left_knee: { rom: 35, status: "estimated", unit: "deg", confidence: 0.9 } } },
    "movement",
  ).map(({ id, current, previous }) => ({ id, current, previous })), [
    { id: "left_knee", current: 42, previous: 35 },
  ]);
});

test("nearest valid same-view visit is used after nearer incompatible captures", async () => {
  const records = [
    summary("older-valid", "2026-09-01T12:00:00Z"),
    summary("nearer-wrong-view", "2026-09-19T12:00:00Z"),
    summary("nearer-wrong-person", "2026-09-18T12:00:00Z"),
    summary("middle-valid", "2026-09-10T12:00:00Z"),
    summary("nearer-missing-metric", "2026-09-17T12:00:00Z"),
  ];
  const details = new Map([
    ["older-valid", full(records[0], "front", [person("1", [metric(1)])])],
    ["nearer-wrong-view", full(records[1], "back", [person("1", [metric(8)])])],
    ["nearer-wrong-person", full(records[2], "front", [person("1", [metric(9)]), person("2", [metric(9)])])],
    ["middle-valid", full(records[3], "front", [person("1", [metric(2)])])],
    ["nearer-missing-metric", full(records[4], "front", [person("1", [{ id: "head_offset", value: 0.2, unit: "ratio", status: "estimated" }])])],
  ]);
  const visits = await findComparableVisits(current, person("1", [metric(4)]), "front", records,
    async (item) => details.get(item.id));
  assert.deepEqual(visits.map((visit) => visit.analysis.id), ["middle-valid", "older-valid"]);
  assert.equal(nearestComparableMeasurement(visits, "shoulder_tilt").metric.previous, 2);
  assert.equal(nearestComparableMeasurement(visits, "head_offset"), null);
});

test("nearest matching metric may be older than another otherwise valid comparison", async () => {
  const now = person("1", [metric(4), { id: "pelvic_obliquity", value: 3, unit: "deg", status: "measured" }]);
  const recent = summary("recent", "2026-09-18T12:00:00Z");
  const older = summary("older", "2026-09-08T12:00:00Z");
  const details = new Map([
    ["recent", full(recent, "front", [person("1", [metric(2)])])],
    ["older", full(older, "front", [person("1", [metric(1), { id: "pelvic_obliquity", value: 1, unit: "deg", status: "measured" }])])],
  ]);
  const visits = await findComparableVisits(current, now, "front", [older, recent], async (item) => details.get(item.id));
  assert.equal(nearestComparableMeasurement(visits, "shoulder_tilt").visit.analysis.id, "recent");
  assert.equal(nearestComparableMeasurement(visits, "pelvic_obliquity").visit.analysis.id, "older");
});
