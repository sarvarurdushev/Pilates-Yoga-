"""Phase 4 customer account security (docs/SEDENS_SECURITY_MODEL.md section 11).

Staff cannot choose a customer's password or change a signed-up customer's email; a
facility administrator creates a one-time link and the customer chooses the password;
using it ends every sign-in of that customer. Staff cannot act as a customer in the
Passport or for consent, and no sign-in or room entry accepts phone digits.
"""

from datetime import timedelta
import inspect
import re
import shutil
from urllib.parse import parse_qs, urlparse
import zipfile

import pytest

from pilates.platform import http as platform_http
from pilates.platform.repository import CustomerAccountRefused, Refused, password_hash
from pilates.platform.backup import export_archive, restore_archive
from pilates.sedens import accounts, backup, consent, crm, demo, rooms
from pilates.sedens import http as sedens_http
from pilates.sedens.util import Denied, iso, utcnow
from sedens_support import (PASSWORD, Client, add_user, enter_with_code, facility, make_sedens, pair, room_code,
                            running_server)

NEW_PASSWORD = "my own quiet password"
KEY = "5" * 32


@pytest.fixture
def world(tmp_path):
    sedens_http._LIMITS.clear()  # rate limits are per process; each test starts fresh
    platform_http._ATTEMPTS.clear()
    sedens = make_sedens(tmp_path / "s.db")
    a = facility(sedens, "A")
    b = facility(sedens, "B")
    server, base = running_server(sedens.repo.path)
    yield sedens, a, b, base
    server.shutdown()
    server.server_close()
    sedens_http._LIMITS.clear()
    platform_http._ATTEMPTS.clear()


def signed_in(base, token):
    client = Client(base)
    client.jar["motion_session"] = token
    return client


def email_of(sedens, user_id):
    with sedens.db() as db:
        return db.execute("SELECT email FROM p_users WHERE id=?", (user_id,)).fetchone()[0]


def hash_of(sedens, user_id):
    with sedens.db() as db:
        return db.execute("SELECT password_hash FROM p_users WHERE id=?", (user_id,)).fetchone()[0]


def events(sedens, user_id):
    with sedens.db() as db:
        return [tuple(r) for r in db.execute(
            "SELECT kind, actor_id FROM s_account_events WHERE user_id=? ORDER BY at, rowid", (user_id,))]


def token_from(link):
    assert link.startswith("/#/account/setup?token=")
    return parse_qs(urlparse(link.split("#", 1)[1]).query)["token"][0]


def issue(base, admin_token, user_id, purpose="setup"):
    status, body = signed_in(base, admin_token).call("POST", "/sedens/facility/people/link",
                                                     {"user_id": user_id, "purpose": purpose})
    assert status == 200, body
    return body


def claim(sedens, base, a, password=NEW_PASSWORD):
    """The customer sets up their own password with a fresh link; returns their email."""
    body = issue(base, a["admin_token"], a["customer_id"])
    status, result = Client(base).call("POST", "/sedens/account/password",
                                       {"token": token_from(body["link"]), "password": password})
    assert status == 200, result
    return email_of(sedens, a["customer_id"])


def person(a, user_id, name, **extra):
    return {"id": user_id, "name": name, "roles": ["student"], **extra}


# -- staff cannot choose a customer's password ---------------------------------------------------


def test_staff_cannot_set_a_customers_password_in_the_repository(world):
    sedens, a, _, _ = world
    repo = sedens.repo
    coach = repo.actor(a["coach_token"])
    for actor in (coach, a["admin"]):
        with pytest.raises(CustomerAccountRefused) as refused:
            repo.save_person(actor, person(a, a["customer_id"], "Customer A", password="staff-chosen-pass"))
        assert refused.value.status == 409 and refused.value.code == "customer_sets_password"
    assert hash_of(sedens, a["customer_id"]) == ""
    # Each attempt is shown to the customer, with who tried.
    assert events(sedens, a["customer_id"]) == [("staff_password_refused", coach.user_id),
                                                ("staff_password_refused", a["admin"].user_id)]
    # A new customer cannot be created with a staff-chosen password either.
    with pytest.raises(CustomerAccountRefused):
        repo.save_person(a["admin"], {"name": "New", "roles": ["student"], "password": "staff-chosen-pass"})


def test_a_customer_cannot_be_turned_into_staff_to_take_their_password(world):
    """A session can switch to any role its account holds, so an account that holds the
    customer role, before or after the save, is a customer's."""
    sedens, a, _, base = world
    admin = signed_in(base, a["admin_token"])
    status, body = admin.call("POST", "/platform/people/save", person(
        a, a["customer_id"], "Customer A", roles=["student", "coach"], password="staff-chosen-pass"))
    assert status == 409 and body["code"] == "customer_sets_password"
    status, _ = admin.call("POST", "/platform/people/save", person(a, a["customer_id"], "Customer A",
                                                                   roles=["student", "coach"]))
    assert status == 200
    status, body = admin.call("POST", "/platform/people/save", person(
        a, a["customer_id"], "Customer A", roles=["student", "coach"], password="staff-chosen-pass"))
    assert status == 409 and body["code"] == "customer_sets_password"
    status, body = admin.call("POST", "/platform/people/save", person(
        a, a["customer_id"], "Customer A", roles=["coach"], password="staff-chosen-pass"))
    assert status == 409 and body["code"] == "customer_sets_password"
    assert hash_of(sedens, a["customer_id"]) == ""


def test_staff_cannot_set_a_customers_password_over_http(world):
    sedens, a, _, base = world
    for token in (a["coach_token"], a["admin_token"]):
        status, body = signed_in(base, token).call("POST", "/platform/people/save", person(
            a, a["customer_id"], "Customer A", email=email_of(sedens, a["customer_id"]), password="staff-chosen-pass"))
        assert status == 409 and body["code"] == "customer_sets_password"
        assert "sign-in link" in body["error"]
    assert hash_of(sedens, a["customer_id"]) == ""
    status, _ = Client(base).call("POST", "/platform/auth/login",
                                  {"email": email_of(sedens, a["customer_id"]), "password": "staff-chosen-pass"})
    assert status == 401


def test_staff_cannot_change_a_signed_up_customers_email(world):
    sedens, a, _, base = world
    # Before the customer has a password, staff may still correct the email they sign up with.
    status, _ = signed_in(base, a["coach_token"]).call("POST", "/platform/people/save", person(
        a, a["customer_id"], "Customer A", email="first@example.test"))
    assert status == 200 and email_of(sedens, a["customer_id"]) == "first@example.test"
    claimed = claim(sedens, base, a)
    coach = sedens.repo.actor(a["coach_token"])
    for token, actor_id in ((a["coach_token"], coach.user_id), (a["admin_token"], a["admin"].user_id)):
        status, body = signed_in(base, token).call("POST", "/platform/people/save", person(
            a, a["customer_id"], "Customer A", email="attacker@example.test"))
        assert status == 409 and body["code"] == "customer_email_locked"
        assert ("staff_email_refused", actor_id) in events(sedens, a["customer_id"])
    with pytest.raises(CustomerAccountRefused):
        sedens.repo.save_person(a["admin"], person(a, a["customer_id"], "Customer A", email="x@example.test"))
    assert email_of(sedens, a["customer_id"]) == claimed
    # Profile saves keep working: the same email, or no email field at all.
    status, _ = signed_in(base, a["coach_token"]).call("POST", "/platform/people/save", person(
        a, a["customer_id"], "Customer A renamed", email=claimed.upper(), goal="Mobility"))
    assert status == 200
    sedens.repo.save_person(a["admin"], person(a, a["customer_id"], "Customer A"))
    assert email_of(sedens, a["customer_id"]) == claimed
    assert sedens.repo.login(claimed, NEW_PASSWORD)


def test_profile_saves_are_audited_with_password_and_email_flags(world):
    sedens, a, _, _ = world
    sedens.repo.save_person(a["admin"], person(a, a["customer_id"], "Customer A", email="new@example.test"))
    with sedens.db() as db:
        detail = db.execute("SELECT detail FROM p_audit WHERE action='save:user' AND subject_id=? "
                            "ORDER BY id DESC LIMIT 1", (a["customer_id"],)).fetchone()[0]
    assert '"email_changed":true' in detail and '"password_set":false' in detail


def test_staff_password_changes_still_work(world):
    sedens, a, _, base = world
    admin = signed_in(base, a["admin_token"])
    status, _ = admin.call("POST", "/platform/people/save", {
        "id": a["coach_id"], "name": "Coach A", "email": "coach-a@example.test", "roles": ["coach"],
        "password": "coach-own-password"})
    assert status == 200
    assert sedens.repo.actor(sedens.repo.login("coach-a@example.test", "coach-own-password")).role == "coach"
    status, created = admin.call("POST", "/platform/people/save", {
        "name": "New coach", "email": "new-coach@example.test", "roles": ["coach"], "password": "another-password"})
    assert status == 200
    assert sedens.repo.login("new-coach@example.test", "another-password")
    # A coach changing a coach's password is still refused, as before.
    status, _ = signed_in(base, a["coach_token"]).call("POST", "/platform/people/save", {
        "id": created["id"], "name": "New coach", "roles": ["coach"], "password": "coach-takeover-1"})
    assert status == 403


def test_the_workspace_list_says_whether_a_customer_can_sign_in(world):
    sedens, a, _, base = world
    status, me = signed_in(base, a["admin_token"]).call("GET", "/platform/me")
    customer = next(p for p in me["students"] if p["id"] == a["customer_id"])
    assert customer["has_password"] is False and "password_hash" not in customer
    claim(sedens, base, a)
    status, me = signed_in(base, a["admin_token"]).call("GET", "/platform/me")
    assert next(p for p in me["students"] if p["id"] == a["customer_id"])["has_password"] is True


# -- sign-in links -----------------------------------------------------------------------------


def test_only_the_customers_own_facility_administrator_creates_a_link(world):
    sedens, a, b, base = world
    body = {"user_id": a["customer_id"], "purpose": "setup"}
    refused = {
        "coach": signed_in(base, a["coach_token"]).call("POST", "/sedens/facility/people/link", body),
        "customer": signed_in(base, a["customer_token"]).call("POST", "/sedens/facility/people/link", body),
        "other customer": signed_in(base, a["other_token"]).call("POST", "/sedens/facility/people/link",
                                                                  {**body, "user_id": a["other_id"]}),
        "other facility's admin": signed_in(base, b["admin_token"]).call("POST", "/sedens/facility/people/link", body),
        "signed out": Client(base).call("POST", "/sedens/facility/people/link", body),
    }
    assert refused["coach"][0] == 403 and refused["coach"][1]["code"] == "admin_required"
    assert refused["customer"][0] == 403 and refused["other customer"][0] == 403
    assert refused["other facility's admin"][0] == 404
    assert refused["other facility's admin"][1]["code"] == "customer_not_found"
    assert refused["signed out"][0] == 401
    # A creator: a creator-studio administrator, and a coach holding the creator permission.
    from pilates.sedens import capabilities, onboarding

    studio = signed_in(base, onboarding.register_creator_studio(
        sedens, name="Prof", email="prof@uni.test", password=PASSWORD))
    status, answer = studio.call("POST", "/sedens/facility/people/link", body)
    assert status == 403 and answer["code"] == "facility_required"
    with sedens.db() as db:
        capabilities.grant(sedens, db, a["admin"], a["coach_id"], "creator")
    assert signed_in(base, a["coach_token"]).call("POST", "/sedens/facility/people/link", body)[0] == 403
    # Staff accounts are not customers: no link for a coach.
    status, answer = signed_in(base, a["admin_token"]).call("POST", "/sedens/facility/people/link",
                                                            {"user_id": a["coach_id"], "purpose": "reset"})
    assert status == 404 and answer["code"] == "customer_not_found"
    assert events(sedens, a["customer_id"]) == []
    issued = issue(base, a["admin_token"], a["customer_id"])
    assert issued["customer"] == {"id": a["customer_id"], "name": "Customer A"}
    assert issued["purpose"] == "setup"


def test_a_link_is_random_stored_hashed_and_expires_on_time(world):
    sedens, a, _, base = world
    before = utcnow()
    issued = issue(base, a["admin_token"], a["customer_id"])
    secret = token_from(issued["link"])
    assert len(secret) == 43 and re.fullmatch(r"[A-Za-z0-9_-]+", secret)  # 32 random bytes
    with sedens.db() as db:
        row = db.execute("SELECT * FROM s_account_links WHERE user_id=?", (a["customer_id"],)).fetchone()
        dumped = "|".join(str(v) for v in row)
    assert secret not in dumped and row["token_hash"] == accounts.digest(secret)
    hours = (accounts.parse(row["expires_at"]) - before).total_seconds() / 3600
    assert 71.9 < hours <= 72.01
    # Nothing in the customer list gives the link back.
    status, listing = signed_in(base, a["admin_token"]).call("GET", "/sedens/facility/customers")
    entry = next(c for c in listing["items"] if c["id"] == a["customer_id"])
    assert entry["open_link"]["purpose"] == "setup" and secret not in str(listing)
    assert a["coach_id"] not in {c["id"] for c in listing["items"]}
    assert signed_in(base, a["coach_token"]).call("GET", "/sedens/facility/customers")[0] == 403
    # A setup link is only for a customer without a password; a reset link lasts 30 minutes.
    claim(sedens, base, a)
    status, body = signed_in(base, a["admin_token"]).call("POST", "/sedens/facility/people/link",
                                                          {"user_id": a["customer_id"], "purpose": "setup"})
    assert status == 409 and body["code"] == "already_set_up"
    reset = issue(base, a["admin_token"], a["customer_id"], "reset")
    minutes = (accounts.parse(reset["expires_at"]) - utcnow()).total_seconds() / 60
    assert 29 < minutes <= 30.01


def test_a_link_works_once(world):
    sedens, a, _, base = world
    secret = token_from(issue(base, a["admin_token"], a["customer_id"])["link"])
    status, body = Client(base).call("POST", "/sedens/account/password", {"token": secret, "password": NEW_PASSWORD})
    assert status == 200 and body["password_set"] is True
    status, body = Client(base).call("POST", "/sedens/account/password",
                                     {"token": secret, "password": "a second password"})
    assert status == 400 and body["code"] == "link_not_valid"
    assert sedens.repo.login(email_of(sedens, a["customer_id"]), NEW_PASSWORD)


def test_unknown_expired_and_replaced_links_get_the_same_answer(world):
    sedens, a, _, base = world
    first = token_from(issue(base, a["admin_token"], a["customer_id"])["link"])
    second = token_from(issue(base, a["admin_token"], a["customer_id"])["link"])
    answers = []
    for secret in (first, "x" * 43, "", None, second[:-1] + ("A" if second[-1] != "A" else "B")):
        answers.append(Client(base).call("POST", "/sedens/account/password",
                                         {"token": secret, "password": NEW_PASSWORD}))
    with sedens.db() as db:
        db.execute("UPDATE s_account_links SET expires_at=? WHERE token_hash=?",
                   (iso(utcnow() - timedelta(seconds=1)), accounts.digest(second)))
    answers.append(Client(base).call("POST", "/sedens/account/password", {"token": second, "password": NEW_PASSWORD}))
    assert {(status, body["code"], body["error"]) for status, body in answers} == {
        (400, "link_not_valid", accounts.NOT_VALID)}
    assert hash_of(sedens, a["customer_id"]) == ""


def test_password_rules_are_the_platforms_and_do_not_use_up_the_link(world):
    sedens, a, _, base = world
    secret = token_from(issue(base, a["admin_token"], a["customer_id"])["link"])
    for bad in ("short", "x" * 1025, None, 12345678901):
        status, body = Client(base).call("POST", "/sedens/account/password", {"token": secret, "password": bad})
        assert status == 400 and body["code"] == "password_rules"
    status, _ = Client(base).call("POST", "/sedens/account/password", {"token": secret, "password": "x" * 10})
    assert status == 200
    stored = hash_of(sedens, a["customer_id"])
    assert stored.startswith("pbkdf2_sha256$600000$") and password_hash  # the platform's own hash


def test_demonstration_customers_get_no_links(world):
    sedens, a, _, base = world
    client = Client(base)
    status, body = client.call("POST", "/sedens/demo/enter", {"key": KEY, "role": "admin"})
    assert status == 200
    with sedens.db() as db:
        customer = db.execute("SELECT u.id FROM p_users u JOIN p_roles r ON r.user_id=u.id AND r.role='student' "
                              "WHERE u.org_id=? LIMIT 1", ("demo-" + KEY,)).fetchone()[0]
    status, body = client.call("POST", "/sedens/facility/people/link", {"user_id": customer, "purpose": "setup"})
    assert status == 409 and body["code"] == "demo_no_password"
    # A link row in a demonstration organization (it cannot be issued) is never usable either.
    with sedens.db() as db:
        db.execute("INSERT INTO s_account_links(id,token_hash,user_id,org_id,purpose,issued_at,expires_at) "
                   "VALUES ('d1',?,?,?,'setup',?,?)",
                   (accounts.digest("d" * 43), customer, "demo-" + KEY, iso(utcnow()),
                    iso(utcnow() + timedelta(hours=1))))
    status, body = Client(base).call("POST", "/sedens/account/password", {"token": "d" * 43, "password": NEW_PASSWORD})
    assert status == 400 and body["code"] == "link_not_valid"
    # Demonstration customers still sign in from the demonstration page, without a password.
    status, body = Client(base).call("POST", "/sedens/demo/enter", {"key": KEY, "role": "student"})
    assert status == 200 and body["me"]["role"] == "student"
    # A real facility's link is for that facility's customer only.
    secret = token_from(issue(base, a["admin_token"], a["customer_id"])["link"])
    assert Client(base).call("POST", "/sedens/account/password", {"token": secret, "password": NEW_PASSWORD})[0] == 200
    assert hash_of(sedens, a["other_id"]) == "" and hash_of(sedens, customer) == ""


def test_setting_the_password_ends_every_sign_in(world):
    sedens, a, _, base = world
    customer = signed_in(base, a["customer_token"])
    assert customer.call("GET", "/sedens/me")[0] == 200
    second_phone = signed_in(base, sedens.repo.issue(a["customer_id"], "student"))
    secret = token_from(issue(base, a["admin_token"], a["customer_id"])["link"])
    holder = signed_in(base, a["other_token"])  # whoever was signed in on the browser that opened the link
    status, body = holder.call("POST", "/sedens/account/password", {"token": secret, "password": NEW_PASSWORD})
    assert status == 200 and body["sessions_ended"] == 2
    assert "motion_session" not in holder.jar  # this browser is signed out too
    assert customer.call("GET", "/sedens/me")[0] == 401
    assert second_phone.call("GET", "/sedens/passport/overview")[0] == 401
    # Staff and other customers keep their sessions.
    assert signed_in(base, a["admin_token"]).call("GET", "/sedens/me")[0] == 200
    assert signed_in(base, a["other_token"]).call("GET", "/sedens/me")[0] == 200
    fresh = Client(base)
    status, _ = fresh.call("POST", "/platform/auth/login",
                           {"email": email_of(sedens, a["customer_id"]), "password": NEW_PASSWORD})
    assert status == 200 and fresh.call("GET", "/sedens/passport/overview")[0] == 200
    assert events(sedens, a["customer_id"]) == [
        ("link_issued", a["admin"].user_id), ("password_set_by_customer", a["customer_id"]),
        ("sessions_revoked", a["customer_id"])]


def test_setting_the_password_also_ends_room_sessions_and_unused_room_codes(world):
    """Room entry does not go through p_sessions, so a room session or code obtained
    before the reset must end with it."""
    sedens, a, _, base = world
    device = pair(sedens, a)
    entered = enter_with_code(sedens, device, a["customer_token"])
    assert rooms.authorize(sedens, device, entered["token"]).student_id == a["customer_id"]
    code = room_code(sedens, a["customer_token"])  # an unused code for later
    secret = token_from(issue(base, a["admin_token"], a["customer_id"], "reset")["link"])
    status, body = Client(base).call("POST", "/sedens/account/password", {"token": secret, "password": NEW_PASSWORD})
    assert status == 200 and body["sessions_ended"] == 3  # the platform session, the room code and the room session
    with pytest.raises(Denied):
        rooms.authorize(sedens, device, entered["token"])
    with pytest.raises(Denied):
        rooms.enter(sedens, device, method="access_code", credential=code)
    with sedens.db() as db:
        row = db.execute("SELECT state, end_reason FROM s_room_sessions WHERE student_id=?",
                         (a["customer_id"],)).fetchone()
    assert tuple(row) == ("revoked", "password_changed")


def test_sign_in_activity_is_for_the_customer_only(world):
    sedens, a, b, base = world
    with pytest.raises(CustomerAccountRefused):
        sedens.repo.save_person(sedens.repo.actor(a["coach_token"]),
                                person(a, a["customer_id"], "Customer A", password="staff-chosen-pass"))
    claim(sedens, base, a)
    fresh = Client(base)
    fresh.call("POST", "/platform/auth/login", {"email": email_of(sedens, a["customer_id"]), "password": NEW_PASSWORD})
    status, body = fresh.call("GET", "/sedens/passport/account-activity")
    assert status == 200
    assert [i["kind"] for i in body["items"]] == ["sessions_revoked", "password_set_by_customer", "link_issued",
                                                  "staff_password_refused"]
    issued = body["items"][2]
    assert issued["by"] == "staff" and issued["staff_name"] == "Admin A" and issued["purpose"] == "setup"
    assert body["items"][0]["by"] == "you" and body["items"][0]["staff_name"] is None
    # Whoever held the link chose the password: the activity does not say it was the customer.
    assert body["items"][1]["by"] == "link"
    for token in (a["admin_token"], a["coach_token"], b["admin_token"]):
        status, answer = signed_in(base, token).call("GET", "/sedens/passport/account-activity")
        assert status == 403 and answer["code"] == "passport_customer_only"
    status, other = signed_in(base, a["other_token"]).call("GET", "/sedens/passport/account-activity")
    assert status == 200 and other["items"] == []
    assert Client(base).call("GET", "/sedens/passport/account-activity")[0] == 401


def test_the_link_route_is_rate_limited_per_address(world):
    _, a, _, base = world
    statuses = [Client(base).call("POST", "/sedens/account/password",
                                  {"token": "y" * 43, "password": NEW_PASSWORD})[0] for _ in range(16)]
    assert statuses[:15] == [400] * 15 and statuses[15] == 429


# -- staff cannot act as a customer ------------------------------------------------------------


def test_a_staff_session_cannot_record_a_customers_consent(world):
    """Every consent text is a customer's, so only a customer session reads or records one."""
    sedens, a, _, base = world
    texts = consent.texts()
    with sedens.db() as db:
        before = consent.current(db, a["customer_id"])
    for token in (a["coach_token"], a["admin_token"]):
        assert signed_in(base, token).call("GET", "/sedens/consents")[1]["code"] == "passport_customer_only"
        for kind in ("scan_capture", "product_analytics"):
            status, body = signed_in(base, token).call("POST", "/sedens/consents", {
                "kind": kind, "granted": True, "text_version": texts[kind]["version"],
                "user_id": a["customer_id"], "student_id": a["customer_id"]})
            assert status == 403 and body["code"] == "passport_customer_only"
    with sedens.db() as db:
        assert consent.current(db, a["customer_id"]) == before
        assert db.execute("SELECT count(*) FROM s_consents").fetchone()[0] == 0


def test_taking_the_customer_role_away_and_back_does_not_hand_over_the_account(world):
    """Review finding: remove 'student', set a password and email while the account is
    coach-only, give 'student' back. The password is cleared, every sign-in ends and the
    customer is shown both role changes; a consent cannot be recorded in between."""
    sedens, a, _, base = world
    claimed = claim(sedens, base, a)
    customer = Client(base)
    assert customer.call("POST", "/platform/auth/login", {"email": claimed, "password": NEW_PASSWORD})[0] == 200
    admin = signed_in(base, a["admin_token"])
    status, _ = admin.call("POST", "/platform/people/save", person(a, a["customer_id"], "Customer A", roles=["coach"]))
    assert status == 200
    assert customer.call("GET", "/sedens/me")[0] == 401  # the customer session ended, not just paused
    status, _ = admin.call("POST", "/platform/people/save", person(
        a, a["customer_id"], "Customer A", roles=["coach"], email="evil@example.test", password="staff-chosen-pass"))
    assert status == 200  # a staff-only account: staff passwords still work
    as_coach = Client(base)
    status, body = as_coach.call("POST", "/platform/auth/login",
                                 {"email": "evil@example.test", "password": "staff-chosen-pass"})
    assert status == 200 and body["role"] == "coach"
    version = consent.TEXTS["scan_image_retention"]["version"]
    status, body = as_coach.call("POST", "/sedens/consents",
                                 {"kind": "scan_image_retention", "granted": True, "text_version": version})
    assert status == 403 and body["code"] == "passport_customer_only"
    status, _ = admin.call("POST", "/platform/people/save", person(
        a, a["customer_id"], "Customer A", roles=["student"], email="evil@example.test"))
    assert status == 200
    assert hash_of(sedens, a["customer_id"]) == ""
    assert as_coach.call("GET", "/sedens/me")[0] == 401  # it could otherwise switch to the student role
    assert Client(base).call("POST", "/platform/auth/login",
                             {"email": "evil@example.test", "password": "staff-chosen-pass"})[0] == 401
    with sedens.db() as db:
        assert consent.current(db, a["customer_id"])["scan_image_retention"] is None
    assert [k for k, _ in events(sedens, a["customer_id"])][-2:] == ["customer_role_removed", "customer_role_added"]
    assert set(events(sedens, a["customer_id"])[-2:]) == {("customer_role_removed", a["admin"].user_id),
                                                          ("customer_role_added", a["admin"].user_id)}
    # Getting back in takes a link, which the customer sees too.
    body = issue(base, a["admin_token"], a["customer_id"])
    assert body["purpose"] == "setup"


def test_a_staff_member_given_the_customer_role_chooses_a_new_password(world):
    sedens, a, _, base = world
    admin = signed_in(base, a["admin_token"])
    status, _ = admin.call("POST", "/platform/people/save", {
        "id": a["coach_id"], "name": "Coach A", "email": "coach-a@example.test", "roles": ["coach"],
        "password": "coach-own-password"})
    assert status == 200
    coach = Client(base)
    assert coach.call("POST", "/platform/auth/login",
                      {"email": "coach-a@example.test", "password": "coach-own-password"})[0] == 200
    status, _ = admin.call("POST", "/platform/people/save", {
        "id": a["coach_id"], "name": "Coach A", "email": "coach-a@example.test", "roles": ["coach", "student"]})
    assert status == 200 and hash_of(sedens, a["coach_id"]) == ""
    assert coach.call("GET", "/sedens/me")[0] == 401
    assert events(sedens, a["coach_id"]) == [("customer_role_added", a["admin"].user_id)]
    # An administrator who gives themself the customer role keeps their own password and session.
    me = sedens.repo.actor(a["admin_token"])
    status, _ = admin.call("POST", "/platform/people/save", {
        "id": me.user_id, "name": "Admin A", "roles": ["admin", "student"]})
    assert status == 200 and hash_of(sedens, me.user_id) != ""
    assert admin.call("GET", "/sedens/me")[0] == 200


def test_the_passport_refuses_staff(world):
    _, a, _, base = world
    for token in (a["admin_token"], a["coach_token"]):
        for route in ("/sedens/passport/overview", "/sedens/passport/privacy", "/sedens/passport/history"):
            status, body = signed_in(base, token).call("GET", route)
            assert status == 403 and body["code"] == "passport_customer_only"
    assert signed_in(base, a["customer_token"]).call("GET", "/sedens/passport/overview")[0] == 200


# -- phone digits are never enough -------------------------------------------------------------


def test_no_sign_in_accepts_a_phone_number(world):
    sedens, a, _, base = world
    with sedens.db() as db:
        columns = {r[1] for r in db.execute("PRAGMA table_info(p_users)")}
        db.execute("UPDATE p_users SET email=? WHERE id=?", ("01012345678@example.test", a["customer_id"]))
    assert not any("phone" in c for c in columns)
    source = inspect.getsource(sedens.repo.login)
    assert "lower(u.email)=?" in source and "phone" not in source
    for email, password in (("01012345678", "5678"), ("5678", "5678"), ("+821012345678", "1234567890")):
        status, _ = Client(base).call("POST", "/platform/auth/login", {"email": email, "password": password})
        assert status == 401
    with pytest.raises(Refused):
        sedens.repo.login("01012345678", "5678")
    assert "phone" not in crm.METHODS and not any("phone" in m for m in crm.METHODS)


def test_room_entry_never_accepts_phone_digits(world):
    sedens, a, _, base = world
    screen = Client(base)
    screen.jar["sedens_device"] = pair(sedens, a)
    for method, credential, pin in (("phone", "01012345678", ""), ("phone_last4", "5678", ""),
                                    ("access_code", "5678", ""), ("access_code", "010-1234-5678", ""),
                                    ("member_id", "01012345678", "5678")):
        status, body = screen.call("POST", "/sedens/room/enter", {"method": method, "credential": credential,
                                                                  "pin": pin})
        assert status in (400, 403), body
        assert body["code"] in ("unknown_method", "access_code_invalid", "method_not_supported")
        assert "sedens_room" not in screen.jar


def test_a_member_number_alone_never_enters_a_room(world):
    _, _, _, base = world
    screen = Client(base)
    status, body = screen.call("POST", "/sedens/demo/room-device", {"key": KEY})
    assert status == 200
    member = body["credentials"]["members"][0]["member_ref"]
    for pin in ("", "5678", "0000"):
        status, answer = screen.call("POST", "/sedens/room/enter", {"method": "member_id", "credential": member,
                                                                    "pin": pin})
        assert status == 403 and answer["code"] == "invalid_credential"
        assert "sedens_room" not in screen.jar
    status, _ = screen.call("POST", "/sedens/room/enter", {"method": "member_id", "credential": member,
                                                           "pin": demo.DEMO_PIN})
    assert status == 200 and "sedens_room" in screen.jar


def test_platform_sign_in_is_still_throttled_per_address(world):
    sedens, a, _, base = world
    claim(sedens, base, a)
    email = email_of(sedens, a["customer_id"])
    statuses = [Client(base).call("POST", "/platform/auth/login", {"email": email, "password": "wrong-password-x"})[0]
                for _ in range(15)]
    assert statuses == [401] * 15
    status, body = Client(base).call("POST", "/platform/auth/login", {"email": email, "password": NEW_PASSWORD})
    assert status == 429


# -- backups --------------------------------------------------------------------------------------


def test_links_never_go_into_a_backup_and_activity_does(world):
    sedens, a, _, _ = world
    assert backup.POLICIES["s_account_links"].include is False
    assert backup.POLICIES["s_account_events"].include is True
    assert "actor_id" in backup.ATTRIBUTION
    with sedens.db() as db:
        assert backup.tables_without_policy(db) == []


def test_a_restore_keeps_activity_without_links_or_passwords_and_does_not_name_the_restorer(world, tmp_path):
    sedens, a, _, base = world
    issue(base, a["admin_token"], a["other_id"])
    claim(sedens, base, a)
    with sedens.db() as db:
        hashes = [r[0] for r in db.execute("SELECT token_hash FROM s_account_links")]
    path = tmp_path / "a.zip"
    with export_archive(sedens.repo, a["admin"]) as archive:
        shutil.copy(archive, path)
    with zipfile.ZipFile(path) as z:
        blob = b"".join(z.read(name) for name in z.namelist())
    assert hashes and not any(h.encode() in blob for h in hashes)
    owner = sedens.repo.actor(sedens.repo.create_org("Owner", "restore-acct@example.test", PASSWORD, "Restored"))
    restore_archive(sedens.repo, owner, path)
    with sedens.db() as db:
        assert db.execute("SELECT count(*) FROM s_account_links WHERE org_id=?", (owner.org_id,)).fetchone()[0] == 0
        assert {r[0] for r in db.execute("SELECT password_hash FROM p_users WHERE org_id=? AND id<>?",
                                         (owner.org_id, owner.user_id))} == {""}
        rows = db.execute("SELECT kind, actor_id, user_id FROM s_account_events WHERE org_id=?",
                          (owner.org_id,)).fetchall()
    kinds = sorted(r["kind"] for r in rows)
    assert kinds == ["link_issued", "link_issued", "password_set_by_customer", "sessions_revoked"]
    # Admin A created the links, not the owner who restored the archive.
    assert all(r["actor_id"] is None for r in rows if r["kind"] == "link_issued")
    assert all(r["actor_id"] == r["user_id"] for r in rows if r["kind"] != "link_issued")
