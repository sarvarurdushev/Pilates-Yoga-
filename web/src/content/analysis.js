import { MOTION, sample, isAngle, coordLabel } from './motion.js';
import { EXERCISE } from './exercises.js';
import { EXERCISE_BRAIN, TIERS } from './evidence.js';
import { MUSCLE_INFO } from './muscles.js';
import { REGION_INFO } from '../regionData.js';

/**
 * What one exercise works — muscles, joints, nerves and brain regions — derived rather than
 * written down.
 *
 * The request this answers was "automatically choose which brain parts, which muscles, which
 * bones, which nerves, and how it is helping". Every one of those has an honest answer
 * already in this repository, and the whole job of this file is to assemble them without
 * inventing the one number that would make it a fabrication.
 *
 * **Where each answer comes from, and what it is allowed to claim.**
 *
 * - **Muscles** are the exercise's own authored roles, and the share is the area under that
 *   muscle's authored activation curve across the clip. It is a property of the written
 *   record, not a measurement of a person, and every muscle in the library carries an
 *   evidence marker saying whether a study measured it (`emg`) or it was reasoned from the
 *   anatomy (`inferred`). Both travel with the number here.
 * - **Joints** are measured off the clip itself: the peak-to-peak excursion of each
 *   coordinate through the movement, in degrees. That is a real measurement — of this
 *   animation, which is hand-keyed against published range of motion and says so.
 * - **Nerves** come from `MUSCLE_INFO[...].innervation`, which carries the supplying nerves
 *   and the root levels from Gray's Anatomy. So "which nerves does this exercise use" is
 *   answered as anatomy — these muscles are supplied by these nerves from these roots — and
 *   never as activity. There is no electrophysiology in this repository and no way to say
 *   how hard a nerve is firing.
 * - **Brain regions** are the regions named by the exercise's *own* brain claims, each of
 *   which carries a tier, a citation, a population and a caveat. A region's weight here is
 *   how many of this exercise's claims are about it — a count of claims, which is what it
 *   says, and not an activation.
 *
 * The one thing this file must never do is produce a plausible-looking score for something
 * nobody measured. Every field below is either quoted from a record, counted, or measured off
 * the clip, and the panels that render it say which.
 */

/** How finely the clip is sampled when integrating an activation curve or a joint's travel. */
const STEPS = 48;

/**
 * The muscles an exercise works, ranked by how much of the movement they are asked for.
 *
 * The share is the mean of the authored activation over the clip — the same numbers the
 * shader lights the muscle with, so the ranking and the picture cannot disagree. An exercise
 * with no clip still ranks by role, because a role is an ordering even without a curve.
 */
export function musclesOf(key) {
  const ex = EXERCISE[key];
  if (!ex) return [];
  const clip = MOTION[key];
  const ROLE_ORDER = { prime: 3, synergists: 2, stabilisers: 1 };
  const out = new Map();
  for (const role of ['prime', 'synergists', 'stabilisers']) {
    for (const entry of ex.muscles[role] ?? []) {
      const [name, evidence] = Array.isArray(entry) ? entry : [entry, null];
      if (!out.has(name)) out.set(name, { name, role, evidence, mean: 0, peak: 0 });
    }
  }
  if (clip) {
    const totals = new Map();
    for (let i = 0; i <= STEPS; i++) {
      const { activation } = sample(key, i / STEPS);
      for (const [name, v] of Object.entries(activation ?? {})) {
        const t = totals.get(name) ?? { sum: 0, peak: 0 };
        t.sum += v; t.peak = Math.max(t.peak, v);
        totals.set(name, t);
      }
    }
    for (const [name, t] of totals) {
      const row = out.get(name) ?? { name, role: 'stabilisers', evidence: null, mean: 0, peak: 0 };
      row.mean = t.sum / (STEPS + 1);
      row.peak = t.peak;
      out.set(name, row);
    }
  }
  return [...out.values()].sort((a, b) =>
    (b.mean - a.mean) || (ROLE_ORDER[b.role] - ROLE_ORDER[a.role]) || a.name.localeCompare(b.name));
}

/**
 * The joints the movement actually travels through, in degrees, measured off the clip.
 *
 * Peak-to-peak rather than the value at any one instant: a joint held at 90 degrees for the
 * whole exercise is loaded but not moving, and a reader asking "which joints does this work"
 * means both. So `travel` is how far it moves and `held` is where it sits, and the panels
 * print both rather than collapsing them into one misleading number.
 *
 * Pelvis translations and spine wave positions are excluded, because they are not angles —
 * the same test `motion.js` uses on the way in is used here on the way out.
 */
export function jointsOf(key) {
  const clip = MOTION[key];
  if (!clip) return [];
  const lo = new Map(), hi = new Map(), sum = new Map();
  for (let i = 0; i <= STEPS; i++) {
    const { coordinates } = sample(key, i / STEPS);
    for (const [c, v] of Object.entries(coordinates ?? {})) {
      if (!isAngle(c)) continue;
      const deg = v * 180 / Math.PI;
      lo.set(c, Math.min(lo.get(c) ?? Infinity, deg));
      hi.set(c, Math.max(hi.get(c) ?? -Infinity, deg));
      sum.set(c, (sum.get(c) ?? 0) + deg);
    }
  }
  const out = [];
  for (const [c, min] of lo) {
    const max = hi.get(c);
    out.push({ coord: c, travel: Math.abs(max - min), held: sum.get(c) / (STEPS + 1),
               min, max });
  }
  return out.sort((a, b) => b.travel - a.travel);
}

/** The same list with the joint named in plain words, for a panel that has to print it. */
export const jointLabel = (coord, lang) => coordLabel(coord, lang);

/**
 * The nerves that supply the muscles this exercise works, from each muscle's own record.
 *
 * This is anatomy, quoted: `MUSCLE_INFO[...].innervation` carries the supplying nerves and
 * the spinal root levels from Gray's Anatomy, and this collects them across the muscles the
 * exercise names. It is emphatically **not** a statement that these nerves are firing at some
 * rate — nothing here measures a nerve, and the panel that renders it says so. What it is
 * good for is the real question underneath: which part of the nervous system has to be intact
 * for this movement to happen, and at which levels of the cord.
 */
export function nervesOf(key, lang = 'en') {
  const rows = musclesOf(key);
  const byRoot = new Map();
  const nerves = new Map();
  for (const m of rows) {
    const inn = MUSCLE_INFO[m.name]?.innervation;
    if (!inn) continue;
    const text = inn.nerves?.[lang] ?? inn.nerves?.en ?? '';
    if (text) {
      const e = nerves.get(text) ?? { text, muscles: [], mean: 0 };
      e.muscles.push(m.name);
      e.mean = Math.max(e.mean, m.mean);
      nerves.set(text, e);
    }
    for (const root of inn.roots ?? []) {
      const e = byRoot.get(root) ?? { root, muscles: [] };
      e.muscles.push(m.name);
      byRoot.set(root, e);
    }
  }
  /* Roots in anatomical order — C above T above L above S, numerically inside each — because
   * a list of cord levels sorted any other way is one a reader has to re-sort in their head
   * before it means anything.
   *
   * Not every entry is a cord level: sternocleidomastoid is supplied by the accessory nerve,
   * whose root is written `CN XI`, and a numeric compare on that yields NaN, which sorts
   * nowhere in particular and quietly scrambles the list around it. Cranial nerves are their
   * own group and go last, which is also where they belong anatomically in a list of this
   * kind — they are not segments of the cord. */
  const RANK = { C: 0, T: 1, L: 2, S: 3 };
  const level = r => /^[CTLS]\d+$/.test(r);
  const roots = [...byRoot.values()].sort((a, b) => {
    const la = level(a.root), lb = level(b.root);
    if (la !== lb) return la ? -1 : 1;
    if (!la) return a.root.localeCompare(b.root);
    return (RANK[a.root[0]] ?? 9) - (RANK[b.root[0]] ?? 9)
        || (+a.root.slice(1) - +b.root.slice(1));
  });
  return { nerves: [...nerves.values()].sort((a, b) => b.mean - a.mean), roots };
}

/**
 * The brain regions this exercise's own claims are about, with the claims themselves.
 *
 * `weight` is how many of this exercise's claims name that region, divided by how many it has
 * — a share of the claims, which is what the panel prints. It is not an activation and there
 * is no version of this application in which it could be: nothing here records a brain.
 *
 * `best` is the strongest evidence tier among those claims, so a region that is only spoken
 * about by an inference cannot look like one supported by a meta-analysis.
 */
export function brainOf(key) {
  const ex = EXERCISE[key];
  const keys = ex?.brain ?? [];
  const claims = keys.map(k => (EXERCISE_BRAIN[k] ? { key: k, ...EXERCISE_BRAIN[k] } : null))
                     .filter(Boolean);
  if (!claims.length) return { claims: [], regions: [] };
  const by = new Map();
  for (const c of claims)
    for (const id of c.structures ?? []) {
      const e = by.get(id) ?? { region: id, claims: [] };
      e.claims.push(c);
      by.set(id, e);
    }
  const order = Object.keys(TIERS);
  const regions = [...by.values()].map(e => ({
    ...e,
    weight: e.claims.length / claims.length,
    best: order.find(t => e.claims.some(c => c.tier === t)) ?? 'E',
    info: REGION_INFO[e.region] ?? null,
  })).sort((a, b) => b.claims.length - a.claims.length
                  || order.indexOf(a.best) - order.indexOf(b.best));
  return { claims, regions };
}

/** Everything at once, for a panel that shows all four beside each other. */
export function analyse(key, lang = 'en') {
  return {
    key,
    muscles: musclesOf(key),
    joints: jointsOf(key),
    ...nervesOf(key, lang),
    ...brainOf(key),
  };
}
