# Auditing this atlas against Human Atlas

A full read of both repositories before a line was changed, and what the reading
decided. Written because the obvious plan — *Human Atlas has 2,234 meshes and we
have 430, so take theirs* — is the wrong one, and the reason is not a matter of
taste.

Repositories as read:

| | this project | Human Atlas |
|---|---|---|
| commit | `a40753a` | `1c38bf3` |
| licence | app: this repo · anatomy: BodyParts3D | app: MIT (© 2026 ashemag) · anatomy: BodyParts3D |
| anatomy release | BodyParts3D **3.0** (20110915), 99% reduction | BodyParts3D **4.0**, meshoptimizer 0.2% error |
| stack | vanilla ES modules, no bundler, three.js vendored | React 19 · Vite 8 · TypeScript · Tailwind 4 · Cloudflare Workers |
| source size | 24,632 lines across `web/src` | 427 lines across `app/` + 7,597 lines of stock shadcn |
| geometry | 8 GLB files, 25.8 MB (15.0 MB gzipped) | 15 binary chunks, 60 MB (34 MB gzipped) + 1.3 MB manifest |
| meshes / draw calls | 764 meshes, **764 draw calls** | 2,234 parts, **~15–60 draw calls** |
| triangles | 959,573 (572,077 excluding brain) | 2,288,268 (from 6,681,030 source) |

## 1. The finding that decides everything

**Human Atlas has no abdominal wall.** Not renamed, not merged into something
else — absent from the mesh table *and* from the 3,432-concept hierarchy:

| muscle | in Human Atlas | in this atlas | exercises here that name it |
|---|---|---|---|
| rectus abdominis | **absent** | present | 43 |
| multifidus | **absent** | present | 12 |
| internal oblique | **absent** | present | 11 |
| quadratus lumborum | **absent** | present | 10 |
| latissimus dorsi | **absent** | present | 10 |
| transversus abdominis | **absent** | present | 5 |

Its own concept `FMA78435 musculature of anterior abdominal wall` resolves to two
elements: left and right external oblique. That is the whole anterior abdominal
wall in that dataset.

The library here is 190 Pilates and yoga exercises, each mapping prime movers,
synergists and stabilisers to muscles by name. **81 of those 190 exercises name
at least one of those six muscles, and 54 name one as a prime mover.** Switching
to that geometry would break two fifths of the library, and it would break it
precisely at the muscles Pilates exists to teach.

Distinguish this from the seven muscles Human Atlas models *more* finely than
this atlas does — trapezius as three parts, deltoid as three, pectoralis major as
three, triceps and biceps femoris and gastrocnemius by head. Those are present,
and are a gain worth taking (§4). The six above are absent: no mesh, no concept,
nothing under another name.

So the direction of travel reverses. Human Atlas is the better *engine* and the
worse *anatomy for this purpose*. Take the engineering; keep the meshes; backfill
the handful of structures it genuinely has and we do not.

## 2. What Human Atlas actually has that is worth having

Read in full: `app/scene.tsx` (134 lines, up to 1,078 characters each),
`app/page.tsx`, `app/anatomy.ts`, `app/explosion-layout.ts`,
`app/model-download.ts`, `app/pointer-tap.ts`, `app/agent-tools.ts`, all five
build and validation scripts, and the 1.3 MB manifest.

**a. The FMA concept hierarchy.** 3,432 named concepts, each with an element
list, derived from BodyParts3D's own IS-A and PART-OF tables. Cross-mapped
against this atlas by FMA id: **1,406 of those concepts land on at least one
structure here, and 306 of them are groups covering between 2 and 40 of our
structures.** They are the vocabulary a coach actually speaks in:

    FMA22594  muscle of vertebral column           → 25 of ours
    FMA9140   thoracic vertebral column            → 23
    FMA259211 abdominal segment of trunk           → 17
    FMA37367  muscle of pelvic girdle              → 11
    FMA64922  gluteal muscle                       → 10
    FMA16203  lumbar vertebral column              → 10
    FMA33531  muscle of shoulder                   →  9
    FMA22439  muscle of medial compartment of thigh→  6  (the adductors)
    FMA22474  muscle of posterior compartment of leg→ 6
    FMA32520  intrinsic muscle of shoulder         →  5  (the rotator cuff)
    FMA22429  zone of quadriceps femoris           →  4

Right now nothing here can select more than one structure at a time. This is the
largest single gain available, it costs no geometry, and it is the same
CC BY-licensed database our meshes already come from.

**b. Merged geometry with per-structure GPU state.** `scene.tsx` merges every
part of one system in one chunk into a single `BufferGeometry`, bakes a
`partIndex` float attribute per vertex, and drives translation, visibility and
selection from two `DataTexture`s the vertex shader samples. Toggling a system
or animating the explode costs one texture upload, not a scene-graph walk.
Picking is done against separate per-part meshes that are never added to the
scene, broad-phased by `ray.intersectBox` before `intersectObject`.

We already have the half of this that matters most — `attribute float _region`
and a `texelFetch` palette in `tissue.js` / `brainMaterial.js` — but we still
draw 764 separate meshes.

**c. `PointerTap`.** 27 lines that tell a tap from an orbit, a pinch, a pan and
a cancelled touch, per pointer id, with a wider threshold for touch than mouse.
Ours is `Math.hypot(...) > 5` on `pointerup` with no multitouch handling at all,
so a two-finger pinch that ends near where it started selects a muscle.

**d. Dirty-flag rendering.** `renderer.render` runs only when something changed.
Ours runs every frame.

**e. `camera.setViewOffset` for panel-aware framing.** When the detail sheet is
open, the camera frames the structure into the *visible* rectangle rather than
the whole canvas. We have `panelInset()` doing something similar in `main.js`;
theirs also handles the mobile bottom-sheet and landscape cases by measuring the
live DOM.

**f. A measured simplification pipeline.** `optimize-anatomy.mjs` runs
meshoptimizer quadric simplification with a **0.2% relative error bound per
structure**, records `maximumRelativeError` in the manifest, and
`validate-atlas.mjs` then asserts every buffer length, every index in range,
every concept element resolvable, and the triangle total. Ours says
`"BodyParts3D 3.0 (20110915), 99% reduction"` — a ratio, with no error bound and
no validator.

**g. `decodeModelResponse`.** Handles the case where a static host serves `.gz`
as an already-decoded response versus as a gzip file, by sniffing `1f 8b`, and
checks the decoded length against the manifest. Ours has no integrity check.

**h. Text search over anatomy.** `/` opens a combobox over all 3,432 concept
names and ids. We have a rich faceted search over the 190-exercise library and
**no search over anatomy at all**: the Explore tab lists only `documented()`
records — 91 muscles and 21 brain regions — so 152 bones, 20 nerves and 70
organs are reachable only by clicking them on the body.

## 3. What Human Atlas has that is not worth having here

- **Its system grouping is unreliable.** `Right tibialis anterior`,
  `Left fibularis longus`, `Right subscapularis`, `Left levator scapulae` and
  `Right iliotibial tract` are all filed under `skeletal`. 16 parts affected.
- **231 exact-duplicate part names** and 12 more differing only in case
  (`left optic nerve` / `Left optic nerve`); 818 parts share a `conceptId` with
  another part; 17 names start lowercase. The converter passes source strings
  through untouched.
- **Its bulk is head, viscera and vessels.** Of the 402 `muscular` meshes we do
  not already have, the additions are extraocular (6), laryngeal (11), tongue
  and palate (7), cardiac papillary (5) and hand intrinsics packaged as "sets".
  1,043 of its 2,234 meshes are arteries and veins.
- **React 19 / Vite 8 / Tailwind / Cloudflare Workers.** This project is
  deliberately buildless — `render.yaml` publishes the directory as-is. Adopting
  their stack would mean a build step, a bundler and a framework for a page that
  currently has none of those, and `web/` is a **vendored copy of Neuro Wellness**
  (see `web/VENDOR.md`) whose whole premise is that our patch stays additive.
- **7,597 lines of stock shadcn components.** Nothing to take.

## 4. Anatomy: exactly what to backfill

Human Atlas names 48 muscles we do not carry. Filtered to what Pilates and yoga
teaching actually reaches for:

**Worth adding — deep segmental stabilisers and breathing muscles**

| structure | FMA | why it matters here |
|---|---|---|
| levatores costarum breves / longi | 74075–74078 | rib elevation; the muscles behind lateral breathing cues |
| interspinales cervicis / thoracis / lumborum | 71309, 22890, 71307 | segmental extension — "articulate one vertebra at a time" |
| intertransversarii, lumbar lateral / medial | 22850, 22851 | segmental lateral stability |
| cervical intertransversarii, anterior / posterior | 71442, 71443 | deep neck stability |
| spinalis | 77179 | the erector spinae column we currently only carry as `spinalis cervicis` |
| superficial perineal muscle | 19728 | the only pelvic-floor muscle belly in either dataset |

**Worth adding — muscles we model whole that Human Atlas models in parts.** This
is a real gain in teaching resolution, because upper and lower trapezius are
different cues:

| we have | Human Atlas splits it into |
|---|---|
| trapezius | ascending (lower), transverse (middle), descending (upper) |
| deltoid | clavicular (anterior), acromial (middle), spinal (posterior) |
| pectoralis major | clavicular, sternocostal, abdominal |
| triceps brachii | long, lateral, medial heads |
| biceps femoris | long, short heads |
| gastrocnemius | medial, lateral heads |
| longus colli | superior oblique, inferior oblique, vertical |

**Not worth adding:** extraocular, laryngeal, tongue, palate, cardiac papillary,
teeth and gingiva (31 skeletal "parts" in their set are teeth).

**What we have and they do not**, beyond the six above: the entire face and
muscles of mastication (buccinator, zygomaticus major and minor, orbicularis
oculi and oris, frontalis, occipitalis, procerus, nasalis, mentalis, risorius,
masseter, temporalis, both pterygoids, digastric), pyramidalis, spinalis
cervicis, flexor digitorum superficialis, extensor digitorum brevis, the
inguinal ligament — 32 muscle structures in all — plus a peripheral nervous
system (20 named nerves, plexuses and the spinal cord, from Z-Anatomy) that has
**no counterpart in Human Atlas at all**: none of our 20 nerve FMA ids appears
anywhere in their manifest, and their 139 `nervous` meshes are cranial nerves,
orbital branches and central structures.

## 5. Licensing, verified rather than assumed

Fetched `dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html` directly. The
licensor's current wording:

> The license for this database is specified in the Creative Commons Attribution
> 4.0 International. If you use data from this database, please be sure attribute
> this database as follows: "BodyParts3D, © The Database Center for Life Science
> licensed under CC Attribution 4.0 International".

Three consequences:

1. **Human Atlas's attribution claim checks out.** `public/ATTRIBUTION.md` is
   accurate and complete, and it must travel with anything taken from there.
2. **Our own attribution is out of date.** `structures.json`, `bodies.js` and the
   About panel all say *CC Attribution-Share Alike 2.1 Japan*, taken from the
   legacy comment inside the release-3.0 OBJ files. The licensor now offers the
   database under CC BY 4.0. The grant we received under 2.1 JP is not revoked,
   but the current offer is both more permissive and what the licensor asks to be
   quoted — so the correct move is to state CC BY 4.0 in the licensor's own words
   *and record which release our meshes came from*, rather than silently dropping
   a share-alike claim.
3. **The nervous layer is unaffected.** It is Z-Anatomy, CC BY-SA 4.0, and that
   share-alike is real and stays.

Human Atlas's *application code* is MIT. Any algorithm taken from it — the tap
discipline, the shelf packing, the gzip sniffing — carries the MIT notice.

Nothing in this plan claims anatomy assets as original work.

## 6. The plan, in priority order

Constrained by `web/VENDOR.md`: `web/` is Neuro Wellness vendored whole, and our
integration is additive except for one `<script type="module">` line. Anything
that must change upstream files is called out as such and kept to the smallest
possible diff.

1. **Concept groups.** Derive a group table from the BodyParts3D concept
   hierarchy, keyed by our FMA ids, and let a coach select "the adductors" or
   "the rotator cuff" as one thing. Additive; no geometry changes. *Largest
   win, no risk.*
2. **Anatomy search.** One input over all 430 structures plus the group names,
   in both languages, replacing an Explore tab that can only reach 112 of them.
   Additive.
3. **Correct the attribution** to the licensor's current wording, in
   `structures.json`, `bodies.js`, the About panel and a new `ATTRIBUTION.md`
   that also credits Human Atlas (MIT) for anything adopted from it.
4. **Tap discipline.** Port `PointerTap` under its MIT notice. Small upstream
   diff in `main.js`; fixes real pinch-selects-a-muscle behaviour on tablets.
5. **Compress and cache the geometry.** Pre-gzip the GLBs, serve them with
   `Content-Encoding: gzip` and a long `Cache-Control` for `models/`, keeping
   `no-cache` for source. 25.8 MB → 15.0 MB on first load, near zero after.
   Server-side only.
6. **Backfill the 13 Pilates-relevant structures** from BodyParts3D 4.0 —
   segmental stabilisers, rib elevators, pelvic floor — and split trapezius,
   deltoid, pectoralis major, triceps, biceps femoris, gastrocnemius into their
   named parts. Requires re-running the mesh build against the 4.0 archive.
7. **A validator for our own geometry**, in the spirit of `validate-atlas.mjs`:
   every structure resolvable, every FMA id well-formed, every group non-empty,
   counts asserted.
8. **Merge draw calls.** 764 → ~8, by merging each layer into one skinned mesh
   sharing the rig and keeping the per-part meshes off-scene for picking. Large
   upstream diff; highest risk; only worth starting once 1–7 are in and measured.

Items 1–3 and 5 are additive or server-side and can land immediately. Item 4 is a
few lines upstream. Items 6–8 are builds and rewrites and are staged behind them.

---

# What was done

Items 1–5 and 7 of the plan above. Items 6 and 8 — backfilling geometry from the
4.0 archive, and merging 764 draw calls down to eight — are builds and rewrites
and are not started.

## WHAT I HAD

430 selectable structures — 152 bones, 188 muscles, 20 nerves, 70 organs — from
BodyParts3D release 3.0, in 8 GLB files totalling 25.8 MB. A rig with dual
quaternion skinning, so a muscle deforms through a pose rather than riding one
bone. A brain: fsaverage cortex, Desikan-Killiany parcellation, subcortical
structures, a network drawn inside it, and a fitted brain-to-body transform. A
library of 190 Pilates and yoga exercises mapping prime movers, synergists and
stabilisers by name, every attribution carrying an evidence marker. 91 long-form
muscle entries with origin, insertion, innervation, actions, synergists,
antagonists, in two languages and two registers. Section planes, an x-ray ramp, a
cutaway, per-structure labels in two lanes, a derived envelope shell. A session
layer: coach evaluation derived per structure from the atlas's own anatomy,
redaction at the server, a roster, accounts. 1,780 tests.

What it could not do: select more than one structure at a time, and find a
structure by name. The Explore tab listed only the 91 muscles with a written
entry plus the 21 brain regions — 112 of 451 — so a bone was reachable only by
finding it on the body.

## WHAT HUMAN ATLAS HAD

2,234 individually selectable meshes from BodyParts3D 4.0, 2.29M triangles,
merged into per-system batches and driven by two GPU state textures, so toggling
a system costs a texture upload rather than a scene-graph walk. A 3,432-concept
FMA hierarchy, searchable by name or identifier. An explosion slider that packs
every visible piece into a 2D inventory. A tap-versus-gesture state machine.
Dirty-flag rendering. A meshoptimizer pipeline with a measured 0.2% error bound,
gzip chunks with an integrity check, and validators that assert every buffer,
every index and every concept membership. React 19, Vite 8, Tailwind, shadcn,
Cloudflare Workers.

It does not have rectus abdominis, internal oblique, transversus abdominis,
quadratus lumborum, multifidus or latissimus dorsi.

## WHAT WE TOOK

- **One idea:** use the FMA concept hierarchy as a selection layer, so a reader
  can pick a set rather than a mesh. Human Atlas ships one; this repository now
  derives its own.
- **One algorithm:** `PointerTap`, ported under its MIT licence with the notice
  attached, in `web/src/pointerTap.js`.

No geometry, no manifest, no data file and no component was copied.

## WHAT WE REPLACED

- **The Explore tab's browse list.** It reached 112 of the 451 selectable
  things; it now reaches all of them, through a bilingual search over name,
  Latin and FMA id, and through 77 groups.
- **The picking gesture.** One module-level `downAt` and a 5-pixel threshold
  became per-pointer tracking with a slop that depends on whether the pointer is
  a finger, a pen or a mouse. On a tablet a pinch used to select whatever was
  under the finger that lifted first.
- **The stated licence.** Every place that said *CC Attribution-Share Alike 2.1
  Japan* now says what the licensor's own licence page says.

## WHAT WE KEPT

Everything else. The rig and the skinning, the brain, the section planes, the
exercise library, the muscle entries, the evidence tiers, the session layer, the
coach evaluation, the accounts, the measurement pipeline, all 430 structures and
all 8 GLB files. No geometry was replaced, no structure was removed, and nothing
in the exercise library lost a muscle. The 1,780 tests that passed before still
pass; the Python suite is 1,865 now, and the nine node tests carry 148
assertions between them.

## WHAT WE BUILT

**`web/scripts/build_groups.py`** — reads the BodyParts3D IS-A and PART-OF
inclusion tables (release 4.0) and the release-3.0 conventional PART-OF table,
unions them into one directed graph, closes it transitively over this atlas's own
FMA identifiers, and emits every concept resolving to between 2 and 40
structures. 252 groups, 2,320 memberships, nothing hand-assigned. Concepts with
identical membership collapse into one group that keeps every name the ontology
gave it — which is how the twelve thoracic vertebrae end up labelled *thoracic
vertebra* rather than *posterior chest*.

**`web/src/content/groups.js`** — which 77 of those 252 a Pilates or yoga studio
is offered, in seven sections, with Korean written out and a plainer English
label where the ontology's own wording is unusable (`muscle of free lower limb`
is exactly right and nobody says it). Editorial, and in a file that can be
argued with.

The Korean is in the register the atlas already speaks, and this was got wrong
first. The 91 written muscle entries use the Sino-Korean clinical terms a studio
uses — 대퇴이두근, 복직근, 요방형근 — and the groups were written in the revised
native-Korean anatomical terms instead — 넙다리 뒤칸, 볼기근, 가시근. Both are
correct Korean; together they are two dialects in one panel, and pressing
넙다리 뒤칸 lit three muscles named 대퇴이두근, 반건양근 and 반막양근. All 77 are
now in the first register (햄스트링, 대퇴사두근, 내전근군, 둔근, 척추기립근,
골반저근, 경추, 흉추, 요추, 추간판, 흉곽), and where a group *is* a muscle family
the two are checkable against each other — the group's Korean has to appear
inside at least one member's, which is what 극근 in 흉극근 means. Twelve families
are asserted that way.

**Group selection** — `setGroup` in `main.js` lights every member at one level on
the palette's activation channel, turns on the layers they live in, names them on
the picture, and frames the whole set. It shares that channel with exercise
activation because a group and an exercise are two answers to the same question,
and choosing either clears the other. Every member is lit equally, deliberately:
an exercise grades its muscles because it has evidence-marked roles to grade them
by, and a group has none.

**Anatomy search** — one box over all 451 selectable things and the 77 groups,
matching English, Korean, Latin and FMA id, shortest name first.

**A group block on every selected structure** — most specific first. It earns its
place hardest on the 152 bones, which mostly have no written entry: *fourth
lumbar vertebra* used to be a name over an apology and is now a name with the
lumbar spine, the vertebrae and the disks one press away.

**`web/src/pointerTap.js`** and `web/test/pointer.test.mjs`.

**`ATTRIBUTION.md`** — every source, its licence, what was changed, and why the
older share-alike notice is recorded rather than deleted.

**`tests/test_groups.py`** — 13 tests. Six hold the generated table (membership
resolvable, bounds, no duplicate member sets, no duplicate concept ids); six hold
the curation against it (every curated concept still exists, no concept curated
twice, no two curated groups selecting the same structures, every region known,
Korean actually in Hangul, and the Pilates core still offered); one re-derives
the whole table from the published tables and fails if any membership was ever
edited by hand.

**11 tests for the server**, 2 more for the cache rule, 3 for the groups in
`content.test.mjs`, 11 for the tap machine, and a scanner that fails on two
function declarations of one name in a file — which is the shape of two bugs
this project has now paid for, `_studio_name` in `api.py` and `haystack` in
`ui.js`.

## ANATOMY IMPROVEMENT

| | before | after |
|---|---|---|
| structures reachable from the panel | 112 | 451 |
| selectable as a named set | 0 | 77 groups |
| structures belonging to at least one group | — | 297 of 430 |
| ways to find a structure by name | none | English, Korean, Latin, FMA id |
| groups derived from the ontology | — | 252 emitted, 77 offered |

The 3,432-concept hierarchy that made this possible is the same database the
meshes came from, fetched from the licensor rather than from anybody's derived
manifest, so the anatomy still has exactly one source.

## PILATES-YOGA IMPROVEMENT

The groups a class is actually cued in are now things the application can point
at: the pelvic floor (5 structures), the hamstrings (3), the adductors (6), the
quadriceps (4), the glutes and deep rotators (10), the erector spinae (10), the
deep segmental spine (7), the scalenes, the suboccipitals, the deep neck flexors,
the calf, the sole of the foot, the lumbar spine, the rib cage.

A coach evaluating *the hamstrings* selects one thing instead of three. A student
reading about *fourth lumbar vertebra* is one press from the lumbar spine. And
the audit found what the obvious plan would have cost: 81 of the 190 exercises
name at least one of the six muscles Human Atlas has no mesh for, 54 of them as a
prime mover, so migrating to its geometry would have broken two fifths of the
library at exactly the muscles Pilates exists to teach.

## PERFORMANCE

| | before | after |
|---|---|---|
| first load, geometry | 25.8 MB | 15.0 MB |
| reload, geometry | 8 conditional requests | 0 |
| hover raycasts during a drag or pinch | every pointermove | none |
| group table added | — | 34 KB, 8 KB compressed |

The server compressed nothing and cached nothing. It now gzips on first request
into a temporary directory outside the site — the module docstring promises
nothing is written there — keyed by inode and modification time so an edited file
is never served from a stale copy, with the copy carrying the source's mtime so
conditional requests still answer 304. `models/` and `vendor/` get a week, which
is what `web/render.yaml` already gave them on the static deployment; the two
were disagreeing and the server was the one that was wrong. Everything else keeps
`no-cache`, which is there for a reason and stays.

Not done: 764 draw calls are still 764 draw calls. That is the largest remaining
win and it is item 8 below.

## LICENSES-ATTRIBUTION

- **BodyParts3D** — CC BY 4.0, verified against the licensor's own licence page
  rather than against any project's claim about it, and quoted in the exact
  wording they specify. Corrected in six places that said CC BY-SA 2.1 Japan.
  The older notice is recorded in `ATTRIBUTION.md` rather than deleted.
- **Z-Anatomy** — CC BY-SA 4.0, unchanged. The one real share-alike here, and it
  binds the nervous layer whatever the rest of the atlas is under.
- **Human Atlas** — MIT, © 2026 ashemag. Credited in `ATTRIBUTION.md` for the
  idea and for `PointerTap`; the notice travels in the ported file.
- **fsaverage / Desikan-Killiany, OpenSim Rajagopal 2016** — unchanged.

No anatomy asset is claimed as original work anywhere in this repository.

## FILES CHANGED

**New:** `ATTRIBUTION.md`, `docs/atlas-audit.md`, `tests/test_groups.py`,
`web/scripts/build_groups.py`, `web/src/content/groups.js`,
`web/src/generated/groups.json`, `web/src/pointerTap.js`,
`web/test/pointer.test.mjs`.

**Changed:** `pilates/serve.py` (gzip and cache), `tests/test_serve.py`,
`web/src/main.js` (group table, `setGroup`, `flyToGroup`, tap discipline),
`web/src/ui.js` (search, groups, the group block), `web/src/bodies.js`,
`web/src/content/strings.js`, `web/index.html` (CSS),
`web/src/generated/structures.json` and `web/models/body_frame.json` (licence
metadata only — no geometry touched), `web/scripts/bp3d.py`,
`web/scripts/build_body.py`, `web/scripts/build_nervous.py`,
`web/scripts/fetch_bodyparts3d.sh`, `web/VENDOR.md` (the patch set, listed),
`.gitignore`.

## REMAINING OPPORTUNITIES

In the order they are worth doing.

1. **Merge the draw calls.** 764 meshes into roughly 8, by merging each layer
   into one skinned mesh sharing the rig, keeping the per-part meshes off-scene
   for picking the way Human Atlas does. The `_region` per-vertex attribute and
   the palette texture that make this possible are already there; what is missing
   is a per-structure state texture for visibility so the merge does not have to
   be undone to hide anything. Largest remaining win, largest diff.
2. **Backfill the 13 Pilates-relevant structures** BodyParts3D 4.0 has and this
   atlas does not — levatores costarum, the interspinales, the intertransversarii,
   spinalis, the superficial perineal muscle — and split trapezius, deltoid,
   pectoralis major, triceps, biceps femoris, gastrocnemius and longus colli into
   the named parts 4.0 models separately. Upper and lower trapezius are different
   cues and right now they are one mesh.
3. **A validator for the geometry**, in the spirit of `validate-atlas.mjs`: every
   structure resolvable, every FMA id well-formed, triangle counts asserted. The
   group table has one; the meshes do not.
4. **A measured simplification bound.** `99% reduction` is a ratio with no error
   attached. meshoptimizer's per-structure relative error would be a number that
   means something.
5. **Dirty-flag rendering.** The loop renders every frame whether or not anything
   moved.
6. **Groups in the coach's evaluation.** `axes.js` derives its questions per
   structure; a group has synergists and antagonists of its own and could derive
   questions at the level a coach actually teaches at.
7. **Exercise-to-group mapping.** The library names muscles individually; several
   entries name every member of a group, and saying "the adductors" once would be
   both shorter and truer to the cue.
8. **Korean covers a quarter of the atlas.** Building the search made this
   measurable for the first time, and it is worse than it looked:

   | | with Korean | total |
   |---|---|---|
   | brain regions | 21 | 21 |
   | muscles | 91 | 188 |
   | bones | **0** | 152 |
   | organs | **0** | 70 |
   | nerves | **0** | 20 |
   | | **112** | **451** |

   Korean exists exactly where somebody wrote a long-form entry, and nowhere
   else. Every bone, organ and nerve falls back to its English name — so in
   Korean mode a label reads `Fourth lumbar vertebra`, and a coach searching
   요추 gets nothing. For a studio in South Korea that is the largest remaining
   content gap in the application, and it is not a translation problem: the
   Korean terms for the vertebrae, the ribs and the named nerves are standard
   and short, and BodyParts3D publishes a Japanese name per FMA id that would
   at least identify which structure each one is.
