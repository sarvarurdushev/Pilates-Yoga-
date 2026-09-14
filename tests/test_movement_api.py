"""The movement screening, over HTTP, where the permission rules have to hold.

The measurement is tested in ``test_screening.py``. What matters here is the
boundary: that landmarks go in and ranges come back, that nothing which could
rebuild a picture of anybody crosses the line, that a malformed recording is
refused rather than half understood, and that being at the same studio is not
permission to screen somebody's body.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))

from pilates import screening as sc  # noqa: E402
from pilates.alignment import View  # noqa: E402
from test_api import Client, studio  # noqa: E402,F401  (studio is a fixture)
from test_screening import body, raises  # noqa: E402


def frames(history) -> dict:
    """One side's recording, in the shape the browser sends it."""
    return {"times": [s.timestamp for s in history.samples],
            "frames": [{"keypoints": [[0.0, 0.0]] * 17,
                        "scores": [0.0] * 17} for s in history.samples]}


def recording(peak: float, joint: str = "shoulder", side: str = "left",
              step: int = 1) -> dict:
    """A real recording: the landmarks a clip of this movement would produce.

    ``step`` thins the frames, for the case that needs a clip too long to
    accept rather than one too short to measure.
    """
    history = raises(peak, joint=joint, side=side)
    samples = history.samples[::step]
    return {
        "times": [round(i / 30.0, 4) for i in range(len(samples))],
        "frames": [{"keypoints": det.keypoints.round(2).tolist(),
                    "scores": det.scores.round(3).tolist()}
                   for det in _details(peak, joint, side, len(samples))],
    }


def _details(peak: float, joint: str, side: str, count: int) -> list:
    import math
    out = []
    for i in range(count):
        phase = (1.0 - math.cos(2 * math.pi * i / 40)) / 2.0
        out.append(body(**{f"{side}_{joint}": peak * phase}))
    return out


def clip(peak_left: float, peak_right: float, joint: str = "shoulder",
         view: str = "side_left") -> dict:
    return {"view": view,
            "left": recording(peak_left, joint, "left"),
            "right": recording(peak_right, joint, "right")}


@pytest.fixture
def coach(studio):  # noqa: F811
    """A coach with one student on their roster, which is the permission."""
    base, names, db = studio
    client = Client(base)
    client.sign_in("coach@b.co")
    status, _ = client.post("/roster/add", {"student": names["ann"]})
    assert status == 200
    return client, names, db


def post(client, path, payload, expect=200):
    """POST and assert the status, so a failure names the body it got."""
    status, body = client.post(path, payload)
    assert status == expect, f"{path} -> {status}: {body}"
    return body


def get(client, path, expect=200):
    status, body = client.get(path)
    assert status == expect, f"{path} -> {status}: {body}"
    return body


class TestTheBoundary:
    def test_landmarks_go_in_and_ranges_come_back(self, coach):
        client, names, _ = coach
        out = post(client, "/movement", {
            "username": names["ann"], "taken_on": "2026-09-14",
            "clips": {"shoulder_flexion": clip(120.0, 170.0)}})
        left = out["results"]["shoulder_flexion"]["left"]
        assert left["peak"]["value"] == pytest.approx(120.0, abs=6.0)
        assert left["peak"]["unit"] == "deg"

    def test_no_landmark_of_anybody_comes_back(self, coach):
        """The recording is measured and dropped. What is kept is the numbers,
        and a response that echoed the frames would put a frame-by-frame shape
        of somebody's body back on the wire for no reason."""
        client, names, _ = coach
        out = post(client, "/movement", {
            "username": names["ann"],
            "clips": {"shoulder_flexion": clip(150.0, 150.0)}})
        # A count of frames is a fact about the recording. A list of
        # seventeen points per frame is the shape of somebody's body, and
        # putting it back on the wire would undo the whole boundary.
        assert "keypoints" not in repr(out)
        assert "scores" not in repr(out)
        assert out["results"]["shoulder_flexion"]["left"]["frames"] > 0

    def test_the_two_sides_are_reported_apart(self, coach):
        client, names, _ = coach
        out = post(client, "/movement", {
            "username": names["ann"],
            "clips": {"shoulder_flexion": clip(110.0, 170.0)}})
        result = out["results"]["shoulder_flexion"]
        assert result["asymmetry"]["value"] == pytest.approx(60.0, abs=8.0)
        assert result["shorter_side"] == "left"

    def test_the_catalogue_travels_so_a_studio_knows_what_to_film(self, coach):
        client, names, _ = coach
        out = post(client, "/movement", {
            "username": names["ann"],
            "clips": {"shoulder_flexion": clip(150.0, 150.0)}})
        keys = {s["key"] for s in out["catalogue_detail"]}
        assert keys == set(sc.SCREENS)
        for entry in out["catalogue_detail"]:
            assert entry["instruction"] and entry["instruction_ko"]
            assert entry["reference_source"]

    def test_the_disclaimer_is_the_movement_one_not_the_photograph_one(self, coach):
        client, names, _ = coach
        out = post(client, "/movement", {
            "username": names["ann"],
            "clips": {"shoulder_flexion": clip(150.0, 150.0)}})
        assert "goniometer" in out["disclaimer"]
        assert "각도계" in out["disclaimer_ko"]


class TestRefusingBadRequests:
    def test_no_clips_at_all(self, coach):
        client, names, _ = coach
        out = post(client, "/movement", {"username": names["ann"],
                                        "clips": {}}, expect=400)
        assert "at least one screen" in out["error"]

    def test_a_screen_nobody_has_heard_of(self, coach):
        client, names, _ = coach
        out = post(client, "/movement", {
            "username": names["ann"],
            "clips": {"backflip": clip(150.0, 150.0)}}, expect=400)
        assert "unknown screen" in out["error"]

    def test_a_view_nobody_has_heard_of(self, coach):
        client, names, _ = coach
        out = post(client, "/movement", {
            "username": names["ann"],
            "clips": {"shoulder_flexion": clip(150.0, 150.0, view="sideways")},
        }, expect=400)
        assert "unknown view" in out["error"]

    def test_a_recording_with_no_frames(self, coach):
        client, names, _ = coach
        out = post(client, "/movement", {
            "username": names["ann"],
            "clips": {"shoulder_flexion": {
                "view": "side_left",
                "left": {"times": [], "frames": []}}}}, expect=400)
        assert "frames" in out["error"]

    def test_one_timestamp_per_frame_or_none(self, coach):
        client, names, _ = coach
        good = recording(150.0)
        out = post(client, "/movement", {
            "username": names["ann"],
            "clips": {"shoulder_flexion": {
                "view": "side_left",
                "left": {"times": good["times"][:3],
                         "frames": good["frames"]}}}}, expect=400)
        assert "one timestamp per frame" in out["error"]

    def test_a_frame_that_is_not_seventeen_points(self, coach):
        client, names, _ = coach
        out = post(client, "/movement", {
            "username": names["ann"],
            "clips": {"shoulder_flexion": {
                "view": "side_left",
                "left": {"times": [0.0],
                         "frames": [{"keypoints": [[1.0, 2.0]],
                                     "scores": [0.5]}]}}}}, expect=400)
        assert "17 keypoints" in out["error"]

    def test_a_screen_sent_with_nothing_in_it(self, coach):
        client, names, _ = coach
        out = post(client, "/movement", {
            "username": names["ann"],
            "clips": {"shoulder_flexion": {"view": "side_left"}}}, expect=400)
        assert "no recording" in out["error"]

    def test_a_clip_longer_than_any_screen_needs(self, coach):
        client, names, _ = coach
        long = recording(150.0)
        n = 2000
        long["times"] = [i / 60.0 for i in range(n)]
        long["frames"] = (long["frames"] * (n // len(long["frames"]) + 1))[:n]
        out = post(client, "/movement", {
            "username": names["ann"],
            "clips": {"shoulder_flexion": {"view": "side_left",
                                           "left": long}}}, expect=400)
        assert "at most" in out["error"]


class TestWhoMayScreenWhom:
    def test_a_student_may_screen_themselves(self, studio):  # noqa: F811
        base, names, _ = studio
        client = Client(base)
        client.sign_in("ann@b.co")
        out = post(client, "/movement", {
            "clips": {"shoulder_flexion": clip(150.0, 150.0)}})
        assert out["results"]["shoulder_flexion"]["left"]["peak"]["value"]

    def test_being_at_the_same_studio_is_not_permission(self, studio):  # noqa: F811
        base, names, _ = studio
        client = Client(base)
        client.sign_in("ann@b.co")
        post(client, "/movement", {
            "username": names["ben"],
            "clips": {"shoulder_flexion": clip(150.0, 150.0)}}, expect=403)

    def test_a_stranger_is_refused(self, studio):  # noqa: F811
        base, names, _ = studio
        post(Client(base), "/movement", {
            "clips": {"shoulder_flexion": clip(150.0, 150.0)}}, expect=401)


class TestFilingAndComparing:
    def test_a_screening_is_filed_against_the_person(self, coach):
        client, names, _ = coach
        out = post(client, "/movement", {
            "username": names["ann"], "taken_on": "2026-09-14",
            "clips": {"shoulder_flexion": clip(120.0, 120.0)}})
        assert out["screening_id"]
        history = get(client, f"/screenings?username={names['ann']}")
        assert history["screenings"][0]["id"] == out["screening_id"]
        assert history["screenings"][0]["taken_on"] == "2026-09-14"

    def test_a_screening_with_nobody_attached_is_not_filed(self, coach):
        """A row that grows and is never read, because it can be compared
        with nothing."""
        client, _, _ = coach
        out = post(client, "/movement", {
            "save": False,
            "clips": {"shoulder_flexion": clip(120.0, 120.0)}})
        assert out["screening_id"] is None

    def test_two_screenings_are_compared(self, coach):
        client, names, _ = coach
        first = post(client, "/movement", {
            "username": names["ann"], "taken_on": "2026-08-01",
            "clips": {"shoulder_flexion": clip(120.0, 120.0)}})
        second = post(client, "/movement", {
            "username": names["ann"], "taken_on": "2026-09-14",
            "clips": {"shoulder_flexion": clip(160.0, 160.0)}})
        out = post(client, "/movement/compare",
                          {"before": first["screening_id"],
                           "after": second["screening_id"]})
        left = [c for c in out["changes"] if c["side"] == "left"][0]
        assert left["difference"] == pytest.approx(40.0, abs=8.0)
        assert "judgement for the person teaching" in out["judgement"]

    def test_two_people_are_never_compared_as_one_person(self, coach):
        """It would look right, which is what makes it the worst thing this
        endpoint could produce."""
        client, names, _ = coach
        assert client.post("/roster/add", {"student": names["ben"]})[0] == 200
        mine = post(client, "/movement", {
            "username": names["ann"],
            "clips": {"shoulder_flexion": clip(120.0, 120.0)}})
        theirs = post(client, "/movement", {
            "username": names["ben"],
            "clips": {"shoulder_flexion": clip(160.0, 160.0)}})
        out = post(client, "/movement/compare",
                          {"before": mine["screening_id"],
                           "after": theirs["screening_id"]}, expect=400)
        assert "different people" in out["error"]

    def test_a_screening_that_is_not_there(self, coach):
        client, _, _ = coach
        post(client, "/movement/compare", {"before": 9999, "after": 9998},
                    expect=404)

    def test_the_history_leaves_a_withheld_score_off_the_trend(self, coach):
        """A chart with a cliff in it where there was no measurement is a
        chart that invents a collapse."""
        client, names, _ = coach
        post(client, "/movement", {
            "username": names["ann"], "taken_on": "2026-09-14",
            "clips": {"shoulder_flexion": clip(120.0, 120.0)}})
        history = get(client, f"/screenings?username={names['ann']}")
        for point in history["trend"]:
            assert point["score"] is not None

    def test_a_screening_is_erased_with_the_person(self, coach):
        client, names, db = coach
        post(client, "/movement", {
            "username": names["ann"],
            "clips": {"shoulder_flexion": clip(120.0, 120.0)}})
        from pilates.store import Store
        with Store.open(db) as store:
            assert store.screenings(names["ann"])
            gone = store.forget(names["ann"])
        assert gone["movement_screenings"] == 1


class TestTurningAClipIntoNumbers:
    """The route a screening needs, and the promise it has to keep.

    A screening is two clips measured together -- one per side -- so something
    has to turn each into numbers before either can be measured. A server that
    held the first clip until the second arrived would be storing video of
    somebody's body for as long as it took them to turn around, which is the
    one thing this project says it does not do.
    """

    def test_the_server_says_whether_it_can_screen(self, coach):
        client, _, _ = coach
        assert get(client, "/capabilities")["screening"] is True

    def test_the_route_is_there_and_asks_for_a_clip(self, coach):
        client, _, _ = coach
        status, body = client._open(_upload(client, b""))
        assert status == 400 and "no clip" in body["error"]

    def test_a_clip_too_large_is_refused_by_its_length(self, coach):
        """Refused on the header rather than after reading it: a server that
        has to receive a file to decide it is too big has already received
        it."""
        from pilates.serve import MAX_UPLOAD_BYTES
        client, _, _ = coach
        request = _upload(client, b"x")
        request.add_header("Content-Length", str(MAX_UPLOAD_BYTES + 1))
        status, body = client._open(request)
        assert status == 413 and "limit" in body["error"]


def _upload(client, data, query="", path="/landmarks"):
    import urllib.request
    return urllib.request.Request(
        f"{client.base}{path}{query}", method="POST", data=data,
        headers={"Content-Type": "application/octet-stream",
                 "X-Filename": "clip.mp4"})
