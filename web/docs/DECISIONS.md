# Decisions

Answers to §13 of `docs/PROJECT-BRIEF.md` ("Ask before you build"), given 2026-08-17.
These are settled. Do not re-ask them; change them here if they change.

---

## 1. Audience — all of them, adults

Instructors, self-training consumers, clinicians and students are all in scope. There is
**no parent/child register** — the app is for adults. Pilates and the other exercise
methods are the primary subject, not a secondary vertical.

**Consequence.** The content model carries three registers, not one, on top of the two
languages:

| register | for | source field |
|---|---|---|
| plain | consumer, student | `does` (inherited from `REGION_INFO`) |
| clinical | instructor, clinician | `sci` (inherited) |
| detail | clinician | new, collapsed by default: nerve roots, dysfunction patterns, evidence tiers |

An audience picker selects which is foregrounded; `does` + `sci` stay visible together as
they do today, because that pairing is why the inherited app reads for two audiences at
once. Every field is still keyed `en` / `ko`.

## 2. Licensing — all sources are available

BodyParts3D (CC BY-SA 2.1 JP), Z-Anatomy (CC BY-SA 4.0), OpenSim (Apache 2.0), MakeHuman
(CC0) and Mixamo are all usable for this project. SMPL / SMPL-X remain out.

**Consequence.** Each build script emits the licence and attribution of the source it
consumed alongside the mesh table it already prints, and those accumulate into a single
credits surface in the app. Share-alike attribution obligations attach to redistribution
whichever way the product is licensed, so recording provenance per asset at build time is
the cheap way to keep that correct rather than reconstructing it later.

## 3. The child-assessment half — dropped

`src/assessment/`, `SKILL_REGION`, `SKILL_ORDER`, `SKILL_LABEL`, `sampleResult.js`, the
score panel and `test/scoring.test.mjs` come out. The English-test → brain-region mapping
is not part of this project.

**Consequence.** `src/report.js` is kept and re-aimed at a workout/anatomy summary — the
"every number shows its own arithmetic" discipline in it is the best idea in the inherited
codebase and survives the removal.

## 4. User data — designed for a backend that does not exist yet

Static site now; server storage and accounts later. Workout logs, saved sessions and body
measurements are all in scope eventually.

**Consequence.** Nothing is persisted yet — the app holds no user data at all, so there is
currently nothing to disclose. When persistence arrives it goes behind a storage interface
with a localStorage adapter first and a server adapter after, so the schema is not
retrofitted onto direct `localStorage` calls scattered through the UI. Anything stored
locally must be exportable and clearable by the user, and the "stays on your device" notice
must be written in `en` / `ko` before the first write, not after.

**`server/` was deleted, deliberately.** Its schema was entirely about children, branches
and English assessments — the half that decision 3 drops — so it could not have been reused
without a rewrite, and leaving it in place would have meant a Postgres schema for child
records sitting in a Pilates app. Two things in it are worth recovering from git history
rather than rewriting when the backend arrives: the AES field-encryption helper for PII,
and the session-auth middleware. `git show 804b655:server/` has them.

## 5. Pilates content review — named reviewers, plus an anatomy-only mode

There is an instructor, and the project owner also reviews. Separately, the app gets a
mode that shows **anatomy and evidence only** — no cueing, no contraindications, no
instruction to perform anything.

**Consequence.** Two independent mechanisms:
- Every `EXERCISE` entry carries `reviewed: { by, credential, date }` or `reviewed: false`,
  and unreviewed entries render a visible banner. The reviewer is credited in the app.
- A global instruction toggle. With instruction off, the app describes what muscles and
  brain structures do during a movement and shows nothing that reads as "do this".

**The reviewer of record is Dr. Hong Jong Gi**, who teaches **both Pilates and yoga**, so
both disciplines carry the sign-off with the date. Their certification was not supplied, so
`credential` is `null` and the credit renders without it — an invented qualification would be
exactly the sort of thing the disclaimers exist to prevent. Gym, CrossFit and endurance
entries stay `reviewed: false`, because they are outside the reviewer's remit and saying
otherwise would be a lie about who checked what. `REVIEWED_DISCIPLINES` in `exercises.js` is
the single place that distinction lives, and `test/library.test.mjs` enforces it in both
directions: a Pilates or yoga entry without the sign-off fails, and so does a gym entry with
one.

## 6. Deployment — static site

Ships as files, with no build step: `render.yaml` publishes the repository root. Vite is
still available (`npm run build`) but nothing depends on it. See the note under decision 4
for why `server/` is not sitting in the tree waiting.

---

## Consequences already landed

- `src/regionPalette.js` + the `brainMaterial.js` rewrite (§6 of the brief) — the 16-region
  ceiling is gone. Proved byte-identical against the old shader by `test/render/`.
- `BODY_FRAME` / `BRAIN_TO_BODY` in `src/frame.js` (§5) — **measured**, not estimated.
  `scripts/derive_frame.py` reads the ASIS off the hip bones and fits the brain placement to
  ten shared structures; both `provisional` flags are false.
- 431 structures across four layers from BodyParts3D (§7), with the FMA id table emitted to
  `src/generated/structures.json`.
- The content model (§10): `MUSCLE_INFO`, `EXERCISE`, `EXERCISE_BRAIN`, `MOVEMENT_PATHWAY`,
  all `en`/`ko`, with `test/content.test.mjs` enforcing tiers, citations and name resolution.
- Layer stack, view bar, register switch, instruction toggle, schematic pathways, report.

## Also landed

- **§7's nervous layer.** 20 named routes from Z-Anatomy, which carries nerves as bevelled
  curves. `bpy` opens the 306 MB Blender atlas headlessly; the curves register into the body
  frame against eight shared bones at 8.2 mm. The muscle → root → cord → brain traversal now
  anchors to real nerve geometry below the neck; only the intracranial arcs remain schematic,
  because this model carries no tractography.
- **§9, animation.** A rigid-body rig from Rajagopal 2016 — published joint centres and
  rotation axes, not drawn ones — with joint-angle clips for nine exercises, breath-phase
  markers on the timeline, and a scrubber. Scrubbing is the primary interaction; play just
  advances time.
- **§4.2, OpenSim.** 80 muscle-tendon paths with their published max isometric force,
  optimal fibre length, tendon slack length and pennation angle. Muscle-tendon length is
  recomputed from path geometry every frame, so it is real: flex the hip in the Hundred and
  gluteus maximus reads 126% of its neutral length.
- **§13.5's reviewer credit.** Recorded — see decision 5.

## Also landed, second pass

- **The trunk is no longer one rigid body.** `scripts/build_spine.py` replaces Rajagopal's
  single lumbar joint with **24 vertebral joints**, centred on the intervertebral disc
  centroids BodyParts3D already segments, with per-level ranges from White & Panjabi 1990 —
  280 degrees of sagittal range across the chain. A clip writes a regional command and the
  rig distributes it by each level's own published range on that axis; `lumbar_wave` sweeps a
  travelling front through the region so a roll-up peels head-first and a bridge peels
  tail-first. The smoke test asserts the levels actually disagree partway through the peel,
  which is the only thing that distinguishes segmental articulation from a block hinge.
- **Muscle meshes no longer tear under the rig.** `src/skin.js` converts them to
  `THREE.SkinnedMesh` with four-influence inverse-distance weights against per-segment bone
  capsules, so a muscle crossing a joint deforms instead of shearing off its origin.
- **The library.** ~190 exercises across Pilates and yoga, as records rather than prose, with
  a shared vocabulary of positions, joint actions, faults, cues, contraindication classes,
  families and props — all bilingual, all checked. `library/compose.js` renders a record into
  an entry *and* its clip from the same numbers, so the animation and the text cannot drift
  apart. Six brain claims were added for what yoga asserts and the aerobic literature does
  not cover: slow-breathing HRV, stretch tolerance, yoga and affect, body schema, the default
  mode network, and sleep.
- **The knee works.** `parse_opensim.py` was treating every `TransformAxis` as `value * axis`,
  but OpenSim puts a *function* on each axis, and the knee's two translations are cubic
  splines whose entire range is seven millimetres. At 90 degrees of flexion the rig was
  putting the tibia more than a body height in front of the femur. Both the build and the
  viewer now evaluate the published functions, and `test/library.test.mjs` places the real rig
  and asserts the knee joint centre stays put while the heel travels.
- **The poses are checked as geometry, not only as numbers.** A pose inside every published
  range can still be the wrong exercise: the pelvis is the rig's root, so `hip_flexion: 100`
  on a standing figure raises both legs to horizontal instead of folding the trunk. Fifteen
  standing poses were written that way. The tests now place the real rig and check where the
  feet, hands and head end up — a standing pose keeps a contact point under the body, an
  inversion puts the hips above the head, a hand-supported pose has its hands and feet on the
  same floor.
- **The muscle atlas.** 91 muscles with attachments, innervation and root levels, up from 25,
  because an exercise that highlights a muscle with nothing to read hands the user a coloured
  shape.

## Also landed, third pass

- **The supine repertoire was performing itself face down.** `pelvis_tilt: -90` lays the
  figure prone, not supine, so every lying exercise was inverted and every leg raise drove the
  leg into the mat — all of it inside the published joint ranges, and none of it visible in
  any assertion about coordinates. The same class of error had the spine's `_flex` axis
  backwards, so every chest lift extended the neck and every backbend folded forward.
- **Six coordinates stop using Rajagopal's gait limits.** The model was built to walk. Walking
  never lifts an arm overhead, folds a knee past 120 degrees or a hip past 120, so those caps
  are the box its solver was asked to search, not a statement about a joint. They now take
  normal adult goniometry (Norkin & White 2016) and `rig.json` records, per coordinate,
  whether its range came from the model or the literature. The two range clamps the previous
  pass shipped are gone with them.
- **Root placement is solved, not authored.** `pelvis_tilt` and `pelvis_list` are where the
  figure sits in the world, not anatomy, so `tools/solve.mjs` derives them from each entry's
  position class and writes them back into the record. Fifty-two poses were wrong before it
  ran and none are now.
- **`npm run poses` draws all 190 as stick figures.** The lesson of this pass is that a pose
  can be legal, pass every assertion, and still not be the exercise — and the only way to know
  is to look. The sheet is the artefact that makes looking cheap enough to do every time.
- **The position vocabulary grew the classes the repertoire actually uses**: `squat`,
  `balance`, `plankSupine`, alongside the existing `standingFold` and `quadruped`. Each has a
  geometric rule in `test/library.test.mjs`, so a pose filed under the wrong one fails.

## Also landed, fourth pass

- **The muscle layer was a blob and the brain floated beside the head.** Both were visible
  from across the room and neither had a test. The muscles: `skinMesh` chose the four nearest
  bone capsules out of all 47, and across a body *nearest* is not *attached to*, so weights
  reached the opposite leg and halfway up the spine and dragged every muscle with whatever
  moved. Weights now come from the bound segment's ancestors and descendants only, filtered
  by side — a muscle spans a chain, never a fork. The brain: it was never bound to anything,
  so it kept the placement `BRAIN_TO_BODY` gave it on a standing figure. It rides the skull
  now.
- **A blanket edit put the arms overhead in every plank.** Raising the shoulder range was
  right; applying it with a regex was not. The geometry rule that should have caught it was
  too weak — with the body horizontal, an arm reaching straight overhead lands level with the
  feet just as a supporting arm does. The rule now asks whether the arm points *down*: the
  shoulder has to sit above whatever the arm rests on.
- **The position vocabulary grew again**, because the rules only work if the classes are
  real: `pike` for the inverted-V shapes that were filed as planks and then failed a
  level-trunk rule they should never have been subject to, and `armBalance` for the shapes
  where the hands are the only floor contact.

## Also landed, fifth pass

- **Skinning follows each muscle's span.** Weighting by distance to the nearest bone capsule
  keeps a muscle in the right place but lets the weight vary non-monotonically across it, so
  the abdominal wall tore open and the limbs stretched into strands under a pose. Weights now
  run along the chain a muscle actually crosses — taken from its OpenSim path where it has
  one, since a path's first and last points are its real origin and insertion — so they vary
  smoothly by construction and a muscle bends rather than tearing.
- **The movement view opens on meshes.** It opened on paths for two different reasons in
  turn, both now fixed: a rigid bind tore muscles at every joint, and then the geometric
  weights dragged the layer into a blob. The paths remain one toggle away and remain the
  source of truth for anything numeric.
- **The camera framed the wrong body.** `Box3.expandByObject` on a SkinnedMesh returns the
  rest bounds, because the mesh sits at the identity and its vertices are deformed on the GPU.
  Every posed figure was framed as if it were standing, which is why they all arrived small
  and off-centre. Framing now measures the rig's joints.
- **Leader lines are capped.** A label rope longer than about half the viewport stops reading
  as "this label belongs to that structure" and starts reading as a line drawn across the
  picture, which is what a posed figure produces once the body no longer fills the frame.
  Labels that cannot reach a lane within that distance are dropped rather than drawn.

## Also landed, sixth pass

- **A pose no longer inherits the one before it.** `Rig.setAll` wrote only the coordinates it
  was given, so a coordinate the new pose did not mention kept the old value. Selecting the
  Hundred and then Warrior II left `pelvis_tilt` at 90 and drew Warrior II lying on its back —
  in the app only, because every tool that draws poses called `reset()` first. That is why the
  stick-figure sheet looked right while the screenshots did not. The reset lives inside
  `setAll` now.
- **Every weight-bearing contact is on one floor, and a test says so.** The position-class
  rules asked whether the *lowest* contact was low enough, which Warrior II satisfied while
  standing with its front foot fifteen centimetres above the back one. Fifteen poses were
  wrong the same way — written as sagittal lunges when the shape is a wide frontal stance, or
  as symmetric planks whose hands never reached the floor. A record now carries `contacts`
  naming what takes the weight, position classes carry a default, and both `tools/check.mjs`
  and the test suite hold that set to one plane. The tolerances are two, and stated: five
  centimetres between two of a kind, eight across the set, because this measures joint
  centres and a wrist does not sit at an ankle's height above the same floor.
- **The solver wants the same thing.** `pelvis_tilt` is solver-owned, so a solver that did not
  know about contacts would undo every one of those fixes on the next `poses:solve --write`.
  The contact term is now part of the objective for every class, and running `--write` over
  the whole library leaves all 199 poses passing.
- **And the supine repertoire pressed its hands through the mat.** The same sign: `arm_flex`
  negative is shoulder extension, which on a figure lying face up points the arm straight down
  into the floor. The Jackknife, the Corkscrew, Control Balance and three more were eighteen
  centimetres under. Lying poses rest on a surface rather than on discrete contacts, so they
  get their own rule: no hand more than half a body depth below the trunk it lies on.
- **The whole headstand family had its arms written backwards.** `arm_flex: -88` is eighty-eight
  degrees of shoulder *extension* — the arm behind the body — which inverted points at the
  ceiling. The handstand rested on its skull with its hands in the air above it, and no rule
  caught it because none of them asked where the head was. The five inversions now reach their
  hands and forearms to the floor, name what they rest on, and a pose whose contacts do not
  include `head` has to keep the head at or above that floor.
- **A new position class, `lowLunge`.** Lizard is the one lunge whose head is not up: the
  chest comes down over the front leg onto the forearms. Filing it as `lunge` demanded an
  upright trunk it does not have; filing it as `plank` would have described it wrongly in
  prose.
- **`utthitaChaturanga` was a forearm side plank wearing a plank's name.** Its Sanskrit field
  said `Vasisthasana (forearm)` and its muscle attributions were a side plank's — external
  oblique at 0.88, gluteus medius at 0.8 — while its key claimed otherwise. Renamed to
  `vasisthasanaForearm`.
- **The camera is aimed from the pose.** `frameRig` used one fixed three-quarter vantage,
  which looks straight down the long axis of a supine body: the Hundred foreshortened into a
  heap. It now takes the short horizontal axis of the joint cloud and solves the fit distance
  against the real fov and aspect, instead of scaling the bounding diagonal by a constant that
  clipped an inverted figure on a wide stage.
- **The panel no longer clips itself on a narrow window.** Stacked below 1100px the panel is
  about 250px tall and the controls strip is a fixed height, which left the body sixty pixels
  and cut its first heading in half. The panel scrolls as one now, with the tabs and the
  controls pinned to its edges.
- **Short muscles are no longer stretched across joints they sit beside.** The fallback span
  read the coccygeus — four centimetres, entirely inside the pelvis — as reaching from the
  pelvis to a femur. A mesh must now be most of a chain long before it may be said to cross
  it.

## Also landed, seventh pass

- **The model had become unclickable.** `pick()` raycast the six layer groups, and
  `rig.attach` reparents every bound mesh out of its group into the rig hierarchy — so once
  the rig finished loading the groups held nothing and no part of the body, the skeleton or
  the brain could be selected by clicking it. Each layer keeps its own mesh list now, which
  does not care where in the scene graph the meshes ended up. Nothing caught this because
  every existing test selected from the panel; the smoke run clicks the picture now, samples
  the framebuffer to find where the body actually is, and fails if the points that show the
  body cannot be picked.
- **Labels pointed at where a structure had been standing.** The centroids, anchors and radii
  are measured once at load, in the rest pose — the only pose in which every structure has
  been seen — and were then read raw. During an exercise every leader rope ran to empty space
  and clicking a name flew the camera to the standing position. They are brought forward by
  the segment's own delta matrix now, and a label whose anchor is off the edge of the picture
  is dropped rather than drawn as a line running out of frame.
- **A selection now has its own colour.** It used to be shown by mixing toward the
  structure's palette entry, which on a muscle is another shade of the red already filling
  the screen. There is one signal colour for "this is the thing you asked about", the layer
  holding it is never faded, and what is in front of it is ghosted harder. A ray passes
  through a ghosted layer rather than stopping on it, so the next click is not caught by the
  thing you just made transparent.
- **Nerves are skinned.** A peripheral nerve crosses five joints and was bound rigidly to
  whichever segment its centroid sat nearest, so a bent knee left it pointing where the
  pelvis pointed and it shot out of the body. This was the "part that never moves" — visible
  in every screenshot and measured now: the smoke run fails if any nerve's posed bulk sits
  more than 0.22 body heights from every joint in the rig.
- **The labels can be filtered by system.** Four hundred structures share two lanes, so
  asking for the nerves used to mean turning off four layers and hoping. Bones, muscles,
  nerves, organs and brain, with counts, and choosing one turns its layer on.
- **The exercise filters are grouped and combine.** They were four unlabelled rows of chips
  where only one value applied at a time, so picking "mat" threw away "yoga". Each facet is
  now a labelled group holding a set — discipline, equipment, family, level, props — values
  within a group are alternatives and groups narrow together.

## Also landed, eighth pass

- **The viewer's forward kinematics disagreed with the build's, and the hand paid for it.**
  `scripts/parse_opensim.py` walks OpenSim's joint tree in numpy and fits the registration
  against the result; `src/rig.js` rebuilds the same tree in three.js and is what actually
  draws. Two implementations of one thing, and only one of them was ever checked. OpenSim
  expresses a joint in both bodies' frames, so getting from the joint to the child body means
  undoing the child's offset frame — which carries a rotation as well as a translation. The
  Python did that; the JavaScript applied the translation and dropped the rotation. Fourteen
  joints carry a non-zero child orientation: both knees, both ankles, both feet, and every
  joint of both arms below the shoulder. The wrist's is two right angles, so the rig's wrist
  sat 18 cm from the body's carpal bones and every hand swung about a pivot that was not
  there. It is 5.8 cm now, which is a wrist.
- **`test/rig.test.mjs` holds the two implementations together.** Every segment's world
  position at the default pose, against `worldAtDefault` — the build's own answer, already in
  `rig.json` and never read until now. It fails on the old code and passes on the new, which
  is the only reason to trust either.
- **Forty-two poses had been authored against the broken kinematics** and had to be re-solved
  against the corrected one — mostly hands, which were now the right distance from the
  shoulder and so ended up below the mat or below the floor a plank stands on. The solve
  minimises the checker's own rules and ties the two sides of anything the record wrote
  symmetrically, so a plank does not come back with its arms a degree apart.
- **The solver will not break a passing pose.** It owns the root placement and nothing else,
  so when its search cannot improve on what the record already has, it leaves it alone and
  says so. The contact rules are weighted far above the class preferences for the same
  reason: a class score is a preference, a contact rule is a hard failure.
- **Clicking a structure's name now shows the structure.** Three things were wrong at once. A
  paired structure is one region id over two meshes and its centroid is the midpoint between
  them — inside the body — so the camera aimed there and framed the ribcage. The fit distance
  had a floor of 0.3, a third of a body height, meant for framing a whole figure: a two
  centimetre metacarpal was viewed from thirty. And ghosting the layers in front reveals a
  muscle under skin but does nothing for a bone behind other bones. It frames one side now,
  from far enough out to clear the limb, along a direction chosen by casting a ray back at
  the structure from each of eight vantages and taking the one with a clear line of sight.
- **A clip is framed over its whole range.** Framing the first instant put the widest moment
  of the movement outside the viewport — the Roll Over opens with the legs down and takes
  them overhead, so they left the top of the picture a second in.

## Also landed, ninth pass

- **The wings off the shoulders and hips were single triangles stretched a hundred times
  their own length.** Weights ran along each muscle's span, which is smooth *along* the span
  and says nothing about across it. A strap survives that; a fan does not — the gluteus
  maximus wraps from the sacrum round to the femur, so two vertices a millimetre apart across
  its rim projected to opposite ends of the chain and landed on different bones. The
  along-span position is now smoothed over the mesh's own surface, welded on position first
  because the decimator splits vertices and an unwelded graph smooths each shell of a seam
  separately. Worst edge stretch across the library: 124x before, under 4x now, and `npm run
  shots` reports it per mesh so it cannot drift back.
- **Twenty-one records moved an arm a long way and never said so.** The Spine Twist holds the
  arms out at shoulder height for the whole exercise and its actions read only
  "trunk-rotation" — so the picture did something the prose never accounted for, which is
  what an unexplained detail is. Every pose that moves an arm more than 45 degrees now names
  the shoulder action, and the build fails if one does not.

## Also landed, tenth pass

- **The muscle geometry was torn open before the rig ever touched it.** The wings were fixed
  by smoothing the skinning weights, but the meshes still came apart at the seams under a
  pose, in a way no weighting change could explain. Counting boundary edges said why: 495 of
  the 730 meshes had an open boundary, and the median deep muscle had **31.5% of its edges
  hanging free** — the surface was not a surface. BodyParts3D ships split vertices (BP45 is
  5937 vertices over 3062 distinct positions), so what looks closed is a heap of shells whose
  seams line up. `fast_simplification` will not collapse an edge across a component boundary,
  so every seam was a wall it worked around, stalling far above budget and prising the two
  sides apart as it went. `glb_common.decimate` now welds on position first. 710 of 730
  meshes are closed, the twenty that are not are the nerve tubes — swept curves, open at both
  ends by construction — and the budget is reached in one pass instead of six: **1,070,378
  triangles down to 939,862**, the deep muscle layer from 256,527 to 139,496, and the model
  payload from 33.4 MB to 25.2 MB. Fewer triangles *and* no holes, because the passes that
  were being spent fighting the seams were also the ones adding them.
- **The registration numbers moved, and that is the tessellation, not the anatomy.** A
  structure's centroid is a vertex mean, so a mesh that no longer carries duplicate vertices
  weights its own surface differently: the median structure's centroid shifted 2.5 mm and the
  rig's mean registration residual went from 10.21 mm to 11.36 mm. No id changed and all 430
  structures survived. Both sides of that fit are density-biased vertex means — ours and
  OpenSim's — so a millimetre either way is what re-tessellating costs, not a worse fit. An
  area-weighted surface centroid would make the number independent of tessellation on our
  side; it is not worth a full pipeline re-run on its own.
- **Nineteen exercises have hands that hold what the exercise says.** "The hand should be
  down here" — the Single Leg Stretch reaches for the ankle and the shin, a standing forward
  fold reaches for the floor, the Seal holds the ankles. Those poses named an arm angle that
  was plausible in isolation and put the hand nowhere near the thing the cue tells you to
  hold, so the picture and the text disagreed and the reader was left to guess which was
  right. `arm_flex`, `arm_add` and `elbow_flex` are now solved per record by coordinate
  descent against a named target — a landmark on the figure, or the floor — with the hands
  held above the mat. The Single Leg Stretch's hand-to-target cost fell from 15.13 to 1.58
  and the standing fold's from 43.24 to 1.46. What is left is a joint-centre separation — the
  Single Leg Stretch's outside hand is 0.008 from the shin it holds and its ankle hand 0.162
  from the talus, which is a wrist centre held against an ankle centre with the fingers on it,
  and the Seal's hands sit 0.105 from the ankles they hold. All nineteen name their shoulder
  action, so the prose accounts for the arm the picture is moving.
- **The ankle could not point.** `ankle_angle` was still on Rajagopal's gait range, 40 degrees
  of plantarflexion, and it is the last coordinate in the model that needed the treatment
  `PUBLISHED_ROM` already gives the shoulder, hip, knee and toes: a stride needs 40, kneeling
  on the tops of the feet needs all 50 that a normal ankle has (Norkin & White). At zero the
  foot hangs perpendicular to the shin and points straight through the mat, which is where
  every quadruped pose in the library had it — the toes sat six centimetres under the knees.
  The shared `QUAD` constant now plantarflexes the ankles, and the one entry that uses it for
  a straight-legged plank takes them back out, because a plank stands on tucked toes.

## Also landed, eleventh pass

- **Nothing sinks through the floor any more, and not just the head.** The contact rule asked
  two things — that the named contacts sit on one floor, and that the head is not below it —
  and the rest of the body sank through the mat unwatched. Child's pose was written as an
  upright kneel with a slight curl and floated its heels forty-four centimetres under the
  floor its knees defined, head still above its hips; the pigeon's front foot hung twenty
  centimetres under; every quadruped in the library pointed its toes straight down through the
  mat, because `ankle_angle` at zero holds the foot perpendicular to the shin. The rule now
  walks twenty-one joint centres, in `tools/check.mjs`, in `tools/solve.mjs` and in the tests
  — all three, because the solver owns the root placement and a floor rule it cannot see is a
  floor rule the next `poses:solve --write` quietly undoes.
- **The one way out is a note that says so.** `FULL_SPLIT`, `CROSS_LEGS` and the new
  `PIGEON_ROTATION` carry `belowFloor: true` in `library/limits.js`, and each already
  explains in both languages which range the model is short of and what it costs the picture:
  ninety degrees of hip extension for a split against a published thirty, shins that cannot
  pass through each other, seventy degrees of hip external rotation for a pigeon against a
  published forty-five. A pose escapes the floor rule only by carrying one of those, and the
  build fails if such a note loses its text.
- **Child's pose is its own position class.** The kneeling score wants the head well above the
  pelvis, which is the opposite of what this shape does, so scored as an upright kneel it was
  solved into a curl in mid-air. `kneelingFold` is the class where the hips sit back on the
  heels and the chest folds over the thighs: knees, the tops of the feet, the hands and the
  forehead all on one floor, which the pose now is — spread 2 mm across six contacts, the
  pelvis a fifth of a body height above the mat.
- **A shared constant was overriding values the records stated.** `pose: { pelvis_tilt: -67,
  ...QUAD }` is not a `pelvis_tilt` of -67: a spread overrides whatever came before it, so
  QUAD's own tilt won. The record said one number, the rig used another, and
  `poses:solve --write` rewrote the visible number on every run without ever changing the
  pose — it never converged, and nothing noticed. `pelvis_tilt` is out of both `QUAD`
  constants, where it never belonged (placement is the solver's), eleven objects across the
  two libraries had their spread moved in front of the values it was eating, and four
  side-lying barrel poses got back the `pelvis_list` they had been solved to and then lost, so
  they are drawn on the side they were written for. `writeBack` now inserts after the leading
  spreads rather than before them, and a test reads the source and fails the build over any
  spread that overrides a key written before it.
- **The clickability gate was reading a stale picture.** It compares what is painted against
  what `pickAt` raycasts, and it slept 200 ms between changing the scene and reading the
  canvas — but a frame on swiftshader takes about a second, so it read the previous frame
  against the current scene and invented dead pixels. It now waits for `frameStats().frames`
  to advance, and it scans from the plain view instead of from whatever the pathway shot left
  up, since a pathway highlight dims the layers it is not about and those correctly stop being
  pick targets. Standing, the model is 1 dead point in 85 — the gate is held there.
- **The pike had no shoulder term.** Every other hand-supported class scores the shoulder
  sitting above whatever the arm rests on; `pike` did not, so the solver was free to roll the
  Elephant further over until its shoulders came down level with its hands — hands and feet on
  one floor, and an inverted heap rather than a pike.

## Also landed, twelfth pass

- **The seventh of the body that could not be clicked was never a picking bug.** The drawing
  buffer was thirty pixels taller than the box it was displayed in. `resize()` measured the
  stage and ran only on a window resize, and the header's four disclaimer chips wrap onto a
  second line once they are populated — after load, with no window resize — so the stage lost
  thirty pixels and the renderer kept the taller buffer. The picture was squashed four per
  cent vertically, and `pick` builds its ray from `getBoundingClientRect`, so every ray went
  through a point up to thirty pixels from the pixel under the pointer. That is why raising
  `PICK_MARGIN` changed nothing: the sphere test was passing and the ray was simply somewhere
  else. It measures the canvas's own box now and watches the stage with a `ResizeObserver`.
  The dead-point count went from 21 in 144 to **0 in 149**, and the smoke test fails if the
  buffer's aspect and the box's aspect ever differ again.
- **The muscles were losing up to two thirds of their volume, and that is what "flat sheets"
  was.** Not tearing — the meshes are closed and the weights are smooth — *thinning*. Linear
  blend skinning averages bone matrices, and the average of two rotations is not a rotation:
  it is a transform that shrinks, most of all halfway between them, which is exactly where a
  muscle crossing a joint has its belly. Measured on the real model: iliacus at 0.53 of its
  own volume in a seated twist, the pelvic floor at 0.54, gluteus medius at 0.60; in a down
  dog the inguinal ligament at 0.33 and gluteus maximus at 0.37. `src/dqs.js` blends dual
  quaternions instead, on the GPU and identically in JavaScript for the tools and the tests.
  A tube across a hip flexed 120 degrees keeps 27.9% of its volume under the old blend and
  98.1% under this one, and the whole hip and pelvic-floor cluster has dropped out of the
  distortion report. The raycaster had to be moved onto the same blend — three skins its
  raycast vertices with its own linear blend, so the muscle was briefly drawn in one place
  and picked in another.
- **Every muscle crossing the shoulder was bound rigidly to a single bone.** Not distorted:
  volume 1.00, edge stretch 1.0, shape perfect — and completely wrong, because the arm moved
  and the muscle did not. Pectoralis major and minor, serratus anterior, teres major,
  subclavius, coracobrachialis and all four of the rotator cuff. The cause was the rule added
  to stop the coccygeus being stretched across the hip: a mesh had to be 60% of a chain long
  before it could cross it, and the chain was measured between capsule *origins* — a
  capsule's origin is where its segment meets its parent, so the torso's sits down at the
  pelvis and "torso to humerus" measured most of a trunk. Length was never the question.
  A muscle crosses a joint when the joint centre lies *inside* it, which is true of the
  deltoid wrapping the shoulder and false of the coccygeus four centimetres away from the
  hip. `spanOf` now trims the chain to the joints the mesh actually contains, walking outward
  from the segment nearest the middle of the mesh. Both directions are tested: a pelvic-floor
  mesh must not span the hip, and a mesh wrapping the shoulder must span it.

## Also landed, thirteenth pass

- **The weight is decided at the joint now, and the sheets stopped tearing.** The previous
  pass diagnosed why pectoralis major stretched to 5.2 times its rest edge length and 1.42
  times its volume — the ramp was normalised by the *interval* of the chain polyline, and the
  torso's interval runs fifty centimetres from the shoulder down to the pelvis — and then
  failed to fix it four times. What was missing was not a better idea but a faster loop: every
  measurement drove a headless browser through the whole app, minutes per attempt.
  `tools/skinbench.mjs` does it in four seconds against the same 366 meshes, and writing it
  immediately caught that it was measuring the wrong thing: it had reimplemented
  `attachmentsOf` and appended a side suffix where the real one replaces it, so every
  left-side muscle with an OpenSim path came out bound to a right-side chain. Those four
  helpers now live in `src/skin.js` and are imported by both.
- **The scheme that worked measures the joint, not the chain.** One smoothstep per joint, over
  the signed distance along that joint's own axis — zero at the centre of rotation, growing in
  millimetres either way — cascaded outward along the chain. The half-width is a quarter of
  the muscle's own extent along that axis, so both ends saturate on their own bone and the
  turnover happens inside the muscle rather than being spread across a trunk. Swept over five
  poses and 366 meshes: worst edge stretch **5.35 to 3.32**, meshes over 3x **20 to 5**,
  distorted **45 to 33**. The bridge went from 14 distorted meshes to none. Pectoralis major
  and serratus anterior left the list entirely — the two poses that showed them worst dropped
  from 5.2 and 5.4 to 2.6 and 2.3.
- **The variant that scored best was the one that had stopped working.** Inverse distance to
  each capsule reported worst stretch 2.59 and less than half the volume error of anything
  else, and it was junk: a capsule is a long line, its distance saturates, so every vertex got
  nearly the same mixture and the muscles rode one blend of bones. One mesh in two hundred
  still had an end on each bone, against 132 before. It reports as success because a rigid
  mesh does not stretch and a dual quaternion does not lose volume — the two numbers being
  watched are exactly the two a dead skinning gets right. The bench now reports `spanning`
  alongside them and `test/skin.test.mjs` holds the weight range above 0.5, because this is a
  failure that would otherwise be shipped with a straight face.
- **What is left is bulge, not tear.** Gluteus maximus reaches 1.4 times its volume in a deep
  seated twist and sartorius 0.52 in the same pose — a long strap crossing two joints, and a
  broad sheet wrapping one. Mean volume error across all meshes went from 0.0151 to 0.0187 as
  the price of the stretch coming down, which is a per cent and a half against edges that were
  five times too long.

## Also landed, fourteenth pass

- **Fifty-five records named an action their pose never performed.** This is the "extras and
  confusing stuff that can't be explained" from the other side: the panel lists what the
  exercise does, the picture does something else, and a reader has no way to tell which is
  true. Checking it is the same trick that worked for the poses — measure the record against
  itself. An exercise performs an action if it moves through it between entry and pose, holds
  it at the pose, or holds it at the entry; all three, because a clip has two ends and Cat-Cow
  names what it does at each.
- **They sorted into three kinds.** The wrong word for the right movement: skandasana said hip
  adduction for a side lunge that abducts both hips, marichyasana said shoulder abduction for
  a bind that draws the arm across the body, two side kicks said plantarflexion for a foot the
  pose had flexed. The right word for a pose never given the movement: the Toe Balance stood
  with its ankles dorsiflexed at 26 degrees — that is standing on the heels — while naming
  plantarflexion and ankle stability; malasana squatted with 34 degrees of plantarflexion,
  which lifts the heels off the floor a deep squat is defined by keeping down; the camel and
  the upward plank named hip extension and held eight and ten degrees of it. And plain extras:
  Rolling Like a Ball and the Seal both claimed segmental articulation, and both are exercises
  about *not* articulating — the spine holds one C-curve and the body rolls on it.
- **Twenty-two records changed and one is left.** Sixteen poses were corrected and six action
  lists trimmed or renamed; `shoulder-adduction` joined the vocabulary because the bind needed
  a word and abduction was the opposite of it. What remains is the sun salutation, whose clip
  travels between two of its positions and names an action belonging to a posture in between —
  it already carries `SEQUENCE_CAP` saying exactly that, and the marker now exempts it.
- **The check is a test now**, with a `CLAIMS` table naming the coordinate and direction each
  action claims. A new action without a rule fails the build rather than passing silently.

## Also landed, fifteenth pass

- **The median nerve was in both hands at once, so it was bound to a femur.** Every nerve mesh
  held its left and right tube in one object — the median nerve spanned x -0.197 to +0.193,
  hand to hand — and a skinned mesh follows one chain of bones. What the binding chose was
  worse than a coin toss: median and radial to `pelvis > femur`, ulnar to `pelvis > femur_r`,
  musculocutaneous to the lower thoracic spine. Moving a leg dragged the nerves of both arms
  across the body, and the nerves of the hand never moved with the hand because they were
  never attached to it. One line: Z-Anatomy suffixes every paired object `.l` or `.r` and the
  build stripped it. Kept now, and each side skins to its own limb — worst edge stretch on an
  arm nerve 4.6 to 1.0. The same script was also appending its rows to `structures.json`
  instead of replacing them, and taking its next free id from a table that included its own
  stale rows, so a second run left forty nervous entries and renumbered them all.
- **The library drove four of the arm's seven degrees of freedom.** `arm_rot` appeared in two
  records out of two hundred, `pro_sup` — the forearm turning the palm over — in none,
  `wrist_dev` in none, `wrist_flex` in sixteen. So the hand continued the line of the forearm
  wherever the elbow pointed. Measured on the weight-bearing hands: eleven of fifty-seven had
  their fingertips within three centimetres of the floor, and the handstand balanced on the
  *edge* of its hand. `tools/hands.mjs` solves the four unused coordinates against four points
  at one height — wrist, both sides of the knuckles, fingertips — which needs no palm normal
  and no sign convention, and is penalised for moving the wrist itself because that is what
  the contact rules were settled against. Flat hands 6 to 46 of 57, hands at the floor 21 to
  52, thirty-two records rewritten, and a test holds it.

## Also landed, sixteenth pass

- **Two nerves rode the neck because a candidate set cannot reach an arm from C1.**
  `neighbourhood()` walks a segment's ancestors and descendants, which is the rule that stops a
  muscle binding across the body — and the axillary nerve and the brachial plexus have their
  centroid up in the cervical roots, from which the humerus is neither an ancestor nor a
  descendant at *any* radius. Both were bound to the neck alone, so their shoulder ends swung
  with the head: the scatter of yellow fragments around the shoulder in every pose that moved
  the arm. I asserted twice that reach was not the cause without measuring it, and both times
  that was wrong. `nerveNeighbourhood()` builds the set from the mesh's own geometry instead —
  sample its vertices, take the nearest capsule to each, union a reach-2 neighbourhood around
  every segment that turns up — so a tube physically lying along the arm gets the arm whatever
  its centroid says. An unrestricted set was tried first and took worst stretch from 4.6 to
  16.6; this one leaves it at 2.81. The same pass stopped trimming a nerve's span to the joints
  inside its own box: that rule keeps a four-centimetre pelvic muscle off the hip and is simply
  wrong for a tube that runs from a spinal root to a fingertip.
- **Every free arm hung at rotation zero.** The weight-bearing pass had put the loaded hands on
  the floor; the arms carrying nothing still had `arm_rot` and `pro_sup` unset in all but two
  records, so a hand could not turn over and never faced where the exercise needed it. The
  target is one scalar — `(thumb − pinky) · anterior`, thumbs forward — because the
  anatomically neutral orientation is the same in every shape the library contains: palms
  facing each other overhead, palms down in a wide stance, arms neutral at the sides. The
  first solve optimised direction alone and pushed the Barrel Swan's hand through the mat, so
  the cost carries a distance-from-the-starting-wrist term and a hard one-way penalty on
  sinking. A hundred records rewritten; mean thumbs-forward 0.52 and arms pointing backward
  down to 21 from a library where the coordinate was simply absent.
- **The header set a 476-pixel floor and phones scrolled sideways.** Four disclaimer chips, the
  title and the language switch sat in one unwrapping row, so at 390 px the fourth disclaimer
  was off the right edge — the four lines that must not move, unreadable on the device most
  likely to be holding them. A narrow breakpoint wraps the bar, gives the chips their own
  full-width row and lets their text wrap; `test/smoke.mjs` now loads the app at 390×844 and
  fails on any element wider than the viewport or any disclaimer past its edge.

## Also landed, seventeenth pass

- **Nothing had ever checked whether the anatomy stays on the body when the body moves.** Every
  rule in the project asked whether a *pose* was legal — joint ranges, contacts, the floor,
  which actions a record may name — and none asked where the four hundred and ninety-six
  structures hanging off the rig actually ended up. So a fully green build had the urinary
  bladder, the rectum, the urethra and both testes riding a femur, the left transversus
  abdominis riding a forearm, the right sacral plexus a hundred per cent bound to the right
  radius, the femoral nerve 87% bound to the torso, and every finger and toe bone, both
  metacarpal sets, the eyeballs and half the foot welded to the chest — a hundred and one
  skeleton meshes of two hundred and forty-five, so a raised arm trailed a scatter of small
  white bones and a moving leg left its foot behind. Two of those are invisible to the skinning
  bench by construction: a mesh riding one bone rigidly does not stretch and does not lose
  volume, so it reports as perfect.
- **One cause, in one line.** `nearestSegment` measured distance to a segment's *origin*, and
  OpenSim puts a body's frame at the joint where it meets its parent. The femur's origin is the
  hip centre, up inside the pelvis beside the bladder; the ulna's is the elbow, which on a
  standing figure is level with the waist. Every structure was therefore handed the segment on
  the far side of the nearest joint. The skeleton does not have that problem — its meshes are
  bound by name, every vertebra to its own level and every rib to a thoracic one — so it is now
  the reference: `buildBoneField` samples the bones into a grid and a structure's home is voted
  from its own vertices against it. Organs on a limb: five to none.
- **`tools/bindcheck.mjs` and `test/bind.test.mjs` are the check that was missing.** Each
  sample point of each structure is paired, at rest, with the piece of skeleton it is lying on;
  the body moves and the pair is measured again. Structures leaving their own bones by more
  than 1.5% of a body height: 160 to 74, worst 1.09 of a body height to 0.10. It took three
  attempts to make it non-vacuous — measuring the nearest bone rather than the same bone passes
  a bladder welded to a femur all the way down the thigh, never transforming the rigid meshes
  means an organ cannot fail whatever it is bound to, and `motion.js` converts its own tables
  to radians on load so converting again poses the body a degree and a half from standing and
  reports that nothing has moved.
- **The label lanes were sorted on a centroid that changes every frame.** `refreshPosed`
  rewrites every centroid on every frame of a playing clip, so the names traded rows
  continuously — measured in the real browser, the order changed twice in a seventeen-second
  sample at one frame per second, which at sixty is constant motion. Sorted on a rest-pose
  height now, eased rather than snapped when the lane's length changes, and with two size
  thresholds so a label on the line does not blink. One ordering over twelve frames.
- **The nine longhand clips had never been through a single pose rule.** The checker ran over
  the library records only. The Hundred drove both hands twenty centimetres through the mat and
  the roll-up thirty — negative `arm_flex` is shoulder extension, which on a supine body points
  the arm into the floor — the roll-up's top pointed both legs forty-three centimetres down
  through the mat, and the deadlift and the back squat both had the sign of `pelvis_tilt`
  backwards, so the deadlift's start and end pose was the lifter flat on his back with his feet
  in the air. Clips carry a `position` now, keyframes a `pos` where the clip travels, and every
  keyframe goes through the same battery as a record.

## Also landed, eighteenth pass

- **The skeleton was coming apart at every limb joint, and everything else is bound to the
  skeleton.** Rotate a joint through its own published range and measure the gap it opens
  between the two bones' nearest points: at rest they touch to within a millimetre, and in a
  pose they separated by up to fifteen centimetres at the radioulnar joint, nine at the wrist,
  six at the elbow, five and a half at the hip. The spine, over the same clips, opened three
  millimetres. That contrast is the whole diagnosis — the spine's centres are *this body's* own
  intervertebral disc centroids, while the limb centres came from Rajagopal through a single
  global similarity transform fitted to nine shared bones, and one similarity transform cannot
  place sixteen joints. It is not a rigging bug; it is the registration running out of degrees
  of freedom. And because muscles, nerves and the envelope shell are all bound to the
  skeleton, it is upstream of a great deal that looked wrong further down: a forearm that
  leaves the elbow takes its muscles and the median nerve with it.
- **There is no need to guess where a joint belongs — rotate it and see.** `tools/fitjoints.mjs`
  searches each joint's centre directly, three degrees of freedom, scoring on the separation
  that the joint's *own* coordinates open between the sixty closest point pairs of the two
  bones. ulna→radius 0.0855 → 0.0342 body heights, radius→hand 0.0454 → 0.0031, humerus→ulna
  0.0501 → 0.0088, calcaneus→toes 0.0403 → 0.0011, pelvis→femur 0.0352 → 0.0233. Fifteen
  joints moved, the largest by 106 mm at the wrist. Binding drift over the whole library fell
  from 159 structures past the bar to 149.
- **The bind pose is preserved exactly, and that is what makes it safe.** A joint's frame is
  `parent · T(translation) · R(orientation)` and the child body hangs off it through the
  inverted child frame, so moving the joint by δ and adding `R(childOrientation) ·
  R(orientation)⁻¹ · δ` to `childTranslation` leaves every segment's world position at the
  default pose untouched. `test/rig.test.mjs` holds the viewer's forward kinematics to the
  build's own `worldAtDefault` and would fail if it were not.
- **Two things had to be excluded, and finding out why was the work.** Rajagopal models the
  knee as a *coupled* joint — `knee_angle` drives two translations through cubic splines — so
  its centre is a function of the angle rather than a point, and fitting a fixed one to it made
  the joint itself travel forty millimetres through a hundred-and-twenty-degree bend. And
  without a price on the movement the search wandered: it found a 126 mm shift of the
  radioulnar joint for 53 mm of separation, and 86 mm at an ankle for seven. A published joint
  centre is evidence, so the correction is scored against how far it moves and only one that
  pays for itself survives — the same gains at 67 mm and 16 mm.
- **Fitting the joint *axes* as well buys nothing, and that is a result rather than a
  guess.** The largest residual after the centres are placed is `ulna → radius` at 0.035 of a
  body height, which looks exactly like a mis-registered pro-supination axis. Searching two
  degrees of freedom of axis direction takes it to 0.0343 for a 6.8-degree turn, and the other
  five single-axis joints do not move at all. What is left is the radius crossing over the
  ulna, which is what pronation is: the measure pairs points at rest and asks how far apart
  they get, and along the interosseous space that distance really does change. The shoulder
  and the hip are ball joints whose three axes already span every rotation, so there is
  nothing to fit there either.
- **The on-screen provenance had to change with it.** The timeline said the angles were keyed
  "against the joint definitions of the Rajagopal 2016 model", which is now true of the axes,
  the coupling and the ranges but not of the centres. It says so, in both languages, with the
  size of the largest correction in it.
- **Re-fitting the joints moves every hand in the library**, because the elbow and wrist
  centres decide where a bent arm reaches. Child's Pose stopped touching the mat — its elbows
  are thirty degrees rather than forty now — and Reclining Hero's forty-nine degrees of
  shoulder extension, which had been just inside the mat rule, went ten centimetres through
  it at thirty-five. Both are visible in the record.
- **The nerves came out of the leg because both skinning numbers were tuned on sheets.** A
  muscle is a sheet or a spindle and a nerve is a tube, and the two constants that decide how a
  weight turns over at a joint were fitted to the first and applied to both. `SMOOTH_PASSES`
  exists because projecting a broad muscle onto its chain is smooth *along* the chain and says
  nothing about across it — two vertices a millimetre apart across the rim of the gluteus
  maximus land on opposite ends and the triangle between them tears into a flat sheet, which is
  what the "wings" were. A tube has no such rim: its cross-section is a ring of vertices that
  all project to the same point, so there is nothing to smooth across, and forty-five passes on
  a hundred-and-twenty-vertex sciatic nerve simply diffuse the handover along the tube until it
  is a linear ramp over the whole nerve instead of a fold at the hip. The nerve then describes a
  smooth arc through a hip flexed a hundred and twenty degrees while the flesh over it folds,
  and comes out through the back of the buttock. `H_FRACTION` is the same mistake in the other
  coordinate: sizing the turnover from the mesh's own extent is joint-sized for a muscle and, for
  a femoral nerve 0.59 of a body height end to end, a blend a quarter of a body long. Nerves get
  no smoothing and a hard cap of six per cent of a body height on the half-width now. The
  sciatic goes from 0.072 of a body height outside the flesh to 0.013 and the femoral from
  0.055 to 0.015, worst nerve edge stretch falls 4.66 → 1.82, and `spanning` rises 29/33 →
  32/33 — position, tearing and how much the nerves deform at all, all three the right way.
- **That is the first thing here that moved both objectives at once, after five that did not.**
  A bigger candidate set took worst stretch from 4.6 to 16.6. Giving each nerve vertex the
  weights of the nearest muscle vertex closed the overhang to 0.014 and tore the tubes at
  fifty-one times, because two points a millimetre apart along a nerve can have different
  nearest muscles on different bones; smoothing that transfer trades one for one and beats the
  plain chain on neither. And the reading that the blend was too *narrow* — which had been
  written into the source as a comment and a `hFloor` hook — was simply wrong: swept to a floor
  of 0.08 it changed not one number, because the half-width was already larger than that. The
  hook is gone and the finding is in its place.
- **The one nerve left over was not a skinning fault, and it was not unfixable either.**
  `axillary nerve|R` sat 0.046 of a body height outside the flesh in the plough and did not
  respond to any skinning change, because 336 of its 396 vertices were at the cranium. I
  concluded that whatever Z-Anatomy carried under that name was mostly a cranial structure and
  that fixing it needed Blender and the 306 MB source, neither of which I believed was in the
  container. Both were. The lesson is the cheap one: check whether a build input is present
  before declaring it missing.
- **The cause was a substring.** `GROUPS` in `build_nervous.py` sorts Z-Anatomy's curves into
  twenty named routes by regular expression, and `axillary nerve` is a substring of
  **m**`axillary nerve`. The maxillary division of the trigeminal and its meningeal branch —
  one in the face, one inside the skull — were therefore swept into the axillary nerve, which
  in this model is a four-centimetre nerve at the shoulder. `spanOf` did exactly the right
  thing with the geometry it was given and produced `humerus > torso > T1 > C7 … > C1 >
  skull`, so the mesh came apart across the shoulder in every pose that moved the neck. Across
  the whole table this was the only real collision; the one other mid-word match,
  `vestibulocochlear` caught by `cochlear`, happened to give the right answer.
- **Three guards, because the pattern was only wrong by one word boundary.** `\b` on the
  pattern fixes this instance. `group_of` now refuses *any* match that starts mid-word and
  reports it, which makes the class impossible rather than unlikely. And `spread_of`
  single-links each route's curves nearest point to nearest point and fails the build when the
  widest gap exceeds 90 mm — the axillary group's two clusters were 145 mm apart, while the
  widest gap inside a route that really is one nerve is the sacral plexus at 36 mm. Two routes
  are collections by design and say so by name in `SCATTERED`: `spinal nerve roots` runs the
  whole spine, and `spinal cord` deliberately holds the cauda equina 208 mm below the conus.
  Raising the threshold to cover them would have been the wrong fix — at 210 mm the original
  bug passes.
- **It also recovered geometry that was being dropped.** The trigeminal's divisions are named
  for themselves rather than for their parent, so `ophthalmic nerve` and both divisions of
  `mandibular nerve` matched no group at all and never reached the model. They are in
  `cranial nerves` now, which is where the maxillary belongs too.
  `axillary nerve|L/R` is 60 vertices at shoulder height on the chain `humerus > torso`, and
  0.011 of a body height from the flesh — the measurement's own resolution floor. The worst
  nerve in the library is now `vagus nerve|R` at 0.031, deep in the mediastinum where there is
  little sampled flesh to be near.

## Also landed, twentieth pass

- **Two nerves came out of the body for the same reason, and it was how "how much of this
  structure is on that bone" was being asked.** `trimToBones` cuts a chain back to the segments
  holding a real share of the mesh, and it counted vertices. Vertex density is a proxy for
  tessellation, not for extent, and a nerve's tessellation counts its *branches*: the ulnar
  nerve fans into deep, superficial and digital branches inside the hand, so 74% of its
  vertices are there and only 4.6% are against the humerus — though a fifth of the nerve's
  length runs down the upper arm. The humerus fell under the bar, the chain lost it, and the
  whole upper arm was welded rigidly to the ulna: it swung out of the arm as a straight rod
  every time an elbow bent, which is exactly what it looked like. Counting each occupied cell
  of the bone field once instead — a spatial measure, immune to how finely a region happens to
  be tessellated — puts the humerus at 16.2%.
- **The measure is right for a nerve and wrong for a muscle, and the difference is branching.**
  Extending cells to muscles was tried and measured: multifidus runs sacrum to C4 and its 233
  vertices occupy about thirty cells, so every one of its twenty-two vertebrae comes out at one
  cell — indistinguishable from noise — and the trim welded the left one to `pelvis > L5` and
  the right to `pelvis … T9`, asymmetric and 0.114 of a body height adrift in a roll-up. Only
  the measure differs by layer now; the threshold is the same for both, because moving that as
  well measured worse for no gain.
- **The intercostal nerves could not have been fixed downstream at all.** They wrap the
  ribcage, and a nerve's candidate bones come from the capsules — a capsule being a line
  between two joint centres, every point on the lateral chest is nearer the `torso` capsule
  running up the middle of the body, or the arm hanging beside it, than to the thoracic
  vertebra it is lying against. The candidate set came out `T1, T2, torso, humerus, ulna,
  radius`, with no vertebra below T2 in it, so no chain rule however correct could put them on
  one: all eleven nerves were welded to `torso`, which in this rig is one rigid body hanging
  off T1, while every rib moved with its own vertebra. `withOccupied` adds what the bone field
  says the mesh occupies — no reach expansion, which is what over-broadened a tube last time —
  plus the run of joint tree joining those bones, and they get the thoracic spine.
- **A chain can be whole, self-consistent and still describe a third of the structure.** The
  right vagus nerve runs from the skull to the stomach; `spanOf` gave it `C1 … L2` with no
  `skull` in it at all, and the trim, which can only cut what those ends produced, kept
  `T11 > T12 > L1` — half a metre of nerve welded to three vertebrae at the bottom of it.
  `chainCoverage` asks how much of the mesh a chain accounts for and rebuilds it from the bones
  when the answer is under half. Nerves only: on muscles it took worst edge stretch from 4.10
  to 6.40.
- **Every nerve in the library is now inside the flesh to the resolution the measurement has.**
  The right vagus 0.031 → 0.015, both intercostals 0.019 → 0.012 and below, the left ulnar
  0.018 → 0.013; the worst is the right lumbar plexus at 0.018, against a floor of about 0.012
  in a neutral pose. Nerves that actually deform went 33/34 → 36/37, worst nerve edge stretch
  is unchanged at 2.86, and the muscle numbers are byte-identical to before the pass.
- **The brain could not be seen, touched or chosen once the body was posed, and one of the two
  causes was a shared Vector3.** `indexGeometry` wrote `app.centroids[id] = c` on the
  single-mesh branch — the same vector it had just stored as that mesh's *rest* measurement —
  and `refreshPosed` writes the posed position into `app.centroids[id]` with `.copy()`. So the
  first posed frame overwrote the rest centroid in place, the next frame read that as the rest
  position and applied the pose delta again, and every unpaired structure's centroid walked
  further off the body with every frame of every clip. Paired structures were accidentally
  safe: the second mesh takes the other branch and builds a fresh vector.
- **The second cause was that the brain's meshes were never in `bound`.** `bindBrain` attaches
  the *holder*, which is right — binding the meshes individually would let the cortex and the
  deep structures drift apart, and a skull does not do that to a brain — but `refreshPosed`,
  `anchorFor`, `posedSide` and `flyTo` all ask `bound` where a **mesh** is. So the brain rode
  the head correctly while every label rope and every camera flight still aimed at where it had
  been standing: in the Swan the brain is at y 0.19, z 0.37 and `flyTo` pointed the camera at
  y 0.42, z −0.03, **0.46 of a body height away** — a whole body length, which is why selecting
  a brain region showed an empty frame with the brain a small shape in a corner. Registering
  each mesh as riding `skull` costs nothing and fixes all four: the camera now lands 0.022 from
  the brain, and a grid of 1440 clicks over the picture with the brain layer alone showing
  returns 230 hits, all brain.
- **Both measurement tools had drifted from the app they exist to mirror.** Neither
  `bindcheck` nor `skinbench` called `chainFromBones` for the nervous layer, though `bindLayer`
  calls it for every layer — so both were measuring a binding the app never used, and the
  intercostal nerves in particular were being measured riding one rigid body while the app gave
  them a real chain. Fixed in both, and the binding is now written once and read three times.

## Also landed, twenty-first pass — a second body, built and then removed

A whole female body was built here and taken out again at the owner's request. The record of
what it cost and what it taught is worth keeping, because the same ground will be walked again
if a second body is ever wanted.

- **There is no freely-licensed whole-body female anatomy at this atlas's detail.** Checked
  against the files rather than recalled: BodyParts3D carries no female structures at all, and
  Z-Anatomy is derived from it, so the nerves are the same man. The only real female geometry
  available free is the Visible Human Female's *lower extremity* — half a body. VHP-Female v5.0
  is a whole scanned woman with organs and nerves but about 50 individually segmented muscles
  against this atlas's 188, and its redistribution terms are unpublished.
- **So it was built as a reshaping, driven by ANSUR II** — the 2012 US Army survey, 1,986 women
  and 4,082 men, public domain. Normalised by each subject's own stature the result is almost
  entirely transverse: landmark heights within 1% of each other, hips 1.104, shoulders 0.948,
  neck 0.894, shoulder-to-hip 1.202 → 1.032.
- **It was measurably right and visually invisible, and that is the lesson.** The app was a
  *flayed* atlas, and the outline of a flayed body is the outline of its muscles. Every number
  the reshaping moved was in the silhouette, and there was no silhouette to move. Which is how
  the skin got found: `FMA7163`, one closed whole-body surface, in the archive all along and
  never emitted because `SYSTEM_PRIORITY` names seven systems and the integumentary system is
  not one of them. **The skin stayed.** It is off by default.
- **Three checks in a row reported success and were measuring nothing.** Her stature shipped
  wrong at 1712 mm against a published 1574.8, and the check that passed it — "does the ASIS
  land at a plausible fraction of stature" — accepts any stature from 1530 to 1900 mm. The
  male genitalia were removed twice and verified twice by a max-depth comparison against the
  thighs, which cannot see a lobe hanging *between* the thighs because the thighs are just as
  far forward. Both times the report said fixed and the render said otherwise.
- **The general form of that: a check that cannot fail is not evidence, and a number is not a
  look.** What found each of these was rendering the thing on its own and looking at it.
- **A ratio-driven reshaping cannot produce a structure the source does not have.** No uterus,
  no ovaries, no breast tissue — a female/male ratio can widen a pelvis, and a breast has no
  male counterpart to form a ratio with. That ceiling is what ended the attempt.

What survived the removal and is still in the tree: the skin layer, the body registry with its
per-body frame and disclaimer composition, `deriveHome()` and `bodyFlesh()` (two camera
constants that turned out to be per-body facts), and `parse_opensim.py`'s refusal to overwrite
a rig carrying a spine or fitted joint centres.

## Also landed, twenty-second pass — the visual redesign

The brief asked for the app to stop reading as "a dark educational SaaS dashboard with a 3D
brain" and start reading as a research instrument: the anatomy as the hero, translucent
volumetric tissue, glass panels rather than cards, a restrained near-black and steel palette,
cinematic rim lighting, and information tied to the anatomy by thin annotation lines from real
anchor points.

**The brief was written for a different application.** It names NeuroLab and asks for
language-assessment data — sound discrimination, phonological memory, per-learner scores. That
application is not this one and that data does not exist here. The visual direction was applied
in full; the data was not invented. Fabricating assessment scores for a child is the exact
thing the four disclaimers exist to prevent, and it would have been the worst possible way to
satisfy a brief about looking trustworthy.

- **The room moved out of the scene and into CSS.** `scene.background` is `null` and the canvas
  is `alpha: true`. A colour set on the scene goes through ACES tone mapping, which lifts the
  deep end of any gradient to a flat charcoal — which is precisely what made the render read as
  a cut-out pasted on a page. `scene.fog` stayed in the scene, because it is a property of the
  space between the camera and the far side of the body.
- **The rim light is the one the scene never had, and it is what let the fill come down.**
  Key cooled and dropped to 1.05, fill halved, exposure 1.06 → 0.92, environment 0.85 → 0.62,
  and a 1.5-strength cool rim behind and above the subject. A specimen should be found by the
  light rather than presented under it.
- **The cortex was opaque putty pink, and three things fixed it together.** A cool desaturated
  base at low value, a tight clearcoat rather than a broad one, and a subsurface pair —
  a silhouette bloom and a scattered interior wash — on a uniform so no body layer sees them.
  The first pass went cool and kept the old brightness: pale ice, crowns clipped, sulci with
  nothing to fall to. The second was measurably cooler and put a grey brain on a pink
  cerebellum, because the cerebellum's tissue colour lives in a different file.
- **The rim exponent is high because fresnel cannot tell a silhouette from a sulcus.** On a
  gyrified surface both face away from the eye. A broad rim term lights every fold, which is
  the glowing-HUD look the brief rejects by name.
- **The head view was a hand-written vantage and is now fitted**, like `HOME` before it. It
  held the brain at about two fifths of the frame. `frameFor`'s top-bar headroom became a
  parameter in the process: the bar it clears floats over the top *left*, so a compact organ
  centred on the stage should not pay a sixth of the picture for it.
- **The labels became annotation.** Ring anchors rather than filled discs, hairline plates with
  one lit edge rather than outlined cards, quieter leaders — and a role tag on any muscle the
  loaded exercise works, taken from the record's own prime/synergist/stabiliser lists. That tag
  is the one number-like field worth putting on the picture: it is real, it is sparse, and it
  answers the question a lit muscle raises.
- **The role tag shipped once rendering nothing, and nothing said so.** It was handed
  `activation.has(id)` — a boolean, because the candidate list sorts on it arithmetically — and
  looked the role up in a table keyed by role name. Every lookup was `TABLE[true]`. Same family
  as the twenty-first pass's three checks: **a field that renders nothing is indistinguishable
  from a field that is not there**, so `test/smoke.mjs` now fails the build if no label carries
  a tag during an exercise.

## Also landed, twenty-third pass — the brain became a volume

The twenty-second pass made the app cleaner and did not change what it was. The reference image
was recovered from the session transcript rather than asked for again, and read properly it says
one thing: **the brain is translucent amber lit from inside**, its surface carrying a fine
luminous filament web, with a golden core burning through the tissue, and everything around it
cool, hairline and mostly empty glass. Cool instrument, warm living specimen. The previous pass
had it backwards — a cool grey opaque brain inside a dark console.

- **The cortex stopped being a lit surface.** It is an emission integral now: additive,
  depth-write off, both faces drawn, so a ray through the head accumulates every wall it
  crosses and the far cortex shows through the near one. No light touches it; the light is
  inside it. Overlapping folds brighten on their own, which is where the depth comes from.
- **The neural network is built from the cortex's own vertices**, which already carry their
  Desikan-Killiany parcel — so the clusters *are* anatomical regions, and selecting one to make
  its cells fire is a texel write rather than a fiction. 4.3k somas, 8.2k axons with travelling
  impulses, 8.5k dendrite segments, all animated from one float per frame.
- **The deep structures became the light source** rather than colour-coded solids hidden inside
  a shell, and they are gold at rest: a red hippocampus and a blue thalamus in the middle of an
  amber organ is a colour key, and a colour key is something you ask for.
- **The console stopped being a column.** The stage is the window; the panel floats over it as
  glass, and the label lane measures the console and stops at its edge rather than the app
  giving a quarter of the window to a document.

Five faults, and the pattern in them is the point:

- Three's `OutputPass` renders black — `RawShaderMaterial`, no `#version`, GLSL ES 1.00 against
  a 3.00 scene. `UnrealBloomPass` leaves the buffer black whenever it is not last. **Neither
  throws or logs.** An empty frame and a scene that drew nothing are indistinguishable from
  outside, so the only way through was bisecting the chain and flat-colouring the final pass to
  prove it was running and reading an empty texture.
- A **missing import** shipped in a commit because `node --check` passed. Parsing is not
  booting: the syntax was perfect and the binding was not there, so the module threw at
  evaluation and nothing downstream ran. There is a `boot.mjs` probe for this now.
- The additive volume was **never tone mapped on the direct path**, because a custom
  `ShaderMaterial` carries none of three's chunks and `toneMapping` is a chunk. It clipped flat
  white in the app while looking correct in the harness, which composes every frame.
- A **soma's screen size was unclamped**, so closing on the brain grew four thousand sprites
  together into a cream haze — at a camera distance where the tissue alone still looked right.
- **A shared material means shared userData**, and `tintStructure` read a field the cortex's
  material has never had.

The general form, again: **the harness and the app must be checked separately, because each
hides the other's faults.** The brain-only harness renders in thirty seconds and is where the
look was tuned; it composes every frame and frames the organ from further away, so it could not
see either the tone-mapping fault or the soma haze. The app takes seven minutes and is where
correctness is checked. Tuning in the fast one and never looking at the slow one is how three
of the five above survived as long as they did.

## Also landed, twenty-fourth pass — the section and the probe

- **A scan plane sweeps the brain.** Sagittal, coronal or axial, positioned or sweeping. It is
  a distance rather than a decal: the band lights where tissue *is at* the plane, so the shape
  is the anatomy's own cross-section through every gyrus, and the cells near it fire as it
  passes. Nothing is cut and nothing is projected.
- **Every cell is a thing you can put a probe on.** Hovering the network finds the nearest soma
  and anchors an annotation to it with a wire back — the parcel it was sampled from, what that
  parcel does, the strongest evidence tier among the claims attached to it, and its own firing
  phase.
- **The figure is fitted to the stage the console leaves.** It had been fitted to the whole
  window with a third of that behind glass.

The line this pass had to hold: **a cell may only say what is true of it.** There are no
per-neuron measurements here and there will not be — a soma stands for a population far below
this model's resolution. A performance score on a neuron would look exactly like the reference
image's readouts and would be a fabrication presented as an instrument reading, which is the
failure the four disclaimers exist to prevent. The probe reports provenance and a state, and
the one number it shows is the number the shader is actually using.

Two mistakes worth keeping, both of the same kind — asserting instead of measuring:

- The sign of the framing shift was written into a comment and was backwards; it would have
  pushed the figure *further* under the console. `test/frame.test.mjs` projects a point now.
- The magnitude used the subject's own half-width when it needed the frame's, which is not
  known until the fit distance is. It came out at 19 px where 168 was needed.

And one duplication accepted deliberately: `NeuralNet.fireAt` is the vertex shader's `vFire`
written a second time, the same arrangement `dqs.js` already has for the skinning blend. The
GPU owns the animation; the CPU has to answer for one cell without reading memory back. The
smoke test checks the two have not drifted.

## Open against the brief
- **Activation is authored, not solved.** Solving it needs a dynamic simulation with
  external loads. The clips carry per-phase values and the legend states plainly that the
  number is a role in the movement, not EMG amplitude and not a percentage of maximum.
- **Upper-limb muscle paths are missing.** Rajagopal's actuators are lower-limb and hip; its
  arms are torque-driven. 28 named muscles have a path model and the panel shows the block
  only where one exists.
- **Motion capture.** The joint angles are hand-keyed against published movement
  descriptions, which is the route the brief expects for Pilates. Replacing them with
  OpenSim inverse kinematics from real motion capture is the upgrade path.
- **The shoulder has no scapula.** Rajagopal's shoulder is one three-degree-of-freedom ball,
  and a real overhead reach is about 120 degrees of it plus 60 from the scapula rotating on
  the ribcage. The reach is now drawn at the published total so the hand ends up where it
  belongs, and `SHOULDER_RHYTHM` says what is missing from how it got there. The fix is a
  model with a scapulothoracic joint, not an edit to this one.
- **The shins cannot cross.** The two legs are separate chains that cannot pass through each
  other and hip adduction stops at the midline, so a cross-legged or folded sit points the
  shins forward and outward instead of one over the other, leaving the ankles lower than a
  floor would. Every affected entry carries `CROSS_LEGS`.
- **The apparatus is not modelled.** Springs, straps and a moving carriage change the load and
  the direction of resistance at every point in a reformer or cadillac movement. The clips
  show the joint motion the exercise asks for, unloaded, and every apparatus entry says so.
- **Only a handful of poses have direct EMG.** Most of the library is `inferred`, which the
  per-entry note states with a count: how many of the muscle roles are supported by a study
  measuring that exercise or the same joint action, and how many are not.
