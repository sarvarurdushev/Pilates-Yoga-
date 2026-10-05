import test from "node:test";
import assert from "node:assert/strict";
import { programFirstScreenFacts, programSourceId, progressFirstScreenFacts } from "../src/platform/first-screen-context.js";

const client = {
  id: "client-a", name: "Ari", programs: [{ program_id: "plan-a" }],
  analyses: [
    { id: "capture-1", student_id: "client-a", protocol: "Arm raise", created_at: "2026-06-01T10:00:00Z" },
    { id: "capture-2", student_id: "client-a", protocol: "Arm raise", created_at: "2026-07-01T10:00:00Z" },
  ],
  sessions: [
    { id: "visit-1", performed_at: "2026-06-01T10:00:00Z", analysis_ids: ["capture-1"] },
    { id: "visit-2", performed_at: "2026-07-01T10:00:00Z", analysis_ids: ["capture-2"] },
    { id: "practice-3", performed_at: "2026-07-10T10:00:00Z", analysis_ids: [] },
  ],
};

test("program context shows only a source assessment belonging to the selected client", () => {
  const plan = { id: "plan-a", assignments: [{ student_id: "client-a", active: 1 }],
    detail: { source_analysis_id: "capture-2", source_student_id: "client-a" } };
  const source = { id: "capture-2", student_id: "client-a", protocol: "Arm raise",
    created_at: "2026-07-01T10:00:00Z",
    result: { views: [{ view: "front" }, { view: "side_left" }, { view: "front" }] } };
  const facts = programFirstScreenFacts(plan, client, source);
  assert.equal(facts.clientName, "Ari");
  assert.equal(facts.assigned, true);
  assert.equal(facts.source.id, "capture-2");
  assert.equal(facts.sourceVisit.session.id, "visit-2");
  assert.deepEqual(facts.views, ["front", "side_left"]);

  const otherClientSource = { ...source, student_id: "client-b" };
  assert.equal(programFirstScreenFacts(plan, client, otherClientSource).source, null);
  assert.equal(programFirstScreenFacts({ ...plan, detail: { source_analysis_id: "capture-2", source_student_id: "client-b" } }, client, source).source, null);
  assert.equal(programFirstScreenFacts(plan, null, source).source, null);
});

test("program context follows the selected client's assignment assessment when plan detail has none", () => {
  const other = { id: "client-b", name: "Bea", analyses: [], sessions: [] };
  const plan = { id: "plan-a", detail: {}, assignments: [
    { student_id: "client-b", analysis_id: "other-capture", active: 1 },
    { student_id: "client-a", analysis_id: "old-capture", active: 0 },
    { student_id: "client-a", analysis_id: "capture-1", active: 1 },
  ] };
  const source = { id: "capture-1", student_id: "client-a", protocol: "Standing posture",
    created_at: "2026-06-01T10:00:00Z", result: { views: [{ view: "front" }] } };
  assert.equal(programSourceId(plan, client), "capture-1");
  assert.equal(programFirstScreenFacts(plan, client, source).source?.id, "capture-1");
  assert.equal(programFirstScreenFacts(plan, client, source).sourceVisit?.session?.id, "visit-1");
  assert.deepEqual(programFirstScreenFacts(plan, client, source).views, ["front"]);
  assert.equal(programSourceId(plan, other), "other-capture");
  assert.equal(programFirstScreenFacts(plan, other, source).source, null);
  assert.equal(programFirstScreenFacts(plan, client, { ...source, student_id: "client-b" }).source, null);
});

test("a reusable plan does not borrow another client's unowned detail source", () => {
  const other = { id: "client-b", name: "Bea", analyses: [
    { id: "beas-capture", student_id: "client-b" },
  ], sessions: [{ id: "beas-visit", analysis_ids: ["beas-capture"] }] };
  const plan = { id: "plan-a", detail: { source_analysis_id: "capture-2" }, assignments: [
    { student_id: "client-a", analysis_id: "capture-1", active: 1 },
    { student_id: "client-b", analysis_id: "beas-capture", active: 1 },
  ] };
  const source = { id: "beas-capture", student_id: "client-b", result: { views: [{ view: "front" }] } };
  assert.equal(programSourceId(plan, client), "capture-2");
  assert.equal(programSourceId(plan, other), "beas-capture");
  assert.equal(programFirstScreenFacts(plan, other, source).source?.id, "beas-capture");
  assert.equal(programFirstScreenFacts(plan, other, source).sourceVisit?.session?.id, "beas-visit");
});

test("a plan's explicit source remains its source when assignment context differs", () => {
  const plan = { id: "plan-a", detail: { source_analysis_id: "capture-2", source_student_id: "client-a" },
    assignments: [{ student_id: "client-a", analysis_id: "capture-1", active: 1 }] };
  assert.equal(programSourceId(plan, client), "capture-2");
  assert.equal(programFirstScreenFacts(plan, client, client.analyses[1]).source?.id, "capture-2");
});

test("an unlinked current assignment does not borrow an older assessment", () => {
  const plan = { id: "plan-a", detail: {}, assignments: [
    { student_id: "client-a", analysis_id: "capture-1", active: 0 },
    { student_id: "client-a", analysis_id: null, active: 1 },
  ] };
  assert.equal(programSourceId(plan, client), null);
  assert.equal(programFirstScreenFacts(plan, client, client.analyses[0]).source, null);
});

test("progress context connects the latest measured capture and later practice-only coach decision", () => {
  const rows = [
    { analysis_id: "capture-1", metric: "front:right_shoulder_rom", recorded_at: "2026-06-01T10:00:00Z", value: 62, unit: "deg" },
    { analysis_id: "capture-2", metric: "front:right_shoulder_rom", recorded_at: "2026-07-01T10:00:00Z", value: 71, unit: "deg" },
  ];
  const practiceVisit = { session: client.sessions[2], analyses: [] };
  const decision = { id: "note-1", type: "feedback", at: "2026-07-10T11:00:00Z",
    record: { id: "note-1", student_id: "client-a", text: "Practice comfortably" }, visit: practiceVisit };
  const wrongClient = { ...decision, id: "note-other", record: { ...decision.record, student_id: "client-b" } };
  const facts = progressFirstScreenFacts(client, rows, "front:right_shoulder_rom", [decision, wrongClient]);
  assert.equal(facts.clientName, "Ari");
  assert.equal(facts.latest.analysis_id, "capture-2");
  assert.equal(facts.source.id, "capture-2");
  assert.equal(facts.sourceVisit.session.id, "visit-2");
  assert.equal(facts.view, "front");
  assert.equal(facts.decision.id, "note-1");
});

test("progress context leaves absent or unrelated source and coach opinion unavailable", () => {
  const rows = [{ analysis_id: "unknown", recorded_at: "2026-07-01T10:00:00Z", value: 70 }];
  const unrelated = { id: "note-2", type: "feedback", record: { student_id: "client-a" },
    visit: { session: { id: "other-visit" }, analyses: [] } };
  const facts = progressFirstScreenFacts(client, rows, "right_shoulder_rom", [unrelated]);
  assert.equal(facts.source, null);
  assert.equal(facts.sourceVisit, null);
  assert.equal(facts.view, null);
  assert.equal(facts.decision, null);
  const foreign = progressFirstScreenFacts({ ...client, analyses: [
    { id: "unknown", student_id: "client-b", protocol: "Other client capture" },
  ] }, rows, "right_shoulder_rom");
  assert.equal(foreign.source, null);
});
