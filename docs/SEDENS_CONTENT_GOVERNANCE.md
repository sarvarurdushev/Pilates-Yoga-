# SEDENS content governance

Scope: what SEDENS checks before a course reaches customers, who decides each thing, the wording and labels the server enforces, creator verification, the SEDENS Standard exercise content, and the rules for anatomy. Everything here is enforced in `pilates/sedens/*` and tested in `tests/test_sedens_*.py`; pages only show what the server returned. Media rights are described in `docs/SEDENS_MEDIA_RIGHTS.md`, who may see, buy and play a course in `docs/SEDENS_COURSE_ACCESS_MODEL.md`.

SEDENS is a general fitness service. Nothing in this document is a medical, clinical or professional certification, and no content in this repository has been reviewed by an expert.

## 1. Who decides what

| Who | Decides | Never decides |
|---|---|---|
| **Creator** (the `creator` capability with a creator profile) | their course's content, distribution and price; when to submit a version; archiving the course; their files and rights information; asking for verification and offering evidence | whether a version is published; their own verification; anything about another creator's course or files |
| **Facility administrator** | for courses offered to the facility: enabled in its rooms, included for members (only where free there), featured; approving, declining or revoking creator affiliations | a creator's content, files or review (`tests/test_sedens_phase2_security.py::test_12_a_facility_admin_never_changes_a_creators_content`) |
| **SEDENS reviewer** (the `sedens_reviewer` capability, a coach account of the SEDENS organization) | publishing an exact submitted version, with the distribution and price it records; suspending and reinstating a course; approving or rejecting a file's rights; creator verification | their own course, their own files or their own creator profile; anything in the other environment (demonstration or real) |
| **The server, automatically** | refusing medical wording in guided training, unknown anatomy names, files without rights, unready drafts, and the approval of a version whose files lack accepted rights | approval of anything |

## 2. Course review

A course moves **Draft → Submitted → Needs revision / Approved (Published)**, and may be **Suspended** by SEDENS or **Archived** by its creator (`courses.review_state`). Approving a version publishes it in the same step.

Each submission freezes the whole draft into an immutable version snapshot (`courses.submit`; a database trigger refuses any change to a snapshot, `migrations/0011_course_versions.sql`). The reviewer decides on that exact version:

- Only a SEDENS reviewer in the same environment, and never on a course they created (`access.can_review`). The review queue (`GET /sedens/review/courses`) lists only versions in state `submitted`.
- The decision must name the snapshot's SHA-256 the reviewer opened; a different one is refused (`version_changed`).
- Every checklist item must be marked `pass`, `needs_work` or `not_applicable`, each with an optional note of up to 1,000 characters (`checklist_incomplete`).
- A version with any `needs_work` item cannot be approved (`checklist_not_passed`).
- "Needs revision" and "reject" require a comment to the creator (`comment_required`).
- Approving makes that version `published` and the previously published version `superseded`. Customers already enrolled keep the version they enrolled in (`access.effective_version`). "Needs revision" sets the version to `needs_revision`; "reject" sets it to `withdrawn`. A new submission withdraws any earlier version still waiting.
- Comments and checklists are stored per version in `s_course_reviews`, so the creator sees which version each comment is about.

Before submission, `courses.readiness` refuses a draft with no modules, no sessions (guided training) or lessons (professional education), an empty session, no distribution chosen, a paid price that is not on sale, or a file whose rights SEDENS rejected.

At the decision, approval is refused while any file of the version has rights that are not `approved` (409 `rights_not_reviewed`): the reviewer decides each file's rights first, on the same page (`tests/test_sedens_courses.py::test_a_version_is_approved_only_after_every_file_has_accepted_rights`).

The version also records the distribution, facility terms and price the creator submitted, and those are the settings customers and facilities live under once it is published. A later change to them is a draft until the next version is approved (`access.in_force`, `docs/SEDENS_COURSE_ACCESS_MODEL.md` §1; `tests/test_sedens_course_access.py::test_access_and_price_changes_wait_for_the_next_approved_version`).

Tests: `tests/test_sedens_courses.py::test_review_workflow`, `test_versions_are_immutable`, `test_editing_a_published_course_never_changes_enrolled_customers`, `test_reviewer_cannot_review_across_environments`, `test_submit_needs_a_ready_course`.

The review pages are `#/review` (queue) and `#/review/courses/:course/:version` (one version).

### The nine checklist items (`course_review.CHECKLIST`)

| Item | What the reviewer checks |
|---|---|
| `creator_identity` | The creator's identity, and their verification where the course needs it. |
| `rights_licensing` | Every file has rights information and the creator's attestation. Each file's rights are also approved one by one; the version cannot be approved before that. |
| `medical_claims` | No diagnosis, treatment or outcome promises. |
| `safety_wording` | Plain stop rules, no clinical wording. |
| `exercise_instructions` | Instructions are clear, achievable and work self-guided. |
| `demonstration_quality` | Each picture or video shows the movement it claims to show. |
| `anatomy_mappings` | Anatomy is presented as educational illustration, never as measurement. |
| `source_provenance` | Where the content comes from. |
| `price_access` | The price and distribution are what the creator intends. They are the settings customers will get. |

### What the reviewer is shown

`course_review.detail` (`GET /sedens/review/course?id=&version=`) returns the version's snapshot; the creator's public name, type, verification state, institution, qualifications and verification evidence; the rights of every file in the snapshot with each file's current rights review status; earlier reviews of that version; and **wording notes**: claim-like phrases found in the snapshot's title and description (section 4).

## 3. What review is not

- **Not medical certification.** A SEDENS approval says only that a reviewer checked the version against the nine items above. It does not certify that a course is medically safe, therapeutic or suitable for any condition. The checklist asks whether the course stays within general fitness (`course_review` module docstring), and no field, state or label in the course data records a medical certification.
- **Not creator verification.** Verifying a creator is a separate decision on the creator's profile (section 6). An approved course by an unverified creator is still shown as by an unverified creator.
- **Not expert review of movement.** There is no movement-review state for media. Stock and AI-generated files keep their "not yet expert reviewed" labels after a course is approved.
- **Not a review of SEDENS Standard entries.** Approving a course that uses Standard exercises does not change their review status (section 7).
- **Not a review of later edits.** It covers one frozen version, its access settings and price included. Editing a published course, or its access or price, starts a new draft, which needs its own review.
- **Demonstration approvals are not reviews.** In the demonstration marketplace the three courses are approved by a fictional account, "Demo Reviewer (fictional)", with every item marked pass and the note "Demonstration review." and the comment "Demonstration review: fictional content, approved for the demo only." The same account accepts the rights of the one repository illustration a demonstration course uses, with the note "Demonstration review." (`demo_marketplace.PASS`, `_publish`).

## 4. Wording rules (`pilates/sedens/wording.py`)

Guided-training text is read by customers alone in a room, so phrases that diagnose, treat or promise a medical or posture outcome are refused when saved. The patterns are case-insensitive:

| English pattern (`wording.PATTERNS`) | Catches, for example |
|---|---|
| `diagnos…` | diagnose, diagnosis |
| `cure`, `cures`, `cured`, `curing` | "cures back pain" |
| `treat`, `treats`, `treated`, `treating`, `treatment(s)` (not "treat yourself") | "treatment for" |
| `therapy`, `therapies`, `therapeutic` | |
| `rehabilitat…` | rehabilitation |
| `clinically` | "clinically proven" |
| `medically proven / approved / certified` | |
| `medical-grade`, `medical grade` | |
| `prevent(s) injur…` | "prevents injury" |
| `correct(s) (your) posture` | |
| `fix(es) (your) back / posture / spine` | "fix your back" |
| `heal`, `heals` | |
| `pain-free`, `pain free` | |
| `guarantee`, `guarantees`, `guaranteed` | |

| Korean pattern | Meaning |
|---|---|
| 진단 | diagnosis |
| 치료 | treatment |
| 완치 | complete cure |
| 재활 | rehabilitation |
| 자세 교정 | posture correction |
| 부상 예방 | injury prevention |
| 의학적으로 | medically |
| 통증(이) 사라… | pain disappears |

**Guided training refuses.** `wording.require_general_fitness` rejects the save with `medical_claim_wording` (400), quoting up to five phrases found. It is applied to the course title, subtitle, description, intended audience, safety information, outcomes and goals; module and session titles and summaries; each step's title, easier option, harder option, cue and narration; and each anatomy timeline cue (`courses._guard_wording`). The prerequisites field is not checked. Tests: `tests/test_sedens_courses.py::test_guided_training_refuses_medical_claims` (English and Korean).

**Professional education gets notes, not refusals.** Courses for coaches and students may discuss such topics, so nothing is refused. The Creator Studio receives `wording_notes` for the title, description and outcomes (`courses.editor_view`), and the reviewer receives `wording_notes` for the submitted title and description (`course_review.detail`). Lesson bodies are not scanned. Test: `test_professional_education_gets_wording_notes_instead`.

The list catches the plain cases early; the reviewer still checks every course under `medical_claims`. A course import passes through the same save functions, so the same rules apply to imported text.

## 5. Labels shown to people

The server attaches these labels to the data it returns; the text is fixed in code or data, in English and Korean.

| Label | English | Korean | Where it comes from |
|---|---|---|---|
| Demonstration content | DEMO MARKETPLACE CONTENT | (English only) | `demo_marketplace.DEMO_LABEL`, in the demonstration professor course's subtitle ("DEMO MARKETPLACE CONTENT — simulated purchase only") and description. Every course card also carries `demo: true` for a demonstration organization's course (`access.course_card`), and course detail carries `demo_marketplace`. |
| Simulated purchase | DEMO — no real payment occurred. | 데모 — 실제 결제는 이루어지지 않았습니다. | `payments.NOTICE`; returned with the catalog, with every simulated purchase receipt and in the studio vocabulary. `DemoPaymentProvider.real_money` is `False` and purchases work only in demonstration organizations (`test_10_a_demo_payment_is_never_real_money`). |
| Educational anatomy | Educational anatomy — not measured muscle activation. | 교육용 해부학 — 측정된 근육 활성도가 아닙니다. | returned with the anatomy picker (`GET /sedens/creator/anatomy`), with every room session plan (`marketplace.room_session_plan`), in the studio vocabulary, in each SEDENS Standard entry and in every course export's manifest |
| SEDENS Standard v0 | Demo content — not yet expert-reviewed | 데모 콘텐츠 — 아직 전문가 검토 전 | `standard.label()`, from `data/sedens_standard/exercises.v0.json`; returned with the exercise picker and used as the subtitle of the demonstration course "SEDENS Standard: Foundations" |
| Stock media | Demo media — movement not yet expert reviewed | 데모 미디어 — 동작은 아직 전문가 검토 전 | `video_providers.STOCK_LABEL`, on every file whose licence is `pexels` or `pixabay` |
| AI-generated illustration | AI-generated illustration — not a real instructor; movement not yet expert reviewed | AI 생성 일러스트 — 실제 강사가 아니며 동작은 아직 전문가 검토 전 | each repository illustration's `label` in `data/content_sources.json` |
| Course export | General fitness content. Not medical advice. | (English only) | `course_export` manifest |

Demonstration people and organizations are marked in their names or biographies: "Prof. Sample Demo (fictional)" with the biography "A fictional demonstration professor. Not a real person, and holds no real credentials."; "Mobility Lab (demo)"; "SEDENS International (demo)"; "Demo Reviewer (fictional)"; and Minji Lee, whose biography reads "Fictional demonstration coach at SEDENS Demo Fitness Center."

**Course badges** (`access.course_card`) come from the kind of organization that owns the course, nothing else: a course of the SEDENS organization is `sedens_standard`, a facility's is `facility_program`, a creator studio's is `premium_expert`. No badge means reviewed, verified or expert. A `premium_expert` course by an unverified creator is shown with that creator's unverified state.

## 6. Creator verification

`s_creator_profiles.verification_state` has five values. The labels are in `web/src/sedens/strings.js` (`creator.state_*`):

| State | English label | Korean label | How it is reached |
|---|---|---|---|
| `unverified` | Unverified | 미인증 | the starting state |
| `pending` | Verification requested | 인증 요청됨 | the creator asks (`POST /sedens/creator/verification/request`), from `unverified` or `rejected`; a reviewed field of a verified or pending profile changes; a restore |
| `verified` | Verified | 인증됨 | a reviewer, only from `pending` |
| `rejected` | Rejected | 인증 거절 | a reviewer |
| `suspended` | Suspended | 정지됨 | a reviewer; the creator cannot ask again from here |

**Verification applies to an exact profile state.** Each profile carries a `version`, a fingerprint of the six reviewed fields: display name, creator type, biography, institution, qualifications and specialties (`creators.content_version`). A reviewer decides with `POST /sedens/review/creators/decide` (`creators.decide_verification`), inside one transaction; `verified` is accepted only with the version the reviewer was shown and only if the profile has not changed since (`profile_changed`). A reviewer never decides their own profile (`self_review`) or a profile in the other environment.

**A material change ends the verification.** Saving a change to any reviewed field of a `verified` or `pending` profile ends the verification at once: the profile returns to **Verification requested** (`pending`), the reviewer and date are cleared, and the note reads "Profile changed after review. Waiting for SEDENS to review it again." (`creators.save_profile`). The profile is back in the reviewers' queue with its new content and its new `version`, and is shown as not verified until a reviewer decides again (`tests/test_sedens_capabilities.py::test_sedens_reviewer_verifies`, `test_a_verification_names_the_content_the_reviewer_saw`). A creator can never set their own state: `verification_state`, `verified_by`, `verified_at`, `user_id`, `slug` and `id` are refused as read-only fields.

**A professor or expert title never implies verification.** The creator type is self-declared and limited by the kind of organization (a facility: `coach`, `professor` or `expert`; a creator studio: `professor` or `expert`; the SEDENS organization: `sedens_editorial`). Public profiles carry `self_declared: true` until verified, and the field is labelled "Creator type (self-declared)". A course card's `verified` flag is true only for the state `verified`, read from the live profile. Tests: `tests/test_sedens_phase2_security.py::test_8_an_unverified_creator_never_appears_verified`; the demonstration professor is unverified with no institution or qualifications (`tests/test_sedens_demo_marketplace.py::test_the_professor_is_fictional_and_unverified`).

**Evidence.** A creator may offer up to 20 pieces of evidence (`POST /sedens/creator/evidence`, `course_media.add_evidence`): a kind (`qualification`, `institution`, `identity`, `other`), a required description, an optional web link and an optional file of their own (usually a PDF, uploaded with the rights attestation). The reviewer sees the evidence with each profile in the creators queue (`GET /sedens/review/creators`, `tests/test_sedens_http.py::test_reviewer_verifies_over_http`) and in the course review detail, and can open an attached file: `access.media_access` serves evidence files to SEDENS reviewers of the same environment, never their own (`tests/test_sedens_courses.py::test_reviewers_can_open_verification_evidence`). Evidence is not part of the reviewed fingerprint, so adding evidence does not change a verification.

**Restores return verification to review.** An organization restore never brings back `verified`: a verified profile returns as `pending` ("Verification requested") with the note "Restored from a backup. Waiting for SEDENS to confirm the verification again.", and the reviewer's name is never restored. A suspension or rejection already on this server stays (`docs/SEDENS_BACKUP_RESTORE.md`; `tests/test_sedens_backup.py::test_an_archive_never_carries_a_verification`, `test_a_fresh_studio_restore_returns_the_verification_to_review`).

**What verification does not do.** Suspending or rejecting a creator's verification changes the state shown with their courses; it does not take the courses down. Revoking someone's `creator` permission stops them editing, but does not unpublish their published courses either. A course is taken down by suspending the course (section 8).

## 7. SEDENS Standard content

The platform's exercise catalog (`pilates/platform/catalog.json`, 199 exercises) is read and never edited. SEDENS Standard v0 is a separate, small file, `data/sedens_standard/exercises.v0.json`, holding only ten exercises rewritten for self-guided room use (`pilates/sedens/standard.py`). The module calls it an audited copy: each entry was rewritten from the catalog with the changes recorded in its provenance and must pass `standard.problems()`. It has **not** been reviewed by SEDENS or by any expert.

| Id | Catalog key | Title | Level |
|---|---|---|---|
| `std-breathing` | `breathing` | Pilates Breathing | foundation |
| `std-imprint-release` | `imprintRelease` | Imprint and Release | foundation |
| `std-pelvic-curl` | `pelvicCurl` | Pelvic Curl | foundation |
| `std-knee-folds` | `kneeFolds` | Knee Folds | foundation |
| `std-supine-spine-twist` | `spineTwistSupine` | Supine Spine Twist | foundation |
| `std-arm-arcs` | `shoulderPlacement` | Arm Arcs and Shoulder Placement | foundation |
| `std-dead-bug` | `deadBug` | Dead Bug | intermediate |
| `std-cat-stretch` | `catStretchMat` | Cat Stretch | foundation |
| `std-opposite-reach` | `birdDog` | Opposite Arm and Leg Reach | intermediate |
| `std-clam` | `clam` | Clam | foundation |

Each entry has, in Korean and English: a title, plain customer steps, one cue, breathing, exercise-specific easier and harder options, a stop rule ("Stop and rest if anything hurts, if you feel dizzy or short of breath, or if you are unsure. Ask a facility coach before trying again.") and a before-you-start note. It also has a dose, equipment, an anatomy mapping by structure name with the educational anatomy label, **provenance** (the source "Repository exercise catalog entry and anatomy illustration content for this exercise key (read only, never edited).", drafted by "SEDENS editorial draft" on 2026-10-08, and the list of changes made, such as clinical contraindication wording replaced with a plain stop rule and the source's uncited evidence tags not carried over) and a **review record**.

**Review statuses** are `unreviewed`, `sedens_reviewed` and `expert_reviewed`. **Every v0 entry is `unreviewed`**, with no reviewer, date, evidence or scope. A status other than `unreviewed` is accepted only with the reviewer, date, evidence and scope that prove it (`standard.problems()`). No expert review is attributed to any named person, and none may be without explicit evidence for that exact material.

What the tests hold (`tests/test_sedens_standard.py`):

- `test_the_standard_file_is_sound`: `standard.problems()` is empty, and the file holds between 8 and 20 entries ("only enough to prove the architecture").
- `test_the_original_catalog_is_untouched_and_pinned`: the file records the catalog's SHA-256, and any change to the catalog is reported.
- `test_no_review_is_claimed_without_evidence`: every review record is exactly `unreviewed` with empty reviewer, date, evidence and scope; the label is "Demo content — not yet expert-reviewed"; and the file does not contain the name of the expert discussed in the project brief, in English or Korean.
- `test_customer_wording_stays_general_fitness`: no customer text contains phrases such as "clinically", "prevents injury", "corrects posture", "diagnos…" or their Korean equivalents, and every anatomy mapping carries the educational label.

Course steps may use a Standard exercise (`exercise_source: standard`) or a catalog key (`catalog`); a catalog exercise is always shown as `unreviewed`. Each course snapshot records the Standard version it was built on. The demonstration course "SEDENS Standard: Foundations" uses all ten entries and keeps the Standard label in its subtitle and description (`tests/test_sedens_demo_marketplace.py::test_the_standard_course_keeps_its_review_label`).

## 8. Suspension and archiving

**Suspension** is SEDENS's. A reviewer suspends a course with a required reason, or reinstates it (`POST /sedens/review/course/suspend`, `course_review.suspend`). A suspended course disappears at once from every catalog, facility console and room, and its files stop being served to customers, because every check asks whether the course is published and not suspended (`access.published`). The creator sees the state `suspended` with the reason, and cannot submit again until SEDENS reinstates it (`course_suspended`). Each suspension and reinstatement is recorded as a review entry and in the audit log. A facility administrator cannot suspend. Tests: `tests/test_sedens_course_access.py::test_suspended_course_disappears_everywhere`, `test_12_a_facility_admin_never_changes_a_creators_content`.

**Archiving** is the creator's. The course's own creator archives it (`POST /sedens/creator/course/archive`, `courses.archive`). An archived course is also no longer published anywhere, and every further edit is refused (`course_archived`). There is no un-archive route yet. Enrolled customers still see the course in their list, marked unavailable, with their progress.

## 9. Anatomy authoring rules

A guided-training step can name the body structures it is about, each with a role (`focus`, `prime`, `assisting`, `steadying`), and a timeline of anatomy moments (`courses.save_anatomy`). The rules:

- **Registry keys only.** Structures are stored by their name in the anatomy registry, such as `rectus abdominis`, `left scapula (4.0)` or `brain:7`. Numeric viewer ids (renumbered when the atlas is rebuilt) and FMA ids (shared by many structures) are never stored (`pilates/sedens/atlas.py`).
- **Validated on every save.** `atlas.validate` refuses unknown names (`unknown_structures`), names from the other atlas view than the step's (`taught` or `complete`; `mixed_atlas`), empty or non-text entries, and more than 40 structures. The server reads the same `web/src/generated/structures.json` with the same rules as the browser, including whole muscles drawn as named parts; if the file is missing, validation fails closed (`atlas_unavailable`). A creator cannot save a structure the viewer cannot draw.
- **Timeline.** At most 24 moments per step; each has a start and an end in milliseconds (end after start, no overlaps), at least one validated structure, a display mode (`highlight` or `isolate`), an optional layer, and an optional cue of up to 280 characters, which follows the guided-training wording rules.
- **Starting point.** A new step starts with its exercise's own mapping: the Standard entry's structures, or the catalog entry's muscle names that exist in the registry.
- **Educational only.** Mappings are illustration, never measured muscle activation. The server returns the label "Educational anatomy — not measured muscle activation." with the anatomy picker, the studio vocabulary and every room session plan (section 5). Snapshots record the hash of the atlas they were built against.
- **Preview without storing ids.** The anatomy picker searches by name (`GET /sedens/creator/anatomy`) and the preview returns viewer ids for display only (`GET /sedens/creator/anatomy/preview`).

The synchronized playback of the timeline in the room is Phase 3. Tests: `tests/test_sedens_courses.py::test_anatomy_is_validated_against_the_registry`; `tests/test_sedens_standard.py::test_atlas_accepts_registry_names_including_whole_muscles`, `test_atlas_refuses_unknown_mixed_or_too_many`, `test_exercise_structures_come_from_the_catalog_muscles`, `test_the_anatomy_picker_searches_and_previews_by_name`, `test_python_registry_matches_the_browser_registry` (skipped when Node is not installed).

## 10. Not built yet

| Item | State |
|---|---|
| Expert review of any content | none exists; every SEDENS Standard entry is `unreviewed`, and no file has a movement review |
| Movement review of stock or AI-generated media | no field or workflow; the labels stay |
| Wording checks on prerequisites and professional-education lesson bodies | not built; the reviewer checks them |
| Un-archiving a course | not built |
| Taking a creator's courses down by suspending the creator | not built; suspend each course |
| Real payments | none; purchases are simulated in demonstrations only |
| Room playback of anatomy timelines and the guided room player | Phase 3 |
| Home playback of guided training | off (`access.HOME_PLAYBACK = False`) |
