# How the numbers are produced

This document exists so that every figure in a parent report can be traced from the child's
response to the score on the screen. If a number here cannot be explained to the parent it
is about, it should not be on the screen.

Implementation: [`src/assessment/scoring.js`](../src/assessment/scoring.js),
item bank in [`src/assessment/items.js`](../src/assessment/items.js),
tests in [`test/scoring.test.mjs`](../test/scoring.test.mjs) (`npm test`).

---

## What this instrument is, and is not

**It is** a criterion-referenced classroom assessment of English language performance, built
on established child-language paradigms, scored transparently.

**It is not** a normed or standardised test. There is no standardisation sample behind it,
so it cannot produce a percentile, a standard score, or an age equivalent. Anything of that
form would be invented. Levels are reported against explicit expectations that a teacher
can read and change, and those expectations are judgement, not measurement — they live
alone in `EXPECTED` in `items.js` for exactly that reason.

**It is not a measure of a child's brain.** The assessment measures what a child did and
said. The anatomy shown alongside it is a template brain used to explain which system each
skill draws on. Describing the product as an assessment *of the brain* would place it under
Korea's MFDS medical-device definition, which is a line this project deliberately does not
cross.

---

## The seven tasks and why each was chosen

| System | Task | Paradigm and rationale |
|---|---|---|
| Sound discrimination | Minimal pairs, 2-choice | Isolates one phonemic contrast at a time. Weighted toward contrasts Korean does not supply — /r/–/l/, /f/–/p/, /v/–/b/, /θ/–/s/ — since a contrast absent from L1 must be built rather than inherited |
| Phonological memory | Nonword repetition | Carries no meaning in either language, so it cannot be passed on vocabulary knowledge. Difficulty scales with syllable count, which is used as the scoring weight |
| Listening comprehension | Instructions + story | Load rises with number of steps and with non-canonical order ("before you do X, do Y"), which is where a child following surface word order comes apart |
| Vocabulary & meaning | 4-choice picture + naming | Receptive and expressive halves have different chance rates and are corrected separately |
| Speech production | Sentence repetition | One of the strongest single indicators of child language ability. Scored structurally, not verbatim |
| Pronunciation | Targeted phoneme probe | Target sounds absent from Korean, plus final-consonant release, the most common source of unintelligibility for Korean-L1 English at these ages |
| Memory consolidation | Delayed recall | Words taught earlier in the session, probed 20–25 minutes later, separating what was learned from what was retained |

---

## The four decisions that shape every score

### 1. Guessing is subtracted

    θ = (p − c) / (1 − c)

`p` is the observed proportion correct, `c` the chance rate: 0.5 for two pictures, 0.25 for
four, 0 for anything open-ended.

**Why.** On a two-choice task a child who knows nothing still scores about half. Without
correction every score on that task starts at 50 and the scale is meaningless in its lower
half. With it, 6/12 reads as 0 — which is what it means.

**In plain language.** "Half right on a two-choice task is what you would get by flipping a
coin, so we only count what was above that."

Below-chance performance is floored at zero. Scoring below chance is noise, not negative
knowledge.

### 2. Nonword repetition is weighted by length

    θ = Σ(wᵢ · correctᵢ) / Σwᵢ        where wᵢ = syllable count

**Why.** Repeating a nonword loads phonological memory in proportion to its length, and
longer items are consistently harder. Scoring every item equally lets four easy two-syllable
items conceal failure on everything longer — and that failure is the finding.

**In plain language.** "Longer made-up words count for more, because holding more sounds is
exactly what this task measures."

We also report the **span**: the longest item repeated correctly. It is often more useful to
a teacher than the score.

### 3. Every score reports an interval

Wilson score interval at 95%, computed on the underlying proportion and then mapped through
the same chance correction so the bounds sit on the same scale as the number they bracket.

**Why Wilson rather than the textbook `p ± z·√(p(1−p)/n)`.** The normal-approximation
interval loses its coverage exactly where these tasks live — few items, scores near the
ceiling or the floor — and can produce bounds outside 0–100, which is indefensible on a
report a parent reads. Wilson stays inside the scale and holds its coverage at small n.

For weighted tasks the interval uses **Kish's effective sample size**:

    n_eff = (Σw)² / Σ(w²)

**Why.** Once items carry different weights they no longer carry equal information, and the
interval has to be computed against the effective count. Ten nonwords weighted 2–5 are worth
about nine equally weighted ones, and the interval should say so rather than overstate its
own precision.

**In plain language.** "On a different day the same child would likely score between X and
Y. Read the range, not the single number."

A short task is not suppressed — it reports its number with a correspondingly wide interval.
The width *is* the warning. Below a per-task minimum (`minItems`, default 6) the task
reports no level at all.

### 4. Levels are criterion-referenced, never ranked

A level is compared against the expected range for the child's age band:

- below the range → **Emerging**
- inside the range → **Developing**
- above the range → **Strong**

**Why not percentiles.** A percentile requires a standardisation sample. Without one, any
percentile would be fabricated, and fabricated precision is worse than none — it is the
specific failure mode that makes assessment reports untrustworthy.

---

## Task-specific scoring

**Vocabulary is corrected in halves.** Pointing at one of four pictures can be guessed;
naming a picture cannot. The halves are corrected separately (c = 0.25 and c = 0) and then
combined by item count. Combining first would let the guessable half inflate the whole
score. The **receptive − expressive gap** is reported: understanding running ahead of
speaking is normal at these ages, closes on its own, and is worth telling a parent who has
not heard it before.

**Sentence repetition is scored structurally.** Credit is per target structure preserved,
not per word matched. A child who returns "he no want go home" for "He does not want to go
home" has kept the negation and the infinitive but lost do-support. Verbatim scoring records
one failure and loses the only information the item carries; structural scoring records
which structure went.

**Delayed recall gives half credit for recognition.** A word recognised but not produced is
stored and not yet retrievable — a real intermediate state in consolidation. Scoring it zero
would report a child who has learned something as a child who has not.

---

## What is reported for every task

- the level, 0–100, after correction
- the 95% interval
- the raw fraction, unmodified
- the expected range for that age band, and the resulting band
- the formula, the substitution with this child's numbers, the methodological reason, and
  the plain-language sentence — all four, in English and Korean
- an error pattern where the task supports one: which contrasts were missed, the syllable
  span, which grammatical structures went, which phonemes

---

## Known limitations

1. **No normative data.** Every threshold in `EXPECTED` is professional judgement. They
   should be revised against your own cohort once enough sessions exist, and revising them
   changes historical bands — so record which version scored a given report.
2. **Inter-rater reliability is unmeasured.** Structural scoring, pronunciation targets and
   recall all require a human decision. Two teachers will not always agree, and nothing here
   measures how often they do.
3. **Single-session estimates.** The interval captures sampling error within a session. It
   does not capture a child having a bad morning.
4. **Item bank is unpiloted.** Difficulty is assigned from the literature and from the
   structure of Korean, not from response data. Once sessions accumulate, item difficulty
   should be estimated from them and the weights revisited.

---

## Sources

The task designs draw on the following literature:

- [Nonword repetition and vocabulary knowledge as predictors of children's phonological and semantic word learning](https://pmc.ncbi.nlm.nih.gov/articles/PMC5544194/)
- [Phonological predictors of nonword repetition performance in bilingual children](https://www.sciencedirect.com/science/article/abs/pii/S0021992421000794)
- [Nonword repetition tasks — LEADERSproject](https://www.leadersproject.org/non-word-repetition-tasks/)
- [Sentence repetition as a clinical marker of developmental language disorder: evidence from Arabic](https://pubs.asha.org/doi/10.1044/2021_JSLHR-21-00244)
- [Sentence repetition as a clinical marker for Mandarin-speaking preschoolers with developmental language disorder](https://pubs.asha.org/doi/abs/10.1044/2021_JSLHR-21-00401)
- [Sentence repetition as a tool for screening morphosyntactic abilities of bilectal children with SLI](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC5723908/)
- [Production and perception of the /r/–/l/ contrast in Korean adults learning English](https://www.researchgate.net/publication/229479900_Production_and_perception_of_the_r-I_contrast_in_Korean_adults_learning_English)
- [Perceptual training of English /r/ and /l/ for Japanese adults, adolescents and children](https://discovery.ucl.ac.uk/id/eprint/1421176/)
- [A developmental study of English vowel production and perception by native Korean adults and children](https://www.sciencedirect.com/science/article/abs/pii/S0095447004000609)
