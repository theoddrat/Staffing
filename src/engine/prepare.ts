// Static, per-bundle structures (built once per DataBundle object and cached).
import type { DataBundle, IndiaTarget, OriginInfo, Quantity, ReplayWindow, Security, Tier } from '../types/data';
import { isFiniteNum } from './util';

export interface PrepOrigin {
  idx: number;
  ticker: string;
  name: string;
  group: string;
  info: OriginInfo;
  sec: Security | undefined;
  currency: string;
  wChip: number; // normalised weight in the chip basket
  wAi: number; // normalised weight in the all-origin basket
  price0: number | null;
  pe0: number | null; // positive P/E or null
  eps0: number | null;
  pePre: number | null; // positive pre-ChatGPT median P/E or null
  mcapUsd: number | null;
  revUsd: number | null; // TTM revenue in USD
  capexUsd: number | null;
  stressed: boolean;
  netDebtUsd: number | null;
  qS: Quantity | null; // hyperscaler_share
  qNeo: Quantity | null; // neocloud_share
  qOL: Quantity | null; // op_leverage (from the security)
}

export interface PrepIndia {
  idx: number;
  ticker: string;
  display: string;
  name: string;
  tier: Tier;
  target: IndiaTarget;
  sec: Security | undefined;
  hasReg: boolean;
  bSOX: number;
  bNDX: number;
  bP: number;
  bN: number;
  r2: number | null;
  n: number;
  parent: string | null;
  parentOriginIdx: number; // -1 when the parent is not an origin
  parentMap: { SOX: number; NDX: number } | null;
  parentSlope: number | null; // x_P on x_SOX (target-level slope), replay / fallback path
  exposures: { channel: 'revenue' | 'capex' | 'credit'; q: Quantity }[];
  qOL: Quantity | null;
  qFx: Quantity | null;
  ebitMargin: number | null;
  premRaw: number | null; // security.ai_premium
  mcapInrCr: number | null;
  /** Combined residual e_i + b_N·e_N per resid date (NaN where missing). */
  resid: Float64Array;
  nonNull: Int32Array;
}

export interface Prep {
  bundle: DataBundle;
  usdInr: number;
  origins: PrepOrigin[];
  india: PrepIndia[];
  originIdx: Map<string, number>;
  indiaIdx: Map<string, number>;
  betaSoxChip: number;
  betaNdxAi: number;
  cSOX: number;
  cNDX: number;
  betaInr: number;
  capexTotalUsd: number | null;
  tierMedianPremium: Record<Tier, number | null>;
  residLen: number;
  niftyResid: Float64Array;
  niftyNonNull: Int32Array;
  windows: Map<string, ReplayWindow>;
  peerOrigins: Record<string, Record<string, number>>;
  staticWarnings: string[];
}

const cache = new WeakMap<DataBundle, Prep>();

function posOrNull(x: unknown): number | null {
  return isFiniteNum(x) && x > 0 ? x : null;
}

function toUsd(bundle: DataBundle, amount: number | null | undefined, currency: string | undefined): number | null {
  if (!isFiniteNum(amount)) return null;
  const ccy = (currency ?? 'USD').toUpperCase();
  if (ccy === 'USD') return amount;
  const rate = bundle.meta?.fx_rates_usd?.[ccy];
  if (isFiniteNum(rate) && rate > 0) return amount * rate;
  if (ccy === 'INR' && isFiniteNum(bundle.meta?.usd_inr) && bundle.meta.usd_inr > 0) return amount / bundle.meta.usd_inr;
  return null;
}

export function prepare(bundle: DataBundle): Prep {
  const hit = cache.get(bundle);
  if (hit) return hit;
  const warnings: string[] = [];
  const usdInr = isFiniteNum(bundle.meta?.usd_inr) && bundle.meta.usd_inr > 0 ? bundle.meta.usd_inr : NaN;
  if (!Number.isFinite(usdInr)) warnings.push('meta.usd_inr missing: INR conversions unavailable');
  const securities = bundle.securities ?? {};

  // ---- origins
  const rawOrigins = bundle.origins ?? [];
  const origins: PrepOrigin[] = rawOrigins.map((info, idx) => {
    const sec = securities[info.ticker];
    const price0 = posOrNull(sec?.last_close);
    const pe0 = posOrNull(sec?.pe_ttm);
    const eps0 = price0 !== null && pe0 !== null ? price0 / pe0 : isFiniteNum(sec?.eps_ttm) ? (sec!.eps_ttm as number) : null;
    const mcapUsd = posOrNull(sec?.mcap_usd);
    return {
      idx,
      ticker: info.ticker,
      name: sec?.name ?? info.ticker,
      group: info.group,
      info,
      sec,
      currency: sec?.currency ?? 'USD',
      wChip: 0,
      wAi: 0,
      price0,
      pe0,
      eps0,
      pePre: posOrNull(sec?.pe_pre_chatgpt_median),
      mcapUsd,
      revUsd: toUsd(bundle, sec?.revenue_ttm ?? null, sec?.currency),
      capexUsd: posOrNull(info.capex_ttm_usd),
      stressed: !!info.credit?.stressed,
      netDebtUsd: isFiniteNum(info.credit?.net_debt_usd) ? (info.credit.net_debt_usd as number) : null,
      qS: info.hyperscaler_share ?? null,
      qNeo: info.neocloud_share ?? null,
      qOL: sec?.op_leverage ?? null,
    };
  });
  // weights: prefer bundle weights; renormalise; fall back to mcap
  const normalise = (vals: number[]) => {
    const s = vals.reduce((a, b) => a + b, 0);
    return s > 0 ? vals.map((v) => v / s) : vals.map(() => 0);
  };
  const chipMask = origins.map((o) => o.info.in_chip_basket ?? o.group === 'chips');
  let wc = origins.map((o, i) => (chipMask[i] ? Math.max(0, o.info.weight_chip_basket ?? 0) : 0));
  if (wc.reduce((a, b) => a + b, 0) <= 0) wc = origins.map((o, i) => (chipMask[i] ? o.mcapUsd ?? 0 : 0));
  wc = normalise(wc);
  const aiMask = origins.map((o) => o.info.in_ai_basket ?? true);
  let wa = origins.map((o, i) => (aiMask[i] ? Math.max(0, o.info.weight_ai_basket ?? 0) : 0));
  if (wa.reduce((a, b) => a + b, 0) <= 0) wa = origins.map((o, i) => (aiMask[i] ? o.mcapUsd ?? 0 : 0));
  wa = normalise(wa);
  origins.forEach((o, i) => {
    o.wChip = wc[i];
    o.wAi = wa[i];
  });
  if (origins.length === 0) warnings.push('bundle has no shock origins');
  const originIdx = new Map(origins.map((o) => [o.ticker, o.idx] as [string, number]));

  // ---- factor maps
  const fm = bundle.factor_map;
  let betaSoxChip = fm?.sox_on_chip_basket?.beta;
  if (!isFiniteNum(betaSoxChip)) {
    warnings.push('factor_map.sox_on_chip_basket missing: using identity (beta 1)');
    betaSoxChip = 1;
  }
  let betaNdxAi = fm?.ndx_on_ai_basket?.beta;
  if (!isFiniteNum(betaNdxAi)) {
    warnings.push('factor_map.ndx_on_ai_basket missing: using identity (beta 1)');
    betaNdxAi = 1;
  }
  const nc = bundle.nifty_model?.coef ?? {};
  const cSOX = isFiniteNum(nc.SOX?.b) ? nc.SOX.b : 0;
  const cNDX = isFiniteNum(nc.NDX?.b) ? nc.NDX.b : 0;
  if (!bundle.nifty_model) warnings.push('nifty_model missing: Nifty channel set to zero');
  const betaInr = isFiniteNum(bundle.fx?.beta_inr_on_ndx) ? bundle.fx.beta_inr_on_ndx : 0;
  if (!isFiniteNum(bundle.fx?.beta_inr_on_ndx)) warnings.push('fx.beta_inr_on_ndx missing: auto INR depreciation = 0');

  // ---- residuals
  const residLen = bundle.resid_dates?.length ?? 0;
  const toArr = (xs: (number | null)[] | undefined): Float64Array => {
    const a = new Float64Array(residLen);
    for (let t = 0; t < residLen; t++) {
      const v = xs?.[t];
      a[t] = isFiniteNum(v) ? v : NaN;
    }
    return a;
  };
  const nonNullOf = (a: Float64Array): Int32Array => {
    const idx: number[] = [];
    for (let t = 0; t < a.length; t++) if (!Number.isNaN(a[t])) idx.push(t);
    return Int32Array.from(idx);
  };
  const niftyResid = toArr(bundle.nifty_resid);
  const niftyNonNull = nonNullOf(niftyResid);

  // ---- India targets
  const parentMaps = bundle.parent_maps ?? {};
  const india: PrepIndia[] = (bundle.india ?? []).map((t, idx) => {
    const sec = securities[t.ticker];
    const coef = t.reg?.coef ?? {};
    const b = (k: string) => (isFiniteNum(coef[k]?.b) ? coef[k].b : 0);
    const bN = b('NIFTY');
    const own = toArr(t.resid);
    const comb = new Float64Array(residLen);
    for (let i = 0; i < residLen; i++) {
      const e = own[i];
      const en = niftyResid[i];
      comb[i] = Number.isNaN(e) ? NaN : e + (Number.isNaN(en) ? 0 : bN * en);
    }
    const pm = t.parent ? parentMaps[t.parent] : undefined;
    const mcapInr = isFiniteNum(sec?.mcap_inr)
      ? (sec!.mcap_inr as number)
      : isFiniteNum(sec?.mcap_usd) && Number.isFinite(usdInr)
        ? (sec!.mcap_usd as number) * usdInr
        : null;
    return {
      idx,
      ticker: t.ticker,
      display: t.display ?? t.ticker,
      name: t.name ?? sec?.name ?? t.ticker,
      tier: t.tier,
      target: t,
      sec,
      hasReg: !!t.reg,
      bSOX: b('SOX'),
      bNDX: b('NDX'),
      bP: b('PARENT'),
      bN,
      r2: isFiniteNum(t.reg?.r2) ? (t.reg!.r2 as number) : null,
      n: isFiniteNum(t.reg?.n) ? (t.reg!.n as number) : 0,
      parent: t.parent ?? null,
      parentOriginIdx: t.parent ? originIdx.get(t.parent) ?? -1 : -1,
      parentMap: pm && isFiniteNum(pm.SOX) && isFiniteNum(pm.NDX) ? { SOX: pm.SOX, NDX: pm.NDX } : null,
      parentSlope: isFiniteNum(t.slopes?.parent_on_sox) ? (t.slopes.parent_on_sox as number) : null,
      exposures: (t.exposures ?? []).filter((e) => e && e.share).map((e) => ({ channel: e.channel, q: e.share })),
      qOL: sec?.op_leverage ?? null,
      qFx: t.fx_margin_sens_bps ?? null,
      ebitMargin: isFiniteNum(sec?.ebit_margin) ? (sec!.ebit_margin as number) : null,
      premRaw: isFiniteNum(sec?.ai_premium) ? (sec!.ai_premium as number) : null,
      mcapInrCr: mcapInr !== null ? mcapInr / 1e7 : null,
      resid: comb,
      nonNull: nonNullOf(comb),
    };
  });
  const indiaIdx = new Map(india.map((t) => [t.ticker, t.idx] as [string, number]));
  if (residLen === 0) warnings.push('resid_dates empty: Monte Carlo has no residual noise');

  // ---- capex total
  const capexVals = origins.filter((o) => o.group === 'hyperscalers' && o.capexUsd !== null).map((o) => o.capexUsd as number);
  const capexTotalUsd = capexVals.length ? capexVals.reduce((a, b) => a + b, 0) : null;

  // ---- tier median premium (bundle calibration, else computed from available premia)
  const tierMedianPremium: Record<Tier, number | null> = { A: null, B: null, C: null, D: null };
  const cal = bundle.calibration?.tier_median_premium;
  (['A', 'B', 'C', 'D'] as Tier[]).forEach((tier) => {
    const v = cal?.[tier];
    if (isFiniteNum(v)) tierMedianPremium[tier] = v;
    else {
      const xs = india.filter((t) => t.tier === tier && t.premRaw !== null).map((t) => t.premRaw as number).sort((a, b) => a - b);
      if (xs.length) tierMedianPremium[tier] = xs.length % 2 ? xs[(xs.length - 1) / 2] : (xs[xs.length / 2 - 1] + xs[xs.length / 2]) / 2;
    }
  });

  const windows = new Map((bundle.history?.replay_windows ?? []).map((w) => [w.id, w] as [string, ReplayWindow]));

  const prep: Prep = {
    bundle,
    usdInr,
    origins,
    india,
    originIdx,
    indiaIdx,
    betaSoxChip,
    betaNdxAi,
    cSOX,
    cNDX,
    betaInr,
    capexTotalUsd,
    tierMedianPremium,
    residLen,
    niftyResid,
    niftyNonNull,
    windows,
    peerOrigins: bundle.peer_beta?.origins ?? {},
    staticWarnings: warnings,
  };
  cache.set(bundle, prep);
  return prep;
}
