// Preflop hand classes (169) and weighted ranges.
//
// Class index layout follows the usual 13x13 chart: row i / column j index
// ranks from Ace (0) down to Deuce (12). i === j is a pocket pair, i < j
// (upper-right) is suited, i > j (lower-left) is offsuit.

import { RANKS, makeCard } from './cards.js';

export const NUM_CLASSES = 169;
const GRID_RANKS = 'AKQJT98765432';

/** Rank index (0=deuce..12=ace) of grid row/col i. */
const gridToRank = (i) => 12 - i;

export function classIndex(i, j) {
  return i * 13 + j;
}

export function classInfo(idx) {
  const i = Math.floor(idx / 13);
  const j = idx % 13;
  if (i === j) return { idx, i, j, hi: gridToRank(i), lo: gridToRank(i), type: 'pair', label: GRID_RANKS[i] + GRID_RANKS[i], combos: 6 };
  if (i < j) return { idx, i, j, hi: gridToRank(i), lo: gridToRank(j), type: 'suited', label: GRID_RANKS[i] + GRID_RANKS[j] + 's', combos: 4 };
  return { idx, i, j, hi: gridToRank(j), lo: gridToRank(i), type: 'offsuit', label: GRID_RANKS[j] + GRID_RANKS[i] + 'o', combos: 12 };
}

export const CLASSES = Array.from({ length: NUM_CLASSES }, (_, i) => classInfo(i));
export const LABEL_TO_CLASS = new Map(CLASSES.map((c) => [c.label, c.idx]));

/** Class index for two hole cards. */
export function classOfCards(c1, c2) {
  const r1 = c1 >> 2;
  const r2 = c2 >> 2;
  const hi = Math.max(r1, r2);
  const lo = Math.min(r1, r2);
  const gi = 12 - hi;
  const gj = 12 - lo;
  if (r1 === r2) return classIndex(gi, gi);
  if ((c1 & 3) === (c2 & 3)) return classIndex(gi, gj);
  return classIndex(gj, gi);
}

/** All concrete two-card combos for a class: array of [c1, c2]. */
export function combosOfClass(idx) {
  const info = CLASSES[idx];
  const out = [];
  if (info.type === 'pair') {
    for (let s1 = 0; s1 < 4; s1++)
      for (let s2 = s1 + 1; s2 < 4; s2++) out.push([makeCard(info.hi, s1), makeCard(info.hi, s2)]);
  } else if (info.type === 'suited') {
    for (let s = 0; s < 4; s++) out.push([makeCard(info.hi, s), makeCard(info.lo, s)]);
  } else {
    for (let s1 = 0; s1 < 4; s1++)
      for (let s2 = 0; s2 < 4; s2++) if (s1 !== s2) out.push([makeCard(info.hi, s1), makeCard(info.lo, s2)]);
  }
  return out;
}

export const CLASS_COMBOS = CLASSES.map((c) => combosOfClass(c.idx));

// ---------------------------------------------------------------------------
// Range parsing: "22+, A2s+, KTs+, QJo, 76s-54s, AKo:0.5"

const rIdx = (ch) => RANKS.indexOf(ch.toUpperCase());

function labelFor(hi, lo, kind) {
  if (hi === lo) return RANKS[hi] + RANKS[hi];
  return RANKS[hi] + RANKS[lo] + kind;
}

function expandToken(token) {
  const out = [];
  const m = token.match(/^([2-9TJQKA])([2-9TJQKA])([so]?)(\+?)(?:-([2-9TJQKA])([2-9TJQKA])([so]?))?$/i);
  if (!m) throw new Error(`Bad range token: ${token}`);
  const [, a, b, kindRaw, plus, c, d] = m;
  const kind = (kindRaw || '').toLowerCase();
  let hi = rIdx(a);
  let lo = rIdx(b);
  if (lo > hi) [hi, lo] = [lo, hi];
  const kinds = hi === lo ? [''] : kind ? [kind] : ['s', 'o'];

  if (hi === lo) {
    // pairs
    let top = hi;
    let bottom = hi;
    if (plus) top = 12;
    if (c) {
      const other = rIdx(c);
      top = Math.max(hi, other);
      bottom = Math.min(hi, other);
    }
    for (let r = bottom; r <= top; r++) out.push(labelFor(r, r, ''));
    return out;
  }
  let loTop = lo;
  let loBottom = lo;
  if (plus) loTop = hi - 1;
  if (c) {
    const otherLo = Math.min(rIdx(c), rIdx(d));
    loTop = Math.max(lo, otherLo);
    loBottom = Math.min(lo, otherLo);
    // "76s-54s" style connector ranges: walk both ranks down together
    const otherHi = Math.max(rIdx(c), rIdx(d));
    if (otherHi !== hi) {
      const gap = hi - lo;
      const startHi = Math.max(hi, otherHi);
      const endHi = Math.min(hi, otherHi);
      for (let h = startHi; h >= endHi; h--) for (const k of kinds) out.push(labelFor(h, h - gap, k));
      return out;
    }
  }
  for (let r = loBottom; r <= loTop; r++) for (const k of kinds) out.push(labelFor(hi, r, k));
  return out;
}

/** Parse a range string into a Float64Array(169) of weights in [0,1]. */
export function parseRange(str) {
  const w = new Float64Array(NUM_CLASSES);
  if (!str) return w;
  for (const raw of str.split(',')) {
    const t = raw.trim();
    if (!t) continue;
    const [tok, weightStr] = t.split(':');
    const weight = weightStr === undefined ? 1 : Number(weightStr);
    for (const label of expandToken(tok)) {
      const idx = LABEL_TO_CLASS.get(label);
      if (idx === undefined) throw new Error(`Unknown hand ${label}`);
      w[idx] = Math.max(w[idx], weight);
    }
  }
  return w;
}

export function rangeCombos(weights) {
  let n = 0;
  for (let i = 0; i < NUM_CLASSES; i++) n += weights[i] * CLASSES[i].combos;
  return n;
}

/** Fraction of all 1326 starting hands contained in the range. */
export function rangePercent(weights) {
  return rangeCombos(weights) / 1326;
}

/**
 * Build a range containing the top `fraction` of hands according to `order`
 * (an array of class indices, best first). The boundary class gets a partial weight.
 */
export function topRange(order, fraction) {
  const w = new Float64Array(NUM_CLASSES);
  let target = Math.max(0, Math.min(1, fraction)) * 1326;
  for (const idx of order) {
    if (target <= 0) break;
    const c = CLASSES[idx].combos;
    if (target >= c) { w[idx] = 1; target -= c; }
    else { w[idx] = target / c; target = 0; }
  }
  return w;
}

/** Compact string form of a range (lists classes, not range shorthand). */
export function rangeToString(weights, threshold = 0.5) {
  return CLASSES.filter((c) => weights[c.idx] >= threshold).map((c) => c.label).join(', ');
}
