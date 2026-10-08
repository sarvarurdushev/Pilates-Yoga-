"""Facility CRM adapter contract, the simulated demo provider and the no-CRM provider."""

from datetime import timedelta

import pytest

from pilates.sedens import crm, demo
from pilates.sedens.util import Denied, digest, iso, utcnow
from sedens_support import facility, make_sedens

KEY = "f" * 32
ORG = "demo-" + KEY


@pytest.fixture(scope="module")
def demo_sedens(tmp_path_factory):
    sedens = make_sedens(tmp_path_factory.mktemp("crm") / "s.db")
    sedens.repo.demo_login(KEY, "admin")
    demo.ensure(sedens, ORG)
    return sedens


def request(method, credential="", pin="", room=None, **kw):
    return crm.EntryRequest(org_id=ORG, location_id=f"{ORG}-location0", room_id=room or demo.room_id(ORG),
                            method=method, credential=credential, pin=pin, **kw)


def verify(sedens, req):
    with sedens.db() as db:
        return crm.verify_entry(sedens, db, req)


def test_active_member_with_a_booking_is_allowed(demo_sedens):
    d = verify(demo_sedens, request("qr", "SEDENS-QR-1001"))
    assert d.allowed and d.authenticated and d.simulated and d.provider == "demo"
    assert d.reason == "allowed" and d.membership == "active"
    assert d.booking.exists and d.booking.room_id == demo.room_id(ORG)
    assert d.booking.starts_at < iso(utcnow()) < d.booking.ends_at
    assert (d.facility_id, d.location_id, d.room_id) == (ORG, f"{ORG}-location0", demo.room_id(ORG))


def test_active_member_without_booking_is_denied(demo_sedens):
    d = verify(demo_sedens, request("qr", "SEDENS-QR-1002"))
    assert not d.allowed and d.reason == "no_booking" and d.membership == "active"
    assert d.booking.exists is False


def test_inactive_membership_is_denied(demo_sedens):
    d = verify(demo_sedens, request("qr", "SEDENS-QR-1003"))
    assert not d.allowed and d.reason == "membership_inactive" and d.membership == "inactive"


def test_booking_for_another_room_is_denied(demo_sedens):
    d = verify(demo_sedens, request("qr", "SEDENS-QR-1004"))
    assert not d.allowed and d.reason == "booking_other_room"
    assert d.booking.exists and d.booking.room_id == f"{ORG}-location0-room"


def test_unknown_code_is_not_authenticated(demo_sedens):
    d = verify(demo_sedens, request("qr", "SEDENS-QR-9999"))
    assert not d.allowed and not d.authenticated and d.reason == "invalid_credential"


def test_reservation_code(demo_sedens):
    assert verify(demo_sedens, request("reservation", "bk-1001")).allowed
    assert not verify(demo_sedens, request("reservation", "BK-0000")).allowed


def test_member_number_needs_its_pin(demo_sedens):
    assert verify(demo_sedens, request("member_id", "DEMO-1001", demo.DEMO_PIN)).allowed
    wrong = verify(demo_sedens, request("member_id", "DEMO-1001", "0000"))
    assert not wrong.allowed and not wrong.authenticated


def test_room_code_customer_uses_the_member_link(demo_sedens):
    """For a room-code entry SEDENS already knows the customer; the CRM decides membership and booking."""
    d = verify(demo_sedens, request("access_code", student_id=f"{ORG}-student00"))
    assert d.allowed and d.member_ref == "DEMO-1001"
    unlinked = verify(demo_sedens, request("access_code", student_id=f"{ORG}-student20"))
    assert not unlinked.allowed and unlinked.reason == "unknown_member"


def test_fixed_bookings_respect_their_time(demo_sedens):
    with demo_sedens.db() as db:
        settings = crm.settings(db, ORG)
        config = dict(settings["config"])
        config["bookings"] = [{
            "reference": "LATER", "member_ref": "DEMO-1002", "room_id": demo.room_id(ORG),
            "starts_at": iso(utcnow() + timedelta(hours=3)), "ends_at": iso(utcnow() + timedelta(hours=4)),
        }]
        provider = crm.PROVIDERS["demo"]
        d = provider.verify_entry(demo_sedens, db, request("qr", "SEDENS-QR-1002"), config)
        assert d.reason == "no_booking"
        d = provider.verify_entry(demo_sedens, db, request("qr", "SEDENS-QR-1002",
                                                           at=utcnow() + timedelta(hours=3, minutes=5)), config)
        assert d.allowed


def test_booking_can_be_optional(demo_sedens):
    with demo_sedens.db() as db:
        config = dict(crm.settings(db, ORG)["config"], require_booking=False)
        d = crm.PROVIDERS["demo"].verify_entry(demo_sedens, db, request("qr", "SEDENS-QR-1002"), config)
    assert d.allowed


def test_public_decision_has_no_credentials(demo_sedens):
    public = verify(demo_sedens, request("qr", "SEDENS-QR-1001")).public()
    text = repr(public)
    assert "SEDENS-QR-1001" not in text and "DEMO-1001" not in text
    assert {"allowed", "reason", "membership", "booking", "facility_id", "location_id", "room_id", "simulated"} <= set(public)
    assert public["booking"]["starts_at"] and public["booking"]["ends_at"]


def test_disabled_provider_denies(demo_sedens, tmp_path):
    with demo_sedens.db() as db:
        current = crm.settings(db, ORG)
        crm.save_settings(demo_sedens, db, ORG, "demo", enabled=False, config=current["config"])
    try:
        d = verify(demo_sedens, request("qr", "SEDENS-QR-1001"))
        assert not d.allowed and d.reason == "provider_disabled"
    finally:
        with demo_sedens.db() as db:
            crm.save_settings(demo_sedens, db, ORG, "demo", enabled=True, config=current["config"])


def test_demo_provider_is_refused_for_real_facilities(tmp_path):
    sedens = make_sedens(tmp_path / "s.db")
    real = facility(sedens, "R")
    with sedens.db() as db, pytest.raises(Denied) as exc:
        crm.save_settings(sedens, db, real["org_id"], "demo", config={})
    assert exc.value.code == "demo_provider_for_real_org"


def test_demo_provider_cannot_decide_for_a_real_org_even_if_written_directly(tmp_path):
    sedens = make_sedens(tmp_path / "s.db")
    real = facility(sedens, "R")
    with sedens.db() as db:
        db.execute("INSERT INTO s_crm_settings(org_id,provider,enabled,config,updated_at) VALUES (?,?,?,?,?)",
                   (real["org_id"], "demo", 1, '{"require_booking":false,"members":[]}', iso(utcnow())))
        d = crm.verify_entry(sedens, db, crm.EntryRequest(real["org_id"], real["location_id"], real["room_id"], "qr", "X"))
    assert not d.allowed


@pytest.mark.parametrize("config", [
    {"api_key": "x"}, {"password": "x"}, {"nested": {"client_secret": "x"}}, {"items": [{"access_token": "x"}]},
])
def test_secrets_are_refused_in_crm_settings(demo_sedens, config):
    with demo_sedens.db() as db, pytest.raises(Denied) as exc:
        crm.save_settings(demo_sedens, db, ORG, "demo", config=config)
    assert exc.value.code == "secret_in_config"


def test_demo_access_codes_are_stored_hashed(demo_sedens):
    with demo_sedens.db() as db:
        raw = db.execute("SELECT config FROM s_crm_settings WHERE org_id=?", (ORG,)).fetchone()[0]
    assert "SEDENS-QR-1001" not in raw and demo.DEMO_PIN not in raw
    assert digest("SEDENS-QR-1001") in raw


def test_no_crm_provider_uses_facility_location_assignment(tmp_path):
    sedens = make_sedens(tmp_path / "s.db")
    fac = facility(sedens, "N")
    req = crm.EntryRequest(fac["org_id"], fac["location_id"], fac["room_id"], "access_code", student_id=fac["customer_id"])
    with sedens.db() as db:
        d = crm.verify_entry(sedens, db, req)
        assert d.allowed and d.provider == "none" and not d.simulated and d.reason == "facility_membership"
        db.execute("DELETE FROM p_student_locations WHERE student_id=?", (fac["customer_id"],))
        assert crm.verify_entry(sedens, db, req).reason == "not_assigned_to_location"
        qr = crm.EntryRequest(fac["org_id"], fac["location_id"], fac["room_id"], "qr", "anything")
        assert crm.verify_entry(sedens, db, qr).reason == "method_not_supported"


def test_facility_policy_switches_do_not_touch_fixtures(demo_sedens):
    admin = demo_sedens.repo.actor(demo_sedens.repo.demo_login(KEY, "admin"))
    coach = demo_sedens.repo.actor(demo_sedens.repo.demo_login(KEY, "coach"))
    with demo_sedens.db() as db:
        before = crm.settings(db, ORG)["config"]["members"]
        public = crm.update_policy(demo_sedens, db, admin, booking_grace_minutes=30)
        assert public["booking_grace_minutes"] == 30 and "members" not in public
        assert crm.settings(db, ORG)["config"]["members"] == before
        crm.update_policy(demo_sedens, db, admin, booking_grace_minutes=15)
        with pytest.raises(Denied):
            crm.update_policy(demo_sedens, db, coach, require_booking=False)
        with pytest.raises(Denied):
            crm.update_policy(demo_sedens, db, admin, booking_grace_minutes=999)
