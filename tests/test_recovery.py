"""Getting back in, by three routes that all end in the same place.

A studio locked out of its own record starts a new one, and this project's
whole value is that the record is long. So the tests here are about the three
paths staying independent -- codes work with no email server and no admin, an
admin's link works with no email server, and email works where there is one --
and about what a stranger can learn by trying them.
"""
import pytest

from pilates import auth, mail, recovery
from pilates.accounts import ADMIN, STUDENT, Account, Studio
from pilates.onboarding import grant
from pilates.store import Store

PASSWORD = "a decently long password"
NEW = "an entirely different password"


@pytest.fixture
def db(monkeypatch):
    monkeypatch.setattr("pilates.passwords.N", 2 ** 14)
    monkeypatch.delenv("PILATES_SMTP_URL", raising=False)
    with Store.memory() as store:
        store.add_studio(Studio(key="tashkent", name="Tashkent Pilates"))
        account = Account(email="ann@b.co", display_name="Ann")
        store.create_account(account, password=PASSWORD)
        grant(store, account.username, "tashkent", STUDENT, by="test")
        boss = Account(email="boss@b.co", display_name="The Owner")
        store.create_account(boss, password=PASSWORD)
        grant(store, boss.username, "tashkent", ADMIN, by="test")
        store.ann = account.username
        store.boss = boss.username
        yield store


class TestRecoveryCodes:
    """The path that needs no email server and no admin: paper in a drawer."""

    def test_a_set_is_issued_and_counted(self, db):
        codes = recovery.issue_codes(db, db.ann)
        assert len(codes) == recovery.CODES
        assert recovery.codes_left(db, db.ann) == recovery.CODES

    def test_they_are_not_stored_in_the_clear(self, db):
        codes = recovery.issue_codes(db, db.ann)
        rows = [r["code_hash"] for r in
                db.db.execute("SELECT code_hash FROM recovery_codes")]
        assert all(code not in rows for code in codes)

    def test_one_gets_you_a_reset(self, db):
        codes = recovery.issue_codes(db, db.ann)
        token = recovery.spend_code(db, "ann@b.co", codes[0])
        recovery.redeem(db, token, NEW)
        assert auth.sign_in(db, "ann@b.co", NEW).role == STUDENT

    def test_the_old_password_stops_working(self, db):
        codes = recovery.issue_codes(db, db.ann)
        recovery.redeem(db, recovery.spend_code(db, "ann@b.co", codes[0]), NEW)
        with pytest.raises(ValueError):
            auth.sign_in(db, "ann@b.co", PASSWORD)

    def test_a_code_is_spent_once(self, db):
        codes = recovery.issue_codes(db, db.ann)
        recovery.spend_code(db, "ann@b.co", codes[0])
        with pytest.raises(ValueError):
            recovery.spend_code(db, "ann@b.co", codes[0])
        assert recovery.codes_left(db, db.ann) == recovery.CODES - 1

    def test_somebody_else_s_code_is_no_use(self, db):
        mine = recovery.issue_codes(db, db.ann)
        recovery.issue_codes(db, db.boss)
        with pytest.raises(ValueError):
            recovery.spend_code(db, "boss@b.co", mine[0])

    def test_an_unknown_address_and_a_wrong_code_say_the_same_thing(self, db):
        """Anything else tells a stranger which of a studio's students have
        accounts, and those are the people this holds health data about."""
        codes = recovery.issue_codes(db, db.ann)
        with pytest.raises(ValueError) as wrong:
            recovery.spend_code(db, "ann@b.co", "nope-nope")
        with pytest.raises(ValueError) as unknown:
            recovery.spend_code(db, "nobody@b.co", codes[0])
        assert str(wrong.value) == str(unknown.value)

    def test_generating_a_new_set_cancels_the_old_one(self, db):
        """"Generate new codes" means the old list is lost or compromised, and
        leaving it live would make that sentence untrue."""
        old = recovery.issue_codes(db, db.ann)
        recovery.issue_codes(db, db.ann)
        with pytest.raises(ValueError):
            recovery.spend_code(db, "ann@b.co", old[0])

    def test_case_and_spacing_do_not_stop_a_code_working(self, db):
        codes = recovery.issue_codes(db, db.ann)
        assert recovery.spend_code(db, "ANN@b.co ", f"  {codes[0].upper()} ")


class TestAdminIssuedReset:
    """One admin, one link, handed over in person."""

    def test_the_admin_gets_a_link_and_not_a_password(self, db):
        """An admin who sets a password knows it, and then the student's record
        has two people who can open it and only one who should."""
        token = recovery.issue_token(db, db.ann, recovery.RESET, by=db.boss)
        recovery.redeem(db, token, NEW)
        assert auth.sign_in(db, "ann@b.co", NEW).role == STUDENT

    def test_the_link_is_not_stored(self, db):
        token = recovery.issue_token(db, db.ann, recovery.RESET, by=db.boss)
        rows = [r["token_hash"] for r in
                db.db.execute("SELECT token_hash FROM tokens")]
        assert token not in rows

    def test_it_works_once(self, db):
        token = recovery.issue_token(db, db.ann, recovery.RESET, by=db.boss)
        recovery.redeem(db, token, NEW)
        with pytest.raises(ValueError, match="already been used"):
            recovery.redeem(db, token, "a third password entirely")

    def test_issuing_another_cancels_the_first(self, db):
        """Otherwise "re-send it" leaves a second working key in the world."""
        first = recovery.issue_token(db, db.ann, recovery.RESET, by=db.boss)
        recovery.issue_token(db, db.ann, recovery.RESET, by=db.boss)
        with pytest.raises(ValueError, match="not one this studio sent"):
            recovery.redeem(db, first, NEW)

    def test_an_expired_link_is_refused(self, db):
        token = recovery.issue_token(db, db.ann, recovery.RESET, by=db.boss)
        db.db.execute("UPDATE tokens SET expires_at = '2000-01-01T00:00:00+00:00'")
        db.db.commit()
        with pytest.raises(ValueError, match="expired"):
            recovery.redeem(db, token, NEW)

    def test_a_made_up_link_is_refused(self, db):
        with pytest.raises(ValueError, match="not one this studio sent"):
            recovery.redeem(db, "invented", NEW)

    def test_the_audit_log_says_who_issued_it(self, db):
        token = recovery.issue_token(db, db.ann, recovery.RESET, by=db.boss)
        recovery.redeem(db, token, NEW)
        done = [e for e in db.audit(subject=db.ann)
                if e["action"] == "password:reset"]
        assert done and db.boss in done[0]["detail"]


class TestResettingSignsEverybodyOut:
    def test_every_open_session_ends(self, db):
        """A password is reset most often because somebody believes somebody
        else has it. Leaving that person's session alive answers the wrong half
        of the problem."""
        first = auth.sign_in(db, "ann@b.co", PASSWORD)
        second = auth.sign_in(db, "ann@b.co", PASSWORD)
        assert auth.viewer_for(db, first.token) is not None
        recovery.redeem(db, recovery.issue_token(db, db.ann, recovery.RESET,
                                                 by=db.boss), NEW)
        assert auth.viewer_for(db, first.token) is None
        assert auth.viewer_for(db, second.token) is None

    def test_only_that_account_s_sessions(self, db):
        theirs = auth.sign_in(db, "boss@b.co", PASSWORD)
        recovery.redeem(db, recovery.issue_token(db, db.ann, recovery.RESET,
                                                 by=db.boss), NEW)
        assert auth.viewer_for(db, theirs.token) is not None


class TestEmailVerification:
    def test_an_account_starts_unverified(self, db):
        assert not db.db.execute(
            "SELECT verified_at FROM accounts WHERE username = ?",
            (db.ann,)).fetchone()["verified_at"]

    def test_a_link_confirms_it(self, db):
        token = recovery.issue_token(db, db.ann, recovery.VERIFY, by="signup")
        recovery.confirm_email(db, token)
        assert db.db.execute(
            "SELECT verified_at FROM accounts WHERE username = ?",
            (db.ann,)).fetchone()["verified_at"]

    def test_a_reset_link_is_not_a_verification_link(self, db):
        """Two purposes, two namespaces. One token that does both is one token
        that does the wrong one."""
        token = recovery.issue_token(db, db.ann, recovery.RESET, by="x")
        with pytest.raises(ValueError, match="not one this studio sent"):
            recovery.confirm_email(db, token)

    def test_an_invented_purpose_is_refused(self, db):
        with pytest.raises(ValueError, match="not a kind of link"):
            recovery.issue_token(db, db.ann, "something_else")


class TestTheMailConfiguration:
    def test_nothing_configured_means_nothing_is_available(self, monkeypatch):
        monkeypatch.delenv("PILATES_SMTP_URL", raising=False)
        assert mail.available() is False

    def test_a_tls_url_is_accepted(self, monkeypatch):
        monkeypatch.setenv("PILATES_SMTP_URL",
                           "smtps://studio%40gmail.com:secret@smtp.gmail.com:465")
        assert mail.available() is True
        assert mail.sender() == "studio@gmail.com"

    def test_plain_smtp_to_the_internet_is_refused(self, monkeypatch):
        """A reset link crossing the internet in clear text is worse than no
        reset link."""
        monkeypatch.setenv("PILATES_SMTP_URL", "smtp://smtp.example.com:25")
        assert mail.available() is False

    def test_plain_smtp_to_localhost_is_allowed(self, monkeypatch):
        monkeypatch.setenv("PILATES_SMTP_URL", "smtp://localhost:1025")
        assert mail.available() is True

    def test_an_unknown_scheme_is_refused(self, monkeypatch):
        monkeypatch.setenv("PILATES_SMTP_URL", "https://mail.example.com")
        assert mail.available() is False

    def test_sending_without_configuration_says_so(self, monkeypatch):
        monkeypatch.delenv("PILATES_SMTP_URL", raising=False)
        with pytest.raises(mail.Undeliverable, match="no mail server"):
            mail.send("a@b.co", "subject", "body")

    def test_the_from_address_can_be_named(self, monkeypatch):
        monkeypatch.setenv("PILATES_SMTP_URL", "smtps://u:p@smtp.example.com")
        monkeypatch.setenv("PILATES_MAIL_FROM", "Studio <hello@studio.test>")
        assert mail.sender() == "Studio <hello@studio.test>"
