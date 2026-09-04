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
    python -m pilates doctor                          # is this machine ready?
    python -m pilates quickstart VIDEO                # the exact steps for your video
    python -m pilates load VIDEO --mass 68 --height 1.68  # joint load, not just shape
    python -m pilates describe VIDEO --model m.joblib # what each student did
    python -m pilates describe VIDEO --anatomy        # ...with muscles and nerves
    python -m pilates crosscheck nw.json              # our targets against theirs
    python -m pilates merge nw.json --policy          # combine the two libraries
    python -m pilates capture v.mp4 --session tue-01 --user anna  # store it all
    python -m pilates enrol anna --name "Anna Smith"  # add a person
    python -m pilates identify class.mp4 --session tue-01  # who is each track?
    python -m pilates confirm tue-01 --track 4 --user anna --by me
    python -m pilates dashboard anna --out anna.html  # charts and history
    python -m pilates bundle anna --session tue-01    # one file for the 3D view
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
    anatomy = None
    if args.anatomy:
        library = _anatomy_library(args.anatomy_file,
                                   wanted=sorted(standards))
        anatomy = library.get(standard.exercise)
        if anatomy is None:
            print(f"  no reference anatomy on file for {standard.exercise}; "
                  f"the report will omit that section", file=sys.stderr)
    report = build(
        student=args.name, exercise=standard.exercise,
        assessment=assess(history, standard, config.keypoint_threshold),
        summary=summarise(history), store=store, date=args.date, studio=args.studio,
        anatomy=anatomy, nerves=library.nerves if anatomy is not None else None,
    )
    out = write(report, args.out or f"{args.name.replace(' ', '_')}_{report.date}.html")
    print(f"report -> {out}")
    print(f"  {len(report.assessment.good)} thing(s) going well, "
          f"{len(report.assessment.improve)} to work on, "
          f"{len(report.assessment.unmeasured)} not measurable")
    if report.sessions_recorded:
        print(f"  includes progress across {report.sessions_recorded} recorded session(s)")
    return 0


def cmd_load(args: argparse.Namespace) -> int:
    """Report mechanical load at each joint, and which muscle group carries it."""
    import statistics

    from .biomechanics import analyse_frame
    from .interaction import ContactLog, find_contacts, session_validity
    from .movement import SessionRecorder

    config = _load_config(args.config)
    if args.stride is not None:
        config.frame_stride = args.stride
    equipment = _equipment(args.equipment)
    if equipment.blocks_load:
        print("No load can be estimated for this class:\n" + equipment.explain())
        print("\nThese carry part of the load at a point nothing in the image "
              "shows, so any\nnumber here would be wrong rather than "
              "imprecise. Geometry is unaffected:\n`pilates session` and "
              "`pilates describe` still work.", file=sys.stderr)
        return 1

    pipeline = Pipeline(config)
    recorder = SessionRecorder(keypoint_threshold=config.keypoint_threshold)
    contacts = ContactLog()

    peaks: dict[int, dict[str, float]] = {}
    groups: dict[int, dict[str, list[float]]] = {}
    skipped: dict[int, dict[str, str]] = {}
    observed: list[tuple[int, float, object]] = []

    with VideoSource(args.video, stride=config.frame_stride,
                     start_frame=args.start, end_frame=args.end) as source:
        for result in pipeline.run(source):
            recorder.observe(result)
            contacts.observe(result.timestamp,
                             find_contacts(result.people, config.keypoint_threshold))
            for person in result.people:
                if args.student is not None and person.track_id != args.student:
                    continue
                observed.append((person.track_id, result.timestamp, analyse_frame(
                    person.detection, args.mass, args.height,
                    config.keypoint_threshold)))

    # Contacts are only known once the whole clip has been read, so the
    # filtering happens here rather than in the loop above. A moment measured
    # while an instructor's hands were on a student is a reading of two people.
    dropped: dict[int, int] = {}
    for track_id, timestamp, report in observed:
        if not session_validity(track_id, timestamp, contacts, equipment):
            dropped[track_id] = dropped.get(track_id, 0) + 1
            continue
        for load in report.loads:
            peaks.setdefault(track_id, {})
            peaks[track_id][load.joint] = max(
                peaks[track_id].get(load.joint, 0.0), load.moment_nm)
            if load.group is not None:
                groups.setdefault(track_id, {}).setdefault(
                    load.group.name, []).append(load.moment_nm)
        for joint, reason in report.skipped.items():
            skipped.setdefault(track_id, {})[joint] = reason

    if not peaks:
        print("No joint load could be estimated. Every limb was either bearing "
              "weight\nthrough the floor or not fully visible.", file=sys.stderr)
        for track_id, reasons in list(skipped.items())[:1]:
            for joint, reason in list(reasons.items())[:3]:
                print(f"  {joint}: {reason}", file=sys.stderr)
        return 1

    print(f"Body mass {args.mass:.0f} kg, height {args.height:.2f} m\n")
    for track_id in sorted(peaks):
        history = recorder.histories.get(track_id)
        frames = len(history.samples) if history else 0
        print(f"--- Student #{track_id} ({frames} frames) ---")
        print(f"  {'joint':<14}{'peak moment':>13}")
        for joint, moment in sorted(peaks[track_id].items(), key=lambda kv: -kv[1]):
            print(f"  {joint:<14}{moment:>10.1f} Nm")
        if track_id in groups:
            print("\n  carried by:")
            for name, values in sorted(groups[track_id].items(),
                                       key=lambda kv: -max(kv[1])):
                print(f"    {name:<20} peak {max(values):5.1f} Nm, "
                      f"typical {statistics.median(values):5.1f} Nm")
        for adjustment in contacts.for_student(track_id):
            print(f"\n  hands-on: {adjustment.describe()}")
        if dropped.get(track_id):
            print(f"\n  {dropped[track_id]} frames dropped: somebody's hands "
                  f"were on this student,\n  so the load was not theirs alone.")
        for joint, reason in sorted(skipped.get(track_id, {}).items())[:3]:
            print(f"\n  not estimated for {joint}: {reason}")
        print()

    print("Joint moments are modelled, not measured: segment masses are "
          "population\naverages and only gravity is included. See "
          "docs/what-cannot-be-measured.md.")
    return 0


def _equipment(declared: list[str] | None):
    """Parse ``--equipment block --equipment hand_weights=2`` into a declaration.

    Declared rather than detected: a block under a hip is occluded by the hip,
    so asking is both more accurate and honest about where the knowledge came
    from.
    """
    from .interaction import EquipmentDeclaration

    items: dict[str, float] = {}
    for entry in declared or []:
        name, _, mass = entry.partition("=")
        try:
            items[name.strip()] = float(mass) if mass else 0.0
        except ValueError:
            raise SystemExit(f"--equipment {entry!r}: mass must be a number, "
                             f"as in --equipment hand_weights=2")
    return EquipmentDeclaration(items)


def cmd_describe(args: argparse.Namespace) -> int:
    """Say what each student did -- named when it can be, described when not.

    "Unknown exercise" is useless to a student. Posture, load, which joints did
    the work, symmetry and tempo are all measured directly and do not depend on
    knowing the name, so this always says something true either way.
    """
    from collections import Counter

    from .biomechanics import analyse_frame
    from .dataset import window_for
    from .interaction import ContactLog, find_contacts
    from .movement import SessionRecorder
    from .recognition import OpenSetRecogniser, describe as describe_movement
    from .universal import assess_unnamed, build_baseline

    config = _load_config(args.config)
    if args.stride is not None:
        config.frame_stride = args.stride
    equipment = _equipment(args.equipment)

    recogniser = OpenSetRecogniser.load(args.model) if args.model else None
    library = None
    if args.anatomy:
        # Keyed to the names this system can actually produce -- the model's
        # own classes when there is one. A library keyed to its source's
        # vocabulary would never be found by a lookup on ours.
        from .coaching import DEFAULT_STANDARDS

        wanted = sorted(recogniser.classifier.names) if (
            recogniser is not None and getattr(recogniser.classifier, "names", None)
        ) else sorted(DEFAULT_STANDARDS)
        library = _anatomy_library(args.anatomy_file, wanted=wanted)
        unknown = library.unknown_muscles()
        if unknown:
            print(f"Note: no nerve supply recorded for {', '.join(unknown)}. "
                  f"Those muscles\nwill be named without one rather than given "
                  f"a guess.\n", file=sys.stderr)
    pipeline = Pipeline(config)
    recorder = SessionRecorder(keypoint_threshold=config.keypoint_threshold)
    contacts = ContactLog()

    postures: dict[int, Counter] = {}
    frames: dict[int, list] = {}
    loads: dict[int, list] = {}

    with VideoSource(args.video, stride=config.frame_stride,
                     start_frame=args.start, end_frame=args.end) as source:
        for result in pipeline.run(source):
            recorder.observe(result)
            contacts.observe(result.timestamp, find_contacts(
                result.people, config.keypoint_threshold))
            for person in result.people:
                if args.student is not None and person.track_id != args.student:
                    continue
                postures.setdefault(person.track_id, Counter())[
                    posture(person.detection, config.keypoint_threshold)] += 1
                frames.setdefault(person.track_id, []).append(person.detection)
                if args.mass and args.height:
                    loads.setdefault(person.track_id, []).append(
                        (result.timestamp,
                         analyse_frame(person.detection, args.mass, args.height,
                                       config.keypoint_threshold)))

    summaries = {s.track_id: s for s in recorder.summaries(min_samples=args.min_samples)}
    if not summaries:
        print("No student was tracked long enough to describe.")
        return 1

    # The room is the standard when no library entry is. Built from everyone
    # measured, before any one student is judged against it.
    baseline = build_baseline(
        [recorder.histories[t] for t in summaries if t in recorder.histories],
        keypoint_threshold=config.keypoint_threshold)

    # Behaviour, not appearance: whoever circulated putting hands on several
    # different people. Nothing here recognises a face or a uniform, and when
    # the evidence is thin nobody is named.
    instructor = contacts.likely_instructor()
    if instructor is not None:
        touched, seconds = contacts.touch_profile()[instructor]
        print(f"Track #{instructor} put hands on {touched} different people for "
              f"{seconds:.0f}s in total,\nwhich is what an instructor "
              f"circulating looks like. Confirm it in the roster.\n")

    if equipment.items:
        print("Equipment declared:")
        print(equipment.explain())
        print()

    for track_id in sorted(summaries):
        if args.student is not None and track_id != args.student:
            continue
        summary = summaries[track_id]
        stance = postures.get(track_id, Counter()).most_common(1)
        report, usable, excluded, why = _best_load(
            track_id, loads.get(track_id, []), contacts, equipment)
        description = describe_movement(
            summary, report, posture=stance[0][0] if stance else "unknown")

        recognition = None
        if recogniser is not None:
            window = window_for(frames.get(track_id, []),
                                keypoint_threshold=config.keypoint_threshold)
            if window is not None:
                recognition = recogniser.recognise(window)

        assessment = assess_unnamed(
            recorder.histories[track_id], summary, description.summarise(),
            baseline if baseline.usable else None,
            keypoint_threshold=config.keypoint_threshold)
        headline = (recognition.headline(description.summarise())
                    if recognition else description.summarise())
        who = (f"Instructor? (track #{track_id})" if track_id == instructor
               else f"Student #{track_id}")
        print(f"{who} — {headline}")
        if recognition is not None and recognition.named:
            print(f"  {description.summarise()}")
            print(f"  named with {recognition.confidence:.2f} confidence")
        elif recognition is not None:
            # The reason is for whoever is tuning the model, not for a student.
            print(f"  [name withheld: {recognition.withheld_reason}]")
        for finding in assessment.improve:
            detail = (f" — measured {finding.measured:.0f}, {finding.target}"
                      if finding.measured is not None and finding.target else "")
            print(f"  work on: {finding.message}{detail}")
        for finding in assessment.good:
            print(f"  going well: {finding.message}")
        if args.anatomy:
            _print_anatomy(library, recognition, report)
        for adjustment in contacts.for_student(track_id):
            print(f"  hands-on: {adjustment.describe()}")
        if excluded:
            print(f"  load measured over {usable} frames; {excluded} were "
                  f"dropped because this load was not the student's alone")
        if why:
            print(f"  no load estimated: {why}")
        print()

    print(baseline.explain())
    print("\nNames are withheld rather than guessed. Everything above is "
          "measured directly\nor compared against the rest of the room, and "
          "neither depends on knowing what\nthe exercise is called.")
    if args.anatomy:
        print("\n[measured] came from this student's video. [reference] is "
              "anatomy, true of\neverybody and looked up by exercise name. "
              "Nothing here observed a muscle or a\nnerve directly; see "
              "docs/what-cannot-be-measured.md.")
    return 0


def _print_anatomy(library, recognition, load_report) -> None:
    """Reference anatomy for a named exercise, set against what was measured.

    Without a name there is no lookup, and that is the honest outcome rather
    than a gap: anatomy is keyed by exercise, so guessing one to fill this in
    would attach a real muscle list to the wrong movement.
    """
    from .anatomy import REFERENCE, reconcile

    if recognition is None:
        print("  no reference anatomy: it is looked up by exercise name, and "
              "no recogniser was\n  supplied. Pass --model to name the "
              "exercise, or --labels to say what it was.")
        return
    if not recognition.named:
        print("  no reference anatomy: the name was withheld, and attaching a "
              "real muscle list\n  to a guessed exercise is worse than "
              "attaching none.")
        return
    entry = library.get(recognition.name)
    if entry is None:
        print(f"  no reference anatomy on file for "
              f"{recognition.name.replace('_', ' ')}")
        return

    table = library.nerves
    for provenance, line in reconcile(entry, load_report).describe():
        print(f"  [{provenance}] {line}")
    measured_roles = entry.measured_roles
    if measured_roles:
        print(f"  [{REFERENCE}] roles an EMG study recorded for this movement: "
              f"{', '.join(measured_roles)}")
    seen: set[str] = set()
    for muscle, supply in entry.nerves(table):
        text = supply.describe()
        if text in seen:
            continue
        seen.add(text)
        print(f"  [{REFERENCE}] {muscle}: {text}")
    if entry.spinal_levels(table):
        print(f"  [{REFERENCE}] spinal levels {entry.spinal_summary(table)}")
    if entry.bones:
        print(f"  [{REFERENCE}] at the {', '.join(entry.joints)}; bones involved: "
              f"{', '.join(entry.bones)}")
    if entry.note:
        print(f"  [{REFERENCE}] {entry.note}")


def _best_load(track_id, samples, contacts, equipment):
    """Peak load across frames where the load was actually this student's.

    Returns the frame report holding the peak, how many frames were usable, how
    many were dropped, and why none survived when that is the answer. A moment measured while an
    instructor's hands were on a student is a reading of two people; averaging
    it into that student's history makes the history wrong rather than noisy.
    """
    from .interaction import session_validity

    best, usable, excluded, refusal = None, 0, 0, ""
    for timestamp, report in samples:
        note = session_validity(track_id, timestamp, contacts, equipment)
        if not note:
            excluded += 1
            refusal = refusal or note.reason
            continue
        if not report.loads:
            continue
        usable += 1
        if best is None or (report.hardest and best.hardest
                            and report.hardest.moment_nm > best.hardest.moment_nm):
            best = report
    if usable:
        refusal = ""
    elif not refusal and samples:
        refusal = "no limb was both fully visible and free of the floor"
    return best, usable, excluded, refusal


def _anatomy_library(path: str | None, wanted: list[str] | None = None):
    """Load an anatomy library, accepting either schema.

    A curated project exports its own shape; asking a studio to convert it by
    hand before this will read it is how imported data gets mangled. A
    Neuro Wellness export is recognised by its own marker and mapped here.
    """
    import json

    from .anatomy import AnatomyLibrary

    if path is None:
        return AnatomyLibrary.default()
    payload = json.loads(Path(path).read_text())
    if "exercises" in payload and isinstance(payload.get("muscles"), dict):
        from .neurowellness import load_export

        library, report = load_export(path, wanted=wanted)
        print(report.describe(), file=sys.stderr)
        return library
    return AnatomyLibrary.load(path)


def cmd_crosscheck(args: argparse.Namespace) -> int:
    """Compare this system's angle targets against a curated library's poses.

    Two sets of targets written independently from the same tradition.
    Agreement is weak evidence both are right; disagreement is strong evidence
    one of them is wrong about an exercise, and which one is a question for a
    teacher. This reports, it does not adjudicate.
    """
    from .coaching import DEFAULT_STANDARDS, load_standards
    from .neurowellness import crosscheck_poses

    standards = load_standards(args.standards) if args.standards else DEFAULT_STANDARDS
    result = crosscheck_poses(args.library, standards, tolerance=args.tolerance)
    print(result.describe())
    if not result.compared:
        print("\nNothing was comparable. Check the library file is an export "
              "from tools/export_neuro_wellness.mjs.", file=sys.stderr)
        return 1
    print(f"\nOnly joints an interior angle between three keypoints can express "
          f"are compared.\nA 24-joint spine, shoulder rotation and wrist angles "
          f"are outside what one camera\nmeasures, so nothing is claimed about "
          f"them either way.")
    return 2 if result.disagreed else 0


def cmd_merge(args: argparse.Namespace) -> int:
    """Combine this system's standards with a curated library, field by field.

    Each field comes from whichever source is in a position to know it, and the
    policy says why. Angle targets are the exception: two independently written
    targets that disagree mean one source is wrong about an exercise, and
    picking one would destroy the only evidence of that.
    """
    from .coaching import DEFAULT_STANDARDS, UNSUITABLE, load_standards
    from .merge import POLICY, merge_libraries, review_local_only

    standards = load_standards(args.standards) if args.standards else DEFAULT_STANDARDS
    report = merge_libraries(standards, args.library, tolerance=args.tolerance)
    print(report.describe())

    if args.policy:
        print("\nWhere each field comes from:")
        for name, (source, reason) in sorted(POLICY.items()):
            print(f"  {name:22} {source:9} {reason}")

    verdicts = review_local_only(report.local_only, standards)
    if verdicts:
        print("\nExercises the imported library does not have:")
        for verdict in verdicts:
            print(f"  {verdict.describe()}")
        print("\nAbsence from one library is weak evidence. The question asked "
              "here is\nwhether the standard says something a camera can check "
              "that a general\nmovement-quality check does not already cover.")

    if args.out:
        payload = {
            "standards": [m.standard.to_dict() for m in report.merged.values()],
            "contested": [
                {"exercise": c.exercise, "joint": c.joint,
                 "ours": list(c.ours), "theirs": list(c.theirs)}
                for m in report.contested for c in m.conflicts
            ],
        }
        Path(args.out).write_text(json.dumps(payload, indent=2) + "\n")
        print(f"\nmerged standards -> {args.out}")
        if report.contested:
            print("Contested targets are listed in the file and left as this "
                  "side had them.\nA teacher settles those, not a merge.")
    unnamed = len(report.imported_only)
    if unnamed:
        print(f"\n{unnamed} imported exercises have no standard here. They are "
              f"not lost:\n`pilates describe` coaches an unnamed movement from "
              f"movement quality and\nfrom the rest of the class.")
    return 0


def cmd_enrol(args: argparse.Namespace) -> int:
    """Add a person to the studio's directory."""
    from .store import Store

    with Store.open(args.db) as store:
        store.enrol(args.username, args.name or "")
        print(f"{args.username} enrolled. "
              f"{len(store.people())} person(s) in {args.db}.")
        print("No body measurements are held for them yet. A signature is "
              "learned\nonly from sessions somebody confirms.")
    return 0


def cmd_identify(args: argparse.Namespace) -> int:
    """Propose which enrolled person each tracked body is.

    A proposal, never a decision: a wrong identity corrupts two histories at
    once and neither is detectable later. Nothing here writes a confirmed link.
    """
    from .identity import Link, Person, Signature, propose
    from .movement import SessionRecorder
    from .store import SessionMeta, Store

    config = _load_config(args.config)
    if args.stride is not None:
        config.frame_stride = args.stride
    pipeline = Pipeline(config)
    recorder = SessionRecorder(keypoint_threshold=config.keypoint_threshold)
    frames: dict[int, list] = {}

    with VideoSource(args.video, stride=config.frame_stride,
                     start_frame=args.start, end_frame=args.end) as source:
        for result in pipeline.run(source):
            recorder.observe(result)
            for person in result.people:
                frames.setdefault(person.track_id, []).append(person.detection)

    with Store.open(args.db) as store:
        store.record_session(SessionMeta(
            key=args.session, video=Path(args.video).name, date=args.date or "",
            studio=args.studio or "", students=len(recorder.histories)))
        roster = [
            Person(username=row["username"], display_name=row["display_name"],
                   signature=store.signature(row["username"]),
                   confirmations=row["confirmations"])
            for row in store.people()
        ]
        roster = [p for p in roster if p.signature.usable]
        if not roster:
            print("Nobody enrolled has a signature yet, so there is nothing to "
                  "match against.\nConfirm a first session by hand with "
                  "`pilates confirm`; each confirmation\nteaches the signature "
                  "that makes the next one a proposal.", file=sys.stderr)

        proposed = 0
        for track_id, history in sorted(recorder.histories.items()):
            if len(history.samples) < args.min_samples:
                continue
            signature = Signature.from_history(
                history, frames.get(track_id, []), config.keypoint_threshold)
            result = propose(signature, roster, track_id=track_id)
            print(result.describe())
            if result.named:
                store.put_link(Link(session=args.session, track_id=track_id,
                                    username=result.best.person.username,
                                    distance=result.best.distance), signature)
                proposed += 1
            else:
                # Held against the track with no name on it, so confirming by
                # hand still teaches the signature. Otherwise the first session
                # of every new person would teach nothing and the second would
                # be as blind as the first.
                store.put_link(Link(session=args.session, track_id=track_id,
                                    username="", method="unproposed"), signature)

    print(f"\n{proposed} proposal(s) written, none confirmed. Confirm or "
          f"correct each one with\n  pilates confirm {args.session} "
          f"--track N --user USERNAME --by YOU\nNothing reaches a history "
          f"until it is confirmed.")
    return 0


def cmd_confirm(args: argparse.Namespace) -> int:
    """Confirm or reject who a tracked body was."""
    from .identity import Link, Signature
    from .store import Store

    with Store.open(args.db) as store:
        try:
            store.session_id(args.session)
        except KeyError:
            known = [row["key"] for row in store.sessions()]
            print(f"No session recorded under {args.session!r}. "
                  f"Run `pilates identify` on the video first;\nit is what "
                  f"records the session and the tracks in it.", file=sys.stderr)
            if known:
                print(f"Recorded so far: {', '.join(known)}", file=sys.stderr)
            return 1
        existing = {l.track_id: l for l in store.links(session=args.session)}
        link = existing.get(args.track) or Link(
            session=args.session, track_id=args.track, username=args.user,
            method="manual")
        if args.user:
            link = Link(session=args.session, track_id=args.track,
                        username=args.user, method=link.method,
                        distance=link.distance)
        settled = link.reject(args.by) if args.reject else link.confirm(args.by)
        learned = store.settle(settled)
        verb = "rejected" if args.reject else "confirmed"
        print(f"track {args.track} in {args.session}: {verb} as "
              f"{settled.username}, by {args.by}")
        if learned:
            signature = store.signature(settled.username)
            print(f"{settled.username}'s build is now known from "
                  f"{signature.frames} frames across "
                  f"{[p['confirmations'] for p in store.people() if p['username'] == settled.username][0]} "
                  f"confirmed session(s); the next one can be proposed rather "
                  f"than typed.")
        if not args.reject:
            attributed = len(store.history(settled.username, valid_only=False))
            print(f"{attributed} measurement(s) now attributed to "
                  f"{settled.username}, including any\nrecorded before this "
                  f"was confirmed.")
        remaining = len(store.pending())
        if remaining:
            print(f"{remaining} link(s) still waiting to be settled.")
    return 0


def cmd_dashboard(args: argparse.Namespace) -> int:
    """Write one person's whole record as a page."""
    from .dashboard import render
    from .store import Store

    with Store.open(args.db) as store:
        names = {p["username"]: p["display_name"] for p in store.people()}
        if args.username not in names:
            print(f"{args.username!r} is not enrolled. Enrolled: "
                  f"{', '.join(sorted(names)) or 'nobody'}", file=sys.stderr)
            return 1
        html = render(store, args.username, names[args.username],
                      studio=args.studio or "", exercise=args.exercise)
        out = Path(args.out or f"{args.username}_progress.html")
        out.write_text(html, encoding="utf-8")
        coverage = store.coverage()
    print(f"dashboard -> {out}")
    print(f"  {coverage['attributed']} of {coverage['measurements']} measurements "
          f"attributed ({coverage['share']:.0%})")
    if coverage["pending_links"]:
        print(f"  {coverage['pending_links']} identity link(s) unconfirmed; their "
              f"measurements are stored\n  but appear nowhere until somebody "
              f"settles them.")
    return 0


def cmd_export(args: argparse.Namespace) -> int:
    """Everything held about one person, or erase them."""
    from .store import Store

    with Store.open(args.db) as store:
        if args.forget:
            removed = store.forget(args.username)
            print(f"{args.username} erased: {removed['measurements']} "
                  f"measurement(s), {removed['findings']} finding(s), "
                  f"{removed['links']} link(s).")
            print("The measurements were deleted rather than orphaned: a row "
                  "saying a track had\na hip range of 62 degrees is still "
                  "about that person.")
            return 0
        payload = store.export_person(args.username)
    out = Path(args.out or f"{args.username}_data.json")
    out.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"everything held about {args.username} -> {out}")
    print(f"  {len(payload['measurements'])} measurement(s), "
          f"{len(payload['findings'])} finding(s)")
    return 0


def cmd_capture(args: argparse.Namespace) -> int:
    """Analyse a recording once and write down everything it contained.

    The video is not kept, so this pass is the only chance. It writes the pose
    stream, every whole-body angle, the movement summary, joint loads where
    they are valid, every discrete event, the feedback given, and a manifest
    saying how it was all produced.
    """
    import statistics

    from .archive import PoseStream, cost
    from .biomechanics import analyse_frame
    from .geometry import ANGLE_PAIRS, SEGMENT_ANGLES, STANDARD_ANGLES, symmetry
    from .identity import Link, Signature
    from .interaction import ContactLog, find_contacts, session_validity
    from .movement import SessionRecorder, find_repetitions
    from .store import SessionMeta, Store
    from .universal import assess_quality, assess_unnamed, build_baseline
    from . import __version__

    config = _load_config(args.config)
    if args.stride is not None:
        config.frame_stride = args.stride
    equipment = _equipment(args.equipment)

    pipeline = Pipeline(config)
    recorder = SessionRecorder(keypoint_threshold=config.keypoint_threshold)
    contacts = ContactLog()
    frames: dict[int, list] = {}
    source_fps, width, height = 0.0, 0, 0

    with VideoSource(args.video, stride=config.frame_stride,
                     start_frame=args.start, end_frame=args.end) as source:
        source_fps = getattr(source, "fps", 0.0) or 0.0
        width = getattr(source, "width", 0) or 0
        height = getattr(source, "height", 0) or 0
        for result in pipeline.run(source):
            recorder.observe(result)
            contacts.observe(result.timestamp,
                             find_contacts(result.people, config.keypoint_threshold))
            for person in result.people:
                frames.setdefault(person.track_id, []).append(
                    (result.timestamp, person.detection))

    histories = {t: h for t, h in recorder.histories.items()
                 if len(h.samples) >= args.min_samples}
    if not histories:
        print("Nobody was tracked long enough to record.", file=sys.stderr)
        return 1

    step = config.frame_stride / source_fps if source_fps else 0.0
    baseline = build_baseline(list(histories.values()),
                              keypoint_threshold=config.keypoint_threshold)

    with Store.open(args.db) as store:
        if args.user:
            known = {p["username"] for p in store.people()}
            if args.user not in known:
                print(f"{args.user!r} is not enrolled. Enrol them first:\n"
                      f"  pilates enrol {args.user} --db {args.db}\n"
                      f"Enrolled: {', '.join(sorted(known)) or 'nobody'}",
                      file=sys.stderr)
                print("A typo would otherwise become a second person, and "
                      "splitting one\nstudent's history across two names is "
                      "hard to notice and harder to undo.", file=sys.stderr)
                return 1
        store.record_session(SessionMeta(
            key=args.session, video=Path(args.video).name, date=args.date or "",
            studio=args.studio or "", students=len(histories),
            duration_s=max((h.samples[-1].timestamp for h in histories.values()),
                           default=0.0)))
        store.save_manifest(args.session, __version__, config.to_dict(),
                            source_fps=source_fps, stride=config.frame_stride,
                            width=width, height=height,
                            notes=args.notes or "")

        archived = 0
        for track_id, history in sorted(histories.items()):
            stream = PoseStream.from_samples(track_id, frames.get(track_id, []))
            archived += store.save_poses(args.session, stream)
            signature = Signature.from_history(
                history, [d for _, d in frames.get(track_id, [])],
                config.keypoint_threshold)

            if args.user:
                # Declared, not inferred, and a declaration by an operator is
                # a confirmation: somebody with eyes on the room asserted it,
                # which is exactly what confirming means everywhere else here.
                store.settle(Link(session=args.session, track_id=track_id,
                                  username=args.user,
                                  method="declared").confirm(args.by))
            else:
                store.put_link(Link(session=args.session, track_id=track_id,
                                    username="", method="unproposed"), signature)

            _record_track(store, args, config, history, stream, contacts,
                          equipment, baseline, step)

        coverage = store.coverage()

    figures = cost(sum(len(f) for f in frames.values()))
    print(f"{len(histories)} student(s) recorded into {args.db}")
    print(f"  pose streams : {archived / 1e6:.2f} MB "
          f"({figures['video_bytes_at_1mbit'] / max(archived, 1):.0f}x smaller "
          f"than the video at a conservative bitrate)")
    print(f"  measurements : {coverage['measurements']}")
    print(f"  attributed   : {coverage['attributed']} "
          f"({coverage['share']:.0%})")
    if args.user:
        print(f"  named        : every track declared as {args.user} by "
              f"{args.by}")
        if len(histories) > 1:
            print(f"\n{len(histories)} people were tracked but all of them were "
                  f"declared as one person.\nFor a single-subject recording "
                  f"that is a second body in shot — an instructor,\nor somebody "
                  f"walking past. Check with `pilates confirm "
                  f"{args.session} --track N --reject --by {args.by}`.")
    if not args.user:
        print(f"\nNobody is named yet. Either re-run with --user for a "
              f"single-subject\nrecording, or settle each track with "
              f"`pilates confirm {args.session} --track N ...`.\n"
              f"Everything above is stored either way and attaches when it is "
              f"settled.")
    return 0


def _record_track(store, args, config, history, stream, contacts, equipment,
                  baseline, step) -> None:
    """Everything derivable about one person, written down."""
    import statistics

    from .biomechanics import analyse_frame
    from .geometry import ANGLE_PAIRS, symmetry
    from .interaction import session_validity
    from .movement import find_repetitions, summarise
    from .universal import assess_unnamed

    track_id = history.track_id
    session = args.session

    # -- every angle, as a median with the spread it varied by --------------
    for subject in sorted(history.samples[0].angles):
        values = [s.angles[subject] for s in history.samples
                  if s.angles.get(subject) is not None]
        if len(values) < 3:
            continue
        store.add_measurement(
            session, track_id, subject, statistics.median(values),
            spread=_iqr(values), samples=len(values), source="standard",
            exercise=args.exercise or "")

    for pair in ANGLE_PAIRS:
        gaps = [
            abs(s.angles[f"left_{pair}"] - s.angles[f"right_{pair}"])
            for s in history.samples
            if s.angles.get(f"left_{pair}") is not None
            and s.angles.get(f"right_{pair}") is not None
        ]
        if len(gaps) >= 3:
            store.add_measurement(
                session, track_id, f"{pair} symmetry", statistics.median(gaps),
                spread=_iqr(gaps), samples=len(gaps), source="standard",
                exercise=args.exercise or "")

    # -- what the movement was ---------------------------------------------
    summary = summarise(history)
    if summary is not None:
        for subject, value, unit in (
            ("repetitions", summary.repetitions, "count"),
            ("range of motion", summary.mean_range, "deg"),
            ("range consistency", summary.range_consistency, "deg"),
            ("seconds per repetition", summary.mean_rep_duration, "s"),
            ("tempo ratio", summary.mean_tempo_ratio, "ratio"),
            ("control", summary.control_ratio, "ratio"),
            ("longest hold", summary.longest_hold, "s"),
        ):
            if value is not None:
                store.add_measurement(session, track_id, subject, float(value),
                                      samples=summary.samples, unit=unit,
                                      source="quality",
                                      exercise=args.exercise or "")

        if summary.signal:
            times, values = history.series(summary.signal)
            for rep in find_repetitions(times, values):
                store.add_event(session, track_id, "repetition", rep.start,
                                rep.end, label=summary.signal,
                                value=rep.range_of_motion)

    # -- who had hands on them, and when ------------------------------------
    for adjustment in contacts.for_student(track_id):
        store.add_event(session, track_id, "adjustment", adjustment.start,
                        adjustment.end, label=adjustment.region,
                        detail=f"by track {adjustment.toucher_id}")

    # -- stretches where they were not detected -----------------------------
    if step:
        for start, end in stream.gaps(expected_step=step):
            store.add_event(session, track_id, "absent", start, end,
                            detail="not detected; measurements do not cover this")

    for name in equipment.invalidating:
        store.add_event(session, track_id, "equipment", 0.0, label=name,
                        detail="declared in use; load estimates are not valid")

    # -- load, where it is this student's own -------------------------------
    if args.mass and args.height:
        peaks: dict[str, float] = {}
        for sample_time, report in _load_series(history, stream, args, config):
            note = session_validity(track_id, sample_time, contacts, equipment)
            for load in report.loads:
                if load.group is None:
                    continue
                key = load.group.name
                if bool(note):
                    peaks[key] = max(peaks.get(key, 0.0), load.moment_nm)
                else:
                    store.add_measurement(
                        session, track_id, f"{key} peak moment", load.moment_nm,
                        unit="Nm", source="load", valid=False,
                        invalid_reason=note.reason, at_time=sample_time,
                        exercise=args.exercise or "")
        for group, moment in sorted(peaks.items()):
            store.add_measurement(session, track_id, f"{group} peak moment",
                                  moment, unit="Nm", source="load",
                                  exercise=args.exercise or "")

    # -- the feedback that was given ----------------------------------------
    if summary is not None:
        assessment = assess_unnamed(
            history, summary, "", baseline if baseline.usable else None,
            keypoint_threshold=config.keypoint_threshold)
        for finding in assessment.quality:
            store.add_finding(session, track_id, finding.kind, finding.message,
                              subject=finding.subject, measured=finding.measured,
                              target=finding.target, deviation=finding.deviation,
                              source="quality", exercise=args.exercise or "")
        for finding in assessment.versus_class:
            store.add_finding(session, track_id, finding.kind, finding.message,
                              subject=finding.subject, measured=finding.measured,
                              target=finding.target, deviation=finding.deviation,
                              source="class", exercise=args.exercise or "")


def _load_series(history, stream, args, config):
    """Joint loads frame by frame, paired with the time they were measured."""
    from .biomechanics import analyse_frame

    for index in range(len(stream)):
        yield (float(stream.times[index]),
               analyse_frame(stream.detection(index), args.mass, args.height,
                             config.keypoint_threshold))


def _iqr(values: list[float]) -> float:
    """Inter-quartile range: the spread a between-session change must clear."""
    ordered = sorted(values)
    if len(ordered) < 4:
        return 0.0
    return ordered[(3 * len(ordered)) // 4] - ordered[len(ordered) // 4]


def cmd_bundle(args: argparse.Namespace) -> int:
    """Write one session as one file, for an anatomy viewer to read.

    The same file is what a person is handed when they ask what is held about
    them. If it is fit to drive a rendering of somebody's body, it is the file
    that describes them.
    """
    from .bundle import build, validate, write
    from .store import Store

    with Store.open(args.db) as store:
        try:
            bundle = build(store, args.username, args.session,
                           include_poses=not args.no_poses)
        except ValueError as exc:
            print(str(exc), file=sys.stderr)
            return 1

    problems = validate(bundle)
    if problems:
        print("This bundle will not be written:", file=sys.stderr)
        for problem in problems:
            print(f"  {problem}", file=sys.stderr)
        return 1

    out = write(bundle, args.out or f"{args.username}_{args.session}.json")
    measured = sum(1 for s in bundle["structures"] if s["tier"] == "measured")
    reference = len(bundle["structures"]) - measured
    print(f"bundle -> {out} ({out.stat().st_size / 1024:.0f} KB)")
    print(f"  {len(bundle['quantities'])} measured quantities")
    print(f"  {measured} structures lit from measurement, "
          f"{reference} from anatomy")
    if bundle.get("pose"):
        print(f"  {bundle['pose']['frames']} pose frames, for scrubbing the "
              f"session after the video is gone")
    if bundle["score"]["value"] is None:
        print(f"  no score: {bundle['score']['withheld_reason']}")
    else:
        print(f"  score {bundle['score']['value']:.0f} from "
              f"{bundle['score']['checks']} checks")
    return 0


def cmd_bridge(args: argparse.Namespace) -> int:
    """Check every measurement-to-structure link against the anatomy model."""
    import json as _json

    from .bridge import check

    payload = _json.loads(Path(args.export).read_text())
    structures = payload.get("structures")
    if not structures:
        print("That export carries no structure list. Re-run "
              "tools/export_neuro_wellness.mjs to include one.", file=sys.stderr)
        return 1
    result = check(structures)
    print(result.describe())
    return 0 if result.ok else 2


def cmd_doctor(args: argparse.Namespace) -> int:
    """Check this machine can actually run an analysis."""
    from .diagnostics import check_environment, environment_ready

    checks = check_environment()
    print("Environment check\n")
    for check in checks:
        print(check.format())

    ready = environment_ready(checks)
    print()
    if ready:
        print("Ready to run.")
        if not all(c.ok for c in checks):
            print("The pose model has not been downloaded yet; the first "
                  "analysis will fetch it.")
        return 0
    print("Not ready. Fix the failures above and run this again.")
    return 1


def cmd_quickstart(args: argparse.Namespace) -> int:
    """Inspect a studio's own video and print the exact commands to run."""
    from .diagnostics import inspect_video, quickstart

    facts = inspect_video(args.video)
    print(quickstart(facts, stem=Path(args.video).stem))
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
        from .recognition import OpenSetRecogniser

        classifier = ExerciseClassifier(kind=args.model, seed=args.seed)
        classifier.fit(windows, labels, names)
        recogniser = OpenSetRecogniser.fit(classifier, features)
        recogniser.save(args.out)
        print(f"\nmodel -> {args.out}")
        print(f"\nThe saved model will decline to name an exercise it is not "
              f"sure of, rather\nthan guess: below {recogniser.min_confidence:.2f} "
              f"confidence, within {recogniser.min_margin:.2f} of the runner-up, "
              f"or\nmore than {recogniser.max_novelty:.2f} sd from the training "
              f"distribution.")
        if recogniser.calibrated_on:
            print(f"That last threshold was calibrated on "
                  f"{recogniser.calibrated_on} training windows.")
        else:
            print("That last threshold is a default: there was too little data "
                  "to calibrate one.")
        print("It still says what it measured. See `pilates describe`.")
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

    ld = sub.add_parser("load", help="joint load and the muscle group carrying it")
    ld.add_argument("video")
    ld.add_argument("--mass", type=float, required=True, help="body mass in kg")
    ld.add_argument("--height", type=float, required=True, help="body height in metres")
    ld.add_argument("--equipment", action="append", default=None,
                    help="declare a prop, e.g. --equipment block or "
                         "--equipment hand_weights=2")
    ld.add_argument("--config", default=None)
    ld.add_argument("--student", type=int, default=None)
    ld.add_argument("--start", type=int, default=0)
    ld.add_argument("--end", type=int, default=None)
    ld.add_argument("--stride", type=int, default=None)
    ld.set_defaults(func=cmd_load)

    de = sub.add_parser("describe", help="what each student did, named or not")
    de.add_argument("video")
    de.add_argument("--model", default=None,
                    help="a trained recogniser; without one, nothing is named")
    de.add_argument("--mass", type=float, default=None, help="body mass in kg")
    de.add_argument("--height", type=float, default=None, help="height in metres")
    de.add_argument("--equipment", action="append", default=None,
                    help="declare a prop, e.g. --equipment block or "
                         "--equipment hand_weights=2")
    de.add_argument("--anatomy", action="store_true",
                    help="add reference anatomy: muscles, nerves, spinal levels")
    de.add_argument("--anatomy-file", default=None,
                    help="import a curated anatomy library (JSON) instead of "
                         "the built-in one")
    de.add_argument("--config", default=None)
    de.add_argument("--student", type=int, default=None)
    de.add_argument("--min-samples", type=int, default=20)
    de.add_argument("--start", type=int, default=0)
    de.add_argument("--end", type=int, default=None)
    de.add_argument("--stride", type=int, default=None)
    de.set_defaults(func=cmd_describe)

    xc = sub.add_parser("crosscheck",
                        help="compare angle targets against a curated library")
    xc.add_argument("library", help="a JSON export of the reference library")
    xc.add_argument("--standards", default=None)
    xc.add_argument("--tolerance", type=float, default=20.0,
                    help="degrees either side of a target pose that still count "
                         "as doing it (default 20)")
    xc.set_defaults(func=cmd_crosscheck)

    mg = sub.add_parser("merge",
                        help="combine our standards with a curated library")
    mg.add_argument("library", help="a JSON export of the reference library")
    mg.add_argument("--standards", default=None)
    mg.add_argument("--tolerance", type=float, default=20.0)
    mg.add_argument("--policy", action="store_true",
                    help="print which source each field comes from, and why")
    mg.add_argument("--out", default=None, help="write the merged standards")
    mg.set_defaults(func=cmd_merge)

    cap = sub.add_parser("capture",
                         help="analyse a recording once and store everything in it")
    cap.add_argument("video")
    cap.add_argument("--session", required=True, help="a key for this recording")
    cap.add_argument("--user", default=None,
                     help="the person being recorded, when there is only one "
                          "and the coach knows who")
    cap.add_argument("--by", default="operator",
                     help="who is declaring the identity; recorded with it")
    cap.add_argument("--db", default="studio.db")
    cap.add_argument("--date", default=None)
    cap.add_argument("--studio", default=None)
    cap.add_argument("--exercise", default=None)
    cap.add_argument("--mass", type=float, default=None, help="body mass in kg")
    cap.add_argument("--height", type=float, default=None, help="height in metres")
    cap.add_argument("--equipment", action="append", default=None)
    cap.add_argument("--notes", default=None)
    cap.add_argument("--config", default=None)
    cap.add_argument("--min-samples", type=int, default=20)
    cap.add_argument("--start", type=int, default=0)
    cap.add_argument("--end", type=int, default=None)
    cap.add_argument("--stride", type=int, default=None)
    cap.set_defaults(func=cmd_capture)

    en = sub.add_parser("enrol", help="add a person to the studio directory")
    en.add_argument("username")
    en.add_argument("--name", default=None, help="display name")
    en.add_argument("--db", default="studio.db")
    en.set_defaults(func=cmd_enrol)

    idc = sub.add_parser("identify",
                         help="propose which enrolled person each track is")
    idc.add_argument("video")
    idc.add_argument("--session", required=True, help="a key for this recording")
    idc.add_argument("--db", default="studio.db")
    idc.add_argument("--date", default=None)
    idc.add_argument("--studio", default=None)
    idc.add_argument("--config", default=None)
    idc.add_argument("--min-samples", type=int, default=20)
    idc.add_argument("--start", type=int, default=0)
    idc.add_argument("--end", type=int, default=None)
    idc.add_argument("--stride", type=int, default=None)
    idc.set_defaults(func=cmd_identify)

    cf = sub.add_parser("confirm", help="settle who a tracked body was")
    cf.add_argument("session")
    cf.add_argument("--track", type=int, required=True)
    cf.add_argument("--user", default="")
    cf.add_argument("--by", required=True, help="who is confirming this")
    cf.add_argument("--reject", action="store_true")
    cf.add_argument("--db", default="studio.db")
    cf.set_defaults(func=cmd_confirm)

    db = sub.add_parser("dashboard", help="one person's whole record as a page")
    db.add_argument("username")
    db.add_argument("--db", dest="db", default="studio.db")
    db.add_argument("--exercise", default=None)
    db.add_argument("--studio", default=None)
    db.add_argument("--out", default=None)
    db.set_defaults(func=cmd_dashboard)

    ex = sub.add_parser("export", help="everything held about a person, or erase it")
    ex.add_argument("username")
    ex.add_argument("--db", default="studio.db")
    ex.add_argument("--out", default=None)
    ex.add_argument("--forget", action="store_true",
                    help="erase the person and every measurement about them")
    ex.set_defaults(func=cmd_export)

    bu = sub.add_parser("bundle",
                        help="write one session as a file an anatomy viewer can read")
    bu.add_argument("username")
    bu.add_argument("--session", required=True)
    bu.add_argument("--db", default="studio.db")
    bu.add_argument("--out", default=None)
    bu.add_argument("--no-poses", action="store_true",
                    help="leave out the frame-by-frame stream, which is most "
                         "of the file")
    bu.set_defaults(func=cmd_bundle)

    br = sub.add_parser("bridge",
                        help="check every measurement-to-structure link")
    br.add_argument("export", help="a JSON export of the anatomy model")
    br.set_defaults(func=cmd_bridge)

    dr = sub.add_parser("doctor", help="check this machine can run an analysis")
    dr.set_defaults(func=cmd_doctor)

    qs = sub.add_parser("quickstart", help="the exact steps for your own video")
    qs.add_argument("video")
    qs.set_defaults(func=cmd_quickstart)

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
    rp.add_argument("--anatomy", action="store_true",
                    help="include reference anatomy: muscles, nerves, bones")
    rp.add_argument("--anatomy-file", default=None,
                    help="import a curated anatomy library (JSON)")
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
