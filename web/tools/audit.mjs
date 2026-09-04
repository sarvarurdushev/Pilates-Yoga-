/**
 * Does the figure end up in the shape the record claims?
 *
 * A pose can sit inside every published joint range and still be the wrong exercise, and no
 * assertion about coordinates catches that. This runs the real Rig and reports, per position
 * class, the handful of numbers that say whether the body is oriented and supported the way
 * the class implies — which way the pelvis faces, what is lowest, how far the head is from
 * the floor. Everything is relative to the pelvis, because there is no floor in this scene.
 *
 * Usage: node tools/audit.mjs [positionRegex]
 */
import { readFileSync } from 'node:fs';
import * as THREE from '../vendor/three.module.js';
import { Rig } from '../src/rig.js';
import { YOGA } from '../src/content/library/yoga.js';
import { PILATES } from '../src/content/library/pilates.js';
import { sample, MOTION } from '../src/content/motion.js';

const rigJson = JSON.parse(readFileSync(new URL('../src/generated/rig.json', import.meta.url), 'utf8'));
const rig = new Rig(rigJson);
rig.captureBindPose();
const P = n => { const r = rig.nodes.get(n); return r ? new THREE.Vector3().setFromMatrixPosition(r.body.matrixWorld) : null; };

/** Which way the front of the pelvis points, in world axes. The definition of lying down. */
function belly() {
  const m = rig.nodes.get('pelvis').body.matrixWorld;
  // the rig's segment frames are OpenSim's: +X anterior, +Y superior
  return new THREE.Vector3(1, 0, 0).transformDirection(m);
}

export function measure(key) {
  const s = sample(key, 0.5);
  rig.reset(); rig.setAll(s.coordinates); rig.root.updateMatrixWorld(true);
  const hip = P('pelvis');
  const low = side => Math.min(P(`toes_${side}`).y, P(`tibia_${side}`).y);
  const b = belly();
  return {
    bellyY: +b.y.toFixed(2),                  // +1 face up, -1 face down, 0 upright or on a side
    bellyX: +b.x.toFixed(2),                  // ±1 means lying on a side
    head: +(P('skull').y - hip.y).toFixed(2),
    foot: +(Math.min(low('r'), low('l')) - hip.y).toFixed(2),
    footHi: +(Math.max(low('r'), low('l')) - hip.y).toFixed(2),
    hand: +(Math.min(P('hand_r').y, P('hand_l').y) - hip.y).toFixed(2),
    handHi: +(Math.max(P('hand_r').y, P('hand_l').y) - hip.y).toFixed(2),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const filter = process.argv[2] ? new RegExp(process.argv[2]) : null;
  const byPos = {};
  for (const r of [...PILATES, ...YOGA]) {
    if (!MOTION[r.key] || (filter && !filter.test(r.position))) continue;
    (byPos[r.position] ??= []).push({ key: r.key, ...measure(r.key) });
  }
  for (const [pos, list] of Object.entries(byPos)) {
    console.log(`\n== ${pos} (${list.length})  belly +1=up -1=down | head/foot/hand relative to the pelvis`);
    list.sort((a, b) => a.head - b.head);
    for (const x of list)
      console.log(`   ${x.key.padEnd(28)} belly ${String(x.bellyY).padStart(5)}/${String(x.bellyX).padStart(5)}` +
        `  head ${String(x.head).padStart(6)}  foot ${String(x.foot).padStart(6)}..${String(x.footHi).padStart(6)}` +
        `  hand ${String(x.hand).padStart(6)}..${String(x.handHi).padStart(6)}`);
  }
}
