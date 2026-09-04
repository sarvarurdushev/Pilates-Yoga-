import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from '../vendor/three.module.js';
import { Rig } from '../src/rig.js';

/**
 * The rig the viewer runs has to be the rig the build measured.
 *
 * `scripts/parse_opensim.py` walks OpenSim's joint tree in numpy and fits the registration
 * against the result; `src/rig.js` rebuilds the same tree out of three.js Groups and is what
 * actually draws. Two implementations of one thing, and only one of them was ever checked.
 *
 * They disagreed. OpenSim expresses a joint in both bodies' frames, and getting from the
 * joint to the child body means undoing the child's offset frame — which carries a rotation
 * as well as a translation. The Python did that; the JavaScript applied the translation and
 * dropped the rotation. Fourteen of Rajagopal's joints have a non-zero child orientation:
 * both knees, both ankles, both feet, and every joint of both arms below the shoulder. The
 * wrist's is two right angles, which is why the hand hung a hand's length away from its own
 * wrist and swung about a pivot that was not there.
 *
 * `worldAtDefault` is the build's own answer for every segment, in the model's metres. This
 * asserts the viewer arrives at the same place.
 */
const rigJson = JSON.parse(readFileSync(new URL('../src/generated/rig.json', import.meta.url), 'utf8'));
const rig = new Rig(rigJson);
rig.captureBindPose();
rig.reset();
rig.root.updateMatrixWorld(true);

test('the viewer places every segment where the build measured it', () => {
  let worst = 0, who = '';
  for (const [name, seg] of Object.entries(rigJson.segments)) {
    assert.ok(Array.isArray(seg.worldAtDefault),
      `${name}: rig.json carries no worldAtDefault — re-run scripts/parse_opensim.py`);
    const got = new THREE.Vector3()
      .setFromMatrixPosition(rig.nodes.get(name).body.matrixWorld);
    // the build's answer is in OpenSim metres; the root carries the registration into body units
    const want = new THREE.Vector3(...seg.worldAtDefault).applyMatrix4(rig.root.matrixWorld);
    const d = got.distanceTo(want);
    if (d > worst) { worst = d; who = name; }
  }
  // a tenth of a millimetre on a body height of 1.0, which is float noise and nothing else
  assert.ok(worst < 1e-4,
    `${who} is ${(worst * 1000).toFixed(1)} mm from where the build put it`);
});

test('a joint whose child frame is rotated is still rotated in the viewer', () => {
  // the specific thing that was dropped, named so a regression cannot hide behind an average
  const rotated = Object.entries(rigJson.segments)
    .filter(([, s]) => (s.childOrientation ?? []).some(v => Math.abs(v) > 1e-6))
    .map(([n]) => n);
  assert.ok(rotated.includes('hand_r') && rotated.includes('tibia_r'),
    `expected the wrist and the knee among the rotated child frames, got ${rotated}`);
  for (const name of rotated) {
    const seg = rigJson.segments[name];
    const q = new THREE.Quaternion()
      .setFromEuler(new THREE.Euler(...seg.childOrientation, 'XYZ')).invert();
    const body = rig.nodes.get(name).body;
    assert.ok(body.quaternion.angleTo(q) < 1e-6,
      `${name}: the child frame's rotation is not undone on the body node`);
  }
});

test('the wrist sits at the wrist', () => {
  /* The visible symptom, measured. The rig's hand segment is its wrist; the body's carpal
   * bones are the wrist. If they are a forearm apart, every hand in the library swings from
   * the wrong place — which is exactly what it did. */
  const body = JSON.parse(readFileSync(
    new URL('../src/generated/structures.json', import.meta.url), 'utf8'));
  const carpal = body.structures.find(s => s.name === 'capitate');
  assert.ok(carpal?.perSide?.R, 'no capitate in the built body');
  const wrist = new THREE.Vector3()
    .setFromMatrixPosition(rig.nodes.get('hand_r').body.matrixWorld);
  const d = new THREE.Vector3(...carpal.perSide.R).distanceTo(wrist);
  assert.ok(d < 0.09, `the rig's right wrist is ${(d * 100).toFixed(1)}% of a body height ` +
    `from the capitate it should be sitting on`);
});
