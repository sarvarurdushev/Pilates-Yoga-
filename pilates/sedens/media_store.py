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
* **Audio** (a step's recorded narration) is checked the same way: MP3 needs
  three consecutive MPEG audio frame headers with nothing but zero padding
  before them (after an ID3 tag, if any); M4A needs an ``ftyp`` box with an
  audio brand and a ``moov`` box whose tracks include sound and no video; WebM
  needs the EBML header, the ``webm`` document type, an Opus or Vorbis track
  and no video codec; Ogg needs every stream to start with an Opus or Vorbis
  packet. Any other MP4, QuickTime, Matroska or RIFF file is refused and never
  re-read as MP3. Audio is not decoded or transcoded.
"""

from __future__ import annotations

from contextlib import contextmanager
import hashlib
import io
import os
from pathlib import Path
import re
import tempfile
import threading

from .util import Denied, uid

KINDS = ("video", "image", "pdf", "audio")
EXTENSIONS = {"video/mp4": ".mp4", "video/webm": ".webm", "image/jpeg": ".jpg", "image/png": ".png",
              "image/webp": ".webp", "application/pdf": ".pdf", "audio/mpeg": ".mp3", "audio/mp4": ".m4a",
              "audio/webm": ".weba", "audio/ogg": ".ogg"}
MP4_BRANDS = {b"isom", b"iso2", b"iso4", b"iso5", b"iso6", b"mp41", b"mp42", b"avc1", b"dash", b"M4V ", b"MSNV"}
M4A_BRANDS = {b"M4A ", b"M4B ", b"F4A ", b"isom", b"iso2", b"iso4", b"iso5", b"iso6", b"mp41", b"mp42", b"dash"}
# Top-level ISO base media boxes a file may start with (MP4, M4A, QuickTime).
_ISO_BOXES = {b"ftyp", b"moov", b"mdat", b"wide", b"free", b"skip", b"pnot"}
_MP4_MAX_DEPTH = 8
WEBM_VIDEO = re.compile(rb"V_(VP8|VP9|AV1|MPEG4|MPEGH|THEORA|UNCOMPRESSED|MS/VFW)")
WEBM_AUDIO = re.compile(rb"A_(OPUS|VORBIS)")
# Uncompressed markers only; PDFs are also always served as sandboxed downloads.
PDF_ACTIVE = re.compile(rb"/(JavaScript|JS|Launch|EmbeddedFile|RichMedia)\b")
# Bytes per kind. The free hosted demonstration keeps files small: its storage is erased on restart.
LIMITS = {
    "local_room": {"video": 300 * 1024 * 1024, "image": 12 * 1024 * 1024, "pdf": 25 * 1024 * 1024,
                   "audio": 30 * 1024 * 1024},
    "demo_free": {"video": 25 * 1024 * 1024, "image": 8 * 1024 * 1024, "pdf": 10 * 1024 * 1024,
                  "audio": 8 * 1024 * 1024},
}
_UPLOADS = threading.BoundedSemaphore(2)


def root(repo) -> Path:
    folder = Path(str(repo.path) + ".sedens-media")
    for part in (folder, folder / "incoming", folder / "objects"):
        part.mkdir(mode=0o700, parents=True, exist_ok=True)
    return folder


def limit(mode_name: str, kind: str) -> int:
    return LIMITS.get(mode_name, LIMITS["demo_free"])[kind]


_RECEIVING = [0]
_RECEIVING_LOCK = threading.Lock()


@contextmanager
def upload_slot():
    """One of the server's two upload slots, for any large body being received
    (an upload or a course import), or 429 when both are taken."""
    if not _UPLOADS.acquire(blocking=False):
        raise Denied("Another upload is in progress. Try again in a moment.", 429, "uploads_busy")
    with _RECEIVING_LOCK:
        _RECEIVING[0] += 1
    try:
        yield
    finally:
        with _RECEIVING_LOCK:
            _RECEIVING[0] -= 1
        _UPLOADS.release()


def uploads_running() -> bool:
    """Whether any course upload or import is being received right now."""
    with _RECEIVING_LOCK:
        return _RECEIVING[0] > 0


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


def _capped(kind: str, length: int, mode_name: str):
    if kind not in KINDS:
        raise Denied("Choose a video, a photo, a PDF or an audio recording.", 400, "invalid_media_kind")
    cap = limit(mode_name, kind)
    if not 0 < length <= cap:
        raise Denied(f"Choose a file up to {cap // (1024 * 1024)} MB.", 413, "media_too_large")


def receive(repo, stream, length: int, kind: str, mode_name: str) -> Received:
    """Stream, hash and check an upload. The caller has already authorized it."""
    _capped(kind, length, mode_name)
    with upload_slot():
        return _ingest(repo, stream, length, kind)


def adopt(repo, stream, length: int, kind: str, mode_name: str) -> Received:
    """A file from a backup archive: the same limits and checks as an upload."""
    _capped(kind, length, mode_name)
    return _ingest(repo, stream, length, kind)


def _ingest(repo, stream, length: int, kind: str) -> Received:
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
    if kind == "audio":
        mime = _audio(path, head)
        if mime is None:
            raise Denied("The file content is not an MP3, M4A, WebM or Ogg audio recording.", 415, "media_type_mismatch")
        return mime, {}
    raise Denied("Choose a video, a photo, a PDF or an audio recording.", 400, "invalid_media_kind")


# -- audio --------------------------------------------------------------------------------

_MPEG_BITRATES = {  # kbit/s by (version is 1, layer), index 1-14
    (True, 1): (32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448),
    (True, 2): (32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384),
    (True, 3): (32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320),
    (False, 1): (32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256),
    (False, 2): (8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160),
    (False, 3): (8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160),
}
_MPEG_RATES = {3: (44100, 48000, 32000), 2: (22050, 24000, 16000), 0: (11025, 12000, 8000)}


def _mpeg_frame(header: bytes):
    """(frame length, stream signature) of one MPEG audio frame header, or None."""
    if len(header) < 4 or header[0] != 0xFF or header[1] & 0xE0 != 0xE0:
        return None
    version, layer_bits = (header[1] >> 3) & 3, (header[1] >> 1) & 3
    rate_index, bitrate_index, padding = (header[2] >> 2) & 3, header[2] >> 4, (header[2] >> 1) & 1
    if version == 1 or layer_bits == 0 or rate_index == 3 or bitrate_index in (0, 15):
        return None
    layer = 4 - layer_bits
    bitrate = _MPEG_BITRATES[(version == 3, layer)][bitrate_index - 1] * 1000
    rate = _MPEG_RATES[version][rate_index]
    if layer == 1:
        length = (12 * bitrate // rate + padding) * 4
    else:
        length = (144 if layer == 2 or version == 3 else 72) * bitrate // rate + padding
    return length, (version, layer, rate)


def _is_mp3(path: Path, head: bytes) -> bool:
    start = 0
    if head[:3] == b"ID3" and len(head) >= 10 and head[3] in (2, 3, 4):
        size = (head[6] & 0x7F) << 21 | (head[7] & 0x7F) << 14 | (head[8] & 0x7F) << 7 | (head[9] & 0x7F)
        start = 10 + size + (10 if head[5] & 0x10 else 0)
    with path.open("rb") as source:
        source.seek(start)
        window = source.read(4096 + 3 * 2900)
    # Three consecutive frames of one stream, starting within the first 4 KB
    # (encoders may pad after the tag with zero bytes). A stray 0xFFEx in other
    # data rarely chains into three valid frames, and anything but padding
    # before the first frame (an HTML or PDF header, say) is refused.
    for offset in range(0, min(4096, len(window))):
        if window[offset] != 0xFF:
            if window[offset] != 0:
                return False
            continue
        first = _mpeg_frame(window[offset:offset + 4])
        if first is None:
            continue
        at, ok = offset + first[0], True
        for _ in range(2):
            following = _mpeg_frame(window[at:at + 4])
            if following is None or following[1] != first[1]:
                ok = False
                break
            at += following[0]
        if ok:
            return True
    return False


def _mp4_handlers(path: Path) -> list[bytes] | None:
    """Handler types (b'soun', b'vide', ...) of every track in an MP4 file's moov
    box, or None when the file has no readable moov box."""
    containers = {b"moov", b"trak", b"mdia"}
    size_total = path.stat().st_size
    with path.open("rb") as source:
        offset = 0
        while offset + 8 <= size_total:
            source.seek(offset)
            header = source.read(16)
            size, kind = int.from_bytes(header[:4], "big"), header[4:8]
            body = 8
            if size == 1:
                size, body = int.from_bytes(header[8:16], "big"), 16
            elif size == 0:
                size = size_total - offset
            if size < body:
                return None
            if kind == b"moov":
                if size > 16 * 1024 * 1024:
                    return None
                source.seek(offset + body)
                moov = source.read(size - body)
                break
            offset += size
        else:
            return None
    # moov > trak > mdia > hdlr: three container levels. Walked with an explicit
    # stack, and a file nested deeper than a real one is refused (crafted
    # nesting must not exhaust the interpreter's recursion limit).
    handlers, stack = [], [(0, len(moov), 1)]
    while stack:
        at, end, depth = stack.pop()
        while at + 8 <= end:
            size, kind = int.from_bytes(moov[at:at + 4], "big"), moov[at + 4:at + 8]
            if size < 8 or at + size > end:
                break
            if kind in containers:
                if depth >= _MP4_MAX_DEPTH:
                    return None
                stack.append((at + 8, at + size, depth + 1))
            elif kind == b"hdlr" and size >= 20:
                handlers.append(moov[at + 16:at + 20])
            at += size
    return handlers


def _ogg_is_audio(path: Path) -> bool:
    """Every stream an Ogg file begins (its beginning-of-stream pages, which come
    first) is Opus or Vorbis. A Theora, Skeleton or any other stream is refused."""
    with path.open("rb") as source:
        data = source.read(65536)
    at, streams = 0, 0
    while at + 27 <= len(data) and data[at:at + 4] == b"OggS" and data[at + 4] == 0:
        segments = data[at + 26]
        lacing = data[at + 27:at + 27 + segments]
        body = at + 27 + segments
        if len(lacing) < segments:
            break
        if not data[at + 5] & 2:
            break  # the first page that does not begin a stream: all streams are known
        packet = data[body:body + 8]
        if not (packet.startswith(b"OpusHead") or packet.startswith(b"\x01vorbis")):
            return False
        streams += 1
        at = body + sum(lacing)
    return streams > 0


def _audio(path: Path, head: bytes) -> str | None:
    # Each container decides on its own; none falls through to the MP3 frame
    # scan, so a video whose first track happens to be MP3 is not taken as audio.
    if len(head) >= 12 and head[4:8] in _ISO_BOXES:
        if head[4:8] != b"ftyp" or head[8:12] not in M4A_BRANDS:
            return None  # QuickTime, M4V, avc1 and other video brands
        handlers = _mp4_handlers(path)
        if handlers and b"soun" in handlers and b"vide" not in handlers:
            return "audio/mp4"
        return None
    if head.startswith(b"\x1a\x45\xdf\xa3"):
        if b"webm" not in head[:64]:
            return None  # Matroska
        with path.open("rb") as source:
            tracks = source.read(65536)
        if WEBM_AUDIO.search(tracks) and not WEBM_VIDEO.search(tracks):
            return "audio/webm"
        return None
    if head.startswith(b"OggS"):
        return "audio/ogg" if _ogg_is_audio(path) else None
    if head.startswith(b"RIFF"):
        return None  # WAV, AVI
    if _is_mp3(path, head):
        return "audio/mpeg"
    return None


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
