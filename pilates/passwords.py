"""Storing a password so that a stolen database is not a stolen studio.

One decision, taken from the current OWASP guidance rather than from memory:
**scrypt at n=2**17, r=8, p=1**. The parameters travel in the stored string, so
raising them later is a decision this code can make on its own -- a password
hashed under the old cost is re-hashed the next time it is typed correctly, and
nobody is locked out by an upgrade.

The stored form is one line, self-describing::

    scrypt$131072$8$1$<salt b64>$<hash b64>

Nothing here is clever, and that is the point. Every place this could be
original is a place it could be wrong.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets
import threading

#: Current cost. Raise these, not the algorithm; the stored strings carry their
#: own parameters, so old hashes keep verifying and are upgraded on next use.
#:
#: ``$PILATES_SCRYPT_N`` lowers it, and there is one honest reason to: this
#: costs about 400 ms and 128 MB on a laptop, which on a tenth of a core is four
#: seconds a login and most of a small container's memory. Lowering it is a real
#: reduction in security and should be a deliberate, written-down choice for a
#: demonstration box rather than something that happens quietly on the way to
#: production. 2**14 is roughly a tenth of the cost.
N = int(os.environ.get("PILATES_SCRYPT_N") or 2 ** 17)
R = 8
P = 1

#: One password hashed at a time. At 2**17 each one wants 128 MB, so a handful
#: of simultaneous logins is an out-of-memory kill on a 512 MB box -- which is
#: an unauthenticated denial of service, reachable by anybody who can find the
#: login form. Serialising them makes a flood slow instead of fatal.
_ONE_AT_A_TIME = threading.Semaphore(1)
SALT_BYTES = 16
KEY_BYTES = 32

#: scrypt needs roughly ``128 * N * r`` bytes. At n=2**17 that is 128 MB, and
#: Python's default limit is far below it. Computed from N so that lowering the
#: cost lowers the allowance with it.
MAXMEM = max(132 * N * R, 32 * 1024 * 1024)

ALGORITHM = "scrypt"

#: Passwords shorter than this are refused. Long ones are not truncated -- scrypt
#: has no bcrypt-style 72-byte cliff -- but an unbounded field is a way to make
#: a server do 100 MB of work per request.
MIN_LENGTH = 10
MAX_LENGTH = 1024


def _b64(raw: bytes) -> str:
    return base64.b64encode(raw).decode()


def _unb64(text: str) -> bytes:
    return base64.b64decode(text.encode())


def _derive(password: str, salt: bytes, n: int, r: int, p: int) -> bytes:
    with _ONE_AT_A_TIME:
        return hashlib.scrypt(password.encode("utf-8"), salt=salt, n=n, r=r,
                              p=p, dklen=KEY_BYTES, maxmem=MAXMEM)


def check(password: str) -> None:
    """Refuse a password before it is ever hashed.

    Length only. Composition rules -- one capital, one symbol -- are known to
    push people towards ``Password1!`` and are not imposed.
    """
    if not isinstance(password, str) or len(password) < MIN_LENGTH:
        raise ValueError(f"a password needs at least {MIN_LENGTH} characters")
    if len(password) > MAX_LENGTH:
        raise ValueError("that password is implausibly long")


def hash_password(password: str) -> str:
    check(password)
    salt = secrets.token_bytes(SALT_BYTES)
    return "$".join([ALGORITHM, str(N), str(R), str(P), _b64(salt),
                     _b64(_derive(password, salt, N, R, P))])


def verify(password: str, stored: str) -> bool:
    """Constant-time, and false rather than raising on anything malformed.

    A row that has been corrupted, truncated or written by something else must
    not become a stack trace on the login path -- an exception there is a way to
    tell an attacker which accounts exist.
    """
    try:
        algorithm, n, r, p, salt, expected = stored.split("$")
        if algorithm != ALGORITHM:
            return False
        candidate = _derive(password, _unb64(salt), int(n), int(r), int(p))
    except (ValueError, TypeError, MemoryError):
        return False
    return hmac.compare_digest(candidate, _unb64(expected))


def needs_rehash(stored: str) -> bool:
    """True when a correct password should be re-stored at the current cost."""
    try:
        algorithm, n, r, p, _, _ = stored.split("$")
    except ValueError:
        return True
    return (algorithm != ALGORITHM
            or (int(n), int(r), int(p)) != (N, R, P))


#: A hash of nothing, used to spend the same time on an email that does not
#: exist as on one that does. Without it, login is an account enumeration
#: oracle: the wrong-email path returns in microseconds and the wrong-password
#: path takes a tenth of a second.
DUMMY = hash_password(secrets.token_urlsafe(32))


def waste_time() -> None:
    verify("not the password", DUMMY)
