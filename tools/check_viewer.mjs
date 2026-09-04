/**
 * Run the bundle adapter against the real anatomy model, and report the join.
 *
 * `pilates bridge` checks the mapping table from the Python side, against an
 * export. This checks the other half: that `viewer/bundle.js` can actually turn
 * the structures in a real bundle into ids the real registry hands back, and
 * that what lands in the palette says what the bundle meant.
 *
 * It builds the registry from the anatomy project's own `structures.js`, so a
 * rename on either side shows up here as a structure that cannot be resolved
 * rather than as a muscle that quietly stops lighting. The palette is a stub
 * with the same three methods -- the real one needs a WebGL texture and this
 * has to run in a terminal -- so what is proved is the join and the levels,
 * not the rendering.
 *
 * Nothing is written to the anatomy project. It is read, the way it always is.
 *
 *   node tools/check_viewer.mjs /path/to/neuro_wellness bundle.json
 */
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve as resolvePath } from 'node:path';

import { load, apply, legend, rows, MEASURED, REFERENCE }
  from '../viewer/bundle.js';

const [repo, bundlePath] = process.argv.slice(2);
if (!repo || !bundlePath) {
  console.error('usage: node tools/check_viewer.mjs <neuro_wellness> <bundle.json>');
  process.exit(2);
}

// The anatomy project resolves `three` through the import map in its own
// index.html. Node needs to be told the same thing before anything is loaded.
register('./importmap-hook.mjs', import.meta.url, { data: resolvePath(repo) });

const { buildRegistry } = await import(
  pathToFileURL(resolvePath(repo, 'src/structures.js')).href);
const generated = JSON.parse(
  readFileSync(resolvePath(repo, 'src/generated/structures.json'), 'utf8'));
const registry = buildRegistry(generated);

/** The palette's contract, as three methods and an array. */
class StubPalette {
  constructor() { this.alpha = new Map(); this.cleared = 0; }
  clearActivation() { this.alpha.clear(); this.cleared++; return this; }
  setActivation(id, v) { this.alpha.set(id, v); return this; }
  getActivation(id) { return this.alpha.get(id) ?? 0; }
}

const session = load(JSON.parse(readFileSync(bundlePath, 'utf8')));
const palette = new StubPalette();
const { lit, missing, byName } = apply(session, { registry, palette });

const person = session.person.display_name || session.person.username;
console.log(`${bundlePath}: ${person}, ${session.session.key} `
          + `(${session.session.date})`);
console.log(`  ${lit.length} structure(s) lit, ${missing.length} unresolved, `
          + `${byName} matched by name alone`);

let bad = 0;
const fail = (msg) => { bad++; console.log(`  BROKEN  ${msg}`); };

for (const s of missing) {
  fail(`${s.name}${s.fma ? ` (${s.fma})` : ''} is in the bundle and not in the `
     + `model: it would silently stop lighting`);
}

/* The palette is the thing a reader actually sees, so check it rather than the
 * return value: a level that never reached the texture is a structure that
 * looks unmeasured. */
const scheme = session.lighting;
const [floor, ceiling] = scheme.measured_band;
for (const s of lit) {
  const got = palette.getActivation(s.id);
  if (got !== s.level) fail(`${s.name}: bundle says ${s.level}, palette holds ${got}`);
  if (s.tier === MEASURED && (got < floor || got > ceiling)) {
    fail(`${s.name}: measured, lit at ${got}, outside ${floor}-${ceiling}`);
  }
  if (s.tier === REFERENCE && got !== scheme.reference_level) {
    fail(`${s.name}: reference, lit at ${got}, not ${scheme.reference_level}`);
  }
}
if (palette.cleared !== 1) {
  fail(`the palette was cleared ${palette.cleared} time(s); a session that does `
     + `not take the channel over would blend measured levels with authored roles`);
}

/* Every member of a measured group has to share its level. The measurement is
 * of the joint; a picture that ranked the muscles within a group would be
 * inventing the ranking. */
const byGroup = new Map();
for (const s of lit.filter((s) => s.tier === MEASURED)) {
  const key = s.from ?? '';
  if (!byGroup.has(key)) byGroup.set(key, []);
  byGroup.get(key).push(s);
}
for (const [group, members] of byGroup) {
  const levels = new Set(members.map((m) => m.level));
  if (levels.size > 1) {
    fail(`${group}: its ${members.length} muscles are lit at `
       + `${[...levels].join(', ')} -- the measurement cannot tell them apart`);
  }
}

/* And nothing at reference tier may print a figure. */
for (const row of rows(session)) {
  if (row.tier === REFERENCE && row.number) {
    fail(`${row.name}: a reference row carrying "${row.number}"`);
  }
}

const measured = lit.filter((s) => s.tier === MEASURED);
const viaFma = lit.filter((s) => s.via === 'fma').length;
console.log(`  ${measured.length} measured, ${lit.length - measured.length} reference; `
          + `${viaFma} joined by FMA id, ${byName} by name`);
if (byName) {
  const names = lit.filter((s) => s.via === 'name').map((s) => s.name);
  console.log(`  matched by name, so a rename breaks them silently: `
            + `${names.join(', ')}`);
}
for (const band of legend(session)) {
  console.log(`  legend: ${band.label} @ ${band.level}`
            + `${band.carriesNumber ? ' + a number' : ''}`);
}

console.log(bad ? `\n${bad} problem(s).` : '\nNo problems.');
process.exit(bad ? 1 : 0);
