// ICM helpers shared by the preflop and postflop all-in logic.

import { icmEquity } from '../engine/icm.js';

/**
 * Equity hero needs to call an all-in, under ICM.
 * @param {object} a
 * @param {number[]} a.stacks chips behind per hand seat (before hero calls)
 * @param {number[]} a.payouts remaining prizes (1st, 2nd, ...)
 * @param {number} a.hero hero seat index
 * @param {number} a.villain shover seat index
 * @param {number} a.pot chips in the middle now
 * @param {number} a.heroAdds chips hero adds to call
 * @param {number} a.excess villain's unmatched chips returned to them
 * @returns {{required:number, chipRequired:number}}
 */
export function icmCallRequirement({ stacks, payouts, hero, villain, pot, heroAdds, excess = 0 }) {
  const finalPot = pot - excess + heroAdds;
  const chipRequired = heroAdds / finalPot;
  const win = stacks.slice();
  win[hero] += finalPot - heroAdds;
  win[villain] += excess;
  const lose = stacks.slice();
  lose[hero] = Math.max(0, lose[hero] - heroAdds);
  lose[villain] += finalPot + excess;
  const fold = stacks.slice();
  fold[villain] += pot;
  const u = (s) => icmEquity(s, payouts)[hero];
  const uw = u(win);
  const ul = u(lose);
  const uf = u(fold);
  const required = uw > ul ? Math.min(1, Math.max(0, (uf - ul) / (uw - ul))) : 1;
  return { required, chipRequired, riskPremium: required - chipRequired };
}
