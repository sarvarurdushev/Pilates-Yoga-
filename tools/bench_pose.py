"""Benchmark a candidate pose backend against the RTMO one already in use.

Written because "there is a newer model on Hugging Face" is not a reason to
replace anything, and the only way to find out is to run both on the same
pictures and look. It reports what can honestly be measured without an
annotated set -- latency, peak memory, how many people were found, how
confident the joints came out, and how the count holds up as the bodies get
smaller -- and it does not report accuracy, because accuracy against no ground
truth is a number somebody would quote later.

Usage::

    python tools/bench_pose.py IMAGE [IMAGE ...] --repeats 3

The ViTPose comparison needs ``torch`` and ``transformers``, which are
deliberately *not* in ``requirements.txt``: the runtime is ONNX-only so it fits
a 2 vCPU free Space. Install them by hand to run this, and note that having to
is itself part of the answer.
"""
from __future__ import annotations

import argparse
import gc
import json
import resource
import time
from pathlib import Path

import cv2
import numpy as np


def peak_rss_mb() -> float:
    return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024.0


def boxes_from(detections, pad: float = 0.12, threshold: float = 0.3):
    """Person boxes from a one-stage result, to feed a top-down model.

    Lets the two models be compared on landmark quality rather than on whose
    detector found more people -- ViTPose has no detector of its own, so
    without this there is nothing to compare.
    """
    out = []
    for det in detections:
        keep = det.scores >= threshold
        if keep.sum() < 4:
            continue
        pts = det.keypoints[keep]
        x0, y0 = pts.min(axis=0)
        x1, y1 = pts.max(axis=0)
        w, h = x1 - x0, y1 - y0
        out.append([float(x0 - pad * w), float(y0 - pad * h),
                    float(w * (1 + 2 * pad)), float(h * (1 + 2 * pad))])
    return out


def bench_rtmo(frames, repeats, size="m"):
    from pilates.pose import RTMOBackend
    backend = RTMOBackend(size=size)
    backend(frames[0][1])                                   # warm the graph
    rows = []
    for name, frame in frames:
        times, found = [], 0
        for _ in range(repeats):
            gc.collect()
            start = time.perf_counter()
            dets = backend(frame)
            times.append(time.perf_counter() - start)
            found = len(dets)
        conf = [float(d.scores.mean()) for d in backend(frame)]
        rows.append({"image": name, "model": f"RTMO-{size}", "people": found,
                     "median_s": round(float(np.median(times)), 3),
                     "mean_joint_conf": round(float(np.mean(conf)), 3) if conf else None,
                     "peak_rss_mb": round(peak_rss_mb(), 1)})
    return rows, backend


def bench_vitpose(frames, repeats, backend, model_id="usyd-community/vitpose-base-simple"):
    import torch
    from transformers import AutoProcessor, VitPoseForPoseEstimation
    processor = AutoProcessor.from_pretrained(model_id)
    model = VitPoseForPoseEstimation.from_pretrained(model_id).eval()
    rows = []
    for name, frame in frames:
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        boxes = boxes_from(backend(frame))
        if not boxes:
            rows.append({"image": name, "model": model_id.split("/")[-1],
                         "people": 0, "median_s": None, "mean_joint_conf": None,
                         "note": "no boxes: a top-down model has nothing to run on"})
            continue
        times, conf = [], []
        for _ in range(repeats):
            gc.collect()
            start = time.perf_counter()
            inputs = processor(rgb, boxes=[boxes], return_tensors="pt")
            with torch.no_grad():
                out = model(**inputs)
            result = processor.post_process_pose_estimation(out, boxes=[boxes])
            times.append(time.perf_counter() - start)
            conf = [float(p["scores"].mean()) for p in result[0]]
        rows.append({"image": name, "model": model_id.split("/")[-1],
                     "people": len(boxes),
                     "median_s": round(float(np.median(times)), 3),
                     "mean_joint_conf": round(float(np.mean(conf)), 3) if conf else None,
                     "peak_rss_mb": round(peak_rss_mb(), 1),
                     "note": "boxes supplied by RTMO; needs a detector of its own"})
    return rows


def shrink(frame, scale):
    """The wide-camera case: the same scene with everyone further away."""
    h, w = frame.shape[:2]
    small = cv2.resize(frame, (int(w * scale), int(h * scale)))
    canvas = np.zeros_like(frame)
    canvas[: small.shape[0], : small.shape[1]] = small
    return canvas


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("images", nargs="+")
    ap.add_argument("--repeats", type=int, default=3)
    ap.add_argument("--rtmo-size", default="m")
    ap.add_argument("--out", default="")
    ap.add_argument("--skip-vitpose", action="store_true")
    args = ap.parse_args()

    frames = []
    for path in args.images:
        frame = cv2.imread(path)
        if frame is None:
            print(f"  !! could not read {path}")
            continue
        frames.append((Path(path).stem, frame))
        for scale in (0.5, 0.25):
            frames.append((f"{Path(path).stem}@{scale:g}x", shrink(frame, scale)))
    if not frames:
        return 1

    rows, backend = bench_rtmo(frames, args.repeats, args.rtmo_size)
    if not args.skip_vitpose:
        try:
            rows += bench_vitpose(frames, args.repeats, backend)
        except ImportError as exc:
            print(f"  (vitpose skipped: {exc})")

    width = max(len(r["image"]) for r in rows) + 2
    print(f"\n{'image':<{width}}{'model':<22}{'people':>7}{'median s':>10}"
          f"{'joint conf':>12}{'peak MB':>9}")
    for r in rows:
        print(f"{r['image']:<{width}}{r['model']:<22}{r['people']:>7}"
              f"{(r['median_s'] if r['median_s'] is not None else '—'):>10}"
              f"{(r['mean_joint_conf'] if r['mean_joint_conf'] is not None else '—'):>12}"
              f"{r.get('peak_rss_mb', '—'):>9}")
    if args.out:
        Path(args.out).write_text(json.dumps(rows, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
