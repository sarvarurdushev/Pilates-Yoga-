"""Stream an organization archive; restore into an empty, authenticated studio.

Sessions and password hashes are never exported. Every private ID is remapped on
restore, and every foreign key must resolve inside the archive or public anatomy.

SEDENS tables (``s_*``) travel in the same archive under the per-table policies
of :mod:`pilates.sedens.backup`: live credentials are never exported, and
decisions made outside the organization are re-checked against this server
rather than taken from the archive.
"""

from contextlib import contextmanager
from pathlib import Path
import json
import shutil
import tempfile
import zipfile
from .repository import (
    Refused, uid, now, encode, backfill_session_exercise_events,
)
from .inspection import schema, scope, PUBLIC
from .media import TYPES as MEDIA_TYPES

MEDIA_KINDS = {"capture", "exercise", "scan", "profile"}

MAX_ARCHIVE = 256 * 1024 * 1024
MAX_EXPANDED = 1024 * 1024 * 1024
# Tables added since the first organization archive format. Old archives may
# omit these; all other current private tables are required on restore.
OPTIONAL_RESTORE_TABLES = {
    "p_program_step_details", "p_program_step_notes", "p_program_revisions",
    "p_program_revision_visits", "p_resource_details",
    "p_training_session_program_versions", "p_session_analyses",
    "p_session_recorders", "p_session_exercise_events", "p_session_notes", "p_session_scans",
    "p_scan_finding_visits",
}


def _sedens(db):
    """The SEDENS backup policies when this database has SEDENS tables."""
    from ..sedens import backup as sedens_backup

    return sedens_backup if sedens_backup.present(db) else None


def _foreign_actor(db, org_id, actor_id):
    return actor_id is not None and not db.execute(
        "SELECT 1 FROM p_users WHERE id=? AND org_id=?", (actor_id, org_id)
    ).fetchone()


def admin_only(actor):
    if actor.role != "admin":
        raise Refused("Only administrators can back up or restore a studio.", 403)


@contextmanager
def export_archive(repo, actor):
    admin_only(actor)
    with tempfile.TemporaryDirectory(prefix="motion-backup-") as folder:
        archive = Path(folder) / "motion-yoga-backup.zip"
        with (
            repo.db() as db,
            zipfile.ZipFile(
                archive, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=1
            ) as z,
        ):
            db.execute("BEGIN")  # one consistent snapshot across all entity tables
            meta = schema(db)
            ext = _sedens(db)
            if ext:
                meta.update(ext.schema(db))
                ctx = ext.ExportContext.open(db, actor.org_id, meta, repo)
            tables = sorted(set(meta) - PUBLIC)
            files, paths = {}, {}
            for table in tables:
                owned = bool(ext and ext.owns(table))
                where, args = (ext.scope if owned else scope)(table, meta, actor.org_id)
                with z.open("records/" + table + ".jsonl", "w") as output:
                    for row in db.execute(
                        f'SELECT * FROM "{table}" WHERE {where}', args
                    ):
                        item = dict(row)
                        item.pop("password_hash", None)
                        if table == "p_audit" and _foreign_actor(db, actor.org_id, item["actor_id"]):
                            item["actor_id"] = None  # the archive carries only this studio's people
                        if owned:
                            item = ext.export_row(ctx, table, item)
                            if item is None:
                                continue
                        if table == "p_media":
                            path = Path(item.pop("path"))
                            if not path.is_file():
                                raise Refused(
                                    "A saved media file is missing. Restore it or remove its record before creating a complete backup.",
                                    409,
                                )
                            part = paths.setdefault(
                                str(path.resolve()), "media/" + item["id"] + path.suffix
                            )
                            files[item["id"]] = part
                        output.write((encode(item) + "\n").encode())
            for path, part in paths.items():
                z.write(path, part)
            manifest = {
                "format": "motion-yoga-organization",
                "version": 1,
                "created_at": now(),
                "organization_id": actor.org_id,
                "exporter_id": actor.user_id,
                "tables": tables,
                "media_files": files,
            }
            if ext:
                manifest["sedens"], extra = ext.export_extras(ctx)
                for part, body in extra.items():
                    if isinstance(body, Path):
                        z.write(body, part)
                    else:
                        z.writestr(part, body)
            z.writestr("manifest.json", encode(manifest))
        yield archive


def _check_types(row, declared):
    """Every value must have its column's type. SQLite would otherwise keep, for
    example, text in an INTEGER column, and a page might print it unescaped."""
    for column, value in row.items():
        kind = declared.get(column, "")
        if value is None:
            continue
        if "INT" in kind:
            ok = isinstance(value, int)
        elif any(t in kind for t in ("REAL", "FLOA", "DOUB")):
            ok = isinstance(value, (int, float)) and not isinstance(value, bool)
        elif any(t in kind for t in ("TEXT", "CHAR", "CLOB")):
            ok = isinstance(value, str)
        else:
            ok = isinstance(value, (str, int, float))
        if not ok:
            raise Refused("Invalid backup record.")


ARCHIVED_DETAIL = {"generated": bool, "sample": bool, "demo": bool, "panel": int, "provenance": str,
                   "attribution": str, "source_url": str, "copied_from": str}


def media_detail(path, mime, archived, text_ids):
    """A restored media record's detail: measured from the file with the upload's
    own checks, plus the archive's labelled facts of the expected types."""
    from .media import dicom_metadata

    detail = {}
    if mime.startswith("image/"):
        from PIL import Image

        try:
            with Image.open(path) as img:
                if img.format not in ("JPEG", "PNG", "WEBP") or img.width * img.height > 16_000_000:
                    raise Refused("Invalid media entry in backup.")
                detail = {"width": img.width, "height": img.height}
                img.verify()
        except Refused:
            raise
        except Exception as exc:
            raise Refused("Invalid media entry in backup.") from exc
    elif mime == "application/dicom":
        detail = dicom_metadata(path)
    else:
        with path.open("rb") as f:
            signature = f.read(64)
        if not ((mime == "video/mp4" and b"ftyp" in signature)
                or (mime == "video/webm" and signature.startswith(b"\x1aE\xdf\xa3"))):
            raise Refused("Invalid media entry in backup.")
    if isinstance(archived, dict):
        for key, kind in ARCHIVED_DETAIL.items():
            value = archived.get(key)
            if isinstance(value, kind) and not (kind is int and isinstance(value, bool)):
                if kind is str:
                    value = value[:2000]
                    if key == "source_url" and not value.startswith(("https://", "http://")):
                        continue
                    if key == "copied_from":
                        value = text_ids.get(value, value)
                detail[key] = value
    return detail


def rows(z, table):
    with z.open("records/" + table + ".jsonl") as source:
        for line in source:
            if len(line) > 32 * 1024 * 1024:
                raise Refused("A backup record exceeds the supported size.")
            value = json.loads(line)
            if not isinstance(value, dict):
                raise Refused("Invalid backup record.")
            yield value


def restore_archive(repo, actor, archive):
    admin_only(actor)
    created = []
    ctx = None
    try:
        with zipfile.ZipFile(archive) as z, repo.db() as db:
            entries = z.infolist()
            if len(entries) > 10000 or sum(e.file_size for e in entries) > MAX_EXPANDED:
                raise Refused(
                    "Use a backup with at most 1 GB of expanded records and media."
                )
            if z.getinfo("manifest.json").file_size > 2 * 1024 * 1024:
                raise Refused("Invalid backup manifest.")
            manifest = json.loads(z.read("manifest.json"))
            if (
                manifest.get("format") != "motion-yoga-organization"
                or manifest.get("version") != 1
            ):
                raise Refused("Choose a Motion Yoga organization backup.")
            meta = schema(db)
            ext = _sedens(db)
            if ext:
                meta.update(ext.schema(db))
            tables = manifest.get("tables", [])
            if not isinstance(tables, list) or not all(isinstance(t, str) for t in tables):
                raise Refused("The backup schema does not match this application version.")
            # The server decides the order (organizations first), never the manifest.
            tables = sorted(tables)
            expected = set(meta) - PUBLIC
            # Archives made before SEDENS (or before a SEDENS table existed) omit them.
            optional_new = OPTIONAL_RESTORE_TABLES | (ext.INCLUDED if ext else set())
            missing = expected - set(tables)
            if (set(tables) - expected) or (missing - optional_new) or len(tables) != len(set(tables)):
                raise Refused(
                    "The backup schema does not match this application version."
                )
            db.execute("BEGIN IMMEDIATE")
            ctx = ext.open_restore(db, actor, manifest, z, meta, repo) if ext else None
            for table in tables:
                if table in {"p_organizations", "p_users", "p_roles", "p_audit"}:
                    continue
                if ext and ext.owns(table):
                    if ext.blocks_restore(ctx, table, meta):
                        raise Refused(
                            "Restore into a new, empty studio. Existing client records are never overwritten.",
                            409,
                        )
                    continue
                where, args = scope(table, meta, actor.org_id)
                if db.execute(
                    f'SELECT 1 FROM "{table}" WHERE {where} LIMIT 1', args
                ).fetchone():
                    raise Refused(
                        "Restore into a new, empty studio. Existing client records are never overwritten.",
                        409,
                    )
            if (
                db.execute(
                    "SELECT count(*) FROM p_users WHERE org_id=?", (actor.org_id,)
                ).fetchone()[0]
                != 1
            ):
                raise Refused(
                    "Restore into a new studio containing only your administrator account.",
                    409,
                )
            mapping = {
                ("p_organizations", manifest["organization_id"]): actor.org_id,
                ("p_users", manifest["exporter_id"]): actor.user_id,
            }
            # Allocate IDs first so forward references and cyclic relationships resolve.
            for table in tables:
                keys = meta[table]["primary_key"]
                if len(keys) != 1:
                    continue
                key = keys[0]
                if any(f["from"] == key for f in meta[table]["foreign_keys"]):
                    continue
                integer = next(
                    r[2] == "INTEGER"
                    for r in db.execute(f"PRAGMA table_info({table})")
                    if r[1] == key
                )
                serial = (
                    db.execute(
                        f'SELECT COALESCE(MAX("{key}"),0) FROM "{table}"'
                    ).fetchone()[0]
                    if integer
                    else 0
                )
                for row in rows(z, table):
                    serial += 1
                    mapping.setdefault((table, row[key]), serial if integer else uid())
            # Profile PKs inherit the corresponding user ID.
            for table in tables:
                keys = meta[table]["primary_key"]
                if len(keys) != 1:
                    continue
                for fk in meta[table]["foreign_keys"]:
                    if fk["from"] == keys[0]:
                        for row in rows(z, table):
                            try:
                                mapping[(table, row[keys[0]])] = mapping[
                                    (fk["table"], row[keys[0]])
                                ]
                            except KeyError:
                                raise Refused(
                                    "A profile references an account outside this backup."
                                )
            if ext:
                ext.prepare(ctx, lambda t: rows(z, t) if t in tables else iter(()), mapping)
            text_ids = {
                old: new for (_, old), new in mapping.items() if isinstance(old, str)
            }

            def remap_json(value):
                if isinstance(value, str):
                    return text_ids.get(value, value)
                if isinstance(value, list):
                    return [remap_json(v) for v in value]
                if isinstance(value, dict):
                    return {text_ids.get(k, k): remap_json(v) for k, v in value.items()}
                return value

            db.execute("PRAGMA defer_foreign_keys=ON")
            count = 0
            for table in tables:
                keys = meta[table]["primary_key"]
                fks = {f["from"]: f for f in meta[table]["foreign_keys"]}
                declared = {r[1]: r[2].upper() for r in db.execute(f'PRAGMA table_info("{table}")')}
                seen = set()
                owned = bool(ext and ext.owns(table))
                if owned:
                    ext.begin_rows(ctx)
                json_columns = (
                    ext.json_columns(table) if owned
                    else {"detail", "result", "summary", "completed", "snapshot"}
                )
                for original in rows(z, table):
                    if set(original) - set(meta[table]["columns"]):
                        raise Refused("Unknown fields in the backup.")
                    _check_types(original, declared)
                    if keys:
                        # A record twice would let an update apply twice to one target.
                        identity = tuple(original.get(k) for k in keys)
                        if identity in seen:
                            raise Refused("The backup contains a record twice.")
                        seen.add(identity)
                    external, conflict = set(), None
                    if owned:
                        decided = ext.restore_row(ctx, table, original, mapping)
                        if decided is None:
                            continue
                        original, external, conflict = decided
                    if table == "p_organizations":
                        if original["id"] != manifest["organization_id"]:
                            raise Refused(
                                "The backup contains more than one organization."
                            )
                        db.execute(
                            "UPDATE p_organizations SET name=?,demo=? WHERE id=?",
                            (
                                original["name"],
                                int(bool(original["demo"])),
                                actor.org_id,
                            ),
                        )
                        continue
                    if table == "p_users" and original["id"] == manifest["exporter_id"]:
                        continue
                    if (
                        table == "p_roles"
                        and original["user_id"] == manifest["exporter_id"]
                    ):
                        continue
                    row = dict(original)
                    for key, value in original.items():
                        if key in external:
                            continue  # already names an existing row on this server
                        if key in fks and value is not None:
                            parent = fks[key]["table"]
                            if parent not in PUBLIC:
                                if (parent, value) not in mapping:
                                    raise Refused(
                                        "A foreign key points outside this backup."
                                    )
                                row[key] = mapping[(parent, value)]
                        elif len(keys) == 1 and key == keys[0]:
                            row[key] = mapping[(table, value)]
                        elif table == "p_program_revisions" and key == "source_id" and value:
                            row[key] = text_ids.get(value, value)
                        elif table == "p_session_exercise_events" and key == "completed_key" and value:
                            row[key] = text_ids.get(value, value)
                        elif key in json_columns and value is not None:
                            row[key] = encode(remap_json(json.loads(value)))
                    if table == "p_users":
                        row["password_hash"] = ""
                    if table == "p_media":
                        part = manifest["media_files"].get(original["id"], "")
                        if (
                            not part.startswith("media/")
                            or ".." in part.split("/")
                            or z.getinfo(part).is_dir()
                            # Only types the studio itself accepts: a crafted
                            # text/html record would otherwise be served same-origin.
                            or row.get("mime") not in MEDIA_TYPES
                            or row.get("kind") not in MEDIA_KINDS
                        ):
                            raise Refused("Invalid media entry in backup.")
                        target = (
                            repo.media_root
                            / actor.org_id
                            / (row["id"] + MEDIA_TYPES[row["mime"]])
                        )
                        target.parent.mkdir(parents=True, exist_ok=True)
                        created.append(target)
                        with z.open(part) as source, target.open("wb") as output:
                            shutil.copyfileobj(source, output, length=65536)
                        row["path"] = str(target)
                        row["size"] = target.stat().st_size
                        # What the file says about itself comes from the file, checked
                        # as an upload is; only a few labelled facts come from the archive.
                        row["detail"] = encode(media_detail(target, row["mime"], json.loads(original.get("detail") or "{}"),
                                                            text_ids))
                    if table == "p_jobs" and row["state"] in {"queued", "running"}:
                        row.update(
                            state="failed",
                            error="The server restarted. Submit the preserved capture again.",
                            finished_at=now(),
                        )
                    upsert = ""
                    if conflict:
                        targets = {c.strip() for c in conflict.split(",")}
                        upsert = f" ON CONFLICT({conflict}) DO UPDATE SET " + ",".join(
                            f'"{k}"=excluded."{k}"' for k in row if k not in targets
                        )
                    db.execute(
                        f'INSERT INTO "{table}" ('
                        + ",".join('"' + k + '"' for k in row)
                        + ") VALUES ("
                        + ",".join("?" for _ in row)
                        + ")"
                        + upsert,
                        list(row.values()),
                    )
                    count += 1
            backfill_session_exercise_events(db)
            # Old archives have no marker-time visit evidence. A scan's current
            # visit link alone cannot prove where an older marker belongs.
            if db.execute(
                "SELECT 1 FROM p_scan_finding_visits fv "
                "JOIN p_scan_findings f ON f.id=fv.finding_id "
                "JOIN p_scans s ON s.id=f.scan_id "
                "LEFT JOIN p_session_scans ss ON ss.scan_id=s.id "
                "LEFT JOIN p_training_sessions ts ON ts.id=fv.session_id "
                "WHERE s.org_id=? AND (ss.session_id IS NOT fv.session_id "
                "OR ts.student_id IS NOT s.student_id) LIMIT 1",
                (actor.org_id,),
            ).fetchone():
                raise Refused("A scan marker in the backup belongs to a different visit or client.")
            if db.execute("PRAGMA foreign_key_check").fetchone():
                raise Refused("The restored archive contains a broken relationship.")
            repo.audit(
                db, actor, "restore:organization", actor.org_id, {"records": count}
            )
        result = {
            "restored_records": count,
            "media_files": len(created),
            "message": "Records restored. Set passwords for restored coach and student accounts before they sign in.",
        }
        if ctx is not None:
            result["sedens"] = ctx.summary
        return result
    except (zipfile.BadZipFile, KeyError, json.JSONDecodeError) as e:
        for path in created + (ctx.files if ctx is not None else []):
            path.unlink(missing_ok=True)
        raise Refused("This backup is incomplete or invalid.") from e
    except Exception:
        for path in created + (ctx.files if ctx is not None else []):
            path.unlink(missing_ok=True)
        raise


def restore_upload(repo, actor, stream, length):
    admin_only(actor)
    if not 0 < length <= MAX_ARCHIVE:
        raise Refused("Choose a backup up to 256 MB.", 413)
    with tempfile.TemporaryFile() as f:
        remaining = length
        while remaining:
            block = stream.read(min(65536, remaining))
            if not block:
                raise Refused("Backup upload interrupted. Select the file again.")
            f.write(block)
            remaining -= len(block)
        f.seek(0)
        return restore_archive(repo, actor, f)
