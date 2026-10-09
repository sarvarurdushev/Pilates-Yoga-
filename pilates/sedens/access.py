"""Who may do what with a course: the one place these rules live.

Every route and page asks this module; nothing infers access from whether a
course happens to be listed. The questions are:

``can_view_metadata``      see the title, creator, overview, module and session
                           titles, price and progress
``can_enroll``             add it to one's courses (free, included, or after a
                           demonstration purchase)
``can_play_in_room``       launch a guided workout. **Only inside an authorized
                           room** (:func:`pilates.sedens.rooms.authorize`), and
                           only where that facility enabled the course. Owning a
                           course does not change this; home playback is a
                           future option and is off (``HOME_PLAYBACK``).
``can_download_resource``  open a professional-education file (PDF, video,
                           image) outside a room, once enrolled
``can_edit``               the course's own creator only, never a facility
``can_review``             a SEDENS reviewer, never on their own course

Three independent course settings feed them:

* **distribution** (who may offer it): ``creator_only``; ``selected_facilities``
  (the facilities the creator listed); ``network`` (the creator's home facility
  and their approved affiliations); ``marketplace`` (any facility, and any
  customer may see it);
* **price**: free or paid, plus per-facility *free terms* the creator grants
  (for example a paid marketplace course free for one partner facility);
* **visibility**: only a published, unsuspended, unarchived version is seen by
  anyone other than its creator and SEDENS reviewers.

A facility then decides, for courses offered to it, whether they are
**enabled** in its rooms, **included** for its members (only where the course
is free there: a facility cannot give away a paid course) and **featured**.

Demonstrations are isolated per visitor: a demo organization only ever sees
courses of the same demonstration key.
"""

from __future__ import annotations

from . import capabilities
from .util import Denied, decode, environment

HOME_PLAYBACK = False  # B2C home playback is designed for, and off.
__all__ = ["environment"]


def published(course) -> bool:
    return bool(course["published_version"]) and not course["suspended_at"] and not course["archived_at"]


def _price(db, course_id):
    found = db.execute("SELECT * FROM s_course_prices WHERE course_id=?", (course_id,)).fetchone()
    return found


def is_free(db, course_id) -> bool:
    found = _price(db, course_id)
    return found is None or found["price_type"] == "free"


def on_sale(db, course_id) -> bool:
    found = _price(db, course_id)
    return found is not None and found["price_type"] == "paid" and found["sale_state"] == "active"


def _creator_home(db, course):
    found = db.execute(
        "SELECT u.org_id FROM s_creator_profiles c JOIN p_users u ON u.id=c.user_id WHERE c.id=?",
        (course["creator_id"],)).fetchone()
    return found[0] if found else None


def network_basis(db, course, facility_id, location_id=None) -> str | None:
    """Whether a facility is in the course creator's network: their own facility
    ('home_facility') or one that approved an affiliation ('approved_affiliation')."""
    if _creator_home(db, course) == facility_id:
        return "home_facility"
    for a in db.execute(
        "SELECT location_id FROM s_creator_facility_affiliations WHERE creator_id=? AND org_id=? AND status='approved'",
        (course["creator_id"], facility_id)):
        if a[0] is None or location_id is None or a[0] == location_id:
            return "approved_affiliation"
    return None


def offered_to(sedens, db, course, facility_id, location_id=None, *, draft_ok=False) -> dict | None:
    """Whether a facility (or one of its locations) may offer this course, and
    whether it is free there. None when it may not.

    Selected facilities and per-facility free terms count only while the facility
    is still in the creator's network: ending an affiliation ends them."""
    facility = sedens.org(db, facility_id) if facility_id else None
    owner = sedens.org(db, course["owner_org_id"])
    if facility is None or owner is None or facility["kind"] != "facility":
        return None
    if environment(facility) != environment(owner):
        return None
    if not draft_ok and not published(course):
        return None
    network = network_basis(db, course, facility_id, location_id)
    terms = [t for t in db.execute(
        "SELECT location_id, free FROM s_course_facility_terms WHERE course_id=? AND org_id=?",
        (course["id"], facility_id)) if location_id is None or t[0] in (None, location_id)] if network else []
    distribution = course["distribution"]
    basis = None
    if distribution == "marketplace":
        basis = "marketplace"
    elif distribution == "selected_facilities" and terms:
        basis = "selected"
    elif distribution == "network":
        basis = network
    if basis is None:
        return None
    return {"basis": basis, "free": is_free(db, course["id"]) or any(t[1] for t in terms),
            "own_program": course["owner_org_id"] == facility_id}


def facility_setting(db, facility_id, course_id) -> dict:
    found = db.execute("SELECT * FROM s_facility_course_settings WHERE org_id=? AND course_id=?",
                       (facility_id, course_id)).fetchone()
    if found is None:
        return {"enabled": False, "included": False, "featured": False}
    return {"enabled": bool(found["enabled"]), "included": bool(found["included"]), "featured": bool(found["featured"])}


def enabled_at(sedens, db, course, facility_id, location_id=None) -> dict | None:
    """The facility's offer to its members: offered to it and enabled there."""
    offer = offered_to(sedens, db, course, facility_id, location_id)
    if offer is None:
        return None
    setting = facility_setting(db, facility_id, course["id"])
    if not setting["enabled"]:
        return None
    return {**offer, "included": setting["included"] and offer["free"], "featured": setting["featured"]}


def _member(db, user_id, org_id) -> bool:
    return db.execute(
        "SELECT 1 FROM p_users u JOIN p_roles r ON r.user_id=u.id AND r.role='student' "
        "WHERE u.id=? AND u.org_id=? AND u.active=1", (user_id, org_id)).fetchone() is not None


def _member_location_ok(sedens, db, course, user_id, facility_id) -> bool:
    """A location-scoped offer reaches only customers assigned to that location."""
    locations = [r[0] for r in db.execute("SELECT location_id FROM p_student_locations WHERE student_id=?", (user_id,))]
    if not locations:
        return enabled_at(sedens, db, course, facility_id) is not None
    return any(enabled_at(sedens, db, course, facility_id, loc) for loc in locations)


def entitlements(sedens, db, user_id, course) -> list[dict]:
    """Stored entitlements that still stand. A facility's free or included offer
    stands only while that facility still offers, enables and frees the course."""
    out = []
    for e in db.execute("SELECT * FROM s_entitlements WHERE user_id=? AND course_id=? AND revoked_at IS NULL",
                        (user_id, course["id"])):
        if e["source"] in ("facility_free", "facility_included"):
            offer = enabled_at(sedens, db, course, e["facility_id"]) if e["facility_id"] else None
            if offer is None or not offer["free"] or not _member(db, user_id, e["facility_id"]):
                continue
            if e["source"] == "facility_included" and not offer["included"]:
                continue
        if e["source"] == "demo_purchase":
            purchase = db.execute("SELECT state FROM s_purchases WHERE id=?", (e["purchase_id"],)).fetchone()
            if purchase is None or purchase[0] != "demo_completed":
                continue
        out.append({"id": e["id"], "source": e["source"], "facility_id": e["facility_id"],
                    "purchase_id": e["purchase_id"], "granted_at": e["granted_at"]})
    return out


def enrollment(db, user_id, course_id):
    return db.execute("SELECT * FROM s_enrollments WHERE user_id=? AND course_id=?", (user_id, course_id)).fetchone()


def effective_version(db, course, enrolled) -> int | None:
    """The version an enrolled person uses: their own while SEDENS stands behind it
    (published, or superseded by a newer one), otherwise the published version.
    Only a restore leaves an enrollment elsewhere: restored versions are reviewed again."""
    if enrolled is None:
        return course["published_version"]
    state = db.execute("SELECT state FROM s_course_versions WHERE course_id=? AND version=?",
                       (course["id"], enrolled["version"])).fetchone()
    if state is not None and state[0] in ("published", "superseded"):
        return enrolled["version"]
    return course["published_version"]


# -- the six questions ----------------------------------------------------------------


def can_edit(sedens, db, actor, course) -> bool:
    if actor is None or actor.org_id != course["owner_org_id"]:
        return False
    owner = db.execute("SELECT user_id FROM s_creator_profiles WHERE id=?", (course["creator_id"],)).fetchone()
    return owner is not None and owner[0] == actor.user_id and capabilities.has(sedens, db, actor, "creator")


def can_review(sedens, db, actor, course) -> bool:
    if actor is None or not capabilities.has(sedens, db, actor, "sedens_reviewer"):
        return False
    reviewer_org, owner = sedens.org(db, actor.org_id), sedens.org(db, course["owner_org_id"])
    if environment(reviewer_org) != environment(owner):
        return False
    creator = db.execute("SELECT user_id FROM s_creator_profiles WHERE id=?", (course["creator_id"],)).fetchone()
    return creator is not None and creator[0] != actor.user_id


def can_view_metadata(sedens, db, actor, course) -> bool:
    if actor is None:
        return False
    if can_edit(sedens, db, actor, course) or can_review(sedens, db, actor, course):
        return True
    if not published(course):
        return False
    viewer, owner = sedens.org(db, actor.org_id), sedens.org(db, course["owner_org_id"])
    if environment(viewer) != environment(owner):
        return False
    if course["distribution"] == "marketplace":
        return True
    if actor.role == "student":
        if entitlements(sedens, db, actor.user_id, course) or enrollment(db, actor.user_id, course["id"]):
            return True
        return _member(db, actor.user_id, actor.org_id) and _member_location_ok(sedens, db, course, actor.user_id, actor.org_id)
    # Facility staff see what is offered to their facility, to decide about it.
    return actor.role == "admin" and offered_to(sedens, db, course, actor.org_id) is not None


def enroll_option(sedens, db, actor, course) -> dict:
    """How this person could enroll: {'ok', 'reason', 'source', 'facility_id'}.
    ``source`` is the entitlement an enrollment would rest on."""
    if not can_view_metadata(sedens, db, actor, course) or not published(course):
        return {"ok": False, "reason": "not_available"}
    if course["course_type"] == "guided_training" and actor.role != "student":
        return {"ok": False, "reason": "customers_only"}
    if enrollment(db, actor.user_id, course["id"]):
        return {"ok": False, "reason": "already_enrolled"}
    held = entitlements(sedens, db, actor.user_id, course)
    if held:
        return {"ok": True, "reason": "entitled", "source": held[0]["source"], "entitlement_id": held[0]["id"]}
    if actor.role == "student" and _member(db, actor.user_id, actor.org_id):
        offer = enabled_at(sedens, db, course, actor.org_id)
        if offer and offer["free"] and _member_location_ok(sedens, db, course, actor.user_id, actor.org_id):
            return {"ok": True, "reason": "facility", "source": "facility_included" if offer["included"] else "facility_free",
                    "facility_id": actor.org_id}
    if course["distribution"] == "marketplace" and is_free(db, course["id"]):
        return {"ok": True, "reason": "free", "source": "marketplace_free"}
    if on_sale(db, course["id"]):
        return {"ok": False, "reason": "purchase_required"}
    return {"ok": False, "reason": "not_available"}


def can_enroll(sedens, db, actor, course) -> bool:
    return enroll_option(sedens, db, actor, course)["ok"]


def can_play_in_room(sedens, db, room, course) -> dict:
    """{'ok': bool, 'reason': str}. ``room`` is a RoomContext from rooms.authorize();
    without one the answer is always no."""
    if room is None:
        return {"ok": HOME_PLAYBACK, "reason": "room_only"}
    if course["course_type"] != "guided_training":
        return {"ok": False, "reason": "not_guided_training"}
    if not published(course):
        return {"ok": False, "reason": "not_available"}
    offer = enabled_at(sedens, db, course, room.org_id, room.location_id)
    if offer is None:
        return {"ok": False, "reason": "not_enabled_here"}
    if entitlements(sedens, db, room.student_id, course):
        return {"ok": True, "reason": "entitled"}
    if offer["free"] and _member(db, room.student_id, room.org_id):
        return {"ok": True, "reason": "free_here"}
    return {"ok": False, "reason": "purchase_required"}


def can_download_resource(sedens, db, actor, course, object_id) -> bool:
    """Professional-education files for enrolled people. Guided-training media is
    never downloadable: it plays in the room only."""
    if actor is None:
        return False
    if can_edit(sedens, db, actor, course) or can_review(sedens, db, actor, course):
        return True
    if course["course_type"] != "professional_education" or not published(course):
        return False
    enrolled = enrollment(db, actor.user_id, course["id"])
    if enrolled is None or not entitlements(sedens, db, actor.user_id, course):
        return False
    return _in_version(db, course["id"], effective_version(db, course, enrolled), object_id)


def _in_version(db, course_id, number, object_id) -> bool:
    return db.execute(
        "SELECT 1 FROM s_course_version_media m JOIN s_course_versions v ON v.id=m.version_id "
        "WHERE v.course_id=? AND v.version=? AND m.object_id=?", (course_id, number, object_id)).fetchone() is not None


# -- course media -----------------------------------------------------------------------


def media_access(sedens, db, actor, room, object_id) -> dict:
    """The stored file a person may read, or Denied 404 (existence is not revealed).

    Course media is reachable only here: never through /platform/media, and
    never by building an Actor for another organization."""
    hidden = Denied("This file is not available.", 404, "media_not_found")
    found = db.execute("SELECT * FROM s_media_objects WHERE id=?", (object_id,)).fetchone() if object_id else None
    if found is None:
        raise hidden
    allowed = False
    # The creator's own files.
    if actor is not None and actor.org_id == found["owner_org_id"] and capabilities.has(sedens, db, actor, "creator"):
        profile = db.execute("SELECT id FROM s_creator_profiles WHERE user_id=?", (actor.user_id,)).fetchone()
        allowed = profile is not None and (found["creator_id"] in (None, profile[0]) or actor.role == "admin")
    courses = [r for r in db.execute(
        "SELECT DISTINCT c.*, v.version AS v_version, v.state AS v_state FROM s_course_version_media m "
        "JOIN s_course_versions v ON v.id=m.version_id JOIN s_courses c ON c.id=v.course_id WHERE m.object_id=?",
        (object_id,))]
    for c in courses:
        if allowed:
            break
        # A reviewer sees what was submitted for review.
        if actor is not None and c["v_state"] in ("submitted", "published", "needs_revision") and can_review(sedens, db, actor, c):
            allowed = True
        # A published cover picture is part of the course's public description.
        elif actor is not None and c["cover_media_id"] == object_id and found["kind"] == "image" \
                and c["v_version"] == c["published_version"] and can_view_metadata(sedens, db, actor, c):
            allowed = True
        elif c["v_version"] == c["published_version"] or (
                actor is not None and c["v_version"] == effective_version(db, c, enrollment(db, actor.user_id, c["id"]))):
            if room is not None and can_play_in_room(sedens, db, room, c)["ok"]:
                allowed = True
            elif actor is not None and can_download_resource(sedens, db, actor, c, object_id):
                allowed = True
    if not allowed:
        raise hidden
    return {"object": found, "download": found["kind"] == "pdf"}


def course_card(sedens, db, actor, course, *, facility_id=None) -> dict:
    """What a customer list shows for a course (no draft content)."""
    from . import courses as course_store

    snapshot = decode(db.execute("SELECT snapshot FROM s_course_versions WHERE course_id=? AND version=?",
                                 (course["id"], course["published_version"])).fetchone()[0], {}) \
        if course["published_version"] else {}
    owner = sedens.org(db, course["owner_org_id"])
    badge = {"sedens": "sedens_standard", "facility": "facility_program"}.get(owner["kind"], "premium_expert")
    creator = db.execute("SELECT display_name, creator_type, verification_state FROM s_creator_profiles WHERE id=?",
                         (course["creator_id"],)).fetchone()
    held = entitlements(sedens, db, actor.user_id, course) if actor is not None else []
    enrolled = enrollment(db, actor.user_id, course["id"]) if actor is not None else None
    here = enabled_at(sedens, db, course, facility_id or (actor.org_id if actor else None)) if actor is not None else None
    meta = snapshot.get("course", course_store.metadata(course))
    return {
        "id": course["id"], "title": meta["title"], "subtitle": meta["subtitle"], "course_type": meta["course_type"],
        "language": meta["language"], "level": meta["level"], "category": meta["category"],
        "equipment": meta["equipment"], "estimated_minutes": meta["estimated_minutes"], "weeks": meta["weeks"],
        "sessions_per_week": meta["sessions_per_week"], "cover_media_id": meta.get("cover_media_id"),
        "badge": badge, "demo": bool(owner["demo"]),
        "creator": {"display_name": creator["display_name"], "creator_type": creator["creator_type"],
                    "verified": creator["verification_state"] == "verified",
                    "verification_state": creator["verification_state"]} if creator else None,
        "price": course_store.price(db, course["id"]),
        "free_here": bool(here and here["free"]), "included_here": bool(here and here["included"]),
        "enabled_here": here is not None, "featured_here": bool(here and here["featured"]),
        "enrolled": enrolled is not None, "purchased": any(e["source"] == "demo_purchase" for e in held),
        "distribution": course["distribution"],
    }
