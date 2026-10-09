"""SEDENS records in organization backups (Phase 1.5).

The platform archive now carries every SEDENS table with an explicit policy:
useful configuration and history come back, live credentials never do, and a
decision another organization or SEDENS made is re-checked against this
server rather than taken from the archive.
"""

import json
import shutil
import zipfile

import pytest

from pilates.platform.backup import export_archive, restore_archive
from pilates.platform.repository import Refused, Repository
from pilates.sedens import analytics, backup as sedens_backup, capabilities, consent, creators, crm, onboarding, rooms
from pilates.sedens.util import digest
from sedens_support import PASSWORD, enter_with_code, facility, make_sedens, pair, sedens_staff

SCOPED = ("s_org_profiles", "s_capabilities", "s_creator_profiles", "s_creator_facility_affiliations",
          "s_room_devices", "s_room_sessions", "s_crm_settings", "s_crm_member_links", "s_consents", "s_events")


def save(repo, actor, path):
    """Export an organization archive to a file that outlives the export."""
    with export_archive(repo, actor) as archive:
        shutil.copy(archive, path)
    return path


def counts(sedens, org_id):
    from pilates.platform.inspection import schema

    with sedens.db() as db:
        meta = {**schema(db), **sedens_backup.schema(db)}
        out = {}
        for table in SCOPED:
            where, args = sedens_backup.scope(table, meta, org_id)
            out[table] = db.execute(f"SELECT count(*) FROM {table} WHERE {where}", args).fetchone()[0]
        return out


def destroy(sedens, org_id):
    with sedens.db() as db:
        db.execute("DELETE FROM p_organizations WHERE id=?", (org_id,))
        assert not db.execute("PRAGMA foreign_key_check").fetchall()


def fresh_org(sedens, label):
    return sedens.repo.actor(sedens.repo.create_org("Owner", f"restore-{label}@example.test", PASSWORD, "Restored"))


def uid_suffix():
    from pilates.sedens.util import uid

    return uid()[:6]


def tamper(path, table, change, label="tampered"):
    """Rewrite one table of an archive, keeping every other member byte for byte."""
    target = path.with_name(f"{path.stem}-{label}.zip")
    with zipfile.ZipFile(path) as source, zipfile.ZipFile(target, "w") as out:
        for info in source.infolist():
            data = source.read(info)
            if info.filename == f"records/{table}.jsonl":
                rows = [json.loads(line) for line in data.splitlines() if line.strip()]
                data = b"".join((json.dumps(change(row)) + "\n").encode() for row in rows)
            out.writestr(info, data)
    return target


def affiliated_creator(sedens, creator_fac, target_fac, approve=True):
    """creator_fac's coach becomes a creator with an affiliation to target_fac."""
    coach = sedens.repo.actor(creator_fac["coach_token"])
    with sedens.db() as db:
        capabilities.grant(sedens, db, creator_fac["admin"], creator_fac["coach_id"], "creator")
        profile = creators.save_profile(sedens, db, coach, {"display_name": "Coach " + creator_fac["org_id"][:4]})
        request = creators.request_affiliation(sedens, db, coach, target_fac["org_id"])
        if approve:
            creators.decide_affiliation(sedens, db, target_fac["admin"], request["id"], "approve")
    return profile, request


@pytest.fixture
def world(tmp_path):
    sedens = make_sedens(tmp_path / "s.db")
    return sedens, facility(sedens, "A"), facility(sedens, "B")


def test_every_sedens_table_has_a_backup_policy(world):
    sedens, _, _ = world
    with sedens.db() as db:
        assert sedens_backup.tables_without_policy(db) == []
        names = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name GLOB 's_*'")}
    assert names == set(sedens_backup.POLICIES)
    assert {"s_schema", "s_affiliation_ledger", "s_room_device_pairings", "s_room_access_codes"}.isdisjoint(sedens_backup.INCLUDED)


def test_facility_backup_destroy_and_restore(world, tmp_path):
    """1. A facility's SEDENS configuration and history survive losing the facility."""
    sedens, a, b = world
    device = pair(sedens, a, name="Room 01 TV")
    entered = enter_with_code(sedens, device, a["customer_token"])
    rooms.end(sedens, entered["context"])
    enter_with_code(sedens, device, a["other_token"])  # left active on purpose
    with sedens.db() as db:
        sedens.set_org_profile(db, a["org_id"], "facility", "A Gym", "en")
        consent.record(db, org_id=a["org_id"], user_id=a["customer_id"], kind="product_analytics", granted=True,
                       text_version=consent.TEXTS["product_analytics"]["version"], channel="account")
        crm.link_member(sedens, db, a["org_id"], "none", "M-1", a["customer_id"])
        crm.update_policy(sedens, db, a["admin"], enabled=True)
        analytics.record(db, "exercise_started", org_id=a["org_id"], source="client", props={"exercise": "hundred"})
    affiliated_creator(sedens, a, b)
    before = counts(sedens, a["org_id"])
    assert all(before[t] for t in SCOPED), before
    path = save(sedens.repo, a["admin"], tmp_path / "a.zip")
    destroy(sedens, a["org_id"])
    owner = fresh_org(sedens, "a")
    result = restore_archive(sedens.repo, owner, path)
    assert counts(sedens, owner.org_id) == before
    assert result["sedens"]["room_screens_to_pair_again"] == 1
    assert result["sedens"]["room_sessions_closed"] == 1
    assert result["sedens"]["affiliations_restored"] == 1
    with sedens.db() as db:
        assert sedens.org(db, owner.org_id)["display_name"] == "A Gym"
        assert sedens.org(db, owner.org_id)["default_language"] == "en"
        devices = db.execute("SELECT name,status,token_hash FROM s_room_devices WHERE org_id=?", (owner.org_id,)).fetchall()
        assert [tuple(d) for d in devices] == [("Room 01 TV", "revoked", None)]
        states = {r[0] for r in db.execute("SELECT state FROM s_room_sessions WHERE org_id=?", (owner.org_id,))}
        assert "active" not in states
        users = {r[0] for r in db.execute("SELECT id FROM p_users WHERE org_id=?", (owner.org_id,))}
        for table in ("s_consents",):
            assert {r[0] for r in db.execute(f"SELECT user_id FROM {table} WHERE org_id=?", (owner.org_id,))} <= users
        student = db.execute("SELECT student_id FROM s_crm_member_links WHERE org_id=?", (owner.org_id,)).fetchone()[0]
        assert student in users
        assert not db.execute("PRAGMA foreign_key_check").fetchall()
    # The restored facility works: pair a screen again and a restored customer enters.
    restored_customer = next(p for p in sedens.repo.people(owner) if p["name"] == "Customer A")
    with sedens.db() as db:
        room = db.execute("SELECT r.id FROM p_rooms r JOIN p_locations l ON l.id=r.location_id WHERE l.org_id=?",
                          (owner.org_id,)).fetchone()[0]
    screen = pair(sedens, {"org_id": owner.org_id, "admin": owner, "room_id": room})
    token = sedens.repo.issue(restored_customer["id"], "student")
    assert enter_with_code(sedens, screen, token)["context"].org_id == owner.org_id


def test_creator_studio_backup_and_restore(world, tmp_path):
    """2. A creator studio comes back with its creator, permission and affiliations; its
    verification waits for SEDENS to confirm it again."""
    sedens, _, b = world
    _, reviewer, _ = sedens_staff(sedens)
    prof = sedens.repo.actor(onboarding.register_creator_studio(
        sedens, name="Prof Park", email="park@uni.test", password=PASSWORD, display_name="Prof. Park",
        creator_type="professor"))
    with sedens.db() as db:
        creators.save_profile(sedens, db, prof, {"institution": "Example University", "qualifications": ["PhD"]})
        seen = creators.request_verification(sedens, db, prof)
        creators.decide_verification(sedens, db, reviewer, seen["id"], "verified", version=seen["version"])
        request = creators.request_affiliation(sedens, db, prof, b["org_id"])
        creators.decide_affiliation(sedens, db, b["admin"], request["id"], "approve")
    path = save(sedens.repo, prof, tmp_path / "studio.zip")
    destroy(sedens, prof.org_id)

    owner = fresh_org(sedens, "studio")
    result = restore_archive(sedens.repo, owner, path)
    assert result["sedens"]["verifications_to_confirm"] == 1 and result["sedens"]["affiliations_restored"] == 1
    with sedens.db() as db:
        assert sedens.org(db, owner.org_id)["kind"] == "creator_studio"
        assert capabilities.effective(sedens, db, owner) == {"creator"}
        profile = creators.own_profile(sedens, db, owner)
        assert profile["display_name"] == "Prof. Park" and profile["institution"] == "Example University"
        assert profile["verification_state"] == "pending" and profile["self_declared"] is True
        # It is in the reviewer's queue, and a reviewer can confirm it for this exact content.
        creators.decide_verification(sedens, db, reviewer, profile["id"], "verified", version=profile["version"])
        links = creators.creator_affiliations(sedens, db, owner)
        assert [(x["org_id"], x["status"]) for x in links] == [(b["org_id"], "approved")]

    # Into a creator studio registered afresh: the archive fills its existing profile.
    again = sedens.repo.actor(onboarding.register_creator_studio(
        sedens, name="Prof Park", email="park2@uni.test", password=PASSWORD, display_name="New"))
    result = restore_archive(sedens.repo, again, path)
    with sedens.db() as db:
        profile = creators.own_profile(sedens, db, again)
        assert profile["display_name"] == "Prof. Park"
        assert db.execute("SELECT count(*) FROM s_creator_profiles WHERE user_id=?", (again.user_id,)).fetchone()[0] == 1
    # The first restore still holds the affiliation, so the same archive cannot copy it again.
    assert result["sedens"]["affiliations_restored"] == 0 and result["sedens"]["affiliations_not_restored"] == 1


def test_an_archive_never_carries_a_verification(world, tmp_path):
    """A verified, later suspended creator cannot get "verified" back from an old archive,
    however often it is restored, and an edited archive cannot claim verification."""
    sedens, _, _ = world
    _, reviewer, _ = sedens_staff(sedens)
    prof = sedens.repo.actor(onboarding.register_creator_studio(
        sedens, name="Prof", email="p@uni.test", password=PASSWORD, display_name="Prof"))
    with sedens.db() as db:
        seen = creators.request_verification(sedens, db, prof)
        creators.decide_verification(sedens, db, reviewer, seen["id"], "verified", version=seen["version"])
    path = save(sedens.repo, prof, tmp_path / "p.zip")
    with sedens.db() as db:
        creators.decide_verification(sedens, db, reviewer, seen["id"], "suspended")
    claimed = tamper(path, "s_creator_profiles", lambda r: {**r, "verification_state": "verified",
                                                            "bio": "Board-certified physician"}, "claimed")
    for archive in (path, path, claimed):
        owner = fresh_org(sedens, f"{archive.stem}-{uid_suffix()}")
        result = restore_archive(sedens.repo, owner, archive)
        assert result["sedens"]["verifications_to_confirm"] == 1
        with sedens.db() as db:
            profile = creators.own_profile(sedens, db, owner)
        assert profile["verification_state"] == "pending" and profile["self_declared"] is True


def test_cross_facility_affiliation_survives_without_importing_another_facilitys_users(world, tmp_path):
    """3. Facility B's restore keeps facility A's creator affiliation, and nothing of A's."""
    sedens, a, b = world
    profile, _ = affiliated_creator(sedens, a, b)
    with sedens.db() as db:
        b_users = db.execute("SELECT count(*) FROM p_users WHERE org_id=?", (b["org_id"],)).fetchone()[0]
    path = save(sedens.repo, b["admin"], tmp_path / "b.zip")
    with zipfile.ZipFile(path) as z:
        users = [json.loads(x) for x in z.read("records/p_users.jsonl").splitlines()]
    assert a["coach_id"] not in {u["id"] for u in users}
    destroy(sedens, b["org_id"])

    owner = fresh_org(sedens, "b")
    restore_archive(sedens.repo, owner, path)
    with sedens.db() as db:
        rows = db.execute("SELECT creator_id,status FROM s_creator_facility_affiliations WHERE org_id=?",
                          (owner.org_id,)).fetchall()
        assert [tuple(r) for r in rows] == [(profile["id"], "approved")]
        assert db.execute("SELECT count(*) FROM p_users WHERE org_id=?", (owner.org_id,)).fetchone()[0] == b_users
        assert db.execute("SELECT org_id FROM p_users WHERE id=?", (a["coach_id"],)).fetchone()[0] == a["org_id"]
    # Still content distribution only: the creator sees nothing of the restored facility's members.
    coach = sedens.repo.actor(a["coach_token"])
    assert all(p["id"] != owner.user_id for p in sedens.repo.people(coach))

    # A second copy of the same archive does not duplicate the creator's consent.
    copy = fresh_org(sedens, "b-copy")
    result = restore_archive(sedens.repo, copy, path)
    assert result["sedens"]["affiliations_not_restored"] == 1
    with sedens.db() as db:
        assert not db.execute("SELECT 1 FROM s_creator_facility_affiliations WHERE org_id=?", (copy.org_id,)).fetchone()


def test_a_tampered_archive_cannot_forge_an_affiliation(world, tmp_path):
    sedens, a, b = world
    affiliated_creator(sedens, a, b, approve=False)
    path = save(sedens.repo, b["admin"], tmp_path / "b.zip")
    destroy(sedens, b["org_id"])
    forged = tamper(path, "s_creator_facility_affiliations", lambda r: {**r, "status": "approved"})
    owner = fresh_org(sedens, "forged")
    result = restore_archive(sedens.repo, owner, forged)
    assert result["sedens"]["affiliations_not_restored"] == 1
    with sedens.db() as db:
        assert not db.execute("SELECT 1 FROM s_creator_facility_affiliations WHERE org_id=?", (owner.org_id,)).fetchone()


def test_a_withdrawn_affiliation_is_not_revived_by_an_older_archive(world, tmp_path):
    """The archive says "approved", but the facility later revoked it and the creator's
    rows were deleted: this server's ledger still remembers the revocation."""
    sedens, a, b = world
    profile, request = affiliated_creator(sedens, a, b)
    path = save(sedens.repo, a["admin"], tmp_path / "a.zip")
    with sedens.db() as db:
        creators.revoke_affiliation(sedens, db, b["admin"], request["id"])
    destroy(sedens, a["org_id"])
    owner = fresh_org(sedens, "a")
    result = restore_archive(sedens.repo, owner, path)
    assert result["sedens"]["affiliations_not_restored"] == 1
    with sedens.db() as db:
        assert not db.execute("SELECT 1 FROM s_creator_facility_affiliations WHERE org_id=?", (b["org_id"],)).fetchone()
        assert db.execute("SELECT status FROM s_affiliation_ledger WHERE origin_id=?", (request["id"],)).fetchone()[0] == "revoked"


def test_restoring_into_your_own_studio_keeps_a_sedens_suspension(world, tmp_path):
    sedens, _, _ = world
    _, reviewer, _ = sedens_staff(sedens)
    prof = sedens.repo.actor(onboarding.register_creator_studio(
        sedens, name="Prof", email="own@uni.test", password=PASSWORD, display_name="Prof"))
    with sedens.db() as db:
        seen = creators.request_verification(sedens, db, prof)
        creators.decide_verification(sedens, db, reviewer, seen["id"], "verified", version=seen["version"])
    path = save(sedens.repo, prof, tmp_path / "own.zip")
    with sedens.db() as db:
        creators.decide_verification(sedens, db, reviewer, seen["id"], "suspended")
    unsuspended = tamper(path, "s_creator_profiles", lambda r: {**r, "verification_state": "unverified"}, "unsuspended")
    for archive in (path, unsuspended):
        restore_archive(sedens.repo, prof, archive)
        with sedens.db() as db:
            assert creators.own_profile(sedens, db, prof)["verification_state"] == "suspended"


def test_restore_applies_the_products_own_profile_rules(world, tmp_path):
    """No SEDENS-editorial type outside SEDENS, no archive-chosen address, no self-affiliation."""
    sedens, a, b = world
    affiliated_creator(sedens, a, b)
    path = save(sedens.repo, a["admin"], tmp_path / "a.zip")
    crafted = tamper(path, "s_creator_profiles", lambda r: {**r, "creator_type": "sedens_editorial", "slug": "sedens"},
                     "editorial")
    def self_affiliation(row):
        return {**row, "org_id": a["org_id"], "status": "approved"}
    crafted = tamper(crafted, "s_creator_facility_affiliations", self_affiliation, "self")
    owner = fresh_org(sedens, "crafted")
    restore_archive(sedens.repo, owner, crafted)
    with sedens.db() as db:
        row = db.execute("SELECT c.creator_type, c.slug FROM s_creator_profiles c JOIN p_users u ON u.id=c.user_id "
                         "WHERE u.org_id=?", (owner.org_id,)).fetchone()
        assert row["creator_type"] == "coach" and row["slug"] != "sedens"
        assert not db.execute("SELECT 1 FROM s_creator_facility_affiliations WHERE org_id=?", (owner.org_id,)).fetchone()


def test_the_manifest_order_cannot_decide_the_environment(world, tmp_path):
    """A crafted manifest listing the organization last must not let a real facility
    end up affiliated with a demonstration creator."""
    sedens, a, b = world
    affiliated_creator(sedens, a, b)
    path = save(sedens.repo, a["admin"], tmp_path / "a.zip")
    destroy(sedens, a["org_id"])
    reordered = path.with_name("reordered.zip")
    with zipfile.ZipFile(path) as source, zipfile.ZipFile(reordered, "w") as out:
        for info in source.infolist():
            data = source.read(info)
            if info.filename == "manifest.json":
                manifest = json.loads(data)
                manifest["tables"] = [t for t in manifest["tables"] if t != "p_organizations"] + ["p_organizations"]
                data = json.dumps(manifest).encode()
            elif info.filename == "records/p_organizations.jsonl":
                data = b"".join((json.dumps({**json.loads(x), "demo": 1}) + "\n").encode() for x in data.splitlines())
            out.writestr(info, data)
    owner = fresh_org(sedens, "reordered")
    result = restore_archive(sedens.repo, owner, reordered)
    assert result["sedens"]["affiliations_restored"] == 0
    with sedens.db() as db:
        assert not db.execute("SELECT 1 FROM s_creator_facility_affiliations WHERE org_id=?", (b["org_id"],)).fetchone()


def test_room_security_tokens_do_not_survive_backup(world, tmp_path):
    """4. Device, room-session, pairing and room-code credentials are never exported or revived."""
    sedens, a, _ = world
    device = pair(sedens, a)
    entered = enter_with_code(sedens, device, a["customer_token"])
    rooms.issue_access_code(sedens, sedens.repo.actor(a["other_token"]))  # an unused live code
    rooms.start_pairing(sedens)  # a pending pairing elsewhere
    path = save(sedens.repo, a["admin"], tmp_path / "a.zip")
    with zipfile.ZipFile(path) as z:
        manifest = json.loads(z.read("manifest.json"))
        body = b"".join(z.read(n) for n in z.namelist())
    assert "s_room_device_pairings" not in manifest["tables"] and "s_room_access_codes" not in manifest["tables"]
    for secret in (b"token_hash", b"secret_hash", b"code_hash", digest(device).encode(), digest(entered["token"]).encode()):
        assert secret not in body
    destroy(sedens, a["org_id"])
    owner = fresh_org(sedens, "a")
    restore_archive(sedens.repo, owner, path)
    with sedens.db() as db:
        assert rooms.device_for_token(sedens, db, device) is None
        assert not db.execute("SELECT 1 FROM s_room_devices WHERE token_hash IS NOT NULL AND org_id=?", (owner.org_id,)).fetchone()
        assert not db.execute("SELECT 1 FROM s_room_sessions WHERE token_hash=?", (digest(entered["token"]),)).fetchone()
    with pytest.raises(Exception):
        rooms.authorize(sedens, device, entered["token"])


def test_audit_foreign_keys_remain_valid(world, tmp_path):
    """5. No restored audit row names a person outside the organization."""
    sedens, a, _ = world
    root, reviewer, _ = sedens_staff(sedens)
    coach = sedens.repo.actor(a["coach_token"])
    with sedens.db() as db:
        capabilities.grant(sedens, db, root, a["coach_id"], "creator")  # granted by SEDENS
        seen = creators.save_profile(sedens, db, coach, {"display_name": "Coach A"})
        creators.request_verification(sedens, db, coach)
        creators.decide_verification(sedens, db, reviewer, seen["id"], "verified", version=seen["version"])
        # A row written before Phase 1's audit fix, naming the reviewer directly.
        db.execute("INSERT INTO p_audit(org_id,actor_id,action,subject_id,created_at,detail) VALUES (?,?,?,?,?,?)",
                   (a["org_id"], reviewer.user_id, "sedens:legacy", "x", "2026-01-01T00:00:00+00:00", "{}"))
    path = save(sedens.repo, a["admin"], tmp_path / "a.zip")
    with zipfile.ZipFile(path) as z:
        capability = [json.loads(x) for x in z.read("records/s_capabilities.jsonl").splitlines()]
        audit = [json.loads(x) for x in z.read("records/p_audit.jsonl").splitlines()]
    assert capability and all(c["granted_by"] is None for c in capability)
    assert reviewer.user_id not in {r["actor_id"] for r in audit} and root.user_id not in {r["actor_id"] for r in audit}
    destroy(sedens, a["org_id"])
    owner = fresh_org(sedens, "a")
    restore_archive(sedens.repo, owner, path)
    with sedens.db() as db:
        assert not db.execute("PRAGMA foreign_key_check").fetchall()
        foreign = db.execute(
            "SELECT count(*) FROM p_audit x JOIN p_users u ON u.id=x.actor_id WHERE x.org_id=? AND u.org_id<>?",
            (owner.org_id, owner.org_id)).fetchone()[0]
        assert foreign == 0


def test_pre_sedens_backups_still_restore(tmp_path):
    """6. An archive from before SEDENS restores into a SEDENS server and verifies offline."""
    from pilates.platform.backup_verify import verify_archive

    legacy = Repository(tmp_path / "legacy.db")
    admin = legacy.actor(legacy.create_org("Old owner", "old@example.test", PASSWORD, "Old studio"))
    legacy.save(admin, "locations", {"name": "Main", "rooms": [{"name": "Studio 1", "capacity": 4}]})
    legacy.save_person(admin, {"name": "Old client", "email": "client@example.test", "roles": ["student"]})
    path = save(legacy, admin, tmp_path / "legacy.zip")
    with zipfile.ZipFile(path) as z:
        manifest = json.loads(z.read("manifest.json"))
    assert "sedens" not in manifest and not [t for t in manifest["tables"] if t.startswith("s_")]

    sedens = make_sedens(tmp_path / "new.db")
    owner = fresh_org(sedens, "legacy")
    result = restore_archive(sedens.repo, owner, path)
    assert result["restored_records"] > 0 and result["sedens"]["affiliations_restored"] == 0
    assert any(p["name"] == "Old client" for p in sedens.repo.people(owner))
    with sedens.db() as db:
        assert sedens.org(db, owner.org_id)["kind"] == "facility"
    assert verify_archive(path)["dry_run_restored_records"] > 0


def test_sedens_archives_verify_offline(world, tmp_path):
    from pilates.platform.backup_verify import verify_archive

    sedens, a, b = world
    pair(sedens, a)
    affiliated_creator(sedens, a, b)
    receipt = verify_archive(save(sedens.repo, a["admin"], tmp_path / "a.zip"))
    assert receipt["table_counts"]["s_room_devices"] == 1 and receipt["table_counts"]["s_creator_profiles"] == 1


def test_the_sedens_organization_is_never_restored_from_an_archive(world, tmp_path):
    sedens, _, _ = world
    root, _, _ = sedens_staff(sedens)
    path = save(sedens.repo, root, tmp_path / "sedens.zip")
    with zipfile.ZipFile(path) as z:
        capability = [json.loads(x) for x in z.read("records/s_capabilities.jsonl").splitlines()]
    assert not [c for c in capability if c["capability"] != "creator"]
    with pytest.raises(Refused, match="command line"):
        restore_archive(sedens.repo, fresh_org(sedens, "sedens"), path)


def test_restore_still_refuses_a_studio_with_its_own_sedens_records(world, tmp_path):
    sedens, a, _ = world
    path = save(sedens.repo, a["admin"], tmp_path / "a.zip")
    owner = fresh_org(sedens, "busy")
    with sedens.db() as db:
        analytics.record(db, "room_screen_viewed", org_id=owner.org_id, source="client", props={})
    with pytest.raises(Refused, match="empty studio"):
        restore_archive(sedens.repo, owner, path)
