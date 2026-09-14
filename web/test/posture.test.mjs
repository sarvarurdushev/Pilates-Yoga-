import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { _internals } from '../src/session/posture.js';
import { EXERCISE } from '../src/content/exercises.js';

const { overlay, marksFor, anchorOf, formatValue, peek, fixHtml, applyFix,
        INK, ANCHOR } = _internals;

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
  return { name, value, unit: 'deg', sources, contested: false,
           normal: [-2, 2], ...extra };
}

function report(over = {}) {
  return {
    assessment: { readings: {
      shoulder_tilt: reading('shoulder_tilt', 9.1, ['front', 'rear']),
      pelvic_obliquity: reading('pelvic_obliquity', -1.2, ['front', 'rear']),
      forward_head: { name: 'forward_head', value: 0.31, unit: 'ratio',
                      normal: [-0.05, 0.15],
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

/* ---------------------------------------------------------------------------
 * Stepping out to the body, and back.
 *
 * The bug these pin cost somebody their report: pressing "show on the body"
 * tore the screen down and released the photograph object URLs, so there was
 * nothing left to come back to. These tests run against a DOM small enough to
 * write by hand -- appendChild, remove, getElementById, one event each -- which
 * is all peek() touches, and keeps the suite free of a browser.
 * ------------------------------------------------------------------------- */

function fakeDom() {
  const byId = new Map();
  const mk = (tag = 'div') => {
    const el = {
      tagName: tag, id: '', type: '', textContent: '', hidden: false,
      _handlers: new Map(), _attached: false,
      addEventListener(name, fn) { el._handlers.set(name, fn); },
      click() { el._handlers.get('click')?.(); },
      remove() { el._attached = false; if (el.id) byId.delete(el.id); },
    };
    return el;
  };
  const document = {
    createElement: mk,
    getElementById: (id) => byId.get(id) ?? null,
    body: { appendChild(el) { el._attached = true; if (el.id) byId.set(el.id, el); } },
  };
  return { document, mk };
}

test('looking at an exercise hides the report, it does not destroy it', () => {
  const { document, mk } = fakeDom();
  const prior = globalThis.document;
  globalThis.document = document;
  try {
    const host = mk();
    host.id = 'ss-pos';
    document.body.appendChild(host);

    const back = peek(host, { app: { lang: 'en' } });

    assert.equal(host.hidden, true, 'the report is hidden');
    assert.equal(host._attached, true, 'but it is still in the page');
    assert.equal(back._attached, true, 'and there is a way back');
    assert.match(back.textContent, /Back to the analysis/);
  } finally { globalThis.document = prior; }
});

test('the way back brings the same report, photographs and all', () => {
  const { document, mk } = fakeDom();
  const prior = globalThis.document;
  globalThis.document = document;
  try {
    const host = mk();
    host.id = 'ss-pos';
    document.body.appendChild(host);
    const back = peek(host, { app: { lang: 'en' } });

    back.click();

    assert.equal(host.hidden, false, 'the report is showing again');
    assert.equal(host._attached, true, 'and it was never rebuilt');
    assert.equal(back._attached, false, 'the button takes itself away');
  } finally { globalThis.document = prior; }
});

test('stepping out twice leaves one way back, not two', () => {
  /* Two identical buttons stacked on each other: the second click lands on a
   * button whose host reference is the same, so the page looks stuck. */
  const { document, mk } = fakeDom();
  const prior = globalThis.document;
  globalThis.document = document;
  try {
    const host = mk();
    host.id = 'ss-pos';
    document.body.appendChild(host);
    const first = peek(host, { app: { lang: 'en' } });
    const second = peek(host, { app: { lang: 'en' } });

    assert.equal(first._attached, false, 'the first is gone');
    assert.equal(second._attached, true, 'the second stands');
    assert.equal(document.getElementById('ss-pos-back'), second);
  } finally { globalThis.document = prior; }
});

test('the way back is labelled in Korean when the application is', () => {
  const { document, mk } = fakeDom();
  const prior = globalThis.document;
  globalThis.document = document;
  try {
    const host = mk();
    host.id = 'ss-pos';
    document.body.appendChild(host);
    const back = peek(host, { app: { lang: 'ko' } });
    assert.match(back.textContent, /분석으로 돌아가기/);
  } finally { globalThis.document = prior; }
});

/* ---------------------------------------------------------------------------
 * Putting two photographs back in the right slots.
 *
 * The estimator has always been able to say "this left side photograph looks
 * like a right side view". Until now that was a sentence at the bottom of the
 * report and nothing else -- correct, unactionable, and printed twice because
 * both photographs said it about each other. These pin the offer: that the
 * screen finds it as data rather than by matching the sentence, that pressing
 * it moves the files the browser already holds instead of asking for them
 * again, and that it refuses in the cases where moving them would lose one.
 * ------------------------------------------------------------------------- */

const SWAP = {
  action: 'swap',
  views: ['side_left', 'side_right'],
  label: 'Exchange the left side and right side photographs',
  label_ko: '좌측면과 우측면 사진 바꾸기',
  why: 'the left side photograph looks like the right side and the right side looks like the left side',
  why_ko: '좌측면 사진은 우측면처럼, 우측면 사진은 좌측면처럼 보입니다',
};

const RELABEL = {
  action: 'relabel',
  views: ['side_left', 'side_right'],
  label: 'Call the left side photograph the right side',
  label_ko: '좌측면 사진을 우측면으로 변경',
  why: 'it looks like a right side view, and no right side photograph was supplied',
  why_ko: '우측면처럼 보이고, 우측면 사진은 제출되지 않았습니다',
};

const shot = (name) => ({ file: { name }, dataUrl: `data:,${name}`,
                          objectUrl: `blob:${name}` });

function bothSides() {
  return new Map([['side_left', shot('a.jpg')], ['side_right', shot('b.jpg')]]);
}

test('the swap is offered from data, not from the warning sentence', () => {
  /* A screen that reads the offer out of prose stops offering it the first
   * time somebody edits the prose. */
  const html = fixHtml({ report: { fix: SWAP }, photos: bothSides() }, 'en');
  assert.match(html, /data-fix/);
  assert.match(html, /Exchange the left side and right side photographs/);
  assert.match(html, /wrong slots/);
});

test('the offer reads in Korean', () => {
  const html = fixHtml({ report: { fix: SWAP }, photos: bothSides() }, 'ko');
  assert.match(html, /좌측면과 우측면 사진 바꾸기/);
  assert.match(html, /사진을 다시 올리지 않습니다/);
  assert.ok(!/Exchange/.test(html), 'and only in Korean');
});

test('a report with nothing wrong offers nothing', () => {
  assert.equal(fixHtml({ report: { fix: null }, photos: bothSides() }, 'en'), '');
  assert.equal(fixHtml({ report: {}, photos: bothSides() }, 'en'), '');
});

test('the offer is withheld when the photographs are no longer in hand', () => {
  /* A report restored from history has the numbers and not the files. A
   * button that cannot do what it says is worse than no button. */
  const html = fixHtml({ report: { fix: SWAP }, photos: new Map() }, 'en');
  assert.equal(html, '');
});

test('the button says what it is doing while it does it', () => {
  const html = fixHtml({ report: { fix: SWAP }, photos: bothSides(),
                         busy: true }, 'en');
  assert.match(html, /disabled/);
  assert.match(html, /Measuring again/);
});

test('applying the swap exchanges the two files in place', () => {
  const photos = bothSides();
  assert.equal(applyFix(photos, SWAP), true);
  assert.equal(photos.get('side_left').file.name, 'b.jpg');
  assert.equal(photos.get('side_right').file.name, 'a.jpg');
  assert.equal(photos.size, 2, 'nothing was lost');
});

test('the swap sends the same bytes, it does not ask for them again', () => {
  const photos = bothSides();
  const before = [...photos.values()];
  applyFix(photos, SWAP);
  assert.deepEqual(new Set(photos.values()), new Set(before));
});

test('a relabel moves the photograph into the empty slot', () => {
  const photos = new Map([['side_left', shot('a.jpg')]]);
  assert.equal(applyFix(photos, RELABEL), true);
  assert.equal(photos.has('side_left'), false);
  assert.equal(photos.get('side_right').file.name, 'a.jpg');
});

test('a relabel never writes over a photograph that is already there', () => {
  /* It would drop one the studio supplied, and the set would come back a
   * photograph short with nothing on screen saying why. */
  const photos = bothSides();
  assert.equal(applyFix(photos, RELABEL), false);
  assert.equal(photos.size, 2);
  assert.equal(photos.get('side_left').file.name, 'a.jpg');
});

test('a swap with a photograph missing changes nothing', () => {
  const photos = new Map([['side_left', shot('a.jpg')]]);
  assert.equal(applyFix(photos, SWAP), false);
  assert.equal(photos.get('side_left').file.name, 'a.jpg');
});

test('a malformed or absent offer is refused rather than guessed at', () => {
  for (const bad of [null, undefined, {}, { action: 'swap' },
                     { action: 'swap', views: ['side_left'] },
                     { action: 'burn', views: ['side_left', 'side_right'] }]) {
    assert.equal(applyFix(bothSides(), bad), false);
  }
});

test('the words on the button come from the measurement layer', () => {
  /* Both halves of the offer are generated where the views are known, so the
   * button names the two photographs it is actually going to move -- front
   * and back as readily as the two sides. */
  const py = PY('intake.py');
  assert.match(py, /"action": "swap"/);
  assert.match(py, /"action": "relabel"/);
  assert.match(py, /label_ko/);
});

/* ---------------------------------------------------------------------------
 * Opening an assessment that is already on file.
 *
 * The strip listed them and nothing more: a date, a score, and seventeen
 * measurements behind them that nobody could ever read again once the tab was
 * closed. These pin that a row is a control, that it says so, and that the
 * report it opens admits the photographs are gone rather than drawing four
 * black rectangles.
 * ------------------------------------------------------------------------- */

const { historyHtml: hist } = _internals;

const FILED = {
  assessments: [
    { id: 7, taken_on: '2026-09-14', made_at: '2026-09-14T09:00:00',
      score: 100, band: 'Excellent', views: ['front', 'side_left',
                                             'side_right', 'rear'] },
    { id: 3, taken_on: '2026-08-01', made_at: '2026-08-01T09:00:00',
      score: null, band: '', views: ['front', 'side_left', 'side_right', 'rear'] },
  ],
  trend: [{ id: 7, on: '2026-09-14', score: 100, band: 'Excellent' }],
};

test('every filed assessment is something you can press', () => {
  const html = hist({ history: FILED }, 'en');
  assert.match(html, /data-open="7"/);
  assert.match(html, /data-open="3"/);
  assert.match(html, /<button/);
});

test('a row says it opens, rather than looking like a line of text', () => {
  const html = hist({ history: FILED }, 'en');
  assert.match(html, /Open/);
});

test('the one being read is marked as the one being read', () => {
  const html = hist({ history: FILED, report: { assessment_id: 7 } }, 'en');
  assert.match(html, /data-open="7"[^>]*aria-current="true"/);
  assert.match(html, /Showing/);
});

test('a withheld score is named on the strip, never drawn as zero', () => {
  const html = hist({ history: FILED }, 'en');
  assert.match(html, /No score/);
  assert.ok(!/>0 ·/.test(html));
});

test('the rows are dead while something else is loading', () => {
  /* Two assessments opening at once would race, and the one that answered
   * second would win whichever the reader asked for first. */
  const html = hist({ history: FILED, busy: true }, 'en');
  assert.match(html, /disabled/);
});

test('the strip reads in Korean', () => {
  const html = hist({ history: FILED }, 'ko');
  assert.match(html, /열기/);
  assert.match(html, /기록된 분석/);
});

/** The whole payload a report page needs, not just the slice a panel does. */
function whole(over = {}) {
  return {
    ...report(),
    assessment_id: 7,
    score: { value: 88, band: 'Good', band_ko: '우수', worst_finding: 'watch',
             band_capped: false, band_cap_reason: '', band_cap_reason_ko: '',
             withheld_reason: '', withheld_reason_ko: '',
             note: 'measured 14 things', note_ko: '14개 항목 측정',
             coverage: 0.82, checks: 14,
             bands: [[90, 'Excellent', '매우 우수'], [80, 'Good', '우수'],
                     [60, 'Fair', '보통'], [40, 'Needs attention', '주의'],
                     [0, 'Needs work', '관리 필요']]
               .map(([f, e, k]) => ({ from: f, en: e, ko: k })) },
    findings_note: '', findings_note_ko: '',
    priorities: [], programme: [], habits: [], regions: [],
    refused_detail: [], unremarkable_detail: [], missing_photos: [],
    warnings: [], doubts: [], protocol: [],
    disclaimer: 'not a medical assessment', disclaimer_ko: '의학적 진단이 아니며',
    ...over,
  };
}

test('a reopened report says the photographs are not coming back', () => {
  /* They were measured and dropped. A reader who expected their photograph
   * deserves a sentence rather than four black rectangles. */
  const html = _internals.reportHtml(
    { report: whole({ from_file: true }), photos: new Map(),
      taken: '2026-09-14', who: '' }, 'en', () => ({}));
  assert.match(html, /Reopened from the record/);
  assert.match(html, /measured and dropped/);
});

test('a fresh report says nothing of the kind', () => {
  const html = _internals.reportHtml(
    { report: whole(), photos: new Map(), taken: '2026-09-14', who: '' },
    'en', () => ({}));
  assert.ok(!/Reopened from the record/.test(html));
});

test('a report offers the way back to every other assessment on file', () => {
  /* Reading one and then wanting the one before it is the whole of what a
   * studio does with these, and it used to mean starting again. */
  const html = _internals.reportHtml(
    { report: whole(), photos: new Map(), taken: '2026-09-14', who: '',
      history: FILED }, 'en', () => ({}));
  assert.match(html, /data-open="3"/);
});

/* ---------------------------------------------------------------------------
 * The report as a page somebody reads, rather than a table beside a picture.
 * ------------------------------------------------------------------------- */

const { bodyMapHtml, scaleHtml, callouts, regionInk } = _internals;

const REGIONS = [
  { region: 'head', name: 'Head and neck', name_ko: '머리·목', score: 67,
    checks: 4, weakest: 'forward_head', weakest_name: 'head carried forward',
    weakest_name_ko: '머리 전방 이동' },
  { region: 'shoulders', name: 'Shoulders', name_ko: '어깨', score: 91,
    checks: 3, weakest: 'shoulder_tilt', weakest_name: 'shoulder level',
    weakest_name_ko: '어깨 수평' },
  { region: 'pelvis', name: 'Pelvis', name_ko: '골반', score: 92, checks: 3,
    weakest: '', weakest_name: '', weakest_name_ko: '' },
  { region: 'trunk', name: 'Trunk', name_ko: '몸통', score: 100, checks: 2,
    weakest: '', weakest_name: '', weakest_name_ko: '' },
  { region: 'lower_body', name: 'Legs and feet', name_ko: '다리·발',
    score: null, checks: 0, weakest: '', weakest_name: '',
    weakest_name_ko: '' },
];

test('the body map names every region and scores it', () => {
  const html = bodyMapHtml({ regions: REGIONS }, 'en');
  for (const row of REGIONS) assert.ok(html.includes(row.name), row.name);
  assert.match(html, /67 \/ 100/);
});

test('a region nothing measured says so rather than showing a zero', () => {
  const html = bodyMapHtml({ regions: REGIONS }, 'en');
  assert.match(html, /Not measured/);
  /* Anchored, because "100 / 100" ends in "0 / 100" and a loose match here
     would pass on a region that scored full marks. */
  assert.ok(!/>\s*0 \/ 100/.test(html));
});

test('every region the measurement layer scores can be drawn', () => {
  /* A region added in Python and not here would simply never be coloured,
   * and the map would quietly be about four fifths of a body. */
  const py = PY('alignment.py');
  const block = py.split('REGIONS: dict[str, tuple[str, ...]] = {')[1]
    .split('\n}')[0];
  const keys = [...block.matchAll(/^\s{4}"([a-z_]+)":/gm)].map((m) => m[1]);
  assert.ok(keys.length >= 5, `found ${keys.length} regions`);
  const src = readFileSync(
    new URL('../src/session/posture.js', import.meta.url), 'utf8');
  const drawn = src.split('const BODY = {')[1].split('\n};')[0];
  for (const key of keys) {
    assert.ok(drawn.includes(`${key}:`), `${key} has no shape on the map`);
  }
});

test('a region is coloured by what was measured in it, not by a default', () => {
  assert.equal(regionInk(95), INK.within_band);
  assert.equal(regionInk(70), INK.watch);
  assert.equal(regionInk(30), INK.marked);
  assert.notEqual(regionInk(null), regionInk(95));
});

test('the map reads in Korean', () => {
  const html = bodyMapHtml({ regions: REGIONS }, 'ko');
  assert.match(html, /머리·목/);
  assert.match(html, /정상/);
  assert.ok(!/Head and neck/.test(html));
});

test('nothing is drawn when nothing was measured', () => {
  assert.equal(bodyMapHtml({ regions: [] }, 'en'), '');
});

const SCORE = {
  value: 88,
  bands: [{ from: 90, en: 'Excellent', ko: '매우 우수' },
          { from: 80, en: 'Good', ko: '우수' },
          { from: 60, en: 'Fair', ko: '보통' },
          { from: 40, en: 'Needs attention', ko: '주의' },
          { from: 0, en: 'Needs work', ko: '관리 필요' }],
};

test('the scale shows where the score sits, not only what it is called', () => {
  /* Eighty-nine and ninety are one point apart and two band names apart. */
  const html = scaleHtml(SCORE, 'en');
  assert.match(html, /left:88%/);
});

test('the scale runs low to high whatever order the bands arrived in', () => {
  const html = scaleHtml(SCORE, 'en');
  const first = html.indexOf('Needs work');
  const last = html.indexOf('Excellent');
  assert.ok(first < last, 'the low band is drawn before the high one');
});

test('a withheld score puts no marker on the scale', () => {
  const html = scaleHtml({ ...SCORE, value: null }, 'en');
  assert.ok(!/left:/.test(html));
  assert.match(html, /ss-scalebar/, 'the scale is still drawn');
});

test('a finding is named on the photograph, not only in a legend', () => {
  /* A numbered dot and a list underneath makes a reader hold a number in
   * their head, look away, find the row, and look back. Six times. */
  const land = landmarks();
  const marks = [
    { metric: 'shoulder_tilt', at: [420, 500], ink: INK.marked,
      name: 'shoulder level', value: '+9.1°', way: 'left higher' },
    { metric: 'pelvic_obliquity', at: [550, 1010], ink: INK.within_band,
      name: 'pelvis level', value: '-1.2°', way: '' },
  ];
  const drawn = callouts(land, marks).join('');
  assert.match(drawn, /shoulder level/);
  assert.match(drawn, /pelvis level/);
  assert.match(drawn, /\+9\.1°/);
  assert.match(drawn, /left higher/);
});

test('two callouts never land on the same line', () => {
  /* Two labels on one line is worse than no labels. */
  const land = landmarks();
  const marks = [0, 1, 2, 3].map((i) => ({
    metric: `m${i}`, at: [400, 500 + i], ink: '#fff',
    name: `finding ${i}`, value: '0', way: '' }));
  const ys = callouts(land, marks).join('')
    .match(/<text[^>]*y="([\d.-]+)"/g)
    .map((t) => Number(t.match(/y="([\d.-]+)"/)[1]));
  const sorted = [...new Set(ys)].sort((a, b) => a - b);
  assert.equal(sorted.length, ys.length, 'every label has its own line');
});

test('a callout is never drawn off the bottom of the photograph', () => {
  const land = landmarks();
  const marks = [0, 1, 2, 3, 4, 5].map((i) => ({
    metric: `m${i}`, at: [400, 1900 + i], ink: '#fff',
    name: `finding ${i}`, value: '0', way: '' }));
  const ys = callouts(land, marks).join('')
    .match(/<text[^>]*y="([\d.-]+)"/g)
    .map((t) => Number(t.match(/y="([\d.-]+)"/)[1]));
  for (const y of ys) {
    assert.ok(y > 0 && y < land.height, `label at ${y} is outside 0..${land.height}`);
  }
});

test('nothing is labelled when nothing was measured', () => {
  assert.deepEqual(callouts(landmarks(), []), []);
});

test('a plan item says how much of it, not only what it is', () => {
  const html = _internals.reportHtml({
    report: whole({ programme: [{ key: 'headNods', name: 'Head Nods',
      name_ko: '헤드 노드', why: ['the deep neck flexors'],
      why_ko: ['목 심부 굽힘근'], for: ['forward_head'], severity: 'marked',
      dose: { severity: 'marked', times_per_week: 4, weeks: 6,
              en: '4x a week for 6 weeks', ko: '주 4회 · 6주' } }] }),
    photos: new Map(), taken: '2026-09-14', who: '' }, 'en', () => ({}));
  assert.match(html, /4x a week for 6 weeks/);
  assert.match(html, /not a prescription/);
});

/* ------------------------------------------------------- where to look next */

const { musclesHtml, showMuscle } = _internals;

const ACTS = {
  metric: 'shoulder_tilt',
  acts_here: [
    { action: 'raise the shoulder blade', action_ko: '어깨뼈를 올리는 근육',
      muscles: ['descending part of trapezius', 'levator scapulae'] },
    { action: 'lower and settle it', action_ko: '어깨뼈를 내리고 안정시키는 근육',
      muscles: ['ascending part of trapezius', 'serratus anterior'] },
  ],
  acts_note: 'Which of them is short and which is long is not something a photograph can tell you.',
  acts_note_ko: '어느 것이 짧고 어느 것이 늘어났는지는 사진으로 알 수 없습니다.',
};

test('a finding names the muscles that act where it was measured', () => {
  const html = musclesHtml(ACTS, 'en');
  assert.match(html, /raise the shoulder blade/);
  assert.match(html, /lower and settle it/);
});

test('each muscle is a control that can light it on the body', () => {
  const html = musclesHtml(ACTS, 'en');
  assert.match(html, /data-muscle="descending part of trapezius"/);
  assert.match(html, /data-muscle="serratus anterior"/);
});

test('a muscle is shown by the name the atlas gives it', () => {
  /* The key is precise so the geometry resolves; the label is what a person
   * would say out loud. */
  const html = musclesHtml(ACTS, 'en');
  assert.match(html, /Upper trapezius/);
  assert.ok(!/>descending part of trapezius</.test(html));
});

test('the muscles read in Korean, from the atlas rather than a second table', () => {
  const html = musclesHtml(ACTS, 'ko');
  assert.match(html, /어깨뼈를 올리는 근육/);
  assert.match(html, /등세모근|승모근/);
});

test('nothing claims a muscle is tight or weak', () => {
  /* A photograph measured a position. Muscle activity is measured with
   * electrodes, on a body. */
  const html = musclesHtml(ACTS, 'en') + musclesHtml(ACTS, 'ko');
  for (const word of ['overactive', 'underactive', 'inhibited', 'tight',
                      '과활성', '저활성']) {
    assert.ok(!html.toLowerCase().includes(word.toLowerCase()), word);
  }
});

test('the sentence that says so is printed with them', () => {
  assert.match(musclesHtml(ACTS, 'en'), /not something a photograph can tell you/);
  assert.match(musclesHtml(ACTS, 'ko'), /사진으로 알 수 없습니다/);
});

test('a finding with no muscles draws no panel', () => {
  assert.equal(musclesHtml({ metric: 'torso_rotation_index' }, 'en'), '');
  assert.equal(musclesHtml({ metric: 'x', acts_here: [] }, 'en'), '');
});

test('a muscle the body cannot show is not pretended to be shown', () => {
  /* A chip that silently does nothing is worse than a chip that is not
   * there, so the caller only hides the report when the press worked. */
  assert.equal(showMuscle({}, 'descending part of trapezius'), false);
  assert.equal(showMuscle({ selectStructure: () => {} }, 'nothing at all'),
               false);
});

/* --------------------------------------------------- every measurement shown */

const { measurementsHtml, trackHtml } = _internals;

test('a body with nothing wrong still gets a report with something in it', () => {
  /* The whole failure this answers: a score of 100, an empty findings
   * section, and seventeen measurements summarised as a list of their names
   * at the bottom. The work was done and none of it was shown. */
  const html = measurementsHtml({ ...report(), findings: [] }, 'en');
  assert.match(html, /shoulder level/);
  assert.match(html, /pelvis level/);
  assert.match(html, /head carried forward/);
});

test('every measurement shows its number and its range', () => {
  const html = measurementsHtml(report(), 'en');
  assert.match(html, /\+9\.1°/);
  assert.match(html, /-2\.0° to \+2\.0°/);
});

test('a measurement is marked by how much of a finding it is', () => {
  const html = measurementsHtml(report(), 'en');
  /* shoulder_tilt is the marked finding in the fixture; pelvic_obliquity is
     inside its band. The two must not be drawn the same. */
  assert.ok(html.includes(INK.marked), 'the finding is coloured as one');
  assert.ok(html.includes(INK.within_band), 'and the unremarkable one is not');
});

test('a refusal is shown with its reason, not as a blank row', () => {
  const html = measurementsHtml({ ...report(), assessment: { readings: {
    sagittal_pelvic_tilt: { name: 'sagittal_pelvic_tilt', value: null,
      unit: 'deg', sources: [], contested: false,
      reason: 'needs the ASIS and PSIS landmarks' } } } }, 'en');
  assert.match(html, /ASIS and PSIS/);
});

test('a refusal is explained in the language the page is in', () => {
  /* The reading carries the reason the measurement layer wrote, which is
     English. The Korean wording is on refused_detail, and without the lookup
     the one row on the page that explains itself did so in the wrong
     language. */
  const payload = { ...report(),
    assessment: { readings: { sagittal_pelvic_tilt: {
      name: 'sagittal_pelvic_tilt', value: null, unit: 'deg', sources: [],
      contested: false, reason: 'needs the ASIS and PSIS landmarks' } } },
    refused_detail: [{ metric: 'sagittal_pelvic_tilt',
      name: 'pelvic tilt', name_ko: '골반 전후 경사',
      reason: 'needs the ASIS and PSIS landmarks',
      reason_ko: '위앞엉덩뼈가시 지점이 필요합니다' }] };
  assert.match(measurementsHtml(payload, 'ko'), /위앞엉덩뼈가시/);
  assert.ok(!/ASIS and PSIS/.test(measurementsHtml(payload, 'ko')));
  assert.match(measurementsHtml(payload, 'en'), /ASIS and PSIS/);
});

test('nothing is drawn when nothing was measured at all', () => {
  assert.equal(measurementsHtml({ assessment: { readings: {} } }, 'en'), '');
});

test('the table reads in Korean', () => {
  const html = measurementsHtml(report(), 'ko');
  assert.match(html, /전체 측정값/);
  assert.match(html, /어깨 수평/);
});

test('the band is drawn as the middle of the track, not the whole of it', () => {
  /* A track that *is* the band cannot show a value outside it: everything out
   * of range pins to an edge and reads the same however far out it is. */
  const html = trackHtml(0, [-2, 2], '#fff');
  const shade = html.match(/left:([\d.]+)%;width:([\d.]+)%/);
  assert.ok(Number(shade[1]) > 30 && Number(shade[1]) < 36, 'band starts a third in');
  assert.ok(Number(shade[2]) > 30 && Number(shade[2]) < 36, 'and is a third wide');
});

test('a value outside its range is drawn outside the shading', () => {
  const inside = Number(trackHtml(0, [-2, 2], '#fff').match(/b style="left:([\d.]+)%/)[1]);
  const outside = Number(trackHtml(5, [-2, 2], '#fff').match(/b style="left:([\d.]+)%/)[1]);
  assert.ok(outside > 66, `${outside}% should be past the band`);
  assert.ok(inside > 45 && inside < 55, 'and the centred one in the middle');
});

test('a value far outside is held on the track rather than off it', () => {
  const far = Number(trackHtml(500, [-2, 2], '#fff').match(/b style="left:([\d.]+)%/)[1]);
  assert.ok(far <= 100, `${far}% is off the track`);
});

test('a measurement with no usual range gets no shading to sit inside', () => {
  /* Pretending otherwise is how a number with no meaning acquires one. */
  const html = trackHtml(1.6, null, '#fff');
  assert.match(html, /ss-noband/);
  assert.ok(!/<i /.test(html), 'and nothing shaded');
});
