import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.location = { search: '' };
const { fullscreenRegionURL, contextForRegion } = await import('../src/platform/anatomy-bridge.js');

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
  const previous = { analysis_id: 'visit-8', layer: 'region' };
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
  assert.deepEqual(context.notes, ['Use a supported hinge.', 'Keep the pelvis level.']);
});
