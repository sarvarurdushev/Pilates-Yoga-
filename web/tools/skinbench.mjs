/**
 * Measure the skinning, in node, against the real meshes.
 *
 * `tools/appshots.mjs` measures the same things but drives a headless browser through the
 * whole app, which is minutes per run on a software rasteriser. That is fine for confirming a
 * result and far too slow for finding one: the last attempt at the shoulder went through four
 * reparameterisations and each was a coffee break. This loads the GLBs directly, skins every
 * muscle exactly the way `bindLayer` does, poses the rig and reports volume and edge stretch —
 * in a couple of seconds, so a weighting idea can be tried and thrown away in a minute.
 *
 * It is a bench, not a test — nothing here fails a build. It measures what `appshots`
 * measures, but it is the search and `appshots` is the confirmation: a bench that has drifted
 * away from the app would keep printing numbers, so when a result matters, run both.
 *
 * Usage: node tools/skinbench.mjs [pose,pose,...]
 *        node tools/skinbench.mjs --worst 20        the twenty worst meshes, all poses
 *        node tools/skinbench.mjs --bind            every mesh and the chain it was bound to
 *        SKIN_LAYERS=nervous node tools/skinbench.mjs      which layers to load
 *        SPAN_TRACE='median' node tools/skinbench.mjs      trace span selection by name
 */
import { readFileSync } from 'node:fs';
import * as THREE from '../vendor/three.module.js';
import { Rig } from '../src/rig.js';
import { buildSkeleton, skinMesh, neighbourhood, spanOf,
         indexAttachments, attachmentsOf, nearestSegment,
         meshNeighbourhood, buildBoneField, trimToBones, chainFromBones, MUSCLE_SHARE,
         meshName, NERVE_SMOOTH, NERVE_HALF_CAP, withOccupied,
         chainCoverage, CHAIN_COVER } from '../src/skin.js';
import { BoneDualQuats, skinPoint } from '../src/dqs.js';
import { YOGA } from '../src/content/library/yoga.js';
import { PILATES } from '../src/content/library/pilates.js';

const ROOT = new URL('../', import.meta.url);
const MUSCLE_REACH = Number(process.env.MUSCLE_REACH ?? 1);   // matches bindLayer
const NERVE_FIELD = !!process.env.NERVE_FIELD;
const NERVE_HCAP = Number(process.env.NERVE_HCAP ?? NERVE_HALF_CAP);   // matches bindLayer
const NERVE_PASSES = Number(process.env.NERVE_PASSES ?? NERVE_SMOOTH);   // matches bindLayer
const COVER = Number(process.env.CHAIN_COVER ?? CHAIN_COVER);   // matches bindLayer
const TRIM_MUSCLES = !process.env.NO_TRIM_MUSCLES;   // matches bindLayer

const D = Math.PI / 180;
const TRANS = new Set(['pelvis_tx', 'pelvis_ty', 'pelvis_tz']);

/* ------------------------------------------------------------------ GLB reading
 * Only what a mesh needs: a name, positions and indices. No materials, no scene graph — the
 * geometry in these files is already in the body frame, which is the whole reason a mesh
 * built in another pipeline can be skinned to this rig at all. */
function readGLB(file) {
  const buf = readFileSync(file);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  const bin = buf.subarray(20 + jsonLen + 8);
  const CT = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array,
               5125: Uint32Array, 5126: Float32Array };
  const NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
  const acc = (i) => {
    const a = json.accessors[i], bv = json.bufferViews[a.bufferView];
    const T = CT[a.componentType], n = NC[a.type];
    const off = (bv.byteOffset || 0) + (a.byteOffset || 0);
    return new T(bin.buffer, bin.byteOffset + off, a.count * n);
  };
  const out = [];
  for (const m of json.meshes ?? []) {
    for (const p of m.primitives) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(acc(p.attributes.POSITION), 3));
      geo.setIndex(new THREE.BufferAttribute(acc(p.indices), 1));
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
      mesh.name = m.name;
      out.push(mesh);
    }
  }
  return out;
}


/* --------------------------------------------------------------------- the rig */
const rigJson = JSON.parse(readFileSync(new URL('src/generated/rig.json', ROOT), 'utf8'));
const pathData = JSON.parse(readFileSync(new URL('src/generated/muscle_paths.json', ROOT), 'utf8'));
const rig = new Rig(rigJson);
rig.captureBindPose();
const built = buildSkeleton(rig);
const skeleton = new THREE.Skeleton(built.bones);
rig.root.updateMatrixWorld(true);
skeleton.calculateInverses();
const dq = new BoneDualQuats(skeleton);

indexAttachments(pathData);

/* The same bone field the app builds, from the same file: a structure's home segment is
 * decided by which bone it lies against, so a bench without one measures a different
 * binding from the one on screen. */
const boneField = buildBoneField(readGLB(new URL('models/skeleton.glb', ROOT).pathname),
                                 rig, built.index);

/* ------------------------------------------------------------------- the skinning */
const LAYERS = (process.env.SKIN_LAYERS ?? 'muscles_superficial,muscles_deep').split(',');
const skinned = [];
for (const layer of LAYERS) {
  for (const o of readGLB(new URL(`models/${layer}.glb`, ROOT).pathname)) {
    const [base, side] = meshName(o.name);
    const seg = rig.segmentFor(base, side || 'M') ?? nearestSegment(o, rig, boneField);
    if (!seg) continue;
    /* Exactly what `bindLayer` does: a nerve's candidates come from where its own vertices
     * lie, because no radius around one home reaches an arm from a cervical root; everything
     * else takes the chain around the segment its bones put it on. */
    let allowed = layer === 'nervous'
      ? (NERVE_FIELD
          ? meshNeighbourhood(o, rig, boneField, built.index, side ?? null, MUSCLE_REACH, MUSCLE_SHARE)
          : meshNeighbourhood(o, rig, built.capsules, built.index, side ?? null))
      : (MUSCLE_REACH >= 0
          ? meshNeighbourhood(o, rig, boneField, built.index, side ?? null, MUSCLE_REACH, MUSCLE_SHARE)
          : neighbourhood(rig, built.index, seg, 2, side ?? null));
    // the capsule set does not contain the vertebrae a chest-wrapping nerve lies on
    if (layer === 'nervous') allowed = withOccupied(allowed, o, rig, boneField, built.index);
    const note = {};
    let chain = spanOf(o, rig, built.capsules, built.index, allowed,
                       attachmentsOf(base, side), note,
                       { trim: layer !== 'nervous' });
    /* A nerve's span is not trimmed to the joints inside its own box — it runs from a root
     * to a fingertip and contains most of them — so it is trimmed to the bones it lies on
     * instead, which is the rule that stops one greedy end running the chain down an arm. */
    if (layer === 'nervous' || TRIM_MUSCLES)
      chain = trimToBones(chain, o, boneField, built.index,
                          { floor: layer === 'nervous' ? 1 : 2 });
    /* A chain that came out as one segment is a rigid ride; rebuild it from the bones the
     * mesh lies on. See `chainFromBones`. */
    /* For every layer, exactly as `bindLayer` does it. This used to skip the nervous layer,
     * so the bench measured a binding the app never used — and the intercostal nerves, whose
     * chain collapses to `torso` alone, were measured riding one rigid body while the app
     * gave them a real chain. A tool that mirrors the app has to mirror all of it. */
    if ((chain?.length ?? 0) < 2
        || (layer === 'nervous' && chainCoverage(chain, o, boneField, built.index) < COVER))
      chain = chainFromBones(o, rig, boneField, built.index, allowed,
                             { byCell: layer === 'nervous' }) ?? chain;
    if (process.env.SPAN_TRACE && new RegExp(process.env.SPAN_TRACE).test(o.name))
      console.log(o.name, JSON.stringify(note));
    const sk = skinMesh(o, skeleton, built.capsules,
                        { allowed, chain, index: built.index, rig, home: seg,
                          hCap: layer === 'nervous' ? NERVE_HCAP : 0,
                          ...(layer === 'nervous' ? { passes: NERVE_PASSES } : {}) });
    if (sk) skinned.push({ name: o.name, layer, chain, mesh: sk });
  }
}

/* --------------------------------------------------------------------- measuring */
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const _t = new THREE.Vector3();
const SLIVER = 0.002;   // a decimated mesh carries edges too short for a ratio to mean anything

function measure(entry) {
  const geo = entry.mesh.geometry;
  const pos = geo.getAttribute('position'), idx = geo.index;
  const si = geo.getAttribute('skinIndex'), sw = geo.getAttribute('skinWeight');
  const i4 = [0, 0, 0, 0], w4 = [0, 0, 0, 0];
  const deform = (i, out) => {
    out.set(pos.getX(i), pos.getY(i), pos.getZ(i));
    if (!si) return out;
    for (let k = 0; k < 4; k++) { i4[k] = si.getComponent(i, k); w4[k] = sw.getComponent(i, k); }
    return skinPoint(dq.data, i4, w4, out);
  };
  let vr = 0, vp = 0, stretch = 1;
  for (let t = 0; t < idx.count; t += 3) {
    const ia = idx.getX(t), ib = idx.getX(t + 1), ic = idx.getX(t + 2);
    _a.set(pos.getX(ia), pos.getY(ia), pos.getZ(ia));
    _b.set(pos.getX(ib), pos.getY(ib), pos.getZ(ib));
    _c.set(pos.getX(ic), pos.getY(ic), pos.getZ(ic));
    vr += _a.dot(_t.copy(_b).cross(_c));
    const r0 = [_a.distanceTo(_b), _b.distanceTo(_c), _c.distanceTo(_a)];
    deform(ia, _a); deform(ib, _b); deform(ic, _c);
    vp += _a.dot(_t.copy(_b).cross(_c));
    const p0 = [_a.distanceTo(_b), _b.distanceTo(_c), _c.distanceTo(_a)];
    for (let e = 0; e < 3; e++) if (r0[e] >= SLIVER) stretch = Math.max(stretch, p0[e] / r0[e]);
  }
  const bones = new Set();
  if (si) for (let i = 0; i < si.count; i++)
    for (let k = 0; k < 4; k++) if (sw.getComponent(i, k) > 0.001) bones.add(si.getComponent(i, k));
  /* Does the muscle still deform at all?
   *
   * Low stretch and perfect volume are exactly what a mesh bound rigidly to one blend of
   * bones reports, because a rigid body does not stretch and a dual quaternion does not lose
   * volume. So the headline numbers alone cannot tell "the skinning got better" from "the
   * skinning stopped happening". This measures the spread of each bone's weight across the
   * mesh: near 1 means one end of the muscle is firmly on one bone and the other end firmly
   * on another, near 0 means the whole thing rides one blend and follows nothing. */
  let range = 0;
  if (si) {
    const lo = new Map(), hi = new Map();
    for (let i = 0; i < si.count; i++) {
      const seen = new Map();
      for (let k = 0; k < 4; k++) seen.set(si.getComponent(i, k),
        (seen.get(si.getComponent(i, k)) ?? 0) + sw.getComponent(i, k));
      for (const b of bones) {
        const w = seen.get(b) ?? 0;
        if (!lo.has(b) || w < lo.get(b)) lo.set(b, w);
        if (!hi.has(b) || w > hi.get(b)) hi.set(b, w);
      }
    }
    for (const b of bones) range = Math.max(range, (hi.get(b) ?? 0) - (lo.get(b) ?? 0));
  }
  return { volume: Math.abs(vr) > 1e-12 ? Math.abs(vp) / Math.abs(vr) : 1, stretch,
           bones: bones.size, range };
}

function pose(record) {
  rig.reset();
  const v = {};
  for (const [k, x] of Object.entries(record.pose))
    v[k] = (TRANS.has(k) || /_wave$/.test(k)) ? x : x * D;
  rig.setAll(v);
  rig.root.updateMatrixWorld(true);
  dq.update();
}



/* ------------------------------------------------------------------------ report */
const ALL = [...PILATES, ...YOGA];
const argPoses = process.argv.find(a => !a.startsWith('-') && a.includes(','))
  ?? (process.argv[2] && !process.argv[2].startsWith('-') ? process.argv[2] : null);
const KEYS = argPoses ? argPoses.split(',')
  : ['spineTwistSeated', 'adhoMukhaSvanasana', 'setuBandha', 'phalakasana', 'trikonasana'];
const worstN = process.argv.includes('--worst')
  ? Number(process.argv[process.argv.indexOf('--worst') + 1]) || 20 : 0;

const worst = [], stats = [];
let totalBad = 0;
for (const key of KEYS) {
  const rec = ALL.find(r => r.key === key);
  if (!rec) { console.log(`${key}: no such record`); continue; }
  pose(rec);
  const rows = [], all = [];
  for (const e of skinned) {
    const m = measure(e);
    all.push(m);
    if (m.stretch > 2.5 || m.volume < 0.7 || m.volume > 1.3) rows.push({ ...e, ...m });
  }
  rows.sort((x, y) => y.stretch - x.stretch);
  totalBad += rows.length;
  /* A threshold count moves when a mesh drifts across the line and says nothing about how
   * bad the bad ones are. What is actually visible is a torn triangle, so the headline is the
   * worst edge stretch and how many meshes are over three; volume error is reported as the
   * mean of |log| so that half and double count the same. */
  let worstStretch = 1, over3 = 0, volErr = 0, spanning = 0, rangeSum = 0, multi = 0;
  for (const m of all) {
    worstStretch = Math.max(worstStretch, m.stretch);
    if (m.stretch > 3) over3++;
    volErr += Math.abs(Math.log(Math.max(m.volume, 1e-6)));
    if (m.bones > 1) { multi++; rangeSum += m.range; if (m.range > 0.5) spanning++; }
  }
  stats.push({ key, worstStretch, over3, volErr: volErr / all.length,
               spanning, multi, range: multi ? rangeSum / multi : 0 });
  console.log(`\n${key.padEnd(22)} ${String(rows.length).padStart(3)} distorted of ${skinned.length}` +
    `   worst stretch ${worstStretch.toFixed(1)}   over 3x: ${over3}   vol err ${(volErr / all.length).toFixed(3)}` +
    `   spanning ${spanning}/${multi}`);
  for (const r of rows.slice(0, 8))
    console.log(`   ${r.name.padEnd(34)} bones ${r.bones}  vol ${r.volume.toFixed(2).padEnd(5)} ` +
      `stretch ${r.stretch.toFixed(1).padStart(5)}  ${r.chain?.join(' > ') ?? '-'}`);
  for (const r of rows) worst.push({ key, ...r });
}
console.log(`\n${'='.repeat(64)}`);
console.log(`distorted ${totalBad}   worst stretch ${Math.max(...stats.map(s2 => s2.worstStretch)).toFixed(2)}` +
  `   meshes over 3x ${stats.reduce((a, s2) => a + s2.over3, 0)}` +
  `   mean vol err ${(stats.reduce((a, s2) => a + s2.volErr, 0) / stats.length).toFixed(4)}` +
  `   spanning ${stats[0].spanning}/${stats[0].multi} mean range ${stats[0].range.toFixed(2)}`);
if (worstN) {
  worst.sort((x, y) => y.stretch - x.stretch);
  console.log(`\nworst ${worstN} anywhere:`);
  for (const r of worst.slice(0, worstN))
    console.log(`   ${r.key.padEnd(20)} ${r.name.padEnd(34)} vol ${r.volume.toFixed(2).padEnd(5)} ` +
      `stretch ${r.stretch.toFixed(1)}`);
}

if (process.argv.includes('--bind')) {
  for (const e of skinned) console.log(e.name.padEnd(30), '->', e.chain?.join(' > '));
}
