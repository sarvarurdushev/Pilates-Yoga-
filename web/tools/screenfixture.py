"""Build a realistic movement-screening payload, so the screen can be looked at.

Same purpose as ``reportfixture.py`` and for the same reason: a payload typed
by hand drifts from the real one the first time a field is added, so this makes
one the way the server does -- by measuring synthetic clips of a body moving
through known angles.

    python3 web/tools/screenfixture.py OUT.json
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))

from pilates import screening as sc  # noqa: E402
from pilates.alignment import View  # noqa: E402
from test_screening import body, clip  # noqa: E402

#: What each screen reached, per side, in this fixture. Chosen so the drawing
#: has something to show: a shoulder well short, a knee near the reference, and
#: one clear left-right difference.
REACHED = {
    "shoulder_flexion": (128.0, 164.0),
    "shoulder_abduction": (140.0, 148.0),
    "hip_flexion": (96.0, 104.0),
    "knee_flexion": (124.0, 128.0),
    "squat_depth": (72.0, 74.0),
}


def moving(peak: float, joint: str, side: str, reps: int = 3,
           per_rep: int = 40):
    frames = []
    for i in range(reps * per_rep + 1):
        phase = (1.0 - math.cos(2 * math.pi * i / per_rep)) / 2.0
        frames.append(body(**{f"{side}_{joint}": peak * phase}))
    return clip(frames)


def build() -> dict:
    clips, views = {}, {}
    for key, (left, right) in REACHED.items():
        screen = sc.SCREENS[key]
        joint = screen.signal.split("_", 1)[1]
        clips[key] = {"left": moving(left, joint, "left"),
                      "right": moving(right, joint, "right")}
        views[key] = screen.views[0]
    assessment = sc.screen_all(clips, views=views, person_id="demo",
                               taken_on="2026-09-14")
    out = assessment.to_dict()
    out["catalogue_detail"] = [
        {"key": s.key, "name": s.name, "name_ko": s.name_ko,
         "instruction": s.instruction, "instruction_ko": s.instruction_ko,
         "sided": s.sided, "kind": s.kind, "unit": s.unit,
         "reference": list(s.reference), "reference_kind": s.reference_kind,
         "reference_source": s.reference_source,
         "views": [v.value for v in s.views], "works": list(s.works)}
        for s in sc.SCREENS.values()]
    out["disclaimer"] = sc.DISCLAIMER
    out["disclaimer_ko"] = sc.DISCLAIMER_KO
    out["screening_id"] = 3
    return out


if __name__ == "__main__":
    target = Path(sys.argv[1] if len(sys.argv) > 1 else "screening.json")
    target.write_text(json.dumps(build()))
    print(f"wrote {target}")
