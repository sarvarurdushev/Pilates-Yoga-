"""How much machine this is, and the sentence it turns into.

The point of this module is a promise made before the upload rather than
discovered during it: the same clip is a minute and a half on a laptop and an
hour and a half on a tenth of a core, and somebody who does not know that
concludes the thing is broken. So the tests that matter are the ones about
cgroup quotas -- a container capped at a tenth of a core on a sixty-four-core
host has a tenth of a core, and ``os.cpu_count`` would say sixty-four.
"""
import pytest

from pilates import capacity


class TestWhatTheMachineActuallyHas:
    def test_a_cgroup_v2_quota_beats_the_core_count(self, tmp_path, monkeypatch):
        cgroup = tmp_path / "cpu.max"
        cgroup.write_text("10000 100000\n")
        monkeypatch.setattr(capacity, "Path", lambda p: cgroup
                            if p.endswith("cpu.max") else tmp_path / "absent")
        monkeypatch.setattr("os.cpu_count", lambda: 64)
        assert capacity.cores() == 0.1

    def test_an_unlimited_cgroup_falls_back_to_the_cores(self, tmp_path, monkeypatch):
        cgroup = tmp_path / "cpu.max"
        cgroup.write_text("max 100000\n")
        monkeypatch.setattr(capacity, "Path", lambda p: cgroup
                            if p.endswith("cpu.max") else tmp_path / "absent")
        monkeypatch.setattr("os.cpu_count", lambda: 8)
        assert capacity.cores() == 8.0

    def test_a_machine_in_no_container_reports_its_cores(self, tmp_path, monkeypatch):
        monkeypatch.setattr(capacity, "Path", lambda p: tmp_path / "absent")
        monkeypatch.setattr("os.cpu_count", lambda: 4)
        assert capacity.cores() == 4.0

    def test_a_real_machine_answers_something_usable(self):
        """Whatever this is running on, the number has to be positive: it is a
        divisor, and a zero here is a division by zero in front of a user."""
        assert capacity.cores() > 0


class TestTheEstimate:
    def test_less_machine_means_a_longer_wait(self):
        assert capacity.seconds_for(20, on=0.1) > capacity.seconds_for(20, on=4)

    def test_it_scales_with_the_length_of_the_clip(self):
        assert capacity.seconds_for(40, on=2) == pytest.approx(
            2 * capacity.seconds_for(20, on=2))

    def test_the_measured_rate_is_what_is_used(self):
        assert capacity.seconds_for(10, on=1) == pytest.approx(
            10 * capacity.CPU_SECONDS_PER_VIDEO_SECOND)

    def test_no_machine_divides_by_zero(self):
        assert capacity.seconds_for(20, on=0) > 0

    @pytest.mark.parametrize("cores, clip, expected", [
        (4, 20, "about 2 minutes"),       # a laptop
        (2, 20, "about 4 minutes"),       # a free Hugging Face Space
        (0.5, 20, "about 17 minutes"),    # Render starter
        (0.1, 20, "about 1.4 hours"),     # Render free
    ])
    def test_the_wait_is_said_in_words_somebody_can_act_on(
            self, cores, clip, expected):
        assert capacity.in_words(capacity.seconds_for(clip, on=cores)) == expected

    def test_one_hour_is_not_one_hours(self):
        assert capacity.in_words(3600) == "about 1 hour"

    def test_seconds_below_a_minute_and_a_half(self):
        assert capacity.in_words(40) == "about 40 seconds"

    def test_a_very_long_wait_stops_pretending_to_precision(self):
        """Nobody needs a decimal place on a two-day answer."""
        assert capacity.in_words(200 * 3600) == "about 200 hours"
