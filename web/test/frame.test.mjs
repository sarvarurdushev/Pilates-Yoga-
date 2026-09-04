import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FRAME, BODY_FRAME, BRAIN_TO_BODY, mni, bodyMm, bodyFromSource, brainToBody,
         bodyToBrain, mniToBody, brainPlacement } from '../src/frame.js';

/**
 * Frame bugs are silent, expensive and discovered late — a structure ends up in the wrong
 * place and nothing throws. These tests are the cheap version of finding that out.
 */

const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const vnear = (v, w, eps = 1e-9) =>
  near(v.x, w.x, eps) && near(v.y, w.y, eps) && near(v.z, w.z, eps);

test('brain frame keeps +X LEFT, +Y SUPERIOR, +Z ANTERIOR', () => {
  // MNI RAS is +x RIGHT, +y ANTERIOR, +z SUPERIOR; the canonical frame is none of those
  assert.ok(mni(40, 0, 0).x < mni(-40, 0, 0).x, 'MNI +x (right) must go to -X');
  assert.ok(mni(0, 0, 40).y > mni(0, 0, -40).y, 'MNI +z (superior) must go to +Y');
  assert.ok(mni(0, 40, 0).z > mni(0, -40, 0).z, 'MNI +y (anterior) must go to +Z');
});

test('brain frame is right-handed', () => {
  const o = mni(0, 0, 0);
  const ex = mni(-1, 0, 0).sub(o).normalize();   // +X
  const ey = mni(0, 0, 1).sub(o).normalize();    // +Y
  const ez = mni(0, 1, 0).sub(o).normalize();    // +Z
  assert.ok(vnear(new THREE.Vector3().crossVectors(ex, ey), ez, 1e-6), 'X x Y must equal Z');
});

test('body frame uses the same axis convention as the brain frame', () => {
  // BodyParts3D is LPS: +x LEFT, +y POSTERIOR, +z SUPERIOR
  assert.ok(bodyFromSource(40, 0, 0).x > bodyFromSource(-40, 0, 0).x, 'source +x is LEFT');
  assert.ok(bodyFromSource(0, 0, 40).y > bodyFromSource(0, 0, -40).y, 'source +z is SUPERIOR');
  assert.ok(bodyFromSource(0, 40, 0).z < bodyFromSource(0, -40, 0).z, 'source +y is POSTERIOR');
});

test('body frame is right-handed and metric', () => {
  const o = bodyMm(0, 0, 0);
  const ex = bodyMm(1, 0, 0).sub(o).normalize();
  const ey = bodyMm(0, 1, 0).sub(o).normalize();
  const ez = bodyMm(0, 0, 1).sub(o).normalize();
  assert.ok(vnear(new THREE.Vector3().crossVectors(ex, ey), ez, 1e-6));
  // one unit of the frame is one standing height; both constants are printed rounded, so
  // the product is 1 to within their precision rather than exactly
  assert.ok(Math.abs(bodyMm(0, BODY_FRAME.heightMm, 0).y - bodyMm(0, 0, 0).y - 1) < 1e-6);
});

test('the origin is the ASIS midpoint and the body spans it plausibly', () => {
  const o = bodyMm(...BODY_FRAME.center);
  assert.ok(vnear(o, new THREE.Vector3(0, 0, 0), 1e-9), 'centre must map to the origin');
  // sole at -0.553, vertex at +0.447: ASIS sits at 55.3% of stature, published ~57%
  assert.ok(BODY_FRAME.heightMm > 1500 && BODY_FRAME.heightMm < 1900,
    `standing height ${BODY_FRAME.heightMm} mm is not a plausible adult stature`);
});

test('brainToBody / bodyToBrain round-trip', () => {
  const pts = [
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0.5, -0.25, 0.375),
    mni(-42, 18, 6),      // left inferior frontal, a real published coordinate
    mni(26, -22, -14),     // right hippocampus
    mni(0, -52, -30),      // cerebellar vermis
  ];
  for (const p of pts) {
    const back = bodyToBrain(brainToBody(p));
    assert.ok(vnear(p, back, 1e-9), `${p.toArray()} did not round-trip: got ${back.toArray()}`);
  }
});

test('round-trip survives a non-identity rotation', () => {
  // the placeholder rotation is identity, which would hide an inverse-order bug
  const saved = BRAIN_TO_BODY.rotation;
  BRAIN_TO_BODY.rotation = [0.21, -0.37, 0.13];
  try {
    const p = new THREE.Vector3(0.31, -0.44, 0.19);
    assert.ok(vnear(p, bodyToBrain(brainToBody(p)), 1e-9));
  } finally {
    BRAIN_TO_BODY.rotation = saved;
  }
});

test('brainPlacement agrees with brainToBody', () => {
  // two ways to put the brain in the body: transform points, or transform the group.
  // If they ever disagree, labels and geometry drift apart and nothing errors.
  const obj = brainPlacement(new THREE.Object3D());
  obj.updateMatrixWorld(true);
  for (const p of [new THREE.Vector3(0.4, 0.1, -0.2), mni(-42, 18, 6)]) {
    const viaObject = obj.localToWorld(p.clone());
    assert.ok(vnear(viaObject, brainToBody(p), 1e-7),
      `placement ${viaObject.toArray()} != transform ${brainToBody(p).toArray()}`);
  }
});

test('a brain-frame unit length scales to the documented body fraction', () => {
  // FRAME normalises brain A-P length to 1.0, so the A-P span in body units is the scale
  const a = brainToBody(new THREE.Vector3(0, 0, -0.5));
  const b = brainToBody(new THREE.Vector3(0, 0, 0.5));
  assert.ok(near(a.distanceTo(b), BRAIN_TO_BODY.scale, 1e-12));
  // 0.0984 x 1655 mm = 163 mm of brain, which is an adult cerebrum
  const apMm = BRAIN_TO_BODY.scale * BODY_FRAME.heightMm;
  assert.ok(apMm > 140 && apMm < 200, `brain A-P length came out ${apMm.toFixed(0)} mm`);
});

test('the brain lands in the head, above the pelvis and near the midline', () => {
  // the cheapest possible catch for a frame sign error: a brain in the abdomen
  const c = brainToBody(new THREE.Vector3(0, 0, 0));
  assert.ok(c.y > 0.32 && c.y < 0.46, `brain centre at y=${c.y.toFixed(3)} is not in the head`);
  assert.ok(Math.abs(c.x) < 0.02, `brain centre off the midline at x=${c.x.toFixed(3)}`);
  // and the registration residual has to stay small enough to mean anything
  assert.ok(BRAIN_TO_BODY.residualMm.mean < 12,
    `landmark residual ${BRAIN_TO_BODY.residualMm.mean} mm is too large to trust`);
});

test('the brain is not mirrored by the transform', () => {
  // a reflection would swap the hemispheres silently; Umeyama guards it, this checks it
  const o = brainToBody(new THREE.Vector3(0, 0, 0));
  const ex = brainToBody(new THREE.Vector3(1, 0, 0)).sub(o);
  const ey = brainToBody(new THREE.Vector3(0, 1, 0)).sub(o);
  const ez = brainToBody(new THREE.Vector3(0, 0, 1)).sub(o);
  assert.ok(new THREE.Vector3().crossVectors(ex, ey).dot(ez) > 0, 'handedness flipped');
});

test('mniToBody composes mni() with brainToBody', () => {
  assert.ok(vnear(mniToBody(-42, 18, 6), brainToBody(mni(-42, 18, 6)), 1e-12));
});

test('the brain frame constants still match what build_cortex.py emitted', () => {
  // rebuilding the cortex from a different surface means re-emitting these two numbers;
  // changing them by hand silently moves every MNI coordinate
  assert.deepEqual(FRAME.center, [-0.56221, 16.373, -18.48715]);
  assert.equal(FRAME.scale, 0.00595122);
});

test('the frame constants are measured, and say so', () => {
  // These were anthropometric estimates until scripts/derive_frame.py ran against the real
  // meshes. Nothing may present an estimate to a user as a measurement, so the flag has to
  // stay honest in both directions: identity constants mean it was never derived.
  const isPlaceholder = BODY_FRAME.scale === 1 && BODY_FRAME.center.every(v => v === 0);
  assert.equal(BODY_FRAME.provisional, isPlaceholder);
  assert.equal(BODY_FRAME.provisional, false, 'run scripts/derive_frame.py --write');

  assert.equal(BRAIN_TO_BODY.provisional, false);
  assert.ok(BRAIN_TO_BODY.landmarks.length >= 4,
    'a similarity fit needs at least four landmark pairs to be stable');
  assert.ok(BRAIN_TO_BODY.residualMm.max < 25,
    'a landmark that far out usually means it resolved to the wrong structure');
});

/**
 * Which way is screen right?
 *
 * `frameFor` slides its target sideways so a subject sits in the middle of the stage the
 * console does not cover, and the sign of that slide is the whole trick: get it backwards and
 * the figure moves *further* under the glass, which looks like a framing bug rather than a
 * sign error. The derivation is short — three's `lookAt` puts the camera's +Z along the
 * direction from target to camera, its +X at cross(up, +Z), and a camera's +X is screen right,
 * which is the same cross product `frameFor` takes — but a derivation is not a measurement, so
 * this projects a point and looks.
 */
test('frameFor\'s right is screen right, so a positive target shift moves the subject left', () => {
  const cam = new THREE.PerspectiveCamera(32, 1.6, 0.01, 100);
  const target = new THREE.Vector3(0, 0.4, 0);
  const dir = new THREE.Vector3(0.31, 0.06, 0.25).normalize();   // the head view's own vantage
  cam.position.copy(target).addScaledVector(dir, 1);
  cam.lookAt(target);
  cam.updateMatrixWorld(true);

  // the basis frameFor builds
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir).normalize();

  const at = p => p.clone().project(cam).x;
  // a point displaced along `right` must land to the right of the target on screen
  const off = target.clone().addScaledVector(right, 0.05);
  assert.ok(at(off) > at(target) + 1e-6,
    'frameFor\'s `right` is not screen right; RIGHT_ON_SCREEN in main.js has the wrong sign');

  /* And therefore: shifting the *target* along `right` slides the subject the other way.
   * This is the step that actually re-centres the figure, so it is asserted rather than
   * left as an implication of the line above. */
  const shifted = target.clone().addScaledVector(right, 0.05);
  const cam2 = cam.clone();
  cam2.position.copy(shifted).addScaledVector(dir, 1);
  cam2.lookAt(shifted);
  cam2.updateMatrixWorld(true);
  assert.ok(target.clone().project(cam2).x < 0,
    'shifting the target along `right` should move a fixed subject left of centre');
});
