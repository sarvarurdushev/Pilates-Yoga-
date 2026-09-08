import * as THREE from 'three';

/**
 * One draw call per layer instead of one per structure.
 *
 * A whole body is seven hundred and eighty-eight drawable meshes — 245 bones, 397
 * muscles, 90 organs, 40 nerves, each its own `Mesh` with its own buffers. Every
 * one of them is a separate submission: a state check, a bind, a draw. On a
 * discrete GPU that is a few milliseconds of driver time; on the integrated
 * graphics a studio laptop actually has, it is most of the frame, and it is
 * spent before a single pixel is shaded. It is also why turning the quality down
 * did not help — the cost was never in the shading.
 *
 * The structures inside one layer share everything a merge needs them to share.
 * They wear one material. The skinned ones are bound to one `Skeleton`, with an
 * identity bind matrix and identity transforms, because `skinMesh` builds them
 * that way and their geometry is already in body-frame coordinates. So the
 * merge is a concatenation and nothing more: no rebasing, no bone remapping, no
 * material atlas.
 *
 * ## What the merged mesh cannot do, and who does it instead
 *
 * A merged mesh has no per-structure anything — no visibility, no transform, no
 * name. Two of those it never needed: the palette has been indexed by the
 * `_region` vertex attribute since the beginning, so colour, selection, hover,
 * activation and the explode offset are already per structure inside one draw.
 * Visibility is the one that has to move, and it moves into the same texture:
 * `RegionPalette.setShown`, read in the vertex shader.
 *
 * Picking does **not** move. A ray wants many small bounded objects — 780 of the
 * 788 are rejected on their bounding sphere before a triangle is touched — and
 * drawing wants a few large ones. Those are different questions and they get
 * different structures: the per-structure meshes stay in the scene as the model
 * and the index, on a layer the camera does not render, and the merged mesh is a
 * cache derived from them. That is also why nothing else in the app had to
 * change: `bound`, `restByMesh`, `meshesOfId`, the label anchors and the camera
 * flights all still ask the meshes they always asked.
 */

/** The camera does not render this layer; the raycaster is told to. */
export const PICK_LAYER = 1;

/* Every attribute a body mesh carries, and the only ones it may carry: a merge
 * that silently dropped one would lose the skinning and weld the muscle to the
 * bind pose, which looks like a rig fault rather than a merge fault. */
const ATTRS = ['position', 'normal', '_region', 'skinIndex', 'skinWeight'];

/**
 * Concatenate geometries that share an attribute set.
 *
 * @param {THREE.BufferGeometry[]} geos  all indexed, same attributes, no groups
 * @returns {THREE.BufferGeometry|null}
 */
export function mergeGeometry(geos, matrices = null) {
  const src = geos.filter(g => g?.index && g.getAttribute('position'));
  if (!src.length) return null;
  if (matrices && matrices.length !== geos.length)
    throw new Error('merge: one matrix per geometry or none');

  const keys = ATTRS.filter(k => src[0].getAttribute(k));
  for (const g of src) {
    for (const k of keys)
      if (!g.getAttribute(k))
        throw new Error(`merge: a geometry is missing ${k}, which the others have`);
    if (Object.keys(g.attributes).length !== keys.length)
      throw new Error(`merge: a geometry carries an attribute the merge does not know ` +
        `(${Object.keys(g.attributes).sort().join(', ')} vs ${keys.join(', ')})`);
    if (g.groups.length) throw new Error('merge: a geometry has draw groups');
    if (g.morphAttributes && Object.keys(g.morphAttributes).length)
      throw new Error('merge: a geometry has morph targets');
  }

  let verts = 0, idx = 0;
  for (const g of src) { verts += g.getAttribute('position').count; idx += g.index.count; }

  const out = new THREE.BufferGeometry();
  for (const k of keys) {
    const a0 = src[0].getAttribute(k);
    const items = a0.itemSize;
    /* The array type is taken from the source rather than assumed: skinIndex is
     * unsigned integer and the rest are float, and writing bone indices into a
     * Float32Array works right up until a body has more than 2^24 of them. */
    const Arr = a0.array.constructor;
    const data = new Arr(verts * items);
    let at = 0;
    for (let gi = 0; gi < src.length; gi++) {
      const g = src[gi];
      const a = g.getAttribute(k);
      if (a.itemSize !== items)
        throw new Error(`merge: ${k} is ${a.itemSize} wide here and ${items} there`);
      data.set(a.array.subarray(0, a.count * items), at);
      /* A rigid mesh has been reparented into the rig, so its geometry is in its
       * bone's space and its own local matrix is what puts it where the bone
       * holds it. Merging without applying that stacks every bone in a limb at
       * the same place. The matrix is the *local* one and never the world one:
       * local is fixed at attach time, world is wherever the pose has the rig,
       * and baking a pose would weld the body into whatever it was doing when
       * the layer happened to load. */
      const M = matrices?.[gi];
      if (M) applyTo(k, data, at, a.count, items, M);
      at += a.count * items;
    }
    out.setAttribute(k, new THREE.BufferAttribute(data, items, a0.normalized));
  }

  /* Uint32 whenever the merged body could not be addressed in 16 bits — which is
   * every real layer here, and the reason a merge of 397 muscles came out with
   * the far half of the body folded onto the near half when this was left at the
   * source geometry's own index type. */
  const index = verts > 65535 ? new Uint32Array(idx) : new Uint16Array(idx);
  let ai = 0, base = 0;
  for (const g of src) {
    const gi = g.index.array;
    for (let i = 0; i < g.index.count; i++) index[ai + i] = gi[i] + base;
    ai += g.index.count;
    base += g.getAttribute('position').count;
  }
  out.setIndex(new THREE.BufferAttribute(index, 1));
  return out;
}

/**
 * The drawable for one layer, built from the meshes that layer has already bound.
 *
 * Returns null when the layer is not mergeable as it stands — a mesh with a
 * transform of its own, a second skeleton, a bind matrix that is not the
 * identity. Null is a refusal rather than a failure: the caller draws the layer
 * the way it always did, which is correct and slower, instead of drawing it
 * wrongly and fast.
 *
 * @param {THREE.Mesh[]} meshes
 * @param {{material: THREE.Material, skeleton?: THREE.Skeleton, name?: string}} opts
 */
export function mergeLayer(meshes, { material, skeleton = null, name = '' } = {}) {
  const src = meshes.filter(m => m?.isMesh && m.geometry);
  if (src.length < 2 || !material) return null;

  const skinned = src.filter(m => m.isSkinnedMesh);
  if (skinned.length && skinned.length !== src.length) return null;
  const skin = skinned.length > 0;

  for (const m of src) {
    if (m.material !== material) return null;
    if (!m.position.equals(ZERO) || !m.scale.equals(ONE)
        || Math.abs(m.quaternion.w - 1) > 1e-6) return null;
    if (skin) {
      if (m.skeleton !== (skeleton ?? skinned[0].skeleton)) return null;
      if (!isIdentity(m.bindMatrix)) return null;
    }
  }

  let geo;
  try { geo = mergeGeometry(src.map(m => m.geometry)); }
  catch (e) { console.error(`merge: ${name || 'layer'} not merged — ${e.message}`); return null; }
  if (!geo) return null;

  const out = skin ? new THREE.SkinnedMesh(geo, material) : new THREE.Mesh(geo, material);
  out.name = `${name || 'layer'}:merged`;
  /* The bounding sphere of a merged skinned layer describes the bind pose and is
   * useless the moment a clip moves it, and there is nothing to gain by culling
   * a layer that fills the frame anyway. */
  out.frustumCulled = false;
  out.userData = { layer: name, merged: true, sources: src.length, regions: regionsOf(geo) };
  if (skin) out.bind(skeleton ?? skinned[0].skeleton, new THREE.Matrix4());
  return out;
}

/* Positions move by the matrix; normals by its inverse transpose, so a
 * non-uniform scale does not tilt them. Nothing else is a direction or a point. */
const _v = new THREE.Vector3(), _nm = new THREE.Matrix3();
function applyTo(key, data, at, count, items, M) {
  if (key === 'position') {
    for (let i = 0; i < count; i++) {
      const o = at + i * items;
      _v.set(data[o], data[o+1], data[o+2]).applyMatrix4(M);
      data[o] = _v.x; data[o+1] = _v.y; data[o+2] = _v.z;
    }
  } else if (key === 'normal') {
    _nm.getNormalMatrix(M);
    for (let i = 0; i < count; i++) {
      const o = at + i * items;
      _v.set(data[o], data[o+1], data[o+2]).applyMatrix3(_nm).normalize();
      data[o] = _v.x; data[o+1] = _v.y; data[o+2] = _v.z;
    }
  }
}

/** Every structure a merged drawable stands for, read off the attribute the palette indexes. */
function regionsOf(geo) {
  const a = geo.getAttribute('_region');
  const out = new Set();
  if (a) for (let i = 0; i < a.count; i++) out.add(a.getX(i));
  return out;
}

/**
 * The rigid layers, merged one drawable per bone.
 *
 * Bones and organs are not skinned: `rig.attach` reparents each one into the rig
 * hierarchy so it rides its segment, which means they cannot all be merged into
 * one mesh the way the muscles can — a mesh has one parent, and these have
 * forty-seven between them.
 *
 * Merging them *per parent* keeps that exactly as it is. Nothing is rebound,
 * nothing is re-skinned, and — the reason to prefer this over rewriting them as
 * single-bone skins — a ray still meets a rigid mesh rather than a skinned one.
 * A bone raycast under dual-quaternion skinning walks every vertex of every
 * candidate triangle through a bone transform, on every pointer move; a rigid one
 * does not. Trading a cost paid once per frame for one paid on every hover would
 * have been a poor bargain for the last sixty draw calls.
 *
 * @returns {{parent: THREE.Object3D, mesh: THREE.Mesh}[]}
 */
export function mergeByParent(meshes, { material, name = '' } = {}) {
  const byParent = new Map();
  for (const m of meshes) {
    if (!m?.isMesh || m.isSkinnedMesh || !m.geometry || m.material !== material) continue;
    if (!m.parent) continue;
    if (!byParent.has(m.parent)) byParent.set(m.parent, []);
    byParent.get(m.parent).push(m);
  }
  const out = [];
  for (const [parent, list] of byParent) {
    // one mesh under a bone is already one draw call; merging it buys nothing
    // and costs a second copy of its geometry
    if (list.length < 2) continue;
    let geo;
    try {
      for (const m of list) m.updateMatrix();
      geo = mergeGeometry(list.map(m => m.geometry), list.map(m => m.matrix));
    } catch (e) {
      console.error(`merge: ${name || 'layer'} under ${parent.name || 'a node'} not merged ` +
        `— ${e.message}`);
      continue;
    }
    if (!geo) continue;
    const mesh = new THREE.Mesh(geo, material);
    mesh.name = `${name || 'layer'}:merged:${parent.name || 'node'}`;
    mesh.userData = { layer: name, merged: true, sources: list.length, regions: regionsOf(geo) };
    out.push({ parent, mesh, sources: list });
  }
  return out;
}

const ZERO = new THREE.Vector3(0, 0, 0);
const ONE = new THREE.Vector3(1, 1, 1);
const isIdentity = (m) => {
  const e = m.elements;
  for (let i = 0; i < 16; i++)
    if (Math.abs(e[i] - (i % 5 === 0 ? 1 : 0)) > 1e-6) return false;
  return true;
};
