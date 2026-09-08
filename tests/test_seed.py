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
        made = seed.sow(store, classes=False, everything=False)
        store.made = made
        yield store


@pytest.fixture(scope="module")
def full():
    """The whole thing: every structure, everybody, twenty classes.

    Module-scoped because it writes a hundred thousand rows and the point of
    the tests below is that doing so is fast and stays answerable.
    """
    import pilates.passwords as passwords

    was, passwords.N = passwords.N, 2 ** 14
    try:
        store = Store.memory()
        store.made = seed.sow(store, classes=False)
        yield store
        store.close()
    finally:
        passwords.N = was


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

    def test_somebody_is_left_for_the_coach_to_add(self, sown):
        """Oh Se-ah is on nobody's roster on purpose, so there is somebody in
        the directory to practise Add on."""
        assert sown.assignments(student="oh_seah_example_com") == []

    def test_every_assignment_that_exists_is_live(self, sown):
        """Adding is immediate; there is no half-made assignment any more."""
        assert all(a.live for a in sown.assignments())

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


class TestSeedingIntoAStudioThatAlreadyExists:
    """The case somebody actually hit: they set their own studio up through
    the page, then seeded, and the fictional people landed in three studios
    they were not a member of. From where they were sitting the fixture had
    simply not worked."""

    @pytest.fixture
    def mine(self, monkeypatch):
        from pilates.accounts import Account, Studio
        from pilates.onboarding import grant

        monkeypatch.setattr("pilates.passwords.N", 2 ** 14)
        with Store.memory() as store:
            store.add_studio(Studio(key="songdo", name="Songdo Pilates",
                                    city="Incheon", country="KR"))
            owner = Account(email="me@real.test", display_name="The Owner")
            store.create_account(owner, password="a decently long password")
            for role in (ADMIN, COACH, STUDENT):
                grant(store, owner.username, "songdo", role, by="setup")
            yield store

    def test_everybody_lands_in_the_named_studio(self, mine):
        seed.sow(mine, classes=False, into="songdo")
        for account in mine.accounts():
            if not account.email.endswith(seed.DOMAIN):
                continue
            held = mine.memberships(username=account.username)
            assert held and {m.studio for m in held} == {"songdo"}

    def test_no_new_studios_are_invented(self, mine):
        seed.sow(mine, classes=False, into="songdo")
        assert [s["key"] for s in mine.studios()] == ["songdo"]

    def test_nobody_seeded_becomes_an_admin_of_it(self, mine):
        """A fixture poured into somewhere real must not hand a fictional
        person the ability to read every health record in the building."""
        seed.sow(mine, classes=False, into="songdo")
        admins = {m.username for m in
                  mine.memberships(studio="songdo", role=ADMIN)}
        assert not any(u.endswith("_test") is False and "example_com" in u
                       for u in admins)
        assert admins == {"me_real_test"}

    def test_the_person_who_was_an_admin_is_still_two_roles(self, mine):
        """The switcher still has something to demonstrate."""
        seed.sow(mine, classes=False, into="songdo")
        held = {m.role for m in
                mine.memberships(username="seo_jiwoo_example_com")}
        assert held == {COACH, STUDENT}

    def test_the_assignments_are_at_that_studio_too(self, mine):
        seed.sow(mine, classes=False, into="songdo")
        assignments = mine.assignments()
        assert assignments
        assert all(a.studio == "songdo" for a in assignments)

    def test_a_coach_can_still_see_their_roster(self, mine):
        """The whole point: from the coach's chair the fixture has to work."""
        from pilates.accounts import Viewer
        from pilates.api import roster

        seed.sow(mine, classes=False, into="songdo")
        found = roster(mine, Viewer(username="park_minseok_example_com",
                                    studio="songdo", role=COACH))
        assert {s["display_name"] for s in found["students"]} == {
            "Kim Min-ji", "Lee Joon-ho", "Choi Seo-yeon"}

    def test_a_studio_that_does_not_exist_is_refused(self, mine):
        with pytest.raises(ValueError, match="no studio called"):
            seed.sow(mine, classes=False, into="nowhere")

    def test_the_owner_is_untouched(self, mine):
        before = {m.role for m in mine.memberships(username="me_real_test")}
        seed.sow(mine, classes=False, into="songdo")
        after = {m.role for m in mine.memberships(username="me_real_test")}
        assert before == after == {ADMIN, COACH, STUDENT}


class TestOneHashForSixteenPeople:
    def test_they_share_it(self, sown):
        """Right for real accounts, pointless here: they share a password that
        is printed on the screen, so there is nothing a per-account salt
        protects -- and it takes seeding from sixteen scrypt runs to one, which
        on the smallest hosting tier is a click rather than a timeout."""
        hashes = {row["password_hash"] for row in
                  sown.db.execute("SELECT password_hash FROM accounts")}
        assert len(hashes) == 1

    def test_and_it_still_verifies(self, sown):
        from pilates import auth

        assert auth.sign_in(sown, "kim.minji@example.com", seed.PASSWORD)
        assert auth.sign_in(sown, "park.minseok@example.com", seed.PASSWORD)


class TestATermOfCoaching:
    """The fixture exists to answer one question: what does this look like once
    a coach has actually been using it, rather than after one press?"""

    def _handle(self, sown, handle):
        return next(u for p, u in sown.made["people"] if p.handle == handle)

    def test_twelve_weeks_of_readings_are_written(self, sown):
        assert sown.made["readings"] > 200

    def test_one_student_has_a_run_long_enough_to_read(self, sown):
        from pilates.structure_eval import history

        rows = sown.structure_evals(self._handle(sown, "kim.minji"),
                                    "Psoas major")
        past = history(rows)
        assert past["count"] == seed.WEEKS
        run = past["runs"]["how much work it's doing"]
        assert len(run) == seed.WEEKS

    def test_the_arc_actually_goes_somewhere(self, sown):
        """A scatter of verdicts cannot answer "is this getting better", which
        is the only question a coach asks of a history."""
        rows = sorted(sown.structure_evals(self._handle(sown, "kim.minji"),
                                           "Psoas major"),
                      key=lambda e: e.made_on)
        first = rows[0].checks[0]["verdict"]
        last = rows[-1].checks[0]["verdict"]
        assert first == "problem" and last == "fine"

    def test_not_everybody_gets_better(self, sown):
        """A fixture where everybody improves cannot show a coach what a
        problem looks like six weeks in."""
        rows = sown.structure_evals(self._handle(sown, "han.doyun"))
        assert any(one.urgent for one in rows)

    def test_only_a_nerve_is_ever_urgent_in_the_fixture(self, sown):
        for _, username in sown.made["people"]:
            for one in sown.structure_evals(username):
                if one.urgent:
                    assert one.kind == "nerve"

    def test_a_reading_is_attributed_to_the_coach_who_has_them(self, sown):
        """Not to "the studio", and not to the student themselves."""
        rows = sown.structure_evals(self._handle(sown, "kim.minji"))
        assert {one.by for one in rows} == {"Park Min-seok"}

    def test_prose_is_written_sometimes_rather_than_every_week(self, sown):
        """A coach with ninety seconds between classes writes prose sometimes.
        Every single week would be a fixture flattering the interface."""
        rows = sown.structure_evals(self._handle(sown, "kim.minji"))
        with_prose = [one for one in rows if one.note]
        assert 0 < len(with_prose) < len(rows)

    def test_the_week_s_prose_is_not_repeated_onto_every_structure(self, sown):
        rows = sown.structure_evals(self._handle(sown, "kim.minji"))
        by_day: dict = {}
        for one in rows:
            if one.note:
                by_day.setdefault(one.made_on, []).append(one.note)
        assert all(len(notes) == 1 for notes in by_day.values())

    def test_the_dates_read_like_a_term_not_one_afternoon(self, sown):
        rows = sown.structure_evals(self._handle(sown, "kim.minji"))
        assert len({one.made_on for one in rows}) >= seed.WEEKS - 1

    def test_every_check_label_is_something_a_coach_would_say(self, sown):
        """No enum leaked into the fixture: these are the coach's own words."""
        for _, username in sown.made["people"]:
            for one in sown.structure_evals(username):
                for check in one.checks:
                    assert " " in check["label"], check["label"]
                    assert check["label"] == check["label"].lower()


class TestEverybodyEverything:
    """"What does it look like when it is full" is a question a fixture with
    nine students and four muscles cannot answer."""

    def test_every_muscle_bone_and_nerve_is_written_about(self, full):
        counts = {kind: full.db.execute(
            "SELECT COUNT(DISTINCT structure) FROM structure_evals WHERE kind=?",
            (kind,)).fetchone()[0] for kind in ("muscle", "bone", "nerve")}
        assert counts["muscle"] > 150
        assert counts["bone"] > 140
        assert counts["nerve"] >= 20

    def test_nothing_that_cannot_be_assessed_is_written_about(self, full):
        """No organs, no brain regions. The panel refuses those for a reason
        and a fixture that seeds them would make the refusal look like a bug."""
        kinds = {row[0] for row in
                 full.db.execute("SELECT DISTINCT kind FROM structure_evals")}
        assert kinds == {"muscle", "bone", "nerve"}

    def test_everybody_has_tens_of_classes_on_every_structure(self, full):
        for _, username in full.made["people"]:
            counts = full.count_structure_evals(username)
            assert len(counts) > 300, username
            assert min(counts.values()) >= 10, username

    def test_most_of_a_body_is_fine(self, full):
        """A person with three hundred and sixty problems is not a person, and
        a fixture that says otherwise teaches the interface to shout."""
        who = next(u for p, u in full.made["people"] if p.handle == "kim.minji")
        rows = full.latest_structure_evals(who, per=1)
        fine = sum(1 for one in rows if not one.flagged)
        assert fine / len(rows) > 0.6

    def test_but_some_of_it_is_not(self, full):
        who = next(u for p, u in full.made["people"] if p.handle == "kim.minji")
        rows = full.latest_structure_evals(who, per=1)
        assert any(one.flagged for one in rows)

    def test_the_lines_are_not_straight(self, full):
        """A score that walks a formula looks like a plot, not like somebody
        watching. A real third reading is not reliably between the second and
        the fourth."""
        from pilates.structure_eval import history

        who = next(u for p, u in full.made["people"] if p.handle == "kim.minji")
        structure = full.latest_structure_evals(who, per=1)[0].structure
        points = history(full.structure_evals(who, structure))["lines"]
        scores = [p["score"] for p in next(iter(points.values()))["points"]]
        steps = {b - a for a, b in zip(scores, scores[1:])}
        assert len(steps) > 1, scores

    def test_the_curated_stories_are_not_overwritten(self, full):
        """Kim Min-ji's psoas is written by hand, and the exhaustive pass has
        to leave it alone rather than bury it under a generated arc."""
        who = next(u for p, u in full.made["people"] if p.handle == "kim.minji")
        rows = full.structure_evals(who, "Psoas major")
        assert {c["label"] for one in rows for c in one.checks} == {
            "how much work it's doing", "does it let go between reps"}

    def test_each_reading_says_which_coach_made_it(self, full):
        who = next(u for p, u in full.made["people"] if p.handle == "kim.minji")
        assert {one.by for one in full.latest_structure_evals(who, per=1)} == {
            "Park Min-seok"}

    def test_the_fixture_can_be_asked_for_the_small_version(self):
        """A hundred thousand rows is the wrong shape for a unit test, and the
        seeder has to still be usable inside one."""
        import pilates.passwords as passwords

        was, passwords.N = passwords.N, 2 ** 14
        try:
            with Store.memory() as store:
                made = seed.sow(store, classes=False, everything=False)
                assert 0 < made["readings"] < 1000
        finally:
            passwords.N = was
