// Price waterfalls for the security page: price → EPS cut → de-rating → (sympathy/FX) → new price.
import type { DataBundle } from '../types/data';
import type { ScenarioResult } from '../types/engine';
import type { Waterfall, WaterfallStep } from './types-extra';

function step(label: string, prev: number | null, next: number | null, note: string): WaterfallStep {
  const change = prev !== null && next !== null && prev !== 0 ? next / prev - 1 : 0;
  return { label, price: next, change: Number.isFinite(change) ? change : 0, note };
}

export function securityWaterfall(bundle: DataBundle, result: ScenarioResult, ticker: string): Waterfall | null {
  const usdInr = bundle.meta?.usd_inr;
  const o = result.origins.find((x) => x.ticker === ticker);
  if (o) {
    const p0 = o.price0;
    const pE = o.price_after_eps;
    const pD = p0 !== null ? p0 * (1 + o.move_direct) : null;
    const pN = o.price_new;
    const steps: WaterfallStep[] = [
      { label: 'Price (last close)', price: p0, change: 0, note: o.pe0 !== null ? `P/E ${o.pe0.toFixed(1)}x × EPS ${o.eps0?.toFixed(2)}` : 'P/E n/a' },
      step('EPS cut', p0, pE, `e = ${(o.e * 100).toFixed(1)}%`),
      step('Multiple de-rating', pE, pD, `d = ${(o.d * 100).toFixed(1)}%`),
      step('Sympathy / contagion', pD, pN, `${(o.move_sympathy * 100).toFixed(1)}%`),
    ];
    return {
      ticker,
      kind: 'origin',
      currency: bundle.securities?.[ticker]?.currency ?? 'USD',
      steps,
      pe0: o.pe0,
      pe_new: o.pe_new,
      eps0: o.eps0,
      eps_new: o.eps0 !== null ? o.eps0 * (1 - o.e) : null,
      move: o.move,
      mcap_change_usd: o.mcap_change_usd,
      mcap_change_inr_cr: o.mcap_change_inr_cr,
      drivers: o.drivers,
    };
  }
  const r = result.india.find((x) => x.ticker === ticker);
  if (!r) return null;
  const sec = bundle.securities?.[ticker];
  const p0 = sec?.last_close ?? null;
  const pe0 = sec?.pe_ttm ?? null;
  const eps0 = p0 !== null && pe0 !== null && pe0 > 0 ? p0 / pe0 : sec?.eps_ttm ?? null;
  const pE = p0 !== null ? p0 * (1 - r.ear) : null;
  const pD = pE !== null ? pE * (1 - r.d) : null;
  const pF = pD !== null ? pD * (1 + r.fx_eps) : null;
  const pM = p0 !== null ? p0 * (1 + r.market_move) : null;
  const steps: WaterfallStep[] = [
    { label: 'Price (last close)', price: p0, change: 0, note: pe0 !== null ? `P/E ${pe0.toFixed(1)}x` : 'P/E n/a' },
    step('Earnings at risk', p0, pE, `EaR = ${(r.ear * 100).toFixed(1)}%`),
    step('AI-premium unwind', pE, pD, `d = ${(r.d * 100).toFixed(1)}%`),
    step('FX offset', pD, pF, `FX EPS ${(r.fx_eps * 100).toFixed(1)}%`),
    { label: 'Market-implied (Layer 2)', price: pM, change: r.market_move, note: `β-implied ${(r.market_move * 100).toFixed(1)}%` },
  ];
  const mcapChangeInr = r.mcap_change_inr_cr;
  return {
    ticker,
    kind: 'india',
    currency: sec?.currency ?? 'INR',
    steps,
    pe0,
    pe_new: pe0 !== null && r.fundamental_net !== null && r.ear < 0.999 ? (pe0 * (1 + r.fundamental_net)) / (1 - r.ear) : null,
    eps0,
    eps_new: eps0 !== null ? eps0 * (1 - r.ear) * (1 + r.fx_eps) : null,
    move: r.market_move,
    mcap_change_usd: mcapChangeInr !== null && usdInr ? (mcapChangeInr * 1e7) / usdInr : null,
    mcap_change_inr_cr: mcapChangeInr,
    drivers: r.notes,
  };
}
