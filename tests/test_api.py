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
        store.add_studio(Studio(key="gangnam", name="Gangnam Pilates"))
        store.add_studio(Studio(key="hongdae", name="Hongdae Movement Lab"))
        boss = Account(email="boss@b.co", display_name="The Owner")
        store.create_account(boss, password=PASSWORD)
        for role in (ADMIN, COACH, STUDENT):
            grant(store, boss.username, "gangnam", role, by="bootstrap")
        coach = Account(email="coach@b.co", display_name="A Coach")
        store.create_account(coach, password=PASSWORD)
        grant(store, coach.username, "gangnam", COACH, by=boss.username)
        other = Account(email="other@b.co", display_name="Another Coach")
        store.create_account(other, password=PASSWORD)
        grant(store, other.username, "gangnam", COACH, by=boss.username)
        for email, name in (("ann@b.co", "Ann"), ("ben@b.co", "Ben")):
            sign_up(store, email, name, PASSWORD, "gangnam", wants=STUDENT)
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
        assert {s["key"] for s in payload["studios"]} == {"gangnam", "hongdae"}

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
        client.post("/auth/switch", {"studio": "gangnam", "role": ADMIN})
        assert client.get("/auth/me")[1]["can"]["administer"] is True

    def test_a_student_cannot_switch_to_admin(self, studio):
        base, _, _ = studio
        client = Client(base)
        client.sign_in("ann@b.co")
        status, _ = client.post("/auth/switch",
                                {"studio": "gangnam", "role": ADMIN})
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
            assert set(person) == {"username", "display_name", "mine"}

    def test_an_empty_roster_before_anybody_is_assigned(self, coach):
        client, _, _ = coach
        assert client.get("/roster")[1]["students"] == []

    def test_a_student_in_the_building_is_not_readable(self, coach):
        client, names, _ = coach
        status, payload = client.get(f"/student?username={names['ann']}")
        assert status == 403 and "permission" in payload["error"]

    def test_adding_takes_effect_at_once(self, coach):
        """It used to be a request the student had to accept, which is how two
        strangers share data and not how a studio works -- a coach could not put
        their own class on their own roster without a round trip."""
        client, names, _ = coach
        assert client.post("/roster/add", {"student": names["ann"]})[0] == 200
        status, payload = client.get(f"/student?username={names['ann']}")
        assert status == 200 and payload["seen_as"] == "coach"
        assert [s["username"] for s in client.get("/roster")[1]["students"]] \
            == [names["ann"]]

    def test_a_whole_list_goes_on_in_one_press(self, coach):
        client, names, _ = coach
        status, payload = client.post(
            "/roster/add", {"students": [names["ann"], names["ben"]]})
        assert status == 200 and set(payload["added"]) == {names["ann"],
                                                           names["ben"]}
        assert len(client.get("/roster")[1]["students"]) == 2

    def test_a_stale_name_in_a_bulk_add_does_not_fail_the_rest(self, coach):
        """A bulk add that refuses everything because one row is stale is a
        bulk add nobody uses twice."""
        client, names, _ = coach
        _, payload = client.post(
            "/roster/add", {"students": [names["ann"], "somebody_who_left"]})
        assert payload["added"] == [names["ann"]]
        assert payload["missing"] == ["somebody_who_left"]

    def test_the_directory_says_who_is_left_to_add(self, coach):
        client, names, _ = coach
        assert set(client.get("/directory")[1]["not_mine"]) == {
            names["ann"], names["ben"], names["boss"]}
        client.post("/roster/add", {"student": names["ann"]})
        assert names["ann"] not in client.get("/directory")[1]["not_mine"]

    def test_another_coach_still_cannot_read_them(self, coach, studio):
        """The first place the naive same-building rule leaks, and health data
        is the worst thing to leak."""
        base, names, _ = studio
        client, _, _ = coach
        client.post("/roster/add", {"student": names["ann"]})

        other = Client(base)
        other.sign_in("other@b.co")
        assert other.get(f"/student?username={names['ann']}")[0] == 403

    def test_the_student_revoking_takes_it_away_again(self, coach, studio):
        """The half of consent that does the work now that adding is
        immediate."""
        base, names, _ = studio
        client, _, _ = coach
        client.post("/roster/add", {"student": names["ann"]})
        assert client.get(f"/student?username={names['ann']}")[0] == 200

        ann = Client(base)
        ann.sign_in("ann@b.co")
        assert ann.post("/roster/remove", {"coach": names["coach"]})[0] == 200
        assert client.get(f"/student?username={names['ann']}")[0] == 403

    def test_a_student_can_see_exactly_who_can_open_their_record(self, coach,
                                                                studio):
        base, names, _ = studio
        client, _, _ = coach
        client.post("/roster/add", {"student": names["ann"]})
        ann = Client(base)
        ann.sign_in("ann@b.co")
        mine = ann.get("/me/coaches")[1]["coaches"]
        assert [c["username"] for c in mine] == [names["coach"]]
        assert "measurements" in mine[0]["sees"]

    def test_a_coach_can_take_somebody_off_their_own_roster(self, coach):
        client, names, _ = coach
        client.post("/roster/add", {"student": names["ann"]})
        assert client.post("/roster/remove",
                           {"coach": names["coach"],
                            "student": names["ann"]})[0] == 200
        assert client.get("/roster")[1]["students"] == []

    def test_a_stranger_cannot_end_somebody_else_s_assignment(self, coach,
                                                              studio):
        base, names, _ = studio
        client, _, _ = coach
        client.post("/roster/add", {"student": names["ann"]})
        ben = Client(base)
        ben.sign_in("ben@b.co")
        assert ben.post("/roster/remove", {"coach": names["coach"],
                                           "student": names["ann"]})[0] == 403

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
        client.post("/auth/switch", {"studio": "gangnam", "role": ADMIN})
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
                           "password": PASSWORD, "studio": "gangnam",
                           "wants": COACH})
        client, _, _ = boss
        waiting = client.get("/admin/pending")[1]["pending"]
        assert [row["email"] for row in waiting] == ["new@b.co"]

    def test_approving_lets_them_in(self, boss, studio):
        base, _, _ = studio
        Client(base).post("/auth/signup",
                          {"email": "new@b.co", "display_name": "A New Coach",
                           "password": PASSWORD, "studio": "gangnam",
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

    def test_a_database_with_no_accounts_serves_nobody_s_record(self, tmp_path):
        """This used to be the compatibility rule and it was a hole.

        A studio that had not got round to making an account served every
        record on it to whoever asked -- so "not set up yet" was a way through
        the door, on exactly the deployments least likely to notice. Now an
        account-less database offers one thing, which is the setup that makes
        the first admin.
        """
        from pilates.demo import fill

        db = tmp_path / "plain.db"
        with Store.open(db) as store:
            fill(store, session="s1", date="2026-03-03")
        server, url = serve(None, root=WEB, port=0, analyse=True, db=str(db))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            client = Client(url.split("/index.html")[0])
            assert client.get("/sheet?user=anna")[0] == 401
            assert client.get("/recordings")[0] == 401
            assert client.get("/student?username=anna")[0] == 401
            # And it says which screen to draw rather than leaving the page to
            # guess between "sign in" and "there is nobody to sign in as".
            me = client.get("/auth/me")[1]
            assert me["accounts"] is True and me["setup"] is True
        finally:
            server.shutdown()

    def test_the_first_admin_can_be_made_and_only_once(self, tmp_path,
                                                       monkeypatch):
        """Two people opening the setup page of a fresh deployment at the same
        moment is not hypothetical -- it is a URL somebody shared."""
        monkeypatch.setattr("pilates.passwords.N", 2 ** 14)
        from pilates.demo import fill

        db = tmp_path / "plain.db"
        with Store.open(db) as store:
            fill(store, session="s1", date="2026-03-03")
        server, url = serve(None, root=WEB, port=0, analyse=True, db=str(db))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            base = url.split("/index.html")[0]
            client = Client(base)
            made = {"email": "owner@b.co", "display_name": "The Owner",
                    "password": PASSWORD, "studio_key": "here",
                    "studio_name": "The Studio"}
            status, payload = client.post("/auth/setup", made)
            assert status == 201 and payload["username"]
            # Shown once, at the only moment they can be: the owner of a studio
            # locking themselves out of it is the failure with no way back.
            assert len(payload["recovery_codes"]) == 8

            # The second attempt is refused, whoever makes it.
            again, refusal = Client(base).post("/auth/setup", made)
            assert again == 409 and "already has an owner" in refusal["error"]

            # And now the records are reachable, by the person who claimed it.
            client.sign_in("owner@b.co")
            assert client.get("/recordings")[0] == 200
            assert Client(base).get("/recordings")[0] == 401
        finally:
            server.shutdown()


class TestSigningUpOverHttp:
    def test_a_student_is_in_immediately(self, studio):
        base, _, _ = studio
        client = Client(base)
        status, payload = client.post("/auth/signup", {
            "email": "new@b.co", "display_name": "A New Student",
            "password": PASSWORD, "studio": "gangnam", "wants": STUDENT,
            "phone": "+821012345600", "born": "1998-04-12",
            "height_m": 1.76, "mass_kg": 72})
        assert status == 201 and payload["waiting"] is False
        assert client.sign_in("new@b.co")[0] == 200

    def test_a_coach_is_not(self, studio):
        base, _, _ = studio
        client = Client(base)
        status, payload = client.post("/auth/signup", {
            "email": "newcoach@b.co", "display_name": "A New Coach",
            "password": PASSWORD, "studio": "gangnam", "wants": COACH})
        assert status == 201 and payload["waiting"] is True
        assert client.sign_in("newcoach@b.co")[0] == 401

    def test_asking_for_admin_over_http_is_refused(self, studio):
        base, _, _ = studio
        status, payload = Client(base).post("/auth/signup", {
            "email": "sneaky@b.co", "display_name": "Sneaky",
            "password": PASSWORD, "studio": "gangnam", "wants": ADMIN})
        assert status == 400 and "never requested" in payload["error"]

    def test_a_short_password_is_refused(self, studio):
        base, _, _ = studio
        status, payload = Client(base).post("/auth/signup", {
            "email": "weak@b.co", "display_name": "Weak", "password": "1234",
            "studio": "gangnam", "wants": STUDENT})
        assert status == 400 and "characters" in payload["error"]

    def test_the_profile_and_screening_round_trip(self, studio):
        base, _, _ = studio
        client = Client(base)
        client.post("/auth/signup", {
            "email": "new@b.co", "display_name": "A New Student",
            "password": PASSWORD, "studio": "gangnam", "wants": STUDENT})
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
        order = [s["display_name"] for s in coach.get("/roster")[1]["students"]]
        assert order[0] == "Ben"  # never screened


    def test_what_was_written_shows_on_the_roster_not_two_clicks_inside_it(
            self, studio):
        """A reading nobody sees before the class changes nothing about it."""
        base, names, _ = studio
        coach, _ = self._assign(base, names)
        coach.post("/evaluate-structure", {
            "username": names["ann"], "structure": "psoas major",
            "kind": "muscle", "note": "wall roll-downs before the mat work",
            "checks": [{"label": "how much work", "verdict": "problem"}]})
        row = coach.get("/roster")[1]["students"][0]
        assert row["focus"] == "psoas major: how much work — a problem"
        assert row["readings"] == 1
        assert row["note"] == "wall roll-downs before the mat work"

    def test_the_two_lines_are_two_different_findings(self, studio):
        """A coach who flags a shoulder in week eleven flagged it in week ten
        as well. A roster saying the same thing twice has told you one thing."""
        base, names, _ = studio
        coach, _ = self._assign(base, names)
        for _ in range(3):
            coach.post("/evaluate-structure", {
                "username": names["ann"], "structure": "trapezius",
                "kind": "muscle",
                "checks": [{"label": "does the shoulder shrug",
                            "verdict": "watch"}]})
        coach.post("/evaluate-structure", {
            "username": names["ann"], "structure": "psoas major",
            "kind": "muscle",
            "checks": [{"label": "how much work", "verdict": "problem"}]})
        row = coach.get("/roster")[1]["students"][0]
        assert row["focus"] != row["also"]
        assert "psoas major" in row["focus"] and "trapezius" in row["also"]

    def test_nothing_written_is_a_thing_to_see_not_an_absence(self, studio):
        base, names, _ = studio
        coach, _ = self._assign(base, names)
        row = coach.get("/roster")[1]["students"][0]
        assert row["readings"] == 0 and row["focus"] == ""

    def test_a_nerve_problem_outranks_everything_else_on_the_list(self, studio):
        """The one thing on this screen allowed to jump the queue."""
        base, names, _ = studio
        coach, ann = self._assign(base, names)
        ann.post("/me/screening", {"answers": {k: False for k in PARQ}})
        coach.post("/roster/add", {"student": names["ben"]})
        ben = Client(base)
        ben.sign_in("ben@b.co")
        ben.post("/me/screening", {"answers": {k: False for k in PARQ}})
        coach.post("/evaluate-structure", {
            "username": names["ann"], "structure": "sciatic nerve",
            "kind": "nerve",
            "checks": [{"label": "how long it lasted", "verdict": "problem"}]})
        order = [s["display_name"] for s in coach.get("/roster")[1]["students"]]
        assert order[0] == "Ann"

    def test_somebody_never_read_sorts_above_somebody_read(self, studio):
        """It is the row where the coach has nothing at all to go on."""
        base, names, _ = studio
        coach, ann = self._assign(base, names)
        ann.post("/me/screening", {"answers": {k: False for k in PARQ}})
        coach.post("/roster/add", {"student": names["ben"]})
        ben = Client(base)
        ben.sign_in("ben@b.co")
        ben.post("/me/screening", {"answers": {k: False for k in PARQ}})
        coach.post("/evaluate-structure", {
            "username": names["ben"], "structure": "psoas major",
            "kind": "muscle", "note": "fine"})
        order = [s["display_name"] for s in coach.get("/roster")[1]["students"]]
        assert order.index("Ann") < order.index("Ben")


class TestReadingWhateverIsOnTheScreen:
    """The coach writes the checks; this end validates almost nothing."""

    def _coach(self, base, names):
        coach = Client(base)
        coach.sign_in("coach@b.co")
        coach.post("/roster/add", {"student": names["ann"]})
        return coach

    def test_the_starting_points_differ_by_kind(self, studio):
        base, names, _ = studio
        coach = self._coach(base, names)
        muscle = coach.get(f"/structure?username={names['ann']}"
                           "&structure=psoas+major&kind=muscle")[1]
        bone = coach.get(f"/structure?username={names['ann']}"
                         "&structure=atlas&kind=bone")[1]
        assert muscle["suggested"] and bone["suggested"]
        assert muscle["suggested"] != bone["suggested"]

    def test_a_brain_region_is_refused_with_a_reason(self, studio):
        base, names, _ = studio
        coach = self._coach(base, names)
        status, out = coach.get(f"/structure?username={names['ann']}"
                                "&structure=frontal+lobe&kind=brain")
        assert status == 200 and out["open"] is False and "brain" in out["why"]
        assert coach.post("/evaluate-structure",
                          {"username": names["ann"], "structure": "frontal lobe",
                           "kind": "brain", "note": "x"})[0] == 400

    def test_writing_one_and_reading_it_back(self, studio):
        base, names, _ = studio
        coach = self._coach(base, names)
        status, out = coach.post("/evaluate-structure", {
            "username": names["ann"], "structure": "psoas major",
            "kind": "muscle", "fma": "FMA18060",
            "note": "took over from the abdominals on every teaser",
            "checks": [{"label": "how much work", "verdict": "problem",
                        "note": "all of it"},
                       {"label": "left against right", "verdict": "fine"}]})
        assert status == 200
        assert out["evaluation"]["flagged"] == ["how much work — a problem"]
        seen = coach.get(f"/structures-seen?username={names['ann']}")[1]
        assert [r["structure"] for r in seen["structures"]] == ["psoas major"]

    def test_their_own_wording_comes_back_as_a_suggestion(self, studio):
        """The second reading of a psoas is one press, not the same phrase
        typed again."""
        base, names, _ = studio
        coach = self._coach(base, names)
        coach.post("/evaluate-structure", {
            "username": names["ann"], "structure": "psoas major",
            "kind": "muscle",
            "checks": [{"label": "does it let go at the bottom",
                        "verdict": "watch"}]})
        again = coach.get(f"/structure?username={names['ann']}"
                          "&structure=psoas+major&kind=muscle")[1]
        assert again["suggested"][0] == "does it let go at the bottom"
        assert again["yours"] == 1

    def test_a_nerve_called_a_problem_is_flagged(self, studio):
        base, names, _ = studio
        coach = self._coach(base, names)
        out = coach.post("/evaluate-structure", {
            "username": names["ann"], "structure": "sciatic nerve",
            "kind": "nerve",
            "checks": [{"label": "how long it lasted", "verdict": "problem",
                        "note": "still there when she left"}]})[1]
        assert out["evaluation"]["urgent"] is True
        seen = coach.get(f"/structures-seen?username={names['ann']}")[1]
        assert seen["structures"][0]["urgent"] is True

    def test_a_note_on_its_own_is_accepted(self, studio):
        base, names, _ = studio
        coach = self._coach(base, names)
        assert coach.post("/evaluate-structure", {
            "username": names["ann"], "structure": "psoas major",
            "kind": "muscle", "note": "nothing to report, best I have seen"
        })[0] == 200

    def test_a_student_reads_their_own_and_cannot_write(self, studio):
        base, names, _ = studio
        coach = self._coach(base, names)
        coach.post("/evaluate-structure", {
            "username": names["ann"], "structure": "psoas major",
            "kind": "muscle", "note": "gripping"})
        ann = Client(base)
        ann.sign_in("ann@b.co")
        mine = ann.get(f"/structure?username={names['ann']}"
                       "&structure=psoas+major&kind=muscle")[1]
        assert mine["may_write"] is False and mine["history"]["count"] == 1
        assert ann.post("/evaluate-structure",
                        {"username": names["ann"], "structure": "psoas major",
                         "kind": "muscle", "note": "no"})[0] == 403

    def test_somebody_else_s_student_is_refused(self, studio):
        base, names, _ = studio
        self._coach(base, names)
        other = Client(base)
        other.sign_in("other@b.co")
        assert other.get(f"/structure?username={names['ann']}"
                         "&structure=psoas+major&kind=muscle")[0] == 403


class TestGettingBackInOverHttp:
    """Three routes back in, and none of them tell a stranger who trains here."""

    def test_forgot_says_the_same_thing_for_a_real_and_a_made_up_address(
            self, studio):
        base, _, _ = studio
        known = Client(base).post("/auth/forgot", {"email": "ann@b.co"})
        unknown = Client(base).post("/auth/forgot", {"email": "nobody@b.co"})
        assert known == unknown

    def test_with_no_mail_server_it_names_the_other_two_ways(self, studio):
        base, _, _ = studio
        _, payload = Client(base).post("/auth/forgot", {"email": "ann@b.co"})
        assert payload["email_possible"] is False
        assert "recovery codes" in payload["message"]
        assert "admin" in payload["message"]

    def test_a_signup_hands_over_recovery_codes_once(self, studio):
        base, _, _ = studio
        client = Client(base)
        _, welcome = client.post("/auth/signup", {
            "email": "new@b.co", "display_name": "New", "password": PASSWORD,
            "studio": "gangnam", "wants": STUDENT})
        assert len(welcome["recovery_codes"]) == 8
        assert "not this computer" in welcome["recovery_note"]

    def test_a_code_gets_you_a_new_password(self, studio):
        base, _, _ = studio
        client = Client(base)
        _, welcome = client.post("/auth/signup", {
            "email": "new@b.co", "display_name": "New", "password": PASSWORD,
            "studio": "gangnam", "wants": STUDENT})
        code = welcome["recovery_codes"][0]
        status, _ = Client(base).post("/auth/recover", {
            "email": "new@b.co", "code": code, "password": "a whole new one now"})
        assert status == 200
        assert Client(base).sign_in("new@b.co", "a whole new one now")[0] == 200
        assert Client(base).sign_in("new@b.co", PASSWORD)[0] == 401

    def test_a_wrong_code_is_refused_without_saying_which_half_was_wrong(
            self, studio):
        base, _, _ = studio
        status, payload = Client(base).post("/auth/recover", {
            "email": "ann@b.co", "code": "nope-nope", "password": PASSWORD})
        assert status == 400
        assert payload["error"] == "that email and recovery code do not match"

    def test_an_admin_issues_a_link_not_a_password(self, studio):
        base, names, _ = studio
        boss = Client(base)
        boss.sign_in("boss@b.co")
        boss.post("/auth/switch", {"studio": "gangnam", "role": ADMIN})
        status, payload = boss.post("/admin/reset", {"username": names["ann"]})
        assert status == 200 and "reset=" in payload["link"]
        token = payload["link"].split("reset=")[1]
        assert Client(base).post("/auth/reset", {
            "token": token, "password": "handed over in person"})[0] == 200
        assert Client(base).sign_in("ann@b.co", "handed over in person")[0] == 200

    def test_only_an_admin_can_issue_one(self, studio):
        base, names, _ = studio
        coach = Client(base)
        coach.sign_in("coach@b.co")
        assert coach.post("/admin/reset", {"username": names["ann"]})[0] == 403
        ann = Client(base)
        ann.sign_in("ann@b.co")
        assert ann.post("/admin/reset", {"username": names["ben"]})[0] == 403

    def test_resetting_signs_every_open_session_out(self, studio):
        base, names, _ = studio
        ann = Client(base)
        ann.sign_in("ann@b.co")
        assert ann.get("/auth/me")[1]["signed_in"] is True

        boss = Client(base)
        boss.sign_in("boss@b.co")
        boss.post("/auth/switch", {"studio": "gangnam", "role": ADMIN})
        token = boss.post("/admin/reset",
                          {"username": names["ann"]})[1]["link"].split("reset=")[1]
        Client(base).post("/auth/reset", {"token": token,
                                          "password": "somebody had the old one"})
        assert ann.get("/auth/me")[1]["signed_in"] is False

    def test_a_person_can_see_which_ways_back_they_have(self, studio):
        base, _, _ = studio
        client = Client(base)
        client.sign_in("ann@b.co")
        status, payload = client.get("/me/recovery")
        assert status == 200
        assert payload["email"] is False and payload["admin"] is True

    def test_new_codes_can_be_asked_for_and_cancel_the_old(self, studio):
        base, _, _ = studio
        client = Client(base)
        _, welcome = client.post("/auth/signup", {
            "email": "new@b.co", "display_name": "New", "password": PASSWORD,
            "studio": "gangnam", "wants": STUDENT})
        old = welcome["recovery_codes"][0]
        client.sign_in("new@b.co")
        fresh = client.post("/me/recovery-codes")[1]["codes"]
        assert len(fresh) == 8 and old not in fresh
        assert Client(base).post("/auth/recover", {
            "email": "new@b.co", "code": old, "password": PASSWORD})[0] == 400

    def test_signed_out_cannot_ask_for_somebody_else_s_codes(self, studio):
        base, _, _ = studio
        assert Client(base).post("/me/recovery-codes")[0] == 401


class TestSeedingFromTheAdminConsole:
    """Here as well as in the terminal because the deployments most in need of
    it are hosted ones, where there is no terminal to run a command in."""

    def _admin(self, base):
        client = Client(base)
        client.sign_in("boss@b.co")
        client.post("/auth/switch", {"studio": "gangnam", "role": ADMIN})
        return client

    def test_an_admin_can_fill_their_own_studio(self, studio):
        base, _, _ = studio
        admin = self._admin(base)
        status, payload = admin.post("/admin/seed", {"no_classes": True})
        assert status == 200 and payload["people"] == 16
        assert payload["studio"] == "gangnam"
        names = {p["display_name"] for p in admin.get("/admin/people")[1]["people"]}
        assert "Kim Min-ji" in names and "Park Min-seok" in names

    def test_they_land_in_the_studio_the_admin_is_acting_in(self, studio):
        base, _, db = studio
        self._admin(base).post("/admin/seed", {"no_classes": True})
        with Store.open(db) as store:
            held = store.memberships(username="kim_minji_example_com")
            assert {m.studio for m in held} == {"gangnam"}

    def test_nobody_seeded_becomes_an_admin(self, studio):
        base, names, db = studio
        self._admin(base).post("/admin/seed", {"no_classes": True})
        with Store.open(db) as store:
            admins = {m.username for m in
                      store.memberships(studio="gangnam", role=ADMIN)}
        assert admins == {names["boss"]}

    def test_a_coach_cannot_do_it(self, studio):
        base, _, _ = studio
        coach = Client(base)
        coach.sign_in("coach@b.co")
        assert coach.post("/admin/seed", {"no_classes": True})[0] == 403

    def test_a_student_cannot_do_it(self, studio):
        base, _, _ = studio
        ann = Client(base)
        ann.sign_in("ann@b.co")
        assert ann.post("/admin/seed", {"no_classes": True})[0] == 403

    def test_signed_out_cannot_do_it(self, studio):
        base, _, _ = studio
        assert Client(base).post("/admin/seed", {})[0] == 401

    def test_twice_is_refused_unless_asked_for(self, studio):
        base, _, _ = studio
        admin = self._admin(base)
        admin.post("/admin/seed", {"no_classes": True})
        status, payload = admin.post("/admin/seed", {"no_classes": True})
        assert status == 409 and "already" in payload["error"]

    def test_the_coach_roster_works_straight_afterwards(self, studio):
        """The thing that was broken: the fixture existed and the coach could
        not see it."""
        base, _, _ = studio
        self._admin(base).post("/admin/seed", {"no_classes": True})
        park = Client(base)
        park.sign_in("park.minseok@example.com", "seoul-pilates-2026")
        found = park.get("/roster")[1]["students"]
        assert {s["display_name"] for s in found} == {
            "Kim Min-ji", "Lee Joon-ho", "Choi Seo-yeon"}


class TestRunningMoreThanOneLocation:
    """What an owner of two studios needs on day one and could not do."""

    def _admin(self, base):
        client = Client(base)
        client.sign_in("boss@b.co")
        client.post("/auth/switch", {"studio": "gangnam", "role": ADMIN})
        return client

    def test_the_studios_list_counts_who_is_in_each(self, studio):
        base, _, _ = studio
        status, payload = self._admin(base).get("/admin/studios")
        assert status == 200
        gangnam = next(s for s in payload["studios"] if s["key"] == "gangnam")
        # Three students: Ann, Ben, and the owner, who holds a student role at
        # her own studio -- which is the whole point of role-per-membership.
        assert gangnam["students"] == 3 and gangnam["coaches"] >= 2
        assert gangnam["mine"] is True

    def test_making_one_makes_you_its_admin_in_the_same_act(self, studio):
        """A studio nobody can administer is one somebody has to be given by
        hand afterwards, and that step is the one everybody forgets."""
        base, _, _ = studio
        admin = self._admin(base)
        status, out = admin.post("/admin/studio",
                                 {"name": "Songdo Pilates", "city": "Incheon",
                                  "country": "KR"})
        assert status == 200 and out["created"] is True
        assert out["studio"]["key"] == "songdo-pilates"
        assert admin.post("/auth/switch", {"studio": "songdo-pilates",
                                           "role": ADMIN})[0] == 200

    def test_a_name_becomes_a_usable_key(self, studio):
        base, _, _ = studio
        _, out = self._admin(base).post("/admin/studio",
                                        {"name": "Bundang  Yoga & Pilates!"})
        assert out["studio"]["key"] == "bundang-yoga-pilates"

    def test_moving_somebody_to_another_location(self, studio):
        base, names, db = studio
        admin = self._admin(base)
        status, out = admin.post("/admin/move", {"username": names["ann"],
                                                 "role": STUDENT,
                                                 "studio": "hongdae"})
        assert status == 200 and out["studio"] == "hongdae"
        with Store.open(db) as store:
            held = {m.studio for m in store.memberships(username=names["ann"],
                                                        role=STUDENT)}
        assert held == {"gangnam", "hongdae"}

    def test_holding_two_at_once_is_a_real_case_not_an_error(self, studio):
        """A coach who teaches at two sites."""
        base, names, _ = studio
        admin = self._admin(base)
        out = admin.post("/admin/move", {"username": names["coach"],
                                         "role": COACH,
                                         "studio": "hongdae"})[1]
        assert out["left"] == []

    def test_leaving_the_old_one_when_asked(self, studio):
        base, names, db = studio
        admin = self._admin(base)
        out = admin.post("/admin/move", {"username": names["ann"],
                                         "role": STUDENT, "studio": "hongdae",
                                         "leave": True})[1]
        assert out["left"] == ["gangnam"]
        with Store.open(db) as store:
            live = {m.studio for m in store.memberships(username=names["ann"],
                                                        role=STUDENT)
                    if m.state == "active"}
        assert live == {"hongdae"}

    def test_a_studio_that_does_not_exist_is_refused(self, studio):
        base, names, _ = studio
        assert self._admin(base).post(
            "/admin/move", {"username": names["ann"], "role": STUDENT,
                            "studio": "atlantis"})[0] == 404

    def test_giving_one_coach_every_student_at_a_location(self, studio):
        """A studio with one instructor is the common case and should not be
        twenty presses."""
        base, names, _ = studio
        admin = self._admin(base)
        status, out = admin.post("/admin/assign-all",
                                 {"coach": names["coach"], "studio": "gangnam"})
        assert status == 200
        # Everybody holding a student role at that studio, which includes the
        # owner: she trains there too, and pretending otherwise would mean
        # deciding on her behalf which of her roles is the real one.
        assert set(out["added"]) == {names["ann"], names["ben"], names["boss"]}
        coach = Client(base)
        coach.sign_in("coach@b.co")
        assert len(coach.get("/roster")[1]["students"]) == 3

    def test_assigning_all_twice_does_not_duplicate(self, studio):
        base, names, _ = studio
        admin = self._admin(base)
        admin.post("/admin/assign-all", {"coach": names["coach"]})
        again = admin.post("/admin/assign-all", {"coach": names["coach"]})[1]
        assert again["added"] == []

    def test_the_result_reads_in_names_not_database_keys(self, studio):
        """An admin who moves somebody should not be told about
        ``ann_a_co is a student at hongdae``. That is a working feature
        reporting itself in a way that looks broken."""
        base, names, _ = studio
        out = self._admin(base).post("/admin/move",
                                     {"username": names["ann"],
                                      "role": STUDENT,
                                      "studio": "hongdae"})[1]
        assert names["ann"] not in out["message"]
        assert "Ann" in out["message"]
        # And the location by its name, not its key either.
        assert "hongdae" not in out["message"]

    def test_a_location_with_nobody_in_it_says_so(self, studio):
        """Zero students added and zero students there are different facts, and
        a bare ``0`` cannot tell an admin which one happened."""
        base, names, _ = studio
        admin = self._admin(base)
        admin.post("/admin/studio", {"name": "Empty Place"})
        admin.post("/admin/move", {"username": names["coach"], "role": COACH,
                                   "studio": "empty-place"})
        out = admin.post("/admin/assign-all",
                         {"coach": names["coach"], "studio": "empty-place"})[1]
        assert out["added"] == [] and out["students"] == 0
        assert "no students" in out["message"].lower()

    def test_already_having_everybody_is_not_the_same_as_an_empty_studio(
            self, studio):
        base, names, _ = studio
        admin = self._admin(base)
        admin.post("/admin/assign-all",
                   {"coach": names["coach"], "studio": "gangnam"})
        out = admin.post("/admin/assign-all",
                         {"coach": names["coach"], "studio": "gangnam"})[1]
        assert out["added"] == [] and out["students"] > 0
        assert "already has every student" in out["message"]

    def test_only_an_admin_can_do_any_of_it(self, studio):
        base, names, _ = studio
        coach = Client(base)
        coach.sign_in("coach@b.co")
        assert coach.get("/admin/studios")[0] == 403
        assert coach.post("/admin/studio", {"name": "Mine"})[0] == 403
        assert coach.post("/admin/move", {"username": names["ann"],
                                          "studio": "hongdae"})[0] == 403
        assert coach.post("/admin/assign-all", {"coach": names["coach"]})[0] == 403
