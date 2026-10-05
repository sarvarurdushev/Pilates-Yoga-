import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.location = { search: '' };
const { fullscreenRegionURL, contextForRegion, scanLinkedNotes } = await import('../src/platform/anatomy-bridge.js');
const { feedbackMarkerRegions, feedbackJointCoordinates, feedbackMarkerPosition, feedbackMarkerLayout, feedbackSourceURL } = await import('../src/platform/feedback-markers.js');
const { initialAnatomyLayer, anatomySourceContext } = await import('../src/platform/anatomy.js');

test('a selected anatomy source names its actual protocol and camera without requiring a trend', () => {
  const analysis = { kind: 'movement', protocol: 'Shoulder flexion', created_at: '2026-09-18T10:00:00Z' };
  assert.match(anatomySourceContext(analysis, { result: { views: [{ view: 'left_side' }, { view: 'front' }, { view: 'front' }] } }), /Movement analysis · Shoulder flexion · left side, Front view/);
  assert.match(anatomySourceContext(analysis, null), /Shoulder flexion · No camera view recorded/);
  assert.equal(anatomySourceContext(null, { result: { views: [{ view: 'front' }] } }), 'All visits');
});

test('a report finding opens its exact region while an untargeted body map opens feedback', () => {
  const notes = [{ region_id: 'right_shoulder' }];
  assert.equal(initialAnatomyLayer(new URLSearchParams('region=right_shoulder&id=a1'), notes, 'a1', null), 'region');
  assert.equal(initialAnatomyLayer(new URLSearchParams('region=right_shoulder'), notes, null, null), 'region');
  assert.equal(initialAnatomyLayer(new URLSearchParams(), notes, null, null), 'feedback');
  assert.equal(initialAnatomyLayer(new URLSearchParams('region=right_shoulder&view=feedback'), notes, 'a1', null), 'feedback');
  assert.equal(initialAnatomyLayer(new URLSearchParams('view=feedback'), [], null, null), 'region');
});

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
  assert.equal(parsed.searchParams.get('layer'), 'region');
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
  assert.equal(context.feedback.length, 3);
});

test('saved feedback produces separate markers for mapped regions of this client', () => {
  const catalog = [
    { id: 'right_shoulder', name: 'Right shoulder', structures: [{ id: 61 }] },
    { id: 'left_hip', name: 'Left hip', structures: [{ id: 72 }] },
    { id: 'both_hip', name: 'Both hips', structures: [{ id: 72 }, { id: 73 }] },
    { id: 'right_knee', name: 'Right knee', structures: [{ id: 83 }] },
    { id: 'head', name: 'Head', structures: [{ id: 1 }] },
  ];
  const client = { id: 'sarah', notes: [
    { id: 'shoulder-old', student_id: 'sarah', region_id: 'right_shoulder', created_at: '2026-09-01' },
    { id: 'shoulder-new', student_id: 'sarah', region_id: 'right_shoulder', created_at: '2026-09-18' },
    { id: 'hip', student_id: 'sarah', region_id: 'left_hip' },
    { id: 'knee', student_id: 'sarah', region_id: 'right_knee' },
    { id: 'someone-else', student_id: 'other', region_id: 'head' },
  ] };
  const markers = feedbackMarkerRegions(client, catalog);
  assert.deepEqual(markers.map(({ id, count, noteId }) => [id, count, noteId]), [
    ['right_shoulder', 2, 'shoulder-new'],
    ['left_hip', 1, 'hip'],
    ['right_knee', 1, 'knee'],
  ]);
  assert.deepEqual(markers.map(({ structureIds }) => structureIds), [[61], [72], [83]]);
});

test('a feedback source link names the note’s saved visit, without borrowing another source', () => {
  const linked = feedbackSourceURL('sarah', {
    session_id: 'visit-18', analysis_id: 'analysis-18',
  });
  const source = new URL(linked, 'https://example.test');
  assert.equal(source.hash, '#page=client&client=sarah&tab=sessions&session=visit-18');
  assert.equal(feedbackSourceURL('sarah', { analysis_id: 'analysis-19' }),
    '/#page=client&client=sarah&tab=sessions&assessment=analysis-19');
  assert.equal(feedbackSourceURL('sarah', { region_id: 'right_shoulder' }), null);
});

test('a bilateral feedback anchor uses matching left and right structures', () => {
  const [marked] = feedbackMarkerRegions({ id: 'sarah', notes: [{ region_id: 'both_hip' }] }, [{
    id: 'both_hip', side: 'bilateral', structures: [
      { id: 72, name: 'left hip bone' }, { id: 74, name: 'left femur' },
      { id: 73, name: 'right hip bone' }, { id: 75, name: 'right femur' },
    ],
  }]);
  assert.deepEqual(marked.anchorIds, [72, 73]);
  assert.equal(marked.pairedAnchor, true);
});

test('joint-region feedback names the actual rig joint rather than a long-bone midpoint', () => {
  assert.deepEqual(feedbackJointCoordinates('right_knee'), ['knee_angle_r']);
  assert.deepEqual(feedbackJointCoordinates('left_hip'), ['hip_flexion_l']);
  assert.deepEqual(feedbackJointCoordinates('right_shoulder'), ['arm_flex_r']);
  assert.deepEqual(feedbackJointCoordinates('both_hip'), ['hip_flexion_l', 'hip_flexion_r']);
  assert.deepEqual(feedbackJointCoordinates('head'), ['cervical_flex']);
  assert.deepEqual(feedbackJointCoordinates('unknown'), []);
});

test('feedback buttons and focus rings stay inside the stage without moving their anatomical anchor', () => {
  assert.deepEqual(feedbackMarkerPosition({ x: 0, y: 0, z: 0 }, 800, 600), { x: 400, y: 300 });
  assert.equal(feedbackMarkerPosition({ x: 0, y: -0.98, z: 0 }, 800, 600), null);
  assert.equal(feedbackMarkerPosition({ x: 0.98, y: 0, z: 0 }, 800, 600), null);
  assert.equal(feedbackMarkerPosition({ x: 0, y: 0, z: 2 }, 800, 600), null);
  assert.equal(feedbackMarkerPosition({ x: NaN, y: 0, z: 0 }, 800, 600), null);
  assert.equal(feedbackMarkerPosition({ x: 0, y: 0, z: 0 }, 20, 20), null);
  assert.deepEqual(feedbackMarkerPosition({ x: -0.9, y: -0.9, z: 0 }, 800, 600), {
    x: 39.99999999999999, y: 570,
  });
});

test('adjacent side-specific and bilateral feedback remain separate clickable callouts', () => {
  const markers = [{ id: 'left_hip', x: 380, y: 310 }, { id: 'both_hip', x: 364, y: 307 }];
  const layout = feedbackMarkerLayout(markers, 800, 600);
  assert.equal(layout.length, 2);
  assert.ok(Math.hypot(layout[0].x - layout[1].x, layout[0].y - layout[1].y) >= 47);
  assert.deepEqual(layout.map(({ id, anchorX, anchorY }) => [id, anchorX, anchorY]), [
    ['left_hip', 380, 310], ['both_hip', 364, 307],
  ]);
  const edge = feedbackMarkerLayout([{ id: 'one', x: 30, y: 30 }, { id: 'two', x: 31, y: 30 }], 120, 120);
  assert.equal(edge.length, 2);
  assert.ok(edge.every(marker => marker.x >= 23.5 && marker.x <= 96.5 && marker.y >= 23.5 && marker.y <= 96.5));
  assert.equal(feedbackMarkerLayout(markers, 20, 20).length, 0);
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
