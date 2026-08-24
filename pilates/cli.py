"""Command line entry points.

    python -m pilates probe   VIDEO                  # inspect a source, plan zones
    python -m pilates analyse VIDEO --out out.jsonl  # run the pipeline
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

from .config import StudioConfig
from .geometry import posture, standard_angles, symmetry, trunk_angle
from .pipeline import Pipeline, VideoSource


def _load_config(path: str | None) -> StudioConfig:
    return StudioConfig.load(path) if path else StudioConfig()


def cmd_probe(args: argparse.Namespace) -> int:
    """Report source properties and save a grid-marked frame for zone setup."""
    import cv2

    with VideoSource(args.video) as src:
        print(f"source     : {src.path}")
        print(f"resolution : {src.width}x{src.height}")
        print(f"fps        : {src.fps:.3f}")
        print(f"frames     : {src.frame_count}")
        if src.fps:
            print(f"duration   : {src.frame_count / src.fps:.1f}s")

        target = args.at_frame if args.at_frame is not None else src.frame_count // 2
        src._cap.set(cv2.CAP_PROP_POS_FRAMES, max(0, target))
        ok, frame = src._cap.read()
    if not ok:
        print(f"could not read frame {target}", file=sys.stderr)
        return 1

    step = args.grid
    for x in range(0, frame.shape[1], step):
        cv2.line(frame, (x, 0), (x, frame.shape[0]), (0, 255, 255), 1)
        cv2.putText(frame, str(x), (x + 4, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 255), 1)
    for y in range(0, frame.shape[0], step):
        cv2.line(frame, (0, y), (frame.shape[1], y), (0, 255, 255), 1)
        cv2.putText(frame, str(y), (4, y + 18), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 255), 1)

    out = Path(args.out or "probe_frame.jpg")
    cv2.imwrite(str(out), frame)
    print(f"\ngrid frame -> {out}")
    print("Read mirror / doorway pixel coordinates off the grid and add them to")
    print('your config as: {"name": "left_mirror", "box": [x0, y0, x1, y1]}')
    return 0


def cmd_analyse(args: argparse.Namespace) -> int:
    config = _load_config(args.config)
    if args.stride is not None:
        config.frame_stride = args.stride
    if args.model_size:
        config.model_size = args.model_size

    pipeline = Pipeline(config)
    out_path = Path(args.out) if args.out else None
    handle = out_path.open("w") if out_path else None
    started = time.time()
    frames = 0

    try:
        with VideoSource(args.video, stride=config.frame_stride) as src:
            for result in pipeline.run(src):
                frames += 1
                record = {
                    "frame": result.frame_index,
                    "t": round(result.timestamp, 3),
                    "n_people": result.n_people,
                    "n_raw": result.n_raw,
                    "n_excluded": result.n_excluded,
                    "n_duplicates": result.n_duplicates,
                    "people": [
                        {
                            "id": person.track_id,
                            "confidence": round(person.detection.confidence, 3),
                            "visible_joints": person.detection.n_visible(config.keypoint_threshold),
                            "posture": posture(person.detection, config.keypoint_threshold),
                            "trunk_angle": _round(trunk_angle(person.detection, config.keypoint_threshold)),
                            "angles": {k: _round(v) for k, v in standard_angles(
                                person.detection, config.keypoint_threshold).items()},
                            "symmetry": {k: _round(v) for k, v in symmetry(standard_angles(
                                person.detection, config.keypoint_threshold)).items()},
                        }
                        for person in result.people
                    ],
                }
                if handle:
                    handle.write(json.dumps(record) + "\n")
                if args.verbose:
                    ids = ",".join(str(p.track_id) for p in result.people) or "-"
                    print(f"f{result.frame_index:6d}  people={result.n_people}  ids=[{ids}]"
                          f"  raw={result.n_raw} excl={result.n_excluded} dup={result.n_duplicates}")
    finally:
        if handle:
            handle.close()

    elapsed = time.time() - started
    stats = pipeline.stats
    print(f"\nframes analysed   : {frames}")
    print(f"elapsed           : {elapsed:.1f}s  ({frames / elapsed:.2f} fps)" if elapsed else "")
    print(f"raw detections    : {stats.raw_detections}")
    print(f"excluded (zones)  : {stats.excluded}  ({stats.exclusion_rate * 100:.1f}%)")
    print(f"duplicates removed: {stats.duplicates}  ({stats.duplicate_rate * 100:.1f}%)")
    print(f"tracked people    : {stats.tracked}  ({stats.tracked / frames:.2f} per frame)" if frames else "")
    if out_path:
        print(f"results           -> {out_path}")
    return 0


def _round(value: float | None) -> float | None:
    return None if value is None else round(value, 1)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="pilates", description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("probe", help="inspect a video and dump a grid frame for zone setup")
    p.add_argument("video")
    p.add_argument("--at-frame", type=int, default=None)
    p.add_argument("--grid", type=int, default=100, help="grid spacing in pixels")
    p.add_argument("--out", default=None)
    p.set_defaults(func=cmd_probe)

    a = sub.add_parser("analyse", help="run the pipeline over a video")
    a.add_argument("video")
    a.add_argument("--config", default=None, help="studio config JSON")
    a.add_argument("--out", default=None, help="write JSONL results here")
    a.add_argument("--stride", type=int, default=None, help="analyse every Nth frame")
    a.add_argument("--model-size", choices=("s", "m", "l"), default=None)
    a.add_argument("--verbose", action="store_true")
    a.set_defaults(func=cmd_analyse)

    args = parser.parse_args(argv)
    return args.func(args)
