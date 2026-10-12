# SEDENS Phase 2 report: Creator Studio and course marketplace foundation

Branch: `claude/sedens-ai-private-room-v1` (Phase 2 is `014f7b4` … this commit, after Phase 1.5's `ef9fbbb`). Nothing was deployed; the original branch and the existing Render service were not touched. No real payment, no Higgsfield call, no paid service, no downloaded workout video. Phase 3 (readiness, scan, recommendation, workout player) has not started.

## 1. The stop condition

| # | Required | Shown by |
|---|---|---|
| 1 | A fictional coach creates a guided course with a module, a session, existing exercises as ordered steps, demonstration media with rights, and anatomy | browser: `web/test/sedens-courses.browser.mjs` part 1 (Minji Lee uploads a picture with its rights and attestation, builds "Week 1" → "Breath and brace" with Pilates Breathing and Dead Bug from the exercise library, attaches the picture, saves the step's anatomy moment); HTTP: `tests/test_sedens_course_http.py::test_investor_journey` step 1 |
| 2 | Free for the selected Demo Fitness Center, submitted | the same: Selected facilities → SEDENS Demo Fitness Center, Include, Free for this facility → Submit for SEDENS review |
| 3 | The reviewer approves, the facility admin enables, the customer sees it included and free | the reviewer is refused while the picture's rights are unreviewed, accepts them, passes the nine items and approves; the facility administrator enables and includes it; the customer's catalog card reads "Included with your membership" |
| 4 | A fictional professor creates a ₩29,000 course and publishes it through review | "Prof. Sample Demo (fictional)" builds "Hip Mobility Lab", marketplace, paid 29,000 won (the sale state switches to On sale), submits; the reviewer approves; the facility enables it (not included) |
| 5 | The customer makes a DEMO PURCHASE and receives the entitlement | Buy (demonstration) → a confirmation panel with the price, "DEMO — no real payment occurred." and "No card details are collected." → Complete demonstration purchase; the course shows Enrolled and "Bought in the demonstration" |
| 6 | Outside a room the customer sees the course and progress but cannot launch the guided workout | the course page and My courses show the course and "Completed 0 of 1", with "Workouts in this course play only in an AI Private Room" and no launch button; the session route answers 403 outside a room |

The browser journey then checks the access rules from outside: another visitor's demonstration cannot open either course (404 page), cannot read any of the coach's files (404 for each), a customer is refused the review and facility pages, and the professor cannot open the coach's course.

## 2. Test totals

| | Python | Frontend (`npm test`) |
|---|---|---|
| Phase 0 baseline | 2,631 passed, 1 skipped | 513 passed |
| After Phase 1 | 2,823 passed, 1 skipped | 532 passed |
| Before Phase 2 (`ef9fbbb`, after Phase 1.5) | 2,841 collected | 532 passed |
| **After Phase 2** | **2,969 passed, 1 skipped** (129 more than before Phase 2) | **538 passed** |

The full Python run took 19 minutes on `1cb8e29`; the commits after it change only wording, the content-source rule text and documents, and the suites they touch (media store, strings, frontend) passed again afterwards. The one skip is pre-existing: `tests/test_groups.py` needs the BodyParts3D tables, which are not in the repository (`scripts/fetch_bodyparts3d.sh`).

New Phase 2 test files (98 tests): `test_sedens_courses.py` (23), `test_sedens_course_access.py` (17), `test_sedens_phase2_security.py` (12), `test_sedens_course_http.py` (4), `test_sedens_course_backup.py` (6), `test_sedens_demo_marketplace.py` (6), `test_sedens_media_store.py` (8), `test_sedens_standard.py` (22); plus additions to the backup, HTTP and capability tests, and frontend `sedens-router.test.mjs` and `sedens-strings-used.test.mjs`.

Other checks:

| Check | Result |
|---|---|
| Production build (`npm run build`) | built; the only warning is the size of the anatomy viewer's bundle, which Phase 2 did not change |
| New Creator Studio and marketplace browser journey (`sedens-courses.browser.mjs`), including the entitlement and access checks | passed on the final code, no page errors (also run twice back to back earlier, which exercises the demonstration-entry rate limit) |
| Room screen journey (`sedens-room.browser.mjs`) | passed on the final code, 0 page errors |
| Existing workspace regressions (`platform-routing`, `platform-demo-auth`, `platform-summary`, `platform-historical-source`, `platform-feedback-markers`, `program-recording`, `program-finding-atlas`) | all passed with the Phase 2 pages in place; `platform-routing` and `platform-demo-auth` again on the final code (the later commits change course access rules, not the workspace) |
| Not run | `program-media-acceptance` (needs a video fixture outside the repository) and `hosted-platform` (targets a deployed site; nothing is deployed) |

## 3. Migrations

| File | Tables |
|---|---|
| `0009_course_media.sql` | `s_media_objects`, `s_media_rights`, `s_verification_evidence` |
| `0010_courses.sql` | `s_courses`, `s_course_prices`, `s_course_facility_terms`, `s_course_modules`, `s_course_sessions`, `s_course_steps`, `s_course_step_anatomy`, `s_course_step_timeline`, `s_course_lessons` |
| `0011_course_versions.sql` | `s_course_versions` (immutable by trigger), `s_course_version_media`, `s_course_reviews` |
| `0012_marketplace.sql` | `s_facility_course_settings`, `s_purchases` (provider `demo` only), `s_entitlements`, `s_enrollments`, `s_course_progress`, `s_demo_layers` |

Phase 1.5 work finished during this phase added `0008_affiliation_endings.sql`. All are additive; no `p_*` table changed. Guided sessions are normalized steps, as the brief required, with immutable JSON snapshots per version.

## 4. Routes and pages

38 JSON routes and 4 streamed routes under `/sedens/`, listed in `docs/SEDENS_MARKETPLACE_MODEL.md` §12: Creator Studio (18), files and evidence (4, plus the streamed upload and file routes), export and import (streamed), SEDENS review (5), facility (2), customers (6), room (3).

Pages: `#/creator`, `#/creator/courses/new`, `#/creator/courses/:course`, `#/creator/courses/:course/sessions/:session`, `#/creator/media`, `#/review`, `#/review/courses/:course/:version`, `#/courses`, `#/courses/:course`, `#/my`, `#/facility/courses`, and the room screen's course list with a session outline. Every page has English and Korean text (key parity is tested), and technical details (ids, sizes, hashes) sit behind "Advanced".

## 5. Course access matrix

The seven examples of the brief, each a test in `tests/test_sedens_course_access.py` (details in `docs/SEDENS_COURSE_ACCESS_MODEL.md` §11):

| Example | Own facility | Other facility | Room |
|---|---|---|---|
| Coach course free for Gym A | customer sees it, enrolls as included | cannot see it; cannot enable it (404) | plays at A; `not_enabled_here` at B |
| Affiliated coach, free at A and B | both see and play it | C cannot | ends at B when B revokes the affiliation |
| Professor ₩29,000, A enables | customers of A and B see it; purchase required | — | A: `purchase_required`; B: `not_enabled_here`; A cannot include it (`paid_not_includable`); buying outside a demonstration: 503 |
| Paid marketplace course free for partner A | A's customers get it included | B's customers must buy | becomes paid at A when the affiliation ends |
| Facility program at every location | plays at every location | — | a location-scoped term plays at that location only |
| ₩0 marketplace course | anyone enrolls free | — | plays only where a facility enabled it |
| Disabled by the facility | enrolled customers keep seeing it | — | launch refused; the facility entitlement stops counting |

Rules around them: guided playback is room-only even when owned (`HOME_PLAYBACK = False`); suspended and unpublished courses appear nowhere; customers follow the access settings and price of the approved version.

## 6. Security review

The twelve attacks of the brief were each attempted (`tests/test_sedens_phase2_security.py`); the results and the issues fixed are in `docs/SEDENS_SECURITY_MODEL.md` §9. Every reproduced issue has a test.

| Found | Fixed |
|---|---|
| A colleague in the same organization could attach and read another creator's files | files belong to their creator profile |
| A version could be approved while its files' rights were unreviewed | approval refused (`rights_not_reviewed`) until a reviewer accepts each file |
| A creator could widen who sees a published course, or change its price, without review | customers follow the published version's settings (`access.in_force`) |
| A reviewer could approve the rights of their own file | `self_review` |
| A course import accepted 400 MB on the free host outside the upload slots | capped by mode (60 MB free), sent and unpacked, and takes an upload slot |
| A customer pinned to an older version lost its pictures in the room | the room customer's enrolled version counts |
| Reviewers could not open verification evidence; the verification queue did not show it | both fixed |
| A verified profile edited after review fell out of the review queue | it returns to "Verification requested" |
| The media library implied SEDENS reviews movements | it now says the label always shows |

## 7. Media rights

Summary of `docs/SEDENS_MEDIA_RIGHTS.md`:

- Every upload needs the attestation "I own this material or have permission to distribute it through SEDENS." (version `2026-10-v1`) and rights fields (licence type, original creator, source and licence links where the licence needs them, restrictions, identifiable person). Rights are validated before the body is read; the upload button stays disabled until the attestation is checked.
- Bytes decide the type: MP4/WebM headers, Pillow-verified images re-encoded without metadata, PDFs without active content. Limits follow the mode.
- Files are private, outside `p_media` and `web/`, served only after `access.media_access` with `nosniff`, a sandboxing CSP and PDFs as downloads.
- A SEDENS reviewer (never the file's owner) approves or rejects each file's rights; a rejected file blocks submission; a version is approved only when all its files' rights are approved.
- Repository illustrations are AI-generated and labelled "AI-generated illustration — not a real instructor; movement not yet expert reviewed". Stock clips: none curated, the import manifest is empty, nothing downloads automatically. Higgsfield: an inactive interface that reads no key and refuses every request.

## 8. Backup and restore

Organization archives carry courses, versions, files (re-checked like uploads on restore), rights, settings, entitlements, enrollments and progress (`docs/SEDENS_BACKUP_RESTORE.md`, "Courses (Phase 2)"). A restored published course returns to SEDENS review with its snapshot rebuilt and hashed by this server; rights approvals and creator verifications return to review; simulated purchases never move between organizations. Checked by script on the final code: a seeded demonstration facility exports and restores into a new organization with all 152,154 records and 174 files; its published course returns to review (`courses_to_confirm: 1`) with its illustration's rights (`media_rights_to_review: 1`), and its 2 settings for courses of the demonstration's other organizations are left out because those courses belong to another environment than the new organization. A creator can also export and re-import one course; an import becomes a new draft offered to nobody.

## 9. Known limitations

- **The guided room player is Phase 3.** The room lists courses and a session's steps and can mark it done; there is no step-by-step player or synchronized anatomy timeline.
- **Payments are simulated**, demonstrations only. No refunds, entitlement revocation or enrollment migration routes.
- **A creator cannot pause sales at once** on a published course (the sale state is part of the approved settings); archiving stops it at once.
- **No movement review** of media and **no expert review** of any content: every SEDENS Standard entry is `unreviewed`, and no review is attributed to any person.
- **No creator preview in a simulated room** (needs the Phase 3 player); the session editor previews anatomy and the review page shows the exact snapshot.
- **The Creator Studio is new pages**, not the coaching workspace's program builder, whose one-client data model does not fit reviewed, versioned courses.
- **Free hosting forgets everything** on restart; each demonstration adds about 76 MB to the database (almost all the existing workspace sample analyses) and nothing removes old demonstrations while the server runs (`docs/SEDENS_FREE_DEPLOYMENT.md`).
- PDF checks see uncompressed markers only (PDFs are always sandboxed downloads); videos are checked by header, not decoded; rate and upload limits are per process.

## 10. Screenshots reviewed

From `web/test/sedens-courses.browser.mjs` (1280 px unless noted): Creator Studio home; media library with an upload and the repository illustrations; session editor with two steps, the picture and an anatomy moment; the submitted course; the reviewer's decided version with files and rights; the facility course console; the customer catalog (English and Korean); the demonstration purchase confirmation; the purchased course page; My courses; the course editor on a 390 px phone. Also the creators verification queue with evidence, and the room screen's course list and session outline (English, Korean, phone). Issues seen in them and fixed: the phone editor captured before loading (test timing), "Ready to submit" shown on a published course, the stock-label wording.

## 11. Documents

Added: `SEDENS_MARKETPLACE_MODEL.md`, `SEDENS_COURSE_ACCESS_MODEL.md`, `SEDENS_MEDIA_RIGHTS.md`, `SEDENS_CONTENT_GOVERNANCE.md`, `SEDENS_FREE_DEPLOYMENT.md`, `SEDENS_FUTURE_INTEGRATIONS.md`, this report. Updated: `SEDENS_IMPLEMENTATION_PLAN.md` (§20), `SEDENS_SECURITY_MODEL.md` (§9), `SEDENS_BACKUP_RESTORE.md`, `SEDENS_DEPLOYMENT_MODES.md`.
