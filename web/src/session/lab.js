/**
 * Your analysis: a third tab in the lab, holding everything about the person.
 *
 * `lab.js` says in its own header that the brief it was written against wanted a
 * dashboard of a learner's weekly scores, that there were none in the
 * application, and that inventing a series which looked like a measurement
 * would have been the one thing the project must never ship. It plotted the
 * things that were real instead.
 *
 * There are learner scores now. They come from a camera, they carry the frames
 * and the spread they were computed from, and every one says which mechanism
 * produced it. So this fills the hole rather than papering over it.
 *
 * **It is a third tab, not a fork.** The lab's own `setView` toggles between
 * charts and reading; the tab added here listens alongside its two rather than
 * replacing them, so upstream stays byte-identical and the model's own panels
 * are exactly where they were. The person's charts, the muscles measured, what
 * was done, the brain claims and the reading lifted out of the panel all live
 * under one tab, because "how am I doing" is one question.
 */
import { CHART_CSS, bar, showValue, spark, verdictChip, wireCharts }
  from './charts.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const CSS = CHART_CSS + `
#ss-lab{padding:0 26px 60px}
#ss-lab .ss-h{display:flex;align-items:baseline;gap:12px;margin:0 0 12px}
#ss-lab h3{margin:0;font-size:12px;letter-spacing:.14em;text-transform:uppercase;
  color:var(--dim);font-weight:400}
#ss-lab .who{font-size:10px;letter-spacing:.1em;color:var(--acc);
  text-transform:uppercase}
#ss-lab section{background:rgba(146,178,222,.03);border:1px solid var(--line);
  border-radius:5px;padding:18px 20px;margin:0 0 14px}
#ss-lab .note{margin:12px 0 0;font-size:11.5px;color:var(--dim2);line-height:1.65}
#ss-lab .tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));
  gap:1px;background:var(--line);border:1px solid var(--line);border-radius:5px;
  overflow:hidden;margin:0 0 14px}
#ss-lab .tile{background:#080d17;padding:15px 17px}
#ss-lab .tile .n{font-size:26px;font-weight:300;color:var(--txt);line-height:1.1;
  font-variant-numeric:tabular-nums}
#ss-lab .tile .k{font-size:10px;letter-spacing:.11em;text-transform:uppercase;
  color:var(--dim2);margin-top:5px;line-height:1.4}
#ss-lab .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(288px,1fr));
  gap:18px 26px}
#ss-lab .plot h5{margin:0 0 3px;font-size:12.5px;font-weight:500;color:var(--txt)}
#ss-lab .plot .sub{margin:0 0 5px}
#ss-lab .thumbs{display:grid;grid-template-columns:repeat(auto-fill,minmax(132px,1fr));
  gap:12px}
#ss-lab .card{background:rgba(146,178,222,.04);border:1px solid var(--line);
  border-radius:4px;overflow:hidden;cursor:pointer}
#ss-lab .card:hover{border-color:var(--acc)}
#ss-lab .card canvas{display:block;width:100%;height:96px;background:#05070d}
#ss-lab .card .cap{padding:7px 9px 9px}
#ss-lab .card .nm{font-size:11.5px;color:var(--txt);line-height:1.35}
#ss-lab .card .nb{font-size:16px;font-weight:300;color:var(--acc);margin-top:2px;
  font-variant-numeric:tabular-nums}
#ss-lab .card .nb em{font-style:normal;font-size:10px;color:var(--dim2);margin-left:3px}
#ss-lab .did{display:flex;flex-wrap:wrap;gap:8px}
#ss-lab .did span{font-size:12px;color:var(--txt);background:var(--glass);
  border:1px solid var(--line);border-radius:3px;padding:5px 10px}
#ss-lab .did span em{font-style:normal;color:var(--dim2);font-size:10.5px;margin-left:6px}
#ss-lab .did span.unknown{border-style:dashed;color:var(--dim)}
#ss-lab .regions{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));
  gap:9px}
#ss-lab .region{display:flex;align-items:center;gap:9px;font-size:12.5px;
  color:var(--txt);cursor:pointer;padding:8px 10px;border-radius:3px;
  border:1px solid var(--line)}
#ss-lab .region:hover{border-color:var(--acc)}
#ss-lab .region .dot{width:7px;height:7px;border-radius:50%;flex:none}
#ss-lab .region .tiers{margin-left:auto;display:flex;gap:4px}
#ss-lab .region .tiers i{font-style:normal;font-size:9px;letter-spacing:.08em;
  border:1px solid;border-radius:3px;padding:1px 5px}
#ss-lab .warn{background:rgba(233,180,92,.07);border-left:2px solid rgba(233,180,92,.5);
  padding:11px 14px;border-radius:0 3px 3px 0;font-size:12px;color:var(--dim);
  line-height:1.65;margin:0 0 14px}
#ss-lab .reading{columns:2;column-gap:30px;font-size:13px}
#ss-lab .reading .blk{break-inside:avoid;margin:0 0 14px}
@media (max-width:900px){#ss-lab .reading{columns:1}}
#ss-lab .empty{font-size:12.5px;color:var(--dim2);line-height:1.7;margin:0}
#ss-lab-tab[aria-selected=true]{color:var(--txt)}
`;

/* ------------------------------------------------------------------ pieces */

const section = (title, who, inner, note = '') => `<section>
  <div class="ss-h"><h3>${esc(title)}</h3><span class="who">${esc(who)}</span></div>
  ${inner}${note ? `<p class="note">${note}</p>` : ''}</section>`;

/** The headline figures, before any chart. */
function tiles(session) {
  const score = session.score;
  const history = session.bundle.history ?? {};
  const runs = Object.values(history);
  const sessions = runs.reduce((most, h) => Math.max(most, h.sessions ?? 0), 0);
  const moved = runs.filter((h) =>
    h.verdict !== 'steady' && h.verdict !== 'too few sessions').length;
  const cells = [
    [score?.value != null ? Math.round(score.value) : '—', 'Score out of 100'],
    [session.ranked().length, 'Muscle groups measured'],
    [(session.bundle.quantities ?? []).length, 'Measurements this class'],
    [sessions, 'Classes on record'],
    [moved, 'Quantities that really moved'],
    [session.brainRegions().length, 'Brain regions in the evidence'],
  ];
  return `<div class="tiles">${cells.map(([n, k]) =>
    `<div class="tile"><div class="n">${esc(n)}</div><div class="k">${esc(k)}</div></div>`)
    .join('')}</div>`;
}

/**
 * The score, over every class on record.
 *
 * Sessions where the score was withheld are a gap in the line and are listed
 * underneath with the reason. Joining across them would draw a line through a
 * number that was refused, which is the one thing a chart of a refusal must not
 * do.
 */
function score(session) {
  const runs = session.bundle.score_history ?? [];
  if (runs.length < 2) return '';
  const kept = runs.filter((r) => r.value != null);
  const gone = runs.filter((r) => r.value == null);
  if (!kept.length) return '';
  const series = {
    // No within-session spread: a score is one number per class, not a median
    // over frames, so there is no band and its points are counted in checks.
    unit: '', noise_floor: 0, counted: 'checks', sessions: kept.length,
    verdict: kept.length > 2 ? 'changed' : 'too few sessions',
    change: kept[kept.length - 1].value - kept[0].value,
    lower_is_better: false,
    points: kept.map((r) => ({ date: r.date, value: r.value, spread: 0,
                               samples: r.checks, current: r.date === session.date })),
  };
  const missing = gone.length
    ? `<p class="note">${gone.length} class${gone.length === 1 ? '' : 'es'} produced
       no score and are not on the line: ${esc(gone.map((g) => g.date).join(', '))}.
       ${esc(gone[0].withheld_reason || '')}</p>` : '';
  return section('Score, class by class', `out of 100`,
    `<div class="grid"><div class="plot">
      <h5>Score</h5><p class="sub">${verdictChip(series)}</p>
      ${spark(series, { id: 'lab-score' })}</div></div>${missing}`,
    'A score is derived from the checks a class allowed, never stored, so a '
  + 'change to how one is computed applies to every class ever recorded. Where '
  + 'too few checks could be made the number is withheld rather than made from '
  + 'whatever was available — a score that swings on one measurement is not a '
  + 'score.');
}

/** What worked hardest, this class. */
function ranked(session) {
  const rows = session.ranked().map((g) =>
    bar(g.group, showValue(g.value, g.unit), g.share)
    + `<p class="note" style="margin:-5px 0 11px">${esc(
        g.members.map((m) => m.name).join(', '))}</p>`).join('');
  return section('What worked hardest', `${session.person.display_name} · ${session.date}`,
    rows,
    'Peak joint moment per muscle group, in newton-metres, computed from this '
  + "person's own video. Every muscle in a group carries the group's number: a "
  + 'joint moment is the net turning force at the joint and cannot be divided '
  + 'between the muscles that cross it.');
}

/**
 * Every quantity, over every session. The chart wall.
 *
 * Grouped rather than sorted alphabetically, because "how straight was my knee"
 * and "how hard did my hip flexors work" are different questions and somebody
 * scanning for one should not have to read past the other.
 */
const GROUPS = [
  ['Effort', (name) => name.endsWith(' peak moment')],
  ['Joint angles', (name) => /^(left|right)_/.test(name)],
  ['Left against right', (name) => name.endsWith(' symmetry')],
  ['Posture', (name) => ['neck', 'trunk', 'shoulder_tilt', 'pelvis_tilt'].includes(name)],
  ['How it was done', () => true],
];

const pretty = (name) => name.replace(/_/g, ' ').replace(/ peak moment$/, ' effort');

function plots(session) {
  const history = session.bundle.history ?? {};
  const names = Object.keys(history);
  if (!names.length) return '';
  const taken = new Set();
  const out = [];
  for (const [title, matches] of GROUPS) {
    const mine = names.filter((n) => !taken.has(n) && matches(n)).sort();
    if (!mine.length) continue;
    for (const n of mine) taken.add(n);
    out.push(section(title, `${mine.length} measured`,
      `<div class="grid">${mine.map((name) => `<div class="plot">
        <h5>${esc(pretty(name))}</h5>
        <p class="sub">${verdictChip(history[name])}</p>
        ${spark(history[name], { id: `lab-${name.replace(/\W+/g, '')}` })}
      </div>`).join('')}</div>`,
      title === 'Effort'
        ? 'The band on each chart is that measurement’s own session-to-session '
        + 'wobble. A line that stays inside it has not changed, however much it '
        + 'looks like it has.' : ''));
  }
  return out.join('');
}

/** Every measured muscle, rendered from the model the reader is looking at. */
function thumbnails(session) {
  const cards = session.lit()
    .filter((s) => s.tier === 'measured')
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name))
    .map((s) => `<div class="card" data-id="${s.id}">
      <canvas data-thumb="${s.id}"></canvas>
      <div class="cap"><div class="nm">${esc(s.name)}</div>
        <div class="nb">${s.value.toFixed(1)}<em>Nm</em></div></div></div>`).join('');
  if (!cards) return '';
  return section('Every muscle this class measured', 'click one to open it on the body',
    `<div class="thumbs">${cards}</div>`,
    'Each tile is the structure itself, drawn from the same model and the same '
  + "materials as the stage. The number is its group's peak moment, not a "
  + 'measurement of that one muscle.');
}

/** What was actually done, which is what makes the brain panel possible. */
function exercises(session) {
  const list = session.exercises();
  if (!list.length) {
    return section('What was done', session.date,
      '<p class="empty">This class was recorded without exercise labels, so there '
    + 'is nothing to look up in the library. The muscle measurements still stand '
    + '— they do not depend on knowing the name of the movement.</p>');
  }
  const chips = list.map((x) => `<span class="${x.known ? '' : 'unknown'}">${
    esc(x.name)}<em>${x.seconds ? `${Math.round(x.seconds / 60)} min` : esc(x.from)}${
    x.repetitions ? ` · ${x.repetitions} reps` : ''}</em></span>`).join('');
  const unknown = list.filter((x) => !x.known).length;
  return section('What was done', `${list.length} exercise${list.length === 1 ? '' : 's'}`,
    `<div class="did">${chips}</div>`,
    'What the camera recorded. '
  + (unknown ? `${unknown} of these are not in the anatomy library and are shown `
             + 'dashed rather than dropped: a list of what somebody did must not '
             + 'quietly shorten to the list this application has a record for.'
             : ''));
}

/** The join neither project could make alone. */
function brain(session) {
  const regions = session.brainRegions();
  if (!regions.length) return '';
  const rows = regions.map((id) => {
    const claims = session.claims.get(id);
    const record = session.registry.byId.get(+id);
    const tiers = claims.reduce((m, c) => m.set(c.tier, (m.get(c.tier) ?? 0) + 1), new Map());
    const chips = [...tiers].map(([tier, n]) =>
      `<i style="border-color:var(--dim2);color:var(--dim)">${esc(tier)} × ${n}</i>`)
      .join('');
    return `<div class="region" data-id="${id}">
      <span class="dot" style="background:${record?.color ?? '#888'}"></span>
      <span>${esc(record?.name?.en ?? id)}</span>
      <span class="tiers">${chips}</span></div>`;
  }).join('');
  return section('Brain regions the evidence touches',
    `from ${session.exercises().length} exercises done`,
    `<p class="warn"><b>A count of published claims about the exercises in this
      class. Not a measurement of this person’s brain.</b> Nothing in either
      half of this application records a brain — no EEG, no scan, and no way
      to obtain one from a camera. A region appears because an exercise that was
      actually done carries a claim naming it.</p>
     <div class="regions">${rows}</div>`,
    'Regions are listed, never graded. Lighting them in proportion to how many '
  + 'claims name each one would read as “this one is 75% active”, which '
  + 'is a fabrication in the shape of an instrument reading.');
}

/* ------------------------------------------------------- the reading panel */

let reading = null;

/** Called by the panel each time it lifts prose out of the column. */
export function showReading(html, id, record) {
  reading = { html, record };
  const host = document.getElementById('ss-reading');
  if (!host) return;
  host.innerHTML = html
    ? section(record?.name?.en ?? 'Reading', 'moved here from the panel',
        `<div class="reading">${html}</div>`,
        'The application’s own writing about the structure you last chose. It '
      + 'used to sit in the right-hand column; that column now shows your '
      + 'numbers, and this is where the reading lives.')
    : section(record?.name?.en ?? 'Reading', '',
        '<p class="empty">Nothing is written about this structure.</p>');
}

/* ------------------------------------------------------------------- mount */

export function attachLab(session, nw) {
  if (!document.getElementById('ss-lab-style')) {
    const style = document.createElement('style');
    style.id = 'ss-lab-style';
    style.textContent = CSS;
    document.head.appendChild(style);
  }
  // A second session replaces the first rather than stacking beside it.
  document.getElementById('ss-lab')?.remove();
  document.getElementById('ss-lab-tab')?.remove();

  let built = false;
  const build = () => {
    const charts = document.getElementById('labCharts');
    if (!charts || built) return;
    built = true;

    const mine = document.createElement('div');
    mine.id = 'ss-lab';
    mine.hidden = true;
    charts.insertAdjacentElement('afterend', mine);
    mine.innerHTML = tiles(session) + score(session) + ranked(session)
                   + plots(session)
                   + thumbnails(session) + exercises(session) + brain(session)
                   + '<div id="ss-reading"></div>';
    if (reading) showReading(reading.html, null, reading.record);

    /* A third tab, listening alongside the lab's own two rather than replacing
     * them: `setView` is theirs and knows about charts and reading only, so this
     * hides its containers when mine is shown and gets out of the way the moment
     * either of its tabs is clicked. */
    const tabs = document.getElementById('labTabCharts')?.parentElement;
    const tab = document.createElement('button');
    tab.id = 'ss-lab-tab';
    tab.type = 'button';
    tab.textContent = 'Your progress';
    tab.setAttribute('aria-selected', 'false');
    tabs?.appendChild(tab);

    const theirs = ['labCharts', 'labTiles', 'labRef'];
    const showMine = (on) => {
      mine.hidden = !on;
      tab.setAttribute('aria-selected', String(on));
      if (!on) return;
      for (const id of theirs) {
        const el = document.getElementById(id);
        if (el) el.hidden = true;
      }
      document.getElementById('labTabCharts')?.setAttribute('aria-selected', 'false');
      document.getElementById('labTabRef')?.setAttribute('aria-selected', 'false');
      paintThumbs(mine, nw);
      wireCharts(mine);
    };
    tab.addEventListener('click', () => showMine(true));
    for (const id of ['labTabCharts', 'labTabRef']) {
      document.getElementById(id)?.addEventListener('click', () => showMine(false));
    }

    wire(mine, nw);
    // The person's own numbers are what they came for, so that is the tab the
    // lab opens on while a session is loaded.
    showMine(true);
  };

  const observer = new MutationObserver(() => {
    if (document.body.classList.contains('lab-open')) build();
  });
  observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  if (document.body.classList.contains('lab-open')) build();
  return () => observer.disconnect();
}

function wire(root, nw) {
  for (const card of root.querySelectorAll('.card, .region')) {
    card.addEventListener('click', () => {
      // Choosing a structure closes the lab, because the thing chosen is on the
      // stage behind it. Selecting something the reader cannot see is the same
      // fault as describing a structure in a hidden layer.
      document.getElementById('labClose')?.click();
      nw.selectStructure(+card.dataset.id);
    });
  }
}

/**
 * Draw the thumbnails one at a time, on animation frames.
 *
 * Each is a full scene render into an offscreen target; forty back to back on a
 * software renderer stalls the page for several seconds with nothing on screen
 * to say why. `renderStructureInto` returns null while a layer's meshes are
 * still arriving, so a tile that is not ready is tried again rather than left
 * black.
 */
function paintThumbs(root, nw, tries = 0) {
  const pending = [...root.querySelectorAll('canvas[data-thumb]')]
    .filter((c) => !c.dataset.drawn);
  if (!pending.length || tries > 600) return;
  const canvas = pending[0];
  const box = canvas.getBoundingClientRect();
  if (box.width) {
    try {
      if (nw.renderStructureInto(canvas, box.width, box.height,
                                 +canvas.dataset.thumb, { alone: true })) {
        canvas.dataset.drawn = '1';
      }
    } catch (error) {
      canvas.dataset.drawn = 'failed';
      console.warn('[session] could not draw', canvas.dataset.thumb, error);
    }
  }
  requestAnimationFrame(() => paintThumbs(root, nw, tries + 1));
}

export const _internals = { tiles, score, ranked, plots, thumbnails,
                            exercises, brain };
