# SEDENS Phase 2.5 and Phase 3 report: operational controls and the AI Private Room journey

Branch: `claude/sedens-ai-private-room-v1` (Phase 2.5 is `16794aa` and `638ffaa`; Phase 3 is `f4b6599` … this commit). Nothing was deployed; the original branch and the existing Render service were not touched. No paid API, cloud service, storage or music; no Higgsfield call; no real CRM or payment; no coach in the room. Phase 4 has not started.

## 1. The stop condition (brief §53)

All four parts run in one real browser journey, `web/test/sedens-room-journey.browser.mjs`, against a `demo_free` server with Chromium's fake camera. It passes on the final code with no page errors.

| Part | Steps | What the test does and checks |
|---|---|---|
| A. Personalized session | 1–27 | opens `/room.html`, enters the simulated AI Private Room 01, identifies the fictional member DEMO-1001 (Sarah); answers the ten readiness questions; turns on camera consent; takes the four photos (front, left, back, right) with the countdown and "Use this photo"; the result is labelled "Demo precomputed analysis", shows the shoulder line in plain words, says "It is not a score", and contains no score, "/100" or percentage; chooses 30 minutes, Moderate and "Mobility and Pilates mix"; receives a SEDENS Standard plan; opens "Why this session" (at least two reasons); accepts; the player starts with instructions, its anatomy viewer highlights the exercise's structures (checked from the viewer's own state messages); opens anatomy full screen, turns to the side view, taps the model until a muscle is selected and isolated ("Showing External oblique" in the reviewed run), returns, and the workout continues; waits for the real automatic next (the "Get ready" countdown, then exercise 2); skips exercise 2; finishes the session; enters effort 6 and no discomfort; on the next visit the Fitness Passport shows one more visit |
| B. Coach course | 28–33 | re-enters; "4-Week Core Foundations" is offered with "Included with your membership"; starts its next session; the ready screen shows its version ("Version 1"; that a course plays the customer's enrolled version is tested in Python); the creator's anatomy mapping is highlighted; the step shows the SEDENS Standard exercise's setup; completing it sets the course progress to 1 session done |
| C. Professor course | 34–38 | before the purchase the room does not offer "Mobility Foundations" and refuses it if asked directly (`403 purchase_required`); the customer buys it on their phone (simulated purchase, "DEMO — no real payment occurred."); the room now offers it (the facility enabled it and the customer owns it); it plays its enrolled version; completion updates progress |
| D. Access checks | 39–44 | the customer's phone outside the room cannot start guided training (403); another facility's room cannot start the course; a room session that has ended cannot start a course (401); a course the facility disabled, and a course SEDENS suspended, cannot start (403); a paid course without the purchase cannot start (403) |

The same run then drives the Korean room (welcome, readiness, choice, plan, player, the "몸이 안 좋아요" dialog with "119에 전화하거나 직원에게 알리세요", completion; no English control labels on the Korean ready, player, dialog and completion screens) and a 390 px phone-sized room (no horizontal scroll on the welcome, a readiness question, the scan introduction, each of the four captures, the scan result, the choice, setup, plan, player, full-screen anatomy and completion screens; every player control at least 56 px tall).

## 2. Test totals

| | Python | Frontend (`npm test`) |
|---|---|---|
| After Phase 2 | 2,969 passed, 1 skipped | 538 passed |
| **After Phase 3** | **3,255 passed, 1 skipped** (286 more) | **597 passed** (59 more) |

The full Python run took 17 minutes 27 seconds on `be695c7`; the commits after it change only documents and the performance script. The one skip is pre-existing (`tests/test_groups.py` needs the BodyParts3D tables, which are not in the repository).

New test files: `test_sedens_room_journey.py` (50), `test_sedens_room_scan.py` (45), `test_sedens_room_plans.py` (79), `test_sedens_room_workouts.py` (31), `test_sedens_phase3_security.py` (14, the 15 attacks), `test_sedens_sales.py` (4), `test_sedens_demo_cleanup.py` (8); `test_sedens_standard.py` grew to 41. Frontend: `sedens-room-journey`, `sedens-room-scan`, `sedens-room-anatomy`, `sedens-room-narration` and `sedens-room-player` (now part of `npm test`).

| Check | Result |
|---|---|
| Production build (`npx vite build`) | built; the only warning is the anatomy viewer's bundle size, unchanged by Phase 3 |
| New room journey in a browser (A–D, Korean, phone) | passed, 0 page errors |
| Phase 1 room authorization journey (`sedens-room.browser.mjs`, updated for the journey welcome and "End visit") | passed, 0 page errors |
| Phase 2 marketplace journey (`sedens-courses.browser.mjs`) | passed |
| Existing workspace regressions | `platform-demo-auth`, `platform-feedback-markers`, `platform-historical-source`, `platform-routing`, `platform-summary`, `program-finding-atlas` and `program-recording` passed on the final code; `program-media-acceptance` stopped at its missing video fixture (`/home/user/validation/tree-demo.mp4`, outside the repository, as in Phase 2) |

## 3. What was built

**New migrations** (additive, contiguous, checksummed; no `p_*` table changed): `0013_course_sales.sql` and `0014_demo_activity.sql` (Phase 2.5), `0015_room_journey.sql`, `0016_room_scans.sql`, `0017_recommendations.sql`, `0018_room_workouts.sql`. Backup policies cover all ten new Phase 3 tables; a restore ends journeys and leaves no scan or workout open; scan photos are never archived.

**New routes:** `POST creator/course/sales` (Phase 2.5); `GET room/journey`, `POST room/journey/<action>` with 27 actions, `POST room/scan/image`. `POST room/course/complete` now needs a course workout this visit played to the end.

**Room state machine** (`pilates/sedens/journey.py`, server-owned, one row per room session):

`identified → readiness → (readiness_blocked | scan_intro) → scan_front → scan_left → scan_back → scan_right → scan_processing → scan_result → session_choice → (session_setup → recommendation →) ready_to_train → exercise ⇄ exercise_paused → session_complete → (session_choice | ended)`

Any step can end the visit; skipping the scan goes from `scan_intro` to `session_choice`. Only listed transitions apply, with a conditional update on state and revision; a stale screen gets `409 journey_changed` and re-reads the current step. Modules plug in through `journey.register`.

**Readiness** (questionnaire 1.1.0, original wording, not PAR-Q+): ten yes/no questions, one at a time — chest discomfort, unusual heartbeat, faint or dizzy, unusual breathlessness, recovering from injury or surgery, limiting pain today, a professional's restriction, a known condition (continues only if their doctor or care team said general exercise is fine), pregnancy or the 12 months after, not comfortable exercising alone today. Any other Yes ends the check with "We recommend not starting a self-guided workout right now", which is "not a judgement about your health"; a symptom happening right now shows urgent help (119 or staff, at once). The outcome and questionnaire version are written once; an old check keeps its version. Every scan, plan and workout action needs this visit's `ready` check.

**Evidence sources:** `data/evidence_registry.json`, 106 sources. All 46 that a shipped rule cites or names (readiness 14, scan feedback 8, session and recommendation rules 24) were independently re-fetched and their quotes found; the 57 background sources no rule cites stay marked "pending", and 3 never retrieved are marked "not relied on". Traceability per rule: [SEDENS_FEEDBACK_EVIDENCE.md](SEDENS_FEEDBACK_EVIDENCE.md) (§54's questions are answered there for each rule).

**Scan reliability behaviour:** four photos; capture quality per view (clear / limited / retake) with a customer reason ("We couldn't see your full body clearly. Step back slightly and try again."); a failed analysis is a failed scan with a retake, never a 500, and its photos are deleted at once unless the customer agreed to keep them; photos are deleted after the analysis unless the customer agreed to keep them; on the free host the demonstration result is precomputed, labelled, and needs no photo upload; a real scan is never compared with a demonstration.

**Feedback examples** (rules `sedens-feedback-1.0.0`):

| Case | English | Korean |
|---|---|---|
| Both front and back clear, same side, both ≥ 2.7° | "In both your front and back photos, your right shoulder sat slightly higher than the other one." | "앞모습과 뒷모습 사진 모두에서 오른쪽 어깨가 반대쪽보다 약간 높게 보였어요." |
| Both views clear, but a value under 2.7° (or two small values on opposite sides) | "Your shoulder line didn't show a difference larger than our camera's usual variation." | "어깨선에서 카메라의 일반적인 측정 오차보다 큰 차이는 보이지 않았어요." |
| Front and back disagree on the side, with a value of 2.7° or more | "We didn't describe your shoulder line today because your front and back photos didn't agree. Standing the same way for both photos helps." | "오늘은 앞모습과 뒷모습 사진의 결과가 서로 맞지 않아 어깨선은 설명하지 않았어요. 두 사진 모두 같은 자세로 서 주시면 도움이 돼요." |
| The front or back view not clear, or its value unusable (when both need a retake, only the retake message is shown) | "We didn't describe your shoulder line today because the camera couldn't see both shoulders clearly enough in your front and back photos." | "오늘은 앞모습과 뒷모습 사진에서 양쪽 어깨가 충분히 선명하게 보이지 않아 어깨선은 설명하지 않았어요." |
| Meaning, always | "Small side-to-side differences are common and can change with how you stand on the day. This is one camera observation. It can't tell us anything about pain, injury or your health." | (Korean in the rules file) |

Then today's exercise focus and why ("Your goal leads … one gentle shoulder-mobility exercise for variety"; "It isn't something an exercise is meant to fix"), a comparison only with the same customer's last comparable scan ("It doesn't mean better or worse"), and Advanced values without confidences. No overall score anywhere.

**Recommendation rules** (`sedens-recommend-1.0.0`, a pure function, no LLM, no randomness; [RECOMMENDATION_RULES.md](RECOMMENDATION_RULES.md)): readiness required; goal decides the phase categories; effort decides rest and the effort band; duration budget 27–33 or 55–65 minutes with an honestly labelled shorter plan (at least 20 minutes) when the library cannot fill it; experience decides levels and the set cap; the room's equipment; the review policy (a production room recommends only reviewed entries; the demonstration may use unreviewed entries, always labelled); after reported discomfort the next plan stays light with no harder options; a session that felt much harder than planned steps down; last-session context and variety; one shoulder-mobility exercise for variety after a shoulder-line observation (never presented as a correction). "Why this session" shows 3–4 reasons (always the goal and the effort, then one or two more; the time budget when nothing else applies) and the rule and library versions.

**Audited SEDENS Standard exercises:** version 1.0.0, 26 entries (the 10 of v0, whose v0 content is unchanged and which gained the new recommender fields, plus 16 new ones), each with categories, phases, level, dose, seconds per rep, setup, steps, cue, breathing, "Stop if", narration, anatomy mapping (structures by registry key and role, no intensities), easier/harder links that point both ways, and its review status. The library passes its structural checks (`standard.problems()` is empty) and the customer-copy wording guard. All 26 are **unreviewed** and labelled "Demo content — not yet expert-reviewed"; no expert review is claimed. A production room would therefore recommend none of them until reviewed.

**Workout player** ([SEDENS_SESSION_PLAYER.md](SEDENS_SESSION_PLAYER.md)): the step's video, picture with its label, or an instruction card; captions always; exercise n of N, set and side, a rep pace guide (the camera is off; it never counts the customer's movements) or a hold countdown; automatic next (default) with a 10-second "Get ready" screen, or a Done button; after two automatic advances without a touch, the next one pauses the workout instead and asks "Are you still there?"; pause, continue, repeat, previous, skip; easier and more challenging only where the library or the creator authored them; narration with the browser's speech and its own volume; music off, three generated ambiences or the customer's own file (never uploaded); "I don't feel well" always reachable (including in the full-screen anatomy view), urgent signs first with "call 119 or alert staff now", a safety stop is final for the visit; after a refresh the workout resumes at the same step, with its variant and the automatic-next setting (the position within the step is kept when the workout was paused; otherwise the step starts again); a step is finished once (no double Passport event). Found and fixed during the browser review: a pause during the "Get ready" countdown left the countdown running and the "Paused" card on screen after resuming; the full-screen anatomy sat under the stage overlay.

**Anatomy synchronization:** one embedded viewer (`/anatomy.html?room=1`, sandboxed, no navigation out) for the whole workout; the state at any moment is a pure function of the step and its time (the creator's timeline moment, else the exercise mapping); sent only when it changes; the next step's structures are preloaded; structures travel by name; the viewer's exercise mode is never used (it paints activation levels); always labelled "Educational anatomy — not measured muscle activation." Expanded, it pauses the workout; the customer turns it, zooms, shows the skeleton or the whole body, and taps a muscle to see it alone.

**Creator-course playback:** a course plays only when the room may play it at the start, from the customer's enrolled version (never silently a newer one); the plan is frozen into the workout, including the library instructions of each SEDENS Standard step; the creator's variants are the only easier/harder options; completing the workout records the course session once.

**Passport writes:** each visit has one `p_training_sessions` row (the scan's, or a new one); each completed step adds one `p_session_exercise_events` row; skipped steps add none; the workout, its steps and the feedback (effort 0–10, discomfort details, a note that never reaches analytics) are kept in `s_workouts`, `s_workout_steps` and `s_session_feedback`.

## 4. Performance (brief §48)

Measured with `web/test/sedens-room-performance.browser.mjs` on a local `demo_free` server in the development container (4 vCPU, headless Chromium 141, **software WebGL**: SwiftShader, no GPU), three runs on an idle machine. Nothing was deployed, so the free host itself was not measured; the platform verification of 2026-10-05, made before SEDENS began, measured the real analysis pipeline there at 33.2 s for one photo.

| Step | Time | Transferred |
|---|---|---|
| First page load (room screen ready) | 0.16–0.20 s | 143 kB, 27 requests |
| Demonstration entry for a new visitor (the server seeds the fictional facility) | 7.4–11.0 s | 2 kB |
| Identify the customer (welcome shown) | 0.12 s | 2 kB |
| Demonstration scan start (camera preview live) | 0.25 s | 1 kB |
| Demonstration result after the fourth photo (precomputed, no upload) | under 0.02 s | — |
| Plan built (recommendation shown) | 0.08–0.09 s | 4 kB |
| Player shown (ready screen) | 0.08–0.09 s | 1.1 MB, 84 requests (player code and the viewer page) |
| Anatomy viewer ready, counted from accepting the plan | 3.9–4.2 s | 5.5 MB more (the atlas models) |
| The first exercise's structures, loaded while the plan is read | 0.2–0.4 s | 2.3 MB |
| Start session → first exercise on screen | 0.8–2.8 s with the viewer; 0.07 s without it | 41 kB |
| Done → next exercise on screen | 0.14–1.2 s with the viewer; 0.07 s without it | 41 kB |

- **Lazy loading.** Nothing of the anatomy atlas loads at room start, during readiness, the scan or the plan; it loads when the player opens, while the customer reads the plan. The viewer first loads the whole skeleton and superficial-muscle layers (the 5.5 MB above); after that a step adds only the layers its structures belong to (for example the deep muscles), each loaded whole: the viewer loads by layer, not by single structure. When a step starts, the layers the next step needs are preloaded. No demonstration course has a video, so video start was not measured; only one demonstration course step has a picture (the pelvic curl in Core Foundations), and every other step shows its written instructions. A step's own video uses `preload="auto"`.
- **The slow step changes are the anatomy viewer's redraws, not the room.** The viewer (`main.js`, unchanged) draws only when something changes, plus a redraw at least twice a second as a safeguard against a stale picture; every change the room sends asks for at least three redraws. In software WebGL each redraw of the body costs 200–300 ms on the page's own thread (the viewer is a same-origin frame). Measured with nothing happening: the page thread was busy 75% of the time on the ready screen, 39% during an exercise and 54% when paused; every long task came from the viewer. With the viewer blocked, a step changes in about 70 ms. On hardware WebGL a redraw should cost milliseconds; that was not measurable here and must be checked on a real room computer before production. If it is slow there too, the fix is a room-only setting in the viewer that turns off or lengthens the half-second safeguard and limits the settle redraws (a change to the professional viewer, so not made in Phase 3).
- **Demonstration entry** is the server building the fictional facility for a new visitor (several seconds here; slower on the free host's 0.1 CPU). It happens once per visitor key.

## 5. Security findings (brief §56)

All 15 attacks were tried for real: 13 over HTTP against a running server, and the two about scan results (another customer's scan, technical-data leakage) through the server's own handlers in-process; the browser journey (part D) tries six of them again. None succeeded and no server change was needed. The table is in [SEDENS_SECURITY_MODEL.md](SEDENS_SECURITY_MODEL.md) §10.1. Bugs found by the new tests during Phase 3 and fixed with tests: the plan history read the wrong field; a duration sent as `30.0` caused a 500; a plan could be accepted without its id; sets were not capped at the experience limit; a failed scan's photos stayed on disk until a later action (scanning again, skipping, starting a scan, or ending the visit) instead of being deleted as soon as the analysis finished.

## 6. Free-host behaviour

On `demo_free`: the demonstration scan is precomputed and labelled (no photo leaves the browser), with the real experimental analysis offered with its expected wait; demonstrations nobody used are removed after `SEDENS_DEMO_TTL_HOURS` (default 6); the anatomy viewer loads only when the player opens; music is generated in the browser and narration uses the browser's own speech, so there are no audio files; course media are served from the same server. The room never needs a paid service; a lost connection shows "We couldn't reach the room server" and keeps the screen.

## 7. Screenshots reviewed (brief §58)

Captured by the browser journey and reviewed by eye: welcome, readiness, scan introduction and consent, scan guidance, scan result (full page and as seen on screen), session choice, setup, recommendation, "Why this session", player ready, player, anatomy expanded and isolated, transition, completion, feedback saved, coach course, professor course; in Korean: welcome, readiness, scan introduction, choice, recommendation, player, "I don't feel well", completion; on a phone: player and anatomy. Fixed from the review: the paused card stayed after resuming; the anatomy full screen sat under the paused card; stretched gaps between the stage and the controls; a course step showed the creator's cue three times; "Rules sedens-recommend-1.0.0" (now "Plan rules version 1.0.0 · Exercise library version 1.0.0"); the Korean player and plan used different names for warm-up and cool-down; the Korean "I don't feel well" button did not match the name the safety card tells people to press; the unwell dialog did not say "call 119 or alert staff" next to the urgent signs; on a phone the exercise name sat below the long instruction card. Found by the report's fact-check and fixed: "I don't feel well" was hidden while the anatomy view was full screen; the withheld shoulder-line note blamed unsteady photos even when the front and back views disagreed.

## 8. Remaining scientific limitations

- The 2.7° shoulder-line threshold is provisional and internal: there is no repeatability data from this pipeline on real people (only one generated image was perturbed). One observation only; the head and pelvis lines sit inside the measured variation.
- Side views are captured but produce no customer observation until the pipeline's inverted side-view convention is fixed ([SEDENS_VISION_IMPROVEMENT_PLAN.md](SEDENS_VISION_IMPROVEMENT_PLAN.md)).
- All 26 SEDENS Standard exercises are unreviewed; no professional (including Dr. Hong Jong Gi) has reviewed them, and none is claimed.
- The readiness questionnaire and the recommendation rules are sourced and independently citation-checked, but not clinically signed off; ACSM's full symptom list is deliberately not all asked (documented).
- The effort scale and discomfort questions record how the session felt; they are not measurements of fitness.

## 9. Remaining technical limitations

- Not measured on a real room computer, a GPU or a low-end machine. In software WebGL each anatomy redraw costs 200–300 ms and every change asks for at least three, so a step change took up to about 1.2 s (2.8 s for the first exercise) against about 70 ms without the viewer (section 4).
- MediaPipe live guidance is not shipped (it called a Google logging endpoint and adds about 19 MB).
- Narration depends on the browser's voices (captions always work); no recorded narration exists yet.
- The free host's real analysis takes minutes, and one analysis runs per process.
- The workspace's own comparisons still ignore the model and measurement version (SEDENS's do not).
- The room idles out a paused workout after `SEDENS_ROOM_IDLE_MINUTES`; an active workout stays alive only through its real step requests.
- `program-media-acceptance` needs a video fixture outside the repository, and `hosted-platform` needs a deployed site; neither ran.
