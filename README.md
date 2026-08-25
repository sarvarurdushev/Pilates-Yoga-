# Pilates / Yoga Movement Analysis

One camera watches a whole class. Every student is found, given a stable
identity, and measured independently.

This is the foundation layer: **video in, tracked people with joint angles
out.** Scoring, coaching feedback and dashboards sit on top of it later.

```
video ─→ RTMO pose ─→ exclusion zones ─→ de-duplication ─→ tracking ─→ geometry
              │             │                  │              │           │
        every person   drop mirror        one skeleton    stable       angles,
        in one pass    reflections        per body        student IDs  symmetry
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

- **Identity in large classes.** Detection scales with tiling; identity does
  not (see the packed-hall numbers above). Holding a stable ID for 20+ small,
  overlapping students is the main open problem, and it is likely a camera
  problem before it is an algorithm problem.
- Exercise recognition (which movement is being performed).
- Movement quality scoring over time — range of motion, control, tempo.
- Student profiles, history and dashboards.
- Natural-language coaching feedback.

## Note on data

Footage of a class contains identifiable people. Get consent, and take advice
on your data-protection obligations before recording a real class.
