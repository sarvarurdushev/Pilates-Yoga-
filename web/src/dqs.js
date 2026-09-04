/**
 * Dual quaternion skinning: the same weights, blended so a muscle keeps its volume.
 *
 * The weights themselves are right — one smoothstep per joint the muscle crosses, over the
 * signed distance along that joint's own axis, smoothed over the mesh's surface — and the
 * meshes are closed. What was left was the blend. Linear blend
 * skinning averages the bone *matrices*, and averaging two rotations component-wise does not
 * give a rotation: it gives a shrinking transform that pulls a vertex toward the chord
 * between the two poses instead of round the arc. Halfway across a joint the shortfall is
 * largest, so a broad muscle crossing a joint is squeezed flat exactly through its belly —
 * the sheets that appear off a chest or a hip the moment the limb moves.
 *
 * Measured on this model: at the deep hip, iliacus came out at 0.53 of its own volume, the
 * pelvic floor at 0.54, gluteus medius at 0.60; in a down dog the inguinal ligament fell to
 * 0.33 and gluteus maximus to 0.37. A third of the muscle simply disappearing is not a
 * lighting problem, and no amount of weight smoothing reaches it.
 *
 * A dual quaternion carries a rotation and a translation together, and blending them
 * normalised interpolates *along* the arc. Volume is preserved to within a per cent or two.
 * The cost is one small float texture per frame — one rotation and one translation per bone,
 * about seventy of each — and a few extra instructions per vertex.
 *
 * **Two copies of the blend exist and they must agree.** `GLSL` below is what the GPU runs;
 * `skinPoint` is the same arithmetic in JavaScript, and it is what `tools/appshots.mjs`
 * measures and what `test/skin.test.mjs` asserts on. Change one and you must change the
 * other, or the number the tools report stops describing the picture on screen.
 */
import * as THREE from 'three';

/* Working values, reused: this runs once per bone per frame. */
const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();

/**
 * One float texture holding every bone's current dual quaternion.
 *
 * Layout is two RGBA texels per bone, side by side in a single row: the real part (the
 * rotation, as a quaternion) then the dual part (the translation, folded into the same
 * algebra). `texelFetch` reads them by integer index, so there is no filtering and no
 * colour-space conversion to get wrong — the same reasons the region palette is a float
 * texture rather than bytes.
 */
export class BoneDualQuats {
  constructor(skeleton) {
    this.skeleton = skeleton;
    const n = skeleton.bones.length;
    this.data = new Float32Array(n * 2 * 4);
    this.texture = new THREE.DataTexture(this.data, n * 2, 1, THREE.RGBAFormat, THREE.FloatType);
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.colorSpace = THREE.NoColorSpace;
    this.texture.generateMipmaps = false;
    this.update();
  }

  /**
   * Refresh from the skeleton's current world matrices.
   *
   * The matrix is the same one linear blend skinning would have used — bone world times bind
   * inverse — decomposed into the rotation and translation it already is. Scale is dropped
   * on purpose: these are rigid joint transforms, and a dual quaternion cannot carry a scale
   * anyway, so silently blending one would be worse than not having it.
   */
  update() {
    const { bones, boneInverses } = this.skeleton;
    const d = this.data;
    for (let i = 0; i < bones.length; i++) {
      _m.multiplyMatrices(bones[i].matrixWorld, boneInverses[i]);
      _m.decompose(_p, _q, _s);
      const o = i * 8;
      d[o] = _q.x; d[o + 1] = _q.y; d[o + 2] = _q.z; d[o + 3] = _q.w;
      /* The dual part is half the translation multiplied by the rotation, in the quaternion
       * sense: qd = 0.5 * (0, t) * qr. Written out rather than built through Quaternion so
       * the JavaScript here reads as the same four lines as the shader. */
      const tx = _p.x * 0.5, ty = _p.y * 0.5, tz = _p.z * 0.5;
      d[o + 4] =  tx * _q.w + ty * _q.z - tz * _q.y;
      d[o + 5] = -tx * _q.z + ty * _q.w + tz * _q.x;
      d[o + 6] =  tx * _q.y - ty * _q.x + tz * _q.w;
      d[o + 7] = -tx * _q.x - ty * _q.y - tz * _q.z;
    }
    this.texture.needsUpdate = true;
  }
}

/**
 * The blend, in JavaScript, exactly as the shader does it.
 *
 * @param data      the Float32Array from BoneDualQuats
 * @param idx       four bone indices
 * @param wgt       four weights
 * @param v         the rest position, modified in place and returned
 * @param normalOnly rotate only, for a normal rather than a point
 */
export function skinPoint(data, idx, wgt, v, normalOnly = false) {
  let rx = 0, ry = 0, rz = 0, rw = 0;
  let dx = 0, dy = 0, dz = 0, dw = 0;
  let refX = 0, refY = 0, refZ = 0, refW = 0, have = false;
  for (let k = 0; k < 4; k++) {
    const w = wgt[k];
    if (!w) continue;
    const o = idx[k] * 8;
    let qx = data[o], qy = data[o + 1], qz = data[o + 2], qw = data[o + 3];
    let ex = data[o + 4], ey = data[o + 5], ez = data[o + 6], ew = data[o + 7];
    if (!have) { refX = qx; refY = qy; refZ = qz; refW = qw; have = true; }
    /* A quaternion and its negation are the same rotation, so two bones can be a hundred and
     * eighty degrees apart in the algebra while describing nearly the same pose. Blending
     * those cancels them out and the vertex collapses to the origin. Flip against the first
     * bone before adding. */
    else if (qx * refX + qy * refY + qz * refZ + qw * refW < 0) {
      qx = -qx; qy = -qy; qz = -qz; qw = -qw;
      ex = -ex; ey = -ey; ez = -ez; ew = -ew;
    }
    rx += qx * w; ry += qy * w; rz += qz * w; rw += qw * w;
    dx += ex * w; dy += ey * w; dz += ez * w; dw += ew * w;
  }
  const len = Math.hypot(rx, ry, rz, rw);
  if (len < 1e-8) return v;
  rx /= len; ry /= len; rz /= len; rw /= len;
  dx /= len; dy /= len; dz /= len; dw /= len;

  // rotate: v + 2 * cross(q.xyz, cross(q.xyz, v) + q.w * v)
  const cx = ry * v.z - rz * v.y, cy = rz * v.x - rx * v.z, cz = rx * v.y - ry * v.x;
  const ax = cx + rw * v.x, ay = cy + rw * v.y, az = cz + rw * v.z;
  const bx = ry * az - rz * ay, by = rz * ax - rx * az, bz = rx * ay - ry * ax;
  v.set(v.x + 2 * bx, v.y + 2 * by, v.z + 2 * bz);
  if (normalOnly) return v;

  // translate: 2 * (qr.w * qd.xyz - qd.w * qr.xyz + cross(qr.xyz, qd.xyz))
  const tx = rw * dx - dw * rx + (ry * dz - rz * dy);
  const ty = rw * dy - dw * ry + (rz * dx - rx * dz);
  const tz = rw * dz - dw * rz + (rx * dy - ry * dx);
  return v.set(v.x + 2 * tx, v.y + 2 * ty, v.z + 2 * tz);
}

/**
 * Make the raycaster deform the mesh the same way the shader does.
 *
 * three's `SkinnedMesh` skins its raycast vertices too — that is why a posed muscle is
 * pickable at all — but it skins them with the linear blend it ships. Once the shader blends
 * dual quaternions the two disagree by exactly the amount this change was made to fix, and
 * the muscle is drawn in one place and picked in another. So the mesh gets the same blend for
 * both: `applyBoneTransform` is the single step three's raycast routes every vertex through.
 */
export function useDualQuatRaycast(mesh, dq) {
  const iAttr = mesh.geometry.getAttribute('skinIndex');
  const wAttr = mesh.geometry.getAttribute('skinWeight');
  if (!iAttr || !wAttr) return mesh;
  const i4 = [0, 0, 0, 0], w4 = [0, 0, 0, 0];
  mesh.applyBoneTransform = function (index, vector) {
    vector.applyMatrix4(this.bindMatrix);
    for (let k = 0; k < 4; k++) {
      i4[k] = iAttr.getComponent(index, k);
      w4[k] = wAttr.getComponent(index, k);
    }
    skinPoint(dq.data, i4, w4, vector);
    return vector.applyMatrix4(this.bindMatrixInverse);
  };
  return mesh;
}

/** Declarations, injected after three's own skinning uniforms. */
export const GLSL_PARS = /* glsl */`
#ifdef USE_SKINNING
  uniform highp sampler2D dqTexture;

  void dqFetch(float boneIndex, out vec4 qr, out vec4 qd) {
    int i = int(boneIndex + 0.5) * 2;
    qr = texelFetch(dqTexture, ivec2(i, 0), 0);
    qd = texelFetch(dqTexture, ivec2(i + 1, 0), 0);
  }
  vec3 dqRotate(vec4 q, vec3 v) {
    return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v);
  }
  vec3 dqTranslate(vec4 qr, vec4 qd, vec3 v) {
    return v + 2.0 * (qr.w * qd.xyz - qd.w * qr.xyz + cross(qr.xyz, qd.xyz));
  }
#endif
`;

/**
 * The blend itself, replacing three's `skinbase_vertex`.
 *
 * It leaves `dqR` and `dqD` in scope for the two chunks below, which is why this has to sit
 * where `skinbase_vertex` sat rather than anywhere else in main().
 */
export const GLSL_BASE = /* glsl */`
#ifdef USE_SKINNING
  vec4 dqR = vec4(0.0), dqD = vec4(0.0), _qr, _qd, _ref;
  {
    float w[4]; w[0] = skinWeight.x; w[1] = skinWeight.y; w[2] = skinWeight.z; w[3] = skinWeight.w;
    float b[4]; b[0] = skinIndex.x;  b[1] = skinIndex.y;  b[2] = skinIndex.z;  b[3] = skinIndex.w;
    bool have = false;
    for (int k = 0; k < 4; k++) {
      if (w[k] == 0.0) continue;
      dqFetch(b[k], _qr, _qd);
      // a quaternion and its negation are the same rotation; blended without a sign check
      // they cancel and the vertex collapses to the origin
      if (!have) { _ref = _qr; have = true; }
      else if (dot(_qr, _ref) < 0.0) { _qr = -_qr; _qd = -_qd; }
      dqR += _qr * w[k];
      dqD += _qd * w[k];
    }
    float _len = length(dqR);
    if (_len > 1e-8) { dqR /= _len; dqD /= _len; }
    else { dqR = vec4(0.0, 0.0, 0.0, 1.0); dqD = vec4(0.0); }
  }
#endif
`;

/** Replaces three's `skinnormal_vertex`: a normal is rotated and not translated. */
export const GLSL_NORMAL = /* glsl */`
#ifdef USE_SKINNING
  objectNormal = dqRotate(dqR, objectNormal);
  #ifdef USE_TANGENT
    objectTangent = dqRotate(dqR, objectTangent);
  #endif
#endif
`;

/** Replaces three's `skinning_vertex`. */
export const GLSL_VERTEX = /* glsl */`
#ifdef USE_SKINNING
  {
    vec3 _v = (bindMatrix * vec4(transformed, 1.0)).xyz;
    _v = dqTranslate(dqR, dqD, dqRotate(dqR, _v));
    transformed = (bindMatrixInverse * vec4(_v, 1.0)).xyz;
  }
#endif
`;

/**
 * Swap three's linear blend for this one, on a material that is about to compile.
 *
 * Everything is inside `#ifdef USE_SKINNING`, so the bones and the organs — which share this
 * material and are not skinned — compile to exactly the shader they did before.
 */
export function useDualQuatSkinning(shader, textureUniform) {
  shader.uniforms.dqTexture = textureUniform;
  shader.vertexShader = shader.vertexShader
    .replace('#include <skinning_pars_vertex>', `#include <skinning_pars_vertex>\n${GLSL_PARS}`)
    .replace('#include <skinbase_vertex>', GLSL_BASE)
    .replace('#include <skinnormal_vertex>', GLSL_NORMAL)
    .replace('#include <skinning_vertex>', GLSL_VERTEX);
}
