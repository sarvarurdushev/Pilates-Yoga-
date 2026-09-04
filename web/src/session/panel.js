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
         wireCharts } from './charts.js';
import { MEASURED, RESEARCH } from './session.js';
import { saidAbout, wireWriter, writer } from './coach.js';

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

  let writing = false;
  const paint = () => {
    if (writing) return;
    const detail = body.querySelector('.detail');
    if (!detail || detail.querySelector('.ss-panel')) return;
    const id = nw.app.selected;
    if (id == null) return;

    /* Lift the application's writing out of the column. The name, the layer and
     * the FMA line stay: they say what is being looked at. */
    const prose = [...detail.querySelectorAll('.blk, .empty')];
    const carried = prose.map((el) => el.outerHTML).join('');
    writing = true;
    for (const el of prose) el.remove();

    const about = session.about(id);
    const record = session.registry.byId.get(+id);
    const html = !about ? nothingBlock(record)
      : about.tier === MEASURED ? muscleBlock(about, session)
      : about.tier === RESEARCH ? brainBlock(about, session)
      : lookupBlock(about, session);

    const anchor = detail.querySelector('.rolechip')
                ?? detail.querySelector('.dwhere')
                ?? detail.querySelector('.dname');
    const button = carried
      ? '<button type="button" class="ss-tolab">Read about this in the lab</button>' : '';
    /* What the coach said about this structure sits with the measurements, in
     * its own treatment: it is a fourth kind of claim, and it carries who said
     * it and when because that is the whole of its authority. */
    const name = record?.name?.en ?? '';
    (anchor ?? detail).insertAdjacentHTML(
      'afterend',
      html + saidAbout(name) + writer(name, (record?.fma ?? [])[0] ?? '') + button);
    writing = false;

    hooks.onProse?.(carried, id, record);
    wireWriter(detail);
    wireCharts(detail);
    drawViews(detail, nw);
    detail.querySelector('.ss-tolab')
      ?.addEventListener('click', () => hooks.openLab?.(id));
  };

  const observer = new MutationObserver(paint);
  observer.observe(body, { childList: true, subtree: true });
  paint();
  return () => observer.disconnect();
}

/**
 * Render the chosen structure into the panel's own canvas.
 *
 * `renderStructureInto` draws from the live scene, so the small picture and the
 * big one can never show different things. It returns null when the structure's
 * meshes are not loaded yet -- selecting something in a hidden layer turns that
 * layer on and the file arrives over the network some time later -- so this
 * retries rather than leaving a black rectangle, which is what the first version
 * did and what it looked like.
 */
function drawViews(root, nw, tries = 0) {
  const pending = [...root.querySelectorAll('canvas[data-view]')]
    .filter((c) => !c.dataset.drawn);
  if (!pending.length) return;
  for (const canvas of pending) {
    const box = canvas.getBoundingClientRect();
    if (!box.width) continue;
    let drawn = null;
    try {
      drawn = nw.renderStructureInto(canvas, box.width, box.height,
                                     +canvas.dataset.view, { alone: true });
    } catch (error) {
      console.warn('[session] could not draw', canvas.dataset.view, error);
      canvas.dataset.drawn = 'failed';
      continue;
    }
    if (drawn) canvas.dataset.drawn = '1';
  }
  if (tries < 24 && root.querySelector('canvas[data-view]:not([data-drawn])')) {
    setTimeout(() => drawViews(root, nw, tries + 1), 400);
  }
}

export const _internals = { muscleBlock, lookupBlock, brainBlock, nothingBlock,
                            ordinal };
