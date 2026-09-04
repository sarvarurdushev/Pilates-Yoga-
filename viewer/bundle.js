/**
 * Read a session bundle in a browser, and light an anatomy model from it.
 *
 * The far side of the boundary described in `pilates/bundle.py`. Everything to
 * the left of that file is Python with a test suite; everything to the right is
 * a static page with no build step, which is why this module does as little
 * arithmetic as it can get away with. The levels, the tiers and the sentences
 * are all decided in Python and read out of the file here. A transform split
 * across two languages, half of it untested, is how imported data quietly
 * acquires errors.
 *
 * What this module does own is the *join*: turning a structure named in the
 * bundle into an id the palette understands, and refusing to light anything it
 * could not identify. A structure that cannot be found is reported, never
 * skipped -- a silently missing muscle looks exactly like a muscle that was
 * not measured, and those two must never be confused.
 *
 * Usage, from a page that already has the anatomy app running:
 *
 *     import { load, apply } from './viewer/bundle.js';
 *     const session = load(await (await fetch('anna-s1.json')).json());
 *     const result = apply(session, { registry: registry(), palette });
 *     palette.upload();
 *
 * With no bundle, nothing here runs and the app is exactly what it was.
 */

export const FORMAT = 'pilates-session-bundle';
export const VERSION = 1;
export const MEASURED = 'measured';
export const REFERENCE = 'reference';

/**
 * Everything wrong with a bundle, or an empty array.
 *
 * The Python writer refuses to save a bundle that fails these checks, so a file
 * arriving here should already pass. It is checked again anyway: by the time a
 * bundle reaches a browser it has been through a download, a filesystem and
 * possibly a text editor, and the failure mode of an edited one is not an error
 * but a picture that lies quietly.
 */
export function check(bundle) {
  const problems = [];
  if (!bundle || typeof bundle !== 'object') return ['not an object'];
  if (bundle.format !== FORMAT) problems.push(`not a ${FORMAT}`);
  if (bundle.version !== VERSION) {
    problems.push(`version ${JSON.stringify(bundle.version)}, expected ${VERSION}`);
  }
  const scheme = bundle.lighting ?? {};
  const [floor, ceiling] = scheme.measured_band ?? [];
  const flat = scheme.reference_level;
  if (typeof floor !== 'number' || typeof ceiling !== 'number' || typeof flat !== 'number') {
    problems.push('no lighting scheme, so there is no way to tell a measured '
                + 'structure from a looked-up one');
  } else if (flat >= floor) {
    problems.push(`reference level ${flat} is inside the measured band `
                + `${floor}-${ceiling}: the two tiers would look alike`);
  }
  for (const s of bundle.structures ?? []) {
    const where = s.name ?? '(unnamed structure)';
    if (s.tier !== MEASURED && s.tier !== REFERENCE) {
      problems.push(`${where}: tier ${JSON.stringify(s.tier)} is neither `
                  + `${MEASURED} nor ${REFERENCE}`);
      continue;
    }
    if (!s.because) problems.push(`${where}: no sentence saying where it came from`);
    // Both registers or neither. A viewer that has only the technical half
    // will show it to a student, and the student is the reader.
    if (!s.plain) {
      problems.push(`${where}: no plain-words version of the sentence`);
    }
    if (typeof s.level !== 'number') {
      problems.push(`${where}: no level, so a viewer would have to invent one`);
    } else if (typeof floor === 'number') {
      if (s.tier === MEASURED && (s.level < floor || s.level > ceiling)) {
        problems.push(`${where}: measured but lit at ${s.level}, outside `
                    + `${floor}-${ceiling}`);
      }
      if (s.tier === REFERENCE && s.level !== flat) {
        problems.push(`${where}: reference lit at ${s.level}, not the flat ${flat}`);
      }
    }
    if (s.tier === MEASURED && typeof s.value !== 'number') {
      problems.push(`${where}: measured with no value behind it`);
    }
    if (s.tier === REFERENCE && s.value !== undefined) {
      problems.push(`${where}: reference tier carrying a value, which would `
                  + `print as a measurement of this structure`);
    }
  }
  return problems;
}

export class InvalidBundle extends Error {}

/** Parse-and-check in one step. Throws rather than returning a bad session. */
export function load(bundle) {
  const problems = check(bundle);
  if (problems.length) throw new InvalidBundle(problems.join('; '));
  return bundle;
}

/* --------------------------------------------------------------- the join */

const INDEXES = new WeakMap();

/**
 * Look a structure up by FMA id first, by name second.
 *
 * FMA is the contract and the name is the shortcut: `FMA22342` means psoas
 * major to anything that speaks the ontology, whereas a name matches only
 * until either side rewords it. Nerve meshes have no FMA id in the source
 * data, so they can only ever be matched by name -- `resolve` reports which
 * route it took so a caller can tell the difference between a link that
 * survives a rename and one that does not.
 *
 * **A model structure carries a list of ids, not one.** A bilateral muscle is
 * one mesh with an id per side, so `anconeus` is `['FMA37705', 'FMA37706']`.
 * The first version of this compared a string against that array, matched
 * nothing, and fell through to the name for all twenty-nine structures -- the
 * ontology join was doing nothing at all and the picture looked identical,
 * which is how it went unnoticed until `tools/check_viewer.mjs` printed the
 * counts. Every id in the list points at the same record.
 */
export function resolve(registry, structure) {
  let index = INDEXES.get(registry);
  if (!index) {
    index = new Map();
    for (const rec of registry.byId.values()) {
      for (const id of asList(rec.fma)) index.set(id, rec);
    }
    INDEXES.set(registry, index);
  }
  for (const id of asList(structure.fma)) {
    const found = index.get(id);
    if (found) return { record: found, via: 'fma' };
  }
  const byName = registry.byName.get(structure.name);
  if (byName) return { record: byName, via: 'name' };
  return { record: null, via: null };
}

const asList = (fma) => (Array.isArray(fma) ? fma : fma ? [fma] : []);

/**
 * Light the model from one session.
 *
 * **The palette is cleared first, and that is not a tidy-up.** The alpha
 * channel is a single channel carrying a single meaning at a time. Left as it
 * was, a picture would show authored roles and measured moments mixed together
 * with nothing to say which was which -- the one thing this bridge exists to
 * prevent. A bundle takes the channel over completely for as long as it is
 * shown, and `restore` is how a caller gives it back.
 *
 * @param {object} session   a bundle that has been through `load`
 * @param {{registry: object, palette: object}} model
 * @param {{layers?: string[]}} [opts]  restrict to these layers, e.g. student view
 * @returns {{lit: object[], missing: object[], byName: boolean}}
 */
export function apply(session, { registry, palette }, opts = {}) {
  const wanted = opts.layers ? new Set(opts.layers) : null;
  palette.clearActivation();
  const lit = [], missing = [];
  let byName = 0;
  for (const structure of session.structures ?? []) {
    if (wanted && !wanted.has(structure.layer)) continue;
    const { record, via } = resolve(registry, structure);
    if (!record) { missing.push(structure); continue; }
    palette.setActivation(record.id, structure.level);
    if (via === 'name') byName++;
    lit.push({ ...structure, id: record.id, via });
  }
  return { lit, missing, byName };
}

/**
 * Put the palette back the way an exercise had it.
 *
 * Takes the same role map the app already keeps (`id -> role`) and the role
 * levels it already uses, so leaving a session restores exactly the picture
 * that was there, rather than an approximation of it.
 */
export function restore(palette, activation, roleLevel) {
  palette.clearActivation();
  for (const [id, role] of activation) palette.setActivation(id, roleLevel[role]);
  return palette;
}

/* ------------------------------------------------------------ what to say */

/**
 * The legend, read out of the bundle rather than written here.
 *
 * Three states, and the third one is the point: before this, everything lit was
 * a role. The wording for each comes from the file so it cannot get stronger on
 * this side of the boundary.
 */
export function legend(session) {
  const scheme = session.lighting ?? {};
  const [floor, ceiling] = scheme.measured_band ?? [0.7, 1];
  const scale = scheme.scale;
  return [
    {
      key: MEASURED,
      label: 'Measured this session',
      level: ceiling,
      range: [floor, ceiling],
      carriesNumber: true,
      note: scale
        ? `Brightest is ${fmt(scale.value)} ${scale.unit}, this session's `
          + `largest ${describe(scale.from)}. ${scheme.note ?? ''}`
        : scheme.note ?? '',
    },
    {
      key: REFERENCE,
      label: 'Connected to something measured',
      level: scheme.reference_level ?? 0.3,
      carriesNumber: false,
      note: 'Anatomy, true of everybody. It shows where to look next, not what '
          + 'was observed.',
    },
    {
      key: 'unlit',
      label: 'Nothing measured here',
      level: scheme.unlit ?? 0,
      carriesNumber: false,
      note: 'Not "zero effort" -- this session produced no measurement that '
          + 'reaches this structure.',
    },
  ];
}

const fmt = (n) => (typeof n === 'number' ? n.toFixed(n >= 10 ? 0 : 1) : '');
const describe = (source) => (source ?? '').replace(/ peak moment$/, ' effort');

/**
 * One row per lit structure, for a panel beside the picture.
 *
 * A measured row carries a number and the date it was measured on; a reference
 * row carries neither, and that asymmetry is deliberate. The rule for the whole
 * bridge is that a measurement and a lookup are never told apart by colour
 * alone, and the number is the other half of it.
 *
 * Both registers come through on every row -- `plain` and `because` -- so the
 * page can offer the same plain/technical switch the anatomy reader already
 * has. Neither is composed here: a register generated on the drawing side is
 * one more place for a claim to get stronger than the measurement behind it.
 */
export function rows(session, opts = {}) {
  const date = session.session?.date ?? '';
  const only = opts.tier;
  const out = [];
  for (const s of session.structures ?? []) {
    if (only && s.tier !== only) continue;
    out.push({
      name: s.name,
      fma: s.fma ?? '',
      layer: s.layer,
      tier: s.tier,
      level: s.level,
      // Only a measurement gets a figure printed against it.
      number: s.tier === MEASURED && typeof s.value === 'number'
        ? `${fmt(s.value)} ${s.unit}` : '',
      when: s.tier === MEASURED ? date : '',
      because: s.because,
      plain: s.plain,
    });
  }
  out.sort((a, b) => (b.level - a.level) || a.name.localeCompare(b.name));
  return out;
}
