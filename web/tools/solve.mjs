/**
 * Solve a record's root placement.
 *
 * `pelvis_tilt`, `pelvis_list` and `pelvis_rotation` are not anatomy — they are the six
 * degrees of freedom that put the model somewhere in the world, and `parse_opensim.py` says
 * so at the line that opens their range. So they should not be hand-authored per exercise:
 * the joint angles are the anatomical claim, and the placement is whatever orientation makes
 * the figure rest the way its position class rests. Written by hand they are just an
 * opportunity to get a sign backwards, which is how a whole supine repertoire ended up
 * performing itself face down.
 *
 * This searches the placement that best satisfies the class, holding every joint angle the
 * record states. The numbers it finds are written back into the library so they stay visible
 * and reviewable — derived, not guessed.
 *
 * Usage: node tools/solve.mjs <key> [class]        one record, printed
 *        node tools/solve.mjs --all                every record that fails its class
 */
import { readFileSync, writeFileSync } from 'node:fs';
import * as THREE from '../vendor/three.module.js';
import { Rig } from '../src/rig.js';
import { YOGA } from '../src/content/library/yoga.js';
import { PILATES } from '../src/content/library/pilates.js';
import { DEFAULT_CONTACTS } from '../src/content/library/vocabulary.js';

const rigJson = JSON.parse(readFileSync(new URL('../src/generated/rig.json', import.meta.url), 'utf8'));
const live = new Rig(rigJson); live.captureBindPose();
const D = Math.PI / 180, TRANS = new Set(['pelvis_tx', 'pelvis_ty', 'pelvis_tz']);
const V = n => new THREE.Vector3().setFromMatrixPosition(live.nodes.get(n).body.matrixWorld);

/* The same list `tools/check.mjs` walks. Both have to see the whole figure, not just the
 * head: the solver owns the root, so a floor rule it cannot see is a floor rule the next
 * `poses:solve --write` undoes. */
const LANDMARKS = ['toes_r', 'calcn_r', 'talus_r', 'tibia_r', 'femur_r',
                   'toes_l', 'calcn_l', 'talus_l', 'tibia_l', 'femur_l',
                   'hand_r', 'ulna_r', 'humerus_r', 'hand_l', 'ulna_l', 'humerus_l',
                   'skull', 'pelvis', 'L3', 'T10', 'T1'];

function state(pose) {
  live.reset();
  const v = {};
  for (const [k, x] of Object.entries(pose)) v[k] = (TRANS.has(k) || /_wave$/.test(k)) ? x : x * D;
  live.setAll(v); live.root.updateMatrixWorld(true);
  const hip = V('pelvis').y;
  const low = s => Math.min(V(`toes_${s}`).y, V(`calcn_${s}`).y, V(`tibia_${s}`).y) - hip;
  const m = live.nodes.get('pelvis').body.matrixWorld;
  // the segment frames are OpenSim's: +X anterior, +Y superior, +Z toward the body's right
  const axis = (x, y, z) => new THREE.Vector3(x, y, z).transformDirection(m);
  return {
    head: V('skull').y - hip,
    footLo: Math.min(low('r'), low('l')), footHi: Math.max(low('r'), low('l')),
    hand: Math.min(V('hand_r').y, V('hand_l').y) - hip,
    handHi: Math.max(V('hand_r').y, V('hand_l').y) - hip,
    shoulder: Math.max(V('humerus_r').y, V('humerus_l').y) - hip,
    // a plank is a straight line from the shoulders to the heels, so the top of the thoracic
    // spine sits level with the pelvis. Without this the solver is free to pike the trunk up
    // and still satisfy every other term.
    trunk: V('T1').y - hip,
    // the arm's floor contact: the hand, or the forearm where the pose rests on the elbows
    armLow: Math.min(V('hand_r').y, V('hand_l').y, V('ulna_r').y, V('ulna_l').y) - hip,
    knee: Math.min(V('tibia_r').y, V('tibia_l').y) - hip,
    belly: axis(1, 0, 0),       // where the front of the pelvis points
    lateral: axis(0, 0, 1),     // the body's right, which is vertical when lying on a side
    contact: {
      foot_r: low('r'), foot_l: low('l'),
      knee_r: V('tibia_r').y - hip, knee_l: V('tibia_l').y - hip,
      hand_r: V('hand_r').y - hip, hand_l: V('hand_l').y - hip,
      forearm_r: Math.min(V('hand_r').y, V('ulna_r').y) - hip,
      forearm_l: Math.min(V('hand_l').y, V('ulna_l').y) - hip,
      head: V('skull').y - hip,
    },
    // every joint centre that could end up under the floor the contacts define
    every: Object.fromEntries(LANDMARKS.map(n => [n, V(n).y - hip])),
  };
}

/**
 * Lower is better. Each class scores the thing that makes the shape recognisable, and only
 * that: the joint angles are the record's business, the placement is this function's.
 *
 * The terms are one-sided wherever the class has a floor rather than a target — a standing
 * pose needs a foot *at least* so far below the hips and does not care how much further, so
 * scoring the distance itself would drag every pose toward the extreme that satisfies it.
 */
const SCORE = {
  // lying down is a statement about which way the front of the pelvis points, and nothing
  // else: what the head and legs do on top of that is the exercise
  supine:    s => (1 - s.belly.y) * 3,
  supported: s => (1 - s.belly.y) * 3,
  reformer:  s => (1 - s.belly.y) * 3,
  prone:     s => (1 + s.belly.y) * 3,
  // on a side, the vertical axis is the body's own left-right one
  sidelying: s => (1 - Math.abs(s.lateral.y)) * 3 + Math.abs(s.head) * 0.4,
  // sitting on the floor: trunk up, nothing hanging below the pelvis
  seated:      s => Math.max(0, 0.30 - s.head) * 3 + Math.max(0, -0.26 - s.footLo) * 3
                    + Math.abs(s.belly.y) * 1.2,
  crossLegged: s => Math.max(0, 0.30 - s.head) * 3 + Math.max(0, -0.26 - s.footLo) * 3
                    + Math.abs(s.belly.y) * 1.2,
  chairSeated: s => Math.max(0, 0.28 - s.head) * 3 + Math.max(0, -0.55 - s.footLo) * 2
                    + Math.abs(s.belly.y) * 1.2,
  // upright on the feet: head well up, a foot well down
  standing: s => Math.max(0, 0.25 - s.head) * 3 + Math.max(0, s.footLo + 0.40) * 3
                 + Math.max(0, Math.abs(s.belly.y) - 0.35) * 2,
  lunge:    s => Math.max(0, 0.20 - s.head) * 3 + Math.max(0, s.footLo + 0.38) * 3
                 + Math.max(0, Math.abs(s.belly.y) - 0.45) * 2,
  kneeling: s => Math.max(0, 0.20 - s.head) * 3 + Math.max(0, s.footLo + 0.20) * 3
                 + Math.max(0, Math.abs(s.belly.y) - 0.45) * 2,
  // the one kneel whose head is down: the hips sit back on the heels and the chest folds over
  // the thighs, so the floor is close — a child's pose rests its pelvis about a fifth of a
  // body height above the mat — and the head goes below the hips rather than well above them
  kneelingFold: s => Math.max(0, s.head + 0.05) * 3 + Math.max(0, s.footLo + 0.08) * 3
                 + Math.max(0, s.belly.y) * 1.5,
  // a squat keeps the feet on the floor with the hips low, so the floor is close, not far
  squat:    s => Math.max(0, 0.20 - s.head) * 3 + Math.max(0, s.footLo + 0.15) * 3
                 + Math.max(0, Math.abs(s.belly.y) - 0.55) * 2,
  // one foot on the floor and the other clearly off it. The trunk may be anywhere — that is
  // what separates a balance from a stance
  balance: s => Math.max(0, s.footLo + 0.38) * 3 + Math.max(0, 0.20 - (s.footHi - s.footLo)) * 2,
  // a low lunge is the one lunge with its chest down: the hips stay off the floor and the
  // head comes below them, which is the opposite of what the upright lunge score wants
  lowLunge: s => Math.max(0, s.footLo + 0.12) * 3 + Math.max(0, s.head - 0.14) * 2
                 + Math.max(0, s.belly.y) * 1.5 + Math.abs(s.footLo - s.armLow) * 2,
  // folded over the legs: feet still down, head below the hips
  standingFold: s => Math.max(0, s.footLo + 0.40) * 3 + Math.max(0, s.head + 0.05) * 2,
  // hips at the apex
  inverted: s => Math.max(0, s.head + 0.30) * 3,
  // hands and feet on one floor, both below the hips, face down
  // the arms have to reach *down* to the floor, not just end up near it: with the body
  // horizontal an arm reaching straight overhead also lands level with the feet
  plank: s => Math.abs(s.footLo - s.armLow) * 2 + Math.max(0, s.footLo) + Math.max(0, s.armLow)
              + Math.max(0, s.belly.y) * 1.5 + Math.max(0, 0.10 - (s.shoulder - s.armLow)) * 3
              + Math.abs(s.trunk) * 2,
  // the same, face up: reverse plank and the upward-facing shapes
  plankSupine: s => Math.abs(s.footLo - s.hand) * 2 + Math.max(0, s.footLo) + Math.max(0, s.hand)
              + Math.max(0, -s.belly.y) * 1.5 + Math.max(0, 0.12 - (s.shoulder - s.armLow)) * 3
              + Math.abs(s.trunk) * 2,
  // hands and knees down, hips above them, back roughly level
  // no trunk term: a quadruped shape is defined by four contacts, and cat-cow rounds and
  // arches the back between them on purpose
  quadruped: s => Math.abs(s.knee - s.armLow) * 2 + Math.max(0, s.knee) + Math.max(0, s.armLow)
              + Math.max(0, s.belly.y) * 1.5 + Math.max(0, 0.10 - (s.shoulder - s.armLow)) * 3,
  // the hands are the only thing on the floor, and everything else is above them
  armBalance: s => Math.max(0, 0.12 - (s.footLo - s.armLow)) * 3
                   + Math.max(0, 0.10 - (s.shoulder - s.armLow)) * 3
                   + Math.max(0, s.armLow) * 2,
  // an inverted V: hands and feet on one floor, hips the highest point, trunk sloping down
  // to the hands. Filing these as planks and demanding a level trunk asks for the opposite
  // of the shape.
  // the one hand-supported class that was missing the shoulder-above-the-hand term every
  // other one carries. Without it the solver is free to roll the figure further over until
  // the shoulders come down level with the hands — which satisfies "hands and feet on one
  // floor" and is an inverted heap, not a pike.
  pike: s => Math.abs(s.footLo - s.armLow) * 2 + Math.max(0, s.footLo + 0.25)
             + Math.max(0, s.armLow + 0.25) + Math.max(0, s.head + 0.05) * 2
             + Math.max(0, 0.10 - (s.shoulder - s.armLow)) * 3,
};

/**
 * Every class carries this on top of its own rule: whatever the record says it stands on has
 * to end up on one floor.
 *
 * Without it the solver and `tools/check.mjs` want different things, and the next
 * `poses:solve --write` quietly undoes a pose that was fixed to satisfy the contact rule —
 * which is worse than not having the rule, because the regression looks like a solve.
 */
export function contactCost(s, contacts, allowBelow = false) {
  if (!contacts || contacts.length < 2) return 0;
  const h = contacts.map(n => s.contact[n]);
  /* Weighted far above the class terms on purpose. A class score is a preference — a
   * kneeling pose would rather have its head well up — while a contact rule is a hard
   * failure, and a solver that trades one for the other writes a placement the checker then
   * rejects. */
  let c = Math.max(0, Math.max(...h) - Math.min(...h) - 0.04) * 30;
  // and nothing sinks through the floor those contacts define — the same rule the checker
  // applies, so the two cannot want different things
  if (!contacts.includes('head'))
    c += Math.max(0, Math.min(...h) - 0.04 - s.contact.head) * 30;
  // nor does anything else sink through it. Without this the solver happily rolls a quadruped
  // upright to shave a hundredth off the class score and leaves its toes 30 cm under the mat.
  if (!allowBelow) {
    const lo = Math.min(...h);
    let worst = 0;
    for (const y of Object.values(s.every ?? {})) worst = Math.max(worst, lo - y);
    c += Math.max(0, worst - 0.05) * 30;
  }
  return c;
}

export function solve(pose, cls, { list = false, contacts = null, allowBelow = false } = {}) {
  const base = SCORE[cls];
  if (!base) throw new Error(`no rule for position "${cls}"`);
  const want = contacts ?? DEFAULT_CONTACTS[cls];
  const score = s => base(s) + contactCost(s, want, allowBelow);
  let best = null;
  const tilts = [];
  for (let t = -180; t <= 180; t += 2) tilts.push(t);
  const lists = list ? Array.from({ length: 73 }, (_, i) => -180 + i * 5) : [pose.pelvis_list ?? 0];
  for (const t of tilts)
    for (const l of lists) {
      const p = { ...pose, pelvis_tilt: t, pelvis_list: l };
      // among placements the class is equally happy with, prefer the least rotated: it keeps
      // the figure where a reader expects it and makes the numbers comparable across records
      const c = score(state(p)) + (Math.abs(t) + Math.abs(l)) * 2e-4;
      if (!best || c < best.c - 1e-9) best = { c, t, l };
    }
  // refine
  for (const step of [1, 0.5]) {
    for (let t = best.t - 2; t <= best.t + 2; t += step)
      for (const l of list ? [best.l - 2, best.l - 1, best.l, best.l + 1, best.l + 2] : [best.l]) {
        const c = score(state({ ...pose, pelvis_tilt: t, pelvis_list: l }))
          + (Math.abs(t) + Math.abs(l)) * 2e-4;
        if (c < best.c - 1e-9) best = { c, t, l };
      }
  }
  return { tilt: +best.t.toFixed(1), list: +best.l.toFixed(1), cost: +best.c.toFixed(3),
           after: state({ ...pose, pelvis_tilt: best.t, pelvis_list: best.l }) };
}

/* ------------------------------------------------------------------- writing back
 * The solved placement goes into the library source rather than being applied at load time,
 * so the number a reader sees in the record is the number the rig uses. `entry` gets the
 * same placement as `pose`: a clip that changed orientation between its two ends would swing
 * the figure through the floor on every loop. */

function patchObject(src, from, key, value) {
  // `from` indexes the '{' that opens the object
  let depth = 0, end = from;
  for (let i = from; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) { end = i; break; } }
  }
  const body = src.slice(from, end + 1);
  const re = new RegExp(`(${key}: )(-?[\\d.]+)`);
  /* Inserting at the front of the object is wrong when the object opens with a spread: the
   * spread would override the value we just wrote, and the write would look like it landed.
   * So a new field goes in after the last leading `...CONST,`. */
  const lead = /^\{\s*((?:\.\.\.[A-Za-z0-9_$]+,\s*)*)/.exec(body);
  const next = re.test(body)
    ? body.replace(re, `$1${value}`)
    : `{ ${lead[1]}${key}: ${value}, ` + body.slice(lead[0].length);
  return src.slice(0, from) + next + src.slice(end + 1);
}

export function writeBack(file, key, fields) {
  let src = readFileSync(file, 'utf8');
  const at = src.indexOf(`{ key: '${key}'`);
  if (at < 0) throw new Error(`${key} not found in ${file}`);
  const stop = src.indexOf("\n  { key: '", at + 1);
  const blockEnd = stop < 0 ? src.length : stop;
  for (const which of ['entry', 'pose']) {
    const m = new RegExp(`${which}: \\{`).exec(src.slice(at, blockEnd));
    if (!m) continue;
    let open = at + m.index + m[0].length - 1;
    for (const [k, v] of Object.entries(fields)) {
      const before = src.length;
      src = patchObject(src, open, k, v);
      open += src.length - before > 0 ? 0 : 0;   // patch is local; the open brace does not move
    }
  }
  writeFileSync(file, src);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = process.argv[2];
  const write = process.argv.includes('--write');
  const all = [...PILATES, ...YOGA].map(r => ({ ...r,
    file: PILATES.includes(r) ? 'src/content/library/pilates.js' : 'src/content/library/yoga.js' }));
  const targets = (arg === '--all' || arg === '--write') ? all : all.filter(r => r.key === arg);
  for (const r of targets) {
    const cls = process.argv[3] || r.position;
    if (!SCORE[cls]) { console.log(`${r.key}: no rule for ${cls}`); continue; }
    const contacts = r.contacts ?? DEFAULT_CONTACTS[cls];
    const allowBelow = !!r.limitation?.belowFloor;
    const before = state(r.pose);
    const beforeCost = SCORE[cls](before) + contactCost(before, contacts, allowBelow);
    if (beforeCost < 0.02) continue;
    const s = solve(r.pose, cls, { list: cls === 'sidelying', contacts, allowBelow });
    /* Never replace a placement that works with one that does not. The solver owns the root
     * and nothing else, so a pose whose remaining cost is in a joint it cannot reach is
     * better left alone than moved to whatever the search liked best. */
    if (s.cost >= beforeCost - 1e-6) {
      console.log(`${r.key.padEnd(28)} ${cls.padEnd(13)} left alone ` +
        `(${beforeCost.toFixed(3)} is already the best this can do)`);
      continue;
    }
    if (write) {
      const fields = { pelvis_tilt: s.tilt };
      if (cls === 'sidelying') fields.pelvis_list = s.list;
      writeBack(r.file, r.key, fields);
    }
    console.log(`${r.key.padEnd(28)} ${cls.padEnd(13)} tilt ${String(s.tilt).padStart(7)}` +
      (cls === 'sidelying' ? ` list ${String(s.list).padStart(6)}` : '') +
      `  cost ${beforeCost.toFixed(2)} -> ${s.cost}` +
      `   head ${s.after.head.toFixed(2)} foot ${s.after.footLo.toFixed(2)} hand ${s.after.hand.toFixed(2)}` +
      ` belly ${s.after.belly.y.toFixed(2)}/${s.after.belly.x.toFixed(2)}`);
  }
}
