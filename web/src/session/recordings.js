/**
 * Everything already measured on this machine, and a way back into it.
 *
 * This exists because of a hole that cost somebody a recording. A finished
 * analysis had exactly one place it could appear: the dialog that was watching
 * the job. Close that dialog -- or let the tab reload, or walk away while a
 * slow box worked -- and the measurements were in the database with no route
 * in the interface that could reach them. The answer to "where do I see the
 * analysis I just recorded" was, truthfully, nowhere.
 *
 * So: a list, in the header, beside the button that made them. Newest first,
 * because the one somebody is looking for is almost always the one they just
 * made. Click a row and it goes onto the body without a page reload, which is
 * the same path a fresh analysis takes.
 */
const esc = (s) => String(s ?? '').replace(/[&<>"]/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const CSS = `
#ss-recs-open{flex:none;align-self:flex-start;display:inline-flex;gap:8px;
  align-items:center;padding:7px 14px;border-radius:4px;cursor:pointer;
  font:inherit;font-size:11.5px;letter-spacing:.09em;text-transform:uppercase;
  white-space:nowrap;background:var(--glass);border:1px solid var(--line2);
  color:var(--dim)}
#ss-recs-open:hover{color:var(--txt);border-color:var(--acc)}
#ss-recs-open b{font-weight:600;color:var(--txt)}
#ss-recs{position:fixed;inset:0;z-index:120;display:flex;align-items:center;
  justify-content:center;background:rgba(2,5,10,.78);backdrop-filter:blur(3px)}
#ss-recs .box{width:min(560px,92vw);max-height:82vh;display:flex;
  flex-direction:column;border-radius:6px;border:1px solid var(--line2);
  background:linear-gradient(200deg,rgba(10,17,28,.98),rgba(5,9,16,.99));
  padding:22px 24px;box-shadow:0 40px 120px rgba(0,0,0,.6)}
#ss-recs h2{margin:0 0 4px;font-size:17px;font-weight:500;color:var(--txt)}
#ss-recs .sub{margin:0 0 16px;font-size:12px;color:var(--dim2);line-height:1.6}
#ss-recs .rows{overflow:auto;margin:0 0 14px}
#ss-recs .row{display:flex;gap:12px;align-items:baseline;width:100%;
  padding:11px 12px;margin:0 0 6px;border-radius:4px;cursor:pointer;
  text-align:left;font:inherit;color:var(--txt);
  background:var(--glass);border:1px solid var(--line)}
#ss-recs .row:hover{border-color:var(--acc);background:rgba(90,169,230,.10)}
#ss-recs .row b{font-weight:500;font-size:13px}
#ss-recs .row .when{color:var(--dim);font-size:12px}
#ss-recs .row .n{margin-left:auto;color:var(--dim2);font-size:11px;
  white-space:nowrap}
#ss-recs .row.thin{opacity:.55}
#ss-recs .none{font-size:12.5px;color:var(--dim2);line-height:1.7;margin:0 0 14px}
#ss-recs .go{display:flex;gap:10px;align-items:center}
#ss-recs .go button{padding:9px 16px;border-radius:3px;font-size:13px;
  border:1px solid var(--line2);background:var(--glass);color:var(--txt);
  cursor:pointer}
#ss-recs .said{margin-left:auto;font-size:11.5px;color:var(--dim2)}
#ss-recs .said.bad{color:var(--gold)}
`;

async function list() {
  try {
    const response = await fetch('recordings');
    if (!response.ok) return [];
    return (await response.json()).recordings ?? [];
  } catch { return []; }
}

/**
 * The button, drawn beside Record.
 *
 * Only where the server keeps a record. A viewer showing one exported file has
 * no list to show, and an empty list behind a button is a worse answer than no
 * button -- this is the one case where the argument genuinely holds, because
 * there is nothing to explain and nothing to turn on.
 */
export function mount(can, install) {
  if (!can?.remembers) return null;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const open = document.createElement('button');
  open.id = 'ss-recs-open';
  open.type = 'button';
  open.innerHTML = '<b>Recordings</b>';
  open.title = 'Open a session already measured on this machine';
  open.addEventListener('click', () => dialog(install));

  const bar = document.getElementById('topbar');
  const record = document.getElementById('ss-rec-open');
  if (bar && record) record.after(open);
  else if (bar) bar.appendChild(open);
  else document.body.appendChild(open);
  return open;
}

function when(row) {
  const seconds = Math.round(row.duration_s || 0);
  return seconds ? `${row.date} · ${seconds}s of video` : row.date;
}

async function dialog(install) {
  const host = document.createElement('div');
  host.id = 'ss-recs';
  host.innerHTML = `<div class="box">
    <h2>On record here</h2>
    <p class="sub">Every class this machine has measured, newest first. Opening
      one puts it on the body — the measurements, the history behind it and
      anything the coach wrote.</p>
    <div class="rows">Reading…</div>
    <div class="go"><button type="button" data-close>Close</button>
      <span class="said"></span></div>
  </div>`;
  document.body.appendChild(host);
  const shut = () => host.remove();
  host.querySelector('[data-close]').addEventListener('click', shut);
  host.addEventListener('click', (e) => { if (e.target === host) shut(); });

  const rows = host.querySelector('.rows');
  const said = host.querySelector('.said');
  const recordings = await list();
  if (!recordings.length) {
    rows.innerHTML = `<p class="none">Nothing measured here yet. Press Record,
      choose a clip or use the camera, and <b>leave the dialog open until it
      finishes</b> — the analysis runs on the server, and on a small machine it
      takes a while. Whatever finishes lands in this list.</p>`;
    return;
  }
  rows.innerHTML = recordings.map((r) => `
    <button type="button" class="row${r.measurements ? '' : ' thin'}"
      data-user="${esc(r.username ?? '')}" data-key="${esc(r.key)}">
      <b>${esc(r.display_name || r.username || 'Unattributed')}</b>
      <span class="when">${esc(when(r))}</span>
      <span class="n">${r.measurements
        ? `${r.measurements} measurements` : 'no measurements'}</span>
    </button>`).join('');

  for (const row of rows.querySelectorAll('.row')) {
    row.addEventListener('click', async () => {
      const { user, key } = row.dataset;
      if (!user) {
        said.className = 'said bad';
        said.textContent = 'Nobody was attributed to this one, so there is '
                         + 'nothing to build a body from.';
        return;
      }
      said.className = 'said';
      said.textContent = 'Opening…';
      try {
        const response = await fetch(
          `recording?user=${encodeURIComponent(user)}&session=${encodeURIComponent(key)}`);
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || response.statusText);
        await install(body);
        shut();
      } catch (error) {
        said.className = 'said bad';
        said.textContent = error.message;
      }
    });
  }
}
