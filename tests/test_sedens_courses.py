"""Creator Studio authoring, SEDENS review, immutable versions and progress."""

from __future__ import annotations

import io
import sqlite3

import pytest

from pilates.sedens import access, course_media, course_review, courses, marketplace
from pilates.sedens.util import Denied
from course_support import (PASS_ALL, approve, build_education, build_guided, coach_creator, customer, facility,
                            facility_setting, make_sedens, professor_studio, publish, room_for, sedens_staff,
                            set_access, submit)

RIGHTS = {"attest": True, "attestation_version": course_media.ATTESTATION_VERSION, "licence_type": "own_work",
          "original_creator": "Minji Lee", "identifiable_person": "none"}


def png_bytes(color=(10, 120, 200)):
    from PIL import Image

    out = io.BytesIO()
    Image.new("RGB", (32, 24), color).save(out, format="PNG")
    return out.getvalue()


@pytest.fixture()
def world(tmp_path):
    sedens = make_sedens(tmp_path / "s.db")
    _, reviewer, _ = sedens_staff(sedens)
    a = facility(sedens, "A")
    return sedens, reviewer, a, coach_creator(sedens, a)


def call(sedens, fn, *args):
    with sedens.db() as db:
        return fn(sedens, db, *args)


# -- authoring ---------------------------------------------------------------------------------


def test_guided_course_is_modules_sessions_and_ordered_steps(world):
    sedens, _, _, coach = world
    view = build_guided(sedens, coach, steps=("std-breathing", "std-pelvic-curl", "std-dead-bug"))
    session = view["modules"][0]["sessions"][0]
    assert [s["exercise"]["ref"] for s in session["steps"]] == ["std-breathing", "std-pelvic-curl", "std-dead-bug"]
    assert [s["position"] for s in session["steps"]] == [0, 1, 2]
    step = session["steps"][1]
    assert step["anatomy"], "a new step starts with its exercise's anatomy"
    # Reorder: the last step first.
    view = call(sedens, courses.move, coach, {"course_id": view["course"]["id"], "revision": view["revision"],
                                              "kind": "step", "id": session["steps"][2]["id"], "position": 0})
    refs = [s["exercise"]["ref"] for s in view["modules"][0]["sessions"][0]["steps"]]
    assert refs == ["std-dead-bug", "std-breathing", "std-pelvic-curl"]


def test_stale_revision_is_refused(world):
    sedens, _, _, coach = world
    view = build_guided(sedens, coach)
    with pytest.raises(Denied) as refused:
        call(sedens, courses.save_module, coach, {"course_id": view["course"]["id"], "revision": view["revision"] - 1,
                                                  "title": "Week 2"})
    assert refused.value.code == "course_changed" and refused.value.status == 409


def test_step_needs_a_dose_and_a_known_exercise(world):
    sedens, _, _, coach = world
    view = build_guided(sedens, coach)
    base = {"course_id": view["course"]["id"], "revision": view["revision"],
            "session_id": view["modules"][0]["sessions"][0]["id"], "exercise_source": "standard"}
    for data, code in (({"exercise_ref": "std-breathing"}, "invalid_dose"),
                       ({"exercise_ref": "not-an-exercise", "reps": 5}, "unknown_exercise"),
                       ({"exercise_ref": "std-breathing", "reps": 500}, "invalid")):
        with pytest.raises(Denied) as refused:
            call(sedens, courses.save_step, coach, {**base, **data})
        assert refused.value.code == code


def test_guided_training_refuses_medical_claims(world):
    sedens, _, _, coach = world
    with pytest.raises(Denied) as refused:
        call(sedens, courses.create, coach, {"title": "Fix your back pain", "course_type": "guided_training",
                                             "description": "This program cures back pain."})
    assert refused.value.code == "medical_claim_wording"
    with pytest.raises(Denied):
        call(sedens, courses.create, coach, {"title": "허리 통증 치료 프로그램", "course_type": "guided_training"})


def test_professional_education_gets_wording_notes_instead(world):
    sedens, _, _, _ = world
    professor = professor_studio(sedens)
    view = call(sedens, courses.create, professor, {"title": "Rehabilitation research, explained",
                                                     "course_type": "professional_education"})
    assert view["wording_notes"]


def test_anatomy_is_validated_against_the_registry(world):
    sedens, _, _, coach = world
    view = build_guided(sedens, coach)
    step = view["modules"][0]["sessions"][0]["steps"][0]
    base = {"course_id": view["course"]["id"], "revision": view["revision"], "step_id": step["id"]}
    with pytest.raises(Denied):
        call(sedens, courses.save_anatomy, coach, {**base, "structures": [{"key": "not a muscle", "role": "focus"}]})
    with pytest.raises(Denied) as refused:
        call(sedens, courses.save_anatomy, coach, {**base, "structures": [], "timeline": [
            {"start_ms": 0, "end_ms": 4000, "structures": [step["anatomy"][0]["key"]]},
            {"start_ms": 3000, "end_ms": 6000, "structures": [step["anatomy"][0]["key"]]}]})
    assert refused.value.code == "invalid_timeline"
    key = step["anatomy"][0]["key"]
    view = call(sedens, courses.save_anatomy, coach, {**base, "structures": [{"key": key, "role": "focus"}], "timeline": [
        {"start_ms": 0, "end_ms": 4000, "mode": "isolate", "structures": [key], "cue": "Feel the ribs widen."}]})
    saved = view["modules"][0]["sessions"][0]["steps"][0]
    assert saved["anatomy"] == [{"key": key, "role": "focus"}]
    assert saved["timeline"][0]["mode"] == "isolate" and saved["timeline"][0]["structures"] == [key]


def test_price_rules(world):
    sedens, _, _, coach = world
    view = build_guided(sedens, coach)
    for price in ({"price_type": "paid", "amount_minor": 0}, {"price_type": "paid", "amount_minor": -5},
                  {"price_type": "paid", "amount_minor": 29000, "currency": "BTC"}):
        with pytest.raises(Denied):
            set_access(sedens, coach, view, "marketplace", price=price)
    view = set_access(sedens, coach, view, "marketplace",
                      price={"price_type": "paid", "amount_minor": 29000, "currency": "KRW"})
    assert view["price"] == {"price_type": "paid", "amount_minor": 29000, "currency": "KRW", "sale_state": "active"}


def test_selected_facilities_must_be_real_facilities(world):
    sedens, _, _, coach = world
    view = build_guided(sedens, coach)
    professor = professor_studio(sedens)
    stranger = facility(sedens, "B")  # a real facility, but not in this coach's network
    for target in ({"org_id": "nope"}, {"org_id": professor.org_id}, {"org_id": stranger["org_id"]}, {"org_id": 5}):
        with pytest.raises(Denied) as refused:
            set_access(sedens, coach, view, "selected_facilities", [target])
        assert refused.value.status == 404
    with pytest.raises(Denied):
        set_access(sedens, coach, view, "selected_facilities", [])


# -- review and versions -----------------------------------------------------------------------


def test_submit_needs_a_ready_course(world):
    sedens, _, _, coach = world
    view = build_guided(sedens, coach)
    assert "no_distribution" in view["readiness"]
    with pytest.raises(Denied) as refused:
        submit(sedens, coach, view)
    assert refused.value.code == "not_ready"


def test_review_workflow(world):
    sedens, reviewer, a, coach = world
    view = set_access(sedens, coach, build_guided(sedens, coach), "selected_facilities",
                      [{"org_id": a["org_id"], "free": True}])
    view = submit(sedens, coach, view)
    cid = view["course"]["id"]
    assert view["review_state"] == "submitted" and view["visibility"] == "submitted"
    queue = call(sedens, course_review.queue, reviewer)
    assert [q["course_id"] for q in queue] == [cid]
    # The creator never reviews their own course; a facility admin is no reviewer.
    assert call(sedens, course_review.queue, coach) == []
    with sedens.db() as db:
        detail = course_review.detail(sedens, db, reviewer, cid, 1)
    base = {"course_id": cid, "version": 1, "snapshot_sha256": detail["snapshot_sha256"]}
    with pytest.raises(Denied) as refused:
        call(sedens, course_review.decide, reviewer, {**base, "decision": "approved", "checklist": {}})
    assert refused.value.code == "checklist_incomplete"
    needs_work = {**PASS_ALL, "safety_wording": {"result": "needs_work", "note": "Add a stop rule."}}
    with pytest.raises(Denied) as refused:
        call(sedens, course_review.decide, reviewer, {**base, "decision": "approved", "checklist": needs_work})
    assert refused.value.code == "checklist_not_passed"
    with pytest.raises(Denied) as refused:
        call(sedens, course_review.decide, reviewer, {**base, "decision": "needs_revision", "checklist": needs_work})
    assert refused.value.code == "comment_required"
    with pytest.raises(Denied) as refused:
        call(sedens, course_review.decide, reviewer, {**base, "snapshot_sha256": "0" * 64, "decision": "approved",
                                                      "checklist": PASS_ALL})
    assert refused.value.code == "version_changed"
    call(sedens, course_review.decide, reviewer, {**base, "decision": "needs_revision", "checklist": needs_work,
                                                  "comment": "Add a stop rule to the safety text."})
    with sedens.db() as db:
        view = courses.editor_view(sedens, db, coach, cid)
    assert view["review_state"] == "needs_revision"
    assert view["reviews"][0]["comment"] == "Add a stop rule to the safety text." and view["reviews"][0]["version"] == 1
    with sedens.db() as db:
        view = courses.update(sedens, db, coach, {"id": cid, "revision": view["revision"],
                                                  "safety": "Stop if anything hurts."})
    view = submit(sedens, coach, view)
    assert [v["state"] for v in view["versions"]] == ["submitted", "withdrawn"]
    approve(sedens, reviewer, cid)
    with sedens.db() as db:
        view = courses.editor_view(sedens, db, coach, cid)
    assert view["review_state"] == "published" and view["published_version"] == 2


def test_versions_are_immutable(world):
    sedens, reviewer, a, coach = world
    cid = publish(sedens, coach, reviewer, build_guided(sedens, coach), "selected_facilities",
                  [{"org_id": a["org_id"], "free": True}])["course"]["id"]
    with sedens.db() as db:
        with pytest.raises(sqlite3.IntegrityError):
            db.execute("UPDATE s_course_versions SET snapshot='{}' WHERE course_id=?", (cid,))


def test_editing_a_published_course_never_changes_enrolled_customers(world):
    sedens, reviewer, a, coach = world
    view = publish(sedens, coach, reviewer, build_guided(sedens, coach), "selected_facilities",
                   [{"org_id": a["org_id"], "free": True}])
    cid = view["course"]["id"]
    facility_setting(sedens, a, cid, enabled=True)
    first = customer(sedens, a)
    call(sedens, marketplace.enroll, first, cid)
    # The creator adds a step: a new draft, then version 2.
    session_id = view["modules"][0]["sessions"][0]["id"]
    with sedens.db() as db:
        view = courses.save_step(sedens, db, coach, {"course_id": cid, "revision": view["revision"],
                                                     "session_id": session_id, "exercise_source": "standard",
                                                     "exercise_ref": "std-clam", "reps": 8, "sides": "each_side"})
    with sedens.db() as db:
        assert courses.row(db, cid)["published_version"] == 1  # the draft edit published nothing
    view = submit(sedens, coach, view)
    approve(sedens, reviewer, cid)
    with sedens.db() as db:
        states = {v["version"]: v["state"] for v in courses.versions(db, cid)}
    assert states == {1: "superseded", 2: "published"}
    room = room_for(sedens, a)
    old_session = call(sedens, marketplace.detail, first, cid)["outline"][0]["sessions"][0]["id"]
    plan = call(sedens, marketplace.room_session_plan, room, cid, old_session)
    assert plan["version"] == 1 and len(plan["session"]["steps"]) == 1
    # Someone enrolling now gets version 2.
    second = customer(sedens, a, "other_token")
    detail = call(sedens, marketplace.enroll, second, cid)
    assert detail["version"] == 2 and detail["outline"][0]["sessions"][0]["steps"] == 2


def test_reviewer_cannot_review_across_environments(world, tmp_path):
    sedens, reviewer, a, coach = world
    view = submit(sedens, coach, set_access(sedens, coach, build_guided(sedens, coach), "selected_facilities",
                                            [{"org_id": a["org_id"], "free": True}]))
    with sedens.db() as db:
        db.execute("UPDATE p_organizations SET demo=1 WHERE id=?", (a["org_id"],))
    assert call(sedens, course_review.queue, reviewer) == []
    with sedens.db() as db, pytest.raises(Denied):
        course_review.detail(sedens, db, reviewer, view["course"]["id"], 1)


# -- progress ---------------------------------------------------------------------------------


def test_progress_records_completions_without_scores(world):
    sedens, reviewer, a, coach = world
    view = publish(sedens, coach, reviewer, build_guided(sedens, coach, sessions=2), "selected_facilities",
                   [{"org_id": a["org_id"], "free": True}])
    cid = view["course"]["id"]
    facility_setting(sedens, a, cid, enabled=True)
    room = room_for(sedens, a)
    member = customer(sedens, a)
    outline = call(sedens, marketplace.enroll, member, cid)["outline"]
    for session in outline[0]["sessions"]:
        call(sedens, marketplace.room_session_plan, room, cid, session["id"])
        state = call(sedens, marketplace.complete_room_session, room, cid, session["id"])["progress"]
    assert state["completed_items"] == state["total_items"] == 2 and state["completed_at"]
    assert set(state) == {"version", "enrolled_at", "completed_items", "total_items", "modules", "completed_at", "done"}
    with pytest.raises(Denied):
        call(sedens, marketplace.complete_room_session, room, cid, "not-a-session")


def test_professional_lessons_are_completed_outside_the_room(world):
    sedens, reviewer, a, _ = world
    professor = professor_studio(sedens)
    view = publish(sedens, professor, reviewer, build_education(sedens, professor), "marketplace")
    cid = view["course"]["id"]
    member = customer(sedens, a)
    detail = call(sedens, marketplace.enroll, member, cid)
    lesson = detail["outline"][0]["lessons"][0]["id"]
    with sedens.db() as db:
        detail = marketplace.complete_lesson(sedens, db, member, cid, lesson)
    assert detail["progress"]["completed_items"] == 1
    assert detail["room_only"] is False


# -- media rights -----------------------------------------------------------------------------


class Exploding(io.BytesIO):
    def read(self, *a):
        raise AssertionError("the body must not be read before the rights are checked")


def test_upload_requires_rights_before_reading_the_file(world):
    sedens, _, _, coach = world
    for rights in (None, {**RIGHTS, "attest": False}, {**RIGHTS, "attestation_version": "old"},
                   {**RIGHTS, "licence_type": "pexels"}, {**RIGHTS, "original_creator": ""}):
        with pytest.raises(Denied):
            course_media.upload(sedens, coach, Exploding(), 100, "image", "a.png", rights)


def test_media_with_rights_is_kept_and_served_only_to_those_allowed(world):
    sedens, reviewer, a, coach = world
    body = png_bytes()
    media = course_media.upload(sedens, coach, io.BytesIO(body), len(body), "image", "cover.png", RIGHTS, "Cover")
    assert media["rights"]["licence_type"] == "own_work" and media["rights"]["review_status"] == "unreviewed"
    other = facility(sedens, "X")
    other_coach = coach_creator(sedens, other, "Other coach")
    with sedens.db() as db:
        assert access.media_access(sedens, db, coach, None, media["id"])["object"]["kind"] == "image"
        for intruder in (other_coach, other["admin"], customer(sedens, a), a["admin"]):
            with pytest.raises(Denied) as refused:
                access.media_access(sedens, db, intruder, None, media["id"])
            assert refused.value.status == 404
    # Another facility's coach cannot attach it to their course either.
    view = build_guided(sedens, other_coach)
    with sedens.db() as db, pytest.raises(Denied) as refused:
        courses.update(sedens, db, other_coach, {"id": view["course"]["id"], "revision": view["revision"],
                                                 "cover_media_id": media["id"]})
    assert refused.value.code == "unknown_media"


def test_rejected_rights_block_submission(world):
    sedens, reviewer, a, coach = world
    body = png_bytes()
    media = course_media.upload(sedens, coach, io.BytesIO(body), len(body), "image", "cover.png", RIGHTS)
    view = build_guided(sedens, coach)
    with sedens.db() as db:
        view = courses.update(sedens, db, coach, {"id": view["course"]["id"], "revision": view["revision"],
                                                  "cover_media_id": media["id"]})
        course_review.decide_media(sedens, db, reviewer, {"object_id": media["id"], "decision": "rejected",
                                                          "note": "We cannot confirm permission."})
    view = set_access(sedens, coach, view, "selected_facilities", [{"org_id": a["org_id"], "free": True}])
    assert "media_rights_rejected" in view["readiness"]
