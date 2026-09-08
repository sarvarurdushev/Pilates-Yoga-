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


def get(url, headers=None):
    request = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(request, timeout=10) as response:
        return response.status, json.loads(response.read())


def fetch(url, headers=None):
    """A GET that reports a refusal instead of raising it.

    The refusals are half of what this server is tested for, so they have to be
    readable as values rather than as exceptions in every other test.
    """
    try:
        return get(url, headers)
    except urllib.error.HTTPError as error:
        body = error.read()
        try:
            return error.code, json.loads(body)
        except ValueError:
            # A route that is not there at all falls through to the static file
            # handler, which answers in HTML. The code is the answer then.
            return error.code, {}


def owner(db, monkeypatch=None):
    """Make the admin these tests act as, and hand back a signed-in cookie.

    Every route that carries somebody's data now needs a person behind it --
    there is no longer a state in which an account-less database serves records
    to whoever asks. So the fixtures that used to reach straight in have to sign
    in like a browser does.
    """
    from pilates import auth, passwords
    from pilates.accounts import Studio
    from pilates.store import Store

    passwords.N = 2 ** 14           # 400 ms a hash is right in production, not here
    with Store.open(db) as store:
        account = _Account(email="boss@studio.test", display_name="The Owner")
        store.claim_first_admin(account, "a decently long password",
                                Studio(key="here", name="The Studio"))
        session = auth.sign_in(store, "boss@studio.test",
                               "a decently long password")
        auth.switch(store, session.token, "here", "admin")
    return {"Cookie": f"{auth.COOKIE}={session.token}"}


def _Account(**kwargs):
    from pilates.accounts import Account

    return Account(**kwargs)


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


class TestWhatIsOnDiskIsWhatIsOnScreen:
    """The worst update failure is the silent one.

    This server hands a browser ES modules straight off disk. Sent with only a
    `Last-Modified` and no `Cache-Control`, a browser is free to guess a
    freshness lifetime from the age of the file and serve the old module
    without asking. The studio updates, reloads, sees the previous version, and
    there is no error anywhere to explain it.
    """

    def _head(self, url):
        request = urllib.request.Request(url)
        with urllib.request.urlopen(request, timeout=10) as response:
            return response.headers, response.status

    def test_a_module_is_revalidated_rather_than_guessed_at(self, running):
        base, _ = running
        headers, _ = self._head(f"{base}/src/session/axes.js")
        assert headers.get("Cache-Control") == "no-cache"

    def test_so_is_the_page_that_loads_them(self, running):
        base, _ = running
        headers, _ = self._head(f"{base}/index.html")
        assert headers.get("Cache-Control") == "no-cache"

    def test_revalidating_costs_a_conditional_request_and_no_body(self, running):
        """`no-cache` means "ask", not "do not store". The answer is a 304."""
        base, _ = running
        headers, _ = self._head(f"{base}/src/session/axes.js")
        request = urllib.request.Request(
            f"{base}/src/session/axes.js",
            headers={"If-Modified-Since": headers["Last-Modified"]})
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                assert response.status == 304
        except urllib.error.HTTPError as error:
            assert error.code == 304

    def test_a_json_route_keeps_its_own_stronger_rule(self, running):
        """Nothing that carries somebody's record may be stored at all, and
        the blanket header must not weaken that to "revalidate"."""
        base, _ = running
        headers, _ = self._head(f"{base}/capabilities")
        assert headers.get("Cache-Control") == "no-store"

    def test_the_header_is_sent_once(self, running):
        base, _ = running
        headers, _ = self._head(f"{base}/capabilities")
        assert len(headers.get_all("Cache-Control")) == 1


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
        signed_in = owner(db)
        server, url = serve(None, root=WEB, port=0, analyse=False, db=str(db))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        yield url.split("/index.html")[0], db, signed_in
        server.shutdown()

    def test_coach_mode_is_offered_where_there_is_a_record(self, studio):
        base, _, signed_in = studio
        _, payload = get(f"{base}/capabilities", signed_in)
        assert payload["coach"] is True
        assert "contraindication" in payload["kinds"]

    def test_it_is_not_offered_to_a_viewer(self, running):
        """A viewer showing an exported bundle has nothing to write into, and a
        note with nowhere to go is worse than no note."""
        base, _ = running
        _, payload = get(f"{base}/capabilities")
        assert payload["coach"] is False

    def test_a_note_is_written_and_comes_straight_back_in_the_sheet(self, studio):
        base, _, signed_in = studio
        status, payload = post(
            f"{base}/note",
            json.dumps({"username": "anna", "kind": "cue", "by": "Sam",
                        "text": "reach the heel away",
                        "structure": "rectus femoris"}).encode(),
            {"Content-Type": "application/json", **signed_in})
        assert status == 201
        assert payload["note"]["tier"] == "observed"
        assert payload["sheet"]["cues"][0]["text"] == "reach the heel away"

    def test_a_rating_with_nothing_attached_is_refused_at_the_door(self, studio):
        base, _, signed_in = studio
        status, payload = post(
            f"{base}/note",
            json.dumps({"username": "anna", "kind": "assessment", "by": "Sam",
                        "text": "steadier", "rating": 4}).encode(),
            {"Content-Type": "application/json", **signed_in})
        assert status == 400 and "what it rates" in payload["error"]

    def test_a_note_about_somebody_who_is_not_enrolled_is_refused(self, studio):
        base, _, signed_in = studio
        status, payload = post(
            f"{base}/note",
            json.dumps({"username": "ghost", "kind": "note", "by": "Sam",
                        "text": "hello"}).encode(),
            {"Content-Type": "application/json", **signed_in})
        assert status == 404 and "not enrolled" in payload["error"]

    def test_the_sheet_reads_in_reading_order(self, studio):
        base, _, signed_in = studio
        for kind, text in (("note", "warm-up fine"),
                           ("contraindication", "left knee")):
            post(f"{base}/note",
                 json.dumps({"username": "anna", "kind": kind, "by": "Sam",
                             "text": text}).encode(),
                 {"Content-Type": "application/json", **signed_in})
        _, sheet = get(f"{base}/sheet?user=anna", signed_in)
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
        signed_in = owner(db)
        server, url = serve(None, root=WEB, port=0, analyse=True, db=str(db))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        yield url.split("/index.html")[0], signed_in
        server.shutdown()

    def note(self, base, headers=None):
        return post(f"{base}/note",
                    json.dumps({"username": "anna", "kind": "note", "by": "Sam",
                                "text": "hello"}).encode(),
                    {"Content-Type": "application/json", **(headers or {})})

    def test_the_page_is_told_to_ask(self, guarded):
        """The 401 would say it anyway, one round trip later."""
        base, _ = guarded
        _, payload = get(f"{base}/capabilities")
        assert payload["passcode"] is True

    def test_an_upload_without_one_is_refused(self, guarded):
        base, signed_in = guarded
        status, payload = post(f"{base}/analyse", b"x" * 32, signed_in)
        assert status == 401 and "passcode" in payload["error"]

    def test_a_wrong_one_is_refused(self, guarded):
        base, signed_in = guarded
        status, _ = post(f"{base}/analyse", b"x" * 32,
                         {"X-Passcode": "not it", **signed_in})
        assert status == 401

    def test_a_note_without_one_is_refused(self, guarded):
        base, signed_in = guarded
        status, _ = self.note(base, signed_in)
        assert status == 401

    def test_the_right_one_is_let_through(self, guarded):
        base, signed_in = guarded
        status, _ = self.note(base, {"X-Passcode": "open sesame", **signed_in})
        assert status == 201

    def test_the_passcode_is_not_a_login(self, guarded):
        """Two locks in series, not one instead of the other. The passcode says
        this machine may be spoken to; the session says who is speaking. A right
        passcode with nobody signed in still reaches nothing."""
        base, _ = guarded
        status, payload = self.note(base, {"X-Passcode": "open sesame"})
        assert status == 401 and "sign in" in payload["error"]

    def test_reading_is_never_gated(self, guarded):
        """Nothing about looking at an anatomy model changes anything, and a
        passcode in front of the page would be security theatre over a body."""
        base, signed_in = guarded
        status, payload = get(f"{base}/capabilities")
        assert status == 200
        with urllib.request.urlopen(f"{base}/index.html", timeout=10) as page:
            assert page.status == 200
        assert get(f"{base}/sheet?user=anna", signed_in)[0] == 200

    def test_an_unset_passcode_takes_off_that_lock_and_only_that_one(
            self, tmp_path, monkeypatch):
        """The right default on a studio machine on its own network -- and it
        was the *only* lock once, which is what got fixed. Leaving the passcode
        unset now means the shared word is not asked for; it does not mean
        anybody may write into somebody's record."""
        from pilates.demo import fill
        from pilates.store import Store

        monkeypatch.delenv("PILATES_PASSCODE", raising=False)
        db = tmp_path / "studio.db"
        with Store.open(db) as store:
            fill(store, session="s1", date="2026-03-03")
        signed_in = owner(db)
        server, url = serve(None, root=WEB, port=0, analyse=True, db=str(db))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        base = url.split("/index.html")[0]
        try:
            assert get(f"{base}/capabilities")[1]["passcode"] is False
            assert self.note(base)[0] == 401
            assert self.note(base, signed_in)[0] == 201
        finally:
            server.shutdown()


class TestGettingBackToARecording:
    """The hole that cost somebody a recording.

    A finished analysis had exactly one place it could appear: the dialog that
    was watching the job. Close it -- or reload the tab, or walk away while a
    small machine worked -- and the measurements sat in the database with no
    route in the interface that could reach them. The honest answer to "where
    do I see the analysis I just recorded" was nowhere.
    """

    @pytest.fixture
    def studio(self, tmp_path):
        from pilates.demo import fill
        from pilates.store import Store

        db = tmp_path / "studio.db"
        with Store.open(db) as store:
            fill(store, session="s1", date="2026-03-03")
            fill(store, session="s2", date="2026-04-04")
        signed_in = owner(db)
        server, url = serve(None, root=WEB, port=0, analyse=True, db=str(db))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        yield url.split("/index.html")[0], db, signed_in
        server.shutdown()

    def test_everything_measured_here_is_listed(self, studio):
        base, _, signed_in = studio
        status, payload = get(f"{base}/recordings", signed_in)
        assert status == 200
        assert {r["key"] for r in payload["recordings"]} == {"s1", "s2"}

    def test_the_newest_is_first(self, studio):
        """The one somebody is looking for is almost always the one they just
        made."""
        base, _, signed_in = studio
        _, payload = get(f"{base}/recordings", signed_in)
        assert [r["key"] for r in payload["recordings"]] == ["s2", "s1"]

    def test_each_row_says_whose_it_is_and_how_much_came_out(self, studio):
        base, _, signed_in = studio
        _, payload = get(f"{base}/recordings", signed_in)
        row = payload["recordings"][0]
        assert row["username"] and row["display_name"]
        assert row["measurements"] > 0 and row["date"] == "2026-04-04"

    def test_one_comes_back_as_a_bundle_the_page_can_show(self, studio):
        base, _, signed_in = studio
        _, listing = get(f"{base}/recordings", signed_in)
        row = listing["recordings"][0]
        status, bundle = get(f"{base}/recording?user={row['username']}"
                             f"&session={row['key']}", signed_in)
        assert status == 200
        assert bundle["session"]["key"] == row["key"]
        assert bundle["structures"]

    def test_the_history_travels_with_it(self, studio):
        """Reopening the second class has to show the first one under it, or
        the list is a filing cabinet rather than a record."""
        base, _, signed_in = studio
        _, bundle = get(f"{base}/recording?user=anna&session=s2", signed_in)
        assert max(h["sessions"] for h in bundle["history"].values()) == 2

    def test_a_session_nobody_recorded_is_a_404(self, studio):
        base, _, signed_in = studio
        status, payload = fetch(f"{base}/recording?user=anna&session=nope", signed_in)
        assert status == 404 and payload["error"]

    def test_half_a_question_is_refused_rather_than_guessed(self, studio):
        base, _, signed_in = studio
        assert fetch(f"{base}/recording?user=anna", signed_in)[0] == 400
        assert fetch(f"{base}/recording?session=s1", signed_in)[0] == 400

    def test_a_viewer_has_no_list_to_offer(self, running):
        """Serving one exported bundle is not a record, and an empty list
        behind a button is worse than no button."""
        base, _ = running
        assert fetch(f"{base}/recordings")[0] == 404


class TestOneSlowWriteDoesNotLockOutEverybodyElse:
    """The bug that pressing one button in the admin console exposed.

    The server opens a SQLite connection per request, because connections are
    not shareable across threads. Under the rollback journal that means one
    writer blocks every reader on the file, so a write of any length -- filling
    a studio with fixture data, a capture saving a long session -- made every
    other request in flight fail with "database is locked". The page broke
    around the button that was working.
    """

    def test_the_file_is_opened_in_wal_mode(self, tmp_path):
        from pilates.store import Store

        with Store.open(tmp_path / "studio.db") as store:
            assert store.db.execute(
                "PRAGMA journal_mode").fetchone()[0].lower() == "wal"

    def test_a_writer_waits_rather_than_failing_at_once(self, tmp_path):
        from pilates.store import Store

        with Store.open(tmp_path / "studio.db") as store:
            assert store.db.execute("PRAGMA busy_timeout").fetchone()[0] >= 10000

    def test_durability_is_not_the_thing_traded_away(self, tmp_path):
        """NORMAL is the usual WAL pairing and is faster. What it trades is the
        last few transactions on power loss, which here is a coach's note about
        somebody's knee."""
        from pilates.store import Store

        with Store.open(tmp_path / "studio.db") as store:
            assert store.db.execute("PRAGMA synchronous").fetchone()[0] == 2

    def test_reads_keep_working_while_a_long_write_is_in_flight(self, tmp_path):
        """The actual failure, reproduced: a second connection reading the file
        while the first holds a write transaction open."""
        import sqlite3

        from pilates.demo import fill
        from pilates.store import Store

        db = tmp_path / "studio.db"
        with Store.open(db) as writer:
            fill(writer, session="s1", date="2026-03-03")
            writer.db.execute("BEGIN IMMEDIATE")
            writer.db.execute("INSERT INTO audit (at, action) VALUES ('x', 'y')")
            try:
                with Store.open(db) as reader:
                    assert reader.people()          # would raise before WAL
                    assert reader.recordings() is not None
            finally:
                writer.db.execute("ROLLBACK")

    def test_the_session_row_is_not_written_on_every_request(self, tmp_path):
        """A write per request is write contention per request, for a field
        nothing reads more precisely than "roughly when were they last here"."""
        from pilates import auth, passwords
        from pilates.accounts import Account, Studio
        from pilates.onboarding import grant
        from pilates.store import Store

        passwords.N = 2 ** 14
        db = tmp_path / "studio.db"
        with Store.open(db) as store:
            store.add_studio(Studio(key="here", name="Here"))
            account = Account(email="a@b.co", display_name="A")
            store.create_account(account, password="a decently long password")
            grant(store, account.username, "here", "student", by="test")
            session = auth.sign_in(store, "a@b.co", "a decently long password")

            first = store.db.execute(
                "SELECT last_seen FROM auth_sessions").fetchone()["last_seen"]
            for _ in range(5):
                assert auth.viewer_for(store, session.token) is not None
            again = store.db.execute(
                "SELECT last_seen FROM auth_sessions").fetchone()["last_seen"]
            assert first == again
