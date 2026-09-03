"""Multi-person movement analysis for Pilates and yoga classes.

One camera watches a class; every student is found, given a stable identity,
and measured independently.

Pipeline order::

    video -> RTMO pose -> exclusion zones -> de-duplication -> tracking -> geometry
"""
from __future__ import annotations

from .classifier import (Evaluation, ExerciseClassifier, evaluate,
                         featurise, majority_baseline, window_features)
from .coaching import (DEFAULT_STANDARDS, AngleTarget, Assessment, ExerciseStandard,
                       Finding, SymmetryTarget, assess, assess_tempo, narrate, UNSUITABLE)
from .anatomy import (DEFAULT_ANATOMY, MEASURED, NERVE_SUPPLY, REFERENCE,
                      RESEARCH, AnatomyEntry, AnatomyLibrary, Innervation,
                      Reconciliation, ResearchNote, bones_for, innervation,
                      reconcile)
from .biomechanics import (MUSCLE_GROUPS, SEGMENTS, JointLoad, LoadReport,
                           MuscleGroup, NotComputable, analyse_frame,
                           classify_contraction, gravitational_moment)
from .classroom import (ClassPattern, ClassResult, CoverageCheck, Roster,
                        StudentResult, check_coverage, class_patterns, run_class)
from .config import StudioConfig
from .diagnostics import (Check, VideoFacts, check_environment, environment_ready,
                          inspect_video, quickstart)
from .dataset import (Example, LoadedDataset, build_from_video, feature_vector,
                      load_datasets, normalise_keypoints, window_for)
from .history import (HistoryStore, Measurement, SessionRecord, Trend,
                      measure_session, progress_report)
from .interaction import (Adjustment, Contact, ContactLog, EquipmentDeclaration,
                          EQUIPMENT_EFFECT, ValidityNote, find_contacts,
                          load_validity, session_validity, touched_ids)
from .recognition import (MovementDescription, OpenSetRecogniser, Recognition,
                          describe as describe_movement)
from .labels import VOCABULARY, LabelError, LabelSet, Segment, scaffold
from .report import StudentReport, build as build_report, render, write as write_report
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
    "StudioConfig", "ExclusionZone", "ExerciseStandard", "AngleTarget",
    "SymmetryTarget", "Assessment", "Finding", "assess", "assess_tempo",
    "narrate", "DEFAULT_STANDARDS", "UNSUITABLE", "ExerciseClassifier", "Evaluation", "evaluate",
    "featurise", "window_features", "majority_baseline", "LabelSet", "Segment", "LabelError", "VOCABULARY",
    "scaffold", "Shot", "detect_shots", "HistoryStore", "SessionRecord",
    "Measurement", "Trend", "measure_session", "progress_report",
    "DEFAULT_ANATOMY", "NERVE_SUPPLY", "AnatomyEntry", "AnatomyLibrary",
    "Innervation", "Reconciliation", "ResearchNote", "bones_for", "innervation",
    "reconcile", "MEASURED", "REFERENCE", "RESEARCH",
    "JointLoad", "LoadReport", "MuscleGroup", "MUSCLE_GROUPS", "SEGMENTS",
    "analyse_frame", "gravitational_moment", "classify_contraction", "NotComputable",
    "Check", "VideoFacts", "check_environment", "environment_ready",
    "inspect_video", "quickstart",
    "Roster", "ClassResult", "ClassPattern", "StudentResult", "CoverageCheck",
    "check_coverage", "class_patterns", "run_class",
    "StudentReport", "build_report", "render", "write_report", "Example", "build_from_video",
    "feature_vector", "normalise_keypoints", "window_for", "LoadedDataset", "load_datasets", "Pipeline", "PipelineStats", "VideoSource",
    "RTMOBackend", "StubBackend", "TiledBackend", "IoUTracker", "TrackerConfig",
    "Detection", "FrameResult", "TrackedPerson",
    "Adjustment", "Contact", "ContactLog", "EquipmentDeclaration", "EQUIPMENT_EFFECT",
    "ValidityNote", "find_contacts", "load_validity", "session_validity", "touched_ids",
    "MovementDescription", "OpenSetRecogniser", "Recognition", "describe_movement",
    "MovementSummary", "Repetition", "SessionQuality", "SessionRecorder", "TrackHistory",
    "find_repetitions", "summarise", "FloorHomography", "Association",
    "CalibrationError", "associate", "floor_point", "fuse_frame", "fuse_window",
    "trunk_angle", "posture", "standard_angles", "symmetry",
    "describe", "similarity",
]
