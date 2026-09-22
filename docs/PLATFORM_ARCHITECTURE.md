# Connected platform architecture — September 17, 2026

## Audit before implementation

The deployed branch is claude/multi-person-pilates-analysis-w28tt0 and the most recent completed GitHub deployment is e667990. The live commit and service health will be checked again at release. There is no newer local branch. Screenshots show an actual Render 502 and app bootstrap depending on an available /studio/state endpoint; this must be handled at service and UI levels.

Three independent historical paths coexist: legacy role-scoped Store/API, the newer /evidence report pipeline, and the last /studio JSON-workspace application. The last path bypasses roles, serializes a complete workspace, starts capture in a different workspace, and cannot connect anatomy to an analysis. It has six immutable exercises, two generic generated images, no location entities or controlled staff assignments, and no durable authenticated media records. The role code has useful password/session principles but its location-membership rules differ from this specification's organization-wide administrator.

Keep RTMO, visibility validation, tracking, alignment/angle definitions, temporal signal filtering, independent MediaPipe corroboration, the complete Three.js atlas, and meaningful regression tests. Keep legacy endpoints on their own data for compatibility; never make them an alternate route to the new platform's protected records.

## Relational domain and access

Use versioned SQLite tables with foreign keys, cascading dependent records, indexes and transactions. An organization isolates demo from real data. Users have role memberships plus coach/student profiles; locations, rooms, equipment, coach-location, student-location and coach-student assignments are explicit relationships. The platform server authenticates each request; a frontend role selector never grants real privileges. A demo login creates an isolated seeded organization whose role choices cannot access any real organization. Real organization creation gives its creator administration of that new organization only. Demo data remains marked at row, session, export and page levels.

Coach scope is the assigned student set, not all students at a location. Student scope is self; admin scope is the whole organization. These rules apply to media bytes, sessions, coordinates, scans, jobs, mutations and exports as well as list screens. Roles can be changed transactionally without orphaning records. Deleting people/locations resolves or removes their dependent relationships; retain intentional unassigned states rather than dangling IDs.

Separate records: Program, ProgramExercise, Exercise, ExerciseMedia, ExerciseResource, Reservation, TrainingSession, AnalysisSession, ImageAnalysis, VideoAnalysis, PoseFrame, BodyLandmark, BodyCoordinate, JointMeasurement, MovementAnalysis, ROMMeasurement, SymmetryMeasurement, PostureMeasurement, AnatomicalRegion, AnatomicalObservation, CoachNote, Scan, ScanFinding, Equipment and ProgressRecord. JSON is appropriate for immutable algorithm output/configuration, not for holding all organization relationships.

## Application and client context

A global role-aware sidebar surrounds a persistent client header and 11 client tabs. Route/query state holds student_id, analysis_id and region_id; contextual links carry these IDs. No capture flow silently switches to another workspace. Coach and admin can select existing students; student routes always bind to the signed-in profile. Shared programs/exercises are separate from per-student assignments and exercise prescriptions.

## Analysis and anatomy

Upload assets into authenticated records, then queue bounded jobs by existing student and protocol. One inference worker processes at a time; progress and health remain responsive. Reduce memory pressure and release models after work; benchmark concurrent dashboard/inference requests and cold start. Upload progress is separate from processing progress. Refusals retain the source, reason and history, never a fabricated success score.

RTMO supplies 2D pixels, MediaPipe supplies corroborated estimated XYZ where valid. Derived neck/pelvis/spine centers must state their construction and are not vertebral landmarks. Store coordinate systems, confidence, frame and timestamp. Temporal derivatives require continuous valid samples; no bridging gaps or arbitrary Z. Tables/interactive traces expose unavailable dimensions. Posture and movement observations map to seeded anatomical regions and actual atlas FMA structures; iframe messages validate origin, preserve client/session context, highlight structures and show associated notes/scan links. Region mappings explain relevance and do not infer muscle activation.

## Scans and content

Authenticated media supports photo/video and DICOM (pydicom) with explicit supported transfer syntaxes, metadata selection, windowing/frame display and non-destructive coordinate annotations. Scans belong to students and link regions, analyses and notes. Use the existing licensed atlas for muscle/bone overlays and reference correlation; do not infer radiology from ordinary photographs. Coaches own editable exercise content and optional resources. Uploads are validated and stored outside static paths with role checks on every retrieval.

## Demo and deployment

Seed four locations, four coaches and 34 diverse students with assignments, reservations, substantial unique exercise content, programs and six historical sessions each. Before/after imagery is fictional and each fixture explicitly belongs to its scenario/session. Synthetic coordinates and histories are computed consistently from scenario pose fixtures; real uploads always invoke the actual engine, even under a demo account. The demo does not prove clinical improvement.

Retain existing Render service and branch. Configure storage through a database/media directory and provide organization backup/restore; the current free Render filesystem is ephemeral, so do not claim permanent cloud storage without provisioning it. No paid resource is implicitly authorized. Boot must not download ML weights before binding the health endpoint. Record release SHA, actual hosted jobs and each of journeys A–D. Update the 1–44 checklist only with concrete evidence.

## Implementation order

1. Schema, migrations, authenticated roles, scoped repository and deletion rules.
2. Client context, organizations/locations, dashboards, search and reservations.
3. Exercise/media/resource CRUD, program builder and equipment requirements.
4. Analysis persistence, coordinate tables, temporal metrics and guided capture.
5. Atlas mapping/highlights and shared anatomical notes.
6. Scan/DICOM viewing, annotations and cross-links.
7. Diverse generated demo assets, coherent longitudinal fixture data.
8. Integration/security journeys, memory/performance, browser QA and Render verification.
