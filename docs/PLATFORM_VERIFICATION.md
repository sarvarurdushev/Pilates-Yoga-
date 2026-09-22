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

A 600-second local sample around real video analysis recorded **460.2 MB peak RSS**, no health failures and **0.017 s maximum health-response time**. This does not establish hosted memory or CPU performance. Models load lazily after the server binds and are released after jobs. Uploads stream into bounded authenticated files, inference has one worker and a bounded queue, status is polled independently, and missing media/formats/visibility yield actionable errors.

The existing Render free service uses an ephemeral `/tmp` database. Organization backup/restore is implemented and tested, including media and foreign-key remapping. The platform reports ephemeral storage. **Permanent cloud history across Render restarts/deploys has not been provisioned.** A persistent disk or external storage arrangement requires an authorized hosting configuration; a manual backup is not equivalent to permanent server storage.

The in-app browser reports WebGL context creation failure. The atlas has actual mappings, bridge code, layers and contextual notes; mathematical/content tests pass and the UI fallback was verified. **Do not infer visual success from those tests.** Browser rendering, layer changes and highlighted structures require a working WebGL surface before items 21/23/40/43 can be fully signed off.

## Hosted checks

Pending release: record the new SHA, GitHub/Render deployment status, public capabilities, login/role pages, and real hosted photo/video jobs. A build success alone is not a successful analysis deployment.
