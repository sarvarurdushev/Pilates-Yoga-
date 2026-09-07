"""A studio full of people who do not exist, so the real one can be tested.

Clicking through a permission system needs more than one account. A coach with
no students proves nothing; a roster with nobody unscreened never shows the red
row; an admin inbox with nothing waiting never shows what approval looks like.
So this builds a whole studio -- three locations, coaches, students, consent in
every state, twelve weeks of measurements, and the notes a coach would have
written -- in one command.

**Everybody here is fictional and marked as such.** The names are ordinary
Korean names and the studios are ordinary Seoul and Busan neighbourhoods,
because a fixture that reads like a real studio is one you can actually judge
the interface against. What keeps it honest is not making it look fake, it is:

* every address is at ``example.com``, which is reserved and unroutable, so a
  deployment with a mail server configured cannot send a verification email to
  a real person by accident;
* every phone number is ``010-0000-xxxx``, a prefix Korean carriers do not
  issue, so nothing here dials a stranger;
* every person carries a marker in their record saying they were seeded, and
  every session carries the same synthetic block the demo does.

**It refuses to run on a database that already has accounts.** A fixture that
can be poured into a working studio is a fixture that will be, and there is no
way to tell a seeded student from a real one afterwards.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta

from .accounts import (ACTIVE, ADMIN, COACH, PENDING, STUDENT, Account,
                       Assignment, Membership, Profile, Screening, Studio, now)
from .demo import fill
from .observations import Observation

#: One password for everybody, printed by the command that makes them. Long
#: enough to pass the real rule, obvious enough that nobody mistakes this for a
#: production credential.
PASSWORD = "seoul-pilates-2026"

#: The marker every seeded person carries.
MARKER = ("Seeded test data. This person does not exist; nothing here was "
          "measured from a real body.")

#: Reserved by RFC 2606, so mail sent here reaches nobody.
DOMAIN = "example.com"


@dataclass
class Person:
    """One fictional human, and what is true of them."""

    handle: str
    name: str
    korean: str
    phone: str
    born: str
    height_m: float
    mass_kg: float
    #: (studio, role) pairs. More than one is the point of the design.
    roles: tuple
    #: PAR-Q answers that are true, or None for somebody never screened.
    flags: tuple | None = ()
    injuries: str = ""
    cleared: bool = False
    pregnant: bool = False
    goals: str = ""
    #: Weeks of measurements, or 0 for somebody who has never been recorded.
    classes: int = 0
    state: str = ACTIVE

    @property
    def email(self) -> str:
        return f"{self.handle}@{DOMAIN}"


STUDIOS = (
    Studio(key="gangnam", name="Gangnam Pilates", city="Seoul", country="KR",
           timezone="Asia/Seoul"),
    Studio(key="hongdae", name="Hongdae Movement Lab", city="Seoul",
           country="KR", timezone="Asia/Seoul"),
    Studio(key="haeundae", name="Haeundae Yoga & Pilates", city="Busan",
           country="KR", timezone="Asia/Seoul"),
)

PEOPLE = (
    # -- the owner, who is everything at Gangnam and admin at Hongdae too ----
    Person("seo.jiwoo", "Seo Ji-woo", "서지우", "+821000000101", "1988-03-14",
           1.66, 57, roles=(("gangnam", ADMIN), ("gangnam", COACH),
                            ("gangnam", STUDENT), ("hongdae", ADMIN)),
           flags=(), cleared=False, classes=6,
           goals="Teach four classes a week without the shoulder complaining"),

    # -- coaches ------------------------------------------------------------
    Person("park.minseok", "Park Min-seok", "박민석", "+821000000102",
           "1991-07-02", 1.78, 74, roles=(("gangnam", COACH),), flags=(),
           classes=0),
    # A coach at one studio and a student at another: the case a role column on
    # the account would have made impossible.
    Person("yoon.chaewon", "Yoon Chae-won", "윤채원", "+821000000103",
           "1994-11-21", 1.62, 52,
           roles=(("gangnam", COACH), ("hongdae", STUDENT)), flags=(),
           classes=4, goals="Hold a teaser for five breaths"),
    # Waiting for the admin to decide, so the inbox is not empty.
    Person("kang.taeyang", "Kang Tae-yang", "강태양", "+821000000104",
           "1996-01-30", 1.81, 79, roles=(("gangnam", COACH),), flags=(),
           classes=0, state=PENDING),
    Person("lim.hajun", "Lim Ha-jun", "임하준", "+821000000105", "1990-05-09",
           1.75, 71, roles=(("hongdae", COACH),), flags=(), classes=0),
    # Busan: one person who is both admin and coach, and nothing else.
    Person("bae.soojin", "Bae Soo-jin", "배수진", "+821000000106", "1986-09-18",
           1.60, 54, roles=(("haeundae", ADMIN), ("haeundae", COACH)),
           flags=(), classes=0),

    # -- students at Gangnam ------------------------------------------------
    Person("kim.minji", "Kim Min-ji", "김민지", "+821000000201", "1997-04-12",
           1.63, 55, roles=(("gangnam", STUDENT),), flags=("joint",),
           injuries="left knee, no deep flexion", cleared=True, classes=12,
           goals="Get back to full squat depth by spring"),
    Person("lee.joonho", "Lee Joon-ho", "이준호", "+821000000202", "1993-08-27",
           1.80, 82, roles=(("gangnam", STUDENT),), flags=(), classes=8,
           goals="Straighten the desk posture"),
    # Never screened: the red row at the top of the coach's roster.
    Person("choi.seoyeon", "Choi Seo-yeon", "최서연", "+821000000203",
           "2001-02-08", 1.68, 58, roles=(("gangnam", STUDENT),), flags=None,
           classes=3),
    Person("jung.haeun", "Jung Ha-eun", "정하은", "+821000000204", "1995-06-15",
           1.64, 61, roles=(("gangnam", STUDENT),), flags=(), pregnant=True,
           cleared=True, classes=6,
           goals="Keep moving safely through the second trimester"),
    # A yes on the questionnaire with no doctor behind it yet.
    Person("han.doyun", "Han Do-yun", "한도윤", "+821000000205", "1979-12-03",
           1.72, 88, roles=(("gangnam", STUDENT),),
           flags=("heart", "medication"), classes=5,
           goals="Twenty minutes of continuous work"),
    # Nobody's student yet: for testing the ask-and-accept round trip.
    Person("oh.seah", "Oh Se-ah", "오세아", "+821000000206", "1999-10-22",
           1.70, 60, roles=(("gangnam", STUDENT),), flags=(), classes=4),

    # -- students elsewhere -------------------------------------------------
    Person("shin.yerin", "Shin Ye-rin", "신예린", "+821000000301", "1998-03-05",
           1.61, 51, roles=(("hongdae", STUDENT),), flags=(), classes=7),
    Person("moon.jaehyun", "Moon Jae-hyun", "문재현", "+821000000302",
           "1992-09-14", 1.77, 76, roles=(("hongdae", STUDENT),),
           flags=("joint",), injuries="right shoulder, no overhead load",
           cleared=True, classes=5),
    Person("song.arin", "Song A-rin", "송아린", "+821000000401", "2000-07-19",
           1.65, 56, roles=(("haeundae", STUDENT),), flags=(), classes=9),
    Person("yang.dowon", "Yang Do-won", "양도원", "+821000000402", "1989-11-08",
           1.74, 80, roles=(("haeundae", STUDENT),), flags=(), classes=2),
)

#: coach handle -> (student handles that accepted, student handles still asked)
ROSTERS = {
    "park.minseok": (("kim.minji", "lee.joonho", "choi.seoyeon"), ()),
    # One live and one still waiting on the student, so the consent prompt has
    # something to show the first time somebody signs in as them.
    "yoon.chaewon": (("jung.haeun", "han.doyun"), ("oh.seah",)),
    "lim.hajun": (("shin.yerin", "moon.jaehyun"), ()),
    "bae.soojin": (("song.arin", "yang.dowon"), ()),
}

#: What a coach actually writes: cues in the student's own words, what to avoid,
#: what was changed and why, the springs, and goals with a date to look again.
#: One of them is deliberately overdue, because an overdue goal is the other
#: thing the roster is meant to surface.
NOTES = (
    ("kim.minji", "park.minseok", "contraindication",
     "Left knee — no deep flexion past 90 degrees. Meniscus repair 2024, "
     "cleared to train.", "", None, "", ""),
    ("kim.minji", "park.minseok", "cue",
     "“Reach the heel away” works where “straighten the leg” "
     "does not — she pushes into the knee on the second one.", "rectus femoris",
     None, "", ""),
    ("kim.minji", "park.minseok", "goal",
     "Full squat depth without the knee complaining.", "", None, "",
     "2026-08-01"),          # overdue on purpose
    ("kim.minji", "park.minseok", "assessment",
     "Hip flexor moment up nine newton-metres over the block. Control through "
     "the bottom of the movement is the change, not range.", "psoas major",
     4, "control through the hips", ""),
    ("lee.joonho", "park.minseok", "modification",
     "Roll-down against the wall rather than free-standing until the thoracic "
     "opens up.", "", None, "", ""),
    ("lee.joonho", "park.minseok", "setting",
     "Reformer: two reds and a blue for footwork. One red is too light for "
     "him now.", "", None, "", ""),
    ("lee.joonho", "park.minseok", "goal",
     "Teaser without the hands by the end of the term.", "", None, "",
     "2026-12-01"),
    ("jung.haeun", "yoon.chaewon", "contraindication",
     "Second trimester — nothing prone, nothing supine beyond a couple of "
     "minutes, no deep abdominal flexion.", "rectus abdominis", None, "", ""),
    ("jung.haeun", "yoon.chaewon", "subjective",
     "Said the side-lying series felt “like the first thing that has not "
     "made my back worse”.", "", None, "", ""),
    ("han.doyun", "yoon.chaewon", "contraindication",
     "Answered yes on the heart question and has not seen a doctor yet. "
     "Nothing above a conversational pace until he has.", "", None, "", ""),
    ("han.doyun", "yoon.chaewon", "cue",
     "Counts out loud to stop himself holding his breath.", "diaphragm",
     None, "", ""),
    ("moon.jaehyun", "lim.hajun", "modification",
     "Right shoulder: everything overhead becomes a wall slide for now.",
     "deltoid", 3, "shoulder range", ""),
    ("song.arin", "bae.soojin", "assessment",
     "Steadiest of the Saturday group. Ready for the intermediate sequence.",
     "", 5, "control", ""),
)


def _roles_for(person: Person, into: str) -> tuple:
    """Where this person's roles land, and what they are allowed to be.

    Seeding into an existing studio collapses every membership onto it and
    demotes admin to coach: a fixture poured into somewhere real must not make
    a fictional person able to read every health record in the building.
    Duplicates are dropped, since somebody who was admin *and* coach at Gangnam
    is just a coach once both land in the same place.
    """
    if not into:
        return person.roles
    kept = []
    for _, role in person.roles:
        role = COACH if role == ADMIN else role
        if (into, role) not in kept:
            kept.append((into, role))
    return tuple(kept)


def _answers(flags) -> dict:
    from .accounts import PARQ

    return {key: (key in (flags or ())) for key in PARQ}


def already_seeded(store) -> bool:
    return bool(store.db.execute(
        "SELECT 1 FROM accounts WHERE email LIKE ?", (f"%@{DOMAIN}",)).fetchone())


def sow(store, password: str = PASSWORD, classes: bool = True,
        into: str = "") -> dict:
    """Build the whole studio. Returns what was made, for printing.

    Ordered the way it has to be: studios, then people, then roles, then the
    assignments that depend on both people existing, then the notes that depend
    on the assignment being live -- which is the same order a real studio fills
    up in, and the reason the fixture is worth having.

    ``into`` puts everybody in a studio that already exists instead of making
    the three. That is the case somebody actually hits: they set their own
    studio up through the page, then seeded, and the fictional people landed in
    three studios they were not a member of -- so from where they were sitting
    the fixture had simply not worked.

    **Nobody seeded becomes an admin of a studio they did not create.** Seeding
    into somewhere real should not hand a fictional person the ability to read
    every health record in it, so an admin role becomes a coach role. The
    switcher still has something to demonstrate: the owner of those two roles
    holds both.
    """
    made = {"studios": [], "people": [], "assignments": 0, "notes": 0,
            "sessions": 0, "into": into}

    if into:
        if store.studio(into) is None:
            raise ValueError(f"there is no studio called {into!r} here. "
                             "`pilates studio --list` shows the ones there are")
        made["studios"].append(store.studio(into))
    else:
        for studio in STUDIOS:
            store.add_studio(studio)
            made["studios"].append(studio)

    # One hash for all sixteen. Hashing separately is right for real accounts
    # and pointless here: they share a password that is printed on the screen,
    # so there is nothing a per-account salt protects. It also takes the cost of
    # seeding from sixteen scrypt runs to one, which on the smallest hosting
    # tier is the difference between a click and a timeout.
    from .passwords import hash_password

    shared = hash_password(password)

    for person in PEOPLE:
        account = Account(email=person.email, display_name=person.name,
                          phone=person.phone, password_hash=shared)
        username = store.create_account(account)
        store.db.execute("UPDATE people SET notes = ? WHERE username = ?",
                         (MARKER, username))
        store.put_profile(Profile(username=username, born=person.born,
                                  height_m=person.height_m,
                                  mass_kg=person.mass_kg,
                                  emergency_name="Emergency contact",
                                  emergency_phone="+821000000999",
                                  goals=person.goals))
        if person.flags is not None:
            store.put_screening(Screening(
                username=username, answers=_answers(person.flags),
                injuries=person.injuries,
                conditions="Recorded during a seeded setup; not a real history.",
                medications="", pregnant=person.pregnant,
                cleared_by_physician=person.cleared,
                completed_on=str(date.today() - timedelta(days=30))))
        for studio_key, role in _roles_for(person, into):
            store.put_membership(Membership(
                username=username, studio=studio_key, role=role,
                state=person.state, decided_by="seed",
                decided_at=now() if person.state == ACTIVE else ""))
        made["people"].append((person, username))

    handles = {person.handle: username for person, username in made["people"]}

    for coach_handle, (accepted, asked) in ROSTERS.items():
        coach = handles[coach_handle]
        person = next(p for p in PEOPLE if p.handle == coach_handle)
        # The studio they coach at, found by the role rather than by position:
        # Yoon coaches at Gangnam and is a student at Hongdae, and taking the
        # first membership would have put her students at the wrong place.
        studio = next(studio_key for studio_key, role
                      in _roles_for(person, into) if role == COACH)
        for student_handle in accepted:
            store.put_assignment(Assignment(
                coach=coach, student=handles[student_handle], studio=studio,
                state=ACTIVE, since=str(date.today() - timedelta(days=60)),
                asked_by=coach))
            made["assignments"] += 1
        for student_handle in asked:
            store.put_assignment(Assignment(
                coach=coach, student=handles[student_handle], studio=studio,
                state=PENDING, since=str(date.today() - timedelta(days=2)),
                asked_by=coach))

    if classes:
        made["sessions"] = _record_classes(store, made["people"])

    for handle, by, kind, text, structure, rating, rates, review in NOTES:
        store.observe(Observation(
            username=handles[handle], kind=kind, text=text,
            by=next(p.name for p in PEOPLE if p.handle == by),
            structure=structure, rating=rating, rates=rates,
            review_on=review,
            made_on=str(date.today() - timedelta(days=14))))
        made["notes"] += 1

    store.record_audit(actor="seed", action="seed:sown",
                       detail=f"{len(made['people'])} people, "
                              f"{len(made['studios'])} studios")
    return made


def _record_classes(store, people) -> int:
    """Weeks of measurements, so the charts and the noise floor have something.

    Session keys carry the person, because a repeated key does not fail -- it
    appends to the session already there, and two students under one key would
    become one student with twice the measurements.
    """
    last = date.today() - timedelta(days=2)
    total = 0
    for person, username in people:
        for week in range(person.classes):
            when = last - timedelta(weeks=person.classes - 1 - week)
            fill(store, username=username, display=person.name,
                 session=f"{person.handle}-{week + 1:02d}",
                 date=when.isoformat(), drift=week)
            total += 1
    return total


def summary(made: dict, password: str = PASSWORD) -> str:
    """What to hand somebody who now has to sign in as sixteen people."""
    into = made.get("into") or ""
    lines = ["", "Studios", "-------"]
    for studio in made["studios"]:
        key = studio["key"] if isinstance(studio, dict) else studio.key
        name = studio["name"] if isinstance(studio, dict) else studio.name
        city = studio["city"] if isinstance(studio, dict) else studio.city
        lines.append(f"  {key:<10} {name}" + (f" — {city}" if city else ""))
    if into:
        lines.append("")
        lines.append(f"  Everybody was put into {into}, and nobody seeded was "
                     "made an admin of it.")

    lines += ["", f"Everybody's password is:  {password}",
              f"Every address is at @{DOMAIN}, which reaches nobody.", "",
              "People", "------"]
    for person, _ in made["people"]:
        roles = ", ".join(f"{role}@{studio}"
                          for studio, role in _roles_for(person, into))
        note = []
        if person.state == PENDING:
            note.append("waiting for approval")
        if person.flags is None:
            note.append("never screened")
        if person.classes:
            note.append(f"{person.classes} classes")
        lines.append(f"  {person.email:<34} {person.name:<16} {roles}"
                     + (f"   ({'; '.join(note)})" if note else ""))

    where = into or "gangnam"
    lines += ["", "Try this", "--------",
              f"  1. As your own admin, open Studio → People. All of them are",
              f"     there, at {where}.",
              "  2. Studio → Waiting: Kang Tae-yang has asked to be a coach.",
              "  3. Sign in as park.minseok@example.com — three students, and",
              "     Choi Seo-yeon is red because nobody has screened her.",
              "  4. Sign in as oh.seah@example.com — Yoon Chae-won has asked to",
              "     coach her, and the consent prompt is waiting.",
              "  5. Sign in as kim.minji@example.com — twelve weeks of",
              "     measurements, a knee flag and an overdue goal.",
              "  6. Sign in as seo.jiwoo@example.com — two roles at once; the",
              "     switcher in the header changes the room.",
              ""]
    return "\n".join(lines)
