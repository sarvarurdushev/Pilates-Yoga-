/**
 * Does the anatomy stay on the body when the body moves?
 *
 * Every other check in this project asks whether a *pose* is legal — joint ranges, contacts,
 * the floor, which actions a record may name. None of them asked whether the four hundred and
 * ninety-six structures hanging off the rig end up anywhere near where they belong, so a
 * build could be entirely green with the urinary bladder riding a thigh, the left transversus
 * abdominis riding a forearm, the right sacral plexus a hundred per cent bound to the right
 * radius, and every finger and toe bone welded to the chest.
 *
 * Two of those are invisible to the skinning bench by construction: a mesh riding one bone
 * rigidly does not stretch and does not lose volume, so it reports as perfect. What separates
 * them is where the structure ends up relative to its own skeleton, which is what
 * `tools/bindcheck.mjs` measures.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bindDrift, GAP_TOLERANCE } from '../tools/bindcheck.mjs';

/* Measured once — thirteen seconds over every clip in the library — and asserted on from
 * several angles below. */
const worst = bindDrift();
const over = [...worst.values()].filter(w => w.grew > GAP_TOLERANCE);

test('nothing leaves its own bones by more than a limb', () => {
  const gone = over.filter(w => w.grew > 0.12).map(w => `${w.name} ${w.grew.toFixed(2)} in ${w.key}`);
  assert.deepEqual(gone, [],
    'a structure this far from the skeleton it sits on is not attached to the right segment');
});

test('no organ is carried by a limb', () => {
  /* The pelvic viscera were homed on a femur because a segment's origin is the joint where it
   * meets its parent — the hip centre sits inside the pelvis, right beside the bladder — so
   * flexing a hip swung the bladder, the rectum, the urethra and both testes out of the body
   * with the thigh. An organ is rigid and belongs to the trunk, so unlike a muscle crossing a
   * joint it has no honest reason to move relative to its own bones at all. */
  const bad = [...worst.values()]
    .filter(w => w.layer === 'organs' && w.grew > 0.03)
    .map(w => `${w.name} ${w.grew.toFixed(2)} in ${w.key}`);
  assert.deepEqual(bad, [], 'an organ should not move relative to the skeleton around it');
});

test('a muscle slides along its bones, it does not leave them', () => {
  /* A broad muscle crossing a deep hip or shoulder genuinely slides a little against the bone
   * under it — the weights are geometric, not a soft-tissue simulation — so this is not zero.
   * What it bars is the failure that produced it: a whole structure riding a segment it is
   * not attached to, which is a limb's length, not a centimetre. */
  const bad = [...worst.values()]
    .filter(w => w.layer.startsWith('muscles') && w.grew > 0.12)
    .map(w => `${w.name} ${w.grew.toFixed(2)} in ${w.key}`);
  assert.deepEqual(bad, []);
});

test('the peripheral nerves follow the limbs they run down', () => {
  /* The femoral nerve was 87% bound to the torso and the right sacral plexus 100% bound to
   * the right forearm, because `spanOf` picks the pair of ends with the longest chain between
   * them and one spurious candidate therefore wins outright. Neither stretched. */
  const nerves = [...worst.values()].filter(w => /nerve|plexus/.test(w.name));
  assert.ok(nerves.length > 30, 'the nervous layer should be in the measurement at all');
  const adrift = nerves.filter(w => w.grew > 0.05).map(w => `${w.name} ${w.grew.toFixed(2)}`);
  assert.deepEqual(adrift, [], 'a nerve this far from its own bones has left the limb');
});

test('a mesh name survives the loader that renames it', async () => {
  /* `GLTFLoader` runs every node name through `PropertyBinding.sanitizeNodeName`, which turns
   * whitespace into underscores. Everything keyed by name — the rig's binding table, the
   * OpenSim attachment index, the bone field built from the skeleton — is keyed with spaces,
   * so in the browser every one of those lookups missed and returned null, silently. The
   * bone field came back empty, all 496 structures fell back to the joint-centre rule it
   * exists to replace, and the only symptom was an abdominal muscle drawn at the shoulder.
   * Every node tool reads the GLB directly, sees the spaces, and reports that it works. */
  const { meshName } = await import('../src/skin.js');
  const { readFileSync } = await import('node:fs');
  const rig = JSON.parse(readFileSync(new URL('../src/generated/rig.json', import.meta.url), 'utf8'));

  const sanitise = (n) => n.replace(/\s/g, '_');   // exactly what three does
  const missed = [];
  for (const key of Object.keys(rig.binding)) {
    const [base, side] = key.split('|');
    const [gotBase, gotSide] = meshName(`${sanitise(base)}|${side}`);
    if (gotBase !== base || gotSide !== side) missed.push(key);
  }
  assert.deepEqual(missed.slice(0, 5), [],
    `${missed.length} bones would not resolve once the loader has renamed them`);
  assert.ok(Object.keys(rig.binding).length > 200, 'the binding table should be the whole skeleton');
});

test('the whole body is measured, not a corner of it', () => {
  assert.ok(worst.size > 450, `only ${worst.size} structures were measured`);
});

test('a nerve stays roughly inside the flesh it runs through', async () => {
  /* Measured against the body's own voxel volume, at rest every nerve is inside it to within
   * one voxel. In a pose they can finish up further out — the sciatic nerve reaches 0.069 of
   * a body height in the plough — because a nerve is skinned by its own chain while the muscle
   * over it is skinned by another rule and moves out from under it.
   *
   * That is a known limit, not a free parameter, and the obvious fix is worse. Giving each
   * nerve vertex the weights of the flesh around it does close the gap — to 0.014 with the
   * nearest muscle vertex — and tears the tubes apart doing it, because two points a
   * millimetre apart along a nerve can have different nearest muscles on different bones:
   * 51x edge stretch, which draws a ribbon fanning off the shoulder. Smoothing the transfer
   * trades the two off one for one and beats the plain chain on neither. So this bar is the
   * measured state, and it is here to catch a regression, not to certify the number as good.
   */
  const { nerveOutside } = await import('../tools/bindcheck.mjs');
  const out = [...nerveOutside().values()].filter(w => w.gap > 0.08)
    .map(w => `${w.name} ${w.gap.toFixed(3)} in ${w.key}`);
  assert.deepEqual(out, [], 'a nerve this far outside the body is not inside anything');
});
