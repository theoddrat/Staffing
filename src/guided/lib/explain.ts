// Plain-language "why" for one stock. Uses the engine's explainStock when it is exported (ENGINE-V2);
// otherwise builds the same Explanation shape locally from the scenario result. The channel splits
// below are exact: market parts sum to market_move × market cap, business parts to
// fundamental_net × market cap (the engine's own allocation in channel_inr_cr).
import * as Engine from '../../engine';
import type { DataBundle } from '../../types/data';
import type { Channel, Explanation, IndiaResult, ScenarioResult } from '../../types/engine';
import { CHANNEL_VIS, CONFIDENCE_VIS } from '../visual';
import { isNum } from '../../lib/format';
import { HORIZON_WORDS, moveWords, pct, pctAbs } from './format';

export type PartChannel = Channel | 'premium';

export interface Part {
  channel: PartChannel;
  frac: number; // signed share of today's price (−0.12 = takes 12% off the price)
  inr_cr: number | null; // signed ₹ crore (null when market cap is unknown)
  share: number; // |part| / Σ|parts|
}

function withShares(parts: { channel: PartChannel; frac: number; inr_cr: number | null }[]): Part[] {
  const kept = parts.filter((p) => isNum(p.frac) && Math.abs(p.frac) > 1e-7);
  const tot = kept.reduce((a, p) => a + Math.abs(p.frac), 0) || 1;
  return kept.map((p) => ({ ...p, share: Math.abs(p.frac) / tot })).sort((a, b) => Math.abs(b.frac) - Math.abs(a.frac));
}

const MARKET: Channel[] = ['parent', 'sentiment', 'fx_fpi', 'own'];

/** What prices would likely do, split by channel. Sums to the market-implied move. */
export function marketParts(r: IndiaResult): Part[] {
  const m = r.mcap_inr_cr;
  const c = r.channel_inr_cr ?? {};
  if (isNum(m) && m > 0 && MARKET.some((k) => isNum(c[k]) && c[k] !== 0)) {
    return withShares(MARKET.map((k) => ({ channel: k, frac: (c[k] ?? 0) / m, inr_cr: c[k] ?? 0 })));
  }
  // no market cap: split the move in proportion to the log contributions
  const mc = r.market_contrib ?? { parent: 0, sentiment: 0, fx_fpi: 0, own: 0 };
  const L = mc.parent + mc.sentiment + mc.fx_fpi + mc.own;
  const k = Math.abs(L) > 1e-12 ? r.market_move / L : 0;
  return withShares(MARKET.map((ch) => ({ channel: ch, frac: (mc[ch as keyof typeof mc] ?? 0) * k, inr_cr: null })));
}

/** What the business numbers say (earnings, AI premium, rupee), split by channel. Sums to fundamental_net. */
export function businessParts(r: IndiaResult): Part[] {
  const net = r.fundamental_net;
  if (!isNum(net)) return [];
  const m = r.mcap_inr_cr;
  const ownRestated = (r.ear_contrib?.own ?? 0) > 0;
  const rest: PartChannel = ownRestated ? 'own' : 'premium';
  if (isNum(m) && m > 0) {
    const c = r.channel_inr_cr ?? {};
    const rev = c.revenue ?? 0;
    const cap = c.capex ?? 0;
    const cre = c.credit ?? 0;
    const fx = c.fx ?? 0;
    const other = net * m - (rev + cap + cre + fx);
    return withShares([
      { channel: 'revenue', frac: rev / m, inr_cr: rev },
      { channel: 'capex', frac: cap / m, inr_cr: cap },
      { channel: 'credit', frac: cre / m, inr_cr: cre },
      { channel: rest, frac: other / m, inr_cr: other },
      { channel: 'fx', frac: fx / m, inr_cr: fx },
    ]);
  }
  // same log allocation the engine uses, in fractions of the price
  const E = isNum(r.ear) ? r.ear : 0;
  const lnE = Math.log(Math.max(1 - E, 1e-9));
  const lnD = Math.log(Math.max(1 - (isNum(r.d) ? r.d : 0), 1e-9));
  const lnF = Math.log(Math.max(1 + (isNum(r.fx_eps) ? r.fx_eps : 0), 1e-9));
  const Lf = lnE + lnD + lnF;
  const s = Math.abs(Lf) > 1e-12 ? net / Lf : 0;
  const ec = r.ear_contrib ?? { revenue: 0, capex: 0, credit: 0, own: 0 };
  const eTot = ec.revenue + ec.capex + ec.credit + ec.own;
  const sh = (x: number) => (eTot > 0 ? x / eTot : 0);
  return withShares([
    { channel: 'revenue', frac: sh(ec.revenue) * lnE * s, inr_cr: null },
    { channel: 'capex', frac: sh(ec.capex) * lnE * s, inr_cr: null },
    { channel: 'credit', frac: sh(ec.credit) * lnE * s, inr_cr: null },
    { channel: rest, frac: (sh(ec.own) * lnE + lnD) * s, inr_cr: null },
    { channel: 'fx', frac: lnF * s, inr_cr: null },
  ]);
}

function parentName(bundle: DataBundle, ticker: string | null): string {
  if (!ticker) return 'its parent';
  return bundle.securities[ticker]?.name ?? ticker;
}

/** One plain sentence per channel, with the numbers taken from the bundle and the result. */
export function reasonText(ch: PartChannel, r: IndiaResult, bundle: DataBundle, result: ScenarioResult): string {
  const t = bundle.india.find((x) => x.ticker === r.ticker);
  switch (ch) {
    case 'parent': {
      const pm = result.origins.find((o) => o.ticker === t?.parent);
      const stake = t?.parent_stake?.value;
      const own = isNum(stake) ? `owns about ${pctAbs(stake)} of it` : 'is its main shareholder';
      const pmTxt = pm ? ` and ${moveWords(pm.move)} in this scenario` : '';
      return `${parentName(bundle, t?.parent ?? null)} ${own}${pmTxt}; the Indian shares have tended to follow the parent’s moves.`;
    }
    case 'sentiment':
      return isNum(r.beta_total)
        ? `On past days when US chip stocks moved, this share moved about ${Math.abs(r.beta_total * 10).toFixed(1)}% ${
            r.beta_total >= 0 ? 'the same way' : 'the opposite way'
          } for every 10% move.`
        : 'It has tended to move with US chip and tech stocks the next day.';
    case 'fx_fpi':
      return `Global funds selling Indian shares would move the whole Nifty ${pct(result.factors.NIFTY)}, and this share tends to move with the Nifty.`;
    case 'own':
      return 'The accounting shock hits this company directly: lower restated profit and lost trust.';
    case 'revenue': {
      const e = t?.exposures.find((x) => x.channel === 'revenue');
      return isNum(e?.share.value)
        ? `About ${pctAbs(e!.share.value)} of its revenue comes from US tech clients, who cut IT budgets when their own sales fall.`
        : 'Part of its revenue comes from US tech clients, who cut IT budgets when their own sales fall.';
    }
    case 'capex': {
      const e = t?.exposures.find((x) => x.channel === 'capex');
      return isNum(e?.share.value)
        ? `About ${pctAbs(e!.share.value)} of its business is tied to data-centre and AI orders, which shrink when Big Tech spends less.`
        : 'Part of its business depends on data-centre and AI orders, which shrink when Big Tech spends less.';
    }
    case 'credit':
      return 'Debt-stressed AI cloud firms would buy less of what it sells.';
    case 'premium':
      return isNum(r.ai_premium)
        ? `Its price-to-earnings ratio is ${pctAbs(r.ai_premium)} ${r.ai_premium >= 0 ? 'above' : 'below'} its pre-ChatGPT level; ${
            r.ai_premium >= 0 ? 'part of that extra could fade.' : 'so there is little AI premium left to lose.'
          }`
        : 'Part of the extra price investors pay for the AI story could fade (its own pre-ChatGPT level is unknown, so its group’s typical premium is used).';
    case 'fx':
      return r.fx_eps >= 0
        ? `A rupee about ${pctAbs(result.factors.inr_depr, 1)} weaker makes its dollar earnings worth more rupees.`
        : `A rupee about ${pctAbs(result.factors.inr_depr, 1)} weaker raises the rupee cost of what it imports.`;
    default:
      return '';
  }
}

function localExplain(bundle: DataBundle, result: ScenarioResult, ticker: string): Explanation | null {
  const r = result.india.find((x) => x.ticker === ticker);
  if (!r) return null;
  const range = r.range ? ` (likely range ${pct(r.range.p5, 0)} to ${pct(r.range.p95, 0)})` : '';
  const headline = `${r.name} ${moveWords(r.market_move)} ${HORIZON_WORDS[result.params.horizon]} in this scenario${range}.`;
  const reasons = marketParts(r).map((p) => ({
    channel: (p.channel === 'premium' ? 'own' : p.channel) as Channel,
    label: CHANNEL_VIS[p.channel].label,
    text: reasonText(p.channel, r, bundle, result),
    inr_cr: p.inr_cr ?? 0,
    share: p.share,
  }));
  const cv = CONFIDENCE_VIS[r.confidence.grade];
  const model = bundle.models?.find((m) => m.ticker === ticker);
  const h1 = model?.horizons.find((h) => h.h === 1);
  return {
    ticker,
    headline,
    reasons,
    confidence: { grade: r.confidence.grade, text: `${cv.label}: ${cv.blurb}` },
    accuracy: model
      ? {
          text: isNum(h1?.r2_oos)
            ? `Tested on days it had not seen, the model explained ${pctAbs(Math.max(0, h1!.r2_oos!))} of this share’s next-day moves${
                isNum(model.coverage90) ? `, and the real move landed inside its 90% range ${pctAbs(model.coverage90)} of the time` : ''
              }.`
            : 'An out-of-sample accuracy score is not available for this share yet.',
          r2_oos: h1?.r2_oos ?? null,
          coverage90: model.coverage90 ?? null,
        }
      : null,
  };
}

/** Prefer the engine's explainStock (V2); fall back to the local builder. */
export function getExplanation(bundle: DataBundle, result: ScenarioResult, ticker: string): Explanation | null {
  const fn = (Engine as unknown as Record<string, unknown>).explainStock as
    | ((b: DataBundle, r: ScenarioResult, t: string) => Explanation)
    | undefined;
  if (typeof fn === 'function') {
    try {
      const e = fn(bundle, result, ticker);
      if (e && typeof e.headline === 'string' && Array.isArray(e.reasons)) return e;
    } catch {
      /* fall through to the local explanation */
    }
  }
  return localExplain(bundle, result, ticker);
}

/** The two biggest market channels for a company card. */
export function topReasons(r: IndiaResult, n = 2): Part[] {
  return marketParts(r).slice(0, n);
}

export type GapKind = 'match' | 'overshoot' | 'undershoot';

/** Price move vs business damage: gap = market − fundamental (negative = prices fall more). */
export function gapInfo(r: IndiaResult): { kind: GapKind; size: number; text: string } | null {
  if (!isNum(r.gap) || !isNum(r.fundamental_net)) return null;
  const g = r.gap;
  if (Math.abs(g) < 0.03) return { kind: 'match', size: Math.abs(g), text: 'Price move roughly matches the business damage' };
  return g < 0
    ? { kind: 'overshoot', size: -g, text: `Price may fall ${pctAbs(g)} more than the business damage suggests` }
    : { kind: 'undershoot', size: g, text: `Business damage is ${pctAbs(g)} bigger than the likely price move` };
}
