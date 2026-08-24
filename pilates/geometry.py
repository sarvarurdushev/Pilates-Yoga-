"""Geometry helpers: boxes, trunk orientation, joint angles.

Everything here is pure maths on keypoint arrays. No model, no video.
"""
from __future__ import annotations

import math

import numpy as np

from . import keypoints as kp
from .types import Detection

Box = tuple[float, float, float, float]


def iou(a: Box, b: Box) -> float:
    """Intersection-over-union of two axis-aligned boxes."""
    ix0, iy0 = max(a[0], b[0]), max(a[1], b[1])
    ix1, iy1 = min(a[2], b[2]), min(a[3], b[3])
    iw, ih = max(0.0, ix1 - ix0), max(0.0, iy1 - iy0)
    inter = iw * ih
    if inter <= 0.0:
        return 0.0
    area_a = max(0.0, a[2] - a[0]) * max(0.0, a[3] - a[1])
    area_b = max(0.0, b[2] - b[0]) * max(0.0, b[3] - b[1])
    union = area_a + area_b - inter
    return inter / union if union > 0.0 else 0.0


def contains(outer: Box, inner: Box) -> bool:
    """True when ``inner`` lies entirely inside ``outer``."""
    return (
        inner[0] >= outer[0] and inner[1] >= outer[1]
        and inner[2] <= outer[2] and inner[3] <= outer[3]
    )


def overlap_fraction(box: Box, region: Box) -> float:
    """Fraction of ``box``'s area that falls inside ``region``."""
    ix0, iy0 = max(box[0], region[0]), max(box[1], region[1])
    ix1, iy1 = min(box[2], region[2]), min(box[3], region[3])
    iw, ih = max(0.0, ix1 - ix0), max(0.0, iy1 - iy0)
    inter = iw * ih
    area = max(0.0, box[2] - box[0]) * max(0.0, box[3] - box[1])
    return inter / area if area > 0.0 else 0.0


def _midpoint(det: Detection, left: int, right: int) -> np.ndarray:
    return (det.keypoints[left] + det.keypoints[right]) / 2.0


def trunk_angle(det: Detection, threshold: float = 0.4) -> float | None:
    """Angle of the torso against horizontal, in degrees.

    ``90`` is fully upright, ``0`` is lying flat. Returns ``None`` when the
    shoulders or hips are not confidently visible, because the answer would be
    meaningless rather than merely imprecise.
    """
    if any(det.scores[j] < threshold for j in kp.TRUNK):
        return None
    shoulders = _midpoint(det, kp.L_SHOULDER, kp.R_SHOULDER)
    hips = _midpoint(det, kp.L_HIP, kp.R_HIP)
    dx, dy = shoulders - hips
    if dx == 0.0 and dy == 0.0:
        return None
    return float(abs(math.degrees(math.atan2(abs(dy), abs(dx)))))


def posture(det: Detection, threshold: float = 0.4) -> str:
    """Coarse posture label derived from :func:`trunk_angle`."""
    angle = trunk_angle(det, threshold)
    if angle is None:
        return "unknown"
    if angle < 30.0:
        return "lying"
    if angle < 60.0:
        return "reclined"
    return "upright"


def joint_angle(det: Detection, a: int, b: int, c: int, threshold: float = 0.4) -> float | None:
    """Interior angle at joint ``b`` formed by ``a-b-c``, in degrees (0-180).

    Returns ``None`` unless all three joints clear ``threshold``.
    """
    if any(det.scores[j] < threshold for j in (a, b, c)):
        return None
    ba = det.keypoints[a] - det.keypoints[b]
    bc = det.keypoints[c] - det.keypoints[b]
    na, nc = np.linalg.norm(ba), np.linalg.norm(bc)
    if na == 0.0 or nc == 0.0:
        return None
    cosine = float(np.dot(ba, bc) / (na * nc))
    return float(math.degrees(math.acos(max(-1.0, min(1.0, cosine)))))


#: Joint angles worth measuring for mat work, as (name, a, b, c).
STANDARD_ANGLES: tuple[tuple[str, int, int, int], ...] = (
    ("left_knee", kp.L_HIP, kp.L_KNEE, kp.L_ANKLE),
    ("right_knee", kp.R_HIP, kp.R_KNEE, kp.R_ANKLE),
    ("left_hip", kp.L_SHOULDER, kp.L_HIP, kp.L_KNEE),
    ("right_hip", kp.R_SHOULDER, kp.R_HIP, kp.R_KNEE),
    ("left_elbow", kp.L_SHOULDER, kp.L_ELBOW, kp.L_WRIST),
    ("right_elbow", kp.R_SHOULDER, kp.R_ELBOW, kp.R_WRIST),
)


def standard_angles(det: Detection, threshold: float = 0.4) -> dict[str, float | None]:
    """Measure the joint angles in :data:`STANDARD_ANGLES`."""
    return {name: joint_angle(det, a, b, c, threshold) for name, a, b, c in STANDARD_ANGLES}


def symmetry(angles: dict[str, float | None]) -> dict[str, float | None]:
    """Left/right differences in degrees, for pairs where both sides were measured."""
    out: dict[str, float | None] = {}
    for name in ("knee", "hip", "elbow"):
        left, right = angles.get(f"left_{name}"), angles.get(f"right_{name}")
        out[name] = None if left is None or right is None else abs(left - right)
    return out
