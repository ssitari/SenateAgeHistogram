// ============================================================
//  app.js  —  Visualization engine
//  Do not edit unless you are modifying the tool itself.
// ============================================================

import {
  AGES_FILE, CONGRESS_FILE, FIELDS,
  DEFAULT_SELECTION, DEFAULT_BASELINE, BASELINE_WINDOW,
  PARTY_COLORS, SILHOUETTE_FILL, SILHOUETTE_STROKE, HOVER_COLOR, TREND_COLOR,
  DOT_GAP, DOT_MIN, DOT_MAX, TIMELINE_HEIGHT, COVERAGE_WARN,
} from './config.js';

const F = FIELDS;

// ============================================================
//  STATE
// ============================================================

const state = {
  lo: null, hi: null,        // inclusive Congress range currently selected
  baseline: DEFAULT_BASELINE,
  view: 'chart',
  hovered: null,             // the dot datum under the cursor, or null
};

let all = [];                // every senator-Congress observation
let congresses = [];         // one entry per Congress, ascending
let byCongress = new Map();
let ageDomain = [];          // contiguous integer ages spanning the whole file
let allShares = new Map();   // age -> share of every observation

// ============================================================
//  DOM
// ============================================================

const el = {
  chart:    document.getElementById('chart'),
  chartSvg: d3.select('#chart-svg'),
  tl:       document.getElementById('timeline'),
  tlSvg:    d3.select('#tl-svg'),
  tableWrap: document.getElementById('table-wrap'),
  table:    d3.select('#table'),
  tooltip:  document.getElementById('tooltip'),
  loading:  document.getElementById('loading'),
  readout:  document.getElementById('readout'),
  partyKey: document.getElementById('party-key'),
};

const fmtInt = d3.format(',');
const partyColor = id => (PARTY_COLORS.find(p => p.id === id) ?? PARTY_COLORS[5]).color;
const partyRank  = id => { const i = PARTY_COLORS.findIndex(p => p.id === id); return i < 0 ? 99 : i; };

// ============================================================
//  DATA
// ============================================================

function shape(ageRows, congressRows) {
  all = ageRows.map(r => ({
    congress: +r[F.congress],
    id:       r[F.id],
    name:     r[F.name],
    state:    r[F.state],
    party:    r[F.party],
    partyRaw: r[F.partyRaw],
    age:      +r[F.age],
    exact:    +r[F.ageExact],
    // Dated from a birth year or month rather than a full date, so the age
    // could fall one bin either way. Drawn outlined rather than filled.
    approx:   (r[F.precision] || 'day') !== 'day',
  }));

  congresses = congressRows.map(r => ({
    n:        +r[F.congress],
    year:     +r[F.year],
    convened: r[F.convened],
    seats:    +r[F.seats],
    missing:  +r[F.missing] || 0,
    median:   r[F.median] === '' ? null : +r[F.median],
  })).sort((a, b) => a.n - b.n);

  byCongress = d3.group(all, d => d.congress);
  ageDomain = d3.range(d3.min(all, d => d.age), d3.max(all, d => d.age) + 1);

  // The all-Congress reference profile, as shares so it can be rescaled to
  // whatever number of seats is selected.
  const tally = d3.rollup(all, v => v.length, d => d.age);
  for (const a of ageDomain) allShares.set(a, (tally.get(a) ?? 0) / all.length);

  const first = congresses[0].n;
  const last = congresses[congresses.length - 1].n;
  if (DEFAULT_SELECTION === 'all') { state.lo = first; state.hi = last; }
  else if (DEFAULT_SELECTION === 'last') { state.lo = state.hi = last; }
  else { state.lo = state.hi = +DEFAULT_SELECTION; }
}

const selection = () => all.filter(d => d.congress >= state.lo && d.congress <= state.hi);

/**
 * Seats the selection actually had, against the ones we can draw.
 *
 * A senator with no recorded birth date has no age, so there is nowhere on
 * this axis to put them — they are simply absent from the chart. That is
 * invisible unless we say so, and before 1830 it runs to one seat in eight.
 */
function coverage() {
  const inSel = congresses.filter(c => c.n >= state.lo && c.n <= state.hi);
  const seats = d3.sum(inSel, c => c.seats);
  const missing = d3.sum(inSel, c => c.missing);
  return { seats, missing, shown: seats - missing, share: seats ? (seats - missing) / seats : 1 };
}

/** Caveats that apply to the current selection, most serious first. */
function notes() {
  const out = [];
  const { seats, missing, shown } = coverage();

  if (missing) {
    const pct = d3.format('.0%')(missing / seats);
    out.push({
      warn: true,
      text: `${fmtInt(missing)} of ${fmtInt(seats)} seats (${pct}) have no recorded birth date. ` +
            `They cannot be placed on an age axis, so they are not drawn, and the grey shape ` +
            `is scaled to the ${fmtInt(shown)} shown.`,
    });
  }

  const sel = selection();
  const approx = sel.filter(d => d.approx).length;
  if (approx) {
    const pct = d3.format('.0%')(approx / sel.length);
    out.push({
      warn: false,
      text: `${fmtInt(approx)} of ${fmtInt(sel.length)} seats (${pct}) are dated from a birth ` +
            `year rather than a full date. Those dots are outlined and may sit one bin either way.`,
    });
  }
  return out;
}

/**
 * Shares of the comparison population, keyed by integer age.
 *
 * 'all'   — every Congress ever. A fixed yardstick; the same silhouette shape
 *           no matter what is selected, only rescaled.
 * 'prior' — the Congresses immediately before the selection, which asks the
 *           more local question: was this chamber old *for its moment*?
 */
function baselineShares() {
  if (state.baseline === 'all') return allShares;

  const from = Math.max(1, state.lo - BASELINE_WINDOW);
  const pool = all.filter(d => d.congress >= from && d.congress < state.lo);
  const out = new Map();
  if (!pool.length) return allShares;          // nothing precedes the 1st Congress
  const tally = d3.rollup(pool, v => v.length, d => d.age);
  for (const a of ageDomain) out.set(a, (tally.get(a) ?? 0) / pool.length);
  return out;
}

/**
 * The age bin holding the 50th percentile.
 *
 * Used for both layers on purpose. d3.median would interpolate to 43.5 on an
 * even-sized selection while a share-weighted profile can only ever name a
 * whole bin, and comparing those two would put a half-year of slop into the
 * one number the chart states outright.
 */
function medianBin(shares) {
  let cum = 0;
  for (const a of ageDomain) {
    cum += shares.get(a) ?? 0;
    if (cum >= 0.5) return a;
  }
  return null;
}

/** Share-weighted profile of a set of observations, keyed by integer age. */
function sharesOf(rows) {
  const tally = d3.rollup(rows, v => v.length, d => d.age);
  return new Map(ageDomain.map(a => [a, (tally.get(a) ?? 0) / rows.length]));
}

// ============================================================
//  CHART
// ============================================================

// Top margin carries two stacked annotation lines plus the median labels that
// sit just above the plot, so it is deeper than it looks like it needs to be.
const MARGIN = { top: 52, right: 24, bottom: 46, left: 50 };
let chartPaint = () => {};

function renderChart() {
  const width  = el.chart.clientWidth;
  const height = el.chart.clientHeight;
  if (!width || !height || state.view !== 'chart') return;

  // The header carries the standing explainer plus whatever caveats apply, so
  // the top margin grows with them rather than letting text land in the plot.
  const caveats = notes();
  const topPad  = 30 + caveats.length * 14;

  const innerW = width  - MARGIN.left - MARGIN.right;
  const innerH = height - topPad - MARGIN.bottom;
  if (innerW <= 0 || innerH <= 0) return;

  const sel    = selection();
  const shares = baselineShares();

  // Both layers count senators, so they share one scale. The silhouette is
  // just the baseline's shares scaled up to however many seats are selected.
  const expected = new Map(ageDomain.map(a => [a, (shares.get(a) ?? 0) * sel.length]));
  const columns  = d3.rollup(sel, v => v.length, d => d.age);
  const peak     = Math.max(d3.max(columns.values()) ?? 0, d3.max(expected.values()) ?? 0, 1);

  // The age axis is fixed so that shapes stay comparable across selections,
  // which means a column cannot answer a tall selection by getting narrower.
  // Instead it gets *wider*: k dots per row inside the bin. One Congress needs
  // k=1 and looks like a classic dot plot; brushing an era raises k and the
  // bin becomes a small block of dots rather than a thread of them.
  const stepX = innerW / ageDomain.length;
  let k = 1;
  while (k < 8 && Math.ceil(peak / k) * (stepX / k) > innerH) k++;

  const pitch = stepX / k;                       // centre-to-centre, both axes
  const size  = Math.min(Math.max(pitch - DOT_GAP, DOT_MIN), DOT_MAX);
  const unitY = pitch / k;                       // pixels per senator
  const plotH = Math.min(Math.ceil(peak / k) * pitch, innerH);

  // Seventy age bins against a column six senators tall is naturally a wide,
  // short chart. Rather than stranding it at the foot of a tall panel, the
  // svg takes only the height it needs and the panel centres it.
  const svgH = Math.min(height, topPad + plotH + MARGIN.bottom);
  const baseline = topPad + plotH;

  const left = MARGIN.left;
  const x = a => left + (a - ageDomain[0] + 0.5) * stepX;
  const yOf = v => baseline - v * unitY;

  const svg = el.chartSvg.attr('width', width).attr('height', svgH);
  svg.selectAll('*').remove();

  // ── Count rules ──
  const ticks = d3.ticks(0, peak, Math.min(6, Math.max(2, Math.floor(plotH / 40))))
                  .filter(t => t > 0);
  const gRule = svg.append('g');
  gRule.selectAll('line').data(ticks).join('line')
    .attr('class', 'count-rule')
    .attr('x1', left).attr('x2', left + innerW)
    .attr('y1', t => Math.round(yOf(t)) + 0.5)
    .attr('y2', t => Math.round(yOf(t)) + 0.5);
  gRule.selectAll('text').data(ticks).join('text')
    .attr('class', 'count-label')
    .attr('x', left - 8).attr('y', t => yOf(t))
    .text(t => t);

  // ── Silhouette: a step outline, drawn under everything ──
  const pts = [];
  for (const a of ageDomain) {
    const h = expected.get(a) ?? 0;
    pts.push([x(a) - stepX / 2, yOf(h)], [x(a) + stepX / 2, yOf(h)]);
  }
  const areaPath = d3.line()(pts) +
    `L${x(ageDomain[ageDomain.length - 1]) + stepX / 2},${baseline}` +
    `L${x(ageDomain[0]) - stepX / 2},${baseline}Z`;

  svg.append('path')
    .attr('class', 'silhouette')
    .attr('d', areaPath)
    .attr('fill', SILHOUETTE_FILL)
    .attr('stroke', SILHOUETTE_STROKE)
    .attr('stroke-width', 1)
    .attr('stroke-linejoin', 'round');

  // ── Axes ──
  svg.append('line')
    .attr('class', 'axis-line')
    .attr('x1', left).attr('x2', left + innerW)
    .attr('y1', Math.round(baseline) + 0.5).attr('y2', Math.round(baseline) + 0.5);

  const stride = stepX < 11 ? 10 : stepX < 20 ? 5 : 2;
  const labelled = ageDomain.filter(a => a % stride === 0);
  svg.append('g').selectAll('line').data(ageDomain).join('line')
    .attr('class', 'tick-mark')
    .attr('x1', a => Math.round(x(a)) + 0.5).attr('x2', a => Math.round(x(a)) + 0.5)
    .attr('y1', baseline).attr('y2', a => baseline + (a % stride === 0 ? 6 : 3));
  svg.append('g').selectAll('text').data(labelled).join('text')
    .attr('class', 'tick-label')
    .attr('x', a => x(a)).attr('y', baseline + 19)
    .text(a => a);

  svg.append('text')
    .attr('class', 'axis-title')
    .attr('x', left + innerW / 2).attr('y', baseline + 38)
    .attr('text-anchor', 'middle')
    .text('Age in years when the Congress convened');

  svg.append('text')
    .attr('class', 'axis-title')
    .attr('transform', `translate(16,${baseline - plotH / 2}) rotate(-90)`)
    .attr('text-anchor', 'middle')
    .text('Senators');

  // ── Dots: one per sitting senator, party-blocked within each column ──
  const dots = [];
  for (const [age, group] of d3.group(sel, d => d.age)) {
    group.sort((a, b) => partyRank(a.party) - partyRank(b.party) || a.exact - b.exact)
         .forEach((d, i) => dots.push({ ...d, slot: i }));
  }

  const r = size / 2;
  const binLeft = a => left + (a - ageDomain[0]) * stepX;
  const cx = d => binLeft(d.age) + ((d.slot % k) + 0.5) * pitch;
  const cy = d => baseline - (Math.floor(d.slot / k) + 0.5) * pitch;

  // Selecting every Congress puts 9,299 dots on screen, so one <g> plus three
  // circles apiece would be nearly 37,000 nodes. Instead: one circle per
  // senator, and a single shared hover ring rather than one per dot.
  const g = svg.append('g').attr('class', 'dots');
  const ringW = Math.min(1.6, Math.max(0.8, r * 0.34));

  const dot = g.selectAll('circle.dot-fill').data(dots).join('circle')
    .attr('class', 'dot-fill')
    .attr('cx', cx).attr('cy', cy)
    .attr('r', d => d.approx ? Math.max(0.5, r - ringW / 2) : r)
    .attr('fill', d => d.approx ? 'none' : partyColor(d.party))
    .attr('stroke', d => d.approx ? partyColor(d.party) : 'none')
    .attr('stroke-width', d => d.approx ? ringW : 0);

  // Dots occupy a regular grid, so the one under the pointer can be computed
  // rather than hit-tested. That keeps picking a senator working at every
  // selection size — the alternative, a hit circle each, stops being
  // affordable exactly when the dots get too small to aim at anyway. The whole
  // cell is the target, which is what makes a 5px dot pickable at all.
  const bySlot = new Map(dots.map(d => [`${d.age}|${d.slot}`, d]));

  // A senator appears once per Congress they sat in, so highlighting reaches
  // every instance rather than the one dot under the cursor — which is what
  // makes a long career legible as a run of dots marching to the right.
  const byPerson = d3.group(dots, d => d.id);
  for (const [, ds] of byPerson) {
    const lo = d3.min(ds, x => x.age), hi = d3.max(ds, x => x.age);
    ds.forEach(x => { x.appearances = ds.length; x.ageLo = lo; x.ageHi = hi; });
  }

  const at = (mx, my) => {
    const age = ageDomain[0] + Math.floor((mx - left) / stepX);
    if (age < ageDomain[0] || age > ageDomain[ageDomain.length - 1]) return null;
    const col = Math.floor((mx - binLeft(age)) / pitch);
    const row = Math.floor((baseline - my) / pitch);
    if (col < 0 || col >= k || row < 0) return null;
    return bySlot.get(`${age}|${row * k + col}`) ?? null;
  };

  svg.append('rect')
    .attr('x', left).attr('y', baseline - plotH)
    .attr('width', innerW).attr('height', plotH)
    .attr('fill', 'transparent')
    .style('cursor', 'crosshair')
    .on('mousemove', event => {
      const [mx, my] = d3.pointer(event, svg.node());
      const d = at(mx, my);
      if (d) { setHover(d); showTip(event, d); }
      else { setHover(null); hideTip(); }
    })
    .on('mouseleave', () => { setHover(null); hideTip(); });

  // Rings are kept clear of the tiny-dot radius so the highlight stays visible
  // around a dot only a few pixels across.
  const ringR = Math.max(r + 1, 5);
  const rings = svg.append('g').style('pointer-events', 'none');

  // Dimming every other dot is a per-move pass over the whole selection, which
  // is fine for a few hundred and not for nine thousand. The rings carry the
  // highlight on their own above that.
  const dim = dots.length <= 2500;
  let dimmed = false;

  chartPaint = () => {
    const h = state.hovered;
    const marked = h ? (byPerson.get(h.id) ?? []) : [];

    rings.selectAll('circle').data(marked).join('circle')
      .attr('class', 'dot-ring')
      .attr('r', ringR)
      .attr('cx', cx).attr('cy', cy)
      .attr('stroke', HOVER_COLOR);

    if (dim && h) { dot.attr('opacity', d => d.id === h.id ? 1 : 0.45); dimmed = true; }
    else if (dimmed) { dot.attr('opacity', 1); dimmed = false; }
  };
  chartPaint();

  // ── Median markers, the one comparison worth stating outright.
  //    Both are medians of the integer age, so they are like for like.
  const medSel = sel.length ? medianBin(sharesOf(sel)) : null;
  const medBase = medianBin(shares);

  // When the two medians are close their labels would collide, so the
  // comparison one steps down and reads away from the selection's line.
  const near = medSel != null && medBase != null && Math.abs(medSel - medBase) * stepX < 150;
  const same = medSel != null && medSel === medBase;
  const gMed = svg.append('g');
  const markers = same
    ? [[medSel, `both medians, ${medSel}`, null]]
    : [[medSel, `this selection, median ${medSel ?? '—'}`, null],
       [medBase, `comparison, median ${medBase ?? '—'}`, '3 3']];
  for (const [value, label, dash] of markers) {
    if (!value) continue;
    const px = left + (value - ageDomain[0] + 0.5) * stepX;
    const flip = dash && near && medBase <= medSel;
    gMed.append('line')
      .attr('x1', px).attr('x2', px)
      .attr('y1', baseline).attr('y2', yOf(peak) - 4)
      .attr('stroke', dash ? SILHOUETTE_STROKE : '#555')
      .attr('stroke-width', dash ? 1.5 : 2)
      .attr('stroke-dasharray', dash);
    gMed.append('text')
      .attr('class', 'annot')
      .attr('x', px + (flip ? -5 : 5))
      .attr('y', yOf(peak) + (dash ? (near ? 16 : 10) : -2))
      .attr('text-anchor', flip ? 'end' : 'start')
      .text(label);
  }

  // With everything selected against an all-Congress baseline the two layers
  // are the same population, so the dots sit exactly on the grey and hide it.
  // Say so, rather than referring to a shape the reader cannot yet see.
  const coincide = state.baseline === 'all' &&
                   state.lo === congresses[0].n &&
                   state.hi === congresses[congresses.length - 1].n;

  svg.append('text')
    .attr('class', 'annot')
    .attr('x', left).attr('y', 16)
    .text(coincide
      ? 'Every Congress is selected, so the dots cover the grey reference shape exactly. ' +
        'Drag the timeline below to compare one era against it.'
      : 'Grey shape: the same number of seats, aged the way the comparison population was. ' +
        'Dots: the senators actually sitting.');

  caveats.forEach((c, i) => {
    svg.append('text')
      .attr('class', c.warn ? 'annot warn' : 'annot')
      .attr('x', left).attr('y', 30 + i * 14)
      .text(c.text);
  });
}

// ============================================================
//  TIMELINE
// ============================================================

let tlBrush = null, tlX = null, tlWidth = 0;
let brushAtStart = null;
let tlPaint = () => {};
let suppress = false;

function renderTimeline() {
  const width = el.tl.clientWidth;
  if (!width) return;
  tlWidth = width;

  const H = TIMELINE_HEIGHT;
  const m = { top: 14, right: 24, bottom: 20, left: 50 };
  const innerW = width - m.left - m.right;
  const innerH = H - m.top - m.bottom;

  const first = congresses[0].n, last = congresses[congresses.length - 1].n;
  const band = innerW / (last - first + 1);
  tlX = n => m.left + (n - first + 0.5) * band;

  const meds = congresses.filter(c => c.median != null);
  const y = d3.scaleLinear()
    .domain(d3.extent(meds, c => c.median)).nice()
    .range([m.top + innerH, m.top]);

  const svg = el.tlSvg.attr('width', width).attr('height', H);
  svg.selectAll('*').remove();

  // All-time reference, the same number the chart names as the comparison
  // median when the baseline is set to every Congress.
  const allTime = medianBin(allShares);
  if (allTime != null && allTime >= y.domain()[0] && allTime <= y.domain()[1]) {
    svg.append('line')
      .attr('x1', m.left).attr('x2', m.left + innerW)
      .attr('y1', Math.round(y(allTime)) + 0.5).attr('y2', Math.round(y(allTime)) + 0.5)
      .attr('stroke', SILHOUETTE_STROKE)
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', '3 3');
    svg.append('text')
      .attr('class', 'tl-label')
      .attr('x', m.left + innerW).attr('y', y(allTime) - 4)
      .attr('text-anchor', 'end')
      .text(`all-time median ${allTime}`);
  }

  // Median-age trace: the strip earns its space by showing the trend you are
  // brushing over, not just a bare slider.
  svg.append('path')
    .attr('d', d3.line().x(c => tlX(c.n)).y(c => y(c.median))(meds))
    .attr('fill', 'none')
    .attr('stroke', TREND_COLOR)
    .attr('stroke-width', 1.25);

  // One marker per Congress, so the strip reads as 119 discrete chambers
  // rather than a continuous curve — and so the selection is countable.
  const marks = svg.append('g').attr('class', 'tl-marks')
    .selectAll('circle').data(meds).join('circle')
    .attr('cx', c => tlX(c.n)).attr('cy', c => y(c.median))
    .attr('r', Math.min(2.6, Math.max(1.4, (innerW / congresses.length) * 0.22)));

  tlPaint = () => {
    marks
      .attr('fill', c => c.n >= state.lo && c.n <= state.hi ? '#3d5a80' : '#c9c7c2')
      .attr('opacity', c => c.n >= state.lo && c.n <= state.hi ? 1 : 0.85);
  };

  svg.append('g').selectAll('text').data(y.ticks(3)).join('text')
    .attr('class', 'tl-label')
    .attr('x', m.left - 8).attr('y', t => y(t))
    .attr('text-anchor', 'end').attr('dominant-baseline', 'middle')
    .text(t => t);

  svg.append('text')
    .attr('class', 'tl-title')
    .attr('x', m.left).attr('y', m.top - 4)
    .text('Median age of the chamber — drag to select Congresses, click for one');

  // Year axis
  const years = congresses.filter(c => c.year % 20 === 0 || c.year % 20 === 1);
  svg.append('g').selectAll('text').data(years).join('text')
    .attr('class', 'tl-label')
    .attr('x', c => tlX(c.n)).attr('y', H - 6)
    .attr('text-anchor', 'middle')
    .text(c => c.year);

  tlBrush = d3.brushX()
    .extent([[m.left, m.top], [m.left + innerW, m.top + innerH]])
    .on('start brush end', onBrush);

  svg.append('g').attr('class', 'tl-brush').call(tlBrush);
  tlPaint();
  moveBrushToSelection();
}

function congressAtPixel(px) {
  let best = null, bestD = Infinity;
  for (const c of congresses) {
    const d = Math.abs(tlX(c.n) - px);
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}

function pickOne(sourceEvent) {
  const c = congressAtPixel(d3.pointer(sourceEvent, el.tlSvg.node())[0]);
  if (!c) return false;
  state.lo = state.hi = c.n;
  redraw();
  moveBrushToSelection();
  return true;
}

function onBrush(event) {
  if (suppress) return;

  if (event.type === 'start') {
    brushAtStart = event.selection ? [...event.selection] : null;
    return;
  }

  // A click on empty track clears the selection; a click *inside* an existing
  // one is read by d3 as grabbing it, so the selection comes back unchanged.
  // Both mean "just this Congress" — and with every Congress selected by
  // default the second case is the only one a reader can even reach, since
  // the brush rect then covers the whole strip.
  if (event.type === 'end' && event.sourceEvent) {
    const s = event.selection;
    const unmoved = s && brushAtStart &&
                    s[0] === brushAtStart[0] && s[1] === brushAtStart[1];
    if ((!s || unmoved) && pickOne(event.sourceEvent)) return;
  }

  if (!event.selection) return;

  const [x0, x1] = event.selection;
  const hit = congresses.filter(c => tlX(c.n) >= x0 && tlX(c.n) <= x1);
  const picked = hit.length ? hit : [congressAtPixel((x0 + x1) / 2)];
  const lo = picked[0].n, hi = picked[picked.length - 1].n;
  if (lo === state.lo && hi === state.hi) return;
  state.lo = lo; state.hi = hi;
  redraw();
}

function moveBrushToSelection() {
  if (!tlBrush) return;
  const band = tlX(2) - tlX(1);
  suppress = true;
  el.tlSvg.select('.tl-brush')
    .call(tlBrush.move, [tlX(state.lo) - band / 2, tlX(state.hi) + band / 2]);
  suppress = false;
}

// ============================================================
//  TABLE
// ============================================================

function renderTable() {
  const sel = selection().slice().sort((a, b) =>
    a.congress - b.congress || b.age - a.age || d3.ascending(a.name, b.name));

  const cols = [
    { label: 'Congress', num: true, cell: d => d.congress },
    { label: 'Senator',  cell: d =>
        `<span class="swatch" style="background:${partyColor(d.party)}"></span>${d.name}` },
    { label: 'State',    cell: d => d.state },
    { label: 'Party',    cell: d => d.party === d.partyRaw || !d.partyRaw
        ? d.party : `${d.party} <span style="color:#999">(${d.partyRaw})</span>` },
    { label: 'Age',      num: true, cell: d => d.age },
  ];

  el.table.selectAll('*').remove();
  el.table.append('thead').append('tr').selectAll('th').data(cols).join('th')
    .attr('class', c => c.num ? 'num' : null)
    .text(c => c.label);

  el.table.append('tbody').selectAll('tr').data(sel).join('tr')
    .selectAll('td').data(d => cols.map(c => ({ c, d }))).join('td')
      .attr('class', o => o.c.num ? 'num' : null)
      .html(o => o.c.cell(o.d));
}

// ============================================================
//  TOOLTIP / HOVER
// ============================================================

function setHover(d) {
  if (state.hovered === d) return;
  state.hovered = d;
  chartPaint();
}

function showTip(event, d) {
  const cg = congresses.find(c => c.n === d.congress);
  const raw = d.partyRaw && d.partyRaw !== d.party
    ? ` <span style="color:#aaa">(${d.partyRaw})</span>` : '';
  placeTip(event, `
    <div class="tt-name"><span class="swatch" style="background:${partyColor(d.party)}"></span>${d.name}</div>
    <div class="tt-sub">${d.party}${raw} · ${d.state}</div>
    <div class="tt-stat">Age <b>${d.age}</b> at the ${ordinal(d.congress)} Congress${
      d.approx ? ' <i>(approx.)</i>' : ''}</div>
    ${d.appearances > 1
      ? `<div class="tt-stat">Ringed in <b>${d.appearances}</b> of the Congresses shown, ` +
        `ages <b>${d.ageLo}–${d.ageHi}</b></div>` : ''}
    <div class="tt-meta">convened ${cg ? cg.convened : ''}${
      d.approx ? '<br>birth year known, exact date not — the age may be one year either way' : ''}</div>`);
}

function placeTip(event, html) {
  const tip = el.tooltip;
  tip.innerHTML = html;
  tip.style.display = 'block';
  const w = tip.offsetWidth, h = tip.offsetHeight;
  let x = event.clientX + 14, y = event.clientY + 14;
  if (x + w > window.innerWidth  - 8) x = event.clientX - w - 14;
  if (y + h > window.innerHeight - 8) y = event.clientY - h - 14;
  tip.style.left = Math.max(8, x) + 'px';
  tip.style.top  = Math.max(8, y) + 'px';
}

const hideTip = () => { el.tooltip.style.display = 'none'; };

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// ============================================================
//  READOUT / KEY
// ============================================================

function updateReadout() {
  const sel = selection();
  const a = congresses.find(c => c.n === state.lo);
  const b = congresses.find(c => c.n === state.hi);
  const count = state.hi - state.lo + 1;
  const span = state.lo === state.hi
    ? `<b>${ordinal(state.lo)} Congress</b> (${a.year})`
    : `<b>${ordinal(state.lo)}–${ordinal(state.hi)}</b> (${a.year}–${b.year})` +
      ` · ${count} Congresses`;
  const med = sel.length ? medianBin(sharesOf(sel)) : null;
  const { missing, share } = coverage();
  el.readout.innerHTML =
    `${span} · ${fmtInt(sel.length)} senator${sel.length === 1 ? '' : 's'}` +
    (med ? ` · median age <b>${med}</b>` : '') +
    (missing
      ? ` · <span class="${share < COVERAGE_WARN ? 'warn' : 'muted'}">` +
        `${fmtInt(missing)} without a birth date</span>`
      : '');
}

function renderPartyKey() {
  const present = new Set(selection().map(d => d.party));
  const key = d3.select(el.partyKey);

  key.selectAll('div.key-item')
    .data(PARTY_COLORS, d => d.id)
    .join(enter => {
      const item = enter.append('div').attr('class', 'key-item');
      item.append('span').attr('class', 'swatch');
      item.append('span').attr('class', 'key-text');
      return item;
    })
    .classed('is-out', d => !present.has(d.id))
    .call(s => {
      s.select('.swatch').style('background', d => d.color);
      s.select('.key-text').text(d => d.label);
    });

  if (key.select('#key-note').empty()) key.append('span').attr('id', 'key-note');
  const approx = selection().filter(d => d.approx).length;
  key.select('#key-note').text(approx
    ? `Outlined dots are approximate ages — ${fmtInt(approx)} in this selection.`
    : 'Parties dimmed above are absent from this selection.');
}

// ============================================================
//  WIRING
// ============================================================

function redraw() {
  tlPaint();
  renderChart();
  if (state.view === 'table') renderTable();
  updateReadout();
  renderPartyKey();
}

function setView(v) {
  state.view = v;
  el.chart.style.display = v === 'chart' ? '' : 'none';
  el.tableWrap.style.display = v === 'table' ? 'block' : 'none';
  redraw();
}

function wire() {
  d3.select('#baseline').property('value', state.baseline)
    .on('change', function () { hideTip(); state.baseline = this.value; redraw(); });

  d3.select('#view').property('value', state.view)
    .on('change', function () { hideTip(); setView(this.value); });

  let pending;
  const onResize = () => {
    clearTimeout(pending);
    pending = setTimeout(() => { renderChart(); renderTimeline(); }, 80);
  };
  new ResizeObserver(onResize).observe(el.chart);
  new ResizeObserver(onResize).observe(el.tl);
}

// ============================================================
//  BOOT
// ============================================================

Promise.all([d3.csv(AGES_FILE), d3.csv(CONGRESS_FILE)])
  .then(([ageRows, congressRows]) => {
    shape(ageRows, congressRows);
    el.loading.style.display = 'none';
    wire();
    renderTimeline();
    redraw();
  })
  .catch(err => {
    console.error(err);
    el.loading.className = 'err';
    el.loading.textContent =
      `Could not load ${AGES_FILE}. This page uses ES modules and fetch, so it has to be ` +
      `served over HTTP — run "python3 -m http.server 8000" in this folder and open ` +
      `http://localhost:8000. Run build_senate_ages.py first if the CSVs are missing.`;
  });
