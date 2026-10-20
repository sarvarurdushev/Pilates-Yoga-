# SEDENS camera integrity report

Phase 4, Part 2. This report covers the side-view correction in `pilates/alignment.py`, the new measurement version, and what the change means for stored results. It also records what is still not known.

Every number below was measured in this repository's development container. It comes from one AI-generated demo image of one fictional person, or from synthetic skeletons. **No participants were involved, no real captures were used, and no accuracy or repeatability figures exist.**

## 1. Previous problem

Up to measurement version `2.0-evidence`, `pilates/alignment.py` labelled side views the wrong way round.

- `estimate_view` said: *"facing image-left means the camera sees the person's right side"* (`view = SIDE_RIGHT if lead < 0 else SIDE_LEFT`). The opposite is true: a person facing image-left shows the camera their **left** side.
- Three other parts were written to match the inverted label:
  - the sign flip in `forward_head` (negate for `SIDE_RIGHT`);
  - the sagittal sign in `trunk_lean` (negate for `SIDE_RIGHT`);
  - `_facing`, which signs the four `sagittal_*_offset` metrics.

Because those parts agreed with each other, the module was self-consistent and its own tests passed. The `side_on` test fixture had the same inversion: facing image-left, it put the *right* ear nearest the camera.

How the error showed up depended on where the view came from.

| How the view was obtained | Side label | `forward_head` | `trunk_lean_sagittal`, `sagittal_*_offset` |
|---|---|---|---|
| Estimated (`view="auto"`) | inverted | read the far, hidden ear, so on real photos it was **never measured** | correct sign (the two inversions cancelled) |
| Declared, person turned as instructed (SEDENS room, intake, workspace with a chosen view) | correct | measured on the near ear, **sign inverted** | **sign inverted** |

Two further consequences:

- **Intake.** `intake._view_mismatch` compared every correctly taken side photograph against the inverted estimate. It flagged each one as "mirrored", added a doubt, and offered to swap or relabel photographs that were right.
- **SEDENS.** SEDENS already withheld `forward_head` from customers (`side_view_convention_under_review`), so no customer statement depended on the inverted sign.

Frontal metrics were not affected. Those are the front/rear detection, the shoulder, pelvis and head lines, lateral trunk lean, knee alignment and weight bias.

## 2. Evidence of the problem

### 2.1 Fixtures

- **Real landmarks.** RTMO-m ran on `web/assets/studio/demo-four-views.png` (SHA-256 `e9c774803f50…`, recorded in the fixture). This is an AI-generated picture of one fictional person.
  - Each 384 px panel was padded by 192 px on each side.
  - Each crop was run plain, mirrored (`cv2.flip`), and rolled from −3° to +3°.
  - Results are stored in `tests/data/camera_integrity_rtmo.json`, with provenance. The script that produced it is `tools/camera_integrity_fixture.py`.
  - The facing direction of each panel was written down by looking at the picture, not taken from the model.
- **Synthetic skeletons.** `tests/test_alignment.py::side_on` (corrected) and `side_of`. These are built from the geometry in section 3.

### 2.2 What RTMO reports on the real panels

These numbers were reproduced independently of the earlier survey.

| Panel (facing, by eye) | RTMO left / right ear score | 2.0 estimated label | 2.1 estimated label |
|---|---|---|---|
| nose points to image-right | 0.001 / 0.991 | `side_left` | `side_right` |
| nose points to image-left | 0.994 / 0.002 | `side_right` | `side_left` |
| front | 0.876 / 0.936 | `front` | `front` |
| back (nose score 0.079) | 0.848 / 0.918 | `rear` | `rear` |

RTMO labels ears anatomically. In both profiles it finds only the ear on the side the person faces toward, so the model's own labels contradict the 2.0 side labels.

### 2.3 Values on the same panels, side declared as the protocol asks

The 2.0 code was run from `git show HEAD:pilates/alignment.py` on the same stored landmarks.

| Panel | Version | `forward_head` | `trunk_lean_sagittal` | ear / shoulder / hip / knee offset |
|---|---|---|---|---|
| faces image-right, `side_right` | 2.0 | **−0.064** | +2.27 | −0.031 / −0.016 / −0.031 / −0.014 |
| | 2.1 | **+0.064** | −2.27 | +0.031 / +0.016 / +0.031 / +0.014 |
| faces image-left, `side_left` | 2.0 | **−0.055** | +0.47 | −0.037 / −0.029 / −0.032 / −0.020 |
| | 2.1 | **+0.055** | −0.47 | +0.037 / +0.029 / +0.032 / +0.020 |

Check against the raw pixels, without any convention from the module:

- In the image-right panel the visible right ear is at x = 375.7 and the right shoulder at x = 361.3. The ear is therefore 14.4 px toward the nose, over a 224.5 px torso, which gives +0.064 with the ear in front.
- The shoulder midpoint (x 366.7) is 9 px *behind* the hip midpoint (x 375.7), which is a slight backward lean, so −2.27° is the correct sign.

The tests repeat this check directly from the landmarks (`TestTheRealPanels`).

With an estimated view, 2.0 returned `forward_head` as unavailable on both panels ("the ear, shoulder or hip on the camera side was not found"), because it looked for the hidden ear.

### 2.4 Synthetic skeletons

The skeletons are labelled anatomically, with the far ear scored 0.05. For `side_left` the true forward-head ratio is 0, +0.10 or −0.05. For `side_right`, the 3 px shoulder offset built into `side_on` makes the true ratios −0.015, +0.085 and −0.065.

- 2.0 estimated the opposite side in all six cases, and `forward_head` was unavailable in all six.
- With the correct side declared, 2.0 returned exactly −truth.
- 2.1 returns the truth.

The 2.0 columns in 2.3 and in this section come from running `pilates/alignment.py` as it was at commit `9ddfca5` (unchanged up to the base commit `e0f1e2cb729c`) on the same inputs. No script in the repository reruns the 2.0 code.

## 3. Corrected mathematical convention (version `2.1-sagittal-anatomical`)

**Frame.** Image x runs right and y runs down; the viewer looks along −z. A person's right hand points along *forward × up*. A person facing +x therefore has their right side toward the camera (+z).

**Facing sign φ.**

- φ = sign(x_nose − x_shoulder_mid).
- If the nose is not found, φ comes from the one ear the model found: a right ear gives φ = +1, a left ear gives φ = −1.
- If the nose and the visible ear disagree, the estimate is kept, but with confidence ≤ 0.5, which is too weak to overrule a declared view.
- **Deviation from the design.** The design says the fallback is "the higher-scoring ear". The code uses the one ear found above the landmark threshold and gives no answer (`UNKNOWN`) when both or neither are found, and it adds the disagreement cap above. Side-on, the far ear is hidden, so finding both ears means the profile is ambiguous, and refusing is safer than picking the slightly higher score.

**Side label.** The side label is the side nearest the camera.

- φ = +1 gives `side_right`.
- φ = −1 gives `side_left`.
- A declared view implies φ: `View.facing` is +1 for `side_right` and −1 for `side_left`. This holds for unmirrored pictures only.

**Sagittal metrics.** All are anterior-positive, and all use the near-side joints for the view.

- `forward_head = φ · (x_ear − x_shoulder) / |y_shoulder − y_hip|`
- `trunk_lean_sagittal = φ · atan2(x_shoulder_mid − x_hip_mid, |y_hip_mid − y_shoulder_mid|)`, in degrees.
- `sagittal_X_offset = φ · (x_X − x̄_ankles) / span`
  - X is ear, shoulder, hip or knee.
  - x_X is the mean of the found pair.
  - span is the distance from shoulder to ankle.

**A declared side that disagrees with the picture is reported, not trusted.**

- `alignment.side_contradiction` checks the declared side against the estimate.
- If the estimate is confident (≥ 0.7, the same bar `assess_person` already uses for camera planes) and names the other side, `alignment.assess` adds this warning: *"the photograph was labelled as the left side, but the person's right side is nearest the camera; check the camera plane, which shoulder faced the camera, and that the picture was not mirrored…"*
  - All metrics for that photograph are withheld.
  - `assess_person` marks the person unsuitable.
  - SEDENS maps the "camera plane" wording to its existing customer reason `wrong_direction`.
- The intake path also keeps its existing `Mismatch` / `swapped_pair` / `mislabelled` offer. That offer now fires when the sides really are exchanged, not on every correct set.
  - When the `Mismatch` speaks for a photograph, the technical sentence above stays in the intake warnings only. The student sees the `Mismatch` wording, which is plain, in English and Korean, and comes with the fix. Without this, a swapped pair listed four doubts for two problems.

**Reports state the convention.**

- `assessment.VERSION` is `"2.1-sagittal-anatomical"`. It is defined as `alignment.MEASUREMENT_VERSION`, next to the geometry it names.
- Photo and video reports carry `"conventions": {"side_view": "near_side", "sagittal_sign": "anterior_positive"}`.
- `PostureAssessment.to_dict`, `PhotoAssessment.to_dict` and the comparison payloads carry `measurement_version`.
- A record rebuilt under the legacy version does not claim the new conventions. `alignment.conventions_for` gives `{"side_view": "facing_label_inverted", "sagittal_sign": "see_camera_integrity_report"}` for `2.0-evidence`, and nothing for an unknown version.

## 4. Tests and fixtures

**New file: `tests/test_camera_integrity.py`.**

- **Fixture provenance:** the image hash, and that every crop found a person.
- **Real panels:**
  - RTMO's near-ear labels;
  - the view estimate for all four panels;
  - `forward_head`, trunk lean and ear offset checked against signs computed straight from the pixels;
  - both sides of one body agree in sign;
  - a contradicted declaration is withheld;
  - `assess_person` gives the "camera plane" refusal;
  - the frontal values are unchanged.
- **Synthetic:**
  - `forward_head` equals the constructed ratio for both sides, with estimated and declared views;
  - the opposite declaration is refused;
  - the nose-only and ear-only cues work;
  - when the nose and the ear conflict, the estimate is too weak to overrule a declaration.
- **Every sagittal sign:** each of the four chain links moved forward and back by 22 px on both sides; trunk lean forward and back; head forward and back.
- **Mirroring and camera roll:** see section 7.
- **Versions:**
  - the constant;
  - `version_of`, where a missing version is legacy;
  - the photo report carries its version and conventions;
  - `alignment.compare` refuses two versions.
- **Old results stay readable:**
  - a stored 2.0 evidence report reads back byte-identical and renders through `studio.summarize` with its stored sign;
  - a report with no version reads back and still compares with another legacy report;
  - 2.0 and 2.1 reports, including unversioned ones, are refused with "Measurement versions differ.";
  - a filed intake set without a version rebuilds as 2.0 and is not compared with a new set;
  - workspace progress evidence carries `measurement_version`, and the stored value is unchanged.
- **Customer statements:** `forward_head` is withheld with `awaiting_repeatability_evidence`, and the shoulder line keeps `status: provisional` and 2.7°.

**Changed tests.** Each change follows from the geometry in section 3 and from RTMO's ear labels, not from flipping signs until tests pass.

- `tests/test_alignment.py`:
  - `side_on` now puts the left ear nearest when facing image-left;
  - new helper `side_of(view)`;
  - the view parametrisation;
  - the plumb-chain tests pair `side_left` with facing image-left.
- `tests/test_intake.py` and `tests/test_intake_api.py` build side photographs with `side_of`.
  - `test_one_photograph_withholds_the_headline` only passed because the 2.0 fixture contradicted its label. It now tests what remains true: a side photograph that shows the other side is withheld. See section 5.
- `tests/test_guidance.py::chained` builds the left-side body facing image-left.
- `tests/test_evidence.py` builds the right-side body facing image-right.
- `tests/test_progress_evidence.py` expects the new `measurement_version` label.

**Frontend tests** (`web/test/comparison.test.mjs`, `web/test/progress-selection.test.mjs`):

- a capture is never compared with one from another measurement version;
- a report without a version is legacy 2.0;
- a progress series is split by version.

## 5. Effects on old measurements

**Stored rows are never rewritten.**

- `s_room_scans.measurement_version` stays `2.0-evidence` on existing scans.
- Stored analysis JSON keeps `"version": "2.0-evidence"`.
- Evidence-store reports, filed intake readings, `p_joint_measurements` and `p_progress_records` keep their values.

**A record without any version predates versioning and is read as `2.0-evidence`.** This applies to:

- workspace view reports and seeded demo reports from before this change;
- filed intake rows, where the version now travels on each stored reading because the `assessments` table has no column for it;
- frontend payloads.

**What a stored 2.0 side-view value means.** It depends on how its view was obtained, so it cannot be converted with a single rule.

- **Declared view, person turned as instructed** (`view_source: "user-declared"`). This covers the SEDENS room, the intake and the workspace with a chosen view.
  - `forward_head`, `trunk_lean_sagittal` and all `sagittal_*_offset` have the anterior sign reversed: −0.064 in 2.0 is +0.064 in 2.1.
  - The side label itself is correct.
- **Estimated view** (`view_source: "estimated"`).
  - The side label is reversed: a stored `side_left` was a right-side photograph.
  - `forward_head` is missing.
  - Trunk lean and offsets have the correct, anterior-positive sign.
- **Declared view, person turned the other way.**
  - `forward_head` is usually missing because the far ear was used.
  - Trunk lean and offsets have the correct sign, but the label is wrong.

**How stored 2.0 values are treated.**

- **No relabelling and no sign conversion.** There is no compatibility table: converting would need trust in each record's `view_source` and in the person having turned as instructed, and neither has been checked.
- **Readers keep rendering 2.0 values exactly as stored.**
- **Comparisons refuse to cross versions:**
  - `assessment.compare` returns "Measurement versions differ.", and it now also handles a report with no version instead of raising `KeyError`;
  - `alignment.compare` and `intake.compare` refuse every metric, frontal ones included, with "measured under different measurement versions";
  - `Comparison.score_change` is empty across versions, and `/assessment/compare` leaves out both filed scores and says, in English and Korean, that the two visits were measured with different versions;
  - the filed intake trend (`/assessments`) draws only the newest version's scores, and says how many earlier scores it left out;
  - the workspace `findComparableVisits` skips earlier captures from another version;
  - `comparableProgressSeries` keeps each version in its own series.
- **SEDENS scan comparability is gated separately** in `scan_history` / `scans._previous`, which another workstream owns.

**Intake report after the correction.** Under 2.0 every correctly taken side photograph was flagged as mirrored, which withheld the intake headline score and held back the findings for any set that included side photographs. Under 2.1 a correctly taken set is no longer flagged. Left alone, that would have given students a headline score, findings, a programme and a "pattern" sentence built on six side-view checks whose repeatability nobody has measured. So the six side-view metrics are held back in the intake (`alignment.AWAITING_REPEATABILITY`, reason `awaiting_repeatability_evidence`):

- They are still measured, kept in the readings and filed with the assessment.
- They are not part of the headline score, its coverage, the regions, the findings, the priorities, the programme, the habits, the "pattern" sentence or the "inside its usual range" list.
- The report lists them under `technical`, with a plain note in English and Korean. The student screen shows their names with that note and no number on a band. The printed page draws no callouts for them.
- Two visits are not compared on them.
- A four-view set therefore scores exactly what its front and back photographs score. A set of side photographs alone has no score, and says that side photographs are not scored yet.
- A filed 2.0 intake is re-rendered under the same rule.

**Demo data.**

- **`pilates/platform/seed.py`.** The simulated `side_left` skeleton was built facing +x, which is a right side.
  - It is now built facing +x and mirrored about x = 500 for `side_left`, in both the standing and movement frames.
  - Its reports carry `"version"`.
  - Every metric value in all 120 precomputed scenarios is identical before and after the change (checked: all 124 view reports in the 120 files, including movement ranges, no differences). Only the landmark coordinates changed. The old skeleton and the old convention were wrong together, so their values matched.
  - `alignment.py` is now part of `demo_scenarios.source_digest()`. The 120 files were rebuilt with `python -m pilates.platform.demo_scenarios --build`.
- **`web/assets/studio/demo.json`** (the studio demo). Panel 3 of the demo image faces image-right, so it is the right side; it was labelled `side_left`. `tools/seed_studio_demo.py` now maps `side_left` to panel 4 and `side_right` to panel 3, and the file was regenerated. Only that mapping changed; the generator is deterministic.
- **`data/sedens_demo_scan.v1.json`** was not changed.
  - Its values are hand-written fictional numbers (`forward_head` +0.04 and +0.05), not computed by the pipeline.
  - They are labelled `measurement_version: "demo"`, which is never comparable with a real scan.
  - They read as "slightly anterior" under the corrected convention, so the file stays internally consistent.

## 6. Which metrics remain customer-visible

**SEDENS.** Only the **shoulder line**, from the front and back photographs together, unchanged:

- both views measured and clear;
- the same anatomical side;
- both at or above the **provisional, experimental 2.7° threshold** (`status: "provisional"` in `data/sedens_feedback_rules.v1.json`, explained in `docs/SEDENS_FEEDBACK_EVIDENCE.md`).

The threshold remains experimental until repeatability with the actual RTMO pipeline on real captures supports one. When the evidence is insufficient, the observation is withheld.

**Not unlocked by this correction.** `forward_head` stays withheld from SEDENS customers. Its reason is renamed from `side_view_convention_under_review` to **`awaiting_repeatability_evidence`**. The corrected function produces numbers, but numbers are not evidence.

**Studio intake report** (which a student can open for their own account). The frontal metrics are shown as before. The six side-view metrics are held back as technical data; see section 5.

## 7. Which remain technical-only, and the mirror and roll findings

**Technical-only in SEDENS** (shown in SEDENS Advanced; never a SEDENS customer observation):

- `forward_head`, `trunk_lean_sagittal`, `sagittal_{ear,shoulder,hip,knee}_offset`;
- `pelvic_obliquity`, `head_lateral_tilt`, `trunk_lean_lateral`;
- the knee proxies, `lateral_weight_bias`, and the lateral chain.

**Where `forward_head` now appears with an estimated view.** An estimated side view comes only from `view="auto"`, which three places use:

- the local `/evidence/photo` and `/evidence/video` tool, which is refused in authenticated studio mode;
- the `/posture` and `/posture/compare` JSON API called with no view (a student may call it for themselves, but no web screen does);
- the CLI without `--view`.

In these places 2.0 always reported `forward_head` as unavailable, and 2.1 measures it.

The platform workspace (`platform/jobs.py`) and the studio accept only declared views, so they never estimate one. **Workspace reports are not staff-only.** A student sees their own analyses (`repository._scope`), including the "main observation". There, `forward_head` on a declared side view was already shown under 2.0, with the inverted sign. 2.1 corrects the sign and adds no new statement. The workspace definition of `forward_head` already said "positive means the ear is forward of the shoulder"; it is now true. Whether the student-role workspace report should label side-view metrics "technical" instead of choosing one as its main observation is a separate product decision (section 9).

### Mirroring

- **Side views.** RTMO labels what it sees. On the mirrored image-right profile it finds the left ear (0.993) and not the right (0.003). A mirrored left side is therefore indistinguishable, landmark for landmark, from an unmirrored right side.
  - With an estimated view, the mirrored picture is read as the other side, and forward is still forward (`forward_head` 0.064 plain, 0.064 mirrored).
  - With the original side declared, the mirrored picture contradicts its label, and 2.1 refuses it. Before 2.1 nothing was refused.
- **Front and back views.** These stay front and back. Left and right swap silently, and this cannot be detected from landmarks.
  - Back panel: shoulder line +1.25° became −0.27°, pelvis +0.88° became −0.83°, head +0.15° became −1.08°.
  - Front panel: values were near zero (shoulder +0.31° and +0.19°).
- **RTMO is not mirror-symmetric** on this image. The mirrored value and the negated original differ by up to about 1.3° (front pelvis line: +1.11° plain, +0.17° mirrored) and 1.4° (sagittal trunk lean: −2.27° became −0.92° once the side was relabelled).
- **What protects against mirroring.** Only the capture path. The SEDENS room mirrors the live preview with CSS only, and uploads the camera's own unmirrored still.

### Camera roll

The crop was rotated about its centre (positive is counter-clockwise), from −3° to +3°. Slopes are least-squares fits over seven rolls of one image; they are observations, not error bounds.

| Crop | Metric | Change per degree of roll | Range over ±3° |
|---|---|---|---|
| front | shoulder line | +0.86° | −2.36° to +2.77° |
| back | shoulder line | −0.76° | −1.07° to +3.30° |
| front | lateral trunk lean | −0.97° | +2.77° to −2.96° |
| front | pelvis line | +0.78° | −1.56° to +2.75° |
| faces image-right | `trunk_lean_sagittal` | −0.87° | +0.32° to −4.95° |
| faces image-left | `trunk_lean_sagittal` | +0.99° | −3.46° to +2.46° |
| faces image-right | `forward_head` | −0.010 | 0.087 to 0.028 |
| faces image-left | `forward_head` | +0.008 | 0.024 to 0.079 |
| either side | `sagittal_ear_offset` | about ±0.02 | −0.029 to +0.094 |

What the roll results show:

- **Roll alone crosses the bands.** A 3° roll takes the shoulder line across the ±2° band and the trunk lean across ±3°. It also moves `forward_head` by 0.03 or more, which is 30% of `RATIO_ZERO_AT`.
- **Front and back move in opposite anatomical directions under roll.** The average of front and back shoulder lines varied by 0.64° over ±3°, against 5.1° for the front alone. This supports the existing SEDENS rule that front and back must agree on the same side.
- **The two side views also move in opposite directions.** The left/right averages varied by:
  - 0.35° for trunk lean;
  - 0.006 for `forward_head`;
  - 0.004 for the ear offset.

  So averaging the two sides would cancel roll to first order. **Nothing averages them yet**, and one image does not establish this in general.

## 8. Files changed

- **Code:**
  - `pilates/alignment.py`
  - `pilates/assessment.py`
  - `pilates/intake.py`
  - `pilates/api.py` (filed intake version, version gate on the compared scores, trend split by version)
  - `pilates/store.py` (filed version on the history rows)
  - `pilates/guidance.py`, `pilates/intakeview.py` (held-back side metrics in the intake report)
  - `pilates/cli.py` (help text; filed intake version)
  - `pilates/platform/progress_evidence.py`
  - `pilates/platform/seed.py`
  - `pilates/platform/demo_scenarios.py`, plus 120 rebuilt `.json.gz` files
- **Frontend:**
  - `web/src/platform/comparison.js`
  - `web/src/platform/progress-selection.js`
  - `web/src/session/posture.js` (held-back rows, version refusal, trend note)
  - `web/src/platform/explain.js` (the camera guide drew the two side cameras on the wrong sides)
- **Data:**
  - `data/sedens_feedback_rules.v1.json` (withheld reason and note only)
  - `web/assets/studio/demo.json`
  - `tools/seed_studio_demo.py`
  - `tests/data/camera_integrity_rtmo.json`, made by `tools/camera_integrity_fixture.py`

## 9. Outstanding validation requirements

**None of the following has been done.**

1. **Repeatability with the real RTMO pipeline and real captures.** Required before any side-view value, or a changed shoulder threshold, reaches a customer. It needs:
   - a controlled capture set: the same people on different days, each with documented consent;
   - measured camera height and roll;
   - all four views;
   - test-retest spread per metric.

   There are no participants and no such data, so no accuracy, minimal detectable change (MDC) or repeatability figure exists for any metric.
2. **Real side photographs.** The correction is verified on one AI-generated image and on synthetic skeletons, not on photographs of real people. The facing cue (nose against shoulders) and the near-ear check should be confirmed on real captures, including clothing, hair and partial occlusion.
3. **Mirroring in real capture paths.** That the SEDENS room uploads an unmirrored still is inferred from the code (`drawImage` from the video element), not tested on room hardware or browsers.
   - Phone cameras and third-party uploads may deliver mirrored images.
   - A mirrored front or back photograph cannot be detected from landmarks.
4. **Roll.** The cancellation in front/back and left/right pairs is measured on one image only. Whether to add a left/right average for side views, or a roll estimate from the room camera, is undecided.
5. **Releasing side-view metrics in the intake report.** They are held back as technical data (section 5) and stay so until item 1 exists. Releasing them then means removing names from `alignment.AWAITING_REPEATABILITY`; the scoring, findings and pattern code for them is kept and tested with the hold switched off.
6. **Legacy relabelling.** Stored 2.0 side values are kept and marked as not comparable. Converting them would need each record's `view_source` and confirmation that the person turned as instructed, and has not been attempted.
7. **Side-view metrics in the student-role workspace report.** Shown there before and after 2.1 (now with the correct sign). Whether they should be labelled "technical" rather than chosen as the student's main observation is undecided.
