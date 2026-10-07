// Minimal, theme-aware charts drawn to the container's real width.
// Specs: hairline solid grid, 2px lines, >=8px end markers with a surface
// ring, bars <=24px with 4px rounded data-ends, hover tooltips on every mark.

import { esc } from './dom.js';

/**
 * Bullet rows: a shaded "solid range" band, a target tick, and one dot per
 * series (you, plus an optional comparison). HTML so it reflows on phones.
 * rows: [{label, values:[number|null,...], lo, hi, target, max, fmt}]
 */
export function bulletRowsHTML(rows, seriesNames) {
  const colors = ['var(--series-1)', 'var(--series-2)'];
  const legend = seriesNames.length > 1
    ? `<div class="legend" style="margin-bottom:8px">${seriesNames.map((n, i) => `<span><i style="background:${colors[i]};border-radius:50%"></i>${esc(n)}</span>`).join('')}<span><i style="background:var(--surface-2);border:1px solid var(--line)"></i>Solid range</span></div>`
    : `<div class="legend" style="margin-bottom:8px"><span><i style="background:var(--surface-2);border:1px solid var(--line)"></i>Solid range</span><span><i style="background:var(--ink);width:2px"></i>Target</span></div>`;
  const body = rows.map((r) => {
    const x = (v) => `${Math.max(0, Math.min(100, (v / r.max) * 100))}%`;
    const dots = r.values.map((v, i) => (v == null ? '' : `<span data-tip="${esc(`<b>${seriesNames[i]}</b> · ${r.label}: ${r.fmt(v)}<br>Solid range ${r.fmt(r.lo)}–${r.fmt(r.hi)}`)}" style="position:absolute;left:${x(v)};top:50%;width:12px;height:12px;margin:-6px 0 0 -6px;border-radius:50%;background:${colors[i]};box-shadow:0 0 0 2px var(--surface);z-index:${2 - i}"></span>`)).join('');
    const status = r.values[0] == null ? '' : r.values[0] < r.lo || r.values[0] > r.hi ? 'leak' : 'ok';
    return `<div style="display:grid;grid-template-columns:minmax(84px,130px) minmax(0,1fr) 78px;gap:12px;align-items:center;padding:7px 0;border-top:1px solid var(--grid)">
      <span class="small" style="color:var(--ink-2)">${esc(r.label)}</span>
      <span style="position:relative;height:16px">
        <span style="position:absolute;left:0;right:0;top:50%;height:1px;background:var(--axis)"></span>
        <span style="position:absolute;left:${x(r.lo)};width:calc(${x(r.hi)} - ${x(r.lo)});top:3px;bottom:3px;background:var(--surface-2);border:1px solid var(--line);border-radius:3px"></span>
        <span style="position:absolute;left:${x(r.target)};top:0;bottom:0;width:2px;margin-left:-1px;background:var(--ink-2)"></span>
        ${dots}
      </span>
      <span class="data small" style="text-align:right;white-space:nowrap">${r.values[0] == null ? '—' : r.fmt(r.values[0])}${status ? ` <span class="status st-${status}" aria-label="${status === 'ok' ? 'in range' : 'outside range'}"></span>` : ''}</span>
    </div>`;
  }).join('');
  return legend + body;
}

/** Single-series line over sessions with crosshair tooltip. points: [{y, label}] */
export function drawLine(el, points, { yMax = 1, yFmt = (v) => `${Math.round(v * 100)}%`, height = 200, title = '' } = {}) {
  const W = Math.max(280, el.clientWidth || 600);
  const H = height;
  const m = { l: 40, r: 16, t: 12, b: 26 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;
  if (!points.length) { el.innerHTML = '<div class="empty">No sessions yet.</div>'; return; }
  const n = points.length;
  const X = (i) => m.l + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
  const Y = (v) => m.t + ih - (Math.max(0, Math.min(yMax, v)) / yMax) * ih;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * yMax);
  let svg = `<svg class="chart" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">`;
  for (const t of ticks) svg += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(t)}" y2="${Y(t)}" stroke="var(--grid)" stroke-width="1"/><text x="${m.l - 6}" y="${Y(t) + 4}" text-anchor="end">${yFmt(t)}</text>`;
  svg += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(0)}" y2="${Y(0)}" stroke="var(--axis)" stroke-width="1"/>`;
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p.y).toFixed(1)}`).join('');
  const area = `${d}L${X(n - 1).toFixed(1)},${Y(0)}L${X(0).toFixed(1)},${Y(0)}Z`;
  svg += `<path d="${area}" fill="var(--series-1)" opacity="0.1"/>`;
  svg += `<path d="${d}" fill="none" stroke="var(--series-1)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  const step = Math.ceil(n / 8);
  points.forEach((p, i) => {
    if (i % step === 0 || i === n - 1) svg += `<text x="${X(i)}" y="${H - 8}" text-anchor="middle">${esc(p.xLabel ?? i + 1)}</text>`;
  });
  const last = points[n - 1];
  svg += `<circle cx="${X(n - 1)}" cy="${Y(last.y)}" r="5" fill="var(--series-1)" stroke="var(--surface)" stroke-width="2"/>`;
  svg += `<text class="lbl" x="${Math.min(X(n - 1), W - m.r - 4)}" y="${Y(last.y) - 10}" text-anchor="end">${yFmt(last.y)}</text>`;
  // hover hit areas (one band per point)
  const band = n === 1 ? iw : iw / (n - 1);
  points.forEach((p, i) => {
    svg += `<rect x="${X(i) - band / 2}" y="${m.t}" width="${band}" height="${ih}" fill="transparent" data-tip="${esc(p.tip || `${p.label}: ${yFmt(p.y)}`)}"/>`;
  });
  svg += '</svg>';
  el.innerHTML = svg;
}

/** Grouped columns. cats: string[], series: [{name, values:number[], color}] */
export function drawGroupedBars(el, cats, series, { yMax, yFmt = (v) => `${Math.round(v * 100)}%`, height = 220, title = '' } = {}) {
  const W = Math.max(280, el.clientWidth || 600);
  const H = height;
  const m = { l: 40, r: 10, t: 14, b: 26 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;
  const max = yMax ?? Math.max(0.1, ...series.flatMap((s) => s.values.filter((v) => v != null))) * 1.1;
  const Y = (v) => m.t + ih - (Math.max(0, v) / max) * ih;
  const groupW = iw / cats.length;
  const barW = Math.min(24, (groupW - 10) / series.length - 2);
  let svg = `<svg class="chart" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">`;
  for (const f of [0, 0.25, 0.5, 0.75, 1]) {
    const t = f * max;
    svg += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(t)}" y2="${Y(t)}" stroke="var(--grid)"/><text x="${m.l - 6}" y="${Y(t) + 4}" text-anchor="end">${yFmt(t)}</text>`;
  }
  cats.forEach((c, ci) => {
    const gx = m.l + ci * groupW + groupW / 2;
    const total = series.length * barW + (series.length - 1) * 2;
    series.forEach((s, si) => {
      const v = s.values[ci];
      if (v == null) return;
      const x = gx - total / 2 + si * (barW + 2);
      const y = Y(v);
      const h = Math.max(0, Y(0) - y);
      const r = Math.min(4, h, barW / 2);
      // rounded data-end, square at the baseline
      const path = `M${x},${Y(0)}V${y + r}Q${x},${y} ${x + r},${y}H${x + barW - r}Q${x + barW},${y} ${x + barW},${y + r}V${Y(0)}Z`;
      svg += `<path d="${path}" fill="${s.color}" data-tip="${esc(`<b>${c}</b> · ${s.name}: ${yFmt(v)}${s.notes?.[ci] ? `<br>${s.notes[ci]}` : ''}`)}"/>`;
    });
    svg += `<text x="${gx}" y="${H - 8}" text-anchor="middle">${esc(c)}</text>`;
  });
  svg += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(0)}" y2="${Y(0)}" stroke="var(--axis)"/>`;
  svg += '</svg>';
  el.innerHTML = svg;
}

/** Horizontal single-series bars with the value at the tip. rows: [{label, value, tip}] */
export function hBarsHTML(rows, { max = 1, fmt = (v) => `${Math.round(v * 100)}%`, color = 'var(--series-1)' } = {}) {
  return rows.map((r) => `<div style="display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,2fr);gap:10px;align-items:center;padding:4px 0" data-tip="${esc(r.tip || `${r.label}: ${fmt(r.value)}`)}">
    <span class="small" style="color:var(--ink-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.label)}</span>
    <span style="display:flex;align-items:center;gap:8px"><span style="height:12px;width:${Math.max(1, (r.value / max) * 100) * 0.82}%;background:${color};border-radius:0 4px 4px 0"></span><span class="data small">${fmt(r.value)}</span></span>
  </div>`).join('');
}
