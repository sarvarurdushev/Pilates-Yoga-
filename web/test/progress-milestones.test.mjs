import test from 'node:test';
import assert from 'node:assert/strict';
import { progressMilestones } from '../src/platform/progress-milestones.js';

const rows = [
  { analysis_id: 'a1', recorded_at: '2026-05-01T10:00:00Z', value: 7, unit: 'deg' },
  { analysis_id: 'a2', recorded_at: '2026-06-01T10:00:00Z', value: 6, unit: 'deg' },
];
const client = {
  id: 's1', analyses: rows.map((row) => ({ id: row.analysis_id, created_at: row.recorded_at })),
  sessions: [{ id: 'visit-1', analysis_ids: ['a1'], performed_at: rows[0].recorded_at },
    { id: 'visit-2', analysis_ids: ['a2'], performed_at: rows[1].recorded_at }],
  notes: [
    { id: 'n1', student_id: 's1', session_id: 'visit-1', region_id: 'right_shoulder', created_at: '2026-05-02T10:00:00Z' },
    { id: 'same-date', analysis_id: 'unrelated', region_id: 'right_shoulder', created_at: '2026-05-02T10:00:00Z' },
    { id: 'wrong-visit', session_id: 'other', analysis_id: 'a1', created_at: '2026-05-02T10:00:00Z' },
    { id: 'wrong-region', analysis_id: 'a1', region_id: 'right_knee', created_at: '2026-05-02T10:00:00Z' },
    { id: 'other-client', student_id: 's2', analysis_id: 'a1', created_at: '2026-05-02T10:00:00Z' },
    { id: 'latest', session_id: 'visit-2', region_id: 'right_shoulder', created_at: '2026-06-02T10:00:00Z' },
  ], scans: [],
};
const relevant = (region) => !region || region === 'right_shoulder';

test('progress story uses exact visit links, relevant regions and later comparable measurements', () => {
  const events = progressMilestones(client, rows, [], relevant);
  assert.deepEqual(events.map((event) => event.id), ['n1', 'latest']);
  assert.equal(events[0].visit.session.id, 'visit-1');
  assert.equal(events[0].nextMeasurement.analysis_id, 'a2');
  assert.equal(events[1].nextMeasurement, null);
});

test('manual and feedback revisions connect to visits without fabricating date-based relationships', () => {
  const revisions = [
    { id: 'manual', source_kind: 'manual', session_id: 'visit-1', created_at: '2026-05-03T10:00:00Z' },
    { id: 'feedback', source_kind: 'coach_observation', source_id: 'n1', created_at: '2026-05-04T10:00:00Z' },
    { id: 'capture', source_kind: 'analysis', source_id: 'a1', created_at: '2026-05-05T10:00:00Z' },
    { id: 'orphan', source_kind: 'manual', created_at: '2026-05-03T10:00:00Z' },
    { id: 'conflict', source_kind: 'analysis', source_id: 'a1', session_id: 'other', created_at: '2026-05-03T10:00:00Z' },
    { id: 'conflicting-capture', source_kind: 'analysis', source_id: 'a2', session_id: 'visit-1', created_at: '2026-05-03T10:00:00Z' },
    { id: 'conflicting-feedback', source_kind: 'coach_observation', source_id: 'n1', session_id: 'visit-2', created_at: '2026-05-03T10:00:00Z' },
    { id: 'wrong-region', source_kind: 'analysis', source_id: 'a1', snapshot: {region_id:'right_knee'}, created_at: '2026-05-03T10:00:00Z' },
    { id: 'wrong-client', source_kind: 'analysis', source_id: 'a1', snapshot: {detail:{student_id:'s2'}}, created_at: '2026-05-03T10:00:00Z' },
  ];
  const events = progressMilestones(client, rows, revisions, relevant).filter((event) => event.type === 'program');
  assert.deepEqual(events.map((event) => event.id), ['manual', 'feedback', 'capture']);
  assert.ok(events.every((event) => event.visit.session.id === 'visit-1'));
});

test('scan feedback joins the story only through its explicitly connected visit', () => {
  const data = { ...client, scans: [{ id:'scan-1', session_id:'visit-1' }], notes:[
    {id:'scan-note',scan_id:'scan-1',created_at:'2026-05-03T10:00:00Z'},
    {id:'bad-scan-note',scan_id:'scan-1',analysis_id:'other',created_at:'2026-05-03T10:00:00Z'},
  ]};
  assert.deepEqual(progressMilestones(data, rows).map((event)=>event.id), ['scan-note']);
});

test('duplicate revisions and invalid timestamps cannot inflate progress milestones', () => {
  const revision = {id:'v1',session_id:'visit-1',source_kind:'manual',created_at:'2026-05-03T10:00:00Z'};
  const events = progressMilestones({...client, notes:[]}, rows, [revision, revision,
    {...revision,id:'bad-date',created_at:'unknown'}]);
  assert.deepEqual(events.map((event)=>event.id), ['v1']);
});

test('a regional decision on an exact practice-only visit appears even after the final capture', () => {
  const practice = { id: 'visit-practice', analysis_ids: [], performed_at: '2026-06-15T10:00:00Z' };
  const data = { ...client, sessions: [...client.sessions, practice], notes: [
    ...client.notes, { id: 'practice-note', student_id: 's1', session_id: practice.id,
      region_id: 'right_shoulder', created_at: '2026-06-15T11:00:00Z' },
  ] };
  const revision = { id: 'practice-revision', source_kind: 'manual', session_id: practice.id,
    snapshot: { detail: { student_id: 's1', target_region_ids: ['right_shoulder'] } },
    created_at: '2026-06-15T12:00:00Z' };
  const events = progressMilestones(data, rows, [revision], relevant);
  assert.deepEqual(events.slice(-2).map((event) => event.id), ['practice-note', 'practice-revision']);
  assert.ok(events.slice(-2).every((event) => event.visit.session.id === practice.id &&
    event.nextMeasurement === null));
  assert.ok(!progressMilestones(data, rows, [{ ...revision, id: 'wrong-region',
    snapshot: { detail: { student_id: 's1', target_region_ids: ['right_knee'] } } }], relevant)
    .some((event) => event.id === 'wrong-region'));
});
