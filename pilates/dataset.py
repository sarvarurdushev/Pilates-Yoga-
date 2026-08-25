"""Turning labelled classes into training examples.

An exercise classifier reads a short window of movement, not a frame, so the
unit of training data is a fixed-length sequence of pose features for one
student inside one labelled segment.

Two properties matter more than anything else here:

* **Pose features must be invariant to where the student is and how big they
  appear.** Raw pixel coordinates encode mat position and distance from the
  camera. A classifier trained on them learns the room, and fails the moment a
  camera is nudged or a student picks a different mat.
* **A window must never straddle a boundary.** A window spanning the end of
  one exercise and the start of the next carries both, and is labelled as one.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from . import keypoints as kp
from .geometry import STANDARD_ANGLES, standard_angles, trunk_angle
from .labels import LabelSet, Segment
from .movement import TrackHistory
from .types import Detection

#: 17 normalised (x, y) pairs, six joint angles, trunk angle.
FEATURE_SIZE = kp.NUM_KEYPOINTS * 2 + len(STANDARD_ANGLES) + 1


def normalise_keypoints(detection: Detection) -> np.ndarray | None:
    """Keypoints centred on the hips and scaled by torso length.

    Removes where the student is standing and how far away they are, which are
    facts about the room rather than about the movement. Returns None when the
    torso is not visible, since there is then no reliable scale to divide by --
    guessing one would silently distort every coordinate.
    """
    scores = detection.scores
    if any(scores[j] < 0.3 for j in kp.TRUNK):
        return None
    points = detection.keypoints.astype(np.float32)
    hips = (points[kp.L_HIP] + points[kp.R_HIP]) / 2.0
    shoulders = (points[kp.L_SHOULDER] + points[kp.R_SHOULDER]) / 2.0
    torso = float(np.linalg.norm(shoulders - hips))
    if torso < 1e-3:
        return None
    return (points - hips) / torso


def feature_vector(detection: Detection, threshold: float = 0.4) -> np.ndarray | None:
    """One frame of one student, as a fixed-length vector.

    Angles are carried alongside the coordinates rather than left implicit.
    They are derivable from the points, but a small model learns far faster
    when the quantity an instructor actually coaches on is handed to it
    directly. Unmeasurable angles become zero, with the coordinates still
    carrying the geometry.
    """
    normalised = normalise_keypoints(detection)
    if normalised is None:
        return None
    angles = standard_angles(detection, threshold)
    trunk = trunk_angle(detection, threshold)
    tail = [
        (angles[name] or 0.0) / 180.0 for name, _, _, _ in STANDARD_ANGLES
    ] + [(trunk or 0.0) / 90.0]
    return np.concatenate([normalised.flatten(), np.asarray(tail, dtype=np.float32)])


@dataclass
class Example:
    """One training example: a window of movement with a label."""

    features: np.ndarray  # (frames, FEATURE_SIZE)
    label: str
    track_id: int
    start: float
    end: float


def _resample(features: list[np.ndarray], length: int) -> np.ndarray:
    """Stretch or squeeze a window to a fixed number of frames.

    Frames arrive unevenly -- stride, dropped detections, a student briefly
    occluded -- so windows are resampled by index rather than assumed regular.
    """
    stacked = np.stack(features)
    if len(stacked) == length:
        return stacked
    source = np.linspace(0, len(stacked) - 1, num=length)
    lower = np.floor(source).astype(int)
    upper = np.minimum(lower + 1, len(stacked) - 1)
    weight = (source - lower)[:, None]
    return (stacked[lower] * (1 - weight) + stacked[upper] * weight).astype(np.float32)


def windows_for_track(
    history: TrackHistory,
    detections: dict[float, Detection],
    segment: Segment,
    window_seconds: float,
    hop_seconds: float,
    frames_per_window: int,
    keypoint_threshold: float = 0.4,
    min_coverage: float = 0.6,
) -> list[Example]:
    """Every window one student contributes to one labelled segment."""
    times = [s.timestamp for s in history.samples if segment.contains(s.timestamp)]
    if not times:
        return []

    examples: list[Example] = []
    start = segment.start
    while start + window_seconds <= segment.end + 1e-6:
        end = start + window_seconds
        chosen = [t for t in times if start <= t < end]
        # A window the student was mostly absent from would be padded with
        # guesses, so it is dropped rather than filled in.
        expected = max(1, len(times) * window_seconds / max(segment.duration, 1e-6))
        if len(chosen) >= max(3, expected * min_coverage):
            vectors = [
                v for v in (feature_vector(detections[t], keypoint_threshold) for t in chosen)
                if v is not None
            ]
            if len(vectors) >= 3:
                examples.append(
                    Example(
                        features=_resample(vectors, frames_per_window),
                        label=segment.exercise,
                        track_id=history.track_id,
                        start=start,
                        end=end,
                    )
                )
        start += hop_seconds
    return examples


def summarise_dataset(examples: list[Example]) -> dict[str, int]:
    """Examples per label, most first. How you know whether you have enough."""
    counts: dict[str, int] = {}
    for example in examples:
        counts[example.label] = counts.get(example.label, 0) + 1
    return dict(sorted(counts.items(), key=lambda kv: -kv[1]))


def save_dataset(
    examples: list[Example],
    path: str,
    labels: LabelSet | None = None,
    session: str | None = None,
) -> None:
    """Write examples as a compressed .npz with their label vocabulary.

    ``session`` names the class these windows came from. It is what makes
    session-level holdout possible later: the question "can this recognise a
    class it has never seen" needs to know which class each window belongs to.
    """
    if not examples:
        raise ValueError("no examples to save")
    features = np.stack([e.features for e in examples])
    names = sorted({e.label for e in examples})
    index = {name: i for i, name in enumerate(names)}
    source = session or (labels.video if labels else "unknown")
    np.savez_compressed(
        path,
        features=features,
        labels=np.array([index[e.label] for e in examples], dtype=np.int64),
        label_names=np.array(names),
        track_ids=np.array([e.track_id for e in examples], dtype=np.int64),
        starts=np.array([e.start for e in examples], dtype=np.float32),
        source=np.array([source]),
    )


@dataclass
class LoadedDataset:
    """One or more dataset files merged, with grouping ready for evaluation."""

    windows: np.ndarray
    labels: np.ndarray
    names: list[str]
    #: Student identity, namespaced by session. Track 1 of one class is not
    #: the same person as track 1 of another, and merging them without
    #: namespacing would let a "held-out student" appear in training.
    student_groups: np.ndarray
    session_groups: np.ndarray
    sessions: list[str]

    @property
    def n_sessions(self) -> int:
        return len(set(self.session_groups.tolist()))

    @property
    def n_students(self) -> int:
        return len(set(self.student_groups.tolist()))


def load_datasets(paths: list[str]) -> LoadedDataset:
    """Merge dataset files, reconciling their label vocabularies.

    Each file indexes its own labels from zero, so the same integer means
    different exercises in different files. Indices are remapped onto a shared
    vocabulary rather than concatenated blindly.
    """
    if not paths:
        raise ValueError("no dataset paths given")

    loaded = [np.load(p, allow_pickle=False) for p in paths]
    names = sorted({str(n) for d in loaded for n in d["label_names"]})
    index = {name: i for i, name in enumerate(names)}

    windows, labels, students, sessions_idx = [], [], [], []
    sessions: list[str] = []
    for session_number, (path, data) in enumerate(zip(paths, loaded)):
        source = str(data["source"][0]) if "source" in data else Path(path).stem
        sessions.append(source)
        local_names = [str(n) for n in data["label_names"]]
        windows.append(data["features"])
        labels.append(np.array([index[local_names[i]] for i in data["labels"]], dtype=np.int64))
        students.append(np.array(
            [f"{session_number}:{t}" for t in data["track_ids"].tolist()]
        ))
        sessions_idx.append(np.full(len(data["labels"]), session_number, dtype=np.int64))

    return LoadedDataset(
        windows=np.concatenate(windows),
        labels=np.concatenate(labels),
        names=names,
        student_groups=np.concatenate(students),
        session_groups=np.concatenate(sessions_idx),
        sessions=sessions,
    )


def build_from_video(
    video: str,
    labels: LabelSet,
    config,
    window_seconds: float = 3.0,
    hop_seconds: float = 1.5,
    frames_per_window: int = 24,
    include_non_exercise: bool = False,
    progress=None,
) -> list[Example]:
    """Run the pipeline over a labelled video and cut it into training windows.

    Only segments the labels call real exercises are used by default;
    ``transition`` and ``instruction`` are structural labels that exist so the
    footage between exercises can be marked honestly rather than absorbed into
    whichever exercise preceded it.
    """
    from .movement import TrackHistory
    from .pipeline import Pipeline, VideoSource

    segments = [
        s for s in labels.segments if include_non_exercise or s.is_exercise
    ]
    if not segments:
        return []

    pipeline = Pipeline(config)
    histories: dict[int, TrackHistory] = {}
    detections: dict[int, dict[float, Detection]] = {}

    with VideoSource(video, stride=config.frame_stride) as source:
        for result in pipeline.run(source):
            for person in result.people:
                history = histories.setdefault(
                    person.track_id, TrackHistory(track_id=person.track_id)
                )
                history.add(result.timestamp, person.detection, config.keypoint_threshold)
                detections.setdefault(person.track_id, {})[result.timestamp] = person.detection
            if progress:
                progress(result)

    examples: list[Example] = []
    for track_id, history in sorted(histories.items()):
        for segment in segments:
            examples.extend(
                windows_for_track(
                    history,
                    detections[track_id],
                    segment,
                    window_seconds=window_seconds,
                    hop_seconds=hop_seconds,
                    frames_per_window=frames_per_window,
                    keypoint_threshold=config.keypoint_threshold,
                )
            )
    return examples
