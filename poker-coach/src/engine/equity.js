// Equity calculations: hero hand vs one or more opponent ranges.
// Uses exact enumeration when it is cheap (heads-up on turn/river) and
// Monte Carlo sampling otherwise.

import { evaluate } from './evaluator.js';
import { NUM_COMBOS, COMBO_C1, COMBO_C2, makeSampler, sampleCombo } from './combos.js';
import { makeRng } from './rng.js';

const used = new Uint8Array(52);

function drawCard(rng) {
  let c;
  do c = (rng() * 52) | 0; while (used[c]);
  used[c] = 1;
  return c;
}

/**
 * Equity of `hero` (two cards) against opponents' combo ranges on `board`.
 * @returns {{equity:number, win:number, tie:number, samples:number}}
 */
export function equityVsRanges(hero, board, oppRanges, opts = {}) {
  const rng = opts.rng || makeRng(opts.seed);
  if (oppRanges.length === 1 && board.length >= 4) {
    return exactHeadsUp(hero, board, oppRanges[0]);
  }
  const iterations = opts.iterations ?? 2500;
  const samplers = oppRanges.map((r) => makeSampler(r));
  const nOpp = oppRanges.length;
  const oppCards = new Int8Array(nOpp * 2);
  const runout = new Int8Array(5);
  const heroHand = new Int8Array(7);
  const oppHand = new Int8Array(7);
  let wins = 0;
  let ties = 0;
  let share = 0;
  let samples = 0;

  for (let it = 0; it < iterations; it++) {
    used.fill(0);
    used[hero[0]] = 1;
    used[hero[1]] = 1;
    for (const c of board) used[c] = 1;

    let ok = true;
    for (let o = 0; o < nOpp && ok; o++) {
      let tries = 0;
      let k = -1;
      while (tries++ < 30) {
        const cand = sampleCombo(samplers[o], rng);
        if (cand < 0) break;
        if (!used[COMBO_C1[cand]] && !used[COMBO_C2[cand]]) { k = cand; break; }
      }
      if (k < 0) { ok = false; break; }
      oppCards[o * 2] = COMBO_C1[k];
      oppCards[o * 2 + 1] = COMBO_C2[k];
      used[COMBO_C1[k]] = 1;
      used[COMBO_C2[k]] = 1;
    }
    if (!ok) continue;

    for (let i = 0; i < board.length; i++) runout[i] = board[i];
    for (let i = board.length; i < 5; i++) runout[i] = drawCard(rng);

    heroHand[0] = hero[0];
    heroHand[1] = hero[1];
    for (let i = 0; i < 5; i++) { heroHand[i + 2] = runout[i]; oppHand[i + 2] = runout[i]; }
    const hs = evaluate(heroHand);
    let best = -1;
    let nBest = 0;
    for (let o = 0; o < nOpp; o++) {
      oppHand[0] = oppCards[o * 2];
      oppHand[1] = oppCards[o * 2 + 1];
      const s = evaluate(oppHand);
      if (s > best) { best = s; nBest = 1; }
      else if (s === best) nBest++;
    }
    samples++;
    if (hs > best) { wins++; share += 1; }
    else if (hs === best) { ties++; share += 1 / (nBest + 1); }
  }
  if (!samples) return { equity: 0.5, win: 0, tie: 0, samples: 0 };
  return { equity: share / samples, win: wins / samples, tie: ties / samples, samples };
}

/** Exact heads-up equity on the turn or river (enumerates combos and rivers). */
function exactHeadsUp(hero, board, range) {
  const dead = new Uint8Array(52);
  dead[hero[0]] = 1;
  dead[hero[1]] = 1;
  for (const c of board) dead[c] = 1;
  const rivers = [];
  if (board.length === 4) for (let c = 0; c < 52; c++) if (!dead[c]) rivers.push(c);
  const h = new Int8Array(7);
  const v = new Int8Array(7);
  h[0] = hero[0];
  h[1] = hero[1];
  for (let i = 0; i < board.length; i++) { h[i + 2] = board[i]; v[i + 2] = board[i]; }
  let totalW = 0;
  let winW = 0;
  let tieW = 0;
  for (let k = 0; k < NUM_COMBOS; k++) {
    const w = range[k];
    if (w <= 0) continue;
    const a = COMBO_C1[k];
    const b = COMBO_C2[k];
    if (dead[a] || dead[b]) continue;
    v[0] = a;
    v[1] = b;
    if (board.length === 5) {
      const hs = evaluate(h);
      const vs = evaluate(v);
      totalW += w;
      if (hs > vs) winW += w;
      else if (hs === vs) tieW += w;
    } else {
      let n = 0;
      let wn = 0;
      let tn = 0;
      for (const r of rivers) {
        if (r === a || r === b) continue;
        h[6] = r;
        v[6] = r;
        const hs = evaluate(h);
        const vs = evaluate(v);
        n++;
        if (hs > vs) wn++;
        else if (hs === vs) tn++;
      }
      totalW += w;
      winW += (w * wn) / n;
      tieW += (w * tn) / n;
    }
  }
  if (totalW <= 0) return { equity: 0.5, win: 0, tie: 0, samples: 0 };
  return { equity: (winW + tieW / 2) / totalW, win: winW / totalW, tie: tieW / totalW, samples: totalW };
}

/** Equity of hero vs a specific set of known hands (e.g. all-in showdown display). */
export function equityVsHands(hands, board, opts = {}) {
  const rng = opts.rng || makeRng(opts.seed);
  const iterations = opts.iterations ?? 4000;
  const n = hands.length;
  const share = new Float64Array(n);
  const tmp = new Int8Array(7);
  const scores = new Int32Array(n);
  const need = 5 - board.length;
  const iters = need === 0 ? 1 : iterations;
  for (let it = 0; it < iters; it++) {
    used.fill(0);
    for (const h of hands) { used[h[0]] = 1; used[h[1]] = 1; }
    for (const c of board) used[c] = 1;
    const runout = board.slice();
    for (let i = 0; i < need; i++) runout.push(drawCard(rng));
    let best = -1;
    let nBest = 0;
    for (let p = 0; p < n; p++) {
      tmp[0] = hands[p][0];
      tmp[1] = hands[p][1];
      for (let i = 0; i < 5; i++) tmp[i + 2] = runout[i];
      scores[p] = evaluate(tmp);
      if (scores[p] > best) { best = scores[p]; nBest = 1; }
      else if (scores[p] === best) nBest++;
    }
    for (let p = 0; p < n; p++) if (scores[p] === best) share[p] += 1 / nBest;
  }
  return Array.from(share, (s) => s / iters);
}
