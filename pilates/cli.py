"""Command line entry points.

    python -m pilates probe   VIDEO                  # inspect a source, plan zones
    python -m pilates analyse VIDEO --out out.jsonl  # run the pipeline
    python -m pilates sweep   VIDEO --expect 12      # find the resolution limit
    python -m pilates session VIDEO --out report.json # per-student movement report
    python -m pilates label   VIDEO --out labels.json # scaffold labels at the cuts
    python -m pilates check   labels.json             # validate a label file
    python -m pilates dataset VIDEO --labels l.json   # build training windows
    python -m pilates preview labels.json --video V   # contact sheets to verify labels
    python -m pilates train   data.npz --out model.joblib  # train a recogniser
    python -m pilates calibrate points.json --out floor.json  # link two cameras
    python -m pilates coach VIDEO --exercise plank    # coaching notes for a student
    python -m pilates progress "Anna" --exercise plank  # how a student has changed
    python -m pilates report VIDEO --exercise plank --name "Anna"  # take-away page
    python -m pilates roster VIDEO --out roster.json  # who is which track id
    python -m pilates class VIDEO --labels l.json --roster r.json  # the whole class
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
        save_dataset(examples, args.out, labels, session=args.session)
        print(f"\ndataset -> {args.out}")
    return 0


def cmd_preview(args: argparse.Namespace) -> int:
    """Write a contact sheet per labelled segment, so labels can be eyeballed."""
    import cv2
    import numpy as np

    from .labels import LabelSet, contact_sheet_times

    labels = LabelSet.load(args.labels)
    out_dir = Path(args.out or "label_preview")
    out_dir.mkdir(parents=True, exist_ok=True)

    cap = cv2.VideoCapture(args.video)
    if not cap.isOpened():
        print(f"could not open {args.video}", file=sys.stderr)
        return 1
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0

    written = 0
    for index, segment in enumerate(labels.segments, 1):
        if args.exercise and segment.exercise != args.exercise:
            continue
        if not args.include_non_exercise and not segment.is_exercise:
            continue
        tiles = []
        for timestamp in contact_sheet_times(segment, args.frames):
            cap.set(cv2.CAP_PROP_POS_FRAMES, int(timestamp * fps))
            ok, frame = cap.read()
            if not ok:
                continue
            frame = cv2.resize(frame, (426, 240))
            for colour, thickness in (((0, 0, 0), 4), ((0, 255, 255), 2)):
                cv2.putText(frame, f"{timestamp:.0f}s", (8, 26),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.8, colour, thickness)
            tiles.append(frame)
        if len(tiles) < 2:
            continue
        half = (len(tiles) + 1) // 2
        top, bottom = tiles[:half], tiles[half:]
        while len(bottom) < len(top):
            bottom.append(np.zeros_like(top[0]))
        sheet = np.vstack([np.hstack(top), np.hstack(bottom)])
        path = out_dir / f"{index:02d}_{segment.exercise}_{segment.start:.0f}s.jpg"
        cv2.imwrite(str(path), sheet, [cv2.IMWRITE_JPEG_QUALITY, 90])
        written += 1
    cap.release()

    print(f"{written} contact sheet(s) -> {out_dir}")
    print("Check that every frame in a sheet really is the exercise it is named.")
    print("A label taken from one frame of a long shot is how a standing back bend")
    print("ends up recorded as an upward salute.")
    return 0


def cmd_coach(args: argparse.Namespace) -> int:
    """Assess students against a standard and write coaching notes."""
    from .coaching import (
        DEFAULT_STANDARDS, assess, assess_tempo, load_standards, narrate,
    )
    from .movement import SessionRecorder, summarise

    standards = load_standards(args.standards) if args.standards else DEFAULT_STANDARDS
    from .coaching import UNSUITABLE

    standard = standards.get(args.exercise)
    if standard is None:
        if args.exercise in UNSUITABLE:
            print(f"{args.exercise} is not assessed from a single camera: "
                  f"{UNSUITABLE[args.exercise]}.", file=sys.stderr)
            print("This is not a missing feature. A second camera at an angle "
                  "would be needed.", file=sys.stderr)
            return 1
        print(f"No standard for {args.exercise!r}. Known: "
              f"{', '.join(sorted(standards))}", file=sys.stderr)
        print("Standards are data -- write your own with --standards.", file=sys.stderr)
        return 1

    config = _load_config(args.config)
    if args.stride is not None:
        config.frame_stride = args.stride
    pipeline = Pipeline(config)
    recorder = SessionRecorder(keypoint_threshold=config.keypoint_threshold)

    with VideoSource(args.video, stride=config.frame_stride,
                     start_frame=args.start, end_frame=args.end) as source:
        for result in pipeline.run(source):
            recorder.observe(result)

    quality = recorder.quality()
    histories = {
        track_id: history for track_id, history in recorder.histories.items()
        if len(history.samples) >= args.min_samples
    }
    if not histories:
        print("No student was tracked long enough to assess.")
        return 1
    if args.student is not None:
        histories = {k: v for k, v in histories.items() if k == args.student}
        if not histories:
            print(f"Student #{args.student} was not tracked in this clip.", file=sys.stderr)
            return 1

    if len(histories) > 1 and not quality.reliable:
        print(quality.explain())
        print("\nRefusing to write coaching notes: these would mix several people "
              "together.\nAssess a single student with --student, or fix the camera view.")
        return 2

    print(f"Exercise: {standard.exercise}")
    if standard.notes:
        print(f"  ({standard.notes})")

    for track_id, history in sorted(histories.items()):
        assessment = assess(history, standard, config.keypoint_threshold)
        summary = summarise(history)
        print(f"\n--- Student #{track_id} "
              f"({history.duration:.0f}s, {len(history.samples)} frames, "
              f"pose confidence {assessment.confidence:.2f}) ---")
        if summary is not None:
            tempo = assess_tempo(summary, standard)
            if tempo is not None:
                assessment.findings.append(tempo)
        print(narrate(assessment, name=f"Student #{track_id}"))

    if args.save_history:
        from datetime import date as _date

        from .history import HistoryStore, SessionRecord, measure_session

        names = _student_names(args)
        if not names:
            print("\nNot saving history: pass --name with --student, or --names "
                  "to say who each track id is.", file=sys.stderr)
            return 1
        store = HistoryStore.load(args.save_history)
        when = args.date or _date.today().isoformat()
        saved = 0
        for track_id, history in sorted(histories.items()):
            student = names.get(track_id)
            if student is None:
                continue
            assessment = assess(history, standard, config.keypoint_threshold)
            store.add(SessionRecord(
                student=student, date=when, exercise=standard.exercise,
                measurements=measure_session(history, assessment),
                video=Path(args.video).name, track_id=track_id,
            ))
            saved += 1
        store.save(args.save_history)
        print(f"\nSaved {saved} session record(s) -> {args.save_history}")
        unnamed = sorted(set(histories) - set(names))
        if unnamed:
            print(f"Not saved (no name given): students {unnamed}")

    print("\nThese are geometric observations about movement, not health advice. "
          "\nWhether any of them matters for a particular body is your call.")
    return 0


def _student_names(args: argparse.Namespace) -> dict[int, str]:
    """Who each track id is. Supplied by a person, never inferred from video."""
    if args.names:
        return {int(k): v for k, v in json.loads(args.names).items()}
    if args.name and args.student is not None:
        return {args.student: args.name}
    return {}


def cmd_progress(args: argparse.Namespace) -> int:
    """Show how one student has changed across sessions."""
    from .history import HistoryStore, progress_report

    store = HistoryStore.load(args.store)
    if not store.records:
        print(f"No history in {args.store}. Record some with "
              f"`pilates coach ... --save-history {args.store}`.", file=sys.stderr)
        return 1

    if args.student_name not in store.students():
        print(f"No records for {args.student_name!r}. Known: "
              f"{', '.join(store.students())}", file=sys.stderr)
        return 1

    exercises = ([args.exercise] if args.exercise
                 else store.exercises_for(args.student_name))
    for exercise in exercises:
        print(progress_report(store, args.student_name, exercise))
        print()
    return 0


def cmd_report(args: argparse.Namespace) -> int:
    """Write a take-away HTML report for one student."""
    from .coaching import DEFAULT_STANDARDS, UNSUITABLE, assess, load_standards
    from .history import HistoryStore
    from .movement import SessionRecorder, summarise
    from .report import build, write

    standards = load_standards(args.standards) if args.standards else DEFAULT_STANDARDS
    standard = standards.get(args.exercise)
    if standard is None:
        if args.exercise in UNSUITABLE:
            print(f"{args.exercise} is not assessed from a single camera: "
                  f"{UNSUITABLE[args.exercise]}.", file=sys.stderr)
            return 1
        print(f"No standard for {args.exercise!r}. Known: "
              f"{', '.join(sorted(standards))}", file=sys.stderr)
        return 1

    config = _load_config(args.config)
    if args.stride is not None:
        config.frame_stride = args.stride
    pipeline = Pipeline(config)
    recorder = SessionRecorder(keypoint_threshold=config.keypoint_threshold)

    with VideoSource(args.video, stride=config.frame_stride,
                     start_frame=args.start, end_frame=args.end) as source:
        for result in pipeline.run(source):
            recorder.observe(result)

    history = recorder.histories.get(args.student)
    if history is None or len(history.samples) < args.min_samples:
        print(f"Student #{args.student} was not tracked long enough to report on.",
              file=sys.stderr)
        return 1

    store = HistoryStore.load(args.history) if args.history else None
    report = build(
        student=args.name, exercise=standard.exercise,
        assessment=assess(history, standard, config.keypoint_threshold),
        summary=summarise(history), store=store, date=args.date, studio=args.studio,
    )
    out = write(report, args.out or f"{args.name.replace(' ', '_')}_{report.date}.html")
    print(f"report -> {out}")
    print(f"  {len(report.assessment.good)} thing(s) going well, "
          f"{len(report.assessment.improve)} to work on, "
          f"{len(report.assessment.unmeasured)} not measurable")
    if report.sessions_recorded:
        print(f"  includes progress across {report.sessions_recorded} recorded session(s)")
    return 0


def cmd_roster(args: argparse.Namespace) -> int:
    """Find the students in a class and write a roster stub with reference crops.

    Nobody knows who student 7 is, so each tracked person gets a picture from
    the frame where they were most confidently detected, for the teacher to look
    at while filling in the name.
    """
    import cv2

    from .classroom import Roster
    from .movement import SessionRecorder

    config = _load_config(args.config)
    if args.stride is not None:
        config.frame_stride = args.stride
    pipeline = Pipeline(config)
    recorder = SessionRecorder(keypoint_threshold=config.keypoint_threshold)

    # Remember where each student looked clearest, and their box there.
    clearest: dict[int, tuple[float, int, tuple]] = {}
    with VideoSource(args.video, stride=config.frame_stride,
                     start_frame=args.start, end_frame=args.end) as source:
        for result in pipeline.run(source):
            recorder.observe(result)
            for person in result.people:
                box = person.detection.bbox(config.keypoint_threshold)
                if box is None:
                    continue
                score = person.detection.confidence
                if score > clearest.get(person.track_id, (0.0, 0, ()))[0]:
                    clearest[person.track_id] = (score, result.frame_index, box)

    tracks = [t for t, h in recorder.histories.items()
              if len(h.samples) >= args.min_samples]
    if not tracks:
        print("No student was tracked long enough to put on a roster.", file=sys.stderr)
        return 1

    out_dir = Path(args.crops or "roster_crops")
    out_dir.mkdir(parents=True, exist_ok=True)
    cap = cv2.VideoCapture(args.video)
    written = 0
    for track_id in sorted(tracks):
        if track_id not in clearest:
            continue
        _, frame_index, box = clearest[track_id]
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_index)
        ok, frame = cap.read()
        if not ok:
            continue
        height, width = frame.shape[:2]
        pad = args.pad
        x0 = max(0, int(box[0] - pad))
        y0 = max(0, int(box[1] - pad))
        x1 = min(width, int(box[2] + pad))
        y1 = min(height, int(box[3] + pad))
        if x1 - x0 < 8 or y1 - y0 < 8:
            continue
        crop = frame[y0:y1, x0:x1]
        scale = 360 / max(1, crop.shape[0])
        crop = cv2.resize(crop, (max(1, int(crop.shape[1] * scale)), 360))
        cv2.putText(crop, f"student {track_id}", (8, 28),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 0), 4)
        cv2.putText(crop, f"student {track_id}", (8, 28),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 255), 2)
        cv2.imwrite(str(out_dir / f"student_{track_id:02d}.jpg"), crop,
                    [cv2.IMWRITE_JPEG_QUALITY, 88])
        written += 1
    cap.release()

    roster = Roster.stub(tracks, video=Path(args.video).name,
                         start_frame=args.start, end_frame=args.end)
    out = Path(args.out or "roster.json")
    roster.save(out)
    print(f"{len(tracks)} student(s) tracked: {sorted(tracks)}")
    print(f"roster stub  -> {out}")
    print(f"reference crops -> {out_dir} ({written} written)")
    print("Fill in each name by looking at the crops. Rows still starting with "
          "'?' are skipped when the class is run.")
    if args.end is None:
        print("\nNote: this roster covers the whole video. Track ids restart at "
              "every cut,\nso if the video is edited, build one roster per "
              "continuous shot with --start/--end.")
    return 0


def cmd_class(args: argparse.Namespace) -> int:
    """Run a whole class: a report per named student, plus a teacher page."""
    from .classroom import Roster, class_patterns, run_class
    from .coaching import DEFAULT_STANDARDS, load_standards
    from .history import HistoryStore, SessionRecord, measure_session
    from .labels import LabelSet
    from .report import build, render_class_summary, write

    labels = LabelSet.load(args.labels)
    problems = labels.validate()
    if problems:
        print(f"{args.labels} has {len(problems)} problem(s); fix them first "
              f"with `pilates check`.", file=sys.stderr)
        return 1

    roster = Roster.load(args.roster)
    if roster.named == 0:
        print(f"{args.roster} has no real names yet -- every entry still starts "
              f"with '?'. Fill it in first.", file=sys.stderr)
        return 1

    standards = load_standards(args.standards) if args.standards else DEFAULT_STANDARDS
    config = _load_config(args.config)
    if args.stride is not None:
        config.frame_stride = args.stride

    result = run_class(args.video, labels, roster, config, standards,
                       date=args.date, min_samples=args.min_samples,
                       start_frame=args.start, end_frame=args.end)

    coverage = result.coverage
    if coverage is not None and not coverage.ok and not args.force:
        print(f"Refusing to run: {coverage.message}", file=sys.stderr)
        print(f"\nThis roster was built over {roster.range_note}.", file=sys.stderr)
        print("Producing reports for a handful of students and silently "
              "dropping the rest\nis worse than stopping. Pass --force to "
              "override.", file=sys.stderr)
        return 2

    if not result.students:
        print("Nothing to report: no named student was tracked through a "
              "labelled exercise.", file=sys.stderr)
        return 1

    out_dir = Path(args.out_dir or "class_reports")
    out_dir.mkdir(parents=True, exist_ok=True)
    store = HistoryStore.load(args.history) if args.history else None

    for student in result.students:
        report = build(
            student=student.name, exercise=student.exercise,
            assessment=student.assessment, summary=student.summary,
            store=store, date=args.date, studio=args.studio,
        )
        safe = "".join(c if c.isalnum() else "_" for c in student.name)
        write(report, out_dir / f"{safe}_{student.exercise}.html")
        if store is not None and student.history is not None:
            store.add(SessionRecord(
                student=student.name, date=report.date, exercise=student.exercise,
                measurements=measure_session(student.history, student.assessment),
                video=result.video, track_id=student.track_id,
            ))

    patterns = class_patterns(result, min_affected=args.min_affected)
    summary_path = out_dir / "class_summary.html"
    summary_path.write_text(
        render_class_summary(result, patterns, studio=args.studio), encoding="utf-8"
    )
    if store is not None:
        store.save(args.history)

    print(f"{len(result.students)} report(s) for {len(result.names)} student(s) "
          f"-> {out_dir}")
    print(f"class summary -> {summary_path}")
    if result.skipped_unnamed:
        print(f"skipped (no name in roster): students {result.skipped_unnamed}")
    if patterns:
        print(f"\n{len(patterns)} thing(s) more than one student found hard:")
        for pattern in patterns[:5]:
            print(f"  {pattern.affected}/{pattern.measured} in "
                  f"{pattern.exercise}: {pattern.message}")
    else:
        print("\nNothing was flagged for more than one student.")
    if store is not None:
        print(f"history updated -> {args.history}")
    return 0


def cmd_calibrate(args: argparse.Namespace) -> int:
    """Fit the floor homography linking two camera views.

    ``points.json`` holds matching floor points read off both views, e.g. mat
    corners. Get the coordinates with `pilates probe` on each video, which
    writes a frame with a pixel grid over it.

        {"primary":   [[120, 640], [510, 620], ...],
         "secondary": [[300, 700], [640, 690], ...]}
    """
    import numpy as np

    from .multiview import CalibrationError, FloorHomography

    payload = json.loads(Path(args.points).read_text())
    try:
        primary = np.asarray(payload["primary"], dtype=np.float32)
        secondary = np.asarray(payload["secondary"], dtype=np.float32)
    except KeyError as exc:
        print(f"{args.points} needs both 'primary' and 'secondary' point lists "
              f"(missing {exc})", file=sys.stderr)
        return 1

    try:
        homography = FloorHomography.fit(primary, secondary, max_residual=args.max_residual)
    except CalibrationError as exc:
        print(f"Calibration failed: {exc}", file=sys.stderr)
        return 1

    print(f"Fitted from {homography.points_used} floor points.")
    print(f"  mean reprojection error: {homography.residual:.1f} px")
    if homography.validated:
        print("  the fit is over-determined, so that error is a real check")
    else:
        print("  WARNING: four points always fit exactly, so this error checks")
        print("  nothing. Add two more points before trusting the association.")
    if args.out:
        Path(args.out).write_text(json.dumps(homography.to_dict(), indent=2) + "\n")
        print(f"\nhomography -> {args.out}")
    return 0


def cmd_train(args: argparse.Namespace) -> int:
    """Train an exercise recogniser and report honestly on what it learned."""
    import numpy as np

    from .classifier import ExerciseClassifier, evaluate, featurise, majority_baseline

    from .dataset import load_datasets

    dataset = load_datasets(args.dataset)
    windows, labels, names = dataset.windows, dataset.labels, dataset.names
    tracks = dataset.student_groups

    print(f"{len(windows)} windows, {len(names)} exercises, "
          f"{dataset.n_students} distinct students, "
          f"{dataset.n_sessions} session(s)")
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

    if dataset.n_sessions > 1:
        print()
        by_session = evaluate(features, labels, names, groups=dataset.session_groups,
                              protocol="Held-out classes (the real question)",
                              kind=args.model, seed=args.seed)
        print(by_session.format())
        if not np.isnan(by_session.accuracy) and not np.isnan(grouped.accuracy):
            drop = (grouped.accuracy - by_session.accuracy) * 100
            print(f"\nA further {drop:+.1f} points when the whole class is unseen. "
                  f"That is\nthe number that predicts production behaviour.")
        print(f"\nsessions: {', '.join(dataset.sessions)}")

    if dataset.n_students < 5:
        print("\nToo few distinct students for the grouped score to mean much.")
    if len(names) < 3:
        print("Only two exercises: a coin flip scores 50%.")
    if dataset.n_sessions < 2:
        print("\nEvery window here comes from one session. Nothing above measures "
              "\ntransfer to another room, camera or teacher -- for that, label a "
              "\nsecond class and pass both datasets to this command.")

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
    d.add_argument("--session", default=None,
                   help="name for this class; makes session-level holdout possible "
                        "once you have more than one")
    d.add_argument("--include-non-exercise", action="store_true",
                   help="also emit windows for transition/instruction/rest")
    d.set_defaults(func=cmd_dataset)

    v = sub.add_parser("preview", help="contact sheets for verifying labels by eye")
    v.add_argument("labels")
    v.add_argument("--video", required=True)
    v.add_argument("--out", default=None)
    v.add_argument("--frames", type=int, default=6, help="frames sampled per segment")
    v.add_argument("--exercise", default=None, help="only this exercise")
    v.add_argument("--include-non-exercise", action="store_true")
    v.set_defaults(func=cmd_preview)

    ch = sub.add_parser("coach", help="coaching notes for a student, from measurements")
    ch.add_argument("video")
    ch.add_argument("--exercise", required=True, help="which standard to assess against")
    ch.add_argument("--config", default=None)
    ch.add_argument("--standards", default=None, help="JSON of your own standards")
    ch.add_argument("--student", type=int, default=None, help="assess only this track id")
    ch.add_argument("--start", type=int, default=0)
    ch.add_argument("--end", type=int, default=None)
    ch.add_argument("--stride", type=int, default=None)
    ch.add_argument("--min-samples", type=int, default=10)
    ch.add_argument("--save-history", default=None,
                    help="append these results to a history file")
    ch.add_argument("--name", default=None, help="who --student is, for history")
    ch.add_argument("--names", default=None,
                    help='JSON mapping track ids to names, e.g. \'{"1":"Anna"}\'')
    ch.add_argument("--date", default=None, help="session date (default: today)")
    ch.set_defaults(func=cmd_coach)

    pr = sub.add_parser("progress", help="how a student has changed across sessions")
    pr.add_argument("student_name")
    pr.add_argument("--store", required=True, help="history file")
    pr.add_argument("--exercise", default=None, help="default: every exercise recorded")
    pr.set_defaults(func=cmd_progress)

    ro = sub.add_parser("roster", help="find students and write a roster stub")
    ro.add_argument("video")
    ro.add_argument("--config", default=None)
    ro.add_argument("--out", default=None)
    ro.add_argument("--crops", default=None, help="where to write reference crops")
    ro.add_argument("--pad", type=int, default=20, help="pixels around each crop")
    ro.add_argument("--start", type=int, default=0)
    ro.add_argument("--end", type=int, default=None)
    ro.add_argument("--stride", type=int, default=None)
    ro.add_argument("--min-samples", type=int, default=10)
    ro.set_defaults(func=cmd_roster)

    cl = sub.add_parser("class", help="run a whole class: reports plus a teacher page")
    cl.add_argument("video")
    cl.add_argument("--labels", required=True)
    cl.add_argument("--roster", required=True)
    cl.add_argument("--config", default=None)
    cl.add_argument("--standards", default=None)
    cl.add_argument("--history", default=None, help="history file to read and update")
    cl.add_argument("--out-dir", default=None)
    cl.add_argument("--studio", default="")
    cl.add_argument("--date", default=None)
    cl.add_argument("--stride", type=int, default=None)
    cl.add_argument("--min-samples", type=int, default=10)
    cl.add_argument("--min-affected", type=int, default=2,
                    help="students who must share a problem before it is a class pattern")
    cl.add_argument("--start", type=int, default=0,
                    help="first frame; a roster is only valid over one continuous shot")
    cl.add_argument("--end", type=int, default=None, help="last frame")
    cl.add_argument("--force", action="store_true",
                    help="run even when the roster names few of the tracked students")
    cl.set_defaults(func=cmd_class)

    rp = sub.add_parser("report", help="write a take-away HTML report for a student")
    rp.add_argument("video")
    rp.add_argument("--exercise", required=True)
    rp.add_argument("--name", required=True, help="the student's name, for the page")
    rp.add_argument("--student", type=int, required=True, help="their track id")
    rp.add_argument("--config", default=None)
    rp.add_argument("--standards", default=None)
    rp.add_argument("--history", default=None, help="history file, to include progress")
    rp.add_argument("--out", default=None)
    rp.add_argument("--studio", default="", help="studio name for the header")
    rp.add_argument("--date", default=None)
    rp.add_argument("--start", type=int, default=0)
    rp.add_argument("--end", type=int, default=None)
    rp.add_argument("--stride", type=int, default=None)
    rp.add_argument("--min-samples", type=int, default=10)
    rp.set_defaults(func=cmd_report)

    k = sub.add_parser("calibrate", help="fit the floor homography linking two views")
    k.add_argument("points", help="JSON with matching floor points from both views")
    k.add_argument("--out", default=None)
    k.add_argument("--max-residual", type=float, default=25.0,
                   help="reject a fit with a mean error above this, in pixels")
    k.set_defaults(func=cmd_calibrate)

    t = sub.add_parser("train", help="train an exercise recogniser from a dataset")
    t.add_argument("dataset", nargs="+",
                   help="one or more .npz files from the dataset command; pass "
                        "several to evaluate on held-out classes")
    t.add_argument("--out", default=None, help="save the fitted model here")
    t.add_argument("--model", choices=("linear", "forest"), default="linear")
    t.add_argument("--seed", type=int, default=0)
    t.set_defaults(func=cmd_train)

    args = parser.parse_args(argv)
    return args.func(args)
