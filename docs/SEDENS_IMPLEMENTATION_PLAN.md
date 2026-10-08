# SEDENS AI Private Room — implementation plan (V1)

Status: **Phase 0 approved; Phase 1 implemented** (see §19). Written after [the repository audit](SEDENS_REPO_AUDIT.md). Phase 2 has not started and waits for approval.
Branch: `claude/sedens-ai-private-room-v1` (from `23dc14d`). Never merged into, force-pushed over, or deployed from the original branch.

Labels used throughout: **REAL** (works with real data), **DEMO** (fictional data/content, labelled on screen), **SIMULATED** (a stand-in for a future integration, e.g. CRM, payment, room device), **EXPERIMENTAL** (implemented but not validated), **FUTURE** (designed, not built).

---

## 1. Ground rules for every phase

1. Additive only. No existing table, route, module, test, asset or CLI command is removed. Legacy screens stay reachable (see §5.3).
2. All new tables use an `s_` prefix and their own migration ledger; existing `p_*` rows are never rewritten.
3. Organization isolation and the existing role scopes are reused, not bypassed. Every new read path goes through an explicit authorization function with a test.
4. Customer-facing scientific statements go evidence → rule → wording → test (`data/evidence_registry.json`, tests that fail on banned wording).
5. No paid service, no external API key, no CDN dependency in the room at runtime.
6. Each phase ends with the full Python suite, `npm test` and `vite build` green, and is committed in small logical commits and pushed with `git push -u origin claude/sedens-ai-private-room-v1`.

## 2. Product surfaces and who sees what

| Surface | Users | Inside an authorized room | Outside a room |
|---|---|---|---|
| Room (kiosk) | customer | entry, readiness, scan, recommendation, player, anatomy, completion | not available |
| Fitness Passport | customer | read | read (history, progress, courses, bookings placeholder, achievements, locations) |
| Course catalog | customer | play enrolled/entitled sessions | metadata + enrollment only; no playback |
| Creator Studio | coach, professor/expert creator, SEDENS editorial | — | full authoring, preview in a simulated room |
| Facility console | facility admin | — | rooms/devices, members, courses enable/disable, CRM settings, utilization placeholder |
| SEDENS review | SEDENS reviewer/admin | — | course review, creator verification, evidence registry, content sources |
| Coaching workspace (existing) | coach, admin, student | — | unchanged connected platform at `/workspace.html` |
| Anatomy atlas (existing) | all | educational | educational (`/anatomy.html`, unchanged) |

## 3. Identity, roles and tenancy (decision)

Audit facts: users belong to one org; `p_roles` is CHECK-constrained to admin/coach/student; content is org-scoped.

**Decision: additive side tables, no `p_roles` rebuild.** Rebuilding a CHECK-constrained table under foreign keys is the riskiest possible migration for the smallest benefit, and `login()` assumes one of the three roles.

| SEDENS role | Representation |
|---|---|
| Customer / student | `p_students` in a facility org (unchanged) |
| Coach | `p_coaches` (unchanged) + optional `s_creator_profiles` row (`creator_type='coach'`) |
| Professor / expert creator | A user who is `admin` of their own org with `s_org_profiles.kind='creator_studio'` + `s_creator_profiles` (`professor`/`expert`). Not a member of any gym. |
| Facility admin | `admin` of an org with `kind='facility'` (orgs without a profile row are treated as facilities, so every existing org keeps working) |
| SEDENS admin / reviewer | user in the org with `kind='sedens'` + `s_capabilities(capability ∈ sedens_admin, sedens_reviewer)` |

As built in Phase 1, the grant table is `s_capabilities` (capabilities `creator`, `sedens_reviewer`, `sedens_admin`) and the affiliation table is `s_creator_facility_affiliations`; see [the security model](SEDENS_SECURITY_MODEL.md).

Multi-facility creators: `s_creator_facility_affiliations(creator, org, optional location, scope='content_distribution', status requested/approved/declined/revoked)`. An affiliation is approved by that facility's admin and grants **content distribution only** (the creator can make a course free for that facility). It grants **no access to that facility's member records**. Coaching customers in a second facility still requires a membership in that org; a cross-org identity link (`s_identities`) is designed as FUTURE because `create_org` currently enforces one org per email and changing sign-in is out of scope for V1.

Course visibility is resolved by one function (`courses.visible_to(actor, room_context)`) that combines: course status `published`, access mode, `s_course_facilities`, `s_facility_course_settings.enabled`, and entitlements. Draft/submitted/needs-revision courses are visible only to the creator and reviewers.

## 4. Database migrations (exact)

A new runner `pilates/sedens/migrations.py` applies numbered SQL files from `pilates/sedens/migrations/` inside one transaction each and records them in `s_schema(version, name, checksum, applied_at)`; an applied file whose text changes is refused. It is called from the `Sedens` constructor, after the platform `Repository` has created `p_*`. Every file is `CREATE TABLE IF NOT EXISTS`/`CREATE INDEX IF NOT EXISTS` only. Backup/restore (`platform/backup.py`) gaining the new org-scoped tables is still open (§19 limitations).

**Numbering as built.** Phase 1 shipped the foundation as six files, `0001_tenancy_capabilities` … `0006_room_activity` (listed in §19). The room-journey, marketplace and governance tables below are therefore renumbered from `0007` when their phases start; their content is unchanged by this note. The table sketches that follow are the original proposal; where Phase 1 built a table, §19 and the SQL files are authoritative.

### 0001_foundation.sql — tenancy, rooms, consent, analytics

| Table | Columns (abridged types) |
|---|---|
| `s_schema` | `version INTEGER PK, name, applied_at` |
| `s_org_profiles` | `org_id PK→p_organizations CASCADE, kind CHECK(facility,creator_studio,sedens), brand_name, default_language CHECK(ko,en), timezone, detail JSON` |
| `s_platform_roles` | `user_id→p_users CASCADE, role CHECK(sedens_admin,reviewer), granted_by, granted_at, PK(user_id,role)` |
| `s_room_devices` | `id PK, org_id→p_organizations, location_id→p_locations, room_id→p_rooms CASCADE, name, token_hash UNIQUE, status CHECK(active,revoked), simulated INTEGER, paired_by, paired_at, last_seen_at, detail JSON` |
| `s_room_sessions` | `id PK, org_id, room_id, device_id→s_room_devices, student_id→p_students CASCADE, token_hash UNIQUE, crm_provider, crm_reference, state CHECK(identified,ready,stopped_by_readiness,scanning,planned,in_workout,completed,abandoned,expired), started_at, expires_at, ended_at, training_session_id→p_training_sessions SET NULL, detail JSON` |
| `s_crm_settings` | `org_id PK, provider CHECK(demo), config JSON (never secrets), updated_by, updated_at` |
| `s_consents` | `id PK, user_id, org_id, kind CHECK(scan_capture,scan_image_retention,product_analytics), text_version, granted_at, revoked_at` |
| `s_events` | `id INTEGER PK, org_id, user_id NULL, room_id NULL, room_session_id NULL, name, at, props JSON` + index `(org_id,name,at)` |

### 0002_room_journey.sql — readiness, scan summaries, recommendations, feedback

| Table | Columns |
|---|---|
| `s_readiness_checks` | `id, room_session_id, student_id, questionnaire_version, answers JSON, outcome CHECK(proceed,proceed_gentle,do_not_proceed), triggered JSON, created_at` |
| `s_scan_summaries` | `id, room_session_id, analysis_id→p_analyses CASCADE, feedback_rules_version, reliability CHECK(supported,limited,retake,not_available), customer JSON, created_at` (what the customer was actually shown) |
| `s_recommendations` | `id, room_session_id, student_id, library_version, rules_version, inputs JSON, rules_fired JSON, plan JSON, rationale JSON, created_at, accepted_at, declined_at` |
| `s_room_session_feedback` | `room_session_id PK, training_session_id, rpe_target, rpe_reported 0–10, felt, pain_reported INTEGER, pain_note, user_note, completed JSON, skipped JSON, duration_s, created_at` |

A completed room visit also writes the **existing** `p_training_sessions` + `p_session_exercise_events` (keys `sedens:<exercise_id>`), and `p_session_analyses` for the scan, so the coaching workspace and Passport see the same visit.

### 0003_creators_courses.sql — marketplace domain

| Table | Columns |
|---|---|
| `s_creator_profiles` | `id, user_id UNIQUE→p_users CASCADE, display_name, creator_type CHECK(coach,professor,expert,sedens_editorial), bio, institution, qualifications JSON, profile_media_id, specialties JSON, slug UNIQUE, verification_state CHECK(unverified,pending,verified,rejected,suspended), verified_by, verified_at, created_at, detail JSON` |
| `s_creator_affiliations` | `id, creator_id, org_id, location_id NULL, status CHECK(requested,approved,revoked), requested_at, decided_by, decided_at`, unique `(creator_id,org_id,IFNULL(location_id,''))` |
| `s_creator_verifications` | `id, creator_id, reviewer_id, decision, evidence JSON, notes, created_at` |
| `s_courses` | `id, creator_id, owner_org_id, content_type CHECK(guided_training,professional_education), product_line CHECK(sedens_standard,facility,marketplace), status CHECK(draft,submitted,needs_revision,approved,published,suspended,archived), title, subtitle, description, language CHECK(ko,en), category, level, weeks, sessions_per_week, cover_media_id, current_version, published_version, created_at, updated_at, detail JSON` (goals, regions, prerequisites, equipment, safety, outcomes) |
| `s_course_modules` | `id, course_id CASCADE, position, title, summary` |
| `s_course_items` | `id, module_id CASCADE, position, kind CHECK(session,lesson,video,image,pdf,text,link,quiz,anatomy_task), title, detail JSON` (a `session` item holds ordered steps: exercise ref, reps/hold, cue, regression/progression, anatomy timeline id) |
| `s_course_versions` | `id, course_id, version, snapshot JSON, created_by, created_at, reason, UNIQUE(course_id,version)` |
| `s_course_access` | `course_id PK, mode CHECK(private_draft,facility_free,network_included,marketplace_free,marketplace_paid,sedens_standard), updated_by, updated_at` |
| `s_course_facilities` | `id, course_id, org_id, location_id NULL` (unique) |
| `s_course_prices` | `course_id PK, amount_minor INTEGER ≥0, currency CHECK(KRW,USD), sale_status CHECK(not_for_sale,demo_listed,on_sale,paused), updated_at` |
| `s_facility_course_settings` | `org_id, course_id, enabled, included_for_members, featured_in_room, updated_by, updated_at, PK(org_id,course_id)` |
| `s_entitlements` | `id, user_id, course_id, source CHECK(facility_free,facility_included,marketplace_free,demo_purchase,creator,reviewer), org_id, granted_at, expires_at, revoked_at, purchase_id` |
| `s_purchases` | `id, user_id, course_id, provider CHECK(demo), provider_ref, amount_minor, currency, state CHECK(demo_created,demo_completed,demo_cancelled), created_at, completed_at` — no card data, ever |
| `s_enrollments` | `id, user_id, course_id, course_version, enrolled_at, progress JSON, completed_at` |
| `s_course_reviews` | `id, course_id, version, reviewer_id, decision CHECK(approved,needs_revision,rejected,suspended), checklist JSON, notes, created_at` |

### 0004_media_rights_anatomy.sql — governance and timelines

| Table | Columns |
|---|---|
| `s_media_rights` | `media_id PK→p_media CASCADE, licence_type CHECK(creator_owned,permission_granted,pexels,pixabay,cc0,cc_by,cc_by_sa,repo_owned,other), source_url, original_creator, licence_url, retrieved_at, attested INTEGER, attested_by, attested_at, attestation_version, identifiable_person CHECK(yes,no,unknown), permitted_scope JSON, restrictions, review_status CHECK(unreviewed,approved,rejected), demo INTEGER` |
| `s_media_objects` | `media_id PK→p_media CASCADE, provider CHECK(local), object_key, sha256` (storage abstraction pointer; `p_media.path` stays for compatibility) |
| `s_course_media` | `course_id, media_id, PK(course_id,media_id)` — the only path by which media crosses org boundaries, and only to entitled users |
| `s_anatomy_timelines` | `id, owner_kind CHECK(standard_exercise,course_item), owner_id, media_ref, version, segments JSON, review_status, created_by, created_at` |

Segments: `[{start_s, end_s, structures:[atlasId…] | exercise_key, layer: muscles|skeleton|joint, mode: highlight|isolate|whole, view: front|back|left|right, cue_ko, cue_en}]`, validated against `structures.json`.

## 5. Routes and pages to add (exact)

### 5.1 Backend namespace `/sedens/` (`pilates/sedens/http.py`, dispatched from `serve.py` like `/platform/`)

Cookies: existing `motion_session` (person) + new `sedens_device` (paired room device, long-lived, HttpOnly) + new `sedens_room` (room session, ≤90 min, HttpOnly, SameSite=Strict). Same CSRF guard header pattern (`X-Sedens-Request: 1`).

| Area | Routes |
|---|---|
| Config | `GET config` (mode, features, storage.ephemeral, languages) |
| Device | `POST room/device/pair` (facility admin), `POST room/device/revoke`, `GET room/device` |
| Room entry | `POST room/enter` (`method: demo|member_id|qr|reservation`, via `CRMProvider`), `GET room/session`, `POST room/end` |
| Readiness & consent | `POST room/readiness`, `POST room/consent` |
| Scan | `POST room/scan/upload` (capture via room session), `POST room/scan/analyse` (wraps `platform/jobs.Jobs.submit`), `GET room/scan/status`, `GET room/scan/summary`, `POST room/scan/demo` (DEMO_FREE precomputed, labelled) |
| Plan & play | `POST room/recommend`, `POST room/plan/accept`, `POST room/event`, `POST room/complete`, `GET room/media` |
| Library | `GET library` (full only with valid room session; otherwise titles/metadata only) |
| Passport | `GET passport`, `GET passport/visit` |
| Courses (customer) | `GET courses`, `GET course`, `POST course/enroll`, `POST checkout/demo`, `GET media` (entitlement-checked course media) |
| Creator | `GET/POST creator/profile`, `GET creator/courses`, `POST creator/course/save`, `POST creator/course/submit`, `POST creator/upload` (requires attestation), `POST creator/anatomy-timeline/save`, `GET creator/course/preview`, `GET creator/course/export` (ZIP of metadata + local media), `POST creator/affiliation/request` |
| Facility | `GET facility/courses`, `POST facility/course-setting`, `GET/POST facility/rooms`, `GET/POST facility/crm`, `POST facility/affiliation/decide`, `GET facility/utilization` (counts from `s_events` only) |
| Review | `GET review/queue`, `POST review/decide`, `POST review/creator`, `GET review/evidence`, `GET review/sources` |

### 5.2 Frontend (`web/src/sedens/`, vanilla ES modules like the existing app)

| File / route | Purpose |
|---|---|
| `web/index.html` → `src/sedens/app.js` | SEDENS home: "Enter AI Private Room", Passport, Creator Studio, Facility, Review (by role); demo role switcher; ephemeral banner |
| `web/room.html` → `src/sedens/room/*.js` | Kiosk flow: `entry` → `identify` → `readiness` → `consent` → `scan` (+`guidance.js`) → `result` → `setup` (30/60 min, Easy/Moderate/Challenging, focus, music) → `plan` ("Why this session") → `player` (+`anatomy-panel.js`, `music.js`) → `complete` |
| `#/passport` | Overview, sessions, scans (plain + Advanced), progress (comparable only), courses, achievements |
| `#/courses`, `#/course/:id` | Catalog with product-line badges: SEDENS Standard / facility coach / marketplace; "DEMO MARKETPLACE CONTENT" |
| `#/creator`, `#/creator/course/:id` | Course builder (modules, items, sessions, uploads with attestation, anatomy binding/timeline editor, access & price, submit, preview) |
| `#/facility` | Rooms & devices, course control, CRM (Demo), members, utilization placeholder |
| `#/review` | Review queue with checklist, creator verification, evidence registry and content sources viewers |
| `src/sedens/i18n.js`, `strings/ko.js`, `strings/en.js` | All new copy keyed; Korean first-class; content `language` field |
| `src/sedens/anatomy-room-bridge.js` loaded by `anatomy.html?room=1` | `sedens-anatomy` message protocol → `setExercise`, `setIsolate`, `setLayer`, `setView`, `resetView`; customer structure filter; label "Exercise anatomy illustration — not measured muscle activation." |
| `styles/sedens.css` | graphite/black/white, restrained blue-silver accent, large type, ≥64 px touch targets for TV |

### 5.3 Legacy preservation

- Existing connected platform moves to **`/workspace.html`** (byte-identical copy of today's `index.html`, title rebranded only). `index.html` keeps a shim: any legacy hash containing `page=` redirects to `/workspace.html` + same hash, so the atlas's `/#page=…` return links and old bookmarks keep working. Browser QA scripts get a `/workspace.html` base; their assertions are unchanged.
- `/anatomy.html`, `?legacy`, `?session=`, `/evidence/*`, `/studio/*`, legacy `/auth/*`, CLI: untouched.

## 6. Room authorization (Principle 8)

`authorize_room(request) → RoomContext` requires **both** an active `s_room_devices` token and an unexpired `s_room_sessions` token bound to that device's room and org. Every room-engine route (scan, recommend, full library, course playback, room media) calls it. Outside the room, the customer's `motion_session` grants Passport/catalog metadata only. A FUTURE `home` entitlement source is reserved in the access function (always false in V1) so SEDENS Home can be added without touching room checks. Demo orgs get one SIMULATED paired device ("AI Private Room 01"), visibly labelled.

## 7. CRM, payment, video, music, storage providers

| Interface | V1 implementation | FUTURE (not active) |
|---|---|---|
| `CRMProvider.verify_entry(org, method, value) → {member, active, reservation, allowed, reason}` | `DemoCRMProvider` (active member, inactive member, booked room, no reservation, allowed/denied fixtures) | BROJ adapter, other Korean CRMs; contract in `SEDENS_FUTURE_INTEGRATIONS.md` |
| `PaymentProvider.create_checkout / complete` | `DemoPaymentProvider` (states `demo_*`, no money, no card fields) | facility CRM payment, Toss Payments, app-store billing |
| `WorkoutVideoProvider` | `UploadedVideoProvider` (p_media), `LicensedStockVideoProvider` (`data/content_sources.json`), `ExistingRepoMediaProvider` | `HiggsfieldVideoProvider` (class present, `enabled=False`, raises if called; inputs: exercise id, reference movement, style, narration, duration, framing, anatomy metadata; output stored only after expert review) |
| `MusicProvider` | none / browser-generated ambient tones / permissively licensed tracks with metadata / user's own device audio (browser file picker, never uploaded) | licensed music service |
| `StorageProvider` | `LocalFilesystemStorage` (current `<db>.media`) | S3-compatible, R2, Supabase Storage |

## 8. Readiness gate (original, not PAR-Q+)

Draft V1 questions (final wording reviewed in Phase 5 against the evidence register; translated ko/en):

1. Do you have pain right now that makes moving uncomfortable?
2. Have you felt dizzy, faint or light-headed today?
3. Have you had chest discomfort or pressure recently, at rest or when active?
4. Have you been unusually short of breath recently with little effort?
5. Have you had an injury or surgery in the last few weeks that is still healing?
6. Has a doctor or other health professional told you to avoid or limit exercise right now?
7. Are you pregnant or recently gave birth, or do you have a condition for which you were told to follow a specific exercise program?
8. Do you feel comfortable exercising on your own today?

Outcomes: any "yes" to 2–4 or 6 → `do_not_proceed` (calm stop screen, speak with a qualified professional / facility staff; emergency instruction shown only for current chest pain/severe breathlessness/fainting); "yes" to 1, 5 or 7 → `do_not_proceed` for the standard self-guided session with facility contact (V1 has no validated modified program for these); "no" to 8 → stop with facility contact. Nothing is diagnosed or guessed. The questionnaire is versioned (`data/readiness/questionnaire.v1.json`) and every answer set is stored. Basis: ACSM preparticipation screening logic (Riebe et al., *MSSE* 2015;47:2473–2479, doi:10.1249/MSS.0000000000000664; ACSM GETP 12th ed.), symptom-based warning signs from public health guidance, and the CDC relative-intensity guidance for effort. Age: V1 room sessions require an adult profile (18+); younger members get the stop screen with facility contact.

## 9. Feedback layer (customer vs Advanced)

`pilates/sedens/feedback.py` translates a saved `p_analyses.result` into the customer summary using `data/feedback/observation_rules.json`. No measurement math changes.

- **Capture reliability:** `supported` (person suitable, required view matched, contributing metrics `measured` with confidence ≥ 0.65), `limited` (suitable but some views/metrics withheld), `retake` (refusal; the specific gate reason is mapped to an instruction such as "Step back until your feet are visible"), `not_available`.
- **Observations:** only metrics with `status='measured'` from a matching view are eligible (shoulder-line, hip-line, head-line tilt, lateral trunk inclination front/back; sagittal trunk inclination side). Ratio proxies (forward-head, knee) are shown to customers only as "limited" side-view/front-view observations or withheld, per rule. A "visible difference" display threshold is a documented presentation choice, not a clinical norm, and is labelled as such in the registry.
- **Wording:** describes the camera observation ("Your shoulders were not level in this front-view photo"), adds "This image alone cannot diagnose pain, injury, or a medical condition." Never: score, "bad posture", diagnosis, causal pain claims, risk, muscle weakness/activation.
- **Progress:** reuses the comparable rules (same protocol `sedens_room_scan_v1`, view, measurement version, acceptable reliability) and says "Measured difference from last comparable scan" / "Trend"; "improvement" is not used for any posture metric in V1 (no evidence-supported target exists).
- **Advanced measurements:** existing degrees, ratios, confidence, landmarks, 3D status and the alignment index (with its "engineering rubric, not clinical" label), visible to coach/creator/admin/reviewer and behind a disclosure for the customer's own Passport.

Evidence anchors already verified for this plan: Sugavanam et al., *Disabil Rehabil* 2025;47(7):1659–1676 (static posture and LBP: mixed quality, high heterogeneity, "no firm conclusions"); Tharatipyakul et al., *Heliyon* 2024;10(17):e36589 (pose-estimation feedback: assessment-method effectiveness unclear; erroneous feedback needs study); McKay et al., *Psychol Bull* 2024;150(11):1347–1362 (attentional focus: negligible bias-corrected effects); CDC relative intensity (moderate 5–6/10, vigorous 7–8/10; talk test); WHO 2020 guidelines (Bull et al., *BJSM* 2020;54:1451–1462).

## 10. Recommendation engine

Deterministic rules (`data/sedens_standard/rules.v1.json`, documented in `RECOMMENDATION_RULES.md`) select only from approved items in `data/sedens_standard/exercises.json` / session templates or from an entitled published course session. No LLM.

1. Hard filters: readiness outcome, adult profile, room equipment, level ≤ experience (+1 only for "Challenging" with no recent pain report), approved review status, Standard vs course entitlement.
2. Course precedence: if enrolled in an entitled course and the next session fits the chosen duration, offer it first; Standard is the alternative.
3. Structure: 30 min ≈ 5 warm-up / 20 main / 5 cool-down; 60 min ≈ 10 / 40 / 10 (time-budgeted from exercise durations incl. transitions).
4. Scoring: goal tags and category preference dominate; recent repetition avoidance; prior RPE/pain feedback blocks progression; scan observations may add one focus tag only when reliability is `supported`, capped at ≤25 % of main-block time and at most one of the 2–4 rationale lines.
5. Output: blocks, exercises with regression/progression, duration estimate, RPE target (Easy ≈ 3–4, Moderate ≈ 5–6, Challenging ≈ 7), rationale lines, and the stored `{inputs, rules_fired, library_version, rules_version}`.

## 11. SEDENS Standard library

`tools/sedens_build_standard.py` derives `data/sedens_standard/exercises.json` from `catalog.json` + atlas content (never editing either): de-duplicated muscles, atlas structure ids, joints, supported session types, hold/reps, simple ko/en instruction + one short cue (superiority claims removed), non-medical safety notes, regression/progression, provenance, `review_status` (starts `unreviewed`), reviewer, reviewed date, media refs, anatomy timeline ids. A per-entry audit log records every changed field. Only a curated subset (~30–40 mat exercises) is marked demo-ready for the four seeded sessions (30 min Mobility Reset, 30 min Beginner Mat Pilates, 30 min Core Stability, 60 min Full Body Mobility + Pilates). Unreviewed items carry "Demo content — not yet expert-reviewed."

## 12. Analysis pipeline changes (recommended, minimal)

1. **No change** to RTMO, gates, metric definitions, thresholds, MediaPipe corroboration or persistence in V1. A different detector is not adopted without the benchmark in `SEDENS_VISION_IMPROVEMENT_PLAN.md`.
2. Add the room scan protocol tag `sedens_room_scan_v1` (four views: front, rear, side_left, side_right) on the existing platform job path.
3. Add the customer translation layer (§9) and a gate-reason → instruction map; refusals become "Retake recommended" with the specific instruction.
4. Add **browser-side capture guidance** (EXPERIMENTAL, Phase 7): `@mediapipe/tasks-vision` Pose Landmarker *lite* (Apache-2.0 package; model card Apache-2.0 — re-verify the exact bundle before vendoring), VIDEO mode, ~5–10 fps: head/feet in frame, body height fraction (too close/far), centring, second person (`numPoses=2`), coarse orientation, stillness for auto-capture. Guidance only; server measurement stays authoritative. Benchmark latency on a low-end PC/TV browser first; fallback is a static framing overlay + server check.
5. Optional functional screens (overhead reach, bodyweight squat, balance stance): **not in V1**; each needs the documented purpose/limits/view/quality/evidence/tests first.
6. Server measurement repeatability study (same person, repositioned camera, ten repeats) defined in the vision plan; results gate any future customer-facing progress wording.

## 13. Deployment modes and Render free strategy

`SEDENS_MODE`: `demo_free` (default when `RENDER` is set), `local_room` (default otherwise), `cloud_production` (refuses to start: not implemented).

DEMO_FREE (Render free, 0.1 CPU / 512 MB / ephemeral):
- **Fast SEDENS demo seed** per demo key (target < 5 s): facility "SEDENS Demo Fitness Center" with "AI Private Room 01" (simulated paired device), a second facility for multi-facility access, a fictional customer with 4 prior visits and 2 comparable demo scans (labelled), a fictional coach ("4-Week Core Foundations", free for the Demo Fitness Center), a clearly fictional professor ("Mobility Foundations", ₩29,000 DEMO), a reviewer, an admin. The existing 34-client demo remains in the workspace and is seeded only when that workspace is opened.
- Room scan: **precomputed demo scan** (labelled DEMO) by default; "Run real analysis" uploads to the real pipeline with an honest estimate (~30 s per photo measured on this service, so ~2 min for four).
- Client-side guidance runs in the browser, costing the server nothing.
- Anatomy GLBs are static, gzip and immutable-cached; the room loads the taught muscle/skeleton layers only.
- Persistent warning banner: data resets on restart; creator course export ZIP offered.
- Deploying this branch on Render needs either a second free service or switching the existing service's branch — **owner decision**; nothing is deployed by this work.

LOCAL_ROOM: full pipeline on the room computer, local captures, real device pairing; same code.

## 14. Risks

| Risk | Mitigation |
|---|---|
| Camera feedback misread as clinical | evidence-gated wording rules + banned-phrase tests; Advanced separated; reliability categories |
| PAR-Q+ and other copyrighted content | original questionnaire; legacy PAR-Q left untouched and flagged for legal review |
| Stock clips misrepresent technique or imply endorsement | "Demo media — movement accuracy not yet expert-reviewed"; licence metadata; no endorsement wording; no YouTube/social scraping |
| Free-host limits (CPU, RAM, ephemeral disk) | precomputed demo scan, light seed, export ZIP, explicit banner, no durable-storage claims |
| Browser pose model performance on room hardware | benchmark gate before adoption; static fallback |
| Cross-org data leak via courses/media | single visibility function, course-media join table, entitlement checks, tests for every role × access mode |
| Scope creep (brief covers a year of work) | phase gates; the investor journey (§16) is polished before breadth |
| Atlas weight on TV hardware | lazy iframe, preload during readiness, low-memory profile, WebGL fallback card; workout never depends on anatomy |
| Reviewer attribution overreach | SEDENS Standard starts `unreviewed`; only named reviewers recorded after actual review |
| Korean copy quality | strings authored in ko and en; native review required before real launch (FUTURE) |
| Legal/privacy for body images | explicit capture consent, retention choice, delete controls, no full-session recording, audit events |

## 15. Phases

Each phase lists deliverables, tests and the exit check. Commits are small; messages describe the change.

| Phase | Deliverables | Tests added | Exit |
|---|---|---|---|
| **0 Audit & protect** (this commit) | branch, baseline, `SEDENS_REPO_AUDIT.md`, this plan | — | owner review |
| **1 Domain foundation & rebrand** | `pilates/sedens/` package, migration runner + 0001/0002/0003/0004, org profiles, platform roles, room devices/sessions + `authorize_room`, `DemoCRMProvider`, `/sedens/config`, SEDENS shell + `workspace.html` move + hash shim, i18n scaffold, deployment modes, `SEDENS_PRODUCT_SPEC.md` | migrations idempotent on a copy of a legacy DB; old orgs/students/programs/assessments still open; outside user cannot launch room; expired/revoked token refused; device+session must match | all suites green |
| **2 Creator marketplace foundation** | creator profiles, affiliations, courses/modules/items/versions, access modes, prices, entitlements, `DemoPaymentProvider`, storage abstraction, creator upload with attestation + PDF, rights metadata, course export ZIP, review workflow, facility course control, Creator Studio/Facility/Review UIs, `SEDENS_CONTENT_GOVERNANCE.md` | coach course; professor course; facility-free single/multiple; paid metadata; unpublished inaccessible; creator-rights enforcement; invalid MIME; private media; licence required; export | creator demo journey (§17) runs |
| **3 Customer room flow** | room entry/identify, readiness gate, consent, scan wizard (server pipeline), customer result, setup, recommendation, player, anatomy room bridge + timeline, music, completion | readiness stop paths; 30/60 duration; approved-only; equipment filter; course precedence; explainability stored; timeline changes anatomy; leaving exercise clears state | investor room journey (§16) runs end to end in LOCAL_ROOM |
| **4 Fitness Passport** | passport API + UI, visit recap, comparable progress, course progress, achievements | session updates history; course progress; scan link; no duplicate/fake records | |
| **5 Evidence & feedback overhaul** (runs alongside 3–4, cannot be skipped) | `data/evidence_registry.json`, `SEDENS_FEEDBACK_EVIDENCE.md`, observation rules, banned-wording checks, SEDENS Standard derivation + audit log, `RECOMMENDATION_RULES.md` | no overall posture score; no diagnosis language; technical hidden by default; unsupported metric withheld; non-comparable not compared; refusal → retake | registry covers every customer-facing rule |
| **6 Free demo content** | content import pipeline, `data/content_sources.json`, small set of licence-recorded demo clips (only if downloadable with a verifiable licence; otherwise placeholders + import list), music metadata | source/licence required on every external asset | |
| **7 Render free optimization** | DEMO_FREE light seed, precomputed scan, browser capture guidance (after benchmark), `SEDENS_FREE_DEPLOYMENT.md`, `SEDENS_VISION_IMPROVEMENT_PLAN.md` | works with no credentials; ephemeral warning; demo content after clean boot | |
| **8 Polish & validation** | accessibility (keyboard, captions, contrast, reduced motion), kiosk layout, performance (lazy anatomy, prefetch next video), screenshots, `SEDENS_TEST_REPORT.md`, `SEDENS_FUTURE_INTEGRATIONS.md`, `SEDENS_V1_BUILD_REPORT.md` | browser journey scripts for room/creator/facility | final report |

## 16. Investor room journey (acceptance for Phase 3)

Open SEDENS → Enter AI Private Room → demo member identified → readiness → guided front/left/back/right scan → plain-language observations with reliability → choose 30 min, Moderate, Mobility/Pilates, music → recommended session with "Why this session" → player with video, cue, timer, next preview → anatomy highlights current muscles → isolate a muscle and rotate → return → auto-advance → complete → rate effort and discomfort → Passport updated → course progress shown.

## 17. Creator, professor and facility demos (acceptance for Phase 2)

Coach: Creator Studio → new course → title → session → exercise → upload demo video + PDF/image with attestation → bind anatomy → choose free for my facility / selected facilities / paid → price → save draft → submit for review → preview in a simulated room. Professor: same, no gym membership, several facilities, education or training type. Facility admin: rooms, members, course list by product line, enable/disable/include/feature, Demo CRM page, utilization placeholder computed only from recorded events.

## 18. Owner decisions (recorded 7 October 2026)

1. `/` is the SEDENS home; the existing connected platform moves to `/workspace.html`; legacy `#page=` links keep working through redirect; the old workspace is not deleted or materially rewritten.
2. The existing Render service stays untouched and this branch is not deployed. When the room journey is mature enough for external testing, a **second** free Render service will be created; the existing service will not be switched.
3. Creators: no duplicate creator accounts. A facility coach keeps their account and may gain an `s_creator_profiles` row. An independent professor/expert who belongs to no gym may use a dedicated creator organization. Creator–facility affiliations let one creator distribute content to several organizations without any access to those organizations' customer records; content access and customer-data access are separate permissions, and selling a course to Gym B never grants access to Gym B's members.
4. Content review: Dr. Hong Jong Gi's review applies only to content that can be explicitly proven to have been reviewed by him. The whole catalog is not claimed as professor-reviewed. Until evidence exists, SEDENS Standard entries carry an internal status (`unreviewed`, `sedens_reviewed`, `expert_reviewed`) with reviewer identity, date, evidence/version and scope of review.
5. Customer feedback: the existing 0–100 posture score is removed from all customer-facing SEDENS experiences (it may remain in an engineering/debug view where existing tests depend on it); no replacement overall posture score; feedback is observation-based and confidence-gated.

## 19. Phase 1 status (foundation, room access, rebrand)

Implemented on `claude/sedens-ai-private-room-v1` and stopped here; Phase 2 waits for approval.

**Migrations** (`pilates/sedens/migrations/`, additive, FKs cascade or null):

| File | Tables |
|---|---|
| `0001_tenancy_capabilities.sql` | `s_org_profiles` (facility / creator_studio / sedens), `s_capabilities` |
| `0002_creators.sql` | `s_creator_profiles`, `s_creator_facility_affiliations` (scope `content_distribution` only) |
| `0003_rooms.sql` | `s_room_devices`, `s_room_device_pairings`, `s_room_sessions`, `s_room_access_codes` |
| `0004_crm.sql` | `s_crm_settings`, `s_crm_member_links` |
| `0005_consent_analytics.sql` | `s_consents`, `s_events` |
| `0006_room_activity.sql` | adds `s_room_sessions.last_activity_at` (idle sessions close) |

The runner's own ledger is `s_schema`. No `p_*` table was altered or rebuilt. `0006` is a separate file rather than an edit of `0003` because `0001`–`0005` were already pushed: an applied migration is never edited.

**Modules:** `pilates/sedens/` — `modes`, `migrations`, `core`, `util`, `capabilities`, `creators`, `onboarding`, `crm`, `demo`, `rooms`, `consent`, `analytics`, `library`, `http`. `pilates/serve.py` gained only the `/sedens/` dispatch (before `/platform/`) and the mode resolution at start-up.

**Pages:** `/` (SEDENS home: hero, sign-in and demo, facility console `#/facility`, creator profile `#/creator`, consents `#/account`), `/room.html` (room screen: pairing, demonstration room, customer entry, room session scaffold), `/workspace.html` (unchanged connected platform). `/anatomy.html` is untouched. Legacy links are redirected by an inline script in `index.html`.

**Endpoints:** listed in [the security model](SEDENS_SECURITY_MODEL.md) and the Phase 1 report.

**Room entry:** customers never sign in on the shared room screen. They enter with a single-use, 5-minute room code requested on their own signed-in phone, or with a CRM credential (simulated in the demo). This replaced an earlier draft that let a customer sign in on the screen itself, after the Phase 1 adversarial review showed that it left a 7-day sign-in on a shared screen. No account may be signed in on a room screen at all, and a room session left without pressing End closes after 15 minutes without a room request.

**Staff roles in the SEDENS organization:** reviewers are `coach` accounts; the SEDENS organization's `admin` role is reserved for SEDENS platform administrators, because the coaching workspace lets any administrator manage every account in their organization. A verification names the exact profile content the reviewer saw.

**Exercise review status:** the room library reads the existing catalog read-only and marks every item `{"status": "unreviewed", "reviewer": null, "reviewed_at": null, "evidence": null, "scope": null}`. No SEDENS content claims expert or professor review.

**Posture score:** no SEDENS page shows a posture score; the legacy workspace's engineering "Image alignment index" is unchanged (it is not part of any SEDENS customer view). Observation-based customer feedback is Phase 3/5 work.

**Known limitations:** see [SEDENS_SECURITY_MODEL.md §8](SEDENS_SECURITY_MODEL.md) and [SEDENS_DEPLOYMENT_MODES.md](SEDENS_DEPLOYMENT_MODES.md). In short: SEDENS tables are not yet in organization backups; rate limits are in-memory; QR is typed or keyboard-wedge input; readiness, scan and workout steps are placeholders on the room screen; no cross-organization identity for coaches who coach members in two facilities.
