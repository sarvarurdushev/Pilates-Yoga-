"""Camera integrity: which side a profile shows, and which way is forward.

Measurement version 2.1 corrected the side-view convention (see
``docs/SEDENS_CAMERA_INTEGRITY_REPORT.md``). Every expectation here is checked
against something that does not come from :mod:`pilates.alignment` itself:

* **Real landmarks on photographs with a known facing direction.** RTMO-m ran
  once on the repository's demo four-view image (an AI-generated picture of
  one fictional person); ``tests/data/camera_integrity_rtmo.json`` keeps what it
  found, plain, mirrored and rolled, with the provenance needed to rerun it
  (``tools/camera_integrity_fixture.py``). The facing of each panel was written
  down by looking at it. RTMO labels ears anatomically, so the ear it can see is
  a second, independent label of the near side.
* **Synthetic skeletons** built from the geometry: image x right, y down, the
  viewer looking along -z. A person's right hand points along forward x up, so
  facing image-right shows the right side.

Nothing here is an accuracy figure. The roll and mirror numbers come from one
generated image and are pinned as observations, so a change that moves them is
noticed and has to be explained; they are not error bounds.
"""
from __future__ import annotations

import copy
import hashlib
import json
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).parent))

from pilates import alignment as al  # noqa: E402
from pilates import assessment as ev  # noqa: E402
from pilates import intake as ik  # noqa: E402
from pilates import keypoints as kp  # noqa: E402
from pilates.alignment import View  # noqa: E402
from pilates.types import Detection  # noqa: E402
from test_alignment import side_of, side_on, standing  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = json.loads((ROOT / "tests/data/camera_integrity_rtmo.json").read_text())
PANELS = FIXTURE["panels"]
#: What each panel shows, from the picture, never from the model.
KNOWN = {"front": View.FRONT, "back": View.REAR,
         "faces_image_right": View.SIDE_RIGHT, "faces_image_left": View.SIDE_LEFT}
SAGITTAL = ("forward_head", "trunk_lean_sagittal", "sagittal_ear_offset",
            "sagittal_shoulder_offset", "sagittal_hip_offset", "sagittal_knee_offset")
ROLLS = range(-3, 4)


def rtmo(panel: str, kind: str = "plain", roll: int | None = None) -> Detection:
    entry = PANELS[panel]
    found = entry["roll"][str(roll)] if roll is not None else entry[kind]
    return Detection(np.asarray(found["keypoints"], np.float32),
                     np.asarray(found["scores"], np.float32))


def measured(panel: str, view: View | None, **kw) -> al.PostureAssessment:
    entry = PANELS[panel]
    return al.assess(rtmo(panel, **kw), view=view,
                     frame_width=entry["width"], frame_height=entry["height"])


def mirrored(det: Detection, width: float = 600.0) -> Detection:
    """What a horizontal flip does to a pose model's answer.

    The pixels move to ``width - x``, and the model, labelling by appearance,
    calls the visible ear and limbs by the side they now look like -- so every
    left/right pair swaps label. RTMO does exactly this on the real panels (see
    ``TestMirroring``).
    """
    swap = np.arange(kp.NUM_KEYPOINTS)
    for left, right in ((kp.L_EYE, kp.R_EYE), (kp.L_EAR, kp.R_EAR),
                        (kp.L_SHOULDER, kp.R_SHOULDER), (kp.L_ELBOW, kp.R_ELBOW),
                        (kp.L_WRIST, kp.R_WRIST), (kp.L_HIP, kp.R_HIP),
                        (kp.L_KNEE, kp.R_KNEE), (kp.L_ANKLE, kp.R_ANKLE)):
        swap[left], swap[right] = right, left
    points = det.keypoints[swap].copy()
    points[:, 0] = width - points[:, 0]
    return Detection(points, det.scores[swap].copy())


class TestTheFixtureIsWhatItSaysItIs:
    def test_it_was_recorded_from_the_image_in_the_repository(self):
        image = ROOT / FIXTURE["provenance"]["image"]
        assert hashlib.sha256(image.read_bytes()).hexdigest() == \
            FIXTURE["provenance"]["image_sha256"]

    def test_every_crop_found_a_person_plain_mirrored_and_rolled(self):
        for name, entry in PANELS.items():
            assert entry["plain"] and entry["mirrored"], name
            assert sorted(int(a) for a in entry["roll"]) == list(ROLLS)
            assert all(entry["roll"].values()), name


class TestTheRealPanels:
    """The demo photograph, whose facing direction is known by looking at it."""

    @pytest.mark.parametrize("panel,near,far", [
        ("faces_image_right", kp.R_EAR, kp.L_EAR),
        ("faces_image_left", kp.L_EAR, kp.R_EAR),
    ])
    def test_rtmo_sees_the_ear_on_the_side_the_person_faces(self, panel, near, far):
        """The model's own anatomical labels, independent of this module."""
        det = rtmo(panel)
        assert det.scores[near] > 0.9 and det.scores[far] < 0.05

    @pytest.mark.parametrize("panel", list(KNOWN))
    def test_the_view_estimate_names_what_the_picture_shows(self, panel):
        estimate = al.estimate_view(rtmo(panel))
        assert estimate.view is KNOWN[panel]
        assert estimate.confidence >= al.SIDE_CHECK_CONFIDENCE

    @pytest.mark.parametrize("panel", ["faces_image_right", "faces_image_left"])
    def test_the_estimate_agrees_with_the_visible_ear(self, panel):
        assert al.near_side_ear(rtmo(panel)) is KNOWN[panel]

    @pytest.mark.parametrize("panel", ["faces_image_right", "faces_image_left"])
    def test_forward_head_has_the_sign_the_pixels_have(self, panel):
        """Worked out from raw landmarks without the module's conventions:
        how far the visible ear is from its shoulder, toward the nose."""
        det = rtmo(panel)
        near = KNOWN[panel]
        ear, shoulder, hip = ((kp.R_EAR, kp.R_SHOULDER, kp.R_HIP) if near is View.SIDE_RIGHT
                              else (kp.L_EAR, kp.L_SHOULDER, kp.L_HIP))
        toward_nose = np.sign(det.keypoints[kp.NOSE][0] - det.keypoints[ear][0])
        ahead = toward_nose * (det.keypoints[ear][0] - det.keypoints[shoulder][0])
        expected = ahead / abs(det.keypoints[shoulder][1] - det.keypoints[hip][1])
        for view in (near, None):           # declared, and estimated
            metric = measured(panel, view).metrics["forward_head"]
            assert metric.measured, view
            assert metric.value == pytest.approx(expected, abs=0.001)
            assert metric.value > 0         # the ear is ahead of the shoulder

    @pytest.mark.parametrize("panel", ["faces_image_right", "faces_image_left"])
    def test_trunk_lean_and_ear_offset_have_the_sign_the_pixels_have(self, panel):
        det = rtmo(panel)
        toward_nose = np.sign(det.keypoints[kp.NOSE][0]
                              - (det.keypoints[kp.L_SHOULDER][0] + det.keypoints[kp.R_SHOULDER][0]) / 2)
        shoulders = (det.keypoints[kp.L_SHOULDER] + det.keypoints[kp.R_SHOULDER]) / 2
        hips = (det.keypoints[kp.L_HIP] + det.keypoints[kp.R_HIP]) / 2
        ankle_x = (det.keypoints[kp.L_ANKLE][0] + det.keypoints[kp.R_ANKLE][0]) / 2
        metrics = measured(panel, KNOWN[panel]).metrics
        lean = metrics["trunk_lean_sagittal"].value
        assert np.sign(lean) == np.sign(toward_nose * (shoulders[0] - hips[0]))
        visible_ear = det.keypoints[kp.R_EAR if KNOWN[panel] is View.SIDE_RIGHT else kp.L_EAR]
        assert np.sign(metrics["sagittal_ear_offset"].value) == \
            np.sign(toward_nose * (visible_ear[0] - ankle_x))

    def test_the_two_sides_of_one_person_agree_in_sign(self):
        """One body, photographed from both sides, is measured as one body."""
        right = measured("faces_image_right", View.SIDE_RIGHT).metrics
        left = measured("faces_image_left", View.SIDE_LEFT).metrics
        for name in ("forward_head", "sagittal_ear_offset", "sagittal_shoulder_offset",
                     "sagittal_hip_offset", "sagittal_knee_offset"):
            assert right[name].value > 0 and left[name].value > 0, name

    @pytest.mark.parametrize("panel,wrong", [
        ("faces_image_right", View.SIDE_LEFT),
        ("faces_image_left", View.SIDE_RIGHT),
    ])
    def test_a_declared_side_the_picture_contradicts_is_reported_not_measured(self, panel, wrong):
        out = measured(panel, wrong)
        assert any("nearest the camera" in w for w in out.warnings)
        assert not any(out.metrics[name].measured for name in SAGITTAL)

    def test_the_photo_pipeline_refuses_it_with_a_camera_plane_reason(self):
        """SEDENS reads "camera plane" as the customer reason wrong_direction."""
        entry = PANELS["faces_image_right"]
        person = ev.assess_person(rtmo("faces_image_right"), entry["width"], entry["height"],
                                  view="side_left")
        assert not person["suitable"]
        assert "camera plane" in " ".join(person["validation"]["reasons"])
        right = ev.assess_person(rtmo("faces_image_right"), entry["width"], entry["height"],
                                 view="side_right")
        fh = next(m for m in right["metrics"] if m["id"] == "forward_head")
        assert right["suitable"] and fh["value"] > 0

    def test_the_frontal_panels_are_unchanged_by_the_correction(self):
        """2.1 changed only side views. Values recorded with 2.0 on these crops."""
        front = measured("front", View.FRONT).metrics
        back = measured("back", View.REAR).metrics
        assert front["shoulder_tilt"].value == pytest.approx(0.31, abs=0.01)
        assert back["shoulder_tilt"].value == pytest.approx(1.25, abs=0.01)
        assert back["pelvic_obliquity"].value == pytest.approx(0.88, abs=0.01)


class TestSyntheticSides:
    @pytest.mark.parametrize("view", [View.SIDE_LEFT, View.SIDE_RIGHT])
    @pytest.mark.parametrize("ear_ahead", [-20.0, 0.0, 20.0, 40.0])
    def test_forward_head_is_the_ear_ahead_of_the_shoulder_over_the_torso(self, view, ear_ahead):
        """``side_on`` puts the near ear ``ear_ahead`` px in front of the body
        line on a 200 px torso. It draws the right shoulder 3 px toward image
        right, which for a right side (facing image-right) is 3 px forward, so
        that shoulder's ear is 3 px less ahead of it."""
        det = side_of(view, ear_ahead=ear_ahead)
        truth = (ear_ahead - (3.0 if view is View.SIDE_RIGHT else 0.0)) / 200.0
        assert al.estimate_view(det).view is view
        for declared in (view, None):
            metric = al.assess(det, view=declared).metrics["forward_head"]
            assert metric.value == pytest.approx(truth, abs=1e-3)

    @pytest.mark.parametrize("view", [View.SIDE_LEFT, View.SIDE_RIGHT])
    def test_the_other_side_declared_is_refused(self, view):
        other = View.SIDE_RIGHT if view is View.SIDE_LEFT else View.SIDE_LEFT
        out = al.assess(side_of(view, ear_ahead=30.0), view=other)
        assert out.warnings and not out.metrics["forward_head"].measured

    def test_the_nose_alone_names_the_side(self):
        for view in (View.SIDE_LEFT, View.SIDE_RIGHT):
            det = side_of(view)
            scores = det.scores.copy()
            scores[kp.L_EAR] = scores[kp.R_EAR] = 0.05
            assert al.estimate_view(Detection(det.keypoints, scores)).view is view

    def test_without_a_nose_the_visible_ear_names_the_side(self):
        for view in (View.SIDE_LEFT, View.SIDE_RIGHT):
            det = side_of(view)
            scores = det.scores.copy()
            scores[kp.NOSE] = 0.05
            estimate = al.estimate_view(Detection(det.keypoints, scores))
            assert estimate.view is view and estimate.confidence >= 0.9

    def test_a_nose_and_an_ear_that_disagree_are_too_weak_to_overrule_anyone(self):
        det = side_of(View.SIDE_LEFT)
        scores = det.scores.copy()
        scores[kp.L_EAR], scores[kp.R_EAR] = 0.05, 1.0     # the wrong ear "found"
        conflicted = Detection(det.keypoints, scores)
        estimate = al.estimate_view(conflicted)
        assert estimate.confidence < al.SIDE_CHECK_CONFIDENCE
        assert "disagree" in estimate.note
        assert al.side_contradiction(conflicted, View.SIDE_RIGHT) == ""


def pushed(view: View, *, ear=0.0, shoulder=0.0, hip=0.0, knee=0.0,
           lean=0.0) -> Detection:
    """A side view with chosen links moved *forward* by a number of pixels.

    Forward is the facing direction the side implies (``View.facing``), so the
    same arguments describe the same body from either side.
    """
    det = side_of(view, cx=300.0)
    forward = view.facing
    points = det.keypoints.copy()
    for joints, amount in (((kp.L_EAR, kp.R_EAR), ear),
                           ((kp.L_SHOULDER, kp.R_SHOULDER), shoulder + lean),
                           ((kp.L_HIP, kp.R_HIP), hip),
                           ((kp.L_KNEE, kp.R_KNEE), knee)):
        for joint in joints:
            points[joint][0] += forward * amount
    if lean:
        # move the head with the shoulders so only the trunk tilts
        for joint in (kp.NOSE, kp.L_EYE, kp.R_EYE, kp.L_EAR, kp.R_EAR):
            points[joint][0] += forward * lean
    return Detection(points, det.scores)


class TestEverySagittalSign:
    """Positive is anterior for every sagittal value, from either side."""

    SPAN = 440.0            # shoulder (y 200) to ankle (y 640) in side_on

    @pytest.mark.parametrize("view", [View.SIDE_LEFT, View.SIDE_RIGHT])
    @pytest.mark.parametrize("link,metric", [
        ("ear", "sagittal_ear_offset"), ("shoulder", "sagittal_shoulder_offset"),
        ("hip", "sagittal_hip_offset"), ("knee", "sagittal_knee_offset")])
    def test_a_link_moved_forward_reads_forward(self, view, link, metric):
        base = al.assess(pushed(view), view=view).metrics[metric].value
        moved = al.assess(pushed(view, **{link: 22.0}), view=view).metrics[metric].value
        assert moved - base == pytest.approx(22.0 / self.SPAN, abs=2e-3)
        back = al.assess(pushed(view, **{link: -22.0}), view=view).metrics[metric].value
        assert back - base == pytest.approx(-22.0 / self.SPAN, abs=2e-3)

    @pytest.mark.parametrize("view", [View.SIDE_LEFT, View.SIDE_RIGHT])
    def test_a_trunk_leaning_forward_reads_positive(self, view):
        forward = al.assess(pushed(view, lean=20.0), view=view).metrics["trunk_lean_sagittal"]
        backward = al.assess(pushed(view, lean=-20.0), view=view).metrics["trunk_lean_sagittal"]
        # the shoulders move 20 px over a 200 px trunk, plus the fixture's 1.5 px offset
        assert forward.value > 4.5 and backward.value < -4.5

    @pytest.mark.parametrize("view", [View.SIDE_LEFT, View.SIDE_RIGHT])
    def test_a_head_carried_forward_reads_positive(self, view):
        assert al.assess(pushed(view, ear=30.0), view=view).metrics["forward_head"].value > 0
        assert al.assess(pushed(view, ear=-30.0), view=view).metrics["forward_head"].value < 0

    def test_the_report_states_the_convention_it_used(self):
        payload = al.assess(side_of(View.SIDE_LEFT)).to_dict()
        assert payload["measurement_version"] == "2.1-sagittal-anatomical"
        assert payload["conventions"] == {"side_view": "near_side",
                                          "sagittal_sign": "anterior_positive"}


class TestMirroring:
    """What a horizontally mirrored picture does, and what cannot be known.

    Mirroring swaps which side a profile appears to show. The pose model labels
    by appearance, so a mirrored left side is, landmark for landmark, an
    unmirrored right side: nothing in the keypoints tells them apart. Only the
    capture path can promise an unmirrored still. A declared side does catch it,
    because the mirrored picture then contradicts the label.
    """

    def test_rtmo_relabels_the_visible_ear_when_the_picture_is_mirrored(self):
        det = rtmo("faces_image_right", "mirrored")
        assert det.scores[kp.L_EAR] > 0.9 and det.scores[kp.R_EAR] < 0.05

    @pytest.mark.parametrize("panel,seen", [("faces_image_right", View.SIDE_LEFT),
                                             ("faces_image_left", View.SIDE_RIGHT)])
    def test_a_mirrored_side_reads_as_the_other_side(self, panel, seen):
        assert al.estimate_view(rtmo(panel, "mirrored")).view is seen

    @pytest.mark.parametrize("panel", ["faces_image_right", "faces_image_left"])
    def test_a_mirrored_side_with_its_original_label_is_refused(self, panel):
        out = measured(panel, KNOWN[panel], kind="mirrored")
        assert out.warnings and not out.metrics["forward_head"].measured

    @pytest.mark.parametrize("panel", ["faces_image_right", "faces_image_left"])
    def test_forward_stays_forward_when_the_estimate_follows_the_mirror(self, panel):
        """Estimated rather than declared, the mirrored picture still measures
        the head ahead of the shoulder: forward is a fact about the body, and
        the mirror moves the body and its facing together."""
        plain = measured(panel, None).metrics["forward_head"].value
        flipped = measured(panel, None, kind="mirrored").metrics["forward_head"].value
        assert flipped == pytest.approx(plain, abs=0.005)

    def test_a_mirrored_left_side_is_indistinguishable_from_a_right_side(self):
        left = side_of(View.SIDE_LEFT, ear_ahead=24.0)
        as_mirrored = mirrored(left)
        assert al.estimate_view(as_mirrored).view is View.SIDE_RIGHT
        right = al.assess(as_mirrored, view=View.SIDE_RIGHT).metrics
        original = al.assess(left, view=View.SIDE_LEFT).metrics
        for name in SAGITTAL:
            assert right[name].value == pytest.approx(original[name].value, abs=1e-3), name

    def test_a_mirrored_frontal_picture_is_not_detected_and_swaps_left_and_right(self):
        """The documented limitation: front stays front, and which shoulder is
        high silently reverses. Phase 3 relies on the capture path never
        mirroring stills; it is not detectable from landmarks."""
        body = standing(shoulder_tilt=8.0)
        flipped = mirrored(body)
        assert al.estimate_view(flipped).view is View.FRONT
        plain = al.assess(body, view=View.FRONT).metrics["shoulder_tilt"].value
        swapped = al.assess(flipped, view=View.FRONT)
        assert not swapped.warnings
        assert swapped.metrics["shoulder_tilt"].value == pytest.approx(-plain, abs=0.01)

    def test_the_real_mirrored_back_panel_reverses_its_shoulder_line(self):
        """Observed on one image (1.25 deg became -0.27): not a clean negation,
        because RTMO is not mirror-symmetric, and nothing was refused."""
        plain = measured("back", View.REAR).metrics["shoulder_tilt"].value
        flipped = measured("back", View.REAR, kind="mirrored")
        assert al.estimate_view(rtmo("back", "mirrored")).view is View.REAR
        assert not flipped.warnings
        assert plain == pytest.approx(1.25, abs=0.01)
        assert flipped.metrics["shoulder_tilt"].value == pytest.approx(-0.27, abs=0.01)


def roll_series(panel: str, metric: str) -> dict[int, float]:
    return {a: measured(panel, KNOWN[panel], roll=a).metrics[metric].value for a in ROLLS}


def slope(series: dict[int, float]) -> float:
    angles = sorted(series)
    return float(np.polyfit(angles, [series[a] for a in angles], 1)[0])


class TestCameraRoll:
    """A camera rolled -3 to +3 degrees, on one generated image.

    The slopes are least-squares fits over seven rolls, recorded in
    ``docs/SEDENS_CAMERA_INTEGRITY_REPORT.md``. They are observations from one
    picture of one fictional person, pinned so a change is noticed -- not an
    error model and not an accuracy figure.
    """

    def test_every_rolled_crop_keeps_its_view(self):
        for panel, view in KNOWN.items():
            for a in ROLLS:
                assert al.estimate_view(rtmo(panel, roll=a)).view is view, (panel, a)

    @pytest.mark.parametrize("panel,metric,observed", [
        ("front", "shoulder_tilt", 0.862),
        ("back", "shoulder_tilt", -0.760),
        ("front", "trunk_lean_lateral", -0.968),
        ("faces_image_right", "trunk_lean_sagittal", -0.869),
        ("faces_image_left", "trunk_lean_sagittal", 0.991),
        ("faces_image_right", "forward_head", -0.010),
        ("faces_image_left", "forward_head", 0.008),
    ])
    def test_roll_moves_each_value_by_about_what_was_observed(self, panel, metric, observed):
        assert slope(roll_series(panel, metric)) == pytest.approx(observed, abs=0.01)

    def test_a_three_degree_roll_crosses_the_shoulder_band(self):
        """Roll alone, on a body that is not moving, crosses the +/-2 degree
        band. This is why the shoulder line is shown only when front and back
        agree on the same anatomical side, beyond the provisional threshold."""
        series = roll_series("front", "shoulder_tilt")
        low, high = al.NORMAL_BANDS["shoulder_tilt"]
        assert series[-3] < low and series[3] > high

    def test_roll_pushes_front_and_back_in_opposite_anatomical_directions(self):
        front, back = roll_series("front", "shoulder_tilt"), roll_series("back", "shoulder_tilt")
        assert slope(front) > 0 > slope(back)
        average = [(front[a] + back[a]) / 2 for a in ROLLS]
        # observed range 0.64 deg, against 5.1 deg for the front alone
        assert max(average) - min(average) < 0.7
        assert max(front.values()) - min(front.values()) > 5.0

    def test_roll_pushes_the_two_side_views_in_opposite_directions(self):
        """Measured, and the reason a left/right average would cancel roll to
        first order. Nothing averages them yet; see the report."""
        for metric, bound in (("trunk_lean_sagittal", 0.4), ("forward_head", 0.01),
                              ("sagittal_ear_offset", 0.01)):
            right = roll_series("faces_image_right", metric)
            left = roll_series("faces_image_left", metric)
            assert slope(right) * slope(left) < 0, metric
            average = [(right[a] + left[a]) / 2 for a in ROLLS]
            assert max(average) - min(average) < bound, metric


class TestVersions:
    def test_the_measurement_version_names_the_correction(self):
        assert ev.VERSION == al.MEASUREMENT_VERSION == "2.1-sagittal-anatomical"
        assert al.LEGACY_MEASUREMENT_VERSION == "2.0-evidence"

    def test_a_record_without_a_version_is_legacy(self):
        assert al.version_of({}) == "2.0-evidence"
        assert al.version_of(None) == "2.0-evidence"
        assert al.version_of({"version": "2.0-evidence"}) == "2.0-evidence"
        assert al.version_of({"measurement_version": "2.1-sagittal-anatomical"}) == \
            "2.1-sagittal-anatomical"

    def test_the_photo_report_carries_its_version_and_conventions(self):
        from test_intake_api import png

        out = ev.photo({"image": png(800, 900), "include_3d": False, "view": "side_left"},
                       backend=lambda frame: [side_of(View.SIDE_LEFT, cx=400)])
        assert out["version"] == "2.1-sagittal-anatomical"
        assert out["conventions"] == {"side_view": "near_side",
                                      "sagittal_sign": "anterior_positive"}

    def test_two_versions_are_never_compared(self):
        before = al.assess(side_of(View.SIDE_LEFT, ear_ahead=20.0))
        after = al.assess(side_of(View.SIDE_LEFT, ear_ahead=30.0))
        assert al.compare(before, after).changes["forward_head"].comparable
        before.measurement_version = al.LEGACY_MEASUREMENT_VERSION
        comparison = al.compare(before, after)
        assert comparison.comparable_count == 0
        assert "different measurement versions" in comparison.changes["forward_head"].reason
        assert comparison.to_dict()["same_measurement_version"] is False


def legacy_report() -> dict:
    """A 2.0 photo report as it was stored before the correction.

    A side view declared ``side_left`` with the 2.0 sign: the person faced
    image-left, the ear was ahead of the shoulder, and 2.0 stored -0.055.
    """
    person = ev.assess_person(side_of(View.SIDE_LEFT, ear_ahead=11.0, cx=400), 800, 900,
                              view="side_left")
    for metric in person["metrics"]:
        if metric["id"] == "forward_head":
            metric["value"] = -0.055
    return {"version": "2.0-evidence", "kind": "photo", "created_at": "2026-05-01",
            "width": 800, "height": 900, "model": "RTMO-m", "people": [person]}


class TestOldResultsStayReadable:
    def test_a_stored_2_0_result_is_read_back_unchanged(self, tmp_path):
        from pilates.store import Store
        from pilates.studio import summarize

        with Store.open(tmp_path / "db") as store:
            stored = legacy_report()
            key = ev.record(store, stored, "Alex")
            back = ev.detail(store, key)["report"]
            assert back == json.loads(json.dumps(stored))
            assert back["version"] == "2.0-evidence"
            # the workspace summary renders it as stored, sign and all
            summary = summarize([{"view": "side_left", "report": back}])
            fh = next(m for m in summary["metrics"] if m["id"] == "forward_head")
            assert fh["value"] == -0.055

    def test_a_stored_result_with_no_version_at_all_is_still_readable(self, tmp_path):
        from pilates.store import Store

        with Store.open(tmp_path / "db") as store:
            stored = legacy_report()
            del stored["version"]
            first = ev.record(store, stored, "Alex")
            second = ev.record(store, copy.deepcopy(stored), "Alex")
            assert "version" not in ev.detail(store, first)["report"]
            # two legacy results still compare with each other
            assert ev.compare(store, first, second, "1", "1")["comparable"]

    def test_a_2_0_result_is_never_compared_with_a_2_1_result(self, tmp_path):
        from pilates.store import Store

        with Store.open(tmp_path / "db") as store:
            old = legacy_report()
            new = copy.deepcopy(old)
            new["version"] = ev.VERSION
            unversioned = copy.deepcopy(old)
            del unversioned["version"]
            a, b, c = (ev.record(store, r, "Alex") for r in (old, new, unversioned))
            for before, after in ((a, b), (c, b)):
                result = ev.compare(store, before, after, "1", "1")
                assert not result["comparable"]
                assert "Measurement versions differ." in result["reasons"]
                assert result["changes"] == [] and result["score_delta"] is None

    def test_a_filed_intake_set_without_a_version_is_legacy_and_not_compared(self):
        from pilates.api import _rebuild_assessment

        fresh = ik.assess_photos([ik.Photo(View.SIDE_LEFT, side_of(View.SIDE_LEFT, ear_ahead=20.0,
                                                                     cx=540), 1080, 1440)])
        row = {"username": "alex", "taken_on": "2026-05-01", "warnings": [], "doubts": [],
               "views": ["side_left"], "landmarks": {},
               "readings": {n: r.to_dict() for n, r in fresh.readings.items()}}
        filed = _rebuild_assessment(row)
        assert filed.measurement_version == "2.0-evidence"
        assert filed.readings["forward_head"].value == fresh.readings["forward_head"].value
        comparison = ik.compare(filed, fresh)
        assert comparison.comparable_count == 0
        row["readings"] = {n: {**r.to_dict(), "measurement_version": ev.VERSION}
                           for n, r in fresh.readings.items()}
        refiled = _rebuild_assessment(row)
        assert refiled.measurement_version == ev.VERSION
        # Same version: the version gate passes, and forward head is refused
        # only because it is held back from students, not for its version.
        change = ik.compare(refiled, fresh).changes["forward_head"]
        assert not change.comparable and "same answer" in change.reason
        refiled.held_back = fresh.held_back = frozenset()
        assert ik.compare(refiled, fresh).changes["forward_head"].comparable

    def test_a_score_change_is_never_computed_across_versions(self):
        """Every metric is refused across versions, so the headline is too."""
        older = ik.assess_photos([ik.Photo(View.FRONT, standing(shoulder_tilt=6.0, cx=540),
                                           1080, 1440)])
        newer = ik.assess_photos([ik.Photo(View.FRONT, standing(cx=540), 1080, 1440)])
        assert ik.compare(older, newer).score_change is not None
        older.measurement_version = al.LEGACY_MEASUREMENT_VERSION
        comparison = ik.compare(older, newer)
        assert comparison.score_change is None
        assert comparison.to_dict()["score_change"] is None
        before, after = al.assess(standing(shoulder_tilt=6.0)), al.assess(standing())
        before.measurement_version = al.LEGACY_MEASUREMENT_VERSION
        assert al.compare(before, after).score_change is None

    def test_a_rebuilt_legacy_record_does_not_claim_the_new_conventions(self):
        old = ik.assess_photos([ik.Photo(View.FRONT, standing(cx=540), 1080, 1440)])
        old.measurement_version = al.LEGACY_MEASUREMENT_VERSION
        assert old.to_dict()["conventions"] == al.LEGACY_CONVENTIONS
        single = al.assess(standing())
        single.measurement_version = al.LEGACY_MEASUREMENT_VERSION
        assert single.to_dict()["conventions"] == al.LEGACY_CONVENTIONS
        assert al.conventions_for("9.9-unknown") is None
        assert ik.assess_photos([]).to_dict()["conventions"] == al.CONVENTIONS

    def test_workspace_progress_evidence_is_labelled_with_its_version(self):
        from pilates.platform.progress_evidence import selected_progress_measurements

        def saved(version):
            report = {"version": version} if version else {}
            report.update(people=[legacy_report()["people"][0]])
            return {"kind": "posture", "views": [{"view": "side_left", "report": report}]}

        for version, expected in ((None, "2.0-evidence"), ("2.0-evidence", "2.0-evidence"),
                                  (ev.VERSION, ev.VERSION)):
            found = selected_progress_measurements(saved(version), {})
            assert found["side_left:forward_head"]["measurement_version"] == expected
            # the stored value is labelled, never rewritten
            assert found["side_left:forward_head"]["value"] == -0.055


def test_the_old_fixture_convention_is_gone():
    """The fixture that pinned the inverted convention now agrees with RTMO."""
    det = side_on(facing_image_left=True)
    assert det.scores[kp.L_EAR] > det.scores[kp.R_EAR]
    real = rtmo("faces_image_left")
    assert real.scores[kp.L_EAR] > real.scores[kp.R_EAR]


def test_no_customer_statement_is_unlocked_by_the_correction():
    """The corrected function produces numbers; that is not evidence.

    Forward head stays withheld from SEDENS customers, now because no
    repeatability testing with the real pipeline and real captures exists, and
    the shoulder line keeps its provisional 2.7 degree threshold unchanged.
    """
    rules = json.loads((ROOT / "data/sedens_feedback_rules.v1.json").read_text())
    withheld = {m["metric"]: m for m in rules["withheld_metrics"]}
    assert withheld["forward_head"]["reason"] == "awaiting_repeatability_evidence"
    assert set(withheld["forward_head"]["views"]) == {"left", "right"}
    assert all(set(rule["views"]) <= {"front", "back"} for rule in rules["observations"])
    shoulder = next(rule for rule in rules["observations"] if rule["id"] == "shoulder_line")
    assert shoulder["status"] == "provisional" and rules["status"] == "provisional"
    assert shoulder["threshold_deg"] == 2.7
    assert shoulder["threshold_basis"].startswith("Provisional")
    assert al.AWAITING_REPEATABILITY == set(SAGITTAL)


def real_side(panel: str, view: View) -> ik.Photo:
    entry = PANELS[panel]
    return ik.Photo(view, rtmo(panel), entry["width"], entry["height"])


def real_set() -> list[ik.Photo]:
    return [real_side("front", View.FRONT), real_side("faces_image_left", View.SIDE_LEFT),
            real_side("faces_image_right", View.SIDE_RIGHT), real_side("back", View.REAR)]


class TestTheIntakeDoesNotUnlockSideStatements:
    """The studio intake report is the student's own report. Under 2.0 every
    correctly labelled side photograph was flagged as the other side, which
    held the side-view statements back. 2.1 measures them correctly; that is
    not repeatability evidence, so they stay technical data there too."""

    def test_one_correct_side_photograph_has_no_headline(self):
        from pilates import guidance as gd

        out = ik.assess_photos([real_side("faces_image_right", View.SIDE_RIGHT)])
        assert not out.doubts
        assert out.readings["forward_head"].measured        # kept, as data
        assert out.score().value is None
        report = gd.report(out)
        assert report["findings"] == [] and report["pattern"] == {}
        assert report["findings_note"] and report["unremarkable"] == []

    def test_a_four_view_score_is_the_frontal_score(self):
        from pilates import guidance as gd

        full = ik.assess_photos(real_set())
        frontal = ik.assess_photos([p for p in real_set() if p.view.is_frontal])
        assert not full.doubts
        assert full.score().checks == frontal.score().checks
        assert full.score().value == frontal.score().value
        report = gd.report(full)
        assert not {f["metric"] for f in report["findings"]} & set(SAGITTAL)
        assert report["pattern"] == {}
        assert {e["metric"] for e in report["technical"]} == set(SAGITTAL)

    def test_the_printed_page_draws_no_side_callouts(self):
        from pilates import intakeview as iv

        full = ik.assess_photos(real_set())
        page = iv.render_photo(full, View.SIDE_RIGHT)
        for name in SAGITTAL:
            assert iv._chip_label(name, "en") not in page, name

    def test_a_swapped_pair_reports_each_photograph_once_in_plain_words(self):
        photos = [real_side("faces_image_left", View.SIDE_RIGHT),
                  real_side("faces_image_right", View.SIDE_LEFT)]
        out = ik.assess_photos(photos)
        assert len(out.mismatches) == 2 and len(out.doubts) == 2
        assert all("nearest the camera" not in d for d in out.doubts)
        # the technical sentence is still kept as a warning
        assert any("nearest the camera" in w for w in out.warnings)
        assert out.fix()["action"] == "swap"
