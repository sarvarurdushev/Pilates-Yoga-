import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PILATES } from '../src/content/library/pilates.js';
import { YOGA } from '../src/content/library/yoga.js';
import { composeExercise, composeMotion, toRadians } from '../src/content/library/compose.js';
import { POSITION, ACTION, BREATH_PATTERN, CONTRA, FAULT, CUE, FAMILY, PROP,
         CONTACT, DEFAULT_CONTACTS }
  from '../src/content/library/vocabulary.js';
import { EXERCISE, EXERCISE_KEYS, COMPOSED, DISCIPLINES, REVIEWER, REVIEWED_DISCIPLINES }
  from '../src/content/exercises.js';
import { EXERCISE_BRAIN } from '../src/content/evidence.js';
import { MUSCLE_INFO } from '../src/content/muscles.js';
import { MOTION } from '../src/content/motion.js';
import { buildRegistry } from '../src/structures.js';

/**
 * The guardrail for the library half of the content.
 *
 * `content.test.mjs` checks the *entries* — every exercise has contraindications, every
 * brain claim has a tier. This file checks the *records* those entries are composed from,
 * because a record failure is the one that would otherwise be silent: a pose naming a
 * coordinate the rig does not have simply never moves that joint, and a facet naming a
 * family that does not exist just disappears out of the browser.
 */

const rigJson = JSON.parse(
  readFileSync(new URL('../src/generated/rig.json', import.meta.url), 'utf8'));
const rig = rigJson;   // the emitted table; `live` below is a Rig driving it
const generated = JSON.parse(
  readFileSync(new URL('../src/generated/structures.json', import.meta.url), 'utf8'));
const REG = buildRegistry(generated);

const LANGS = ['en', 'ko'];
const RECORDS = [['pilates', PILATES], ['yoga', YOGA]];
const ALL = [...PILATES, ...YOGA];
const REGIONAL = /^(lumbar|thoracic|cervical)_(flex|bend|rot|wave)$/;
const D = Math.PI / 180;
const TRANSLATIONS = new Set(['pelvis_tx', 'pelvis_ty', 'pelvis_tz']);

/* --------------------------------------------------------------------- the records */

test('the library is actually a library', () => {
  // the brief asked for hundreds and Pilates is the primary vertical; a regression that
  // silently dropped a file would otherwise still pass every other test in here
  assert.ok(PILATES.length >= 90, `only ${PILATES.length} Pilates records`);
  assert.ok(YOGA.length >= 80, `only ${YOGA.length} yoga records`);
  assert.ok(PILATES.length >= YOGA.length, 'Pilates is the primary discipline');
});

test('every record key is unique across both disciplines', () => {
  const seen = new Map();
  for (const [lib, list] of RECORDS)
    for (const r of list) {
      assert.ok(!seen.has(r.key), `${r.key} is in both ${seen.get(r.key)} and ${lib}`);
      seen.set(r.key, lib);
    }
});

test('every record speaks the shared vocabulary', () => {
  for (const r of ALL) {
    assert.ok(FAMILY[r.family], `${r.key}: unknown family "${r.family}"`);
    assert.ok(POSITION[r.position], `${r.key}: unknown position "${r.position}"`);
    assert.ok(BREATH_PATTERN[r.breath], `${r.key}: unknown breath "${r.breath}"`);
    assert.ok(r.actions?.length, `${r.key}: no actions`);
    for (const a of r.actions) assert.ok(ACTION[a], `${r.key}: unknown action "${a}"`);
    for (const c of r.contra ?? []) assert.ok(CONTRA[c], `${r.key}: unknown contra "${c}"`);
    for (const p of r.props ?? []) assert.ok(PROP[p], `${r.key}: unknown prop "${p}"`);
    for (const lang of LANGS) assert.ok(r[lang]?.name, `${r.key}: no name in ${lang}`);
    assert.ok(r.difficulty >= 1 && r.difficulty <= 5, `${r.key}: difficulty ${r.difficulty}`);
  }
});

test('a record’s family agrees with the discipline it was filed under', () => {
  for (const [lib, list] of RECORDS)
    for (const r of list)
      assert.equal(FAMILY[r.family].discipline, lib,
        `${r.key} is in ${lib}.js but its family "${r.family}" belongs to ${FAMILY[r.family].discipline}`);
});

test('every muscle a record names was built and has something to read', () => {
  for (const r of ALL)
    for (const role of ['prime', 'synergists', 'stabilisers']) {
      const list = r.muscles?.[role];
      assert.ok(Array.isArray(list) && list.length, `${r.key}: no ${role}`);
      for (const [name, ev] of list) {
        assert.ok(REG.byName.has(name), `${r.key}/${role}: "${name}" was not built`);
        assert.ok(MUSCLE_INFO[name], `${r.key}/${role}: "${name}" has no MUSCLE_INFO entry`);
        assert.ok(ev === 'emg' || ev === 'inferred', `${r.key}/${role}/${name}: marker "${ev}"`);
      }
    }
});

test('a deep stabiliser is never claimed as measured', () => {
  // The claim every composed entry makes in words — "deep stabilisers are always inferred,
  // because surface electrodes cannot reach them" — has to be true of the data too.
  //
  // The list is the muscles no electrode reaches without going through something, not simply
  // "the deep ones". Psoas major, iliacus and the deep neck flexors are *not* on it: they
  // have been measured, with intramuscular fine-wire (Juker et al., Med Sci Sports Exerc
  // 1998) and with ultrasound, so an `emg` marker on them is a real citation rather than an
  // overclaim. Transversus abdominis, multifidus, the pelvic floor and the rotatores are.
  const UNREACHABLE = ['transversus abdominis', 'multifidus', 'pubococcygeus',
                       'iliococcygeus', 'coccygeus', 'lumbar rotator', 'thoracic rotator'];
  // over every entry, not only the composed ones: the hand-written entries make the same
  // claim in the same words and are bound by it in the same way
  for (const key of EXERCISE_KEYS)
    for (const role of ['prime', 'synergists', 'stabilisers'])
      for (const [name, ev] of EXERCISE[key].muscles[role])
        if (UNREACHABLE.includes(name))
          assert.notEqual(ev, 'emg',
            `${key} marks "${name}" as EMG-measured, but surface EMG cannot reach it`);
});

test('every record links to brain claims that exist', () => {
  for (const r of ALL) {
    assert.ok(r.brain?.length, `${r.key}: no brain claims`);
    for (const c of r.brain) assert.ok(EXERCISE_BRAIN[c], `${r.key}: no claim "${c}"`);
  }
});

test('activation names built muscles and stays in 0..1', () => {
  for (const r of ALL)
    for (const [name, v] of Object.entries(r.activation ?? {})) {
      assert.ok(REG.byName.has(name), `${r.key} activates "${name}", which was not built`);
      assert.ok(v >= 0 && v <= 1, `${r.key}/${name}: activation ${v}`);
    }
});

/* ------------------------------------------------------------------------- the poses */

test('every pose drives coordinates the rig actually has', () => {
  for (const r of ALL)
    for (const which of ['entry', 'pose'])
      for (const c of Object.keys(r[which] ?? {})) {
        const m = REGIONAL.exec(c);
        if (m) assert.ok(rig.spine.regions[m[1]], `${r.key}/${which}: no region "${m[1]}"`);
        else assert.ok(rig.coordinates[c], `${r.key}/${which}: no coordinate "${c}"`);
      }
});

test('every pose stays inside the published range of the joint it drives', () => {
  // this is the test that keeps the anatomy honest rather than the picture pretty: where a
  // shape needs more range than the model publishes, the pose is clamped and the entry
  // carries a `limitation` saying so — see library/limits.js
  for (const r of ALL)
    for (const which of ['entry', 'pose'])
      for (const [c, v] of Object.entries(r[which] ?? {})) {
        const m = REGIONAL.exec(c);
        if (m && m[2] === 'wave') {
          assert.ok(Math.abs(v) <= 1.8, `${r.key}/${which}: ${c} = ${v} is not a wave position`);
          continue;
        }
        const [lo, hi] = m ? rig.spine.regionRange[m[1]][m[2]] : rig.coordinates[c].range;
        const val = TRANSLATIONS.has(c) ? v : v * D;
        // 1e-6 rad is 6e-5 degrees. The tolerance exists because the .osim file writes its
        // limits to eight decimal places — `arm_add` is stored as -2.0943951, and -120
        // degrees in double precision is 2.4e-9 radians below that. Rejecting a pose over
        // the source file's own rounding would be a test failing on nothing.
        assert.ok(val >= lo - 1e-6 && val <= hi + 1e-6,
          `${r.key}/${which}: ${c} = ${v} is outside [${(lo / (TRANSLATIONS.has(c) ? 1 : D)).toFixed(1)}, ` +
          `${(hi / (TRANSLATIONS.has(c) ? 1 : D)).toFixed(1)}]`);
      }
});

test('a record either moves something or is honest about holding still', () => {
  for (const r of ALL) {
    assert.ok(r.pose && Object.keys(r.pose).length, `${r.key}: no pose`);
    assert.ok(r.hold || r.reps, `${r.key}: neither a hold nor a rep count`);
  }
});

test('a pose that needs more range than the model has says so', () => {
  // the clamped shapes are the ones where the model runs out: arms overhead past 90 degrees
  // of shoulder flexion, and a deep tuck past 120 of hip and knee. Each carries a note.
  const capped = ALL.filter(r => r.limitation);
  assert.ok(capped.length >= 3, 'the clamped poses should carry their limitation');
  for (const r of capped)
    for (const lang of LANGS)
      assert.ok(r.limitation[lang]?.length > 60, `${r.key}: thin limitation in ${lang}`);
});

/* -------------------------------------------------------------------- the composer */

test('toRadians converts angles and leaves lengths and waves alone', () => {
  const out = toRadians({ hip_flexion_r: 90, pelvis_ty: 0.14, lumbar_wave: 1.2 });
  assert.ok(Math.abs(out.hip_flexion_r - Math.PI / 2) < 1e-12);
  assert.equal(out.pelvis_ty, 0.14);
  assert.equal(out.lumbar_wave, 1.2);
});

test('a composed entry has everything a hand-written one has', () => {
  for (const r of ALL) {
    const e = composeExercise(r, REVIEWER);
    assert.equal(e.discipline, FAMILY[r.family].discipline);
    for (const lang of LANGS) {
      const t = e[lang];
      for (const field of ['name', 'summary', 'setup', 'breath', 'tempo',
                           'contraindications', 'focusCue'])
        assert.ok(t[field]?.length, `${r.key}: no ${field} in ${lang}`);
      assert.ok(t.faults.length, `${r.key}: no faults in ${lang}`);
      assert.ok(t.progressions.length && t.regressions.length, `${r.key}: no progressions in ${lang}`);
      for (const [head, fix] of t.faults)
        assert.ok(head?.length && fix?.length, `${r.key}: a fault in ${lang} is half-written`);
    }
    assert.ok(e.emgNote.en && e.emgNote.ko, `${r.key}: no emgNote`);
  }
});

test('the emg note never claims more measurement than the record carries', () => {
  for (const r of ALL) {
    const e = composeExercise(r, REVIEWER);
    const all = [...r.muscles.prime, ...r.muscles.synergists, ...r.muscles.stabilisers];
    const measured = all.filter(([, ev]) => ev === 'emg').length;
    if (measured === 0)
      assert.match(e.emgNote.en, /No EMG study measuring this exercise was found/,
        `${r.key} has no EMG at all and must say so`);
    else
      assert.ok(e.emgNote.en.startsWith(`${measured} of ${all.length}`),
        `${r.key}: the note should count ${measured} of ${all.length}`);
  }
});

test('a composed fault always belongs to an action the exercise performs', () => {
  for (const r of ALL) {
    const acts = new Set(r.actions);
    const e = composeExercise(r, REVIEWER);
    for (const [head] of e.en.faults) {
      const entry = Object.values(FAULT).find(f => f.en[0] === head);
      assert.ok(entry, `${r.key}: fault "${head}" is not in the vocabulary`);
      assert.ok(acts.has(entry.action) || entry.action === 'isometric-hold',
        `${r.key} inherits a fault for "${entry.action}", which it does not do`);
    }
  }
});

test('a composed clip is the same numbers as the pose', () => {
  for (const r of ALL) {
    const clip = composeMotion(r);
    assert.ok(clip, `${r.key}: no clip`);
    assert.equal(clip.provenance, 'handkeyed');
    assert.equal(clip.keys[0].t, 0);
    assert.equal(clip.keys[clip.keys.length - 1].t, 1);
    for (let i = 1; i < clip.keys.length; i++)
      assert.ok(clip.keys[i].t > clip.keys[i - 1].t, `${r.key}: keys out of order`);
    // the second key is the pose itself, in radians, whether it is held or repeated
    const at = clip.keys[1];
    for (const [c, v] of Object.entries(r.pose)) {
      const want = (TRANSLATIONS.has(c) || /_wave$/.test(c)) ? v : v * D;
      assert.ok(Math.abs(at.c[c] - want) < 1e-12,
        `${r.key}: clip and pose disagree on ${c}`);
    }
    assert.ok(clip.phases.length, `${r.key}: no breath phases`);
  }
});

test('a held pose travels in, holds, and travels out', () => {
  const held = ALL.find(r => r.hold);
  const clip = composeMotion(held);
  assert.equal(clip.keys.length, 4, 'a hold needs an arrival and a departure');
  assert.deepEqual(clip.keys[1].c, clip.keys[2].c, 'the hold should not drift');
});

/* ------------------------------------------------------------ where the body ends up
 * The tests above check that a pose is inside the model's ranges. That is not the same as
 * the pose being the exercise: `hip_flexion: 100` on a standing figure raises both legs to
 * horizontal with the trunk upright, which is a double leg lift, not a forward fold. The
 * pelvis is the rig's root, so a fold has to tip the pelvis and let the hips give the legs
 * back — and nothing but geometry catches the difference. This runs the real Rig. */

import { Rig } from '../src/rig.js';
import * as THREE from '../vendor/three.module.js';

const live = new Rig(rigJson);
live.captureBindPose();
const heightOf = name => {
  const rec = live.nodes.get(name);
  return rec ? new THREE.Vector3().setFromMatrixPosition(rec.body.matrixWorld).y : null;
};
const heightZ = name => {
  const rec = live.nodes.get(name);
  return rec ? new THREE.Vector3().setFromMatrixPosition(rec.body.matrixWorld).z : null;
};
function place(pose) {
  live.reset();
  const v = {};
  for (const [k, x] of Object.entries(pose))
    v[k] = (TRANSLATIONS.has(k) || /_wave$/.test(k)) ? x : x * D;
  live.setAll(v);
  live.root.updateMatrixWorld(true);
  // the lowest point of each limb, not the foot: half this repertoire kneels, and in a
  // kneeling pose the knee is what is on the floor while the heel is up by the seat
  const low = side => Math.min(heightOf(`calcn_${side}`), heightOf(`toes_${side}`), heightOf(`tibia_${side}`));
  // the mat is under the *back* of a lying body, not under the joint centres of its spine,
  // so this is the trunk's centre line and the tolerance that uses it is half a body depth
  const mat = Math.min(heightOf('pelvis'), heightOf('L3'), heightOf('T10'), heightOf('T1'));
  return { hip: heightOf('pelvis'), footR: low('r'), footL: low('l'), mat,
           handR: heightOf('hand_r'), handL: heightOf('hand_l'), head: heightOf('skull') };
}

/**
 * Which way the front of the pelvis points, in world axes. This is the definition of lying
 * down, and the one thing that cannot be faked: the segment frames are OpenSim's, so +X on
 * the pelvis body is anterior. +1 is face up, -1 is face down, 0 is upright or on a side.
 */
function belly() {
  const m = live.nodes.get('pelvis').body.matrixWorld;
  return new THREE.Vector3(1, 0, 0).transformDirection(m);
}

const posed = r => { const p = place(r.pose); p.belly = belly().clone(); return p; };

/* Every joint centre that can end up under the mat. `tools/check.mjs` and `tools/solve.mjs`
 * walk the same list, and they have to: the solver owns the root placement, so a floor rule
 * it cannot see is a floor rule the next `poses:solve --write` quietly undoes. */
const LANDMARKS = ['toes_r', 'calcn_r', 'talus_r', 'tibia_r', 'femur_r',
                   'toes_l', 'calcn_l', 'talus_l', 'tibia_l', 'femur_l',
                   'hand_r', 'ulna_r', 'humerus_r', 'hand_l', 'ulna_l', 'humerus_l',
                   'skull', 'pelvis', 'L3', 'T10', 'T1'];

test('a lying pose faces the way its position says', () => {
  // The failure this exists for: `pelvis_tilt: -90` lays the figure face *down*. Written the
  // other way round the whole supine repertoire performed itself prone, every leg raise drove
  // the leg into the mat, and every number stayed inside its published range.
  const WANT = { supine: 1, supported: 1, reformer: 1, prone: -1 };
  for (const r of ALL) {
    const want = WANT[r.position];
    if (want == null) continue;
    const p = posed(r);
    assert.ok(p.belly.y * want > 0.55,
      `${r.key} is ${r.position} but the front of the pelvis points ${p.belly.y.toFixed(2)} ` +
      `(wanted ${want > 0 ? 'up' : 'down'})`);
  }
});

test('a side-lying pose is actually on its side', () => {
  // lying on a side is not "the belly faces sideways" — it is the body's own left-right axis
  // standing vertical. `pelvis_list` alone does it; adding a tilt fights it.
  for (const r of ALL) {
    if (r.position !== 'sidelying') continue;
    place(r.pose);
    const lat = new THREE.Vector3(0, 0, 1)
      .transformDirection(live.nodes.get('pelvis').body.matrixWorld);
    assert.ok(Math.abs(lat.y) > 0.55,
      `${r.key} is side-lying but its mediolateral axis is only ${lat.y.toFixed(2)} vertical`);
  }
});

test('an upright pose keeps the head above the hips', () => {
  const UPRIGHT = ['seated', 'crossLegged', 'chairSeated', 'standing', 'kneeling', 'lunge'];
  for (const r of ALL) {
    if (!UPRIGHT.includes(r.position)) continue;
    const p = posed(r);
    assert.ok(p.head > 0.10,
      `${r.key} is ${r.position} but the head sits ${p.head.toFixed(2)} relative to the pelvis`);
  }
});

test('a standing pose keeps at least one foot under the body', () => {
  // the failure this exists for: a forward fold written as hip flexion alone, which lifts
  // the legs instead of folding the trunk. One foot may leave the floor — that is what a
  // balance is — but not both.
  const STANDING = new Set(['standing', 'lunge', 'standingFold']);
  for (const r of ALL) {
    if (!STANDING.has(r.position)) continue;
    const p = place(r.pose);
    const lowest = Math.min(p.footR, p.footL);
    assert.ok(lowest < p.hip - 0.25,
      `${r.key}: standing, but the lowest contact is only ${(p.hip - lowest).toFixed(2)} below the hip — ` +
      `the legs are lifting instead of the trunk folding`);
  }
});

test('a seated pose puts the legs out in front rather than under the floor', () => {
  // sitting on the floor with the legs extended is 90 degrees of hip flexion and the heels
  // level with the pelvis. Heels well below it means the figure is on a chair that is not there.
  for (const r of ALL) {
    if (!['seated', 'crossLegged'].includes(r.position)) continue;
    const p = place(r.pose);
    const lowest = Math.min(p.footR, p.footL);
    // 0.28 rather than something tighter because the shins cannot cross: the legs are
    // separate chains that cannot pass through each other, so a folded sit leaves the ankles
    // lower than a floor would. library/limits.js CROSS_LEGS states that on the entries.
    assert.ok(lowest > p.hip - 0.28,
      `${r.key}: seated on the floor, but the lowest contact hangs ${(p.hip - lowest).toFixed(2)} below the pelvis`);
  }
});

test('a balance stands on one foot and lifts the other', () => {
  for (const r of ALL) {
    if (r.position !== 'balance') continue;
    const p = place(r.pose);
    const lo = Math.min(p.footR, p.footL) - p.hip, hi = Math.max(p.footR, p.footL) - p.hip;
    assert.ok(lo < -0.30, `${r.key}: the standing foot is only ${lo.toFixed(2)} below the pelvis`);
    assert.ok(hi - lo > 0.18, `${r.key}: both feet are on the floor`);
  }
});

test('a squat keeps the feet on the floor with the hips low', () => {
  for (const r of ALL) {
    if (r.position !== 'squat') continue;
    const p = place(r.pose);
    assert.ok(p.head - p.hip > 0.10, `${r.key}: the head is not above the hips`);
    assert.ok(Math.min(p.footR, p.footL) - p.hip < -0.10, `${r.key}: the feet are not below the hips`);
  }
});

test('an inverted pose actually puts the hips above the head', () => {
  for (const r of ALL) {
    if (r.position !== 'inverted') continue;
    const p = place(r.pose);
    assert.ok(p.hip > p.head + 0.15,
      `${r.key}: inverted, but the hip is only ${(p.hip - p.head).toFixed(2)} above the head`);
  }
});

test('a hand-supported pose reaches down to the floor with its arms', () => {
  // The failure this exists for: a blanket edit put the arms overhead in every plank, and
  // "hands level with the feet" still passed — with the body horizontal, an arm reaching
  // straight overhead also lands level with the feet. What cannot be faked is the arm
  // pointing *down*: the shoulder has to sit above whatever the arm rests on.
  const SUPPORTED = ['plank', 'plankSupine', 'quadruped', 'pike', 'armBalance'];
  for (const r of ALL) {
    if (!SUPPORTED.includes(r.position)) continue;
    place(r.pose);
    const shoulder = Math.max(heightOf('humerus_r'), heightOf('humerus_l'));
    // the arm's contact is the hand, or the forearm where the pose rests on the elbows
    const armLow = Math.min(heightOf('hand_r'), heightOf('hand_l'),
                            heightOf('ulna_r'), heightOf('ulna_l'));
    assert.ok(shoulder - armLow > 0.10,
      `${r.key}: the arms do not reach down to the floor — shoulder ${shoulder.toFixed(2)}, ` +
      `lowest arm ${armLow.toFixed(2)}`);
  }
});

test('a plank holds a straight line rather than piking', () => {
  for (const r of ALL) {
    if (!['plank', 'plankSupine'].includes(r.position)) continue;
    const p = place(r.pose);
    const trunk = heightOf('T1') - p.hip;
    assert.ok(Math.abs(trunk) < 0.14,
      `${r.key}: the top of the thoracic spine sits ${trunk.toFixed(2)} from the pelvis`);
  }
});

test('a pike puts the hips at the apex and a balance gets the feet off the floor', () => {
  for (const r of ALL) {
    const p = place(r.pose);
    const foot = Math.min(p.footR, p.footL);
    const armLow = Math.min(heightOf('hand_r'), heightOf('hand_l'),
                            heightOf('ulna_r'), heightOf('ulna_l')) - p.hip;
    if (r.position === 'pike') {
      assert.ok(Math.abs((foot - p.hip) - armLow) < 0.25,
        `${r.key}: hands and feet are not on the same floor`);
      assert.ok(p.head - p.hip < -0.05, `${r.key}: the head is not below the hips`);
    }
    if (r.position === 'armBalance')
      assert.ok((foot - p.hip) - armLow > 0.10,
        `${r.key}: the feet are not clear of the hands`);
  }
});

test('every weight-bearing contact sits on one floor', () => {
  /* The rule the older tests were missing. They asked whether the LOWEST contact was low
   * enough, which Warrior II satisfied while standing with its front foot fifteen
   * centimetres in the air — every angle inside its published range, the position class
   * correct, and the shape a sagittal lunge instead of a wide frontal one. Fifteen poses
   * were wrong the same way.
   *
   * What carries weight is `contacts` on the record, or the default for its position class.
   * The tolerances are two, because this measures joint centres and a wrist does not sit at
   * the same height above a floor as an ankle: two of the same kind have to agree closely,
   * and a hand and a foot are allowed the few centimetres between their centres. */
  const height = {
    foot_r: p => p.footR, foot_l: p => p.footL,
    knee_r: () => heightOf('tibia_r'), knee_l: () => heightOf('tibia_l'),
    hand_r: () => heightOf('hand_r'), hand_l: () => heightOf('hand_l'),
    forearm_r: () => Math.min(heightOf('hand_r'), heightOf('ulna_r')),
    forearm_l: () => Math.min(heightOf('hand_l'), heightOf('ulna_l')),
    head: p => p.head,
  };
  let checked = 0;
  for (const r of ALL) {
    const contacts = r.contacts ?? DEFAULT_CONTACTS[r.position];
    if (!contacts || contacts.length < 2) continue;
    const p = posed(r);
    const h = contacts.map(n => height[n](p));
    const show = contacts.map((n, i) => `${n} ${h[i].toFixed(2)}`).join(', ');
    assert.ok(Math.max(...h) - Math.min(...h) <= 0.08,
      `${r.key}: its contacts are ${(Math.max(...h) - Math.min(...h)).toFixed(2)} apart ` +
      `in height (${show})`);
    /* And nothing sinks through the floor those contacts define. The whole headstand family
     * had `arm_flex` written negative, which points the arm behind the body — inverted, at
     * the ceiling — so the handstand rested on its skull with its hands in the air. */
    if (!contacts.includes('head'))
      assert.ok(p.head >= Math.min(...h) - 0.04,
        `${r.key}: the head is ${(Math.min(...h) - p.head).toFixed(2)} below the floor (${show})`);
    for (let i = 0; i < contacts.length; i++)
      for (let k = i + 1; k < contacts.length; k++)
        if (contacts[i].slice(0, -2) === contacts[k].slice(0, -2))
          assert.ok(Math.abs(h[i] - h[k]) <= 0.05,
            `${r.key}: its two ${contacts[i].slice(0, -2)}s are ` +
            `${Math.abs(h[i] - h[k]).toFixed(2)} apart (${show})`);
    /* And no other part of the figure is under that floor. The head rule above is this rule
     * for one landmark, and the rest of the body was sinking through the mat unnoticed:
     * child's pose sat its heels 44 cm under the floor its knees defined, and every quadruped
     * pose pointed its toes straight down through it because a zero `ankle_angle` holds the
     * foot perpendicular to the shin. The tolerance is what a joint centre buys — a toe
     * centre really does sit a couple of centimetres below a knee centre on the same mat.
     *
     * The only way out is a limitation note marked `belowFloor`, which says in both languages
     * which range the model is short of: the split whose back leg the hip cannot lower, the
     * cross-legged sit whose shins cannot pass through each other, the pigeon whose front hip
     * cannot turn out far enough to lay the shin down. */
    if (!r.limitation?.belowFloor) {
      const lo = Math.min(...h);
      let worst = 0, who = '';
      for (const n of LANDMARKS) { const d = lo - heightOf(n); if (d > worst) { worst = d; who = n; } }
      assert.ok(worst <= 0.05,
        `${r.key}: ${who} is ${worst.toFixed(2)} below the floor its contacts define (${show})`);
    }
    checked++;
  }
  // the standing, kneeling and hand-supported half of the repertoire; the lying and seated
  // poses rest on a surface rather than on discrete contacts and have no set
  assert.ok(checked >= 50, `only ${checked} poses have a contact set to check`);
});

test('a kneeling fold folds', () => {
  /* Child's pose is a kneel with its head *down*, which is the opposite of what the kneeling
   * class score wants, and being scored as an upright kneel is how it came to be drawn as a
   * curl in mid-air with its heels forty-four centimetres under the mat and its forehead
   * above its hips. The class exists so the solver and the checker want the right thing. */
  const folds = ALL.filter(r => r.position === 'kneelingFold');
  assert.ok(folds.length, 'no record uses the kneelingFold class');
  for (const r of folds) {
    const p = posed(r);
    assert.ok(p.belly.y < 0.3, `${r.key}: a kneeling fold faces down (${p.belly.y.toFixed(2)})`);
    assert.ok(p.head - p.hip < -0.05,
      `${r.key}: head ${(p.head - p.hip).toFixed(2)} above the pelvis — an upright kneel, not a fold`);
    assert.ok(Math.min(p.footR, p.footL) - p.hip > -0.25,
      `${r.key}: the hips are not sitting back on the heels`);
  }
});

test('only a limitation that says so may sink through the floor', () => {
  /* `belowFloor` is the one escape from the floor rule above, so it has to stay attached to a
   * note that explains itself: a marker on a limitation whose text is about something else
   * would silently exempt a pose that is simply wrong. */
  const marked = ALL.filter(r => r.limitation?.belowFloor);
  assert.ok(marked.length, 'nothing carries a belowFloor limitation — has the marker moved?');
  for (const r of marked)
    for (const lang of LANGS)
      assert.ok(r.limitation[lang]?.length > 60,
        `${r.key}: a belowFloor limitation with no explanation in ${lang}`);
});

test('no shared constant overrides a value the record states', () => {
  /* The failure this exists for: `pose: { pelvis_tilt: -67, ...QUAD }` is not a pelvis_tilt
   * of -67. A spread overrides whatever came before it, so QUAD's own tilt won — the record
   * said one number while the rig used another, and `poses:solve --write` rewrote the visible
   * number on every run without ever changing the pose. Four side-lying barrel poses lost
   * their solved `pelvis_list` the same way and were drawn on the wrong side.
   *
   * This reads the source rather than the imported records, because by the time the object
   * exists the losing value is gone and there is nothing left to compare. */
  const CONST = /^const ([A-Z_]+) = \{([^;]*?)\};/gm;
  const OBJ = /\b(pose|entry): \{([^}]*)\}/g;
  const TOKEN = /\.\.\.([A-Z_]+)|([a-z_][a-z0-9_]*):/g;
  for (const file of ['pilates.js', 'yoga.js']) {
    const src = readFileSync(new URL(`../src/content/library/${file}`, import.meta.url), 'utf8');
    const consts = {};
    for (const m of src.matchAll(CONST))
      consts[m[1]] = [...m[2].matchAll(/([a-z_][a-z0-9_]*):/g)].map(x => x[1]);
    for (const m of src.matchAll(OBJ)) {
      const written = [];
      for (const t of m[2].matchAll(TOKEN)) {
        if (t[2]) { written.push(t[2]); continue; }
        const lost = written.filter(k => (consts[t[1]] ?? []).includes(k));
        assert.deepEqual(lost, [],
          `${file}: in a ${m[1]}, ...${t[1]} overrides ${lost.join(', ')} written before it — ` +
          `the record states a value the rig never uses`);
      }
    }
  }
});

/* Which coordinates each action claims, and in which direction. A record that names an action
 * its pose never performs is an unexplained detail: the panel says the exercise abducts the
 * hip and the picture adducts it, and a reader has no way to tell which is true. */
const CLAIMS = {
  'trunk-flexion':        [/^(lumbar|thoracic|cervical)_flex$/, +1],
  'trunk-extension':      [/^(lumbar|thoracic|cervical)_flex$/, -1],
  'trunk-rotation':       [/^(lumbar|thoracic|cervical)_rot$/, 0],
  'trunk-lateral':        [/^(lumbar|thoracic|cervical)_bend$/, 0],
  'segmental-articulation': [/_wave$/, 0],
  'forward-fold':         [/^(lumbar|thoracic)_flex$|^hip_flexion_/, +1],
  'hip-flexion':          [/^hip_flexion_/, +1],
  'hip-extension':        [/^hip_flexion_/, -1],
  'hip-abduction':        [/^hip_adduction_/, -1],
  'hip-adduction':        [/^hip_adduction_/, +1],
  'hip-rotation':         [/^hip_rotation_/, 0],
  'hip-external-rotation': [/^hip_rotation_/, 0],
  'knee-flexion':         [/^knee_angle_/, +1],
  'knee-extension':       [/^knee_angle_/, 'zero'],
  'ankle-plantarflexion': [/^ankle_angle_/, -1],
  'ankle-dorsiflexion':   [/^ankle_angle_/, +1],
  'shoulder-flexion':     [/^arm_flex_/, +1],
  'shoulder-extension':   [/^arm_flex_/, -1],
  'shoulder-abduction':   [/^arm_add_/, -1],
  'shoulder-adduction':   [/^arm_add_/, +1],
  'shoulder-external-rotation': [/^arm_rot_/, 0],
  'elbow-flexion':        [/^elbow_flex_/, +1],
  'elbow-extension':      [/^elbow_flex_/, -1],
  'chest-expansion':      [/^(thoracic_flex|arm_add_)/, 0],
  'lateral-reach':        [/^(arm_flex_|arm_add_|thoracic_bend)/, 0],
};
/* Effort, contact and attention rather than a joint angle. These cannot be checked against a
 * pose and naming one is not an unexplained detail. */
const NOT_A_JOINT = new Set(['balance', 'isometric-hold', 'weight-bearing-arms', 'inversion',
  'breath-focus', 'scapular-stability', 'ankle-stability']);

test('every action a record names is one its pose performs', () => {
  /* The failure this exists for is the one a reader meets rather than a test: a panel listing
   * an action the picture does not do. Fifty-five records named one. Some were the wrong word
   * for the right movement — skandasana said hip adduction for a side lunge that abducts both
   * hips, marichyasana said shoulder abduction for a bind that draws the arm across the body.
   * Some were the right word for a pose that had never been given the movement — the Toe
   * Balance stood with its ankles dorsiflexed, which is standing on the heels, while naming
   * plantarflexion. And some were simply extra: Rolling Like a Ball and the Seal claimed
   * segmental articulation, and both are exercises about *not* articulating — the spine holds
   * one C-curve and the body rolls on it.
   *
   * An exercise performs an action if it moves through it, holds it at the pose, or holds it
   * at the entry. All three, because a clip has two ends and Cat-Cow names what it does at
   * each of them. */
  const MOVED = 12;   // degrees; below this a coordinate is noise or a placement detail
  const WAVE = 0.3;   // a wave is a position along a sweep, where 1.0 peels a whole region
  const bad = [];
  for (const r of ALL) {
    // a salutation's clip travels between two of its positions, so it names actions that
    // belong to the postures it does not stop at
    if (r.limitation?.sequence) continue;
    const from = r.entry ?? {};
    const moved = [];
    for (const k of new Set([...Object.keys(r.pose), ...Object.keys(from)])) {
      if (/^pelvis_(tilt|list|rotation|t[xyz])$/.test(k)) continue;
      const scale = /_wave$/.test(k) ? WAVE : MOVED;
      for (const value of [(r.pose[k] ?? 0) - (from[k] ?? 0), r.pose[k] ?? 0, from[k] ?? 0])
        if (Math.abs(value) >= scale) moved.push([k, value]);
    }
    for (const a of r.actions ?? []) {
      if (NOT_A_JOINT.has(a)) continue;
      const claim = CLAIMS[a];
      assert.ok(claim, `${r.key}: no rule for the action "${a}" — add one to CLAIMS`);
      const [re, sign] = claim;
      const hit = sign === 'zero'
        // a knee is extended when its angle is near nothing; it has no negative half
        ? Object.keys({ ...from, ...r.pose }).some(k => re.test(k) && Math.abs(r.pose[k] ?? 0) < 15)
        : moved.some(([k, v]) => re.test(k) && (sign === 0 || Math.sign(v) === sign));
      if (!hit) bad.push(`${r.key} names "${a}" and never performs it`);
    }
  }
  assert.deepEqual(bad, []);
});

test('a hand that carries weight is flat on the floor', () => {
  /* The arm has seven degrees of freedom here and the library drove four. `arm_rot` appeared
   * in two records out of two hundred, `pro_sup` — the forearm turning the palm over — in
   * none, `wrist_dev` in none, `wrist_flex` in sixteen. So the hand continued the line of the
   * forearm wherever the elbow happened to point, and on a hand carrying weight that is the
   * difference between a palm and an edge: the handstand balanced on the side of its hand,
   * and eleven of fifty-seven weight-bearing hands had their fingertips within three
   * centimetres of the floor.
   *
   * Flat needs no palm normal and no sign convention. A hand is flat on the floor when its
   * wrist, both sides of its knuckles and its fingertips are all at the floor — four points
   * at one height is what flat means. `tools/hands.mjs` solves it; this holds it. */
  const HAND = { tip: 'distal phalanx of middle finger', thumb: 'first metacarpal bone',
                 pinky: 'fifth metacarpal bone' };
  const rest = (name, side) => {
    const st = generated.structures.find(x => x.name === name);
    const c = st?.perSide?.[side] ?? st?.centroid;
    return c ? new THREE.Vector3(...c) : null;
  };
  let checked = 0;
  for (const r of ALL) {
    const contacts = r.contacts ?? DEFAULT_CONTACTS[r.position];
    if (!contacts?.some(n => /^hand_/.test(n))) continue;
    // a forearm plank rests on the ulna, and its hand is not the thing carrying the load
    if (contacts.some(n => /^forearm_/.test(n))) continue;
    const p = place(r.pose);
    const at = {
      foot_r: () => p.footR, foot_l: () => p.footL,
      knee_r: () => heightOf('tibia_r'), knee_l: () => heightOf('tibia_l'),
      hand_r: () => heightOf('hand_r'), hand_l: () => heightOf('hand_l'),
      forearm_r: () => Math.min(heightOf('hand_r'), heightOf('ulna_r')),
      forearm_l: () => Math.min(heightOf('hand_l'), heightOf('ulna_l')),
      head: () => p.head,
    };
    const floor = Math.min(...contacts.map(n => at[n]?.() ?? Infinity));
    for (const side of ['r', 'l']) {
      if (!contacts.includes(`hand_${side}`)) continue;
      const S = side.toUpperCase();
      const m = new THREE.Matrix4().multiplyMatrices(
        live.nodes.get(`hand_${side}`).body.matrixWorld, live.bind.get(`hand_${side}`));
      const ys = [heightOf(`hand_${side}`)];
      for (const n of Object.values(HAND)) {
        const p = rest(n, S);
        assert.ok(p, `no rest position for "${n}" on the ${S} side`);
        ys.push(p.clone().applyMatrix4(m).y);
      }
      const mean = ys.reduce((a, b) => a + b, 0) / ys.length;
      const spread = Math.sqrt(ys.reduce((a, y) => a + (y - mean) ** 2, 0) / ys.length);
      /* 2.5 cm across four points. The solved library sits under 1.2 cm everywhere except
       * the side plank, whose supporting arm is abducted 130 degrees and reaches 2.1; the
       * failures this is for were 3 to 5 cm, which is a hand resting on its edge. */
      assert.ok(spread < 0.025,
        `${r.key}: the ${side} hand is ${(spread * 100).toFixed(1)} cm from flat — it is ` +
        `carrying weight on an edge rather than on the palm`);
      assert.ok(Math.abs(mean - floor) < 0.05,
        `${r.key}: the ${side} palm sits ${((mean - floor) * 100).toFixed(1)} cm from the floor`);
      checked++;
    }
  }
  assert.ok(checked >= 30, `only ${checked} weight-bearing hands to check`);
});

test('a record only ever names contacts the vocabulary defines', () => {
  for (const r of ALL)
    for (const c of r.contacts ?? [])
      assert.ok(CONTACT[c], `${r.key} carries weight through "${c}", which is not a contact`);
  for (const [position, list] of Object.entries(DEFAULT_CONTACTS)) {
    assert.ok(POSITION[position], `DEFAULT_CONTACTS names "${position}", which is not a position`);
    for (const c of list) assert.ok(CONTACT[c], `${position} defaults to "${c}"`);
  }
});

test('a pose does not inherit the pose before it', () => {
  /* The failure: `setAll` wrote only the coordinates it was given, so anything the new pose
   * did not mention kept the previous pose's value. Selecting the Hundred (`pelvis_tilt: 90`,
   * supine) and then Warrior II — which never names `pelvis_tilt` — drew Warrior II lying on
   * its back. Every angle legal, every test green, and the wrong exercise on screen. The
   * tools that draw the poses all called `reset()` first, which is exactly why the stick
   * figure sheet was right while the app was wrong. */
  const supine = ALL.find(r => r.key === 'hundredPrep') ?? ALL.find(r => r.position === 'supine');
  const standing = ALL.find(r => r.key === 'virabhadrasana2');
  const alone = place(standing.pose);
  place(supine.pose);
  const after = place(standing.pose);
  assert.ok(Math.abs(after.head - alone.head) < 1e-9 && Math.abs(after.footR - alone.footR) < 1e-9,
    `${standing.key} came out differently after ${supine.key}: ` +
    `head ${alone.head.toFixed(3)} -> ${after.head.toFixed(3)}`);
  assert.ok(after.head - after.hip > 0.25, `${standing.key} is not standing up`);
});

test('a hand does not press through the mat', () => {
  /* `arm_flex` is negative for shoulder *extension* — the arm behind the body — which on a
   * supine figure points it straight down into the floor. The Jackknife, the Corkscrew and
   * Control Balance all pressed their hands eighteen centimetres under the mat, and the
   * contact rules said nothing because a lying pose rests on a surface rather than on
   * discrete contacts. The tolerance is half a body depth at the chest, and half a body
   * width for a pose lying on its side, because these are joint centres. */
  const DEPTH = { supine: 0.10, prone: 0.10, supported: 0.10, reformer: 0.10, sidelying: 0.14 };
  for (const r of ALL) {
    const allow = DEPTH[r.position];
    if (allow == null) continue;
    const p = posed(r);
    const hand = Math.min(p.handR, p.handL);
    assert.ok(hand >= p.mat - allow,
      `${r.key}: a hand is ${(p.mat - hand).toFixed(2)} below the trunk — through the mat`);
  }
});

test('a pose that moves an arm says so', () => {
  /* The picture must not do things the prose never accounts for. The Spine Twist holds the
   * arms out at shoulder height for the whole exercise and its actions said only
   * "trunk-rotation", so a reader saw a shape with no explanation for half of it — twenty-one
   * records were like that. An action is what the cues, the faults and the plain-language
   * summary are all composed from, so leaving one out is leaving the reader without it. */
  const SHOULDER = /shoulder|arm|reach|plank|balance|press|pull|push|support|isometric|scapular/;
  const bad = [];
  for (const r of ALL) {
    const worst = k => [r.pose[`${k}_r`], r.pose[`${k}_l`]].filter(v => v != null)
      .reduce((a, v) => Math.max(a, Math.abs(v)), 0);
    if (Math.max(worst('arm_add'), worst('arm_flex')) < 45) continue;
    if (!r.actions.some(a => SHOULDER.test(a))) bad.push(r.key);
  }
  assert.deepEqual(bad, [],
    `these move an arm more than 45 degrees and name no action for it: ${bad.join(', ')}`);
});

test('a low lunge is low, and faces down', () => {
  // the one lunge whose head is not up: the chest comes down over the front leg onto the
  // hands or the forearms, and what keeps it from being a plank is the folded front knee
  for (const r of ALL) {
    if (r.position !== 'lowLunge') continue;
    const p = posed(r);
    assert.ok(p.belly.y <= 0.3, `${r.key}: a low lunge faces down`);
    assert.ok(p.head - p.hip <= 0.14, `${r.key}: head ${(p.head - p.hip).toFixed(2)} — upright`);
    assert.ok(Math.min(p.footR, p.footL) - p.hip < -0.12,
      `${r.key}: the hips are not above the floor`);
  }
});

test('a hand-supported pose rests on its hands and feet together', () => {
  // plank, dog and the arm balances all carry weight through both ends. If the hands and
  // the feet are at wildly different heights the figure is not in the shape at all.
  for (const r of ALL) {
    if (!['plank', 'plankSupine', 'quadruped', 'pike'].includes(r.position)) continue;
    const p = posed(r);
    const floor = r.position === 'quadruped'
      ? Math.min(heightOf('tibia_r'), heightOf('tibia_l')) : Math.min(p.footR, p.footL);
    assert.ok(Math.abs(floor - p.handR) < 0.45,
      `${r.key}: hands at ${p.handR.toFixed(2)} and the other contact at ${floor.toFixed(2)} ` +
      `are not on the same floor`);
    // a pike's pelvis is vertical at the apex, so it has no meaningful facing to check
    const wantUp = r.position === 'plankSupine';
    if (r.position !== 'pike' && Math.abs(p.belly.y) > 0.3)
      assert.equal(p.belly.y > 0, wantUp,
        `${r.key} faces ${p.belly.y > 0 ? 'up' : 'down'} but is a ${r.position}`);
  }
});

test('the spine flexes the way the coordinate is named', () => {
  // `lumbar_flex` positive has to be flexion, matching the hip, whose convention the rest of
  // the rig follows. With the axis written the other way every chest lift extended the neck
  // and every backbend folded forward, all inside the published range.
  const headAt = pose => { place(pose); return { z: heightZ('skull'), y: heightOf('skull') }; };
  const flexed = headAt({ lumbar_flex: 25, thoracic_flex: 25, cervical_flex: 25 });
  const extended = headAt({ lumbar_flex: -25, thoracic_flex: -25, cervical_flex: -25 });
  assert.ok(flexed.z > extended.z + 0.2,
    'positive spine flexion should send the head anterior, not posterior');
  // and the hip agrees: standing, hip flexion sends the thigh the same way
  place({ hip_flexion_r: 60 });
  assert.ok(heightZ('toes_r') > 0.1, 'hip flexion should send the thigh anterior');
});

test('the knee bends the shank without moving the knee itself', () => {
  // Rajagopal couples two translations to knee_angle through cubic splines whose whole range
  // is about seven millimetres. Treating the radian value as the translation instead threw
  // the tibia more than a body height forward at 90 degrees, and every squat, kneel and tuck
  // in the library came apart. This is the test that would have caught it.
  const knee = a => {
    live.reset();
    live.setAll({ knee_angle_r: a * D });
    live.root.updateMatrixWorld(true);
    const rec = live.nodes.get('tibia_r');
    return new THREE.Vector3().setFromMatrixPosition(rec.body.matrixWorld);
  };
  const straight = knee(0);
  for (const a of [30, 60, 90, 120]) {
    const bent = knee(a);
    assert.ok(straight.distanceTo(bent) < 0.02,
      `knee at ${a}° moved the knee joint itself by ${(straight.distanceTo(bent) * 1655).toFixed(0)} mm`);
  }
  // and the heel has to actually travel: a knee that does not move the shank is not a knee
  live.reset(); live.setAll({});
  live.root.updateMatrixWorld(true);
  const heel0 = new THREE.Vector3().setFromMatrixPosition(live.nodes.get('calcn_r').body.matrixWorld);
  live.reset(); live.setAll({ knee_angle_r: 120 * D });
  live.root.updateMatrixWorld(true);
  const heel1 = new THREE.Vector3().setFromMatrixPosition(live.nodes.get('calcn_r').body.matrixWorld);
  assert.ok(heel1.y - heel0.y > 0.2, 'a fully bent knee should raise the heel toward the seat');
});

/* --------------------------------------------------------------- what shipped */

test('the whole library reached EXERCISE without displacing a hand-written entry', () => {
  assert.ok(EXERCISE_KEYS.length >= 190, `only ${EXERCISE_KEYS.length} exercises shipped`);
  for (const r of ALL) assert.ok(EXERCISE[r.key], `${r.key} did not reach EXERCISE`);
  // `hundred` is written out longhand; composing must not have replaced it
  assert.ok(!COMPOSED.hundred, 'a composed entry overwrote the hand-written Hundred');
  assert.ok(EXERCISE.hundred.en.summary.includes('classic Pilates warm-up'),
    'the hand-written Hundred was replaced');
});

test('every discipline in the library has a bilingual label', () => {
  for (const k of EXERCISE_KEYS)
    for (const lang of LANGS)
      assert.ok(DISCIPLINES[EXERCISE[k].discipline]?.[lang],
        `${k}: discipline ${EXERCISE[k].discipline} has no ${lang} label`);
});

test('the instructor of record signed off both of their disciplines', () => {
  assert.equal(REVIEWER.by, 'Dr. Hong Jong Gi');
  assert.ok(REVIEWED_DISCIPLINES.has('pilates') && REVIEWED_DISCIPLINES.has('yoga'));
  for (const k of EXERCISE_KEYS) {
    const e = EXERCISE[k];
    if (REVIEWED_DISCIPLINES.has(e.discipline))
      assert.ok(e.reviewed?.by === REVIEWER.by, `${k} is ${e.discipline} and needs the sign-off`);
    else
      assert.equal(e.reviewed, false, `${k} is outside the reviewer's remit and must say so`);
  }
});

test('every composed entry got a clip', () => {
  for (const r of ALL) assert.ok(MOTION[r.key], `${r.key} has no movement clip`);
});

test('every vocabulary entry is bilingual', () => {
  const tables = { POSITION, ACTION, BREATH_PATTERN, CONTRA, FAMILY, PROP, CUE };
  for (const [name, table] of Object.entries(tables))
    for (const [key, v] of Object.entries(table))
      for (const lang of LANGS)
        assert.ok(v[lang], `${name}.${key} is missing ${lang}`);
  for (const [key, f] of Object.entries(FAULT)) {
    assert.ok(ACTION[f.action], `FAULT.${key} names action "${f.action}", which does not exist`);
    for (const lang of LANGS)
      assert.ok(f[lang]?.length === 2, `FAULT.${key}: ${lang} needs a headline and a fix`);
  }
  for (const key of Object.keys(CUE))
    assert.ok(ACTION[key], `CUE.${key} is not an action`);
});
