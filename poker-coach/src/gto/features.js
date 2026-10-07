// Board texture and per-hand draw features used by the postflop model.

import { evaluate, categoryOf, CATEGORY } from '../engine/evaluator.js';
import { RANKS } from '../engine/cards.js';

/** Bitmask of ranks that complete a straight when added to `mask`, excluding ones `baseMask` already completes. */
function straightCompleters(mask) {
  let out = 0;
  for (let r = 0; r < 13; r++) {
    if (mask & (1 << r)) continue;
    if (hasStraight(mask | (1 << r))) out |= 1 << r;
  }
  return out;
}

function hasStraight(mask) {
  for (let top = 12; top >= 4; top--) if (((mask >> (top - 4)) & 31) === 31) return true;
  const wheel = (1 << 12) | 0b1111;
  return (mask & wheel) === wheel;
}

const popcount = (x) => {
  let c = 0;
  while (x) { x &= x - 1; c++; }
  return c;
};

/** Describe the board for explanations and sizing decisions. */
export function boardTexture(board) {
  if (board.length < 3) return null;
  const ranks = board.map((c) => c >> 2).sort((a, b) => b - a);
  const suits = [0, 0, 0, 0];
  for (const c of board) suits[c & 3]++;
  const maxSuit = Math.max(...suits);
  const rankCounts = {};
  for (const r of ranks) rankCounts[r] = (rankCounts[r] || 0) + 1;
  const paired = Object.values(rankCounts).some((n) => n >= 2);
  const trips = Object.values(rankCounts).some((n) => n >= 3);
  let mask = 0;
  for (const r of ranks) mask |= 1 << r;
  // connectedness: number of distinct straights possible using two hole cards
  let straightWindows = 0;
  for (let top = 12; top >= 3; top--) {
    const window = top === 3 ? ((1 << 12) | 0b1111) : (31 << (top - 4));
    if (popcount(mask & window) >= 3) straightWindows++;
  }
  const boardStraight = hasStraight(mask);
  const flushPossible = maxSuit >= 3;
  const flushDrawPossible = board.length < 5 && maxSuit === 2;
  const high = ranks[0];
  let wetness = 0;
  wetness += straightWindows * 0.12;
  wetness += maxSuit >= 3 ? 0.35 : maxSuit === 2 && board.length < 5 ? 0.2 : 0;
  wetness -= paired ? 0.1 : 0;
  wetness = Math.max(0, Math.min(1, wetness));
  const suitedness = maxSuit >= 3 ? (maxSuit === board.length ? 'monotone' : 'flush possible') : maxSuit === 2 ? 'two-tone' : 'rainbow';
  const label = [
    `${RANKS[high]}-high`,
    paired ? (trips ? 'trips on board' : 'paired') : null,
    suitedness,
    wetness > 0.55 ? 'very wet' : wetness > 0.3 ? 'dynamic' : 'dry',
  ].filter(Boolean).join(', ');
  return {
    high, paired, trips, maxSuit, flushPossible, flushDrawPossible, boardStraight,
    straightWindows, wetness, suitedness, label,
    highCardBroadway: high >= 8,
    lowBoard: high <= 7,
  };
}

/**
 * Draw/potential features of a specific two-card holding on a board.
 * Returns { outs, potential, flushDraw, nutFlushDraw, oesd, gutshot, backdoor, overcards, madeCategory }.
 */
export function drawFeatures(c1, c2, board, score) {
  const cardsLeft = 5 - board.length;
  const s = score ?? evaluate([c1, c2], board);
  const madeCategory = categoryOf(s);
  if (cardsLeft === 0) return { outs: 0, potential: 0, madeCategory, flushDraw: false, oesd: false, gutshot: false };

  // flush draws
  const suitCount = [0, 0, 0, 0];
  const boardSuit = [0, 0, 0, 0];
  for (const c of board) { suitCount[c & 3]++; boardSuit[c & 3]++; }
  suitCount[c1 & 3]++;
  suitCount[c2 & 3]++;
  let flushDraw = false;
  let nutFlushDraw = false;
  let backdoor = false;
  if (madeCategory < CATEGORY.FLUSH) {
    for (let st = 0; st < 4; st++) {
      const holeIn = ((c1 & 3) === st ? 1 : 0) + ((c2 & 3) === st ? 1 : 0);
      if (!holeIn) continue;
      if (suitCount[st] === 4) {
        flushDraw = true;
        // nut flush draw: we hold the highest missing card of the suit
        const ours = [c1, c2].filter((c) => (c & 3) === st).map((c) => c >> 2);
        const onBoard = board.filter((c) => (c & 3) === st).map((c) => c >> 2);
        let top = 12;
        while (onBoard.includes(top)) top--;
        nutFlushDraw = ours.includes(top);
      } else if (suitCount[st] === 3 && board.length === 3 && holeIn >= 1 && boardSuit[st] < 3) {
        backdoor = true;
      }
    }
  }

  // straight draws (must use a hole card)
  let fullMask = 0;
  let boardMask = 0;
  for (const c of board) { fullMask |= 1 << (c >> 2); boardMask |= 1 << (c >> 2); }
  fullMask |= 1 << (c1 >> 2);
  fullMask |= 1 << (c2 >> 2);
  let oesd = false;
  let gutshot = false;
  let straightOuts = 0;
  if (madeCategory < CATEGORY.STRAIGHT) {
    const comp = straightCompleters(fullMask) & ~straightCompleters(boardMask);
    const n = popcount(comp);
    if (n >= 2) { oesd = true; straightOuts = 8; }
    else if (n === 1) { gutshot = true; straightOuts = 4; }
  }

  // overcards to the board (unpaired high-card hands)
  const boardHigh = Math.max(...board.map((c) => c >> 2));
  let overcards = 0;
  if (madeCategory === CATEGORY.HIGH_CARD) {
    if ((c1 >> 2) > boardHigh) overcards++;
    if ((c2 >> 2) > boardHigh) overcards++;
  }

  let outs = 0;
  if (flushDraw) outs += 9;
  if (straightOuts) outs += flushDraw ? straightOuts - 2 : straightOuts;
  outs += overcards * 2.5;
  if (backdoor) outs += 1.5;
  // pairs improving to two pair/trips (weak pairs on wet boards improve a little)
  if (madeCategory === CATEGORY.PAIR) outs += 2;
  outs = Math.min(outs, 20);

  const unseen = 52 - 2 - board.length;
  const potential = cardsLeft === 2
    ? 1 - ((unseen - outs) / unseen) * ((unseen - 1 - outs) / (unseen - 1))
    : outs / unseen;

  return { outs, potential, madeCategory, flushDraw, nutFlushDraw, oesd, gutshot, backdoor, overcards };
}

/** Short label of what a holding "is" on this board, for explanations. */
export function holdingLabel(c1, c2, board) {
  const s = evaluate([c1, c2], board);
  const cat = categoryOf(s);
  const f = drawFeatures(c1, c2, board, s);
  const parts = [];
  const boardScore = board.length >= 5 ? evaluate(board) : -1;
  const r1 = c1 >> 2;
  const r2 = c2 >> 2;
  const inHole = (r) => r === r1 || r === r2;
  const holePair = r1 === r2;
  const bRanks = board.map((c) => c >> 2).sort((a, b) => b - a);
  const distinctBoard = [...new Set(bRanks)];
  const highCard = () => `${RANKS[Math.max(r1, r2)]}-high`;
  /** Describe a pair of rank `pr` that uses a hole card, relative to the board. */
  const pairLabel = (pr) => {
    if (holePair && pr > bRanks[0]) return 'an overpair';
    if (holePair) return pr < bRanks[bRanks.length - 1] ? 'an underpair' : 'a middle pocket pair';
    if (pr === distinctBoard[0]) return 'top pair';
    if (pr === distinctBoard[1]) return 'second pair';
    return 'a weak pair';
  };
  if (board.length >= 5 && s === boardScore) parts.push('playing the board');
  else if (cat === CATEGORY.PAIR) {
    const pr = (s >> 16) & 15;
    parts.push(inHole(pr) ? pairLabel(pr) : `${highCard()} (paired board)`);
  } else if (cat === CATEGORY.TWO_PAIR) {
    const p1 = (s >> 16) & 15;
    const p2 = (s >> 12) & 15;
    if (inHole(p1) && inHole(p2)) parts.push('two pair');
    else if (inHole(p1)) parts.push(`${pairLabel(p1)} (paired board)`);
    else if (inHole(p2)) parts.push(`${pairLabel(p2)} (paired board)`);
    else parts.push(`${highCard()} (board is two pair)`);
  } else if (cat === CATEGORY.TRIPS) {
    const tr = (s >> 16) & 15;
    if (holePair && r1 === tr) parts.push('a set');
    else if (inHole(tr)) parts.push('trips');
    else parts.push(`${highCard()} (trips on board)`);
  } else if (cat >= CATEGORY.STRAIGHT) {
    parts.push(['', '', '', '', 'a straight', 'a flush', 'a full house', 'quads', 'a straight flush'][cat]);
  } else parts.push(`no pair (${highCard()})`);
  if (f.nutFlushDraw) parts.push('nut flush draw');
  else if (f.flushDraw) parts.push('flush draw');
  if (f.oesd) parts.push('open-ended straight draw');
  else if (f.gutshot) parts.push('gutshot');
  if (f.backdoor && !f.flushDraw) parts.push('backdoor flush draw');
  return parts.join(' + ');
}
