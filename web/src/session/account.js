/**
 * Signing in, and the corner that says who you are.
 *
 * Two things live here. The **gate** -- a full-screen sign-in and sign-up that
 * stands in front of everything when a studio has accounts and nobody is signed
 * in. And the **chip** -- the name in the header, the role you are acting as,
 * and the switch between the roles you hold.
 *
 * The switcher is the part worth reading twice. A person can be admin, coach
 * and student at the same studio, and switching does not add items to a menu:
 * it changes the room. That is the whole design decision from `docs/accounts.md`
 * arriving on screen -- a role is a membership you act as, not a rank you are.
 *
 * Signing up asks which of the two roles you want and **grants neither by
 * itself**. A student is approved on the spot, because a student can see one
 * record and it is their own. A coach waits for the studio, because an approved
 * coach reads other people's health data. Admin is not on the form at all.
 */
const esc = (s) => String(s ?? '').replace(/[&<>"]/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const CSS = `
#ss-gate{position:fixed;inset:0;z-index:200;display:flex;align-items:center;
  justify-content:center;padding:20px;overflow:auto;
  background:radial-gradient(1200px 700px at 50% -10%,rgba(90,169,230,.10),
    rgba(2,5,10,.97) 60%),#02050a}
#ss-gate .ss-card{width:min(430px,100%);border-radius:8px;padding:26px 28px;
  border:1px solid var(--line2);
  background:linear-gradient(200deg,rgba(11,18,30,.98),rgba(5,9,16,.99));
  box-shadow:0 40px 120px rgba(0,0,0,.6)}
#ss-gate .ss-brand{font-size:11px;letter-spacing:.18em;text-transform:uppercase;
  color:var(--acc);margin:0 0 14px}
#ss-gate h2{margin:0 0 5px;font-size:19px;font-weight:500;color:var(--txt)}
#ss-gate .ss-sub{margin:0 0 18px;font-size:12.5px;color:var(--dim2);line-height:1.65}
#ss-gate label{display:block;font-size:10px;letter-spacing:.12em;
  text-transform:uppercase;color:var(--dim2);margin:12px 0 5px}
#ss-gate input,#ss-gate select{width:100%;padding:9px 11px;border-radius:3px;
  font:inherit;font-size:13.5px;background:var(--glass);
  border:1px solid var(--line);color:var(--txt)}
#ss-gate input:focus,#ss-gate select:focus{outline:0;border-color:var(--acc)}
#ss-gate .ss-pair{display:grid;grid-template-columns:1fr 1fr;gap:10px}
#ss-gate .ss-roles{display:flex;gap:8px;margin-top:5px}
#ss-gate .ss-roles button{flex:1;padding:10px 8px;border-radius:4px;cursor:pointer;
  font:inherit;font-size:12.5px;text-align:left;
  border:1px solid var(--line);background:var(--glass);color:var(--dim)}
#ss-gate .ss-roles button[aria-pressed=true]{border-color:var(--acc);
  color:var(--txt);background:rgba(90,169,230,.12)}
#ss-gate .ss-roles b{display:block;font-weight:500;color:var(--txt);
  margin-bottom:2px}
#ss-gate .ss-roles span{font-size:10.5px;line-height:1.45;display:block}
#ss-gate .ss-go{margin-top:20px;display:flex;gap:10px;align-items:center}
#ss-gate .ss-go button{padding:10px 20px;border-radius:3px;font:inherit;
  font-size:13.5px;cursor:pointer;border:1px solid var(--acc);
  background:var(--acc);color:#04121f;font-weight:600}
#ss-gate .ss-go button[disabled]{opacity:.5;cursor:default}
#ss-gate .ss-go .ss-link{background:none;border:0;color:var(--dim);font-weight:400;
  padding:10px 4px;text-decoration:underline;cursor:pointer}
#ss-gate .ss-said{margin:14px 0 0;font-size:12px;line-height:1.6;color:var(--dim2)}
#ss-gate .ss-said.ss-bad{color:var(--gold)}
#ss-gate .ss-said.ss-good{color:var(--acc)}
#ss-gate .ss-note{margin:16px 0 0;padding-left:11px;font-size:11px;line-height:1.65;
  color:var(--dim2);border-left:2px solid var(--line2)}

#ss-who-chip{flex:none;align-self:flex-start;display:flex;gap:8px;
  align-items:center;padding:5px 6px 5px 11px;border-radius:4px;
  border:1px solid var(--line);background:var(--glass);white-space:nowrap}
#ss-who-chip .ss-name{font-size:12px;color:var(--txt)}
#ss-who-chip select{font:inherit;font-size:10.5px;letter-spacing:.1em;
  text-transform:uppercase;padding:3px 5px;border-radius:3px;cursor:pointer;
  background:rgba(90,169,230,.13);border:1px solid rgba(90,169,230,.4);
  color:var(--acc)}
#ss-who-chip button{font:inherit;font-size:11px;padding:4px 8px;border-radius:3px;
  cursor:pointer;background:transparent;border:1px solid transparent;
  color:var(--dim2)}
#ss-who-chip button:hover{color:var(--txt);border-color:var(--line2)}
`;

let style;
function styles() {
  if (style) return;
  style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
}

/** What the server says about this visitor. Null where it keeps no accounts. */
export async function whoami() {
  try {
    const response = await fetch('auth/me', { credentials: 'same-origin' });
    if (!response.ok) return null;
    return await response.json();
  } catch { return null; }
}

async function send(path, body) {
  const response = await fetch(path, {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || response.statusText);
  return payload;
}

export const signOut = () => send('auth/signout');
export const switchTo = (studio, role) => send('auth/switch', { studio, role });

/**
 * The gate.
 *
 * Resolves when somebody is signed in, and never otherwise -- there is no way
 * past it, because the alternative is a page that renders a body before it
 * knows whose it is.
 */
export function gate(me) {
  styles();
  return new Promise((resolve) => {
    const host = document.createElement('div');
    host.id = 'ss-gate';
    document.body.appendChild(host);
    let mode = 'in';
    let wants = 'student';

    const draw = () => {
      const studios = me.studios ?? [];
      const roles = me.roles ?? {};
      host.innerHTML = `<div class="ss-card">
        <p class="ss-brand">Pilates · Movement analysis</p>
        <h2>${mode === 'in' ? 'Sign in' : 'Join this studio'}</h2>
        <p class="ss-sub">${mode === 'in'
          ? 'Your measurements, your progress and what your coach wrote are '
            + 'behind this. Nobody else can see them.'
          : 'Your name and email identify you; your phone number is what keeps '
            + 'two people with similar names apart.'}</p>
        ${mode === 'up' ? `
          <label for="ss-g-name">Your name</label>
          <input id="ss-g-name" autocomplete="name">` : ''}
        <label for="ss-g-email">Email</label>
        <input id="ss-g-email" type="email" autocomplete="email">
        <label for="ss-g-pass">Password</label>
        <input id="ss-g-pass" type="password"
          autocomplete="${mode === 'in' ? 'current-password' : 'new-password'}">
        ${mode === 'up' ? `
          <label for="ss-g-phone">Phone</label>
          <input id="ss-g-phone" placeholder="+998901234567" autocomplete="tel">
          <label for="ss-g-studio">Studio</label>
          <select id="ss-g-studio">${studios.map((s) =>
            `<option value="${esc(s.key)}">${esc(s.name)}${
              s.city ? ` — ${esc(s.city)}` : ''}</option>`).join('')}</select>
          <label>I am joining as</label>
          <div class="ss-roles">${Object.entries(roles).map(([key, what]) => `
            <button type="button" data-role="${esc(key)}"
              aria-pressed="${key === wants}">
              <b>${esc(key[0].toUpperCase() + key.slice(1))}</b>
              <span>${esc(what)}</span></button>`).join('')}</div>
          <div class="ss-pair" style="margin-top:12px">
            <div><label for="ss-g-h">Height (m)</label>
              <input id="ss-g-h" inputmode="decimal" placeholder="1.76"></div>
            <div><label for="ss-g-m">Weight (kg)</label>
              <input id="ss-g-m" inputmode="decimal" placeholder="72"></div>
          </div>` : ''}
        <div class="ss-go">
          <button type="button" data-do>${
            mode === 'in' ? 'Sign in' : 'Create my account'}</button>
          <button type="button" class="ss-link" data-swap>${
            mode === 'in' ? 'I do not have an account' : 'I already have one'}</button>
        </div>
        <p class="ss-said"></p>
        ${mode === 'up' ? `<p class="ss-note">Choosing <b>coach</b> asks the studio;
          it does not make you one. Until somebody there approves it you can see
          your own record and nobody else's.</p>` : ''}
      </div>`;

      const said = host.querySelector('.ss-said');
      const value = (id) => host.querySelector(`#${id}`)?.value.trim() ?? '';

      for (const button of host.querySelectorAll('[data-role]')) {
        button.addEventListener('click', () => {
          wants = button.dataset.role;
          for (const other of host.querySelectorAll('[data-role]')) {
            other.setAttribute('aria-pressed', String(other === button));
          }
        });
      }
      host.querySelector('[data-swap]').addEventListener('click', () => {
        mode = mode === 'in' ? 'up' : 'in';
        draw();
      });

      const go = host.querySelector('[data-do]');
      const submit = async () => {
        go.disabled = true;
        said.className = 'ss-said';
        said.textContent = 'One moment…';
        try {
          if (mode === 'in') {
            await send('auth/signin',
                       { email: value('ss-g-email'), password: value('ss-g-pass') });
            host.remove();
            resolve(await whoami());
            return;
          }
          const welcome = await send('auth/signup', {
            email: value('ss-g-email'), display_name: value('ss-g-name'),
            password: value('ss-g-pass'), phone: value('ss-g-phone'),
            studio: value('ss-g-studio'), wants,
            height_m: value('ss-g-h'), mass_kg: value('ss-g-m'),
          });
          if (welcome.waiting) {
            // Nothing to sign into yet, and saying so beats a login that
            // refuses with no explanation thirty seconds later.
            said.className = 'ss-said ss-good';
            said.textContent = welcome.message;
            go.disabled = false;
            return;
          }
          await send('auth/signin',
                     { email: value('ss-g-email'), password: value('ss-g-pass') });
          host.remove();
          resolve(await whoami());
        } catch (error) {
          said.className = 'ss-said ss-bad';
          said.textContent = error.message;
          go.disabled = false;
        }
      };
      go.addEventListener('click', submit);
      for (const input of host.querySelectorAll('input')) {
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
      }
      host.querySelector('#ss-g-email')?.focus();
    };
    draw();
  });
}

/**
 * The name in the header, and the switch between the roles you hold.
 *
 * Only drawn as a switcher when there is something to switch between. One
 * membership is not a choice, and a dropdown with one item in it is furniture.
 */
export function chip(me, onSwitch) {
  styles();
  const held = me.memberships ?? [];
  const acting = me.acting ?? {};
  const box = document.createElement('div');
  box.id = 'ss-who-chip';
  const name = me.account?.display_name || acting.username || '';
  box.innerHTML = `<span class="ss-name">${esc(name)}</span>
    ${held.length > 1 ? `<select data-role>${held.map((m) => `
      <option value="${esc(m.studio)}|${esc(m.role)}"
        ${m.studio === acting.studio && m.role === acting.role ? 'selected' : ''}
        >${esc(m.role)}</option>`).join('')}</select>`
      : `<span class="ss-name" style="color:var(--acc);font-size:10.5px;
           letter-spacing:.1em;text-transform:uppercase">${esc(acting.role ?? '')}</span>`}
    <button type="button" data-out>Sign out</button>`;

  box.querySelector('[data-role]')?.addEventListener('change', async (event) => {
    const [studio, role] = event.target.value.split('|');
    try {
      await switchTo(studio, role);
      onSwitch?.(studio, role);
    } catch (error) {
      console.error('[account] could not switch role:', error);
    }
  });
  box.querySelector('[data-out]').addEventListener('click', async () => {
    await signOut().catch(() => {});
    location.reload();
  });

  const bar = document.getElementById('topbar');
  const chips = document.getElementById('discBar');
  if (bar && chips) bar.insertBefore(box, chips);
  else if (bar) bar.appendChild(box);
  else document.body.appendChild(box);
  return box;
}
