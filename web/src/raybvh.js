import * as THREE from 'three';

/**
 * A bounding-volume hierarchy over a mesh's triangles, and a `raycast` that uses it.
 *
 * ## Why
 *
 * `Mesh.raycast` scans every triangle. That is the right trade for a scene of a
 * few dozen objects and the wrong one for this atlas: a ray down the middle of a
 * fully loaded body meets 382 structures whose bounding boxes it passes through,
 * scans 244,000 triangles, and finds 22 hits — the other 243,000 tests exist only
 * to prove a negative. Measured, that is 20 ms for one pick, and picking happens
 * on hover. It is also nine of those, 180 ms, every time `clearestDir` looks for
 * a line of sight to a structure the reader just clicked.
 *
 * The structures are small — a muscle is 1,250 triangles, a nerve 2,600 — so no
 * single mesh is slow. There are simply two thousand of them, and a bounding
 * sphere is a poor description of a sartorius: long, thin and diagonal, it has a
 * sphere the size of a thigh and a box nearly as bad, so neither of the cheap
 * rejections three already does can throw it away. What throws it away is
 * knowing where inside the mesh its triangles actually are.
 *
 * ## What this is
 *
 * The ordinary thing: a binary tree of axis-aligned boxes over the triangles,
 * split at the median along the widest axis, stored in flat typed arrays. A ray
 * walks it nearest child first and stops descending into any box whose entry
 * point is already further than the best hit found — which is what turns a scan
 * of every triangle into a scan of one leaf and its neighbours.
 *
 * It is built **lazily**, on the first ray that reaches a mesh, and cached on the
 * geometry. Building all two thousand up front would cost a few seconds of load
 * for structures most sessions never point at; building the ones a reader
 * actually sweeps over costs a few milliseconds each, once, and `warm()` spends
 * idle time draining the rest so even that is usually already paid.
 *
 * ## The one thing it cannot do
 *
 * The tree describes the geometry as it sits in the buffer — for a skinned mesh,
 * the bind pose. While the rig is at rest that is exactly what is drawn, and the
 * hits are the same hits three would return. Once a clip poses the body the
 * vertices move and the boxes do not, so `raycast` hands the mesh back to
 * three's own scan rather than answer from a tree that has gone stale.
 * `setRestTest` is how it is told which is the case.
 */

/** Triangles per leaf. Below this a linear scan is cheaper than another box test. */
const LEAF = 12;

/* A mesh with fewer triangles than this is already a leaf's worth of work and
 * gains nothing from a tree but the memory to hold it. */
const MIN_TRIS = LEAF * 3;

/**
 * Whether a skinned mesh's buffer still describes what is on screen.
 *
 * Defaults to "no", so a caller that forgets to set it gets three's own raycast
 * and correct answers, rather than fast wrong ones.
 */
let restTest = () => false;
export function setRestTest(fn) { restTest = fn; }

/**
 * Which pose the rig is in, as a number that changes when it moves.
 *
 * A tree built from the buffer describes the bind pose, so once a clip poses the
 * body it describes a body that is not there — and this used to hand those
 * meshes straight back to three's own scan. That was correct and it was the
 * whole cost: a pick went from 1.1 ms to **31.8 ms** the moment anything posed
 * the rig, and one click, which asks for nine lines of sight, went from 140 ms
 * to 580 ms. Hover runs once a frame, so a posed body was a body you could not
 * point at.
 *
 * So the tree is *refitted* instead: the boxes are recomputed from where the
 * vertices actually are, once per pose per mesh, and only for the meshes a ray
 * reaches. The triangles are tested at their skinned positions too, so the
 * answer is the answer three would give — this is the same search over the same
 * geometry, with the boxes brought up to date.
 */
let poseSerial = 0;
export const poseChanged = () => { poseSerial++; };

/**
 * The tree for a geometry, built on first use and cached on it.
 * @returns {object|null} null when the geometry cannot or need not be accelerated
 */
export function bvhFor(geometry) {
  if (geometry.userData.__bvh !== undefined) return geometry.userData.__bvh;
  let bvh = null;
  try { bvh = build(geometry); }
  catch (e) { console.error(`bvh: ${geometry.name || 'a geometry'} not built — ${e.message}`); }
  geometry.userData.__bvh = bvh;
  return bvh;
}

/** Has this geometry's tree been built yet? Used by the idle warm-up. */
export const bvhBuilt = (geometry) => geometry.userData.__bvh !== undefined;

function build(geo) {
  const posAttr = geo.getAttribute('position');
  const index = geo.index;
  if (!posAttr || !index) return null;
  if (posAttr.isInterleavedBufferAttribute || posAttr.itemSize !== 3) return null;
  const P = posAttr.array, I = index.array;
  const triCount = (I.length / 3) | 0;
  if (triCount < MIN_TRIS) return null;

  /* Per-triangle bounds and centroids. Transient: the tree keeps the ordering and
   * the node boxes, and these go back to the collector when the build returns. */
  const order = new Uint32Array(triCount);
  const cen = new Float32Array(triCount * 3);
  const tlo = new Float32Array(triCount * 3);
  const thi = new Float32Array(triCount * 3);
  for (let t = 0; t < triCount; t++) {
    order[t] = t;
    const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
    for (let k = 0; k < 3; k++) {
      const va = P[a + k], vb = P[b + k], vc = P[c + k];
      tlo[t * 3 + k] = va < vb ? (va < vc ? va : vc) : (vb < vc ? vb : vc);
      thi[t * 3 + k] = va > vb ? (va > vc ? va : vc) : (vb > vc ? vb : vc);
      cen[t * 3 + k] = (va + vb + vc) / 3;
    }
  }

  /* Sized for the worst tree the split below can produce. Sliced to the part
   * actually used before it is handed back, so the waste is transient. */
  const cap = 2 * triCount;
  const box = new Float32Array(cap * 6);
  const link = new Int32Array(cap * 2);   // leaf: [start, count]; internal: [left, 0]

  let used = 1;
  const stack = [0, 0, triCount];         // node, start, count
  while (stack.length) {
    const count = stack.pop(), start = stack.pop(), node = stack.pop();

    let lox = Infinity, loy = Infinity, loz = Infinity;
    let hix = -Infinity, hiy = -Infinity, hiz = -Infinity;
    let clox = Infinity, cloy = Infinity, cloz = Infinity;
    let chix = -Infinity, chiy = -Infinity, chiz = -Infinity;
    for (let i = start; i < start + count; i++) {
      const t = order[i] * 3;
      if (tlo[t] < lox) lox = tlo[t];
      if (tlo[t + 1] < loy) loy = tlo[t + 1];
      if (tlo[t + 2] < loz) loz = tlo[t + 2];
      if (thi[t] > hix) hix = thi[t];
      if (thi[t + 1] > hiy) hiy = thi[t + 1];
      if (thi[t + 2] > hiz) hiz = thi[t + 2];
      if (cen[t] < clox) clox = cen[t];
      if (cen[t + 1] < cloy) cloy = cen[t + 1];
      if (cen[t + 2] < cloz) cloz = cen[t + 2];
      if (cen[t] > chix) chix = cen[t];
      if (cen[t + 1] > chiy) chiy = cen[t + 1];
      if (cen[t + 2] > chiz) chiz = cen[t + 2];
    }
    const nb = node * 6;
    box[nb] = lox; box[nb + 1] = loy; box[nb + 2] = loz;
    box[nb + 3] = hix; box[nb + 4] = hiy; box[nb + 5] = hiz;

    if (count <= LEAF) { link[node * 2] = start; link[node * 2 + 1] = count; continue; }

    // widest spread of the centroids, which is where a split separates most
    const ex = chix - clox, ey = chiy - cloy, ez = chiz - cloz;
    const axis = ex > ey ? (ex > ez ? 0 : 2) : (ey > ez ? 1 : 2);
    const mid = axis === 0 ? clox + ex * 0.5
              : axis === 1 ? cloy + ey * 0.5
              : cloz + ez * 0.5;

    /* Hoare partition about the middle of the centroid spread. Cheaper than a
     * sort and, for a body part, very nearly as good: these are surfaces, not
     * adversarial point clouds. */
    let i = start, j = start + count - 1;
    while (i <= j) {
      if (cen[order[i] * 3 + axis] < mid) i++;
      else { const tmp = order[i]; order[i] = order[j]; order[j] = tmp; j--; }
    }
    let left = i - start;
    /* Every centroid on one side of the middle — a fan, a flat sheet, a ring of
     * coincident points. The boxes are computed from the triangles either way,
     * so halving the range is still a correct tree, just a less shapely one. */
    if (left === 0 || left === count) left = count >> 1;

    const l = used++, r = used++;
    link[node * 2] = l; link[node * 2 + 1] = 0;
    stack.push(l, start, left, r, start + left, count - left);
  }

  return {
    box: box.slice(0, used * 6),
    link: link.slice(0, used * 2),
    order,
    index: I,
    position: P,
    triCount,
  };
}

/* ------------------------------------------------------------------ raycast */

const _inv = new THREE.Matrix4();
const _ray = new THREE.Ray();
const _vA = new THREE.Vector3(), _vB = new THREE.Vector3(), _vC = new THREE.Vector3();
const _hit = new THREE.Vector3(), _world = new THREE.Vector3();
const _best = new THREE.Vector3();
/* Deep enough for any tree the split can build: the fallback halves the range,
 * so depth is bounded by log2(triangles), and each level pushes at most two. */
const _stackN = new Int32Array(128);
const _stackT = new Float64Array(128);

/**
 * The nearest hit on this mesh, or nothing.
 *
 * Installed as `mesh.raycast`, so `Raycaster.intersectObjects` and a direct
 * `mesh.raycast(ray, out)` both go through it. It returns **one** intersection
 * rather than every triangle the ray crosses, which is what lets it stop early —
 * and is all either caller here wants: `pick` takes the nearest hit on an object
 * and `clearestDir` asks only what blocks a line of sight first.
 */
export function bvhRaycast(raycaster, intersects) {
  const geo = this.geometry;
  const material = this.material;
  if (!geo || !material || Array.isArray(material)) return fallback(this, raycaster, intersects);
  const bvh = bvhFor(geo);
  if (!bvh) return fallback(this, raycaster, intersects);
  /* Posed, so the tree has to be brought to where the vertices are. Refitting
   * walks this mesh's vertices once; the scan it replaces walks them on every
   * candidate triangle, and does it again on the next pick. */
  const posed = this.isSkinnedMesh && !restTest();
  if (posed) {
    if (bvh.pose !== poseSerial) { refit(this, bvh); bvh.pose = poseSerial; }
  } else if (bvh.pose !== undefined && bvh.pose !== -1) {
    // back at the bind pose: the buffer describes it again
    refitFromBuffer(bvh);
    bvh.pose = -1;
  }

  _inv.copy(this.matrixWorld).invert();
  _ray.copy(raycaster.ray).applyMatrix4(_inv);
  /* Normalised, so a t along this ray is a distance in the mesh's own space and
   * the box entries and the triangle hits can be compared with each other. The
   * distance handed back to the caller is measured in world space regardless —
   * see below — so a scaled mesh reports what three would report. */
  const dirLen = _ray.direction.length();
  if (dirLen === 0) return;
  _ray.direction.multiplyScalar(1 / dirLen);

  const ox = _ray.origin.x, oy = _ray.origin.y, oz = _ray.origin.z;
  const dx = _ray.direction.x, dy = _ray.direction.y, dz = _ray.direction.z;
  const ix = 1 / dx, iy = 1 / dy, iz = 1 / dz;
  const { box, link, order, index: I, position: P } = bvh;

  const side = material.side;
  const backfaces = side === THREE.DoubleSide || side === THREE.BackSide;

  let bestT = Infinity, bestTri = -1;
  let sp = 0;
  _stackN[0] = 0; _stackT[0] = 0; sp = 1;

  while (sp > 0) {
    sp--;
    if (_stackT[sp] >= bestT) continue;          // a nearer hit is already found
    const node = _stackN[sp];
    const count = link[node * 2 + 1];
    if (count > 0) {
      const start = link[node * 2];
      for (let i = start; i < start + count; i++) {
        const t = order[i] * 3;
        if (posed) {
          this.getVertexPosition(I[t], _vA);
          this.getVertexPosition(I[t + 1], _vB);
          this.getVertexPosition(I[t + 2], _vC);
        } else {
          const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
          _vA.set(P[a], P[a + 1], P[a + 2]);
          _vB.set(P[b], P[b + 1], P[b + 2]);
          _vC.set(P[c], P[c + 1], P[c + 2]);
        }
        const p = side === THREE.BackSide
          ? _ray.intersectTriangle(_vC, _vB, _vA, true, _hit)
          : _ray.intersectTriangle(_vA, _vB, _vC, !backfaces, _hit);
        if (p === null) continue;
        const d = (_hit.x - ox) * dx + (_hit.y - oy) * dy + (_hit.z - oz) * dz;
        if (d < bestT) { bestT = d; bestTri = order[i]; _best.copy(_hit); }
      }
      continue;
    }
    const l = link[node * 2], r = l + 1;
    const tl = slab(box, l, ox, oy, oz, ix, iy, iz);
    const tr = slab(box, r, ox, oy, oz, ix, iy, iz);
    /* Far child pushed first so the near one is popped first: the whole point is
     * to find a real hit early and let the `>= bestT` test above prune the rest. */
    if (tl <= tr) {
      if (tr < bestT) { _stackN[sp] = r; _stackT[sp] = tr; sp++; }
      if (tl < bestT) { _stackN[sp] = l; _stackT[sp] = tl; sp++; }
    } else {
      if (tl < bestT) { _stackN[sp] = l; _stackT[sp] = tl; sp++; }
      if (tr < bestT) { _stackN[sp] = r; _stackT[sp] = tr; sp++; }
    }
  }

  if (bestTri < 0) return;

  /* World space for the distance and the point, exactly as three does it, so a
   * caller comparing hits across objects — which both of ours do — is comparing
   * the same quantity it always was. */
  _world.copy(_best).applyMatrix4(this.matrixWorld);
  const distance = raycaster.ray.origin.distanceTo(_world);
  if (distance < raycaster.near || distance > raycaster.far) return;

  const a = I[bestTri * 3], b = I[bestTri * 3 + 1], c = I[bestTri * 3 + 2];
  if (posed) {
    this.getVertexPosition(a, _vA);
    this.getVertexPosition(b, _vB);
    this.getVertexPosition(c, _vC);
  } else {
    _vA.set(P[a * 3], P[a * 3 + 1], P[a * 3 + 2]);
    _vB.set(P[b * 3], P[b * 3 + 1], P[b * 3 + 2]);
    _vC.set(P[c * 3], P[c * 3 + 1], P[c * 3 + 2]);
  }
  const normal = new THREE.Vector3();
  THREE.Triangle.getNormal(_vA, _vB, _vC, normal);
  intersects.push({
    distance,
    point: _world.clone(),
    object: this,
    faceIndex: bestTri,
    face: { a, b, c, normal, materialIndex: 0 },
  });
}

/**
 * Bring a tree's boxes to where the vertices actually are.
 *
 * Bottom-up, and the order falls out of how the tree was built: a node's children
 * are allocated after it, so their indices are always larger and one reverse pass
 * over the array visits every child before its parent.
 *
 * A leaf is measured through the mesh's own `getVertexPosition`, which is what
 * applies the skinning — so this is the same geometry the shader draws, and the
 * hits found in it are the hits three would find.
 */
const _rv = new THREE.Vector3();
function refitWith(bvh, at) {
  const { box, link, order, index: I } = bvh;
  const nodes = link.length / 2;
  for (let node = nodes - 1; node >= 0; node--) {
    const nb = node * 6;
    const count = link[node * 2 + 1];
    if (count > 0) {
      const start = link[node * 2];
      let lox = Infinity, loy = Infinity, loz = Infinity;
      let hix = -Infinity, hiy = -Infinity, hiz = -Infinity;
      for (let i = start; i < start + count; i++) {
        const t = order[i] * 3;
        for (let k = 0; k < 3; k++) {
          at(I[t + k], _rv);
          if (_rv.x < lox) lox = _rv.x;
          if (_rv.y < loy) loy = _rv.y;
          if (_rv.z < loz) loz = _rv.z;
          if (_rv.x > hix) hix = _rv.x;
          if (_rv.y > hiy) hiy = _rv.y;
          if (_rv.z > hiz) hiz = _rv.z;
        }
      }
      box[nb] = lox; box[nb + 1] = loy; box[nb + 2] = loz;
      box[nb + 3] = hix; box[nb + 4] = hiy; box[nb + 5] = hiz;
    } else {
      const l = link[node * 2] * 6, r = l + 6;
      for (let k = 0; k < 3; k++) box[nb + k] = Math.min(box[l + k], box[r + k]);
      for (let k = 3; k < 6; k++) box[nb + k] = Math.max(box[l + k], box[r + k]);
    }
  }
}

/** Refit from where the rig currently holds this mesh's vertices. */
const refit = (mesh, bvh) => refitWith(bvh, (i, v) => mesh.getVertexPosition(i, v));

/** And back from the buffer, for a mesh that has returned to the bind pose. */
const refitFromBuffer = (bvh) => refitWith(bvh, (i, v) => {
  const P = bvh.position;
  v.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
});

/**
 * Slab test: the entry distance along the ray, or Infinity if it misses.
 *
 * The `!== ` self-comparisons are the NaN guards, and they are not decoration. A
 * ray with a zero component — straight down the body's axis, which is exactly
 * what an orthographic-looking view produces — makes that axis's reciprocal
 * infinite, and a box face lying exactly on the origin then computes `0 *
 * Infinity`. Without the guards that NaN propagates and the box is silently
 * missed. This is three's own arrangement in `Ray.intersectBox`, for the same
 * reason.
 */
function slab(box, node, ox, oy, oz, ix, iy, iz) {
  const n = node * 6;
  let lo, hi, ylo, yhi, zlo, zhi;
  if (ix >= 0) { lo = (box[n] - ox) * ix; hi = (box[n + 3] - ox) * ix; }
  else { lo = (box[n + 3] - ox) * ix; hi = (box[n] - ox) * ix; }
  if (iy >= 0) { ylo = (box[n + 1] - oy) * iy; yhi = (box[n + 4] - oy) * iy; }
  else { ylo = (box[n + 4] - oy) * iy; yhi = (box[n + 1] - oy) * iy; }
  if (lo > yhi || ylo > hi) return Infinity;
  if (ylo > lo || lo !== lo) lo = ylo;
  if (yhi < hi || hi !== hi) hi = yhi;
  if (iz >= 0) { zlo = (box[n + 2] - oz) * iz; zhi = (box[n + 5] - oz) * iz; }
  else { zlo = (box[n + 5] - oz) * iz; zhi = (box[n + 2] - oz) * iz; }
  if (lo > zhi || zlo > hi) return Infinity;
  if (zlo > lo || lo !== lo) lo = zlo;
  if (zhi < hi || hi !== hi) hi = zhi;
  if (hi < 0) return Infinity;
  return lo > 0 ? lo : 0;
}

/* three's own, for the cases the tree refuses: an unindexed or interleaved
 * geometry, a mesh with several materials, or a skinned one while the rig is
 * posed and the buffer no longer says where the surface is. */
const meshRaycast = THREE.Mesh.prototype.raycast;
const skinRaycast = THREE.SkinnedMesh.prototype.raycast;
function fallback(mesh, raycaster, intersects) {
  (mesh.isSkinnedMesh ? skinRaycast : meshRaycast).call(mesh, raycaster, intersects);
}

/**
 * Use the tree for this mesh's rays.
 *
 * Per mesh rather than on the prototype: everything else in the scene — the soma
 * cloud, the section planes, the network — keeps three's raycast, so nothing
 * outside the atlas changes behaviour because the atlas got faster.
 */
export function accelerate(mesh) {
  if (mesh?.isMesh) mesh.raycast = bvhRaycast;
}

/**
 * Spend idle time building the trees nobody has asked for yet.
 *
 * Lazy building is correct but lumpy: the first sweep across a loaded body pays
 * for a hundred meshes at once, and that lands as a stutter on the very gesture
 * this is meant to smooth. Draining the queue while the browser has nothing else
 * to do moves that cost off the interaction entirely — and because `bvhFor`
 * caches on the geometry, a mesh built here and a mesh built on demand are the
 * same mesh afterwards.
 *
 * It stops as soon as there is nothing left to build, so a loaded body costs no
 * standing timer. Call it again when a layer arrives.
 *
 * @param {() => Iterable<THREE.Mesh>} supply  the meshes worth warming
 */
export function warm(supply, { slice = 4 } = {}) {
  if (warming) return;
  const idle = globalThis.requestIdleCallback
    ?? ((fn) => setTimeout(() => fn({ timeRemaining: () => 6 }), 40));
  let queue = null;
  warming = true;
  const step = (deadline) => {
    if (!queue?.length) {
      queue = [];
      for (const m of supply())
        if (m?.geometry && !bvhBuilt(m.geometry)) queue.push(m);
      if (!queue.length) { warming = false; return; }   // nothing left; no standing timer
    }
    let n = 0;
    while (queue.length && n < slice && deadline.timeRemaining() > 2) {
      bvhFor(queue.pop().geometry);
      n++;
    }
    idle(step);
  };
  idle(step);
}
let warming = false;
