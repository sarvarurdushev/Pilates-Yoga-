"""The customer interpretation layer for a room scan.

Every observation passes **measurement → quality gate → evidence rule → customer
wording**, with the rules and the wording in ``data/sedens_feedback_rules.v<n>.json``
(versioned, English and Korean). Nothing here scores a body: there is no overall
score, grade, percentage or traffic light (brief §14). Thresholds are internal
technical thresholds ("our measurement can tell this from noise"), never
statements about what is normal (brief §15).

Input ``measurements``: ``{view: {"people": n, "suitable": bool, "reason": code,
"metrics": {metric_id: {"value", "unit", "confidence", "status"}}}}`` for the
views front, left, back, right, whichever were captured.
"""

from __future__ import annotations

from functools import lru_cache
import json
from pathlib import Path

DATA = Path(__file__).resolve().parents[2] / "data"
CURRENT = "sedens-feedback-1.0.0"
FILES = {"sedens-feedback-1.0.0": "sedens_feedback_rules.v1.json"}
VIEWS = ("front", "left", "back", "right")


@lru_cache(maxsize=None)
def rules(version: str = CURRENT) -> dict:
    data = json.loads((DATA / FILES[version]).read_text(encoding="utf-8"))
    assert data["version"] == version
    return data


def _t(value, locale):
    return value.get(locale) or value.get("en") if isinstance(value, dict) else value


def view_quality(view_data, min_confidence) -> tuple[str, str | None]:
    """'clear' | 'limited' | 'retake' for one view, with a customer reason code."""
    if not view_data:
        return "retake", "unclear"
    people = view_data.get("people", 0)
    if people == 0:
        return "retake", "no_person"
    if people > 1:
        return "retake", "several_people"
    if not view_data.get("suitable"):
        return "retake", view_data.get("reason") or "not_full_body"
    metrics = view_data.get("metrics", {})
    weak = [m for m in metrics.values()
            if m.get("value") is None or (m.get("confidence") or 0) < min_confidence]
    if metrics and len(weak) == len(metrics):
        return "limited", "unclear"
    return "clear", None


def interpret(measurements, *, locale="ko", previous=None, version=CURRENT) -> dict:
    """The customer summary (A quality, B observed, C meaning, comparison, Advanced),
    plus the evaluated rules for the record and an internal focus hint."""
    r = rules(version)
    min_conf = r["quality"]["min_confidence"]
    quality = {v: view_quality(measurements.get(v), min_conf) for v in VIEWS}
    clear = [v for v in VIEWS if quality[v][0] == "clear"]
    if quality["front"][0] == "retake" and quality["back"][0] == "retake":
        overall = "retake"
    elif len(clear) == len(VIEWS):
        overall = "clear"
    else:
        overall = "limited"
    out = {
        "rules_version": version,
        "quality": overall,
        "quality_text": _t(r["quality"]["copy"][overall], locale),
        "views": {v: {"quality": quality[v][0],
                      "reason": _t(r["quality"]["view_reasons"][quality[v][1]], locale) if quality[v][1] else None}
                  for v in VIEWS},
        "observations": [], "notes": [], "evaluated": [], "focus_hint": None,
        "meaning": _t(r["meaning"], locale),
    }
    for rule in r["observations"]:
        evaluated = _evaluate(rule, measurements, quality, min_conf)
        out["evaluated"].append(evaluated)
        if evaluated["outcome"] == "shown":
            side = evaluated["side"]
            out["observations"].append({
                "id": rule["id"], "heading": _t(rule["heading"], locale),
                "text": _t(rule["observed"], locale).replace("{side}", _t(rule["sides"][side], locale)),
                "limitation": _t(rule["limitation"], locale), "provisional": rule["status"] == "provisional"})
            out["focus_hint"] = out["focus_hint"] or rule["focus"]
        elif evaluated["outcome"] == "below_threshold":
            out["notes"].append({"id": rule["id"], "heading": _t(rule["heading"], locale),
                                 "text": _t(rule["below_threshold"], locale)})
        elif overall != "retake":
            out["notes"].append({"id": rule["id"], "heading": _t(rule["heading"], locale),
                                 "text": _t(rule["withheld"], locale)})
    out["comparison"] = compare(measurements, previous, locale, version)
    out["advanced"] = advanced(measurements, locale, version)
    # D and E of the result: a focus line and why, never a correction (brief §13).
    focus = r["focus"][out["focus_hint"] or "general"]
    out["focus"] = {"heading": _t(r["focus"]["heading"], locale), "text": _t(focus["text"], locale),
                    "why_heading": _t(r["focus"]["why_heading"], locale), "why": _t(focus["why"], locale)}
    return out


def _metric(measurements, view, metric, min_conf):
    m = (measurements.get(view) or {}).get("metrics", {}).get(metric)
    if not m or m.get("value") is None or m.get("status") not in ("measured", "estimated", "available") \
            or (m.get("confidence") or 0) < min_conf:
        return None
    return float(m["value"])


def _evaluate(rule, measurements, quality, min_conf) -> dict:
    record = {"rule_id": rule["id"], "metric": rule["metric"], "unit": rule["unit"],
              "threshold": rule["threshold_deg"], "value": None, "outcome": "withheld", "reason": "", "side": None}
    views = rule["views"]
    if any(quality[v][0] != "clear" for v in views):
        record["reason"] = "view_not_clear"
        return record
    values = [_metric(measurements, v, rule["metric"], min_conf) for v in views]
    if any(v is None for v in values):
        record["reason"] = "metric_unavailable"
        return record
    record["value"] = round(sum(values) / len(values), 2)
    same_side = all(v > 0 for v in values) or all(v < 0 for v in values)
    if not same_side:
        record.update(outcome="below_threshold" if all(abs(v) < rule["threshold_deg"] for v in values) else "withheld",
                      reason="views_disagree")
        return record
    if all(abs(v) >= rule["threshold_deg"] for v in values):
        # Positive means the person's left shoulder keypoint is higher (anatomical sign).
        record.update(outcome="shown", reason="above_threshold_in_both_views",
                      side="left" if values[0] > 0 else "right")
    else:
        record.update(outcome="below_threshold", reason="within_measurement_variation")
    return record


def compare(measurements, previous, locale, version=CURRENT) -> dict:
    """Against the last comparable scan only (same protocol, rules version, source
    class and a clear result); a measured difference, never better or worse."""
    r = rules(version)
    copy = r["comparison"]
    if not previous:
        return {"available": False, "text": _t(copy["none"], locale)}
    rule = next(o for o in r["observations"] if o["id"] == "shoulder_line")
    now_values = [_metric(measurements, v, rule["metric"], r["quality"]["min_confidence"]) for v in rule["views"]]
    before_values = [_metric(previous, v, rule["metric"], r["quality"]["min_confidence"]) for v in rule["views"]]
    if any(v is None for v in now_values + before_values):
        return {"available": False, "text": _t(copy["none"], locale)}
    now_mean = sum(now_values) / len(now_values)
    before_mean = sum(before_values) / len(before_values)
    if abs(now_mean - before_mean) < rule["change_threshold_deg"]:
        return {"available": True, "text": _t(copy["no_difference"], locale)}
    direction = "more_level" if abs(now_mean) < abs(before_mean) else "less_level"
    return {"available": True,
            "text": _t(copy["difference"], locale).replace("{direction}", _t(copy["directions"][direction], locale))}


def advanced(measurements, locale, version=CURRENT) -> list[dict]:
    """Technical values for the collapsed "Advanced measurements" section. Model
    visibility is never shown as a probability of being correct."""
    r = rules(version)
    labels = r["advanced"]
    out = []
    for view in VIEWS:
        for metric, m in sorted(((measurements.get(view) or {}).get("metrics") or {}).items()):
            if metric not in labels or m.get("value") is None:
                continue
            out.append({"view": view, "metric": metric, "label": _t(labels[metric]["label"], locale),
                        "value": m["value"], "unit": m.get("unit", ""),
                        "limitation": _t(labels[metric]["limitation"], locale)})
    return out


def customer_summary(summary) -> dict:
    """The part of a stored summary the room screen may show (no rule internals)."""
    return {k: summary.get(k) for k in ("rules_version", "quality", "quality_text", "views", "observations",
                                       "notes", "meaning", "focus", "comparison", "advanced", "label", "label_note",
                                       "source")}
