"""SEDENS course review: Draft → Submitted → Needs revision / Approved → Published.

A reviewer decides on one exact version (its snapshot is immutable), with a
checklist. Approving publishes that version: customers move to it, and the
previously published version stays as it was for everyone enrolled in it.
Reviews never certify anything medically: the checklist asks whether the
course stays within general fitness, and SEDENS says so nowhere else.
Comments are stored with the version they are about.
"""

from __future__ import annotations

from . import access, courses
from .util import Denied, decode, encode, now, text, uid

CHECKLIST = (
    "creator_identity",       # the creator's identity and verification where the course needs it
    "rights_licensing",       # every file has rights information and an attestation
    "medical_claims",         # no diagnosis, treatment or outcome promises
    "safety_wording",         # plain stop rules, no clinical wording
    "exercise_instructions",  # clear, achievable, self-guided
    "demonstration_quality",  # media shows the movement it claims to show
    "anatomy_mappings",       # educational anatomy, never presented as measurement
    "source_provenance",      # where the content comes from
    "price_access",           # price and distribution are what the creator intends
)
RESULTS = ("pass", "needs_work", "not_applicable")
DECISIONS = ("approved", "needs_revision", "rejected")


def _checklist(raw, decision):
    if not isinstance(raw, dict):
        raise Denied("Complete the review checklist.", 400, "invalid_checklist")
    clean = {}
    for item in CHECKLIST:
        entry = raw.get(item) or {}
        if not isinstance(entry, dict):
            raise Denied("Complete the review checklist.", 400, "invalid_checklist")
        result = entry.get("result")
        if result not in RESULTS:
            raise Denied("Mark every checklist item.", 400, "checklist_incomplete")
        clean[item] = {"result": result, "note": text(entry.get("note", ""), 1000, "Checklist note")}
    if decision == "approved" and any(v["result"] == "needs_work" for v in clean.values()):
        raise Denied("A course with checklist items that need work cannot be approved.", 400, "checklist_not_passed")
    return clean


def queue(sedens, db, actor) -> list[dict]:
    """Submitted versions this reviewer may decide (same environment, not their own)."""
    out = []
    for v in db.execute("SELECT v.*, c.title FROM s_course_versions v JOIN s_courses c ON c.id=v.course_id "
                        "WHERE v.state='submitted' ORDER BY v.submitted_at"):
        course = courses.row(db, v["course_id"])
        if not access.can_review(sedens, db, actor, course):
            continue
        snapshot = decode(v["snapshot"], {})
        out.append({"course_id": course["id"], "version": v["version"], "title": snapshot["course"]["title"],
                    "course_type": course["course_type"], "creator": snapshot["creator"],
                    "submitted_at": v["submitted_at"], "note": v["note"],
                    "price": snapshot["price"], "distribution": snapshot["distribution"]})
    return out


def detail(sedens, db, actor, course_id, number) -> dict:
    course = courses.row(db, course_id)
    if not access.can_review(sedens, db, actor, course):
        raise Denied("This course does not exist.", 404, "unknown_course")
    found = courses.version(db, course_id, int(number or 0))
    if found is None:
        raise Denied("This version does not exist.", 404, "unknown_version")
    creator = db.execute("SELECT * FROM s_creator_profiles WHERE id=?", (course["creator_id"],)).fetchone()
    evidence = [{"kind": e["kind"], "description": e["description"], "url": e["url"], "object_id": e["object_id"]}
                for e in db.execute("SELECT * FROM s_verification_evidence WHERE creator_id=? ORDER BY created_at",
                                    (course["creator_id"],))]
    rights = [{"object_id": r["object_id"], "licence_type": r["licence_type"], "original_creator": r["original_creator"],
               "source_url": r["source_url"], "licence_url": r["licence_url"], "restrictions": r["restrictions"],
               "identifiable_person": r["identifiable_person"], "review_status": r["review_status"],
               "attested_at": r["attested_at"]}
              for r in db.execute("SELECT r.* FROM s_media_rights r WHERE r.object_id IN (SELECT value FROM json_each(?))",
                                  (encode(found["snapshot"].get("media", [])),))]
    return {
        **found,
        "course_id": course_id,
        "checklist_items": list(CHECKLIST),
        "creator": {"display_name": creator["display_name"], "creator_type": creator["creator_type"],
                    "verification_state": creator["verification_state"], "institution": creator["institution"],
                    "qualifications": decode(creator["qualifications"], []), "evidence": evidence},
        "media_rights": rights,
        "reviews": [r for r in courses.reviews(db, course_id) if r["version"] == found["version"]],
        "wording_notes": courses.wording.findings(found["snapshot"]["course"]["title"],
                                                  found["snapshot"]["course"]["description"]),
    }


def decide(sedens, db, actor, data) -> dict:
    """Run inside ``sedens.batch()``."""
    course = courses.row(db, data.get("course_id"))
    if not access.can_review(sedens, db, actor, course):
        raise Denied("This course does not exist.", 404, "unknown_course")
    decision = data.get("decision")
    if decision not in DECISIONS:
        raise Denied("Choose approve, needs revision or reject.", 400, "invalid")
    number = int(data.get("version") or 0)
    found = db.execute("SELECT * FROM s_course_versions WHERE course_id=? AND version=?", (course["id"], number)).fetchone()
    if found is None:
        raise Denied("This version does not exist.", 404, "unknown_version")
    if found["state"] != "submitted":
        raise Denied("This version is not waiting for review.", 409, "not_submitted")
    if data.get("snapshot_sha256") != found["snapshot_sha256"]:
        raise Denied("Review the version you opened.", 409, "version_changed")
    checklist = _checklist(data.get("checklist"), decision)
    comment = text(data.get("comment", ""), 4000, "Comment")
    if decision != "approved" and not comment:
        raise Denied("Tell the creator what to change.", 400, "comment_required")
    stamp = now()
    state = {"approved": "published", "needs_revision": "needs_revision", "rejected": "withdrawn"}[decision]
    changed = db.execute("UPDATE s_course_versions SET state=?, decided_at=? WHERE id=? AND state='submitted'",
                         (state, stamp, found["id"])).rowcount
    if not changed:
        raise Denied("This version is not waiting for review.", 409, "not_submitted")
    if decision == "approved":
        db.execute("UPDATE s_course_versions SET state='superseded' WHERE course_id=? AND state='published' AND id<>?",
                   (course["id"], found["id"]))
        db.execute("UPDATE s_courses SET published_version=? WHERE id=?", (number, course["id"]))
    db.execute("INSERT INTO s_course_reviews(id,course_id,version,reviewer_id,decision,checklist,comment,created_at) "
               "VALUES (?,?,?,?,?,?,?,?)", (uid(), course["id"], number, actor.user_id, decision, encode(checklist),
                                           comment, stamp))
    sedens.audit(db, course["owner_org_id"], actor.user_id, "course:review", course["id"],
                 {"version": number, "decision": decision})
    return {"course_id": course["id"], "version": number, "state": state, "published_version":
            courses.row(db, course["id"])["published_version"]}


def suspend(sedens, db, actor, data) -> dict:
    """Take a course out of every catalog and room at once (or restore it)."""
    course = courses.row(db, data.get("course_id"))
    if not access.can_review(sedens, db, actor, course):
        raise Denied("This course does not exist.", 404, "unknown_course")
    reason = text(data.get("reason", ""), 1000, "Reason")
    if data.get("suspend", True):
        if not reason:
            raise Denied("Give the reason for suspending.", 400, "comment_required")
        db.execute("UPDATE s_courses SET suspended_at=?, suspended_reason=? WHERE id=?", (now(), reason, course["id"]))
        decision = "suspended"
    else:
        db.execute("UPDATE s_courses SET suspended_at=NULL, suspended_reason='' WHERE id=?", (course["id"],))
        decision = "reinstated"
    db.execute("INSERT INTO s_course_reviews(id,course_id,version,reviewer_id,decision,checklist,comment,created_at) "
               "VALUES (?,?,?,?,?,?,?,?)", (uid(), course["id"], course["published_version"] or 0, actor.user_id,
                                           decision, "{}",
                                           reason or "Reinstated.", now()))
    sedens.audit(db, course["owner_org_id"], actor.user_id, "course:" + decision, course["id"])
    return {"course_id": course["id"], "suspended": decision == "suspended"}


def decide_media(sedens, db, actor, data) -> dict:
    """A reviewer's decision on a file's rights (approved or rejected)."""
    from . import capabilities

    capabilities.require(sedens, db, actor, "sedens_reviewer")
    found = db.execute("SELECT o.owner_org_id FROM s_media_objects o JOIN s_media_rights r ON r.object_id=o.id WHERE o.id=?",
                       (data.get("object_id"),)).fetchone()
    owner = sedens.org(db, found[0]) if found else None
    if owner is None or access.environment(owner) != access.environment(sedens.org(db, actor.org_id)):
        raise Denied("This file does not exist.", 404, "media_not_found")
    status = data.get("decision")
    if status not in ("approved", "rejected"):
        raise Denied("Choose approve or reject.", 400, "invalid")
    note = text(data.get("note", ""), 1000, "Note")
    if status == "rejected" and not note:
        raise Denied("Tell the creator why.", 400, "comment_required")
    db.execute("UPDATE s_media_rights SET review_status=?, reviewed_by=?, reviewed_at=?, review_note=? WHERE object_id=?",
               (status, actor.user_id, now(), note, data["object_id"]))
    sedens.audit(db, found[0], actor.user_id, "media:rights-review", data["object_id"], {"decision": status})
    return {"object_id": data["object_id"], "review_status": status}
