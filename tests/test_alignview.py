"""The alignment drawing: it has to be as honest as the numbers behind it.

A posture overlay is the most persuasive thing this system produces -- lines
drawn over a body read as fact -- so what is tested here is mostly what the
picture must *not* do: hide a refusal, draw an estimate like a measurement, or
rake a line to a landmark that was never found.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))

from pilates import alignment as al  # noqa: E402
from pilates import alignview as av  # noqa: E402
from pilates import keypoints as kp  # noqa: E402
from pilates.types import Detection  # noqa: E402
from test_alignment import side_on, standing  # noqa: E402


def draw(det, **kw):
    return av.render(al.assess(det, frame_height=720, **kw), det,
                     width=600, height=720)


class TestDrawing:
    def test_it_is_an_svg_that_closes(self):
        svg = draw(standing())
        assert svg.startswith("<svg") and svg.rstrip().endswith("</svg>")

    def test_the_measured_angles_are_written_on_the_picture(self):
        assert "+12.7°" in draw(standing(shoulder_tilt=9.0))

    def test_a_refused_metric_is_drawn_as_refused_with_its_reason(self):
        """Left off the picture, its absence cannot be seen."""
        svg = draw(standing())
        assert "not measurable here" in svg
        assert "forward head" in svg
        assert "lens axis" in svg

    def test_the_vertical_reference_is_labelled_as_a_reference(self):
        """Nobody stands exactly on it; a line implying they should invents a fault."""
        svg = draw(standing())
        assert "vertical reference" in svg
        assert "target" not in svg.lower()

    def test_it_says_it_is_not_a_medical_assessment(self):
        """Whole, in one element. The visible copy wraps across the panel, so a
        search for the sentence has to find the `<desc>` that keeps it intact."""
        svg = draw(standing())
        assert f"<desc>{av.DISCLAIMER}</desc>" in svg
        assert "Not a medical assessment" in av.DISCLAIMER

    def test_a_withheld_score_is_shown_as_withheld(self):
        det = side_on()
        scores = det.scores.copy()
        scores[kp.L_EAR] = scores[kp.R_EAR] = 0.05
        svg = draw(Detection(det.keypoints, scores))
        assert "No score" in svg

    def test_a_landmark_at_the_origin_is_never_drawn(self):
        """A slot a backend never filled is not a joint, and a line to it rakes
        across the whole frame -- which is exactly what it looked like."""
        det = standing()
        points = det.keypoints.copy()
        points[kp.L_WRIST] = (0.0, 0.0)
        svg = av.render(al.assess(Detection(points, det.scores), frame_height=720),
                        Detection(points, det.scores), width=600, height=720)
        assert 'cx="0.0" cy="0.0"' not in svg
        assert 'x2="0.0" y2="0.0"' not in svg

    def test_a_joint_the_model_doubted_is_drawn_hollow(self):
        det = standing()
        scores = det.scores.copy()
        scores[kp.L_KNEE] = 0.2            # found, not trusted
        svg = av.render(al.assess(Detection(det.keypoints, scores), frame_height=720),
                        Detection(det.keypoints, scores), width=600, height=720)
        assert 'fill="none"' in svg


class TestComparisonDrawing:
    def test_both_readings_and_the_change_are_shown(self):
        before = al.assess(standing(shoulder_tilt=11.0), frame_height=720)
        after = al.assess(standing(shoulder_tilt=4.0), frame_height=720)
        svg = av.render_comparison(al.compare(before, after))
        assert "Before and after" in svg
        assert "shoulder tilt" in svg
        for column in ("before", "after", "change"):
            assert f">{column}</text>" in svg

    def test_it_refuses_to_call_a_smaller_deviation_an_improvement(self):
        before = al.assess(standing(shoulder_tilt=11.0), frame_height=720)
        after = al.assess(standing(shoulder_tilt=4.0), frame_height=720)
        svg = av.render_comparison(al.compare(before, after))
        assert "judgement for the person teaching" in svg
        assert "improvement" not in svg.replace(
            "Whether it is an improvement is a judgement", "")

    def test_two_views_are_marked_as_not_compared(self):
        svg = av.render_comparison(al.compare(
            al.assess(standing(facing="front"), frame_height=720),
            al.assess(standing(facing="rear"), frame_height=720)))
        assert "nothing is compared" in svg
