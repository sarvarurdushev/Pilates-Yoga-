"""Persist algorithm output as linked sessions, frames, coordinates and observations."""

from .repository import uid, now, encode
from .regions import region_for
from .kinematics import coordinates, temporal


def save_analysis(
    repo,
    actor,
    student_id,
    report,
    media_ids=None,
    protocol="",
    location_id=None,
    synthetic=False,
    created_at=None,
    detail=None,
    prepared=None,
):
    if prepared is not None and not synthetic:
        raise ValueError("Prepared scenarios are only allowed for labelled demo data.")
    repo.assert_student(actor, student_id, True)
    identifier = uid()
    created_at = created_at or now()
    media_ids = media_ids or {}
    kind = report["kind"]
    views = report["views"]
    if kind == "movement":
        from ..assessment import SIGNALS

        for view in views:
            for person in view["report"].get("people", []):
                person["metrics"] = [
                    {
                        "id": name + "_rom",
                        "name": SIGNALS.get(name, (name,))[0] + " ROM",
                        "value": signal.get("rom"),
                        "unit": "deg",
                        "confidence": signal.get("confidence"),
                        "status": signal.get("status", "unavailable"),
                        "reason": signal.get(
                            "reason", "Observed projected range across the clip."
                        ),
                    }
                    for name, signal in person.get("signals", {}).items()
                ]
    complete = any(
        p.get("suitable") for v in views for p in v["report"].get("people", [])
    )
    report["kinematics"] = (
        prepared["kinematics"]
        if prepared is not None
        else (
            temporal(
                views[0]["report"].get("people", []), (detail or {}).get("target_angle")
            )
            if kind == "movement"
            else {}
        )
    )
    report.update(
        id=identifier, student_id=student_id, created_at=created_at, synthetic=synthetic
    )
    with repo.db() as db:
        repo._linked(actor, {"location_id": location_id}, db)
        meta = {
            **(detail or {}),
            "synthetic": synthetic,
            "source": (
                "Demo simulation from scenario coordinates"
                if synthetic
                else "Computed from uploaded media"
            ),
            "score": report.get("summary", {}).get("score"),
            "available_metrics": sum(
                m.get("value") is not None
                for m in report.get("summary", {}).get("metrics", [])
            ),
        }
        db.execute(
            "INSERT INTO p_analyses VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                identifier,
                actor.org_id,
                student_id,
                actor.user_id,
                location_id,
                kind,
                protocol,
                created_at,
                "complete" if complete else "needs_capture",
                int(synthetic),
                encode(report),
                encode(meta),
            ),
        )
        for view in views:
            raw = view["report"]
            camera = view["view"]
            media = media_ids.get(camera)
            if media:
                m = repo.get(actor, "media", media, db)
                if m.get("student_id") != student_id:
                    raise ValueError("Media belongs to another client.")
            if kind == "movement":
                db.execute(
                    "INSERT INTO p_video_analyses VALUES (?,?,?,?,?,?)",
                    (
                        uid(),
                        identifier,
                        media,
                        camera,
                        raw.get("duration", 0),
                        encode(raw),
                    ),
                )
            else:
                db.execute(
                    "INSERT INTO p_image_analyses VALUES (?,?,?,?,?)",
                    (uid(), identifier, media, camera, encode(raw)),
                )
            for person in raw.get("people", []):
                person_id = str(person["person_id"])
                frames = (
                    person.get("frames", [])
                    if kind == "movement"
                    else [
                        {
                            "time": 0,
                            "landmarks": person["landmarks"],
                            "pose3d": person.get("pose3d"),
                            "suitable": person.get("suitable"),
                        }
                    ]
                )
                for frame_index, frame in enumerate(frames):
                    fid = uid()
                    db.execute(
                        "INSERT INTO p_pose_frames VALUES (?,?,?,?,?,?,?)",
                        (
                            fid,
                            identifier,
                            person_id,
                            camera,
                            frame_index,
                            frame["time"],
                            int(bool(frame.get("suitable"))),
                        ),
                    )
                    values = (
                        prepared["coordinates"][camera][person_id][frame_index]
                        if prepared is not None
                        else coordinates(
                            frame["landmarks"],
                            frame.get("pose3d"),
                            frame.get("suitable"),
                            frame.get("uncertain_joints", ()),
                        )
                    )
                    db.executemany(
                        "INSERT INTO p_coordinates(frame_id,landmark_id,x,y,z,confidence,space,status,reason) VALUES (?,?,?,?,?,?,?,?,?)",
                        [
                            (
                                fid,
                                c["landmark_id"],
                                c["x"],
                                c["y"],
                                c["z"],
                                c["confidence"],
                                c["space"],
                                c["status"],
                                c["reason"],
                            )
                            for c in values
                        ],
                    )
                for metric in person.get("metrics", []):
                    region = region_for(metric["name"])
                    cur = db.execute(
                        "INSERT INTO p_joint_measurements(analysis_id,person_id,view,name,value,unit,confidence,status,region_id,detail) VALUES (?,?,?,?,?,?,?,?,?,?)",
                        (
                            identifier,
                            person_id,
                            camera,
                            metric["name"],
                            metric.get("value"),
                            metric.get("unit", "deg"),
                            metric.get("confidence"),
                            metric.get("status", "unavailable"),
                            region,
                            encode(metric),
                        ),
                    )
                    if kind == "posture":
                        db.execute(
                            "INSERT INTO p_posture_measurements(measurement_id) VALUES (?)",
                            (cur.lastrowid,),
                        )
                if kind == "movement":
                    mid = uid()
                    db.execute(
                        "INSERT INTO p_movement_analyses VALUES (?,?,?,?)",
                        (
                            mid,
                            identifier,
                            person_id,
                            encode(report["kinematics"].get(person_id, {})),
                        ),
                    )
                    for name, signal in person.get("signals", {}).items():
                        db.execute(
                            "INSERT INTO p_rom_measurements(movement_id,name,value,unit,status,detail) VALUES (?,?,?,?,?,?)",
                            (
                                mid,
                                name,
                                signal.get("rom"),
                                "deg",
                                signal.get("status", "unavailable"),
                                encode(signal),
                            ),
                        )
                    for name, value in person.get(
                        "left_right_mean_angle_difference", {}
                    ).items():
                        db.execute(
                            "INSERT INTO p_symmetry_measurements(analysis_id,region_id,name,value,unit,detail) VALUES (?,?,?,?,?,?)",
                            (
                                identifier,
                                region_for(name),
                                name,
                                value,
                                "deg",
                                encode(
                                    {
                                        "method": "Paired left-minus-right image-plane angles",
                                        "person_id": person_id,
                                        "view": camera,
                                    }
                                ),
                            ),
                        )
        publish_progress(
            db, identifier, student_id, report, meta, created_at, synthetic
        )
        repo.audit(
            db,
            actor,
            "analysis:completed" if complete else "analysis:refused",
            identifier,
        )
    return identifier


def publish_progress(db, identifier, student_id, report, detail, created_at, synthetic):
    """Publish only the selected person's evidence; replace atomically on re-review."""
    db.execute("DELETE FROM p_progress_records WHERE analysis_id=?", (identifier,))
    db.execute(
        "DELETE FROM p_observations WHERE analysis_id=? AND source IN ('Demo scenario','Image-plane measurement','Tracked movement')",
        (identifier,),
    )
    for view in report["views"]:
        camera = view["view"]
        candidates = [p for p in view["report"].get("people", []) if p.get("suitable")]
        selected = detail.get("selected_people", {}).get(camera)
        person = (
            next((p for p in candidates if str(p["person_id"]) == str(selected)), None)
            if selected is not None
            else candidates[0] if len(candidates) == 1 else None
        )
        if person is None:
            continue
        values = [
            (m["id"], m["name"], m.get("value"), m.get("unit", "deg"), "posture")
            for m in (person.get("metrics", []) if report["kind"] == "posture" else [])
        ]
        for name, signal in person.get("signals", {}).items():
            values.append(
                (
                    name + "_rom",
                    name.replace("_", " ") + " ROM",
                    signal.get("rom"),
                    "deg",
                    "movement",
                )
            )
            for key, unit in [
                ("tempo_cv", "ratio"),
                ("rep_rom_sd", "deg"),
                ("repetitions", "cycles"),
            ]:
                values.append(
                    (
                        name + "_" + key,
                        name.replace("_", " ") + " " + key,
                        signal.get(key),
                        unit,
                        "movement",
                    )
                )
        for key, name, value, unit, kind in values:
            if value is None:
                continue
            db.execute(
                "INSERT INTO p_progress_records VALUES (?,?,?,?,?,?,?,?)",
                (
                    uid(),
                    student_id,
                    identifier,
                    camera + ":" + key,
                    value,
                    unit,
                    created_at,
                    int(synthetic),
                ),
            )
            if key.endswith(("_tempo_cv", "_rep_rom_sd", "_repetitions")):
                continue
            db.execute(
                "INSERT INTO p_observations VALUES (?,?,?,?,?,?,?,?,?)",
                (
                    uid(),
                    student_id,
                    identifier,
                    region_for(name),
                    None,
                    kind,
                    f"{name}: {value} {unit} in the {camera} view.",
                    (
                        "Demo scenario"
                        if synthetic
                        else (
                            "Tracked movement"
                            if kind == "movement"
                            else "Image-plane measurement"
                        )
                    ),
                    created_at,
                ),
            )
