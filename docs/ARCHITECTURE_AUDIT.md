# Independent architecture map (baseline aa061f6)

- Entry: Python CLI -> ThreadingHTTPServer -> role-scoped API -> SQLite Store. Vanilla ES-module frontend, Three.js anatomy assets; Vite optional build.
- CV: RTMO (ONNX, rtmlib) -> optional overlapping tiles -> sparse filtering -> exclusion zones -> duplicate suppression -> greedy IoU/clothing histogram tracks.
- Geometry: COCO-17 image-space joint angles; standing alignment and per-view heuristics; photo intake picks largest subject; generic movement histories and six named screening protocols.
- Storage: SQLite people, sessions, measurement rows, landmarks, posture assessments, screenings, profiles and account abstraction. Browser uploads dropped after inference; history lacks photographs.
- Visualization: existing 3D anatomy/rig is authored reference anatomy, not recovered subject geometry. Static photo reports use SVG overlays. Before/after exists for named records.
- Tests: extensive synthetic geometry/API and frontend tests. Real-vision benchmark tools exist, but no reusable image ground-truth regression suite is checked in.

Keep: RTMO backend/protocol, tiling/filter order, tracking, geometry utilities, movement signal processing, SQLite and existing educational anatomy.
Repair: refusal bypass through alignment API, warning-insensitive score, missing landmarks/bounds/nonfinite checks, no 3/4 view, time gaps/invalid timestamps, forced login.
Replace in main experience: anatomy-first landing page with evidence-first photo/video assessment; largest-only selection with explicit per-person assessment. Preserve anatomy at /anatomy.html.
Add: pixel-bounds/visibility/geometry audit, independent 3D model with corroboration and explicit provenance, per-metric status/unit/view/confidence, per-track video plots and comparison, reproducible real-image visual validation.

Reproduced baseline: RTMO on OpenCV basketball image returned 92/100 for a non-neutral basketball stance; Messi returned 35.1 despite body-size warning; MediaPipe Warrior image returned 67.2 as standing posture. These are not valid neutral-standing assessments. Raw output: ../baseline-vision.json.
