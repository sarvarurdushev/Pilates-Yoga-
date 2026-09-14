"""The alignment endpoints, over HTTP, where the permission rules have to hold.

The measurement itself is tested in ``test_alignment.py``. What matters here is
the boundary: that landmarks arrive rather than video, that a malformed payload
is refused rather than half-understood, and that the rule the rest of this API
is built on reaches the new routes too -- being at the same studio is not
permission to read somebody's alignment; being on their roster is. A permission
system that guards only the endpoints it shipped with is decoration.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))

from pilates import alignment as al  # noqa: E402
from test_alignment import standing  # noqa: E402
from test_api import Client, studio  # noqa: E402,F401  (studio is a fixture)


def body(det, **extra) -> dict:
    return {"keypoints": det.keypoints.tolist(),
            "scores": det.scores.tolist(), **extra}


@pytest.fixture
def coach(studio):  # noqa: F811
    base, names, db = studio
    client = Client(base)
    client.sign_in("coach@b.co")
    return client, names, db


class TestAssessment:
    def test_landmarks_in_alignment_out(self, coach):
        client, _, _ = coach
        status, out = client.post("/posture", body(
            standing(shoulder_tilt=9.0), frame_height=720, person_id="t1"))
        assert status == 200
        assert out["person_id"] == "t1"
        assert out["view"] == "front"
        assert out["overall_score"] is not None
        assert out["metrics"]["shoulder_tilt"] > 0
        assert "shoulder_tilt" in out["attention"]

    def test_the_payload_carries_what_the_brief_asked_for(self, coach):
        client, _, _ = coach
        _, out = client.post("/posture", body(standing()))
        for key in ("person_id", "view", "overall_score", "metrics",
                    "confidence", "warnings"):
            assert key in out

    def test_a_known_camera_position_beats_the_estimator(self, coach):
        client, _, _ = coach
        _, out = client.post("/posture", body(standing(), view="rear"))
        assert out["view"] == "rear" and out["view_confidence"] == 1.0

    def test_an_unknown_view_is_refused_with_the_options(self, coach):
        client, _, _ = coach
        status, out = client.post("/posture", body(standing(), view="from above"))
        assert status == 400 and "side_left" in out["error"]

    @pytest.mark.parametrize("payload", [
        {},
        {"keypoints": [[0, 0]] * 17},                        # no scores
        {"keypoints": [[0, 0]] * 4, "scores": [1.0] * 4},    # wrong count
        {"keypoints": "nonsense", "scores": [1.0] * 17},
    ])
    def test_a_malformed_payload_is_refused_not_half_understood(self, coach, payload):
        client, _, _ = coach
        assert client.post("/posture", payload)[0] == 400

    def test_an_unmeasurable_metric_travels_with_its_reason(self, coach):
        """The gap has to be visible, or a reader fills it in themselves."""
        client, _, _ = coach
        _, out = client.post("/posture", body(standing()))
        assert out["metrics"]["forward_head"] is None
        assert out["availability"]["forward_head"] == "unavailable"
        assert out["reasons"]["forward_head"]

    def test_a_signed_out_visitor_gets_nothing(self, studio):  # noqa: F811
        base, _, _ = studio
        assert Client(base).post("/posture", body(standing()))[0] in (401, 403)


class TestTheRosterRule:
    def test_a_coach_may_assess_a_student_assigned_to_them(self, coach):
        client, names, _ = coach
        assert client.post("/roster/add", {"student": names["ann"]})[0] == 200
        status, out = client.post("/posture", body(standing(), username=names["ann"]))
        assert status == 200 and out["overall_score"] is not None

    def test_a_coach_may_not_assess_somebody_who_is_not(self, coach):
        """Being at the same studio is not permission."""
        client, names, _ = coach
        assert client.post("/posture", body(standing(), username=names["ben"]))[0] == 403


class TestComparison:
    def test_two_assessments_are_compared(self, coach):
        client, _, _ = coach
        status, out = client.post("/posture/compare", {
            "before": body(standing(shoulder_tilt=11.0), frame_height=720),
            "after": body(standing(shoulder_tilt=4.0), frame_height=720)})
        assert status == 200
        change = out["changes"]["shoulder_tilt"]
        assert change["comparable"] and change["toward_neutral"] is True
        assert change["absolute"] < 0

    def test_different_views_are_refused_rather_than_compared(self, coach):
        """A camera moved between visits would otherwise read as progress."""
        client, _, _ = coach
        _, out = client.post("/posture/compare", {
            "before": body(standing(facing="front"), frame_height=720),
            "after": body(standing(facing="rear"), frame_height=720)})
        assert not out["same_view"]
        assert out["comparable_metrics"] == 0

    def test_a_metric_missing_from_one_visit_is_not_a_result(self, coach):
        client, _, _ = coach
        det = standing()
        scores = det.scores.tolist()
        scores[al.kp.L_EAR] = 0.05
        _, out = client.post("/posture/compare", {
            "before": body(standing(), frame_height=720),
            "after": {"keypoints": det.keypoints.tolist(), "scores": scores,
                      "frame_height": 720}})
        change = out["changes"]["head_lateral_tilt"]
        assert not change["comparable"] and change["absolute"] is None

    def test_the_normal_bands_survive_the_round_trip(self, coach):
        """A rebuilt assessment has to judge a metric the same way the original
        did, or a comparison would quietly report a different finding."""
        client, _, _ = coach
        _, out = client.post("/posture/compare", {
            "before": body(standing(shoulder_tilt=0.1), frame_height=720),
            "after": body(standing(shoulder_tilt=0.4), frame_height=720)})
        assert out["changes"]["shoulder_tilt"]["percent"] is None
        assert set(al.NORMAL_BANDS) <= set(out["changes"])
