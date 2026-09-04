/**
 * The browser side of the bridge, tested without a browser.
 *
 * `tools/check_viewer.mjs` runs the adapter against the real anatomy model and
 * a real bundle; that catches a rename on either side. These tests catch the
 * things a real pair of files happens not to contain -- a hand-edited bundle,
 * a structure the model does not have, a bilateral id list -- and they run with
 * nothing installed:
 *
 *   node --test viewer/test/*.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { apply, check, legend, load, resolve, restore, rows, InvalidBundle }
  from '../bundle.js';

const SCHEME = { measured_band: [0.7, 1.0], reference_level: 0.3, unlit: 0,
                 note: 'not an activation percentage',
                 scale: { from: 'hip flexors peak moment', value: 24, unit: 'Nm' } };

const measured = (name, over = {}) => ({
  fma: ['FMA22342'], name, layer: 'muscles_deep', tier: 'measured', level: 1.0,
  because: 'the hip flexors carried up to 24 Nm', plain: 'it worked hard',
  value: 24, unit: 'Nm', from: 'hip flexors peak moment', ...over,
});
const reference = (name, over = {}) => ({
  fma: '', name, layer: 'nervous', tier: 'reference', level: 0.3,
  because: 'supplies a muscle that was measured', plain: 'it feeds one', ...over,
});
const bundleOf = (structures) => ({
  format: 'pilates-session-bundle', version: 1,
  person: { username: 'anna', display_name: 'Anna Smith' },
  session: { key: 's1', date: '2026-03-03' },
  lighting: SCHEME, structures,
});

/** The registry's shape, as this adapter uses it. */
function registryOf(records) {
  const byId = new Map(), byName = new Map();
  for (const rec of records) { byId.set(rec.id, rec); byName.set(rec.key, rec); }
  return { byId, byName };
}
class StubPalette {
  constructor() { this.alpha = new Map(); this.cleared = 0; }
  clearActivation() { this.alpha.clear(); this.cleared++; return this; }
  setActivation(id, v) { this.alpha.set(id, v); return this; }
  getActivation(id) { return this.alpha.get(id) ?? 0; }
}

const MODEL = registryOf([
  { id: 7, key: 'psoas major', fma: ['FMA22342', 'FMA22343'] },
  { id: 9, key: 'femoral nerve', fma: [] },
  { id: 11, key: 'renamed since', fma: ['FMA24474'] },
]);

test('a bundle it has never seen is checked before it is trusted', () => {
  assert.throws(() => load({ format: 'something else' }), InvalidBundle);
});

test('an untiered value is refused rather than defaulted', () => {
  const problems = check(bundleOf([measured('psoas major', { tier: 'guessed' })]));
  assert.ok(problems.some((p) => p.includes('neither')));
});

test('a reference structure carrying a value is refused', () => {
  /* It would print as a measurement of that structure, which is the inference
   * the whole bridge exists to refuse. */
  const problems = check(bundleOf([reference('femoral nerve', { value: 3 })]));
  assert.ok(problems.some((p) => p.includes('print as a measurement')));
});

test('a measured structure lit at the reference level is refused', () => {
  const problems = check(bundleOf([measured('psoas major', { level: 0.3 })]));
  assert.ok(problems.some((p) => p.includes('outside')));
});

test('a reference structure lit off the flat level is refused', () => {
  /* A gradient across reference structures is an amount nothing measured. */
  const problems = check(bundleOf([reference('femoral nerve', { level: 0.55 })]));
  assert.ok(problems.some((p) => p.includes('not the flat')));
});

test('overlapping bands are refused: the tiers would look alike', () => {
  const bundle = bundleOf([measured('psoas major')]);
  bundle.lighting = { ...SCHEME, reference_level: 0.85 };
  assert.ok(check(bundle).some((p) => p.includes('look alike')));
});

test('a structure with only the technical sentence is refused', () => {
  const problems = check(bundleOf([measured('psoas major', { plain: '' })]));
  assert.ok(problems.some((p) => p.includes('plain-words')));
});

test('a bilateral structure is found by either of its ids', () => {
  /* The model holds one mesh per bilateral muscle with an id per side. The
   * first version compared a string against that array, matched nothing, and
   * fell through to name matching for everything -- silently, because the
   * picture looked identical. */
  assert.equal(resolve(MODEL, { fma: ['FMA22343'], name: 'nope' }).record.id, 7);
  assert.equal(resolve(MODEL, { fma: ['FMA22342'], name: 'nope' }).via, 'fma');
});

test('the ontology id wins over the name, so a rename does not break the link', () => {
  const found = resolve(MODEL, { fma: ['FMA24474'], name: 'femur' });
  assert.equal(found.record.id, 11);
  assert.equal(found.via, 'fma');
});

test('a structure with no id falls back to its name, and says it did', () => {
  assert.equal(resolve(MODEL, { fma: '', name: 'femoral nerve' }).via, 'name');
});

test('a structure the model does not have is reported, never skipped', () => {
  /* A silently missing muscle looks exactly like a muscle that was not
   * measured. */
  const palette = new StubPalette();
  const result = apply(load(bundleOf([measured('psoas major'),
                                      reference('vagus nerve')])),
                       { registry: MODEL, palette });
  assert.equal(result.missing.length, 1);
  assert.equal(result.missing[0].name, 'vagus nerve');
});

test('the palette is cleared first, so roles and measurements never mix', () => {
  const palette = new StubPalette();
  palette.setActivation(7, 0.62);                 // an authored role, from before
  apply(load(bundleOf([measured('psoas major')])), { registry: MODEL, palette });
  assert.equal(palette.cleared, 1);
  assert.equal(palette.getActivation(7), 1.0);
});

test('what the bundle says is what the palette holds', () => {
  const palette = new StubPalette();
  apply(load(bundleOf([measured('psoas major', { level: 0.83 }),
                       reference('femoral nerve')])),
        { registry: MODEL, palette });
  assert.equal(palette.getActivation(7), 0.83);
  assert.equal(palette.getActivation(9), 0.3);
});

test('a layer filter leaves everything else untouched', () => {
  const palette = new StubPalette();
  const result = apply(load(bundleOf([measured('psoas major'),
                                      reference('femoral nerve')])),
                       { registry: MODEL, palette },
                       { layers: ['muscles_deep'] });
  assert.deepEqual(result.lit.map((s) => s.name), ['psoas major']);
  assert.equal(palette.getActivation(9), 0);
});

test('leaving a session puts back exactly the roles that were there', () => {
  const palette = new StubPalette();
  apply(load(bundleOf([measured('psoas major')])), { registry: MODEL, palette });
  restore(palette, new Map([[7, 'synergists']]),
          { prime: 1.0, synergists: 0.62, stabilisers: 0.34 });
  assert.equal(palette.getActivation(7), 0.62);
});

test('only a measured row carries a number and a date', () => {
  const out = rows(load(bundleOf([measured('psoas major'),
                                  reference('femoral nerve')])));
  const byName = Object.fromEntries(out.map((r) => [r.name, r]));
  assert.equal(byName['psoas major'].number, '24 Nm');
  assert.equal(byName['psoas major'].when, '2026-03-03');
  assert.equal(byName['femoral nerve'].number, '');
  assert.equal(byName['femoral nerve'].when, '');
});

test('every row arrives in both registers', () => {
  for (const row of rows(load(bundleOf([measured('psoas major'),
                                        reference('femoral nerve')])))) {
    assert.ok(row.plain && row.because);
  }
});

test('the legend has three states and only one of them may print a number', () => {
  const bands = legend(load(bundleOf([measured('psoas major')])));
  assert.equal(bands.length, 3);
  assert.deepEqual(bands.map((b) => b.carriesNumber), [true, false, false]);
});

test('unlit is explained as unmeasured, not as zero effort', () => {
  const unlit = legend(load(bundleOf([measured('psoas major')])))[2];
  assert.match(unlit.note, /no measurement/);
});

test('the legend repeats the file\'s own note rather than writing its own', () => {
  const measuredBand = legend(load(bundleOf([measured('psoas major')])))[0];
  assert.match(measuredBand.note, /not an activation percentage/);
});
