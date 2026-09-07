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
import { passcode } from './record.js';

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
#ss-coach-bar.ss-off em{color:var(--dim2)}
#ss-coach-bar.ss-off button{background:rgba(8,14,24,.6);color:var(--dim2)}
#ss-coach-bar.ss-off button:hover{color:var(--txt);border-color:var(--line2)}
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
#ss-sheet .item.wide{margin-bottom:10px;line-height:1.65}

/* Writing one. In the panel, under whatever structure is selected, because the
   structure is the subject and clicking away to a form loses it. */
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
  // `canWrite` replaced a `coaching` toggle: the question is not whether
  // somebody flipped a switch, it is whether this person is theirs to write
  // about -- which the server already knows and now says.
  canWrite: false, on: false, user: '', by: '', sheet: null, kinds: {},
  session: '',
  // What the server said it can do, kept so a save knows whether to send a
  // passcode with it.
  capable: null,
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


/* ------------------------------------------------------------------- mount */

/**
 * The coach button on a copy of the site that cannot keep notes.
 *
 * It says which half is missing and stops there, rather than showing a form
 * whose save button would fail. Same rule as the recorder: visible, honest,
 * and it names the command that turns it on.
 */
function offline(session) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const bar = document.createElement('div');
  bar.id = 'ss-coach-bar';
  bar.className = 'ss-off';
  bar.innerHTML = `<button type="button" aria-pressed="false" data-toggle>
    <em>Before class</em><span>Reading only in this viewer</span></button>`;
  document.body.appendChild(bar);

  const host = document.createElement('div');
  host.id = 'ss-sheet';
  host.hidden = true;
  host.innerHTML = `<h3>Coach notes need the studio running</h3>
    <p class="item wide">A note is written into this person's record, and this copy
      of the site has no record behind it — it is showing a session that was
      exported to a file.</p>
    <p class="item wide">Run <b>python -m pilates web --db studio.db</b> on the
      studio's own machine and open it there. Then coach mode writes
      contraindications, cues, modifications, springs and goals onto the
      structure you are looking at, and reads them back before the next class.</p>
    <p class="item wide">Everything already on the body stays readable here; it is
      only writing that needs somewhere to write.</p>`;
  document.body.appendChild(host);

  bar.querySelector('[data-toggle]').addEventListener('click', () => {
    host.hidden = !host.hidden;
    bar.querySelector('[data-toggle]')
       .setAttribute('aria-pressed', String(!host.hidden));
  });
  return null;
}


/**
 * Offer coach mode.
 *
 * The button is drawn on every copy of the site, the same as Record and for the
 * same reason: a feature that is invisible where it does not work is a feature
 * nobody knows exists. Where there is a record to write into it opens the sheet
 * and the writing form. Where there is not -- a viewer showing an exported
 * bundle, which has no database behind it -- it opens one paragraph saying so.
 * Notes are still never *offered* into nowhere: nothing writable is drawn.
 */
/**
 * Whether the signed-in person may write about the body on screen.
 *
 * Asked of the server rather than guessed from the role: a coach may write
 * about their own students and nobody else's, and that is a fact the page does
 * not hold. One request, at load.
 */
async function mayWrite(username, me) {
  if (!username) return false;
  if (me?.acting?.username === username) return false;   // your own record
  if (!me?.can?.coach) return false;
  try {
    const response = await fetch(
      `student?username=${encodeURIComponent(username)}`,
      { credentials: 'same-origin' });
    if (!response.ok) return false;
    return !!(await response.json()).may_write;
  } catch { return false; }
}

export async function mount(session, nw, onChange, known, me) {
  const capable = known !== undefined ? known : await (async () => {
    try {
      const response = await fetch('capabilities');
      return response.ok ? await response.json() : null;
    } catch { return null; }
  })();
  if (!capable?.coach) return offline(session);

  state.capable = capable;
  state.kinds = capable.kinds ?? {};
  state.user = session.person.username;
  state.session = session.key ?? '';

  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  /* Who is writing, taken from the account rather than asked for. The first
   * version put up a window.prompt on every new browser session, which is a
   * dialog nobody reads and a name nobody spells the same way twice. */
  state.by = me?.account?.display_name || me?.acting?.username || '';
  state.canWrite = await mayWrite(state.user, me);

  const bar = document.createElement('div');
  bar.id = 'ss-coach-bar';
  bar.innerHTML = `<button type="button" aria-pressed="false" data-toggle>
    <em>Before class</em><span>${
      state.canWrite ? 'Flags, goals and the last few classes'
                     : 'What the coach wrote'}</span></button>`;
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
