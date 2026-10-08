"""Facility CRM adapters: who may enter which room, and whether they booked it.

SEDENS never depends on one CRM vendor. A facility's CRM is reached through a
:class:`CRMProvider`. Phase 1 ships two:

``none``  The facility has no CRM connection. A customer enters with a room
          access code requested on their own signed-in device, and only at a
          location the facility assigned them to. No booking is required.
``demo``  A *simulated* CRM for demonstration organizations only. Its members,
          access codes and bookings are fixtures; every decision it returns is
          marked ``simulated``. It is refused for real organizations.

The contract a real adapter (for example a future BROJ adapter) must meet is in
``docs/SEDENS_CRM_ADAPTER.md``. Adapters return decisions; SEDENS alone maps a
member to a platform student (``s_crm_member_links``) and issues room sessions.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta
import re

from .util import Denied, decode, digest, encode, iso, now, parse, uid, utcnow

# ``access_code``: SEDENS has already authenticated the customer with a
# single-use code they requested on their own device; the provider decides
# only membership and booking. The other methods are CRM credentials.
METHODS = ("access_code", "qr", "reservation", "member_id")
REASONS = {
    "allowed": "Entry allowed.",
    "facility_membership": "Entry allowed for a member assigned to this location.",
    "unknown_member": "This membership could not be found.",
    "invalid_credential": "This code was not recognised.",
    "membership_inactive": "This membership is not active.",
    "no_booking": "There is no booking for this room right now.",
    "booking_other_room": "Your booking is for a different room.",
    "not_assigned_to_location": "This account is not assigned to this location.",
    "member_not_linked": "This membership is not connected to a SEDENS profile at this facility.",
    "method_not_supported": "This way of entering is not available here.",
    "provider_disabled": "Room entry through the facility system is switched off.",
}
_SECRET_KEY = re.compile(r"(secret|passw|api[_-]?key|token|private|bearer|cookie)", re.I)


@dataclass
class EntryRequest:
    org_id: str
    location_id: str
    room_id: str
    method: str
    credential: str = ""
    pin: str = ""
    member_ref: str | None = None  # filled by SEDENS for access_code entries
    student_id: str | None = None  # filled by SEDENS for access_code entries
    at: datetime = field(default_factory=utcnow)


@dataclass
class Booking:
    exists: bool
    reference: str = ""
    reservation_id: str | None = None
    room_id: str | None = None
    location_id: str | None = None
    starts_at: str | None = None
    ends_at: str | None = None
    source: str = ""


@dataclass
class EntryDecision:
    provider: str
    allowed: bool
    reason: str
    authenticated: bool
    simulated: bool
    member_ref: str | None = None
    membership: str = "unknown"  # active | inactive | unknown
    booking: Booking | None = None
    facility_id: str | None = None
    location_id: str | None = None
    room_id: str | None = None
    checked_at: str = field(default_factory=now)

    def public(self) -> dict:
        """What the room screen may show. No credentials, no member reference."""
        booking = self.booking
        return {
            "provider": self.provider,
            "allowed": self.allowed,
            "reason": self.reason,
            "message": REASONS.get(self.reason, ""),
            "simulated": self.simulated,
            "membership": self.membership,
            "booking": None
            if booking is None
            else {
                "exists": booking.exists,
                "room_id": booking.room_id,
                "location_id": booking.location_id,
                "starts_at": booking.starts_at,
                "ends_at": booking.ends_at,
            },
            "facility_id": self.facility_id,
            "location_id": self.location_id,
            "room_id": self.room_id,
            "checked_at": self.checked_at,
        }

    def to_dict(self) -> dict:
        return asdict(self)


class CRMProvider:
    name = ""
    simulated = False
    methods: tuple[str, ...] = ()
    demo_only = False

    def verify_entry(self, sedens, db, request: EntryRequest, config: dict) -> EntryDecision:
        raise NotImplementedError

    def decision(self, request, *, allowed, reason, authenticated, **kw) -> EntryDecision:
        return EntryDecision(
            provider=self.name,
            allowed=allowed,
            reason=reason,
            authenticated=authenticated,
            simulated=self.simulated,
            facility_id=request.org_id,
            location_id=kw.pop("location_id", request.location_id),
            room_id=kw.pop("room_id", request.room_id),
            **kw,
        )


def _assigned(db, student_id, location_id) -> bool:
    return bool(
        db.execute(
            "SELECT 1 FROM p_student_locations WHERE student_id=? AND location_id=?",
            (student_id, location_id),
        ).fetchone()
    )


class NoCRMProvider(CRMProvider):
    """The facility's own SEDENS records are the only source of membership."""

    name = "none"
    methods = ("access_code",)

    def verify_entry(self, sedens, db, request, config):
        if request.method not in self.methods or not request.student_id:
            return self.decision(request, allowed=False, reason="method_not_supported", authenticated=False)
        if not _assigned(db, request.student_id, request.location_id):
            return self.decision(
                request, allowed=False, reason="not_assigned_to_location", authenticated=True, membership="unknown"
            )
        return self.decision(
            request, allowed=True, reason="facility_membership", authenticated=True, membership="active",
            booking=Booking(exists=False, source="not_required"),
        )


class DemoCRMProvider(CRMProvider):
    """Simulated CRM for demonstrations. Never used for a real organization.

    ``config`` (non-secret; access codes are stored as SHA-256 hashes)::

        {"require_booking": true, "booking_grace_minutes": 15,
         "use_platform_reservations": true,
         "members": [{"member_ref": "DEMO-1001", "membership": "active",
                      "credential_hashes": {"qr": "<sha256>", "reservation": "<sha256>",
                                            "member_pin": "<sha256 of member_ref:pin>"}}],
         "bookings": [{"reference": "BK-1", "member_ref": "DEMO-1001", "room_id": "...",
                       "relative": {"start_minutes": -15, "duration_minutes": 120}}]}

    A booking with ``relative`` times is recomputed around the moment of the
    check, so a demonstration always has a current booking; with explicit
    ``starts_at``/``ends_at`` it behaves like a real fixed booking.
    """

    name = "demo"
    simulated = True
    demo_only = True
    methods = ("access_code", "qr", "reservation", "member_id")

    def verify_entry(self, sedens, db, request, config):
        members = {m.get("member_ref"): m for m in config.get("members", []) if m.get("member_ref")}
        if request.method not in self.methods:
            return self.decision(request, allowed=False, reason="method_not_supported", authenticated=False)
        member = None
        authenticated = False
        if request.method == "access_code":
            member = members.get(request.member_ref or "")
            authenticated = bool(request.student_id)
        elif request.method in ("qr", "reservation"):
            wanted = digest(request.credential.strip().upper())
            for candidate in members.values():
                if candidate.get("credential_hashes", {}).get(request.method) == wanted:
                    member, authenticated = candidate, True
                    break
            if member is None:
                return self.decision(request, allowed=False, reason="invalid_credential", authenticated=False)
        else:  # member_id: a member number alone identifies but does not authenticate
            ref = request.credential.strip().upper()
            candidate = members.get(ref)
            expected = (candidate or {}).get("credential_hashes", {}).get("member_pin")
            if candidate is None or not expected or digest(f"{ref}:{request.pin.strip()}") != expected:
                return self.decision(request, allowed=False, reason="invalid_credential", authenticated=False)
            member, authenticated = candidate, True
        if member is None:
            return self.decision(request, allowed=False, reason="unknown_member", authenticated=authenticated)
        status = "active" if member.get("membership") == "active" else "inactive"
        student_id = request.student_id or member_student(db, request.org_id, self.name, member["member_ref"])
        booking = self._booking(db, request, config, member["member_ref"], student_id)
        base = dict(authenticated=authenticated, member_ref=member["member_ref"], membership=status, booking=booking)
        if status != "active":
            return self.decision(request, allowed=False, reason="membership_inactive", **base)
        if config.get("require_booking", True):
            if not booking.exists:
                return self.decision(request, allowed=False, reason="no_booking", **base)
            if booking.room_id != request.room_id:
                return self.decision(request, allowed=False, reason="booking_other_room", **base)
        return self.decision(request, allowed=True, reason="allowed", **base)

    def _booking(self, db, request, config, member_ref, student_id) -> Booking:
        grace = timedelta(minutes=max(0, min(120, int(config.get("booking_grace_minutes", 15)))))
        at = request.at
        candidates = []
        for b in config.get("bookings", []):
            if b.get("member_ref") != member_ref or b.get("status", "booked") != "booked":
                continue
            if "relative" in b:
                rel = b["relative"]
                start = at + timedelta(minutes=int(rel.get("start_minutes", -15)))
                end = start + timedelta(minutes=int(rel.get("duration_minutes", 120)))
            else:
                start, end = parse(b.get("starts_at")), parse(b.get("ends_at"))
                if start is None or end is None:
                    continue
            if start - grace <= at <= end:
                location = db.execute("SELECT location_id FROM p_rooms WHERE id=?", (b.get("room_id"),)).fetchone()
                candidates.append(Booking(
                    exists=True, reference=b.get("reference", ""), room_id=b.get("room_id"),
                    location_id=location[0] if location else None,
                    starts_at=iso(start), ends_at=iso(end), source="crm_fixture",
                ))
        if config.get("use_platform_reservations") and student_id:
            for r in db.execute(
                "SELECT id,room_id,location_id,starts_at,ends_at FROM p_reservations "
                "WHERE org_id=? AND student_id=? AND status='reserved'",
                (request.org_id, student_id),
            ):
                start, end = parse(r["starts_at"]), parse(r["ends_at"])
                if start and end and start - grace <= at <= end:
                    candidates.append(Booking(
                        exists=True, reference=r["id"], reservation_id=r["id"], room_id=r["room_id"],
                        location_id=r["location_id"], starts_at=iso(start), ends_at=iso(end),
                        source="facility_reservation",
                    ))
        for booking in candidates:
            if booking.room_id == request.room_id:
                return booking
        return candidates[0] if candidates else Booking(exists=False, source="none_found")


PROVIDERS: dict[str, CRMProvider] = {"none": NoCRMProvider(), "demo": DemoCRMProvider()}


def settings(db, org_id) -> dict:
    row = db.execute("SELECT * FROM s_crm_settings WHERE org_id=?", (org_id,)).fetchone()
    if row is None:
        return {"provider": "none", "enabled": True, "config": {}, "updated_at": None}
    return {
        "provider": row["provider"],
        "enabled": bool(row["enabled"]),
        "config": decode(row["config"], {}),
        "updated_at": row["updated_at"],
    }


def public_settings(db, org_id) -> dict:
    """For the facility console: provider, switches and policy, never fixtures."""
    value = settings(db, org_id)
    config = value["config"]
    return {
        "provider": value["provider"],
        "enabled": value["enabled"],
        "simulated": PROVIDERS[value["provider"]].simulated,
        "methods": list(PROVIDERS[value["provider"]].methods),
        "require_booking": bool(config.get("require_booking", value["provider"] != "none")),
        "booking_grace_minutes": int(config.get("booking_grace_minutes", 15)),
        "updated_at": value["updated_at"],
    }


def _check_no_secrets(value, path="config"):
    if isinstance(value, dict):
        for key, inner in value.items():
            if _SECRET_KEY.search(str(key)) and key != "credential_hashes":
                raise Denied(
                    f"{path}.{key}: CRM credentials must not be stored in SEDENS settings. "
                    "Configure them in the server's secret store.",
                    400,
                    "secret_in_config",
                )
            _check_no_secrets(inner, f"{path}.{key}")
    elif isinstance(value, list):
        for i, inner in enumerate(value):
            _check_no_secrets(inner, f"{path}[{i}]")


def save_settings(sedens, db, org_id, provider, *, enabled=True, config=None, actor_id=None):
    if provider not in PROVIDERS:
        raise Denied("Choose an available CRM provider.", 400, "unknown_provider")
    org = sedens.org(db, org_id)
    if org is None or org["kind"] != "facility":
        raise Denied("CRM settings belong to a facility.", 400, "not_a_facility")
    if PROVIDERS[provider].demo_only and not org["demo"]:
        raise Denied(
            "The demonstration CRM is only available to demonstration facilities.",
            400,
            "demo_provider_for_real_org",
        )
    config = dict(config or {})
    _check_no_secrets(config)
    if len(encode(config)) > 64_000:
        raise Denied("CRM settings are too large.", 413, "too_large")
    db.execute(
        "INSERT INTO s_crm_settings(org_id,provider,enabled,config,updated_by,updated_at) VALUES (?,?,?,?,?,?) "
        "ON CONFLICT(org_id) DO UPDATE SET provider=excluded.provider, enabled=excluded.enabled, "
        "config=excluded.config, updated_by=excluded.updated_by, updated_at=excluded.updated_at",
        (org_id, provider, int(bool(enabled)), encode(config), actor_id, now()),
    )
    sedens.audit(db, org_id, actor_id, "crm:settings", org_id, {"provider": provider, "enabled": bool(enabled)})
    return public_settings(db, org_id)


def update_policy(sedens, db, actor, *, enabled=None, require_booking=None, booking_grace_minutes=None):
    """Facility admin switches that never touch fixtures or credentials."""
    if actor.role != "admin":
        raise Denied("Only a facility administrator can change CRM settings.", 403, "admin_required")
    current = settings(db, actor.org_id)
    config = dict(current["config"])
    if require_booking is not None:
        config["require_booking"] = bool(require_booking)
    if booking_grace_minutes is not None:
        minutes = int(booking_grace_minutes)
        if not 0 <= minutes <= 120:
            raise Denied("Choose a grace period from 0 to 120 minutes.", 400, "invalid")
        config["booking_grace_minutes"] = minutes
    return save_settings(
        sedens, db, actor.org_id, current["provider"],
        enabled=current["enabled"] if enabled is None else bool(enabled),
        config=config, actor_id=actor.user_id,
    )


def link_member(sedens, db, org_id, provider, external_member_id, student_id):
    if not db.execute(
        "SELECT 1 FROM p_students s JOIN p_users u ON u.id=s.id WHERE s.id=? AND u.org_id=?",
        (student_id, org_id),
    ).fetchone():
        raise Denied("Link the member to a client of this facility.", 400, "student_not_in_org")
    db.execute(
        "INSERT INTO s_crm_member_links(id,org_id,provider,external_member_id,student_id,created_at) "
        "VALUES (?,?,?,?,?,?) ON CONFLICT(org_id,provider,external_member_id) DO UPDATE SET student_id=excluded.student_id",
        (uid(), org_id, provider, str(external_member_id).strip().upper(), student_id, now()),
    )


def member_student(db, org_id, provider, member_ref):
    row = db.execute(
        "SELECT student_id FROM s_crm_member_links WHERE org_id=? AND provider=? AND external_member_id=?",
        (org_id, provider, str(member_ref or "").strip().upper()),
    ).fetchone()
    return row[0] if row else None


def student_member(db, org_id, provider, student_id):
    row = db.execute(
        "SELECT external_member_id FROM s_crm_member_links WHERE org_id=? AND provider=? AND student_id=?",
        (org_id, provider, student_id),
    ).fetchone()
    return row[0] if row else None


def verify_entry(sedens, db, request: EntryRequest) -> EntryDecision:
    if request.method not in METHODS:
        raise Denied("Choose how to enter the room.", 400, "unknown_method")
    current = settings(db, request.org_id)
    provider = PROVIDERS[current["provider"]]
    if not current["enabled"]:
        return provider.decision(request, allowed=False, reason="provider_disabled", authenticated=False)
    org = sedens.org(db, request.org_id)
    if provider.demo_only and not (org and org["demo"]):
        # Defence in depth: settings already refuse this combination.
        return provider.decision(request, allowed=False, reason="method_not_supported", authenticated=False)
    if request.method == "access_code" and request.student_id and not request.member_ref:
        request.member_ref = student_member(db, request.org_id, provider.name, request.student_id)
    return provider.verify_entry(sedens, db, request, current["config"])
