"""Repeatable, isolated demonstration organizations with explicit simulation provenance."""

from datetime import datetime, timedelta, timezone
from pathlib import Path
import json
import math
import threading
from .repository import Actor, encode, now, uid

_LOCK = threading.Lock()
ROOT = Path(__file__).resolve().parents[2]
NAMES = [
    "Sarah Kim",
    "David Lee",
    "Minji Park",
    "James Han",
    "Olivia Choi",
    "Elena Kim",
    "George Lee",
    "Lucas Park",
    "Sofia Han",
    "Daniel Cho",
    "Mia Jung",
    "Noah Yoon",
    "Ava Shin",
    "Leo Lim",
    "Emma Kang",
    "Oliver Seo",
    "Chloe Bae",
    "Liam Oh",
    "Isabella Jang",
    "Mason Song",
    "Amelia Kwon",
    "Benjamin Hong",
    "Harper Moon",
    "Henry Baek",
    "Evelyn Ryu",
    "Alexander Nam",
    "Ella Ahn",
    "William Ko",
    "Scarlett Jin",
    "Jack Yang",
    "Luna Hwang",
    "Thomas Im",
    "Aria Jeon",
    "Samuel Yoo",
]
SCENARIOS = [
    ("Shoulder alignment", "right_shoulder"),
    ("Balanced baseline", "pelvis"),
    ("Forward-head tendency", "head"),
    ("Hip alignment", "pelvis"),
    ("Upper-body mobility", "thorax"),
    ("Supported balance", "both_ankle"),
]

# Public educational references are associated by body region, not presented
# as acquisitions of a fictional client. Preserve attribution on every record.
SCAN_REFERENCES = {
    "right_shoulder": (
        "studio/xray-shoulder.jpg",
        "shoulder",
        "Mikael Häggström · CC0 1.0",
        "https://commons.wikimedia.org/wiki/File:Y-projection_X-ray_of_a_normal_shoulder.jpg",
    ),
    "pelvis": (
        "studio/xray-pelvis.jpg",
        "pelvis",
        "UC San Diego Radiology · Public domain medical imaging",
        "https://commons.wikimedia.org/wiki/File:X-ray_of_the_pelvis_of_an_18_year_old_male_-_case_1_-_anteroposterior.jpg",
    ),
    "head": (
        "platform/xray-cervical.jpg",
        "cervical spine",
        "UC San Diego Radiology · Public domain medical imaging",
        "https://commons.wikimedia.org/wiki/File:X-ray_of_the_cervical_spine_of_an_20_year_old_male_-_lateral,_case_2.jpg",
    ),
    "thorax": (
        "platform/xray-chest.jpg",
        "thorax",
        "Yale Rosen · CC BY-SA 2.0 · Unmodified image",
        "https://commons.wikimedia.org/wiki/File:Normal_PA_chest_x-ray_(5414485536).jpg",
    ),
    "both_ankle": (
        "platform/xray-ankle.jpg",
        "ankle",
        "Mikael Häggström · CC0 1.0",
        "https://commons.wikimedia.org/wiki/File:X-ray_of_normal_ankle_-_frontal.jpg",
    ),
}


def scenario_for(client):
    # The first seven profiles have individually authored before/after imagery.
    return {1: 3, 3: 2, 5: 2, 6: 2}.get(client, client % len(SCENARIOS))


def seed_organization(repo, org):
    with _LOCK:
        with repo.db() as db:
            if db.execute(
                "SELECT 1 FROM p_organizations WHERE id=?", (org,)
            ).fetchone():
                return
        with repo.batch():
            _seed(repo, org)


def _seed(repo, org):
    prefix = org + "-"
    today = datetime.now(timezone.utc).replace(
        hour=1, minute=0, second=0, microsecond=0
    )
    coaches = [prefix + "coach" + str(i) for i in range(4)]
    locations = [prefix + "location" + str(i) for i in range(4)]
    admin = prefix + "admin"
    catalog = json.loads(Path(__file__).with_name("catalog.json").read_text())
    try:
        with repo.db() as db:
            db.execute(
                "INSERT INTO p_organizations VALUES (?,?,1,?)",
                (org, "Motion Yoga · Demonstration organization", now()),
            )

            def user(identifier, name, role, avatar="", detail=None):
                db.execute(
                    "INSERT INTO p_users(id,org_id,name,email,avatar,detail) VALUES (?,?,?,?,?,?)",
                    (
                        identifier,
                        org,
                        name,
                        identifier + "@example.invalid",
                        avatar,
                        encode(detail or {}),
                    ),
                )
                db.execute("INSERT INTO p_roles VALUES (?,?)", (identifier, role))

            user(admin, "Jules · Organization administrator", "admin")
            for i, name in enumerate(["Songdo", "Gangnam", "Seoul", "Incheon"]):
                loc = locations[i]
                coach = coaches[i]
                db.execute(
                    "INSERT INTO p_locations VALUES (?,?,?,?,?,?)",
                    (
                        loc,
                        org,
                        name,
                        name + " · Fictional demonstration address",
                        12,
                        encode({"demo": True}),
                    ),
                )
                db.execute(
                    "INSERT INTO p_rooms VALUES (?,?,?,?)",
                    (loc + "-room", loc, "Movement studio", 8),
                )
                user(
                    coach,
                    ["Hana Lee", "Alex Morgan", "Jamie Park", "Robin Kim"][i],
                    "coach",
                )
                db.execute(
                    "INSERT INTO p_coaches VALUES (?,?)",
                    (
                        coach,
                        "Pilates and movement coaching · fictional demonstration profile",
                    ),
                )
                db.execute("INSERT INTO p_coach_locations VALUES (?,?)", (coach, loc))
                for key, label, qty in [
                    ("reformer", "Reformer", 4),
                    ("cadillac", "Cadillac", 1),
                    ("chair", "Chair", 2),
                    ("barrel", "Barrel", 2),
                    ("mat", "Mat", 12),
                    ("ring", "Ring", 6),
                    ("band", "Resistance band", 10),
                    ("roller", "Foam roller", 6),
                    ("blocks", "Blocks", 12),
                    ("balls", "Balls", 8),
                ]:
                    db.execute(
                        "INSERT INTO p_equipment VALUES (?,?,?,?,?,?,?)",
                        (loc + "-" + key, org, loc, label, qty, qty, "{}"),
                    )
            for ex in catalog:
                region = "thorax"
                text = (ex["name"] + " " + ex["detail"].get("pattern", "")).lower()
                for word, value in [
                    ("hip", "both_hip"),
                    ("knee", "both_knee"),
                    ("ankle", "both_ankle"),
                    ("shoulder", "both_shoulder"),
                    ("breath", "thorax"),
                    ("spine", "lumbar"),
                    ("neck", "head"),
                ]:
                    if word in text:
                        region = value
                detail = ex["detail"]
                detail["equipment_type"] = ex["equipment"]
                tags = [ex["category"]]
                for word, tag in [
                    ("breath", "Breathing"),
                    ("balance", "Balance"),
                    ("stretch", "Flexibility"),
                    ("spine", "Spine"),
                    ("shoulder", "Shoulder"),
                    ("hip", "Hip"),
                    ("knee", "Knee"),
                    ("ankle", "Ankle"),
                    ("roll", "Core"),
                    ("mobility", "Mobility"),
                ]:
                    if word in text:
                        tags.append(tag)
                detail["tags"] = tags
                cells = {
                    "breathing": 0,
                    "spineTwistSeated": 1,
                    "shoulderPlacement": 2,
                    "headNods": 3,
                    "catStretchMat": 4,
                    "clam": 5,
                    "sideLyingLegLift": 6,
                    "deadBug": 7,
                }
                if ex["key"] in cells:
                    detail.update(
                        thumbnail="/assets/platform/exercise-sheet.png",
                        thumbnail_cell=cells[ex["key"]],
                    )
                elif ex["key"] == "birdDog":
                    detail["thumbnail"] = "/assets/studio/bird-dog.png"
                elif ex["key"] in ("pelvicCurl", "shoulderbridge"):
                    detail["thumbnail"] = "/assets/studio/bridge.png"
                db.execute(
                    "INSERT INTO p_exercises VALUES (?,?,?,?,?,?,?,?,?)",
                    (
                        prefix + "ex-" + ex["key"],
                        org,
                        coaches[0],
                        ex["name"],
                        ex["category"],
                        ex["difficulty"],
                        region,
                        "organization",
                        encode(detail),
                    ),
                )
                db.execute(
                    "INSERT INTO p_exercise_equipment VALUES (?,?,1)",
                    (
                        prefix + "ex-" + ex["key"],
                        locations[0]
                        + "-"
                        + (
                            ex["equipment"]
                            if ex["equipment"]
                            in ("mat", "reformer", "cadillac", "chair", "barrel")
                            else "mat"
                        ),
                    ),
                )
            student_data = []
            for i, name in enumerate(NAMES):
                ci = 0 if i < 8 else 1 if i < 18 else 2 if i < 25 else 3
                sid = prefix + "student" + str(i).zfill(2)
                scenario, region = SCENARIOS[scenario_for(i)]
                asset = (
                    [
                        "sarah",
                        "david",
                        "older-woman",
                        "older-man",
                        "athletic",
                        "middle-woman",
                        "middle-man",
                    ][i]
                    if i < 7
                    else ""
                )
                ages = [28, 32, 68, 70, 40, 52, 54]
                age = (
                    ages[i]
                    if i < 7
                    else [
                        24,
                        31,
                        38,
                        45,
                        52,
                        59,
                        66,
                        26,
                        33,
                        40,
                        47,
                        54,
                        61,
                        68,
                        28,
                        35,
                        42,
                        49,
                        56,
                        63,
                        23,
                        30,
                        37,
                        44,
                        51,
                        58,
                        65,
                    ][i - 7]
                )
                user(
                    sid,
                    name,
                    "student",
                    (
                        "/assets/platform/" + asset + ".png"
                        if asset
                        else f"/assets/platform/portraits-{1+(i-7)//9}.png"
                    ),
                    {
                        "demo": True,
                        "asset": asset,
                        "avatar_panel": 1,
                        **({"avatar_cell": (i - 7) % 9} if i >= 7 else {}),
                        "profile_initials": "".join(x[0] for x in name.split()),
                        "age": age,
                    },
                )
                db.execute(
                    "INSERT INTO p_students VALUES (?,?,?,?,?,?)",
                    (
                        sid,
                        str(today.year - age) + "-04-15",
                        "Build a consistent comfortable practice",
                        None,
                        None,
                        scenario,
                    ),
                )
                db.execute(
                    "INSERT INTO p_student_locations VALUES (?,?)", (sid, locations[ci])
                )
                db.execute(
                    "INSERT INTO p_coach_students VALUES (?,?)", (coaches[ci], sid)
                )
                student_data.append((i, sid, ci, region, asset))
            for ci in range(4):
                for si, (title, region) in enumerate(SCENARIOS):
                    pid = prefix + f"program{ci}-{si}"
                    db.execute(
                        "INSERT INTO p_programs VALUES (?,?,?,?,?,?,?,?)",
                        (
                            pid,
                            org,
                            coaches[ci],
                            locations[ci],
                            title + " · coached practice",
                            "Repeat comfortable movement and review visible control",
                            region,
                            encode(
                                {
                                    "difficulty": "Foundation",
                                    "frequency": "Twice weekly",
                                    "description": "An adaptable demonstration sequence. Coach confirms the choice and range before practice.",
                                    "movement_focus": title,
                                    "duration": 15,
                                }
                            ),
                        ),
                    )
                    keys = [
                        [
                            "breathing",
                            "shoulderPlacement",
                            "birdDog",
                            "threadTheNeedle",
                            "catStretchMat",
                        ],
                        [
                            "breathing",
                            "pelvicCurl",
                            "deadBug",
                            "sidekick",
                            "spineStretchForward",
                        ],
                        [
                            "breathing",
                            "headNods",
                            "shoulderPlacement",
                            "swan",
                            "catStretchMat",
                        ],
                        [
                            "breathing",
                            "clam",
                            "pelvicCurl",
                            "sideLyingLegLift",
                            "spineTwistSupine",
                        ],
                        [
                            "breathing",
                            "catStretchMat",
                            "threadTheNeedle",
                            "spineTwistSeated",
                            "spineStretchForward",
                        ],
                        [
                            "breathing",
                            "kneeFolds",
                            "birdDog",
                            "legLifts",
                            "imprintRelease",
                        ],
                    ][si]
                    for pos, key in enumerate(keys):
                        db.execute(
                            "INSERT INTO p_program_exercises VALUES (?,?,?,?,?,?,?,?,?,?)",
                            (
                                uid(),
                                pid,
                                prefix + "ex-" + key,
                                pos,
                                (
                                    "Warm-up"
                                    if pos == 0
                                    else (
                                        "Cooldown"
                                        if pos == len(keys) - 1
                                        else "Practice"
                                    )
                                ),
                                2,
                                8,
                                60,
                                30,
                                "Keep the range comfortable; review the linked region note.",
                            ),
                        )
        from .analysis import save_analysis

        for i, sid, ci, region, asset in student_data:
            actor = Actor(coaches[ci], org, "coach", True)
            pid = prefix + f"program{ci}-{scenario_for(i)}"
            aids = []
            for visit in range(6):
                date = today - timedelta(days=(5 - visit) * 7 + 2)
                from .demo_scenarios import prepared_scenario

                prepared = prepared_scenario(i, visit)
                report = prepared["report"]
                media = {}
                image = ROOT / "web/assets/platform" / f"{asset}.png"
                if asset and image.exists():
                    mid = uid()
                    with repo.db() as db:
                        db.execute(
                            "INSERT INTO p_media VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                            (
                                mid,
                                org,
                                coaches[ci],
                                sid,
                                None,
                                "capture",
                                "image/png",
                                image.name,
                                str(image),
                                image.stat().st_size,
                                date.isoformat(),
                                encode(
                                    {
                                        "generated": True,
                                        "panel": 0 if visit < 3 else 1,
                                        "provenance": "Fictional before/after illustration. Coordinates are a separate demo simulation, not measurements from this picture.",
                                    }
                                ),
                            ),
                        )
                    media = {report["views"][0]["view"]: mid}
                    report["views"][0]["media_id"] = mid
                aid = save_analysis(
                    repo,
                    actor,
                    sid,
                    report,
                    media,
                    (
                        [
                            "Shoulder flexion",
                            "Squat",
                            "Forward bend",
                            "Standing hip lift",
                            "Shoulder flexion",
                            "Standing balance",
                        ][scenario_for(i)]
                        if visit % 2
                        else "Standing posture"
                    ),
                    locations[ci],
                    True,
                    date.isoformat(),
                    {
                        "visit": visit + 1,
                        "scenario": SCENARIOS[scenario_for(i)][0],
                        "target_angle": (
                            140 if scenario_for(i) in (0, 4) and visit % 2 else None
                        ),
                        "asset": asset,
                        "panel": 0 if visit < 3 else 1,
                    },
                    prepared=prepared,
                )
                aids.append(aid)
                with repo.db() as db:
                    steps = [
                        r[0]
                        for r in db.execute(
                            "SELECT exercise_id FROM p_program_exercises WHERE program_id=? ORDER BY position",
                            (pid,),
                        )
                    ]
                    db.execute(
                        "INSERT INTO p_training_sessions VALUES (?,?,?,?,?,?,?,?)",
                        (
                            uid(),
                            sid,
                            None,
                            pid,
                            aid,
                            date.isoformat(),
                            encode(steps),
                            f"Demo visit {visit+1}: "
                            + (
                                "establish a comfortable baseline."
                                if visit == 0
                                else "repeat the same capture setup and review the linked trend."
                            ),
                        ),
                    )
                    db.execute(
                        "INSERT INTO p_notes VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                        (
                            uid(),
                            org,
                            sid,
                            coaches[ci],
                            aid,
                            region,
                            None,
                            pid,
                            steps[min(1, len(steps) - 1)],
                            f"Demo visit {visit+1}: "
                            + (
                                "begin with a supported range."
                                if visit < 2
                                else "Observed simulation is becoming more consistent. Continue comfortable practice and compare the next session."
                            ),
                            "student",
                            date.isoformat(),
                            "{}",
                        ),
                    )
            repo.assign_program(
                actor,
                {
                    "student_id": sid,
                    "program_id": pid,
                    "analysis_id": aids[-1],
                    "notes": "Use the latest assessment to review the target region.",
                },
            )
            for slot in range(3):
                start = today + timedelta(days=1 + slot * 7, hours=(i % 10))
                repo.save(
                    actor,
                    "reservations",
                    {
                        "student_id": sid,
                        "coach_id": coaches[ci],
                        "location_id": locations[ci],
                        "room_id": locations[ci] + "-room",
                        "program_id": pid,
                        "starts_at": start.isoformat(),
                        "ends_at": (start + timedelta(minutes=50)).isoformat(),
                        "status": "reserved",
                        "session_type": "Individual Pilates",
                        "detail": {"demo": True},
                    },
                )
            scan_path, scan_name, attribution, source_url = SCAN_REFERENCES[region]
            scanfile = ROOT / "web/assets" / scan_path
            mid = uid()
            with repo.db() as db:
                db.execute(
                    "INSERT INTO p_media VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                    (
                        mid,
                        org,
                        coaches[ci],
                        sid,
                        None,
                        "scan",
                        "image/jpeg",
                        scanfile.name,
                        str(scanfile),
                        scanfile.stat().st_size,
                        now(),
                        encode(
                            {
                                "sample": True,
                                "provenance": "Public educational sample reused in fictional records; not this client’s radiograph. See asset credits.",
                                "attribution": attribution,
                                "source_url": source_url,
                            }
                        ),
                    ),
                )
            scan_region = region
            scan = repo.save(
                actor,
                "scans",
                {
                    "student_id": sid,
                    "analysis_id": aids[-1],
                    "region_id": scan_region,
                    "media_id": mid,
                    "name": "Educational " + scan_name + " reference",
                    "scan_type": "X-ray",
                    "captured_at": today.date().isoformat(),
                    "detail": {
                        "demo": True,
                        "provenance": "Reference image only; not a client acquisition or diagnostic result.",
                    },
                },
            )
            repo.annotate(
                actor,
                {
                    "scan_id": scan["id"],
                    "region_id": scan_region,
                    "x": 0.5,
                    "y": 0.5,
                    "text": "Educational region marker. Discuss relevant anatomy with the coach; no diagnostic interpretation.",
                },
            )
    except Exception:
        # A partially seeded tenant must never be offered as a complete demo.
        with repo.db() as db:
            db.execute("DELETE FROM p_organizations WHERE id=?", (org,))
        raise


def simulation(client, visit, kind):
    """Six transparent scenarios measured by the same geometry as real captures."""
    import numpy as np
    from ..assessment import assess_person, analyse_series, SIGNALS
    from ..types import Detection
    from ..studio import summarize, movement_summary

    scenario = scenario_for(client)
    trend = 1 - visit * 0.12
    base = np.array(
        [
            [500, 110],
            [512, 100],
            [488, 100],
            [528, 112],
            [472, 112],
            [560, 225],
            [440, 225],
            [581, 365],
            [419, 365],
            [591, 505],
            [409, 505],
            [540, 500],
            [460, 500],
            [545, 690],
            [455, 690],
            [550, 890],
            [450, 890],
        ],
        dtype=float,
    )
    camera = "side_left" if scenario in (1, 2) else "front"
    if camera == "side_left":
        base[:, 0] = 500
        base[[2, 4, 6, 8, 10, 12, 14, 16], 0] = 490
        base[:5, 0] += 25
        base[[7, 9], 0] += 12
    if scenario == 0:
        base[[6, 8, 10], 1] += 12 * trend
    elif scenario == 2:
        base[:5, 0] += 65 * trend
        base[5:11, 0] += 20 * trend
    elif scenario == 3:
        base[[12, 14], 1] += 15 * trend
    elif scenario == 4:
        base[:11, 0] += 20 * trend
    elif scenario == 5:
        base[:13, 0] += 8 * trend
    scores = np.full(17, 0.97)

    def pose(points):
        centre = points[[11, 12]].mean(axis=0)
        return {
            "status": "estimated",
            "joints": [
                [(x - centre[0]) / 450, (y - centre[1]) / 450, 0.03 * math.sin(i)]
                for i, (x, y) in enumerate(points)
            ],
            "scores": scores.tolist(),
            "reason": "Explicit parametric DEMO skeleton. Depth is simulated, not inferred from the generated image.",
            "unit": "m",
            "source": "demo simulation",
        }

    def assess(points, mode):
        person = assess_person(
            Detection(points, scores), 1000, 960, person_id="1", view=camera, mode=mode
        )
        person["pose3d"] = pose(points)
        return person

    person = assess(base, "standing")
    raw = {
        "width": 1000,
        "height": 960,
        "people": [person],
        "source": "Explicit demo coordinate simulation",
    }
    if kind == "movement":
        # Twenty-one observations retain the full 12-second trend and stay
        # within the 0.6-second derivative gap. The synthetic history is
        # labelled as such; real video keeps its independently sampled frames.
        times = [round(i * 0.6, 2) for i in range(21)]
        frames = []
        series = {key: [] for key in SIGNALS}
        for t in times:
            phase = (1 - math.cos(t * math.pi / 2)) / 2
            points = base.copy()
            if scenario in (0, 4):
                amplitude = (90 + visit * 7) if scenario == 0 else (65 + visit * 8)
                for shoulder, elbow, wrist, sign in [(5, 7, 9, 1), (6, 8, 10, -1)]:
                    angle = math.radians(
                        amplitude * phase * (1 if sign == 1 else 0.85 + visit * 0.025)
                    )
                    direction = np.array([math.sin(angle) * sign, math.cos(angle)])
                    points[elbow] = points[shoulder] + direction * 145
                    points[wrist] = points[elbow] + direction * 140
            elif scenario == 1:
                depth = (90 + visit * 7) * phase
                points[:11] += np.array([-depth * 0.45, depth])
                points[[11, 12]] += np.array([-depth * 0.6, depth])
                points[[13, 14]] += np.array([depth * 0.7, depth * 0.2])
            elif scenario == 2:
                angle = math.radians((30 + visit * 4) * phase)
                centre = points[[11, 12]].mean(axis=0)
                rotation = np.array(
                    [
                        [math.cos(angle), -math.sin(angle)],
                        [math.sin(angle), math.cos(angle)],
                    ]
                )
                points[:11] = (points[:11] - centre) @ rotation.T + centre
            elif scenario == 3:
                angle = math.radians((30 + visit * 4) * phase)
                points[13] = (
                    points[11] + np.array([math.sin(angle), math.cos(angle)]) * 190
                )
                points[15] = points[13] + np.array([-20, 200])
                points[15, 1] = min(points[15, 1], 890)
            else:
                sway = (13 - visit * 1.5) * math.sin(t * math.pi / 2)
                points[:13, 0] += sway
                points[13] = points[11] + np.array([55, 145])
                points[15] = points[13] + np.array([-35, 150])
            frame = assess(points, "pose")
            byid = {m["id"]: m.get("value") for m in frame["metrics"]}
            for key in SIGNALS:
                series[key].append(byid.get(key))
            frames.append(
                {
                    "time": t,
                    "landmarks": frame["landmarks"],
                    "pose3d": pose(points),
                    "suitable": frame["suitable"],
                    "uncertain_joints": [],
                }
            )
        person["frames"] = frames
        person["signals"] = {
            key: analyse_series(times, values) for key, values in series.items()
        }
        person["left_right_mean_angle_difference"] = {}
        for part in ("shoulder", "elbow", "hip", "knee"):
            pairs = [
                a - b
                for a, b in zip(series["left_" + part], series["right_" + part])
                if a is not None and b is not None
            ]
            person["left_right_mean_angle_difference"][part] = (
                round(float(np.mean(pairs)), 2) if pairs else None
            )
        centres = np.array(
            [
                np.mean(f["landmarks"]["keypoints"][11:13], axis=0)
                for f in frames
                if f["suitable"]
            ]
        )
        person["trajectory_deviation_body_fraction"] = (
            round(
                float(np.linalg.norm(np.std(centres, axis=0)) / 665),
                4,
            )
            if len(centres)
            else None
        )
        raw.update(duration=12, frames_sampled=len(frames))
    views = [{"view": camera, "report": raw}]
    return {
        "kind": kind,
        "views": views,
        "summary": (
            summarize(views) if kind == "posture" else movement_summary(raw, camera)
        ),
        "simulation_notice": "Synthetic scenario coordinates. Generated photographs are illustrative, not the source of these measurements.",
    }
