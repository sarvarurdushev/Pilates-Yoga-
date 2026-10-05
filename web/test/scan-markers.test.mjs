import test from 'node:test';
import assert from 'node:assert/strict';
import { isEducationalScanReference, scanAnnotationMarkers, scanFrameIndex } from '../src/platform/scan-markers.js';

test('only seeded public reference media gets the visit-free annotation affordance', () => {
  const org = { demo: true };
  const scan = { detail: { demo: true } };
  const media = { detail: { sample: true, source_url: 'https://example.test/reference' } };
  assert.equal(isEducationalScanReference(org, scan, media), true);
  assert.equal(isEducationalScanReference(org, scan, { detail: { sample: false, source_url: media.detail.source_url } }), false);
  assert.equal(isEducationalScanReference(org, scan, { detail: { sample: true } }), false);
  assert.equal(isEducationalScanReference({ demo: false }, scan, media), false);
});

test('saved annotation keys match each frame without restarting numbering', () => {
  const findings = [
    { id: 'first', frame_index: 0, text: 'First frame note' },
    { id: 'second', frame_index: 1, text: 'Another image in the same scan' },
    { id: 'third', frame_index: 0, text: 'Another first frame note' },
  ];
  const key = scanAnnotationMarkers(findings);
  assert.deepEqual(scanAnnotationMarkers(findings, 0).map((item) => [item.id, item.marker]),
    [['first', 1], ['third', 3]]);
  assert.deepEqual(scanAnnotationMarkers(findings, 1).map((item) => [item.id, item.marker]),
    [['second', 2]]);
  for (const frame of [0, 1]) {
    for (const item of scanAnnotationMarkers(findings, frame)) {
      assert.equal(key.find((row) => row.marker === item.marker).text, item.text);
    }
  }
  assert.deepEqual(scanAnnotationMarkers(findings, 2), []);
  assert.equal(findings[0].marker, undefined);
});

test('frame input and deep links resolve to an actual in-range integer image', () => {
  assert.equal(scanFrameIndex('1.9', 3), 1);
  assert.equal(scanFrameIndex('9', 3), 2);
  assert.equal(scanFrameIndex('-1', 3), 0);
  assert.equal(scanFrameIndex('invalid', 3), 0);
  assert.equal(scanFrameIndex(Infinity, 3), 0);
  assert.equal(scanFrameIndex(null, 3), 0);
  assert.equal(scanFrameIndex('2', 1), 0);
});
