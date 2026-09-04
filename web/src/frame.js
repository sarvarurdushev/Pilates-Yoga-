/**
 * Canonical frame shared by every file here.
 *   +X = LEFT   +Y = SUPERIOR   +Z = ANTERIOR    (right-handed)
 *
 * Two frames use that one axis convention, and the convention is the part that must never
 * change — every file in the project assumes it.
 *
 *   FRAME       the brain frame. Origin at the cortex centroid, A-P length of the brain
 *               normalised to 1.0. Emitted by scripts/build_cortex.py from the fsaverage
 *               surface it built the cortex from, so MNI coordinates land in exactly the
 *               right place relative to the real cortex. Do not touch it.
 *
 *   BODY_FRAME  the body frame. Origin at the midpoint of the two ASIS (anterior superior
 *               iliac spines), standing height normalised to 1.0. A brain-sized normalisation
 *               is useless for a body, and a body-sized one would move every published MNI
 *               coordinate, so the two coexist and BRAIN_TO_BODY carries points between them.
 */
import * as THREE from 'three';
import { activeBody, activeBodyId, BODIES, DEFAULT_BODY } from './bodies.js';

export const FRAME = { center: [-0.56221, 16.373, -18.48715], scale: 0.00595122 };

/** MNI152/fsaverage RAS millimetres -> brain-frame units. */
export function mni(x, y, z) {
  const [cx, cy, cz] = FRAME.center, s = FRAME.scale;
  return new THREE.Vector3((-x - cx) * s, (z - cy) * s, (y - cz) * s);
}

/* ------------------------------------------------------------------ the body frame */

/**
 * The active body's frame. Origin at the ASIS midpoint, standing height = 1.0, so y = 0 is
 * the pelvis, y ≈ +0.447 the vertex and y ≈ −0.553 the floor.
 *
 * **The numbers live with the body, in `bodies.js`, not here.** They are measured from one
 * scanned person by `scripts/derive_frame.py` and are meaningless applied to anyone else, so
 * the moment there can be two bodies they stop being a constant of the app and become a
 * property of whichever body is loaded. The axis convention above is the part that is
 * universal; the origin and the scale are not.
 */
export const BODY_FRAME = (activeBody().frame ?? BODIES[DEFAULT_BODY].frame);

/** Canonical millimetres (+X LEFT, +Y SUPERIOR, +Z ANTERIOR) -> body-frame units. */
export function bodyMm(X, Y, Z) {
  if (!BODY_FRAME.center)
    throw new Error(`the ${activeBodyId()} body is derived from ${BODY_FRAME.derivedFrom}, ` +
      `so it has no source archive and no millimetres to convert from`);
  const [cx, cy, cz] = BODY_FRAME.center, s = BODY_FRAME.scale;
  return new THREE.Vector3((X - cx) * s, (Y - cy) * s, (Z - cz) * s);
}

/**
 * BodyParts3D archive millimetres -> body-frame units. The counterpart of mni().
 *
 * The archive is LPS: +x LEFT, +y POSTERIOR, +z SUPERIOR. That is measured rather than
 * assumed — the left hip bone sits at +x, the eyeballs at the top of z, and the face at
 * the *negative* end of y. Both LPS and this project's (LEFT, SUPERIOR, ANTERIOR) are
 * right-handed, so the conversion is an axis permutation with one sign flip and no
 * reflection.
 */
export function bodyFromSource(x, y, z) {
  return bodyMm(x, z, -y);
}

/* -------------------------------------------------- brain <-> body, one similarity */

/**
 * Similarity transform (uniform scale + rotation + translation, no shear) taking a point in
 * FRAME to the same point in BODY_FRAME.
 *
 * Fitted per body, and therefore kept with the body — see `bodies.js` for the male fit, the
 * ten landmark structures it was solved against and what its residual means. A body with no
 * brain fit of its own has no business borrowing another's: the pitch in this transform is
 * the angle between fsaverage's AC-PC alignment and *one subject's* head posture.
 */
export const BRAIN_TO_BODY = (activeBody().brainToBody ?? BODIES[DEFAULT_BODY].brainToBody);

const _q = new THREE.Quaternion();
const _qi = new THREE.Quaternion();
function quat() {
  return _q.setFromEuler(new THREE.Euler(...BRAIN_TO_BODY.rotation, 'XYZ'));
}

/** Brain-frame point -> body-frame point. */
export function brainToBody(v, target = new THREE.Vector3()) {
  const { scale, translation } = BRAIN_TO_BODY;
  return target.copy(v)
    .applyQuaternion(quat())
    .multiplyScalar(scale)
    .add(new THREE.Vector3(...translation));
}

/** Body-frame point -> brain-frame point. Exact inverse of brainToBody. */
export function bodyToBrain(v, target = new THREE.Vector3()) {
  const { scale, translation } = BRAIN_TO_BODY;
  _qi.copy(quat()).invert();
  return target.copy(v)
    .sub(new THREE.Vector3(...translation))
    .divideScalar(scale)
    .applyQuaternion(_qi);
}

/** Published MNI millimetres straight into the body frame. */
export function mniToBody(x, y, z) {
  return brainToBody(mni(x, y, z));
}

/** Object3D transform that drops the brain group into a body-frame scene. */
export function brainPlacement(obj) {
  const { scale, rotation, translation } = BRAIN_TO_BODY;
  obj.position.set(...translation);
  obj.rotation.set(...rotation, 'XYZ');
  obj.scale.setScalar(scale);
  return obj;
}
