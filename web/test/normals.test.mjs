import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { mendNormals } from '../src/meshNormals.js';

/* A normal of exactly (0,0,0) is not a small error: the fragment shader normalises it, which
 * is a division by zero, so the lighting is NaN and the pixel comes out black. That is what
 * covered the thorax, the face and the hands in speckle at every x-ray setting. The loaded
 * atlas carried 6,458 of them -- 6.1% of the deep muscles and 58% of the internal
 * intercostals -- from two causes, both reproduced below. */

const zeroed = (g, at) => {
  const n = g.getAttribute('normal');
  for (const i of at) n.setXYZ(i, 0, 0, 0);
  return g;
};
const lengths = (g) => {
  const n = g.getAttribute('normal');
  const out = [];
  for (let i = 0; i < n.count; i++)
    out.push(Math.hypot(n.getX(i), n.getY(i), n.getZ(i)));
  return out;
};

test('a vertex whose faces cancel gets a normal off the surface, not zero', () => {
  /* A sheet with no thickness: the same three vertices wound both ways, which is what
   * decimation makes of an intercostal. The two face normals are exact negatives, so the
   * plain sum is zero however carefully it is weighted. */
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(
    [0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 1]);

  assert.equal(mendNormals(g), 3, 'all three were broken');
  for (const l of lengths(g)) assert.ok(Math.abs(l - 1) < 1e-5, `unit, got ${l}`);
  // and perpendicular to the sheet, which is the only direction the surface has
  const n = g.getAttribute('normal');
  for (let i = 0; i < 3; i++)
    assert.ok(Math.abs(Math.abs(n.getZ(i)) - 1) < 1e-5,
      `off the plane of the sheet, got ${n.getZ(i)}`);
});

test('a vertex no face refers to still gets a direction', () => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(
    [0, 0, 0, 1, 0, 0, 0, 1, 0, 5, 5, 5], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(
    [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0], 3));
  g.setIndex([0, 1, 2]);                        // nothing refers to vertex 3

  assert.equal(mendNormals(g), 1);
  const l = lengths(g);
  assert.ok(Math.abs(l[3] - 1) < 1e-5, `unit, got ${l[3]}`);
  // outward from the middle of the mesh, which is the only thing left to go on
  const n = g.getAttribute('normal');
  assert.ok(n.getX(3) > 0 && n.getY(3) > 0 && n.getZ(3) > 0);
});

test('the normals that were already good are left exactly as they were', () => {
  const g = new THREE.IcosahedronGeometry(1, 2);
  const before = lengths(g);
  const was = Float32Array.from(g.getAttribute('normal').array);
  assert.equal(mendNormals(g), 0, 'nothing to mend');
  assert.deepEqual(Array.from(g.getAttribute('normal').array), Array.from(was));
  for (const l of before) assert.ok(Math.abs(l - 1) < 1e-5);
});

test('mending a closed surface leaves every other vertex untouched', () => {
  const g = new THREE.IcosahedronGeometry(1, 2);
  const n = g.getAttribute('normal');
  const was = Float32Array.from(n.array);
  const broke = [3, 17, 41];
  zeroed(g, broke);

  assert.equal(mendNormals(g), broke.length);
  for (let i = 0; i < n.count; i++) {
    const l = Math.hypot(n.getX(i), n.getY(i), n.getZ(i));
    assert.ok(Math.abs(l - 1) < 1e-5, `vertex ${i} is unit, got ${l}`);
    if (broke.includes(i)) {
      // a sphere's vertex normal is its own direction, so the repair has to land on it
      const d = n.getX(i) * was[i*3] + n.getY(i) * was[i*3+1] + n.getZ(i) * was[i*3+2];
      assert.ok(d > 0.9, `vertex ${i} points where it did, dot ${d}`);
    } else {
      for (let k = 0; k < 3; k++)
        assert.equal(n.array[i*3+k], was[i*3+k], `vertex ${i} untouched`);
    }
  }
});

test('an unindexed geometry is mended the same way', () => {
  const g = new THREE.PlaneGeometry(1, 1, 2, 2).toNonIndexed();
  const n = g.getAttribute('normal');
  n.setXYZ(4, 0, 0, 0);
  assert.equal(mendNormals(g), 1);
  const l = Math.hypot(n.getX(4), n.getY(4), n.getZ(4));
  assert.ok(Math.abs(l - 1) < 1e-5, `unit, got ${l}`);
});

test('an interleaved or quantised attribute is written through, not overwritten raw', () => {
  /* A normal does not always arrive as a plain Float32Array. Writing floats straight into an
   * Int8 view would turn the repair into a much worse fault than the one it fixes, so the
   * whole pass goes through the attribute's own accessors. */
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(
    [0, 0, 1, 1, 0, 0, 0, 1, 0], 3));
  const q = new THREE.Int8BufferAttribute(new Int8Array([0, 0, 127, 0, 0, 127, 0, 0, 0]), 3, true);
  g.setAttribute('normal', q);
  g.setIndex([0, 1, 2]);

  assert.equal(mendNormals(g), 1, 'only the zeroed one');
  assert.ok(q.array instanceof Int8Array, 'still the array it was');
  const l = Math.hypot(q.getX(2), q.getY(2), q.getZ(2));
  assert.ok(l > 0.9 && l <= 1.01, `a real direction, got length ${l}`);
});
