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
| `web/src/sedens/room-narration.js` | narration: recorded audio, browser speech, captions always |
| `web/src/sedens/room-music.js` | music: off, generated ambience, or the customer's own file |

## 1. What is on screen

- **Main area.** The step's video when the step has one: creator-uploaded course video, played from this server. When there is no video, the step's picture with its label (for example "AI-generated illustration — not a real instructor"). When there is neither, a static instruction card (setup and steps). An unrelated video is never inserted.
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

## 5. Narration (`room-narration.js`)

**Providers, in order:**
1. Recorded audio, when a step line carries an audio URL. The hook exists; no recordings exist yet.
2. The browser's own SpeechSynthesis. It picks a `ko-KR` or `en-US` voice, waits for voices to load, rate 0.95.
3. Captions only.

**Behaviour.**
- Lines are short: the step's two or three narration cues at the start of a step, and "Next: …" during a transition.
- Narration has its own on/off and volume. Music dips while it speaks.
- If speech is missing or fails, the session works fully with captions; nothing throws.

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

**When it is sent.** The player recomputes the state on play, pause, seek, video time updates, repeat, skip, previous and variant change. It sends a message only when the state changes, and preloads the next step's structures.

**Bridge protocol** (`anatomy-room-bridge.js`, same origin, from the parent window only):

| Message in (`type: "sedens-anatomy"`) | Effect |
|---|---|
| `show {structures, focus, mode, layer}` | highlight: whole body, focus structure shown through it, camera unchanged. isolate: only those structures, framed |
| `clear` | default whole body (skeleton and superficial muscles), nothing selected |
| `lang`, `rotate`, `view`, `zoom`, `fit` | viewer settings (auto-rotation is off in the room) |
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

**Expanded anatomy.**
- Tapping the panel restyles the same iframe to full screen. It is never moved, because that would reload it.
- The customer can rotate, tap a muscle to isolate it, show the skeleton, show the whole body, and return.
- By default the workout pauses while anatomy is expanded (`reason: anatomy`) and resumes on return.

**Two rendering caveats.**
- Chromium pauses rendering of an off-screen iframe. The panel is therefore kept on screen; to warm it up it is given its real size with opacity 0.
- The viewer redraws only while something animates, so the bridge invalidates the frame after each operation.

## 8. "I don't feel well"

The button is always reachable during training. It asks first about urgent signs (from
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
