"""Workflow regressions. Synthetic geometry proves contracts, not CV accuracy."""

import base64
import copy
import threading
import numpy as np
import pytest
from pilates import assessment as ev, pose3d
from pilates.types import Detection
from pilates.serve import serve, WEB
from pilates.store import Store
from test_alignment import standing, side_on
from test_api import Client
from test_intake_api import png


def assessed(d=None, **kw):
    return ev.assess_person(d or standing(), 800, 900, **kw)


@pytest.mark.parametrize("joint", [0, 5, 6, 11, 12, 13, 14, 15, 16])
def test_missing_core_never_becomes_a_scored_report(joint):
    d = standing()
    s = d.scores.copy()
    s[joint] = 0
    if joint == 0:
        s[:5] = 0
    p = assessed(Detection(d.keypoints, s))
    assert not p["suitable"] and p["score"]["value"] is None
    assert all(
        m["value"] is None and m["status"] == "unavailable" for m in p["metrics"]
    )


def test_out_of_frame_hallucination_with_high_scores_refused():
    p = ev.assess_person(standing(), 400, 350)
    assert not p["suitable"] and p["score"]["value"] is None


def test_nominal_geometry_does_not_override_distant_model_resolution():
    p = assessed(inference_scale=0.1)
    assert not p["suitable"] and "model resolution" in " ".join(
        p["validation"]["reasons"]
    )


def test_side_has_no_frontal_symmetry_score():
    p = assessed(side_on(), view="side_right")
    assert p["suitable"]
    assert next(m for m in p["metrics"] if m["id"] == "shoulder_tilt")["value"] is None
    assert p["score"]["value"] is None


def test_user_view_cannot_override_obvious_camera_plane():
    assert not assessed(view="side_right")["suitable"]


def test_rotation_can_be_floor_pose_but_not_standing():
    d = standing()
    p = d.keypoints.copy()
    p = np.stack([p[:, 1], 800 - p[:, 0]], axis=1)
    d = Detection(p, d.scores)
    assert assessed(d, mode="pose")["suitable"]
    assert not assessed(d, mode="standing")["suitable"]


def test_real_depth_is_unavailable_without_model(monkeypatch):
    monkeypatch.delenv("PILATES_3D_MODEL", raising=False)
    p = pose3d.estimate(np.zeros((900, 800, 3), np.uint8), standing())
    assert p["joints"] is None and p["status"] == "unavailable"


@pytest.mark.parametrize(
    "times,values",
    [
        ([0, 0], [1, 2]),
        ([0, float("nan")], [1, 2]),
        ([0, 1], [1, float("inf")]),
        ([0, 1], [1]),
    ],
)
def test_nonfinite_or_invalid_time_series_refused(times, values):
    with pytest.raises(ValueError):
        ev.analyse_series(times, values)


def test_no_repetition_can_bridge_an_unobserved_interval():
    times = np.arange(0, 6, 0.1).tolist()
    values = [90 - 70 * np.cos(t * 2 * np.pi / 2) for t in times]
    full = ev.analyse_series(times, values)
    assert full["repetitions"] >= 1 and full["tempo_s"] == pytest.approx(2, abs=0.3)
    for i, t in enumerate(times):
        if 0.8 < t < 1.3 or 2.8 < t < 3.3 or 4.8 < t < 5.3:
            values[i] = None
    split = ev.analyse_series(times, values)
    assert split["repetitions"] == 0 and split["continuous_segments"] >= 3


def test_people_are_measured_independently():
    detections = [standing(cx=150 + 200 * i) for i in range(5)]
    detections[-1].scores[15:] = 0
    out = ev.photo(
        {"image": png(1200, 1000), "include_3d": False}, backend=lambda f: detections
    )
    assert len(out["people"]) == 5
    assert sum(p["suitable"] for p in out["people"]) == 4
    assert len({p["person_id"] for p in out["people"]}) == 5


def test_comparison_uses_persisted_measurements_and_matched_subject(tmp_path):
    with Store.open(tmp_path / "db") as store:
        a = {
            "kind": "photo",
            "version": ev.VERSION,
            "created_at": "2026-01-01",
            "people": [assessed()],
        }
        b = copy.deepcopy(a)
        b["people"][0]["metrics"][1]["value"] = 5
        x = ev.record(store, a, "Alex")
        y = ev.record(store, b, "Alex")
        result = ev.compare(store, x, y, "1", "1")
        assert result["comparable"]
        assert (
            next(
                c for c in result["changes"] if c["name"] == "Shoulder height asymmetry"
            )["delta"]
            == 5
        )
        z = ev.record(store, b, "Blair")
        bad = ev.compare(store, x, z, "1", "1")
        assert (
            not bad["comparable"] and not bad["changes"] and bad["score_delta"] is None
        )
        with pytest.raises(ValueError):
            ev.save(store, b)


def test_video_comparison_requires_same_exercise_and_view(tmp_path):
    person = {
        "person_id": "1",
        "suitable": True,
        "signals": {},
        "score": {"value": None},
    }
    with Store.open(tmp_path / "db") as store:
        a = {
            "kind": "video",
            "version": ev.VERSION,
            "created_at": "2026-01-01",
            "view": "auto",
            "people": [person],
        }
        x = ev.record(store, a, "Alex")
        y = ev.record(store, a, "Alex")
        assert not ev.compare(store, x, y, "1", "1")["comparable"]
        a.update(view="front", protocol="5 shoulder raises")
        x = ev.record(store, a, "Alex")
        y = ev.record(store, a, "Alex")
        assert ev.compare(store, x, y, "1", "1")["comparable"]


@pytest.mark.mvp
def test_mvp_opens_and_analyses_without_session_and_preserves_legacy_routes(
    tmp_path, monkeypatch
):
    monkeypatch.setattr("pilates.api.pose_backend", lambda: lambda frame: [standing()])
    server, url = serve(None, root=WEB, port=0, analyse=True, db=str(tmp_path / "db"))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    client = Client(url.split("/index.html")[0])
    try:
        assert client.get("/auth/me")[1]["accounts"] is False
        assert client.get("/evidence/capabilities")[0] == 200
        status, report = client.post(
            "/evidence/photo",
            {"image": png(800, 900), "include_3d": False, "subject": "Test"},
        )
        assert status == 200 and report["people"][0]["suitable"]
        assert (
            report["assessment_id"]
            == client.get("/evidence/history")[1]["assessments"][0]["id"]
        )
        assert client.get("/assessments")[0] != 404
    finally:
        server.shutdown()
        server.server_close()


def test_new_shared_workspace_is_not_exposed_in_auth_mode(tmp_path):
    server, url = serve(None, root=WEB, port=0, analyse=True, db=str(tmp_path / "db"))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        assert Client(url.split("/index.html")[0]).get("/evidence/history")[0] == 401
    finally:
        server.shutdown()
        server.server_close()


def test_tiling_fragment_merges_without_merging_neighbouring_people():
    from pilates.validation import suppress_fragments

    full = standing()
    partial = standing()
    partial.scores[7:] = 0
    near = standing(cx=330)
    result = suppress_fragments([partial, near, full])
    assert len(result) == 2
    assert sum(np.count_nonzero(p.scores >= 0.5) == 17 for p in result) == 2


def test_video_pipeline_runs_on_decoded_frames_without_inventing_cycles(tmp_path):
    import cv2

    path = tmp_path / "clip.avi"
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"MJPG"), 6, (800, 900))
    for _ in range(18):
        writer.write(np.zeros((900, 800, 3), np.uint8))
    writer.release()
    r = ev.video(path, backend=lambda f: [standing()], view="front", protocol="hold")
    assert r["tracking"]["stable"] and r["people"][0]["suitable"]
    assert r["duration"] == 3
    assert all(s.get("repetitions", 0) == 0 for s in r["people"][0]["signals"].values())


def test_isolated_wrong_leg_sample_cannot_create_a_repetition():
    times = np.arange(0, 6, 0.1666667).tolist()
    values = [150.0] * len(times)
    values[0] = 2.0
    values[12] = 3.0
    # The person then lowers the raised leg once; there is no complete cycle.
    values[-4:] = [120.0, 60.0, 2.0, 1.0]
    report = ev.analyse_series(times, values)
    assert report["repetitions"] == 0
    assert report["rejected_spikes"] == 2
    assert report["raw_series"][12][1] == 3.0
    assert report["series"][12][1] is None


def test_screening_keeps_sustained_transitions():
    values = [10.0] * 10 + [100.0] * 10
    assert ev.screen_spikes(np.arange(20) / 6, values) == values


def test_excessive_isolated_jumps_refuse_the_signal():
    times = np.arange(0, 6, 0.1).tolist()
    values = [150.0 if i % 3 else 1.0 for i in range(len(times))]
    assert ev.analyse_series(times, values)["status"] == "unavailable"
