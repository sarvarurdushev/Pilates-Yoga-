# SEDENS course access model

Scope: who may see, enroll in, play, download, edit and review a SEDENS course in Phase 2, and why. Every rule here lives in one module, `pilates/sedens/access.py`, and is tested in `tests/test_sedens_course_access.py` (the seven examples of the Phase 2 brief) and `tests/test_sedens_phase2_security.py` (the attacks). Routes call `access.py`; nothing decides access from whether a course happens to appear in a list. The detail response already carries the answers a page needs (`enroll`, `play_here`, and the card flags `free_here`, `included_here`, `enabled_here`, `enrolled`, `purchased`), so a page has no reason to work them out itself.

Course structure, authoring, review and payments are described in `docs/SEDENS_MARKETPLACE_MODEL.md`.

## 1. Three independent settings

A creator chooses three things separately. None of them implies another.

| Setting | Values | Stored in | Set by |
|---|---|---|---|
| Distribution (who may offer it) | `creator_only` (the default for a new course), `selected_facilities`, `network`, `marketplace` | draft: `s_courses.distribution`; in force: the published version's snapshot | the course's creator, `POST /sedens/creator/course/access` (`courses.set_access`); a SEDENS reviewer approves it with the version |
| Price | `free` or `paid` (amount, currency, sale state), plus per-facility **free terms** | draft: `s_course_prices`, `s_course_facility_terms`; in force: the published version's snapshot | the same call, approved the same way |
| Visibility | draft, submitted, published | derived from `s_course_versions` states (`courses.visibility`) | the creator submits; a SEDENS reviewer approves |

### Distribution

| Value | Offered to (`access.offered_to`, its `basis`) |
|---|---|
| `creator_only` | nobody. A course with this setting cannot be submitted (readiness code `no_distribution`). |
| `selected_facilities` | each facility the creator listed in `s_course_facility_terms` (`selected`), while that facility is still in the creator's network (section 2). A term may name one location; without a location it covers every location. |
| `network` | the creator's own facility (`home_facility`) and every facility with an approved affiliation with the creator (`approved_affiliation`). An affiliation scoped to one location offers the course at that location only. |
| `marketplace` | any facility in the same environment (`marketplace`). Any signed-in person in the same environment may also see the course. |

`offered_to` also requires that the target is an organization of kind `facility`, that it is in the same environment as the course owner (section 9), and that the course is published.

### Price

- `price_type` is `free` (amount 0) or `paid` (a positive amount); a database CHECK keeps the two consistent. A new course starts free and `not_for_sale`.
- A **free term** (`s_course_facility_terms.free = 1`) makes the course free at that facility whatever its price, for any distribution. Example 4 below is a paid marketplace course that is free at one partner facility.
- A `selected_facilities` term with `free = 0` offers the course there at its normal price.
- `access.is_free` is true for a `free` price (or no price row); `access.on_sale` is true only for a `paid` price whose sale state is `active`.

### Visibility

Only a **published** course is seen by anyone other than its creator and SEDENS reviewers. `access.published(course)` is true when the course has a `published_version` and is neither suspended nor archived. The creator sees `visibility` (`draft`, `submitted`, `published`) and the finer `review_state` (`draft`, `submitted`, `needs_revision`, `published`, `suspended`, `archived`) in the editor (`courses.visibility`, `courses.review_state`). Customers always read a version snapshot, never the draft rows.

### Access settings are reviewed with the content

Every version snapshot records the distribution, facility terms and price the creator submitted (its `distribution`, `facilities` and `price` fields), and the reviewer checks them (checklist item `price_access`). Customers and facilities live under the settings of the **published version**: `access.in_force(course)` reads them from that snapshot, and every rule in this document (`offered_to`, `is_free`, `on_sale`, `can_view_metadata`, `enroll_option`, the course card, the demonstration purchase's amount) uses it. The live rows are the creator's draft. `courses.set_access` is allowed on a published course, but the change reaches customers only when SEDENS approves the next version; the studio says so on the access tab of a published course. An unpublished course offers nothing (`in_force` returns `creator_only`).

Test: `tests/test_sedens_course_access.py::test_access_and_price_changes_wait_for_the_next_approved_version` (a published free facility course made a paid marketplace course stays free and invisible elsewhere until the new version is approved; then the other facility's customer sees it at its price and the former inclusion stops counting).

The network restriction (section 2) and facility settings (section 3) stay live: they are decisions of the facility, not of the creator.

## 2. The network restriction

Selected facilities and free terms are limited to the creator's network: their own facility (the organization of the creator's account, when it is a facility) and facilities that approved an affiliation with them (`access.network_basis`).

- **When saving.** `courses.set_access` refuses a facility outside the network, an organization that is not a facility, or an unknown id (404 `unknown_facility`), a location of another facility (404 `unknown_location`), more than 50 entries, and `selected_facilities` with no facility (400 `no_facilities`). Tests: `tests/test_sedens_courses.py::test_selected_facilities_must_be_real_facilities`, `tests/test_sedens_course_access.py::test_creators_offer_only_to_their_own_network`.
- **When used.** `access.offered_to` counts a facility's approved terms only while `network_basis` still holds. When an affiliation is revoked or declined, the selected offer and the free term for that facility stop counting at once. The term rows are not deleted: they stay inert while the facility is outside the network and count again if the facility later approves a new affiliation. Tests: `test_revoked_affiliation_stops_the_offer`, `test_paid_marketplace_course_free_for_one_partner` (the course becomes paid at the former partner).
- **Affiliation grants content distribution only.** It never opens the facility's customer records (`docs/SEDENS_SECURITY_MODEL.md` §3). Tests: `test_affiliation_only_distributes_content`, `tests/test_sedens_phase2_security.py::test_1_affiliation_never_opens_the_facilitys_members`.

## 3. Facility settings

For each course offered to it, a facility administrator decides three things, stored in `s_facility_course_settings`. With no row, all three are off.

| Setting | Meaning |
|---|---|
| `enabled` | the course can be launched in this facility's rooms and enrolled in through the facility's offer |
| `included` | members get it as part of their membership. Counts only while the course is **free at this facility**: `access.enabled_at` reports `included` as `setting.included and offer.free` |
| `featured` | listed first in the room's course list and the catalog |

`marketplace.set_facility_course` (`POST /sedens/facility/courses/setting`) enforces:

| Rule | Refusal |
|---|---|
| caller is an `admin` of an organization of kind `facility` | 403 `admin_required` (a coach of the facility is refused: `test_3_a_facility_cannot_enable_what_is_not_offered_to_it`) |
| the course is published and offered to this facility | 404 `not_offered` (drafts, submitted versions, other facilities' courses and unknown ids alike) |
| `included` only where the course is free at this facility | 400 `paid_not_includable` |
| `included` or `featured` only when `enabled` | 400 `enable_first` |

A facility setting never changes the course itself: a facility administrator cannot edit a creator's course (section 6, `can_edit`).

## 4. Entitlements

An entitlement is the stored reason a person may use a course (`s_entitlements`, one row per person, course and source). Access is never inferred from a course being visible.

| Source | Created when | Counts on each use while (`access.entitlements`) |
|---|---|---|
| `marketplace_free` | a person enrolls in a free marketplace course (`marketplace.enroll`) | stored: not re-checked. It still stands if the creator later makes the course paid. |
| `demo_purchase` | a simulated purchase in a demonstration (`payments.DemoPaymentProvider.purchase`) | its `s_purchases` row exists with state `demo_completed` |
| `facility_free` | a customer enrolls through their facility's free offer, or first launches a session in the room (`marketplace.enroll`, `marketplace.room_session_plan`) | the facility still offers and enables the course, it is still free there, and the person is still an active `student` of that facility |
| `facility_included` | the same, when the facility includes the course | as `facility_free`, and the facility still includes it |

`facility_free` and `facility_included` are therefore **re-derived on every use**: disabling the course, removing it from the facility's offer, an affiliation ending, or the person leaving the facility ends them without any row changing (`test_course_disabled_by_facility_cannot_launch`). A `demo_purchase` entitlement is honoured only through its purchase record (`test_4_no_paid_entitlement_without_a_purchase` inserts a `demo_refunded` purchase and shows its entitlement does not count). Rows with `revoked_at` set are ignored; no current route sets it.

Creator preview and reviewer preview are not stored entitlements. They are the `can_edit` and `can_review` answers below, which let the creator and a reviewer see the course and its files at any stage. Neither lets anyone play a guided session: the room requires a customer.

SEDENS Standard content has no source of its own: a SEDENS Standard course is a published course owned by the SEDENS organization, reached through the same sources (in the demonstration, a free marketplace course that the facility includes).

## 5. Enrollments are pinned to a version

- One enrollment per person and course (`s_enrollments`, `UNIQUE(user_id, course_id)`). It records the course's `published_version` at the moment of enrollment and the entitlement it rests on.
- It is created by `POST /sedens/courses/enroll`, after a demonstration purchase (`marketplace.purchase`), or on the first room launch of a free course (`marketplace.room_session_plan`).
- `access.effective_version` decides which version a person reads: their own version while it is `published` or `superseded`, otherwise the course's published version. Only a restore leaves an enrollment on any other state, because restored versions return to review.
- Publishing a new version supersedes the old one and never moves existing enrollments. People who enroll afterwards get the new version. Test: `tests/test_sedens_courses.py::test_editing_a_published_course_never_changes_enrolled_customers` (an enrolled customer keeps version 1 with one step while a new customer gets version 2 with two).
- Progress (`s_course_progress`) is recorded against session and lesson ids of the enrolled version's snapshot.
- There is no route yet to move an enrollment to a newer version.

## 6. The six questions

All six are functions in `pilates/sedens/access.py`. A refusal that would reveal a course's existence is answered with 404 (`unknown_course`, `media_not_found`).

### `can_view_metadata(actor, course)`

Title, creator, overview, module and session titles, price, enrollment and progress.

1. No signed-in person: no.
2. The course's creator (`can_edit`) or a reviewer who may review it (`can_review`): yes, at any stage, drafts included.
3. Otherwise the course must be published.
4. The viewer's organization must be in the same environment as the course owner's.
5. Distribution `marketplace`: yes.
6. A customer (session role `student`): yes when they hold a standing entitlement or an enrollment. Otherwise yes only when they are an active student of their organization and that facility has **enabled** the course at one of their assigned locations (or at facility level, if they have no location assignment).
7. A facility administrator (session role `admin`): yes when the course is offered to their facility, enabled or not, so they can decide about it.
8. Anyone else, for example a coach who is not the creator: no.

An enrolled customer keeps seeing the course and their progress after the facility disables it, as long as the course stays published (rule 6).

### `can_enroll(actor, course)`

`can_enroll` returns `enroll_option(...)["ok"]`. `enroll_option` checks in this order and reports the first that applies:

| # | Condition | Result (`reason`, `source`) |
|---|---|---|
| 1 | not `can_view_metadata`, or not published | no, `not_available` |
| 2 | guided training and the person is not a customer | no, `customers_only` |
| 3 | already enrolled | no, `already_enrolled` |
| 4 | holds a standing entitlement | yes, `entitled`, that entitlement's source |
| 5 | a customer of a facility that enabled the course, free there, at their location | yes, `facility`, `facility_included` when included, else `facility_free` |
| 6 | marketplace distribution and free | yes, `free`, `marketplace_free` |
| 7 | paid and on sale | no, `purchase_required` |
| 8 | anything else | no, `not_available` |

`POST /sedens/courses/enroll` turns these into 402 (`purchase_required`), 409 (`already_enrolled`), 403 (`customers_only`) or 404.

### `can_play_in_room(room, course)`

Launch a guided workout. `room` is the `RoomContext` returned by `rooms.authorize()`: a paired room screen, an active room session, matching scope and an authenticated customer, with no account signed in on the screen (`docs/SEDENS_SECURITY_MODEL.md` §4). Returns `{"ok", "reason"}`:

| # | Condition | Result |
|---|---|---|
| 1 | no room context | `ok` = `HOME_PLAYBACK` (False), `room_only` |
| 2 | not guided training | no, `not_guided_training` |
| 3 | not published | no, `not_available` |
| 4 | not enabled at the room's facility and location (`enabled_at`) | no, `not_enabled_here` |
| 5 | the room's customer holds a standing entitlement | yes, `entitled` |
| 6 | free at this facility and the customer is an active student there | yes, `free_here` |
| 7 | otherwise | no, `purchase_required` |

Owning a course never skips rule 4: a course plays only where a facility enabled it (`test_free_marketplace_course`).

### `can_download_resource(actor, course, object_id)`

Open a professional-education file (PDF, video, image) outside a room.

1. No signed-in person: no.
2. The creator or a reviewer who may review it: yes.
3. The course must be professional education and published. Guided-training files are never downloadable.
4. The person must be enrolled and hold a standing entitlement.
5. The file must belong to the person's effective version (`s_course_version_media`).

### `can_edit(actor, course)`

Yes only when the person signed in belongs to the course's owner organization, is the account of the course's creator profile, and currently holds the `creator` capability (with the Phase 1 rules: eligible role, current session role). Never a facility administrator, a colleague in the same organization, or SEDENS staff. Editing also needs the course to be unarchived (409 `course_archived`) and the current `revision` (409 `course_changed`). Tests: `test_facility_admin_never_edits_a_coach_course`, `tests/test_sedens_phase2_security.py::test_2_a_creator_never_edits_another_creators_course`, `test_12_a_facility_admin_never_changes_a_creators_content`.

### `can_review(actor, course)`

Yes only for a holder of `sedens_reviewer` (a coach account of the SEDENS organization, `docs/SEDENS_SECURITY_MODEL.md` §1), in the same environment as the course owner, who is not the course's own creator. Tests: `tests/test_sedens_courses.py::test_review_workflow` (the creator's own queue is empty), `test_reviewer_cannot_review_across_environments`.

## 7. Room-only playback

Guided training plays only inside an authorized room, even for a customer who owns the course.

Outside a room, `GET /sedens/courses/detail` (`marketplace.detail`) returns the card (title, creator, price, enrolled and purchased state), the overview, the outline (module titles, session titles and lengths, and the **number** of steps per session), the version, the enrollment option, progress, `play_here` (always `{"ok": false, "reason": "room_only"}`) and `room_only` (true for guided training). A session's steps are returned only by `POST /sedens/room/course/session` (`marketplace.room_session_plan`), which requires `rooms.authorize()` and `can_play_in_room`. A guided step's video or picture is served only to a room that may play the course (section 8).

`access.HOME_PLAYBACK = False`. It is a placeholder for future home (B2C) playback, not an implementation: it only changes the answer reported when there is no room. Every route that returns steps or guided media still requires an authorized room. Building home playback needs its own rule.

Professional education is different: it is never played in a room (`not_guided_training`), its lessons are completed where they are read (`POST /sedens/courses/lesson/complete`), and its files are opened outside a room once enrolled (`can_download_resource`). Coaches and administrators may enroll in professional education; guided training is for customers.

Tests: `test_guided_playback_is_room_only_even_when_owned`, `tests/test_sedens_courses.py::test_professional_lessons_are_completed_outside_the_room`, `tests/test_sedens_course_http.py::test_investor_journey` (step 7: a phone gets `device_not_paired` for the session and 404 for the step picture; step 8: the paired room screen gets both).

## 8. Course media

Course files are read only through `access.media_access(actor, room, object_id)`, served by `GET /sedens/media/file?id=`. They are never stored in `p_media` and never served by `/platform/media` (`test_5_course_media_never_crosses_organizations`). Anything not allowed is a 404 that does not reveal whether the file exists. A file is served when one of these holds:

1. **The creator's own file:** the person signed in belongs to the file's owner organization, holds `creator`, and is the file's creator (a file whose creator profile is gone stays with that organization's administrator). A colleague's files are never shared.
2. For a course version that uses the file (`s_course_version_media`):
   - a reviewer who may review the course, for a version that is `submitted`, `published` or `needs_revision`;
   - the course's **cover picture** of the published version, for anyone who may see the course;
   - for the published version, or the effective version of the signed-in person or of the room's customer (an enrollment pinned to an older version keeps its files): a room that may play the course (`can_play_in_room`), or a person who may download it (`can_download_resource`).

No version is approved while one of its files lacks rights a SEDENS reviewer accepted (409 `rights_not_reviewed`, `course_review.decide`), so every file that reaches a customer through rule 2 has accepted rights at the time of approval (`docs/SEDENS_MEDIA_RIGHTS.md`). Test: `tests/test_sedens_courses.py::test_a_customer_on_an_older_version_still_sees_its_pictures_in_the_room` for the pinned version.

PDFs are served as downloads. Every file is sent with `nosniff` and a sandboxing content-security policy, and videos answer byte ranges (`pilates/sedens/media_store.py`). Rights handling for files is described in `docs/SEDENS_MEDIA_RIGHTS.md`.

## 9. Environments

`util.environment(org)` is `real` for a real organization and `demo:<key>` for a demonstration organization, where `<key>` is the visitor's 32-character demonstration key in the organization id (`demo-<key>`, `demo-<key>-sedens`, `demo-<key>-professor`). Courses, facilities, viewers and reviewers meet only within one environment: `offered_to`, `can_view_metadata`, `can_review`, the catalog and the review queue all compare environments. One visitor's demonstration never sees another's, and a real reviewer never reviews demonstration courses. Tests: `tests/test_sedens_demo_marketplace.py::test_demonstrations_never_see_each_other`, `tests/test_sedens_courses.py::test_reviewer_cannot_review_across_environments`.

## 10. Suspension and archive

- **Suspension** is a SEDENS decision. A reviewer who may review the course calls `POST /sedens/review/course/suspend` with a reason (400 `comment_required` without one); the same route with `suspend: false` reinstates it. Both are recorded in `s_course_reviews`. A suspended course is not published, so it leaves the catalog, the facility console and the room at once, its detail and enrollment are refused, and its files are served only to its creator and reviewers. The creator sees `review_state = suspended` with the reason, and cannot submit while suspended (409 `course_suspended`). Tests: `test_suspended_course_disappears_everywhere`, `test_6_unpublished_courses_never_leak`.
- **Archive** is the creator's decision (`POST /sedens/creator/course/archive`). An archived course is not published either, and can no longer be edited (409 `course_archived`). There is no route to unarchive.
- In both cases enrollments and progress stay. `GET /sedens/courses/mine` still lists the enrollment with `available: false`.

## 11. The seven examples

Each example from Part F of the Phase 2 brief is a test in `tests/test_sedens_course_access.py`. "Room" means a paired room screen with the facility's customer entered by room code.

| # | Example | Setup | Expected answers | Test |
|---|---|---|---|---|
| 1 | Coach at Gym A, course free for Gym A members, not visible elsewhere | Gym A's coach; `selected_facilities` = Gym A, free; Gym A enables and includes it | Gym A customer: can view; enroll source `facility_included`; Gym A room `ok`, `free_here`. Gym B customer and Gym B administrator: cannot view. Gym B enabling it: 404. Gym B room: `not_enabled_here` | `test_coach_course_free_for_own_facility_only` |
| 2 | Coach affiliated with Gym A and Gym B, free for both | Gym A's coach with an approved affiliation at Gym B; `network`, free; A and B enable it | basis `home_facility` at A, `approved_affiliation` at B, none at C. Rooms at A and B: `ok`, `free_here`. Room at C: `not_enabled_here`. After B revokes the affiliation, B's room: `not_enabled_here` | `test_affiliated_coach_course_free_at_both_facilities`, `test_revoked_affiliation_stops_the_offer`, `test_affiliation_only_distributes_content` |
| 3 | Professor with no gym, ₩29,000 course; Gym A enables it, Gym B does not | creator-studio professor; `marketplace`, paid 29000 KRW, active; A enables | customers of A and B: can view; enroll `purchase_required`. A's room: `purchase_required`. B's room: `not_enabled_here`. A including it: 400 `paid_not_includable`. Buying outside a demonstration: 503 `payments_unavailable`, no purchase row | `test_paid_professor_course_enabled_by_one_facility` |
| 4 | Paid marketplace course, free for one partner facility | professor with an approved affiliation at A; `marketplace`, 29000 KRW, free term for A; A enables and includes, B enables | A customer: enroll `facility_included`; A's room `ok`, `free_here`; card `included_here`, `free_here`, price 29000. B customer: `purchase_required`; B's room `purchase_required`. After A revokes the affiliation, A's room: `purchase_required`. A free term for a facility outside the network: 404 | `test_paid_marketplace_course_free_for_one_partner`, `test_creators_offer_only_to_their_own_network` |
| 5 | Facility's own coach program, free at all its locations | Gym A's coach; `selected_facilities` = Gym A with no location, free; A enables and includes | rooms at both of A's locations: `ok`. Badge `facility_program`. A term naming one location: plays there only (`not_enabled_here` at the other), and customers of the other location cannot view it | `test_facility_program_free_at_every_location`, `test_location_scoped_course_stays_at_its_location` |
| 6 | Marketplace course for ₩0 | professor; `marketplace`, free; A enables, C does not | C customer: enroll source `marketplace_free`; after enrolling, C's room `not_enabled_here`. A's room: `ok` | `test_free_marketplace_course` |
| 7 | Course disabled by the facility administrator | Gym A course, free; A enables and includes it; a customer enrolls and can play | after A disables it: room `not_enabled_here`; session launch 403; the customer's `facility_included` entitlement no longer counts | `test_course_disabled_by_facility_cannot_launch` |

Rules around the examples:

| Rule | Test |
|---|---|
| Guided playback is room-only even when owned; `HOME_PLAYBACK` is False | `test_guided_playback_is_room_only_even_when_owned` |
| A suspended course disappears from catalog, console, room and detail | `test_suspended_course_disappears_everywhere`, `tests/test_sedens_phase2_security.py::test_6_unpublished_courses_never_leak` |
| Drafts are invisible to customers and facilities | `test_drafts_are_invisible_to_customers_and_facilities` |
| A facility administrator never edits a coach's course | `test_facility_admin_never_edits_a_coach_course`, `test_12_a_facility_admin_never_changes_a_creators_content` |
| The room lists featured courses first | `test_the_room_lists_what_the_facility_features_first` |
| A facility cannot enable a course not offered to it | `test_3_a_facility_cannot_enable_what_is_not_offered_to_it` |
| No paid entitlement without a completed simulated purchase | `test_4_no_paid_entitlement_without_a_purchase` |
| Course media never crosses organizations | `test_5_course_media_never_crosses_organizations` |
| A published version never changes after an edit | `test_7_a_published_version_never_changes`, `tests/test_sedens_courses.py::test_versions_are_immutable` |
| The same journey over HTTP | `tests/test_sedens_course_http.py::test_investor_journey` |

## Known gaps

These are true of the code today and are not covered by tests unless named.

- **A creator cannot stop selling at once.** Because the sale state is part of the approved settings, pausing a paid course reaches customers with the next approved version. A creator who must stop at once archives the course (it leaves every catalog and room; enrollments stay).
- **Home playback** is not built (`HOME_PLAYBACK = False`, section 7).
- **The guided room player is Phase 3.** Phase 2 provides the room's course list (`GET /sedens/room/courses`), one session's steps (`POST /sedens/room/course/session`) and completion (`POST /sedens/room/course/complete`). Step-by-step playback with the anatomy timeline is not built.
- **Payments are simulated.** Only `DemoPaymentProvider` exists, and only in demonstrations (`docs/SEDENS_MARKETPLACE_MODEL.md`).
- No route moves an enrollment to a newer version, revokes an entitlement, or refunds a simulated purchase (the `demo_refunded` state exists and is honoured, but nothing sets it).

## What restore does

Organization backups carry courses, facility settings, entitlements, enrollments and progress under the rules in `docs/SEDENS_BACKUP_RESTORE.md` ("Courses (Phase 2)"). In short:

- A restored course comes back **unpublished**: the version that was published returns to the review queue, its snapshot rebuilt with the new ids and hashed by this server, so an archive can never publish a course or forge a snapshot (`tests/test_sedens_course_backup.py::test_an_archive_cannot_publish_a_course_or_forge_its_snapshot`).
- A facility's settings for another organization's course come back while that course exists here in the same environment. Facility entitlements come back and are re-checked on every use. A free marketplace entitlement for another organization's course comes back only while that course is still free on the marketplace. Simulated purchases never move between organizations (`test_an_archive_cannot_grant_another_organizations_paid_course`).
- An enrollment comes back with its entitlement and a version this server published. `effective_version` reads the published version for an enrollment whose own version is back in review, and progress follows the restored session ids (`test_facility_backup_keeps_customers_enrollments_and_progress`).
