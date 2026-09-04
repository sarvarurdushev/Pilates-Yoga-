/**
 * The body registry.
 *
 * A body is six generated artefacts fitted to one scanned person, plus the provenance that
 * says who that person was. Both halves are load-bearing: the artefacts because the app
 * cannot draw without them, and the provenance because the first of the four lines that must
 * not move is *about the body*, and a body with no subject description would render a
 * disclaimer that says nothing.
 *
 * There is one body again. The registry stays because the app reads its asset paths, its
 * licence and its subject line from it, and because the sentences the first disclaimer is
 * composed from are facts about a scanned person rather than about the app.
 *
 * The sharpest test here is the last one: the male body's frame constants must be exactly what
 * they were before they moved out of `frame.js`. Moving measured numbers between files is
 * precisely the kind of change that silently shifts a model by a millimetre, and the only
 * defence is to pin them.
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BODIES, DEFAULT_BODY, activeBodyId, activeBody, availableBodies,
         templateDisclaimer, bodyHref, layerUrl } from '../src/bodies.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const LANGS = ['en', 'ko'];

test('every body describes who was scanned, in both languages', () => {
  for (const [key, b] of Object.entries(BODIES)) {
    assert.equal(b.id, key, `${key}: id does not match its key`);
    for (const lang of LANGS) {
      assert.ok(b.name?.[lang]?.length, `${key}: no ${lang} name`);
      /* Not decoration. The template disclaimer is composed from this, so a body without a
       * subject line renders "One male template body, not yours." and then says nothing at
       * all about who that male was. */
      assert.ok(b.subject?.[lang]?.length > 20, `${key}: no ${lang} subject description`);
    }
  }
});

test('every body names its source and its licence', () => {
  for (const [key, b] of Object.entries(BODIES)) {
    for (const f of ['source', 'sourceUrl', 'licence', 'attribution', 'citation'])
      assert.ok(b[f]?.length, `${key}: missing ${f}`);
    assert.match(b.sourceUrl, /^https:\/\//, `${key}: sourceUrl is not a URL`);
  }
});

test('a body that cannot be loaded says why', () => {
  for (const [key, b] of Object.entries(BODIES)) {
    if (b.available) continue;
    for (const lang of LANGS)
      assert.ok(b.blockedBy?.[lang]?.length, `${key}: unavailable with no ${lang} reason`);
  }
});

test('every available body has the artefacts it claims', () => {
  const avail = availableBodies();
  assert.ok(avail.length >= 1, 'no body is available at all');
  for (const id of avail) {
    const b = BODIES[id];
    assert.ok(b.frame, `${id}: available with no body frame`);
    /* No brain fit is allowed — a body must never borrow another's, because that transform
     * encodes one subject's head posture. It just means no brain layer on this body. */
    if (b.brainToBody) assert.ok(b.brainToBody.scale > 0, `${id}: brain fit has no scale`);
    assert.ok(b.assets.layers.length, `${id}: available with no layers`);
    /* A body may have no rig — it is then a body to look at rather than one to move, and
     * `motion: false` is what says so. What it may not do is claim a file it does not have. */
    for (const p of [b.assets.structures, b.assets.rig, b.assets.musclePaths]) {
      if (p == null) continue;
      assert.ok(existsSync(ROOT + p), `${id}: ${p} does not exist`);
    }
    if (!b.assets.rig)
      assert.equal(b.motion, false, `${id}: no rig, so motion must be declared false`);
    if (b.motion === false)
      for (const lang of LANGS)
        assert.ok(b.noMotion?.[lang]?.length, `${id}: motion is off with no ${lang} reason`);
    for (const name of b.assets.layers)
      assert.ok(existsSync(ROOT + layerUrl(b, name)), `${id}: ${layerUrl(b, name)} does not exist`);
    if (b.assets.shell)
      assert.ok(existsSync(ROOT + b.assets.shell), `${id}: ${b.assets.shell} does not exist`);
  }
});

test('a frame is measured for one body and never shared', () => {
  const seen = new Map();
  for (const [key, b] of Object.entries(BODIES)) {
    if (!b.frame) continue;
    if (b.frame.center === null) {
      /* A derived body has no source archive to convert from, so it has no centre and no
       * scale — and it has to say what it was derived from. Filling those in with the
       * parent's numbers would be a claim no test could catch. */
      assert.equal(b.frame.scale, null, `${key}: half a source frame is worse than none`);
      assert.ok(BODIES[b.frame.derivedFrom],
        `${key}: no source frame and no derivedFrom naming a body it came from`);
      assert.ok(b.frame.heightMm > 1000, `${key}: a derived body still needs its own stature`);
      continue;
    }
    const sig = JSON.stringify([b.frame.center, b.frame.scale]);
    assert.ok(!seen.has(sig),
      `${key} and ${seen.get(sig)} share a body frame — it is measured from one person's ` +
      `own skin mesh and hip bones, so two bodies cannot honestly have the same one`);
    seen.set(sig, key);
    assert.equal(b.frame.landmark, 'ASIS midpoint');
    assert.equal(b.frame.unit, 'standing height = 1.0');
    assert.ok(b.frame.heightMm > 1000 && b.frame.heightMm < 2200,
      `${key}: stature ${b.frame.heightMm} mm is not a human being`);
  }
});

test('the active body is one that can actually be loaded', () => {
  const id = activeBodyId();
  assert.ok(BODIES[id]?.available, `active body "${id}" is not available`);
  assert.equal(activeBody().id, id);
  assert.ok(BODIES[DEFAULT_BODY]?.available, 'the default body is not available');
});

test('the template disclaimer is composed for the body that is loaded', () => {
  for (const b of Object.values(BODIES))
    for (const lang of LANGS) {
      const d = templateDisclaimer(b, lang, { body: 'BASE.' });
      assert.ok(d.title.length, `${b.id}/${lang}: no title`);
      assert.ok(d.body.includes('BASE.'), `${b.id}/${lang}: dropped the universal half`);
      assert.ok(d.body.includes(b.subject[lang]), `${b.id}/${lang}: does not say who was scanned`);
      if (b.bounds) assert.ok(d.body.includes(b.bounds[lang]),
        `${b.id}/${lang}: a partial body's disclaimer does not state its bounds`);
      // and it must name the body, or a female body carries a male body's line
      const sex = b.name[lang];
      assert.ok(d.title.includes(lang === 'en' ? sex.toLowerCase() : sex),
        `${b.id}/${lang}: title "${d.title}" does not name the body`);
    }
});

test('switching body is a link, and the default body carries no parameter', () => {
  assert.equal(bodyHref(DEFAULT_BODY), `?body=${DEFAULT_BODY}`);   // no DOM: the bare form
});

test('the male body frame is exactly what it was before it moved out of frame.js', () => {
  /* Pinned. These are measured by `scripts/derive_frame.py` from one person's skin mesh and
   * hip bones, and every structure, every joint centre and the whole brain-to-body fit are
   * expressed in them. A file move must not perturb them by a float. */
  const m = BODIES.male;
  assert.deepEqual(m.frame.center, [1.7805, 902.37, 152.115]);
  assert.equal(m.frame.scale, 0.000604146195);
  assert.equal(m.frame.heightMm, 1655.23);
  assert.equal(m.brainToBody.scale, 0.0984331345);
  assert.deepEqual(m.brainToBody.rotation, [-0.27194, 0.00676966, -0.0488966]);
  assert.deepEqual(m.brainToBody.translation, [-0.00179225, 0.404775, -0.0410048]);
  assert.equal(m.brainToBody.landmarks.length, 10);
});
