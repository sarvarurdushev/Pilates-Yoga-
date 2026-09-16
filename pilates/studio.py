"""Unified studio records and asynchronous assessment jobs.

Demo records are explicitly synthetic. Browser-specific workspace capabilities
isolate records in the login-free preview. Original media is not stored here.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import copy
import json
from pathlib import Path
import re
import sqlite3
import tempfile
import threading
import time
import uuid

from . import assessment

ROOT = Path(__file__).resolve().parent.parent
COLLECTIONS = ("clients", "reports", "notes", "programs", "bookings", "payments", "equipment")
VIEW_LABELS = {"front": "Front", "rear": "Back", "side_left": "Left side", "side_right": "Right side"}
SOURCES = {
    "spine": "https://www.orthoinfo.org/recovery/spine-conditioning-program/",
    "strength": "https://www.nhs.uk/live-well/exercise/how-to-improve-strength-flexibility/",
    "balance": "https://www.nhs.uk/live-well/exercise/balance-exercises/",
}


def workspace(value):
    if not re.fullmatch(r"(?:live|demo)-[a-f0-9]{32}", value or ""):
        raise ValueError("Open the studio first to create a workspace.")
    return value


def now():
    return datetime.now(timezone.utc).isoformat()


class Repository:
    def __init__(self, path):
        self.path = path or str(Path(tempfile.gettempdir()) / "motion-studio.db")
        with self.connect() as db:
            db.execute("CREATE TABLE IF NOT EXISTS studio_workspaces (id TEXT PRIMARY KEY, payload TEXT NOT NULL)")

    def connect(self):
        return sqlite3.connect(self.path, timeout=20)

    def _initial(self, key):
        if key.startswith("demo-"):
            data = json.loads((ROOT / "web/assets/studio/demo.json").read_text())
        else:
            data = {c: [] for c in COLLECTIONS}
            data.update({"demo": False, "studio": "My studio", "coach": "Studio coach"})
        return data

    def load(self, key):
        workspace(key)
        with self.connect() as db:
            row = db.execute("SELECT payload FROM studio_workspaces WHERE id=?", (key,)).fetchone()
            if row:
                return json.loads(row[0])
            data = self._initial(key)
            db.execute("INSERT OR IGNORE INTO studio_workspaces VALUES (?,?)", (key, json.dumps(data)))
            return data

    def save_item(self, key, collection, item, *, generated=False):
        workspace(key)
        if collection not in COLLECTIONS or (collection == "reports" and not generated):
            raise ValueError("Analysis reports are created by the analysis engine.")
        if not isinstance(item, dict):
            raise ValueError("A record is required.")
        item = copy.deepcopy(item)
        identifier = str(item.get("id") or uuid.uuid4().hex)
        if not re.fullmatch(r"[a-zA-Z0-9_-]{1,90}", identifier):
            raise ValueError("Invalid record identifier.")
        item.update({"id": identifier, "demo": key.startswith("demo-"), "updated_at": now()})
        encoded = json.dumps(item, allow_nan=False)
        if len(encoded) > (8_000_000 if generated else 100_000):
            raise ValueError("This record is too large.")
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT payload FROM studio_workspaces WHERE id=?", (key,)).fetchone()
            data = json.loads(row[0]) if row else self._initial(key)
            entries = data.setdefault(collection, [])
            previous = next((i for i, v in enumerate(entries) if v["id"] == identifier), None)
            if previous is None:
                entries.insert(0, item)
            else:
                entries[previous] = item
            db.execute("INSERT OR REPLACE INTO studio_workspaces VALUES (?,?)", (key, json.dumps(data, allow_nan=False)))
        return item


def summarize(views):
    """Regional evidence, never a diagnosis or muscle-activation inference."""
    metrics, findings, scores = [], [], []
    for v in views:
        people = v["report"].get("people", [])
        good = [p for p in people if p.get("suitable")]
        if len(good) != 1:
            findings.append({"region": VIEW_LABELS.get(v["view"], v["view"]), "level": "capture", "text": "Choose one clearly visible person and retake this view." if len(good) > 1 else "This view needs a clearer full-body capture.", "source": "Capture validation"})
            continue
        p = good[0]
        if p.get("score", {}).get("value") is not None:
            scores.append(p["score"]["value"])
        for m in p.get("metrics", []):
            entry = {**m, "view": v["view"]}
            metrics.append(entry)
            if m["value"] is not None and m["unit"] == "deg":
                findings.append({"region": m["region"], "level": "observe", "text": f"{m['name']}: {m['value']:.1f}° in the {VIEW_LABELS.get(v['view'], v['view']).lower()} image. Recheck with the same camera position before interpreting change.", "source": "Projected image measurement"})
    recommendations = [{"id": "capture", "title": "Make the next comparison repeatable", "reason": "Use the same camera height, distance, view and relaxed stance. A changed camera angle can change a measured angle.", "exercise_ids": [], "source": "Capture protocol"}]
    regions = {m.get("region") for m in metrics if m.get("value") is not None}
    if regions:
        recommendations.append({"id": "foundation", "title": "Build a balanced practice with your coach", "reason": "Include strength, mobility and balance work. Choose a comfortable range and progress according to ability; a photograph does not establish which muscles are weak or tight.", "exercise_ids": ["bird-dog", "bridge", "balance"], "source": SOURCES["strength"]})
    if "Shoulders" in regions or "Head" in regions:
        recommendations.append({"id": "mobility", "title": "Review shoulder and upper-body movement", "reason": "Record a controlled arm raise from the front and side. Let your coach review the movement before choosing mobility exercises.", "exercise_ids": ["wall-slide"], "source": SOURCES["strength"]})
    return {"score": round(sum(scores) / len(scores), 1) if scores else None, "score_label": "Image alignment index", "metrics": metrics, "findings": findings[:12], "recommendations": recommendations, "coverage": len(views), "complete_views": sum(len([p for p in v["report"].get("people", []) if p.get("suitable")]) == 1 for v in views), "unavailable": ["Muscle strength or activation from a photo", "Spinal curvature / Cobb angle", "True sagittal pelvic tilt without anatomical markers", "Body fat or muscle mass without a measuring device", "Diagnosis from a radiograph"]}


def movement_summary(result, view):
    valid = [p for p in result.get("people", []) if p.get("suitable")]
    metrics, findings = [], []
    for p in valid:
        for name, signal in p.get("signals", {}).items():
            if signal.get("rom") is None:
                continue
            label = name.replace("_", " ").capitalize()
            metrics.append({"id": name + "_rom", "name": label + " projected ROM", "value": signal["rom"], "unit": "deg", "confidence": signal.get("confidence"), "status": signal.get("status", "estimated"), "region": "Movement", "view": view, "person_id": p["person_id"], "source": "Tracked image-plane angle", "reason": signal.get("reason", "")})
            findings.append({"region": label, "level": "observe", "text": f"Person {p['person_id']}: {signal['rom']:.1f}° projected range, {signal.get('repetitions', 0)} complete cycles. Review the trace and video together; camera depth can change the visible range.", "source": "Tracked movement evidence"})
    if not valid:
        findings.append({"region": "Capture", "level": "capture", "text": "No track has enough continuous full-body evidence. Keep the body visible throughout a short, steady clip and try again.", "source": "Tracking and visibility validation"})
    return {"score": None, "score_label": "Movement evidence", "metrics": metrics, "findings": findings[:12], "recommendations": [{"id": "repeat", "title": "Repeat the same movement and camera setup", "reason": "Compare like-for-like clips: same movement, view, speed instructions and camera position. Review comfortable range and control with your coach before changing the practice plan.", "exercise_ids": [], "source": "Capture protocol"}], "coverage": 1, "complete_views": int(bool(valid)), "unavailable": ["Clinical diagnosis or pain", "True 3D joint range from this video", "Muscle strength or activation", "A validated exercise-quality score"]}


class AnalysisJobs:
    def __init__(self, repository):
        self.repository = repository
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="studio-analysis")
        self.items = {}
        self.lock = threading.Lock()

    def _new(self, key, kind):
        with self.lock:
            active = sum(j["state"] in ("queued", "running") for j in self.items.values())
            if active >= 2:
                raise ValueError("The analysis server is busy. Please retry after the current assessment finishes.")
            if len(self.items) > 30:
                for k in list(self.items):
                    if self.items[k]["state"] in ("done", "failed"):
                        del self.items[k]
                        if len(self.items) <= 20:
                            break
            job = {"id": uuid.uuid4().hex, "workspace": key, "kind": kind, "state": "queued", "progress": "Waiting for the analysis engine", "started": time.time(), "finished": None, "result": None, "error": ""}
            self.items[job["id"]] = job
            return job

    def get(self, key, identifier):
        with self.lock:
            job = self.items.get(identifier)
            if not job or job["workspace"] != key:
                return None
            out = {k: v for k, v in job.items() if k not in ("workspace", "started", "finished")}
            out["seconds"] = round((job["finished"] or time.time()) - job["started"], 1)
            return out

    def submit_photo(self, key, payload):
        photos = payload.get("photos", [])
        if not isinstance(photos, list) or not 1 <= len(photos) <= 4:
            raise ValueError("Add between one and four views to begin.")
        views = [p.get("view") for p in photos if isinstance(p, dict)]
        if len(views) != len(photos) or len(set(views)) != len(views) or any(v not in VIEW_LABELS for v in views):
            raise ValueError("Each photograph needs its own front, back, left or right view.")
        job = self._new(key, "posture")
        self.executor.submit(self._run, job, payload, None)
        return self.get(key, job["id"])

    def submit_video(self, key, payload, stream, length):
        if payload.get("view") not in VIEW_LABELS:
            raise ValueError("Choose the camera view for this movement.")
        job = self._new(key, "movement")
        suffix = ".webm" if str(payload.get("filename", "")).lower().endswith(".webm") else ".mp4"
        handle = tempfile.NamedTemporaryFile(prefix="studio-video-", suffix=suffix, delete=False)
        path = Path(handle.name)
        try:
            with handle:
                remaining = length
                while remaining:
                    chunk = stream.read(min(65536, remaining))
                    if not chunk:
                        raise ValueError("The upload was interrupted. Select the video and retry.")
                    handle.write(chunk)
                    remaining -= len(chunk)
            self.executor.submit(self._run, job, payload, path)
        except Exception:
            path.unlink(missing_ok=True)
            job.update(state="failed", error="Upload interrupted", finished=time.time())
            raise
        return self.get(key, job["id"])

    def _run(self, job, payload, path):
        job["state"] = "running"
        try:
            key = job["workspace"]
            client = payload.get("client", {})
            supplied_goal = client.get("goal")
            client = {"id": str(client.get("id") or uuid.uuid4().hex), "name": str(client.get("name") or "New client")[:80], "goal": str(client.get("goal") or "Build a consistent practice")[:200]}
            old = next((c for c in self.repository.load(key)["clients"] if c["id"] == client["id"]), {})
            client = self.repository.save_item(key, "clients", {**old, **client, "goal": supplied_goal or old.get("goal") or client["goal"], "joined": old.get("joined", now()[:10])})
            if path is None:
                views = []
                for photo in payload["photos"]:
                    job["progress"] = f"{VIEW_LABELS[photo['view']]} view · finding the full body and checking landmarks"
                    result = assessment.photo({"image": photo["image"], "view": photo["view"], "mode": payload.get("mode", "standing"), "include_3d": bool(payload.get("include_3d", True)), "tiled": bool(payload.get("class_scan", False))})
                    views.append({"view": photo["view"], "report": result})
                    photo.pop("image", None)
                report = {"kind": "posture", "views": views, "summary": summarize(views)}
            else:
                job["progress"] = "Loading the movement engine · your upload is complete"
                result = assessment.video(path, view=payload["view"], protocol=payload.get("protocol", ""), progress=lambda message: job.update(progress=message))
                report = {"kind": "movement", "views": [{"view": payload["view"], "report": result}], "summary": movement_summary(result, payload["view"])}
            report.update({"id": uuid.uuid4().hex, "client_id": client["id"], "client_name": client["name"], "created_at": now(), "demo": key.startswith("demo-"), "provenance": "Synthetic demo" if key.startswith("demo-") else "Server-computed image evidence", "version": "3.0-studio", "notes": str(payload.get("notes", ""))[:2000]})
            saved = self.repository.save_item(key, "reports", report, generated=True)
            job.update(state="done", progress="Your report is ready", result=saved)
        except Exception as exc:
            job.update(state="failed", error=str(exc) or "The analysis could not finish. Please retry with a shorter clip or a smaller photograph.")
        finally:
            job["finished"] = time.time()
            if path:
                path.unlink(missing_ok=True)
            payload.clear()
