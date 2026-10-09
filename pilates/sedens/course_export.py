"""Course export and import: one course as a self-describing ZIP.

An export carries the course's metadata, modules, sessions, steps (with their
anatomy and timelines) or lessons, its access and price settings, every
version snapshot with its review state, the rights record of each file, and
the course's own uploaded files. ``manifest.json`` lists every other member
with its SHA-256. It never carries passwords, sign-in or room tokens, customer
records, other organizations' identifiers or any file the course does not use.

An import creates a **new draft** owned by the importing creator, through the
same functions the Creator Studio uses: every title passes the wording rules,
every exercise and anatomy name is checked again, and every file passes the
upload checks. Files need the importer's own rights attestation. Access,
price and versions are not imported: a draft is offered to nobody until its
creator chooses, and SEDENS reviews it before anyone sees it.
"""

from __future__ import annotations

from contextlib import contextmanager
import hashlib
import json
from pathlib import Path
import re
import tempfile
import zipfile

from . import access, course_media, courses, media_store
from .util import Denied, encode, now

FORMAT = "sedens-course"
VERSION = 1
MAX_ARCHIVE = 400 * 1024 * 1024
MAX_JSON = 8 * 1024 * 1024
_NAME = re.compile(r"^(course\.json|media\.json|versions/[0-9]{1,4}\.json|media/[A-Za-z0-9_-]{1,64}\.(mp4|webm|jpg|png|webp|pdf))$")


def _media_ids(view) -> set:
    ids = {view["course"]["cover_media_id"]} - {None}
    for m in view["modules"]:
        for s in m.get("sessions", []):
            for step in s["steps"]:
                ids |= {step["video_media_id"], step["image_media_id"]} - {None}
        for lesson in m.get("lessons", []):
            ids |= {lesson["media_id"]} - {None}
    return ids


@contextmanager
def export(sedens, actor, course_id):
    """Yields (zip path, download name) for the course's own creator."""
    with sedens.db() as db:
        course = courses.row(db, course_id)
        if not access.can_edit(sedens, db, actor, course):
            raise Denied("This course does not exist.", 404, "unknown_course")
        view = courses.editor_view(sedens, db, actor, course["id"])
        versions = [courses.version(db, course["id"], v["version"]) for v in view["versions"]]
        used = _media_ids(view)
        for v in versions:
            used |= set(v["snapshot"].get("media", []))
        media = [course_media.describe(db, object_id) for object_id in sorted(used)]
        rows = {r["id"]: r for r in db.execute(
            "SELECT * FROM s_media_objects WHERE owner_org_id=? AND id IN (SELECT value FROM json_each(?))",
            (course["owner_org_id"], encode(sorted(used))))}
    body = {
        "course": {k: v for k, v in view["course"].items() if k != "cover_media_id"},
        "cover_media_id": view["course"]["cover_media_id"],
        "price": view["price"],
        # Facility names only: other organizations' identifiers stay on this server.
        "facilities": [{"facility_name": f["facility_name"], "location_name": f["location_name"], "free": f["free"]}
                       for f in view["facilities"]],
        "modules": view["modules"],
        "review_state": view["review_state"],
    }
    with tempfile.TemporaryDirectory(prefix="sedens-course-") as folder:
        path = Path(folder) / "course.zip"
        files = {}
        with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=1) as z:
            def put(name, data: bytes):
                files[name] = hashlib.sha256(data).hexdigest()
                z.writestr(name, data)

            put("course.json", encode(body).encode())
            for v in versions:
                snapshot = dict(v["snapshot"])
                snapshot["facilities"] = [{"facility_name": f["facility_name"], "free": f["free"]}
                                          for f in snapshot.get("facilities", [])]
                put(f"versions/{v['version']}.json", encode({
                    "version": v["version"], "state": v["state"], "submitted_at": v["submitted_at"],
                    "decided_at": v["decided_at"], "snapshot_sha256": v["snapshot_sha256"],
                    "snapshot": snapshot}).encode())
            listed = []
            for m in media:
                row = rows.get(m["id"])
                if row is None:
                    continue
                entry = {k: m[k] for k in ("id", "kind", "mime", "title", "filename", "size", "source", "width",
                                           "height", "rights")}
                entry["sha256"] = row["sha256"]
                entry["repo_asset"] = row["repo_asset"]
                if row["source"] != "repo":
                    stored = media_store.object_path(sedens.repo, row["object_key"])
                    if not stored.is_file():
                        raise Denied("A file of this course is missing. Remove it from the course and export again.",
                                     409, "media_missing")
                    name = f"media/{m['id']}{media_store.EXTENSIONS[row['mime']]}"
                    files[name] = row["sha256"]
                    z.write(stored, name)
                    entry["file"] = name
                listed.append(entry)
            put("media.json", encode(listed).encode())
            z.writestr("manifest.json", encode({
                "format": FORMAT, "version": VERSION, "exported_at": now(), "course_id": course["id"],
                "course_type": course["course_type"], "title": course["title"], "files": files,
                "labels": {"anatomy": "Educational anatomy — not measured muscle activation.",
                           "fitness": "General fitness content. Not medical advice."},
            }))
        safe = re.sub(r"[^A-Za-z0-9_-]+", "-", course["title"]).strip("-")[:60] or "course"
        yield path, f"sedens-course-{safe}.zip"


def _read_json(z, name):
    info = z.getinfo(name)
    if info.file_size > MAX_JSON:
        raise Denied("This course file is too large to import.", 413, "import_too_large")
    return json.loads(z.read(info))


def validate(z) -> tuple[dict, dict, list]:
    """(manifest, course body, media list) after checking every member and checksum."""
    names = [i.filename for i in z.infolist()]
    if len(names) != len(set(names)) or len(names) > 2000 or "manifest.json" not in names:
        raise Denied("Choose a SEDENS course export.", 400, "invalid_import")
    manifest = _read_json(z, "manifest.json")
    if not isinstance(manifest, dict) or manifest.get("format") != FORMAT or manifest.get("version") != VERSION:
        raise Denied("Choose a SEDENS course export.", 400, "invalid_import")
    files = manifest.get("files")
    if not isinstance(files, dict) or set(files) != set(names) - {"manifest.json"} \
            or any(not _NAME.match(n) for n in files):
        raise Denied("This course export is incomplete or has unexpected files.", 400, "invalid_import")
    if sum(i.file_size for i in z.infolist()) > MAX_ARCHIVE:
        raise Denied("This course export is too large.", 413, "import_too_large")
    for name, expected in files.items():
        digest = hashlib.sha256()
        with z.open(name) as source:
            for block in iter(lambda: source.read(65536), b""):
                digest.update(block)
        if digest.hexdigest() != expected:
            raise Denied("This course export was changed after it was made.", 400, "checksum_mismatch")
    body, media = _read_json(z, "course.json"), _read_json(z, "media.json")
    if not isinstance(body, dict) or not isinstance(body.get("course"), dict) or not isinstance(body.get("modules"), list) \
            or not isinstance(media, list) or not all(isinstance(m, dict) for m in media):
        raise Denied("This course export is damaged.", 400, "invalid_import")
    return manifest, body, media


def import_upload(sedens, actor, stream, length, attest: bool, attestation_version: str) -> dict:
    with sedens.db() as db:
        courses.creator_of(sedens, db, actor)
    if not 0 < length <= MAX_ARCHIVE:
        raise Denied("Choose a course export up to 400 MB.", 413, "import_too_large")
    with tempfile.TemporaryFile() as f:
        remaining = length
        while remaining:
            block = stream.read(min(65536, remaining))
            if not block:
                raise Denied("The upload was interrupted. Choose the file and try again.", 400, "upload_interrupted")
            f.write(block)
            remaining -= len(block)
        f.seek(0)
        try:
            with zipfile.ZipFile(f) as z:
                return import_archive(sedens, actor, z, attest, attestation_version)
        except zipfile.BadZipFile as exc:
            raise Denied("Choose a SEDENS course export.", 400, "invalid_import") from exc


def import_archive(sedens, actor, z, attest: bool, attestation_version: str) -> dict:
    """A new draft from an export, through the Creator Studio's own validation."""
    _, body, media = validate(z)
    needs_files = [m for m in media if m.get("file")]
    if needs_files and (not attest or attestation_version != course_media.ATTESTATION_VERSION):
        raise Denied("Confirm that you own the course's files or have permission to distribute them.", 400,
                     "attestation_required")
    created_files = []
    try:
        # Files first (outside the course transaction): each passes the upload checks.
        new_media = {}
        for m in media:
            if m.get("source") == "repo":
                with sedens.db() as db:
                    new_media[m["id"]] = course_media.add_repo_asset(sedens, db, actor, m.get("repo_asset"))["id"]
                continue
            name = m.get("file")
            if not name or name not in z.namelist():
                continue
            rights = dict(m.get("rights") or {})
            rights.update(attest=True, attestation_version=course_media.ATTESTATION_VERSION)
            if rights.get("licence_type") == "repo_owned":
                rights["licence_type"] = "other"
            info = z.getinfo(name)
            with z.open(info) as source:
                stored = course_media.upload(sedens, actor, source, info.file_size, m.get("kind"),
                                             m.get("filename", ""), rights, m.get("title", ""))
            created_files.append(stored["id"])
            new_media[m["id"]] = stored["id"]
        with sedens.batch(), sedens.db() as db:
            return _build(sedens, db, actor, body, new_media)
    except BaseException:
        if created_files:
            with sedens.db() as db:
                for object_id in created_files:
                    row = db.execute("SELECT object_key FROM s_media_objects WHERE id=?", (object_id,)).fetchone()
                    db.execute("DELETE FROM s_media_objects WHERE id=?", (object_id,))
                    if row and row[0]:
                        media_store.object_path(sedens.repo, row[0]).unlink(missing_ok=True)
        raise


def _build(sedens, db, actor, body, new_media):
    meta = body["course"]
    view = courses.create(sedens, db, actor, {**meta, "title": str(meta.get("title") or "Imported course")[:120]})
    cid = view["course"]["id"]

    def media(old):
        return new_media.get(old) if old else None

    if media(body.get("cover_media_id")):
        view = courses.update(sedens, db, actor, {"id": cid, "revision": view["revision"],
                                                  "cover_media_id": media(body["cover_media_id"])})
    for module in body["modules"][: courses.MAX_MODULES]:
        if not isinstance(module, dict):
            raise Denied("This course export is damaged.", 400, "invalid_import")
        view = courses.save_module(sedens, db, actor, {"course_id": cid, "revision": view["revision"],
                                                       "title": module.get("title"), "summary": module.get("summary", "")})
        module_id = view["modules"][-1]["id"]
        for session in module.get("sessions", []) or []:
            view = courses.save_session(sedens, db, actor, {
                "course_id": cid, "revision": view["revision"], "module_id": module_id, "title": session.get("title"),
                "summary": session.get("summary", ""), "estimated_minutes": session.get("estimated_minutes")})
            session_id = view["modules"][-1]["sessions"][-1]["id"]
            steps = {}
            ordered = sorted(session.get("steps", []) or [], key=lambda s: s.get("variant_of") is not None)
            for step in ordered:
                exercise = step.get("exercise") or {}
                data = {k: step.get(k) for k in ("phase", "title", "sets", "reps", "hold_seconds", "work_seconds",
                                                  "rest_seconds", "sides", "regression", "progression",
                                                  "customer_cue", "narration", "equipment", "advance", "variant",
                                                  "atlas_depth")}
                view = courses.save_step(sedens, db, actor, {
                    **data, "course_id": cid, "revision": view["revision"], "session_id": session_id,
                    "exercise_source": exercise.get("source"), "exercise_ref": exercise.get("ref"),
                    "video_media_id": media(step.get("video_media_id")),
                    "image_media_id": media(step.get("image_media_id")),
                    "variant_of": steps.get(step.get("variant_of")) if step.get("variant_of") else None})
                steps[step.get("id")] = view["saved_step_id"]
                view = courses.save_anatomy(sedens, db, actor, {
                    "course_id": cid, "revision": view["revision"], "step_id": view["saved_step_id"],
                    "structures": step.get("anatomy", []), "timeline": step.get("timeline", [])})
        for lesson in module.get("lessons", []) or []:
            exercise = lesson.get("exercise") or {}
            view = courses.save_lesson(sedens, db, actor, {
                "course_id": cid, "revision": view["revision"], "module_id": module_id, "kind": lesson.get("kind"),
                "title": lesson.get("title"), "body": lesson.get("body", ""), "media_id": media(lesson.get("media_id")),
                "exercise_source": exercise.get("source"), "exercise_ref": exercise.get("ref"),
                "detail": lesson.get("detail") if isinstance(lesson.get("detail"), dict) else {}})
    sedens.audit(db, actor.org_id, actor.user_id, "course:import", cid)
    return courses.editor_view(sedens, db, actor, cid)
