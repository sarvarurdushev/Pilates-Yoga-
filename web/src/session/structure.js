/**
 * A reading of whatever is on the screen, written the coach's way.
 *
 * Three things this had wrong and now does not:
 *
 * 1. **It took the explore panel's place.** Selecting a muscle hid the panel
 *    the coach was reading and left no obvious way back. It now has its own
 *    space beside it and never touches it; folding the panel is a separate
 *    control the coach presses on purpose.
 * 2. **Every muscle asked the same five questions.** They do not raise the same
 *    questions, and a person who has taught for fifteen years does not need a
 *    form telling them what to look at. The checks are now the coach's own
 *    words -- suggested, editable, ignorable -- and whatever they wrote about
 *    this structure last time comes back as a chip.
 * 3. **It shouted.** A yellow banner on every nerve is noise; the one sentence
 *    worth saying sits in the same grey as everything else.
 */
import { SCALE, axesFor } from './axes.js';
import { scoreLines } from './charts.js';
import { GLOSSARY_CSS, explain, shutTerm, wireTerms } from './glossary.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const CSS = `
/* Its own column, to the left of the explore panel rather than on top of it.
 * Narrow enough that both fit, and it falls back to the panel's slot only when
 * the panel itself has been folded away. */
/* Clear of the panel *and* of the rail the panel is inset by.
 *
 * The panel sits at right:62px, not against the window edge, so offsetting this
 * card by the panel's own width plus a small margin lands it 38 pixels inside the
 * panel -- measured, with the structure's name, its layer line and its FMA number
 * underneath it. The application's own furniture already offsets by the panel
 * width plus 74 for exactly this reason: 62 for the rail, 12 for the gap. */
#ss-struct{position:fixed;z-index:8;top:calc(var(--barh) - 6px);bottom:14px;
  right:calc(var(--panelw) + 74px);width:310px;display:flex;flex-direction:column;
  min-height:0;border-radius:3px;border:1px solid var(--line2);
  background:linear-gradient(200deg,rgba(8,15,25,.95) 0%,rgba(4,8,14,.98) 100%);
  box-shadow:0 30px 90px rgba(0,0,0,.66);
  backdrop-filter:var(--blur);-webkit-backdrop-filter:var(--blur)}
body.ss-folded #ss-struct{right:14px}
@media(max-width:1240px){#ss-struct{right:14px;z-index:10}}
@media(max-width:900px){#ss-struct{right:0;left:0;bottom:0;top:auto;width:auto;
  height:72vh;border-radius:0}}
#ss-struct .sx-head{flex:none;padding:13px 15px 11px;
  border-bottom:1px solid var(--hair);position:relative}
#ss-struct .sx-kind{font-size:9.5px;letter-spacing:.16em;text-transform:uppercase;
  color:var(--dim2);margin:0 0 4px}
#ss-struct h3{margin:0;font-size:15px;font-weight:500;color:var(--txt);
  line-height:1.2;padding-right:22px}
#ss-struct .sx-who{font-size:11px;color:var(--dim2);margin:4px 0 0}
#ss-struct .sx-note{font-size:11px;color:var(--dim2);line-height:1.5;
  margin:8px 0 0}
#ss-struct .sx-shut{position:absolute;right:9px;top:11px;width:22px;height:22px;
  border-radius:3px;border:1px solid var(--line2);background:var(--glass);
  color:var(--dim);cursor:pointer;font-size:13px;line-height:1;padding:0}
#ss-struct .sx-shut:hover{color:var(--txt);border-color:var(--acc)}
#ss-struct .sx-body{overflow:auto;flex:1;min-height:0;padding:13px 15px 18px}
#ss-struct .sx-foot{flex:none;border-top:1px solid var(--hair);
  padding:10px 15px 12px;background:rgba(2,5,10,.5);display:flex;gap:8px;
  align-items:center;flex-wrap:wrap}
#ss-struct .sx-foot button{padding:7px 12px;border-radius:3px;font:inherit;
  font-size:12px;cursor:pointer;border:1px solid var(--line2);
  background:var(--glass);color:var(--dim)}
#ss-struct .sx-foot button.sx-primary{background:var(--acc);border-color:var(--acc);
  color:#04121f;font-weight:600}
#ss-struct .sx-foot button:disabled{opacity:.5;cursor:default}
#ss-struct .sx-said{font-size:11px;color:var(--dim2);flex:1 0 100%;min-width:0;
  line-height:1.45;max-height:40px;overflow:auto}
#ss-struct .sx-said:empty{display:none}
#ss-struct .sx-said.sx-good{color:var(--acc)}
#ss-struct .sx-said.sx-bad{color:var(--gold)}

#ss-struct label{display:block;font-size:9.5px;letter-spacing:.12em;
  text-transform:uppercase;color:var(--dim2);margin:0 0 6px}
#ss-struct textarea,#ss-struct input{width:100%;box-sizing:border-box;
  padding:7px 9px;border-radius:3px;font:inherit;font-size:12px;
  background:#05070d;border:1px solid var(--line);color:var(--txt)}
#ss-struct textarea{min-height:64px;resize:vertical;line-height:1.5}
#ss-struct input::placeholder,#ss-struct textarea::placeholder{color:var(--dim2)}
#ss-struct input:focus,#ss-struct textarea:focus{outline:0;border-color:var(--acc)}

#ss-struct .sx-chips{display:flex;flex-wrap:wrap;gap:5px;margin:0 0 4px}
#ss-struct .sx-chips button{padding:4px 9px;border-radius:11px;font:inherit;
  font-size:11px;cursor:pointer;border:1px dashed var(--line2);
  background:transparent;color:var(--dim2);line-height:1.3}
#ss-struct .sx-chips button:hover{color:var(--txt);border-color:var(--acc);
  border-style:solid}
#ss-struct .sx-chips button.sx-mine{border-style:solid;color:var(--dim)}
#ss-struct .sx-hint{font-size:10.5px;color:var(--dim2);line-height:1.5;
  margin:0 0 10px}

#ss-struct .sx-check{padding:9px 10px;margin:0 0 6px;border-radius:3px;
  background:var(--glass);border:1px solid var(--line)}
#ss-struct .sx-check .sx-top{display:flex;gap:7px;align-items:flex-start}
#ss-struct .sx-check .sx-label{flex:1;min-width:0;font-size:12.5px;
  color:var(--txt);line-height:1.35;background:transparent;border:0;padding:2px 0}
#ss-struct .sx-check .sx-label:focus{outline:0;border-bottom:1px solid var(--acc)}
#ss-struct .sx-drop{flex:none;width:20px;height:20px;border-radius:3px;
  border:1px solid transparent;background:transparent;color:var(--dim2);
  cursor:pointer;font-size:13px;line-height:1;padding:0}
#ss-struct .sx-drop:hover{color:var(--gold);border-color:var(--line2)}
#ss-struct .sx-verdicts{display:flex;gap:4px;margin:7px 0 0}
#ss-struct .sx-verdicts button{flex:1;padding:5px 2px;border-radius:3px;
  font:inherit;font-size:11px;cursor:pointer;border:1px solid var(--line2);
  background:transparent;color:var(--dim2)}
#ss-struct .sx-verdicts button:hover{color:var(--txt)}
#ss-struct .sx-verdicts button[aria-pressed=true]{color:var(--txt)}
#ss-struct .sx-verdicts button[data-v=fine][aria-pressed=true]{
  border-color:var(--acc);background:rgba(90,169,230,.15)}
#ss-struct .sx-verdicts button[data-v=watch][aria-pressed=true]{
  border-color:var(--gold);background:rgba(233,180,92,.14)}
#ss-struct .sx-verdicts button[data-v=problem][aria-pressed=true]{
  border-color:#e2685f;background:rgba(226,104,95,.16)}
#ss-struct .sx-check textarea{min-height:34px;margin-top:6px;font-size:11.5px}
#ss-struct .sx-ask{display:block;font-size:11.5px;color:var(--dim);
  line-height:1.6;margin:6px 0 9px}
/* One question open at a time. Six expanded cards is a wall, and a wall is a
   thing you skim rather than answer. */
#ss-struct .sx-q{margin:0 0 5px;border-radius:3px;border:1px solid var(--line);
  background:var(--glass);overflow:hidden}
#ss-struct .sx-q.sx-on{border-color:var(--acc)}
#ss-struct .sx-qhead{width:100%;display:flex;gap:8px;align-items:center;
  padding:10px 11px;font:inherit;font-size:12.5px;text-align:left;
  background:transparent;border:0;color:var(--txt);cursor:pointer;
  line-height:1.35}
#ss-struct .sx-qhead:hover{background:rgba(90,169,230,.06)}
#ss-struct .sx-qhead .sx-qt{flex:1;min-width:0}
#ss-struct .sx-qhead .sx-qs{flex:none;font-size:11px;color:var(--dim2);
  font-variant-numeric:tabular-nums}
#ss-struct .sx-qhead .sx-qs.sx-set{color:var(--acc);font-weight:600}
#ss-struct .sx-qhead .sx-caret{flex:none;color:var(--dim2);font-size:10px}
#ss-struct .sx-qbody{padding:0 11px 11px;display:none}
#ss-struct .sx-q.sx-on .sx-qbody{display:block}
#ss-struct .sx-focus{margin:0 0 11px;padding:10px 12px;border-radius:3px;
  border:1px solid rgba(90,169,230,.4);background:rgba(90,169,230,.07);
  font-size:12px;line-height:1.55;color:var(--txt)}
#ss-struct .sx-focus b{color:var(--acc);font-weight:600}
#ss-struct .sx-focus span{display:block;font-size:10.5px;color:var(--dim2);
  margin-top:3px}
#ss-struct .sx-clin{margin:8px 0 0;font-size:10.5px;color:var(--dim2);
  line-height:1.5}
#ss-struct .sx-clin summary{cursor:pointer;color:var(--dim2);font-size:10px;
  letter-spacing:.1em;text-transform:uppercase;list-style:none}
#ss-struct .sx-clin summary::-webkit-details-marker{display:none}
#ss-struct .sx-clin summary:hover{color:var(--txt)}
#ss-struct .sx-clin p{margin:6px 0 0;font-size:11px;line-height:1.55}
#ss-struct .sx-done{font-size:10.5px;color:var(--dim2);margin:10px 0 0}
#ss-struct .sx-cited{border-left:2px solid var(--line2);padding-left:7px}
#ss-struct .sx-bridge{border-color:rgba(90,169,230,.4)}
#ss-struct .sx-scale{display:flex;gap:2px;margin:6px 0 0}
#ss-struct .sx-scale button{flex:1;padding:5px 0;border-radius:2px;font:inherit;
  font-size:10.5px;cursor:pointer;border:1px solid var(--line2);
  background:transparent;color:var(--dim2);min-width:0}
#ss-struct .sx-scale button:hover{color:var(--txt)}
#ss-struct .sx-scale button[aria-pressed=true]{background:var(--acc);
  border-color:var(--acc);color:#04121f;font-weight:600}
#ss-struct .sx-ends{display:flex;justify-content:space-between;gap:8px;
  margin:4px 0 0;font-size:9.5px;color:var(--dim2);line-height:1.4}
#ss-struct .sx-ends span{max-width:47%}
#ss-struct .sx-ends span:last-child{text-align:right}
#ss-struct .sx-shared{margin:15px 0 0;padding:11px 12px;border-radius:3px;
  border:1px solid rgba(90,169,230,.35);background:rgba(90,169,230,.06)}
#ss-struct .sx-shared label{margin:0 0 3px;color:var(--acc)}
#ss-struct .sx-shared p{margin:0 0 7px;font-size:10.5px;color:var(--dim2);
  line-height:1.5}
#ss-struct .sx-why{font-size:10.5px;color:var(--dim2);line-height:1.55;
  margin:0 0 12px;padding:0 0 10px;border-bottom:1px solid var(--hair)}
#ss-struct .sx-add{width:100%;padding:7px;border-radius:3px;font:inherit;
  font-size:11.5px;cursor:pointer;border:1px dashed var(--line2);
  background:transparent;color:var(--dim2);margin:2px 0 0}
#ss-struct .sx-add:hover{color:var(--txt);border-color:var(--acc)}
#ss-struct .sx-none{font-size:11.5px;color:var(--dim2);line-height:1.65;margin:0}

#ss-struct .sx-past{margin:0 0 12px;padding:9px 11px;border-radius:3px;
  border:1px solid var(--line);background:rgba(90,169,230,.05)}
#ss-struct .sx-past h5{margin:0 0 6px;font-size:9.5px;letter-spacing:.12em;
  text-transform:uppercase;color:var(--dim2);font-weight:500}
#ss-struct .sx-run{display:flex;gap:6px;align-items:baseline;font-size:11px;
  color:var(--dim);margin:0 0 3px;line-height:1.4}
#ss-struct .sx-run em{font-style:normal;color:var(--txt);flex:1;min-width:0}
#ss-struct .sx-dots{display:flex;gap:3px;flex:none}
#ss-struct .sx-dots span{width:6px;height:6px;border-radius:50%;
  background:rgba(90,169,230,.35);display:block}
#ss-struct .sx-dots span.watch{background:var(--gold)}
#ss-struct .sx-dots span.problem{background:#e2685f}

/* The explore dock, folded to a strip the coach can always press back open. */
#ss-dock{position:fixed;z-index:11;right:14px;top:calc(var(--barh) - 6px);
  padding:11px 6px;border-radius:3px;border:1px solid var(--line2);
  background:rgba(6,11,19,.92);color:var(--dim);cursor:pointer;
  writing-mode:vertical-rl;font:inherit;font-size:9.5px;letter-spacing:.16em;
  text-transform:uppercase;backdrop-filter:var(--blur)}
#ss-dock:hover{color:var(--txt);border-color:var(--acc)}
#panel.ss-away{display:none}
#ss-fold{flex:none;width:24px;background:transparent;border:0;color:var(--dim2);
  cursor:pointer;font-size:13px;line-height:1;padding:0}
#ss-fold:hover{color:var(--txt)}
`;

let styled = false;
function styles() {
  if (styled) return;
  styled = true;
  const tag = document.createElement('style');
  tag.textContent = CSS + GLOSSARY_CSS;
  document.head.appendChild(tag);
}

const get = async (path) => {
  const response = await fetch(path, { credentials: 'same-origin' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
};

const post = async (path, payload) => {
  const response = await fetch(path, {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
};

/**
 * The coach's readings for one structure, cached for the life of the page.
 *
 * The measurement panel wants them to draw its verdict lane, and this panel
 * wants them for its runs. Fetching twice on every selection would be two
 * requests for one answer, so they share this.
 */
const readingCache = new Map();

export function readingsFor(username, structure) {
  if (!username || !structure) return Promise.resolve(null);
  const key = `${username}\u0000${structure}`;
  if (!readingCache.has(key)) {
    readingCache.set(key, get('structure-history?' + new URLSearchParams({
      username, structure,
    })).catch(() => null));
  }
  return readingCache.get(key);
}

/** Drop a structure's cached readings, so the next look re-fetches. */
export function forget(username, structure) {
  if (structure) readingCache.delete(`${username}\u0000${structure}`);
  else readingCache.clear();
}

/* --------------------------------------------------------------- the dock */

const FOLDED = 'ss-panel-folded';

/**
 * Fold the explore panel away, and give it back.
 *
 * Only the coach folds it. Nothing else in this file touches the panel: it was
 * hidden automatically once and the way back was not obvious, which is the
 * worst kind of clever.
 */
export function foldable() {
  styles();
  const panel = document.getElementById('panel');
  const tabs = document.getElementById('tabs');
  if (!panel || !tabs || document.getElementById('ss-fold')) return null;

  const strip = document.createElement('button');
  strip.id = 'ss-dock';
  strip.type = 'button';
  strip.hidden = true;
  strip.textContent = 'Show panel';
  strip.title = 'Bring the explore panel back';
  document.body.appendChild(strip);

  const fold = document.createElement('button');
  fold.id = 'ss-fold';
  fold.type = 'button';
  fold.textContent = '›';
  fold.title = 'Fold the panel away — press "Show panel" to bring it back';
  fold.setAttribute('aria-label', 'Fold the panel away');
  tabs.appendChild(fold);

  const set = (away) => {
    panel.classList.toggle('ss-away', away);
    document.body.classList.toggle('ss-folded', away);
    strip.hidden = !away;
    try { localStorage.setItem(FOLDED, away ? '1' : '0'); } catch { /* private */ }
  };
  fold.addEventListener('click', () => set(true));
  strip.addEventListener('click', () => set(false));
  let was = false;
  try { was = localStorage.getItem(FOLDED) === '1'; } catch { /* private */ }
  set(was);
  return { set };
}

/* ------------------------------------------------------------- the panel */

let open = null;
/* The structure the coach closed by hand. The panel is re-offered on every
 * repaint of the detail column, so without this a close lasted until the next
 * mutation and then the panel came back on its own -- and, because opening it
 * closes the pre-class sheet, took the sheet with it. */
let dismissed = null;

/** Open the reading for one structure. Called on every selection. */
export async function show(record, me, username, session = '', context = {}) {
  styles();
  const name = record?.name?.en ?? record?.key ?? '';
  const kind = record?.kind ?? '';
  if (!name || !username) return;
  if (dismissed === name) return;
  dismissed = null;

  const already = document.getElementById('ss-struct');
  if (already && open === name) return;
  already?.remove();
  open = name;
  /* The pre-class sheet shares this column. Selecting a structure means the
   * reading is what the coach wants there now. */
  const bar = document.querySelector('#ss-coach-bar [data-toggle]');
  if (bar?.getAttribute('aria-pressed') === 'true') bar.click();

  const host = document.createElement('div');
  host.id = 'ss-struct';
  host.innerHTML = `<div class="sx-head">
      <p class="sx-kind">Reading…</p><h3>${esc(name)}</h3>
      <button type="button" class="sx-shut" data-shut
        aria-label="Close">&times;</button>
    </div><div class="sx-body"></div>`;
  document.body.appendChild(host);

  const shut = () => {
    host.remove();
    dismissed = name;   // stay shut until they pick something else
    open = null;
    shutTerm();
  };
  host.querySelector('[data-shut]').addEventListener('click', shut);

  let form;
  try {
    form = await get('structure?' + new URLSearchParams({
      username, structure: name, kind, fma: (record?.fma ?? [])[0] ?? '',
    }));
  } catch (error) {
    host.querySelector('.sx-body').innerHTML =
      `<p class="sx-none">${esc(error.message)}</p>`;
    return;
  }
  if (open !== name) return;
  draw(host, form, { me, username, session, name, kind, record, shut, context });
}

function runs(form) {
  const past = form.history;
  if (!past?.count) return '';
  const latest = past.latest;
  return `<div class="sx-past${past.urgent ? ' sx-urgent' : ''}">
      <h5>Written about this before — ${past.count} time${
        past.count === 1 ? '' : 's'}, since ${esc(past.first_on)}</h5>
      ${latest?.note ? `<p class="sx-run"><em>“${esc(latest.note)}”
        — ${esc(latest.by)}, ${esc(latest.made_on)}</em></p>` : ''}
      ${latest?.shared ? `<p class="sx-run" style="color:var(--acc)"><em>To
        them: “${esc(latest.shared)}”</em></p>` : ''}
    </div>`
    + scoreLines(past, { title: 'Scored before' });
}

function draw(host, form, ctx) {
  const head = host.querySelector('.sx-head');
  head.querySelector('.sx-kind').textContent = form.kind_label || form.kind;
  head.insertAdjacentHTML('beforeend',
    `<p class="sx-who">${esc(form.display_name)}</p>`
    + (form.note ? `<p class="sx-note">${esc(form.note)}</p>` : '')
    /* What this one is, in plain words, before any question about it. */
    + `<p class="sx-note" data-what></p>`);
  const what = explain(ctx.record?.key ?? '', ctx.context?.registry);
  const whatEl = head.querySelector('[data-what]');
  if (what.plain) whatEl.textContent = what.plain;
  else whatEl.remove();

  const body = host.querySelector('.sx-body');

  /* The person whose body it is. Charts and the line written for them, and
   * nothing else: the scores, the labels they were scored on, and any note the
   * coach wrote here on purpose. The redaction happened at the server -- there
   * is no branch here that could leak by being got wrong. */
  if (form.mine) {
    /* The same courtesy for the student: the structure names on their own
     * chart are pressable, so "pectoralis major" can become "the chest muscle,
     * here it is". */
    const wire = () => wireTerms(body, ctx.context?.registry,
                                 (id) => ctx.context?.select?.(id));
    body.innerHTML = form.history?.count
      ? scoreLines(form.history, {
          title: `Your coach's readings — ${form.history.count} since ${
            form.history.first_on}`,
          note: 'Scored by your coach, not measured by the camera.',
        })
        + (form.history.shared ?? []).slice().reverse().map((one) =>
          `<div class="sx-past"><h5>${esc(one.date)}</h5>
            <p class="sx-run"><em>${esc(one.text)}</em></p></div>`).join('')
      : '<p class="sx-none">Nothing has been written about this part of you '
        + 'yet.</p>';
    wire();
    return;
  }

  if (!form.open || !form.may_write) {
    body.innerHTML = runs(form) + `<p class="sx-none">${esc(
      !form.open ? form.why
                 : 'You are not this person\u2019s coach, so there is nothing '
                   + 'to write here.')}</p>`;
    return;
  }

  /* The questions for this structure, derived from this structure's own
   * anatomy -- its actions, the muscles the atlas names as its synergists and
   * antagonists, the joint angles the camera measured here. See axes.js. */
  const derived = axesFor(ctx.record, ctx.context ?? {});
  const scored = {};

  /* One question, folded shut. The title carries the anatomy words as buttons,
   * so it is deliberately not escaped -- axes.js built it. */
  const axisRow = (axis, n) => {
    const bare = axis.title.replace(/<[^>]+>/g, '');
    return `<div class="sx-q" data-axis="${esc(axis.key)}"
        data-label="${esc(bare)}">
      <button type="button" class="sx-qhead" data-open aria-expanded="false">
        <span class="sx-qt">${axis.title}</span>
        <span class="sx-qs" data-shown>—</span>
        <span class="sx-caret">▾</span>
      </button>
      <div class="sx-qbody">
        <span class="sx-ask">${axis.plain}</span>
        <div class="sx-scale" role="group" aria-label="${esc(bare)}, 0 to ${SCALE}">
          ${Array.from({ length: SCALE + 1 }, (_, v) =>
            `<button type="button" data-score="${v}" aria-pressed="false">${v}</button>`
          ).join('')}
        </div>
        <p class="sx-ends"><span>0 — ${esc(axis.low)}</span>
          <span>${SCALE} — ${esc(axis.high)}</span></p>
        <textarea data-cnote placeholder="…because? (yours, not theirs)"></textarea>
        ${axis.clinical ? `<details class="sx-clin"><summary>In clinical terms</summary>
          <p>${esc(axis.clinical)}</p></details>` : ''}
      </div>
    </div>`;
  };

  /* Where to start. The lowest thing scored last time, named, at the top --
   * because six questions of equal weight is six questions you skim. */
  const lines = form.history?.lines ?? {};
  const asked = new Set(derived.axes.map((a) => a.key));
  /* Only point at a question that is actually below. A history written before
   * these axes existed carries labels that are not on this form any more, and
   * "start with X" where X is nowhere on the screen is worse than no advice. */
  const worst = Object.entries(lines)
    .filter(([key, l]) => l.latest != null && asked.has(key))
    .sort((a, b) => a[1].latest - b[1].latest)[0];
  const seen = form.history?.count
    ? `<span>${form.history.count} reading${form.history.count === 1 ? '' : 's'}
        since ${esc(form.history.first_on)}.</span>` : '';
  const focus = worst
    ? `<p class="sx-focus">Start with <b>${esc(worst[1].label)}</b> — it was
        ${worst[1].latest} out of ${SCALE} last time, the lowest here.
        ${seen}</p>`
    : form.history?.count
      ? `<p class="sx-focus">Answer whatever you watched. Nothing is required.
          ${seen}</p>`
      : `<p class="sx-focus">First time on this one.
          <span>Answer what you watched. Everything is optional.</span></p>`;

  body.innerHTML = focus
    + derived.axes.map(axisRow).join('')
    + (derived.decision ? `<div class="sx-q sx-on" data-decision-row>
        <button type="button" class="sx-qhead" data-open aria-expanded="true">
          <span class="sx-qt">${esc(derived.decision.title)}</span></button>
        <div class="sx-qbody">
          <span class="sx-ask">${esc(derived.decision.plain ?? '')}</span>
          <div class="sx-opts" data-decision>${derived.decision.options.map(
            ([value, text]) => `<button type="button" data-pick="${esc(value)}"
              aria-pressed="false">${esc(text)}</button>`).join('')}</div>
        </div></div>` : '')
    + (derived.why ? `<p class="sx-done">${esc(derived.why)}</p>` : '')
    + `<label style="margin-top:15px">Anything else you noticed</label>
       <textarea data-free
         placeholder="Yours. The student never sees this."></textarea>
       <label style="margin-top:15px">Your own checks</label>
       <p class="sx-hint">${form.yours
         ? 'What you added here before, plus a few general ones. '
         : 'Only if the questions above missed something. '}Optional.</p>
       <div class="sx-chips">${(form.suggested ?? []).map((label, i) =>
         `<button type="button" data-chip="${esc(label)}"
           class="${i < (form.yours ?? 0) ? 'sx-mine' : ''}">${esc(label)}</button>`
         ).join('')}</div>
       <div data-checks></div>
       <button type="button" class="sx-add" data-add>+ add a check of your own</button>
       ${form.history?.count ? runs(form) : ''}
       <div class="sx-shared">
         <label>A line for ${esc(form.display_name.split(' ')[0] || 'them')}</label>
         <p>The only thing on this reading they will read. The scores reach
           them as a chart; everything else above stays yours.</p>
         <textarea data-shared
           placeholder="e.g. hip flexors are letting go more than last month"></textarea>
       </div>`;

  const fold = (row, open) => {
    row.classList.toggle('sx-on', open);
    row.querySelector('[data-open]').setAttribute('aria-expanded', String(open));
    row.querySelector('.sx-caret').textContent = open ? '▴' : '▾';
  };
  for (const row of body.querySelectorAll('[data-axis]')) {
    const key = row.dataset.axis;
    row.querySelector('[data-open]').addEventListener('click', () => {
      const open = !row.classList.contains('sx-on');
      for (const other of body.querySelectorAll('[data-axis]')) {
        if (other !== row) fold(other, false);
      }
      fold(row, open);
    });
    for (const button of row.querySelectorAll('[data-score]')) {
      button.addEventListener('click', () => {
        const value = Number(button.dataset.score);
        const now = scored[key]?.score === value ? null : value;
        if (now === null) delete scored[key];
        else scored[key] = { score: now, label: row.dataset.label };
        for (const other of row.querySelectorAll('[data-score]')) {
          other.setAttribute('aria-pressed',
                             String(Number(other.dataset.score) === now));
        }
        const shown = row.querySelector('[data-shown]');
        shown.textContent = now === null ? '—' : `${now}/${SCALE}`;
        shown.classList.toggle('sx-set', now !== null);
        /* Answered, so get out of the way and open the next unanswered one.
         * A coach with ninety seconds should not also be doing the scrolling. */
        if (now !== null) {
          const rows = [...body.querySelectorAll('[data-axis]')];
          const next = rows.slice(rows.indexOf(row) + 1)
            .find((r) => !scored[r.dataset.axis]);
          fold(row, false);
          if (next) fold(next, true);
        }
      });
    }
  }
  /* Open the one the focus line points at, or the first. */
  const rows = [...body.querySelectorAll('[data-axis]')];
  const start = worst
    ? rows.find((r) => (lines[r.dataset.axis]?.latest) === worst[1].latest)
    : null;
  if (rows.length) fold(start ?? rows[0], true);

  /* Every anatomy word in a question is a button. */
  wireTerms(body, ctx.context?.registry, (id) => {
    ctx.context?.select?.(id);
  });
  for (const button of body.querySelectorAll('[data-decision] [data-pick]')) {
    button.addEventListener('click', () => {
      for (const other of body.querySelectorAll('[data-decision] [data-pick]')) {
        other.setAttribute('aria-pressed', String(other === button));
      }
    });
  }

  const list = body.querySelector('[data-checks]');
  const add = (label = '') => {
    const row = document.createElement('div');
    row.className = 'sx-check';
    row.innerHTML = `<div class="sx-top">
        <input class="sx-label" data-label value="${esc(label)}"
          placeholder="What did you watch?">
        <button type="button" class="sx-drop" data-drop
          aria-label="Remove this check">&times;</button>
      </div>
      <div class="sx-scale" role="group" aria-label="0 to ${SCALE}">
        ${Array.from({ length: SCALE + 1 }, (_, n) =>
          `<button type="button" data-score="${n}" aria-pressed="false">${n}</button>`
        ).join('')}</div>
      <textarea data-cnote placeholder="…because?"></textarea>`;
    list.appendChild(row);
    row.querySelector('[data-drop]').addEventListener('click', () => row.remove());
    for (const button of row.querySelectorAll('[data-score]')) {
      button.addEventListener('click', () => {
        const on = button.getAttribute('aria-pressed') !== 'true';
        for (const other of row.querySelectorAll('[data-score]')) {
          other.setAttribute('aria-pressed', String(on && other === button));
        }
      });
    }
    if (!label) row.querySelector('[data-label]').focus();
    return row;
  };
  for (const chip of body.querySelectorAll('[data-chip]')) {
    chip.addEventListener('click', () => { add(chip.dataset.chip); chip.remove(); });
  }
  body.querySelector('[data-add]').addEventListener('click', () => add());

  host.insertAdjacentHTML('beforeend', `<div class="sx-foot">
    <button type="button" class="sx-primary" data-save>Save</button>
    <button type="button" data-close>Close</button>
    <span class="sx-said"></span></div>`);
  const said = host.querySelector('.sx-said');
  const tell = (text, tone = '') => {
    said.className = `sx-said${tone ? ` sx-${tone}` : ''}`;
    said.textContent = text;
  };
  host.querySelector('[data-close]').addEventListener('click', ctx.shut);
  host.querySelector('[data-save]').addEventListener('click', async () => {
    const button = host.querySelector('[data-save]');
    button.disabled = true;
    tell('Saving…');

    const checks = [];
    for (const row of body.querySelectorAll('[data-axis]')) {
      const key = row.dataset.axis;
      const note = row.querySelector('[data-cnote]').value.trim();
      const mark = scored[key];
      if (mark === undefined && !note) continue;
      checks.push({ axis: key, label: row.dataset.label,
                    score: mark?.score ?? null, note });
    }
    for (const row of list.querySelectorAll('.sx-check')) {
      const label = row.querySelector('[data-label]').value.trim();
      if (!label) continue;
      const picked = row.querySelector('[data-score][aria-pressed=true]');
      checks.push({ label, axis: '',
                    score: picked ? Number(picked.dataset.score) : null,
                    note: row.querySelector('[data-cnote]').value.trim() });
    }
    const decision = body.querySelector('[data-decision] [aria-pressed=true]');
    if (decision) {
      checks.push({ axis: 'action', label: 'What you did',
                    score: null, note: decision.textContent.trim() });
    }

    try {
      const out = await post('evaluate-structure', {
        username: ctx.username, structure: ctx.name, kind: ctx.kind,
        fma: (ctx.record?.fma ?? [])[0] ?? '', session: ctx.session,
        note: body.querySelector('[data-free]').value.trim(),
        shared: body.querySelector('[data-shared]').value.trim(),
        checks,
      });
      form.history = out.history;
      forget(ctx.username, ctx.name);
      const average = out.evaluation.average;
      tell(average == null ? 'Saved.'
        : `Saved. ${average} out of ${SCALE} across ${
            out.evaluation.checks.filter((c) => c.score !== null).length
          } questions.`, 'good');
      body.querySelector('.sx-past')?.remove();
      body.insertAdjacentHTML('afterbegin', runs(form));
    } catch (error) {
      tell(error.message, 'bad');
    }
    button.disabled = false;
  });
}

/** Forget what is open, so a new body starts clean. */
export function reset() {
  document.getElementById('ss-struct')?.remove();
  open = null;
  dismissed = null;
  forget('');
}

/* ---------------------------------------------------------- the way back */

const LIST_CSS = `
#ss-notes{position:fixed;inset:0;z-index:150;display:flex;align-items:center;
  justify-content:center;background:rgba(2,5,10,.8);backdrop-filter:blur(3px)}
#ss-notes .nx-box{width:min(660px,94vw);max-height:86vh;display:flex;
  flex-direction:column;border-radius:5px;padding:20px 22px;
  border:1px solid var(--line2);
  background:linear-gradient(200deg,rgba(10,17,28,.98),rgba(5,9,16,.99));
  box-shadow:0 40px 120px rgba(0,0,0,.6)}
#ss-notes h2{margin:0 0 3px;font-size:16px;font-weight:500;color:var(--txt)}
#ss-notes .nx-sub{margin:0 0 14px;font-size:11.5px;color:var(--dim2);
  line-height:1.6}
#ss-notes .nx-body{overflow:auto;flex:1;min-height:80px}
#ss-notes .nx-row{padding:10px 12px;margin:0 0 6px;border-radius:3px;
  background:var(--glass);border:1px solid var(--line)}
#ss-notes .nx-row.nx-urgent{border-color:rgba(226,104,95,.5);
  background:rgba(226,104,95,.07)}
#ss-notes .nx-row b{font-size:13px;font-weight:500;color:var(--txt)}
#ss-notes .nx-row .nx-meta{font-size:10.5px;color:var(--dim2);margin-left:7px}
#ss-notes .nx-row p{margin:4px 0 0;font-size:11.5px;color:var(--dim);
  line-height:1.5}
#ss-notes .nx-go{margin-top:14px;display:flex;gap:9px;align-items:center}
#ss-notes .nx-go button{padding:8px 14px;border-radius:3px;font:inherit;
  font-size:12.5px;cursor:pointer;border:1px solid var(--line2);
  background:var(--glass);color:var(--dim)}
#ss-notes .nx-none{font-size:12px;color:var(--dim2);line-height:1.7;margin:0}
/* Three hundred and sixty rows is a list you cannot use. Find and filter, and
   a count so it is obvious the rest are still there. */
#ss-notes .nx-find{display:flex;gap:6px;margin:0 0 10px;flex-wrap:wrap}
#ss-notes .nx-find input{flex:1 1 150px;min-width:0;padding:7px 9px;
  border-radius:3px;font:inherit;font-size:12px;background:#05070d;
  border:1px solid var(--line);color:var(--txt)}
#ss-notes .nx-find input:focus{outline:0;border-color:var(--acc)}
#ss-notes .nx-find button{padding:6px 10px;border-radius:3px;font:inherit;
  font-size:11.5px;cursor:pointer;border:1px solid var(--line2);
  background:transparent;color:var(--dim2)}
#ss-notes .nx-find button:hover{color:var(--txt)}
#ss-notes .nx-find button[aria-pressed=true]{border-color:var(--acc);
  background:rgba(90,169,230,.14);color:var(--txt)}
#ss-notes .nx-count{font-size:10.5px;color:var(--dim2);margin:0 0 8px}
`;

let listStyled = false;

/**
 * Everything written about this person's body, newest first.
 *
 * A reading written on the body exists only while that structure is on screen.
 * Without a list there is no route back to it, which is the same bug as an
 * analysis with nowhere to appear.
 */
export function notes(me, username) {
  if (!username) return null;
  styles();
  if (!listStyled) {
    listStyled = true;
    const tag = document.createElement('style');
    tag.textContent = LIST_CSS;
    document.head.appendChild(tag);
  }
  const mine = me?.acting?.username === username;
  const button = document.createElement('button');
  button.id = 'ss-notes-open';
  button.type = 'button';
  button.innerHTML = mine ? '<i>My notes</i>' : '<i>Notes</i>';
  button.title = mine
    ? 'What your coach wrote about parts of your body'
    : 'Everything written about this body, newest first';
  button.addEventListener('click', () => openList(mine, username));

  const bar = document.getElementById('topbar');
  const chips = document.getElementById('discBar');
  if (bar) bar.insertBefore(button, chips ?? null);
  else document.body.appendChild(button);
  return button;
}

async function openList(mine, username) {
  const host = document.createElement('div');
  host.id = 'ss-notes';
  host.innerHTML = `<div class="nx-box">
    <h2>${mine ? 'My notes' : 'Notes on this body'}</h2>
    <p class="nx-sub">Click any structure on the body to write one. The
      questions are yours to write — nothing here is a fixed form.</p>
    <div class="nx-body"><p class="nx-none">Reading…</p></div>
    <div class="nx-go"><button type="button" data-close>Close</button></div>
  </div>`;
  document.body.appendChild(host);
  const shut = () => host.remove();
  host.querySelector('[data-close]').addEventListener('click', shut);
  host.addEventListener('click', (e) => { if (e.target === host) shut(); });

  const body = host.querySelector('.nx-body');
  try {
    const { structures } = await get(
      `structures-seen?username=${encodeURIComponent(username)}`);
    if (!structures.length) {
      body.innerHTML = `<p class="nx-none">${mine
        ? 'Nothing written about a particular part of you yet.'
        : 'Nothing yet. Click any muscle, bone or nerve on the body and the '
          + 'box to write about it opens.'}</p>`;
      return;
    }

    /* Find and filter. A body with every structure written about is three
     * hundred and sixty rows, and a coach looking for the psoas should not be
     * scrolling past the buccinator to reach it. */
    host.querySelector('.nx-box').insertAdjacentHTML('afterbegin', '');
    body.insertAdjacentHTML('beforebegin', `<div class="nx-find">
        <input data-find placeholder="Find a muscle, bone or nerve…">
        <button type="button" data-kind="" aria-pressed="true">All</button>
        <button type="button" data-kind="flagged" aria-pressed="false">Flagged</button>
        <button type="button" data-kind="muscle" aria-pressed="false">Muscles</button>
        <button type="button" data-kind="bone" aria-pressed="false">Bones</button>
        <button type="button" data-kind="nerve" aria-pressed="false">Nerves</button>
      </div><p class="nx-count" data-count></p>`);

    const draw = (find, kind) => {
      const needle = find.trim().toLowerCase();
      const shown = structures.filter((row) => {
        if (kind === 'flagged' && !row.flagged.length && !row.urgent) return false;
        if (kind && kind !== 'flagged' && row.kind !== kind) return false;
        return !needle || row.structure.toLowerCase().includes(needle);
      });
      host.querySelector('[data-count]').textContent = shown.length === structures.length
        ? `${structures.length} written about`
        : `${shown.length} of ${structures.length}`;
      body.innerHTML = shown.length ? shown.map((row) => `
        <div class="nx-row${row.urgent ? ' nx-urgent' : ''}">
          <b>${esc(row.structure)}</b>
          <span class="nx-meta">${esc(row.kind)} · ${esc(row.last_on)}${
            row.count > 1 ? ` · ${row.count} readings` : ''}</span>
          ${row.flagged.length ? `<p>${esc(row.flagged.join(' · '))}</p>` : ''}
          ${row.note ? `<p>“${esc(row.note)}”</p>` : ''}
        </div>`).join('')
        : '<p class="nx-none">Nothing matches that.</p>';
    };

    let kind = '';
    const input = host.querySelector('[data-find]');
    input.addEventListener('input', () => draw(input.value, kind));
    for (const button of host.querySelectorAll('[data-kind]')) {
      button.addEventListener('click', () => {
        kind = button.dataset.kind;
        for (const other of host.querySelectorAll('[data-kind]')) {
          other.setAttribute('aria-pressed', String(other === button));
        }
        draw(input.value, kind);
      });
    }
    draw('', '');
  } catch (error) {
    body.innerHTML = `<p class="nx-none">${esc(error.message)}</p>`;
  }
}
