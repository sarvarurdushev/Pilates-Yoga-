"""Where course video and pictures may come from, and the one that is switched off.

``data/content_sources.json`` lists the allowed sources, the repository's own
labelled assets, and an import manifest for stock clips. Nothing is fetched
from the internet automatically: a stock clip enters the manifest only after a
person watched it and checked its licence page.

Providers share one rule: whatever they supply starts unreviewed, and only a
SEDENS reviewer can mark a movement reviewed.
"""

from __future__ import annotations

from functools import lru_cache
import json
from pathlib import Path

from .util import Denied

SOURCES = Path(__file__).resolve().parents[2] / "data" / "content_sources.json"
REPO = Path(__file__).resolve().parents[2]
STOCK_LABEL = {"en": "Demo media — movement not yet expert reviewed", "ko": "데모 미디어 — 동작은 아직 전문가 검토 전"}
# What a creator's upload shows: the creator uploaded it (it need not be their own work), nobody at SEDENS
# has reviewed the movement.
CREATOR_LABEL = {"en": "Creator-uploaded media — movement not yet expert reviewed",
                 "ko": "제작자가 올린 미디어 — 동작은 아직 전문가 검토 전"}
GENERATION_WORKFLOW = ("approved_reference", "generation", "comparison", "expert_review", "publish")


@lru_cache(maxsize=1)
def registry() -> dict:
    return json.loads(SOURCES.read_text())


def repo_asset(asset_id: str) -> dict | None:
    return next((a for a in registry()["assets"] if a["id"] == asset_id), None)


def label_for(source, licence_type, repo_asset=None, sha256=None) -> dict:
    """The label shown with any course file: never an endorsement, never an expert claim.

    A repository asset shows its own registry label, a stock clip the stock label, and a
    creator's upload the creator label. Rights approval does not change any of them."""
    if source == "repo":
        asset = repo_asset_by(repo_asset, sha256)
        if asset and asset.get("label"):
            return asset["label"]
        return STOCK_LABEL
    if licence_type in ("pexels", "pixabay"):
        return STOCK_LABEL
    return CREATOR_LABEL


def repo_asset_by(asset_id=None, sha256=None) -> dict | None:
    return next((a for a in registry()["assets"] if (asset_id and a["id"] == asset_id)
                 or (not asset_id and sha256 and a["sha256"] == sha256)), None)


class VideoProvider:
    name = ""
    enabled = True
    # Everything a provider supplies needs a person's review before it is called reviewed.
    starts_reviewed = False

    def describe(self) -> dict:
        return {"name": self.name, "enabled": self.enabled, "starts_reviewed": self.starts_reviewed}


class UploadedVideoProvider(VideoProvider):
    """A creator's own upload, with rights metadata and the attestation."""

    name = "creator_upload"


class RepoMediaProvider(VideoProvider):
    """The repository's own labelled assets (listed in content_sources.json)."""

    name = "repo"

    def assets(self) -> list[dict]:
        return registry()["assets"]


class LicensedStockVideoProvider(VideoProvider):
    """Pexels or Pixabay clips a person checked and listed in the import manifest."""

    name = "stock"
    label = STOCK_LABEL

    def entries(self) -> list[dict]:
        return registry()["import_manifest"]["entries"]


class HiggsfieldVideoProvider(VideoProvider):
    """Inactive. Needs no API key to load, and refuses every request.

    The future workflow is ``GENERATION_WORKFLOW``: an approved reference
    movement is generated, compared (automatically and by a person), reviewed by
    an expert and only then published. Generated video is never approved
    automatically, and no generated output is stored until that review exists.
    """

    name = "higgsfield"
    enabled = False
    workflow = GENERATION_WORKFLOW

    def generate(self, **_request):
        raise Denied("Video generation is not switched on in SEDENS.", 503, "provider_disabled")


PROVIDERS = {p.name: p for p in (UploadedVideoProvider(), RepoMediaProvider(), LicensedStockVideoProvider(),
                                  HiggsfieldVideoProvider())}


def problems() -> list[str]:
    """Integrity checks for the registry (empty when sound)."""
    import hashlib

    found = []
    doc = registry()
    for asset in doc["assets"]:
        path = (REPO / asset["path"]).resolve()
        if not path.is_relative_to(REPO / "web" / "assets") or not path.is_file():
            found.append(f"{asset['id']}: file missing or outside web/assets")
            continue
        if hashlib.sha256(path.read_bytes()).hexdigest() != asset["sha256"]:
            found.append(f"{asset['id']}: file changed since it was registered")
        rights = asset.get("rights") or {}
        for field in ("licence_type", "original_creator", "restrictions", "identifiable_person", "review_status"):
            if not rights.get(field):
                found.append(f"{asset['id']}: rights.{field} missing")
    for entry in doc["import_manifest"]["entries"]:
        if not (entry.get("checked_by") and entry.get("checked_at") and entry.get("licence_url") and entry.get("sha256")):
            found.append(f"{entry.get('id', '?')}: a stock clip needs who checked it, when, its licence page and checksum")
    if any(s["id"] == "higgsfield" and s["enabled"] for s in doc["sources"]):
        found.append("higgsfield must stay disabled")
    return found
