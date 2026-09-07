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
an open interface it is an upload endpoint that a stranger can point at.
``--host 0.0.0.0`` opens it deliberately, which is what a hosted deployment
needs, and what a studio serving the room needs a proxy in front of.

**``$PILATES_PASSCODE`` is the smallest honest answer to that.** Set it and the
two endpoints that change something -- an upload and a note -- want it in a
header; leave it unset and the server is open, which is the right default on a
machine on the studio's own network. It is a shared word, not a login: there are
no accounts here and inventing some would be a worse lie than a word everybody
in the room knows. Reading the page, the anatomy and any loaded session is never
gated, because none of that changes anything.

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

from . import api, auth, capacity
from .analysis_jobs import MAX_UPLOAD_BYTES, Jobs
from .observations import KINDS

#: The header a browser sends the passcode in. Not a cookie: there is no session
#: to keep and nothing to log out of.
PASSCODE_HEADER = "X-Passcode"

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
    #: A shared passcode for the two endpoints that change something, from
    #: ``$PILATES_PASSCODE``. Empty means the server is open, which is the right
    #: default on a studio machine on its own network and the wrong one on a
    #: public URL -- so a hosted deployment sets it.
    #:
    #: Deliberately not a login. There are no accounts here and inventing some
    #: would be a worse lie than a shared word everybody in the studio knows:
    #: this stops a stranger who found the URL from uploading video to it, and
    #: claims nothing more than that.
    passcode: str = ""

    #: Failed sign-ins, remembered in memory across requests. A rate limiter
    #: rather than a record: a restart clearing it is correct.
    attempts = auth.Attempts()

    def _allowed(self) -> bool:
        """Whether this request may change something."""
        import hmac

        if not self.passcode:
            return True
        given = self.headers.get(PASSCODE_HEADER, "")
        return hmac.compare_digest(given, self.passcode)

    # -- who is asking ----------------------------------------------------

    @property
    def secure(self) -> bool:
        """Whether this request arrived over HTTPS.

        Render and every other platform terminates TLS in front of the process,
        so the socket here is plain either way and the header is the only
        evidence. localhost counts as secure to browsers, which is what lets a
        studio develop against the same cookie rules it will deploy under.
        """
        forwarded = self.headers.get("X-Forwarded-Proto", "").split(",")[0].strip()
        if forwarded:
            return forwarded == "https"
        host = (self.headers.get("Host") or "").split(":")[0]
        return host in ("localhost", "127.0.0.1", "::1")

    def _token(self) -> str:
        return auth.token_from(self.headers.get("Cookie", ""))

    def _base(self) -> str:
        """Where this page lives, for a link somebody has to be able to click.

        Built from the request rather than configured, so a studio that moves
        from localhost to a domain does not have to remember to change a
        setting -- and a reset link is useless if it points at the wrong host.
        """
        host = self.headers.get("X-Forwarded-Host") or self.headers.get("Host")
        return f"{'https' if self.secure else 'http'}://{host or 'localhost'}"

    def _viewer(self, store):
        """The membership this request is acting as, or None."""
        if not self.db:
            return None
        return auth.viewer_for(store, self._token())

    def _payload(self, limit: int = 64 * 1024) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if not 0 < length <= limit:
            raise api.Refused("nothing in the request", 400)
        try:
            body = json.loads(self.rfile.read(length))
        except ValueError as exc:
            raise api.Refused("that was not JSON", 400) from exc
        if not isinstance(body, dict):
            raise api.Refused("that was not an object", 400)
        return body

    def _json_with_cookie(self, payload: dict, cookie: str) -> None:
        """The only place a Set-Cookie is written. A cookie set by accident is
        the whole security model gone, so there is exactly one door."""
        body = json.dumps(payload).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Set-Cookie", cookie)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _answer(self, work, status: int = 200) -> None:
        """Run one API call and turn its refusal into an honest status.

        Every route below is written as if it will succeed; the refusals are
        raised where the rule is, next to the reason, rather than checked twice
        at the edge and once again in the middle.
        """
        try:
            with self._store() as store:
                self._json(work(store), status)
        except api.Refused as refused:
            self._json({"error": str(refused)}, refused.status)
        except (ValueError, KeyError) as exc:
            self._json({"error": str(exc)}, 400)

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
            # The page asks before it dresses the Record button as the thing
            # to press. It is drawn either way -- a hidden button answers
            # "where do I record" with silence -- but on a static host this
            # 404s and the button explains how to start the other half instead
            # of offering an analysis nothing can run.
            self._json({"analyse": self.jobs is not None,
                        "max_upload_bytes": MAX_UPLOAD_BYTES,
                        "session": self.bundle is not None,
                        # Whether a clip analysed here joins a history or is
                        # measured once and forgotten. The record form says
                        # which, because it changes what the numbers mean.
                        "remembers": bool(self.db and self.jobs is not None),
                        # Coach mode is offered only where a note has somewhere
                        # to go. Reading a session from a file is a viewer.
                        "coach": bool(self.db),
                        # Whether the page has to ask for a passcode before it
                        # can upload or write. Saying so is not a leak: the
                        # 401 would say it anyway, one round trip later.
                        "passcode": bool(self.passcode),
                        # How much machine this is. The page multiplies it by
                        # the length of the clip and says how long the wait
                        # will be, because the difference between a laptop and
                        # the smallest free hosting tier is a minute and a half
                        # against an hour and a half -- and finding that out by
                        # waiting is the worst way to find it out.
                        "cores": capacity.cores(),
                        "cpu_seconds_per_video_second":
                            capacity.CPU_SECONDS_PER_VIDEO_SECOND,
                        "kinds": KINDS if self.db else {}})
            return
        if route.path == "/sheet" and self.db:
            who = parse_qs(route.query).get("user", [""])[0]
            if not who:
                self._json({"error": "which person?"}, 400)
                return
            def sheet(store, who=who):
                api.guard_subject(store, self._viewer(store), who)
                # The readings ride along for a coach, because "what to read
                # before this class" that omits what they wrote last week is
                # not what to read before this class. For the person whose body
                # it is they do not: that list is the coach's working record,
                # and what reaches the student is the chart and the line
                # written for them.
                viewer = self._viewer(store)
                sheet = store.coach_sheet(who).to_dict()
                if viewer and viewer.is_self(who):
                    return sheet
                return {**sheet, **api.standing_readings(store, who)}

            self._answer(sheet)
            return
        # -- accounts ---------------------------------------------------
        if route.path == "/auth/me":
            if not self.db:
                self._json({"signed_in": False, "accounts": False,
                            "studios": []})
                return
            self._answer(lambda store: api.me(store, self._viewer(store)))
            return
        if route.path == "/studios" and self.db:
            self._answer(lambda store: {"studios": store.studios()})
            return
        if route.path == "/directory" and self.db:
            self._answer(lambda store: api.directory(store, self._viewer(store)))
            return
        if route.path == "/roster" and self.db:
            self._answer(lambda store: api.roster(store, self._viewer(store)))
            return
        if route.path == "/student" and self.db:
            who = parse_qs(route.query).get("username", [""])[0]
            self._answer(lambda store: api.student_record(
                store, self._viewer(store), who))
            return
        if route.path == "/admin/pending" and self.db:
            self._answer(lambda store: api.waiting(store, self._viewer(store)))
            return
        if route.path == "/admin/people" and self.db:
            self._answer(lambda store: api.everybody(store, self._viewer(store)))
            return
        if route.path == "/structure" and self.db:
            q = parse_qs(route.query)
            self._answer(lambda store: api.structure_form(
                store, self._viewer(store),
                q.get("username", [""])[0], q.get("structure", [""])[0],
                q.get("kind", [""])[0], q.get("fma", [""])[0],
                q.get("side", [""])[0]))
            return
        if route.path == "/structure-history" and self.db:
            q = parse_qs(route.query)
            self._answer(lambda store: api.structure_history(
                store, self._viewer(store),
                q.get("username", [""])[0], q.get("structure", [""])[0]))
            return
        if route.path == "/structures-seen" and self.db:
            who = parse_qs(route.query).get("username", [""])[0]
            self._answer(lambda store: api.structures_seen(
                store, self._viewer(store), who))
            return
        if route.path == "/admin/studios" and self.db:
            self._answer(lambda store: api.studios(store, self._viewer(store)))
            return
        if route.path == "/me/coaches" and self.db:
            self._answer(lambda store: api.my_coaches(
                store, self._viewer(store)))
            return
        if route.path == "/me/recovery" and self.db:
            self._answer(lambda store: api.recovery_state(
                store, self._viewer(store)))
            return
        if route.path == "/audit" and self.db:
            who = parse_qs(route.query).get("username", [""])[0]
            self._answer(lambda store: api.audit_log(
                store, self._viewer(store), who))
            return

        if route.path == "/recordings" and self.db:
            # Everything on record here, newest first. Without this a finished
            # analysis had exactly one place it could ever appear -- the dialog
            # that was watching the job -- and closing that dialog threw the
            # result away with nowhere to get it back from.
            def recordings(store):
                names = api.visible_usernames(store, self._viewer(store))
                return {"recordings": [r for r in store.recordings()
                                       if names is None
                                       or r.get("username") in names]}

            self._answer(recordings)
            return
        if route.path == "/recording" and self.db:
            # One of them, built into a bundle the page can put on the body.
            from .bundle import build, validate

            query = parse_qs(route.query)
            who = query.get("user", [""])[0]
            key = query.get("session", [""])[0]
            if not who or not key:
                self._json({"error": "which person, and which session?"}, 400)
                return

            def one(store, who=who, key=key):
                api.guard_subject(store, self._viewer(store), who)
                try:
                    bundle = build(store, who, key, include_poses=False)
                except (ValueError, KeyError) as exc:
                    raise api.Refused(str(exc), 404) from exc
                problems = validate(bundle)
                if problems:
                    # The same refusal the viewer makes, made here instead, so
                    # the reason travels rather than a blank body.
                    raise api.Refused("; ".join(problems), 409)
                return bundle

            self._answer(one)
            return
        if route.path == "/people" and self.db:
            def people(store):
                names = api.visible_usernames(store, self._viewer(store))
                return {"people": [dict(p) for p in store.people()
                                   if names is None or p["username"] in names]}

            self._answer(people)
            return
        if route.path.startswith("/job/") and self.jobs is not None:
            job = self.jobs.get(route.path[len("/job/"):])
            if job is None:
                self._json({"error": "no such job"}, 404)
                return
            self._json(job.public())
            return
        super().do_GET()

    #: Where a signed-in person's role decides the answer. Each takes the
    #: store, the viewer and the parsed body.
    WRITES = {
        "/auth/setup": lambda self, store, body: api.set_up(store, body),
        "/auth/signup": lambda self, store, body: api.register(
            store, body, self._base()),
        "/auth/forgot": lambda self, store, body: api.forgot(
            store, body, self._base()),
        "/auth/recover": lambda self, store, body: api.recover_with_code(
            store, body),
        "/auth/reset": lambda self, store, body: api.reset_with_token(
            store, body),
        "/auth/verify": lambda self, store, body: api.verify_email(store, body),
        "/me/recovery-codes": lambda self, store, body: api.new_codes(
            store, self._viewer(store)),
        "/admin/reset": lambda self, store, body: api.admin_reset(
            store, self._viewer(store), body, self._base()),
        "/me/profile": lambda self, store, body: api.put_profile(
            store, self._viewer(store), body),
        "/me/screening": lambda self, store, body: api.put_screening(
            store, self._viewer(store), body),
        "/roster/add": lambda self, store, body: api.add_student(
            store, self._viewer(store), body),
        "/roster/remove": lambda self, store, body: api.end_assignment(
            store, self._viewer(store), body),
        "/roster/end": lambda self, store, body: api.end_assignment(
            store, self._viewer(store), body),
        "/admin/decide": lambda self, store, body: api.decide(
            store, self._viewer(store), body),
        "/admin/grant": lambda self, store, body: api.give_role(
            store, self._viewer(store), body),
        "/admin/invite": lambda self, store, body: api.make_invitation(
            store, self._viewer(store), body),
        "/admin/seed": lambda self, store, body: api.seed_studio(
            store, self._viewer(store), body),
        "/admin/studio": lambda self, store, body: api.put_studio(
            store, self._viewer(store), body),
        "/admin/move": lambda self, store, body: api.move_person(
            store, self._viewer(store), body),
        "/admin/assign-all": lambda self, store, body: api.assign_everybody(
            store, self._viewer(store), body),
        "/evaluate-structure": lambda self, store, body: api.evaluate_structure(
            store, self._viewer(store), body),
    }

    def do_POST(self):  # noqa: N802
        route = urlparse(self.path)
        if route.path in ("/auth/signin", "/auth/signout", "/auth/switch"):
            self._session_route(route.path)
            return
        if route.path in self.WRITES and self.db:
            work = self.WRITES[route.path]
            try:
                body = self._payload()
            except api.Refused as refused:
                self._json({"error": str(refused)}, refused.status)
                return
            self._answer(lambda store: work(self, store, body),
                         201 if route.path in ("/auth/signup", "/auth/setup")
                         else 200)
            return
        if route.path == "/note":
            self._note()
            return
        if route.path != "/analyse" or self.jobs is None:
            self._json({"error": "not here"}, 404)
            return
        if not self._allowed():
            self._json({"error": "this server asks for a passcode before it "
                                 "takes a video"}, 401)
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

    def _session_route(self, path: str) -> None:
        """Sign in, out, or change which role you are acting as.

        Separate from the table above because these three are the only routes
        that set a cookie, and a cookie set by accident is the whole security
        model gone.
        """
        if not self.db:
            self._json({"error": "this server keeps no accounts"}, 404)
            return
        try:
            body = self._payload() if path != "/auth/signout" else {}
        except api.Refused as refused:
            self._json({"error": str(refused)}, refused.status)
            return

        with self._store() as store:
            if path == "/auth/signout":
                auth.sign_out(store, self._token())
                self._json_with_cookie({"signed_in": False},
                                       auth.clear_header(self.secure))
                return

            if path == "/auth/switch":
                try:
                    viewer = auth.switch(store, self._token(),
                                         body.get("studio", ""),
                                         body.get("role", ""))
                except ValueError as exc:
                    self._json({"error": str(exc)}, 403)
                    return
                self._json({"acting": {"username": viewer.username,
                                       "studio": viewer.studio,
                                       "role": viewer.role}})
                return

            auth.sweep(store)
            try:
                session = auth.sign_in(
                    store, body.get("email", ""), body.get("password", ""),
                    attempts=self.attempts,
                    source=self.client_address[0] if self.client_address else "")
            except auth.TooManyTries as exc:
                self._json({"error": str(exc)}, 429)
                return
            except ValueError as exc:
                self._json({"error": str(exc)}, 401)
                return
            _, header = auth.cookie_header(session, self.secure)
            self._json_with_cookie({"signed_in": True,
                                    "acting": {"username": session.username,
                                               "studio": session.studio,
                                               "role": session.role}}, header)

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
        if not self._allowed():
            self._json({"error": "this server asks for a passcode before it "
                                 "keeps a note"}, 401)
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
        def write(store):
            if observation.username not in {p["username"] for p in store.people()}:
                raise api.Refused(f"{observation.username} is not enrolled", 404)
            # A note is written *about* somebody, so it is guarded as a write:
            # a coach with no live assignment cannot put words in a student's
            # record any more than they can read the measurements in it.
            api.guard_subject(store, self._viewer(store), observation.username,
                              write=True)
            return {"id": store.observe(observation),
                    "note": observation.to_dict(),
                    "sheet": store.coach_sheet(observation.username).to_dict()}

        self._answer(write, 201)

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
    Handler.passcode = os.environ.get("PILATES_PASSCODE", "").strip()
    Handler.bundle = bundle
    # The record goes to the jobs runner too, so an uploaded clip is measured
    # into the studio's history rather than into a scratch file that is deleted
    # with the job. Without one it still analyses; it just cannot remember.
    Handler.jobs = Jobs(db=db) if analyse else None
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
