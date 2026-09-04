/** Every pose that breaks an orientation rule, all at once — the tests stop at the first. */
import { readFileSync } from 'node:fs';
import * as THREE from '../vendor/three.module.js';
import { Rig } from '../src/rig.js';
import { YOGA } from '../src/content/library/yoga.js';
import { PILATES } from '../src/content/library/pilates.js';
import { DEFAULT_CONTACTS } from '../src/content/library/vocabulary.js';
import { MOTION } from '../src/content/motion.js';

const rigJson = JSON.parse(readFileSync(new URL('../src/generated/rig.json', import.meta.url), 'utf8'));
const live = new Rig(rigJson); live.captureBindPose();
const D = Math.PI / 180, TRANS = new Set(['pelvis_tx','pelvis_ty','pelvis_tz']);
const V = n => { const r = live.nodes.get(n); return r ? new THREE.Vector3().setFromMatrixPosition(r.body.matrixWorld) : null; };
function place(pose) {
  live.reset(); const v = {};
  for (const [k, x] of Object.entries(pose)) v[k] = (TRANS.has(k) || /_wave$/.test(k)) ? x : x * D;
  live.setAll(v); live.root.updateMatrixWorld(true);
  const low = s => Math.min(V(`toes_${s}`).y, V(`calcn_${s}`).y, V(`tibia_${s}`).y);
  const hip = V('pelvis').y;
  return { hip, head: V('skull').y - hip, footR: low('r') - hip, footL: low('l') - hip,
           kneeR: V('tibia_r').y - hip, kneeL: V('tibia_l').y - hip,
           shoulder: Math.max(V('humerus_r').y, V('humerus_l').y) - hip,
           trunk: V('T1').y - hip,
           // the arm's contact with the floor is the hand, or the forearm when the pose rests
           // on the elbows — a sphinx and a dolphin carry weight through the ulna
           armLow: Math.min(V('hand_r').y, V('hand_l').y, V('ulna_r').y, V('ulna_l').y) - hip,
           handTop: Math.max(V('hand_r').y, V('hand_l').y) - hip,
           handR: V('hand_r').y - hip, handL: V('hand_l').y - hip,
           contact: {
             foot_r: low('r') - hip, foot_l: low('l') - hip,
             knee_r: V('tibia_r').y - hip, knee_l: V('tibia_l').y - hip,
             hand_r: V('hand_r').y - hip, hand_l: V('hand_l').y - hip,
             forearm_r: Math.min(V('hand_r').y, V('ulna_r').y) - hip,
             forearm_l: Math.min(V('hand_l').y, V('ulna_l').y) - hip,
             head: V('skull').y - hip,
           },
           // the mat is under the *back* of a lying body, not under the joint centres of
           // its spine, so this is the trunk's centre line and the tolerance below is half
           // the body's depth
           mat: Math.min(V('pelvis').y, V('L3').y, V('T10').y, V('T1').y) - hip,
           // everything that could end up under the floor, not only the head
           every: Object.fromEntries(LANDMARKS.map(n => [n, V(n).y - hip])),
           belly: new THREE.Vector3(1,0,0).transformDirection(live.nodes.get('pelvis').body.matrixWorld),
           lateral: new THREE.Vector3(0,0,1).transformDirection(live.nodes.get('pelvis').body.matrixWorld) };
}
/* Every joint centre that can end up under the mat. The head rule below caught the
 * handstand resting on its skull; this list is what catches the rest of the body doing the
 * same thing — a child's pose whose heels were forty-four centimetres under the floor, a
 * quadruped pointing its toes straight down through it. */
const LANDMARKS = ['toes_r', 'calcn_r', 'talus_r', 'tibia_r', 'femur_r',
                   'toes_l', 'calcn_l', 'talus_l', 'tibia_l', 'femur_l',
                   'hand_r', 'ulna_r', 'humerus_r', 'hand_l', 'ulna_l', 'humerus_l',
                   'skull', 'pelvis', 'L3', 'T10', 'T1'];
const FACE = { supine: 1, supported: 1, reformer: 1, prone: -1 };
const LAT = n => new THREE.Vector3(0,0,1);
const UPRIGHT = ['seated','crossLegged','chairSeated','standing','kneeling','lunge','squat'];
const bad = [];
/**
 * Every rule below, over one pose.
 *
 * It used to be an inline loop over the library records, which meant the nine longhand
 * entries — the Hundred, the roll-up, the deadlift and six others — were checked for joint
 * ranges and nothing else. Not one of the floor rules ever ran on them, and all three
 * failures those rules exist to catch were sitting in them: the Hundred drove both hands
 * twenty centimetres through the mat, the roll-up thirty, and the deadlift's start and end
 * pose had the lifter flat on his back with his feet in the air, because `pelvis_tilt` is
 * positive toward supine and the trunk hinge had been written the other way round.
 */
function checkPose(r) {
  const p = place(r.pose);
  const say = m => bad.push(`${r.key.padEnd(28)} ${r.position.padEnd(13)} ${m}`);
  const want = FACE[r.position];
  if (want != null && p.belly.y * want <= 0.55) say(`belly ${p.belly.y.toFixed(2)} (want ${want>0?'up':'down'})`);
  if (r.position === 'sidelying' && Math.abs(p.lateral.y) <= 0.55) say(`lying flat, not on a side (${p.lateral.y.toFixed(2)})`);
  if (UPRIGHT.includes(r.position) && p.head <= 0.10) say(`head ${p.head.toFixed(2)} above pelvis`);
  if (r.position === 'squat' && (p.head <= 0.10 || Math.min(p.footR,p.footL) >= -0.10))
    say(`squat: head ${p.head.toFixed(2)}, floor ${Math.min(p.footR,p.footL).toFixed(2)}`);
  if (r.position === 'balance') {
    const lo = Math.min(p.footR, p.footL), hi = Math.max(p.footR, p.footL);
    if (lo >= -0.30) say(`balance: the standing foot is only ${lo.toFixed(2)} below the pelvis`);
    if (hi - lo < 0.18) say(`balance: both feet are on the floor (${lo.toFixed(2)}, ${hi.toFixed(2)})`);
  }
  if (['standing','lunge','standingFold'].includes(r.position) && Math.min(p.footR,p.footL) >= -0.25)
    say(`lowest contact only ${Math.min(p.footR,p.footL).toFixed(2)}`);
  if (['seated','crossLegged'].includes(r.position) && Math.min(p.footR,p.footL) < -0.28)
    say(`legs hang ${Math.min(p.footR,p.footL).toFixed(2)} below the pelvis`);
  /* A hand does not go through the mat. `arm_flex` is negative for shoulder *extension*,
   * which on a supine body points the arm straight down into the floor — that is how the
   * Jackknife and the Corkscrew came to press their hands eighteen centimetres under the
   * mat. The tolerance is half a body depth at the chest, and half a body width for a pose
   * lying on its side, because the trunk landmarks here are joint centres. */
  const DEPTH = { supine: 0.10, prone: 0.10, supported: 0.10, reformer: 0.10, sidelying: 0.14 };
  if (DEPTH[r.position] != null) {
    const hand = Math.min(p.handR, p.handL);
    if (hand < p.mat - DEPTH[r.position])
      say(`a hand is ${(p.mat - hand).toFixed(2)} below the trunk — through the mat`);
  }
  if (r.position === 'inverted' && p.head > -0.15) say(`head ${p.head.toFixed(2)} — not inverted`);
  /* A low lunge is the one lunge whose head is NOT up: the chest comes down over the front
   * leg onto the hands or the forearms. What makes it that shape rather than a plank is
   * that the front knee stays folded and the hips stay above the floor. */
  /* A kneeling fold is a kneel with its head down — child's pose. It is its own class
   * because the kneeling rule wants the head well above the pelvis, which is exactly what
   * this shape does not do, and being scored as an upright kneel is how the pose came to be
   * drawn as a curl in mid-air with its heels forty-four centimetres under the mat. */
  if (r.position === 'kneelingFold') {
    if (p.belly.y > 0.3) say(`a kneeling fold faces down (${p.belly.y.toFixed(2)})`);
    if (p.head > -0.05) say(`head ${p.head.toFixed(2)} — that is an upright kneel, not a fold`);
    if (Math.min(p.footR, p.footL) < -0.25)
      say(`the hips are ${Math.min(p.footR,p.footL).toFixed(2)} above the heels — not sitting back on them`);
  }
  if (r.position === 'lowLunge') {
    if (p.belly.y > 0.3) say(`a low lunge faces down (${p.belly.y.toFixed(2)})`);
    if (Math.min(p.footR, p.footL) > -0.12)
      say(`the hips are only ${Math.min(p.footR, p.footL).toFixed(2)} above the floor`);
    if (p.head > 0.14) say(`head ${p.head.toFixed(2)} — that is an upright lunge, not a low one`);
  }
  if (r.position === 'armBalance') {
    const foot = Math.min(p.footR, p.footL);
    if (foot - p.armLow < 0.10) say(`arm balance: the feet are not clear of the hands (${(foot - p.armLow).toFixed(2)})`);
    if (p.shoulder - p.armLow < 0.10) say(`arm balance: the arms do not reach down to the floor`);
  }
  if (r.position === 'pike') {
    const foot = Math.min(p.footR, p.footL);
    if (Math.abs(foot - p.armLow) >= 0.25) say(`hands ${p.armLow.toFixed(2)} vs feet ${foot.toFixed(2)}`);
    if (p.head > -0.05) say(`pike: the head is not below the hips (${p.head.toFixed(2)})`);
    if (foot > -0.2 || p.armLow > -0.2) say(`pike: the hips are not the highest point`);
  }
  /* Every contact that carries weight has to sit on the SAME floor. The old rules only
   * asked whether the lowest one was low enough, which let Warrior II stand with its front
   * foot fifteen centimetres in the air: legal angles, correct class, not the pose. */
  const contacts = r.contacts ?? DEFAULT_CONTACTS[r.position];
  if (contacts && contacts.length > 1) {
    const h = contacts.map(n => p.contact[n]);
    const shown = () => contacts.map((n, i) => `${n} ${h[i].toFixed(2)}`).join(', ');
    /* Two tolerances, because this measures joint centres and a wrist does not sit at the
     * same height above the floor as an ankle. Two feet are the same kind of thing and have
     * to agree closely; a hand and a foot are allowed the few centimetres between a wrist
     * centre and a toe centre, and no more. */
    const lo = Math.min(...h), hi = Math.max(...h);
    if (hi - lo > 0.08) say(`its contacts are ${(hi - lo).toFixed(2)} apart in height (${shown()})`);
    /* And nothing sinks through the floor those contacts define. The headstand family all
     * had their arms written backwards — `arm_flex: -88` points the arm behind the body, so
     * inverted it pointed at the ceiling — and a handstand came out resting on its skull with
     * its hands in the air above it. */
    if (!contacts.includes('head') && p.contact.head < lo - 0.04)
      say(`the head is ${(lo - p.contact.head).toFixed(2)} below the floor its contacts define`);
    else for (let i = 0; i < contacts.length; i++) for (let k = i + 1; k < contacts.length; k++)
      if (contacts[i].slice(0, -2) === contacts[k].slice(0, -2) && Math.abs(h[i] - h[k]) > 0.05)
        say(`its two ${contacts[i].slice(0, -2)}s are ${Math.abs(h[i] - h[k]).toFixed(2)} apart (${shown()})`);
    /* And no other part of the figure is under that floor either. The head rule above was
     * this rule for one landmark; the rest of the body sank through the mat unnoticed —
     * a child's pose with its heels 44 cm under it, every quadruped pointing its toes down
     * through it. The tolerance is what a joint centre buys: a toe centre genuinely sits a
     * couple of centimetres below a knee centre resting on the same mat.
     *
     * A pose escapes this only by carrying a limitation note whose text says so, marked
     * `belowFloor` in library/limits.js — the split whose back leg the hip cannot lower, the
     * cross-legged sit whose shins cannot pass through each other, the pigeon whose front hip
     * cannot turn out far enough to lay the shin down. */
    if (!r.limitation?.belowFloor) {
      let worst = 0, who = '';
      for (const [n, y] of Object.entries(p.every)) if (lo - y > worst) { worst = lo - y; who = n; }
      if (worst > 0.05) say(`${who} is ${worst.toFixed(2)} below the floor its contacts define (${shown()})`);
    }
  }

  if (['plank','plankSupine','quadruped'].includes(r.position)) {
    const foot = r.position === 'quadruped' ? Math.min(p.kneeR, p.kneeL) : Math.min(p.footR, p.footL);
    if (Math.abs(foot - p.handR) >= 0.45) say(`hands ${p.handR.toFixed(2)} vs floor ${foot.toFixed(2)}`);
    const wantUp = r.position === 'plankSupine';
    if ((p.belly.y > 0.3) !== wantUp && Math.abs(p.belly.y) > 0.3)
      say(`facing ${p.belly.y > 0 ? 'up' : 'down'}, wanted ${wantUp ? 'up' : 'down'}`);
    // the hand has to be UNDER the shoulder. Level-with-the-feet is not enough: with the body
    // horizontal an arm reaching straight overhead also lands near the feet, which is how a
    // whole plank family ended up doing a backstroke.
    if (p.shoulder - p.armLow < 0.10)
      say(`the arms do not reach down to the floor (shoulder ${p.shoulder.toFixed(2)}, lowest arm ${p.armLow.toFixed(2)})`);
    if (r.position !== 'quadruped' && Math.abs(p.trunk) > 0.14)
      say(`the trunk is not level (T1 sits ${p.trunk.toFixed(2)} from the pelvis)`);
  }
}

for (const r of [...PILATES, ...YOGA]) checkPose(r);

/* And every keyframe of every longhand clip, against the class it declares for that instant.
 * A clip travels — the roll-up starts supine and finishes seated — so the class is per key
 * where it changes, and `positions` on the clip is the default for the rest. */
for (const [key, clip] of Object.entries(MOTION)) {
  if (!clip.position) continue;
  for (const kf of clip.keys) {
    const pose = {};
    for (const [k, v] of Object.entries(kf.c))
      pose[k] = (TRANS.has(k) || /_wave$/.test(k)) ? v : v / D;   // MOTION is already radians
    checkPose({ key: `${key} @${kf.t}`, position: kf.pos ?? clip.position,
                contacts: kf.contacts ?? clip.contacts, pose });
  }
}

console.log(bad.length ? bad.join('\n') : 'all poses pass');
console.log(`\n${bad.length} violations`);
