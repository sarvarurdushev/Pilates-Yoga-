import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import { bvhFor, bvhRaycast, accelerate, setRestTest } from '../src/raybvh.js';

/**
 * A tree that answers a different question from the scan it replaces is worse
 * than no tree at all: picking would select a structure the reader did not point
 * at, and nothing on screen would say so. So every test here is the same test —
 * the accelerated hit against three's own, on the same ray, to the millimetre.
 */

/** Deterministic noise, so a failure can be reproduced from the seed alone. */
function rng(seed = 1) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** A lumpy closed surface with enough triangles to be worth a tree. */
function blob(seed = 1, segments = 24) {
  const r = rng(seed);
  const g = new THREE.SphereGeometry(1, segments, segments);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const k = 0.7 + r() * 0.6;
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
  }
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** A long thin diagonal thing — the shape a sphere describes worst. */
function strand(seed = 3) {
  const g = new THREE.CylinderGeometry(0.04, 0.04, 3, 10, 60);
  g.rotateZ(0.7); g.rotateX(0.4);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

const plainMesh = (geo, mat) => {
  const m = new THREE.Mesh(geo, mat);
  m.updateMatrixWorld(true);
  return m;
};

/** Nearest of three's own hits, in the shape bvhRaycast returns. */
function reference(mesh, ray) {
  const out = [];
  THREE.Mesh.prototype.raycast.call(mesh, ray, out);
  out.sort((a, b) => a.distance - b.distance);
  return out[0] ?? null;
}

function accelerated(mesh, ray) {
  const out = [];
  bvhRaycast.call(mesh, ray, out);
  return out[0] ?? null;
}

/**
 * Rays aimed at the mesh's own vertices, jittered.
 *
 * Rays at the origin are no test of a long thin diagonal thing: thirteen of four
 * hundred reached a strand, and a tree that answered all thirteen would have
 * proved nothing about the other 387. Aiming at points the surface actually
 * occupies keeps the hit rate high whatever the shape, and the jitter is what
 * still produces the near misses — the case a slab test gets wrong.
 */
function* rays(mesh, seed, n, jitter = 0.35) {
  const r = rng(seed);
  const p = mesh.geometry.getAttribute('position');
  const at = new THREE.Vector3(), from = new THREE.Vector3();
  const caster = new THREE.Raycaster();
  for (let i = 0; i < n; i++) {
    at.fromBufferAttribute(p, (r() * p.count) | 0).applyMatrix4(mesh.matrixWorld);
    at.x += (r() * 2 - 1) * jitter;
    at.y += (r() * 2 - 1) * jitter;
    at.z += (r() * 2 - 1) * jitter;
    from.set(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1).normalize().multiplyScalar(6);
    caster.set(from, at.clone().sub(from).normalize());
    yield caster;
  }
}

test('a blob answers exactly what the scan answers', () => {
  const mesh = plainMesh(blob(1), new THREE.MeshBasicMaterial());
  assert.ok(bvhFor(mesh.geometry), 'a 1000-triangle blob is worth a tree');
  let hits = 0;
  for (const ray of rays(mesh, 11, 300)) {
    const want = reference(mesh, ray), got = accelerated(mesh, ray);
    assert.equal(!!got, !!want, 'hit or miss must agree');
    if (!want) continue;
    hits++;
    assert.ok(Math.abs(got.distance - want.distance) < 1e-9,
      `distance ${got.distance} vs ${want.distance}`);
    assert.ok(got.point.distanceTo(want.point) < 1e-9, 'point');
    assert.equal(got.face.a, want.face.a, 'the same triangle');
  }
  assert.ok(hits > 120, `only ${hits} of 300 rays hit; the test is not testing much`);
});

test('a long thin diagonal strand agrees too', () => {
  const mesh = plainMesh(strand(), new THREE.MeshBasicMaterial());
  assert.ok(bvhFor(mesh.geometry));
  let hits = 0;
  for (const ray of rays(mesh, 29, 400, 0.12)) {
    const want = reference(mesh, ray), got = accelerated(mesh, ray);
    assert.equal(!!got, !!want);
    if (!want) continue;
    hits++;
    assert.ok(Math.abs(got.distance - want.distance) < 1e-9);
  }
  assert.ok(hits > 100, `only ${hits} rays reached the strand`);
});

test('a moved, turned and scaled mesh reports world distances', () => {
  const mesh = plainMesh(blob(7), new THREE.MeshBasicMaterial());
  mesh.position.set(1.3, -0.8, 0.4);
  mesh.rotation.set(0.5, 1.1, -0.3);
  mesh.scale.set(0.6, 1.4, 0.9);
  mesh.updateMatrixWorld(true);
  bvhFor(mesh.geometry);
  let hits = 0;
  for (const ray of rays(mesh, 101, 300)) {
    const want = reference(mesh, ray), got = accelerated(mesh, ray);
    assert.equal(!!got, !!want);
    if (!want) continue;
    hits++;
    assert.ok(Math.abs(got.distance - want.distance) < 1e-9);
    assert.ok(got.point.distanceTo(want.point) < 1e-9);
  }
  assert.ok(hits > 150, `only ${hits} hits`);
});

test('front, back and double sided are the sides three uses', () => {
  for (const side of [THREE.FrontSide, THREE.BackSide, THREE.DoubleSide]) {
    const mesh = plainMesh(blob(5), new THREE.MeshBasicMaterial({ side }));
    bvhFor(mesh.geometry);
    let seen = 0;
    for (const ray of rays(mesh, 3, 200)) {
      const want = reference(mesh, ray), got = accelerated(mesh, ray);
      assert.equal(!!got, !!want, `side ${side}: hit or miss`);
      if (!want) continue;
      seen++;
      assert.ok(Math.abs(got.distance - want.distance) < 1e-9, `side ${side}`);
    }
    assert.ok(seen > 80, `side ${side}: only ${seen} hits`);
  }
});

test('a ray straight down an axis does not fall through on a NaN', () => {
  // Axis-aligned box faces sit exactly on the ray's origin plane, which is where
  // `0 * Infinity` happens if the slab test is written the naive way.
  const g = new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  g.computeBoundingBox(); g.computeBoundingSphere();
  const mesh = plainMesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  bvhFor(g);
  const caster = new THREE.Raycaster();
  for (const [o, d] of [
    [[0, 0, 5], [0, 0, -1]], [[0, 5, 0], [0, -1, 0]], [[5, 0, 0], [-1, 0, 0]],
    [[0.5, 0.5, 5], [0, 0, -1]], [[-0.5, 0, 5], [0, 0, -1]],
  ]) {
    caster.set(new THREE.Vector3(...o), new THREE.Vector3(...d));
    const want = reference(mesh, caster), got = accelerated(mesh, caster);
    assert.equal(!!got, !!want, `axis ray from ${o}`);
    if (want) assert.ok(Math.abs(got.distance - want.distance) < 1e-9, `axis ray from ${o}`);
  }
});

test('a mesh too small for a tree still answers, through three', () => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    -1, -1, 0, 1, -1, 0, 0, 1, 0,
  ]), 3));
  g.setIndex([0, 1, 2]);
  g.computeBoundingBox(); g.computeBoundingSphere();
  assert.equal(bvhFor(g), null, 'one triangle is not worth a tree');
  const mesh = plainMesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  const caster = new THREE.Raycaster();
  caster.set(new THREE.Vector3(0, 0, 3), new THREE.Vector3(0, 0, -1));
  const got = accelerated(mesh, caster);
  assert.ok(got && Math.abs(got.distance - 3) < 1e-9, 'the fallback still hits it');
});

test('a posed skinned mesh is handed back to three rather than answered stale', () => {
  const g = blob(9);
  const verts = g.getAttribute('position').count;
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(verts * 4), 4));
  const w = new Float32Array(verts * 4);
  for (let i = 0; i < verts; i++) w[i * 4] = 1;
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(w, 4));
  const bone = new THREE.Bone();
  const skeleton = new THREE.Skeleton([bone]);
  const mesh = new THREE.SkinnedMesh(g, new THREE.MeshBasicMaterial());
  mesh.add(bone);
  mesh.bind(skeleton, new THREE.Matrix4());
  mesh.updateMatrixWorld(true);
  skeleton.update();

  let asked = 0;
  setRestTest(() => { asked++; return false; });
  const caster = new THREE.Raycaster();
  caster.set(new THREE.Vector3(0, 0, 4), new THREE.Vector3(0, 0, -1));
  const out = [];
  bvhRaycast.call(mesh, caster, out);
  assert.equal(asked, 1, 'it asked whether the buffer is still what is drawn');
  assert.equal(g.userData.__bvh, undefined, 'and built nothing it could not trust');
  assert.ok(out.length >= 1, 'three still found the surface');

  setRestTest(() => true);
  const out2 = [];
  bvhRaycast.call(mesh, caster, out2);
  assert.ok(g.userData.__bvh, 'at rest it builds and uses the tree');
  assert.ok(Math.abs(out2[0].distance - out.sort((a, b) => a.distance - b.distance)[0].distance) < 1e-9,
    'and agrees with three at the bind pose');
  setRestTest(() => false);
});

test('accelerate installs it only on meshes', () => {
  const mesh = plainMesh(blob(2), new THREE.MeshBasicMaterial());
  accelerate(mesh);
  assert.equal(mesh.raycast, bvhRaycast);
  const notAMesh = new THREE.Object3D();
  accelerate(notAMesh);
  assert.equal(notAMesh.raycast, THREE.Object3D.prototype.raycast);
  accelerate(null);          // must not throw
});
