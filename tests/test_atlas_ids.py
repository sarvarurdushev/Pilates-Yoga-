"""The structure ids, and the two builds that share one file.

`web/src/generated/structures.json` is written by `build_body.py`, which owns
the skeleton, the muscles and the organs, and by `build_nervous.py`, which owns
the nervous layer and needs Blender and a 306 MB Z-Anatomy file to run.

Adding nine muscles to the body build was enough to break that arrangement in
two ways at once, neither of which raised anything:

  * the file was rewritten from scratch, so the twenty nerves disappeared --
    and the Z-Anatomy attribution with them, which is a licence obligation;
  * the body's ids grew into the range the nerves already occupied, and those
    ids are baked into `nervous.glb` as a per-vertex attribute, so the collision
    would have pointed nine muscles and nine nerves at the same region.

Both are silent. A structure with a colliding id does not throw; it draws in
somebody else's colour, answers to somebody else's name in the panel, and
receives coach evaluations written about a different part of the body. So the
committed file is checked here rather than trusted.
"""
from __future__ import annotations

import collections
import json
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
ATLAS = ROOT / "web" / "src" / "generated" / "structures.json"

#: Layers `build_body.py` writes. Anything else in the file came from another
#: build and must survive a rebuild of these.
BODY_LAYERS = {"skeleton", "muscles_superficial", "muscles_deep", "organs"}


@pytest.fixture(scope="module")
def atlas() -> dict:
    return json.loads(ATLAS.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def structures(atlas) -> list[dict]:
    return atlas["structures"]


class TestIds:
    def test_every_id_is_unique(self, structures):
        """The collision that would put a muscle and a nerve on one id."""
        counts = collections.Counter(s["id"] for s in structures)
        clashes = {i: n for i, n in counts.items() if n > 1}
        assert not clashes, f"ids used more than once: {clashes}"

    def test_ids_start_where_the_build_says(self, atlas, structures):
        base = atlas["idBase"]
        assert min(s["id"] for s in structures) >= base

    def test_ids_do_not_collide_across_layers(self, structures):
        """Said separately from uniqueness because this is the failure mode with
        a cause: two builds allocating into one space without knowing it."""
        by_layer = collections.defaultdict(set)
        for s in structures:
            by_layer[s["layer"]].add(s["id"])
        layers = sorted(by_layer)
        for i, a in enumerate(layers):
            for b in layers[i + 1:]:
                shared = by_layer[a] & by_layer[b]
                assert not shared, f"{a} and {b} share ids {sorted(shared)[:8]}"


class TestTheOtherBuildSurvives:
    def test_the_nervous_layer_is_still_here(self, structures):
        """It cannot be rebuilt without Blender, so losing it is expensive."""
        nerves = [s for s in structures if s["layer"] == "nervous"]
        assert len(nerves) >= 20, f"only {len(nerves)} nervous structures"

    def test_its_attribution_survives_a_body_rebuild(self, atlas):
        """CC BY-SA 4.0 is a real share-alike. The credit is not optional and it
        lives in the same file the body build rewrites."""
        source = atlas.get("sources", {}).get("nervous")
        assert source, "the nervous layer has no source record"
        assert "Z-Anatomy" in source["attribution"]
        assert source["licence"] == "CC BY-SA 4.0"

    def test_the_named_nerves_are_all_there(self, structures):
        names = {s["name"] for s in structures if s["layer"] == "nervous"}
        for need in ("spinal cord", "sciatic nerve", "femoral nerve", "median nerve",
                     "brachial plexus", "lumbar plexus", "vagus nerve"):
            assert need in names, f"the nervous layer lost {need!r}"


#: BodyParts3D 4.0's own cut of anatomy the taught body already has. Same names,
#: different granularity, never drawn at the same time -- see `setAtlasDepth`.
FULL_LAYERS = {"bones_full", "muscles_full", "organs_full"}


class TestTheSegmentalMuscles:
    """The nine this backfill added, and the rule that was dropping them.

    They exist in the source ontology only as sets -- there is no *third lumbar
    interspinalis* -- so the build's "set of ..." skip, which is right about the
    forty-six containers it was written for, was removing the structures
    themselves. These are what a studio cues when it says articulate one
    vertebra at a time, or breathe into the back of the ribs.
    """

    ADDED = [
        "interspinales cervicis", "interspinales thoracis", "interspinales lumborum",
        "anterior cervical intertransversarii", "posterior cervical intertransversarii",
        "lateral lumbar intertransversarius muscles",
        "medial lumbar intertransversarius muscles",
        "levatores costarum longi", "levatores costarum breves",
    ]

    def test_each_one_is_in_the_atlas(self, structures):
        names = {s["name"] for s in structures}
        missing = [n for n in self.ADDED if n not in names]
        assert not missing, f"the build is dropping {missing} again"

    def test_they_are_deep_muscles(self, structures):
        """Keyed within the taught set.

        The complete-atlas layers carry the same anatomy under the same names --
        that is what they are -- so a plain name index silently returned whichever
        of the two came last, and this asserted the layer of a structure it was not
        asking about.
        """
        taught = {s["name"]: s for s in structures
                  if s["layer"] not in FULL_LAYERS}
        for name in self.ADDED:
            assert taught[name]["layer"] == "muscles_deep", name

    def test_none_is_still_called_a_set(self, structures):
        """The plural is the anatomical name. "Set of" is the ontology's way of
        saying there is no singular, and it reads as filing on a label."""
        for s in structures:
            assert not s["name"].lower().startswith("set of"), s["name"]

    def test_each_carries_the_fma_ids_it_came_from(self, structures):
        by_name = {s["name"]: s for s in structures}
        for name in self.ADDED:
            fma = by_name[name]["fma"]
            assert fma, f"{name} has no FMA id"
            for f in fma:
                assert re.fullmatch(r"FMA\d+", f), f"{name}: {f}"

    def test_they_land_inside_the_body(self, structures):
        """A frame or axis error would put them outside the figure and nothing
        else in the suite would notice."""
        by_name = {s["name"]: s for s in structures}
        for name in self.ADDED:
            x, y, z = by_name[name]["centroid"]
            assert -0.60 < y < 0.46, f"{name} sits at y={y}"
            assert abs(x) < 0.45, f"{name} sits at x={x}"
            assert abs(z) < 0.35, f"{name} sits at z={z}"

    def test_the_spinal_ones_sit_near_the_midline(self, structures):
        """They run between adjacent vertebrae, so a centroid out at the ribs
        would mean the wrong mesh was picked up under the right name."""
        by_name = {s["name"]: s for s in structures}
        for name in ("interspinales cervicis", "interspinales thoracis",
                     "interspinales lumborum"):
            x = by_name[name]["centroid"][0]
            assert abs(x) < 0.05, f"{name} is {x} off the midline"
