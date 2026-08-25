# Movements the camera cannot see

## The problem, measured

Under honest evaluation the recogniser confuses `standing_back_bend` with
`standing_side_bend`. That confusion is not a labelling error and not model
capacity. It is geometry:

| | Lateral spread | Mean trunk angle |
|---|---|---|
| `standing_back_bend` | 0.310 | **75.8 deg** |
| `standing_side_bend` | 0.480 | **76.0 deg** |

The trunk angles are identical. A backward arch leans mostly *towards the
camera*, and that component barely projects into image coordinates, so in 2D
the torso reads as upright. Only lateral spread separates the two, weakly.

No quantity of training data fixes this. The information is not in the pixels.

Two ways out: estimate depth from one view, or add a view that sees the missing
axis directly.

## Option A: 3D pose estimation

Tested with RTMW3D-x through `rtmlib`, on this project's own studio footage.

**It is not a drop-in.** The model returns `(persons, 133, 3)` where the first
two axes are crop pixels (roughly 60-300) and the third is a relative depth in
roughly -1.0 to -0.3. Those are different scales. A first attempt at measuring
sagittal lean mixed them and produced a confident-looking `0.0 deg`, which was
an artefact of dividing a ~0.5 depth by a ~200 pixel height rather than a
finding. Converting that relative depth into usable geometry needs a
calibration step that does not exist yet, so **whether 3D actually resolves
this confusion remains unverified.**

The cost is measurable, and it is substantial. Benchmarked on the same frames,
4-core CPU, no GPU:

| | sec/frame | Weights | Architecture |
|---|---|---|---|
| RTMO (current 2D) | **0.16** | 89 MB | one-stage |
| RTMW3D-x | **1.24** | 471 MB | top-down |

Nearly 8x slower at six students, and the architectures scale differently.
RTMO is one-stage: it finds every person in a single pass, so its cost is flat
in class size. RTMW3D is top-down: it crops and runs per person, so cost grows
with the class.

| Students | RTMO | RTMW3D-x (projected) |
|---|---|---|
| 7 | 0.16 s | 1.36 s |
| 15 | 0.16 s | 2.90 s |
| 25 | 0.16 s | 4.84 s |

At studio scale that is roughly 30x the compute, for a benefit that has not
been demonstrated.

## Option B: a second camera

A back bend is ambiguous from the front and unmistakable from the side. A
second camera at roughly 90 degrees sees the axis the first one cannot,
directly, with no depth estimation involved.

Cost is two RTMO passes: **0.32 s/frame, still flat in class size**, and about
15x cheaper than 3D at 25 students. It reuses the pipeline that is already
built and validated rather than introducing a model whose output needs
calibrating.

It also compounds with a finding already recorded in the camera specification:
the binding constraint on identity in a crowded room is **neighbour overlap**,
and two viewpoints give two chances for a student to be unoccluded.

The real work in this option is **cross-view association** -- deciding that
person 3 in view A and person 5 in view B are the same student. For fixed
cameras in a fixed room this is bounded and tractable: mats do not move, so the
mapping between the two views is largely static and can be established once at
install.

## Recommendation

**Second camera.** It is cheaper by an order of magnitude at class scale, it
reuses a validated pipeline, and it addresses the failure directly rather than
inferring around it. 3D pose remains interesting for single-student work --
one-on-one sessions, where top-down cost is irrelevant and depth is genuinely
useful -- but it is the wrong tool for a room of twenty.

Before buying anything, the cheap test: record one class from two angles at
once, even on phones, and check whether the back-bend/side-bend confusion
disappears when features from both views are available. That answers the
question for a morning's work rather than a hardware budget.

## What is not yet known

- Whether 3D pose resolves the confusion. Needs the depth scale calibrated.
- What second-camera angle is optimal. 90 degrees is the reasoning, not a
  measurement.
- Whether cross-view association holds when students move between mats.
