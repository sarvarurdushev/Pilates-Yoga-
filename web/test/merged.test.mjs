import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import { mergeGeometry, mergeLayer, PICK_LAYER } from '../src/merged.js';

/**
 * The merge is a concatenation, and the ways a concatenation goes wrong are all
 * silent: an index that wraps at 65535 folds the far half of a body onto the
 * near half, a dropped skinning attribute welds a muscle to the bind pose, a
 * geometry merged with someone else's material comes out the colour of the
 * wrong layer. None of those throw. Each of them is a test here.
 */

let nextId = 1;
/** A little indexed geometry with the attributes a body mesh carries. */
function part({ verts = 4, region = 7, skin = true, at = 0 } = {}) {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(verts * 3);
  const nor = new Float32Array(verts * 3);
  const reg = new Float32Array(verts);
  for (let i = 0; i < verts; i++) {
    pos[i*3] = at + i; pos[i*3+1] = at; pos[i*3+2] = -at;
    nor[i*3+1] = 1;
    reg[i] = region;
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('_region', new THREE.BufferAttribute(reg, 1));
  if (skin) {
    const idx = new Uint16Array(verts * 4), w = new Float32Array(verts * 4);
    for (let i = 0; i < verts; i++) { idx[i*4] = region % 3; w[i*4] = 1; }
    g.setAttribute('skinIndex', new THREE.BufferAttribute(idx, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(w, 4));
  }
  const tri = [];
  for (let i = 0; i + 2 < verts; i++) tri.push(i, i + 1, i + 2);
  g.setIndex(tri);
  g.userData = { id: nextId++ };
  return g;
}

test('a merged geometry holds every vertex and every triangle of its parts', () => {
  const parts = [part({ verts: 5, region: 1 }), part({ verts: 8, region: 2 }),
                 part({ verts: 3, region: 3 })];
  const m = mergeGeometry(parts);
  assert.equal(m.getAttribute('position').count, 5 + 8 + 3);
  assert.equal(m.index.count, parts.reduce((n, g) => n + g.index.count, 0));
  for (const k of ['position', 'normal', '_region', 'skinIndex', 'skinWeight'])
    assert.ok(m.getAttribute(k), `the merge dropped ${k}`);
});

test('every triangle still points at its own part’s vertices', () => {
  /* The offsetting is the whole merge. Getting it wrong does not throw: it
   * draws triangles between structures, which looks like torn geometry. */
  const parts = [part({ verts: 5, region: 11, at: 0 }), part({ verts: 6, region: 22, at: 100 })];
  const m = mergeGeometry(parts);
  const reg = m.getAttribute('_region'), pos = m.getAttribute('position');
  for (let f = 0; f < m.index.count; f += 3) {
    const a = m.index.getX(f), b = m.index.getX(f + 1), c = m.index.getX(f + 2);
    assert.equal(reg.getX(a), reg.getX(b), 'a triangle spans two structures');
    assert.equal(reg.getX(b), reg.getX(c), 'a triangle spans two structures');
    // and the vertices it names are the ones that part actually wrote
    const near = reg.getX(a) === 11;
    assert.equal(pos.getX(a) < 50, near, 'an index points into the wrong part');
  }
});

test('an index wide enough for the body it merges', () => {
  /* 397 muscle meshes are far past 65535 vertices between them, and a Uint16
   * index does not fail there — it wraps, and the far half of the body is drawn
   * folded onto the near half. */
  const many = [];
  for (let i = 0; i < 40; i++) many.push(part({ verts: 2000, region: i }));
  const m = mergeGeometry(many);
  assert.equal(m.getAttribute('position').count, 80000);
  assert.ok(m.index.array instanceof Uint32Array,
    'a merge past 65535 vertices kept a 16-bit index');
  // the last part's triangles still address the last part
  const last = m.index.getX(m.index.count - 1);
  assert.ok(last >= 78000, `the final index wrapped: ${last}`);
});

test('a small merge keeps the narrow index', () => {
  const m = mergeGeometry([part({ verts: 4 }), part({ verts: 4 })]);
  assert.ok(m.index.array instanceof Uint16Array);
});

test('skinIndex keeps its integer array', () => {
  /* Written into a Float32Array it works right up until a body has more bones
   * than a float can address exactly, and then it is a rounding error that
   * moves a muscle to another limb. */
  const m = mergeGeometry([part({ verts: 4, region: 4 }), part({ verts: 4, region: 5 })]);
  assert.ok(m.getAttribute('skinIndex').array instanceof Uint16Array);
  assert.ok(m.getAttribute('skinWeight').array instanceof Float32Array);
});

test('a geometry missing an attribute the others have is refused, loudly', () => {
  assert.throws(() => mergeGeometry([part({ skin: true }), part({ skin: false })]),
    /missing skinIndex/);
});

test('the layer merge refuses what it cannot merge rather than merging it wrongly', () => {
  const mat = new THREE.MeshBasicMaterial();
  const other = new THREE.MeshBasicMaterial();
  const skel = new THREE.Skeleton([new THREE.Bone(), new THREE.Bone(), new THREE.Bone()]);
  const mk = (material = mat, tweak = null) => {
    const m = new THREE.SkinnedMesh(part({ verts: 4, region: 1 }), material);
    m.bind(skel, new THREE.Matrix4());
    tweak?.(m);
    return m;
  };
  assert.equal(mergeLayer([mk()], { material: mat }), null, 'one mesh is not a merge');
  assert.equal(mergeLayer([mk(), mk(other)], { material: mat }), null,
    'two materials merged into one draw call');
  assert.equal(mergeLayer([mk(), mk(mat, m => m.position.set(0, 1, 0))], { material: mat }), null,
    'a mesh with a transform of its own was merged at the identity');
  assert.equal(mergeLayer([mk(), mk(mat, m => m.bind(skel, new THREE.Matrix4().makeScale(2, 2, 2)))],
    { material: mat }), null, 'a mesh with its own bind matrix was merged');
  const mixed = new THREE.Mesh(part({ verts: 4, skin: false }), mat);
  assert.equal(mergeLayer([mk(), mixed], { material: mat }), null,
    'a skinned and a rigid mesh were merged into one');
});

test('what it does merge is one skinned mesh on the same skeleton', () => {
  const mat = new THREE.MeshBasicMaterial();
  const skel = new THREE.Skeleton([new THREE.Bone(), new THREE.Bone(), new THREE.Bone()]);
  const meshes = [1, 2, 3].map(r => {
    const m = new THREE.SkinnedMesh(part({ verts: 6, region: r }), mat);
    m.bind(skel, new THREE.Matrix4());
    return m;
  });
  const out = mergeLayer(meshes, { material: mat, name: 'muscles_deep' });
  assert.ok(out?.isSkinnedMesh, 'a skinned layer merged to something that is not skinned');
  assert.equal(out.skeleton, skel, 'the merge bound a different skeleton');
  assert.equal(out.material, mat);
  assert.equal(out.userData.layer, 'muscles_deep');
  assert.equal(out.userData.merged, true, 'onlyMeshes finds the merged drawable by this flag');
  assert.equal(out.userData.sources, 3);
  assert.equal(out.frustumCulled, false, 'a merged skinned layer culled against its bind pose');
  assert.equal(out.geometry.getAttribute('position').count, 18);
  // all three structures are in there, and separable by the attribute the palette indexes on
  const reg = out.geometry.getAttribute('_region');
  const seen = new Set();
  for (let i = 0; i < reg.count; i++) seen.add(reg.getX(i));
  assert.deepEqual([...seen].sort(), [1, 2, 3]);
});

test('the pick layer is not the layer the camera draws', () => {
  /* The source meshes are moved to it so the renderer skips them. Layer 0 would
   * mean drawing every structure twice — the merge for nothing. */
  assert.notEqual(PICK_LAYER, 0);
});
