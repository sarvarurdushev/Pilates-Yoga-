import * as THREE from 'three';

/**
 * Linear blend skinning for meshes built by one pipeline onto a rig built by another.
 *
 * The limitation this removes: a muscle mesh bound rigidly to a single bone tears visibly
 * the moment a joint it crosses moves, because nothing deforms it. Almost every muscle
 * crosses a joint, so the movement view had to hide the muscles and show only paths.
 *
 * There are no authored weights to import — BodyParts3D meshes and the Rajagopal rig have
 * never met — so the weights are derived. **They follow the muscle's own span**, not the
 * distance to whatever bone happens to be nearby.
 *
 * For each mesh, the chain of segments it crosses is found first: from the OpenSim path
 * where the muscle has one, whose first and last points are the real attachment bodies, and
 * otherwise from the mesh's own long axis, whose two ends are its origin and insertion. The
 * chain between those two segments is then walked through the joint tree, and every vertex
 * is projected onto the polyline of joint centres along it. Its position along that polyline
 * — one number between 0 and 1 — is what the weights come from: the two chain bones that
 * bracket it, blended.
 *
 * That matters because the obvious alternative does not work. Weighting by distance to the
 * four nearest bone capsules lets weight vary non-monotonically across a muscle: two
 * neighbouring vertices in the middle of the rectus abdominis can end up on different bones,
 * and the mesh tears open between them the moment those bones separate. Along-the-span
 * weights vary smoothly by construction, so a muscle bends and cannot tear.
 *
 * It is still not a heat-diffusion solve and it does not read mesh connectivity, so a muscle
 * whose shape is not well described by one axis — the diaphragm, the pelvic floor — is
 * approximated by its own segment alone rather than blended.
 *
 * Weights are computed once at load and uploaded as `skinIndex` / `skinWeight`, so the
 * deformation itself runs on the GPU through three's own skinning shader — the same code
 * path as any rigged character, at no per-frame CPU cost.
 */

const MAX_INFLUENCES = 4;
const FALLOFF = 2.6;          // higher concentrates weight on the nearest bone
const MIN_STUB = 0.02;        // metres, in rig units: a leaf segment still needs a length
const SPAN_MARGIN = 0.15;     // how far outside its own box a muscle may still claim a joint
/* How far from a muscle's own surface a joint may sit and still count as crossed, as a
 * share of the muscle's own size. Scaling with the muscle is the point: it keeps the
 * coccygeus off the hip and lets a broad back sheet own the vertebrae under it. */
const JOINT_REACH = 0.30;
/* The turnover at a joint, as a share of the muscle's own extent along that joint's axis, and
 * how many times the resulting weights are averaged over the mesh's surface. Both were swept
 * against `tools/skinbench.mjs` over five poses and 366 meshes; the pair below is the floor of
 * that surface. Wider or sharper and the sheets tear, smoother and the muscles stop deforming
 * — which is a failure that reports as *perfect* stretch and volume, so it needs watching for
 * directly. The bench's `spanning` count is what watches it. */
const VOTE_SHARE = 0.05;      // a capsule the mesh barely touches is not one of its ends
const H_FRACTION = 0.25;
const SMOOTH_PASSES = 45;
const WELD = 0.0006;          // body heights: a millimetre, which is well under any real detail
const BONE_SAMPLES = 400;     // per skeleton mesh, so a dense skull cannot swamp the grid
const BONE_CELL = 0.02;       // body heights: about three and a half centimetres
const NERVE_SHARE = 0.08;    // a bone under this share of a mesh's vertices is one it passes, not one it rides
/* A nerve is a tube, and both of the numbers above were tuned on sheets.
 *
 * `SMOOTH_PASSES` exists because projecting onto a chain is smooth *along* the chain and says
 * nothing about across it: two vertices a millimetre apart across the rim of the gluteus
 * maximus land on opposite ends of the chain and the triangle between them tears into a flat
 * sheet. That is a property of a fan. A tube's cross-section is a ring of vertices that all
 * project to the same point, so there is nothing to smooth *across* — and forty-five passes on
 * a hundred-and-twenty-vertex sciatic nerve simply diffuse the handover along the tube until
 * it is a linear ramp over the whole nerve instead of a fold at the hip. The nerve then
 * describes a smooth arc through a hip flexed 120 degrees while the flesh over it folds, and
 * comes out through the back of the buttock. Measured over every clip, the sciatic reached
 * **0.072 of a body height outside the flesh** at 45 passes and 0.013 at none, the femoral
 * 0.055 and 0.015 — and worst nerve edge stretch *fell* with it, 4.66 to 1.82, with spanning
 * up from 29/33 to 32/33. Both objectives, same direction, which is what this problem had
 * refused to do under five other attempts.
 *
 * `NERVE_HALF_CAP` is the other half. `H_FRACTION` sizes the turnover from the mesh's own
 * extent, which for the femoral nerve — 0.59 of a body height end to end — is a blend a
 * quarter of a body long. The cap says a nerve's turnover may span at most six per cent of a
 * body height either side of a joint however long the nerve is. Swept: 0.10 → 2.08 worst
 * stretch, 0.08 → 1.86, **0.06 → 1.82**, 0.05 → 1.93, 0.04 → 2.07.
 *
 * Note that zero passes is *safer* against split vertices rather than riskier: the smoothstep
 * is a pure function of position, so two coincident vertices get identical weights, and it is
 * the smoothing that could ever have made them differ. */
/* How much of a structure its chain has to account for before the chain is believed. Below
 * this it is rebuilt from the bones the mesh lies on — see `chainCoverage`. */
export const CHAIN_COVER = 0.5;
export const NERVE_SMOOTH = 0;
export const NERVE_HALF_CAP = 0.06;
/* Lower for muscles, because a long thin one is spread evenly over many segments: multifidus
 * runs sacrum to C2 and holds about four per cent of its vertices against each vertebra, so
 * at the nerve's threshold the whole candidate set collapsed to the bulky lumbar end and the
 * left multifidus came out on `pelvis > L5` while the right one spanned the whole spine.
 * Measured: at 0.04 the muscle numbers are unchanged and multifidus is symmetric again; the
 * nerves need the higher value, which is why there are two. */
export const MUSCLE_SHARE = 0.04;

/**
 * Build the bone list and the capsule for each.
 * @param {import('./rig.js').Rig} rig
 * @returns {{ bones: THREE.Bone[], capsules: Array<{a:THREE.Vector3,b:THREE.Vector3,i:number}> }}
 */
export function buildSkeleton(rig) {
  const names = [...rig.nodes.keys()];
  const bones = [];
  const index = new Map();

  // three needs actual Bone objects, and it needs them in a hierarchy that matches the rig
  for (const name of names) {
    const b = new THREE.Bone();
    b.name = `bone:${name}`;
    index.set(name, bones.length);
    bones.push(b);
  }
  for (const name of names) {
    const rec = rig.nodes.get(name);
    const bone = bones[index.get(name)];
    // the bone rides the segment's body node, so it inherits the whole joint chain for free
    rec.body.add(bone);
    bone.position.set(0, 0, 0);
    bone.quaternion.identity();
    bone.scale.setScalar(1);
  }
  rig.root.updateMatrixWorld(true);

  // capsule per segment, in world (body-frame) space at the bind pose
  const childOf = new Map();
  for (const name of names) {
    const parent = rig.data.segments[name]?.parent;
    if (parent && rig.nodes.has(parent)) {
      if (!childOf.has(parent)) childOf.set(parent, []);
      childOf.get(parent).push(name);
    }
  }
  const capsules = [];
  const p = new THREE.Vector3(), q = new THREE.Vector3();
  for (const name of names) {
    const rec = rig.nodes.get(name);
    p.setFromMatrixPosition(rec.body.matrixWorld);
    const kids = childOf.get(name) ?? [];
    let end;
    if (kids.length) {
      // to the average of its children, so a segment with two children still gets a length
      end = new THREE.Vector3();
      for (const k of kids) {
        q.setFromMatrixPosition(rig.nodes.get(k).body.matrixWorld);
        end.add(q);
      }
      end.divideScalar(kids.length);
    } else {
      const parent = rig.data.segments[name]?.parent;
      end = p.clone();
      if (parent && rig.nodes.has(parent)) {
        q.setFromMatrixPosition(rig.nodes.get(parent).body.matrixWorld);
        end.add(p.clone().sub(q).normalize().multiplyScalar(MIN_STUB));
      } else {
        end.y += MIN_STUB;
      }
    }
    if (end.distanceTo(p) < 1e-6) end.y += MIN_STUB;
    capsules.push({ a: p.clone(), b: end, i: index.get(name) });
  }
  return { bones, capsules, index };
}

/**
 * The segments a structure bound to `seg` may be weighted to.
 *
 * Ancestors and descendants only, never siblings. A muscle spans a *chain* of joints, not a
 * fork: rectus femoris runs pelvis to tibia through the femur, and no muscle in the body
 * runs from one thigh to the other. Taking a ball of radius 2 in the tree instead would
 * reach the opposite leg through the pelvis in two steps, and the right quadriceps would
 * pick up weight from the left femur.
 *
 * `side` narrows the descent further: a structure on the right is never weighted to a
 * segment on the left, which matters for the muscles bound to the pelvis, where both femurs
 * are one step away.
 */
export function neighbourhood(rig, index, seg, radius = 2, side = null) {
  const out = new Set();
  const segs = rig.data.segments;
  const wrongSide = (name) => {
    if (!side || side === 'M') return false;
    const m = /_(r|l)$/.exec(name);
    return !!m && m[1].toUpperCase() !== side.toUpperCase();
  };
  const add = (name) => { if (index.has(name)) out.add(index.get(name)); };
  add(seg);
  // up the chain
  let cur = segs[seg]?.parent;
  for (let i = 0; i < radius && cur; i++) { add(cur); cur = segs[cur]?.parent; }
  // and down it, skipping anything on the other side of the body
  const down = (name, left) => {
    if (left <= 0) return;
    for (const [child, s2] of Object.entries(segs)) {
      if (s2.parent !== name || wrongSide(child)) continue;
      add(child);
      down(child, left - 1);
    }
  };
  down(seg, radius);
  return out;
}

const _ab = new THREE.Vector3(), _ap = new THREE.Vector3(), _cl = new THREE.Vector3();
function distToSegment(pt, a, b) {
  _ab.subVectors(b, a);
  _ap.subVectors(pt, a);
  const len2 = _ab.lengthSq();
  const t = len2 > 1e-12 ? Math.max(0, Math.min(1, _ap.dot(_ab) / len2)) : 0;
  _cl.copy(a).addScaledVector(_ab, t);
  return pt.distanceTo(_cl);
}

/**
 * Convert a mesh into a SkinnedMesh bound to the rig.
 *
 * The geometry stays in body-frame coordinates and the bind matrix is the identity, which is
 * why a mesh built in a completely different pipeline can be skinned to this skeleton at all:
 * every bone's inverse bind matrix is captured from the rig's own bind pose, so at rest the
 * transform is exactly identity and the mesh does not move.
 *
 * @returns {THREE.SkinnedMesh|null} null when the mesh has no usable geometry
 */
/**
 * The ordered chain of segments between two, through the joint tree.
 *
 * A muscle's fibres run from its origin to its insertion, and the bones between those two
 * points are what it crosses. Walking the tree gives that list in order, which is what the
 * weighting projects onto.
 */
export function chainBetween(rig, a, b) {
  const segs = rig.data.segments;
  const up = (n) => { const out = []; let c = n; while (c) { out.push(c); c = segs[c]?.parent; } return out; };
  const pa = up(a), pb = up(b);
  const seen = new Set(pb);
  let join = pa.find(n => seen.has(n));
  if (!join) return [a];
  const left = pa.slice(0, pa.indexOf(join) + 1);
  const right = pb.slice(0, pb.indexOf(join)).reverse();
  return [...left, ...right];
}

const _p = new THREE.Vector3(), _q = new THREE.Vector3(), _d = new THREE.Vector3();

/** The two vertices furthest apart along the mesh's dominant direction, in world space. */
function longAxis(mesh) {
  const pos = mesh.geometry.getAttribute('position');
  mesh.updateWorldMatrix(true, false);
  const m = mesh.matrixWorld;
  const step = Math.max(1, Math.floor(pos.count / 400));
  // centroid, then the point furthest from it, then the point furthest from that: two passes
  // of the standard diameter approximation, which is plenty for a muscle belly
  const c = new THREE.Vector3();
  let n = 0;
  for (let i = 0; i < pos.count; i += step) {
    c.add(_p.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(m)); n++;
  }
  if (!n) return null;
  c.divideScalar(n);
  const far = (from) => {
    let best = null, bd = -1;
    for (let i = 0; i < pos.count; i += step) {
      _p.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(m);
      const d = _p.distanceToSquared(from);
      if (d > bd) { bd = d; best = _p.clone(); }
    }
    return best;
  };
  const a = far(c);
  if (!a) return null;
  const b = far(a);
  return b ? { a, b } : null;
}

/** The capsule in `pool` nearest a point, by distance to the segment. */
function nearestCapsule(pool, pt) {
  let best = null, bd = Infinity;
  for (const c of pool) {
    const d = distToSegment(pt, c.a, c.b);
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}

/**
 * Convert a mesh into a SkinnedMesh bound to the rig.
 *
 * The geometry stays in body-frame coordinates and the bind matrix is the identity, which is
 * why a mesh built in a completely different pipeline can be skinned to this skeleton at all:
 * every bone's inverse bind matrix is captured from the rig's own bind pose, so at rest the
 * transform is exactly identity and the mesh does not move.
 *
 * @param {THREE.Mesh} mesh
 * @param {THREE.Skeleton} skeleton
 * @param {Array} capsules      one per segment, from buildSkeleton
 * @param {object} opts
 * @param {Set<number>} opts.allowed  bone indices this structure may be weighted to
 * @param {string[]} opts.chain       segment names, origin to insertion, when known
 * @param {Map<string,number>} opts.index  segment name -> bone index
 * @returns {THREE.SkinnedMesh|null} null when the mesh has no usable geometry
 */
export function skinMesh(mesh, skeleton, capsules, opts = {}) {
  const { allowed = null, chain = null, index = null, rig = null, home = null,
          hCap = 0, passes = SMOOTH_PASSES } = opts;
  const geo = mesh.geometry;
  const pos = geo.getAttribute('position');
  if (!pos) return null;
  // Only the bones this structure could plausibly be attached to. Without it, "nearest"
  // across a body is not "attached to": a vertex on the right vastus lateralis sits closer
  // to the left femur than to its own hip.
  const pool = allowed ? capsules.filter(c => allowed.has(c.i)) : capsules;
  if (!pool.length) return null;

  mesh.updateWorldMatrix(true, false);
  const world = mesh.matrixWorld.clone();

  // The polyline the weights run along: the joint centres of the chain this muscle crosses.
  // With fewer than two, there is nothing to blend between and the mesh rides one bone.
  let line = null;
  if (chain && index) {
    const pts = chain.map(n => capsules[index.get(n)]).filter(Boolean).map(c => c.a.clone());
    if (pts.length >= 2) {
      // the far end needs the last capsule's tip, or the chain stops at the last joint centre
      const last = capsules[index.get(chain[chain.length - 1])];
      pts.push(last.b.clone());
      line = { pts, bones: [...chain.map(n => index.get(n)), index.get(chain[chain.length - 1])] };
    }
  }

  const n = pos.count;
  const idx = new Uint16Array(n * MAX_INFLUENCES);
  const wgt = new Float32Array(n * MAX_INFLUENCES);
  const v = new THREE.Vector3();

  if (line && rig) {
    /* One smoothstep per joint, in space, sized by the muscle.
     *
     * The along-span weighting asks how far along the whole chain a vertex is and normalises
     * by the interval it lands in; for anything crossing the shoulder that interval is the
     * trunk, so the ramp is spread over fifty centimetres and a sternal fibre comes out most
     * of the way onto the humerus. Inverse distance to the capsules fixes the scale but has
     * almost no contrast — a capsule is a long line and its distance saturates, so every
     * vertex ends up with a similar mixture and the muscle stops deforming at all.
     *
     * This measures the one thing that actually decides which bone a vertex follows: which
     * side of the joint it is on, and by how far. `s` is the signed distance along the axis
     * through the joint, so it is zero exactly at the centre of rotation and grows in
     * millimetres either way. The ramp's half-width is however much muscle lies on the
     * thinner side, so both ends of the muscle saturate on their own bone and everything
     * between them turns over smoothly. Nothing here is normalised by a bone's length.
     */
    const segs = rig.data.segments;
    const order = chain.slice();
    // proximal first, so the cascade below hands weight outward joint by joint
    if (order.length > 1 && segs[order[0]]?.parent === order[1]) order.reverse();
    const capOf = (nm) => capsules[index.get(nm)];
    const joints = [];
    for (let k = 1; k < order.length; k++) {
      const u = order[k - 1], v = order[k];
      const child = segs[v]?.parent === u ? v : u;
      const J = capOf(child)?.a;
      const a = capOf(u), b = capOf(v);
      if (!J || !a || !b) { joints.length = 0; break; }
      const n0 = new THREE.Vector3().copy(b.a).add(b.b).multiplyScalar(0.5)
        .sub(_q.copy(a.a).add(a.b).multiplyScalar(0.5));
      if (n0.lengthSq() < 1e-12) { joints.length = 0; break; }
      joints.push({ J, n: n0.normalize() });
    }
    if (!joints.length) return null;
    const m = order.length;
    const t = [];
    for (let j = 0; j < joints.length; j++) t.push(new Float32Array(n));
    for (let j = 0; j < joints.length; j++) {
      const { J, n: axis } = joints[j];
      let lo = Infinity, hi = -Infinity;
      const sArr = t[j];
      for (let i = 0; i < n; i++) {
        v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(world).sub(J);
        const sv = v.dot(axis);
        sArr[i] = sv;
        if (sv < lo) lo = sv;
        if (sv > hi) hi = sv;
      }
      // how wide the turnover is: a share of the muscle's own extent along this axis, with
      // a floor of the thinner side so a muscle sitting mostly past the joint still turns
      // over inside itself rather than stepping
      /* `hCap` bounds it absolutely, for the nervous layer. A share of the mesh's own extent
       * is right for a muscle, which is roughly joint-sized; for the femoral nerve, 0.59 of a
       * body height end to end, it is a blend a quarter of a body long, so the nerve turns
       * over far more gradually than the flesh around it and leaves the thigh at depth. The
       * opposite reading — that the blend was too *narrow* — was written here first and swept:
       * forcing a floor of up to 0.08 changed nothing at all, because `h` was already larger
       * than that. Narrower is what helps. */
      let h = Math.max((hi - lo) * H_FRACTION, Math.min(-lo, hi), 1e-4);
      if (hCap > 0) h = Math.max(Math.min(h, hCap), 1e-4);
      for (let i = 0; i < n; i++) {
        const x = Math.max(0, Math.min(1, (sArr[i] + h) / (2 * h)));
        sArr[i] = x * x * (3 - 2 * x);
      }
    }
    // cascade: everything starts on the proximal bone and is handed outward at each joint
    const chans = [];
    for (let k = 0; k < m; k++) chans.push(new Float32Array(n));
    for (let i = 0; i < n; i++) {
      let carry = 1;
      for (let k = 0; k < m - 1; k++) {
        const give = t[k][i];
        chans[k][i] = carry * (1 - give);
        carry *= give;
      }
      chans[m - 1][i] = carry;
    }
    for (let k = 0; k < m; k++) smoothOverSurface(geo, chans[k], passes);
    for (let i = 0; i < n; i++) {
      const rank = [];
      for (let k = 0; k < m; k++) rank.push([chans[k][i], index.get(order[k])]);
      rank.sort((a, b) => b[0] - a[0]);
      let sum = 0;
      for (let k = 0; k < MAX_INFLUENCES && k < rank.length; k++) sum += Math.max(0, rank[k][0]);
      for (let k = 0; k < MAX_INFLUENCES; k++) {
        const e = rank[k];
        idx[i * MAX_INFLUENCES + k] = e ? e[1] : 0;
        wgt[i * MAX_INFLUENCES + k] = e && sum > 0 ? Math.max(0, e[0]) / sum : 0;
      }
    }
  } else {
    /* One bone for the whole mesh — but *which* bone is not a proximity question.
     *
     * `nearestCapsule` was asked here unconditionally, and a capsule is a line between two
     * joint centres: the femur's begins at the hip, up inside the pelvis, while the pelvis's
     * own runs down the middle of the body. So the inguinal ligament — which spans the pubic
     * tubercle to the anterior superior iliac spine and touches no femur at all — came out a
     * hundred per cent bound to `femur_l`, and swung out with the thigh in every hip flexion
     * in the library.
     *
     * The chain is not the answer either, when there is only one segment in it: `spanOf`
     * resolves its ends by the same capsule proximity, so it handed the right external
     * oblique `humerus_r` — honouring that put an abdominal wall muscle on an arm and took its
     * drift from 0.08 of a body height to 0.35. What is trustworthy here is the *home*
     * segment, because that one is decided against the skeleton's own meshes rather than
     * against a line through a segment. Proximity stays as the last resort. */
    const named = home != null && index?.has(home) ? index.get(home) : null;
    let ci = named != null && (!allowed || allowed.has(named)) ? named : null;
    if (ci == null) {
      const fallback = nearestCapsule(pool, v.set(0, 0, 0)) ?? pool[0];
      const centre = new THREE.Vector3();
      let count = 0;
      const step = Math.max(1, Math.floor(n / 200));
      for (let i = 0; i < n; i += step) {
        centre.add(v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(world)); count++;
      }
      if (count) centre.divideScalar(count);
      ci = (nearestCapsule(pool, centre) ?? fallback).i;
    }
    for (let i = 0; i < n; i++) { idx[i * MAX_INFLUENCES] = ci; wgt[i * MAX_INFLUENCES] = 1; }
  }

  geo.setAttribute('skinIndex', new THREE.BufferAttribute(idx, MAX_INFLUENCES));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(wgt, MAX_INFLUENCES));

  const skinned = new THREE.SkinnedMesh(geo, mesh.material);
  skinned.name = mesh.name;
  skinned.userData = { ...mesh.userData };
  skinned.frustumCulled = false;
  // the geometry is already in body-frame coordinates, so the skinned mesh sits at the
  // origin of the rig root's parent and the bind matrix is identity
  skinned.position.set(0, 0, 0);
  skinned.quaternion.identity();
  skinned.scale.setScalar(1);
  skinned.bind(skeleton, new THREE.Matrix4());
  return skinned;
}

/**
 * Give every nerve vertex the weights of the flesh it lies in.
 *
 * Skinning a nerve by its own chain keeps it near its own bones and still puts it outside the
 * body, because the muscle around it is skinned by a different rule and moves out from under
 * it: over the library the sciatic nerve finished up twelve centimetres outside the flesh in
 * the plough, while at rest every nerve is inside the body to within one voxel.
 *
 * **Take the nearest muscle vertex's weights and you tear the tube apart.** Two points a
 * millimetre apart along a nerve can have different nearest muscles, on different bones, and
 * the tube between them is stretched across the gap — measured at 51x edge stretch, which is
 * the fan of ribbon that appears off a shoulder. The weights have to vary as smoothly along
 * the nerve as the flesh does, so this blends the `K` nearest flesh samples by inverse
 * distance and then relaxes the result along the nerve's own surface. Same trap, and the same
 * fix, as the muscle weights: see `smoothOverSurface`.
 *
 * @param {THREE.SkinnedMesh[]} nerves
 * @param {THREE.SkinnedMesh[]} flesh   already-skinned muscle meshes
 */
const FLESH_CELL = 0.02;    // body heights: the grid the flesh samples are bucketed into
const FLESH_K = 10;         // how many flesh samples a nerve vertex blends
const FLESH_SMOOTH = 80;    // relaxation passes along the nerve's own surface
export function weightsFromFlesh(nerves, flesh) {
  if (!nerves?.length || !flesh?.length) return 0;
  const grid = new Map();
  const key = (x, y, z) => `${Math.floor(x / FLESH_CELL)},${Math.floor(y / FLESH_CELL)},` +
                           `${Math.floor(z / FLESH_CELL)}`;
  for (const o of flesh) {
    const g = o.geometry, pos = g.attributes.position;
    const si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
    if (!si || !sw) continue;
    const step = Math.max(1, Math.floor(pos.count / 900));
    for (let i = 0; i < pos.count; i += step) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const k = key(x, y, z);
      let l = grid.get(k);
      if (!l) grid.set(k, l = []);
      l.push([x, y, z, si.getX(i), si.getY(i), si.getZ(i), si.getW(i),
              sw.getX(i), sw.getY(i), sw.getZ(i), sw.getW(i)]);
    }
  }
  if (!grid.size) return 0;

  let done = 0;
  for (const o of nerves) {
    const g = o.geometry, pos = g.attributes.position;
    const si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
    if (!si || !sw) continue;
    const n = pos.count;
    /* One channel per bone this nerve ends up touching, so the blend and the smoothing can
     * both be done as plain scalar fields before being packed back into four influences. */
    const chan = new Map();
    const ch = (b) => { let a = chan.get(b); if (!a) chan.set(b, a = new Float32Array(n)); return a; };
    for (let i = 0; i < n; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const a0 = Math.floor(x / FLESH_CELL), b0 = Math.floor(y / FLESH_CELL),
            c0 = Math.floor(z / FLESH_CELL);
      const near = [];
      for (let r = 0; r <= 4; r++) {
        for (let a = a0 - r; a <= a0 + r; a++)
          for (let b = b0 - r; b <= b0 + r; b++)
            for (let c = c0 - r; c <= c0 + r; c++) {
              if (r && Math.max(Math.abs(a - a0), Math.abs(b - b0), Math.abs(c - c0)) !== r) continue;
              const l = grid.get(`${a},${b},${c}`);
              if (!l) continue;
              for (const q of l)
                near.push([(q[0] - x) ** 2 + (q[1] - y) ** 2 + (q[2] - z) ** 2, q]);
            }
        if (near.length >= FLESH_K) break;
      }
      if (!near.length) continue;
      near.sort((p, q) => p[0] - q[0]);
      for (const [d2, q] of near.slice(0, FLESH_K)) {
        const w = 1 / (d2 + 1e-6);
        for (let k = 0; k < 4; k++) {
          const bw = q[7 + k];
          if (bw > 0) ch(q[3 + k])[i] += w * bw;
        }
      }
    }
    if (!chan.size) continue;
    for (const arr of chan.values()) smoothOverSurface(g, arr, FLESH_SMOOTH);
    const bones = [...chan.keys()];
    for (let i = 0; i < n; i++) {
      const rank = bones.map(b => [chan.get(b)[i], b]).sort((p, q) => q[0] - p[0]);
      let sum = 0;
      for (let k = 0; k < MAX_INFLUENCES && k < rank.length; k++) sum += Math.max(0, rank[k][0]);
      if (sum <= 0) continue;
      const idx = [0, 0, 0, 0], wgt = [0, 0, 0, 0];
      for (let k = 0; k < MAX_INFLUENCES; k++) {
        const e = rank[k];
        idx[k] = e ? e[1] : 0;
        wgt[k] = e ? Math.max(0, e[0]) / sum : 0;
      }
      si.setXYZW(i, idx[0], idx[1], idx[2], idx[3]);
      sw.setXYZW(i, wgt[0], wgt[1], wgt[2], wgt[3]);
    }
    si.needsUpdate = true; sw.needsUpdate = true;
    done += n;
  }
  return done;
}

/**
 * Which segments a nerve could plausibly be attached to.
 *
 * `neighbourhood` returns a segment's ancestors and descendants and nothing else, which is
 * exactly right for a muscle — it is the rule that stopped the whole muscle layer smearing
 * into one blob — and wrong for a structure whose home segment is mis-identified. The
 * axillary nerve's centroid lands on C1, and the humerus is a *sibling* branch off the torso:
 * neither an ancestor nor a descendant of C1, so no radius reaches it. At reach 20 the arm
 * was still not a candidate, and the nerve was bound from the neck to the skull while half of
 * it lay out at the shoulder.
 *
 * A nerve is long and it is *near* the bones it runs along, so the candidate set is built
 * from where its own vertices are: every segment some part of the mesh lies nearest to, plus
 * a short neighbourhood around each to join them into one connected set.
 */
export function meshNeighbourhood(mesh, rig, ref, index, side, reach = 2,
                                  share = NERVE_SHARE) {
  const pos = mesh.geometry.getAttribute('position');
  if (!pos) return null;
  mesh.updateWorldMatrix(true, false);
  const world = mesh.matrixWorld;
  const names = [...rig.nodes.keys()];
  const field = ref && !Array.isArray(ref) ? ref : null;
  const seen = new Map();
  const step = Math.max(1, Math.floor(pos.count / 240));
  let n = 0;
  for (let i = 0; i < pos.count; i += step) {
    _p.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(world);
    const at = field ? segmentAtPoint(field, _p) : (nearestCapsule(ref, _p)?.i ?? -1);
    if (at >= 0) { seen.set(at, (seen.get(at) ?? 0) + 1); n++; }
  }
  /* A segment one stray vertex happens to sit beside is not one this structure lies along.
   * Without the share, the whole point of sampling is lost: a mesh that brushes past a bone
   * claims that bone's whole neighbourhood, and the candidate set grows back into the
   * unrestricted one that took worst stretch from 4.6 to 16.6. */
  const held = [...seen].filter(([, c]) => c >= n * share).map(([i]) => i);
  if (!held.length) return null;
  const out = new Set();
  if (reach < 0) {
    /* The connected set, and nothing else: every segment the mesh rides, plus the tree path
     * joining them. A radius cannot express that — too small and multifidus loses the top of
     * the spine it runs to, too large and a rib muscle is offered an arm. The path is what
     * the structure actually crosses, so it is exactly what may carry weight. */
    const top = held.reduce((a, b) => (seen.get(a) >= seen.get(b) ? a : b));
    for (const i of held)
      for (const nm of chainBetween(rig, names[i], names[top]))
        if (index.has(nm)) out.add(index.get(nm));
  } else {
    for (const i of held)
      for (const j of neighbourhood(rig, index, names[i], reach, side) ?? []) out.add(j);
  }
  return out.size ? out : null;
}

/**
 * What share of a mesh lies against each segment — measured by the *space* it occupies, not
 * by how many vertices are in it.
 *
 * Vertex count is a proxy for tessellation, not for extent, and a nerve's tessellation tracks
 * how many branches are in a region. The ulnar nerve fans into deep, superficial and digital
 * branches inside the hand, so 74% of its vertices are there and only **4.6%** are against the
 * humerus — even though a fifth of the nerve's actual length runs down the upper arm. Under
 * `trimToBones`' 8% bar that dropped `humerus` from its chain, and the whole upper arm was
 * welded rigidly to the ulna: it swung out of the arm as a straight rod every time the elbow
 * bent. Counting each occupied cell once instead puts the humerus at **16.2%**.
 *
 * The cell is the bone field's own, so "how much space" is asked at the same resolution the
 * field answers "which bone" at.
 *
 * **`byCell` is false for muscles, and that is not an oversight.** A muscle does not branch,
 * so its vertex density is a fair proxy for its extent — and the cell measure is quantised by
 * the cell size, which for a long thin structure is brutal: multifidus runs sacrum to C4 and
 * its 233 vertices occupy about thirty cells, so every one of its twenty-two vertebrae comes
 * out at one cell, 3.2%, indistinguishable from noise. Under the trim that left the left
 * multifidus welded to `pelvis > L5` and the right one to `pelvis … T9` — asymmetric, and
 * 0.114 of a body height adrift in a roll-up. On vertices the same muscle spreads 3–9% per
 * level with no single segment over the bar, which is what makes the trim's floor return the
 * whole chain untouched.
 */
function boneShares(mesh, field, allowed = null, byCell = true) {
  const pos = mesh.geometry?.getAttribute('position');
  if (!pos || !field) return null;
  mesh.updateWorldMatrix(true, false);
  const world = mesh.matrixWorld;
  const cell = field.cell;
  const seen = new Set(), cells = new Map();
  const step = Math.max(1, Math.floor(pos.count / 240));
  let n = 0;
  for (let i = 0; i < pos.count; i += step) {
    _p.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(world);
    const at = segmentAtPoint(field, _p);
    if (at < 0 || (allowed && !allowed.has(at))) continue;
    if (byCell) {
      const k = `${Math.floor(_p.x / cell)},${Math.floor(_p.y / cell)},${Math.floor(_p.z / cell)}`;
      if (seen.has(k)) continue;
      seen.add(k);
    }
    cells.set(at, (cells.get(at) ?? 0) + 1);
    n++;
  }
  if (!n) return null;
  const out = new Map();
  for (const [seg, c] of cells) out.set(seg, c / n);
  return out;
}

/**
 * How much of a mesh the segments of a chain actually account for.
 *
 * `spanOf` resolves its two ends against capsules and `trimToBones` can only cut what those
 * ends produced, so a chain can be perfectly self-consistent and still describe a fraction of
 * the structure. The right vagus nerve runs from the skull through the neck and thorax to the
 * stomach; `spanOf` gave it `C1 … L2` — no `skull` in it at all, though a fifth of the nerve
 * is there — and the trim then kept the supported run inside that, `T11 > T12 > L1`. Half a
 * metre of nerve welded to three vertebrae at the bottom of it.
 *
 * A chain that accounts for a third of a structure is not that structure's chain. This is the
 * test that says so, and `chainFromBones` is what gets used instead.
 */
export function chainCoverage(chain, mesh, field, index) {
  if (!chain?.length) return 0;
  const shares = boneShares(mesh, field);
  if (!shares) return 1;
  let held = 0;
  for (const nm of chain) {
    const b = index.get(nm);
    if (b !== undefined) held += shares.get(b) ?? 0;
  }
  return held;
}

/**
 * Add to a candidate set the bones the mesh is demonstrably lying on, and the run between.
 *
 * A nerve's candidates come from the capsules, because the bone field's finer labelling
 * over-broadens a long tube — measured, worst nerve stretch 2.8 to 18.5. But a capsule is a
 * line between two joint centres, and the eleven intercostal nerves are not a tube: they wrap
 * the ribcage, and every point on the lateral chest is nearer the `torso` capsule running up
 * the middle of the body, or the arm hanging beside it, than to the thoracic vertebra it is
 * actually lying against. So the candidate set came out `T1, T2, torso, humerus_l, ulna_l,
 * radius_l` — no vertebra below T2 in it at all — and no rule downstream could put them on
 * one, however right that rule was. The whole sheet was welded to `torso`, which in this rig
 * is one rigid body hanging off T1, while every rib moved with its own vertebra: the nerves
 * stayed put and came out through the chest.
 *
 * This adds only what the bone field says the mesh *occupies*, with no reach expansion around
 * it, plus the run of the joint tree joining those bones — so the set gains the vertebrae the
 * nerves are lying on and nothing else.
 */
export function withOccupied(allowed, mesh, rig, field, index, share = MUSCLE_SHARE) {
  const shares = boneShares(mesh, field);
  if (!shares) return allowed;
  const names = [...rig.nodes.keys()];
  const held = [...shares].filter(([, f]) => f >= share).map(([b]) => names[b]).filter(Boolean);
  if (held.length < 2) return allowed;
  let best = null;
  for (let i = 0; i < held.length; i++)
    for (let j = i + 1; j < held.length; j++) {
      const c = chainBetween(rig, held[i], held[j]);
      if (c && c.length > (best?.length ?? 1)) best = c;
    }
  if (!best) return allowed;
  const out = new Set(allowed ?? []);
  for (const nm of best) {
    const b = index.get(nm);
    if (b !== undefined) out.add(b);
  }
  return out;
}

/**
 * Rebuild a chain that collapsed to a single segment, from the bones the mesh lies on.
 *
 * `spanOf` resolves its ends against capsules, and a capsule is a line between two joint
 * centres: for a small muscle on the forearm the humerus's line runs right alongside, so both
 * ends resolved to it and the chain came out as `humerus` alone. Extensor pollicis brevis,
 * abductor pollicis longus and pronator quadratus all cross the wrist to reach the thumb, and
 * all three were welded to the upper arm — so they stayed with the humerus while the forearm
 * and hand moved, and the hand's own bones came out through them.
 *
 * The bones know better. Take the two segments the mesh has most of its vertices against and
 * join them: that gives `radius > hand`, which is what those muscles actually cross.
 */
function chainFromBones(mesh, rig, field, index, allowed, { byCell = false } = {}) {
  const shares = boneShares(mesh, field, allowed, byCell);
  if (!shares || shares.size < 2) return null;
  const names = [...rig.nodes.keys()];
  // somewhere the mesh really is, not one stray sample
  const held = [...shares].filter(([, f]) => f >= MUSCLE_SHARE).map(([b]) => names[b]);
  if (held.length < 2) return null;
  /* The two ends are the pair *furthest apart in the joint tree*, not the two with the most
   * of the mesh in them, and everything between them comes along. Eleven intercostal nerves
   * run round the ribcage from T1 to T11 and no single vertebra holds more than a tenth of
   * them, so the two-biggest rule gave `torso` and its immediate neighbour and the whole
   * sheet was welded to one rigid body hanging off T1 while every rib moved with its own
   * vertebra — the nerves stayed put and came out through the chest. The furthest pair gives
   * the thoracic spine, which is what they lie on. */
  let best = null;
  for (let i = 0; i < held.length; i++)
    for (let j = i + 1; j < held.length; j++) {
      const c = chainBetween(rig, held[i], held[j]);
      if (c && c.length > (best?.length ?? 1)) best = c;
    }
  return best && best.length > 1 ? best : null;
}

/**
 * Cut a chain back to the part of it the mesh is actually lying on.
 *
 * `spanOf` picks the two ends whose chain is *longest*, which is what stops a branching
 * structure resolving both ends into the same place — and makes it greedy: one spurious
 * candidate anywhere in the tree wins outright, and the chain then runs through every joint
 * between. The right sacral plexus, four centimetres of nerve inside the pelvis, came out
 * with a chain from a femur up all twenty-four vertebrae and back down the right arm to
 * `radius_r`, and a hundred per cent of its weight on that forearm. The femoral nerve, which
 * runs from the lumbar roots to the knee, came out eighty-seven per cent bound to the torso.
 * Neither of those *stretches* — a mesh riding one bone rigidly is undistorted — so the
 * skinning bench reported both as perfect.
 *
 * The bones say where a structure is. Keep the run of the chain between the first and last
 * segments the mesh has vertices lying on, and drop the tails: everything in between stays,
 * because a nerve passing over a bone without touching it is still crossing that joint.
 */
export { chainFromBones };
export function trimToBones(chain, mesh, field, index, { floor = 1 } = {}) {
  if (!chain || chain.length < 2 || !field) return chain;
  /* Cells for a nerve, vertices for a muscle — see `boneShares`; `floor` already
   * distinguishes the two callers. The threshold is unchanged for both: swapping the muscle
   * bar to `MUSCLE_SHARE` at the same time was tried and measured worse — spanning 177/269
   * to 170/264 for no gain in stretch — so only the *measure* differs by layer, not the bar. */
  const shares = boneShares(mesh, field, null, floor < 2);
  if (!shares) return chain;
  let lo = -1, hi = -1;
  for (let i = 0; i < chain.length; i++) {
    const b = index.get(chain[i]);
    if (b === undefined) continue;
    if ((shares.get(b) ?? 0) < NERVE_SHARE) continue;
    if (lo < 0) lo = i;
    hi = i;
  }
  /* `floor` is 2 for a muscle and 1 for a nerve, and the difference matters both ways.
   *
   * Trimming a muscle down to one bone welds it there, which is the very failure the trim
   * exists to prevent — so for a muscle a one-segment result means the trim found nothing
   * useful and the untrimmed chain is returned instead. A nerve is the opposite: the right
   * sacral plexus is four centimetres of nerve entirely inside the pelvis, and `pelvis` alone
   * is the correct answer. Give it the muscle's floor and it keeps the greedy chain that runs
   * from a femur up the whole spine and back down the right arm — measured at 0.578 of a body
   * height adrift, which is most of a body. */
  if (lo < 0 || hi <= lo) return floor > 1 ? chain : (lo < 0 ? chain : [chain[lo]]);
  return chain.slice(lo, hi + 1);
}

/**
 * The chain of segments a mesh spans, from the OpenSim path where it has one and from the
 * mesh's own long axis otherwise.
 */
export function spanOf(mesh, rig, capsules, index, allowed, attach = null, note = null,
                       { trim = true } = {}) {
  if (attach && attach.length >= 2) {
    const a = attach[0], b = attach[attach.length - 1];
    if (index.has(a) && index.has(b)) return chainBetween(rig, a, b);
  }
  const ax = longAxis(mesh);
  if (!ax) return null;
  const pool = allowed ? capsules.filter(c => allowed.has(c.i)) : capsules;
  if (!pool.length) return null;
  const names = [...rig.nodes.keys()];
  let ca = nearestCapsule(pool, ax.a), cb = nearestCapsule(pool, ax.b);
  if (!ca || !cb) return null;
  /* The long axis is the two points furthest apart, and for a *branching* structure both can
   * sit in the same place. The axillary nerve is a shoulder nerve carrying its root up the
   * neck, and its longest diameter runs skull-to-T1 *inside* the neck — so both ends resolved
   * there and it was bound from C7 to the skull while half of it lay out at the shoulder,
   * swinging with the head. Asking which capsules the mesh's vertices actually lie along, and
   * taking the two furthest apart in the tree, is stable under branching. */
  {
    const pos = mesh.geometry.getAttribute('position');
    const world = mesh.matrixWorld;
    const votes = new Map();
    const step = Math.max(1, Math.floor(pos.count / 240));
    for (let i = 0; i < pos.count; i += step) {
      _p.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(world);
      const c = nearestCapsule(pool, _p);
      if (c) votes.set(c.i, (votes.get(c.i) ?? 0) + 1);
    }
    const total = [...votes.values()].reduce((a, b) => a + b, 0) || 1;
    const held = [...votes].filter(([, n]) => n / total >= VOTE_SHARE).map(([i]) => i);
    let bestLen = chainBetween(rig, names[ca.i], names[cb.i]).length;
    for (let i = 0; i < held.length; i++)
      for (let k = i + 1; k < held.length; k++) {
        const len = chainBetween(rig, names[held[i]], names[held[k]]).length;
        if (len > bestLen) { bestLen = len; ca = capsules[held[i]]; cb = capsules[held[k]]; }
      }
  }
  let far = cb;
  if (ca.i === cb.i) {
    /* Both ends of the axis landed on the same capsule, which for a flat muscle lying on the
     * chest wall means nothing: a capsule is a line down the middle of its segment, and the
     * torso's runs up the spine, so the whole anterior chest is further from the trunk than
     * it is from the arm beside it. Pectoralis major, serratus anterior and teres major all
     * resolved both ends onto the humerus and were bound rigidly to it — the entire sheet
     * swung with the arm and left the ribcage behind, which is the flap that hangs off an
     * abducted shoulder. So take the nearest *other* capsule to whichever end is further
     * away, and let the containment test below decide whether it is real. */
    const d = (c, p) => distToSegment(p, c.a, c.b);
    const end = d(ca, ax.a) > d(ca, ax.b) ? ax.a : ax.b;
    const rest = pool.filter(c => c.i !== ca.i);
    far = rest.length ? nearestCapsule(rest, end) : null;
    if (!far) return [names[ca.i]];
  }
  const chain = chainBetween(rig, names[ca.i], names[far.i]);
  /* Does the muscle actually reach the joints it would be crossing?
   *
   * This rule has failed twice, in opposite directions, and the second failure was caused by
   * the fix for the first. The coccygeus — four centimetres of pelvic floor, entirely inside
   * the pelvis — had one end of its axis land nearer the hip capsule than the pelvis, so it
   * was bound across the hip and stretched by every hip movement in the library. The fix
   * asked whether the mesh was *long* enough for the chain, comparing it against the sum of
   * the distances between consecutive capsule origins. But a capsule's origin is where the
   * segment meets its parent, so the torso's is down at the pelvis: the chain torso to
   * humerus measured most of a trunk, and every muscle crossing the shoulder — pectoralis
   * major and minor, serratus anterior, subclavius, coracobrachialis, the deltoid and all
   * four of the rotator cuff — was judged too short to cross it and bound rigidly to the
   * torso. They then kept their shape perfectly while the arm walked away from them, which
   * is the flap that hangs off an abducted shoulder.
   *
   * Length was never the question. The question is whether the joint is *inside* the muscle:
   * a muscle crosses a joint when the joint centre lies within its own extent. The deltoid
   * wraps the shoulder and contains it; the coccygeus is nowhere near the hip. So the test is
   * containment, in the mesh's own box, with a margin for a belly that stops just short of
   * the centre of rotation. */
  const box = new THREE.Box3().setFromBufferAttribute(mesh.geometry.getAttribute('position'))
    .applyMatrix4(mesh.matrixWorld);
  box.expandByScalar(box.getSize(_p).length() * SPAN_MARGIN);
  const parentOf = (n) => rig.data.segments[n]?.parent;
  /* The joint centre is the joint node's own position, not the child capsule's origin.
   *
   * A capsule starts at its segment's *body* origin, and for most segments that is the joint —
   * but not for the torso, which `build_spine.py` re-parents onto T1 with a 43 cm offset, so
   * its body origin sits down at the pelvis while it articulates up at the neck. Testing
   * containment against the pelvis meant no shoulder structure could ever be said to cross
   * from the arm into the spine, which is how the axillary nerve came to be bound from C7 to
   * the skull with half of it out at the shoulder. */
  const jointAt = (n) => {
    const rec = rig.nodes.get(n);
    return rec ? _q.setFromMatrixPosition(rec.joint.matrixWorld).clone() : null;
  };
  /* Trim the chain to the joints the mesh actually contains, walking outward from the segment
   * it sits on rather than from an end.
   *
   * Two reasons it has to start in the middle. The nearest capsule to a muscle's far end is
   * often one segment past the joint it really crosses — the deltoid's reached a thoracic
   * vertebra, so its chain ran vertebra to torso to humerus and carried the torso's own root
   * joint down at the lumbar spine, which no shoulder muscle contains. And `chainBetween`
   * returns a path in tree order, not from the end we asked about, so "walk from the start"
   * meant different things for different muscles. Starting at the home segment and extending
   * while each next joint is inside the mesh gives every muscle exactly the joints it
   * crosses, whichever way the path happens to be written. */
  const mid = _p.copy(ax.a).add(ax.b).multiplyScalar(0.5);
  let at = 0, bestD = Infinity;
  for (let i = 0; i < chain.length; i++) {
    const cap = capsules[index.get(chain[i])];
    if (!cap) continue;
    const d = distToSegment(mid, cap.a, cap.b);
    if (d < bestD) { bestD = d; at = i; }
  }
  const jointBetween = (u, v) => jointAt(parentOf(v) === u ? v : u);
  /* Containment in the mesh's own box is the wrong test for a *sheet*.
   *
   * A joint is crossed when the muscle runs over it, and a superficial sheet runs over joints
   * that lie deep to it: latissimus dorsi is 24 cm long, 6 cm thick, and lies on the back
   * surface, while every vertebral joint centre it crosses sits well in front of it inside the
   * body. Its box therefore contained none of them, the walk stopped at the first one it could
   * not reach, and a chain the vote had correctly found as `pelvis > L5 … > T1 > torso >
   * humerus` was cut to `T1 > torso > humerus` — the whole lower-back origin welded to the
   * upper thorax while the insertion rode the arm, which is the sheet that flares out behind
   * the shoulder like a wing.
   *
   * Reach is the question, and it has to scale with the muscle: how far is the joint from the
   * muscle's own surface, against how big the muscle is. That keeps the rule that put this
   * test here in the first place — the coccygeus is four centimetres across and the hip centre
   * is five away, so it still crosses nothing — while letting a two-hundred-and-forty
   * millimetre sheet own the joints a few centimetres under it. */
  const _jv = new THREE.Vector3();
  const pos0 = mesh.geometry.getAttribute('position');
  const vstep = Math.max(1, Math.floor(pos0.count / 300));
  const reachOf = (j) => {
    let best = Infinity;
    for (let i = 0; i < pos0.count; i += vstep) {
      _jv.set(pos0.getX(i), pos0.getY(i), pos0.getZ(i)).applyMatrix4(mesh.matrixWorld);
      best = Math.min(best, _jv.distanceToSquared(j));
    }
    return Math.sqrt(best);
  };
  const span = box.getSize(_p).length();          // includes the SPAN_MARGIN already applied
  const holds = (u, v) => {
    const j = jointBetween(u, v);
    if (!j) return false;
    const d = reachOf(j);
    const inside = d <= span * JOINT_REACH;
    if (note) (note.joints ??= []).push([`${u}|${v}`, inside, +d.toFixed(4)]);
    return inside;
  };
  /* A nerve is not trimmed. Containment asks whether the muscle *wraps* each joint, which is
   * the right question for a muscle and the wrong one for a nerve: a nerve runs from its root
   * in the spine out to a limb, and the segments in between are its route rather than
   * something it lies along. The axillary nerve has 15% of its vertices by the humerus and
   * 37% by C1 with nothing on the torso capsule between them — the torso's axis runs down the
   * middle of the trunk, far from the shoulder — and the torso's own joint sits 43 cm from
   * where it articulates, because `build_spine.py` re-parents it onto T1 and expresses that
   * as an offset. Neither test can judge that link, and trimming on them bound a shoulder
   * nerve to the neck and the skull. */
  let lo = at, hi = at;
  if (trim) {
    while (lo > 0 && holds(chain[lo - 1], chain[lo])) lo--;
    while (hi < chain.length - 1 && holds(chain[hi], chain[hi + 1])) hi++;
  } else { lo = 0; hi = chain.length - 1; }
  const kept = chain.slice(lo, hi + 1);
  if (note) { note.chain = chain.join(' > '); note.kept = kept.join(' > '); }
  if (kept.length > 1) return kept;
  /* One segment: it crosses nothing. Ride the capsule nearest the middle of the mesh rather
   * than the one an end happened to resolve to — the coccygeus sits wholly inside the pelvis
   * and its axis ends both land nearer the hip, so `ca` would put it on the femur. */
  const home = nearestCapsule(pool, mid);
  return home ? [names[home.i]] : [names[ca.i]];
}

/**
 * Average a per-vertex scalar with its neighbours, over the mesh's own surface.
 *
 * The adjacency is built by welding on position rather than by trusting the index buffer.
 * These meshes come out of a decimator that splits vertices for normals, so two vertices at
 * the same point can share no triangle at all — and an unwelded graph smooths each shell of
 * a seam separately, which is exactly the seam that tears.
 */
export function smoothOverSurface(geo, value, passes) {
  const pos = geo.getAttribute('position');
  const idx = geo.index;
  if (!idx || !pos) return value;
  const n = pos.count;

  /* Weld first, and weld properly.
   *
   * Quantising a position into a grid cell is not a weld: two vertices a nanometre apart can
   * land either side of a cell boundary and stay strangers, which leaves the seam they sit on
   * smoothed independently on each side — and that seam is exactly where the mesh tears. So
   * the grid is only a lookup, and any two vertices within `WELD` of each other are joined,
   * across cell boundaries included.
   */
  const cell = WELD;
  const buckets = new Map();
  const cellKey = (x, y, z) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  for (let i = 0; i < n; i++) {
    const k = cellKey(pos.getX(i), pos.getY(i), pos.getZ(i));
    let b = buckets.get(k);
    if (!b) buckets.set(k, b = []);
    b.push(i);
  }
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[b] = a; };
  const tol2 = WELD * WELD;
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const b = buckets.get(`${cx + dx},${cy + dy},${cz + dz}`);
      if (!b) continue;
      for (const j of b) {
        if (j <= i) continue;
        const ex = pos.getX(j) - x, ey = pos.getY(j) - y, ez = pos.getZ(j) - z;
        if (ex * ex + ey * ey + ez * ez <= tol2) union(i, j);
      }
    }
  }
  const group = new Int32Array(n);
  const label = new Map();
  let groups = 0;
  for (let i = 0; i < n; i++) {
    const r = find(i);
    let g = label.get(r);
    if (g === undefined) label.set(r, g = groups++);
    group[i] = g;
  }

  // neighbours of each welded group, from the triangles
  const deg = new Int32Array(groups);
  const count = idx.count;
  for (let t = 0; t < count; t += 3) {
    const a = group[idx.getX(t)], b = group[idx.getX(t + 1)], c = group[idx.getX(t + 2)];
    deg[a] += 2; deg[b] += 2; deg[c] += 2;
  }
  const start = new Int32Array(groups + 1);
  for (let i = 0; i < groups; i++) start[i + 1] = start[i] + deg[i];
  const adj = new Int32Array(start[groups]);
  const fill = start.slice(0, groups);
  for (let t = 0; t < count; t += 3) {
    const a = group[idx.getX(t)], b = group[idx.getX(t + 1)], c = group[idx.getX(t + 2)];
    adj[fill[a]++] = b; adj[fill[a]++] = c;
    adj[fill[b]++] = a; adj[fill[b]++] = c;
    adj[fill[c]++] = a; adj[fill[c]++] = b;
  }

  // seed each group with the mean of its vertices, then relax
  let cur = new Float32Array(groups), next = new Float32Array(groups);
  const nv = new Int32Array(groups);
  for (let i = 0; i < n; i++) { cur[group[i]] += value[i]; nv[group[i]]++; }
  for (let g = 0; g < groups; g++) if (nv[g]) cur[g] /= nv[g];
  for (let p = 0; p < passes; p++) {
    for (let g = 0; g < groups; g++) {
      let sum = 0, m = 0;
      for (let e = start[g]; e < start[g + 1]; e++) { sum += cur[adj[e]]; m++; }
      next[g] = m ? cur[g] * 0.25 + (sum / m) * 0.75 : cur[g];
    }
    const t = cur; cur = next; next = t;
  }
  for (let i = 0; i < n; i++) value[i] = cur[group[i]];
  return value;
}

/**
 * Dominant segment per structure, for anything that needs one point rather than a field —
 * label anchors and the camera, which cannot follow a deforming mesh cheaply.
 */
export function dominantBone(geo, names) {
  const si = geo.getAttribute('skinIndex'), sw = geo.getAttribute('skinWeight');
  if (!si) return null;
  const total = new Map();
  const step = Math.max(1, Math.floor(si.count / 500));
  for (let i = 0; i < si.count; i += step)
    for (let k = 0; k < MAX_INFLUENCES; k++) {
      const b = si.getComponent(i, k), w = sw.getComponent(i, k);
      total.set(b, (total.get(b) ?? 0) + w);
    }
  let best = null, bestW = -1;
  for (const [b, w] of total) if (w > bestW) { bestW = w; best = b; }
  return best == null ? null : names[best];
}

/* --------------------------------------------------------- which segment a mesh belongs to
 *
 * These four used to live in `main.js`, which cannot be imported outside a browser — so
 * `tools/skinbench.mjs` had to reimplement them to measure the same binding, got
 * `attachmentsOf` subtly wrong, and cheerfully reported every left-side muscle bound to a
 * right-side chain. One copy, imported by both, is the only way that stays fixed.
 */
/**
 * The bodies a named muscle actually attaches to, from the OpenSim path model.
 *
 * A path's first and last points are its origin and insertion, which is exactly what the
 * skinning needs and is far better than guessing from the mesh's shape. 28 of the named
 * muscles have one; the rest fall back to their own long axis.
 */
const ATTACH = new Map();
export function indexAttachments(paths) {
  for (const m of paths?.muscles ?? []) {
    if (!m.mapsTo || !m.points?.length) continue;
    const first = m.points[0].body, last = m.points[m.points.length - 1].body;
    if (!first || !last || first === 'ground' || last === 'ground') continue;
    if (!ATTACH.has(m.mapsTo)) ATTACH.set(m.mapsTo, [first, last]);
  }
}
/** Sided lookup: the path table names `femur_r`, the mesh knows it is the right one. */
export function attachmentsOf(base, side) {
  const a = ATTACH.get(base);
  if (!a) return null;
  if (!side || side === 'M') return a;
  const want = side.toLowerCase() === 'l' ? '_l' : '_r';
  return a.map(n => n.replace(/_(r|l)$/, want));
}

const _mc = new THREE.Vector3(), _seg = new THREE.Vector3();
export function meshCentroid(o) {
  o.updateWorldMatrix(true, false);
  const pos = o.geometry.getAttribute('position');
  const c = new THREE.Vector3();
  const step = Math.max(1, Math.floor(pos.count / 240));
  let n = 0;
  for (let i = 0; i < pos.count; i += step) {
    _mc.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(o.matrixWorld);
    c.add(_mc); n++;
  }
  return n ? c.divideScalar(n) : c;
}

/**
 * Split a mesh name into the structure name and the side.
 *
 * **`GLTFLoader` renames every node on the way in.** `PropertyBinding.sanitizeNodeName`
 * replaces whitespace with underscores so that names are safe in animation track paths, so a
 * mesh this project wrote as `transversus abdominis|L` arrives in the browser as
 * `transversus_abdominis|L`. Everything keyed by name then missed, silently and completely:
 * `rig.segmentFor` returned null for all 245 skeleton meshes, so `buildBoneField` had nothing
 * to sample and every structure fell back to the joint-centre rule the field exists to
 * replace; `attachmentsOf` found no OpenSim path for any muscle. The node tools read the GLB
 * directly, saw the spaces, and reported that all of it worked — which is why the numbers
 * said the binding was fixed while the picture still showed an abdominal muscle up at the
 * shoulder. Anything that turns a mesh name into a lookup key goes through here.
 */
export function meshName(name) {
  const [base = '', side] = String(name || '').split('|');
  return [base.replace(/_/g, ' '), side];
}

/**
 * Where each segment's bones actually are, sampled off the skeleton itself.
 *
 * A capsule is a straight line between two joint centres, which is a fair description of a
 * femur and a poor one of a trunk: `torso` runs up the middle of the body, so every
 * structure on the trunk's *surface* — external oblique, latissimus, transversus abdominis —
 * is far from its own segment's line and close to the humerus, which in the bind pose hangs
 * a few centimetres away down the outside of the ribs. Proximity to a line therefore hands
 * half the abdominal wall to an arm.
 *
 * The skeleton does not have that problem. Its 245 meshes are bound by name — `SEGMENT_BONES`
 * in `parse_opensim.py` for the limbs, and `build_spine.py` puts every vertebra on its own
 * level and every rib on a thoracic one — so the bones are a labelled map of which segment
 * owns which piece of space, at the resolution of the real anatomy rather than of a
 * stick figure. A structure belongs to the segment whose *bone* it lies against.
 *
 * The samples are bucketed into a uniform grid so a lookup is a handful of cells rather than
 * a scan of fifteen thousand points.
 *
 * @param {Array<{name: string, geometry: THREE.BufferGeometry}>} meshes  skeleton meshes
 * @param {Rig} rig
 * @param {Map<string,number>} index  segment name -> bone index
 */
export function buildBoneField(meshes, rig, index) {
  const pts = [], segs = [];
  for (const m of meshes) {
    const [base, side] = meshName(m.name);
    const seg = rig.segmentFor(base, side || 'M');
    const i = seg != null ? index.get(seg) : undefined;
    if (i === undefined) continue;
    const pos = m.geometry?.getAttribute('position');
    if (!pos) continue;
    m.updateWorldMatrix?.(true, false);
    const world = m.matrixWorld;
    /* Enough samples to describe the bone's shape, capped so a dense skull does not swamp
     * the grid — every bone gets a say in proportion to its size, not its triangle count. */
    const step = Math.max(1, Math.floor(pos.count / BONE_SAMPLES));
    for (let v = 0; v < pos.count; v += step) {
      _p.set(pos.getX(v), pos.getY(v), pos.getZ(v));
      if (world) _p.applyMatrix4(world);
      pts.push(_p.x, _p.y, _p.z);
      segs.push(i);
    }
  }
  if (!segs.length) return null;
  const P = new Float32Array(pts), S = new Int32Array(segs);
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  for (let k = 0; k < S.length; k++) {
    min.x = Math.min(min.x, P[k * 3]); max.x = Math.max(max.x, P[k * 3]);
    min.y = Math.min(min.y, P[k * 3 + 1]); max.y = Math.max(max.y, P[k * 3 + 1]);
    min.z = Math.min(min.z, P[k * 3 + 2]); max.z = Math.max(max.z, P[k * 3 + 2]);
  }
  const cell = BONE_CELL;
  const nx = Math.max(1, Math.ceil((max.x - min.x) / cell) + 1);
  const ny = Math.max(1, Math.ceil((max.y - min.y) / cell) + 1);
  const nz = Math.max(1, Math.ceil((max.z - min.z) / cell) + 1);
  const buckets = new Map();
  const key = (a, b, c) => (a * ny + b) * nz + c;
  for (let k = 0; k < S.length; k++) {
    const a = Math.floor((P[k * 3] - min.x) / cell);
    const b = Math.floor((P[k * 3 + 1] - min.y) / cell);
    const c = Math.floor((P[k * 3 + 2] - min.z) / cell);
    const h = key(a, b, c);
    let list = buckets.get(h);
    if (!list) buckets.set(h, list = []);
    list.push(k);
  }
  return { P, S, min, cell, nx, ny, nz, buckets, key };
}

/** The segment whose bone is nearest `p`, or -1 if nothing is within reach. */
function segmentAtPoint(field, p, maxRings = 6) {
  const { P, S, min, cell, nx, ny, nz, buckets, key } = field;
  const a0 = Math.floor((p.x - min.x) / cell);
  const b0 = Math.floor((p.y - min.y) / cell);
  const c0 = Math.floor((p.z - min.z) / cell);
  let best = -1, bd = Infinity;
  for (let r = 0; r <= maxRings; r++) {
    for (let a = a0 - r; a <= a0 + r; a++) {
      if (a < 0 || a >= nx) continue;
      for (let b = b0 - r; b <= b0 + r; b++) {
        if (b < 0 || b >= ny) continue;
        for (let c = c0 - r; c <= c0 + r; c++) {
          if (c < 0 || c >= nz) continue;
          // only the new shell each ring, so the search does not re-test the middle
          if (r && Math.max(Math.abs(a - a0), Math.abs(b - b0), Math.abs(c - c0)) !== r) continue;
          const list = buckets.get(key(a, b, c));
          if (!list) continue;
          for (const k of list) {
            const dx = P[k * 3] - p.x, dy = P[k * 3 + 1] - p.y, dz = P[k * 3 + 2] - p.z;
            const d = dx * dx + dy * dy + dz * dz;
            if (d < bd) { bd = d; best = S[k]; }
          }
        }
      }
    }
    /* One ring past the first hit: the nearest point in a diagonal neighbour can still beat
     * the one found in this ring, and stopping early puts a structure on the wrong side of a
     * cell boundary. */
    if (best >= 0 && bd <= (r * cell) * (r * cell)) break;
  }
  return best;
}

/**
 * Fallback binding: the segment most of this mesh actually lies along.
 *
 * **A segment's origin is not where its bone is.** OpenSim puts a body's frame at the joint
 * where it meets its parent, so the femur's origin is the hip centre — up inside the pelvis,
 * beside the bladder — and the ulna's is the elbow, which on a figure standing with its arms
 * down is level with the waist. Measuring to origins therefore hands a structure the segment
 * on the *far* side of the nearest joint: the urinary bladder, the rectum, the urethra and
 * both testes were homed on a femur, so flexing a hip swung the pelvic viscera out of the
 * body with the thigh, and the left transversus abdominis was homed on `ulna_l` at 5.0 cm
 * while its own L1 sat at 5.5 cm — which put an abdominal wall muscle on a forearm, gave it
 * the arm's neighbourhood to be weighted against, and left it a rigid slab in a flexing
 * trunk while its mirror image articulated over five lumbar joints.
 *
 * So: nearest *bone*, voted over the mesh's own vertices. Voted, because the centroid of a
 * sheet like transversus abdominis or a horseshoe like the colon is a point in the space the
 * structure encloses rather than a point on the structure. Nearest bone rather than nearest
 * capsule, because a capsule is a line up the middle of a segment and the trunk's surface is
 * nowhere near the trunk's line — see `buildBoneField`.
 *
 * @param {THREE.Mesh} o
 * @param {Rig} rig
 * @param {object|Array} ref  the bone field from `buildBoneField`, or a capsule array as a
 *                            coarser stand-in; without either this falls back to the origin
 *                            test, which is what produced the bindings above
 */
export function nearestSegment(o, rig, ref = null) {
  const names = [...rig.nodes.keys()];
  const field = ref && !Array.isArray(ref) ? ref : null;
  const capsules = Array.isArray(ref) ? ref : null;
  const pos = ref && o.geometry?.getAttribute('position');
  if (!pos) {
    const c = meshCentroid(o);
    let best = null, bestD = Infinity;
    for (const [name, rec] of rig.nodes) {
      _seg.setFromMatrixPosition(rec.body.matrixWorld);
      const d = c.distanceToSquared(_seg);
      if (d < bestD) { bestD = d; best = name; }
    }
    return best;
  }
  o.updateWorldMatrix(true, false);
  const world = o.matrixWorld;
  const votes = new Map();
  const step = Math.max(1, Math.floor(pos.count / 240));
  for (let i = 0; i < pos.count; i += step) {
    _p.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(world);
    const at = field ? segmentAtPoint(field, _p) : (nearestCapsule(capsules, _p)?.i ?? -1);
    if (at >= 0) votes.set(at, (votes.get(at) ?? 0) + 1);
  }
  let best = null, bestN = -1;
  // ties break on segment order so the same mesh always lands on the same bone
  for (const [i, n] of [...votes].sort((a, b) => a[0] - b[0]))
    if (n > bestN) { bestN = n; best = names[i]; }
  return best ?? nearestSegment(o, rig);          // no vertices sampled: fall back to the centroid
}
