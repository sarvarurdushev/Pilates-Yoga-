"""The login-free assessment workflow; reuses RTMO, geometry and tracking.

All values carry provenance. Neither inferred 3D nor a reference anatomy mesh
feeds the image-space score. Saved reports contain measurements, not footage.
"""

from datetime import datetime, timezone
from functools import wraps
import json
import math
import os
import statistics
import threading
import uuid
import numpy as np
from . import alignment as al, geometry as geo, movement as mv, pose3d
from .validation import validate_body, suppress_fragments
from .types import Detection

VERSION = "2.0-evidence"
_ANALYSIS_LOCK = threading.Lock()


def one_assessment_at_a_time(fn):
    """Bound model scratch memory while health and job-status requests stay live."""

    @wraps(fn)
    def run(*args, **kwargs):
        from .api import Refused

        if not _ANALYSIS_LOCK.acquire(blocking=False):
            raise Refused(
                "Another assessment is being analysed. Try again when it finishes.", 409
            )
        try:
            return fn(*args, **kwargs)
        finally:
            _ANALYSIS_LOCK.release()

    return run


FRONTAL = ("front", "rear")
SIDE = ("side_left", "side_right")
SPECS = {
    "head_lateral_tilt": ("Head / ear-line tilt", "Head", (3, 4), FRONTAL),
    "shoulder_tilt": ("Shoulder height asymmetry", "Shoulders", (5, 6), FRONTAL),
    "pelvic_obliquity": ("Hip height asymmetry", "Pelvis", (11, 12), FRONTAL),
    "trunk_lean_lateral": (
        "Lateral trunk inclination",
        "Torso",
        (5, 6, 11, 12),
        FRONTAL,
    ),
    "forward_head": ("Forward-head offset proxy", "Head", (3, 4, 5, 6, 11, 12), SIDE),
    "trunk_lean_sagittal": (
        "Sagittal trunk inclination",
        "Torso",
        (5, 6, 11, 12),
        SIDE,
    ),
    "left_knee_deviation": (
        "Left knee alignment proxy",
        "Knees",
        (11, 13, 15),
        FRONTAL,
    ),
    "right_knee_deviation": (
        "Right knee alignment proxy",
        "Knees",
        (12, 14, 16),
        FRONTAL,
    ),
    "sagittal_pelvic_tilt": ("Sagittal pelvic tilt", "Pelvis", (11, 12), SIDE),
}
SIGNALS = {
    "trunk_inclination": ("Trunk inclination", (5, 6, 11, 12), 0),
    "left_shoulder": ("Left shoulder elevation", (11, 5, 7), 0),
    "right_shoulder": ("Right shoulder elevation", (12, 6, 8), 0),
    "left_elbow": ("Left elbow flexion", (5, 7, 9), 180),
    "right_elbow": ("Right elbow flexion", (6, 8, 10), 180),
    "left_hip": ("Left hip flexion", (5, 11, 13), 180),
    "right_hip": ("Right hip flexion", (6, 12, 14), 180),
    "left_knee": ("Left knee flexion", (11, 13, 15), 180),
    "right_knee": ("Right knee flexion", (12, 14, 16), 180),
}


def metric(
    name, value, unit, confidence, status, views, joints, reason="", region="Movement"
):
    return {
        "id": name,
        "name": (
            SPECS[name][0]
            if name in SPECS
            else SIGNALS.get(
                name,
                (
                    {
                        "foot_orientation": "Foot orientation",
                        "true_center_of_mass": "True centre of mass",
                    }.get(name, name),
                ),
            )[0]
        ),
        "value": (
            None if value is None else round(float(value), 3 if unit == "ratio" else 1)
        ),
        "scale_reference": (
            ("torso_height" if name == "forward_head" else "leg_length")
            if unit == "ratio"
            else None
        ),
        "unit": unit,
        "confidence": round(float(confidence), 3),
        "status": status if value is not None else "unavailable",
        "camera_views": list(views),
        "joints": list(joints),
        "reason": reason,
        "region": region,
        "representation": "2d",
        "source": "RTMO image landmarks",
    }


def blank3d():
    return pose3d.unavailable(
        "3D was not requested or the body did not pass visibility checks."
    )


def assess_person(
    det,
    width,
    height,
    *,
    person_id="1",
    view="auto",
    mode="standing",
    inference_scale=1,
):
    inferred = al.estimate_view(det)
    asked = al.View(view) if view != "auto" else inferred.view
    # A user-declared protocol cannot override clear opposing image evidence.
    mismatch = (
        view != "auto"
        and inferred.confidence >= 0.7
        and (
            (asked.is_frontal and inferred.view.is_sagittal)
            or (asked.is_sagittal and inferred.view.is_frontal)
        )
    )
    quality = validate_body(
        det,
        width=width,
        height=height,
        standing=mode == "standing",
        side=asked.is_sagittal,
    )
    effective = quality.checks["projected_body_chain_px"] * min(1, inference_scale)
    quality.checks["model_body_chain_px"] = round(effective, 1)
    if effective < 120:
        quality.reasons.append(
            "The body has too little detail at model resolution. Move closer or use overlapping class tiles."
        )
    if mismatch:
        quality.reasons.append(
            "The visible body conflicts with the selected camera plane. Check the view before measuring."
        )
    measurements = []
    if mode == "standing":
        a = al.assess(
            det, view=asked, frame_width=width, frame_height=height, threshold=0.5
        )
        quality.reasons = list(dict.fromkeys(quality.reasons + a.warnings))
        for name, (label, region, joints, views) in SPECS.items():
            m = a.metrics.get(name)
            value = m.value if m and quality.valid else None
            status = (
                "measured"
                if m and m.availability == al.Availability.AVAILABLE
                else "estimated"
            )
            if "proxy" in label:
                status = "estimated"
            reason = m.reason if m else "This view cannot supply this metric."
            if not quality.valid:
                reason = "; ".join(quality.reasons)
            conf = m.confidence if m else 0
            if value is not None and conf < 0.65:
                value = None
                reason = "The contributing landmarks are too uncertain."
            measurements.append(
                metric(
                    name,
                    value,
                    m.unit if m else ("ratio" if "head" == name else "deg"),
                    conf,
                    status,
                    views,
                    joints,
                    reason,
                    region,
                )
            )
    else:
        for name, (label, joints, zero) in SIGNALS.items():
            angle = None
            if quality.valid:
                if name == "trunk_inclination":
                    delta = np.mean(det.keypoints[[5, 6]], axis=0) - np.mean(
                        det.keypoints[[11, 12]], axis=0
                    )
                    angle = abs(
                        math.degrees(math.atan2(float(delta[0]), -float(delta[1])))
                    )
                else:
                    angle = geo.joint_angle(det, *joints, 0.5)
            value = abs(angle - zero) if angle is not None else None
            conf = float(min(det.scores[j] for j in joints))
            if conf < 0.65:
                value = None
            measurements.append(
                metric(
                    name,
                    value,
                    "deg",
                    conf,
                    "estimated",
                    (*FRONTAL, *SIDE, "three_quarter"),
                    joints,
                    (
                        "Projected image angle; out-of-plane motion changes this value."
                        if quality.valid
                        else "; ".join(quality.reasons)
                    ),
                )
            )
    measurements += [
        metric(
            "foot_orientation",
            None,
            "deg",
            0,
            "unavailable",
            [],
            [15, 16],
            "COCO-17 has no heel/toe landmarks. Ankle position does not establish foot direction.",
            "Ankles",
        ),
        metric(
            "true_center_of_mass",
            None,
            "m",
            0,
            "unavailable",
            [],
            [11, 12],
            "A 2D hip midpoint is not a measured centre of mass.",
            "Global",
        ),
    ]
    # Only directly projected alignment metrics contribute. This is an explicit
    # product rubric, not population norms or a medical instrument.
    checks = []
    for m in measurements:
        if m["status"] == "measured" and m["unit"] == "deg" and m["confidence"] >= 0.65:
            value = round(max(0, 100 * (1 - max(0, abs(m["value"]) - 2) / 13)), 1)
            checks.append({"metric": m["id"], "value": value, "weight": 1})
    score = (
        round(statistics.mean(c["value"] for c in checks), 1)
        if quality.valid and len(checks) >= 3 and mode == "standing"
        else None
    )
    return {
        "person_id": str(person_id),
        "view": asked.value,
        "view_source": "estimated" if view == "auto" else "user-declared",
        "view_confidence": inferred.confidence if view == "auto" else None,
        "inferred_view": inferred.view.value,
        "mode": mode,
        "suitable": quality.valid,
        "validation": quality.to_dict(),
        "refusal": (
            None
            if quality.valid
            else "Insufficient body visibility or unsuitable pose for this assessment."
        ),
        "landmarks": {
            "keypoints": det.keypoints.round(2).tolist(),
            "scores": det.scores.round(3).tolist(),
        },
        "metrics": measurements,
        "score": {
            "value": score,
            "checks": checks if quality.valid else [],
            "formula": "Mean of at least 3 measured alignment angles: max(0, 100 × (1 − max(0, |angle| − 2°) / 13°)). Equal weight.",
            "reason": (
                ""
                if score is not None
                else "Insufficient reliable alignment measurements for a score."
            ),
            "label": "Image alignment index",
            "medical": False,
        },
        "pose3d": blank3d(),
    }


def tile_geometry(width, height):
    # Wide rows need horizontal crops that retain head and feet.
    cols, rows = 2, 1 if width > 1.4 * height else 2
    edge = max(width * 0.625, height * (0.625 if rows == 2 else 1))
    return cols, rows, min(1, 640 / edge)


@one_assessment_at_a_time
def photo(payload, backend=None):
    from . import api, photos
    from .filters import suppress_duplicates
    from .pose import TiledBackend

    mode = payload.get("mode", "standing")
    view = payload.get("view", "auto")
    if mode not in ("standing", "pose"):
        raise ValueError("mode must be standing or pose")
    if view not in ("auto", *[v.value for v in al.View]):
        raise ValueError("Unknown camera view")
    frame = photos.decode(payload.get("image", ""))
    h, w = frame.shape[:2]
    backend = backend or api.pose_backend()
    cols, rows, tile_scale = tile_geometry(w, h)
    # A portrait must not be divided into head/torso/leg fragments. Always keep
    # the full-frame pass; class tiles only supplement sufficiently wide images.
    use_tiles = bool(payload.get("tiled")) and w >= 0.85 * h and min(w, h) >= 320
    candidates = backend(frame)
    scales = {id(d): min(1, 640 / max(w, h)) for d in candidates}
    if use_tiles:
        extra = TiledBackend(backend, cols=cols, rows=rows, scale=1, overlap=0.25)(
            frame
        )
        scales.update({id(d): tile_scale for d in extra})
        candidates += extra
    # Preserve source resolution for suitability: upscaling cannot earn precision.
    found, _ = suppress_duplicates(candidates, 0.4, 0.65)
    found = suppress_fragments(found)
    people = []
    for i, det in enumerate(found):
        p = assess_person(
            det,
            w,
            h,
            person_id=str(i + 1),
            view=view,
            mode=mode,
            inference_scale=scales.get(id(det), min(1, 640 / max(w, h))),
        )
        if p["suitable"] and payload.get("include_3d", True):
            p["pose3d"] = pose3d.estimate(frame, det)
        people.append(p)
    return {
        "version": VERSION,
        "kind": "photo",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "width": w,
        "height": h,
        "people": people,
        "model": f"RTMO-{getattr(backend, 'size', 'custom')}",
        "tiled": use_tiles,
        "warnings": (
            []
            if people
            else ["No person was found. Capture the full body with even lighting."]
        ),
        "disclaimer": "Fitness feedback from estimated landmarks. Measurements describe the image plane, not a diagnosis. Confirm that landmarks match the visible person.",
    }


def continuous_segments(times, values, max_gap=0.6):
    """Never join a repetition across an unobserved interval."""
    segments = []
    current = []
    for t, v in zip(times, values):
        if v is None:
            if current:
                segments.append(current)
                current = []
        else:
            if current and t - current[-1][0] > max_gap:
                segments.append(current)
                current = []
            current.append((t, v))
    if current:
        segments.append(current)
    return segments


def screen_spikes(times, values):
    """Mask isolated angle discontinuities, never invent interpolated motion.

    Engineering rule for slow exercise sampling: an interior sample differs
    by >60 degrees from BOTH neighbors, while those neighbors agree within
    30 degrees. At a segment endpoint require >90 degrees and two stable
    neighbors. A sustained transition is retained. Raw samples are preserved.
    """
    filtered = list(values)
    groups = []
    group = []
    for i, v in enumerate(values):
        if v is None or (group and times[i] - times[group[-1]] > 0.6):
            if group:
                groups.append(group)
                group = []
        if v is not None:
            group.append(i)
    if group:
        groups.append(group)
    for group in groups:
        for j, i in enumerate(group):
            if 0 < j < len(group) - 1:
                a, b = values[group[j - 1]], values[group[j + 1]]
                bad = (
                    min(abs(values[i] - a), abs(values[i] - b)) > 60 and abs(a - b) < 30
                )
            elif len(group) >= 3:
                a, b = (
                    (values[group[1]], values[group[2]])
                    if j == 0
                    else (values[group[-2]], values[group[-3]])
                )
                bad = abs(values[i] - a) > 90 and abs(a - b) < 30
            else:
                bad = False
            if bad:
                filtered[i] = None
    return filtered


def analyse_series(times, values):
    if (
        len(times) != len(values)
        or not all(math.isfinite(t) for t in times)
        or any(b <= a for a, b in zip(times, times[1:]))
        or any(v is not None and not math.isfinite(v) for v in values)
    ):
        raise ValueError("Video timestamps must be finite and strictly increasing.")
    raw_values = list(values)
    values = screen_spikes(times, values)
    rejected = sum(a is not None and b is None for a, b in zip(raw_values, values))
    provenance = {
        "rejected_spikes": rejected,
        "raw_series": list(zip(times, raw_values)),
    }
    if rejected / max(1, sum(v is not None for v in raw_values)) > 0.2:
        return {
            "status": "unavailable",
            "reason": "Too many isolated angle jumps to measure this joint reliably.",
            "series": list(zip(times, values)),
            **provenance,
        }
    segments = [
        s
        for s in continuous_segments(times, values)
        if len(s) >= 6 and s[-1][0] - s[0][0] >= 0.8
    ]
    if not segments:
        return {
            "status": "unavailable",
            **provenance,
            "reason": "Not enough continuous visible movement.",
            "series": list(zip(times, values)),
        }
    peaks = []
    ranges = []
    reps = []
    all_values = []
    durations = []
    for seg in segments:
        ts = [p[0] for p in seg]
        v = mv.smooth([p[1] for p in seg], 3)
        all_values += v
        r = mv.find_repetitions(ts, v, min_range=25)
        for rep in r:
            reps.append(rep)
            durations.append(rep.duration)
        peaks.append(max(v))
        ranges.append(max(v) - min(v))
    count = len(reps)
    return {
        **provenance,
        "status": "estimated",
        "unit": "deg",
        "minimum": round(min(all_values), 1),
        "peak": round(max(all_values), 1),
        "rom": round(max(all_values) - min(all_values), 1),
        "repetitions": count,
        "cycles": [
            {
                "start": r.start,
                "end": r.end,
                "rom": round(r.range_of_motion, 1),
                "out_seconds": r.out_duration,
                "return_seconds": r.back_duration,
                "duration": r.duration,
            }
            for r in reps
        ],
        "tempo_s": round(statistics.mean(durations), 2) if durations else None,
        "tempo_cv": (
            round(statistics.pstdev(durations) / statistics.mean(durations), 3)
            if len(durations) > 1
            else None
        ),
        "rep_rom_sd": (
            round(statistics.pstdev([r.range_of_motion for r in reps]), 1)
            if len(reps) > 1
            else None
        ),
        "continuous_segments": len(segments),
        "series": [
            [round(t, 3), None if v is None else round(v, 1)]
            for t, v in zip(times, values)
        ],
        "reason": "Projected 2D ROM. Isolated angle jumps are excluded, with gaps retained. Repetitions are complete angle cycles (minimum 25° excursion), not exercise recognition. No clinical reference is applied.",
    }


@one_assessment_at_a_time
def video(
    path,
    *,
    view="auto",
    tiled=False,
    progress=None,
    backend=None,
    protocol="",
    include_3d=False,
):
    import gc
    import cv2
    from . import api
    from .config import StudioConfig
    from .pipeline import Pipeline

    if view not in ("auto", *[v.value for v in al.View]):
        raise ValueError("Unknown camera view")
    cap = cv2.VideoCapture(str(path), cv2.CAP_FFMPEG, [cv2.CAP_PROP_N_THREADS, 1])
    fps = cap.get(cv2.CAP_PROP_FPS)
    n = cap.get(cv2.CAP_PROP_FRAME_COUNT)
    if not cap.isOpened() or not math.isfinite(fps) or fps <= 0:
        cap.release()
        raise ValueError("This video could not be decoded with a valid frame rate.")
    if n / fps > 120:
        cap.release()
        raise ValueError("Use a continuous clip of at most 2 minutes.")
    width, height = cap.get(cv2.CAP_PROP_FRAME_WIDTH), cap.get(
        cv2.CAP_PROP_FRAME_HEIGHT
    )
    cols, rows, inference_scale = tile_geometry(width, height)
    if not tiled:
        inference_scale = min(1, 640 / max(width, height))
    cfg = StudioConfig()
    cfg.tile_cols = cols if tiled else 1
    cfg.tile_rows = rows if tiled else 1
    cfg.tile_scale = 1
    # Photo and video share model weights; each Pipeline still owns a fresh
    # tracker. A second RTMO session can exhaust a small deployment's memory.
    model_backend = backend or api.pose_backend()
    backend = model_backend
    if tiled:
        from .pose import TiledBackend

        backend = TiledBackend(backend, cols=cols, rows=rows, scale=1, overlap=0.25)
    pipeline = Pipeline(cfg, backend=backend)
    sample_fps = float(os.environ.get("PILATES_VIDEO_SAMPLE_FPS", "6"))
    if not math.isfinite(sample_fps) or not 1 <= sample_fps <= 30:
        raise ValueError("Video sampling rate must be between 1 and 30 fps.")
    stride = max(1, int(round(fps / sample_fps)))
    tracks = {}
    counts = []
    index = 0
    sampled = 0
    last_time = -1
    timestamp_fallback = False
    last_depth = {}
    depth_candidates = []
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            pts = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000
            if math.isfinite(pts) and pts > last_time:
                t = pts
            else:
                t = max(index / fps, last_time + 1 / fps)
                timestamp_fallback = True
            last_time = t
            if t > 120:
                raise ValueError("Use a clip of at most 2 minutes.")
            if index % stride == 0:
                h, w = frame.shape[:2]
                r = pipeline.process_frame(frame, index, t)
                counts.append(len(r.people))
                sampled += 1
                # None placeholders retain lost frames and prevent gap interpolation.
                for tr in tracks.values():
                    tr["times"].append(t)
                    for values in tr["signals"].values():
                        values.append(None)
                for person in r.people:
                    d = person.detection
                    key = str(person.track_id)
                    if key not in tracks:
                        tracks[key] = {
                            "times": [t],
                            "signals": {k: [None] for k in SIGNALS},
                            "frames": [],
                            "valid": 0,
                            "seen": 0,
                            "conf": [],
                            "centres": [],
                            "scale": [],
                        }
                    tr = tracks[key]
                    tr["seen"] += 1
                    p = assess_person(
                        d,
                        w,
                        h,
                        person_id=key,
                        view=view,
                        mode="pose",
                        inference_scale=inference_scale,
                    )
                    tr["frames"].append(
                        {
                            "time": round(t, 3),
                            "landmarks": p["landmarks"],
                            "suitable": p["suitable"],
                        }
                    )
                    # Sparse depth is independently corroborated. Unsampled frames
                    # have no Z values; hidden movement is never interpolated.
                    if (
                        include_3d
                        and p["suitable"]
                        and t - last_depth.get(key, -2) >= 1
                    ):
                        # Keep a small encoded frame until 2D tracking finishes.
                        # Running both inference models together exceeded the
                        # memory ceiling on the free Render instance.
                        encoded, jpeg = cv2.imencode(
                            ".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 92]
                        )
                        if encoded:
                            from .types import Detection

                            depth_candidates.append(
                                (
                                    key,
                                    len(tr["frames"]) - 1,
                                    jpeg.tobytes(),
                                    Detection(d.keypoints.copy(), d.scores.copy()),
                                )
                            )
                        else:
                            tr["frames"][-1]["pose3d"] = pose3d.unavailable(
                                "This sampled frame could not be prepared for independent depth estimation."
                            )
                        last_depth[key] = t
                    if p["suitable"]:
                        tr["valid"] += 1
                        tr["conf"].append(float(d.confidence))
                        tr["centres"].append(
                            np.mean(d.keypoints[[11, 12]], axis=0).tolist()
                        )
                        tr["scale"].append(
                            p["validation"]["checks"]["projected_body_chain_px"]
                        )
                        for m in p["metrics"]:
                            if m["id"] in tr["signals"]:
                                tr["signals"][m["id"]][-1] = m["value"]
                if progress and sampled % 12 == 0:
                    progress(
                        f"Analysed {t:.1f}s · {len(r.people)} people in this frame"
                    )
            index += 1
    finally:
        cap.release()
    if depth_candidates:
        if api._BACKEND is model_backend:
            api._BACKEND = None
        del pipeline, backend, model_backend, frame, r, person, d
        gc.collect()
        try:
            import ctypes

            ctypes.CDLL(None).malloc_trim(0)
        except (AttributeError, OSError):
            pass
        if progress:
            progress("Estimating depth on corroborated visible frames")
        for key, frame_number, jpeg, detection in depth_candidates:
            image = cv2.imdecode(np.frombuffer(jpeg, dtype=np.uint8), cv2.IMREAD_COLOR)
            tracks[key]["frames"][frame_number]["pose3d"] = (
                pose3d.estimate(image, detection)
                if image is not None
                else pose3d.unavailable("The sampled frame could not be decoded.")
            )
        del depth_candidates
    # Retain established tracking gate; diagnostics cannot certify an identity.
    typical = float(np.median([c for c in counts if c])) if any(counts) else 0
    churn = len(tracks) / typical if typical else 0
    stable = bool(typical and churn <= 1.5)
    people = []
    for key, tr in tracks.items():
        visible_fraction = tr["valid"] / max(1, len(tr["times"]))
        enough = stable and tr["valid"] >= 12 and visible_fraction >= 0.6
        signals = (
            {k: analyse_series(tr["times"], v) for k, v in tr["signals"].items()}
            if enough
            else {}
        )
        for name, signal in signals.items():
            accepted_times = {
                round(t, 3) for t, v in signal.get("series", []) if v is not None
            }
            confidence = [
                min(f["landmarks"]["scores"][j] for j in SIGNALS[name][1])
                for f in tr["frames"]
                if f["time"] in accepted_times
            ]
            signal["confidence"] = (
                round(statistics.mean(confidence), 3)
                if confidence and signal["status"] != "unavailable"
                else None
            )
            signal["camera_view"] = view
            signal["source"] = "RTMO projected image angles"
            for (t, raw), (_, filtered) in zip(
                signal.get("raw_series", []), signal.get("series", [])
            ):
                if raw is not None and filtered is None:
                    f = next(
                        (f for f in tr["frames"] if abs(f["time"] - t) < 0.002), None
                    )
                    if f is not None:
                        f.setdefault("uncertain_joints", []).extend(SIGNALS[name][1])
        differences = {}
        for joint in ("shoulder", "elbow", "hip", "knee"):
            a, b = signals.get("left_" + joint, {}), signals.get("right_" + joint, {})
            if a.get("rom") is not None and b.get("rom") is not None:
                paired = [
                    (x, y)
                    for x, y in zip(
                        [v for _, v in a.get("series", [])],
                        [v for _, v in b.get("series", [])],
                    )
                    if x is not None and y is not None
                ]
                if len(paired) >= 12:
                    differences[joint] = round(
                        statistics.mean(x - y for x, y in paired), 1
                    )
        centre = np.array(tr["centres"])
        sway = None
        if enough and len(centre) > 6:
            sway = round(
                float(np.linalg.norm(np.std(centre, axis=0)))
                / max(statistics.median(tr["scale"]), 1),
                4,
            )
        people.append(
            {
                "person_id": key,
                "suitable": enough,
                "visible_fraction": round(visible_fraction, 3),
                "confidence": (
                    round(statistics.mean(tr["conf"]), 3) if tr["conf"] else 0
                ),
                "signals": signals,
                "frames": tr["frames"],
                "left_right_mean_angle_difference": differences,
                "trajectory_deviation_body_fraction": sway,
                "warnings": (
                    []
                    if enough
                    else [
                        "Movement unavailable: insufficient continuous visible body evidence or unstable tracking."
                    ]
                ),
                "pose3d": pose3d.unavailable(
                    "Depth is independently estimated on selected visible frames when requested. Movement angles use projected 2D landmarks; depth gaps remain unavailable."
                ),
                "score": {
                    "value": None,
                    "reason": "No validated exercise-specific movement score is configured.",
                },
            }
        )
    return {
        "version": VERSION,
        "kind": "video",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "width": w if index else 0,
        "height": h if index else 0,
        "duration": round(max(0, last_time + 1 / fps), 2),
        "timestamps": "nominal_fps_fallback" if timestamp_fallback else "decoder_pts",
        "sample_fps": fps / stride,
        "view": view,
        "protocol": str(protocol).strip()[:80],
        "people": people,
        "tracking": {
            "typical_people": typical,
            "tracks": len(tracks),
            "churn": round(churn, 3),
            "stable": stable,
        },
        "warnings": (
            []
            if stable
            else [
                "Tracking is too unstable to attribute movement to individuals. Try a clearer camera view."
            ]
        ),
        "disclaimer": "Projected 2D motion, not clinical ROM. No clinical reference or exercise name is inferred. Track numbers are not verified identities; inspect the video overlay.",
    }


def ensure_table(store):
    store.db.execute(
        "CREATE TABLE IF NOT EXISTS evidence_assessments (id TEXT PRIMARY KEY, subject TEXT NOT NULL, created_at TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL)"
    )
    store.db.commit()


def save(store, payload):
    # Reuse server-generated report IDs. Never trust client-provided scores.
    raise ValueError(
        "Save through the analysis request; client-supplied scores are not accepted."
    )


def record(store, report, subject):
    ensure_table(store)
    key = uuid.uuid4().hex
    store.db.execute(
        "INSERT INTO evidence_assessments VALUES (?,?,?,?,?)",
        (
            key,
            str(subject).strip()[:80] or "Unnamed",
            report["created_at"],
            report["kind"],
            json.dumps(report, allow_nan=False),
        ),
    )
    store.db.commit()
    return key


def history(store):
    ensure_table(store)
    return [
        {"id": r[0], "subject": r[1], "created_at": r[2], "kind": r[3]}
        for r in store.db.execute(
            "SELECT id,subject,created_at,kind FROM evidence_assessments ORDER BY created_at DESC LIMIT 100"
        )
    ]


def detail(store, key):
    ensure_table(store)
    row = store.db.execute(
        "SELECT subject,payload FROM evidence_assessments WHERE id=?", (key,)
    ).fetchone()
    if not row:
        raise ValueError("Assessment not found")
    return {"id": key, "subject": row[0], "report": json.loads(row[1])}


def compare(store, before_id, after_id, before_person, after_person):
    a, b = detail(store, before_id), detail(store, after_id)
    why = []
    if a["subject"] != b["subject"]:
        why.append("The named subjects differ.")
    if a["subject"] == "Unnamed" or b["subject"] == "Unnamed":
        why.append("Name the subject in both assessments before comparing.")
    if a["report"]["kind"] != b["report"]["kind"]:
        why.append("Assessment types differ.")
    if a["report"]["version"] != b["report"]["version"]:
        why.append("Measurement versions differ.")
    pa = next(
        (p for p in a["report"]["people"] if p["person_id"] == str(before_person)), None
    )
    pb = next(
        (p for p in b["report"]["people"] if p["person_id"] == str(after_person)), None
    )
    if not pa or not pb:
        raise ValueError("Choose the person in each assessment")
    if not pa["suitable"] or not pb["suitable"]:
        why.append("One assessment was refused.")
    if (pa.get("view", a["report"].get("view")), pa.get("mode")) != (
        pb.get("view", b["report"].get("view")),
        pb.get("mode"),
    ):
        why.append("Camera views or protocols differ.")
    if a["report"]["kind"] == "video":
        protocol = a["report"].get("protocol", "")
        if not protocol or protocol != b["report"].get("protocol"):
            why.append(
                "Movement comparison requires matching, nonempty exercise protocols."
            )
        if a["report"].get("view") == "auto" or b["report"].get("view") == "auto":
            why.append("Select an explicit camera view for movement comparisons.")
    changes = []
    if not why:
        if a["report"]["kind"] == "photo":
            old = {m["id"]: m for m in pa["metrics"]}
            for m in pb["metrics"]:
                prev = old.get(m["id"])
                if (
                    prev
                    and m["value"] is not None
                    and prev["value"] is not None
                    and m["unit"] == prev["unit"]
                    and m["status"] == prev["status"]
                ):
                    changes.append(
                        {
                            "name": m["name"],
                            "before": prev["value"],
                            "after": m["value"],
                            "delta": round(m["value"] - prev["value"], 3),
                            "unit": m["unit"],
                        }
                    )
        else:
            for k, m in pb["signals"].items():
                prev = pa["signals"].get(k, {})
                if m.get("rom") is not None and prev.get("rom") is not None:
                    changes.append(
                        {
                            "name": SIGNALS[k][0] + " ROM",
                            "before": prev["rom"],
                            "after": m["rom"],
                            "delta": round(m["rom"] - prev["rom"], 1),
                            "unit": "deg",
                        }
                    )
    sa, sb = pa["score"].get("value"), pb["score"].get("value")
    same_checks = {c["metric"] for c in pa["score"].get("checks", [])} == {
        c["metric"] for c in pb["score"].get("checks", [])
    }
    return {
        "comparable": not why,
        "reasons": why,
        "changes": changes,
        "score_delta": (
            round(sb - sa, 1)
            if not why and same_checks and sa is not None and sb is not None
            else None
        ),
        "note": "Repeat camera position, distance, view and exercise. Differences include pose-estimation error and are not proof of improvement.",
    }
