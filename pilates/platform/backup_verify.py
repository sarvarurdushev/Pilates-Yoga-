"""Verify a downloaded organization archive before changing hosted storage.

This is an offline check of the exact ZIP bytes. It does not need a running
studio or credentials. A disposable local studio receives a temporary restore
for relationship checks; the returned receipt exposes no client records.
"""

from __future__ import annotations

from collections import Counter
from contextlib import closing
from hashlib import sha256
import json
import sqlite3
import tempfile
from pathlib import Path
import sys
from zipfile import BadZipFile, ZipFile

from .backup import MAX_ARCHIVE, MAX_EXPANDED, OPTIONAL_RESTORE_TABLES, restore_archive
from .inspection import PUBLIC, schema
from .repository import Refused, Repository


class ArchiveVerificationError(ValueError):
    """The file cannot be relied on as a complete organization backup."""


def verify_archive(path: str | Path) -> dict:
    """Check format, member integrity, record/media coverage, and byte sizes.

    Return a small receipt safe to compare with another downloaded archive.
    Actual restore still requires a new empty studio and administrator sign-in.
    """

    path = Path(path)
    size = path.stat().st_size
    if not 0 < size <= MAX_ARCHIVE:
        raise ArchiveVerificationError("Archive is empty or exceeds the restore limit.")
    digest = sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)

    try:
        with ZipFile(path) as archive:
            members = archive.infolist()
            names = [member.filename for member in members]
            if len(names) != len(set(names)) or len(names) > 10000:
                raise ArchiveVerificationError("Archive has duplicate or excessive entries.")
            if sum(member.file_size for member in members) > MAX_EXPANDED:
                raise ArchiveVerificationError("Archive exceeds the expanded restore limit.")
            manifest_info = archive.getinfo("manifest.json")
            if manifest_info.file_size > 2 * 1024 * 1024:
                raise ArchiveVerificationError("Archive manifest is too large.")
            manifest = json.loads(archive.read(manifest_info))
            if not isinstance(manifest, dict) or manifest.get("format") != "motion-yoga-organization" or manifest.get("version") != 1:
                raise ArchiveVerificationError("This is not a supported Motion Yoga archive.")
            tables = manifest.get("tables")
            media_files = manifest.get("media_files")
            if not isinstance(tables, list) or not tables or any(not isinstance(table, str) or not table.startswith(("p_", "s_")) or not table.replace("_", "").isalnum() for table in tables) or len(tables) != len(set(tables)):
                raise ArchiveVerificationError("Archive table list is invalid.")
            if not isinstance(media_files, dict) or not isinstance(manifest.get("organization_id"), str) or not manifest["organization_id"] or not isinstance(manifest.get("exporter_id"), str) or not manifest["exporter_id"]:
                raise ArchiveVerificationError("Archive identity or media list is invalid.")
            # Match the same current/legacy table coverage rules as restore.
            from ..sedens import backup as sedens_backup, migrations as sedens_migrations

            with closing(sqlite3.connect(":memory:")) as db:
                db.row_factory = sqlite3.Row
                db.executescript(Path(__file__).with_name("schema.sql").read_text())
                sedens_migrations.migrate(db)
                expected_tables = (set(schema(db)) | set(sedens_backup.schema(db))) - PUBLIC
            missing_tables = expected_tables - set(tables)
            if set(tables) - expected_tables or missing_tables - (OPTIONAL_RESTORE_TABLES | sedens_backup.INCLUDED):
                raise ArchiveVerificationError("Archive table list does not match the restore schema.")
            expected = {"manifest.json", *(f"records/{table}.jsonl" for table in tables)}
            expected.update(media_files.values())
            try:
                course_files = sedens_backup.archived_files(manifest)
            except Refused as error:
                raise ArchiveVerificationError("Archive course file list is invalid.") from error
            expected.update(course_files.values())
            if set(names) != expected:
                raise ArchiveVerificationError("Archive is missing records/media or has unexpected files.")
            if any(not isinstance(part, str) or not part.startswith("media/") or part.endswith("/") or ".." in part.split("/") for part in media_files.values()):
                raise ArchiveVerificationError("Archive media path is invalid.")

            counts = Counter()
            media_rows = {}
            organization_rows = []
            exporter_present = False
            for table in tables:
                with archive.open(f"records/{table}.jsonl") as rows:
                    while line := rows.readline(32 * 1024 * 1024 + 1):
                        if len(line) > 32 * 1024 * 1024:
                            raise ArchiveVerificationError("An archive record is too large.")
                        item = json.loads(line)
                        if not isinstance(item, dict) or "password_hash" in item:
                            raise ArchiveVerificationError("An archive record is invalid or includes a password hash.")
                        counts[table] += 1
                        if table == "p_media":
                            media_id = item.get("id")
                            media_size = item.get("size")
                            if not isinstance(media_id, str) or not isinstance(media_size, int) or media_size < 0 or media_id in media_rows:
                                raise ArchiveVerificationError("An archive media record is invalid.")
                            media_rows[media_id] = media_size
                        if table == "p_organizations":
                            organization_rows.append(item.get("id"))
                        if table == "p_users" and item.get("id") == manifest["exporter_id"]:
                            exporter_present = True
            if organization_rows != [manifest["organization_id"]] or not exporter_present:
                raise ArchiveVerificationError("Archive owner does not match the organization records.")
            if set(media_rows) != set(media_files):
                raise ArchiveVerificationError("A saved media record is missing its file.")
            for media_id, part in media_files.items():
                if archive.getinfo(part).file_size != media_rows[media_id]:
                    raise ArchiveVerificationError("A saved media file does not match its recorded size.")
            bad = archive.testzip()
            if bad:
                raise ArchiveVerificationError(f"Archive entry failed its integrity check: {bad}")
            # A structurally complete ZIP can still have broken client/visit
            # relationships. Exercise the real importer in a disposable studio.
            try:
                with tempfile.TemporaryDirectory(prefix="motion-verify-") as folder:
                    from ..sedens.core import Sedens

                    temporary = Repository(Path(folder) / "studio.db")
                    Sedens(temporary)
                    owner = temporary.actor(temporary.create_org(
                        "Backup verifier", "verifier@example.test",
                        "temporary-verification-password", "Disposable verification studio",
                    ))
                    restored = restore_archive(temporary, owner, path)
            except (Refused, sqlite3.Error) as error:
                raise ArchiveVerificationError(
                    f"Archive could not be restored into an empty studio: {error}"
                ) from error
            except Exception as error:  # noqa: BLE001 - a crafted archive must not crash the checker
                raise ArchiveVerificationError(
                    "Archive could not be restored into an empty studio: it contains invalid records."
                ) from error
            if restored["media_files"] != len(media_rows):
                raise ArchiveVerificationError("Restore media count does not match the archive.")
            if restored.get("sedens", {}).get("course_files", 0) != len(course_files):
                raise ArchiveVerificationError("Restore course file count does not match the archive.")
            return {
                "format": manifest["format"],
                "organization_id": manifest["organization_id"],
                "created_at": manifest.get("created_at"),
                "archive_bytes": size,
                "sha256": digest.hexdigest(),
                "table_counts": dict(sorted(counts.items())),
                "media_files": len(media_rows),
                "course_files": len(course_files),
                "dry_run_restored_records": restored["restored_records"],
            }
    except (BadZipFile, KeyError, TypeError, UnicodeDecodeError, json.JSONDecodeError, RuntimeError) as error:
        raise ArchiveVerificationError("Archive is incomplete or damaged.") from error


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: python -m pilates.platform.backup_verify BACKUP.zip", file=sys.stderr)
        return 2
    try:
        result = verify_archive(sys.argv[1])
    except (ArchiveVerificationError, OSError) as error:
        print(f"Backup verification failed: {error}", file=sys.stderr)
        return 1
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
