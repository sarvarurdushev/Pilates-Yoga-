/**
 * Non-cortical anatomy, loaded from real segmentation rather than modelled by hand.
 *
 * Source: fsaverage/mri/aseg.mgz — FreeSurfer's automatic subcortical segmentation
 * (Fischl et al., Neuron 2002). scripts/build_subcortical.py marching-cubes each label,
 * Taubin-smooths it, decimates it and writes one primitive per structure carrying its
 * region id. Nothing here is a generated sphere or tube any more.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/** structures that sit inside the cortex and are therefore hidden in Anatomical mode */
export const INTERIOR_IDS = new Set([20, 21, 22, 23, 24, 25]);
/* The cerebellum and the brainstem are visible brain surface, not interior structures, so
 * they wear tissue colour rather than an atlas colour — which means this constant has to
 * track the cortex's own base (TISSUE_COLOURS in tissue.js) or the two halves of one organ
 * are drawn in two different colours. That has now gone wrong twice in a row in the same
 * way, once in each direction. */
export const TISSUE = '#E8A063';
/** What the deep structures glow at rest. They take their atlas colour on demand, not by
 *  default — see `tintStructure`. */
export const CORE = '#FFC27A';

/** Repaint a structure between tissue colour and its region colour. */
export function tintStructure(group, { selected, atlas }) {
  group.traverse(m => {
    /* Only the meshes this file gave a material to. The cerebellum and the brainstem now
     * share the cortex's volume material, whose userData carries uniforms and a palette and
     * no `base` — so destructuring one out of it and calling `.copy` on it threw on every
     * sync, which took down the load of whatever layer happened to trigger it. A shared
     * material means shared userData; anything keyed to a mesh has to check it owns it. */
    if (!m.isMesh || !m.material.userData?.base) return;
    const { base, region, interior } = m.material.userData;
    /* Interior structures used to be pinned to their atlas colour, which put a red
     * hippocampus and a blue thalamus in the middle of an amber organ at rest — the core is
     * meant to read as light coming out of the tissue, and a colour key is something you ask
     * for. They follow the colour-code control like everything else now. */
    const k = selected ? 1 : atlas;
    m.material.color.copy(base).lerp(region, k);
    /* Selection is brightness, not an emissive channel: these are additive now and
     * `emissiveIntensity` does nothing on a basic material. */
    if (selected) m.material.color.multiplyScalar(1.8);
  });
}

const COLORS = {
  5:'#E255B4', 6:'#E2685F', 20:'#39C2C9', 21:'#F2555A',
  22:'#7C9CF5', 23:'#E9E4D8', 24:'#4FD1E8', 25:'#C0A15E',
};

/**
 * @param tissue the cortex's own material. The cerebellum and the brainstem wear it, because
 *   they are outer brain surface and anything else makes them a lump inside a translucent
 *   organ — this is the third time those two have had to be brought back into line with the
 *   cortex after it was retuned, so they now share the material rather than a colour.
 */
export function loadDeepStructures(url, onDone, tissue = null) {
  const group = new THREE.Group();
  group.name = 'segmented';
  new GLTFLoader().load(url, (gltf) => {
    const byRegion = new Map();
    // collect first: calling add() inside traverse() reparents the mesh and mutates the
    // children array being iterated, which leaves undefined holes in the tree
    const meshes = [];
    gltf.scene.traverse(o => { if (o.isMesh) meshes.push(o); });
    for (const o of meshes) {
      const a = o.geometry.getAttribute('_region') || o.geometry.getAttribute('_REGION');
      const id = a ? Math.round(a.getX(0)) : null;
      if (id == null) continue;
      if (!byRegion.has(id)) {
        const g = new THREE.Group();
        g.userData = { regionId: id, interior: INTERIOR_IDS.has(id) };
        byRegion.set(id, g);
        group.add(g);
      }
      const interior = INTERIOR_IDS.has(id);
      const col = new THREE.Color(COLORS[id] ?? '#9aa3b8');
      /* The core.
       *
       * The cortex is an additive volume, so anything drawn inside it shows *through* it —
       * which is what the deep structures are for now. They are the light source the tissue
       * is lit by: emissive, additive, and never fully off, because the golden burn coming
       * out of the middle of the head is most of what says this organ is running rather than
       * preserved. Their own atlas colour is still there underneath and comes forward when
       * one is selected or the colour coding is turned up.
       *
       * The cerebellum and the brainstem are the exception: they are outer surface, so they
       * wear the cortex's warm tissue colour and read as part of the same shell. */
      const base = new THREE.Color(interior ? CORE : TISSUE);
      if (!interior && tissue) {
        // outer surface: the same volume material as the cortex, so the organ is one thing
        o.material = tissue;
        o.renderOrder = 2;
        o.userData.regionId = id;
        byRegion.get(id).add(o);
        continue;
      }
      o.material = new THREE.MeshBasicMaterial({
        color: base.clone(),
        transparent: true,
        opacity: interior ? 0.10 : 0.30,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: interior ? THREE.FrontSide : THREE.DoubleSide,
      });
      // Interior first, so the core is laid down before the shell accumulates over it. With
      // an order-independent additive blend this is cosmetic rather than load-bearing, but it
      // keeps the depth test doing the same thing it always did.
      o.renderOrder = interior ? 1 : 2;
      o.material.userData = { base, region: col, interior };
      o.userData.regionId = id;
      byRegion.get(id).add(o);
    }
    onDone(group, [...byRegion.keys()]);
  }, undefined, (err) => { console.error('subcortical load failed', err); });
  return group;
}
