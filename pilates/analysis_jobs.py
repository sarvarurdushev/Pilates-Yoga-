"""Run the pipeline on an uploaded clip, and let a browser watch it happen.

Analysis takes minutes on a laptop -- roughly a fifth of a second per analysed
frame on four cores -- so a request that waits for it is a request that times
out. A clip is handed over, a job id comes back, and the page asks how it is
going. That is also what makes the progress readable: the pipeline already
prints what it is doing, and this keeps the last few lines so the page can show
them instead of a spinner that says nothing.

**The pipeline runs as a subprocess, deliberately.** It is the same
``pilates capture`` a studio would type, so there is one analysis path rather
than a library one and a web one that drift apart. It also means a clip that
crashes the decoder takes down a subprocess and not the server somebody is
watching.

**Uploads are held on disk for exactly as long as the job.** A video of a person
is the most sensitive thing this system ever touches, and the whole design is
built on not keeping it: the measurements and the pose stream survive, the
footage does not. The temporary file is removed when the job finishes, whether
it succeeded or not.

**The measurements go into the studio's own record, not a scratch file.** The
first version analysed every upload in a throwaway database and returned the
bundle: each clip was measured correctly and then forgotten, so the second
recording of the same person knew nothing about the first. That makes the
history charts, the noise floor and the coach's sheet unreachable from the
browser -- which is where all the recording now happens. Given a database, this
writes into it and every clip becomes another point on the line. Given none, it
still falls back to a scratch file, because a viewer serving one exported bundle
has nowhere to write and should still be able to measure a clip.
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path

#: Bigger than this and it is refused before anything is written to disk. Ten
#: minutes of phone video is comfortably inside it; a feature film is not.
MAX_UPLOAD_BYTES = 512 * 1024 * 1024

#: How many lines of the pipeline's own output to keep for the page.
KEEP_LINES = 12

QUEUED, RUNNING, DONE, FAILED = "queued", "running", "done", "failed"


def slug(name: str | None) -> str:
    """A username out of whatever somebody typed into the box.

    The browser asks for a name in the words a person uses -- "Anna Smith" --
    and the record is keyed on a username. Lower-cased, spaces to underscores,
    everything else dropped: two people typing the same name land on the same
    record, which is the whole point, and one typing a stray comma does not
    become a second person.
    """
    kept = "".join(c if c.isalnum() else "_" for c in (name or "").strip().lower())
    return "_".join(part for part in kept.split("_") if part)[:40]


@dataclass
class Job:
    """One clip being analysed."""

    id: str
    name: str
    state: str = QUEUED
    lines: list[str] = field(default_factory=list)
    bundle: dict | None = None
    error: str = ""
    started: float = field(default_factory=time.time)
    finished: float = 0.0

    def public(self) -> dict:
        """What the page is told. The bundle only travels once, at the end."""
        return {
            "id": self.id, "name": self.name, "state": self.state,
            "lines": self.lines[-KEEP_LINES:], "error": self.error,
            "seconds": round((self.finished or time.time()) - self.started, 1),
            "bundle": self.bundle if self.state == DONE else None,
        }


class Jobs:
    """Every analysis this server has run, and the one it is running now.

    One at a time. The pipeline saturates the machine's cores, so two clips at
    once is not twice the throughput -- it is both of them taking twice as long
    and the studio wondering whether it has hung.
    """

    def __init__(self, root: Path | None = None, db: str = ""):
        self.jobs: dict[str, Job] = {}
        self.lock = threading.Lock()
        self.root = root or Path(tempfile.gettempdir()) / "pilates-uploads"
        self.root.mkdir(parents=True, exist_ok=True)
        self.busy = threading.Lock()
        #: The studio's record. Every clip analysed here is written into it, so
        #: a person recorded twice has a history rather than two unrelated
        #: readings. Empty means there is no record and each clip is measured
        #: on its own.
        self.db = db

    def get(self, job_id: str) -> Job | None:
        return self.jobs.get(job_id)

    def running(self) -> Job | None:
        return next((j for j in self.jobs.values() if j.state == RUNNING), None)

    def submit(self, data: bytes, name: str, options: dict) -> Job:
        """Take a clip and start work on it."""
        job = Job(id=uuid.uuid4().hex[:12], name=name or "clip")
        self.jobs[job.id] = job
        suffix = Path(name or "clip.mp4").suffix or ".mp4"
        path = self.root / f"{job.id}{suffix}"
        path.write_bytes(data)
        threading.Thread(target=self._run, args=(job, path, options),
                         daemon=True).start()
        return job

    # -- the work ---------------------------------------------------------
    def _run(self, job: Job, video: Path, options: dict) -> None:
        with self.busy:
            work = Path(tempfile.mkdtemp(prefix=f"pilates-{job.id}-"))
            try:
                job.state = RUNNING
                self._analyse(job, video, work, options)
                job.state = DONE if job.bundle else FAILED
                if not job.bundle and not job.error:
                    job.error = "the pipeline produced no measurements"
            except Exception as exc:                      # noqa: BLE001
                job.state = FAILED
                job.error = str(exc)
            finally:
                job.finished = time.time()
                # The footage goes, whatever happened. That is the whole design.
                video.unlink(missing_ok=True)
                shutil.rmtree(work, ignore_errors=True)

    def _analyse(self, job: Job, video: Path, work: Path, options: dict) -> None:
        db = Path(self.db) if self.db else work / "session.db"
        person = slug(options.get("user")) or "you"
        # Unique per job, always. A repeated session key does not fail -- it
        # appends to the session already there, so two uploads a minute apart
        # under a clock-shaped key silently become one class with twice the
        # measurements in it.
        session = f"{options.get('session') or 'clip'}-{job.id[:6]}"

        # The display name is what they typed; the username is the slug of it.
        # "Anna Smith" reads back as Anna Smith and is keyed on anna_smith.
        display = (options.get("name") or options.get("user") or person).strip()
        self._step(job, ["enrol", person, "--name", display, "--db", str(db)])

        capture = ["capture", str(video), "--session", session, "--user", person,
                   "--by", "self", "--db", str(db)]
        for flag, key in (("--date", "date"), ("--studio", "studio"),
                          ("--exercise", "exercise"), ("--mass", "mass"),
                          ("--height", "height"), ("--stride", "stride")):
            if options.get(key):
                capture += [flag, str(options[key])]
        self._step(job, capture)

        out = work / "bundle.json"
        # A bundle is one class -- that is what it means. What makes the second
        # upload worth more than the first is not in this argument list: the
        # history block inside the bundle is collected across every session in
        # the database, so pointing the pipeline at the studio's own record
        # instead of a scratch file is the whole of the change.
        self._step(job, ["bundle", person, "--session", session, "--db", str(db),
                         "--out", str(out), "--no-poses"])
        if out.exists():
            job.bundle = json.loads(out.read_text())

    def _step(self, job: Job, args: list[str]) -> None:
        """Run one pilates command, keeping its output for the page."""
        job.lines.append(f"$ pilates {' '.join(args[:3])} …")
        process = subprocess.Popen(
            [sys.executable, "-m", "pilates", *args],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
            bufsize=1)
        for line in process.stdout:                        # type: ignore[union-attr]
            line = line.rstrip()
            if line:
                job.lines.append(line)
        code = process.wait()
        if code != 0:
            tail = "; ".join(job.lines[-3:])
            raise RuntimeError(f"pilates {args[0]} failed: {tail}")
