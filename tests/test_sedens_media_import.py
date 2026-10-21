"""The stock clip import workflow: a complete, checked entry is registered; anything else is refused.

Every test works in a temporary copy of the registry and the SEDENS Standard with a synthetic
manifest entry. The clip is the repository's own synthetic test pattern (tests/data/media/); no
real stock clip exists in this repository (docs/SEDENS_CONTENT_VIDEO_PLAN.md)."""

from __future__ import annotations

import copy
from datetime import date
import json
from pathlib import Path
import shutil

import pytest

from pilates.sedens import media_import

REPO = Path(__file__).resolve().parents[1]
CLIP = REPO / "tests" / "data" / "media" / "sedens-test-pattern-a.mp4"
TODAY = date(2026, 10, 21)


def entry_for(clip: Path = CLIP, **changes) -> dict:
    entry = {
        "id": "synthetic-pelvic-curl",
        "source": "pexels",
        "page_url": "https://www.pexels.com/video/synthetic-example-1/",
        "file_url": "https://videos.pexels.com/video-files/1/synthetic-example.mp4",
        "licence_url": "https://www.pexels.com/license/",
        "licence": "pexels",
        "original_creator": "A Synthetic Creator",
        "retrieved_at": "2026-10-20",
        "sha256": media_import.sha256_of(clip),
        "shows_exercise": "std-pelvic-curl",
        "checked_by": "Dana Reviewer",
        "checked_at": "2026-10-21",
        "movement_notes": "Side view, slow curl up and down, full roll through the spine, no cuts.",
        "identifiable_person": "no",
    }
    entry.update(changes)
    return entry


@pytest.fixture
def root(tmp_path):
    """A temporary repository layout with the real registry and Standard."""
    (tmp_path / "data" / "sedens_standard").mkdir(parents=True)
    shutil.copy(REPO / media_import.SOURCES, tmp_path / media_import.SOURCES)
    shutil.copy(REPO / media_import.STANDARD, tmp_path / media_import.STANDARD)
    return tmp_path


def put(root: Path, *entries) -> None:
    path = root / media_import.SOURCES
    doc = json.loads(path.read_text(encoding="utf-8"))
    doc["import_manifest"]["entries"] = list(entries)
    doc["import_manifest"]["status"] = "has_entries" if entries else "empty"
    path.write_text(json.dumps(doc, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")


def snapshot(root: Path) -> dict:
    return {str(p.relative_to(root)): p.read_bytes() for p in sorted(root.rglob("*")) if p.is_file()}


def refused(root, entry_id="synthetic-pelvic-curl", clip=CLIP):
    with pytest.raises(media_import.Refused) as raised:
        media_import.register(entry_id, clip, root=root, today=TODAY)
    return "\n".join(raised.value.problems)


def test_the_repository_manifest_is_empty_and_checks_clean(capsys):
    """Nothing passed the licence and movement checks, so the real manifest lists no clip."""
    doc = json.loads((REPO / media_import.SOURCES).read_text(encoding="utf-8"))
    assert doc["import_manifest"]["status"] == "empty" and doc["import_manifest"]["entries"] == []
    assert not (REPO / media_import.FOLDER).exists()
    assert media_import.main(["--check"]) == 0
    assert "empty" in capsys.readouterr().out


def test_a_complete_entry_passes_the_check_and_waits_for_its_file(root):
    put(root, entry_for())
    problems, waiting = media_import.check_manifest(root, today=TODAY)
    assert problems == [] and len(waiting) == 1 and "--register synthetic-pelvic-curl" in waiting[0]


def test_register_copies_the_file_labels_it_and_links_the_exercise(root):
    put(root, entry_for())
    done = media_import.register("synthetic-pelvic-curl", CLIP, root=root, today=TODAY)
    assert done["asset"] == "stock-synthetic-pelvic-curl" and done["exercise"] == "std-pelvic-curl"
    copied = root / "web" / "assets" / "stock" / "synthetic-pelvic-curl.mp4"
    assert copied.read_bytes() == CLIP.read_bytes()

    sources = json.loads((root / media_import.SOURCES).read_text(encoding="utf-8"))
    asset = next(a for a in sources["assets"] if a["id"] == "stock-synthetic-pelvic-curl")
    assert asset["label"] == {"en": "Stock footage — movement not yet expert reviewed",
                              "ko": "스톡 영상 — 동작은 아직 전문가 검토 전"}
    assert asset["kind"] == "video" and asset["mime"] == "video/mp4"
    assert asset["path"] == "web/assets/stock/synthetic-pelvic-curl.mp4"
    assert asset["shows"] == "pelvicCurl" and asset["sha256"] == media_import.sha256_of(CLIP)
    assert asset["rights"]["licence_type"] == "pexels" and asset["rights"]["review_status"] == "unreviewed"
    assert asset["rights"]["identifiable_person"] == "none" and asset["rights"]["restrictions"]
    assert "Dana Reviewer" in asset["provenance"] and asset["description"]["en"] and asset["description"]["ko"]
    # The three repository illustrations are untouched.
    assert [a["id"] for a in sources["assets"][:3]] == ["repo-bridge", "repo-bird-dog", "repo-exercise-sheet"]

    standard = json.loads((root / media_import.STANDARD).read_text(encoding="utf-8"))
    exercise = next(e for e in standard["exercises"] if e["id"] == "std-pelvic-curl")
    assert exercise["media"] == ["repo-bridge", "stock-synthetic-pelvic-curl"]
    assert exercise["review"]["status"] == "unreviewed"  # registering a file never reviews a movement
    manifest = sources["import_manifest"]
    assert manifest["status"] == "has_entries" and manifest["entries"][0]["local_path"] == asset["path"]
    # The registered state is sound, and registering twice is refused.
    assert media_import.check_manifest(root, today=TODAY) == ([], [])
    assert "already registered" in refused(root)


def test_register_a_webm_clip(root):
    webm = REPO / "tests" / "data" / "media" / "sedens-test-pattern-b.webm"
    put(root, entry_for(webm, id="synthetic-clam", shows_exercise="std-clam"))
    done = media_import.register("synthetic-clam", webm, root=root, today=TODAY)
    assert done["path"].endswith("synthetic-clam.webm")


@pytest.mark.parametrize("field", ["id", "source", "page_url", "file_url", "licence_url", "licence", "original_creator",
                                   "retrieved_at", "sha256", "shows_exercise", "checked_by", "checked_at",
                                   "movement_notes", "identifiable_person"])
def test_each_missing_field_is_refused_and_named(root, field):
    entry = entry_for()
    entry.pop(field)
    put(root, entry)
    before = snapshot(root)
    message = refused(root, entry.get("id", "synthetic-pelvic-curl")) if field != "id" else None
    problems, _ = media_import.check_manifest(root, today=TODAY)
    assert any(f"'{field}' is missing" in p for p in problems)
    if message is not None:
        assert f"'{field}' is missing" in message
    assert snapshot(root) == before  # nothing copied, nothing changed


@pytest.mark.parametrize("field", ["checked_by", "movement_notes", "original_creator", "sha256", "page_url"])
def test_blank_fields_count_as_missing(root, field):
    put(root, entry_for(**{field: "   "}))
    assert f"'{field}' is missing" in refused(root)


@pytest.mark.parametrize("changes, expected", [
    ({"page_url": "http://www.pexels.com/video/x/"}, "'page_url' must be a web address starting with https://"),
    ({"file_url": "ftp://videos.pexels.com/x.mp4"}, "'file_url' must be a web address"),
    ({"licence_url": "https://example.test/license"}, "'licence_url' must be on pexels.com"),
    ({"page_url": "https://www.pexels.com.evil.test/x"}, "'page_url' must be on pexels.com"),
    ({"licence": "mixkit"}, "the licence 'mixkit' is not one of"),
    ({"licence": "pixabay"}, "a pixabay licence can only come from the source 'pixabay'"),
    ({"licence": "cc0"}, "is under the pexels licence"),
    ({"retrieved_at": "20 October 2026"}, "'retrieved_at' must be a date written YYYY-MM-DD"),
    ({"checked_at": "2026-13-40"}, "'checked_at' must be a date written YYYY-MM-DD"),
    ({"checked_at": "2026-12-31"}, "'checked_at' is in the future"),
    ({"checked_at": "2026-10-19"}, "'checked_at' is before 'retrieved_at'"),
    ({"sha256": "abc123"}, "'sha256' must be the 64 lowercase hexadecimal characters"),
    ({"shows_exercise": "std-no-such-exercise"}, "is not a SEDENS Standard exercise id"),
    ({"shows_exercise": "pelvicCurl"}, "is not a SEDENS Standard exercise id"),
    ({"identifiable_person": "maybe"}, "'identifiable_person' must be yes or no"),
    ({"identifiable_person": "yes"}, "'model_release_note' must say"),
    ({"checked_by": "Claude"}, "'checked_by' must be the name of the person"),
    ({"checked_by": "AI"}, "'checked_by' must be the name of the person"),
    ({"checked_by": "Claude Opus"}, "'checked_by' must be the name of the person"),
    ({"checked_by": "AI agent"}, "'checked_by' must be the name of the person"),
    ({"checked_by": "GPT-4"}, "'checked_by' must be the name of the person"),
    ({"checked_by": "Sonnet research agent"}, "'checked_by' must be the name of the person"),
    ({"checked_by": "claude-opus-5-5"}, "'checked_by' must be the name of the person"),
    ({"id": "abc\n"}, "the id must be 3 to 61 lowercase letters"),
    ({"id": "../x"}, "the id must be 3 to 61 lowercase letters"),
    ({"sha256": "a" * 64 + "\n"}, "'sha256' must be the 64 lowercase hexadecimal characters"),
    ({"file_url": "https://rr1---sn.googlevideo.com/videoplayback?x"}, "'file_url' points at a site SEDENS never takes"),
    ({"file_url": "https://player.vimeo.com/x.mp4"}, "'file_url' points at a site SEDENS never takes"),
    ({"id": "Bad Id!"}, "the id must be 3 to 61 lowercase letters"),
    ({"movement_notes": "x" * 1001}, "'movement_notes' must be text of at most 1000"),
])
def test_invalid_values_are_refused_with_a_plain_message(root, changes, expected):
    entry = entry_for(**changes)
    put(root, entry)
    before = snapshot(root)
    assert expected in refused(root, entry["id"])
    assert snapshot(root) == before


def test_a_visible_person_needs_a_model_release_note(root):
    entry = entry_for(identifiable_person="yes",
                      model_release_note="Pexels does not supply releases; the person is not identified by name.")
    put(root, entry)
    media_import.register("synthetic-pelvic-curl", CLIP, root=root, today=TODAY)
    sources = json.loads((root / media_import.SOURCES).read_text(encoding="utf-8"))
    rights = sources["assets"][-1]["rights"]
    assert rights["identifiable_person"] == "consented" and "Pexels does not supply releases" in rights["restrictions"]
    assert "endorse" in rights["restrictions"]


def test_a_wrong_checksum_is_refused(root, tmp_path):
    put(root, entry_for())
    other = tmp_path / "other.mp4"
    other.write_bytes(CLIP.read_bytes() + b"\0")
    before = snapshot(root)
    assert "does not match the recorded sha256" in refused(root, clip=other)
    assert snapshot(root) == before
    assert "does not exist" in refused(root, clip=tmp_path / "missing.mp4")


def test_a_file_that_is_not_a_video_is_refused_even_with_a_matching_checksum(root, tmp_path):
    text = tmp_path / "notes.mp4"
    text.write_bytes(b"this is not a video")
    put(root, entry_for(text))
    assert "not an MP4 or WebM video" in refused(root, clip=text)


@pytest.mark.parametrize("source", ["youtube", "tiktok", "instagram", "facebook", "higgsfield", "YouTube"])
def test_social_media_video_sites_and_generators_are_never_sources(root, source):
    put(root, entry_for(source=source))
    assert "is never a source" in refused(root)


@pytest.mark.parametrize("source", ["repo", "creator_upload", "vimeo", "somewhere-else"])
def test_only_enabled_stock_sources_are_accepted(root, source):
    put(root, entry_for(source=source))
    assert "is not an enabled stock source" in refused(root)


def test_a_disabled_source_is_refused_whatever_its_name(root):
    path = root / media_import.SOURCES
    doc = json.loads(path.read_text(encoding="utf-8"))
    next(s for s in doc["sources"] if s["id"] == "pixabay")["enabled"] = False
    path.write_text(json.dumps(doc, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    put(root, entry_for(source="pixabay", licence="pixabay", page_url="https://pixabay.com/videos/x-1/",
                        licence_url="https://pixabay.com/service/license-summary/"))
    assert "is not an enabled stock source" in refused(root)


@pytest.mark.parametrize("field", ["page_url", "file_url", "licence_url"])
@pytest.mark.parametrize("url", ["https://www.youtube.com/watch?v=abc", "https://youtu.be/abc",
                                 "https://www.tiktok.com/@x/video/1", "https://m.instagram.com/reel/1/",
                                 "https://higgsfield.ai/generation/1"])
def test_links_to_social_media_are_refused(root, field, url):
    put(root, entry_for(**{field: url}))
    assert f"'{field}'" in refused(root)


def test_an_unknown_entry_id_is_refused(root):
    put(root)
    assert "There is no entry 'nope'" in refused(root, "nope")


def test_the_command_line_checks_and_registers_against_a_repository(root, capsys, monkeypatch):
    monkeypatch.setattr(media_import, "ROOT", root)
    put(root, entry_for(source="youtube"))
    assert media_import.main(["--check"]) == 1
    out = capsys.readouterr().out
    assert "The import manifest is not ready" in out and "never a source" in out
    assert media_import.main(["--register", "synthetic-pelvic-curl", str(CLIP)]) == 1
    assert "never a source" in capsys.readouterr().err
    put(root, entry_for())
    assert media_import.main(["--check"]) == 0
    assert "waiting for its file" in capsys.readouterr().out
    assert media_import.main(["--register", "synthetic-pelvic-curl", str(CLIP)]) == 0
    assert "Stock footage — movement not yet expert reviewed" in capsys.readouterr().out


def test_an_entry_edited_after_registering_is_caught_by_the_check(root):
    put(root, entry_for())
    media_import.register("synthetic-pelvic-curl", CLIP, root=root, today=TODAY)
    (root / "web" / "assets" / "stock" / "synthetic-pelvic-curl.mp4").write_bytes(CLIP.read_bytes() + b"\0")
    problems, _ = media_import.check_manifest(root, today=TODAY)
    assert any("does not match the recorded sha256" in p for p in problems)
    # A manifest that claims to be empty while it lists entries is also refused.
    path = root / media_import.SOURCES
    doc = copy.deepcopy(json.loads(path.read_text(encoding="utf-8")))
    doc["import_manifest"]["status"] = "empty"
    path.write_text(json.dumps(doc, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    assert any("says it is empty" in p for p in media_import.check_manifest(root, today=TODAY)[0])


def test_a_registered_clip_satisfies_the_registry_and_standard_validators(root, monkeypatch):
    """The same integrity checks the server runs (video_providers.problems, standard.problems) accept the result."""
    from pilates.sedens import standard, video_providers

    put(root, entry_for())
    media_import.register("synthetic-pelvic-curl", CLIP, root=root, today=TODAY)
    monkeypatch.setattr(video_providers, "REPO", root)
    monkeypatch.setattr(video_providers, "SOURCES", root / media_import.SOURCES)
    monkeypatch.setattr(standard, "FILE", root / media_import.STANDARD)
    monkeypatch.setattr(standard, "CONTENT_SOURCES", root / media_import.SOURCES)
    for cached in (video_providers.registry, standard.document, standard._by_id, standard.content_assets):
        cached.cache_clear()
    try:
        # The temporary root holds only the new clip, so the three repository illustrations are reported missing.
        assert [p for p in video_providers.problems() if not p.startswith("repo-")] == []
        assert standard.problems() == []
    finally:
        monkeypatch.undo()
        for cached in (video_providers.registry, standard.document, standard._by_id, standard.content_assets):
            cached.cache_clear()


def test_every_kind_of_course_media_carries_a_not_yet_reviewed_label():
    """Stock, repository and creator media are labelled; none of the labels claims an expert reviewed the movement."""
    from pilates.sedens import video_providers as vp

    stock = vp.label_for("creator_upload", "pexels")
    creator = vp.label_for("creator_upload", "own_work")
    repo = vp.label_for("repo", "repo_owned", "repo-bird-dog")
    by_hash = vp.label_for("repo", "repo_owned", None, vp.repo_asset("repo-bird-dog")["sha256"])
    assert stock == vp.STOCK_LABEL and stock["en"] == "Demo media — movement not yet expert reviewed"
    assert repo == by_hash and repo["en"].startswith("AI-generated illustration")
    for label in (stock, creator, repo):
        for language in ("en", "ko"):
            assert label[language]
        assert "not yet expert reviewed" in label["en"] and "전문가 검토 전" in label["ko"]


def test_a_registered_clip_appears_in_the_room_step_with_its_label(root, monkeypatch):
    """The room builds a Standard step's video from the registry: URL under /assets/stock/ and the stock label."""
    from pilates.sedens import workouts

    put(root, entry_for())
    media_import.register("synthetic-pelvic-curl", CLIP, root=root, today=TODAY)
    sources = json.loads((root / media_import.SOURCES).read_text(encoding="utf-8"))
    standard = json.loads((root / media_import.STANDARD).read_text(encoding="utf-8"))
    entry = next(e for e in standard["exercises"] if e["id"] == "std-pelvic-curl")
    monkeypatch.setattr(workouts, "_content_assets", lambda: list(sources["assets"]))
    for locale, label in (("en", "Stock footage — movement not yet expert reviewed"),
                          ("ko", "스톡 영상 — 동작은 아직 전문가 검토 전")):
        step = workouts._standard_step(entry, locale, sets=1, rest_between=20)
        assert step["video"]["url"] == "/assets/stock/synthetic-pelvic-curl.mp4"
        assert step["video"]["label"] == label and step["video"]["mime"] == "video/mp4"
        assert step["image"]["label"].startswith("AI-generated illustration" if locale == "en" else "AI 생성 일러스트")


def test_a_registered_clip_is_served_with_byte_ranges(root, monkeypatch):
    """Safari needs ranges to play a video. /assets/stock/ answers 206, 416 and 404 like the room does."""
    from functools import partial
    from http.server import ThreadingHTTPServer
    import threading
    import urllib.error
    import urllib.request

    from pilates import serve

    put(root, entry_for())
    media_import.register("synthetic-pelvic-curl", CLIP, root=root, today=TODAY)
    (root / "web" / "assets" / "stock" / "notes.txt").write_text("not a clip", encoding="utf-8")
    monkeypatch.setattr(serve, "WEB", root / "web")
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(serve.Handler, directory=str(root / "web")))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_address[1]}/assets/stock/"
    data = CLIP.read_bytes()

    def get(name, rng=None):
        request = urllib.request.Request(base + name, headers={"Range": rng} if rng else {})
        try:
            with urllib.request.urlopen(request) as answer:
                return answer.status, dict(answer.headers), answer.read()
        except urllib.error.HTTPError as error:
            return error.code, dict(error.headers), b""

    try:
        status, headers, body = get("synthetic-pelvic-curl.mp4")
        assert status == 200 and body == data and headers["Accept-Ranges"] == "bytes"
        assert headers["Content-Type"] == "video/mp4"
        status, headers, body = get("synthetic-pelvic-curl.mp4", "bytes=10-19")
        assert status == 206 and body == data[10:20] and headers["Content-Range"] == f"bytes 10-19/{len(data)}"
        assert get("synthetic-pelvic-curl.mp4", f"bytes={len(data) + 5}-")[0] == 416
        assert get("notes.txt")[0] == 404
        assert get("missing.mp4")[0] == 404
        assert get("..%2f..%2fdata%2fcontent_sources.json")[0] == 404
    finally:
        server.shutdown()
        server.server_close()
