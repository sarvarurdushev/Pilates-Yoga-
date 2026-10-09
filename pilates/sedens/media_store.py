"""Course media files: received, checked and served apart from platform media.

Course media never lives in ``p_media`` and is never served by
``/platform/media``. Files sit under ``<database>.sedens-media/``, beside the
platform's ``.media`` folder and outside ``web/`` (everything under ``web/`` is
public). Who may read a file is decided by :mod:`pilates.sedens.access`; this
module only stores bytes safely and streams them back.

* **Receiving** streams the request body to ``incoming/`` in 64 KB blocks
  (memory stays flat), computes SHA-256 on the way, and refuses a short body.
* **Checking** looks at the bytes, never at the browser's claimed type or file
  name: MP4 needs an ``ftyp`` box with a known brand; WebM needs the EBML
  header and the ``webm`` document type; images must open in Pillow as JPEG,
  PNG or WebP and are re-encoded, which drops EXIF (camera location) and any
  bytes hidden behind the image; a PDF needs the ``%PDF-`` header and is refused
  if it contains scripts, launch actions or embedded files.
* **Serving** answers single byte ranges for video seeking, with ``nosniff``,
  a sandboxing content-security policy and same-origin resource policy.
"""

from __future__ import annotations

import hashlib
import io
import os
from pathlib import Path
import re
import tempfile
import threading

from .util import Denied, uid

KINDS = ("video", "image", "pdf")
EXTENSIONS = {"video/mp4": ".mp4", "video/webm": ".webm", "image/jpeg": ".jpg", "image/png": ".png",
              "image/webp": ".webp", "application/pdf": ".pdf"}
MP4_BRANDS = {b"isom", b"iso2", b"iso4", b"iso5", b"iso6", b"mp41", b"mp42", b"avc1", b"dash", b"M4V ", b"MSNV"}
# Uncompressed markers only; PDFs are also always served as sandboxed downloads.
PDF_ACTIVE = re.compile(rb"/(JavaScript|JS|Launch|EmbeddedFile|RichMedia)\b")
# Bytes per kind. The free hosted demonstration keeps files small: its storage is erased on restart.
LIMITS = {
    "local_room": {"video": 300 * 1024 * 1024, "image": 12 * 1024 * 1024, "pdf": 25 * 1024 * 1024},
    "demo_free": {"video": 25 * 1024 * 1024, "image": 8 * 1024 * 1024, "pdf": 10 * 1024 * 1024},
}
_UPLOADS = threading.BoundedSemaphore(2)


def root(repo) -> Path:
    folder = Path(str(repo.path) + ".sedens-media")
    for part in (folder, folder / "incoming", folder / "objects"):
        part.mkdir(mode=0o700, parents=True, exist_ok=True)
    return folder


def limit(mode_name: str, kind: str) -> int:
    return LIMITS.get(mode_name, LIMITS["demo_free"])[kind]


def object_path(repo, object_key: str) -> Path:
    path = (root(repo) / "objects" / object_key).resolve()
    if not path.is_relative_to((root(repo) / "objects").resolve()):
        raise Denied("This file is not available.", 404, "media_not_found")
    return path


class Received:
    """A checked file waiting in ``incoming/`` until its record is saved."""

    def __init__(self, path: Path, kind: str, mime: str, size: int, sha256: str, detail: dict):
        self.path, self.kind, self.mime, self.size, self.sha256, self.detail = path, kind, mime, size, sha256, detail

    def keep(self, repo, owner_org_id: str) -> str:
        """Move into place; returns the object key stored in the database."""
        folder = root(repo) / "objects" / owner_org_id
        folder.mkdir(mode=0o700, parents=True, exist_ok=True)
        key = f"{owner_org_id}/{uid()}{EXTENSIONS[self.mime]}"
        target = root(repo) / "objects" / key
        os.replace(self.path, target)
        os.chmod(target, 0o600)
        self.path = target
        return key

    def discard(self):
        Path(self.path).unlink(missing_ok=True)


def receive(repo, stream, length: int, kind: str, mode_name: str) -> Received:
    """Stream, hash and check an upload. The caller has already authorized it."""
    if kind not in KINDS:
        raise Denied("Choose a video, a photo or a PDF.", 400, "invalid_media_kind")
    cap = limit(mode_name, kind)
    if not 0 < length <= cap:
        raise Denied(f"Choose a file up to {cap // (1024 * 1024)} MB.", 413, "media_too_large")
    if not _UPLOADS.acquire(blocking=False):
        raise Denied("Another upload is in progress. Try again in a moment.", 429, "uploads_busy")
    handle, name = tempfile.mkstemp(dir=root(repo) / "incoming")
    path = Path(name)
    try:
        digest = hashlib.sha256()
        with os.fdopen(handle, "wb") as target:
            remaining = length
            while remaining:
                block = stream.read(min(65536, remaining))
                if not block:
                    raise Denied("The upload was interrupted. Choose the file and try again.", 400, "upload_interrupted")
                digest.update(block)
                target.write(block)
                remaining -= len(block)
        mime, detail = check(path, kind)
        if kind == "image":
            # Re-encoded: the stored bytes changed, so hash what is stored.
            digest = hashlib.sha256(path.read_bytes())
        return Received(path, kind, mime, path.stat().st_size, digest.hexdigest(), detail)
    except BaseException:
        path.unlink(missing_ok=True)
        raise
    finally:
        _UPLOADS.release()


def check(path: Path, kind: str) -> tuple[str, dict]:
    """(mime, detail) from the bytes themselves, or Denied 415."""
    with path.open("rb") as source:
        head = source.read(4096)
    if kind == "video":
        if len(head) >= 12 and head[4:8] == b"ftyp" and head[8:12] in MP4_BRANDS:
            return "video/mp4", {}
        if head.startswith(b"\x1a\x45\xdf\xa3") and b"webm" in head[:64]:
            return "video/webm", {}
        raise Denied("The file content is not an MP4 or WebM video.", 415, "media_type_mismatch")
    if kind == "image":
        from PIL import Image

        try:
            with Image.open(path) as image:
                image.verify()
            with Image.open(path) as image:
                if image.format not in ("JPEG", "PNG", "WEBP"):
                    raise Denied("The file content is not a JPEG, PNG or WebP image.", 415, "media_type_mismatch")
                if image.width * image.height > 16_000_000:
                    raise Denied("Choose an image of at most 16 megapixels.", 413, "media_too_large")
                fmt = image.format
                clean = image.convert("RGBA" if image.mode in ("RGBA", "LA", "P") and fmt != "JPEG" else "RGB")
                out = io.BytesIO()
                clean.save(out, format=fmt, **({"quality": 90} if fmt == "JPEG" else {}))
                detail = {"width": image.width, "height": image.height}
        except Denied:
            raise
        except Exception as exc:  # noqa: BLE001 - any decoder failure means "not an image"
            raise Denied("The file content is not a supported image.", 415, "media_type_mismatch") from exc
        path.write_bytes(out.getvalue())
        return {"JPEG": "image/jpeg", "PNG": "image/png", "WEBP": "image/webp"}[fmt], detail
    if kind == "pdf":
        if not head.startswith(b"%PDF-"):
            raise Denied("The file content is not a PDF.", 415, "media_type_mismatch")
        body = path.read_bytes()
        if PDF_ACTIVE.search(body):
            raise Denied("PDFs with scripts, actions or embedded files are not accepted.", 415, "pdf_active_content")
        return "application/pdf", {}
    raise Denied("Choose a video, a photo or a PDF.", 400, "invalid_media_kind")


def stream_file(h, path: Path, mime: str, *, download_name: str | None = None, cache: str = "private, no-store"):
    """Send a file, honouring one byte range. Headers are sent only after the
    caller authorized the request; errors after that point just close."""
    total = path.stat().st_size
    start, end, status = 0, max(total - 1, 0), 200
    requested = h.headers.get("Range")
    if requested and total:
        match = re.fullmatch(r"bytes=(\d*)-(\d*)", requested.strip())
        if match and any(match.groups()):
            a, b = match.groups()
            if not a:
                start = max(0, total - int(b))
            else:
                start = int(a)
                end = min(end, int(b)) if b else end
            if start > end or start >= total:
                h.send_response(416)
                h.send_header("Content-Range", f"bytes */{total}")
                h.send_header("Content-Length", "0")
                h.end_headers()
                return
            status = 206
    h.send_response(status)
    h.send_header("Content-Type", mime)
    h.send_header("Content-Length", str(end - start + 1 if total else 0))
    h.send_header("Accept-Ranges", "bytes")
    h.send_header("Cache-Control", cache)
    h.send_header("X-Content-Type-Options", "nosniff")
    h.send_header("Content-Security-Policy", "default-src 'none'; sandbox")
    h.send_header("Cross-Origin-Resource-Policy", "same-origin")
    if download_name:
        safe = re.sub(r"[^A-Za-z0-9._ -]", "_", download_name)[:120] or "file"
        h.send_header("Content-Disposition", f'attachment; filename="{safe}"')
    if status == 206:
        h.send_header("Content-Range", f"bytes {start}-{end}/{total}")
    h.end_headers()
    if not total:
        return
    try:
        with path.open("rb") as source:
            source.seek(start)
            remaining = end - start + 1
            while remaining:
                block = source.read(min(65536, remaining))
                if not block:
                    break
                h.wfile.write(block)
                remaining -= len(block)
    except (BrokenPipeError, ConnectionResetError):
        pass  # a video element cancels ranges constantly while seeking
