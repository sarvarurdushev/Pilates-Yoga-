/**
 * One registry for every selectable thing in the scene, brain and body alike.
 *
 * The brain half is keyed by hand-assigned region ids 1–25 in REGION_INFO. The body half is
 * keyed by ids 100+ that the build allocates, so the only place body ids exist is
 * src/generated/structures.json — written by scripts/build_body.py, never edited. Content
 * for the body is keyed by *name*, not id, so a rebuild that renumbers cannot silently
 * detach a muscle's description from its mesh.
 *
 * Everything downstream — picking, labels, the palette, the panel — asks this module rather
 * than knowing which half of the id space it is in.
 */
import { REGION_INFO } from './regionData.js';
import { MUSCLE_INFO } from './content/muscles.js';
import { INTERIOR_IDS } from './deepStructures.js';

/** Layer names, in the order they stack from the outside in. */
export const LAYER_ORDER = ['organs', 'muscles_superficial', 'muscles_deep', 'nervous', 'skeleton', 'brain'];

/** Palette colour per layer, used for any structure with no colour of its own. */
export const LAYER_COLOR = {
  nervous: '#F2D98B',
  skeleton: '#D9D2C4',
  muscles_superficial: '#C1483F',
  muscles_deep: '#9E3B36',
  organs: '#B08658',
  brain: '#cfb2a8',
};

/** Spread structures within a layer around its base colour so neighbours are separable. */
function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const mix = (c, t) => Math.round(c + (t - c) * k);
  // toward a lighter, slightly desaturated version rather than to white, so the tint stays
  // tissue-coloured rather than turning pastel
  const hexOf = v => v.toString(16).padStart(2, '0');
  return `#${hexOf(mix(r, 240))}${hexOf(mix(g, 214))}${hexOf(mix(b, 200))}`;
}

let REG = null;

/**
 * Build the registry. Called once with the parsed structures.json.
 *
 * `brain` is false for a body that has no brain-to-body fit of its own. The brain model is
 * shared between bodies but its *placement* is not, so a body without a fit is not offered
 * the layer at all — and if the twenty-one regions were registered anyway they would still be
 * counted by the label filter, listed in the panel and selectable, all of them pointing at a
 * mesh that will never load. A chip reading "Brain 21" over a body with no brain is the
 * visible half of that; the selectable phantom behind it is the worse half.
 *
 * @param {object} generated  parsed structures.json for the body being loaded
 * @param {{brain?: boolean}} [opts]
 * @returns {{ byId: Map<number, object>, byName: Map<string, object>, meta: object }}
 */
export function buildRegistry(generated, { brain = true } = {}) {
  const byId = new Map(), byName = new Map();

  for (const [id, info] of Object.entries(brain ? REGION_INFO : {})) {
    const rec = {
      id: +id,
      key: `brain:${id}`,
      name: { en: info.en.name, ko: info.ko.name },
      color: info.color,
      layer: 'brain',
      kind: 'brain',
      interior: INTERIOR_IDS.has(+id),
      info,
    };
    byId.set(+id, rec);
    byName.set(rec.key, rec);
  }

  const perLayer = {};
  for (const s of generated.structures) perLayer[s.layer] = (perLayer[s.layer] ?? 0) + 1;
  const seen = {};

  for (const s of generated.structures) {
    seen[s.layer] = (seen[s.layer] ?? 0);
    const k = perLayer[s.layer] > 1 ? (seen[s.layer] / (perLayer[s.layer] - 1)) : 0.5;
    seen[s.layer]++;
    const muscle = MUSCLE_INFO[s.name] ?? null;
    const rec = {
      id: s.id,
      key: s.name,
      name: muscle ? { en: muscle.en.name, ko: muscle.ko.name }
                   : { en: titleCase(s.name), ko: titleCase(s.name) },
      // spread across the layer's range so two adjacent muscles are never the same colour
      color: shade(LAYER_COLOR[s.layer] ?? '#9aa3b8', 0.12 + 0.55 * ((k * 7) % 1)),
      layer: s.layer,
      kind: s.layer.startsWith('muscles') ? 'muscle'
          : s.layer === 'skeleton' ? 'bone'
          : s.layer === 'nervous' ? 'nerve' : 'organ',
      interior: false,
      fma: s.fma,
      sides: s.sides,
      tris: s.tris,
      centroid: s.centroid,
      muscle,
    };
    byId.set(s.id, rec);
    byName.set(s.name, rec);
  }

  REG = { byId, byName, meta: generated };
  return REG;
}

export function registry() {
  if (!REG) throw new Error('buildRegistry() has not run yet');
  return REG;
}

export const get = id => REG?.byId.get(+id) ?? null;
export const getByName = name => REG?.byName.get(name) ?? null;
export const nameOf = (id, lang) => REG?.byId.get(+id)?.name[lang] ?? '';
export const has = id => !!REG?.byId.has(+id);

/** Ids in a layer. */
export function idsInLayer(layer) {
  const out = [];
  for (const [id, r] of REG.byId) if (r.layer === layer) out.push(id);
  return out;
}

/** Every structure with a written entry — used by the panel's browse lists. */
export function documented(kind) {
  const out = [];
  for (const [, r] of REG.byId) {
    if (kind && r.kind !== kind) continue;
    if (r.kind === 'brain' || r.muscle) out.push(r);
  }
  return out.sort((a, b) => a.name.en.localeCompare(b.name.en));
}

/**
 * Vertebral level -> a structure id in the skeleton, for the schematic pathway endpoints.
 * The build names vertebrae 'first cervical vertebra' style, so the lookup is by the ordinal
 * word rather than the clinical shorthand.
 */
const ORDINAL = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh',
                 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth'];
const REGION_WORD = { C: 'cervical', T: 'thoracic', L: 'lumbar', S: 'sacral' };

export function vertebra(level) {
  if (!REG) return null;
  const m = /^([CTLS])(\d+)$/.exec(level);
  if (!m) return null;
  const [, region, n] = m;
  const want = `${ORDINAL[+n - 1]} ${REGION_WORD[region]} vertebra`;
  // atlas and axis are C1 and C2 and are named as such in the source ontology
  const alt = region === 'C' && n === '1' ? 'atlas' : region === 'C' && n === '2' ? 'axis' : null;
  return REG.byName.get(want) ?? (alt ? REG.byName.get(alt) : null) ?? null;
}

function titleCase(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
