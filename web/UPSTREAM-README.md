# Neuro Wellness

A whole-body 3D anatomy explorer that explains how exercise changes the brain.

Click any of 451 individually selectable structures — 152 bones, 188 muscles, 70 organs,
20 named nerves and the 21-region brain — and read what it does, what moves it, and which
nerve carries the command. Pick from **199 exercises across Pilates and yoga** and the
skeleton performs it: a rigid-body rig driven by the Rajagopal 2016 OpenSim model on a
**24-joint spine**, with a scrubber, breath-phase markers, and muscle-tendon paths whose
length is recomputed from the geometry as the joints move. The muscles that do the work light
up, split into prime movers, synergists and stabilisers, each marked with whether that role
was *measured by EMG* or *inferred from biomechanics*. Every claim about the brain carries an
evidence tier from A to E, the population that was studied, the effect size, and what the
finding does not show.

Everything is bilingual (English / Korean) and nothing is hand-modelled.

---

## Run it

It is a static site. No build step, no backend, no database.

```bash
git clone https://github.com/sarvarurdushev/Neuro_Wellness
cd Neuro_Wellness
npx http-server . -p 8080 -c-1
```

Then open <http://localhost:8080>. Or `npm start`, which runs exactly that.

> **Working on this?** `docs/HANDOFF.md` is the one-page onboarding — branch, open PR, current
> state, every command, what was last fixed and what is left. `CLAUDE.md` is the deep
> reference it points at.

Any static server works — `python3 -m http.server 8080` is fine too. Opening `index.html`
from the filesystem is not, because ES modules and `fetch` need an origin.

## Test

```bash
npm test              # frame, palette, content, library, skinning, rig and binding
                      # — 130 tests, no browser
npm run test:smoke    # drives the real app in headless Chromium: clicks the picture,
                      # measures what strays from the body, fails on any console error
npm run poses         # draws all 190 poses as stick figures -> .render/poses.html
npm run poses:check   # every record and every keyframe of every clip against its class
npm run skinbench     # skins every mesh in node and reports volume, edge stretch and
                      # how many bones each one actually rides — four seconds
node tools/bindcheck.mjs --all
                      # does every structure stay on its own bones when the body moves?
npm run shots         # drives the real app through a few exercises -> .render/app/*.png
                      # and reports, per mesh, how far it strayed and how far a
                      # triangle edge stretched — which is how tearing is found
```

`tools/bindcheck.mjs` is the one that asks whether the anatomy is still attached. Every other
rule here asks whether a *pose* is legal — joint ranges, contacts, the floor — and a build can
pass all of them with the bladder riding a thigh and every finger bone welded to the chest.
Two of those failures are invisible to `skinbench` by construction: a mesh riding one bone
rigidly does not stretch and does not lose volume, so it reports as perfect.

`npm run poses` exists because a pose can sit inside every published joint range and still not
be the exercise: the pelvis is the rig's root, so hip flexion alone lifts the legs instead of
folding the trunk, and nothing about the numbers says so. The sheet draws every entry from the
front and the side, at one scale, with a line at the lowest point. `npm run poses:solve
--write` re-derives the root placement — which is world position, not anatomy — from each
entry's position class.

A pose can also pass its position class and still float. Every record says what carries its
weight — `contacts`, or the default for its class — and the tests hold that set to one floor.
That is the rule that caught Warrior II standing with its front foot fifteen centimetres in
the air, and fourteen more poses written as sagittal lunges when the shape is a wide frontal
stance.

`npm run test:smoke` writes screenshots to `.render/smoke/`. It needs Playwright
(`npm i -D playwright`); the browser itself is already present in most CI images.

To prove a shader change renders identically:

```bash
node test/render/capture.mjs .render/before    # on the old code
node test/render/capture.mjs .render/after     # on the new code
node test/render/compare.mjs .render/before .render/after
```

## Rebuild the anatomy

The GLBs are committed, so this is only needed when changing what gets built.

```bash
npm run fetch:body    # ~135 MB from the BodyParts3D archive into bpdata/ (gitignored)
pip install numpy scipy fast_simplification
npm run build:body    # derives the frame, then writes models/*.glb + the id table
npm run build:rig     # OpenSim rig + muscle paths (needs bpdata/osim)
npm run build:spine   # replaces the single lumbar joint with 24 vertebral joints
npm run build:nerves  # nerves from the Z-Anatomy blend (needs `pip install bpy`, ~2 GB)
```

`scripts/derive_frame.py` measures `BODY_FRAME` and `BRAIN_TO_BODY` from the meshes and
emits them as constants; `scripts/build_body.py` bakes a region id into every vertex;
`scripts/parse_opensim.py` extracts the joint tree and muscle paths; `scripts/build_nervous.py`
sweeps Z-Anatomy's nerve curves into tubes. Every one of them registers against shared bones
and prints its residual, and every one prints a per-structure table so a regression shows up
in the diff. Run them in that order — the later ones continue the earlier one's id table.

## What is in here

| | |
|---|---|
| `src/content/` | the actual intellectual work — muscles, exercises, evidence, pathways, strings |
| `src/content/library/` | ~190 exercises as records, and the vocabulary and composer that turn one into an entry |
| `src/main.js` | viewer: layers, picking, labels, camera, activation, pathways |
| `src/rig.js` | the rigid-body skeleton, the segmented spine, and how meshes bind at their bind pose |
| `src/skin.js` | linear blend skinning, so a muscle crossing a joint deforms instead of tearing |
| `src/musclePaths.js` | OpenSim paths swept as tubes, and the muscle-tendon length readout |
| `src/content/motion.js` | joint-angle clips, breath phases, per-phase activation |
| `src/frame.js` | the two coordinate frames and the fitted transform between them |
| `src/regionPalette.js` | per-region colour and activation as a texture, so ids are uncapped |
| `scripts/` | every mesh in the project comes out of one of these |
| `docs/PROJECT-BRIEF.md` | the brief this was built from |
| `docs/DECISIONS.md` | the answers to its §13, settled |

## Sources

- **Body** — BodyParts3D, © The Database Center for Life Science, licensed under
  [CC Attribution-Share Alike 2.1 Japan](https://dbarchive.biosciencedbc.jp/en/bodyparts3d/).
  Release 3.0 (20110915). Mitsuhashi N et al., *Nucleic Acids Res.* 2009;37(Database
  issue):D782-5.
- **Brain** — fsaverage cortical surface carrying the Desikan-Killiany atlas, plus
  subcortical structures marching-cubed from `aseg.mgz`. Fischl B et al., *Neuron*
  2002;33(3):341–55; Desikan RS et al., *NeuroImage* 2006;31(3):968–80.
- **Nerves** — Z-Anatomy by Gauthier Kervyn and Marcin Zielinski, CC BY-SA 4.0, itself
  derived from BodyParts3D. Also the source of the Terminologia Anatomica nomenclature.
- **Rig and muscle paths** — Rajagopal A, Dembia CL, DeMers MS, Delp DD, Hicks JL, Delp SL.
  *Full-Body Musculoskeletal Model for Muscle-Driven Simulation of Human Gait.* IEEE Trans
  Biomed Eng. 2016;63(10):2068–79. Distributed by opensim-org, Apache-2.0.
- **Segmental spine range of motion** — White AA, Panjabi MM. *Clinical Biomechanics of the
  Spine*, 2nd ed. Lippincott, 1990, Table 2-1. Joint centres are the intervertebral disc
  centroids from BodyParts3D; the atlanto-axial and atlanto-occipital joints have no disc and
  are placed at the midpoint of the bones they join, which the build prints per level.

## What this is not

It is a template body, not yours. It is not medical advice. Research findings here are
group averages, not predictions about any individual. And the strength of the evidence for
every claim is shown on screen rather than assumed — those four lines are in the header of
the app, not in a footer, because the genre this app sits in is saturated with confident
nonsense and refusing to join in is the point.

The Pilates and yoga content is reviewed by **Dr. Hong Jong Gi**, credited on each entry.
Gym, CrossFit and endurance entries are **not** reviewed and say so on their own panel. The
app also has a mode that hides instruction entirely and shows only anatomy and evidence.

The joint angles in the movement clips are hand-keyed, not motion capture. The skeleton and
the joint axes are published biomechanics; the pose over time is authored, and the timeline
says so every time you open it.

Six coordinates do not use Rajagopal's own limits. The model was built to simulate walking,
and walking never lifts an arm overhead, folds a knee past 120 degrees or a hip past 120, so
those caps are the box its solver was asked to search rather than measurements of a joint.
They take normal adult goniometry instead (Norkin & White), and `rig.json` records for every
coordinate whether its range came from the model or the literature. What is *not* widened is
anything the model actually measures. Where the model genuinely cannot make a shape — it has
no scapula, so an overhead reach happens at one joint instead of two, and its two legs cannot
pass through each other, so the shins do not cross — the entry says so.

Most of the library's prose is composed from a structured record rather than written out
sentence by sentence, and every entry that was says so on its own panel. That is not a
shortcut around the content: it is the content in a form that can be checked. A fault that
belongs to trunk flexion appears on every exercise that flexes the trunk and nowhere else, a
contraindication class means the same thing everywhere it is used, the animation is built
from the same joint angles the text describes, and `test/library.test.mjs` verifies all of
it. Two hundred hand-written entries of variable quality could not be checked at all.
