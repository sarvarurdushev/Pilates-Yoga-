"""``/sedens/`` routes. Authorization is decided here and in the domain modules,
never by what the page chooses to show.

Cookies (all HttpOnly, SameSite=Strict, Secure on HTTPS):

``motion_session``  the platform's own sign-in (unchanged, Path=/)
``sedens_device``   a paired room screen (Path=/sedens/, 180 days)
``sedens_room``     a customer's room session (Path=/sedens/, session length)
``sedens_pairing``  an unpaired screen's pairing secret (Path=/sedens/room/pairing, 10 min)

Every POST needs ``X-Sedens-Request: 1`` and, when the browser sends one, an
``Origin`` matching the ``Host`` (the same CSRF rule as ``/platform/``).
"""

from __future__ import annotations

from collections import defaultdict, deque
from http.cookies import SimpleCookie
import json
import logging
import sqlite3
import threading
import time
from urllib.parse import parse_qs, urlparse

from . import (analytics, capabilities, consent, course_http, creators, crm, demo, demo_marketplace, library,
               onboarding, rooms)
from ..platform import http as platform_http
from ..platform.repository import Refused
from .util import Denied, environment

_LIMITS = defaultdict(deque)
_LIMIT_LOCK = threading.Lock()
RATE = {"pairing": 10, "enter": 20, "demo": 10, "register": 5, "confirm": 20, "code": 10, "affiliation": 10,
        "upload": 12}


def _client(h):
    """The visitor's address. Behind a hosting proxy (Render, Hugging Face) the
    socket peer is the proxy, so the right-most X-Forwarded-For hop (appended by
    that proxy) is used."""
    sedens = getattr(h, "sedens", None)
    forwarded = h.headers.get("X-Forwarded-For", "")
    if sedens is not None and sedens.mode.hosted and forwarded.strip():
        return forwarded.split(",")[-1].strip()
    return h.client_address[0]


def _limit(h, bucket):
    key = (bucket, _client(h))
    with _LIMIT_LOCK:
        current = time.monotonic()
        for k in list(_LIMITS):
            queue = _LIMITS[k]
            while queue and current - queue[0] > 60:
                queue.popleft()
            if not queue:
                del _LIMITS[k]
        queue = _LIMITS[key]
        if len(queue) >= RATE[bucket]:
            raise Denied("Too many attempts. Wait one minute and retry.", 429, "rate_limited")
        queue.append(current)


def _guard(h):
    origin = h.headers.get("Origin")
    host = h.headers.get("Host", "")
    if h.headers.get("X-Sedens-Request") != "1" or (origin and urlparse(origin).netloc != host):
        raise Denied("Reload this page before submitting.", 403, "csrf")


def _cookies(h) -> dict:
    jar = SimpleCookie()
    try:
        jar.load(h.headers.get("Cookie", ""))
    except Exception:
        return {}
    return {k: v.value for k, v in jar.items()}


def _cookie(h, name, value, path, max_age):
    parts = [f"{name}={value}", f"Path={path}", "HttpOnly", "SameSite=Strict", f"Max-Age={max_age if value else 0}"]
    if h.secure:
        parts.append("Secure")
    return "; ".join(parts)


def _respond(h, payload, status=200, cookies=()):
    body = json.dumps(payload).encode()
    h.send_response(status)
    h.send_header("Content-Type", "application/json")
    h.send_header("Cache-Control", "no-store")
    for cookie in cookies:
        h.send_header("Set-Cookie", cookie)
    h.send_header("Content-Length", str(len(body)))
    h.end_headers()
    h.wfile.write(body)


class Request:
    def __init__(self, h, sedens, method, action, query):
        self.h, self.sedens, self.method, self.action, self.query = h, sedens, method, action, query
        self.cookies = _cookies(h)
        self.body = {}
        self.set_cookies = []

    @property
    def platform_token(self):
        return self.cookies.get("motion_session", "")

    @property
    def device_token(self):
        return self.cookies.get(rooms.DEVICE_COOKIE, "")

    @property
    def room_token(self):
        return self.cookies.get(rooms.ROOM_COOKIE, "")

    def actor(self):
        actor = self.sedens.repo.actor(self.platform_token)
        # The platform still issues demonstration sign-ins; SEDENS refuses them
        # when this server has demonstrations switched off.
        if actor.demo and not self.sedens.mode.demo_enabled:
            raise Denied("Demonstrations are switched off on this server.", 403, "demo_disabled")
        return actor

    def room(self):
        return rooms.authorize(self.sedens, self.device_token, self.room_token, self.platform_token)

    def cookie(self, name, value, path, max_age):
        self.set_cookies.append(_cookie(self.h, name, value, path, max_age))

    def limit(self, bucket):
        _limit(self.h, bucket)

    def demo_allowed(self):
        if not self.sedens.mode.demo_enabled:
            raise Denied("Demonstrations are switched off on this server.", 404, "demo_disabled")


# -- handlers ------------------------------------------------------------------


def _me(r):
    actor = r.actor()
    with r.sedens.db() as db:
        user = r.sedens.user(db, actor.user_id)
        return {
            "user": {"id": user["id"], "name": user["name"], "roles": user["roles"]},
            "role": actor.role,
            "organization": r.sedens.org(db, actor.org_id),
            "capabilities": sorted(capabilities.effective(r.sedens, db, actor)),
            "creator_profile": creators.own_profile(r.sedens, db, actor),
            "mode": r.sedens.mode.name,
        }


def _config(r):
    return {
        "product": "SEDENS AI Private Room",
        "company": "SEDENS International",
        "mode": r.sedens.mode.describe(),
        "languages": ["ko", "en"],
        "general_fitness_notice": "SEDENS is a general fitness service. It does not diagnose or treat any condition.",
    }


def _pairing_start(r):
    _limit(r.h, "pairing")
    started = rooms.start_pairing(r.sedens, r.h.headers.get("User-Agent", ""))
    r.cookie(rooms.PAIRING_COOKIE, started["secret"], "/sedens/room/pairing", rooms.PAIRING_MINUTES * 60)
    # No organization is known until an administrator confirms the code, so the
    # pairing becomes an audit and analytics record at confirmation.
    return {"code": started["code"], "expires_at": started["expires_at"]}


def _pairing_status(r):
    result = rooms.claim_pairing(r.sedens, r.cookies.get(rooms.PAIRING_COOKIE, ""))
    if result["state"] == "paired":
        r.cookie(rooms.DEVICE_COOKIE, result.pop("token"), "/sedens/", rooms.DEVICE_DAYS * 86400)
        r.cookie(rooms.PAIRING_COOKIE, "", "/sedens/room/pairing", 0)
    elif result["state"] in ("expired", "claimed", "unavailable", "unknown"):
        r.cookie(rooms.PAIRING_COOKIE, "", "/sedens/room/pairing", 0)
    return result


def _enter(r):
    _limit(r.h, "enter")
    result = rooms.enter(
        r.sedens, r.device_token, method=r.body.get("method", ""), credential=r.body.get("credential", ""),
        pin=r.body.get("pin", ""), platform_token=r.platform_token,
    )
    ctx = result["context"]
    seconds = max(60, int((rooms.parse(ctx.expires_at) - rooms.utcnow()).total_seconds()))
    r.cookie(rooms.ROOM_COOKIE, result["token"], "/sedens/", seconds)
    return {"session": rooms.describe(r.sedens, ctx), "decision": result["decision"]}


def _access_code(r):
    _limit(r.h, "code")
    with r.sedens.db() as db:
        on_room_screen = rooms.device_for_token(r.sedens, db, r.device_token) is not None
    if on_room_screen:
        # The code proves the customer holds their own signed-in device.
        raise Denied("Ask for your room code on your own phone, not on the room screen.", 403, "room_screen")
    return rooms.issue_access_code(r.sedens, r.actor())


def _room_session(r):
    return rooms.describe(r.sedens, r.room())


def _room_end(r):
    ctx = r.room()
    rooms.end(r.sedens, ctx, "customer_ended")
    r.cookie(rooms.ROOM_COOKIE, "", "/sedens/", 0)
    return {"ended": True}


def _room_library(r):
    r.room()
    return library.room_library()


def _room_event(r):
    ctx = r.room()
    with r.sedens.db() as db:
        analytics.record(db, str(r.body.get("name", "")), org_id=ctx.org_id, source="client", user_id=ctx.student_id,
                         room_id=ctx.room_id, device_id=ctx.device_id, room_session_id=ctx.room_session_id,
                         demo=ctx.demo, props=r.body.get("props") or {})
    return {"recorded": True}


def _room_consents(r):
    ctx = r.room()
    with r.sedens.db() as db:
        return {"texts": consent.texts(), "current": consent.current(db, ctx.student_id)}


def _room_consent(r):
    ctx = r.room()
    with r.sedens.db() as db:
        return {"current": consent.record(
            db, org_id=ctx.org_id, user_id=ctx.student_id, kind=r.body.get("kind"), granted=r.body.get("granted"),
            text_version=r.body.get("text_version"), channel="room", room_session_id=ctx.room_session_id,
            room_id=ctx.room_id, device_id=ctx.device_id, demo=ctx.demo,
        )}


def _consents(r):
    actor = r.actor()
    with r.sedens.db() as db:
        return {"texts": consent.texts(), "current": consent.current(db, actor.user_id)}


def _consent_save(r):
    actor = r.actor()
    with r.sedens.db() as db:
        return {"current": consent.record(
            db, org_id=actor.org_id, user_id=actor.user_id, kind=r.body.get("kind"), granted=r.body.get("granted"),
            text_version=r.body.get("text_version"), channel="account", demo=actor.demo,
        )}


def _demo_enter(r):
    r.demo_allowed()
    _limit(r.h, "demo")
    key = str(r.body.get("key", ""))
    role = r.body.get("role", "student")
    if role in ("creator", "professor", "reviewer"):
        # Demonstration-marketplace roles: Minji Lee, the fictional professor, the fictional reviewer.
        r.sedens.repo.logout(r.sedens.repo.demo_login(key, "admin"))  # seeds the demonstration once
        demo.ensure(r.sedens, "demo-" + key)
        user_id, platform_role = demo_marketplace.actor_for("demo-" + key, role)
        token = r.sedens.repo.issue(user_id, platform_role)
    else:
        token = r.sedens.repo.demo_login(key, role, r.body.get("user_id"))
        demo.ensure(r.sedens, "demo-" + key)
    r.set_cookies.append(platform_http.cookie(r.h, token))
    r.cookies["motion_session"] = token
    return {"me": _me(r)}


def _demo_room_device(r):
    r.demo_allowed()
    _limit(r.h, "demo")
    key = str(r.body.get("key", ""))
    if len(key) != 32 or any(c not in "0123456789abcdef" for c in key):
        raise Denied("Open a new demonstration first.", 400, "invalid_demo_key")
    org_id = "demo-" + key
    with r.sedens.db() as db:
        exists = db.execute("SELECT demo FROM p_organizations WHERE id=?", (org_id,)).fetchone()
    if exists is None:
        # Seed the same isolated demonstration workspace the platform demo uses.
        r.sedens.repo.demo_login(key, "admin")
    demo.ensure(r.sedens, org_id)
    device_token, device = rooms.ensure_demo_device(r.sedens, org_id, demo.room_id(org_id), r.device_token)
    r.cookie(rooms.DEVICE_COOKIE, device_token, "/sedens/", rooms.DEVICE_DAYS * 86400)
    return {"device": device, "credentials": demo.public_credentials()}


def _demo_credentials(r):
    r.demo_allowed()
    with r.sedens.db() as db:
        device = rooms.require_device(r.sedens, db, r.device_token)
    if not device.demo:
        raise Denied("Demonstration codes exist only on demonstration screens.", 404, "demo_only")
    return demo.public_credentials()


def _register_creator(r):
    _limit(r.h, "register")
    b = r.body
    token = onboarding.register_creator_studio(
        r.sedens, name=b.get("name"), email=b.get("email"), password=b.get("password"),
        studio_name=b.get("studio_name", ""), display_name=b.get("display_name", ""),
        creator_type=b.get("creator_type", "professor"),
    )
    r.set_cookies.append(platform_http.cookie(r.h, token))
    r.cookies["motion_session"] = token
    return {"me": _me(r)}


def _creator_profile(r):
    actor = r.actor()
    with r.sedens.db() as db:
        profile = creators.profile_row(db, actor.user_id)
        return {
            "capabilities": sorted(capabilities.effective(r.sedens, db, actor)),
            "profile": creators.public(profile),
            "distribution_targets": creators.distribution_targets(r.sedens, db, profile["id"]) if profile else [],
        }


def _creator_profile_save(r):
    actor = r.actor()
    with r.sedens.db() as db:
        return creators.save_profile(r.sedens, db, actor, r.body.get("profile", r.body))


def _creator_verification(r):
    actor = r.actor()
    with r.sedens.db() as db:
        return creators.request_verification(r.sedens, db, actor)


def _creator_affiliations(r):
    actor = r.actor()
    with r.sedens.db() as db:
        capabilities.require(r.sedens, db, actor, "creator")
        return {"items": creators.creator_affiliations(r.sedens, db, actor)}


def _creator_affiliation_request(r):
    _limit(r.h, "affiliation")
    actor = r.actor()
    with r.sedens.db() as db:
        return creators.request_affiliation(r.sedens, db, actor, r.body.get("org_id"), r.body.get("location_id"),
                                            r.body.get("note", ""))


def _affiliation_revoke(r):
    _limit(r.h, "affiliation")
    actor = r.actor()
    with r.sedens.db() as db:
        return creators.revoke_affiliation(r.sedens, db, actor, r.body.get("id"))


def _facility_rooms(r):
    actor = r.actor()
    return {"locations": rooms.facility_rooms(r.sedens, actor)}


def _facility_confirm(r):
    _limit(r.h, "confirm")
    actor = r.actor()
    return rooms.confirm_pairing(r.sedens, actor, r.body.get("code"), r.body.get("room_id"), r.body.get("name", ""))


def _facility_revoke(r):
    return rooms.revoke_device(r.sedens, r.actor(), r.body.get("device_id"))


def _facility_crm(r):
    actor = r.actor()
    if actor.role != "admin":
        raise Denied("Only a facility administrator can see CRM settings.", 403, "admin_required")
    with r.sedens.db() as db:
        return crm.public_settings(db, actor.org_id)


def _facility_crm_save(r):
    actor = r.actor()
    with r.sedens.db() as db:
        return crm.update_policy(r.sedens, db, actor, enabled=r.body.get("enabled"),
                                 require_booking=r.body.get("require_booking"),
                                 booking_grace_minutes=r.body.get("booking_grace_minutes"))


def _facility_affiliations(r):
    actor = r.actor()
    with r.sedens.db() as db:
        return {"items": creators.facility_affiliations(r.sedens, db, actor)}


def _facility_affiliation_decide(r):
    actor = r.actor()
    with r.sedens.db() as db:
        return creators.decide_affiliation(r.sedens, db, actor, r.body.get("id"), r.body.get("decision"))


def _facility_people(r):
    actor = r.actor()
    if actor.role != "admin":
        raise Denied("Only a facility administrator can manage creator permissions.", 403, "admin_required")
    with r.sedens.db() as db:
        # Facilities and creator studios manage their own creators. Inside the SEDENS
        # organization the staff list and its permissions are for SEDENS admins only.
        kind = r.sedens.org(db, actor.org_id)["kind"]
        if kind not in capabilities.CREATOR_GRANTING_KINDS:
            capabilities.require(r.sedens, db, actor, "sedens_admin")
        people = []
        for row in db.execute(
            "SELECT DISTINCT u.id,u.name FROM p_users u JOIN p_roles r ON r.user_id=u.id "
            "WHERE u.org_id=? AND u.active=1 AND r.role IN ('coach','admin') ORDER BY u.name",
            (actor.org_id,),
        ).fetchall():
            user = r.sedens.user(db, row["id"])
            people.append({"id": row["id"], "name": row["name"], "roles": user["roles"],
                           "capabilities": sorted(capabilities.held(r.sedens, db, row["id"]))})
        return {"items": people}


def _grant(r, scope):
    actor = r.actor()
    capability, user_id = r.body.get("capability"), r.body.get("user_id")
    if scope == "facility" and capability != "creator":
        raise Denied("Facilities can grant creator tools only.", 403, "not_permitted")
    with r.sedens.db() as db:
        if scope == "admin":
            capabilities.require(r.sedens, db, actor, "sedens_admin")
        change = capabilities.grant if r.body.get("grant", True) else capabilities.revoke
        return {"user_id": user_id, "capabilities": change(r.sedens, db, actor, user_id, capability)}


def _review_creators(r):
    actor = r.actor()
    with r.sedens.db() as db:
        capabilities.require(r.sedens, db, actor, "sedens_reviewer")
        here = environment(r.sedens.org(db, actor.org_id))
        rows = db.execute(
            "SELECT c.*, u.org_id AS home_org FROM s_creator_profiles c JOIN p_users u ON u.id=c.user_id "
            "JOIN p_organizations o ON o.id=u.org_id WHERE o.demo=? "
            "ORDER BY CASE c.verification_state WHEN 'pending' THEN 0 ELSE 1 END, c.updated_at DESC",
            (int(actor.demo),),
        ).fetchall()
        return {"items": [creators.public(row) for row in rows
                          if environment(r.sedens.org(db, row["home_org"])) == here]}


def _review_decide(r):
    actor = r.actor()
    with r.sedens.batch(), r.sedens.db() as db:
        return creators.decide_verification(r.sedens, db, actor, r.body.get("creator_id"), r.body.get("decision"),
                                            r.body.get("note", ""), r.body.get("version"))


ROUTES = {
    ("GET", "config"): _config,
    ("GET", "me"): _me,
    ("GET", "library/preview"): lambda r: library.preview(),
    ("GET", "consent/texts"): lambda r: consent.texts(),
    ("GET", "consents"): _consents,
    ("POST", "consents"): _consent_save,
    # room screen
    ("GET", "room/device"): lambda r: rooms.describe_device(r.sedens, r.device_token, r.platform_token),
    ("POST", "access-code"): _access_code,
    ("POST", "room/pairing/start"): _pairing_start,
    ("GET", "room/pairing/status"): _pairing_status,
    ("POST", "room/enter"): _enter,
    # room-only (rooms.authorize on every call)
    ("GET", "room/session"): _room_session,
    ("POST", "room/end"): _room_end,
    ("GET", "room/library"): _room_library,
    ("POST", "room/event"): _room_event,
    ("GET", "room/consents"): _room_consents,
    ("POST", "room/consent"): _room_consent,
    # demonstration
    ("POST", "demo/enter"): _demo_enter,
    ("POST", "demo/room-device"): _demo_room_device,
    ("GET", "demo/credentials"): _demo_credentials,
    # creators
    ("POST", "auth/register-creator"): _register_creator,
    ("GET", "creator/profile"): _creator_profile,
    ("POST", "creator/profile"): _creator_profile_save,
    ("POST", "creator/verification/request"): _creator_verification,
    ("GET", "creator/affiliations"): _creator_affiliations,
    ("POST", "creator/affiliations/request"): _creator_affiliation_request,
    ("POST", "creator/affiliations/revoke"): _affiliation_revoke,
    # facility administration
    ("GET", "facility/rooms"): _facility_rooms,
    ("POST", "facility/devices/confirm"): _facility_confirm,
    ("POST", "facility/devices/revoke"): _facility_revoke,
    ("GET", "facility/crm"): _facility_crm,
    ("POST", "facility/crm"): _facility_crm_save,
    ("GET", "facility/affiliations"): _facility_affiliations,
    ("POST", "facility/affiliations/decide"): _facility_affiliation_decide,
    ("POST", "facility/affiliations/revoke"): _affiliation_revoke,
    ("GET", "facility/people"): _facility_people,
    ("POST", "facility/capabilities"): lambda r: _grant(r, "facility"),
    # SEDENS platform
    ("POST", "admin/capabilities"): lambda r: _grant(r, "admin"),
    ("GET", "review/creators"): _review_creators,
    ("POST", "review/creators/decide"): _review_decide,
}
ROUTES.update(course_http.ROUTES)


def dispatch(h, method, route):
    sedens = getattr(h, "sedens", None)
    if sedens is None:
        _respond(h, {"error": "SEDENS needs a configured database.", "code": "no_database"}, 503)
        return
    action = route.path.removeprefix("/sedens/")
    query = {k: v[0] for k, v in parse_qs(route.query).items()}
    request = Request(h, sedens, method, action, query)
    try:
        stream = course_http.STREAMS.get((method, action))
        if stream is not None:
            # These read the body or write the response themselves.
            if method == "POST":
                _guard(h)
            result = stream(request)
            if result is not None:
                _respond(h, result, 200, request.set_cookies)
            return
        handler = ROUTES.get((method, action))
        if handler is None:
            raise Denied("This SEDENS route is not available.", 404, "not_found")
        if method == "POST":
            _guard(h)
            request.body = h._payload(256_000)
        result = handler(request)
        _respond(h, result, 200, request.set_cookies)
    except Denied as exc:
        payload = {"error": str(exc), "code": exc.code}
        if getattr(exc, "decision", None):
            payload["decision"] = exc.decision
        cookies = list(request.set_cookies)
        if exc.code in ("room_session_expired", "room_session_ended", "room_session_idle"):
            cookies.append(_cookie(h, rooms.ROOM_COOKIE, "", "/sedens/", 0))
        _respond(h, payload, exc.status, cookies)
    except Refused as exc:
        code = "sign_in_required" if exc.status == 401 else "refused"
        _respond(h, {"error": str(exc), "code": code}, exc.status, request.set_cookies)
    except Exception as exc:  # noqa: BLE001 - mapped to safe messages below
        from ..api import Refused as RequestRefused

        if isinstance(exc, RequestRefused):
            _respond(h, {"error": str(exc), "code": "invalid_request"}, exc.status)
        elif isinstance(exc, (ValueError, TypeError, KeyError)):
            _respond(h, {"error": "Check the form values and try again.", "code": "invalid"}, 400)
        elif isinstance(exc, sqlite3.IntegrityError):
            _respond(h, {"error": "This change conflicts with a linked record.", "code": "conflict"}, 409)
        elif isinstance(exc, sqlite3.OperationalError):
            logging.exception("SEDENS storage failure")
            _respond(h, {"error": "Storage is unavailable. Retry shortly.", "code": "storage"}, 503)
        elif isinstance(exc, (BrokenPipeError, ConnectionResetError)):
            pass
        else:
            logging.exception("SEDENS request failed: %s", action)
            _respond(h, {"error": "The server could not complete this action.", "code": "server_error"}, 500)
