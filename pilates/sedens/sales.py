"""Commercial availability of a course: kept apart from its reviewed content.

* **Content review state** (``courses.review_state``, the published version's
  snapshot): what the course is, who may offer it and its price. It changes only
  through SEDENS review.
* **Commercial availability** (this module, ``s_course_sales``): whether new
  customers may buy the approved version right now. The course's own creator can
  pause new sales at once and resume them later, with no review, no new version,
  no archive and no change to the snapshot.

A pause applies to the published version (and approved price) it was made on.
While it applies, nobody can start a new purchase; customers who already enrolled
or bought keep their access under the normal rules (``access.entitlements``), and
a facility's own free or included offer is governed separately. When SEDENS
approves a newer version, that version's reviewed sale status applies and the
creator may pause again. SEDENS suspension (``course_review.suspend``) still takes
the whole course down at once, paused or not.
"""

from __future__ import annotations

from .util import Denied, now


def _row(db, course_id):
    return db.execute("SELECT * FROM s_course_sales WHERE course_id=?", (course_id,)).fetchone()


def _approved_price(db, course) -> dict:
    from .access import in_force

    return in_force(db, course)["price"]


def _applies(db, course, row) -> bool:
    """A pause holds only for the published version and approved price it was made on."""
    if row is None or not course["published_version"] or row["version"] != course["published_version"]:
        return False
    price = _approved_price(db, course)
    return (row["price_type"], row["amount_minor"], row["currency"]) == \
        (price["price_type"], price["amount_minor"], price["currency"])


def paused(db, course) -> bool:
    """Whether new sales of this course are paused right now."""
    return _applies(db, course, _row(db, course["id"]))


def describe(db, course) -> dict:
    """What the Creator Studio shows about commercial availability."""
    from .access import published

    row = _row(db, course["id"])
    holding = _applies(db, course, row)
    price = _approved_price(db, course)
    sellable = published(course) and price["price_type"] == "paid" and price["sale_state"] == "active"
    return {"paused": holding, "paused_at": row["paused_at"] if holding else None,
            "version": course["published_version"], "can_pause": sellable and not holding,
            "can_resume": holding and published(course)}


def set_paused(sedens, db, actor, data) -> dict:
    """Pause or resume new sales of a published course (its creator only). Run inside
    ``sedens.batch()``. Does not change the course's revision: it is not an edit."""
    from . import courses
    from .access import can_edit

    course = courses.row(db, data.get("id"))
    if not can_edit(sedens, db, actor, course):
        raise Denied("This course does not exist.", 404, "unknown_course")
    if course["archived_at"]:
        raise Denied("This course is archived.", 409, "course_archived")
    if course["suspended_at"]:
        raise Denied("SEDENS suspended this course. Sales stay closed until SEDENS reinstates it.", 409,
                     "course_suspended")
    if not course["published_version"]:
        raise Denied("Only a published course has sales to pause or resume.", 409, "not_published")
    want = data.get("paused")
    if not isinstance(want, bool):
        raise Denied("Choose to pause or resume sales.", 400, "invalid")
    row = _row(db, course["id"])
    holding = _applies(db, course, row)
    price = _approved_price(db, course)
    if want:
        if holding:
            return describe(db, course)
        if price["price_type"] != "paid" or price["sale_state"] != "active":
            raise Denied("This course is not on sale, so there are no sales to pause.", 409, "not_for_sale")
        db.execute(
            "INSERT INTO s_course_sales(course_id,version,price_type,amount_minor,currency,paused_by,paused_at) "
            "VALUES (?,?,?,?,?,?,?) ON CONFLICT(course_id) DO UPDATE SET version=excluded.version, "
            "price_type=excluded.price_type, amount_minor=excluded.amount_minor, currency=excluded.currency, "
            "paused_by=excluded.paused_by, paused_at=excluded.paused_at",
            (course["id"], course["published_version"], price["price_type"], price["amount_minor"], price["currency"],
             actor.user_id, now()))
        sedens.audit(db, course["owner_org_id"], actor.user_id, "course:sales-paused", course["id"],
                     {"version": course["published_version"]})
        return describe(db, course)
    if not holding:
        # Nothing is paused for the version customers see now (never paused, already
        # resumed, or the pause belonged to an earlier version or price).
        raise Denied("Sales of this version are not paused.", 409, "not_paused")
    db.execute("DELETE FROM s_course_sales WHERE course_id=?", (course["id"],))
    sedens.audit(db, course["owner_org_id"], actor.user_id, "course:sales-resumed", course["id"],
                 {"version": course["published_version"]})
    return describe(db, course)
