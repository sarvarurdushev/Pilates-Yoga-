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

/* ------------------------------------------------------- history and change */

const { spark, historyHtml, changeHtml } = _internals;

function history(rows) {
  return {
    assessments: rows,
    trend: [...rows].reverse()
      .filter((r) => r.score != null)
      .map((r) => ({ id: r.id, on: r.taken_on, score: r.score, band: r.band })),
  };
}

const visit = (id, on, score, band = 'Fair') => ({
  id, taken_on: on, made_at: `${on}T09:00:00Z`, score, band,
  views: ['front', 'side_left', 'side_right', 'rear'], coverage: 1, checks: 9,
  doubts: [],
});

test('nothing on file draws no history at all', () => {
  assert.equal(historyHtml({ history: history([]) }, 'en'), '');
  assert.equal(historyHtml({}, 'en'), '');
});

test('one assessment on file is listed but not charted', () => {
  /* A line between one point is not a trend, it is a dot with a claim. */
  const html = historyHtml({ history: history([visit(1, '2026-03-01', 80)]) }, 'en');
  assert.match(html, /2026-03-01/);
  assert.ok(!html.includes('ss-spark'));
});

test('two assessments get a line', () => {
  const html = historyHtml({ history: history(
    [visit(2, '2026-06-01', 86), visit(1, '2026-03-01', 74)]) }, 'en');
  assert.match(html, /ss-spark/);
});

test('a withheld score is listed as withheld and left off the line', () => {
  /* A chart that plots a withheld score as zero draws a collapse where there
   * was no measurement. */
  const rows = [visit(2, '2026-06-01', null, 'Not scored'),
                visit(1, '2026-03-01', 74)];
  const html = historyHtml({ history: history(rows) }, 'en');
  assert.match(html, /No score/);
  assert.ok(!html.includes('ss-spark'), 'one point left, so no line');
});

test('the trend line joins every point it was given', () => {
  const trend = [{ on: 'a', score: 60, band: 'Fair' },
                 { on: 'b', score: 75, band: 'Fair' },
                 { on: 'c', score: 88, band: 'Good' }];
  const svg = spark(trend, '#fff');
  assert.equal((svg.match(/<circle/g) ?? []).length, 3);
  assert.equal((svg.match(/[ML] \d/g) ?? []).length, 3);
});

test('a rising score does not draw an upside-down line', () => {
  /* SVG y grows downward, and getting that backwards draws every improvement
   * as a decline -- which would look completely plausible. */
  const svg = spark([{ on: 'a', score: 50, band: 'Fair' },
                     { on: 'b', score: 90, band: 'Good' }], '#fff');
  const ys = [...svg.matchAll(/<circle cx="[\d.]+"\s*cy="([\d.]+)"/g)]
    .map((m) => Number(m[1]));
  assert.equal(ys.length, 2);
  assert.ok(ys[1] < ys[0], `the higher score is drawn higher (${ys})`);
});

function change(over = {}) {
  return {
    before_on: '2026-03-01', after_on: '2026-09-01',
    before_score: 74, after_score: 86, score_change: 12,
    names: { shoulder_tilt: { en: 'shoulder level', ko: '어깨 수평' },
             forward_head: { en: 'head carried forward', ko: '머리 전방 이동' } },
    changes: {
      shoulder_tilt: { before: 11, after: 4, unit: 'deg', absolute: -7,
                       comparable: true, toward_neutral: true, reason: '' },
      forward_head: { before: null, after: 0.2, unit: 'ratio', absolute: null,
                      comparable: false, toward_neutral: null,
                      reason: 'not measured in the earlier assessment' },
    },
    ...over,
  };
}

test('a first assessment says so instead of showing an empty comparison', () => {
  const html = changeHtml({ change: null, history: history([visit(1, 'a', 80)]) }, 'en');
  assert.match(html, /first assessment on file/);
});

test('a comparison shows both numbers and the difference', () => {
  const html = changeHtml({ change: change() }, 'en');
  assert.match(html, /shoulder level/);
  assert.match(html, /\+11\.0° → \+4\.0°/);
  assert.match(html, /-7\.0°/);
});

test('a metric one visit did not measure is named, not dropped', () => {
  /* An absence that looks like a result is how a progress report lies. */
  const html = changeHtml({ change: change() }, 'en');
  assert.match(html, /Not compared/);
  assert.match(html, /head carried forward/);
});

test('nothing in the comparison calls a smaller deviation an improvement', () => {
  /* "improvement" may appear exactly once, in the sentence that refuses to
   * make the claim. Anywhere else it is the claim. */
  const html = changeHtml({ change: change() }, 'en');
  assert.match(html, /closer to level/);
  const judgement = 'A smaller deviation is a smaller deviation. Whether it '
    + 'is an improvement is a judgement for the person teaching.';
  assert.ok(html.includes(judgement), 'the judgement line is there');
  assert.ok(!/improve/i.test(html.replace(judgement, '')),
    'and it is the only place the word appears');
});

test('the comparison reads in Korean too', () => {
  const html = changeHtml({ change: change() }, 'ko');
  assert.match(html, /어깨 수평/);
  assert.match(html, /수평에 가까워짐/);
  assert.match(html, /지도하는 사람이 판단할 일입니다/);
});

test('a withheld score on either side shows no headline difference', () => {
  const html = changeHtml({ change: change({ score_change: null }) }, 'en');
  assert.ok(!html.includes('ss-delta'));
  assert.match(html, /shoulder level/, 'the metrics still compare');
});
