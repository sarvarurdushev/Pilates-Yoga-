"""Multi-person movement analysis for Pilates and yoga classes.

One camera watches a class; every student is found, given a stable identity,
and measured independently.

Pipeline order::

    video -> RTMO pose -> exclusion zones -> de-duplication -> tracking -> geometry
"""
from __future__ import annotations

from .config import StudioConfig
from .filters import ExclusionZone
from .geometry import posture, standard_angles, symmetry, trunk_angle
from .pipeline import Pipeline, PipelineStats, VideoSource
from .pose import RTMOBackend, StubBackend
from .tracking import IoUTracker, TrackerConfig
from .types import Detection, FrameResult, TrackedPerson

__version__ = "0.1.0"

__all__ = [
    "StudioConfig", "ExclusionZone", "Pipeline", "PipelineStats", "VideoSource",
    "RTMOBackend", "StubBackend", "IoUTracker", "TrackerConfig",
    "Detection", "FrameResult", "TrackedPerson",
    "trunk_angle", "posture", "standard_angles", "symmetry",
]
