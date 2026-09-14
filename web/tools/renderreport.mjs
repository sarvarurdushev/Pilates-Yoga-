/**
 * Draw a report to a file, so it can be looked at.
 *
 * The posture and screening reports are the two pages this project is judged
 * on, and until this existed the only way to see either was to run a studio
 * server, sign in, and upload four photographs -- so they were changed by
 * reading the markup and hoping. Three faults shipped that way: a label
 * clipped to "ad and neck", a body drawn over an empty frame with the words
 * "photograph not supplied" across it, and the substance of the report laid
 * out in a 260px ribbon beside a column twice its width. Every one of them
 * passed the tests.
 *
 *   node tools/renderreport.mjs posture en
 *   node tools/renderreport.mjs movement ko
 *
 * Writes .render/<page>-<lang>.html. Pair it with tools/shot.mjs for a
 * picture. The payload comes from tools/reportfixture.py and
 * tools/screenfixture.py, which build one the way the server does.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = join(HERE, '..');
const RENDER = join(WEB, '.render');

const PAGES = {
  posture: { module: '../src/session/posture.js', host: 'ss-pos',
             fixture: 'reportfixture.py', json: 'report.json' },
  movement: { module: '../src/session/movement.js', host: 'ss-mv',
              fixture: 'screenfixture.py', json: 'screening.json' },
};

const page = process.argv[2] ?? 'posture';
const lang = process.argv[3] ?? 'en';
const spec = PAGES[page];
if (!spec) {
  console.error(`no such page: ${page}. Try: ${Object.keys(PAGES).join(', ')}`);
  process.exit(2);
}

mkdirSync(RENDER, { recursive: true });
const jsonPath = join(RENDER, spec.json);
execFileSync('python3', [join(HERE, spec.fixture), jsonPath],
             { stdio: 'inherit' });
const report = JSON.parse(readFileSync(jsonPath, 'utf8'));

const { _internals } = await import(spec.module);

/* Enough history for the strip and the trend to have something to draw. A
   report with one assessment on file hides both, which is the state least
   worth looking at. */
const filed = page === 'posture'
  ? { assessments: [
      { id: 7, taken_on: '2026-09-14', made_at: '2026-09-14T09:00',
        score: report.score?.value, band: report.score?.band,
        views: Object.keys(report.landmarks ?? {}) },
      { id: 4, taken_on: '2026-08-01', made_at: '2026-08-01T09:00', score: 74,
        band: 'Fair', views: ['front', 'side_left', 'side_right', 'rear'] },
      { id: 1, taken_on: '2026-06-15', made_at: '2026-06-15T09:00', score: 61,
        band: 'Fair', views: ['front', 'rear'] }],
    trend: [{ id: 1, on: '2026-06-15', score: 61, band: 'Fair' },
            { id: 4, on: '2026-08-01', score: 74, band: 'Fair' },
            { id: 7, on: '2026-09-14', score: report.score?.value,
              band: report.score?.band }] }
  : { screenings: [
      { id: 3, taken_on: '2026-09-14', score: report.overall_score,
        screens: report.attempted ?? [] },
      { id: 1, taken_on: '2026-08-01', score: 64,
        screens: ['shoulder_flexion'] }] };

const state = {
  report, photos: new Map(), taken: '2026-09-14', who: 'Kim Jihyun',
  history: filed, change: null, clips: new Map(),
  catalogue: _internals.CATALOGUE ?? [], chosen: 'shoulder_flexion',
};

const src = readFileSync(join(WEB, spec.module.replace('../', '')), 'utf8');
const style = src.split('const STYLE = `')[1].split('\n`;')[0];
const body = _internals.reportHtml(state, lang, () => ({ can: {} }));

const out = join(RENDER, `${page}-${lang}.html`);
writeFileSync(out, `<!doctype html><meta charset="utf-8">
<title>${page} report</title><style>
/* The application's own tokens, which this page normally inherits. */
:root{--txt:#dbe6f2;--dim:#93a7bc;--dim2:#6d8298;--line:#1b2733;
  --line2:#27384a;--acc:#5aa9e6;--glass:rgba(255,255,255,.03)}
body{margin:0;background:#04070c;
  font:14px system-ui,-apple-system,'Segoe UI',sans-serif}
${style}
/* Normally fixed over the application; here it is the whole document. */
#${spec.host}{position:static}
</style>
<div id="${spec.host}">${body}</div>`);
console.log(`wrote .render/${page}-${lang}.html`);
