"""Compare CPU costs; emits raw landmarks, never an unsupported accuracy score."""

import argparse
import json
import time
from pathlib import Path
import cv2
from pilates.pose import RTMOBackend
from pilates import pose3d

p = argparse.ArgumentParser()
p.add_argument("images", nargs="+", type=Path)
p.add_argument(
    "--vitpose", type=Path, help="Optional downloaded ViTPose Base Simple ONNX"
)
p.add_argument("--out", type=Path, required=True)
a = p.parse_args()
rtmo = RTMOBackend()
vit = None
if a.vitpose:
    from rtmlib import ViTPose
    import onnxruntime as ort

    vit = ViTPose(str(a.vitpose))
    options = ort.SessionOptions()
    options.intra_op_num_threads = 4
    options.inter_op_num_threads = 1
    vit.session = ort.InferenceSession(
        str(a.vitpose), sess_options=options, providers=["CPUExecutionProvider"]
    )
rows = []
for path in a.images:
    frame = cv2.imread(str(path))
    if frame is None:
        raise ValueError(f"Cannot decode {path}")
    start = time.perf_counter()
    found = rtmo(frame)
    elapsed = time.perf_counter() - start
    row = {
        "file": str(path),
        "rtmo_s": elapsed,
        "people": len(found),
        "rtmo": [
            {"keypoints": d.keypoints.tolist(), "scores": d.scores.tolist()}
            for d in found
        ],
    }
    boxes = [d.bbox(0.4) for d in found if d.bbox(0.4) is not None]
    if vit and boxes:
        start = time.perf_counter()
        points, scores = vit(frame, boxes)
        row["vitpose_s_excluding_detector"] = time.perf_counter() - start
        row["vitpose"] = {"keypoints": points.tolist(), "scores": scores.tolist()}
    row["world"] = []
    for d in found:
        start = time.perf_counter()
        out = pose3d.estimate(frame, d)
        row["world"].append({"seconds": time.perf_counter() - start, "result": out})
    rows.append(row)
a.out.parent.mkdir(parents=True, exist_ok=True)
a.out.write_text(
    json.dumps(
        {
            "note": "Single trials; no ground-truth accuracy is asserted.",
            "results": rows,
        },
        indent=2,
        allow_nan=False,
    )
)
