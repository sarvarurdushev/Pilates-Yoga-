/**
 * Draws every exercise in the library as a stick figure, from the front and from the side,
 * on one page.
 *
 * The point is to be able to *look*. A pose can sit inside every published joint range and
 * still not be the exercise — `hip_flexion: 100` on a standing figure is a double leg raise,
 * not a forward fold — and no assertion about coordinates catches that. The geometry tests
 * in test/library.test.mjs encode the errors we already know how to describe; this catches
 * the ones we do not, by putting them in front of a person.
 *
 * It runs the real Rig against the real rig.json, so what it draws is what the app draws.
 * No GPU, no browser: joint world positions straight out of forward kinematics, projected
 * orthographically and written as SVG.
 *
 * Usage: node tools/posesheet.mjs [out.html] [filter]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import * as THREE from '../vendor/three.module.js';
import { Rig } from '../src/rig.js';
import { YOGA } from '../src/content/library/yoga.js';
import { PILATES } from '../src/content/library/pilates.js';
import { EXERCISE } from '../src/content/exercises.js';
import { MOTION, sample } from '../src/content/motion.js';

const OUT = process.argv[2] || '.render/poses.html';
const FILTER = process.argv[3] ? new RegExp(process.argv[3], 'i') : null;

const rigJson = JSON.parse(readFileSync(new URL('../src/generated/rig.json', import.meta.url), 'utf8'));
const rig = new Rig(rigJson);
rig.captureBindPose();

/** The bones worth drawing: a skeleton reads as a body, 47 segments reads as a hairball. */
const CHAIN = [
  ['pelvis', 'L5'], ['L5', 'L3'], ['L3', 'L1'], ['L1', 'T10'], ['T10', 'T6'], ['T6', 'T1'],
  ['T1', 'C5'], ['C5', 'C1'], ['C1', 'skull'],
  ['pelvis', 'femur_r'], ['femur_r', 'tibia_r'], ['tibia_r', 'talus_r'], ['talus_r', 'toes_r'],
  ['pelvis', 'femur_l'], ['femur_l', 'tibia_l'], ['tibia_l', 'talus_l'], ['talus_l', 'toes_l'],
  ['T1', 'humerus_r'], ['humerus_r', 'ulna_r'], ['ulna_r', 'hand_r'],
  ['T1', 'humerus_l'], ['humerus_l', 'ulna_l'], ['ulna_l', 'hand_l'],
];
const LIMB = new Set(['femur_r', 'tibia_r', 'talus_r', 'toes_r', 'humerus_r', 'ulna_r', 'hand_r']);

const v = new THREE.Vector3();
const P = name => {
  const rec = rig.nodes.get(name);
  if (!rec) return null;
  return v.setFromMatrixPosition(rec.body.matrixWorld).clone();
};

const D = Math.PI / 180;
const TRANSLATIONS = new Set(['pelvis_tx', 'pelvis_ty', 'pelvis_tz']);
function place(pose) {
  rig.reset();
  const vals = {};
  for (const [k, x] of Object.entries(pose))
    vals[k] = (TRANSLATIONS.has(k) || /_wave$/.test(k)) ? x : x * D;
  rig.setAll(vals);
  rig.root.updateMatrixWorld(true);
}

/* ------------------------------------------------------------------------- drawing */
const W = 190, H = 240, PAD = 12;

/** Orthographic projection, scaled so the whole figure fits whatever shape it is in. */
function draw(project) {
  const pts = new Map();
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  for (const [a, b] of CHAIN)
    for (const n of [a, b]) {
      if (pts.has(n)) continue;
      const p = P(n);
      if (!p) continue;
      const q = project(p);
      pts.set(n, q);
      minX = Math.min(minX, q.x); maxX = Math.max(maxX, q.x);
      minY = Math.min(minY, q.y); maxY = Math.max(maxY, q.y);
    }
  // one scale for every cell, so a pose that is genuinely small looks small
  const S = (H - 2 * PAD) / 1.22;
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const to = q => [(W / 2 + (q.x - cx) * S).toFixed(1), (H / 2 - (q.y - cy) * S).toFixed(1)];

  const lines = [];
  for (const [a, b] of CHAIN) {
    const pa = pts.get(a), pb = pts.get(b);
    if (!pa || !pb) continue;
    const [x1, y1] = to(pa), [x2, y2] = to(pb);
    const cls = LIMB.has(b) ? 'r' : 'c';
    lines.push(`<line class="${cls}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`);
  }
  const head = pts.get('skull');
  if (head) { const [x, y] = to(head); lines.push(`<circle cx="${x}" cy="${y}" r="9"/>`); }
  // the contact points, so it is obvious what is meant to be on the floor
  for (const n of ['hand_r', 'hand_l', 'toes_r', 'toes_l']) {
    const p = pts.get(n);
    if (!p) continue;
    const [x, y] = to(p);
    lines.push(`<circle class="t" cx="${x}" cy="${y}" r="3.4"/>`);
  }
  // a ground line at the lowest point, which is the fastest way to see a pose floating
  const floorY = to({ x: cx, y: minY })[1];
  lines.push(`<line class="g" x1="4" y1="${floorY}" x2="${W - 4}" y2="${floorY}"/>`);
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${lines.join('')}</svg>`;
}

const front = p => ({ x: p.x, y: p.y });   // +X is left, so the figure faces us
const side  = p => ({ x: -p.z, y: p.y });  // +Z is anterior, so the figure faces right

/* --------------------------------------------------------------------------- page */
const records = [...PILATES, ...YOGA].filter(r => !FILTER || FILTER.test(r.key) ||
  FILTER.test(r.family) || FILTER.test(r.position));

const cells = [];
for (const r of records) {
  const e = EXERCISE[r.key];
  const clip = MOTION[r.key];
  // the shape the exercise is named for: the middle key of its own clip
  const s = clip ? sample(r.key, clip.keys.length === 4 ? 0.5 : 0.5) : null;
  rig.reset();
  if (s) { rig.setAll(s.coordinates); rig.root.updateMatrixWorld(true); }
  else place(r.pose);
  const f = draw(front), sd = draw(side);
  cells.push(`<figure data-key="${r.key}" data-pos="${r.position}" data-fam="${r.family}">
    <div class="pair"><div class="v"><i>front</i>${f}</div><div class="v"><i>side →</i>${sd}</div></div>
    <figcaption><b>${e?.en?.name ?? r.key}</b><span>${r.position} · ${r.family}</span></figcaption>
  </figure>`);
}

writeFileSync(OUT, `<!doctype html><meta charset="utf-8"><title>Pose sheet</title>
<style>
 body{background:#12141a;color:#e8eaf0;font:13px/1.4 system-ui,sans-serif;margin:0;padding:18px}
 h1{font-size:15px;margin:0 0 4px}p.note{color:#8b95ab;margin:0 0 16px;max-width:70ch}
 .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(404px,1fr));gap:12px}
 figure{margin:0;background:#1a1d26;border:1px solid #262b36;border-radius:8px;padding:8px}
 .pair{display:flex;gap:2px;justify-content:center;background:#0d0f14;border-radius:5px}
 .v{position:relative}.v i{position:absolute;left:6px;top:4px;font-size:9.5px;color:#586074;font-style:normal}
 line{stroke:#c8cede;stroke-width:3.4;stroke-linecap:round}
 line.r{stroke:#4C8DF6}
 line.g{stroke:#3a4152;stroke-width:1;stroke-dasharray:3 3}
 circle{fill:#c8cede}circle.t{fill:#E9A13B}
 figcaption{margin-top:6px;font-size:11.5px}
 figcaption b{display:block}figcaption span{color:#8b95ab;font-size:10.5px}
</style>
<h1>${records.length} poses — front and side</h1>
<p class="note">Blue is the right side. Amber dots are hands and toes. The dashed line sits at
the lowest point of the figure, so a pose that ought to be on the floor and is not shows up
immediately. Each figure is drawn at the same scale.</p>
<div class="grid">${cells.join('')}</div>`);
console.log(`${records.length} poses -> ${OUT}`);
