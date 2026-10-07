// Simplified, solver-inspired preflop charts for tournament play with a
// big-blind ante at roughly 30–100bb effective. They are approximations meant
// for training — real solver output mixes far more hands at fractional
// frequencies — but the shapes (tight early, wide late, polarized 3-bets with
// suited-ace bluffs, wide big-blind defense) match modern MTT strategy.

import { parseRange, rangePercent, topRange, NUM_CLASSES, CLASSES } from '../engine/ranges.js';
import { EQUITY_VS_RANDOM } from '../engine/preflop.js';

// Raise-first-in ranges, cumulative from early to late position.
const RFI_STEPS = [
  ['UTG', '44+, A7s+, A5s-A3s, K9s+, Q9s+, J9s+, T9s, 98s, AJo+, KQo'],
  ['UTG+1', '33, A6s, A2s, ATo, KJo, 87s'],
  ['UTG+2', 'K8s, T8s, QJo, KTo, 76s'],
  ['LJ', '22, K7s, Q8s, J8s, 97s, 65s, A9o, QTo, JTo'],
  ['HJ', 'K6s, K5s, Q7s, T7s, 86s, 54s, A8o, K9o'],
  ['CO', 'K4s-K2s, Q6s-Q4s, J7s, 96s, 75s, A7o-A5o, Q9o, J9o, T9o'],
  ['BTN', 'Q3s-Q2s, J6s-J3s, T6s-T4s, 95s, 85s, 74s, 64s, 63s, 53s, 43s, A4o-A2o, K8o-K5o, Q8o, J8o, T8o, 98o, 97o, 87o'],
];

export const RFI = {};
{
  let acc = '';
  for (const [pos, add] of RFI_STEPS) {
    acc = acc ? `${acc}, ${add}` : add;
    RFI[pos] = parseRange(acc);
  }
  // Small blind raise-or-fold strategy vs the big blind ≈ button width.
  RFI.SB = RFI.BTN;
}

export const POSITION_ORDER = ['UTG', 'UTG+1', 'UTG+2', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'];

/** Hands ordered by how early they enter an RFI chart, then by raw equity. */
export const PLAYABILITY_ORDER = (() => {
  const tier = new Array(NUM_CLASSES).fill(RFI_STEPS.length);
  RFI_STEPS.forEach(([pos], t) => {
    for (let i = 0; i < NUM_CLASSES; i++) if (RFI[pos][i] > 0 && tier[i] > t) tier[i] = t;
  });
  return Array.from({ length: NUM_CLASSES }, (_, i) => i).sort(
    (a, b) => tier[a] - tier[b] || EQUITY_VS_RANDOM[b] - EQUITY_VS_RANDOM[a],
  );
})();

export const PLAYABILITY_RANK = (() => {
  const r = new Array(NUM_CLASSES);
  PLAYABILITY_ORDER.forEach((cls, i) => (r[cls] = i));
  return r;
})();

/** Position group used by the facing-a-raise charts. */
export function positionGroup(pos) {
  if (pos === 'UTG' || pos === 'UTG+1' || pos === 'UTG+2') return 'EP';
  if (pos === 'LJ' || pos === 'HJ') return 'MP';
  if (pos === 'CO' || pos === 'BTN') return 'LP';
  return pos; // SB / BB
}

// Facing a single open raise: { threeBet, call } by opener group, then hero spot.
const VS_OPEN_SRC = {
  EP: {
    IP: { threeBet: 'QQ+, AKs, AKo, AQs:0.5, A5s:0.6, A4s:0.4, KQs:0.3', call: 'JJ-55, AQs-ATs, KQs, KJs, QJs, JTs, T9s, AQo' },
    SB: { threeBet: 'QQ+, AKs, AKo, A5s', call: 'JJ-TT, AQs' },
    BB: { threeBet: 'QQ+, AK, A5s', call: 'JJ-22, A2s-AQs, K6s+, Q8s+, J8s+, T7s+, 96s+, 86s+, 75s+, 64s+, 54s, 43s, A8o-AQo, KTo+, QTo+, JTo, T9o' },
  },
  MP: {
    IP: { threeBet: 'JJ+, AQs+, AKo, AJs:0.5, A5s-A4s, A3s:0.5, KQs:0.5, KJs:0.3', call: 'TT-44, A9s-AJs, KJs, KQs:0.5, QTs+, JTs, T9s, 98s, AQo' },
    SB: { threeBet: 'TT+, AJs+, AQo+, KQs, A5s-A4s', call: '99-77, ATs, KJs, QJs, JTs' },
    BB: { threeBet: 'JJ+, AQs+, AKo, A5s-A3s, K9s:0.3', call: 'TT-22, A2s-AJs, K2s-KQs, Q5s+, J6s+, T6s+, 95s+, 85s+, 74s+, 63s+, 53s+, 42s+, 32s, A5o-AQo, K9o+, Q9o+, J9o+, T8o+, 98o, 87o' },
  },
  LP: {
    IP: { threeBet: 'TT+, AJs+, AQo+, KQs, A5s-A2s, K9s:0.4, QJs:0.4', call: '99-22, A6s-ATs, KTs-KJs, QTs, QJs:0.6, JTs, T9s, 98s, 87s, 76s, AJo, KQo' },
    SB: { threeBet: '99+, ATs+, AJo+, KTs+, QJs, A5s-A2s, KQo', call: '88-55, JTs, T9s, 98s' },
    BB: { threeBet: 'TT+, AJs+, AQo+, KJs+, A5s-A2s, J9s:0.5, T8s:0.5, 76s:0.5', call: '99-22, A6s-ATs, K2s-KTs, Q2s+, J3s+, J9s:0.5, T4s+, T8s:0.5, 94s+, 84s+, 73s+, 76s:0.5, 62s+, 52s+, 42s+, 32s, A2o-AJo, K2o+, Q5o+, J7o+, T7o+, 96o+, 86o+, 75o+, 65o, 54o' },
  },
  SB: {
    BB: { threeBet: '88+, ATs+, A5s-A2s, KJs+, AJo+, KQo, 76s:0.5, 65s:0.5', call: '77-22, A6s-A9s, K2s-KTs, Q2s+, J4s+, T6s+, 96s+, 85s+, 74s+, 76s:0.5, 63s+, 65s:0.5, 53s+, 43s, A2o-ATo, K4o-KJo, Q7o+, J7o+, T7o+, 97o+, 86o+, 76o, 65o' },
  },
};

export const VS_OPEN = {};
for (const [opener, spots] of Object.entries(VS_OPEN_SRC)) {
  VS_OPEN[opener] = {};
  for (const [spot, r] of Object.entries(spots)) {
    VS_OPEN[opener][spot] = { threeBet: parseRange(r.threeBet), call: parseRange(r.call) };
  }
}

/** Chart for hero at `heroPos` facing an open from `openerPos`. */
export function vsOpenChart(openerPos, heroPos) {
  let og = positionGroup(openerPos);
  if (og === 'BB') og = 'LP';
  const spot = heroPos === 'SB' ? 'SB' : heroPos === 'BB' ? 'BB' : 'IP';
  const byOpener = VS_OPEN[og] || VS_OPEN.LP;
  return byOpener[spot] || byOpener.BB || VS_OPEN.LP.IP;
}

// Opener facing a 3-bet. In position (opener acts after 3-bettor post-flop) is rarer
// (only blinds 3-betting vs an IP opener means opener is IP); OOP when a later seat 3-bets.
export const VS_3BET = {
  IP: { fourBet: 'KK+, AKs, A5s:0.4, AKo:0.5', call: 'QQ-77, AQs-ATs, KQs, KJs, QJs, JTs, T9s, AKo:0.5, AQo' },
  OOP: { fourBet: 'KK+, AKs, A5s:0.4, AKo:0.5', call: 'QQ-99, AQs, AJs, KQs, JTs:0.5, AKo:0.5' },
};
for (const k of Object.keys(VS_3BET)) {
  VS_3BET[k] = { fourBet: parseRange(VS_3BET[k].fourBet), call: parseRange(VS_3BET[k].call) };
}

export const VS_4BET = { fiveBet: parseRange('QQ+, AKs, AKo'), call: parseRange('') };
export const COLD_VS_3BET = { fourBet: parseRange('KK+, AKs'), call: parseRange('QQ-JJ, AKo:0.5') };

/**
 * Widen or tighten a base range by `mult` using a hand ordering.
 * mult > 1 adds the best hands not yet included; mult < 1 removes the worst.
 */
export function scaleRange(base, mult, order = PLAYABILITY_ORDER, exclude = null) {
  if (Math.abs(mult - 1) < 1e-6) return base.slice();
  const out = base.slice();
  const baseCombos = rangePercent(base) * 1326;
  let target = Math.max(0, baseCombos * mult);
  if (mult > 1) {
    let need = Math.min(1326, target) - baseCombos;
    for (const cls of order) {
      if (need <= 0) break;
      if (exclude && exclude[cls] >= 0.99) continue;
      const room = (1 - out[cls]) * CLASSES[cls].combos;
      if (room <= 0) continue;
      const add = Math.min(room, need);
      out[cls] += add / CLASSES[cls].combos;
      need -= add;
    }
  } else {
    let cut = baseCombos - target;
    for (let i = order.length - 1; i >= 0 && cut > 0; i--) {
      const cls = order[i];
      const have = out[cls] * CLASSES[cls].combos;
      if (have <= 0) continue;
      const take = Math.min(have, cut);
      out[cls] -= take / CLASSES[cls].combos;
      cut -= take;
    }
  }
  return out;
}

export function rangeWidth(range) {
  return rangePercent(range);
}

export { topRange };
