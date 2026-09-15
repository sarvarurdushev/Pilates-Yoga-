# Render deployment

The existing Python service continues to use `pip install -r requirements.txt`
and `python -m pilates web --host 0.0.0.0 --db /tmp/studio.db`.
No frontend build is required: the Python server serves `web/`, including the
new Motion Study homepage and the preserved `/anatomy.html` reference viewer.

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
capacity guarantee for concurrent uploads or large videos.

`GET /evidence/capabilities` exposes the actual `RENDER_GIT_COMMIT`, enabled
features and deployment platform, so a live release can be distinguished from
an old build. `PILATES_REQUIRE_AUTH` defaults to `0`, as requested for the MVP.
This is a shared demonstration workspace: saved reports are accessible to its
visitors. Uploaded media is processed on the server and discarded after use.

The existing `/tmp/studio.db` is ephemeral. Render restarts, redeploys and free
service spin-downs clear history. Export reports for retention; durable studio
history requires persistent storage. No paid resources are provisioned by this
change.

Render references: [environment variables](https://render.com/docs/environment-variables),
[deployment behavior](https://render.com/docs/deploy-flask),
[free service storage](https://render.com/docs/free).
