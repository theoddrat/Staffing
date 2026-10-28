// Layer 3 (fundamental damage) + Layer 4 (FX offset) for one India target.
import type { Status } from '../types/data';
import type { FactorCore } from './factors';
import type { Prep, PrepIndia } from './prepare';
import type { ResolvedQuantities } from './params';
import type { ResolvedParams } from './types-extra';
import { clamp } from './util';

export interface FundCore {
  modelled: boolean;
  ear: number;
  earContrib: { revenue: number; capex: number; credit: number; own: number };
  /** Exposure-level contributions (same order as the target's exposures) + assumption flags. */
  expContrib: number[];
  dUnwind: number;
  d: number; // total de-rating (unwind combined with own restatement de-rating)
  prem: number | null;
  premStatus: Status;
  premFallback: boolean;
  fxEps: number;
  fxCapped: boolean;
  gross: number | null;
  net: number | null;
}

const EAR_CAP = 0.95;
const FX_CAP = 0.5;

export function layer3(
  prep: Prep,
  t: PrepIndia,
  rq: ResolvedQuantities,
  rp: ResolvedParams,
  f: FactorCore,
): FundCore {
  const q = rq.india[t.idx];
  const v = rp.v;
  // AI premium (computed) or tier-median fallback (USER_ASSUMPTION)
  let prem = t.premRaw;
  let premFallback = false;
  let premStatus: Status = 'COMPUTED';
  if (prem === null) {
    const tm = prep.tierMedianPremium[t.tier];
    if (tm !== null) {
      prem = tm;
      premFallback = true;
      premStatus = 'USER_ASSUMPTION';
    } else premStatus = 'USER_ASSUMPTION';
  }

  if (rp.comp.replay) {
    return {
      modelled: false,
      ear: 0,
      earContrib: { revenue: 0, capex: 0, credit: 0, own: 0 },
      expContrib: t.exposures.map(() => 0),
      dUnwind: 0,
      d: 0,
      prem,
      premStatus,
      premFallback,
      fxEps: 0,
      fxCapped: false,
      gross: null,
      net: null,
    };
  }

  const expContrib: number[] = [];
  const earContrib = { revenue: 0, capex: 0, credit: 0, own: 0 };
  let sum = 0;
  t.exposures.forEach((e, k) => {
    let cut = 0;
    if (e.channel === 'revenue') cut = clamp(v.phi_it * f.rTech, 0, 1);
    else if (e.channel === 'capex') cut = clamp(v.psi_india_dc * f.cEffIndia, 0, 1);
    else if (e.channel === 'credit') cut = f.kCredit;
    const c = q.shares[k] * cut * q.ol;
    expContrib.push(c);
    earContrib[e.channel] += c;
    sum += c;
  });
  // cap the channel EaR, scaling contributions proportionally
  const earCh = Math.min(sum, EAR_CAP);
  if (sum > EAR_CAP && sum > 0) {
    const s = EAR_CAP / sum;
    earContrib.revenue *= s;
    earContrib.capex *= s;
    earContrib.credit *= s;
    for (let k = 0; k < expContrib.length; k++) expContrib[k] *= s;
  }
  let ear = earCh;
  let dOwn = 0;
  if (rp.comp.restatement && rp.restTarget?.kind === 'india' && rp.restTarget.idx === t.idx) {
    const r = clamp(v.r, 0, EAR_CAP);
    earContrib.own = r;
    ear = 1 - (1 - earCh) * (1 - r);
    dOwn = clamp(v.d, -2, 0.99);
  }

  // AI-premium unwind: d = 1 - (1+prem)^(-lambda_india)
  let dUnwind = 0;
  if (prem !== null && prem > -0.99) dUnwind = 1 - Math.pow(1 + prem, -(v.lambda_india ?? 0));
  if (rp.premiumFloorZero) dUnwind = Math.max(0, dUnwind);
  dUnwind = clamp(dUnwind, -2, 0.99);
  const d = 1 - (1 - dUnwind) * (1 - dOwn);

  // FX EPS effect: (sens_bps/1e4 * f*100) / ebit_margin
  let fxEps = 0;
  let fxCapped = false;
  if (q.fxSens !== 0 && f.f !== 0 && t.ebitMargin !== null && t.ebitMargin > 0.01) {
    fxEps = ((q.fxSens / 1e4) * f.f * 100) / t.ebitMargin;
    if (Math.abs(fxEps) > FX_CAP) {
      fxEps = Math.sign(fxEps) * FX_CAP;
      fxCapped = true;
    }
  }
  const gross = (1 - ear) * (1 - d) - 1;
  const net = (1 - ear) * (1 - d) * (1 + fxEps) - 1;
  return { modelled: true, ear, earContrib, expContrib, dUnwind, d, prem, premStatus, premFallback, fxEps, fxCapped, gross, net };
}
