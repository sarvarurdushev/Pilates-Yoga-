# SEDENS security model (Phases 1–4)

Scope: what is enforced on the server in Phase 1, how, and what is not built yet. Everything here is checked in `pilates/sedens/*` and tested in `tests/test_sedens_*.py`. The page never decides access; it only shows what the server returned.

## 1. Two layers of permission

| Layer | Where | Decides | Unchanged? |
|---|---|---|---|
| Platform roles: `admin`, `coach`, `student` | `p_roles`, `pilates/platform/repository.py` | Who may see which **customer records** (clients, visits, analyses, notes, media, scans, reservations) inside one organization | Yes. The `p_roles` CHECK constraint, `Actor`, `_scope()`, `assert_student()` are untouched |
| SEDENS capabilities: `creator`, `sedens_reviewer`, `sedens_admin` | `s_capabilities`, `pilates/sedens/capabilities.py` | Additional SEDENS powers: authoring content, reviewing creators, administering SEDENS | New |

A capability never replaces or widens a role check. It is effective only when **all** of these hold, re-checked on every request:

1. the grant row is unrevoked;
2. the account is active and still holds an eligible role (`creator` needs `coach` or `admin`; `sedens_reviewer` needs `coach`; `sedens_admin` needs `admin`);
3. for `sedens_reviewer` / `sedens_admin`, the account belongs to the organization whose `s_org_profiles.kind = 'sedens'` (a row written directly for a gym administrator is ignored);
4. the **current session role** is one the capability may act under (a coach who is also a student, signed in as student, has no creator powers).

A self-declared creator type (`coach`, `professor`, `expert`) is descriptive metadata on `s_creator_profiles`. It grants nothing. `verification_state` can only be changed to `verified` / `rejected` / `suspended` by a `sedens_reviewer`; creators may only ask for review (`pending`), and only a `pending` profile can be verified. A reviewer can never decide their own profile (`self_review`). Editing any reviewed field (name, type, biography, institution, qualifications, specialties) of a `verified` or `pending` profile resets it to `unverified` and clears the reviewer and date, so a verification always describes the profile as it was reviewed. Each profile carries a `version` (a fingerprint of the reviewed fields); `verified` is accepted only with the version the reviewer was shown, inside one `BEGIN IMMEDIATE` transaction, so a profile edited (and re-submitted) while the reviewer was reading it is refused (`profile_changed`). Customer-visible profiles carry `self_declared: true` until verified.

### Who can grant what

| Capability | Granted by | Eligible holder |
|---|---|---|
| `creator` | the holder's own organization administrator; a SEDENS admin; automatically on creating a creator studio | active `coach` or `admin`; never a student |
| `sedens_reviewer` | a SEDENS admin | `coach` account of the SEDENS organization |
| `sedens_admin` | the command line, or another SEDENS admin | `admin` of the SEDENS organization |

Demonstration and real organizations never grant into each other. Every grant and revocation writes `p_audit` (`sedens:capability:grant|revoke`).

**The SEDENS organization's `admin` role is trusted like `sedens_admin`.** The coaching workspace lets any administrator manage every account of their organization (passwords, emails, roles); that is unchanged platform behaviour, except that since Phase 4 customers' passwords and signed-up customers' emails are no longer set by staff (§11). So reviewers are `coach` accounts, which cannot manage staff, and the SEDENS `admin` role is given only to SEDENS platform administrators. Inside the SEDENS organization, granting or revoking `creator` and listing staff with their permissions (`GET /sedens/facility/people`) need `sedens_admin`; a plain administrator there gets `not_permitted`. The command-line bootstrap creates the first administrator with `sedens_admin` only.

## 2. Organizations

`s_org_profiles.kind` is `facility`, `creator_studio` or `sedens`. An organization with no row is a facility, so every pre-SEDENS organization keeps working unchanged.

- **Facility coach as creator:** keeps their existing account; gains `creator` + an `s_creator_profiles` row. No duplicate account is created.
- **Independent professor/expert:** `POST /sedens/auth/register-creator` creates a dedicated `creator_studio` organization (one admin, no members, no rooms) through the platform's own `create_org`, in one transaction.
- **SEDENS organization:** created only from the command line (`onboarding.bootstrap_sedens_org`).

## 3. Content distribution is not customer-data access

`s_creator_facility_affiliations` has one possible `scope`: `content_distribution` (enforced by a CHECK constraint). An approved affiliation lets a creator offer content to that facility's members in a later phase. It never:

- creates a `p_users`, `p_roles`, `p_coach_students` or `p_coach_locations` row in that facility;
- changes `Actor.org_id`, so every platform repository read stays scoped to the creator's own organization;
- exposes the facility's members, visits, analyses, notes, media or reservations through any `/sedens/` route.

Facility administrators see only the creator's public profile fields (display name, type, biography, institution, qualifications, specialties, verification state). Creators see only the facility's public display name. Only the target facility's administrator can approve or decline; either side can revoke. A facility's "no" stands: after a decline, or a revocation by the facility, the same creator cannot ask that facility again for 30 days (`recently_declined`); a creator who withdraws their own request may ask again. Requests and withdrawals are written only to the requesting creator's own organization audit log, never into the target facility's, and are rate-limited (10 per minute per visitor). Demonstration facilities take no affiliation requests (`demo_affiliation`): a demonstration organization's id contains its demonstration key, so the console does not show it as a "facility code". A creator who sells or distributes a course to Gym B gains nothing in Gym B's customer data (tested: `test_affiliation_never_opens_facility_b_customer_data`, `test_affiliation_round_trip_over_http`).

## 4. Room-only authorization

`pilates/sedens/rooms.authorize()` is the single gate for every room-only route (`/sedens/room/session`, `room/end`, `room/library`, `room/event`, `room/consents`, `room/consent`). It requires all four, in this order:

| # | Requirement | Failure code |
|---|---|---|
| 2 | An **active, paired room device**: the `sedens_device` cookie hashes to an `s_room_devices` row with `status='active'`, whose room belongs to its location and whose location belongs to its facility (`kind='facility'`). Simulated devices are honoured only in demonstration organizations. | `device_not_paired` (403) |
| 3 | An **active, unexpired, recently used room session**: the `sedens_room` cookie hashes to an `s_room_sessions` row in state `active` with `expires_at` in the future and a room request within the last `SEDENS_ROOM_IDLE_MINUTES` (default 15, clamped 5–60; `last_activity_at`). An expired or idle session is marked `expired` (`end_reason` `expired` / `idle`) and never revives. | `room_session_required` / `room_session_ended` / `room_session_expired` / `room_session_idle` (401) |
| 4 | **Matching scope**: the session's device, room, location and organization equal the device's. | `room_scope_mismatch` (403) |
| 1 | An **authenticated customer**: the session's customer was authenticated at entry (room access code or authenticating CRM credential) and is still an active user with the `student` role in that organization. For facilities without a CRM, the customer must also still be assigned to the room's location (otherwise the session is ended as `location_unassigned`). If any account is signed in on the screen, even the customer's own, the request is refused: such a sign-in would outlive the room session. | `customer_not_active`, `not_assigned_to_location`, `account_signed_in` |

A customer's sign-in alone fails at (2). A paired screen without a room session fails at (3). Administrators and coaches cannot obtain a room code or start a room session with their own sign-in (`customer_required`) and cannot use a customer's session (`account_signed_in`); see §11 for how customers' passwords are set since Phase 4. Outside a room, `GET /sedens/library/preview` returns counts only.

### Opening a room session (`POST /sedens/room/enter`)

Requires the paired device. The customer is identified by either:

- `access_code`: **customers never sign in on the shared screen.** Signed in on their own phone, a customer asks for a room code (`POST /sedens/access-code`, role `student` only). The code is 8 characters, valid for 5 minutes, single use, bound to the customer and their facility, and stored only as a hash; asking again cancels the previous code. Typing it on the paired screen identifies the customer; the facility's CRM adapter (or, without a CRM, the location assignment) still decides membership and booking. Room codes are refused on a paired room screen (`room_screen`). Because no account sign-in is allowed on the screen, ending a room session leaves nothing the next person could use; a session left without pressing End closes after `SEDENS_ROOM_IDLE_MINUTES` without a room request, and the screen itself ends it after the same time without a touch. (An earlier draft let a customer sign in on the screen itself; the review showed that left a 7-day sign-in on a shared screen, so that method was removed before release.)
- `qr`, `reservation`, `member_id`: a credential checked by the facility's CRM adapter (`docs/SEDENS_CRM_ADAPTER.md`). The adapter must declare the credential **authenticating**; a bare member number is not (the demo requires member number + PIN). The adapter's member reference is mapped to a platform student only through `s_crm_member_links` in the same organization.

Then: the decision must allow entry; its facility/location/room must match the device; a code from another facility is refused (`wrong_facility`); any account signed in on the screen blocks entry: staff (`staff_signed_in`) or a customer, including the one entering (`account_signed_in`). The room screen shows such an account and offers to sign it out. One active session per screen and per customer (older ones end as `superseded`). Session length is `SEDENS_ROOM_SESSION_MINUTES` (default 120, clamped 15–240) and never more than the booking's end + 30 minutes.

### Pairing a screen

1. The unpaired screen calls `POST /sedens/room/pairing/start` and receives an 8-character code to display (31-symbol alphabet, about 8.5×10^11 codes, valid 10 minutes). The server also sets an HttpOnly `sedens_pairing` cookie holding a random secret, scoped to `/sedens/room/pairing`.
2. The facility administrator, signed in elsewhere, enters the code and chooses one of their rooms (`POST /sedens/facility/devices/confirm`). Only an `admin` of the facility owning that room can confirm; demonstration organizations can never confirm a pairing (`demo_cannot_pair`); a code confirms once, and confirmations are serialized (`BEGIN IMMEDIATE` plus a conditional update) so two administrators racing for one code cannot both succeed.
3. The screen polls `GET /sedens/room/pairing/status`. Only the browser holding the pairing secret receives the device token (cookie `sedens_device`, 180 days), once, within 30 minutes of confirmation.

Knowing the code alone yields nothing; confirming alone hands the token to nobody else. Revoking a device (`POST /sedens/facility/devices/revoke`) clears its token and ends its active sessions (`revoked`).

Residual risk, accepted for Phase 1: a pairing code is not bound to a facility until it is confirmed. An administrator of another real facility who can physically read the code from the screen during its 10-minute window could confirm it first. The screen then shows that other facility's name and room after pairing, the intended administrator's confirmation fails, and pairing is simply restarted. A facility-bound setup token can close this in a later phase.

### Demonstration rooms

`POST /sedens/demo/room-device` creates a **simulated** device in a `demo-<key>` organization only (`ensure_demo_device` refuses real facilities; a simulated row written into a real facility is ignored by `device_for_token`). Simulated devices, CRM decisions and sessions are labelled `simulated` in every response and on screen, and every analytics event of a demonstration organization is stored with `demo=1`. At most five active simulated screens per demo room. When `SEDENS_DEMO=0` on a local room: demonstration routes return 404, every `/sedens/` route refuses demonstration accounts (`demo_disabled`, even though the legacy platform can still issue them), and devices of demonstration organizations stop authorizing.

## 5. Cookies, tokens and request rules

| Cookie | Path | Lifetime | Contents |
|---|---|---|---|
| `motion_session` (platform, unchanged) | `/` | 7 days | platform session token |
| `sedens_device` | `/sedens/` | 180 days | room device token |
| `sedens_room` | `/sedens/` | session length | room session token |
| `sedens_pairing` | `/sedens/room/pairing` | 10 minutes | pairing secret |

Room access codes are never cookies: they are typed by the customer and stored only as hashes in `s_room_access_codes`.

All are `HttpOnly; SameSite=Strict`, plus `Secure` over HTTPS. Tokens are 32 random bytes (`secrets.token_urlsafe`); only SHA-256 hashes are stored. Expired or ended room sessions clear the `sedens_room` cookie in the response.

Every `/sedens/` POST requires `X-Sedens-Request: 1` and, when the browser sends `Origin`, an origin matching `Host` (the same rule as `/platform/`). In-memory rate limits per visitor address: pairing start 10/min, room entry 20/min, room codes 10/min, demo 10/min, creator registration 5/min, pairing confirmation 20/min, affiliation requests and withdrawals 10/min, course file uploads and course imports 12/min (Phase 2; at most two received at once on the whole server). Since Phase 4: choosing a password from a sign-in link 15/min (the same as `/platform/auth/login`), creating sign-in links 20/min. Behind a recognised hosting proxy (Render, Hugging Face Spaces) the visitor address is the right-most `X-Forwarded-For` hop (appended by the proxy), so one visitor cannot exhaust a limit for everyone; elsewhere the socket address is used and the header is ignored. Empty buckets are pruned. Error responses carry a stable `code` and never echo credentials.

## 6. Consent and analytics

- `s_consents` is append-only; the latest row per (person, kind) is current. Kinds: `scan_capture`, `scan_image_retention`, `product_analytics`. A decision is accepted only for the current text version, with an explicit true/false. Since Phase 3 the scan flow enforces them: no camera scan starts without a current `scan_capture` decision (`consent_required`), photos are kept only with a current `scan_image_retention` decision, and a decision made on an older text version is asked again (texts `2026-10-v2`).
- `s_events` stays in SQLite. Names come from a fixed list; room screens may send only screen events (`room_screen_viewed`, `scan_result_viewed`, `exercise_started`, `exercise_skipped`, `anatomy_opened`, `structure_isolated`, `narration_toggled`, `music_changed`), stored with `source='client'`; they never change any state, and what happened in the room is read only from server events. Properties are at most 16 flat short values; keys that look personal (`email`, `name`, `note`, `pin`, `answer`, …) are refused, and since Phase 3 text values must be short codes (`^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$`), so no sentence or free text can be stored. `user_id` is stored only when the person granted `product_analytics`; otherwise only the room session links the event.

## 7. Data lifecycle

Organization backups carry every SEDENS table under an explicit policy: no live credentials, no other organization's people, and decisions made outside the organization (another organization's consent, SEDENS verifications) re-checked against this server rather than taken from the archive. See [SEDENS_BACKUP_RESTORE.md](SEDENS_BACKUP_RESTORE.md).

`p_audit.actor_id` always names a user of the row's own organization, or nobody. When a SEDENS reviewer or admin acts on another organization, that organization's audit row records the action with no named user (`external_actor: true`), and a second row in the actor's own organization names them. Organization backups therefore keep restoring: a backup carries only its own users, and restore refuses a reference to anyone else (tested: `test_backups_still_restore_after_cross_organization_sedens_actions`).

Every `s_*` foreign key cascades or nulls (never RESTRICT), and every `SET NULL` column is nullable, so platform deletions (users, locations, organizations) proceed exactly as before. Deleting a customer deletes their room sessions, consents and member links. Deleting a location removes its devices; the room-session history rows remain with location/room/device nulled and can never authorize again. Creator profiles cascade with the account.

## 8. Known limitations (Phase 1)

- The admin inspector (`/platform/inspect`) still lists platform tables only. Organization archives carry SEDENS tables since Phase 1.5 (see [SEDENS_BACKUP_RESTORE.md](SEDENS_BACKUP_RESTORE.md)); restored room screens must be paired again, verifications return to the review queue, and affiliations are re-linked only while this server's record still agrees.
- Rate limits are per process and in memory.
- QR scanning uses typed or keyboard-wedge input; camera QR scanning is not built.
- No cross-organization identity: a coach who also coaches members in a second facility still needs a separate account there (the platform allows one organization per email). Affiliations cover content distribution only.
- Room access codes need the customer to sign in on their own phone first; a printed or CRM-issued QR code is the alternative for customers without a phone.
- Room codes trust the platform sign-in on the customer's phone. Until Phase 4 the coaching workspace let an administrator or a coach (their assigned customers) set a customer's password, so staff could sign in as the customer, ask for a room code and record consents in their name. **Phase 4 closed this:** customers choose their own password from a one-time link and staff can no longer set it or change a signed-up customer's email. What remains (an administrator who creates a link could use it; passwords set before Phase 4) is in section 11.
- Inactivity is measured by room requests. Phase 3 keeps this rule: a room request made because the workout advanced (a step finished, by a tap or by automatic next) counts as activity, but no background timer does. After three automatic advances with no touch at all the player pauses and asks whether the customer is still there; a paused workout then idles out after `SEDENS_ROOM_IDLE_MINUTES` like any screen (`docs/SEDENS_SESSION_PLAYER.md`).
- Booking rules (`require_booking`, early-entry grace) apply only to a provider that can see bookings (`checks_bookings`: today the demonstration CRM). A facility without a CRM cannot switch them on (`booking_rules_need_crm`); its customers assigned to a location may enter that location's rooms at any time. Using the platform's own reservations as a booking source would be a future adapter.
- The Phase 1 room library is the platform's existing exercise catalog, which the coaching workspace and its public demonstration already show. The room gate protects SEDENS room routes, not the catalog text.
- A fully seeded demonstration organization cannot be deleted as a whole because of pre-existing platform `ON DELETE RESTRICT` program links. This predates SEDENS and is unchanged.

## 9. Phase 2: courses, files and the marketplace

The full rules are in [SEDENS_COURSE_ACCESS_MODEL.md](SEDENS_COURSE_ACCESS_MODEL.md) (who may see, enroll, play, download, edit, review), [SEDENS_MEDIA_RIGHTS.md](SEDENS_MEDIA_RIGHTS.md) (files) and [SEDENS_CONTENT_GOVERNANCE.md](SEDENS_CONTENT_GOVERNANCE.md) (review). The security-relevant points:

- **One access module.** Every course decision is a function of `pilates/sedens/access.py`; routes and pages never infer access from a list. Refusals that would reveal a course or file answer 404.
- **Course files have their own layer.** They are stored outside `p_media` and outside `web/`, served only by `GET /sedens/media/file` after `access.media_access`, with `nosniff`, a sandboxing CSP, `Cache-Control: private, no-store` and PDFs as downloads. Platform media routes cannot reach them. Uploads are authorized and their rights validated before the body is read, then checked by their bytes (images re-encoded without metadata, PDFs with active content refused).
- **Content distribution is not data access** (section 3): an affiliation lets a creator offer courses to a facility; it never opens the facility's customers.
- **Creators own their content.** Only the course's own creator edits it, uses its files or exports it; never a colleague, a facility administrator or SEDENS staff.
- **What customers get is what SEDENS approved.** Customers read published snapshots, which a trigger keeps immutable; the access settings and price in force are those of the published version (`access.in_force`); a version is approved only when every file's rights were accepted by a reviewer who is not the file's owner.
- **Guided training plays only in an authorized room**, even when owned (`HOME_PLAYBACK = False`).
- **No real money.** Purchases are simulated and only in demonstrations; no card data exists.
- **Demonstrations are isolated** per visitor key (`util.environment`); a real reviewer never reviews demonstration content and the reverse.

### The twelve attacks of the Phase 2 brief

Each was attempted in `tests/test_sedens_phase2_security.py`; the HTTP and browser journeys repeat the main ones (`tests/test_sedens_course_http.py`, `web/test/sedens-courses.browser.mjs`).

| # | Attack | Result | Test |
|---|---|---|---|
| 1 | A creator reads a facility's members through an affiliation | refused: affiliation grants distribution only | `test_1_affiliation_never_opens_the_facilitys_members` |
| 2 | A creator edits another creator's course | 404 on every edit route | `test_2_a_creator_never_edits_another_creators_course` |
| 3 | A facility enables a course not offered to it | 404 `not_offered`; a coach of the facility gets 403 | `test_3_a_facility_cannot_enable_what_is_not_offered_to_it` |
| 4 | A customer gets a paid entitlement without a purchase | no route grants one; an entitlement without a completed simulated purchase does not count | `test_4_no_paid_entitlement_without_a_purchase` |
| 5 | A customer reads course media of another organization | 404 outside a room that may play it; course files never in `p_media` | `test_5_course_media_never_crosses_organizations` |
| 6 | An unpublished course leaks through search or the catalog | drafts, submitted and suspended versions appear nowhere | `test_6_unpublished_courses_never_leak` |
| 7 | An old published version changes after the creator edits | snapshot immutable; enrolled customers keep theirs | `test_7_a_published_version_never_changes` |
| 8 | An unverified creator appears verified | only `verified` sets the flag; titles are self-declared | `test_8_an_unverified_creator_never_appears_verified` |
| 9 | A file upload bypasses the rights attestation | refused before the body is read | `test_9_no_file_enters_a_course_without_rights` |
| 10 | A demo payment is presented as real money | `real_money` false, DEMO notice, demonstrations only | `test_10_a_demo_payment_is_never_real_money` |
| 11 | A creator exports unrelated media | only the course's own files; a colleague's file cannot even be attached | `test_11_an_export_carries_only_the_course_s_own_files` |
| 12 | A facility administrator changes creator-owned content | refused, even after granting themselves creator tools | `test_12_a_facility_admin_never_changes_a_creators_content` |

### Issues found and fixed during Phase 2

| Issue | Fix | Test |
|---|---|---|
| A colleague in the same organization could attach and read another creator's files | files belong to their creator profile, not only to the organization (`courses._own_media`, `access.media_access`) | `test_11_…`, `test_media_with_rights_is_kept_and_served_only_to_those_allowed` |
| A course version could be approved while its files' rights were unreviewed, and those files then reached customers | approval refused with `rights_not_reviewed` | `test_a_version_is_approved_only_after_every_file_has_accepted_rights` |
| A creator could widen who sees a published course, or change its price, without review | customers follow the approved version's settings (`access.in_force`) | `test_access_and_price_changes_wait_for_the_next_approved_version` |
| A reviewer could approve the rights of their own file | refused with `self_review` | `test_a_reviewer_never_decides_the_rights_of_their_own_file` |
| A course import accepted 400 MB on the free host outside the upload slots | capped by mode (60 MB on the free host), sent and unpacked, and takes an upload slot | `test_course_imports_follow_the_deployment_mode_and_share_the_upload_slots` |
| A customer enrolled in an older version lost its files in the room | the room's customer's enrolled version counts | `test_a_customer_on_an_older_version_still_sees_its_pictures_in_the_room` |
| Reviewers could not open verification evidence, and the verification queue did not show it | evidence files readable by reviewers of the same environment; evidence listed in the queue | `test_reviewers_can_open_verification_evidence`, `test_reviewer_verifies_over_http` |
| A verified profile edited after review fell to Unverified, leaving the review queue | it returns to Verification requested with the new content | `test_sedens_reviewer_verifies` |

### Known limitations (Phase 2)

- Pausing new sales is immediate and outside review (`s_course_sales`, Phase 2.5); it only ever closes sales, and resuming needs the same approved version and price.
- PDF active-content detection reads uncompressed markers only; every PDF is therefore served as a sandboxed download, never inline.
- Videos are checked by their container header only, not decoded.
- Upload and import limits, like every rate limit, are per process and in memory.
- No refunds, entitlement revocation or enrollment migration routes exist yet.

## 10. Phase 3: the room journey

The flow and its contract are in [SEDENS_ROOM_FLOW.md](SEDENS_ROOM_FLOW.md). The security-relevant points:

- **Authorization is unchanged and comes first.** Every journey route (`GET room/journey`, `POST room/journey/<action>`, `POST room/scan/image`) calls `rooms.authorize` *outside* any transaction (so an expiry or idle end is written and the room cookie cleared), then works inside `sedens.batch()` and re-checks there that the room session is still the active one for this customer (`journey.require_live`), closing the gap between the check and the write.
- **The server owns the state.** `s_room_journeys` holds one state per room session; only transitions in `journey.TRANSITIONS` are applied, with a conditional update on (state, revision); a stale screen gets `409 journey_changed`. The client never supplies a workout, scan, plan, student or organization id that the server trusts: every action reads them from the room session.
- **Gates.** Every scan, plan and workout action requires this visit's readiness check to have ended `ready` (`readiness_required`); the scan requires current capture consent (`consent_required`); a course plays only when `access.can_play_in_room` says so at the start, from the customer's enrolled version (`access.effective_version`), and its media through the existing `media_access` room check.
- **Idempotent writes.** A step is completed or skipped once (conditional update on its state); completing it again, a second tap or a replayed request writes no second Passport event; session feedback is accepted once per workout (`feedback_recorded`); `POST room/course/complete` only confirms a session this visit played to the end (`play_first`).
- **Scan photos.** Uploaded only while that view is on screen and only for a real analysis (never in the demonstration precomputed scan), checked by their bytes (JPEG or PNG, at most 8 MB), stored outside `web/` under the media root (`scans/<org>/<scan>/`, folders `0700`, files `0600`), never served over HTTP, deleted after the analysis (or when a scan is abandoned) unless the customer agreed to keep them, and never in an organization backup.
- **What the room screen receives.** The journey view carries what the screen shows and the ids it must send back (a recommendation id, course and session ids, step positions); no student, organization or analysis ids, image keys, file paths, rule thresholds or internal evaluation records. Advanced scan values carry no confidence values.
- **A safety stop is final for the visit.** "I don't feel well" ends the workout as incomplete; the room does not offer another session in that visit.
- **Backups.** The new tables have explicit policies; restored journeys are ended (`restored`), open scans and workouts are restored as abandoned, and photos are never archived.


### 10.1 Phase 3 attack review (brief §56)

Each attack was tried for real (`tests/test_sedens_phase3_security.py`): 13 over HTTP
against a running server with the cookies a room screen, a customer's phone or a
stranger would hold, and the two about scan results (11, 12) through the server's own
handlers in-process. The browser journey (`web/test/sedens-room-journey.browser.mjs`,
part D) tries six of them again: a phone launch, a course without the purchase, another
facility's room, an ended room session, and a disabled or suspended course. None
succeeded; no server change was needed. The tests stay as regression checks.

| # | Attack | What was tried | Result |
|---|---|---|---|
| 1 | Readiness bypass | every scan, plan, course and workout action straight after entry; a forged `expect`; an answer carrying its own `outcome` | `409 invalid_transition` / `readiness_required`; the verdict is computed by the server only |
| 2 | Consent bypass | `scan/begin` without consent; consent with an out-of-date text version; a photo with no scan running | `409 consent_required`, `409 stale_consent_text`, `409 invalid_transition`; no scan row |
| 3 | Scan without an active room | `scan/begin` and a photo upload from the customer's phone, and from the screen after the visit ended | `403` / `401`; no scan row |
| 4 | Plan without readiness | `plan/request` at entry; a journey pushed to the choice screen in the database; another visit's ready check | `409`, `readiness_required`; no recommendation |
| 5 | Player without entitlement | `course/start` for a paid course the customer has not bought; `workout/start` with nothing prepared | `403 purchase_required`; no enrollment, no workout |
| 6 | Playback after room expiration | a step, the journey and the course picture after the room session's `expires_at` passed | `401`/`403`, picture `404`; the step stays unfinished, no Passport event |
| 7 | Another facility's course | facility B's room starting facility A's course and reading its picture; A's customer entering at B | `403`/`404`; picture `404`; entry refused |
| 8 | Course version substitution | `course/start` with forged `version`/`course_version` and a session only version 2 has | `404 unknown_item`; the enrolled version 1 plays |
| 9 | Duplicate completion | the same step twice; `room/course/complete` three times | one Passport event per step, one progress row, one `workout_completed` |
| 10 | Cross-user Passport write | forged `student_id`, `user_id`, `training_session_id` and `workout_id` on steps and feedback | ignored: rows go to this visit's customer only; the other customer's feedback is unchanged |
| 11 | Scan result for another user | the next customer in the same room after a real scan | nothing of the earlier scan in their view; no comparison with it |
| 12 | Customer technical-data leakage | the scan result view searched for ids, image keys, file paths, model names, thresholds and raw metrics | none present |
| 13 | Raw media URL bypass | the course picture from an anonymous client, the customer's phone, another facility's room and an ended room; guessed scan photo addresses | all `404` (or `405`); only a live, entitled room reads it |
| 14 | Session resume hijack | the room cookie on another paired screen, on a phone, with no device cookie, and replayed after the visit ended | `401`/`403`; the real screen is unaffected |
| 15 | Forged analytics changing state | server-only events (`workout_completed`, `safety_stop`, `exercise_completed`, …) posted by the screen; the screen's own events with positions | `400 server_event`; the screen's events are recorded and change no state |

## 11. Phase 4: customer accounts

Customers, coaches, administrators and creators all sign in through the one shared platform login
(`POST /platform/auth/login`, `Repository.login`, `p_users`/`p_sessions`). Until Phase 4 the only way a
customer got a password was a member of staff typing one into the workspace person form
(`POST /platform/people/save` → `Repository.save_person`), so staff could always sign in as a customer,
open their Passport and record consent in their name. Phase 4 changes who chooses a customer's
password, and nothing else about sign-in. This section records the compatibility analysis made
*before* the change (11.1), what changed (11.2), how it is tested (11.3), and the migration proposal
with the risk that remains (11.4).

### 11.1 Compatibility analysis (written before the change)

**Who calls `save_person` today, and with what.** Found by searching the repository for
`save_person`, `people/save` and `password` (Python, JavaScript, browser tests, tools):

| Caller | Sets a password? | Sets an email? | Effect of Phase 4 |
|---|---|---|---|
| `web/src/platform/forms.js` (workspace "Clients" and "Coaches" form) | Optional "Set password" field for every account | Yes, every save | The field is hidden for customer accounts, with a plain note on how customers get a sign-in link. Coach and administrator forms keep it. A save that still sends a password for a customer is refused (`409 customer_sets_password`). |
| `pilates/platform/http.py` `people/save` | passes the body through | passes through | Error responses now also carry `code` when the refusal has one; `error` is unchanged. |
| `tools/verify_hosted_platform.py` (hosted check) | No (creates a disposable client) | No | None. |
| `tests/test_platform.py::test_real_sessions_and_role_conversion` | No | No (student → coach conversion) | None: the account has no password, so its email is not locked. |
| `tests/test_capture_media_labels.py`, `tests/test_visit_record_links.py`, `tests/test_backup_verify.py`, `tests/test_progress_evidence.py` | No | No | None. |
| `tests/test_sedens_backup.py` (three calls) | No | Yes, on creation | None: a new account has no password, so setting its first email is allowed. |
| `tests/test_sedens_http.py::test_a_reviewer_cannot_take_over_sedens_accounts` | Yes, a coach tries to set an administrator's password | Yes | Still `403` (the role rule runs first and is unchanged). Kept as is. |
| Platform demo seed (`pilates/platform/seed.py`), SEDENS demo layer (`pilates/sedens/demo.py`) | No: demo people are inserted directly, without passwords | — | None. Demonstration customers sign in through `demo_login`, which never checks a password. |
| `Repository.create_org`, SEDENS onboarding (`register_creator_studio`, `bootstrap_sedens_org`) | Yes, the new owner's own password | Yes | None: these never touch customer accounts. |
| Organization restore (`pilates/platform/backup.py`) | Clears every restored password (`password_hash=""`) | — | None. Restored customers now get a setup link instead of a staff-set password; the restore page wording says so. |
| Test fixtures (`tests/sedens_support.py` `add_user`) | No: inserts users without passwords and signs them in with `repo.issue` | — | None. |
| Browser journeys (`web/test/*.browser.mjs`) | Only `/platform/auth/register` (a new owner) | — | None. |

No seed, onboarding step, demonstration or test sets a password or changes the email of an
existing customer account. The older studio system (`accounts`, `auth_sessions`, `pilates/auth.py`,
its recovery codes and `admin_reset`) is a separate table set that SEDENS does not use; it is not touched.

**What changes for each kind of person.**

- *Customers* (accounts holding the `student` role): staff can no longer choose or change their
  password, and cannot change the email of a customer who already has a password. A facility
  administrator creates a one-time sign-in link; the customer opens it and chooses a password
  themselves. Every sign-in they had ends when they do. Their Passport shows "Sign-in activity".
  A customer who already has a staff-set password keeps it and keeps signing in with it until they
  use a reset link (no password is invalidated by the migration).
- *Coaches*: they lose the ability to set a password or change the email of their assigned
  customers who already sign in. Everything else in the person form (name, goal, locations, a new
  customer's first email) is unchanged. They cannot create sign-in links (administrator only).
- *Administrators*: unchanged for staff accounts (coaches and administrators without the `student`
  role): they still set passwords and emails there. For customers they use "Create sign-in link" in
  the SEDENS facility console.
- *Demonstrations*: unchanged. Demonstration customers sign in from the demonstration page without a
  password; sign-in links are not issued in a demonstration (`409 demo_no_password`).

**Which accounts count as a customer's.** The brief names "accounts whose roles are exactly
student". An account holding `student` *and* a staff role is refused too, because the platform lets
an account switch to any role it holds (`POST /platform/auth/switch`): an administrator could otherwise
add `coach` to a customer, set a password, sign in, switch to the customer role and open the Passport.
Staff accounts without the `student` role are unchanged. A person who is both staff and customer gets
their password from a sign-in link like any customer.

**Compatibility risks, and how each is handled.**

1. *A new customer has no way to sign in* (there was no invitation flow). Handled by the setup link
   (72 hours), issued from the SEDENS facility console.
2. *A customer who forgets their password* had only staff to ask. Handled by the reset link (30 minutes);
   a customer-initiated reset needs a verified channel and is proposed in 11.4.
3. *A script or integration that sends `password` for customers* now gets `409 customer_sets_password`
   with a plain message instead of silently succeeding. None exists in this repository.
4. *Saving a claimed customer's profile without an `email` field* used to reset the email to a
   placeholder; for a customer who has a password the email is now kept when the field is absent, and a
   different email is refused (`409 customer_email_locked`).
5. *Existing staff-set passwords stay valid* until the customer resets. They are not revoked by the
   migration, because that would lock every existing customer out at once with no notice. A facility
   that wants to end them issues a reset link per customer (which ends all sessions when used).

### 11.2 What Phase 4 changed

- **`Repository.save_person`** (`pilates/platform/repository.py`) refuses a `password` for any account
  that holds, or is being given, the `student` role: `409`, `code: customer_sets_password`. It refuses a
  different email for an account that holds the `student` role and already has a password: `409`,
  `code: customer_email_locked` (no `email` field keeps the current one). Both checks run inside the save
  transaction; after the rollback the attempt is written to `s_account_events` (`staff_password_refused`,
  `staff_email_refused`, at most one row per person and kind per minute) when the SEDENS tables exist.
  The `save:user` audit row now also records `password_set` and `email_changed`. Everything else in
  `save_person` (role rules, coach scope, the last-administrator rule) is unchanged and runs first.
- **Role changes** (`save_person`, same transaction). When someone else's existing account *gains* the
  `student` role, its password is cleared and every `p_sessions` row of that account is deleted (a session
  can switch to any role its account holds), and `customer_role_added` is recorded: getting back in needs a
  sign-in link, which the customer sees. When someone else's account *loses* the `student` role, its
  customer sessions are deleted (they no longer wait for the role to come back) and
  `customer_role_removed` is recorded. Without this, an administrator could remove the role, set a
  password and email while the account was staff-only, give the role back and sign in as the customer
  with nothing in their activity (found in review). An administrator who changes their own roles keeps
  their own password and session.
- **Account consent** (`GET`/`POST /sedens/consents`) is for customer sessions only (`passport.customer`,
  `403 passport_customer_only` otherwise). Every consent text is a customer's, and a staff session of an
  account that was temporarily staff-only could otherwise record a decision under the customer's id.
  `Refused` takes an optional `code`, which `/platform/` and `/sedens/` error responses include.
- **`GET /platform/me`** people entries carry `has_password` (a boolean, never the hash), so the
  workspace form can explain a locked email.
- **Migration `0021_customer_accounts.sql`**: `s_account_links` and `s_account_events` as in the design,
  with two additions: `s_account_links.superseded_at` (a newer link ends an older unused one; kept apart
  from `used_at` so the history says which happened) and `s_account_events.purpose` (setup or reset, for
  `link_issued`), and one more event kind, `staff_email_refused`, so a refused email change is as visible
  to the customer as a refused password.
- **`pilates/sedens/accounts.py`, `accounts_http.py`** (routes):
  - `GET /sedens/facility/customers`: a facility administrator's customers, whether each can sign in,
    and the expiry of any open link (never the link).
  - `POST /sedens/facility/people/link {user_id, purpose}`: administrator of a `facility` organization
    only (`admin_required`, `facility_required`); the user must be an active customer of that same
    organization (`customer_not_found` otherwise, so other organizations' ids are not confirmed);
    `setup` only while the customer has no password (`already_set_up`); refused in a demonstration
    (`demo_no_password`). 32 random bytes (`secrets.token_urlsafe(32)`), only the SHA-256 stored; setup
    72 hours, reset 30 minutes; older unused links of that customer are superseded; `link_issued`
    recorded; the link `/#/account/setup?token=...` is returned once. Rate limit 20 per minute per address.
  - `POST /sedens/account/password {token, password}`: no session; the token is in the body only (the
    page reads it from the part of the address after `#`, which browsers never send, and removes it from
    the address bar). The platform's own rules and hash (`password_hash`: 10 to 1024 characters, PBKDF2
    600 000) are checked first, so a rule error says nothing about the link. Then, in one `BEGIN
    IMMEDIATE` transaction: the link is found by hash and must be unused, not superseded, unexpired, in a
    non-demonstration organization and for a still-active customer; it is marked used with a conditional
    update; other open links of that customer are superseded; the password is written; **every
    `p_sessions` row of that user is deleted, their unused room access codes are cancelled and their live
    room sessions end** (`revoked`, `password_changed`; room entry never checks `p_sessions`);
    `password_set_by_customer` and `sessions_revoked` are recorded, plus a `p_audit` row. Unknown, used, superseded, expired and malformed links all get the same
    `400 link_not_valid` and message. The response also clears this browser's `motion_session` cookie.
    Rate limit 15 per minute per address, the same as `/platform/auth/login`.
  - `GET /sedens/passport/account-activity`: the customer's own events, newest first (at most 50),
    behind the same `passport.customer` guard as every Passport route (staff get
    `403 passport_customer_only`). Each item says whether the customer or a member of staff (by name)
    did it, except a password chosen through a link (`by: "link"`): whoever held the link chose it, so the
    line says "A new password was chosen with a sign-in link" and asks the customer to get a reset link
    if it was not them, instead of telling them they did it.
- **Backups.** `s_account_links` is never archived (live credentials, like room codes); `s_account_events`
  is per-organization history and is archived; `actor_id` joins the attribution columns that are emptied
  for people outside the archive. Restored passwords are empty (unchanged platform rule), so restored
  customers get a new setup link. Because the exporting administrator is restored as whoever restores, an
  event of the exporter is restored without a name ("Someone at your facility") unless the same person
  restores, so a customer is never told the restorer created a link they did not create.
- **Pages.** The facility console has a "Customer sign-in" panel (create link, shown once with a copy
  button and its expiry). `#/account/setup` lets the link holder choose a password twice, then says they
  are signed out everywhere and asks them to sign in. The workspace person form hides the password field
  whenever the client role is ticked (and for coaches always), explains the link, and shows a locked email
  as read-only. The Passport privacy page shows "Sign-in activity". English and Korean
  (`web/src/sedens/strings-account.js`); the coaching workspace is English-only as before.

### 11.3 Tests

`tests/test_sedens_customer_accounts.py` (27 tests, over HTTP against a running server unless noted):
a coach of an assigned customer and an administrator cannot set a customer's password (repository and
HTTP) and the attempt is shown to the customer; giving a customer a staff role does not open that path;
removing the customer role, setting a password and email while the account is staff-only and giving the
role back leaves no password and no session (the customer's own session ended at the removal, the staff
session cannot switch to the customer role), refuses a consent in between, and shows both role changes
to the customer; a staff member given the customer role loses their staff-set password and sessions,
while an administrator changing their own roles does not;
neither can change a signed-up customer's email, while profile saves keep working; staff password changes
still work and a coach still cannot change a coach's; link issuance is for the customer's own facility
administrator only (coach, customer, other facility's administrator, creator-studio administrator, coach
with the creator permission and signed-out callers refused; staff accounts get no link); the token is 32
random bytes stored only as its hash with the right expiry; single use; unknown, malformed, superseded and
expired links get one identical answer; password rules leave the link usable; demonstration organizations
get no links and a planted demonstration link is unusable, while demonstration sign-in still works; using a
link ends every session of that customer (old cookies get `401`) and no one else's, and also their live
room session and unused room code; activity is visible only to the customer and does not credit the
customer with a link holder's password; the route is rate limited; a staff session cannot read or record
account consent (`403`), with or without a customer's id; the Passport refuses staff; no login or room entry accepts
phone digits (no phone column, login matches email only, `phone` methods unknown, a phone-like room code
refused, a member number alone or with a phone-like PIN refused, the real PIN accepted); platform sign-in is
still throttled per address; backup policies, and a real export and restore (no link hash in the archive,
no links or passwords restored, activity restored without naming the restorer).
`web/test/sedens-account.test.mjs` covers the page copy and
that the token is only ever in a request body; `web/test/sedens-accounts.browser.mjs` is the browser journey.

### 11.4 Migration proposal and the risk that remains

**What is now true.** No member of staff can choose or change the password of an account while it holds
the customer role, and an account that gains the customer role loses any password and session it had, so a
password staff chose while it was staff-only never reaches the customer role. A customer's password is set
only by whoever holds a one-time link that a facility administrator created, and using it ends every
existing session, room session and unused room code, so access obtained earlier with a staff-set password
stops working. Staff sessions cannot read or record account consent. The customer can see every link
created for them and by whom, every password chosen with a link, every refused staff attempt, and every
time their customer role was taken away or given back, and by whom.

**What is not prevented (stated plainly).**

- *An administrator who creates a link could open it themself* and so choose the customer's password.
  Phase 4 makes this visible (the customer's sign-in activity names who created the link; the customer's
  own sessions end, so they notice when they are signed out; `p_audit` records it) but cannot prevent it,
  because the link is handed over by the facility and the server has no channel that only the customer
  controls.
- *Passwords set by staff before Phase 4 stay valid* until the customer uses a reset link. Staff who set
  one still know it. The facility can end them by creating a reset link for each customer.
- *While an administrator has taken the customer role away*, the account is a staff account: they can set
  its password and change its email (the email lock applies only while it holds the customer role), sign in
  with it and act with the staff role under that person's id. That session cannot open the Passport, record
  consent or enter a room, and it ends when the customer role is given back, together with the password.
  The customer sees "turned off customer access" and "turned on customer access" with the administrator's
  name once they sign in again, but an email changed in between stays changed until the facility corrects
  it; getting back in still needs a link, which is listed too. Each step is also in `p_audit`.
- Rate limits are per process and per address (as in section 8); there is no per-account lockout.

**Next steps, and what each needs.** None needs paid infrastructure in Phase 4; each needs something the
free demonstration does not have.

| Step | What it gives | What it needs |
|---|---|---|
| Verified customer e-mail | The link is sent to the customer's own inbox instead of through staff, so an administrator never sees it; a later email change needs a link sent to the old address. | An outgoing mail service (SMTP or a transactional mail provider) with a verified sender domain, bounce handling and per-recipient rate limits. `pilates/mail.py` exists for the older studio system and could be reused. |
| Verified phone (SMS or KakaoTalk message) | The same, for customers who do not use e-mail; common in Korea. The phone number is a delivery channel only: digits of a phone number are never accepted as a credential. | An SMS or KakaoTalk business messaging provider (per-message cost), sender registration, consent for messaging, and storing phone numbers (new personal data with a retention rule). |
| Customer-initiated reset ("Forgot password") | No staff involvement at all for a forgotten password. | One of the two channels above; a generic answer that never confirms whether an account exists. |
| Passkeys (WebAuthn) | Phishing-resistant sign-in with no password to share or reuse. | A stable HTTPS origin (a fixed domain, not a changing free-host address), a credentials table, and a recovery path (one of the channels above). |
| Per-account lockout | Slows a guessing attack spread over many addresses. | Persistent counters per account (a table, or shared storage when there is more than one process), with a lockout that the customer can lift through a verified channel so it cannot be used to lock someone out. |

Until a verified channel exists, the facility's process should be: create the link only when the customer is
present or has asked for it, give it to them directly, and ask the customer to check "Sign-in activity" in
their Passport.
