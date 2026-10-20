"""Record RTMO landmarks from the demo four-view image, for the camera tests.

The camera-integrity tests (``tests/test_camera_integrity.py``) need landmarks
from a real pose model on photographs whose facing direction is known, and the
test suite cannot assume the 89 MB RTMO checkpoint is present. So this script
runs RTMO once and writes what it found, with enough provenance to rerun it:

* the source image and its SHA-256 (``web/assets/studio/demo-four-views.png``,
  an AI-generated illustrative photograph of one fictional person, four panels
  of 384 px: front, back, facing image-right, facing image-left);
* each panel padded by 192 px of replicated border on both sides, so the body
  sits well inside the frame;
* the model (RTMO-m, ``rtmlib``, ONNX Runtime on CPU, score threshold 0.3) and
  the most confident detection in each crop;
* the same crops mirrored horizontally (``cv2.flip(crop, 1)``);
* the same crops rolled from -3 to +3 degrees about their centre
  (``cv2.getRotationMatrix2D``; positive is counter-clockwise on screen).

The facing direction of each panel is written down by hand, from looking at
the picture, not from the model: the third panel's nose points to image right,
the fourth panel's to image left. That is the independent label the tests
check the geometry against.

Run: ``.venv/bin/python tools/camera_integrity_fixture.py``. It rewrites
``tests/data/camera_integrity_rtmo.json``. Results can differ in the last
decimal between ONNX Runtime builds.
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

IMAGE = ROOT / "web/assets/studio/demo-four-views.png"
OUT = ROOT / "tests/data/camera_integrity_rtmo.json"
PANEL = 384
PAD = 192
#: Written down by looking at each panel; never derived from the model.
PANELS = (
    ("front", "facing the camera"),
    ("back", "back to the camera"),
    ("faces_image_right", "profile; nose points to image right"),
    ("faces_image_left", "profile; nose points to image left"),
)
ROLLS = (-3, -2, -1, 0, 1, 2, 3)


def main() -> None:
    import cv2

    from pilates.pose import RTMOBackend

    image = cv2.imread(str(IMAGE))
    backend = RTMOBackend("m")

    def landmarks(frame):
        found = backend(frame)
        if not found:
            return None
        best = max(found, key=lambda d: d.confidence)
        return {"keypoints": [[round(float(x), 1), round(float(y), 1)]
                              for x, y in best.keypoints],
                "scores": [round(float(s), 3) for s in best.scores]}

    crops = {}
    for index, (name, _) in enumerate(PANELS):
        crop = image[:, index * PANEL:(index + 1) * PANEL]
        crops[name] = cv2.copyMakeBorder(crop, 0, 0, PAD, PAD, cv2.BORDER_REPLICATE)

    out = {
        "provenance": {
            "image": str(IMAGE.relative_to(ROOT)),
            "image_sha256": hashlib.sha256(IMAGE.read_bytes()).hexdigest(),
            "image_note": "AI-generated illustrative photograph of one fictional person; no real participant",
            "panel_width_px": PANEL,
            "padding_px_each_side": PAD,
            "model": "RTMO-m (rtmo-m_16xb16-600e_body7-640x640-39e78cc4_20231211), rtmlib, onnxruntime CPU, score_thr 0.3",
            "selection": "the most confident detection in each crop",
            "mirror": "cv2.flip(crop, 1)",
            "roll": "cv2.warpAffine with cv2.getRotationMatrix2D(centre, degrees, 1.0), BORDER_REPLICATE; positive is counter-clockwise",
            "script": "tools/camera_integrity_fixture.py",
        },
        "panels": {},
    }
    for name, truth in PANELS:
        crop = crops[name]
        h, w = crop.shape[:2]
        entry = {"truth": truth, "width": w, "height": h,
                 "plain": landmarks(crop),
                 "mirrored": landmarks(cv2.flip(crop, 1)),
                 "roll": {}}
        for degrees in ROLLS:
            matrix = cv2.getRotationMatrix2D((w / 2, h / 2), degrees, 1.0)
            rolled = cv2.warpAffine(crop, matrix, (w, h), borderMode=cv2.BORDER_REPLICATE)
            entry["roll"][str(degrees)] = landmarks(rolled)
        out["panels"][name] = entry
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, indent=1) + "\n")
    print(f"wrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
