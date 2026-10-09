"""Courses, course files and customers' course records in organization backups.

A restored course is the creator's content, intact; whether it is published is
SEDENS's decision, so the version that was published returns to review. Course
files pass the same checks as an upload. Records about another organization's
course come back only while this server can confirm them."""

from __future__ import annotations

import hashlib
import io
import json
import zipfile

import pytest

from pilates.platform.backup import restore_archive
from pilates.platform.backup_verify import verify_archive
from pilates.platform.repository import Refused
from pilates.sedens import access, course_media, courses, marketplace, media_store
from course_support import (approve, build_education, build_guided, coach_creator, customer, facility,
                            facility_setting, make_sedens, professor_studio, publish, room_for, sedens_staff)
from test_sedens_backup import destroy, fresh_org, save
from test_sedens_courses import RIGHTS, png_bytes

KRW_29000 = {"price_type": "paid", "amount_minor": 29000, "currency": "KRW", "sale_state": "active"}
PDF = b"%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n"


@pytest.fixture()
def world(tmp_path):
    sedens = make_sedens(tmp_path / "s.db")
    _, reviewer, _ = sedens_staff(sedens)
    return sedens, reviewer, facility(sedens, "A")


def rewrite(path, label, change):
    """Copy an archive, letting ``change(name, data)`` replace any member's bytes."""
    target = path.with_name(f"{path.stem}-{label}.zip")
    with zipfile.ZipFile(path) as source, zipfile.ZipFile(target, "w") as out:
        for info in source.infolist():
            out.writestr(info, change(info.filename, source.read(info)))
    return target


def records(change_rows):
    """A ``rewrite`` change for JSONL records: change_rows(table, rows) -> rows."""
    def change(name, data):
        if not name.startswith("records/"):
            return data
        table = name[len("records/"):-len(".jsonl")]
        rows = [json.loads(line) for line in data.splitlines() if line.strip()]
        return b"".join((json.dumps(r) + "\n").encode() for r in change_rows(table, rows))
    return change


def studio_with_courses(sedens, reviewer):
    """A professor's studio: a published guided course with a cover and a step picture, and a
    draft education course with a PDF lesson."""
    professor = professor_studio(sedens)
    cover = png_bytes((200, 30, 30))
    picture = png_bytes((30, 200, 30))
    cover_media = course_media.upload(sedens, professor, io.BytesIO(cover), len(cover), "image", "cover.png", RIGHTS)
    step_media = course_media.upload(sedens, professor, io.BytesIO(picture), len(picture), "image", "step.png", RIGHTS)
    pdf = course_media.upload(sedens, professor, io.BytesIO(PDF), len(PDF), "pdf", "notes.pdf", RIGHTS)
    with sedens.db() as db:
        from pilates.sedens import course_review

        course_review.decide_media(sedens, db, reviewer, {"object_id": cover_media["id"], "decision": "approved"})
    view = build_guided(sedens, professor, "Mobility Foundations", steps=("std-breathing", "std-cat-stretch"))
    cid = view["course"]["id"]
    step = view["modules"][0]["sessions"][0]["steps"][0]
    with sedens.db() as db:
        view = courses.update(sedens, db, professor, {"id": cid, "revision": view["revision"],
                                                      "cover_media_id": cover_media["id"]})
        data = {k: step[k] for k in ("id", "phase", "sets", "reps", "rest_seconds", "sides", "customer_cue")}
        view = courses.save_step(sedens, db, professor, {
            **data, "course_id": cid, "revision": view["revision"], "session_id": view["modules"][0]["sessions"][0]["id"],
            "exercise_source": "standard", "exercise_ref": "std-breathing", "image_media_id": step_media["id"]})
    view = publish(sedens, professor, reviewer, view, "marketplace", price=KRW_29000)
    education = build_education(sedens, professor, "Joint notes")
    with sedens.db() as db:
        lesson = education["modules"][0]["lessons"][0]
        courses.save_lesson(sedens, db, professor, {"course_id": education["course"]["id"],
                                                    "revision": education["revision"], "id": lesson["id"],
                                                    "module_id": education["modules"][0]["id"], "kind": "pdf",
                                                    "title": "Notes", "media_id": pdf["id"]})
    return professor, view


def test_creator_studio_courses_and_files_survive_backup_and_restore(world, tmp_path):
    sedens, reviewer, a = world
    professor, view = studio_with_courses(sedens, reviewer)
    with sedens.db() as db:
        before = {c["title"]: courses.editor_view(sedens, db, professor, c["id"])
                  for c in courses.list_for_creator(sedens, db, professor)}
    path = save(sedens.repo, professor, tmp_path / "studio.zip")
    receipt = verify_archive(path)
    assert receipt["course_files"] == 3
    destroy(sedens, professor.org_id)

    owner = fresh_org(sedens, "studio")
    result = restore_archive(sedens.repo, owner, path)["sedens"]
    assert result["course_files"] == 3
    assert result["courses_to_confirm"] == 1 and result["media_rights_to_review"] == 1
    with sedens.db() as db:
        after = {c["title"]: courses.editor_view(sedens, db, owner, c["id"])
                 for c in courses.list_for_creator(sedens, db, owner)}
        assert set(after) == set(before) == {"Mobility Foundations", "Joint notes"}
        for title in before:
            old, new = before[title], after[title]
            assert [m["title"] for m in new["modules"]] == [m["title"] for m in old["modules"]]
            assert new["price"] == old["price"] and new["course"]["distribution"] == old["course"]["distribution"]
        guided = after["Mobility Foundations"]
        assert guided["published_version"] is None and guided["review_state"] == "submitted"
        steps = guided["modules"][0]["sessions"][0]["steps"]
        old_steps = before["Mobility Foundations"]["modules"][0]["sessions"][0]["steps"]
        assert [(s["exercise"]["ref"], s["reps"], s["anatomy"]) for s in steps] == \
            [(s["exercise"]["ref"], s["reps"], s["anatomy"]) for s in old_steps]
        # Every restored file is stored again under the new organization, with checked bytes.
        objects = db.execute("SELECT * FROM s_media_objects WHERE owner_org_id=?", (owner.org_id,)).fetchall()
        assert len(objects) == 3
        for o in objects:
            assert o["object_key"].startswith(owner.org_id + "/")
            stored = media_store.object_path(sedens.repo, o["object_key"])
            assert hashlib.sha256(stored.read_bytes()).hexdigest() == o["sha256"]
        assert steps[0]["image_media_id"] in {o["id"] for o in objects}
        # The restored version names the new rows, and this server hashed it.
        version = db.execute("SELECT * FROM s_course_versions WHERE course_id=?",
                             (guided["course"]["id"],)).fetchone()
        snapshot = json.loads(version["snapshot"])
        assert snapshot["owner_org_id"] == owner.org_id and snapshot["course"]["id"] == guided["course"]["id"]
        assert version["snapshot_sha256"] == hashlib.sha256(version["snapshot"].encode()).hexdigest()
        assert version["state"] == "submitted" and version["note"].startswith("Restored from a backup")
        rights = {r["review_status"] for r in db.execute(
            "SELECT review_status FROM s_media_rights WHERE object_id IN (SELECT id FROM s_media_objects "
            "WHERE owner_org_id=?)", (owner.org_id,))}
        assert rights == {"unreviewed"}
        assert not db.execute("PRAGMA foreign_key_check").fetchall()

    # A reviewer confirms it and it is on the marketplace again.
    approve(sedens, reviewer, guided["course"]["id"], 1)
    with sedens.db() as db:
        card = access.course_card(sedens, db, customer(sedens, a), courses.row(db, guided["course"]["id"]))
        assert card["title"] == "Mobility Foundations" and card["price"]["amount_minor"] == 29000


def test_facility_backup_keeps_customers_enrollments_and_progress(world, tmp_path):
    sedens, reviewer, a = world
    coach = coach_creator(sedens, a)
    own = publish(sedens, coach, reviewer, build_guided(sedens, coach, sessions=2), "selected_facilities",
                  [{"org_id": a["org_id"], "free": True}])["course"]["id"]
    professor = professor_studio(sedens)
    shared = publish(sedens, professor, reviewer, build_guided(sedens, professor, "Free mobility"),
                     "marketplace")["course"]["id"]
    for cid in (own, shared):
        facility_setting(sedens, a, cid, enabled=True)
    member = customer(sedens, a)
    room = room_for(sedens, a)
    with sedens.db() as db:
        outline = marketplace.enroll(sedens, db, member, own)["outline"]
        marketplace.enroll(sedens, db, member, shared)
        first = outline[0]["sessions"][0]["id"]
        marketplace.room_session_plan(sedens, db, room, own, first)
        marketplace.complete_room_session(sedens, db, room, own, first)
    path = save(sedens.repo, a["admin"], tmp_path / "a.zip")
    destroy(sedens, a["org_id"])

    owner = fresh_org(sedens, "a")
    result = restore_archive(sedens.repo, owner, path)["sedens"]
    assert result["courses_to_confirm"] == 1 and result["course_access_not_restored"] == 0
    restored = next(p for p in sedens.repo.people(owner) if p["name"] == "Customer A")
    with sedens.db() as db:
        course_id = db.execute("SELECT id FROM s_courses WHERE owner_org_id=?", (owner.org_id,)).fetchone()[0]
        # The other organization's marketplace course: still enabled here, still enrolled.
        assert access.facility_setting(db, owner.org_id, shared)["enabled"]
        assert access.enrollment(db, restored["id"], shared) is not None
        assert access.enrollment(db, restored["id"], course_id) is not None
        assert not db.execute("PRAGMA foreign_key_check").fetchall()
    approve(sedens, reviewer, course_id, 1)
    actor = sedens.repo.actor(sedens.repo.issue(restored["id"], "student"))
    with sedens.db() as db:
        detail = marketplace.detail(sedens, db, actor, course_id)
    # Progress points at the restored version's own session ids.
    assert detail["progress"]["completed_items"] == 1 and detail["progress"]["total_items"] == 2
    assert detail["progress"]["done"] == [f"session:{detail['outline'][0]['sessions'][0]['id']}"]


def test_an_archive_cannot_publish_a_course_or_forge_its_snapshot(world, tmp_path):
    sedens, reviewer, a = world
    coach = coach_creator(sedens, a)
    cid = publish(sedens, coach, reviewer, build_guided(sedens, coach), "selected_facilities",
                  [{"org_id": a["org_id"], "free": True}])["course"]["id"]
    facility_setting(sedens, a, cid, enabled=True, included=True)
    path = save(sedens.repo, a["admin"], tmp_path / "a.zip")
    destroy(sedens, a["org_id"])

    def forge(table, rows):
        for r in rows:
            if table == "s_course_versions":
                snapshot = json.loads(r["snapshot"])
                snapshot["modules"][0]["sessions"][0]["steps"][0]["customer_cue"] = "This cures back pain."
                r["snapshot"] = json.dumps(snapshot)
                r["state"] = "published"
            if table == "s_courses":
                r["published_version"] = 1
        return rows

    owner = fresh_org(sedens, "forged")
    restore_archive(sedens.repo, owner, rewrite(path, "forged", records(forge)))
    with sedens.db() as db:
        course = db.execute("SELECT * FROM s_courses WHERE owner_org_id=?", (owner.org_id,)).fetchone()
        assert course["published_version"] is None and not access.published(course)
        version = db.execute("SELECT * FROM s_course_versions WHERE course_id=?", (course["id"],)).fetchone()
        assert version["state"] == "submitted"
        # The reviewer sees exactly what the archive carried, hashed by this server.
        assert version["snapshot_sha256"] == hashlib.sha256(version["snapshot"].encode()).hexdigest()
        assert "cures back pain" in version["snapshot"]
        member = next(p for p in sedens.repo.people(owner) if p["name"] == "Customer A")
        actor = sedens.repo.actor(sedens.repo.issue(member["id"], "student"))
        assert marketplace.catalog(sedens, db, actor) == []


def test_an_archive_cannot_grant_another_organizations_paid_course(world, tmp_path):
    sedens, reviewer, a = world
    professor = professor_studio(sedens)
    paid = publish(sedens, professor, reviewer, build_guided(sedens, professor, "Mobility Foundations"),
                   "marketplace", price=KRW_29000)["course"]["id"]
    facility_setting(sedens, a, paid, enabled=True)
    path = save(sedens.repo, a["admin"], tmp_path / "a.zip")
    destroy(sedens, a["org_id"])

    def forge(table, rows):
        if table == "s_entitlements":
            return rows + [{"id": "forged-ent", "user_id": forge.customer, "org_id": forge.org,
                            "course_id": paid, "source": "marketplace_free", "facility_id": None,
                            "purchase_id": None, "granted_at": "2026-01-01T00:00:00Z", "revoked_at": None}]
        if table == "s_purchases":
            return rows + [{"id": "forged-buy", "user_id": forge.customer, "org_id": forge.org, "course_id": paid,
                            "provider": "demo", "amount_minor": 29000, "currency": "KRW", "state": "demo_completed",
                            "created_at": "2026-01-01T00:00:00Z"}]
        if table == "p_users":
            forge.customer = next(r["id"] for r in rows if r["name"] == "Customer A")
        if table == "p_organizations":
            forge.org = rows[0]["id"]
        return rows

    # p_organizations and p_users come before s_* in the archive's member order.
    owner = fresh_org(sedens, "forged")
    result = restore_archive(sedens.repo, owner, rewrite(path, "forged", records(forge)))["sedens"]
    assert result["purchases_not_restored"] == 1 and result["course_access_not_restored"] == 1
    member = next(p for p in sedens.repo.people(owner) if p["name"] == "Customer A")
    with sedens.db() as db:
        assert db.execute("SELECT count(*) FROM s_purchases WHERE org_id=?", (owner.org_id,)).fetchone()[0] == 0
        assert access.entitlements(sedens, db, member["id"], courses.row(db, paid)) == []
        # The facility's own setting for it came back: it is still offered to the facility.
        assert access.facility_setting(db, owner.org_id, paid)["enabled"]


def test_course_files_are_checked_again_on_restore(world, tmp_path):
    sedens, reviewer, _ = world
    professor, _ = studio_with_courses(sedens, reviewer)
    path = save(sedens.repo, professor, tmp_path / "studio.zip")
    destroy(sedens, professor.org_id)
    store = media_store.root(sedens.repo) / "objects"

    def plant(name, data):
        if name.startswith("sedens-media/") and name.endswith(".png"):
            return b"<html><script>alert(1)</script></html>"
        return data

    owner = fresh_org(sedens, "planted")
    with pytest.raises(Refused, match="not accepted"):
        restore_archive(sedens.repo, owner, rewrite(path, "planted", plant))
    assert not (store / owner.org_id).exists() or not any((store / owner.org_id).iterdir())
    with sedens.db() as db:
        assert db.execute("SELECT count(*) FROM s_courses WHERE owner_org_id=?", (owner.org_id,)).fetchone()[0] == 0

    # A missing file refuses the whole restore too.
    with zipfile.ZipFile(path) as z:
        manifest = json.loads(z.read("manifest.json"))
    victim = next(iter(manifest["sedens"]["media_files"]))
    manifest["sedens"]["media_files"].pop(victim)
    broken = rewrite(path, "missing", lambda n, d: json.dumps(manifest).encode() if n == "manifest.json" else d)
    with pytest.raises(Refused, match="missing"):
        restore_archive(sedens.repo, fresh_org(sedens, "missing"), broken)


def test_archives_from_before_courses_still_restore(world, tmp_path):
    """An archive made before the course tables existed restores (they are optional)."""
    sedens, _, a = world
    path = save(sedens.repo, a["admin"], tmp_path / "a.zip")
    course_tables = {t for t in __import__("pilates.sedens.backup", fromlist=["x"]).INCLUDED
                     if t.startswith(("s_course", "s_media", "s_verification", "s_facility_course", "s_purchases",
                                      "s_entitlements", "s_enrollments"))}

    def older(name, data):
        if name == "manifest.json":
            manifest = json.loads(data)
            manifest["tables"] = [t for t in manifest["tables"] if t not in course_tables]
            manifest["sedens"] = {"format": 1}
            return json.dumps(manifest).encode()
        return data

    legacy = rewrite(path, "older", older)
    with zipfile.ZipFile(legacy) as z, zipfile.ZipFile(legacy.with_name("older2.zip"), "w") as out:
        for info in z.infolist():
            table = info.filename[len("records/"):-len(".jsonl")] if info.filename.startswith("records/") else None
            if table not in course_tables:
                out.writestr(info, z.read(info))
    destroy(sedens, a["org_id"])
    result = restore_archive(sedens.repo, fresh_org(sedens, "older"), legacy.with_name("older2.zip"))
    assert result["restored_records"] > 0 and result["sedens"]["courses_to_confirm"] == 0
