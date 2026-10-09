"""SEDENS Standard content and the server-side anatomy registry."""

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from pilates.sedens import atlas, standard
from pilates.sedens.util import Denied

ROOT = Path(__file__).resolve().parents[1]
BANNED = [
    r"supervised by", r"clinically", r"prevents? injur", r"corrects? (your )?posture", r"diagnos",
    r"unstable surface", r"outperform", r"자세 교정", r"부상 예방", r"진단", r"불안정한 지지면",
]


def customer_text(entry):
    parts = [entry["title"], entry["cue"], entry["breath"], entry["stop_if"], entry["before_you_start"],
             *entry["steps"], *entry["regressions"], *entry["progressions"]]
    return " ".join(p[lang] for p in parts for lang in ("en", "ko"))


def test_the_standard_file_is_sound():
    assert standard.problems() == []
    assert 8 <= len(standard.exercises()) <= 20, "only enough to prove the architecture"


def test_the_original_catalog_is_untouched_and_pinned():
    """The Standard records the catalog it was drafted from; any change to the catalog is noticed."""
    assert standard.document()["catalog_sha256"] == standard.catalog_digest()
    keys = {e["catalog_key"] for e in standard.exercises()}
    assert keys <= set(standard.catalog())


def test_no_review_is_claimed_without_evidence():
    raw = standard.FILE.read_text()
    assert "Hong Jong Gi" not in raw and "홍종기" not in raw
    for entry in standard.exercises():
        assert entry["review"] == {"status": "unreviewed", "reviewer": None, "reviewed_at": None,
                                   "evidence": None, "scope": None}
    assert standard.label()["en"] == "Demo content — not yet expert-reviewed"


@pytest.mark.parametrize("entry", standard.exercises(), ids=lambda e: e["id"])
def test_customer_wording_stays_general_fitness(entry):
    text = customer_text(entry)
    for pattern in BANNED:
        assert not re.search(pattern, text, re.IGNORECASE), (entry["id"], pattern)
    # Anatomy is labelled as illustration wherever it is shown.
    assert entry["anatomy"]["label"]["en"] == "Educational anatomy — not measured muscle activation."
    assert all(s["role"] in ("prime", "assisting", "steadying") for s in entry["anatomy"]["structures"])


def test_atlas_accepts_registry_names_including_whole_muscles():
    assert atlas.validate(["rectus abdominis", "trapezius", "brain:7"]) == ["rectus abdominis", "trapezius", "brain:7"]
    assert atlas.get("trapezius")["parts"] and len(atlas.atlas_hash()) == 16


@pytest.mark.parametrize("keys,code", [
    (["rectus abdominis", "made-up muscle"], "unknown_structures"),
    (["left scapula (4.0)", "rectus abdominis"], "mixed_atlas"),
    ("rectus abdominis", "invalid_structures"),
    ([""], "invalid_structures"),
    ([f"brain:{n}" for n in range(1, 16)] * 1 + ["rectus abdominis"] * 30 + [k for k in list(atlas.registry()["structures"])[100:140]], "too_many_structures"),
])
def test_atlas_refuses_unknown_mixed_or_too_many(keys, code):
    with pytest.raises(Denied) as exc:
        atlas.validate(keys)
    assert exc.value.code == code


def test_exercise_structures_come_from_the_catalog_muscles():
    entry = standard.catalog()["pelvicCurl"]
    assert "gluteus maximus" in atlas.exercise_structures(entry["detail"]["muscles"])


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_python_registry_matches_the_browser_registry(tmp_path):
    script = tmp_path / "keys.mjs"
    script.write_text(
        "import { readFileSync } from 'node:fs';\n"
        f"const {{ buildRegistry }} = await import({json.dumps(str(ROOT / 'web/src/structures.js'))});\n"
        f"const gen = JSON.parse(readFileSync({json.dumps(str(atlas.STRUCTURES))}, 'utf8'));\n"
        "console.log(JSON.stringify([...buildRegistry(gen).byName.keys()]));\n"
    )
    out = subprocess.run(["node", str(script)], capture_output=True, text=True, timeout=120, check=True)
    assert set(json.loads(out.stdout)) == set(atlas.registry()["structures"])


def test_the_anatomy_picker_searches_and_previews_by_name():
    from pilates.sedens import atlas

    found = atlas.search("trapez")
    assert found[0] == {"key": "trapezius", "layer": "muscles_superficial", "whole": True}
    assert all(atlas.depth_of(atlas.get(r["key"])) in (None, "taught") for r in atlas.search("", "taught", 5000))
    assert all(atlas.depth_of(atlas.get(r["key"])) in (None, "complete") for r in atlas.search("scapula", "complete"))
    drawn = atlas.drawn_ids(["trapezius", "rectus abdominis", "not a structure", 5])
    parts = [atlas.get(k)["id"] for k in atlas.get("trapezius")["parts"]]
    assert drawn["ids"][: len(parts)] == parts and drawn["missing"] == ["not a structure", 5]
    assert atlas.key_for_id(atlas.get("rectus abdominis")["id"]) == "rectus abdominis"
    assert atlas.key_for_id(-1) is None
