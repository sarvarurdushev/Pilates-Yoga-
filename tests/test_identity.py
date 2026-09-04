"""Tying a tracked body to an enrolled person.

The rule everything here is built around: a wrong identity is worse than no
identity, because it corrupts two histories at once and neither is detectable
later.
"""
import numpy as np
import pytest

from pilates import keypoints as kp
from pilates.identity import (
    CONFIRMED, MAX_DISTANCE, MIN_SIGNATURE_FRAMES, PROPOSED, REJECTED,
    Directory, Link, Person, Signature, propose,
)
from pilates.types import Detection
from conftest import make_detection


def body(height=180.0, width=60.0, arm_scale=1.0, leg_scale=1.0, n=30, x=100.0):
    """A run of detections for one person's build.

    Limb lengths are scaled rather than the whole body, so two people can share
    a height and differ in proportion — which is the case the matcher has to
    handle.
    """
    out = []
    for _ in range(n):
        base = make_detection(x=x, y=100.0, width=width, height=height)
        points = base.keypoints.copy()
        for joint, anchor in ((kp.L_WRIST, kp.L_ELBOW), (kp.R_WRIST, kp.R_ELBOW)):
            points[joint] = points[anchor] + (points[joint] - points[anchor]) * arm_scale
        for joint, anchor in ((kp.L_ANKLE, kp.L_KNEE), (kp.R_ANKLE, kp.R_KNEE)):
            points[joint] = points[anchor] + (points[joint] - points[anchor]) * leg_scale
        out.append(Detection(points, base.scores.copy()))
    return out


def signature(**kwargs):
    from pilates.movement import TrackHistory

    detections = body(**kwargs)
    return Signature.from_history(TrackHistory(track_id=1), detections)


def person(username, **kwargs):
    return Person(username=username, display_name=username.title(),
                  signature=signature(**kwargs), confirmations=2)


class TestSignature:
    """Ratios rather than lengths, because distance from the camera divides
    out and a front-row session has to be comparable with a back-row one."""

    def test_it_measures_several_proportions(self):
        assert len(signature().ratios) >= 4

    def test_the_same_build_at_a_different_size_matches(self):
        near, far = signature(height=400.0, width=133.0), signature(height=100.0, width=33.0)
        assert near.distance(far) < 0.5

    def test_a_different_build_does_not(self):
        assert signature().distance(signature(arm_scale=1.8, leg_scale=0.7)) > 1.0

    def test_too_few_frames_is_not_usable(self):
        assert not signature(n=3).usable
        assert MIN_SIGNATURE_FRAMES > 3

    def test_a_full_clip_is(self):
        assert signature(n=40).usable

    def test_comparing_against_nothing_returns_nothing(self):
        assert signature().distance(Signature()) is None

    def test_merging_weights_by_how_much_was_seen(self):
        """A long clear session counts for more than a glimpse at the back."""
        long_clip = Signature({"shoulder_to_torso": 1.0}, frames=100)
        glimpse = Signature({"shoulder_to_torso": 2.0}, frames=10)
        merged = long_clip.merge(glimpse)
        assert 1.0 < merged.ratios["shoulder_to_torso"] < 1.2
        assert merged.frames == 110

    def test_merging_keeps_a_ratio_only_one_side_had(self):
        merged = Signature({"a": 1.0}, frames=10).merge(Signature({"b": 2.0}, frames=10))
        assert merged.ratios == {"a": 1.0, "b": 2.0}

    def test_a_round_trip_survives_json(self):
        import json

        original = signature()
        again = Signature.from_dict(json.loads(json.dumps(original.to_dict())))
        assert again.ratios == pytest.approx(original.ratios)


class TestProposal:
    def test_a_clear_match_is_proposed(self):
        roster = [person("anna"), person("ben", arm_scale=1.8, leg_scale=0.7)]
        result = propose(signature(), roster)
        assert result.named and result.best.person.username == "anna"

    def test_somebody_not_enrolled_gets_no_proposal(self):
        """A guest, a drop-in, or somebody not yet signed up."""
        roster = [person("anna", arm_scale=2.5, leg_scale=0.4)]
        result = propose(signature(arm_scale=0.5, leg_scale=2.5), roster)
        assert not result.named
        assert "not enrolled" in result.withheld_reason

    def test_two_people_of_similar_build_get_no_proposal(self):
        """A coin flip here puts a session in the wrong history."""
        roster = [person("anna"), person("ben")]
        result = propose(signature(), roster)
        assert not result.named
        assert "too alike" in result.withheld_reason

    def test_a_thin_signature_gets_no_proposal(self):
        result = propose(signature(n=3), [person("anna")])
        assert not result.named
        assert "not enough to compare" in result.withheld_reason

    def test_an_empty_roster_gets_no_proposal(self):
        assert not propose(signature(), []).named

    def test_the_candidates_are_still_listed_when_it_refuses(self):
        """Whoever has to decide can see what it was choosing between."""
        result = propose(signature(), [person("anna"), person("ben")])
        assert len(result.candidates) == 2

    def test_it_says_why_in_words_a_person_can_act_on(self):
        roster = [person("anna"), person("ben", arm_scale=1.8, leg_scale=0.7)]
        text = propose(signature(), roster).describe()
        assert "typical-variations away" in text
        assert "confirmed 2 time(s) before" in text

    def test_a_never_confirmed_person_says_so(self):
        unseen = Person(username="new", signature=signature(), confirmations=0)
        roster = [unseen, person("ben", arm_scale=1.8, leg_scale=0.7)]
        assert "first guess" in propose(signature(), roster).describe()

    def test_the_alternatives_are_shown(self):
        roster = [person("anna"), person("ben", arm_scale=1.5, leg_scale=0.8)]
        assert "or Ben" in propose(signature(), roster).describe()

    def test_confidence_is_presentation_only_and_bounded(self):
        roster = [person("anna"), person("ben", arm_scale=1.8, leg_scale=0.7)]
        best = propose(signature(), roster).best
        assert 0.0 <= best.confidence <= 1.0


class TestLinks:
    """A confirmed assignment is a fact with an author. An unconfirmed one is a
    suggestion, and nothing unconfirmed reaches a long-term history."""

    def _link(self):
        return Link(session="tuesday", track_id=4, username="anna")

    def test_a_proposal_is_not_trustworthy(self):
        assert self._link().status == PROPOSED
        assert not self._link().trustworthy

    def test_confirming_makes_it_so(self):
        confirmed = self._link().confirm(by="teacher@studio")
        assert confirmed.trustworthy and confirmed.status == CONFIRMED

    def test_confirmation_records_who_and_when(self):
        confirmed = self._link().confirm(by="teacher@studio")
        assert confirmed.confirmed_by == "teacher@studio"
        assert confirmed.confirmed_at

    def test_a_rejection_is_kept_rather_than_deleted(self):
        """A rejection is evidence: it stops the same wrong proposal recurring."""
        rejected = self._link().reject(by="teacher@studio")
        assert rejected.status == REJECTED
        assert not rejected.trustworthy

    def test_confirming_does_not_mutate_the_proposal(self):
        original = self._link()
        original.confirm(by="x")
        assert original.status == PROPOSED

    def test_a_link_survives_a_round_trip(self):
        import json

        confirmed = self._link().confirm(by="teacher@studio")
        again = Link.from_dict(json.loads(json.dumps(confirmed.to_dict())))
        assert again.trustworthy and again.confirmed_by == "teacher@studio"


class TestDirectory:
    def test_enrolling_records_when(self):
        directory = Directory()
        assert directory.enrol("anna").enrolled_at

    def test_enrolling_twice_does_not_duplicate(self):
        directory = Directory()
        directory.enrol("anna", "Anna")
        assert directory.enrol("anna").display_name == "Anna"
        assert len(directory.people) == 1

    def test_someone_with_no_signature_is_not_on_the_matching_roster(self):
        directory = Directory()
        directory.enrol("anna")
        assert directory.roster == []

    def test_learning_from_a_session_builds_the_signature(self):
        directory = Directory()
        directory.enrol("anna")
        directory.learn("anna", signature())
        assert directory.get("anna").signature.usable
        assert directory.get("anna").confirmations == 1

    def test_learning_accumulates_across_sessions(self):
        directory = Directory()
        directory.enrol("anna")
        directory.learn("anna", signature())
        directory.learn("anna", signature())
        assert directory.get("anna").confirmations == 2
        assert directory.get("anna").signature.frames == 60

    def test_the_display_name_falls_back_to_the_username(self):
        assert Person(username="anna").name == "anna"

    def test_a_directory_round_trips_through_a_file(self, tmp_path):
        directory = Directory()
        directory.enrol("anna", "Anna Smith")
        directory.learn("anna", signature())
        path = tmp_path / "people.json"
        directory.save(path)
        again = Directory.load(path)
        assert again.get("anna").display_name == "Anna Smith"
        assert again.get("anna").signature.usable

    def test_a_missing_file_is_an_empty_directory_not_an_error(self, tmp_path):
        assert Directory.load(tmp_path / "nope.json").people == {}
