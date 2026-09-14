import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { _internals } from '../src/session/movement.js';

const { setupHtml, reportHtml, sideHtml, asymmetryHtml, findingsHtml, barHtml,
        longestTrack, screenOf, sidesOf, howOf, programmeHtml,
        CATALOGUE } = _internals;

/* The screening screen draws numbers it did not compute, against references it
 * did not choose, in two languages. Every test here is about one of the ways
 * that goes wrong: a shortfall drawn as an achievement, a refusal drawn as a
 * zero, a reference quoted without its source, or one of the two languages
 * quietly falling back to the other.
 *
 * The catalogue and the wording the Python side owns are read out of the
 * Python side rather than copied, so a screen added there and not here fails
 * loudly instead of silently going missing from the only place a studio can
 * reach it. */

const PY = (name) => readFileSync(
  new URL(`../../pilates/${name}`, import.meta.url), 'utf8');

function screenPayload(over = {}) {
  return {
    screen: 'shoulder_flexion',
    name: 'Shoulder flexion', name_ko: '어깨 굽힘',
    kind: 'range', unit: 'deg',
    reference: [0, 180],
    reference_kind: 'clinical',
    reference_source: 'AAOS normal active range, as tabulated in Norkin & White',
    views: ['side_left', 'side_right'],
    left: side({ peak: 148.0, shortfall: 32.0 }),
    right: side({ peak: 176.0, shortfall: 4.0 }),
    both: null,
    asymmetry: { value: 28.0, unit: 'deg', availability: 'available',
                 reason: '', tolerance: 10 },
    shorter_side: 'left',
    ...over,
  };
}

function side(over = {}) {
  const metric = (value, unit = 'deg', extra = {}) => ({
    value, unit, availability: 'available', confidence: 0.9, reason: '',
    normal: null, ...extra });
  return {
    screen: 'shoulder_flexion', side: 'left', frames: 120, confidence: 0.9,
    repetitions: 3, excursions: [146, 147, 145], notes: [],
    peak: metric(over.peak ?? 148.0, 'deg', { normal: [0, 180] }),
    shortfall: metric(over.shortfall ?? 32.0),
    consistency: metric(1.0),
    tempo: metric(1.3, 's'),
    tempo_ratio: metric(1.05, 'ratio'),
    control: metric(1.0, 'ratio'),
    held: null, sway: null,
    ...Object.fromEntries(Object.entries(over).filter(
      ([k]) => !['peak', 'shortfall'].includes(k))),
  };
}

function report(over = {}) {
  return {
    attempted: ['shoulder_flexion'],
    results: { shoulder_flexion: screenPayload() },
    overall_score: 78.4,
    checks: 3,
    score_withheld_reason: '',
    findings: [{ screen: 'shoulder_flexion', kind: 'range', side: 'left',
                 severity: 'notable', reached: 148, reference: 180, gap: 32,
                 unit: 'deg', title: 'Shoulder flexion (left): short of the reference range',
                 title_ko: '어깨 굽힘 (왼쪽): 가동 범위 부족',
                 measurement: 'reference 180°, reached 148°, 32° short',
                 measurement_ko: '기준 180° · 도달 148° · 32° 부족' }],
    refused: [],
    catalogue_detail: [],
    disclaimer: 'not a medical assessment',
    disclaimer_ko: '의학적 진단이 아니며',
    ...over,
  };
}

const setup = (over = {}) => ({
  catalogue: CATALOGUE, chosen: 'shoulder_flexion', view: '',
  clips: new Map(), busy: false, progress: '', error: '', who: '',
  taken: '2026-09-14', report: null, ...over,
});

/* ------------------------------------------------------------- the catalogue */

test('every screen the measurement layer defines can be chosen here', () => {
  /* A screen the studio cannot reach is a screen that does not exist. */
  const py = PY('screening.py');
  const keys = [...py.matchAll(/^\s{4}"([a-z_]+)": Screen\(/gm)].map((m) => m[1]);
  assert.ok(keys.length >= 6, `found ${keys.length} screens in Python`);
  for (const key of keys) {
    assert.ok(CATALOGUE.some((s) => s.key === key),
      `${key} is measured but cannot be chosen`);
  }
});

test('the built-in list carries no instruction of its own', () => {
  /* It is a sentence a student is read aloud, and it appears in a printed
   * report and in the terminal too. A copy here is a copy that stops matching
   * the day somebody rewords the other two. */
  for (const entry of CATALOGUE) {
    assert.equal(entry.instruction, undefined);
    assert.equal(entry.instruction_ko, undefined);
  }
});

test('the instruction says it is coming rather than showing a blank', () => {
  assert.match(howOf(setup(), 'en'), /Fetching/);
  assert.match(howOf(setup(), 'ko'), /불러오는 중/);
});

test('once the server answers, its words are the ones shown', () => {
  const state = setup({ catalogue: [{ key: 'shoulder_flexion',
    name: 'Shoulder flexion', name_ko: '어깨 굽힘', sided: true,
    views: ['side_left'], instruction: 'Turn side-on and raise both arms.',
    instruction_ko: '옆으로 서서 양팔을 올립니다.' }] });
  assert.equal(howOf(state, 'en'), 'Turn side-on and raise both arms.');
  assert.equal(howOf(state, 'ko'), '옆으로 서서 양팔을 올립니다.');
});

test('a sided screen asks for two clips and an unsided one for a single', () => {
  assert.deepEqual(sidesOf({ sided: true }), ['left', 'right']);
  assert.deepEqual(sidesOf({ sided: false }), ['both']);
});

test('an unknown chosen key falls back rather than drawing nothing', () => {
  assert.equal(screenOf(setup({ chosen: 'backflip' })).key, CATALOGUE[0].key);
});

/* ------------------------------------------------------------------ the setup */

test('the setup offers only the camera angles the screen can be filmed from', () => {
  const html = setupHtml(setup(), {}, 'en');
  assert.match(html, /value="side_left"/);
  assert.match(html, /value="side_right"/);
  assert.ok(!/value="front"/.test(html),
    'a front view would read short by an amount nothing can recover');
});

test('the setup says what leaving the camera angle out costs', () => {
  const html = setupHtml(setup(), {}, 'en');
  assert.match(html, /estimated/);
  assert.match(html, /nothing can recover/);
});

test('a site with no analysis behind it says so instead of offering one', () => {
  const html = setupHtml(setup(), { screening: false }, 'en');
  assert.match(html, /cannot measure a clip/);
  assert.ok(!/data-run/.test(html), 'and does not offer the button');
});

test('the setup reads in Korean', () => {
  const html = setupHtml(setup(), {}, 'ko');
  assert.match(html, /움직임 검사/);
  assert.match(html, /좌측면/);
  assert.ok(!/Choose a file/.test(html));
});

/* ------------------------------------------------------------------ one side */

test('a shortfall is drawn as a shortfall, never as an achievement', () => {
  const html = sideHtml(side({ peak: 148, shortfall: 32 }), 'left',
                        screenPayload(), 'en');
  assert.match(html, /148/);
  assert.match(html, /reference 180/);
  assert.match(html, /32° short/);
});

test('a joint at the reference range is not reported as short by zero', () => {
  const html = sideHtml(side({ peak: 180, shortfall: 0 }), 'left',
                        screenPayload(), 'en');
  assert.match(html, /at the reference range/);
  assert.ok(!/0° short/.test(html));
});

test('the bar is the proportion reached, not a full bar for any measurement', () => {
  assert.match(barHtml(90, 180, '#fff'), /width:50\.0%/);
  assert.match(barHtml(180, 180, '#fff'), /width:100\.0%/);
  assert.match(barHtml(0, 180, '#fff'), /width:0\.0%/);
});

test('a bar can never overflow its track, whatever the body did', () => {
  /* A squat past parallel reaches more than the benchmark. The bar is full,
   * not 130% of full spilling out of the card. */
  assert.match(barHtml(115, 90, '#fff'), /width:100\.0%/);
});

test('a side that was not measured shows the reason, not a zero', () => {
  const html = sideHtml(
    { peak: { value: null, reason: 'filmed from front; this movement happens in another plane' },
      shortfall: { value: null }, notes: [] },
    'left', screenPayload(), 'en');
  assert.match(html, /Not measured/);
  assert.match(html, /another plane/);
  assert.ok(!/ss-num/.test(html), 'and prints no number at all');
});

test('an estimated measurement is marked as estimated', () => {
  const result = side();
  result.peak.availability = 'estimated';
  const html = sideHtml(result, 'left', screenPayload(), 'en');
  assert.match(html, /estimated/);
});

test('the repetitions, spread and tempo are all shown, not just the best one', () => {
  const html = sideHtml(side(), 'left', screenPayload(), 'en');
  assert.match(html, /3 repetitions/);
  assert.match(html, /spread across them/);
  assert.match(html, /per repetition/);
});

test('a hold shows how long and how far it drifted', () => {
  const balance = side({
    repetitions: 0, consistency: null, tempo: null, tempo_ratio: null,
    held: { value: 12.4, unit: 's', availability: 'available', confidence: 0.9,
            reason: '', normal: null },
    sway: { value: 0.042, unit: 'ratio', availability: 'available',
            confidence: 0.9, reason: '', normal: null } });
  const html = sideHtml(balance, 'left',
                        screenPayload({ unit: 's', reference: [0, 30] }), 'en');
  assert.match(html, /held 12\.4s/);
  assert.match(html, /4\.2%/);
  assert.match(html, /of body height/);
});

test('a note on a measurement travels with it', () => {
  const html = sideHtml(side({ notes: ['no complete repetition was seen'] }),
                        'left', screenPayload(), 'en');
  assert.match(html, /no complete repetition/);
});

test('a side reads in Korean', () => {
  const html = sideHtml(side(), 'left', screenPayload(), 'ko');
  assert.match(html, /왼쪽/);
  assert.match(html, /기준/);
  assert.match(html, /부족/);
});

/* ----------------------------------------------------------------- the sides */

test('the side that travelled less is named', () => {
  const html = asymmetryHtml(screenPayload(), 'en');
  assert.match(html, /28°/);
  assert.match(html, /left side travelled less/);
});

test('a difference inside the measurement is not called a difference', () => {
  const html = asymmetryHtml(screenPayload({
    asymmetry: { value: 4.0, unit: 'deg', availability: 'available',
                 reason: '', tolerance: 10 },
    shorter_side: '' }), 'en');
  assert.match(html, /match within the measurement/);
});

test('nothing to compare against says so rather than showing zero', () => {
  const html = asymmetryHtml(screenPayload({
    asymmetry: { value: null, unit: 'deg', availability: 'unavailable',
                 reason: 'the right side was not measured', tolerance: 10 },
    shorter_side: '' }), 'en');
  assert.match(html, /right side was not measured/);
  assert.ok(!/ss-num/.test(html));
});

test('the two sides read in Korean', () => {
  const html = asymmetryHtml(screenPayload(), 'ko');
  assert.match(html, /왼쪽/);
  assert.match(html, /덜 움직였습니다/);
});

/* --------------------------------------------------------------- the report */

test('a finding carries the arithmetic that produced it', () => {
  const html = findingsHtml(report(), 'en');
  assert.match(html, /reference 180°, reached 148°, 32° short/);
});

test('nothing outside the range says so rather than showing an empty card', () => {
  const html = findingsHtml(report({ findings: [] }), 'en');
  assert.match(html, /Nothing outside the reference range/);
});

test('the findings read in Korean', () => {
  const html = findingsHtml(report(), 'ko');
  assert.match(html, /어깨 굽힘/);
  assert.match(html, /기준 180°/);
});

test('the report always prints where the reference came from', () => {
  /* A number a studio may have to defend, with nothing behind it. Matched in
   * its escaped form, because the source is somebody's name and the page must
   * not be able to put markup on the screen through it. */
  const html = reportHtml(setup({ report: report() }), 'en');
  assert.match(html, /Norkin &amp; White/);
});

test('a withheld score is explained rather than drawn as zero', () => {
  const html = reportHtml(setup({ report: report({
    overall_score: null,
    score_withheld_reason: 'only 3 check(s) could be made' }) }), 'en');
  assert.match(html, /No score/);
  assert.match(html, /only 3 check/);
  assert.ok(!/>0</.test(html.replace(/reference \[?0/g, '')));
});

test('a refused screen is listed with its reason', () => {
  const html = reportHtml(setup({ report: report({
    refused: [{ screen: 'knee_flexion', side: 'right',
                'reason': 'the joints averaged 0.31 confidence' }] }) }), 'en');
  assert.match(html, /knee_flexion/);
  assert.match(html, /0\.31 confidence/);
});

test('the disclaimer is on the report in whichever language is showing', () => {
  assert.match(reportHtml(setup({ report: report() }), 'en'),
               /not a medical assessment/);
  assert.match(reportHtml(setup({ report: report() }), 'ko'),
               /의학적 진단이 아니며/);
});

test('nothing in the report calls a larger range an improvement', () => {
  const html = reportHtml(setup({ report: report() }), 'en');
  assert.ok(!/improve/i.test(html));
});

/* ------------------------------------------------------------ the longest track */

test('the student is the track that was there the whole time', () => {
  /* A mirror, or the same person picked up again after walking behind a
   * reformer, both produce extra tracks. */
  const picked = longestTrack({ tracks: [
    { track_id: 1, samples: 12, times: [0], frames: [{ a: 1 }] },
    { track_id: 2, samples: 300, times: [0, 1], frames: [{ b: 2 }] },
  ] });
  assert.deepEqual(picked.times, [0, 1]);
});

test('an empty clip is an error, not an empty measurement', () => {
  assert.throws(() => longestTrack({ tracks: [] }), /nobody was tracked/);
  assert.throws(() => longestTrack(null), /nobody was tracked/);
});

/* ------------------------------------------------------- both languages, always */

test('every phrase on this screen exists in both languages', () => {
  for (const [key, entry] of Object.entries(_internals.CHIP)) {
    assert.ok(entry.en, `${key} has no English`);
    assert.ok(entry.ko, `${key} has no Korean`);
    assert.notEqual(entry.en, entry.ko, `${key} is the same in both`);
  }
});

/* -------------------------------------------------------- what to work on */

const PLAN = [
  { key: 'urdhvaHastasana', name: 'Upward Salute', name_ko: '위로 인사하는 자세',
    screen: 'shoulder_flexion', screen_name: 'Shoulder flexion',
    screen_name_ko: '어깨 굽힘', severity: 'notable' },
  { key: 'virasana', name: 'Hero Pose', name_ko: '영웅 자세',
    screen: 'knee_flexion', screen_name: 'Knee flexion',
    screen_name_ko: '무릎 굽힘', severity: 'watch' },
];

test('a shortfall opens onto something to do about it', () => {
  const html = programmeHtml(report({ programme: PLAN }), 'en');
  assert.match(html, /Upward Salute/);
  assert.match(html, /Shoulder flexion/);
  assert.match(html, /data-ex="urdhvaHastasana"/);
});

test('nothing short suggests nothing, rather than an empty card', () => {
  assert.equal(programmeHtml(report({ programme: [] }), 'en'), '');
  assert.equal(programmeHtml(report({ programme: undefined }), 'en'), '');
});

test('the exercise names come from the server, in whichever language', () => {
  const html = programmeHtml(report({ programme: PLAN }), 'ko');
  assert.match(html, /위로 인사하는 자세/);
  assert.match(html, /어깨 굽힘/);
  assert.ok(!/Upward Salute/.test(html));
});

test('the exercises named here are keys the library actually has', () => {
  /* A key nothing matches is a button that opens nothing. Checked against the
   * Python catalogue, which is checked against the library in its own tests. */
  const py = PY('screening.py');
  const works = [...py.matchAll(/works=\(([^)]*)\)/g)]
    .flatMap((m) => [...m[1].matchAll(/"([A-Za-z0-9]+)"/g)].map((k) => k[1]));
  assert.ok(works.length >= 30, `found ${works.length} exercise keys`);
  const library = readFileSync(
    new URL('../src/content/library/pilates.js', import.meta.url), 'utf8')
    + readFileSync(
      new URL('../src/content/library/yoga.js', import.meta.url), 'utf8');
  for (const key of works) {
    assert.ok(library.includes(`${key}:`) || library.includes(`'${key}'`)
      || library.includes(`"${key}"`), `${key} is not in the library`);
  }
});

test('the report shows the plan beside the findings', () => {
  const html = reportHtml(setup({ report: report({ programme: PLAN }) }), 'en');
  assert.match(html, /What to work on/);
  assert.match(html, /Upward Salute/);
});

/* ------------------------------------------------- stepping out to the body */

function fakeDom() {
  const byId = new Map();
  const mk = () => {
    const el = {
      id: '', type: '', textContent: '', hidden: false, _attached: false,
      _handlers: new Map(),
      addEventListener(n, fn) { el._handlers.set(n, fn); },
      click() { el._handlers.get('click')?.(); },
      remove() { el._attached = false; if (el.id) byId.delete(el.id); },
    };
    return el;
  };
  return {
    mk,
    document: {
      createElement: mk,
      getElementById: (id) => byId.get(id) ?? null,
      body: { appendChild(el) { el._attached = true; if (el.id) byId.set(el.id, el); } },
    },
  };
}

test('looking at an exercise hides the screening, it does not destroy it', () => {
  /* There is no way back to a report built from a clip that has already been
   * deleted, which is why this screen may never be torn down to show one. */
  const { document, mk } = fakeDom();
  const prior = globalThis.document;
  globalThis.document = document;
  try {
    const host = mk();
    host.id = 'ss-mv';
    document.body.appendChild(host);
    const back = _internals.peek(host, { app: { lang: 'en' } });
    assert.equal(host.hidden, true);
    assert.equal(host._attached, true);
    assert.match(back.textContent, /Back to the screening/);
    back.click();
    assert.equal(host.hidden, false);
    assert.equal(back._attached, false);
  } finally { globalThis.document = prior; }
});

/* --------------------------------------------------- what is already on file */

const { historyHtml, changeHtml } = _internals;

test('the first screening says so rather than showing an empty strip', () => {
  const state = setup({ report: report({ screening_id: 4 }),
                        history: { screenings: [{ id: 4, taken_on: '2026-09-14',
                                                  score: 78, screens: ['shoulder_flexion'] }] } });
  assert.match(historyHtml(state, 'en'), /starting point/);
});

test('earlier screenings are listed, this one is not listed as earlier', () => {
  const state = setup({ report: report({ screening_id: 4 }),
    history: { screenings: [
      { id: 4, taken_on: '2026-09-14', score: 78, screens: ['shoulder_flexion'] },
      { id: 1, taken_on: '2026-08-01', score: 61, screens: ['shoulder_flexion'] },
    ] } });
  const html = historyHtml(state, 'en');
  assert.match(html, /2026-08-01/);
  assert.ok(!/2026-09-14/.test(html), 'today is the report, not the history');
});

test('a withheld score is named, never plotted as zero', () => {
  const state = setup({ report: report({ screening_id: 9 }),
    history: { screenings: [
      { id: 1, taken_on: '2026-08-01', score: null, screens: ['knee_flexion'] }] } });
  const html = historyHtml(state, 'en');
  assert.match(html, /No score/);
  assert.ok(!/0\/100/.test(html));
});

test('nothing is drawn before the history has been fetched', () => {
  assert.equal(historyHtml(setup({ report: report() }), 'en'), '');
});

const CHANGE = {
  changes: [
    { screen: 'shoulder_flexion', side: 'left', before: 120, after: 150,
      unit: 'deg', comparable: true, reason: '', difference: 30,
      sentence: 'Shoulder flexion (left): 120° → 150° (30° further)',
      sentence_ko: '어깨 굽힘 (왼쪽): 120° → 150° (30° 더 멀리)' },
    { screen: 'knee_flexion', side: 'right', before: null, after: null,
      unit: 'deg', comparable: false, difference: null,
      reason: 'filmed from a different plane the second time',
      sentence: 'Knee flexion: not compared', sentence_ko: '무릎 굽힘: 비교 불가' },
  ],
  judgement: 'A joint that travelled further travelled further. Whether that is progress is a judgement for the person teaching.',
  judgement_ko: '더 멀리 움직였다는 것은 더 멀리 움직였다는 뜻입니다.',
};

test('the change against the last screening is shown', () => {
  const html = changeHtml(setup({ change: CHANGE }), 'en');
  assert.match(html, /120° → 150°/);
  assert.match(html, /30° further/);
});

test('a screen that cannot be compared says why instead of showing a number', () => {
  const html = changeHtml(setup({ change: CHANGE }), 'en');
  assert.match(html, /Not compared/);
  assert.match(html, /different plane/);
});

test('nothing calls a larger range an improvement', () => {
  const html = changeHtml(setup({ change: CHANGE }), 'en');
  assert.match(html, /judgement for the person teaching/);
  assert.ok(!/improve/i.test(html));
});

test('the comparison reads in Korean', () => {
  const html = changeHtml(setup({ change: CHANGE }), 'ko');
  assert.match(html, /어깨 굽힘/);
  assert.match(html, /더 멀리/);
});

test('no comparison draws nothing', () => {
  assert.equal(changeHtml(setup({ change: null }), 'en'), '');
});
