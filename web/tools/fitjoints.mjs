/**
 * Put every limb joint where the bones actually articulate.
 *
 * The skeleton is 245 rigid bone meshes, each riding one rig segment, so two bones stay
 * together across a joint only if the rig's centre of rotation is where the anatomy's
 * articulation is. Measured over every clip in the library, they are not: at rest the pairs
 * touch to within a millimetre, and in a pose they come apart by up to **15 cm** at the
 * radioulnar joint, 9 at the wrist, 6 at the elbow, 5.6 at the hip. The spine, by contrast,
 * opens 3 mm — and the spine's centres were taken from *this body's* own intervertebral disc
 * centroids, while the limb centres came from Rajagopal through a single global similarity
 * transform fitted to nine bones. One transform cannot put sixteen joints in the right place.
 *
 * That is why so much looks wrong: everything else — muscles, nerves, the shell — is bound to
 * a skeleton that is coming apart at the joints.
 *
 * There is no need to guess where a joint belongs. Rotate it and see: the correct centre is
 * the one that keeps the two bones together through the coordinate's whole published range.
 * This searches for that point directly, three degrees of freedom per joint, scoring on the
 * separation the rotation opens up.
 *
 * **The bind pose is preserved exactly.** The joint's frame is
 * `parent · T(translation) · R(orientation)`, and the child body hangs off it through the
 * inverted child frame, so moving the joint by δ and adding `R(childOrientation) ·
 * R(orientation)^-1 · δ` to `childTranslation` leaves every segment's world position at the
 * default pose untouched. `test/rig.test.mjs` holds the forward kinematics to
 * `worldAtDefault` and would fail if that were wrong.
 *
 *   node tools/fitjoints.mjs            report what it would change
 *   node tools/fitjoints.mjs --write    write it into src/generated/rig.json
 *
 * `parse_opensim.py` rewrites rig.json from the OpenSim file, so this is the third command in
 * the chain, after the spine:  npm run build:rig && npm run build:spine && npm run build:joints
 */
import { readFileSync, writeFileSync } from 'node:fs';
import * as THREE from '../vendor/three.module.js';
import { Rig } from '../src/rig.js';

const ROOT = new URL('../', import.meta.url);
const RIG = new URL('src/generated/rig.json', ROOT);

/* The spine is already right — its centres are this body's own disc centroids — and the
 * shoulder girdle has no articulation to fit, because the model has no scapula. */
/* The knee is skipped because Rajagopal models it as a *coupled* joint: `knee_angle` drives
 * two translations through cubic splines, so its centre is a function of the angle rather
 * than a fixed point. Fitting a fixed centre to it fights the coupling — the joint itself
 * then travels 40 mm through a 120-degree bend, which `test/rig.test.mjs` catches. */
const SKIP = /^([LTC]\d+|skull|torso|pelvis|patella_[lr]|tibia_[lr])$/;
const SAMPLES = 170;      // points per bone; the contact patch only needs to be found once
const PAIRS = 60;         // closest parent/child point pairs that define the articulation
const STEPS = [0.020, 0.010, 0.005, 0.0025, 0.0012, 0.0006];   // metres, coordinate descent
/* What a correction has to buy to be worth making, as separation closed per metre moved.
 * Without it the search wanders: it found a 126 mm shift of the radioulnar joint for 53 mm of
 * separation, and an 86 mm shift of an ankle for 7. A published joint centre is evidence, and
 * the honest change is the *smallest* one that keeps the bones together — so the move is
 * priced into the score and only a correction that pays for itself survives. */
const MOVE_COST = 0.25 / 1.75;   // body heights of score per metre moved

function readGLB(file) {
  const b = readFileSync(file);
  const jl = b.readUInt32LE(12);
  const j = JSON.parse(b.subarray(20, 20 + jl).toString('utf8'));
  const bin = b.subarray(20 + jl + 8);
  const CT = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array,
               5125: Uint32Array, 5126: Float32Array };
  const acc = (i) => {
    const a = j.accessors[i], bv = j.bufferViews[a.bufferView];
    return new CT[a.componentType](bin.buffer,
      bin.byteOffset + (bv.byteOffset || 0) + (a.byteOffset || 0), a.count * 3);
  };
  const out = [];
  for (const m of j.meshes ?? []) for (const p of m.primitives)
    out.push({ name: m.name, P: acc(p.attributes.POSITION) });
  return out;
}

const rigJson = JSON.parse(readFileSync(RIG, 'utf8'));

/* Every bone's sampled points, in the body frame, grouped by the segment it rides. */
const bySeg = new Map();
for (const m of readGLB(new URL('models/skeleton.glb', ROOT).pathname)) {
  const [base, side] = String(m.name || '').split('|');
  const seg = rigJson.binding[`${base}|${side}`] ?? rigJson.binding[`${base}|M`];
  if (!seg) continue;
  const n = m.P.length / 3;
  const step = Math.max(1, Math.floor(n / SAMPLES));
  const pts = bySeg.get(seg) ?? [];
  for (let i = 0; i < n; i += step) pts.push(new THREE.Vector3(m.P[i * 3], m.P[i * 3 + 1], m.P[i * 3 + 2]));
  bySeg.set(seg, pts);
}

/** A fresh rig from the (possibly edited) data, posed to the bind pose. */
function bindOf(data) {
  const r = new Rig(JSON.parse(JSON.stringify(data)));
  r.captureBindPose();
  r.root.updateMatrixWorld(true);
  return r;
}
const base = bindOf(rigJson);
const bindWorld = new Map();
for (const [n, node] of base.nodes) bindWorld.set(n, node.joint.matrixWorld.clone());

/* Which coordinates drive each joint, and the values worth testing: the extremes are where a
 * misplaced centre shows, and the middle catches a centre that is wrong the other way. */
const coordsFor = (child) => Object.entries(rigJson.coordinates)
  .filter(([, c]) => c.segment === child && !/^pelvis_t[xyz]$/.test(c.name ?? ''))
  .map(([name, c]) => ({ name, range: c.range ?? [-1, 1] }));

const _m = new THREE.Matrix4();
function separation(data, child, parent, pairs) {
  const r = bindOf(data);
  const bw = new Map();
  for (const [n, node] of r.nodes) bw.set(n, node.joint.matrixWorld.clone());
  let worst = 0;
  for (const c of coordsFor(child)) {
    const [lo, hi] = c.range;
    for (const v of [lo, lo * 0.5, hi * 0.5, hi]) {
      if (!Number.isFinite(v)) continue;
      r.setAll({ [c.name]: v });
      r.root.updateMatrixWorld(true);
      const dp = r.nodes.get(parent).joint.matrixWorld.clone().multiply(bw.get(parent).clone().invert());
      const dc = r.nodes.get(child).joint.matrixWorld.clone().multiply(bw.get(child).clone().invert());
      for (const p of pairs) {
        const a = p.a.clone().applyMatrix4(dp), b = p.b.clone().applyMatrix4(dc);
        worst = Math.max(worst, a.distanceTo(b) - p.rest);
      }
    }
  }
  return worst;
}

/** Move a joint by δ (metres, in the parent's offset frame) without moving the bind pose. */
function shift(data, child, d) {
  const seg = data.segments[child];
  const q = new THREE.Quaternion()
    .setFromEuler(new THREE.Euler(...(seg.orientation ?? [0, 0, 0]), 'XYZ')).invert();
  const qc = new THREE.Quaternion()
    .setFromEuler(new THREE.Euler(...(seg.childOrientation ?? [0, 0, 0]), 'XYZ'));
  const back = d.clone().applyQuaternion(q).applyQuaternion(qc);
  seg.translation = seg.translation.map((v, i) => v + d.getComponent(i));
  seg.childTranslation = (seg.childTranslation ?? [0, 0, 0]).map((v, i) => v + back.getComponent(i));
}

const rows = [];
for (const [child, def] of Object.entries(rigJson.segments)) {
  const parent = def.parent;
  if (!parent || SKIP.test(child)) continue;
  const A = bySeg.get(parent), B = bySeg.get(child);
  if (!A?.length || !B?.length) continue;
  /* The articulation is where the two bones are closest. Take the tightest pairs rather than
   * one, so the score describes a contact patch rather than a single touching point. */
  const all = [];
  for (const a of A) for (const b of B) all.push({ a, b, rest: a.distanceTo(b) });
  all.sort((x, y) => x.rest - y.rest);
  const pairs = all.slice(0, PAIRS);
  if (!pairs.length) continue;

  const before = separation(rigJson, child, parent, pairs);
  if (before < 0.004) { rows.push({ child, parent, before, after: before, d: null }); continue; }

  const work = JSON.parse(JSON.stringify(rigJson));
  const total = new THREE.Vector3();
  const score = (s, moved) => s + moved * MOVE_COST;
  let best = score(separation(work, child, parent, pairs), 0);
  for (const step of STEPS) {
    let moved = true;
    while (moved) {
      moved = false;
      for (let axis = 0; axis < 3; axis++) {
        for (const sign of [1, -1]) {
          const d = new THREE.Vector3(); d.setComponent(axis, step * sign);
          const trial = JSON.parse(JSON.stringify(work));
          shift(trial, child, d);
          const s = score(separation(trial, child, parent, pairs),
                          total.clone().add(d).length());
          if (s < best - 1e-5) {
            best = s;
            work.segments[child] = trial.segments[child];
            total.add(d);
            moved = true;
          }
        }
      }
    }
  }
  const after = separation(work, child, parent, pairs);
  rows.push({ child, parent, before, after, d: total, seg: work.segments[child] });
}

rows.sort((a, b) => (b.before - b.after) - (a.before - a.after));
console.log('joint separation opened by its own rotation, before -> after (body heights)\n');
for (const r of rows) {
  const moved = r.d ? `moved ${(r.d.length() * 1000).toFixed(0)} mm` : 'already tight';
  console.log(`  ${r.parent.padEnd(10)} -> ${r.child.padEnd(10)} ` +
              `${r.before.toFixed(4)} -> ${r.after.toFixed(4)}   ${moved}`);
}
const gain = rows.reduce((s, r) => s + (r.before - r.after), 0);
console.log(`\nworst before ${Math.max(...rows.map(r => r.before)).toFixed(4)}, ` +
            `worst after ${Math.max(...rows.map(r => r.after)).toFixed(4)}, total closed ${gain.toFixed(3)}`);

if (process.argv.includes('--write')) {
  for (const r of rows) if (r.seg) {
    /* Marked, so `parse_opensim.py` can refuse to overwrite a rig that carries fitted centres
     * — it rewrites the file from the OpenSim model and would destroy them silently. */
    if (r.d && r.d.length() > 0) r.seg.fitted = { movedMm: +(r.d.length() * 1000).toFixed(1) };
    rigJson.segments[r.child] = r.seg;
  }
  writeFileSync(RIG, JSON.stringify(rigJson, null, 1));
  console.log(`\nwrote ${RIG.pathname}`);
}
