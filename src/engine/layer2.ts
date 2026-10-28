// Layer 2: market-implied India move from today's betas (log space, no alpha).
import type { FactorCore } from './factors';
import type { OriginCore } from './layer1';
import type { Prep, PrepIndia } from './prepare';
import type { ResolvedParams } from './types-extra';
import { clamp, log1pSafe } from './util';

export interface MarketCore {
  xP: number;
  parent: number; // b_P x_P
  sentiment: number; // b_SOX x_SOX + b_NDX x_NDX (+ trust contagion for India restatements)
  contagion: number; // part of `sentiment` from an India restatement (attributed to the restated firm)
  fx_fpi: number; // b_N x_N
  own: number; // restatement target's own move
  logMove: number;
  parentPath: 'origin' | 'parent_map' | 'slope' | 'none' | 'missing';
}

export function parentMove(prep: Prep, t: PrepIndia, rp: ResolvedParams, o: OriginCore[], f: FactorCore): { xP: number; path: MarketCore['parentPath'] } {
  if (!t.parent) return { xP: 0, path: 'none' };
  if (t.parentOriginIdx >= 0 && !rp.comp.replay) return { xP: log1pSafe(o[t.parentOriginIdx].move), path: 'origin' };
  if (t.parentMap) return { xP: t.parentMap.SOX * f.xSOX + t.parentMap.NDX * f.xNDX, path: 'parent_map' };
  if (t.parentSlope !== null) return { xP: t.parentSlope * f.xSOX, path: 'slope' };
  return { xP: 0, path: 'missing' };
}

export function layer2(
  prep: Prep,
  t: PrepIndia,
  rp: ResolvedParams,
  o: OriginCore[],
  f: FactorCore,
  restMoveIndia: number | null,
): MarketCore {
  const { xP, path } = parentMove(prep, t, rp, o, f);
  const parent = t.bP * xP;
  let sentiment = t.bSOX * f.xSOX + t.bNDX * f.xNDX;
  const fx_fpi = t.bN * f.xN;
  let own = 0;
  let contagion = 0;
  if (restMoveIndia !== null && rp.restTarget?.kind === 'india') {
    if (rp.restTarget.idx === t.idx) own = log1pSafe(restMoveIndia);
    else if (prep.india[rp.restTarget.idx].tier === t.tier) {
      contagion = log1pSafe(clamp(rp.contagion * restMoveIndia, -0.99, 10));
      sentiment += contagion;
    }
  }
  return { xP, parent, sentiment, contagion, fx_fpi, own, logMove: parent + sentiment + fx_fpi + own, parentPath: path };
}
