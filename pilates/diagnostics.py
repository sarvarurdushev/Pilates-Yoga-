"""Is this machine ready, and what should this studio actually type?

Two problems stand between a working codebase and a studio using it.

The first is finding out on a Tuesday evening that a dependency is missing or
the model weights cannot be downloaded. :func:`check_environment` finds that
out deliberately instead.

The second is that there are a dozen commands with frame ranges and config
files, and knowing which to run is harder than running them.
:func:`quickstart` inspects the studio's own video and prints the exact
sequence, with the real numbers filled in.
"""
from __future__ import annotations

import shutil
import sys
from dataclasses import dataclass
from pathlib import Path

#: Weights are fetched on first use; this is what has to be reachable.
WEIGHTS_HOST = "https://download.openmmlab.com"
#: Rough size of the RTMO checkpoint, for the disk check.
WEIGHTS_MB = 80


@dataclass
class Check:
    """One thing that either works or does not, and what to do about it."""

    name: str
    ok: bool
    detail: str = ""
    fix: str = ""

    def format(self) -> str:
        mark = "ok  " if self.ok else "FAIL"
        line = f"  [{mark}] {self.name}"
        if self.detail:
            line += f" — {self.detail}"
        if not self.ok and self.fix:
            line += f"\n         fix: {self.fix}"
        return line


def check_python() -> Check:
    version = f"{sys.version_info.major}.{sys.version_info.minor}"
    ok = sys.version_info >= (3, 10)
    return Check("Python 3.10 or newer", ok, f"found {version}",
                 "install a newer Python; this uses modern type syntax")


def check_imports() -> list[Check]:
    """Every third-party package, checked one at a time so the failure is named."""
    required = [
        ("numpy", "numerical arrays"),
        ("cv2", "video reading, from opencv-python-headless"),
        ("onnxruntime", "running the pose model"),
        ("rtmlib", "the RTMO pose model itself"),
        ("sklearn", "exercise recognition, from scikit-learn"),
        ("joblib", "saving a trained recogniser"),
    ]
    checks: list[Check] = []
    for module, purpose in required:
        try:
            __import__(module)
            checks.append(Check(module, True, purpose))
        except ImportError as exc:
            checks.append(Check(module, False, str(exc),
                                "pip install -r requirements.txt"))
    return checks


def check_weights_cached() -> Check:
    """Whether the pose model has already been downloaded."""
    cache = Path.home() / ".cache" / "rtmlib" / "hub" / "checkpoints"
    if not cache.exists():
        return Check("Pose model downloaded", False,
                     "not yet — it will download on first use",
                     f"run any analysis once while online; about {WEIGHTS_MB} MB "
                     f"from {WEIGHTS_HOST}")
    files = list(cache.glob("*.onnx"))
    if not files:
        return Check("Pose model downloaded", False, "cache exists but is empty",
                     "run any analysis once while online")
    largest = max(f.stat().st_size for f in files) / 1e6
    return Check("Pose model downloaded", True,
                 f"{len(files)} file(s) cached, largest {largest:.0f} MB")


def check_disk(minimum_mb: int = 500) -> Check:
    free_mb = shutil.disk_usage(Path.home()).free / 1e6
    return Check("Free disk space", free_mb >= minimum_mb,
                 f"{free_mb:.0f} MB free",
                 f"free up space; weights and reports need about {minimum_mb} MB")


def check_speed() -> Check:
    """How fast this machine is, so expectations are set before a long run."""
    import os

    cores = os.cpu_count() or 1
    gpu = False
    try:
        import onnxruntime as ort

        providers = ort.get_available_providers()
        gpu = any("CUDA" in p or "ROCM" in p for p in providers)
    except Exception:
        providers = []
    if gpu:
        return Check("Processing speed", True, "a GPU provider is available")
    return Check(
        "Processing speed", True,
        f"CPU only, {cores} core(s) — expect roughly "
        f"{0.2 * 4 / max(cores, 1):.2f}s per analysed frame at 1080p",
        "",
    )


def check_environment() -> list[Check]:
    """Everything, in the order a person would want to hear it."""
    checks = [check_python()]
    checks.extend(check_imports())
    checks.extend([check_weights_cached(), check_disk(), check_speed()])
    return checks


def environment_ready(checks: list[Check]) -> bool:
    """Whether analysis can run at all. A missing download is not fatal."""
    fatal = {"Pose model downloaded"}
    return all(c.ok for c in checks if c.name not in fatal)


@dataclass
class VideoFacts:
    """What was found by looking at a studio's own video."""

    path: str
    width: int
    height: int
    fps: float
    frames: int
    shots: list
    people_estimate: int = 0

    @property
    def duration(self) -> float:
        return self.frames / self.fps if self.fps else 0.0

    @property
    def longest_shot(self):
        return max(self.shots, key=lambda s: s.frames) if self.shots else None

    @property
    def is_edited(self) -> bool:
        return len(self.shots) > 1


def inspect_video(path: str, sample_every: int = 8) -> VideoFacts:
    """Read a video's shape and cut structure, without running pose estimation."""
    import cv2

    from .shots import detect_shots

    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        raise IOError(f"could not open {path}")
    facts = VideoFacts(
        path=path,
        width=int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)),
        height=int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)),
        fps=cap.get(cv2.CAP_PROP_FPS) or 30.0,
        frames=int(cap.get(cv2.CAP_PROP_FRAME_COUNT)),
        shots=[],
    )
    cap.release()
    facts.shots = detect_shots(path, sample_every=sample_every)
    return facts


def quickstart(facts: VideoFacts, stem: str = "class") -> str:
    """The exact commands this studio should run, with their own numbers in.

    Written out rather than executed. A studio installing this needs to
    understand the sequence once; a script that hides it leaves them unable to
    do anything when a step fails.
    """
    shot = facts.longest_shot
    lines: list[str] = []

    lines.append(f"Your video: {facts.width}x{facts.height}, "
                 f"{facts.duration:.0f}s, {len(facts.shots)} shot"
                 f"{'s' if len(facts.shots) != 1 else ''}")

    warnings: list[str] = []
    if facts.height < 480:
        warnings.append(
            f"At {facts.height} lines tall this is low resolution. Students need "
            f"to be about 30 pixels tall for reliable detection — check "
            f"`pilates sweep` if results look thin."
        )
    if facts.is_edited:
        warnings.append(
            f"This video has {len(facts.shots)} shots. Track ids restart at every "
            f"cut, so analyse one shot at a time. The longest runs "
            f"{shot.start_frame}-{shot.end_frame} ({shot.duration:.0f}s)."
        )
    if warnings:
        lines.append("")
        for warning in warnings:
            lines.append(f"  ! {warning}")

    if shot is None:
        return "\n".join(lines)

    span = f"--start {shot.start_frame} --end {shot.end_frame}"
    lines += [
        "",
        "Run these in order:",
        "",
        "  # 1. Look at the room, and note where any mirrors are.",
        f"  python -m pilates probe {facts.path} --grid 100 --out grid.jpg",
        "",
        "  # 2. Write studio.json with any mirrors as exclusion zones.",
        "  #    See examples/studio_yoga_720p.json for the shape.",
        "",
        "  # 3. Find the students and write a roster to fill in.",
        f"  python -m pilates roster {facts.path} \\",
        f"      --config studio.json {span} --out roster.json",
        "",
        "  # 4. Fill in the names in roster.json, using roster_crops/ to tell",
        "  #    people apart. Rows still starting with ? are skipped.",
        "",
        "  # 5. Label what was taught, then check it.",
        f"  python -m pilates label {facts.path} --out {stem}.labels.json",
        f"  python -m pilates check {stem}.labels.json",
        "",
        "  # 6. Run the class.",
        f"  python -m pilates class {facts.path} \\",
        f"      --labels {stem}.labels.json --roster roster.json \\",
        f"      --config studio.json {span} \\",
        "      --history studio_history.json --out-dir reports/",
        "",
        "Reports land in reports/, one page per student plus class_summary.html.",
    ]
    return "\n".join(lines)
