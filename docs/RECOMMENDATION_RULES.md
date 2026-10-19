# SEDENS Standard personalized sessions: recommendation rules

The code is `pilates/sedens/plans.py`. The rules live in
`data/sedens_recommendation_rules.v1.json` (version `sedens-recommend-1.0.0`,
status **provisional**). The library is `data/sedens_standard/exercises.v1.json`
(SEDENS Standard 1.0.0).

## 1. What the builder is, and what it is not

- **Deterministic.** `plans.build(inputs, library, rules)` is a pure function. The same inputs, library and rules always give the same plan. No language model and no random choice is involved.
- **Explainable.** Every plan is stored in `s_recommendations` with:
  - the exact inputs;
  - the ids of the rules that fired;
  - the rules version and the library version;
  - the plan as a list of `(exercise, phase, sets, seconds)`;
  - the 3–4 reasons shown under "Why this session" (always the goal and the effort, then one or two more; the time budget when nothing else applies);
  - whether it was accepted, declined or replaced.
- **SEDENS Standard only.** It never touches a creator's or facility's course. A course always plays from its exact enrolled version (`pilates/sedens/workouts.py`).
- **Not a prescription.** It assembles general-fitness sessions from audited content. It does not treat, correct or diagnose anything.

## 2. Inputs

The `inputs` column records each of these.

| Input | Source |
|---|---|
| readiness | this visit's readiness check. It must be `ready` (gate) and is stored with its version |
| goal | `mobility`, `pilates` (Beginner Pilates), `core` (Core and stability) or `general` (Mobility and Pilates mix): the customer's choice |
| duration | 30 or 60 minutes: the customer's choice |
| intensity | `light` or `moderate`: the customer's choice. Vigorous is not offered in an unsupervised room in v1 |
| experience | `new` (fewer than 3 completed room sessions) or `returning` |
| allowed review statuses | demonstration facility: all statuses (always labelled); real facility: `sedens_reviewed` and `expert_reviewed` only |
| recent history | days since the last room session; that session's effort rating and whether discomfort was reported; the previous SEDENS Standard plan |
| scan focus | `shoulder_mobility` only when this visit's scan **showed** the shoulder-line observation (`s_room_scan_observations.outcome='shown'`) |
| room equipment | `["mat"]` |

## 3. Priority

This follows brief §21.

1. **Safety and readiness.** No plan exists without a `ready` readiness check. A reported discomfort keeps the next plan light and never harder.
2. **The customer's goal.** It decides the exercise categories of each part.
3. Duration.
4. Experience: levels and maximum sets.
5. Room equipment.
6. Recent sessions.
7. **Scan observations.** At most one variety exercise, and only for some goals. The scan never overrides the goal.
8. Variety.

## 4. Rules

Every rule is in the JSON file with its own `applies`, `sources`,
`customer_explanation` and `last_reviewed` fields. Source ids refer to
`data/evidence_registry.json`.

| Rule | Kind | What it does | Customer explanation | Sources | Last reviewed |
|---|---|---|---|---|---|
| `READINESS_REQUIRED` | gate | No plan without this visit's readiness check ending `ready` | (none: a blocked check ends the journey first) | riebe2015, who_2020, pag_2018 | 2026-10-13 |
| `GOAL_PHASE_CATEGORIES` | selection | Each goal lists the allowed categories for the warm-up, main block and cool-down in order of preference. A later category fills only when earlier ones run out. Warm-up and cool-down prefer exercises the main block cannot use | "Your goal: {goal}" | PAG-WARM, WHO-MS, CRUZFERREIRA-2011, KAMIOKA-2016 | 2026-10-13 |
| `INTENSITY_EFFORT` | selection | Light: light-effort exercises only, 45 s between sets. Moderate: light and moderate exercises, 35 s between sets | "Your selected effort: {intensity}" | CDC-INT, CDC-TALK, PAG-REL, PAG-SAFE | 2026-10-13 |
| `DURATION_BUDGET` | timing | Every step's seconds are calculated (§5). The plan must land in 27–33 min (30) or 55–65 min (60) | "Your time: about {minutes} minutes" (only when no other reason applies) | ACSM-2009, SCHOENFELD-2015, ACSM-2026-TEMPO-REST | 2026-10-13 |
| `SHORTER_PLAN_OFFERED` | timing | When the audited library cannot fill the time, the shorter plan is offered with its real length and a notice. Nothing under 20 minutes is offered | notice "The SEDENS library can't fill {minutes} minutes for you yet, so this plan is about {available} minutes…" | PAG-SAFE | 2026-10-13 |
| `EXPERIENCE_SETS` | dose | New customers: foundation-level exercises, at most 2 sets. Returning customers: intermediate too, at most 3 sets. Sets are added only to fill the main block | (none) | PAG-MS, ACSM-2026-SETS | 2026-10-13 |
| `ROOM_EQUIPMENT` | selection | Only exercises needing nothing beyond the mat | (none) | (design) | 2026-10-13 |
| `REVIEW_POLICY` | selection | Demonstration rooms may use unreviewed entries (labelled "Demo content — not yet expert-reviewed"). Real rooms only reviewed ones; today that means none, so a real room explains that personalized sessions are not available yet | message `no_reviewed_content` | (design) | 2026-10-13 |
| `RECENT_DISCOMFORT_HOLD` | history | Discomfort reported after the last room session (within 30 days): light-effort exercises only and no harder options. Nothing about the discomfort is interpreted | "Last time you noted discomfort, so today stays light and won't get harder." | PAG-SYMPT, PAG-OVERUSE, CHEUNG-2003 | 2026-10-13 |
| `RECENT_HARD_STEP_DOWN` | history | Last session's effort ≥ 2 above the band of the effort chosen for it (within 14 days): light-effort exercises are preferred | "Your last session felt harder than planned, so today starts with lighter exercises." | PAG-SAFE, ACSM-2026-PROG | 2026-10-13 |
| `LAST_SESSION_CONTEXT` | context | Says how long ago the last room session was. Changes nothing | "Your last session: {days} days ago" | (none) | 2026-10-13 |
| `SCAN_SHOULDER_LINE_VARIETY_V1` | scan | See below | "Today's scan: a shoulder-line difference was visible, so one gentle shoulder-mobility exercise is included for variety. It isn't meant to change your shoulder line." | ROQUE-2024, KONRAD-2024, S14 | 2026-10-13 |
| `VARIETY_LAST_PLAN` | variety | Exercises from the previous SEDENS Standard plan move behind unused ones of the same preference | (none) | (design) | 2026-10-13 |

### The only scan-driven rule: `SCAN_SHOULDER_LINE_VARIETY_V1`

| Field | Value |
|---|---|
| Observation required | `shoulder_line` **shown** under feedback rules `sedens-feedback-1.0.0` |
| Minimum measurement quality | front and back views both `clear`, one person, confidence ≥ 0.65, both values on the same side, both ≥ the provisional 2.7° threshold |
| Relevant goals | mobility, pilates, general (**not** core: the customer's goal wins) |
| Allowed exercise categories | mobility, with scan tag `shoulder_mobility` (today: Arm Arcs and Shoulder Placement, Thread the Needle, Overhead Reach), and only in the warm-up |
| Effect | at most **one** exercise, placed first among the warm-up's candidates; nothing is removed for it except by the normal time budget |
| Excluded situations | scan skipped; observation withheld or below threshold; goal `core`; no tagged exercise fits the warm-up; any creator course |
| Evidence | posture changes from exercise in adults rest on very low to low certainty evidence (ROQUE-2024). Stretching raises range of motion over weeks (KONRAD-2024) but nothing shows this exercise changes the observation. The threshold only separates the reading from camera noise (S14; `docs/SEDENS_FEEDBACK_EVIDENCE.md`). |
| Customer explanation | it says plainly that the exercise is for variety and is not meant to change the shoulder line |
| Last reviewed | 2026-10-13 |

Rules rejected for weak evidence: anything mapping the pelvis, head position or trunk to exercises (no customer observation exists for them), and anything claiming to "correct" or "balance" posture.

## 5. Time budgeting

Each step's time is:

```
transition in   10 s same floor position, 20 s floor change, 30 s to/from standing (first step: from standing)
+ demonstration 15 s (first appearance)
+ sets x set time
    reps: reps x seconds_per_rep (3-8 s, per exercise) x sides (2 for each_side/alternate) + 5 s side switch (each_side)
    hold: hold_seconds x sides
+ (sets - 1) x rest between sets (reps: 45 s light / 35 s moderate; holds: 10 s)
+ the exercise's own rest before the next one
```

- **Phase shares.** For 30 minutes: warm-up 18%, main 70%, cool-down 12%. For 60 minutes: 17%, 71%, 12%.
- **Order of filling.** The warm-up and cool-down are filled first, each to its share within 45 s. The main block then takes the rest: first by adding exercises, then by adding sets up to the experience cap.
- **Over the range.** The last main exercise is dropped, never the cool-down.
- **Order on the mat.** Within a part, exercises are ordered by position (lying on the back, then side, front, all fours, kneeling, seated, standing) to keep transitions few. Breathing opens the warm-up and closes the cool-down.

Tempo and rest values sit inside published ranges (ACSM 2009: 1–2 s up and 1–2 s down; Schoenfeld 2015: 0.5–8 s per repetition; ACSM 2026: rest under or over 1 minute made no difference to strength). The transition and demonstration seconds are **design assumptions** with no published source. The player logs real step timings so they can be recalibrated in the pilot.

Results with the v1 library (all inputs otherwise neutral):

| Goal | Minutes | Effort | New customer | Returning customer |
|---|---|---|---|---|
| mobility | 30 | light | 29.6 min, 14 exercises | 30.1 min, 16 exercises |
| mobility | 30 | moderate | 29.8 min, 18 exercises | 29.8 min, 18 exercises |
| mobility | 60 | light | 33.9 min (shorter plan offered) | 51.3 min (shorter plan offered) |
| mobility | 60 | moderate | 45.9 min (shorter plan offered) | 59.8 min, 23 exercises |
| pilates | 30 | light | 30.0 min, 14 exercises | 29.9 min, 16 exercises |
| pilates | 30 | moderate | 29.8 min, 18 exercises | 30.5 min, 18 exercises |
| pilates | 60 | light | 33.9 min (shorter plan offered) | 51.3 min (shorter plan offered) |
| pilates | 60 | moderate | 47.6 min (shorter plan offered) | 60.1 min, 25 exercises |
| core | 30 | light | 30.2 min, 14 exercises | 29.9 min, 16 exercises |
| core | 30 | moderate | 29.8 min, 18 exercises | 30.3 min, 18 exercises |
| core | 60 | light | 33.9 min (shorter plan offered) | 51.3 min (shorter plan offered) |
| core | 60 | moderate | 47.6 min (shorter plan offered) | 60.1 min, 25 exercises |
| general | 30 | light | 29.6 min, 14 exercises | 30.1 min, 16 exercises |
| general | 30 | moderate | 29.8 min, 18 exercises | 29.8 min, 18 exercises |
| general | 60 | light | 33.9 min (shorter plan offered) | 51.3 min (shorter plan offered) |
| general | 60 | moderate | 47.6 min (shorter plan offered) | 59.7 min, 25 exercises |

- **Every 30-minute plan fits 27–33 minutes.** A 60-minute plan fits for returning customers at Moderate.
- **Otherwise the library honestly cannot fill an hour.** For a first session that is because only foundation exercises and at most two sets are used. For Light it is because only light-effort exercises are used.
- **The customer then sees the real length and can accept it or choose 30 minutes.** A 17-minute sequence is never labelled "30 minutes".

## 6. Worked example (investor demo)

The demo customer is Sarah: first visit, scan shown with a right-shoulder-higher line, 30 minutes, Moderate, "Mobility and Pilates mix". She gets 29.8 minutes:

- **Warm-up:**
  - Pilates Breathing;
  - Arm Arcs and Shoulder Placement (`SCAN_SHOULDER_LINE_VARIETY_V1`);
  - Cat Stretch.
- **Main:**
  - Pelvic Curl;
  - Supine Spine Twist;
  - Lying Figure Four Stretch;
  - Lying Hamstring Stretch;
  - Knee Folds;
  - Chest Lift;
  - Toe Taps;
  - Bridge with Single-Leg Marching;
  - Clam;
  - Side-Lying Leg Lift;
  - Inner Thigh Lift;
  - Sphinx (2 holds);
  - Mermaid.
- **Cool-down:**
  - Cat–Cow;
  - Child's Pose.

Rules fired: `READINESS_REQUIRED`, `GOAL_PHASE_CATEGORIES`, `INTENSITY_EFFORT`, `DURATION_BUDGET`, `EXPERIENCE_SETS`, `ROOM_EQUIPMENT`, `REVIEW_POLICY`, `SCAN_SHOULDER_LINE_VARIETY_V1`. Reasons shown:

1. "Your goal: Mobility and Pilates mix".
2. "Your selected effort: Moderate".
3. "Today's scan: a shoulder-line difference was visible, so one gentle shoulder-mobility exercise is included for variety. It isn't meant to change your shoulder line."

## 7. After the session

- **Progression.** The builder never progresses difficulty automatically (ACSM 2026: progression is not required for benefit). Harder options are only ever offered, never applied.
- **Discomfort.** A discomfort report holds the next plan at light effort and offers no harder options (`RECENT_DISCOMFORT_HOLD`).
- **Effort.** Effort is recorded on SEDENS's own 0–10 wording. It is a feeling, not a measurement, and is used only as described in `RECENT_HARD_STEP_DOWN`.

## 8. Known limitations

- **Every library entry is unreviewed.** Production rooms therefore offer no personalized session until SEDENS or an expert records reviews (`docs/SEDENS_PHASE_3_REPORT.md`).
- **The thresholds are provisional.** The 2.7° shoulder-line threshold, the effort bands and the transition times will be recalibrated from SEDENS's own repeatability study and pilot timings.
- **Some rules are design rules.** `RECENT_HARD_STEP_DOWN` and `VARIETY_LAST_PLAN` follow general guidance on gradual progression, but no study tests these specific rules.
