"""Customers choose their own password (Phase 4, docs/SEDENS_SECURITY_MODEL.md section 11).

Staff can no longer set a customer's password or change the email of a customer who
already signs in (``Repository.save_person`` refuses both). Instead a facility
administrator creates a one-time sign-in link and gives it to the customer:

``issue_link``    an administrator of the customer's own facility; 32 random bytes, only
                  their SHA-256 stored; ``setup`` lasts 72 hours, ``reset`` 30 minutes; a
                  newer link for the same customer ends the older unused ones. The link is
                  returned once and never shown again.
``set_password``  whoever holds the link (no session): the platform's password rules and
                  hash; the link is consumed in the same transaction that writes the
                  password; every sign-in of that customer ends, with their unused room
                  codes and live room sessions. An unknown, used, replaced or expired link
                  gets the same answer.
``activity``      the customer's own "Sign-in activity" (``s_account_events``), newest first.

What this does not prevent: the administrator who creates a link could open it
themself. That is visible to the customer (the link and the password change are listed
in their activity, and their own sessions end), not prevented; preventing it needs a
channel only the customer controls (a verified e-mail or phone), see section 11.4.
"""

from __future__ import annotations

from datetime import timedelta
import secrets

from ..platform.repository import Refused, password_hash
from . import passport, rooms
from .util import Denied, digest, iso, now, parse, uid, utcnow

PURPOSES = {"setup": timedelta(hours=72), "reset": timedelta(minutes=30)}
LINK_PATH = "/#/account/setup?token="
NOT_VALID = "This sign-in link can no longer be used. Ask your facility for a new one."
MAX_EVENTS = 50


def _facility_admin(sedens, db, actor) -> dict:
    if actor is None or actor.role != "admin":
        raise Denied("Only a facility administrator can create sign-in links.", 403, "admin_required")
    org = sedens.org(db, actor.org_id)
    if org is None or org["kind"] != "facility":
        raise Denied("Sign-in links are for customers of a facility.", 403, "facility_required")
    return org


def _customer(db, org_id, user_id):
    """An active account of this organization that holds the customer (student) role."""
    return db.execute(
        "SELECT u.id,u.org_id,u.name,u.password_hash FROM p_users u "
        "JOIN p_roles r ON r.user_id=u.id AND r.role='student' JOIN p_students s ON s.id=u.id "
        "WHERE u.id=? AND u.org_id=? AND u.active=1",
        (str(user_id or ""), org_id),
    ).fetchone()


def event(db, user_id, org_id, kind, actor_id, purpose=None, at=None) -> None:
    db.execute(
        "INSERT INTO s_account_events(id,user_id,org_id,kind,purpose,actor_id,at) VALUES (?,?,?,?,?,?,?)",
        (uid(), user_id, org_id, kind, purpose, actor_id, at or now()),
    )


def _open_link(db, user_id):
    """The customer's usable link (purpose and expiry only), if any."""
    row = db.execute(
        "SELECT purpose,issued_at,expires_at FROM s_account_links WHERE user_id=? AND used_at IS NULL "
        "AND superseded_at IS NULL ORDER BY issued_at DESC LIMIT 1",
        (user_id,),
    ).fetchone()
    if row is None or parse(row["expires_at"]) <= utcnow():
        return None
    return {"purpose": row["purpose"], "issued_at": row["issued_at"], "expires_at": row["expires_at"]}


def customers(sedens, db, actor) -> dict:
    """The facility console's customer list: who can sign in yet, and any open link."""
    org = _facility_admin(sedens, db, actor)
    items = []
    for row in db.execute(
        "SELECT u.id,u.name,u.password_hash FROM p_users u JOIN p_roles r ON r.user_id=u.id AND r.role='student' "
        "JOIN p_students s ON s.id=u.id WHERE u.org_id=? AND u.active=1 ORDER BY u.name, u.id",
        (actor.org_id,),
    ).fetchall():
        items.append({"id": row["id"], "name": row["name"], "has_password": bool(row["password_hash"]),
                      "open_link": _open_link(db, row["id"])})
    return {"demo": org["demo"], "items": items}


def issue_link(sedens, db, actor, user_id, purpose) -> dict:
    """A one-time link for a customer of the administrator's own facility. Call inside a batch."""
    org = _facility_admin(sedens, db, actor)
    if purpose not in PURPOSES:
        raise Denied("Choose a setup link or a reset link.", 400, "invalid_purpose")
    if org["demo"]:
        raise Denied("Demonstration customers sign in from the demonstration page. They don't need a password.",
                     409, "demo_no_password")
    customer = _customer(db, actor.org_id, user_id)
    if customer is None:
        raise Denied("Choose a customer of this facility.", 404, "customer_not_found")
    if purpose == "setup" and customer["password_hash"]:
        raise Denied("This customer already has a password. Create a reset link instead.", 409, "already_set_up")
    issued = utcnow()
    secret = secrets.token_urlsafe(32)  # 32 random bytes
    moment, expires = iso(issued), iso(issued + PURPOSES[purpose])
    db.execute("UPDATE s_account_links SET superseded_at=? WHERE user_id=? AND used_at IS NULL "
               "AND superseded_at IS NULL", (moment, customer["id"]))
    db.execute(
        "INSERT INTO s_account_links(id,token_hash,user_id,org_id,purpose,issued_by,issued_at,expires_at) "
        "VALUES (?,?,?,?,?,?,?,?)",
        (uid(), digest(secret), customer["id"], actor.org_id, purpose, actor.user_id, moment, expires),
    )
    event(db, customer["id"], actor.org_id, "link_issued", actor.user_id, purpose, moment)
    return {"link": LINK_PATH + secret, "purpose": purpose, "expires_at": expires,
            "customer": {"id": customer["id"], "name": customer["name"]}}


def set_password(sedens, token, password) -> dict:
    """The link holder chooses the password. Returns how many sign-ins were ended."""
    secret = token if isinstance(token, str) else ""
    try:
        # The platform's own rules and hash, checked before the link is looked at.
        hashed = password_hash(password)
    except Refused as exc:
        raise Denied(str(exc), 400, "password_rules") from exc
    if not 20 <= len(secret) <= 100:
        raise Denied(NOT_VALID, 400, "link_not_valid")
    with sedens.batch(), sedens.db() as db:
        link = db.execute(
            "SELECT l.*, o.demo FROM s_account_links l JOIN p_organizations o ON o.id=l.org_id WHERE l.token_hash=?",
            (digest(secret),),
        ).fetchone()
        usable = (link is not None and link["used_at"] is None and link["superseded_at"] is None
                  and parse(link["expires_at"]) > utcnow() and not link["demo"]
                  and _customer(db, link["org_id"], link["user_id"]) is not None)
        if not usable:
            raise Denied(NOT_VALID, 400, "link_not_valid")
        moment = now()
        if db.execute("UPDATE s_account_links SET used_at=? WHERE id=? AND used_at IS NULL AND superseded_at IS NULL",
                      (moment, link["id"])).rowcount != 1:
            raise Denied(NOT_VALID, 400, "link_not_valid")
        user_id, org_id = link["user_id"], link["org_id"]
        # Issuing already ends older links; this keeps "one usable link" true whatever wrote them.
        db.execute("UPDATE s_account_links SET superseded_at=? WHERE user_id=? AND used_at IS NULL "
                   "AND superseded_at IS NULL", (moment, user_id))
        db.execute("UPDATE p_users SET password_hash=? WHERE id=?", (hashed, user_id))
        ended = db.execute("DELETE FROM p_sessions WHERE user_id=?", (user_id,)).rowcount
        # Room entry does not go through p_sessions: unused room codes and live room
        # sessions this customer had end too (rooms.authorize never checks p_sessions).
        ended += db.execute("UPDATE s_room_access_codes SET cancelled_at=? WHERE student_id=? AND used_at IS NULL "
                            "AND cancelled_at IS NULL", (moment, user_id)).rowcount
        active = db.execute("SELECT count(*) FROM s_room_sessions WHERE student_id=? AND state='active'",
                            (user_id,)).fetchone()[0]
        rooms._end_where(db, "student_id=?", (user_id,), "revoked", "password_changed", org_id, bool(link["demo"]))
        ended += active
        event(db, user_id, org_id, "password_set_by_customer", user_id, link["purpose"], moment)
        event(db, user_id, org_id, "sessions_revoked", user_id, None, moment)
        db.execute(
            "INSERT INTO p_audit(org_id,actor_id,action,subject_id,created_at,detail) VALUES (?,?,?,?,?,?)",
            (org_id, user_id, "account:password_set_by_customer", user_id, moment, '{"sessions_ended": %d}' % ended),
        )
    return {"password_set": True, "sessions_ended": ended}


def activity(sedens, db, actor, locale="ko") -> dict:
    """The signed-in customer's own sign-in activity, newest first."""
    me = passport.customer(sedens, db, actor)
    items = []
    for row in db.execute(
        "SELECT e.kind,e.purpose,e.at,e.actor_id,u.name AS actor_name FROM s_account_events e "
        "LEFT JOIN p_users u ON u.id=e.actor_id WHERE e.user_id=? AND e.org_id=? "
        "ORDER BY e.at DESC, e.rowid DESC LIMIT ?",
        (me["user_id"], me["org_id"], MAX_EVENTS),
    ).fetchall():
        by_you = row["actor_id"] == me["user_id"]
        # A password chosen through a link was chosen by whoever held the link: the
        # customer is not told it was them (the link_issued line says who made it).
        by = "link" if row["kind"] == "password_set_by_customer" else "you" if by_you else "staff"
        items.append({"kind": row["kind"], "purpose": row["purpose"], "at": row["at"],
                      "by": by, "staff_name": None if by_you else row["actor_name"]})
    return {"items": items}
