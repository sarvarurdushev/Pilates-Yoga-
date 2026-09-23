"""The role-scoped half of the server.

Kept apart from :mod:`pilates.serve` on purpose. That module knows about
sockets, cookies and files; this one knows only about a signed-in person and
what they may ask for. Every function here takes the store and a
:class:`~pilates.accounts.Viewer` -- the one acting membership -- and returns
``(status, payload)``.

The rule the whole thing is built on, stated once more because it is the thing
that must not rot: **being at the same studio is not permission -- being on
somebody's roster is.** A coach may open a student's record when there is a live
assignment between them, and not otherwise. Admin is the exception, and every
exception it takes is written to the audit log.

Making that assignment is one press and takes effect at once. It used to need
the student to accept, and that was a misreading of what this is: a studio
assigns coaches, and joining the studio was the consent. The student's control
comes after and is the stronger half -- they see who can open their record,
revoke any of them in a click, and read every time it was opened.
"""
from __future__ import annotations

import os
from .accounts import (ACTIVE, ADMIN, COACH, PARQ, PENDING, REQUESTABLE, ROLES,
                       SCOPES, STUDENT, Profile, Screening, Viewer,
                       may_read_measurements, may_write_about, today,
                       visible_person)
from .onboarding import (approve, assign, grant, invite,
                         pending, sign_up)


def unclaimed(store) -> bool:
    """Whether this database has nobody who can sign in to it yet.

    It used to be that such a database kept its old, unguarded behaviour, and
    that was a hole rather than a compatibility rule: the way to read every
    health record in a studio was to find one that had not got round to making
    an account. Nothing is served on that basis any more. An empty database
    offers one thing -- :func:`set_up`, which makes the first admin -- and
    everything else needs somebody to be signed in.
    """
    return not store.db.execute("SELECT 1 FROM accounts LIMIT 1").fetchone()


def guard_subject(store, viewer, username: str, write: bool = False) -> None:
    """Refuse a read or a write about somebody the viewer has no claim on.

    Applied to the routes that existed before accounts did -- the recordings
    list, a bundle, the coach sheet, a note -- because those are the routes that
    actually carry the data, and a permission system that guards only its own
    new endpoints is decoration.
    """
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
    """Whose recordings this viewer may see, or None for "everyone".

    None is only ever an admin. A record left over from before there were
    accounts -- a ``people`` row nobody has claimed -- is therefore visible to
    an admin and to nobody else, which is the right answer: it belongs to
    somebody, and until an account is attached to it there is no way to know
    whether the person asking is them.
    """
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
        # `accounts` is now always true where there is a database at all: the
        # page has to ask somebody who they are before it draws anything of
        # anybody's. `setup` says which screen to draw -- the first admin, or
        # the sign-in.
        return {"signed_in": False, "accounts": True,
                "setup": unclaimed(store),
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
                     "mine": bool(assignment and assignment.live)})
    rows.sort(key=lambda r: r["display_name"].lower())
    return {"studio": person.studio, "people": rows,
            # So the page can say "add the other nine" rather than making
            # somebody count them.
            "not_mine": [r["username"] for r in rows if not r["mine"]]}


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
    # Counted for the whole roster in one query rather than by pulling every
    # recording in the studio back and filtering it in Python once per student,
    # which is what this did: twelve students meant twelve full joins over every
    # session and every measurement in the building.
    sessions = store.session_counts([a.student for a in live])
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
        seen["sessions"] = sessions.get(assignment.student, 0)
        seen["urgent"] = bool(sheet.urgent) or "not screened yet" in flags
        seen["since"] = assignment.since

        # What was written about this person's body, on the roster rather than
        # two clicks inside it. A reading nobody sees on the way into the class
        # is a reading that changes nothing about the class.
        # The two findings worth putting on a roster line, which is not the two
        # most recent. A body with three hundred structures on file has dozens
        # of open findings written on the same day, so "most recent" picks
        # whichever sorted first -- and the coach reads "third plantar
        # interosseous" as the headline for a person with a knee history.
        # Worst first, then longest-running, then alphabetical to settle it.
        standing = standing_readings(store, assignment.student)
        open_now = standing["open_readings"]
        # Two different *structures*. Both checks on one calcaneal tendon is
        # the same failure as two rows about one shoulder: it fills the line
        # and tells the coach one thing.
        flagged, shown = [], set()
        for r in open_now:
            if r["structure"] in shown:
                continue
            shown.add(r["structure"])
            flagged.append(
                f"{r['structure']}: {r['check']} — "
                f"{'a problem' if r['verdict'] == 'problem' else 'worth watching'}")
            if len(flagged) == 2:
                break
        latest = standing["newest"]
        seen["readings"] = standing["readings"]
        seen["open"] = len(open_now)
        seen["focus"] = flagged[0] if flagged else ""
        seen["also"] = flagged[1] if len(flagged) > 1 else ""
        seen["last_read"] = latest[-1]["made_on"] if latest else ""
        seen["note"] = next((one["note"] for one in reversed(latest) if one["note"]), "")
        # A nerve symptom called a problem is the one thing that outranks
        # everything else on this list.
        seen["urgent"] = seen["urgent"] or any(one["urgent"] for one in latest)
        rows.append(seen)
    # Nothing written yet sorts up with the other things that should not be
    # found by scrolling: it is the row where the coach has nothing to go on.
    rows.sort(key=lambda r: (not r["urgent"], not r["goals_due"],
                             bool(r["readings"]), r["display_name"].lower()))
    return {"studio": person.studio, "students": rows,
            "as_admin": person.can_administer}


def add_student(store, viewer: Viewer | None, payload: dict) -> dict:
    """Put one student, or a whole list of them, on a coach's roster. Now.

    Takes ``student`` or ``students``, because "add all of them" is one press
    and one request rather than twenty of each. Names that do not exist are
    reported back rather than failing the lot: a bulk add that refuses
    everything because one row is stale is a bulk add nobody uses twice.
    """
    person = _need_coach(viewer)
    wanted = payload.get("students") or (
        [payload["student"]] if payload.get("student") else [])
    if not wanted:
        raise Refused("which student?", 400)
    coach = payload.get("coach") or person.username
    if coach != person.username and not person.can_administer:
        raise Refused("you can only add students to your own roster", 403)

    added, missing = [], []
    for student in wanted:
        if student == coach or store.account(student) is None:
            missing.append(student)
            continue
        assign(store, coach, student, person.studio, by=person.username)
        added.append(student)
    return {"added": added, "missing": missing, "coach": coach,
            "message": f"{len(added)} on the roster"
                       + (f", {len(missing)} not found" if missing else "")}


def end_assignment(store, viewer: Viewer | None, payload: dict) -> dict:
    """Either side can end it, and an admin can end anybody's.

    This is the half of consent that does the work now that adding is
    immediate: a student who does not want a coach in their record takes them
    out of it in one press, and the coach cannot read a measurement recorded
    after that moment.

    The notes stay. They are the studio's record of care and the research on
    clinical notes is unambiguous that they are kept.
    """
    person = _need(viewer)
    coach = payload.get("coach", "")
    student = payload.get("student", "") or (
        person.username if coach else "")
    if not coach or not student:
        raise Refused("which coach, and which student?", 400)
    if not person.can_administer and person.username not in (coach, student):
        raise Refused("that is not yours to end", 403)
    store.end_assignment(coach, student, person.studio, by=person.username)
    return {"coach": coach, "student": student, "live": False,
            "message": "Removed. Nothing recorded from now on is readable "
                       "by them."}


# -- what the coach scores --------------------------------------------------



def structure_form(store, viewer: Viewer | None, username: str,
                   structure: str, kind: str, fma: str = "",
                   side: str = "") -> dict:
    """The form for one structure, plus everything already written about it.

    The rubric travels with the request rather than living in the page, because
    which questions a structure takes is a fact about anatomy and belongs on the
    same side of the wire as the rest of the anatomy.
    """
    from .structure_eval import KIND_LABEL, form_for, history

    person = _need(viewer)
    who = username or person.username
    guard_subject(store, person, who)
    account = store.account(who)
    mine = person.is_self(who)
    past = history(store.structure_evals(who, structure), private=not mine)
    # Their own wording first. Whatever this coach called things last time is a
    # better suggestion than anything this application could invent.
    shape = form_for(kind, seen=past.get("labels", []))
    if mine:
        # A student looking at their own body gets the drawing and the line the
        # coach wrote for them. Nothing else on the row is theirs to read.
        return {"student": who,
                "display_name": account.display_name if account else who,
                "structure": structure, "kind": kind,
                "kind_label": KIND_LABEL.get(kind, kind), "fma": fma,
                "side": side, "may_write": False, "open": False,
                "why": "", "mine": True, "history": past}
    return {
        "student": who,
        "display_name": account.display_name if account else who,
        "structure": structure,
        "kind": kind,
        "kind_label": KIND_LABEL.get(kind, kind),
        "fma": fma,
        "side": side,
        "may_write": may_write_about(
            person, who,
            None if person.is_self(who)
            else store.assignment_between(person.username, who, person.studio)),
        **shape,
        "mine": False,
        "history": past,
    }


def evaluate_structure(store, viewer: Viewer | None, payload: dict) -> dict:
    """Record a reading of one structure."""
    from .structure_eval import StructureEval, form_for, history

    person = _need_coach(viewer)
    who = payload.get("username", "")
    guard_subject(store, person, who, write=True)
    account = store.account(person.username)
    kind = payload.get("kind", "")
    shape = form_for(kind)
    if not shape["open"]:
        raise Refused(shape["why"], 400)
    try:
        evaluation = StructureEval(
            username=who,
            by=payload.get("by") or (account.display_name if account
                                     else person.username),
            structure=payload.get("structure", ""),
            kind=kind,
            fma=payload.get("fma", ""),
            side=payload.get("side", ""),
            note=payload.get("note", ""),
            shared=payload.get("shared", ""),
            checks=payload.get("checks") or [],
            session=payload.get("session", ""))
    except ValueError as exc:
        raise Refused(str(exc), 400) from exc
    evaluation.id = store.evaluate_structure(evaluation)
    store.record_audit(
        actor=person.username, action="evaluated:structure", subject=who,
        studio=person.studio,
        detail=f"{evaluation.structure}: "
               f"{'; '.join(evaluation.flagged) or 'nothing flagged'}")
    return {"evaluation": evaluation.to_dict(),
            "history": history(store.structure_evals(
                who, evaluation.structure))}


def standing_readings(store, username: str, weeks: int = 6) -> dict:
    """What is still open from the coach's readings, for the pre-class sheet.

    A finding that has come back three classes running is a different thing
    from one written once and never seen again, so this reports the run length
    rather than the last row. Anything whose most recent verdict is ``fine`` is
    finished and does not appear: a sheet that lists everything ever noticed is
    a sheet nobody reads twice.
    """
    latest: dict = {}
    # The newest reading of each structure, kept as it goes past. The caller
    # wants it -- the roster prints the last date, the last note and whether
    # anything in it is urgent -- and asking for it separately meant a second
    # window query over the same table and a second pass building the same
    # objects, per student, every time a coach opened their roster.
    newest: dict = {}
    # The last few of each, not the first few of everything: a flat limit over
    # a body with thousands of readings on file returns the earliest fortnight.
    for one in store.latest_structure_evals(username, per=4):
        newest[one.structure] = one          # ordered oldest-first per structure
        for check in one.checks:
            if not check["verdict"]:
                continue
            key = (one.structure, one.kind, check["label"])
            row = latest.setdefault(key, {"structure": one.structure,
                                          "kind": one.kind,
                                          "check": check["label"],
                                          "runs": [], "note": "", "by": one.by,
                                          "last_on": ""})
            row["runs"].append(check["verdict"])
            row["last_on"] = one.made_on
            row["by"] = one.by
            if check["note"]:
                row["note"] = check["note"]

    open_now, settled = [], []
    for row in latest.values():
        run = row["runs"]
        row["verdict"] = run[-1]
        # How many classes in a row it has been unsettled, counting back.
        streak = 0
        for verdict in reversed(run):
            if verdict == "fine":
                break
            streak += 1
        row["streak"] = streak
        row["seen"] = len(run)
        row.pop("runs")
        (settled if row["verdict"] == "fine" else open_now).append(row)

    open_now.sort(key=lambda r: (r["verdict"] != "problem", -r["streak"],
                                 r["structure"], r["check"]))
    # Something that was a problem and is now fine is worth one line, because
    # "this is fixed" is a thing a coach wants to walk in knowing.
    fixed = [r for r in settled if r["seen"] > 2][:4]
    fixed.sort(key=lambda r: r["last_on"], reverse=True)
    return {"open_readings": open_now[:8], "fixed_readings": fixed,
            "readings": store.count_readings(username),
            # The newest reading of each structure, as plain fields rather than as
            # objects: this dictionary is the `/sheet` response body, so anything in it
            # has to survive `json.dumps`. The roster wants the last date, the last note
            # and whether anything is urgent, and those are all of it.
            "newest": [{"structure": e.structure, "made_on": e.made_on,
                        "made_at": e.made_at, "note": e.note, "urgent": e.urgent}
                       for e in sorted(newest.values(),
                                       key=lambda e: (e.made_on, e.made_at))]}


def structure_history(store, viewer: Viewer | None, username: str,
                      structure: str) -> dict:
    """The coach's readings for one structure, for drawing beside the numbers.

    Deliberately its own route rather than folded into the measurement bundle.
    A measurement and a judgement are different kinds of claim and they are
    fetched separately so that nothing downstream can accidentally treat one as
    the other.
    """
    from .structure_eval import history

    person = _need(viewer)
    who = username or person.username
    guard_subject(store, person, who)
    mine = person.is_self(who)
    return {"student": who, "structure": structure, "mine": mine,
            **history(store.structure_evals(who, structure), private=not mine)}


def structures_seen(store, viewer: Viewer | None, username: str = "") -> dict:
    """Every structure anybody has written about this person, newest first.

    The way back to a note once the panel has been closed. Without it, a reading
    of the left psoas exists only for as long as the left psoas is on screen,
    which is the same bug as a recording with nowhere to appear.
    """
    person = _need(viewer)
    who = username or person.username
    guard_subject(store, person, who)
    mine = person.is_self(who)
    counts = store.count_structure_evals(who)
    seen: dict[str, dict] = {}
    for one in store.latest_structure_evals(who, per=1):
        row = seen.setdefault(one.structure, {
            "structure": one.structure, "kind": one.kind, "fma": one.fma,
            "count": 0, "last_on": "", "flagged": [], "note": "",
            "shared": "", "score": None, "urgent": False})
        row["count"] = counts.get(one.structure, 0)
        row["last_on"] = one.made_on
        row["score"] = one.average if one.average is not None else row["score"]
        if one.shared:
            row["shared"] = one.shared
        # Everything below is the coach's working record. A student reading
        # their own list gets the structure, the date, the score and the line
        # written for them, and nothing else.
        if not mine:
            row["flagged"] = one.flagged
            row["note"] = one.note
            row["urgent"] = row["urgent"] or one.urgent
    rows = sorted(seen.values(),
                  key=lambda r: (not r["urgent"], r["last_on"]), reverse=False)
    rows.sort(key=lambda r: (not r["urgent"], _neg(r["last_on"])))
    return {"student": who, "structures": rows}


def _neg(date: str) -> tuple:
    """Sort a date string descending inside an otherwise ascending key."""
    return tuple(-int(part) for part in date.split("-")) if date else (0,)




def studios(store, viewer: Viewer | None) -> dict:
    """Every studio, with how many people are in it and who runs it."""
    admin = _need_admin(viewer)
    rows = []
    for studio in store.studios():
        held = store.memberships(studio=studio["key"])
        rows.append({**studio,
                     "people": len({m.username for m in held
                                    if m.state == ACTIVE}),
                     "coaches": len({m.username for m in held
                                     if m.role == COACH and m.state == ACTIVE}),
                     "students": len({m.username for m in held
                                      if m.role == STUDENT and m.state == ACTIVE}),
                     "mine": any(m.username == admin.username
                                 and m.role == ADMIN and m.state == ACTIVE
                                 for m in held)})
    return {"studios": rows, "acting": admin.studio}


def put_studio(store, viewer: Viewer | None, payload: dict) -> dict:
    """Make a location, or change one.

    An admin who makes a studio is made its admin in the same act, because a
    studio nobody can administer is a studio somebody has to be given by hand
    afterwards -- and that step is the one everybody forgets.
    """
    from .accounts import Membership, Studio, now

    admin = _need_admin(viewer)
    key = (payload.get("key") or payload.get("name") or "").strip().lower()
    key = "-".join(part for part in
                   "".join(c if c.isalnum() else "-" for c in key).split("-")
                   if part)[:40]
    if not key:
        raise Refused("a studio needs a name", 400)
    existing = store.studio(key)
    studio = Studio(key=key, name=payload.get("name") or key,
                    city=payload.get("city", ""),
                    country=payload.get("country", ""),
                    timezone=payload.get("timezone") or "UTC",
                    created_at=(existing or {}).get("created_at") or now())
    store.add_studio(studio)
    if not existing:
        store.put_membership(Membership(username=admin.username,
                                        studio=key, role=ADMIN, state=ACTIVE,
                                        decided_by=admin.username,
                                        decided_at=now()))
    store.record_audit(actor=admin.username,
                       action="studio:updated" if existing else "studio:created",
                       studio=key, detail=studio.name)
    return {"studio": studio.to_dict(), "created": not existing}


def _person_name(store, username: str) -> str:
    """The name a person would recognise, falling back to the username.

    Every message an admin reads should say "Bae Soo-jin", not
    "bae_soojin_example_com". The username is a database key that happens to be
    legible, and showing it makes a working feature look broken.
    """
    account = store.account(username)
    return account.display_name if account and account.display_name else username


def _place_name(store, key: str) -> str:
    """The name of a studio, from its key.

    Not to be confused with ``_studio_name`` further down, which answers a
    different question -- *which* studio somebody belongs to. Naming them alike
    once meant the second definition silently shadowed this one and every
    location in an admin's confirmation came out as "the studio".
    """
    studio = store.studio(key)
    return (studio.get("name") if isinstance(studio, dict) else None) or key


def move_person(store, viewer: Viewer | None, payload: dict) -> dict:
    """Put somebody into a studio, in a role, from anywhere.

    The thing an owner of two locations needs on day one and could not do:
    every other route works inside the studio the admin happens to be acting
    in, and moving somebody is by definition about a different one.

    ``leave`` ends the role at the old studio; without it they hold both, which
    is a real case -- a coach who teaches at two sites -- rather than an error.
    """
    from .accounts import LEFT, Membership, now

    admin = _need_admin(viewer)
    username = payload.get("username", "")
    role = payload.get("role") or STUDENT
    to = payload.get("studio", "")
    if role not in ROLES:
        raise Refused(f"{role!r} is not one of {sorted(ROLES)}", 400)
    if store.account(username) is None:
        raise Refused(f"nobody here is called {username!r}", 404)
    if store.studio(to) is None:
        raise Refused(f"there is no studio called {to!r}", 404)

    store.put_membership(Membership(username=username, studio=to, role=role,
                                    state=ACTIVE, decided_by=admin.username,
                                    decided_at=now()))
    left = []
    if payload.get("leave"):
        for membership in store.memberships(username=username, role=role):
            if membership.studio != to and membership.state == ACTIVE:
                store.decide_membership(username, membership.studio, role,
                                        LEFT, by=admin.username)
                left.append(membership.studio)
    store.record_audit(actor=admin.username, action=f"moved:{role}",
                       subject=username, studio=to,
                       detail=f"left {', '.join(left)}" if left else "added")
    who = _person_name(store, username)
    where = _place_name(store, to)
    gone = ", ".join(_place_name(store, k) for k in left)
    return {"username": username, "studio": to, "role": role, "left": left,
            "display_name": who, "studio_name": where,
            "message": f"{who} is now a {role} at {where}"
                       + (f", no longer at {gone}" if left else "")}


def assign_everybody(store, viewer: Viewer | None, payload: dict) -> dict:
    """Give one coach every student at a studio, in one act.

    A studio with one instructor is the common case and it should not be twenty
    presses. Skips the ones already on that roster rather than duplicating them.
    """
    admin = _need_admin(viewer)
    coach = payload.get("coach", "")
    studio = payload.get("studio") or admin.studio
    if store.account(coach) is None:
        raise Refused(f"nobody here is called {coach!r}", 404)
    live = {a.student for a in store.assignments(coach=coach, studio=studio)
            if a.live}
    students = [m.username for m in
                store.memberships(studio=studio, role=STUDENT, state=ACTIVE)
                if m.username != coach]
    added = []
    for student in students:
        if student in live:
            continue
        assign(store, coach, student, studio, by=admin.username)
        added.append(student)
    name = _person_name(store, coach)
    where = _place_name(store, studio)
    if added:
        message = (f"{len(added)} student{'' if len(added) == 1 else 's'} added "
                   f"to {name}'s roster at {where}.")
    elif not students:
        # A zero that means "there was nobody here", which is not the same as
        # "it did not work" -- and an admin staring at a bare 0 cannot tell the
        # difference.
        message = f"There are no students at {where} yet, so nobody was added."
    else:
        message = f"{name} already has every student at {where}."
    return {"coach": coach, "studio": studio, "added": added,
            "students": len(students), "display_name": name,
            "studio_name": where, "message": message}


def my_coaches(store, viewer: Viewer | None) -> dict:
    """Who can open my record, and since when.

    The student's half of the design, and the reason adding can be immediate:
    the control is here, visible, and one press wide.
    """
    person = _need(viewer)
    rows = []
    for assignment in store.assignments(student=person.username):
        if not assignment.live:
            continue
        account = store.account(assignment.coach)
        rows.append({"username": assignment.coach,
                     "display_name": account.display_name if account
                                     else assignment.coach,
                     "studio": assignment.studio,
                     "since": assignment.since,
                     "sees": list(assignment.scopes)})
    return {"coaches": rows}


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


def seed_studio(store, viewer: Viewer | None, payload: dict) -> dict:
    """Fill this studio with people who do not exist, from the admin console.

    Here as well as in the terminal because the deployments most in need of it
    are the hosted ones, where there is no terminal to run a command in. Scoped
    to the studio the admin is acting in, and nobody it creates becomes an admin
    of it: a fixture poured into somewhere real must not hand a fictional person
    the ability to read every health record in the building.
    """
    from .seed import PASSWORD, already_seeded, sow

    admin = _need_admin(viewer)
    if already_seeded(store) and not payload.get("again"):
        raise Refused("this database already has the demonstration people on "
                      "it. Look in People, or pass again:true to add them "
                      "a second time", 409)
    made = sow(store, password=PASSWORD, into=admin.studio,
               classes=not payload.get("no_classes"))
    store.record_audit(actor=admin.username, action="seed:sown",
                       studio=admin.studio,
                       detail=f"{len(made['people'])} fictional people")
    return {
        "people": len(made["people"]),
        "assignments": made["assignments"],
        "sessions": made["sessions"],
        "notes": made["notes"],
        "studio": admin.studio,
        "password": PASSWORD,
        "message": f"{len(made['people'])} people who do not exist are now at "
                   f"{admin.studio}. They all sign in with “{PASSWORD}”. "
                   "Nobody seeded is an admin.",
    }


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


# -- getting back in --------------------------------------------------------

def recovery_state(store, viewer: Viewer | None) -> dict:
    """What ways back in this deployment and this person actually have."""
    from . import mail

    person = _need(viewer)
    from .recovery import codes_left

    return {"email": mail.available(),
            "codes_left": codes_left(store, person.username),
            "admin": True}


def new_codes(store, viewer: Viewer | None) -> dict:
    """A fresh set, shown once. The old set stops working immediately."""
    from .recovery import issue_codes

    person = _need(viewer)
    return {"codes": issue_codes(store, person.username),
            "note": "Keep these somewhere that is not this computer. Each one "
                    "works once, and generating this list has just cancelled "
                    "the previous one."}


def forgot(store, payload: dict, base: str = "") -> dict:
    """Start a reset, and say the same thing whichever way it goes.

    Never reveals whether the address is known here. A "no such account" on
    this endpoint is a way to find out which of a studio's students have signed
    up, and the people most likely to be looked up that way are exactly the
    ones this system holds health data about.
    """
    from . import mail
    from .recovery import email_reset

    email = payload.get("email", "")
    account = store.account_by_email(email)
    sent = False
    if account is not None and account.active and mail.available():
        try:
            email_reset(store, account.username, base or "",
                        studio=_studio_name(store, account.username))
            sent = True
        except mail.Undeliverable as exc:
            # Logged, not shown: whether the studio's mail server is healthy is
            # not something a stranger at the login form gets to learn.
            store.record_audit(actor="", action="reset:undeliverable",
                               subject=account.username, detail=str(exc)[:200])
    return {
        "sent": sent if mail.available() else False,
        "email_possible": mail.available(),
        "message": (
            "If that address has an account here, a reset link is on its way. "
            "It works once and expires in two hours."
            if mail.available() else
            "This studio does not send email. Use one of the recovery codes "
            "you saved when you signed up, or ask an admin to issue you a "
            "reset link."),
    }


def recover_with_code(store, payload: dict) -> dict:
    """The path that needs no email server and no admin: a code on paper."""
    from .recovery import redeem, spend_code

    token = spend_code(store, payload.get("email", ""),
                       payload.get("code", ""))
    redeem(store, token, payload.get("password", ""))
    return {"ok": True,
            "message": "Password changed, and every session that was open has "
                       "been signed out. Sign in with the new one."}


def reset_with_token(store, payload: dict) -> dict:
    """Redeem a link, whether it came by email or from an admin's hand."""
    from .recovery import redeem

    redeem(store, payload.get("token", ""), payload.get("password", ""))
    return {"ok": True,
            "message": "Password changed, and every session that was open has "
                       "been signed out."}


def verify_email(store, payload: dict) -> dict:
    from .recovery import confirm_email

    return {"username": confirm_email(store, payload.get("token", "")),
            "message": "Address confirmed."}


def admin_reset(store, viewer: Viewer | None, payload: dict,
                base: str = "") -> dict:
    """An admin handing somebody a way back in.

    A **link**, not a new password. An admin who sets a password knows it, and
    then a student's record has two people who can open it and only one who
    should. The link is redeemed by the person, so the password they end up with
    is theirs alone.
    """
    from . import mail
    from .recovery import ADMIN_HOURS, issue_token, link_for

    admin = _need_admin(viewer)
    username = payload.get("username", "")
    account = store.account(username)
    if account is None:
        raise Refused(f"nobody here is called {username!r}", 404)
    token = issue_token(store, username, "reset", by=admin.username,
                        hours=ADMIN_HOURS)
    link = link_for(base or "", "reset", token)
    emailed = False
    if mail.available() and payload.get("email_it"):
        try:
            mail.send(account.email,
                      f"A password reset for {_studio_name(store, username)}",
                      f"An admin issued this reset link for you. It works once "
                      f"and expires in {ADMIN_HOURS} hours.\n\n{link}\n")
            emailed = True
        except mail.Undeliverable as exc:
            raise Refused(f"the mail server refused it: {exc}", 502) from exc
    return {"link": link, "emailed": emailed, "hours": ADMIN_HOURS,
            "note": "Hand this to them. It is not stored and cannot be looked "
                    "up again; issuing another one cancels this."}


def _studio_name(store, username: str) -> str:
    held = store.memberships(username=username)
    if not held:
        return "the studio"
    return (store.studio(held[0].studio) or {}).get("name", "the studio")


def set_up(store, payload: dict) -> dict:
    """The first admin, on a database that has none.

    The only route in this system that works without a signed-in person, and it
    stops working the moment it succeeds. It exists because the alternative --
    what this used to do -- was to serve every record on an account-less
    database to anybody who asked, which made "has not got round to making an
    account" into a way through the door.
    """
    from .accounts import Account, Studio

    if not unclaimed(store):
        raise Refused("this studio already has an owner; sign in instead", 409)
    key = (payload.get("studio_key") or "studio").strip().lower()
    studio = Studio(key=key, name=payload.get("studio_name") or key,
                    city=payload.get("city", ""),
                    country=payload.get("country", ""),
                    timezone=payload.get("timezone") or "UTC")
    account = Account(email=payload.get("email", ""),
                      display_name=payload.get("display_name", ""),
                      phone=payload.get("phone", ""))
    username = store.claim_first_admin(account, payload.get("password", ""),
                                       studio)
    from .recovery import issue_codes

    return {"username": username, "studio": studio.key,
            # Shown once, here, because the owner of a studio locking
            # themselves out of it is the failure with no way back.
            "recovery_codes": issue_codes(store, username),
            "message": f"{studio.name} is set up. You are its admin, its coach "
                       "and a student in it — switch with the control in the "
                       "header."}


def register(store, payload: dict, base: str = "") -> dict:
    """Signing up. Declares an intent; grants nothing but a student role."""
    from . import mail
    from .recovery import email_verification, issue_codes

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
    out = welcome.to_dict()
    out["recovery_codes"] = issue_codes(store, welcome.username)
    out["recovery_note"] = (
        "Write these down somewhere that is not this computer. Any one of them "
        "gets you back in if you forget your password"
        + (", and so does a link we can email you." if mail.available()
           else ". This studio does not send email, so these and an admin are "
                "the two ways back."))
    if mail.available():
        try:
            email_verification(store, welcome.username, base or "",
                               studio=_studio_name(store, welcome.username))
            out["verification_sent"] = True
        except mail.Undeliverable:
            # A mail server that is down must not stop somebody joining.
            out["verification_sent"] = False
    return out


# ------------------------------------------------------- standing alignment

def posture_assessment(store, viewer: Viewer | None, payload: dict) -> dict:
    """Measure one student's standing alignment from landmarks already extracted.

    Takes keypoints rather than a video. The analysis pipeline produces
    :class:`~pilates.types.Detection` objects and the store keeps measurements,
    not footage -- so the honest boundary for this endpoint is the same one the
    rest of the system keeps: the clip is analysed where it was recorded, and
    what travels is the numbers.

    ``keypoints`` is 17 ``[x, y]`` pairs in COCO order with 17 ``scores``; see
    :mod:`pilates.keypoints`. ``view`` may be supplied when the studio knows
    where its camera points, which beats any estimator.
    """
    import numpy as np

    from . import alignment as al
    from .types import Detection

    who = str(payload.get("username", "")).strip()
    if who:
        guard_subject(store, viewer, who)
    else:
        _need(viewer)

    try:
        points = np.asarray(payload["keypoints"], dtype=np.float32)
        scores = np.asarray(payload["scores"], dtype=np.float32)
    except (KeyError, TypeError, ValueError) as exc:
        raise Refused("send 17 keypoints and 17 scores", 400) from exc
    try:
        detection = Detection(keypoints=points, scores=scores)
    except ValueError as exc:
        raise Refused(str(exc), 400) from exc

    asked = str(payload.get("view", "")).strip().lower()
    view = None
    if asked:
        try:
            view = al.View(asked)
        except ValueError as exc:
            raise Refused(
                f"unknown view {asked!r}; use one of "
                f"{', '.join(v.value for v in al.View if v is not al.View.UNKNOWN)}",
                400) from exc

    frame_height = payload.get("frame_height")
    return al.assess(
        detection, view=view, person_id=str(payload.get("person_id", "")),
        frame_height=int(frame_height) if frame_height else None,
        frame_width=int(payload["frame_width"]) if payload.get("frame_width") else None,
    ).to_dict()


def posture_comparison(store, viewer: Viewer | None, payload: dict) -> dict:
    """Two assessments of one student, side by side.

    Both are re-measured here from their landmarks rather than trusted as
    numbers, so a comparison cannot be assembled out of two payloads that were
    never assessed the same way.
    """
    before = posture_assessment(store, viewer, {**payload.get("before", {}),
                                                "username": payload.get("username", "")})
    after = posture_assessment(store, viewer, {**payload.get("after", {}),
                                               "username": payload.get("username", "")})

    from . import alignment as al

    def rebuild(raw: dict) -> "al.PostureAssessment":
        """Back into the dataclass, so `compare` applies its own rules."""
        view = al.ViewEstimate(al.View(raw["view"]), raw["view_confidence"])
        metrics = {}
        for name, value in raw["metrics"].items():
            availability = al.Availability(raw["availability"][name])
            metrics[name] = al.Metric(
                name, value, raw["units"][name], availability,
                raw["confidence"].get(name, 0.0), raw["reasons"].get(name, ""),
                normal=al.NORMAL_BANDS.get(name))
        return al.PostureAssessment(view=view, metrics=metrics,
                                    warnings=list(raw["warnings"]),
                                    person_id=raw["person_id"])

    return al.compare(rebuild(before), rebuild(after)).to_dict()



#: The pose backend, loaded once and kept, because loading it per request would
#: be ninety megabytes of ONNX graph per photograph set.
#:
#: Lazily, and never at import: a viewer serving an exported bundle, a test
#: suite, and the CLI's non-measuring commands all import this module and none
#: of them should pay for a model they will not call. The first photograph
#: intake on a server is therefore slower than the rest, which is the right
#: trade for a feature a studio uses at the door and not in a loop.
_BACKEND = None


def pose_backend():
    """The shared pose backend, or a refusal explaining why there is not one.

    Two ways this legitimately fails and both have to reach the person rather
    than a log: the package is installed without its model dependencies, and
    the machine has not got the memory. The smallest free hosting tier is 512
    MB and the graph peaks over four hundred of that, so "the server is too
    small for this" is a real answer and saying it plainly beats a process that
    dies mid-request.
    """
    global _BACKEND
    if _BACKEND is None:
        try:
            from .pose import RTMOBackend
            _BACKEND = RTMOBackend(size=os.environ.get("PILATES_POSE_MODEL", "m"))
        except MemoryError as exc:
            raise Refused("this server does not have enough memory to load "
                          "the pose model; a photograph assessment needs "
                          "about 512 MB free", 503) from exc
        except Exception as exc:                     # noqa: BLE001
            raise Refused(f"the pose model could not be loaded here: {exc}",
                          503) from exc
    return _BACKEND


def photo_intake(store, viewer: Viewer | None, payload: dict) -> dict:
    """Four photographs in, one pre-session assessment out.

    The photographs are measured and dropped. What comes back is the landmarks
    -- so the browser that still holds the originals can draw the overlay
    without the pictures making a second trip -- together with the readings,
    the findings and what could not be measured.

    ``photos`` is a list of ``{"view": ..., "image": "data:image/jpeg;base64,..."}``.
    A photograph that cannot be measured does not fail the request: it comes
    back marked, with the reason, alongside the ones that could, because three
    good photographs and one to retake is a useful assessment.
    """
    from . import guidance as gd
    from . import intake as ik
    from . import photos as ph

    who = str(payload.get("username", "")).strip()
    if who:
        guard_subject(store, viewer, who)
    else:
        _need(viewer)

    supplied = payload.get("photos")
    if not isinstance(supplied, list) or not supplied:
        raise Refused("send a list of photographs, each with a view and an "
                      "image", 400)
    if len(supplied) > len(ik.PROTOCOL):
        raise Refused(f"the protocol is {len(ik.PROTOCOL)} photographs: "
                      f"{', '.join(v.value for v in ik.PROTOCOL)}", 400)

    seen: set = set()
    wanted: list[tuple] = []
    for entry in supplied:
        if not isinstance(entry, dict):
            raise Refused("each photograph is an object with a view and an "
                          "image", 400)
        asked = str(entry.get("view", "")).strip().lower()
        try:
            view = ik.View(asked)
        except ValueError as exc:
            raise Refused(
                f"unknown view {asked!r}; the protocol is "
                f"{', '.join(v.value for v in ik.PROTOCOL)}", 400) from exc
        if view not in ik.PROTOCOL:
            raise Refused(f"{view.value} is not one of the four photographs",
                          400)
        if view in seen:
            # Two photographs claiming the same view would silently replace
            # each other, and the one that survived would be arbitrary.
            raise Refused(f"two photographs are both labelled "
                          f"{view.value}", 400)
        seen.add(view)
        wanted.append((view, entry.get("image", ""),
                       str(entry.get("label", ""))[:80]))

    backend = pose_backend()
    measured = [ph.photograph(image, view, backend, label=label)
                for view, image, label in wanted]
    assessment = ik.assess_photos(
        measured,
        person_id=who or str(payload.get("person_id", "")),
        taken_on=str(payload.get("taken_on", ""))[:10])

    out = gd.report(assessment)
    # The landmarks travel back so the browser can draw the overlay on the
    # copy it already has. This is the whole reason the photographs do not
    # need to be stored or returned.
    out["landmarks"] = {
        photo.view.value: {
            "keypoints": photo.detection.keypoints.round(2).tolist(),
            "scores": photo.detection.scores.round(3).tolist(),
            "width": photo.width, "height": photo.height,
        }
        for photo in measured if photo.usable
    }
    out["protocol"] = _protocol()

    # Filed, so a second visit means something.
    #
    # Only against a named person: an assessment with nobody attached cannot be
    # compared with anything and would be a row that grows and is never read.
    # And only when something was measured -- a set where every photograph was
    # refused is a set to retake, not a point on a chart.
    out["assessment_id"] = None
    subject = who or (viewer.username if viewer else "")
    if subject and assessment.supplied and payload.get("save", True):
        out["assessment_id"] = store.record_assessment(
            username=subject,
            by=(viewer.username if viewer else ""),
            taken_on=assessment.taken_on or today(),
            made_at=_now(),
            views=",".join(v.value for v in assessment.supplied),
            score=out["score"]["value"],
            band=out["score"]["band"],
            coverage=out["score"]["coverage"],
            checks=out["score"]["checks"],
            readings={n: r.to_dict() for n, r in assessment.readings.items()},
            landmarks=out["landmarks"],
            doubts=assessment.doubts,
            warnings=assessment.warnings)
    return out


# -- movement screening ------------------------------------------------------
#
# Named "movement" throughout rather than "screening", because `put_screening`
# a few hundred lines above answers a health questionnaire and has nothing to
# do with how far a shoulder goes. Two things called screening in one API is
# two things nobody can tell apart at a call site.

def _history(payload: dict, clip: dict) -> "object":
    """Rebuild one side's recording from the landmarks the browser sent.

    Frames arrive as they came out of the pose model -- seventeen points and
    seventeen scores, with a timestamp -- and are replayed through the same
    :class:`~pilates.movement.TrackHistory` the live pipeline fills. One
    implementation of what a recorded movement is, rather than two that drift.
    """
    import numpy as np

    from . import movement as mv
    from .types import Detection

    times = clip.get("times")
    frames = clip.get("frames")
    if not isinstance(frames, list) or not frames:
        raise Refused("each recording needs a list of frames", 400)
    if not isinstance(times, list) or len(times) != len(frames):
        raise Refused("send one timestamp per frame", 400)
    if len(frames) > MAX_SCREEN_FRAMES:
        raise Refused(f"a screening recording is at most "
                      f"{MAX_SCREEN_FRAMES} frames", 400)

    history = mv.TrackHistory(track_id=0)
    previous_time = -float("inf")
    for when, frame in zip(times, frames):
        try:
            points = np.asarray(frame["keypoints"], dtype=np.float32)
            scores = np.asarray(frame["scores"], dtype=np.float32)
            detection = Detection(keypoints=points, scores=scores)
        except (KeyError, TypeError, ValueError, IndexError) as exc:
            raise Refused("each frame is 17 keypoints and 17 scores", 400) from exc
        try:
            import math
            timestamp = float(when)
            if not math.isfinite(timestamp) or timestamp <= previous_time:
                raise ValueError("timestamps must increase")
            previous_time = timestamp
            history.add(timestamp, detection, THRESHOLD)
        except (TypeError, ValueError) as exc:
            raise Refused("a timestamp is a number of seconds", 400) from exc
    return history


#: Frames one recording may carry. Thirty seconds at 60 fps, which is the
#: longest screen in the catalogue filmed on the fastest phone. Bounded
#: because the cost of replaying them is linear and the request is public.
MAX_SCREEN_FRAMES = 1800

#: The keypoint confidence the geometry layer works at. Named here so the
#: replay matches what the live pipeline does rather than defaulting apart.
THRESHOLD = 0.4


def movement_screening(store, viewer: Viewer | None, payload: dict) -> dict:
    """Recorded movement in, a screening report out.

    Landmarks rather than video, on the same boundary every other endpoint
    here keeps: the clip is analysed where it was recorded and what travels is
    the numbers. Nothing that could reconstruct a picture of anybody crosses
    this line.

    ``clips`` maps a screen key to ``{"view": ..., "left": {...}, "right":
    {...}}``, each side being ``{"times": [...], "frames": [{"keypoints":
    ..., "scores": ...}, ...]}``. A screen that cannot be measured does not
    fail the request: it comes back refused, with the reason, beside the ones
    that could.
    """
    from . import alignment as al
    from . import screening as sc

    who = str(payload.get("username", "")).strip()
    if who:
        guard_subject(store, viewer, who)
    else:
        _need(viewer)

    clips = payload.get("clips")
    if not isinstance(clips, dict) or not clips:
        raise Refused("send a recording for at least one screen", 400)
    if len(clips) > len(sc.SCREENS):
        raise Refused(f"there are {len(sc.SCREENS)} screens", 400)

    rebuilt: dict[str, dict] = {}
    views: dict[str, object] = {}
    for key, clip in clips.items():
        screen = sc.SCREENS.get(str(key))
        if screen is None:
            raise Refused(f"unknown screen {key!r}; the catalogue is "
                          f"{', '.join(sc.SCREENS)}", 400)
        if not isinstance(clip, dict):
            raise Refused(f"{key} needs a recording per side", 400)
        asked = str(clip.get("view", "")).strip().lower()
        if asked:
            try:
                views[screen.key] = al.View(asked)
            except ValueError as exc:
                raise Refused(
                    f"unknown view {asked!r}; use one of "
                    f"{', '.join(v.value for v in al.View if v is not al.View.UNKNOWN)}",
                    400) from exc
        sides = ("left", "right") if screen.sided else ("both",)
        rebuilt[screen.key] = {}
        for side in sides:
            if clip.get(side) is None:
                continue
            rebuilt[screen.key][side] = _history(payload, clip[side])
        if not rebuilt[screen.key]:
            raise Refused(
                f"{key} was sent with no recording; the sides it needs are "
                f"{', '.join(sides)}", 400)

    assessment = sc.screen_all(
        rebuilt, views=views,
        person_id=who or str(payload.get("person_id", "")),
        taken_on=str(payload.get("taken_on", ""))[:10])

    out = assessment.to_dict()
    out["catalogue_detail"] = [
        {"key": s.key, "name": s.name, "name_ko": s.name_ko,
         "instruction": s.instruction, "instruction_ko": s.instruction_ko,
         "sided": s.sided, "kind": s.kind, "unit": s.unit,
         "reference": list(s.reference), "reference_kind": s.reference_kind,
         "reference_source": s.reference_source,
         "views": [v.value for v in s.views],
         "works": list(s.works)}
        for s in sc.SCREENS.values()
    ]
    out["disclaimer"] = sc.DISCLAIMER
    out["disclaimer_ko"] = sc.DISCLAIMER_KO

    # Filed, so a second screening means something. Only against a named
    # person, and only when something was measured: a session where every
    # screen was refused is a session to film again, not a point on a chart.
    out["screening_id"] = None
    subject = who or (viewer.username if viewer else "")
    measured = any(r.measured for r in assessment.results.values())
    if subject and measured and payload.get("save", True):
        out["screening_id"] = store.record_screening(
            username=subject,
            by=(viewer.username if viewer else ""),
            taken_on=assessment.taken_on or today(),
            made_at=_now(),
            screens=",".join(assessment.attempted),
            score=out["overall_score"],
            coverage=out["coverage"],
            checks=out["checks"],
            results=out["results"],
            views={k: v.value for k, v in views.items()},
            findings=out["findings"],
            doubts=out["doubts"])
    return out


def screening_history(store, viewer: Viewer | None, username: str) -> dict:
    """What movement screenings are on file for one person, newest first."""
    who = (username or "").strip()
    if who:
        guard_subject(store, viewer, who)
    else:
        who = _need(viewer).username
    rows = store.screenings(who)
    return {
        "username": who,
        "screenings": rows,
        # Withheld scores are left out rather than plotted as zero: a chart
        # with a cliff in it where there was no measurement invents a
        # collapse that did not happen.
        "trend": [{"id": row["id"], "on": row["taken_on"],
                   "score": row["score"]}
                  for row in reversed(rows) if row["score"] is not None],
    }


def screening_change(store, viewer: Viewer | None, payload: dict) -> dict:
    """Two filed screenings, compared.

    Rebuilt from the stored measurements rather than from a stored verdict, so
    the comparison applies the rules that measured them -- including the one
    that refuses to compare a screen filmed from two different planes.
    """
    from . import alignment as al
    from . import screening as sc

    first, second = payload.get("before"), payload.get("after")
    if not first or not second:
        raise Refused("send the ids of two screenings as before and after", 400)
    rows = []
    for which in (first, second):
        try:
            row = store.screening_record(int(which))
        except (TypeError, ValueError) as exc:
            raise Refused("a screening id is a number", 400) from exc
        if row is None:
            raise Refused(f"no screening {which}", 404)
        guard_subject(store, viewer, row["username"])
        rows.append(row)
    if rows[0]["username"] != rows[1]["username"]:
        # Two people's ranges compared as one person's progress is the worst
        # thing this endpoint could produce, and it would look right.
        raise Refused("those two screenings are of different people", 400)

    def rebuild(row: dict) -> sc.ScreeningAssessment:
        out = sc.ScreeningAssessment(person_id=row["username"],
                                     taken_on=row["taken_on"])
        for key, payload_ in (row.get("results") or {}).items():
            if key not in sc.SCREENS:
                continue
            out.results[key] = _screen_from_dict(key, payload_)
        for key, value in (row.get("views") or {}).items():
            try:
                out.views[key] = al.View(value)
            except ValueError:
                continue
        return out

    return sc.compare(rebuild(rows[0]), rebuild(rows[1]))


def _screen_from_dict(key: str, payload: dict) -> "object":
    """Rebuild one screen's result from what was filed.

    Only the fields a comparison reads are restored -- the peak and whether it
    was measured. A stored row is a record of a measurement, not a substitute
    for the recording, and reconstructing the repetitions from it would be
    claiming to know something the row does not hold.
    """
    from . import screening as sc
    from .alignment import Availability, Metric

    result = sc.ScreenResult(screen=key)
    screen = sc.SCREENS[key]
    for side in ("left", "right", "both"):
        stored = (payload or {}).get(side)
        if not stored:
            continue
        peak = stored.get("peak") or {}
        value = peak.get("value")
        available = Availability(peak.get("availability", "unavailable"))
        metric = Metric(f"{key}_peak", value, peak.get("unit", screen.unit),
                        available, float(peak.get("confidence") or 0.0),
                        peak.get("reason", ""),
                        tuple(peak["normal"]) if peak.get("normal") else None)
        setattr(result, side, sc.SideResult(
            screen=key, side="" if side == "both" else side, peak=metric,
            shortfall=Metric(f"{key}_shortfall", None, screen.unit,
                             Availability.UNAVAILABLE),
            confidence=float(stored.get("confidence") or 0.0)))
    return result


def assessment_history(store, viewer: Viewer | None, username: str) -> dict:
    """What standing assessments are on file for one person, newest first.

    Without the landmarks: this answers "what is on file", which a history
    strip and a trend line need, and pulling a megabyte of landmark data to
    draw a dozen dots would be a strange way to spend a phone's connection.
    """
    who = (username or "").strip()
    if who:
        guard_subject(store, viewer, who)
    else:
        who = _need(viewer).username
    rows = store.assessments(who)
    return {
        "username": who,
        "assessments": rows,
        # The line a studio actually looks at. Withheld scores are left out
        # rather than plotted as zero: a chart with a cliff in it where there
        # was no measurement is a chart that invents a collapse.
        "trend": [{"id": row["id"], "on": row["taken_on"],
                   "score": row["score"], "band": row["band"]}
                  for row in reversed(rows) if row["score"] is not None],
    }


def _rebuild_assessment(row: dict, *, with_landmarks: bool = False):
    """Turn a filed row back into the assessment that produced it.

    Rebuilt from the stored *readings* rather than from a stored verdict, so
    everything downstream -- the findings, the priorities, the score -- is
    derived by the same code that derived it the first time. A report that
    replayed a saved verdict would drift from the live one the moment a band
    or a threshold changed, and nobody would notice until two visits
    disagreed about a body that had not moved.
    """
    from . import alignment as al
    from . import intake as ik

    out = ik.PhotoAssessment(
        person_id=row["username"], taken_on=row["taken_on"],
        warnings=list(row["warnings"]), doubts=list(row["doubts"]))
    for name, stored in (row.get("readings") or {}).items():
        metric = al.Metric(
            name, stored.get("value"), stored.get("unit", "deg"),
            al.Availability(stored.get("availability", "unavailable")),
            stored.get("confidence", 0.0), stored.get("reason", ""),
            normal=al.NORMAL_BANDS.get(name))
        out.readings[name] = ik.Reading(
            metric,
            tuple(al.View(v) for v in stored.get("sources", ())),
            stored.get("spread"), stored.get("per_view", {}))

    landmarks = row.get("landmarks") or {}
    for view in row["views"]:
        detection = _blank_detection()
        if with_landmarks and view in landmarks:
            detection = _detection_from(landmarks[view]) or detection
        stored = landmarks.get(view) or {}
        out.photos[al.View(view)] = ik.Photo(
            view=al.View(view), detection=detection,
            width=int(stored.get("width") or 0),
            height=int(stored.get("height") or 0))
    return out


def _detection_from(stored: dict):
    """A Detection from the landmarks as they were filed, or None."""
    import numpy as np

    from .types import Detection

    try:
        return Detection(
            keypoints=np.asarray(stored["keypoints"], dtype=np.float32),
            scores=np.asarray(stored["scores"], dtype=np.float32))
    except (KeyError, TypeError, ValueError):
        return None


def assessment_detail(store, viewer: Viewer | None, assessment_id) -> dict:
    """One filed assessment, reopened in full.

    The reason the history strip is worth having. Without this an assessment
    could be *listed* and never read again: a date and a score, with the
    seventeen measurements behind them reachable only by the person who
    happened to have the tab open on the day.

    **The photographs are not here and never will be.** They were measured and
    dropped, which is the promise this product makes. What comes back is the
    landmarks, so the skeleton, the plumb line and every callout redraw
    exactly as they were -- over an empty frame rather than over a body. The
    payload says so in ``from_file`` and the screen prints it, because a
    reader who expected their photograph back deserves a sentence rather than
    four black rectangles.
    """
    from . import guidance as gd

    try:
        row = store.assessment(int(assessment_id))
    except (TypeError, ValueError) as exc:
        raise Refused("an assessment id is a number", 400) from exc
    if row is None:
        raise Refused(f"no assessment {assessment_id}", 404)
    guard_subject(store, viewer, row["username"])

    assessment = _rebuild_assessment(row, with_landmarks=True)
    out = gd.report(assessment)
    out["assessment_id"] = row["id"]
    out["taken_on"] = row["taken_on"]
    out["username"] = row["username"]
    # Redrawn from what was filed, over no photograph.
    out["from_file"] = True
    out["landmarks"] = {
        view: stored for view, stored in (row.get("landmarks") or {}).items()
        if stored.get("keypoints")}
    out["protocol"] = _protocol()
    return out


def _protocol() -> list[dict]:
    """The four photographs, named and explained, in both languages."""
    from . import intake as ik

    return [{"view": view.value,
             "title": ik.instructions(view)[0], "how": ik.instructions(view)[1],
             "title_ko": ik.instructions(view, "ko")[0],
             "how_ko": ik.instructions(view, "ko")[1]}
            for view in ik.PROTOCOL]


def assessment_change(store, viewer: Viewer | None, payload: dict) -> dict:
    """Two filed assessments, compared.

    Rebuilt from the stored readings rather than from a stored verdict, so the
    comparison applies the same rules that measured them: a metric is compared
    only when both visits measured it, and a percentage is withheld when the
    earlier value was near zero.
    """
    from . import guidance as gd
    from . import intake as ik

    first, second = payload.get("before"), payload.get("after")
    if not first or not second:
        raise Refused("send the ids of two assessments as before and after", 400)
    rows = []
    for which in (first, second):
        try:
            row = store.assessment(int(which))
        except (TypeError, ValueError) as exc:
            raise Refused("an assessment id is a number", 400) from exc
        if row is None:
            raise Refused(f"no assessment {which}", 404)
        guard_subject(store, viewer, row["username"])
        rows.append(row)
    if rows[0]["username"] != rows[1]["username"]:
        # Two people's alignment compared as one person's progress is the
        # worst thing this endpoint could produce, and it would look right.
        raise Refused("those two assessments are of different people", 400)

    before = _rebuild_assessment(rows[0])
    after = _rebuild_assessment(rows[1])
    comparison = ik.compare(before, after)
    out = comparison.to_dict()
    out["before_id"], out["after_id"] = rows[0]["id"], rows[1]["id"]
    out["before_on"], out["after_on"] = rows[0]["taken_on"], rows[1]["taken_on"]
    out["before_score"], out["after_score"] = rows[0]["score"], rows[1]["score"]
    out["names"] = {name: {"en": gd.metric_name(name),
                           "ko": gd.metric_name(name, "ko")}
                    for name in out["changes"]}
    out["note"] = ("A smaller deviation is a smaller deviation. Whether it is "
                   "an improvement is a judgement for the person teaching.")
    out["note_ko"] = ("차이가 줄어든 것은 차이가 줄어든 것입니다. 그것이 개선인지는 "
                      "지도하는 사람이 판단할 일입니다.")

    # The landmarks of both, for the one thing a table of differences cannot
    # do: draw them. A reader comparing "+9.6 then, +4.1 now" against sixteen
    # other rows is reading arithmetic; two outlines on top of each other is
    # the same fact as a picture, and it is the picture a studio shows the
    # person whose body it is.
    #
    # Only the views both visits supplied. A shoulder line photographed from
    # the front in March and from the back in May is two measurements of the
    # same thing and two entirely different pictures, and overlaying them
    # would draw a change that is the camera moving.
    shared = [v for v in rows[0]["views"] if v in rows[1]["views"]]
    out["outlines"] = {
        view: {"before": (rows[0].get("landmarks") or {}).get(view),
               "after": (rows[1].get("landmarks") or {}).get(view)}
        for view in shared
        if (rows[0].get("landmarks") or {}).get(view)
        and (rows[1].get("landmarks") or {}).get(view)
    }
    return out


def _blank_detection():
    """A placeholder body for a rebuilt assessment.

    :func:`pilates.intake.PhotoAssessment.supplied` asks each photograph
    whether it is usable, and a rebuilt assessment has no landmarks to hand it
    -- the readings are what was stored. This keeps ``supplied`` honest about
    which photographs existed without pretending to have their landmarks.
    """
    import numpy as np

    from . import keypoints as kp
    from .types import Detection

    return Detection(keypoints=np.zeros((kp.NUM_KEYPOINTS, 2), np.float32),
                     scores=np.zeros(kp.NUM_KEYPOINTS, np.float32))


def _now() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat(timespec="seconds")
