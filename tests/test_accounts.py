"""Who is who, and what they may see.

The tests that matter here are the refusals. A permission system whose happy
path works is not evidence of anything: the question is whether the coach at
the next mat can read a stranger's medications, and whether somebody who types
"admin" into a signup form becomes one.
"""
import pytest

from pilates.accounts import (ACTIVE, ADMIN, COACH, DEFAULT_SCOPES, LEFT, PARQ,
                              PENDING, SEE_CONTACT, SEE_FLAGS,
                              SEE_MEASUREMENTS, STUDENT, Account, Assignment,
                              Membership, Profile, Screening, Studio, Viewer,
                              age_on, may_read_measurements, may_write_about,
                              normalise_email, normalise_phone, today,
                              username_for, visible_person)
from pilates.store import Store


class TestAnAccountRefuses:
    def test_something_that_is_not_an_email(self):
        with pytest.raises(ValueError, match="not an email"):
            Account(email="sarvar at gmail", display_name="Sarvar")

    def test_a_person_with_no_name_to_be_called_by(self):
        with pytest.raises(ValueError, match="name to be called by"):
            Account(email="a@b.co", display_name="   ")

    def test_a_phone_number_with_no_country_code(self):
        """Assuming one is how a studio in Tashkent files a Uzbek number as
        American."""
        with pytest.raises(ValueError, match="country code"):
            Account(email="a@b.co", display_name="A", phone="901234567")

    def test_it_never_carries_the_password_hash_outwards(self):
        """One accidental serialisation is a breach."""
        account = Account(email="a@b.co", display_name="A",
                          password_hash="scrypt$secret")
        assert "password_hash" not in account.to_dict()
        assert "scrypt" not in str(account.to_dict())


class TestOnePersonOneKey:
    def test_the_email_decides_the_username(self):
        assert username_for("Sarvar.U@Gmail.com ") == "sarvar_u_gmail_com"

    def test_case_and_spacing_do_not_fork_a_person(self):
        assert (normalise_email("  A@B.CO ") == normalise_email("a@b.co"))

    def test_a_phone_number_is_stored_one_way(self):
        assert (normalise_phone("+998 90 123 45 67")
                == normalise_phone("+998901234567") == "+998901234567")

    def test_a_double_zero_prefix_is_the_same_number(self):
        assert normalise_phone("00998901234567") == "+998901234567"


class TestAgeIsComputed:
    def test_from_the_date_of_birth(self):
        assert age_on("1994-05-02", when="2026-09-07") == 32

    def test_a_birthday_that_has_not_happened_yet_this_year(self):
        assert age_on("1994-12-31", when="2026-09-07") == 31

    def test_nonsense_is_none_rather_than_a_crash(self):
        assert age_on("not a date") is None and age_on("") is None

    def test_a_minor_is_flagged(self):
        young = Profile(username="x", born=f"{int(today()[:4]) - 12}-01-01")
        grown = Profile(username="y", born=f"{int(today()[:4]) - 30}-01-01")
        assert young.minor and not grown.minor


class TestTheRoleIsOnTheMembership:
    """The decision everything else falls out of. One person, three roles, one
    body of measurements -- which is the studio's own first case."""

    @pytest.fixture
    def db(self):
        with Store.memory() as store:
            store.add_studio(Studio(key="tashkent", name="Tashkent Pilates"))
            store.add_studio(Studio(key="samarkand", name="Samarkand Yoga"))
            yield store

    def test_one_account_can_hold_three_roles(self, db):
        account = Account(email="a@b.co", display_name="Sarvar")
        db.create_account(account, password="a good long password")
        for role in (ADMIN, COACH, STUDENT):
            db.put_membership(Membership(username=account.username,
                                         studio="tashkent", role=role,
                                         state=ACTIVE))
        held = db.memberships(username=account.username)
        assert {m.role for m in held} == {ADMIN, COACH, STUDENT}

    def test_a_coach_at_one_studio_can_be_a_student_at_another(self, db):
        account = Account(email="a@b.co", display_name="Sarvar")
        db.create_account(account, password="a good long password")
        db.put_membership(Membership(username=account.username,
                                     studio="tashkent", role=COACH,
                                     state=ACTIVE))
        db.put_membership(Membership(username=account.username,
                                     studio="samarkand", role=STUDENT,
                                     state=ACTIVE))
        assert len(db.memberships(username=account.username, role=COACH)) == 1
        assert db.memberships(username=account.username,
                              studio="samarkand")[0].role == STUDENT

    def test_only_an_active_membership_does_anything(self, db):
        for state in (PENDING, "suspended", "left"):
            assert not Membership(username="x", studio="tashkent", role=COACH,
                                  state=state).usable
        assert Membership(username="x", studio="tashkent", role=COACH,
                          state=ACTIVE).usable

    def test_an_invented_role_is_refused(self, db):
        with pytest.raises(ValueError, match="not one of"):
            Membership(username="x", studio="tashkent", role="supervisor")

    def test_the_account_row_itself_carries_no_role(self, db):
        """If it ever does, the whole design has been undone."""
        columns = {row[1] for row in db.db.execute("PRAGMA table_info(accounts)")}
        assert "role" not in columns


class TestTheScreening:
    def _answers(self, **overrides):
        answers = {key: False for key in PARQ}
        answers.update(overrides)
        return answers

    def test_a_partial_questionnaire_is_not_complete(self):
        screening = Screening(username="x", answers={"heart": False},
                              completed_on=today())
        assert not screening.complete
        assert screening.flags() == ["not screened yet"]

    def test_a_yes_anywhere_wants_a_doctor(self):
        screening = Screening(username="x", answers=self._answers(heart=True),
                              completed_on=today())
        assert screening.needs_clearance
        assert "needs a doctor's clearance" in screening.flags()

    def test_a_doctor_having_said_yes_changes_the_flag(self):
        screening = Screening(username="x", answers=self._answers(heart=True),
                              completed_on=today(), cleared_by_physician=True)
        assert not screening.needs_clearance
        assert "cleared by a doctor" in screening.flags()

    def test_all_no_is_nothing_flagged(self):
        screening = Screening(username="x", answers=self._answers(),
                              completed_on=today())
        assert screening.flags() == ["nothing flagged"]

    def test_the_flags_never_carry_the_medical_record(self):
        """A coach needs to know there is a knee. The name of the operation is
        not theirs to hold."""
        screening = Screening(
            username="x", answers=self._answers(joint=True, medication=True),
            conditions="type 1 diabetes", medications="insulin, metformin",
            injuries="left knee, no deep flexion", completed_on=today())
        printed = " ".join(screening.flags()).lower()
        assert "knee" in printed
        assert "insulin" not in printed and "diabetes" not in printed

    def test_an_invented_question_is_refused(self):
        with pytest.raises(ValueError, match="not PAR-Q"):
            Screening(username="x", answers={"vibes": True})


class TestWhoSeesWhat:
    @pytest.fixture
    def people(self):
        student = Account(email="student@b.co", display_name="A Student",
                          phone="+998901234568")
        profile = Profile(username=student.username, born="1998-04-12",
                          height_m=1.76, mass_kg=72,
                          emergency_name="Next of kin",
                          emergency_phone="+998901234569")
        screening = Screening(
            username=student.username,
            answers={key: (key == "joint") for key in PARQ},
            conditions="an old meniscus tear", medications="ibuprofen",
            injuries="left knee, no deep flexion", completed_on=today(),
            cleared_by_physician=True)
        return student, profile, screening

    def _assignment(self, coach, student, **kwargs):
        return Assignment(coach=coach, student=student, studio="tashkent",
                          state=ACTIVE, **kwargs)

    def test_a_coach_sees_flags_and_never_the_record(self, people):
        student, profile, screening = people
        coach = Viewer(username="coach", studio="tashkent", role=COACH)
        seen = visible_person(student, profile, screening, coach,
                              self._assignment("coach", student.username))
        assert seen["seen_as"] == "coach"
        assert "left knee" in " ".join(seen["screening"]["flags"])
        assert "conditions" not in seen["screening"]
        assert "medications" not in seen["screening"]
        assert "born" not in seen

    def test_a_coach_sees_the_numbers_a_class_needs(self, people):
        """Height and weight are not vanity fields: a joint moment is a mass on
        a lever."""
        student, profile, screening = people
        coach = Viewer(username="coach", studio="tashkent", role=COACH)
        seen = visible_person(student, profile, screening, coach,
                              self._assignment("coach", student.username))
        assert seen["height_m"] == 1.76 and seen["mass_kg"] == 72
        assert seen["age"] == age_on("1998-04-12")

    def test_an_admin_sees_everything(self, people):
        student, profile, screening = people
        admin = Viewer(username="boss", studio="tashkent", role=ADMIN)
        seen = visible_person(student, profile, screening, admin)
        assert seen["born"] == "1998-04-12"
        assert seen["screening"]["medications"] == "ibuprofen"

    def test_the_person_themselves_sees_everything(self, people):
        student, profile, screening = people
        seen = visible_person(student, profile, screening,
                              Viewer(username=student.username,
                                     studio="tashkent", role=STUDENT))
        assert seen["seen_as"] == "self"
        assert seen["screening"]["conditions"]

    def test_a_coach_with_no_assignment_sees_a_name(self, people):
        """Being in the same building is not permission. This is the line the
        whole privacy design comes down to."""
        student, profile, screening = people
        stranger = Viewer(username="other_coach", studio="tashkent", role=COACH)
        seen = visible_person(student, profile, screening, stranger, None)
        assert set(seen) == {"username", "display_name"}

    def test_contact_is_withheld_when_it_was_not_consented_to(self, people):
        student, profile, screening = people
        coach = Viewer(username="coach", studio="tashkent", role=COACH)
        narrow = self._assignment("coach", student.username,
                                  scopes=(SEE_MEASUREMENTS, SEE_FLAGS))
        seen = visible_person(student, profile, screening, coach, narrow)
        assert "phone" not in seen and "emergency_phone" not in seen
        assert seen["screening"]["flags"]

    def test_flags_are_withheld_when_they_were_not_consented_to(self, people):
        student, profile, screening = people
        coach = Viewer(username="coach", studio="tashkent", role=COACH)
        narrow = self._assignment("coach", student.username,
                                  scopes=(SEE_MEASUREMENTS, SEE_CONTACT))
        seen = visible_person(student, profile, screening, coach, narrow)
        assert "screening" not in seen


class TestReadingAndWritingMeasurements:
    def _coach(self, name="coach"):
        return Viewer(username=name, studio="tashkent", role=COACH)

    def _live(self, coach="coach", student="student", **kwargs):
        return Assignment(coach=coach, student=student, studio="tashkent",
                          state=ACTIVE, **kwargs)

    def test_everybody_reads_their_own(self):
        me = Viewer(username="me", studio="tashkent", role=STUDENT)
        assert may_read_measurements(me, "me", None)

    def test_a_student_cannot_read_another_student(self):
        me = Viewer(username="me", studio="tashkent", role=STUDENT)
        assert not may_read_measurements(me, "somebody_else", None)

    def test_a_coach_reads_an_assigned_student(self):
        assert may_read_measurements(self._coach(), "student", self._live())

    def test_a_coach_cannot_read_somebody_else_s_student(self):
        other = self._live(coach="a_different_coach")
        assert not may_read_measurements(self._coach(), "student", other)

    def test_an_ended_assignment_stops_reading(self):
        ended = Assignment(coach="coach", student="student", studio="tashkent",
                           state=LEFT, until=today())
        assert not may_read_measurements(self._coach(), "student", ended)

    def test_a_pending_request_grants_nothing(self):
        """A coach asking is not a student agreeing."""
        asked = Assignment(coach="coach", student="student", studio="tashkent",
                           state=PENDING)
        assert not may_read_measurements(self._coach(), "student", asked)

    def test_consent_narrowed_to_exclude_measurements_stops_reading(self):
        narrow = self._live(scopes=(SEE_FLAGS,))
        assert not may_read_measurements(self._coach(), "student", narrow)

    def test_an_admin_reads_anybody(self):
        boss = Viewer(username="boss", studio="tashkent", role=ADMIN)
        assert may_read_measurements(boss, "anyone", None)

    def test_a_student_cannot_write_observations_even_about_themselves(self):
        """An observation's whole authority is that a coach said it, on a date.
        A student's own account of how it felt is a subjective note, which the
        coach records."""
        me = Viewer(username="me", studio="tashkent", role=STUDENT)
        assert not may_write_about(me, "me", None)

    def test_a_coach_writes_only_about_their_own_students(self):
        assert may_write_about(self._coach(), "student", self._live())
        assert not may_write_about(self._coach(), "student",
                                   self._live(coach="somebody_else"))


class TestAssignments:
    def test_a_coach_cannot_be_assigned_to_themselves(self):
        with pytest.raises(ValueError, match="themselves"):
            Assignment(coach="same", student="same", studio="tashkent")

    def test_an_invented_consent_scope_is_refused(self):
        with pytest.raises(ValueError, match="not consent scopes"):
            Assignment(coach="a", student="b", studio="s", scopes=("everything",))

    def test_accepting_grants_the_three_default_scopes(self):
        assignment = Assignment(coach="a", student="b", studio="s",
                                state=ACTIVE)
        assert set(assignment.scopes) == set(DEFAULT_SCOPES)

    def test_an_end_date_ends_it_whatever_the_state_says(self):
        assignment = Assignment(coach="a", student="b", studio="s",
                                state=ACTIVE, until=today())
        assert not assignment.live
