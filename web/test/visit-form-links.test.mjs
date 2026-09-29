import test from 'node:test';
import assert from 'node:assert/strict';
import {
  visitFormOptions, initialVisitId, compatibleAssessments,
  compatibleScans, compatibleFindings,
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
