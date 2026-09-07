"""The fixture, and the promises it has to keep.

A test fixture that can be mistaken for real data is worse than no fixture, and
one that cannot reach a real person by accident is the only kind worth shipping
with a mail server in the box. So most of what is checked here is not that the
studio fills up -- it is that nothing in it points at anybody who exists, and
that the states somebody needs to click through are actually present.
"""
import pytest

from pilates import seed
from pilates.accounts import ACTIVE, ADMIN, COACH, PENDING, STUDENT
from pilates.store import Store


@pytest.fixture
def sown(monkeypatch):
    monkeypatch.setattr("pilates.passwords.N", 2 ** 14)
    with Store.memory() as store:
        made = seed.sow(store, classes=False)
        store.made = made
        yield store


class TestNothingHereReachesAnybody:
    def test_every_address_is_at_the_reserved_domain(self, sown):
        """RFC 2606 keeps example.com unroutable. A deployment with a mail
        server configured must not be able to send a verification email to a
        real person because a fixture invented their address."""
        assert seed.DOMAIN == "example.com"
        for account in sown.accounts():
            assert account.email.endswith("@example.com")

    def test_every_phone_number_is_in_an_unissued_range(self, sown):
        """Korean mobiles are 010-XXXX-YYYY. Carriers do not issue the
        010-0000-YYYY block, so nothing here dials a stranger."""
        for account in sown.accounts():
            assert account.phone.startswith("+82100000")
            assert len(account.phone) == len("+821000000000")

    def test_every_person_carries_a_marker_in_their_record(self, sown):
        for person in sown.people():
            assert "does not exist" in person["notes"]

    def test_the_emergency_contact_is_not_a_number_either(self, sown):
        for account in sown.accounts():
            profile = sown.profile(account.username)
            assert profile.emergency_phone.startswith("+82100000")


class TestTheStatesSomebodyNeedsToSee:
    def test_three_studios_in_two_cities(self, sown):
        studios = {s["key"]: s for s in sown.studios()}
        assert set(studios) == {"gangnam", "hongdae", "haeundae"}
        assert {s["city"] for s in studios.values()} == {"Seoul", "Busan"}
        assert all(s["country"] == "KR" for s in studios.values())
        assert all(s["timezone"] == "Asia/Seoul" for s in studios.values())

    def test_somebody_holds_three_roles_at_one_studio(self, sown):
        """The case a role column on the account would have made impossible,
        and the first thing anybody testing this should click."""
        held = sown.memberships(username="seo_jiwoo_example_com",
                                studio="gangnam")
        assert {m.role for m in held} == {ADMIN, COACH, STUDENT}

    def test_somebody_coaches_at_one_studio_and_trains_at_another(self, sown):
        held = {(m.studio, m.role) for m in
                sown.memberships(username="yoon_chaewon_example_com")}
        assert held == {("gangnam", COACH), ("hongdae", STUDENT)}

    def test_a_coach_is_waiting_to_be_approved(self, sown):
        """Otherwise the admin's inbox is empty and nobody ever sees what
        approving looks like."""
        waiting = sown.memberships(state=PENDING)
        assert [m.username for m in waiting] == ["kang_taeyang_example_com"]
        assert waiting[0].role == COACH

    def test_a_student_has_never_been_screened(self, sown):
        """The red row at the top of the coach's roster."""
        assert sown.screening("choi_seoyeon_example_com") is None

    def test_a_student_has_a_flag_that_needs_a_doctor(self, sown):
        screening = sown.screening("han_doyun_example_com")
        assert screening.needs_clearance
        assert "needs a doctor's clearance" in screening.flags()

    def test_a_student_has_a_flag_that_a_doctor_has_cleared(self, sown):
        screening = sown.screening("kim_minji_example_com")
        assert not screening.needs_clearance
        assert any("knee" in flag for flag in screening.flags())

    def test_a_flag_never_carries_the_written_history(self, sown):
        """Same rule as everywhere else: the coach sees that there is a knee,
        not the notes behind it."""
        screening = sown.screening("kim_minji_example_com")
        printed = " ".join(screening.flags()).lower()
        assert "seeded" not in printed and "history" not in printed

    def test_an_assignment_is_still_waiting_on_the_student(self, sown):
        """So that signing in as them shows the consent prompt straight away."""
        asked = [a for a in sown.assignments(student="oh_seah_example_com")]
        assert asked and asked[0].state == PENDING and not asked[0].live

    def test_the_live_assignments_are_live(self, sown):
        live = [a for a in sown.assignments(coach="park_minseok_example_com")
                if a.live]
        assert {a.student for a in live} == {
            "kim_minji_example_com", "lee_joonho_example_com",
            "choi_seoyeon_example_com"}

    def test_a_coach_s_students_are_at_the_studio_they_coach_at(self, sown):
        """Yoon coaches at Gangnam and trains at Hongdae; taking her first
        membership would have filed her students in the wrong city."""
        for assignment in sown.assignments(coach="yoon_chaewon_example_com"):
            assert assignment.studio == "gangnam"

    def test_there_is_an_overdue_goal(self, sown):
        from pilates.accounts import today

        sheet = sown.coach_sheet("kim_minji_example_com")
        assert sheet.due(on=today())

    def test_the_notes_read_like_a_coach_wrote_them(self, sown):
        kinds = {n.kind for n in sown.observations("kim_minji_example_com")}
        assert {"contraindication", "cue", "goal"} <= kinds


class TestItRefusesToPollute:
    def test_it_knows_when_it_has_already_been_run(self, sown):
        assert seed.already_seeded(sown)

    def test_a_database_of_real_people_is_not_seeded(self):
        assert not seed.already_seeded(Store.memory())


class TestTheClasses:
    def test_measurements_are_recorded_under_each_person(self, monkeypatch):
        monkeypatch.setattr("pilates.passwords.N", 2 ** 14)
        with Store.memory() as store:
            seed.sow(store, classes=True)
            keys = {r["key"] for r in store.recordings()}
            assert any(k.startswith("kim.minji-") for k in keys)
            mine = [r for r in store.recordings()
                    if r["username"] == "kim_minji_example_com"]
            assert len(mine) == 12

    def test_two_students_never_share_a_session_key(self, monkeypatch):
        """A repeated key does not fail -- it appends, and two students under
        one key become one student with twice the measurements."""
        monkeypatch.setattr("pilates.passwords.N", 2 ** 14)
        with Store.memory() as store:
            seed.sow(store, classes=True)
            rows = store.recordings()
            assert len({r["key"] for r in rows}) == len(rows)

    def test_a_history_is_long_enough_to_have_a_verdict(self, monkeypatch):
        from pilates.bundle import build

        monkeypatch.setattr("pilates.passwords.N", 2 ** 14)
        with Store.memory() as store:
            seed.sow(store, classes=True)
            newest = next(r for r in store.recordings()
                          if r["username"] == "kim_minji_example_com")
            bundle = build(store, "kim_minji_example_com", newest["key"],
                           include_poses=False)
            assert max(h["sessions"] for h in bundle["history"].values()) == 12
