"""Builders for SEDENS course tests: creators, courses, review and rooms."""

from __future__ import annotations

from pilates.sedens import capabilities, course_review, courses, creators, marketplace, onboarding
from sedens_support import PASSWORD, add_user, enter_with_code, facility, make_sedens, pair, sedens_staff

PASS_ALL = {item: {"result": "pass"} for item in course_review.CHECKLIST}


def coach_creator(sedens, fac, name="Minji Lee"):
    """The facility's coach, given the creator permission and a profile. Returns the Actor."""
    coach = sedens.repo.actor(fac["coach_token"])
    with sedens.db() as db:
        capabilities.grant(sedens, db, fac["admin"], fac["coach_id"], "creator")
        creators.save_profile(sedens, db, coach, {"display_name": name})
    return coach


def professor_studio(sedens, name="Dr. Example Mobility", email=None):
    token = onboarding.register_creator_studio(
        sedens, name=name, email=email or f"prof-{abs(hash(name)) % 10**8}@example.test", password=PASSWORD,
        display_name=name, creator_type="professor")
    return sedens.repo.actor(token)


def affiliate(sedens, coach, fac, approve=True):
    with sedens.db() as db:
        request = creators.request_affiliation(sedens, db, coach, fac["org_id"])
        if approve:
            creators.decide_affiliation(sedens, db, fac["admin"], request["id"], "approve")
    return request


def build_guided(sedens, actor, title="4-Week Core Foundations", sessions=1, steps=("std-breathing",)):
    """A guided training course with one module, ``sessions`` sessions and the given steps."""
    with sedens.db() as db:
        view = courses.create(sedens, db, actor, {"title": title, "course_type": "guided_training",
                                                  "category": "core", "language": "en", "weeks": 4,
                                                  "sessions_per_week": 2, "estimated_minutes": 25,
                                                  "description": "A gentle start for the deep core."})
        cid = view["course"]["id"]
        view = courses.save_module(sedens, db, actor, {"course_id": cid, "revision": view["revision"],
                                                       "title": "Week 1"})
        module_id = view["modules"][0]["id"]
        for n in range(sessions):
            view = courses.save_session(sedens, db, actor, {"course_id": cid, "revision": view["revision"],
                                                            "module_id": module_id, "title": f"Session {n + 1}",
                                                            "estimated_minutes": 20})
            session_id = view["modules"][0]["sessions"][n]["id"]
            for ref in steps:
                view = courses.save_step(sedens, db, actor, {
                    "course_id": cid, "revision": view["revision"], "session_id": session_id,
                    "exercise_source": "standard", "exercise_ref": ref, "reps": 6, "rest_seconds": 15,
                    "customer_cue": "Breathe slowly."})
    return view


def build_education(sedens, actor, title="Mobility Foundations"):
    with sedens.db() as db:
        view = courses.create(sedens, db, actor, {"title": title, "course_type": "professional_education",
                                                  "language": "en", "description": "How joints move."})
        cid = view["course"]["id"]
        view = courses.save_module(sedens, db, actor, {"course_id": cid, "revision": view["revision"],
                                                       "title": "Joint basics"})
        view = courses.save_lesson(sedens, db, actor, {"course_id": cid, "revision": view["revision"],
                                                       "module_id": view["modules"][0]["id"], "kind": "article",
                                                       "title": "What mobility means", "body": "Range and control."})
    return view


def set_access(sedens, actor, view, distribution, facilities=(), price=None):
    with sedens.db() as db:
        return courses.set_access(sedens, db, actor, {
            "id": view["course"]["id"], "revision": view["revision"], "distribution": distribution,
            "facilities": [dict(f) for f in facilities],
            "price": price or {"price_type": "free"}})


def submit(sedens, actor, view):
    with sedens.batch(), sedens.db() as db:
        return courses.submit(sedens, db, actor, {"id": view["course"]["id"], "revision": view["revision"]})


def approve(sedens, reviewer, course_id, number=None):
    with sedens.db() as db:
        if number is None:
            number = db.execute("SELECT MAX(version) FROM s_course_versions WHERE course_id=?", (course_id,)).fetchone()[0]
        detail = course_review.detail(sedens, db, reviewer, course_id, number)
    with sedens.batch(), sedens.db() as db:
        return course_review.decide(sedens, db, reviewer, {
            "course_id": course_id, "version": number, "decision": "approved",
            "snapshot_sha256": detail["snapshot_sha256"], "checklist": PASS_ALL})


def publish(sedens, actor, reviewer, view, distribution, facilities=(), price=None):
    view = set_access(sedens, actor, view, distribution, facilities, price)
    view = submit(sedens, actor, view)
    approve(sedens, reviewer, view["course"]["id"])
    with sedens.db() as db:
        return courses.editor_view(sedens, db, actor, view["course"]["id"])


def facility_setting(sedens, fac, course_id, **values):
    with sedens.db() as db:
        return marketplace.set_facility_course(sedens, db, fac["admin"], {"course_id": course_id, **values})


def room_for(sedens, fac, token_key="customer_token"):
    """An authorized room context for a facility's customer."""
    device = pair(sedens, fac)
    return enter_with_code(sedens, device, fac[token_key])["context"]


def customer(sedens, fac, key="customer_token"):
    return sedens.repo.actor(fac[key])


__all__ = ["PASSWORD", "PASS_ALL", "add_user", "affiliate", "approve", "build_education", "build_guided",
           "coach_creator", "customer", "facility", "facility_setting", "make_sedens", "professor_studio", "publish",
           "room_for", "sedens_staff", "set_access", "submit"]
