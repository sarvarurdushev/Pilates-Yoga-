"""SEDENS records in organization backups.

This extends :mod:`pilates.platform.backup`; it is not a second backup system.
The platform archive format, ID remapping, foreign-key checks and media
handling stay the same. Every ``s_*`` table has an explicit policy here, so a
new SEDENS table cannot be left out of backups by accident: export refuses to
run while any ``s_*`` table has no policy.

Three rules decide what an archive may carry and what a restore may believe:

1. **No live credentials.** Device tokens, room-session tokens, pairing codes
   and secrets, and room access codes are never exported. Restored room screens
   are unpaired (pair them again); restored room sessions are closed.
2. **Only this organization's people.** A column naming a user of another
   organization (who granted, decided or verified) is exported empty.
3. **Decisions made outside the organization are re-checked against this
   server, never taken from the archive.** A SEDENS verification comes back as
   "verification requested" for a reviewer to confirm again. An affiliation
   with a creator or facility outside the archive is re-linked only while this
   server's affiliation ledger (``s_affiliation_ledger``, kept even when rows
   are deleted) still records exactly that decision for its lineage, and at
   most once while that lineage lives. Anything else is left out and reported.
4. **Courses come back for SEDENS to confirm.** A restored course is not
   published: the version that was published returns to the review queue (its
   snapshot rebuilt with the new IDs and hashed again by this server), and
   every other version is kept as history. Course files travel in the archive
   and pass the same checks as an upload. Media-rights approvals return to
   review; a rejection stays. Purchases, entitlements and enrollments for
   another organization's course come back only while this server can confirm
   them (simulated purchases never move between organizations).
"""

from __future__ import annotations

from dataclasses import dataclass, field
import hashlib
import json
import re

from ..platform.inspection import scope as platform_scope
from ..platform.repository import Refused
from . import access, creators, media_store, modes, video_providers
from .core import Sedens
from .util import Denied, digest, encode, now, token, uid

FORMAT = 1


@dataclass(frozen=True)
class Policy:
    include: bool
    reason: str
    # SQL boundary when the platform's org_id / foreign-key walk is not enough.
    scope: str | None = None
    # Columns never written to an archive.
    drop: tuple = ()
    # JSON columns whose IDs are remapped on restore.
    json: tuple = ("detail",)


_COURSES = "SELECT id FROM s_courses WHERE owner_org_id=?"
_CREATORS = "SELECT c.id FROM s_creator_profiles c JOIN p_users u ON u.id=c.user_id WHERE u.org_id=?"

POLICIES: dict[str, Policy] = {
    "s_org_profiles": Policy(True, "facility or creator-studio profile", json=("detail",)),
    "s_capabilities": Policy(True, "creator permissions of this organization's accounts (SEDENS staff permissions are never restored)"),
    "s_creator_profiles": Policy(True, "creator profiles of this organization's accounts", json=("detail",)),
    "s_creator_facility_affiliations": Policy(
        True,
        "affiliations addressed to this facility, and this organization's creators' affiliations elsewhere",
        scope=(
            "org_id=? OR creator_id IN (SELECT c.id FROM s_creator_profiles c "
            "JOIN p_users u ON u.id=c.user_id WHERE u.org_id=?)"
        ),
        json=(),
    ),
    "s_room_devices": Policy(True, "room screens and their history; restored unpaired", drop=("token_hash",)),
    "s_room_sessions": Policy(True, "room visit history; restored closed", drop=("token_hash",)),
    "s_crm_settings": Policy(True, "CRM provider and non-secret policy", json=("config",)),
    "s_crm_member_links": Policy(True, "CRM member to client links", json=()),
    "s_consents": Policy(True, "consent decisions of this organization's people", json=()),
    "s_events": Policy(True, "local product analytics events", json=("props",)),
    "s_media_objects": Policy(True, "this organization's course files; the files travel in the archive and are checked again",
                              scope="owner_org_id=?", drop=("object_key",), json=()),
    "s_media_rights": Policy(True, "rights and attestations of those files; SEDENS approvals are reviewed again",
                             scope="object_id IN (SELECT id FROM s_media_objects WHERE owner_org_id=?)", json=()),
    "s_verification_evidence": Policy(True, "evidence this organization's creators offered for verification",
                                      scope=f"creator_id IN ({_CREATORS})", json=()),
    "s_courses": Policy(True, "courses this organization's creators own; publication is confirmed again by SEDENS",
                        scope="owner_org_id=?", json=()),
    "s_course_prices": Policy(True, "course prices", scope=f"course_id IN ({_COURSES})", json=()),
    "s_course_facility_terms": Policy(True, "facilities a course is offered to, or free for",
                                      scope=f"course_id IN ({_COURSES})", json=()),
    "s_course_modules": Policy(True, "course modules", scope=f"course_id IN ({_COURSES})", json=()),
    "s_course_sessions": Policy(True, "guided training sessions", scope=f"course_id IN ({_COURSES})", json=()),
    "s_course_steps": Policy(True, "guided training steps", scope=f"course_id IN ({_COURSES})", json=()),
    "s_course_step_anatomy": Policy(True, "anatomy of guided training steps",
                                    scope=f"step_id IN (SELECT id FROM s_course_steps WHERE course_id IN ({_COURSES}))",
                                    json=()),
    "s_course_step_timeline": Policy(True, "anatomy timelines of guided training steps",
                                     scope=f"step_id IN (SELECT id FROM s_course_steps WHERE course_id IN ({_COURSES}))",
                                     json=()),
    "s_course_lessons": Policy(True, "professional education lessons", scope=f"course_id IN ({_COURSES})"),
    "s_course_versions": Policy(True, "submitted and published course versions; restored for SEDENS to confirm",
                                scope=f"course_id IN ({_COURSES})", json=()),
    "s_course_version_media": Policy(True, "files each course version uses",
                                     scope=f"version_id IN (SELECT id FROM s_course_versions WHERE course_id IN ({_COURSES}))",
                                     json=()),
    "s_course_reviews": Policy(True, "review decisions and comments on this organization's courses (reviewer names left out)",
                               scope=f"course_id IN ({_COURSES})", json=()),
    "s_facility_course_settings": Policy(True, "which courses this facility enabled, included or featured", json=()),
    "s_purchases": Policy(True, "simulated purchases by this organization's customers", json=()),
    "s_entitlements": Policy(True, "courses this organization's customers may use", json=()),
    "s_enrollments": Policy(True, "this organization's customers' enrollments", json=()),
    "s_course_progress": Policy(True, "completed sessions and lessons",
                                scope="enrollment_id IN (SELECT id FROM s_enrollments WHERE org_id=?)", json=()),
    "s_demo_layers": Policy(False, "which demonstration content this server seeded"),
    "s_schema": Policy(False, "this server's migration ledger"),
    "s_affiliation_ledger": Policy(False, "this server's record of affiliation decisions, which restores are checked against"),
    "s_room_device_pairings": Policy(False, "short-lived pairing codes and secrets"),
    "s_room_access_codes": Policy(False, "single-use room access codes"),
}
INCLUDED = frozenset(t for t, p in POLICIES.items() if p.include)
# Attribution columns: who did something. Emptied when that person is outside the archive.
ATTRIBUTION = {
    "granted_by", "revoked_by", "verified_by", "requested_by", "decided_by",
    "created_by", "updated_by", "confirmed_by", "uploaded_by", "attested_by",
    "reviewed_by", "reviewer_id", "submitted_by",
}
MEDIA_PREFIX = "sedens-media/"
RESTORED_VERSION = "Restored from a backup: this version was published. Confirm it to publish it again."


def present(db) -> bool:
    return db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='s_schema'").fetchone() is not None


def tables_without_policy(db) -> list[str]:
    names = [r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name GLOB 's_*'")]
    return sorted(set(names) - set(POLICIES))


def schema(db) -> dict:
    """Inspection-style metadata for the SEDENS tables an archive carries."""
    missing = tables_without_policy(db)
    if missing:
        raise Refused("This server has SEDENS tables without a backup policy: " + ", ".join(missing), 500)
    existing = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name GLOB 's_*'")}
    meta = {}
    for table in sorted(INCLUDED & existing):
        info = db.execute(f"PRAGMA table_info({table})").fetchall()
        meta[table] = {
            "columns": [r[1] for r in info],
            "required": [r[1] for r in info if r[3]],
            "primary_key": [r[1] for r in sorted(info, key=lambda r: r[5]) if r[5]],
            "foreign_keys": [dict(r) for r in db.execute(f"PRAGMA foreign_key_list({table})")],
        }
    return meta


def owns(table) -> bool:
    return table in POLICIES


def scope(table, meta, org_id):
    policy = POLICIES[table]
    if policy.scope:
        return policy.scope, [org_id] * policy.scope.count("?")
    return platform_scope(table, meta, org_id)


def json_columns(table):
    return set(POLICIES[table].json)


def _user_columns(meta, table):
    return {f["from"] for f in meta[table]["foreign_keys"] if f["table"] == "p_users"}


# -- export ----------------------------------------------------------------------


@dataclass
class ExportContext:
    db: object
    org_id: str
    meta: dict
    users: set = field(default_factory=set)
    repo: object = None
    files: dict = field(default_factory=dict)  # object id -> (path on disk, archive part)

    @classmethod
    def open(cls, db, org_id, meta, repo=None):
        users = {r[0] for r in db.execute("SELECT id FROM p_users WHERE org_id=?", (org_id,))}
        return cls(db, org_id, meta, users, repo)


def export_row(ctx: ExportContext, table: str, item: dict) -> dict | None:
    policy = POLICIES[table]
    for column in policy.drop:
        item.pop(column, None)
    # Never name a person from another organization (the archive could not restore them).
    for column in _user_columns(ctx.meta, table) & ATTRIBUTION:
        if item.get(column) is not None and item[column] not in ctx.users:
            item[column] = None
    if table == "s_capabilities" and item["capability"] != "creator":
        return None
    if table == "s_media_objects" and item["source"] != "repo":
        key = ctx.db.execute("SELECT object_key FROM s_media_objects WHERE id=?", (item["id"],)).fetchone()[0]
        path = media_store.object_path(ctx.repo, key)
        if not path.is_file():
            raise Refused("A saved course file is missing. Restore it or remove it from its course before "
                          "creating a complete backup.", 409)
        ctx.files[item["id"]] = (path, MEDIA_PREFIX + item["id"] + media_store.EXTENSIONS[item["mime"]])
    return item


def export_extras(ctx: ExportContext) -> tuple[dict, dict]:
    """(manifest entry, {archive part: bytes or a file Path})."""
    entry = {"format": FORMAT, "media_files": {object_id: part for object_id, (_, part) in ctx.files.items()}}
    return entry, {part: path for path, part in ctx.files.values()}


# -- restore ---------------------------------------------------------------------


@dataclass
class RestoreContext:
    db: object
    actor: object
    manifest: dict
    meta: dict
    demo: bool = False
    kind: str = "facility"
    exporter_profile: str | None = None
    existing_profile: str | None = None
    repo: object = None
    archive: object = None
    media_files: dict = field(default_factory=dict)
    mode_name: str = modes.DEMO_FREE
    files: list = field(default_factory=list)  # course files written so far (removed if the restore fails)
    text_ids: dict | None = None
    inside_courses: set = field(default_factory=set)
    dropped: set = field(default_factory=set)  # (table, archived id) left out by decision
    summary: dict = field(default_factory=lambda: {
        "room_screens_to_pair_again": 0,
        "room_sessions_closed": 0,
        "verifications_to_confirm": 0,
        "affiliations_restored": 0,
        "affiliations_not_restored": 0,
        "sedens_permissions_not_restored": 0,
        "crm_settings_reset": 0,
        "courses_to_confirm": 0,
        "media_rights_to_review": 0,
        "course_terms_not_restored": 0,
        "course_settings_not_restored": 0,
        "purchases_not_restored": 0,
        "course_access_not_restored": 0,
        "course_files": 0,
    })


def _media_parts(entry) -> dict:
    files = entry.get("media_files", {}) if isinstance(entry, dict) else {}
    if not isinstance(files, dict) or any(
        not isinstance(k, str) or not isinstance(v, str) or not v.startswith(MEDIA_PREFIX) or v.endswith("/")
        or ".." in v.split("/") for k, v in files.items()
    ):
        raise Refused("Invalid course file entry in backup.")
    return files


def archived_files(manifest) -> dict:
    """{media object id: archive part} for the course files an archive carries."""
    entry = manifest.get("sedens")
    return _media_parts(entry) if isinstance(entry, dict) else {}


def open_restore(db, actor, manifest, archive, meta, repo=None) -> RestoreContext:
    entry = manifest.get("sedens")
    if entry is not None and (not isinstance(entry, dict) or entry.get("format") != FORMAT):
        raise Refused("The SEDENS part of this backup is not supported.")
    try:
        mode_name = modes.resolve(db_path=str(repo.path) if repo is not None else "").name
    except modes.ModeError:
        mode_name = modes.DEMO_FREE
    return RestoreContext(db, actor, manifest, meta, repo=repo, archive=archive,
                          media_files=_media_parts(entry or {}), mode_name=mode_name)


def blocks_restore(ctx: RestoreContext, table, meta) -> bool:
    """Whether the target organization already holds rows of this table."""
    org = ctx.actor.org_id
    if table == "s_org_profiles":
        return False  # replaced like the platform's own organization row
    if table in ("s_capabilities", "s_creator_profiles"):
        # A creator studio's own administrator already has these on sign-up.
        return ctx.db.execute(
            f"SELECT 1 FROM {table} t JOIN p_users u ON u.id=t.user_id WHERE u.org_id=? AND t.user_id<>? LIMIT 1",
            (org, ctx.actor.user_id),
        ).fetchone() is not None
    where, args = scope(table, meta, org)
    return ctx.db.execute(f'SELECT 1 FROM "{table}" WHERE {where} LIMIT 1', args).fetchone() is not None


KIND_MESSAGES = {
    "facility": "This is a facility backup. Restore it into a new facility.",
    "creator_studio": "This is a creator studio backup. Restore it into a new creator studio.",
}


def prepare(ctx: RestoreContext, rows, mapping):
    """Run after IDs are allocated: decide the kind of organization, map the
    exporter's creator profile onto the restoring administrator's existing one,
    and refuse a SEDENS organization (as an archive or as the target)."""
    archived = "facility"  # an organization without a SEDENS profile row is a facility
    for row in rows("s_org_profiles"):
        if row.get("kind") == "sedens":
            raise Refused("The SEDENS organization is recreated from the command line, not restored from a backup.")
        if row.get("kind") not in ("facility", "creator_studio"):
            raise Refused("Invalid backup record.")
        archived = row["kind"]
    current = ctx.db.execute("SELECT kind FROM s_org_profiles WHERE org_id=?", (ctx.actor.org_id,)).fetchone()
    if current is not None and current[0] == "sedens":
        raise Refused("A backup is never restored into the SEDENS organization.")
    if current is not None and current[0] != archived:
        raise Refused(KIND_MESSAGES[archived], 409)
    ctx.kind = archived
    for row in rows("p_organizations"):
        # Read once here: the manifest's table order must not decide the environment.
        ctx.demo = bool(row.get("demo"))
    _decide_course_access(ctx, rows)
    exporter = ctx.manifest["exporter_id"]
    existing = ctx.db.execute("SELECT id FROM s_creator_profiles WHERE user_id=?", (ctx.actor.user_id,)).fetchone()
    for row in rows("s_creator_profiles"):
        if row.get("user_id") == exporter:
            if ctx.exporter_profile is not None:
                raise Refused("The backup contains a record twice.")
            ctx.exporter_profile = row["id"]
            if existing is not None:
                ctx.existing_profile = existing[0]
                mapping[("s_creator_profiles", row["id"])] = existing[0]


def _environment(ctx) -> str:
    return access.environment({"demo": ctx.demo, "id": ctx.actor.org_id})


def _external_course(ctx, course_id):
    """Another organization's course on this server, in the same environment, or None."""
    course = ctx.db.execute("SELECT * FROM s_courses WHERE id=?", (course_id,)).fetchone() if course_id else None
    if course is None:
        return None
    owner = Sedens.org(ctx.db, course["owner_org_id"])
    return course if owner is not None and access.environment(owner) == _environment(ctx) else None


def _decide_course_access(ctx, rows):
    """Decide up front which purchases, entitlements, enrollments and progress rows
    come back, because the tables are restored in name order, children first.

    A course in the archive comes back with them. For another organization's
    course, this server decides: a simulated purchase never moves between
    organizations; a free marketplace entitlement stands only while the course is
    still free on the marketplace; a facility's free or included offer is checked
    again whenever it is used; an enrollment needs its entitlement and a version
    this server published."""
    ctx.inside_courses = {r["id"] for r in rows("s_courses")}
    facilities_inside = {r["id"] for r in rows("p_organizations")}
    for p in rows("s_purchases"):
        if not (ctx.demo and p.get("course_id") in ctx.inside_courses):
            ctx.dropped.add(("s_purchases", p["id"]))
    for e in rows("s_entitlements"):
        keep = True
        if e.get("purchase_id") and ("s_purchases", e["purchase_id"]) in ctx.dropped:
            keep = False
        elif e.get("source") == "demo_purchase" and not e.get("purchase_id"):
            keep = False
        elif e.get("facility_id") and e["facility_id"] not in facilities_inside:
            keep = False
        elif e.get("course_id") not in ctx.inside_courses:
            course = _external_course(ctx, e.get("course_id"))
            if course is None or e.get("source") == "demo_purchase":
                keep = False
            elif e.get("source") == "marketplace_free":
                keep = course["distribution"] == "marketplace" and access.is_free(ctx.db, course["id"])
        if not keep:
            ctx.dropped.add(("s_entitlements", e["id"]))
    for n in rows("s_enrollments"):
        keep = not (n.get("entitlement_id") and ("s_entitlements", n["entitlement_id"]) in ctx.dropped)
        if keep and n.get("course_id") not in ctx.inside_courses:
            keep = bool(n.get("entitlement_id")) and _external_course(ctx, n.get("course_id")) is not None \
                and ctx.db.execute("SELECT 1 FROM s_course_versions WHERE course_id=? AND version=? "
                                   "AND state IN ('published','superseded')",
                                   (n.get("course_id"), n.get("version"))).fetchone() is not None
        if not keep:
            ctx.dropped.add(("s_enrollments", n["id"]))


def _ids(ctx, mapping) -> dict:
    if ctx.text_ids is None:
        ctx.text_ids = {old: new for (_, old), new in mapping.items() if isinstance(old, str)}
    return ctx.text_ids


def _remap(value, ids):
    if isinstance(value, str):
        return ids.get(value, value)
    if isinstance(value, list):
        return [_remap(v, ids) for v in value]
    if isinstance(value, dict):
        return {ids.get(k, k): _remap(v, ids) for k, v in value.items()}
    return value


def _restore_media(ctx, row, original):
    """Bring a course file back through the same checks as an upload."""
    if row["source"] == "repo":
        asset = video_providers.repo_asset(row.get("repo_asset"))
        if asset is None or asset["kind"] != row["kind"]:
            raise Refused("This backup uses a demonstration file this server does not have.")
        path = video_providers.REPO / asset["path"]
        row.update(object_key=None, mime=asset["mime"], size=path.stat().st_size, sha256=asset["sha256"])
        return
    part = ctx.media_files.get(original["id"])
    if not part:
        raise Refused("A course file is missing from this backup.")
    info = ctx.archive.getinfo(part)
    if info.is_dir() or row.get("kind") not in media_store.KINDS:
        raise Refused("Invalid course file entry in backup.")
    try:
        with ctx.archive.open(part) as source:
            received = media_store.adopt(ctx.repo, source, info.file_size, row["kind"], ctx.mode_name)
    except Denied as refused:
        raise Refused(f"A course file in this backup was not accepted: {refused}") from refused
    try:
        key = received.keep(ctx.repo, ctx.actor.org_id)
    except BaseException:
        received.discard()
        raise
    ctx.files.append(media_store.object_path(ctx.repo, key))
    ctx.summary["course_files"] += 1
    row.update(object_key=key, mime=received.mime, size=received.size, sha256=received.sha256,
               width=received.detail.get("width", row.get("width")),
               height=received.detail.get("height", row.get("height")))


def _external_facility(ctx, org_id, location_id):
    org = Sedens.org(ctx.db, org_id) if org_id else None
    if org is None or org["kind"] != "facility" or access.environment(org) != _environment(ctx):
        return False
    return not location_id or ctx.db.execute(
        "SELECT 1 FROM p_locations WHERE id=? AND org_id=?", (location_id, org_id)).fetchone() is not None


def _restore_course_row(ctx, table, original, row, mapping):
    """The course tables' part of :func:`restore_row`: (row, external) or None."""
    external = set()
    if table == "s_media_objects":
        _restore_media(ctx, row, original)
    elif table == "s_media_rights":
        if row["review_status"] == "approved":
            row.update(review_status="unreviewed", reviewed_at=None,
                       review_note="Restored from a backup. Waiting for SEDENS to review the rights again.")
            ctx.summary["media_rights_to_review"] += 1
        row["reviewed_by"] = None
    elif table == "s_courses":
        if row.get("published_version"):
            ctx.summary["courses_to_confirm"] += 1
        row["published_version"] = None
    elif table == "s_course_versions":
        # The snapshot names the course's own rows; rebuild it with the new IDs and
        # hash it here. The archive's hash is never trusted.
        snapshot = _remap(json.loads(original["snapshot"]), _ids(ctx, mapping))
        encoded = encode(snapshot)
        row.update(snapshot=encoded, snapshot_sha256=hashlib.sha256(encoded.encode()).hexdigest())
        if original["state"] == "published":
            note = (RESTORED_VERSION + " " + (original.get("note") or "")).strip()
            row.update(state="submitted", decided_at=None, note=note)
        elif original["state"] in ("approved", "superseded"):
            row["state"] = "withdrawn"
    elif table == "s_course_reviews":
        row["reviewer_id"] = None
    elif table == "s_course_facility_terms":
        if ("p_organizations", original["org_id"]) not in mapping:
            if not _external_facility(ctx, original["org_id"], original.get("location_id")):
                ctx.summary["course_terms_not_restored"] += 1
                return None
            external = {"org_id", "location_id"}
    elif table == "s_facility_course_settings":
        if original["course_id"] not in ctx.inside_courses:
            # Whether the course is still offered here is decided each time it is used.
            if _external_course(ctx, original["course_id"]) is None:
                ctx.summary["course_settings_not_restored"] += 1
                return None
            external = {"course_id"}
    elif table in ("s_purchases", "s_entitlements", "s_enrollments"):
        if (table, original["id"]) in ctx.dropped:
            ctx.summary["purchases_not_restored" if table == "s_purchases" else "course_access_not_restored"] += 1
            return None
        if original["course_id"] not in ctx.inside_courses:
            external = {"course_id"}
    elif table == "s_course_progress":
        if ("s_enrollments", original["enrollment_id"]) in ctx.dropped:
            return None
        ids = _ids(ctx, mapping)
        row.update(item_id=ids.get(original["item_id"], original["item_id"]),
                   module_id=ids.get(original["module_id"], original["module_id"]))
        external = {"item_id", "module_id"}
    return row, external


def _lineage_live(db, origin) -> bool:
    return db.execute(
        "SELECT 1 FROM s_creator_facility_affiliations WHERE id=? OR origin_id=? LIMIT 1", (origin, origin)
    ).fetchone() is not None


def _restore_affiliation(ctx, original, mapping):
    """(row, external columns) or None when it cannot be restored.

    The ledger decides. An approval comes back only while the ledger still
    records exactly it; a facility's "no" recorded later comes back as that "no"
    (it grants nothing, and keeps the facility's cooldown), dated by the ledger."""
    row = dict(original)
    creator_inside = ("s_creator_profiles", original["creator_id"]) in mapping
    facility_inside = ("p_organizations", original["org_id"]) in mapping
    if creator_inside == facility_inside:
        # Both inside would be a creator affiliated with their own facility, which
        # the product refuses; neither inside is not this organization's row.
        return None
    origin = original.get("origin_id") or original["id"]
    recorded = ctx.db.execute(
        "SELECT creator_id, org_id, location_id, status, changed_at, facility_no FROM s_affiliation_ledger "
        "WHERE origin_id=?", (origin,)
    ).fetchone()
    if recorded is None or tuple(recorded[:3]) != (original["creator_id"], original["org_id"], original["location_id"]):
        return None  # this server never recorded it
    if recorded["status"] != original["status"]:
        if recorded["status"] not in ("declined", "revoked") or not recorded["facility_no"]:
            return None  # a later decision replaced it (or the affiliation ended)
        row["status"] = recorded["status"]
    if row["status"] in ("declined", "revoked"):
        row["decided_at"] = recorded["changed_at"]
    if _lineage_live(ctx.db, origin):
        return None  # the original (or an earlier restore of it) still exists
    row["origin_id"] = origin
    if facility_inside:
        # This facility's archive; the creator lives in another organization.
        creator = ctx.db.execute(
            "SELECT o.demo, o.id FROM s_creator_profiles c JOIN p_users u ON u.id=c.user_id "
            "JOIN p_organizations o ON o.id=u.org_id WHERE c.id=?",
            (original["creator_id"],),
        ).fetchone()
        if ctx.kind != "facility" or creator is None or bool(creator[0]) != ctx.demo or creator[1] == ctx.actor.org_id:
            return None  # only a facility takes affiliations, and never from its own creators
        return row, {"creator_id"}
    if creator_inside:
        # This creator's archive; the facility lives in another organization.
        facility = ctx.db.execute(
            "SELECT o.demo, IFNULL(p.kind,'facility') FROM p_organizations o "
            "LEFT JOIN s_org_profiles p ON p.org_id=o.id WHERE o.id=?",
            (original["org_id"],),
        ).fetchone()
        if facility is None or facility[1] != "facility" or bool(facility[0]) != ctx.demo \
                or original["org_id"] == ctx.actor.org_id:
            return None
        if original["location_id"] and not ctx.db.execute(
            "SELECT 1 FROM p_locations WHERE id=? AND org_id=?", (original["location_id"], original["org_id"])
        ).fetchone():
            return None
        return row, {"org_id", "location_id"}
    return None


SLUG = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*-[0-9a-f]{6}$")


def _slug(ctx, wanted, fallback, own_id=None):
    """The archived address when it is one this server would issue and is free,
    otherwise ``fallback()``."""
    if isinstance(wanted, str) and len(wanted) <= 48 and SLUG.match(wanted) and not ctx.db.execute(
            "SELECT 1 FROM s_creator_profiles WHERE slug=? AND id IS NOT ?", (wanted, own_id)).fetchone():
        return wanted
    return fallback()


def restore_row(ctx: RestoreContext, table, original, mapping):
    """``None`` to leave the row out, or ``(row, external_columns, conflict)``.

    ``external_columns`` already name existing rows of this server and are not
    remapped; ``conflict`` names the key to update on instead of inserting."""
    row = dict(original)
    for column in _user_columns(ctx.meta, table) & ATTRIBUTION:
        if row.get(column) is not None and ("p_users", row[column]) not in mapping:
            row[column] = None
    external, conflict = set(), None
    if table == "s_org_profiles":
        conflict = "org_id"
    elif table == "s_capabilities":
        if row["capability"] != "creator":
            ctx.summary["sedens_permissions_not_restored"] += 1
            return None
        conflict = "user_id,capability"
    elif table == "s_creator_profiles":
        upsert = bool(original["id"] == ctx.exporter_profile and original.get("user_id") == ctx.manifest["exporter_id"]
                      and ctx.existing_profile)
        # A SEDENS decision is never taken from an archive: a verified profile
        # returns to the review queue for a reviewer to confirm again.
        if row["verification_state"] == "verified" and not upsert:
            row.update(verification_state="pending", verified_at=None,
                       verification_note="Restored from a backup. Waiting for SEDENS to confirm the verification again.")
            ctx.summary["verifications_to_confirm"] += 1
        row["verified_by"] = None
        # The product's own rules, not the archive's: creator types allowed for this
        # kind of organization, and addresses the server issues.
        if row["creator_type"] not in creators.TYPES_BY_ORG_KIND[ctx.kind]:
            row["creator_type"] = creators.DEFAULT_TYPE[ctx.kind]
        if upsert:
            conflict = "id"
            external = {"verified_by", "user_id"}  # the server's own rows, kept as they are
            existing = ctx.db.execute("SELECT * FROM s_creator_profiles WHERE id=?", (ctx.existing_profile,)).fetchone()
            row["user_id"] = ctx.actor.user_id
            row["slug"] = _slug(ctx, original.get("slug"), lambda: existing["slug"], existing["id"])
            archived_state = original.get("verification_state")
            # The profile already on this server keeps its SEDENS decision (a suspension
            # stays a suspension); changed content needs a new review, as in save_profile.
            for column in ("verification_state", "verified_by", "verified_at", "verification_note"):
                row[column] = existing[column]
            changed = any(row[f] != existing[f] for f in creators.REVIEWED_FIELDS)
            if changed and existing["verification_state"] in ("verified", "pending"):
                row.update(verification_state="unverified", verified_by=None, verified_at=None,
                           verification_note="Profile changed by a restore. Ask for review again.")
            elif existing["verification_state"] == "unverified" and archived_state in ("verified", "pending"):
                # A studio registered afresh: the archived verification waits for a reviewer again.
                row.update(verification_state="pending", verified_by=None, verified_at=None,
                           verification_note="Restored from a backup. Waiting for SEDENS to confirm the verification again.")
                ctx.summary["verifications_to_confirm"] += 1
        else:
            row["slug"] = _slug(ctx, original.get("slug"), lambda: creators._slug(ctx.db, row["display_name"]))
    elif table == "s_creator_facility_affiliations":
        result = _restore_affiliation(ctx, original, mapping)
        if result is None:
            ctx.summary["affiliations_not_restored"] += 1
            return None
        row, external = result
        for column in ("requested_by", "decided_by"):
            if row.get(column) is not None and ("p_users", row[column]) not in mapping:
                row[column] = None
        ctx.summary["affiliations_restored"] += 1
    elif table == "s_room_devices":
        row["token_hash"] = None
        if row["status"] == "active":
            row.update(status="revoked", revoked_at=now(), revoked_by=None)
            ctx.summary["room_screens_to_pair_again"] += 1
    elif table == "s_room_sessions":
        row["token_hash"] = digest(token())  # a fresh credential nobody holds
        if row["state"] == "active":
            row.update(state="ended", ended_at=now(), end_reason="restored")
            ctx.summary["room_sessions_closed"] += 1
    elif table == "s_crm_settings":
        if row["provider"] == "demo" and not ctx.demo:
            row.update(provider="none", config="{}")
            ctx.summary["crm_settings_reset"] += 1
    else:
        decided = _restore_course_row(ctx, table, original, row, mapping)
        if decided is None:
            return None
        row, external = decided
    return row, external, conflict


def begin_rows(ctx: RestoreContext):
    """Called once the platform organization row is restored (its demo flag set)."""
    found = ctx.db.execute("SELECT demo FROM p_organizations WHERE id=?", (ctx.actor.org_id,)).fetchone()
    ctx.demo = bool(found[0]) if found else False
