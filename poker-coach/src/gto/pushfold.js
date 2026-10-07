// All-in (shove / call) equilibrium solver on the 169 preflop classes.
//
// Hero shoves into a pot; each player behind may call. We run fictitious play:
// callers best-respond to hero's averaged shoving range (calling when equity
// beats the price, with a small margin per player still to act behind them),
// hero best-responds to the callers' averaged calling ranges (single-caller
// approximation for multiway). With one caller this converges to the heads-up
// Nash push/fold equilibrium. Payoffs can be chip EV or ICM ($EV).

import { NUM_CLASSES, CLASSES } from '../engine/ranges.js';
import { classEquity, compatCount } from '../engine/preflop.js';
import { icmEquity } from '../engine/icm.js';

const N = NUM_CLASSES;

/**
 * @typedef {object} Caller
 * @property {number} invested   chips already in the pot from this player this hand (blind / open)
 * @property {number} stack      chips behind (not yet in the pot)
 * @property {Float64Array} [prior] the player's range before facing the shove (default: all hands)
 * @property {number} [behind]   players left to act after this caller (for overcall caution)
 * @property {number} [seat]     index into `icm.stacks` when using ICM
 */

/**
 * @param {object} spot
 * @param {number} spot.heroInvested chips hero already has in the pot
 * @param {number} spot.heroStack    hero chips behind
 * @param {number} spot.pot          total chips in the middle now (incl. antes and everyone's bets)
 * @param {Caller[]} spot.callers    players who can call, in acting order
 * @param {Float64Array} [spot.heroPrior] hero's range before shoving (e.g. 3-bet range when 4-bet jamming)
 * @param {{stacks:number[], payouts:number[], heroSeat:number}} [spot.icm] use ICM payoffs
 * @param {number} [iterations]
 */
export function solveShove(spot, iterations = 80) {
  const callers = spot.callers.map((c, i) => buildCallerModel(spot, c, i));
  const heroPrior = spot.heroPrior || new Float64Array(N).fill(1);

  // Fictitious play state
  const pushAvg = new Float64Array(N);
  for (let h = 0; h < N; h++) pushAvg[h] = heroPrior[h] > 0 ? 0.5 : 0;
  const callAvg = callers.map(() => new Float64Array(N).fill(0.3));
  const evPush = new Float64Array(N);

  for (let t = 1; t <= iterations; t++) {
    const rate = 1 / (t + 1);
    // callers best-respond to hero's averaged shoving range (weighted by prior)
    callers.forEach((c, i) => {
      for (let b = 0; b < N; b++) {
        if (c.prior[b] <= 0) { callAvg[i][b] = 0; continue; }
        let w = 0;
        let e = 0;
        for (let h = 0; h < N; h++) {
          const ph = pushAvg[h] * heroPrior[h];
          if (ph <= 0) continue;
          const cw = ph * compatCount(b, h);
          w += cw;
          e += cw * classEquity(b, h);
        }
        const eq = w > 0 ? e / w : 0;
        const br = w > 0 && eq >= c.requiredEquity ? 1 : 0;
        callAvg[i][b] += (br - callAvg[i][b]) * rate;
      }
    });
    // hero best-responds to callers' averaged calling ranges
    for (let h = 0; h < N; h++) {
      if (heroPrior[h] <= 0) { pushAvg[h] = 0; evPush[h] = -Infinity; continue; }
      evPush[h] = heroShoveEV(h, spot, callers, callAvg);
      const br = evPush[h] > 0 ? 1 : 0;
      pushAvg[h] += (br - pushAvg[h]) * rate;
    }
  }
  // final hero EVs vs converged calling ranges
  for (let h = 0; h < N; h++) if (heroPrior[h] > 0) evPush[h] = heroShoveEV(h, spot, callers, callAvg);

  return {
    shove: pushAvg,
    shoveEV: evPush, // in chips (or $ under ICM) relative to folding now
    callRanges: callAvg,
    callers: callers.map((c, i) => ({ requiredEquity: c.requiredEquity, range: callAvg[i] })),
    units: spot.icm ? '$' : 'chips',
  };
}

function buildCallerModel(spot, c, i) {
  const prior = c.prior || new Float64Array(N).fill(1);
  const behind = c.behind ?? spot.callers.length - 1 - i;
  // matched amount: caller can only win/lose up to the smaller of the two total stacks
  const heroTotal = spot.heroInvested + spot.heroStack;
  const callerTotal = c.invested + c.stack;
  const eff = Math.min(heroTotal, callerTotal);
  const callerAdds = Math.max(0, eff - c.invested);
  const heroAdds = Math.max(0, eff - spot.heroInvested);
  // pot if called heads-up: current pot + hero's additional shove (capped) + caller's call
  const finalPot = spot.pot + heroAdds + callerAdds;
  let requiredEquity = callerAdds / finalPot;
  let outcomes = null;
  if (spot.icm) {
    outcomes = icmOutcomes(spot, c, heroAdds, callerAdds, finalPot);
    const { callerFold, callerWin, callerLose } = outcomes;
    const denom = callerWin - callerLose;
    requiredEquity = denom > 0 ? (callerFold - callerLose) / denom : 1;
  }
  requiredEquity = Math.min(1, requiredEquity + 0.015 * behind);
  return { prior, behind, heroAdds, callerAdds, finalPot, requiredEquity, outcomes, seat: c.seat };
}

/** Hero EV of shoving class h vs callers' calling ranges (relative to folding now). */
function heroShoveEV(h, spot, callers, callAvg) {
  let pNoneYet = 1;
  let ev = 0;
  for (let i = 0; i < callers.length; i++) {
    const c = callers[i];
    // probability caller i calls given hero holds h (card removal via compat counts)
    let w = 0;
    let wc = 0;
    let e = 0;
    for (let b = 0; b < N; b++) {
      const pr = c.prior[b];
      if (pr <= 0) continue;
      const cc = compatCount(h, b) * pr;
      w += cc;
      const cw = cc * callAvg[i][b];
      wc += cw;
      e += cw * classEquity(h, b);
    }
    const pCall = w > 0 ? wc / w : 0;
    const eq = wc > 0 ? e / wc : 0.5;
    const pFirst = pNoneYet * pCall;
    if (pFirst > 0) {
      if (spot.icm) {
        const o = c.outcomes;
        ev += pFirst * (eq * o.heroWin + (1 - eq) * o.heroLose - o.heroFoldNow);
      } else {
        ev += pFirst * (eq * c.finalPot - c.heroAdds);
      }
    }
    pNoneYet *= 1 - pCall;
  }
  if (spot.icm) {
    const o = callers.length ? callers[0].outcomes : icmOutcomes(spot, null, 0, 0, spot.pot);
    ev += pNoneYet * (o.heroSteal - o.heroFoldNow);
  } else {
    ev += pNoneYet * spot.pot;
  }
  return ev;
}

/** ICM utilities for the shove outcomes against one caller. */
function icmOutcomes(spot, c, heroAdds, callerAdds, finalPot) {
  const { stacks, payouts, heroSeat } = spot.icm;
  // `stacks` are chips behind for every seat at this moment; chips in the pot are separate.
  const base = stacks.slice();
  const eqOf = (st, seat) => icmEquity(st, payouts)[seat];
  // hero folds now: pot goes to someone else (approximate: to the caller seat / first caller)
  const foldNow = base.slice();
  const potWinner = c ? c.seat : spot.callers[0]?.seat;
  if (potWinner !== undefined) foldNow[potWinner] += spot.pot;
  const heroFoldNow = eqOf(foldNow, heroSeat);
  // everybody folds to the shove: hero takes the pot
  const steal = base.slice();
  steal[heroSeat] += spot.pot;
  const heroSteal = eqOf(steal, heroSeat);
  if (!c) return { heroFoldNow, heroSteal };
  const seat = c.seat;
  // other posted chips (blinds/antes not belonging to hero or this caller) stay in the pot
  const win = base.slice();
  win[heroSeat] += finalPot - heroAdds;
  win[seat] -= callerAdds;
  const lose = base.slice();
  lose[heroSeat] -= heroAdds;
  lose[seat] += finalPot - callerAdds;
  const callerFoldSt = steal;
  const callerFold = eqOf(callerFoldSt, seat);
  const winSt = win.map((x) => Math.max(0, x));
  const loseSt = lose.map((x) => Math.max(0, x));
  return {
    heroFoldNow,
    heroSteal,
    heroWin: eqOf(winSt, heroSeat),
    heroLose: eqOf(loseSt, heroSeat),
    callerFold,
    callerWin: eqOf(loseSt, seat),
    callerLose: eqOf(winSt, seat),
  };
}

// ---------------------------------------------------------------------------
// Convenience: classic heads-up SB-vs-BB push/fold charts at S big blinds.

const huCache = new Map();

/**
 * Heads-up Nash push/fold at `stackBB` effective (both players), optional BB ante.
 * Returns { push: Float64Array(169), call: Float64Array(169) } frequencies.
 */
export function headsUpPushFold(stackBB, anteBB = 0) {
  const key = `${stackBB.toFixed(1)}|${anteBB}`;
  if (huCache.has(key)) return huCache.get(key);
  const sol = solveShove({
    heroInvested: 0.5,
    heroStack: stackBB - 0.5,
    pot: 1.5 + anteBB,
    callers: [{ invested: 1, stack: stackBB - 1 - anteBB, behind: 0 }],
  }, 200);
  const res = { push: sol.shove, call: sol.callRanges[0], ev: sol.shoveEV };
  huCache.set(key, res);
  return res;
}

export function rangeFraction(weights) {
  let c = 0;
  for (let i = 0; i < N; i++) c += weights[i] * CLASSES[i].combos;
  return c / 1326;
}
