// Preflop math on the 169 hand classes: class-vs-class equity (from the
// precomputed matrix), card-removal-aware combo counts, equity vs ranges, and
// a hand ranking used to build "top X%" ranges.

import { EQUITY_UPPER } from '../data/equity169.js';
import { NUM_CLASSES, CLASSES, CLASS_COMBOS } from './ranges.js';

const N = NUM_CLASSES;
const EQ = new Float32Array(N * N);
const COMPAT = new Uint8Array(N * N);

{
  let k = 0;
  for (let a = 0; a < N; a++) {
    for (let b = a; b < N; b++) {
      const v = parseInt(EQUITY_UPPER.substr(k * 2, 2), 36) / 1000;
      EQ[a * N + b] = v;
      EQ[b * N + a] = 1 - v;
      k++;
    }
  }
  for (let a = 0; a < N; a++) {
    for (let b = 0; b < N; b++) {
      let c = 0;
      for (const x of CLASS_COMBOS[a]) {
        for (const y of CLASS_COMBOS[b]) {
          if (x[0] !== y[0] && x[0] !== y[1] && x[1] !== y[0] && x[1] !== y[1]) c++;
        }
      }
      COMPAT[a * N + b] = c;
    }
  }
}

/** All-in equity of class a vs class b. */
export const classEquity = (a, b) => EQ[a * N + b];
/** Number of non-conflicting combo pairings of class a vs class b. */
export const compatCount = (a, b) => COMPAT[a * N + b];

/**
 * Equity of class `h` against a 169-weight range, plus the number of
 * (card-removal adjusted) combos in that range. Returns { equity, combos }.
 */
export function equityVsClassRange(h, range) {
  let w = 0;
  let e = 0;
  for (let b = 0; b < N; b++) {
    const rb = range[b];
    if (rb <= 0) continue;
    const c = COMPAT[h * N + b] * rb;
    w += c;
    e += c * EQ[h * N + b];
  }
  // COMPAT counts pairings against all combos of h, so normalize per combo of h
  const combosPerH = CLASSES[h].combos;
  return { equity: w > 0 ? e / w : 0.5, combos: w / combosPerH };
}

/** Equity of each class vs a uniformly random hand. */
export const EQUITY_VS_RANDOM = (() => {
  const all = new Float64Array(N).fill(1);
  return Array.from({ length: N }, (_, h) => equityVsClassRange(h, all).equity);
})();

/** Classes ordered by equity vs a random hand (best first). */
export const ORDER_BY_EQUITY = Array.from({ length: N }, (_, i) => i).sort((a, b) => EQUITY_VS_RANDOM[b] - EQUITY_VS_RANDOM[a]);

/** Fraction of combos in `range` (169 weights) that are compatible with holding class h. */
export function rangeCombosGiven(h, range) {
  return equityVsClassRange(h, range).combos;
}

export { CLASSES };
