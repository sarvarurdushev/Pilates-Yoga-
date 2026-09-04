/**
 * The printable take-home.
 *
 * `buildReportHTML` is pure — data and a PNG in, an A4 HTML string out — so it can be
 * tested headlessly without a browser, which is the whole reason the inherited version was
 * worth keeping. `openReport` is the only part that touches window.
 *
 * The discipline inherited from neurolab and kept deliberately: **every number shows its own
 * arithmetic**. Here that means every claim prints its tier, its population and its source,
 * and every muscle prints whether its role was measured or inferred. A printed page leaves
 * the app and gets shown to other people, so it has to survive without the tooltips.
 */
import { UI, DISCLAIMERS } from './content/strings.js';
import { EXERCISE, DISCIPLINES, APPARATUS, ROLE_EVIDENCE } from './content/exercises.js';
import { EXERCISE_BRAIN, TIERS } from './content/evidence.js';
import { registry } from './structures.js';

// quotes too, not only angle brackets: this goes into attributes as well as text, and the
// search box puts whatever the user typed straight back into `value="..."`
const esc = s => String(s ?? '').replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function buildReportHTML({ exercise, lang = 'en', image = null, instructionOn = true,
                                  names = null }) {
  const T = k => UI[k]?.[lang] ?? k;
  const L = o => (o && typeof o === 'object' ? (o[lang] ?? o.en ?? '') : (o ?? ''));
  const e = EXERCISE[exercise];
  if (!e) return null;
  const t = e[lang];

  // injectable so the pure function can be tested without a built registry
  const nameOf = names ?? (n => registry().byName.get(n)?.name[lang] ?? n);

  const roleRows = (role, label) => `
    <tr><th>${esc(label)}</th><td>${e.muscles[role].map(([n, ev]) =>
      `<span class="m">${esc(nameOf(n))}<em class="${ev}">${ev === 'emg' ? 'EMG' : L(ROLE_EVIDENCE[ev])}</em></span>`
    ).join('')}</td></tr>`;

  const claim = (key) => {
    const c = EXERCISE_BRAIN[key];
    if (!c) return '';
    return `<div class="claim">
      <div class="tier"><b>${c.tier}</b> ${esc(L(TIERS[c.tier]))}</div>
      <p class="cl">${esc(c[lang].claim)}</p>
      <p class="mech">${esc(c[lang].mechanism)}</p>
      ${c.effect ? `<p><b>${esc(T('effect'))}:</b> ${esc(L(c.effect))}</p>` : ''}
      <p><b>${esc(T('population'))}:</b> ${esc(L(c.population))}</p>
      <p class="cav"><b>${esc(T('caveat'))}:</b> ${esc(L(c.caveat))}</p>
      <p class="src">${esc(c.citation)}</p>
    </div>`;
  };

  return `<!DOCTYPE html><html lang="${lang}"><head><meta charset="utf-8">
<title>${esc(t.name)} — ${esc(T('title'))}</title><style>
@page{size:A4;margin:14mm}
*{box-sizing:border-box}
body{font:11pt/1.5 system-ui,-apple-system,"Segoe UI","Noto Sans KR",sans-serif;color:#15181d;margin:0}
h1{font-size:20pt;margin:0 0 2pt;letter-spacing:-.4pt}
h2{font-size:11pt;margin:16pt 0 5pt;text-transform:uppercase;letter-spacing:.7pt;color:#5a6472;
 border-bottom:.6pt solid #ccd2da;padding-bottom:3pt}
p{margin:0 0 6pt}
.sub{color:#5a6472;font-size:10pt;margin-bottom:10pt}
.fig{width:100%;border:.6pt solid #ccd2da;border-radius:4pt;margin:0 0 10pt}
table{width:100%;border-collapse:collapse;font-size:10pt}
th{text-align:left;vertical-align:top;width:26%;color:#5a6472;font-weight:600;padding:4pt 8pt 4pt 0}
td{padding:4pt 0;border-bottom:.4pt solid #e4e8ee}
.m{display:inline-block;border:.5pt solid #ccd2da;border-radius:9pt;padding:1pt 7pt;margin:0 4pt 4pt 0}
.m em{font-style:normal;font-size:7.5pt;font-weight:700;margin-left:5pt;color:#8a6a20}
.m em.emg{color:#1c7a5a}
.claim{border-left:2pt solid #98a2b0;padding:0 0 0 8pt;margin:0 0 9pt}
.claim .tier{font-size:8.5pt;color:#5a6472;margin-bottom:2pt}
.claim .tier b{background:#15181d;color:#fff;border-radius:2pt;padding:0 4pt;margin-right:4pt}
.cl{font-weight:600}
.mech,.cav{font-size:9.5pt;color:#42484f}
.src{font-size:8.5pt;color:#6b7480;font-style:italic}
.fault b{display:block}
.fault{font-size:9.5pt;margin-bottom:5pt}
.disc{background:#f5f2ea;border:.5pt solid #ddd5c2;border-radius:4pt;padding:7pt 9pt;
 font-size:8.5pt;color:#4a4436;margin-top:14pt;page-break-inside:avoid}
.disc b{display:block;margin-top:5pt}
.disc b:first-child{margin-top:0}
.warnbox{background:#fdf3e6;border:.5pt solid #e4c894;border-radius:4pt;padding:7pt 9pt;
 font-size:9pt;margin-bottom:10pt}
.two{column-count:2;column-gap:14pt}
</style></head><body>
<h1>${esc(t.name)}${e.sanskrit ? ` <span style="font-weight:400;color:#666">${esc(e.sanskrit)}</span>` : ''}</h1>
<div class="sub">${esc(L(DISCIPLINES[e.discipline]))}${e.apparatus ? ' · ' + esc(L(APPARATUS[e.apparatus])) : ''} · ${esc(T('difficulty'))} ${e.difficulty}/5 · ${esc(T('title'))}</div>
${image ? `<img class="fig" src="${image}" alt="">` : ''}
${e.reviewed ? '' : `<div class="warnbox"><b>${esc(T('notReviewed'))}</b><br>${esc(T('notReviewedBody'))}</div>`}
<p>${esc(t.summary)}</p>

<h2>${esc(T('activation'))}</h2>
<table>
  ${roleRows('prime', T('primeMovers'))}
  ${roleRows('synergists', T('synergistsEx'))}
  ${roleRows('stabilisers', T('stabilisers'))}
</table>
<p class="mech" style="margin-top:6pt">${esc(T('activationNote'))}</p>
<p class="mech">${esc(L(e.emgNote))}</p>
${e.composed ? `<p class="mech"><b>${esc(T('composedNote'))}.</b> ${esc(T('composedBody'))}</p>` : ''}

${instructionOn ? `
<h2>${esc(T('setup'))}</h2><p>${esc(t.setup)}</p>
<h2>${esc(T('breath'))}</h2><p>${esc(t.breath)}</p><p>${esc(t.tempo)}</p>
<h2>${esc(T('focusCue'))}</h2><p>${esc(t.focusCue)}</p>
<h2>${esc(T('faults'))}</h2>
${t.faults.map(([f, fix]) => `<div class="fault"><b>${esc(f)}</b>${esc(fix)}</div>`).join('')}
<h2>${esc(T('contra'))}</h2><p>${esc(t.contraindications)}</p>
<h2>${esc(T('progressions'))} / ${esc(T('regressions'))}</h2>
<div class="two"><b>${esc(T('progressions'))}</b>
<ul>${t.progressions.map(p => `<li>${esc(p)}</li>`).join('')}</ul>
<b>${esc(T('regressions'))}</b>
<ul>${t.regressions.map(p => `<li>${esc(p)}</li>`).join('')}</ul></div>` : ''}

<h2>${esc(T('tabEvidence'))}</h2>
${e.brain.map(claim).join('')}

<div class="disc">
${DISCLAIMERS.map(d => `<b>${esc(d[lang].title)}</b>${esc(d[lang].body)}`).join('')}
</div>
</body></html>`;
}

export function openReport(opts) {
  const html = buildReportHTML(opts);
  if (!html) return false;
  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 400);
  return true;
}
