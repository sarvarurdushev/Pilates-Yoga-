"""Room devices, device pairing and room sessions: the room-only authorization.

A room-only endpoint is reachable only when **all four** hold, checked on the
server for every request (:func:`authorize`):

1. an authenticated customer -- an active ``student`` of the facility, whose
   identity was established at entry by a single-use room access code they
   requested on their own signed-in device, or by a CRM credential the CRM
   adapter declared authenticating. Customers never sign in on the shared
   screen, so the screen never holds a customer's account session;
2. a paired room device -- an active ``s_room_devices`` row whose token was
   issued only to the browser that started a pairing confirmed by that
   facility's administrator (or a simulated device in a demonstration org);
3. an active, unexpired room session bound to that customer and that device;
4. matching scope -- device, session, room, location and organization agree.

A customer's ordinary sign-in alone never satisfies (2) or (3). Administrators
and coaches cannot start room sessions: room sessions belong to customers.
Demonstration organizations can never confirm a pairing; their screens are
always the labelled simulated kind.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta
import os
import secrets

from . import analytics, crm
from .util import Denied, digest, iso, now, parse, text, token, uid, utcnow

DEVICE_COOKIE = "sedens_device"
ROOM_COOKIE = "sedens_room"
PAIRING_COOKIE = "sedens_pairing"
PAIRING_MINUTES = 10
CLAIM_MINUTES = 30
DEVICE_DAYS = 180
CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
CODE_LENGTH = 8
MAX_SIMULATED_PER_ROOM = 5
ACCESS_CODE_MINUTES = 5
BOOKING_OVERRUN_MINUTES = 30


def session_minutes(env=None) -> int:
    env = os.environ if env is None else env
    try:
        value = int(env.get("SEDENS_ROOM_SESSION_MINUTES", "120"))
    except ValueError:
        value = 120
    return max(15, min(240, value))


@dataclass(frozen=True)
class Device:
    id: str
    org_id: str
    location_id: str
    room_id: str
    name: str
    simulated: bool
    demo: bool


@dataclass(frozen=True)
class RoomContext:
    room_session_id: str
    org_id: str
    location_id: str
    room_id: str
    device_id: str
    student_id: str
    entry_method: str
    simulated: bool
    demo: bool
    expires_at: str


def normalize_code(code) -> str:
    return "".join(ch for ch in str(code or "").upper() if ch.isalnum())


def _room_scope(db, room_id):
    return db.execute(
        "SELECT r.id AS room_id, r.name AS room_name, r.location_id, l.org_id, l.name AS location_name "
        "FROM p_rooms r JOIN p_locations l ON l.id=r.location_id WHERE r.id=?",
        (room_id,),
    ).fetchone()


def _device_public(db, row) -> dict:
    scope = _room_scope(db, row["room_id"])
    return {
        "id": row["id"],
        "name": row["name"],
        "status": row["status"],
        "simulated": bool(row["simulated"]),
        "paired": row["token_hash"] is not None,
        "room_id": row["room_id"],
        "room_name": scope["room_name"] if scope else None,
        "location_id": row["location_id"],
        "location_name": scope["location_name"] if scope else None,
        "created_at": row["created_at"],
        "last_seen_at": row["last_seen_at"],
        "revoked_at": row["revoked_at"],
    }


# -- pairing -------------------------------------------------------------------


def start_pairing(sedens, client_hint="") -> dict:
    """An unpaired screen asks to be paired. Returns a code to show and a secret
    the server sets as an HttpOnly cookie on that screen only."""
    with sedens.db() as db:
        stamp = now()
        db.execute(
            "UPDATE s_room_device_pairings SET state='expired' WHERE state='pending' AND expires_at<?",
            (stamp,),
        )
        db.execute(
            "DELETE FROM s_room_device_pairings WHERE state IN ('expired','cancelled','claimed') AND created_at<?",
            (iso(utcnow() - timedelta(days=1)),),
        )
        for _ in range(10):
            code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))
            secret = token()
            if db.execute(
                "SELECT 1 FROM s_room_device_pairings WHERE code_hash=? OR secret_hash=?",
                (digest(code), digest(secret)),
            ).fetchone():
                continue
            expires = iso(utcnow() + timedelta(minutes=PAIRING_MINUTES))
            db.execute(
                "INSERT INTO s_room_device_pairings(id,code_hash,secret_hash,state,created_at,expires_at,client_hint) "
                "VALUES (?,?,?,?,?,?,?)",
                (uid(), digest(code), digest(secret), "pending", stamp, expires, str(client_hint or "")[:160]),
            )
            return {"code": code[:4] + "-" + code[4:], "secret": secret, "expires_at": expires}
    raise Denied("Could not create a pairing code. Retry.", 503, "pairing_unavailable")


def confirm_pairing(sedens, actor, code, room_id, name="") -> dict:
    """A facility administrator confirms the code shown on a room screen."""
    if actor.role != "admin":
        raise Denied("Only a facility administrator can pair a room screen.", 403, "admin_required")
    # BEGIN IMMEDIATE: two administrators confirming the same code at once are
    # serialized, and only the first confirmation can claim it.
    with sedens.batch(), sedens.db() as db:
        org = sedens.org(db, actor.org_id)
        if org is None or org["kind"] != "facility":
            raise Denied("Room screens belong to a facility.", 400, "not_a_facility")
        if org["demo"]:
            raise Denied(
                "Demonstration facilities use simulated room screens and cannot pair a real screen.",
                403,
                "demo_cannot_pair",
            )
        scope = _room_scope(db, room_id)
        if scope is None or scope["org_id"] != actor.org_id:
            raise Denied("Choose a room of your facility.", 404, "unknown_room")
        pairing = db.execute(
            "SELECT * FROM s_room_device_pairings WHERE code_hash=? AND state='pending'",
            (digest(normalize_code(code)),),
        ).fetchone()
        stamp = now()
        if pairing is None or parse(pairing["expires_at"]) < utcnow():
            raise Denied(
                "That pairing code is not valid. Start pairing again on the room screen.", 404, "pairing_code_invalid"
            )
        claimed = db.execute(
            "UPDATE s_room_device_pairings SET state='confirmed', confirmed_by=?, confirmed_at=? "
            "WHERE id=? AND state='pending'",
            (actor.user_id, stamp, pairing["id"]),
        ).rowcount
        if not claimed:
            raise Denied(
                "That pairing code is not valid. Start pairing again on the room screen.", 404, "pairing_code_invalid"
            )
        device_id = uid()
        db.execute(
            "INSERT INTO s_room_devices(id,org_id,location_id,room_id,name,status,token_hash,simulated,created_by,created_at) "
            "VALUES (?,?,?,?,?,'active',NULL,0,?,?)",
            (device_id, actor.org_id, scope["location_id"], room_id,
             text(name, 80, "Screen name") or "Room screen", actor.user_id, stamp),
        )
        db.execute("UPDATE s_room_device_pairings SET device_id=? WHERE id=?", (device_id, pairing["id"]))
        sedens.audit(db, actor.org_id, actor.user_id, "room:device-confirm", device_id, {"room_id": room_id})
        analytics.record(db, "device_paired", org_id=actor.org_id, room_id=room_id, device_id=device_id,
                         demo=org["demo"], props={"simulated": False})
        row = db.execute("SELECT * FROM s_room_devices WHERE id=?", (device_id,)).fetchone()
        return _device_public(db, row)


def claim_pairing(sedens, secret) -> dict:
    """The screen that started a pairing collects its device token, once."""
    with sedens.db() as db:
        pairing = db.execute(
            "SELECT * FROM s_room_device_pairings WHERE secret_hash=?", (digest(secret),)
        ).fetchone() if secret else None
        if pairing is None:
            return {"state": "unknown"}
        stamp = now()
        if pairing["state"] == "pending":
            if parse(pairing["expires_at"]) < utcnow():
                db.execute("UPDATE s_room_device_pairings SET state='expired' WHERE id=?", (pairing["id"],))
                return {"state": "expired"}
            return {"state": "pending", "expires_at": pairing["expires_at"]}
        if pairing["state"] != "confirmed":
            return {"state": pairing["state"]}
        if parse(pairing["confirmed_at"]) < utcnow() - timedelta(minutes=CLAIM_MINUTES):
            db.execute("UPDATE s_room_device_pairings SET state='expired' WHERE id=?", (pairing["id"],))
            return {"state": "expired"}
        device_token = token()
        changed = db.execute(
            "UPDATE s_room_devices SET token_hash=? WHERE id=? AND token_hash IS NULL AND status='active'",
            (digest(device_token), pairing["device_id"]),
        ).rowcount
        if not changed:
            return {"state": "unavailable"}
        db.execute(
            "UPDATE s_room_device_pairings SET state='claimed', claimed_at=? WHERE id=?",
            (stamp, pairing["id"]),
        )
        row = db.execute("SELECT * FROM s_room_devices WHERE id=?", (pairing["device_id"],)).fetchone()
        return {"state": "paired", "token": device_token, "device": _device_public(db, row)}


# -- devices -------------------------------------------------------------------


def device_for_token(sedens, db, device_token) -> Device | None:
    if not device_token:
        return None
    row = db.execute(
        "SELECT d.*, r.location_id AS room_location, l.org_id AS location_org FROM s_room_devices d "
        "JOIN p_rooms r ON r.id=d.room_id JOIN p_locations l ON l.id=d.location_id "
        "WHERE d.token_hash=? AND d.status='active'",
        (digest(device_token),),
    ).fetchone()
    if row is None or row["room_location"] != row["location_id"] or row["location_org"] != row["org_id"]:
        return None
    org = sedens.org(db, row["org_id"])
    if org is None or org["kind"] != "facility":
        return None
    if row["simulated"] and not org["demo"]:
        return None
    if org["demo"] and not sedens.mode.demo_enabled:
        return None
    return Device(row["id"], row["org_id"], row["location_id"], row["room_id"], row["name"],
                  bool(row["simulated"]), org["demo"])


def require_device(sedens, db, device_token) -> Device:
    device = device_for_token(sedens, db, device_token)
    if device is None:
        raise Denied(
            "This screen is not a paired SEDENS room. Ask facility staff to pair it.", 403, "device_not_paired"
        )
    return device


def describe_device(sedens, device_token, platform_token="") -> dict:
    actor = _platform_actor(sedens, platform_token)
    # An account signed in on a shared screen is shown so it can be signed out.
    signed_in = None if actor is None else {"role": actor.role}
    with sedens.db() as db:
        device = device_for_token(sedens, db, device_token)
        if device is None:
            return {"paired": False, "screen_account": signed_in}
        scope = _room_scope(db, device.room_id)
        org = sedens.org(db, device.org_id)
        settings = crm.public_settings(db, device.org_id)
        return {
            "paired": True,
            "device": {"id": device.id, "name": device.name, "simulated": device.simulated},
            "room": {"id": device.room_id, "name": scope["room_name"]},
            "location": {"id": device.location_id, "name": scope["location_name"]},
            "facility": {"id": org["id"], "name": org["display_name"], "demo": org["demo"]},
            "entry_methods": settings["methods"] if settings["enabled"] else [],
            "crm": {"provider": settings["provider"], "simulated": settings["simulated"],
                    "require_booking": settings["require_booking"]},
            "screen_account": signed_in,
        }


def facility_rooms(sedens, actor) -> list:
    if actor.role != "admin":
        raise Denied("Only a facility administrator can manage room screens.", 403, "admin_required")
    with sedens.db() as db:
        out = []
        for location in db.execute(
            "SELECT id,name FROM p_locations WHERE org_id=? ORDER BY name", (actor.org_id,)
        ).fetchall():
            rooms = []
            for room in db.execute(
                "SELECT id,name,capacity FROM p_rooms WHERE location_id=? ORDER BY name", (location["id"],)
            ).fetchall():
                devices = [
                    _device_public(db, d)
                    for d in db.execute(
                        "SELECT * FROM s_room_devices WHERE room_id=? AND org_id=? ORDER BY created_at DESC",
                        (room["id"], actor.org_id),
                    )
                ]
                rooms.append({**dict(room), "devices": devices})
            out.append({"id": location["id"], "name": location["name"], "rooms": rooms})
        return out


def revoke_device(sedens, actor, device_id) -> dict:
    with sedens.db() as db:
        row = db.execute("SELECT * FROM s_room_devices WHERE id=?", (device_id,)).fetchone()
        if row is None or actor.role != "admin" or row["org_id"] != actor.org_id:
            raise Denied("Choose a room screen of your facility.", 404, "unknown_device")
        stamp = now()
        db.execute(
            "UPDATE s_room_devices SET status='revoked', token_hash=NULL, revoked_by=?, revoked_at=? WHERE id=?",
            (actor.user_id, stamp, device_id),
        )
        _end_where(db, "device_id=?", (device_id,), "revoked", "device_revoked", actor.org_id,
                   sedens.org(db, actor.org_id)["demo"])
        sedens.audit(db, actor.org_id, actor.user_id, "room:device-revoke", device_id)
        analytics.record(db, "device_revoked", org_id=actor.org_id, room_id=row["room_id"], device_id=device_id,
                         demo=sedens.org(db, actor.org_id)["demo"])
        return _device_public(db, db.execute("SELECT * FROM s_room_devices WHERE id=?", (device_id,)).fetchone())


def ensure_demo_device(sedens, org_id, room_id, current_token="") -> tuple[str, dict]:
    """A simulated, labelled room screen for a demonstration organization only."""
    with sedens.db() as db:
        org = sedens.org(db, org_id)
        if org is None or not org["demo"] or org["kind"] != "facility":
            raise Denied("Simulated room screens exist only in demonstration facilities.", 403, "demo_only")
        scope = _room_scope(db, room_id)
        if scope is None or scope["org_id"] != org_id:
            raise Denied("Choose a room of this demonstration facility.", 404, "unknown_room")
        existing = device_for_token(sedens, db, current_token)
        if existing and existing.simulated and existing.room_id == room_id:
            row = db.execute("SELECT * FROM s_room_devices WHERE id=?", (existing.id,)).fetchone()
            return current_token, _device_public(db, row)
        device_token, device_id, stamp = token(), uid(), now()
        db.execute(
            "INSERT INTO s_room_devices(id,org_id,location_id,room_id,name,status,token_hash,simulated,created_at,detail) "
            "VALUES (?,?,?,?,?,'active',?,1,?,?)",
            (device_id, org_id, scope["location_id"], room_id, "Demo room screen (simulated)",
             digest(device_token), stamp, '{"simulated_pairing":true}'),
        )
        stale = db.execute(
            "SELECT id FROM s_room_devices WHERE room_id=? AND simulated=1 AND status='active' "
            "ORDER BY created_at DESC LIMIT -1 OFFSET ?",
            (room_id, MAX_SIMULATED_PER_ROOM),
        ).fetchall()
        for (old,) in stale:
            db.execute("UPDATE s_room_devices SET status='revoked', token_hash=NULL, revoked_at=? WHERE id=?", (stamp, old))
            _end_where(db, "device_id=?", (old,), "revoked", "device_revoked", org_id, True)
        analytics.record(db, "device_paired", org_id=org_id, room_id=room_id, device_id=device_id, demo=True,
                         props={"simulated": True})
        row = db.execute("SELECT * FROM s_room_devices WHERE id=?", (device_id,)).fetchone()
        return device_token, _device_public(db, row)


# -- room sessions ---------------------------------------------------------------


def _end_where(db, where, args, state, reason, org_id, demo):
    stamp = now()
    for row in db.execute(
        f"SELECT id,room_id,device_id FROM s_room_sessions WHERE state='active' AND {where}", args
    ).fetchall():
        db.execute(
            "UPDATE s_room_sessions SET state=?, ended_at=?, end_reason=? WHERE id=?",
            (state, stamp, reason, row["id"]),
        )
        analytics.record(db, "room_session_ended", org_id=org_id, room_id=row["room_id"], device_id=row["device_id"],
                         room_session_id=row["id"], demo=demo, props={"reason": reason})


def _customer(db, user_id, org_id):
    return db.execute(
        "SELECT u.id,u.name FROM p_users u JOIN p_students s ON s.id=u.id "
        "JOIN p_roles r ON r.user_id=u.id AND r.role='student' WHERE u.id=? AND u.org_id=? AND u.active=1",
        (user_id, org_id),
    ).fetchone()


def _platform_actor(sedens, platform_token):
    if not platform_token:
        return None
    try:
        return sedens.repo.actor(platform_token)
    except Exception:
        return None


ENTRY_MESSAGES = {
    "customer_required": ("Room access codes are for customers. Staff accounts cannot start a room session.", 403),
    "staff_signed_in": ("A staff account is signed in on this screen. Sign it out before a customer enters.", 403),
    "different_customer_signed_in": ("Another person is signed in on this screen. Sign them out first.", 403),
    "access_code_invalid": ("This room code is not valid. Ask for a new code on your phone.", 403),
    "wrong_facility": ("This code belongs to a different facility.", 403),
    "wrong_location": ("This entry is for a different location.", 403),
    "wrong_room": ("This entry is for a different room.", 403),
    "not_authenticated": ("This code identifies a member but does not confirm who is entering.", 403),
    "customer_not_active": ("This SEDENS profile is not active at this facility.", 403),
}


# -- room access codes -----------------------------------------------------------


def issue_access_code(sedens, actor) -> dict:
    """A customer, signed in on their own device, asks for a single-use room code.

    The code is typed on the room screen. It proves who is entering without the
    customer ever signing in on the shared screen. One live code per customer.
    """
    if actor.role != "student":
        raise Denied("Room access codes are for customers.", 403, "customer_required")
    with sedens.db() as db:
        org = sedens.org(db, actor.org_id)
        if org is None or org["kind"] != "facility":
            raise Denied("Room access codes belong to a facility membership.", 400, "not_a_facility")
        if org["demo"] and not sedens.mode.demo_enabled:
            raise Denied("Demonstrations are switched off on this server.", 404, "demo_disabled")
        if _customer(db, actor.user_id, actor.org_id) is None:
            raise Denied("This SEDENS profile is not active at this facility.", 403, "customer_not_active")
        stamp = now()
        db.execute(
            "UPDATE s_room_access_codes SET cancelled_at=? WHERE student_id=? AND used_at IS NULL AND cancelled_at IS NULL",
            (stamp, actor.user_id),
        )
        db.execute(
            "DELETE FROM s_room_access_codes WHERE student_id=? AND created_at<?",
            (actor.user_id, iso(utcnow() - timedelta(days=30))),
        )
        for _ in range(10):
            code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))
            if db.execute("SELECT 1 FROM s_room_access_codes WHERE code_hash=?", (digest(code),)).fetchone():
                continue
            expires = iso(utcnow() + timedelta(minutes=ACCESS_CODE_MINUTES))
            db.execute(
                "INSERT INTO s_room_access_codes(id,org_id,student_id,code_hash,created_at,expires_at) VALUES (?,?,?,?,?,?)",
                (uid(), actor.org_id, actor.user_id, digest(code), stamp, expires),
            )
            sedens.audit(db, actor.org_id, actor.user_id, "room:access-code", actor.user_id)
            return {"code": code[:4] + "-" + code[4:], "expires_at": expires, "single_use": True}
    raise Denied("Could not create a room code. Retry.", 503, "access_code_unavailable")


def _access_code(db, credential):
    row = db.execute(
        "SELECT * FROM s_room_access_codes WHERE code_hash=? AND used_at IS NULL AND cancelled_at IS NULL",
        (digest(normalize_code(credential)),),
    ).fetchone()
    if row is None or parse(row["expires_at"]) <= utcnow():
        return None
    return row


def enter(sedens, device_token, *, method, credential="", pin="", platform_token="") -> dict:
    """Identify a customer on a paired screen and open a room session.

    ``platform_token`` is only inspected to refuse entry while a staff member or
    a different person is signed in on the shared screen; it never identifies
    the customer.
    """
    denied = None
    result = None
    # BEGIN IMMEDIATE: a single-use code cannot be redeemed twice concurrently.
    with sedens.batch(), sedens.db() as db:
        device = require_device(sedens, db, device_token)
        if method not in crm.METHODS:
            raise Denied("Choose how to enter the room.", 400, "unknown_method")
        actor = _platform_actor(sedens, platform_token)
        request = crm.EntryRequest(
            org_id=device.org_id, location_id=device.location_id, room_id=device.room_id, method=method,
            credential=text(credential, 200, "Code"), pin=text(pin, 20, "PIN"),
        )
        reason, decision, student_id, code_row = None, None, None, None
        if actor is not None and actor.role != "student":
            reason = "staff_signed_in"
        elif method == "access_code":
            code_row = _access_code(db, request.credential)
            if code_row is None:
                reason = "access_code_invalid"
            elif code_row["org_id"] != device.org_id:
                reason = "wrong_facility"
            else:
                request.student_id = student_id = code_row["student_id"]
                request.credential = ""
        if reason is None:
            decision = crm.verify_entry(sedens, db, request)
            if method != "access_code" and decision.member_ref:
                student_id = crm.member_student(db, device.org_id, decision.provider, decision.member_ref)
            if not decision.allowed:
                reason = decision.reason
            elif not decision.authenticated:
                reason = "not_authenticated"
            elif decision.facility_id != device.org_id:
                reason = "wrong_facility"
            elif decision.location_id and decision.location_id != device.location_id:
                reason = "wrong_location"
            elif decision.room_id and decision.room_id != device.room_id:
                reason = "wrong_room"
            elif not student_id:
                reason = "member_not_linked"
            elif _customer(db, student_id, device.org_id) is None:
                reason = "customer_not_active"
            elif actor is not None and actor.user_id != student_id:
                reason = "different_customer_signed_in"
        if reason is not None:
            analytics.record(
                db, "room_entry_denied", org_id=device.org_id, room_id=device.room_id, device_id=device.id,
                demo=device.demo,
                props={"method": method, "reason": reason,
                       "provider": decision.provider if decision else "", "simulated": device.simulated},
            )
            message, status = ENTRY_MESSAGES.get(reason, (crm.REASONS.get(reason, "Entry was not allowed."), 403))
            denied = Denied(message, status, reason)
            denied.decision = decision.public() if decision else None
        else:
            if code_row is not None:
                used = db.execute(
                    "UPDATE s_room_access_codes SET used_at=?, used_device_id=? WHERE id=? AND used_at IS NULL",
                    (now(), device.id, code_row["id"]),
                ).rowcount
                if not used:
                    raise Denied(ENTRY_MESSAGES["access_code_invalid"][0], 403, "access_code_invalid")
            # One active session per screen and per customer.
            _end_where(db, "(device_id=? OR student_id=?)", (device.id, student_id), "ended", "superseded",
                       device.org_id, device.demo)
            started = utcnow()
            expires = started + timedelta(minutes=session_minutes())
            booking = decision.booking
            if booking and booking.exists and booking.ends_at:
                expires = min(expires, parse(booking.ends_at) + timedelta(minutes=BOOKING_OVERRUN_MINUTES))
            room_token, session_id = token(), uid()
            db.execute(
                "INSERT INTO s_room_sessions(id,org_id,location_id,room_id,device_id,student_id,token_hash,entry_method,"
                "crm_provider,crm_reference,reservation_id,state,simulated,started_at,expires_at) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,'active',?,?,?)",
                (
                    session_id, device.org_id, device.location_id, device.room_id, device.id, student_id,
                    digest(room_token), method,
                    decision.provider, booking.reference if booking and booking.exists else "",
                    booking.reservation_id if booking and booking.exists else None,
                    int(device.simulated or decision.simulated), iso(started), iso(expires),
                ),
            )
            common = dict(org_id=device.org_id, user_id=student_id, room_id=device.room_id, device_id=device.id,
                          room_session_id=session_id, demo=device.demo)
            analytics.record(db, "room_entered", **common,
                             props={"method": method, "provider": decision.provider, "simulated": decision.simulated})
            analytics.record(db, "room_session_started", **common,
                             props={"ttl_minutes": int((expires - started).total_seconds() // 60),
                                    "booking": bool(booking and booking.exists)})
            sedens.audit(db, device.org_id, student_id, "room:session-start", session_id,
                         {"device_id": device.id, "method": method, "provider": decision.provider})
            context = RoomContext(session_id, device.org_id, device.location_id, device.room_id, device.id,
                                  student_id, method, bool(device.simulated or decision.simulated), device.demo,
                                  iso(expires))
            result = {"token": room_token, "context": context, "decision": decision.public()}
    if denied is not None:
        raise denied
    return result


def authorize(sedens, device_token, room_token, platform_token="") -> RoomContext:
    """The single gate for every room-only endpoint. Raises :class:`Denied`."""
    failure = None
    context = None
    with sedens.db() as db:
        device = device_for_token(sedens, db, device_token)
        if device is None:
            failure = Denied("This screen is not a paired SEDENS room.", 403, "device_not_paired")
        elif not room_token:
            failure = Denied("Start a room session on this screen first.", 401, "room_session_required")
        else:
            row = db.execute("SELECT * FROM s_room_sessions WHERE token_hash=?", (digest(room_token),)).fetchone()
            stamp = now()
            if row is None:
                failure = Denied("Start a room session on this screen first.", 401, "room_session_required")
            elif row["state"] != "active":
                failure = Denied("This room session has ended.", 401, "room_session_ended")
            elif parse(row["expires_at"]) <= utcnow():
                _end_where(db, "id=?", (row["id"],), "expired", "expired", row["org_id"], device.demo)
                failure = Denied("This room session has expired.", 401, "room_session_expired")
            elif (
                row["device_id"] != device.id
                or row["room_id"] != device.room_id
                or row["location_id"] != device.location_id
                or row["org_id"] != device.org_id
            ):
                failure = Denied("This room session belongs to a different room screen.", 403, "room_scope_mismatch")
            elif _customer(db, row["student_id"], row["org_id"]) is None:
                failure = Denied("This SEDENS profile is no longer active here.", 403, "customer_not_active")
            elif row["crm_provider"] == "none" and not db.execute(
                "SELECT 1 FROM p_student_locations WHERE student_id=? AND location_id=?",
                (row["student_id"], row["location_id"]),
            ).fetchone():
                # Without a CRM, the facility's location assignment is the membership.
                _end_where(db, "id=?", (row["id"],), "revoked", "location_unassigned", row["org_id"], device.demo)
                failure = Denied("This membership no longer includes this location.", 403, "not_assigned_to_location")
            else:
                actor = _platform_actor(sedens, platform_token)
                if actor is not None and actor.user_id != row["student_id"]:
                    failure = Denied("Another account is signed in on this screen.", 403, "different_account_signed_in")
                else:
                    db.execute(
                        "UPDATE s_room_devices SET last_seen_at=? WHERE id=? AND (last_seen_at IS NULL OR last_seen_at<?)",
                        (stamp, device.id, iso(utcnow() - timedelta(seconds=60))),
                    )
                    context = RoomContext(
                        row["id"], row["org_id"], row["location_id"], row["room_id"], row["device_id"],
                        row["student_id"], row["entry_method"], bool(row["simulated"]), device.demo,
                        row["expires_at"],
                    )
    if failure is not None:
        raise failure
    return context


def end(sedens, context: RoomContext, reason="ended") -> None:
    with sedens.db() as db:
        _end_where(db, "id=?", (context.room_session_id,), "ended", reason, context.org_id, context.demo)
        sedens.audit(db, context.org_id, context.student_id, "room:session-end", context.room_session_id, {"reason": reason})


def describe(sedens, context: RoomContext) -> dict:
    with sedens.db() as db:
        scope = _room_scope(db, context.room_id)
        org = sedens.org(db, context.org_id)
        customer = _customer(db, context.student_id, context.org_id)
        first = (customer["name"] if customer else "").split(" ")[0]
        return {
            "room_session_id": context.room_session_id,
            "facility": {"id": org["id"], "name": org["display_name"], "demo": org["demo"]},
            "location": {"id": context.location_id, "name": scope["location_name"]},
            "room": {"id": context.room_id, "name": scope["room_name"]},
            "customer": {"first_name": first},
            "entry_method": context.entry_method,
            "simulated": context.simulated,
            "expires_at": context.expires_at,
        }
