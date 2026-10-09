"""SEDENS additions to a demonstration organization. Everything here is labelled
DEMO or SIMULATED and lives only in ``demo-<key>`` organizations.

On top of the existing connected-platform demo seed (unchanged), this adds:

* the facility profile "SEDENS Demo Fitness Center";
* a self-guided room, "AI Private Room 01", at the first location;
* the simulated demo CRM with four fictional memberships covering an allowed
  entry, no booking, an inactive membership and a booking for another room;
* a creator permission and unverified creator profile for the first coach;
* the demonstration marketplace (:mod:`pilates.sedens.demo_marketplace`).

The access codes below are public demonstration values, shown on the demo room
screen. They are stored only as hashes and work only in demonstration orgs.
"""

from __future__ import annotations

import threading

from . import capabilities, creators, crm, demo_marketplace
from ..platform.repository import Actor
from .util import Denied, digest, now

FACILITY_NAME = "SEDENS Demo Fitness Center"
ROOM_NAME = "AI Private Room 01"
# member_ref, student suffix, membership, booking ("room" | "other_room" | None), qr code
MEMBERS = [
    ("DEMO-1001", "student00", "active", "room", "SEDENS-QR-1001"),
    ("DEMO-1002", "student01", "active", None, "SEDENS-QR-1002"),
    ("DEMO-1003", "student02", "inactive", "room", "SEDENS-QR-1003"),
    ("DEMO-1004", "student03", "active", "other_room", "SEDENS-QR-1004"),
]
DEMO_PIN = "2580"
DEMO_RESERVATION_CODE = "BK-1001"
_LOCK = threading.Lock()


def room_id(org_id):
    return f"{org_id}-sedens-room01"


def public_credentials():
    """What the demonstration screen may display to an investor."""
    return {
        "simulated": True,
        "members": [
            {"member_ref": ref, "membership": status, "booking": booking or "none", "qr_code": qr,
             "member_pin": DEMO_PIN}
            for ref, _, status, booking, qr in MEMBERS
        ],
        "reservation_code": DEMO_RESERVATION_CODE,
    }


def ensure(sedens, org_id) -> dict:
    """Idempotently add the SEDENS demonstration layer to a seeded demo org.

    The coaching-workspace demo is editable (clients and locations can be
    deleted), so seed rows that are gone are skipped rather than assumed."""
    with _LOCK, sedens.batch():
        with sedens.db() as db:
            org = sedens.org(db, org_id)
            if org is None or not org["demo"]:
                raise ValueError("SEDENS demonstration data belongs only in demonstration organizations")
            room = room_id(org_id)
            current = db.execute("SELECT location_id FROM p_rooms WHERE id=?", (room,)).fetchone()
            location = current[0] if current else _location(db, org_id)
            if location is None:
                raise Denied("This demonstration was changed and has no location left. Open a new demonstration.",
                             409, "demo_changed")
            if db.execute("SELECT 1 FROM s_org_profiles WHERE org_id=?", (org_id,)).fetchone() is None:
                sedens.set_org_profile(db, org_id, "facility", FACILITY_NAME, "ko")
            if current is None:
                db.execute("INSERT INTO p_rooms VALUES (?,?,?,?)", (room, location, ROOM_NAME, 1))
            if db.execute("SELECT 1 FROM s_crm_settings WHERE org_id=?", (org_id,)).fetchone() is None:
                other_room = f"{location}-room"
                members, bookings = [], []
                for ref, suffix, status, booking, qr in MEMBERS:
                    hashes = {"qr": digest(qr), "member_pin": digest(f"{ref}:{DEMO_PIN}")}
                    if ref == "DEMO-1001":
                        hashes["reservation"] = digest(DEMO_RESERVATION_CODE)
                    members.append({"member_ref": ref, "membership": status, "credential_hashes": hashes})
                    if booking:
                        bookings.append({
                            "reference": "DEMO-BOOKING-" + ref[-4:], "member_ref": ref, "status": "booked",
                            "room_id": room if booking == "room" else other_room,
                            "relative": {"start_minutes": -15, "duration_minutes": 120},
                        })
                    if _exists(db, "p_students", f"{org_id}-{suffix}"):
                        crm.link_member(sedens, db, org_id, "demo", ref, f"{org_id}-{suffix}")
                crm.save_settings(sedens, db, org_id, "demo", enabled=True, config={
                    "require_booking": True, "booking_grace_minutes": 15, "use_platform_reservations": True,
                    "members": members, "bookings": bookings,
                })
            coach = f"{org_id}-coach0"
            if db.execute(
                "SELECT 1 FROM p_users u JOIN p_roles r ON r.user_id=u.id AND r.role='coach' WHERE u.id=? AND u.active=1",
                (coach,),
            ).fetchone() and not db.execute(
                "SELECT 1 FROM s_capabilities WHERE user_id=? AND capability='creator'", (coach,)
            ).fetchone():
                capabilities.grant(sedens, db, None, coach, "creator", cli=True)
                creators.save_profile(sedens, db, Actor(coach, org_id, "coach", True), {
                    "display_name": "Hana Lee", "creator_type": "coach",
                    "bio": "Fictional demonstration coach.",
                })
        # Courses, a fictional creator studio and a demonstration reviewer (seeded once).
        demo_marketplace.ensure(sedens, org_id)
        return {"org_id": org_id, "room_id": room, "facility": FACILITY_NAME, "seeded_at": now()}


def _location(db, org_id):
    """The seeded first location, or any location the visitor kept."""
    row = db.execute(
        "SELECT id FROM p_locations WHERE org_id=? ORDER BY id=? DESC, id LIMIT 1", (org_id, f"{org_id}-location0")
    ).fetchone()
    return row[0] if row else None


def _exists(db, table, identifier) -> bool:
    return db.execute(f"SELECT 1 FROM {table} WHERE id=?", (identifier,)).fetchone() is not None
