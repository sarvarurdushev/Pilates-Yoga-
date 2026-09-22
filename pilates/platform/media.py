"""Authenticated media storage and educational DICOM rendering."""

from pathlib import Path
import io
import json
import mimetypes
import os
import re
import shutil
from .repository import Refused, uid, now, encode

TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "application/dicom": ".dcm",
}


def upload(
    repo, actor, stream, length, filename, mime, kind, student_id=None, exercise_id=None
):
    if kind not in ("capture", "exercise", "scan", "profile"):
        raise Refused("Choose the purpose of this upload.")
    if not 0 < length <= 64 * 1024 * 1024:
        raise Refused("Choose a file up to 64 MB.", 413)
    filename = Path(str(filename)).name[:160]
    if filename.lower().endswith((".dcm", ".dicom")):
        mime = "application/dicom"
    if mime not in TYPES:
        raise Refused(
            "Use JPEG, PNG, WebP, MP4, WebM or an uncompressed/RLE DICOM image.", 415
        )
    if mime.startswith("image/") and length > 12 * 1024 * 1024:
        raise Refused("Use an image smaller than 12 MB.", 413)
    if kind == "scan" and mime.startswith("video/"):
        raise Refused("Choose an image or DICOM file for a scan.", 415)
    if kind == "exercise":
        if actor.role == "student" or not exercise_id:
            raise Refused("Select your exercise before uploading.", 403)
        exercise = repo.get(actor, "exercises", exercise_id)
        if actor.role != "admin" and exercise["owner_id"] != actor.user_id:
            raise Refused("Only the exercise owner can change its media.", 403)
    else:
        if not student_id:
            raise Refused("Select a client before uploading.")
        repo.assert_student(actor, student_id, True)
    if kind == "exercise":
        student_id = None
    else:
        exercise_id = None
    identifier = uid()
    folder = repo.media_root / actor.org_id
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / (identifier + TYPES[mime])
    detail = {}
    try:
        with path.open("wb") as target:
            remaining = length
            while remaining:
                chunk = stream.read(min(65536, remaining))
                if not chunk:
                    raise Refused(
                        "The upload was interrupted. Select the file and retry."
                    )
                target.write(chunk)
                remaining -= len(chunk)
        if mime.startswith("image/"):
            from PIL import Image

            with Image.open(path) as img:
                if img.width * img.height > 16_000_000:
                    raise Refused("Choose an image of at most 16 megapixels.")
                if img.format not in ("JPEG", "PNG", "WEBP"):
                    raise Refused("The file content is not a supported image.", 415)
                detail = {"width": img.width, "height": img.height}
                img.verify()
        elif mime == "application/dicom":
            detail = dicom_metadata(path)
        else:
            with path.open("rb") as f:
                signature = f.read(64)
            valid = (mime == "video/mp4" and b"ftyp" in signature) or (
                mime == "video/webm" and signature.startswith(b"\x1aE\xdf\xa3")
            )
            if not valid:
                raise Refused("The file content does not match MP4 or WebM.", 415)
        with repo.db() as db:
            db.execute(
                "INSERT INTO p_media VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    identifier,
                    actor.org_id,
                    actor.user_id,
                    student_id,
                    exercise_id,
                    kind,
                    mime,
                    filename,
                    str(path),
                    length,
                    now(),
                    encode(detail),
                ),
            )
            if exercise_id:
                db.execute(
                    "INSERT INTO p_exercise_media VALUES (?,?)",
                    (exercise_id, identifier),
                )
            repo.audit(db, actor, "upload:" + kind, identifier)
    except Exception:
        path.unlink(missing_ok=True)
        raise
    return repo.get(actor, "media", identifier)


def media_path(repo, actor, identifier):
    repo.get(actor, "media", identifier)
    with repo.db() as db:
        row = db.execute("SELECT * FROM p_media WHERE id=?", (identifier,)).fetchone()
    path = Path(row["path"])
    if not path.is_file():
        raise Refused(
            "This media is no longer on the server. Restore a backup or upload the original again.",
            410,
        )
    return path, row["mime"], json.loads(row["detail"])


def copy_exercise_media(repo, actor, exercise_id, identifiers):
    """Create independently owned files when a coach duplicates shared content."""
    if actor.role == "student":
        raise Refused("Only staff can copy exercise content.", 403)
    if not isinstance(identifiers, list) or len(identifiers) > 30:
        raise Refused("Copy at most 30 exercise media files.")
    created = []
    result = []
    try:
        with repo.db() as db:
            target = repo.get(actor, "exercises", exercise_id, db)
            if actor.role != "admin" and target["owner_id"] != actor.user_id:
                raise Refused("Choose an exercise you own.", 403)
            for identifier in dict.fromkeys(identifiers):
                source = repo.get(actor, "media", identifier, db)
                if source["kind"] != "exercise" or not source.get("exercise_id"):
                    raise Refused("Only exercise media can be copied here.")
                if source["exercise_id"] == exercise_id:
                    continue
                repo.get(actor, "exercises", source["exercise_id"], db)
                existing = db.execute(
                    "SELECT id FROM p_media WHERE exercise_id=? AND json_extract(detail,'$.copied_from')=?",
                    (exercise_id, identifier),
                ).fetchone()
                if existing:
                    result.append(existing[0])
                    continue
                source_path = Path(
                    db.execute(
                        "SELECT path FROM p_media WHERE id=?", (identifier,)
                    ).fetchone()[0]
                )
                if not source_path.is_file():
                    raise Refused(
                        "The source file is unavailable. Upload it again.", 410
                    )
                mid = uid()
                folder = repo.media_root / actor.org_id
                folder.mkdir(parents=True, exist_ok=True)
                path = folder / (mid + TYPES[source["mime"]])
                created.append(path)
                shutil.copyfile(source_path, path)
                db.execute(
                    "INSERT INTO p_media VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                    (
                        mid,
                        actor.org_id,
                        actor.user_id,
                        None,
                        exercise_id,
                        "exercise",
                        source["mime"],
                        source["filename"],
                        str(path),
                        path.stat().st_size,
                        now(),
                        encode({**source["detail"], "copied_from": identifier}),
                    ),
                )
                db.execute(
                    "INSERT INTO p_exercise_media VALUES (?,?)", (exercise_id, mid)
                )
                result.append(mid)
            repo.audit(db, actor, "copy:exercise-media", exercise_id)
    except Exception:
        for path in created:
            path.unlink(missing_ok=True)
        raise
    return {"media_ids": result}


def dicom_metadata(path):
    try:
        import pydicom

        ds = pydicom.dcmread(path, stop_before_pixels=True)
        syntax = str(ds.file_meta.TransferSyntaxUID)
        # Explicit little/big endian, implicit little endian, RLE and JPEG baseline.
        supported = syntax in (
            "1.2.840.10008.1.2",
            "1.2.840.10008.1.2.1",
            "1.2.840.10008.1.2.2",
            "1.2.840.10008.1.2.5",
            "1.2.840.10008.1.2.4.50",
        )
        rows, cols = int(ds.Rows), int(ds.Columns)
        frames = int(getattr(ds, "NumberOfFrames", 1))
        if min(rows, cols, frames) < 1 or rows * cols > 4_000_000 or frames > 500:
            raise Refused(
                "Use a DICOM image up to 4 megapixels per frame and 500 frames."
            )
        if not supported:
            raise Refused(
                "This DICOM compression is not supported. Export an uncompressed DICOM or PNG from the source viewer.",
                415,
            )
        return {
            "dicom": True,
            "width": cols,
            "height": rows,
            "frames": frames,
            "modality": str(getattr(ds, "Modality", "Unknown")),
            "study_date": str(getattr(ds, "StudyDate", "")),
            "photometric": str(ds.PhotometricInterpretation),
            "transfer_syntax": syntax,
            "window_center": float(
                ds.WindowCenter[0]
                if isinstance(
                    getattr(ds, "WindowCenter", None), pydicom.multival.MultiValue
                )
                else getattr(ds, "WindowCenter", 0)
            ),
            "window_width": float(
                ds.WindowWidth[0]
                if isinstance(
                    getattr(ds, "WindowWidth", None), pydicom.multival.MultiValue
                )
                else getattr(ds, "WindowWidth", 0)
            ),
            "pixel_spacing": [float(x) for x in getattr(ds, "PixelSpacing", [])],
            "provenance": "Supplied medical image; educational/manual visualization, no automatic diagnosis.",
        }
    except ImportError as exc:
        raise Refused("DICOM support is not installed on this server.", 503) from exc
    except Refused:
        raise
    except Exception as exc:
        raise Refused("This file could not be read as a DICOM image.", 415) from exc


def dicom_png(path, frame=0, center=None, width=None):
    import numpy as np
    import pydicom
    from PIL import Image

    ds = pydicom.dcmread(path, stop_before_pixels=True)
    frames = int(getattr(ds, "NumberOfFrames", 1))
    if not 0 <= frame < frames:
        raise Refused("Choose a frame within this scan.")
    try:
        arr = pydicom.pixels.pixel_array(path, index=frame).astype(np.float32)
    except Exception as exc:
        raise Refused(
            "The DICOM pixels could not be decoded. Export an uncompressed DICOM or PNG.",
            415,
        ) from exc
    if arr.ndim == 2:
        arr *= float(getattr(ds, "RescaleSlope", 1))
        arr += float(getattr(ds, "RescaleIntercept", 0))
        if width is None or width <= 0:
            low, high = float(np.min(arr)), float(np.max(arr))
            width = max(high - low, 1)
            center = (high + low) / 2
        if center is None:
            center = (float(np.min(arr)) + float(np.max(arr))) / 2
        low = float(center) - float(width) / 2
        arr = np.clip((arr - low) / max(float(width), 1), 0, 1) * 255
        if str(ds.PhotometricInterpretation) == "MONOCHROME1":
            arr = 255 - arr
    elif arr.ndim != 3 or arr.shape[2] not in (3, 4):
        raise Refused("This DICOM pixel layout is unsupported.", 415)
    out = io.BytesIO()
    Image.fromarray(arr.astype("uint8")).save(out, format="PNG")
    return out.getvalue()
