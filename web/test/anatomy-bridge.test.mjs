import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.location = { search: '' };
const { fullscreenRegionURL, contextForRegion, scanLinkedNotes } = await import('../src/platform/anatomy-bridge.js');

test('full-screen anatomy selection preserves client and assessment while changing region', () => {
  const url = fullscreenRegionURL(
    '/anatomy.html',
    '?platform=1&client=sarah&region=right_shoulder&analysis=visit-8',
    '',
    'left_hip',
  );
  const parsed = new URL(url, 'https://example.test');
  assert.equal(parsed.pathname, '/anatomy.html');
  assert.equal(parsed.searchParams.get('platform'), '1');
  assert.equal(parsed.searchParams.get('client'), 'sarah');
  assert.equal(parsed.searchParams.get('analysis'), 'visit-8');
  assert.equal(parsed.searchParams.get('region'), 'left_hip');
});

test('full-screen region context shows only feedback for the selected region', () => {
  const previous = { analysis_id: 'visit-8', layer: 'muscles_full', exercise: 'bird_dog' };
  const client = {
    id: 'sarah', name: 'Sarah',
    notes: [
      { region_id: 'left_hip', text: 'Use a supported hinge.' },
      { region_id: 'right_shoulder', text: 'Relax the shoulder.' },
      { region_id: 'both_hip', text: 'Keep the pelvis level.' },
    ],
  };
  const region = { id: 'left_hip', name: 'Left hip', structures: [{ id: 42 }] };
  const context = contextForRegion(previous, client, region, 42);
  assert.equal(context.analysis_id, 'visit-8');
  assert.equal(context.client.id, 'sarah');
  assert.equal(context.region.id, 'left_hip');
  assert.equal(context.structure_id, 42);
  assert.equal(context.layer, 'region');
  assert.equal(context.exercise, null);
  assert.deepEqual(context.notes, ['Use a supported hinge.', 'Keep the pelvis level.']);
});


test('scan detail includes only its own notes or exact source-assessment feedback', () => {
  const scan = { id: 'scan-20', analysis_id: 'visit-20', region_id: 'right_shoulder' };
  const notes = [
    { id: 'scan', scan_id: 'scan-20' },
    { id: 'visit', analysis_id: 'visit-20' },
    { id: 'old', analysis_id: 'visit-19', region_id: 'right_shoulder' },
    { id: 'different-scan', scan_id: 'scan-19', analysis_id: 'visit-20' },
    { id: 'conflict', scan_id: 'scan-20', analysis_id: 'visit-19' },
  ];
  assert.deepEqual(scanLinkedNotes(notes, scan).map((note) => note.id), ['scan', 'visit']);
});
