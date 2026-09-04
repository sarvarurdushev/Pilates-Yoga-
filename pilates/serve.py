"""Serve the anatomy application, with one person's session and a way to record.

The application is a static site, which is most of what it is good for: it opens
from a folder, it works offline, and nothing about it needs a server except the
browser's refusal to fetch modules and model files over ``file://``. So this is a
plain static server plus three routes that are not files.

``/session.json``   the loaded bundle, served from memory
``/capabilities``   what this server can do, so the page can hide what it cannot
``/analyse``        a clip, uploaded; returns a job id
``/job/<id>``       how that job is going, and the bundle when it is done

**Nothing is written into the site directory.** A bundle is somebody's health
data; writing it next to the code so that it can be served is how it ends up
committed. Uploaded clips live in a temporary directory for exactly as long as
the analysis takes.

**Bound to localhost by default, and that is a decision.** This server accepts a
video and runs a pipeline over it. On a studio machine that is exactly right; on
an open interface it is an upload endpoint with no authentication in front of it.
``--host 0.0.0.0`` opens it deliberately, which is what a hosted deployment
needs, and what a studio serving the room needs a proxy in front of.

**A hosted deployment is a real trade, not a free upgrade.** Running the
analysis in a data centre means video of people leaves the building, which is
the one thing this design is otherwise built to avoid: the clip is deleted after
analysis, but it still travelled. Local is the honest default and the reason
`pilates web` exists at all. Hosting is for showing the thing to somebody who
has not installed it.
"""
from __future__ import annotations

import json
import mimetypes
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from .analysis_jobs import MAX_UPLOAD_BYTES, Jobs

#: The application root, inside this repository.
WEB = Path(__file__).resolve().parent.parent / "web"

SESSION_ROUTE = "/session.json"

# .glb is the format every model in the site is in, and Python does not know it.
# Served as the wrong type, the loader refuses them and the body never appears.
mimetypes.add_type("model/gltf-binary", ".glb")
mimetypes.add_type("text/javascript", ".mjs")


class Handler(SimpleHTTPRequestHandler):
    """Static files, plus the few things that are not files."""

    bundle: dict | None = None
    jobs: Jobs | None = None

    # -- helpers ----------------------------------------------------------
    def _json(self, payload: dict, status: int = 200) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        # A session is one person's health data. Nothing about it should sit in
        # a cache that outlives the window it was opened in.
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    # -- routes -----------------------------------------------------------
    def do_GET(self):  # noqa: N802 - the base class names it
        route = urlparse(self.path)
        if route.path == SESSION_ROUTE:
            if self.bundle is None:
                self._json({"error": "no session was loaded"}, 404)
                return
            self._json(self.bundle)
            return
        if route.path == "/capabilities":
            # The page asks before it offers a record button. On a static host
            # this 404s, the button never appears, and the site is honest about
            # being a viewer rather than pretending it can analyse anything.
            self._json({"analyse": self.jobs is not None,
                        "max_upload_bytes": MAX_UPLOAD_BYTES,
                        "session": self.bundle is not None})
            return
        if route.path.startswith("/job/") and self.jobs is not None:
            job = self.jobs.get(route.path[len("/job/"):])
            if job is None:
                self._json({"error": "no such job"}, 404)
                return
            self._json(job.public())
            return
        super().do_GET()

    def do_POST(self):  # noqa: N802
        route = urlparse(self.path)
        if route.path != "/analyse" or self.jobs is None:
            self._json({"error": "not here"}, 404)
            return

        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            self._json({"error": "no clip in the request"}, 400)
            return
        if length > MAX_UPLOAD_BYTES:
            self._json({"error": f"clip is {length / 1e6:.0f} MB; the limit is "
                                 f"{MAX_UPLOAD_BYTES / 1e6:.0f} MB"}, 413)
            return
        if self.jobs.running() is not None:
            # One at a time: the pipeline saturates the cores, so two clips at
            # once is both of them taking twice as long.
            self._json({"error": "another clip is being analysed"}, 409)
            return

        options = {k: v[0] for k, v in parse_qs(route.query).items()}
        data = self.rfile.read(length)
        job = self.jobs.submit(data, self.headers.get("X-Filename", "clip.mp4"),
                               options)
        self._json(job.public(), 202)

    def log_message(self, *args):
        """Quiet. The interesting output is the URL, printed once."""


def serve(bundle: dict | None, root: Path = WEB, port: int = 8000,
          host: str = "127.0.0.1", analyse: bool = False):
    """Start the server and return it with the URL to open.

    A platform that hands out the port in ``$PORT`` -- Render, Fly, Heroku and
    most others -- is honoured when no port was asked for explicitly, because a
    service that ignores it never receives a request and is reported as failing
    its health check with nothing in the log to say why.
    """
    import os

    if port == 8000 and os.environ.get("PORT"):
        port = int(os.environ["PORT"])
    handler = partial(Handler, directory=str(root))
    Handler.bundle = bundle
    Handler.jobs = Jobs() if analyse else None
    server = ThreadingHTTPServer((host, port), handler)
    url = f"http://{host}:{server.server_address[1]}/index.html"
    if bundle is not None:
        url += f"?session={SESSION_ROUTE}"
    return server, url


def run(bundle: dict | None, root: Path = WEB, port: int = 8000,
        analyse: bool = False, host: str = "127.0.0.1") -> str:
    """Serve in the background. Returns the URL it served."""
    import threading

    server, url = serve(bundle, root=root, port=port, analyse=analyse, host=host)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return url
