# SEDENS vision improvement plan

What the camera analysis can and cannot do today, what Phase 3 did about it, and the
order in which to improve it. The rule (brief §11): benchmark the existing pipeline
first; never "improve the AI" by adding models.

Everything here was measured in this repository's development container (4 vCPU, no
GPU, headless Chromium with SwiftShader) or read from earlier verification files. No
real room computer, no low-end machine and no real customer photos were available, so
those rows say "not measured".

## 1. The existing pipeline

| Part | What it is |
|---|---|
| Pose model | RTMO, one-stage multi-person 2D keypoints (`pilates/pose.py`). RTMO-m locally (89 MB ONNX); the free host sets `PILATES_POSE_MODEL=s` (RTMO-s). |
| Gates | `validation.validate_body` (all of shoulders, hips and a head point visible; legs visible; nothing outside the frame; head and feet at least 0.8% from the edge; segment proportions; a 180 px body chain; upright standing with knees above 150°), then per-metric confidence ≥ 0.65 in `assessment.assess_person`. |
| Metrics | Frontal (front and rear photos): shoulder line, pelvis line, head tilt, lateral trunk lean, knee alignment proxies. Side photos: forward-head and sagittal offsets. |
| Optional 3D | MediaPipe Pose Landmarker world landmarks, accepted only where they agree with RTMO (`docs/MODEL_EVALUATION.md`). Not used by SEDENS. |
| Concurrency | One analysis per process (`assessment._ANALYSIS_LOCK`); platform jobs queue at most 3. |

### Benchmark

| Setup | Model load | Per photo | Source |
|---|---|---|---|
| Development container, 4 vCPU, ONNX Runtime 4 threads | about 1.2 s warm, about 10 s cold | 0.25–0.42 s (inference, gates and metrics); peak memory about 300–320 MB | measured in Phase 3 |
| Same, 1 thread | about 1.5 s | 0.72–1.21 s | measured in Phase 3 |
| Free host (Render free tier, RTMO-s, 0.1 CPU) | — | 33.2 s end to end for one photo job; about 2 minutes for a four-view scan | `docs/verification/2026-10-05/hosted-pipeline.json` |
| Room computer | not measured | not measured | — |

So a local room computer answers a four-view scan in a few seconds; the free host takes
minutes, which is why the free demonstration offers a clearly labelled precomputed result
and keeps the real analysis as an "experimental" option that says how long it takes.

### Repeatability (indicative only)

There is no photo corpus or test-retest data in the repository (`docs/VALIDATION.md`
keeps its 26-case bundle outside the repo, and no calibrated accuracy has been
established). One generated four-view image (`web/assets/studio/demo-four-views.png`)
was perturbed:

| Change | Effect |
|---|---|
| Re-padding or re-encoding the same front image | pelvis line moved up to 1.7°, head tilt 1.5°, shoulder line 0.5° or less |
| Darkening by half | 0.7° or less |
| Scale 0.6× or JPEG quality 30 | head tilt dropped out (confidence below 0.65) |
| Camera roll of +1°, +2°, +3° | shoulder line +1.3°, +2.2°, +3.3° (roughly one to one) |
| Front versus back of the same body | shoulder 0.5° vs 0.4°; pelvis 0.7° vs −0.8°; head −0.7° vs 0.7° |
| A horizontally mirrored front photo | still read as "front"; shoulder +4.1° became −3.8°, pelvis +3.9° became −3.1°; nothing refused |

A 2° threshold sits inside this variation for the head and pelvis lines. The shoulder
line is the steadiest of the frontal lines.

## 2. Problems found in the existing pipeline

These are the existing workspace's code and were not rewritten in Phase 3 (brief: do
not rewrite the analysis pipeline). Phase 3 works around them; section 4 is the fix.

1. **Side-view labels and the forward-head sign are inverted.** `alignment.py` decides
   that a person facing image-left shows the camera their right side, and `_facing()`
   and `forward_head()` use the same assumption. Geometry and RTMO's own visibility say
   the opposite: on the demo image's panel facing image-right, `R_EAR` scores 0.977
   and `L_EAR` 0.001, yet it is labelled `side_left`. With a correctly declared side
   view, `forward_head` comes out negative (−0.055, −0.063) on an image where the ear
   is clearly ahead of the shoulder, and the sagittal offsets are sign-inverted too.
   `tests/test_alignment.py` (`side_on`) pins the wrong convention, so the suite passes.
2. **A mirrored capture silently swaps left and right** (table above).
3. **Workspace comparisons ignore the model and measurement version.** RTMO-s results
   on the free host and RTMO-m results locally would be treated as comparable.
4. **Only one analysis runs per process.**

## 3. What Phase 3 does about them

| Problem | Phase 3 |
|---|---|
| Side views inverted | Side photos are captured (the four-view protocol) and their values appear only under Advanced, but **no customer observation ever comes from a side view** (`feedback.py`; tested). The only customer observation is the shoulder line. |
| Camera roll | The shoulder line is shown only when the front **and** back photos both exceed the threshold on the **same anatomical side**. A rolled camera raises the same image side in both photos, which is the opposite anatomical side in front and back, so roll pushes the two views apart instead of together. |
| Mirroring | The live preview is mirrored with CSS only; the uploaded still is the camera's own unmirrored picture (`room-scan.js`). |
| Threshold inside the noise | The 2.7° shoulder threshold is labelled provisional and internal ([SEDENS_FEEDBACK_EVIDENCE.md](SEDENS_FEEDBACK_EVIDENCE.md)); below it the result says the lines looked level within what a camera can tell. |
| Comparisons | A SEDENS scan is compared only with the same customer's last scan with the same protocol, the same feedback rules version, the same source class (demonstration never with real) and a clear result (`scans._previous`). |
| Free-host speed | The free host offers the labelled precomputed demonstration first; the real analysis is offered as experimental with its expected wait. |

## 4. Live capture guidance: MediaPipe in the browser?

The brief asked to investigate MediaPipe Tasks Vision Pose Landmarker for live framing
guidance only (never for measurement).

### Benchmark (headless Chromium 141 with SwiftShader, development container)

| Model, delegate | Initialisation | First frame | Median per frame | 90th percentile |
|---|---|---|---|---|
| lite, CPU | 0.46–1.35 s | 0.47–1.63 s | 60–64 ms | 91–122 ms |
| full, CPU | 0.54–0.66 s | 0.51–0.85 s | 89–95 ms | 118–139 ms |
| lite, GPU (SwiftShader, so effectively CPU) | 0.51–0.66 s | 7.1–8.3 s | 461–518 ms | 545–610 ms |
| lite, CPU, up to 4 poses | 0.46–0.59 s | 0.48–0.57 s | 96–121 ms | 130–164 ms |

Other observations:

- With up to four poses it found 3 of 4 people on a four-person test sheet and 2 of 2 on
  a two-person sheet; the full model with one pose found 0 of 2 on the two-person sheet.
  Counting people is therefore not reliable enough to tell a customer "someone else is
  in the picture".
- **Every run made a request to `https://odml.pa.googleapis.com/v1/log`**, even with the
  runtime and model served locally. A camera feature in a private room must not send
  anything to a third party without it being disclosed and agreed, and the room must
  not depend on the internet.
- Before the first frame the screen loads about 19 MB uncompressed: the 13.0 MB WASM runtime and the 5.8 MB lite model (9.4 MB for the full model).
- Not measured: a real room computer, a low-end machine, CPU utilisation, a real GPU.

### Decision for Phase 3

Phase 3 does **not** ship MediaPipe. The room uses simple, honest heuristics on a tiny
grey copy of the preview (`room-scan-guidance.js`): too dark, too bright, light behind
the person, and "hold still" until the picture is steady for about a second, which also
starts the automatic countdown. It does not claim to find a body. The server's existing
gates remain the authority, and their refusals are shown in customer language ("We
couldn't see your full body clearly. Step back slightly and try again.").

The guidance code takes any evaluator with `evaluate(frame) → {ready, message_key}`, so a
pose model can be added later without changing the screen.

## 5. Improvement order (proposed, not started)

1. **Fix the side-view convention** in `alignment.py` (`_facing`, `forward_head`, the
   sagittal offsets and the view estimator), fix `tests/test_alignment.py`'s `side_on`
   fixture, and rebuild the precomputed workspace demo (`demo_scenarios --build`), whose
   digest covers these files. Then re-verify on photos with known orientation before any
   side-view customer observation is considered.
2. **Refuse mirrored captures** where the pipeline can tell (for example a declared side
   whose near-side ear is the wrong one), and keep the kiosk never mirroring stills.
3. **Store and compare by model and measurement version** on the workspace path, as
   SEDENS already does.
4. **Build a controlled capture set**: the same fictional or consenting volunteers,
   repeated captures on different days, a measured camera height and roll, front, back
   and both sides; then report test-retest spread per metric. Only then revisit the
   provisional 2.7° shoulder threshold, and consider a second customer observation.
5. **Measure on a real room computer**: the four-view analysis time with RTMO-m, and
   MediaPipe lite on CPU with network access blocked, before deciding on pose-based
   live guidance (and disclose it in the capture consent if it is ever used).

## 6. What is measured, what is a threshold, what is claimed

| Kind | Example | Status |
|---|---|---|
| Measured | shoulder, pelvis and head lines in degrees; side offsets as ratios | RTMO keypoints, with the gates above |
| Internal technical threshold | 2.7° shoulder line; confidence 0.65; 180 px body chain | engineering choices, not clinical cut-offs; documented as such |
| Customer-facing claim | "your right shoulder sat slightly higher than the other one in both your front and back photos" | only when both views are clear and agree beyond the threshold; never a score, a diagnosis or a cause |
| Experimental | the real analysis on the free host; every side-view value | shown as such, never as a customer observation |
