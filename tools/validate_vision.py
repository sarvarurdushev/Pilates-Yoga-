"""Run real inference on a declared corpus and retain inspectable overlays.

No ground truth annotation = no accuracy claim. Negative cases may declare
expected=refuse. Capacity composites must remain labelled as composites.
"""

import argparse, base64, json, time
from pathlib import Path
import cv2
from pilates.assessment import photo
from pilates.pose import RTMOBackend
from pilates.pose3d import BONES

p = argparse.ArgumentParser()
p.add_argument("corpus", type=Path)
p.add_argument("--out", type=Path, required=True)
a = p.parse_args()
a.out.mkdir(parents=True, exist_ok=True)
model = RTMOBackend()
cases = json.loads((a.corpus / "cases.json").read_text())
out = []
for i, case in enumerate(cases):
    start = time.perf_counter()
    path = a.corpus / case["file"]
    report = photo(
        {
            "image": base64.b64encode(path.read_bytes()).decode(),
            "mode": case.get("mode", "standing"),
            "view": case.get("view", "auto"),
            "tiled": case.get("tiled", False),
        },
        backend=model,
    )
    seconds = time.perf_counter() - start
    violation = case.get("expected") == "refuse" and any(
        p["suitable"] or p["score"]["value"] is not None for p in report["people"]
    )
    frame = cv2.imread(str(path))
    h, w = frame.shape[:2]
    for person in report["people"]:
        pts = person["landmarks"]["keypoints"]
        scores = person["landmarks"]["scores"]
        color = (90, 170, 40) if person["suitable"] else (40, 90, 215)
        for x, y in BONES:
            if scores[x] >= 0.5 and scores[y] >= 0.5:
                cv2.line(
                    frame,
                    tuple(map(int, pts[x])),
                    tuple(map(int, pts[y])),
                    color,
                    max(1, w // 500),
                )
        for j, (x, y) in enumerate(pts):
            if scores[j] >= 0.5:
                cv2.circle(frame, (int(x), int(y)), max(2, w // 250), color, -1)
        visible = [xy for xy, s in zip(pts, scores) if s >= 0.5]
        if visible:
            cv2.putText(
                frame,
                f"P{person['person_id']} {'REVIEW' if not person['suitable'] else 'VALID'}",
                (
                    max(0, int(min(p[0] for p in visible))),
                    max(18, int(min(p[1] for p in visible)) - 10),
                ),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.55,
                color,
                2,
            )
    name = f"{i:02d}-{path.stem}.jpg"
    cv2.imwrite(str(a.out / name), frame)
    row = {
        "case": case,
        "seconds": round(seconds, 3),
        "people": len(report["people"]),
        "accepted": sum(p["suitable"] for p in report["people"]),
        "false_accept": violation,
        "overlay": name,
        "report": report,
    }
    out.append(row)
    print(
        case["case"],
        f"people={row['people']} accepted={row['accepted']} false_accept={violation} {seconds:.2f}s",
        flush=True,
    )
    (a.out / "results.json").write_text(json.dumps(out, indent=2, allow_nan=False))
