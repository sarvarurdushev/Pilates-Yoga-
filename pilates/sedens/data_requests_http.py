"""``/sedens/facility/data-requests`` routes: the administrator of a facility reads and
decides its customers' erasure requests. The organization comes from the session.
Decisions are made in :mod:`pilates.sedens.data_requests`; nothing is deleted."""

from __future__ import annotations

from . import data_requests


def _list(r):
    actor = r.actor()
    with r.sedens.db() as db:
        return data_requests.listing(r.sedens, db, actor)


def _decide(r):
    actor = r.actor()
    with r.sedens.batch(), r.sedens.db() as db:
        return data_requests.decide(r.sedens, db, actor, r.body)


ROUTES = {
    ("GET", "facility/data-requests"): _list,
    ("POST", "facility/data-requests/decide"): _decide,
}
