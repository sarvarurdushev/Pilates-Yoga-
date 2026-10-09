"""Course media files: byte-level checks, safe storage and range serving."""

import io
import os
import stat

import pytest
from PIL import Image

from pilates.platform.repository import Repository
from pilates.sedens import media_store, video_providers
from pilates.sedens.util import Denied

MP4 = b"\x00\x00\x00\x18ftypisom\x00\x00\x02\x00isomiso2" + b"\x00" * 200
WEBM = b"\x1a\x45\xdf\xa3\x9f\x42\x86\x81\x01\x42\x82\x84webm" + b"\x00" * 200


@pytest.fixture
def repo(tmp_path):
    return Repository(tmp_path / "studio.db")


def upload(repo, data, kind, mode="local_room"):
    return media_store.receive(repo, io.BytesIO(data), len(data), kind, mode)


def jpeg_with_location():
    image = Image.new("RGB", (32, 24), (90, 120, 150))
    exif = Image.Exif()
    exif[0x010F] = "Phone maker"  # stands in for camera and location metadata
    exif[0x0131] = "secret-location-app"
    out = io.BytesIO()
    image.save(out, format="JPEG", exif=exif)
    return out.getvalue()


def test_videos_are_recognised_by_their_bytes(repo):
    assert upload(repo, MP4, "video").mime == "video/mp4"
    assert upload(repo, WEBM, "video").mime == "video/webm"
    for fake in (b"<html><script>alert(1)</script>" + b" " * 64, b"xxxxftypevil" + b"\x00" * 64,
                 b"GIF89a" + b"\x00" * 64):
        with pytest.raises(Denied) as exc:
            upload(repo, fake, "video")
        assert exc.value.code == "media_type_mismatch"


def test_images_are_re_encoded_without_location_data(repo):
    raw = jpeg_with_location()
    assert b"Exif" in raw
    received = upload(repo, raw, "image")
    stored = received.path.read_bytes()
    assert received.mime == "image/jpeg" and b"Exif" not in stored and b"secret-location-app" not in stored
    assert received.detail == {"width": 32, "height": 24}
    # Bytes hidden after a valid image do not survive.
    png = io.BytesIO()
    Image.new("RGBA", (8, 8)).save(png, format="PNG")
    polyglot = png.getvalue() + b"<script>alert(1)</script>"
    assert b"<script>" not in upload(repo, polyglot, "image").path.read_bytes()
    with pytest.raises(Denied):
        upload(repo, b"<svg xmlns='http://www.w3.org/2000/svg'></svg>", "image")


def test_pdfs_with_active_content_are_refused(repo):
    plain = b"%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n"
    assert upload(repo, plain, "pdf").mime == "application/pdf"
    for marker in (b"/JavaScript", b"/Launch", b"/EmbeddedFile"):
        with pytest.raises(Denied) as exc:
            upload(repo, plain.replace(b"/Type /Catalog", b"/Type /Catalog " + marker), "pdf")
        assert exc.value.code == "pdf_active_content"
    with pytest.raises(Denied):
        upload(repo, b"not a pdf at all", "pdf")


def test_size_limits_follow_the_deployment_mode(repo):
    big = MP4 + b"\x00" * (media_store.limit("demo_free", "video"))
    with pytest.raises(Denied) as exc:
        media_store.receive(repo, io.BytesIO(big), len(big), "video", "demo_free")
    assert exc.value.code == "media_too_large" and exc.value.status == 413
    assert media_store.limit("local_room", "video") > media_store.limit("demo_free", "video")
    with pytest.raises(Denied):
        media_store.receive(repo, io.BytesIO(b""), 0, "video", "local_room")


def test_an_interrupted_upload_leaves_nothing_behind(repo):
    with pytest.raises(Denied) as exc:
        media_store.receive(repo, io.BytesIO(MP4[:50]), len(MP4), "video", "local_room")
    assert exc.value.code == "upload_interrupted"
    assert not list((media_store.root(repo) / "incoming").iterdir())


def test_kept_files_are_private_and_outside_the_web_folder(repo):
    received = upload(repo, MP4, "video")
    key = received.keep(repo, "org-1")
    path = media_store.object_path(repo, key)
    assert key.startswith("org-1/") and path.is_file()
    assert stat.S_IMODE(os.stat(path).st_mode) == 0o600
    assert "web" not in path.parts
    with pytest.raises(Denied):
        media_store.object_path(repo, "../../studio.db")


class FakeHandler:
    def __init__(self, range_header=None):
        self.headers = {"Range": range_header} if range_header else {}
        self.status, self.sent, self.wfile = None, {}, io.BytesIO()

    def send_response(self, status):
        self.status = status

    def send_header(self, name, value):
        self.sent[name] = value

    def end_headers(self):
        pass


def test_files_stream_with_ranges_and_safe_headers(repo, tmp_path):
    path = tmp_path / "clip.mp4"
    path.write_bytes(bytes(range(256)) * 4)
    whole = FakeHandler()
    media_store.stream_file(whole, path, "video/mp4")
    assert whole.status == 200 and len(whole.wfile.getvalue()) == 1024
    assert whole.sent["X-Content-Type-Options"] == "nosniff"
    assert whole.sent["Content-Security-Policy"] == "default-src 'none'; sandbox"
    part = FakeHandler("bytes=10-19")
    media_store.stream_file(part, path, "video/mp4")
    assert part.status == 206 and part.wfile.getvalue() == bytes(range(10, 20))
    assert part.sent["Content-Range"] == "bytes 10-19/1024"
    beyond = FakeHandler("bytes=5000-")
    media_store.stream_file(beyond, path, "video/mp4")
    assert beyond.status == 416 and beyond.sent["Content-Range"] == "bytes */1024"
    pdf = FakeHandler()
    media_store.stream_file(pdf, path, "application/pdf", download_name='notes"; x.pdf')
    assert pdf.sent["Content-Disposition"] == 'attachment; filename="notes__ x.pdf"'


def test_content_sources_and_providers():
    assert video_providers.problems() == []
    registry = video_providers.registry()
    assert registry["import_manifest"]["entries"] == []
    assert all(not s.get("auto_download", False) for s in registry["sources"])
    higgsfield = video_providers.PROVIDERS["higgsfield"]
    assert higgsfield.enabled is False and higgsfield.workflow[-2:] == ("expert_review", "publish")
    with pytest.raises(Denied) as exc:
        higgsfield.generate(exercise="pelvicCurl")
    assert exc.value.code == "provider_disabled"
    assert all(not p.starts_reviewed for p in video_providers.PROVIDERS.values())
