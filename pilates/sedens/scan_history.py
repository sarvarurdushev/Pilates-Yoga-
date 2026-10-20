"""Which room scans may be compared with each other, and what a comparison says.

Two scans are comparable only when everything that could make a difference
between them other than the person is the same: the same customer and
organization, both complete and clear, the same kind of source (a demonstration
never meets a real scan, and seeded history only meets seeded history), the same
protocol, measurement version, model and feedback rules version, and the
observation itself was evaluated (not withheld) in both. There is no
compatibility table between measurement versions yet, so a different version is
simply not comparable.

A comparison states measured values and their difference. It never calls a
change better, worse or an improvement, and says the measurement's
repeatability has not been established.
"""

from __future__ import annotations

from . import feedback
from .util import Denied, decode

OBSERVATION = "shoulder_line"
# Reason codes, in the order the rules are checked.
REASONS = {
    "different_customer": {
        "en": "These scans belong to different people.",
        "ko": "서로 다른 사람의 스캔이에요."},
    "low_quality": {
        "en": "One of the scans was not clear enough to compare.",
        "ko": "두 스캔 중 하나가 비교할 만큼 선명하지 않았어요."},
    "demo_vs_real": {
        "en": "One scan is a demonstration or sample and the other is not.",
        "ko": "한쪽은 시연 또는 샘플 스캔이고 다른 쪽은 아니에요."},
    "different_protocol": {
        "en": "The scans were taken with different photo steps.",
        "ko": "스캔 촬영 방식이 서로 달라요."},
    "different_measurement_version": {
        "en": "The scans were measured with different versions of SEDENS's measurement.",
        "ko": "스캔을 측정한 SEDENS 측정 버전이 서로 달라요."},
    "different_model": {
        "en": "The scans were analysed by different models.",
        "ko": "스캔을 분석한 모델이 서로 달라요."},
    "different_rules_version": {
        "en": "The scans were described with different versions of the wording rules.",
        "ko": "스캔을 설명한 규칙 버전이 서로 달라요."},
    "observation_withheld": {
        "en": "The shoulder line could not be described in one of the scans.",
        "ko": "두 스캔 중 하나에서는 어깨선을 설명할 수 없었어요."},
}
NOT_ENOUGH = {"en": "There isn't enough comparable information yet.",
              "ko": "아직 비교할 수 있는 정보가 충분하지 않아요."}
NOT_ESTABLISHED = {
    "en": "How repeatable this measurement is has not been established yet, so a small difference may be ordinary "
          "variation. It does not mean better or worse.",
    "ko": "이 측정이 얼마나 반복해서 같은 값을 보이는지는 아직 확인되지 않았어요. 작은 차이는 평소의 변동일 수 있고, "
          "좋아지거나 나빠졌다는 뜻이 아니에요."}


def source_class(scan) -> str:
    """'seeded' (fictional history), 'demo' (a precomputed demonstration run in a room) or 'real'."""
    if scan.get("origin") == "demo_seed":
        return "seeded"
    return "demo" if scan.get("source") == "demo_precomputed" else "real"


def _observation_evaluated(scan) -> bool:
    summary = scan.get("summary")
    evaluated = (decode(summary, {}) if isinstance(summary, str) else (summary or {})).get("evaluated") or []
    return any(e.get("rule_id") == OBSERVATION and e.get("outcome") in ("shown", "below_threshold") for e in evaluated)


def reasons(a, b) -> list[str]:
    """Every rule the pair fails, as reason codes (empty when comparable)."""
    out = []
    if a.get("student_id") != b.get("student_id") or a.get("org_id") != b.get("org_id"):
        out.append("different_customer")
    if any(s.get("state") != "complete" or s.get("reliability") != "clear" for s in (a, b)):
        out.append("low_quality")
    if source_class(a) != source_class(b):
        out.append("demo_vs_real")
    if a.get("protocol") != b.get("protocol"):
        out.append("different_protocol")
    if (a.get("measurement_version") or "") != (b.get("measurement_version") or ""):
        out.append("different_measurement_version")
    if (a.get("model") or "") != (b.get("model") or ""):
        out.append("different_model")
    if (a.get("feedback_rules_version") or "") != (b.get("feedback_rules_version") or ""):
        out.append("different_rules_version")
    if not (_observation_evaluated(a) and _observation_evaluated(b)):
        out.append("observation_withheld")
    return out


def comparable(a, b) -> tuple[bool, list[str]]:
    """(whether the two ``s_room_scans`` rows may be compared, the reason codes when not)."""
    found = reasons(a, b)
    return not found, found


def _shoulder(scan) -> dict | None:
    """The shoulder-line tilt of a scan in each view and their mean, from its stored measurements."""
    rule = next(o for o in feedback.rules(scan.get("feedback_rules_version") or feedback.CURRENT)["observations"]
                if o["id"] == OBSERVATION)
    min_conf = feedback.rules(scan.get("feedback_rules_version") or feedback.CURRENT)["quality"]["min_confidence"]
    measurements = decode(scan.get("summary"), {}).get("measurements") or {}
    values = {v: feedback._metric(measurements, v, rule["metric"], min_conf) for v in rule["views"]}
    if any(x is None for x in values.values()):
        return None
    return {"views": {v: round(x, 2) for v, x in values.items()},
            "mean": round(sum(values.values()) / len(values), 2), "unit": rule["unit"]}


def compare(earlier, later, locale) -> dict:
    """A comparison of two stored scans, or a refusal with plain reasons. ``earlier`` and
    ``later`` are ``s_room_scans`` rows (dicts); the caller has already scoped them to one customer."""
    ok, found = comparable(earlier, later)
    base = {"earlier": earlier["id"], "later": later["id"], "earlier_date": earlier.get("completed_at"),
            "later_date": later.get("completed_at")}
    if not ok:
        return {**base, "comparable": False, "message": NOT_ENOUGH[locale],
                "reasons": [{"code": c, "text": REASONS[c][locale]} for c in found]}
    rule = next(o for o in feedback.rules(later["feedback_rules_version"])["observations"] if o["id"] == OBSERVATION)
    before, now_ = _shoulder(earlier), _shoulder(later)
    if before is None or now_ is None:
        return {**base, "comparable": False, "message": NOT_ENOUGH[locale],
                "reasons": [{"code": "observation_withheld", "text": REASONS["observation_withheld"][locale]}]}
    measurements = {s: decode(x["summary"], {}).get("measurements") or {} for s, x in (("a", earlier), ("b", later))}
    text = feedback.compare(measurements["b"], measurements["a"], locale, later["feedback_rules_version"])["text"]
    return {
        **base, "comparable": True,
        "measured": {"id": rule["id"], "heading": rule["heading"][locale], "metric": rule["metric"],
                     "views": list(rule["views"]), "unit": before["unit"]},
        "earlier_values": before, "later_values": now_,
        "difference": round(now_["mean"] - before["mean"], 2),
        "text": text,
        "limitations": [rule["limitation"][locale], NOT_ESTABLISHED[locale]],
        "versions": {"measurement": later["measurement_version"], "feedback_rules": later["feedback_rules_version"],
                     "protocol": later["protocol"]},
        "demo": source_class(later) != "real",
    }


def refuse_unknown() -> Denied:
    return Denied("That scan was not found.", 404, "unknown_scan")
