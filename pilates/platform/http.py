"""Cookie-authenticated platform routes with server-side organization/client scope."""

from http.cookies import SimpleCookie
from urllib.parse import parse_qs, urlparse
from collections import defaultdict, deque
from pathlib import Path
import logging
import math
import re
import sqlite3
import threading
import time
import shutil
from .repository import Refused
from . import media
from ..api import Refused as RequestRefused

_ATTEMPTS = defaultdict(deque)
_RATE_LOCK = threading.Lock()
_DICOM_LOCK = threading.Lock()


def token(h):
    cookies = SimpleCookie()
    try:
        cookies.load(h.headers.get("Cookie", ""))
    except Exception:
        return ""
    return cookies["motion_session"].value if "motion_session" in cookies else ""


def cookie(h, value):
    return (
        "motion_session="
        + value
        + "; Path=/; HttpOnly; SameSite=Strict; Max-Age="
        + ("604800" if value else "0")
        + ("; Secure" if h.secure else "")
    )


def guard(h):
    origin = h.headers.get("Origin")
    host = h.headers.get("Host", "")
    if h.headers.get("X-Platform-Request") != "1" or (
        origin and urlparse(origin).netloc != host
    ):
        raise Refused("Reload this page before submitting the form.", 403)


def rate(h):
    key = h.client_address[0]
    with _RATE_LOCK:
        current = time.monotonic()
        for k in list(_ATTEMPTS):
            while _ATTEMPTS[k] and current - _ATTEMPTS[k][0] > 60:
                _ATTEMPTS[k].popleft()
            if not _ATTEMPTS[k]:
                del _ATTEMPTS[k]
        if len(_ATTEMPTS[key]) >= 15:
            raise Refused("Too many sign-in attempts. Wait one minute and retry.", 429)
        _ATTEMPTS[key].append(current)


def dispatch(h, method, route):
    repo = getattr(h, "platform_repository", None)
    if repo is None:
        h._json({"error": "The connected workspace needs a configured database."}, 503)
        return
    query = {k: v[0] for k, v in parse_qs(route.query).items()}
    action = route.path.removeprefix("/platform/")
    try:
        if method == "POST":
            guard(h)
        if action.startswith("auth/") and method == "POST":
            rate(h)
            body = h._payload(100_000)
            operation = action[5:]
            if operation == "demo":
                value = repo.demo_login(
                    body.get("key"), body.get("role", "coach"), body.get("user_id")
                )
            elif operation == "login":
                value = repo.login(body.get("email"), body.get("password"))
            elif operation == "register":
                value = repo.create_org(
                    body.get("name"),
                    body.get("email"),
                    body.get("password"),
                    body.get("organization"),
                )
            elif operation == "switch":
                actor = repo.actor(token(h))
                value = repo.issue(actor.user_id, body.get("role"))
            elif operation == "logout":
                repo.logout(token(h))
                h._json_with_cookie({"ok": True}, cookie(h, ""))
                return
            else:
                raise Refused("Unknown sign-in action.", 404)
            h._json_with_cookie(repo.bootstrap(repo.actor(value)), cookie(h, value))
            return
        actor = repo.actor(token(h))
        if method == "GET":
            if action == "me":
                result = repo.bootstrap(actor)
            elif action == "list":
                result = repo.list(
                    actor,
                    query.get("collection"),
                    student_id=query.get("student_id"),
                    q=query.get("q", ""),
                    offset=int(query.get("offset", 0)),
                    limit=int(query.get("limit", 100)),
                    category=query.get("category"),
                    kind=query.get("kind"),
                    region=query.get("region"),
                    own=query.get("own") == "1",
                )
            elif action == "record":
                result = repo.get(actor, query.get("collection"), query.get("id"))
            elif action == "people":
                result = repo.people(actor, query.get("role", "student"))
            elif action == "client":
                result = repo.client(actor, query.get("id"))
            elif action == "coordinates":
                result = repo.coordinates(
                    actor, query.get("analysis_id"), query.get("person_id")
                )
            elif action == "search":
                result = repo.search(actor, query.get("q", ""))
            elif action == "inspect":
                result = repo.inspect(actor)
                from .inspection import overview

                result["tables"] = overview(repo, actor)
            elif action == "backup":
                from .backup import export_archive

                with export_archive(repo, actor) as archive:
                    h.send_response(200)
                    h.send_header("Content-Type", "application/zip")
                    h.send_header(
                        "Content-Disposition",
                        'attachment; filename="motion-yoga-backup.zip"',
                    )
                    h.send_header("Content-Length", str(archive.stat().st_size))
                    h.send_header("Cache-Control", "private, no-store")
                    h.end_headers()
                    with archive.open("rb") as source:
                        shutil.copyfileobj(source, h.wfile, length=65536)
                return
            elif action == "inspect-records":
                from .inspection import records

                result = records(
                    repo, actor, query.get("table"), int(query.get("offset", 0))
                )
            elif action == "media":
                return send_media(h, repo, actor, query)
            elif action == "dicom":
                path, mime, _ = media.media_path(repo, actor, query.get("id"))
                if mime != "application/dicom":
                    raise Refused("Select a DICOM record.")
                c = float(query["center"]) if query.get("center") else None
                w = float(query["width"]) if query.get("width") else None
                if any(v is not None and not math.isfinite(v) for v in (c, w)):
                    raise Refused("Enter finite window values.")
                if not _DICOM_LOCK.acquire(blocking=False):
                    raise Refused("Another scan is rendering. Retry in a moment.", 429)
                try:
                    data = media.dicom_png(path, int(query.get("frame", 0)), c, w)
                finally:
                    _DICOM_LOCK.release()
                h.send_response(200)
                h.send_header("Content-Type", "image/png")
                h.send_header("Content-Length", str(len(data)))
                h.send_header("Cache-Control", "no-store")
                h.end_headers()
                h.wfile.write(data)
                return
            else:
                raise Refused("This platform route is not available.", 404)
        else:
            if action == "restore":
                from .backup import restore_upload

                result = restore_upload(
                    repo, actor, h.rfile, int(h.headers.get("Content-Length", 0))
                )
            elif action == "upload":
                result = media.upload(
                    repo,
                    actor,
                    h.rfile,
                    int(h.headers.get("Content-Length", 0)),
                    query.get("filename", "upload"),
                    h.headers.get("Content-Type", "application/octet-stream").split(
                        ";"
                    )[0],
                    query.get("kind"),
                    query.get("student_id"),
                    query.get("exercise_id"),
                )
            else:
                body = h._payload(256_000)
                if action == "save":
                    result = repo.save(
                        actor, body.get("collection"), body.get("item", {})
                    )
                elif action == "people/save":
                    result = repo.save_person(actor, body)
                elif action == "copy-exercise-media":
                    result = media.copy_exercise_media(
                        repo, actor, body.get("exercise_id"), body.get("media_ids", [])
                    )
                elif action == "delete":
                    result = repo.delete(actor, body.get("collection"), body.get("id"))
                elif action == "assign":
                    result = repo.assign_program(actor, body)
                elif action == "complete-session":
                    result = repo.complete_session(actor, body)
                elif action == "review":
                    result = repo.review(actor, body)
                elif action == "annotate":
                    result = repo.annotate(actor, body)
                elif action == "analyse":
                    if h.platform_jobs is None:
                        raise Refused("Analysis is disabled on this server.", 503)
                    result = h.platform_jobs.submit(actor, body)
                else:
                    raise Refused("This platform action is not available.", 404)
        h._json(result)
    except (Refused, RequestRefused) as exc:
        h._json({"error": str(exc)}, exc.status)
    except (ValueError, TypeError, KeyError) as exc:
        h._json(
            {"error": "Check the form values and required selections, then try again."},
            400,
        )
    except sqlite3.IntegrityError:
        h._json(
            {
                "error": "This change conflicts with a linked record. Check assignments, names, quantities and required fields."
            },
            409,
        )
    except sqlite3.OperationalError:
        logging.exception("Platform storage failure")
        h._json(
            {
                "error": "The workspace could not reach its storage. Your selected files stay on this device. Retry when the server is ready."
            },
            503,
        )
    except (BrokenPipeError, ConnectionResetError):
        pass
    except Exception:
        logging.exception("Platform request failed: %s", action)
        h._json(
            {
                "error": "The server could not complete this action. Your capture has not been discarded. Retry, or contact the studio administrator."
            },
            500,
        )


def send_media(h, repo, actor, query):
    path, mime, _ = media.media_path(repo, actor, query.get("id"))
    total = path.stat().st_size
    start = 0
    end = total - 1
    status = 200
    requested = h.headers.get("Range")
    if requested:
        match = re.fullmatch(r"bytes=(\d*)-(\d*)", requested)
        if not match or not any(match.groups()):
            raise Refused("Unsupported media range.", 416)
        a, b = match.groups()
        if not a:
            start = max(0, total - int(b))
        else:
            start = int(a)
            end = min(end, int(b)) if b else end
        if start > end or start >= total:
            raise Refused("The requested media range is unavailable.", 416)
        status = 206
    h.send_response(status)
    h.send_header("Content-Type", mime)
    h.send_header("Content-Length", str(end - start + 1))
    h.send_header("Accept-Ranges", "bytes")
    h.send_header("Cache-Control", "private, no-store")
    h.send_header("X-Content-Type-Options", "nosniff")
    if status == 206:
        h.send_header("Content-Range", f"bytes {start}-{end}/{total}")
    h.end_headers()
    with path.open("rb") as source:
        source.seek(start)
        remaining = end - start + 1
        while remaining:
            block = source.read(min(65536, remaining))
            if not block:
                break
            h.wfile.write(block)
            remaining -= len(block)
