/**
 * Put every weight-bearing hand flat on the floor.
 *
 * The arm has seven degrees of freedom in this rig and the library drove four of them.
 * `arm_rot` — the shoulder's own rotation — appeared in two records out of two hundred,
 * `pro_sup` (the forearm turning the palm over) in none, `wrist_dev` in none, and
 * `wrist_flex` in sixteen. So in nearly every exercise the forearm never pronates and the
 * wrist never bends, and the hand simply continues the line of the forearm wherever the
 * elbow happens to point.
 *
 * On a hand that carries weight that is not a small thing. Measured across the library:
 * eleven of fifty-seven weight-bearing hands had their fingertips within three centimetres
 * of the floor, and the rest were up to fifteen centimetres above it or twelve below. The
 * handstand balanced on the *edge* of its hand.
 *
 * The target needs no sign conventions and no palm normal: a hand is flat on the floor when
 * its wrist, both sides of its knuckles and its fingertips are all *at* the floor. Four
 * points at one height is what flat means. The solver moves only the three coordinates the
 * library never set, plus the shoulder's rotation, and it is penalised for moving the wrist
 * itself, because the wrist's position is what the contact rules were solved against.
 *
 * Usage: node tools/hands.mjs            report every weight-bearing hand
 *        node tools/hands.mjs --write    solve and write the angles back into the records
 */
import { readFileSync, writeFileSync } from 'node:fs';
import * as THREE from '../vendor/three.module.js';
import { Rig } from '../src/rig.js';
import { YOGA } from '../src/content/library/yoga.js';
import { PILATES } from '../src/content/library/pilates.js';
import { DEFAULT_CONTACTS } from '../src/content/library/vocabulary.js';
import { writeBack } from './solve.mjs';

const ROOT = new URL('../', import.meta.url);
const rigJson = JSON.parse(readFileSync(new URL('src/generated/rig.json', ROOT), 'utf8'));
const table = JSON.parse(readFileSync(new URL('src/generated/structures.json', ROOT), 'utf8')).structures;
const live = new Rig(rigJson);
live.captureBindPose();

const D = Math.PI / 180;
const TRANS = new Set(['pelvis_tx', 'pelvis_ty', 'pelvis_tz']);
const V = (n) => {
  const r = live.nodes.get(n);
  return r ? new THREE.Vector3().setFromMatrixPosition(r.body.matrixWorld) : null;
};
/* Rest positions of the three hand landmarks that define the palm's plane. They are bone
 * centroids from the build, carried forward by the hand segment exactly the way the viewer
 * carries a structure's centroid — the finger bones ride `hand_r` rigidly, so one matrix
 * moves all of them. */
const restOf = (name, side) => {
  const s = table.find((x) => x.name === name);
  const c = s?.perSide?.[side] ?? s?.centroid;
  return c ? new THREE.Vector3(...c) : null;
};
const LANDMARK = {
  tip: 'distal phalanx of middle finger',
  thumb: 'first metacarpal bone',
  pinky: 'fifth metacarpal bone',
};
const REST = {};
for (const side of ['R', 'L']) {
  REST[side] = {};
  for (const [k, n] of Object.entries(LANDMARK)) REST[side][k] = restOf(n, side);
}
if (Object.values(REST).some((s) => Object.values(s).some((v) => !v)))
  throw new Error('a hand landmark is missing from structures.json');

const POINT = {
  foot_r: ['toes_r', 'calcn_r'], foot_l: ['toes_l', 'calcn_l'],
  knee_r: ['tibia_r'], knee_l: ['tibia_l'],
  hand_r: ['hand_r'], hand_l: ['hand_l'],
  forearm_r: ['hand_r', 'ulna_r'], forearm_l: ['hand_l', 'ulna_l'],
  head: ['skull'],
};

function place(pose) {
  live.reset();
  const v = {};
  for (const [k, x] of Object.entries(pose)) v[k] = (TRANS.has(k) || /_wave$/.test(k)) ? x : x * D;
  live.setAll(v);
  live.root.updateMatrixWorld(true);
}

/** The four points that have to share a height for a palm to be flat, plus the floor. */
function handAt(side, names) {
  const S = side.toUpperCase();
  const m = new THREE.Matrix4().multiplyMatrices(
    live.nodes.get(`hand_${side}`).body.matrixWorld, live.bind.get(`hand_${side}`));
  let floor = Infinity;
  for (const c of names) for (const n of POINT[c] ?? []) floor = Math.min(floor, V(n).y);
  const wrist = V(`hand_${side}`);
  const pts = {
    wrist,
    tip: REST[S].tip.clone().applyMatrix4(m),
    thumb: REST[S].thumb.clone().applyMatrix4(m),
    pinky: REST[S].pinky.clone().applyMatrix4(m),
  };
  return { floor, pts };
}

/** How far this hand is from lying flat on the floor, in body heights. */
function handCost(side, names) {
  const { floor, pts } = handAt(side, names);
  const ys = [pts.wrist.y, pts.tip.y, pts.thumb.y, pts.pinky.y];
  // flat: every point at the same height. On the floor: that height is the floor's.
  const mean = ys.reduce((a, b) => a + b, 0) / ys.length;
  let spread = 0;
  for (const y of ys) spread += (y - mean) ** 2;
  return { spread: Math.sqrt(spread / ys.length), drop: mean - floor, wrist: pts.wrist.clone() };
}

const ALL = [...PILATES, ...YOGA].map((r) => ({ ...r,
  file: PILATES.includes(r) ? 'src/content/library/pilates.js' : 'src/content/library/yoga.js' }));

/* Only what the library never set, plus the shoulder's own rotation — which is the coordinate
 * that decides where the elbow points and therefore whether the palm *can* reach the floor at
 * all. Everything the contact rules were solved against is left alone. */
const FREE = (s) => [`arm_rot_${s}`, `pro_sup_${s}`, `wrist_flex_${s}`, `wrist_dev_${s}`];
const lim = (k) => {
  const c = rigJson.coordinates[k];
  return c ? [c.range[0] / D, c.range[1] / D] : [-180, 180];
};

/* An arm that carries no weight still has an orientation, and the library never set one:
 * `arm_rot` was in two records out of two hundred, so every free arm hung at rotation zero
 * and the palms faced backward with the arms overhead.
 *
 * There is a rule here rather than two hundred judgements. Across the shapes this library
 * actually contains — arms hanging, arms out to the side at shoulder height, arms overhead —
 * the anatomically neutral orientation is the same one every time: thumbs forward. Palms
 * facing each other overhead is thumbs forward. Palms down in a wide stance is thumbs
 * forward. Arms at the sides in neutral is thumbs forward. So the target is a single scalar,
 * the knuckle line pointing anteriorly, and it needs no per-pose decision. */
const ANTERIOR = new THREE.Vector3(0, 0, 1);
function thumbForward(side) {
  const S = side.toUpperCase();
  const m = new THREE.Matrix4().multiplyMatrices(
    live.nodes.get(`hand_${side}`).body.matrixWorld, live.bind.get(`hand_${side}`));
  const thumb = REST[S].thumb.clone().applyMatrix4(m);
  const pinky = REST[S].pinky.clone().applyMatrix4(m);
  return new THREE.Vector3().subVectors(thumb, pinky).normalize().dot(ANTERIOR);
}

const write = process.argv.includes('--write');
const before = [], after = [];
const patches = new Map();

for (const r of ALL) {
  const names = r.contacts ?? DEFAULT_CONTACTS[r.position];
  if (!names?.some((n) => /^(hand|forearm)_/.test(n))) continue;
  for (const side of ['r', 'l']) {
    if (!names.includes(`hand_${side}`) && !names.includes(`forearm_${side}`)) continue;
    const free = FREE(side).filter((k) => rigJson.coordinates[k]);
    const base = { ...r.pose };
    place(base);
    const start = handCost(side, names);
    before.push({ key: r.key, side, ...start });

    const anchor = start.wrist.clone();
    const score = (pose) => {
      place(pose);
      const c = handCost(side, names);
      /* Flatness first, then height, then a penalty for having moved the wrist: its position
       * is what `poses:solve` and the contact rules were settled against, and a hand that
       * lies flat somewhere else is not an improvement. */
      return c.spread * 6 + Math.abs(c.drop) * 3 + c.wrist.distanceTo(anchor) * 12;
    };
    let cur = { ...base }, best = score(cur);
    for (let step = 40; step > 0.4; step *= 0.55) {
      let moved = true;
      while (moved) {
        moved = false;
        for (const k of free) {
          const [lo, hi] = lim(k);
          for (const d of [step, -step]) {
            const val = Math.max(lo, Math.min(hi, (cur[k] ?? 0) + d));
            if (val === (cur[k] ?? 0)) continue;
            const t = { ...cur, [k]: val }, sc = score(t);
            if (sc < best - 1e-9) { cur = t; best = sc; moved = true; }
          }
        }
      }
    }
    place(cur);
    after.push({ key: r.key, side, ...handCost(side, names) });
    if (write) {
      const fields = patches.get(r.key) ?? { file: r.file, fields: {} };
      for (const k of free) {
        const v = Math.round((cur[k] ?? 0) * 10) / 10;
        if (Math.abs(v - (base[k] ?? 0)) > 0.05) fields.fields[k] = v;
      }
      patches.set(r.key, fields);
    }
  }
}

const flat = (rows) => rows.filter((x) => x.spread < 0.012).length;
const down = (rows) => rows.filter((x) => Math.abs(x.drop) < 0.03).length;
console.log(`${before.length} weight-bearing hands`);
console.log(`  flat on the floor   ${flat(before)} -> ${flat(after)}`);
console.log(`  at the floor        ${down(before)} -> ${down(after)}`);
const worst = after.map((a, i) => ({ ...a, was: before[i] }))
  .sort((x, y) => (y.spread + Math.abs(y.drop)) - (x.spread + Math.abs(x.drop)));
console.log('\nstill worst:');
for (const x of worst.slice(0, 8))
  console.log(`  ${x.key.padEnd(26)} ${x.side}  spread ${x.spread.toFixed(3)} ` +
    `(was ${x.was.spread.toFixed(3)})  drop ${x.drop.toFixed(3)} (was ${x.was.drop.toFixed(3)})`);

/* ------------------------------------------------------- the arms that carry nothing */
const freeBefore = [], freeAfter = [];
for (const r of ALL) {
  const names = r.contacts ?? DEFAULT_CONTACTS[r.position] ?? [];
  for (const side of ['r', 'l']) {
    if (names.includes(`hand_${side}`) || names.includes(`forearm_${side}`)) continue;
    // only an arm the pose actually moves: a neutral arm is already where it should be
    const moved = Math.abs(r.pose[`arm_flex_${side}`] ?? 0) > 20
               || Math.abs(r.pose[`arm_add_${side}`] ?? 0) > 20;
    if (!moved) continue;
    const free = [`arm_rot_${side}`, `pro_sup_${side}`].filter(k => rigJson.coordinates[k]);
    const base = { ...r.pose };
    place(base);
    const wrist0 = V(`hand_${side}`).clone();
    freeBefore.push(thumbForward(side));
    const score = (pose) => {
      place(pose);
      // forward, and without dragging the hand somewhere else: the reach solve put it there
      const now = V(`hand_${side}`);
      return (1 - thumbForward(side))
        // enough to keep a hand that is reaching for an ankle on that ankle, not so much
        // that it stops the shoulder rotating
        + now.distanceTo(wrist0) * 3
        // and never *lower* than it started: rotating a shoulder should not push a hand
        // through the mat, which is what it did to the prone swan on the barrel
        + Math.max(0, wrist0.y - now.y) * 40;
    };
    let cur = { ...base }, best = score(cur);
    for (let step = 40; step > 0.4; step *= 0.55) {
      let moving = true;
      while (moving) {
        moving = false;
        for (const k of free) {
          const [lo, hi] = lim(k);
          for (const d of [step, -step]) {
            const val = Math.max(lo, Math.min(hi, (cur[k] ?? 0) + d));
            if (val === (cur[k] ?? 0)) continue;
            const t = { ...cur, [k]: val }, sc = score(t);
            if (sc < best - 1e-9) { cur = t; best = sc; moving = true; }
          }
        }
      }
    }
    place(cur);
    freeAfter.push(thumbForward(side));
    if (write) {
      const p = patches.get(r.key) ?? { file: r.file, fields: {} };
      for (const k of free) {
        const v = Math.round((cur[k] ?? 0) * 10) / 10;
        if (Math.abs(v - (base[k] ?? 0)) > 0.05) p.fields[k] = v;
      }
      patches.set(r.key, p);
    }
  }
}
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
console.log(`\n${freeBefore.length} arms carrying nothing`);
console.log(`  thumbs forward (1 = fully)   ${mean(freeBefore).toFixed(2)} -> ${mean(freeAfter).toFixed(2)}`);
console.log(`  pointing backward            ${freeBefore.filter(x => x < 0).length} -> ${freeAfter.filter(x => x < 0).length}`);

if (write) {
  for (const [key, p] of patches) {
    if (!Object.keys(p.fields).length) continue;
    writeBack(p.file, key, p.fields);
  }
  console.log(`\nwrote ${[...patches.values()].filter((p) => Object.keys(p.fields).length).length} records`);
}
