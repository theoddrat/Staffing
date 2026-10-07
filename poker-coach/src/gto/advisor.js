// The GTO advisor: turns the preflop/postflop models into a recommended
// action mix with plain-English reasoning, and grades decisions after the fact.

import { classOfCards, CLASSES } from '../engine/ranges.js';
import { preflopPolicy, rangeShare } from './preflopStrategy.js';
import { postflopDecision, fmt } from './postflop.js';

const pct = (x) => `${Math.round(x * 100)}%`;

/**
 * @param {import('./handModel.js').HandModel} model
 * @param {number} idx seat to advise
 * @param {object} [opts] { tendencies, iterations, rng }
 */
export function getAdvice(model, idx, opts = {}) {
  const hand = model.hand;
  const p = hand.players[idx];
  const ctx = model.context(idx);
  const advice = hand.street === 'preflop' ? preflopAdvice(ctx, p, opts) : postflopAdvice(model, ctx, p, opts);
  // normalize, sort by frequency
  const total = advice.mix.reduce((t, a) => t + a.freq, 0) || 1;
  advice.mix.forEach((a) => (a.freq /= total));
  advice.best = advice.mix.reduce((b, a) => (a.freq > b.freq ? a : b), advice.mix[0]);
  advice.ctx = ctx;
  return advice;
}

function preflopAdvice(ctx, p, opts) {
  const pol = preflopPolicy(ctx, opts.tendencies);
  const h = classOfCards(p.hole[0], p.hole[1]);
  const label = CLASSES[h].label;
  const bb = ctx.bb;
  const mix = [];
  const passive = ctx.toCall > 0 ? 'call' : 'check';
  let foldF = pol.fold[h];
  let passiveF = pol.call[h];
  if (ctx.toCall === 0) { passiveF += foldF; foldF = 0; }
  if (foldF > 0 || ctx.toCall > 0) mix.push({ type: 'fold', to: 0, freq: foldF, label: 'Fold' });
  mix.push({
    type: passive, to: 0, freq: passiveF,
    label: passive === 'call' ? `Call ${fmt(ctx.toCall)}${ctx.toCall >= ctx.heroStack ? ' (all-in)' : ''}` : 'Check',
  });
  if (ctx.canRaise) {
    const raiseTo = Math.max(ctx.minRaiseTo, Math.min(ctx.maxRaiseTo, pol.raiseTo || ctx.minRaiseTo));
    const allInTo = ctx.maxRaiseTo;
    if (pol.raise[h] > 0 && raiseTo < allInTo) {
      mix.push({ type: 'raise', to: raiseTo, freq: pol.raise[h], label: `Raise to ${fmt(raiseTo)} (${(raiseTo / bb).toFixed(1)}bb)` });
    } else if (pol.raise[h] > 0) {
      pol.jam[h] += pol.raise[h];
    }
    if (pol.jam[h] > 0 || pol.mode.includes('push') || pol.mode.includes('jam') || pol.mode === 'reshove') {
      mix.push({ type: 'raise', to: allInTo, freq: pol.jam[h], allIn: true, label: `All-in (${fmt(allInTo)})` });
    }
  }
  const notes = [...pol.notes];
  const aggressive = pol.raise[h] + pol.jam[h];
  const aggVerb = pol.jam[h] > pol.raise[h] ? 'jam' : ctx.raises > 0 ? 're-raise' : 'raise';
  notes.push(`${label}: ${aggressive > 0.01 ? `${aggVerb} ${pct(aggressive)}` : 'never raise'}, ${passive} ${pct(passiveF)}${ctx.toCall > 0 ? `, fold ${pct(foldF)}` : ''} in this spot.`);
  if (pol.shoveEV && Number.isFinite(pol.shoveEV[h])) {
    const ev = pol.shoveEV[h];
    notes.push(ctx.icm
      ? `ICM shove EV for ${label}: ${ev >= 0 ? '+' : ''}${ev.toFixed(0)} prize-pool $ vs folding.`
      : `Shove EV for ${label}: ${ev >= 0 ? '+' : ''}${(ev / bb).toFixed(2)}bb vs folding.`);
  }
  if (pol.callEquity) {
    notes.push(`${label} has ${pct(pol.callEquity[h])} equity vs the estimated shoving range; you need ${(pol.required * 100).toFixed(1)}%.`);
  }
  const grid = { aggressive: new Float64Array(169), passive: pol.call, fold: pol.fold };
  for (let c = 0; c < 169; c++) grid.aggressive[c] = pol.raise[c] + pol.jam[c];
  return {
    street: 'preflop', mix, notes, classLabel: label, classIdx: h, mode: pol.mode, grid,
    info: {
      shoveEV: pol.shoveEV ? pol.shoveEV[h] : undefined,
      equity: pol.callEquity ? pol.callEquity[h] : undefined,
      required: pol.required,
      rangeWidth: { aggressive: rangeShare(grid.aggressive), passive: rangeShare(pol.call) },
      toCall: ctx.toCall, pot: ctx.pot, bb,
    },
  };
}

function postflopAdvice(model, ctx, p, opts) {
  const hand = model.hand;
  const oppIdx = hand.players.filter((q) => !q.folded && q.idx !== p.idx).map((q) => q.idx);
  const dec = postflopDecision({
    hole: p.hole, board: hand.board, street: hand.street, pot: ctx.pot, toCall: ctx.toCall,
    heroStack: p.stack, heroBet: p.bet, currentBet: hand.currentBet, bb: hand.bb,
    ownRange: model.ranges[p.idx], oppRanges: oppIdx.map((i) => model.ranges[i]),
    ip: ctx.ip, isPFA: ctx.isPFA, canRaise: ctx.canRaise, minRaiseTo: ctx.minRaiseTo, maxRaiseTo: ctx.maxRaiseTo,
    icm: ctx.icm ? { stacks: ctx.icm.stacks, payouts: ctx.icm.payouts, hero: p.idx } : null,
    villainIdx: ctx.villainIdx, villainAllIn: ctx.villainAllIn,
    iterations: opts.iterations, rng: opts.rng,
  });
  const mix = dec.actions.map((a) => {
    const m = { ...a };
    if (m.type === 'bet') {
      m.type = 'raise';
      m.isBet = true;
      m.to = Math.max(ctx.minRaiseTo || m.to, Math.min(ctx.maxRaiseTo || m.to, m.to));
    }
    if (m.type === 'raise' && m.to >= (ctx.maxRaiseTo || Infinity)) m.allIn = true;
    return m;
  });
  return { street: hand.street, mix, notes: dec.notes, info: { ...dec.info, toCall: ctx.toCall, pot: ctx.pot, bb: hand.bb }, parts: dec.parts };
}

/** Convert an advice mix entry into an engine action. */
export function toEngineAction(a) {
  if (a.type === 'raise') return a.allIn ? { type: 'allin' } : { type: 'raise', to: a.to };
  return { type: a.type };
}

/**
 * Grade a decision against the advice that was computed before it.
 * @param {object} advice from getAdvice
 * @param {{type:string,to?:number,allIn?:boolean}} taken engine log entry for the action
 */
export function gradeDecision(advice, taken) {
  const bb = advice.info.bb || 1;
  const t = taken.type === 'bet' ? 'raise' : taken.type;
  const sameKind = (a) => (a.type === 'bet' ? 'raise' : a.type) === t;
  const matches = advice.mix.filter(sameKind);
  let freq = matches.reduce((s, a) => s + a.freq, 0);
  let sizingNote = '';
  if (t === 'raise' && matches.length) {
    // prefer the closest size
    const closest = matches.reduce((b, a) => (Math.abs(a.to - taken.to) < Math.abs(b.to - taken.to) ? a : b));
    if (closest.to && taken.to && Math.abs(closest.to - taken.to) / closest.to > 0.6 && !(closest.allIn && taken.allIn)) {
      sizingNote = ` Sizing differs from the model's ${closest.label.toLowerCase()}.`;
    }
    if (matches.length > 1) freq = Math.max(freq * 0.9, closest.freq);
  }
  const best = advice.best;
  // EV estimates where the math is clean
  let evLoss = 0;
  const info = advice.info;
  if (info.toCall > 0 && info.equity !== undefined && (t === 'fold' || t === 'call')) {
    const req = info.required ?? info.toCall / (info.pot + info.toCall);
    const callEV = (info.equity - req) * (info.pot + info.toCall);
    if (t === 'fold' && callEV > 0) evLoss = callEV;
    if (t === 'call' && callEV < 0) evLoss = -callEV;
  }
  if (advice.street === 'preflop' && info.shoveEV !== undefined && Number.isFinite(info.shoveEV) && !advice.ctx?.icm) {
    if (t === 'fold' && info.shoveEV > 0) evLoss = Math.max(evLoss, info.shoveEV);
    if (t === 'raise' && taken.allIn && info.shoveEV < 0) evLoss = Math.max(evLoss, -info.shoveEV);
  }
  const evLossBB = evLoss / bb;
  let grade;
  if (freq >= 0.5 || best && sameKind(best)) grade = 'best';
  else if (freq >= 0.2) grade = 'good';
  else if (freq >= 0.06) grade = 'inaccuracy';
  else grade = evLossBB > 4 || freq < 0.02 ? 'blunder' : 'mistake';
  if (grade === 'mistake' && evLossBB > 6) grade = 'blunder';
  if ((grade === 'best' || grade === 'good') && evLossBB > 3) grade = 'inaccuracy';
  const verb = { fold: 'Folding', check: 'Checking', call: 'Calling', raise: taken.allIn ? 'Going all-in' : 'Raising/betting' }[t] || t;
  const msg = {
    best: `${verb} is the model's top play here (${pct(freq)}).`,
    good: `${verb} is part of a mixed strategy (${pct(freq)}). Best: ${best.label} (${pct(best.freq)}).`,
    inaccuracy: `${verb} is a low-frequency play (${pct(freq)}). Preferred: ${best.label} (${pct(best.freq)}).`,
    mistake: `${verb} is almost never right here (${pct(freq)}). Preferred: ${best.label} (${pct(best.freq)}).`,
    blunder: `${verb} is a significant error (${pct(freq)}). Preferred: ${best.label} (${pct(best.freq)}).`,
  }[grade];
  return {
    grade, freq, evLossBB,
    message: msg + (evLossBB > 0.05 ? ` Est. cost ≈ ${evLossBB.toFixed(1)}bb.` : '') + sizingNote,
  };
}

export const GRADE_SCORE = { best: 1, good: 0.85, inaccuracy: 0.55, mistake: 0.2, blunder: 0 };
