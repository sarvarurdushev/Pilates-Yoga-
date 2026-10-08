"""Room-only authorization: customer + paired device + live room session + scope.

Every case is checked against the server-side gate (``rooms.authorize``) and,
for the HTTP cases, against real requests. Nothing relies on the page hiding a
button.
"""

from datetime import timedelta

import pytest

from pilates.sedens import demo, rooms
from pilates.sedens.util import Denied, iso, parse, utcnow
from sedens_support import Client, enter_with_code, facility, make_sedens, pair, room_code, running_server

DEMO_KEY = "9" * 32
DEMO_ORG = "demo-" + DEMO_KEY


@pytest.fixture
def world(tmp_path):
    sedens = make_sedens(tmp_path / "s.db")
    a = facility(sedens, "A", rooms=("AI Private Room 01", "AI Private Room 02"))
    b = facility(sedens, "B")
    return sedens, a, b


def denied(code, fn, *args, **kwargs):
    with pytest.raises(Denied) as exc:
        fn(*args, **kwargs)
    assert exc.value.code == code, (exc.value.code, str(exc.value))
    return exc.value


def enter_code(sedens, device, customer_token, screen_token=""):
    """Customer asks for a code on their own phone and types it on the screen."""
    return enter_with_code(sedens, device, customer_token, screen_token)


# -- the required cases -------------------------------------------------------------


def test_valid_room_session(world):
    sedens, a, _ = world
    device = pair(sedens, a)
    entered = enter_code(sedens, device, a["customer_token"])
    ctx = rooms.authorize(sedens, device, entered["token"], a["customer_token"])
    assert (ctx.org_id, ctx.location_id, ctx.room_id, ctx.student_id) == (
        a["org_id"], a["location_id"], a["room_id"], a["customer_id"])
    assert ctx.entry_method == "access_code" and not ctx.simulated
    # The customer never signed in on the screen: the session works without it.
    assert rooms.authorize(sedens, device, entered["token"], "").student_id == a["customer_id"]
    assert parse(ctx.expires_at) > utcnow()


def test_expired_room_session(world):
    sedens, a, _ = world
    device = pair(sedens, a)
    entered = enter_code(sedens, device, a["customer_token"])
    with sedens.db() as db:
        db.execute("UPDATE s_room_sessions SET expires_at=?", (iso(utcnow() - timedelta(seconds=1)),))
    err = denied("room_session_expired", rooms.authorize, sedens, device, entered["token"], a["customer_token"])
    assert err.status == 401
    with sedens.db() as db:
        assert tuple(db.execute("SELECT state,end_reason FROM s_room_sessions").fetchone()) == ("expired", "expired")
    # Expired stays expired, even if the clock row were edited back.
    with sedens.db() as db:
        db.execute("UPDATE s_room_sessions SET expires_at=?", (iso(utcnow() + timedelta(hours=1)),))
    denied("room_session_ended", rooms.authorize, sedens, device, entered["token"], a["customer_token"])


def test_wrong_facility_customer_cannot_enter(world):
    sedens, a, b = world
    device_a = pair(sedens, a)
    err = denied("wrong_facility", enter_code, sedens, device_a, b["customer_token"])
    assert err.status == 403


def test_session_from_one_facility_is_refused_on_another_facility_screen(world):
    sedens, a, b = world
    device_a, device_b = pair(sedens, a), pair(sedens, b)
    entered = enter_code(sedens, device_a, a["customer_token"])
    denied("room_scope_mismatch", rooms.authorize, sedens, device_b, entered["token"], a["customer_token"])


def test_session_from_one_room_is_refused_on_another_room_of_the_same_facility(world):
    sedens, a, _ = world
    room1, room2 = a["room_ids"]
    device1, device2 = pair(sedens, a, room1), pair(sedens, a, room2)
    entered = enter_code(sedens, device1, a["customer_token"])
    denied("room_scope_mismatch", rooms.authorize, sedens, device2, entered["token"], a["customer_token"])


def test_customer_not_assigned_to_the_location_cannot_enter(world):
    sedens, a, _ = world
    device = pair(sedens, a)
    with sedens.db() as db:
        db.execute("DELETE FROM p_student_locations WHERE student_id=?", (a["customer_id"],))
    denied("not_assigned_to_location", enter_code, sedens, device, a["customer_token"])


@pytest.mark.parametrize("token", ["", "not-a-real-device-token"])
def test_unpaired_device(world, token):
    sedens, a, _ = world
    denied("device_not_paired", enter_code, sedens, token, a["customer_token"])
    denied("device_not_paired", rooms.authorize, sedens, token, "anything", a["customer_token"])


def test_confirmed_but_unclaimed_device_has_no_token(world):
    sedens, a, _ = world
    started = rooms.start_pairing(sedens)
    device = rooms.confirm_pairing(sedens, a["admin"], started["code"], a["room_id"])
    assert device["paired"] is False
    with sedens.db() as db:
        assert db.execute("SELECT token_hash FROM s_room_devices").fetchone()[0] is None


def test_revoked_device_stops_working_and_ends_its_sessions(world):
    sedens, a, _ = world
    device = pair(sedens, a)
    entered = enter_code(sedens, device, a["customer_token"])
    with sedens.db() as db:
        device_id = db.execute("SELECT id FROM s_room_devices").fetchone()[0]
    rooms.revoke_device(sedens, a["admin"], device_id)
    denied("device_not_paired", rooms.authorize, sedens, device, entered["token"], a["customer_token"])
    with sedens.db() as db:
        assert tuple(db.execute("SELECT state,end_reason FROM s_room_sessions").fetchone()) == ("revoked", "device_revoked")


def test_customer_outside_the_room(world):
    """A signed-in customer without a paired screen and room session gets nothing."""
    sedens, a, _ = world
    denied("device_not_paired", rooms.authorize, sedens, "", "", a["customer_token"])
    device = pair(sedens, a)
    denied("room_session_required", rooms.authorize, sedens, device, "", a["customer_token"])


@pytest.mark.parametrize("who", ["admin_token", "coach_token"])
def test_admin_and_coach_do_not_bypass_room_authorization(world, who):
    sedens, a, _ = world
    device = pair(sedens, a)
    staff = a[who]
    # Staff cannot obtain a room code: room sessions belong to customers.
    denied("customer_required", room_code, sedens, staff)
    denied("room_session_required", rooms.authorize, sedens, device, "", staff)
    # Staff signed in on the screen block a customer's entry, with a code or a CRM credential...
    denied("staff_signed_in", enter_code, sedens, device, a["customer_token"], staff)
    denied("staff_signed_in", rooms.enter, sedens, device, method="qr", credential="x", platform_token=staff)
    # ...and cannot ride on a customer's live room session.
    entered = enter_code(sedens, device, a["customer_token"])
    denied("different_account_signed_in", rooms.authorize, sedens, device, entered["token"], staff)


def test_a_different_customer_cannot_use_someone_elses_session(world):
    sedens, a, _ = world
    device = pair(sedens, a)
    entered = enter_code(sedens, device, a["customer_token"])
    denied("different_account_signed_in", rooms.authorize, sedens, device, entered["token"], a["other_token"])
    denied("different_customer_signed_in", enter_code, sedens, device, a["customer_token"], a["other_token"])


def test_room_codes_are_single_use_short_lived_and_one_at_a_time(world):
    sedens, a, _ = world
    device = pair(sedens, a)
    code = room_code(sedens, a["customer_token"])
    rooms.enter(sedens, device, method="access_code", credential=code)
    denied("access_code_invalid", rooms.enter, sedens, device, method="access_code", credential=code)
    stale = room_code(sedens, a["customer_token"])
    fresh = room_code(sedens, a["customer_token"])
    denied("access_code_invalid", rooms.enter, sedens, device, method="access_code", credential=stale)
    with sedens.db() as db:
        db.execute("UPDATE s_room_access_codes SET expires_at=? WHERE used_at IS NULL AND cancelled_at IS NULL",
                   (iso(utcnow() - timedelta(seconds=1)),))
    denied("access_code_invalid", rooms.enter, sedens, device, method="access_code", credential=fresh)
    denied("access_code_invalid", rooms.enter, sedens, device, method="access_code", credential="ABCD-EFGH")


def test_the_screen_never_holds_a_customer_sign_in(world):
    """Ending a session leaves nothing that lets the next person enter as the last customer."""
    sedens, a, _ = world
    device = pair(sedens, a)
    entered = enter_code(sedens, device, a["customer_token"])
    rooms.end(sedens, rooms.authorize(sedens, device, entered["token"], ""))
    # No credential remains on the screen: a new entry needs a new code.
    denied("access_code_invalid", rooms.enter, sedens, device, method="access_code", credential="")
    with sedens.db() as db:
        assert "signed_in" not in db.execute(
            "SELECT sql FROM sqlite_master WHERE name='s_room_sessions'").fetchone()[0]


def test_removing_the_location_assignment_ends_a_no_crm_session(world):
    sedens, a, _ = world
    device = pair(sedens, a)
    entered = enter_code(sedens, device, a["customer_token"])
    with sedens.db() as db:
        db.execute("DELETE FROM p_student_locations WHERE student_id=?", (a["customer_id"],))
    denied("not_assigned_to_location", rooms.authorize, sedens, device, entered["token"], "")
    with sedens.db() as db:
        assert tuple(db.execute("SELECT state,end_reason FROM s_room_sessions").fetchone()) == ("revoked", "location_unassigned")


def test_deactivated_customer_loses_the_session(world):
    sedens, a, _ = world
    device = pair(sedens, a)
    entered = enter_code(sedens, device, a["customer_token"])
    with sedens.db() as db:
        db.execute("DELETE FROM p_roles WHERE user_id=? AND role='student'", (a["customer_id"],))
    denied("customer_not_active", rooms.authorize, sedens, device, entered["token"], a["customer_token"])


def test_one_active_session_per_screen(world):
    sedens, a, _ = world
    device = pair(sedens, a)
    first = enter_code(sedens, device, a["customer_token"])
    second = enter_code(sedens, device, a["other_token"])
    denied("room_session_ended", rooms.authorize, sedens, device, first["token"], "")
    assert rooms.authorize(sedens, device, second["token"], a["other_token"]).student_id == a["other_id"]


def test_ending_a_session(world):
    sedens, a, _ = world
    device = pair(sedens, a)
    entered = enter_code(sedens, device, a["customer_token"])
    rooms.end(sedens, rooms.authorize(sedens, device, entered["token"], a["customer_token"]))
    denied("room_session_ended", rooms.authorize, sedens, device, entered["token"], a["customer_token"])


def test_deleting_the_location_keeps_history_but_never_authorizes(world):
    sedens, a, _ = world
    device = pair(sedens, a)
    entered = enter_code(sedens, device, a["customer_token"])
    sedens.repo.delete(a["admin"], "locations", a["location_id"])
    denied("device_not_paired", rooms.authorize, sedens, device, entered["token"], a["customer_token"])
    with sedens.db() as db:
        row = db.execute("SELECT room_id,device_id,location_id,student_id FROM s_room_sessions").fetchone()
    assert row[:3] == (None, None, None) and row[3] == a["customer_id"]


# -- pairing protocol -----------------------------------------------------------------


def test_only_the_rooms_facility_admin_confirms_pairing(world):
    sedens, a, b = world
    started = rooms.start_pairing(sedens)
    denied("admin_required", rooms.confirm_pairing, sedens, sedens.repo.actor(a["coach_token"]), started["code"], a["room_id"])
    denied("admin_required", rooms.confirm_pairing, sedens, sedens.repo.actor(a["customer_token"]), started["code"], a["room_id"])
    denied("unknown_room", rooms.confirm_pairing, sedens, b["admin"], started["code"], a["room_id"])
    rooms.confirm_pairing(sedens, a["admin"], started["code"], a["room_id"])
    # A confirmed code cannot be confirmed again.
    denied("pairing_code_invalid", rooms.confirm_pairing, sedens, a["admin"], started["code"], a["room_id"])


def test_device_token_goes_only_to_the_screen_holding_the_pairing_secret(world):
    sedens, a, _ = world
    started = rooms.start_pairing(sedens)
    assert rooms.claim_pairing(sedens, "guess")["state"] == "unknown"
    assert rooms.claim_pairing(sedens, started["secret"])["state"] == "pending"
    rooms.confirm_pairing(sedens, a["admin"], started["code"], a["room_id"])
    claimed = rooms.claim_pairing(sedens, started["secret"])
    assert claimed["state"] == "paired" and claimed["token"]
    assert rooms.claim_pairing(sedens, started["secret"])["state"] == "claimed"


def test_expired_pairing_code(world):
    sedens, a, _ = world
    started = rooms.start_pairing(sedens)
    with sedens.db() as db:
        db.execute("UPDATE s_room_device_pairings SET expires_at=?", (iso(utcnow() - timedelta(seconds=1)),))
    denied("pairing_code_invalid", rooms.confirm_pairing, sedens, a["admin"], started["code"], a["room_id"])
    assert rooms.claim_pairing(sedens, started["secret"])["state"] == "expired"


def test_late_claim_after_confirmation_expires(world):
    sedens, a, _ = world
    started = rooms.start_pairing(sedens)
    rooms.confirm_pairing(sedens, a["admin"], started["code"], a["room_id"])
    with sedens.db() as db:
        db.execute("UPDATE s_room_device_pairings SET confirmed_at=?", (iso(utcnow() - timedelta(hours=2)),))
    assert rooms.claim_pairing(sedens, started["secret"])["state"] == "expired"


def test_pairing_codes_and_tokens_are_stored_hashed(world):
    sedens, a, _ = world
    started = rooms.start_pairing(sedens)
    rooms.confirm_pairing(sedens, a["admin"], started["code"], a["room_id"])
    token = rooms.claim_pairing(sedens, started["secret"])["token"]
    code = room_code(sedens, a["customer_token"])
    entered = rooms.enter(sedens, token, method="access_code", credential=code)
    with sedens.db() as db:
        dump = "\n".join(str(tuple(r)) for t in ("s_room_device_pairings", "s_room_devices", "s_room_sessions",
                                                  "s_room_access_codes")
                         for r in db.execute(f"SELECT * FROM {t}"))
    for secret in (started["secret"], started["code"].replace("-", ""), token, entered["token"], code.replace("-", "")):
        assert secret not in dump


def test_a_demonstration_admin_cannot_claim_a_real_screen(world):
    """Pairing codes are global; anonymous demonstration admins must not be able to use one."""
    sedens, a, _ = world
    sedens.repo.demo_login(DEMO_KEY, "admin")
    demo.ensure(sedens, DEMO_ORG)
    demo_admin = sedens.repo.actor(sedens.repo.demo_login(DEMO_KEY, "admin"))
    started = rooms.start_pairing(sedens)
    denied("demo_cannot_pair", rooms.confirm_pairing, sedens, demo_admin, started["code"], demo.room_id(DEMO_ORG))
    # The real facility admin can still confirm it.
    assert rooms.confirm_pairing(sedens, a["admin"], started["code"], a["room_id"])["room_id"] == a["room_id"]


def test_concurrent_confirmations_let_only_one_admin_claim_a_code(world):
    import threading

    sedens, a, b = world
    started = rooms.start_pairing(sedens)
    results = []
    barrier = threading.Barrier(2)

    def confirm(fac):
        barrier.wait()
        try:
            results.append(("ok", rooms.confirm_pairing(sedens, fac["admin"], started["code"], fac["room_id"])["id"]))
        except Denied as exc:
            results.append(("denied", exc.code))

    threads = [threading.Thread(target=confirm, args=(fac,)) for fac in (a, b)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert sorted(r[0] for r in results) == ["denied", "ok"], results
    assert [r[1] for r in results if r[0] == "denied"] == ["pairing_code_invalid"]
    with sedens.db() as db:
        assert db.execute("SELECT count(*) FROM s_room_devices").fetchone()[0] == 1


# -- demonstration rooms -------------------------------------------------------------------


@pytest.fixture(scope="module")
def demo_world(tmp_path_factory):
    sedens = make_sedens(tmp_path_factory.mktemp("demo-room") / "s.db")
    sedens.repo.demo_login(DEMO_KEY, "admin")
    demo.ensure(sedens, DEMO_ORG)
    return sedens


def test_demo_room_authorization(demo_world):
    sedens = demo_world
    device, public = rooms.ensure_demo_device(sedens, DEMO_ORG, demo.room_id(DEMO_ORG))
    assert public["simulated"] is True
    entered = rooms.enter(sedens, device, method="qr", credential="SEDENS-QR-1001")
    ctx = rooms.authorize(sedens, device, entered["token"])
    assert ctx.simulated and ctx.demo and ctx.org_id == DEMO_ORG and ctx.student_id == f"{DEMO_ORG}-student00"
    assert entered["decision"]["simulated"] is True


@pytest.mark.parametrize("code,reason", [
    ("SEDENS-QR-1002", "no_booking"), ("SEDENS-QR-1003", "membership_inactive"),
    ("SEDENS-QR-1004", "booking_other_room"), ("NOPE", "invalid_credential"),
])
def test_demo_room_denials(demo_world, code, reason):
    device, _ = rooms.ensure_demo_device(demo_world, DEMO_ORG, demo.room_id(DEMO_ORG))
    err = denied(reason, rooms.enter, demo_world, device, method="qr", credential=code)
    assert err.decision["allowed"] is False


def test_every_event_of_a_demo_room_is_labelled_demo(demo_world):
    device, _ = rooms.ensure_demo_device(demo_world, DEMO_ORG, demo.room_id(DEMO_ORG))
    entered = rooms.enter(demo_world, device, method="qr", credential="SEDENS-QR-1001")
    rooms.end(demo_world, entered["context"])
    with demo_world.db() as db:
        rows = db.execute("SELECT name,demo FROM s_events WHERE org_id=?", (DEMO_ORG,)).fetchall()
    assert {"room_session_ended", "room_entered"} <= {r["name"] for r in rows}
    assert all(r["demo"] == 1 for r in rows), [tuple(r) for r in rows if r["demo"] != 1]


def test_demo_customer_can_use_a_room_code(demo_world):
    device, _ = rooms.ensure_demo_device(demo_world, DEMO_ORG, demo.room_id(DEMO_ORG))
    customer = demo_world.repo.demo_login(DEMO_KEY, "student")
    entered = enter_with_code(demo_world, device, customer)
    assert entered["context"].student_id == f"{DEMO_ORG}-student00"
    assert entered["decision"]["booking"]["exists"] is True


def test_demonstration_rooms_stop_working_when_demonstrations_are_off(demo_world):
    from pilates.sedens import modes
    from pilates.sedens.core import Sedens

    device, _ = rooms.ensure_demo_device(demo_world, DEMO_ORG, demo.room_id(DEMO_ORG))
    off = Sedens(demo_world.repo, modes.Mode("local_room", demo_world.repo.path, False, False, False))
    denied("device_not_paired", rooms.enter, off, device, method="qr", credential="SEDENS-QR-1001")
    customer = off.repo.actor(off.repo.demo_login(DEMO_KEY, "student"))
    denied("demo_disabled", rooms.issue_access_code, off, customer)


def test_demo_session_ttl_is_bounded_by_the_booking(demo_world):
    device, _ = rooms.ensure_demo_device(demo_world, DEMO_ORG, demo.room_id(DEMO_ORG))
    entered = rooms.enter(demo_world, device, method="qr", credential="SEDENS-QR-1001")
    booking_end = parse(entered["decision"]["booking"]["ends_at"])
    assert parse(entered["context"].expires_at) <= booking_end + timedelta(minutes=rooms.BOOKING_OVERRUN_MINUTES)


def test_simulated_devices_only_in_demo_orgs(world):
    sedens, a, _ = world
    denied("demo_only", rooms.ensure_demo_device, sedens, a["org_id"], a["room_id"])


def test_a_simulated_device_row_in_a_real_org_is_never_honoured(world):
    sedens, a, _ = world
    from pilates.sedens.util import digest

    with sedens.db() as db:
        db.execute(
            "INSERT INTO s_room_devices(id,org_id,location_id,room_id,name,status,token_hash,simulated,created_at) "
            "VALUES ('x',?,?,?,'forged','active',?,1,?)",
            (a["org_id"], a["location_id"], a["room_id"], digest("forged-token"), iso(utcnow())),
        )
    denied("device_not_paired", enter_code, sedens, "forged-token", a["customer_token"])


def test_demo_device_cannot_serve_a_real_facility_session(world, demo_world):
    """Tokens are per database; a demo screen of one org never matches another org's session."""
    sedens, a, _ = world
    device_a = pair(sedens, a)
    entered = enter_code(sedens, device_a, a["customer_token"])
    demo_device, _ = rooms.ensure_demo_device(demo_world, DEMO_ORG, demo.room_id(DEMO_ORG))
    denied("device_not_paired", rooms.authorize, sedens, demo_device, entered["token"], a["customer_token"])


# -- over HTTP: nothing depends on the page ----------------------------------------------


@pytest.fixture
def http_world(tmp_path):
    sedens = make_sedens(tmp_path / "s.db")
    a = facility(sedens, "A")
    b = facility(sedens, "B")
    server, base = running_server(sedens.repo.path)
    yield sedens, a, b, base
    server.shutdown()
    server.server_close()


def http_pair(base, admin_token, room_id):
    screen = Client(base)
    status, started = screen.call("POST", "/sedens/room/pairing/start")
    assert status == 200 and "sedens_pairing" in screen.jar
    pairing_cookie = [c for c in screen.last_headers.get_all("Set-Cookie") if c.startswith("sedens_pairing=")][0]
    assert "HttpOnly" in pairing_cookie and "SameSite=Strict" in pairing_cookie and "Path=/sedens/room/pairing" in pairing_cookie
    staff = Client(base)
    staff.jar["motion_session"] = admin_token
    status, device = staff.call("POST", "/sedens/facility/devices/confirm",
                                {"code": started["code"], "room_id": room_id, "name": "Screen"})
    assert status == 200, device
    status, claimed = screen.call("GET", "/sedens/room/pairing/status")
    assert status == 200 and claimed["state"] == "paired" and "token" not in claimed
    device_cookie = [c for c in screen.last_headers.get_all("Set-Cookie") if c.startswith("sedens_device=")][0]
    assert "HttpOnly" in device_cookie and "SameSite=Strict" in device_cookie and "Path=/sedens/" in device_cookie
    return screen


def test_http_customer_login_alone_does_not_unlock_the_engine(http_world):
    sedens, a, _, base = http_world
    customer = Client(base)
    customer.jar["motion_session"] = a["customer_token"]
    for method, path in (("GET", "/sedens/room/library"), ("GET", "/sedens/room/session"),
                         ("POST", "/sedens/room/event"), ("GET", "/sedens/room/consents")):
        status, body = customer.call(method, path, {"name": "exercise_started"} if method == "POST" else None)
        assert status == 403 and body["code"] == "device_not_paired", (path, body)
    status, preview = customer.call("GET", "/sedens/library/preview")
    assert status == 200 and preview["total"] > 0 and "items" not in preview


def test_http_full_room_flow_and_scope(http_world):
    sedens, a, b, base = http_world
    screen = http_pair(base, a["admin_token"], a["room_id"])
    status, body = screen.call("GET", "/sedens/room/library")
    assert status == 401 and body["code"] == "room_session_required"
    phone = Client(base)
    phone.jar["motion_session"] = a["customer_token"]
    status, issued = phone.call("POST", "/sedens/access-code")
    assert status == 200 and issued["single_use"] is True
    status, entered = screen.call("POST", "/sedens/room/enter", {"method": "access_code", "credential": issued["code"]})
    assert status == 200 and entered["session"]["room"]["id"] == a["room_id"]
    # The shared screen received no account sign-in, only the room session.
    assert "motion_session" not in screen.jar
    room_cookie = [c for c in screen.last_headers.get_all("Set-Cookie") if c.startswith("sedens_room=")][0]
    assert "HttpOnly" in room_cookie and "SameSite=Strict" in room_cookie
    status, lib = screen.call("GET", "/sedens/room/library")
    assert status == 200 and lib["items"] and all(i["review"]["status"] == "unreviewed" for i in lib["items"])
    # The same room cookie on facility B's screen is refused.
    other_screen = http_pair(base, b["admin_token"], b["room_id"])
    other_screen.jar["sedens_room"] = screen.jar["sedens_room"]
    status, body = other_screen.call("GET", "/sedens/room/library")
    assert status == 403 and body["code"] == "room_scope_mismatch"


@pytest.mark.parametrize("who", ["admin_token", "coach_token"])
def test_http_staff_cannot_enter_or_bypass(http_world, who):
    sedens, a, _, base = http_world
    screen = http_pair(base, a["admin_token"], a["room_id"])
    staff_phone = Client(base)
    staff_phone.jar["motion_session"] = a[who]
    status, body = staff_phone.call("POST", "/sedens/access-code")
    assert status == 403 and body["code"] == "customer_required"
    phone = Client(base)
    phone.jar["motion_session"] = a["customer_token"]
    code = phone.call("POST", "/sedens/access-code")[1]["code"]
    screen.jar["motion_session"] = a[who]
    status, body = screen.call("POST", "/sedens/room/enter", {"method": "access_code", "credential": code})
    assert status == 403 and body["code"] == "staff_signed_in"
    status, device = screen.call("GET", "/sedens/room/device")
    assert device["screen_account"] == {"role": who.removesuffix("_token")}
    status, body = screen.call("GET", "/sedens/room/library")
    assert status == 401 and body["code"] == "room_session_required"


def test_http_expired_session_clears_the_cookie(http_world):
    sedens, a, _, base = http_world
    screen = http_pair(base, a["admin_token"], a["room_id"])
    code = room_code(sedens, a["customer_token"])
    assert screen.call("POST", "/sedens/room/enter", {"method": "access_code", "credential": code})[0] == 200
    with sedens.db() as db:
        db.execute("UPDATE s_room_sessions SET expires_at=?", (iso(utcnow() - timedelta(seconds=1)),))
    status, body = screen.call("GET", "/sedens/room/session")
    assert status == 401 and body["code"] == "room_session_expired"
    assert "sedens_room" not in screen.jar


def test_http_pairing_confirmation_needs_the_rooms_facility_admin(http_world):
    sedens, a, b, base = http_world
    screen = Client(base)
    _, started = screen.call("POST", "/sedens/room/pairing/start")
    for token in (a["coach_token"], a["customer_token"], b["admin_token"], None):
        staff = Client(base)
        if token:
            staff.jar["motion_session"] = token
        status, body = staff.call("POST", "/sedens/facility/devices/confirm", {"code": started["code"], "room_id": a["room_id"]})
        assert status in (401, 403, 404), body
    assert screen.call("GET", "/sedens/room/pairing/status")[1]["state"] == "pending"


def test_http_posts_need_the_csrf_header_and_same_origin(http_world):
    import json as _json
    import urllib.request

    sedens, a, _, base = http_world
    for headers in ({}, {"X-Sedens-Request": "1", "Origin": "https://evil.example"}):
        req = urllib.request.Request(base + "/sedens/room/pairing/start", data=b"{}", method="POST")
        req.add_header("Content-Type", "application/json")
        for k, v in headers.items():
            req.add_header(k, v)
        try:
            urllib.request.urlopen(req)
            raise AssertionError("accepted without CSRF protection")
        except urllib.error.HTTPError as exc:
            assert exc.code == 403 and _json.loads(exc.read())["code"] == "csrf"


def test_http_forged_cookies_are_refused(http_world):
    sedens, a, _, base = http_world
    client = Client(base)
    client.jar.update({"sedens_device": "forged", "sedens_room": "forged", "motion_session": a["customer_token"]})
    status, body = client.call("GET", "/sedens/room/library")
    assert status == 403 and body["code"] == "device_not_paired"


def test_http_demo_room(http_world):
    sedens, a, _, base = http_world
    screen = Client(base)
    status, body = screen.call("POST", "/sedens/demo/room-device", {"key": DEMO_KEY})
    assert status == 200 and body["device"]["simulated"] is True and body["credentials"]["simulated"] is True
    status, device = screen.call("GET", "/sedens/room/device")
    assert device["facility"]["demo"] is True and device["crm"]["simulated"] is True
    status, body = screen.call("POST", "/sedens/room/enter", {"method": "qr", "credential": "SEDENS-QR-1002"})
    assert status == 403 and body["code"] == "no_booking" and body["decision"]["simulated"] is True
    status, entered = screen.call("POST", "/sedens/room/enter", {"method": "qr", "credential": "SEDENS-QR-1001"})
    assert status == 200 and entered["session"]["simulated"] is True
    assert screen.call("GET", "/sedens/room/library")[0] == 200
    assert screen.call("POST", "/sedens/room/end")[0] == 200
    assert screen.call("GET", "/sedens/room/library")[1]["code"] == "room_session_required"
