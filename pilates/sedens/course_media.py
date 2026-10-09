"""Course media with rights: nothing enters a course without them.

An upload is refused before a single byte is read unless it arrives with its
rights information and the creator's attestation:

    "I own this material or have permission to distribute it through SEDENS."

The repository's own labelled illustrations (``data/content_sources.json``)
can be added to a course too; they carry the registry's rights record. Files
are stored by :mod:`pilates.sedens.media_store` and read only through
:func:`pilates.sedens.access.media_access`.
"""

from __future__ import annotations

from pathlib import Path
from urllib.parse import urlparse

from . import capabilities, creators, media_store, video_providers
from .util import Denied, now, text, uid

ATTESTATION_VERSION = "2026-10-v1"
ATTESTATION = {
    "en": "I own this material or have permission to distribute it through SEDENS.",
    "ko": "이 자료를 직접 소유하고 있거나 SEDENS를 통해 배포할 권한이 있습니다.",
}
# What a creator may choose; 'repo_owned' is set only for the repository's own assets.
LICENCES = ("own_work", "permission_granted", "pexels", "pixabay", "cc0", "cc_by", "cc_by_sa", "other")
NEEDS_SOURCE = ("pexels", "pixabay", "cc0", "cc_by", "cc_by_sa", "other")
PEOPLE = ("none", "consented", "unknown")


def _url(value, field, required):
    value = text(value or "", 500, field)
    if not value:
        if required:
            raise Denied(f"{field}: add the link.", 400, "rights_incomplete")
        return ""
    parsed = urlparse(value)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise Denied(f"{field}: use a web address starting with https://.", 400, "rights_incomplete")
    return value


def rights_from(data) -> dict:
    """Validated rights information, or Denied. Checked before any upload is read."""
    if not isinstance(data, dict):
        raise Denied("Add the rights information for this file.", 400, "rights_required")
    if data.get("attest") is not True or data.get("attestation_version") != ATTESTATION_VERSION:
        raise Denied("Confirm that you own this material or have permission to distribute it.", 400, "attestation_required")
    licence = data.get("licence_type")
    if licence not in LICENCES:
        raise Denied("Choose how you hold the rights to this file.", 400, "rights_incomplete")
    original = text(data.get("original_creator"), 160, "Original creator")
    if not original:
        raise Denied("Name who made this material.", 400, "rights_incomplete")
    people = data.get("identifiable_person")
    if people not in PEOPLE:
        raise Denied("Say whether a recognisable person appears in it.", 400, "rights_incomplete")
    return {
        "licence_type": licence,
        "original_creator": original,
        "source_url": _url(data.get("source_url"), "Original source", licence in NEEDS_SOURCE),
        "licence_url": _url(data.get("licence_url"), "Licence page", licence in NEEDS_SOURCE and licence != "other"),
        "restrictions": text(data.get("restrictions", ""), 1000, "Restrictions"),
        "identifiable_person": people,
    }


def _creator(sedens, db, actor):
    capabilities.require(sedens, db, actor, "creator")
    profile = creators.profile_row(db, actor.user_id)
    if profile is None:
        raise Denied("Create your creator profile first.", 400, "no_profile")
    return profile


def _insert_rights(db, object_id, rights, actor, version):
    db.execute(
        "INSERT INTO s_media_rights(object_id,licence_type,original_creator,source_url,licence_url,restrictions,"
        "identifiable_person,attestation_version,attested_by,attested_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
        (object_id, rights["licence_type"], rights["original_creator"], rights["source_url"], rights["licence_url"],
         rights["restrictions"], rights["identifiable_person"], version, actor.user_id, now()),
    )


def upload(sedens, actor, stream, length, kind, filename, rights_data, title="") -> dict:
    """Authorize, validate rights, then stream and check the file."""
    with sedens.db() as db:
        profile = _creator(sedens, db, actor)
    rights = rights_from(rights_data)
    title = text(title, 120, "Title")
    received = media_store.receive(sedens.repo, stream, length, kind, sedens.mode.name)
    key = None
    try:
        key = received.keep(sedens.repo, actor.org_id)
        object_id = uid()
        with sedens.db() as db:
            db.execute(
                "INSERT INTO s_media_objects(id,owner_org_id,creator_id,uploaded_by,source,kind,mime,size,sha256,object_key,"
                "original_filename,title,width,height,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (object_id, actor.org_id, profile["id"], actor.user_id, "creator_upload", kind, received.mime,
                 received.size, received.sha256, key, text(Path(str(filename or "")).name, 160, "File name"),
                 title or Path(str(filename or "")).stem[:120], received.detail.get("width"),
                 received.detail.get("height"), now()),
            )
            _insert_rights(db, object_id, rights, actor, ATTESTATION_VERSION)
            sedens.audit(db, actor.org_id, actor.user_id, "media:upload", object_id,
                         {"kind": kind, "size": received.size, "licence_type": rights["licence_type"]})
            return describe(db, object_id)
    except BaseException:
        if key is not None:
            media_store.object_path(sedens.repo, key).unlink(missing_ok=True)
        received.discard()
        raise


def add_repo_asset(sedens, db, actor, asset_id) -> dict:
    """Add one of the repository's own labelled assets to this creator's media."""
    profile = _creator(sedens, db, actor)
    asset = video_providers.repo_asset(asset_id)
    if asset is None:
        raise Denied("Choose one of the listed demonstration images.", 404, "unknown_asset")
    existing = db.execute("SELECT id FROM s_media_objects WHERE owner_org_id=? AND repo_asset=? AND state='ready'",
                          (actor.org_id, asset_id)).fetchone()
    if existing:
        return describe(db, existing[0])
    path = video_providers.REPO / asset["path"]
    object_id = uid()
    db.execute(
        "INSERT INTO s_media_objects(id,owner_org_id,creator_id,uploaded_by,source,kind,mime,size,sha256,repo_asset,"
        "original_filename,title,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (object_id, actor.org_id, profile["id"], actor.user_id, "repo", asset["kind"], asset["mime"], path.stat().st_size,
         asset["sha256"], asset_id, path.name, asset["description"]["en"][:120], now()),
    )
    r = asset["rights"]
    rights = {"licence_type": "repo_owned", "original_creator": r["original_creator"], "source_url": "",
              "licence_url": "", "restrictions": r["restrictions"], "identifiable_person": r["identifiable_person"]}
    _insert_rights(db, object_id, rights, actor, "repository-registry")
    return describe(db, object_id)


def describe(db, object_id) -> dict:
    o = db.execute("SELECT o.*, r.licence_type, r.original_creator, r.source_url, r.licence_url, r.restrictions, "
                   "r.identifiable_person, r.attestation_version, r.attested_at, r.review_status, r.review_note "
                   "FROM s_media_objects o LEFT JOIN s_media_rights r ON r.object_id=o.id WHERE o.id=?",
                   (object_id,)).fetchone()
    if o is None:
        raise Denied("This file does not exist.", 404, "media_not_found")
    label = None
    if o["source"] == "repo":
        asset = video_providers.repo_asset(o["repo_asset"])
        label = asset["label"] if asset else None
    elif o["licence_type"] in ("pexels", "pixabay"):
        label = video_providers.STOCK_LABEL
    return {
        "id": o["id"], "kind": o["kind"], "mime": o["mime"], "size": o["size"], "title": o["title"],
        "filename": o["original_filename"], "source": o["source"], "state": o["state"], "created_at": o["created_at"],
        "width": o["width"], "height": o["height"], "label": label,
        "rights": {"licence_type": o["licence_type"], "original_creator": o["original_creator"],
                   "source_url": o["source_url"], "licence_url": o["licence_url"], "restrictions": o["restrictions"],
                   "identifiable_person": o["identifiable_person"], "attested_at": o["attested_at"],
                   "review_status": o["review_status"], "review_note": o["review_note"]},
    }


def list_for_creator(sedens, db, actor) -> list[dict]:
    profile = _creator(sedens, db, actor)
    rows = db.execute("SELECT id FROM s_media_objects WHERE owner_org_id=? AND (creator_id=? OR creator_id IS NULL) "
                      "AND state='ready' ORDER BY created_at DESC", (actor.org_id, profile["id"])).fetchall()
    return [describe(db, r[0]) for r in rows]


def retire(sedens, db, actor, object_id) -> dict:
    """Hide a file from new use. A version that already uses it keeps it."""
    profile = _creator(sedens, db, actor)
    changed = db.execute("UPDATE s_media_objects SET state='retired' WHERE id=? AND owner_org_id=? AND creator_id=?",
                         (object_id, actor.org_id, profile["id"])).rowcount
    if not changed:
        raise Denied("This file does not exist.", 404, "media_not_found")
    for column in ("video_media_id", "image_media_id"):
        db.execute(f"UPDATE s_course_steps SET {column}=NULL WHERE {column}=?", (object_id,))
    db.execute("UPDATE s_course_lessons SET media_id=NULL WHERE media_id=?", (object_id,))
    db.execute("UPDATE s_courses SET cover_media_id=NULL WHERE cover_media_id=?", (object_id,))
    return {"id": object_id, "state": "retired"}


def file_of(sedens, row) -> Path:
    """Where the bytes of an object are, for a caller already authorized by access.media_access."""
    if row["source"] == "repo":
        asset = video_providers.repo_asset(row["repo_asset"])
        if asset is None:
            raise Denied("This file is not available.", 404, "media_not_found")
        return video_providers.REPO / asset["path"]
    return media_store.object_path(sedens.repo, row["object_key"])


def add_evidence(sedens, db, actor, data) -> dict:
    """Something a creator offers SEDENS for verification (description, link, document)."""
    profile = _creator(sedens, db, actor)
    kind = data.get("kind")
    if kind not in ("qualification", "institution", "identity", "other"):
        raise Denied("Choose what this evidence shows.", 400, "invalid")
    description = text(data.get("description"), 1000, "Description")
    if not description:
        raise Denied("Describe the evidence.", 400, "invalid")
    url = _url(data.get("url"), "Link", False)
    object_id = data.get("object_id") or None
    if object_id and not db.execute("SELECT 1 FROM s_media_objects WHERE id=? AND owner_org_id=? AND creator_id=?",
                                    (object_id, actor.org_id, profile["id"])).fetchone():
        raise Denied("Choose one of your files.", 404, "media_not_found")
    if db.execute("SELECT count(*) FROM s_verification_evidence WHERE creator_id=?", (profile["id"],)).fetchone()[0] >= 20:
        raise Denied("At most 20 pieces of evidence.", 400, "too_many")
    evidence_id = uid()
    db.execute("INSERT INTO s_verification_evidence(id,creator_id,kind,description,url,object_id,created_at) "
               "VALUES (?,?,?,?,?,?,?)", (evidence_id, profile["id"], kind, description, url, object_id, now()))
    return {"items": evidence(db, profile["id"])}


def evidence(db, creator_id) -> list[dict]:
    return [{"id": e["id"], "kind": e["kind"], "description": e["description"], "url": e["url"],
             "object_id": e["object_id"], "created_at": e["created_at"]}
            for e in db.execute("SELECT * FROM s_verification_evidence WHERE creator_id=? ORDER BY created_at", (creator_id,))]

