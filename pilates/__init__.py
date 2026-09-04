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
from .anatomy import (DEFAULT_ANATOMY, EMG, INFERRED, MEASURED, MUSCLE_SYNONYMS,
                      NERVE_SUPPLY, REFERENCE, RESEARCH, AnatomyEntry,
                      AnatomyLibrary, Innervation, Reconciliation, ResearchNote,
                      bones_for, canonical, extract_roots, groups_for,
                      innervation, reconcile)
from .merge import (POLICY, Merged, MergeReport, Verdict, merge_libraries,
                    merge_standard, review_local_only)
from .neurowellness import (Crosscheck, ImportReport, crosscheck_poses,
                            load_export, normalise, pose_angles, pose_targets)
from .universal import (ClassBaseline, UnnamedAssessment, assess_against_class,
                        assess_quality, assess_unnamed, build_baseline)
from .biomechanics import (MUSCLE_GROUPS, SEGMENTS, JointLoad, LoadReport,
                           MuscleGroup, NotComputable, analyse_frame,
                           classify_contraction, gravitational_moment)
from .classroom import (ClassPattern, ClassResult, CoverageCheck, Roster,
                        StudentResult, check_coverage, class_patterns, run_class)
from .archive import NOT_RECOVERABLE, PoseStream, cost as archive_cost, decode, encode
from .config import StudioConfig
from .dashboard import Point, Series, collect, render as render_dashboard
from .identity import (CONFIRMED, PROPOSED, REJECTED, Candidate, Directory,
                       Link, Person, Proposal, Signature, propose)
from .store import Row, SessionMeta, Store
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
from .geometry import (ANGLE_PAIRS, SEGMENT_ANGLES, neck_angle, pelvis_tilt,
                       posture, shoulder_tilt, standard_angles, symmetry,
                       trunk_angle, whole_body)
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
    "PoseStream", "encode", "decode", "archive_cost", "NOT_RECOVERABLE",
    "Candidate", "Directory", "Link", "Person", "Proposal", "Signature",
    "propose", "CONFIRMED", "PROPOSED", "REJECTED",
    "Store", "SessionMeta", "Row", "Point", "Series", "collect",
    "render_dashboard",
    "SymmetryTarget", "Assessment", "Finding", "assess", "assess_tempo",
    "narrate", "DEFAULT_STANDARDS", "UNSUITABLE", "ExerciseClassifier", "Evaluation", "evaluate",
    "featurise", "window_features", "majority_baseline", "LabelSet", "Segment", "LabelError", "VOCABULARY",
    "scaffold", "Shot", "detect_shots", "HistoryStore", "SessionRecord",
    "Measurement", "Trend", "measure_session", "progress_report",
    "DEFAULT_ANATOMY", "NERVE_SUPPLY", "AnatomyEntry", "AnatomyLibrary",
    "Innervation", "Reconciliation", "ResearchNote", "bones_for", "innervation",
    "reconcile", "MEASURED", "REFERENCE", "RESEARCH", "EMG", "INFERRED",
    "MUSCLE_SYNONYMS", "canonical", "extract_roots", "groups_for",
    "ImportReport", "load_export", "normalise", "Crosscheck", "crosscheck_poses",
    "pose_angles", "pose_targets", "POLICY", "Merged", "MergeReport", "Verdict",
    "merge_libraries", "merge_standard", "review_local_only",
    "ClassBaseline", "UnnamedAssessment", "assess_against_class",
    "assess_quality", "assess_unnamed", "build_baseline",
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
    "trunk_angle", "posture", "standard_angles", "symmetry", "whole_body",
    "neck_angle", "shoulder_tilt", "pelvis_tilt", "ANGLE_PAIRS", "SEGMENT_ANGLES",
    "describe", "similarity",
]
