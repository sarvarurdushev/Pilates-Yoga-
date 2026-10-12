# SEDENS marketplace model

Scope: what a SEDENS course is, how a creator builds one, how it is reviewed, priced, bought (in a demonstration), enrolled in, played and exported, and what the demonstration marketplace contains. Who may see, enroll in, play and edit a course is in `docs/SEDENS_COURSE_ACCESS_MODEL.md`; review rules, wording and verification in `docs/SEDENS_CONTENT_GOVERNANCE.md`; files and their rights in `docs/SEDENS_MEDIA_RIGHTS.md`.

Built in Phase 2: the Creator Studio, SEDENS review, the customer catalog, the facility course console and the room's course list. **No real money moves**: purchases are simulated, and only in demonstrations. **The guided room player is Phase 3**: a room can list courses, fetch one session's steps and mark it done, but there is no step-by-step player yet.

## 1. Two course types

| | Guided training | Professional education |
|---|---|---|
| For | customers, alone in an AI Private Room | coaches, students and professionals |
| Built from | modules → sessions → ordered **steps** | modules → **lessons** |
| Played | only in an authorized room (`access.can_play_in_room`), never on a phone or at home | read and completed outside a room once enrolled |
| Files | step video and picture, served only to a room that may play the course | lesson files (PDF, video, image), downloadable once enrolled |
| Medical wording | refused when saved (`wording.require_general_fitness`) | allowed, flagged to the creator and reviewer as notes |
| Who enrolls | customers (`customers_only` otherwise) | any signed-in person who may see it |

`s_courses.course_type` is chosen when the course is created and never changes.

## 2. Structure

Live editing uses normalized tables (`pilates/sedens/migrations/0010_courses.sql`); each submission freezes the whole draft into an immutable JSON snapshot (section 5).

| Entity | Table | Holds |
|---|---|---|
| Course | `s_courses` | type, language (`ko`, `en`), title, subtitle, description, category, level, audience, prerequisites, safety, outcomes, equipment, goals, body areas, estimated minutes, weeks, sessions per week, cover picture, distribution, revision counter, published version, suspension, archive |
| Price | `s_course_prices` | free or paid, amount in minor units, currency (`KRW`, `USD`), sale state (`active`, `paused`, `not_for_sale`); a CHECK keeps free ⇔ amount 0 |
| Facility terms | `s_course_facility_terms` | a facility (and optionally one location) the course is offered to, and whether it is free there |
| Module | `s_course_modules` | ordered title and summary, for example "Week 1 — Foundations" |
| Session (guided) | `s_course_sessions` | ordered title, summary, estimated minutes, for example "Session 1 — Hip & Core Mobility" |
| Step (guided) | `s_course_steps` | exercise reference (`standard` or `catalog`), order, phase (`warm_up`, `main`, `cool_down`), sets, repetitions, hold, work and rest seconds, sides, easier and harder options, customer cue, narration, optional video and picture, equipment, next-step behaviour (`manual` or `auto`), an optional easier/harder variant of another step, the anatomy view (`taught` or `complete`) |
| Step anatomy | `s_course_step_anatomy` | body structures by registry name with a role (`focus`, `prime`, `assisting`, `steadying`) |
| Anatomy timeline | `s_course_step_timeline` | moments of the demonstration: start and end, structures, `highlight` or `isolate`, layer, cue |
| Lesson (professional) | `s_course_lessons` | kind (`video`, `pdf`, `article`, `image`, `anatomy_task`, `quiz`, `case`, `exercise_demo`), title, body, optional file, optional exercise, flexible `detail` |

**Exercises come from two read-only sources only**: the ten SEDENS Standard v0 entries (`data/sedens_standard/exercises.v0.json`, labelled "Demo content — not yet expert-reviewed") and the platform's 199-exercise catalog (`pilates/platform/catalog.json`, never edited, always shown as unreviewed). A course never points at a facility's own exercises or its `p_media`. Anatomy rules are in `docs/SEDENS_CONTENT_GOVERNANCE.md` §9.

## 3. Who creates courses

Any account holding the `creator` capability with a creator profile (`docs/SEDENS_SECURITY_MODEL.md`): a facility coach, an independent coach or professor in a creator studio, an expert, or the SEDENS editorial team. The creator type is self-declared and never implies verification; verification is a separate SEDENS decision shown with every course (`docs/SEDENS_CONTENT_GOVERNANCE.md` §6).

A course belongs to its creator's organization and creator profile. Only that creator edits it (`access.can_edit`): never a colleague, a facility administrator or SEDENS staff.

## 4. The Creator Studio

Pages (hash routes in `web/src/sedens/app.js`):

| Page | Route | Module |
|---|---|---|
| Studio home: courses, profile, verification evidence, facilities | `#/creator` | `studio.js` `studioHome` |
| New course (type, then details) | `#/creator/courses/new` | `courseNew` |
| Course editor: Details, Structure, Who can offer it & price, Submit for review, Versions & comments, Export/import/archive | `#/creator/courses/:course` | `courseEdit` |
| Session editor: ordered steps, dose, cues, files, anatomy with live preview | `#/creator/courses/:course/sessions/:session` | `sessionEdit` |
| Media library: upload with rights, repository illustrations, retire | `#/creator/media` | `mediaLibrary` |

Every edit names the course `revision` it was made on; a stale one is refused (`course_changed`) so two tabs never overwrite each other. The editor lists what still stops a submission (`courses.readiness`: no modules, no sessions or lessons, an empty session, no distribution, a paid price that is not on sale, a file whose rights were rejected), each with a link to the section that fixes it. The upload button stays disabled until the rights attestation is checked, and the server checks it again before reading the file.

## 5. Versions and review

1. **Submit.** `POST /sedens/creator/course/submit` freezes the draft into version *n* of `s_course_versions`: the course metadata, modules, sessions, steps with anatomy and timelines, lessons, **the distribution, facility terms and price**, the files used, the SEDENS Standard version and the anatomy atlas hash. Its SHA-256 is stored with it, and a trigger refuses any later change. A new submission withdraws an earlier one still waiting.
2. **Review.** A SEDENS reviewer opens that exact version (`#/review/courses/:course/:version`), decides each file's rights, marks the nine checklist items and decides, naming the SHA-256 they opened. Approval is refused while a file lacks accepted rights (`rights_not_reviewed`) or an item needs work.
3. **Publish.** Approval publishes the version and supersedes the previous one. Customers and facilities then follow that version's content **and its access settings and price** (`access.in_force`). Editing the course, its access or its price afterwards changes only the draft, which needs its own review.
4. **Enrollments stay put.** A customer keeps the version they enrolled in while SEDENS stands behind it (`published` or `superseded`); new customers get the new one (`access.effective_version`).

Needs revision and reject require a comment; reviews are stored per version (`s_course_reviews`) and shown to the creator under Versions & comments. SEDENS can suspend a course (it leaves every catalog and room at once) and the creator can archive it. Details: `docs/SEDENS_CONTENT_GOVERNANCE.md` §2–3 and §8.

## 6. Price

- Amounts are integers in minor units: won for `KRW` (₩29,000 is `29000`), cents for `USD`. 0 to 100,000,000.
- `free` or `paid`. A new course is free and `not_for_sale`. When a creator switches a course to paid in the studio, the sale state offered is "On sale".
- Sale state: `active` (can be bought), `paused`, `not_for_sale`. A paid course must be on sale to be submitted.
- **Free terms** make a course free at one facility (or one of its locations) whatever its price, only for facilities in the creator's network.
- What customers see and pay is the approved version's price (`access.in_force`), never a draft price.

### Content review state vs commercial availability

Two separate things decide whether a new customer can buy a course:

| | Content review state | Commercial availability |
|---|---|---|
| What it is | what the course is: content, who may offer it, its price and reviewed sale status | whether new customers may buy the approved version **right now** |
| Stored in | the published version's snapshot (`s_course_versions`), read through `access.in_force` | `s_course_sales` (migration `0013_course_sales.sql`), read through `sales.paused` |
| Changed by | the creator's draft, then SEDENS review (a new version) | the course's own creator, at once, with no review (`POST /sedens/creator/course/sales {id, paused}`, `sales.set_paused`) |
| Takes effect | when SEDENS approves the version | immediately |

**Pausing new sales** (the studio's "New sales" box on the access tab, shown as "Sales paused" / "판매 일시 중지"):

- needs a published course whose approved price is paid and on sale (`not_for_sale` otherwise), that is not suspended (`course_suspended`) or archived;
- changes nothing reviewed: not the snapshot, the published version, the content revision, enrollments, entitlements or facility settings;
- stops new purchases at once: the course page and catalog show "Sales paused", `enroll_option` answers `sales_paused`, and a purchase is refused with 409 `sales_paused`;
- keeps everyone who already has the course: a bought course still plays in the room and shows its progress; a facility's free or included offer works as before (it is the facility's offer, not a sale);
- applies to the published version and approved price it was made on. When SEDENS approves a newer version, that version's reviewed sale status applies and the creator can pause again.

**Resuming** needs the course still published, not suspended, and the same approved version and price as when it was paused (`not_paused` otherwise). Only the course's creator pauses or resumes (404 for anyone else). **SEDENS suspension** still takes the whole course down at once, whatever its sales state, and a reinstated course keeps the creator's pause. Every pause and resume is in the audit log. Tests: `tests/test_sedens_sales.py`; over HTTP, `tests/test_sedens_course_http.py::test_investor_journey` step 9.

## 7. Payments: simulated only

`pilates/sedens/payments.py`:

- `PaymentProvider` is the interface; `DemoPaymentProvider` (`name = "demo"`, `real_money = False`) is the only implementation and `PROVIDER` is always it.
- A purchase works only in a **demonstration organization**. Anywhere else `POST /sedens/courses/demo-purchase` answers 503 `payments_unavailable` ("Purchases are not available yet. SEDENS only simulates them in demonstrations.") and writes nothing.
- It requires a course the person may see, guided training only for customers, a paid course on sale (`not_for_sale`), and no entitlement already (`already_entitled`).
- It writes an `s_purchases` row (`provider` can only be `demo`, state `demo_completed`, the approved amount and currency), a `demo_purchase` entitlement and an audit entry, enrolls the person, and returns the notice **"DEMO — no real payment occurred."** / "데모 — 실제 결제는 이루어지지 않았습니다."
- **No card details exist anywhere**: no field, table or form asks for them. The purchase page shows a confirmation panel with the price, the DEMO notice and "No card details are collected." before anything is recorded.
- A `demo_purchase` entitlement counts only while its purchase row is `demo_completed` (`demo_refunded` exists in the schema; nothing sets it yet).

Future providers are named, not integrated: a facility's CRM billing, Toss Payments, app stores (`payments.FUTURE_PROVIDERS`; `docs/SEDENS_FUTURE_INTEGRATIONS.md`).

## 8. Entitlements, enrollment and progress

| Step | What happens |
|---|---|
| Enroll | `POST /sedens/courses/enroll` checks `access.enroll_option`, records the entitlement it rests on (`facility_included`, `facility_free`, `marketplace_free`, or an existing one) and an enrollment pinned to the published version. A paid course answers 402 `purchase_required`. |
| First room launch | A customer who never enrolled but may play a free course in this room is enrolled on first launch with a facility entitlement (`marketplace.room_session_plan`). |
| Session done | The room marks a guided session done (`POST /sedens/room/course/complete`), only where the course may be played. |
| Lesson done | A professional lesson is marked done where it is read (`POST /sedens/courses/lesson/complete`), only by an enrolled person with a standing entitlement. |
| Progress | `s_course_progress` records sessions and lessons by their ids in the enrolled version's snapshot; `GET /sedens/courses/mine` and the course page show completed out of total, per module. |

Facility entitlements are re-derived on every use; a full table is in `docs/SEDENS_COURSE_ACCESS_MODEL.md` §4.

## 9. Where customers and facilities meet courses

| Page | Route | What it shows |
|---|---|---|
| Course catalog | `#/courses` | every course the person may see in their environment, as cards with type badge, creator and verification state, price or "Included with your membership", DEMO marks; filters by type, price and "offered at my facility"; featured first, then enabled here, then SEDENS Standard, facility programs, premium experts |
| Course page | `#/courses/:course` | overview, outline (module and session titles, number of steps), enroll or demonstration purchase, progress; for guided training, "Workouts in this course play only in an AI Private Room" and no launch button |
| My courses | `#/my` | enrollments with progress, unavailable ones marked |
| Facility courses | `#/facility/courses` | for a facility administrator: every course offered to the facility, with enable, include (only where free) and feature switches |
| Room course list | the room screen (`GET /sedens/room/courses`) | guided courses enabled at this room, featured first, each with its outline and whether this customer can play it |

## 10. Export and import

Free demonstration hosting can lose everything on a restart, so a creator can take a course away and bring it back (`pilates/sedens/course_export.py`):

- **Export** (`GET /sedens/creator/course/export?id=`, the course's own creator only): a ZIP with `course.json` (metadata, modules, sessions, steps with anatomy and timelines, lessons, access and price), one `versions/<n>.json` per version with its review state, `media.json` (each file's kind, type, size, SHA-256 and rights), the course's own uploaded files, and `manifest.json` with every member's SHA-256 and the educational and general-fitness labels. Never passwords, tokens, customer records, other organizations' identifiers or unrelated files. A missing file stops the export.
- **Import** (`POST /sedens/creator/course/import`): checks every member against the manifest, refuses unknown member names and JSON over 8 MB, and needs the importer's own rights attestation. The archive, sent and unpacked, is capped by the deployment mode (`course_export.ARCHIVE_LIMITS`: 400 MB on a room computer, 60 MB on the free demonstration host, 413 `import_too_large`), and receiving it takes one of the server's two upload slots (429 `uploads_busy`; `tests/test_sedens_courses.py::test_course_imports_follow_the_deployment_mode_and_share_the_upload_slots`). It rebuilds the course as a **new draft offered to nobody**, through the same save functions as the studio (wording, exercise and anatomy checks, upload checks, rights `unreviewed`). Access, price and versions are not imported; SEDENS reviews it before anyone sees it.

Organization backups also carry courses, versions, files, settings, entitlements, enrollments and progress, with restored versions returned to review (`docs/SEDENS_BACKUP_RESTORE.md`).

## 11. The demonstration marketplace

Every visitor's demonstration (`demo-<key>`) gets its own copy (`pilates/sedens/demo_marketplace.py`), isolated from every other visitor's:

| Course | Creator | Type | Distribution and price | At SEDENS Demo Fitness Center |
|---|---|---|---|---|
| SEDENS Standard: Foundations | SEDENS Editorial (demo SEDENS organization) | guided, uses all ten Standard entries, subtitle "Demo content — not yet expert-reviewed" | marketplace, free | enabled, included |
| 4-Week Core Foundations | Minji Lee, a fictional demonstration coach of the facility | guided, two modules, with one repository illustration (AI-generated, labelled) | selected facility, free there | enabled, included, featured |
| Mobility Foundations | "Prof. Sample Demo (fictional)", a creator studio "Mobility Lab (demo)"; unverified, no institution or qualifications, biography "A fictional demonstration professor. Not a real person, and holds no real credentials." | guided; subtitle "DEMO MARKETPLACE CONTENT — simulated purchase only" | marketplace, ₩29,000, on sale | enabled, not included |

The three are approved by "Demo Reviewer (fictional)" with the note "Demonstration review." (the illustration's rights included). These are demonstration steps, not reviews; nothing in the demonstration claims expert review or real credentials. The demonstration roles on the SEDENS home are the customer, coach, facility administrator, the creator (Minji Lee), the professor and the SEDENS reviewer.

Tests: `tests/test_sedens_demo_marketplace.py`; the whole journey over HTTP in `tests/test_sedens_course_http.py::test_investor_journey` and in a browser in `web/test/sedens-courses.browser.mjs`.

## 12. Routes

All under `/sedens/`, JSON unless noted, POSTs guarded by the `X-Sedens-Request` header and an Origin check (`pilates/sedens/course_http.py`).

| Area | Routes |
|---|---|
| Creator Studio | `GET creator/studio`, `GET creator/exercises`, `GET creator/anatomy`, `GET creator/anatomy/preview`, `POST creator/courses/create`, `GET creator/course`, `GET creator/course/version`, `POST creator/course/update`, `POST creator/course/access`, `POST creator/course/module`, `POST creator/course/session`, `POST creator/course/step`, `POST creator/course/anatomy`, `POST creator/course/lesson`, `POST creator/course/move`, `POST creator/course/remove`, `POST creator/course/submit`, `POST creator/course/archive` |
| Files | `POST creator/media/upload` (streamed), `GET creator/media/sources`, `POST creator/media/repo-asset`, `POST creator/media/retire`, `POST creator/evidence`, `GET media/file` (streamed) |
| Export | `GET creator/course/export` (streamed ZIP), `POST creator/course/import` (streamed ZIP) |
| SEDENS review | `GET review/courses`, `GET review/course`, `POST review/course/decide`, `POST review/course/suspend`, `POST review/media/decide` (and, from Phase 1, `GET review/creators`, `POST review/creators/decide`) |
| Facility | `GET facility/courses`, `POST facility/courses/setting` |
| Customers | `GET courses/catalog`, `GET courses/detail`, `POST courses/enroll`, `POST courses/demo-purchase`, `POST courses/lesson/complete`, `GET courses/mine` |
| Room | `GET room/courses`, `POST room/course/session`, `POST room/course/complete` |

## 13. Not built yet

| Item | State |
|---|---|
| Real payments (facility CRM, Toss Payments, app stores) | interface only; demonstrations simulate purchases |
| Refunds, entitlement revocation, moving an enrollment to a newer version | no routes |
| The guided room player (step-by-step playback, anatomy timeline in sync) | Phase 3 |
| Home playback of guided training | off (`access.HOME_PLAYBACK = False`) |
| Quizzes and anatomy tasks as interactive lessons | stored as lesson kinds with free-form `detail`; no player |
| Un-archiving a course | no route |
