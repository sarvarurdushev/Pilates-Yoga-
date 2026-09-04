/**
 * Attach one person's recorded class to the anatomy application.
 *
 * Loaded by a single script tag at the end of `index.html`. With no session in
 * the URL it does nothing at all and the application is exactly what it was --
 * which is the point: the anatomy explorer has to keep working on its own, for
 * somebody who has never been in front of a camera.
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
import { attachLab } from './lab.js';

const BANNER_CSS = `
#sessbar{position:fixed;left:0;right:0;top:0;z-index:60;display:flex;gap:14px;
  align-items:center;padding:6px 18px;font-size:11px;letter-spacing:.05em;
  background:linear-gradient(90deg,rgba(90,169,230,.16),rgba(90,169,230,.03));
  border-bottom:1px solid rgba(90,169,230,.28);color:var(--dim)}
#sessbar b{color:var(--txt);font-weight:500;letter-spacing:.02em}
#sessbar .sep{color:var(--dim2)}
#sessbar .warn{margin-left:auto;color:var(--gold);letter-spacing:.1em;
  text-transform:uppercase;font-size:9.5px}
/* Everything the application positions under its own header is measured from
   --barh, and its top bar is fixed at zero. So the session bar takes the top
   strip and the header, the panel, the HUD and the view buttons all move down
   together by changing the one number they are all written against. Pushing the
   header alone left the bar sitting on top of the four disclaimer lines, which
   are the four lines in this application that must not move. */
body.hassess{--barh:110px}
body.hassess #topbar{padding-top:40px}
`;

function banner(session) {
  const style = document.createElement('style');
  style.textContent = BANNER_CSS;
  document.head.appendChild(style);
  const bar = document.createElement('div');
  bar.id = 'sessbar';
  const score = session.score?.value;
  const person = session.person.display_name || session.person.username;
  bar.innerHTML = `<b>${person}</b><span class="sep">·</span>
    <span>${session.key} · ${session.date}</span><span class="sep">·</span>
    <span>${session.ranked().length} muscle groups measured</span>
    ${score != null ? `<span class="sep">·</span><span>score ${Math.round(score)}/100</span>` : ''}
    <span class="warn">Measured muscles are this person. Everything else is anatomy</span>`;
  document.body.appendChild(bar);
  document.body.classList.add('hassess');
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
function light(session, model) {
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

async function boot() {
  const url = new URLSearchParams(location.search).get('session');
  if (!url) return;
  let bundle;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    bundle = await response.json();
  } catch (error) {
    console.error(`[session] could not read ${url}:`, error);
    return;
  }

  const reg = await readyRegistry();
  let session;
  try {
    session = new Session(bundle, reg);
  } catch (error) {
    // A bundle that fails its own checks is not shown at all. A picture drawn
    // from a file that contradicts itself is worse than no picture.
    console.error('[session] this bundle will not be shown:', error.message);
    return;
  }

  banner(session);
  const lit = light(session, { registry: reg, palette: nw.gfx.palette });
  attachPanel(session, nw);
  attachLab(session, nw);

  // For the render harness and for anybody poking at it in a console.
  globalThis.__session = { session, lit };
  console.info(`[session] ${session.person.username}: ${lit.lit.length} structures lit, `
             + `${session.ranked().length} groups measured, `
             + `${session.brainRegions().length} brain regions with claims`);
}

boot();
