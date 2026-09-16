# Render deployment

The existing Python service continues to use `pip install -r requirements.txt`
and `python -m pilates web --host 0.0.0.0 --db /tmp/studio.db`.
No frontend build is required: the Python server serves `web/`, including the
unified Motion Yoga studio and the preserved `/anatomy.html` reference viewer.

The deployment branch is `claude/multi-person-pilates-analysis-w28tt0`.
The service URL is https://pilates-yoga-j1kz.onrender.com (the character after
`j` is the digit `1`). Render auto-deploys pushes to this branch.

`requirements.txt` includes MediaPipe 0.10.32. When `RENDER=true`, startup
downloads the pinned 9 MB Pose Landmarker Full weights into the cache and checks
SHA-256 before advertising 3D availability. A failed download keeps 2D available.
An explicit `PILATES_3D_MODEL` takes precedence. RTMO-m keeps its existing
download/cache behavior. CPU inference uses one thread on Render and avoids
retaining ORT scratch buffers between requests. A repeated real standing-photo
check with both models peaked at approximately 434 MiB locally; this is not a
capacity guarantee for large videos. Photo and video assessments share RTMO
weights, use one video decoding thread, and admit one assessment at a time.
A real photo followed by a six-second video peaked at approximately 444 MiB
locally. Job-status and health requests remain available during analysis.

`GET /evidence/capabilities` exposes the actual `RENDER_GIT_COMMIT`, enabled
features and deployment platform, so a live release can be distinguished from
an old build. `PILATES_REQUIRE_AUTH` defaults to `0`, as requested for the MVP.
The new studio uses a random browser-held workspace capability. Demo and personal
records are stored separately in SQLite; this login-free preview is not a
production account-security system. Uploaded media is processed on the server
and discarded after use. Original media and a copy of reports remain in the
browser IndexedDB, with full backup and restore in Settings. Legacy evidence
API behavior is unchanged, but its duplicate UI is no longer in the main flow.

The existing `/tmp/studio.db` is ephemeral. Render restarts, redeploys and free
service spin-downs clear history. Browser copies survive those resets on the same device. Export a full backup
before clearing browser data or changing devices. Durable cloud history requires
persistent storage. No paid resources are provisioned by this
change.

Render references: [environment variables](https://render.com/docs/environment-variables),
[deployment behavior](https://render.com/docs/deploy-flask),
[free service storage](https://render.com/docs/free).


## Studio workflow (September 2026)

The homepage is `web/index.html`, loading `web/src/studio/app.js` directly.
`POST /studio/analyse` queues 1–4 photo views; `/studio/video` streams a clip
to a temporary file. Both return 202 with an id. `/studio/job?id=...` returns
progress, a structured failure, or the saved report. The queue admits at most
two pending/running jobs and runs one at a time. `/studio/state` and
`/studio/save` use `X-Studio-Workspace`; unknown workspaces cannot read another
workspace's jobs. All new studio endpoints are disabled in legacy authenticated
mode. `--no-analyse` disables new analysis submissions.

Demo seeds are reproducible with `python tools/seed_studio_demo.py`. New
assessments in the UI always use the personal workspace. The educational anatomy
viewer remains at `/anatomy.html`; old session tools require an explicit legacy
or archived-session URL.
