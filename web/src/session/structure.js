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
const esc = (s) => String(s ?? '').replace(/[&<>"]/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const CSS = `
/* Its own column, to the left of the explore panel rather than on top of it.
 * Narrow enough that both fit, and it falls back to the panel's slot only when
 * the panel itself has been folded away. */
#ss-struct{position:fixed;z-index:8;top:calc(var(--barh) - 6px);bottom:14px;
  right:calc(var(--panelw) + 24px);width:310px;display:flex;flex-direction:column;
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
#ss-struct .sx-dots span{width:7px;height:7px;border-radius:50%;
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
  tag.textContent = CSS;
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

/** Open the reading for one structure. Called on every selection. */
export async function show(record, me, username, session = '') {
  styles();
  const name = record?.name?.en ?? record?.key ?? '';
  const kind = record?.kind ?? '';
  if (!name || !username) return;

  const already = document.getElementById('ss-struct');
  if (already && open === name) return;
  already?.remove();
  open = name;

  const host = document.createElement('div');
  host.id = 'ss-struct';
  host.innerHTML = `<div class="sx-head">
      <p class="sx-kind">Reading…</p><h3>${esc(name)}</h3>
      <button type="button" class="sx-shut" data-shut
        aria-label="Close">&times;</button>
    </div><div class="sx-body"></div>`;
  document.body.appendChild(host);

  const shut = () => { host.remove(); open = null; };
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
  draw(host, form, { me, username, session, name, kind, record, shut });
}

function runs(form) {
  const rows = Object.entries(form.history?.runs ?? {});
  if (!rows.length && !form.history?.count) return '';
  const lines = rows.map(([label, points]) => {
    const dots = points.slice(-6).map((p) =>
      `<span class="${p.verdict === 'fine' ? '' : p.verdict}"
        title="${esc(p.date)}: ${esc(p.verdict)}${
        p.note ? ` — ${esc(p.note)}` : ''}"></span>`).join('');
    return `<p class="sx-run"><em>${esc(label)}</em>
      <span class="sx-dots">${dots}</span></p>`;
  }).join('');
  const last = form.history.latest;
  return `<div class="sx-past">
    <h5>Written about this before — ${form.history.count} time${
      form.history.count === 1 ? '' : 's'}, since ${esc(form.history.first_on)}</h5>
    ${lines}${last?.note
      ? `<p class="sx-run" style="margin-top:6px"><em>“${esc(last.note)}”
          — ${esc(last.by)}, ${esc(last.made_on)}</em></p>` : ''}</div>`;
}

function draw(host, form, ctx) {
  const head = host.querySelector('.sx-head');
  head.querySelector('.sx-kind').textContent = form.kind_label || form.kind;
  head.insertAdjacentHTML('beforeend',
    `<p class="sx-who">${esc(form.display_name)}</p>`
    + (form.note ? `<p class="sx-note">${esc(form.note)}</p>` : ''));

  const body = host.querySelector('.sx-body');
  const may = form.may_write && form.open;
  if (!form.open || !may) {
    body.innerHTML = runs(form) + `<p class="sx-none">${esc(
      !form.open ? form.why
      : form.student === ctx.me?.acting?.username
        ? 'This is what your coach wrote about this part of you.'
        : 'You are not this person’s coach, so there is nothing to write here.'
    )}</p>`;
    return;
  }

  body.innerHTML = runs(form)
    + `<label>What you saw</label>
       <textarea data-free
         placeholder="Anything. This on its own is a complete reading."></textarea>
       <label style="margin-top:15px">Checks — your words, not ours</label>
       <p class="sx-hint">${form.yours
         ? 'What you wrote about this before, and a few starting points. '
         : 'Starting points only — press one, edit it, or write your own. '
         }Every one is optional.</p>
       <div class="sx-chips">${(form.suggested ?? []).map((label, i) =>
         `<button type="button" data-chip="${esc(label)}"
           class="${i < (form.yours ?? 0) ? 'sx-mine' : ''}">${esc(label)}</button>`
         ).join('')}</div>
       <div data-checks></div>
       <button type="button" class="sx-add" data-add>+ add a check of your own</button>`;

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
      <div class="sx-verdicts">${Object.entries(form.verdicts).map(([key, text]) =>
        `<button type="button" data-v="${esc(key)}"
          aria-pressed="false">${esc(text)}</button>`).join('')}</div>
      <textarea data-cnote placeholder="…because?"></textarea>`;
    list.appendChild(row);
    row.querySelector('[data-drop]').addEventListener('click', () => row.remove());
    for (const button of row.querySelectorAll('[data-v]')) {
      button.addEventListener('click', () => {
        const on = button.getAttribute('aria-pressed') !== 'true';
        for (const other of row.querySelectorAll('[data-v]')) {
          other.setAttribute('aria-pressed',
                             String(on && other === button));
        }
      });
    }
    if (!label) row.querySelector('[data-label]').focus();
    return row;
  };
  for (const chip of body.querySelectorAll('[data-chip]')) {
    chip.addEventListener('click', () => {
      add(chip.dataset.chip);
      chip.remove();
    });
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
    const checks = [...list.querySelectorAll('.sx-check')].map((row) => ({
      label: row.querySelector('[data-label]').value.trim(),
      verdict: row.querySelector('[data-v][aria-pressed=true]')?.dataset.v ?? '',
      note: row.querySelector('[data-cnote]').value.trim(),
    })).filter((c) => c.label);
    try {
      const out = await post('evaluate-structure', {
        username: ctx.username, structure: ctx.name, kind: ctx.kind,
        fma: (ctx.record?.fma ?? [])[0] ?? '', session: ctx.session,
        note: body.querySelector('[data-free]').value.trim(), checks,
      });
      form.history = out.history;
      const flagged = out.evaluation.flagged;
      tell(flagged.length
        ? `Saved — ${flagged[0]}${flagged.length > 1
            ? ` and ${flagged.length - 1} more` : ''}.`
        : 'Saved.', 'good');
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
    body.innerHTML = structures.length ? structures.map((row) => `
      <div class="nx-row${row.urgent ? ' nx-urgent' : ''}">
        <b>${esc(row.structure)}</b>
        <span class="nx-meta">${esc(row.kind)} · ${esc(row.last_on)}${
          row.count > 1 ? ` · ${row.count} readings` : ''}</span>
        ${row.flagged.length
          ? `<p>${esc(row.flagged.join(' · '))}</p>` : ''}
        ${row.note ? `<p>“${esc(row.note)}”</p>` : ''}
      </div>`).join('')
      : `<p class="nx-none">${mine
          ? 'Nothing written about a particular part of you yet.'
          : 'Nothing yet. Click any muscle, bone or nerve on the body and the '
            + 'box to write about it opens.'}</p>`;
  } catch (error) {
    body.innerHTML = `<p class="nx-none">${esc(error.message)}</p>`;
  }
}
