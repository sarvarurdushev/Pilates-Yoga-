# Motion Study: photo, movement and evidence

This is the current local MVP. The main screen opens directly into assessment, without an account. RTMO, tiling, tracking, geometry utilities and SQLite remain. The existing authored anatomy viewer is preserved at `/anatomy.html` as reference material; it is not a reconstruction of the photographed person.

## Run

Python 3.12 was used for validation. The constraints file records the tested dependency versions; packages used only for research are not installed unless required by the requested extras. From the repository root:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -c requirements-validated.txt -e '.[dev,pose3d]'
mkdir -p models
curl --fail -L https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task -o models/pose_landmarker_full.task
PILATES_PYTHON="$PWD/.venv/bin/python" ./run-mvp.sh
```

Open `http://127.0.0.1:8000`. RTMO downloads its OpenMMLab weights on first inference and caches them. The optional `pose3d` extra and model enable learned depth; omitting them leaves a working 2D application. No Node build is needed to run the Python app: it serves `web/` directly. `npm ci && npm test && npm run build` inside `web/` checks the JavaScript and builds the main assessment page. Serve the source `web/` directory to retain the complete legacy anatomy experience.

For an already installed model elsewhere, set `PILATES_3D_MODEL` to its absolute path. `PILATES_CPU_THREADS` defaults to 4. The launcher binds loopback and uses a fresh `.local/assessments.db`; it does not migrate or erase old studio records. Use a desktop browser with camera permission for local capture. A phone opening a different computer's plain HTTP URL may not have access to camera APIs; HTTPS is needed for that setup.

## Workflow

1. Enter a consistent person label, choose or confirm the camera view, and upload a full-body photograph. Choose **Exercise pose / floor position** for bent, seated, floor or inverted positions.
2. Inspect suitability and anatomical L/R landmarks. A refusal has no measurements, no score and no reconstructed body. Automatic view detection is heuristic, especially for turned heads, occlusion and unusual poses; the chosen plane is recorded.
3. Use **Scan a wider class view** for distant groups. Wide images use two horizontal overlapping crops, retaining full image height; other group layouts use a 2×2 grid. Inspect each person independently. Capacity is not a guarantee that every person has enough detail to measure.
4. Optional **Estimated 3D** shows MediaPipe world landmarks from the person's image crop. Rotate with Front / Side / Back or drag. Its visible landmarks must agree with RTMO, and missing/uncertain bones are hidden. A side rotation is a model prediction, not an extra camera observation.
5. Upload a continuous movement clip up to two minutes. Keep the camera still. The report shows projected shoulder, elbow, hip and knee angles plus trunk inclination, continuous angle cycles, timing, ROM variation, paired L/R differences and normalized hip trajectory variation. It does not recognize an exercise or rate its correctness.
6. Before/after compares persisted server-computed values for selected people with matching subjects, views, modes and measurement versions. Video comparisons also require matching named movement protocols and explicit camera views. A score difference requires exactly the same contributing metrics. A difference is not automatically improvement.
7. Print a photo or movement report or export its JSON. Local history persists measurements, landmarks and learned 3D estimates. The browser retains source media for its current session; the server removes uploads after processing. Reopened reports honestly indicate when original media is absent.

## Measurement contract

Every photo metric has a value or null, unit, model confidence, status, permitted views, contributing joints and provenance. `MEASURED` means a computed image-plane alignment angle from detected landmarks, not independently measured anatomy. `ESTIMATED` identifies proxies, projected exercise angles and learned 3D. `UNAVAILABLE` never carries a numeric value. Model confidence is not an error bound or probability that the anatomy is correct. Opposing shoulder/hip labels are the signed ends of one shared line; they are not two independent measurements or double-weighted score contributions.

Front/back: ear-line tilt, shoulder/hip height asymmetry, lateral torso inclination, and knee alignment proxies when visible. Side: forward-head offset proxy and torso inclination. Three-quarter standing views withhold plane-dependent measurements. Exercise mode shows projected angles with an explicit depth limitation. ASIS/PSIS pelvic tilt, foot orientation, true centre of mass and calibrated distances remain unavailable.

The alignment index is an engineering rubric, not a clinical score or validated movement-quality measure. It needs at least three measured alignment angles with confidence ≥0.65. Each contributes `max(0,100*(1-max(0,abs(angle)-2)/13))`, with equal weight. Estimated proxies and 3D do not feed the score. Camera roll changes these angles.

## Gates and practical limits

The shared gate checks finite coordinates/confidences, visible head/shoulders/hips/complete leg chains, image bounds and edge cropping, source body size, broad torso/leg/head/arm ratios and standing-only joint ordering/stance. Side views can use one complete visible leg. Source body chain must reach 180 pixels and estimated model-resolution body chain 120 pixels. These are conservative engineering thresholds, not anthropometric standards. Projected foreshortening can cause a valid person to be refused.

Geometry and model confidence cannot prove that hidden anatomy is visible. Independent 2D agreement helps vet the 3D display but is not a ground-truth oracle. A convincing hallucination from both models can still pass. Test the actual deployment camera, varied bodies, clothing and occlusions before using this for consequential fitness decisions.

Temporal analysis splits gaps over 0.6 seconds and missing samples. It excludes isolated angle spikes instead of interpolating them, preserves raw samples, and withholds a joint signal if more than 20% of its observed samples are such spikes. It refuses insufficient continuous evidence, fewer than 12 valid frames, <60% body visibility during tracked time, or high track churn. It uses decoder timestamps where available and labels a nominal-FPS fallback. Hip trajectory spread includes intentional travel, camera motion and detector noise; it is not a calibrated balance score. No per-frame 3D motion reconstruction or temporal mesh is claimed.

The single-frame floor/back/side cases and small real video set are exploratory. Natural crowded 20-person Pilates tracking, person crossings, fisheye correction, mirror exclusion in the new screen, capture hardware and clinical ROM accuracy are not validated by this release. The existing pipeline still exposes exclusion zones for configured deployments. The report makes no medical diagnosis or exercise prescription.

## APIs and compatibility

The new namespace is `/evidence/`: `capabilities`, `photo`, `video`, `jobs?id=…`, `history`, `detail?id=…`, `compare`. Photo requests contain image data and options; the server computes and saves the report. It does not accept client-supplied scores as saved assessments. Video uses a raw body and query options `subject`, `view`, `protocol`, `tiled`.

Original `/intake`, `/assessment`, `/assessments`, `/assessment/compare`, studio/account routes and CLI commands remain. Set `PILATES_REQUIRE_AUTH=1` when explicitly operating the legacy authenticated studio mode. The shared local `/evidence/` workspace is disabled in that mode because it is not scoped to studio memberships. Do not use the MVP as a multi-tenant service.

See [architecture audit](ARCHITECTURE_AUDIT.md), [model evaluation](MODEL_EVALUATION.md) and [validation record](VALIDATION.md).
