"""Small shared helpers: time, identifiers, token hashing, refusals."""

from __future__ import annotations

import re

from datetime import datetime, timedelta, timezone
import hashlib
import json
import secrets
import uuid

from ..platform.repository import Refused


class Denied(Refused):
    """A refusal with a stable machine-readable code for the client."""

    def __init__(self, message: str, status: int = 403, code: str = "denied"):
        super().__init__(message, status)
        self.code = code


def uid() -> str:
    return uuid.uuid4().hex


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def iso(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).isoformat()


def now() -> str:
    return iso(utcnow())


def parse(value: str | None) -> datetime | None:
    if not value:
        return None
    moment = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment


def later(**delta) -> str:
    return iso(utcnow() + timedelta(**delta))


def token() -> str:
    return secrets.token_urlsafe(32)


def digest(value: str | None) -> str:
    return hashlib.sha256(str(value or "").encode()).hexdigest()


def encode(value) -> str:
    return json.dumps(value, allow_nan=False, separators=(",", ":"), ensure_ascii=False)


def decode(value, default=None):
    if value in (None, ""):
        return default
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return default


def text(value, limit: int, field: str = "This field") -> str:
    value = str(value if value is not None else "").strip()
    if len(value) > limit:
        raise Refused(f"{field} is too long (at most {limit} characters).")
    return value


_DEMO_KEY = re.compile(r"^demo-([0-9a-f]{32})(?:-|$)")


def environment(org) -> str:
    """'real', or 'demo:<key>': one visitor's demonstration never meets another's."""
    if not org["demo"]:
        return "real"
    match = _DEMO_KEY.match(org["id"])
    return "demo:" + (match.group(1) if match else org["id"])
