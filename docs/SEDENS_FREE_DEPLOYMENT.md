# SEDENS on free hosting

Scope: how this branch behaves on a free host (the `demo_free` mode), what Phase 2 adds to that, what an operator must know before deploying it, and what is deliberately not done. Mode selection itself is in `docs/SEDENS_DEPLOYMENT_MODES.md`.

**Nothing has been deployed by this work.** The existing Render service (`srv-daf50ov40ujc739kfh4g`, branch `claude/multi-person-pilates-analysis-w28tt0`) is untouched and keeps serving the original branch. Deploying this branch is an owner decision; the plan is a **second** free Render service pointed at `claude/sedens-ai-private-room-v1`, never switching the existing one.

## 1. What the free host is

| | Render free |
|---|---|
| CPU and memory | 0.1 CPU, 512 MB |
| Disk | none that survives: the filesystem is lost on every restart, redeploy or spin-down (after about fifteen minutes without requests) |
| Start command | `sh deploy/render-start.sh`: `python -m pilates web --host 0.0.0.0 --db ${STUDIO_DB_PATH:-/tmp/studio.db}` |
| Mode | `demo_free`, chosen automatically because Render sets `RENDER=true` (or forced with `SEDENS_MODE=demo_free`) |

`demo_free` never reports storage as persistent. Every SEDENS page shows "Demonstration storage: records and uploads can be erased whenever this server restarts."

## 2. No credentials, no paid services

The branch runs with **no secrets and no API keys**:

- No payment provider: purchases are simulated (`DemoPaymentProvider`) and only in demonstration organizations; elsewhere they answer `payments_unavailable`. No card data exists anywhere.
- No video generation: `HiggsfieldVideoProvider` is disabled, reads no key, and refuses with `provider_disabled`.
- No stock downloads: the stock sources have `auto_download: false` and the import manifest is empty.
- No CRM vendor: the `demo` CRM adapter is simulated and refused for real facilities.
- No object storage, database service, analytics or e-mail service: one Python process, SQLite and the local filesystem.

The test suites and the app need none of these either.

## 3. What Phase 2 stores, and where

Everything lives next to the database file, so on the free host everything is in `/tmp` and disappears together:

| What | Where |
|---|---|
| Courses, versions, reviews, facility settings, purchases (simulated), entitlements, enrollments, progress | the SQLite database (`s_*` tables, migrations 0009–0012) |
| Uploaded course files | `<database>.sedens-media/objects/<org>/…`, folders `0700`, files `0600`, never under `web/` |
| Files being received | `<database>.sedens-media/incoming/` (removed on failure) |
| Course imports being received | a temporary file, removed after the import |
| Room journeys, readiness checks, scan summaries, plans, workouts, effort and discomfort reports (Phase 3) | the SQLite database (migrations 0015–0018) |
| Room scan photos (real analysis only) | `<database>.sedens-media/scans/<org>/<scan>/`, folders `0700`, files `0600`; deleted when the analysis finishes or the scan is abandoned, unless the customer agreed to keep them |

## 4. Limits on the free host

The free host keeps every upload small, and the limits are enforced on the server from the request's declared length before the body is read:

| | `demo_free` | `local_room` (room computer) |
|---|---|---|
| Video (MP4, WebM) | 25 MB | 300 MB |
| Picture (JPEG, PNG, WebP; at most 16 megapixels, re-encoded) | 8 MB | 12 MB |
| PDF | 10 MB | 25 MB |
| Course import (as sent and as unpacked) | 60 MB | 400 MB |

Shared by both modes: at most two uploads or imports received at once (`uploads_busy`, 429); at most 12 uploads or imports per minute per address, 10 demonstration entries per minute per address (`rate_limited`, 429). Files are streamed to disk in 64 KB blocks, never held whole in memory. Videos are not transcoded (that would not fit in 0.1 CPU).

### The room scan on the free host (Phase 3)

- The default scan is the **DEMO PRECOMPUTED ANALYSIS**: the camera guidance runs in the browser, no photo is uploaded and the result appears at once.
- The optional **EXPERIMENTAL REAL ANALYSIS** uploads four photos (JPEG or PNG, at most 8 MB each, 12 uploads per minute per address) and runs the existing pipeline once per photo, one scan at a time on the server. Measured on Render free at 33.2 s for one photo in the platform verification of 2026-10-05 (before SEDENS began), so about two minutes for a scan; the screen says so before the customer chooses it, shows a waiting screen, and lets them skip to choosing a session.
- The workout itself needs no server computation: steps, narration (the browser's own voice, captions always), music (generated in the browser) and the anatomy viewer are all local files or browser features.

### Room timings (Phase 3)

Measured locally in `demo_free` mode with `web/test/sedens-room-performance.browser.mjs` (software WebGL, no GPU; the free host itself was not measured because nothing was deployed). The full table is in `docs/SEDENS_PHASE_3_REPORT.md` §4.
- The room screen loads in about 0.2 s (143 kB). The anatomy atlas is not loaded until the player opens: about 4 s and 5.5 MB from accepting a plan, then about 2.3 MB more while the plan is read for the atlas layers the first exercise uses (the viewer loads whole layers, not single structures).
- A new visitor's demonstration entry takes several seconds while the server builds the fictional facility (slower on the free tier's CPU); it happens once per visitor.
- The demonstration scan result is instant (precomputed, nothing uploaded).
- In software WebGL each redraw of the anatomy viewer costs 200–300 ms on the page's thread, and every change the room sends asks for at least three redraws, so a step change took up to about a second (about 70 ms without the viewer); an idle viewer also redraws twice a second as a safeguard. Check this on the real room computer.

## 5. Demonstrations on the free host

Each visitor who opens a demonstration gets their own isolated set of organizations (`demo-<key>`): the facility "SEDENS Demo Fitness Center" with its customers, coaches and simulated room screen, the coaching workspace's sample data, and the Phase 2 marketplace (three courses, a fictional coach, a fictional professor, a fictional reviewer; `docs/SEDENS_MARKETPLACE_MODEL.md` §11). Nothing one visitor does is visible to another.

Measured on a development machine (`SEDENS_MODE=demo_free`, a fresh database): entering a new demonstration takes about **5–6 seconds** and adds about **76 MB** to the database. Almost all of that is the coaching workspace's sample analyses (`p_coordinates`, `p_analyses`, `p_movement_analyses`, `p_video_analyses`), which predate SEDENS; all SEDENS tables together, the Phase 2 marketplace included, add about 240 rows and no files (the one picture is a repository illustration read from the repository). On 0.1 CPU the first entry will be slower than measured here; the SEDENS home shows "Preparing the demonstration. The first opening can take a minute." meanwhile and reconnects if the host answers with a gateway error while waking up (`web/test/platform-demo-auth.browser.mjs`).

### Unused demonstrations are removed (Phase 2.5)

`pilates/sedens/demo_cleanup.py` removes demonstrations nobody has used for **`SEDENS_DEMO_TTL_HOURS`** (default **6** in `demo_free`; in `local_room` only when the variable is set; `0` switches it off; values under an hour count as an hour).

- **Creation and last use.** `s_demo_activity` (migration `0014_demo_activity.sql`) records each demonstration key's creation and last use. Every signed-in request of a demonstration account passes through `Repository.actor`, whose optional observer writes the last use at most once every 5 minutes per key. A demonstration with no row yet counts from its organizations' creation time.
- **What may be removed.** Only organizations flagged `demo` **and** named `demo-<32 hex characters>` (with `-sedens` or `-professor` for the marketplace's two). Both are checked again inside the deleting transaction. A real organization is never considered, even one whose id happens to look like a demonstration's or one flagged by mistake (`tests/test_sedens_demo_cleanup.py::test_real_organizations_are_never_cleaned_even_when_named_or_flagged_like_one`).
- **What keeps a demonstration.** Use within the time-to-live, an active room session, a queued or running analysis job, or any course upload or import being received. Any refusal by the database (for example a real program pointing at a demonstration exercise) rolls the whole demonstration back and it stays.
- **What is removed.** The demonstration's three organizations and everything that cascades from them (the two `RESTRICT` program links are removed first), its workspace media files and its course-file folder. The database is left consistent (`PRAGMA foreign_key_check` is empty).
- **When.** Once at start-up, then at most every 15 minutes, triggered by demonstration use and run once in a short-lived thread; no permanent background thread. At most 3 demonstrations go per sweep, so each sweep stays short.
- **Logging.** One line per removal with the demonstration key and the approximate organizations, records, files and megabytes reclaimed. Never names or other content.

A restart still removes everything on the free host, since its database lives in `/tmp`.

## 6. Keeping work on a host that forgets

A creator or facility using the free host must assume everything can vanish:

- **Course export** (`#/creator/courses/:course`, Export, import, archive): one course as a ZIP with its files, versions, anatomy, access and price, and a checksummed manifest. Importing it later creates a new draft that SEDENS reviews again. Details: `docs/SEDENS_MARKETPLACE_MODEL.md` §10.
- **Organization backup** (`docs/SEDENS_BACKUP_RESTORE.md`): the whole organization, SEDENS records and course files included. A restore returns published courses, file rights and creator verification to SEDENS review, and never brings back simulated purchases into another organization.

For durable records, run on a machine with a persistent disk (`local_room` with the database outside `/tmp`), or a paid host with a mounted disk and `STUDIO_DB_PATH` on it (`render.yaml` explains the options). `cloud_production` refuses to start until durable storage, secrets and monitoring exist.

## 7. Before deploying this branch on a second free service

An owner who decides to deploy should know:

1. Create a **new** free web service from this branch with the same start command; do not change the existing service or its branch.
2. No environment variables are required. `SEDENS_MODE` may be left unset (Render sets `RENDER=true`).
3. Everything resets on each restart: demonstrations, creator courses, uploads. Say so to anyone invited to try it.
4. Only demonstrations can buy (simulated). A real facility or creator account on the free host can build and review courses but cannot sell them.
5. The room runs the whole Phase 3 journey: readiness, the scan (demonstration by default), a SEDENS Personalized Session or a course, the player with its anatomy viewer, completion and feedback. The SEDENS Standard exercises are unreviewed demonstration content and say so on screen.

## 8. What would change with money

None of this is planned without the owner's decision; each needs a paid service or a contract:

| Need | Free today | Would require |
|---|---|---|
| Records that survive restarts | `/tmp` SQLite | a persistent disk, or a managed database |
| Course files that survive restarts | `<database>.sedens-media` on the same disk | a persistent disk, or object storage behind `media_store` |
| Faster demonstrations and real video analysis | 0.1 CPU | a larger instance, or the facility's own room computer |
| Real purchases | none | a payment provider contract (`docs/SEDENS_FUTURE_INTEGRATIONS.md`) |
