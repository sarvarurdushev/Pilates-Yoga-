"""The long-term record.

Built for the case where this has been running in a studio for two years, which
is the only case where any of it matters.
"""
import pytest

from pilates.identity import CONFIRMED, PROPOSED, Link, Signature
from pilates.store import SOURCES, SessionMeta, Store


@pytest.fixture
def store():
    with Store.memory() as db:
        db.enrol("anna", "Anna Smith")
        db.enrol("ben", "Ben Jones")
        yield db


def a_session(store, key="tue-01", date="2026-01-06"):
    store.record_session(SessionMeta(key=key, date=date, video=f"{key}.mp4",
                                     studio="Main", students=12))
    return key


def confirmed(store, key, track_id=4, username="anna"):
    store.put_link(Link(session=key, track_id=track_id,
                        username=username).confirm("teacher@studio"))


class TestSessions:
    def test_a_session_is_recorded_once(self, store):
        a_session(store)
        a_session(store)
        assert len(store.sessions()) == 1

    def test_re_recording_updates_rather_than_duplicates(self, store):
        a_session(store)
        store.record_session(SessionMeta(key="tue-01", date="2026-01-06", students=20))
        assert store.sessions()[0]["students"] == 20

    def test_an_unknown_session_key_is_an_error_not_a_silent_insert(self, store):
        with pytest.raises(KeyError):
            store.add_measurement("never-recorded", 1, "left_hip", 60.0)


class TestIdentityIsSeparateFromMeasurement:
    """Measurements key to a track; which person that was is a separate fact.
    Joining at query time is what makes attribution retroactive and a mistake
    reversible."""

    def test_a_measurement_stores_before_anyone_is_identified(self, store):
        key = a_session(store)
        store.add_measurement(key, 4, "left_hip", 62.0)
        assert store.coverage()["measurements"] == 1
        assert store.coverage()["attributed"] == 0

    def test_confirming_later_attributes_it_retroactively(self, store):
        """Nothing is lost while an assignment waits to be checked."""
        key = a_session(store)
        store.add_measurement(key, 4, "left_hip", 62.0)
        confirmed(store, key)
        assert len(store.history("anna")) == 1

    def test_an_unconfirmed_link_attributes_nothing(self, store):
        key = a_session(store)
        store.add_measurement(key, 4, "left_hip", 62.0)
        store.put_link(Link(session=key, track_id=4, username="anna"))
        assert store.history("anna") == []

    def test_a_mistake_is_reversible_by_changing_one_row(self, store):
        key = a_session(store)
        store.add_measurement(key, 4, "left_hip", 62.0)
        confirmed(store, key, username="anna")
        assert len(store.history("anna")) == 1
        confirmed(store, key, username="ben")
        assert store.history("anna") == []
        assert len(store.history("ben")) == 1

    def test_pending_links_are_listed_as_a_queue(self, store):
        key = a_session(store)
        store.put_link(Link(session=key, track_id=4, username="anna"))
        store.put_link(Link(session=key, track_id=5, username="ben").confirm("t"))
        pending = store.pending()
        assert [l.track_id for l in pending] == [4]

    def test_links_can_be_filtered_by_session_and_status(self, store):
        key = a_session(store)
        confirmed(store, key)
        assert len(store.links(session=key, status=CONFIRMED)) == 1
        assert store.links(session=key, status=PROPOSED) == []


class TestProvenance:
    """Every row carries where it came from. A training set assembled without
    that would be poisoned in a way nothing downstream could detect."""

    def test_the_source_is_stored(self, store):
        key = a_session(store)
        store.add_measurement(key, 4, "hip_range", 62.0, source="class")
        confirmed(store, key)
        assert store.history("anna")[0].source == "class"

    def test_an_unknown_source_is_refused(self, store):
        key = a_session(store)
        with pytest.raises(ValueError, match="unknown source"):
            store.add_measurement(key, 4, "x", 1.0, source="vibes")

    def test_every_named_source_is_accepted(self, store):
        key = a_session(store)
        for source in SOURCES:
            store.add_measurement(key, 4, "x", 1.0, source=source)
        confirmed(store, key)
        assert len(store.history("anna")) == len(SOURCES)

    def test_an_invalid_measurement_is_stored_and_flagged(self, store):
        """A load measured while somebody's hands were on the student is stored
        so it can be examined, not so it can be averaged."""
        key = a_session(store)
        store.add_measurement(key, 4, "hip_moment", 44.0, source="load",
                              valid=False, invalid_reason="instructor supporting the leg")
        confirmed(store, key)
        assert store.history("anna") == []
        held = store.history("anna", valid_only=False)
        assert held[0].invalid_reason == "instructor supporting the leg"

    def test_invalid_rows_are_counted_in_coverage(self, store):
        key = a_session(store)
        store.add_measurement(key, 4, "x", 1.0, valid=False, invalid_reason="y")
        assert store.coverage()["invalid"] == 1


class TestHistory:
    def _three_sessions(self, store):
        for i, date in enumerate(("2026-01-06", "2026-01-13", "2026-01-20")):
            key = a_session(store, key=f"s{i}", date=date)
            store.add_measurement(key, 4, "left_hip", 60.0 + i * 5, spread=2.0,
                                  samples=200, exercise="bridge")
            confirmed(store, key)

    def test_it_comes_back_oldest_first(self, store):
        self._three_sessions(store)
        assert [r.value for r in store.history("anna")] == [60.0, 65.0, 70.0]

    def test_it_can_be_filtered_by_subject_and_exercise(self, store):
        self._three_sessions(store)
        assert len(store.history("anna", subject="left_hip")) == 3
        assert store.history("anna", subject="right_hip") == []
        assert len(store.history("anna", exercise="bridge")) == 3

    def test_another_person_sees_nothing_of_it(self, store):
        self._three_sessions(store)
        assert store.history("ben") == []

    def test_the_subjects_measured_can_be_listed(self, store):
        self._three_sessions(store)
        assert store.subjects("anna") == ["left_hip"]

    def test_the_session_dates_can_be_listed(self, store):
        self._three_sessions(store)
        assert len(store.session_dates("anna")) == 3


class TestRecurringFindings:
    """Not "your hips were uneven today" but "in five of your last six classes"."""

    def _repeat(self, store, message, times, subject="hip"):
        for i in range(times):
            key = a_session(store, key=f"{message[:4]}{i}", date=f"2026-02-{i + 1:02d}")
            store.add_finding(key, 4, "improve", message, subject=subject,
                              deviation=12.0)
            confirmed(store, key)

    def test_a_repeated_correction_is_surfaced(self, store):
        self._repeat(store, "the hips were not level", 4)
        recurring = store.recurring_findings("anna")
        assert recurring[0]["sessions"] == 4

    def test_a_one_off_is_not(self, store):
        self._repeat(store, "the hips were not level", 1)
        assert store.recurring_findings("anna") == []

    def test_it_reports_when_it_started_and_last_happened(self, store):
        self._repeat(store, "the hips were not level", 3)
        entry = store.recurring_findings("anna")[0]
        assert entry["first_seen"] < entry["last_seen"]

    def test_the_most_persistent_comes_first(self, store):
        self._repeat(store, "the hips were not level", 5)
        self._repeat(store, "the knee drifted inward", 2)
        assert store.recurring_findings("anna")[0]["sessions"] == 5

    def test_only_corrections_count_not_praise(self, store):
        key = a_session(store)
        for _ in range(4):
            store.add_finding(key, 4, "good", "the legs stayed long")
        confirmed(store, key)
        assert store.recurring_findings("anna") == []


class TestCoverage:
    """Measurements piling up against unconfirmed tracks are not data yet."""

    def test_it_reports_the_attributed_share(self, store):
        key = a_session(store)
        store.add_measurement(key, 4, "x", 1.0)
        store.add_measurement(key, 5, "x", 1.0)
        confirmed(store, key, track_id=4)
        assert store.coverage()["share"] == pytest.approx(0.5)

    def test_an_empty_store_does_not_divide_by_zero(self, store):
        assert store.coverage()["share"] == 0.0

    def test_it_counts_the_confirmation_queue(self, store):
        key = a_session(store)
        store.put_link(Link(session=key, track_id=4, username="anna"))
        assert store.coverage()["pending_links"] == 1


class TestWhatIsHeld:
    def test_everything_about_a_person_comes_back_in_one_call(self, store):
        key = a_session(store)
        store.add_measurement(key, 4, "left_hip", 62.0)
        store.add_finding(key, 4, "improve", "the hips were not level")
        confirmed(store, key)
        export = store.export_person("anna")
        assert export["person"]["display_name"] == "Anna Smith"
        assert export["measurements"] and export["findings"] and export["links"]

    def test_an_unknown_person_exports_an_empty_record_not_an_error(self, store):
        assert store.export_person("nobody")["measurements"] == []

    def test_forgetting_removes_the_measurements_too(self, store):
        """A row saying track 4 had a hip range of 62 degrees is still about
        that person; leaving it because the name column is gone would be
        erasure in name only."""
        key = a_session(store)
        store.add_measurement(key, 4, "left_hip", 62.0)
        store.add_finding(key, 4, "improve", "x")
        confirmed(store, key)
        removed = store.forget("anna")
        assert removed == {"measurements": 1, "findings": 1, "links": 1}
        assert store.coverage()["measurements"] == 0
        assert store.people() == [] or all(p["username"] != "anna"
                                           for p in store.people())

    def test_forgetting_one_person_leaves_another_intact(self, store):
        key = a_session(store)
        store.add_measurement(key, 4, "x", 1.0)
        store.add_measurement(key, 5, "x", 2.0)
        confirmed(store, key, track_id=4, username="anna")
        confirmed(store, key, track_id=5, username="ben")
        store.forget("anna")
        assert len(store.history("ben")) == 1

    def test_forgetting_somebody_unknown_is_harmless(self, store):
        assert store.forget("nobody")["links"] == 0


class TestSignatures:
    def test_a_signature_round_trips_through_the_store(self, store):
        signature = Signature({"shoulder_to_torso": 1.2}, frames=40)
        store.save_signature("anna", signature)
        assert store.signature("anna").ratios == {"shoulder_to_torso": 1.2}

    def test_saving_counts_a_confirmation(self, store):
        store.save_signature("anna", Signature({"a": 1.0}, frames=10))
        store.save_signature("anna", Signature({"a": 1.0}, frames=10))
        assert [p for p in store.people()
                if p["username"] == "anna"][0]["confirmations"] == 2

    def test_an_unknown_person_has_an_empty_signature(self, store):
        assert not store.signature("nobody").usable


class TestPersistence:
    def test_a_store_survives_being_closed_and_reopened(self, tmp_path):
        path = tmp_path / "studio.db"
        with Store.open(path) as db:
            db.enrol("anna")
            key = a_session(db)
            db.add_measurement(key, 4, "left_hip", 62.0)
            confirmed(db, key)
        with Store.open(path) as again:
            assert len(again.history("anna")) == 1

    def test_opening_creates_the_folder_and_schema(self, tmp_path):
        with Store.open(tmp_path / "nested" / "studio.db") as db:
            assert db.people() == []
