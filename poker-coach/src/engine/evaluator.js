// Fast 5–7 card hold'em hand evaluator.
// Returns an integer score; higher is better. Layout: category << 20 followed by
// up to five 4-bit rank nibbles (kickers), so scores compare directly.

import { RANK_NAMES, RANK_PLURALS } from './cards.js';

export const CATEGORY = {
  HIGH_CARD: 0,
  PAIR: 1,
  TWO_PAIR: 2,
  TRIPS: 3,
  STRAIGHT: 4,
  FLUSH: 5,
  FULL_HOUSE: 6,
  QUADS: 7,
  STRAIGHT_FLUSH: 8,
};

export const CATEGORY_NAMES = [
  'High Card', 'Pair', 'Two Pair', 'Three of a Kind', 'Straight',
  'Flush', 'Full House', 'Four of a Kind', 'Straight Flush',
];

// STRAIGHT_HIGH[mask] = rank index of the straight's top card, or -1.
const STRAIGHT_HIGH = new Int8Array(8192);
const WHEEL = (1 << 12) | 0b1111;
for (let m = 0; m < 8192; m++) {
  let h = -1;
  for (let top = 12; top >= 4; top--) {
    if (((m >> (top - 4)) & 31) === 31) { h = top; break; }
  }
  if (h < 0 && (m & WHEEL) === WHEEL) h = 3;
  STRAIGHT_HIGH[m] = h;
}

const counts = new Int8Array(13);
const suitMasks = new Int32Array(4);
const suitCounts = new Int8Array(4);

function topRanks(mask, n, exclude1 = -1, exclude2 = -1) {
  let packed = 0;
  let got = 0;
  for (let r = 12; r >= 0 && got < n; r--) {
    if ((mask >> r) & 1 && r !== exclude1 && r !== exclude2) {
      packed = (packed << 4) | r;
      got++;
    }
  }
  // left-align into n nibbles so kickers compare consistently
  return packed << (4 * (n - got));
}

/**
 * Evaluate the best 5-card hand out of `cards` (array of card ints, 5..7 long).
 * Optional `extra` lets callers evaluate hole cards + board without concatenating.
 */
export function evaluate(cards, extra) {
  counts.fill(0);
  suitMasks.fill(0);
  suitCounts.fill(0);
  let rankMask = 0;
  const total = cards.length + (extra ? extra.length : 0);
  for (let i = 0; i < total; i++) {
    const c = i < cards.length ? cards[i] : extra[i - cards.length];
    const r = c >> 2;
    const s = c & 3;
    counts[r]++;
    suitMasks[s] |= 1 << r;
    suitCounts[s]++;
    rankMask |= 1 << r;
  }

  let flushSuit = -1;
  for (let s = 0; s < 4; s++) if (suitCounts[s] >= 5) flushSuit = s;
  if (flushSuit >= 0) {
    const sh = STRAIGHT_HIGH[suitMasks[flushSuit]];
    if (sh >= 0) return (CATEGORY.STRAIGHT_FLUSH << 20) | (sh << 16);
  }

  let quad = -1;
  let t1 = -1;
  let t2 = -1;
  let p1 = -1;
  let p2 = -1;
  let p3 = -1;
  for (let r = 12; r >= 0; r--) {
    const n = counts[r];
    if (n === 4) quad = r;
    else if (n === 3) { if (t1 < 0) t1 = r; else if (t2 < 0) t2 = r; }
    else if (n === 2) { if (p1 < 0) p1 = r; else if (p2 < 0) p2 = r; else if (p3 < 0) p3 = r; }
  }

  if (quad >= 0) {
    return (CATEGORY.QUADS << 20) | (quad << 16) | (topRanks(rankMask, 1, quad) << 12);
  }
  if (t1 >= 0 && (t2 >= 0 || p1 >= 0)) {
    const pair = Math.max(t2, p1);
    return (CATEGORY.FULL_HOUSE << 20) | (t1 << 16) | (pair << 12);
  }
  if (flushSuit >= 0) {
    return (CATEGORY.FLUSH << 20) | topRanks(suitMasks[flushSuit], 5);
  }
  const sh = STRAIGHT_HIGH[rankMask];
  if (sh >= 0) return (CATEGORY.STRAIGHT << 20) | (sh << 16);
  if (t1 >= 0) {
    return (CATEGORY.TRIPS << 20) | (t1 << 16) | (topRanks(rankMask, 2, t1) << 8);
  }
  if (p1 >= 0 && p2 >= 0) {
    return (CATEGORY.TWO_PAIR << 20) | (p1 << 16) | (p2 << 12) | (topRanks(rankMask, 1, p1, p2) << 8);
  }
  if (p1 >= 0) {
    return (CATEGORY.PAIR << 20) | (p1 << 16) | (topRanks(rankMask, 3, p1) << 4);
  }
  return (CATEGORY.HIGH_CARD << 20) | topRanks(rankMask, 5);
}

export const categoryOf = (score) => score >> 20;

/** Human-readable description of a score, e.g. "Full House, Kings full of Sevens". */
export function describeScore(score) {
  const cat = score >> 20;
  const n = (i) => (score >> (16 - 4 * i)) & 15;
  switch (cat) {
    case CATEGORY.STRAIGHT_FLUSH:
      return n(0) === 12 ? 'Royal Flush' : `Straight Flush, ${RANK_NAMES[n(0)]} high`;
    case CATEGORY.QUADS:
      return `Four of a Kind, ${RANK_PLURALS[n(0)]}`;
    case CATEGORY.FULL_HOUSE:
      return `Full House, ${RANK_PLURALS[n(0)]} full of ${RANK_PLURALS[n(1)]}`;
    case CATEGORY.FLUSH:
      return `Flush, ${RANK_NAMES[n(0)]} high`;
    case CATEGORY.STRAIGHT:
      return `Straight, ${RANK_NAMES[n(0)]} high`;
    case CATEGORY.TRIPS:
      return `Three of a Kind, ${RANK_PLURALS[n(0)]}`;
    case CATEGORY.TWO_PAIR:
      return `Two Pair, ${RANK_PLURALS[n(0)]} and ${RANK_PLURALS[n(1)]}`;
    case CATEGORY.PAIR:
      return `Pair of ${RANK_PLURALS[n(0)]}`;
    default:
      return `${RANK_NAMES[n(0)]} High`;
  }
}
