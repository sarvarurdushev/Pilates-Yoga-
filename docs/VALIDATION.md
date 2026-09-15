# Validation record and remaining limits

Baseline: repository commit `aa061f6`. The architecture was inventoried before changes. Existing Python tests initially passed **2,369**, with one skipped, while real photographs still produced misleading standing scores. Specifically, the Warrior image scored 67.2, Messi 35.1 despite a small-body warning, and a basketball subject 92. These are examples of why passing synthetic tests does not certify the vision pipeline.

## Code checks

The rebuilt full suite passed **2,405 Python tests, one skipped** and **351 frontend tests**; Vite build passed. After the final tiling, fragment suppression, trunk signal and decoder-timestamp changes, the targeted evidence/alignment/pipeline suite passed **114 tests**, including isolated-jump regressions. Two added regressions cover fragment de-duplication and decoded video execution. Test fixtures were corrected where their purported 161×361 images contained synthetic joints at x=540/y=640; missing synthetic coordinates now have zero confidence. A bent-knee fixture now expects refusal instead of neutral-standing guidance. The authenticated legacy suite explicitly opts into auth mode; new MVP HTTP tests verify session-free photo analysis and prevent exposure of the shared workspace in authenticated studio mode.

Tests cover refusal before scoring, low detail at model resolution, missing core joints, out-of-image high-confidence hallucinations, camera-plane mismatch, floor-vs-standing behavior, missing 3D models, invalid timestamps, no repetitions across gaps, independent people, server-derived comparison values and matching video protocols. They establish those software contracts only.

## Real images and controlled stress cases

The visual bundle contains **26 declared cases**, raw per-person JSON, timings and annotated images. 9 declared negative cases all refused: Warrior-as-neutral-standing, portrait, small Messi, bent skier, head-only, head-and-shoulders, cropped legs, distant controlled subject and covered-leg case. The machine manifest records each expected outcome.

Accepted examples include a full standing photograph, Warrior, a floor plank, tree balance from front/side/back, goddess squat and an oblique inverted pose. One side-view downward-dog photograph was conservatively refused. Inspect its reason and overlay rather than interpreting refusal as absence of a human. Accepted floor exercise results are projected angles, not neutral-standing alignment scores.

Controlled class composites repeat one known photograph at counts 1, 5, 10 and 20. Final output contains exactly that many independent accepted bodies. Tiling originally produced fragments; a visibility-subset and landmark-agreement pass now removes the demonstrated partial duplicates. The ordinary pipeline's person tracking and exclusion infrastructure remains. Natural 20-person classes with crossings, occlusions and floor exercises are **not validated** by composites.

The 4° rotated-photograph comparison changed shoulder tilt from 0.0° to 4.0°, hip obliquity from −2.1° to 0.6°, and torso inclination from 2.9° to −1.0°. The score comparison was withheld because available contributors differed. This is a known camera transformation, not a before/after body improvement.

## Actual video

- TensorFlow's 4.2-second dance GIF was converted to MP4 preserving its 100 ms frame durations. It retained one track but only ~30% of tracked frames passed full-body detail gates, so movement reporting was refused.
- OpenPose's 4.1-second crowded street clip produced eight tracks with median four detections (churn 2.0). Individual movement results were withheld because identity continuity was unstable. This is neither a class nor exercise validation.
- A 52-second public yoga demo had visibility interruptions and track fragmentation; movement reporting was refused.
- A 5.93-second tree-pose demo retained the main person with ~97% full-body evidence and produced projected angle histories, with the final report correctly returning zero complete cycles. A small background person/image detection was separately refused. Frame inspection exposed two isolated wrong-leg knee estimates and a false cycle. The final temporal gate masks these samples, keeps the raw values, breaks the graph into separate continuous segments and hides the implicated joints in the video overlay. The same clip then reports zero complete knee cycles. **These public yoga demos already contain a different system's overlay.** They verify decoding, tracking, report delivery and temporal computation on real motion, but are not independent clean-video accuracy benchmarks. They are not used as ground truth or for training.

The generic cycle detector is not exercise recognition. Projected front-view knee/hip excursions in a tree pose must not be interpreted as calibrated sagittal ROM. Raw time series expose tracking and detector variation. No scientific movement-quality score, calibrated angular accuracy, 3D video temporal consistency or clinical validity is established.

## Visual QA

Browser checks cover opening without sign-in, photograph upload, body/3D rendering, rotation, anatomical labels, head-and-shoulders refusal, persisted report comparison and movement upload. Labels attach to anatomical indices; gutters and collision spacing keep the original body visible. Saved reports state when original media was not retained. Screenshots and source-overlaid model results are supplied separately from the source archive.

## Provenance and reproduction

- Google public MediaPipe assets: `male_full_height_hands.jpg`, `pose.jpg`, `portrait.jpg` from `https://storage.googleapis.com/mediapipe-assets/`.
- OpenCV sample images: [basketball1.png](https://github.com/opencv/opencv/blob/master/samples/data/basketball1.png), [messi5.jpg](https://github.com/opencv/opencv/blob/master/samples/data/messi5.jpg).
- OpenMMLab skier: [COCO test sample](https://github.com/open-mmlab/mmpose/blob/main/tests/data/coco/000000000785.jpg), retained locally as `yoga.jpg` from an early download; it is explicitly labeled a skier in the manifest.
- Yoga photographs: [Hugging Face AtomicLion1 corpus](https://huggingface.co/datasets/AtomicLion1/yoga-poses-dataset). No assumed commercial training/redistribution clearance; see model evaluation.
- [TensorFlow dance](https://github.com/tensorflow/tfjs-models/blob/master/pose-detection/assets/dance_input.gif), [OpenPose clip](https://github.com/CMU-Perceptual-Computing-Lab/openpose/blob/master/examples/media/video.avi), [public yoga demo source](https://github.com/Lavya-Thapar/Yoga_pose_detection).
- Crops, downscaled subject, rectangular occlusion, 4° roll and repeated-person canvases are clearly labeled controlled derivatives. None is called a natural group capture.

Run `python tools/validate_vision.py /path/to/corpus --out /path/to/results`; the corpus needs `cases.json` and named images. The supplied validation bundle contains the exact manifest and raw results. `tools/benchmark_models.py` accepts image files and an optional `--vitpose /path/to/model.onnx`, and records unrounded landmarks and timings for repeat experiments. The source archive excludes downloaded third-party photographs and model weights.

Before a real studio rollout, obtain consented clean front/side/back neutral photos and continuous Pilates clips from the actual camera, with diverse bodies and instructor-reviewed visible landmarks. Measure angular error, repeatability under camera repositioning, false acceptance on adversarial crops/occlusions, and identity switches in 1/5/10/20-person classes. Calibrate optics or use synchronized depth/multiview capture before claiming metric 3D or clinical ROM.

Live camera hardware and mobile-device recording were not exercised in this environment. Browser upload/decoding and rotation were exercised.
