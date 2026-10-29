// Layer 2: market-implied India move (log space, no alpha) with the coefficients selected for the
// scenario horizon: the validated ensemble when the bundle has one, else today's 3y OLS betas.
import type { CoefSel } from './ensemble';
import type { FactorCore } from './factors';
import type { OriginCore } from './layer1';
import type { Prep, PrepIndia } from './prepare';
import type { ResolvedParams } from './types-extra';
import { clamp, log1pSafe } from './util';

export interface MarketCore {
  xP: number;
  parent: number; // b_P x_P
  sox: number; // b_SOX x_SOX
  ndx: number; // b_NDX x_NDX
  sentiment: number; // sox + ndx (+ trust contagion for India restatements)
  contagion: number; // part of `sentiment` from an India restatement (attributed to the restated firm)
  fx_fpi: number; // b_N x_N
  xN: number; // Nifty log move used (scenario-wide)
  own: number; // restatement target's own move
  logMove: number;
  /** The same scenario through the 3y OLS coefficients and the OLS Nifty model (the pre-V2 result). */
  logMoveOls: number;
  coef: CoefSel;
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
  const c = t.sel[rp.horizon];
  // one Nifty move per scenario (the validated link when the bundle has one), whichever stock coefficients apply
  const xN = f.xN;
  const parent = c.PARENT * xP;
  const sox = c.SOX * f.xSOX;
  const ndx = c.NDX * f.xNDX;
  const fx_fpi = c.NIFTY * xN;
  let own = 0;
  let contagion = 0;
  if (restMoveIndia !== null && rp.restTarget?.kind === 'india') {
    if (rp.restTarget.idx === t.idx) own = log1pSafe(restMoveIndia);
    else if (prep.india[rp.restTarget.idx].tier === t.tier) contagion = log1pSafe(clamp(rp.contagion * restMoveIndia, -0.99, 10));
  }
  const sentiment = sox + ndx + contagion;
  const logMove = parent + sentiment + fx_fpi + own;
  // original path: 3y OLS coefficients and OLS Nifty model (bit-identical to logMove for an OLS-only bundle)
  const logMoveOls = t.bP * xP + (t.bSOX * f.xSOX + t.bNDX * f.xNDX + contagion) + t.bN * f.xNOls + own;
  return { xP, parent, sox, ndx, sentiment, contagion, fx_fpi, xN, own, logMove, logMoveOls, coef: c, parentPath: path };
}
