"""``/sedens/passport/...`` routes: a customer's own Fitness Passport.

Authorization is decided here and in :mod:`pilates.sedens.passport`, never by what
the page chooses to show. Every route is for the signed-in customer, about
themself (a student account, scoped by its user and organization); staff,
creators, reviewers and a room screen's device token are refused. No route takes
a customer id. Responses are never cached; the export is an attachment.
"""

from __future__ import annotations

import json

from . import passport, passport_privacy
from .util import Denied, now


def _customer(fn, *, batch=False, body=False):
    """A handler: the signed-in actor, the language asked for, and one transaction when it writes."""
    def handler(r):
        actor = r.actor()
        locale = passport.lang(r.query.get("lang") if not body else r.body.get("lang", r.query.get("lang")))
        args = (r.body,) if body else ()
        if batch:
            with r.sedens.batch(), r.sedens.db() as db:
                return fn(r.sedens, db, actor, locale, *args)
        with r.sedens.db() as db:
            return fn(r.sedens, db, actor, locale, *args)
    return handler


def _history(r):
    actor = r.actor()
    try:
        limit = int(r.query.get("limit", 20))
    except ValueError as exc:
        raise Denied("Choose a number of items from 1 to 50.", 400, "invalid") from exc
    with r.sedens.db() as db:
        return passport.history(r.sedens, db, actor, passport.lang(r.query.get("lang")),
                                before=r.query.get("before") or None, limit=limit)


def _workout(r):
    actor = r.actor()
    with r.sedens.db() as db:
        return passport.workout(r.sedens, db, actor, passport.lang(r.query.get("lang")), r.query.get("id"))


def _compare(r):
    actor = r.actor()
    with r.sedens.db() as db:
        return passport.scan_comparison(r.sedens, db, actor, passport.lang(r.query.get("lang")),
                                        r.query.get("earlier"), r.query.get("later"))


def _preferences_save(r):
    actor = r.actor()
    data = {k: v for k, v in r.body.items() if k != "lang"}
    with r.sedens.batch(), r.sedens.db() as db:
        return passport_privacy.save_preferences(r.sedens, db, actor, passport.lang(r.body.get("lang")), data)


def _export(r):
    """GET passport/export: the customer's own data as a JSON file to save."""
    actor = r.actor()
    with r.sedens.db() as db:
        data = passport_privacy.export(r.sedens, db, actor)
    body = json.dumps(data, ensure_ascii=False, indent=2).encode()
    name = f"sedens-passport-{now()[:10]}.json"
    r.h.send_response(200)
    r.h.send_header("Content-Type", "application/json; charset=utf-8")
    r.h.send_header("Content-Length", str(len(body)))
    r.h.send_header("Content-Disposition", f'attachment; filename="{name}"')
    r.h.send_header("Cache-Control", "no-store")
    r.h.send_header("X-Content-Type-Options", "nosniff")
    r.h.end_headers()
    r.h.wfile.write(body)
    return None


ROUTES = {
    ("GET", "passport/overview"): _customer(passport.overview),
    ("GET", "passport/history"): _history,
    ("GET", "passport/workout"): _workout,
    ("GET", "passport/scans"): _customer(passport.scans),
    ("GET", "passport/scans/compare"): _compare,
    ("GET", "passport/programs"): _customer(passport.programs),
    ("GET", "passport/achievements"): _customer(passport.achievements),
    ("GET", "passport/preferences"): _customer(passport_privacy.preferences),
    ("POST", "passport/preferences"): _preferences_save,
    ("GET", "passport/privacy"): _customer(passport_privacy.privacy),
    ("POST", "passport/privacy/photos/delete"): _customer(passport_privacy.delete_photos, batch=True),
    ("POST", "passport/privacy/request"): _customer(passport_privacy.request_erasure, batch=True, body=True),
    ("POST", "passport/privacy/request/withdraw"): _customer(passport_privacy.withdraw_request, batch=True, body=True),
}

# The export writes its own response (an attachment).
STREAMS = {("GET", "passport/export"): _export}
