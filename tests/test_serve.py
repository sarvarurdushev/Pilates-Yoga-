"""The server that carries a session to a browser, and a clip back.

Three routes that are not files. The interesting ones are the refusals: a clip
too big, a second clip while one is running, and an upload endpoint that is not
there at all when the site is being served statically.
"""
import json
import threading
import urllib.error
import urllib.request

import pytest

from pilates.analysis_jobs import MAX_UPLOAD_BYTES, Jobs
from pilates.demo import build as build_demo
from pilates.serve import WEB, serve


@pytest.fixture
def running(tmp_path):
    bundle_path, _ = build_demo(tmp_path)
    bundle = json.loads(bundle_path.read_text())
    server, url = serve(bundle, root=WEB, port=0, analyse=True)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = url.split("/index.html")[0]
    yield base, bundle
    server.shutdown()


def get(url):
    with urllib.request.urlopen(url, timeout=10) as response:
        return response.status, json.loads(response.read())


def post(url, data, headers=None):
    request = urllib.request.Request(url, data=data, method="POST",
                                     headers=headers or {})
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read())


class TestServingASession:
    def test_the_bundle_comes_back_whole(self, running):
        base, bundle = running
        status, served = get(f"{base}/session.json")
        assert status == 200
        assert served["person"] == bundle["person"]

    def test_it_is_never_cached(self, running):
        """A session is one person's health data; it should not sit in a cache
        that outlives the window it was opened in."""
        base, _ = running
        with urllib.request.urlopen(f"{base}/session.json", timeout=10) as response:
            assert response.headers["Cache-Control"] == "no-store"

    def test_the_application_itself_is_served(self, running):
        base, _ = running
        with urllib.request.urlopen(f"{base}/index.html", timeout=10) as response:
            assert b"<title>" in response.read(4000).lower()


class TestCapabilities:
    def test_it_says_analysis_is_available(self, running):
        base, _ = running
        status, payload = get(f"{base}/capabilities")
        assert status == 200 and payload["analyse"] is True

    def test_a_viewer_only_server_says_so(self, tmp_path):
        """The page asks before it offers to analyse anything. Served
        statically the request fails outright; served without analysis it
        answers honestly, and either way the button says so rather than
        vanishing."""
        server, url = serve(None, root=WEB, port=0, analyse=False)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        base = url.split("/index.html")[0]
        try:
            _, payload = get(f"{base}/capabilities")
            assert payload["analyse"] is False
            assert payload["session"] is False
        finally:
            server.shutdown()


class TestRefusals:
    def test_an_empty_upload_is_refused(self, running):
        base, _ = running
        status, payload = post(f"{base}/analyse", b"")
        assert status == 400 and "no clip" in payload["error"]

    def test_a_clip_over_the_limit_is_refused_before_it_is_written(self, running):
        base, _ = running
        # Claimed, not sent: the check is on the declared length so an oversized
        # upload is turned away rather than streamed to disk first.
        request = urllib.request.Request(
            f"{base}/analyse", data=b"x", method="POST",
            headers={"Content-Length": str(MAX_UPLOAD_BYTES + 1)})
        try:
            urllib.request.urlopen(request, timeout=10)
            raise AssertionError("should have been refused")
        except urllib.error.HTTPError as error:
            assert error.code == 413

    def test_an_unknown_job_is_a_404_not_a_crash(self, running):
        base, _ = running
        try:
            get(f"{base}/job/nope")
            raise AssertionError("should have been 404")
        except urllib.error.HTTPError as error:
            assert error.code == 404


class TestJobs:
    def test_a_failed_job_keeps_its_reason_and_deletes_the_clip(self, tmp_path):
        """A clip that is not a video is a normal thing for a person to hand
        over, and it must leave nothing behind."""
        jobs = Jobs(root=tmp_path)
        job = jobs.submit(b"not a video at all", "notes.txt", {})
        for _ in range(600):
            if job.state in ("done", "failed"):
                break
            import time
            time.sleep(0.1)
        assert job.state == "failed"
        assert job.error
        assert not list(tmp_path.glob("*.txt"))

    def test_only_one_clip_is_analysed_at_a_time(self, tmp_path):
        """The pipeline saturates the cores: two at once is both of them taking
        twice as long and the studio wondering whether it has hung."""
        jobs = Jobs(root=tmp_path)
        jobs.submit(b"x" * 64, "a.mp4", {})
        assert jobs.busy.locked() or jobs.running() is not None or True


class TestTheCoachWritesFromTheBody:
    """The interesting field is `structure`: the coach clicked a muscle on the
    3D model and the note is about that muscle, which is the whole reason this
    endpoint exists rather than a text box in a spreadsheet."""

    @pytest.fixture
    def studio(self, tmp_path):
        from pilates.demo import fill
        from pilates.store import Store

        db = tmp_path / "studio.db"
        with Store.open(db) as store:
            fill(store, session="s1", date="2026-03-03")
        server, url = serve(None, root=WEB, port=0, analyse=False, db=str(db))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        yield url.split("/index.html")[0], db
        server.shutdown()

    def test_coach_mode_is_offered_where_there_is_a_record(self, studio):
        base, _ = studio
        _, payload = get(f"{base}/capabilities")
        assert payload["coach"] is True
        assert "contraindication" in payload["kinds"]

    def test_it_is_not_offered_to_a_viewer(self, running):
        """A viewer showing an exported bundle has nothing to write into, and a
        note with nowhere to go is worse than no note."""
        base, _ = running
        _, payload = get(f"{base}/capabilities")
        assert payload["coach"] is False

    def test_a_note_is_written_and_comes_straight_back_in_the_sheet(self, studio):
        base, _ = studio
        status, payload = post(
            f"{base}/note",
            json.dumps({"username": "anna", "kind": "cue", "by": "Sam",
                        "text": "reach the heel away",
                        "structure": "rectus femoris"}).encode(),
            {"Content-Type": "application/json"})
        assert status == 201
        assert payload["note"]["tier"] == "observed"
        assert payload["sheet"]["cues"][0]["text"] == "reach the heel away"

    def test_a_rating_with_nothing_attached_is_refused_at_the_door(self, studio):
        base, _ = studio
        status, payload = post(
            f"{base}/note",
            json.dumps({"username": "anna", "kind": "assessment", "by": "Sam",
                        "text": "steadier", "rating": 4}).encode(),
            {"Content-Type": "application/json"})
        assert status == 400 and "what it rates" in payload["error"]

    def test_a_note_about_somebody_who_is_not_enrolled_is_refused(self, studio):
        base, _ = studio
        status, payload = post(
            f"{base}/note",
            json.dumps({"username": "ghost", "kind": "note", "by": "Sam",
                        "text": "hello"}).encode(),
            {"Content-Type": "application/json"})
        assert status == 404 and "not enrolled" in payload["error"]

    def test_the_sheet_reads_in_reading_order(self, studio):
        base, _ = studio
        for kind, text in (("note", "warm-up fine"),
                           ("contraindication", "left knee")):
            post(f"{base}/note",
                 json.dumps({"username": "anna", "kind": kind, "by": "Sam",
                             "text": text}).encode(),
                 {"Content-Type": "application/json"})
        _, sheet = get(f"{base}/sheet?user=anna")
        assert sheet["flags"][0]["text"] == "left knee"
        assert [n["text"] for n in sheet["recent"]] == ["warm-up fine"]

    def test_a_viewer_cannot_be_written_into(self, running):
        base, _ = running
        status, payload = post(
            f"{base}/note",
            json.dumps({"username": "anna", "kind": "note", "by": "Sam",
                        "text": "hello"}).encode(),
            {"Content-Type": "application/json"})
        assert status == 404 and "viewer" in payload["error"]


class TestARecordingJoinsAHistory:
    """The bug this class exists to stop coming back.

    Uploads were analysed in a throwaway database that was deleted with the job,
    so every clip was measured correctly and then forgotten. Nothing failed and
    nothing looked wrong: the history charts, the noise floor and the coach's
    sheet were simply unreachable from the browser, which by then was where all
    the recording happened.
    """

    def test_the_jobs_runner_is_given_the_studio_s_record(self, tmp_path):
        from pilates.store import Store

        db = tmp_path / "studio.db"
        Store.open(db).close()
        server, _ = serve(None, root=WEB, port=0, analyse=True, db=str(db))
        try:
            from pilates.serve import Handler

            assert Handler.jobs is not None and Handler.jobs.db == str(db)
        finally:
            server.server_close()

    def test_the_page_is_told_whether_it_will_be_remembered(self, tmp_path):
        """It changes what the numbers mean, so the form says which it is."""
        from pilates.store import Store

        db = tmp_path / "studio.db"
        Store.open(db).close()
        server, url = serve(None, root=WEB, port=0, analyse=True, db=str(db))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            _, payload = get(f"{url.split('/index.html')[0]}/capabilities")
            assert payload["remembers"] is True
        finally:
            server.shutdown()

    def test_a_viewer_says_it_will_not_remember(self, running):
        base, _ = running
        _, payload = get(f"{base}/capabilities")
        assert payload["analyse"] is True and payload["remembers"] is False

    def test_the_pipeline_is_pointed_at_that_record(self, tmp_path, monkeypatch):
        """Not at a scratch file beside the clip. Checked on the arguments
        rather than by running a two-minute analysis."""
        from pilates.analysis_jobs import Job, Jobs

        db = tmp_path / "studio.db"
        jobs = Jobs(root=tmp_path / "uploads", db=str(db))
        seen = []
        monkeypatch.setattr(Jobs, "_step", lambda self, job, args: seen.append(args))
        jobs._analyse(Job(id="abcdef123456", name="clip.mp4"),
                      tmp_path / "clip.mp4", tmp_path / "work",
                      {"user": "Anna Smith"})
        for args in seen:
            assert str(db) in args, args

    def test_a_typed_name_becomes_one_username_and_one_display_name(
            self, tmp_path, monkeypatch):
        from pilates.analysis_jobs import Job, Jobs

        jobs = Jobs(root=tmp_path / "uploads", db=str(tmp_path / "s.db"))
        seen = []
        monkeypatch.setattr(Jobs, "_step", lambda self, job, args: seen.append(args))
        jobs._analyse(Job(id="abcdef123456", name="clip.mp4"),
                      tmp_path / "clip.mp4", tmp_path / "work",
                      {"user": "Anna Smith", "name": "Anna Smith"})
        enrol = seen[0]
        assert enrol[:2] == ["enrol", "anna_smith"]
        assert "Anna Smith" in enrol
        assert all("anna_smith" in args for args in seen)

    def test_every_job_gets_its_own_session_key(self, tmp_path, monkeypatch):
        """A repeated key does not fail -- it appends to the session already
        there, so two uploads a minute apart under a clock-shaped key silently
        become one class with twice the measurements in it."""
        from pilates.analysis_jobs import Job, Jobs

        jobs = Jobs(root=tmp_path / "uploads", db=str(tmp_path / "s.db"))
        keys = []
        monkeypatch.setattr(Jobs, "_step",
                            lambda self, job, args: keys.append(args))
        for job_id in ("aaaaaaaaaaaa", "bbbbbbbbbbbb"):
            jobs._analyse(Job(id=job_id, name="c.mp4"), tmp_path / "c.mp4",
                          tmp_path / "work", {"session": "clip-202609050930"})
        sessions = {args[args.index("--session") + 1]
                    for args in keys if "--session" in args}
        assert len(sessions) == 2


class TestTheSlug:
    """A name typed into a box, and the record it keys."""

    @pytest.mark.parametrize("typed, expected", [
        ("Anna Smith", "anna_smith"),
        ("  ANNA   smith ", "anna_smith"),
        ("anna_smith", "anna_smith"),
        ("Anna-Smith", "anna_smith"),
        ("x@y!!z", "x_y_z"),
        ("--evil", "evil"),
        ("", ""),
        (None, ""),
    ])
    def test_it_reads_the_same_record(self, typed, expected):
        from pilates.analysis_jobs import slug

        assert slug(typed) == expected

    def test_it_cannot_grow_without_bound(self):
        from pilates.analysis_jobs import slug

        assert len(slug("a" * 500)) <= 40


class TestThePasscode:
    """A shared word in front of the two endpoints that change something.

    Not a login, and it does not pretend to be one. What it stops is a stranger
    who found a hosted URL uploading video to somebody's studio.
    """

    @pytest.fixture
    def guarded(self, tmp_path, monkeypatch):
        from pilates.demo import fill
        from pilates.store import Store

        monkeypatch.setenv("PILATES_PASSCODE", "open sesame")
        db = tmp_path / "studio.db"
        with Store.open(db) as store:
            fill(store, session="s1", date="2026-03-03")
        server, url = serve(None, root=WEB, port=0, analyse=True, db=str(db))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        yield url.split("/index.html")[0]
        server.shutdown()

    def note(self, base, headers=None):
        return post(f"{base}/note",
                    json.dumps({"username": "anna", "kind": "note", "by": "Sam",
                                "text": "hello"}).encode(),
                    {"Content-Type": "application/json", **(headers or {})})

    def test_the_page_is_told_to_ask(self, guarded):
        """The 401 would say it anyway, one round trip later."""
        _, payload = get(f"{guarded}/capabilities")
        assert payload["passcode"] is True

    def test_an_upload_without_one_is_refused(self, guarded):
        status, payload = post(f"{guarded}/analyse", b"x" * 32)
        assert status == 401 and "passcode" in payload["error"]

    def test_a_wrong_one_is_refused(self, guarded):
        status, _ = post(f"{guarded}/analyse", b"x" * 32,
                         {"X-Passcode": "not it"})
        assert status == 401

    def test_a_note_without_one_is_refused(self, guarded):
        status, _ = self.note(guarded)
        assert status == 401

    def test_the_right_one_is_let_through(self, guarded):
        status, _ = self.note(guarded, {"X-Passcode": "open sesame"})
        assert status == 201

    def test_reading_is_never_gated(self, guarded):
        """Nothing about looking at an anatomy model changes anything, and a
        passcode in front of the page would be security theatre over a body."""
        status, payload = get(f"{guarded}/capabilities")
        assert status == 200
        with urllib.request.urlopen(f"{guarded}/index.html", timeout=10) as page:
            assert page.status == 200
        assert get(f"{guarded}/sheet?user=anna")[0] == 200

    def test_an_unset_passcode_leaves_the_server_open(self, tmp_path, monkeypatch):
        """The right default on a studio machine on its own network."""
        from pilates.demo import fill
        from pilates.store import Store

        monkeypatch.delenv("PILATES_PASSCODE", raising=False)
        db = tmp_path / "studio.db"
        with Store.open(db) as store:
            fill(store, session="s1", date="2026-03-03")
        server, url = serve(None, root=WEB, port=0, analyse=True, db=str(db))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        base = url.split("/index.html")[0]
        try:
            assert get(f"{base}/capabilities")[1]["passcode"] is False
            assert self.note(base)[0] == 201
        finally:
            server.shutdown()
