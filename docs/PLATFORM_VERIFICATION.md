# Connected platform verification — September 22–23, 2026

## Release baseline

Repository: sarvarurdushev/Pilates-Yoga-. Branch: `claude/multi-person-pilates-analysis-w28tt0`.
Target: `https://pilates-yoga-j1kz.onrender.com/`, service `srv-daf50ov40ujc739kfh4g`.
Before release, GitHub deployment 6479021546 identifies `e66799050b10ea353fb5c6145cdf3d36d40c4680` from September 16. The uncommitted rebuild was not deployed. No new service or paid resource is required for the code release.

## Automated evidence

- Full Python regression: **2482 passed, 1 skipped**, 345.66 seconds.
- Browser-independent JavaScript geometry/atlas/content tests: **351 passed**, 41.64 seconds.
- Platform integration subset: **15 passed**, 47.91 seconds. Includes organization and client isolation, role conversion/deletion relationships, scoped CRUD/resources/media, coordinate confidence/derivatives, reservation conflicts, equipment availability, DICOM decode/window/frame/annotation, atlas mappings on reopen, administrator inspection, independent duplicated media, multi-person review, library paging/search/scenarios, full archive round-trip, HTTP authentication/CSRF/ranges and histories beyond 200 entries.

## Browser journeys (local server, actual UI)

A — Coach: logged in as Hana, selected Sarah, visited profile/history, opened report/coordinate tables/charts, followed region → anatomy → scan → notes → program. Edited Arm Arcs instructions, uploaded the generated reference board, attached optional NHS flexibility resource, saved, assigned the program and inspected future reservations. The same Sarah ID remained on links. Region note linked assessment, scan and program. Actual WebGL rendering remains open; see below.

B — Real video: uploaded `tree-demo.mp4`, selected Sarah and Standing balance/front. Job `057ba51987274c099772ff06320454fe` completed in **24.49 s** locally, report `083c171edb284118bd7b55a54dbe13da`. Selected suitable person 1; person 2 remained a refused detection requiring review. There are **34 frames and five independently accepted 3D frames** for person 1. The UI showed joint angle, velocity, acceleration and coordinate trajectories. At 1.3 s, head model XYZ was -0.007/-0.604/-0.253 m; this is an estimate, not calibrated anatomy. Rejected frames remained unavailable. Saving reviewed selection persisted the chosen person and published only that person's progress. A client Sessions page now includes assessment sessions as well as completed practice.

C — Admin: switched within the same demo organization, verified 34 clients, four coaches and four locations. Paged assessment records 51–100 of 204. Created Integration test studio and Movement room, assigned Hana and Sarah; location displayed one coach and one client. Role conversion, deletion and organization boundary behavior are verified through actual repository/HTTP integration tests, not merely the form's existence.

D — Student: selected Sarah's student role in the same demo organization. Verified simplified navigation, own program/exercise instructions and linked notes, progress controls/history and own schedule. Server tests reject other clients, staff inspection and editing. Actual My Body rendering shares the WebGL verification limitation.

Scans — Uploaded a **two-frame DICOM calibration pattern, explicitly not a patient scan**, linked to Sarah's real video. Changed window width from 4096 to 1024 and frame from 0 to 1. Clicked the displayed image and saved an annotation; the table persisted region, text and frame 1. Original media, source analysis, region and coach-note links stayed client-scoped. Window/frame query state now survives annotation-save refresh. Public demo radiographs are attributed and mapped to each scenario's region.

## Performance and limits

A 600-second local sample around the earlier real video analysis recorded **460.2 MB peak RSS**, no health failures and **0.017 s maximum health-response time**. The current free-host configuration uses the published smaller RTMO-s model and samples slow movement at 3 fps; a real 5.93-second clip still produced 16 suitable tracked frames and five independent depth estimates, peaking at **310.3 MB RSS** locally. On Render, the same clip completed twice in approximately 51 seconds while all concurrent health requests returned 200. Exact hosted RSS is not exposed; longer or crowded clips need separate capacity testing. Models load lazily after the server binds and are released after jobs. Uploads stream into bounded authenticated files, inference has one worker and a bounded queue, status is polled independently, and missing media/formats/visibility yield actionable errors.

The existing Render free service uses an ephemeral `/tmp` database. Organization backup/restore is implemented and tested, including media and foreign-key remapping. The platform reports ephemeral storage. **Permanent cloud history across Render restarts/deploys has not been provisioned.** A persistent disk or external storage arrangement requires an authorized hosting configuration; a manual backup is not equivalent to permanent server storage.

The in-app browser reports WebGL context creation failure. The atlas has actual mappings, bridge code, layers and contextual notes; mathematical/content tests pass and the UI fallback was verified. **Do not infer visual success from those tests.** Browser rendering, layer changes and highlighted structures require a working WebGL surface before items 21/23/40/43 can be fully signed off.

## Hosted checks

The new application was released on the original Render service. Login/role pages and coach/client history were inspected in the browser, and actual hosted photo/video jobs were run through the authenticated platform API. Build success alone was never counted as analysis success.

### First hosted release and startup correction

Render deployment `6596089102` succeeded at `2026-09-22T16:56:44Z`; the public
capability endpoint confirms commit `c3dd3e16a1f9adbe9ad3d6601e244274b7d2d7c0`.
The new login screen is live. Fresh demo initialization exceeded the hosted
request timeout, so this is not recorded as a successful full workflow.

A measured correction precomputes only the labelled synthetic scenario geometry,
checks its source fingerprint, and inserts all linked demo rows atomically.
Real inference is unchanged. All 36 cached scenarios are compared against the
current geometry/temporal calculations; transaction rollback and cross-thread
visibility are tested. Seed profiling improved from **24.87 s to 4.94 s** locally
(29.9 million calls to 325 thousand), while preserving 204 historical analyses.
Platform regression: 16 tests passed before correcting a test's tuple-vs-JSON
array comparison; the corrected scenario test then passed (17 total).

### Hosted photo and free-tier video memory correction

On commit `3e74e0b102b084830fff70bfc8f8dedcedfe756d`, Render created the
coach demo and served Sarah's linked history and schedule. An uploaded real
front photograph (`male_full_height_hands.jpg`) completed in **51.48 s** as
analysis `56ccdb6497f64a20b77f0e74fedd5761`. Person 1 passed the body gate;
its independent 3D pose was estimated, its 40 coordinates were retrieved, the
coach review succeeded, and the analysis appeared in Sarah's history.

A real `tree-demo.mp4` upload started processing, but the free instance briefly
returned 502 and restarted the job. The server marked it failed on restart.
This run is not counted as hosted video success. The likely pressure is running
RTMO and the optional independent depth model at the same time, near the 512 MB
ceiling; exact hosted RSS is unavailable through the current service.

The video pipeline now finishes RTMO tracking first, retains sparse JPEG frames
for independent depth, releases the RTMO session and native allocations, then
loads the depth model. A real local repeat of the same 5.93-second clip found
34 frames for the suitable person and **five independently estimated depth
frames**, with a **273.9 MB peak RSS**, down from the prior 460.2 MB. The
48 relevant evidence/platform regression tests passed. A first hosted retest on `b475eaa` still restarted during video, so this optimization alone did not satisfy the hosted workflow.

### Hosted video success on the existing service

Commit `102b8e161eba680a06d2b86c21a137f507fbd4ef` reached successful Render deployment `6610040255` on the original `pilates-yoga-j1kz` service. It selects RTMO-s and 3 fps on Render while keeping the full 12-second demonstration history at 31 observations. A fresh demo studio now occupies **68.08 MiB** of local SQLite storage, down from roughly 110 MiB. The 48 focused tests passed after rebuilding and fingerprint-checking all 36 scenarios.

Under coach Hana in demo organization `demo-3d4d94e8ce3e4515874e3353b805452f`, a real front photograph completed in **32.07 s** as analysis `afb822474b9d40aeb20df7c1c318c0cf`. Person 1 was suitable, RTMO-s identified 26 photo metrics, the independent depth status was `estimated`, 40 coordinate rows were available, and review saved the report in Sarah's history.

The real `tree-demo.mp4` clip completed **twice in succession** in **51.13 s** and **51.34 s** as analyses `282a3a0f4c9c4467b262986bb711b4a8` and `5f6be3fb4d294072b071aa71f454d829`. Each identified a suitable person with 16 retained frames, five independently estimated depth frames, nine joint-angle signals with temporal derivatives, and 640 coordinate rows. A second detected person remained unsuitable. Coach review of person 1 succeeded; both sessions appeared in Sarah's history and increased her progress records. During the three jobs, all **13** sampled health requests returned HTTP 200; the slowest took **1.645 s**. The public capability endpoint returned the deployed SHA. Verification captures and machine-readable results are kept outside Git under `../hosted-platform-verification.json`.

A separate coach-browser journey on the same deployed service opened Sarah's client hub, her movement report, and the before/after comparison for matching shoulder-flexion sessions. It displayed two stored skeletons, linked labelled illustration panels, and left/right shoulder ROM changes of **+12.4° / +17.1°** from simulated coordinates. Those demo changes are intentionally labelled synthetic and do not imply treatment effect. The WebGL visual check and permanent storage remain open below.

### Three-organization capacity correction and live browser uploads

The first direct browser upload after the `102b8e1` API check ran with another
demonstration organization in memory. The free service became unavailable and
restarted; the saved API reports were then absent from the same demo account.
This failed run is evidence against claiming either broad capacity or hosted
durability from the earlier API success. The exact hosted memory peak is not
available from this service.

For commit `5005f8528c8eac9f1c79c17786b7237f7dd718ed`, the synthetic seed
retains the complete six-visit history for all 34 demo clients but reduces each
12-second synthetic movement series from 31 to 21 samples. This is labelled
simulation; the real inference sampling remains 3 fps. A fresh local demo
organization occupies **49.83 MiB** of SQLite storage. Three organizations
plus a real photograph and two consecutive real videos completed inside a
**512 MB / 15% CPU** local service scope, peaking at **441 MB cgroup use**.
The 63 focused evidence/platform/capacity tests passed. Commit `5005f85`
deployed successfully as Render deployment `6615390921`; the public capability
endpoint confirmed the exact commit and `RTMO-s`.

Using the deployed browser UI with three seeded organizations, coach Hana
selected existing client Sarah, chose Standing balance/front, uploaded the real
`tree-demo.mp4` clip and waited for processing. Report
`a39b2d561d0e4637af6821b7d100a271` opened; person 1 was suitable and
coach review saved it to Sarah. The coordinate panel displayed image X/Y and
estimated 3D X/Y/Z with confidence and frame/time, including explicit missing
values. The movement panel showed angle, velocity and acceleration charts.
The same browser workflow completed again as report
`55f93b3d6208449bbb5699210430c34b`, was reviewed, and offered the first
real session under Compare visits. The comparison showed two skeletons and
matching ROM rows; because the same clip was uploaded twice, the observed
differences were 0°. Browser health probes during the first upload returned
HTTP 200; the slowest sample took 5.57 seconds. These are successful tested
short-clip workflows, not a guarantee for longer or crowded videos.

On the next day, that browser session no longer authenticated. After opening
the **same** demo key again, Sarah's Analysis tab showed only the six seeded
synthetic sessions; both reviewed real reports were gone. This directly proves
that the current free Render instance does **not** preserve real client history
through its restart/idle cycle. A sign-in UI correction now routes expired
sessions back to the welcome screen instead of leaving a client-record error.
Requirement #5 remains open until a durable backend is provisioned and tested
across a redeploy. The WebGL anatomy visual checks remain open independently.
