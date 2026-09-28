import test from 'node:test';
import assert from 'node:assert/strict';
import { visitsForClient, visitPracticeLabel, recordedByLabel, visitConnections, visitTimeline } from '../src/platform/visits.js';

test('one linked assessment and practice appears as one visit with its exercises', () => {
  const client = {
    analyses: [
      { id: 'a1', created_at: '2026-09-28T09:00:00Z', detail: { recorded_by: { name: 'Ari', role: 'admin' } } },
    ],
    sessions: [
      { id: 's1', analysis_id: 'a1', performed_at: '2026-09-28T09:00:00Z', completed: ['bird-dog'] },
    ],
  };
  const visits = visitsForClient(client);
  assert.equal(visits.length, 1);
  assert.equal(visits[0].session.id, 's1');
  assert.equal(visits[0].analysis.id, 'a1');
  assert.equal(visitPracticeLabel(visits[0]), '1 movement logged');
  assert.equal(recordedByLabel(visits[0].analysis), 'Ari · Admin');
});

test('assessment-only records are not described as completed practice', () => {
  const client = {
    analyses: [
      { id: 'a2', created_at: '2026-09-27T09:00:00Z', detail: { reservation_id: 'r1' } },
      { id: 'a3', created_at: '2026-09-29T09:00:00Z' },
    ],
    sessions: [
      { id: 's2', analysis_id: 'a2', reservation_id: 'r1', performed_at: '2026-09-27T09:00:00Z', completed: [] },
    ],
  };
  const visits = visitsForClient(client);
  assert.deepEqual(visits.map((visit) => visit.analysis.id), ['a3', 'a2']);
  assert.equal(visits[0].session, null);
  assert.equal(visitPracticeLabel(visits[1]), 'No exercises logged for this assessment');
  assert.equal(recordedByLabel(visits[0].analysis), 'Not recorded');
});

test('a shared reservation does not silently link an unrelated practice to an assessment', () => {
  const visits = visitsForClient({
    analyses: [{ id: 'a4', created_at: '2026-09-28T09:00:00Z', detail: { reservation_id: 'r2' } }],
    sessions: [{ id: 's4', reservation_id: 'r2', performed_at: '2026-09-28T10:00:00Z', completed: ['bridge'] }],
  });
  assert.equal(visits.length, 2);
  assert.equal(visits[0].analysis, null);
  assert.equal(visits[1].session, null);
});


test('a session explicitly joins multiple captures and leaves unlinked captures separate', () => {
  const client = {
    analyses: [
      { id: 'a1', kind: 'movement', created_at: '2026-09-28T09:10:00Z' },
      { id: 'a2', kind: 'posture', created_at: '2026-09-28T09:15:00Z' },
      { id: 'a3', kind: 'movement', created_at: '2026-09-28T09:20:00Z' },
    ],
    sessions: [{ id: 's1', analysis_id: 'a1', analysis_ids: ['a2', 'a1'], reservation_id: 'r1', performed_at: '2026-09-28T09:00:00Z', completed: [] }],
  };
  const visits = visitsForClient(client);
  assert.equal(visits.length, 2);
  const combined = visits.find((visit) => visit.session?.id === 's1');
  assert.deepEqual(combined.analyses.map((analysis) => analysis.id), ['a1', 'a2']);
  assert.equal(visits.find((visit) => visit.analysis?.id === 'a3').session, null);
});

test('visit evidence follows exact capture and scan IDs, never a matching date or reservation', () => {
  const visit = { session: { id: 's1', completed: [], performed_at: '2026-09-28T09:00:00Z' }, analyses: [
    { id: 'a1', created_at: '2026-09-28T09:10:00Z' },
    { id: 'a2', created_at: '2026-09-28T09:12:00Z', detail: { reviewed_at: '2026-09-28T09:30:00Z' } },
  ] };
  const client = {
    scans: [
      { id: 'scan-1', analysis_id: 'a2', region_id: 'left_shoulder', captured_at: '2026-09-28T09:18:00Z' },
      { id: 'scan-2', analysis_id: 'a3', captured_at: '2026-09-28T09:18:00Z' },
    ],
    notes: [
      { id: 'n1', analysis_id: 'a1', created_at: '2026-09-28T09:25:00Z' },
      { id: 'n2', scan_id: 'scan-1', created_at: '2026-09-28T09:26:00Z' },
      { id: 'n3', analysis_id: 'a3', scan_id: 'scan-1', created_at: '2026-09-28T09:27:00Z' },
      { id: 'n4', analysis_id: 'a3', created_at: '2026-09-28T09:27:00Z' },
    ],
    observations: [{ id: 'o1', analysis_id: 'a2', region_id: 'right_hip', created_at: '2026-09-28T09:21:00Z' }],
    program_history: [
      { id: 'pa1', analysis_id: 'a2', program_id: 'p1', starts_on: '2026-09-29' },
      { id: 'pa2', analysis_id: 'a3', program_id: 'p1', starts_on: '2026-09-29' },
    ],
  };
  const revisions = [
    { id: 'v2', program_id: 'p1', source_kind: 'analysis', source_id: 'a2', created_at: '2026-09-28T09:35:00Z' },
    { id: 'v3', program_id: 'p1', source_kind: 'analysis', source_id: 'a3', created_at: '2026-09-28T09:36:00Z' },
    { id: 'v4', program_id: 'p1', source_kind: 'manual', source_id: 'a1', created_at: '2026-09-28T09:37:00Z' },
  ];
  const connected = visitConnections(client, visit, revisions);
  assert.deepEqual(connected.scans.map((x) => x.id), ['scan-1']);
  assert.deepEqual(connected.notes.map((x) => x.id), ['n1', 'n2']);
  assert.deepEqual(connected.observations.map((x) => x.id), ['o1']);
  assert.deepEqual(connected.assignments.map((x) => x.id), ['pa1']);
  assert.deepEqual(connected.programChanges.map((x) => x.id), ['v2']);
  assert.deepEqual(connected.regions.sort(), ['left_shoulder', 'right_hip']);
  assert.deepEqual(visitTimeline(visit, connected).map((event) => event.type), [
    'capture', 'capture', 'scan', 'findings', 'note', 'note', 'review', 'program', 'assignment',
  ]);
});


test('same-capture findings recorded on one date form one inspectable timeline event', () => {
  const visit = { analyses: [{ id: 'a1', created_at: '2026-09-28T09:00:00Z' }], session: null };
  const connected = visitConnections({
    scans: [], notes: [], program_history: [],
    observations: [
      { id: 'o1', analysis_id: 'a1', created_at: '2026-09-28T09:01:00Z' },
      { id: 'o2', analysis_id: 'a1', created_at: '2026-09-28T09:02:00Z' },
      { id: 'o3', analysis_id: 'a1', created_at: '2026-09-29T09:02:00Z' },
    ],
  }, visit);
  const findings = visitTimeline(visit, connected).filter((event) => event.type === 'findings');
  assert.deepEqual(findings.map((event) => event.record.map((item) => item.id)), [['o1', 'o2'], ['o3']]);
});
