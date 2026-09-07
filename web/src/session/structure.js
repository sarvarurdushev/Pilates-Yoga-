/**
 * Evaluating whatever is on the screen, on the axes that thing actually takes.
 *
 * The five-principle dialog scores a class. This scores a *structure*, and the
 * reason it is a separate surface is that the questions are not the same for
 * every structure: a muscle is judged by recruitment, a bone by placement, and
 * a nerve is not judged at all -- it is a symptom report that ends in stop,
 * modify or refer. The server owns that rubric (see pilates/structure_eval.py)
 * and sends it down with the request, so the page never has to know which
 * questions a psoas takes and which a fifth lumbar vertebra takes.
 *
 * Two behaviours the coach asked for and both are load-bearing:
 *
 * 1. **It opens by itself.** Clicking a muscle with no way to say anything
 *    about it is the same failure as the old hidden "coach mode" toggle. Select
 *    a structure and the box is there.
 * 2. **It takes the right-hand dock rather than adding to it.** The explore
 *    panel is already the widest thing on the screen; putting a form beside it
 *    would leave the body a letterbox. This sits in front of it and gives it
 *    back on close.
 */
const esc = (s) => String(s ?? '').replace(/[&<>"]/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const CSS = `
#ss-struct{position:fixed;right:14px;top:calc(var(--barh) - 6px);bottom:14px;
  width:var(--panelw);z-index:9;display:flex;flex-direction:column;min-height:0;
  border-radius:3px;border:1px solid var(--acc);
  background:linear-gradient(200deg,rgba(8,15,25,.94) 0%,rgba(4,8,14,.97) 100%);
  box-shadow:0 30px 90px rgba(0,0,0,.7),inset 0 1px 0 rgba(160,200,245,.09);
  backdrop-filter:var(--blur);-webkit-backdrop-filter:var(--blur)}
@media(max-width:900px){#ss-struct{right:0;left:0;bottom:0;top:auto;width:auto;
  height:74vh;border-radius:0}}
#ss-struct .sx-head{flex:none;padding:14px 16px 12px;
  border-bottom:1px solid var(--hair)}
#ss-struct .sx-kind{font-size:9.5px;letter-spacing:.16em;text-transform:uppercase;
  color:var(--acc);margin:0 0 5px}
#ss-struct h3{margin:0;font-size:16px;font-weight:500;color:var(--txt);
  line-height:1.2}
#ss-struct .sx-who{font-size:11px;color:var(--dim2);margin:5px 0 0}
#ss-struct .sx-lede{font-size:11.5px;color:var(--dim2);line-height:1.55;
  margin:9px 0 0}
#ss-struct .sx-banner{margin:10px 0 0;padding:9px 11px;border-radius:3px;
  font-size:11.5px;line-height:1.5;color:var(--gold);
  border:1px solid rgba(233,180,92,.4);background:rgba(233,180,92,.07)}
#ss-struct .sx-body{overflow:auto;flex:1;min-height:0;padding:14px 16px 20px}
#ss-struct .sx-foot{flex:none;border-top:1px solid var(--hair);
  padding:11px 16px 13px;background:rgba(2,5,10,.5);display:flex;gap:9px;
  align-items:center;flex-wrap:wrap}
#ss-struct .sx-foot button{padding:8px 14px;border-radius:3px;font:inherit;
  font-size:12.5px;cursor:pointer;border:1px solid var(--line2);
  background:var(--glass);color:var(--dim)}
#ss-struct .sx-foot button.sx-primary{background:var(--acc);border-color:var(--acc);
  color:#04121f;font-weight:600}
#ss-struct .sx-foot button:disabled{opacity:.5;cursor:default}
/* Its own row under the buttons, not squeezed beside them. Sharing the row
 * made a four-finding nerve confirmation wrap to one word per line and run off
 * the bottom of the panel. */
#ss-struct .sx-said{font-size:11px;color:var(--dim2);flex:1 0 100%;min-width:0;
  line-height:1.45;max-height:44px;overflow:auto}
#ss-struct .sx-said:empty{display:none}
#ss-struct .sx-said.sx-good{color:var(--acc)}
#ss-struct .sx-said.sx-bad{color:var(--gold)}

#ss-struct .sx-axis{padding:11px 12px;margin:0 0 8px;border-radius:3px;
  background:var(--glass);border:1px solid var(--line)}
#ss-struct .sx-axis b{display:block;font-size:12.5px;font-weight:500;
  color:var(--txt)}
#ss-struct .sx-ask{display:block;font-size:11px;color:var(--dim2);
  line-height:1.5;margin:3px 0 8px}
#ss-struct .sx-opts{display:flex;flex-direction:column;gap:4px}
#ss-struct .sx-opts button{text-align:left;padding:6px 9px;border-radius:3px;
  font:inherit;font-size:12px;cursor:pointer;border:1px solid var(--line2);
  background:transparent;color:var(--dim);line-height:1.35}
#ss-struct .sx-opts button:hover{color:var(--txt);border-color:var(--acc)}
#ss-struct .sx-opts button[aria-pressed=true]{border-color:var(--acc);
  background:rgba(90,169,230,.14);color:var(--txt)}
#ss-struct .sx-opts button i{display:block;font-style:normal;font-size:10.5px;
  color:var(--dim2);margin-top:2px}
#ss-struct .sx-opts button[aria-pressed=true] i{color:var(--dim)}
#ss-struct .sx-opts button.sx-loud[aria-pressed=true]{border-color:var(--gold);
  background:rgba(233,180,92,.14)}
#ss-struct label{display:block;font-size:9.5px;letter-spacing:.12em;
  text-transform:uppercase;color:var(--dim2);margin:13px 0 0}
#ss-struct input,#ss-struct textarea{width:100%;box-sizing:border-box;
  margin-top:6px;padding:7px 9px;border-radius:3px;font:inherit;font-size:12px;
  background:#05070d;border:1px solid var(--line);color:var(--txt)}
#ss-struct input::placeholder,#ss-struct textarea::placeholder{color:var(--dim2)}
#ss-struct textarea{min-height:46px;resize:vertical;line-height:1.5}
#ss-struct input:focus,#ss-struct textarea:focus{outline:0;border-color:var(--acc)}
#ss-struct .sx-none{font-size:12px;color:var(--dim2);line-height:1.65;margin:0}
#ss-struct .sx-shut{position:absolute;right:9px;top:9px;width:24px;height:24px;
  border-radius:3px;border:1px solid var(--line2);background:var(--glass);
  color:var(--dim);cursor:pointer;font-size:14px;line-height:1;padding:0}
#ss-struct .sx-shut:hover{color:var(--txt);border-color:var(--acc)}

#ss-struct .sx-past{margin:0 0 12px;padding:10px 12px;border-radius:3px;
  border:1px solid var(--line);background:rgba(90,169,230,.05)}
#ss-struct .sx-past h5{margin:0 0 7px;font-size:9.5px;letter-spacing:.12em;
  text-transform:uppercase;color:var(--dim2);font-weight:500}
#ss-struct .sx-run{display:flex;gap:7px;align-items:baseline;font-size:11.5px;
  color:var(--dim);margin:0 0 4px;line-height:1.4}
#ss-struct .sx-run em{font-style:normal;color:var(--txt);min-width:88px}
#ss-struct .sx-dots{display:flex;gap:3px;flex:none}
#ss-struct .sx-dots span{width:7px;height:7px;border-radius:50%;
  background:var(--line2);display:block}
#ss-struct .sx-dots span.on{background:var(--gold)}
#ss-struct .sx-urgent{border-color:rgba(226,104,95,.5);
  background:rgba(226,104,95,.08);color:#e2685f}

/* The explore dock, collapsed to a strip. It is the widest thing on screen and
 * a coach reading a body does not need four tabs of prose in the way. */
#ss-dock{position:fixed;z-index:7;right:14px;top:calc(var(--barh) - 6px);
  width:26px;padding:10px 0;border-radius:3px;border:1px solid var(--line);
  background:rgba(6,11,19,.86);color:var(--dim);cursor:pointer;
  writing-mode:vertical-rl;font:inherit;font-size:9.5px;letter-spacing:.16em;
  text-transform:uppercase;backdrop-filter:var(--blur)}
#ss-dock:hover{color:var(--txt);border-color:var(--acc)}
#panel.ss-away{display:none}
#ss-fold{flex:none;width:26px;background:transparent;border:0;color:var(--dim2);
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
 * Remembered per browser, because a coach who wants the body full-width wants
 * it full-width tomorrow as well.
 */
export function foldable() {
  styles();
  const panel = document.getElementById('panel');
  const tabs = document.getElementById('tabs');
  if (!panel || !tabs || document.getElementById('ss-fold')) return;

  const strip = document.createElement('button');
  strip.id = 'ss-dock';
  strip.type = 'button';
  strip.hidden = true;
  strip.textContent = 'Explore';
  strip.title = 'Bring the panel back';
  document.body.appendChild(strip);

  const fold = document.createElement('button');
  fold.id = 'ss-fold';
  fold.type = 'button';
  fold.textContent = '›';
  fold.title = 'Fold the panel away — the body gets the whole screen';
  fold.setAttribute('aria-label', 'Fold the panel away');
  tabs.appendChild(fold);

  const set = (away) => {
    panel.classList.toggle('ss-away', away);
    strip.hidden = !away;
    try { localStorage.setItem(FOLDED, away ? '1' : '0'); } catch { /* private */ }
  };
  fold.addEventListener('click', () => set(true));
  strip.addEventListener('click', () => set(false));
  let was = false;
  try { was = localStorage.getItem(FOLDED) === '1'; } catch { /* private */ }
  if (was) set(true);
  return { set };
}

/* ------------------------------------------------------------- the panel */

let open = null;   // the structure currently on screen, so a re-select is a no-op

/**
 * Open the evaluation for one structure. Called on every selection.
 *
 * @param {object} record   the registry entry: name, kind, fma, sides
 * @param {object} me       whoami
 * @param {string} username whose body is loaded
 * @param {string} session  the session key, for provenance
 */
export async function show(record, me, username, session = '') {
  styles();
  const name = record?.name?.en ?? record?.key ?? '';
  const kind = record?.kind ?? '';
  if (!name || !username) return;

  const already = document.getElementById('ss-struct');
  if (already && open === name) return;      // same structure, already open
  already?.remove();
  open = name;

  const panel = document.getElementById('panel');
  const wasAway = panel?.classList.contains('ss-away');
  panel?.classList.add('ss-away');

  const host = document.createElement('div');
  host.id = 'ss-struct';
  host.innerHTML = `<div class="sx-head">
      <p class="sx-kind">Reading…</p><h3>${esc(name)}</h3>
      <button type="button" class="sx-shut" data-shut
        aria-label="Close">&times;</button>
    </div>
    <div class="sx-body"></div>`;
  document.body.appendChild(host);

  const shut = () => {
    host.remove();
    open = null;
    if (!wasAway) panel?.classList.remove('ss-away');
  };
  host.querySelector('[data-shut]').addEventListener('click', shut);

  let form;
  try {
    form = await get('structure?' + new URLSearchParams({
      username, structure: name, kind,
      fma: (record?.fma ?? [])[0] ?? '', side: record?.sides ? '' : '',
    }));
  } catch (error) {
    host.querySelector('.sx-body').innerHTML =
      `<p class="sx-none">${esc(error.message)}</p>`;
    return;
  }
  if (open !== name) return;                 // they moved on while we fetched
  draw(host, form, { me, username, session, name, kind, record, shut });
}

function runs(form) {
  const axes = form.history?.axes ?? {};
  const keys = Object.keys(axes);
  if (!keys.length) return '';
  const rows = keys.map((key) => {
    const line = axes[key];
    const dots = line.points.slice(-6).map((p) =>
      `<span class="${p.settled ? '' : 'on'}" title="${esc(p.date)}: ${
        esc(p.label)}"></span>`).join('');
    const last = line.points[line.points.length - 1];
    return `<p class="sx-run"><em>${esc(line.label)}</em>
      <span class="sx-dots">${dots}</span>
      <span>${esc(last.label)}${line.unsettled > 1
        ? ` · ${line.unsettled} classes running` : ''}</span></p>`;
  }).join('');
  return `<div class="sx-past${form.history.urgent ? ' sx-urgent' : ''}">
    <h5>Written about this before — ${form.history.count} time${
      form.history.count === 1 ? '' : 's'}, since ${
      esc(form.history.first_on)}</h5>${rows}</div>`;
}

function draw(host, form, ctx) {
  const head = host.querySelector('.sx-head');
  head.querySelector('.sx-kind').textContent = form.kind_label || form.kind;
  head.querySelector('h3').textContent = ctx.name;
  const may = form.may_write && form.open;

  head.insertAdjacentHTML('beforeend',
    `<p class="sx-who">${esc(form.display_name)}</p>`
    + (form.lede && may ? `<p class="sx-lede">${esc(form.lede)}</p>` : '')
    + (form.banner ? `<p class="sx-banner">${esc(form.banner)}</p>` : ''));

  const body = host.querySelector('.sx-body');
  if (!form.open) {
    /* A refusal with a reason, not a greyed-out form. The reason is the
     * content: a coach who is told *why* a brain has no fields learns
     * something; one who is told "unavailable" files a bug. */
    body.innerHTML = runs(form) + `<p class="sx-none">${esc(form.why)}</p>`;
    return;
  }
  if (!may) {
    body.innerHTML = runs(form) + `<p class="sx-none">${
      form.student === ctx.me?.acting?.username
        ? 'This is what your coach wrote about this part of you.'
        : 'You are not this person&rsquo;s coach, so there is nothing to write here.'
    }</p>`;
    return;
  }

  const marks = {};
  body.innerHTML = runs(form)
    + form.axes.map((axis) => `<div class="sx-axis" data-axis="${esc(axis.key)}">
        <b>${esc(axis.label)}</b>
        ${axis.ask ? `<span class="sx-ask">${esc(axis.ask)}</span>` : ''}
        <div class="sx-opts">${axis.options.map(([value, label, why]) => `
          <button type="button" data-pick="${esc(value)}" aria-pressed="false"
            class="${value !== axis.mid ? 'sx-loud' : ''}">${esc(label)}${
            why ? `<i>${esc(why)}</i>` : ''}</button>`).join('')}</div>
        ${axis.note ? `<textarea data-note
          placeholder="${esc(form.note_hint)}"></textarea>` : ''}
      </div>`).join('')
    + form.fields.map(([key, label, hint, shape]) => `<label>${esc(label)}</label>${
        shape === 'area'
          ? `<textarea data-field="${esc(key)}" placeholder="${esc(hint)}"></textarea>`
          : `<input data-field="${esc(key)}" placeholder="${esc(hint)}">`}`).join('');

  for (const axis of body.querySelectorAll('[data-axis]')) {
    const key = axis.dataset.axis;
    for (const pick of axis.querySelectorAll('[data-pick]')) {
      pick.addEventListener('click', () => {
        const value = pick.dataset.pick;
        const now = marks[key]?.choice === value ? null : value;
        if (now) marks[key] = { choice: now, note: marks[key]?.note ?? '' };
        else delete marks[key];
        for (const other of axis.querySelectorAll('[data-pick]')) {
          other.setAttribute('aria-pressed',
                             String(other.dataset.pick === now));
        }
      });
    }
    axis.querySelector('[data-note]')?.addEventListener('input', (event) => {
      if (marks[key]) marks[key].note = event.target.value;
      else marks[key] = { choice: '', note: event.target.value };
    });
  }

  host.insertAdjacentHTML('beforeend', `<div class="sx-foot">
    <button type="button" class="sx-primary" data-save>Save this reading</button>
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
    const fields = {};
    for (const el of host.querySelectorAll('[data-field]')) {
      if (el.value.trim()) fields[el.dataset.field] = el.value.trim();
    }
    const sending = {};
    for (const [key, mark] of Object.entries(marks)) {
      if (mark.choice) sending[key] = mark;
    }
    try {
      const out = await post('evaluate-structure', {
        username: ctx.username, structure: ctx.name, kind: ctx.kind,
        fma: (ctx.record?.fma ?? [])[0] ?? '', session: ctx.session,
        marks: sending, fields,
      });
      Object.assign(form, { history: out.history });
      /* Short on purpose. Reading back every answer is the panel's job and it
       * is doing it two inches above; a confirmation that repeats all four
       * findings is a paragraph in a status line. */
      const found = out.evaluation.findings;
      tell(found.length
        ? `Saved — ${found[0]}${found.length > 1
            ? ` and ${found.length - 1} more` : ''}.`
        : 'Saved. Nothing flagged.', 'good');
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
  document.getElementById('panel')?.classList.remove('ss-away');
}
