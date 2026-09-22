"""Bounded persistent job records, streaming media, one shared inference worker."""

from concurrent.futures import ThreadPoolExecutor
import base64
import gc
import json
import threading
from .repository import Refused, uid, now, encode
from .media import media_path
from .analysis import save_analysis


class Jobs:
    def __init__(self, repo):
        self.repo = repo
        self.executor = ThreadPoolExecutor(
            max_workers=1, thread_name_prefix="platform-analysis"
        )
        self.lock = threading.Lock()
        self.active = 0
        with repo.db() as db:
            db.execute(
                "UPDATE p_jobs SET state='failed',error='The server restarted during analysis. Your uploaded media is retained when storage persists; retry the session.',finished_at=? WHERE state IN ('queued','running')",
                (now(),),
            )

    def submit(self, actor, payload):
        student = payload.get("student_id")
        self.repo.assert_student(actor, student, True)
        if payload.get("kind") not in ("posture", "movement"):
            raise Refused("Select photo or movement analysis.")
        captures = payload.get("captures", [])
        if not captures or len(captures) > 4:
            raise Refused("Upload one to four captures.")
        if payload["kind"] == "movement" and len(captures) != 1:
            raise Refused("Analyze one movement clip per session.")
        views = [c.get("view") for c in captures]
        if len(set(views)) != len(views) or any(
            v not in ("front", "rear", "side_left", "side_right") for v in views
        ):
            raise Refused("Choose a distinct camera view for every capture.")
        for c in captures:
            media = self.repo.get(actor, "media", c.get("media_id"))
            if media.get("student_id") != student:
                raise Refused("The capture belongs to a different client.")
            expected = "video/" if payload["kind"] == "movement" else "image/"
            if not media["mime"].startswith(expected):
                raise Refused("The uploaded file does not match the capture type.")
        target = payload.get("target_angle")
        if target is not None and not 0 <= float(target) <= 180:
            raise Refused("The optional coach target must be between 0° and 180°.")
        identifier = uid()
        with self.lock:
            if self.active >= 3:
                raise Refused(
                    "The analysis queue is full. Keep your captures and retry after a current session finishes.",
                    429,
                )
            with self.repo.db() as db:
                db.execute(
                    "INSERT INTO p_jobs VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                    (
                        identifier,
                        actor.org_id,
                        student,
                        actor.user_id,
                        None,
                        "queued",
                        "Waiting for the analysis engine",
                        "",
                        now(),
                        None,
                        encode(payload),
                    ),
                )
            self.active += 1
            try:
                self.executor.submit(self.run, actor, identifier, payload)
            except Exception:
                self.active -= 1
                raise
        return self.repo.get(actor, "jobs", identifier)

    def update(self, identifier, **fields):
        with self.repo.db() as db:
            db.execute(
                "UPDATE p_jobs SET "
                + ",".join(k + "=?" for k in fields)
                + " WHERE id=?",
                [*fields.values(), identifier],
            )

    def run(self, actor, identifier, payload):
        from .. import assessment, api, pose3d
        from ..studio import summarize, movement_summary

        try:
            self.update(
                identifier, state="running", progress="Preparing the analysis models"
            )
            # Startup remains responsive; weights are prepared only when needed.
            from ..deployment import prepare_render

            prepare_render()
            views = []
            media_ids = {}
            for index, c in enumerate(payload["captures"]):
                path, mime, _ = media_path(self.repo, actor, c["media_id"])
                media_ids[c["view"]] = c["media_id"]
                self.update(
                    identifier,
                    progress=f'Processing {index+1}/{len(payload["captures"])} · {c["view"].replace("_"," ")}',
                )
                if payload["kind"] == "posture":
                    # Files are already size-bounded; no 4-image JSON request in RAM.
                    raw = assessment.photo(
                        {
                            "image": base64.b64encode(path.read_bytes()).decode(),
                            "view": c["view"],
                            "mode": payload.get("mode", "standing"),
                            "include_3d": payload.get("include_3d", True),
                            "tiled": payload.get("class_scan", False),
                        }
                    )
                    supplement_photo(raw)
                else:
                    raw = assessment.video(
                        path,
                        view=c["view"],
                        protocol=payload.get("protocol", ""),
                        include_3d=payload.get("include_3d", True),
                        progress=lambda text: self.update(identifier, progress=text),
                    )
                views.append(
                    {"view": c["view"], "media_id": c["media_id"], "report": raw}
                )
            self.repo.assert_student(actor, payload["student_id"], True)
            report = {
                "kind": payload["kind"],
                "views": views,
                "summary": (
                    summarize(views)
                    if payload["kind"] == "posture"
                    else movement_summary(views[0]["report"], views[0]["view"])
                ),
            }
            aid = save_analysis(
                self.repo,
                actor,
                payload["student_id"],
                report,
                media_ids,
                payload.get("protocol", "standing"),
                payload.get("location_id") or None,
                detail={
                    "target_angle": payload.get("target_angle"),
                    "capture_in_demo_workspace": actor.demo,
                },
            )
            self.update(
                identifier,
                state="done",
                progress="Analysis saved to the selected client",
                analysis_id=aid,
                finished_at=now(),
            )
        except Exception as exc:
            message = (
                str(exc)
                or "Analysis could not finish. Retry with a shorter clip and a clear full-body view."
            )
            self.update(
                identifier,
                state="failed",
                error=message[:1000],
                progress="Analysis needs attention",
                finished_at=now(),
            )
        finally:
            # Releasing both model sessions prevents inference memory becoming
            # permanent idle memory on the 512 MB deployment.
            with assessment._ANALYSIS_LOCK:
                api._BACKEND = None
                pose3d.close()
                gc.collect()
            try:
                import ctypes

                ctypes.CDLL(None).malloc_trim(0)
            except (AttributeError, OSError):
                pass
            with self.lock:
                self.active -= 1


def supplement_photo(raw):
    """Additional visible joint angles, without replacing validated posture values."""
    from .. import assessment
    from ..types import Detection
    import numpy as np

    unsupported = {
        "head_rotation": (
            "Head rotation",
            "head",
            "Axial rotation cannot be resolved reliably from this single camera.",
        ),
        "neck_angle": (
            "Cervical / neck angle",
            "head",
            "An anatomical cervical angle requires identified anatomical markers.",
        ),
        "thoracic_curve": (
            "Thoracic spinal curvature",
            "thorax",
            "Surface keypoints do not identify vertebral curvature.",
        ),
        "pelvic_rotation": (
            "Pelvic axial rotation",
            "pelvis",
            "Requires calibrated depth and pelvic anatomical markers.",
        ),
        "ankle_angle": (
            "Ankle joint angle",
            "right_ankle",
            "The shared COCO skeleton does not include heel and toe landmarks.",
        ),
        "centre_of_mass": (
            "Whole-body centre of mass",
            "pelvis",
            "No calibrated mass-distribution model is available. Hip-centre trajectory is a separate proxy.",
        ),
    }
    for person in raw.get("people", []):
        if person.get("suitable"):
            det = Detection(
                np.array(person["landmarks"]["keypoints"], dtype=np.float32),
                np.array(person["landmarks"]["scores"], dtype=np.float32),
            )
            joints = assessment.assess_person(
                det,
                raw["width"],
                raw["height"],
                person_id=person["person_id"],
                view=person["view"],
                mode="pose",
            )
            present = {m["id"] for m in person["metrics"]}
            person["metrics"] += [
                m for m in joints["metrics"] if m["id"] not in present
            ]
        for key, (name, region, reason) in unsupported.items():
            person["metrics"].append(
                {
                    "id": key,
                    "name": name,
                    "region": region,
                    "value": None,
                    "unit": "deg" if key != "centre_of_mass" else "m",
                    "confidence": None,
                    "status": "unavailable",
                    "reason": reason,
                    "views": [],
                    "joints": [],
                }
            )
