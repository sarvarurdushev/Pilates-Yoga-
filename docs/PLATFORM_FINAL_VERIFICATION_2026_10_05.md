# Motion Yoga verification report — 5 October 2026

The client workspace and Coach program designer are implemented, integrated and verified, including actual hosted pipeline and role-navigation checks. The [original #1–#44 checklist](PLATFORM_COMPLETION.md) and [current #1–#63 acceptance ledger](CURRENT_SPEC_ACCEPTANCE.md) record **DONE + VERIFIED** for every numbered requirement, with evidence and the accepted free-service limitation. This report supplies the requested #44 completion report and summarizes actual behavior and evidence rather than repeating the checklists.

**Release status: deployed and verified.** Application [PR #1](https://github.com/sarvarurdushev/Pilates-Yoga-/pull/1) was merged at `22a6107a514c549b3805c64f6cb998011005d576`; [PR #2](https://github.com/sarvarurdushev/Pilates-Yoga-/pull/2) deployed the demo-login follow-up at **`9b39bf4b71e8373c84e7f7826e2fc83f6cdec93c`**. [The existing Motion Yoga Render site](https://pilates-yoga-j1kz.onrender.com/) served the follow-up commit before and after passing live API and browser receipts. Actual hosted checks covered photo/video inference, role/source relationships, original media, DICOM annotations, shared feedback, saved programs and three-role navigation. The first release's fresh demo login returned a transient gateway 502 while its history was still being prepared; reconnecting to the same workspace succeeded. The follow-up adds bounded automatic reconnect, and a new fresh hosted login succeeded through the normal welcome action.

## Files and areas changed

| Area | Principal files / resulting behavior |
|---|---|
| Workspace, routing and visit summaries | `web/src/platform/app.js`, `selected-client-route.js`, `visit-evidence.js`, `feedback-navigation.js`: one selected client, exact source/visit links, shared return navigation, named assessment/practice summaries and role-specific context. |
| Measurement reports and history | `reports.js`, `explain.js`, `comparison.js`, `library.js`, `pilates/platform/progress_evidence.py`: human summaries, explained units/comparisons, supported source-selected histories and explicit missing measurements. |
| Anatomy and feedback | `anatomy.js`, `anatomy-bridge.js`, `feedback-markers.js`, `feedback-source.js`, `web/src/main.js`, `web/anatomy.html`: client-linked reference anatomy, stable markers, exact feedback/source actions, embedded/fullscreen fit and provenance. |
| Coach program design | `programs.js`, `program-sequence.js`, `program-camera.js`, `forms.js`, `program-version-diff.js`, platform designer/repository modules: rich saved prescriptions, library/custom exercises, media, body targets, sequence actions and immutable revisions. |
| Data, permissions and operations | `pilates/platform/repository.py`, jobs/media/source-link and backup modules: validated same-client relationships, role/tenant/media boundaries, exact visit and exercise events, reservation capacity/equipment and archive/restore. |
| Demo histories | `seed.py`, `demo_program_history.py`, `demo_scenarios.py`, cached scenario records and `tests/test_demo_camera_history.py`: measured parametric simulations, separately computed camera views, dated feedback and changing linked plans. |
| Archived compatibility | `web/src/session/boot.js`, `charts.js`, `lab.js`: explained camera-check scores, known formulas/units and explicit missing rubric endpoints or unknown historical quantities. |
| Verification and deployment checks | Role/source/program/scan/evidence tests; browser scripts in `web/test`; `tools/verify_hosted_platform.py`; [route map](PLATFORM_ACTIVE_ROUTES.md), [chart audit](PLATFORM_CHART_NUMBER_AUDIT.md), [atlas/archived audit](PLATFORM_LEGACY_CHART_NUMBER_AUDIT.md) and [screen-question matrix](PLATFORM_SCREEN_QUESTIONS.md). |
| First demo login | `web/src/platform/demo-auth.js`, `core.js`, `app.js`: preserve the same workspace identity and reconnect sequentially after transient network/gateway failures, with a shared timeout and visible preparation status. |

The file names without a directory in the table belong to the area named in that row; frontend platform files are under `web/src/platform`, backend platform files under `pilates/platform`.

## Navigation fixes

The active app has one client workspace with Overview, Sessions, Movement, Posture, Body / 3D, Coach feedback, Program and Progress. Global collections and client tabs open the same exact report, visit, body, feedback, progress or program renderer. Selected client/source IDs survive finding → anatomy → note → program, progress → source visit, and scan → source frame. Reports, exercises, programs and fullscreen anatomy provide a visible return path. A Student's foreign-client link is normalized to their permitted own client; authorization is also enforced by the server.

`index.html` loads the current platform. The retained old studio app is inactive. Older bundles/tools are available only through explicit `session`/`legacy` anatomy URLs, preserving working archives without presenting another result system in the normal workflow. Direct links, reloads, returns and ten exact client-specific movement report links were browser-checked.

## Charts explained and technical numbers

Nine current chart families were inspected: posture measurement cards; selected and opposite movement signals; signed velocity/acceleration; image/model coordinates; client progress; measured body-region history; program progress; and paired session comparison. Each identifies its data, unit, definition, meaning, source and compatible earlier value/change or explicit absence. Historical comparisons require matching client, protocol, view, selected person, unit and evidence support. Progress points and Coach/program milestones lead to exact source records rather than nearby dates.

Raw XYZ, confidence, derivatives and complete tables are secondary disclosures. Image X/Y are original-frame pixels; image Z is unavailable. Model XYZ uses hip-relative estimated metres with learned-scale/depth limitations. Frame index and clip seconds are distinguished. Program dose, latest-practice denominator, operational counts, simultaneous capacity, reservable stock and scan display controls have labels and context.

The chart browser receipt passed **14 named checks with zero page errors**, including all nine current families and Student disclosure. It also mounted the actual archived Anna demo bundle: 32 SVGs, 23 camera checks, 100% coverage, weighted score components, control/tempo formulas and a collapsed unknown-unit historical quantity. Engine-derived archived posture/radar components and subjective missing-endpoint/print branches were inspected. Reference-model Lab charts were rendered separately by the complete anatomy smoke. Forty-two focused formula/source/copy tests passed; this is software and source verification, not clinical calibration.

## Movement and posture experience

Guided capture asks for the client, named task and photograph/video views; Front, Back, Left side and Right side instructions make the upload purpose visible. The report first explains what was recorded, who/when/where, camera orientation, side, equipment or its absence, original evidence, accepted span/frames and review state. Camera diagrams show the declared capture setup. Supported posture observations and the nearest compatible prior result come before the raw measurements.

The actual upload pipeline was exercised. A moving validation video accepted **33 of 34 sampled frames over 5.3 seconds**, produced nine body signals and a 4.1° trunk-inclination range, then saved an exact visit/progress link after the foreground person was confirmed. It correctly reported zero complete cycles for that balance fixture. A nearly static generated clip accepted only 6 of 34 frames, retained the source video and requested a clearer capture without inventing a usable trace. A generated two-person photograph required explicit person preview/confirmation before its evidence could enter the client's history; changing to the other detection restored the unverified state.

The saved task name is the selected assessment protocol, not a claim of automatic exercise recognition. Generated scenario photographs are labelled illustrations separate from their simulated coordinates. No photograph establishes muscle weakness, internal anatomy or a medical diagnosis.

## 3D anatomy and Coach feedback

Finding links open the relevant client body region with its reason, measured history, source visits, Coach feedback and assigned practice. The detailed model remains an educational reference. Embedded/fullscreen views preserve the client and source; unsupported or absent historical source relationships are stated explicitly rather than guessed.

Fresh Coach/Student browser loads and reloads displayed saved right-shoulder, left-hip, both-hip and right-knee feedback markers. A targeted report showed only its requested region. Marker actions opened the exact note/analysis or visit; Students saw only permitted feedback. The knee anchor matched projected geometry within about 0.05 px, and left/both hip labels stayed separate and in bounds.

Coach feedback stores author, time, region, exact visit/result/finding, visibility and optional exercise/program links. Newly written human feedback on a demo assessment remained **Coach-written feedback** in Coach and Student views; seeded fictional notes remained **Demo Coach feedback**. Historical general feedback displayed its missing visit and offered an explicit Coach repair action. Saving a selected exact visit retained it after reload; the Student could read but not edit it.

The complete WebGL smoke passed with **zero failures, 844 correct catalogue picks, 752,380 sane vertices, 1,635 nonoverlapping catalogue cells and no horizontal overflow at 390px**. Reference sections, network/node plots, authored motion/muscle curves and research evidence explain their model/library origin. A model cutaway is not a radiograph or reconstructed patient scan.

## Coach program designer and Student experience

Programs store client-specific goals, phase/schedule, optional dose/rest/tempo/resistance, instructions/cues, progression/regression, precautions, rationale and body targets. The designer supports library search, custom program-only exercises, templates/duplicates, pointer and keyboard ordering, named sections, duplicate/remove and shared/private notes. Saves preserve immutable versions, actor/time/reason/source and the version used by a past practice visit.

Browser checks saved/reloaded two PNGs with start/end captions, uploaded and existing MP4s, primary selections, references, custom exercises and private/shared content. Failed-save retry retained pending files without duplicate uploads. Native Chromium camera APIs recorded a three-second **1280×720 WebM**; the track ended on stop, and Student playback after save/reload decoded and advanced with zero errors. Existing/library/client/Coach/reference/AI/demo media have source labels; private content is hidden by the UI/API and denied on direct download.

An exact report finding created a new plan with the source/finding retained. Real atlas clicks selected whole-plan Left patella/knee and individual-movement Left radius/elbow targets; these remained distinct after save. Return opened the exact assessment. Phase 2/weeks 5–8 saved as version 2. Completing the plan made its assignment inactive while preserving versions 1/2 and earlier plans. A 390px designer retained visible actions and wrapped long content without overflow.

Students see their own latest assessment, named visits, shared feedback, explained progress and assigned practice. Exercise cards prioritize dose, instructions, rationale, targets and permitted media; Coach planning fields stay private. Completion saves to an exact practice visit with recorder/time. “Marked complete” records the app action, not proof that the physical exercise occurred. Actual Coach-save/Student-read, media playback, body links and completion reloads were checked in the same demonstration organization.

## Admin, scans and studio operations

Admin views show scoped clients, Coaches, locations, assessments, reservations, recorded visits and review/program follow-ups. Management screens use operational context; exercise/camera interpretation is N/A when no capture is selected. Location capacity describes simultaneous bookings; equipment shows base reservable/total units and separately checks overlapping demand. Role/tenant/source/conflict tests reject unauthorized or incompatible relationships.

Ordinary-image and DICOM records retain media, capture/source dates, exact visit/result, region and manual annotations. The local browser displayed three distinct artificial DICOM frames, changed window centre/width, selected the saved frame and retained scan-wide marker numbering. PNG contrast started at 100% and updated its visible readout. A missing capture date remained explicitly missing. Public demo radiographs retain attribution and are reference images, not scans acquired from fictional clients; no diagnostic result is generated from them.

A fictional organization archive was exported and fully restored into a disposable local studio: **175 media files and 1,512 normalized exercise events** were preserved. This verifies backup/recovery functionality, not durability of the free hosted service.

## Demo data and sessions per featured client

The fresh flagship seed contains **34 clients, four Coaches, four locations and 302 assessments**, with linked practice, feedback, body targets, scans/references, reservations, assignments, versions and progress. Counts in browser QA can be higher after that disposable organization receives additional test records.

| Featured client | Completed seeded visits | History |
|---|---:|---|
| Sarah Kim | 20 | Alternating posture/movement, dated feedback and evolving assigned plan |
| David Lee | 20 | Individual dated assessment, feedback and program records |
| Minji Park | 20 | Individual dated assessment, feedback and program records |
| James Han | 20 | Individual dated assessment, feedback and program records |
| Olivia Choi | 20 | Individual dated assessment, feedback and program records |
| Elena Kim | 20 | Individual dated assessment, feedback and program records |
| George Lee | 20 | Individual dated assessment, feedback and program records |

Each featured history spans **19 weekly intervals: 133 days, approximately 4.4 months**, inside the requested 3–6 month demonstration window, with a 20-week phased plan. Dates are relative to seeding time. Measurements vary through bounded trends, stability and temporary setbacks instead of uninterrupted perfect improvement. Every featured midpoint includes separately calculated Front and Left-side posture views; the alternate view is not a relabelled skeleton or a measurement attributed to an illustrative photo. All seven source-linked histories and 120 deterministic scenario geometries passed integrity checks for units, view, region, notes, phases, source visits and image provenance.

## Browser workflows and regression results

| Workflow | Actual local result / receipt |
|---|---|
| Admin | Login → Clients → Sarah → Overview → Session → Movement/Posture → Body → Feedback → Program → return to client/list. [Three-role QA](PLATFORM_ROLE_JOURNEY_QA_2026_09_30.md). |
| Coach | Client → exact visit/report → finding → body region → shared note → assigned exercise/dose/target → save → return. Student read the same saved state; later markers/WebGL supplied actual geometry. |
| Student | Progress → source visit → explained report → shared feedback → body region → assigned exercise/program → matched comparison. Completion and media retained after reload. |
| Routing and clarity | Direct-link/refresh/return in three roles; foreign Student link normalization; selected source protocol/view, named movement, dated/undated scan, mixed note provenance; 540px visit without overflow. |
| Capture and scans | Accepted moving video, refused near-static clip, two-person photo confirmation; exact visit/progress links; PNG and artificial multiframe DICOM/window/marker/frame actions. |
| Programs | Actual finding-to-plan and atlas picks, rich media/custom/reference saves, library/private scope, pointer/keyboard sections, retry, immutable phases/history, Student why/body links and Complete action. |
| Historical records | Exact Coach visit repair/reload; Student absence/visibility; fullscreen source absence and feedback link on actual geometry; seven featured history invariants. |
| Charts/anatomy | Fourteen chart DOM checks, 42 focused formula/source tests; complete WebGL catalogue/sections/Lab/geometry/390px smoke. |

The detailed receipts are in [integrated QA](PLATFORM_INTEGRATED_QA_2026_09_30.md), the linked audits and browser scripts. Final regression:

| Check | Result |
|---|---|
| `../venv/bin/python -m pytest -q` | **2,625 passed, one skipped**, 542.92 s; `/tmp/motion-python-final-1005.log` |
| `npm run test` in `web` | **513 passed, zero failed**, 31.02 s; `/tmp/motion-web-final-demo-reconnect-1005.log` |
| `npm run build` in `web` | **Passed**, 3.51 s, after the demo-login follow-up; `/tmp/motion-build-demo-reconnect-1005.log` |
| Demo-login browser recovery | **Passed**, identical key/role, one organization and zero page errors; `/tmp/motion-demo-auth-ui-1005.log` |
| Hosted API and browser | **Passed** on exact deployed commit `9b39bf4b71e8373c84e7f7826e2fc83f6cdec93c`; [pipeline](verification/2026-10-05/hosted-pipeline.json), [browser](verification/2026-10-05/hosted-browser.json) |
| Diff whitespace check | **Passed** |

The existing large-bundle build warning remains. The skipped test remains a skip; it is not counted as verified. The software-rendered anatomy smoke measures correctness and layout, not production GPU performance.

## Hosted receipt and demo-login recovery

The archived [capability receipt](verification/2026-10-05/capabilities.json) and [pipeline receipt](verification/2026-10-05/hosted-pipeline.json) identify the served Render commit as **`9b39bf4b71e8373c84e7f7826e2fc83f6cdec93c`**. The pipeline completed with `verified:true`; its fixture measurements were saved under a separate **Hosted workflow validation client**, not attributed to Sarah Kim's fictional history. Both deployment and workflow checks were repeated after the reconnect fix; they were not assumed from the first release's passing receipt.

| Hosted check | Verified result |
|---|---|
| Capabilities and deployment | Photo/video/3D capabilities true, RTMO-s, platform Render, exact commit checked before and after the run. |
| Photograph | Actual pipeline processed generated `sarah.png` in **33.20 s**; selected Person 1 from two suitable detections, saved **40 coordinate rows and 14 supported progress rows**, and returned estimated depth. |
| Movement video | Actual pipeline processed `tree-demo.mp4` in **51.96 s**; **16/16 accepted sampled frames, nine body signals, 640 coordinate rows and 18 supported progress rows**. Person 1 was suitable and Person 2 unsuitable. It correctly reported zero complete cycles for this balance fixture. |
| Video depth | **Five independently estimated depth frames** were retained. The aggregate video depth status remained unavailable; this is sparse frame-level depth, not a complete 3D clip. |
| Health and original media | All **23 health probes returned HTTP 200** during inference; maximum response time **1.160 s**. Both original photo/video byte hashes matched after reload. |
| Roles | Admin saw 34 seeded clients; Coach saw eight assigned clients and was denied a foreign client. Student saw their own program/client and was denied foreign/system/edit actions; Coach-private planning fields were absent. |
| DICOM and feedback | An artificial multiframe DICOM rendered selected frame 1 with windowing. A manual annotation and shared feedback retained the exact saved frame, visit, analysis and body region. |
| Program relationships | A program-only custom exercise, ordered exercise/shared/private notes, immutable version 1, exact source visit and assigned Student projection saved and reloaded. |

The first hosted attempt received a non-JSON 502 from `/platform/auth/demo` after **35.87 s**, before any inference job was created (`/tmp/motion-hosted-acceptance-1005.json`). Reusing its unchanged private workspace key succeeded; no replacement organization was seeded. A separate real HTTP profile under **15% CPU quota and 512 MiB memory limit** returned 200 after **42.7 s**, using 7.36 s process CPU and a 170,468 KiB process RSS peak (`/tmp/motion-cgroup-auth-profile-1005.log`). This reproduces a slow initial preparation response that can outlast the gateway while the server continues its atomic seed.

The follow-up `authenticateDemo` retains the same key/role/user identity, retries only network status 0 or gateway 502/503/504, waits two seconds between at most three sequential attempts, and forwards the remaining shared **180 s** deadline to the request. Other errors are not retried. Five focused tests passed. A browser test forwarded a real initial seed, injected the gateway 502, displayed the preparation/reconnect status and opened the same eight-client Coach organization automatically with zero page errors. No backend changed after the 2,625-pass Python run. The 513-test web suite and production build passed after this fix.

The first release's earlier receipt (`/tmp/motion-hosted-acceptance-retry-1005.json`) passed photo/video in 27.68/47.58 s with the same supported coordinate/progress/frame counts, five sparse depth frames and 20 successful health probes. The final receipt above supersedes its deployment and timing results.

The final [hosted browser receipt](verification/2026-10-05/hosted-browser.json) passed with zero page errors and the exact follow-up commit checked before and after. Its retained [fresh welcome/Coach/Admin receipt](verification/2026-10-05/hosted-browser-first.json) opened the Coach dashboard through the normal welcome button in **40.072 s** after one HTTP 200 authentication response. No transient retry was needed on that fresh hosted run; the actual retry behavior was exercised separately by the local injected-gateway browser test. Coach had eight assigned clients, Sarah's 20 visits, an exact session/report and preserved return context. Admin had 34 seeded clients and four locations before the separate API verifier added its validation client.

The same-workspace Student follow-up explicitly selected the original Sarah fixture after the API validation client altered the default demo selection. It verified Sarah's own 20 visits, foreign-client HTTP 403, initially collapsed advanced measurements/hidden coordinates, absent Coach review controls, assigned program/rationale and the matching right-shoulder body/iframe client context. The initial harness failures were assertion issues: case-sensitive `Sarah Kim` against an uppercase body heading, then unchanged fresh total/default Student assumptions after the API added its separate validation client. Corrected assertions retained the original fresh baseline rather than reseeding or hiding fixture changes. The completed receipt records that scope. Hosted body context was checked; the full native atlas rendering/geometry smoke remains the separately recorded local verification, not a repeated hosted GPU claim.

The final checklist/report and browser-harness receipt edits change no application runtime files. Their completion commit uses Render’s documented [skip-auto-deploy mechanism](https://render.com/docs/deploys#skipping-an-auto-deploy), preserving the verified running application at `9b39bf4b71e8373c84e7f7826e2fc83f6cdec93c`.

## Known limitations

- The user explicitly chose the existing **free Render service** and confirmed there are no real hosted records to preserve. Its SQLite/uploads are ephemeral and may reset on restart/redeploy. This approved demonstration release does not promise persistence across redeploy; paid storage was not provisioned.
- Synthetic subjects, generated imagery/scans and the synthetic camera exercise software paths. Camera-derived landmarks and independently estimated depth are not clinically calibrated anatomy, diagnosis or automatic exercise recognition. Reference scans and atlas/library values are not personal findings.
- Unknown historical visits, formulas, units or subjective endpoints stay explicitly unavailable or technical. They are not inferred from a date, copied image or convenient modern definition.

No numbered implementation or verification gate remains open. The storage and measurement limits above are explicit properties of the approved demonstration release.
