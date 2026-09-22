"""Explicit educational mappings to the shipped atlas, never inferred activation."""

import json
from pathlib import Path

LANDMARKS = [
    "Head / nose",
    "Left eye",
    "Right eye",
    "Left ear",
    "Right ear",
    "Left shoulder",
    "Right shoulder",
    "Left elbow",
    "Right elbow",
    "Left wrist",
    "Right wrist",
    "Left hip",
    "Right hip",
    "Left knee",
    "Right knee",
    "Left ankle",
    "Right ankle",
    "Neck base proxy",
    "Pelvis centre",
    "Trunk / spine proxy",
]
BASE = {
    "head": (
        "Head and neck",
        "Head orientation and the shoulder-centre relationship. A photo does not show vertebral alignment.",
        ["atlas", "axis", "fifth cervical vertebra"],
        [0, 1, 2, 3, 4, 17],
    ),
    "thorax": (
        "Thoracic region",
        "The trunk and rib cage help explain breathing and upper-body movement. Visible trunk angles are not spinal curvature.",
        ["first thoracic vertebra", "eighth thoracic vertebra", "diaphragm"],
        [17, 19],
    ),
    "lumbar": (
        "Lumbar region",
        "The pelvis and trunk move together during practice. Surface landmarks cannot establish a lumbar curve.",
        ["first lumbar vertebra", "fifth lumbar vertebra", "multifidus"],
        [18, 19],
    ),
    "pelvis": (
        "Pelvic region",
        "Hip-centre landmarks describe projected alignment; they do not measure true sagittal pelvic tilt.",
        ["sacrum", "hip bone"],
        [11, 12, 18],
    ),
}
PAIRED = {
    "shoulder": (
        "Shoulder / scapular region",
        [
            "scapula",
            "humerus",
            "clavicle",
            "deltoid",
            "levator scapulae",
            "subscapularis",
        ],
        [5, 6],
    ),
    "elbow": (
        "Elbow region",
        ["humerus", "ulna", "radius", "biceps brachii", "triceps brachii"],
        [7, 8],
    ),
    "wrist": ("Wrist region", ["radius", "ulna", "scaphoid"], [9, 10]),
    "hip": (
        "Hip region",
        ["hip bone", "femur", "gluteus medius", "gluteus maximus"],
        [11, 12],
    ),
    "knee": (
        "Knee region",
        ["femur", "tibia", "patella", "rectus femoris", "vastus medialis"],
        [13, 14],
    ),
    "ankle": ("Ankle region", ["tibia", "talus", "calcaneus"], [15, 16]),
}


def seed_regions(repo):
    path = Path(__file__).resolve().parents[2] / "web/src/generated/structures.json"
    structures = json.loads(path.read_text())["structures"]
    by_name = {s["name"].lower(): s for s in structures}
    specs = []
    for key, (name, text, names, joints) in BASE.items():
        specs.append((key, name, "midline", text, names, joints))
    for key, (name, names, joints) in PAIRED.items():
        for side, index in [("left", 0), ("right", 1)]:
            chosen = [f"{side} {n}" if f"{side} {n}" in by_name else n for n in names]
            specs.append(
                (
                    f"{side}_{key}",
                    side.title() + " " + name,
                    side,
                    "Relevant structures for explaining the observed "
                    + side
                    + " "
                    + key
                    + " movement. Highlighting does not establish muscle weakness or disease.",
                    chosen,
                    [joints[index]],
                )
            )
    for key, (name, names, joints) in PAIRED.items():
        selected = []
        for side in ("left", "right"):
            selected.extend(
                f"{side} {n}" if f"{side} {n}" in by_name else n for n in names
            )
        specs.append(
            (
                f"both_{key}",
                "Both " + name.lower(),
                "bilateral",
                "Comparison of both anatomical sides; no side is inferred from the sign alone.",
                list(dict.fromkeys(selected)),
                [],
            )
        )
    with repo.db() as db:
        for key, name, side, text, names, joints in specs:
            mapped = [
                {
                    "id": by_name[n]["id"],
                    "name": by_name[n]["name"],
                    "layer": by_name[n]["layer"],
                    "fma": by_name[n]["fma"],
                }
                for n in names
                if n in by_name
            ]
            if not mapped:
                raise ValueError("No atlas structures for " + key)
            db.execute(
                "INSERT INTO p_regions VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,side=excluded.side,explanation=excluded.explanation,structures=excluded.structures,landmark_ids=excluded.landmark_ids",
                (key, name, side, text, json.dumps(mapped), json.dumps(joints)),
            )
        for i, name in enumerate(LANDMARKS):
            region = next((s[0] for s in specs if i in s[5]), "thorax")
            method = (
                "Detected COCO landmark"
                if i < 17
                else (
                    "Midpoint of shoulders (not a vertebra)"
                    if i == 17
                    else (
                        "Midpoint of hips"
                        if i == 18
                        else "Midpoint of shoulder and hip centres (not a vertebra)"
                    )
                )
            )
            db.execute(
                "INSERT INTO p_landmarks VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,region_id=excluded.region_id,method=excluded.method",
                (str(i), name, region, method),
            )


def region_for(name):
    name = name.lower()
    side = "left" if "left" in name else "right" if "right" in name else None
    if (
        "pelvi" in name
        or "hip height" in name
        or "center of mass" in name
        or "centre of mass" in name
    ):
        return "pelvis"
    if "foot" in name:
        return (side or "both") + "_ankle"
    for part in PAIRED:
        if part in name:
            return (side or "both") + "_" + part
    if "head" in name or "neck" in name or "ear" in name:
        return "head"
    if "lumbar" in name:
        return "lumbar"
    return "thorax"
