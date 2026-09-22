"""Reproducible, precomputed *synthetic* scenarios for low-CPU demo startup.

Run ``python -m pilates.platform.demo_scenarios --build`` after changing geometry.
Real captures never use these files; every coordinate is still stored under the
new client's own analysis/frame IDs. Only the explicitly simulated mathematics
is precomputed, avoiding thousands of repeated calculations at sign-in.
"""

from functools import lru_cache
from pathlib import Path
import gzip
import hashlib
import json

ROOT = Path(__file__).parent


@lru_cache(maxsize=1)
def source_digest():
    digest = hashlib.sha256()
    for path in [
        ROOT / "seed.py",
        ROOT / "kinematics.py",
        *[
            ROOT.parent / (name + ".py")
            for name in ("assessment", "geometry", "studio", "validation")
        ],
    ]:
        digest.update(path.read_bytes())
    return digest.hexdigest()


def calculate(client, visit):
    from .seed import simulation, scenario_for
    from .kinematics import coordinates, temporal

    kind = "movement" if visit % 2 else "posture"
    report = simulation(client, visit, kind)
    target = 140 if scenario_for(client) in (0, 4) and visit % 2 else None
    frames_by_view = {}
    for view in report["views"]:
        people = {}
        for person in view["report"]["people"]:
            frames = person["frames"] if kind == "movement" else [person]
            people[str(person["person_id"])] = [
                coordinates(
                    frame["landmarks"],
                    frame.get("pose3d"),
                    frame.get("suitable"),
                    frame.get("uncertain_joints", ()),
                )
                for frame in frames
            ]
        frames_by_view[view["view"]] = people
    return {
        "source_digest": source_digest(),
        "report": report,
        "coordinates": frames_by_view,
        "kinematics": (
            temporal(report["views"][0]["report"]["people"], target)
            if kind == "movement"
            else {}
        ),
    }


@lru_cache(maxsize=36)
def compressed(scenario, visit):
    path = ROOT / "demo_scenarios" / f"{scenario}-{visit}.json.gz"
    return path.read_bytes() if path.exists() else None


def prepared_scenario(client, visit):
    from .seed import scenario_for

    data = compressed(scenario_for(client), visit)
    if data:
        value = json.loads(gzip.decompress(data))
        if value.get("source_digest") == source_digest():
            return value
    return calculate(client, visit)


def build():
    from .seed import scenario_for

    folder = ROOT / "demo_scenarios"
    folder.mkdir(exist_ok=True)
    for scenario in range(6):
        client = next(i for i in range(34) if scenario_for(i) == scenario)
        for visit in range(6):
            data = json.dumps(
                calculate(client, visit), allow_nan=False, separators=(",", ":")
            ).encode()
            (folder / f"{scenario}-{visit}.json.gz").write_bytes(
                gzip.compress(data, compresslevel=9, mtime=0)
            )
    print("Built 36 reproducible demo scenarios.")


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--build", required=True, action="store_true")
    parser.parse_args()
    build()
