import numpy as np
import pytest

from pilates import keypoints as kp
from pilates.appearance import DESCRIPTOR_SIZE, blend, describe, similarity, torso_box
from pilates.types import Detection
from conftest import make_detection

THR = 0.4


def solid(colour, size=400):
    frame = np.zeros((size, size, 3), dtype=np.uint8)
    frame[:, :] = colour
    return frame


RED = solid((40, 40, 200))
BLUE = solid((200, 60, 40))


class TestTorsoBox:
    def test_found_when_torso_visible(self):
        assert torso_box(make_detection(x=100, y=100), THR) is not None

    def test_none_when_torso_hidden(self):
        det = make_detection()
        scores = det.scores.copy()
        scores[kp.L_HIP] = 0.05
        assert torso_box(Detection(det.keypoints, scores), THR) is None

    def test_box_sits_inside_the_person(self):
        det = make_detection(x=100, y=100, width=100, height=200)
        person = det.bbox(THR)
        torso = torso_box(det, THR)
        assert torso[0] >= person[0] and torso[2] <= person[2]
        assert torso[1] >= person[1] and torso[3] <= person[3]


class TestDescribe:
    def test_shape_and_normalisation(self):
        d = describe(RED, make_detection(x=100, y=100), THR)
        assert d.shape == (DESCRIPTOR_SIZE,)
        assert d.sum() == pytest.approx(1.0, abs=1e-5)

    def test_none_without_a_visible_torso(self):
        det = make_detection()
        scores = det.scores.copy()
        scores[kp.R_SHOULDER] = 0.0
        assert describe(RED, Detection(det.keypoints, scores), THR) is None

    def test_none_when_the_torso_is_off_frame(self):
        tiny = np.zeros((10, 10, 3), dtype=np.uint8)
        assert describe(tiny, make_detection(x=500, y=500), THR) is None


class TestSimilarity:
    def test_identical_clothing_matches(self):
        det = make_detection(x=100, y=100)
        assert similarity(describe(RED, det, THR), describe(RED, det, THR)) == pytest.approx(1.0)

    def test_different_clothing_does_not(self):
        det = make_detection(x=100, y=100)
        assert similarity(describe(RED, det, THR), describe(BLUE, det, THR)) < 0.1

    def test_missing_descriptor_is_no_evidence_not_a_mismatch(self):
        d = describe(RED, make_detection(x=100, y=100), THR)
        assert similarity(d, None) is None
        assert similarity(None, d) is None
        assert similarity(None, None) is None


class TestBlend:
    def test_first_observation_is_adopted_whole(self):
        d = describe(RED, make_detection(x=100), THR)
        assert np.allclose(blend(None, d, 0.1), d)

    def test_missing_observation_leaves_the_model_alone(self):
        d = describe(RED, make_detection(x=100), THR)
        assert np.allclose(blend(d, None, 0.1), d)

    def test_adaptation_is_slow(self):
        det = make_detection(x=100)
        red, blue = describe(RED, det, THR), describe(BLUE, det, THR)
        once = blend(red, blue, 0.1)
        # One frame of a neighbour's colours must not capture the model.
        assert similarity(once, red) > similarity(once, blue)

    def test_repeated_observation_eventually_wins(self):
        det = make_detection(x=100)
        model, blue = describe(RED, det, THR), describe(BLUE, det, THR)
        for _ in range(60):
            model = blend(model, blue, 0.1)
        assert similarity(model, blue) > 0.9


class TestPartiallyVisibleTorso:
    """A torso half out of shot would otherwise be described from a strip of
    edge pixels, producing a descriptor that matches almost anyone."""

    def test_mostly_offscreen_torso_is_refused(self):
        frame = solid((40, 40, 200), size=200)
        # Person positioned so nearly all of the torso is past the right edge.
        assert describe(frame, make_detection(x=195, y=50, width=60, height=120), THR) is None

    def test_fully_visible_torso_is_described(self):
        frame = solid((40, 40, 200), size=200)
        assert describe(frame, make_detection(x=60, y=40, width=60, height=120), THR) is not None
