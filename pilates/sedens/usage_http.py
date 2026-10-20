"""``/sedens/`` routes for facility usage and the fee simulation.

``GET facility/usage?month=YYYY-MM`` is for an administrator of a facility, about
their own organization only (the organization comes from the session, never from
the request). ``GET admin/usage-plans`` and ``POST admin/usage-plan`` are for
SEDENS administrators. The decisions are made in :mod:`pilates.sedens.usage`.
Responses are never cached.
"""

from __future__ import annotations

from . import usage


def _usage(r):
    actor = r.actor()
    with r.sedens.db() as db:
        return usage.usage(r.sedens, db, actor, r.query.get("month"))


def _plans(r):
    actor = r.actor()
    with r.sedens.db() as db:
        return usage.plans(r.sedens, db, actor)


def _assign(r):
    actor = r.actor()
    with r.sedens.batch(), r.sedens.db() as db:
        return usage.assign_plan(r.sedens, db, actor, r.body.get("org_id"), r.body.get("plan_id"))


ROUTES = {
    ("GET", "facility/usage"): _usage,
    ("GET", "admin/usage-plans"): _plans,
    ("POST", "admin/usage-plan"): _assign,
}
