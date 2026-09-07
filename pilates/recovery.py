"""Getting back in, by three routes that all end in the same place.

A studio locked out of its own record is a studio that starts a new one, and
this project's whole value is that the record is long. So there are three ways
back, deliberately, because each fails where another works:

1. **Recovery codes.** Eight one-time codes, printed once when the account is
   made. No email server, no admin, no network -- a piece of paper in a drawer.
   This is the path that works for a studio running on the machine in its own
   reception, which is most of them.
2. **An emailed link**, where ``$PILATES_SMTP_URL`` is configured. The one
   people expect. Optional because requiring it would mean requiring a mail
   server to run a Pilates studio.
3. **An admin issuing a reset.** One admin, one click, a link handed over in
   person or by whatever the studio already uses. It is a link rather than a new
   password on purpose: an admin who resets a password *knows* it, and then the
   student's record has two people who can open it and only one who should.

**Every path ends in a token the person redeems themselves**, so the new
password is only ever known to them. A redeemed token signs every existing
session out, because a password is reset most often when somebody thinks
somebody else has it.
"""
from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from .accounts import normalise_email, now

RESET = "reset"
VERIFY = "verify"

#: An emailed link is short-lived; one handed over by an admin has to survive
#: until the person is next in the building.
EMAIL_HOURS = 2
ADMIN_HOURS = 72
VERIFY_HOURS = 72

#: Eight is the number people can copy down without giving up, and enough that
#: losing a couple does not matter.
CODES = 8
#: Five words of base32 -- 40 bits per code. High entropy, so a plain hash is
#: the right store: there is no dictionary to slow an attacker down, and a
#: 400 ms verification on a public endpoint is a denial of service.
CODE_BYTES = 5


def digest(secret: str) -> str:
    return hashlib.sha256(secret.encode("utf-8")).hexdigest()


def _pretty(raw: bytes) -> str:
    """A code somebody can read off a screen and type into a phone."""
    import base64

    text = base64.b32encode(raw).decode().rstrip("=").lower()
    return f"{text[:4]}-{text[4:]}"


# -- recovery codes ---------------------------------------------------------

def issue_codes(store, username: str, how_many: int = CODES) -> list[str]:
    """Fresh codes, returned once and never recoverable afterwards.

    Replaces any that existed, including unused ones. Generating a new set is
    how somebody says "the old list is compromised or lost", and leaving the old
    ones live would make that sentence untrue.
    """
    store.db.execute("DELETE FROM recovery_codes WHERE username = ?", (username,))
    codes = []
    for _ in range(how_many):
        code = _pretty(secrets.token_bytes(CODE_BYTES))
        codes.append(code)
        store.db.execute(
            "INSERT INTO recovery_codes (code_hash, username, created_at, "
            "used_at) VALUES (?, ?, ?, '')", (digest(code), username, now()))
    store.db.commit()
    store.record_audit(actor=username, action="recovery_codes:issued",
                       subject=username, detail=f"{how_many} codes")
    return codes


def codes_left(store, username: str) -> int:
    row = store.db.execute(
        "SELECT COUNT(*) AS n FROM recovery_codes "
        "WHERE username = ? AND used_at = ''", (username,)).fetchone()
    return int(row["n"] if row else 0)


def spend_code(store, email: str, code: str) -> str:
    """Trade one code for the right to set a new password. Returns a token.

    The refusal is the same whatever went wrong -- unknown address, wrong code,
    code already used -- because the alternative tells a stranger which of a
    studio's students have accounts.
    """
    account = store.account_by_email(normalise_email(email))
    wrong = ValueError("that email and recovery code do not match")
    if account is None or not account.active:
        raise wrong
    row = store.db.execute(
        "SELECT * FROM recovery_codes WHERE code_hash = ? AND username = ? "
        "AND used_at = ''",
        (digest((code or "").strip().lower()), account.username)).fetchone()
    if row is None:
        raise wrong
    store.db.execute("UPDATE recovery_codes SET used_at = ? WHERE code_hash = ?",
                     (now(), row["code_hash"]))
    store.db.commit()
    store.record_audit(actor=account.username, action="recovery_code:spent",
                       subject=account.username,
                       detail=f"{codes_left(store, account.username)} left")
    return issue_token(store, account.username, RESET, by="recovery code",
                       hours=1)


# -- one-time links ---------------------------------------------------------

def issue_token(store, username: str, purpose: str, by: str = "",
                hours: int = ADMIN_HOURS) -> str:
    """A single-use link. Only the hash is kept, so it cannot be looked up."""
    if purpose not in (RESET, VERIFY):
        raise ValueError(f"{purpose!r} is not a kind of link this sends")
    token = secrets.token_urlsafe(32)
    expires = (datetime.now(timezone.utc)
               + timedelta(hours=hours)).isoformat(timespec="seconds")
    # One live link of a kind at a time: issuing a new one should invalidate the
    # old, or an admin "re-sending" leaves a second working key in the world.
    store.db.execute("DELETE FROM tokens WHERE username = ? AND purpose = ?",
                     (username, purpose))
    store.db.execute(
        "INSERT INTO tokens (token_hash, username, purpose, issued_by, "
        "created_at, expires_at, used_at) VALUES (?, ?, ?, ?, ?, ?, '')",
        (digest(token), username, purpose, by, now(), expires))
    store.db.commit()
    store.record_audit(actor=by or username, action=f"{purpose}:issued",
                       subject=username)
    return token


def _claim(store, token: str, purpose: str):
    row = store.db.execute(
        "SELECT * FROM tokens WHERE token_hash = ? AND purpose = ?",
        (digest(token or ""), purpose)).fetchone()
    if row is None:
        raise ValueError("that link is not one this studio sent")
    if row["used_at"]:
        raise ValueError("that link has already been used")
    if row["expires_at"] and row["expires_at"] < now():
        raise ValueError("that link has expired; ask for another")
    return row


def redeem(store, token: str, password: str) -> str:
    """Set a new password from a reset link. Returns the username.

    Signs every session of that account out, including the one doing this: a
    password is reset most often because somebody believes somebody else has
    it, and leaving that person's session alive would answer the wrong half of
    the problem.
    """
    row = _claim(store, token, RESET)
    store.set_password(row["username"], password)
    store.db.execute("UPDATE tokens SET used_at = ? WHERE token_hash = ?",
                     (now(), row["token_hash"]))
    store.db.execute("DELETE FROM auth_sessions WHERE username = ?",
                     (row["username"],))
    store.db.commit()
    store.record_audit(actor=row["username"], action="password:reset",
                       subject=row["username"],
                       detail=f"link issued by {row['issued_by'] or 'themselves'}")
    return row["username"]


def confirm_email(store, token: str) -> str:
    row = _claim(store, token, VERIFY)
    store.db.execute("UPDATE accounts SET verified_at = ? WHERE username = ?",
                     (now(), row["username"]))
    store.db.execute("UPDATE tokens SET used_at = ? WHERE token_hash = ?",
                     (now(), row["token_hash"]))
    store.db.commit()
    store.record_audit(actor=row["username"], action="email:verified",
                       subject=row["username"])
    return row["username"]


# -- the messages -----------------------------------------------------------

def link_for(base: str, kind: str, token: str) -> str:
    return f"{base.rstrip('/')}/index.html?{kind}={token}"


RESET_BODY = """Somebody asked to reset the password for this account at {studio}.

Open this link to choose a new one. It works once and expires in {hours} hours:

{link}

If it was not you, nothing has changed and you can ignore this. Your password
still works and nobody has seen it.
"""

VERIFY_BODY = """Confirm this address for {studio}.

{link}

The link works once and expires in {hours} hours. If you were not expecting
this, ignore it -- nothing happens until it is opened.
"""


def email_reset(store, username: str, base: str, studio: str = "the studio",
                hours: int = EMAIL_HOURS) -> None:
    """Send a reset link. Only called where mail is configured."""
    from . import mail

    account = store.account(username)
    token = issue_token(store, username, RESET, by="email", hours=hours)
    mail.send(account.email, f"Reset your password — {studio}",
              RESET_BODY.format(studio=studio, hours=hours,
                                link=link_for(base, "reset", token)))


def email_verification(store, username: str, base: str,
                       studio: str = "the studio") -> None:
    from . import mail

    account = store.account(username)
    token = issue_token(store, username, VERIFY, by="signup",
                        hours=VERIFY_HOURS)
    mail.send(account.email, f"Confirm your email — {studio}",
              VERIFY_BODY.format(studio=studio, hours=VERIFY_HOURS,
                                 link=link_for(base, "verify", token)))
