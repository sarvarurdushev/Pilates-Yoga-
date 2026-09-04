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
