"""Serve the anatomy application with one person's session attached.

The application is a static site with no build step, which is most of what it is
good for: it opens from a folder, it works offline, and nothing about it needs a
server except the browser's own refusal to fetch modules and model files over
``file://``. So this is a plain static server and one route that is not a file.

``/session.json`` is served from memory rather than written into the site
directory. A bundle is somebody's health data; writing it next to the code so
that it can be served is how it ends up committed, and a person who asked for a
session to be shown once has not asked for it to be left on disk.
"""
from __future__ import annotations

import json
import mimetypes
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

#: The application root, inside this repository.
WEB = Path(__file__).resolve().parent.parent / "web"

SESSION_ROUTE = "/session.json"

# .glb is the format every model in the site is in, and Python does not know it.
# Served as the wrong type, the loader refuses them and the body never appears.
mimetypes.add_type("model/gltf-binary", ".glb")
mimetypes.add_type("text/javascript", ".mjs")


class Handler(SimpleHTTPRequestHandler):
    """Static files, plus the session that is never written down."""

    bundle: dict | None = None

    def do_GET(self):  # noqa: N802 - the base class names it
        if self.path.split("?")[0] == SESSION_ROUTE:
            if self.bundle is None:
                self.send_error(404, "no session was loaded")
                return
            body = json.dumps(self.bundle).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            # A session is one person's health data. Nothing about it should
            # survive in a cache that outlives the window it was opened in.
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def log_message(self, *args):
        """Quiet. The interesting output is the URL, printed once."""


def serve(bundle: dict | None, root: Path = WEB, port: int = 8000,
          host: str = "127.0.0.1") -> tuple[ThreadingHTTPServer, str]:
    """Start the server and return it with the URL to open.

    Port 0 asks the operating system for a free one, which is what the tests and
    the render harness use so that two of them can run at once.
    """
    handler = partial(Handler, directory=str(root))
    handler.bundle = bundle          # type: ignore[attr-defined]
    Handler.bundle = bundle
    server = ThreadingHTTPServer((host, port), handler)
    actual = server.server_address[1]
    url = f"http://{host}:{actual}/index.html"
    if bundle is not None:
        url += f"?session={SESSION_ROUTE}"
    return server, url


def run(bundle: dict | None, root: Path = WEB, port: int = 8000) -> str:
    """Serve until interrupted. Returns the URL it served."""
    server, url = serve(bundle, root=root, port=port)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return url
