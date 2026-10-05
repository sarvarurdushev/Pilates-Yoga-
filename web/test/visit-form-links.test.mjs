import test from 'node:test';
import assert from 'node:assert/strict';
import {
  visitFormOptions, initialVisitId, compatibleAssessments,
  compatibleScans, compatibleFindings, assignedProgramOptions,
  scanVisitLinkOptions,
} from '../src/platform/visit-form-links.js';

const client = {
  sessions: [
    { id: 's1', performed_at: '2026-09-01T10:00:00Z', analysis_id: 'a1', analysis_ids: ['a1', 'a2'] },
    { id: 's2', performed_at: '2026-09-02T10:00:00Z', analysis_id: 'a3', analysis_ids: ['a3'] },
    { id: 's3', performed_at: '2026-09-03T10:00:00Z', analysis_id: null, analysis_ids: [] },
  ],
  analyses: [
    { id: 'a1', protocol: 'Front posture' },
    { id: 'a2', protocol: 'Side posture' },
    { id: 'a3', protocol: 'Squat' },
    { id: 'orphan', protocol: 'Standalone' },
  ],
  scans: [
    { id: 'same', session_id: 's1', analysis_id: 'a1' },
    { id: 'other-capture-same-visit', session_id: 's1', analysis_id: 'a2' },
    { id: 'different-visit', session_id: 's2', analysis_id: 'a3' },
    { id: 'unlinked-same-capture', analysis_id: 'a1' },
    { id: 'unlinked-no-capture', analysis_id: null },
  ],
  observations: [
    { id: 'f1', analysis_id: 'a1' },
    { id: 'f2', analysis_id: 'a2' },
    { id: 'f3', analysis_id: 'a3' },
  ],
};

const ids = (items) => items.map((item) => item.id);

test('visit options identify saved visits including multi-capture and practice-only records', () => {
  const choices = visitFormOptions(client);
  assert.deepEqual(ids(choices), ['s1', 's2', 's3']);
  assert.match(choices[0].name, /Front posture \+ Side posture/);
  assert.match(choices[2].name, /Practice only/);
});

test('scan visit choices use exact source assessment links and preserve ambiguous imported matches', () => {
  assert.deepEqual(ids(scanVisitLinkOptions(client, { analysis_id: 'a1' })), ['s1']);
  assert.deepEqual(ids(scanVisitLinkOptions(client, { analysis_id: null })), ['s1', 's2', 's3']);
  assert.deepEqual(ids(scanVisitLinkOptions(client, { analysis_id: 'orphan' })), []);
  const imported = { ...client, sessions: [
    ...client.sessions,
    { id: 's4', analysis_id: 'a1', performed_at: '2026-09-04T10:00:00Z' },
  ] };
  assert.deepEqual(ids(scanVisitLinkOptions(imported, { analysis_id: 'a1' })), ['s1', 's4']);
});

test('new note inherits valid route visit or infers its assessment/scan visit', () => {
  assert.equal(initialVisitId(client, {}, new URLSearchParams('session=s3'), '', ''), 's3');
  assert.equal(initialVisitId(client, {}, new URLSearchParams('session=unknown'), 'a1', ''), 's1');
  assert.equal(initialVisitId(client, {}, new URLSearchParams(), '', 'same'), 's1');
  assert.equal(initialVisitId(client, {}, new URLSearchParams(), 'orphan', ''), '');
});

test('editing an unlinked note does not quietly move it to route visit', () => {
  assert.equal(initialVisitId(client, { id: 'n1', session_id: null },
    new URLSearchParams('session=s1'), 'a1', 'same'), '');
  assert.equal(initialVisitId(client, { id: 'n2', session_id: 's2' },
    new URLSearchParams('session=s1'), 'a3', ''), 's2');
});

test('visit selection filters assessments and findings by exact capture IDs', () => {
  assert.deepEqual(ids(compatibleAssessments(client, 's1')), ['a1', 'a2']);
  assert.deepEqual(ids(compatibleFindings(client, 's1', 'a2')), ['f2']);
  assert.deepEqual(ids(compatibleAssessments(client, 's3')), []);
  assert.deepEqual(ids(compatibleAssessments(client, 'missing')), []);
});

test('scan choices exclude other visits but allow another capture in same visit', () => {
  assert.deepEqual(ids(compatibleScans(client, 's1', 'a1')),
    ['same', 'other-capture-same-visit', 'unlinked-same-capture']);
  assert.deepEqual(ids(compatibleScans(client, '', 'a3')),
    ['different-visit']);
  assert.deepEqual(ids(compatibleScans(client, 's3')), []);
  assert.deepEqual(ids(compatibleAssessments(client, '', 'same')), ['a1', 'a2']);
  assert.deepEqual(ids(compatibleAssessments(client, '', 'unlinked-same-capture')), ['a1', 'a2']);
});


test('feedback program options use assigned program IDs and exclude library-only plans', () => {
  const selectedClient = { programs: [
    { id: 'assignment-1', program_id: 'sarah-plan', name: "Sarah's current plan" },
    { id: 'assignment-2', program_id: 'sarah-earlier', name: "Sarah's earlier plan", active: 0 },
    { id: 'assignment-3', program_id: 'sarah-plan', name: "Sarah's current plan" },
    { id: 'invalid-assignment', name: 'Missing program' },
  ] };
  assert.deepEqual(assignedProgramOptions(selectedClient), [
    { id: 'sarah-plan', name: "Sarah's current plan" },
    { id: 'sarah-earlier', name: "Sarah's earlier plan" },
  ]);
  assert.deepEqual(assignedProgramOptions({
    programs: [{ id: 'current-assignment', program_id: 'current', name: 'Current plan' }],
    program_history: [
      { id: 'old-assignment', program_id: 'earlier', name: 'Earlier plan', active: 0 },
      { id: 'current-assignment', program_id: 'current', name: 'Current plan', active: 1 },
    ],
  }), [
    { id: 'earlier', name: 'Earlier plan' },
    { id: 'current', name: 'Current plan' },
  ]);
  assert.deepEqual(assignedProgramOptions({ programs: [] }), []);
  assert.deepEqual(assignedProgramOptions(null), []);
});
