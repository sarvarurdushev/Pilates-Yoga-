"""Import a checked stock clip into the repository, or refuse it with a plain reason.

``data/content_sources.json`` holds an import manifest. A clip is listed there only after a
person watched it, checked the movement and read the licence page. This command validates
the entries and, for ``--register``, copies the local file into ``web/assets/stock/``,
adds a labelled asset to the registry and links it to the SEDENS Standard exercise it shows.

    python -m pilates.sedens.media_import --check
    python -m pilates.sedens.media_import --register <entry id> <local file>

Nothing is downloaded. The command never fetches a page or a file: a person gets the file
first, writes the manifest entry (every field below), and only then registers it. Social
media, video sites and generators are never sources, and an entry that is incomplete,
whose file does not match its recorded checksum, or that names an exercise SEDENS does
not have is refused with a message that says which field to fix.

A registered clip always carries the label "Stock footage — movement not yet expert
reviewed". Registering a file never marks a movement as reviewed.
"""

from __future__ import annotations

import argparse
from datetime import date
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sys
from urllib.parse import urlsplit

from . import course_media, media_store
from .util import Denied

ROOT = Path(__file__).resolve().parents[2]
SOURCES = Path("data") / "content_sources.json"
STANDARD = Path("data") / "sedens_standard" / "exercises.v1.json"
FOLDER = Path("web") / "assets" / "stock"
LABEL = {"en": "Stock footage — movement not yet expert reviewed",
         "ko": "스톡 영상 — 동작은 아직 전문가 검토 전"}
ID = re.compile(r"[a-z0-9][a-z0-9-]{2,60}")
SHA256 = re.compile(r"[0-9a-f]{64}")
ISO_DATE = re.compile(r"\d{4}-\d{2}-\d{2}")
# Never sources, whatever the registry says; checked by id and by the address of every link.
FORBIDDEN_SOURCES = ("youtube", "tiktok", "instagram", "facebook", "higgsfield")
FORBIDDEN_HOSTS = ("youtube.com", "youtu.be", "tiktok.com", "instagram.com", "facebook.com", "fb.watch",
                   "higgsfield.ai", "googlevideo.com", "ytimg.com", "vimeo.com", "vimeocdn.com")
# A checker is a person. A name with any of these words in it is refused. The command cannot
# verify that a person really watched the clip; it only turns away obviously automated names.
NOT_A_PERSON = {"ai", "bot", "script", "auto", "automatic", "automated", "claude", "assistant", "model",
                "robot", "agent", "llm", "gpt", "opus", "sonnet", "haiku", "gemini", "chatgpt", "copilot"}
# Words that are also real given names, so they only count when they are the whole name ("AI").
SHORT_WORDS = {"ai", "auto", "model"}
# Stock licences whose own id names the source that publishes them.
SOURCE_LICENCES = ("pexels", "pixabay")
PEOPLE = {"yes": "consented", "no": "none"}
# Fields the manifest's ``entry_fields`` may not list; the command always needs these.
ALWAYS = ("licence",)
LINKS = ("page_url", "file_url", "licence_url")
LONG = {"original_creator": 160, "checked_by": 120, "movement_notes": 1000, "model_release_note": 1000}


class Refused(Exception):
    """An entry or file that cannot be imported; ``problems`` are plain sentences."""

    def __init__(self, problems):
        self.problems = list(problems)
        super().__init__("\n".join(self.problems))


def _read(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _write(path: Path, doc: dict) -> None:
    temp = path.with_name(path.name + ".tmp")
    temp.write_text(json.dumps(doc, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    os.replace(temp, path)


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def _host(url: str) -> str:
    return (urlsplit(url).hostname or "").lower()


def _on(host: str, domain: str) -> bool:
    return host == domain or host.endswith("." + domain)


def _domain(source: dict) -> str:
    """The registrable address of a source, taken from its licence page in the registry."""
    host = _host(source.get("licence_url") or "")
    return host[4:] if host.startswith("www.") else host


def _is_iso_date(value) -> bool:
    if not (isinstance(value, str) and ISO_DATE.fullmatch(value)):
        return False
    try:
        date.fromisoformat(value)
    except ValueError:
        return False
    return True


def required_fields(manifest: dict) -> list[str]:
    return list(dict.fromkeys([*manifest.get("entry_fields", []), *ALWAYS]))


def stock_sources(sources: dict) -> dict:
    """The enabled stock sources by id."""
    return {s["id"]: s for s in sources["sources"] if s.get("enabled") and s.get("kind") == "stock"
            and s["id"] not in FORBIDDEN_SOURCES}


def check_entry(entry: dict, *, sources: dict, exercises: dict, manifest: dict | None = None,
                today: date | None = None) -> list[str]:
    """Everything wrong with one manifest entry (empty when it is complete and well formed).

    Whether the local file matches ``sha256`` is checked separately (:func:`check_file`)."""
    today = today or date.today()
    manifest = manifest if manifest is not None else sources["import_manifest"]
    name = entry.get("id") if isinstance(entry.get("id"), str) and entry.get("id") else "(no id)"
    found: list[str] = []

    def bad(message):
        found.append(f"Entry {name}: {message}")

    for field in required_fields(manifest):
        value = entry.get(field)
        if value is None or (isinstance(value, str) and not value.strip()):
            bad(f"the field '{field}' is missing. Fill it in before importing.")
    if found:
        return found

    if not (isinstance(entry["id"], str) and ID.fullmatch(entry["id"])):
        bad("the id must be 3 to 61 lowercase letters, digits or dashes.")

    # Source: an enabled stock source, never a social network, video site or generator.
    source = str(entry["source"]).strip().lower()
    allowed = stock_sources(sources)
    if source in FORBIDDEN_SOURCES:
        bad(f"'{entry['source']}' is never a source. SEDENS does not use social media, video sites or generated video.")
    elif source not in allowed:
        bad(f"'{entry['source']}' is not an enabled stock source. Enabled: {', '.join(sorted(allowed)) or 'none'}.")

    # Links: https, not a forbidden site, and the page on the source's own site.
    for field in LINKS:
        url = entry[field]
        parts = urlsplit(url) if isinstance(url, str) else None
        if parts is None or parts.scheme != "https" or not parts.hostname or len(url) > 500:
            bad(f"'{field}' must be a web address starting with https:// (up to 500 characters).")
        elif any(_on(parts.hostname.lower(), h) for h in FORBIDDEN_HOSTS):
            bad(f"'{field}' points at a site SEDENS never takes clips from ({parts.hostname}).")
        elif field != "file_url" and source in allowed and _domain(allowed[source]) \
                and not _on(parts.hostname.lower(), _domain(allowed[source])):
            bad(f"'{field}' must be on {_domain(allowed[source])}, the site of the source '{source}'.")

    # Licence: one SEDENS knows; a Pexels or Pixabay licence only from that source.
    licence = entry["licence"]
    if licence not in course_media.LICENCES:
        bad(f"the licence '{licence}' is not one of: {', '.join(course_media.LICENCES)}.")
    elif licence in SOURCE_LICENCES and licence != source:
        bad(f"a {licence} licence can only come from the source '{licence}'.")
    elif source in SOURCE_LICENCES and licence != source:
        bad(f"a clip from {source} is under the {source} licence, not '{licence}'.")

    # Dates, checksum, who checked.
    for field in ("retrieved_at", "checked_at"):
        value = entry[field]
        if not _is_iso_date(value):
            bad(f"'{field}' must be a date written YYYY-MM-DD.")
        elif date.fromisoformat(value) > today:
            bad(f"'{field}' is in the future.")
    if _is_iso_date(entry["retrieved_at"]) and _is_iso_date(entry["checked_at"]) \
            and entry["checked_at"] < entry["retrieved_at"]:
        bad("'checked_at' is before 'retrieved_at'. A person checks the clip after getting it.")
    if not (isinstance(entry["sha256"], str) and SHA256.fullmatch(entry["sha256"])):
        bad("'sha256' must be the 64 lowercase hexadecimal characters of the file's SHA-256.")
    checker = entry["checked_by"]
    if not (isinstance(checker, str) and len(checker.strip()) >= 2) \
            or any(word in NOT_A_PERSON - SHORT_WORDS for word in re.findall(r"[a-z]+", checker.lower())) \
            or re.sub(r"[^a-z]", "", checker.lower()) in NOT_A_PERSON:
        bad("'checked_by' must be the name of the person who watched the clip and read the licence.")
    for field, limit in LONG.items():
        value = entry.get(field)
        if value is not None and not (isinstance(value, str) and len(value) <= limit):
            bad(f"'{field}' must be text of at most {limit} characters.")

    # The exercise, and the person shown.
    if not isinstance(entry["shows_exercise"], str) or entry["shows_exercise"] not in exercises:
        bad(f"'shows_exercise' ({entry['shows_exercise']}) is not a SEDENS Standard exercise id.")
    if entry["identifiable_person"] not in PEOPLE:
        bad("'identifiable_person' must be yes or no.")
    elif entry["identifiable_person"] == "yes" and not str(entry.get("model_release_note") or "").strip():
        bad("a person can be identified in the clip, so 'model_release_note' must say what the source's "
            "licence or a signed release says about showing that person. Never imply they endorse SEDENS.")
    return found


def check_file(entry: dict, path: Path) -> list[str]:
    """The local file against the entry: it exists, is an MP4 or WebM, is small enough and matches ``sha256``."""
    name = entry.get("id") or "(no id)"
    if not path.is_file() or path.is_symlink():
        return [f"Entry {name}: the file {path} does not exist or is not a plain file."]
    found = []
    size = path.stat().st_size
    cap = media_store.limit("demo_free", "video")
    if size == 0 or size > cap:
        found.append(f"Entry {name}: the file must be between 1 byte and {cap // (1024 * 1024)} MB.")
    try:
        media_store.check(path, "video")
    except Denied:
        found.append(f"Entry {name}: the file is not an MP4 or WebM video.")
    if sha256_of(path) != entry.get("sha256"):
        found.append(f"Entry {name}: the file does not match the recorded sha256. It is a different file "
                     "from the one that was checked, so it is refused.")
    return found


def _exercises(root: Path) -> dict:
    return {e["id"]: e for e in _read(root / STANDARD)["exercises"]}


def check_manifest(root: Path = ROOT, today: date | None = None) -> tuple[list[str], list[str]]:
    """(problems, waiting): ``waiting`` lists complete entries whose file is not registered yet."""
    sources = _read(root / SOURCES)
    manifest = sources["import_manifest"]
    exercises = _exercises(root)
    problems: list[str] = []
    waiting: list[str] = []
    entries = manifest.get("entries")
    if not isinstance(entries, list):
        return ["The manifest's 'entries' must be a list."], waiting
    if manifest.get("status") == "empty" and entries:
        problems.append("The manifest says it is empty but lists entries.")
    if manifest.get("status") != "empty" and not entries:
        problems.append("The manifest has no entries but its status is not 'empty'.")
    seen = set()
    for entry in entries:
        found = check_entry(entry, sources=sources, exercises=exercises, manifest=manifest, today=today)
        if entry.get("id") in seen:
            found.append(f"Entry {entry.get('id')}: the id is used twice.")
        seen.add(entry.get("id"))
        local = entry.get("local_path")
        if not found and local:
            path = (root / local).resolve()
            if not path.is_relative_to((root / FOLDER).resolve()):
                found.append(f"Entry {entry['id']}: the registered file must be in {FOLDER}.")
            else:
                found += check_file(entry, path)
            asset = next((a for a in sources["assets"] if a["id"] == entry.get("asset_id")), None)
            if asset is None or asset.get("path") != str(local):
                found.append(f"Entry {entry['id']}: its asset is missing from the registry.")
            elif entry["shows_exercise"] not in exercises or entry["asset_id"] not in \
                    (exercises[entry["shows_exercise"]].get("media") or []):
                found.append(f"Entry {entry['id']}: it is not linked to the exercise it shows.")
        elif not found:
            waiting.append(f"Entry {entry['id']}: complete, waiting for its file. "
                           f"Run --register {entry['id']} <local file>.")
        problems += found
    return problems, waiting


def _asset(entry: dict, exercise: dict, mime: str, relative: Path) -> dict:
    title = exercise["title"]
    person = PEOPLE[entry["identifiable_person"]]
    restrictions = ("Show with the stock footage label. Never imply that anyone shown endorses SEDENS or "
                    "that the movement was reviewed by an expert.")
    if entry["identifiable_person"] == "yes":
        restrictions += f" Release: {entry['model_release_note'].strip()}"
    return {
        "id": "stock-" + entry["id"], "path": relative.as_posix(), "kind": "video", "mime": mime,
        "shows": exercise["catalog_key"],
        "description": {"en": f"Stock footage chosen to show {title['en']}.",
                        "ko": f"{title['ko']} 동작을 보여 주는 스톡 영상이에요."},
        "provenance": f"Imported from {entry['page_url']} (retrieved {entry['retrieved_at']}) and checked by "
                      f"{entry['checked_by'].strip()} on {entry['checked_at']}. Manifest entry: {entry['id']}.",
        "sha256": entry["sha256"],
        "rights": {"licence_type": entry["licence"], "original_creator": entry["original_creator"].strip(),
                   "source_url": entry["page_url"], "licence_url": entry["licence_url"],
                   "restrictions": restrictions, "identifiable_person": person, "review_status": "unreviewed"},
        "label": dict(LABEL),
    }


def register(entry_id: str, local_file, root: Path = ROOT, today: date | None = None) -> dict:
    """Copy a checked clip into the repository and link it to its exercise, or raise :class:`Refused`."""
    root = Path(root)
    sources = _read(root / SOURCES)
    standard = _read(root / STANDARD)
    manifest = sources["import_manifest"]
    entry = next((e for e in manifest.get("entries", []) if e.get("id") == entry_id), None)
    if entry is None:
        raise Refused([f"There is no entry '{entry_id}' in the import manifest. Add the entry first: a person "
                       "records who checked the clip, the licence page and the checksum."])
    if entry.get("local_path"):
        raise Refused([f"Entry {entry_id} is already registered ({entry['local_path']})."])
    exercises = {e["id"]: e for e in standard["exercises"]}
    problems = check_entry(entry, sources=sources, exercises=exercises, manifest=manifest, today=today)
    path = Path(local_file).expanduser()
    if not problems:
        problems = check_file(entry, path)
    if problems:
        raise Refused(problems)

    mime, _ = media_store.check(path, "video")
    relative = FOLDER / (entry["id"] + media_store.EXTENSIONS[mime])
    destination = root / relative
    if destination.exists() or any(a["id"] == "stock-" + entry["id"] for a in sources["assets"]):
        raise Refused([f"Entry {entry_id}: a stock asset with this id already exists."])
    exercise = exercises[entry["shows_exercise"]]
    asset = _asset(entry, exercise, mime, relative)

    before = {SOURCES: (root / SOURCES).read_text(encoding="utf-8"),
              STANDARD: (root / STANDARD).read_text(encoding="utf-8")}
    destination.parent.mkdir(parents=True, exist_ok=True)
    try:
        shutil.copyfile(path, destination)
        if sha256_of(destination) != entry["sha256"]:
            raise Refused([f"Entry {entry_id}: the copy does not match the checksum."])
        sources["assets"].append(asset)
        entry.update(local_path=relative.as_posix(), asset_id=asset["id"],
                     registered_at=(today or date.today()).isoformat())
        manifest["status"] = "has_entries"
        manifest["reason"] = ("Each listed clip was watched and checked by a person. None is expert reviewed; "
                              "every one shows the stock footage label.")
        exercise.setdefault("media", [])
        if asset["id"] not in exercise["media"]:
            exercise["media"].append(asset["id"])
        _write(root / SOURCES, sources)
        _write(root / STANDARD, standard)
    except BaseException:
        destination.unlink(missing_ok=True)
        for name, text in before.items():
            (root / name).write_text(text, encoding="utf-8")
        raise
    return {"asset": asset["id"], "path": relative.as_posix(), "exercise": exercise["id"], "label": LABEL}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="python -m pilates.sedens.media_import", description=__doc__.split("\n\n")[0])
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--check", action="store_true", help="validate every entry of the import manifest")
    group.add_argument("--register", nargs=2, metavar=("ENTRY_ID", "LOCAL_FILE"),
                       help="copy a checked clip into the repository and link it to its exercise")
    args = parser.parse_args(argv)
    try:
        if args.check:
            problems, waiting = check_manifest(ROOT)
            for line in waiting:
                print(line)
            if problems:
                print("The import manifest is not ready:")
                for line in problems:
                    print(" -", line)
                return 1
            entries = len(_read(ROOT / SOURCES)["import_manifest"]["entries"])
            print("The import manifest is empty. No clip has passed the checks." if not entries
                  else f"The import manifest is sound: {entries} entr{'y' if entries == 1 else 'ies'}.")
            return 0
        done = register(*args.register, root=ROOT)
        print(f"Registered {done['asset']} at {done['path']}, linked to {done['exercise']}.")
        print(f"Label: {done['label']['en']}")
        return 0
    except Refused as refusal:
        print("Not imported:", file=sys.stderr)
        for line in refusal.problems:
            print(" -", line, file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
