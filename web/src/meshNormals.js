import * as THREE from 'three';

/**
 * Give every vertex a normal that points somewhere.
 *
 * A normal of exactly (0,0,0) is not a small error. The fragment shader normalises it, which
 * is a division by zero, which is NaN; NaN reaches the lighting, the ACES fit turns NaN into
 * NaN, and the driver writes the pixel black. So one bad vertex is a black triangle, and a
 * run of them is the speckle that covered the thorax, the face and the hands at every x-ray
 * setting — "your xray body also look horrible". It is worst in x-ray only because the
 * transparent pass shades every layer instead of the nearest one, so fragments that were
 * hidden behind good ones start contributing.
 *
 * Measured on the loaded atlas: 6,458 vertices of 318,357 carry a zero normal — 0.3% of the
 * skeleton, 1.8% of the superficial muscles, **6.1% of the deep muscles**, and 58% of the
 * internal intercostals. Two causes, both in `scripts/glb_common.py`, which is fixed there as
 * well:
 *
 *  * **A vertex no face refers to.** The accumulator starts at zero and nothing adds to it.
 *    Welding drops collapsed triangles, so this is not rare.
 *  * **A sheet with no thickness.** An intercostal or the wall of the heart comes out of
 *    decimation with its two sides coincident and wound opposite ways, so the face normals
 *    meeting at a vertex are exact negatives of each other and sum to nothing. This is why
 *    the thin muscles are the worst hit, and why averaging harder does not help.
 *
 * A broken vertex is asked again, three ways, in order. Accumulate the faces *outward* —
 * every face normal flipped to agree with the direction from the mesh's middle to the vertex
 * before it is added, so the two sides of a sheet reinforce instead of cancelling. Failing
 * that (a flat sheet whose own plane contains that direction, so the flip cannot tell its
 * sides apart), take one adjacent face's normal: a true surface normal, even though which
 * side it belongs to is arbitrary for a surface with no thickness. Failing that — a vertex
 * with no faces at all — take the outward direction itself, which is always defined.
 *
 * Only the broken vertices are touched: a mesh with none is one pass over its normals and no
 * writes at all.
 *
 * This runs on the geometry as loaded, so it repairs the assets already built and shipped.
 * The generator is fixed too, so a rebuild does not reintroduce them.
 *
 * @returns {number} how many normals were replaced
 */
export function mendNormals(geometry) {
  const nrm = geometry.getAttribute('normal');
  const pos = geometry.getAttribute('position');
  if (!nrm || !pos || nrm.count !== pos.count) return 0;
  const n = nrm.count;

  /* Read and written through the attribute rather than through `array`, because an attribute
   * is not always a plain Float32Array: a normal can arrive quantised or interleaved, and
   * writing floats straight into an Int8 view would turn a repair into a much worse fault
   * than the one it is fixing. */
  /* Which ones are broken. A typed flag rather than a Set, because the face walk below tests
   * three of these per triangle over the whole index and a Set lookup there is the cost of
   * the pass. */
  const want = new Uint8Array(n);
  let bad = 0;
  for (let i = 0; i < n; i++) {
    const x = nrm.getX(i), y = nrm.getY(i), z = nrm.getZ(i);
    const l = x*x + y*y + z*z;
    if (!(l > 1e-12)) { want[i] = 1; bad++; }        // also catches NaN, which fails every test
  }
  if (!bad) return 0;

  // the middle of the mesh, to decide which way is out
  geometry.computeBoundingBox();
  const mid = geometry.boundingBox.getCenter(new THREE.Vector3());

  const acc = new Float64Array(bad * 3);
  const one = new Float64Array(bad * 3);      // any one adjacent face, as a second answer
  const slot = new Int32Array(n).fill(-1);
  let k = 0;
  for (let i = 0; i < n; i++) if (want[i]) slot[i] = k++;

  const outward = (i, t) => {
    t.set(pos.getX(i) - mid.x, pos.getY(i) - mid.y, pos.getZ(i) - mid.z);
    if (t.lengthSq() < 1e-20) t.set(0, 1, 0);
    return t.normalize();
  };

  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3();
  const fn = new THREE.Vector3(), out = new THREE.Vector3();
  const face = (i0, i1, i2) => {
    if (!want[i0] && !want[i1] && !want[i2]) return;
    a.fromBufferAttribute(pos, i0);
    b.fromBufferAttribute(pos, i1);
    c.fromBufferAttribute(pos, i2);
    ab.subVectors(b, a); ac.subVectors(c, a);
    fn.crossVectors(ab, ac);
    // a collapsed triangle has no direction to give, and its cross product is noise
    if (!(fn.lengthSq() > 1e-24)) return;
    fn.normalize();
    for (const v of [i0, i1, i2]) {
      if (!want[v]) continue;
      outward(v, out);
      const s = fn.dot(out) < 0 ? -1 : 1;
      const o = slot[v] * 3;
      acc[o] += fn.x * s; acc[o+1] += fn.y * s; acc[o+2] += fn.z * s;
      one[o] = fn.x; one[o+1] = fn.y; one[o+2] = fn.z;
    }
  };

  const idx = geometry.getIndex();
  if (idx) {
    const I = idx.array;
    for (let f = 0; f + 2 < I.length; f += 3) face(I[f], I[f+1], I[f+2]);
  } else {
    for (let f = 0; f + 2 < n; f += 3) face(f, f + 1, f + 2);
  }

  for (let i = 0; i < n; i++) {
    if (!want[i]) continue;
    const o = slot[i] * 3;
    fn.set(acc[o], acc[o+1], acc[o+2]);
    if (!(fn.lengthSq() > 1e-20)) fn.set(one[o], one[o+1], one[o+2]);
    if (fn.lengthSq() > 1e-20) fn.normalize();
    else outward(i, fn);                     // no face could speak for it at all
    nrm.setXYZ(i, fn.x, fn.y, fn.z);
  }
  nrm.needsUpdate = true;
  return bad;
}
