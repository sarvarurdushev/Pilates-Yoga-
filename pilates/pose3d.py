"""Optional learned 3D skeleton with independent image-space corroboration.

MediaPipe world landmarks use model-estimated metres about the hip centre.
They are never derived by assigning depth to RTMO's pixel coordinates and are
never used as calibrated distances or as input to the 2D alignment score.
"""

import os
import threading
from pathlib import Path
import numpy as np
from .validation import CORE

COCO_FROM_MP = (0, 2, 5, 7, 8, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28)
BONES = (
    (5, 6),
    (5, 11),
    (6, 12),
    (11, 12),
    (5, 7),
    (7, 9),
    (6, 8),
    (8, 10),
    (11, 13),
    (13, 15),
    (12, 14),
    (14, 16),
    (0, 1),
    (0, 2),
    (1, 3),
    (2, 4),
)


def unavailable(reason):
    return {
        "status": "unavailable",
        "representation": "2d",
        "reason": reason,
        "joints": None,
        "source": "MediaPipe Pose Landmarker Full",
    }


class WorldPose:
    def __init__(self, path):
        import mediapipe as mp

        self.mp = mp
        options = mp.tasks.vision.PoseLandmarkerOptions(
            base_options=mp.tasks.BaseOptions(model_asset_path=str(path)),
            num_poses=1,
            min_pose_detection_confidence=0.6,
            min_pose_presence_confidence=0.6,
            output_segmentation_masks=False,
        )
        self.model = mp.tasks.vision.PoseLandmarker.create_from_options(options)
        self.lock = threading.Lock()

    def estimate(self, frame, det):
        import cv2

        h, w = frame.shape[:2]
        box = det.bbox(0.4)
        if box is None:
            return unavailable("No person crop is available.")
        x0, y0, x1, y1 = box
        pad = 0.22 * max(x1 - x0, y1 - y0)
        x0, y0 = max(0, int(x0 - pad)), max(0, int(y0 - pad))
        x1, y1 = min(w, int(x1 + pad)), min(h, int(y1 + pad))
        if x1 <= x0 or y1 <= y0:
            return unavailable("The crop is empty.")
        rgb = cv2.cvtColor(frame[y0:y1, x0:x1], cv2.COLOR_BGR2RGB)
        with self.lock:
            result = self.model.detect(
                self.mp.Image(image_format=self.mp.ImageFormat.SRGB, data=rgb)
            )
        if not result.pose_landmarks or not result.pose_world_landmarks:
            return unavailable("The independent 3D model did not find a complete body.")
        lm = result.pose_landmarks[0]
        world = result.pose_world_landmarks[0]
        points = np.array(
            [[lm[j].x * (x1 - x0) + x0, lm[j].y * (y1 - y0) + y0] for j in COCO_FROM_MP]
        )
        confidence = np.array(
            [min(lm[j].visibility, lm[j].presence) for j in COCO_FROM_MP]
        )
        torso = max(
            float(
                np.linalg.norm(
                    np.mean(det.keypoints[[5, 6]], axis=0)
                    - np.mean(det.keypoints[[11, 12]], axis=0)
                )
            ),
            1,
        )
        common = [
            j for j in range(17) if det.scores[j] >= 0.5 and confidence[j] >= 0.65
        ]
        if sum(j in CORE for j in common) < 6 or not any(
            confidence[j] >= 0.65 for j in (15, 16)
        ):
            return unavailable(
                "The independent model cannot corroborate enough visible body landmarks."
            )
        errors = np.linalg.norm(points[common] - det.keypoints[common], axis=1) / torso
        if np.median(errors) > 0.15 or np.max(errors) > 0.35:
            return unavailable(
                "The 2D and 3D models disagree about the visible joints; a 3D body would be misleading."
            )
        joints = np.array([[world[j].x, world[j].y, world[j].z] for j in COCO_FROM_MP])
        if not np.isfinite(joints).all() or np.max(np.abs(joints)) > 3:
            return unavailable("The world-coordinate estimate is invalid.")
        return {
            "status": "estimated",
            "representation": "3d_skeleton",
            "source": "MediaPipe Pose Landmarker Full",
            "unit": "model_estimated_m",
            "coordinate_system": "hip-centred; x right, y down, z depth; learned scale",
            "joints": joints.round(5).tolist(),
            "scores": confidence.round(3).tolist(),
            "image_keypoints": points.round(2).tolist(),
            "bones": [list(x) for x in BONES],
            "agreement_median_torso_fraction": round(float(np.median(errors)), 3),
            "reason": "Learned monocular depth and scale, not calibrated measurement. Hidden joints remain estimates. The alignment report uses the original 2D landmarks.",
        }


_MODEL = None
_LOCK = threading.Lock()


def configured():
    return bool(
        os.environ.get("PILATES_3D_MODEL")
        and Path(os.environ["PILATES_3D_MODEL"]).is_file()
    )


def estimate(frame, det):
    global _MODEL
    path = os.environ.get("PILATES_3D_MODEL", "")
    if not path or not Path(path).is_file():
        return unavailable(
            "Optional 3D model is not installed. 2D measurements remain available."
        )
    try:
        with _LOCK:
            if _MODEL is None:
                _MODEL = WorldPose(path)
        return _MODEL.estimate(frame, det)
    except (ImportError, RuntimeError, ValueError, OSError) as exc:
        return unavailable(f"3D estimation is unavailable: {exc}")


def close():
    global _MODEL
    with _LOCK:
        if _MODEL is not None:
            _MODEL.model.close()
            _MODEL = None


import atexit

atexit.register(close)
