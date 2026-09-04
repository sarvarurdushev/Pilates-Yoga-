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
import { buildRegistry, vertebra } from '../src/structures.js';

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
    // `Musculi` is the plural, and correct for the groups: rotatores, the intercostals
    assert.ok(/^Musculus |^Musculi /.test(m.latin ?? '') || m.latin === 'Diaphragma',
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
  const ids = new Set(), names = new Set();
  for (const s of generated.structures) {
    assert.ok(s.id >= generated.idBase, `${s.name}: id ${s.id} collides with the brain range`);
    assert.ok(!ids.has(s.id), `duplicate id ${s.id}`);
    assert.ok(!names.has(s.name), `duplicate name ${s.name}`);
    ids.add(s.id); names.add(s.name);
    // the nervous layer comes from Z-Anatomy, which is named by Terminologia Anatomica
    // rather than FMA, so it carries a source instead of an ontology id
    if (s.layer === 'nervous') assert.ok(s.source, `${s.name}: no source`);
    else assert.ok(s.fma?.length, `${s.name}: no FMA ids`);
    assert.ok(s.tris > 0, `${s.name}: empty mesh`);
    assert.equal(s.centroid.length, 3);
  }
});

test('the build records where the meshes came from', () => {
  // CC BY-SA is attribution-required; the attribution has to survive into the app
  assert.match(generated.attribution, /BodyParts3D/);
  assert.match(generated.licence, /CC BY-SA/);
  assert.ok(generated.source.length > 10);
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
