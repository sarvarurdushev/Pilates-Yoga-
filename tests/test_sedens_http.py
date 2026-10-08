"""/sedens/ creator, facility, review and account routes over real HTTP."""

import pytest

from pilates.sedens import consent, onboarding
from sedens_support import PASSWORD, Client, facility, make_sedens, running_server


@pytest.fixture
def world(tmp_path):
    sedens = make_sedens(tmp_path / "s.db")
    a = facility(sedens, "A")
    b = facility(sedens, "B")
    server, base = running_server(sedens.repo.path)
    yield sedens, a, b, base
    server.shutdown()
    server.server_close()


def signed_in(base, token):
    client = Client(base)
    client.jar["motion_session"] = token
    return client


def test_unknown_route_and_missing_sign_in(world):
    _, _, _, base = world
    status, body = Client(base).call("GET", "/sedens/nope")
    assert status == 404 and body["code"] == "not_found"
    status, body = Client(base).call("GET", "/sedens/me")
    assert status == 401 and body["code"] == "sign_in_required"


def test_me_reports_capabilities_not_titles(world):
    sedens, a, _, base = world
    status, me = signed_in(base, a["coach_token"]).call("GET", "/sedens/me")
    assert status == 200 and me["capabilities"] == [] and me["organization"]["kind"] == "facility"
    status, body = signed_in(base, a["coach_token"]).call("POST", "/sedens/creator/profile",
                                                          {"display_name": "Prof", "creator_type": "professor"})
    assert status == 403 and body["code"] == "capability_required"


def test_facility_admin_grants_creator_and_coach_builds_a_profile(world):
    sedens, a, b, base = world
    admin = signed_in(base, a["admin_token"])
    status, people = admin.call("GET", "/sedens/facility/people")
    assert status == 200 and {p["id"] for p in people["items"]} >= {a["coach_id"], a["admin"].user_id}
    assert a["customer_id"] not in {p["id"] for p in people["items"]}
    status, body = admin.call("POST", "/sedens/facility/capabilities", {"user_id": a["coach_id"], "capability": "creator"})
    assert status == 200 and body["capabilities"] == ["creator"]
    status, body = admin.call("POST", "/sedens/facility/capabilities", {"user_id": a["coach_id"], "capability": "sedens_admin"})
    assert status == 403
    status, body = signed_in(base, b["admin_token"]).call(
        "POST", "/sedens/facility/capabilities", {"user_id": a["coach_id"], "capability": "creator", "grant": False})
    assert status == 403
    coach = signed_in(base, a["coach_token"])
    status, profile = coach.call("POST", "/sedens/creator/profile", {"display_name": "Coach A", "bio": "Mat Pilates"})
    assert status == 200 and profile["verification_state"] == "unverified"
    status, mine = coach.call("GET", "/sedens/creator/profile")
    assert mine["distribution_targets"] == [{"org_id": a["org_id"], "location_id": None, "basis": "home_facility"}]


def test_affiliation_round_trip_over_http(world):
    sedens, a, b, base = world
    signed_in(base, a["admin_token"]).call("POST", "/sedens/facility/capabilities", {"user_id": a["coach_id"], "capability": "creator"})
    coach = signed_in(base, a["coach_token"])
    coach.call("POST", "/sedens/creator/profile", {"display_name": "Coach A"})
    status, req = coach.call("POST", "/sedens/creator/affiliations/request", {"org_id": b["org_id"]})
    assert status == 200 and req["status"] == "requested" and req["grants"] == ["content_distribution"]
    status, body = signed_in(base, a["admin_token"]).call("POST", "/sedens/facility/affiliations/decide",
                                                         {"id": req["id"], "decision": "approve"})
    assert status == 404
    b_admin = signed_in(base, b["admin_token"])
    status, listed = b_admin.call("GET", "/sedens/facility/affiliations")
    assert listed["items"][0]["creator"]["display_name"] == "Coach A"
    assert b_admin.call("POST", "/sedens/facility/affiliations/decide", {"id": req["id"], "decision": "approve"})[1]["status"] == "approved"
    # Content distribution approved; facility B's customers remain invisible to the coach.
    status, body = coach.call("GET", f"/platform/client?id={b['customer_id']}")
    assert status in (403, 404)
    status, body = coach.call("GET", "/platform/people?role=student")
    assert b["customer_id"] not in {p["id"] for p in body}


def test_professor_registers_a_creator_studio(world):
    sedens, a, b, base = world
    client = Client(base)
    status, body = client.call("POST", "/sedens/auth/register-creator", {
        "name": "Prof Choi", "email": "choi@uni.test", "password": PASSWORD, "display_name": "Prof. Choi",
        "creator_type": "professor"})
    assert status == 200, body
    me = body["me"]
    assert me["organization"]["kind"] == "creator_studio" and me["capabilities"] == ["creator"]
    assert me["creator_profile"]["creator_type"] == "professor"
    assert me["creator_profile"]["verification_state"] == "unverified"
    status, body = client.call("POST", "/sedens/creator/affiliations/request", {"org_id": a["org_id"]})
    assert status == 200 and body["status"] == "requested"
    # A creator studio has no rooms to manage and no facility CRM.
    assert client.call("GET", "/sedens/facility/rooms")[1]["locations"] == []
    status, body = client.call("POST", "/sedens/auth/register-creator", {
        "name": "X", "email": "y@uni.test", "password": PASSWORD, "creator_type": "coach"})
    assert status == 400


def test_reviewer_verifies_over_http(world):
    sedens, a, _, base = world
    onboarding.bootstrap_sedens_org(sedens, name="Root", email="root@sedens.test", password=PASSWORD)
    root_token = sedens.repo.login("root@sedens.test", PASSWORD)
    signed_in(base, a["admin_token"]).call("POST", "/sedens/facility/capabilities", {"user_id": a["coach_id"], "capability": "creator"})
    coach = signed_in(base, a["coach_token"])
    coach.call("POST", "/sedens/creator/profile", {"display_name": "Coach A"})
    coach.call("POST", "/sedens/creator/verification/request")
    reviewer = signed_in(base, root_token)
    status, queue = reviewer.call("GET", "/sedens/review/creators")
    assert status == 200 and queue["items"][0]["verification_state"] == "pending"
    status, body = signed_in(base, a["admin_token"]).call("GET", "/sedens/review/creators")
    assert status == 403
    status, decided = reviewer.call("POST", "/sedens/review/creators/decide",
                                    {"creator_id": queue["items"][0]["id"], "decision": "verified"})
    assert status == 200 and decided["verification_state"] == "verified"


def test_facility_rooms_and_crm_are_admin_only(world):
    sedens, a, b, base = world
    status, body = signed_in(base, a["admin_token"]).call("GET", "/sedens/facility/rooms")
    assert status == 200 and body["locations"][0]["rooms"][0]["id"] == a["room_id"]
    for token in (a["coach_token"], a["customer_token"]):
        assert signed_in(base, token).call("GET", "/sedens/facility/rooms")[0] == 403
        assert signed_in(base, token).call("GET", "/sedens/facility/crm")[0] == 403
    status, crm_settings = signed_in(base, a["admin_token"]).call("GET", "/sedens/facility/crm")
    assert status == 200 and crm_settings["provider"] == "none" and crm_settings["simulated"] is False
    # Facility B never sees facility A's rooms.
    rooms_b = signed_in(base, b["admin_token"]).call("GET", "/sedens/facility/rooms")[1]["locations"]
    assert a["room_id"] not in {r["id"] for loc in rooms_b for r in loc["rooms"]}


def test_account_consent_over_http(world):
    sedens, a, _, base = world
    customer = signed_in(base, a["customer_token"])
    status, body = customer.call("GET", "/sedens/consents")
    assert status == 200 and set(body["texts"]) == set(consent.KINDS)
    status, body = customer.call("POST", "/sedens/consents", {
        "kind": "scan_capture", "granted": True, "text_version": consent.TEXTS["scan_capture"]["version"]})
    assert status == 200 and body["current"]["scan_capture"]["granted"] is True
    assert Client(base).call("POST", "/sedens/consents", {"kind": "scan_capture"})[0] == 401


def test_demo_enter_signs_in_and_labels_the_demo(world):
    sedens, a, _, base = world
    client = Client(base)
    status, body = client.call("POST", "/sedens/demo/enter", {"key": "4" * 32, "role": "admin"})
    assert status == 200 and body["me"]["organization"]["demo"] is True
    assert body["me"]["organization"]["display_name"] == "SEDENS Demo Fitness Center"
    status, rooms_body = client.call("GET", "/sedens/facility/rooms")
    names = {r["name"] for loc in rooms_body["locations"] for r in loc["rooms"]}
    assert "AI Private Room 01" in names
    assert client.call("GET", "/sedens/facility/crm")[1]["simulated"] is True
    # The demo admin cannot reach a real facility.
    assert client.call("POST", "/sedens/facility/affiliations/decide", {"id": "x", "decision": "approve"})[0] == 404


def test_customers_get_room_codes_on_their_own_device(world):
    sedens, a, _, base = world
    status, issued = signed_in(base, a["customer_token"]).call("POST", "/sedens/access-code")
    assert status == 200 and len(issued["code"]) == 9 and issued["expires_at"]
    for token in (a["coach_token"], a["admin_token"]):
        status, body = signed_in(base, token).call("POST", "/sedens/access-code")
        assert status == 403 and body["code"] == "customer_required"
    assert Client(base).call("POST", "/sedens/access-code")[0] == 401


def test_demonstration_accounts_are_refused_when_demonstrations_are_off(tmp_path, monkeypatch):
    sedens = make_sedens(tmp_path / "off.db")
    token = sedens.repo.demo_login("5" * 32, "admin")
    monkeypatch.setenv("SEDENS_DEMO", "0")
    server, base = running_server(sedens.repo.path)
    try:
        client = signed_in(base, token)
        for method, path in (("GET", "/sedens/me"), ("GET", "/sedens/facility/rooms"), ("POST", "/sedens/access-code")):
            status, body = client.call(method, path)
            assert status == 403 and body["code"] == "demo_disabled", (path, body)
    finally:
        server.shutdown()
        server.server_close()


def test_rate_limits_use_the_visitor_address_behind_the_render_proxy():
    from types import SimpleNamespace

    from pilates.sedens import http as sedens_http, modes

    def handler(render, forwarded):
        mode = modes.Mode("demo_free", "/tmp/x.db", False, True, render)
        return SimpleNamespace(sedens=SimpleNamespace(mode=mode), client_address=("10.0.0.1", 1),
                               headers={"X-Forwarded-For": forwarded})

    assert sedens_http._client(handler(True, "203.0.113.9, 198.51.100.7")) == "198.51.100.7"
    assert sedens_http._client(handler(False, "203.0.113.9")) == "10.0.0.1"
    assert sedens_http._client(handler(True, "")) == "10.0.0.1"


def test_pages(world):
    import urllib.request

    _, _, _, base = world
    def page(path):
        with urllib.request.urlopen(base + path, timeout=30) as response:
            return response.status, response.read().decode()
    status, home = page("/")
    assert status == 200 and "SEDENS" in home and "/src/sedens/app.js" in home
    assert page("/index.html")[1] == home
    status, workspace = page("/workspace.html")
    assert status == 200 and "/src/platform/app.js" in workspace
    status, room = page("/room.html")
    assert status == 200 and "/src/sedens/room.js" in room
    assert page("/anatomy.html")[0] == 200
