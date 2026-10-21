# SEDENS Phase 4 — implementation design

Written before any Phase 4 code (brief, Part 1). It names the routes, tables, interfaces and
modules Phase 4 adds or changes, and the decisions behind them. The finished state is recorded in
`docs/SEDENS_PHASE_4_REPORT.md`; where the two differ, the report explains why.

## 0. Starting point (verified 2026-10-20)

- Branch `claude/sedens-ai-private-room-v1`, clean, in sync with origin at `5851505`.
- Phase 3 suites green on `787cd20`: Python 3,256 passed / 1 skipped, frontend 597, build OK, room
  journey browser tests A–D + Korean + phone, Phase 1 room and Phase 2 marketplace browser tests.
- Limitations carried from Phase 3: the side-view convention is suspected inverted
  (`SEDENS_VISION_IMPROVEMENT_PLAN.md`), forward head is withheld from customers, the 2.7° shoulder
  threshold is provisional, the anatomy viewer redraws slowly under software WebGL, the Passport
  page is a placeholder card, no customer route exposes visits outside the room, staff can set
  customer passwords.
- Five read-only surveys were run before this design (Haiku inventory; Sonnet Passport data,
  auth/usage, anatomy performance, media; Opus camera geometry). Their findings are cited below
  as facts only where they were checked in code.

Principle: reuse what works. New code reads the records Phase 3 already writes
(`s_room_sessions`, `s_workouts`, `s_workout_steps`, `s_session_feedback`, `s_room_scans`,
`s_room_scan_observations`, `s_enrollments`, `s_entitlements`, `s_course_progress`,
`p_training_sessions`, `p_session_exercise_events`, `s_consents`). No Phase 1–3 system is rewritten.

## 1. Camera integrity (Part 2)

**Finding (measured, Opus survey).** `pilates/alignment.py:334` labels a profile by the direction
the body faces: `view = SIDE_RIGHT if lead < 0 else SIDE_LEFT`. A person facing image-left shows the
camera their *left* side, so the label is inverted. On the repository's own demo panels, RTMO's
anatomical ear labels confirm it (facing image-right: left-ear score 0.001, right-ear 0.991; the
code calls it `side_left`). With an inferred view, `forward_head` reads the hidden ear and is always
unavailable; with a declared view (the SEDENS and intake path) the signs of `forward_head`,
`trunk_lean_sagittal` and the `sagittal_*_offset` metrics are inverted. Frontal metrics are unaffected.

**Change.**
- `alignment.py`: facing sign φ = sign(x_nose − x_shoulder_mid), falling back to the higher-scoring
  ear; φ = +1 → `side_right` (right side nearest the camera), φ = −1 → `side_left`. Sagittal values
  become anatomical: `forward_head = φ·(x_ear − x_shoulder)/torso_span` (anterior positive),
  `trunk_lean_sagittal = φ·atan2(...)`, `sagittal_X_offset = φ·(x_X − x_ankle_mean)/span`. A declared
  view that disagrees with the visible near-side ear is reported, not silently trusted.
- New measurement version: `assessment.VERSION` `"2.0-evidence"` → `"2.1-sagittal-anatomical"`,
  plus a `conventions` block in the report (`side_view: "near_side"`, `sagittal_sign: "anterior_positive"`).
- Stored values are never rewritten. `s_room_scans.measurement_version` and the stored analysis
  JSON keep `2.0-evidence`; readers keep rendering them. A 2.0 scan is not comparable with a 2.1 scan
  (§4). Workspace comparison (`web/src/comparison.js`, `progress-selection.js`) gains the same
  version gate.
- Demo data: the seeded side-view skeleton (`pilates/platform/seed.py`) is corrected, `alignment.py`
  is added to `demo_scenarios.source_digest()`, and the precomputed demo is rebuilt.
- Customer statements do not change: SEDENS still shows only the shoulder line, still behind the
  provisional, experimental 2.7° threshold; `forward_head` stays withheld
  (`side_view_convention_under_review` becomes `awaiting_repeatability_evidence`).
- Tests: labelled fixtures (the demo four-view panels with their known facing direction, synthetic
  skeletons), horizontal mirror, camera roll sweep, sign tests for every sagittal metric,
  legacy-version readability and non-comparability.
- Deliverable: `docs/SEDENS_CAMERA_INTEGRITY_REPORT.md`. No participants, no accuracy figures.

## 2. Data marking: demo history versus real activity (Parts 12, 13, 15)

Today a demo is marked only at the organization (`p_organizations.demo`) and a few side columns.
Phase 4 needs to tell *seeded fictional history* apart from *activity actually performed* — even
inside a demo organization, because the facility usage meter must count only the latter.

Migration **`0019_passport.sql`**:

```sql
ALTER TABLE s_room_sessions ADD COLUMN origin TEXT NOT NULL DEFAULT 'room' CHECK(origin IN ('room','demo_seed'));
ALTER TABLE s_workouts      ADD COLUMN origin TEXT NOT NULL DEFAULT 'room' CHECK(origin IN ('room','demo_seed'));
ALTER TABLE s_room_scans    ADD COLUMN origin TEXT NOT NULL DEFAULT 'room' CHECK(origin IN ('room','demo_seed'));

CREATE TABLE s_passport_preferences(          -- one row per customer, written only by that customer
  user_id TEXT PRIMARY KEY REFERENCES p_users ON DELETE CASCADE,
  org_id TEXT NOT NULL REFERENCES p_organizations ON DELETE CASCADE,
  exercise_style TEXT CHECK(exercise_style IN ('pilates','mobility','core','mixed')),
  intensity TEXT CHECK(intensity IN ('light','moderate')),
  music TEXT CHECK(music IN ('off','calm','focus','energy')),   -- the room's built-in modes (room-music.js)
  language TEXT CHECK(language IN ('ko','en')),
  updated_at TEXT NOT NULL);

CREATE TABLE s_data_requests(                 -- customer requests the facility must decide
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES p_organizations ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES p_users ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('erase_passport')),
  state TEXT NOT NULL CHECK(state IN ('received','completed','declined','withdrawn')),
  detail TEXT NOT NULL DEFAULT '{}', requested_at TEXT NOT NULL,
  decided_at TEXT, decided_by TEXT REFERENCES p_users ON DELETE SET NULL, note TEXT NOT NULL DEFAULT '');
```

Every row written by the room flow keeps the default `origin='room'`; only the demo persona seed
writes `demo_seed`. The new tables get `backup.py` policies. Nothing else in the room flow changes.

## 3. Fitness Passport (Parts 3, 5, 6, 8, 12)

**Who may read it.** Only the signed-in customer, about themself: `actor.role == "student"`, scoped by
`actor.user_id` **and** `actor.org_id` on every query (`p_users.id == p_students.id`; the student row
must belong to `actor.org_id`). No route takes a customer id. Staff, creators and reviewers get 403
(`passport_customer_only`); the coaching workspace keeps its own, unchanged access. A room screen's
device token is not a Passport credential.

**Module.** `pilates/sedens/passport.py` grows from three read functions into the Passport read
model (still read-only over existing records), plus two small writers:
`pilates/sedens/passport_privacy.py` (preferences, photo deletion, data requests, export).
Scan comparability lives in a new `pilates/sedens/scan_history.py`, which `scans._previous` also uses.

**Routes** (all under `/sedens/`, customer-only, JSON; `Cache-Control: no-store`):

| Method | Route | Returns / does |
|---|---|---|
| GET | `passport/overview` | latest workout, completed visits, total active minutes, current program, next eligible course session (pinned version), last 3 activities, exercise categories completed, scan availability, last reported effort, course progress, `demo` banner state |
| GET | `passport/history?before=&limit=` | chronological cards, newest first: room workouts (`s_workouts` with `started_at`), plus coach-recorded studio sessions (`p_training_sessions` not linked to a workout) |
| GET | `passport/workout?id=` | one workout: date, facility, room, program/course + version, duration, completed and skipped steps, effort, status, the visit's scan (if any) |
| GET | `passport/scans` | scans with customer-safe summaries, measurement + rules version, reliability, and comparability with the previous scan |
| GET | `passport/scans/compare?earlier=&later=` | a comparison or a refusal with reasons (§4) |
| GET | `passport/programs` | every enrollment: cover, creator, verification state, origin (facility-included / facility-free / marketplace free / demo purchase, from `s_entitlements.source`), weeks × sessions, pinned version, done, remaining, last completed, next session, completed-session history |
| GET | `passport/achievements` | factual milestones only (§3.2) |
| GET / POST | `passport/preferences` | read / save `s_passport_preferences` |
| GET | `passport/privacy` | consent state (reuses `consent.current`), plain explanation of what is stored, retained-photo count, open requests, deployment notice (demo data may disappear) |
| POST | `passport/privacy/photos/delete` | deletes this customer's retained scan photos now (files and `image_key`), sets `images_retained=0`; measurements stay |
| POST | `passport/privacy/request` | records an `erase_passport` request for the facility; nothing is deleted automatically |
| POST | `passport/privacy/request/withdraw` | withdraws an open request |
| GET | `passport/export` | the customer's own data as JSON (`Content-Disposition: attachment`) |

Withdrawing optional image retention reuses the existing `POST consents` (channel `passport`).

### 3.1 Definitions (no invented metrics)

- **Completed visit**: an `s_room_sessions` row of the customer with at least one workout in state
  `completed` in which at least one step was completed. A workout where every step was skipped keeps its
  card but is not a completed visit and earns no first-workout or visit milestone.
- **Workout card status**: `completed`, `stopped early` (`stopped`, including safety stops), or
  `not finished` (`abandoned` after it started). Drafts (`ready`, end reason `replaced`) never appear.
- **Exercise time**: the sum of `s_workouts.active_seconds` (pauses excluded), shown in minutes.
- **Exercises completed / skipped**: `s_workout_steps.state` — a skipped step is never counted
  as performed.
- **Effort**: `s_session_feedback.effort` (0–10, self-reported), shown as "You rated it n/10".
  Discomfort answers are shown only on the customer's own workout detail, never in aggregates.
- **Consistency**: weeks with at least one completed visit, out of the last 8 weeks.
- **Categories**: `categories` of completed SEDENS Standard exercises (`exercises.v1.json`).
- Not shown anywhere: calories, muscle activation, strength, injury prevention, posture or
  health scores, fitness age.

### 3.2 Achievements

First completed room workout; 5 / 10 / 25 completed visits; first course session; course completed;
4 weeks in a row with a visit. Each states its fact and date. No scan-based or effort-based awards.

### 3.3 Courses in Passport (Part 6)

Uses `access.enrollment`, `access.effective_version` and `passport.next_session` (already pinned to
the enrolled version). Entitlement status is read from `s_entitlements` (`revoked_at IS NULL`),
never from a catalogue card. The Passport links only to the room for playback; `access.media_access`
and the room routes keep refusing playback outside an authorized room session (server-side,
unchanged, re-tested).

### 3.4 Privacy and export (Part 8)

- Export contains: account basics, own consent history, room visits, workouts with steps and
  feedback, scan summaries and measurements (with versions), enrollments, progress, demo purchases,
  preferences. It excludes other people's data, facility staff notes, and photo files (listed as
  "photos kept: n — downloading photos is not supported yet").
- Erasure: Phase 4 records the request; the facility decides. Attendance and purchase records are
  not deleted without a defined retention policy; the page says so before the customer submits.
- In `demo_free` mode, every Passport page says that this free demo may lose its data on restart.

## 4. Scan comparability (Part 4)

`scan_history.comparable(a, b) -> (bool, reasons)`; two scans are comparable only if all hold:

| Rule | Reason code when it fails |
|---|---|
| same customer and organization | `different_customer` |
| both `complete`, reliability `clear` | `low_quality` |
| same source class (demo never with real; seeded with seeded) | `demo_vs_real` |
| same `protocol` | `different_protocol` |
| same `measurement_version` (no compatibility table yet) | `different_measurement_version` |
| same `model` | `different_model` |
| same `feedback_rules_version` | `different_rules_version` |
| the observation was evaluated (not withheld) in both | `observation_withheld` |

`scans._previous` adopts the same predicate (adds the measurement-version and model checks).
A comparison shows: earlier date, recent date, what was measured (shoulder-line tilt in the front and
back photos), both values and the difference, capture limitations, and the versions. It never labels a
smaller value as better, never calls a change an improvement, and states that the measurement's
repeatability has not been established. With no comparable pair: "There isn't enough comparable
information yet." plus the plain-language reason.

## 5. Facility usage and fee simulation (Part 13)

Migration **`0020_usage_pricing.sql`**:

```sql
CREATE TABLE s_usage_price_plans(
  id TEXT PRIMARY KEY, label TEXT NOT NULL, currency TEXT NOT NULL CHECK(currency IN ('KRW')),
  room_month_minor INTEGER NOT NULL CHECK(room_month_minor >= 0),
  per_session_minor INTEGER NOT NULL CHECK(per_session_minor >= 0),
  vat_included INTEGER NOT NULL DEFAULT 0 CHECK(vat_included IN (0,1)),
  billable_unit TEXT NOT NULL CHECK(billable_unit IN ('visit_with_completed_workout')),
  created_at TEXT NOT NULL);
CREATE TABLE s_org_usage_plans(
  org_id TEXT PRIMARY KEY REFERENCES p_organizations ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES s_usage_price_plans, assigned_by TEXT REFERENCES p_users ON DELETE SET NULL,
  assigned_at TEXT NOT NULL);
INSERT INTO s_usage_price_plans VALUES ('proposal-2026-10','Proposed B2B pricing (October 2026)','KRW',
  99000,250,0,'visit_with_completed_workout','2026-10-20T00:00:00Z');
```

The default plan is data, not code; a SEDENS administrator can assign another plan to an organization
(`POST admin/usage-plan`). Module `pilates/sedens/usage.py`; route `GET facility/usage?month=YYYY-MM`
(facility administrator of that organization only).

**Billable session** (precise): one `s_room_sessions` row of the organization, `origin='room'`, whose
`started_at` falls in the month (facility timezone, `s_org_profiles.timezone`), containing at least one
`s_workouts` row with `state='completed'`, `end_reason='completed'`, `origin='room'` and at least one
`s_workout_steps` row in state `completed` (the same rule as a completed visit, §3.1). It counts once per
room session, however many workouts were completed in it. Therefore:
- abandoned or stopped-only visits are not billable, nor is a workout whose every step was skipped;
- a retry or a repeated completion request cannot add a session (one state transition per workout,
  one count per room session);
- a second workout in the same visit does not add a second session;
- seeded demo history (`origin='demo_seed'`) is never counted;
- `s_events` (product analytics) is never read by the meter.

**Licensed rooms**: distinct `room_id` of `s_room_devices` that were active at any point in the month.
Demo organizations and simulated devices are shown, but the page states that demonstrations are never
invoiced. Output: the counts below plus `rooms × room_month + sessions × per_session`, VAT excluded,
labelled "Simulation — not an invoice". No payment, invoice or sales figure is produced.

Metrics (aggregates only, no names, no scan images, no discomfort answers): room sessions entered,
completed and incomplete workouts, used minutes, sessions by active-time band, SEDENS Standard vs
coach vs professor course workouts (creator type as currently declared — stated on the page),
technical failures (`s_room_scans.state='failed'`), scan retakes (`s_room_scan_views.retakes`),
repeat customers (count of customers with ≥2 visits in the month).

## 6. Customer account security (Part 14)

Facts: customers sign in through the shared platform login (`pilates/platform/repository.py`);
`save_person` lets a coach (assigned students) or admin set a customer's password and email with no
audit and no session revocation; there is no self-service recovery. No phone-digit authentication exists.

Migration **`0021_customer_accounts.sql`**:

```sql
CREATE TABLE s_account_links(                 -- one-time customer setup / reset links
  id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES p_users ON DELETE CASCADE,
  org_id TEXT NOT NULL REFERENCES p_organizations ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK(purpose IN ('setup','reset')),
  issued_by TEXT REFERENCES p_users ON DELETE SET NULL, issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL, used_at TEXT);
CREATE TABLE s_account_events(                -- what the customer sees under "Sign-in activity"
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES p_users ON DELETE CASCADE,
  org_id TEXT NOT NULL REFERENCES p_organizations ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('link_issued','password_set_by_customer','staff_password_refused',
                                    'sessions_revoked')),
  actor_id TEXT REFERENCES p_users ON DELETE SET NULL, at TEXT NOT NULL);
```

Changes:
- `save_person` refuses `password` for student accounts (`customer_sets_password`, 409) and refuses
  email changes on a student account that already has a password. Staff, creator and admin accounts are
  unchanged. The workspace form hides the password field for students and points to the setup link.
- `POST /sedens/facility/people/link` (facility administrator): issues a single-use link
  (32 random bytes, SHA-256 stored, 72 h for setup, 30 min for reset). The page shows it once.
- `POST /sedens/account/password` (no session needed, token in body): the holder chooses a password;
  the link is consumed atomically, every existing session of that user is revoked, events recorded.
- Passport shows the customer their sign-in activity.
- Regression tests: staff cannot set a customer password or email; reused/expired/foreign links fail;
  sessions are revoked; consent cannot be recorded by a staff session for a customer; Passport refuses
  staff; no room entry or login path accepts phone digits; member number alone never enters a room.
- Compatibility risks (documented and tested): coaches can no longer give customers a password;
  existing staff-set passwords keep working until the customer resets; demo sign-in is unaffected.
- Residual risk stated honestly: without a customer-owned channel (verified e-mail or phone), an
  administrator who issues a link could use it. Phase 4 makes that visible (event log, revocation);
  prevention needs a verified channel, proposed in `SEDENS_SECURITY_MODEL.md`.

## 7. Media, narration and anatomy (Parts 9, 10, 11)

**Video sources.** Hierarchy as briefed. Pexels and Pixabay block this environment (HTTP 403; the
Pexels API needs a key); Wikimedia Commons' API is rate-limited from here and has no short
single-exercise floor clips. Phase 4 therefore: (a) investigates one more licensed source whose
licence permits app use, and imports a clip only if a person-level check of frames, licence and
identifiable-person rules passes; (b) otherwise keeps placeholders and lists each missing clip in
`docs/SEDENS_CONTENT_VIDEO_PLAN.md`. A repository-generated test clip (ffmpeg test pattern, labelled
"test media — not an exercise") proves the player plays real MP4 and WebM files; it is never shown as
a demonstration. The import manifest workflow (`data/content_sources.json`) gains a validating command
`python -m pilates.sedens.media_import` that refuses entries without licence, source, checker and hash.

**Narration.** Migration **`0022_media_narration.sql`** adds an `audio` kind (`audio/mpeg`,
`audio/mp4`, `audio/webm`) to `s_media_objects` (a table rebuild that preserves rows and foreign
keys; tested from a populated 0021 database) and `s_course_steps.narration_cues` (JSON list of
`{text_en, text_ko, at_seconds, speak}`) and `narration_audio_media_id`. The creator decides which cue
is spoken and when; cues not marked `speak` appear only as subtitles. Playback order: the creator's
audio, then browser speech synthesis, then subtitles only. Subtitles render as captions synced to the
step clock. The player gains independent voice and music volume, mute, and language selection.
No speech API is bought.

**Anatomy.** The room toolbar distinguishes *Highlight* (structures tinted in the full body) from
*Isolate* (only the selected structure), keeps click-to-select, rotate, skeleton-only, select another
structure and return to the workout, all synchronized with the current step. Room-only performance mode
in `web/src/main.js`, gated on `?room=1` so the professional viewer is untouched: 2 s idle heartbeat
instead of 0.5 s, no drawing while the page is hidden, pixel-ratio cap for small panels, and a preload
of the next step's structures. Before/after numbers (drawn frames per idle second, frames per change,
long tasks) are measured in this container's software WebGL; real GPU hardware stays unverified.

## 8. Demo persona (Part 15)

A new demo layer in `pilates/sedens/demo_history.py` (versioned like `demo_marketplace`), for the demo
customer: six past room visits over six weeks (`origin='demo_seed'`), completed SEDENS Standard,
coach (4-Week Core Foundations, facility-included) and professor (Mobility Foundations, bought through
the existing demo checkout) course sessions with pinned versions, steps with a few skips, effort values
4–6, and two seeded demo scans (`source='demo_precomputed'`, same protocol and versions, both clear)
with a small, unremarkable difference. Every item is labelled "Demo data". No improvement narrative.

Decisions pinned by `tests/test_sedens_demo_history.py`: the seeded scans carry `measurement_version='demo'`
(as the room's own demo scan does; made-up numbers are never attributed to the measurement code); the
audit log keeps the true time of the seed (only enrollment, entitlement and purchase dates are moved);
the customer's free-text feedback note stays empty. Known gap, on purpose: no camera consent, readiness
check or recommendation row is seeded, because seeding a consent would skip the consent step the live
demo is meant to show; a fresh demo therefore shows two stored scans with no consent record, and the
first real visit asks for consent as usual.

## 9. Frontend (Parts 3, 16)

`web/src/sedens/passport.js` (+ `passport.css`, `strings-passport.js` en/ko), routes in `app.js`:
`#/passport`, `#/passport/history`, `#/passport/workout/:id`, `#/passport/scans`,
`#/passport/programs`, `#/passport/achievements`, `#/passport/preferences`, `#/passport/privacy`.
Phone-first single column with a section bar (built as a sticky bar at the top that scrolls sideways, with a fade at
its right edge; seven sections do not fit a bottom bar at 360 px, a recorded deviation); graphite/silver/teal tokens shared with
`sedens.css`; keyboard, screen reader and touch support; no engineering measurements on the overview.
Facility usage: `#/facility/usage` in the facility console. Account setup: `#/account/setup`.

## 10. Tests and stop condition (Parts 18, 19)

New Python suites: `test_sedens_passport.py` (isolation, totals, versions, demo marking, privacy,
export), `test_sedens_passport_integrity.py` (idempotency, abandoned/skipped handling, refresh-safe
saves, transactions), `test_sedens_scan_history.py`, `test_sedens_usage.py`,
`test_sedens_customer_accounts.py`, camera tests, media and narration tests. Frontend unit tests for
Passport rendering and copy parity. Browser: `web/test/sedens-passport.browser.mjs` runs the Part 19
journey (phone Passport → room workout → Passport updated → outside-room denial), repeats it for the
coach and professor courses, and checks the facility usage page.

## 11. Order of work and model assignment

1. Camera integrity — Opus implements (geometry), a second Opus pass reviews.
2. Passport backend (0019) — Sonnet; Opus reviews authorization and privacy.
3. Passport frontend and facility usage (0020) — Sonnet; Opus reviews the billing definition.
4. Customer accounts (0021) — Opus (shared authentication).
5. Media/narration (0022), anatomy room mode, demo persona — Sonnet; Opus reviews the migration.
6. Browser journey, docs, report — Sonnet; final Opus review.

Migrations are numbered in this order so each step's tests run against a contiguous chain.
