"""``/sedens/`` routes for the Creator Studio, SEDENS review, the facility course
console, the customer catalog and the room's guided sessions.

Handlers only translate requests: every decision is made by
:mod:`pilates.sedens.access` and the domain modules. Two routes stream instead
of exchanging JSON: a course-file upload (rights in the query, checked before
the body is read) and a course-file read (authorized by ``access.media_access``,
then served with ``nosniff`` and a sandboxing content-security policy).
"""

from __future__ import annotations

import json
import shutil
from urllib.parse import unquote

from . import (access, capabilities, course_export, course_media, course_review, courses, creators, marketplace,
               media_store, payments, standard, video_providers)
from ..platform.repository import Refused
from .util import Denied


def _creator(r):
    actor = r.actor()
    with r.sedens.db() as db:
        capabilities.require(r.sedens, db, actor, "creator")
    return actor


def _targets(sedens, db, profile):
    """The facilities this creator may offer a course to, with their public names."""
    out = []
    for t in creators.distribution_targets(sedens, db, profile["id"]) if profile else []:
        org = sedens.org(db, t["org_id"])
        locations = [{"id": loc["id"], "name": loc["name"]} for loc in db.execute(
            "SELECT id, name FROM p_locations WHERE org_id=? ORDER BY name", (t["org_id"],))
            if t["location_id"] in (None, loc["id"])]
        out.append({**t, "facility_name": org["display_name"], "locations": locations})
    return out


def vocabulary():
    return {
        "course_types": list(courses.TYPES), "languages": list(courses.LANGUAGES),
        "categories": list(courses.CATEGORIES), "levels": list(courses.LEVELS),
        "equipment": list(courses.EQUIPMENT), "body_areas": list(courses.BODY_AREAS),
        "distributions": list(courses.DISTRIBUTIONS), "currencies": list(courses.CURRENCIES),
        "sale_states": list(courses.SALE_STATES), "phases": list(courses.PHASES), "sides": list(courses.SIDES),
        "roles": list(courses.ROLES), "lesson_kinds": list(courses.LESSON_KINDS), "layers": list(courses.LAYERS),
        "licences": list(course_media.LICENCES), "attestation": course_media.ATTESTATION,
        "attestation_version": course_media.ATTESTATION_VERSION, "checklist": list(course_review.CHECKLIST),
        "payment_notice": payments.NOTICE,
        "anatomy_label": {"en": "Educational anatomy — not measured muscle activation.",
                          "ko": "교육용 해부학 — 측정된 근육 활성도가 아닙니다."},
        "standard_label": standard.label(),
        "limits": {kind: media_store.limit("demo_free", kind) for kind in media_store.KINDS},
    }


# -- Creator Studio ----------------------------------------------------------------------


def _studio(r):
    actor = _creator(r)
    with r.sedens.db() as db:
        profile = creators.profile_row(db, actor.user_id)
        return {
            "profile": creators.public(profile),
            "courses": courses.list_for_creator(r.sedens, db, actor),
            "media": course_media.list_for_creator(r.sedens, db, actor) if profile else [],
            "evidence": course_media.evidence(db, profile["id"]) if profile else [],
            "affiliations": creators.creator_affiliations(r.sedens, db, actor),
            "targets": _targets(r.sedens, db, profile),
            "vocabulary": vocabulary(),
            "limits": {kind: media_store.limit(r.sedens.mode.name, kind) for kind in media_store.KINDS},
        }


def _edit(fn, batch=False):
    def handler(r):
        actor = r.actor()
        if batch:
            with r.sedens.batch(), r.sedens.db() as db:
                return fn(r.sedens, db, actor, r.body)
        with r.sedens.db() as db:
            return fn(r.sedens, db, actor, r.body)
    return handler


def _course(r):
    actor = r.actor()
    with r.sedens.db() as db:
        course = courses.row(db, r.query.get("id"))
        if not access.can_edit(r.sedens, db, actor, course):
            raise Denied("This course does not exist.", 404, "unknown_course")
        return courses.editor_view(r.sedens, db, actor, course["id"])


def _course_version(r):
    actor = r.actor()
    with r.sedens.db() as db:
        course = courses.row(db, r.query.get("id"))
        if not access.can_edit(r.sedens, db, actor, course):
            raise Denied("This course does not exist.", 404, "unknown_course")
        found = courses.version(db, course["id"], int(r.query.get("version") or 0))
        if found is None:
            raise Denied("This version does not exist.", 404, "unknown_version")
        return found


def _exercises(r):
    _creator(r)
    return {"items": courses.search_exercises(r.query.get("q", ""), 60), "label": standard.label()}


def _media_sources(r):
    _creator(r)
    return {"providers": video_providers.registry(), "stock_label": video_providers.STOCK_LABEL,
            "workflow": video_providers.GENERATION_WORKFLOW}


def _repo_asset(r):
    actor = r.actor()
    with r.sedens.db() as db:
        return course_media.add_repo_asset(r.sedens, db, actor, r.body.get("asset_id"))


def _retire(r):
    actor = r.actor()
    with r.sedens.db() as db:
        return course_media.retire(r.sedens, db, actor, r.body.get("id"))


def _evidence(r):
    actor = r.actor()
    with r.sedens.db() as db:
        return course_media.add_evidence(r.sedens, db, actor, r.body)


# -- SEDENS review -----------------------------------------------------------------------


def _review_queue(r):
    actor = r.actor()
    with r.sedens.db() as db:
        capabilities.require(r.sedens, db, actor, "sedens_reviewer")
        published = []
        env = access.environment(r.sedens.org(db, actor.org_id))
        for c in db.execute("SELECT * FROM s_courses WHERE published_version IS NOT NULL OR suspended_at IS NOT NULL "
                            "ORDER BY updated_at DESC LIMIT 200"):
            if access.environment(r.sedens.org(db, c["owner_org_id"])) == env and access.can_review(r.sedens, db, actor, c):
                published.append({"course_id": c["id"], "title": c["title"], "published_version": c["published_version"],
                                  "suspended": bool(c["suspended_at"]), "course_type": c["course_type"]})
        return {"items": course_review.queue(r.sedens, db, actor), "published": published,
                "checklist": list(course_review.CHECKLIST)}


def _review_course(r):
    actor = r.actor()
    with r.sedens.db() as db:
        return course_review.detail(r.sedens, db, actor, r.query.get("id"), r.query.get("version"))


# -- facility course console -------------------------------------------------------------


def _facility_courses(r):
    actor = r.actor()
    with r.sedens.db() as db:
        return {"items": marketplace.facility_courses(r.sedens, db, actor)}


# -- customers ---------------------------------------------------------------------------


def _catalog(r):
    actor = r.actor()
    with r.sedens.db() as db:
        return {"items": marketplace.catalog(r.sedens, db, actor), "payment_notice": payments.NOTICE,
                "demo": bool(r.sedens.org(db, actor.org_id)["demo"])}


def _detail(r):
    actor = r.actor()
    with r.sedens.db() as db:
        return marketplace.detail(r.sedens, db, actor, r.query.get("id"))


def _customer(fn, batch=True):
    def handler(r):
        actor = r.actor()
        if batch:
            with r.sedens.batch(), r.sedens.db() as db:
                return fn(r.sedens, db, actor, r.body.get("course_id"))
        with r.sedens.db() as db:
            return fn(r.sedens, db, actor, r.body.get("course_id"))
    return handler


def _complete_lesson(r):
    actor = r.actor()
    with r.sedens.db() as db:
        return marketplace.complete_lesson(r.sedens, db, actor, r.body.get("course_id"), r.body.get("lesson_id"))


def _my_courses(r):
    actor = r.actor()
    with r.sedens.db() as db:
        return {"items": marketplace.my_courses(r.sedens, db, actor)}


# -- the room ----------------------------------------------------------------------------


def _room_courses(r):
    room = r.room()
    with r.sedens.db() as db:
        return {"items": marketplace.room_courses(r.sedens, db, room)}


def _room_course_session(r):
    room = r.room()
    with r.sedens.batch(), r.sedens.db() as db:
        return marketplace.room_session_plan(r.sedens, db, room, r.body.get("course_id"), r.body.get("session_id"))


def _room_course_complete(r):
    room = r.room()
    with r.sedens.db() as db:
        return marketplace.complete_room_session(r.sedens, db, room, r.body.get("course_id"), r.body.get("session_id"))


# -- streams -----------------------------------------------------------------------------


def _media_upload(r):
    """POST creator/media/upload?kind=&filename=&title=&rights=<JSON>, body = the file."""
    r.limit("upload")
    actor = r.actor()
    try:
        rights = json.loads(unquote(r.query.get("rights", "")) or "null")
    except ValueError as exc:
        raise Denied("Add the rights information for this file.", 400, "rights_required") from exc
    length = int(r.h.headers.get("Content-Length") or 0)
    result = course_media.upload(r.sedens, actor, r.h.rfile, length, r.query.get("kind"),
                                 r.query.get("filename", ""), rights, r.query.get("title", ""))
    return result


def _optional_actor(r):
    try:
        return r.actor() if r.platform_token else None
    except Refused:
        return None


def _optional_room(r):
    if not (r.device_token and r.room_token):
        return None
    try:
        return r.room()
    except Denied:
        return None


def _media_file(r):
    """GET media/file?id= : the bytes of a course file, for whoever access.media_access allows."""
    actor, room = _optional_actor(r), _optional_room(r)
    with r.sedens.db() as db:
        allowed = access.media_access(r.sedens, db, actor, room, r.query.get("id"))
    found = allowed["object"]
    path = course_media.file_of(r.sedens, found)
    if not path.is_file():
        raise Denied("This file is not available.", 404, "media_not_found")
    name = found["original_filename"] or ("file" + media_store.EXTENSIONS[found["mime"]])
    media_store.stream_file(r.h, path, found["mime"], download_name=name if allowed["download"] else None)
    return None


def _course_export(r):
    actor = r.actor()
    with course_export.export(r.sedens, actor, r.query.get("id")) as (archive, name):
        r.h.send_response(200)
        r.h.send_header("Content-Type", "application/zip")
        r.h.send_header("Content-Length", str(archive.stat().st_size))
        r.h.send_header("Content-Disposition", f'attachment; filename="{name}"')
        r.h.send_header("Cache-Control", "no-store")
        r.h.send_header("X-Content-Type-Options", "nosniff")
        r.h.end_headers()
        with archive.open("rb") as source:
            shutil.copyfileobj(source, r.h.wfile, 65536)
    return None


def _course_import(r):
    r.limit("upload")
    actor = r.actor()
    length = int(r.h.headers.get("Content-Length") or 0)
    return course_export.import_upload(r.sedens, actor, r.h.rfile, length, r.query.get("attest") == "1",
                                       r.query.get("attestation_version", ""))


ROUTES = {
    # Creator Studio
    ("GET", "creator/studio"): _studio,
    ("GET", "creator/exercises"): _exercises,
    ("GET", "creator/media/sources"): _media_sources,
    ("POST", "creator/media/repo-asset"): _repo_asset,
    ("POST", "creator/media/retire"): _retire,
    ("POST", "creator/evidence"): _evidence,
    ("POST", "creator/courses/create"): _edit(courses.create),
    ("GET", "creator/course"): _course,
    ("GET", "creator/course/version"): _course_version,
    ("POST", "creator/course/update"): _edit(courses.update),
    ("POST", "creator/course/access"): _edit(courses.set_access),
    ("POST", "creator/course/module"): _edit(courses.save_module),
    ("POST", "creator/course/session"): _edit(courses.save_session),
    ("POST", "creator/course/step"): _edit(courses.save_step),
    ("POST", "creator/course/anatomy"): _edit(courses.save_anatomy),
    ("POST", "creator/course/lesson"): _edit(courses.save_lesson),
    ("POST", "creator/course/move"): _edit(courses.move),
    ("POST", "creator/course/remove"): _edit(courses.remove),
    ("POST", "creator/course/submit"): _edit(courses.submit, batch=True),
    ("POST", "creator/course/archive"): _edit(courses.archive),
    # SEDENS review
    ("GET", "review/courses"): _review_queue,
    ("GET", "review/course"): _review_course,
    ("POST", "review/course/decide"): _edit(course_review.decide, batch=True),
    ("POST", "review/course/suspend"): _edit(course_review.suspend, batch=True),
    ("POST", "review/media/decide"): _edit(course_review.decide_media),
    # facility course console
    ("GET", "facility/courses"): _facility_courses,
    ("POST", "facility/courses/setting"): _edit(marketplace.set_facility_course),
    # customers
    ("GET", "courses/catalog"): _catalog,
    ("GET", "courses/detail"): _detail,
    ("POST", "courses/enroll"): _customer(marketplace.enroll),
    ("POST", "courses/demo-purchase"): _customer(marketplace.purchase),
    ("POST", "courses/lesson/complete"): _complete_lesson,
    ("GET", "courses/mine"): _my_courses,
    # the room (rooms.authorize on every call)
    ("GET", "room/courses"): _room_courses,
    ("POST", "room/course/session"): _room_course_session,
    ("POST", "room/course/complete"): _room_course_complete,
}

# Routes that read the request body or write the response themselves.
STREAMS = {
    ("POST", "creator/media/upload"): _media_upload,
    ("GET", "media/file"): _media_file,
    ("GET", "creator/course/export"): _course_export,
    ("POST", "creator/course/import"): _course_import,
}
