// Postflop model: hand strength vs ranges, range narrowing likelihoods, and a
// "GTO-approximate" decision rule built from poker theory:
//   • bet the top of your range for value and balance with bluffs at the
//     bluff:value ratio the bet size implies (s / (1 + s) on the river),
//     preferring hands with equity (draws) as bluffs on earlier streets;
//   • facing a bet, continue when equity beats the pot odds (adjusted for
//     position/realization and implied odds) blended with Minimum Defense
//     Frequency so we can't be auto-profitably bluffed;
//   • raise the very top of the range plus strong draws as semi-bluffs.
// It is not a solver, but it plays and explains coherent, theory-backed poker.

import { evaluate } from '../engine/evaluator.js';
import { NUM_COMBOS, COMBO_C1, COMBO_C2, removeDead } from '../engine/combos.js';
import { equityVsRanges } from '../engine/equity.js';
import { drawFeatures, boardTexture, holdingLabel } from './features.js';
import { icmCallRequirement } from './icmTools.js';

const sigmoid = (x) => 1 / (1 + Math.exp(-x));
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

/** Normalize and sum several combo ranges (multiway "field" range). */
export function combineRanges(ranges) {
  const out = new Float64Array(NUM_COMBOS);
  for (const r of ranges) {
    let t = 0;
    for (let k = 0; k < NUM_COMBOS; k++) t += r[k];
    if (t <= 0) continue;
    for (let k = 0; k < NUM_COMBOS; k++) out[k] += r[k] / t;
  }
  return out;
}

/** Sorted score table of a range on a board, for fast "what share do I beat" lookups. */
export function scoreTable(range, board) {
  const dead = new Uint8Array(52);
  for (const c of board) dead[c] = 1;
  const items = [];
  const hole = [0, 0];
  for (let k = 0; k < NUM_COMBOS; k++) {
    const w = range[k];
    if (w <= 0) continue;
    const a = COMBO_C1[k];
    const b = COMBO_C2[k];
    if (dead[a] || dead[b]) continue;
    hole[0] = a;
    hole[1] = b;
    items.push([evaluate(hole, board), w]);
  }
  items.sort((x, y) => x[0] - y[0]);
  const scores = new Int32Array(items.length);
  const cum = new Float64Array(items.length);
  let t = 0;
  items.forEach(([s, w], i) => { scores[i] = s; t += w; cum[i] = t; });
  return { scores, cum, total: t };
}

/** Share of table weight beaten by `score` (ties count half). */
export function handStrength(score, table) {
  const { scores, cum, total } = table;
  if (total <= 0) return 0.5;
  // first index with scores[i] >= score, and first with scores[i] > score
  let lo = 0;
  let hi = scores.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (scores[m] < score) lo = m + 1; else hi = m; }
  const below = lo > 0 ? cum[lo - 1] : 0;
  let lo2 = lo;
  hi = scores.length;
  while (lo2 < hi) { const m = (lo2 + hi) >> 1; if (scores[m] <= score) lo2 = m + 1; else hi = m; }
  const upto = lo2 > 0 ? cum[lo2 - 1] : 0;
  return (below + (upto - below) / 2) / total;
}

const POT_WEIGHT = 0.9;

/**
 * Per-combo strength of `range` against `oppRange` on `board`.
 * ehs = hand strength now + share of remaining equity from draws.
 */
export function rangeStrength(range, oppRange, board, oppTable) {
  const table = oppTable || scoreTable(oppRange, board);
  const dead = new Uint8Array(52);
  for (const c of board) dead[c] = 1;
  const ehs = new Float32Array(NUM_COMBOS);
  const hs = new Float32Array(NUM_COMBOS);
  const pot = new Float32Array(NUM_COMBOS);
  const hole = [0, 0];
  let wSum = 0;
  let eSum = 0;
  let nut = 0;
  for (let k = 0; k < NUM_COMBOS; k++) {
    const w = range[k];
    if (w <= 0) continue;
    const a = COMBO_C1[k];
    const b = COMBO_C2[k];
    if (dead[a] || dead[b]) continue;
    hole[0] = a;
    hole[1] = b;
    const s = evaluate(hole, board);
    const h = handStrength(s, table);
    const f = board.length < 5 ? drawFeatures(a, b, board, s) : { potential: 0 };
    const e = h + (1 - h) * f.potential * POT_WEIGHT;
    hs[k] = h;
    pot[k] = f.potential;
    ehs[k] = e;
    wSum += w;
    eSum += w * e;
    if (e > 0.85) nut += w;
  }
  return { ehs, hs, pot, avg: wSum ? eSum / wSum : 0.5, nutShare: wSum ? nut / wSum : 0, total: wSum, table };
}

/**
 * Likelihood that a combo with strength `ehs` and draw `potential` takes `action`.
 * Used to narrow a player's perceived range after they act.
 * @param {number} aggression 1 = baseline; >1 bluffs/bets more (from HUD stats)
 */
export function actionLikelihood(ehs, potential, action, sizeFrac, street, aggression = 1) {
  const streetDraw = street === 'flop' ? 1 : street === 'turn' ? 0.75 : 0;
  const d = Math.min(1, potential * 2.2) * streetDraw;
  const air = sigmoid((0.35 - ehs) / 0.05);
  const middle = Math.exp(-(((ehs - 0.55) / 0.1) ** 2));
  const s = Math.min(Math.max(sizeFrac || 0.5, 0.2), 2);
  if (action === 'bet' || action === 'check') {
    const vt = 0.62 + 0.1 * Math.min(s, 1.5);
    const v = sigmoid((ehs - vt) / 0.05);
    const pBet = clamp(v + (1 - v) * (0.45 * d + 0.12 * air * aggression + 0.12 * middle), 0.02, 0.97);
    if (action === 'bet') return pBet;
    const v5 = sigmoid((ehs - 0.67) / 0.05);
    const pBetStd = clamp(v5 + (1 - v5) * (0.45 * d + 0.12 * air * aggression + 0.12 * middle), 0.02, 0.97);
    return clamp(1 - pBetStd + 0.18 * v5, 0.03, 0.98);
  }
  const req = s / (1 + 2 * s);
  const cont = sigmoid((ehs - (req + 0.08)) / 0.07);
  const pRaise = clamp(sigmoid((ehs - (0.8 + 0.04 * Math.min(s, 1))) / 0.04) * 0.75 + 0.25 * d + 0.04 * air * aggression, 0.01, 0.95);
  if (action === 'raise') return pRaise;
  if (action === 'call') return clamp(cont * (1 - pRaise * 0.8), 0.02, 0.98);
  return clamp(1 - cont, 0.02, 0.98); // fold
}

/** Narrow a combo range in place after an action. */
export function updateRangePostflop(range, oppRange, board, action, sizeFrac, street, aggression = 1) {
  const rs = rangeStrength(range, oppRange, board);
  removeDead(range, board);
  let total = 0;
  for (let k = 0; k < NUM_COMBOS; k++) {
    if (range[k] <= 0) continue;
    range[k] *= actionLikelihood(rs.ehs[k], rs.pot[k], action, sizeFrac, street, aggression);
    total += range[k];
  }
  // renormalize to keep weights in a sane numeric range
  if (total > 0) {
    let max = 0;
    for (let k = 0; k < NUM_COMBOS; k++) if (range[k] > max) max = range[k];
    if (max > 0) for (let k = 0; k < NUM_COMBOS; k++) range[k] /= max;
  }
  return range;
}

function chooseBetSize(street, tex, rangeAdv, nutAdv, ip, nOpp) {
  if (street === 'flop') {
    if (nOpp > 1) return { frac: 0.5, why: 'multiway pots call for a medium size and a tighter betting range' };
    if (tex.wetness < 0.35 && rangeAdv > 0.015) return { frac: 0.33, why: 'dry board where your range is ahead → small, frequent c-bets' };
    if (tex.wetness >= 0.55) return { frac: 0.75, why: 'wet board → bigger bets charge draws and protect equity' };
    return { frac: 0.5, why: 'medium texture → half-pot' };
  }
  if (street === 'turn') {
    if (nutAdv > 0.08) return { frac: 1.0, why: 'you hold more of the nuts → polarize with a big bet' };
    return { frac: 0.66, why: 'standard two-thirds pot on the turn' };
  }
  if (nutAdv > 0.1 && ip) return { frac: 1.25, why: 'big nut advantage on the river → overbet to maximize value and bluffs' };
  return { frac: 0.75, why: 'river: polarized three-quarter pot bet' };
}

/**
 * Decide a postflop action mix.
 * @param {object} inp
 * @returns {{actions:Array<{type:string,to:number,freq:number,label:string,kind?:string}>, parts:object, info:object, notes:string[]}}
 */
export function postflopDecision(inp) {
  const { hole, board, street, pot, toCall, heroStack, heroBet, currentBet, bb } = inp;
  const nOpp = inp.oppRanges.length;
  const dead = [...hole, ...board];
  const oppRanges = inp.oppRanges.map((r) => removeDead(r.slice(), dead));
  const field = combineRanges(oppRanges);
  let ownRange = removeDead(inp.ownRange.slice(), board);
  let ownTotal = 0;
  for (let k = 0; k < NUM_COMBOS; k++) ownTotal += ownRange[k];
  if (ownTotal <= 0) ownRange = removeDead(new Float64Array(NUM_COMBOS).fill(1), board);

  const tex = boardTexture(board);
  const oppTable = scoreTable(field, board);
  const own = rangeStrength(ownRange, field, board, oppTable);
  const opp = rangeStrength(field, ownRange, board);
  const heroScore = evaluate(hole, board);
  const heroFeat = drawFeatures(hole[0], hole[1], board, heroScore);
  const heroHS = handStrength(heroScore, oppTable);
  const heroEHS = heroHS + (1 - heroHS) * heroFeat.potential * POT_WEIGHT;

  // percentile of hero's hand inside its own (perceived) range
  let below = 0;
  let tot = 0;
  for (let k = 0; k < NUM_COMBOS; k++) {
    const w = ownRange[k];
    if (w <= 0) continue;
    tot += w;
    if (own.ehs[k] < heroEHS) below += w;
    else if (own.ehs[k] === heroEHS) below += w / 2;
  }
  const pct = tot ? below / tot : 0.5;

  const eqRes = equityVsRanges(hole, board, oppRanges, { iterations: inp.iterations ?? (nOpp > 1 ? 1200 : 1800), rng: inp.rng });
  const eq = eqRes.equity;
  const rangeAdv = own.avg - opp.avg;
  const nutAdv = own.nutShare - opp.nutShare;
  const spr = heroStack / Math.max(1, pot);
  const notes = [];
  const holding = holdingLabel(hole[0], hole[1], board);
  const info = {
    equity: eq, ehs: heroEHS, hs: heroHS, pct, rangeAdv, nutAdv, spr, texture: tex, holding,
    potential: heroFeat.potential, draws: heroFeat, street, nOpp,
  };
  notes.push(`You have ${holding} on a ${tex.label} board.`);
  notes.push(`Equity vs estimated range${nOpp > 1 ? 's' : ''}: ${(eq * 100).toFixed(0)}%. Your hand sits in the ${rangePosition(pct)} of the range you're representing.`);
  if (Math.abs(rangeAdv) > 0.03) notes.push(`${rangeAdv > 0 ? 'Your' : "Villain's"} range is stronger here (range advantage ${(Math.abs(rangeAdv) * 100).toFixed(0)} pts).`);

  const allInTo = heroBet + heroStack;
  const actions = [];

  if (toCall <= 0) {
    // --- not facing a bet: check or bet
    const size = chooseBetSize(street, tex, rangeAdv, nutAdv, inp.ip, nOpp);
    let f = 0.42 + clamp(rangeAdv * 2.5, -0.25, 0.25) + (inp.isPFA ? 0.12 : -0.12) + (inp.ip ? 0.06 : -0.04) - 0.12 * (nOpp - 1);
    if (size.frac <= 0.4) f += 0.12;
    if (size.frac >= 1) f -= 0.1;
    if (street === 'river') f -= 0.06;
    f = clamp(f, 0.06, 0.85);
    const s = size.frac;
    const baseRatio = s / (1 + s);
    const br = street === 'river' ? baseRatio : street === 'turn' ? baseRatio * 1.3 : baseRatio * 1.8;
    let valueFrac = f / (1 + br);
    // can't value bet more than the share of genuinely strong hands
    let strongShare = 0;
    for (let k = 0; k < NUM_COMBOS; k++) if (ownRange[k] > 0 && own.ehs[k] > 0.58) strongShare += ownRange[k];
    strongShare /= tot || 1;
    valueFrac = Math.min(valueFrac, strongShare);
    const bluffFrac = Math.min(valueFrac * br, 0.4);

    let pV = sigmoid((pct - (1 - valueFrac)) / 0.025);
    if (heroEHS < 0.5) pV *= 0.3;
    if (street === 'flop' && heroEHS > 0.93 && tex.wetness < 0.3) pV *= 0.75; // occasional slowplay on dry boards

    // bluff candidates: hands below the value region with little showdown value, best "bluff score" first
    const cand = [];
    const valueCut = 1 - valueFrac;
    for (let k = 0; k < NUM_COMBOS; k++) {
      const w = ownRange[k];
      if (w <= 0 || own.hs[k] >= 0.45) continue;
      cand.push([bluffScore(own.pot[k], own.hs[k], street), w]);
    }
    cand.sort((a, b) => b[0] - a[0]);
    let mass = 0;
    let threshold = Infinity;
    for (const [sc, w] of cand) {
      mass += w / (tot || 1);
      threshold = sc;
      if (mass >= bluffFrac) break;
    }
    const heroBluffScore = bluffScore(heroFeat.potential, heroHS, street);
    let pB = heroHS < 0.45 && pct < valueCut && bluffFrac > 0.005 ? sigmoid((heroBluffScore - threshold) / 0.02) : 0;
    if (cand.length === 0) pB = 0;

    let pBet = Math.max(pV, pB);
    let betTo = Math.max(bb, Math.round(s * pot));
    let jam = false;
    if (betTo >= allInTo * 0.7 || (spr <= 1.3 && pV > 0.5)) { betTo = allInTo; jam = true; }
    if (heroStack <= 0) pBet = 0;
    // thin value: good-but-not-polar hands on later streets can take a small size heads-up
    let pThin = 0;
    const thinTo = Math.min(allInTo, Math.max(bb, Math.round(0.33 * pot)));
    if (street !== 'flop' && nOpp === 1 && !jam && s > 0.4 && heroHS > 0.55 && heroStack > 0) {
      pThin = sigmoid((eq - 0.66) / 0.04) * 0.55 * (1 - pBet);
    }
    const label = jam ? `All-in (${fmt(allInTo)})` : `Bet ${Math.round(s * 100)}% pot (${fmt(betTo)})`;
    actions.push({ type: 'check', to: 0, freq: Math.max(0, 1 - pBet - pThin), label: 'Check' });
    actions.push({ type: 'bet', to: betTo, freq: pBet, label, sizeFrac: jam ? betTo / pot : s, kind: pV >= pB ? 'value' : 'bluff' });
    if (pThin > 0.01) actions.push({ type: 'bet', to: thinTo, freq: pThin, label: `Bet 33% pot (${fmt(thinTo)}) — thin value`, sizeFrac: 0.33, kind: 'thin' });
    info.betSize = size;
    info.valueFrac = valueFrac;
    info.bluffFrac = bluffFrac;
    info.rangeBetFreq = valueFrac + bluffFrac;
    notes.push(`Sizing: ${Math.round(s * 100)}% pot — ${size.why}.`);
    notes.push(`Theory: bet ~${Math.round((valueFrac + bluffFrac) * 100)}% of your range here — ~${Math.round(valueFrac * 100)}% value and ~${Math.round(bluffFrac * 100)}% bluffs (a ${Math.round(s * 100)}% pot bet supports ${(br).toFixed(2)} bluffs per value combo${street === 'river' ? '' : ', more on early streets because bluffs still have equity'}).`);
    if (pThin > 0.3 && pV <= 0.5) notes.push('Strong enough to want a call from worse, but not strong enough for the big polar size: a small "thin value" bet keeps weaker hands calling.');
    else if (pV > 0.5) notes.push('Your hand is in the value region: bet to get called by worse.');
    else if (pB > 0.5) notes.push(heroFeat.potential > 0.15 ? 'Good semi-bluff: weak showdown value but real equity when called.' : 'Bluff candidate: no showdown value, so betting is the only way to win.');
    else notes.push('Middle of your range: check to control the pot and keep bluff-catchers in your checking range.');
    return { actions, parts: { value: pV, bluff: pB, thin: pThin }, info, notes };
  }

  // --- facing a bet
  const callAmt = Math.min(toCall, heroStack);
  const facingAllIn = toCall >= heroStack || inp.villainAllIn;
  const potBeforeBet = Math.max(1, pot - toCall);
  const sFrac = toCall / potBeforeBet;
  let required = callAmt / (pot + callAmt);
  const mdf = potBeforeBet / (potBeforeBet + toCall);
  info.required = required;
  info.mdf = mdf;
  info.facingSize = sFrac;
  if (inp.icm && facingAllIn && inp.villainIdx !== undefined) {
    const r = icmCallRequirement({
      stacks: inp.icm.stacks, payouts: inp.icm.payouts, hero: inp.icm.hero, villain: inp.villainIdx,
      pot, heroAdds: callAmt, excess: Math.max(0, toCall - heroStack),
    });
    info.chipRequired = required;
    required = r.required;
    info.required = required;
    info.icmPremium = r.riskPremium;
    notes.push(`ICM: calling off risks your tournament life — you need ${(required * 100).toFixed(1)}% equity instead of the chip-EV ${(info.chipRequired * 100).toFixed(1)}%.`);
  }
  const realization = inp.ip || street === 'river' ? 1.0 : 1.08;
  const implied = street !== 'river' && !facingAllIn && (heroFeat.flushDraw || heroFeat.oesd) && spr > 2 ? 0.04 + (heroFeat.nutFlushDraw ? 0.03 : 0) : 0;
  const pEq = sigmoid((eq + implied - required * realization) / 0.03);
  const pMdf = sigmoid((pct - (1 - mdf)) / 0.03);
  let pCont = facingAllIn ? sigmoid((eq - required) / 0.02) : 0.7 * pEq + 0.3 * pMdf;
  notes.push(`Pot odds: call ${fmt(callAmt)} to win ${fmt(pot)} → need ${(required * 100).toFixed(1)}% equity${implied ? ` (draws get ~${Math.round(implied * 100)}% implied-odds credit)` : ''}.`);
  if (!facingAllIn) notes.push(`Minimum defense frequency vs a ${Math.round(sFrac * 100)}% pot bet: ${Math.round(mdf * 100)}% of your range must continue or villain profits with any two cards.`);

  let pRaise = 0;
  let raiseKind = 'value';
  let raiseTo = 0;
  const canRaise = inp.canRaise && !facingAllIn && heroStack > callAmt;
  if (canRaise) {
    const share = street === 'flop' ? 0.12 : street === 'turn' ? 0.08 : 0.05;
    const pRV = sigmoid((pct - (1 - share)) / 0.02) * (heroEHS > 0.75 ? 1 : 0.15);
    const drawGood = street !== 'river' && heroFeat.potential >= (street === 'flop' ? 0.3 : 0.17);
    const pRB = drawGood ? (street === 'flop' ? 0.35 : 0.2) : 0;
    pRaise = clamp(pRV + pRB * (1 - pRV), 0, 1);
    raiseKind = pRV >= pRB ? 'value' : 'semi-bluff';
    const mult = street === 'flop' ? 3 : 2.6;
    raiseTo = Math.round(Math.max(inp.minRaiseTo || 0, currentBet * mult));
    if (raiseTo >= allInTo * 0.45 || callAmt >= heroStack * 0.4) raiseTo = allInTo;
    raiseTo = Math.min(raiseTo, inp.maxRaiseTo || allInTo);
  }
  const pCall = Math.max(0, pCont - pRaise);
  const pFold = Math.max(0, 1 - Math.max(pCont, pRaise));
  actions.push({ type: 'fold', to: 0, freq: pFold, label: 'Fold' });
  actions.push({ type: 'call', to: 0, freq: pCall, label: `Call ${fmt(callAmt)}${callAmt >= heroStack ? ' (all-in)' : ''}` });
  if (canRaise) {
    actions.push({ type: 'raise', to: raiseTo, freq: pRaise, kind: raiseKind, label: raiseTo >= allInTo ? `All-in (${fmt(allInTo)})` : `Raise to ${fmt(raiseTo)}` });
  }
  if (pRaise > 0.4) notes.push(raiseKind === 'value' ? 'Top of your range: raise for value and to deny equity.' : 'Strong draw: a semi-bluff raise wins the pot now or builds it for when you hit.');
  else if (pCont > 0.6) notes.push('You have enough equity to continue — calling keeps villain\'s bluffs in.');
  else if (pCont < 0.35) notes.push('Not enough equity at this price, and folding this part of your range still leaves you defending enough overall.');
  else notes.push('Borderline: this hand sits near the bottom of your continuing range — mixing is fine.');
  return { actions, parts: { cont: pCont, raise: pRaise, call: pCall, fold: pFold, raiseKind }, info, notes };
}

/** "top 12%" / "bottom 20%" description of a percentile inside a range. */
export function rangePosition(pct) {
  return pct >= 0.5 ? `top ${Math.max(1, Math.round((1 - pct) * 100))}%` : `bottom ${Math.max(1, Math.round(pct * 100))}%`;
}

function bluffScore(potential, hs, street) {
  return potential + (street === 'river' ? (1 - hs) * 0.2 : (1 - hs) * 0.05);
}

export function fmt(n) {
  return Math.round(n).toLocaleString('en-US');
}
