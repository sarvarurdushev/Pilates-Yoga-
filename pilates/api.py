"""The role-scoped half of the server.

Kept apart from :mod:`pilates.serve` on purpose. That module knows about
sockets, cookies and files; this one knows only about a signed-in person and
what they may ask for. Every function here takes the store and a
:class:`~pilates.accounts.Viewer` -- the one acting membership -- and returns
``(status, payload)``.

The rule the whole thing is built on, stated once more because it is the thing
that must not rot: **being at the same studio is not permission.** A coach may
open a student's record when there is a live assignment the student accepted,
and not otherwise. Admin is the exception, and every exception it takes is
written to the audit log.
"""
from __future__ import annotations

from .accounts import (ACTIVE, ADMIN, COACH, PARQ, PENDING, REQUESTABLE, ROLES,
                       SCOPES, STUDENT, Profile, Screening, Viewer,
                       may_read_measurements, may_write_about, today,
                       visible_person)
from .onboarding import (accept_coach, approve, ask_to_coach, grant, invite,
                         pending, sign_up)


def enforced(store) -> bool:
    """Whether this database has accounts on it at all.

    The compatibility rule, and it is deliberate: a studio that has never
    created an account keeps the behaviour it had -- the pipeline, the record,
    the coach button, guarded by the passcode if it set one. The moment the
    first account exists, permission is enforced everywhere, because a
    half-enforced system is one where somebody believes they are protected and
    is not.
    """
    return bool(store.db.execute(
        "SELECT 1 FROM accounts LIMIT 1").fetchone())


def guard_subject(store, viewer, username: str, write: bool = False) -> None:
    """Refuse a read or a write about somebody the viewer has no claim on.

    Applied to the routes that existed before accounts did -- the recordings
    list, a bundle, the coach sheet, a note -- because those are the routes that
    actually carry the data, and a permission system that guards only its own
    new endpoints is decoration.
    """
    if not enforced(store):
        return
    person = _need(viewer)
    assignment = (None if person.is_self(username)
                  else store.assignment_between(person.username, username,
                                                person.studio))
    allowed = (may_write_about(person, username, assignment) if write
               else may_read_measurements(person, username, assignment))
    if not allowed:
        raise Refused(
            "you do not have this student's permission" if not write
            else "you are not this student's coach", 403)
    if not person.is_self(username):
        store.record_audit(actor=person.username,
                           action="record:wrote" if write else "record:read",
                           subject=username, studio=person.studio,
                           detail=person.role)


def visible_usernames(store, viewer) -> set | None:
    """Whose recordings this viewer may see, or None for "everyone"."""
    if not enforced(store):
        return None
    person = _need(viewer)
    if person.can_administer:
        return None
    mine = {person.username}
    if person.role == COACH:
        mine |= {a.student for a in store.assignments(coach=person.username,
                                                      studio=person.studio)
                 if a.live}
    return mine


class Refused(Exception):
    """A refusal with a status on it, so the reason travels to the page."""

    def __init__(self, message: str, status: int = 403):
        super().__init__(message)
        self.status = status


def _need(viewer: Viewer | None) -> Viewer:
    if viewer is None:
        raise Refused("sign in first", 401)
    return viewer


def _need_admin(viewer: Viewer | None) -> Viewer:
    person = _need(viewer)
    if not person.can_administer:
        raise Refused("only an admin can do that", 403)
    return person


def _need_coach(viewer: Viewer | None) -> Viewer:
    person = _need(viewer)
    if not person.can_coach:
        raise Refused("only a coach can do that", 403)
    return person


# -- who am I ---------------------------------------------------------------

def me(store, viewer: Viewer | None) -> dict:
    """Everything the interface needs to decide which room to draw.

    Answered for a signed-out visitor too, with ``signed_in: false`` and the
    studios they could join -- because the sign-up form needs that list and
    making it a second request just to be tidy is a slower first paint.
    """
    if viewer is None:
        return {"signed_in": False, "accounts": enforced(store),
                "studios": store.studios(),
                "roles": {r: ROLES[r] for r in REQUESTABLE},
                "parq": PARQ}

    account = store.account(viewer.username)
    memberships = [m.to_dict() for m in store.memberships(username=viewer.username)
                   if m.state == ACTIVE]
    profile = store.profile(viewer.username)
    screening = store.screening(viewer.username)
    coaches = [a.to_dict() for a in store.assignments(student=viewer.username)]
    return {
        "signed_in": True,
        "accounts": True,
        "acting": {"username": viewer.username, "studio": viewer.studio,
                   "role": viewer.role},
        "account": account.to_dict() if account else {},
        "memberships": memberships,
        "profile": profile.to_dict() if profile else None,
        "screening": screening.to_dict() if screening else None,
        "my_coaches": coaches,
        "studios": store.studios(),
        "parq": PARQ,
        "scopes": SCOPES,
        # What the page is allowed to draw. Sent rather than inferred from the
        # role name, so that adding a permission is one change and not two.
        "can": {
            "administer": viewer.can_administer,
            "coach": viewer.can_coach,
            "record": True,
        },
    }


# -- my own record ----------------------------------------------------------

def put_profile(store, viewer: Viewer | None, payload: dict) -> dict:
    person = _need(viewer)
    who = payload.get("username") or person.username
    if who != person.username and not person.can_administer:
        raise Refused("that is not your profile", 403)
    profile = Profile(
        username=who, born=payload.get("born", ""),
        height_m=_number(payload.get("height_m")),
        mass_kg=_number(payload.get("mass_kg")),
        emergency_name=payload.get("emergency_name", ""),
        emergency_phone=payload.get("emergency_phone", ""),
        goals=payload.get("goals", ""))
    store.put_profile(profile)
    store.record_audit(actor=person.username, action="profile:updated",
                       subject=who, studio=person.studio)
    return profile.to_dict()


def put_screening(store, viewer: Viewer | None, payload: dict) -> dict:
    """The PAR-Q, which is a gate rather than a form.

    Only the person themselves or an admin. A coach must never be able to
    answer a health questionnaire on somebody's behalf -- the value of the thing
    is entirely that the person answered it.
    """
    person = _need(viewer)
    who = payload.get("username") or person.username
    if who != person.username and not person.can_administer:
        raise Refused("only you can answer your own health questions", 403)
    answers = {k: bool(v) for k, v in (payload.get("answers") or {}).items()}
    screening = Screening(
        username=who, answers=answers,
        conditions=payload.get("conditions", ""),
        medications=payload.get("medications", ""),
        injuries=payload.get("injuries", ""),
        pregnant=bool(payload.get("pregnant")),
        cleared_by_physician=bool(payload.get("cleared_by_physician")),
        completed_on=today() if set(answers) == set(PARQ) else "")
    store.put_screening(screening)
    store.record_audit(actor=person.username, action="screening:updated",
                       subject=who, studio=person.studio)
    return screening.to_dict()


# -- the coach's side -------------------------------------------------------

def directory(store, viewer: Viewer | None) -> dict:
    """Everybody at this studio, names and nothing else.

    A phone book, not a record. It is what a coach searches to find somebody to
    ask, and it is deliberately the least this can be: a directory that leaked
    ages and phone numbers would make the assignment step decorative.
    """
    person = _need_coach(viewer)
    mine = {a.student: a for a in store.assignments(coach=person.username,
                                                    studio=person.studio)}
    rows = []
    for membership in store.memberships(studio=person.studio, role=STUDENT,
                                        state=ACTIVE):
        account = store.account(membership.username)
        if account is None or membership.username == person.username:
            continue
        assignment = mine.get(membership.username)
        rows.append({"username": account.username,
                     "display_name": account.display_name,
                     "state": assignment.state if assignment else "",
                     "mine": bool(assignment and assignment.live)})
    return {"studio": person.studio, "people": sorted(
        rows, key=lambda r: r["display_name"].lower())}


def roster(store, viewer: Viewer | None) -> dict:
    """Who this coach is actually responsible for, and what to read first.

    Ordered by what needs attention rather than alphabetically: an unscreened
    student and a goal past its review date are the two things that should not
    be found by scrolling.
    """
    person = _need_coach(viewer)
    if person.can_administer:
        live = [a for a in store.assignments(studio=person.studio) if a.live]
    else:
        live = [a for a in store.assignments(coach=person.username,
                                             studio=person.studio) if a.live]
    rows = []
    for assignment in live:
        account = store.account(assignment.student)
        if account is None:
            continue
        seen = visible_person(account, store.profile(assignment.student),
                              store.screening(assignment.student), person,
                              assignment)
        sheet = store.coach_sheet(assignment.student)
        # A student with no screening row at all has answered nothing, and that
        # is the loudest thing on this list rather than the quietest: an empty
        # flags array reads as "nothing to worry about", which is the opposite
        # of what never having been asked means.
        flags = (seen.get("screening") or {}).get("flags") or ["not screened yet"]
        due = sheet.due(on=today())
        seen["flags"] = flags
        seen["goals_due"] = [g.text for g in due]
        seen["sessions"] = len({r["key"] for r in store.recordings()
                                if r.get("username") == assignment.student})
        seen["urgent"] = bool(sheet.urgent) or "not screened yet" in flags
        seen["since"] = assignment.since
        rows.append(seen)
    rows.sort(key=lambda r: (not r["urgent"], not r["goals_due"],
                             r["display_name"].lower()))
    return {"studio": person.studio, "students": rows,
            "as_admin": person.can_administer}


def add_student(store, viewer: Viewer | None, payload: dict) -> dict:
    """A coach asking; or an admin deciding.

    A coach's add is a *request*: pending until the student says yes, and until
    then the coach can see the name they already saw in the directory and
    nothing more. An admin's add is an assignment, and the student is told
    rather than asked -- a studio putting a client with an instructor is a real
    thing, and pretending otherwise would just push it outside the system.
    """
    person = _need_coach(viewer)
    student = payload.get("student", "")
    coach = payload.get("coach") or person.username
    if coach != person.username and not person.can_administer:
        raise Refused("you can only add students to your own roster", 403)
    if store.account(student) is None:
        raise Refused(f"nobody here is called {student!r}", 404)
    if person.can_administer:
        assignment = accept_coach(store, coach, student, person.studio,
                                  by=person.username)
    else:
        assignment = ask_to_coach(store, coach, student, person.studio,
                                  by=person.username)
    return assignment.to_dict()


def answer_request(store, viewer: Viewer | None, payload: dict) -> dict:
    """The student saying yes or no. This, and only this, is consent."""
    person = _need(viewer)
    coach = payload.get("coach", "")
    found = store.assignment_between(coach, person.username, person.studio)
    if found is None:
        raise Refused("there is no request from that coach", 404)
    if payload.get("accept"):
        scopes = tuple(payload.get("scopes") or ())
        assignment = accept_coach(store, coach, person.username, person.studio,
                                  by=person.username, scopes=scopes)
        return assignment.to_dict()
    store.end_assignment(coach, person.username, person.studio,
                         by=person.username)
    return {"coach": coach, "student": person.username, "live": False}


def end_assignment(store, viewer: Viewer | None, payload: dict) -> dict:
    """Either side can end it, and an admin can end anybody's.

    The notes stay. They are the studio's record of care and the research on
    clinical notes is unambiguous that they are kept -- but no new measurement
    is readable from the moment consent ends.
    """
    person = _need(viewer)
    coach = payload.get("coach", "")
    student = payload.get("student", "")
    if not person.can_administer and person.username not in (coach, student):
        raise Refused("that is not yours to end", 403)
    store.end_assignment(coach, student, person.studio, by=person.username)
    return {"coach": coach, "student": student, "live": False}


def student_record(store, viewer: Viewer | None, username: str) -> dict:
    """One person, as much of them as the viewer is allowed.

    Every read of somebody else's record is written to the audit log. That is
    the only way "who saw my health record" has an answer, and it is the reason
    a coach can be trusted with the flags at all.
    """
    person = _need(viewer)
    account = store.account(username)
    if account is None:
        raise Refused(f"nobody here is called {username!r}", 404)
    assignment = (None if person.is_self(username)
                  else store.assignment_between(person.username, username,
                                                person.studio))
    if not may_read_measurements(person, username, assignment):
        raise Refused("you do not have this student's permission", 403)
    if not person.is_self(username):
        store.record_audit(actor=person.username, action="record:read",
                           subject=username, studio=person.studio,
                           detail=person.role)
    seen = visible_person(account, store.profile(username),
                          store.screening(username), person, assignment)
    seen["sheet"] = store.coach_sheet(username).to_dict()
    seen["recordings"] = [r for r in store.recordings()
                          if r.get("username") == username]
    seen["may_write"] = may_write_about(person, username, assignment)
    return seen


# -- the admin's side -------------------------------------------------------

def waiting(store, viewer: Viewer | None) -> dict:
    admin = _need_admin(viewer)
    return {"pending": pending(store, studio=admin.studio)}


def decide(store, viewer: Viewer | None, payload: dict) -> dict:
    """Approve, suspend or end a role. The only way a role changes hands."""
    admin = _need_admin(viewer)
    username = payload.get("username", "")
    role = payload.get("role", "")
    state = payload.get("state", ACTIVE)
    studio = payload.get("studio") or admin.studio
    if state == ACTIVE:
        membership = approve(store, username, studio, role, by=admin.username)
    else:
        store.decide_membership(username, studio, role, state,
                                by=admin.username)
        membership = [m for m in store.memberships(username=username,
                                                   studio=studio, role=role)][0]
    return membership.to_dict()


def give_role(store, viewer: Viewer | None, payload: dict) -> dict:
    """Grant a role nobody asked for -- including admin.

    The highest-blast-radius action in the system, and it is one call with one
    audit line rather than a settings page with a save button, because it should
    read as a deliberate act in the log afterwards.
    """
    admin = _need_admin(viewer)
    membership = grant(store, payload.get("username", ""),
                       payload.get("studio") or admin.studio,
                       payload.get("role", ""), by=admin.username)
    return membership.to_dict()


def make_invitation(store, viewer: Viewer | None, payload: dict) -> dict:
    """The preferred way to create staff: role scoped in the same act."""
    admin = _need_admin(viewer)
    token = invite(store, payload.get("email", ""),
                   payload.get("studio") or admin.studio,
                   payload.get("role", COACH), by=admin.username)
    return {"token": token,
            "note": "send this link to them; it is not stored and cannot be "
                    "looked up again."}


def everybody(store, viewer: Viewer | None) -> dict:
    """The admin's list. Everything held about everyone, which is what admin
    means and why every read of it is logged."""
    admin = _need_admin(viewer)
    rows = []
    for account in store.accounts():
        rows.append({
            **visible_person(account, store.profile(account.username),
                             store.screening(account.username), admin),
            "memberships": [m.to_dict() for m in
                            store.memberships(username=account.username)],
        })
    store.record_audit(actor=admin.username, action="directory:read",
                       studio=admin.studio, detail=f"{len(rows)} people")
    return {"people": rows, "studios": store.studios()}


def audit_log(store, viewer: Viewer | None, subject: str = "") -> dict:
    """An admin sees everything; anybody else sees their own record's log.

    A student being able to read who opened their file is not a nice extra --
    it is the thing that makes the promise checkable.
    """
    person = _need(viewer)
    if person.can_administer:
        return {"events": store.audit(subject=subject or "")}
    if subject and subject != person.username:
        raise Refused("that is not your log", 403)
    return {"events": store.audit(subject=person.username)}


# -- helpers ----------------------------------------------------------------

def _number(value):
    if value in (None, "", False):
        return None
    try:
        return float(value)
    except (TypeError, ValueError) as exc:
        raise Refused(f"{value!r} is not a number", 400) from exc


def register(store, payload: dict) -> dict:
    """Signing up. Declares an intent; grants nothing but a student role."""
    welcome = sign_up(
        store,
        email=payload.get("email", ""),
        display_name=payload.get("display_name", ""),
        password=payload.get("password", ""),
        studio=payload.get("studio", ""),
        wants=payload.get("wants", STUDENT),
        phone=payload.get("phone", ""),
        profile={k: v for k, v in {
            "born": payload.get("born", ""),
            "height_m": _number(payload.get("height_m")),
            "mass_kg": _number(payload.get("mass_kg")),
        }.items() if v not in (None, "")} or None,
    )
    return welcome.to_dict()
