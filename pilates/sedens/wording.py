"""Wording a SEDENS course may not use: medical and outcome claims.

SEDENS is a general fitness service. Guided-training text is read by customers
alone in a room, so a phrase that diagnoses, treats or promises a medical or
posture outcome is refused when it is saved. Professional-education courses
are written for coaches and may discuss such topics, so there the same phrases
are only flagged for the SEDENS reviewer. The reviewer still checks every
course for medical claims; this list catches the plain cases early.
"""

from __future__ import annotations

import re

from .util import Denied

PATTERNS = [
    re.compile(p, re.IGNORECASE)
    for p in (
        r"\bdiagnos\w*",
        r"\bcur(e|es|ed|ing)\b",
        r"\btreat(s|ed|ing|ment|ments)?\b(?!\s+yourself)",
        r"\btherap(y|ies|eutic)\b",
        r"\brehabilitat\w*",
        r"\bclinically\b",
        r"\bmedically\s+(proven|approved|certified)",
        r"\bmedical[- ]grade\b",
        r"\bprevents?\s+injur\w*",
        r"\bcorrects?\s+(your\s+)?posture",
        r"\bfix(es)?\s+(your\s+)?(back|posture|spine)",
        r"\bheals?\b",
        r"\bpain[- ]free\b",
        r"\bguarantee[sd]?\b",
        r"진단",
        r"치료",
        r"완치",
        r"재활",
        r"자세\s*교정",
        r"부상\s*예방",
        r"의학적으로",
        r"통증이?\s*사라",
    )
]


def findings(*texts: str) -> list[str]:
    """The claim-like phrases found in the given texts."""
    found: list[str] = []
    for value in texts:
        for pattern in PATTERNS:
            for match in pattern.finditer(str(value or "")):
                phrase = match.group(0)
                if phrase.lower() not in (f.lower() for f in found):
                    found.append(phrase)
    return found


def require_general_fitness(*texts: str):
    found = findings(*texts)
    if found:
        raise Denied(
            "SEDENS guided training describes general fitness only. Rephrase without medical or outcome claims: "
            + ", ".join(f"“{f}”" for f in found[:5]),
            400,
            "medical_claim_wording",
        )
