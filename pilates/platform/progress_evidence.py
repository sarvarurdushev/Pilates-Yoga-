"""Resolve longitudinal values against the archived, selected person's evidence.

Progress rows are a small index, not an independent measurement authority. This
module also reads old rows without changing them or manufacturing confidence.
"""

from collections import Counter
import math
import statistics

MIN_CONFIDENCE = 0.65
SUPPORTED_STATUSES = frozenset({"measured", "estimated", "available"})


def finite_number(value):
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(value)
    )


def _person_id(value):
    if isinstance(value, str):
        return value.strip() or None
    if finite_number(value):
        return str(value)
    return None


def _signal_confidence(person, name, signal):
    if "confidence" in signal:
        return signal["confidence"], "saved_signal", None
    # Older demo/algorithm archives may have frame scores but no signal-level
    # confidence. Reproduce assessment.py's exact accepted-frame calculation.
    # Explicit null confidence is a refusal, never a request to fill a default.
    from ..assessment import SIGNALS

    if name not in SIGNALS or not isinstance(signal.get("series"), list):
        return None, "saved_signal", None
    times = []
    for point in signal["series"]:
        if not isinstance(point, (list, tuple)) or len(point) != 2:
            return None, "saved_signal", None
        time, value = point
        if value is not None:
            if not finite_number(time) or not finite_number(value):
                return None, "saved_signal", None
            times.append(round(time, 3))
    if (
        not times
        or len(set(times)) != len(times)
        or not isinstance(person.get("frames"), list)
    ):
        return None, "saved_signal", None
    accepted = set(times)
    scores = {}
    for frame in person["frames"]:
        if not isinstance(frame, dict) or not finite_number(frame.get("time")):
            continue
        time = round(frame["time"], 3)
        if time not in accepted:
            continue
        if time in scores or frame.get("suitable") is not True:
            return None, "saved_signal", None
        landmarks = frame.get("landmarks")
        confidence = landmarks.get("scores") if isinstance(landmarks, dict) else None
        uncertain = frame.get("uncertain_joints", [])
        if not isinstance(confidence, list) or not isinstance(uncertain, list):
            return None, "saved_signal", None
        joints = SIGNALS[name][1]
        if any(
            j >= len(confidence)
            or not finite_number(confidence[j])
            or not 0 <= confidence[j] <= 1
            or j in uncertain
            for j in joints
        ):
            return None, "saved_signal", None
        scores[time] = min(confidence[j] for j in joints)
        if scores[time] < MIN_CONFIDENCE:
            return None, "saved_signal", None
    if set(scores) != accepted:
        return None, "saved_signal", None
    return (
        round(statistics.mean(scores.values()), 3),
        "saved_accepted_frame_scores",
        len(scores),
    )


def _record(
    view,
    person,
    selection,
    metric_id,
    name,
    value,
    unit,
    status,
    confidence,
    reason,
    basis,
    signal_unit=None,
    signal_view=None,
):
    supported = True
    if not finite_number(value):
        supported, reason = False, "The source has no finite measurement value."
    elif not isinstance(status, str) or status not in SUPPORTED_STATUSES:
        supported, reason = (
            False,
            "The source measurement status does not support comparison.",
        )
    elif not finite_number(confidence):
        supported, reason = (
            False,
            "The source did not record model confidence for this measurement.",
        )
    elif not MIN_CONFIDENCE <= confidence <= 1:
        supported, reason = (
            False,
            "The source model confidence does not meet the measurement threshold.",
        )
    elif not isinstance(unit, str) or not unit.strip():
        supported, reason = False, "The source did not record a measurement unit."
    elif basis != "saved_metric" and signal_unit != "deg":
        supported, reason = (
            False,
            "The source signal does not use projected angle units.",
        )
    elif signal_view is not None and signal_view != view:
        supported, reason = False, "The source signal names a different camera view."
    return {
        "metric_id": metric_id,
        "view": view,
        "person_id": _person_id(person["person_id"]),
        "person_scope": "capture_local",
        "selection": selection,
        "name": name,
        "value": value if finite_number(value) else None,
        "unit": unit,
        "status": status,
        "confidence": confidence if finite_number(confidence) else None,
        "confidence_basis": basis,
        "supported": supported,
        "reason": reason or "",
    }


def selected_progress_measurements(report, detail):
    """Return source metadata, including refusals, for unambiguous selected people.

    A person ID is local to its capture. Selecting it never establishes identity
    across captures. Ambiguous views, people, and duplicate metrics stay absent
    or unsupported so a legacy index cannot make them appear authoritative.
    """
    if not isinstance(report, dict) or not isinstance(detail, dict):
        return {}
    kind = report.get("kind")
    if not isinstance(kind, str) or kind not in {"posture", "movement"}:
        return {}
    views = report.get("views")
    if not isinstance(views, list):
        return {}
    cameras = Counter(
        v.get("view")
        for v in views
        if isinstance(v, dict) and isinstance(v.get("view"), str)
    )
    selections = detail.get("selected_people", {})
    if not isinstance(selections, dict):
        return {}
    measurements = {}
    for view in views:
        if not isinstance(view, dict):
            continue
        camera = view.get("view")
        if not isinstance(camera, str) or not camera.strip() or cameras[camera] != 1:
            continue
        payload = view.get("report")
        if not isinstance(payload, dict) or not isinstance(payload.get("people"), list):
            continue
        candidates = [
            p
            for p in payload["people"]
            if isinstance(p, dict)
            and p.get("suitable") is True
            and _person_id(p.get("person_id")) is not None
        ]
        if camera in selections:
            selected = _person_id(selections[camera])
            candidates = [
                p
                for p in candidates
                if selected is not None and _person_id(p["person_id"]) == selected
            ]
            selection = "reviewed"
        else:
            # A rejected bystander still makes identity ambiguous. The one
            # suitable body must not silently become this client's evidence.
            if len(payload["people"]) != 1:
                continue
            selection = "single_suitable"
        if len(candidates) != 1:
            continue
        person = candidates[0]
        values = []
        if kind == "posture" and isinstance(person.get("metrics"), list):
            for metric in person["metrics"]:
                if (
                    not isinstance(metric, dict)
                    or not isinstance(metric.get("id"), str)
                    or not metric["id"].strip()
                ):
                    continue
                values.append(
                    _record(
                        camera,
                        person,
                        selection,
                        metric["id"],
                        metric.get("name", metric["id"]),
                        metric.get("value"),
                        metric.get("unit"),
                        metric.get("status"),
                        metric.get("confidence"),
                        metric.get("reason"),
                        "saved_metric",
                    )
                )
        if kind == "movement" and isinstance(person.get("signals"), dict):
            for name, signal in person["signals"].items():
                if (
                    not isinstance(name, str)
                    or not name.strip()
                    or not isinstance(signal, dict)
                ):
                    continue
                confidence, basis, count = _signal_confidence(person, name, signal)
                for suffix, unit in (
                    ("rom", "deg"),
                    ("tempo_cv", "ratio"),
                    ("rep_rom_sd", "deg"),
                    ("repetitions", "cycles"),
                ):
                    values.append(
                        _record(
                            camera,
                            person,
                            selection,
                            name + "_" + suffix,
                            name.replace("_", " ")
                            + " "
                            + ("ROM" if suffix == "rom" else suffix),
                            signal.get(suffix),
                            unit,
                            signal.get("status"),
                            confidence,
                            signal.get("reason"),
                            basis,
                            signal.get("unit"),
                            signal.get("camera_view"),
                        )
                    )
                    if count is not None:
                        values[-1]["confidence_sample_count"] = count
        for value in values:
            key = camera + ":" + value["metric_id"]
            if key in measurements:
                measurements[key]["supported"] = False
                measurements[key][
                    "reason"
                ] = "The selected source person has duplicate measurement IDs."
            else:
                measurements[key] = value
    return measurements


def progress_evidence(row, analysis, measurements=None):
    """Attach exact saved evidence to an indexed value; mismatch means unsupported."""
    evidence = {
        "authority": "saved_analysis",
        "version": 1,
        "supported": False,
        "analysis_id": row.get("analysis_id"),
        "student_id": row.get("student_id"),
        "reason": "The archived source assessment is unavailable.",
    }
    if not isinstance(analysis, dict):
        return evidence
    report, detail = analysis.get("result"), analysis.get("detail")
    if measurements is None:
        measurements = selected_progress_measurements(report, detail)
    measurement = measurements.get(row.get("metric"))
    evidence.update(
        {
            "kind": analysis.get("kind"),
            "protocol": analysis.get("protocol"),
            "demo": bool(analysis.get("demo")),
            "recorded_at": analysis.get("created_at"),
        }
    )
    if measurement is None:
        evidence["reason"] = (
            "No unambiguous selected suitable person supplies this indexed measurement."
        )
        return evidence
    evidence.update(measurement)
    evidence["supported"] = False
    mismatches = [
        (
            analysis.get("id") != row.get("analysis_id"),
            "The index names a different source assessment.",
        ),
        (
            analysis.get("student_id") != row.get("student_id"),
            "The source belongs to a different client.",
        ),
        (
            analysis.get("status") != "complete",
            "The source assessment is not complete.",
        ),
        (
            not isinstance(analysis.get("protocol"), str)
            or not analysis["protocol"].strip(),
            "The source capture protocol is unspecified.",
        ),
        (
            not isinstance(report, dict) or report.get("kind") != analysis.get("kind"),
            "The source assessment kind is inconsistent.",
        ),
        (
            isinstance(report, dict)
            and report.get("id") not in (None, analysis.get("id")),
            "The archived payload names a different assessment.",
        ),
        (
            isinstance(report, dict)
            and report.get("student_id") not in (None, analysis.get("student_id")),
            "The archived payload names a different client.",
        ),
        (
            bool(row.get("demo")) != bool(analysis.get("demo"))
            or (
                isinstance(report, dict)
                and "synthetic" in report
                and bool(report["synthetic"]) != bool(analysis.get("demo"))
            ),
            "The source and index have inconsistent demo provenance.",
        ),
        (
            row.get("recorded_at") != analysis.get("created_at"),
            "The index has a different capture time.",
        ),
        (
            not finite_number(row.get("value"))
            or row.get("value") != measurement["value"],
            "The index does not match the saved measurement value.",
        ),
        (
            row.get("unit") != measurement["unit"],
            "The index does not match the saved measurement unit.",
        ),
    ]
    for mismatch, reason in mismatches:
        if mismatch:
            evidence["reason"] = reason
            return evidence
    evidence["supported"] = measurement["supported"]
    return evidence
