# Pilates / Yoga Movement Analysis

One camera watches a whole class. Every student is found, given a stable
identity, and measured independently.

This is the foundation layer: **video in, tracked people with joint angles
out.** Scoring, coaching feedback and dashboards sit on top of it later.

```
video ─→ RTMO pose ─→ exclusion zones ─→ de-duplication ─→ tracking ─→ geometry ─→ movement ─→ coaching ─→ report
              │             │                  │              │           │
        every person   drop mirror        one skeleton    stable       angles,
        in one pass    reflections        per body        student IDs  symmetry
                                                              │
                                                    box overlap, with
                                                    clothing colour to
                                                    break ties in a crowd
```

## Why this design

The order of the stages is not arbitrary. It comes from benchmarking RTMO on
real studio footage before any of this was written:

- **Reflections are removed before anything else.** A reflected instructor in a
  studio mirror scored **0.81** — as confident as a real person. Confidence
  cannot separate a reflection from a student; only geometry can. In one
  segment **18% of all detections were reflections**.
- **De-duplication runs before tracking.** The model sometimes returns two
  overlapping skeletons for one body. Left alone, that one student becomes two
  tracked students, and every number downstream is wrong.
- **Tracking is last**, so neither a reflection nor a duplicate can ever be
  issued a student ID.

### Measured on real footage

A 71-second mat class (1920×1080, two students on mats plus a standing
instructor). On the stable 16-second segment:

| | Result |
|---|---|
| People found | **3 in all 95 frames** |
| Track IDs | **3, each held for all 95 frames — no swaps, no churn** |
| Mirror false positives | **0** (104 excluded across the full video) |
| Duplicates removed | 162 across the full video (11.3% of raw detections) |
| Posture classification | 190 `lying` + 95 `upright` — exactly right |

Lying down, which was the main feasibility worry, is **not** a problem:

| Posture | Mean confidence | Confident joints |
|---|---|---|
| Lying on a mat | 0.76 | 13.3 / 17 |
| Standing | 0.80 | 13.7 / 17 |

### Measured on a packed hall (the hard case)

A 2-minute wide shot of a large studio hall at 848x464, well over 60 students in
dense receding rows, everyone in downward dog.

| | Full frame | Tiled 3x3 @ 2x |
|---|---|---|
| People found per frame | 10.1 | **20.2** |
| Distinct IDs created | 92 over 240 frames | 134 over 120 frames |
| New IDs per frame | 0.4 | **1.1** |
| Median track lifetime | 11 frames | 10 frames |
| Tracks surviving half the clip | 2 | 11 |
| Speed | 5.9 fps | 0.8 fps |

**Tiling doubles detection. It does not fix identity.** At roughly 1.1 new IDs
per analysed frame the tracker is inventing a fresh student almost every frame,
so per-student history -- the entire point of the product -- does not hold in a
hall this size. Compare the mat class above, where 3 IDs held across all 95
frames without a single swap.

The limit is pixels, not the model. RTMO's exported ONNX graph has a **fixed
640x640 input**, so a wide shot is downsampled until back-row students are a
few pixels tall. Tiling raises effective resolution and recovers the middle
distance; the back rows stay out of reach, and the students it does find are
too small and too occluded to hold an identity through a crossing.

What this means in practice: this pipeline is sound for a **studio-sized class
in a normally framed shot**, and is not yet suitable for a wide shot of a
packed hall. If large classes matter, the fix is more pixels on each student --
a closer or higher camera, a second camera, or a higher-resolution sensor --
not a better tracker.

## Movement over time

A frame says where a body is; Pilates is about how it moves. The movement layer
turns per-frame geometry into per-student time series and then into
repetition-level measurements: repetitions, range of motion, seconds per rep,
tempo ratio (whether the return was controlled or dropped), a control score,
hold durations, and left/right symmetry.

```bash
python -m pilates session class.mp4 --config studio.json --out report.json
```

```
Student #1  (15.4s, 155 frames)
   measured on right_elbow (confidence 1.00)
   repetitions 4, range 59deg, 2.2s each
   control 4.75
   longest hold 3.0s
   left/right gap: knee 1deg, hip 17deg, elbow 18deg

Student #3  (15.4s, 155 frames)
   held a position - no repetitions detected
   longest hold 1.3s
```

That third student is the instructor, standing and talking. Reporting zero
repetitions for her is the correct answer, and getting it required deciding
that **a held position is a real result rather than a failure**. Half of mat
work is isometric, so a student who holds is reported as holding, never dropped
and never given repetitions invented from keypoint noise.

This is signal processing, not machine learning. No training data is needed,
every number traces back to an angle in a frame, and an instructor can check
any of it by eye. Naming the exercise being performed is a separate problem
that does need labelled data; this layer produces the input such a classifier
would consume.

Three decisions worth knowing about:

- **The measured joint is chosen, not configured.** Whichever angle shows the
  most purposeful movement -- smooth motion relative to jitter, weighted by how
  confident the underlying keypoints were -- drives the report. A knee-led
  movement and a hip-led one each get measured on the joint that did the work.
- **Repetitions need real excursion.** Turning points only commit once the
  signal reverses by more than half the minimum range, so postural sway and
  keypoint jitter cannot manufacture repetitions.
- **Control is normalised per repetition.** A clean repetition reverses
  direction exactly twice, so 1.0 is ideal. Measuring reversals per *sample*
  instead -- the first version of this -- made a student doing fast repetitions
  look less controlled than a slow one when both were equally smooth.

### Sets, sequences and holds are different things

A Pilates set repeats one movement. A yoga flow moves through different poses.
An isometric hold does not move at all. Repetition counting cannot tell them
apart on its own -- given a 60-second flow it finds the single broad rise and
fall spanning the whole sequence, calls it one 40-second repetition, and
divides the control score by it. Every number that follows is then wrong in a
way that looks plausible.

So each student is classified before being measured, and repetition, tempo and
control are reported only for a genuine set:

| Kind | What it means | What is reported |
|---|---|---|
| `repetitive` | A countable set of one movement | Repetitions, range, tempo, control |
| `sequence` | A flow through different poses | Holds, symmetry, the joint that led |
| `held` | An isometric position | Hold duration, symmetry |

Classification is on **turning-point regularity**: a set turns around at even
intervals, a flow at irregular ones, a one-way movement barely at all.
Autocorrelation was the obvious first choice and is wrong here -- any signal
with a trend correlates strongly with itself, so a steady one-way ramp scored
0.99, indistinguishable from a clean five-rep set. A set also needs at least
two repetitions: two turning points can look evenly spaced by accident, which
is how a whole flow slipped through as "one 40-second repetition".

Run on 61 continuous seconds of a real 720p studio class, seven students on
mats:

```
Tracking is sound: 1.46 identities per student, each followed for 81% of the class.

Student #4
  tracked          : 61.2s over 368 frames
  movement         : a sequence of poses, not a repeated exercise
  measured on      : right_hip (keypoint confidence 1.00)
  longest hold     : 21.0s
  left/right gap   : knee 3deg, hip 3deg, elbow 6deg
```

Three students were followed for every frame of the shot. All seven were
correctly read as flowing rather than repeating.

### The session layer refuses when it cannot tell students apart

Run against the packed hall, this layer will happily build **58 confident
report cards** for a room whose identities turn over 2.9 times per student.
Each card is assembled from about a third of one person's time, spliced with
fragments of others. The output looks entirely plausible, describes nobody, and
a teacher reading it has no way to tell.

So a session now reports its own tracking quality first, and refuses by default
when identity is too unstable to attribute movement to individuals:

```
Tracking is too unstable to report on individuals: 2.86 identities per student
(needs 1.5), each followed for only 34% of the class. Every per-student number
below would describe a fragment of somebody, not a person. Fix the camera view
before trusting any of it.

Refusing to print per-student reports. Re-run with --force to see them anyway,
but do not act on them.
```

On the mat class the same check reads: *"Tracking is sound: 1.02 identities per
student, each followed for 98% of the class."*

This is the difference between a system that is wrong and a system that is
wrong **and says so**. Everything downstream of here -- scoring, history,
coaching feedback -- inherits its trustworthiness from this gate.

### What this layer needs from footage

Session numbers only mean something across **one continuous shot of one
exercise**. Run against an edited multi-shot video and a single track spans
several different exercises, so range of motion varies wildly and tempo reads
as erratic -- not because the student was inconsistent, but because the numbers
are averaging across unrelated movements. Continuous single-camera studio
footage, which is what a real installation produces, is the valid input.

## Labelling and training data

Exercise recognition needs footage annotated with what was performed. The
workflow is three commands.

**1. Scaffold, split at the cuts.** Real class footage is edited, and finding
the cuts is work a person should not do by hand:

```bash
python -m pilates label class.mov --out class.labels.json
```

```
12 shots found across 262.9s
    2.     1.8s -    54.7s  ( 52.9s)
   10.   181.3s -   242.9s  ( 61.6s)
   ...
```

Every segment starts as `transition` -- a real label meaning "not an exercise"
rather than a blank. An untouched scaffold therefore validates cleanly and
contributes nothing to training, instead of failing or training on placeholder
text.

**2. Fill in the names, then check.** Plain JSON, times in seconds, because the
person who knows what a movement was called is an instructor with a text
editor, not an engineer.

```bash
python -m pilates check class.labels.json
```

Two things are enforced rather than left to discipline, because both quietly
ruin a dataset:

- **A controlled vocabulary.** `downward dog`, `Down Dog` and
  `downward-facing dog` are one pose to a teacher and three classes to a
  classifier, none with enough data. Unknown names are rejected with a
  suggestion (`'downward_dg' is not in the vocabulary. Did you mean
  'downward_dog'?`), and a studio can declare its own names in
  `extra_vocabulary`.
- **A video fingerprint.** Labels record the size and duration of the footage
  they were written against, so a re-encoded or swapped file is caught instead
  of silently mislabelling every frame.

Overlapping segments, backwards times and segments running past the end of the
video are all reported -- all of them at once, so one file is fixed in one pass.

**3. Build the windows.**

```bash
python -m pilates dataset class.mov --labels class.labels.json --out data.npz
```

```
508 windows of 3.0s from 3 exercises

  standing_side_bend             266
  upward_salute                  133
  mountain                       109
```

That is one four-minute video with three shots labelled, producing 508
examples across twenty tracked students. Labelling multiplies: every student
in shot contributes their own view of the same exercise.

### What a training window is

A fixed-length sequence of pose features for **one student** inside **one
labelled segment**. Two properties matter more than anything else:

- **Features are invariant to where the student is and how big they appear.**
  Keypoints are centred on the hips and scaled by torso length. Raw pixel
  coordinates encode mat position and distance from the camera, so a model
  trained on them learns the room and fails the moment a camera is nudged or a
  student picks a different mat.
- **A window never straddles a boundary.** One spanning the end of one exercise
  and the start of the next carries both and is labelled as one.

Each frame is 41 numbers: 17 normalised (x, y) pairs, six joint angles and the
trunk angle. The angles are derivable from the coordinates, but a small model
learns much faster when the quantity an instructor actually coaches on is
handed to it directly. Windows are resampled to a fixed frame count, since
detections arrive unevenly.

The build reports which exercises are still too thin to train on. Around 20
windows per exercise is where a class becomes learnable at all; several hundred
is where it gets good.

## Exercise recognition

```bash
python -m pilates train data.npz --out model.joblib
```

The model is deliberately modest: a window is reduced to summary statistics
(mean, spread, extremes, endpoints, and frame-to-frame motion) and classified
with a regularised linear model. At a few hundred labelled windows that is the
right size of tool. A temporal network has far more capacity than this data can
constrain -- it would memorise the students and report a beautiful score.

### The evaluation is the important part

This data leaks three ways at once, and a naive split hides all of them:
windows overlap so neighbours share frames; one student appears in many
windows, so a model can learn to recognise *them*; and everything comes from
one room, camera and teacher.

So training reports both numbers:

```
Always guessing the most common exercise: 52.4%

Random split (LEAKY, for comparison only): 96.9% accuracy over 5 folds
Held-out students (honest):                77.8% accuracy over 5 folds

Leak gap: +19.1 points. That is how much the random split flatters this model.
```

Those are real numbers from 508 windows of one 720p studio class. **96.9% is
the number a naive pipeline would report, and it is wrong by nineteen points.**
77.8% against a 52.4% baseline is the honest result: the model has learned
something substantial, and it is nowhere near the headline.

The per-class breakdown is where the useful detail is. Under honest evaluation
`upward_salute` recall falls to 55%, largely confused with `standing_side_bend`
-- which makes sense, because a side bend begins from arms-overhead and the two
share their opening. That is a labelling and window-length question, not a
model-capacity one.

### Held-out classes

Pass several datasets and the real question gets asked -- can this recognise a
class it has never seen:

```bash
python -m pilates dataset tuesday.mov --labels tuesday.json --session tuesday --out t.npz
python -m pilates dataset thursday.mov --labels thursday.json --session thursday --out th.npz
python -m pilates train t.npz th.npz
```

Merging datasets has two traps, both silent. Label indices are per-file, so
index 0 means a different exercise in each and concatenating them scrambles
every label; indices are remapped onto a shared vocabulary instead. And track 1
of one class is not the same person as track 1 of another, so student ids are
namespaced by session -- without that, a "held-out student" is quietly sitting
in the training set.

### Where the errors actually came from

Two investigations, both of which changed what to work on next.

**The first confusion was a labelling error, not a model defect.** Under honest
evaluation one class scored 55% recall, and the natural assumption was model
capacity. It was not: a 31-second shot had been labelled from a single frame,
and the exercise was a **standing back bend**, not the upward salute it was
recorded as. Both have the arms overhead; the frame that got checked was the
upright one at the start.

That is why `pilates preview` exists. It writes a contact sheet per labelled
segment, sampled across the segment rather than at one point, so this specific
mistake is visible before it reaches a training set.

**Correcting the label did not fix the confusion, and the reason is the
camera.** Measured across the two classes:

| | Lateral spread | Trunk angle |
|---|---|---|
| `standing_back_bend` | 0.310 | **75.8 deg** |
| `standing_side_bend` | 0.480 | **76.0 deg** |

The trunk angles are identical. A backward arch leans mostly *towards the
camera*, and that component barely projects into image coordinates, so in 2D it
looks like an upright torso. Only lateral spread separates them, and weakly.

This is a limitation of single-view 2D pose, not of the labels or the
classifier, and no amount of training data removes it. Movements that differ
mainly in the camera's depth axis need either a second camera or 3D pose
estimation. It is worth knowing which confusions are worth chasing and which
are geometry.

### What is still not measured

Every window above comes from one session. Nothing there measures transfer to
another room, camera or teacher. For that, label a second class and hold it out
entirely -- the code takes group ids, so session-level holdout is the same call
with a different grouping.

The training command also refuses to flatter itself in the obvious ways: it
prints the majority-class baseline first, warns when there are too few distinct
students for the grouped score to mean anything, and warns when two classes
make a coin flip look competent.

## Coaching notes

```bash
python -m pilates coach class.mov --exercise mountain --student 4
```

Run on a real 720p class, unedited output:

```
--- Student #1 (29s, 123 frames, pose confidence 0.75) ---
Going well:
  - the torso stayed tall and vertical (86deg)
  - the left leg was straight (174deg)
  - left and right knee matched closely (3deg)
Worth working on:
  - the hips were not level (measured 12deg, target within 8deg)

One thing for next time: the hips were not level.
```

Three rules hold throughout this layer, because it is the easiest place in the
system to produce something that sounds authoritative and is not:

- **Nothing is said that was not measured.** Every observation carries the
  number behind it and the target it was compared against, so an instructor can
  check it or disagree. A joint that was not visible produces "could not judge",
  never a guess. A test asserts that no praise or correction can be emitted
  without a measurement attached.
- **The wording is generated from the finding, not the reverse.** Templates are
  filled from structured findings. A language model can phrase these more warmly
  later; it must never be the thing that decides whether a knee was out of line.
- **This describes movement, not health.** Findings are geometric: an angle sat
  outside a range. Whether that matters for a particular body is the
  instructor's judgement, and the output says so.

Medians are used rather than means, so one badly-estimated frame cannot move a
verdict — there is a test for exactly that.

### What is covered

**36 standards**, covering the classical Pilates mat order from Joseph Pilates'
*Return to Life Through Contrology* -- the hundred, roll up, single leg circle,
rolling like a ball, single and double leg stretch, spine stretch forward, swan,
single leg kick, neck pull, bridge, teaser, swimming, leg pull front, seal --
and the yoga poses that recur in nearly every class: the sun salutation
(mountain, upward salute, forward fold, half lift, chaturanga, upward dog,
downward dog, plank, cobra) and the standing series (warriors one to three,
chair, lunges, tree, child's pose).

They encode **pose geometry**, which is definitional: a plank has a straight
line from shoulder to hip, a chaturanga bends the elbows to about a right angle.
They are not clinical judgements, the tolerances are deliberately generous, and
an instructor should read them before they are used with students. They are
data, so that is an edit rather than a code change:

```bash
python -m pilates coach class.mov --exercise my_move --standards our_studio.json
```

### Two kinds of deliberate gap

**Exercises one camera cannot judge.** Eight are named and refused with a
reason rather than left as unknowns, because they are not features waiting to
be built -- the measurement is not in a flat image:

```
$ python -m pilates coach class.mov --exercise spine_twist
spine_twist is not assessed from a single camera: rotation happens in the
camera's depth axis and barely changes the image.
This is not a missing feature. A second camera at an angle would be needed.
```

That list is `spine_twist`, `seated_twist`, `saw`, `corkscrew`, `side_kick`,
`eagle`, `triangle` and `savasana`. Triangle is there for the reason measured
earlier: like a side bend, it is confusable with a back bend from one view.
`standing_side_bend` and `standing_back_bend` do have standards, but neither
checks the trunk, and both say so in their own notes.

**Exercises where the two sides are meant to differ.** Twelve are flagged
`asymmetric_by_design` -- every warrior, both lunges, tree, single leg stretch,
single leg kick, single leg circle, leg pull front, side plank, swimming.
Symmetry is never reported for these, because telling a student their knees do
not match during a lunge is telling them off for doing the exercise correctly.
The flag is enforced in the assessment code, not merely respected by the data,
so a symmetry target added to one of them by mistake is ignored rather than
obeyed.

### Findings are checked against confounds

Two students in the sample above were flagged for uneven hips. Before trusting
that, it was worth asking whether it was really perspective: students at the
edge of frame are viewed obliquely. Measured, the flagged students sat at x=615,
162 and 518 in a 1280-wide frame, while the student at the most extreme edge
(x=1138) was **not** flagged. No correlation with frame position, so the
asymmetry is real rather than an artefact of where someone stood.

## Running a whole class

Everything else in this project works on one student at a time, which is right
for the analysis and wrong for the studio. A teacher has twenty minutes between
classes, not the patience to run four commands per person.

```bash
python -m pilates roster class.mov --start 4348 --end 5824 --out roster.json
# fill in the names by looking at roster_crops/
python -m pilates class class.mov --labels class.labels.json --roster roster.json \
    --start 4348 --end 5824 --history studio_history.json --out-dir reports/
```

One pass over the video produces a report per named student, a teacher's
summary page, and an updated history file.

### The roster

Nobody knows who student 7 is, so `roster` writes a stub **plus a reference
crop of each tracked person**, taken from the frame where they were most
confidently detected. The teacher fills in names by looking. Placeholders start
with `?`, so an unfilled roster produces no reports rather than a stack of pages
addressed to "student 7".

### A roster is only valid for one continuous shot

This was found by running the real thing rather than by reasoning about it. A
roster built from one shot was used against a whole edited video, and the run
cheerfully produced **five reports and silently skipped forty students** —
because track ids restart at every cut, so student 4 in the first shot and
student 4 in the third are different people.

That now fails loudly:

```
Refusing to run: the roster names 3 of the 43 students tracked here. Track ids
restart at every cut in a video, so a roster built from one shot does not
describe another. Build the roster over the same range you are analysing, and
run one continuous shot at a time.

This roster was built over frames 3648-4348.
Producing reports for a handful of students and silently dropping the rest
is worse than stopping. Pass --force to override.
```

Rosters record the frame range they were built over, and both commands take
`--start`/`--end` so a run can be scoped to one shot.

### The teacher's page

Individual reports do not show that six of eight students had the same problem,
which is the observation that changes what gets taught next week. The summary
groups corrections across the class:

> **3 of 7** students — the hips were not level · *mountain*
> Bea, Dan, Gia

Counts, never a bare percentage: "75%" hides that it meant three students out of
four. And counts are out of the students **actually measured in that exercise**,
not the whole register, so somebody who was occluded or arrived late is not
silently counted as having done it well.

## Student reports

```bash
python -m pilates report class.mov --exercise mountain \
    --name "Anna" --student 4 --history studio_history.json \
    --studio "Riverside Studio" --out anna.html
```

A single self-contained HTML page a studio can email, print or hand over on a
tablet. No external assets, no scripts, nothing that phones home -- a test
asserts that, because a report about a named person should not be fetching
anything when it is opened.

The page leads with one thing to work on, then what went well, what the student
actually did, and how it compares with their earlier sessions. Every observation
carries the number behind it and the range it was compared against.

The honesty rules matter more here than anywhere else in the system, because a
printed page reads as more authoritative than a terminal and the student cannot
check it:

- anything unmeasurable gets its own **Could not be judged** section rather than
  being quietly dropped;
- progress is only claimed where a change cleared that student's own
  session-to-session variation -- there is a test that noise reaches the printed
  page as "steady", never as "improved";
- the footer states that these are geometric observations, not health advice,
  and says how many frames and what pose confidence they came from.

Names and free text are escaped, with tests for that: a student called
`<script>` must not become one.

## Session history

```bash
python -m pilates coach class.mov --exercise mountain \
    --student 4 --name "Anna" --save-history studio_history.json
python -m pilates progress "Anna" --store studio_history.json
```

Two things make this harder than appending rows to a file.

**Identity across sessions is a human decision, not a computer-vision one.**
Track ids are per-video: student 4 this week is a different person from student
4 last week. A session is filed against a name the instructor supplies at
recording time. That keeps the system out of biometric identification
altogether, and it is simply more reliable than inferring identity from a wide
shot. Records are one readable JSON file, so a studio can correct a misfiled
name or hand a student everything held about them.

**Two sessions is not a trend.** Every stored measurement carries the spread it
had *within* its own session, and a between-session change must clear that
spread before it is called a change. It must also clear an absolute floor of
three degrees, because a very steady student has a tiny noise floor and a
one-degree drift would otherwise qualify as progress -- true of the arithmetic,
useless to the person being told.

### Validated by making it fail to find something

One class was split into three windows and filed as three sessions for the same
student. The correct answer is that nothing changed, and a system fooled by
noise would say otherwise:

```
Anna -- mountain
  3 session(s): 2026-01-06, 2026-01-13, 2026-01-20

Steady:
  - hip symmetry: 5.8 to 1.7deg, within the 9.3deg it varies inside a single
    session -- no measurable change
  - trunk: 85.2 to 86.4deg, under the 3deg worth mentioning -- no measurable change

Nothing has moved by more than this student's own session-to-session variation.
```

Hip symmetry going from 5.8 to 1.7 degrees looks like a seventy percent
improvement and would make a lovely progress chart. It is not one: that
measurement wobbles by 9.3 degrees inside a single class. Refusing to report it
is the feature.

Asymmetries have a right direction, so they are called improved or worsened. A
plain joint angle does not -- there is no universal correct knee angle -- so
those are only ever reported as *changed*, with the size of the change.

## Two cameras

A back bend leans towards a front-facing camera and barely moves in its image;
a camera at an angle sees that lean directly. Using a second view needs two
things: knowing which student in view A is which in view B, and combining what
both views say.

### Association: a floor-plane homography, not 3D

Every student is on the floor, so their feet lie on one plane, and a plane maps
between two views by a homography. That is fitted once at install from points
visible in both views -- mat corners are ideal. No camera intrinsics, no stereo
calibration, no synchronised shutter beyond frame-level alignment.

```bash
python -m pilates probe front.mov --grid 100 --out front_grid.jpg   # read coordinates
python -m pilates probe side.mov  --grid 100 --out side_grid.jpg
python -m pilates calibrate points.json --out floor.json
```

**Use six points, not four.** Any four points map exactly onto any other four,
so a four-point fit reports zero error however badly the points are ordered --
and clicking them in a different order in each view is the commonest
installation mistake. From five points the fit is over-determined and the error
becomes a real check; `calibrate` says explicitly whether it validated
anything:

```
Fitted from 6 floor points.
  mean reprojection error: 0.0 px
  the fit is over-determined, so that error is a real check
```

and refuses a bad one:

```
Calibration failed: points map with 55px mean error, which is too large to
associate students. The usual cause is the points being listed in a different
order in the two views.
```

Association uses the **ankle midpoint** rather than the body centre, because
hips are a metre above the floor for a standing student and on the floor for
one lying down -- the hip is not a plane point and its mapping would drift with
posture. A student whose feet are hidden, or whose nearest candidate is too far
after projection, is left unmatched rather than forced into a pair: a wrong
association fuses two people's movement into one record, which is worse than a
missing one.

### Fusion: each view summarised separately, with validity flags

A missing view contributes zeros **and a flag saying it was missing**. Without
that flag a model cannot tell "this student was upright" from "this camera
could not see this student", and will learn the second as if it were the first.

Windows are summarised per view and then concatenated, rather than summarising
fused frames: statistics of a channel that is zero half the time are
meaningless, statistics of each view plus how much of the window that view saw
are not.

See `docs/depth-ambiguity.md` for why this was chosen over 3D pose, with
measured costs.

## Camera specification

The obvious hypothesis for why the packed hall failed was resolution: students
were only ~47 px tall. That hypothesis is wrong, and the sweep disproves it.

**Experiment.** Take the mat class, where identity is perfect, and downscale it
in steps. Same scene, same poses, same occlusion -- only pixel count changes.

| Frame | Student height | Recall | Churn | Identity |
|---|---|---|---|---|
| 1920x1080 | 151 px | 96% | 1.00 | holds |
| 960x540 | 76 px | 96% | 1.00 | holds |
| 480x270 | 37 px | 96% | 1.00 | holds |
| 384x216 | 29 px | 96% | 1.00 | holds |
| 240x135 | 18 px | 92% | 1.00 | holds |
| 192x108 | **15 px** | 88% | 1.00 | **still holds** |

Three well-separated students keep their identities down to **15 px tall**.
Frame stride makes no difference either: identity held at stride 5, 10, 30 and
60. Neither resolution nor sampling rate is the constraint.

**What actually separates the two rooms:**

| | Mat class | Packed hall |
|---|---|---|
| Student height | 151 px | 47 px |
| Nearest-neighbour separation | 1.10 body heights | 0.63 |
| **Overlap with nearest neighbour** | **8%** | **36-42%** |
| **Churn** (identities per tracked student) | **1.02** | **3.35** |
| Median track life | 93 of 95 frames | 29 of 101 |

The hall has students at three times the pixel size that provably works, and
identity still collapses. The variable is **occlusion**, not size.

### The spec

- **Student height: 30 px minimum.** Detection recall is 96% at and above this,
  and starts falling below it. There is margin -- 15 px still tracked -- but 30
  px is where recall is unimpaired.
- **Neighbour overlap: 15% maximum.** This is the binding constraint. At 8%
  overlap identity is perfect; at 36% it fails outright.

Overlap is the number to design the installation around, and it is a function
of **camera angle**, not sensor resolution. Buying a 4K camera for the same low,
across-the-room viewpoint will raise student height and leave overlap
untouched, so it will not fix identity. What lowers overlap is height and
angle: mount higher, look down the rows rather than across them, or split the
room between two cameras. A 1080p camera in the right position beats a 4K
camera in the wrong one.

Use `required_sensor_height(person_px, frame_fraction)` to turn the 30 px floor
into a sensor requirement once you have measured, from a test photo at the real
camera position, what fraction of frame height a student spans.

### Appearance matching

Where boxes are ambiguous, clothing colour breaks the tie. Each tracked student
carries a hue/saturation histogram of their **torso only** -- the box of someone
in downward dog is mostly floor, and floor looks the same for everyone. Colour
is blended with box overlap behind a spatial gate, so a student can never be
matched to someone across the room for wearing the same top.

Measured on the packed hall, replaying one cached pose pass through the tracker
at several weights:

| Appearance weight | Distinct IDs | Churn | Median track life |
|---|---|---|---|
| 0.0 (geometry only) | 83 | 3.35 | 29 / 101 frames |
| 0.2 | 72 | 2.87 | 33 |
| **0.3** | **71** | **2.83** | **34** |
| 0.5 | 71 | 2.83 | 35 |
| 0.7 | 77 | 3.08 | 25 |

**A 16% improvement, and not a fix.** Churn falls from 3.35 to 2.83 and tracks
live 21% longer, but 2.83 is still far above the 1.5 threshold where
per-student history becomes usable. Past 0.5 it reverses, as colour starts
overruling geometry and students get swapped for a similarly dressed neighbour.

On the sparse mat class it changes nothing at all -- churn stays 1.02 at every
weight, because there were never any ambiguous candidates to disambiguate.
Free to leave on, which is why the default is 0.3.

The conclusion from the camera specification stands unchanged: **occlusion is a
camera-placement problem, and no tracker fixes it from the wrong viewpoint.**
Appearance matching buys margin around the edges of a good install; it does not
rescue a bad one.

### Measure your own room

```bash
python -m pilates sweep class.mp4 --expect 12
```

Counts people, downscales in steps, and reports where detection and identity
break for your camera and your class.

## Licensing

Every dependency is Apache-2.0, MIT or BSD, so this codebase can stay closed.

**Ultralytics YOLO is deliberately not used.** It is AGPL-3.0, and Ultralytics'
position is that any use — including internal R&D — requires either
open-sourcing your entire project or buying an Enterprise Licence. The tracker
here is written from scratch for that reason.

## Install

```bash
pip install -e .
pilates doctor        # checks Python, dependencies, disk, model weights
pilates quickstart class.mov   # the exact steps for your own video
```

**New here? Read [`docs/first-class.md`](docs/first-class.md)** — your first
class in twenty minutes, written for a studio rather than an engineer.

`doctor` names anything missing and how to fix it. `quickstart` inspects your
own video, finds its cuts, and prints the command sequence with the real frame
numbers already filled in — which is the part that is genuinely hard to guess.

RTMO weights (~79 MB) download on first run and cache in `~/.cache/rtmlib`.

## Use

**1. Inspect a camera and find your mirrors.** This writes a frame with a pixel
grid so you can read exclusion-zone coordinates straight off it:

```bash
python -m pilates probe class.mp4 --grid 200 --out grid.jpg
```

**2. Write a studio config.** See `examples/studio_mat_demo.json`. The
exclusion zones are the part that matters — they are specific to where the
camera sits and must be set once at install. There is no way to infer a mirror
from pixels.

```json
{
  "name": "my_studio",
  "exclusion_zones": [
    {"name": "left_mirror_wall", "box": [0, 0, 500, 1080]}
  ],
  "frame_stride": 5
}
```

**3. Run it.**

```bash
python -m pilates analyse class.mp4 --config my_studio.json --out results.jsonl
```

Each line of `results.jsonl` is one frame:

```json
{
  "frame": 1600, "t": 53.4, "n_people": 3,
  "n_raw": 4, "n_excluded": 0, "n_duplicates": 1,
  "people": [
    {
      "id": 13, "confidence": 0.706, "visible_joints": 12,
      "posture": "lying", "trunk_angle": 10.6,
      "angles": {"left_knee": 169.7, "right_knee": 167.8, "left_hip": 161.6,
                 "right_hip": 162.5, "left_elbow": 177.1, "right_elbow": 162.9},
      "symmetry": {"knee": 1.9, "hip": 0.9, "elbow": 14.2}
    }
  ]
}
```

`n_raw`, `n_excluded` and `n_duplicates` are exposed deliberately: if
`n_excluded` is zero at a studio that has mirrors, the zones are wrong.

## Library use

```python
from pilates import Pipeline, StudioConfig, VideoSource

config = StudioConfig.load("my_studio.json")
pipeline = Pipeline(config)

with VideoSource("class.mp4", stride=config.frame_stride) as source:
    for result in pipeline.run(source):
        for person in result.people:
            print(result.timestamp, person.track_id, person.detection.confidence)

print(f"{pipeline.stats.duplicate_rate:.1%} of detections were duplicates")
```

## Performance

**~4.1 fps at 1080p on a 4-core CPU with no GPU.** Too slow for live analysis;
a modest GPU closes the gap. For recorded classes, or with `frame_stride` set
to 5, CPU is already workable — mat work is slow and 6 fps of analysis captures
it fine.

## Tests

```bash
python -m pytest
```

58 tests, no model weights required — the pose backend is stubbed, so the
suite runs in about a tenth of a second.

## What is not done yet

- **Identity under heavy occlusion.** Appearance matching has been tried and
  measured: it buys 16%, not a fix (see Appearance matching). Beyond this,
  the remaining algorithmic options are a learned re-identification embedding
  or motion prediction between frames, and neither looks likely to close a
  3.35-to-1.5 gap. Camera placement remains the answer.
- **Exercise recognition** (naming which movement is being performed). Needs
  labelled footage; the movement layer produces the time series it would train
  on.
- Student profiles and history across sessions.
- Natural-language coaching feedback, generated from the movement summaries
  rather than from video.
- Teacher and student dashboards.

## Note on data

Footage of a class contains identifiable people. Get consent, and take advice
on your data-protection obligations before recording a real class.
