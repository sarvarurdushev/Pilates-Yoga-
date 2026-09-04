/**
 * The coach's half: what the camera cannot see, written onto the body itself.
 *
 * A camera can say a knee reached 152 degrees. It cannot say that this student
 * guards that knee because of an old injury, that "reach the heel away" works
 * for them where "straighten the leg" does not, or that today they were tired.
 * Those are the things a coach already writes down, and they are worth more per
 * word than anything in this application -- so the job here is to make writing
 * one take seconds, from the structure the coach is already looking at.
 *
 * **The shape is what instructors actually record**, not what was convenient to
 * build. Clinical note-taking for Pilates uses SOAP, and the working advice is
 * that a note should make the next session better in under thirty seconds of
 * reading. In practice that means: what to avoid, the cues that work in this
 * person's own words, what was modified and why, the springs and props, one to
 * three live goals with a date to review them. Each is stored as its own kind
 * because each is read back at a different moment -- a contraindication before
 * the class, a cue during it, a goal at the review.
 *
 * **An observation is never dressed as a measurement.** It is a fourth tier,
 * `observed`, and it always carries who said it and when. That is not a
 * disclaimer, it is the whole of its authority: a measurement is checkable and
 * an opinion is attributable, and a reader is owed the difference.
 *
 * The sheet reads in the order a coach reads it, which is not the order it was
 * written: flags first, then cues, then goals, then the last few classes. A
 * list sorted by date puts a March contraindication six screens below a note
 * about a warm-up.
 */
const esc = (s) => String(s ?? '').replace(/[&<>"]/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const CSS = `
/* Clear of the application's own furniture. The left column from the header
   down is the view bar, the HUD and the layers panel -- all of it at left:22px
   and 268 wide -- so anything put there lands on top of a control. */
#ss-coach-bar{position:fixed;left:308px;bottom:22px;z-index:60;display:flex;
  gap:8px;align-items:center}
#ss-coach-bar button{padding:9px 14px;border-radius:4px;font-size:12.5px;
  border:1px solid var(--line2);background:rgba(8,14,24,.86);color:var(--dim);
  cursor:pointer;letter-spacing:.02em}
#ss-coach-bar button[aria-pressed=true]{border-color:var(--gold);
  color:var(--txt);background:rgba(233,180,92,.14)}
#ss-coach-bar em{font-style:normal;font-size:9.5px;letter-spacing:.12em;
  text-transform:uppercase;color:var(--gold);margin-right:6px}

/* Beside the panel rather than on the left, where the view bar and the layers
   already are -- and next to where the coach is working, which is the panel.
   Readable without opening anything: a flag that needs a click is a flag that
   gets missed. */
#ss-sheet{position:fixed;right:calc(var(--panelw) + 30px);
  top:calc(var(--barh) + 14px);width:292px;
  max-height:calc(100vh - var(--barh) - 120px);overflow:auto;z-index:55;
  border-radius:5px;border:1px solid var(--line2);padding:14px 15px;
  background:linear-gradient(200deg,rgba(9,15,25,.95),rgba(5,9,16,.97))}
#ss-sheet h3{margin:0 0 3px;font-size:14px;font-weight:500;color:var(--txt)}
#ss-sheet .who{margin:0 0 12px;font-size:10.5px;color:var(--dim2)}
#ss-sheet h4{margin:13px 0 6px;font-size:9.5px;letter-spacing:.13em;
  text-transform:uppercase;color:var(--dim2);font-weight:400}
#ss-sheet h4:first-of-type{margin-top:0}
#ss-sheet .flag{background:rgba(226,104,95,.10);
  border-left:2px solid rgba(226,104,95,.7);padding:8px 10px;border-radius:0 3px 3px 0;
  margin:0 0 7px;font-size:12px;color:#f0d9d7;line-height:1.5}
#ss-sheet .flag .meta{display:block;color:#c9a5a2;font-size:10px;margin-top:4px}
#ss-sheet .item{font-size:12px;color:var(--dim);line-height:1.55;margin:0 0 8px;
  padding-left:10px;border-left:1px solid var(--line2)}
#ss-sheet .item b{color:var(--txt);font-weight:500}
#ss-sheet .item .meta{display:block;color:var(--dim2);font-size:10px;margin-top:2px}
#ss-sheet .none{font-size:11.5px;color:var(--dim2);font-style:italic;margin:0}
#ss-sheet .due{color:var(--gold)}

/* Writing one. In the panel, under whatever structure is selected, because the
   structure is the subject and clicking away to a form loses it. */
.ss-write{margin:10px 0 0;border-top:1px solid var(--line);padding-top:11px}
.ss-write h4{margin:0 0 8px;font-size:9.5px;letter-spacing:.13em;
  text-transform:uppercase;color:var(--gold);font-weight:400}
.ss-write select,.ss-write textarea,.ss-write input{width:100%;font:inherit;
  font-size:12.5px;padding:7px 9px;border-radius:3px;background:var(--glass);
  border:1px solid var(--line);color:var(--txt);margin:0 0 7px}
.ss-write textarea{min-height:66px;resize:vertical;line-height:1.5}
.ss-write select:focus,.ss-write textarea:focus,.ss-write input:focus{outline:0;
  border-color:var(--acc)}
.ss-write .rate{display:flex;gap:5px;margin:0 0 7px}
.ss-write .rate button{flex:1;padding:6px 0;border-radius:3px;font-size:12px;
  border:1px solid var(--line);background:var(--glass);color:var(--dim);
  cursor:pointer}
.ss-write .rate button[aria-pressed=true]{border-color:var(--acc);
  color:var(--txt);background:rgba(90,169,230,.15)}
.ss-write .go{display:flex;gap:8px;align-items:center}
.ss-write .go button{padding:8px 14px;border-radius:3px;font-size:12.5px;
  border:1px solid var(--acc);background:var(--acc);color:#04121f;cursor:pointer}
.ss-write .go span{font-size:11px;color:var(--dim2)}
.ss-write .bad{color:var(--gold)}
.ss-said{margin:12px 0 0}
.ss-said h4{margin:0 0 7px;font-size:9.5px;letter-spacing:.13em;
  text-transform:uppercase;color:var(--dim2);font-weight:400}
.ss-said .one{border-left:2px solid rgba(233,180,92,.55);padding:0 0 0 10px;
  margin:0 0 9px;font-size:12.5px;color:#dfe6f2;line-height:1.55}
.ss-said .one .meta{display:block;font-size:10px;color:var(--dim2);margin-top:3px;
  letter-spacing:.04em}
.ss-said .one .rating{color:var(--acc2)}
`;

/** Every kind, in the order a coach reaches for them. */
const ORDER = ['cue', 'modification', 'assessment', 'contraindication',
               'setting', 'goal', 'subjective', 'note'];

let state = {
  on: false, user: '', by: '', sheet: null, kinds: {}, session: '',
};

export function coaching() { return state.on; }
export function sheet() { return state.sheet; }

/**
 * Notes about one structure, newest first.
 *
 * Matched loosely on the name, because the two ends spell it differently: the
 * model title-cases what it displays ("Rectus femoris") and a coach typing at a
 * terminal writes what they say ("rectus femoris"). Comparing them exactly hid
 * every note written outside the app from the panel that was supposed to show
 * it -- silently, which is the worst way for a note to go missing.
 */
const same = (a, b) => String(a ?? '').trim().toLowerCase()
                    === String(b ?? '').trim().toLowerCase();

export function about(structureName) {
  const all = [
    ...(state.sheet?.flags ?? []), ...(state.sheet?.cues ?? []),
    ...(state.sheet?.settings ?? []), ...(state.sheet?.goals ?? []),
    ...(state.sheet?.recent ?? []),
  ];
  const seen = new Set();
  return all.filter((n) => {
    if (seen.has(n.id) || !same(n.structure, structureName)) return false;
    seen.add(n.id);
    return true;
  });
}

/* ------------------------------------------------------------------- sheet */

function renderSheet(host) {
  const s = state.sheet;
  if (!s) { host.innerHTML = ''; return; }
  const due = new Set((s.due ?? []).map((g) => g.id));
  const item = (n, extra = '') => `<div class="item"><b>${esc(n.text)}</b>
    <span class="meta">${esc(n.about)} · ${esc(n.by)} · ${esc(n.made_on)}${
    extra}</span></div>`;
  const block = (title, notes, render) => notes.length
    ? `<h4>${esc(title)}</h4>${notes.map(render).join('')}` : '';

  host.innerHTML = `
    <h3>${esc(s.display_name || s.username)}</h3>
    <p class="who">What to read before the next class</p>
    ${block('Before you start', s.flags, (n) =>
      `<div class="flag">${esc(n.text)}
        <span class="meta">${esc(n.about)} · ${esc(n.by)} · ${esc(n.made_on)}</span>
       </div>`)}
    ${block('Cues that work', s.cues, (n) => item(n))}
    ${block('Settings', s.settings, (n) => item(n))}
    ${block('Working towards', s.goals, (n) => item(n,
      n.review_on ? ` · <span class="${due.has(n.id) ? 'due' : ''}">review ${
        esc(n.review_on)}</span>` : ''))}
    ${block('Last few classes', s.recent, (n) => item(n,
      n.rating != null ? ` · ${n.rating}/${n.scale} ${esc(n.rates)}` : ''))}
    ${!s.flags.length && !s.cues.length && !s.goals.length && !s.recent.length
      ? '<p class="none">Nothing written down yet. Choose a muscle, a bone or a '
      + 'nerve on the body and write the first note.</p>' : ''}`;
}

async function loadSheet(user) {
  try {
    const response = await fetch(`sheet?user=${encodeURIComponent(user)}`);
    if (!response.ok) return null;
    return await response.json();
  } catch { return null; }
}

/* ------------------------------------------------------------------ writing */

/**
 * The form, rendered under whatever structure is selected.
 *
 * The structure is the subject, so the form lives beside it rather than behind
 * a button that loses it. Kind first, because it decides where the note will be
 * read back; then the words; then a rating, which is optional and has to say
 * what it rates -- a bare "4" is the thing this project exists not to produce.
 */
export function writer(structureName, fma, record) {
  if (!state.on) return '';
  const options = ORDER.filter((k) => state.kinds[k])
    .map((k) => `<option value="${k}">${esc(k)} — ${esc(state.kinds[k])}</option>`)
    .join('');
  const subject = structureName
    ? `about <b>${esc(structureName)}</b>` : 'about the whole person';
  return `<div class="ss-write" data-structure="${esc(structureName ?? '')}"
       data-fma="${esc(fma ?? '')}">
    <h4>Write a note — ${subject}</h4>
    <select data-kind>${options}</select>
    <textarea data-text placeholder="What would make the next class better? Their words if you have them."></textarea>
    <input data-rates placeholder="Rate what? e.g. control through the hips (optional)">
    <div class="rate" role="group" aria-label="rating out of five">
      ${[1, 2, 3, 4, 5].map((n) =>
        `<button type="button" data-rating="${n}" aria-pressed="false">${n}</button>`).join('')}
    </div>
    <input data-review placeholder="Review on (optional, e.g. 2026-10-01)">
    <div class="go"><button type="button" data-save>Save note</button>
      <span data-said></span></div>
  </div>`;
}

/** Notes already written about this structure, shown with the measurements. */
export function saidAbout(structureName) {
  const notes = about(structureName);
  if (!notes.length) return '';
  return `<div class="ss-said"><h4>What the coach said</h4>${notes.map((n) =>
    `<div class="one">${esc(n.text)}<span class="meta">${esc(n.kind)} · ${
      esc(n.by)} · ${esc(n.made_on)}${n.rating != null
        ? ` · <span class="rating">${n.rating}/${n.scale} ${esc(n.rates)}</span>`
        : ''}</span></div>`).join('')}</div>`;
}

/** Wire a rendered form. Called by the panel after each render. */
export function wireWriter(root, onSaved) {
  const form = root.querySelector('.ss-write');
  if (!form || form.dataset.wired) return;
  form.dataset.wired = '1';
  let rating = null;
  for (const button of form.querySelectorAll('[data-rating]')) {
    button.addEventListener('click', () => {
      rating = rating === +button.dataset.rating ? null : +button.dataset.rating;
      for (const other of form.querySelectorAll('[data-rating]')) {
        other.setAttribute('aria-pressed',
                           String(rating === +other.dataset.rating));
      }
    });
  }
  const said = form.querySelector('[data-said]');
  form.querySelector('[data-save]').addEventListener('click', async () => {
    const payload = {
      username: state.user, by: state.by, session: state.session,
      kind: form.querySelector('[data-kind]').value,
      text: form.querySelector('[data-text]').value,
      rates: form.querySelector('[data-rates]').value,
      review_on: form.querySelector('[data-review]').value,
      structure: form.dataset.structure, fma: form.dataset.fma,
      rating,
    };
    said.className = '';
    said.textContent = 'Saving…';
    try {
      const response = await fetch('note', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || response.statusText);
      state.sheet = body.sheet;
      const host = document.getElementById('ss-sheet');
      if (host) renderSheet(host);
      /* Refresh the notes about this structure in place, rather than tearing
       * the panel down and rebuilding it: a re-render destroys the form, and
       * with it the confirmation that the note was saved -- so the coach sees
       * an empty box and no idea whether it worked. */
      const previous = form.parentElement.querySelector('.ss-said');
      const fresh = saidAbout(form.dataset.structure);
      if (previous) previous.outerHTML = fresh;
      else if (fresh) form.insertAdjacentHTML('beforebegin', fresh);
      form.querySelector('[data-text]').value = '';
      form.querySelector('[data-rates]').value = '';
      for (const other of form.querySelectorAll('[data-rating]')) {
        other.setAttribute('aria-pressed', 'false');
      }
      rating = null;
      said.textContent = 'Saved.';
      onSaved?.(body.note);
    } catch (error) {
      said.className = 'bad';
      said.textContent = error.message;
    }
  });
}

/* ------------------------------------------------------------------- mount */

/**
 * Offer coach mode, when there is a record to write into.
 *
 * A viewer showing an exported bundle has none, and then the button never
 * appears: a note with nowhere to go is worse than no note.
 */
export async function mount(session, nw, onChange) {
  const capable = await (async () => {
    try {
      const response = await fetch('capabilities');
      return response.ok ? await response.json() : null;
    } catch { return null; }
  })();
  if (!capable?.coach) return null;

  state.kinds = capable.kinds ?? {};
  state.user = session.person.username;
  state.session = session.key ?? '';

  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const bar = document.createElement('div');
  bar.id = 'ss-coach-bar';
  bar.innerHTML = `<button type="button" aria-pressed="false" data-toggle>
    <em>Coach</em><span>Write notes on the body</span></button>`;
  document.body.appendChild(bar);

  const host = document.createElement('div');
  host.id = 'ss-sheet';
  host.hidden = true;
  document.body.appendChild(host);

  bar.querySelector('[data-toggle]').addEventListener('click', async () => {
    state.on = !state.on;
    bar.querySelector('[data-toggle]').setAttribute('aria-pressed', String(state.on));
    host.hidden = !state.on;
    if (state.on) {
      // Asked for once, remembered for the window. A name typed into every note
      // is a name that stops being typed.
      state.by = state.by || (window.prompt(
        'Who is writing these notes? Recorded with every one.') || '').trim();
      if (!state.by) { state.on = false; host.hidden = true;
        bar.querySelector('[data-toggle]').setAttribute('aria-pressed', 'false');
        return; }
      state.sheet = state.sheet ?? await loadSheet(state.user);
      renderSheet(host);
    }
    onChange?.(state.on);
  });

  // The sheet is loaded whether or not coach mode is on, because a
  // contraindication is worth surfacing to the student too.
  state.sheet = await loadSheet(state.user);
  return { state, renderSheet: () => renderSheet(host) };
}

export const _internals = { renderSheet, ORDER };
