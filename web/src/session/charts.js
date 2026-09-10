/**
 * The chart pieces the structure panel is built from.
 *
 * Inline SVG, no library, no request -- the same choice the rest of this
 * application makes, and for the same reason: a chart that needs a download is
 * a chart that is missing when the download fails.
 *
 * **Every class here is prefixed `ss-`, and that is not tidiness.** This code
 * runs inside eighteen thousand lines of somebody else's stylesheet. The first
 * version used names like `.sect` and `.chip`, both of which the application
 * already defines -- `.sect span{position:absolute}` is a rule for its section
 * thumbnails, and it silently collapsed every row in this panel to zero height
 * with the text piled on top of itself. Nothing threw. In a vendored
 * application a generic class name is a collision waiting for a screenshot.
 *
 * **Single series, so no legend.** Every plot here is one quantity over that
 * person's own sessions, and the heading names it. A legend box for one line is
 * furniture. The one place more than one colour appears is the evidence tiers,
 * and those carry their letter -- identity is never colour alone.
 *
 * **The noise floor is drawn, not just applied**, and only when there is one.
 * A score has no within-session spread -- it is one number per class, not a
 * median over frames -- so its chart has no band, and saying "the band is ±0.0,
 * anything inside it is not a change" under a flat rectangle was worse than
 * saying nothing. Where there is one, a change smaller than the quantity's own
 * within-session spread is not a change, and the band is where that rule becomes
 * something a reader can see rather than something they have to take on trust.
 * It is the most important mark on any of these charts: without it every wobble
 * reads as progress.
 */
const esc = (s) => String(s ?? '').replace(/[&<>"]/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Degrees as a degree sign. "129.3deg" is a variable name, not a reading. */
export function showUnit(unit) {
  return unit === 'deg' ? '°' : unit ? ` ${unit}` : '';
}

export function showValue(value, unit, places = 1) {
  return `${Number(value).toFixed(places)}${showUnit(unit)}`;
}

export const CHART_CSS = `
/* The application absolutely positions spans inside its own .sect blocks, so
   everything this layer draws states its position rather than inheriting one. */
.ss-chart, .ss-chart *, .ss-bar, .ss-bar *, .ss-stat, .ss-stat * { position:static }
.ss-chart{position:relative}
.ss-chart svg{display:block;width:100%;height:auto;overflow:visible}
.ss-spark .ss-band{fill:rgba(146,178,222,.11)}
/* The coach's lane. Deliberately not a line and deliberately not on the same
   scale: squares on a shared date axis, so it reads as a different kind of
   claim rather than as a second measurement of the same thing. */
.ss-lane{margin:9px 0 0;padding:9px 0 0;border-top:1px dashed var(--line2)}
.ss-lane-head{margin:0 0 6px;font-size:9px;letter-spacing:.13em;
  text-transform:uppercase;color:var(--dim2)}
.ss-lane-grid{display:grid;grid-template-columns:minmax(0,88px) 1fr;
  gap:4px 8px;align-items:center}
.ss-lane-label{font-size:10px;line-height:1.25;color:var(--dim);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.ss-lane-marks{display:grid;gap:2px;min-width:0}
.ss-lane-marks i{height:9px;border-radius:1.5px;min-width:2px;
  background:var(--line2)}
.ss-lane-dates{display:flex;justify-content:space-between;margin:5px 0 0;
  padding-left:96px;font-size:9.5px;color:var(--dim2)}
.ss-lane-marks i.ss-vd-ok{background:rgba(90,169,230,.6)}
.ss-lane-marks i.ss-vd-watch{background:var(--gold)}
.ss-lane-marks i.ss-vd-bad{background:#e2685f}
.ss-lane-key{margin:7px 0 0;font-size:10px;color:var(--dim2);line-height:1.6}
.ss-lane-key i{display:inline-block;width:8px;height:8px;border-radius:1.5px;
  margin:0 4px 0 10px;vertical-align:baseline}
.ss-lane-key i:first-child{margin-left:0}
.ss-lane-key i.ss-vd-ok{background:rgba(90,169,230,.55)}
.ss-lane-key i.ss-vd-watch{background:var(--gold)}
.ss-lane-key i.ss-vd-bad{background:#e2685f}
.ss-lane-key em{display:block;font-style:normal;color:var(--dim2);margin-top:4px}
/* The scored lines. One per axis, each on its own 0-to-scale baseline, because
   a shared y-axis across questions that mean different things is a chart that
   invites a comparison nobody should make. */
.ss-scores{margin:9px 0 0}
.ss-sl{margin:0 0 7px}
.ss-sl-head{display:flex;gap:7px;align-items:baseline;margin:0 0 1px;
  font-size:10.5px;color:var(--dim2)}
.ss-sl-head b{flex:1;min-width:0;font-weight:500;color:var(--txt);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ss-sl-head span{flex:none;color:var(--txt);font-variant-numeric:tabular-nums}
.ss-sl-head em{flex:none;font-style:normal;font-size:9.5px}
.ss-sl-head em.ss-up{color:var(--acc)}
.ss-sl-head em.ss-down{color:var(--gold)}
/* The two ends of a coach's own scale, in their words, stacked against the
   chart: the top word is what 10 means and the bottom what 0 means, which is
   the same way up as the line they label. */
.ss-sl-ends{margin:1px 0 3px;font-size:9.5px;line-height:1.45;color:var(--dim2)}
.ss-sl-ends b{font-weight:600;color:var(--dim);font-variant-numeric:tabular-nums}
.ss-sl-x{font-style:normal;font-size:9px;letter-spacing:.1em;text-transform:uppercase;
  color:var(--dim2)}
.ss-sl svg{width:100%;height:46px;overflow:visible}
.ss-sl-base{stroke:var(--line);stroke-width:1}
.ss-sl-line{fill:none;stroke:var(--acc);stroke-width:1.6;
  stroke-linejoin:round;stroke-linecap:round}
.ss-sl circle{fill:var(--acc)}
.ss-sl[style*="--n:1"] .ss-sl-line,.ss-sl[style*="--n:1"] circle{stroke:#8fb6e8;fill:#8fb6e8}
.ss-sl[style*="--n:2"] .ss-sl-line,.ss-sl[style*="--n:2"] circle{stroke:#c9a35e;fill:#c9a35e}
.ss-sl[style*="--n:3"] .ss-sl-line,.ss-sl[style*="--n:3"] circle{stroke:#7fc9b5;fill:#7fc9b5}
.ss-sl[style*="--n:4"] .ss-sl-line,.ss-sl[style*="--n:4"] circle{stroke:#b79ad0;fill:#b79ad0}
.ss-sl[style*="--n:1"] .ss-sl-line,.ss-sl[style*="--n:2"] .ss-sl-line,
.ss-sl[style*="--n:3"] .ss-sl-line,.ss-sl[style*="--n:4"] .ss-sl-line{fill:none}
.ss-spark .ss-line{fill:none;stroke:var(--acc);stroke-width:2;stroke-linejoin:round;
  stroke-linecap:round}
.ss-spark .ss-dot{fill:var(--acc);stroke:#060b14;stroke-width:2}
.ss-spark .ss-dot.ss-now{fill:var(--acc2)}
.ss-spark .ss-hit{fill:transparent;cursor:crosshair}
.ss-spark .ss-hit:hover + .ss-cursor{opacity:1}
.ss-spark .ss-cursor{stroke:var(--acc2);stroke-width:1;opacity:0;pointer-events:none}
.ss-spark .ss-value{fill:var(--txt);font-size:10px;font-variant-numeric:tabular-nums}
.ss-spark .ss-when{fill:var(--dim2);font-size:9px}
/* Reserved height, because a readout that appears on hover and reflows the
   panel moves the chart out from under the pointer, which clears the readout,
   which moves it back. That loop was a real bug on the printable page and it is
   not worth having a second time. */
.ss-readout{min-height:2.4em;font-size:10.5px;color:var(--dim2);line-height:1.5;
  font-variant-numeric:tabular-nums;margin:2px 0 0}
.ss-stat{display:flex;align-items:baseline;gap:8px;margin:0 0 4px;flex-wrap:wrap}
.ss-stat .ss-big{font-size:30px;font-weight:300;color:var(--txt);line-height:1;
  font-variant-numeric:tabular-nums}
.ss-stat .ss-unit{font-size:11px;color:var(--dim)}
.ss-stat .ss-chips{margin-left:auto;display:flex;gap:5px;flex-wrap:wrap;
  justify-content:flex-end}
.ss-chip{display:inline-block;font-size:9.5px;letter-spacing:.1em;
  text-transform:uppercase;border:1px solid var(--line2);border-radius:3px;
  padding:2px 7px;color:var(--dim);white-space:nowrap}
/* The number in a chip keeps its own case: "+9.7NM" is not a unit. */
.ss-chip b{font-weight:400;text-transform:none;letter-spacing:.02em;color:inherit}
.ss-chip.ss-better{border-color:rgba(90,169,230,.55);color:var(--acc2)}
.ss-chip.ss-worse{border-color:rgba(233,180,92,.55);color:var(--gold)}
.ss-chip.ss-steady{border-color:var(--line2);color:var(--dim2)}
.ss-bar{display:grid;grid-template-columns:1fr auto;gap:2px 8px;margin:0 0 8px}
.ss-bar .ss-name{font-size:11.5px;color:var(--txt);line-height:1.35}
.ss-bar .ss-num{font-size:11.5px;color:var(--dim);font-variant-numeric:tabular-nums;
  white-space:nowrap}
.ss-bar .ss-track{grid-column:1/-1;height:4px;border-radius:2px;
  background:var(--line);overflow:hidden}
.ss-bar .ss-track i{display:block;height:100%;background:var(--acc)}
.ss-bar.ss-quiet .ss-track i{background:var(--dim2)}
.ss-bar.ss-quiet .ss-name{color:var(--dim)}
.ss-group{margin:0 0 14px}
.ss-group h4{margin:0 0 7px;font-size:9.5px;letter-spacing:.13em;
  text-transform:uppercase;color:var(--dim2);font-weight:400}
`;

const W = 264, H = 64, PAD_L = 3, PAD_R = 34, PAD_T = 9, PAD_B = 15;

/**
 * One quantity across a person's sessions.
 *
 * @param {object} series  a `history` entry from the bundle
 */
export function spark(series, opts = {}) {
  const points = series.points ?? [];
  const unit = series.unit ?? '';
  if (points.length < 2) {
    return `<p class="ss-readout">One session so far. A line needs two.</p>`;
  }
  const id = opts.id ?? `s${Math.random().toString(36).slice(2, 8)}`;
  const values = points.map((p) => p.value);

  /* The floor band is centred on the first value, because that is what a change
   * is measured from, and the scale is widened to fit it. A band cropped off the
   * top of the plot would say "this moved a lot" by hiding the one mark that
   * says it did not. */
  const floor = series.noise_floor ?? 0;
  const base = points[0].value;
  const low = Math.min(...values, base - floor);
  const high = Math.max(...values, base + floor);
  const span = (high - low) || 1;

  const x = (i) => PAD_L + (W - PAD_L - PAD_R) * (i / (points.length - 1));
  const y = (v) => PAD_T + (H - PAD_T - PAD_B) * (1 - (v - low) / span);
  const step = (W - PAD_L - PAD_R) / (points.length - 1);

  const path = points.map((p, i) =>
    `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join('');
  const last = points[points.length - 1];

  const dots = points.map((p, i) =>
    `<circle class="ss-dot${p.current ? ' ss-now' : ''}" cx="${x(i).toFixed(1)}"
      cy="${y(p.value).toFixed(1)}" r="${p.current ? 3.4 : 2.2}"></circle>`).join('');

  const hits = points.map((p, i) =>
    `<rect class="ss-hit" x="${(x(i) - step / 2).toFixed(1)}" y="0"
      width="${step.toFixed(1)}" height="${H}"
      data-read="${esc(p.date)} · ${showValue(p.value, unit)}${p.spread
        ? ` · varied by ±${showValue(p.spread, unit)} over ${p.samples} frames`
        : ` · from ${p.samples} ${esc(series.counted ?? 'frames')}`}"></rect>
     <line class="ss-cursor" x1="${x(i).toFixed(1)}" y1="${PAD_T}"
      x2="${x(i).toFixed(1)}" y2="${H - PAD_B}"></line>`).join('');

  return `<div class="ss-chart ss-spark" data-spark="${id}">
    <svg viewBox="0 0 ${W} ${H}" role="img"
         aria-label="over ${points.length} sessions">
      ${floor > 0 ? `<rect class="ss-band" x="${PAD_L}" y="${y(base + floor).toFixed(1)}"
        width="${(W - PAD_L - PAD_R).toFixed(1)}"
        height="${Math.max(1, y(base - floor) - y(base + floor)).toFixed(1)}"></rect>` : ''}
      <path class="ss-line" d="${path}"/>
      ${dots}${hits}
      <text class="ss-value" x="${W - PAD_R + 5}"
        y="${(y(last.value) + 3.5).toFixed(1)}">${showValue(last.value, unit)}</text>
      <text class="ss-when" x="${PAD_L}" y="${H - 3}">${esc(points[0].date.slice(2))}</text>
      <text class="ss-when" x="${(W - PAD_R).toFixed(1)}" y="${H - 3}"
        text-anchor="end">${esc(last.date.slice(2))}</text>
    </svg>
    <p class="ss-readout">${points.length} sessions.${floor > 0
      ? ` The band is this measurement's own wobble, ±${showValue(floor, unit)}
         — anything inside it is not a change.` : ''}</p>
  </div>`;
}

/**
 * What the coach saw, on the same time axis as what the camera measured.
 *
 * **This does not touch the number.** A measurement is what came off the video;
 * a verdict is what a person thought. Letting the second alter the first would
 * be falsifying the record, and the whole tier system in this application exists
 * to stop exactly that. So the verdicts get their own lane underneath, sharing
 * only the dates — because the interesting reading is the comparison:
 *
 *   the load has been flat at 7.2 Nm for twelve weeks
 *   and over the same twelve weeks the coach went problem → fine
 *
 * which is a finding neither half could produce alone. The number did not move
 * and the quality did; or the number moved and nobody noticed.
 *
 * @param {object} history  a `/structure-history` payload
 * @param {string[]} [dates] the measured series' dates, so the two lanes line up
 */
export function verdictLane(history, dates = []) {
  const runs = Object.entries(history?.runs ?? {});
  if (!runs.length) return '';

  /* One shared axis. Every date either half knows about, in order, so a class
   * the coach wrote about but the camera did not measure still gets a column --
   * dropping it would quietly hide the sessions nobody recorded. */
  const all = [...new Set([...dates,
    ...runs.flatMap(([, points]) => points.map((p) => p.date))])].sort();
  if (all.length < 2) return '';
  const at = new Map(all.map((d, i) => [d, i]));

  /* A grid rather than an SVG. The labels are HTML and the marks have to line
   * up with them row for row; an SVG scales its viewBox to the width it is
   * given and the two columns drifted apart the moment the panel was narrow. */
  const rows = runs.map(([label, points]) => {
    const marks = points.map((p) => {
      const i = at.get(p.date);
      if (i === undefined) return '';
      const tone = p.verdict === 'fine' ? 'ok'
                 : p.verdict === 'watch' ? 'watch' : 'bad';
      return `<i class="ss-vd-${tone}" style="grid-column:${i + 1}"
        title="${esc(p.date)} — ${esc(label)}: ${esc(p.verdict)}${
        p.note ? ` — ${esc(p.note)}` : ''} (${esc(p.by)})"></i>`;
    }).join('');
    return `<span class="ss-lane-label" title="${esc(label)}">${esc(label)}</span>
      <span class="ss-lane-marks"
        style="grid-template-columns:repeat(${all.length},1fr)">${marks}</span>`;
  }).join('');

  return `<div class="ss-chart ss-lane">
    <p class="ss-lane-head">What the coach saw${history.count
      ? ` · ${history.count} reading${history.count === 1 ? '' : 's'}` : ''}</p>
    <div class="ss-lane-grid">${rows}</div>
    <p class="ss-lane-dates"><span>${esc(all[0].slice(2))}</span>
      <span>${esc(all[all.length - 1].slice(2))}</span></p>
    <p class="ss-lane-key"><i class="ss-vd-ok"></i>fine
      <i class="ss-vd-watch"></i>worth watching
      <i class="ss-vd-bad"></i>a problem
      <em>Not measured. This is what a person thought, on the same dates —
        it does not move the number above it.</em></p>
  </div>`;
}

/**
 * The coach's scores over time, one line per axis.
 *
 * This is the chart the whole scoring exists for, and it is the only thing a
 * student ever sees of a reading. It draws the same payload for both, because
 * the redaction happens at the server: a student's copy of a point carries a
 * date and a score and nothing else, so there is no branch here that could be
 * got wrong and leak a coach's note into a student's chart.
 *
 * Deliberately not one line: a single number per class is how the last three
 * versions of this went wrong. The per-axis lines are where the meaning is.
 */
export function scoreLines(history, opts = {}) {
  const lines = Object.entries(history?.lines ?? {});
  if (!lines.length) return '';
  const scale = history.scale ?? 10;
  const dates = [...new Set(lines.flatMap(([, l]) =>
    l.points.map((p) => p.date)))].sort();
  if (dates.length < 2) {
    return `<p class="ss-readout">One reading so far. A line needs two.</p>`;
  }
  const at = new Map(dates.map((d, i) => [d, i]));
  /* What the across-axis counts. Every line in one panel shares it — they are
   * drawn on one set of dates — so the first line that names it names it for
   * all of them, and "Sessions" is the honest default because that is what the
   * dates are: the classes this person came to. */
  const xlabel = lines.map(([, l]) => l.xlabel).find(Boolean) ?? 'Sessions';
  const w = 250, h = 46, padL = 2, padR = 26, padT = 5, padB = 5;
  const x = (i) => padL + (w - padL - padR) * (i / (dates.length - 1));
  const y = (v) => padT + (h - padT - padB) * (1 - v / scale);

  const rows = lines.map(([key, line], n) => {
    const path = line.points.map((p, i) =>
      `${i ? 'L' : 'M'}${x(at.get(p.date)).toFixed(1)},${
        y(p.score).toFixed(1)}`).join('');
    const dots = line.points.map((p) =>
      `<circle cx="${x(at.get(p.date)).toFixed(1)}" cy="${y(p.score).toFixed(1)}"
        r="1.9"><title>${esc(p.date)} — ${esc(line.label)}: ${p.score}/${scale}${
        p.note ? `\n${esc(p.note)}` : ''}</title></circle>`).join('');
    const moved = line.moved > 0 ? `+${line.moved}` : `${line.moved}`;
    /* Coloured by the direction the *coach* called good, not by the sign.
     *
     * "Is the internal oblique taking over?" going from 3 to 8 is bad news, and
     * "does it hold through the set?" going 3 to 8 is good, and this drew both
     * in the same encouraging colour because it read the arithmetic and not the
     * question. A coach who has not said which end is better gets no colour
     * rather than a guess. */
    const good = line.better === 'high' ? 1 : line.better === 'low' ? -1 : 0;
    const tone = !good || !line.moved ? ''
               : Math.sign(line.moved) === good ? 'ss-up' : 'ss-down';
    /* The ends, in the coach's words. A 0-to-10 axis with nothing said about
     * what 0 and 10 are is a number with the meaning left out — the thing a
     * reader has to supply from memory, and the thing they get wrong. */
    /* One line under the title rather than two labels floated beside the plot.
     * Floated, they sat on top of the line they were labelling and behind the
     * value: this column is 250 pixels wide and there is no gutter to put them
     * in. Said as a sentence they always fit, they never collide, and they read
     * in the order a reader asks the question -- what is a high score, then
     * what is a low one. */
    const ends = (line.low || line.high)
      ? `<p class="ss-sl-ends">${[
          line.high ? `<b>${scale}</b> ${esc(line.high)}` : '',
          line.low ? `<b>0</b> ${esc(line.low)}` : ''].filter(Boolean).join(' · ')}</p>`
      : '';
    return `<div class="ss-sl" style="--n:${n % 5}">
      <p class="ss-sl-head"><b>${esc(line.label)}</b>
        <span>${line.latest}/${scale}</span>
        <em class="${tone}"
          >${line.points.length > 1
            ? (line.moved === 0 ? 'no change' : `${moved} since ${
                esc(line.points[0].date.slice(2))}`)
            : 'first score'}</em></p>${ends}
      <svg viewBox="0 0 ${w} ${h}" role="img"
           aria-label="${esc(line.label)}, ${line.points.length} readings, now ${
             line.latest} out of ${scale}${
             line.high ? `, where ${scale} is ${esc(line.high)}` : ''}${
             line.low ? ` and 0 is ${esc(line.low)}` : ''}">
        <line class="ss-sl-base" x1="${padL}" y1="${y(0).toFixed(1)}"
          x2="${(w - padR).toFixed(1)}" y2="${y(0).toFixed(1)}"/>
        <path class="ss-sl-line" d="${path}"/>${dots}
        <text class="ss-value" x="${w - padR + 4}"
          y="${(y(line.latest) + 3.4).toFixed(1)}">${line.latest}</text>
      </svg></div>`;
  }).join('');

  return `<div class="ss-chart ss-scores">
    ${opts.title ? `<p class="ss-lane-head">${esc(opts.title)}</p>` : ''}
    ${rows}
    <p class="ss-lane-dates"><span>${esc(dates[0].slice(2))}</span>
      ${xlabel ? `<em class="ss-sl-x">${esc(xlabel)} →</em>` : ''}
      <span>${esc(dates[dates.length - 1].slice(2))}</span></p>
    ${opts.note ? `<p class="ss-lane-key"><em>${esc(opts.note)}</em></p>` : ''}
  </div>`;
}

/** The headline figure, its unit, and whatever chips belong beside it. */
export function stat(value, unit, chips = []) {
  return `<div class="ss-stat"><span class="ss-big">${esc(value)}</span>
    <span class="ss-unit">${esc(unit === 'deg' ? 'degrees' : unit)}</span>
    <span class="ss-chips">${chips.join('')}</span></div>`;
}

export function chip(text, tone = '') {
  return `<span class="ss-chip${tone ? ` ss-${tone}` : ''}">${text}</span>`;
}

/**
 * What a series did, as a word and a number.
 *
 * Never a bare arrow and never a bare colour: a reader must not have to know
 * which hue means better.
 */
export function verdictChip(series) {
  if (series.verdict === 'too few sessions') {
    return chip(`${series.sessions} so far`, 'steady');
  }
  if (series.verdict === 'steady') return chip('No real change', 'steady');
  const better = series.lower_is_better ? series.change < 0 : series.change > 0;
  const sign = series.change > 0 ? '+' : '';
  return chip(`${better ? 'Improved' : 'Changed'} <b>${sign}${
    showValue(series.change, series.unit)}</b>`, better ? 'better' : 'worse');
}

/** A labelled bar. `share` is 0..1 of the row's own scale. */
export function bar(name, value, share, quiet = false) {
  const width = Math.round(Math.max(0, Math.min(1, share)) * 100);
  return `<div class="ss-bar${quiet ? ' ss-quiet' : ''}">
    <span class="ss-name">${esc(name)}</span><span class="ss-num">${esc(value)}</span>
    <span class="ss-track"><i style="width:${width}%"></i></span></div>`;
}

export const group = (title, inner) =>
  `<div class="ss-group"><h4>${esc(title)}</h4>${inner}</div>`;

/** Wire the hover readouts. Idempotent; safe after every render. */
export function wireCharts(root) {
  for (const chart of root.querySelectorAll('.ss-spark[data-spark]')) {
    if (chart.dataset.wired) continue;
    chart.dataset.wired = '1';
    const readout = chart.querySelector('.ss-readout');
    const rest = readout.innerHTML;
    for (const hit of chart.querySelectorAll('.ss-hit')) {
      hit.addEventListener('mouseenter', () => { readout.textContent = hit.dataset.read; });
    }
    chart.addEventListener('mouseleave', () => { readout.innerHTML = rest; });
  }
}
