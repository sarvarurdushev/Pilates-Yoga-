/**
 * Attach one person's recorded class to the anatomy application.
 *
 * Loaded by a single script tag at the end of `index.html`. With no session in
 * the URL it adds one thing and changes nothing else: a Record button in the
 * header, because the way somebody gets a session is by recording one and that
 * question has to have a visible answer on the empty page. The anatomy explorer
 * underneath keeps working exactly as it did, for somebody who has never been
 * in front of a camera.
 *
 *     index.html?session=anna_s1.json
 *
 * With one, three things change and nothing else does:
 *
 * 1. the muscles this person's session measured are lit from the measurement
 *    instead of from an authored role, in a band the legend explains;
 * 2. clicking any structure prints what this session says about it, with the
 *    kind of claim visible in the treatment;
 * 3. a bar across the top says whose session is loaded, because a body showing
 *    somebody's measurements must never be mistaken for the template body.
 *
 * Everything else -- the exercise library, the evidence table, the lab, the
 * sections, the network -- is untouched and keeps working as it did.
 */
import * as nw from '../main.js';
import { registry } from '../structures.js';
import { apply } from './bundle.js';
import { attachPanel } from './panel.js';
import { Session } from './session.js';
import { attachLab, showReading } from './lab.js';
import { capabilities, mount as mountRecorder } from './record.js';
import { mount as mountCoach } from './coach.js';
import { mount as mountRecordings } from './recordings.js';
import { chip, gate, whoami } from './account.js';
import { coaches as mountMyCoaches, mount as mountRoster } from './roster.js';
import { mount as mountAdmin } from './admin.js';
import { foldable, notes as mountNotes, reset as resetStructure,
         show as showStructure } from './structure.js';

const BANNER_CSS = `
#sessbar{position:fixed;left:0;right:0;top:0;z-index:60;display:flex;gap:14px;
  align-items:center;padding:6px 18px;font-size:11px;letter-spacing:.05em;
  background:linear-gradient(90deg,rgba(90,169,230,.16),rgba(90,169,230,.03));
  border-bottom:1px solid rgba(90,169,230,.28);color:var(--dim)}
#sessbar b{color:var(--txt);font-weight:500;letter-spacing:.02em}
#sessbar .sep{color:var(--dim2)}
#sessbar .warn{margin-left:auto;color:var(--gold);letter-spacing:.1em;
  text-transform:uppercase;font-size:9.5px}
/* Sample data gets one muted word, not a banner. The full-width amber bar was
   correct about the risk and wrong about the dose: it shouted over the thing it
   was labelling on every screen and every screenshot. The marking that matters
   is in the file -- the bundle carries a synthetic block, the validator
   enforces it, and it travels with the file -- so the bar only has to be
   honest, not loud. */
#sessbar .sample{color:var(--gold);letter-spacing:.11em;text-transform:uppercase;
  font-size:9px;border:1px solid rgba(233,180,92,.4);border-radius:3px;
  padding:1px 6px}
#demochip{position:fixed;left:308px;bottom:22px;z-index:60;display:flex;gap:10px;
  align-items:center;padding:9px 14px;border-radius:4px;cursor:pointer;
  background:rgba(233,180,92,.10);border:1px solid rgba(233,180,92,.45);
  color:var(--txt);font-size:12px;letter-spacing:.02em}
#demochip:hover{background:rgba(233,180,92,.17)}
#demochip em{font-style:normal;color:var(--gold);font-size:9.5px;
  letter-spacing:.12em;text-transform:uppercase}
/* Everything the application positions under its own header is measured from
   --barh, and its top bar is fixed at zero. So the session bar takes the top
   strip and the header, the panel, the HUD and the view buttons all move down
   together by changing the one number they are all written against. Pushing the
   header alone left the bar sitting on top of the four disclaimer lines, which
   are the four lines in this application that must not move. */
body.hassess{--barh:110px}
body.hassess #topbar{padding-top:40px}
`;

function styles() {
  if (document.getElementById('sessstyle')) return;
  const style = document.createElement('style');
  style.id = 'sessstyle';
  style.textContent = BANNER_CSS;
  document.head.appendChild(style);
}

function banner(session) {
  styles();
  const bar = document.createElement('div');
  bar.id = 'sessbar';
  const score = session.score?.value;
  const fake = session.synthetic;
  const person = session.person.display_name || session.person.username;
  if (fake) bar.classList.add('synthetic');
  const sessions = Object.values(session.bundle.history ?? {})
    .reduce((most, h) => Math.max(most, h.sessions ?? 0), 0);
  bar.innerHTML = `<b>${esc(person)}</b><span class="sep">·</span>
    <span>${esc(session.date)}</span><span class="sep">·</span>
    <span>${session.ranked().length} muscle groups</span>
    ${sessions > 1 ? `<span class="sep">·</span><span>${sessions} sessions on record</span>` : ''}
    ${score != null ? `<span class="sep">·</span><span>${Math.round(score)}/100</span>` : ''}
    ${fake ? '<span class="sample">Sample</span>' : ''}
    <span class="warn">Blue structures are measured. Everything else is anatomy</span>`;
  document.body.appendChild(bar);
  document.body.classList.add('hassess');
}

const esc = (t) => String(t ?? '').replace(/[&<>"]/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * Offer a demonstration without forcing one on anybody.
 *
 * With no session in the URL the application is the anatomy explorer, and that
 * has to stay true -- somebody who came to look at a shoulder did not ask to be
 * shown a stranger's Pilates class. But a deployment with nothing to click is a
 * deployment that looks broken to the person evaluating it. So: if the site
 * ships a `demo/index.json`, one chip in the corner, amber, saying what it is
 * before it is clicked. An installation that wants no demo ships no folder.
 */
async function offerDemo() {
  let manifest;
  try {
    const response = await fetch('demo/index.json');
    if (!response.ok) return;
    manifest = await response.json();
  } catch { return; }
  const first = manifest.sessions?.[0];
  if (!first) return;
  styles();
  const chip = document.createElement('button');
  chip.id = 'demochip';
  chip.type = 'button';
  chip.innerHTML = `<em>Demo</em><span>See a session on this body — ${
    esc(first.label)}, ${esc(first.date)}</span>`;
  chip.addEventListener('click', () => {
    const next = new URL(location.href);
    next.searchParams.set('session', `demo/${first.file}`);
    location.href = next.toString();
  });
  document.body.appendChild(chip);
}

/**
 * The registry is built during the application's own boot, from a model file it
 * has to fetch first. There is no event for it, so this waits for the thing it
 * needs rather than for a moment it cannot observe.
 */
async function readyRegistry(timeoutMs = 60000) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    try { const r = registry(); if (r?.byId?.size) return r; } catch { /* not yet */ }
    if (Date.now() > until) throw new Error('the anatomy registry never finished loading');
    await new Promise((r) => setTimeout(r, 120));
  }
}

/** The colour a measured structure is drawn in, by how hard its group worked. */
const MEASURED_DIM = [0x2f, 0x6d, 0xa8];
const MEASURED_BRIGHT = [0xbc, 0xe4, 0xff];

function measuredColour(share) {
  const t = Math.max(0, Math.min(1, share));
  const mix = (a, b) => Math.round(a + (b - a) * t);
  const [r, g, b] = MEASURED_DIM.map((c, i) => mix(c, MEASURED_BRIGHT[i]));
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Light the measured structures.
 *
 * **Activation alone was not enough, and finding that out took looking.** The
 * shader mixes a structure toward *its own* palette colour in proportion to the
 * alpha channel, and every muscle's own colour is a shade of the same muscle
 * red. So writing the measured levels worked exactly as intended -- the palette
 * held them, they were on the GPU -- and the body looked identical, because
 * lighting a red muscle more red is not a visible statement.
 *
 * So a measured structure is recoloured as well as lit: one hue for "this came
 * off your video", lighter the harder the group worked. The colour goes into
 * the registry record as well as the palette, because the panel dot and the
 * structure list read the record and the body reads the palette -- set only one
 * and the list and the body would disagree about what colour a muscle is, which
 * is worse than either choice.
 *
 * Hue is not carrying this alone. The banner says which structures are the
 * person, the panel prints the number and the date beside the measured ones and
 * nothing beside the rest, and reference structures keep their anatomical
 * colours. Colour is the thing you notice; the number is the thing that says
 * what it means.
 *
 * Not on a timer and not re-applied per frame: the palette is also written by
 * `setExercise` and by the clip scrubber, and a session that fought them for
 * the channel would flicker between two meanings. A session claims it once, at
 * load. Choosing an exercise afterwards is the reader asking for the authored
 * roles, and they get them.
 */
async function light(session, model) {
  /* Most of what a Pilates class measures is under the superficial layer -- the
   * psoas, the deep quadriceps -- and a body with that layer off shows half the
   * answer and none of the hardest-working muscle. It is also what
   * `renderStructureInto` needs before it can draw a thumbnail of one: with the
   * layer unloaded it returns null and the tile stays black. */
  await Promise.all([nw.setLayer('muscles_deep', true),
                     nw.setLayer('muscles_superficial', true)]).catch(() => {});
  const result = apply(session.bundle, model);
  const original = new Map();
  for (const entry of result.lit) {
    if (entry.tier !== 'measured') continue;
    const record = model.registry.byId.get(entry.id);
    if (!record) continue;
    original.set(entry.id, record.color);
    record.color = measuredColour(entry.share ?? 1);
    model.palette.setColor(entry.id, record.color);
  }
  model.palette.upload?.();
  if (result.missing.length) {
    console.warn('[session] not in this model:',
                 result.missing.map((s) => s.name).join(', '));
  }
  return { ...result, original };
}

/**
 * Put a bundle onto the body.
 *
 * Called at load with whatever the URL names, and again whenever a clip has
 * just been analysed. The second case is why this is a function rather than the
 * body of `boot`: after a recording the reader is standing in front of their own
 * measurements, and a page reload to show them would throw away the camera
 * position, the layers they turned on and the structure they were looking at.
 */
export async function install(bundle) {
  const reg = await readyRegistry();
  // A bundle that fails its own checks is not shown at all. A picture drawn
  // from a file that contradicts itself is worse than no picture.
  const session = new Session(bundle, reg);

  document.getElementById('sessbar')?.remove();
  document.getElementById('demochip')?.remove();
  banner(session);
  const lit = await light(session, { registry: reg, palette: nw.gfx.palette });
  attachLab(session, nw);
  /* The explore dock folds away. It is the widest thing on the screen and a
   * coach reading a body does not need four tabs of prose in the way of it. */
  foldable();
  resetStructure();
  attachPanel(session, nw, {
    onProse: showReading,
    // "Read about this in the lab" has to open the lab, or the button is a
    // promise the interface does not keep.
    openLab: () => document.getElementById('labBtn')?.click(),
    /* Selecting a structure opens the reading for it, on the axes that
     * structure actually takes -- recruitment for a muscle, placement for a
     * bone, a symptom report for a nerve. The server owns which. */
    onStructure: (record) => showStructure(record, identity,
                                           session.person.username,
                                           session.key ?? ''),
  });

  /* The coach's half. Drawn everywhere; writable only where there is a record
   * to write into. A viewer showing an exported bundle has none, and there the
   * button says that instead of offering a form that cannot save. */
  const coach = await mountCoach(session, nw, () => {
    // Re-render the panel so the sheet's contents follow the toggle.
    for (const el of document.querySelectorAll('.ss-panel, .ss-said, .ss-write')) {
      el.remove();
    }
  }, served, identity);

  /* Scoring the class, on the body of whoever is loaded. A coach gets the
   * rubric; the student whose body it is gets the same panel with the scoring
   * half removed, because what a coach thought of your rib cage is something
   * you are owed rather than something kept from you. */
  /* The way back to a reading once the structure has been deselected. Not a
   * form of its own: the writing happens on the body, and this is only a list
   * of what is already there. */
  document.getElementById('ss-notes-open')?.remove();
  if (identity?.signed_in) mountNotes(identity, session.person.username);

  // For the render harness and for anybody poking at it in a console.
  globalThis.__session = { session, lit, coach };
  globalThis.__nw = nw;
  console.info(`[session] ${session.person.username}: ${lit.lit.length} structures lit, `
             + `${session.ranked().length} groups measured, `
             + `${session.brainRegions().length} brain regions with claims`);
  return session;
}

/**
 * What the server behind this page can do, or null where there is no server.
 *
 * Read once at boot and kept, because the recorder and the coach both need it
 * and `install` runs again after every analysis. It is deliberately allowed to
 * be null: that is the static copy of the site, and both buttons have something
 * to say in that case rather than nothing.
 */
let served = null;

/**
 * Who is signed in, and therefore which room this is.
 *
 * Null on a deployment with no accounts at all, which is the old behaviour and
 * stays supported: a studio serving its own machine on its own network has one
 * person in the building and does not need a login to know who they are.
 */
let identity = null;

/**
 * Draw the controls this person's role has, and only those.
 *
 * The switcher does not add items to a menu -- it changes the room. Everything
 * mounted here is torn down and rebuilt when the role changes, because a coach
 * button left over from the last role is exactly the confusion this whole layer
 * exists to prevent.
 */
function room(me) {
  for (const id of ['ss-who-chip', 'ss-roster-open', 'ss-admin-open',
                    'ss-mine-open', 'ss-notes-open']) {
    document.getElementById(id)?.remove();
  }
  if (!me?.signed_in) return;
  chip(me, async () => {
    // Rebuild against the membership actually recorded on the session, not
    // against what the dropdown said: the server checks the switch and is the
    // only thing that decides whether it happened.
    identity = await whoami();
    room(identity);
  });
  mountRoster(me, install);
  mountAdmin(me);
  // The student's control over their own record, always present rather than a
  // prompt that arrives once at a moment nobody is thinking about it.
  if (!me.can?.coach) {
    mountMyCoaches(me);
    /* And what their coach wrote, on the same terms: in the header, before any
     * session is loaded. A student who has been written about but never
     * analysed -- most students in their first month -- would otherwise have no
     * way to reach any of it. */
    mountNotes(me, me.acting?.username ?? '');
  }
}

async function boot() {
  /* The recorder is mounted first, before any session and whatever the server
   * turns out to be: "where do I start recording" must have an answer on an
   * empty page, which is the page somebody sees before they have ever recorded
   * anything -- and on a page with no pipeline behind it, which is the page
   * most people will see first. Hiding the button there answered the question
   * with silence. */
  served = await capabilities();

  /* Who is looking, before anything of anybody's is drawn. A studio with
   * accounts gets a gate; one without keeps working exactly as it did. */
  identity = await whoami();
  if (identity?.accounts && !identity.signed_in) {
    identity = await gate(identity);
  }
  room(identity);

  mountRecorder(nw, install, served);
  /* And a way back into what has already been measured. Without it a finished
   * analysis could only ever appear in the dialog that was watching the job,
   * and closing that dialog lost the result with nowhere to recover it. */
  mountRecordings(served, install);

  const url = new URLSearchParams(location.search).get('session');
  /* No session named. The demo chip is offered whatever the server is: a studio
   * that has been installed but has never recorded anything is an empty page
   * too, and "see one first" is a fair thing to put next to "record one". */
  if (!url) { offerDemo(); return; }
  let bundle;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    bundle = await response.json();
  } catch (error) {
    console.error(`[session] could not read ${url}:`, error);
    return;
  }
  try {
    await install(bundle);
  } catch (error) {
    console.error('[session] this bundle will not be shown:', error.message);
  }
}

boot();
