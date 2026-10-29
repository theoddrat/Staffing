// V2 Layer-2 coefficient selection (DESIGN §9.4): the walk-forward-validated ensemble when the
// bundle carries `models` + `backtest.nifty_horizons`, else the 3y OLS in `india[i].reg`.
// Horizon mapping (DESIGN §9.3, documented assumption): 1D → h1, 1M → h21, 12M → h21 applied to
// the 12-month factor move.
import type { Backtest, HorizonCoefs, IndiaTarget, StockModels } from '../types/data';
import type { Horizon } from '../types/engine';
import { isFiniteNum } from './util';

export const HORIZONS: Horizon[] = ['1D', '1M', '12M'];
export const ENSEMBLE_H: Record<Horizon, 1 | 21> = { '1D': 1, '1M': 21, '12M': 21 };
/** Ensemble horizons tried in order when the mapped one is missing (nearest first). */
const FALLBACK_H: Record<1 | 21, (1 | 5 | 21)[]> = { 1: [1], 21: [21, 5, 1] };

export interface CoefSet {
  SOX: number;
  NDX: number;
  PARENT: number;
  NIFTY: number;
}

/** Coefficients one stock uses at one scenario horizon. */
export interface CoefSel extends CoefSet {
  model: 'ensemble' | 'ols';
  h: 1 | 5 | 21 | null; // ensemble horizon used (null = 3y OLS)
  beta_total: number | null; // reduced-form response to a unit log SOX move
  r2_oos: number | null;
  n_oos: number;
  note: string | null; // why a fallback was taken
}

/** Nifty link x_N = SOX·x_SOX + NDX·x_NDX at one scenario horizon. */
export interface NiftySel {
  model: 'ensemble' | 'ols';
  h: 1 | 5 | 21 | null;
  SOX: number;
  NDX: number;
  r2: number | null;
  n: number;
}

function usable(hc: HorizonCoefs | undefined, needParent: boolean): hc is HorizonCoefs {
  return !!hc && isFiniteNum(hc.SOX) && isFiniteNum(hc.NDX) && isFiniteNum(hc.NIFTY) && (!needParent || isFiniteNum(hc.PARENT));
}

export function niftySelection(bt: Backtest | undefined, ols: NiftySel, hasModels: boolean): Record<Horizon, NiftySel> {
  const out = {} as Record<Horizon, NiftySel>;
  for (const H of HORIZONS) {
    let sel: NiftySel = ols;
    if (hasModels) {
      for (const h of FALLBACK_H[ENSEMBLE_H[H]]) {
        const row = bt?.nifty_horizons?.find((x) => x.h === h);
        if (row && isFiniteNum(row.SOX) && isFiniteNum(row.NDX)) {
          sel = { model: 'ensemble', h, SOX: row.SOX, NDX: row.NDX, r2: isFiniteNum(row.r2) ? row.r2 : null, n: isFiniteNum(row.n) ? row.n : 0 };
          break;
        }
      }
    }
    out[H] = sel;
  }
  return out;
}

/** DESIGN §3.3: beta_total = b_SOX + b_NDX·m_NDX|SOX + b_P·m_P|SOX + b_N·(c_SOX + c_NDX·m_NDX|SOX). */
function betaTotal(c: CoefSet, t: IndiaTarget, n: NiftySel): number | null {
  const sN = t.slopes?.ndx_on_sox;
  if (!isFiniteNum(sN)) return null;
  const sP = t.parent ? t.slopes?.parent_on_sox : 0;
  const bt = c.SOX + c.NDX * sN + c.PARENT * (isFiniteNum(sP) ? sP : 0) + c.NIFTY * (n.SOX + n.NDX * sN);
  return isFiniteNum(bt) ? bt : null;
}

/**
 * Per-horizon coefficient selection for one stock. `ols` is the 3y OLS set (zeros when the bundle
 * has no regression); `hasModels` is true when the bundle carries any validated ensemble.
 */
export function coefSelection(
  t: IndiaTarget,
  ols: CoefSet,
  model: StockModels | null,
  hasModels: boolean,
  nifty: Record<Horizon, NiftySel>,
): Record<Horizon, CoefSel> {
  const olsSel = (note: string | null): CoefSel => ({
    model: 'ols',
    h: null,
    ...ols,
    beta_total: isFiniteNum(t.beta_total) ? t.beta_total : null,
    r2_oos: null,
    n_oos: 0,
    note,
  });
  // the parent channel must not silently disappear: a parent with a non-zero OLS link needs an ensemble PARENT
  const needParent = !!t.parent && ols.PARENT !== 0;
  const out = {} as Record<Horizon, CoefSel>;
  for (const H of HORIZONS) {
    if (!model) {
      out[H] = olsSel(hasModels ? 'no validated ensemble for this stock: 3y OLS coefficients used (with the scenario-wide Nifty link)' : null);
      continue;
    }
    const want = ENSEMBLE_H[H];
    let sel: CoefSel | null = null;
    for (const h of FALLBACK_H[want]) {
      const hc = (model.horizons ?? []).find((x) => x.h === h);
      if (!usable(hc, needParent)) continue;
      const c: CoefSet = { SOX: hc.SOX, NDX: hc.NDX, PARENT: isFiniteNum(hc.PARENT) ? hc.PARENT : 0, NIFTY: hc.NIFTY };
      sel = {
        model: 'ensemble',
        h,
        ...c,
        beta_total: isFiniteNum(hc.beta_total) ? hc.beta_total : betaTotal(c, t, nifty[H]),
        r2_oos: isFiniteNum(hc.r2_oos) ? hc.r2_oos : null,
        n_oos: isFiniteNum(hc.n_oos) ? hc.n_oos : 0,
        note: h !== want ? `no ${want}-session ensemble fit: ${h}-session coefficients used for ${H}` : null,
      };
      break;
    }
    out[H] = sel ?? olsSel(`ensemble coefficients for ${H} unusable (missing ${needParent ? 'parent / ' : ''}factor loadings): 3y OLS used`);
  }
  return out;
}
