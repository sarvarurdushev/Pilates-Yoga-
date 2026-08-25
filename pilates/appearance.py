"""Appearance descriptors, used to tell crowded students apart.

Box overlap alone cannot separate students standing shoulder to shoulder: at
36% neighbour overlap the tracker has several plausible matches for every
person and picks wrong often enough that identities turn over three times per
student. Clothing colour is the cheapest signal that distinguishes them.

The descriptor is a hue/saturation histogram of the torso only. Torso rather
than the whole box because the box of someone in downward dog is mostly floor,
and floor is identical for everyone in the room. Hue and saturation rather than
brightness because studio lighting is uneven and a student moving through a
pool of light should stay the same student.

This is deliberately not a re-identification network. It has to run per person
per frame on a CPU alongside pose estimation, and it only has to separate
students who are already near each other -- a far easier problem than
recognising someone across cameras.
"""
from __future__ import annotations

import numpy as np

from . import keypoints as kp
from .types import Detection

#: Fraction of the torso box that must lie inside the frame to be described.
MIN_VISIBLE_TORSO = 0.5

#: Histogram bins for hue and saturation.
HUE_BINS = 8
SAT_BINS = 8
DESCRIPTOR_SIZE = HUE_BINS * SAT_BINS


def torso_box(
    det: Detection, threshold: float, shrink: float = 0.15
) -> tuple[int, int, int, int] | None:
    """Pixel box around the torso, or None if the torso is not visible.

    Shrunk towards the centre so the patch is mostly clothing rather than the
    background either side of a limb.
    """
    if any(det.scores[j] < threshold for j in kp.TRUNK):
        return None
    pts = det.keypoints[list(kp.TRUNK)]
    x0, y0 = pts.min(axis=0)
    x1, y1 = pts.max(axis=0)
    width, height = x1 - x0, y1 - y0
    if width <= 1 or height <= 1:
        return None
    x0 += width * shrink
    x1 -= width * shrink
    y0 += height * shrink
    y1 -= height * shrink
    if x1 - x0 < 1 or y1 - y0 < 1:
        return None
    return int(x0), int(y0), int(x1), int(y1)


def describe(frame: np.ndarray, det: Detection, threshold: float) -> np.ndarray | None:
    """Hue/saturation histogram of this person's torso, L1-normalised.

    Returns None when the torso is not visible or falls outside the frame,
    which the tracker treats as "no appearance evidence" rather than as a
    mismatch.
    """
    import cv2

    box = torso_box(det, threshold)
    if box is None:
        return None
    height, width = frame.shape[:2]
    x0, y0 = max(0, box[0]), max(0, box[1])
    x1, y1 = min(box[2], width), min(box[3], height)
    if x1 <= x0 or y1 <= y0:
        return None
    # A torso mostly outside the frame would otherwise be described from a
    # sliver of edge pixels -- a descriptor that matches almost anything.
    visible = (x1 - x0) * (y1 - y0)
    whole = (box[2] - box[0]) * (box[3] - box[1])
    if whole <= 0 or visible / whole < MIN_VISIBLE_TORSO:
        return None
    patch = frame[y0:y1, x0:x1]
    if patch.size == 0:
        return None

    hsv = cv2.cvtColor(patch, cv2.COLOR_BGR2HSV)
    hist = cv2.calcHist([hsv], [0, 1], None, [HUE_BINS, SAT_BINS], [0, 180, 0, 256])
    total = float(hist.sum())
    if total <= 0:
        return None
    return (hist.flatten() / total).astype(np.float32)


def similarity(a: np.ndarray | None, b: np.ndarray | None) -> float | None:
    """Histogram intersection, 0..1. None when either side has no descriptor.

    Intersection rather than a chi-squared or Bhattacharyya distance because it
    degrades gracefully when part of a torso is occluded: the visible half still
    contributes its share instead of the whole comparison collapsing.
    """
    if a is None or b is None:
        return None
    return float(np.minimum(a, b).sum())


def blend(current: np.ndarray | None, observed: np.ndarray | None, rate: float) -> np.ndarray | None:
    """Exponentially smooth a track's appearance model towards a new observation.

    Slow adaptation on purpose. A track that is briefly occluded by a neighbour
    would otherwise absorb the neighbour's colours and then match them instead.
    """
    if observed is None:
        return current
    if current is None:
        return observed
    return ((1.0 - rate) * current + rate * observed).astype(np.float32)
