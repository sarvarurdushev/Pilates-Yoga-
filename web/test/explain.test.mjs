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
  assert.match(captureSummary('movement', 'Squat', 'needs_capture'), /not tracked reliably enough/);
  assert.match(captureSummary('posture', 'Standing posture', 'needs_capture'), /not clear enough/);
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


test('timing variation, cycle range spread and repetitions have distinct meanings', () => {
  const tempo = metricCopy({id:'left_knee_tempo_cv'});
  const spread = metricCopy({id:'left_knee_rep_rom_sd'});
  const cycles = metricCopy({id:'left_knee_repetitions'});
  assert.match(tempo.definition, /unitless ratio/);
  assert.match(tempo.why, /similar amounts of time/);
  assert.doesNotMatch(tempo.definition, /angle ranges/);
  assert.match(spread.definition, /Standard deviation.*angle ranges.*degrees/);
  assert.match(spread.why, /not a strength score/);
  assert.match(cycles.definition, /complete outward-and-return movement cycles/);
  assert.match(cycles.why, /does not indicate better form/);
});


test('posture fractions identify the body scale and directional meaning', () => {
  const head = metricCopy({id:'side_left:forward_head'});
  const knee = metricCopy({id:'rear:left_knee_deviation'});
  assert.match(head.definition, /ear from the shoulder divided by visible torso height/);
  assert.match(head.why, /Positive means the ear is forward/);
  assert.match(head.why, /not a distance in centimetres/);
  assert.match(knee.definition, /hip-to-ankle line divided by that leg.*projected length/);
  assert.match(knee.why, /Positive means the knee is inward/);
  assert.match(knee.why, /does not diagnose knee alignment/);
});
