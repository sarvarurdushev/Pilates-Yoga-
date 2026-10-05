# Render deployment

The existing Python service continues to use `pip install -r requirements.txt`
and `python -m pilates web --host 0.0.0.0 --db /tmp/studio.db`.
No frontend build is required: the Python server serves `web/`, including the
unified Motion Yoga studio and the preserved `/anatomy.html` reference viewer.

The deployment branch is `claude/multi-person-pilates-analysis-w28tt0`.
The service URL is https://pilates-yoga-j1kz.onrender.com (the character after
`j` is the digit `1`). Render auto-deploys pushes to this branch.

`requirements.txt` includes MediaPipe 0.10.32. On an analysis-enabled Render
start, the server fetches the pinned Pose Landmarker Full weights before binding
its HTTP port, verifies SHA-256, and sets the model path before the first
`/evidence/capabilities` response. The model is not loaded into memory until an
assessment requests depth. A failed fetch leaves 2D analysis available and
reports `three_d: false`; it is not retried for every assessment. Render's free
filesystem is ephemeral, so a cold instance must prepare the asset again. An
explicit `PILATES_3D_MODEL` takes precedence. Capability reports the verified
asset's presence, while a particular photograph may still fail the independent
model's visibility and 2D-agreement checks. RTMO-s keeps its existing
download/cache behavior. CPU inference uses one thread on Render and avoids
retaining ORT scratch buffers between requests. A repeated real standing-photo
check with both models peaked at approximately 434 MiB locally; this is not a
capacity guarantee for large videos. Photo and video assessments share RTMO
weights, use one video decoding thread, and admit one assessment at a time.
A real photo followed by a six-second video peaked at approximately 444 MiB
locally. Job-status and health requests remain available during analysis.

`GET /evidence/capabilities` exposes the actual `RENDER_GIT_COMMIT`, enabled
features and deployment platform, so a live release can be distinguished from
an old build. The current homepage loads `web/src/platform/app.js` and uses
`/platform/` routes. Real organizations sign in with a server-issued session
cookie; Coach, Student and Admin records are scoped by the repository. Demo
organizations and generated illustration media are explicitly labelled. An
original photo, video or scan saved through the connected platform is stored in
SQLite metadata plus the adjacent `<db path>.media` directory on the server,
not in browser IndexedDB. Platform Admin → Storage & recovery exports an
organization archive that includes its records and media but excludes password
hashes and session tokens. `PILATES_REQUIRE_AUTH=0` is the default for the
older `/evidence/` API and does not disable connected-platform sign-in.
The older `/studio/` workspace routes still exist, but are not the homepage.

The existing `/tmp/studio.db` is ephemeral. Render restarts, redeploys and free
service spin-downs clear connected-platform records and uploads. The older
`/studio/` preview kept some local browser copies, but that is not a recovery
mechanism for the connected-platform organization. Export and verify an Admin
archive for each real organization before any deploy. Durable cloud history
requires persistent storage. No paid resources are provisioned by this change.

Render references: [environment variables](https://render.com/docs/environment-variables),
[deployment behavior](https://render.com/docs/deploy-flask),
[free service storage](https://render.com/docs/free).


## Older `/studio/` workflow (not the current homepage)

`web/index.html` now loads `web/src/platform/app.js`. The older
`POST /studio/analyse` endpoint queues 1–4 photo views; `/studio/video` streams a clip
to a temporary file. Both return 202 with an id. `/studio/job?id=...` returns
progress, a structured failure, or the saved report. The queue admits at most
two pending/running jobs and runs one at a time. `/studio/state` and
`/studio/save` use `X-Studio-Workspace`; unknown workspaces cannot read another
workspace's jobs. All new studio endpoints are disabled in legacy authenticated
mode. `--no-analyse` disables new analysis submissions.

The older workspace demo seed is reproducible with
`python tools/seed_studio_demo.py`; it does not seed the connected-platform
organizations. Connected-platform demonstration organizations are provisioned
through the current demo sign-in and `pilates.platform.seed`. New assessments
in the homepage go to the signed-in organization and its server-side database.
The educational anatomy viewer remains at `/anatomy.html`; old session tools
require an explicit legacy or archived-session URL.
