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

#: coach handle -> the students on their roster. Oh Se-ah is deliberately on
#: nobody's, so there is somebody left in the directory to practise adding.
ROSTERS = {
    "park.minseok": ("kim.minji", "lee.joonho", "choi.seoyeon"),
    "yoon.chaewon": ("jung.haeun", "han.doyun"),
    "lim.hajun": ("shin.yerin", "moon.jaehyun"),
    "bae.soojin": ("song.arin", "yang.dowon"),
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
            "sessions": 0, "readings": 0, "into": into}

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

    for coach_handle, students in ROSTERS.items():
        coach = handles[coach_handle]
        person = next(p for p in PEOPLE if p.handle == coach_handle)
        # The studio they coach at, found by the role rather than by position:
        # Yoon coaches at Gangnam and is a student at Hongdae, and taking the
        # first membership would have put her students at the wrong place.
        studio = next(studio_key for studio_key, role
                      in _roles_for(person, into) if role == COACH)
        for student_handle in students:
            store.put_assignment(Assignment(
                coach=coach, student=handles[student_handle], studio=studio,
                state=ACTIVE, since=str(date.today() - timedelta(days=60)),
                asked_by=coach))
            made["assignments"] += 1

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

    made["readings"] = _write_readings(store, handles, into)

    store.record_audit(actor="seed", action="seed:sown",
                       detail=f"{len(made['people'])} people, "
                              f"{len(made['studios'])} studios, "
                              f"{made['readings']} readings")
    return made


#: Twelve weeks of readings, so a studio can see what this looks like once a
#: coach has actually been using it rather than after one press.
#:
#: Written as an arc rather than as random noise, because the whole question a
#: coach asks of the history is *"is this getting better"* and a scatter of
#: verdicts cannot answer it. Each entry is:
#:
#:     (structure, kind, check, [verdict per class, oldest first], note)
#:
#: A blank verdict means that class the coach looked and did not commit -- which
#: happens, and a fixture where every check is answered every week is a fixture
#: that flatters the interface.
ARCS = {
    "kim.minji": [
        # A structure the camera also measures, so the verdict lane and the
        # newton-metre line sit on one date axis -- which is the comparison the
        # whole tier system exists to make possible.
        ("Pectoralis major", "muscle", "does it let go between reps",
         ["problem", "problem", "watch", "watch", "watch", "watch",
          "watch", "watch", "fine", "watch", "watch", "watch"],
         "still needs a bit more work — grips through the whole arm series"),
        ("Pectoralis major", "muscle", "what took over instead",
         ["watch", "watch", "watch", "watch", "fine", "watch",
          "fine", "fine", "fine", "fine", "fine", "fine"],
         "front of the shoulder doing the work of the chest"),
        ("Psoas major", "muscle", "how much work it's doing",
         ["problem", "problem", "problem", "watch", "watch", "watch",
          "watch", "fine", "watch", "fine", "fine", "fine"],
         "taking the whole teaser; abdominals barely in it"),
        ("Psoas major", "muscle", "does it let go between reps",
         ["problem", "problem", "watch", "watch", "watch", "",
          "watch", "watch", "fine", "fine", "fine", "fine"],
         "still gripping at the bottom of the roll-down"),
        ("Rectus abdominis", "muscle", "when it comes in",
         ["watch", "watch", "watch", "fine", "fine", "fine",
          "fine", "fine", "fine", "fine", "fine", "fine"],
         "late — the hip flexors start it"),
        ("Sacrum", "bone", "does it stay there under load",
         ["problem", "watch", "watch", "watch", "fine", "watch",
          "fine", "fine", "fine", "fine", "fine", "fine"],
         "tips under as soon as the springs go on"),
        ("Latissimus dorsi", "muscle", "left against right",
         ["", "watch", "watch", "watch", "watch", "watch",
          "watch", "watch", "watch", "fine", "watch", "watch"],
         "right side always does more; old knee, she pushes off it"),
    ],
    "lee.joonho": [
        ("Trapezius", "muscle", "does the shoulder shrug",
         ["problem", "problem", "problem", "problem", "watch", "watch",
          "problem", "watch", "watch", "watch", "fine", "watch"],
         "up round the ears the moment the arms load"),
        ("Serratus anterior", "muscle", "how much work it's doing",
         ["problem", "problem", "watch", "watch", "watch", "watch",
          "fine", "watch", "fine", "fine", "fine", "fine"],
         "not much — the traps are covering for it"),
        ("Scapula", "bone", "where it sits at the start",
         ["watch", "watch", "watch", "fine", "fine", "watch",
          "fine", "fine", "fine", "fine", "fine", "fine"],
         "winging off the ribs in quadruped"),
        ("Cervical vertebra", "bone", "against the segment above and below",
         ["watch", "watch", "fine", "fine", "watch", "fine",
          "fine", "fine", "fine", "fine", "fine", "fine"],
         "chin pokes as soon as he concentrates"),
    ],
    "choi.seoyeon": [
        ("Gluteus medius", "muscle", "left against right",
         ["problem", "problem", "watch", "watch", "watch", "watch",
          "watch", "fine", "watch", "fine", "fine", "fine"],
         "left one is not showing up at all in side-lying"),
        ("Tensor fasciae latae", "muscle", "what took over instead",
         ["problem", "watch", "watch", "watch", "fine", "watch",
          "fine", "fine", "fine", "fine", "fine", "fine"],
         "doing the whole abduction; hip flexes to get the leg up"),
        ("Femur", "bone", "where the control goes",
         ["watch", "watch", "watch", "watch", "watch", "fine",
          "fine", "watch", "fine", "fine", "fine", "fine"],
         "knee falls in at the bottom of the squat, never at the top"),
    ],
    "han.doyun": [
        # The one where it does not go well. A fixture in which everybody
        # improves is a fixture that cannot show a coach what a problem
        # looks like six weeks in.
        ("Sciatic nerve", "nerve", "what they reported",
         ["", "", "watch", "watch", "watch", "problem",
          "problem", "watch", "watch", "watch", "fine", "fine"],
         "pins and needles down the back of the left thigh"),
        ("Sciatic nerve", "nerve", "how long it lasted",
         ["", "", "fine", "watch", "watch", "problem",
          "problem", "watch", "fine", "fine", "fine", "fine"],
         "still there when he left — sent him to get it looked at"),
        ("Lumbar vertebra", "bone", "does it stay there under load",
         ["watch", "watch", "problem", "problem", "problem", "problem",
          "watch", "watch", "watch", "fine", "fine", "fine"],
         "hinges at one segment rather than articulating"),
        ("Erector spinae", "muscle", "does it let go between reps",
         ["problem", "problem", "problem", "watch", "watch", "watch",
          "watch", "watch", "fine", "fine", "fine", "fine"],
         "braced solid the whole class"),
    ],
    "jung.haeun": [
        ("Transversus abdominis", "muscle", "how much work it's doing",
         ["watch", "watch", "watch", "fine", "fine", "fine",
          "fine", "fine", "fine", "fine", "fine", "fine"],
         "there, but she over-grips and the breath stops"),
        ("Diaphragm", "muscle", "does it hold through the set",
         ["problem", "watch", "watch", "watch", "fine", "fine",
          "watch", "fine", "fine", "fine", "fine", "fine"],
         "breath-holding through the whole forward phase"),
        ("Pelvis", "bone", "where it sits at the start",
         ["watch", "fine", "fine", "watch", "fine", "fine",
          "fine", "fine", "fine", "fine", "fine", "fine"], ""),
    ],
    "shin.yerin": [
        ("Rhomboid major", "muscle", "how much work it's doing",
         ["watch", "watch", "watch", "watch", "watch", "watch",
          "fine", "watch", "fine", "fine", "watch", "fine"],
         "quiet; the upper traps take it"),
        ("Thoracic vertebra", "bone", "how much range",
         ["problem", "problem", "watch", "watch", "watch", "watch",
          "watch", "watch", "fine", "watch", "fine", "fine"],
         "moves as a block from T4 down"),
    ],
    "moon.jaehyun": [
        ("Hamstring", "muscle", "how much range",
         ["problem", "problem", "problem", "watch", "watch", "watch",
          "watch", "watch", "watch", "fine", "fine", "watch"],
         "the range genuinely is not there yet"),
        ("Gastrocnemius", "muscle", "does it let go between reps",
         ["watch", "watch", "watch", "fine", "fine", "fine",
          "fine", "fine", "fine", "fine", "fine", "fine"],
         "toes gripping the footbar"),
    ],
    "song.arin": [
        ("Gluteus maximus", "muscle", "when it comes in",
         ["problem", "problem", "watch", "watch", "watch", "fine",
          "watch", "fine", "fine", "fine", "fine", "fine"],
         "late — hamstrings start every bridge"),
        ("Rectus femoris", "muscle", "does it let go between reps",
         ["watch", "watch", "watch", "watch", "fine", "fine",
          "fine", "fine", "fine", "fine", "fine", "fine"], ""),
    ],
    "yang.dowon": [
        ("Deltoid", "muscle", "left against right",
         ["watch", "watch", "watch", "watch", "watch", "watch",
          "watch", "watch", "watch", "watch", "watch", "watch"],
         "right always higher; he has never noticed"),
        ("Humerus", "bone", "where it sits at the start",
         ["watch", "fine", "watch", "fine", "fine", "fine",
          "fine", "fine", "fine", "fine", "fine", "fine"], ""),
    ],
}

#: What the coach wrote in the free box, roughly every third class. Not every
#: week: a coach with ninety seconds between classes writes prose sometimes.
PROSE = {
    "kim.minji": [
        (11, "Best teaser she has done — did not need the hands-on cue once. "
             "Chest still needs a little more work but everything else has "
             "landed. Two reds is the right load now."),
        (9, "Asked her what she felt and she said “my hips”, which is the "
            "whole problem in three words. Spent the class on breath instead "
            "of cueing the abdominals directly and it went better."),
        (8, "Dropped to two reds and everything got more even. Keep it there."),
        (6, "Rib cage is the thing now, not the pelvis. Moving the focus."),
        (5, "Wall roll-downs before the mat work are doing it — third week in "
            "a row. Left hip still drifts on the last two reps of anything."),
        (3, "Slept badly, took it light. Not a fair read on anything today."),
        (2, "Everything upstream of the pelvis is fine; it is all the psoas. "
            "Hands on the lower ribs works where words do not."),
        (0, "First proper look. Teaser is all hip flexor, no abdominal at all. "
            "Knee history means nothing loaded in deep flexion for now."),
    ],
    "lee.joonho": [
        (10, "Shoulders stayed down through the whole arm series for the first "
             "time. Whatever we changed three weeks ago, keep doing it."),
        (8, "He can feel the difference himself now, which matters more than "
            "whether I can see it."),
        (6, "Tried the imagery cue — “melt the shoulder blades into your back "
            "pockets” — instead of naming muscles, and it landed immediately."),
        (4, "Serratus is finally showing up in quadruped. Traps still win the "
            "moment anything gets heavy."),
        (3, "Hands-on at the lower ribs works where words do not."),
        (0, "Traps do everything. Serratus needs to be taught before anything "
            "loaded goes near him."),
    ],
    "han.doyun": [
        (11, "Full class, no symptoms, no modifications. First time since June."),
        (10, "Cleared by his GP — nothing structural. Back to full range, "
             "watching it for a month."),
        (8, "Nothing this week. Keeping everything in neutral until the "
            "clinic has seen him."),
        (6, "Symptom outlasted the class again — stopped there and sent him "
            "off. Nothing loaded until somebody qualified has looked at it. "
            "This is not mine to manage."),
        (5, "Second week of pins and needles, same distribution. Modified "
            "everything in flexion and told him to book an appointment."),
        (2, "Mentioned tingling in the back of the left thigh after class. "
            "Nothing during. Watching it."),
        (0, "Blood pressure flag on file, cleared to train. Hinges at one "
            "segment rather than articulating — that is the whole programme."),
    ],
    "choi.seoyeon": [
        (10, "Left glute finally firing without the cue. Knee tracking looks "
             "after itself once that happens."),
        (7, "Never screened — chased her about it again. Nothing loaded until "
            "she fills it in."),
        (4, "Single-leg work rather than cueing it in bilateral — much better. "
            "She cannot find it on the left while the right is available."),
        (0, "TFL doing the whole job. Everything else follows from that."),
    ],
    "jung.haeun": [
        (9, "Second trimester. Everything supine is off; side-lying and "
            "standing only from here."),
        (7, "Stopped over-gripping once we stopped talking about the core at "
            "all. Cued the breath and the rest arrived on its own."),
        (1, "Holds her breath the moment she concentrates. Everything else is "
            "downstream of that."),
    ],
    "shin.yerin": [
        (9, "Thoracic is opening. Rhomboids still quiet — traps take it the "
            "moment she stops thinking about it."),
        (2, "Moves as a block from T4 down. Nothing wrong with her, that is "
            "just a desk."),
    ],
    "moon.jaehyun": [
        (9, "Range is coming, slowly. Not forcing it — the hamstrings genuinely "
            "are not long enough yet and no amount of cueing changes that."),
        (2, "Toes grip the footbar on everything. Start there."),
    ],
    "song.arin": [
        (8, "Glutes are leading the bridge now rather than the hamstrings. "
            "Took six weeks and it happened in one class."),
        (1, "Quads never switch off between reps. Everything else is fine."),
    ],
    "yang.dowon": [
        (9, "Still asymmetric, still fine. Noting it every time so nobody "
            "later mistakes it for something that appeared."),
        (4, "The shoulder difference is structural, not a fault. Right sits "
            "higher and always has. Leaving it alone and writing it down."),
    ],
}

#: How many weeks of readings the fixture writes. Twelve because the question
#: this fixture exists to answer is what it looks like after a term of classes,
#: and twelve weeks is a term.
WEEKS = 12


def _write_readings(store, handles, into: str = "") -> int:
    """Twelve weeks of a coach actually using the thing.

    Written by whichever coach has that student on their roster, on a weekly
    cadence ending last week, so the dates read like a term rather than like a
    fixture written in one afternoon.
    """
    from .structure_eval import StructureEval

    coach_of = {student: coach for coach, students in ROSTERS.items()
                for student in students}
    names = {p.handle: p.name for p in PEOPLE}
    written = 0
    for handle, arcs in ARCS.items():
        if handle not in handles:
            continue
        coach = coach_of.get(handle)
        by = names.get(coach, "The studio")
        prose = dict(PROSE.get(handle, []))
        for week in range(WEEKS):
            when = date.today() - timedelta(weeks=WEEKS - week)
            checks_by_structure: dict = {}
            for structure, kind, check, verdicts, note in arcs:
                verdict = verdicts[week] if week < len(verdicts) else ""
                if not verdict:
                    continue
                key = (structure, kind)
                checks_by_structure.setdefault(key, []).append({
                    "label": check, "verdict": verdict,
                    # The note explains the finding, so it belongs on the
                    # classes where there is one -- not on the weeks it is fine.
                    "note": note if verdict != "fine" else ""})
            # The week's prose goes on one structure, not repeated onto every
            # one the coach happened to look at that day.
            said = prose.get(week, "")
            for (structure, kind), checks in checks_by_structure.items():
                store.evaluate_structure(StructureEval(
                    username=handles[handle], by=by, structure=structure,
                    kind=kind, note=said, checks=checks, made_on=str(when),
                    made_at=f"{when}T09:00:00+00:00"))
                said = ""
                written += 1
    return written


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
              "  4. As a coach, open My students → Everyone here. Oh Se-ah is",
              "     on nobody's roster; Add all puts the lot on yours at once.",
              "  5. Sign in as kim.minji@example.com — twelve weeks of",
              "     measurements, a knee flag and an overdue goal.",
              "  6. Sign in as seo.jiwoo@example.com — two roles at once; the",
              "     switcher in the header changes the room.",
              ""]
    return "\n".join(lines)
