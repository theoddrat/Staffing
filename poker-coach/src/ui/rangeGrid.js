// 13x13 preflop range grid: each cell shows raise / call / fold shares.

import { CLASSES } from '../engine/ranges.js';
import { esc } from './dom.js';

/**
 * @param {{aggressive:ArrayLike<number>, passive?:ArrayLike<number>}} grid per-class frequencies
 * @param {object} [opts] { heroClass, big, labels: {aggressive, passive} }
 */
export function rangeGridHTML(grid, opts = {}) {
  const lab = opts.labels || { aggressive: 'Raise', passive: 'Call' };
  const cells = CLASSES.map((c) => {
    const a = Math.max(0, Math.min(1, grid.aggressive[c.idx] || 0));
    const p = Math.max(0, Math.min(1 - a, grid.passive ? grid.passive[c.idx] || 0 : 0));
    const tip = `<b>${c.label}</b> · ${c.combos} combos<br>${lab.aggressive} ${Math.round(a * 100)}%${grid.passive ? ` · ${lab.passive} ${Math.round(p * 100)}%` : ''} · Fold ${Math.round((1 - a - p) * 100)}%`;
    return `<div class="cell${opts.heroClass === c.idx ? ' hero' : ''}" data-tip="${esc(tip)}"><div class="fill"><i style="width:${a * 100}%;background:var(--series-2)"></i><i style="width:${p * 100}%;background:var(--series-1)"></i></div><span style="${a + p > 0.5 ? 'color:#fff' : ''}">${c.label}</span></div>`;
  }).join('');
  return `<div class="range-grid${opts.big ? ' big' : ''}" role="img" aria-label="Preflop range chart">${cells}</div>`;
}

export function rangeLegendHTML(labels = { aggressive: 'Raise / jam', passive: 'Call' }, showPassive = true) {
  return `<div class="legend"><span><i style="background:var(--series-2)"></i>${esc(labels.aggressive)}</span>${showPassive ? `<span><i style="background:var(--series-1)"></i>${esc(labels.passive)}</span>` : ''}<span><i style="background:var(--surface);border:1px solid var(--line)"></i>Fold</span></div>`;
}
