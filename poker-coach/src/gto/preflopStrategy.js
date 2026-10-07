// Preflop policy: for a decision context, return per-class (169) frequencies
// of fold / call / raise plus the raise size. The same policy drives the GTO
// advisor, the AI opponents (with profile tendencies applied) and the range
// model (likelihood of the action a player actually took).

import { NUM_CLASSES, CLASSES, topRange } from '../engine/ranges.js';
import { equityVsClassRange } from '../engine/preflop.js';
import { RFI, VS_3BET, VS_4BET, COLD_VS_3BET, vsOpenChart, scaleRange, PLAYABILITY_RANK, PLAYABILITY_ORDER } from './charts.js';
import { solveShove } from './pushfold.js';
import { icmEquity } from '../engine/icm.js';

const N = NUM_CLASSES;
const zeros = () => new Float64Array(N);

export const DEFAULT_TENDENCIES = {
  openMult: 1, // width of raise-first-in ranges vs chart
  threeBetMult: 1, // width of 3-bet ranges
  callMult: 1, // width of flatting ranges
  limpFreq: 0, // share of non-premium opens that limp instead
  foldTo3BetMult: 1, // >1 folds more to 3-bets
  shoveMult: 1, // looseness of all-in decisions (shoves and calls)
};

const solverCache = new Map();

function cachedSolve(key, spot) {
  if (solverCache.has(key)) return solverCache.get(key);
  const sol = solveShove(spot, 60);
  if (solverCache.size > 400) solverCache.clear();
  solverCache.set(key, sol);
  return sol;
}

/**
 * @param {object} ctx  preflop context from HandModel.context()
 * @param {object} [tend] tendencies (DEFAULT_TENDENCIES = GTO baseline)
 * @returns {{fold:Float64Array, call:Float64Array, raise:Float64Array, jam:Float64Array, raiseTo:number, jamTo:number, mode:string, notes:string[], shoveEV?:Float64Array, callEquity?:Float64Array, required?:number}}
 *   Per-class frequencies; `call` means check when there is nothing to call.
 */
export function preflopPolicy(ctx, tend = DEFAULT_TENDENCIES) {
  const raw = { ...DEFAULT_TENDENCIES, ...tend };
  // Profiles express looseness as multipliers; flatting and 3-betting widen
  // faster than opening because their chart ranges start much narrower.
  const t = {
    ...raw,
    openMult: raw.openMult ** 1.3,
    callMult: raw.callMult ** 1.8,
    threeBetMult: raw.threeBetMult ** 1.4,
  };
  const effBB = ctx.effStack / ctx.bb;
  const allInTo = ctx.heroBet + ctx.heroStack;
  let res;
  if (ctx.facingAllIn || (ctx.toCall > 0 && ctx.toCall >= ctx.heroStack * 0.6)) {
    res = facingAllIn(ctx, t);
  } else if (ctx.raises === 0 && ctx.limpers === 0) {
    res = unopened(ctx, t, effBB);
  } else if (ctx.raises === 0) {
    res = vsLimpers(ctx, t, effBB);
  } else if (ctx.raises === 1) {
    res = vsOpen(ctx, t, effBB);
  } else if (ctx.raises === 2) {
    res = ctx.heroRaisedThisStreet ? vs3Bet(ctx, t, effBB) : cold3Bet(ctx, t);
  } else {
    res = vs4Bet(ctx, t);
  }
  // a "raise" that commits most of the stack is just a jam
  res.raiseTo = Math.min(Math.round(res.raiseTo), allInTo);
  if (res.raiseIsAllIn || res.raiseTo >= allInTo * 0.85) {
    for (let h = 0; h < N; h++) { res.jam[h] += res.raise[h]; res.raise[h] = 0; }
    res.raiseTo = allInTo;
    res.raiseIsAllIn = true;
  }
  res.jamTo = allInTo;
  if (!ctx.canRaise) {
    // can't raise (e.g. a short all-in didn't reopen the action): raising hands just call
    for (let h = 0; h < N; h++) {
      res.call[h] += res.raise[h] + res.jam[h];
      res.raise[h] = 0;
      res.jam[h] = 0;
    }
  }
  // normalize & clamp
  for (let h = 0; h < N; h++) {
    let r = Math.max(0, res.raise[h]);
    let j = Math.max(0, res.jam[h]);
    let c = Math.max(0, res.call[h]);
    const s = r + j + c;
    if (s > 1) { r /= s; j /= s; c /= s; }
    res.raise[h] = r;
    res.jam[h] = j;
    res.call[h] = c;
    res.fold[h] = Math.max(0, 1 - r - j - c);
  }
  return res;
}

function out(mode) {
  return { fold: zeros(), call: zeros(), raise: zeros(), jam: zeros(), raiseTo: 0, jamTo: 0, raiseIsAllIn: false, mode, notes: [] };
}

// ---------------------------------------------------------------------------

function shoveSpot(ctx, t, priors) {
  const callers = ctx.opponents
    .filter((o) => !o.allIn)
    .map((o, i, arr) => ({
      invested: o.bet,
      stack: o.stack,
      prior: priors?.[o.idx] || o.range169 || null,
      behind: arr.length - 1 - i,
      seat: o.idx,
    }));
  const spot = {
    heroInvested: ctx.heroBet,
    heroStack: ctx.heroStack,
    pot: ctx.pot,
    callers,
    icm: ctx.icm ? { stacks: ctx.icm.stacks, payouts: ctx.icm.payouts, heroSeat: ctx.idx } : undefined,
  };
  const key = [
    ctx.idx, Math.round(ctx.heroStack / ctx.bb * 2), Math.round(ctx.heroBet / ctx.bb * 2), Math.round(ctx.pot / ctx.bb * 2),
    callers.map((c) => `${c.seat}:${Math.round(c.stack / ctx.bb)}:${Math.round(c.invested / ctx.bb * 2)}:${c.prior ? priorKey(c.prior) : 'all'}`).join(','),
    ctx.icm ? `icm${ctx.icm.stacks.map((s) => Math.round(s / ctx.bb)).join('.')}|${ctx.icm.payouts.join('.')}` : 'chip',
  ].join('|');
  const sol = cachedSolve(key, spot);
  return sol;
}

function priorKey(p) {
  let h = 0;
  for (let i = 0; i < N; i++) h = (h * 31 + Math.round(p[i] * 20)) | 0;
  return h;
}

function applyShoveMult(shove, mult, ev) {
  if (Math.abs(mult - 1) < 1e-6) return shove;
  // loosen/tighten by shifting the EV threshold relative to its spread
  const outv = zeros();
  const evs = Array.from(ev).filter((x) => Number.isFinite(x));
  const spread = Math.max(1e-9, Math.max(...evs) - Math.min(...evs));
  const shift = (mult - 1) * 0.12 * spread;
  for (let h = 0; h < N; h++) outv[h] = Number.isFinite(ev[h]) && ev[h] + shift > 0 ? 1 : 0;
  return outv;
}

function unopened(ctx, t, effBB) {
  const pos = ctx.pos;
  // heads-up the button/SB opens most hands; otherwise use the positional chart
  const rfi = ctx.n === 2
    ? topRange(PLAYABILITY_ORDER, Math.min(1, 0.8 * t.openMult))
    : scaleRange(RFI[pos] || RFI.BTN, t.openMult);
  const pushFoldDepth = pos === 'SB' || pos === 'BTN' ? 14 : 12;
  if (effBB <= pushFoldDepth) {
    const res = out('push/fold');
    const sol = shoveSpot(ctx, t);
    const shove = applyShoveMult(sol.shove, t.shoveMult, sol.shoveEV);
    for (let h = 0; h < N; h++) res.jam[h] = shove[h];
    res.shoveEV = sol.shoveEV;
    res.solver = sol;
    res.notes.push(`${effBB.toFixed(1)}bb effective — push/fold territory. Nash-style ${ctx.icm ? 'ICM' : 'chip-EV'} shoving range computed for ${ctx.opponents.length} player(s) left to act.`);
    return res;
  }
  if (effBB <= 22) {
    const res = out('raise/jam');
    const sol = shoveSpot(ctx, t);
    res.shoveEV = sol.shoveEV;
    res.solver = sol;
    const shove = applyShoveMult(sol.shove, t.shoveMult, sol.shoveEV);
    for (let h = 0; h < N; h++) {
      const c = CLASSES[h];
      const premium = PLAYABILITY_RANK[h] < 14; // keep the strongest hands as raises to induce
      const jamHand = c.type === 'pair' ? c.hi <= 9 : c.hi === 12 ? true : PLAYABILITY_RANK[h] < 45;
      if (rfi[h] > 0 && premium) res.raise[h] = rfi[h];
      else if (shove[h] > 0.5 && jamHand) res.jam[h] = 1;
      else res.raise[h] = rfi[h];
    }
    res.raiseTo = pos === 'SB' ? 2.5 * ctx.bb : 2 * ctx.bb;
    res.notes.push(`${effBB.toFixed(1)}bb: raise small with the top of the range, jam medium pairs and suited/offsuit aces that hate facing a 3-bet shove.`);
    return res;
  }
  const res = out('open');
  for (let h = 0; h < N; h++) res.raise[h] = rfi[h];
  if (t.limpFreq > 0) {
    // limpers turn some opens into limps and also limp extra hands they'd never raise
    const limpWide = scaleRange(RFI[pos] || RFI.BTN, t.openMult * (1 + t.limpFreq * 1.6));
    for (let h = 0; h < N; h++) {
      if (PLAYABILITY_RANK[h] > 10) {
        res.call[h] = res.raise[h] * t.limpFreq;
        res.raise[h] *= 1 - t.limpFreq;
      }
      if (pos !== 'BB') res.call[h] += Math.max(0, limpWide[h] - rfi[h]);
    }
  }
  if (pos === 'SB') {
    res.raiseTo = 3 * ctx.bb;
    res.notes.push('Small blind vs big blind: raise to 3bb with a wide range (simplified raise-or-fold strategy).');
  } else {
    res.raiseTo = (pos === 'BTN' || pos === 'CO' ? 2.2 : 2.3) * ctx.bb;
    res.notes.push(`Raise-first-in from ${ctx.posDisplay || pos}: about ${(rangeShare(rfi) * 100).toFixed(0)}% of hands at ~${(res.raiseTo / ctx.bb).toFixed(1)}bb (BB-ante structures favour small opens).`);
  }
  return res;
}

function vsLimpers(ctx, t, effBB) {
  const res = out('vs limp');
  const pos = ctx.pos;
  const base = RFI[pos] || RFI.BTN;
  const iso = scaleRange(base, 0.55 * t.openMult);
  const over = scaleRange(base, 1.0 * t.callMult);
  if (pos === 'BB') {
    // option: raise strong hands, check the rest (check = "call" of 0)
    const raiseR = scaleRange(RFI.UTG, 0.9 * t.openMult);
    for (let h = 0; h < N; h++) { res.raise[h] = raiseR[h]; res.call[h] = 1 - raiseR[h]; }
    res.raiseTo = ctx.currentBet + (3 + ctx.limpers) * ctx.bb;
    res.notes.push('Big blind vs limp(s): raise for value with strong hands, check everything else.');
    return res;
  }
  if (effBB <= 15) {
    for (let h = 0; h < N; h++) res.jam[h] = iso[h];
    res.notes.push('Short stack vs limpers: isolate by moving all-in with a strong range.');
    return res;
  }
  for (let h = 0; h < N; h++) {
    res.raise[h] = iso[h];
    const c = CLASSES[h];
    const speculative = c.type === 'pair' || (c.type === 'suited' && (c.hi - c.lo <= 2 || c.hi === 12));
    res.call[h] = speculative && ctx.limpers >= 1 ? Math.max(0, over[h] - iso[h]) : 0;
  }
  res.raiseTo = (3 + ctx.limpers + (ctx.inPositionPreflop ? 0 : 1)) * ctx.bb;
  res.notes.push(`${ctx.limpers} limper(s): isolate to ${(res.raiseTo / ctx.bb).toFixed(0)}bb with a tightened range; over-limp small pairs and suited connectors.`);
  return res;
}

function vsOpen(ctx, t, effBB) {
  const chart = vsOpenChart(ctx.openerPos, ctx.pos);
  const squeeze = ctx.callersAfterRaise > 0;
  const openSize = ctx.lastRaiseTo;
  if (effBB <= 22) {
    // re-shove or fold (BB may flat a small open with part of its defending range)
    const res = out('reshove');
    const sol = shoveSpot(ctx, t);
    const shove = applyShoveMult(sol.shove, t.shoveMult, sol.shoveEV);
    res.shoveEV = sol.shoveEV;
    res.solver = sol;
    for (let h = 0; h < N; h++) res.jam[h] = shove[h];
    if (ctx.pos === 'BB' && openSize <= 2.5 * ctx.bb && effBB > 10) {
      const flat = scaleRange(chart.call, 0.75 * t.callMult);
      for (let h = 0; h < N; h++) res.call[h] = Math.max(0, Math.min(flat[h], 1 - res.raise[h]));
    }
    res.notes.push(`${effBB.toFixed(1)}bb effective facing an open: 3-bet shove (re-jam) or fold. ${ctx.icm ? 'ICM' : 'Chip-EV'} shove range uses the opener's estimated range.`);
    return res;
  }
  const res = out(squeeze ? 'squeeze' : 'vs open');
  const tb = scaleRange(chart.threeBet, (squeeze ? 0.7 : 1) * t.threeBetMult);
  const cl = scaleRange(chart.call, (squeeze ? 0.55 : 1) * t.callMult, undefined, tb);
  for (let h = 0; h < N; h++) {
    res.raise[h] = tb[h];
    res.call[h] = Math.min(cl[h], 1 - tb[h]);
  }
  const ip = ctx.inPositionPreflop;
  res.raiseTo = Math.round(openSize * (ip ? 3 : 3.6) + ctx.callersAfterRaise * openSize);
  if (res.raiseTo > (ctx.heroBet + ctx.heroStack) * 0.4) {
    res.raiseTo = ctx.heroBet + ctx.heroStack;
    res.raiseIsAllIn = true;
  }
  res.notes.push(
    `Facing ${ctx.openerDisplay || ctx.openerPos} open${squeeze ? ` plus ${ctx.callersAfterRaise} caller(s) — squeeze spot` : ''}: 3-bet ~${(rangeShare(tb) * 100).toFixed(1)}% (value + suited-ace bluffs), flat ~${(rangeShare(cl) * 100).toFixed(1)}%.`,
  );
  if (ctx.pos === 'BB') res.notes.push('The big blind gets a great price and closes the action, so it defends wide.');
  return res;
}

function vs3Bet(ctx, t, effBB) {
  const ip = ctx.inPositionPreflop;
  const chart = VS_3BET[ip ? 'IP' : 'OOP'];
  const res = out('vs 3-bet');
  const fourBet = scaleRange(chart.fourBet, t.threeBetMult);
  // Continue with a share of the hands we opened: wide late-position opens must defend more
  // in absolute terms than the static chart, or they become an auto-profit 3-bet target.
  const openWidth = rangeShare(RFI[ctx.pos] || RFI.BTN) * t.openMult;
  const target = ((ip ? 0.45 : 0.38) * openWidth) / t.foldTo3BetMult;
  const baseCall = rangeShare(chart.call);
  const callScale = Math.max(1, (target - rangeShare(fourBet)) / Math.max(0.005, baseCall));
  const call = scaleRange(chart.call, (callScale * Math.sqrt(t.callMult)) / t.foldTo3BetMult, undefined, fourBet);
  const fourTo = Math.round(ctx.lastRaiseTo * (ip ? 2.2 : 2.5));
  const allInTo = ctx.heroBet + ctx.heroStack;
  if (effBB <= 40 || fourTo > allInTo * 0.35) {
    // shallow: 4-bet jam or fold, with the jamming range widened by EV
    const sol = shoveSpot(ctx, t);
    res.shoveEV = sol.shoveEV;
    res.solver = sol;
    for (let h = 0; h < N; h++) {
      res.jam[h] = Math.max(fourBet[h], sol.shove[h] * (PLAYABILITY_RANK[h] < 30 ? 1 : 0));
      res.call[h] = effBB > 30 ? Math.min(call[h] * 0.5, 1 - res.jam[h]) : 0;
    }
    res.notes.push(`Facing a 3-bet with ${effBB.toFixed(0)}bb: 4-bet jam or fold mostly — flatting leaves too little behind.`);
    return res;
  }
  for (let h = 0; h < N; h++) { res.raise[h] = fourBet[h]; res.call[h] = Math.min(call[h], 1 - fourBet[h]); }
  res.raiseTo = fourTo;
  res.notes.push(`Facing a 3-bet ${ip ? 'in' : 'out of'} position: 4-bet KK+/AK (plus a few A5s bluffs), call strong pairs and suited broadways, fold the rest.`);
  return res;
}

function cold3Bet(ctx, t) {
  const res = out('cold vs 3-bet');
  const fb = scaleRange(COLD_VS_3BET.fourBet, t.threeBetMult);
  const cl = scaleRange(COLD_VS_3BET.call, t.callMult);
  for (let h = 0; h < N; h++) { res.raise[h] = fb[h]; res.call[h] = Math.min(cl[h], 1 - fb[h]); }
  res.raiseTo = Math.min(ctx.heroBet + ctx.heroStack, Math.round(ctx.lastRaiseTo * 2.3));
  res.notes.push('Open and 3-bet in front of you: continue only with premiums (cold 4-bet KK+/AK, occasionally flat QQ/JJ).');
  return res;
}

function vs4Bet(ctx, t) {
  const res = out('vs 4-bet+');
  const fb = scaleRange(VS_4BET.fiveBet, t.threeBetMult);
  for (let h = 0; h < N; h++) res.jam[h] = fb[h];
  res.notes.push('Facing a 4-bet or more: jam QQ+/AK, fold almost everything else.');
  return res;
}

/** Call/fold vs an all-in (or a bet that commits us): compare equity vs the shover's range to the price. */
function facingAllIn(ctx, t) {
  const res = out('vs all-in');
  const villain = ctx.opponents.find((o) => o.idx === ctx.lastRaiserIdx) || ctx.opponents[0];
  const vRange = villain?.range169 || new Float64Array(N).fill(1);
  const callAmt = Math.min(ctx.toCall, ctx.heroStack);
  const villainTotal = villain ? villain.bet + villain.stack : ctx.lastRaiseTo;
  const matched = Math.min(ctx.heroBet + ctx.heroStack, villainTotal);
  const heroAdds = Math.max(0, matched - ctx.heroBet);
  // pot if we call: current pot minus villain's unmatched excess plus our call
  const excess = Math.max(0, (villain ? villain.bet : ctx.currentBet) - matched);
  const finalPot = ctx.pot - excess + heroAdds;
  let required = heroAdds / finalPot;
  const behind = ctx.opponents.filter((o) => !o.acted && !o.allIn && o.idx !== villain?.idx).length;
  if (ctx.icm && villain) {
    const st = ctx.icm.stacks.slice();
    const win = st.slice();
    win[ctx.idx] += finalPot - heroAdds;
    win[villain.idx] += excess;
    const lose = st.slice();
    lose[ctx.idx] = Math.max(0, lose[ctx.idx] - heroAdds);
    lose[villain.idx] += finalPot + excess;
    const fold = st.slice();
    fold[villain.idx] += ctx.pot;
    const u = (s) => icmEquity(s, ctx.icm.payouts)[ctx.idx];
    const uw = u(win);
    const ul = u(lose);
    const uf = u(fold);
    required = uw > ul ? (uf - ul) / (uw - ul) : 1;
    res.icmRequired = required;
    res.chipRequired = heroAdds / finalPot;
  }
  required = Math.min(1, required + 0.015 * behind);
  const looseness = (t.shoveMult - 1) * 0.05;
  const eqv = new Float64Array(N);
  for (let h = 0; h < N; h++) {
    const e = equityVsClassRange(h, vRange).equity;
    eqv[h] = e;
    res.call[h] = e >= required - looseness ? 1 : 0;
  }
  res.callEquity = eqv;
  res.required = required;
  res.callAmount = callAmt;
  res.notes.push(`Facing ${villain ? 'an all-in' : 'a big bet'}: call needs ${(required * 100).toFixed(1)}% equity${ctx.icm ? ' (ICM-adjusted)' : ''} vs the shover's estimated range.`);
  if (ctx.canRaise && ctx.heroStack > callAmt) {
    // can re-jam over a non-all-in commit bet with the strongest hands
    for (let h = 0; h < N; h++) if (eqv[h] > Math.max(0.6, required + 0.15)) { res.jam[h] = 1; res.call[h] = 0; }
  }
  return res;
}

function rangeShare(r) {
  let c = 0;
  for (let i = 0; i < N; i++) c += r[i] * CLASSES[i].combos;
  return c / 1326;
}

export { rangeShare };
