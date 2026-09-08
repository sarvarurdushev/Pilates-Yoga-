"""The one person who owns the deployment, and why they are not a special case.

An admin is an admin *of a studio*. That is the right shape for everything
except the person who owns the place: add a second location and it produces a
room its own owner cannot enter, and the only person who could grant them
access is them.

So an owner is named once, and from then on holds an active admin, coach and
student membership at every studio -- including any created afterwards. What
they do *not* have is a bypass: every permission check still reads memberships,
so there is exactly one way to be allowed to do something and the owner goes
through it like everybody else. These tests hold both halves.
"""
from __future__ import annotations

import pytest

from pilates.accounts import ACTIVE, ADMIN, COACH, STUDENT, Account, Studio
from pilates.serve import claim_owner
from pilates.store import Store

PASSWORD = "a-long-enough-password"


@pytest.fixture
def db(tmp_path):
    return str(tmp_path / "studio.db")


def owner_of(db, email="sarvarurdushev@gmail.com", studio="songdo"):
    with Store.open(db) as store:
        return store.claim_first_admin(
            Account(email=email, display_name="Sarvar"), PASSWORD,
            Studio(key=studio, name=studio.title()))


def roles(store, username, studio):
    return sorted(m.role for m in store.memberships(username=username, studio=studio)
                  if m.state == ACTIVE)


class TestNamingAnOwner:
    def test_whoever_sets_the_deployment_up_owns_it(self, db):
        who = owner_of(db)
        with Store.open(db) as store:
            assert store.owner() == who

    def test_a_fresh_database_has_no_owner(self, db):
        with Store.open(db) as store:
            assert store.owner() == ""

    def test_the_owner_holds_all_three_roles_where_they_started(self, db):
        who = owner_of(db)
        with Store.open(db) as store:
            assert roles(store, who, "songdo") == [ADMIN, COACH, STUDENT]


class TestALocationAddedLater:
    def test_seats_the_owner_when_it_is_created(self, db):
        """The gap this whole thing exists to close."""
        who = owner_of(db)
        with Store.open(db) as store:
            store.add_studio(Studio(key="gangnam", name="Gangnam"))
            assert roles(store, who, "gangnam") == [ADMIN, COACH, STUDENT]

    def test_and_every_one_after_that(self, db):
        who = owner_of(db)
        with Store.open(db) as store:
            for key in ("gangnam", "hongdae", "itaewon"):
                store.add_studio(Studio(key=key, name=key.title()))
            for key in ("songdo", "gangnam", "hongdae", "itaewon"):
                assert roles(store, who, key) == [ADMIN, COACH, STUDENT], key

    def test_a_restart_re_seats_a_studio_made_out_of_band(self, db):
        """A studio written straight into the file, with no owner to seat.

        This is what a restore from backup, a migration or a hand-edited
        database looks like, and the owner must not have to notice."""
        who = owner_of(db)
        with Store.open(db) as store:
            store.db.execute(
                "INSERT INTO studios (key, name, timezone) VALUES (?, ?, 'UTC')",
                ("busan", "Busan"))
            store.db.commit()
            assert roles(store, who, "busan") == []
        assert claim_owner(db) == who
        with Store.open(db) as store:
            assert roles(store, who, "busan") == [ADMIN, COACH, STUDENT]


class TestClaimingByAddress:
    def test_an_address_with_an_account_becomes_the_owner(self, db):
        owner_of(db, email="first@example.com")
        with Store.open(db) as store:
            store.create_account(
                Account(email="sarvarurdushev@gmail.com", display_name="Sarvar"),
                password=PASSWORD)
        claimed = claim_owner(db, "sarvarurdushev@gmail.com")
        with Store.open(db) as store:
            assert store.owner() == claimed
            assert roles(store, claimed, "songdo") == [ADMIN, COACH, STUDENT]

    def test_the_address_is_normalised(self, db):
        owner_of(db, email="first@example.com")
        with Store.open(db) as store:
            store.create_account(
                Account(email="sarvarurdushev@gmail.com", display_name="S"),
                password=PASSWORD)
        assert claim_owner(db, "  SarvarUrdushev@Gmail.COM ") != ""

    def test_an_address_with_no_account_changes_nothing(self, db):
        """The ordinary state of a deployment whose owner has not signed up.
        It must not be an error and it must not unseat whoever is there."""
        who = owner_of(db)
        assert claim_owner(db, "nobody@example.com") == ""
        with Store.open(db) as store:
            assert store.owner() == who

    def test_no_database_is_not_a_crash(self):
        assert claim_owner("") == ""


class TestItIsNotABypass:
    def test_the_owner_is_allowed_by_membership_like_everybody_else(self, db):
        """The property that keeps one permission model instead of two: strip
        the memberships and the owner can do nothing, because nothing anywhere
        asks "are you the owner?" -- it asks what they hold."""
        who = owner_of(db)
        with Store.open(db) as store:
            store.db.execute("DELETE FROM memberships WHERE username = ?", (who,))
            store.db.commit()
            assert roles(store, who, "songdo") == []
            assert store.owner() == who, "still named, and still powerless"

    def test_seating_is_idempotent(self, db):
        who = owner_of(db)
        with Store.open(db) as store:
            for _ in range(3):
                store.seat_owner("songdo")
            assert roles(store, who, "songdo") == [ADMIN, COACH, STUDENT]
            held = [m for m in store.memberships(username=who, studio="songdo")]
            assert len(held) == 3, "seating twice must not duplicate a membership"

    def test_nobody_else_is_seated_anywhere(self, db):
        owner_of(db)
        with Store.open(db) as store:
            store.create_account(Account(email="student@example.com",
                                         display_name="A Student"),
                                 password=PASSWORD)
            store.add_studio(Studio(key="gangnam", name="Gangnam"))
            assert roles(store, "student_example_com", "gangnam") == []
