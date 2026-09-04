# Handoff — start here in a fresh session

You are picking up a project mid-flight. This file is the whole context: what it is, where
it lives, what state it is in, every command, what was just fixed, and what is left.

Read this, then read `CLAUDE.md` at the repo root — that is the working reference and it is
long on purpose. Everything in it was written down because it already went wrong once.

Four skills in `.claude/skills/` carry the *procedures*: `probe` (open the live app and ask it
a question — use `tools/probe.mjs`, do not hand-roll the browser setup), `verify` (the four
rungs, in order, before you say a change works), `honesty-audit` (the no-fabrication pass over
anything a reader could mistake for a measurement) and `rebuild` (regenerating derived data in
the order that does not silently undo the step before it). They load themselves when the work
matches; you do not have to invoke them by name.

A fifth, `graphify`, is installed with a knowledge graph of this repo committed at
`graphify-out/graph.json` (1098 nodes, 2140 edges). Ask it before grepping —
`graphify query "<question>"`, `graphify explain "<node>"`, `graphify path "<A>" "<B>"`,
`graphify affected "<node>"`, `graphify god-nodes`. **The CLI is not in a fresh container**;
the graph and the config are, so run `uv tool install graphifyy` once per session to get the
command back, and `graphify update .` after changing code to keep the graph current. Without
the CLI the hooks fail safe — they exit 0 and reads proceed as normal.

---

## 1. Where the work is

| | |
|---|---|
| **Repo** | `https://github.com/sarvarurdushev/Neuro_Wellness` |
| **Working branch** | `claude/project-brief-review-p6scl1` — **all work goes here** |
| **Head commit** | see `git log -1`; the last substantive change was `8d42a0a` "Every lookup by mesh name missed, because the loader renames the meshes" |
| **Open PR** | [#1](https://github.com/sarvarurdushev/Neuro_Wellness/pull/1) — "A body, a brain and ~200 exercises in one coordinate frame", `claude/project-brief-review-p6scl1` → `main`, **open, not merged** |
| **Branch is ahead of `main` by** | 28 commits (`git rev-list --count origin/main..HEAD`) |
| **Deployed at** | `https://neuro-wellness.onrender.com` (Render static site, `render.yaml`) |

**`main` is not the app.** `main` is an old brain-only version, 57 files. Everything — the
body, the rig, the exercises, the nerves — lives on the branch and in PR #1. Do not
"restore from main" for anything.

### First commands in a new session

```bash
git clone https://github.com/sarvarurdushev/Neuro_Wellness
cd Neuro_Wellness
git checkout claude/project-brief-review-p6scl1
npm install                 # playwright + gltf-transform + vite; ~1 min
npm start                   # http-server on :8080, no build step
```

Environment last used: **Node v22.22.2**, **Python 3.11.15**. Chromium for the browser tests
is pre-installed in the Claude Code remote environment at `/opt/pw-browsers`; do not run
`playwright install`.

---

## 2. What the project is, in one page

A whole-body 3D anatomy explorer that shows how exercise moves the body and what it does to
the brain. Static site — no build step, no backend, no database. Open `index.html` and it
runs.

Four things share **one coordinate frame**:

- **The body** — 430 structures marched out of **BodyParts3D** (CC BY-SA 2.1 JP) by
  `scripts/build_body.py`: 152 bones, 188 muscles (32 superficial + 156 deep), 70 organs,
  20 named nerves.
- **The brain** — **fsaverage** white surface pushed to a pial approximation carrying the
  **Desikan-Killiany** atlas, plus cerebellum, brainstem, hippocampus, amygdala, thalamus,
  basal ganglia, ventricles and corpus callosum marching-cubed from `aseg.mgz`.
- **The nerves** — 20 named routes from **Z-Anatomy** (CC BY-SA 4.0), swept from bevelled
  curves into tubes by `scripts/build_nervous.py` via Blender's `bpy`. BodyParts3D has no
  peripheral nervous system at all, which is why there is a second source.
- **The rig** — the **Rajagopal 2016** OpenSim model: 47 segments, 108 coordinates, 80
  muscle-tendon paths, plus a **24-joint spine** inserted afterwards from intervertebral
  disc centroids with per-level ranges from **White & Panjabi 1990**.

On top of that sit **199 exercises** across Pilates and yoga. Nine are written longhand in
`src/content/exercises.js`; the other 190 are **records** in `src/content/library/`, composed
into entries and animation clips by `compose.js`. A record states which joints move and
through what range, which muscles in which role with an evidence marker each, which
contraindications apply, what the breath does, and which brain claims it touches — and the
prose *and* the animation are both rendered from that, in both languages. The picture and the
text are literally the same numbers and cannot drift apart.

**Nothing is hand-modelled.** The one authored thing is the pose over time, and the app says
so on screen.

### The four lines that must not move

In `DISCLAIMERS` in `src/content/strings.js`, English and Korean, rendered in the header:

1. **Template, not you** — a reference anatomy from one scanned person, not a scan of the user.
2. **Not medical advice** — every exercise carries its own contraindications.
3. **Population averages, not personal prediction** — effect size and population on every claim.
4. **Evidence is graded and the grade is shown** — tier A–E on every claim, always.

`test/content.test.mjs` fails the build if a claim loses its tier or citation, if an
animal-only finding claims a tier above D, or if a disclaimer goes missing. Do not remove
them and do not let copy elsewhere imply anything here was measured on the user.

### The canonical frame

`+X LEFT, +Y SUPERIOR, +Z ANTERIOR`, right-handed. Two frames share that convention:

- `FRAME` — brain. Origin at the cortex centroid, brain A-P length = 1.0.
- `BODY_FRAME` — body. Origin at the **ASIS midpoint**, **standing height = 1.0**, so the
  sole is at y = −0.553 and the vertex at y = +0.447.
- `BRAIN_TO_BODY` — one similarity transform between them, **fitted** by Umeyama to ten
  shared structures. Mean residual 6.5 mm.

All distances in tools and tests are **fractions of a body height**. 0.01 ≈ 1.75 cm.

---

## 3. Current state — everything is green

Run these to confirm before you change anything:

```bash
npm test                # 144 tests, 144 pass, 0 fail   (~55 s)
npm run poses:check     # all poses pass, 0 violations   (~3 s)
npm run skinbench       # muscles                        (~5 s)
SKIN_LAYERS=nervous npm run skinbench                    # nerves
node tools/bindcheck.mjs --all                           # binding   (~14 s)
npm run test:smoke      # real browser, ~10 min on swiftshader
```

Last measured numbers:

| Check | Result |
|---|---|
| `npm test` | **144 / 144** |
| `npm run poses:check` | **0 violations** over 190 records + every longhand keyframe |
| `npm run joints` | worst limb-joint separation **0.034** of a body height (was 0.086) |
| skinbench, muscles | distorted 55, worst stretch **4.10**, over 3× **7**, vol err 0.0272, **spanning 177/269** |
| skinbench, nerves | distorted 57, worst stretch **2.86**, over 3× **0**, vol err 0.3215, spanning **36/37** |
| `NERVES=1 bindcheck --all` | worst nerve outside the flesh **0.018** (`lumbar plexus|R`), against a ~0.012 floor in a neutral pose — every nerve is inside the flesh at the resolution this measures |
| `bindcheck --all` | 496 structures × 199 clips, **144** over the 1.5%-of-body-height bar (bulk *or* edge); worst bulk **0.082**, worst edge **0.148** (both `coracobrachialis|L`) |
| `npm run test:smoke` | **0 console errors**, 0 dead clicks standing, 0 posed, phone layout clean at 390×844 |

**Read skinbench's four numbers together.** Stretch alone rewards a muscle that has stopped
deforming; volume alone does too. `spanning` is the guard — it counts meshes that actually
ride more than one bone with a real weight range. A "perfect" run with `spanning 1/211` means
the skinning has silently stopped happening.

---

## 4. Every command, and what it is for

### Serving and testing

| Command | What it does | Time |
|---|---|---|
| `npm start` | http-server on :8080. No build step. | — |
| `npm test` | 7 node test files: frame, palette, content, library, skin, rig, bind. | ~25 s |
| `npm run test:smoke` | Loads the real app in headless Chromium, drives real interactions, fails on any console error. **This is the compiler** — a static site with no build step has nothing else to catch a bad import. Also checks the 390 px phone layout. | ~10 min |
| `npm run test:render` / `test:render:diff` | Renders the brain across every fragment-shader branch and byte-compares two runs. Use for shader changes. | minutes |

### Poses and content

| Command | What it does |
|---|---|
| `npm run poses:check` | Every record **and every keyframe of every longhand clip** through the floor, contact, below-floor, class-shape and hand-flatness rules. |
| `npm run poses` | Draws all 190 records as stick figures from two angles into `.render/poses.html`. **This sheet is the only thing that catches a pose which is legal, passes every assertion, and is still not the exercise. Look at it.** |
| `npm run poses:solve` | Derives `pelvis_tilt` from the position class and writes it back into records. `node tools/solve.mjs --write`. |
| `npm run hands` | Reports every weight-bearing and free hand; `node tools/hands.mjs --write` solves `arm_rot`/`pro_sup`/`wrist_flex`/`wrist_dev` and writes back. |

### Measuring the model

| Command | What it does |
|---|---|
| `npm run skinbench` | Loads the GLBs in node, skins every mesh exactly as `bindLayer` does, poses the rig, reports volume / edge stretch / bones ridden / weight range. 4 s instead of 4 min, so a weighting idea can be tried and thrown away in a minute. Env: `SKIN_LAYERS`, `SPAN_TRACE`. Flags: `--worst N`, `--bind`. |
| `node tools/bindcheck.mjs [clip] [--all] [--json]` | **Does every structure stay on its own bones when the body moves?** Pairs each sample point with the piece of skeleton it lies on at rest, poses, measures again. `TOP=20` lists the worst regardless of the bar. |
| `npm run shots` | The same measurements through the real app in a browser. This is the *confirmation*; skinbench is the *search*. |

### Rebuilding generated data

`src/generated/*.json` and `models/*.glb` are **generated**. Never hand-edit them.

| Command | Emits | Needs |
|---|---|---|
| `npm run fetch:body` | downloads BodyParts3D source | network, ~GBs |
| `npm run build:body` | `structures.json`, `models/{skeleton,muscles_*,organs}.glb` | BodyParts3D source |
| `npm run build:rig` | `rig.json`, `muscle_paths.json` from `Rajagopal2016.osim` | the .osim file |
| `npm run build:spine` | inserts the 24 vertebral joints into `rig.json` | must run **after** build:rig |
| `npm run build:joints` | moves each limb joint's centre onto this body's own bones | must run **after** build:spine; `npm run joints` reports without writing |
| `npm run build:nerves` | `models/nervous.glb` + the nervous rows of `structures.json` | Blender `bpy` + Z-Anatomy `Startup.blend` (306 MB) — **both are in the container**: `bpdata/zanatomy/`, `bpy` 5.0.1. Takes ~4 min. |
| `npm run build:shell` | `models/shell.glb` — the body's envelope, drawn under the anatomy so the gaps between structures stop showing the page | numpy, scipy, scikit-image; reads the other GLBs, no external source |

> **`parse_opensim.py` rewrites `rig.json` from scratch, so it wipes the spine *and* the
> fitted joint centres.** Widening a joint range is always three commands, in this order:
> ```bash
> npm run build:rig && npm run build:spine && npm run build:joints
> ```
> Run the first alone and every clip's `lumbar_flex` silently stops existing. Re-running
> `build:joints` moves where a bent arm reaches, so follow it with
> `node tools/solve.mjs --all --write && node tools/hands.mjs --write` and `npm run poses:check`.

**The source data is not in the repo — but check whether it is in the container before you
assume you cannot rebuild.** `bpdata/` is gitignored, so `structures.json`, `rig.json`,
`muscle_paths.json` and the GLBs are committed and the app and every tool run without it. But
a container provisioned from a snapshot that has already fetched the sources has all of them:

```bash
ls bpdata/                       # obj99.zip (BodyParts3D), osim/, zanatomy/
python3 -c 'import bpy; print(bpy.app.version_string)'
```

I declared the axillary nerve unfixable on the assumption that Blender and the 306 MB
Z-Anatomy blend were missing. Both were there, and the fix took one regex. Two seconds of
`ls` would have saved the wrong answer.

---

## 5. The map — what lives where

```
index.html                  the whole page: header, disclaimers, panel, layout, CSS
                            (incl. the max-width:640px phone breakpoint)
src/
  main.js                   the app. scene, layers, binding, labels, camera, picking, clips
  rig.js                    forward kinematics over the OpenSim joint tree
  skin.js                   binding + skinning: bone field, spans, weights, smoothing
  dqs.js                    dual quaternion skinning — GLSL and the matching JS `skinPoint`
  structures.js             the registry: id -> name/layer/colour, LAYER_ORDER
  regionPalette.js          the RegionPalette float texture (replaced the uColors[16] cap)
  musclePaths.js            OpenSim path geometry, recomputed as the skeleton moves
  ui.js                     panel, tabs, library browser, timeline
  lab.js                    the lab screen: ten panels, all drawn from the live app
  brainPlate.js             a lateral render of the real brain, for the lab to draw on
  sections.js               true sections of the model's surfaces along the scan plane
  connectome3d.js           the lab's turnable 3D network, its own renderer and controls
  neuralNet.js              the cells, the fibres and the travelling bands
  generated/                structures.json, rig.json, muscle_paths.json   ← NEVER hand-edit
  content/
    strings.js              all UI copy, en/ko. DISCLAIMERS lives here.
    exercises.js            the 9 longhand entries + COMPOSED_MOTION merge
    motion.js               MOTION: the animation clips. Degrees in the table, converted
                            to radians in place at module load.
    evidence.js             EXERCISE_BRAIN: tier, citation, population, caveat, species
    analysis.js             what an exercise works: muscles, joints, nerves, brain regions,
                            each derived from an existing source with its warrant attached
    muscles.js  pathways.js
    library/
      pilates.js  yoga.js   the 190 records — this is where an exercise is added
      compose.js            record -> entry + clip, in both languages
      vocabulary.js         actions, faults, cues, contraindications, positions, props
      limits.js             limitation notes (belowFloor markers, CROSS_LEGS, SHOULDER_RHYTHM)
scripts/                    the Python build pipeline (see §4)
tools/                      check, solve, hands, posesheet, skinbench, bindcheck, appshots
test/                       frame, palette, content, library, skin, rig, bind + smoke
docs/                       PROJECT-BRIEF.md, METHOD.md, DECISIONS.md, this file
models/                     the GLBs                                     ← generated
CLAUDE.md                   the working reference. Read it.
```

---

## 6. What was just fixed — do not re-break this

The last three passes are documented in full in `docs/DECISIONS.md` ("fifteenth", "sixteenth"
and "seventeenth pass") and the traps are in `CLAUDE.md`. The short version:

### Twentieth pass (the most recent) — the chest, the elbow and the brain

**The intercostal nerves and the ulnar nerve came out for the same reason**: `trimToBones`
measured a structure's share of a bone by *vertex count*, and a nerve's vertex density counts
its branches, not its length. 74% of the ulnar nerve's vertices are in the hand (deep,
superficial and digital branches) and 4.6% against the humerus — so the humerus fell under the
bar, the chain lost it, and the whole upper arm was welded rigidly to the ulna. It swung out
of the arm as a straight rod whenever an elbow bent. Counting each occupied bone-field **cell**
once puts the humerus at 16.2%. **Do not extend that to muscles** — multifidus's 233 vertices
occupy about thirty cells, so all twenty-two of its vertebrae come out at one cell each and the
trim welded it to two, 0.114 of a body height adrift in a roll-up.

**The intercostals could not have been fixed downstream at all.** A nerve's candidates come
from the capsules, and a capsule is a line between two joint centres: every point on the
lateral chest is nearer the `torso` capsule up the middle of the body, or the arm hanging
beside it, than to the thoracic vertebra it lies against. The set was `T1, T2, torso, humerus,
ulna, radius` — no vertebra below T2 — so all eleven nerves rode `torso`, one rigid body
hanging off T1, while every rib moved with its own vertebra. `withOccupied` adds what the bone
field says the mesh occupies (no reach expansion) plus the run of tree joining it:
`torso > T1 … > T11`.

**A chain can be whole and describe a third of the structure.** The right vagus runs skull to
stomach; `spanOf` gave it `C1 … L2` with no `skull` in it, and the trim kept `T11 > T12 > L1`.
`chainCoverage` / `CHAIN_COVER` (0.5) rebuilds a chain that accounts for less than half the
mesh. Nerves only — on muscles it took worst stretch 4.10 → 6.40.

Result: vagus R **0.031 → 0.015**, intercostals **0.019 → 0.012**, ulnar L **0.018 → 0.013**;
worst nerve now the right lumbar plexus at **0.018** against a ~0.012 measurement floor. Nerves
that deform 33/34 → **36/37**. **Muscle numbers byte-identical**, which is the point.

**The brain, and a bug that was never brain-specific.** `indexGeometry` wrote
`app.centroids[id] = c` on the single-mesh branch — the same Vector3 it had just stored as that
mesh's *rest* measurement — and `refreshPosed` writes the posed position into it with
`.copy()`. So the first posed frame overwrote the rest centroid in place, the next frame read
that as the rest position and applied the delta again: **every unpaired structure's centroid
walked further off the body with every frame of every clip.** Paired structures were
accidentally safe. `c.clone()` fixes it.

The second half: `bindBrain` attaches the *holder* (right — the cortex and the deep structures
must not drift apart), but `refreshPosed`, `anchorFor`, `posedSide` and `flyTo` all ask `bound`
where a **mesh** is. So the brain rode the head correctly while every rope and every camera
flight aimed where it had been standing — in the Swan, **0.46 of a body height away**. Each
brain mesh is registered as riding `skull` now: `flyTo` lands 0.022 from the brain, and a grid
of 1440 clicks with the brain layer alone showing returns 230 hits, all brain.

**Both tools had drifted from the app.** Neither `bindcheck` nor `skinbench` called
`chainFromBones` for the nervous layer, though `bindLayer` calls it for every layer — so both
measured a binding the app never used. When you change the binding, change it in all three.

### Nineteenth pass — the nerves coming out of the leg

**Both skinning constants were tuned on sheets, and a nerve is a tube.** `SMOOTH_PASSES = 45`
exists because projecting a broad muscle onto its chain is smooth *along* the chain and says
nothing about across it — that is what tore the gluteus maximus's rim into "wings". A tube has
no rim: its cross-section is a ring of vertices that all project to the same point along the
joint axis, so there is nothing to smooth across, and 45 passes on a 120-vertex sciatic nerve
diffuse the handover along the whole tube until it is a linear ramp instead of a fold at the
hip. The nerve then arcs smoothly through a hip flexed 120° while the flesh over it folds —
and comes out through the buttock. `H_FRACTION` is the same error in the other coordinate: a
share of the mesh's own extent is joint-sized for a muscle and a quarter of a body long for a
femoral nerve.

`NERVE_SMOOTH = 0` and `NERVE_HALF_CAP = 0.06` in `src/skin.js`, applied by `bindLayer` for
the nervous layer only. Sciatic **0.072 → 0.013** of a body height outside the flesh, femoral
**0.055 → 0.015**, worst nerve edge stretch **4.66 → 1.82**, spanning 29/33 → **32/33**,
`bindcheck --all` 149 → **141**. Position, tearing and how much the nerves deform at all — all
three the right way, which is what this problem had refused to do five times.

**Do not repeat any of these five.** A bigger candidate set: stretch 4.6 → 16.6. Nearest-muscle
weight transfer: overhang 0.069 → 0.014 and **51× tearing**. Smoothed transfer: one for one,
beats the plain chain on neither. Chain trimming: needs floor 1 for nerves or the sacral plexus
goes 0.578 adrift. Forcing the blend *wider* (a `hFloor` hook and a comment that had been in
the source asserting the blend was too narrow): swept to 0.08 and **not one number moved**,
because `h` was already larger than that — the hook is gone.

**And the one nerve left over was a substring bug in the build, not a skinning fault.**
`axillary nerve|R` sat at 0.046 and moved for nothing, because 336 of its 396 vertices were at
the cranium: `GROUPS` in `build_nervous.py` sorts Z-Anatomy's curves by regex, and
`axillary nerve` is a substring of **m**`axillary nerve`, so the maxillary division of the
trigeminal and its meningeal branch were swept into a four-centimetre nerve at the shoulder.
`spanOf` then correctly gave that geometry `humerus > torso > T1 > C7 … > C1 > skull`.

I first said this was unfixable here because Blender and the 306 MB source were missing.
**Both are in the container** — `bpdata/zanatomy/Z-Anatomy/Startup.blend` and `bpy` 5.0.1.
Check before declaring a build input missing.

Fixed at the source, with three guards: `\b` on the pattern; `group_of` refuses *any* match
starting mid-word and reports it; and `spread_of` fails the build if a route's curves
single-link into clusters more than `GROUP_LINK` (90 mm) apart — the axillary group's two
clusters were 145 mm apart and the widest gap inside a genuine single nerve is the sacral
plexus at 36 mm. `SCATTERED` names the two routes that are collections by design. It also
recovered the ophthalmic and both mandibular divisions, which matched no group and were being
dropped. `axillary nerve|L/R` is now 60 vertices at shoulder height on `humerus > torso`, at
**0.011** — the measurement's own floor. Worst nerve in the library is now `vagus nerve|R` at
0.031.

### Eighteenth pass — the joints themselves

**The skeleton was coming apart at every limb joint, and everything else is bound to the
skeleton.** Rotate a joint through its own published range and measure the gap it opens
between the two bones: at rest they touch to within a millimetre, in a pose they came apart
by up to **15 cm** at the radioulnar joint, 9 at the wrist, 6 at the elbow, 5.6 at the hip.
The spine opened 3 mm over the same clips — and the spine's centres are *this body's* own
disc centroids, while the limb centres came from Rajagopal through one global similarity
transform fitted to nine bones. One transform cannot place sixteen joints. That is why so
much further down looked wrong: a forearm that leaves the elbow takes its muscles and the
median nerve with it.

`tools/fitjoints.mjs` (`npm run joints` to report, `npm run build:joints` to write) searches
each joint's centre directly — three degrees of freedom, scored on the separation the joint's
*own* rotation opens between the two bones' closest 60 point pairs. Fifteen joints moved,
largest 106 mm at the wrist. ulna→radius 0.0855 → 0.0342, radius→hand 0.0454 → 0.0031,
humerus→ulna 0.0501 → 0.0088, calcn→toes 0.0403 → 0.0011, pelvis→femur 0.0352 → 0.0233.
`bindcheck --all` 159 → 149.

Three things not to re-break:
- **The bind pose is preserved exactly** — δ on `translation` and
  `R(childOrientation)·R(orientation)⁻¹·δ` on `childTranslation`. `test/rig.test.mjs` holds
  forward kinematics to `worldAtDefault`.
- **The knee and the spine are skipped.** `knee_angle` is *coupled* — it drives two
  translations through cubic splines — so its centre is a function of the angle, not a point;
  fitting a fixed one made the joint travel 40 mm through a 120° bend.
- **The move is priced (`MOVE_COST`).** Unregularised the search wandered: 126 mm at the
  radioulnar joint for 53 mm of gain, 86 mm at an ankle for 7. Same gains at 67 and 16.

**It moves every hand in the library.** New elbow and wrist centres change where a bent arm
reaches: re-run `node tools/solve.mjs --all --write && node tools/hands.mjs --write`, then
`npm run poses:check`. Child's Pose needed straighter elbows (40° → 30°) to touch the mat and
Reclining Hero's 49° of shoulder extension went through it (→ 35°). The on-screen provenance
text now says the centres are fitted and by how much.

### Seventeenth pass (`36615a7`) — binding

**Nothing had ever checked whether the anatomy stays on the body when the body moves.** Every
rule asked whether a *pose* was legal; none asked where the 496 structures ended up. A fully
green build had:

- the bladder, rectum, urethra and both testes riding a **femur**
- the left transversus abdominis riding a **forearm**
- the right sacral plexus **100% bound to the right radius**
- the femoral nerve **87% bound to the torso**
- every finger and toe bone, both metacarpal sets, the eyeballs and half the foot **welded to
  the chest** — 101 of 245 skeleton meshes

**One cause.** `nearestSegment` measured distance to a segment's *origin*, and OpenSim puts a
body's frame at the joint where it meets its **parent**. The femur's origin is the hip centre,
inside the pelvis next to the bladder; the ulna's is the elbow, level with the waist on a
standing figure. Every structure got the segment on the far side of the nearest joint.

**The fix.** The skeleton's meshes *are* bound correctly, by name — every vertebra on its own
level, every rib on a thoracic one. So `buildBoneField` samples them into a grid and a
structure's home is **voted from its own vertices** against that. Plus `SEGMENT_BONES` in
`parse_opensim.py` gained the 101 meshes that were falling through, and the script now prints
anything still falling through so a missing bone is visible as missing.

Two of these failures are **invisible to skinbench by construction**: a mesh riding one bone
rigidly does not stretch and does not lose volume, so it reports as perfect. That is what
`tools/bindcheck.mjs` exists for.

### Sixteenth pass (`9ca3518`) — nerves and arms

- `nerveNeighbourhood()` builds a nerve's candidate segments from **its own vertices**, not a
  radius around one home. `neighbourhood()` walks ancestors and descendants, and from a
  cervical root the humerus is neither at *any* radius — the arm hangs off the torso, not the
  neck. That was the scatter of yellow fragments at the shoulder.
- Free arms: `arm_rot` was set in 2 records of 200 and `pro_sup` in none, so no hand could
  turn over. `tools/hands.mjs` solves both against one scalar — `(thumb − pinky) · anterior`,
  thumbs forward — which is neutral in every shape the library contains.
- The header set a 476 px floor; a narrow breakpoint wraps it and the smoke test loads at
  390×844.

### Fifteenth pass (`203e390`, `ce0e046`) — bilateral meshes and hands

- Z-Anatomy names paired objects `.l`/`.r`; the build was stripping it, so the median nerve
  was one mesh spanning hand to hand and got bound to a femur. Now `name|L` / `name|R` share
  one region id.
- 32 weight-bearing hands solved flat on the floor.

### Also in this session

- **Label lanes** were sorted on `app.centroids`, which `refreshPosed` rewrites every frame,
  so names traded rows continuously. Now sorted on a rest-pose height kept beside it, eased
  rather than snapped when the lane's length changes, with two size thresholds so a label on
  the line does not blink.
- **The nine longhand clips had never been through a single pose rule.** The Hundred drove
  both hands 20 cm through the mat, the roll-up 30, the roll-up's top pointed both legs 43 cm
  down through it, and the deadlift and back squat had the **sign of `pelvis_tilt` backwards**
  — so the deadlift started and ended flat on its back with its feet in the air. Clips now
  carry a `position`, keyframes a `pos` where the clip travels, and every keyframe goes
  through the same battery as a record.

---

## 6b. The one that beat every tool — read this before trusting a number

**`GLTFLoader` renames every mesh on the way in.** `PropertyBinding.sanitizeNodeName`
replaces whitespace with underscores, so a mesh written as `transversus abdominis|L` arrives
in the browser as `transversus_abdominis|L`. Everything keyed by name — `rig.segmentFor`, the
OpenSim attachment index, the bone field built from the skeleton — is keyed with **spaces**,
so in the browser every one of those lookups returned null.

The consequence was total and silent: `buildBoneField` had nothing to sample, came back
empty, and all 496 structures fell back to the joint-centre rule the field exists to replace.
An entire pass of binding work was **inert in the browser** while every test was green.

**Three separate tools said it was fine**, because all of them read the GLB directly, see the
spaces, resolve the names, and measure a binding the browser never used. And the failure does
not distort — a mesh bound to the wrong bone is smooth, keeps its volume and does not stretch
— so `skinbench`, `appshots` and the distortion thresholds all reported *perfect*.

What actually found it: **clicking a grid of points over the rendered picture and asking the
app which structure was under each one.** Transversus abdominis came back among the forearm
bones. When the picture and the numbers disagree, the picture is right.

Now: `meshName()` in `src/skin.js` is the single place a mesh name becomes a lookup key, every
caller goes through it, `buildBoneRegions` logs a console error if fewer than nine in ten
skeleton meshes resolve (and `test/smoke.mjs` fails on any console error), and a test holds
every key in the binding table against three's own sanitiser.

**The general lesson for this codebase:** a node-side tool that loads the GLBs itself is
measuring *its own* pipeline, not the app's. When a result matters, confirm it in the browser
— `npm run test:smoke`, `npm run shots`, or a render you actually look at.

---

## 6c. Two things that look like bugs and are not

Chased at length and confirmed identical on the pre-binding build — **check here before
spending a session on either**. Reproduce the "before" with
`git archive 203e390 | tar -x -C /tmp/before` and serve that tree.

- **Dark gaps in the torso ("the back is popping out") — fixed.** ~500 separate segmented
  meshes do not tile into a closed skin, so you looked through the trunk at the page behind it.
  Every muscle and organ mesh is closed; it was not culling and not shading. `npm run
  build:shell` derives the missing surface from the structures themselves — voxelise, close,
  erode, cut per segment — and the app draws it under the anatomy. Do not try to "fix" this
  again by changing lighting or material sides; both were measured and neither moves it.
- **Nerve filaments sticking out past the body.** Z-Anatomy draws spinal roots, plexuses and
  intercostals as bushes of radiating branches swept into open-ended tubes — `spinal nerve
  roots` is 37.7% open edges by construction. Binding is correct: no nerve drifts more than
  0.069 of a body height over the whole library, and the spikes are present at rest. Fixing it
  means changing `build_nervous.py`.

---

## 7. The traps that will bite you

`CLAUDE.md` has ~60 of these. These are the ones most likely to matter on day one.

**Frames and signs**

- `pelvis_tilt: +90` lies on the **back**; `−90` lies **face down**. Written the other way
  round the whole supine repertoire performs itself prone, entirely inside the published
  ranges. Side-lying is `pelvis_list: ±90` **alone**.
- The pelvis is the rig's root, so `hip_flexion` **lifts the leg**, it does not fold the
  trunk. A standing forward fold is `pelvis_tilt: −T` with `hip_flexion: +T`.
- A negative `arm_flex` is shoulder **extension** — on a supine body that points the arm into
  the mat; inverted it points at the ceiling.
- **Do not hand-write a `pelvis_tilt`.** It is world placement. `tools/solve.mjs` derives it.
- `motion.js` converts its tables to **radians in place at module load**, so a clip read from
  `MOTION` is already in radians. Converting again poses the body 1.5° from standing and
  every check reports "nothing moved, nothing drifted". This wasted an hour.
- Do not detect angle-vs-length coordinates by name prefix: `pelvis_tilt` also starts with
  `pelvis_t`, and 90 got through as 90 **radians**.

**Binding and skinning**

- **Mesh names arrive with underscores.** Anything turning a mesh name into a lookup key goes
  through `meshName()`. See §6b — this one was invisible to every tool in the repo.
- A segment's **origin is the joint where it meets its parent**, not where its bone is.
  Nothing may be bound by distance to it. Use the bone field.
- The **bone field is built from the skeleton layer**, so nothing else may bind before it.
  `bindLayer` returns early without one and re-binds everything when the skeleton arrives.
- A nerve's chain **is** trimmed to the bones it lies on; a muscle's is not. `spanOf` picks
  the pair of ends with the *longest* chain between them, so one spurious candidate wins
  outright.
- When there is **no span, the mesh rides its home segment** — not the nearest capsule (that
  gave the inguinal ligament a femur) and not a single-segment chain (that gave the right
  external oblique a humerus).
- The dual-quaternion blend **exists twice** — GLSL in `dqs.js` and `skinPoint` for tools and
  tests. Change one and you must change the other. It also has to be the blend the
  **raycaster** uses, or a muscle is drawn in one place and picked in another.
- A rigged mesh **no longer lives in its layer group** — `rig.attach()` reparents it, so
  `group.visible = false` stops hiding it and raycasting the groups makes everything
  unclickable.

**Rendering**

- The region varying **must** be `flat`. Interpolating an id across a triangle spanning two
  regions indexes an unrelated third structure.
- An opaque layer must be flagged `transparent: false`, not merely given opacity 1. Leaving it
  transparent measured **0.2 fps**.
- Do **not** set `material.glslVersion = THREE.GLSL3` to get `texelFetch`.
- `texture.needsUpdate` is write-only in three — read `texture.version`.
- Never read `offsetWidth` per label per frame. Camera flights are **wall-clock**, not
  frame-counted.
- The drawing buffer must match the box it is displayed in, and `resize` must be told when
  that box moves (`ResizeObserver` on the stage). When the header wrapped, the picture was
  squashed 4% and 15% of the posed body could not be clicked.

**Content**

- Every muscle in every role needs an evidence marker: `'emg'` if a study measured it,
  `'inferred'` otherwise. **Transversus abdominis, multifidus, the pelvic floor and the
  rotatores are always `inferred`** — surface electrodes cannot reach them. Psoas and iliacus
  may be `emg` (fine-wire studies exist).
- `reviewed` is `false` or `{by, credential, date}`. There is no third option. `credential`
  may be null — inventing a plausible qualification is worse than an absent one.
- **Name only actions the pose performs.** `test/library.test.mjs` reads every action against
  the record's own angles.
- **A shared pose constant is spread FIRST, never after a written value.** `{ pelvis_tilt:
  -67, ...QUAD }` silently becomes QUAD's value; the record says one number and the rig uses
  another.
- `setAll` states the **whole** pose, not a nudge.

---

## 8. What is left

### Open against the brief (documented limits, not bugs)

- **Activation is authored, not solved.** Needs a dynamic simulation with external loads. The
  clips carry per-phase values and the legend says plainly what the number is. Muscle-tendon
  *length* is real — it falls out of the path geometry.
- **Upper-limb muscle paths are missing.** Rajagopal's 80 actuators are lower-limb and hip;
  the arms are torque-driven. 28 named muscles have a path model; the panel shows the block
  only where one exists.
- **The shoulder has no scapula.** Rajagopal's shoulder is one 3-DOF ball. Reach is drawn at
  the published total so the hand lands correctly, and `SHOULDER_RHYTHM` says what is missing.
  The fix is a model with a scapulothoracic joint, not an edit to this one.
- **The shins cannot cross**, so cross-legged sits point the shins forward. Every affected
  entry carries `CROSS_LEGS`.
- **The apparatus is not modelled** — springs, straps, a moving carriage. Every apparatus
  entry says so.
- **Motion capture.** Joint angles are hand-keyed against published movement descriptions.
  Replacing them with OpenSim inverse kinematics from real motion capture is the upgrade path.
- Storage, accounts and workout logs (`docs/DECISIONS.md` §4).
- Touch gestures beyond what OrbitControls gives.

### Things a next session could actually pick up

1. **Chair Pose has its arms at 84 degrees, which is a front raise, not Utkatasana** — the
   arms belong overhead (~165). Found while chasing the name bug and not fixed. Worth a sweep
   of the library for other records whose `arm_flex` does not match the shape they describe.
2. **The 167 structures still over the bindcheck bar.** Worst bulk 0.095, worst edge 0.176 —
   these are broad sheets (linea alba, multifidus, the obliques, latissimus) whose *rim* is
   dragged when they cross a deep hip or shoulder, plus deep forearm/hand muscles. Some of
   this is honest geometric skinning slide; some is probably still a wrong chain. Start with
   `TOP=30 node tools/bindcheck.mjs --all` and check the chains with
   `npm run skinbench -- --bind`.
3. **The femoral nerve's 4.58× edge stretch** — the only nerve over 3×. Its chain
   (`tibia > femur > pelvis > L5..L2`) is anatomically right; the stretch is at the knee.
4. **Look at the pose sheet.** `npm run poses` and actually open `.render/poses.html`. It is
   the only check that catches a pose which is legal, passes everything, and is still not the
   exercise. It has caught 15+ wrong poses before.
5. **Merge PR #1** — or decide not to. It is the whole app.
6. **Re-run `npm run poses:solve` and `npm run hands`** after any rig change, in that order,
   and re-check. Both are idempotent when things are correct.

---

## 9. First-session checklist

```bash
# 1. get on the branch
git clone https://github.com/sarvarurdushev/Neuro_Wellness && cd Neuro_Wellness
git checkout claude/project-brief-review-p6scl1 && npm install

# 2. confirm the baseline before touching anything
npm test                      # expect 144/144
npm run poses:check           # expect 0 violations
npm run skinbench             # expect worst stretch ~3.52, spanning ~149/200
node tools/bindcheck.mjs --all  # expect 155 over the bar, worst bulk ~0.070

# 3. look at it
npm start                     # then open http://localhost:8080

# 4. read the reference
#    CLAUDE.md            — the traps, in full
#    docs/DECISIONS.md    — why every decision was made, pass by pass
#    docs/PROJECT-BRIEF.md, docs/METHOD.md
```

### Rules that carry over

- **Develop, commit and push only to `claude/project-brief-review-p6scl1`.** Never push to a
  different branch without explicit permission.
- **Do not open a PR** unless asked. #1 is already open.
- **Never put a model identifier** in a commit message, PR title/body, code comment, or any
  artifact pushed to the repo. Chat replies only.
- **Never hand-edit `src/generated/*.json`** — regenerate via the script.
- Every string is keyed `en` / `ko`. Adding a language means extending every table in
  `strings.js`, `muscles.js`, `exercises.js`, `evidence.js`, `pathways.js` and `REGION_INFO`.
- When something looks wrong in the picture, **measure it** — do not reason about it. Every
  real bug this session was found by writing a fifteen-line diagnostic, and twice I asserted
  a cause without checking and was wrong both times.
