# SEDENS security model (Phase 1)

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

**The SEDENS organization's `admin` role is trusted like `sedens_admin`.** The coaching workspace lets any administrator manage every account of their organization (passwords, emails, roles); that is unchanged platform behaviour. So reviewers are `coach` accounts, which cannot manage staff, and the SEDENS `admin` role is given only to SEDENS platform administrators. Inside the SEDENS organization, granting or revoking `creator` and listing staff with their permissions (`GET /sedens/facility/people`) need `sedens_admin`; a plain administrator there gets `not_permitted`. The command-line bootstrap creates the first administrator with `sedens_admin` only.

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

A customer's sign-in alone fails at (2). A paired screen without a room session fails at (3). Administrators and coaches cannot obtain a room code or start a room session with their own sign-in (`customer_required`) and cannot use a customer's session (`account_signed_in`); see §8 for staff who set a customer's password. Outside a room, `GET /sedens/library/preview` returns counts only.

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

Every `/sedens/` POST requires `X-Sedens-Request: 1` and, when the browser sends `Origin`, an origin matching `Host` (the same rule as `/platform/`). In-memory rate limits per visitor address: pairing start 10/min, room entry 20/min, room codes 10/min, demo 10/min, creator registration 5/min, pairing confirmation 20/min, affiliation requests and withdrawals 10/min. Behind a recognised hosting proxy (Render, Hugging Face Spaces) the visitor address is the right-most `X-Forwarded-For` hop (appended by the proxy), so one visitor cannot exhaust a limit for everyone; elsewhere the socket address is used and the header is ignored. Empty buckets are pruned. Error responses carry a stable `code` and never echo credentials.

## 6. Consent and analytics

- `s_consents` is append-only; the latest row per (person, kind) is current. Kinds: `scan_capture`, `scan_image_retention`, `product_analytics`. A decision is accepted only for the current text version, with an explicit true/false. Phase 1 records decisions; enforcement in the scan flow starts in Phase 3.
- `s_events` stays in SQLite. Names come from a fixed list; room screens may send only screen events (`room_screen_viewed`, `exercise_started`, `exercise_skipped`, `anatomy_opened`, `structure_isolated`). Properties are at most 16 flat short values; keys that look personal (`email`, `name`, `note`, `pin`, `answer`, …) are refused. `user_id` is stored only when the person granted `product_analytics`; otherwise only the room session links the event.

## 7. Data lifecycle

`p_audit.actor_id` always names a user of the row's own organization, or nobody. When a SEDENS reviewer or admin acts on another organization, that organization's audit row records the action with no named user (`external_actor: true`), and a second row in the actor's own organization names them. Organization backups therefore keep restoring: a backup carries only its own users, and restore refuses a reference to anyone else (tested: `test_backups_still_restore_after_cross_organization_sedens_actions`).

Every `s_*` foreign key cascades or nulls (never RESTRICT), and every `SET NULL` column is nullable, so platform deletions (users, locations, organizations) proceed exactly as before. Deleting a customer deletes their room sessions, consents and member links. Deleting a location removes its devices; the room-session history rows remain with location/room/device nulled and can never authorize again. Creator profiles cascade with the account.

## 8. Known limitations (Phase 1)

- SEDENS tables are **not** included in organization backup archives or the admin inspector (they enumerate `p_*` tables only). Restoring an archive does not restore SEDENS rows.
- Rate limits are per process and in memory.
- QR scanning uses typed or keyboard-wedge input; camera QR scanning is not built.
- No cross-organization identity: a coach who also coaches members in a second facility still needs a separate account there (the platform allows one organization per email). Affiliations cover content distribution only.
- Room access codes need the customer to sign in on their own phone first; a printed or CRM-issued QR code is the alternative for customers without a phone.
- Room codes trust the platform sign-in on the customer's phone. The coaching workspace lets an administrator (any account in the organization) or a coach (their assigned customers) set a customer's password, and the platform audits that only as a profile save. Staff who did so could sign in as the customer, ask for a room code and record consents in their name. This is pre-existing platform behaviour; customer-set passwords (a reset link instead of a staff-chosen password) are planned with customer accounts.
- Inactivity is measured by room requests. The scan and workout phases must keep a session alive from real activity in the room (for example, the camera seeing a person), never from a background timer.
- Booking rules (`require_booking`, early-entry grace) apply only to a provider that can see bookings (`checks_bookings`: today the demonstration CRM). A facility without a CRM cannot switch them on (`booking_rules_need_crm`); its customers assigned to a location may enter that location's rooms at any time. Using the platform's own reservations as a booking source would be a future adapter.
- The Phase 1 room library is the platform's existing exercise catalog, which the coaching workspace and its public demonstration already show. The room gate protects SEDENS room routes, not the catalog text.
- A fully seeded demonstration organization cannot be deleted as a whole because of pre-existing platform `ON DELETE RESTRICT` program links. This predates SEDENS and is unchanged.
