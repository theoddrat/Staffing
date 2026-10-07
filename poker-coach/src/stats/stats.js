// HUD statistics from hand records: per-hand flags, aggregation per player,
// and derived percentages (VPIP, PFR, 3-bet, c-bet, AF, WTSD, ...).

const STEAL_POS = new Set(['CO', 'BTN', 'SB']);

export const COUNTERS = [
  'hands', 'vpip', 'pfr', 'threeBetOpp', 'threeBet', 'foldTo3BetOpp', 'foldTo3Bet', 'fourBetOpp', 'fourBet',
  'limp', 'stealOpp', 'steal', 'foldToStealOpp', 'foldToSteal', 'bbDefOpp', 'bbDef', 'allInPre',
  'sawFlop', 'cbetOpp', 'cbet', 'foldToCbetOpp', 'foldToCbet', 'raiseCbet', 'turnCbetOpp', 'turnCbet',
  'xrOpp', 'xr', 'postAgg', 'postCall', 'postFold', 'postCheck', 'wtsd', 'wsd', 'wwsf', 'netBB',
];

export function emptyAgg() {
  const a = {};
  for (const k of COUNTERS) a[k] = 0;
  a.byPos = {};
  return a;
}

/** Compute per-player stat flags for one hand record. */
export function handFlags(rec) {
  const n = rec.players.length;
  const f = rec.players.map(() => {
    const o = {};
    for (const k of COUNTERS) o[k] = 0;
    o.hands = 1;
    return o;
  });
  const folded = new Array(n).fill(false);
  const actedPre = new Array(n).fill(false);
  let raises = 0;
  let limpers = 0;
  let opener = -1;
  let lastRaiser = -1;
  let callersAfterOpen = 0;
  const facedThreeBet = new Array(n).fill(false);

  const acts = rec.actions;
  let k = 0;
  // ---- preflop
  for (; k < acts.length && acts[k].st === 0; k++) {
    const a = acts[k];
    const i = a.i;
    const p = f[i];
    const canon = rec.players[i].canon;
    const r = raises;
    if (!actedPre[i]) {
      if (r === 1) {
        p.threeBetOpp = 1;
        if (a.t === 'raise') p.threeBet = 1;
        const openerCanon = rec.players[opener]?.canon;
        if (STEAL_POS.has(openerCanon) && (canon === 'SB' || canon === 'BB') && callersAfterOpen === 0 && limpers === 0) {
          p.foldToStealOpp = 1;
          if (a.t === 'fold') p.foldToSteal = 1;
        }
        if (canon === 'BB') {
          p.bbDefOpp = 1;
          if (a.t !== 'fold') p.bbDef = 1;
        }
      }
      if (r === 0 && limpers === 0 && STEAL_POS.has(canon)) {
        p.stealOpp = 1;
        if (a.t === 'raise') p.steal = 1;
      }
      if (r === 0 && a.t === 'call' && canon !== 'BB') p.limp = 1;
    }
    if (r === 2 && i === opener && !facedThreeBet[i]) {
      facedThreeBet[i] = true;
      p.foldTo3BetOpp = 1;
      if (a.t === 'fold') p.foldTo3Bet = 1;
    }
    if (r === 2 && !p.fourBetOpp) {
      p.fourBetOpp = 1;
      if (a.t === 'raise') p.fourBet = 1;
    }
    if (a.t === 'call' || a.t === 'raise') p.vpip = 1;
    if (a.t === 'raise') p.pfr = 1;
    if (a.ai && a.t !== 'fold') p.allInPre = 1;
    if (a.t === 'raise') {
      raises++;
      if (raises === 1) opener = i;
      lastRaiser = i;
      callersAfterOpen = 0;
    } else if (a.t === 'call') {
      if (raises === 0) limpers++;
      else callersAfterOpen++;
    }
    if (a.t === 'fold') folded[i] = true;
    actedPre[i] = true;
  }

  // ---- postflop
  const boardLen = rec.board ? rec.board.split(' ').filter(Boolean).length : 0;
  const sawFlop = new Array(n).fill(false);
  if (boardLen >= 3) {
    for (let i = 0; i < n; i++) {
      if (!folded[i] && (actedPre[i] || rec.players[i].canon === 'BB' || rec.players[i].canon === 'SB')) {
        sawFlop[i] = true;
        f[i].sawFlop = 1;
      }
    }
  }
  const pfa = lastRaiser;
  let flopCbet = false;
  const streetState = () => ({ betMade: false, firstActed: new Set(), checked: new Set(), facedBet: new Set(), cbetPending: false });
  let cur = -1;
  let ss = null;
  for (; k < acts.length; k++) {
    const a = acts[k];
    if (a.st !== cur) { cur = a.st; ss = streetState(); }
    const i = a.i;
    const p = f[i];
    const first = !ss.firstActed.has(i);
    if (cur === 1) {
      if (i === pfa && first && !ss.betMade) {
        p.cbetOpp = 1;
        if (a.t === 'bet') { p.cbet = 1; flopCbet = true; ss.cbetPending = true; }
      } else if (ss.cbetPending && i !== pfa && !ss.facedBet.has(i)) {
        p.foldToCbetOpp = 1;
        if (a.t === 'fold') p.foldToCbet = 1;
        if (a.t === 'raise') p.raiseCbet = 1;
      }
      if (ss.checked.has(i) && ss.betMade && !ss.facedBet.has(i)) {
        p.xrOpp = 1;
        if (a.t === 'raise') p.xr = 1;
      }
    }
    if (cur === 2 && flopCbet && i === pfa && first && !ss.betMade) {
      p.turnCbetOpp = 1;
      if (a.t === 'bet') p.turnCbet = 1;
    }
    if (ss.betMade) ss.facedBet.add(i);
    if (a.t === 'bet' || a.t === 'raise') {
      p.postAgg++;
      if (ss.betMade && a.t === 'raise') ss.cbetPending = false;
      ss.betMade = true;
    } else if (a.t === 'call') p.postCall++;
    else if (a.t === 'fold') { p.postFold++; folded[i] = true; }
    else if (a.t === 'check') { p.postCheck++; ss.checked.add(i); }
    ss.firstActed.add(i);
  }

  for (let i = 0; i < n; i++) {
    const p = f[i];
    const won = rec.won?.[i] || 0;
    if (sawFlop[i]) {
      if (rec.showdown && !folded[i]) {
        p.wtsd = 1;
        if (won > 0) p.wsd = 1;
      }
      if (won > 0) p.wwsf = 1;
    }
    p.netBB = (rec.players[i].end - rec.players[i].start) / rec.bb;
  }
  return f;
}

/** Add one player's flags into an aggregate (mutates `agg`). */
export function addFlags(agg, flags, canon) {
  for (const k of COUNTERS) agg[k] += flags[k];
  if (canon) {
    const bp = (agg.byPos[canon] ||= { hands: 0, vpip: 0, pfr: 0, netBB: 0 });
    bp.hands++;
    bp.vpip += flags.vpip;
    bp.pfr += flags.pfr;
    bp.netBB += flags.netBB;
  }
  return agg;
}

export function mergeAgg(a, b) {
  const out = emptyAgg();
  for (const k of COUNTERS) out[k] = (a[k] || 0) + (b[k] || 0);
  for (const src of [a.byPos || {}, b.byPos || {}]) {
    for (const [pos, v] of Object.entries(src)) {
      const bp = (out.byPos[pos] ||= { hands: 0, vpip: 0, pfr: 0, netBB: 0 });
      bp.hands += v.hands; bp.vpip += v.vpip; bp.pfr += v.pfr; bp.netBB += v.netBB;
    }
  }
  return out;
}

const ratio = (num, den) => (den > 0 ? num / den : null);

/** Percentages and factors from an aggregate. Values are null when there is no sample. */
export function deriveStats(a) {
  return {
    hands: a.hands,
    vpip: ratio(a.vpip, a.hands),
    pfr: ratio(a.pfr, a.hands),
    threeBet: ratio(a.threeBet, a.threeBetOpp),
    foldTo3Bet: ratio(a.foldTo3Bet, a.foldTo3BetOpp),
    fourBet: ratio(a.fourBet, a.fourBetOpp),
    limp: ratio(a.limp, a.hands),
    steal: ratio(a.steal, a.stealOpp),
    foldToSteal: ratio(a.foldToSteal, a.foldToStealOpp),
    bbDefense: ratio(a.bbDef, a.bbDefOpp),
    cbet: ratio(a.cbet, a.cbetOpp),
    foldToCbet: ratio(a.foldToCbet, a.foldToCbetOpp),
    raiseCbet: ratio(a.raiseCbet, a.foldToCbetOpp),
    turnCbet: ratio(a.turnCbet, a.turnCbetOpp),
    checkRaise: ratio(a.xr, a.xrOpp),
    af: a.postCall > 0 ? a.postAgg / a.postCall : a.postAgg > 0 ? a.postAgg : null,
    afq: ratio(a.postAgg, a.postAgg + a.postCall + a.postFold),
    wtsd: ratio(a.wtsd, a.sawFlop),
    wsd: ratio(a.wsd, a.wtsd),
    wwsf: ratio(a.wwsf, a.sawFlop),
    bb100: a.hands ? (a.netBB / a.hands) * 100 : null,
    netBB: a.netBB,
    samples: {
      threeBet: a.threeBetOpp, foldTo3Bet: a.foldTo3BetOpp, cbet: a.cbetOpp, foldToCbet: a.foldToCbetOpp,
      steal: a.stealOpp, foldToSteal: a.foldToStealOpp, bbDefense: a.bbDefOpp, wtsd: a.sawFlop, wsd: a.wtsd,
      af: a.postAgg + a.postCall, checkRaise: a.xrOpp, turnCbet: a.turnCbetOpp,
    },
  };
}

/**
 * Baseline ranges for a solid tournament player (9-max, BB ante). Used to
 * spot leaks and to convert stats into AI tendencies. [low, target, high].
 */
export const BASELINE_STATS = {
  vpip: [0.14, 0.20, 0.28],
  pfr: [0.10, 0.15, 0.22],
  threeBet: [0.035, 0.065, 0.11],
  foldTo3Bet: [0.38, 0.52, 0.65],
  limp: [0, 0.01, 0.05],
  steal: [0.36, 0.48, 0.64],
  foldToSteal: [0.38, 0.52, 0.68],
  bbDefense: [0.32, 0.45, 0.62],
  cbet: [0.45, 0.60, 0.75],
  foldToCbet: [0.22, 0.35, 0.50],
  turnCbet: [0.40, 0.55, 0.75],
  checkRaise: [0.06, 0.12, 0.22],
  af: [1.7, 2.5, 4.0],
  wtsd: [0.21, 0.27, 0.33],
  wsd: [0.48, 0.54, 0.62],
};
