/**
 * Score the class on the five things an instructor already watches.
 *
 * The notes a coach writes are prose about one moment. This is the other half:
 * the same five judgements every time, so the third class can be compared with
 * the first. The axes are not invented — they are the STOTT PILATES Five Basic
 * Principles, which contemporary instructor training is built on and which an
 * instructor is already tracking on every repetition: breathing, pelvic
 * placement, rib cage placement, scapular movement, head and cervical placement.
 *
 * Two decisions worth reading twice:
 *
 * **Every score has a note beside it, and the note is the valuable half.** *"3 —
 * rib cage flares on the second half of every roll-down"* is worth more than the
 * 3, and a rubric that only takes the number throws it away.
 *
 * **A skipped principle is a gap, not a zero.** A coach with ninety seconds
 * between classes fills in three of five, and a form that punishes that is a
 * form nobody fills in twice. The line simply has no point that week.
 *
 * The scale's anchors come down from the server with the form, so what a 3 means
 * is one definition in one file rather than a number two coaches guess at.
 */
const esc = (s) => String(s ?? '').replace(/[&<>"]/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const CSS = `
#ss-eval{position:fixed;inset:0;z-index:140;display:flex;align-items:center;
  justify-content:center;background:rgba(2,5,10,.82);backdrop-filter:blur(3px)}
#ss-eval .ss-box{width:min(720px,95vw);max-height:90vh;display:flex;
  flex-direction:column;border-radius:6px;padding:22px 24px;
  border:1px solid var(--line2);
  background:linear-gradient(200deg,rgba(10,17,28,.98),rgba(5,9,16,.99));
  box-shadow:0 40px 120px rgba(0,0,0,.6)}
#ss-eval h2{margin:0 0 3px;font-size:17px;font-weight:500;color:var(--txt)}
#ss-eval .ss-sub{margin:0 0 14px;font-size:12px;color:var(--dim2);line-height:1.6}
#ss-eval .ss-tabs{display:flex;gap:8px;margin:0 0 14px}
#ss-eval .ss-tabs button{flex:1;padding:8px 0;border-radius:3px;font:inherit;
  font-size:12.5px;cursor:pointer;border:1px solid var(--line);
  background:var(--glass);color:var(--dim)}
#ss-eval .ss-tabs button[aria-selected=true]{border-color:var(--acc);
  color:var(--txt);background:rgba(90,169,230,.12)}
#ss-eval .ss-body{overflow:auto;flex:1;min-height:120px;padding-right:2px}
#ss-eval .ss-axis{padding:12px 13px;margin:0 0 8px;border-radius:4px;
  background:var(--glass);border:1px solid var(--line)}
#ss-eval .ss-axis b{display:block;font-size:13px;font-weight:500;color:var(--txt)}
#ss-eval .ss-axis .ss-watch{display:block;font-size:11px;color:var(--dim2);
  line-height:1.55;margin:3px 0 9px}
#ss-eval .ss-marks{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
#ss-eval .ss-marks button{width:34px;height:30px;border-radius:3px;font:inherit;
  font-size:13px;cursor:pointer;border:1px solid var(--line2);
  background:var(--glass);color:var(--dim)}
#ss-eval .ss-marks button:hover{color:var(--txt);border-color:var(--acc)}
#ss-eval .ss-marks button[aria-pressed=true]{background:var(--acc);
  border-color:var(--acc);color:#04121f;font-weight:600}
#ss-eval .ss-marks .ss-anchor{font-size:11px;color:var(--dim2);flex:1 1 100%;
  min-height:15px;line-height:1.4}
/* Every input in this panel, not only the ones inside a scored axis. The
   first version scoped this to the axis rows only, and the four fields below
   the five -- what we did, the springs, the cue, the plan -- fell through to
   the browser default and rendered as white boxes in a dark dialog. */
#ss-eval input,#ss-eval textarea{width:100%;box-sizing:border-box;
  margin-top:8px;padding:7px 10px;border-radius:3px;font:inherit;font-size:12.5px;
  background:#05070d;border:1px solid var(--line);color:var(--txt)}
#ss-eval input::placeholder,#ss-eval textarea::placeholder{color:var(--dim2)}
#ss-eval textarea{min-height:52px;resize:vertical;line-height:1.5}
#ss-eval input:focus,#ss-eval textarea:focus{outline:0;border-color:var(--acc)}
#ss-eval label{display:block;font-size:10px;letter-spacing:.12em;
  text-transform:uppercase;color:var(--dim2);margin:14px 0 0}
#ss-eval .ss-effort{display:flex;gap:7px;margin-top:8px}
#ss-eval .ss-effort button{flex:1;padding:8px 6px;border-radius:3px;font:inherit;
  font-size:12px;cursor:pointer;border:1px solid var(--line);
  background:var(--glass);color:var(--dim);text-align:left}
#ss-eval .ss-effort button[aria-pressed=true]{border-color:var(--acc);
  color:var(--txt);background:rgba(90,169,230,.12)}
#ss-eval .ss-effort b{display:block;font-weight:500;color:var(--txt);
  font-size:12.5px}
#ss-eval .ss-effort span{font-size:10.5px;line-height:1.4}
#ss-eval .ss-go{display:flex;gap:10px;align-items:center;margin-top:16px}
#ss-eval .ss-go button{padding:10px 18px;border-radius:3px;font:inherit;
  font-size:13px;cursor:pointer;border:1px solid var(--line2);
  background:var(--glass);color:var(--txt)}
#ss-eval .ss-go button.ss-primary{background:var(--acc);border-color:var(--acc);
  color:#04121f;font-weight:600}
#ss-eval .ss-go button[disabled]{opacity:.5;cursor:default}
#ss-eval .ss-said{margin-left:auto;font-size:11.5px;color:var(--dim2);
  text-align:right;max-width:55%}
#ss-eval .ss-said.ss-bad{color:var(--gold)}
#ss-eval .ss-said.ss-good{color:var(--acc)}
#ss-eval .ss-part{padding:11px 13px;margin:0 0 7px;border-radius:4px;
  background:var(--glass);border:1px solid var(--line)}
#ss-eval .ss-part-urgent{border-color:rgba(226,104,95,.5);
  background:rgba(226,104,95,.07)}
#ss-eval .ss-none{font-size:12.5px;color:var(--dim2);line-height:1.75;margin:0}
#ss-eval .ss-line{padding:12px 13px;margin:0 0 8px;border-radius:4px;
  background:var(--glass);border:1px solid var(--line)}
#ss-eval .ss-line .ss-head{display:flex;gap:10px;align-items:baseline}
#ss-eval .ss-line b{font-size:13px;font-weight:500;color:var(--txt)}
#ss-eval .ss-line .ss-now{margin-left:auto;font-size:16px;color:var(--acc);
  font-weight:600}
#ss-eval .ss-line .ss-moved{font-size:11px;color:var(--dim2)}
#ss-eval .ss-line .ss-moved.ss-up{color:var(--acc)}
#ss-eval .ss-line .ss-moved.ss-down{color:#e2685f}
#ss-eval .ss-line svg{display:block;width:100%;height:44px;margin-top:8px}
#ss-eval .ss-line .ss-said-note{display:block;font-size:11px;color:var(--dim2);
  line-height:1.5;margin-top:6px;border-left:2px solid var(--line2);
  padding-left:9px}
#ss-eval .ss-focus{padding:12px 14px;margin:0 0 12px;border-radius:4px;
  border:1px solid rgba(233,180,92,.45);background:rgba(233,180,92,.08);
  font-size:12.5px;color:var(--txt);line-height:1.6}
#ss-eval .ss-focus b{color:var(--gold)}
#ss-eval .ss-past{font-size:11.5px;color:var(--dim);line-height:1.7;
  padding:10px 12px;border-radius:4px;background:var(--glass);
  border:1px solid var(--line);margin:0 0 7px}
#ss-eval .ss-past b{color:var(--txt);font-weight:500}
#ss-eval-open{flex:none;align-self:flex-start;display:inline-flex;
  align-items:center;padding:7px 14px;border-radius:4px;cursor:pointer;
  font:inherit;font-size:11.5px;letter-spacing:.09em;text-transform:uppercase;
  white-space:nowrap;background:rgba(90,169,230,.14);
  border:1px solid rgba(90,169,230,.5);color:var(--txt)}
#ss-eval-open:hover{background:rgba(90,169,230,.22)}
#ss-eval-open i{font-style:normal;font-weight:600;color:var(--acc)}
`;

let styled = false;
function styles() {
  if (styled) return;
  styled = true;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
}

const get = async (path) => {
  const response = await fetch(path, { credentials: 'same-origin' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || response.statusText);
  return payload;
};

const post = async (path, body) => {
  const response = await fetch(path, {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || response.statusText);
  return payload;
};

/**
 * The button, beside the others, on the body of whoever is loaded.
 *
 * A coach gets *Evaluate*; a student looking at their own body gets the same
 * panel with the scoring half removed, because what a coach thought of your
 * rib cage is a thing you are owed rather than a thing kept from you.
 */
export function mount(me, username) {
  if (!username) return null;
  styles();
  const mine = me?.acting?.username === username;
  const button = document.createElement('button');
  button.id = 'ss-eval-open';
  button.type = 'button';
  button.innerHTML = mine ? '<i>My feedback</i>' : '<i>Evaluate</i>';
  button.title = mine
    ? 'What your coach scored, and what they said about it'
    : 'Score this class on the five principles, and see the line';
  button.addEventListener('click', () => panel(username, mine));

  const bar = document.getElementById('topbar');
  const chips = document.getElementById('discBar');
  if (bar && chips) bar.insertBefore(button, chips);
  else document.body.appendChild(button);
  return button;
}

/** A tiny line, drawn from the points themselves rather than a chart library. */
function sparkline(points, scale) {
  if (points.length < 2) return '';
  const width = 260;
  const height = 34;
  const step = width / (points.length - 1);
  const y = (value) => height - ((value - 1) / (scale - 1)) * (height - 6) - 3;
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${(i * step).toFixed(1)},${
    y(p.value).toFixed(1)}`).join(' ');
  const last = points[points.length - 1];
  return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none"
       role="img" aria-label="${points.length} scores, most recent ${last.value}">
    <path d="${path}" fill="none" stroke="var(--acc)" stroke-width="1.6"
      vector-effect="non-scaling-stroke"/>
    <circle cx="${(width).toFixed(1)}" cy="${y(last.value).toFixed(1)}" r="2.6"
      fill="var(--acc)"/>
  </svg>`;
}

async function panel(username, mine) {
  styles();
  const host = document.createElement('div');
  host.id = 'ss-eval';
  host.innerHTML = `<div class="ss-box">
    <h2>Reading…</h2><div class="ss-body"></div>
    <div class="ss-go"><button type="button" data-close>Close</button>
      <span class="ss-said"></span></div>
  </div>`;
  document.body.appendChild(host);
  const shut = () => host.remove();
  host.querySelector('[data-close]').addEventListener('click', shut);
  host.addEventListener('click', (e) => { if (e.target === host) shut(); });

  const said = host.querySelector('.ss-said');
  const tell = (text, kind = '') => {
    said.className = `ss-said${kind ? ` ss-${kind}` : ''}`;
    said.textContent = text;
  };

  let form;
  let seen = [];
  try {
    form = await get(`evaluation?username=${encodeURIComponent(username)}`);
    seen = (await get(`structures-seen?username=${encodeURIComponent(username)}`)
      .catch(() => ({ structures: [] }))).structures ?? [];
  } catch (error) {
    host.querySelector('.ss-body').innerHTML =
      `<p class="ss-none">${esc(error.message)}</p>`;
    return host;
  }

  const scores = {};
  const notes = {};
  let effort = 'steady';
  let tab = form.may_write && !mine ? 'score' : 'progress';

  const box = host.querySelector('.ss-box');
  const draw = () => {
    const canScore = form.may_write && !mine;
    box.querySelector('h2').textContent = mine
      ? 'My feedback' : `Evaluate — ${form.display_name}`;
    const sub = mine
      ? 'What your coach scored after each class, and what they wrote beside it.'
      : 'The five principles, scored the same way every time so the third class '
        + 'can be compared with the first. Skip any you did not watch — a gap is '
        + 'a gap, not a zero.';

    /* Three tabs, and the third is the way back. A reading of the left psoas
     * written on the body exists only while the left psoas is on screen; without
     * a list there is no route to it afterwards, which is the same bug as an
     * analysis with nowhere to appear. */
    const tabs = `<div class="ss-tabs" role="tablist">
        ${canScore ? `<button type="button" data-tab="score"
          aria-selected="${tab === 'score'}">Score this class</button>` : ''}
        <button type="button" data-tab="progress" aria-selected="${tab === 'progress'}"
          >Progress${form.evaluations ? ` (${form.evaluations})` : ''}</button>
        <button type="button" data-tab="parts" aria-selected="${tab === 'parts'}"
          >Body parts${seen.length ? ` (${seen.length})` : ''}</button>
      </div>`;

    let body;
    if (tab === 'score') {
      body = Object.entries(form.principles).map(([key, meta]) => `
        <div class="ss-axis" data-axis="${esc(key)}">
          <b>${esc(meta.label)}</b>
          <span class="ss-watch">${esc(meta.watch)}</span>
          <div class="ss-marks">
            ${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-mark="${n}"
              aria-pressed="${scores[key] === n}">${n}</button>`).join('')}
            <span class="ss-anchor">${scores[key]
              ? esc(form.anchors[scores[key]]) : ''}</span>
          </div>
          <input data-note placeholder="What did you actually see? (optional, and the useful half)"
            value="${esc(notes[key] ?? '')}">
        </div>`).join('')
        + `<label>What we did</label>
           <input data-did placeholder="Footwork, hundred, roll-up, side series">
           <label>Springs, box, props</label>
           <input data-settings placeholder="Reformer: two reds and a blue for footwork">
           <label>The cue that worked — their words if you have them</label>
           <input data-cue placeholder="“reach the heel away”">
           <label>Plan for next time</label>
           <textarea data-plan placeholder="Wall roll-downs before the mat work. Revisit the teaser in two weeks."></textarea>
           <label>How the class went</label>
           <div class="ss-effort">${Object.entries(form.effort).map(([key, what]) => `
             <button type="button" data-effort="${esc(key)}"
               aria-pressed="${effort === key}">
               <b>${esc(key)}</b><span>${esc(what)}</span></button>`).join('')}
           </div>`;
    } else if (tab === 'parts') {
      body = seen.length ? seen.map((row) => `<div class="ss-part${
          row.urgent ? ' ss-part-urgent' : ''}">
          <div class="ss-head"><b>${esc(row.structure)}</b>
            <span class="ss-moved">${esc(row.kind)}</span>
            <span class="ss-now" style="font-size:11px">${esc(row.last_on)}</span>
          </div>
          <span class="ss-said-note">${row.findings.length
            ? esc(row.findings.join(' · '))
            : 'nothing flagged'}${row.count > 1
            ? ` — ${row.count} readings` : ''}</span>
        </div>`).join('')
        : `<p class="ss-none">${mine
            ? 'Nothing has been written about a particular muscle, bone or nerve yet.'
            : 'Nothing written about a particular part yet. Click any structure on '
              + 'the body and the reading for it opens — the questions change with '
              + 'what you picked.'}</p>`;
    } else if (!form.evaluations) {
      body = `<p class="ss-none">${mine
        ? 'Your coach has not scored a class yet. When they do, the five lines '
          + 'appear here with what they wrote beside each one.'
        : 'Nothing scored yet. Fill in the first one and there is a line from '
          + 'the second class onwards.'}</p>`;
    } else {
      const focus = form.focus_label
        ? `<div class="ss-focus">Work on <b>${esc(form.focus_label)}</b> —
             it is the lowest of the five right now.</div>` : '';
      body = focus + Object.entries(form.lines).map(([key, line]) => {
        if (!line.points.length) {
          return `<div class="ss-line"><div class="ss-head">
            <b>${esc(line.label)}</b>
            <span class="ss-moved">never scored</span></div></div>`;
        }
        const last = line.points[line.points.length - 1];
        const moved = line.moved > 0 ? 'up' : line.moved < 0 ? 'down' : '';
        return `<div class="ss-line">
          <div class="ss-head"><b>${esc(line.label)}</b>
            <span class="ss-moved${moved ? ` ss-${moved}` : ''}">${
              line.points.length === 1 ? 'first score'
              : line.moved === 0 ? 'no change'
              : `${line.moved > 0 ? '+' : ''}${line.moved} since ${
                  esc(line.points[0].date)}`}</span>
            <span class="ss-now">${last.value}<span
              style="font-size:11px;color:var(--dim2)">/${line.scale}</span></span>
          </div>
          ${sparkline(line.points, line.scale)}
          ${last.note ? `<span class="ss-said-note">${esc(last.note)} — ${
            esc(last.by)}, ${esc(last.date)}</span>` : ''}
        </div>`;
      }).join('')
      + (form.latest ? `<div class="ss-past">
          <b>Last class</b> — ${esc(form.latest.made_on)}, by ${esc(form.latest.by)}
          ${form.latest.did ? `<br><b>Did:</b> ${esc(form.latest.did)}` : ''}
          ${form.latest.settings ? `<br><b>Springs:</b> ${esc(form.latest.settings)}` : ''}
          ${form.latest.cue ? `<br><b>Cue:</b> ${esc(form.latest.cue)}` : ''}
          ${form.latest.plan ? `<br><b>Next time:</b> ${esc(form.latest.plan)}` : ''}
        </div>` : '');
    }

    box.querySelector('.ss-body').innerHTML = body;
    const header = box.querySelector('h2');
    header.insertAdjacentHTML('afterend',
      `<p class="ss-sub">${esc(sub)}</p>${tabs}`);
    // The header block is rebuilt each draw; drop the previous one.
    for (const stale of box.querySelectorAll('.ss-sub ~ .ss-sub, .ss-tabs ~ .ss-tabs')) {
      stale.remove();
    }

    for (const button of box.querySelectorAll('[data-tab]')) {
      button.addEventListener('click', () => {
        tab = button.dataset.tab;
        redraw();
      });
    }
    for (const axis of box.querySelectorAll('[data-axis]')) {
      const key = axis.dataset.axis;
      for (const mark of axis.querySelectorAll('[data-mark]')) {
        mark.addEventListener('click', () => {
          const value = Number(mark.dataset.mark);
          scores[key] = scores[key] === value ? undefined : value;
          if (scores[key] === undefined) delete scores[key];
          for (const other of axis.querySelectorAll('[data-mark]')) {
            other.setAttribute('aria-pressed',
                               String(scores[key] === Number(other.dataset.mark)));
          }
          axis.querySelector('.ss-anchor').textContent =
            scores[key] ? form.anchors[scores[key]] : '';
        });
      }
      axis.querySelector('[data-note]')?.addEventListener('input', (event) => {
        notes[key] = event.target.value;
      });
    }
    for (const button of box.querySelectorAll('[data-effort]')) {
      button.addEventListener('click', () => {
        effort = button.dataset.effort;
        for (const other of box.querySelectorAll('[data-effort]')) {
          other.setAttribute('aria-pressed', String(other === button));
        }
      });
    }

    const go = box.querySelector('[data-save]');
    if (tab === 'score' && !go) {
      box.querySelector('[data-close]').insertAdjacentHTML('beforebegin',
        '<button type="button" class="ss-primary" data-save>Save the class</button>');
      box.querySelector('[data-save]').addEventListener('click', save);
    } else if (tab !== 'score' && go) {
      go.remove();
    }
  };

  const redraw = () => {
    for (const stale of box.querySelectorAll('.ss-sub, .ss-tabs')) stale.remove();
    draw();
  };

  const value = (name) => box.querySelector(`[data-${name}]`)?.value.trim() ?? '';

  async function save() {
    const button = box.querySelector('[data-save]');
    button.disabled = true;
    tell('Saving…');
    try {
      const out = await post('evaluate', {
        username, scores, notes, effort,
        did: value('did'), settings: value('settings'),
        cue: value('cue'), plan: value('plan'),
      });
      Object.assign(form, out);
      for (const key of Object.keys(scores)) delete scores[key];
      for (const key of Object.keys(notes)) delete notes[key];
      tab = 'progress';
      redraw();
      tell(out.evaluation.average != null
        ? `Saved. Average ${out.evaluation.average}, weakest ${
            out.evaluation.weakest.toLowerCase()}.`
        : 'Saved.', 'good');
    } catch (error) {
      tell(error.message, 'bad');
      button.disabled = false;
    }
  }

  draw();
  return host;
}
