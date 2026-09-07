"""Sending an email, when there is somewhere to send it from.

Optional, and honestly optional: a studio running this on the machine in its
own reception has no mail server and should not be made to find one. So every
caller asks :func:`available` first and has a path that works without it --
recovery codes and an admin who can issue a reset link by hand.

Configured by one environment variable, because two would be two things to get
wrong::

    PILATES_SMTP_URL=smtps://studio%40gmail.com:app-password@smtp.gmail.com:465
    PILATES_SMTP_URL=smtp+starttls://user:pass@smtp.example.com:587
    PILATES_MAIL_FROM="Gangnam Pilates <studio@gmail.com>"   # optional

``smtps://`` is TLS from the first byte (port 465); ``smtp+starttls://`` upgrades
a plain connection (port 587). Plain ``smtp://`` is allowed and refused for
anything but localhost, because a password reset link crossing the internet in
clear text is worse than no password reset link.
"""
from __future__ import annotations

import os
import smtplib
import ssl
from email.message import EmailMessage
from urllib.parse import unquote, urlparse

ENV_URL = "PILATES_SMTP_URL"
ENV_FROM = "PILATES_MAIL_FROM"

#: How long to wait on a mail server before giving up. A sign-up that hangs for
#: a minute because somebody's SMTP host is down is a sign-up that is lost.
TIMEOUT = 12


class Undeliverable(Exception):
    """Mail is configured and did not go. Never raised when it is not."""


def _settings() -> dict | None:
    raw = (os.environ.get(ENV_URL) or "").strip()
    if not raw:
        return None
    url = urlparse(raw)
    scheme = url.scheme.lower()
    if scheme not in ("smtp", "smtps", "smtp+starttls"):
        raise Undeliverable(f"{scheme!r} is not an SMTP scheme; use smtps://, "
                            "smtp+starttls:// or smtp://")
    host = url.hostname or ""
    if scheme == "smtp" and host not in ("localhost", "127.0.0.1", "::1"):
        raise Undeliverable(
            "plain smtp:// is only allowed to localhost. A reset link crossing "
            "the internet in clear text is worse than no reset link -- use "
            "smtps:// or smtp+starttls://")
    port = url.port or (465 if scheme == "smtps" else 587 if scheme.endswith(
        "starttls") else 25)
    return {"scheme": scheme, "host": host, "port": port,
            "user": unquote(url.username or ""),
            "password": unquote(url.password or "")}


def available() -> bool:
    """Whether this deployment can send an email at all."""
    try:
        return _settings() is not None
    except Undeliverable:
        return False


def sender() -> str:
    settings = _settings() or {}
    return os.environ.get(ENV_FROM) or settings.get("user") or "pilates@localhost"


def send(to: str, subject: str, body: str) -> None:
    """One plain-text message. Raises where mail is configured and fails.

    Plain text on purpose. Everything this sends is a sentence and a link, and
    an HTML email is a way to make a password reset look like a phishing
    attempt.
    """
    settings = _settings()
    if settings is None:
        raise Undeliverable("no mail server is configured on this deployment")

    message = EmailMessage()
    message["From"] = sender()
    message["To"] = to
    message["Subject"] = subject
    message.set_content(body)

    context = ssl.create_default_context()
    try:
        if settings["scheme"] == "smtps":
            server = smtplib.SMTP_SSL(settings["host"], settings["port"],
                                      timeout=TIMEOUT, context=context)
        else:
            server = smtplib.SMTP(settings["host"], settings["port"],
                                  timeout=TIMEOUT)
        with server:
            if settings["scheme"].endswith("starttls"):
                server.starttls(context=context)
            if settings["user"]:
                server.login(settings["user"], settings["password"])
            server.send_message(message)
    except (smtplib.SMTPException, OSError, ssl.SSLError) as exc:
        raise Undeliverable(f"the mail server refused it: {exc}") from exc
