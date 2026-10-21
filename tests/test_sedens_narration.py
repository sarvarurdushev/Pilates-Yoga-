"""Creator narration (Phase 4, Part 10): the 0022 migration, recorded narration as an
'audio' course file, timed narration cues on guided-training steps, and what the room
player receives for course and SEDENS Standard steps.

All people, facilities, courses and recordings are fictional; recordings are short
sine tones generated with ffmpeg.
"""

from __future__ import annotations

import io
import shutil
import sqlite3
import subprocess
from zipfile import ZipFile

import pytest

from pilates.platform.repository import Repository
from pilates.sedens import access, course_export, course_media, courses, media_store, migrations, standard, workouts
from pilates.sedens.util import Denied
from course_support import (approve, build_guided, coach_creator, customer, facility, facility_setting, make_sedens,
                            publish, room_for, sedens_staff, submit)
from sedens_support import pair
from test_sedens_room_plans import visit
from test_sedens_room_workouts import course_visit, standard_workout, workout_row

RIGHTS = {"attest": True, "attestation_version": course_media.ATTESTATION_VERSION, "licence_type": "own_work",
          "original_creator": "Minji Lee", "identifiable_person": "none"}
MEDIA_CHILDREN = ("s_media_rights", "s_verification_evidence", "s_courses", "s_course_steps", "s_course_lessons",
                  "s_course_version_media")
needs_ffmpeg = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg is not installed")


# == 0022: the s_media_objects rebuild ==========================================================


def _to_0021(path):
    """A platform database with SEDENS migrations 0001-0021 only."""
    Repository(path)
    folder = path.parent / "migrations-0021"
    folder.mkdir()
    for version, name, sql in migrations.available():
        if version <= 21:
            (folder / f"{version:04d}_{name}.sql").write_text(sql)
    conn = sqlite3.connect(path)
    conn.execute("PRAGMA foreign_keys=ON")
    assert max(migrations.migrate(conn, folder)) == 21
    return conn


def _populate(db):
    """Every kind of reference to s_media_objects, as Phase 1-3 code writes them."""
    stamp = "2026-10-01T09:00:00+00:00"
    db.executescript(f"""
    INSERT INTO p_organizations(id,name,demo,created_at) VALUES ('org-a','Studio A',0,'{stamp}'), ('org-b','Studio B',0,'{stamp}');
    INSERT INTO p_users(id,org_id,name,email) VALUES ('u-coach','org-a','Coach','c@example.test'),
      ('u-rev','org-b','Reviewer','r@example.test'), ('u-two','org-b','Second coach','t@example.test');
    INSERT INTO s_creator_profiles(id,user_id,display_name,creator_type,slug,created_at,updated_at) VALUES
      ('cp-1','u-coach','Minji Lee','coach','minji','{stamp}','{stamp}'),
      ('cp-2','u-two','Second Coach','coach','second','{stamp}','{stamp}');
    """)
    media = [("m-video", "org-a", "cp-1", "creator_upload", "video", "video/mp4", "org-a/1.mp4", None),
             ("m-webm", "org-a", "cp-1", "creator_upload", "video", "video/webm", "org-a/2.webm", None),
             ("m-cover", "org-a", "cp-1", "creator_upload", "image", "image/png", "org-a/3.png", None),
             ("m-step-img", "org-a", "cp-1", "creator_upload", "image", "image/jpeg", "org-a/4.jpg", None),
             ("m-pdf", "org-a", "cp-1", "creator_upload", "pdf", "application/pdf", "org-a/5.pdf", None),
             ("m-repo", "org-a", "cp-1", "repo", "image", "image/png", None, "repo-bridge"),
             ("m-evidence", "org-b", "cp-2", "creator_upload", "pdf", "application/pdf", "org-b/6.pdf", None),
             ("m-retired", "org-b", None, "creator_upload", "image", "image/webp", "org-b/7.webp", None)]
    for n, (mid, org, creator, source, kind, mime, key, asset) in enumerate(media):
        db.execute("INSERT INTO s_media_objects(id,owner_org_id,creator_id,uploaded_by,source,kind,mime,size,sha256,"
                   "object_key,repo_asset,original_filename,title,width,height,state,created_at) "
                   "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                   (mid, org, creator, "u-coach" if org == "org-a" else None, source, kind, mime, 1000 + n, f"{n:064x}",
                    key, asset, f"file-{n}", f"Title {n}", 32 if kind == "image" else None,
                    24 if kind == "image" else None, "retired" if mid == "m-retired" else "ready", stamp))
        db.execute("INSERT INTO s_media_rights(object_id,licence_type,original_creator,identifiable_person,"
                   "attestation_version,attested_by,attested_at,review_status,reviewed_by,reviewed_at,review_note) "
                   "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                   (mid, "repo_owned" if source == "repo" else "own_work", "Minji Lee", "none", "2026-10-v1",
                    "u-coach", stamp, "approved" if n % 2 else "unreviewed", "u-rev" if n % 2 else None,
                    stamp if n % 2 else None, "ok" if n % 2 else ""))
    db.executescript(f"""
    INSERT INTO s_verification_evidence(id,creator_id,kind,description,url,object_id,created_at) VALUES
      ('ev-1','cp-2','qualification','Certificate','', 'm-evidence','{stamp}'),
      ('ev-2','cp-1','other','A link only','https://example.test/x', NULL,'{stamp}');
    INSERT INTO s_courses(id,owner_org_id,creator_id,course_type,language,title,cover_media_id,published_version,created_at,updated_at)
      VALUES ('c-guided','org-a','cp-1','guided_training','en','Core Basics','m-cover',1,'{stamp}','{stamp}'),
             ('c-edu','org-a','cp-1','professional_education','en','Mobility','m-repo',NULL,'{stamp}','{stamp}');
    INSERT INTO s_course_modules(id,course_id,position,title,created_at,updated_at) VALUES
      ('mod-1','c-guided',0,'Week 1','{stamp}','{stamp}'), ('mod-2','c-edu',0,'Joints','{stamp}','{stamp}');
    INSERT INTO s_course_sessions(id,course_id,module_id,position,title,created_at,updated_at) VALUES
      ('ses-1','c-guided','mod-1',0,'Session 1','{stamp}','{stamp}');
    INSERT INTO s_course_steps(id,course_id,session_id,position,exercise_source,exercise_ref,reps,narration,
                               video_media_id,image_media_id,variant_of,variant,created_at,updated_at) VALUES
      ('st-1','c-guided','ses-1',0,'standard','std-breathing',6,'Breathe in. Breathe out.','m-video','m-step-img',NULL,'standard','{stamp}','{stamp}'),
      ('st-2','c-guided','ses-1',1,'standard','std-pelvic-curl',8,'','m-webm',NULL,NULL,'standard','{stamp}','{stamp}'),
      ('st-3','c-guided','ses-1',2,'standard','std-imprint-release',6,'',NULL,'m-step-img','st-2','easier','{stamp}','{stamp}'),
      ('st-4','c-guided','ses-1',3,'standard','std-dead-bug',6,'',NULL,NULL,NULL,'standard','{stamp}','{stamp}');
    INSERT INTO s_course_lessons(id,course_id,module_id,position,kind,title,media_id,created_at,updated_at) VALUES
      ('l-1','c-edu','mod-2',0,'pdf','Reading','m-pdf','{stamp}','{stamp}'),
      ('l-2','c-edu','mod-2',1,'video','Watch','m-video','{stamp}','{stamp}'),
      ('l-3','c-edu','mod-2',2,'article','Text',NULL,'{stamp}','{stamp}');
    INSERT INTO s_course_versions(id,course_id,version,state,snapshot,snapshot_sha256,submitted_at) VALUES
      ('v-1','c-guided',1,'published','{{}}','x','{stamp}'), ('v-2','c-guided',2,'submitted','{{}}','y','{stamp}');
    INSERT INTO s_course_version_media(version_id,object_id) VALUES
      ('v-1','m-video'),('v-1','m-cover'),('v-1','m-step-img'),('v-1','m-retired'),('v-2','m-webm'),('v-2','m-cover');
    """)
    db.commit()


def _tables(db):
    return [r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' "
                                     "AND name<>'s_schema' ORDER BY name")]


def _contents(db, columns_of=None):
    """Every row of every table (rowid first), by column name; ``columns_of`` limits the
    columns to those a table had before."""
    out = {}
    for table in _tables(db):
        columns = columns_of[table] if columns_of else [r[1] for r in db.execute(f'PRAGMA table_info("{table}")')]
        names = ", ".join(f'"{c}"' for c in columns)
        out[table] = db.execute(f'SELECT rowid, {names} FROM "{table}" ORDER BY rowid').fetchall()
    return out


def _schema(db):
    return {(r[0], r[1]): r[2] for r in db.execute("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'")}


def test_0022_rebuilds_s_media_objects_keeping_every_row_and_reference(tmp_path):
    path = tmp_path / "s.db"
    db = _to_0021(path)
    _populate(db)
    columns = {t: [r[1] for r in db.execute(f'PRAGMA table_info("{t}")')] for t in _tables(db)}
    before, schema_before = _contents(db), _schema(db)
    counts = {t: len(rows) for t, rows in before.items()}
    assert counts["s_media_objects"] == 8 and counts["s_course_version_media"] == 6 and counts["s_media_rights"] == 8

    # The real runner on a foreign-keys-ON connection, as Sedens() opens it.
    assert migrations.migrate(db) == [22]
    db.row_factory = None

    assert _contents(db, columns) == before  # every table, every row, every value, rowids included
    assert db.execute("PRAGMA foreign_key_check").fetchall() == []
    assert db.execute("PRAGMA integrity_check").fetchall() == [("ok",)]
    schema_after = _schema(db)
    # Child tables, their indexes and triggers (s_course_versions_frozen) are untouched,
    # so they still refer to s_media_objects by name; only the two changed tables differ.
    changed = {k for k in set(schema_before) | set(schema_after) if schema_before.get(k) != schema_after.get(k)}
    assert changed == {("table", "s_media_objects"), ("table", "s_course_steps")}
    for table in MEDIA_CHILDREN:
        assert "REFERENCES s_media_objects" in schema_after[("table", table)]
        assert {r[2] for r in db.execute(f"PRAGMA foreign_key_list({table})")} >= {"s_media_objects"}
    assert ("index", "s_media_objects_owner") in schema_after
    assert ("trigger", "s_course_versions_frozen") in schema_after
    assert not [k for k in schema_after if "0022" in k[1]]  # no leftover copy or guard table
    assert "narration_audio_media_id TEXT REFERENCES s_media_objects ON DELETE SET NULL" in \
        schema_after[("table", "s_course_steps")]
    assert set(r[0] for r in db.execute("SELECT narration_cues FROM s_course_steps")) == {"[]"}

    # The new CHECK accepts audio and still refuses anything else.
    insert = ("INSERT INTO s_media_objects(id,owner_org_id,source,kind,mime,size,sha256,object_key,created_at) "
              "VALUES (?,?,?,?,?,?,?,?,?)")
    db.execute(insert, ("m-audio", "org-a", "creator_upload", "audio", "audio/mpeg", 10, "a", "org-a/8.mp3", "t"))
    for kind, mime in (("audio", "audio/wav"), ("midi", "audio/mpeg"), ("audio", "text/html")):
        with pytest.raises(sqlite3.IntegrityError):
            db.execute(insert, ("m-bad", "org-a", "creator_upload", kind, mime, 10, "b", "org-a/9", "t"))
    db.execute("UPDATE s_course_steps SET narration_audio_media_id='m-audio' WHERE id='st-4'")
    with pytest.raises(sqlite3.IntegrityError):
        db.execute("UPDATE s_course_steps SET narration_audio_media_id='nothing' WHERE id='st-4'")

    # The foreign keys still act on the new table: deleting a file cascades and nulls as before.
    db.execute("DELETE FROM s_media_objects WHERE id IN ('m-video','m-audio')")
    assert db.execute("SELECT video_media_id, narration_audio_media_id FROM s_course_steps WHERE id IN ('st-1','st-4') "
                      "ORDER BY id").fetchall() == [(None, None), (None, None)]
    assert db.execute("SELECT count(*) FROM s_media_rights WHERE object_id='m-video'").fetchone() == (0,)
    assert db.execute("SELECT count(*) FROM s_course_version_media WHERE object_id='m-video'").fetchone() == (0,)
    assert db.execute("SELECT media_id FROM s_course_lessons WHERE id='l-2'").fetchone() == (None,)
    db.rollback()
    db.close()

    # A server opening the migrated file applies nothing more, and the services still work.
    sedens = make_sedens(path)
    assert sedens.applied == []


def test_the_suggested_rename_rebuild_would_have_lost_rows():
    """Why 0022 does not rename: with foreign keys ON, renaming the old table rewrites the
    children's REFERENCES even with legacy_alter_table=ON, and dropping it cascades."""
    db = sqlite3.connect(":memory:", isolation_level=None)
    db.execute("PRAGMA foreign_keys=ON")
    db.executescript("CREATE TABLE p(id TEXT PRIMARY KEY); CREATE TABLE c(id TEXT REFERENCES p ON DELETE CASCADE);"
                     "INSERT INTO p VALUES ('x'); INSERT INTO c VALUES ('x');")
    db.executescript("BEGIN; CREATE TABLE p_new(id TEXT PRIMARY KEY); INSERT INTO p_new SELECT * FROM p;"
                     "PRAGMA legacy_alter_table=ON; ALTER TABLE p RENAME TO p_old; ALTER TABLE p_new RENAME TO p;"
                     "DROP TABLE p_old; COMMIT;")
    assert db.execute("SELECT count(*) FROM c").fetchone() == (0,)


def test_0022_keeps_a_reference_that_was_already_dangling_without_blocking_the_upgrade(tmp_path):
    """A row written long ago with foreign keys off may point at a file that is gone. 0022 does
    not fix or hide it, and it does not refuse to start because of it either."""
    path = tmp_path / "s.db"
    db = _to_0021(path)
    _populate(db)
    db.execute("PRAGMA foreign_keys=OFF")
    db.execute("UPDATE s_course_steps SET image_media_id='ghost' WHERE id='st-4'")
    db.commit()
    db.execute("PRAGMA foreign_keys=ON")
    assert migrations.migrate(db) == [22]
    assert db.execute("SELECT image_media_id FROM s_course_steps WHERE id='st-4'").fetchone() == ("ghost",)
    assert [r[0] for r in db.execute("PRAGMA foreign_key_check")] == ["s_course_steps"]
    assert db.execute("SELECT count(*) FROM s_media_objects").fetchone() == (8,)


def test_0022_on_a_connection_without_foreign_keys_and_on_an_empty_database():
    """backup_verify migrates a fresh in-memory database with foreign keys off."""
    from pathlib import Path

    db = sqlite3.connect(":memory:")
    db.executescript((Path(__file__).resolve().parents[1] / "pilates/platform/schema.sql").read_text())
    assert 22 in migrations.migrate(db)
    assert db.execute("PRAGMA integrity_check").fetchall() == [("ok",)]
    assert "'audio'" in db.execute("SELECT sql FROM sqlite_master WHERE name='s_media_objects'").fetchone()[0]


# == recordings: byte checks =================================================================


def _tone(folder, name, *args, video=False):
    out = folder / name
    source = ["-f", "lavfi", "-i", "sine=frequency=440:duration=1.5"]
    if video:
        source = ["-f", "lavfi", "-i", "testsrc=duration=1:size=64x48:rate=10", *source, "-shortest"]
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", *source, *args, str(out)], check=True)
    return out


@pytest.fixture(scope="module")
def recordings(tmp_path_factory):
    if shutil.which("ffmpeg") is None:
        pytest.skip("ffmpeg is not installed")
    folder = tmp_path_factory.mktemp("audio")
    return {
        "mp3": _tone(folder, "a.mp3", "-c:a", "libmp3lame"),
        "mp3_bare": _tone(folder, "bare.mp3", "-c:a", "libmp3lame", "-id3v2_version", "0", "-write_xing", "0"),
        "m4a": _tone(folder, "a.m4a", "-c:a", "aac"),
        "webm": _tone(folder, "a.weba", "-c:a", "libopus", "-f", "webm"),
        "ogg_vorbis": _tone(folder, "a.ogg", "-c:a", "libvorbis"),
        "ogg_opus": _tone(folder, "b.ogg", "-c:a", "libopus"),
        "video_mp4": _tone(folder, "v.mp4", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", video=True),
        "video_webm": _tone(folder, "v.webm", "-c:v", "libvpx", "-c:a", "libopus", video=True),
        # Videos whose first audio track is MP3 or Vorbis: each must still be refused as audio.
        "video_avc1": _tone(folder, "avc1.mp4", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "libmp3lame",
                            "-brand", "avc1", video=True),
        "video_m4v": _tone(folder, "fast.mp4", "-c:v", "mpeg4", "-c:a", "libmp3lame", "-movflags", "+faststart",
                           video=True),
        "video_mov": _tone(folder, "v.mov", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "libmp3lame", video=True),
        "video_mkv": _tone(folder, "v.mkv", "-c:v", "libvpx", "-c:a", "libmp3lame", video=True),
        "video_ogg": _tone(folder, "v.ogv", "-map", "1:a", "-map", "0:v", "-c:a", "libvorbis", "-c:v", "libtheora",
                           video=True),
    }


def _copy(path, folder, name):
    target = folder / name
    target.write_bytes(path.read_bytes())
    return target


@needs_ffmpeg
def test_recordings_are_recognised_by_their_bytes(recordings, tmp_path):
    expected = {"mp3": "audio/mpeg", "mp3_bare": "audio/mpeg", "m4a": "audio/mp4", "webm": "audio/webm",
                "ogg_vorbis": "audio/ogg", "ogg_opus": "audio/ogg"}
    for key, mime in expected.items():
        # The file name says nothing: every file is checked under a misleading name.
        assert media_store.check(_copy(recordings[key], tmp_path, f"{key}.wav"), "audio") == (mime, {})
    from PIL import Image

    jpeg = tmp_path / "photo.mp3"
    Image.new("RGB", (64, 48), (200, 10, 10)).save(jpeg, format="JPEG")
    pdf = tmp_path / "notes.m4a"
    pdf.write_bytes(b"%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n")
    noise = tmp_path / "noise.mp3"
    noise.write_bytes(bytes([0xFF, 0xFB, 0x90, 0x64]) + bytes(range(256)) * 20)
    mp3 = recordings["mp3_bare"].read_bytes()
    html = tmp_path / "page.mp3"
    html.write_bytes(b"<html><script>alert(1)</script>" + mp3)
    pdf_mp3 = tmp_path / "doc.mp3"
    pdf_mp3.write_bytes(b"%PDF-1.4\n" + mp3)
    padded = tmp_path / "padded.mp3"
    padded.write_bytes(bytes(300) + mp3)
    assert media_store.check(padded, "audio") == ("audio/mpeg", {})
    # moov > trak > ... nested far deeper than a real file: refused, not a crash.
    def box(kind, body):
        return (8 + len(body)).to_bytes(4, "big") + kind + body
    nested = box(b"hdlr", bytes(8) + b"soun" + bytes(12))
    for _ in range(3000):
        nested = box(b"trak", nested)
    deep = tmp_path / "deep.m4a"
    deep.write_bytes(box(b"ftyp", b"M4A " + bytes(4)) + box(b"moov", nested))
    videos = [_copy(recordings[key], tmp_path, f"film-{key}.m4a")
              for key in ("video_mp4", "video_webm", "video_avc1", "video_m4v", "video_mov", "video_mkv", "video_ogg")]
    for path in (jpeg, pdf, noise, html, pdf_mp3, deep, *videos):
        with pytest.raises(Denied) as refused:
            media_store.check(path, "audio")
        assert (refused.value.status, refused.value.code) == (415, "media_type_mismatch")
    # A recording is not a video either.
    with pytest.raises(Denied):
        media_store.check(_copy(recordings["mp3"], tmp_path, "x.mp4"), "video")


def test_recording_size_limits_follow_the_deployment_mode():
    assert media_store.limit("demo_free", "audio") == 8 * 1024 * 1024
    assert media_store.limit("local_room", "audio") == 30 * 1024 * 1024
    assert media_store.limit("anything_else", "audio") == media_store.limit("demo_free", "audio")
    with pytest.raises(Denied) as refused:
        media_store._capped("audio", 8 * 1024 * 1024 + 1, "demo_free")
    assert refused.value.code == "media_too_large"


# == recordings: upload, rights and who may play them ==========================================


class Exploding(io.BytesIO):
    def read(self, *a):
        raise AssertionError("the body must not be read before the rights are checked")


@pytest.fixture()
def world(tmp_path):
    sedens = make_sedens(tmp_path / "s.db")
    _, reviewer, _ = sedens_staff(sedens)
    a = facility(sedens, "A")
    return sedens, reviewer, a, coach_creator(sedens, a)


def upload_audio(sedens, actor, path, filename="narration.mp3", rights=RIGHTS):
    body = path.read_bytes()
    return course_media.upload(sedens, actor, io.BytesIO(body), len(body), "audio", filename, rights, "Step narration")


@needs_ffmpeg
def test_a_recording_needs_rights_and_the_attestation_like_any_file(world, recordings):
    sedens, _, _, coach = world
    for rights in (None, {**RIGHTS, "attest": False}, {**RIGHTS, "attestation_version": "old"},
                   {**RIGHTS, "licence_type": "repo_owned"}, {**RIGHTS, "original_creator": ""}):
        with pytest.raises(Denied):
            course_media.upload(sedens, coach, Exploding(), 100, "audio", "a.mp3", rights)
    # The browser's name and type are ignored: an MP3 named .ogg is stored as an MP3.
    media = upload_audio(sedens, coach, recordings["mp3"], filename="voice.ogg")
    assert (media["kind"], media["mime"], media["filename"]) == ("audio", "audio/mpeg", "voice.ogg")
    assert media["rights"]["review_status"] == "unreviewed" and media["rights"]["attested_at"]
    with sedens.db() as db:
        key = db.execute("SELECT object_key FROM s_media_objects WHERE id=?", (media["id"],)).fetchone()[0]
    assert key.endswith(".mp3")


def _cue(text, at, speak=True):
    return {"text": text, "at_seconds": at, "speak": speak}


CUES_V1 = [_cue("Lie on your back with your knees bent.", 0), _cue("Ribs soft.", 2, False),
           _cue("Breathe out and lift slowly.", 8), _cue("Keep the neck long.", 20, False)]


def save_narration(sedens, coach, view, step_index=0, **fields):
    step = view["modules"][0]["sessions"][0]["steps"][step_index]
    keep = {k: step[k] for k in ("id", "phase", "sets", "reps", "hold_seconds", "work_seconds", "rest_seconds",
                                 "sides", "customer_cue", "narration", "video_media_id", "image_media_id")}
    with sedens.db() as db:
        return courses.save_step(sedens, db, coach, {
            **keep, **fields, "course_id": view["course"]["id"], "revision": view["revision"],
            "session_id": view["modules"][0]["sessions"][0]["id"], "exercise_source": step["exercise"]["source"],
            "exercise_ref": step["exercise"]["ref"]})


@needs_ffmpeg
def test_recorded_narration_plays_only_in_an_authorized_room(world, recordings):
    sedens, reviewer, a, coach = world
    audio = upload_audio(sedens, coach, recordings["m4a"], "voice.m4a")
    view = save_narration(sedens, coach, build_guided(sedens, coach), narration_cues=CUES_V1,
                          narration_audio_media_id=audio["id"])
    assert view["modules"][0]["sessions"][0]["steps"][0]["narration_audio_media_id"] == audio["id"]
    cid = view["course"]["id"]
    facility_setting_args = [{"org_id": a["org_id"], "free": True}]
    other = facility(sedens, "X")
    rooms = {"own": room_for(sedens, a), "other": room_for(sedens, other)}

    def readers():
        with sedens.db() as db:
            out = set()
            people = {"creator": coach, "reviewer": reviewer, "customer phone": customer(sedens, a),
                      "facility admin": a["admin"], "other admin": other["admin"]}
            for who, actor in people.items():
                try:
                    access.media_access(sedens, db, actor, None, audio["id"])
                    out.add(who)
                except Denied as refused:
                    assert refused.status == 404
            for who, room in rooms.items():
                try:
                    found = access.media_access(sedens, db, None, room, audio["id"])
                    assert found["download"] is False
                    out.add(f"room {who}")
                except Denied as refused:
                    assert refused.status == 404
            return out

    assert readers() == {"creator"}  # a draft's file
    view = submit(sedens, coach, courses_set_access(sedens, coach, view, facility_setting_args))
    assert readers() == {"creator", "reviewer"}  # submitted, not yet published: no room
    approve(sedens, reviewer, cid)
    assert readers() == {"creator", "reviewer"}  # published, but not enabled in any room yet
    facility_setting(sedens, a, cid, enabled=True, included=True)
    # Only the room of the facility that enabled it; never the customer's phone or a facility account.
    assert readers() == {"creator", "reviewer", "room own"}


def courses_set_access(sedens, coach, view, facilities):
    with sedens.db() as db:
        return courses.set_access(sedens, db, coach, {"id": view["course"]["id"], "revision": view["revision"],
                                                      "distribution": "selected_facilities", "facilities": facilities,
                                                      "price": {"price_type": "free"}})


@needs_ffmpeg
def test_a_step_takes_only_the_creators_own_recording(world, recordings, tmp_path):
    sedens, _, a, coach = world
    colleague = coach_creator(sedens, facility(sedens, "B"), "Other coach")
    theirs = upload_audio(sedens, colleague, recordings["mp3"])
    mine = upload_audio(sedens, coach, recordings["ogg_opus"], "voice.ogg")
    view = build_guided(sedens, coach)
    with pytest.raises(Denied) as refused:
        save_narration(sedens, coach, view, narration_audio_media_id=theirs["id"])
    assert refused.value.code == "unknown_media"
    with pytest.raises(Denied) as refused:
        save_narration(sedens, coach, view, video_media_id=mine["id"])
    assert (refused.value.code, str(refused.value)) == ("wrong_media_kind", "Choose a video here.")
    with sedens.db() as db:
        course_media.retire(sedens, db, coach, mine["id"])
    with pytest.raises(Denied) as refused:
        save_narration(sedens, coach, view, narration_audio_media_id=mine["id"])
    assert refused.value.code == "unknown_media"


# == cues ========================================================================================


def test_narration_cues_are_validated_with_plain_messages(world):
    sedens, _, _, coach = world
    view = build_guided(sedens, coach)  # std-breathing, 6 reps, 15 s rest
    step = view["modules"][0]["sessions"][0]["steps"][0]
    bound = courses.step_seconds(step)
    assert bound == 20 + 15 + 6 * standard.get("std-breathing")["seconds_per_rep"] + 15
    cases = [
        ([_cue(f"Line {n}.", n * 5) for n in range(13)], "invalid_narration", "Narration: add up to 12 lines."),
        ([_cue("x" * 161, 0)], "invalid_narration", "Keep each narration line to 160 characters."),
        ([_cue("  ", 0)], "invalid_narration", "Each narration line needs its words."),
        ([_cue("Too late.", bound + 1)], "invalid_narration",
         f"Set each narration line's time between 0 and {bound} seconds, the length of this step."),
        ([_cue("Before it starts.", -1)], "invalid_narration", None),
        ([_cue("Not a time.", "soon")], "invalid_narration", None),
        ([_cue("A flag.", True)], "invalid_narration", None),
        ([{"text": "Spoken?", "at_seconds": 0, "speak": "yes"}], "invalid_narration",
         "Choose whether each narration line is spoken or shown only as a subtitle."),
        (["just text"], "invalid_narration", "Each narration line needs its words, its time and whether it is spoken."),
        ([{"text": ["a"], "at_seconds": 0, "speak": True}], "invalid_narration", "Each narration line needs its words."),
        ([{"text": {"en": "a"}, "at_seconds": 0, "speak": True}], "invalid_narration", None),
        ("not a list", "invalid_narration", None),
        ([_cue("One.", 0), _cue("Two.", 3.5)], "narration_too_close",
         "Leave at least 4 seconds between spoken lines, or show one as a subtitle only."),
        ([_cue("This cures back pain.", 0)], "medical_claim_wording", None),
    ]
    for cues, code, message in cases:
        with pytest.raises(Denied) as refused:
            save_narration(sedens, coach, view, narration_cues=cues)
        assert refused.value.code == code, cues
        if message:
            assert str(refused.value) == message
    # Close lines are fine when only one is spoken; lines are kept in time order.
    view = save_narration(sedens, coach, view, narration_cues=[
        _cue("Exhale and lift.", 12.25), _cue("Start lying down.", 0), _cue("Ribs soft.", 2, False),
        _cue("Lower slowly.", bound, False)])
    saved = view["modules"][0]["sessions"][0]["steps"][0]
    assert saved["narration_cues"] == [_cue("Start lying down.", 0), _cue("Ribs soft.", 2, False),
                                       _cue("Exhale and lift.", 12.2), _cue("Lower slowly.", bound, False)]
    # An editor that does not send the cues (an older page) keeps them; an empty list clears them.
    view = save_narration(sedens, coach, view, customer_cue="Slowly.")
    assert len(view["modules"][0]["sessions"][0]["steps"][0]["narration_cues"]) == 4
    # ... but kept lines are checked against the step's new length: a shorter step refuses the last line.
    with pytest.raises(Denied) as refused:
        save_narration(sedens, coach, view, reps=2)
    assert refused.value.code == "invalid_narration"
    # Line breaks and other control characters become single spaces.
    view = save_narration(sedens, coach, view, narration_cues=[_cue("Breathe\n in.\t\x00 Slowly.", 0)])
    assert view["modules"][0]["sessions"][0]["steps"][0]["narration_cues"] == [_cue("Breathe in. Slowly.", 0)]
    view = save_narration(sedens, coach, view, narration_cues=[])
    assert view["modules"][0]["sessions"][0]["steps"][0]["narration_cues"] == []


# == the room player ===========================================================================


@pytest.fixture()
def course_world(tmp_path):
    sedens = make_sedens(tmp_path / "s.db")
    _, reviewer, _ = sedens_staff(sedens)
    fac = facility(sedens, "A")
    coach = coach_creator(sedens, fac)
    return sedens, reviewer, fac, coach, pair(sedens, fac)


@needs_ffmpeg
def test_course_steps_play_the_enrolled_versions_cues_and_recording(course_world, recordings):
    sedens, reviewer, fac, coach, device = course_world
    audio = upload_audio(sedens, coach, recordings["mp3"])
    view = build_guided(sedens, coach, "Core Basics", steps=("std-pelvic-curl", "std-breathing"))
    view = save_narration(sedens, coach, view, narration_cues=CUES_V1, narration_audio_media_id=audio["id"])
    view = save_narration(sedens, coach, view, step_index=1, narration="Breathe in. Breathe out slowly.")
    view = publish(sedens, coach, reviewer, view, "selected_facilities", [{"org_id": fac["org_id"], "free": True}])
    cid = view["course"]["id"]
    facility_setting(sedens, fac, cid, enabled=True, included=True)
    with sedens.db() as db:
        snapshot = courses.version(db, cid, 1)["snapshot"]
        assert audio["id"] in snapshot["media"]
        assert db.execute("SELECT 1 FROM s_course_version_media m JOIN s_course_versions v ON v.id=m.version_id "
                          "WHERE v.course_id=? AND m.object_id=?", (cid, audio["id"])).fetchone()
    step = snapshot["modules"][0]["sessions"][0]["steps"][0]
    assert step["narration_cues"] == CUES_V1 and step["narration_audio"]["kind"] == "audio"

    v = course_visit(sedens, fac, device)
    v.act("course/start", course_id=cid)
    first, second = (s["content"] for s in v.view["workout"]["steps"])
    assert first["narration_mode"] == "timed"
    assert first["narration_cues"] == [{"text": "Lie on your back with your knees bent.", "at_ms": 0, "speak": True},
                                       {"text": "Ribs soft.", "at_ms": 2000, "speak": False},
                                       {"text": "Breathe out and lift slowly.", "at_ms": 8000, "speak": True},
                                       {"text": "Keep the neck long.", "at_ms": 20000, "speak": False}]
    assert first["narration"] == ["Lie on your back with your knees bent.", "Breathe out and lift slowly."]
    assert first["narration_audio"]["url"] == f"/sedens/media/file?id={audio['id']}"
    assert (first["narration_audio"]["kind"], first["narration_audio"]["mime"]) == ("audio", "audio/mpeg")
    # A step without cues keeps its narration text exactly as before.
    assert second["narration_mode"] == "sequence" and second["narration_audio"] is None
    assert second["narration"] == ["Breathe in.", "Breathe out slowly."]
    assert second["narration_cues"] == [{"text": "Breathe in.", "at_ms": 0, "speak": True},
                                        {"text": "Breathe out slowly.", "at_ms": 0, "speak": True}]
    with sedens.db() as db:  # the recording is served to this room
        assert access.media_access(sedens, db, None, v.ctx, audio["id"])["object"]["kind"] == "audio"
    v.act("workout/cancel")
    v.leave()

    # Version 2 changes the cues and drops the recording; the enrolled customer keeps version 1's.
    with sedens.db() as db:
        editor = courses.editor_view(sedens, db, coach, cid)
    editor = save_narration(sedens, coach, editor, narration_cues=[_cue("New words.", 0)], narration_audio_media_id=None)
    approve(sedens, reviewer, submit(sedens, coach, editor)["course"]["id"])
    v = course_visit(sedens, fac, device)
    v.act("course/start", course_id=cid, session_id=view["modules"][0]["sessions"][0]["id"])
    assert workout_row(v)["course_version"] == 1
    kept = v.view["workout"]["steps"][0]["content"]
    assert [c["text"] for c in kept["narration_cues"]][0] == "Lie on your back with your knees bent."
    assert kept["narration_audio"]["url"].endswith(audio["id"])
    with sedens.db() as db:
        assert access.media_access(sedens, db, None, v.ctx, audio["id"])["object"]["id"] == audio["id"]
    other = course_visit(sedens, fac, pair(sedens, fac, name="Second screen"), token_key="other_token")
    other.act("course/start", course_id=cid)
    assert workout_row(other)["course_version"] == 2
    fresh = other.view["workout"]["steps"][0]["content"]
    assert fresh["narration_cues"] == [{"text": "New words.", "at_ms": 0, "speak": True}]
    assert fresh["narration_audio"] is None
    with sedens.db() as db, pytest.raises(Denied):  # version 2 has no recording, so its room gets none
        access.media_access(sedens, db, None, other.ctx, audio["id"])


def test_standard_steps_speak_a_few_lines_and_show_the_rest_as_subtitles(tmp_path):
    from test_sedens_room_plans import room_world

    sedens, fac, device = room_world(tmp_path, "local_room")
    v = visit(sedens, fac, device)
    workout = standard_workout(v)
    for step in workout["steps"]:
        content = step["content"]
        entry = standard.get(content["ref"])
        lines = [n["en"] for n in entry["narration"]]
        assert content["narration_mode"] == "timed" and content["narration_audio"] is None
        assert [c["text"] for c in content["narration_cues"]] == lines  # subtitles: every line
        spoken = [c for c in content["narration_cues"] if c["speak"]]
        assert spoken[0] == {"text": lines[0], "at_ms": 0, "speak": True}
        assert all(b["at_ms"] - a["at_ms"] >= 6000 for a, b in zip(spoken, spoken[1:]))
        assert len(spoken) <= workouts.STANDARD_MAX_SPOKEN
        assert all(c["at_ms"] <= step["planned_seconds"] * 1000 for c in spoken)
        assert content["narration"] == [c["text"] for c in spoken]


def test_cues_derived_for_a_short_standard_step_never_speak_past_it():
    cues = workouts._standard_cues(["One.", "Two.", "Three.", "Four."], 10)
    assert cues == [{"text": "One.", "at_ms": 0, "speak": True}, {"text": "Two.", "at_ms": 8000, "speak": True},
                    {"text": "Three.", "at_ms": 16000, "speak": False}, {"text": "Four.", "at_ms": 24000, "speak": False}]


def test_a_version_made_before_0022_plays_its_narration_text_as_before():
    """Snapshots frozen before narration cues existed have no cue fields at all."""
    old = {"id": "st-1", "exercise": {"source": "standard", "ref": "std-breathing"}, "title": "",
           "narration": "Lie down. Breathe in!\nBreathe out.", "customer_cue": "Slowly.", "reps": 6, "sets": 1}
    content = workouts._course_step(old, "en")
    assert content["narration"] == ["Lie down.", "Breathe in!", "Breathe out."]
    assert content["narration_mode"] == "sequence" and content["narration_audio"] is None
    assert [c["at_ms"] for c in content["narration_cues"]] == [0, 0, 0]
    assert workouts._course_step({**old, "narration": ""}, "en")["narration"] == ["Slowly."]


# == export and import ===========================================================================


@needs_ffmpeg
def test_cues_and_recording_travel_in_a_course_export(world, recordings):
    sedens, reviewer, a, coach = world
    audio = upload_audio(sedens, coach, recordings["webm"], "voice.weba")
    view = save_narration(sedens, coach, build_guided(sedens, coach), narration_cues=CUES_V1,
                          narration_audio_media_id=audio["id"])
    view = publish(sedens, coach, reviewer, view, "selected_facilities", [{"org_id": a["org_id"], "free": True}])
    importer = coach_creator(sedens, facility(sedens, "B"), "Importing coach")
    with course_export.export(sedens, coach, view["course"]["id"]) as (path, _), ZipFile(path) as z:
        assert f"media/{audio['id']}.weba" in z.namelist()
        imported = course_export.import_archive(sedens, importer, z, True, course_media.ATTESTATION_VERSION)
    step = imported["modules"][0]["sessions"][0]["steps"][0]
    assert step["narration_cues"] == CUES_V1
    assert step["narration_audio_media_id"] not in (None, audio["id"])
    with sedens.db() as db:
        copy = course_media.describe(db, step["narration_audio_media_id"])
    assert (copy["kind"], copy["mime"], copy["rights"]["review_status"]) == ("audio", "audio/webm", "unreviewed")


# == over HTTP =====================================================================================


@needs_ffmpeg
def test_over_http_a_recording_uploads_streams_with_ranges_and_cues_save(recordings, tmp_path):
    from test_sedens_course_http import build, demo, ok, raw, upload
    from pilates.sedens import http as sedens_http
    from sedens_support import running_server

    sedens_http._LIMITS.clear()
    sedens = make_sedens(tmp_path / "h.db", "demo_free")
    server, base = running_server(sedens.repo.path)
    try:
        creator = demo(base, "creator")
        body = recordings["ogg_vorbis"].read_bytes()
        status, refused = upload(creator, b"<html><script>alert(1)</script></html>", "audio", "a.mp3", RIGHTS)
        assert (status, refused["code"]) == (415, "media_type_mismatch")
        status, media = upload(creator, body, "audio", "voice.mp3", RIGHTS)
        assert status == 200 and (media["kind"], media["mime"]) == ("audio", "audio/ogg")
        status, headers, data = raw(creator, "GET", f"/sedens/media/file?id={media['id']}", headers={"Range": "bytes=0-99"})
        assert status == 206 and headers["Content-Type"] == "audio/ogg" and data == body[:100]
        assert headers["X-Content-Type-Options"] == "nosniff" and "Content-Disposition" not in headers
        view = build(creator, "Narrated basics")
        session = view["modules"][0]["sessions"][0]
        step = session["steps"][0]
        saved = ok(creator.call("POST", "/sedens/creator/course/step", {
            "course_id": view["course"]["id"], "revision": view["revision"], "session_id": session["id"],
            "id": step["id"], "exercise_source": step["exercise"]["source"], "exercise_ref": step["exercise"]["ref"],
            "reps": step["reps"] or 6, "narration_cues": CUES_V1, "narration_audio_media_id": media["id"]}))
        step = saved["modules"][0]["sessions"][0]["steps"][0]
        assert step["narration_cues"] == CUES_V1 and step["narration_audio_media_id"] == media["id"]
        status, refused = creator.call("POST", "/sedens/creator/course/step", {
            "course_id": view["course"]["id"], "revision": saved["revision"], "session_id": session["id"],
            "id": step["id"], "exercise_source": step["exercise"]["source"], "exercise_ref": step["exercise"]["ref"],
            "reps": 6, "narration_cues": [_cue("One.", 0), _cue("Two.", 1)]})
        assert status == 400 and refused["code"] == "narration_too_close" and "4 seconds" in refused["error"]
    finally:
        server.shutdown()
        server.server_close()


# == organization backups ==========================================================================


@needs_ffmpeg
def test_cues_and_recording_survive_an_organization_backup(world, recordings, tmp_path):
    import json

    from pilates.platform.backup import restore_archive
    from pilates.platform.backup_verify import verify_archive
    from course_support import professor_studio
    from test_sedens_backup import destroy, fresh_org, save

    sedens, reviewer, _, _ = world
    professor = professor_studio(sedens)
    audio = upload_audio(sedens, professor, recordings["mp3"])
    view = save_narration(sedens, professor, build_guided(sedens, professor, "Narrated"), narration_cues=CUES_V1,
                          narration_audio_media_id=audio["id"])
    publish(sedens, professor, reviewer, view, "marketplace")
    path = save(sedens.repo, professor, tmp_path / "studio.zip")
    assert verify_archive(path)["course_files"] == 1
    destroy(sedens, professor.org_id)
    owner = fresh_org(sedens, "studio")
    result = restore_archive(sedens.repo, owner, path)["sedens"]
    assert result["course_files"] == 1 and result["media_rights_to_review"] == 1
    with sedens.db() as db:
        [course] = courses.list_for_creator(sedens, db, owner)
        step = courses.editor_view(sedens, db, owner, course["id"])["modules"][0]["sessions"][0]["steps"][0]
        assert step["narration_cues"] == CUES_V1
        restored = db.execute("SELECT * FROM s_media_objects WHERE id=?", (step["narration_audio_media_id"],)).fetchone()
        assert restored["owner_org_id"] == owner.org_id and (restored["kind"], restored["mime"]) == ("audio", "audio/mpeg")
        assert media_store.object_path(sedens.repo, restored["object_key"]).read_bytes() == recordings["mp3"].read_bytes()
        snapshot = json.loads(db.execute("SELECT snapshot FROM s_course_versions WHERE course_id=?",
                                         (course["id"],)).fetchone()[0])
        frozen = snapshot["modules"][0]["sessions"][0]["steps"][0]
        assert frozen["narration_audio_media_id"] == restored["id"] and restored["id"] in snapshot["media"]
        assert frozen["narration_cues"] == CUES_V1
        assert not db.execute("PRAGMA foreign_key_check").fetchall()
