/**
 * The chosen body part, as numbers and pictures.
 *
 * Click a muscle, a bone, a nerve or a brain region and this is what fills the
 * right-hand column: a rendering of that structure, the figure this session
 * produced for it, the line it has traced across every session before, and the
 * measurements around it. Nothing else.
 *
 * **The prose is gone from here on purpose.** The application's own writing --
 * what a muscle does, what it feels like, what it is called clinically -- is
 * good and worth reading, and it is the wrong thing in a three-hundred-pixel
 * column that somebody opened in order to find out how their own hip is doing.
 * With a session loaded it is lifted out and handed to the lab, which is a
 * screen rather than a column and is where reading belongs. With no session
 * loaded it stays exactly where it was.
 *
 * Built by watching the application's own render rather than by forking
 * `ui.js`, so upstream stays byte-identical and a re-sync stays a copy. Every
 * class name is prefixed -- see the note in `charts.js` for what happens when
 * one is not.
 */
import { CHART_CSS, bar, chip, group, showValue, spark, stat, verdictChip,
         verdictLane, wireCharts } from './charts.js';
import { MEASURED, RESEARCH } from './session.js';
import { saidAbout } from './coach.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const CSS = CHART_CSS + `
.ss-panel{margin:0 0 12px}
.ss-view{width:100%;height:132px;display:block;border-radius:4px;background:#05070d;
  border:1px solid var(--line);margin:0 0 11px}
.ss-kind{display:flex;align-items:baseline;gap:8px;font-size:9.5px;
  letter-spacing:.13em;text-transform:uppercase;color:var(--dim2);margin:0 0 7px}
.ss-kind b{font-weight:500;letter-spacing:.13em;color:var(--acc)}
.ss-panel.ss-research .ss-kind b{color:var(--gold)}
.ss-panel.ss-lookup .ss-kind b{color:var(--dim)}
.ss-note{font-size:11.5px;color:var(--dim2);line-height:1.6;margin:0 0 4px}
.ss-tiers{display:flex;gap:3px}
.ss-tiers i{font-style:normal;flex:1;text-align:center;font-size:9.5px;
  letter-spacing:.08em;border-radius:3px;padding:4px 0;border:1px solid}
.ss-did{display:flex;flex-wrap:wrap;gap:5px}
.ss-did span{position:static;font-size:11px;color:var(--dim);background:var(--glass);
  border:1px solid var(--line);border-radius:3px;padding:3px 8px}
.ss-did span em{font-style:normal;color:var(--dim2);margin-left:5px;font-size:10px}
.ss-tolab{display:block;width:100%;margin:4px 0 0;padding:8px 0;border-radius:3px;
  border:1px solid var(--line);background:var(--glass);color:var(--dim);
  font-size:11px;letter-spacing:.03em;cursor:pointer;text-align:center}
.ss-tolab:hover{color:var(--txt);border-color:var(--line2)}
`;

const view = (id) => `<canvas class="ss-view" data-view="${id}"></canvas>`;
const kind = (label, right = '') =>
  `<div class="ss-kind"><b>${esc(label)}</b><span>${esc(right)}</span></div>`;

function muscleBlock(about, session) {
  const { entry, group: muscles, rank, record } = about;
  const series = session.history(entry.from);
  const chips = [];
  if (rank) chips.push(chip(`${ordinal(rank.place)} of ${rank.of}`));
  if (series) chips.push(verdictChip(series));

  const parts = [kind('Measured this class', session.date), view(record.id),
                 stat(entry.value.toFixed(1), entry.unit, chips)];
  if (series) parts.push(spark(series, { id: `m${record.id}` }));
  /* An empty slot for the coach's verdicts on the same dates. Filled in when
   * the readings arrive, because they come from the studio's record and not
   * from the bundle -- a measurement and a judgement are fetched separately so
   * nothing downstream can mistake one for the other. */
  parts.push(`<div data-lane="${esc(record?.name?.en ?? '')}"></div>`);

  // Where it sits among the session's other groups: the one comparison this
  // measurement genuinely supports, since both halves came off one video.
  const ranked = session.ranked();
  if (ranked.length > 1) {
    parts.push(group('This class, by effort', ranked.map((g) => bar(
      g.group, showValue(g.value, g.unit), g.share,
      g.group !== muscles?.group)).join('')));
  }
  // The joints the same session measured an angle at: a moment and an angle at
  // one joint are two views of one movement.
  const joints = session.jointsOf(entry.from);
  if (joints.length) {
    parts.push(group('Angles at that joint, this class', joints.map((j) => bar(
      j.name.replace(/_/g, ' '), showValue(j.value, j.unit),
      Math.min(1, j.value / 180), true)).join('')));
  }
  if (muscles?.members?.length) {
    parts.push(group(`Carries the same number (${muscles.members.length})`,
      `<p class="ss-note">${esc(muscles.members.map((m) => m.name).join(', '))}</p>`));
  }
  return `<div class="ss-panel ss-measured">${parts.join('')}</div>`;
}

function lookupBlock(about, session) {
  const { kind: what, record, joint, group: muscles } = about;
  const parts = [kind(what === 'nerve' ? 'Supplies something measured'
                                       : 'Meets something measured'),
                 view(record.id)];

  if (what === 'bone' && joint) {
    const sides = session.jointPair(joint.name);
    if (sides.length) {
      parts.push(group('Angles measured here, this class', sides.map((q) => bar(
        q.name.replace(/_/g, ' '), showValue(q.value, q.unit),
        Math.min(1, q.value / 180))).join('')));
      const withHistory = sides
        .map((q) => [q, session.history(q.name)])
        .find(([, h]) => h && h.points.length > 1);
      if (withHistory) {
        const [q, series] = withHistory;
        parts.push(group(`${q.name.replace(/_/g, ' ')}, over time`,
          spark(series, { id: `b${record.id}` })
          + `<div class="ss-stat"><span class="ss-chips">${
             verdictChip(series)}</span></div>`));
      }
    }
  } else if (muscles) {
    parts.push(stat(muscles.value.toFixed(1), muscles.unit, [chip(muscles.group)]));
    const series = session.history(`${muscles.group} peak moment`);
    if (series) parts.push(spark(series, { id: `n${record.id}` }));
    parts.push(group(`Muscles it supplies (${muscles.members.length})`,
      `<p class="ss-note">${esc(muscles.members.map((m) => m.name).join(', '))}</p>`));
  }
  parts.push(`<p class="ss-note">No number was produced for this ${esc(what)}
    itself, and none can be.</p>`);
  return `<div class="ss-panel ss-lookup">${parts.join('')}</div>`;
}

function brainBlock(about, session) {
  const { record, claims, tiers } = about;
  const bars = tiers.map((t) =>
    `<i style="border-color:${t.color};color:${t.color}">${t.tier} × ${t.n}</i>`).join('');
  const raised = new Map();
  for (const claim of claims) {
    for (const exercise of claim.from) raised.set(exercise.key, exercise);
  }
  const did = [...raised.values()].map((x) => `<span>${esc(x.name)}${
    x.seconds ? `<em>${Math.round(x.seconds / 60)} min</em>` : ''}</span>`).join('');

  return `<div class="ss-panel ss-research">
    ${kind('From the exercises done')}
    ${view(record.id)}
    ${stat(String(claims.length), claims.length === 1 ? 'claim' : 'claims',
           [chip(`${raised.size} exercise${raised.size === 1 ? '' : 's'}`)])}
    ${group('Strength of the evidence', `<div class="ss-tiers">${bars}</div>`)}
    ${group('Raised by', `<div class="ss-did">${did}</div>`)}
    <p class="ss-note">A count of published claims about these exercises.
      Nothing here measured a brain.</p>
  </div>`;
}

function nothingBlock(record) {
  return `<div class="ss-panel ss-lookup">
    ${kind('Not measured')}
    ${record ? view(record.id) : ''}
    <p class="ss-note">Nothing in this class produced a measurement that reaches
      here. That is not zero effort — it means no reading exists.</p>
  </div>`;
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

/* ------------------------------------------------------------------- mount */

export function attachPanel(session, nw, hooks = {}) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const body = document.getElementById('panelBody');
  if (!body) return () => {};

  /* Which selection the column has already been written for.
   *
   * The guard this replaces asked the DOM — "is there an `.ss-panel` inside
   * `.detail` yet" — and the answer was always no, because the block was not
   * going inside `.detail`: see the anchor below. So every insertion was a
   * childList mutation inside the observed panel, the observer ran `paint`
   * again, and `paint` inserted again. Observer callbacks are *microtasks*, and
   * a microtask that queues another one never gives the event loop a turn: no
   * animation frame, no timer, no render, the DOM growing by one reading block
   * per iteration until the tab is killed for memory. That is the whole of "I
   * click on one body part and it is stuck, my laptop is lagging so hard, I had
   * to close the tab" — not the renders, which had already been paced.
   *
   * Recorded rather than read back, so it cannot be defeated again by content
   * landing somewhere the query does not look. It is still checked against the
   * DOM as well, because `renderPanel` rebuilds this column from scratch and
   * the block has to be written again when it does. */
  let painted = null;
  const paint = () => {
    const detail = body.querySelector('.detail');
    if (!detail) { painted = null; return; }
    const id = nw.app.selected;
    if (id == null) { painted = null; return; }
    if (painted === id && detail.querySelector('.ss-panel')) return;

    /* Deaf to its own writing. The guard above is what stops the loop; this is
     * what stops the queue of self-inflicted records from being delivered at
     * all, so the cost of one selection is one pass rather than one pass and a
     * dozen callbacks that each decide to do nothing. `takeRecords` empties
     * what was queued before the disconnect took effect. */
    observer.disconnect();
    try { write(); } finally { observer.takeRecords(); watch(); }
  };

  /* Split out only so the reconnect above can be a `finally`. A throw anywhere
   * in here — a record with no name, a hook that is not there — used to be
   * survivable; with the observer switched off around it, it would leave this
   * column dead for the rest of the session. */
  const write = () => {
    const detail = body.querySelector('.detail');
    const id = nw.app.selected;
    /* Lift the application's writing out of the column. The name, the layer and
     * the FMA line stay: they say what is being looked at. */
    const prose = [...detail.querySelectorAll('.blk, .empty')];
    const carried = prose.map((el) => el.outerHTML).join('');
    for (const el of prose) el.remove();

    const about = session.about(id);
    const record = session.registry.byId.get(+id);
    const html = !about ? nothingBlock(record)
      : about.tier === MEASURED ? muscleBlock(about, session)
      : about.tier === RESEARCH ? brainBlock(about, session)
      : lookupBlock(about, session);

    /* Inside `.detail`, always.
     *
     * `.dwhere` and `.dname` are in `.shead`, which is a *sibling* of `.detail`
     * and not a descendant, so neither of those two lookups could ever match —
     * and the fallback, `detail.insertAdjacentHTML('afterend', …)`, puts the
     * block outside the column rather than at the top of it. Between them they
     * meant that any structure without a role chip — which is every structure
     * outside an exercise — had its whole reading inserted as a sibling of the
     * scrolling column, where the guard could not see it either. */
    const anchor = detail.querySelector('.rolechip');
    const button = carried
      ? '<button type="button" class="ss-tolab">Read about this in the lab</button>' : '';
    /* What the coach said about this structure sits with the measurements, in
     * its own treatment: it is a fourth kind of claim, and it carries who said
     * it and when because that is the whole of its authority. */
    /* Reading only. Writing about a structure happens in the one panel that
     * owns it -- selecting a muscle used to put a second, different note form
     * in here as well, so the same muscle had two boxes asking for the same
     * thing in two different shapes. */
    const name = record?.name?.en ?? '';
    const block = html + saidAbout(name) + button;
    if (anchor) anchor.insertAdjacentHTML('afterend', block);
    else detail.insertAdjacentHTML('afterbegin', block);
    painted = id;

    /* The verdict lane, once it has been fetched. It lands under the measured
     * line on the same date axis and never alters it: the number came off a
     * camera and the verdict came off a person. */
    const slot = detail.querySelector('[data-lane]');
    if (slot && hooks.readings) {
      hooks.readings(record).then((past) => {
        if (!past || !slot.isConnected) return;
        const dates = (session.history(about?.entry?.from)?.points ?? [])
          .map((p) => p.date);
        slot.innerHTML = verdictLane(past, dates);
      }).catch(() => { /* no studio record behind this viewer */ });
    }

    hooks.onProse?.(carried, id, record);
    /* The structure is selected; the box to say something about it opens now,
     * without a toggle and without a second click. */
    hooks.onStructure?.(record, id);
    wireCharts(detail);
    drawViews(detail, nw);
    detail.querySelector('.ss-tolab')
      ?.addEventListener('click', () => hooks.openLab?.(id));
  };

  const watch = () => observer.observe(body, { childList: true, subtree: true });
  const observer = new MutationObserver(paint);
  watch();
  paint();
  return () => observer.disconnect();
}

/** In the viewport, and big enough to draw into. */
function onScreen(canvas) {
  const box = canvas.getBoundingClientRect();
  return box.width > 0 && box.height > 0
    && box.bottom > 0 && box.top < (window.innerHeight || 0);
}

/** How many scene renders one panel may spend before it gives up on a layer. */
const VIEW_TRIES = 24;

/**
 * Render the chosen structure into the panel's own canvas: one at a time, one a
 * frame, and only what is on the screen.
 *
 * `renderStructureInto` draws from the live scene, so the small picture and the
 * big one can never show different things. It returns null while the structure's
 * meshes are still arriving — selecting something in a hidden layer turns that
 * layer on and the file comes over the network some time later — so this retries
 * rather than leaving a black rectangle, which is what the first version did and
 * what it looked like.
 *
 * What it costs is the reason for all the pacing below. Each call ends in
 * `readRenderTargetPixels`, which is a pipeline stall by construction: it blocks
 * until everything already queued has finished drawing. That is a fair price for
 * one thumbnail. It was being paid for *every* pending canvas in one synchronous
 * burst, and the whole burst was repeated every 400 ms up to twenty-four times if
 * any of them had not come back — so one selection could spend dozens of full
 * scene renders and dozens of stalls back to back, with nothing in between for
 * the browser to do.
 *
 * That was not what froze the coach view — the repaint loop in `attachPanel` was,
 * and it is fixed where it was — but it is what made a click on a body part cost
 * seconds rather than one frame, and it would have been the next thing to.
 *
 * So: one canvas per frame rather than all of them at once; only canvases
 * actually in the viewport, because a thumbnail scrolled out of the column costs
 * exactly as much to draw as one being looked at; and a retry that backs off
 * instead of hammering, because what it is waiting for is a file arriving over
 * the network and that does not happen sooner for being asked more often.
 */
function drawViews(root, nw) {
  /* One loop per column. A new selection repaints the column and calls this
   * again, and the loop the previous selection left waiting on a layer would
   * otherwise still be running beside it, drawing into canvases that are about
   * to be replaced. The newest call takes the token; older loops see that it is
   * no longer theirs and stop. */
  const run = (root.__viewRun = (root.__viewRun ?? 0) + 1);
  const pending = () => root.querySelector('canvas[data-view]:not([data-drawn])');
  const next = () => [...root.querySelectorAll('canvas[data-view]:not([data-drawn])')]
    .find(onScreen);

  /* Two budgets, because the two things this waits for cost different amounts.
   *
   * A *render* is a full scene render into an offscreen buffer ending in
   * `readRenderTargetPixels` — a pipeline stall — so the attempts that spend one
   * are counted and capped. Waiting for a canvas to be scrolled into view spends
   * a `querySelector`, so it is not: capping it meant a panel open for a minute
   * had used up its allowance while doing nothing, and a thumbnail the reader
   * then scrolled down to was never drawn. That poll ends when the column leaves
   * the document, or when a newer selection takes the token. */
  const step = (tries, wait) => {
    if (run !== root.__viewRun || !root.isConnected) return;
    const canvas = next();
    if (!canvas) {
      if (pending()) setTimeout(() => step(tries, wait), 700);
      return;
    }
    if (tries >= VIEW_TRIES) return;
    const box = canvas.getBoundingClientRect();
    let drawn = null;
    try {
      drawn = nw.renderStructureInto(canvas, box.width, box.height,
                                     +canvas.dataset.view, { alone: true });
    } catch (error) {
      console.warn('[session] could not draw', canvas.dataset.view, error);
      canvas.dataset.drawn = 'failed';
      requestAnimationFrame(() => step(tries + 1, wait));
      return;
    }
    if (drawn) {
      canvas.dataset.drawn = '1';
      // a frame between two stalls, so the page is not held for the whole run
      requestAnimationFrame(() => step(tries + 1, 400));
      return;
    }
    /* Not drawn: its layer has not arrived. Asking again immediately would spend
     * a full scene render finding that out, so this backs off — what it is
     * waiting for is a file coming over the network, which does not arrive
     * sooner for being asked more often. */
    setTimeout(() => step(tries + 1, Math.min(wait * 2, 6400)), wait);
  };
  requestAnimationFrame(() => step(0, 400));
}

export const _internals = { muscleBlock, lookupBlock, brainBlock, nothingBlock,
                            ordinal };
