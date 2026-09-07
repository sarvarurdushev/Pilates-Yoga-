"""Logging in, staying logged in, and acting as one role at a time.

Three things happen here and nothing else does: a password is checked, a
session token is issued, and a request is turned into a :class:`Viewer` -- the
one acting membership everything downstream asks its permission questions of.

**Tokens are stored hashed.** A stolen database should not be a stolen set of
live sessions, and there is no reason to keep the plaintext: the server only
ever needs to recognise a token it is shown, never to reproduce one.

**A wrong email and a wrong password are the same answer, and take the same
time.** Otherwise the login form is an oracle that says which of a studio's
students have accounts.

**A session names the role it is acting in.** Somebody who is admin, coach and
student switches by asking for a different role on the session they already
have; the switch is checked against their memberships every time, so a
membership that is suspended stops working immediately rather than at the end
of a login.
"""
from __future__ import annotations

import hashlib
import hmac
import secrets
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from .accounts import ACTIVE, ADMIN, COACH, STUDENT, Viewer, now

#: Which role a session starts in when somebody holds several. Least reach
#: first, deliberately: an admin who opens the page is looking at their own
#: progress until they say otherwise, which is also the only way a studio owner
#: finds out what their students actually see.
LANDS_ON = (STUDENT, COACH, ADMIN)
from .passwords import needs_rehash, verify, waste_time

#: How long a session lasts without being used again.
LIFETIME = timedelta(days=30)

#: The cookie. ``__Host-`` is added only over HTTPS, where it is meaningful and
#: where ``Secure`` will not silently break a studio serving its own LAN.
COOKIE = "pilates_sid"
SECURE_COOKIE = "__Host-pilates_sid"

TOKEN_BYTES = 32


def digest(token: str) -> str:
    """What is stored. SHA-256 is right here and bcrypt would be wrong: the
    token is 32 random bytes, so there is no dictionary to slow down, and a
    login path that costs 400 ms per request is a denial of service."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


@dataclass
class Session:
    token: str
    username: str
    studio: str
    role: str
    expires_at: str


class TooManyTries(Exception):
    """Five wrong passwords is a typo. Fifty is somebody else."""


class Attempts:
    """A memory of recent failures, per email and per address.

    Deliberately in memory rather than in the database: it is a rate limiter,
    not a record, and a restart clearing it is the correct behaviour.
    """

    #: Failures allowed inside the window before sign-in is refused outright.
    #: Refused rather than slowed: sleeping holds a server thread open, which
    #: turns a rate limiter into the denial of service it was meant to prevent.
    ALLOWED = 5
    WINDOW = 15 * 60

    def __init__(self) -> None:
        self.seen: dict[str, list[float]] = {}

    def _recent(self, key: str) -> list[float]:
        cutoff = time.monotonic() - self.WINDOW
        kept = [t for t in self.seen.get(key, []) if t > cutoff]
        self.seen[key] = kept
        return kept

    def check(self, *keys: str) -> None:
        for key in keys:
            if len(self._recent(key)) >= self.ALLOWED:
                raise TooManyTries(
                    "too many failed sign-ins; wait a few minutes and try again")

    def failed(self, *keys: str) -> None:
        for key in keys:
            self.seen.setdefault(key, []).append(time.monotonic())

    def passed(self, *keys: str) -> None:
        for key in keys:
            self.seen.pop(key, None)


def sign_in(store, email: str, password: str, attempts: Attempts | None = None,
            source: str = "") -> Session:
    """Check a password and issue a session, or refuse identically either way.

    The role the session starts in is the person's own record -- student where
    they have one, otherwise whatever single membership they hold. Admin is
    never the default: an admin who opens the page is looking at their own
    progress until they say otherwise, which is also how a studio owner finds
    out what their students actually see.
    """
    from .accounts import normalise_email

    email = normalise_email(email)
    if attempts is not None:
        attempts.check(f"email:{email}", f"from:{source}")

    account = store.account_by_email(email)
    if account is None or not account.active:
        # Spend the same time as a real check, so the timing does not say
        # whether the address is known here.
        waste_time()
        if attempts is not None:
            attempts.failed(f"email:{email}", f"from:{source}")
        raise ValueError("that email and password do not match")

    stored = store.account(account.username).password_hash
    if not stored or not verify(password, stored):
        if attempts is not None:
            attempts.failed(f"email:{email}", f"from:{source}")
        raise ValueError("that email and password do not match")

    if needs_rehash(stored):
        # The one moment the plaintext is available and known correct.
        store.set_password(account.username, password)

    if attempts is not None:
        attempts.passed(f"email:{email}", f"from:{source}")

    usable = [m for m in store.memberships(username=account.username)
              if m.state == ACTIVE]
    if not usable:
        raise ValueError("this account is waiting for a studio to approve it")
    first = min(usable, key=lambda m: (LANDS_ON.index(m.role), m.studio))
    return start(store, account.username, first.studio, first.role)


def start(store, username: str, studio: str, role: str) -> Session:
    token = secrets.token_urlsafe(TOKEN_BYTES)
    expires = (datetime.now(timezone.utc) + LIFETIME).isoformat(timespec="seconds")
    store.db.execute(
        "INSERT INTO auth_sessions (token_hash, username, studio, role, "
        "created_at, expires_at, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (digest(token), username, studio, role, now(), expires, now()))
    store.db.commit()
    store.record_audit(actor=username, action="signed_in", subject=username,
                       studio=studio, detail=role)
    return Session(token=token, username=username, studio=studio, role=role,
                   expires_at=expires)


def viewer_for(store, token: str) -> Viewer | None:
    """Turn a cookie into the membership it is acting as, or into nothing.

    The membership is re-read on every request rather than trusted from the
    session row: a role that was suspended a minute ago has to stop working
    now, not at the end of a thirty-day login.
    """
    if not token:
        return None
    row = store.db.execute(
        "SELECT * FROM auth_sessions WHERE token_hash = ?",
        (digest(token),)).fetchone()
    if row is None:
        return None
    if row["expires_at"] and row["expires_at"] < now():
        store.db.execute("DELETE FROM auth_sessions WHERE token_hash = ?",
                         (row["token_hash"],))
        store.db.commit()
        return None

    account = store.account(row["username"])
    if account is None or not account.active:
        return None
    held = [m for m in store.memberships(username=row["username"],
                                         studio=row["studio"],
                                         role=row["role"])
            if m.state == ACTIVE]
    if not held:
        return None
    # Only when it has gone stale. This runs on every single request, and a
    # write per request is write contention per request -- for a field nothing
    # reads more precisely than "roughly when were they last here".
    if (row["last_seen"] or "") < _a_minute_ago():
        store.db.execute(
            "UPDATE auth_sessions SET last_seen = ? WHERE token_hash = ?",
            (now(), row["token_hash"]))
        store.db.commit()
    return Viewer(username=row["username"], studio=row["studio"],
                  role=row["role"], state=ACTIVE)


def _a_minute_ago() -> str:
    return (datetime.now(timezone.utc)
            - timedelta(minutes=1)).isoformat(timespec="seconds")


def switch(store, token: str, studio: str, role: str) -> Viewer:
    """Act as a different membership on the session already held.

    Checked against the memberships, not against what the caller asked for --
    which is the difference between a role switcher and a privilege escalation.
    """
    current = viewer_for(store, token)
    if current is None:
        raise ValueError("not signed in")
    wanted = [m for m in store.memberships(username=current.username,
                                           studio=studio, role=role)
              if m.state == ACTIVE]
    if not wanted:
        raise ValueError(f"you do not hold the {role} role at {studio}")
    store.db.execute(
        "UPDATE auth_sessions SET studio = ?, role = ? WHERE token_hash = ?",
        (studio, role, digest(token)))
    store.db.commit()
    return Viewer(username=current.username, studio=studio, role=role,
                  state=ACTIVE)


def sign_out(store, token: str) -> None:
    if token:
        store.db.execute("DELETE FROM auth_sessions WHERE token_hash = ?",
                         (digest(token),))
        store.db.commit()


def sweep(store) -> int:
    """Drop expired sessions. Cheap, and worth doing on every sign-in."""
    cursor = store.db.execute(
        "DELETE FROM auth_sessions WHERE expires_at <> '' AND expires_at < ?",
        (now(),))
    store.db.commit()
    return cursor.rowcount


def cookie_header(session: Session, secure: bool) -> tuple[str, str]:
    """The Set-Cookie line, and the name it used.

    ``__Host-`` and ``Secure`` only over HTTPS. A studio serving plain HTTP on
    its own network gets the cookie without them, because the alternative is a
    login that silently does not work and nobody can see why.
    """
    name = SECURE_COOKIE if secure else COOKIE
    parts = [f"{name}={session.token}", "Path=/", "HttpOnly", "SameSite=Strict",
             f"Max-Age={int(LIFETIME.total_seconds())}"]
    if secure:
        parts.append("Secure")
    return name, "; ".join(parts)


def clear_header(secure: bool) -> str:
    name = SECURE_COOKIE if secure else COOKIE
    parts = [f"{name}=", "Path=/", "HttpOnly", "SameSite=Strict", "Max-Age=0"]
    if secure:
        parts.append("Secure")
    return "; ".join(parts)


def token_from(cookie_header_value: str) -> str:
    """Pull our cookie out of the header, preferring the secure name."""
    jar = {}
    for piece in (cookie_header_value or "").split(";"):
        name, _, value = piece.strip().partition("=")
        if name:
            jar[name] = value
    return jar.get(SECURE_COOKIE) or jar.get(COOKIE) or ""


def same(a: str, b: str) -> bool:
    return hmac.compare_digest(a or "", b or "")
