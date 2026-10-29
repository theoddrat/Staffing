// runScenario: deterministic scenario → full ScenarioResult (origins, factors, India, Sankey).
import type { DataBundle } from '../types/data';
import type { Channel, FactorMoves, IndiaResult, OriginResult, ScenarioParams, ScenarioResult } from '../types/engine';
import { assumptionShare, confidence } from './confidence';
import { evaluate, type CoreOut } from './core';
import { ENSEMBLE_H } from './ensemble';
import { resolveParams, resolveQuantities } from './params';
import { prepare, type Prep } from './prepare';
import { presetById, stubPreset } from './presets';
import { buildSankey, type SankeyRow } from './sankey';
import type { ResolvedParams } from './types-extra';
import { expm1Safe, fin, isFiniteNum, uniq } from './util';

const DOMINANCE_KEYS: Channel[] = ['parent', 'sentiment', 'fx_fpi', 'revenue', 'capex', 'credit', 'fx', 'own'];

function originResults(prep: Prep, core: CoreOut, rp: ResolvedParams): OriginResult[] {
  const usdInr = prep.usdInr;
  return prep.origins.map((po, j) => {
    const oc = core.o[j];
    const price0 = po.price0;
    const mcap = po.mcapUsd;
    const mcapChange = mcap !== null ? mcap * oc.move : null;
    const drivers = [...oc.drivers];
    if (rp.comp.replay) drivers.push('replay: origin-level moves not modelled; SOX/NDX moves taken from the window');
    if (drivers.length === 0) drivers.push('no direct exposure to this shock');
    return {
      ticker: po.ticker,
      name: po.name,
      group: po.group,
      price0,
      pe0: po.pe0,
      eps0: po.eps0,
      revenue_hit: fin(oc.rh),
      e: fin(oc.e),
      d: fin(oc.d),
      move_direct: fin(oc.moveDirect),
      move_sympathy: fin(oc.moveSymp),
      move: fin(oc.move),
      price_after_eps: price0 !== null ? price0 * (1 - oc.e) : null,
      price_new: price0 !== null ? price0 * (1 + oc.move) : null,
      pe_new: po.pe0 !== null && oc.e < 0.999 ? (po.pe0 * (1 + oc.move)) / (1 - oc.e) : null,
      mcap_usd: mcap,
      mcap_change_usd: mcapChange,
      mcap_change_inr_cr: mcapChange !== null && Number.isFinite(usdInr) ? (mcapChange * usdInr) / 1e7 : null,
      drivers,
    };
  });
}

function factorMoves(core: CoreOut): FactorMoves {
  const f = core.f;
  return {
    chip_basket: fin(expm1Safe(f.xChip)),
    ai_basket: fin(expm1Safe(f.xAi)),
    SOX: fin(expm1Safe(f.xSOX)),
    NDX: fin(expm1Safe(f.xNDX)),
    NIFTY: fin(expm1Safe(f.xN)),
    inr_depr: fin(f.f),
    tech_revenue_shock: fin(f.rTech),
    capex_cut_usd: isFiniteNum(f.capexCutUsd) ? f.capexCutUsd : null,
    capex_absorbed_share: isFiniteNum(f.capexAbsorbed) ? f.capexAbsorbed : null,
    x: { SOX: fin(f.xSOX), NDX: fin(f.xNDX), NIFTY: fin(f.xN) },
  };
}

interface IndiaBuild {
  result: IndiaResult;
  row: SankeyRow;
}

function indiaResult(prep: Prep, core: CoreOut, rp: ResolvedParams, rq: ReturnType<typeof resolveQuantities>, i: number): IndiaBuild {
  const t = prep.india[i];
  const { m, fund } = core.india[i];
  const notes: string[] = [];
  const marketMove = fin(expm1Safe(m.logMove));
  const mcap = t.mcapInrCr;

  // ---- market channel allocation (signed INR crore, sums to market_move × mcap)
  const L = m.parent + m.sentiment + m.fx_fpi + m.own;
  const mScale = Math.abs(L) > 1e-12 ? marketMove / L : 1;
  const mc = (x: number) => (mcap !== null ? x * mScale * mcap : 0);
  const market = {
    parent: mc(m.parent),
    sox: mc(m.sox),
    ndx: mc(m.ndx),
    contagion: mc(m.contagion),
    fx_fpi: mc(m.fx_fpi),
    own: mc(m.own),
  };

  // ---- fundamental allocation (signed INR crore, sums to fundamental_net × mcap)
  const fundamental = { revenue: 0, capex: 0, credit: 0, own: 0, premium: 0, fx: 0 };
  if (fund.modelled && fund.net !== null && mcap !== null) {
    const lnE = Math.log(Math.max(1 - fund.ear, 1e-9));
    const lnD = Math.log(Math.max(1 - fund.d, 1e-9));
    const lnU = Math.log(Math.max(1 - fund.dUnwind, 1e-9));
    const lnF = Math.log(Math.max(1 + fund.fxEps, 1e-9));
    const Lf = lnE + lnD + lnF;
    const fScale = Math.abs(Lf) > 1e-12 ? fund.net / Lf : 1;
    const ec = fund.earContrib;
    const eTot = ec.revenue + ec.capex + ec.credit + ec.own;
    const share = (x: number) => (eTot > 0 ? x / eTot : 0);
    fundamental.revenue = share(ec.revenue) * lnE * fScale * mcap;
    fundamental.capex = share(ec.capex) * lnE * fScale * mcap;
    fundamental.credit = share(ec.credit) * lnE * fScale * mcap;
    fundamental.own = (share(ec.own) * lnE + (lnD - lnU)) * fScale * mcap;
    fundamental.premium = lnU * fScale * mcap;
    fundamental.fx = lnF * fScale * mcap;
  }

  const channel_inr_cr: Partial<Record<Channel, number>> = {
    parent: market.parent,
    sentiment: market.sox + market.ndx + market.contagion,
    fx_fpi: market.fx_fpi,
    own: market.own,
    revenue: fundamental.revenue,
    capex: fundamental.capex,
    credit: fundamental.credit,
    fx: fundamental.fx,
  };
  let dominant: Channel = 'sentiment';
  let best = 0;
  for (const k of DOMINANCE_KEYS) {
    const val = Math.abs(channel_inr_cr[k] ?? 0);
    if (val > best + 1e-9) {
      best = val;
      dominant = k;
    }
  }
  if (mcap === null) {
    // no INR values: rank channels on log/fraction magnitudes instead
    const mags: Partial<Record<Channel, number>> = {
      parent: Math.abs(m.parent),
      sentiment: Math.abs(m.sentiment),
      fx_fpi: Math.abs(m.fx_fpi),
      own: Math.abs(m.own),
      revenue: fund.earContrib.revenue,
      capex: fund.earContrib.capex,
      credit: fund.earContrib.credit,
      fx: Math.abs(fund.fxEps),
    };
    best = 0;
    for (const k of DOMINANCE_KEYS) {
      const val = mags[k] ?? 0;
      if (val > best + 1e-12) {
        best = val;
        dominant = k;
      }
    }
    notes.push('market cap unavailable: INR-crore values not computed');
  }

  if (m.coef.note) notes.push(m.coef.note);
  if (m.coef.model === 'ols' && !t.hasReg) notes.push('no Layer-2 regression in bundle: factor channels excluded from the market-implied move');
  if (m.parentPath === 'missing') notes.push(`parent ${t.parent}: no parent map or slope, parent channel = 0`);
  if (m.parentPath === 'slope') notes.push(`parent ${t.parent}: moved via the target-level co-movement slope on SOX`);
  if (fund.premFallback) notes.push(`AI premium unavailable: tier-${t.tier} median ${(fund.prem! * 100).toFixed(0)}% used (USER ASSUMPTION)`);
  if (fund.prem === null) notes.push('AI premium unavailable and no tier median: no premium unwind');
  if (fund.fxCapped) notes.push('FX EPS effect capped at ±50% (thin EBIT margin)');
  if (rq.india[i].fxSens !== 0 && (t.ebitMargin === null || t.ebitMargin <= 0.01)) notes.push('EBIT margin unavailable: FX offset not applied');
  if (t.target.short_history) notes.push('short price history (< 3y): regression uses the available window');
  if (rp.comp.replay) notes.push('replay: fundamental damage not modelled (market replay only)');
  for (const n of t.target.notes ?? []) notes.push(n);

  const share = assumptionShare(t, rq, fund);
  const conf = confidence(t, share);
  const gross = fund.modelled && fund.gross !== null ? fin(fund.gross) : null;
  const net = fund.modelled && fund.net !== null ? fin(fund.net) : null;
  const result: IndiaResult = {
    ticker: t.ticker,
    display: t.display,
    name: t.name,
    tier: t.tier,
    dominant_channel: dominant,
    beta_total: isFiniteNum(m.coef.beta_total) ? m.coef.beta_total : null,
    beta_total_down: isFiniteNum(t.target.beta_total_down) ? t.target.beta_total_down : null,
    market_move: marketMove,
    market_contrib: { parent: fin(m.parent), sentiment: fin(m.sentiment), fx_fpi: fin(m.fx_fpi), own: fin(m.own) },
    ear: fin(fund.ear),
    ear_contrib: {
      revenue: fin(fund.earContrib.revenue),
      capex: fin(fund.earContrib.capex),
      credit: fin(fund.earContrib.credit),
      own: fin(fund.earContrib.own),
    },
    d: fin(fund.d),
    fx_eps: fin(fund.fxEps),
    fundamental_gross: gross,
    fundamental_net: net,
    gap: net !== null ? fin(marketMove - net) : null,
    ai_premium: isFiniteNum(fund.prem) ? fund.prem : null,
    ai_premium_status: fund.premStatus,
    ret_since_chatgpt_vs_bench: isFiniteNum(t.sec?.ret_since_chatgpt_vs_bench) ? (t.sec!.ret_since_chatgpt_vs_bench as number) : null,
    range: null,
    mcap_inr_cr: mcap,
    mcap_change_inr_cr: mcap !== null ? fin(marketMove * mcap) : null,
    channel_inr_cr: Object.fromEntries(Object.entries(channel_inr_cr).map(([k, x]) => [k, fin(x)])) as Partial<Record<Channel, number>>,
    confidence: conf,
    notes: uniq(notes),
    model_used: m.coef.model,
    market_move_ols: fin(expm1Safe(m.logMoveOls)),
  };
  return { result, row: { idx: i, market, fundamental } };
}

export function runScenario(bundle: DataBundle, params: ScenarioParams): ScenarioResult {
  const prep = prepare(bundle);
  const rp = resolveParams(prep, params);
  const rq = resolveQuantities(prep, params.overrides);
  const core = evaluate(prep, rq, rp, true);
  const preset = presetById(bundle, params.preset) ?? stubPreset(params.preset);
  const warnings: string[] = [...prep.staticWarnings, ...rp.warnings, ...rq.warnings, ...core.warnings];
  if (!presetById(bundle, params.preset)) warnings.push(`preset '${params.preset}' not in bundle.presets`);

  const origins = originResults(prep, core, rp);
  const builds = prep.india.map((_, i) => indiaResult(prep, core, rp, rq, i));
  const india = builds.map((b) => b.result).sort((a, b) => a.market_move - b.market_move);
  const rows = builds.map((b) => b.row);
  const sankey = {
    market: buildSankey(prep, core, rp, rows, 'market'),
    fundamental: buildSankey(prep, core, rp, rows, 'fundamental'),
  };
  const totals = {
    india_mcap_change_inr_cr: fin(india.reduce((a, r) => a + (r.mcap_change_inr_cr ?? 0), 0)),
    origin_mcap_change_usd: fin(origins.reduce((a, r) => a + (r.mcap_change_usd ?? 0), 0)),
  };
  if (prep.hasModels) {
    const nEns = india.filter((r) => r.model_used === 'ensemble').length;
    const sel = prep.nifty[rp.horizon];
    const hs = uniq(prep.india.filter((t) => t.sel[rp.horizon].model === 'ensemble').map((t) => `h${t.sel[rp.horizon].h}`));
    warnings.push(
      `INFO: Layer 2 uses the walk-forward-validated ensemble for ${nEns} of ${india.length} stocks (${hs.join('/') || '—'} coefficients` +
        `${rp.horizon === '12M' ? ' applied to the 12-month factor move, a documented assumption' : ''}; Nifty link ${sel.model === 'ensemble' ? `ensemble h${sel.h}` : '3y OLS'})` +
        `${nEns < india.length ? `; ${india.length - nEns} fall back to the 3y OLS` : ''}`,
    );
    // the mapped horizon (1M/12M → h21) is not in the bundle yet: say which fit stands in for it
    const want = ENSEMBLE_H[rp.horizon];
    const stand = prep.india.filter((t) => t.sel[rp.horizon].model === 'ensemble' && t.sel[rp.horizon].h !== want);
    if (stand.length || (sel.model === 'ensemble' && sel.h !== want)) {
      const used = uniq(stand.map((t) => `h${t.sel[rp.horizon].h}`)).join('/') || `h${sel.h}`;
      warnings.push(
        `ensemble has no ${want}-session fit yet: ${used} coefficients applied to the ${rp.horizon} factor move for ${stand.length} of ${india.length} stocks` +
          `${sel.model === 'ensemble' && sel.h !== want ? ` and for the Nifty link (h${sel.h})` : ''}; treat ${rp.horizon} magnitudes as provisional`,
      );
    }
  }
  if (rp.comp.multiple && core.basket.peNow !== null) {
    const how =
      rp.mode === 'calibrated' && core.basket.impliedDrawdown !== null
        ? `calibrated: fit-implied drawdown ${(core.basket.impliedDrawdown * 100).toFixed(1)}% × λ ${(rp.v.lambda ?? 0).toFixed(2)}`
        : `${rp.mode}`;
    warnings.push(
      `INFO: AI-basket P/E ${core.basket.peNow.toFixed(1)}x (pre-ChatGPT ${core.basket.pePre?.toFixed(1) ?? '—'}x, ${core.basket.source}; ${how}) → target ${core.basket.peTarget?.toFixed(1) ?? '—'}x, de-rating ${(core.basket.dBasket * 100).toFixed(1)}%`,
    );
  }
  return {
    params,
    preset,
    origins,
    factors: factorMoves(core),
    india,
    sankey,
    totals,
    lowConfidence: !!preset.low_confidence || rp.comp.credit,
    warnings: uniq(warnings),
  };
}
