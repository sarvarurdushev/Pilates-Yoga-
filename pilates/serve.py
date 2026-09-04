"""Serve the anatomy application, with one person's session and a way to record.

The application is a static site, which is most of what it is good for: it opens
from a folder, it works offline, and nothing about it needs a server except the
browser's refusal to fetch modules and model files over ``file://``. So this is a
plain static server plus three routes that are not files.

``/session.json``   the loaded bundle, served from memory
``/capabilities``   what this server can do, so the page can hide what it cannot
``/analyse``        a clip, uploaded; returns a job id
``/job/<id>``       how that job is going, and the bundle when it is done
``/note``           one coach observation, written from the body itself
``/sheet``          what to read before this person's next class

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
from .observations import KINDS

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
    #: Where the studio's record lives, when there is one. A viewer serving a
    #: single exported bundle has none, and then a coach cannot write into it --
    #: which is right: there is nothing to write into.
    db: str = ""

    def _store(self):
        """A short-lived store for one request.

        Opened and closed per request rather than held: SQLite connections are
        not shareable across threads, and this server is threaded.
        """
        from .store import Store

        return Store.open(self.db)

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
                        "session": self.bundle is not None,
                        # Coach mode is offered only where a note has somewhere
                        # to go. Reading a session from a file is a viewer.
                        "coach": bool(self.db),
                        "kinds": KINDS if self.db else {}})
            return
        if route.path == "/sheet" and self.db:
            who = parse_qs(route.query).get("user", [""])[0]
            if not who:
                self._json({"error": "which person?"}, 400)
                return
            with self._store() as store:
                self._json(store.coach_sheet(who).to_dict())
            return
        if route.path == "/people" and self.db:
            with self._store() as store:
                self._json({"people": [dict(p) for p in store.people()]})
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
        if route.path == "/note":
            self._note()
            return
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

    def _note(self) -> None:
        """One coach observation, written from the body itself.

        The interesting field is `structure`: the coach clicked a muscle on the
        3D model and the note is about that muscle, which is the whole reason
        this endpoint exists rather than a text box in a spreadsheet.
        """
        from .observations import Observation

        if not self.db:
            self._json({"error": "this is a viewer; there is no record to "
                                 "write into"}, 404)
            return
        length = int(self.headers.get("Content-Length") or 0)
        if not 0 < length < 64 * 1024:
            self._json({"error": "no note in the request"}, 400)
            return
        try:
            payload = json.loads(self.rfile.read(length))
        except ValueError:
            self._json({"error": "that was not JSON"}, 400)
            return
        try:
            observation = Observation(
                username=payload.get("username", ""),
                kind=payload.get("kind", ""), text=payload.get("text", ""),
                by=payload.get("by", ""), session=payload.get("session", ""),
                structure=payload.get("structure", ""),
                fma=payload.get("fma", ""), subject=payload.get("subject", ""),
                exercise=payload.get("exercise", ""),
                rating=payload.get("rating"), rates=payload.get("rates", ""),
                review_on=payload.get("review_on", ""))
        except ValueError as exc:
            # The dataclass refuses a rating with nothing attached, a note with
            # no text and a note with no author. Those refusals are the point,
            # so they reach the page as they are.
            self._json({"error": str(exc)}, 400)
            return
        with self._store() as store:
            if observation.username not in {p["username"] for p in store.people()}:
                self._json({"error": f"{observation.username} is not enrolled"}, 404)
                return
            note_id = store.observe(observation)
            sheet = store.coach_sheet(observation.username).to_dict()
        self._json({"id": note_id, "note": observation.to_dict(),
                    "sheet": sheet}, 201)

    def log_message(self, *args):
        """Quiet. The interesting output is the URL, printed once."""


def serve(bundle: dict | None, root: Path = WEB, port: int = 8000,
          host: str = "127.0.0.1", analyse: bool = False, db: str = ""):
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
    Handler.db = db
    server = ThreadingHTTPServer((host, port), handler)
    url = f"http://{host}:{server.server_address[1]}/index.html"
    if bundle is not None:
        url += f"?session={SESSION_ROUTE}"
    return server, url


def run(bundle: dict | None, root: Path = WEB, port: int = 8000,
        analyse: bool = False, host: str = "127.0.0.1", db: str = "") -> str:
    """Serve in the background. Returns the URL it served."""
    import threading

    server, url = serve(bundle, root=root, port=port, analyse=analyse,
                        host=host, db=db)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return url
