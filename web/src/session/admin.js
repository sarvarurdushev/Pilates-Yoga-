/**
 * The admin's console: roles, people, and the log of who saw what.
 *
 * Small on purpose. An admin here does four things -- decide who is a coach,
 * grant a role, invite somebody, and read the audit log -- and each is a
 * deliberate act with a line in the log afterwards. The research on how role
 * systems fail is blunt about the alternative: opaque roles and a settings page
 * lead to somebody handing out admin "to be safe" and quietly creating a hole.
 *
 * So: no custom roles, no permission matrix to edit, three names that mean what
 * they say. What an admin gets that nobody else does is *everything*, and the
 * price of that is that every read is written down.
 */
const esc = (s) => String(s ?? '').replace(/[&<>"]/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const CSS = `
#ss-admin-open{flex:none;align-self:flex-start;display:inline-flex;
  align-items:center;padding:7px 14px;border-radius:4px;cursor:pointer;
  font:inherit;font-size:11.5px;letter-spacing:.09em;text-transform:uppercase;
  white-space:nowrap;background:rgba(226,104,95,.12);
  border:1px solid rgba(226,104,95,.45);color:var(--txt)}
#ss-admin-open:hover{background:rgba(226,104,95,.2)}
#ss-admin-open em{font-style:normal;color:#e2685f;font-weight:600}
#ss-admin-open b{margin-left:7px;font-weight:600;color:#e2685f}
#ss-admin{position:fixed;inset:0;z-index:130;display:flex;align-items:center;
  justify-content:center;background:rgba(2,5,10,.8);backdrop-filter:blur(3px)}
#ss-admin .ss-box{width:min(760px,95vw);max-height:88vh;display:flex;
  flex-direction:column;border-radius:6px;padding:22px 24px;
  border:1px solid var(--line2);
  background:linear-gradient(200deg,rgba(10,17,28,.98),rgba(5,9,16,.99));
  box-shadow:0 40px 120px rgba(0,0,0,.6)}
#ss-admin h2{margin:0 0 4px;font-size:17px;font-weight:500;color:var(--txt)}
#ss-admin .ss-sub{margin:0 0 14px;font-size:12px;color:var(--dim2);line-height:1.6}
#ss-admin .ss-tabs{display:flex;gap:8px;margin:0 0 14px}
#ss-admin .ss-tabs button{flex:1;padding:8px 0;border-radius:3px;font:inherit;
  font-size:12.5px;cursor:pointer;border:1px solid var(--line);
  background:var(--glass);color:var(--dim)}
#ss-admin .ss-tabs button[aria-selected=true]{border-color:var(--acc);
  color:var(--txt);background:rgba(90,169,230,.12)}
#ss-admin .ss-rows{overflow:auto;flex:1;min-height:100px}
#ss-admin .ss-row{display:flex;gap:12px;align-items:center;padding:11px 13px;
  margin:0 0 6px;border-radius:4px;background:var(--glass);
  border:1px solid var(--line)}
#ss-admin .ss-row.ss-wants{border-color:rgba(233,180,92,.5);
  background:rgba(233,180,92,.07)}
#ss-admin .ss-row .ss-main{flex:1;min-width:0}
#ss-admin .ss-row b{display:block;font-weight:500;font-size:13px;color:var(--txt)}
#ss-admin .ss-row .ss-meta{display:block;color:var(--dim2);font-size:11px;
  margin-top:3px;word-break:break-word}
#ss-admin .ss-row .ss-tag{font-size:10px;letter-spacing:.1em;text-transform:uppercase;
  padding:2px 7px;border-radius:3px;border:1px solid var(--line2);
  color:var(--dim)}
#ss-admin .ss-row .ss-tag.ss-role-admin{border-color:rgba(226,104,95,.5);
  color:#e2685f}
#ss-admin .ss-row .ss-tag.ss-role-coach{border-color:rgba(233,180,92,.5);
  color:var(--gold)}
#ss-admin button.ss-act{padding:5px 11px;border-radius:3px;font:inherit;
  font-size:11.5px;cursor:pointer;border:1px solid var(--line2);
  background:var(--glass);color:var(--txt);white-space:nowrap}
#ss-admin button.ss-act:hover{border-color:var(--acc)}
#ss-admin button.ss-act.ss-warn:hover{border-color:#e2685f;color:#e2685f}
#ss-admin .ss-none{font-size:12.5px;color:var(--dim2);line-height:1.75;margin:0}
#ss-admin .ss-go{display:flex;gap:10px;align-items:center;margin-top:14px}
#ss-admin .ss-go button{padding:9px 16px;border-radius:3px;font:inherit;
  font-size:13px;cursor:pointer;border:1px solid var(--line2);
  background:var(--glass);color:var(--txt)}
#ss-admin .ss-said{margin-left:auto;font-size:11.5px;color:var(--dim2);
  text-align:right;max-width:60%}
#ss-admin .ss-said.ss-bad{color:var(--gold)}
#ss-admin .ss-log{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
  font-size:11px;line-height:1.8;color:var(--dim)}
#ss-admin .ss-log b{color:var(--txt);font-weight:500}
#ss-admin .ss-invite{display:flex;gap:8px;margin:0 0 12px}
#ss-admin .ss-invite input,#ss-admin .ss-invite select{padding:8px 10px;
  border-radius:3px;font:inherit;font-size:13px;background:var(--glass);
  border:1px solid var(--line);color:var(--txt)}
#ss-admin .ss-invite input{flex:1}
#ss-admin .ss-invite select{flex:0 1 auto;max-width:180px}
#ss-admin .ss-invite input[type=checkbox]{flex:none}
#ss-admin .ss-tools{display:flex;flex-wrap:wrap;gap:7px;margin:0 0 11px;
  align-items:center}
#ss-admin input.ss-find{flex:1 1 180px;min-width:140px;padding:8px 10px;
  border-radius:3px;font:inherit;font-size:13px;background:var(--glass);
  border:1px solid var(--line);color:var(--txt)}
#ss-admin .ss-chip{flex:none;padding:7px 11px;border-radius:3px;cursor:pointer;
  font:inherit;font-size:11.5px;background:var(--glass);
  border:1px solid var(--line);color:var(--dim)}
#ss-admin .ss-chip:hover{color:var(--txt);border-color:var(--line2)}
#ss-admin .ss-chip[aria-pressed=true]{border-color:var(--acc);color:var(--txt);
  background:rgba(90,169,230,.12)}
#ss-admin .ss-chip em{font-style:normal;margin-left:5px;color:var(--dim2)}
#ss-admin .ss-fill{flex:1;font-size:11.5px;color:var(--dim2);line-height:1.55;
  align-self:center}
/* Flex arithmetic that has to be spelled out. Without flex:none on the
   controls, a long email in the middle column is squeezed to one character
   wide and prints itself vertically -- which is exactly what happened. */
#ss-admin .ss-row .ss-main{flex:1 1 auto;min-width:200px;overflow:hidden}
#ss-admin .ss-row .ss-meta{overflow-wrap:anywhere}
#ss-admin .ss-row .ss-tag,#ss-admin .ss-row button{flex:none}

`;

/** Whether somebody holds a role, and whether anything about them needs eyes. */
const has = (person, role) => (person.memberships ?? [])
  .some((m) => m.role === role && m.state === 'active');

const flagged = (person) => {
  const flags = person.screening?.flags ?? [];
  return !person.screening
      || flags.some((f) => /not screened|doctor|heart|supervision/i.test(f));
};

/**
 * One search box and a row of role chips, filtering in the page.
 *
 * These are the people at one studio; they are already on screen. A round trip
 * per keystroke to narrow twenty rows is a slower answer to a question that has
 * already been answered.
 */
function wireFilter(root) {
  const find = root.querySelector('.ss-find');
  let only = '';
  const apply = () => {
    const needle = (find?.value ?? '').trim().toLowerCase();
    for (const row of root.querySelectorAll('[data-name]')) {
      const matches = !needle || row.dataset.name.includes(needle);
      const kind = !only
        || (only === 'flagged' ? row.dataset.flagged
                               : row.dataset.roles.split(' ').includes(only));
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

export function mount(me) {
  if (!me?.can?.administer) return null;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const button = document.createElement('button');
  button.id = 'ss-admin-open';
  button.type = 'button';
  button.innerHTML = '<em>Studio</em>';
  button.title = 'Roles, people and the audit log';
  button.addEventListener('click', () => dialog(me));
  refreshBadge(button);

  const bar = document.getElementById('topbar');
  const chips = document.getElementById('discBar');
  if (bar && chips) bar.insertBefore(button, chips);
  else document.body.appendChild(button);
  return button;
}

/** A count on the button, because a request nobody sees is a person waiting. */
async function refreshBadge(button) {
  try {
    const { pending } = await get('admin/pending');
    button.innerHTML = '<em>Studio</em>'
      + (pending.length ? `<b>${pending.length}</b>` : '');
  } catch { /* not an admin any more, or offline */ }
}

async function dialog(me) {
  const host = document.createElement('div');
  host.id = 'ss-admin';
  host.innerHTML = `<div class="ss-box">
    <h2>Studio</h2>
    <p class="ss-sub">Roles are granted here and nowhere else. Every grant, every
      read of somebody's record, and every sign-in is in the log.</p>
    <div class="ss-tabs" role="tablist">
      <button type="button" data-tab="waiting" aria-selected="true">Waiting</button>
      <button type="button" data-tab="people" aria-selected="false">People</button>
      <button type="button" data-tab="studios" aria-selected="false">Studios</button>
      <button type="button" data-tab="log" aria-selected="false">Log</button>
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
  let tab = 'waiting';

  const tell = (text, bad = false) => {
    said.className = bad ? 'ss-said ss-bad' : 'ss-said';
    said.textContent = text;
  };

  const drawWaiting = async () => {
    const { pending } = await get('admin/pending');
    rows.innerHTML = pending.length ? pending.map((row) => `
      <div class="ss-row ss-wants">
        <span class="ss-main"><b>${esc(row.display_name)}</b>
          <span class="ss-meta">${esc(row.email)}${
            row.phone ? ` · ${esc(row.phone)}` : ''} · asked ${esc(row.since)}</span>
        </span>
        <span class="ss-tag ss-role-${esc(row.role)}">wants ${esc(row.role)}</span>
        <button type="button" class="ss-act" data-yes="${esc(row.username)}"
          data-role="${esc(row.role)}">Approve</button>
        <button type="button" class="ss-act ss-warn" data-no="${esc(row.username)}"
          data-role="${esc(row.role)}">Refuse</button>
      </div>`).join('')
      : `<p class="ss-none">Nothing waiting. When somebody signs up asking to
         coach, they appear here and can see nothing but their own record until
         you decide.</p>`;

    for (const yes of rows.querySelectorAll('[data-yes]')) {
      yes.addEventListener('click', async () => {
        try {
          await post('admin/decide', { username: yes.dataset.yes,
                                       role: yes.dataset.role, state: 'active' });
          tell('Approved.');
          drawWaiting();
        } catch (error) { tell(error.message, true); }
      });
    }
    for (const no of rows.querySelectorAll('[data-no]')) {
      no.addEventListener('click', async () => {
        try {
          await post('admin/decide', { username: no.dataset.no,
                                       role: no.dataset.role, state: 'left' });
          tell('Refused. Their own record still works.');
          drawWaiting();
        } catch (error) { tell(error.message, true); }
      });
    }
  };

  const drawPeople = async () => {
    const { people, studios } = await get('admin/people');
    const options = (studios ?? []).map((s) =>
      `<option value="${esc(s.key)}">${esc(s.name)}</option>`).join('');
    rows.innerHTML = `
      <div class="ss-invite">
        <input data-invite-email placeholder="Invite an email…">
        <select data-invite-role>
          <option value="coach">as coach</option>
          <option value="student">as student</option>
          <option value="admin">as admin</option>
        </select>
        <select data-invite-studio>${options}</select>
        <button type="button" class="ss-act" data-invite>Invite</button>
      </div>
      <!-- The fixture, reachable from a hosted deployment where there is no
           terminal to run a command in. -->
      <div class="ss-invite">
        <span class="ss-fill">Nobody here yet? Add sixteen people who do not
          exist — coaches, students, consent in every state and twelve weeks of
          measurements — so there is something to click.</span>
        <button type="button" class="ss-act" data-seed>Add demo people</button>
      </div>
      <div class="ss-tools">
        <input class="ss-find" placeholder="Find a name or email…">
        <button type="button" class="ss-chip" data-only="admin">Admins
          <em>${people.filter((p) => has(p, 'admin')).length}</em></button>
        <button type="button" class="ss-chip" data-only="coach">Coaches
          <em>${people.filter((p) => has(p, 'coach')).length}</em></button>
        <button type="button" class="ss-chip" data-only="student">Students
          <em>${people.filter((p) => has(p, 'student')).length}</em></button>
        <button type="button" class="ss-chip" data-only="flagged">Flagged
          <em>${people.filter(flagged).length}</em></button>
        <button type="button" class="ss-chip" data-only="">All
          <em>${people.length}</em></button>
      </div>
      ${people.map((person) => {
        const roles = (person.memberships ?? [])
          .filter((m) => m.state === 'active')
          .map((m) => `<span class="ss-tag ss-role-${esc(m.role)}">${esc(m.role)}</span>`)
          .join(' ');
        const facts = [person.age && `${person.age}`, person.phone,
                       (person.screening?.flags ?? []).join(', ')]
          .filter(Boolean).join(' · ');
        return `<div class="ss-row" data-roles="${
            (person.memberships ?? []).filter((m) => m.state === 'active')
              .map((m) => m.role).join(' ')}"
            data-flagged="${flagged(person) ? '1' : ''}"
            data-name="${esc(`${person.display_name} ${person.email ?? ''}`
                             .toLowerCase())}">
          <span class="ss-main"><b>${esc(person.display_name)}</b>
            <span class="ss-meta">${esc(person.email ?? '')}${
              facts ? ` · ${esc(facts)}` : ''}</span></span>
          ${roles}
          <button type="button" class="ss-act" data-make="${esc(person.username)}"
            data-role="coach">+ coach</button>
          <button type="button" class="ss-act ss-warn" data-make="${esc(person.username)}"
            data-role="admin">+ admin</button>
          <button type="button" class="ss-act" data-reset="${esc(person.username)}"
            title="Issue a one-time link they use to choose their own password"
            >reset</button>
        </div>`;
      }).join('')}`;

    wireFilter(rows);
    for (const make of rows.querySelectorAll('[data-make]')) {
      make.addEventListener('click', async () => {
        const role = make.dataset.role;
        if (role === 'admin' && !window.confirm(
            'An admin can read every health record in this studio and grant '
          + 'that power to anybody else. Give it to this person?')) return;
        try {
          await post('admin/grant', { username: make.dataset.make, role });
          tell(`Granted ${role}.`);
          drawPeople();
        } catch (error) { tell(error.message, true); }
      });
    }
    for (const reset of rows.querySelectorAll('[data-reset]')) {
      reset.addEventListener('click', async () => {
        /* A link, not a password. An admin who sets somebody's password knows
         * it, and then a student's record has two people who can open it and
         * only one who should. */
        try {
          const out = await post('admin/reset', { username: reset.dataset.reset });
          await navigator.clipboard?.writeText(out.link).catch(() => {});
          tell(`Reset link copied — hand it to them. It works once and lasts `
             + `${out.hours} hours. Issuing another cancels it.`);
        } catch (error) { tell(error.message, true); }
      });
    }
    rows.querySelector('[data-seed]')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      tell('Making them…');
      try {
        const out = await post('admin/seed', {});
        tell(out.message);
        drawPeople();
      } catch (error) {
        tell(error.message, true);
        button.disabled = false;
      }
    });
    rows.querySelector('[data-invite]')?.addEventListener('click', async () => {
      const email = rows.querySelector('[data-invite-email]').value.trim();
      const role = rows.querySelector('[data-invite-role]').value;
      const studio = rows.querySelector('[data-invite-studio]').value;
      try {
        const { token } = await post('admin/invite', { email, role, studio });
        const link = `${location.origin}${location.pathname}?invite=${token}`;
        await navigator.clipboard?.writeText(link).catch(() => {});
        tell('Invitation link copied. It is not stored and cannot be looked '
           + 'up again.');
      } catch (error) { tell(error.message, true); }
    });
  };

  /**
   * Locations, which an owner of two of them needs on day one.
   *
   * Everything else in this console works inside the studio the admin happens
   * to be acting in. Moving somebody is by definition about a different one, so
   * this is the only tab that reaches across.
   */
  const drawStudios = async () => {
    const [{ studios, acting }, { people }] = await Promise.all([
      get('admin/studios'), get('admin/people'),
    ]);
    const everybody = people.map((p) =>
      `<option value="${esc(p.username)}">${esc(p.display_name)}</option>`).join('');
    /* The studio you are acting in is preselected. Without it the list opens
     * on whichever location sorts first, so "assign all" and "move" quietly
     * point at the wrong place and the admin only finds out from the result. */
    const places = studios.map((s) =>
      `<option value="${esc(s.key)}"${s.key === acting ? ' selected' : ''}>${
        esc(s.name)}</option>`).join('');
    /* Only coaches who actually teach where you are assigning. Offering every
     * coach in the company means picking one who works somewhere else and
     * being told nothing happened. */
    const coachesHere = people.filter((p) => (p.memberships ?? [])
      .some((m) => m.role === 'coach' && m.state === 'active'
                   && m.studio === acting));
    const coaches = coachesHere.map((p) =>
      `<option value="${esc(p.username)}">${esc(p.display_name)}</option>`).join('');

    rows.innerHTML = `
      <div class="ss-invite">
        <input data-new-name placeholder="New location name…">
        <input data-new-city placeholder="City" style="flex:0 1 120px">
        <input data-new-country placeholder="KR" style="flex:0 1 70px">
        <button type="button" class="ss-act" data-new-studio>Add location</button>
      </div>
      <div class="ss-invite">
        <span class="ss-fill">Put somebody in a location</span>
        <select data-move-who>${everybody}</select>
        <select data-move-role>
          <option value="student">as student</option>
          <option value="coach">as coach</option>
          <option value="admin">as admin</option>
        </select>
        <select data-move-where>${places}</select>
        <label style="display:flex;gap:5px;align-items:center;font-size:11px;
                      color:var(--dim2);white-space:nowrap">
          <input type="checkbox" data-move-leave style="width:auto;margin:0">
          and leave the old one</label>
        <button type="button" class="ss-act" data-move>Move</button>
      </div>
      ${coaches ? `<div class="ss-invite">
        <span class="ss-fill">Give one coach every student at a location</span>
        <select data-all-coach>${coaches}</select>
        <select data-all-studio>${places}</select>
        <button type="button" class="ss-act" data-assign-all>Assign all</button>
      </div>` : ''}
      ${studios.map((s) => `<div class="ss-row">
        <span class="ss-main"><b>${esc(s.name)}</b>
          <span class="ss-meta">${esc(s.key)}${
            s.city ? ` · ${esc(s.city)}` : ''}${
            s.country ? `, ${esc(s.country)}` : ''} · ${esc(s.timezone)}</span></span>
        <span class="ss-tag">${s.students} student${s.students === 1 ? '' : 's'}</span>
        <span class="ss-tag">${s.coaches} coach${s.coaches === 1 ? '' : 'es'}</span>
        ${s.key === acting ? '<span class="ss-tag ss-role-admin">acting here</span>'
          : s.mine ? '<span class="ss-tag">yours</span>' : ''}
      </div>`).join('')}`;

    rows.querySelector('[data-new-studio]')?.addEventListener('click', async () => {
      const name = rows.querySelector('[data-new-name]').value.trim();
      if (!name) { tell('The location needs a name.', true); return; }
      try {
        const out = await post('admin/studio', {
          name, city: rows.querySelector('[data-new-city]').value.trim(),
          country: rows.querySelector('[data-new-country]').value.trim(),
        });
        tell(`${out.studio.name} added. You are its admin — switch to it in the `
           + 'header to work there.');
        drawStudios();
      } catch (error) { tell(error.message, true); }
    });

    rows.querySelector('[data-move]')?.addEventListener('click', async () => {
      try {
        const out = await post('admin/move', {
          username: rows.querySelector('[data-move-who]').value,
          role: rows.querySelector('[data-move-role]').value,
          studio: rows.querySelector('[data-move-where]').value,
          leave: rows.querySelector('[data-move-leave]').checked,
        });
        tell(out.message);
        drawStudios();
      } catch (error) { tell(error.message, true); }
    });

    /* Change the location and the coach list follows it. The pair has to stay
     * consistent or the button assigns a coach to a studio they do not teach
     * at, which the server correctly turns into "nobody was added". */
    const coachesAt = (key) => people.filter((p) => (p.memberships ?? [])
      .some((m) => m.role === 'coach' && m.state === 'active' && m.studio === key));
    rows.querySelector('[data-all-studio]')?.addEventListener('change', (event) => {
      const list = rows.querySelector('[data-all-coach]');
      const here = coachesAt(event.target.value);
      list.innerHTML = here.length
        ? here.map((p) => `<option value="${esc(p.username)}">${
            esc(p.display_name)}</option>`).join('')
        : '<option value="">no coach works there yet</option>';
    });

    rows.querySelector('[data-assign-all]')?.addEventListener('click', async () => {
      const who = rows.querySelector('[data-all-coach]').value;
      if (!who) { tell('Give that location a coach first.', true); return; }
      try {
        const out = await post('admin/assign-all', {
          coach: who, studio: rows.querySelector('[data-all-studio]').value,
        });
        tell(out.message);
      } catch (error) { tell(error.message, true); }
    });
  };

  const drawLog = async () => {
    const { events } = await get('audit');
    rows.innerHTML = events.length
      ? `<div class="ss-log">${events.map((e) => `
          <div><b>${esc(e.at.replace('T', ' ').replace('+00:00', ''))}</b>
          ${esc(e.actor || '—')} → <b>${esc(e.action)}</b>
          ${e.subject ? esc(e.subject) : ''}
          ${e.detail ? `(${esc(e.detail)})` : ''}</div>`).join('')}</div>`
      : `<p class="ss-none">Nothing logged yet.</p>`;
  };

  const draw = async () => {
    rows.innerHTML = 'Reading…';
    try {
      if (tab === 'waiting') await drawWaiting();
      else if (tab === 'people') await drawPeople();
      else if (tab === 'studios') await drawStudios();
      else await drawLog();
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
