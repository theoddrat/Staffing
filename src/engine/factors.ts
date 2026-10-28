// From origin moves to factor moves (log space), Nifty, INR depreciation and channel cuts.
import type { OriginCore } from './layer1';
import type { Prep } from './prepare';
import type { ResolvedQuantities } from './params';
import type { ResolvedParams } from './types-extra';
import { clamp, combineCuts, expm1Safe, isFiniteNum } from './util';

export interface FactorCore {
  xChip: number;
  xAi: number;
  xSOX: number;
  xNDX: number;
  xN: number;
  f: number; // INR depreciation (+ = weaker INR), simple
  rTech: number; // mcap-weighted mean origin revenue hit
  cEffIndia: number; // capex-order cut feeding the India capex channel (before psi_india_dc)
  cEffParts: { capex: number; guidance: number; credit: number };
  kCredit: number; // credit-channel cut
  capexCutUsd: number | null;
  capexAbsorbed: number | null;
  basketModelled: boolean;
}

export function factors(
  prep: Prep,
  rq: ResolvedQuantities,
  rp: ResolvedParams,
  o: OriginCore[],
  warn: (m: string) => void,
): FactorCore {
  const v = rp.v;
  let xChip = 0;
  let xAi = 0;
  let xSOX = 0;
  let xNDX = 0;
  let basketModelled = true;
  if (rp.comp.replay) {
    basketModelled = false;
    const w = rp.windowId ? prep.windows.get(rp.windowId) : undefined;
    const sox = w?.moves?.SOX;
    const ndx = w?.moves?.NDX;
    if (!isFiniteNum(sox)) warn(`replay window ${rp.windowId}: SOX move missing (0 used)`);
    if (!isFiniteNum(ndx)) warn(`replay window ${rp.windowId}: NDX move missing (0 used)`);
    xSOX = isFiniteNum(sox) ? sox : 0;
    xNDX = isFiniteNum(ndx) ? ndx : 0;
  } else {
    let sc = 0;
    let sa = 0;
    let wcs = 0;
    let was = 0;
    prep.origins.forEach((po, j) => {
      const g = 1 + o[j].move;
      sc += po.wChip * g;
      sa += po.wAi * g;
      wcs += po.wChip;
      was += po.wAi;
    });
    xChip = wcs > 0 ? Math.log(Math.max(sc / wcs, 1e-9)) : 0;
    xAi = was > 0 ? Math.log(Math.max(sa / was, 1e-9)) : 0;
    xSOX = prep.betaSoxChip * xChip;
    xNDX = prep.betaNdxAi * xAi;
  }
  const xN = prep.cSOX * xSOX + prep.cNDX * xNDX;
  const f = rp.f_override !== null ? rp.f_override : Math.max(0, expm1Safe(prep.betaInr * xNDX));

  // revenue shock of US/global tech clients (mcap-weighted mean of origin revenue hits)
  let rTech = 0;
  prep.origins.forEach((po, j) => {
    rTech += po.wAi * o[j].rh;
  });

  // capex-order cut for India capex exposures
  const cCapex = rp.comp.capex ? clamp(v.c, 0, 1) : 0;
  let cGuid = 0;
  if (rp.comp.guidance && rp.guidanceTarget >= 0) cGuid = clamp(v.g * rq.s[rp.guidanceTarget], 0, 1);
  const cCredit = rp.comp.credit ? clamp(v.k * rq.sNeoAvg, 0, 1) : 0;
  const cEffIndia = combineCuts([cCapex, cGuid, cCredit]);
  const kCredit = rp.comp.credit ? clamp(v.k, 0, 1) : 0;

  let capexCutUsd: number | null = null;
  let capexAbsorbed: number | null = null;
  if (rp.comp.capex) {
    if (prep.capexTotalUsd !== null) {
      capexCutUsd = cCapex * prep.capexTotalUsd;
      let lost = 0;
      let known = false;
      const implausible: string[] = [];
      prep.origins.forEach((po, j) => {
        if (o[j].rhCapex > 0 && po.revUsd !== null) {
          const l = o[j].rhCapex * po.revUsd;
          // a single supplier cannot lose more revenue than the whole capex cut: flag as a units /
          // statement-currency problem in revenue_ttm and keep it out of the sanity ratio
          if (capexCutUsd !== null && capexCutUsd > 0 && l > capexCutUsd) {
            implausible.push(po.ticker);
            return;
          }
          lost += l;
          known = true;
        }
      });
      if (implausible.length)
        warn(`capex sanity: revenue_ttm of ${implausible.join(', ')} implies a revenue loss larger than the whole capex cut (statement-currency or units mismatch?); excluded from capex_absorbed_share`);
      capexAbsorbed = capexCutUsd > 0 && known ? lost / capexCutUsd : null;
    } else warn('hyperscaler capex (capex_ttm_usd) missing: capex_cut_usd unavailable');
  }

  return {
    xChip,
    xAi,
    xSOX,
    xNDX,
    xN,
    f,
    rTech,
    cEffIndia,
    cEffParts: { capex: cCapex, guidance: cGuid, credit: cCredit },
    kCredit,
    capexCutUsd,
    capexAbsorbed,
    basketModelled,
  };
}
