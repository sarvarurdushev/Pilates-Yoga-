"""Getting a person into a studio, in a role somebody meant to give them.

Two ways in, and the difference between them is the whole point.

**Signing up declares an intent; it does not grant a role.** A role dropdown on
a public form is the most common privilege-escalation hole in systems shaped
like this one: type "coach", press the button, start reading strangers' health
data. So a signup writes a *pending* membership and stops. A student is approved
on the spot, because an approved student and a pending student can both see
exactly one record -- their own -- so making them wait protects nothing. A coach
waits for an admin. Admin is not requestable at all.

**An invitation is the safe path for staff**, and the one to prefer: an admin
invites an email into a studio with the role already attached, so the role is
scoped in the same act as the invitation rather than approved after the fact.
"""
from __future__ import annotations

import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from .accounts import (ACTIVE, ADMIN, AUTO_APPROVED, COACH, PENDING,
                       REQUESTABLE, ROLES, STUDENT, Account, Membership,
                       Profile, Screening, now, today)
from .auth import digest

#: An invitation that is never used should not stay usable forever.
INVITE_DAYS = 14


@dataclass
class Welcome:
    """What a signup produced, in the words the page has to say back."""

    username: str
    studio: str
    role: str
    state: str
    message: str

    @property
    def waiting(self) -> bool:
        return self.state != ACTIVE

    def to_dict(self) -> dict:
        return {"username": self.username, "studio": self.studio,
                "role": self.role, "state": self.state,
                "waiting": self.waiting, "message": self.message}


def sign_up(store, email: str, display_name: str, password: str, studio: str,
            wants: str = STUDENT, phone: str = "", profile: dict | None = None,
            ) -> Welcome:
    """Make an account and ask for a role at a studio.

    Refuses an unknown studio rather than creating one: a studio is a place
    somebody runs, and a signup form that can invent them is a signup form that
    fills the database with typos of the same gym.
    """
    if wants not in REQUESTABLE:
        raise ValueError(
            f"you can ask to be {' or '.join(REQUESTABLE)}; "
            f"{ADMIN} is granted by an admin, never requested")
    if store.studio(studio) is None:
        raise ValueError(f"there is no studio called {studio!r} here")

    account = Account(email=email, display_name=display_name, phone=phone)
    existing = store.account_by_email(account.email)
    if existing is not None:
        # Not an error: somebody who is a student at one studio joining another
        # is the case this is for. The password is not re-set and not checked
        # here -- adding a role to an account you cannot log into gives you
        # nothing.
        username = existing.username
    else:
        username = store.create_account(account, password=password)
        if profile:
            store.put_profile(Profile(username=username, **profile))

    held = [m for m in store.memberships(username=username, studio=studio,
                                         role=wants)]
    if held:
        return Welcome(username, studio, wants, held[0].state,
                       _said(wants, held[0].state, studio, store))

    state = ACTIVE if wants in AUTO_APPROVED else PENDING
    store.put_membership(Membership(username=username, studio=studio,
                                    role=wants, state=state,
                                    decided_by="signup" if state == ACTIVE else "",
                                    decided_at=now() if state == ACTIVE else ""))
    store.record_audit(actor=username, action=f"signup:{wants}", subject=username,
                       studio=studio, detail=state)
    return Welcome(username, studio, wants, state,
                   _said(wants, state, studio, store))


def _said(role: str, state: str, studio: str, store) -> str:
    place = (store.studio(studio) or {}).get("name", studio)
    if state == ACTIVE:
        return f"You are signed in as a {role} at {place}."
    if role == COACH:
        return (f"Your request to coach at {place} is with the studio. Until "
                "somebody there approves it you can see your own record and "
                "nobody else's.")
    return f"Your {role} role at {place} is waiting for approval."


def approve(store, username: str, studio: str, role: str, by: str) -> Membership:
    """An admin turning a request into a role. The only way a role is granted.

    Granting admin is the highest-blast-radius action in the system, so it is
    the same deliberate, audited, one-at-a-time act as any other -- just with
    nothing that can reach it except another admin.
    """
    store.decide_membership(username, studio, role, ACTIVE, by=by)
    return [m for m in store.memberships(username=username, studio=studio,
                                         role=role)][0]


def grant(store, username: str, studio: str, role: str, by: str) -> Membership:
    """Give somebody a role they did not ask for -- including admin.

    Separate from :func:`approve` because they are different acts: approving
    answers a request, granting starts one. Both are audited; only this one can
    produce an admin.
    """
    if role not in ROLES:
        raise ValueError(f"{role!r} is not one of {sorted(ROLES)}")
    if store.account(username) is None:
        raise KeyError(f"nobody here is called {username!r}")
    if store.studio(studio) is None:
        raise KeyError(f"there is no studio called {studio!r}")
    store.put_membership(Membership(username=username, studio=studio, role=role,
                                    state=ACTIVE, decided_by=by,
                                    decided_at=now()))
    store.record_audit(actor=by, action=f"granted:{role}", subject=username,
                       studio=studio, detail=role)
    return [m for m in store.memberships(username=username, studio=studio,
                                         role=role)][0]


def invite(store, email: str, studio: str, role: str, by: str) -> str:
    """Scope a role and an invitation in one act. Returns the token to send.

    Only the hash is stored, for the same reason as a session token: the server
    needs to recognise it, never to reproduce it. Which does mean a lost
    invitation is re-issued rather than looked up.
    """
    from .accounts import normalise_email

    if role not in ROLES:
        raise ValueError(f"{role!r} is not one of {sorted(ROLES)}")
    if store.studio(studio) is None:
        raise KeyError(f"there is no studio called {studio!r}")
    token = secrets.token_urlsafe(24)
    expires = (datetime.now(timezone.utc)
               + timedelta(days=INVITE_DAYS)).isoformat(timespec="seconds")
    store.db.execute(
        "INSERT OR REPLACE INTO invitations (token_hash, email, studio, role, "
        "invited_by, created_at, expires_at, accepted_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, '')",
        (digest(token), normalise_email(email), studio, role, by, now(), expires))
    store.db.commit()
    store.record_audit(actor=by, action=f"invited:{role}",
                       subject=normalise_email(email), studio=studio,
                       detail=role)
    return token


def accept(store, token: str, display_name: str, password: str,
           phone: str = "") -> Welcome:
    """Take up an invitation. The role is already decided, so this is active."""
    row = store.db.execute("SELECT * FROM invitations WHERE token_hash = ?",
                           (digest(token),)).fetchone()
    if row is None:
        raise ValueError("that invitation is not one this studio sent")
    if row["accepted_at"]:
        raise ValueError("that invitation has already been used")
    if row["expires_at"] and row["expires_at"] < now():
        raise ValueError("that invitation has expired; ask for another")

    account = Account(email=row["email"], display_name=display_name, phone=phone)
    existing = store.account_by_email(account.email)
    username = (existing.username if existing
                else store.create_account(account, password=password))
    store.put_membership(Membership(username=username, studio=row["studio"],
                                    role=row["role"], state=ACTIVE,
                                    decided_by=row["invited_by"],
                                    decided_at=now()))
    store.db.execute("UPDATE invitations SET accepted_at = ? WHERE token_hash = ?",
                     (now(), row["token_hash"]))
    store.db.commit()
    store.record_audit(actor=username, action="accepted_invitation",
                       subject=username, studio=row["studio"],
                       detail=row["role"])
    return Welcome(username, row["studio"], row["role"], ACTIVE,
                   _said(row["role"], ACTIVE, row["studio"], store))


def pending(store, studio: str = "") -> list[dict]:
    """What an admin has to decide. The whole of the admin's inbox."""
    out = []
    for membership in store.memberships(studio=studio, state=PENDING):
        account = store.account(membership.username)
        if account is None:
            continue
        out.append({**membership.to_dict(), "email": account.email,
                    "display_name": account.display_name,
                    "phone": account.phone})
    return sorted(out, key=lambda row: row["since"])


def ask_to_coach(store, coach: str, student: str, studio: str,
                 by: str = "") -> "object":
    """A coach asking a student for permission, which is what an add really is.

    The row is created pending. Until the student accepts it, the coach can see
    the name they already saw in the directory and nothing more.
    """
    from .accounts import Assignment

    assignment = Assignment(coach=coach, student=student, studio=studio,
                            state=PENDING, asked_by=by or coach, since=today())
    store.put_assignment(assignment)
    store.record_audit(actor=by or coach, action="assignment:asked",
                       subject=student, studio=studio, detail=coach)
    return assignment


def accept_coach(store, coach: str, student: str, studio: str, by: str,
                 scopes: tuple = ()) -> "object":
    """The student saying yes. This, and only this, is consent.

    An admin may do it on their behalf -- a studio assigning a coach on paper is
    a real thing -- and it is audited as having been done by the admin, which is
    the point of recording who.
    """
    from .accounts import DEFAULT_SCOPES, Assignment

    assignment = Assignment(coach=coach, student=student, studio=studio,
                            state=ACTIVE, scopes=scopes or DEFAULT_SCOPES,
                            since=today(), asked_by=coach)
    store.put_assignment(assignment)
    store.record_audit(actor=by, action="assignment:accepted", subject=student,
                       studio=studio, detail=coach)
    return assignment
