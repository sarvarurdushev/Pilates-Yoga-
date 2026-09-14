"""Sweep the Hugging Face Hub for pose, posture and exercise models and datasets.

Kept so the survey in ``docs/pose-model-survey.md`` can be re-run rather than
believed. Writes one JSON row per unique entry with its downloads, likes,
licence tag and pipeline -- enough to sort the field, and enough to spot the
entries carrying no licence at all, which are the ones that matter most and
rank lowest.

Usage::

    python3 tools/hfsurvey.py survey.json
"""
import json, urllib.request, urllib.parse, sys, time

def get(path, **params):
    url = "https://huggingface.co/api/" + path + "?" + urllib.parse.urlencode(params)
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url, timeout=45) as r:
                return json.loads(r.read())
        except Exception as e:
            if attempt == 2:
                print(f"  !! {path} {params} -> {e}", file=sys.stderr)
                return []
            time.sleep(2 * (attempt + 1))

MODEL_QUERIES = [
    "rtmo", "rtmpose", "vitpose", "yolo pose", "yolov8 pose", "pose estimation",
    "3d human pose", "human pose", "keypoint detection", "body landmark",
    "mediapipe pose", "blazepose", "sapiens", "motionbert", "posture",
    "yoga pose", "exercise recognition", "action recognition", "fitness",
    "movement quality", "hrnet pose", "openpose", "dwpose", "smpl", "hmr",
]
DATASET_QUERIES = [
    "human pose", "pose estimation", "keypoints", "coco keypoints", "mpii",
    "yoga", "pilates", "exercise", "fitness", "workout", "posture",
    "action recognition", "3d pose", "human3.6m", "movement", "gym",
]

def rows(items, kind):
    out = []
    for m in items or []:
        tags = m.get("tags", []) or []
        lic = next((t.split(":", 1)[1] for t in tags if t.startswith("license:")), "")
        out.append({
            "id": m.get("id"),
            "downloads": m.get("downloads", 0),
            "likes": m.get("likes", 0),
            "license": lic,
            "pipeline": m.get("pipeline_tag", "") or "",
            "library": m.get("library_name", "") or "",
            "kind": kind,
        })
    return out

seen, all_rows = set(), []
for q in MODEL_QUERIES:
    for r in rows(get("models", search=q, limit=25, sort="downloads", direction=-1), "model"):
        if r["id"] not in seen:
            seen.add(r["id"]); r["query"] = q; all_rows.append(r)
for q in DATASET_QUERIES:
    for r in rows(get("datasets", search=q, limit=25, sort="downloads", direction=-1), "dataset"):
        if r["id"] not in seen:
            seen.add(r["id"]); r["query"] = q; all_rows.append(r)

json.dump(all_rows, open(sys.argv[1], "w"), indent=1)
print(f"{len(all_rows)} unique entries "
      f"({sum(1 for r in all_rows if r['kind']=='model')} models, "
      f"{sum(1 for r in all_rows if r['kind']=='dataset')} datasets)")
