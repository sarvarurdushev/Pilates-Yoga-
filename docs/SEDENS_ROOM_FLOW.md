# SEDENS AI Private Room: the customer journey

This document describes what happens inside an authorized room session, from the
welcome screen to the Fitness Passport write. It is also the contract between the
server (`pilates/sedens/journey.py` and the modules that plug into it) and the room
screen (`web/room.html`, `web/src/sedens/room*.js`).

Room authorization is unchanged from Phase 1 (`docs/SEDENS_SECURITY_MODEL.md`):
every room request first passes `rooms.authorize`. It checks:
- the paired device;
- the active, unexpired and non-idle room session;
- that device, room, location and facility all match;
- that the customer is active;
- that no account is signed in on the screen.

## 1. The server owns the state

`s_room_sessions.state` stays the authorization lifecycle (`active`, `ended`,
`expired`, `revoked`). What the customer is doing inside an authorized room is a
separate state machine in `s_room_journeys` (migration 0015), with one row per room
session. The screen never decides the state. It asks for a transition, and the
server accepts or refuses it.

| State | Screen | Owner (frontend) |
|---|---|---|
| (none) | entry: room code, demonstration codes | `room.js` |
| `identified` | welcome: first name, room, booking, short Passport summary, courses | `room.js` |
| `readiness` | one readiness question at a time | `room.js` |
| `readiness_blocked` | do not start, or get help now (119); end the visit | `room.js` |
| `scan_intro` | what the scan is, the three consents, scan options, skip | `room-scan.js` |
| `scan_front` `scan_left` `scan_back` `scan_right` | one view: framing guide, countdown, capture, retake | `room-scan.js` |
| `scan_processing` | analysing (real analysis only) | `room-scan.js` |
| `scan_result` | scan quality, what we observed, what it means, comparison, Advanced (collapsed) | `room-scan.js` |
| `session_choice` | continue a course, another course, or a SEDENS Personalized Session | `room.js` |
| `session_setup` | 30 or 60 minutes, goal, effort | `room.js` |
| `recommendation` | the plan, "Why this session", accept or change | `room.js` |
| `ready_to_train` | the workout about to start: steps, minutes, auto-next, sound | `room-player.js` |
| `exercise` / `exercise_paused` | the player | `room-player.js` |
| `session_complete` | summary, effort (0–10), discomfort, Passport saved | `room.js` |
| `ended` | the visit is over; the screen returns to entry | `room.js` |

Allowed transitions are listed in `journey.TRANSITIONS`. Anything else gets
`409 invalid_transition`. A request that names the state the screen believed it was
in (`expect`) gets `409 journey_changed` when another window has moved on; the
screen then shows the current state. A refresh reads the same state back with
`GET /sedens/room/journey`. A workout resumes at its current step and saved
position, never from the beginning.

## 2. Routes

| Route | What it does |
|---|---|
| `GET /sedens/room/journey?lang=ko\|en` | `{journey}`: the current state's view (creates the journey at `identified` on first use) |
| `POST /sedens/room/journey/<action>` | body `{expect, lang, ...}` → `{journey, notice}`; `notice` is `null` or `{code, text, ...}` |
| `POST /sedens/room/journey/end` | ends the visit and the room session, and clears the room cookie (same as `POST room/end`) |
| `POST /sedens/room/scan/image?view=front\|left\|back\|right` | raw JPEG or PNG body (≤ 8 MB), only while that view is on screen and the scan needs photos |
| `POST /sedens/room/consent` | `{kind, granted, text_version}` (Phase 1 consent, `channel=room`) |
| `POST /sedens/room/event` | client analytics, names in `analytics.CLIENT_EVENTS` only; values are short codes |
| `POST /sedens/room/end` | as before; also closes the journey and keeps an open workout as incomplete |

Each POST needs `X-Sedens-Request: 1` (as everywhere in `/sedens/`).

### Actions

| Action | From → to | Body |
|---|---|---|
| `readiness/start` | identified → readiness | |
| `readiness/answer` | readiness → readiness \| scan_intro \| readiness_blocked | `{item, answer: bool}` or, for a follow-up, `{item, follow_up: bool}` |
| `scan/begin` | scan_intro → scan_front | `{source}`: one of `journey.scan_options`; needs current `scan_capture` consent |
| `scan/view` | scan_<v> → next view; after `right` → scan_processing → scan_result (demo: at once) | `{view}`; real scans need the photo uploaded first |
| `scan/retake` | scan_<v> → scan_<v> (or back to an earlier view) | `{view}` |
| `scan/skip` | scan_intro, scan_<v>, scan_processing → session_choice | |
| `scan/again` | scan_result, scan_processing → scan_intro | |
| `scan/continue` | scan_result → session_choice | |
| `plan/personalized` | session_choice → session_setup | |
| `plan/request` | session_setup → recommendation | `{goal, duration: 30\|60, intensity: light\|moderate}`; a `notice` `cannot_fill` keeps the state, `shorter_plan` explains a shorter plan |
| `plan/change` | recommendation → session_setup | |
| `plan/back` | session_setup, recommendation → session_choice | |
| `plan/accept` | recommendation → ready_to_train | `{recommendation: id}` |
| `course/start` | session_choice → ready_to_train | `{course_id, session_id?}` (default: next session of the enrolled version) |
| `workout/start` | ready_to_train → exercise | |
| `workout/step` | exercise → exercise \| session_complete | `{position, outcome: completed\|skipped}`; finishing a step twice changes nothing |
| `workout/previous` | exercise → exercise | |
| `workout/pause` | exercise → exercise_paused | `{position_ms, reason: customer\|anatomy\|presence}` |
| `workout/resume` | exercise_paused → exercise | |
| `workout/variant` | (exercise, exercise_paused) | `{position, variant: standard\|easier\|harder}`; only options listed in the step's `variants` |
| `workout/settings` | (ready_to_train, exercise, exercise_paused) | `{auto_next: bool}` |
| `workout/unwell` | ready_to_train, exercise, exercise_paused → session_complete | `{urgent: true}` or `{urgent: false, category: pain\|dizzy\|unwell\|other}` |
| `workout/end` | ready_to_train, exercise, exercise_paused → session_complete | |
| `workout/cancel` | ready_to_train → session_choice | |
| `workout/feedback` | (session_complete) | `{effort: 0–10\|null, discomfort: "no"\|"yes"\|null, urgent?, regions?, when?, strength?, still?, note?}`, once |
| `workout/another` | session_complete → session_choice (not after a safety stop) | |
| `end` | any → ended | |

## 3. The screen's contract (`ctx`)

`room.js` owns the page, the entry flow, the idle watcher and the journey. It renders
the screens it owns and hands the others a `ctx`:

```js
ctx = {
  journey,          // the latest view from the server (see §4)
  act(name, body),  // POST room/journey/<name> with {expect: journey.state, lang}; resolves {journey, notice}
  upload(view, blob),  // POST room/scan/image?view=
  event(name, props),  // POST room/event (client analytics; codes only, never free text)
  t, lang,          // i18n (web/src/sedens/i18n.js)
  markActivity(),   // a real room activity happened (keeps the idle watcher honest)
  main,             // the <main> element to render into
  session,          // GET room/session: customer.first_name, room, facility (demo flag), simulated
  refresh(),        // GET room/journey again (e.g. while scan_processing); resolves the new journey
  rerender(),       // ask the shell to render the current state again
}
```

- `renderScan(ctx)`, `renderScanResult(ctx)` and `stopScan()` are in `room-scan.js`.
- `mountPlayer(ctx)` is in `room-player.js`. It returns `{update(ctx), destroy()}`.
  The player stays mounted across steps and language changes, so video, sound and
  the anatomy viewer are never re-created by a re-render.

## 4. What the server returns

`journey` always has `state`, `revision`, `path` (`course`, `personalized` or
null), `scan_skipped` and `views`. Then, by state:

- `welcome` (identified):
  - `booking {starts_at, ends_at}` or null;
  - `passport {visits, last_visit, room_sessions_completed}`;
  - `courses [{course_id, title, enrolled, featured, reason, progress {version, next {module_title, module_number, session_title, session_number, session_id, estimated_minutes}, done, total, title}}]`.
- `readiness` (readiness, readiness_blocked):
  - always `{version, total, answered, intro}`;
  - while questions remain, `next {item, position, follow_up, question, why}`;
  - once decided, `outcome` (`ready`, `do_not_start` or `urgent_help`) and `result {title, body, small | emergency | next_action}`.
- `consent` (scan_intro): `texts {kind: {version, text}}` and `current {kind: {granted, current_version, …} | null}`. Also `scan_options`, for example `["demo_precomputed", "experimental_real"]` on the free demonstration host.
- `scan` (scan states):
  - always `{source, needs_images, views {front: {captured, photo}, …}, label, state}`;
  - in `scan_result`, also `summary {quality, quality_text, views {v: {quality, reason}}, observations [{id, heading, text, limitation, provisional}], notes [{id, heading, text}], meaning, focus {heading, text, why_heading, why}, comparison {available, text}, advanced [{view, metric, label, value, unit, limitation}], label, label_note, source}` and `failed`.
- `choice` (session_choice): `courses` (as in `welcome`) and `personalized`.
- `setup` (session_setup):
  - `goals [{id, label, description}]`, `durations [30, 60]`, `intensities [{id, label, description}]`;
  - `intensity_footer` and `label`.
- `recommendation`:
  - `{id, goal, intensity, duration_minutes, estimated_minutes, shorter, shorter_text, phase_minutes {warm_up, main, cool_down}}`;
  - `steps [{exercise_id, phase, sets, minutes, title, position, scan_rule, review}]`;
  - `reasons [2–4 strings]`, plus `rules_version`, `library_version`, `label` and `content_label`.
- `workout` (ready_to_train, exercise, exercise_paused, session_complete):
  - `{id, kind, state, current_index, position_ms, auto_next, planned_minutes, anatomy_label, title, subtitle}`, plus `content_label` (Standard) or `course_version` (course).
  - Each of `steps [...]` is `{position, phase, state, variant, planned_seconds, content, variants {easier?, harder?}}`.
  - `content` is `{source, ref, catalog_key, title, setup, instructions [], cue, breath, stop_if, narration [], dose {mode, sets, reps, hold_seconds, work_seconds, rest_seconds, sides, seconds_per_rep, set_rest}, equipment, position, video {url, mime, …} | null, image {url, label, …} | null, anatomy {exercise, depth, structures [{key, role}], timeline [{start_ms, end_ms, mode, layer, structures, cue}], label}, review, easier_text [], harder_text []}`.
  - In session_complete: `summary {outcome, end_reason, safety_category, kind, active_minutes, planned_minutes, duration_minutes, steps {completed, skipped, total}, title, focus, intensity?, course_progress?}`, `feedback` (the questions, or null once saved or after an urgent stop), `feedback_saved`, `after_feedback` and `safety {title, body}` after a safety stop.
- `stop_card` and `unwell` (training and completion): the stop signs and the "I don't feel well" questions.

## 5. Consent and photos

Before the camera starts, `scan_intro` shows three separate decisions (Phase 1
consent records, versioned):

1. **Camera scan (`scan_capture`, required for the scan).** Four still photos (front, both sides, back). It explains what is estimated and what is shown, that the measurements and the summary go to the Fitness Passport, that photos are deleted after the analysis unless kept, that no video is recorded and the camera is off during the workout, and that SEDENS does not diagnose or treat any condition.
2. **Keep photos (`scan_image_retention`, optional, off by default).** Agreeing keeps the photos in the facility's records. Declining deletes them after the analysis; only the derived measurements and the summary stay.
3. **Product analytics (`product_analytics`, optional).** Links screen and step events to the account. Without it, events keep only the room session.

What actually happens:

- **Demonstration precomputed scan.** The camera preview runs so the visitor sees the guidance. No photo leaves the browser, and fictional precomputed measurements are shown, labelled DEMO PRECOMPUTED ANALYSIS.
- **Experimental real analysis (free demonstration host) and local room capture.**
  1. Each photo is uploaded once, to a private folder outside `web/`.
  2. It is analysed by the existing pipeline. That takes about two minutes on the free host.
  3. The photo is deleted when the analysis finishes, unless retention was agreed.
  4. The measurements, the summary shown (both languages) and which feedback rule decided each observation are stored (`s_room_scans`, `s_room_scan_observations`).
  5. The scan is also saved as a workspace analysis (`p_analyses`, protocol `sedens_room_scan_v1`) linked to the visit.

## 6. Readiness

`data/sedens_readiness.v1.json` (version `sedens-readiness-1.0.0`) holds the eight
questions, their reasons, sources, behaviour and copy.
- The server asks them one at a time, in order.
- The first Yes stops the check. A Yes to the follow-up of a symptom question gives "Please get help now" (119).
- Only all-No is ready. There is no "modified intensity" outcome.
- The outcome is stored with the questionnaire version and never re-evaluated.
- Every later step (scan, plan, workout) requires this visit's check to have ended `ready`.

Evidence: `docs/SEDENS_FEEDBACK_EVIDENCE.md`.

## 7. Choosing a session

- **Continue the current course.** The next session of the version the customer is enrolled in. A newer published version is never switched in silently.
- **Another course.** Any guided course this room may play for this customer: included by the facility, purchased, or free here.
- **SEDENS Personalized Session.** 30 or 60 minutes, a goal and an effort. Built only from SEDENS Standard content by the deterministic rules in `docs/RECOMMENDATION_RULES.md`.

The scan never changes a creator's course. In a course, Easier and More
challenging appear only where the creator authored them.

## 8. The workout and the Passport

See `docs/SEDENS_SESSION_PLAYER.md` for the player. Server side (`workouts.py`):

- The workout is frozen when it is created. For a course, that means the exact version and session steps; for a personalized session, the stored plan.
- Each completed step is written once to the visit's `p_training_sessions` row and to `p_session_exercise_events` (shared with the coaching workspace).
- Course progress is written when the session completes.
- Effort and discomfort are stored as the customer reported them (`s_session_feedback`).
- A safety stop ends the workout as incomplete, never continues by itself, and no other session is offered in that visit.
- Ending the visit, or the room session expiring, keeps an open workout as `abandoned`.
