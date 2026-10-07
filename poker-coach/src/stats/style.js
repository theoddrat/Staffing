// "Learn my style": classify a player from their stats, find which pro they
// resemble, list leaks against a solid baseline, and turn stats into AI
// tendencies (so imported opponents — or you — can be cloned as bots).

import { BASELINE_STATS } from './stats.js';
import { BASELINE } from '../ai/profiles.js';

const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);

/** Shrink an observed rate toward the baseline target given its sample size. */
export function shrink(value, sample, target, k = 25) {
  if (value == null || !sample) return target;
  return (value * sample + target * k) / (sample + k);
}

export function classifyStyle(s) {
  if (!s || !s.hands || s.hands < 15) return { key: 'unknown', label: 'Not enough hands yet', blurb: 'Play at least 15 hands to get a first read on your style.' };
  const vpip = s.vpip ?? 0;
  const pfr = s.pfr ?? 0;
  const af = s.af ?? 1;
  const ratio = vpip > 0 ? pfr / vpip : 0;
  if (vpip > 0.42 && (af >= 3 || pfr > 0.3)) return { key: 'maniac', label: 'Maniac', blurb: 'Very loose and very aggressive. You win lots of small pots but bleed chips when called down.' };
  if (vpip > 0.3 && ratio < 0.5 && af < 1.6) return { key: 'station', label: 'Calling Station', blurb: 'Loose and passive: you see lots of flops and call too often instead of betting or folding.' };
  if (vpip > 0.28 && af < 2) return { key: 'loose-passive', label: 'Loose-Passive', blurb: 'You play many hands but let others drive the action.' };
  if (vpip < 0.14) return { key: 'nit', label: 'Nit', blurb: 'Very tight. Opponents can steal your blinds and fold to your rare aggression.' };
  if (vpip < 0.21 && af < 1.6) return { key: 'rock', label: 'Weak-Tight', blurb: 'Tight and passive — you wait for hands and rarely apply pressure.' };
  if (vpip > 0.28 && ratio >= 0.6) return { key: 'lag', label: 'LAG (Loose-Aggressive)', blurb: 'Wide and aggressive, like many modern pros. Powerful if your postflop discipline is good.' };
  if (ratio >= 0.65 && af >= 1.8) return { key: 'tag', label: 'TAG (Tight-Aggressive)', blurb: 'Solid fundamentals: selective preflop, aggressive when you play.' };
  return { key: 'balanced', label: 'Balanced / Developing', blurb: 'A mix of tendencies without one dominant pattern.' };
}

const VECTOR_KEYS = [
  ['vpip', 0.12], ['pfr', 0.1], ['threeBet', 0.05], ['af', 1.5], ['cbet', 0.15], ['foldToCbet', 0.15], ['wtsd', 0.06],
];

/**
 * Rank pro profiles by similarity to `stats`. `hudById` maps profile id →
 * derived stats (simulated HUD of each AI profile).
 */
export function playsLike(stats, profiles, hudById) {
  const out = [];
  for (const p of profiles) {
    const hud = hudById[p.id];
    if (!hud) continue;
    let d = 0;
    let w = 0;
    for (const [k, scale] of VECTOR_KEYS) {
      if (stats[k] == null || hud[k] == null) continue;
      d += ((stats[k] - hud[k]) / scale) ** 2;
      w++;
    }
    if (!w) continue;
    const dist = Math.sqrt(d / w);
    out.push({ profile: p, dist, similarity: Math.max(0, Math.round(100 * Math.exp(-dist * 0.8))) });
  }
  return out.sort((a, b) => a.dist - b.dist);
}

const MIN_SAMPLE = {
  vpip: 30, pfr: 30, threeBet: 20, foldTo3Bet: 8, limp: 30, steal: 15, foldToSteal: 10, bbDefense: 10,
  cbet: 10, foldToCbet: 10, turnCbet: 8, checkRaise: 12, af: 25, wtsd: 20, wsd: 10,
};

const LEAK_TEXT = {
  vpip: {
    high: ['Playing too many hands', 'Your VPIP is {v} vs a {t} target. Tighten up early-position opens and stop flatting offsuit hands.'],
    low: ['Playing too few hands', 'VPIP {v} vs {t}. You are leaving blind steals and profitable late-position opens on the table.'],
  },
  pfr: {
    low: ['Not raising enough preflop', 'PFR {v} vs {t}. When you enter a pot, raising wins it more often and gives you the initiative.'],
    high: ['Raising too often preflop', 'PFR {v} vs {t}. Some of your opens are too loose for their position.'],
  },
  threeBet: {
    low: ['3-betting too little', '3-bet {v} vs {t}. Add 3-bets with premiums AND some suited-ace/suited-broadway bluffs, especially vs late-position opens.'],
    high: ['3-betting too much', '3-bet {v} vs {t}. Good players will 4-bet you light or flat in position.'],
  },
  foldTo3Bet: {
    high: ['Over-folding to 3-bets', 'You fold {v} of the time when 3-bet (target ≈ {t}). Opponents can 3-bet you with any two cards. Defend more with pairs and suited broadways.'],
    low: ['Calling 3-bets too often', 'You fold only {v} to 3-bets (target ≈ {t}). Flatting out of position with weak hands is expensive.'],
  },
  limp: {
    high: ['Open-limping', 'You limp {v} of hands. In modern tournaments, raise or fold when you are first in (small-blind completes aside).'],
  },
  steal: {
    low: ['Not stealing enough', 'You open {v} from CO/BTN/SB when folded to (target ≈ {t}). Antes make blind steals hugely profitable.'],
    high: ['Stealing too wide', 'You open {v} from late position. Watch for re-steals.'],
  },
  foldToSteal: {
    high: ['Folding blinds too much', 'You fold {v} of your blinds vs steals (target ≈ {t}). With the BB ante you get a great price — defend wider.'],
    low: ['Defending blinds too loosely', 'You fold only {v} vs steals. Some defenses are too weak to play out of position.'],
  },
  bbDefense: {
    low: ['Big blind under-defense', 'You continue only {v} from the BB vs a single raise (target ≈ {t}). The BB closes the action at a discount — defend wide.'],
  },
  cbet: {
    high: ['Auto c-betting', 'You c-bet {v} of flops (target ≈ {t}). Check more on boards that favor the caller, especially out of position and multiway.'],
    low: ['Giving up too often on the flop', 'You c-bet only {v} (target ≈ {t}). On dry, high-card boards your range is ahead — bet small and often.'],
  },
  foldToCbet: {
    high: ['Over-folding to c-bets', 'You fold to {v} of c-bets (target ≈ {t}). Minimum defense frequency vs a half-pot bet is 67% — defend with pairs, draws and good overcards.'],
    low: ['Calling c-bets too light', 'You fold to only {v} of c-bets. Some of those floats have little equity.'],
  },
  turnCbet: {
    low: ['Not following through on the turn', 'You double-barrel only {v} (target ≈ {t}). Keep betting turn cards that improve your range or your draws.'],
    high: ['Over-barreling the turn', 'You double-barrel {v} of the time. Choose turn barrels that add equity or are scary for the caller.'],
  },
  checkRaise: {
    low: ['Rarely check-raising', 'Check-raise {v} (target ≈ {t}). A check-raising range (sets, two pair, strong draws) punishes auto c-bets.'],
  },
  af: {
    low: ['Too passive postflop', 'Aggression factor {v} vs {t}. Calling is the weakest action: bet and raise more of your strong hands and draws.'],
    high: ['Over-aggressive postflop', 'Aggression factor {v} vs {t}. Some bluffs are going into ranges that won\'t fold.'],
  },
  wtsd: {
    high: ['Going to showdown too often', 'WTSD {v} vs {t}. You are paying off value bets — fold more of your marginal hands on the river.'],
    low: ['Folding too much before showdown', 'WTSD {v} vs {t}. You may be getting bluffed off the best hand.'],
  },
  wsd: {
    low: ['Losing at showdown', 'You win only {v} at showdown (target ≈ {t}) — usually a sign of calling down too light.'],
  },
};

/** Leaks from stats compared with BASELINE_STATS. Returns sorted list of {key, title, detail, severity}. */
export function findStatLeaks(stats) {
  const leaks = [];
  for (const [key, [lo, t, hi]] of Object.entries(BASELINE_STATS)) {
    const v = stats[key];
    if (v == null) continue;
    const sample = key === 'vpip' || key === 'pfr' || key === 'limp' ? stats.hands : stats.samples?.[key] ?? stats.hands;
    if (sample < (MIN_SAMPLE[key] || 20)) continue;
    const text = LEAK_TEXT[key];
    if (!text) continue;
    let dir = null;
    if (v > hi && text.high) dir = 'high';
    else if (v < lo && text.low) dir = 'low';
    if (!dir) continue;
    const span = dir === 'high' ? Math.max(1e-6, hi - t) : Math.max(1e-6, t - lo);
    const over = dir === 'high' ? v - hi : lo - v;
    const severity = Math.min(3, 1 + over / span);
    const fmtv = (x) => (key === 'af' ? x.toFixed(1) : pct(x));
    const [title, detail] = text[dir];
    leaks.push({
      key, dir, title, severity, sample,
      detail: detail.replace('{v}', fmtv(v)).replace('{t}', fmtv(t)),
      value: v, target: t,
    });
  }
  return leaks.sort((a, b) => b.severity - a.severity);
}

/**
 * Leaks from graded decisions, grouped by spot. `decisions` are hero
 * decisions with {spot, grade, evLossBB}.
 */
export function findDecisionLeaks(decisions, minCount = 5) {
  const bySpot = new Map();
  for (const d of decisions) {
    if (!d.spot) continue;
    const s = bySpot.get(d.spot) || { spot: d.spot, n: 0, score: 0, evLoss: 0, mistakes: 0 };
    s.n++;
    s.score += { best: 1, good: 0.85, inaccuracy: 0.55, mistake: 0.2, blunder: 0 }[d.grade] ?? 0.5;
    s.evLoss += d.evLossBB || 0;
    if (d.grade === 'mistake' || d.grade === 'blunder') s.mistakes++;
    bySpot.set(d.spot, s);
  }
  return [...bySpot.values()]
    .map((s) => ({ ...s, accuracy: s.score / s.n }))
    .filter((s) => s.n >= minCount)
    .sort((a, b) => a.accuracy - b.accuracy || b.evLoss - a.evLoss);
}

/** Turn observed stats into AI tendencies (with shrinkage toward the baseline). */
export function statsToTendencies(s) {
  const B = BASELINE_STATS;
  const g = (key, k) => shrink(s[key], key === 'vpip' || key === 'pfr' || key === 'limp' ? s.hands : s.samples?.[key], B[key][1], k);
  const vpip = g('vpip', 30);
  const pfr = g('pfr', 30);
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const af = g('af', 25);
  const flat = Math.max(0.005, vpip - pfr);
  const baseFlat = B.vpip[1] - B.pfr[1];
  const foldToCbet = g('foldToCbet', 15);
  const wtsd = g('wtsd', 20);
  const stickiness = clamp(0.5 * ((1 - foldToCbet) / (1 - B.foldToCbet[1])) + 0.5 * (wtsd / B.wtsd[1]), 0.5, 2.2);
  return {
    ...BASELINE,
    openMult: clamp(pfr / B.pfr[1], 0.4, 2.4),
    callMult: clamp(flat / baseFlat, 0.3, 3),
    limpFreq: clamp(g('limp', 30) / Math.max(0.05, vpip), 0, 0.8),
    threeBetMult: clamp(g('threeBet', 20) / B.threeBet[1], 0.3, 3),
    foldTo3BetMult: clamp(g('foldTo3Bet', 10) / B.foldTo3Bet[1], 0.5, 1.8),
    aggression: clamp(af / B.af[1], 0.4, 2.2),
    bluff: clamp((af / B.af[1]) ** 0.8, 0.3, 2.2),
    stickiness,
    cbet: clamp(g('cbet', 12) / B.cbet[1], 0.4, 1.7),
    shoveMult: clamp(0.5 + 0.5 * (vpip / B.vpip[1]), 0.7, 1.5),
    adapt: 0.3,
  };
}

/** Plain-English ways to exploit a player, from their HUD stats. */
export function exploitTips(s) {
  const tips = [];
  if (!s || !s.hands || s.hands < 12) return ['Not enough hands yet: assume a solid baseline until a pattern shows up.'];
  const n = s.samples || {};
  if (s.vpip != null && s.vpip > 0.36) tips.push(`Plays ${Math.round(s.vpip * 100)}% of hands: value bet thinner and isolate their limps with a wide raising range.`);
  if (s.vpip != null && s.vpip < 0.14) tips.push(`Very tight (VPIP ${Math.round(s.vpip * 100)}%): steal their blinds relentlessly and give their raises credit.`);
  if (s.pfr != null && s.vpip != null && s.vpip - s.pfr > 0.15) tips.push('Calls far more than they raise: their preflop raises are strong, their calls are capped. Bet big when they just call.');
  if (s.foldTo3Bet != null && n.foldTo3Bet >= 5 && s.foldTo3Bet > 0.6) tips.push(`Folds to ${Math.round(s.foldTo3Bet * 100)}% of 3-bets: 3-bet them light, especially in position.`);
  if (s.threeBet != null && n.threeBet >= 12 && s.threeBet > 0.12) tips.push(`3-bets ${Math.round(s.threeBet * 100)}%: widen your 4-bet bluffs and flat strong hands in position.`);
  if (s.foldToCbet != null && n.foldToCbet >= 6 && s.foldToCbet > 0.55) tips.push(`Folds to ${Math.round(s.foldToCbet * 100)}% of c-bets: c-bet small and often when you were the raiser.`);
  if (s.foldToCbet != null && n.foldToCbet >= 6 && s.foldToCbet < 0.3) tips.push('Rarely folds to c-bets: c-bet your value and strong draws, check back air.');
  if (s.cbet != null && n.cbet >= 6 && s.cbet > 0.75) tips.push(`C-bets ${Math.round(s.cbet * 100)}%: float more in position and check-raise boards that hit your calling range.`);
  if (s.af != null && n.af >= 15 && s.af > 3.5) tips.push(`Hyper-aggressive (AF ${s.af.toFixed(1)}): call down lighter and let them bluff into your strong hands.`);
  if (s.af != null && n.af >= 15 && s.af < 1.4) tips.push(`Passive (AF ${s.af.toFixed(1)}): when they bet or raise, believe them. Fold marginal hands.`);
  if (s.wtsd != null && n.wtsd >= 10 && s.wtsd > 0.33) tips.push(`Goes to showdown ${Math.round(s.wtsd * 100)}%: stop bluffing them and size up your value bets.`);
  if (s.foldToSteal != null && n.foldToSteal >= 6 && s.foldToSteal > 0.65) tips.push('Over-folds their blinds: open wider from the cutoff and button when they are in the blinds.');
  if (!tips.length) tips.push('No big leaks visible: play your solid baseline and look for spots where they deviate.');
  return tips;
}
