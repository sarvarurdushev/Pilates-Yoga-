"""Render defaults compatible with the existing pip-build / pilates-web service."""

import hashlib
import os
from pathlib import Path
import urllib.request

MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/"
    "pose_landmarker_full/float16/1/pose_landmarker_full.task"
)
MODEL_SHA256 = "5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1"


def metadata():
    return {
        "platform": "render" if os.environ.get("RENDER") == "true" else "local",
        "commit": os.environ.get("RENDER_GIT_COMMIT", ""),
    }


def prepare_render():
    """Cache pinned 3D weights on first analysis, without loading either model.

    An explicit model configuration is respected. A failed download leaves 2D
    available and the capability endpoint reports 3D as unavailable.
    """
    if os.environ.get("RENDER") != "true":
        return
    os.environ.setdefault("PILATES_CPU_THREADS", "1")
    if os.environ.get("PILATES_3D_MODEL"):
        return
    target = Path(os.environ.get("XDG_CACHE_HOME", "/tmp/cache")) / "pose_landmarker_full.task"
    try:
        if not target.is_file() or hashlib.sha256(target.read_bytes()).hexdigest() != MODEL_SHA256:
            target.parent.mkdir(parents=True, exist_ok=True)
            with urllib.request.urlopen(MODEL_URL, timeout=30) as response:
                data = response.read(20 * 1024 * 1024)
            if hashlib.sha256(data).hexdigest() != MODEL_SHA256:
                raise ValueError("3D model checksum mismatch")
            temp = target.with_suffix(".download")
            temp.write_bytes(data)
            temp.replace(target)
        os.environ["PILATES_3D_MODEL"] = str(target)
        print("Render: verified 3D model ready", flush=True)
    except (OSError, ValueError) as exc:
        print(f"Render: optional 3D model unavailable ({exc}); 2D remains available", flush=True)
