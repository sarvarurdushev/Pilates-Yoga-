# SEDENS feedback evidence

This document answers, for every piece of customer feedback the room gives, the
questions in brief §54:
- Where did the rule come from?
- Why can SEDENS say this, and what can it not say?
- When is the observation withheld, and how does capture quality affect it?
- How does it influence the recommendation?
- Which version produced a given result?

Sources are listed in `data/evidence_registry.json`, each with its URL, the quote
copied from the fetched page and whether an independent second check re-found it.
Ids in this document (`riebe2015`, `S14`, `PAG-SAFE` …) are keys in that file.

Throughout, five kinds of statement are kept apart:

| Kind | Meaning | Example |
|---|---|---|
| **Researched** | supported by a fetched source | "Symptoms during exertion should stop exercise" (riebe2015, cdc_heart_attack) |
| **Measured** | a number SEDENS computes from a photo | the shoulder-line angle in degrees |
| **Internal technical threshold** | "our camera can tell this from noise"; never "this is abnormal" | 2.7° for the shoulder line |
| **Customer-facing claim** | words the customer reads | "your right shoulder sat slightly higher than the other one" |
| **Experimental** | shipped, but provisional and labelled so | the whole scan feedback layer; real analysis on the free host |

## 1. Which version produced a result

Every stored result names the version that produced it. Old results are never
re-interpreted under newer rules.

| Customer output | Rules file and version | Stored with |
|---|---|---|
| Readiness outcome | `data/sedens_readiness.v1.json` (`sedens-readiness-1.0.0`); `v1_1.json` (`1.1.0`, current) | `s_readiness_checks.questionnaire_version` |
| Consent decisions | `pilates/sedens/consent.py` texts `2026-10-v2` (scan) | `s_consents.text_version` |
| Scan summary and observations | `data/sedens_feedback_rules.v1.json` (`sedens-feedback-1.0.0`) | `s_room_scans.feedback_rules_version`, plus `measurement_version` and `model`; one row per rule in `s_room_scan_observations` |
| Demonstration scan values | `data/sedens_demo_scan.v1.json` (`sedens-demo-scan-1`) | `s_room_scans.source = 'demo_precomputed'` |
| Personalized plan and "Why this session" | `data/sedens_recommendation_rules.v1.json` (`sedens-recommend-1.0.0`) and SEDENS Standard `1.0.0` | `s_recommendations.rules_version`, `library_version`, `inputs`, `rules_fired`, `rationale` |
| Effort and discomfort questions | `data/sedens_session_feedback.v1.json` (`sedens-session-feedback-1.0.0`) | `s_session_feedback.questions_version` |

## 2. Readiness check

**Purpose.** To answer "can this person reasonably start a general self-guided
workout today?", not "what condition does this person have?".

**Origin.** The questions are original SEDENS wording written from guideline content:
- the ACSM 2015 symptom-based pre-participation model, as applied in Whitfield 2017 (`riebe2015`, `whitfield2017`);
- WHO 2020 (`who_2020`), the US Physical Activity Guidelines 2018 (`pag_2018`), CDC, NHLBI and KDCA symptom pages;
- ACOG Committee Opinion 804 (`acog_804`) and NIA 2025 (`nia_2025`).

The questions are **not PAR-Q+**, not adapted from it, and not validated.

**Behaviour.**
- The server asks the items one at a time, in order.
- Answers are strictly Yes or No. "Recently" means today or the past two weeks; that window is a SEDENS design choice, because no source gives one.
- The first Yes stops the check with "We recommend not starting a self-guided workout right now" and an item-specific next step.
- For the symptom items, a Yes to "Are you feeling it right now?" gives "Please get help now": 119 or staff.
- Only all-No is `ready`.
- Answers are stored only up to the deciding one.

| Item (1.1.0) | Why it is asked | Yes means | Sources |
|---|---|---|---|
| `chest_discomfort` | exertional chest symptoms are the commonest warning sign before exercise-related cardiac events | do not start; see a doctor soon. If now: get help now | whitfield2017, riebe2015, cdc_heart_attack, nhlbi_heart_attack, kdca_2026 |
| `unusual_heartbeat` (new in 1.1.0) | palpitations are an ACSM warning symptom the 1.0.0 screen did not ask about | do not start; see a doctor soon. If now: get help now | whitfield2017, riebe2015, pag_2018 |
| `faint_or_dizzy` | fainting or near-fainting with exertion; dizziness is also a stroke sign | do not start; see a doctor soon. If now: get help now | whitfield2017, cdc_heart_attack, cdc_stroke, kdca_2026, nia_2025 |
| `unusual_breathlessness` | unusual breathlessness at rest or light effort | do not start; see a doctor soon. If severe now: get help now | whitfield2017, cdc_heart_attack, kdca_2026 |
| `recovering_injury_or_surgery` | return timelines vary by operation; only the treating professional knows | do not start; follow their advice | nia_2025, cuh_surgery, pag_2018 |
| `limiting_pain_today` | new, worsening or movement-limiting pain | do not start; rest; ask a health professional if it continues | pag_2018, nia_2025 |
| `professional_restriction` | an existing professional instruction outranks a self-service plan | do not start; follow that advice | pag_2018, cdc_chronic, who_2020 |
| `known_condition` (new in 1.1.0) | ACSM: inactive people with known cardiovascular, metabolic or renal disease need clearance; active people may continue light to moderate exercise | follow-up: "Has your doctor or care team told you that general exercise like this is fine?" Yes continues; No means do not start, ask your care team | whitfield2017, riebe2015, pag_2018 |
| `pregnancy_or_postpartum` | the sessions include lying on the back and were not designed for pregnancy | do not start; ask your doctor (a SEDENS precaution) | who_2020, acog_804, cdc_pregnancy, pag_2018 |
| `not_comfortable_alone_today` | a person who feels unsure should not train alone; design precaution, unquantified | do not start; end or ask staff | thompson_2007, pag_2018 |

**Outcomes.** These are `ready`, `do_not_start` and `urgent_help`. There is **no "modified
intensity" outcome**. The guidelines do not forbid one:
- ACSM lets active, asymptomatic people with known disease continue light to moderate exercise;
- NIA suggests self-adjusting for local pain;
- WHO and PAG make consultation optional for chronic conditions.

Leaving it out is a deliberately conservative **design choice** for a room with no
coach. It is not a guideline requirement.

### Readiness: what changed in 1.1.0

Two independent agents re-fetched every source of 1.0.0 and checked the claims against
them. Both found the same issues, and 1.1.0 applies them:
- a known-condition item;
- the palpitation item;
- "see a doctor soon" next steps for symptom items;
- a stop card that says to call 119 or alert staff **at once**, never "if it doesn't settle" (CDC, NHLBI and KDCA all say not to wait);
- sudden loss of balance or trouble walking added to the urgent signs (CDC and KDCA stroke signs);
- a 12-month window on the postpartum item;
- the professional-restriction item reworded in SEDENS's own terms.

Checks stored under 1.0.0 keep their 1.0.0 outcome.

### Readiness: known limitations

- ACSM's full symptom list also includes ankle swelling, pain in the legs when walking, breathlessness when lying flat and a known heart murmur. These are not asked; this is a deliberate omission, pending clinical sign-off.
- Screening studies applying the ACSM algorithm referred 33–54% of adults (`whitfield2017`). A strict screen can block many customers, which is itself a barrier to exercise, so the block rate must be monitored (`readiness_blocked` events).
- The 119 and "ask staff" copy is Korea-specific, and the facility must actually have staff reachable. "Sit or lie down somewhere safe" is a design suggestion, not sourced.

## 3. Scan feedback

### What the evidence allows

- **No posture-pain basis for advice.**
  - Posture–pain associations are cross-sectional and confounded by age (S01, S02).
  - There is no consensus that spinal posture causes back pain (S04).
  - Spinal curves and pelvic tilt are not associated with pain (S05, S06).
  - In the one prospective photo cohort, neck posture did not predict neck pain (S03).
  - **SEDENS therefore makes no pain, injury-risk or health statement about any observation.**
- **Shoulder asymmetry is not a screening sign.** Agreement on it is poor, and it correlates poorly with scoliosis screening (S09). The shoulder-line text never hints at the spine.
- **Pose keypoints are not anatomical landmarks** (S27, S14). There is no C7, acromion, ASIS or PSIS. So:
  - SEDENS **cannot** measure a craniovertebral angle or sagittal pelvic tilt;
  - "head forward" is an ear-to-shoulder-keypoint proxy;
  - the "hip line" is an estimated joint-centre line.
- **Absolute keypoint error is coarse.** It is 72–122 mm per joint (S28). Degree-level statements rest entirely on **repeatability**, not accuracy.
- **Model visibility is not correctness** (S27). It is never shown as a percentage.

### From repeatability to a threshold (internal technical threshold)

The best-matched repeatability study is S14. It used MediaPipe Pose on standardized
photos, with a one-week retest. Its shoulder-line results are:
- SEM 0.48°;
- MDC95 1.33° (MDC95 = 2.77 × SEM);
- typical healthy value 1.2° (SD 0.7–0.9).

SEDENS sets a **provisional threshold of 2.7°, twice that MDC95**. The doubling is
margin for an unsupervised room: no tripod check, free stance, and a different model
(RTMO). **The threshold means only "a difference this large is unlikely to be
measurement noise".** It says nothing about what is normal, healthy or worth
correcting.

The same number is the change threshold for comparisons.

Derived geometry (own pinhole-model arithmetic, not from a source):
- **Camera roll.** A camera rolled by θ adds θ to every frontal line angle in image space.
- **Camera height and body turn.** A camera 0.3–0.5 m off shoulder height, with the body turned 5–10°, can add about 0.6–2.5°.
- **Why front and back must agree.** The rule requires the front **and** back photos to both exceed 2.7° on the **same side**, measured with the anatomical sign (the person's own left and right). The person's left is on the image right in the front view and on the image left in the back view. So a camera roll pushes the anatomical value one way in the front view and the other way in the back view.
  - The same-side requirement therefore needs |true tilt| ≥ 2.7° + |roll|.
  - The reported value, the mean of the two views, cancels a constant roll.
  - This only holds if the model labels left and right correctly in the back view. That is checked in `docs/SEDENS_VISION_IMPROVEMENT_PLAN.md`.

**The 2.7° threshold is replaced** by SEDENS's own between-day study on the actual room
pipeline and camera (protocol in the vision improvement plan). It stays
**provisional** until then, and the rules file says so.

### Per-measurement decisions (`data/sedens_feedback_rules.v1.json`)

| Measurement | Customer-facing? | Why |
|---|---|---|
| Shoulder line, front and back (`shoulder_tilt`) | **Yes**: one sentence, when the rule passes | best-matched repeatability (S14); front/back agreement cancels camera roll; neutral wording |
| Head position, side views (`forward_head`) | **No** (Advanced only) | an ear-to-shoulder proxy, not CVA. Head MDCs are 2.5–6° (S15, S19). It needs a comparable earlier scan as reference, and the pipeline's side-view direction convention is under review |
| Hip line (`pelvic_obliquity`) | No (Advanced only) | repeatable, but no markerless validity (S15, S16, S17) |
| Side-to-side trunk lean | No (Advanced only) | depends on hip keypoints and true vertical |
| Ear line (`head_lateral_tilt`) | No (Advanced only) | ears are often hidden by hair |
| Sagittal pelvic tilt | Never computed | it needs ASIS/PSIS landmarks the model does not mark (S27) |

### The shoulder-line rule, answered as brief §54 asks

- **Where did it come from?** `shoulder_line` in `data/sedens_feedback_rules.v1.json` (sources S14, S15, S16, S08, S09, S27).
- **Why can SEDENS say it?** It is a description of what two photos showed, past a repeatability-based noise threshold. It contains no judgement.
- **What can it not say?**
  - good, bad, normal or abnormal;
  - any condition (for example "rounded shoulders", scoliosis or "imbalance");
  - any cause of pain;
  - that exercise will change it;
  - "improved" or "worse".
- **When is it withheld?** In any of these cases:
  - the front or back view is not `clear`: no person, several people, not full body, wrong direction, not standing, or low keypoint confidence;
  - either value is missing;
  - the two views disagree on the side and either is at or above the threshold.

  The customer then reads why. When the views disagree: "We didn't describe your shoulder line today because your front and back photos didn't agree. Standing the same way for both photos helps." Otherwise: "…because the camera couldn't see both shoulders clearly enough in your front and back photos." When both views are clear but under the threshold (including two small values on opposite sides), the customer reads "didn't show a difference larger than our camera's usual variation". When the front and back views both need a retake, no shoulder-line note is shown; the retake message says what to do.
- **How does capture quality affect it?** Each view gets a customer-language quality (Clear / Limited / Retake suggested) with a reason. Quality gates the rule; it is never shown as a number.
- **How does it influence the recommendation?** Only through `SCAN_SHOULDER_LINE_VARIETY_V1`: at most one gentle shoulder-mobility warm-up exercise, for goals other than core, stated as variety and not as a fix (`docs/RECOMMENDATION_RULES.md`). The evidence does not support choosing exercises to change a static photo observation (S32, S33, S34, S08). Creator courses are never changed.
- **Which version produced it?** It is recorded on each scan (`feedback_rules_version`, `measurement_version`, `model`) and per rule (`s_room_scan_observations`: value, outcome, reason, threshold).

### Comparison with earlier scans

A comparison is made only against the customer's last scan with:
- the same protocol (`sedens_room_scan_v1`);
- the same feedback rules version;
- the same source class (demonstration scans are never compared with real ones);
- a `clear` result.

The wording is "measured difference … larger than our usual variation" and "closer to
level" or "further from level". It never says "improved" or "worse". When there is no
comparable scan, the screen says so.

### Advanced measurements

Advanced measurements are collapsed by default. They show the view, the label, the
value with its unit, and a one-line limitation. They never show a confidence value,
a percentage or a score. The coaching workspace keeps its fuller professional report
through the `p_analyses` record.

### Korean regulatory framing

MFDS guideline 지침서-0091-03 (S39) classifies a product by its intended purpose, as
shown in labels, advertising and sales talk. Camera-based exercise guidance with
general health information, for health promotion and not for diagnosis or treatment,
is a wellness example. Customer copy, narration and marketing must stay inside that
purpose. A Korean legal review of the final copy is still open.

## 4. After the session: effort and discomfort

**Effort** is SEDENS's own 0–10 wording (`sedens-effort-0-10`):
- It paraphrases the public-domain CDC relative-intensity anchors: 0 sitting, 5–6 moderate, 7–8 vigorous, 10 maximal (CDC-INT, CDC-TALK).
- It is **not** Borg, CR10, session-RPE or OMNI. Those are licensed (BORG-FAQ, BORG-FEES), and their anchor words are not copied.
- It records how the session felt. It is unvalidated, and it is never presented as a measurement of fitness.
- It is asked at the end of the session; ratings are stable from 5 minutes to 24 hours afterwards (CHRISTEN-2016).

**Discomfort** is asked only after the session:
- "Did you notice any pain or unusual discomfort…?" If the customer is not sure, they choose Yes.
- An urgent check comes first: chest pain or pressure, trouble breathing, faint or dizzy means 119.
- Optional region, timing, strength and "still there" follow.
- The report is stored as given and never classified (no "soreness" or "strain").
- Its only effect is `RECENT_DISCOMFORT_HOLD`: the next plan stays light and never harder.

The basis is PAG-SYMPT ("new symptoms … consult a health care provider"), PAG-OVERUSE
and CHEUNG-2003. That progression should not happen automatically after a report is a
design rule consistent with guidance, not a tested rule.

**During the session**, "I don't feel well" stops at once:
- urgent signs (from the readiness file) mean 119 or staff;
- otherwise one tap names the category, the workout is saved as incomplete with that category, simple rest guidance is shown, and no further session is offered in that visit.

## 5. What SEDENS does not claim anywhere

- That it diagnoses, treats or prevents anything. Customer copy says "does not diagnose or treat" only in negation.
- Any posture, alignment, health or injury-risk score, grade, percentage or traffic-light colour.
- "Correct", "fix", "balance" or "realign" posture; "perfect form"; any real-time form correction. The camera is off during the workout.
- That anatomy shows measured muscle activation. Every anatomy panel says "Educational anatomy — not measured muscle activation".
- That a scan-personalised plan is better than a general one.
- That Pilates or stretching changes posture, prevents injury or treats pain (ROQUE-2024, BEHM-2016, PAG-FLEX).
- That any expert reviewed the content. All SEDENS Standard entries are `unreviewed`, and the demonstration label says so.

## 6. Verification status and open questions

- **Readiness sources.** Re-fetched and checked by two independent agents. Every relied-on quote was found; the two not found (AHA, a full-text mirror) are not relied on.
- **Scan feedback and session sources.** Quotes were copied from fetched text by the research agent. On 2026-10-15 every source that a shipped rule file cites (30 of them: the scan feedback rules, the recommendation rules and the session feedback copy) was re-fetched independently and its quote searched for in the fetched text. All 30 were found. Notes, all in `data/evidence_registry.json` (`verification`):
  - two PDFs' text layers mangle a word (`intensit y`, `enteainment`); the words around them match;
  - one quote is a table row, with `|` between the cells;
  - the S08 quote skipped a sentence without saying so; it now marks the gap with `...`;
  - the three CDC pages refuse scripted requests and were re-fetched the way a browser fetches them.
  - On 2026-10-19, S05 and S17 were re-checked the same way and found: they are not in a rule's `sources` list, but the feedback rules file names them in the notes that explain why two metrics are withheld.
- **Background sources** (57) that no rule file cites or names keep "independent re-check pending". Nothing in the product relies on them.

Open questions:
- SEDENS's own between-day repeatability on the room pipeline;
- the effect of clothing, hair and body size on keypoints;
- whether the camera can be fixed and levelled;
- clinical sign-off on the readiness omissions;
- a Korean legal review of the copy;
- cognitive testing of the effort and discomfort wording with 5–10 customers;
- pilot data on block rates and step timings.
