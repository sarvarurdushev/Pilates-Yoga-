/**
 * The coach's room: who is coming, and what to read before they arrive.
 *
 * A coach does not open this application to look at an anatomy model. They open
 * it to find out which of the eleven people in tonight's class has a knee they
 * should know about, whose goal is overdue for a review, and who they have not
 * looked at in a month. So the coach's surface opens on a **roster**, not on a
 * body, and the roster is ordered by what needs attention rather than
 * alphabetically -- an unscreened student and an overdue goal are the two things
 * that must not be found by scrolling.
 *
 * Picking somebody loads their measurements onto the body and turns the writing
 * tools on, which is the flow that already existed; this is the half that was
 * missing, which is knowing who to pick.
 *
 * **The directory is a phone book, not a record.** Names, and whether they are
 * already yours. A coach adds somebody from it, and that is a *request*: until
 * the student accepts it the coach can see the name they already saw and
 * nothing more.
 */
const esc = (s) => String(s ?? '').replace(/[&<>"]/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const CSS = `
#ss-roster-open{flex:none;align-self:flex-start;display:inline-flex;gap:8px;
  align-items:center;padding:7px 14px;border-radius:4px;cursor:pointer;
  font:inherit;font-size:11.5px;letter-spacing:.09em;text-transform:uppercase;
  white-space:nowrap;background:rgba(233,180,92,.12);
  border:1px solid rgba(233,180,92,.45);color:var(--txt)}
#ss-roster-open:hover{background:rgba(233,180,92,.2)}
#ss-roster-open i{font-style:normal;color:var(--gold);font-weight:600}
#ss-roster{position:fixed;inset:0;z-index:130;display:flex;align-items:center;
  justify-content:center;background:rgba(2,5,10,.8);backdrop-filter:blur(3px)}
#ss-roster .ss-box{width:min(680px,94vw);max-height:86vh;display:flex;
  flex-direction:column;border-radius:6px;padding:22px 24px;
  border:1px solid var(--line2);
  background:linear-gradient(200deg,rgba(10,17,28,.98),rgba(5,9,16,.99));
  box-shadow:0 40px 120px rgba(0,0,0,.6)}
#ss-roster h2{margin:0 0 4px;font-size:17px;font-weight:500;color:var(--txt)}
#ss-roster .ss-sub{margin:0 0 14px;font-size:12px;color:var(--dim2);line-height:1.6}
#ss-roster .ss-tabs{display:flex;gap:8px;margin:0 0 14px}
#ss-roster .ss-tabs button{flex:1;padding:8px 0;border-radius:3px;font:inherit;
  font-size:12.5px;cursor:pointer;border:1px solid var(--line);
  background:var(--glass);color:var(--dim)}
#ss-roster .ss-tabs button[aria-selected=true]{border-color:var(--acc);
  color:var(--txt);background:rgba(90,169,230,.12)}
#ss-roster .ss-rows{overflow:auto;flex:1;min-height:80px}
#ss-roster .ss-who{display:flex;gap:12px;align-items:flex-start;width:100%;
  padding:12px 13px;margin:0 0 7px;border-radius:4px;text-align:left;
  font:inherit;color:var(--txt);cursor:pointer;
  background:var(--glass);border:1px solid var(--line)}
#ss-roster .ss-who:hover{border-color:var(--acc);background:rgba(90,169,230,.09)}
#ss-roster .ss-who.ss-urgent{border-color:rgba(226,104,95,.5);
  background:rgba(226,104,95,.07)}
#ss-roster .ss-who .ss-main{flex:1;min-width:0}
#ss-roster .ss-who b{display:block;font-weight:500;font-size:13.5px}
#ss-roster .ss-who .ss-meta{display:block;color:var(--dim2);font-size:11px;
  margin-top:3px}
#ss-roster .ss-who .ss-flags{display:flex;flex-wrap:wrap;gap:5px;margin-top:7px}
#ss-roster .ss-who .ss-flags i{font-style:normal;font-size:10.5px;padding:2px 7px;
  border-radius:3px;border:1px solid var(--line2);color:var(--dim)}
#ss-roster .ss-who .ss-flags i.ss-hot{border-color:rgba(226,104,95,.55);color:#e2685f}
#ss-roster .ss-who .ss-flags i.ss-due{border-color:rgba(233,180,92,.55);color:var(--gold)}
#ss-roster .ss-who .ss-n{color:var(--dim2);font-size:11px;white-space:nowrap}
#ss-roster .ss-add{padding:4px 10px;border-radius:3px;font:inherit;font-size:11px;
  cursor:pointer;border:1px solid var(--line2);background:var(--glass);
  color:var(--dim)}
#ss-roster .ss-add:hover{color:var(--txt);border-color:var(--acc)}
#ss-roster .ss-add[disabled]{opacity:.45;cursor:default}
#ss-roster .ss-none{font-size:12.5px;color:var(--dim2);line-height:1.75;margin:0}
#ss-roster .ss-go{display:flex;gap:10px;align-items:center;margin-top:14px}
#ss-roster .ss-go button{padding:9px 16px;border-radius:3px;font:inherit;
  font-size:13px;cursor:pointer;border:1px solid var(--line2);
  background:var(--glass);color:var(--txt)}
#ss-roster .ss-said{margin-left:auto;font-size:11.5px;color:var(--dim2)}
#ss-roster .ss-said.ss-bad{color:var(--gold)}
#ss-roster input.ss-find{width:100%;padding:8px 10px;margin:0 0 10px;
  border-radius:3px;font:inherit;font-size:13px;background:var(--glass);
  border:1px solid var(--line);color:var(--txt)}
/* Flex arithmetic that has to be spelled out. Without flex:none on the
   controls, a long email in the middle column is squeezed to one character
   wide and prints itself vertically -- which is exactly what happened. */
#ss-roster .row .ss-main,#ss-roster .ss-who .ss-main{flex:1 1 auto;min-width:200px;overflow:hidden}
#ss-roster .row .ss-meta,#ss-roster .ss-who .ss-meta{overflow-wrap:anywhere}
#ss-roster .row .tag,#ss-roster .row button,#ss-roster .ss-who button,#ss-roster .ss-who .ss-n{flex:none}

`;

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

export function mount(me, open) {
  if (!me?.can?.coach) return null;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const button = document.createElement('button');
  button.id = 'ss-roster-open';
  button.type = 'button';
  button.innerHTML = '<i>My students</i>';
  button.title = 'Who is coming, and what to read before they arrive';
  button.addEventListener('click', () => dialog(me, open));

  const bar = document.getElementById('topbar');
  const chips = document.getElementById('discBar');
  if (bar && chips) bar.insertBefore(button, chips);
  else document.body.appendChild(button);
  return button;
}

function student(row) {
  const flags = (row.flags ?? []).map((f) => {
    const hot = /not screened|doctor|heart|supervision/i.test(f);
    return `<i class="${ss-hot ? 'ss-hot' : ''}">${esc(f)}</i>`;
  }).join('');
  const due = (row.goals_due ?? [])
    .map((g) => `<i class="ss-due">goal due: ${esc(g)}</i>`).join('');
  const facts = [row.age ? `${row.age}` : '', row.height_m ? `${row.height_m} m` : '',
                 row.mass_kg ? `${row.mass_kg} kg` : ''].filter(Boolean).join(' · ');
  return `<button type="button" class="ss-who${row.urgent ? ' ss-urgent' : ''}"
      data-open="${esc(row.username)}">
    <span class="ss-main">
      <b>${esc(row.display_name)}</b>
      <span class="ss-meta">${esc(facts || 'no measurements on file')}</span>
      <span class="ss-flags">${flags}${due}</span>
    </span>
    <span class="ss-n">${row.sessions ?? 0} class${row.sessions === 1 ? '' : 'es'}</span>
  </button>`;
}

async function dialog(me, open) {
  const host = document.createElement('div');
  host.id = 'ss-roster';
  host.innerHTML = `<div class="ss-box">
    <h2>My students</h2>
    <p class="ss-sub">Ordered by what needs attention, not alphabetically. A red
      row has a safety flag or an overdue goal — read it before the class, not
      after.</p>
    <div class="ss-tabs" role="tablist">
      <button type="button" data-tab="roster" aria-selected="true">My roster</button>
      <button type="button" data-tab="directory" aria-selected="false">Everyone here</button>
    </div>
    <div class="ss-rows">Reading…</div>
    <div class="ss-go"><button type="button" data-close>Close</button>
      <span class="ss-said"></span></div>
  </div>`;
  document.body.appendChild(host);
  const shut = () => host.remove();
  host.querySelector('[data-close]').addEventListener('click', shut);
  host.addEventListener('click', (e) => { if (e.target === host) shut(); });

  const rows = host.querySelector('.ss-rows');
  const said = host.querySelector('.ss-said');
  let tab = 'roster';

  const openStudent = async (username) => {
    said.className = 'ss-said';
    said.textContent = 'Opening…';
    try {
      const record = await get(`student?username=${encodeURIComponent(username)}`);
      const newest = (record.recordings ?? [])[0];
      if (!newest) {
        said.className = 'ss-said ss-bad';
        said.textContent = `${record.display_name} has no recorded class yet.`;
        return;
      }
      const bundle = await get(
        `recording?user=${encodeURIComponent(username)}`
        + `&session=${encodeURIComponent(newest.key)}`);
      await open(bundle);
      shut();
    } catch (error) {
      said.className = 'ss-said ss-bad';
      said.textContent = error.message;
    }
  };

  const draw = async () => {
    rows.innerHTML = 'Reading…';
    try {
      if (tab === 'roster') {
        const { students } = await get('roster');
        rows.innerHTML = students.length
          ? students.map(student).join('')
          : `<p class="ss-none">Nobody on your roster yet. Open <b>Everyone here</b>
             and add somebody — they get a request, and it is their yes that
             lets you see their measurements. Being at the same studio is not
             permission.</p>`;
        for (const row of rows.querySelectorAll('[data-open]')) {
          row.addEventListener('click', () => openStudent(row.dataset.open));
        }
        return;
      }
      const { people } = await get('directory');
      rows.innerHTML = `<input class="ss-find" placeholder="Find a name…">`
        + (people.length ? people.map((p) => `
        <div class="ss-who" data-name="${esc(p.display_name.toLowerCase())}">
          <span class="ss-main"><b>${esc(p.display_name)}</b>
            <span class="ss-meta">${p.mine ? 'on your roster'
              : p.state === 'pending' ? 'waiting for their answer'
              : 'not yours'}</span></span>
          <button type="button" class="ss-add" data-add="${esc(p.username)}"
            ${p.mine || p.state === 'pending' ? 'disabled' : ''}>${
              p.mine ? 'yours' : p.state === 'pending' ? 'asked' : 'ask'}</button>
        </div>`).join('')
        : `<p class="ss-none">No students at this studio yet.</p>`);

      const find = rows.querySelector('.ss-find');
      find?.addEventListener('input', () => {
        const needle = find.value.trim().toLowerCase();
        for (const row of rows.querySelectorAll('[data-name]')) {
          row.hidden = needle && !row.dataset.name.includes(needle);
        }
      });
      for (const add of rows.querySelectorAll('[data-add]')) {
        add.addEventListener('click', async () => {
          add.disabled = true;
          try {
            await post('roster/add', { student: add.dataset.add });
            add.textContent = 'asked';
            said.className = 'ss-said';
            said.textContent = 'Asked. They decide.';
          } catch (error) {
            said.className = 'ss-said ss-bad';
            said.textContent = error.message;
            add.disabled = false;
          }
        });
      }
    } catch (error) {
      rows.innerHTML = `<p class="ss-none">${esc(error.message)}</p>`;
    }
  };

  for (const button of host.querySelectorAll('.ss-tabs button')) {
    button.addEventListener('click', () => {
      tab = button.dataset.tab;
      for (const other of host.querySelectorAll('.ss-tabs button')) {
        other.setAttribute('aria-selected', String(other === button));
      }
      draw();
    });
  }
  draw();
}

/**
 * A coach has asked to work with you. Shown to the student, because consent is
 * theirs to give and a request that sits in a menu is a request nobody answers.
 */
export function requests(me, onAnswer) {
  const waiting = (me.my_coaches ?? []).filter((a) => a.state === 'pending');
  if (!waiting.length) return null;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const host = document.createElement('div');
  host.id = 'ss-roster';
  host.innerHTML = `<div class="ss-box">
    <h2>${waiting.length === 1 ? 'A coach has asked to work with you'
                               : 'Coaches have asked to work with you'}</h2>
    <p class="ss-sub">Saying yes lets them see your measurements, the safety flags
      from your health screening, and your phone number — and write cues and
      goals onto your record. You can take it back at any time.</p>
    <div class="ss-rows">${waiting.map((a) => `
      <div class="ss-who"><span class="ss-main"><b>${esc(a.coach)}</b>
        <span class="ss-meta">at ${esc(a.studio)}</span></span>
        <button type="button" class="ss-add" data-yes="${esc(a.coach)}">Yes</button>
        <button type="button" class="ss-add" data-no="${esc(a.coach)}">Not now</button>
      </div>`).join('')}</div>
    <div class="ss-go"><button type="button" data-close>Decide later</button>
      <span class="ss-said"></span></div>
  </div>`;
  document.body.appendChild(host);
  const said = host.querySelector('.ss-said');
  const shut = () => host.remove();
  host.querySelector('[data-close]').addEventListener('click', shut);

  const answer = async (coach, accept) => {
    said.className = 'ss-said';
    said.textContent = 'Saving…';
    try {
      await post('roster/answer', { coach, accept });
      shut();
      onAnswer?.();
    } catch (error) {
      said.className = 'ss-said ss-bad';
      said.textContent = error.message;
    }
  };
  for (const yes of host.querySelectorAll('[data-yes]')) {
    yes.addEventListener('click', () => answer(yes.dataset.yes, true));
  }
  for (const no of host.querySelectorAll('[data-no]')) {
    no.addEventListener('click', () => answer(no.dataset.no, false));
  }
  return host;
}
