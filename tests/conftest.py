"""Shared helpers for building synthetic skeletons without a pose model."""
from __future__ import annotations

import numpy as np
import pytest

from pilates import keypoints as kp
from pilates.types import Detection


def make_detection(
    x: float = 100.0,
    y: float = 100.0,
    width: float = 60.0,
    height: float = 180.0,
    confidence: float = 0.9,
    lying: bool = False,
    visible: int = kp.NUM_KEYPOINTS,
) -> Detection:
    """A plausible skeleton inside the box (x, y, x+width, y+height).

    ``lying`` lays the torso horizontally so posture logic can be exercised.
    ``visible`` sets how many joints clear the confidence threshold.
    """
    points = np.zeros((kp.NUM_KEYPOINTS, 2), dtype=np.float32)
    scores = np.full(kp.NUM_KEYPOINTS, confidence, dtype=np.float32)

    if lying:
        # Head at the left edge, feet at the right, torso horizontal.
        points[kp.NOSE] = (x, y + height / 2)
        points[kp.L_EYE] = points[kp.R_EYE] = (x + 2, y + height / 2)
        points[kp.L_EAR] = points[kp.R_EAR] = (x + 4, y + height / 2)
        points[kp.L_SHOULDER] = (x + width * 0.2, y + height * 0.35)
        points[kp.R_SHOULDER] = (x + width * 0.2, y + height * 0.65)
        points[kp.L_ELBOW] = (x + width * 0.35, y + height * 0.30)
        points[kp.R_ELBOW] = (x + width * 0.35, y + height * 0.70)
        points[kp.L_WRIST] = (x + width * 0.5, y + height * 0.25)
        points[kp.R_WRIST] = (x + width * 0.5, y + height * 0.75)
        points[kp.L_HIP] = (x + width * 0.6, y + height * 0.40)
        points[kp.R_HIP] = (x + width * 0.6, y + height * 0.60)
        points[kp.L_KNEE] = (x + width * 0.8, y + height * 0.42)
        points[kp.R_KNEE] = (x + width * 0.8, y + height * 0.58)
        points[kp.L_ANKLE] = (x + width, y + height * 0.45)
        points[kp.R_ANKLE] = (x + width, y + height * 0.55)
    else:
        cx = x + width / 2
        points[kp.NOSE] = (cx, y)
        points[kp.L_EYE] = (cx - 4, y + 2)
        points[kp.R_EYE] = (cx + 4, y + 2)
        points[kp.L_EAR] = (cx - 8, y + 4)
        points[kp.R_EAR] = (cx + 8, y + 4)
        points[kp.L_SHOULDER] = (x, y + height * 0.2)
        points[kp.R_SHOULDER] = (x + width, y + height * 0.2)
        points[kp.L_ELBOW] = (x - 2, y + height * 0.35)
        points[kp.R_ELBOW] = (x + width + 2, y + height * 0.35)
        points[kp.L_WRIST] = (x - 4, y + height * 0.5)
        points[kp.R_WRIST] = (x + width + 4, y + height * 0.5)
        points[kp.L_HIP] = (x + width * 0.25, y + height * 0.55)
        points[kp.R_HIP] = (x + width * 0.75, y + height * 0.55)
        points[kp.L_KNEE] = (x + width * 0.25, y + height * 0.78)
        points[kp.R_KNEE] = (x + width * 0.75, y + height * 0.78)
        points[kp.L_ANKLE] = (x + width * 0.25, y + height)
        points[kp.R_ANKLE] = (x + width * 0.75, y + height)

    if visible < kp.NUM_KEYPOINTS:
        scores[visible:] = 0.05
    return Detection(keypoints=points, scores=scores)


@pytest.fixture
def detection_factory():
    return make_detection
