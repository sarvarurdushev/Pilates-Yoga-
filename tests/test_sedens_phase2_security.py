"""Phase 2 security review: each attack named in the brief, attempted for real.

1. creator reads facility members through affiliation
2. creator edits another creator's course
3. facility enables a course it has no access to
4. customer receives paid entitlement without purchase
5. customer accesses course media from another org
6. unpublished course leaks through search/catalog
7. old published version mutates after creator edit
8. unverified creator appears verified
9. file upload bypasses rights attestation
10. demo payment is presented as real money
11. creator exports unrelated media
12. facility admin modifies creator-owned source content
"""

from __future__ import annotations

import io
import json
import sqlite3
import zipfile

import pytest

from pilates.platform.repository import Refused
from pilates.sedens import (access, course_export, course_media, course_review, courses, creators, marketplace,
                            payments)
from pilates.sedens.util import Denied, now, uid
from course_support import (affiliate, approve, build_education, build_guided, coach_creator, customer, facility,
                            facility_setting, make_sedens, professor_studio, publish, room_for, sedens_staff,
                            set_access, submit)
from test_sedens_courses import RIGHTS, png_bytes

KRW_29000 = {"price_type": "paid", "amount_minor": 29000, "currency": "KRW", "sale_state": "active"}


@pytest.fixture()
def world(tmp_path):
    sedens = make_sedens(tmp_path / "s.db")
    _, reviewer, _ = sedens_staff(sedens)
    return sedens, reviewer, facility(sedens, "A"), facility(sedens, "B"), facility(sedens, "C")


def call(sedens, fn, *args):
    with sedens.db() as db:
        return fn(sedens, db, *args)


def refused(fn, *args, status=None, code=None):
    with pytest.raises((Denied, Refused)) as caught:
        fn(*args)
    if status is not None:
        assert caught.value.status == status, caught.value
    if code is not None:
        assert caught.value.code == code, caught.value
    return caught.value


def upload_png(sedens, actor, title="file.png"):
    body = png_bytes()
    return course_media.upload(sedens, actor, io.BytesIO(body), len(body), "image", title, RIGHTS, title)


# 1 ---------------------------------------------------------------------------------------


def test_1_affiliation_never_opens_the_facilitys_members(world):
    sedens, reviewer, a, b, _ = world
    coach = coach_creator(sedens, a)
    affiliate(sedens, coach, b)
    cid = publish(sedens, coach, reviewer, build_guided(sedens, coach), "network")["course"]["id"]
    facility_setting(sedens, b, cid, enabled=True)
    member = customer(sedens, b)
    call(sedens, marketplace.enroll, member, cid)
    # Platform records: B's customers are invisible to A's coach.
    for person in sedens.repo.people(coach):
        assert person["id"] not in (b["customer_id"], b["other_id"])
    refused(sedens.repo.assert_student, coach, b["customer_id"])
    # SEDENS: no route lets a creator list who enrolled, a facility's rooms, or its courses.
    for fn in (marketplace.facility_courses,):
        refused(call, sedens, fn, coach, status=403)
    from pilates.sedens import rooms

    refused(rooms.facility_rooms, sedens, coach)
    with sedens.db() as db:
        view = courses.editor_view(sedens, db, coach, cid)
    assert "enroll" not in json.dumps(view).lower() and b["customer_id"] not in json.dumps(view)


# 2 ---------------------------------------------------------------------------------------


EDITS = (
    (courses.update, lambda v: {"id": v["course"]["id"], "title": "Mine now"}),
    (courses.set_access, lambda v: {"id": v["course"]["id"], "distribution": "marketplace"}),
    (courses.save_module, lambda v: {"course_id": v["course"]["id"], "title": "Hijack"}),
    (courses.save_session, lambda v: {"course_id": v["course"]["id"], "module_id": v["modules"][0]["id"], "title": "x"}),
    (courses.save_step, lambda v: {"course_id": v["course"]["id"], "session_id": v["modules"][0]["sessions"][0]["id"],
                                   "exercise_source": "standard", "exercise_ref": "std-clam", "reps": 5}),
    (courses.remove, lambda v: {"course_id": v["course"]["id"], "kind": "module", "id": v["modules"][0]["id"]}),
    (courses.move, lambda v: {"course_id": v["course"]["id"], "kind": "module", "id": v["modules"][0]["id"], "position": 0}),
    (courses.submit, lambda v: {"id": v["course"]["id"]}),
    (courses.archive, lambda v: {"id": v["course"]["id"]}),
)


def test_2_a_creator_never_edits_another_creators_course(world):
    sedens, _, a, b, _ = world
    owner = coach_creator(sedens, a, "Owner")
    view = build_guided(sedens, owner)
    from course_support import add_user

    colleague_id = add_user(sedens.repo, a["org_id"], "Colleague", ["coach"], a["location_id"])
    colleague = sedens.repo.actor(sedens.repo.issue(colleague_id, "coach"))
    with sedens.db() as db:
        from pilates.sedens import capabilities

        capabilities.grant(sedens, db, a["admin"], colleague_id, "creator")
        creators.save_profile(sedens, db, colleague, {"display_name": "Colleague"})
    outsider = coach_creator(sedens, b, "Outsider")
    professor = professor_studio(sedens)
    for intruder in (colleague, outsider, professor):
        for fn, data in EDITS:
            refused(call, sedens, fn, intruder, {**data(view), "revision": view["revision"]}, status=404)
    with sedens.db() as db:
        assert courses.row(db, view["course"]["id"])["title"] == "4-Week Core Foundations"


# 3 ---------------------------------------------------------------------------------------


def test_3_a_facility_cannot_enable_what_is_not_offered_to_it(world):
    sedens, reviewer, a, b, _ = world
    coach = coach_creator(sedens, a)
    only_a = publish(sedens, coach, reviewer, build_guided(sedens, coach, "Only A"), "selected_facilities",
                     [{"org_id": a["org_id"], "free": True}])["course"]["id"]
    draft = build_guided(sedens, coach, "Draft")["course"]["id"]
    submitted = submit(sedens, coach, set_access(sedens, coach, build_guided(sedens, coach, "Waiting"),
                                                  "selected_facilities", [{"org_id": a["org_id"], "free": True}]))
    for cid in (only_a, draft, submitted["course"]["id"], "no-such-course"):
        refused(lambda: facility_setting(sedens, b, cid, enabled=True), status=404)
    # Nor include a paid course for free, even one offered to it.
    professor = professor_studio(sedens)
    paid = publish(sedens, professor, reviewer, build_guided(sedens, professor, "Paid"), "marketplace",
                   price=KRW_29000)["course"]["id"]
    refused(lambda: facility_setting(sedens, b, paid, enabled=True, included=True), code="paid_not_includable")
    # A coach (not an administrator) of the facility cannot change its settings.
    refused(call, sedens, marketplace.set_facility_course, sedens.repo.actor(a["coach_token"]),
            {"course_id": only_a, "enabled": True}, status=403)


# 4 ---------------------------------------------------------------------------------------


def test_4_no_paid_entitlement_without_a_purchase(world):
    sedens, reviewer, a, _, _ = world
    professor = professor_studio(sedens)
    cid = publish(sedens, professor, reviewer, build_guided(sedens, professor, "Paid"), "marketplace",
                  price=KRW_29000)["course"]["id"]
    facility_setting(sedens, a, cid, enabled=True)
    member = customer(sedens, a)
    refused(call, sedens, marketplace.enroll, member, cid, status=402, code="purchase_required")
    room = room_for(sedens, a)
    session = call(sedens, marketplace.detail, member, cid)["outline"][0]["sessions"][0]["id"]
    refused(call, sedens, marketplace.room_session_plan, room, cid, session, status=403, code="purchase_required")
    # No purchase can be made outside a demonstration ...
    refused(call, sedens, marketplace.purchase, member, cid, code="payments_unavailable")
    # ... and a stored entitlement only counts with a completed demonstration purchase behind it.
    with sedens.db() as db:
        db.execute("INSERT INTO p_organizations(id,name,demo,created_at) VALUES ('x-org','x',0,?)", (now(),))
        db.execute("INSERT INTO s_purchases(id,user_id,org_id,course_id,provider,amount_minor,currency,state,created_at) "
                   "VALUES ('refunded',?,?,?,'demo',29000,'KRW','demo_refunded',?)",
                   (member.user_id, member.org_id, cid, now()))
        db.execute("INSERT INTO s_entitlements(id,user_id,org_id,course_id,source,purchase_id,granted_at) "
                   "VALUES (?,?,?,?,'demo_purchase','refunded',?)", (uid(), member.user_id, member.org_id, cid, now()))
        assert access.entitlements(sedens, db, member.user_id, courses.row(db, cid)) == []
        assert access.can_play_in_room(sedens, db, room, courses.row(db, cid))["ok"] is False


# 5 ---------------------------------------------------------------------------------------


def test_5_course_media_never_crosses_organizations(world, tmp_path):
    sedens, reviewer, a, b, c = world
    professor = professor_studio(sedens)
    picture = upload_png(sedens, professor, "step.png")
    pdf = b"%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n"
    notes = course_media.upload(sedens, professor, io.BytesIO(pdf), len(pdf), "pdf", "notes.pdf", RIGHTS)
    view = build_guided(sedens, professor, "Guided")
    step = view["modules"][0]["sessions"][0]["steps"][0]
    with sedens.db() as db:
        view = courses.save_step(sedens, db, professor, {
            **{k: step[k] for k in ("id", "phase", "sets", "reps")}, "course_id": view["course"]["id"],
            "revision": view["revision"], "session_id": view["modules"][0]["sessions"][0]["id"],
            "exercise_source": "standard", "exercise_ref": "std-breathing", "image_media_id": picture["id"]})
    affiliate(sedens, professor, a)
    guided = publish(sedens, professor, reviewer, view, "selected_facilities", [{"org_id": a["org_id"], "free": True}])
    facility_setting(sedens, a, guided["course"]["id"], enabled=True)
    edu = build_education(sedens, professor, "Paid notes")
    with sedens.db() as db:
        lesson = edu["modules"][0]["lessons"][0]
        edu = courses.save_lesson(sedens, db, professor, {"course_id": edu["course"]["id"], "revision": edu["revision"],
                                                          "id": lesson["id"], "module_id": edu["modules"][0]["id"],
                                                          "kind": "pdf", "title": "Notes", "media_id": notes["id"]})
    edu = publish(sedens, professor, reviewer, edu, "marketplace", price=KRW_29000)
    outsiders = [customer(sedens, c), c["admin"], b["admin"], customer(sedens, a), a["admin"]]
    with sedens.db() as db:
        for person in outsiders:
            for object_id in (picture["id"], notes["id"]):
                refused(access.media_access, sedens, db, person, None, object_id, status=404)
    # A customer of A in A's room may see the guided step's picture; never the paid PDF.
    room = room_for(sedens, a)
    with sedens.db() as db:
        assert access.media_access(sedens, db, None, room, picture["id"])["object"]["id"] == picture["id"]
        refused(access.media_access, sedens, db, None, room, notes["id"], status=404)
    # Platform media routes never serve course files.
    from pilates.platform import media as platform_media

    refused(platform_media.media_path, sedens.repo, a["admin"], picture["id"])


# 6 ---------------------------------------------------------------------------------------


def test_6_unpublished_courses_never_leak(world):
    sedens, reviewer, a, _, _ = world
    coach = coach_creator(sedens, a)
    terms = [{"org_id": a["org_id"], "free": True}]
    draft = set_access(sedens, coach, build_guided(sedens, coach, "Draft course"), "marketplace")
    waiting = submit(sedens, coach, set_access(sedens, coach, build_guided(sedens, coach, "Waiting course"), "marketplace"))
    suspended = publish(sedens, coach, reviewer, build_guided(sedens, coach, "Suspended course"), "marketplace")
    archived = publish(sedens, coach, reviewer, build_guided(sedens, coach, "Archived course"), "selected_facilities", terms)
    with sedens.db() as db:
        course_review.suspend(sedens, db, reviewer, {"course_id": suspended["course"]["id"], "reason": "Check."})
        courses.archive(sedens, db, coach, {"id": archived["course"]["id"], "revision": archived["revision"]})
    hidden = {draft["course"]["id"], waiting["course"]["id"], suspended["course"]["id"], archived["course"]["id"]}
    member = customer(sedens, a)
    room = room_for(sedens, a)
    with sedens.db() as db:
        assert not {c["id"] for c in marketplace.catalog(sedens, db, member)} & hidden
        assert not {c["id"] for c in marketplace.facility_courses(sedens, db, a["admin"])} & hidden
        assert not {c["id"] for c in marketplace.room_courses(sedens, db, room)} & hidden
        for cid in hidden:
            refused(marketplace.detail, sedens, db, member, cid, status=404)
            refused(marketplace.enroll, sedens, db, member, cid)


# 7 ---------------------------------------------------------------------------------------


def test_7_a_published_version_never_changes(world):
    sedens, reviewer, a, _, _ = world
    coach = coach_creator(sedens, a)
    view = publish(sedens, coach, reviewer, build_guided(sedens, coach), "selected_facilities",
                   [{"org_id": a["org_id"], "free": True}])
    cid = view["course"]["id"]
    with sedens.db() as db:
        before = courses.version(db, cid, 1)
        view = courses.update(sedens, db, coach, {"id": cid, "revision": view["revision"], "title": "Renamed",
                                                  "description": "Changed after publishing."})
        step = view["modules"][0]["sessions"][0]["steps"][0]
        courses.remove(sedens, db, coach, {"course_id": cid, "revision": view["revision"], "kind": "step",
                                           "id": step["id"]})
        after = courses.version(db, cid, 1)
        assert after["snapshot"] == before["snapshot"] and after["snapshot_sha256"] == before["snapshot_sha256"]
        for sql in ("UPDATE s_course_versions SET snapshot='{}' WHERE course_id=?",
                    "UPDATE s_course_versions SET snapshot_sha256='0' WHERE course_id=?",
                    "UPDATE s_course_versions SET version=9 WHERE course_id=?"):
            with pytest.raises(sqlite3.IntegrityError):
                db.execute(sql, (cid,))
        card = access.course_card(sedens, db, customer(sedens, a), courses.row(db, cid))
    assert card["title"] == "4-Week Core Foundations"  # customers still read version 1


# 8 ---------------------------------------------------------------------------------------


def test_8_an_unverified_creator_never_appears_verified(world):
    sedens, reviewer, a, _, _ = world
    professor = professor_studio(sedens, "Prof. Unverified")
    cid = publish(sedens, professor, reviewer, build_guided(sedens, professor), "marketplace")["course"]["id"]
    member = customer(sedens, a)

    def creator_card():
        with sedens.db() as db:
            return access.course_card(sedens, db, member, courses.row(db, cid))["creator"]

    assert creator_card()["creator_type"] == "professor" and creator_card()["verified"] is False
    with sedens.db() as db:
        seen = creators.request_verification(sedens, db, professor)
        creators.decide_verification(sedens, db, reviewer, seen["id"], "verified", version=seen["version"])
    assert creator_card()["verified"] is True
    # Changing the reviewed profile content ends the verification at once.
    with sedens.db() as db:
        creators.save_profile(sedens, db, professor, {"institution": "Another university"})
    assert creator_card()["verified"] is False and creator_card()["verification_state"] != "verified"
    # A creator cannot set their own verification state.
    with sedens.db() as db:
        refused(creators.save_profile, sedens, db, professor, {"verification_state": "verified"}, code="read_only_field")
        assert creators.own_profile(sedens, db, professor)["verification_state"] != "verified"


# 9 ---------------------------------------------------------------------------------------


def test_9_no_file_enters_a_course_without_rights(world):
    sedens, _, a, _, _ = world
    coach = coach_creator(sedens, a)

    class Unread(io.BytesIO):
        def read(self, *args):
            raise AssertionError("read before the rights were checked")

    for rights in (None, {}, {**RIGHTS, "attest": False}, {**RIGHTS, "attest": "yes"},
                   {**RIGHTS, "attestation_version": ""}, {**RIGHTS, "licence_type": "repo_owned"}):
        refused(course_media.upload, sedens, coach, Unread(), 10, "image", "x.png", rights, status=400)
    # A file record without rights (as an older or crafted record would be) cannot be used.
    with sedens.db() as db:
        profile = creators.profile_row(db, coach.user_id)
        db.execute("INSERT INTO s_media_objects(id,owner_org_id,creator_id,uploaded_by,source,kind,mime,size,sha256,"
                   "object_key,created_at) VALUES ('norights',?,?,?,'creator_upload','image','image/png',1,'x','k/x.png',?)",
                   (a["org_id"], profile["id"], coach.user_id, now()))
    view = build_guided(sedens, coach)
    refused(call, sedens, courses.update, coach, {"id": view["course"]["id"], "revision": view["revision"],
                                                  "cover_media_id": "norights"}, code="rights_required")
    # An imported course's files need the importer's own attestation.
    picture = upload_png(sedens, coach)
    with sedens.db() as db:
        view = courses.update(sedens, db, coach, {"id": view["course"]["id"], "revision": view["revision"],
                                                  "cover_media_id": picture["id"]})
    with course_export.export(sedens, coach, view["course"]["id"]) as (archive, _):
        data = archive.read_bytes()
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        refused(course_export.import_archive, sedens, coach, z, False, "", code="attestation_required")


# 10 --------------------------------------------------------------------------------------


def test_10_a_demo_payment_is_never_real_money(world):
    sedens, _, _, _, _ = world
    assert payments.PROVIDER.name == "demo" and payments.PROVIDER.real_money is False
    assert payments.NOTICE["en"] == "DEMO — no real payment occurred."
    with sedens.db() as db:
        columns = {r[1] for r in db.execute("PRAGMA table_info(s_purchases)")}
        assert not columns & {"card", "card_number", "pan", "cvc", "expiry", "token", "payment_method"}
        with pytest.raises(sqlite3.IntegrityError):
            db.execute("INSERT INTO s_purchases(id,user_id,org_id,course_id,provider,amount_minor,currency,state,created_at)"
                       " VALUES ('x','u','o','c','stripe',100,'KRW','demo_completed','t')")


# 11 --------------------------------------------------------------------------------------


def test_11_an_export_carries_only_the_course_s_own_files(world):
    sedens, _, a, _, _ = world
    coach = coach_creator(sedens, a)
    from course_support import add_user
    from pilates.sedens import capabilities

    colleague_id = add_user(sedens.repo, a["org_id"], "Colleague", ["coach"], a["location_id"])
    colleague = sedens.repo.actor(sedens.repo.issue(colleague_id, "coach"))
    with sedens.db() as db:
        capabilities.grant(sedens, db, a["admin"], colleague_id, "creator")
        creators.save_profile(sedens, db, colleague, {"display_name": "Colleague"})
    theirs = upload_png(sedens, colleague, "private.png")
    mine = upload_png(sedens, coach, "mine.png")
    unused = upload_png(sedens, coach, "unused.png")
    view = build_guided(sedens, coach)
    # A colleague's file cannot be attached, even inside the same facility.
    refused(call, sedens, courses.update, coach, {"id": view["course"]["id"], "revision": view["revision"],
                                                  "cover_media_id": theirs["id"]}, status=404)
    with sedens.db() as db:
        refused(access.media_access, sedens, db, coach, None, theirs["id"], status=404)
        view = courses.update(sedens, db, coach, {"id": view["course"]["id"], "revision": view["revision"],
                                                  "cover_media_id": mine["id"]})
    with course_export.export(sedens, coach, view["course"]["id"]) as (archive, _):
        with zipfile.ZipFile(archive) as z:
            names = z.namelist()
            listed = json.loads(z.read("media.json"))
            text = b"".join(z.read(n) for n in names if n.endswith(".json")).decode()
    assert [m["id"] for m in listed] == [mine["id"]]
    assert not [n for n in names if theirs["id"] in n or unused["id"] in n]
    for secret in (a["customer_id"], "password", "token_hash", a["admin"].user_id):
        assert secret not in text
    # Nobody else exports the course.
    refused(lambda: course_export.export(sedens, colleague, view["course"]["id"]).__enter__(), status=404)


# 12 --------------------------------------------------------------------------------------


def test_12_a_facility_admin_never_changes_a_creators_content(world):
    sedens, reviewer, a, _, _ = world
    coach = coach_creator(sedens, a)
    picture = upload_png(sedens, coach)
    view = publish(sedens, coach, reviewer, build_guided(sedens, coach), "selected_facilities",
                   [{"org_id": a["org_id"], "free": True}])
    admin = a["admin"]
    for fn, data in EDITS:
        refused(call, sedens, fn, admin, {**data(view), "revision": view["revision"]})
    # Even with creator tools of their own, the administrator cannot touch the coach's files or course.
    with sedens.db() as db:
        from pilates.sedens import capabilities

        capabilities.grant(sedens, db, admin, admin.user_id, "creator")
        creators.save_profile(sedens, db, admin, {"display_name": "Admin as creator"})
        refused(course_media.retire, sedens, db, admin, picture["id"], status=404)
    for fn, data in EDITS:
        refused(call, sedens, fn, admin, {**data(view), "revision": view["revision"]}, status=404)
    # Reviewing is SEDENS's, not the facility's.
    refused(call, sedens, course_review.suspend, admin, {"course_id": view["course"]["id"], "reason": "x"}, status=404)
    with sedens.db() as db:
        assert courses.row(db, view["course"]["id"])["title"] == "4-Week Core Foundations"
