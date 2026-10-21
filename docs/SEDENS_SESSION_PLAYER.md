# SEDENS room workout player

The player runs the `ready_to_train`, `exercise` and `exercise_paused` states of the
room journey (`docs/SEDENS_ROOM_FLOW.md`). It plays a SEDENS Standard plan or one
session of a guided course. The server owns the workout: steps, completion, pauses,
variants, safety stops and the Passport (`pilates/sedens/workouts.py`). The player
shows it and asks for changes.

| File | What it is |
|---|---|
| `web/src/sedens/room-player.js` | the player screens and controls (`mountPlayer(ctx)`, stays mounted across steps and language changes) |
| `web/src/sedens/room-player-clock.js` | pure timing: sets, sides, holds, rests, rep pacing, automatic next, presence check |
| `web/src/sedens/room-anatomy.js` | pure anatomy timeline (`anatomyStateAt`) and the embedded viewer (`AnatomyPanel`) |
| `web/src/sedens/anatomy-room-bridge.js` | runs inside `/anatomy.html?room=1` and drives the existing viewer |
| `web/src/roomPerf.js` | pure decisions of the viewer's room-only performance mode (heartbeat, hidden page, pixel ratio) |
| `web/src/sedens/room-narration.js` | narration: recorded audio, browser speech, captions always |
| `web/src/sedens/room-music.js` | music: off, generated ambience, or the customer's own file |

## 1. What is on screen

- **Main area.** The step's video when the step has one: creator-uploaded course video, played from this server. When there is no video, the step's picture with its label (for example "AI-generated illustration — not a real instructor"). When there is neither, a static instruction card (setup and steps). An unrelated video is never inserted. The label of the file is printed under the video as well as under a picture ("Creator-uploaded media — movement not yet expert reviewed", the stock label, or the repository illustration's label); nothing on the screen says a movement is expert approved. Proof that real local files play: `web/test/sedens-room-media.browser.mjs` uploads an H.264 MP4, a VP9 MP4 and a VP9 WebM through the Creator Studio and plays the VP9 MP4 and the VP9 WebM in the room (the H.264 MP4 is verified on the server side only, because the test Chromium has no H.264 decoder) (readyState, advancing clock, no media error, automatic next step, refusal outside the room); the test clips and the one H.264 limit of the test browser are in `tests/data/media/README.md`.
- **Session information.**
  - exercise name and part of the session (warm-up, main, cool-down);
  - "Exercise n of N";
  - set and side;
  - a rep pace guide or a hold countdown;
  - the next exercise;
  - overall progress.
- **Captions.** The current narration line is always shown as text.
- **Anatomy panel.** One embedded anatomy viewer for the whole workout. It always shows "Educational anatomy — not measured muscle activation."
- **Controls.** All large touch targets:
  - pause / continue, repeat, skip, previous;
  - easier and more challenging, only when that step has them;
  - anatomy, music, narration, end session;
  - a persistent "I don't feel well".

## 2. Timing (`room-player-clock.js`)

**Segments.** A step is split into segments:
- work per set and side;
- a 5 s side switch for `each_side`;
- the rest between sets.

**Reps.** Shown as a pace guide (reps × seconds per rep). It is never a count of the customer's movements, because the camera is off during the workout. Holds count down.

**Time base.** With a video, the step's time base is the video. Without one, it is a monotonic clock that stops while the workout is paused. Pause, resume, repeat and a resumed page are all the same function called with a different elapsed time.

**When the work is done:**
- **Automatic next on (default; `workout/settings`).** A transition screen shows the next exercise, its setup sentence and equipment, with a 10 s preparation countdown and "Start now". Then `workout/step {position, outcome: "completed"}`. Nothing changes without that transition.
- **Automatic next off.** A large "Done — next exercise" button.
- **Last step.** Completion moves the journey to `session_complete`.
- **A pause during the countdown** (the customer's, or the automatic pause when anatomy opens) cancels it. On Continue the clock sees the work is already done and starts the countdown, or the Done prompt, again from the beginning.

**Presence check.** With no touch or key at all, the player advances automatically twice; at the end of the third "Get ready" countdown it pauses instead (`workout/pause reason: presence`) and asks whether the customer is still there. Continue finishes that step and carries on. A workout is never kept alive by a timer. A paused room idles out after `SEDENS_ROOM_IDLE_MINUTES`, like any room screen. Each step the workout advances is a real room request, so an active workout is not idled out.

## 3. Resume and idempotency

- A refresh reads `GET room/journey`. The player restores the current step (`current_index`), the saved position when paused (`position_ms`), the chosen variant and the automatic-next setting.
- A finished step is never restarted. The server finishes a step once: a retried or doubled `workout/step` writes no second completion, no second Passport event and no second analytics event.

## 3a. What a course step shows

| Part | Comes from |
|---|---|
| Title, the customer cue, narration, sets, reps, holds, rest, sides, equipment, video or picture, anatomy mapping and timeline, easier and harder variants | the creator's step in the enrolled course version |
| Setup, numbered steps, breathing and "Stop if" | the SEDENS Standard exercise the creator picked for the step |

The library text is copied into the workout's frozen plan when the session starts (`library`, with the Standard version), so a refresh or a later library change never alters a workout in progress. A step built on a catalog exercise has no library text: it shows the creator's narration lines as its steps, and the cue.

## 4. Easier and more challenging

The buttons appear only when the step has an approved option:
- SEDENS Standard uses the audited library's `easier` and `harder` links.
- A course uses the creator's own variant steps (`variant_of`).

**Nothing is invented algorithmically.** After a discomfort report the next SEDENS Standard plan offers no harder option. Choosing a variant (`workout/variant`) swaps the content shown and the exercise recorded for that step.

## 5. Narration (`room-cues.js`, `room-sound.js`, `room-narration.js`)

Narration is short and chosen by the creator. Nobody is talked at for the whole step, and no speech service is bought.

**What a step carries** (`workouts._narration`). `narration_mode` is `timed` or `sequence`. `narration_cues` lists every line as `{text, at_ms, speak}` on the step clock. `narration_audio` is the creator's recording, or null.
- **Course step with cues** (timed). The creator writes up to 12 lines in the Studio, each with its time (0 to the step's planned length) and a *Speak aloud* box. Spoken lines are at least 4 s apart. Lines that are not spoken are subtitles only. The enrolled version's cues and recording are played (§3a).
- **Course step without cues** (sequence). Its narration text plays exactly as before Phase 4: its lines are said one after another from the start of the step.
- **SEDENS Standard** (timed). The first line is spoken as the step starts and later lines every 8 s. At most 3 lines a step are spoken, and none after the step's planned time. Every other line is a subtitle only.

**Scheduling rules** (`room-cues.js`, pure and unit-tested in `web/test/sedens-room-cues.test.mjs`).
- Every cue is a subtitle. It appears when the step clock reaches its time. It stays until the next cue replaces it or its display time (`holdMs`, 4 to 12 s) ends.
- Only cues with `speak` are spoken. Nothing is spoken while the workout is paused.
- At most one utterance at a time, and nothing is queued. A spoken cue more than 1.5 s late is skipped, never said late: for example after a pause, a seek, or while another line is still being said.
- Going back (repeat, previous) makes the later cues due again.

**Providers, in order.**
1. **The creator's recording.** One file per step. It starts at the step's first spoken cue and follows the step clock. It pauses with the clock and is seeked when it drifts by more than 0.6 s. When it starts or restarts, it is put in step once more closely (0.15 s), so a slow start does not leave it behind. While a recording plays, the browser's speech says nothing. A recording the browser cannot decode falls back to speech. Example: AAC (`.m4a`) in Chromium builds without proprietary codecs, such as this container's test Chromium. There, `canPlayType` answers "probably" for MP3 and Opus, and "" for AAC.
2. **The browser's own SpeechSynthesis.** It uses a `ko-KR` or `en-US` voice at rate 0.95. A creator's course is written in one language, so the voice follows the script of each line (`textLanguage`). A watchdog stops waiting for an engine that never reports the end of a line.
3. **Subtitles only.**

**Settings** (`room-sound.js`). The settings are voice volume, music volume, one *Mute all* (also the M key), spoken guidance on or off, and subtitles on or off. SEDENS Standard also has a narration-language choice: the room's language, 한국어 or English. A course has no such choice ("Narration is in the course's language."). A muted recording keeps running silently so that it stays in step. The settings are kept in this tab's session storage for the room visit, so a new step, a language change or a reload keeps them. Music dips while the voice speaks or the recording plays. The get-ready screen says "Next: …".

If speech is missing or fails, the session works fully with subtitles; nothing throws.

## 6. Music (`room-music.js`)

- **Modes.** Off (default), Calm, Focus, Energy, and My own audio.
- **Generated ambience.** Calm, Focus and Energy are quiet chords and pulses generated in the browser with WebAudio. There are no audio files and no licensing question.
- **The customer's own file.** It is played locally through an object URL and is never uploaded.
- **Volume and lifecycle.** Music volume is separate from narration. Music pauses with the workout and stops when it ends.

## 7. Anatomy synchronization

**What is shown at a time.** `anatomyStateAt(content, ms)` is pure. It returns the authored timeline moment covering `ms` (`start_ms ≤ ms < end_ms`: structures, highlight or isolate, layer, cue). Outside any moment, or without a timeline, it returns the exercise-level mapping, with focus set to the `focus`/`prime` roles. There are never intensities. As a result:
- seeking back restores the earlier moment;
- repeat and restart return to the start state;
- a new step starts from its own state, so the previous step's structures never carry over.

**When it is sent.** The player recomputes the state on play, pause, seek, video time updates, repeat, skip, previous and variant change. It sends a message only when the state changes. When a step is shown it preloads the next step's structures (the `preload` op loads the atlas layers they live in; checked: the first `preload` of a deep-muscle structure fetched `muscles_deep.glb` once, and the `show` that followed fetched nothing). The bridge also skips a `show` whose structures, focus, mode and layer equal what is already drawn, while the live viewer state (isolation, selection, layers) still matches; it answers with `skipped: true` and asks for no frames.

**Bridge protocol** (`anatomy-room-bridge.js`, same origin, from the parent window only):

| Message in (`type: "sedens-anatomy"`) | Effect |
|---|---|
| `show {structures, focus, mode, layer}` | highlight: whole body, focus structure shown through it, camera unchanged. isolate: only those structures, framed |
| `clear` | default whole body (skeleton and superficial muscles), nothing selected |
| `lang`, `view`, `zoom`, `fit` | viewer settings |
| `turn {degrees}` | one camera move round the body (the room uses 45 degrees, left or right); distance and height are kept |
| `rotate {on, seconds}` | continuous turning, which keeps the viewer drawing, so it stops by itself after `seconds` (default 12, at most 30). The room's buttons use `turn`, not this |
| `names {structures}` | the drawn structures' names in the viewer's language (`sedens-anatomy-names {names, missing}`); keys the atlas does not draw come back in `missing` and are not offered to the customer |
| `preload {structures}` | load what those structures need without showing them |

| Message out | When |
|---|---|
| `sedens-anatomy-ready` | the viewer is ready (about 6 s in headless Chromium on a development machine, first load) |
| `sedens-anatomy-state {seq, isolated, selected, missing}` | after each operation; unknown names are listed in `missing` |
| `sedens-anatomy-selection {key, name}` | the customer tapped a structure |
| `sedens-anatomy-error {message}` | the viewer could not load; the workout continues without it |

**Names, not ids.** Structures travel by registry key and are resolved inside the frame, because ids change when the atlas is rebuilt.

**What the bridge never does.**
- It never calls the viewer's exercise mode or plays motion clips, because those paint per-role activation levels.
- It hides the professional panels and the link out of the room. The iframe is sandboxed without top navigation.

**The anatomy stays part of the workout.** The side panel always names what is shown for the exercise on screen ("Highlighted in the body: Diaphragm", or "Showing only: ..." for an authored isolate moment), from the same state the viewer is given. Nothing about the viewer is a separate screen: it is one iframe, its content follows the step and its authored timeline, and "Explore" only restyles it.

**Expanded anatomy.**
- "Explore" restyles the same iframe to full screen. It is never moved, because that would reload it.
- **Two modes, shown as toggle buttons with `aria-pressed` (and a check mark):** "Highlight in the body" (the whole body stays and the structure is shown through it) and "Show only this" (only that structure). A status line (`role="status"`) says what is on screen: "Highlighted in the body: X", "Showing only: X", "Showing the skeleton only." or "Showing the whole body...".
- **Selecting.** Tap a muscle on the model, or pick one from "In this exercise", a button list of the step's structures (names in the current language, only those the atlas draws). Picking another structure keeps the mode. In "Show only this" only the isolated structure can be tapped, so the list (or "Highlight in the body") is how to choose another.
- **Moving the model.** Drag, Front/Side/Back, Turn left / Turn right (45 degree steps, each one camera move, so nothing keeps drawing afterwards), zoom + and -. The room does not use auto-rotation.
- **What to show.** "Skeleton only" (toggle; the camera returns to the whole body), "Whole body" (nothing selected), and "Back to the workout".
- **Synchronized with the step.** Opening starts from the step's own state (its mode and its focus structure). If the step changes while the view is open, the new step's structures are shown in the mode the customer chose and the list follows. Closing restores the step's state.
- Everything is a real button, so it works with a keyboard, a mouse or touch; no hover is needed. English and Korean; "I don't feel well" is in the toolbar too. On a phone the model comes first and the buttons scroll below it.
- By default the workout pauses while anatomy is expanded (`reason: anatomy`) and resumes on return. (While it is paused the server does not accept a step change, so the "step changes while open" path is only reached by a change that comes from outside the player; it is covered by the code path, not by the browser test.)
- Events: `anatomy_opened`, and `structure_isolated` when a structure is shown on its own (the event names are a fixed list; no new ones were added).

**Two rendering caveats.**
- Chromium pauses rendering of an off-screen iframe. The panel is therefore kept on screen; to warm it up it is given its real size with opacity 0.
- The viewer redraws only while something animates, so the bridge invalidates the frame after each operation.

### Performance mode (room only)

`web/src/main.js` reads `location.search` once (`web/src/roomPerf.js`). The room embeds `/anatomy.html?room=1&embed=1`; the professional viewer never has `room=1` (it loads `/anatomy.html?platform=1&embed=1` or no query), so for it nothing below applies. `test/sedens-anatomy-performance.test.mjs` pins that: without `room=1` the heartbeat is 500 ms, drawing is never held, and the pixel ratio is exactly `min(devicePixelRatio, level)`.

| With `room=1` | Without (professional viewer, as before) |
|---|---|
| idle heartbeat 2000 ms | 500 ms |
| no drawing while `document.visibilityState` is `hidden` (dirty frames are kept; `visibilitychange` already asks for eight on return). Only page visibility is used, never IntersectionObserver or display:none detection, because the room keeps the host on screen at opacity 0 to warm up | drawing unchanged |
| pixel ratio capped at 1.25, and at 1 when the canvas is narrower than 480 CSS px (re-applied on resize and when the quality governor steps) | `min(devicePixelRatio, level)` |
| a repeated `show` is skipped by the bridge | every `show` is applied |

Not done: fewer settle frames (a change can land across two frames, so three stay), and no bloom change (still decided by the frame-time governor). With `room=1&perf=1` the page exposes `window.__sedensAnatomyPerf = {drawn, frames}` (frames the loop drew, and loop ticks); without `perf=1` nothing is exposed.

**Measured before and after** with `web/test/sedens-anatomy-performance.browser.mjs` (same script on both builds). Method: drawn frame = an animation-frame callback in the anatomy iframe during which at least one WebGL draw call was issued (`requestAnimationFrame` and the draw calls are wrapped by an init script; the built-in counter was checked against it: 6/6, 11/11, 17/17 drawn frames over 8 s); long tasks from `PerformanceObserver("longtask")` in the room page. "Before" is a read-only `git worktree` of HEAD (the commit before this change), "after" the same commit with this change; same backend, `SEDENS_MODE=demo_free`, Chromium with software WebGL (SwiftShader), 1366x900, device pixel ratio 1. Six runs alternated before, after, before, after, before, after; medians of three runs each. Other agents were using the CPU of the container at the same time (load average 2.3 to 4.6), so the counts are what to compare, not milliseconds.

| Window | Before | After |
|---|---|---|
| Idle, plan screen shown, 20 s: frames drawn | 41 (2.05 per second) | 10 (0.50 per second; later runs gave 12, 14 and 21: the window still contains the tail of loading and the quality governor settling, so only the idle-while-running row is stable) |
| Idle, workout running, 20 s: frames drawn | 39 (1.94 per second) | 10 (0.50 per second) |
| Idle 20 s: long tasks (count, total) | 41, 11.7 s | 10, 2.7 s |
| One room change (`show` to other structures), 3.7 s window: frames drawn | 9 | 4 |
| The same `show` again, 3.5 s window | 9 | 2 (skipped) |
| "Show only this" (isolate, camera moves), 3.6 s window | 15 | 10 |
| A real step change (Done), 4.1 s window | 10 | 6 |
| Page hidden (simulated), 10 s: frames drawn | 19 | 0 |
| Page hidden, 10 s: long tasks | 19, 4.3 s | 0 |
| Back to visible, 3 s (the test now dispatches a bubbling `visibilitychange`, as a real browser does, so the resume request for eight frames is exercised; the count is bound by frame cost in software WebGL, about 0.3 s per frame plus the heartbeat) | 6 | 3 |
| Professional viewer (no `room=1`), idle 10 s | 23 | 28 (the page draws continuously here; in software WebGL each frame takes longer than the 500 ms heartbeat, so the count is bound by frame cost and varies with load; the code path is unchanged) |

What the numbers say. The idle cost is the heartbeat: four times fewer drawn frames, and the page's thread is busy 14 per cent of the time instead of 58 per cent in this software renderer. A room change itself still costs a few frames (about two beyond the heartbeat in both builds; the three settle frames are kept), so the change totals fall because the heartbeat share does, and a repeated `show` costs nothing. The hidden-page window is simulated (`document.visibilityState` is overridden in the iframe), because headless Chromium never hides a tab. Real browsers stop `requestAnimationFrame` in hidden tabs anyway, so this guard matters for embedders and kiosk shells that hide a window without pausing it. Pixel ratio: in this container the viewer starts on the software path at device pixel ratio 1, so the cap has no visible effect here (the quality governor settled at level 3 before and level 1 after, both at ratio 1; it climbs slower because there are fewer drawn frames to judge). The cap is covered by the unit test only.

**Real hardware performance is unverified.** No GPU-equipped device was available. The figures above are counts of work in a software renderer; they show that the room asks for four times fewer idle frames, not how fast a frame is on the room computer's GPU. Check frame time, heat and the effect of the pixel-ratio cap on a high-density display on the real device (`web/test/sedens-anatomy-performance.browser.mjs` runs against any base URL).

## 8. "I don't feel well"

The button is always reachable during training, including on the ready screen and while the anatomy view is full screen. It asks first about urgent signs (from
the readiness file): chest pain or pressure, severe breathlessness, feeling about to
faint, sudden loss of balance or stroke signs.

- **Yes.** `workout/unwell {urgent: true}`: 119 or staff, straight away.
- **No.** One tap names what is happening (pain, dizzy, unwell, other): `workout/unwell {urgent: false, category}`.

Either way the workout ends at once as incomplete. Simple guidance is shown, nothing
is diagnosed, the workout never continues by itself, and the room offers no other
session in that visit.

## 9. What the player never does

- Analyse the camera or correct form: the camera is off after the scan (brief §33).
- Claim measured muscle activation, "perfect form", or that something is wrong with a joint.
- Need the internet. Course media, repository pictures, the anatomy viewer, speech and music are local.
