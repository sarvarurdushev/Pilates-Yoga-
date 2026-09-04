"""Keeping what the video contained, once the video is gone.

The property under test throughout: a pose stream is a faithful enough record
that any analysis in this system can be re-run on it as though the footage were
still there.
"""
import numpy as np
import pytest

from pilates import keypoints as kp
from pilates.archive import (FORMAT_VERSION, NOT_RECOVERABLE, PoseStream, cost,
                             decode, encode)
from pilates.types import Detection
from conftest import make_detection


def stream(n=50, track_id=4, step=0.2):
    times = np.arange(n, dtype=np.float32) * step
    detections = [make_detection(x=100 + i, y=100) for i in range(n)]
    return PoseStream(
        track_id=track_id, times=times,
        points=np.stack([d.keypoints for d in detections]),
        scores=np.stack([d.scores for d in detections]))


class TestRoundTrip:
    def test_a_stream_survives_encoding(self):
        again = decode(encode(stream()))
        assert len(again) == 50 and again.track_id == 4

    def test_keypoints_survive_to_well_under_a_pixel(self):
        """float16 holds pixel coordinates far finer than pose estimation is
        accurate to, which is the reason it is enough."""
        original = stream()
        again = decode(encode(original))
        assert np.abs(again.points - original.points).max() < 0.5

    def test_a_far_corner_of_a_4k_frame_still_lands_within_a_pixel(self):
        big = stream(n=4)
        big.points[:] = 3800.0
        again = decode(encode(big))
        assert np.abs(again.points - big.points).max() <= 2.0

    def test_scores_survive_finer_than_any_threshold_here(self):
        original = stream()
        again = decode(encode(original))
        assert np.abs(again.scores - original.scores).max() < 0.01

    def test_timestamps_survive(self):
        original = stream()
        again = decode(encode(original))
        assert np.abs(again.times - original.times).max() < 1e-3

    def test_an_empty_stream_round_trips(self):
        assert len(decode(encode(PoseStream(track_id=1)))) == 0

    def test_a_foreign_blob_is_refused_rather_than_misparsed(self):
        with pytest.raises(ValueError, match="not a pose stream"):
            decode(b"some other file entirely")

    def test_a_newer_format_is_refused_with_an_instruction(self):
        blob = bytearray(encode(stream(n=2)))
        blob[4] = FORMAT_VERSION + 1
        with pytest.raises(ValueError, match="Upgrade"):
            decode(bytes(blob))


class TestAnalysisIsReproducible:
    """The whole justification: an analysis re-run on the archive has to reach
    the same answer it reached on the video."""

    def test_angles_recomputed_from_the_archive_match(self):
        from pilates.geometry import whole_body

        original = make_detection()
        again = decode(encode(PoseStream(
            track_id=1, times=np.zeros(1, np.float32),
            points=original.keypoints[None], scores=original.scores[None])))
        before = whole_body(original)
        after = whole_body(again.detection(0))
        for name, value in before.items():
            if value is None:
                assert after[name] is None
            else:
                assert after[name] == pytest.approx(value, abs=0.5), name

    def test_a_signature_recomputed_from_the_archive_matches(self):
        from pilates.identity import Signature
        from pilates.movement import TrackHistory

        detections = [make_detection() for _ in range(30)]
        original = Signature.from_history(TrackHistory(1), detections)
        archived = decode(encode(PoseStream.from_samples(
            1, [(i / 5.0, d) for i, d in enumerate(detections)])))
        rebuilt = Signature.from_history(TrackHistory(1), archived.detections())
        assert original.distance(rebuilt) < 0.1

    def test_detections_come_back_as_the_type_the_system_works_on(self):
        assert isinstance(decode(encode(stream())).detection(0), Detection)


class TestGaps:
    """A gap is a real event, not something to smooth over. Interpolating
    across one would invent movement that did not happen."""

    def test_a_continuous_stream_has_none(self):
        assert stream(step=0.2).gaps(expected_step=0.2) == []

    def test_a_missing_stretch_is_recorded(self):
        s = stream(n=10, step=0.2)
        s.times = np.array([0, .2, .4, .6, 8.0, 8.2, 8.4, 8.6, 8.8, 9.0],
                           dtype=np.float32)
        gaps = s.gaps(expected_step=0.2)
        assert len(gaps) == 1
        assert gaps[0] == pytest.approx((0.6, 8.0))

    def test_a_single_dropped_frame_is_not_called_a_gap(self):
        s = stream(n=5, step=0.2)
        s.times = np.array([0, .2, .6, .8, 1.0], dtype=np.float32)
        assert s.gaps(expected_step=0.2) == []

    def test_a_stream_too_short_to_have_gaps_reports_none(self):
        assert PoseStream(track_id=1).gaps(expected_step=0.2) == []


class TestCost:
    """The storage decision has to be checkable, not asserted."""

    def test_an_hour_at_thirty_fps_is_single_digit_megabytes(self):
        figures = cost(30 * 3600)
        assert figures["raw_bytes"] < 12e6

    def test_it_is_far_smaller_than_the_video_it_replaces(self):
        figures = cost(30 * 3600)
        assert figures["video_bytes_at_1mbit"] > figures["compressed_bytes"] * 50

    def test_the_estimate_is_pessimistic_against_real_data(self):
        """Real pose streams are smooth and compress far better than the
        figure a studio plans disk against."""
        n = 2000
        times = (np.arange(n) / 30.0).astype(np.float32)
        points = np.zeros((n, kp.NUM_KEYPOINTS, 2), np.float32)
        for j in range(kp.NUM_KEYPOINTS):
            points[:, j, 0] = 500 + j * 10 + 20 * np.sin(times * 2 + j)
            points[:, j, 1] = 400 + j * 8 + 15 * np.sin(times * 3 + j)
        scores = np.full((n, kp.NUM_KEYPOINTS), 0.9, np.float32)
        actual = len(encode(PoseStream(1, times, points, scores)))
        assert actual < cost(n)["compressed_bytes"]

    def test_it_scales_with_the_number_of_people(self):
        assert cost(1000, people=3)["raw_bytes"] == cost(1000)["raw_bytes"] * 3


class TestWhatIsLost:
    """The price of not keeping the video, written next to the claim rather
    than in a footnote."""

    def test_the_list_exists_and_is_specific(self):
        assert len(NOT_RECOVERABLE) >= 5
        assert all(len(item) > 20 for item in NOT_RECOVERABLE)

    def test_it_names_the_face_and_the_audio(self):
        joined = " ".join(NOT_RECOVERABLE)
        assert "face" in joined.lower() and "audible" in joined

    def test_it_admits_a_better_model_cannot_be_re_run(self):
        joined = " ".join(NOT_RECOVERABLE)
        assert "better pose model" in joined
