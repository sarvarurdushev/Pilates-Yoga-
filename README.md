# Pilates / Yoga Movement Analysis

One camera watches a whole class. Every student is found, given a stable
identity, and measured independently.

This is the foundation layer: **video in, tracked people with joint angles
out.** Scoring, coaching feedback and dashboards sit on top of it later.

```
video ─→ RTMO pose ─→ exclusion zones ─→ de-duplication ─→ tracking ─→ geometry ─→ movement
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
pip install -r requirements.txt
```

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
