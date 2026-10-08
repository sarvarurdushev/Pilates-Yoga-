"""Small real (non-demo) facilities for SEDENS tests, built through the platform."""

from __future__ import annotations

import json
import threading
import urllib.error
import urllib.request

from pilates.platform.repository import Repository, uid
from pilates.sedens.core import Sedens
from pilates.sedens import modes

PASSWORD = "correct horse battery"


def make_sedens(path, mode_name="local_room"):
    repo = Repository(path)
    mode = modes.Mode(mode_name, str(path), False, True, False)
    return Sedens(repo, mode)


def add_user(repo, org_id, name, roles, location_id=None, coach_id=None):
    user_id = uid()
    with repo.db() as db:
        db.execute(
            "INSERT INTO p_users(id,org_id,name,email) VALUES (?,?,?,?)",
            (user_id, org_id, name, f"{user_id}@example.test"),
        )
        for role in roles:
            db.execute("INSERT INTO p_roles VALUES (?,?)", (user_id, role))
        if "student" in roles:
            db.execute("INSERT INTO p_students(id) VALUES (?)", (user_id,))
            if location_id:
                db.execute("INSERT INTO p_student_locations VALUES (?,?)", (user_id, location_id))
            if coach_id:
                db.execute("INSERT INTO p_coach_students VALUES (?,?)", (coach_id, user_id))
        if "coach" in roles:
            db.execute("INSERT INTO p_coaches(id) VALUES (?)", (user_id,))
            if location_id:
                db.execute("INSERT INTO p_coach_locations VALUES (?,?)", (user_id, location_id))
    return user_id


def sedens_staff(sedens, email="root@sedens.test"):
    """The SEDENS organization: its admin and a reviewer coach account, as Actors,
    and the reviewer's session token."""
    from pilates.sedens import capabilities, onboarding

    onboarding.bootstrap_sedens_org(sedens, name="Root", email=email, password=PASSWORD)
    root = sedens.repo.actor(sedens.repo.login(email, PASSWORD))
    reviewer_id = add_user(sedens.repo, root.org_id, "Reviewer", ["coach"])
    with sedens.db() as db:
        capabilities.grant(sedens, db, root, reviewer_id, "sedens_reviewer")
    token = sedens.repo.issue(reviewer_id, "coach")
    return root, sedens.repo.actor(token), token


def facility(sedens, label="A", rooms=("AI Private Room 01",)):
    """A real facility with one location, rooms, an admin, a coach and two customers."""
    repo = sedens.repo
    admin_token = repo.create_org(f"Admin {label}", f"admin-{label.lower()}-{uid()[:6]}@example.test",
                                  PASSWORD, f"Facility {label}")
    admin = repo.actor(admin_token)
    location_id = uid()
    room_ids = []
    with repo.db() as db:
        db.execute(
            "INSERT INTO p_locations(id,org_id,name) VALUES (?,?,?)", (location_id, admin.org_id, f"{label} centre")
        )
        for name in rooms:
            rid = uid()
            db.execute("INSERT INTO p_rooms VALUES (?,?,?,?)", (rid, location_id, name, 1))
            room_ids.append(rid)
    coach_id = add_user(repo, admin.org_id, f"Coach {label}", ["coach"], location_id)
    customer_id = add_user(repo, admin.org_id, f"Customer {label}", ["student"], location_id, coach_id)
    other_id = add_user(repo, admin.org_id, f"Other {label}", ["student"], location_id, coach_id)
    return {
        "org_id": admin.org_id,
        "location_id": location_id,
        "room_id": room_ids[0],
        "room_ids": room_ids,
        "admin": admin,
        "admin_token": admin_token,
        "coach_id": coach_id,
        "coach_token": repo.issue(coach_id, "coach"),
        "customer_id": customer_id,
        "customer_token": repo.issue(customer_id, "student"),
        "other_id": other_id,
        "other_token": repo.issue(other_id, "student"),
    }


def pair(sedens, fac, room_id=None, name="Room screen"):
    """Run the real pairing protocol and return the device token."""
    from pilates.sedens import rooms

    started = rooms.start_pairing(sedens)
    rooms.confirm_pairing(sedens, fac["admin"], started["code"], room_id or fac["room_id"], name)
    claimed = rooms.claim_pairing(sedens, started["secret"])
    assert claimed["state"] == "paired"
    return claimed["token"]


def room_code(sedens, platform_token):
    """A customer, signed in on their own device, asks for a single-use room code."""
    from pilates.sedens import rooms

    return rooms.issue_access_code(sedens, sedens.repo.actor(platform_token))["code"]


def enter_with_code(sedens, device_token, customer_token, screen_token=""):
    """Enter a room the way a customer does: code from their phone, typed on the screen."""
    from pilates.sedens import rooms

    return rooms.enter(sedens, device_token, method="access_code",
                       credential=room_code(sedens, customer_token), platform_token=screen_token)


class Client:
    """Cookie-keeping JSON client for /sedens/ and /platform/ routes."""

    def __init__(self, base):
        self.base = base
        self.jar = {}
        self.last_headers = None

    def call(self, method, path, body=None, headers=None, raw=False):
        data = json.dumps(body if body is not None else {}).encode() if method == "POST" else None
        req = urllib.request.Request(self.base + path, data=data, method=method)
        req.add_header("Content-Type", "application/json")
        if path.startswith("/sedens/"):
            req.add_header("X-Sedens-Request", "1")
        if path.startswith("/platform/"):
            req.add_header("X-Platform-Request", "1")
        for key, value in (headers or {}).items():
            if value is None:
                continue
            req.add_header(key, value)
        if self.jar and not (headers and "Cookie" in headers):
            req.add_header("Cookie", "; ".join(f"{k}={v}" for k, v in self.jar.items()))
        try:
            response = urllib.request.urlopen(req, timeout=60)
            status, hdrs, body_bytes = response.status, response.headers, response.read()
        except urllib.error.HTTPError as exc:
            status, hdrs, body_bytes = exc.code, exc.headers, exc.read()
        self.last_headers = hdrs
        for cookie in hdrs.get_all("Set-Cookie") or []:
            key, value = cookie.split(";")[0].split("=", 1)
            if value:
                self.jar[key] = value
            else:
                self.jar.pop(key, None)
        if raw:
            return status, body_bytes
        try:
            return status, json.loads(body_bytes or b"{}")
        except ValueError:
            return status, body_bytes


def running_server(db_path):
    from pilates.serve import serve

    server, url = serve(None, port=0, db=str(db_path))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, url.rsplit("/", 1)[0]
