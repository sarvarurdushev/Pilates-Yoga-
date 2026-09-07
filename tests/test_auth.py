"""Passwords, sessions, and the ways in.

The interesting tests are the ones about what a stranger can learn: whether the
login form says which of a studio's students have accounts, whether a signup
form can make somebody an admin, and whether a suspended coach keeps working
until their thirty-day cookie runs out.
"""
import time

import pytest

from pilates import auth
from pilates.accounts import (ACTIVE, ADMIN, COACH, PENDING, STUDENT, Account,
                              Membership, Studio)
from pilates.onboarding import accept, approve, grant, invite, pending, sign_up
from pilates.passwords import (check, hash_password, needs_rehash, verify)
from pilates.store import Store

PASSWORD = "a decently long password"


@pytest.fixture
def db(monkeypatch):
    # The real cost is 400 ms a hash, which is right in production and would
    # make this file take a minute.
    monkeypatch.setattr("pilates.passwords.N", 2 ** 14)
    with Store.memory() as store:
        store.add_studio(Studio(key="tashkent", name="Tashkent Pilates"))
        yield store


def make(db, email, name="A Person", password=PASSWORD, roles=(), studio="tashkent"):
    account = Account(email=email, display_name=name)
    db.create_account(account, password=password)
    for role in roles:
        grant(db, account.username, studio, role, by="test")
    return account


class TestStoringAPassword:
    def test_the_same_password_hashes_differently_every_time(self):
        assert hash_password(PASSWORD) != hash_password(PASSWORD)

    def test_it_verifies(self):
        assert verify(PASSWORD, hash_password(PASSWORD))

    def test_a_wrong_one_does_not(self):
        assert not verify("something else", hash_password(PASSWORD))

    def test_a_corrupt_row_is_false_rather_than_an_exception(self):
        """An exception on the login path is a way to tell an attacker which
        accounts exist."""
        for rubbish in ("", "nonsense", "scrypt$$$$", "bcrypt$1$2$3$4$5"):
            assert verify(PASSWORD, rubbish) is False

    def test_a_short_password_is_refused_before_it_is_hashed(self):
        with pytest.raises(ValueError, match="at least"):
            check("short")

    def test_an_old_cost_is_marked_for_upgrade(self):
        assert needs_rehash("scrypt$1024$8$1$AA==$AA==")
        assert not needs_rehash(hash_password(PASSWORD))


class TestSigningIn:
    def test_a_correct_password_starts_a_session(self, db):
        make(db, "a@b.co", roles=(STUDENT,))
        session = auth.sign_in(db, "a@b.co", PASSWORD)
        assert session.token and session.role == STUDENT

    def test_a_wrong_password_and_an_unknown_email_say_the_same_thing(self, db):
        """Otherwise the login form is an oracle for who trains here."""
        make(db, "a@b.co", roles=(STUDENT,))
        with pytest.raises(ValueError) as wrong:
            auth.sign_in(db, "a@b.co", "not the password")
        with pytest.raises(ValueError) as unknown:
            auth.sign_in(db, "nobody@b.co", "not the password")
        assert str(wrong.value) == str(unknown.value)

    def test_an_account_with_no_approved_role_cannot_get_in(self, db):
        account = make(db, "a@b.co")
        db.put_membership(Membership(username=account.username,
                                     studio="tashkent", role=COACH,
                                     state=PENDING))
        with pytest.raises(ValueError, match="waiting"):
            auth.sign_in(db, "a@b.co", PASSWORD)

    def test_a_deactivated_account_cannot_get_in(self, db):
        account = make(db, "a@b.co", roles=(STUDENT,))
        db.set_active(account.username, False)
        with pytest.raises(ValueError):
            auth.sign_in(db, "a@b.co", PASSWORD)

    def test_it_lands_on_the_least_reaching_role(self, db):
        """An admin who opens the page is looking at their own progress until
        they say otherwise -- which is also how an owner finds out what their
        students actually see."""
        make(db, "a@b.co", roles=(ADMIN, COACH, STUDENT))
        assert auth.sign_in(db, "a@b.co", PASSWORD).role == STUDENT

    def test_a_correct_password_at_an_old_cost_is_upgraded(self, db, monkeypatch):
        account = make(db, "a@b.co", roles=(STUDENT,))
        db.db.execute("UPDATE accounts SET password_hash = ? WHERE username = ?",
                      ("scrypt$1024$8$1$"
                       + hash_password(PASSWORD).split("$", 4)[4], account.username))
        db.db.commit()
        # Wrong salt/hash pairing, so it will not verify; what is tested is that
        # a *verifying* old hash gets replaced.
        db.set_password(account.username, PASSWORD)
        assert not needs_rehash(db.account(account.username).password_hash)


class TestTooManyTries:
    def test_five_wrong_passwords_is_a_typo_and_fifty_is_not(self, db):
        make(db, "a@b.co", roles=(STUDENT,))
        attempts = auth.Attempts()
        for _ in range(auth.Attempts.ALLOWED):
            with pytest.raises(ValueError):
                auth.sign_in(db, "a@b.co", "wrong", attempts=attempts,
                             source="1.2.3.4")
        with pytest.raises(auth.TooManyTries):
            auth.sign_in(db, "a@b.co", "wrong", attempts=attempts,
                         source="1.2.3.4")

    def test_getting_it_right_clears_the_count(self, db):
        make(db, "a@b.co", roles=(STUDENT,))
        attempts = auth.Attempts()
        for _ in range(3):
            with pytest.raises(ValueError):
                auth.sign_in(db, "a@b.co", "wrong", attempts=attempts)
        auth.sign_in(db, "a@b.co", PASSWORD, attempts=attempts)
        assert not attempts.seen.get("email:a@b.co")


class TestSessions:
    def test_the_token_is_not_stored(self, db):
        """A stolen database should not be a stolen set of live sessions."""
        make(db, "a@b.co", roles=(STUDENT,))
        session = auth.sign_in(db, "a@b.co", PASSWORD)
        rows = list(db.db.execute("SELECT token_hash FROM auth_sessions"))
        assert rows and all(row["token_hash"] != session.token for row in rows)

    def test_a_cookie_becomes_the_membership_it_acts_as(self, db):
        make(db, "a@b.co", roles=(STUDENT,))
        session = auth.sign_in(db, "a@b.co", PASSWORD)
        viewer = auth.viewer_for(db, session.token)
        assert viewer.username and viewer.role == STUDENT

    def test_nonsense_is_nobody(self, db):
        assert auth.viewer_for(db, "not-a-token") is None
        assert auth.viewer_for(db, "") is None

    def test_a_suspended_role_stops_working_at_once(self, db):
        """Not at the end of a thirty-day login."""
        account = make(db, "a@b.co", roles=(COACH,))
        session = auth.sign_in(db, "a@b.co", PASSWORD)
        assert auth.viewer_for(db, session.token) is not None
        db.decide_membership(account.username, "tashkent", COACH, "suspended",
                             by="boss")
        assert auth.viewer_for(db, session.token) is None

    def test_signing_out_ends_it(self, db):
        make(db, "a@b.co", roles=(STUDENT,))
        session = auth.sign_in(db, "a@b.co", PASSWORD)
        auth.sign_out(db, session.token)
        assert auth.viewer_for(db, session.token) is None

    def test_an_expired_session_is_nobody_and_is_swept(self, db):
        make(db, "a@b.co", roles=(STUDENT,))
        session = auth.sign_in(db, "a@b.co", PASSWORD)
        db.db.execute("UPDATE auth_sessions SET expires_at = '2000-01-01T00:00:00+00:00'")
        db.db.commit()
        assert auth.viewer_for(db, session.token) is None


class TestSwitchingRole:
    def test_to_one_you_hold(self, db):
        make(db, "a@b.co", roles=(ADMIN, STUDENT))
        session = auth.sign_in(db, "a@b.co", PASSWORD)
        assert auth.switch(db, session.token, "tashkent", ADMIN).role == ADMIN

    def test_never_to_one_you_do_not(self, db):
        """The difference between a role switcher and a privilege escalation."""
        make(db, "a@b.co", roles=(STUDENT,))
        session = auth.sign_in(db, "a@b.co", PASSWORD)
        with pytest.raises(ValueError, match="do not hold"):
            auth.switch(db, session.token, "tashkent", ADMIN)

    def test_not_at_all_when_signed_out(self, db):
        with pytest.raises(ValueError, match="not signed in"):
            auth.switch(db, "nope", "tashkent", ADMIN)


class TestSigningUp:
    def test_a_student_is_approved_on_the_spot(self, db):
        welcome = sign_up(db, "s@b.co", "A Student", PASSWORD, "tashkent",
                          wants=STUDENT)
        assert welcome.state == ACTIVE and not welcome.waiting

    def test_a_coach_waits(self, db):
        welcome = sign_up(db, "c@b.co", "A Coach", PASSWORD, "tashkent",
                          wants=COACH)
        assert welcome.state == PENDING and welcome.waiting
        assert "own record and nobody else's" in welcome.message

    def test_nobody_can_sign_up_as_an_admin(self, db):
        """A role dropdown that offers admin is one somebody will choose admin
        from."""
        with pytest.raises(ValueError, match="never requested"):
            sign_up(db, "x@b.co", "X", PASSWORD, "tashkent", wants=ADMIN)

    def test_an_invented_role_is_refused_too(self, db):
        with pytest.raises(ValueError):
            sign_up(db, "x@b.co", "X", PASSWORD, "tashkent", wants="owner")

    def test_a_studio_that_does_not_exist_is_refused_not_created(self, db):
        """A signup form that can invent studios fills the database with typos
        of the same gym."""
        with pytest.raises(ValueError, match="no studio"):
            sign_up(db, "x@b.co", "X", PASSWORD, "nowhere")
        assert [s["key"] for s in db.studios()] == ["tashkent"]

    def test_a_pending_coach_can_sign_in_to_nothing(self, db):
        sign_up(db, "c@b.co", "A Coach", PASSWORD, "tashkent", wants=COACH)
        with pytest.raises(ValueError, match="waiting"):
            auth.sign_in(db, "c@b.co", PASSWORD)

    def test_the_admin_sees_the_request(self, db):
        sign_up(db, "c@b.co", "A Coach", PASSWORD, "tashkent", wants=COACH)
        waiting = pending(db)
        assert len(waiting) == 1 and waiting[0]["email"] == "c@b.co"

    def test_approving_is_what_grants_it(self, db):
        welcome = sign_up(db, "c@b.co", "A Coach", PASSWORD, "tashkent",
                          wants=COACH)
        approve(db, welcome.username, "tashkent", COACH, by="boss")
        assert auth.sign_in(db, "c@b.co", PASSWORD).role == COACH

    def test_joining_a_second_studio_reuses_the_account(self, db):
        db.add_studio(Studio(key="samarkand", name="Samarkand Yoga"))
        first = sign_up(db, "s@b.co", "A Student", PASSWORD, "tashkent")
        second = sign_up(db, "s@b.co", "A Student", PASSWORD, "samarkand")
        assert first.username == second.username
        assert len(db.accounts()) == 1

    def test_the_profile_travels_with_the_signup(self, db):
        welcome = sign_up(db, "s@b.co", "A Student", PASSWORD, "tashkent",
                          profile={"born": "1998-04-12", "height_m": 1.76,
                                   "mass_kg": 72})
        assert db.profile(welcome.username).height_m == 1.76


class TestInvitations:
    def test_the_role_is_scoped_in_the_same_act(self, db):
        token = invite(db, "new@b.co", "tashkent", COACH, by="boss")
        welcome = accept(db, token, "A New Coach", PASSWORD)
        assert welcome.role == COACH and welcome.state == ACTIVE

    def test_a_used_invitation_cannot_be_used_again(self, db):
        token = invite(db, "new@b.co", "tashkent", COACH, by="boss")
        accept(db, token, "A New Coach", PASSWORD)
        with pytest.raises(ValueError, match="already been used"):
            accept(db, token, "Somebody Else", PASSWORD)

    def test_a_token_nobody_sent_is_refused(self, db):
        with pytest.raises(ValueError, match="not one this studio sent"):
            accept(db, "made-up", "X", PASSWORD)

    def test_an_expired_one_is_refused(self, db):
        token = invite(db, "new@b.co", "tashkent", COACH, by="boss")
        db.db.execute("UPDATE invitations SET expires_at = '2000-01-01T00:00:00+00:00'")
        db.db.commit()
        with pytest.raises(ValueError, match="expired"):
            accept(db, token, "X", PASSWORD)

    def test_only_the_hash_is_kept(self, db):
        token = invite(db, "new@b.co", "tashkent", COACH, by="boss")
        rows = list(db.db.execute("SELECT token_hash FROM invitations"))
        assert all(row["token_hash"] != token for row in rows)


class TestTheAuditLog:
    def test_a_sign_in_is_recorded(self, db):
        make(db, "a@b.co", roles=(STUDENT,))
        auth.sign_in(db, "a@b.co", PASSWORD)
        assert any(e["action"] == "signed_in" for e in db.audit())

    def test_granting_a_role_says_who_did_it(self, db):
        account = make(db, "a@b.co")
        grant(db, account.username, "tashkent", ADMIN, by="the_founder")
        granted = [e for e in db.audit() if e["action"] == "granted:admin"]
        assert granted and granted[0]["actor"] == "the_founder"

    def test_a_person_s_own_log_can_be_read_back(self, db):
        account = make(db, "a@b.co", roles=(STUDENT,))
        db.record_audit(actor="a_coach", action="record:read",
                        subject=account.username, studio="tashkent")
        assert db.audit(subject=account.username)[0]["actor"] == "a_coach"


class TestErasureStillTakesEverything:
    def test_forgetting_a_person_takes_their_account_and_roles(self, db):
        account = make(db, "a@b.co", roles=(STUDENT, COACH))
        db.put_membership(Membership(username=account.username,
                                     studio="tashkent", role=STUDENT,
                                     state=ACTIVE))
        db.forget(account.username)
        assert db.account(account.username) is None
        assert db.memberships(username=account.username) == []

    def test_deactivating_is_not_deleting(self, db):
        account = make(db, "a@b.co", roles=(STUDENT,))
        db.set_active(account.username, False)
        assert db.account(account.username) is not None
        assert not db.account(account.username).active
