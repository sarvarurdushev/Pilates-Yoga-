"""Demonstration cleanup: unused demonstrations are removed after a time-to-live;
real organizations, busy demonstrations and anything not clearly a demonstration
never are."""

from __future__ import annotations

from datetime import timedelta
import io
import logging
import sqlite3

import pytest

from pilates.sedens import course_media, demo, demo_cleanup, demo_marketplace, media_store, rooms
from pilates.sedens.util import utcnow
from sedens_support import enter_with_code, facility, make_sedens

KEY, OTHER = "1" * 32, "2" * 32
LATER = utcnow() + timedelta(hours=7)


def seed(sedens, key):
    sedens.repo.logout(sedens.repo.demo_login(key, "admin"))
    demo.ensure(sedens, "demo-" + key)


def counts(sedens, org_id):
    with sedens.db() as db:
        return {t: db.execute(f"SELECT count(*) FROM {t} WHERE org_id=?", (org_id,)).fetchone()[0]
                for t in demo_cleanup._org_tables(db)}


def orgs(sedens):
    with sedens.db() as db:
        return {r[0] for r in db.execute("SELECT id FROM p_organizations")}


@pytest.fixture()
def world(tmp_path):
    sedens = make_sedens(tmp_path / "s.db", "demo_free")
    seed(sedens, KEY)
    return sedens


def test_an_unused_demonstration_is_removed_with_its_files_and_nothing_else(world, caplog):
    sedens = world
    real = facility(sedens, "Real")
    before_real = counts(sedens, real["org_id"])
    # A course file of the demonstration's coach, stored under the demonstration's folder.
    minji = sedens.repo.actor(sedens.repo.issue(*demo_marketplace.actor_for("demo-" + KEY, "creator")))
    body = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF"
    upload = course_media.upload(sedens, minji, io.BytesIO(body), len(body), "pdf", "notes.pdf", {
        "attest": True, "attestation_version": course_media.ATTESTATION_VERSION, "licence_type": "own_work",
        "original_creator": "Minji Lee", "identifiable_person": "none"})
    folder = media_store.root(sedens.repo) / "objects" / ("demo-" + KEY)
    assert any(folder.rglob("*")) and upload["id"]

    with sedens.db() as db:
        assert demo_cleanup.expired(db, 6) == []  # just created
        assert demo_cleanup.expired(db, 6, LATER) == [KEY]
    with caplog.at_level(logging.WARNING, logger="sedens.demo_cleanup"):
        reports = demo_cleanup.sweep(sedens, ttl=6, at=LATER)
    assert [r["key"] for r in reports if r["removed"]] == [KEY]
    assert reports[0]["records"] > 1000 and reports[0]["files"] >= 1
    assert not any(o.startswith("demo-") for o in orgs(sedens))
    assert not folder.exists()
    # The real facility is untouched, and the database is consistent.
    assert counts(sedens, real["org_id"]) == before_real
    with sedens.db() as db:
        assert db.execute("PRAGMA foreign_key_check").fetchall() == []
        assert db.execute("SELECT count(*) FROM s_demo_activity").fetchone()[0] == 0
    # The log names the demonstration key, never people.
    text = caplog.text
    assert KEY in text and "Minji" not in text and "Sarah" not in text


def test_real_organizations_are_never_cleaned_even_when_named_or_flagged_like_one(world):
    sedens = world
    real = facility(sedens, "Real")
    # A real organization whose id looks like a demonstration's, and a flagged one with another name.
    with sedens.db() as db:
        db.execute("INSERT INTO p_organizations VALUES (?,?,0,?)", ("demo-" + OTHER, "Lookalike", "2020-01-01T00:00:00+00:00"))
        db.execute("INSERT INTO p_organizations VALUES (?,?,1,?)", ("acme-gym", "Flagged by mistake", "2020-01-01T00:00:00+00:00"))
        keys = demo_cleanup.expired(db, 1, LATER + timedelta(days=3650))
    assert OTHER not in keys and keys == [KEY]
    report = demo_cleanup.remove(sedens, OTHER)  # asked directly: nothing that is not a demonstration
    assert not report["removed"]
    demo_cleanup.sweep(sedens, ttl=1, at=LATER + timedelta(days=3650), limit=10)
    assert {real["org_id"], "demo-" + OTHER, "acme-gym"} <= orgs(sedens)
    assert not {"demo-" + KEY, "demo-" + KEY + "-sedens", "demo-" + KEY + "-professor"} & orgs(sedens)


def test_recent_use_keeps_a_demonstration(world):
    sedens = world
    with sedens.db() as db:
        db.execute("UPDATE p_organizations SET created_at='2020-01-01T00:00:00+00:00' WHERE id GLOB 'demo-*'")
        assert demo_cleanup.expired(db, 6) == [KEY]
    # Any signed-in request of the demonstration marks it used (through Repository.actor).
    sedens.repo.actor(sedens.repo.demo_login(KEY, "student"))
    with sedens.db() as db:
        assert demo_cleanup.expired(db, 6) == []
        used = db.execute("SELECT last_used_at FROM s_demo_activity WHERE demo_key=?", (KEY,)).fetchone()[0]
    # Throttled: a second request moments later writes nothing.
    sedens.repo.actor(sedens.repo.demo_login(KEY, "coach"))
    with sedens.db() as db:
        assert db.execute("SELECT last_used_at FROM s_demo_activity WHERE demo_key=?", (KEY,)).fetchone()[0] == used


def test_busy_demonstrations_are_kept(world):
    sedens = world
    org = "demo-" + KEY
    admin = sedens.repo.actor(sedens.repo.demo_login(KEY, "admin"))
    device, _ = rooms.ensure_demo_device(sedens, org, demo.room_id(org), None)
    enter_with_code(sedens, device, sedens.repo.demo_login(KEY, "student"))
    assert demo_cleanup.remove(sedens, KEY)["kept"] == "room_session_active"
    with sedens.db() as db:
        db.execute("UPDATE s_room_sessions SET state='ended' WHERE org_id=?", (org,))
        student = db.execute("SELECT u.id FROM p_users u JOIN p_roles r ON r.user_id=u.id AND r.role='student' "
                             "WHERE u.org_id=? LIMIT 1", (org,)).fetchone()[0]
        columns = [c[1] for c in db.execute("PRAGMA table_info(p_jobs)")]
        row = {"id": "job1", "org_id": org, "student_id": student, "owner_id": admin.user_id, "state": "running"}
        for c in db.execute("PRAGMA table_info(p_jobs)"):
            if c[3] and c[4] is None and c[1] not in row:  # NOT NULL without default
                row[c[1]] = "x" if c[2].upper() == "TEXT" else 0
        db.execute(f"INSERT INTO p_jobs({','.join(row)}) VALUES ({','.join('?' * len(row))})", list(row.values()))
    assert "state" in columns
    assert demo_cleanup.remove(sedens, KEY)["kept"] == "analysis_running"
    with sedens.db() as db:
        db.execute("DELETE FROM p_jobs WHERE id='job1'")
    with media_store.upload_slot():
        assert demo_cleanup.remove(sedens, KEY)["kept"] == "upload_running"
    assert demo_cleanup.remove(sedens, KEY)["removed"]


def test_a_database_refusal_keeps_the_whole_demonstration(world):
    sedens = world
    org = "demo-" + KEY
    real = facility(sedens, "Real")
    # A real program that (wrongly) uses one of the demonstration's exercises blocks the delete.
    with sedens.db() as db:
        exercise = db.execute("SELECT id FROM p_exercises WHERE org_id=? LIMIT 1", (org,)).fetchone()[0]
        db.execute("INSERT INTO p_programs(id,org_id,name) VALUES ('real-prog',?,?)", (real["org_id"], "Real program"))
        db.execute("INSERT INTO p_program_exercises(id,program_id,exercise_id,position) VALUES ('pe1','real-prog',?,0)",
                   (exercise,))
    reports = demo_cleanup.sweep(sedens, ttl=6, at=LATER)
    assert reports and not reports[0]["removed"] and reports[0]["kept"] == "error"
    assert {org, org + "-sedens", org + "-professor"} <= orgs(sedens)
    with sedens.db() as db:
        assert db.execute("SELECT 1 FROM p_programs WHERE id='real-prog'").fetchone()


def test_the_time_to_live_setting():
    assert demo_cleanup.ttl_hours("demo_free", {}) == 6
    assert demo_cleanup.ttl_hours("local_room", {}) is None
    assert demo_cleanup.ttl_hours("local_room", {"SEDENS_DEMO_TTL_HOURS": "12"}) == 12
    assert demo_cleanup.ttl_hours("demo_free", {"SEDENS_DEMO_TTL_HOURS": "0"}) is None
    assert demo_cleanup.ttl_hours("demo_free", {"SEDENS_DEMO_TTL_HOURS": "soon"}) is None
    assert demo_cleanup.ttl_hours("demo_free", {"SEDENS_DEMO_TTL_HOURS": "0.1"}) == 1  # never under an hour


def test_cleanup_is_off_outside_demo_free_by_default(tmp_path):
    sedens = make_sedens(tmp_path / "room.db", "local_room")
    seed(sedens, KEY)
    assert demo_cleanup.sweep(sedens, at=LATER) == [] and demo_cleanup.maybe_sweep(sedens) is False
    assert "demo-" + KEY in orgs(sedens)


def test_the_activity_table_accepts_only_demonstration_keys(world):
    with world.db() as db, pytest.raises(sqlite3.IntegrityError):
        db.execute("INSERT INTO s_demo_activity VALUES ('not-a-key','x','x')")
