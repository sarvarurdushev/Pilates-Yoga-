import pytest

from pilates.shots import Shot, longest


class TestShot:
    def test_frames_and_seconds(self):
        shot = Shot(start_frame=240, end_frame=960, fps=24.0)
        assert shot.frames == 720
        assert shot.start_seconds == pytest.approx(10.0)
        assert shot.end_seconds == pytest.approx(40.0)
        assert shot.duration == pytest.approx(30.0)

    def test_zero_fps_does_not_divide_by_zero(self):
        shot = Shot(start_frame=0, end_frame=100, fps=0.0)
        assert shot.duration == 0.0


class TestLongest:
    def test_returns_longest_first(self):
        shots = [Shot(0, 100, 24), Shot(100, 900, 24), Shot(900, 1200, 24)]
        assert [s.frames for s in longest(shots)] == [800, 300, 100]

    def test_respects_the_count(self):
        shots = [Shot(i * 100, (i + 1) * 100, 24) for i in range(10)]
        assert len(longest(shots, count=3)) == 3

    def test_empty_input(self):
        assert longest([]) == []
