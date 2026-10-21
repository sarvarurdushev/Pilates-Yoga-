"""``/sedens/`` routes for customer sign-in links (decisions in :mod:`pilates.sedens.accounts`).

``GET facility/customers``      a facility administrator: their customers, whether each can
                                sign in yet, and any open link (never the link itself)
``POST facility/people/link``   a facility administrator: ``{user_id, purpose}`` -> the link, once
``POST account/password``       no session: ``{token, password}`` from the link holder; the
                                token travels only in the body. Every sign-in of that
                                customer ends, including this browser's.
``GET passport/account-activity`` the signed-in customer's own sign-in activity

Responses are never cached (``_respond`` sends ``no-store``).
"""

from __future__ import annotations

from . import accounts
from ..platform import http as platform_http


def _customers(r):
    actor = r.actor()
    with r.sedens.db() as db:
        return accounts.customers(r.sedens, db, actor)


def _link(r):
    r.limit("account_link")
    actor = r.actor()
    with r.sedens.batch(), r.sedens.db() as db:
        return accounts.issue_link(r.sedens, db, actor, r.body.get("user_id"), r.body.get("purpose"))


def _password(r):
    # Per visitor address, as many attempts as the platform sign-in allows.
    r.limit("account_password")
    result = accounts.set_password(r.sedens, r.body.get("token"), r.body.get("password"))
    # This browser is signed out too, whoever was signed in on it.
    r.set_cookies.append(platform_http.cookie(r.h, ""))
    return result


def _activity(r):
    actor = r.actor()
    with r.sedens.db() as db:
        return accounts.activity(r.sedens, db, actor)


ROUTES = {
    ("GET", "facility/customers"): _customers,
    ("POST", "facility/people/link"): _link,
    ("POST", "account/password"): _password,
    ("GET", "passport/account-activity"): _activity,
}
