"""The photograph intake, over HTTP, where the permission rules have to hold.

The measurement is tested in ``test_intake.py``. What matters here is the
boundary: that a photograph arrives and its landmarks come back but the
photograph does not, that a malformed set is refused rather than half
understood, that being at the same studio is not permission to assess
somebody's body, and that one unusable photograph does not throw away the three
that worked.

**The pose model is replaced by a stub.** Running RTMO would make this suite
download ninety megabytes and take a minute per case, and it would be testing
somebody else's ONNX graph rather than this boundary. The stub returns the same
synthetic bodies the rest of the suite measures, so the numbers are known and
the assertions can be about them.
"""
from __future__ import annotations

import base64
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).parent))

from pilates import alignment as al  # noqa: E402
from pilates import api  # noqa: E402
from pilates import photos as ph  # noqa: E402
from pilates.alignment import View  # noqa: E402
from test_alignment import side_on, standing  # noqa: E402
from test_api import Client, studio  # noqa: E402,F401  (studio is a fixture)

WIDTH, HEIGHT = 1080, 1440


def png(width: int = WIDTH, height: int = HEIGHT) -> str:
    """A real PNG of the right size, so the decoder does real work.

    Written by hand rather than through OpenCV: a solid colour compresses to
    about a hundred bytes and the point is the header, not the picture.
    """
    import zlib
    import struct

    raw = b"".join(b"\x00" + b"\x80" * (width * 3) for _ in range(height))

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    body = (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 6))
            + chunk(b"IEND", b""))
    return "data:image/png;base64," + base64.b64encode(body).decode()


BODIES = {
    View.FRONT: lambda: standing(shoulder_tilt=9.0, hip_tilt=5.0, cx=540),
    View.REAR: lambda: standing(facing="rear", shoulder_tilt=8.0,
                                hip_tilt=4.0, cx=540),
    View.SIDE_LEFT: lambda: side_on(facing_image_left=False, ear_ahead=44.0,
                                    cx=540),
    View.SIDE_RIGHT: lambda: side_on(facing_image_left=True, ear_ahead=40.0,
                                     cx=540),
}


class Stub:
    """A pose backend that answers from a script instead of from the pixels.

    It cannot see the photograph, so the caller says which body each call
    should return, in order. ``people`` lets a case put a bystander in frame.
    """

    def __init__(self, script: list, people: int = 1) -> None:
        self.script = list(script)
        self.people = people
        self.calls = 0

    def __call__(self, frame: np.ndarray) -> list:
        self.calls += 1
        det = self.script.pop(0) if self.script else standing(cx=540)
        if det is None:
            return []
        out = [det]
        for _ in range(self.people - 1):
            # A smaller bystander: half the size, so the subject wins.
            small = standing(cx=200)
            out.append(type(det)(small.keypoints * 0.5, small.scores))
        return out


@pytest.fixture
def stubbed(monkeypatch):
    """Install a stub backend for the duration of one test."""
    holder = {}

    def install(script, people=1):
        stub = Stub(script, people)
        holder["stub"] = stub
        monkeypatch.setattr(api, "pose_backend", lambda: stub)
        monkeypatch.setattr(api, "_BACKEND", stub, raising=False)
        return stub

    return install


@pytest.fixture
def coach(studio):  # noqa: F811
    base, names, db = studio
    client = Client(base)
    client.sign_in("coach@b.co")
    return client, names, db


def shots(*views) -> list[dict]:
    return [{"view": v.value, "image": png()} for v in views]


ALL_FOUR = (View.FRONT, View.SIDE_LEFT, View.SIDE_RIGHT, View.REAR)


def script_for(*views) -> list:
    return [BODIES[v]() for v in views]


def sparse(view) -> "object":
    """A body with its head lost, so too few checks can be made to score.

    One side photograph now measures six things -- the plumb chain took it
    from two -- which is enough to clear the minimum, so a set that used to be
    unscoreable for lack of checks no longer is. Losing the ear costs the two
    measurements that need it and drops the count back under the bar, which is
    the condition this test is actually about.
    """
    det = BODIES[view]()
    scores = det.scores.copy()
    scores[al.kp.L_EAR] = scores[al.kp.R_EAR] = 0.05
    scores[al.kp.NOSE] = 0.05
    return type(det)(det.keypoints, scores)


class TestTheIntake:
    def test_four_photographs_in_one_report_out(self, coach, stubbed):
        client, _, _ = coach
        stubbed(script_for(*ALL_FOUR))
        status, out = client.post("/intake", {
            "photos": shots(*ALL_FOUR), "taken_on": "2026-09-14"})
        assert status == 200, out
        assert out["assessment"]["complete"]
        assert out["score"]["value"] is not None
        assert out["findings"]

    def test_the_landmarks_come_back_and_the_photographs_do_not(self, coach,
                                                                stubbed):
        """The whole privacy argument, as an assertion."""
        client, _, _ = coach
        stubbed(script_for(*ALL_FOUR))
        _, out = client.post("/intake", {"photos": shots(*ALL_FOUR)})
        assert set(out["landmarks"]) == {v.value for v in ALL_FOUR}
        assert len(out["landmarks"]["front"]["keypoints"]) == 17
        assert "data:image" not in repr(out)

    def test_the_landmarks_are_in_the_photograph_s_own_coordinates(self, coach,
                                                                   stubbed):
        """So the browser can draw the overlay on the copy it already has."""
        client, _, _ = coach
        stubbed(script_for(*ALL_FOUR))
        _, out = client.post("/intake", {"photos": shots(*ALL_FOUR)})
        front = out["landmarks"]["front"]
        assert front["width"] == WIDTH and front["height"] == HEIGHT
        xs = [point[0] for point in front["keypoints"]]
        assert 0 < max(xs) <= WIDTH

    def test_the_protocol_travels_so_the_page_need_not_hard_code_it(self,
                                                                    coach,
                                                                    stubbed):
        client, _, _ = coach
        stubbed(script_for(View.FRONT))
        _, out = client.post("/intake", {"photos": shots(View.FRONT)})
        assert [slot["view"] for slot in out["protocol"]] == [
            v.value for v in ALL_FOUR]
        assert all(slot["how"] and slot["how_ko"] for slot in out["protocol"])

    def test_a_partial_set_is_measured_and_says_what_is_missing(self, coach,
                                                                stubbed):
        client, _, _ = coach
        stubbed(script_for(View.FRONT, View.REAR))
        status, out = client.post("/intake",
                                  {"photos": shots(View.FRONT, View.REAR)})
        assert status == 200
        assert not out["assessment"]["complete"]
        missing = {slot["view"] for slot in out["missing_photos"]}
        assert missing == {"side_left", "side_right"}

    def test_the_findings_carry_both_languages(self, coach, stubbed):
        client, _, _ = coach
        stubbed(script_for(*ALL_FOUR))
        _, out = client.post("/intake", {"photos": shots(*ALL_FOUR)})
        assert all(f["title_ko"] and f["means_ko"] for f in out["findings"])

    def test_what_cannot_be_measured_travels_with_the_rest(self, coach,
                                                           stubbed):
        client, _, _ = coach
        stubbed(script_for(*ALL_FOUR))
        _, out = client.post("/intake", {"photos": shots(*ALL_FOUR)})
        assert "sagittal_pelvic_tilt" in out["refused"]


class TestAPhotographThatWillNotDo:
    def test_a_photograph_with_nobody_in_it_does_not_fail_the_others(self,
                                                                     coach,
                                                                     stubbed):
        client, _, _ = coach
        stubbed([BODIES[View.FRONT](), None,
                 BODIES[View.SIDE_RIGHT](), BODIES[View.REAR]()])
        status, out = client.post("/intake", {"photos": shots(*ALL_FOUR)})
        assert status == 200
        assert "side_left" not in out["landmarks"]
        assert out["score"]["value"] is not None
        assert any("no person" in w for w in out["warnings"])

    def test_a_second_person_in_frame_is_reported_not_hidden(self, coach,
                                                             stubbed):
        client, _, _ = coach
        stubbed(script_for(*ALL_FOUR), people=2)
        _, out = client.post("/intake", {"photos": shots(*ALL_FOUR)})
        assert any("2 people were found" in w for w in out["warnings"])

    def test_a_photograph_too_small_to_measure_is_refused_with_the_reason(
            self, coach, stubbed):
        client, _, _ = coach
        stubbed(script_for(View.FRONT))
        _, out = client.post("/intake", {
            "photos": [{"view": "front", "image": png(120, 160)}]})
        assert any("too few pixels" in w for w in out["warnings"])

    def test_a_tall_narrow_photograph_is_the_right_shape_not_the_wrong_one(
            self, coach, stubbed):
        """The bug this test exists for.

        The size gate tested ``min(height, width)``, so every correctly framed
        standing photograph was refused: a person standing is tall and narrow,
        and the width is small *because* the framing is right. The studio's
        first real set -- 161x361, 166x360, 151x366, 116x360 -- came back with
        four refusals and an empty report.
        """
        client, _, _ = coach
        stubbed(script_for(*ALL_FOUR))
        status, out = client.post("/intake", {"photos": [
            {"view": "front", "image": png(161, 361)},
            {"view": "side_left", "image": png(166, 360)},
            {"view": "side_right", "image": png(151, 366)},
            {"view": "rear", "image": png(116, 360)}]})
        assert status == 200
        assert out["assessment"]["supplied"] == [v.value for v in ALL_FOUR]
        assert out["missing_photos"] == []
        assert not any("too few pixels" in w for w in out["warnings"])
        assert out["landmarks"], "and it measured them"

    def test_something_that_is_not_an_image_is_refused_with_the_reason(
            self, coach, stubbed):
        client, _, _ = coach
        stubbed([])
        _, out = client.post("/intake", {
            "photos": [{"view": "front",
                        "image": "data:image/png;base64," +
                                 base64.b64encode(b"not a png").decode()}]})
        assert any("photograph" in w for w in out["warnings"])


class TestWhatIsRefusedOutright:
    @pytest.mark.parametrize("payload", [
        {},
        {"photos": []},
        {"photos": "front"},
        {"photos": [{"view": "front"}, {"view": "front"}]},
        {"photos": [{"view": "above", "image": "x"}]},
        {"photos": [{"view": "unknown", "image": "x"}]},
        {"photos": ["front"]},
    ])
    def test_a_malformed_set_is_refused_not_half_understood(self, coach,
                                                            stubbed, payload):
        client, _, _ = coach
        stubbed([])
        assert client.post("/intake", payload)[0] == 400

    def test_two_photographs_claiming_one_view_are_refused(self, coach,
                                                           stubbed):
        """One would silently replace the other and which survived would be
        arbitrary."""
        client, _, _ = coach
        stubbed([])
        status, out = client.post("/intake", {
            "photos": [{"view": "front", "image": png()},
                       {"view": "front", "image": png()}]})
        assert status == 400 and "both labelled front" in out["error"]

    def test_more_than_the_protocol_is_refused(self, coach, stubbed):
        client, _, _ = coach
        stubbed([])
        status, _ = client.post("/intake", {
            "photos": shots(*ALL_FOUR) + [{"view": "front", "image": png()}]})
        assert status == 400

    def test_a_signed_out_visitor_gets_nothing(self, studio, stubbed):  # noqa: F811
        base, _, _ = studio
        stubbed([])
        assert Client(base).post("/intake",
                                 {"photos": shots(View.FRONT)})[0] in (401, 403)


class TestTheRosterRule:
    def test_a_coach_may_assess_a_student_assigned_to_them(self, coach,
                                                           stubbed):
        client, names, _ = coach
        stubbed(script_for(View.FRONT))
        assert client.post("/roster/add", {"student": names["ann"]})[0] == 200
        status, out = client.post("/intake", {
            "photos": shots(View.FRONT), "username": names["ann"]})
        assert status == 200
        assert out["assessment"]["person_id"] == names["ann"]

    def test_a_coach_may_not_assess_somebody_who_is_not(self, coach, stubbed):
        """Being at the same studio is not permission."""
        client, names, _ = coach
        stubbed(script_for(View.FRONT))
        assert client.post("/intake", {"photos": shots(View.FRONT),
                                       "username": names["ben"]})[0] == 403


class TestTheDecoder:
    def test_a_bare_base64_string_without_the_uri_prefix_still_decodes(self):
        data = png()
        frame = ph.decode(data.split(",", 1)[1])
        assert frame.shape[:2] == (HEIGHT, WIDTH)

    def test_an_oversized_photograph_is_refused_before_it_is_decoded(self):
        payload = base64.b64encode(b"\x00" * (ph.MAX_BYTES + 10)).decode()
        with pytest.raises(ph.BadPhoto, match="larger than"):
            ph.decode("data:image/png;base64," + payload)

    def test_an_empty_slot_says_so(self):
        with pytest.raises(ph.BadPhoto, match="no photograph"):
            ph.decode("")

    def test_a_large_photograph_is_measured_at_its_own_scale(self):
        """Downscaling is for the model. The caller gets the original frame's
        coordinates back, or the browser's overlay lands in the wrong place."""
        big = np.zeros((3000, 2000, 3), np.uint8)
        det = standing(cx=1000)
        found = ph.subject(big, Stub([det]))
        assert found.width == 2000 and found.height == 3000
        xs = found.detection.keypoints[:, 0]
        assert xs.max() > 900, xs.max()

    def test_the_largest_body_is_the_subject_not_the_most_confident_one(self):
        """A small clear bystander must not beat a large subject."""
        subject_body = standing(cx=540)
        bystander = standing(cx=200)
        shrunk = type(bystander)(bystander.keypoints * 0.4, bystander.scores)
        frame = np.zeros((HEIGHT, WIDTH, 3), np.uint8)

        class Two:
            def __call__(self, _):
                return [shrunk, subject_body]

        found = ph.subject(frame, Two())
        assert found.people == 2
        assert found.detection.keypoints.max() == subject_body.keypoints.max()


class TestWhatIsKept:
    """An assessment that vanishes with the tab cannot be compared with
    anything, which is the whole point of taking a second one."""

    def test_an_assessment_is_filed_against_the_person(self, coach, stubbed):
        client, _, _ = coach
        stubbed(script_for(*ALL_FOUR))
        _, out = client.post("/intake", {"photos": shots(*ALL_FOUR),
                                         "taken_on": "2026-09-14"})
        assert out["assessment_id"]
        status, history = client.get("/assessments")
        assert status == 200
        assert len(history["assessments"]) == 1
        filed = history["assessments"][0]
        assert filed["taken_on"] == "2026-09-14"
        assert filed["views"] == [v.value for v in ALL_FOUR]

    def test_the_photographs_are_not_in_what_was_kept(self, coach, stubbed):
        client, _, _ = coach
        stubbed(script_for(*ALL_FOUR))
        client.post("/intake", {"photos": shots(*ALL_FOUR)})
        _, history = client.get("/assessments")
        assert "data:image" not in repr(history)

    def test_a_set_where_nothing_could_be_measured_is_not_filed(self, coach,
                                                                stubbed):
        """A set to retake is not a point on a chart."""
        client, _, _ = coach
        stubbed([None])
        _, out = client.post("/intake", {"photos": shots(View.FRONT)})
        assert out["assessment_id"] is None
        assert client.get("/assessments")[1]["assessments"] == []

    def test_filing_can_be_declined(self, coach, stubbed):
        client, _, _ = coach
        stubbed(script_for(View.FRONT))
        _, out = client.post("/intake", {"photos": shots(View.FRONT),
                                         "save": False})
        assert out["assessment_id"] is None

    def test_a_withheld_score_is_left_out_of_the_trend_not_plotted_as_zero(
            self, coach, stubbed):
        """A chart with a cliff where there was no measurement invents one."""
        client, _, _ = coach
        stubbed([sparse(View.SIDE_LEFT)])
        _, out = client.post("/intake", {"photos": shots(View.SIDE_LEFT)})
        assert out["score"]["value"] is None, out["score"]["withheld_reason"]
        _, history = client.get("/assessments")
        assert history["assessments"][0]["score"] is None
        assert history["trend"] == []

    def test_the_trend_runs_oldest_first(self, coach, stubbed):
        client, _, _ = coach
        for day in ("2026-01-10", "2026-03-10", "2026-06-10"):
            stubbed(script_for(*ALL_FOUR))
            client.post("/intake", {"photos": shots(*ALL_FOUR),
                                    "taken_on": day})
        _, history = client.get("/assessments")
        assert [p["on"] for p in history["trend"]] == [
            "2026-01-10", "2026-03-10", "2026-06-10"]
        assert [a["taken_on"] for a in history["assessments"]][0] == "2026-06-10"

    def test_a_coach_may_not_read_somebody_else_s_history(self, coach, stubbed):
        client, names, _ = coach
        stubbed([])
        assert client.get(f"/assessments?username={names['ben']}")[0] == 403

    def test_a_signed_out_visitor_reads_none(self, studio):  # noqa: F811
        base, _, _ = studio
        assert Client(base).get("/assessments")[0] in (401, 403)


class TestComparingTwoVisits:
    def one(self, client, stubbed, day, tilt):
        stubbed([standing(shoulder_tilt=tilt, cx=540),
                 side_on(facing_image_left=False, ear_ahead=40.0, cx=540),
                 side_on(facing_image_left=True, ear_ahead=40.0, cx=540),
                 standing(facing="rear", shoulder_tilt=tilt, cx=540)])
        _, out = client.post("/intake", {"photos": shots(*ALL_FOUR),
                                         "taken_on": day})
        return out["assessment_id"]

    def test_two_visits_are_compared_metric_by_metric(self, coach, stubbed):
        client, _, _ = coach
        first = self.one(client, stubbed, "2026-01-10", 11.0)
        second = self.one(client, stubbed, "2026-06-10", 4.0)
        status, out = client.post("/assessment/compare",
                                  {"before": first, "after": second})
        assert status == 200
        change = out["changes"]["shoulder_tilt"]
        assert change["comparable"] and change["toward_neutral"] is True
        assert change["absolute"] < 0

    def test_the_comparison_carries_the_dates_and_the_names(self, coach,
                                                            stubbed):
        client, _, _ = coach
        first = self.one(client, stubbed, "2026-01-10", 11.0)
        second = self.one(client, stubbed, "2026-06-10", 4.0)
        _, out = client.post("/assessment/compare",
                             {"before": first, "after": second})
        assert out["before_on"] == "2026-01-10"
        assert out["after_on"] == "2026-06-10"
        assert out["names"]["shoulder_tilt"]["ko"]
        assert "judgement for the person teaching" in out["note"]
        assert out["note_ko"]

    def test_a_metric_missing_from_one_visit_is_not_a_result(self, coach,
                                                             stubbed):
        client, _, _ = coach
        first = self.one(client, stubbed, "2026-01-10", 11.0)
        stubbed(script_for(View.FRONT))
        _, only = client.post("/intake", {"photos": shots(View.FRONT),
                                          "taken_on": "2026-06-10"})
        _, out = client.post("/assessment/compare",
                             {"before": first, "after": only["assessment_id"]})
        assert out["changes"]["shoulder_tilt"]["comparable"]
        assert not out["changes"]["forward_head"]["comparable"]

    @pytest.mark.parametrize("payload", [
        {}, {"before": 1}, {"after": 1}, {"before": "x", "after": "y"}])
    def test_a_malformed_request_is_refused(self, coach, stubbed, payload):
        client, _, _ = coach
        stubbed([])
        assert client.post("/assessment/compare", payload)[0] == 400

    def test_an_assessment_that_is_not_there_is_a_404(self, coach, stubbed):
        client, _, _ = coach
        stubbed([])
        assert client.post("/assessment/compare",
                           {"before": 9001, "after": 9002})[0] == 404

    def test_somebody_else_s_assessment_cannot_be_compared_in(self, coach,
                                                              stubbed):
        """Two people's alignment compared as one person's progress would look
        exactly right and be nonsense."""
        client, names, _ = coach
        mine = self.one(client, stubbed, "2026-01-10", 11.0)
        assert client.post("/roster/add", {"student": names["ann"]})[0] == 200
        stubbed(script_for(*ALL_FOUR))
        _, theirs = client.post("/intake", {"photos": shots(*ALL_FOUR),
                                            "username": names["ann"]})
        status, out = client.post("/assessment/compare",
                                  {"before": mine,
                                   "after": theirs["assessment_id"]})
        assert status == 400 and "different people" in out["error"]


class TestReopeningAFiledAssessment:
    """The reason filing them is worth anything.

    Without this an assessment could be listed and never read again: a date
    and a score on a strip, with the seventeen measurements behind them
    reachable only by whoever had the tab open on the day.
    """

    def _filed(self, client, names, stubbed):
        stubbed(script_for(*ALL_FOUR))
        status, out = client.post("/intake", {
            "photos": shots(*ALL_FOUR), "username": names["ann"],
            "taken_on": "2026-09-14"})
        assert status == 200 and out["assessment_id"]
        return out

    def test_a_filed_assessment_opens_again_in_full(self, coach, stubbed):
        client, names, _ = coach
        assert client.post("/roster/add", {"student": names["ann"]})[0] == 200
        first = self._filed(client, names, stubbed)

        status, again = client.get(f"/assessment?id={first['assessment_id']}")
        assert status == 200
        assert again["assessment"]["readings"]
        assert set(again["assessment"]["readings"]) == set(
            first["assessment"]["readings"])

    def test_it_carries_the_findings_and_the_plan_not_only_the_numbers(
            self, coach, stubbed):
        client, names, _ = coach
        assert client.post("/roster/add", {"student": names["ann"]})[0] == 200
        first = self._filed(client, names, stubbed)
        _, again = client.get(f"/assessment?id={first['assessment_id']}")
        assert again["findings"]
        assert again["priorities"]
        assert again["disclaimer"]

    def test_the_score_is_recomputed_rather_than_replayed(self, coach, stubbed):
        """A saved verdict would drift from the live one the moment a band
        moved, and two visits would disagree about a body that had not."""
        client, names, _ = coach
        assert client.post("/roster/add", {"student": names["ann"]})[0] == 200
        first = self._filed(client, names, stubbed)
        _, again = client.get(f"/assessment?id={first['assessment_id']}")
        assert again["score"]["value"] == first["score"]["value"]
        assert again["score"]["band"] == first["score"]["band"]

    def test_the_landmarks_come_back_so_the_outlines_redraw(self, coach, stubbed):
        client, names, _ = coach
        assert client.post("/roster/add", {"student": names["ann"]})[0] == 200
        first = self._filed(client, names, stubbed)
        _, again = client.get(f"/assessment?id={first['assessment_id']}")
        assert set(again["landmarks"]) == set(first["landmarks"])
        for view, stored in again["landmarks"].items():
            assert len(stored["keypoints"]) == 17

    def test_the_photographs_do_not_come_back_and_it_says_so(self, coach,
                                                             stubbed):
        """They were measured and dropped. A reader who expected their
        photograph deserves a sentence, not four black rectangles."""
        client, names, _ = coach
        assert client.post("/roster/add", {"student": names["ann"]})[0] == 200
        first = self._filed(client, names, stubbed)
        _, again = client.get(f"/assessment?id={first['assessment_id']}")
        assert again["from_file"] is True
        assert "image" not in repr(again)
        assert "base64" not in repr(again)

    def test_the_day_it_was_taken_comes_back_not_the_day_it_is_read(
            self, coach, stubbed):
        client, names, _ = coach
        assert client.post("/roster/add", {"student": names["ann"]})[0] == 200
        first = self._filed(client, names, stubbed)
        _, again = client.get(f"/assessment?id={first['assessment_id']}")
        assert again["taken_on"] == "2026-09-14"

    def test_an_assessment_that_is_not_there(self, coach):
        client, _, _ = coach
        assert client.get("/assessment?id=99999")[0] == 404

    def test_an_id_that_is_not_a_number(self, coach):
        client, _, _ = coach
        assert client.get("/assessment?id=banana")[0] == 400

    def test_somebody_else_s_assessment_is_refused(self, studio, stubbed):  # noqa: F811
        """Being at the same studio is not permission to read a body."""
        base, names, _ = studio
        coach_client = Client(base)
        coach_client.sign_in("coach@b.co")
        assert coach_client.post("/roster/add", {"student": names["ann"]})[0] == 200
        stubbed(script_for(View.FRONT))
        _, filed = coach_client.post("/intake", {
            "photos": shots(View.FRONT), "username": names["ann"]})

        student = Client(base)
        student.sign_in("ben@b.co")
        assert student.get(f"/assessment?id={filed['assessment_id']}")[0] == 403

    def test_a_stranger_is_refused(self, studio, stubbed):  # noqa: F811
        base, names, _ = studio
        coach_client = Client(base)
        coach_client.sign_in("coach@b.co")
        assert coach_client.post("/roster/add", {"student": names["ann"]})[0] == 200
        stubbed(script_for(View.FRONT))
        _, filed = coach_client.post("/intake", {
            "photos": shots(View.FRONT), "username": names["ann"]})
        assert Client(base).get(f"/assessment?id={filed['assessment_id']}")[0] == 401
