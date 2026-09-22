"""Stream an organization archive; restore into an empty, authenticated studio.

Sessions and password hashes are never exported. Every private ID is remapped on
restore, and every foreign key must resolve inside the archive or public anatomy.
"""

from contextlib import contextmanager
from pathlib import Path
import json
import shutil
import tempfile
import zipfile
from .repository import Refused, uid, now, encode
from .inspection import schema, scope, PUBLIC

MAX_ARCHIVE = 256 * 1024 * 1024
MAX_EXPANDED = 1024 * 1024 * 1024


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
            tables = sorted(set(meta) - PUBLIC)
            files, paths = {}, {}
            for table in tables:
                where, args = scope(table, meta, actor.org_id)
                with z.open("records/" + table + ".jsonl", "w") as output:
                    for row in db.execute(
                        f'SELECT * FROM "{table}" WHERE {where}', args
                    ):
                        item = dict(row)
                        item.pop("password_hash", None)
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
            z.writestr(
                "manifest.json",
                encode(
                    {
                        "format": "motion-yoga-organization",
                        "version": 1,
                        "created_at": now(),
                        "organization_id": actor.org_id,
                        "exporter_id": actor.user_id,
                        "tables": tables,
                        "media_files": files,
                    }
                ),
            )
        yield archive


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
            tables = manifest.get("tables", [])
            expected = set(meta) - PUBLIC
            if set(tables) != expected or len(tables) != len(expected):
                raise Refused(
                    "The backup schema does not match this application version."
                )
            db.execute("BEGIN IMMEDIATE")
            for table in tables:
                if table in {"p_organizations", "p_users", "p_roles", "p_audit"}:
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
                for original in rows(z, table):
                    if set(original) - set(meta[table]["columns"]):
                        raise Refused("Unknown fields in the backup.")
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
                        elif key in {"detail", "result", "summary", "completed"}:
                            row[key] = encode(remap_json(json.loads(value)))
                    if table == "p_users":
                        row["password_hash"] = ""
                    if table == "p_media":
                        part = manifest["media_files"].get(original["id"], "")
                        if (
                            not part.startswith("media/")
                            or ".." in part.split("/")
                            or z.getinfo(part).is_dir()
                        ):
                            raise Refused("Invalid media entry in backup.")
                        target = (
                            repo.media_root
                            / actor.org_id
                            / (row["id"] + Path(part).suffix)
                        )
                        target.parent.mkdir(parents=True, exist_ok=True)
                        created.append(target)
                        with z.open(part) as source, target.open("wb") as output:
                            shutil.copyfileobj(source, output, length=65536)
                        row["path"] = str(target)
                        row["size"] = target.stat().st_size
                    if table == "p_jobs" and row["state"] in {"queued", "running"}:
                        row.update(
                            state="failed",
                            error="The server restarted. Submit the preserved capture again.",
                            finished_at=now(),
                        )
                    db.execute(
                        f'INSERT INTO "{table}" ('
                        + ",".join('"' + k + '"' for k in row)
                        + ") VALUES ("
                        + ",".join("?" for _ in row)
                        + ")",
                        list(row.values()),
                    )
                    count += 1
            if db.execute("PRAGMA foreign_key_check").fetchone():
                raise Refused("The restored archive contains a broken relationship.")
            repo.audit(
                db, actor, "restore:organization", actor.org_id, {"records": count}
            )
        return {
            "restored_records": count,
            "media_files": len(created),
            "message": "Records restored. Set passwords for restored coach and student accounts before they sign in.",
        }
    except (zipfile.BadZipFile, KeyError, json.JSONDecodeError) as e:
        for path in created:
            path.unlink(missing_ok=True)
        raise Refused("This backup is incomplete or invalid.") from e
    except Exception:
        for path in created:
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
