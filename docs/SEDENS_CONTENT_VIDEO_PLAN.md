# SEDENS content video plan

Status as of 2026-10-21 (Phase 4, Part 9). **SEDENS has no video of any SEDENS Standard exercise.** The search for licence-clean stock footage found nothing that passed, so nothing was downloaded into the product and no clip is in this repository. Every exercise keeps its text and, for two of them, an AI-generated illustration. The room shows "no video yet" instead of a stand-in.

This page records what was searched and why nothing passed, lists exactly which videos are missing, recommends how to get them, and explains the import workflow that is ready for the day a clip passes. It does not describe any clip as expert reviewed, because none is: SEDENS has no expert movement review (`docs/SEDENS_CONTENT_GOVERNANCE.md`).

Related: `docs/SEDENS_MEDIA_RIGHTS.md` (rights, upload checks, serving), `docs/SEDENS_SESSION_PLAYER.md` (the room player), `data/content_sources.json` (allowed sources and the import manifest).

## 1. Source hierarchy

In order of preference. A lower source is used only when none above it can supply the clip.

1. **Original footage SEDENS films**, with a signed model release from every person shown, a written agreement with the person who films it, and the rights recorded as `own_work` or `permission_granted` with the attestation. This is the only source whose permission record SEDENS fully holds.
2. **A commercial licence** from a stock or fitness-content vendor, with **written confirmation from the vendor** that the licence covers (a) use inside an app or room player and (b) serving and storing the files (redistribution of the file to customers' screens and inside course exports). Model releases for every person shown must be available.
3. **Free stock from a source in the registry** (`pexels`, `pixabay`, both `enabled` with `auto_download: false`), only after a person watched the clip frame by frame, checked the movement against section 5, checked the licence page, and recorded both in the import manifest.
4. **Generated video** (Higgsfield or any generator): inactive. Nothing is generated, and generated video would never be approved automatically (`video_providers.HiggsfieldVideoProvider`).

Never a source: YouTube, TikTok, Instagram or any social or video site; search results; other people's fitness courses or copyrighted videos; any clip that shows a person who could appear to endorse SEDENS.

Rules that apply at every level: nothing is downloaded automatically; a clip is never paired with instructions for a different exercise; generic "yoga" or "pilates" B-roll is never used as a demonstration; every clip carries the label "Stock footage — movement not yet expert reviewed" (a creator upload: "Creator-uploaded media — movement not yet expert reviewed") until an actual qualified reviewer approves that exact movement, which SEDENS cannot record yet.

## 2. What was searched

Retrieved 2026-10-20 from the build environment by an automated research pass (an AI research agent; its licence conclusion and two contact sheets were re-checked by the orchestrating agent). **No human reviewer has watched any of these clips.** HTTP status is what this environment received.

| Site | Status here | Result |
|---|---|---|
| pexels.com | 403 | blocked; no page readable |
| api.pexels.com | 401 | needs an API key; none is held, and none was requested |
| pixabay.com, cdn.pixabay.com | 403 | blocked |
| videvo.net, mazwai.com | redirect to a freepik page, 403 | blocked |
| pond5.com (free section) | 403 | blocked |
| openverse.org | 403 | blocked |
| Envato (policy pages) | 403 | blocked |
| Wikimedia Commons API | 429 | rate limited; the HTML search answered 200 |
| mixkit.co | 200 | searched (below) |
| coverr.co | 200 | searched (below) |
| videezy.com | 200 | searched (below) |
| vecteezy.com | 200 | searched (below) |

Wikimedia Commons: its HTML search returned no short single-exercise floor clips. The candidates were long promotional videos, identifiable public figures, and 320x240 `.ogv` files.

Coverage on Mixkit: about 430 items from the yoga, pilates, stretching, exercise, fitness and workout tag pages. This is not exhaustive: the site's search answered 404 to a plain request. No Mixkit clip shows imprint and release, a pelvic curl, knee folds, a dead bug, a supine spine twist, a clam, arm arcs, cat–cow, or a true opposite arm and leg reach.

## 3. Licences read

Retrieved 2026-10-20. Quotations are short; the pages are the authority.

| Source | Licence page | What it says that matters | Verdict |
|---|---|---|---|
| Mixkit, Stock Video Free License | https://mixkit.co/license/modal/videoFree/ and https://mixkit.co/terms/ (revised 2 Oct 2025) | Commercial use allowed; "download, copy, modify, distribute"; sub-licensable; attribution not required. User Terms clause 9: the item may not be made available to third parties "on a stock or inventory basis", unaltered copies may not be sold, and a competing product may not be built. Clause 13: rights of third parties (brands) are the user's responsibility. No model releases are provided. | Usable in principle for a clip that fits. Whether a raw file committed to a possibly public repository counts as making it available "on a stock or inventory basis" is **unclear**, so it needs the vendor's written answer first. |
| Mixkit, Restricted License | https://mixkit.co/license/modal/videoRestricted/ | Personal projects only. **Every Mixkit clip tagged "pilates"** (items 45695, 45761 to 45767, 45853, 33666, 33066) is under it. | Unusable. |
| Coverr | https://coverr.co/license | Commercial use allowed; model releases are obtained but not provided. The licence says the videos "can’t be resold or offered as part of services to which providing videos can help", naming "mobile apps builders". | Ambiguous for an app that serves the file. Needs the vendor's written answer. |
| Videezy, Standard licence | https://www.videezy.com/pages/licenses | Attribution required. | Not suitable without a visible credit on every use. |
| Vecteezy, Free licence | https://www.vecteezy.com/licensing-agreement | Attribution required; no redistribution; no display "as a standalone file"; the user must prevent third-party access and duplication. | Ineligible for a served MP4. |
| Pexels | https://www.pexels.com/license/ (listed in the registry) | Page not readable from here (403). | Not assessed. |
| Pixabay | https://pixabay.com/service/license-summary/ (listed in the registry) | Page not readable from here (403). | Not assessed. |

## 4. Candidates examined and why they failed

Every clip the research pass could judge was examined frame by frame (contact sheets; the orchestrating agent re-checked 5060 and 1091). All failed on **exercise identity or form**, so none could be shown beside SEDENS instructions without teaching the wrong movement. "Item" is the site's own listing number, not a file SEDENS holds.

| Listing | Licence | What it shows | Verdict |
|---|---|---|---|
| Mixkit item 5064 | Free | seated folds | Fail: a different exercise |
| Mixkit item 4942 | Free | portrait, seated fold | Fail: a different exercise |
| Mixkit item 5060 | Free | all-fours bent-knee leg kickbacks, foreground occlusion, lower back arching | Fail: not an opposite arm and leg reach; poor form for this purpose |
| Mixkit item 32625 | Free | seated breathing beside a candle | Fail: not the supine breathing exercise |
| Mixkit item 1091 | Free | kneeling quad stretch or bow variation, lower back arched | Fail: poor form for this purpose |
| Mixkit item 887 | Free | sun salutation flow | Fail: not in the Standard |
| Mixkit item 5355 | Free | outdoor sit-ups, hands pulling the head | Fail: form |
| Mixkit item 40152 | Free | crunches, hands on the neck | Fail: form |
| Mixkit item 892 | Free | yoga flow with cuts | Fail: edited, no single movement |
| Mixkit item 42898 | Free | reverse lunges | Fail: not in the Standard |
| Coverr, "outdoor morning crunch workout" | Coverr | sit-ups, hands pulling the neck | Fail: form; licence ambiguous |
| Videezy item 51019 | Standard | seated butterfly fold | Fail: not in the Standard; credit required |
| Videezy item 56256 | Standard | seated biceps curl | Fail: not in the Standard; credit required |
| Videezy item 55242 | Standard | forearm plank | Fail: the Standard has a kneeling plank; credit required |
| Mixkit pilates-tagged items | Restricted | various | Fail: licence |

Downloaded copies used for the frame check were kept outside the repository and are not part of the product. Even a candidate that had passed would still need a person to watch it and sign the manifest entry (section 7); an agent's screening is not that check.

## 4a. Why nothing passed

- Where a licence was clean enough, the movement was wrong or the form was poor.
- Where the movement was right, the licence was personal-only or ambiguous for an app that serves the file.
- The two largest sources (Pexels, Pixabay) could not be read at all from here, and the Pexels API needs a key.
- No stock source supplies model releases we could rely on. SEDENS must not imply that a person in stock footage endorses it.

Per the product rules, SEDENS does not pretend otherwise: placeholders stay, this page lists what is missing, and the import workflow is built and tested so a clip can be added the day one passes.

## 5. The missing videos

All 26 SEDENS Standard exercises (`data/sedens_standard/exercises.v1.json`, version 1.0.0). "Media now" is what the room shows today: two exercises have an AI-generated illustration (labelled "AI-generated illustration — not a real instructor; movement not yet expert reviewed"), the rest are text only.

Clip specification common to all:

- One person (adult) on a mat, plain background, even light, no music, no speech, no on-screen text or logo, no branded clothing or equipment, no cuts inside the clip.
- Landscape 16:9, at least 1280x720, steady camera on a tripod, MP4 (H.264) or WebM (VP9), 25 MB at most (the free demonstration limit; `media_store.LIMITS`).
- The movement at the pace in `seconds_per_rep` (3 to 8 s a rep), slow and controlled, plain form with no exaggerated range. The clip starts and ends in the start position so it can loop.
- The person is identifiable unless they cannot be (for example, framed from behind): a signed release is required either way.
- The movement must be confirmed by a qualified reviewer before any label changes; the clip lengths below are the minimum needed to show the cues, not a reviewed standard.

| # | Exercise (id) | Media now | Camera and framing | Start position, then what the clip shows | Clip length | Cues to match |
|---|---|---|---|---|---|---|
| 1 | Pilates Breathing (`std-breathing`) | text only (no picture) | Side view, camera at mat height about 2.5 m away; whole body and the mat in frame, head to feet | Start: Lie on your back with knees bent and feet flat, hip-width apart. Shows: ribs widen on the in-breath and soften on the out-breath; the spine and pelvis stay still. | 28 s (3 reps) | Let the ribs widen to the sides, like an umbrella opening. |
| 2 | Imprint and Release (`std-imprint-release`) | text only (no picture) | Side view, camera at mat height about 2.5 m away; whole body and the mat in frame, head to feet | Start: Lie on your back with knees bent and feet flat. Shows: lower back gently presses toward the mat, then releases (a small pelvic rock). | 19 s (3 reps) | Think of a small, slow rocking of the pelvis. |
| 3 | Pelvic Curl (`std-pelvic-curl`) | AI-generated illustration (bridge) | Side view, camera at mat height about 2.5 m away; whole body and the mat in frame, head to feet | Start: Lie on your back with knees bent, feet hip-width apart, arms beside you. Shows: hips lifted, spine rolled up into a long line from shoulders to knees; rolls back down one section at a time. | 22 s (3 reps) | Roll up and down one small section of the spine at a time. |
| 4 | Knee Folds (`std-knee-folds`) | text only (no picture) | Side view, camera at mat height about 2.5 m away; whole body and the mat in frame, head to feet | Start: Lie on your back with knees bent and feet flat. Shows: one knee folded to about 90 degrees at hip and knee, pelvis level; foot returns to the mat. | 20 s (2 reps each side) | Lift the leg without letting the pelvis rock. |
| 5 | Supine Spine Twist (`std-supine-spine-twist`) | text only (no picture) | View from the feet end, slightly above; both shoulders and the dropping knees in frame | Start: Lie on your back with knees bent and together, feet flat, arms out to the sides. Shows: both knees lowered together to one side, both shoulders still on the mat; back to centre. | 24 s (2 reps each side) | Move only as far as the shoulders can stay down. |
| 6 | Arm Arcs and Shoulder Placement (`std-arm-arcs`) | text only (no picture) | Side view, camera at mat height about 2.5 m away; whole body and the mat in frame, head to feet | Start: Lie on your back with knees bent and arms reaching toward the ceiling. Shows: arms lowered overhead and returned over the shoulders; ribs stay down. | 19 s (3 reps) | Let the shoulder blades glide gently on the mat. |
| 7 | Dead Bug (`std-dead-bug`) | text only (no picture) | Side view, camera at mat height about 2.5 m away; whole body and the mat in frame, head to feet | Start: Lie on your back with knees bent above the hips and arms reaching to the ceiling. Shows: opposite arm and leg lowered toward the mat while the lower back stays steady. | 24 s (2 reps each side) | Reach long while the middle of your body stays quiet. |
| 8 | Cat Stretch (`std-cat-stretch`) | text only (no picture) | Side view, camera at mat height about 2.5 m away; whole body in frame, head to feet | Start: Come onto hands and knees, hands under shoulders and knees under hips. Shows: back rounded from tailbone to head; back to a neutral spine. | 22 s (3 reps) | Round the back from the tailbone up to the head. |
| 9 | Opposite Arm and Leg Reach (`std-opposite-reach`) | AI-generated illustration (bird-dog) | Side view, camera at mat height about 2.5 m away; whole body in frame, head to feet | Start: Come onto hands and knees with a long, flat back. Shows: one arm and the opposite leg reaching long, back flat and level. | 24 s (2 reps each side) | Reach long rather than high. |
| 10 | Clam (`std-clam`) | text only (no picture) | Front view from the belly side at mat height; whole body in frame, hips and knees visible | Start: Lie on your side with hips and knees bent and feet together. Shows: top knee opened with the feet together, pelvis steady; knee closes slowly. | 30 s (3 reps each side) | Open the knee without rolling the hips backward. |
| 11 | Cat–Cow (`std-cat-cow`) | text only (no picture) | Side view, camera at mat height about 2.5 m away; whole body in frame, head to feet | Start: Come onto hands and knees, hands under shoulders and knees under hips. Shows: alternates a rounded and a gently arched shape through the whole spine. | 22 s (3 reps) | Let the whole spine take part, not just the lower back. |
| 12 | Thread the Needle (`std-thread-needle`) | text only (no picture) | Front three-quarter view at mat height, threading side nearest the camera; whole body in frame | Start: Come onto hands and knees, hands under shoulders and knees under hips. Shows: one arm threaded under the chest, upper back rotating; returns and reaches up. | 42 s (3 reps each side) | Turn from the upper back rather than pushing the shoulder down. |
| 13 | Standing Upward Reach (`std-overhead-reach`) | text only (no picture) | Front view at chest height about 3 m away; add a short side-view take to show there is no lean back | Start: Stand with feet hip-width apart and arms by your sides. Shows: arms reach overhead without leaning back; lowered slowly. | 22 s (3 reps) | Reach up through the fingertips without leaning back. |
| 14 | Head Nods (`std-head-nods`) | text only (no picture) | Side view, camera at mat height, close on head, neck and upper chest; towel visible | Start: Lie on your back with knees bent and feet flat; use a folded towel under the head if it helps. Shows: a small chin nod with the head staying on the towel. | 16 s (3 reps) | Think of a slow, small nod. |
| 15 | Chest Lift (`std-chest-lift`) | text only (no picture) | Side view, camera at mat height about 2.5 m away; whole body and the mat in frame, head to feet | Start: Lie on your back with knees bent, feet flat and hands behind your head, elbows wide. Shows: head, neck and upper back curled up with space under the chin; lowers slowly. | 19 s (3 reps) | Curl up from the upper back and keep space between chin and chest. |
| 16 | Toe Taps (`std-toe-taps`) | text only (no picture) | Side view, camera at mat height about 2.5 m away; whole body and the mat in frame, head to feet | Start: Lie on your back and lift one leg, then the other, so the knees are above the hips and the shins level. Shows: one foot lowered to tap the mat, knees at tabletop, pelvis still. | 20 s (2 reps each side) | Move from the hip while the lower back stays quiet. |
| 17 | Bridge with Single-Leg Marching (`std-bridge-march`) | text only (no picture) | Side view, camera at mat height about 2.5 m away; whole body and the mat in frame, head to feet | Start: Lie on your back with knees bent, feet hip-width apart and arms by your sides. Shows: hips held up in a bridge while one knee lifts at a time; rolls down at the end. | 28 s (2 reps each side) | Press evenly through the standing foot so the hips stay level. |
| 18 | Kneeling Plank (`std-kneeling-plank`) | text only (no picture) | Side view, camera at mat height about 2.5 m away; whole body in frame | Start: Start on hands and knees with the hands under the shoulders. Shows: straight line from head to knees, shoulder blades wide; hips back to rest. | 26 s | Keep the shoulder blades wide across your back. |
| 19 | Side-Lying Leg Lift (`std-side-leg-lift`) | text only (no picture) | Front view from the belly side at mat height; whole body in frame, hips and knees visible | Start: Lie on your side with the head resting on your arm and the lower knee bent for balance. Shows: top leg lifted to hip height and long; lowers slowly. | 30 s (3 reps each side) | Lengthen the leg away from you as it lifts. |
| 20 | Inner Thigh Lift (`std-inner-thigh-lift`) | text only (no picture) | Front view from the belly side at mat height; whole body in frame, hips and knees visible | Start: Lie on your side with the head resting on your arm. Shows: lower leg lifted with the top leg supported in front, hips stacked. | 30 s (3 reps each side) | Lift from the inner thigh while the hips stay stacked. |
| 21 | Mermaid (`std-mermaid`) | text only (no picture) | Front view at chest height about 2.5 m away; whole body in frame, mat visible | Start: Sit on the mat with legs crossed, or with both knees bent to one side. Shows: reaching up and over to the side while sitting tall; returns to upright. | 28 s (2 reps each side) | Reach up and over, as if over a large ball. |
| 22 | Sphinx Pose (`std-sphinx`) | text only (no picture) | Side view, camera at mat height about 2.5 m away; whole body in frame | Start: Lie on your front with legs long and forehead resting on your hands. Shows: chest lifted on the forearms, lengthening forward; lowered to rest. | 26 s | Lengthen forward through the chest rather than lifting higher. |
| 23 | Kneeling Low Lunge (`std-low-lunge`) | text only (no picture) | Side view, camera at mat height about 2.5 m away; whole body in frame | Start: Kneel on the mat with a folded towel under your knees. Shows: back knee down on a folded towel, hips forward a little, trunk tall. | 60 s (both sides) | Keep the trunk tall and move the hips forward only a little. |
| 24 | Lying Figure Four Stretch (`std-figure-four`) | text only (no picture) | Side view, camera at mat height about 2.5 m away; whole body and the mat in frame, head to feet | Start: Lie on your back with knees bent and feet flat. Shows: ankle crossed over the opposite knee, crossed knee relaxed open. | 70 s (both sides) | Let the crossed knee relax open; do not push it down. |
| 25 | Lying Hamstring Stretch (`std-hamstring-stretch`) | text only (no picture) | Side view, camera at mat height about 2.5 m away; whole body and the mat in frame, head to feet | Start: Lie on your back with knees bent and feet flat. Shows: one leg lifted toward the ceiling with the hands or a strap behind the thigh. | 70 s (both sides) | Let the back of the pelvis stay heavy on the mat. |
| 26 | Child's Pose (`std-childs-pose`) | text only (no picture) | Side view, camera at mat height about 2.5 m away; whole body in frame | Start: Kneel on the mat with big toes together and knees apart, as wide as is comfortable. Shows: hips back toward the heels, arms forward, back widening with each breath. | 36 s | Let the back widen with each breath in. |

Totals: 26 clips needed, 0 held. Estimated filming time for the set: one day with one model and one camera, including both sides of every one-sided exercise.

## 6. Recommended path

1. **Film original footage.** Hire or ask a certified instructor to demonstrate, with a written agreement and a signed model release from them (and anyone else in frame) that covers use inside the SEDENS room, the Creator Studio and course exports. Record each clip as `own_work` or `permission_granted` with the creator's name. This also gives a real person who can later review the movement.
2. **Or buy a commercial licence.** Ask the vendor, in writing, whether the licence covers use inside an app or room player and serving the files to customers' screens and inside course exports; keep the reply with the manifest entry. Choose clips only from the specification in section 5.
3. **Expert movement review before any "reviewed" label.** Record the reviewer, date, evidence and scope in the Standard entry (`docs/SEDENS_CONTENT_GOVERNANCE.md`). Until then the label stays. Approving a file's rights never removes it.
4. Until a clip passes: text, cue and the labelled illustration. No generic B-roll.

## 7. The import workflow

For a clip that has passed a person's checks. Nothing is fetched by the command; a person gets the file.

1. **A person watches the whole clip** and compare it with the row in section 5: the same exercise, the same start position, the same cues, plain form, one continuous take, no brand or text.
2. **Read the licence page** of the source. Confirm that it allows commercial use in an app **and** serving the file to customers; note whether a person is identifiable and what the licence or a release says about showing them.
3. **Get the file** by hand from the allowed source (`pexels` or `pixabay` today; a source is added to `data/content_sources.json` first, with its licence page, by a person). Compute its checksum: `sha256sum <file>`.
4. **Write the manifest entry** in `data/content_sources.json`, in `import_manifest.entries`. Every field is required (`licence` and, when a person can be identified, `model_release_note` too):

   ```json
   {
     "id": "<lowercase-id, 3 to 61 characters>",
     "source": "<pexels or pixabay>",
     "page_url": "https://<the clip's page on the source's site>",
     "file_url": "https://<where the file was downloaded from>",
     "licence_url": "https://<the licence page on the source's site>",
     "licence": "<pexels or pixabay, matching the source>",
     "original_creator": "<name shown on the page>",
     "retrieved_at": "YYYY-MM-DD",
     "sha256": "<64 hex characters of the file>",
     "shows_exercise": "<a SEDENS Standard id, for example std-clam>",
     "checked_by": "<the person who watched it>",
     "checked_at": "YYYY-MM-DD",
     "movement_notes": "<what was checked, in a sentence or two>",
     "identifiable_person": "<yes or no>",
     "model_release_note": "<needed when identifiable_person is yes>"
   }
   ```

   Leave `status` as it is; the command updates it.
5. **Check:** `python -m pilates.sedens.media_import --check`. It reports every problem in plain words. The command refuses an entry whose source is not an enabled stock source (never YouTube, TikTok, Instagram, Facebook or Higgsfield), whose page and licence links are not `https` on the source's own site (the file link may not point at YouTube, Vimeo or another video site), whose licence is not one SEDENS knows, whose dates are not real or are in the future, whose checker's name looks automated (a word such as `AI`, `agent`, `claude`, `gpt`, `opus` or `sonnet`; the command cannot verify that a person really watched the clip), whose exercise is not a Standard id, or that shows an identifiable person without a model-release note.
6. **Register:** `python -m pilates.sedens.media_import --register <entry id> <local file>`. It checks the file (an MP4 or WebM by its bytes, at most 25 MB, the checksum equal to the entry's), copies it to `web/assets/stock/<entry id>.<ext>`, adds an asset to `data/content_sources.json` with the label "Stock footage — movement not yet expert reviewed" / "스톡 영상 — 동작은 아직 전문가 검토 전" and the rights from the entry (`review_status: unreviewed`), and adds the asset to the exercise's `media` list so the room can show it. It changes nothing if anything is wrong.
7. **Verify** with `python -m pytest tests/test_sedens_media_import.py tests/test_sedens_media_store.py tests/test_sedens_standard.py -q` (the import tests include a clip registered in a temporary root and fetched in byte ranges from `/assets/stock/`) and the room: the exercise's step shows the video with the stock label. Then commit the file, the registry and the Standard together.

Things the workflow does not do, on purpose: it does not download anything, does not mark a movement reviewed, does not approve rights (a SEDENS reviewer still decides that for a course using the file), and does not delete anything. `web/assets/` is public: **before registering, confirm the licence allows serving the file publicly from the app** (section 3). The command cannot check that.

Tests: `tests/test_sedens_media_import.py` runs the command against a temporary copy of the registry with a synthetic entry (a complete entry registers; each missing or invalid field, a wrong checksum, a forbidden source and a forbidden link are refused and change nothing).

## 8. What the synthetic test clips are

`tests/data/media/` holds three small clips made in this repository with FFmpeg test patterns (an H.264 MP4, a VP9 WebM and a VP9 MP4), with their exact commands in `tests/data/media/README.md`. They show colour bars and a frame counter and the words "TEST PATTERN … NOT AN EXERCISE". They have no person, no movement and no audio. They exist so a browser test can prove that the room player plays real local MP4 and WebM files uploaded through the real Creator Studio (`web/test/sedens-room-media.browser.mjs`), and that the same file address is refused outside the room. They are never registered as, or linked to, a Standard exercise's media and never listed in the registry; the browser test uses them only in a temporary demonstration course.

What that test found in this environment: Playwright's Chromium 141 decodes VP8, VP9 and AV1 but has **no H.264 decoder**. The H.264 file is therefore proven only on the server side here (accepted, served in byte ranges, identical bytes); the VP9-in-MP4 file proves the player plays a real `.mp4`. Real browsers decode H.264.

## 9. Labels

| Media | Label (English) | Label (Korean) |
|---|---|---|
| A repository illustration | AI-generated illustration — not a real instructor; movement not yet expert reviewed | AI 생성 일러스트 — 실제 강사가 아니며 동작은 아직 전문가 검토 전 |
| Registered stock footage (`media_import`) | Stock footage — movement not yet expert reviewed | 스톡 영상 — 동작은 아직 전문가 검토 전 |
| A creator's upload with a `pexels` or `pixabay` licence | Demo media — movement not yet expert reviewed | 데모 미디어 — 동작은 아직 전문가 검토 전 |
| Any other creator upload | Creator-uploaded media — movement not yet expert reviewed | 제작자가 올린 미디어 — 동작은 아직 전문가 검토 전 |

The room player shows the label under every video and picture of a course step. Nothing in SEDENS says a movement is expert approved, and no label changes when a reviewer approves a file's rights: that is about permission to distribute, not about the movement.

