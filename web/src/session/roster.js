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
 * already yours. Adding somebody from it takes effect at once -- there used to
 * be a round trip, the coach asking and the student accepting, and it was the
 * wrong shape for a studio: nobody joins a gym and then negotiates with each
 * instructor. **Add all** puts the room on your roster in one press.
 *
 * Removing is the same one press from either side, which is where the student's
 * control actually lives: they see who can open their record and take any of
 * them out of it, and every read is in the log either way.
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
#ss-mine-open{flex:none;align-self:flex-start;display:inline-flex;
  align-items:center;padding:7px 14px;border-radius:4px;cursor:pointer;
  font:inherit;font-size:11.5px;letter-spacing:.09em;text-transform:uppercase;
  white-space:nowrap;background:var(--glass);border:1px solid var(--line2);
  color:var(--dim)}
#ss-mine-open:hover{color:var(--txt);border-color:var(--acc)}
#ss-mine-open i{font-style:normal;font-weight:600}
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
#ss-roster .ss-who .ss-flags i.ss-focus{border-color:rgba(90,169,230,.5);color:var(--acc)}
#ss-roster .ss-who .ss-flags i.ss-plan{border-color:transparent;color:var(--dim2);
  padding-left:0;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#ss-roster .ss-who .ss-flags i.ss-cold{border-style:dashed;color:var(--dim2)}
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
#ss-roster input.ss-find{flex:1 1 160px;min-width:120px;padding:8px 10px;
  border-radius:3px;font:inherit;font-size:13px;background:var(--glass);
  border:1px solid var(--line);color:var(--txt)}
/* One row of controls above the list: find, two filters, and the bulk add. */
#ss-roster .ss-tools{display:flex;flex-wrap:wrap;gap:7px;margin:0 0 11px;
  align-items:center}
#ss-roster .ss-chip{flex:none;padding:7px 11px;border-radius:3px;cursor:pointer;
  font:inherit;font-size:11.5px;background:var(--glass);
  border:1px solid var(--line);color:var(--dim)}
#ss-roster .ss-chip:hover{color:var(--txt);border-color:var(--line2)}
#ss-roster .ss-chip[aria-pressed=true]{border-color:var(--acc);color:var(--txt);
  background:rgba(90,169,230,.12)}
#ss-roster .ss-chip em{font-style:normal;margin-left:5px;color:var(--dim2)}
#ss-roster .ss-all{flex:none;margin-left:auto;padding:7px 14px;border-radius:3px;
  cursor:pointer;font:inherit;font-size:12px;font-weight:600;
  background:var(--acc);border:1px solid var(--acc);color:#04121f}
#ss-roster .ss-all:hover{filter:brightness(1.1)}
#ss-roster .ss-all[disabled]{opacity:.4;cursor:default;filter:none}
/* Flex arithmetic that has to be spelled out. Without flex:none on the
   controls, a long name in the middle column is squeezed to one character
   wide and prints itself vertically -- which is exactly what happened. */
#ss-roster .ss-who .ss-main{flex:1 1 auto;min-width:180px;overflow:hidden}
#ss-roster .ss-who .ss-meta{overflow-wrap:anywhere}
#ss-roster .ss-who button,#ss-roster .ss-who .ss-n,
#ss-roster .ss-who .ss-add{flex:none;align-self:center}

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
    return `<i class="${hot ? 'ss-hot' : ''}">${esc(f)}</i>`;
  }).join('');
  const due = (row.goals_due ?? [])
    .map((g) => `<i class="ss-due">goal due: ${esc(g)}</i>`).join('');
  const facts = [row.age ? `${row.age}` : '', row.height_m ? `${row.height_m} m` : '',
                 row.mass_kg ? `${row.mass_kg} kg` : ''].filter(Boolean).join(' · ');
  /* What to work on, on the way into the class rather than two clicks inside
   * it. An evaluation nobody reads before the class changes nothing about the
   * class, and "never scored" is a thing to see rather than an absence. */
  const work = row.evaluations
    ? `<i class="ss-focus">work on ${esc(row.focus || 'the five')}</i>`
      + (row.plan ? `<i class="ss-plan">${esc(row.plan)}</i>` : '')
    : '<i class="ss-cold">never scored</i>';
  return `<button type="button" class="ss-who${row.urgent ? ' ss-urgent' : ''}"
      data-open="${esc(row.username)}"
      data-name="${esc((row.display_name || '').toLowerCase())}">
    <span class="ss-main">
      <b>${esc(row.display_name)}</b>
      <span class="ss-meta">${esc(facts || 'no measurements on file')}</span>
      <span class="ss-flags">${flags}${due}${work}</span>
    </span>
    <span class="ss-n">${row.sessions ?? 0} class${row.sessions === 1 ? '' : 'es'}</span>
    <span class="ss-add" role="button" tabindex="0"
      data-drop="${esc(row.username)}"
      title="Take them off your roster. They keep their record; you stop
seeing anything new in it.">remove</span>
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
  const mine = me?.acting?.username ?? '';
  let tab = 'roster';

  const tell = (text, bad = false) => {
    said.className = bad ? 'ss-said ss-bad' : 'ss-said';
    said.textContent = text;
  };

  /**
   * One search box and a couple of chips, wired the same way on both tabs.
   *
   * Filtering in the page rather than the server: these are the people at one
   * studio, they are already here, and a round trip per keystroke to narrow
   * twenty rows is a slower answer to a question already on screen.
   */
  const wireFilter = (root) => {
    const find = root.querySelector('.ss-find');
    let only = '';
    const apply = () => {
      const needle = (find?.value ?? '').trim().toLowerCase();
      for (const row of root.querySelectorAll('[data-name]')) {
        const matches = !needle || row.dataset.name.includes(needle);
        const kind = only === 'urgent' ? row.classList.contains('ss-urgent')
                   : only === 'spare' ? row.classList.contains('ss-spare')
                   : true;
        row.hidden = !(matches && kind);
      }
      for (const chip of root.querySelectorAll('[data-only]')) {
        chip.setAttribute('aria-pressed', String(chip.dataset.only === only));
      }
    };
    find?.addEventListener('input', apply);
    for (const chip of root.querySelectorAll('[data-only]')) {
      chip.addEventListener('click', () => { only = chip.dataset.only; apply(); });
    }
    apply();
  };

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
          ? `<div class="ss-tools">
               <input class="ss-find" placeholder="Find a name…">
               <button type="button" class="ss-chip" data-only="urgent">
                 Needs attention</button>
               <button type="button" class="ss-chip" data-only="">All
                 <em>${students.length}</em></button>
             </div>` + students.map(student).join('')
          : `<p class="ss-none">Nobody on your roster yet. Open
             <b>Everyone here</b> and press <b>Add all</b> — they go on
             straight away.</p>`;
        wireFilter(rows);
        for (const row of rows.querySelectorAll('[data-open]')) {
          row.addEventListener('click', () => openStudent(row.dataset.open));
        }
        for (const drop of rows.querySelectorAll('[data-drop]')) {
          drop.addEventListener('click', async (event) => {
            event.stopPropagation();      // the row itself opens the student
            try {
              await post('roster/remove', { coach: mine, student: drop.dataset.drop });
              tell('Removed.');
              draw();
            } catch (error) { tell(error.message, true); }
          });
        }
        return;
      }

      const { people, not_mine: spare } = await get('directory');
      rows.innerHTML = people.length ? `
        <div class="ss-tools">
          <input class="ss-find" placeholder="Find a name…">
          <button type="button" class="ss-chip" data-only="spare">Not yours
            <em>${spare.length}</em></button>
          <button type="button" class="ss-chip" data-only="">All
            <em>${people.length}</em></button>
          <button type="button" class="ss-all" data-addall
            ${spare.length ? '' : 'disabled'}>Add all ${
              spare.length ? `(${spare.length})` : ''}</button>
        </div>` + people.map((p) => `
        <div class="ss-who${p.mine ? '' : ' ss-spare'}"
             data-name="${esc(p.display_name.toLowerCase())}">
          <span class="ss-main"><b>${esc(p.display_name)}</b>
            <span class="ss-meta">${p.mine ? 'on your roster'
                                           : 'not on your roster'}</span></span>
          ${p.mine
            ? `<button type="button" class="ss-add" data-drop="${esc(p.username)}"
                 >remove</button>`
            : `<button type="button" class="ss-add" data-add="${esc(p.username)}"
                 >add</button>`}
        </div>`).join('')
        : `<p class="ss-none">No students at this studio yet.</p>`;

      wireFilter(rows);
      const addThese = async (names, button) => {
        if (button) button.disabled = true;
        try {
          const out = await post('roster/add', { students: names });
          tell(out.message);
          draw();
        } catch (error) {
          tell(error.message, true);
          if (button) button.disabled = false;
        }
      };
      rows.querySelector('[data-addall]')?.addEventListener('click',
        (event) => addThese(spare, event.currentTarget));
      for (const add of rows.querySelectorAll('[data-add]')) {
        add.addEventListener('click',
          (event) => addThese([add.dataset.add], event.currentTarget));
      }
      for (const drop of rows.querySelectorAll('[data-drop]')) {
        drop.addEventListener('click', async () => {
          try {
            await post('roster/remove', { coach: mine, student: drop.dataset.drop });
            tell('Removed.');
            draw();
          } catch (error) { tell(error.message, true); }
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
 * Who can open my record, and a button to stop them.
 *
 * The student's half of the design, and the reason adding a student can be
 * immediate. There used to be a prompt here instead -- a coach has asked, do
 * you accept -- and a prompt is the weaker thing: it arrives once, at a moment
 * nobody is thinking about it, and after that there is nowhere to go and look.
 * This is always here, always current, and one press wide.
 */
export function coaches(me) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const button = document.createElement('button');
  button.id = 'ss-mine-open';
  button.type = 'button';
  button.innerHTML = '<i>Who sees my record</i>';
  button.title = 'The coaches who can open your measurements, and how to '
               + 'stop them';
  button.addEventListener('click', () => panel());

  const bar = document.getElementById('topbar');
  const chips = document.getElementById('discBar');
  if (bar && chips) bar.insertBefore(button, chips);
  else document.body.appendChild(button);
  return button;
}

async function panel() {
  const host = document.createElement('div');
  host.id = 'ss-roster';
  host.innerHTML = `<div class="ss-box">
    <h2>Who can see my record</h2>
    <p class="ss-sub">These coaches can open your measurements and the safety
      flags from your health screening, and write cues and goals onto your
      record. Every time one of them opens it, it is in your log. Take anybody
      out and they stop seeing anything recorded from that moment.</p>
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
  const draw = async () => {
    rows.innerHTML = 'Reading…';
    try {
      const { coaches: mine } = await get('me/coaches');
      rows.innerHTML = mine.length ? mine.map((c) => `
        <div class="ss-who"><span class="ss-main">
          <b>${esc(c.display_name)}</b>
          <span class="ss-meta">at ${esc(c.studio)} · since ${esc(c.since)}
            · sees ${esc((c.sees || []).join(', ') || 'nothing')}</span>
        </span>
        <button type="button" class="ss-add" data-drop="${esc(c.username)}"
          >remove</button></div>`).join('')
        : `<p class="ss-none">Nobody. No coach can open your record —
           only you and an admin of your studio can.</p>`;
      for (const drop of rows.querySelectorAll('[data-drop]')) {
        drop.addEventListener('click', async () => {
          drop.disabled = true;
          try {
            const out = await post('roster/remove', { coach: drop.dataset.drop });
            said.className = 'ss-said';
            said.textContent = out.message;
            draw();
          } catch (error) {
            said.className = 'ss-said ss-bad';
            said.textContent = error.message;
            drop.disabled = false;
          }
        });
      }
    } catch (error) {
      rows.innerHTML = `<p class="ss-none">${esc(error.message)}</p>`;
    }
  };
  draw();
  return host;
}
