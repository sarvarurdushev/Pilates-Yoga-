"""The permission rules, over HTTP, where they actually have to hold.

The unit tests in ``test_accounts.py`` prove the rules. These prove that the
server applies them -- including on the routes that existed before accounts did,
which are the routes that actually carry the data. A permission system that
guards only its own new endpoints is decoration.
"""
import json
import threading
import urllib.error
import urllib.request

import pytest

from pilates.accounts import ADMIN, COACH, PARQ, STUDENT, Account, Studio, today
from pilates.onboarding import grant, sign_up
from pilates.serve import WEB, serve
from pilates.store import Store

PASSWORD = "a decently long password"


class Client:
    """One browser: keeps its cookie, and reports refusals as values."""

    def __init__(self, base):
        self.base = base
        self.jar = ""

    def _open(self, request):
        if self.jar:
            request.add_header("Cookie", self.jar)
        try:
            with urllib.request.urlopen(request, timeout=15) as response:
                for header, value in response.getheaders():
                    if header.lower() == "set-cookie":
                        self.jar = value.split(";")[0]
                body = response.read()
                return response.status, (json.loads(body) if body else {})
        except urllib.error.HTTPError as error:
            body = error.read()
            try:
                return error.code, json.loads(body)
            except ValueError:
                return error.code, {}

    def get(self, path):
        return self._open(urllib.request.Request(f"{self.base}{path}"))

    def post(self, path, payload=None):
        return self._open(urllib.request.Request(
            f"{self.base}{path}", method="POST",
            data=json.dumps(payload or {}).encode(),
            headers={"Content-Type": "application/json"}))

    def sign_in(self, email, password=PASSWORD):
        return self.post("/auth/signin", {"email": email, "password": password})


@pytest.fixture
def studio(tmp_path, monkeypatch):
    monkeypatch.setattr("pilates.passwords.N", 2 ** 14)
    db = tmp_path / "studio.db"
    with Store.open(db) as store:
        store.add_studio(Studio(key="tashkent", name="Tashkent Pilates"))
        store.add_studio(Studio(key="samarkand", name="Samarkand Yoga"))
        boss = Account(email="boss@b.co", display_name="The Owner")
        store.create_account(boss, password=PASSWORD)
        for role in (ADMIN, COACH, STUDENT):
            grant(store, boss.username, "tashkent", role, by="bootstrap")
        coach = Account(email="coach@b.co", display_name="A Coach")
        store.create_account(coach, password=PASSWORD)
        grant(store, coach.username, "tashkent", COACH, by=boss.username)
        other = Account(email="other@b.co", display_name="Another Coach")
        store.create_account(other, password=PASSWORD)
        grant(store, other.username, "tashkent", COACH, by=boss.username)
        for email, name in (("ann@b.co", "Ann"), ("ben@b.co", "Ben")):
            sign_up(store, email, name, PASSWORD, "tashkent", wants=STUDENT)
        names = {"boss": boss.username, "coach": coach.username,
                 "other": other.username,
                 "ann": store.account_by_email("ann@b.co").username,
                 "ben": store.account_by_email("ben@b.co").username}

    server, url = serve(None, root=WEB, port=0, analyse=True, db=str(db))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = url.split("/index.html")[0]
    yield base, names, db
    server.shutdown()


class TestSigningInOverHttp:
    def test_a_signed_out_visitor_is_told_what_studios_there_are(self, studio):
        base, _, _ = studio
        status, payload = Client(base).get("/auth/me")
        assert status == 200 and payload["signed_in"] is False
        assert {s["key"] for s in payload["studios"]} == {"tashkent", "samarkand"}

    def test_the_signup_form_is_never_offered_admin(self, studio):
        base, _, _ = studio
        _, payload = Client(base).get("/auth/me")
        assert set(payload["roles"]) == {"student", "coach"}

    def test_a_good_password_sets_a_cookie_and_a_role(self, studio):
        base, _, _ = studio
        client = Client(base)
        status, payload = client.sign_in("ann@b.co")
        assert status == 200 and payload["acting"]["role"] == STUDENT
        assert client.jar

    def test_a_bad_password_is_a_401_and_no_cookie(self, studio):
        base, _, _ = studio
        client = Client(base)
        status, _ = client.sign_in("ann@b.co", "wrong")
        assert status == 401 and not client.jar

    def test_the_cookie_is_not_readable_by_scripts(self, studio):
        base, _, _ = studio
        request = urllib.request.Request(
            f"{base}/auth/signin", method="POST",
            data=json.dumps({"email": "ann@b.co", "password": PASSWORD}).encode(),
            headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(request, timeout=15) as response:
            cookie = dict(response.getheaders())["Set-Cookie"]
        assert "HttpOnly" in cookie and "SameSite=Strict" in cookie

    def test_signing_out_clears_it(self, studio):
        base, _, _ = studio
        client = Client(base)
        client.sign_in("ann@b.co")
        client.post("/auth/signout")
        assert client.get("/auth/me")[1]["signed_in"] is False


class TestSwitchingRoleOverHttp:
    def test_the_room_changes_with_the_role(self, studio):
        base, _, _ = studio
        client = Client(base)
        client.sign_in("boss@b.co")
        assert client.get("/auth/me")[1]["can"]["administer"] is False
        client.post("/auth/switch", {"studio": "tashkent", "role": ADMIN})
        assert client.get("/auth/me")[1]["can"]["administer"] is True

    def test_a_student_cannot_switch_to_admin(self, studio):
        base, _, _ = studio
        client = Client(base)
        client.sign_in("ann@b.co")
        status, _ = client.post("/auth/switch",
                                {"studio": "tashkent", "role": ADMIN})
        assert status == 403
        assert client.get("/auth/me")[1]["can"]["administer"] is False


class TestWhatAStudentCanReach:
    @pytest.fixture
    def ann(self, studio):
        base, names, db = studio
        client = Client(base)
        client.sign_in("ann@b.co")
        return client, names, db

    def test_their_own_record(self, ann):
        client, names, _ = ann
        status, payload = client.get(f"/student?username={names['ann']}")
        assert status == 200 and payload["seen_as"] == "self"

    def test_never_another_student_s(self, ann):
        client, names, _ = ann
        status, payload = client.get(f"/student?username={names['ben']}")
        assert status == 403 and "permission" in payload["error"]

    def test_not_the_roster(self, ann):
        client, _, _ = ann
        assert client.get("/roster")[0] == 403

    def test_not_the_directory(self, ann):
        client, _, _ = ann
        assert client.get("/directory")[0] == 403

    def test_not_the_admin_pages(self, ann):
        client, _, _ = ann
        assert client.get("/admin/people")[0] == 403
        assert client.get("/admin/pending")[0] == 403

    def test_not_somebody_else_s_audit_log(self, ann):
        client, names, _ = ann
        assert client.get(f"/audit?username={names['ben']}")[0] == 403

    def test_their_own_audit_log(self, ann):
        """Being able to read who opened your file is what makes the promise
        checkable rather than a sentence in a policy."""
        client, _, _ = ann
        assert client.get("/audit")[0] == 200


class TestWhatACoachCanReach:
    @pytest.fixture
    def coach(self, studio):
        base, names, db = studio
        client = Client(base)
        client.sign_in("coach@b.co")
        return client, names, db

    def test_the_directory_is_names_and_nothing_else(self, coach):
        """A phone book, not a record. A directory that leaked ages and phone
        numbers would make the assignment step decorative."""
        client, _, _ = coach
        status, payload = client.get("/directory")
        assert status == 200
        for person in payload["people"]:
            assert set(person) == {"username", "display_name", "state", "mine"}

    def test_an_empty_roster_before_anybody_is_assigned(self, coach):
        client, _, _ = coach
        assert client.get("/roster")[1]["students"] == []

    def test_a_student_in_the_building_is_not_readable(self, coach):
        client, names, _ = coach
        status, payload = client.get(f"/student?username={names['ann']}")
        assert status == 403 and "permission" in payload["error"]

    def test_asking_grants_nothing_by_itself(self, coach):
        """A coach asking is not a student agreeing."""
        client, names, _ = coach
        assert client.post("/roster/add", {"student": names["ann"]})[0] == 200
        assert client.get(f"/student?username={names['ann']}")[0] == 403
        assert client.get("/roster")[1]["students"] == []

    def test_the_student_accepting_is_what_grants_it(self, coach, studio):
        base, names, _ = studio
        client, _, _ = coach
        client.post("/roster/add", {"student": names["ann"]})

        ann = Client(base)
        ann.sign_in("ann@b.co")
        assert ann.post("/roster/answer",
                        {"coach": names["coach"], "accept": True})[0] == 200

        status, payload = client.get(f"/student?username={names['ann']}")
        assert status == 200 and payload["seen_as"] == "coach"
        assert [s["username"] for s in client.get("/roster")[1]["students"]] \
            == [names["ann"]]

    def test_another_coach_still_cannot_read_them(self, coach, studio):
        """The first place the naive same-building rule leaks, and health data
        is the worst thing to leak."""
        base, names, _ = studio
        client, _, _ = coach
        client.post("/roster/add", {"student": names["ann"]})
        ann = Client(base)
        ann.sign_in("ann@b.co")
        ann.post("/roster/answer", {"coach": names["coach"], "accept": True})

        other = Client(base)
        other.sign_in("other@b.co")
        assert other.get(f"/student?username={names['ann']}")[0] == 403

    def test_the_student_revoking_takes_it_away_again(self, coach, studio):
        base, names, _ = studio
        client, _, _ = coach
        client.post("/roster/add", {"student": names["ann"]})
        ann = Client(base)
        ann.sign_in("ann@b.co")
        ann.post("/roster/answer", {"coach": names["coach"], "accept": True})
        assert client.get(f"/student?username={names['ann']}")[0] == 200

        ann.post("/roster/end", {"coach": names["coach"],
                                 "student": names["ann"]})
        assert client.get(f"/student?username={names['ann']}")[0] == 403

    def test_a_coach_cannot_add_to_somebody_else_s_roster(self, coach):
        client, names, _ = coach
        status, _ = client.post("/roster/add", {"student": names["ann"],
                                                "coach": names["other"]})
        assert status == 403

    def test_a_coach_cannot_answer_a_health_questionnaire_for_a_student(self, coach):
        """The value of the thing is entirely that the person answered it."""
        client, names, _ = coach
        status, _ = client.post("/me/screening",
                                {"username": names["ann"],
                                 "answers": {k: False for k in PARQ}})
        assert status == 403

    def test_a_coach_cannot_grant_themselves_anything(self, coach):
        client, names, _ = coach
        assert client.post("/admin/grant", {"username": names["coach"],
                                            "role": ADMIN})[0] == 403
        assert client.post("/admin/decide", {"username": names["coach"],
                                             "role": ADMIN})[0] == 403


class TestWhatAnAdminCanReach:
    @pytest.fixture
    def boss(self, studio):
        base, names, db = studio
        client = Client(base)
        client.sign_in("boss@b.co")
        client.post("/auth/switch", {"studio": "tashkent", "role": ADMIN})
        return client, names, db

    def test_everybody_including_the_full_screening(self, boss):
        client, _, _ = boss
        status, payload = client.get("/admin/people")
        assert status == 200 and len(payload["people"]) == 5
        # Their own row reads as "self": an admin looking at themselves is
        # still themselves, which is the same rule everywhere else.
        assert all(p["seen_as"] in ("admin", "self") for p in payload["people"])
        assert [p for p in payload["people"] if p["seen_as"] == "self"]

    def test_any_student_s_record(self, boss):
        client, names, _ = boss
        assert client.get(f"/student?username={names['ann']}")[0] == 200

    def test_the_inbox_of_things_to_decide(self, boss, studio):
        base, _, _ = studio
        Client(base).post("/auth/signup",
                          {"email": "new@b.co", "display_name": "A New Coach",
                           "password": PASSWORD, "studio": "tashkent",
                           "wants": COACH})
        client, _, _ = boss
        waiting = client.get("/admin/pending")[1]["pending"]
        assert [row["email"] for row in waiting] == ["new@b.co"]

    def test_approving_lets_them_in(self, boss, studio):
        base, _, _ = studio
        Client(base).post("/auth/signup",
                          {"email": "new@b.co", "display_name": "A New Coach",
                           "password": PASSWORD, "studio": "tashkent",
                           "wants": COACH})
        client, _, _ = boss
        username = client.get("/admin/pending")[1]["pending"][0]["username"]
        assert client.post("/admin/decide",
                           {"username": username, "role": COACH})[0] == 200
        assert Client(base).sign_in("new@b.co")[0] == 200

    def test_granting_admin_is_something_only_an_admin_can_do(self, boss):
        client, names, _ = boss
        status, payload = client.post("/admin/grant",
                                      {"username": names["coach"],
                                       "role": ADMIN})
        assert status == 200 and payload["role"] == ADMIN

    def test_an_invitation_scopes_the_role_in_the_same_act(self, boss):
        client, _, _ = boss
        status, payload = client.post("/admin/invite",
                                      {"email": "invited@b.co", "role": COACH})
        assert status == 200 and payload["token"]

    def test_every_read_of_a_record_is_logged(self, boss):
        """The only way "who saw my health record" has an answer."""
        client, names, _ = boss
        client.get(f"/student?username={names['ann']}")
        events = client.get(f"/audit?username={names['ann']}")[1]["events"]
        assert any(e["action"] == "record:read" and e["actor"] == names["boss"]
                   for e in events)


class TestTheOlderRoutesAreGuardedToo:
    """A permission system that guards only its own new endpoints is
    decoration. These are the routes that actually carry the data."""

    def test_a_student_sees_only_their_own_recordings(self, studio):
        base, names, _ = studio
        client = Client(base)
        client.sign_in("ann@b.co")
        status, payload = client.get("/recordings")
        assert status == 200
        assert all(r.get("username") in ("", names["ann"])
                   for r in payload["recordings"])

    def test_a_student_cannot_fetch_another_person_s_bundle(self, studio):
        base, names, _ = studio
        client = Client(base)
        client.sign_in("ann@b.co")
        status, _ = client.get(
            f"/recording?user={names['ben']}&session=whatever")
        assert status == 403

    def test_a_student_cannot_read_another_person_s_coach_sheet(self, studio):
        base, names, _ = studio
        client = Client(base)
        client.sign_in("ann@b.co")
        assert client.get(f"/sheet?user={names['ben']}")[0] == 403

    def test_a_coach_cannot_write_a_note_about_a_stranger(self, studio):
        base, names, _ = studio
        client = Client(base)
        client.sign_in("coach@b.co")
        status, payload = client.post("/note", {
            "username": names["ann"], "kind": "cue", "by": "A Coach",
            "text": "reach the heel away"})
        assert status == 403 and "coach" in payload["error"]

    def test_a_coach_can_write_about_their_own_student(self, studio):
        base, names, _ = studio
        coach = Client(base)
        coach.sign_in("coach@b.co")
        coach.post("/roster/add", {"student": names["ann"]})
        ann = Client(base)
        ann.sign_in("ann@b.co")
        ann.post("/roster/answer", {"coach": names["coach"], "accept": True})
        status, payload = coach.post("/note", {
            "username": names["ann"], "kind": "cue", "by": "A Coach",
            "text": "reach the heel away"})
        assert status == 201 and payload["sheet"]["cues"]

    def test_signed_out_reaches_nothing_once_accounts_exist(self, studio):
        base, names, _ = studio
        client = Client(base)
        assert client.get(f"/sheet?user={names['ann']}")[0] == 401
        assert client.get(f"/student?username={names['ann']}")[0] == 401
        assert client.get("/roster")[0] == 401

    def test_a_database_with_no_accounts_keeps_the_old_behaviour(self, tmp_path):
        """A studio that never created an account keeps what it had. The moment
        the first account exists, permission is enforced everywhere -- a
        half-enforced system is one where somebody believes they are protected
        and is not."""
        from pilates.demo import fill

        db = tmp_path / "plain.db"
        with Store.open(db) as store:
            fill(store, session="s1", date="2026-03-03")
        server, url = serve(None, root=WEB, port=0, analyse=True, db=str(db))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            client = Client(url.split("/index.html")[0])
            assert client.get("/sheet?user=anna")[0] == 200
            assert client.get("/recordings")[0] == 200
        finally:
            server.shutdown()


class TestSigningUpOverHttp:
    def test_a_student_is_in_immediately(self, studio):
        base, _, _ = studio
        client = Client(base)
        status, payload = client.post("/auth/signup", {
            "email": "new@b.co", "display_name": "A New Student",
            "password": PASSWORD, "studio": "tashkent", "wants": STUDENT,
            "phone": "+998901234500", "born": "1998-04-12",
            "height_m": 1.76, "mass_kg": 72})
        assert status == 201 and payload["waiting"] is False
        assert client.sign_in("new@b.co")[0] == 200

    def test_a_coach_is_not(self, studio):
        base, _, _ = studio
        client = Client(base)
        status, payload = client.post("/auth/signup", {
            "email": "newcoach@b.co", "display_name": "A New Coach",
            "password": PASSWORD, "studio": "tashkent", "wants": COACH})
        assert status == 201 and payload["waiting"] is True
        assert client.sign_in("newcoach@b.co")[0] == 401

    def test_asking_for_admin_over_http_is_refused(self, studio):
        base, _, _ = studio
        status, payload = Client(base).post("/auth/signup", {
            "email": "sneaky@b.co", "display_name": "Sneaky",
            "password": PASSWORD, "studio": "tashkent", "wants": ADMIN})
        assert status == 400 and "never requested" in payload["error"]

    def test_a_short_password_is_refused(self, studio):
        base, _, _ = studio
        status, payload = Client(base).post("/auth/signup", {
            "email": "weak@b.co", "display_name": "Weak", "password": "1234",
            "studio": "tashkent", "wants": STUDENT})
        assert status == 400 and "characters" in payload["error"]

    def test_the_profile_and_screening_round_trip(self, studio):
        base, _, _ = studio
        client = Client(base)
        client.post("/auth/signup", {
            "email": "new@b.co", "display_name": "A New Student",
            "password": PASSWORD, "studio": "tashkent", "wants": STUDENT})
        client.sign_in("new@b.co")
        client.post("/me/profile", {"born": "1998-04-12", "height_m": 1.76,
                                    "mass_kg": 72})
        client.post("/me/screening", {
            "answers": {k: (k == "joint") for k in PARQ},
            "injuries": "left knee, no deep flexion",
            "cleared_by_physician": True})
        me = client.get("/auth/me")[1]
        assert me["profile"]["age"] is not None
        assert "left knee" in " ".join(me["screening"]["flags"])


class TestTheRosterSaysWhatToReadFirst:
    """An unscreened student and an overdue goal are the two things that must
    not be found by scrolling."""

    def _assign(self, base, names):
        coach = Client(base)
        coach.sign_in("coach@b.co")
        coach.post("/roster/add", {"student": names["ann"]})
        ann = Client(base)
        ann.sign_in("ann@b.co")
        ann.post("/roster/answer", {"coach": names["coach"], "accept": True})
        return coach, ann

    def test_never_screened_is_flagged_rather_than_silent(self, studio):
        """An empty flags list reads as "nothing to worry about", which is the
        opposite of what never having been asked means."""
        base, names, _ = studio
        coach, _ = self._assign(base, names)
        row = coach.get("/roster")[1]["students"][0]
        assert row["flags"] == ["not screened yet"]
        assert row["urgent"] is True

    def test_a_screened_student_with_a_knee_says_so_and_no_more(self, studio):
        base, names, _ = studio
        coach, ann = self._assign(base, names)
        ann.post("/me/screening", {
            "answers": {k: (k == "joint") for k in PARQ},
            "conditions": "an old meniscus tear", "medications": "ibuprofen",
            "injuries": "left knee, no deep flexion",
            "cleared_by_physician": True})
        row = coach.get("/roster")[1]["students"][0]
        printed = " ".join(row["flags"]).lower()
        assert "knee" in printed
        assert "ibuprofen" not in printed and "meniscus" not in printed
        assert row["urgent"] is False

    def test_the_urgent_ones_come_first(self, studio):
        base, names, _ = studio
        coach, ann = self._assign(base, names)
        ann.post("/me/screening", {"answers": {k: False for k in PARQ}})
        coach.post("/roster/add", {"student": names["ben"]})
        ben = Client(base)
        ben.sign_in("ben@b.co")
        ben.post("/roster/answer", {"coach": names["coach"], "accept": True})
        order = [s["display_name"] for s in coach.get("/roster")[1]["students"]]
        assert order[0] == "Ben"  # never screened
