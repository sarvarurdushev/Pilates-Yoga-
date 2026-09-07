"""Who is who, where, and what they may see.

The measurement half of this system knows about bodies and nothing about
permission. This is the other half. The design is written out in
``docs/accounts.md``; what follows is the same thing as code, and the one
sentence worth repeating here is the decision everything else falls out of:

**A role belongs to a membership, not to a person.**

``accounts.role = 'coach'`` is the instinct and it is wrong. It breaks on the
first real case, which happens to be the first case this studio has: one person
who must be admin, coach *and* student. With the role on the account that is
three logins and three sets of measurements belonging to a stranger. With the
role on the membership it is one account, three memberships, and one body of
work seen from three sides.

Everything here is therefore scoped to a studio. There is no global anything.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, datetime, timezone

# -- roles -------------------------------------------------------------------

ADMIN = "admin"
COACH = "coach"
STUDENT = "student"

#: In order of reach. A person with several memberships acts as the one they
#: have selected, not as the strongest they hold -- an admin looking at their own
#: progress is a student while they do it.
ROLES = {
    ADMIN: "runs the studio: people, roles, studios and the record",
    COACH: "teaches: sees assigned students, writes feedback and goals",
    STUDENT: "attends: sees their own body, progress and feedback",
}

#: What a signup form is allowed to ask for. Admin is deliberately absent: it is
#: never requestable, only granted by an existing admin, and the first one is
#: made from the command line. A role dropdown that offers admin is a dropdown
#: somebody will choose admin from.
REQUESTABLE = (STUDENT, COACH)

#: A student who has just signed up can see exactly one record -- their own --
#: so making them wait for approval protects nothing and annoys everybody. A
#: coach waits, because an approved coach can read other people's health data.
AUTO_APPROVED = (STUDENT,)

# -- membership states -------------------------------------------------------

PENDING = "pending"
ACTIVE = "active"
SUSPENDED = "suspended"
LEFT = "left"

STATES = {
    PENDING: "asked for this role; an admin has not decided yet",
    ACTIVE: "in good standing",
    SUSPENDED: "switched off by an admin, history kept",
    LEFT: "no longer at this studio, history kept",
}

#: Only one of them can do anything at all.
def usable(state: str) -> bool:
    return state == ACTIVE


# -- consent -----------------------------------------------------------------

#: What a student can let a coach see, separately. Coarse on purpose: a consent
#: screen with twenty switches is a consent screen nobody reads.
SEE_MEASUREMENTS = "measurements"
SEE_FLAGS = "screening_flags"
SEE_CONTACT = "contact"

SCOPES = {
    SEE_MEASUREMENTS: "your measurements, charts and history",
    SEE_FLAGS: "the safety flags from your health screening",
    SEE_CONTACT: "your phone number and emergency contact",
}

#: What accepting a coach grants unless the student narrows it. Flags are in
#: here because a coach who does not know about the knee is the risk this whole
#: layer exists to prevent.
DEFAULT_SCOPES = (SEE_MEASUREMENTS, SEE_FLAGS, SEE_CONTACT)


# -- validation --------------------------------------------------------------

EMAIL = re.compile(r"^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$")
#: E.164. Stored normalised so that "+998 90 123 45 67" and "+998901234567" are
#: one person rather than two -- which is the whole reason the studio asked for a
#: phone number in the first place.
PHONE = re.compile(r"^\+[1-9]\d{6,14}$")

MAX_NAME = 80
MAX_TEXT = 400


def normalise_email(text: str) -> str:
    """Lower-cased and trimmed. Not de-dotted: ``a.b@gmail.com`` is the same
    inbox as ``ab@gmail.com`` at one provider and a different person at most
    others, and guessing wrong merges two people."""
    return (text or "").strip().lower()


def normalise_phone(text: str) -> str:
    """Everything that is not a digit goes, and a leading ``+`` is kept.

    A number with no country code is refused rather than assumed: assuming is
    how a studio in Tashkent ends up with a Uzbek number filed as American.
    """
    raw = (text or "").strip()
    if not raw:
        return ""
    kept = "".join(c for c in raw if c.isdigit())
    if raw.startswith("00"):
        kept = kept[2:]
    elif raw.startswith("+"):
        pass
    elif kept:
        raise ValueError("a phone number needs its country code, like "
                         "+998901234567")
    return f"+{kept}"


def username_for(email: str) -> str:
    """The key the measurement half already uses, derived from the email.

    One person, one username, one history -- whichever role they are acting in.
    Derived rather than chosen so that it cannot drift from the account.
    """
    local, _, domain = normalise_email(email).partition("@")
    kept = "".join(c if c.isalnum() else "_" for c in f"{local}_{domain}")
    return "_".join(part for part in kept.split("_") if part)[:60]


def today() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def age_on(born: str, when: str = "") -> int | None:
    """Years, computed. A typed age is wrong within twelve months of typing."""
    if not born:
        return None
    try:
        birth = date.fromisoformat(born)
        at = date.fromisoformat(when) if when else date.fromisoformat(today())
    except ValueError:
        return None
    years = at.year - birth.year - ((at.month, at.day) < (birth.month, birth.day))
    return years if 0 <= years < 130 else None


#: Below this a guardian is needed. Flagged rather than handled -- see the note
#: at the end of docs/accounts.md.
ADULT = 18


# -- the records -------------------------------------------------------------

@dataclass
class Studio:
    """One location. Everything is scoped to one of these."""

    key: str
    name: str
    city: str = ""
    country: str = ""
    timezone: str = "UTC"
    created_at: str = field(default_factory=now)

    def __post_init__(self) -> None:
        self.key = (self.key or "").strip().lower()
        if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{1,40}", self.key):
            raise ValueError("a studio key is letters, digits, - and _")
        self.name = (self.name or "").strip()[:MAX_NAME]
        if not self.name:
            raise ValueError("a studio needs a name")

    def to_dict(self) -> dict:
        return {"key": self.key, "name": self.name, "city": self.city,
                "country": self.country, "timezone": self.timezone,
                "created_at": self.created_at}


@dataclass
class Account:
    """One human being. Carries no role -- that is the whole design."""

    email: str
    display_name: str
    phone: str = ""
    password_hash: str = ""
    username: str = ""
    created_at: str = field(default_factory=now)
    active: bool = True

    def __post_init__(self) -> None:
        self.email = normalise_email(self.email)
        if not EMAIL.fullmatch(self.email):
            raise ValueError(f"{self.email!r} is not an email address")
        self.display_name = (self.display_name or "").strip()[:MAX_NAME]
        if not self.display_name:
            raise ValueError("a person needs a name to be called by")
        self.phone = normalise_phone(self.phone)
        if self.phone and not PHONE.fullmatch(self.phone):
            raise ValueError(f"{self.phone!r} is not a phone number")
        self.username = self.username or username_for(self.email)

    def to_dict(self) -> dict:
        """Never carries the hash. There is no caller that needs it and one
        accidental serialisation is a breach."""
        return {"email": self.email, "display_name": self.display_name,
                "phone": self.phone, "username": self.username,
                "created_at": self.created_at, "active": self.active}


@dataclass
class Membership:
    """One person, at one studio, in one role. Where permission lives."""

    username: str
    studio: str
    role: str
    state: str = PENDING
    since: str = field(default_factory=today)
    decided_by: str = ""
    decided_at: str = ""

    def __post_init__(self) -> None:
        if self.role not in ROLES:
            raise ValueError(f"{self.role!r} is not one of {sorted(ROLES)}")
        if self.state not in STATES:
            raise ValueError(f"{self.state!r} is not one of {sorted(STATES)}")

    @property
    def usable(self) -> bool:
        return usable(self.state)

    def to_dict(self) -> dict:
        return {"username": self.username, "studio": self.studio,
                "role": self.role, "state": self.state, "since": self.since,
                "decided_by": self.decided_by, "decided_at": self.decided_at}


@dataclass
class Profile:
    """The facts about a body that the pipeline and the coach both need.

    Height and weight are not vanity fields: a joint moment in newton-metres is
    a mass on a lever, so without them every angle is still measured and no load
    is. Date of birth rather than age, because an age typed in 2026 is wrong in
    2027.
    """

    username: str
    born: str = ""
    height_m: float | None = None
    mass_kg: float | None = None
    emergency_name: str = ""
    emergency_phone: str = ""
    goals: str = ""
    updated_at: str = field(default_factory=now)

    def __post_init__(self) -> None:
        if self.born:
            try:
                date.fromisoformat(self.born)
            except ValueError as exc:
                raise ValueError("a date of birth looks like 1994-05-02") from exc
        for name, value, low, high in (("height", self.height_m, 0.5, 2.6),
                                       ("weight", self.mass_kg, 20.0, 400.0)):
            if value is not None and not low <= float(value) <= high:
                raise ValueError(f"{value} is not a plausible {name}")
        self.emergency_phone = normalise_phone(self.emergency_phone)
        self.goals = (self.goals or "").strip()[:MAX_TEXT]

    @property
    def age(self) -> int | None:
        return age_on(self.born)

    @property
    def minor(self) -> bool:
        years = self.age
        return years is not None and years < ADULT

    def to_dict(self) -> dict:
        return {"username": self.username, "born": self.born, "age": self.age,
                "minor": self.minor, "height_m": self.height_m,
                "mass_kg": self.mass_kg,
                "emergency_name": self.emergency_name,
                "emergency_phone": self.emergency_phone, "goals": self.goals,
                "updated_at": self.updated_at}


#: The PAR-Q+, which is the industry standard for pre-exercise screening and
#: the reason a studio can put somebody through a teaser without guessing. Seven
#: yes/no questions; any yes means a conversation, and possibly a doctor, before
#: the first class.
PARQ = {
    "heart": "Has a doctor ever said you have a heart condition, or high blood "
             "pressure?",
    "chest_pain": "Do you feel pain in your chest at rest, during daily "
                  "activity, or when you exercise?",
    "dizziness": "Do you lose balance from dizziness, or have you lost "
                 "consciousness in the last 12 months?",
    "chronic": "Do you have a diagnosed chronic condition other than heart "
               "disease or high blood pressure?",
    "medication": "Are you taking prescribed medication for a chronic "
                  "condition?",
    "joint": "Do you have a bone, joint or soft-tissue problem that could be "
             "made worse by exercise?",
    "advice": "Has a doctor ever said you should only exercise under medical "
              "supervision?",
}


@dataclass
class Screening:
    """Health, kept apart from everything else so it can be guarded on its own.

    A coach is shown the flags -- *left knee, no deep flexion*, *cleared by
    physician* -- and never the record. That is the difference between what a
    class needs and what a doctor keeps.
    """

    username: str
    answers: dict = field(default_factory=dict)
    conditions: str = ""
    medications: str = ""
    injuries: str = ""
    pregnant: bool = False
    cleared_by_physician: bool = False
    completed_on: str = ""
    updated_at: str = field(default_factory=now)

    def __post_init__(self) -> None:
        unknown = set(self.answers) - set(PARQ)
        if unknown:
            raise ValueError(f"not PAR-Q questions: {sorted(unknown)}")
        self.answers = {k: bool(v) for k, v in self.answers.items()}
        for name in ("conditions", "medications", "injuries"):
            setattr(self, name, (getattr(self, name) or "").strip()[:MAX_TEXT])

    @property
    def complete(self) -> bool:
        return bool(self.completed_on) and set(self.answers) == set(PARQ)

    @property
    def any_yes(self) -> bool:
        return any(self.answers.values())

    @property
    def needs_clearance(self) -> bool:
        """A yes anywhere means a doctor should say yes before a first class."""
        return self.any_yes and not self.cleared_by_physician

    def flags(self) -> list[str]:
        """What a coach is shown: what to be careful of, and nothing else.

        Never the diagnosis, never the medication list. A coach needs to know
        there is a knee; the name of the operation is not theirs to hold.
        """
        out = []
        if not self.complete:
            out.append("not screened yet")
            return out
        if self.needs_clearance:
            out.append("needs a doctor's clearance")
        elif self.any_yes:
            out.append("cleared by a doctor")
        if self.answers.get("joint"):
            out.append("a joint or soft-tissue problem")
        if self.answers.get("heart") or self.answers.get("chest_pain"):
            out.append("a heart or blood-pressure condition")
        if self.answers.get("dizziness"):
            out.append("dizziness or fainting")
        if self.answers.get("advice"):
            out.append("exercise only under medical supervision")
        if self.pregnant:
            out.append("pregnant")
        if self.injuries:
            out.append(self.injuries[:120])
        return out or ["nothing flagged"]

    def to_dict(self) -> dict:
        return {"username": self.username, "answers": dict(self.answers),
                "conditions": self.conditions, "medications": self.medications,
                "injuries": self.injuries, "pregnant": self.pregnant,
                "cleared_by_physician": self.cleared_by_physician,
                "completed_on": self.completed_on, "complete": self.complete,
                "needs_clearance": self.needs_clearance,
                "flags": self.flags(), "updated_at": self.updated_at}


@dataclass
class Assignment:
    """A coach and a student, at a studio, between two dates.

    Being in the same building is not a relationship, and it is not permission.
    This is. It carries dates so that *who was coaching them in March* is
    answerable a year later.
    """

    coach: str
    student: str
    studio: str
    state: str = PENDING
    scopes: tuple = DEFAULT_SCOPES
    since: str = field(default_factory=today)
    until: str = ""
    asked_by: str = ""

    def __post_init__(self) -> None:
        if self.coach == self.student:
            raise ValueError("a coach cannot be assigned to themselves")
        if self.state not in (PENDING, ACTIVE, LEFT):
            raise ValueError(f"{self.state!r} is not a state an assignment has")
        unknown = set(self.scopes) - set(SCOPES)
        if unknown:
            raise ValueError(f"not consent scopes: {sorted(unknown)}")
        self.scopes = tuple(dict.fromkeys(self.scopes))

    @property
    def live(self) -> bool:
        return self.state == ACTIVE and not self.until

    def allows(self, scope: str) -> bool:
        return self.live and scope in self.scopes

    def to_dict(self) -> dict:
        return {"coach": self.coach, "student": self.student,
                "studio": self.studio, "state": self.state,
                "scopes": list(self.scopes), "since": self.since,
                "until": self.until, "asked_by": self.asked_by,
                "live": self.live}


# -- what a viewer is allowed to see ----------------------------------------

@dataclass(frozen=True)
class Viewer:
    """The one acting membership a request is being made under.

    Not "the strongest role this person holds". An admin looking at their own
    progress is a student while they do it, and the interface they get is the
    student's -- which is also how a studio owner finds out what their students
    actually see.
    """

    username: str
    studio: str
    role: str
    state: str = ACTIVE

    @property
    def can_administer(self) -> bool:
        return self.role == ADMIN and usable(self.state)

    @property
    def can_coach(self) -> bool:
        return self.role in (ADMIN, COACH) and usable(self.state)

    def is_self(self, username: str) -> bool:
        return self.username == username


def visible_person(account: Account, profile: Profile | None,
                   screening: Screening | None, viewer: Viewer,
                   assignment: Assignment | None = None) -> dict:
    """One person, redacted for whoever is looking.

    Three answers from one function, because the alternative is three functions
    that drift and one of them eventually returns a medication list to a coach.

    * **Themselves and an admin** get everything held.
    * **A coach** gets what a class needs -- name, age, height, weight, safety
      flags, and contact if the student allowed it. Never the date of birth,
      never the conditions, never the medications.
    * **Anyone else** gets a name, which is what a directory is.
    """
    mine = viewer.is_self(account.username)
    full = mine or viewer.can_administer
    coached = bool(assignment and assignment.live) and viewer.can_coach

    out = {"username": account.username, "display_name": account.display_name}
    if not (full or coached):
        return out

    out["email"] = account.email
    if full or (assignment and assignment.allows(SEE_CONTACT)):
        out["phone"] = account.phone
        if profile:
            out["emergency_name"] = profile.emergency_name
            out["emergency_phone"] = profile.emergency_phone

    if profile:
        out["age"] = profile.age
        out["minor"] = profile.minor
        out["height_m"] = profile.height_m
        out["mass_kg"] = profile.mass_kg
        out["goals"] = profile.goals
        if full:
            out["born"] = profile.born

    if screening:
        if full:
            out["screening"] = screening.to_dict()
        elif assignment and assignment.allows(SEE_FLAGS):
            # Flags only. A coach needs to know there is a knee; the name of
            # the operation is not theirs to hold.
            out["screening"] = {"flags": screening.flags(),
                                "complete": screening.complete,
                                "needs_clearance": screening.needs_clearance}
    out["seen_as"] = "self" if mine else "admin" if full else "coach"
    return out


def may_read_measurements(viewer: Viewer, subject: str,
                          assignment: Assignment | None) -> bool:
    """The rule the whole privacy design comes down to.

    Same building is not permission. A studio with two coaches is the first
    place the naive rule leaks, and health data is the worst thing to leak.
    """
    if viewer.is_self(subject):
        return True
    if viewer.can_administer:
        return True
    if viewer.role == COACH and assignment is not None:
        return assignment.allows(SEE_MEASUREMENTS) and assignment.coach == viewer.username
    return False


def may_write_about(viewer: Viewer, subject: str,
                    assignment: Assignment | None) -> bool:
    """Who may write a cue, a contraindication or a goal onto somebody.

    Not the student themselves: an observation's whole authority is that a
    coach said it, on a date. A student's own account of how it felt is a
    *subjective* note, which the coach records -- the tier is called ``observed``
    for a reason.
    """
    if viewer.can_administer:
        return True
    if viewer.role == COACH and assignment is not None:
        return assignment.live and assignment.coach == viewer.username
    return False
