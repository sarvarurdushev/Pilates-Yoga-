import pytest

from pilates.diagnostics import (
    Check, VideoFacts, check_disk, check_environment, check_imports,
    check_python, check_speed, environment_ready, quickstart,
)


class FakeShot:
    def __init__(self, start, end, fps=25.0):
        self.start_frame, self.end_frame, self.fps = start, end, fps

    @property
    def frames(self):
        return self.end_frame - self.start_frame

    @property
    def duration(self):
        return self.frames / self.fps


def facts(width=1280, height=720, shots=None, frames=6000, fps=25.0):
    return VideoFacts(path="class.mov", width=width, height=height, fps=fps,
                      frames=frames, shots=shots if shots is not None else [FakeShot(0, 6000)])


class TestCheck:
    def test_passing_check_reads_cleanly(self):
        assert "[ok  ]" in Check("thing", True, "fine").format()

    def test_failing_check_shows_the_fix(self):
        text = Check("thing", False, "broken", "do this").format()
        assert "[FAIL]" in text and "fix: do this" in text

    def test_a_passing_check_does_not_show_a_fix(self):
        assert "fix:" not in Check("thing", True, "fine", "do this").format()


class TestEnvironment:
    def test_python_version_is_checked(self):
        assert check_python().ok      # the suite cannot run on an old one

    def test_every_dependency_is_named_separately(self):
        """So a failure says which package, not just 'imports failed'."""
        names = {c.name for c in check_imports()}
        assert {"numpy", "cv2", "onnxruntime", "rtmlib"} <= names

    def test_dependencies_explain_what_they_are_for(self):
        for check in check_imports():
            assert check.detail

    def test_disk_and_speed_report_something(self):
        assert check_disk().detail
        assert check_speed().detail

    def test_full_check_covers_everything(self):
        names = {c.name for c in check_environment()}
        assert "Python 3.10 or newer" in names
        assert "Free disk space" in names

    def test_a_missing_download_is_not_fatal(self):
        """It downloads itself on first use, so it must not block readiness."""
        checks = [Check("Python 3.10 or newer", True),
                  Check("Pose model downloaded", False)]
        assert environment_ready(checks)

    def test_a_missing_dependency_is_fatal(self):
        assert not environment_ready([Check("numpy", False)])


class TestQuickstart:
    def test_reports_the_video_shape(self):
        text = quickstart(facts())
        assert "1280x720" in text

    def test_lists_the_steps_in_order(self):
        text = quickstart(facts())
        for step in ("# 1.", "# 2.", "# 3.", "# 4.", "# 5.", "# 6."):
            assert step in text

    def test_fills_in_the_longest_shot(self):
        text = quickstart(facts(shots=[FakeShot(0, 500), FakeShot(500, 4000)]))
        assert "--start 500 --end 4000" in text

    def test_warns_about_cuts(self):
        text = quickstart(facts(shots=[FakeShot(0, 500), FakeShot(500, 4000)]))
        assert "Track ids restart at every cut" in text

    def test_no_cut_warning_for_a_single_shot(self):
        assert "restart at every cut" not in quickstart(facts())

    def test_warns_about_low_resolution(self):
        text = quickstart(facts(width=640, height=360))
        assert "low resolution" in text
        assert "30 pixels" in text

    def test_no_resolution_warning_for_hd(self):
        assert "low resolution" not in quickstart(facts())

    def test_uses_the_studio_own_filename(self):
        text = quickstart(facts(), stem="tuesday")
        assert "tuesday.labels.json" in text

    def test_survives_a_video_with_no_shots(self):
        text = quickstart(facts(shots=[]))
        assert "class.mov" in text or "1280x720" in text


class TestVideoFacts:
    def test_duration_from_frames_and_fps(self):
        assert facts(frames=2500, fps=25.0).duration == pytest.approx(100.0)

    def test_zero_fps_is_safe(self):
        assert facts(fps=0.0).duration == 0.0

    def test_edited_detection(self):
        assert not facts().is_edited
        assert facts(shots=[FakeShot(0, 100), FakeShot(100, 200)]).is_edited

    def test_longest_shot_is_picked(self):
        chosen = facts(shots=[FakeShot(0, 100), FakeShot(100, 900)]).longest_shot
        assert chosen.start_frame == 100

    def test_no_shots_means_no_longest(self):
        assert facts(shots=[]).longest_shot is None
