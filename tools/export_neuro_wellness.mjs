/**
 * Dump the Neuro Wellness content library to JSON, verbatim.
 *
 * That project holds 190 Pilates and yoga exercises with per-muscle roles, an
 * innervation table sourced to Gray's Anatomy, and brain-effect claims carrying
 * an evidence tier, citation, effect size, population and caveat. All of it is
 * better curated than anything that could be written here from scratch.
 *
 * This script does no mapping. It reads the ES modules and writes what they
 * contain, so the schema translation lives in pilates/neurowellness.py where
 * the test suite can check it. A transform split across two languages, half of
 * it untested, is how imported data quietly acquires errors.
 *
 *   node tools/export_neuro_wellness.mjs /path/to/neuro_wellness out.json
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const [repo, out] = process.argv.slice(2);
if (!repo || !out) {
  console.error('usage: node tools/export_neuro_wellness.mjs <repo> <out.json>');
  process.exit(2);
}

const load = async (rel) => import(pathToFileURL(resolve(repo, rel)).href);

const { PILATES } = await load('src/content/library/pilates.js');
const { YOGA } = await load('src/content/library/yoga.js');
const { MUSCLE_INFO } = await load('src/content/muscles.js');
const { EXERCISE_BRAIN, TIERS } = await load('src/content/evidence.js');

const muscles = {};
for (const [name, info] of Object.entries(MUSCLE_INFO)) {
  muscles[name] = {
    latin: info.latin ?? '',
    display: info.en?.name ?? name,
    nerves: info.innervation?.nerves?.en ?? '',
    roots: info.innervation?.roots ?? [],
    actions: info.actions?.en ?? '',
  };
}

const exercises = [...PILATES, ...YOGA].map((r) => ({
  key: r.key,
  name: r.en?.name ?? r.key,
  family: r.family ?? '',
  apparatus: r.apparatus ?? '',
  position: r.position ?? '',
  actions: r.actions ?? [],
  breath: r.breath ?? '',
  reps: r.reps ?? null,
  hold: r.hold ?? null,
  difficulty: r.difficulty ?? null,
  contacts: r.contacts ?? null,
  muscles: r.muscles ?? {},
  activation: r.activation ?? {},
  contra: r.contra ?? [],
  brain: r.brain ?? [],
  pose: r.pose ?? {},
  entry: r.entry ?? {},
}));

/* The structure list, for the bridge table: name, ontology id and layer for
 * every drawable thing. Read-only, like everything else here. */
const structuresPath = resolve(repo, 'src/generated/structures.json');
const generated = JSON.parse(readFileSync(structuresPath, 'utf8'));
const structures = generated.structures.map((s) => ({
  name: s.name, fma: s.fma ?? [], layer: s.layer, sides: s.sides ?? [],
}));

const brain = {};
for (const [key, e] of Object.entries(EXERCISE_BRAIN)) {
  brain[key] = {
    claim: e.en?.claim ?? '',
    mechanism: e.en?.mechanism ?? '',
    tier: e.tier ?? '',
    citation: e.citation ?? '',
    effect: e.effect?.en ?? '',
    population: e.population?.en ?? '',
    species: e.species ?? '',
    timescale: e.timescale ?? '',
    caveat: e.caveat?.en ?? '',
  };
}

const tiers = {};
for (const [key, t] of Object.entries(TIERS)) tiers[key] = t.en ?? '';

writeFileSync(out, JSON.stringify(
  { source: 'Neuro Wellness', exercises, muscles, brain, tiers, structures },
  null, 2) + '\n');
console.error(`${exercises.length} exercises, ${Object.keys(muscles).length} muscles, `
  + `${Object.keys(brain).length} brain claims, ${structures.length} structures `
  + `-> ${out}`);
