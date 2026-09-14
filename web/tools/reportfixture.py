"""Build a realistic report payload, so the screen can be looked at.

The posture report is assembled from four photographs, a measurement layer and
a guidance layer, none of which a browser has. Rendering it therefore needs a
payload, and a payload typed by hand is a payload that drifts from the real one
the first time a field is added -- so this makes one the same way the server
does, from synthetic bodies with known deviations.

    python3 web/tools/reportfixture.py OUT.json

Used by `web/tools/renderreport.mjs`, which turns it into a page.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))

from pilates import guidance as gd  # noqa: E402
from pilates import intake as ik  # noqa: E402
from pilates.alignment import View  # noqa: E402
from test_alignment import side_on, standing  # noqa: E402

#: A frame cropped to the body, the way a studio frames a standing photograph.
WIDTH, HEIGHT = 760, 760


def build() -> dict:
    def shot(view, detection):
        return ik.Photo(view, detection, WIDTH, HEIGHT)

    photos = [
        shot(View.FRONT, standing(shoulder_tilt=7.5, hip_tilt=4.5, cx=380)),
        shot(View.SIDE_LEFT, side_on(facing_image_left=False, ear_ahead=52.0, cx=380)),
        shot(View.SIDE_RIGHT, side_on(facing_image_left=True, ear_ahead=48.0, cx=380)),
        shot(View.REAR, standing(facing="rear", shoulder_tilt=6.8, hip_tilt=4.0, cx=380)),
    ]
    assessment = ik.assess_photos(photos, person_id="demo", taken_on="2026-09-14")
    report = gd.report(assessment)
    report["landmarks"] = {
        p.view.value: {"keypoints": p.detection.keypoints.round(2).tolist(),
                       "scores": p.detection.scores.round(3).tolist(),
                       "width": p.width, "height": p.height}
        for p in photos if p.usable}
    report["protocol"] = [
        {"view": v.value,
         "title": ik.instructions(v)[0], "how": ik.instructions(v)[1],
         "title_ko": ik.instructions(v, "ko")[0],
         "how_ko": ik.instructions(v, "ko")[1]}
        for v in ik.PROTOCOL]
    report["assessment_id"] = 7
    # Reopened from the record, which is the harder of the two states to draw:
    # landmarks and no photograph.
    report["from_file"] = True
    return report


if __name__ == "__main__":
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "report.json")
    out.write_text(json.dumps(build()))
    print(f"wrote {out}")
