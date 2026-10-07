# SEDENS repository audit

Audit date: 7 October 2026
Audited branch: `claude/multi-person-pilates-analysis-w28tt0` (read-only; Render auto-deploys it)
Audited commit: `23dc14df8853e5b0dcfc480757b5797a0a03a089` ("Record complete platform verification [skip render]", 5 Oct 2026)
Working branch for all SEDENS work: `claude/sedens-ai-private-room-v1`, created from that commit. Nothing on this branch is merged back.

This document inventories what exists before any SEDENS code is written. It records facts that were checked by reading code, running tests or querying data in this environment. Where something is a judgement, it says so.

---

## 1. Baseline

| Check | Command | Result |
|---|---|---|
| Python suite | `.venv/bin/python -m pytest -q` (Python 3.12.3, `requirements-validated.txt` constraints, `.[dev,pose3d]`) | **2,631 passed, 1 skipped** (2,632 collected, 614 s) |
| Frontend unit suite | `cd web && npm ci && npm test` (Node 22) | **513 passed, 0 failed** (43 s) |
| Frontend build | `cd web && npx vite build` | **passed**; one 1.49 MB `main` chunk warning (anatomy) |
| Browser suites (`web/test/*.browser.mjs`) | need a running `python -m pilates web` server + Chromium | not part of `npm test`; not run in the baseline |
| Working tree | `git status` | clean |

The `.venv/`, `web/node_modules/` and `web/dist/` used above are git-ignored.

## 2. Size and layout

612 tracked files, ~103 MB checkout (63 MB `.git`). Python ≈ 39,200 lines in `pilates/`; frontend ≈ 17,400 lines in the platform + atlas core files alone.

| Path | What it is | Notes |
|---|---|---|
| `pilates/` (67 top-level modules + 16 in `platform/`) | Python vision pipeline, legacy studio/accounts API, CLI, HTTP server | `cli.py` 3,445 lines, 43 subcommands |
| `pilates/platform/` | **Current** connected platform: schema, repository, routes, jobs, media, designer, seed, backup | `repository.py` 2,118 lines; `catalog.json` 199 exercises; 120 gzip demo scenarios |
| `web/` | Static ES-module frontend served directly by Python | No framework. Vite only for an optional build |
| `web/src/platform/` | Current homepage app (`index.html` → `app.js`) | 30 modules |
| `web/anatomy.html`, `web/src/main.js`, `web/src/ui.js` | Three.js anatomy atlas (vendored "Neuro Wellness" app) | `main.js` 6,712 lines |
| `web/src/session/`, `web/src/studio/` | Older session viewer (reachable via `/anatomy.html?legacy` / `?session=`) and inactive `/studio` UI | retained |
| `web/models/` | 18 GLB files (~52 MB raw); 2 duplicated under `web/public/models/` | gzip-served, immutable cache |
| `web/assets/platform`, `web/assets/studio` | Generated portraits/exercise sheets (AI-generated, labelled), educational X-rays | ~30 MB |
| `docs/` | 36 files (29 Markdown + verification JSON) incl. QA records | several are long QA logs |
| `tests/` | 74 Python test files, 2,229 `def test_` functions (parametrised to 2,632) | |
| `web/test/` | 35 unit test files in `npm test`, 9 browser scripts | |
| `deploy/` | Render start script, Hugging Face Space Dockerfile | |
| `tools/` | vision validation/benchmark, hosted verification, seeding | |

## 3. Four generations of application share one server and one SQLite file

`python -m pilates web --db X` (`pilates/serve.py::serve`) mounts **all** of these on one `ThreadingHTTPServer`, each with its own tables inside the same SQLite file:

| Generation | Entry | Storage | Status |
|---|---|---|---|
| A. Legacy anatomy + session + accounts | `/anatomy.html?legacy`, `/auth/*`, `/intake`, `/posture`, `/movement`, `/roster`, `/admin/*`, `/note`, `/sheet`, `/analyse`, `/job/<id>` (`pilates/api.py`, `store.py`, `accounts.py`) | `people`, `sessions`, `measurements`, `accounts`, `memberships`, `screenings`, `assessments`, ... (25 tables, `store.py`) | Preserved compatibility; `PILATES_REQUIRE_AUTH=1` mode |
| B. Evidence MVP | `/evidence/{capabilities,photo,video,jobs,history,detail,compare}` (`assessment.py`) | `evidence_assessments` | Preserved; disabled in legacy auth mode |
| C. `/studio/` JSON workspace | `/studio/{state,save,analyse,video,job}` (`studio.py`) | `studio_workspaces` | UI inactive; routes retained |
| D. **Connected platform** | `/` and `/index.html` → `web/src/platform/app.js`; `/platform/*` (`pilates/platform/http.py`) | `p_*` tables (`pilates/platform/schema.sql`) | **Current homepage, deployed on Render** |

SEDENS should be built on generation D and must not disturb A–C. All routes in A–C keep working on the SEDENS branch.

## 4. Data model (connected platform, `p_*`)

### 4.1 Migration mechanism

`Repository.__init__` runs `schema.sql` (all `CREATE TABLE IF NOT EXISTS`), records `p_schema(version=1)` once, then runs idempotent backfills (`p_session_analyses`, `backfill_session_exercise_events`, `seed_regions`, `designer.backfill_revisions`). There is **no numbered migration runner**: new columns/tables have so far been added as new side tables (e.g. `p_program_step_details`, `p_resource_details`, `p_session_*` link tables) precisely so existing rows keep their positional layout. SEDENS should follow the same additive pattern and add a real version table for its own migrations.

### 4.2 Tables (54 `CREATE TABLE` statements, incl. `p_schema`)

| Group | Tables | Key facts |
|---|---|---|
| Tenancy & identity | `p_organizations(id,name,demo,created_at)`, `p_users(id, org_id NOT NULL, name, email, password_hash, active, avatar, detail, UNIQUE(org_id,email))`, `p_roles(user_id, role CHECK IN ('admin','coach','student'))`, `p_coaches`, `p_students(born, goal, height_cm, weight_kg, scenario)`, `p_sessions(token_hash, user_id, role, expires)` | **A user belongs to exactly one organization.** `p_roles` has a CHECK constraint; adding roles requires a table rebuild. Login is by email across non-demo orgs, and `create_org` refuses an email that already exists in any non-demo org, so in practice one email = one org. |
| Places & equipment | `p_locations`, `p_rooms(location_id, name, capacity)`, `p_equipment`, `p_coach_locations`, `p_student_locations`, `p_coach_students` | Rooms already exist (no device/authorization concept). |
| Content | `p_exercises(org_id, owner_id, name, category, difficulty, region_id, visibility ∈ private/organization, detail)`, `p_exercise_equipment`, `p_media`, `p_exercise_media`, `p_resources`, `p_resource_details` | **Org-scoped.** No cross-org sharing, licence, review or price fields. |
| Programs | `p_programs(org_id, owner_id, location_id, name, goal, region_id, detail)`, `p_program_exercises(position, phase, sets, reps, seconds, rest, notes)`, `p_program_step_details`, `p_program_step_notes(visibility student/coach)`, `p_program_revisions(version, snapshot, source_kind)`, `p_program_assignments(starts_on, active)`, `p_program_revision_visits` | Immutable revision snapshots, templates (`detail.template`), retire/duplicate. Good base for course sessions. |
| Bookings & visits | `p_reservations(student, coach, location, room, program, starts_at, ends_at, status, session_type)`, `p_training_sessions(student, reservation, program, analysis, performed_at, completed JSON, notes)`, `p_session_recorders`, `p_session_exercise_events(sequence, completed_key, logged_at, completed_at)`, `p_session_analyses`, `p_training_session_program_versions`, `p_session_notes`, `p_session_scans` | A "visit" is a `p_training_sessions` row; this is the natural Passport visit record. |
| Analysis | `p_analyses(kind, protocol, status, demo, result JSON)`, `p_image_analyses`, `p_video_analyses`, `p_pose_frames`, `p_landmarks`, `p_coordinates`, `p_joint_measurements`, `p_posture_measurements`, `p_symmetry_measurements`, `p_movement_analyses`, `p_rom_measurements`, `p_jobs` | Full provenance of each measurement (status, confidence, view, region). |
| Anatomy links | `p_regions(id, name, side, explanation, structures JSON, landmark_ids JSON)` | 4 central + 6 paired regions mapped to real atlas FMA structures. |
| Feedback & scans | `p_notes(visibility student/coach)`, `p_observations`, `p_scans`, `p_scan_findings`, `p_scan_finding_visits` | DICOM viewing is educational only. |
| Progress | `p_progress_records(metric, value, unit, recorded_at, demo)` | An index; `progress_evidence.py` re-derives values from archived evidence. |
| Audit | `p_audit(org_id, actor_id, action, subject_id, detail)` | Written on uploads, media copies, saves, deletes, program assignment/retirement, session completion, analysis review and analysis save. Reads are not audited on the platform side (the legacy store audits health-record reads). |

### 4.3 Authorization (`repository.py`)

- `Actor(user_id, org_id, role, demo)` from an HttpOnly `motion_session` cookie (SHA-256 hashed token, 7-day expiry). POSTs need `X-Platform-Request: 1` and same-origin `Origin` (CSRF guard). Sign-in is rate-limited (15/min/IP).
- `_scope()` enforces: admin = whole org; coach = assigned students (`p_coach_students`) + own/org-visible content; student = self, `visibility='student'` notes only, coach-only program media hidden. Media bytes, coordinates, jobs and exports use the same scope.
- Demo: `demo_login(key, role)` seeds an isolated `demo-<key>` org (4 locations, 4 coaches, 34 students, 6 histories each). Demo orgs cannot log in with passwords and are flagged on every page.

**Consequences for SEDENS:** the model cannot express (a) a coach working for two different facility businesses, (b) a professor who belongs to no facility, (c) content visible to members of several organizations, (d) prices, entitlements or review state, or (e) a room device authorization. All five need additive tables (see the plan); none of them requires changing existing rows.

## 5. HTTP API inventory

### 5.1 Connected platform (`/platform/…`, `pilates/platform/http.py`)

| Method | Route | Purpose |
|---|---|---|
| POST | `auth/demo`, `auth/login`, `auth/register`, `auth/switch`, `auth/logout` | sign-in, demo, role switch |
| GET | `me` | bootstrap (user, role, org, people, locations, regions, `storage.ephemeral`) |
| GET | `list?collection=…`, `record`, `people`, `client`, `search`, `coordinates` | scoped reads |
| GET | `program/versions`, `program/templates` | designer |
| GET | `media?id=` (HTTP Range), `dicom?id=` | authorized media bytes, no public URLs |
| GET | `inspect`, `inspect-records`, `backup` | admin system data, ZIP export |
| POST | `upload?kind=capture|exercise|scan|profile` | raw body upload (≤64 MB; images ≤12 MB/16 MP; MIME + magic-byte check) |
| POST | `save`, `people/save`, `delete`, `assign`, `program/retire`, `program/duplicate`, `copy-exercise-media`, `complete-session`, `review`, `annotate`, `analyse`, `restore` | scoped writes; `analyse` queues a job |

### 5.2 Other route families

`/evidence/*` (MVP), `/studio/*` (inactive UI), `/capabilities` (health check used by Render), legacy `/auth/*`, `/intake`, `/posture`, `/movement`, `/roster/*`, `/admin/*`, `/note`, `/sheet`, `/analyse`, `/landmarks`, `/job/<id>`, `/session.json`. Static files are gzip-served; `/models/` and `/vendor/` get a 7-day immutable cache, everything else `no-cache`.

## 6. Assessment pipeline

```
upload → p_media → Jobs.submit (1 worker, ≤3 queued) → assessment.photo()/video()
  → RTMO-s (rtmlib ONNX, fixed 640×640) [→ 2×1/2×2 tiles] → filters/dedup → tracking (video)
  → validate_body() gates → alignment.assess() per view → metric() records
  → optional MediaPipe Pose Landmarker crop, accepted only if ≥6 core joints agree with RTMO
  → studio.summarize() → save_analysis() → p_analyses + frames/coordinates/measurements/progress rows
```

| Piece | File | Reuse judgement |
|---|---|---|
| Multi-person RTMO detector, tiling, exclusion zones, duplicate suppression, tracking | `pose.py`, `filters.py`, `merge.py`, `tracking.py` | Keep. Benchmarked; documented limits (`MODEL_EVALUATION.md`). |
| Per-person suitability gate (`validate_body`): finite coords, head/shoulders/hips/legs visible, edge cropping, ≥180 px source chain, ≥120 px model chain, view/plane mismatch | `validation.py`, `assessment.py::assess_person` | **Keep and surface to customers** as "Retake recommended" reasons. |
| Standing metrics (`SPECS`): head tilt, shoulder/hip height asymmetry, lateral/sagittal trunk inclination, forward-head proxy (ratio), knee alignment proxies (ratio), sagittal pelvic tilt; each with unit, confidence, status `measured/estimated/unavailable`, views, joints, reason | `assessment.py`, `alignment.py` | Keep as the technical layer. Confidence < 0.65 → value withheld. |
| "Image alignment index" 0–100 = mean of `max(0,100·(1−max(0,|angle|−2°)/13°))` over ≥3 measured angles | `assessment.py::assess_person`, `studio.summarize` | **Engineering rubric, not validated.** Keep in Advanced only; never show to customers. |
| Movement signals (9 projected joint angles), gap splitting (>0.6 s), spike masking, ≥12 frames, ≥60 % visibility, churn refusal | `assessment.py::video`, `analyse_series` | Keep for LOCAL_ROOM; too slow for Render free beyond short clips. |
| Comparable-scan logic: same subject/view/mode/measurement version/protocol; score diff only with identical contributors; "a difference is not automatically improvement" | `assessment.py::compare`, `platform/progress_evidence.py`, `web/src/platform/progress-selection.js`, `comparison.js` | **Reuse directly** for Passport progress. |
| Six named movement screens with goniometry references (Norkin & White) | `screening.py` | Legacy; candidate source for optional functional screens, but each needs the evidence gate in the plan. |
| Platform 4-view posture capture (front / rear / side_left / side_right) | `platform/jobs.py`, `web/src/platform/capture.js` | Reuse for the room scan; it already accepts exactly the four required views. |

Measured facts: RTMO ~0.2–0.36 s/photo on a 4-core laptop; MediaPipe ~0.03 s/person warm; hosted Render free measured **33.2 s** for one posture photo and **52 s** for a 6-second clip (`docs/verification/2026-10-05/hosted-pipeline.json`); local peak ~434–460 MiB.

Known gaps (from the repo's own docs and this audit): no live capture guidance (the camera modal only says "Keep the full body visible"); no repeatability study; no real-room benchmark; the refusal reasons are written for engineers; view auto-detection is heuristic; mirrors and second persons are handled for classes but not explained to a single customer.

## 7. Frontend architecture

- `web/index.html` loads only `web/src/platform/app.js` (plus `studio.css`, `platform.css`, `explain.css`). Hash routing (`#page=…&client=…&tab=…`), one client workspace with 8 tabs, role-aware sidebar, demo role switcher, ephemeral-storage banner. Route-to-renderer map: `docs/PLATFORM_ACTIVE_ROUTES.md`.
- Renderers: `reports.js` (single report renderer with an existing **"Advanced measurements"** disclosure), `capture.js` (guided photo/video upload + camera), `programs.js` + `forms.js` (visual program designer, student projection, version diff), `library.js` (program/exercise library), `anatomy.js` (iframe of `/anatomy.html?platform=1` with postMessage), `visits.js`/`visit-evidence.js` (visit timeline), `progress-*.js`, `explain.js` (plain-language metric definitions).
- All copy is hard-coded English in templates (`core.js`, `app.js` …). The atlas side has a real en/ko string table (`web/src/content/strings.js`, 65 KB) and bilingual exercise content.
- Brand: "Motion Yoga" in `index.html`, `app.js` sign-in/sidebar, backup filename `motion-yoga-backup.zip`, cookie `motion_session`, demo org name.

## 8. Anatomy system (key differentiator; preserve in full)

- Data: `web/src/generated/structures.json` — **2,064 structures** (BodyParts3D 3.0 "taught body" of 449 + 4.0 complete atlas), FMA ids, layers, centroids; `groups.json` (FMA hierarchy groups), `rig.json` (OpenSim-derived rig), `muscle_paths.json`. Licence: BodyParts3D CC BY 4.0 (required wording in `ATTRIBUTION.md`), plus other sources listed there.
- Models: 18 GLBs; the taught set alone is several MB (`muscles_full` 5.2 MB, `skeleton` 6.6 MB, `bones_full` 3.5 MB). Brain/organ layers add ~20 MB. Served gzip + immutable.
- Programmatic API already exported by `web/src/main.js`: `setExercise(key)` (highlights the exercise's muscles and plays its motion clip), `setPlaying`, `setIsolate(ids)`, `setGroup(fma)`, `flyToGroup`, `flyTo(id)`, `selectStructure(id)`, `setLayer(name,on)`, `setView(key)`, `setExplode(v)`, `setXray`, `setLabels`, `setLang`, `resetView`, `renderStructureInto(canvas…)`.
- Exercise anatomy content: `web/src/content/exercises.js` + `library/*.js` — **199 exercise keys**, bilingual (en/ko), muscles split into prime/synergist/stabiliser **each tagged `emg` or `inferred`**, EMG notes, contraindications, faults, regressions/progressions, `reviewed` attribution (`REVIEWER = Dr. Hong Jong Gi`, credential deliberately `null`, Pilates and yoga only).
- Every one of the 199 `catalog.json` exercises has an `atlas_exercise` key that resolves to an atlas exercise, and all 71 distinct catalog muscle names resolve to atlas structure names (checked in this audit). So exercise → highlighted anatomy already works end to end.
- Embedding: `web/src/platform/anatomy-bridge.js` (in `anatomy.html?platform=1`) accepts same-origin `motion-context` messages and calls `setExercise`/`setIsolate`/layers; emits `motion-atlas-ready/selection/error`. WebGL failure produces a readable message.
- Missing for SEDENS: a room-player mode with no client record, a time-coded anatomy timeline, a customer-mode structure filter, a low-memory loading profile.

## 9. Exercise content audit (`pilates/platform/catalog.json`)

199 entries: Pilates 105, Yoga 90, Strength 4; Foundation 82 / Intermediate 65 / Advanced 52; mat 166, reformer 17, cadillac 6, chair 5, barrel 5. Every entry has `description, instructions, breathing, cues, mistakes, safety, progressions, regressions, muscles, pattern, duration, reps, atlas_exercise, pose, position, provenance`.

Findings:

1. **Unsupported superiority claims in cues.** Four catalog cues assert external cues are better ("an external cue outperforms…", "recruits the hip extensors better than…", "consistently produces more force than…", "better than thinking about your foot"); the same text is in `web/src/content/exercises.js` (en and ko), and `web/src/content/evidence.js::external_focus` describes a "small-to-moderate advantage". McKay et al., *Psychological Bulletin* 2024;150(11):1347–1362 (doi:10.1037/bul0000451) found moderate-to-strong evidence of publication bias and negligible bias-corrected effects (performance g = 0.01). These claims must not be carried into SEDENS Standard. (The catalog/atlas text itself is left untouched on the legacy side; SEDENS gets its own audited copy.)
2. **Duplicate muscle entries** in 42 exercises (e.g. "multifidus … multifidus") — an appended "transversus abdominis, multifidus, diaphragm" block.
3. **Generic safety text.** Every catalog `safety` field is the same sentence; the specific contraindications exist only in the atlas content (`exercises.js`) and use clinical phrasing ("cervical disc symptoms") that needs a non-medical customer rewrite.
4. **Provenance** is one string for all 199 ("Existing authored repertoire…"). No per-entry review status, reviewer, date, licence or media source.
5. `duration`/`reps` exist; no hold-time vs reps distinction, no supported session types, no `intensity` metadata, no equipment-free flag beyond `equipment`.
6. 18 uses of "fix" in mistakes/cues are coaching language ("fix your gaze"), not medical claims — acceptable after review.

## 10. Media and uploads (`pilates/platform/media.py`)

- Types: JPEG, PNG, WebP, MP4, WebM, DICOM (uncompressed/RLE/JPEG baseline). Kinds: `capture`, `exercise`, `scan`, `profile`. Size limits and content sniffing (Pillow verify, `ftyp`/EBML signatures).
- Stored at `<db>.media/<org_id>/<uuid>.<ext>`, outside static paths; served only through `/platform/media?id=` after `repo.get(actor,'media')` scope check, `Cache-Control: private, no-store`, `nosniff`, Range support.
- Exercise media can only be changed by its owner; `copy_exercise_media` duplicates files with `copied_from` provenance.
- **Gaps:** no PDF type; no licence/ownership/attestation fields; media is org-scoped so a professor's course media cannot be served to another facility's members; no storage abstraction (direct filesystem paths are stored in `p_media.path`); no export of an individual creator's content (only whole-org backup ZIP).

## 11. Programs, sessions, progress (Passport building blocks)

- `designer.py`: statuses Draft/Active/Completed/Archived, phases (weeks), step detail (purpose, why_assigned, student/coach instructions, cue, common mistake, success criteria, progression, regression, precautions, media with visibility, references with types youtube/vimeo/research/article/pdf/website/video), immutable revisions with reasons and source links, templates, duplication, Student-safe projection.
- `complete_session`: records a visit with completed exercise keys, recorder, program version, analyses, notes, scans.
- `progress_evidence.py` + `progress-selection.js` + `progress-milestones.js`: comparable series only; milestones are behavioural (visits, program phase), not medical.

## 12. Hosting

- Render free (`render.yaml`, `deploy/render-start.sh`): 0.1 CPU, 512 MB, no disk; DB and uploads at `/tmp/studio.db(.media)` — erased on restart/redeploy/spin-down (15 min idle). Health check `/capabilities`. `deployment.prepare_render()` fetches and SHA-verifies the MediaPipe model before binding. `storage.ephemeral` is reported to the UI and shown as a banner.
- The owner has authorised this disposable free deployment for demo use only (`PLATFORM_HOSTING.md`). A durable path is documented but needs billing.
- First demo sign-in seeds a whole organization and "can take about a minute" on Render.
- Alternative free host documented: Hugging Face Space (2 vCPU/16 GB) via `deploy/huggingface/Dockerfile`.
- Pushes to the SEDENS branch do **not** deploy (Render tracks the original branch).

## 13. Readiness / screening that already exists

`pilates/accounts.py::PARQ` holds seven yes/no questions labelled "The PAR-Q+" with near-verbatim PAR-Q+ wording, used by the legacy `/me/screening` flow. The PAR-Q+ is maintained by the PAR-Q+ Collaboration and its reuse/modification terms are not established for a commercial product (see plan §Risks). **SEDENS must not reuse this wording.** The legacy flow is left as is (not deleted), flagged here for legal review.

## 14. Tests

- Python (74 files): pipeline/geometry/tracking/alignment unit tests, synthetic image gates, API/auth/role acceptance, platform repository scope tests, seed integrity, designer revisions, visit links, backup/restore, deployment, serve headers/gzip.
- Frontend (`npm test`, 35 files): content integrity (every claim has a tier/citation), library, rig/skin/bind geometry, posture/movement panels, platform explain/visit/progress/program helpers, demo auth retry.
- Browser scripts (`*.browser.mjs`) exercise hosted/local journeys against `/index.html` with Playwright; they are run manually with `MOTION_BASE_URL`.
- Not covered: room authorization, cross-org content sharing, licensing, payments/entitlements, readiness gating, customer-facing copy rules, live capture guidance.

## 15. Baseline test result

| Suite | Result | Notes |
|---|---|---|
| Python, full (`pytest -q`) | **2,631 passed, 1 skipped, 0 failed** in 614 s | Skip: `tests/test_groups.py:284` — "BodyParts3D tables not fetched -- see scripts/fetch_bodyparts3d.sh" (source tables are git-ignored; same single skip the repo's own `VALIDATION.md` records). One `ConnectionResetError` traceback in the log is a test server thread whose client closed early; it is not a failure. |
| Frontend unit (`npm test`) | **513 passed, 0 failed** | 35 test files |
| Frontend build (`vite build`) | **passed** | chunk-size warning for the 1.49 MB atlas bundle |
| Browser scripts | not run | require a live server and Chromium; to be run in Phase 8 |

Every later phase must reproduce at least these numbers (plus its new tests).

## 16. Reuse register

| Component | Exact modules | SEDENS use | Action |
|---|---|---|---|
| Vision pipeline | `pose.py`, `filters.py`, `merge.py`, `tracking.py`, `geometry.py`, `alignment.py`, `validation.py`, `assessment.py`, `pose3d.py` | Server-side scan measurement (LOCAL_ROOM; short on DEMO_FREE) | Reuse unchanged; add a customer translation layer on top |
| Platform jobs + analysis persistence | `platform/jobs.py`, `platform/analysis.py`, `platform/kinematics.py`, `platform/regions.py` | Room scan jobs (4 views) | Reuse; add room-session link |
| Comparable progress | `platform/progress_evidence.py`, `web/src/platform/progress-selection.js`, `comparison.js`, `progress-milestones.js` | Passport progress | Reuse |
| Repository, auth, scope, audit | `platform/repository.py`, `platform/http.py` | Identity, org isolation, audit | Reuse; add SEDENS side-tables + new route family |
| Media | `platform/media.py` | Creator uploads | Wrap behind a storage abstraction; add PDF + rights metadata |
| Programs/designer/revisions | `platform/designer.py`, `web/src/platform/programs.js`, `forms.js`, `program-version-diff.js` | Course sessions authoring, version history | Reuse patterns; courses get their own tables |
| Visits | `p_training_sessions` + event/link tables, `visits.js` | Room visit = Passport entry | Reuse |
| Anatomy atlas | `web/anatomy.html`, `web/src/main.js`, `ui.js`, `content/*`, `generated/*`, `models/*` | Workout side panel, creator anatomy binding, education | Reuse; add a room bridge mode |
| Anatomy bridge pattern | `web/src/platform/anatomy-bridge.js`, `anatomy.js` | Message protocol template | Extend with a separate room bridge |
| Exercise catalog | `platform/catalog.json`, `content/exercises.js` | SEDENS Standard source | Derive an audited copy; do not edit originals |
| Plain-language copy | `web/src/platform/explain.js` | Basis for customer observation wording | Reuse definitions in Advanced; new customer layer |
| Backup/restore | `platform/backup.py`, `backup_verify.py` | Org archive incl. SEDENS tables | Extend table list |
| Demo seed | `platform/seed.py`, `demo_scenarios/` | Demo facility history | Extend with SEDENS scenario |
| Strings (en/ko) | `web/src/content/strings.js`, `koreanNames.js` | Localization pattern, Korean anatomy names | Reuse pattern |
| Deployment | `deploy/render-start.sh`, `deployment.py`, `render.yaml` | DEMO_FREE mode | Reuse; add `SEDENS_MODE` |

## 17. Problematic components and risks found

| # | Issue | Where | Severity for SEDENS | Handling |
|---|---|---|---|---|
| P1 | 0–100 "Image alignment index" is shown in reports and stored in `detail.score` | `assessment.py`, `studio.summarize`, `reports.js` | High (violates "no arbitrary posture score") | Never in customer views; Advanced only, with its existing "not a clinical score" label |
| P2 | External-focus superiority claims | catalog (4), `exercises.js` (en/ko), `evidence.js` | High | SEDENS Standard rewrites; evidence registry entry; legacy text untouched |
| P3 | PAR-Q+-derived questions | `accounts.py::PARQ` | High (legal) | Not reused; original readiness gate |
| P4 | Single-org users; role CHECK constraint | `schema.sql` | High (blocks multi-facility creators) | Additive side tables, no rebuild of `p_roles` |
| P5 | Org-scoped media/content | `media.py`, `_scope()` | High | Course-scoped media authorization path |
| P6 | Three parallel legacy stacks in one process/DB | `serve.py` | Medium (complexity) | Leave mounted; SEDENS adds a fourth namespace `/sedens/` only |
| P7 | Hard-coded English templates | `web/src/platform/*.js` | Medium | New SEDENS UI uses a string table (ko/en) from day one |
| P8 | Heavy atlas (`main.js` 1.5 MB bundle, multi-MB GLBs) | `web/src/main.js`, `models/` | Medium (room start time, TV hardware) | Lazy iframe, taught-body layers only, preload during readiness, fallback card |
| P9 | Demo seed takes ~1 min on Render, per demo key | `platform/seed.py` | Medium (investor demo) | Pre-seed a shared read-only SEDENS demo org at boot in DEMO_FREE; keep per-key isolation for write demos |
| P10 | Duplicate muscles; generic safety text; one provenance string | `catalog.json` | Medium | Clean in the derived SEDENS Standard file |
| P11 | Reviewer attribution covers the atlas Pilates/yoga content; scope for the platform catalog is not documented | `exercises.js::REVIEWER` | Medium (claim accuracy) | SEDENS Standard starts as `review_status: "unreviewed"` unless re-confirmed |
| P12 | Generated portraits/exercise sheets | `web/assets/platform/*` | Low | Keep labelled; never presented as real customers or as movement demonstrations |
| P13 | Live camera guidance absent | `capture.js` | High for room UX | Browser-side MediaPipe Tasks Vision guidance (benchmark first) |
| P14 | Render free CPU: 33 s/photo, ~2 min for 4 views | hosting | High for demo | Precomputed demo scan + optional real scan with honest wait |
| P15 | `README.md` (131 KB) mixes current and historical narratives | docs | Low | Add a short SEDENS entry section; do not rewrite history |

## 18. Feature-by-feature reuse for the SEDENS brief

| Brief item | Existing support | Gap |
|---|---|---|
| Room entry / demo login | demo login per key, role switch | room device + room session token, CRM adapter |
| Customer identification | `p_students`, `client()` DTO | Passport aggregation endpoint |
| Readiness gate | legacy PAR-Q (not reusable) | original questionnaire, records, stop path |
| 4-view scan | platform capture + jobs (front/rear/side_left/side_right) | live guidance, room wizard, customer result layer |
| Plain-language feedback | `explain.js` definitions, Advanced disclosure | evidence registry, wording rules, capture-reliability categories |
| Recommendation | none (coach-authored programs only) | rule engine over SEDENS Standard |
| Session player | none (program steps have media) | full player |
| Anatomy sync | `setExercise`, `setIsolate`, bridge | timeline, room mode |
| Music | none | provider + volume mixing |
| Passport | visits, progress, programs, notes | unified customer view |
| Room-only access | none | authorization layer |
| Creator marketplace | coach-owned exercises/programs inside one org | creators, affiliations, courses, access, price, entitlement, review |
| Media governance | type/size checks, authorized serving | rights metadata, attestation, PDF, storage abstraction, export |
| Facility admin | locations, rooms, equipment, coaches, backup | course enablement, room devices, CRM settings, utilization placeholder |
| Analytics | `p_audit` | product event table |
| Localization | atlas en/ko | SEDENS UI string table |
