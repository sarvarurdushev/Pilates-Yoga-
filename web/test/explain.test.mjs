import test from 'node:test';
import assert from 'node:assert/strict';
import { cameraGuide, cameraPurpose, captureSummary, recordedByLabel, comparisonText, explainedChart, metricCopy } from '../src/platform/explain.js';

test('camera guide identifies the actual capture view and only supported use', () => {
  const guide = cameraGuide('side_left', 'Squat');
  assert.match(guide, /Left side view/);
  assert.match(guide, /hip, knee and trunk bend/);
  assert.doesNotMatch(guide, /diagnos|normal range/i);
  assert.match(cameraPurpose('front', 'Shoulder flexion'), /left and right arm paths/);
});

test('measurement explanations avoid medical thresholds and do not claim improvement', () => {
  const shoulder = metricCopy({id:'shoulder_tilt'});
  assert.match(shoulder.definition, /shoulder landmarks/);
  assert.match(comparisonText(4.2, 6.1, 'deg'), /6.1° → current 4.2°/);
  assert.match(comparisonText(4.2, 6.1, 'deg'), /does not show benefit or harm/);
  assert.match(comparisonText(4.2, null, 'deg'), /No earlier comparable/);
});

test('chart explanation escapes user-origin strings and keeps raw details optional', () => {
  const html = explainedChart({
    title:'Shoulder <script>', definition:'Line between landmarks', why:'2D capture',
    notice:'Compare the same view', current:4.2, previous:6.1, unit:'deg',
    source:'Uploaded media', chart:'<figure>chart</figure>', technical:'<table>raw</table>',
  });
  assert.match(html, /Shoulder &lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /<details><summary>View technical data<\/summary>/);
  assert.match(html, /<figure>chart<\/figure>/);
});

test('still poses and recorder roles are described accurately', () => {
  assert.match(captureSummary('posture', 'Squat'), /single still pose/);
  assert.match(captureSummary('posture', 'Squat'), /does not measure movement range/);
  assert.match(captureSummary('posture', 'Standing posture'), /standing posture photograph/);
  assert.match(captureSummary('movement', 'Squat'), /frame by frame/);
  assert.equal(recordedByLabel({detail:{recorded_by:{name:'Jules',role:'admin'}}}), 'Jules · administrator');
  assert.equal(recordedByLabel({coach_id:'coach-1'}, [{id:'coach-1',name:'Hana'}]), 'Hana · coach');
  assert.equal(recordedByLabel({coach_id:'admin-1'}, [{id:'coach-1',name:'Hana'}]), 'Studio member not identified');
});

test('single-capture chart can omit a misleading prior comparison', () => {
  const html = explainedChart({
    title:'Technical trace', definition:'Projected value', why:'Camera-plane only',
    current:12, previous:5, unit:'deg/s',
    comparisonNote:'Single <video> trace; no earlier clip is compared.',
  });
  assert.match(html, /Single &lt;video&gt; trace; no earlier clip is compared/);
  assert.doesNotMatch(html, /Previous 5/);
  assert.doesNotMatch(html, /<video>/);
});
