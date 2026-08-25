"""Command line entry points.

    python -m pilates probe   VIDEO                  # inspect a source, plan zones
    python -m pilates analyse VIDEO --out out.jsonl  # run the pipeline
    python -m pilates sweep   VIDEO --expect 12      # find the resolution limit
    python -m pilates session VIDEO --out report.json # per-student movement report
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


def cmd_sweep(args: argparse.Namespace) -> int:
    """Downscale the clip in steps and report where detection and identity fail."""
    from .benchmark import format_table, minimum_person_height, sweep

    config = _load_config(args.config)
    scales = [float(s) for s in args.scales.split(",")]
    results = sweep(
        args.video,
        scales,
        expected_people=args.expect,
        config=config,
        start_frame=args.start,
        end_frame=args.end,
        stride=args.stride,
    )
    print(format_table(results))
    smallest = minimum_person_height(results)
    if smallest:
        print(f"\nIdentity still held with students {smallest:.0f} px tall.")
        print("If that is well below what your camera gives, resolution is not")
        print("your limiting factor -- check neighbour overlap instead.")
    else:
        print("\nIdentity held at no scale. Students are too crowded, not too small.")
    return 0


def cmd_session(args: argparse.Namespace) -> int:
    """Analyse a class and report what each student actually did."""
    from .movement import SessionRecorder

    config = _load_config(args.config)
    if args.stride is not None:
        config.frame_stride = args.stride
    pipeline = Pipeline(config)
    recorder = SessionRecorder(
        keypoint_threshold=config.keypoint_threshold, min_range=args.min_range
    )

    with VideoSource(
        args.video, stride=config.frame_stride,
        start_frame=args.start, end_frame=args.end,
    ) as source:
        for result in pipeline.run(source):
            recorder.observe(result)

    quality = recorder.quality()
    summaries = recorder.summaries(min_samples=args.min_samples)
    if not summaries:
        print("No student was tracked long enough to report on.")
        return 1

    print(quality.explain())
    if not quality.reliable and not args.force:
        print("\nRefusing to print per-student reports. Re-run with --force to see "
              "them anyway, but do not act on them.")
        return 2

    for s in summaries:
        print(f"\nStudent #{s.track_id}")
        print(f"  tracked          : {s.duration:.1f}s over {s.samples} frames")
        if s.kind == "held":
            print("  movement         : held a position - no repetitions detected")
        elif s.kind == "sequence":
            print(f"  movement         : a sequence of poses, not a repeated exercise")
            print(f"  measured on      : {s.signal} "
                  f"(keypoint confidence {s.signal_confidence:.2f})")
        else:
            print(f"  measured on      : {s.signal} "
                  f"(keypoint confidence {s.signal_confidence:.2f})")
            print(f"  repetitions      : {s.repetitions}")
        if s.mean_range is not None:
            spread = f" (varying by {s.range_consistency:.0f}deg)" if s.range_consistency else ""
            print(f"  range of motion  : {s.mean_range:.0f}deg{spread}")
        if s.mean_rep_duration is not None:
            print(f"  seconds per rep  : {s.mean_rep_duration:.1f}")
        if s.mean_tempo_ratio is not None:
            if s.mean_tempo_ratio < 0.9:
                verdict = "return faster than lift"
            elif s.mean_tempo_ratio <= 2.0:
                verdict = "controlled return"
            else:
                verdict = "very uneven - check the phases were segmented correctly"
            print(f"  tempo ratio      : {s.mean_tempo_ratio:.2f}  ({verdict})")
        if s.control_ratio is not None:
            verdict = "smooth" if s.control_ratio <= 1.5 else "wobbly"
            print(f"  control          : {s.control_ratio:.2f}  ({verdict}, 1.0 is ideal)")
        if s.longest_hold is not None:
            print(f"  longest hold     : {s.longest_hold:.1f}s")
        pairs = {k: v for k, v in s.mean_symmetry.items() if v is not None}
        if pairs:
            print("  left/right gap   : " + ", ".join(f"{k} {v:.0f}deg" for k, v in pairs.items()))

    if args.out:
        payload = [
            {
                "track_id": s.track_id, "signal": s.signal, "kind": s.kind,
                "samples": s.samples,
                "signal_confidence": _round(s.signal_confidence),
                "duration_s": round(s.duration, 2), "repetitions": s.repetitions,
                "mean_range_deg": _round(s.mean_range),
                "range_consistency_deg": _round(s.range_consistency),
                "mean_rep_duration_s": _round(s.mean_rep_duration),
                "mean_tempo_ratio": _round(s.mean_tempo_ratio),
                "control_ratio": _round(s.control_ratio),
                "longest_hold_s": _round(s.longest_hold),
                "mean_symmetry_deg": {k: _round(v) for k, v in s.mean_symmetry.items()},
            }
            for s in summaries
        ]
        Path(args.out).write_text(json.dumps(payload, indent=2) + "\n")
        print(f"\nreport -> {args.out}")
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

    w = sub.add_parser("sweep", help="find the resolution at which tracking fails")
    w.add_argument("video")
    w.add_argument("--expect", type=int, required=True,
                   help="true number of people in the clip, counted by hand")
    w.add_argument("--config", default=None)
    w.add_argument("--scales", default="1.0,0.75,0.5,0.4,0.3,0.25,0.2,0.15,0.125")
    w.add_argument("--start", type=int, default=0)
    w.add_argument("--end", type=int, default=None)
    w.add_argument("--stride", type=int, default=10)
    w.set_defaults(func=cmd_sweep)

    n = sub.add_parser("session", help="per-student movement report for a class")
    n.add_argument("video")
    n.add_argument("--config", default=None)
    n.add_argument("--out", default=None, help="write the report as JSON")
    n.add_argument("--stride", type=int, default=None)
    n.add_argument("--min-range", type=float, default=15.0,
                   help="smallest angular excursion counted as a repetition, in degrees")
    n.add_argument("--min-samples", type=int, default=10,
                   help="frames a student must be tracked for before reporting")
    n.add_argument("--start", type=int, default=0,
                   help="first frame to analyse (use one continuous shot)")
    n.add_argument("--end", type=int, default=None, help="last frame to analyse")
    n.add_argument("--force", action="store_true",
                   help="print per-student reports even when tracking is too unstable "
                        "for them to describe real people")
    n.set_defaults(func=cmd_session)

    args = parser.parse_args(argv)
    return args.func(args)
