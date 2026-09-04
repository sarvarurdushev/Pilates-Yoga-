/** Weld + simplify the fsaverage cortex for the web, keeping _REGION intact. */
import { NodeIO } from '@gltf-transform/core';
import { simplify, dedup, prune } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import fs from 'node:fs';

const [SRC, DST] = [process.argv[2], process.argv[3]];
const TARGET = Number(process.env.TARGET_TRIS ?? 250000);
const io = new NodeIO();
const doc = await io.read(SRC);
const root = doc.getRoot();

const mat = doc.createMaterial('cortex')
  .setBaseColorFactor([0.80, 0.71, 0.69, 1]).setRoughnessFactor(0.78).setMetallicFactor(0);
for (const m of root.listMeshes()) for (const p of m.listPrimitives()) p.setMaterial(mat);

const count = () => root.listMeshes()
  .flatMap(m => m.listPrimitives()).reduce((a, p) => a + p.getIndices().getCount() / 3, 0);
const before = count();
await MeshoptSimplifier.ready;
// no weld(): fsaverage and the marching-cubes output are already indexed with shared
// vertices, and weld() in this version of gltf-transform chokes on the custom attribute.
await doc.transform(
  simplify({ simplifier: MeshoptSimplifier, ratio: Math.min(1, TARGET / before), error: 0.0009 }),
  dedup(), prune(),
);

// region ids must stay integral: meshopt averages attributes when it collapses an
// edge, so snap them back before they reach the shader.
const hist = new Map();
for (const m of root.listMeshes()) for (const p of m.listPrimitives()) {
  const a = p.getAttribute('_REGION');
  if (!a) continue;
  const el = [0];
  for (let i = 0; i < a.getCount(); i++) {
    a.getElement(i, el);
    const v = Math.round(el[0]);
    a.setElement(i, [v]);
    hist.set(v, (hist.get(v) ?? 0) + 1);
  }
}
await io.write(DST, doc);
const total = [...hist.values()].reduce((a, b) => a + b, 0);
console.log(`${before.toLocaleString()} -> ${count().toLocaleString()} tris | ${(fs.statSync(DST).size/1e6).toFixed(2)} MB`);
console.log('regions after simplify:');
for (const k of [...hist.keys()].sort((a,b)=>a-b))
  console.log(`  ${String(k).padStart(2)}  ${String(hist.get(k)).padStart(6)}  ${(hist.get(k)/total*100).toFixed(1)}%`);
