# Neuro Wellness — project brief

> **This file is the prompt.** It replaces a long pasted brief. Read it end to end before
> touching code, then read `CLAUDE.md` (inherited from neurolab, still accurate for the brain
> half). Do not re-explore the repo to rediscover what is written here.

---

## 0. Token discipline — read this first

This repo is inherited from a working project. Most of what you need is already described
below. To avoid burning context re-deriving it:

**Read these files (they are the load-bearing ones):**
- `src/frame.js` (13 lines) — the canonical coordinate frame
- `src/brainMaterial.js` (95) — the per-vertex region-id shader. **You will be extending this.**
- `src/deepStructures.js` (73) — how segmented structures are loaded and tinted
- `scripts/glb_common.py` (59) — GLB writer + label-preserving decimation. **Reuse verbatim.**
- `scripts/build_cortex.py` (200) — the pattern every asset build should follow
- `src/regionData.js` (323) — the bilingual content model. **Copy the shape, not the content.**
- `src/report.js` (167) — the printable take-home generator

**Skim only if the task touches them:** `src/main.js` (601 — viewer, labels, picking, camera),
`src/ui.js` (405), `src/assessment/*` (English test scoring — probably not reusable),
`server/*` (auth, encrypted-field storage, Postgres — reusable as-is).

**Do not read:** `vendor/` (three.js), `package-lock.json`, `src/console/*`.

---

## 1. What this project is

A **whole-body 3D anatomy explorer that explains how exercise changes the brain.**

Two halves that must meet in the middle:

1. **The body.** An anatomically real, navigable human model — skeleton, muscles (named,
   individually selectable, with origin/insertion/action), organs, nervous system, at a level
   of detail where a user can click any muscle and learn what it does.
2. **The link.** For a given exercise — a Pilates Hundred, a back squat, a CrossFit thruster —
   show which muscles do the work, which nerves carry the command, which brain structures issue
   and refine it, and what the evidence says that exercise does to the brain over time.

**Primary discipline: Pilates.** It is the deepest and most detailed content vertical. Gym /
resistance training, CrossFit / high-intensity, and endurance / mobility / balance are also
covered but at lower resolution. Pilates is first because it is the most *interesting* case
neurologically — it is explicitly a motor-control and interoception practice, not a metabolic
one, so the brain story is the whole story rather than a footnote.

The brain model from neurolab is **already built and already correct**. It is the anchor. The
body is the new work.

---

## 2. What you inherit, concretely

| Asset | State | Reuse |
|---|---|---|
| `models/cortex.glb` (7.5 MB) | fsaverage white→pial surface, Desikan-Killiany ids baked per vertex | **As-is.** This is the brain. |
| `models/subcortical.glb` (2.2 MB) | cerebellum, brainstem, hippocampus, amygdala, thalamus, basal ganglia, ventricles, corpus callosum, marching-cubed from `aseg.mgz` | **As-is**, but you will add structures (see §7) |
| `src/frame.js` | canonical frame + `mni()` converter | Extend, don't replace (§5) |
| `src/brainMaterial.js` | flat per-vertex region id → palette lookup, hover/select/atlas/x-ray/cutaway | **Rewrite the palette to a texture** (§6). Keep everything else. |
| `scripts/glb_common.py` | GLB writer + quadric decimation that preserves integer labels by nearest-neighbour | **Verbatim.** This solves a problem you will otherwise hit. |
| `src/main.js` label layout | screen-space label placement with lanes, collision, leader ropes, drop-if-unplaceable | Reuse the algorithm. It is better than it looks and was iterated on. |
| `src/main.js` `captureStage()` | renders WebGL + HTML labels into one PNG for the report | Reuse. |
| `src/report.js` | pure `buildReportHTML({result, lang, image})` → printable A4 HTML | Reuse the pattern wholesale. |
| `server/` | Express 5 + Postgres, session auth, AES field encryption for PII | Reuse as-is if you need accounts. |
| `src/assessment/` | English-test scoring for children | **Probably dead weight here.** Read `scoring.js` for the *pattern* — every score carries its own arithmetic — then likely delete. |

---

## 3. The line that must not move

neurolab has one: *this is a template brain, not the child's brain.* This project inherits that
and adds three more. All four go in `UI.disclaimer` equivalents, in **English and Korean**, and
are rendered where the user actually is, not buried in a footer.

1. **Template, not you.** The body is a reference anatomy — a specific cadaver/scan-derived
   template. It is not the user's body. Muscle sizes, insertions and proportions vary between
   real people. Nothing here is a scan of anyone using the app.
2. **Not medical advice.** No diagnosis, no treatment, no rehab prescription. Anyone with pain,
   injury, pregnancy, or a medical condition is told to see a professional — and every exercise
   carries its own contraindication note.
3. **Population averages, not personal prediction.** "Aerobic exercise increases hippocampal
   volume" is a group mean from a trial. It is not a promise about the person reading it. Effect
   sizes and populations studied must be visible, not hidden behind a confident sentence.
4. **Evidence is graded and the grade is shown.** See §10. A claim from a meta-analysis and a
   claim extrapolated from mice do not get to look the same on screen.

**This is the single highest risk in the project.** "Exercise rewires your brain" is a genre
absolutely saturated with confident nonsense. The thing that makes this app worth building is
that it refuses to do that. Build the evidence-grading in from commit one — it is not a polish
step, it is the architecture.

---

## 4. Where to get every 3D asset

Nothing is hand-modelled. Same rule as the brain. Every source below is real, checked, and
free; the licence column is the part that matters.

### 4.1 Body, muscles, bones, organs — the primary source

**BodyParts3D / Anatomography** (Database Center for Life Science, Japan)
- What: ~3,000 individually segmented anatomical parts derived from MRI of a Japanese male.
  Muscles, bones, organs, vessels, nerves. **Every file is named by its FMA ontology id**
  (`FMA<id>.stl`), which gives you a free, standard, machine-readable identifier for every
  structure — this is the equivalent of the Desikan-Killiany labels for the brain.
- Licence: **CC BY-SA 2.1 Japan.** Attribution required, share-alike. Check the share-alike
  implications for your product before shipping — it may oblige you to license derived model
  files the same way. Ask the user about this explicitly.
- Get it: primary site `lifesciencedb.jp/bp3d`; a convenient full git mirror is
  `github.com/Kevin-Mattheus-Moerman/BodyParts3D`.
- Format: STL / OBJ per part. No rigging, no textures, no hierarchy beyond the FMA tree.

**Z-Anatomy** — the curated, cleaned-up derivative
- What: BodyParts3D reworked into a navigable Blender atlas with the full **Terminologia
  Anatomica** naming (Latin + English), organised hierarchy, and cleaned meshes. Usually a much
  better starting point than raw BodyParts3D because the naming and grouping work is done.
- Licence: **CC BY-SA 4.0.**
- Get it: `github.com/Z-Anatomy/The-blend` (Blender template) and
  `github.com/Z-Anatomy/Models-of-human-anatomy`. Also on SimTK and Zenodo.
- Use it to derive the structure hierarchy and the bilingual names; export per-structure meshes
  from Blender to feed your Python build.

### 4.2 Muscle function and biomechanics — the part BodyParts3D cannot give you

**OpenSim** (Stanford NMBL) — musculoskeletal simulation
- What: rigid-body skeletons with **muscle–tendon actuators defined as paths** (origin → via
  points → insertion), with published moment arms, optimal fibre lengths, pennation angles and
  max isometric forces. This is where "which muscles does this movement use, and how much" comes
  from as *physics* rather than as a blog claim.
- Key model: **Rajagopal et al. 2016 full-body model** (80 lower-limb muscle–tendon units,
  full-body skeleton). Newer variants add calibrated passive forces and improved hip abductor
  paths.
- Licence: Apache 2.0 (software); models generally freely redistributable — verify per model.
- Get it: `simtk.org/projects/fbmodpassivecal`, `simtk.org/home/full_body`, and
  `github.com/opensim-org/opensim-core`. Models are `.osim` (XML) — parseable directly in Python.
- **This is the source of truth for muscle attachment points and lines of action.** Parse the
  `.osim`, extract each muscle's path points in the model's frame, register that frame to your
  body frame, and you have an animatable muscle model that is *derived from published
  biomechanics* rather than drawn by hand.
- Limitation to be honest about: OpenSim full-body models are strongest in the lower limb and
  trunk; upper-limb and deep-core detail is thinner. Supplement with literature, and mark
  anything you infer.

### 4.3 Skin, body shape, and a rigged character

**MakeHuman** — parametric human, CC0 meshes
- Licence: **the generated meshes are CC0** (the application is AGPL). This is the cleanest
  licence in the whole stack — use it for the outer skin/body layer where share-alike would be
  awkward.
- Get it: `makehumancommunity.org`. Exports rigged (including a Mixamo-compatible rig).

**Avoid SMPL / SMPL-X** for anything shipping: patented, owned by Max-Planck, commercial use
requires a Meshcapade licence. Fine for research prototypes only, and only if the user says so.

### 4.4 Motion — making the body actually move

**Mixamo** (Adobe) — free rigged characters + a large animation library, **royalty-free for
commercial use**, no subscription. `mixamo.com`. Squats, lunges, push-ups, stretches exist;
Pilates-specific mat work largely does not — you will have to author those.

**Authoring exercise motion, in order of preference:**
1. **OpenSim inverse kinematics** from published motion-capture — most defensible, gives you
   joint angles that are physically real and muscle lengths that follow automatically.
2. **Hand-keyed in Blender** against video reference, reviewed by a qualified instructor. For
   Pilates this is likely unavoidable. Budget for it and credit the reviewer.
3. **Mixamo retargeting** for generic gym movements.
4. **MediaPipe / BlazePose** on video to bootstrap a rough joint trajectory, then clean up. Also
   the obvious path if you ever want "record yourself and compare" as a feature.

**Motion-capture datasets** worth checking before authoring anything: CMU Graphics Lab Motion
Capture Database (free, permissive), AMASS (research licence — check before shipping), and
fitness-specific sets like Fit3D and MM-Fit (verify licences individually; several are
research-only).

### 4.5 If you need organs from real imaging

**TotalSegmentator** — nnU-Net segmenting 100+ structures (27 organs, 59 bones, 10 muscles,
8 vessels) from whole-body CT. Apache 2.0 weights, `pip install totalsegmentator`,
`github.com/wasserth/TotalSegmentator`. **Caveat: the `tissue_types` task (subcutaneous fat,
skeletal muscle, visceral fat) is non-commercial licensed** — do not ship that one without
checking. Use this only if BodyParts3D detail is insufficient; you would also need a licensable
CT volume, which is its own problem.

**Open Anatomy Project** (`openanatomy.org`, Brigham/SPL) — MRI/CT-derived labelled atlases,
free for research and education. Good for organ detail and for cross-checking BodyParts3D.

### 4.6 Additional brain atlases, if the exercise story needs finer parcels

The current brain carries Desikan-Killiany (34 parcels/hemisphere) plus aseg subcortical. For
exercise you will want more motor detail than that. All are free, all are FreeSurfer- or
FSL-compatible, all can be baked in with the existing `build_cortex.py` pattern:
- **Human Motor Area Template (HMAT)** — M1, S1, SMA, pre-SMA, PMd, PMv as separate parcels.
  Directly what you need; DK lumps these.
- **SUIT** / **Buckner 7-network cerebellar atlas** — the cerebellum is currently one blob.
  Motor cerebellum (lobules V/VI/VIII) is a *different place* from cognitive cerebellum
  (lobules VI/VII crus I–II), and the exercise story depends on that distinction.
- **HCP-MMP1 (Glasser 2016)** — 180 parcels/hemisphere if you want maximum resolution.
- **Harvard-Oxford subcortical** — alternative subcortical parcellation.
- **Brainstem substructures** (FreeSurfer 7 module) — for locus coeruleus / raphe / PAG-level
  claims about arousal and exercise. Note the LC is at the edge of what MRI resolves; be careful.

---

## 5. The coordinate frame — solve this before anything else

neurolab's frame is `+X LEFT, +Y SUPERIOR, +Z ANTERIOR`, right-handed, **A-P length of the brain
normalised to 1.0**, with `FRAME.center` / `FRAME.scale` emitted by `build_cortex.py`.

That normalisation is wrong for a body. Do this:

- **Keep the axis convention identical** (`+X LEFT, +Y SUPERIOR, +Z ANTERIOR`). Do not flip
  anything. Every existing file assumes it.
- **Introduce `BODY_FRAME`** in `src/frame.js`: origin at a defined anatomical landmark —
  recommend the **midpoint of the two ASIS** (anterior superior iliac spines) or the S1 endplate,
  both of which are identifiable in every source model — and scale so **standing height = 1.0**.
- **Keep `FRAME` (the brain frame) exactly as it is**, and add a single `brainToBody` similarity
  transform (scale + rotation + translation, no shear) computed once from skull landmarks and
  stored as constants, exactly like `FRAME.center`/`FRAME.scale` are today.
- Write a test that asserts a known landmark round-trips through both frames. Frame bugs are
  silent, expensive, and discovered late.
- `mni()` stays valid — it converts published MNI millimetres into the *brain* frame. Compose
  with `brainToBody` when you need MNI coordinates in body space.

---

## 6. The region-id architecture — the thing that will break if you copy neurolab naively

neurolab bakes an integer region id into every vertex as a `_REGION` attribute and looks up a
colour in a **`uColors[16]` uniform array**. Ids 1–15 are all taken. `CLAUDE.md` says a
sixteenth region means widening the array.

**A whole body has hundreds to thousands of named structures. Sixteen is not close.**

The replacement, which keeps everything else about the approach:

- Keep `_REGION` as a **per-vertex integer id**. It is the right design and it makes every
  structure pickable from a single merged mesh with one raycast.
- **Derive the id from the FMA id** where possible, via a lookup table generated at build time,
  so ids are stable, meaningful, and traceable back to a standard ontology. Store the
  `FMA id ↔ local id ↔ name(en/ko)` table as build output, not hand-maintained.
- **Replace `uColors[16]` with a palette `DataTexture`** — an `N × 1` RGBA texture where texel
  `i` is the colour of region `i`. Look up with `texelFetch(uPalette, ivec2(id, 0), 0)` (WebGL2 /
  three.js `GLSL3`). This scales to thousands of ids at no cost.
- **Replace `uActive[16]` the same way** — a second `N × 1` texture (or pack activation into the
  palette's alpha channel). This is what will carry per-muscle activation level during an
  animated exercise, and it needs to update per frame, so keep it a texture you can write into
  cheaply.
- **The `flat` qualifier on the region varying is still mandatory.** Interpolating an id across a
  triangle spanning two structures yields a fraction that indexes an unrelated third structure.
  This bug already bit once in neurolab; it will bite ten times harder with a thousand ids.
- **Never let a mesh compressor touch `_REGION`.** `CLAUDE.md` records that `gltf-transform`'s
  `weld()`/`simplify()` throw on these files, and that decimation is done in Python precisely so
  labels are transferred by nearest neighbour instead of averaged. The same applies to Draco:
  its lossy quantisation on a custom attribute produces fractional ids. Store `_REGION` as an
  unquantised `UNSIGNED_SHORT` accessor and leave it alone. `scripts/glb_common.py` already does
  the right thing — extend it, don't work around it.

---

## 7. The asset build pipeline

Mirror `scripts/build_cortex.py` exactly in spirit: **a Python script that takes published source
data and emits a GLB with ids baked in, printing a per-structure vertex/triangle/percentage
table so a regression is visible in the diff.**

Write these:

- `scripts/build_skeleton.py` — bones from BodyParts3D/Z-Anatomy, one region id per bone,
  grouped into a joint hierarchy.
- `scripts/build_muscles.py` — muscle meshes, one region id per named muscle, tagged by
  functional group (agonist groups, myofascial chains).
- `scripts/build_organs.py` — viscera, cardiovascular, respiratory.
- `scripts/build_nervous.py` — spinal cord, major peripheral nerves, plexuses. This is the
  bridge between body and brain and is the most valuable and most neglected layer in every
  competing product. Prioritise it.
- `scripts/parse_opensim.py` — extract muscle path points, attachment sites and parameters from
  `.osim` into JSON in body-frame coordinates.

Rules, all inherited and all learned the hard way:
- **Per-structure triangle budgets**, like `BUDGET` in `build_subcortical.py`. A vertebra needs
  detail; a kidney does not. Total budget matters more than any single mesh.
- **Decimate in Python** with `glb_common.decimate` so labels survive.
- **Taubin smoothing, not Laplacian**, for anything marching-cubed — plain Laplacian visibly
  shrinks structures (`build_subcortical.py` has the working implementation).
- **Layer the output into separate GLBs loaded on demand**: `skeleton.glb`, `muscles_superficial.glb`,
  `muscles_deep.glb`, `organs.glb`, `nervous.glb`, `skin.glb`. Do not ship one 200 MB file. The
  brain is already two files for this reason.
- **Budget: keep the first meaningful paint under ~15 MB.** Load the rest progressively.

---

## 8. Rendering, interaction, presentation

Inherit from `main.js` and extend:

- **Modes.** neurolab has Anatomical / X-ray / Inside / Cutaway. A body needs a **layer stack**
  instead: skin → superficial muscle → deep muscle → skeleton → organs → nerves, each
  independently toggleable with an opacity slider. The cutaway clip plane already works and
  should stay.
- **Picking** scales as-is: raycast the merged mesh, read `_REGION` at the hit face. Keep it.
- **Labels**: reuse the lane-based layout from `main.js` unchanged. It gates on projected size,
  places in priority order, pushes colliders outward, and drops what it cannot place.
  `CLAUDE.md` explicitly warns against replacing it with a naive vertical nudge.
- **Camera**: `flyTo` needs the same fixed-vantage special case for bilateral structures that
  the brain needed — a paired muscle's centroid is on the midline and the direction degenerates.
- **A body needs standard anatomical views** the brain did not: anterior, posterior, lateral,
  superior, plus per-region presets. Add a view bar.
- **Muscle activation visualisation.** During an exercise, drive the activation texture per
  frame. Use a **sequential colour ramp with a legend and a numeric scale**, not an unlabelled
  red glow — an unlabelled heat glow is exactly the kind of thing that reads as data while
  meaning nothing. Say what the number is (predicted normalised activation from the OpenSim
  model? EMG amplitude from a cited study? state which).
- **The muscle line-of-action overlay**: render OpenSim muscle paths as swept tubes whose radius
  and colour track activation. This is the animatable, physiologically-grounded representation;
  the detailed mesh is the anatomical one. Show both, let the user switch.

---

## 9. Animation

Two representations, because one cannot do both jobs:

1. **Rigid-body skeleton.** Bones do not deform. Parent each bone mesh to a joint in a
   hierarchy and animate joint rotations. No skinning required — this is both easier and more
   anatomically correct than skinning a bone mesh.
2. **Muscle paths.** Animate as OpenSim-style origin → via-point → insertion polylines that
   follow the bones. Muscle length falls out of the geometry; activation comes from the exercise
   data. Optionally skin the detailed muscle meshes to the same rig for visual quality, but keep
   the path model as the source of truth for anything numeric.

Animation data lives as joint-angle timelines (`.bvh`, glTF animation clips, or OpenSim `.mot`).
Each exercise gets: a clip, a tempo, breath-phase markers (**essential for Pilates** — the breath
pattern is not decoration, it is part of the exercise), and per-phase activation keyframes.

Scrubbing matters more than playback. A user needs to stop at the top of the movement and ask
what is firing. Build the timeline scrubber early.

---

## 10. The content model — the actual intellectual work

Copy the *shape* of `REGION_INFO` in `src/regionData.js`: every entry carries the same fact in
two registers — `does` (plain language, readable aloud) and `sci` (clinical terms) — in `en` and
`ko`, plus a `fact` hook. That dual-register design is why the brain app works for both a parent
and a teacher. Keep it.

Four new content tables:

### `MUSCLE_INFO`
Per muscle: FMA id, name (en/ko/Latin), origin, insertion, **innervation with nerve root levels**
(this is the anatomical bridge to the nervous system layer), actions, antagonists, synergists,
common dysfunction, and what it feels like when it works. Innervation is what lets a user click
a muscle and travel *up the nerve into the spinal cord and into the brain* — that traversal is
the app's best feature and almost nothing else on the market does it.

### `EXERCISE`
Per exercise: name, discipline (pilates/gym/crossfit/…), Pilates apparatus if relevant (mat,
reformer, cadillac, chair, barrel), difficulty, setup, cueing, breath pattern, tempo, common
faults and their corrections, **contraindications**, progressions and regressions, and the muscle
list split into **prime movers / synergists / stabilisers**, each with an evidence marker: a
citation to an EMG study where one exists, or an explicit "inferred from biomechanics, no direct
EMG" flag where it does not. Do not silently present inference as measurement. For most Pilates
mat work there is no EMG study; say so.

### `EXERCISE_BRAIN` — handle with care
The claims linking exercise to brain change. Each entry:
`{ claim, mechanism, structures[], evidence_tier, citation, effect_size, population, human|animal, acute|chronic }`.

**Evidence tiers, shown in the UI, never hidden:**
- **A** — meta-analysis or multiple human RCTs
- **B** — one human RCT, or consistent human observational evidence
- **C** — human mechanistic/imaging, small samples
- **D** — animal models only
- **E** — mechanistic inference, no direct evidence. Must be visibly labelled as reasoning, not
  finding.

**Anchor claims worth building the first version around** — verify every one against the primary
source before it ships, do not trust this list as citation-grade:
- Aerobic training and hippocampal volume: Erickson et al., PNAS 2011 — RCT, 120 older adults,
  ~2% anterior hippocampal volume increase, correlated with serum BDNF and VO₂max change. Note
  the population: **older adults**. Do not silently generalise it to a 20-year-old.
- BDNF as the most-studied mediator; IGF-1, VEGF, cathepsin B, irisin/FNDC5 as candidates —
  much of this chain is **animal work (tier D)**. Be explicit.
- Physical activity and executive function in children/adolescents: multiple meta-analyses,
  small-to-moderate effects, **inverted-U dose-response**, larger effects for *cognitively
  engaging* activity than for rote aerobic work. Acute-bout effects are inconsistent.
  This connects directly to neurolab's existing audience.
- Motor learning circuitry: M1 / SMA / pre-SMA / PMd / PMv, cerebellum for error-based
  correction, basal ganglia for reinforcement and sequence chunking; fast within-session vs slow
  across-session consolidation stages.
- Early strength gains are **neural, not hypertrophic** — the first weeks of a lifting programme
  change the nervous system before they change the muscle. This is one of the strongest, best-
  replicated, most surprising-to-users claims available, and it is genuinely a brain story.
- Cross-education: unilateral training produces measurable strength gain in the untrained
  contralateral limb.
- Anticipatory postural adjustments: transversus abdominis and multifidus activate ~30–50 ms
  *before* the prime mover, the timing is feedforward and predictive, it is directionally
  specific rather than a simple bilateral brace, and it is **delayed in recurrent low back
  pain**. This is the single best-evidenced entry point for the entire Pilates story — core
  stability is a motor-control timing phenomenon, not a strength phenomenon.
- Interoception and breath: insula and anterior cingulate; Pilates lateral costal breathing as
  an interoceptive and attentional practice. Nasal breathing entrains limbic oscillations
  (Zelano et al.) — **tier C, do not oversell it**.
- Attentional focus: external focus of attention outperforms internal focus for motor
  performance and retention (Wulf, constrained action hypothesis). This has a **direct,
  actionable consequence for how the app words its cues** — and it is in mild tension with
  Pilates' traditional internally-focused cueing. That tension is worth surfacing honestly
  rather than hiding.
- The **somato-cognitive action network** (Gordon et al., *Nature* 2023): the classic motor
  homunculus is interrupted by inter-effector regions with strong connectivity to the
  cingulo-opercular network, linked to action planning, arousal and physiological control.
  This is recent, contested (see the Muret et al. exchange), and **exactly the finding that makes
  a Pilates app scientifically interesting** — it is evidence for a real anatomical link between
  whole-body action control and cognitive/autonomic control. Present it as the live scientific
  question it is, with the disagreement visible.

### `MOVEMENT_PATHWAY`
The traversal that makes the app cohere, and the direct analogue of neurolab's `PATHWAYS`
(which draws arcs between brain regions for the journey of a word). Here: **intention → SMA/
pre-SMA → M1 → corticospinal tract → anterior horn → peripheral nerve → neuromuscular junction →
muscle fibre → contraction**, and the return loop: **muscle spindle / Golgi tendon organ →
dorsal root → dorsal column → thalamus → S1 → posterior parietal**, with the cerebellar side loop
for error correction. Animate it as a travelling pulse along the path — `main.js` already has the
travelling-dot-on-a-curve implementation, reuse it directly.

---

## 11. UI, reporting, backend, i18n

- **UI**: three-panel like neurolab (left content / centre 3D / right controls), plus an exercise
  timeline. The existing walkthrough/presentation mode is directly reusable as a guided lesson.
- **Report**: reuse `buildReportHTML` — pure function, takes data + a PNG from `captureStage()`,
  returns printable A4 HTML, testable headlessly. Adapt to a workout/anatomy summary. Keep the
  discipline that **every number shows its own arithmetic**; that is the best idea in the
  inherited codebase.
- **Backend**: `server/` already has Express 5, Postgres, session auth, and AES-encrypted PII
  fields. If users log workouts, reuse it. Note `FIELD_KEY` in `.env.example` — 32 random bytes,
  base64, and **losing it makes stored encrypted fields permanently unreadable**.
- **i18n**: every string is keyed `en`/`ko` throughout. Maintain that from the start; retrofitting
  a third language is easy, retrofitting bilingual is not.
- **Testing**: `test/` uses plain `node:test`, no framework. Keep it. Add: frame round-trip
  tests, a test asserting every region id in a GLB has a `MUSCLE_INFO`/`REGION_INFO` entry, and a
  test asserting **every `EXERCISE_BRAIN` claim has a tier and a citation**. That last one is the
  guardrail that keeps the project honest as it grows.

---

## 12. Build order

1. **Frame + palette-texture shader.** Both are foundational and both are painful to retrofit.
   Prove them by re-rendering the *existing brain* through the new palette texture with
   identical output.
2. **Skeleton.** Fewest parts, clearest wins, establishes the whole build pipeline.
3. **Muscles, superficial layer.** Naming, picking, `MUSCLE_INFO`, layer toggles.
4. **Brain ↔ body registration.** Place the existing brain in the body. First moment the project
   is more than two separate viewers.
5. **Nervous system.** Spinal cord + major nerves. Unlocks the click-a-muscle-travel-to-the-brain
   traversal.
6. **One exercise, end to end.** The Hundred. Animation, activation, breath markers, brain link,
   report. A complete vertical slice beats six half-built layers.
7. **Content scale-out.** Pilates mat repertoire, then reformer, then gym, then CrossFit.

---

## 13. Ask before you build

Do not guess these. Different answers mean materially different architecture:

1. **Audience.** Instructors teaching clients? Consumers self-training? Clinicians? Students?
   This decides the register of every string in the app.
2. **The CC BY-SA question.** BodyParts3D and Z-Anatomy are share-alike. If this is ever a
   commercial product, that obligation needs a decision now, not after the meshes are baked in.
3. **Does the child-assessment half survive?** neurolab maps English test scores onto brain
   regions and there is real overlap (exercise → executive function → language learning in
   children). Keep, drop, or merge?
4. **Real user data?** If the app stores workout logs or body measurements — and especially if
   any user is a minor, which the existing project's records suggest is on the roadmap — the
   privacy design has to be decided before the schema is.
5. **Who reviews the Pilates content?** Exercise instruction can injure people. A qualified
   instructor should sign off on cueing and contraindications, and be credited.
6. **Static site or full stack?** The brain half is a static site with an optional backend
   (`render.yaml` / `render.backend.yaml` are both present). Which is this?

---

## 14. Working rules

- Nothing is hand-modelled. Every mesh comes from published data, and the script that produced
  it is in `scripts/`.
- Every claim about the brain carries a citation and a tier.
- Every number shows its arithmetic.
- Every string is `en` + `ko`.
- The disclaimers stay where users can see them.
- `/home/sarvar/Downloads/neurolab-v4` is a **separate project the user maintains by hand.
  Never edit it.** It is available as the `upstream` remote if you need to pull changes.
