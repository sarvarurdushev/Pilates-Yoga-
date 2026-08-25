"""Command line entry points.

    python -m pilates probe   VIDEO                  # inspect a source, plan zones
    python -m pilates analyse VIDEO --out out.jsonl  # run the pipeline
    python -m pilates sweep   VIDEO --expect 12      # find the resolution limit
    python -m pilates session VIDEO --out report.json # per-student movement report
    python -m pilates label   VIDEO --out labels.json # scaffold labels at the cuts
    python -m pilates check   labels.json             # validate a label file
    python -m pilates dataset VIDEO --labels l.json   # build training windows
    python -m pilates train   data.npz --out model.joblib  # train a recogniser
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


def cmd_label(args: argparse.Namespace) -> int:
    """Write a label file pre-split at the shot boundaries."""
    from .labels import scaffold
    from .shots import detect_shots

    shots = detect_shots(args.video, min_duration=args.min_shot)
    with VideoSource(args.video) as source:
        duration = source.frame_count / source.fps if source.fps else 0.0
        fps = source.fps
    size = Path(args.video).stat().st_size

    labels = scaffold(args.video, shots, fps, duration, size)
    out = Path(args.out or (Path(args.video).stem + ".labels.json"))
    if out.exists() and not args.overwrite:
        print(f"{out} already exists. Pass --overwrite to replace it.", file=sys.stderr)
        return 1
    labels.save(out)

    print(f"{len(shots)} shots found across {duration:.1f}s")
    for i, shot in enumerate(shots, 1):
        print(f"  {i:3d}. {shot.start_seconds:7.1f}s - {shot.end_seconds:7.1f}s  ({shot.duration:5.1f}s)")
    print(f"\nscaffold -> {out}")
    print("Fill in the exercise for each segment, splitting any that cover more")
    print("than one. Leave 'transition' where nothing is being performed.")
    print(f"Then check it with: python -m pilates check {out}")
    return 0


def cmd_check(args: argparse.Namespace) -> int:
    """Validate a label file and report what it contains."""
    from .labels import LabelSet

    labels = LabelSet.load(args.labels)
    problems = labels.validate()
    if problems:
        print(f"{len(problems)} problem(s) in {args.labels}:\n")
        for problem in problems:
            print(f"  - {problem}")
        return 1

    print(f"{args.labels} is valid.")
    print(f"  segments        : {len(labels.segments)}")
    print(f"  labelled        : {labels.labelled_seconds:.1f}s of {labels.duration:.1f}s "
          f"({labels.coverage * 100:.0f}%)")
    print(f"  actual exercise : {labels.exercise_seconds:.1f}s")
    counts = labels.counts()
    if counts:
        print("\n  seconds per label:")
        for name, seconds in counts.items():
            print(f"    {name:28s} {seconds:7.1f}s")
    return 0


def cmd_dataset(args: argparse.Namespace) -> int:
    """Build training windows from a labelled video."""
    from .dataset import build_from_video, save_dataset, summarise_dataset
    from .labels import LabelSet

    labels = LabelSet.load(args.labels)
    labels.check()

    size = Path(args.video).stat().st_size
    if labels.size_bytes and labels.size_bytes != size:
        print(f"Refusing to build: {args.labels} was written against a "
              f"{labels.size_bytes}-byte video but {args.video} is {size} bytes. "
              f"Every label would be applied to the wrong footage.", file=sys.stderr)
        return 1

    config = _load_config(args.config)
    if args.stride is not None:
        config.frame_stride = args.stride

    examples = build_from_video(
        args.video, labels, config,
        window_seconds=args.window, hop_seconds=args.hop,
        frames_per_window=args.frames,
        include_non_exercise=args.include_non_exercise,
    )
    if not examples:
        print("No training windows were produced. Either no segment is labelled "
              "as an exercise, or no student was tracked through one.", file=sys.stderr)
        return 1

    counts = summarise_dataset(examples)
    print(f"{len(examples)} windows of {args.window:.1f}s from {len(counts)} exercises\n")
    for name, count in counts.items():
        print(f"  {name:28s} {count:5d}")
    thin = [n for n, c in counts.items() if c < 20]
    if thin:
        print(f"\nToo thin to train on yet: {', '.join(thin)}")
        print("Around 20 windows per exercise is the point where a class starts")
        print("being learnable at all; several hundred is where it gets good.")
    if args.out:
        save_dataset(examples, args.out, labels)
        print(f"\ndataset -> {args.out}")
    return 0


def cmd_train(args: argparse.Namespace) -> int:
    """Train an exercise recogniser and report honestly on what it learned."""
    import numpy as np

    from .classifier import ExerciseClassifier, evaluate, featurise, majority_baseline

    data = np.load(args.dataset, allow_pickle=False)
    windows = data["features"]
    labels = data["labels"]
    names = [str(n) for n in data["label_names"]]
    tracks = data["track_ids"]

    print(f"{len(windows)} windows, {len(names)} exercises, "
          f"{len(np.unique(tracks))} distinct students")
    counts = np.bincount(labels, minlength=len(names))
    for i, name in enumerate(names):
        print(f"  {name:28s} {counts[i]:5d}")
    baseline = majority_baseline(labels)
    print(f"\nAlways guessing the most common exercise: {baseline * 100:.1f}%")
    print("Any model that does not clear that has learned nothing.\n")

    features = featurise(windows)

    random_split = evaluate(features, labels, names, groups=None,
                            protocol="Random split (LEAKY, for comparison only)",
                            kind=args.model, seed=args.seed)
    random_split.note = ("Overlapping windows and the same students appear on both "
                         "sides. Treat this as an upper bound, not a result.")
    print(random_split.format())
    print()

    grouped = evaluate(features, labels, names, groups=tracks,
                       protocol="Held-out students (honest)",
                       kind=args.model, seed=args.seed)
    print(grouped.format())

    if not np.isnan(random_split.accuracy) and not np.isnan(grouped.accuracy):
        gap = (random_split.accuracy - grouped.accuracy) * 100
        print(f"\nLeak gap: {gap:+.1f} points. That is how much the random split "
              f"flatters this model.")

    if len(np.unique(tracks)) < 5:
        print("\nToo few distinct students for the grouped score to mean much.")
    if len(names) < 3:
        print("Only two exercises: a coin flip scores 50%.")
    print("\nEvery window here comes from one session. Nothing above measures "
          "\ntransfer to another room, camera or teacher -- for that, label a "
          "\nsecond class and hold it out entirely.")

    if args.out:
        classifier = ExerciseClassifier(kind=args.model, seed=args.seed)
        classifier.fit(windows, labels, names)
        classifier.save(args.out)
        print(f"\nmodel -> {args.out}")
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

    l = sub.add_parser("label", help="scaffold a label file split at the shot cuts")
    l.add_argument("video")
    l.add_argument("--out", default=None)
    l.add_argument("--min-shot", type=float, default=3.0,
                   help="shots shorter than this are merged into the previous one")
    l.add_argument("--overwrite", action="store_true")
    l.set_defaults(func=cmd_label)

    c = sub.add_parser("check", help="validate a label file")
    c.add_argument("labels")
    c.set_defaults(func=cmd_check)

    d = sub.add_parser("dataset", help="build training windows from a labelled video")
    d.add_argument("video")
    d.add_argument("--labels", required=True)
    d.add_argument("--config", default=None)
    d.add_argument("--out", default=None, help="write the dataset as .npz")
    d.add_argument("--window", type=float, default=3.0, help="window length in seconds")
    d.add_argument("--hop", type=float, default=1.5, help="seconds between windows")
    d.add_argument("--frames", type=int, default=24, help="frames each window is resampled to")
    d.add_argument("--stride", type=int, default=None)
    d.add_argument("--include-non-exercise", action="store_true",
                   help="also emit windows for transition/instruction/rest")
    d.set_defaults(func=cmd_dataset)

    t = sub.add_parser("train", help="train an exercise recogniser from a dataset")
    t.add_argument("dataset", help=".npz produced by the dataset command")
    t.add_argument("--out", default=None, help="save the fitted model here")
    t.add_argument("--model", choices=("linear", "forest"), default="linear")
    t.add_argument("--seed", type=int, default=0)
    t.set_defaults(func=cmd_train)

    args = parser.parse_args(argv)
    return args.func(args)
