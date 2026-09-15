"""Conservative evidence gates, separate from pose estimation and scoring.

Plausible geometry and model scores are not proof of visible anatomy. Broad
thresholds screen gross failures, not physiological differences. Standing rules
must never be applied to floor exercises or inverted poses.
"""

from dataclasses import dataclass, field
import numpy as np
from .types import Detection

CORE = (5, 6, 11, 12, 13, 14, 15, 16)
LEGS = ((11, 13, 15), (12, 14, 16))


@dataclass
class Visibility:
    reasons: list[str] = field(default_factory=list)
    checks: dict = field(default_factory=dict)

    @property
    def valid(self):
        return not self.reasons

    def to_dict(self):
        return {
            "valid": self.valid,
            "status": "likely_valid" if self.valid else "insufficient",
            "reasons": self.reasons,
            "checks": self.checks,
            "limitation": "Geometry and model scores cannot prove that an occluded joint is visible.",
        }


def validate_body(
    det: Detection,
    *,
    width=None,
    height=None,
    standing=False,
    side=False,
    threshold=0.5,
    min_pixels=180,
) -> Visibility:
    out = Visibility()
    p, s = det.keypoints, det.scores
    visible = s >= threshold
    head = [j for j in range(5) if visible[j]]
    complete = [all(visible[j] for j in leg) for leg in LEGS]
    if (
        not head
        or not all(visible[j] for j in (5, 6, 11, 12))
        or not (any(complete) if side else all(complete))
    ):
        out.reasons.append(
            "Insufficient body visibility for posture analysis. Capture the full body from head to feet; shoulders, hips, knees and ankles must be visible."
        )
    out.checks["visible_core_joints"] = int(sum(visible[j] for j in CORE))
    if width and height:
        inside = (
            (p[:, 0] >= 0) & (p[:, 0] < width) & (p[:, 1] >= 0) & (p[:, 1] < height)
        )
        if any(visible[j] and not inside[j] for j in (*range(5, 17), *head)):
            out.reasons.append(
                "Body landmarks fall outside the photograph. The body is cropped or the pose estimate is invalid."
            )
        margin = max(2, min(width, height) * 0.008)
        if any(
            visible[j]
            and (
                p[j, 1] >= height - margin
                or p[j, 1] < margin
                or p[j, 0] < margin
                or p[j, 0] >= width - margin
            )
            for j in (*head, 15, 16)
        ):
            out.reasons.append(
                "Head or feet touch the image edge. Leave space around the entire body."
            )
    lengths = []
    for sh, hip, knee, ankle in ((5, 11, 13, 15), (6, 12, 14, 16)):
        if all(visible[j] for j in (sh, hip, knee, ankle)):
            segments = [
                float(np.linalg.norm(p[a] - p[b]))
                for a, b in ((sh, hip), (hip, knee), (knee, ankle))
            ]
            total = sum(segments)
            lengths.append(total)
            if (
                total <= 0
                or min(segments) < 0.09 * total
                or max(segments) > 0.68 * total
            ):
                out.reasons.append(
                    "Impossible or severely foreshortened torso/leg geometry. Change the camera view."
                )
    body = float(np.median(lengths)) if lengths else 0
    out.checks["projected_body_chain_px"] = round(body, 1)
    if body < min_pixels:
        out.reasons.append(
            f"The visible body is too small or incomplete ({body:.0f} px; {min_pixels} px required). Move the camera closer."
        )
    if body and head and all(visible[j] for j in (5, 6)):
        neck = float(
            np.linalg.norm(np.mean(p[head], axis=0) - np.mean(p[[5, 6]], axis=0))
        )
        face_width = max(
            (float(np.linalg.norm(p[a] - p[b])) for a in head for b in head), default=0
        )
        out.checks["head_to_body_ratio"] = round(max(neck, face_width) / body, 3)
        if max(neck, face_width) > 0.32 * body:
            out.reasons.append(
                "Head-to-body proportions do not support a full visible body. This may be a head-and-shoulders crop."
            )
    # Arms can be missing without invalidating standing alignment; if visible,
    # impossible segment lengths cannot support movement measurements.
    arms = []
    for sh, el, wr in ((5, 7, 9), (6, 8, 10)):
        if body and all(visible[j] for j in (sh, el, wr)):
            lengths_arm = [
                float(np.linalg.norm(p[a] - p[b])) for a, b in ((sh, el), (el, wr))
            ]
            arms.append(sum(lengths_arm))
            if min(lengths_arm) < 0.025 * body or max(lengths_arm) > 0.8 * body:
                out.reasons.append(
                    "Impossible or severely foreshortened arm geometry. Change the camera view."
                )
    out.checks["arm_chain_to_body_ratios"] = [round(v / body, 3) for v in arms]
    if standing:
        from .geometry import joint_angle, posture

        if posture(det, threshold) != "upright":
            out.reasons.append(
                "Standing posture requires a neutral upright stance. Use Movement for seated, floor or inverted exercises."
            )
        for leg in LEGS:
            angle = joint_angle(det, *leg, threshold)
            if angle is not None and angle < 150:
                out.reasons.append(
                    "The knee is bent: this is not a neutral standing assessment. Use Movement for exercise poses."
                )
                break
    return out


def suppress_fragments(detections, threshold=0.5):
    """Remove a tiled partial duplicate only when its shared landmarks agree.

    Bounding-box NMS cannot match a head/torso fragment to its complete body.
    This requires more complete body evidence, at least five shared landmarks
    including two body joints, and small errors relative to the complete torso.
    Two complete people are never merged by this rule.
    """
    kept = []
    for det in sorted(
        detections, key=lambda d: int(sum(d.scores >= threshold)), reverse=True
    ):
        visible = det.scores >= threshold
        duplicate = False
        for full in kept:
            other = full.scores >= threshold
            if sum(visible) >= sum(other) or sum(visible & ~other) > 2:
                continue
            if all(visible[j] for j in CORE):
                continue
            if not all(other[j] for j in CORE):
                continue
            shared = np.where(visible & other)[0]
            if len(shared) < 5 or sum(j >= 5 for j in shared) < 2:
                continue
            if not all(other[j] for j in (5, 6, 11, 12)):
                continue
            torso = np.linalg.norm(
                np.mean(full.keypoints[[5, 6]], axis=0)
                - np.mean(full.keypoints[[11, 12]], axis=0)
            )
            if torso < 1:
                continue
            errors = (
                np.linalg.norm(det.keypoints[shared] - full.keypoints[shared], axis=1)
                / torso
            )
            if np.median(errors) < 0.07 and np.quantile(errors, 0.9) < 0.15:
                duplicate = True
                break
        if not duplicate:
            kept.append(det)
    return kept
