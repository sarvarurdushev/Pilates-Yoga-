"""Featured fictional journeys retain exact, view-specific simulated evidence."""

import math

import numpy as np

from pilates.assessment import assess_person
from pilates.platform.designer import versions
from pilates.platform.repository import Repository
from pilates.platform.seed import scenario_for
from pilates.types import Detection


PRIMARY_METRIC = {
    0: "shoulder_tilt",
    2: "forward_head",
    3: "pelvic_obliquity",
    4: "trunk_lean_lateral",
}


def metric(person, metric_id):
    return next(row for row in person["metrics"] if row["id"] == metric_id)


def test_featured_histories_save_a_separately_measured_second_camera_view(tmp_path):
    repo = Repository(tmp_path / "camera-demo.db")
    admin = repo.actor(repo.demo_login("e" * 32, "admin"))
    featured = [person for person in repo.people(admin) if person["detail"].get("asset")]
    assert len(featured) == 7

    for person in featured:
        client = repo.client(admin, person["id"])
        reports = [repo.get(admin, "analyses", row["id"]) for row in client["analyses"]]
        reports.sort(key=lambda report: report["detail"]["visit"])
        assert len(reports) == len(client["sessions"]) == 20
        assert {report["detail"]["visit"] for report in reports} == set(range(1, 21))
        assert all(report["protocol"] == "Standing posture" for report in reports[::2])
        assert all(report["kind"] == "movement" for report in reports[1::2])

        primary_view = reports[0]["result"]["views"][0]["view"]
        assert primary_view in {"front", "side_left"}
        assert all(report["result"]["views"][0]["view"] == primary_view for report in reports)
        assert [len(report["result"]["views"]) for report in reports] == [
            2 if visit == 11 else 1 for visit in range(1, 21)
        ]

        midpoint = reports[10]
        first, second = midpoint["result"]["views"]
        assert {first["view"], second["view"]} == {"front", "side_left"}
        assert first.get("media_id") and not second.get("media_id")
        assert second["report"]["source"] == "Explicit alternate-view demo coordinate simulation"
        assert second["report"]["people"][0]["suitable"] is True
        original_landmarks = first["report"]["people"][0]["landmarks"]
        alternate_person = second["report"]["people"][0]
        alternate_landmarks = alternate_person["landmarks"]
        assert alternate_landmarks["keypoints"] != original_landmarks["keypoints"]

        # Recalculate with the declared view. This catches a relabelled front
        # skeleton whose archived values were never measured side-on (or vice
        # versa). The generated client photograph is deliberately not attached
        # to this synthetic second view.
        recomputed = assess_person(
            Detection(np.asarray(alternate_landmarks["keypoints"]),
                      np.asarray(alternate_landmarks["scores"])),
            1000, 960, person_id="1", view=second["view"], mode="standing",
        )
        assert [(row["id"], row["value"], row["status"]) for row in recomputed["metrics"]] == [
            (row["id"], row["value"], row["status"]) for row in alternate_person["metrics"]
        ]
        assert all(row["source"] == "Explicit parametric demo landmarks"
                   for view in midpoint["result"]["views"]
                   for row in view["report"]["people"][0]["metrics"])
        assert {row["view"] for row in repo.coordinates(admin, midpoint["id"])} == {"front", "side_left"}
        assert any(midpoint["id"] in visit["analysis_ids"] for visit in client["sessions"])

        # The primary-view ten-point posture series remains comparable within
        # its own camera/protocol. Each fictional trend varies, has a small
        # temporary reversal, and stays bounded rather than claiming perfect
        # linear improvement or a clinical reference range.
        metric_id = PRIMARY_METRIC[scenario_for(int(person["id"][-2:]))]
        values = [metric(report["result"]["views"][0]["report"]["people"][0], metric_id)["value"]
                  for report in reports[::2]]
        assert all(math.isfinite(value) for value in values)
        assert len(set(values)) >= 4 and values[-1] < values[0]
        changes = [after - before for before, after in zip(values, values[1:])]
        assert any(change > 0 for change in changes) and any(change < 0 for change in changes)
        assert max(abs(change) for change in changes) < max(values) - min(values)

        assigned = next(entry for entry in client["programs"] if entry["active"])
        history = versions(repo, admin, assigned["program_id"])["items"]
        assert {item["snapshot"]["detail"].get("phase") for item in history} >= {
            "Foundation", "Control", "Progression",
        }
        analysis_ids = {report["id"] for report in reports}
        assert all(item["source_id"] in analysis_ids for item in history if item["source_id"])
