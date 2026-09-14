import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { _internals } from '../src/session/posture.js';
import { EXERCISE } from '../src/content/exercises.js';

const { overlay, marksFor, anchorOf, formatValue, INK, ANCHOR } = _internals;

/* The screen draws over a photograph the browser already holds, from landmarks
 * the server sent back, and every one of these tests is about one of the three
 * ways that can silently go wrong: the overlay landing somewhere other than the
 * body, a measurement being drawn on a photograph that did not make it, and the
 * two halves of this codebase formatting the same number differently.
 *
 * The tables the Python side owns are read out of the Python side, not copied.
 * A threshold changed there and not here would otherwise colour a finding one
 * way on a printed report and another way on the screen. */

const PY = (name) => readFileSync(
  new URL(`../../pilates/${name}`, import.meta.url), 'utf8');

/** Seventeen landmarks, all found, in a 1000x2000 photograph. */
function landmarks(over = {}) {
  const keypoints = Array.from({ length: 17 }, () => [500, 1000]);
  const scores = Array.from({ length: 17 }, () => 0.95);
  keypoints[3] = [470, 300]; keypoints[4] = [530, 320];      // ears
  keypoints[5] = [420, 500]; keypoints[6] = [580, 520];      // shoulders
  keypoints[11] = [450, 1000]; keypoints[12] = [550, 1010];  // hips
  keypoints[13] = [445, 1400]; keypoints[14] = [555, 1410];  // knees
  keypoints[15] = [440, 1800]; keypoints[16] = [560, 1810];  // ankles
  return { keypoints, scores, width: 1000, height: 2000, ...over };
}

function reading(name, value, sources, extra = {}) {
  return { name, value, unit: 'deg', sources, contested: false, ...extra };
}

function report(over = {}) {
  return {
    assessment: { readings: {
      shoulder_tilt: reading('shoulder_tilt', 9.1, ['front', 'rear']),
      pelvic_obliquity: reading('pelvic_obliquity', -1.2, ['front', 'rear']),
      forward_head: { name: 'forward_head', value: 0.31, unit: 'ratio',
                      sources: ['side_left', 'side_right'], contested: false },
    } },
    findings: [{ metric: 'shoulder_tilt', severity: 'marked', display: '+9.1°',
                 short: 'left higher', short_ko: '왼쪽 높음' }],
    names: { shoulder_tilt: { en: 'shoulder level', ko: '어깨 수평' },
             pelvic_obliquity: { en: 'pelvis level', ko: '골반 수평' },
             forward_head: { en: 'head carried forward', ko: '머리 전방 이동' } },
    landmarks: { front: landmarks() },
    ...over,
  };
}

test('the overlay is drawn in the photograph’s own coordinates', () => {
  /* The one thing that makes the overlay right at every display size, on a
   * phone and on a projector: the viewBox carries the photograph's dimensions,
   * so a landmark at (420, 500) is written as (420, 500) and CSS does the
   * scaling. Anything that turns these into display pixels breaks silently the
   * first time somebody resizes the window. */
  const svg = overlay(landmarks(), []);
  assert.match(svg, /viewBox="0 0 1000 2000"/);
  assert.match(svg, /x1="420" y1="500"/);
});

test('strokes are told not to scale with the photograph', () => {
  const svg = overlay(landmarks(), []);
  const lines = svg.match(/<line /g) ?? [];
  const guarded = svg.match(/vector-effect="non-scaling-stroke"/g) ?? [];
  assert.ok(lines.length > 8, 'a body was drawn');
  assert.equal(guarded.length, lines.length, 'every line is guarded');
});

test('a landmark that was not found is not drawn', () => {
  const missing = landmarks();
  missing.scores[15] = 0.05;
  missing.scores[16] = 0.05;
  const svg = overlay(missing, []);
  assert.ok(!svg.includes('y1="1800"'), 'no line to a lost ankle');
});

test('a landmark left at the origin is not drawn either', () => {
  /* A backend that fills a slot it never found leaves (0, 0) at full
   * confidence, and a line to it rakes across the photograph to the corner. */
  const slot = landmarks();
  slot.keypoints[13] = [0, 0];
  const svg = overlay(slot, []);
  assert.ok(!svg.includes('x2="0" y2="0"'), 'no line to the frame corner');
});

test('the vertical reference is dropped from between the feet', () => {
  const svg = overlay(landmarks(), []);
  assert.match(svg, /<line x1="500" y1="0" x2="500" y2="2000"/);
});

test('an anchor is the mean of the joints that were actually found', () => {
  const land = landmarks();
  assert.deepEqual(anchorOf(land, [5, 6]), [500, 510]);
  land.scores[6] = 0.05;
  assert.deepEqual(anchorOf(land, [5, 6]), [420, 500], 'the lost one is skipped');
  land.scores[5] = 0.05;
  assert.equal(anchorOf(land, [5, 6]), null, 'nothing to anchor to');
});

test('a photograph is only marked with what it measured', () => {
  /* Forward head comes from the side photographs. Drawing it on the front one
   * would be claiming a measurement that photograph did not make, and the
   * reader has no way to know the number came from somewhere else. */
  const marks = marksFor(report(), 'front', 'en');
  const named = marks.map((m) => m.metric);
  assert.ok(named.includes('shoulder_tilt'));
  assert.ok(!named.includes('forward_head'));
});

test('marks are numbered down the body so the legend can be read against it', () => {
  const marks = marksFor(report(), 'front', 'en');
  assert.deepEqual(marks.map((m) => m.n), marks.map((_, i) => i + 1));
  const ys = marks.map((m) => m.at[1]);
  assert.deepEqual(ys, [...ys].sort((a, b) => a - b));
});

test('a mark carries the short name, not the finding’s sentence', () => {
  const [shoulder] = marksFor(report(), 'front', 'en')
    .filter((m) => m.metric === 'shoulder_tilt');
  assert.equal(shoulder.name, 'shoulder level');
  assert.equal(marksFor(report(), 'front', 'ko')
    .find((m) => m.metric === 'shoulder_tilt').name, '어깨 수평');
});

test('a measurement inside its range carries no direction label', () => {
  /* "left higher" next to a difference of one degree reads as a finding. */
  const marks = marksFor(report(), 'front', 'en');
  assert.equal(marks.find((m) => m.metric === 'shoulder_tilt').way, 'left higher');
  assert.equal(marks.find((m) => m.metric === 'pelvic_obliquity').way, '');
});

test('a photograph with no landmarks is marked with nothing', () => {
  assert.deepEqual(marksFor(report(), 'rear', 'en'), []);
});

test('the screen knows every grade the measurement layer can send', () => {
  /* A severity with no colour here falls through to the "in range" green, so a
   * marked finding would be drawn as unremarkable. */
  const python = PY('guidance.py');
  const grades = [...python.matchAll(/^(?:WATCH|NOTABLE|MARKED|WITHIN) = "([a-z_]+)"$/gm)]
    .map((m) => m[1]);
  assert.equal(grades.length, 4, `the python grades were read (${grades})`);
  for (const grade of grades) {
    assert.ok(INK[grade], `the screen has a colour for ${grade}`);
  }
  assert.equal(Object.keys(INK).length, grades.length, 'and no others');
});

test('the screen anchors every measurement the printed report anchors', () => {
  /* Two renderers, one of them Python, and a measurement anchored to the ears
   * on screen and to the shoulders in print is a report that disagrees with
   * itself in front of a student. */
  const table = PY('intakeview.py');
  const block = table.slice(table.indexOf('ANCHORS: dict'),
                            table.indexOf('#: Short names for the callout'));
  const there = [...block.matchAll(/"([a-z_]+)":/g)].map((m) => m[1]);
  assert.ok(there.length >= 9, `the python table was read (${there.length})`);
  for (const name of there) {
    assert.ok(ANCHOR[name], `the screen anchors ${name} too`);
  }
  assert.deepEqual(Object.keys(ANCHOR).sort(), [...there].sort());
});

test('a number is spelled the same way on the screen as on the page', () => {
  for (const [metric, value, unit, expected] of [
    ['shoulder_tilt', 12, 'deg', '+12.0°'],
    ['forward_head', 0.217, 'ratio', '+22%'],
    ['left_knee_deviation', -0.008, 'ratio', '-1%'],
    ['torso_rotation_index', 1.6, 'ratio', '1.60×'],
  ]) {
    assert.equal(formatValue(metric, { value, unit }), expected);
  }
});

test('every exercise the guidance can suggest exists in this library', () => {
  /* The pills open the real entry. One naming a key the library dropped is a
   * dead button in the one place a coach will press. */
  const python = PY('guidance.py');
  const keys = [...python.matchAll(/_s\("([A-Za-z0-9_]+)",/g)].map((m) => m[1]);
  assert.ok(keys.length > 20, `the advice table was read (${keys.length})`);
  for (const key of new Set(keys)) {
    assert.ok(EXERCISE[key], `${key} is in the library`);
  }
});
