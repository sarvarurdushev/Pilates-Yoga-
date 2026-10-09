"""Creator profiles and creator <-> facility affiliations.

Two permissions that must never be confused:

* **Content distribution** -- may this creator offer content to members of
  facility B? That is what an *approved affiliation* grants, and nothing else.
* **Customer data** -- may this person see facility B's members, visits,
  scans, notes or media? That is decided only by the platform's own roles and
  coach assignments inside facility B (``pilates.platform.repository``).

No function here reads or returns a facility's members. Selling or distributing
a course to facility B never creates a membership, role or coach assignment in
facility B.
"""

from __future__ import annotations

import re
from datetime import timedelta

from . import capabilities
from .util import Denied, decode, digest, encode, now, parse, text, uid, utcnow

TYPES_BY_ORG_KIND = {
    "facility": ("coach", "professor", "expert"),
    "creator_studio": ("professor", "expert"),
    "sedens": ("sedens_editorial",),
}
DEFAULT_TYPE = {"facility": "coach", "creator_studio": "professor", "sedens": "sedens_editorial"}
VERIFICATION_DECISIONS = ("verified", "rejected", "suspended", "unverified")
# A facility's "no" stands this long before the same creator may ask again.
DECLINE_COOLDOWN_DAYS = 30
# Editing any of these after review means the review no longer describes the profile.
REVIEWED_FIELDS = ("display_name", "creator_type", "bio", "institution", "qualifications", "specialties")


def _slug(db, name):
    base = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:40] or "creator"
    for _ in range(20):
        candidate = f"{base}-{uid()[:6]}"
        if not db.execute("SELECT 1 FROM s_creator_profiles WHERE slug=?", (candidate,)).fetchone():
            return candidate
    raise Denied("Could not reserve a profile address. Retry.", 409, "slug_conflict")


def _strings(value, field, items=10, length=120):
    if value in (None, ""):
        return []
    if not isinstance(value, list) or len(value) > items:
        raise Denied(f"{field}: list up to {items} entries.", 400, "invalid")
    return [text(v, length, field) for v in value if str(v).strip()]


def public(row) -> dict | None:
    """What anyone allowed to see a creator may see. No account or org data."""
    if row is None:
        return None
    return {
        "id": row["id"],
        "display_name": row["display_name"],
        "creator_type": row["creator_type"],
        "bio": row["bio"],
        "institution": row["institution"],
        "qualifications": decode(row["qualifications"], []),
        "specialties": decode(row["specialties"], []),
        "slug": row["slug"],
        "verification_state": row["verification_state"],
        # Self-declared fields are labelled as such until a reviewer verifies.
        "self_declared": row["verification_state"] != "verified",
        # A reviewer verifies this exact content: the decision must repeat it.
        "version": content_version(row),
    }


def content_version(row) -> str:
    """Fingerprint of the reviewed fields, so a verification names what was reviewed."""
    return digest(encode([row[field] for field in REVIEWED_FIELDS]))[:16]


def profile_row(db, user_id):
    return db.execute("SELECT * FROM s_creator_profiles WHERE user_id=?", (user_id,)).fetchone()


def own_profile(sedens, db, actor):
    return public(profile_row(db, actor.user_id))


def save_profile(sedens, db, actor, data):
    capabilities.require(sedens, db, actor, "creator")
    if not isinstance(data, dict):
        raise Denied("Enter the profile details.", 400, "invalid")
    forbidden = {"verification_state", "verified_by", "verified_at", "user_id", "slug", "id"} & set(data)
    if forbidden:
        raise Denied("Verification and identity fields cannot be edited here.", 400, "read_only_field")
    org = sedens.org(db, actor.org_id)
    allowed_types = TYPES_BY_ORG_KIND[org["kind"]]
    existing = profile_row(db, actor.user_id)
    creator_type = data.get("creator_type") or (existing["creator_type"] if existing else DEFAULT_TYPE[org["kind"]])
    if creator_type not in allowed_types:
        raise Denied("Choose a creator type available to this organization.", 400, "invalid_type")
    display_name = text(data.get("display_name") or (existing["display_name"] if existing else ""), 80, "Display name")
    if not display_name:
        raise Denied("Enter a display name.", 400, "invalid")
    values = {
        "display_name": display_name,
        "creator_type": creator_type,
        "bio": text(data.get("bio", existing["bio"] if existing else ""), 2000, "Biography"),
        "institution": text(data.get("institution", existing["institution"] if existing else ""), 160, "Institution"),
        "qualifications": encode(_strings(data.get("qualifications", decode(existing["qualifications"], []) if existing else []), "Qualifications")),
        "specialties": encode(_strings(data.get("specialties", decode(existing["specialties"], []) if existing else []), "Specialties", 12, 60)),
    }
    stamp = now()
    if existing:
        changed = any(values[field] != existing[field] for field in REVIEWED_FIELDS)
        db.execute(
            "UPDATE s_creator_profiles SET display_name=?,creator_type=?,bio=?,institution=?,qualifications=?,specialties=?,updated_at=? WHERE id=?",
            (*values.values(), stamp, existing["id"]),
        )
        if changed and existing["verification_state"] in ("verified", "pending"):
            # A verification covers the profile as reviewed; an edit needs a new review.
            db.execute(
                "UPDATE s_creator_profiles SET verification_state='unverified', verified_by=NULL, verified_at=NULL, "
                "verification_note='Profile changed after review.' WHERE id=?",
                (existing["id"],),
            )
            sedens.audit(db, actor.org_id, actor.user_id, "creator:verification-reset", existing["id"])
        identifier = existing["id"]
    else:
        identifier = uid()
        db.execute(
            "INSERT INTO s_creator_profiles(id,user_id,display_name,creator_type,bio,institution,qualifications,specialties,slug,created_at,updated_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (identifier, actor.user_id, *values.values(), _slug(db, display_name), stamp, stamp),
        )
    sedens.audit(db, actor.org_id, actor.user_id, "creator:profile", identifier)
    return public(profile_row(db, actor.user_id))


def request_verification(sedens, db, actor):
    capabilities.require(sedens, db, actor, "creator")
    row = profile_row(db, actor.user_id)
    if row is None:
        raise Denied("Create your creator profile first.", 400, "no_profile")
    if row["verification_state"] in ("unverified", "rejected"):
        db.execute("UPDATE s_creator_profiles SET verification_state='pending', updated_at=? WHERE id=?", (now(), row["id"]))
        sedens.audit(db, actor.org_id, actor.user_id, "creator:verification-request", row["id"])
    return public(profile_row(db, actor.user_id))


def decide_verification(sedens, db, actor, creator_id, decision, note="", version=None):
    """Run inside ``sedens.batch()`` so the profile cannot change between the
    check and the decision."""
    capabilities.require(sedens, db, actor, "sedens_reviewer")
    if decision not in VERIFICATION_DECISIONS:
        raise Denied("Choose verified, rejected, suspended or unverified.", 400, "invalid")
    row = db.execute(
        "SELECT c.*, u.org_id FROM s_creator_profiles c JOIN p_users u ON u.id=c.user_id WHERE c.id=?",
        (creator_id,),
    ).fetchone()
    if row is None:
        raise Denied("Choose an existing creator.", 404, "unknown_creator")
    if sedens.org(db, row["org_id"])["demo"] != actor.demo:
        raise Denied("Choose a creator in the same environment.", 403, "environment_mismatch")
    if row["user_id"] == actor.user_id:
        raise Denied("Another SEDENS reviewer must review your own creator profile.", 403, "self_review")
    if decision == "verified" and row["verification_state"] != "pending":
        raise Denied("Only a profile waiting for review can be verified.", 409, "not_pending")
    if decision == "verified" and version != content_version(row):
        raise Denied("This profile changed after you opened it. Review it again.", 409, "profile_changed")
    stamp = now()
    changed = db.execute(
        "UPDATE s_creator_profiles SET verification_state=?, verified_by=?, verified_at=?, verification_note=?, updated_at=? "
        "WHERE id=? AND verification_state=? AND updated_at=?",
        (decision, actor.user_id, stamp, text(note, 1000, "Note"), stamp, creator_id,
         row["verification_state"], row["updated_at"]),
    ).rowcount
    if not changed:
        raise Denied("This profile changed after you opened it. Review it again.", 409, "profile_changed")
    sedens.audit(db, row["org_id"], actor.user_id, "creator:verification", creator_id, {"decision": decision})
    return public(db.execute("SELECT * FROM s_creator_profiles WHERE id=?", (creator_id,)).fetchone())


# -- affiliations: content distribution only --------------------------------


def _affiliation(row, creator=None):
    value = {
        "id": row["id"],
        "creator_id": row["creator_id"],
        "org_id": row["org_id"],
        "location_id": row["location_id"],
        "scope": row["scope"],
        "status": row["status"],
        "requested_at": row["requested_at"],
        "decided_at": row["decided_at"],
        "note": row["note"],
        # Stated on every record so no caller can read more into it.
        "grants": ["content_distribution"],
        "does_not_grant": ["member_records", "member_media", "coach_assignment", "facility_administration"],
    }
    if creator is not None:
        value["creator"] = public(creator)
    return value


def request_affiliation(sedens, db, actor, org_id, location_id=None, note=""):
    capabilities.require(sedens, db, actor, "creator")
    profile = profile_row(db, actor.user_id)
    if profile is None:
        raise Denied("Create your creator profile first.", 400, "no_profile")
    target = sedens.org(db, org_id) if org_id else None
    if target is None or target["kind"] != "facility":
        raise Denied("Enter the facility code of an existing facility.", 404, "unknown_facility")
    if target["id"] == actor.org_id:
        raise Denied("Your own facility does not need an affiliation.", 400, "own_facility")
    if target["demo"] != actor.demo:
        raise Denied("Choose a facility in the same environment.", 403, "environment_mismatch")
    if target["demo"]:
        # A demonstration organization's id carries its demonstration key, so one
        # visitor's demonstration never deals with another's.
        raise Denied("Demonstration facilities do not take affiliation requests.", 403, "demo_affiliation")
    if location_id and not db.execute(
        "SELECT 1 FROM p_locations WHERE id=? AND org_id=?", (location_id, org_id)
    ).fetchone():
        raise Denied("Choose a location of that facility.", 404, "unknown_location")
    existing = db.execute(
        "SELECT * FROM s_creator_facility_affiliations WHERE creator_id=? AND org_id=? AND IFNULL(location_id,'')=?",
        (profile["id"], org_id, location_id or ""),
    ).fetchone()
    stamp = now()
    if existing and existing["status"] in ("requested", "approved"):
        return _affiliation(existing)
    said_no = _facility_said_no(db, existing) if existing else None
    if said_no and parse(said_no) > utcnow() - timedelta(days=DECLINE_COOLDOWN_DAYS):
        raise Denied("This facility declined your request recently. You can ask again later.", 409, "recently_declined")
    if existing:
        db.execute(
            "UPDATE s_creator_facility_affiliations SET status='requested', requested_by=?, requested_at=?, decided_by=NULL, decided_at=NULL, note=? WHERE id=?",
            (actor.user_id, stamp, text(note, 500, "Note"), existing["id"]),
        )
        identifier = existing["id"]
    else:
        identifier = uid()
        db.execute(
            "INSERT INTO s_creator_facility_affiliations(id,creator_id,org_id,location_id,status,requested_by,requested_at,note) VALUES (?,?,?,?,?,?,?,?)",
            (identifier, profile["id"], org_id, location_id or None, "requested", actor.user_id, stamp, text(note, 500, "Note")),
        )
    # The facility sees requests in its affiliation list. An actor writes only to
    # their own organization's audit log, never into another facility's.
    sedens.audit(db, actor.org_id, actor.user_id, "affiliation:request", identifier, {"org_id": org_id})
    return _affiliation(db.execute("SELECT * FROM s_creator_facility_affiliations WHERE id=?", (identifier,)).fetchone())


def _facility_said_no(db, row) -> str | None:
    """When the facility said no (declined, or withdrew rather than the creator), or None.

    The server's affiliation ledger decides, not the row: a restored row's
    ``decided_by`` and ``decided_at`` came from an archive."""
    ledger = db.execute("SELECT status, facility_no, changed_at FROM s_affiliation_ledger WHERE origin_id=?",
                        (row["origin_id"] or row["id"],)).fetchone()
    if ledger is not None and ledger["status"] == row["status"]:
        return ledger["changed_at"] if ledger["facility_no"] and row["status"] in ("declined", "revoked") else None
    if row["decided_at"] is None:
        return None
    if row["status"] == "declined" or (row["status"] == "revoked" and row["decided_by"] != row["requested_by"]):
        return row["decided_at"]
    return None


def decide_affiliation(sedens, db, actor, affiliation_id, decision):
    if decision not in ("approve", "decline"):
        raise Denied("Choose approve or decline.", 400, "invalid")
    row = db.execute("SELECT * FROM s_creator_facility_affiliations WHERE id=?", (affiliation_id,)).fetchone()
    # A facility administrator decides only for their own facility.
    if row is None or actor.role != "admin" or row["org_id"] != actor.org_id:
        raise Denied("This affiliation request is not addressed to your facility.", 404, "unknown_affiliation")
    if row["status"] != "requested":
        raise Denied("This request was already decided.", 409, "already_decided")
    status = "approved" if decision == "approve" else "declined"
    db.execute(
        "UPDATE s_creator_facility_affiliations SET status=?, decided_by=?, decided_at=? WHERE id=?",
        (status, actor.user_id, now(), affiliation_id),
    )
    sedens.audit(db, actor.org_id, actor.user_id, "affiliation:" + status, affiliation_id)
    return _affiliation(db.execute("SELECT * FROM s_creator_facility_affiliations WHERE id=?", (affiliation_id,)).fetchone())


def revoke_affiliation(sedens, db, actor, affiliation_id):
    row = db.execute(
        "SELECT a.*, c.user_id FROM s_creator_facility_affiliations a JOIN s_creator_profiles c ON c.id=a.creator_id WHERE a.id=?",
        (affiliation_id,),
    ).fetchone()
    is_creator = row is not None and row["user_id"] == actor.user_id
    is_facility_admin = row is not None and actor.role == "admin" and row["org_id"] == actor.org_id
    if not (is_creator or is_facility_admin):
        raise Denied("This affiliation is not yours to change.", 404, "unknown_affiliation")
    if row["status"] in ("requested", "approved"):
        db.execute(
            "UPDATE s_creator_facility_affiliations SET status='revoked', decided_by=?, decided_at=? WHERE id=?",
            (actor.user_id, now(), affiliation_id),
        )
        sedens.audit(db, actor.org_id, actor.user_id, "affiliation:revoke", affiliation_id, {"org_id": row["org_id"]})
    return _affiliation(db.execute("SELECT * FROM s_creator_facility_affiliations WHERE id=?", (affiliation_id,)).fetchone())


def creator_affiliations(sedens, db, actor):
    profile = profile_row(db, actor.user_id)
    if profile is None:
        return []
    rows = db.execute(
        "SELECT * FROM s_creator_facility_affiliations WHERE creator_id=? ORDER BY requested_at DESC",
        (profile["id"],),
    ).fetchall()
    # The creator learns the facility's public name only.
    return [{**_affiliation(r), "facility_name": sedens.org(db, r["org_id"])["display_name"]} for r in rows]


def facility_affiliations(sedens, db, actor):
    if actor.role != "admin":
        raise Denied("Only a facility administrator can review creator affiliations.", 403, "admin_required")
    rows = db.execute(
        "SELECT * FROM s_creator_facility_affiliations WHERE org_id=? ORDER BY requested_at DESC",
        (actor.org_id,),
    ).fetchall()
    out = []
    for r in rows:
        creator = db.execute("SELECT * FROM s_creator_profiles WHERE id=?", (r["creator_id"],)).fetchone()
        out.append(_affiliation(r, creator))
    return out


def distribution_targets(sedens, db, creator_id):
    """Facilities this creator may offer content to: never a data-access list."""
    row = db.execute(
        "SELECT c.id, u.org_id FROM s_creator_profiles c JOIN p_users u ON u.id=c.user_id WHERE c.id=?",
        (creator_id,),
    ).fetchone()
    if row is None:
        return []
    targets = []
    home = sedens.org(db, row["org_id"])
    if home["kind"] == "facility":
        targets.append({"org_id": home["id"], "location_id": None, "basis": "home_facility"})
    for a in db.execute(
        "SELECT org_id, location_id FROM s_creator_facility_affiliations WHERE creator_id=? AND status='approved'",
        (creator_id,),
    ):
        targets.append({"org_id": a["org_id"], "location_id": a["location_id"], "basis": "approved_affiliation"})
    return targets
