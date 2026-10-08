"""SEDENS migrations are additive: existing platform data keeps working unchanged.

The legacy fixture is a full connected-platform demonstration organization
(clients, programs, analyses, notes, media records, reservations, scans,
visits), plus a real organization, created *before* SEDENS ever touched the
database. Migrating must not change a single existing row, and every existing
read and delete path must still work afterwards.
"""

import hashlib
import shutil
import sqlite3
import urllib.request

import pytest

from pilates.platform.repository import Repository
from pilates.sedens import migrations
from pilates.sedens.core import Sedens
from sedens_support import PASSWORD, make_sedens, running_server

KEY = "c" * 32
ORG = "demo-" + KEY


def _platform_tables(path):
    with sqlite3.connect(path) as db:
        return [r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name GLOB 'p_*' ORDER BY name")]


def _fingerprint(path):
    """Row count and content hash of every platform table."""
    out = {}
    with sqlite3.connect(path) as db:
        for table in _platform_tables(path):
            rows = db.execute(f'SELECT * FROM "{table}" ORDER BY 1').fetchall()
            out[table] = (len(rows), hashlib.sha256(repr(rows).encode()).hexdigest())
    return out


@pytest.fixture(scope="module")
def legacy_db(tmp_path_factory):
    """A database created by the pre-SEDENS platform only."""
    folder = tmp_path_factory.mktemp("legacy")
    path = folder / "studio.db"
    repo = Repository(path)
    repo.demo_login(KEY, "coach")
    repo.create_org("Real Owner", "owner@example.test", PASSWORD, "Real Studio")
    with sqlite3.connect(path) as db:
        assert not db.execute("SELECT 1 FROM sqlite_master WHERE name LIKE 's\\_%' ESCAPE '\\'").fetchone()
    return path


@pytest.fixture
def migrated(legacy_db, tmp_path):
    path = tmp_path / "studio.db"
    shutil.copy(legacy_db, path)
    for suffix in ("-wal", "-shm"):
        src = legacy_db.with_name(legacy_db.name + suffix)
        if src.exists():
            shutil.copy(src, path.with_name(path.name + suffix))
    # Opening any database with the platform runs the platform's own idempotent
    # backfills (visit links, regions). Fingerprint after that, so the
    # comparison isolates what SEDENS changes.
    Repository(path)
    before = _fingerprint(path)
    sedens = make_sedens(path)
    return sedens, before


def test_migrations_apply_in_order_and_record_checksums(tmp_path):
    sedens = make_sedens(tmp_path / "fresh.db")
    with sedens.db() as db:
        rows = db.execute("SELECT version,name,checksum FROM s_schema ORDER BY version").fetchall()
    files = migrations.available()
    assert [r[0] for r in rows] == [v for v, _, _ in files] == [1, 2, 3, 4, 5]
    assert [r[2] for r in rows] == [migrations.checksum(sql) for _, _, sql in files]


def test_migrations_are_idempotent(tmp_path):
    sedens = make_sedens(tmp_path / "a.db")
    assert sedens.applied == [1, 2, 3, 4, 5]
    again = Sedens(sedens.repo, sedens.mode)
    assert again.applied == []


def test_an_edited_applied_migration_is_refused(tmp_path):
    folder = tmp_path / "migrations"
    folder.mkdir()
    (folder / "0001_x.sql").write_text("CREATE TABLE IF NOT EXISTS s_x(id TEXT PRIMARY KEY);")
    conn = sqlite3.connect(tmp_path / "m.db")
    assert migrations.migrate(conn, folder) == [1]
    (folder / "0001_x.sql").write_text("CREATE TABLE IF NOT EXISTS s_x(id TEXT PRIMARY KEY, y TEXT);")
    with pytest.raises(migrations.MigrationError, match="changed after it was applied"):
        migrations.migrate(conn, folder)


def test_a_failing_migration_rolls_back_completely(tmp_path):
    folder = tmp_path / "migrations"
    folder.mkdir()
    (folder / "0001_bad.sql").write_text("CREATE TABLE s_y(id TEXT PRIMARY KEY);\nTHIS IS NOT SQL;")
    conn = sqlite3.connect(tmp_path / "m.db")
    with pytest.raises(sqlite3.Error):
        migrations.migrate(conn, folder)
    assert not conn.execute("SELECT 1 FROM sqlite_master WHERE name='s_y'").fetchone()
    assert not conn.execute("SELECT 1 FROM s_schema").fetchone()


def test_only_s_tables_are_added(legacy_db, tmp_path):
    path = tmp_path / "studio.db"
    shutil.copy(legacy_db, path)
    platform_before = _platform_tables(path)
    make_sedens(path)
    assert _platform_tables(path) == platform_before
    with sqlite3.connect(path) as db:
        added = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")} - set(platform_before)
    assert added and all(name.startswith("s_") for name in added), added


def test_migration_changes_no_existing_platform_row(migrated):
    sedens, before = migrated
    assert _fingerprint(sedens.repo.path) == before


def test_every_sedens_foreign_key_targets_a_key_and_cascades_or_nulls(migrated):
    sedens, _ = migrated
    with sedens.db() as db:
        tables = [r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name GLOB 's_*'")]
        for table in tables:
            columns = {r[1]: r for r in db.execute(f'PRAGMA table_info("{table}")')}
            for fk in db.execute(f'PRAGMA foreign_key_list("{table}")'):
                parent, column, action = fk[2], fk[3], fk[6]
                assert action in ("CASCADE", "SET NULL"), (table, column, action)
                if action == "SET NULL":
                    assert columns[column][3] == 0, f"{table}.{column} is NOT NULL but SET NULL on delete"
        assert not db.execute("PRAGMA foreign_key_check").fetchall()


def test_existing_organizations_clients_and_programs_still_open(migrated):
    sedens, _ = migrated
    repo = sedens.repo
    coach = repo.actor(repo.demo_login(KEY, "coach"))
    admin = repo.actor(repo.demo_login(KEY, "admin"))
    student = repo.actor(repo.demo_login(KEY, "student"))
    me = repo.bootstrap(admin)
    assert me["organization"]["id"] == ORG and len(me["students"]) == 34
    clients = repo.people(coach)
    assert clients
    client = repo.client(coach, clients[0]["id"])
    assert client["id"] == clients[0]["id"]
    programs = repo.list(admin, "programs")["items"]
    assert programs
    assert repo.get(admin, "programs", programs[0]["id"])["id"] == programs[0]["id"]
    own = repo.client(student, student.user_id)
    assert own["id"] == student.user_id
    real = repo.actor(repo.login("owner@example.test", PASSWORD))
    assert repo.bootstrap(real)["organization"]["name"] == "Real Studio"


def test_existing_analyses_notes_media_and_reservations_still_open(migrated):
    sedens, _ = migrated
    repo = sedens.repo
    admin = repo.actor(repo.demo_login(KEY, "admin"))
    for collection in ("analyses", "notes", "media", "reservations", "scans"):
        items = repo.list(admin, collection, limit=5)["items"]
        assert items, collection
        assert repo.get(admin, collection, items[0]["id"])["id"] == items[0]["id"]
    analysis = repo.list(admin, "analyses", limit=1)["items"][0]
    assert repo.coordinates(admin, analysis["id"]) is not None


def test_platform_deletions_still_cascade_through_sedens_rows(migrated):
    """Deleting a client or a location must not be blocked by SEDENS rows."""
    from pilates.sedens import consent, crm, demo, rooms

    sedens, _ = migrated
    repo = sedens.repo
    demo.ensure(sedens, ORG)
    admin = repo.actor(repo.demo_login(KEY, "admin"))
    device_token, _ = rooms.ensure_demo_device(sedens, ORG, demo.room_id(ORG))
    entered = rooms.enter(sedens, device_token, method="qr", credential="SEDENS-QR-1001")
    student_id = entered["context"].student_id
    with sedens.db() as db:
        consent.record(db, org_id=ORG, user_id=student_id, kind="scan_capture", granted=True,
                       text_version=consent.TEXTS["scan_capture"]["version"], channel="room")
    # The platform's own delete path, unchanged.
    repo.delete(admin, "users", student_id)
    with repo.db() as db:
        assert not db.execute("SELECT 1 FROM s_room_sessions WHERE student_id=?", (student_id,)).fetchone()
        assert not db.execute("SELECT 1 FROM s_consents WHERE user_id=?", (student_id,)).fetchone()
        assert not db.execute("SELECT 1 FROM s_crm_member_links WHERE student_id=?", (student_id,)).fetchone()
        assert not db.execute("PRAGMA foreign_key_check").fetchall()
    repo.delete(admin, "locations", f"{ORG}-location0")
    with repo.db() as db:
        assert not db.execute("SELECT 1 FROM s_room_devices WHERE location_id=?", (f"{ORG}-location0",)).fetchone()
        assert not db.execute("PRAGMA foreign_key_check").fetchall()


def test_deleting_an_organization_removes_its_sedens_rows(tmp_path):
    """Whole-org deletion (used by the demo seed rollback) cascades through SEDENS.

    A fully seeded demo org cannot be deleted even before SEDENS, because of the
    platform's own ON DELETE RESTRICT program links; that is pre-existing
    behaviour and unchanged. This org has SEDENS rows of every kind instead.
    """
    from pilates.sedens import capabilities, consent, creators, crm, rooms
    from sedens_support import facility, pair

    sedens = make_sedens(tmp_path / "org.db")
    fac = facility(sedens, "Z")
    other = facility(sedens, "Y")
    device = pair(sedens, fac)
    with sedens.db() as db:
        sedens.set_org_profile(db, fac["org_id"], "facility", "Z Gym")
        capabilities.grant(sedens, db, fac["admin"], fac["coach_id"], "creator")
        coach = sedens.repo.actor(fac["coach_token"])
        creators.save_profile(sedens, db, coach, {"display_name": "Coach Z"})
        creators.request_affiliation(sedens, db, coach, other["org_id"])
        consent.record(db, org_id=fac["org_id"], user_id=fac["customer_id"], kind="product_analytics",
                       granted=True, text_version=consent.TEXTS["product_analytics"]["version"], channel="account")
        crm.link_member(sedens, db, fac["org_id"], "none", "M-1", fac["customer_id"])
    rooms.enter(sedens, device, method="access_code",
                credential=rooms.issue_access_code(sedens, sedens.repo.actor(fac["customer_token"]))["code"])
    with sedens.db() as db:
        db.execute("DELETE FROM p_organizations WHERE id=?", (fac["org_id"],))
        for table, column in (("s_org_profiles", "org_id"), ("s_room_devices", "org_id"), ("s_room_sessions", "org_id"),
                              ("s_room_access_codes", "org_id"),
                              ("s_events", "org_id"), ("s_consents", "org_id"), ("s_crm_member_links", "org_id")):
            assert not db.execute(f"SELECT 1 FROM {table} WHERE {column}=?", (fac["org_id"],)).fetchone(), table
        assert not db.execute("SELECT 1 FROM s_creator_profiles").fetchone()
        assert not db.execute("SELECT 1 FROM s_creator_facility_affiliations").fetchone()
        assert not db.execute("PRAGMA foreign_key_check").fetchall()
        # The other facility is untouched.
        assert db.execute("SELECT 1 FROM p_organizations WHERE id=?", (other["org_id"],)).fetchone()


def test_backup_export_and_inspector_are_unchanged_by_sedens_tables(migrated):
    """Phase 1 limitation, made explicit: SEDENS rows are not in org archives."""
    from pilates.platform.backup import export_archive
    from pilates.platform.inspection import overview, schema
    import json
    import zipfile

    sedens, _ = migrated
    repo = sedens.repo
    admin = repo.actor(repo.demo_login(KEY, "admin"))
    with repo.db() as db:
        assert not [t for t in schema(db) if t.startswith("s_")]
    assert not [t for t in overview(repo, admin) if t.startswith("s_")]
    with export_archive(repo, admin) as archive:
        with zipfile.ZipFile(archive) as z:
            manifest = json.loads(z.read("manifest.json"))
    assert manifest["tables"] and all(t.startswith("p_") for t in manifest["tables"])


def test_existing_pages_and_anatomy_are_still_served(migrated, monkeypatch):
    sedens, _ = migrated
    server, base = running_server(sedens.repo.path)
    try:
        for path in ("/anatomy.html", "/workspace.html", "/src/platform/app.js", "/src/main.js",
                     "/src/generated/structures.json", "/models/frame.json"):
            with urllib.request.urlopen(base + path, timeout=30) as response:
                assert response.status == 200, path
    finally:
        server.shutdown()
        server.server_close()
