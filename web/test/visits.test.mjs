import test from 'node:test';
import assert from 'node:assert/strict';
import { visitsForClient, visitPracticeLabel, recordedByLabel, visitRecorderLabel, visitConnections, visitTimeline } from '../src/platform/visits.js';
import { markCompletion, completedEventPayload } from '../src/platform/completed-events.js';

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

test('completed movements have separate ordered events tied to one recorded session time', () => {
  const completed = ['step-a', 'step-b', 'step-a',
    ...Array.from({ length: 9 }, (_, index) => `later-${index}`)];
  const visit = { session: { id: 'session-1', performed_at: '2026-09-28T09:00:00Z', completed }, analyses: [] };
  const events = visitTimeline(visit, {
    scans: [], observations: [], notes: [], assignments: [], programChanges: [],
  });
  assert.deepEqual(events.map((event) => event.type), [
    'practice', ...completed.map(() => 'exercise'),
  ]);
  const movements = events.filter((event) => event.type === 'exercise');
  assert.deepEqual(movements.map((event) => event.record.completed_key), completed);
  assert.deepEqual(movements.map((event) => event.record.sequence),
    Array.from({ length: completed.length }, (_, index) => index + 1));
  assert.deepEqual(movements.map((event) => event.id),
    Array.from({ length: completed.length }, (_, index) => `session-1:exercise:${index + 1}`));
  assert.ok(movements.every((event) => event.record.session_id === 'session-1' &&
    event.at === visit.session.performed_at));
});

test('an assessment or empty practice does not gain fictional movement events', () => {
  const visit = { session: { id: 'empty', performed_at: '2026-09-28T09:00:00Z', completed: [] },
    analyses: [{ id: 'capture', created_at: '2026-09-28T09:01:00Z' }] };
  const events = visitTimeline(visit, {
    scans: [], observations: [], notes: [], assignments: [], programChanges: [],
  });
  assert.deepEqual(events.map((event) => event.type), ['capture']);
});

test('a student practice record names the recorder without inventing a capture', () => {
  const visit = visitsForClient({
    analyses: [],
    sessions: [{ id: 'student-practice', performed_at: '2026-09-28T09:00:00Z',
      completed: ['bird-dog'], recorded_by: { name: 'Sarah Kim', role: 'student' } }],
  })[0];
  assert.equal(visitRecorderLabel(visit), 'Sarah Kim · Student');
  assert.equal(visitPracticeLabel(visit), '1 movement logged');
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


test('stationary joints from a movement capture remain in the report without becoming visit findings', () => {
  const visit = { analyses: [{ id: 'a1', created_at: '2026-09-28T09:00:00Z' }] };
  const connected = visitConnections({ observations: [
    { id: 'still', analysis_id: 'a1', kind: 'movement', text: 'left hip ROM: 0.0 deg in the front view.', region_id: 'left_hip', created_at: '2026-09-28T09:00:00Z' },
    { id: 'target', analysis_id: 'a1', kind: 'movement', text: 'left shoulder ROM: 104.9 deg in the front view.', region_id: 'left_shoulder', created_at: '2026-09-28T09:00:00Z' },
  ] }, visit);
  assert.deepEqual(connected.observations.map((item) => item.id), ['target']);
  assert.deepEqual(connected.regions, ['left_shoulder']);
});

test('a practice-only visit includes explicitly attached scan, feedback and note-sourced plan revision', () => {
  const visit = { session: { id: 'practice-1', performed_at: '2026-09-29T10:00:00Z', completed: ['bridge'] }, analyses: [] };
  const client = {
    scans: [
      { id: 'scan-1', session_id: 'practice-1', region_id: 'right_hip', captured_at: '2026-09-29T11:00:00Z' },
      { id: 'scan-2', session_id: 'practice-2', region_id: 'left_hip', captured_at: '2026-09-29T11:00:00Z' },
    ],
    notes: [
      { id: 'note-1', session_id: 'practice-1', region_id: 'right_hip', created_at: '2026-09-29T11:10:00Z' },
      { id: 'scan-note', scan_id: 'scan-1', created_at: '2026-09-29T11:12:00Z' },
      { id: 'wrong-visit', session_id: 'practice-2', created_at: '2026-09-29T11:13:00Z' },
    ],
  };
  const revisions = [
    { id: 'revision-1', source_kind: 'coach_observation', source_id: 'note-1', created_at: '2026-09-29T11:20:00Z' },
    { id: 'revision-2', source_kind: 'coach_observation', source_id: 'wrong-visit', created_at: '2026-09-29T11:20:00Z' },
  ];
  const linked = visitConnections(client, visit, revisions);
  assert.deepEqual(linked.scans.map((item) => item.id), ['scan-1']);
  assert.deepEqual(linked.notes.map((item) => item.id), ['note-1', 'scan-note']);
  assert.deepEqual(linked.programChanges.map((item) => item.id), ['revision-1']);
  assert.deepEqual(visitTimeline(visit, linked).map((event) => event.type),
    ['practice', 'exercise', 'scan', 'note', 'note', 'program']);
});

test('explicit session link wins over a legacy matching assessment link', () => {
  const visit = { session: { id: 'visit-a' }, analyses: [{ id: 'analysis-a' }] };
  const linked = visitConnections({
    scans: [{ id: 'wrong-scan', session_id: 'visit-b', analysis_id: 'analysis-a' }],
    notes: [{ id: 'wrong-note', session_id: 'visit-b', analysis_id: 'analysis-a' }],
  }, visit);
  assert.deepEqual(linked.scans, []);
  assert.deepEqual(linked.notes, []);
});


test('manual program changes appear only in the explicitly linked practice visit', () => {
  const visit = {session:{id:'practice-only',performed_at:'2026-09-29T10:00:00Z',completed:['bridge']},analyses:[]};
  const revisions = [
    {id:'manual-here',session_id:'practice-only',source_kind:'manual',source_id:'',created_at:'2026-09-29T11:00:00Z'},
    {id:'manual-other',session_id:'another-visit',source_kind:'manual',source_id:'',created_at:'2026-09-29T11:00:00Z'},
    {id:'manual-unlinked',source_kind:'manual',source_id:'',created_at:'2026-09-29T11:00:00Z'},
  ];
  const connections = visitConnections({},visit,revisions);
  assert.deepEqual(connections.programChanges.map((revision)=>revision.id),['manual-here']);
  assert.deepEqual(visitTimeline(visit,connections).map((event)=>event.type),['practice','exercise','program']);
});

test('an explicit revision visit wins over a matching legacy reason source', () => {
  const visit = {session:{id:'visit-a'},analyses:[{id:'analysis-a'}]};
  const connections = visitConnections({notes:[{id:'note-a',analysis_id:'analysis-a'}]},visit,[
    {id:'source-conflict',session_id:'visit-b',source_kind:'analysis',source_id:'analysis-a'},
    {id:'feedback-conflict',session_id:'visit-b',source_kind:'coach_observation',source_id:'note-a'},
    {id:'direct',session_id:'visit-a',source_kind:'manual',source_id:''},
    {id:'legacy',source_kind:'analysis',source_id:'analysis-a'},
  ]);
  assert.deepEqual(connections.programChanges.map((revision)=>revision.id),['direct','legacy']);
});

test('saved scan markers form separate exact-visit events with source frame and author', () => {
  const visit = { session: { id: 'visit-a', performed_at: '2026-09-28T09:00:00Z', completed: [] }, analyses: [] };
  const client = { scans: [
    { id: 'scan-a', session_id: 'visit-a', name: 'Uploaded scan',
      captured_at: '2026-09-28T09:05:00Z', detail: {}, findings: [
        { id: 'marker-1', scan_id: 'scan-a', frame_index: 0, region_id: 'right_shoulder', text: 'First view', author_id: 'coach-1', author_name: 'Hana Lee', created_at: '2026-09-28T09:10:00Z' },
        { id: 'marker-2', scan_id: 'scan-a', frame_index: 2, region_id: 'right_shoulder', text: 'Later frame', author_id: 'coach-1', author_name: 'Hana Lee', created_at: '2026-09-28T09:11:00Z' },
        { id: 'wrong-source', scan_id: 'scan-b', frame_index: 1, text: 'Never attach to this scan', created_at: '2026-09-28T09:12:00Z' },
        { id: 'no-time', scan_id: 'scan-a', frame_index: 0, text: 'No event time', created_at: null },
      ] },
    { id: 'scan-b', session_id: 'visit-b', captured_at: '2026-09-28T09:05:00Z', findings: [
      { id: 'other-visit', scan_id: 'scan-b', created_at: '2026-09-28T09:10:00Z' },
    ] },
    { id: 'demo-reference', session_id: 'visit-a', captured_at: '2026-09-28T09:06:00Z',
      detail: { demo: true, provenance: 'Public educational reference; not a client acquisition.' }, findings: [
        { id: 'demo-marker', scan_id: 'demo-reference', created_at: '2026-09-28T09:11:00Z' },
      ] },
  ] };
  const linked = visitConnections(client, visit);
  const events = visitTimeline(visit, linked);
  assert.deepEqual(events.filter((event) => event.type === 'scan').map((event) => event.id), ['scan-a']);
  const markers = events.filter((event) => event.type === 'scan_marker');
  assert.deepEqual(markers.map((event) => event.id), ['marker-1', 'marker-2']);
  assert.deepEqual(markers.map((event) => [event.record.marker, event.record.scan_id, event.record.frame_index]),
    [[1, 'scan-a', 0], [2, 'scan-a', 2]]);
  assert.equal(markers[1].at, '2026-09-28T09:11:00Z');
  assert.equal(markers[1].record.author_name, 'Hana Lee');
  assert.equal(markers[1].record.region_id, 'right_shoulder');
  assert.equal(markers[1].record.text, 'Later frame');
});


test("an educational reference scan stays inspectable without becoming a client body finding", () => {
  const visit = { session: { id: "visit-1", performed_at: "2026-09-28T09:00:00Z" }, analyses: [] };
  const linked = visitConnections({ scans: [{
    id: "reference", session_id: "visit-1", region_id: "right_shoulder",
    captured_at: "2026-09-28T09:00:00Z", detail: { demo: true },
    findings: [{ id: "reference-marker", scan_id: "reference", region_id: "right_shoulder",
      text: "Educational annotation", created_at: "2026-09-28T09:30:00Z" }],
  }] }, visit);
  assert.equal(linked.scans.length, 1);
  assert.deepEqual(linked.regions, []);
  assert.deepEqual(visitTimeline(visit, linked), []);
});

test('normalized movement events retain exact source links and distinguish mark, log and legacy times', () => {
  const session = {
    id: 'session-normalized', performed_at: '2026-09-28T09:00:00Z',
    completed: ['step-a', 'step-b', 'step-a'],
    exercise_events: [
      { id: 'event-a', session_id: 'session-normalized', sequence: 1, completed_key: 'step-a',
        logged_at: '2026-09-28T09:10:00Z', completed_at: '2026-09-28T09:02:00Z' },
      { id: 'event-b', session_id: 'session-normalized', sequence: 2, completed_key: 'step-b',
        logged_at: '2026-09-28T09:10:00Z', completed_at: null },
      { id: 'event-c', session_id: 'session-normalized', sequence: 3, completed_key: 'step-a',
        logged_at: null, completed_at: null },
    ],
  };
  const connected = { scans: [], observations: [], notes: [], assignments: [], programChanges: [] };
  const movements = visitTimeline({ session, analyses: [] }, connected)
    .filter((event) => event.type === 'exercise');
  assert.deepEqual(movements.map((event) => event.id), ['event-c', 'event-a', 'event-b']);
  assert.deepEqual(movements.map((event) => [event.record.sequence, event.record.completed_key,
    event.record.time_source, event.at]), [
    [3, 'step-a', 'session', '2026-09-28T09:00:00Z'],
    [1, 'step-a', 'marked', '2026-09-28T09:02:00Z'],
    [2, 'step-b', 'logged', '2026-09-28T09:10:00Z'],
  ]);
  assert.ok(movements.every((event) => event.record.session_id === session.id));
});

test('checkbox marks are exact, ordered, and cleared when a movement is unchecked', () => {
  const first = { checked: false, value: 'step-a', dataset: {} };
  const second = { checked: true, value: 'step-b', dataset: {} };
  first.checked = true;
  markCompletion(first, '2026-09-28T09:02:00Z');
  assert.deepEqual(completedEventPayload([first, second]), {
    completed: ['step-a', 'step-b'],
    completed_events: [
      { key: 'step-a', completed_at: '2026-09-28T09:02:00Z' },
      { key: 'step-b', completed_at: null },
    ],
  });
  first.checked = false;
  markCompletion(first, '2026-09-28T09:03:00Z');
  assert.equal(first.dataset.completedAt, undefined);
  first.checked = true;
  markCompletion(first, '2026-09-28T09:04:00Z');
  assert.deepEqual(completedEventPayload([first]).completed_events,
    [{ key: 'step-a', completed_at: '2026-09-28T09:04:00Z' }]);
});
