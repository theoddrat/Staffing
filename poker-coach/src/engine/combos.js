// The 1326 concrete two-card combos and combo-weighted ranges.
// A "combo range" is a Float64Array(1326) of weights; it is what the range
// model narrows street by street and what equity sampling draws from.

import { classOfCards, CLASS_COMBOS, NUM_CLASSES } from './ranges.js';

export const NUM_COMBOS = 1326;
export const COMBO_C1 = new Int8Array(NUM_COMBOS);
export const COMBO_C2 = new Int8Array(NUM_COMBOS);
export const COMBO_CLASS = new Int16Array(NUM_COMBOS);
const COMBO_INDEX = new Int16Array(52 * 52).fill(-1);

{
  let k = 0;
  for (let a = 0; a < 52; a++) {
    for (let b = a + 1; b < 52; b++) {
      COMBO_C1[k] = a;
      COMBO_C2[k] = b;
      COMBO_CLASS[k] = classOfCards(a, b);
      COMBO_INDEX[a * 52 + b] = k;
      COMBO_INDEX[b * 52 + a] = k;
      k++;
    }
  }
}

export const comboIndex = (c1, c2) => COMBO_INDEX[c1 * 52 + c2];

/** Expand 169-class weights into a combo range, removing combos that use dead cards. */
export function comboRangeFromClasses(classWeights, dead = []) {
  const r = new Float64Array(NUM_COMBOS);
  for (let cls = 0; cls < NUM_CLASSES; cls++) {
    const w = classWeights[cls];
    if (w <= 0) continue;
    for (const [a, b] of CLASS_COMBOS[cls]) r[comboIndex(a, b)] = w;
  }
  if (dead.length) removeDead(r, dead);
  return r;
}

export function fullComboRange(dead = []) {
  const r = new Float64Array(NUM_COMBOS).fill(1);
  if (dead.length) removeDead(r, dead);
  return r;
}

export function removeDead(range, dead) {
  if (!dead.length) return range;
  const isDead = new Uint8Array(52);
  for (const c of dead) isDead[c] = 1;
  for (let k = 0; k < NUM_COMBOS; k++) {
    if (isDead[COMBO_C1[k]] || isDead[COMBO_C2[k]]) range[k] = 0;
  }
  return range;
}

export function totalWeight(range) {
  let t = 0;
  for (let k = 0; k < NUM_COMBOS; k++) t += range[k];
  return t;
}

/** Collapse a combo range to per-class average weights (for 13x13 display). */
export function comboRangeToClasses(range) {
  const sum = new Float64Array(NUM_CLASSES);
  const cnt = new Float64Array(NUM_CLASSES);
  for (let k = 0; k < NUM_COMBOS; k++) {
    sum[COMBO_CLASS[k]] += range[k];
    cnt[COMBO_CLASS[k]] += 1;
  }
  for (let i = 0; i < NUM_CLASSES; i++) sum[i] = cnt[i] ? sum[i] / cnt[i] : 0;
  return sum;
}

/** Build a sampler (cumulative weights) for fast weighted draws. */
export function makeSampler(range) {
  const cum = new Float64Array(NUM_COMBOS);
  let t = 0;
  for (let k = 0; k < NUM_COMBOS; k++) {
    t += range[k];
    cum[k] = t;
  }
  return { cum, total: t };
}

export function sampleCombo(sampler, rng) {
  const { cum, total } = sampler;
  if (total <= 0) return -1;
  const x = rng() * total;
  let lo = 0;
  let hi = NUM_COMBOS - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] > x) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}
