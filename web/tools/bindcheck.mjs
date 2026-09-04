/**
 * Does every structure stay with its own bones when the body moves?
 *
 * This is the check that was missing. Every rule in the project so far asked whether a
 * *pose* was legal — joint ranges, contacts, the floor — and none asked whether the anatomy
 * hanging off the rig ended up anywhere near where it belongs. So the urinary bladder rode a
 * thigh, the left transversus abdominis rode a forearm, and every finger and toe bone stayed
 * at the chest while the limb walked away, all of it invisible to a green build.
 *
 * The measure needs no authored answer, but it does need the right question. "How far is
 * this structure from the nearest bone" is not it: a bladder welded to a femur travels with
 * that femur, so it stays snug against a bone the whole way down the thigh and reports
 * perfectly. What has to be tracked is *which* bone. Each sample point on a structure is
 * paired, at rest, with the particular point of skeleton it is lying on; then the body moves
 * and the pair is measured again. A liver that stays in the abdomen keeps its distance to the
 * rib it started under. A liver on a thigh does not.
 *
 * Usage: node tools/bindcheck.mjs [pose,pose,...]
 *        node tools/bindcheck.mjs --all           every clip in MOTION, worst per structure
 *        node tools/bindcheck.mjs --json          machine-readable, for the test
 */
import { readFileSync } from 'node:fs';
import * as THREE from '../vendor/three.module.js';
import { Rig } from '../src/rig.js';
import { buildSkeleton, skinMesh, neighbourhood, spanOf, indexAttachments,
         attachmentsOf, nearestSegment, meshNeighbourhood, buildBoneField, MUSCLE_SHARE,
         chainFromBones,
         trimToBones, meshName, NERVE_SMOOTH, NERVE_HALF_CAP, withOccupied,
         chainCoverage, CHAIN_COVER } from '../src/skin.js';
import { BoneDualQuats, skinPoint } from '../src/dqs.js';
import { MOTION } from '../src/content/motion.js';

const ROOT = new URL('../', import.meta.url);
const MUSCLE_REACH = Number(process.env.MUSCLE_REACH ?? 1);   // matches bindLayer
const NERVE_FIELD = !!process.env.NERVE_FIELD;
const NERVE_HCAP = Number(process.env.NERVE_HCAP ?? NERVE_HALF_CAP);   // matches bindLayer
const NERVE_PASSES = Number(process.env.NERVE_PASSES ?? NERVE_SMOOTH);   // matches bindLayer
const COVER = Number(process.env.CHAIN_COVER ?? CHAIN_COVER);   // matches bindLayer
const TRIM_MUSCLES = !process.env.NO_TRIM_MUSCLES;   // matches bindLayer

/* `motion.js` converts its own tables to radians as it loads, so a clip read from `MOTION`
 * is already in the runtime's units. Converting again turns 90 degrees into 1.6 and poses
 * the body a degree and a half from standing — which reports as "nothing has moved, nothing
 * has drifted" and passes every check in the file. */
/* Body heights. A structure may shift a little relative to its bone — skinning is a
 * geometric approximation and a broad sheet crossing a joint genuinely slides — but a
 * centimetre and a half is already twice any real soft-tissue excursion at this scale, and
 * the failures this exists to catch are a whole limb's length. */
export const GAP_TOLERANCE = 0.015;

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
    return new T(bin.buffer, bin.byteOffset + (bv.byteOffset || 0) + (a.byteOffset || 0),
                 a.count * n);
  };
  const out = [];
  for (const m of json.meshes ?? []) for (const p of m.primitives) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(acc(p.attributes.POSITION), 3));
    geo.setIndex(new THREE.BufferAttribute(acc(p.indices), 1));
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
    mesh.name = m.name;
    out.push(mesh);
  }
  return out;
}

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

const boneMeshes = readGLB(new URL('models/skeleton.glb', ROOT).pathname);
const boneField = buildBoneField(boneMeshes, rig, built.index);

/* The bone cloud, kept as points plus the segment each rides, so it can be posed rigidly. */
const BONE = [];
for (const m of boneMeshes) {
  const [base, side] = meshName(m.name);
  const seg = rig.segmentFor(base, side || 'M');
  if (!seg) continue;
  const pos = m.geometry.getAttribute('position');
  const step = Math.max(1, Math.floor(pos.count / 120));
  for (let i = 0; i < pos.count; i += step)
    BONE.push({ p: new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)), seg });
}

/* Every soft structure, bound exactly as `bindLayer` binds it. */
const SOFT = [];
for (const layer of ['organs', 'muscles_superficial', 'muscles_deep', 'nervous']) {
  for (const o of readGLB(new URL(`models/${layer}.glb`, ROOT).pathname)) {
    const [base, side] = meshName(o.name);
    let seg = rig.segmentFor(base, side || 'M');
    if (!seg) seg = nearestSegment(o, rig, boneField);
    if (!seg) continue;
    const skinnable = layer.startsWith('muscles') || layer === 'nervous';
    let sk = null;
    if (skinnable) {
      let allowed = layer === 'nervous'
        ? (NERVE_FIELD
          ? meshNeighbourhood(o, rig, boneField, built.index, side ?? null, MUSCLE_REACH, MUSCLE_SHARE)
          : meshNeighbourhood(o, rig, built.capsules, built.index, side ?? null))
        : (MUSCLE_REACH >= 0
            ? meshNeighbourhood(o, rig, boneField, built.index, side ?? null, MUSCLE_REACH, MUSCLE_SHARE)
            : neighbourhood(rig, built.index, seg, 2, side ?? null));
      // the capsule set does not contain the vertebrae a chest-wrapping nerve lies on
      if (layer === 'nervous') allowed = withOccupied(allowed, o, rig, boneField, built.index);
      let chain = spanOf(o, rig, built.capsules, built.index, allowed,
                         attachmentsOf(base, side), null,
                         { trim: layer !== 'nervous' });
      if (layer === 'nervous' || TRIM_MUSCLES)
        chain = trimToBones(chain, o, boneField, built.index,
                            { floor: layer === 'nervous' ? 1 : 2 });
      if ((chain?.length ?? 0) < 2
          || (layer === 'nervous' && chainCoverage(chain, o, boneField, built.index) < COVER))
        chain = chainFromBones(o, rig, boneField, built.index, allowed,
                             { byCell: layer === 'nervous' }) ?? chain;
      sk = skinMesh(o, skeleton, built.capsules, { allowed, chain, index: built.index, rig, home: seg,
                          hCap: layer === 'nervous' ? NERVE_HCAP : 0,
                          ...(layer === 'nervous' ? { passes: NERVE_PASSES } : {}) });
    }
    /* Sampled, not the centroid: the centroid of a horseshoe is in the hole, and the gap
     * that matters is between the structure's own surface and the bone under it. */
    const pos = (sk ?? o).geometry.getAttribute('position');
    const step = Math.max(1, Math.floor(pos.count / 60));
    const pts = [];
    for (let i = 0; i < pos.count; i += step) pts.push(i);
    SOFT.push({ id: SOFT.length, name: o.name, layer, seg, sk, geo: (sk ?? o).geometry, pts });
  }
}


/* ---------------------------------------------------------------- measuring */
const restBone = new Map();
for (const [n, node] of rig.nodes) restBone.set(n, node.joint.matrixWorld.clone());

const _v = new THREE.Vector3(), i4 = new Uint16Array(4), w4 = new Float32Array(4);
/**
 * A structure's sample points in the current pose — skinned on the GPU's arithmetic where it
 * is skinned, and carried by its own segment where it is not.
 *
 * The rigid half matters as much as the skinned half and is easy to leave out: an organ that
 * is never moved by the measurement reports no drift however wrongly it is bound, because
 * what the binding decides is precisely which segment carries it. The first version of this
 * tool did exactly that and passed a build in which the bladder rode a thigh.
 */
function samplePoints(s, delta = null) {
  const pos = s.geo.getAttribute('position');
  const si = s.sk ? s.geo.getAttribute('skinIndex') : null;
  const sw = s.sk ? s.geo.getAttribute('skinWeight') : null;
  const m = si ? null : (delta?.get(s.seg) ?? null);
  return s.pts.map((i) => {
    _v.set(pos.getX(i), pos.getY(i), pos.getZ(i));
    if (!si) return (m ? _v.applyMatrix4(m) : _v).clone();
    for (let k = 0; k < 4; k++) { i4[k] = si.getComponent(i, k); w4[k] = sw.getComponent(i, k); }
    return skinPoint(dq.data, i4, w4, _v).clone();
  });
}
/** current world of each segment relative to the bind pose */
function deltas() {
  const d = new Map();
  for (const [n, node] of rig.nodes)
    d.set(n, node.joint.matrixWorld.clone().multiply(restBone.get(n).clone().invert()));
  return d;
}

/* A grid over the bone cloud at the default pose — the same frame the structure samples are
 * taken in — so "which bone is this lying on" is asked of two things in one place. */
const CELL = 0.03;
const restGrid = new Map();
function boneAtDefault() {
  const delta = deltas();
  return BONE.map(b => b.p.clone().applyMatrix4(delta.get(b.seg) ?? new THREE.Matrix4()));
}
let BONE_AT_DEFAULT = null;
function buildRestGrid() {
  restGrid.clear();
  BONE_AT_DEFAULT = boneAtDefault();
  for (let i = 0; i < BONE_AT_DEFAULT.length; i++) {
    const p = BONE_AT_DEFAULT[i];
    const k = `${Math.floor(p.x / CELL)},${Math.floor(p.y / CELL)},${Math.floor(p.z / CELL)}`;
    let l = restGrid.get(k);
    if (!l) restGrid.set(k, l = []);
    l.push(i);
  }
}
function nearestBoneIndex(p) {
  const a0 = Math.floor(p.x / CELL), b0 = Math.floor(p.y / CELL), c0 = Math.floor(p.z / CELL);
  let bd = Infinity, best = -1;
  for (let r = 0; r <= 10; r++) {
    for (let a = a0 - r; a <= a0 + r; a++)
      for (let b = b0 - r; b <= b0 + r; b++)
        for (let c = c0 - r; c <= c0 + r; c++) {
          if (r && Math.max(Math.abs(a - a0), Math.abs(b - b0), Math.abs(c - c0)) !== r) continue;
          const l = restGrid.get(`${a},${b},${c}`);
          if (!l) continue;
          for (const i of l) {
            const d = BONE_AT_DEFAULT[i].distanceToSquared(p);
            if (d < bd) { bd = d; best = i; }
          }
        }
    if (best >= 0 && bd <= (r * CELL) * (r * CELL)) break;
  }
  return best;
}

function poseRig(coords) {
  rig.setAll(coords);
  rig.root.updateMatrixWorld(true);
  dq.update();
}

const _I = new THREE.Matrix4();
/** Each structure's samples and its bone anchors, both carried into the current pose. */
function spread() {
  const delta = deltas();
  const _b = new THREE.Vector3();
  const out = new Map();
  for (const s of SOFT) {
    const now = samplePoints(s, delta);
    const d = [];
    for (let i = 0; i < now.length; i++) {
      const a = s.anchor[i];
      if (a < 0) continue;
      _b.copy(BONE[a].p).applyMatrix4(delta.get(BONE[a].seg) ?? _I);
      d.push(now[i].distanceTo(_b));
    }
    if (!d.length) continue;
    d.sort((x, y) => x - y);
    /* The median says where the bulk of a structure went; the nine-tenths point says whether
     * part of it is somewhere else entirely. A muscle whose belly is right and whose rim has
     * been dragged onto another bone reads as perfect on the median alone — and a rim is what
     * is visible, because it is the silhouette. */
    out.set(s.id, { mid: d[Math.floor(d.length / 2)], p90: d[Math.floor(d.length * 0.9)] });
  }
  return out;
}

/* At rest: pair every sample of every structure with the bone point it is lying on, and
 * record the distance *through the same transform the posed measurement uses* — the default
 * coordinate values are not the bind pose (Rajagopal stands at pelvis_ty 0.94), so a
 * baseline taken off the raw geometry is a different measurement from the one it is
 * subtracted from, and the difference swamps the drift being looked for. */
poseRig({});
buildRestGrid();
{
  const delta = deltas();
  for (const s of SOFT) s.anchor = samplePoints(s, delta).map(p => nearestBoneIndex(p));
}
const BASE = spread();

/**
 * How far outside the flesh does each nerve end up?
 *
 * A different question from drift, and the one that shows. A nerve can stay perfectly close
 * to its own bone and still finish up lying on top of the thigh, because the muscle over it
 * is skinned by a different rule and moves out from under it. At rest the nerves are inside
 * the body — measured against the body's own voxel volume the worst overhang is 1.6 cm, which
 * is one voxel — so anything past that is the pose pulling them out, not the model.
 */
export function nerveOutside(keys = null) {
  const flesh = SOFT.filter(s => s.layer !== 'nervous');
  const nerves = SOFT.filter(s => s.layer === 'nervous');
  const clips = keys ?? Object.keys(MOTION);
  const worst = new Map();
  const C = 0.02;
  for (const key of clips) {
    const clip = MOTION[key];
    if (!clip) continue;
    for (const kf of clip.keys) {
      poseRig(kf.c);
      const delta = deltas();
      const grid = new Map();
      for (const s of flesh) for (const p of samplePoints(s, delta)) {
        const k = `${Math.floor(p.x / C)},${Math.floor(p.y / C)},${Math.floor(p.z / C)}`;
        let l = grid.get(k); if (!l) grid.set(k, l = []); l.push(p);
      }
      const near = (p) => {
        const a0 = Math.floor(p.x / C), b0 = Math.floor(p.y / C), c0 = Math.floor(p.z / C);
        let bd = Infinity;
        for (let r = 0; r <= 5; r++) {
          for (let a = a0 - r; a <= a0 + r; a++)
            for (let b = b0 - r; b <= b0 + r; b++)
              for (let c = c0 - r; c <= c0 + r; c++) {
                if (r && Math.max(Math.abs(a - a0), Math.abs(b - b0), Math.abs(c - c0)) !== r) continue;
                const l = grid.get(`${a},${b},${c}`);
                if (l) for (const q of l) bd = Math.min(bd, q.distanceToSquared(p));
              }
          if (bd < Infinity && bd <= (r * C) * (r * C)) break;
        }
        return Math.sqrt(bd);
      };
      for (const s of nerves) {
        const d = samplePoints(s, delta).map(near).sort((x, y) => x - y);
        const p90 = d[Math.floor(d.length * 0.9)];
        const had = worst.get(s.id);
        if (!had || p90 > had.gap) worst.set(s.id, { gap: p90, key, t: kf.t, name: s.name });
      }
    }
  }
  return worst;
}

export function bindDrift(keys = null) {
  const clips = keys ?? Object.keys(MOTION);
  const worst = new Map();
  for (const key of clips) {
    const clip = MOTION[key];
    if (!clip) continue;
    for (const kf of clip.keys) {
      poseRig(kf.c);
      const sp = spread();
      for (const [id, d] of sp) {
        const b = BASE.get(id) ?? { mid: 0, p90: 0 };
        const g = d.mid - b.mid, edge = d.p90 - b.p90;
        const had = worst.get(id);
        if (!had || Math.max(g, edge) > Math.max(had.grew, had.edge))
          worst.set(id, { grew: g, edge, key, t: kf.t, name: SOFT[id].name, layer: SOFT[id].layer });
      }
    }
  }
  return worst;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // argv[0] is the node binary and argv[1] is this file; the clip list is anything after
  const argKeys = process.argv.slice(2).find(a => !a.startsWith('-'));
  const keys = process.argv.includes('--all') || !argKeys ? null : argKeys.split(',');
  if (process.env.NERVES) {
    const w = [...nerveOutside(keys).values()].sort((a, b) => b.gap - a.gap);
    console.log('nerve distance to the nearest flesh, nine-tenths point (body heights):');
    for (const r of w.slice(0, 20))
      console.log(`   ${r.name.padEnd(30)} ${r.gap.toFixed(4)}   worst in ${r.key} @ ${r.t}`);
    process.exit(0);
  }
  const worst = bindDrift(keys);
  const bad = [...worst].filter(([, w]) => Math.max(w.grew, w.edge) > GAP_TOLERANCE)
                        .sort((a, b) => Math.max(b[1].grew, b[1].edge) - Math.max(a[1].grew, a[1].edge));
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(bad.map(([, w]) => w), null, 1));
  } else {
    console.log(`${SOFT.length} structures over ${keys ? keys.length : Object.keys(MOTION).length} clips`);
    console.log(`${bad.length} leave their own bones by more than ${(GAP_TOLERANCE * 100).toFixed(1)} of a body height\n`);
    if (process.env.TOP) {   // every structure ranked, not only the ones over the bar
      const all = [...worst].sort((a, b) => Math.max(b[1].grew, b[1].edge) - Math.max(a[1].grew, a[1].edge))
                            .slice(0, Number(process.env.TOP));
      console.log('worst drift regardless of the bar:');
      for (const [, w] of all)
        console.log(`   ${w.name.padEnd(40)} bulk ${w.grew.toFixed(3)} edge ${w.edge.toFixed(3)}   ${w.key} @ ${w.t}`);
    }
    for (const [, w] of bad.slice(0, 40))
      console.log(`   ${w.name.padEnd(40)} bulk ${w.grew.toFixed(3)}  edge ${w.edge.toFixed(3)}   worst in ${w.key} @ ${w.t}`);
  }
}
