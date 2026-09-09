import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EXERCISE, EXERCISE_KEYS, ROLE_EVIDENCE, DISCIPLINES, APPARATUS } from '../src/content/exercises.js';
import { EXERCISE_BRAIN, TIERS, TIER_ORDER } from '../src/content/evidence.js';
import { MOVEMENT_PATHWAY } from '../src/content/pathways.js';
import { MUSCLE_INFO } from '../src/content/muscles.js';
import { UI, DISCLAIMERS } from '../src/content/strings.js';
import { HELP } from '../src/content/help.js';
import { REGION_INFO } from '../src/regionData.js';
import { buildRegistry, vertebra, LAYER_ORDER, searchText } from '../src/structures.js';
import { KO_NAME } from '../src/content/koreanNames.js';
import { buildGroups, groups, GROUP_REGIONS } from '../src/content/groups.js';

/**
 * The guardrail that keeps the project honest as the content grows.
 *
 * Two failure modes matter more than any bug in the viewer. One is a claim about the brain
 * with no tier and no citation, which is how "exercise rewires your brain" gets written
 * without anyone noticing. The other is content that names a muscle the model does not
 * have, which shows up as a silently missing highlight rather than an error.
 */

const generated = JSON.parse(
  readFileSync(new URL('../src/generated/structures.json', import.meta.url), 'utf8'));
const REG = buildRegistry(generated);

const LANGS = ['en', 'ko'];

/* ------------------------------------------------------------------ evidence */

test('every brain claim carries a tier and a citation', () => {
  for (const [key, c] of Object.entries(EXERCISE_BRAIN)) {
    assert.ok(TIER_ORDER.includes(c.tier), `${key}: tier "${c.tier}" is not one of A-E`);
    assert.ok(c.citation && c.citation.length > 12, `${key}: citation is missing or too short`);
    // a citation has to be findable: a name and a year at minimum
    assert.match(c.citation, /\d{4}/, `${key}: citation has no year`);
  }
});

test('every brain claim states who was studied and what it does not show', () => {
  for (const [key, c] of Object.entries(EXERCISE_BRAIN)) {
    for (const lang of LANGS) {
      assert.ok(c.population?.[lang], `${key}: no population in ${lang}`);
      assert.ok(c.caveat?.[lang], `${key}: no caveat in ${lang}`);
      assert.ok(c[lang]?.claim, `${key}: no claim in ${lang}`);
      assert.ok(c[lang]?.mechanism, `${key}: no mechanism in ${lang}`);
    }
    assert.ok(['human', 'animal'].includes(c.species), `${key}: species`);
    assert.ok(['acute', 'chronic'].includes(c.timescale), `${key}: timescale`);
  }
});

test('an animal-only claim cannot sit above tier D', () => {
  // the specific way this literature misleads: a mouse result written up as if it were a
  // human finding. Tier D exists for it and nothing else may borrow a stronger tier.
  for (const [key, c] of Object.entries(EXERCISE_BRAIN)) {
    if (c.species === 'animal') {
      assert.ok(['D', 'E'].includes(c.tier),
        `${key} is animal work but claims tier ${c.tier}`);
    }
  }
});

test('a tier A claim names a meta-analysis or multiple trials', () => {
  for (const [key, c] of Object.entries(EXERCISE_BRAIN)) {
    if (c.tier !== 'A') continue;
    assert.match(c.citation, /meta-analysis|studies|;/i,
      `${key} claims tier A but cites a single source with no indication of replication`);
  }
});

test('every brain claim points at regions that exist in the brain model', () => {
  for (const [key, c] of Object.entries(EXERCISE_BRAIN)) {
    assert.ok(Array.isArray(c.structures), `${key}: structures must be an array`);
    for (const id of c.structures) {
      assert.ok(REGION_INFO[id], `${key} names brain region ${id}, which does not exist`);
    }
  }
});

test('every tier used has a bilingual label', () => {
  for (const t of TIER_ORDER) {
    for (const lang of LANGS) assert.ok(TIERS[t]?.[lang], `tier ${t} has no ${lang} label`);
  }
});

/* ----------------------------------------------------------------- exercises */

test('every muscle an exercise names exists in the model', () => {
  for (const key of EXERCISE_KEYS) {
    const m = EXERCISE[key].muscles;
    for (const role of ['prime', 'synergists', 'stabilisers']) {
      assert.ok(Array.isArray(m[role]), `${key}: missing ${role}`);
      for (const [name, ev] of m[role]) {
        assert.ok(REG.byName.has(name),
          `${key} lists "${name}" as a ${role}, but no structure by that name was built`);
        assert.ok(ROLE_EVIDENCE[ev],
          `${key}/${name}: evidence marker "${ev}" is not emg or inferred`);
      }
    }
  }
});

test('every muscle an exercise names has a written entry', () => {
  // an exercise that highlights a muscle with no description gives the user a coloured
  // shape and nothing to read
  for (const key of EXERCISE_KEYS) {
    const m = EXERCISE[key].muscles;
    for (const role of ['prime', 'synergists', 'stabilisers'])
      for (const [name] of m[role])
        assert.ok(MUSCLE_INFO[name], `${key} names "${name}" but MUSCLE_INFO has no entry`);
  }
});

test('no exercise presents inference as measurement', () => {
  // every exercise has to say, in words, what its muscle attributions rest on
  for (const key of EXERCISE_KEYS) {
    for (const lang of LANGS)
      assert.ok(EXERCISE[key].emgNote?.[lang], `${key}: no emgNote in ${lang}`);
  }
});

test('every exercise carries contraindications and a review status', () => {
  for (const key of EXERCISE_KEYS) {
    const e = EXERCISE[key];
    for (const lang of LANGS) {
      const t = e[lang];
      assert.ok(t?.name, `${key}: no name in ${lang}`);
      assert.ok(t?.contraindications, `${key}: no contraindications in ${lang}`);
      assert.ok(Array.isArray(t.faults) && t.faults.length, `${key}: no faults in ${lang}`);
      assert.ok(t.progressions?.length && t.regressions?.length, `${key}: no progressions in ${lang}`);
      assert.ok(t.breath, `${key}: no breath pattern in ${lang}`);
    }
    // `reviewed` is either false or a named person; it may not be missing. The credential
    // may be null — it was not supplied for this reviewer, and a plausible-looking invented
    // qualification would be worse than an absent one.
    assert.ok(e.reviewed === false || (e.reviewed?.by && e.reviewed?.date),
      `${key}: reviewed must be false or name a reviewer with a date`);
    assert.ok(DISCIPLINES[e.discipline], `${key}: unknown discipline`);
    if (e.apparatus) assert.ok(APPARATUS[e.apparatus], `${key}: unknown apparatus`);
  }
});

test('every exercise links to brain claims that exist', () => {
  for (const key of EXERCISE_KEYS) {
    assert.ok(EXERCISE[key].brain?.length, `${key}: no brain claims linked`);
    for (const c of EXERCISE[key].brain)
      assert.ok(EXERCISE_BRAIN[c], `${key} links to claim "${c}", which does not exist`);
  }
});

test('Pilates is the deepest vertical', () => {
  // stated intent in the brief; a regression here means the content drifted toward the gym
  const byDiscipline = {};
  for (const k of EXERCISE_KEYS) (byDiscipline[EXERCISE[k].discipline] ??= []).push(k);
  assert.ok(byDiscipline.pilates?.length >= 4,
    'Pilates is the primary discipline and should have the most entries');
  assert.ok(Object.keys(byDiscipline).length >= 3, 'other disciplines should be represented');
});

/* ------------------------------------------------------------------- muscles */

test('every MUSCLE_INFO key resolves to a built structure', () => {
  // content is keyed by name precisely so a rebuild that renumbers cannot detach it; this
  // is the test that makes that guarantee real
  for (const name of Object.keys(MUSCLE_INFO))
    assert.ok(REG.byName.has(name), `MUSCLE_INFO has "${name}" but nothing was built for it`);
});

test('every muscle carries innervation with nerve root levels', () => {
  // the roots are the bridge to the nervous system and the whole reason the traversal works
  for (const [name, m] of Object.entries(MUSCLE_INFO)) {
    assert.ok(m.innervation?.roots?.length, `${name}: no nerve roots`);
    for (const r of m.innervation.roots)
      assert.match(r, /^(C|T|L|S)\d+$|^CN /, `${name}: "${r}" is not a root level`);
    for (const lang of LANGS) {
      assert.ok(m.innervation.nerves?.[lang], `${name}: no nerve name in ${lang}`);
      assert.ok(m[lang]?.does && m[lang]?.sci, `${name}: missing register in ${lang}`);
      assert.ok(m.origin?.[lang] && m.insertion?.[lang], `${name}: missing attachment in ${lang}`);
    }
    /* `Musculi` is the plural, and correct for the groups: rotatores, the
     * intercostals, the interspinales. `Pars` is correct for a named part of one
     * muscle -- Terminologia Anatomica lists the three parts of trapezius as
     * *Pars descendens*, *Pars transversa* and *Pars ascendens*, not as three
     * muscles -- and this rule predated there being any parts to name. `Caput`
     * is the same thing for a head: *Caput longum musculi tricipitis brachii*. */
    assert.ok(/^Musculus |^Musculi |^Pars |^Caput /.test(m.latin ?? '') || m.latin === 'Diaphragma',
      `${name}: Latin name should follow Terminologia Anatomica`);
  }
});

test('synergists and antagonists point at real muscles', () => {
  for (const [name, m] of Object.entries(MUSCLE_INFO))
    for (const key of ['synergists', 'antagonists'])
      for (const other of m[key] ?? [])
        assert.ok(REG.byName.has(other), `${name}.${key} names "${other}", which was not built`);
});

test('a muscle that cites evidence cites a claim that exists', () => {
  for (const [name, m] of Object.entries(MUSCLE_INFO))
    if (m.evidence) assert.ok(EXERCISE_BRAIN[m.evidence], `${name}: no claim "${m.evidence}"`);
});

/* ------------------------------------------------------------------ pathways */

test('the motor route is anchored to real nerves, not only to drawn arcs', () => {
  // the point of building the nervous layer: below the neck the traversal now lands on
  // named nerve geometry rather than on a curve between two endpoints
  const nerveSteps = Object.values(MOVEMENT_PATHWAY)
    .flatMap(p => p.steps).filter(s => s.at.nerve);
  assert.ok(nerveSteps.length >= 4,
    `only ${nerveSteps.length} pathway steps anchor to a real nerve`);
});

test('every pathway step resolves to something in the model', () => {
  for (const [key, p] of Object.entries(MOVEMENT_PATHWAY)) {
    assert.ok(p.steps.length >= 3, `${key}: a pathway needs at least three steps`);
    for (const s of p.steps) {
      const at = s.at;
      if (at.region != null) assert.ok(REGION_INFO[at.region], `${key}: no region ${at.region}`);
      else if (at.level) assert.ok(vertebra(at.level), `${key}: no vertebra ${at.level}`);
      else if (at.nerve) assert.ok(REG.byName.has(at.nerve), `${key}: no nerve ${at.nerve}`);
      else if ('muscle' in at) {
        if (at.muscle) assert.ok(REG.byName.has(at.muscle), `${key}: no muscle ${at.muscle}`);
      } else assert.fail(`${key}: step has no anchor`);
      for (const lang of LANGS)
        assert.ok(s[lang]?.title && s[lang]?.text, `${key}: step missing ${lang}`);
    }
  }
});

/* -------------------------------------------------------------------- strings */

test('every interface string exists in both languages', () => {
  for (const [key, v] of Object.entries(UI))
    for (const lang of LANGS)
      assert.ok(typeof v[lang] === 'string' && v[lang].length, `UI.${key} missing ${lang}`);
});

/* Every control explained both ways, in both languages.
 *
 * A half-written entry is worse than none: the register switch would show a reader an empty
 * panel where the explanation should be, and an explanation that renders nothing looks exactly
 * like a control that has none. The technical half is required as well as the plain one —
 * "there is no point of having great visual features and not knowing what it means" was the
 * report, and answering it in one register only answers half of it. */
test('every control is explained in both registers and both languages', () => {
  const keys = Object.keys(HELP);
  assert.ok(keys.length >= 15, `only ${keys.length} controls are explained`);
  for (const [key, v] of Object.entries(HELP))
    for (const half of ['plain', 'tech'])
      for (const lang of LANGS)
        assert.ok(typeof v[half]?.[lang] === 'string' && v[half][lang].length > 20,
                  `HELP.${key}.${half} missing or too short in ${lang}`);
});

/* The sections must never be described as imaging. There is no volumetric data in this
 * repository, so a caption that let a reader take those thumbnails for an MRI would be a
 * fabrication presented as an instrument reading — the one thing this project must not ship. */
test('the section strip says in both languages that it is not imaging', () => {
  assert.match(HELP.sections.tech.en, /not imaging data/i);
  assert.match(UI.sectionsNote.en, /not an MRI/i);
  assert.match(UI.sectionsNote.ko, /MRI/);
  assert.match(HELP.sections.tech.ko, /영상 데이터가 아닙니다/);
});

test('all four disclaimers are present in both languages', () => {
  // the line that must not move, and the three this project added to it
  assert.equal(DISCLAIMERS.length, 4);
  const keys = DISCLAIMERS.map(d => d.key);
  assert.deepEqual(keys, ['template', 'medical', 'population', 'evidence']);
  for (const d of DISCLAIMERS)
    for (const lang of LANGS) {
      assert.ok(d[lang]?.title, `disclaimer ${d.key} has no ${lang} title`);
      assert.ok(d[lang]?.body?.length > 80, `disclaimer ${d.key}: ${lang} body is too thin`);
    }
});

/* ------------------------------------------------------------------ the build */

test('the generated structure table is internally consistent', () => {
  /* Names are unique per *key*, not per display name. The complete-atlas layers
   * are the same anatomy the taught body carries at BodyParts3D 4.0's own
   * granularity, so `atlas`, `sacrum` and `liver` legitimately arrive twice —
   * under two keys, because the registry is a map and the second write would
   * otherwise take every exercise and every written entry keyed to that name with
   * it, into a layer that is switched off. */
  const ids = new Set(), keys = new Set();
  for (const s of generated.structures) {
    const key = s.key ?? s.name;
    assert.ok(s.id >= generated.idBase, `${s.name}: id ${s.id} collides with the brain range`);
    assert.ok(!ids.has(s.id), `duplicate id ${s.id}`);
    assert.ok(!keys.has(key), `duplicate key ${key}`);
    ids.add(s.id); keys.add(key);
    // the nervous layer comes from Z-Anatomy, which is named by Terminologia Anatomica
    // rather than FMA, so it carries a source instead of an ontology id
    if (s.layer === 'nervous') assert.ok(s.source, `${s.name}: no source`);
    else assert.ok(s.fma?.length, `${s.name}: no FMA ids`);
    assert.ok(s.tris > 0, `${s.name}: empty mesh`);
    assert.equal(s.centroid.length, 3);
  }
});

test('the build records where the meshes came from', () => {
  /* Attribution-required, so the attribution has to survive into the app -- the
   * About panel reads these three fields and nothing else.
   *
   * This used to assert CC BY-SA, because the release-3.0 OBJ files carry a
   * legacy CC BY-SA 2.1 Japan notice. The licensor's own licence page offers
   * the database under CC BY 4.0 and specifies the sentence it wants quoted;
   * ATTRIBUTION.md records both. So the assertion is now on the wording the
   * licensor asks for rather than on a licence family. */
  assert.match(generated.attribution, /BodyParts3D/);
  assert.match(generated.attribution, /The Database Center for Life Science/);
  assert.match(generated.attribution, /CC Attribution 4\.0 International/);
  assert.equal(generated.licence, 'CC BY 4.0');
  assert.match(generated.source, /release 3\.0 \(20110915\)/);
});

test('the nervous layer keeps its own share-alike', () => {
  /* The one real copyleft in the building. It is a different source under a
   * different licence, and relaxing the body's licence must not quietly relax
   * this one with it. */
  const nervous = generated.sources?.nervous;
  assert.ok(nervous, 'the nervous layer has no source record');
  assert.equal(nervous.licence, 'CC BY-SA 4.0');
  assert.match(nervous.attribution, /Z-Anatomy/);
  assert.match(nervous.attribution, /CC BY-SA 4\.0/);
});

test('every structure lands inside a standing body', () => {
  // a frame sign error would put a muscle outside the figure and nothing else would notice
  for (const s of generated.structures) {
    const [x, y, z] = s.centroid;
    assert.ok(y > -0.60 && y < 0.46, `${s.name} sits at y=${y}, outside the body`);
    assert.ok(Math.abs(x) < 0.45, `${s.name} sits at x=${x}, outside the body`);
    assert.ok(Math.abs(z) < 0.35, `${s.name} sits at z=${z}, outside the body`);
  }
});

/* ------------------------------------------------------------------- motion */

import { MOTION, MOTION_KEYS, BREATH, sample, phaseAt } from '../src/content/motion.js';

const rig = JSON.parse(
  readFileSync(new URL('../src/generated/rig.json', import.meta.url), 'utf8'));
const paths = JSON.parse(
  readFileSync(new URL('../src/generated/muscle_paths.json', import.meta.url), 'utf8'));

/**
 * A clip may name a real joint coordinate, or one of the regional spine shorthands the
 * segmented spine introduced. `lumbar_flex` is a command for a region, which the rig spreads
 * across that region's levels; `L3_flex` is a command for one joint. Both have to resolve,
 * and both have to stay inside a published range — the regional one against the travel
 * build_spine.py derives from the per-joint limits it emitted.
 */
const REGIONAL = /^(lumbar|thoracic|cervical)_(flex|bend|rot|wave)$/;

test('every clip drives coordinates the rig actually has', () => {
  // a typo here is silent: the coordinate is ignored and that joint simply never moves
  for (const key of MOTION_KEYS)
    for (const k of MOTION[key].keys)
      for (const c of Object.keys(k.c)) {
        const m = REGIONAL.exec(c);
        if (m) {
          assert.ok(rig.spine?.regions?.[m[1]], `${key}: no spine region "${m[1]}"`);
          if (m[2] !== 'wave')
            assert.ok(rig.spine.regionRange?.[m[1]]?.[m[2]],
              `${key}: no published travel for ${c}`);
        } else {
          assert.ok(rig.coordinates[c], `${key}: no coordinate "${c}" in the rig`);
        }
      }
});

test('every clip stays inside the model’s published joint ranges', () => {
  // the ranges are Rajagopal's below the spine and White & Panjabi's within it, so exceeding
  // one means the pose is outside what the model was built to represent — not merely ugly
  for (const key of MOTION_KEYS)
    for (const k of MOTION[key].keys)
      for (const [c, v] of Object.entries(k.c)) {
        const m = REGIONAL.exec(c);
        if (m && m[2] === 'wave') {
          // a sweep position, not an angle: 0 is the start and about 1.5 clears the region
          assert.ok(v >= -1.8 && v <= 1.8, `${key}: ${c} = ${v} is not a wave position`);
          continue;
        }
        const [lo, hi] = m ? rig.spine.regionRange[m[1]][m[2]] : rig.coordinates[c].range;
        assert.ok(v >= lo - 1e-6 && v <= hi + 1e-6,
          `${key}: ${c} = ${v.toFixed(3)} is outside [${lo.toFixed(2)}, ${hi.toFixed(2)}]`);
      }
});

test('a regional spine command never drives a single joint past its own limit', () => {
  // the reason regionRange exists: the region's travel is set by whichever level runs out
  // of range first, and that level is not the same one on every axis
  for (const [region, levels] of Object.entries(rig.spine.regions))
    for (const axis of ['flex', 'bend', 'rot']) {
      const [rlo, rhi] = rig.spine.regionRange[region][axis];
      for (const total of [rlo, rhi])
        for (const seg of levels) {
          const v = total * rig.spine.share[region][axis][seg];
          const [lo, hi] = rig.coordinates[`${seg}_${axis}`].range;
          assert.ok(v >= lo - 1e-9 && v <= hi + 1e-9,
            `${region}_${axis} at ${total.toFixed(3)} drives ${seg} to ${v.toFixed(3)}, outside [${lo}, ${hi}]`);
        }
    }
});

test('every clip activates muscles that exist', () => {
  for (const key of MOTION_KEYS)
    for (const k of MOTION[key].keys)
      for (const [name, v] of Object.entries(k.act ?? {})) {
        assert.ok(REG.byName.has(name), `${key} activates "${name}", which was not built`);
        assert.ok(v >= 0 && v <= 1, `${key}/${name}: activation ${v} is outside 0..1`);
      }
});

test('every clip has ordered keys, a breath pattern and stated provenance', () => {
  for (const key of MOTION_KEYS) {
    const m = MOTION[key];
    assert.ok(m.keys.length >= 2, `${key}: a clip needs at least two keys`);
    assert.equal(m.keys[0].t, 0, `${key}: must start at t=0`);
    assert.equal(m.keys[m.keys.length - 1].t, 1, `${key}: must end at t=1`);
    for (let i = 1; i < m.keys.length; i++)
      assert.ok(m.keys[i].t > m.keys[i - 1].t, `${key}: keys must be strictly increasing`);
    assert.ok(m.duration >= 1000, `${key}: duration`);
    assert.ok(m.phases?.length, `${key}: no breath phases`);
    for (const p of m.phases) {
      assert.ok(BREATH[p.breath], `${key}: unknown breath "${p.breath}"`);
      assert.ok(p.at >= 0 && p.at <= 1, `${key}: phase at ${p.at}`);
      for (const lang of LANGS) assert.ok(p[lang], `${key}: phase missing ${lang}`);
    }
    // the pose over time is authored; the app must never imply otherwise
    assert.equal(m.provenance, 'handkeyed', `${key}: provenance must be stated`);
    if (m.limitation)
      for (const lang of LANGS) assert.ok(m.limitation[lang], `${key}: limitation ${lang}`);
  }
});

test('sampling a clip interpolates and clamps', () => {
  const s0 = sample('hundred', 0);
  const s1 = sample('hundred', 1);
  const half = sample('hundred', 0.5);
  assert.ok(s0 && s1 && half);
  assert.ok(Math.abs(sample('hundred', -3).coordinates.thoracic_flex -
                     s0.coordinates.thoracic_flex) < 1e-9, 'clamps below 0');
  assert.ok(Math.abs(sample('hundred', 9).coordinates.thoracic_flex -
                     s1.coordinates.thoracic_flex) < 1e-9, 'clamps above 1');
  // and the interpolation actually moved: the curl is deeper halfway through
  assert.ok(half.coordinates.thoracic_flex > s0.coordinates.thoracic_flex,
    'the chest lift should deepen through the exhale');
  assert.ok(phaseAt('hundred', 0.9).breath === 'out');
});

test('every exercise with instruction either has a clip or is honest about it', () => {
  // not every exercise needs one, but the panel has to be able to say which
  const withClips = EXERCISE_KEYS.filter(k => MOTION[k]);
  assert.ok(withClips.length >= 6, `only ${withClips.length} exercises have movement clips`);
  for (const k of MOTION_KEYS) assert.ok(EXERCISE[k], `clip "${k}" has no exercise`);
});

/* ---------------------------------------------------------------------- rig */

test('the rig is a tree with one root and no cycles', () => {
  const segs = rig.segments;
  const roots = Object.values(segs).filter(s => !segs[s.parent]);
  assert.equal(roots.length, 1, `expected one root segment, got ${roots.map(r => r.name)}`);
  for (const name of Object.keys(segs)) {
    const seen = new Set();
    let cur = name;
    while (cur && segs[cur]) {
      assert.ok(!seen.has(cur), `cycle through ${cur}`);
      seen.add(cur);
      cur = segs[cur].parent;
    }
  }
});

test('the rig registration is measured and close', () => {
  const r = rig.registration;
  assert.ok(r.bones.length >= 5, 'at least five shared bones');
  assert.ok(r.residualMm.mean < 25, `residual ${r.residualMm.mean} mm is too large`);
  // 1 / standing height, give or take the pose difference between the two models
  assert.ok(r.scale > 0.4 && r.scale < 0.8, `scale ${r.scale} is not plausible`);
  assert.ok(rig.citation.includes('Rajagopal'), 'the model must be cited');
});

test('every bound mesh names a segment that exists', () => {
  for (const [key, seg] of Object.entries(rig.binding))
    assert.ok(rig.segments[seg], `${key} is bound to "${seg}", which is not a segment`);
});

test('muscle paths carry published parameters and land on real segments', () => {
  assert.ok(paths.muscles.length >= 50, 'the model should carry its full actuator set');
  for (const m of paths.muscles) {
    assert.ok(m.points.length >= 2, `${m.name}: a path needs at least two points`);
    for (const p of m.points)
      assert.ok(rig.segments[p.body] || p.body === 'ground',
        `${m.name}: path point on unknown body "${p.body}"`);
    assert.ok(m.maxIsometricForce > 0, `${m.name}: no max isometric force`);
    assert.ok(m.optimalFiberLength > 0, `${m.name}: no optimal fibre length`);
    if (m.mapsTo)
      assert.ok(REG.byName.has(m.mapsTo), `${m.name} maps to unknown "${m.mapsTo}"`);
  }
  const mapped = new Set(paths.muscles.filter(m => m.mapsTo).map(m => m.mapsTo));
  assert.ok(mapped.size >= 20, `only ${mapped.size} muscles have a path model`);
});

/* ----------------------------------------------------------------- reviewer */

test('a reviewed exercise names a real person and an unreviewed one says so', () => {
  const reviewed = EXERCISE_KEYS.filter(k => EXERCISE[k].reviewed);
  assert.ok(reviewed.length > 0, 'the instructor sign-off should be recorded');
  for (const k of reviewed) {
    const r = EXERCISE[k].reviewed;
    assert.ok(r.by && r.by.length > 3, `${k}: reviewer needs a name`);
    assert.ok(r.date, `${k}: a sign-off needs a date`);
    // credential may be null — it was not supplied and inventing one would be worse
    assert.ok(r.credential === null || typeof r.credential === 'string');
  }
  // everything Pilates is the reviewer's remit; everything else is honestly unreviewed
  for (const k of EXERCISE_KEYS)
    if (EXERCISE[k].discipline === 'pilates')
      assert.ok(EXERCISE[k].reviewed, `${k} is Pilates and should carry the sign-off`);
});

/* -------------------------------------------------------- the nervous system */

test('the nervous layer exists and carries the routes the traversal needs', () => {
  const nerves = generated.structures.filter(s => s.layer === 'nervous');
  assert.ok(nerves.length >= 10, `only ${nerves.length} nerve structures were built`);
  const names = new Set(nerves.map(n => n.name));
  for (const need of ['spinal cord', 'spinal nerve roots', 'brachial plexus', 'lumbar plexus',
                      'sacral plexus', 'sciatic nerve', 'femoral nerve', 'median nerve'])
    assert.ok(names.has(need), `the nervous layer is missing "${need}"`);
});

test('the nervous layer records its own source and licence', () => {
  // it comes from Z-Anatomy rather than BodyParts3D, and CC BY-SA needs the attribution
  const src = generated.sources?.nervous;
  assert.ok(src, 'no source record for the nervous layer');
  assert.match(src.attribution, /Z-Anatomy/);
  assert.match(src.licence, /CC BY-SA/);
  assert.ok(src.registration.residual_mm < 25,
    `nervous registration residual ${src.registration.residual_mm} mm is too large`);
});


/* ------------------------------------------------------------- the groups */

const groupTable = JSON.parse(
  readFileSync(new URL('../src/generated/groups.json', import.meta.url)));

test('every offered group resolves to structures this atlas has', () => {
  const reg = buildRegistry(generated, { brain: true });
  buildGroups(groupTable, reg.byId, LAYER_ORDER);
  const list = groups().list;
  assert.ok(list.length > 50, `only ${list.length} groups were offered`);
  for (const g of list) {
    assert.ok(g.members.length >= 2, `${g.fma} ${g.name.en} has ${g.members.length} member(s)`);
    for (const id of g.members) assert.ok(reg.byId.has(id), `${g.fma} names unknown ${id}`);
    assert.ok(g.layers.length, `${g.fma} ${g.name.en} resolves to no layer`);
    const known = new Set(GROUP_REGIONS.map(r => r.id));
    assert.ok(known.has(g.region), `${g.fma} is filed under unknown region ${g.region}`);
  }
});

test('a group named after a muscle family speaks the same Korean as its members', () => {
  /* The atlas names muscles in the Sino-Korean clinical register the studio's
   * own entries use -- 대퇴이두근, 복직근, 요방형근 -- and the groups were first
   * written in the revised native-Korean terms instead: 넙다리 뒤칸, 볼기근,
   * 가시근. Both are correct Korean. Together they are two dialects in one
   * panel, and a coach pressing the group would see three muscles named in the
   * other one.
   *
   * Where a group *is* a muscle family, the two are now checkable against each
   * other: the group's Korean has to appear inside at least one member's. That
   * is what 극근 in 흉극근 means, and it is exactly what was wrong before.
   */
  const reg = buildRegistry(generated, { brain: true });
  buildGroups(groupTable, reg.byId, LAYER_ORDER);
  const byFma = groups().byFma;
  const FAMILIES = {
    FMA13354: 'intercostal', FMA77177: 'iliocostalis', FMA77178: 'longissimus',
    FMA77179: 'spinalis', FMA22823: 'semispinalis', FMA77180: 'splenius',
    FMA23081: 'rotatores', FMA13400: 'serratus posterior', FMA64922: 'gluteal',
    FMA19083: 'obturator', FMA37349: 'pectoral', FMA64829: 'scalene',
  };
  for (const [fma, what] of Object.entries(FAMILIES)) {
    const g = byFma.get(fma);
    assert.ok(g, `the curation no longer offers the ${what} group (${fma})`);
    const stem = g.name.ko.replace(/\s/g, '');
    const kos = g.members
      .map(id => reg.byId.get(id))
      .filter(r => r.name.ko !== r.name.en)
      .map(r => r.name.ko);
    assert.ok(kos.length, `no member of ${what} carries a Korean name to check against`);
    assert.ok(kos.some(k => k.includes(stem)),
      `the ${what} group is called ${g.name.ko}, but its members are ` +
      `${kos.join(', ')} — two Korean registers in one panel`);
  }
});

test('no group is offered in English where the atlas has Korean', () => {
  const reg = buildRegistry(generated, { brain: true });
  buildGroups(groupTable, reg.byId, LAYER_ORDER);
  for (const g of groups().list) {
    assert.match(g.name.ko, /[가-힣]/, `${g.fma} ${g.name.en} has no Hangul`);
    assert.notEqual(g.name.ko, g.name.en, `${g.fma} falls back to English in Korean`);
  }
});

/* ----------------------------------------------------------- Korean coverage
 *
 * The studio teaches in Korean, and until KO_NAME existed only a hundred and
 * twelve of the four hundred and seventy records had a Korean name. The rest
 * fell back to `titleCase(name)` for *both* languages, which put an English word
 * on the label and — because the search box indexes `name.ko` — meant that
 * typing 요추 matched nothing while typing "lumbar" matched five vertebrae.
 */

/* The layers a class is taught out of, against the layers imported wholesale from
 * BodyParts3D 4.0 to fill the atlas out. Every structure a coach cues is in the
 * first set and every one of them is named in Korean; the second set is five
 * hundred arteries, veins and ducts that arrived with English names and have not
 * been written yet, which is a stated gap rather than a hidden one. */
const TAUGHT = new Set(['skeleton', 'muscles_superficial', 'muscles_deep',
                        'organs', 'nervous', 'brain']);

test('every structure a class is taught out of has a Korean name', () => {
  const english = [];
  for (const rec of REG.byId.values()) {
    if (!TAUGHT.has(rec.layer)) continue;
    if (!/[가-힣]/.test(rec.name.ko) || rec.name.ko === rec.name.en)
      english.push(`${rec.layer}: ${rec.name.en}`);
  }
  assert.deepEqual(english, [],
    `${english.length} structures still read in English in the Korean UI`);
});

test('the imported layers are counted, not quietly left in English', () => {
  /* No assertion that they are all named — they are not. What this holds is that
   * the number is known and that the taught atlas is not quietly shrinking into
   * it: if a layer moves from taught to imported, the count above catches it and
   * this one records what it cost. */
  let imported = 0, named = 0;
  for (const rec of REG.byId.values()) {
    if (TAUGHT.has(rec.layer)) continue;
    imported++;
    if (/[가-힣]/.test(rec.name.ko) && rec.name.ko !== rec.name.en) named++;
  }
  assert.ok(imported > 0, 'the imported layers have vanished from the atlas');
  assert.ok(REG.byId.size - imported >= 470,
    `only ${REG.byId.size - imported} taught structures left — the atlas is being ` +
    `moved into the imported layers rather than added to`);
});

test('no two structures answer to the same Korean name', () => {
  /* Hangul drops the Chinese characters that separated 寛骨 from 顴骨 and 腓骨
   * from 鼻骨, so distinct structures can collide into one name. A collision is
   * not cosmetic: the search box matches on substrings, and two structures with
   * one name are two rows a coach cannot tell apart. */
  /* Within one atlas. A reader is looking at the taught body or at the complete
   * one, never at both — `setAtlasDepth` turns one off to turn the other on — so
   * what has to be unambiguous is each of them on its own. Across the two, 척추
   * naming the taught sacrum and 4.0's sacrum is the same bone twice, which is
   * the whole point of there being two sets. */
  for (const set of ['taught', 'complete']) {
    const byKo = new Map();
    for (const rec of REG.byId.values()) {
      if ((rec.set ?? 'taught') !== set) continue;
      const hit = byKo.get(rec.name.ko);
      assert.equal(hit, undefined,
        `in the ${set} atlas, ${rec.name.ko} is both ${hit?.name.en} and ${rec.name.en}`);
      byKo.set(rec.name.ko, rec);
    }
  }
});

test('the Korean name table covers what has no written entry, and nothing else', () => {
  /* A key here that MUSCLE_INFO also has would be a second Korean name for one
   * muscle, and which one wins would depend on the order of two `??`. A key here
   * that no structure has is a name for something the build does not emit —
   * dead the moment a rebuild renames it. */
  for (const key of Object.keys(KO_NAME)) {
    assert.equal(MUSCLE_INFO[key], undefined,
      `${key} has a written entry, so KO_NAME must not name it a second time`);
    assert.ok(REG.byName.has(key), `KO_NAME names ${key}, which the atlas does not have`);
  }
  /* The count, printed rather than asserted, so a reader of the run knows how much
   * of the atlas is still English without the suite failing over content that was
   * imported on purpose and is honestly labelled. */
  const uncovered = [...REG.byName.keys()]
    .filter(k => !k.startsWith('brain:') && !MUSCLE_INFO[k] && !KO_NAME[k]
                 && !REG.byName.get(k).parts
                 && TAUGHT.has(REG.byName.get(k).layer));
  assert.deepEqual(uncovered, [], 'structures with neither a written entry nor a Korean name');
});

test('a muscle names its nerve the way the nerve names itself', () => {
  /* The twenty nerves in the nervous layer are selectable structures with names
   * of their own. A muscle whose innervation reads 노신경 next to a nerve called
   * 요골신경 is the same nerve twice under two names — correct Korean both times,
   * and unusable, because a coach cannot tell that they are one thing. */
  const nerveKo = new Map();
  for (const rec of REG.byId.values())
    if (rec.kind === 'nerve') nerveKo.set(rec.name.en.toLowerCase(), rec.name.ko);
  let checked = 0;
  for (const [key, m] of Object.entries(MUSCLE_INFO)) {
    const en = m.innervation?.nerves?.en?.toLowerCase();
    const want = en && nerveKo.get(en);
    if (!want) continue;
    checked++;
    assert.equal(m.innervation.nerves.ko, want,
      `${key} calls ${m.innervation.nerves.en} "${m.innervation.nerves.ko}", ` +
      `but the nerve itself is called "${want}"`);
  }
  assert.ok(checked >= 20, `only ${checked} muscles name one of the drawn nerves outright`);
});

test('a Korean search term finds the structures it names', () => {
  /* The point of all of the above, stated as the thing a coach actually does.
   * `searchText` is what the Explore box filters on, so this is that search. */
  const find = q => [...REG.byId.values()]
    .filter(r => searchText(r).includes(q.toLowerCase()));
  const cases = [
    ['요추', 5, r => r.kind === 'bone'],          // five lumbar vertebrae
    ['늑골', 12, r => r.kind === 'bone'],         // twelve ribs
    ['추간판', 23, r => r.kind === 'bone'],       // every disc the build emits
    ['요골신경', 1, r => r.kind === 'nerve'],     // the radial nerve itself
    ['대퇴골', 1, r => r.kind === 'bone'],
    ['방광', 1, r => r.kind === 'organ'],
    ['횡격막', 1, r => r.kind === 'muscle'],
  ];
  for (const [q, least, isKind] of cases) {
    const hits = find(q).filter(isKind);
    assert.ok(hits.length >= least,
      `searching ${q} found ${hits.length} of the expected ${least}`);
  }
  assert.equal(find('요추').filter(r => r.kind === 'bone')
    .some(r => r.name.ko === '제5요추'), true, 'searching 요추 does not offer L5');
});
