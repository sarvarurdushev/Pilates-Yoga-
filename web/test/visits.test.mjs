import test from 'node:test';
import assert from 'node:assert/strict';
import { visitsForClient, visitPracticeLabel, recordedByLabel } from '../src/platform/visits.js';

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
