"""A downloaded archive must be complete before a hosted storage migration."""

from io import BytesIO
import json
import subprocess
import sys
from zipfile import ZipFile

import pytest
from PIL import Image

from pilates.platform.backup import export_archive
from pilates.platform.backup_verify import ArchiveVerificationError, verify_archive
from pilates.platform.media import upload
from pilates.platform.repository import Repository


def exported_studio(tmp_path):
    repo = Repository(tmp_path / "source.db")
    admin = repo.actor(repo.create_org(
        "Archive owner", "archive-owner@example.test", "long-archive-password", "Archive studio"
    ))
    student = repo.save_person(admin, {"name": "Archive client", "roles": ["student"]})["id"]
    picture = BytesIO()
    Image.new("RGB", (8, 8), "white").save(picture, format="PNG")
    body = picture.getvalue()
    upload(repo, admin, BytesIO(body), len(body), "test.png", "image/png", "scan", student)
    target = tmp_path / "downloaded.zip"
    with export_archive(repo, admin) as archive:
        target.write_bytes(archive.read_bytes())
    return target, admin.org_id


def rewrite_archive(source, target, replace=None, omit=None):
    with ZipFile(source) as old, ZipFile(target, "w") as new:
        for info in old.infolist():
            if info.filename == omit:
                continue
            body = old.read(info)
            if info.filename == replace:
                rows = [json.loads(line) for line in body.splitlines()]
                rows[0]["size"] += 1
                body = b"".join((json.dumps(row) + "\n").encode() for row in rows)
            new.writestr(info, body)


def test_downloaded_archive_receipt_checks_records_media_and_checksum(tmp_path):
    archive, org_id = exported_studio(tmp_path)
    receipt = verify_archive(archive)
    assert receipt["organization_id"] == org_id
    assert receipt["media_files"] == 1
    assert receipt["table_counts"]["p_students"] == 1
    assert receipt["table_counts"]["p_media"] == 1
    assert len(receipt["sha256"]) == 64
    assert "Archive client" not in json.dumps(receipt)


def test_downloaded_archive_rejects_missing_or_mismatched_media(tmp_path):
    archive, _ = exported_studio(tmp_path)
    with ZipFile(archive) as source:
        part = next(name for name in source.namelist() if name.startswith("media/"))
    missing = tmp_path / "missing-media.zip"
    rewrite_archive(archive, missing, omit=part)
    with pytest.raises(ArchiveVerificationError, match="missing records/media"):
        verify_archive(missing)
    mismatched = tmp_path / "wrong-size.zip"
    rewrite_archive(archive, mismatched, replace="records/p_media.jsonl")
    with pytest.raises(ArchiveVerificationError, match="recorded size"):
        verify_archive(mismatched)


def test_downloaded_archive_rejects_damaged_zip_and_duplicate_members(tmp_path):
    archive, _ = exported_studio(tmp_path)
    damaged = tmp_path / "damaged.zip"
    damaged.write_bytes(archive.read_bytes()[:100])
    with pytest.raises(ArchiveVerificationError, match="incomplete or damaged"):
        verify_archive(damaged)
    duplicate = tmp_path / "duplicate.zip"
    with ZipFile(archive) as old:
        entries = [(info.filename, old.read(info), info.compress_type) for info in old.infolist()]
    with ZipFile(duplicate, "w") as new:
        for name, body, compression in entries:
            new.writestr(name, body, compress_type=compression)
        with pytest.warns(UserWarning):
            new.writestr("manifest.json", next(body for name, body, _ in entries if name == "manifest.json"))
    with pytest.raises(ArchiveVerificationError, match="duplicate"):
        verify_archive(duplicate)


def test_downloaded_archive_rejects_missing_required_table_even_if_manifest_is_edited(tmp_path):
    archive, _ = exported_studio(tmp_path)
    altered = tmp_path / "missing-table.zip"
    with ZipFile(archive) as old:
        entries = [(info.filename, old.read(info), info.compress_type) for info in old.infolist()]
    with ZipFile(altered, "w") as new:
        for name, body, compression in entries:
            if name == "records/p_students.jsonl":
                continue
            if name == "manifest.json":
                manifest = json.loads(body)
                manifest["tables"].remove("p_students")
                body = json.dumps(manifest).encode()
            new.writestr(name, body, compress_type=compression)
    with pytest.raises(ArchiveVerificationError, match="restore schema"):
        verify_archive(altered)


def test_downloaded_archive_rejects_broken_profile_relationship_even_with_valid_crc(tmp_path):
    archive, _ = exported_studio(tmp_path)
    altered = tmp_path / "missing-client-account.zip"
    with ZipFile(archive) as old:
        manifest = json.loads(old.read("manifest.json"))
        entries = [(info.filename, old.read(info), info.compress_type) for info in old.infolist()]
    with ZipFile(altered, "w") as new:
        for name, body, compression in entries:
            if name == "records/p_users.jsonl":
                users = [json.loads(line) for line in body.splitlines()]
                users = [user for user in users if user["id"] == manifest["exporter_id"]]
                body = b"".join((json.dumps(user) + "\n").encode() for user in users)
            new.writestr(name, body, compress_type=compression)
    with pytest.raises(ArchiveVerificationError, match="could not be restored"):
        verify_archive(altered)


def test_backup_verification_command_emits_private_data_free_receipt(tmp_path):
    archive, org_id = exported_studio(tmp_path)
    completed = subprocess.run(
        [sys.executable, "-m", "pilates.platform.backup_verify", str(archive)],
        capture_output=True, text=True, check=True,
    )
    receipt = json.loads(completed.stdout)
    assert receipt["organization_id"] == org_id
    assert receipt["dry_run_restored_records"] > 0
    assert "Archive client" not in completed.stdout
