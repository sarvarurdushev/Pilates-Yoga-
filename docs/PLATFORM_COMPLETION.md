# Requirements 1–44: implementation and evidence

A requirement is complete only when its data, authorization, workflow and relevant verification pass. UI existence alone is not evidence. This is the earlier specification; the later #1–63 work and current release status are tracked in CURRENT_SPEC_ACCEPTANCE.md. Local verification has now closed the prior WebGL gaps; the main implementation is hosted-verified at `22a6107a514c549b3805c64f6cb998011005d576`; a small demo sign-in recovery follow-up remains pending.

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 1 | FIRST: AUDIT THE EXISTING PROJECT | DONE + VERIFIED | Audit and branch/commit comparison in PLATFORM_ARCHITECTURE.md; the rebuilt branch is deployed on the original Render service and its SHA was checked through the live capability endpoint. |
| 2 | THREE COMPLETELY DIFFERENT VIEWS | DONE + VERIFIED locally | Actual coach/student/admin UI; platform authorization and cross-client HTTP tests. |
| 3 | ADMIN | DONE + VERIFIED locally | Admin organization view, location assignment UI; role conversion/deletion and inspector tests. |
| 4 | LOCATIONS | DONE + VERIFIED locally | Four seeded locations; room/capacity/equipment relationships; new location + coach/client assignment UI. |
| 5 | DATABASE ARCHITECTURE | DONE + VERIFIED locally; disposable hosting accepted | Relational schema, foreign keys, reopen, immutable history and full archive/restore pass. The user explicitly confirmed no real hosted records need preservation and chose the same free service despite reset risk. Free-host durability is not promised or a paid-storage gate; local database/backup functionality is real. |
| 6 | CLIENT PROFILE = CENTRAL HUB | DONE + VERIFIED locally | Sarah header and eight scoped tabs; client-history test includes >200 older notes. |
| 7 | COACH DASHBOARD | DONE + VERIFIED locally | Assigned-client dashboard, upcoming/today sessions and follow-up conditions; server scope tested. |
| 8 | PROGRAM BUILDER | DONE + VERIFIED locally | Program sequence CRUD/reorder/duplicate/assign, exercise prescriptions and equipment relations; saved program UI. |
| 9 | COACH CONTENT EDITING | DONE + VERIFIED locally | Edited instructions, uploaded image, saved optional resource and verified persistent content. |
| 10 | EXERCISE DATABASE | DONE + VERIFIED locally | 199 distinct catalog entries, category/search/pagination tests, editable owned content. |
| 11 | EQUIPMENT | DONE + VERIFIED locally | Location inventory and exercise/program requirements; unavailable equipment rejects reservations. |
| 12 | DEMO CLIENTS | DONE + VERIFIED locally | 34 linked fictional profiles, six distinct scenarios, assigned coaches and locations. |
| 13 | HISTORICAL DATA | DONE + VERIFIED locally | Seven featured clients now have 20 completed visits across 133 days (about 4.4 months); remaining profiles have linked histories. New geometry/camera/phase/setback/source tests and all-seven saved-history integrity audit pass; illustrations and simulations remain distinct. |
| 14 | BEFORE/AFTER IMAGES | DONE + VERIFIED locally | Seven individually generated before/after pairs inspected; scenario and identity associations verified. |
| 15 | POSTURE ANALYSIS | DONE + VERIFIED locally | Actual skeleton overlay, anatomical joint IDs and labelled midpoint proxies; posture regression suite. |
| 16 | ESTIMATED BODY COORDINATES | DONE + VERIFIED locally | Real frame XYZ/confidence/time table, landmark selection, trajectories and rejected-frame unavailable state. |
| 17 | DEEP BIOMECHANICAL ANALYSIS | DONE + VERIFIED locally | Supported 2D geometry and temporal derivatives; unsupported rotations/internal anatomy remain explicit unavailable. |
| 18 | MOVEMENT ANALYSIS | DONE + VERIFIED locally | Real angle/velocity/acceleration/coordinate charts, phases, repetitions and comparison controls. |
| 19 | "MOVEMENT TO REPEAT" / CAPTURE WORKFLOW | DONE + VERIFIED locally | Existing Sarah selected, movement and capture choices, progress/job stages and review/save UI. |
| 20 | VIDEO ANALYSIS | DONE + VERIFIED for tested clips | Local browser journey, two hosted API uploads and two further real browser uploads completed: tracked people, joint series, five independently estimated depth frames, 640 stored coordinates per selected person, review and a real before/after comparison. Free-host reset risk is explicitly accepted under#5; original media is retained while that instance runs. |
| 21 | 3D ANATOMY MUST BE CONNECTED TO ANALYSIS | DONE + VERIFIED locally | Exact finding→client region, real mapped atlas structures and feedback/history source links passed browser QA. Final full atlas smoke:844 correct picks,752,380 sane vertices,1,635 non-overlapping cells, no 390px overflow. |
| 22 | ANATOMICAL COACHING NOTES | DONE + VERIFIED locally | Region note associated with analysis, scan, program and exercise context; bridge carries note to atlas. |
| 23 | 3D ANATOMICAL LAYERS | DONE + VERIFIED locally | Actual shared atlas layers, structures and educational Lab were verified by the complete WebGL smoke and client-linked5drawcall views; mapped regions and stored feedback markers were inspected. |
| 24 | SCAN / X-RAY SYSTEM | DONE + VERIFIED locally | Primary-source model/license/compatibility review in PLATFORM_MODEL_REVIEW.md; pydicom integrated. |
| 25 | SCAN WORKFLOW | DONE + VERIFIED locally | UI DICOM upload, window, frame, annotation and source-analysis/anatomy links; decoder/auth tests. |
| 26 | ANATOMY ↔ SCAN ↔ ANALYSIS | DONE + VERIFIED locally | Actual DICOM/PNG frame controls and exact scan/marker/visit/analysis/body links passed browser and decoder/auth tests. Shared mapped atlas geometry/highlight and source feedback were verified on a functioning WebGL surface. |
| 27 | PROGRAM ↔ ANALYSIS | DONE + VERIFIED locally | Assessment/target region → program → assignment → client schedule; history/progress relationships tested. |
| 28 | ANALYSIS DASHBOARD | DONE + VERIFIED locally | Report tabs show actual skeleton, coordinates, temporal metrics, comparisons, anatomy and program links. |
| 29 | NAVIGATION | DONE + VERIFIED locally | Role sidebar plus persistent client tabs; context retained through tested coach journey. |
| 30 | SEARCH | DONE + VERIFIED locally | Scoped global search plus indexed/paged library and collection search; integration tests. |
| 31 | RESERVATIONS | DONE + VERIFIED locally | Student/coach/admin reservation scopes, conflicts, room/capacity/equipment tests; future schedule UI. |
| 32 | AUTOMATIC DEMO ASSIGNMENTS | DONE + VERIFIED locally | Automatic isolated seed:34 clients across four Coaches/four locations,302 assessments and seven featured20-visit histories, source-linked programs/feedback/media/reservations/progress. Finite relational and geometry invariants pass. |
| 33 | CLIENT SELECTION DURING ANALYSIS | DONE + VERIFIED locally | Real upload used existing Sarah from selector; new-client action remains optional. |
| 34 | PERFORMANCE | DONE + VERIFIED for tested captures | Hosted photo completed in 32.07 s and two API video jobs in 51.13/51.34 s; all 13 concurrent health checks returned 200, max 1.645 s. Two further browser video uploads completed under three seeded demo organizations. The latest local 512 MB/15% CPU constrained photo-plus-two-video run peaked at 441 MB cgroup use. Longer or crowded clips need separate capacity testing. |
| 35 | ERROR HANDLING | DONE + VERIFIED | Unsupported files, missing visibility, multi-person review, auth, upload/job and WebGL failures have explicit states. On deployed `d863e03`, signing out in a second tab then opening a client from stale UI returned directly to the welcome screen. |
| 36 | REAL DATA VS DEMO DATA | DONE + VERIFIED locally | Isolated demo organizations; simulated rows/imagery marked; real demo-account uploads invoke actual pipeline. |
| 37 | IMAGE GENERATION | DONE + VERIFIED locally | Multiple fictional ages/body types, before/after pairs and exercise board; generation records and credits. |
| 38 | DO NOT MAKE MEDICAL CLAIMS | DONE + VERIFIED locally | Pose estimates/proxies and scan manual review explicitly distinguished from diagnoses or internal reconstructions. |
| 39 | DESIGN PRINCIPLE | DONE + VERIFIED locally | Client → evidence → region → coaching → program hierarchy inspected in browser. |
| 40 | TEST THE COMPLETE USER JOURNEYS | DONE + VERIFIED locally | Exact Admin/Coach/Student journeys, shared Coach-save/Student-read state, actual upload/refusal/confirmation, scan/source returns, practice/version actions, real body markers and in-editor atlas program picks pass. New hosted release is separately pending under later#44. |
| 41 | IMPORTANT: DO NOT FAKE FUNCTIONALITY | DONE + VERIFIED locally | Actual inference and persisted relations tested; synthetic history labelled; missing depth/rendering states honest. |
| 42 | BEFORE CODING | DONE + VERIFIED | Pre-implementation architecture audit and phased plan in PLATFORM_ARCHITECTURE.md. |
| 43 | MOST IMPORTANT SUCCESS CRITERIA | OPEN — final integration | Sarah's end-to-end data chain, new hosted captures, and a real before/after comparison were verified while the instance was running. Local immutable history and actual 3D highlighting now pass; final updated hosted release remains pending. |
| 44 | FINAL REQUIREMENT | OPEN — overall completion | All individual requirements tracked here. Do not declare completion while the listed open verifications remain. |

Local verification is not a claim of hosted completion. See PLATFORM_VERIFICATION.md for test counts, fixture IDs, performance and unresolved environmental limits.
