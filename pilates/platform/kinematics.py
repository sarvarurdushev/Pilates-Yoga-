"""Coordinate provenance and conservative temporal derivatives."""

import math
import statistics

DERIVED = {17: (5, 6), 18: (11, 12), 19: (5, 6, 11, 12)}


def coordinates(landmarks, pose3d=None, suitable=True, uncertain=()):
    points = landmarks.get("keypoints", [])
    scores = landmarks.get("scores", [])
    world = (pose3d or {}).get("joints") or []
    world_scores = (pose3d or {}).get("scores") or []
    out = []
    for i in range(20):
        parents = DERIVED.get(i, (i,))
        for space, pts, conf in [
            ("image_px", points, scores),
            ("model_estimated_m", world, world_scores),
        ]:
            present = all(j < len(pts) and j < len(conf) for j in parents)
            confidence = min((conf[j] for j in parents), default=0) if present else 0
            valid = (
                present
                and suitable
                and confidence >= 0.5
                and not any(j in uncertain for j in parents)
            )
            if space == "model_estimated_m":
                valid = (
                    valid
                    and confidence >= 0.65
                    and (pose3d or {}).get("status") == "estimated"
                )
            xyz = (
                [
                    sum(float(pts[j][k]) for j in parents) / len(parents)
                    for k in range(len(pts[parents[0]]))
                ]
                if valid
                else []
            )
            if xyz and not all(math.isfinite(v) for v in xyz):
                valid = False
                xyz = []
            status = (
                "estimated"
                if valid and (space == "model_estimated_m" or i >= 17)
                else "measured" if valid else "unavailable"
            )
            reason = (
                "Midpoint proxy; not a detected vertebra."
                if i >= 17
                else "Image-plane pose estimate."
            )
            if valid and space == "model_estimated_m":
                reason = "Hip-centred model estimate in metres; scale and depth are not calibrated body measurements."
            if not valid:
                reason = (
                    (pose3d or {}).get(
                        "reason", "No corroborated depth for this frame."
                    )
                    if space == "model_estimated_m" and not world
                    else "Unavailable / low confidence or unsuitable frame."
                )
            out.append(
                {
                    "landmark_id": str(i),
                    "x": round(xyz[0], 3) if valid else None,
                    "y": round(xyz[1], 3) if valid else None,
                    "z": round(xyz[2], 4) if valid and len(xyz) > 2 else None,
                    "confidence": round(confidence, 3) if present else None,
                    "space": space,
                    "status": status,
                    "reason": reason,
                }
            )
    return out


def derivatives(series, max_gap=0.6):
    """Backward finite differences; preserve missing values and capture gaps."""
    velocity = []
    acceleration = []
    previous = None
    previous_v = None
    for t, v in series:
        speed = None
        acc = None
        if v is not None and previous is not None:
            dt = t - previous[0]
            if 0 < dt <= max_gap + 1e-9:
                speed = (v - previous[1]) / dt
                if previous_v is not None and 0 < t - previous_v[0] <= max_gap + 1e-9:
                    acc = (speed - previous_v[1]) / (t - previous_v[0])
        velocity.append([t, round(speed, 5) if speed is not None else None])
        acceleration.append([t, round(acc, 5) if acc is not None else None])
        previous = (t, v) if v is not None else None
        previous_v = (t, speed) if speed is not None else None
    return velocity, acceleration


def temporal(people, target=None):
    result = {}
    for person in people:
        if not person.get("suitable"):
            continue
        signals = {}
        for name, s in person.get("signals", {}).items():
            series = s.get("series", [])
            v, a = derivatives(series)
            speeds = [abs(x) for _, x in v if x is not None]
            acc = [abs(x) for _, x in a if x is not None]
            observed = [(t, x) for t, x in series if x is not None]
            phases = None
            if observed:
                peak = max(observed, key=lambda z: z[1])
                phases = {
                    "start": observed[0],
                    "peak": peak,
                    "return": observed[-1],
                    "complete_cycle": bool(s.get("repetitions")),
                }
            signals[name] = {
                "velocity": v,
                "acceleration": a,
                "mean_speed_deg_s": (
                    round(statistics.mean(speeds), 2) if speeds else None
                ),
                "peak_speed_deg_s": round(max(speeds), 2) if speeds else None,
                "mean_acceleration_deg_s2": (
                    round(statistics.mean(acc), 2) if acc else None
                ),
                "speed_variation": (
                    round(statistics.pstdev(speeds), 2) if len(speeds) > 2 else None
                ),
                "phases": phases,
                "target_deviation_deg": (
                    round(peak[1] - float(target), 1)
                    if target is not None and observed
                    else None
                ),
                "smoothness_label": "Angular speed variation (lower is steadier for a constant-speed task); not a validated movement-quality score.",
            }
        trajectories = {}
        frame_coords = [
            (
                f["time"],
                {
                    c["landmark_id"]: c
                    for c in coordinates(
                        f["landmarks"],
                        f.get("pose3d"),
                        f.get("suitable"),
                        f.get("uncertain_joints", ()),
                    )
                    if c["space"] == "image_px"
                },
            )
            for f in person.get("frames", [])
        ]
        for joint in range(20):
            rows = [(t, c[str(joint)]) for t, c in frame_coords]
            x = [[t, c["x"]] for t, c in rows]
            y = [[t, c["y"]] for t, c in rows]
            vx, ax = derivatives(x)
            vy, ay = derivatives(y)
            trajectories[str(joint)] = {
                "x": x,
                "y": y,
                "velocity_x": vx,
                "velocity_y": vy,
                "acceleration_x": ax,
                "acceleration_y": ay,
                "unit": "px",
                "reference": "Original image coordinates; camera motion changes these values.",
            }
        result[person["person_id"]] = {
            "signals": signals,
            "trajectories": trajectories,
            "stability": person.get("trajectory_deviation_body_fraction"),
            "stability_label": "Hip-centre trajectory variation / body span; not force-platform balance or true centre of mass.",
        }
    return result
