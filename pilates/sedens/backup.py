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
"""

from __future__ import annotations

from dataclasses import dataclass, field
import re

from ..platform.inspection import scope as platform_scope
from ..platform.repository import Refused
from . import creators
from .util import digest, now, token, uid

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
    "s_schema": Policy(False, "this server's migration ledger"),
    "s_affiliation_ledger": Policy(False, "this server's record of affiliation decisions, which restores are checked against"),
    "s_room_device_pairings": Policy(False, "short-lived pairing codes and secrets"),
    "s_room_access_codes": Policy(False, "single-use room access codes"),
}
INCLUDED = frozenset(t for t, p in POLICIES.items() if p.include)
# Attribution columns: who did something. Emptied when that person is outside the archive.
ATTRIBUTION = {
    "granted_by", "revoked_by", "verified_by", "requested_by", "decided_by",
    "created_by", "updated_by", "confirmed_by",
}


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

    @classmethod
    def open(cls, db, org_id, meta):
        users = {r[0] for r in db.execute("SELECT id FROM p_users WHERE org_id=?", (org_id,))}
        return cls(db, org_id, meta, users)


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
    return item


def export_extras(ctx: ExportContext) -> tuple[dict, dict]:
    """(manifest entry, {archive part: bytes})."""
    return {"format": FORMAT}, {}


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
    summary: dict = field(default_factory=lambda: {
        "room_screens_to_pair_again": 0,
        "room_sessions_closed": 0,
        "verifications_to_confirm": 0,
        "affiliations_restored": 0,
        "affiliations_not_restored": 0,
        "sedens_permissions_not_restored": 0,
        "crm_settings_reset": 0,
    })


def open_restore(db, actor, manifest, archive, meta) -> RestoreContext:
    entry = manifest.get("sedens")
    if entry is not None and (not isinstance(entry, dict) or entry.get("format") != FORMAT):
        raise Refused("The SEDENS part of this backup is not supported.")
    return RestoreContext(db, actor, manifest, meta)


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
    return row, external, conflict


def begin_rows(ctx: RestoreContext):
    """Called once the platform organization row is restored (its demo flag set)."""
    found = ctx.db.execute("SELECT demo FROM p_organizations WHERE id=?", (ctx.actor.org_id,)).fetchone()
    ctx.demo = bool(found[0]) if found else False
