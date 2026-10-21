"""The facility's side of customers' erasure requests (``s_data_requests``).

A customer records the request in the Passport (:mod:`passport_privacy`); the
administrator of that customer's facility lists the organization's requests here
and decides each one. SEDENS performs no deletion when a request is decided:
"completed" records that the facility handled it outside SEDENS. Attendance,
purchase and room-visit records need a retention policy that does not exist yet,
so nothing in this module touches them. The only thing SEDENS can delete by
itself today is retained scan photos, which the customer already deletes from
their own Passport.

The organization always comes from the signed-in administrator, never from the
request. Only the customer's display name is shown; no other customer data.
"""

from __future__ import annotations

from .util import Denied, decode, now

MAX_NOTE = 500
DECISIONS = ("completed", "declined")

def _facility_admin(sedens, db, actor) -> str:
    if actor is None or actor.role != "admin":
        raise Denied("Only a facility administrator can see data requests.", 403, "admin_required")
    org = sedens.org(db, actor.org_id)
    if org is None or org["kind"] != "facility":
        raise Denied("Data requests are for facility administrators.", 403, "facility_required")
    return actor.org_id


def _item(row) -> dict:
    return {"id": row["id"], "kind": row["kind"], "state": row["state"], "customer": row["name"] or "",
            "requested_at": row["requested_at"], "decided_at": row["decided_at"],
            "message": decode(row["detail"], {}).get("message", ""), "note": row["note"] or ""}


def _rows(db, org_id, request_id=None):
    return db.execute(
        "SELECT d.*, u.name FROM s_data_requests d LEFT JOIN p_users u ON u.id=d.user_id AND u.org_id=d.org_id "
        "WHERE d.org_id=? AND (? IS NULL OR d.id=?) ORDER BY d.requested_at DESC, d.rowid DESC",
        (org_id, request_id, request_id)).fetchall()


def listing(sedens, db, actor) -> dict:
    org_id = _facility_admin(sedens, db, actor)
    items = [_item(r) for r in _rows(db, org_id)]
    return {"items": items, "open": sum(1 for i in items if i["state"] == "received"),
            "max_note": MAX_NOTE, "deletes_data": False}


def decide(sedens, db, actor, data) -> dict:
    org_id = _facility_admin(sedens, db, actor)
    request_id, decision, note = data.get("id"), data.get("decision"), data.get("note", "")
    if decision not in DECISIONS:
        raise Denied("Choose completed or declined.", 400, "invalid")
    if note is None:
        note = ""
    if not isinstance(note, str) or len(note) > MAX_NOTE:
        raise Denied(f"Keep the note under {MAX_NOTE} characters.", 400, "invalid")
    note = note.strip()
    if decision == "declined" and not note:
        raise Denied("Add a note that says why the request is declined.", 400, "note_required")
    found = _rows(db, org_id, request_id) if isinstance(request_id, str) and request_id else []
    if not found:
        raise Denied("This request is not addressed to your facility.", 404, "unknown_request")
    row = found[0]
    if row["state"] != "received":
        raise Denied("This request was already decided or withdrawn.", 409, "not_open")
    changed = db.execute(
        "UPDATE s_data_requests SET state=?, decided_at=?, decided_by=?, note=? WHERE id=? AND org_id=? "
        "AND state='received'", (decision, now(), actor.user_id, note, row["id"], org_id)).rowcount
    if changed != 1:
        raise Denied("This request was already decided or withdrawn.", 409, "not_open")
    sedens.audit(db, org_id, actor.user_id, "data_request:" + decision, row["id"],
                 {"customer_id": row["user_id"], "kind": row["kind"], "deleted": False})
    return {"item": _item(_rows(db, org_id, row["id"])[0]), "open": sum(
        1 for r in _rows(db, org_id) if r["state"] == "received")}
