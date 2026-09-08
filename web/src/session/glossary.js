/**
 * Making the anatomy words clickable, because otherwise they are noise.
 *
 * A question that says "is the deltoid taking over" is only answerable by
 * somebody who knows where the deltoid is. Everybody else reads it as a word
 * they cannot check, and a form full of words you cannot check is a form you
 * fill in badly. So every anatomy word in this panel is a button: press it and
 * you get one plain sentence about what it is, and a way to light it up on the
 * body in front of you.
 *
 * Two sources, in order:
 *
 * 1. the atlas entry, which carries a plain-language `does` written for a
 *    person rather than a clinician -- 66 structures have one;
 * 2. the mesh registry, which has all 430 and can always answer *where*, even
 *    where nobody has written a description yet.
 *
 * Where only the second exists the popover says so rather than inventing a
 * sentence. "Here it is on the body, and nobody has written this one up yet"
 * is a true and useful answer; a paraphrase of a Latin name is not.
 */
const esc = (s) => String(s ?? '').replace(/[&<>"]/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const GLOSSARY_CSS = `
.sx-term{display:inline;padding:0 1px;margin:0;font:inherit;font-size:inherit;
  color:var(--acc);background:none;border:0;border-bottom:1px dashed
  rgba(90,169,230,.5);cursor:pointer;line-height:inherit}
.sx-term:hover{border-bottom-style:solid;color:var(--txt)}
.sx-term:focus-visible{outline:1px solid var(--acc);outline-offset:2px}
#ss-term{position:fixed;z-index:200;width:min(268px,86vw);border-radius:4px;
  padding:12px 13px;border:1px solid var(--acc);
  background:linear-gradient(200deg,rgba(10,18,29,.99),rgba(5,9,16,.99));
  box-shadow:0 22px 60px rgba(0,0,0,.7)}
#ss-term h6{margin:0 0 2px;font-size:13px;font-weight:500;color:var(--txt)}
#ss-term .tw{margin:0 0 7px;font-size:9.5px;letter-spacing:.12em;
  text-transform:uppercase;color:var(--dim2)}
#ss-term p{margin:0 0 10px;font-size:12px;line-height:1.55;color:var(--dim)}
#ss-term .tgo{display:flex;gap:6px}
#ss-term button{flex:1;padding:6px 8px;border-radius:3px;font:inherit;
  font-size:11.5px;cursor:pointer;border:1px solid var(--line2);
  background:var(--glass);color:var(--dim)}
#ss-term button.tprimary{background:var(--acc);border-color:var(--acc);
  color:#04121f;font-weight:600}
#ss-term button:hover{color:var(--txt)}
#ss-term button.tprimary:hover{color:#04121f}
`;

/** Where a structure lives, in words, from the layer it was drawn in. */
const WHERE = {
  muscles_superficial: 'a surface muscle',
  muscles_deep: 'a deep muscle',
  skeleton: 'a bone',
  nervous: 'a nerve',
  organs: 'an organ',
  brain: 'part of the brain',
};

/**
 * Look a name up. Never throws and never invents.
 *
 * @param {string} name      the atlas key, e.g. "deltoid"
 * @param {object} registry  the session registry, for the mesh and the id
 */
export function explain(name, registry) {
  const key = String(name ?? '').toLowerCase().trim();
  const record = registry?.byName?.get(key) ?? null;
  const info = record?.muscle ?? null;
  return {
    key,
    id: record?.id ?? null,
    title: record?.name?.en ?? cap(key),
    where: WHERE[record?.layer] ?? '',
    /* The plain register, not the clinical one. `sci` exists and is correct and
     * is exactly what makes this panel unreadable. */
    plain: info?.en?.does ?? '',
  };
}

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');

/** Wrap a name so it can be pressed. Use inside any question's text. */
export function term(name, shown = null) {
  return `<button type="button" class="sx-term" data-term="${esc(name)}"
    >${esc(shown ?? name)}</button>`;
}

/**
 * Make every `.sx-term` inside `root` open a popover.
 *
 * @param {HTMLElement} root
 * @param {object} registry
 * @param {(id:number)=>void} [onShow]  light it up on the body
 */
export function wireTerms(root, registry, onShow) {
  for (const button of root.querySelectorAll('.sx-term')) {
    if (button.dataset.wired) continue;
    button.dataset.wired = '1';
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      popover(button, explain(button.dataset.term, registry), onShow);
    });
  }
}

function popover(anchor, found, onShow) {
  document.getElementById('ss-term')?.remove();
  const host = document.createElement('div');
  host.id = 'ss-term';
  host.innerHTML = `<h6>${esc(found.title)}</h6>
    ${found.where ? `<p class="tw">${esc(found.where)}</p>` : ''}
    <p>${found.plain
      ? esc(found.plain)
      : 'Nobody has written this one up in plain words yet — but it is on the '
        + 'body, and pressing below will light it up.'}</p>
    <div class="tgo">
      ${found.id != null
        ? '<button type="button" class="tprimary" data-show>Show me on the body</button>'
        : ''}
      <button type="button" data-shut>Close</button>
    </div>`;
  document.body.appendChild(host);

  /* Placed against the word, then pulled back inside the window. A popover
   * half off the edge of a narrow panel is the same as no popover. */
  const box = anchor.getBoundingClientRect();
  const w = host.offsetWidth, h = host.offsetHeight;
  const left = Math.max(8, Math.min(window.innerWidth - w - 8, box.left - 8));
  const below = box.bottom + 8;
  host.style.left = `${left}px`;
  host.style.top = `${below + h > window.innerHeight - 8
    ? Math.max(8, box.top - h - 8) : below}px`;

  const shut = () => { host.remove(); document.removeEventListener('click', away); };
  const away = (event) => { if (!host.contains(event.target)) shut(); };
  setTimeout(() => document.addEventListener('click', away), 0);
  host.querySelector('[data-shut]').addEventListener('click', shut);
  host.querySelector('[data-show]')?.addEventListener('click', () => {
    onShow?.(found.id);
    shut();
  });
}

/** Close whatever is open. Called when the panel underneath goes away. */
export function shutTerm() {
  document.getElementById('ss-term')?.remove();
}
