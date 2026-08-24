"""COCO-17 keypoint layout, shared by every stage of the pipeline."""
from __future__ import annotations

NOSE = 0
L_EYE, R_EYE = 1, 2
L_EAR, R_EAR = 3, 4
L_SHOULDER, R_SHOULDER = 5, 6
L_ELBOW, R_ELBOW = 7, 8
L_WRIST, R_WRIST = 9, 10
L_HIP, R_HIP = 11, 12
L_KNEE, R_KNEE = 13, 14
L_ANKLE, R_ANKLE = 15, 16

NUM_KEYPOINTS = 17

NAMES = (
    "nose", "left_eye", "right_eye", "left_ear", "right_ear",
    "left_shoulder", "right_shoulder", "left_elbow", "right_elbow",
    "left_wrist", "right_wrist", "left_hip", "right_hip",
    "left_knee", "right_knee", "left_ankle", "right_ankle",
)

#: Joints that must be visible before a torso-based measurement is trustworthy.
TRUNK = (L_SHOULDER, R_SHOULDER, L_HIP, R_HIP)

SKELETON = (
    (L_ANKLE, L_KNEE), (L_KNEE, L_HIP), (R_ANKLE, R_KNEE), (R_KNEE, R_HIP),
    (L_HIP, R_HIP), (L_SHOULDER, L_HIP), (R_SHOULDER, R_HIP),
    (L_SHOULDER, R_SHOULDER), (L_SHOULDER, L_ELBOW), (R_SHOULDER, R_ELBOW),
    (L_ELBOW, L_WRIST), (R_ELBOW, R_WRIST), (L_EYE, R_EYE), (NOSE, L_EYE),
    (NOSE, R_EYE), (L_EYE, L_EAR), (R_EYE, R_EAR), (L_EAR, L_SHOULDER),
    (R_EAR, R_SHOULDER),
)
