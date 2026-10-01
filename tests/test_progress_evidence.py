from copy import deepcopy
import sqlite3

import pytest

from pilates.platform.analysis import publish_progress
from pilates.platform.progress_evidence import (
    progress_evidence,
    selected_progress_measurements,
)
from pilates.platform.repository import Repository, encode, uid

AT = "2026-09-01T10:00:00+00:00"


def saved_source(kind="posture"):
    metric = {
        "id": "shoulder_tilt",
        "name": "Shoulder tilt",
        "value": 4.2,
        "unit": "deg",
        "status": "measured",
        "confidence": 0.93,
    }
    person = {"person_id": 1, "suitable": True, "metrics": [metric]}
    if kind == "movement":
        person["signals"] = {
            "right_shoulder": {
                "status": "estimated",
                "confidence": 0.87,
                "unit": "deg",
                "camera_view": "front",
                "rom": 63.5,
                "tempo_cv": 0.12,
                "rep_rom_sd": 2.3,
                "repetitions": 3,
            }
        }
    return {
        "id": "analysis",
        "student_id": "student",
        "kind": kind,
        "protocol": "Arm raise" if kind == "movement" else "Standing posture",
        "status": "complete",
        "demo": 0,
        "created_at": AT,
        "detail": {},
        "result": {
            "id": "analysis",
            "student_id": "student",
            "kind": kind,
            "synthetic": False,
            "views": [{"view": "front", "report": {"people": [person]}}],
        },
    }


def progress_row(source, metric="shoulder_tilt", value=4.2, unit="deg"):
    return {
        "id": "row",
        "analysis_id": source["id"],
        "student_id": source["student_id"],
        "metric": "front:" + metric,
        "value": value,
        "unit": unit,
        "recorded_at": source["created_at"],
        "demo": source["demo"],
    }


def test_legacy_value_recovers_exact_metric_context_from_saved_payload():
    source = saved_source()
    expected = {
        "authority": "saved_analysis",
        "version": 1,
        "supported": True,
        "analysis_id": "analysis",
        "student_id": "student",
        "kind": "posture",
        "protocol": "Standing posture",
        "demo": False,
        "recorded_at": AT,
        "metric_id": "shoulder_tilt",
        "view": "front",
        "person_id": "1",
        "person_scope": "capture_local",
        "selection": "single_suitable",
        "name": "Shoulder tilt",
        "value": 4.2,
        "unit": "deg",
        "status": "measured",
        "confidence": 0.93,
        "confidence_basis": "saved_metric",
        "reason": "",
    }
    assert progress_evidence(progress_row(source), source) == expected
    assert (
        source["result"]["views"][0]["report"]["people"][0]["metrics"][0]["confidence"]
        == 0.93
    )


@pytest.mark.parametrize(
    "status,confidence,unit,value",
    [
        ("unavailable", 0.93, "deg", 4.2),
        ("refused", 0.93, "deg", 4.2),
        ("measured", None, "deg", 4.2),
        ("measured", 0.649, "deg", 4.2),
        ("measured", 1.1, "deg", 4.2),
        ("measured", True, "deg", 4.2),
        ("measured", 0.93, "", 4.2),
        ("measured", 0.93, "deg", None),
        ("measured", 0.93, "deg", float("nan")),
    ],
)
def test_unsupported_source_does_not_acquire_confidence_from_person(
    status, confidence, unit, value
):
    source = saved_source()
    person = source["result"]["views"][0]["report"]["people"][0]
    person["confidence"] = 0.99
    metric = person["metrics"][0]
    metric.update(status=status, confidence=confidence, unit=unit, value=value)
    evidence = progress_evidence(progress_row(source, value=value, unit=unit), source)
    assert evidence["supported"] is False
    assert evidence["confidence"] == (
        confidence if type(confidence) in (int, float) else None
    )
    assert evidence["status"] == status


@pytest.mark.parametrize(
    "field,value",
    [
        ("value", 4.3),
        ("unit", "ratio"),
        ("recorded_at", "2026-09-02T10:00:00+00:00"),
        ("student_id", "another-client"),
        ("analysis_id", "another-analysis"),
        ("demo", 1),
        ("metric", "back:shoulder_tilt"),
    ],
)
def test_index_must_match_the_authoritative_capture(field, value):
    source = saved_source()
    row = progress_row(source)
    row[field] = value
    assert progress_evidence(row, source)["supported"] is False


@pytest.mark.parametrize(
    "change",
    [
        {"status": "needs_capture"},
        {"protocol": ""},
        {"kind": "movement"},
        {"result_id": "another-analysis"},
        {"result_student_id": "another-client"},
        {"synthetic": True},
    ],
)
def test_saved_source_identity_protocol_status_and_provenance_are_required(change):
    source = saved_source()
    for field, value in change.items():
        if field.startswith("result_"):
            source["result"][field.removeprefix("result_")] = value
        elif field == "synthetic":
            source["result"][field] = value
        else:
            source[field] = value
    assert progress_evidence(progress_row(source), source)["supported"] is False


def test_ambiguous_people_and_stale_review_never_supply_a_legacy_value():
    source = saved_source()
    people = source["result"]["views"][0]["report"]["people"]
    second = deepcopy(people[0])
    second["person_id"] = 2
    second["metrics"][0]["value"] = 8.8
    people.append(second)
    row = progress_row(source)
    assert progress_evidence(row, source)["supported"] is False
    source["detail"] = {"selected_people": {"front": 1}}
    first_evidence = progress_evidence(row, source)
    assert first_evidence["supported"] is True
    assert first_evidence["selection"] == "reviewed"
    source["detail"]["selected_people"]["front"] = 2
    assert progress_evidence(row, source)["supported"] is False
    evidence = progress_evidence(progress_row(source, value=8.8), source)
    assert evidence["supported"] is True and evidence["person_id"] == "2"
    source["detail"]["selected_people"]["front"] = 999
    assert progress_evidence(row, source)["supported"] is False


def test_unsuitable_bystander_still_requires_explicit_subject_review():
    source = saved_source()
    people = source["result"]["views"][0]["report"]["people"]
    bystander = deepcopy(people[0])
    bystander["person_id"] = 2
    bystander["suitable"] = False
    people.append(bystander)
    assert selected_progress_measurements(source["result"], {}) == {}
    assert progress_evidence(progress_row(source), source)["supported"] is False
    source["detail"]["selected_people"] = {"front": 1}
    evidence = progress_evidence(progress_row(source), source)
    assert evidence["supported"] is True
    assert evidence["selection"] == "reviewed"


def test_duplicate_views_people_and_metric_ids_stay_unsupported():
    source = saved_source()
    view = source["result"]["views"][0]
    metric = view["report"]["people"][0]["metrics"][0]
    view["report"]["people"][0]["metrics"].append(deepcopy(metric))
    evidence = progress_evidence(progress_row(source), source)
    assert evidence["supported"] is False
    assert "duplicate measurement IDs" in evidence["reason"]
    source = saved_source()
    source["result"]["views"].append(deepcopy(source["result"]["views"][0]))
    assert selected_progress_measurements(source["result"], {}) == {}
    source = saved_source()
    source["result"]["views"][0]["report"]["people"] *= 2
    assert (
        selected_progress_measurements(
            source["result"], {"selected_people": {"front": 1}}
        )
        == {}
    )


def test_movement_values_use_their_saved_signal_confidence_and_status():
    source = saved_source("movement")
    expected = {
        "right_shoulder_rom": (63.5, "deg"),
        "right_shoulder_tempo_cv": (0.12, "ratio"),
        "right_shoulder_rep_rom_sd": (2.3, "deg"),
        "right_shoulder_repetitions": (3, "cycles"),
    }
    evidence = [
        progress_evidence(progress_row(source, metric, value, unit), source)
        for metric, (value, unit) in expected.items()
    ]
    assert all(item["supported"] for item in evidence)
    assert {
        (
            item["metric_id"],
            item["value"],
            item["unit"],
            item["confidence"],
            item["status"],
            item["person_id"],
        )
        for item in evidence
    } == {
        (metric, value, unit, 0.87, "estimated", "1")
        for metric, (value, unit) in expected.items()
    }
    signal = source["result"]["views"][0]["report"]["people"][0]["signals"][
        "right_shoulder"
    ]
    signal.pop("confidence")
    source["result"]["views"][0]["report"]["people"][0]["confidence"] = 0.99
    assert all(
        not item["supported"] and item["confidence"] is None
        for item in selected_progress_measurements(source["result"], {}).values()
    )


@pytest.mark.parametrize("field,value", [("camera_view", "back"), ("unit", "ratio")])
def test_movement_signal_cannot_disagree_with_its_saved_view_or_angle_unit(
    field, value
):
    source = saved_source("movement")
    source["result"]["views"][0]["report"]["people"][0]["signals"]["right_shoulder"][
        field
    ] = value
    assert not any(
        item["supported"]
        for item in selected_progress_measurements(source["result"], {}).values()
    )


def test_publish_and_rereview_remove_unsupported_values_and_auto_observations():
    db = sqlite3.connect(":memory:")
    db.execute(
        "CREATE TABLE p_progress_records(id,student_id,analysis_id,metric,value,unit,recorded_at,demo)"
    )
    db.execute(
        "CREATE TABLE p_observations(id,student_id,analysis_id,region_id,side,kind,text,source,created_at)"
    )
    source = saved_source()
    publish_progress(db, "analysis", "student", source["result"], {}, AT, False)
    assert db.execute(
        "SELECT metric,value,unit FROM p_progress_records"
    ).fetchall() == [("front:shoulder_tilt", 4.2, "deg")]
    assert db.execute("SELECT count(*) FROM p_observations").fetchone()[0] == 1
    source["result"]["views"][0]["report"]["people"][0]["metrics"][0].pop("confidence")
    publish_progress(db, "analysis", "student", source["result"], {}, AT, False)
    assert db.execute("SELECT count(*) FROM p_progress_records").fetchone()[0] == 0
    assert db.execute("SELECT count(*) FROM p_observations").fetchone()[0] == 0


def test_client_dto_resolves_legacy_payloads_without_backfilling_or_rewriting_rows(
    tmp_path,
):
    repo = Repository(tmp_path / "evidence.db")
    actor = repo.actor(
        repo.create_org(
            "Evidence studio", "evidence@test.example", "strong-password-here", "Admin"
        )
    )
    student = repo.save_person(actor, {"name": "Client", "roles": ["student"]})["id"]
    source = saved_source()
    source["student_id"] = source["result"]["student_id"] = student
    with repo.db() as db:
        db.execute(
            "INSERT INTO p_analyses VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                source["id"],
                actor.org_id,
                student,
                actor.user_id,
                None,
                source["kind"],
                source["protocol"],
                AT,
                source["status"],
                0,
                encode(source["result"]),
                encode(source["detail"]),
            ),
        )
        for value in (4.2, 8.8):
            db.execute(
                "INSERT INTO p_progress_records VALUES (?,?,?,?,?,?,?,?)",
                (
                    uid(),
                    student,
                    source["id"],
                    "front:shoulder_tilt",
                    value,
                    "deg",
                    AT,
                    0,
                ),
            )
    client = repo.client(actor, student)
    rows = client["progress"]
    assert len(rows) == 2
    assert {row["value"]: row["evidence"]["supported"] for row in rows} == {
        4.2: True,
        8.8: False,
    }
    assert (
        next(row for row in rows if row["value"] == 4.2)["evidence"]["confidence"]
        == 0.93
    )
    with repo.db() as db:
        stored = db.execute("SELECT * FROM p_progress_records").fetchall()
        assert len(stored) == 2 and len(stored[0]) == 8
        assert db.execute(
            "SELECT result FROM p_analyses WHERE id=?", (source["id"],)
        ).fetchone()[0] == encode(source["result"])


def test_seed_scenarios_retain_supported_authoritative_histories():
    from pilates.platform.seed import simulation

    for kind in ("posture", "movement"):
        report = simulation(0, 0, kind)
        values = selected_progress_measurements(report, {})
        assert any(value["supported"] for value in values.values())
        assert all(
            value["confidence"] is not None
            for value in values.values()
            if value["supported"]
        )


def archived_frame_signal():
    source = saved_source("movement")
    person = source["result"]["views"][0]["report"]["people"][0]
    signal = person["signals"]["right_shoulder"]
    signal.pop("confidence")
    signal["series"] = [[0, 10], [1, None], [2, 73.5]]
    person["frames"] = []
    for time, confidence in [(0, 0.8), (1, 0.1), (2, 0.85)]:
        scores = [0.95] * 17
        scores[6] = confidence
        person["frames"].append(
            {"time": time, "suitable": True, "landmarks": {"scores": scores}}
        )
    return source, person, signal


def test_missing_legacy_signal_confidence_uses_only_exact_accepted_frame_dependencies():
    source, person, signal = archived_frame_signal()
    evidence = progress_evidence(
        progress_row(source, "right_shoulder_rom", 63.5), source
    )
    assert evidence["supported"] is True
    assert evidence["confidence"] == 0.825
    assert evidence["confidence_basis"] == "saved_accepted_frame_scores"
    assert evidence["confidence_sample_count"] == 2
    assert (
        "confidence" not in signal
    ), "Reading legacy evidence must not rewrite its payload."
    person["frames"][1]["landmarks"][
        "scores"
    ] = []  # This timestamp was rejected by the source signal.
    assert (
        progress_evidence(progress_row(source, "right_shoulder_rom", 63.5), source)[
            "confidence"
        ]
        == 0.825
    )
    signal["confidence"] = None
    evidence = progress_evidence(
        progress_row(source, "right_shoulder_rom", 63.5), source
    )
    assert evidence["supported"] is False and evidence["confidence"] is None


@pytest.mark.parametrize(
    "failure",
    [
        "missing_frame",
        "duplicate_frame",
        "missing_scores",
        "low_accepted_score",
        "unsuitable",
        "uncertain_joint",
        "unknown_signal",
    ],
)
def test_legacy_recovery_requires_unambiguous_complete_accepted_frames(failure):
    source, person, signal = archived_frame_signal()
    if failure == "missing_frame":
        person["frames"].pop()
    elif failure == "duplicate_frame":
        person["frames"].append(deepcopy(person["frames"][-1]))
    elif failure == "missing_scores":
        person["frames"][-1]["landmarks"]["scores"] = []
    elif failure == "low_accepted_score":
        person["frames"][-1]["landmarks"]["scores"][6] = 0.5
    elif failure == "unsuitable":
        person["frames"][-1]["suitable"] = False
    elif failure == "uncertain_joint":
        person["frames"][-1]["uncertain_joints"] = [6]
    elif failure == "unknown_signal":
        person["signals"] = {"unknown_shoulder": signal}
    evidence = selected_progress_measurements(source["result"], {})
    assert not any(value["supported"] for value in evidence.values())
    assert all(value["confidence"] is None for value in evidence.values())
