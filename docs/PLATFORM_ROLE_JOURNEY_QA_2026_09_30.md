# Local role journey evidence — 30 September 2026

This records the individual Admin, Coach and Student paths required by section 40 of the continued client-workspace specification. It is local acceptance evidence, not a declaration that the complete specification or live deployment is verified.

## Environment and boundaries

- Repository: `work/Pilates-Yoga`.
- Local copied database: `/tmp/motion-role-0929-retest.db`; media copied beside it. The source QA database and real records were not modified by this journey run.
- Local server: port 8133. Final tests used `http://localhost:8133/index.html` so authentication cookies did not affect the root QA server on `127.0.0.1:8125`.
- Browser: the available Codex in-app Browser, exercised through the Browser skill with semantic clicks, form edits and visible DOM snapshots.
- Final same-client demonstration: organization `demo-a2c5e8f9d64840ada7a68a1d6c2a8ead`; Sarah Kim, student ID `demo-a2c5e8f9d64840ada7a68a1d6c2a8ead-student00`; Coach Hana Lee; Admin Jules.
- Latest simulated assessment: `e07a16bdc31e498fba5c6d43066fb982`, Shoulder flexion, Front view, 27 September. Its visit is `fba567a5c9cc49fd9f51f525a7a07ec6`.
- Current assigned program: `446ab98872e747908c9aabfe1f9650ba`, Shoulder alignment · personal journey.
- An earlier pass used the original copied demonstration `demo-a3c6911e85d046fca5f47c13a0b9aff8`. The final Coach save and subsequent Student read below were repeated in the same localhost demonstration, so their relationships are verified across the same client and program.
- Fictional demo measurements and generated illustrations were labelled in the pages. The run did not submit real photographs, videos, scans, credentials or messages, and did not touch Render.

## Admin journey

| Required step | Observed result |
| --- | --- |
| Login | Signed out, then entered through the welcome screen's **Explore as admin** button. Jules · Organization administrator appeared; operations showed 34 visible clients and four locations. Demo login verified. |
| Clients | Clicked **Clients**; list displayed connected client cards and saved-session/practice summaries. |
| Select client | Selected Sarah Kim; client ID stayed constant in the workspace and downstream links. |
| Overview | Sarah's overview showed 20 assessments, 20 visits, Coach Hana Lee and Songdo. |
| Session | **Open this session** reached Visit 20 · Assessment & practice, with the selected 27 September capture, five logged movements and linked coach feedback. |
| Movement | Workspace **Movement** showed ten Sarah-specific Shoulder flexion records, each with a source session and report link. |
| Posture | Workspace **Posture** showed ten Sarah-specific Standing posture records; latest was 20 September. |
| Anatomy | **Body / 3D** opened Sarah's body map, selected Right Shoulder / scapular region, and displayed source assessments, notes and assigned practice. The atlas reported a WebGL startup failure; actual 3D rendering is not verified. |
| Coach feedback | Workspace **Coach feedback** showed Sarah's notes with their source session, report, assigned program and exercise links, author and student visibility. |
| Program | Workspace **Program** reached Sarah's current plan, saved revisions, earlier assignment and practice history; no client switch occurred. |
| Back to client | **Return to Sarah Kim's workspace** reached her overview. |
| Back to clients | **Change client** reached the clients list. |

## Coach journey and saved state

| Required step | Observed result |
| --- | --- |
| Login | Signed out, then used **Explore as coach** on the welcome screen. Hana Lee appeared; dashboard showed eight assigned clients and one location. Demo login verified. |
| Client | **My clients** → Sarah Kim reached her coaching workspace. |
| Session | **Open this session** selected the same latest visit and capture. |
| Review analysis | **Open selected analysis** reached the Movement session report. Its main signal showed left shoulder projected ROM 104.9°, earlier matching 13 September value 97.5°, and measured change +7.4°. Both captures were labelled demo simulations. |
| Select body finding | **Why this body region?** opened Left Shoulder / scapular region with the latest assessment retained. In the feedback form, selected the specific `left shoulder ROM: 104.9 deg in the front view` observation. |
| Anatomy | Body map displayed the selected left region, its related assessments and feedback; atlas rendering failed because this browser could not start WebGL. Region selection and linked-record navigation verified; mesh highlighting is not verified. |
| Add coach feedback | **Add coach feedback here** preselected the exact recorded visit, assessment and region. Related program choices contained only Sarah's current and earlier assigned plans. Saved student-visible feedback with an Arm Arcs exercise link and the specific observation. |
| Assign/update exercise | Followed the saved note's **Related program** link; edited Arm Arcs and Shoulder Placement from 11 to 10 repetitions, kept two sets and 60 seconds, selected Left body side, replaced the movement target with left shoulder, and saved a clear rationale. |
| Save | Saved the program with reason source **Movement or posture analysis**, the exact 27 September assessment and its recorded visit. The program displayed `2 sets · 10 reps · 60s`, Left side, the new rationale and Left Shoulder body link after save. |
| Return to client | **Return to Sarah Kim's workspace** reached the same overview with the new feedback and finding/source links. |

Saved feedback text: “Local same-client role verification: use comfortable left-shoulder Arm Arcs, then review the matching front capture.” The body map showed Hana Lee, student-visible status and a Source visit link to `fba567a5c9cc49fd9f51f525a7a07ec6`; its related program and exercise pointed to Sarah's assigned program and Arm Arcs.

The earlier copied-demo pass also opened Version history after an analysis-led revision: version 7 retained the exact reviewed assessment and visit while showing the changed prescription. No historic practice log was rewritten by this run.

## Student journey and cross-role verification

| Required step | Observed result |
| --- | --- |
| Login / My Progress | Entered through **Explore as student** on the welcome screen. Sarah's **View your progress** opened her progress page, with same-protocol measurement selection, previous/current values and source sessions. |
| Latest Session | From progress, **Latest assessment** selected Visit 20 with the latest 27 September capture. |
| Understand summary | Session summary stated the client, date, protocol, movement/posture counts, five logged movements, coach-feedback count and body regions. The report explained the selected projected measurement, unit, camera view, earlier matching capture and review status. Text/evidence availability was verified; user comprehension itself was not measured. |
| Coach feedback | **Open linked feedback** focused the selected visit's right-shoulder coach note, its author, visibility and source/plan/exercise links. |
| Body region | Clicked the note's Right Shoulder / scapular region link; Sarah and the source assessment remained selected. |
| Anatomy | Body map displayed region-specific measured findings, shared notes, assigned practice and source links. WebGL failure prevented verification of rendered 3D structures and highlighting. |
| Assigned exercise | The anatomy panel's Arm Arcs assigned-practice link opened Sarah's student program, with prescription, rationale, instructions, body link and completion checkbox. |
| Compare previous session | Returned to the latest visit and selected **Compare in assessment report**, then **Compare sessions**. The earlier same-protocol 13 September Front-view capture was selected. Left shoulder ROM showed 97.5° → 104.9°, +7.4°, matching source links and both labelled generated scenario images. |
| Newly saved Coach state | After the Coach save above, switched to the same Student. Dashboard displayed the newly saved left-shoulder note, exact finding, author and Source visit. Following its **Program** link opened the same assigned plan and showed Left-side Arm Arcs with two sets, **10 repetitions**, 60 seconds and the new Coach rationale. Cross-role persistence and read access verified. |

## Demonstrated bug and focused fix

The pre-fix feedback editor offered all programs visible to the Coach. A Coach could attach another assigned client's private program to a student-visible Sarah note. The server accepted that link; Sarah could read the note but could not open its Program target (404). Program client ownership lives in program detail/assignment records, so the generic top-level link check did not reject this case.

The feedback editor now derives program choices from the selected client's current and historical program assignments. The server checks an actual program assignment for the selected student before accepting a feedback program link. Foreign-client plans and unassigned plans are refused; earlier assigned plans remain valid so editing historical feedback retains its readable source plan. General feedback without a program remains supported.

Final-build browser check: Sarah's Related program selector contained only **No program**, **Shoulder alignment · coached practice** (historical assignment) and **Shoulder alignment · personal journey** (current assignment), despite the Coach/Admin library containing other clients' plans.

## Automated checks

- Python: `tests/test_platform.py`, `tests/test_role_acceptance.py`, `tests/test_feedback_links.py`, `tests/test_session_links.py` — **26 passed** (84.25 seconds). These include backend/HTTP role and tenant boundaries, private plan and scan-media scope, client/session link scope, feedback provenance, reservation conflicts, capture/booking/practice relationships, DICOM window/annotation behavior, equipment availability, and backup role boundaries.
- Focused new feedback regression checks Coach and Admin rejection of foreign or unassigned programs, Student access to the valid assigned link, rejection on edit without corrupting the original link, preservation of a historical assigned plan and general feedback with no program. After adding the historical-plan assertion, this test was rerun individually: **1 passed** (4.35 seconds).
- JavaScript: `node --test test/visit-form-links.test.mjs` — **6 passed**, including current/historical assignment IDs, deduplication and empty-client handling.
- `npm run build` — passed after the final historical-assignment selector change (3.46 seconds); existing large-chunk/dynamic-import advisories were emitted.
- `git diff --check` — passed after the final historical-plan assertion and this evidence document. The integrated worktree is to receive final complete suites from the root task.

## Limits of this evidence

Actual 3D mesh rendering, rotation, region highlighting and picking were **not verified**: the available Browser explicitly reported that it could not initialize WebGL. The failure state and navigation back to the client were visible and functional; those are not a substitute for a WebGL-capable rendering check.

Password login for real organizations, browser upload/camera capture, fresh live inference, scan uploads, reservation creation, equipment editing and live Render deployment were not exercised by these UI journeys. Some underlying paths are covered by the automated tests listed above; that does not constitute live/browser acceptance for those features. This document does not mark the entire specification DONE + VERIFIED.
