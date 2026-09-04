/**
 * What you did, printed beside whatever structure is on screen.
 *
 * The application renders its structure panel from templates in `ui.js`. Rather
 * than forking that file, this watches the panel and writes a session block
 * into it after each render. The cost is one MutationObserver; the saving is
 * that `ui.js` stays byte-identical to upstream and a re-sync stays a copy.
 *
 * **The block never looks the same for two different kinds of claim.** A
 * measured muscle gets a solid rule, a number, a unit and a date. A bone or a
 * nerve gets a hatched rule and no number at all. A brain region gets the
 * evidence treatment the application already uses -- a tier chip, a citation, a
 * population and a caveat -- and a sentence saying it is about the exercises,
 * not about the reader. Three visibly different things, because they are three
 * different kinds of statement and a reader has to be able to tell without
 * being told twice.
 */
import { MEASURED, REFERENCE, RESEARCH } from './session.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const CSS = `
.sess{margin:0 0 14px;border-radius:4px;padding:11px 13px;background:var(--glass);
  border:1px solid var(--line)}
.sess.measured{border-left:3px solid var(--acc)}
/* A lookup is hatched, not tinted: the difference between a measurement and a
   place to look next must survive being described to somebody over the phone. */
.sess.reference{border-left:3px solid transparent;
  border-image:repeating-linear-gradient(45deg,var(--dim2) 0 3px,transparent 3px 7px) 1;
  background:transparent}
.sess.research{border-left:3px solid var(--gold);background:rgba(233,180,92,.06)}
.sesshead{display:flex;align-items:baseline;gap:8px;font-size:10px;
  letter-spacing:.13em;text-transform:uppercase;color:var(--dim2);margin-bottom:7px}
.sesshead b{color:var(--acc);font-weight:500;letter-spacing:.13em}
.sess.research .sesshead b{color:var(--gold)}
.sess.reference .sesshead b{color:var(--dim)}
.sessnum{display:flex;align-items:baseline;gap:7px;margin:0 0 6px}
.sessnum i{font-style:normal;font-size:27px;font-weight:300;color:var(--txt);
  font-variant-numeric:tabular-nums;line-height:1}
.sessnum em{font-style:normal;font-size:11px;color:var(--dim)}
.sessnum s{text-decoration:none;margin-left:auto;font-size:10.5px;color:var(--dim2);
  letter-spacing:.06em}
.sessbar{height:4px;border-radius:2px;background:var(--line);overflow:hidden;margin:3px 0 9px}
.sessbar i{display:block;height:100%;background:var(--acc)}
.sess p{margin:0 0 7px;font-size:12.5px;color:var(--dim);line-height:1.62}
.sess p:last-child{margin-bottom:0}
.sess .why{color:var(--dim2);font-size:11.5px}
.sessrank{color:var(--dim);font-size:11.5px}
.sessrank b{color:var(--txt);font-weight:500}
.sessclaim{padding:9px 0 10px;border-top:1px solid var(--line)}
.sessclaim:first-of-type{border-top:0;padding-top:2px}
.sessclaim .c{color:#cfd8e6;font-size:12.5px;line-height:1.6;margin:0 0 5px}
.tierchip{display:inline-block;border:1px solid;border-radius:3px;padding:1px 7px;
  font-size:9.5px;letter-spacing:.12em;text-transform:uppercase;margin-right:6px;
  vertical-align:1px}
.sessmeta{font-size:11px;color:var(--dim2);line-height:1.6}
.sessmeta b{color:var(--dim);font-weight:400}
.sessfrom{margin-top:5px;font-size:11px;color:var(--dim2)}
.sessfrom em{font-style:normal;color:var(--dim)}
.sessnone{font-size:11.5px;color:var(--dim2);font-style:italic}
`;

/** Plain, technical, or both -- the application's own setting, honoured. */
function say(register, plainText, technical) {
  if (register === 'plain') return esc(plainText);
  if (register === 'clinical') return esc(technical);
  return `${esc(plainText)} <span class="why">${esc(technical)}</span>`;
}

function measuredBlock(about, session, register) {
  const { entry, group, rank, also } = about;
  const share = Math.round((entry.share ?? 0) * 100);
  const others = also.length
    ? `<p class="why">It also works as part of ${esc(also.join(' and '))}.</p>` : '';
  const place = rank
    ? `<p class="sessrank">Worked <b>${ordinal(rank.place)} hardest</b> of the
       ${rank.of} muscle groups measured in this class.</p>` : '';
  return `<div class="sess measured">
    <div class="sesshead"><b>You, this class</b><span>${esc(session.date)}</span></div>
    <div class="sessnum"><i>${entry.value.toFixed(1)}</i><em>${esc(entry.unit)}</em>
      <s>${share}% of the session's hardest effort</s></div>
    <div class="sessbar"><i style="width:${share}%"></i></div>
    <p>${say(register, entry.plain, entry.because)}</p>
    ${others}
    ${place}
    <p class="why">A joint moment is the net turning force at the joint. Every
      muscle crossing it took some unknown share, so all
      ${group ? group.members.length : 'the'} muscles in this group carry the
      same number. Nothing here measured this muscle on its own, and no camera
      can.</p>
  </div>`;
}

function referenceBlock(about, session, register) {
  const { kind, entry, joint, group } = about;
  const reading = joint?.quantity
    ? `<p class="sessfrom">The joint it meets was measured at
       <em>${joint.quantity.value.toFixed(1)}${esc(joint.quantity.unit)}</em>
       over ${joint.quantity.samples} frames.</p>` : '';
  const effort = group
    ? `<p class="sessfrom">The muscle it supplies was in a group that carried
       <em>${group.value.toFixed(1)} ${esc(group.unit)}</em>.</p>` : '';
  return `<div class="sess reference">
    <div class="sesshead"><b>Connected to something measured</b></div>
    <p>${say(register, entry.plain, entry.because)}</p>
    ${kind === 'bone' ? reading : effort}
    <p class="why">This is where to look next, not something that was observed.
      There is no number for this ${kind} and there will not be one.</p>
  </div>`;
}

function brainBlock(about, session) {
  const rows = about.claims.map((claim) => {
    const en = claim.en ?? {};
    const did = claim.from.map((e) => e.name).join(', ');
    return `<div class="sessclaim">
      <p class="c"><span class="tierchip" style="border-color:${claim.color ?? 'var(--dim2)'};
        color:${claim.color ?? 'var(--dim)'}">Tier ${esc(claim.tier)}</span>${esc(en.claim)}</p>
      <div class="sessmeta">
        ${claim.effect?.en ? `<b>Effect</b> ${esc(claim.effect.en)}<br>` : ''}
        ${claim.population?.en ? `<b>Studied in</b> ${esc(claim.population.en)}<br>` : ''}
        <b>Source</b> ${esc(claim.citation)}<br>
        <b>Read it carefully</b> ${esc(claim.caveat?.en ?? '')}
      </div>
      <p class="sessfrom">Raised because you did <em>${esc(did)}</em>.</p>
    </div>`;
  }).join('');
  return `<div class="sess research">
    <div class="sesshead"><b>Research about what you did</b>
      <span>${about.claims.length} claim${about.claims.length === 1 ? '' : 's'}</span></div>
    <p>These are findings about the <em>exercises in this class</em>, from the
      literature, at the strength the evidence actually has. <b>Nothing here
      measured your brain.</b> No camera can, this application holds no EEG or
      scan of you, and a count of claims is a fact about a library rather than
      about a person.</p>
    ${rows}
  </div>`;
}

function nothingBlock(record) {
  return `<div class="sess reference"><div class="sesshead"><b>Not measured</b></div>
    <p class="sessnone">This class produced no measurement that reaches
      ${esc(record?.name?.en ?? 'this structure')}. That is not the same as zero
      effort — it means nothing was recorded that could speak for it.</p></div>`;
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

/**
 * Watch the structure panel and keep a session block at the top of it.
 *
 * @param {Session} session
 * @param {{app: object}} nw  the application's live module namespace
 */
export function attachPanel(session, nw) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const body = document.getElementById('panelBody');
  if (!body) return () => {};

  let writing = false;
  const paint = () => {
    if (writing) return;
    // Only the explore tab shows a structure; the others are the library and
    // the evidence table, which are not about this person.
    const detail = body.querySelector('.detail');
    if (!detail || body.querySelector('.sess')) return;
    /* Under the structure's name and its layer, above everything the
     * application has to say about it. Appended after `.detail` instead, it
     * landed below the whole anatomy article -- a reader had to scroll past
     * four paragraphs about what a muscle does to reach what they did with it,
     * and on first look the block appeared not to exist at all. */
    const anchor = detail.querySelector('.rolechip')
                ?? detail.querySelector('.dwhere')
                ?? detail.querySelector('.dname');
    const id = nw.app.selected;
    if (id == null) return;
    const about = session.about(id);
    const record = session.registry.byId.get(+id);
    const html = !about ? nothingBlock(record)
      : about.tier === MEASURED ? measuredBlock(about, session, nw.app.register)
      : about.tier === RESEARCH ? brainBlock(about, session)
      : referenceBlock(about, session, nw.app.register);
    writing = true;
    if (anchor) anchor.insertAdjacentHTML('afterend', html);
    else detail.insertAdjacentHTML('afterend', html);
    writing = false;
  };

  const observer = new MutationObserver(paint);
  observer.observe(body, { childList: true, subtree: true });
  paint();
  return () => observer.disconnect();
}

export const _internals = { measuredBlock, referenceBlock, brainBlock, nothingBlock,
                            ordinal, say };
