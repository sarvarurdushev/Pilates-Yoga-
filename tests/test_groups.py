"""The anatomical groups, and the promise the atlas makes about them.

`web/src/content/groups.js` says, in as many words, that no group's membership
was typed by hand: every one is the transitive closure of the Foundational Model
of Anatomy's own IS-A and PART-OF trees over this atlas's FMA ids. That is a
claim about provenance, and a claim about provenance that nothing checks is a
comment.

So this re-derives the whole table from the published BodyParts3D tables and
fails if the committed file disagrees. It also holds the curated list -- the
seventy-odd groups the interface actually offers -- against the generated one,
because the failure mode there is silent: a structure renumbers, a group drops
below two members, the curation names a concept that no longer exists, and the
interface simply offers one fewer group with nothing anywhere to say so.

The BodyParts3D tables are fetched, not committed (see
`web/scripts/fetch_bodyparts3d.sh`), so the re-derivation skips where they are
absent. Everything that can be checked against the committed file alone is
checked unconditionally.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import NamedTuple

import pytest

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
GROUPS = WEB / "src" / "generated" / "groups.json"
STRUCTURES = WEB / "src" / "generated" / "structures.json"
CURATION = WEB / "src" / "content" / "groups.js"
BPDATA = WEB / "bpdata"


@pytest.fixture(scope="module")
def groups() -> dict:
    return json.loads(GROUPS.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def structures() -> list[dict]:
    return json.loads(STRUCTURES.read_text(encoding="utf-8"))["structures"]


class Curated(NamedTuple):
    """One row of `groups.js`'s CURATED table.

    Named rather than positional because it has grown a column once already, and every
    unpack in this file broke on the day it did.
    """
    fma: str
    region: str
    ko: str
    exclude: str          # the name of an exclusion constant, or '' for none


@pytest.fixture(scope="module")
def curated() -> list[Curated]:
    """`[concept id, region, Korean, English, exclusions?]` as `groups.js` lists them.

    The fifth column is optional and names a constant rather than a literal, so it is
    captured by name and resolved separately -- see `excluded`.
    """
    source = CURATION.read_text(encoding="utf-8")
    body = source.split("const CURATED = [", 1)[1].split("\n];", 1)[0]
    rows = re.findall(
        r"\[\s*'(FMA\d+)'\s*,\s*'(\w+)'\s*,\s*'([^']+)'\s*,\s*(?:'[^']*'|null)\s*"
        r"(?:,\s*([A-Z][A-Z0-9_]*)\s*)?\]", body)
    assert rows, "the curated list did not parse -- has its shape changed?"
    return [Curated(*r) for r in rows]


@pytest.fixture(scope="module")
def excluded() -> dict[str, list[str]]:
    """The exclusion constants `groups.js` defines, by name.

    One group's membership is edited by hand -- "Abdominal muscles" is FMA's closure minus
    the pelvic floor, the anal sphincter and two structures that are not muscles -- and it is
    written as a subtraction precisely so that it can be checked rather than believed.
    """
    source = CURATION.read_text(encoding="utf-8")
    out: dict[str, list[str]] = {}
    for name, body in re.findall(r"^const ([A-Z][A-Z0-9_]*) = \[(.*?)^\];",
                                 source, re.S | re.M):
        out[name] = re.findall(r"'([^']+)'", body)
    return out


class TestTheTable:
    def test_it_carries_its_source_and_licence(self, groups):
        """The anatomy is somebody else's and the file has to say so."""
        assert "BodyParts3D" in groups["attribution"]
        assert "CC Attribution 4.0" in groups["attribution"]
        assert groups["licence"] == "CC BY 4.0"
        assert "IS-A" in groups["source"] and "PART-OF" in groups["source"]

    def test_every_member_is_a_structure_in_this_atlas(self, groups, structures):
        known = {s["id"] for s in structures}
        for g in groups["groups"]:
            missing = [m for m in g["members"] if m not in known]
            assert not missing, f"{g['id']} {g['name']} names unknown structures {missing}"

    def test_no_group_is_smaller_than_two_or_larger_than_forty(self, groups):
        """One member is not a group, it is the structure. Above forty the
        concept has stopped naming a group and started naming a body region."""
        low, high = groups["bounds"]["min"], groups["bounds"]["max"]
        for g in groups["groups"]:
            assert low <= len(g["members"]) <= high, f"{g['id']} {g['name']}"

    def test_members_are_sorted_and_distinct(self, groups):
        for g in groups["groups"]:
            assert g["members"] == sorted(set(g["members"])), g["id"]

    def test_no_two_groups_share_a_membership(self, groups):
        """Identical member sets collapse into one group with several names.
        Two groups with the same members would be the same selection offered
        twice under different labels."""
        seen: dict[tuple[int, ...], str] = {}
        for g in groups["groups"]:
            key = tuple(g["members"])
            assert key not in seen, f"{g['id']} duplicates {seen.get(key)}"
            seen[key] = g["id"]

    def test_every_concept_id_is_unique_across_names_and_aliases(self, groups):
        seen = set()
        for g in groups["groups"]:
            for cid in [g["id"], *(a["id"] for a in g["aliases"])]:
                assert cid not in seen, f"{cid} appears twice"
                assert re.fullmatch(r"FMA\d+", cid), cid
                seen.add(cid)


class TestTheCuration:
    def test_every_curated_concept_exists_in_the_table(self, groups, curated):
        """The one that fails silently in a browser: a curated id the build no
        longer emits costs a group and says nothing."""
        known = set()
        for g in groups["groups"]:
            known.add(g["id"])
            known.update(a["id"] for a in g["aliases"])
        missing = [r.fma for r in curated if r.fma not in known]
        assert not missing, f"groups.js names concepts the build did not emit: {missing}"

    def test_no_concept_is_curated_twice(self, curated):
        ids = [r.fma for r in curated]
        assert len(ids) == len(set(ids))

    def test_no_two_curated_groups_are_the_same_selection(self, groups, curated):
        """Different concept ids can name the same member set -- the twelve
        thoracic vertebrae are four different concepts. Offering two of them is
        offering the reader the same twelve bones twice."""
        home = {}
        for g in groups["groups"]:
            home[g["id"]] = g["id"]
            for a in g["aliases"]:
                home[a["id"]] = g["id"]
        seen: dict[str, str] = {}
        for r in curated:
            key = home[r.fma]
            assert key not in seen, f"{r.fma} and {seen[key]} select the same structures"
            seen[key] = r.fma

    def test_every_region_is_one_the_interface_offers(self, curated):
        source = CURATION.read_text(encoding="utf-8")
        offered = set(re.findall(r"\{ id: '(\w+)',\s+en:", source))
        assert offered, "GROUP_REGIONS did not parse"
        for r in curated:
            assert r.region in offered, \
                f"{r.fma} is filed under an unknown region {r.region!r}"

    def test_the_korean_is_written_out(self, curated):
        """Not transliterated, and not left as the English. A Korean reader
        getting `muscle of free lower limb` back is worse than no Korean."""
        for r in curated:
            assert re.search(r"[가-힣]", r.ko), f"{r.fma} has no Hangul in {r.ko!r}"

    def test_every_exclusion_still_names_a_member_of_its_group(
            self, groups, structures, curated, excluded):
        """The one place membership is edited by hand, held against the derived table.

        `groups.js` narrows "Abdominal muscles" by subtracting names -- the pelvic floor,
        the anal sphincter, and two structures that are not muscles -- rather than by
        listing the members it wants. The difference matters: a replacement list drifts
        silently when the atlas renumbers, and a subtraction cannot, *provided somebody
        checks that each name still hits something*. Nothing checked it until here. An
        exclusion that matches nothing means the group has quietly grown back the member
        the curation existed to keep out.
        """
        home = {}
        for g in groups["groups"]:
            for cid in [g["id"], *(a["id"] for a in g["aliases"])]:
                home[cid] = g
        name = {s["id"]: s["name"].lower() for s in structures}
        for row in curated:
            if not row.exclude:
                continue
            names = excluded.get(row.exclude)
            assert names, f"{row.fma} excludes {row.exclude}, which groups.js does not define"
            members = {name.get(m, "") for m in home[row.fma]["members"]}
            for n in names:
                assert n.lower() in members, (
                    f"{row.fma} excludes {n!r}, which is not in "
                    f"{home[row.fma]['name']!r} any more -- the group has grown back "
                    f"what the curation kept out")

    def test_the_core_a_pilates_studio_teaches_is_covered(self, groups, curated):
        """The groups this application exists for. A curation that quietly
        stopped offering the pelvic floor would still pass every test above."""
        home = {}
        for g in groups["groups"]:
            for cid in [g["id"], *(a["id"] for a in g["aliases"])]:
                home[cid] = g
        chosen = {home[r.fma]["name"] for r in curated}
        for required in ["pelvic diaphragm", "musculature of abdomen",
                         "muscle of vertebral column", "quadriceps femoris",
                         "medial compartment of thigh", "posterior compartment of thigh",
                         "gluteal muscle", "intrinsic muscle of shoulder"]:
            assert required in chosen, f"the curation no longer offers {required!r}"


class TestTheTableMatchesTheAtlasItWasBuiltFrom:
    """Group membership is a list of *ids*, and ids move when the atlas rebuilds.

    Splitting six muscles renumbered two hundred structures. `groups.json` was
    not regenerated, so every id in it still resolved -- to a different
    structure. The intercostal group came back holding extensor carpi radialis
    brevis and gluteus minimus, and the only thing that noticed was a Korean
    register test three files away, by luck.

    So this checks the join directly: a group named after a muscle family has to
    contain members whose names say so. It is cheap, it needs nothing fetched,
    and it fails the moment the two files drift apart.
    """

    FAMILIES = {
        "FMA13354": "intercostal",
        "FMA77177": "iliocostalis",
        "FMA77178": "longissimus",
        "FMA22823": "semispinalis",
        "FMA77180": "splenius",
        "FMA23081": "rotator",
        "FMA64922": "glute",
        "FMA19083": "obturator",
        "FMA64829": "scalen",
        "FMA22428": "vastus",
        "FMA45157": "semi",
        "FMA13400": "serratus posterior",
    }

    def test_a_family_group_holds_members_of_that_family(self, groups, structures):
        name_of = {s["id"]: s["name"].lower() for s in structures}
        home = {}
        for g in groups["groups"]:
            for cid in [g["id"], *(a["id"] for a in g["aliases"])]:
                home[cid] = g
        for fma, word in self.FAMILIES.items():
            g = home.get(fma)
            assert g, f"{fma} is no longer a group"
            names = [name_of[m] for m in g["members"]]
            assert any(word in n for n in names), (
                f"{g['name']} ({fma}) holds {names[:4]} -- no member is a "
                f"{word!r}, so groups.json and structures.json have drifted")

    def test_the_split_muscles_land_in_their_own_groups(self, groups, structures):
        """Six muscles are now their named parts. A group that used to hold the
        whole muscle should hold the parts, not an id that moved on."""
        name_of = {s["id"]: s["name"].lower() for s in structures}
        found = set()
        for g in groups["groups"]:
            for m in g["members"]:
                n = name_of[m]
                for whole in ("trapezius", "deltoid", "pectoralis major",
                              "triceps brachii", "biceps femoris", "gastrocnemius"):
                    if whole in n:
                        found.add(whole)
        assert found == {"trapezius", "deltoid", "pectoralis major",
                         "triceps brachii", "biceps femoris", "gastrocnemius"}, (
            f"only {sorted(found)} reach a group")


@pytest.mark.skipif(not (BPDATA / "isa_inclusion_relation_list.txt").exists(),
                    reason="BodyParts3D tables not fetched -- see scripts/fetch_bodyparts3d.sh")
def test_the_table_is_exactly_what_the_ontology_says(groups, structures):
    """Re-derive it. This is the whole provenance claim in one assertion: if a
    membership was ever edited by hand, this fails."""
    import importlib.util

    spec = importlib.util.spec_from_file_location(
        "build_groups", WEB / "scripts" / "build_groups.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    fresh = module.build(structures)
    assert len(fresh) == len(groups["groups"])
    committed = {g["id"]: g for g in groups["groups"]}
    for g in fresh:
        assert g["id"] in committed, f"{g['id']} {g['name']} is missing from the committed file"
        assert g["members"] == committed[g["id"]]["members"], g["id"]
        assert g["name"] == committed[g["id"]]["name"], g["id"]
