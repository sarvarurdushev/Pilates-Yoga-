/**
 * Tripo GLB  ->  app-ready brain shell.
 *
 * The raw Tripo export is 62 MB: 83 arbitrary "tripo_part_N" meshes, 249 textures,
 * 1.95 M triangles. The parts carry no anatomical meaning, and the mesh is a hollow
 * surface shell with no interior. This script:
 *
 *   1. rotates it into a canonical anatomical frame  (+X right, +Y superior, +Z anterior)
 *   2. centres it and scales so anterior-posterior length = 1.0
 *   3. merges all parts, drops every texture, keeps one material
 *   4. simplifies to a web-friendly triangle budget
 *   5. bakes a per-vertex _REGION attribute from an anatomical atlas
 *
 * Region IDs are what make "click the temporal lobe" possible: Tripo's own parts
 * slice straight across anatomical boundaries, so per-part assignment would be wrong.
 * Per-vertex assignment gives clean boundaries regardless of how Tripo chopped it.
 */
import { NodeIO } from '@gltf-transform/core';
import { dedup, prune, flatten, join, weld, simplify, resample, textureCompress }
  from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import { REGIONS, classify } from './atlas.mjs';
import fs from 'node:fs';

const SRC = process.argv[2];
const DST = process.argv[3] ?? 'public/models/brain-shell.glb';
const TARGET_TRIS = Number(process.env.TARGET_TRIS ?? 260000);

const io = new NodeIO();
console.log('reading', SRC);
const doc = await io.read(SRC);
const root = doc.getRoot();

// ---------------------------------------------------------------- 1. orientation
// Measured from the raw export: +X = posterior, +Y = superior, +Z = left-right.
// Canonical target: +X = right, +Y = superior, +Z = anterior.
//   newX = oldZ,  newY = oldY,  newZ = -oldX      (determinant +1, a true rotation)
const rot = (x, y, z) => [z, y, -x];

let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
for (const mesh of root.listMeshes())
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION');
    const el = [0, 0, 0];
    for (let i = 0; i < pos.getCount(); i++) {
      pos.getElement(i, el);
      const p = rot(el[0], el[1], el[2]);
      for (let k = 0; k < 3; k++) { if (p[k] < lo[k]) lo[k] = p[k]; if (p[k] > hi[k]) hi[k] = p[k]; }
    }
  }
const ctr = [0, 1, 2].map(k => (lo[k] + hi[k]) / 2);
const scale = 1 / (hi[2] - lo[2]);              // normalise A-P length to 1.0
console.log('  canonical bbox', lo.map(v => +v.toFixed(3)), hi.map(v => +v.toFixed(3)));
console.log('  scale', scale.toFixed(4));

for (const mesh of root.listMeshes())
  for (const prim of mesh.listPrimitives()) {
    for (const name of ['POSITION', 'NORMAL']) {
      const a = prim.getAttribute(name);
      if (!a) continue;
      const isPos = name === 'POSITION';
      const el = [0, 0, 0];
      for (let i = 0; i < a.getCount(); i++) {
        a.getElement(i, el);
        let p = rot(el[0], el[1], el[2]);
        if (isPos) p = p.map((v, k) => (v - ctr[k]) * scale);
        a.setElement(i, p);
      }
    }
  }

// ------------------------------------------------------- 2. one material, no textures
// Every part has its own material + basecolor/normal/roughness texture. The cortex
// is near-uniform in colour, so collapsing to a single PBR material costs almost
// nothing visually and removes ~55 MB.
const mat = doc.createMaterial('cortex')
  .setBaseColorFactor([0.86, 0.71, 0.66, 1])
  .setRoughnessFactor(0.72)
  .setMetallicFactor(0.0);
for (const mesh of root.listMeshes())
  for (const prim of mesh.listPrimitives()) prim.setMaterial(mat);
for (const t of root.listTextures()) t.dispose();

// ------------------------------------------------------------------ 3. merge + simplify
await doc.transform(
  dedup(), flatten(), join({ keepNamed: false }), weld({ tolerance: 1e-5 })
);
let tris = 0;
for (const m of root.listMeshes())
  for (const p of m.listPrimitives()) tris += p.getIndices().getCount() / 3;
const ratio = Math.min(1, TARGET_TRIS / tris);
console.log(`  merged: ${tris.toLocaleString()} tris -> simplify ratio ${ratio.toFixed(3)}`);
await MeshoptSimplifier.ready;
await doc.transform(
  simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.0012, lockBorder: false }),
  prune(), dedup()
);

// -------------------------------------------------------------- 4. bake region IDs
let tagged = 0;
const hist = new Map();
for (const mesh of root.listMeshes())
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION');
    const n = pos.getCount();
    const ids = new Float32Array(n);
    const el = [0, 0, 0];
    for (let i = 0; i < n; i++) {
      pos.getElement(i, el);
      const id = classify(el[0], el[1], el[2]);
      ids[i] = id;
      hist.set(id, (hist.get(id) ?? 0) + 1);
    }
    const acc = doc.createAccessor('region')
      .setType('SCALAR').setArray(ids)
      .setBuffer(root.listBuffers()[0]);
    prim.setAttribute('_REGION', acc);
    tagged += n;
  }

let outTris = 0;
for (const m of root.listMeshes())
  for (const p of m.listPrimitives()) outTris += p.getIndices().getCount() / 3;

await io.write(DST, doc);
const mb = fs.statSync(DST).size / 1e6;
console.log(`\nwrote ${DST}  ${mb.toFixed(2)} MB  |  ${outTris.toLocaleString()} tris  |  ${tagged.toLocaleString()} verts tagged`);
console.log('\nregion coverage:');
for (const r of REGIONS) {
  const c = hist.get(r.id) ?? 0;
  const pct = (c / tagged * 100);
  console.log(`  ${String(r.id).padStart(2)} ${r.name.padEnd(22)} ${String(c).padStart(7)}  ${pct.toFixed(1).padStart(5)}%`);
}
