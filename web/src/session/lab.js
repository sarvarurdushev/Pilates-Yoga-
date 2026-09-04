/**
 * The learner panels the lab was built for and refused to fake.
 *
 * `lab.js` says so in its own header: the brief it was written against wanted a
 * dashboard of a learner's weekly scores, there were none in the application,
 * and inventing a series that looked like a measurement would have been the one
 * thing the project must never ship. It plotted the things that were real
 * instead.
 *
 * There are learner scores now. They come from a camera, they carry the frames
 * and the spread they were computed from, and every one of them says which
 * mechanism produced it. So these panels fill the hole rather than papering
 * over it, and they use the lab's own furniture -- `labpanel`, `labhost`,
 * `labnote` -- so they read as part of the screen rather than as something
 * bolted to the side of it.
 *
 * The muscle thumbnails are the application's own `renderStructureInto`: the
 * same geometry, the same materials, the same lighting as the stage, drawn one
 * structure at a time. Not a picture of a muscle -- *the* muscle, from the
 * model the reader is already looking at.
 */
const esc = (s) => String(s ?? '').replace(/[&<>"]/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const CSS = `
.sesspanel h3 .who{float:right;font-size:10px;letter-spacing:.1em;color:var(--acc);
  text-transform:uppercase;font-weight:400}
.sessgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(132px,1fr));gap:12px}
.sesscard{background:rgba(146,178,222,.04);border:1px solid var(--line);border-radius:4px;
  overflow:hidden;cursor:pointer;transition:border-color .12s}
.sesscard:hover{border-color:var(--acc)}
.sesscard canvas{display:block;width:100%;height:96px;background:#05070d}
.sesscard .cap{padding:7px 9px 8px}
.sesscard .nm{font-size:11.5px;color:var(--txt);line-height:1.35}
.sesscard .nb{font-size:16px;font-weight:300;color:var(--acc);
  font-variant-numeric:tabular-nums;margin-top:2px}
.sesscard .nb em{font-style:normal;font-size:10px;color:var(--dim2);margin-left:3px}
.sessrows{display:flex;flex-direction:column;gap:11px}
.sessrow .top{display:flex;align-items:baseline;gap:9px;font-size:12.5px;color:var(--txt)}
.sessrow .top s{text-decoration:none;margin-left:auto;font-variant-numeric:tabular-nums;
  color:var(--acc);font-size:14px;font-weight:300}
.sessrow .top s em{font-style:normal;font-size:10px;color:var(--dim2);margin-left:3px}
.sessrow .track{height:5px;border-radius:3px;background:var(--line);overflow:hidden;
  margin:5px 0 4px}
.sessrow .track i{display:block;height:100%;background:var(--acc)}
.sessrow .mus{font-size:11px;color:var(--dim2);line-height:1.5}
.sessex{display:flex;flex-wrap:wrap;gap:8px}
.sessex .x{background:var(--glass);border:1px solid var(--line);border-radius:3px;
  padding:5px 10px;font-size:12px;color:var(--txt)}
.sessex .x em{font-style:normal;color:var(--dim2);font-size:10.5px;margin-left:6px}
.sessex .x.unknown{border-style:dashed;color:var(--dim)}
.sessbrain{display:flex;flex-direction:column;gap:10px}
.sessbrain .r{display:flex;align-items:center;gap:10px;font-size:12.5px;color:var(--txt)}
.sessbrain .r .tiers{margin-left:auto;display:flex;gap:4px}
.sessbrain .r .tiers i{font-style:normal;font-size:9.5px;letter-spacing:.1em;
  border:1px solid;border-radius:3px;padding:1px 6px}
.sesswarn{background:rgba(233,180,92,.07);border-left:2px solid rgba(233,180,92,.5);
  padding:9px 12px;border-radius:0 3px 3px 0;font-size:11.5px;color:var(--dim);
  line-height:1.6;margin:0 0 12px}
`;

function panel(title, who, inner, note) {
  return `<section class="labpanel labwide sesspanel">
    <h3>${esc(title)}<span class="who">${esc(who)}</span></h3>
    ${inner}
    <p class="labnote">${note}</p></section>`;
}

/** What worked hardest, as the lab's own bar rows. */
function ranked(session) {
  const rows = session.ranked().map((group) => `
    <div class="sessrow" data-group="${esc(group.group)}">
      <div class="top"><span>${esc(group.group)}</span>
        <s>${group.value.toFixed(1)}<em>Nm</em></s></div>
      <div class="track"><i style="width:${Math.round(group.share * 100)}%"></i></div>
      <div class="mus">${esc(group.members.map((m) => m.name).sort().join(', '))}</div>
    </div>`).join('');
  return panel('What worked hardest', `${session.person.display_name} · ${session.date}`,
    `<div class="sessrows">${rows}</div>`,
    'Peak joint moment per muscle group, in newton-metres, computed from this '
  + 'person\'s own video. The bar is the share of the hardest effort in this '
  + 'session. Every muscle in a group carries the group\'s number, because a '
  + 'joint moment is the net turning force at the joint and cannot be divided '
  + 'between the muscles that cross it.');
}

/** Every measured muscle, drawn from the model the reader is looking at. */
function thumbnails(session, nw) {
  const cards = session.lit()
    .filter((s) => s.tier === 'measured')
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name))
    .map((s) => `<div class="sesscard" data-id="${s.id}">
      <canvas data-thumb="${s.id}"></canvas>
      <div class="cap"><div class="nm">${esc(s.name)}</div>
        <div class="nb">${s.value.toFixed(1)}<em>Nm</em></div></div>
    </div>`).join('');
  return panel('Every muscle this session measured', 'click one to open it on the body',
    `<div class="sessgrid">${cards}</div>`,
    'Each tile is the structure itself, rendered from the same model and the '
  + 'same materials as the stage. The number beside it is its group\'s peak '
  + 'moment, not a measurement of that one muscle.');
}

/** What was actually done, which is what makes the brain panel possible. */
function exercises(session) {
  const list = session.exercises();
  if (!list.length) {
    return panel('What was done', session.date,
      '<p class="labnote">This session was recorded without exercise labels, so '
    + 'there is nothing to look up in the library.</p>',
      'Exercises are recorded by the recogniser, or given by hand at capture '
    + 'time. Without one, the muscle measurements still stand -- they do not '
    + 'depend on knowing the name of the movement -- but nothing can be looked '
    + 'up against the library or the evidence table.');
  }
  const chips = list.map((x) => `<span class="x${x.known ? '' : ' unknown'}">
    ${esc(x.name)}<em>${x.seconds ? `${Math.round(x.seconds)}s` : x.from}</em></span>`).join('');
  const unknown = list.filter((x) => !x.known).length;
  return panel('What was done', `${list.length} exercise${list.length === 1 ? '' : 's'}`,
    `<div class="sessex">${chips}</div>`,
    'What the camera recorded this person doing. '
  + (unknown ? `${unknown} of them are not in the anatomy library, and are shown `
             + 'dashed rather than dropped: a list of what somebody did must not '
             + 'quietly shorten to the list this application has a record for. '
             : '')
  + 'This is the only reason the panel below can exist.');
}

/** The join neither project could make alone. */
function brain(session, nw) {
  const regions = session.brainRegions();
  if (!regions.length) return '';
  const rows = regions.map((id) => {
    const claims = session.claims.get(id);
    const record = session.registry.byId.get(+id);
    const tiers = claims.reduce((m, c) => m.set(c.tier, (m.get(c.tier) ?? 0) + 1), new Map());
    const chips = [...tiers].map(([tier, n]) =>
      `<i style="border-color:var(--dim2);color:var(--dim)">${esc(tier)} × ${n}</i>`).join('');
    return `<div class="r" data-id="${id}">
      <span style="width:7px;height:7px;border-radius:50%;background:${record?.color ?? '#888'}"></span>
      <span>${esc(record?.name?.en ?? id)}</span>
      <span class="tiers">${chips}</span></div>`;
  }).join('');
  return panel('Brain regions the evidence touches',
    `from ${session.exercises().length} exercise${session.exercises().length === 1 ? '' : 's'} done`,
    `<p class="sesswarn"><b>This is a count of published claims about the
      exercises in this class. It is not a measurement of this person's brain.</b>
      Nothing in either half of this application records a brain — there is no
      EEG here, no scan, and no way to obtain one from a camera. A region appears
      because an exercise that was actually done carries a claim naming it, and
      the tier beside it is how strong that claim's evidence is.</p>
     <div class="sessbrain">${rows}</div>`,
    'Regions are listed, never graded. Lighting them in proportion to how many '
  + 'claims name each one would read as "this one is 75% active", which is a '
  + 'fabrication in the shape of an instrument reading. Click a region to open '
  + 'its claims with their citations and caveats.');
}

/**
 * Add the session panels to the lab, once, the first time it opens.
 *
 * The lab builds its own DOM when the application starts; these are appended to
 * the grid it has already made, at the top, because they are the panels about
 * the person and everything else on that screen is about the model.
 */
/**
 * Where the application's own writing goes once the panel stops carrying it.
 *
 * The reading is good and it is the wrong thing in a three-hundred-pixel column
 * that somebody opened to find out how their hip is doing. It arrives here as
 * the panel renders it, keyed by structure, and the most recent one is on top --
 * so "read about this in the lab" lands on the thing that was just clicked.
 */
const READING_CSS = `
.sessread{max-height:none}
.sessread .blk{margin:0 0 13px}
.sessread .who{color:var(--dim)}
.sessreadempty{font-size:12px;color:var(--dim2);line-height:1.7}
`;

let readingFor = null;

function reading(html, record) {
  return panel(record?.name?.en ?? 'Reading', 'moved here from the panel',
    `<div class="sessread">${html}</div>`,
    'The application\'s own writing about the structure you last chose. It '
  + 'used to sit in the right-hand column; with a session loaded that column '
  + 'shows your numbers instead, and this is where the reading lives.');
}

/** Called by the panel each time it lifts prose out of the column. */
export function showReading(html, id, record) {
  readingFor = { html, id, record };
  const host = document.getElementById('sessReading');
  if (!host) return;
  host.innerHTML = html
    ? reading(html, record)
    : panel(record?.name?.en ?? 'Reading', '',
        '<p class="sessreadempty">Nothing written about this structure yet.</p>',
        'Not every structure in the model has an article.');
}

export function attachLab(session, nw) {
  const style = document.createElement('style');
  style.textContent = CSS + READING_CSS;
  document.head.appendChild(style);

  let added = false;
  const add = () => {
    const grid = document.getElementById('labCharts');
    if (!grid || added) return;
    added = true;
    /* The lab's own subtitle says there are no assessment scores here and none
     * have been invented. That was true of this screen for its whole life and
     * it is the sentence the panels below were built around -- so with a
     * session loaded it has to be corrected rather than left standing, because
     * a page that disclaims the thing it is now showing reads as either a lie
     * or a bug. Rewritten here rather than edited upstream: with no session the
     * original sentence is still the true one. */
    const sub = document.getElementById('labSub');
    if (sub) {
      sub.textContent = 'The network and the movement at full size. The first '
        + `panels are ${session.person.display_name || session.person.username}`
        + `'s class on ${session.date}, measured from video — the only numbers `
        + 'here about a person. Everything below them is the model, as before.';
    }
    grid.insertAdjacentHTML('afterbegin',
      ranked(session) + thumbnails(session, nw) + exercises(session)
      + brain(session, nw) + '<div id="sessReading"></div>');
    if (readingFor) showReading(readingFor.html, readingFor.id, readingFor.record);
    wire(grid, session, nw);
    paintThumbs(grid, nw);
  };

  // The lab is hidden until it is opened, and a canvas in a hidden container
  // has no size to render into. Wait for the class the application puts on the
  // body when the screen opens.
  const observer = new MutationObserver(() => {
    if (document.body.classList.contains('lab-open')) add();
  });
  observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  if (document.body.classList.contains('lab-open')) add();
  return () => observer.disconnect();
}

function wire(grid, session, nw) {
  for (const card of grid.querySelectorAll('.sesscard, .sessbrain .r')) {
    card.addEventListener('click', () => {
      const id = +card.dataset.id;
      // Choosing a structure closes the lab, because the thing chosen is on the
      // stage behind it. Selecting something the reader cannot see is the same
      // fault as describing a structure in a hidden layer.
      nw.setLab?.(false);
      document.getElementById('labClose')?.click();
      nw.selectStructure(id);
    });
  }
}

/**
 * Draw each thumbnail once.
 *
 * Sequentially and on animation frames, not in a loop: each one is a full scene
 * render into an offscreen target, and forty of them back to back on a software
 * renderer stalls the page for several seconds with nothing on screen to say
 * why.
 */
function paintThumbs(grid, nw) {
  const canvases = [...grid.querySelectorAll('canvas[data-thumb]')];
  let at = 0;
  const step = () => {
    if (at >= canvases.length) return;
    const canvas = canvases[at++];
    const box = canvas.getBoundingClientRect();
    try {
      nw.renderStructureInto(canvas, Math.max(64, box.width), Math.max(64, box.height),
                             +canvas.dataset.thumb, { alone: true });
    } catch (error) {
      console.warn('[session] could not draw', canvas.dataset.thumb, error);
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export const _internals = { ranked, thumbnails, exercises, brain };
