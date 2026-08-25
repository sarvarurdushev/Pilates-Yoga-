"""Multi-person movement analysis for Pilates and yoga classes.

One camera watches a class; every student is found, given a stable identity,
and measured independently.

Pipeline order::

    video -> RTMO pose -> exclusion zones -> de-duplication -> tracking -> geometry
"""
from __future__ import annotations

from .classifier import (Evaluation, ExerciseClassifier, evaluate,
                         featurise, majority_baseline, window_features)
from .config import StudioConfig
from .dataset import (Example, LoadedDataset, build_from_video, feature_vector,
                      load_datasets, normalise_keypoints)
from .labels import VOCABULARY, LabelError, LabelSet, Segment, scaffold
from .shots import Shot, detect_shots
from .filters import ExclusionZone
from .appearance import describe, similarity
from .geometry import posture, standard_angles, symmetry, trunk_angle
from .multiview import (Association, CalibrationError, FloorHomography,
                        associate, floor_point, fuse_frame, fuse_window)
from .movement import (MovementSummary, Repetition, SessionQuality, SessionRecorder,
                       TrackHistory, find_repetitions, summarise)
from .pipeline import Pipeline, PipelineStats, VideoSource
from .pose import RTMOBackend, StubBackend, TiledBackend
from .tracking import IoUTracker, TrackerConfig
from .types import Detection, FrameResult, TrackedPerson

__version__ = "0.1.0"

__all__ = [
    "StudioConfig", "ExclusionZone", "ExerciseClassifier", "Evaluation", "evaluate",
    "featurise", "window_features", "majority_baseline", "LabelSet", "Segment", "LabelError", "VOCABULARY",
    "scaffold", "Shot", "detect_shots", "Example", "build_from_video",
    "feature_vector", "normalise_keypoints", "LoadedDataset", "load_datasets", "Pipeline", "PipelineStats", "VideoSource",
    "RTMOBackend", "StubBackend", "TiledBackend", "IoUTracker", "TrackerConfig",
    "Detection", "FrameResult", "TrackedPerson",
    "MovementSummary", "Repetition", "SessionQuality", "SessionRecorder", "TrackHistory",
    "find_repetitions", "summarise", "FloorHomography", "Association",
    "CalibrationError", "associate", "floor_point", "fuse_frame", "fuse_window",
    "trunk_angle", "posture", "standard_angles", "symmetry",
    "describe", "similarity",
]
