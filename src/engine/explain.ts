// V2 plain-language explanations for the guided UI (DESIGN §9.5). Pure functions: every number in
// the text is read from the scenario result or the bundle (nothing invented), and nothing here
// returns NaN. Labels and confidence words come from the shared vocabulary in src/guided/visual.ts.
import type { DataBundle, StockModels } from '../types/data';
import type { Channel, Explanation, Horizon, IndiaResult, PresetId, ScenarioResult } from '../types/engine';
import { CHANNEL_VIS, CONFIDENCE_VIS, TIER_VIS } from '../guided/visual';
import { ENSEMBLE_H, type CoefSel } from './ensemble';
import { prepare, type Prep, type PrepIndia } from './prepare';
import { defaultParams, paramSpecs } from './presets';
import { effective } from './quantities';
import type { IntensityValues } from './types-extra';
import { clamp, expm1Safe, isFiniteNum } from './util';

const MINUS = '−';
const OVER: Record<Horizon, string> = { '1D': 'on the next trading day', '1M': 'over the next month', '12M': 'over the next 12 months' };
/** Same order as the engine's dominant-channel scan, so reasons[0] is the dominant channel. */
const KEYS: Channel[] = ['parent', 'sentiment', 'fx_fpi', 'revenue', 'capex', 'credit', 'fx', 'own'];

const num = (x: unknown): x is number => isFiniteNum(x);

/** A ParamValue as a number (numeric strings accepted, as resolveParams does), else null. */
function asNum(v: unknown): number | null {
  if (num(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/** |x| as a percent: two decimals below 0.1%, one below 10%, whole numbers above. */
function pctAbs(x: number): string {
  const v = Math.abs(num(x) ? x : 0) * 100;
  return `${v < 0.095 ? v.toFixed(2) : v < 9.95 ? v.toFixed(1) : v.toFixed(0)}%`;
}

/** Signed percent with a true minus sign, e.g. −66% / +105%. */
function pctSigned(x: number): string {
  const v = (num(x) ? x : 0) * 100;
  const a = Math.abs(v);
  const s = a < 9.95 ? a.toFixed(1) : a.toFixed(0);
  if (Number(s) === 0) return '0%';
  return `${v < 0 ? MINUS : '+'}${s}%`;
}

/** ₹ crore in Indian units (lakh crore above 1,00,000 crore). */
function crore(x: number): string {
  const a = Math.abs(num(x) ? x : 0);
  if (a >= 1e5) return `₹${(a / 1e5).toFixed(a >= 1e6 ? 0 : 1)} lakh crore`;
  return `₹${Math.round(a).toLocaleString('en-IN')} crore`;
}

/** "falls about 45%" / "rises about 3.2%" / "barely moves" (plural: "fall" / "rise" / "barely move"). */
function moves(x: number, plural = false): string {
  const sfx = plural ? '' : 's';
  if (!num(x) || Math.abs(x) < 0.0005) return `barely move${sfx}`;
  return `${x < 0 ? 'fall' : 'rise'}${sfx} about ${pctAbs(x)}`;
}

function joinAnd(xs: string[]): string {
  if (xs.length <= 1) return xs.join('');
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

function horizonOf(result: ScenarioResult): Horizon {
  const h = result.params?.horizon;
  return h === '1D' || h === '1M' || h === '12M' ? h : '1M';
}

interface Ctx {
  bundle: DataBundle;
  prep: Prep;
  result: ScenarioResult;
  r: IndiaResult;
  t: PrepIndia | null;
  sel: CoefSel | null;
  H: Horizon;
}

/** Effective (override-aware) exposure share of one channel, or null. */
function exposureShare(c: Ctx, ch: 'revenue' | 'capex' | 'credit'): number | null {
  const e = c.t?.exposures.find((x) => x.channel === ch);
  if (!e) return null;
  const v = effective(e.q, c.result.params?.overrides).value;
  return num(v) ? v : null;
}

/** Signed share of the price this channel accounts for (₹ crore / market cap; log contribution without one). */
function priceEffect(c: Ctx, ch: Channel, logFallback: number): number {
  const inr = c.r.channel_inr_cr?.[ch];
  const m = c.r.mcap_inr_cr;
  if (num(inr) && num(m) && m > 0) return inr / m;
  return num(logFallback) ? expm1Safe(logFallback) : 0;
}

/** " — about 9.1% off its price" / " — adding about 1.2% to its price" / "". */
function effectWords(eff: number): string {
  if (!num(eff) || Math.abs(eff) < 0.0005) return '';
  return eff < 0 ? ` — about ${pctAbs(eff)} off its price` : ` — adding about ${pctAbs(eff)} to its price`;
}

/** How a stock has followed one factor: with it, against it, or barely (log-space coefficient b). */
function followWords(who: string, b: number, what: string): string {
  const r = expm1Safe((num(b) ? b : 0) * Math.log(0.9));
  if (Math.abs(r) < 0.0005) return `, but ${who} has barely reacted to ${what} in the past`;
  return b > 0
    ? `; ${who} has tended to follow it, falling about ${pctAbs(r)} for every 10% fall in ${what}`
    : `; ${who} has tended to move the other way, rising about ${pctAbs(r)} for every 10% fall in ${what}`;
}

function reasonText(ch: Channel, c: Ctx): string {
  const { r, sel, result, bundle, t } = c;
  const f = result.factors;
  const who = r.display || r.name || r.ticker;
  const values = result.params?.values ?? {};
  switch (ch) {
    case 'parent': {
      const pt = t?.parent ?? null;
      const pName = pt ? bundle.securities?.[pt]?.name ?? pt : 'its parent company';
      const stake = t?.target.parent_stake?.value;
      const subject = pt ? `${pName} ${num(stake) ? `owns about ${pctAbs(stake)} of it` : 'is its parent company'}` : 'Its parent company';
      const xP = sel && Math.abs(sel.PARENT) > 1e-12 ? r.market_contrib.parent / sel.PARENT : null;
      const pm = xP !== null && num(xP) ? ` and ${moves(expm1Safe(xP))} in this scenario` : '';
      const follow = sel ? followWords(who, sel.PARENT, pName) : '';
      return `${subject}${pm}${follow}${effectWords(priceEffect(c, 'parent', r.market_contrib.parent))}.`;
    }
    case 'sentiment': {
      const contagion = sel ? r.market_contrib.sentiment - (sel.SOX * f.x.SOX + sel.NDX * f.x.NDX) : 0;
      const factorLog = r.market_contrib.sentiment - contagion;
      const eff = effectWords(priceEffect(c, 'sentiment', r.market_contrib.sentiment));
      const hasTrust = Math.abs(contagion) > 1e-6;
      const tgt = values.target;
      const rest = typeof tgt === 'string' ? bundle.india?.find((x) => x.ticker === tgt)?.display ?? tgt : 'a peer';
      if (hasTrust && Math.abs(factorLog) < 0.0005)
        return `${rest} restating its profits knocks investors' trust in Indian companies of the same kind (${TIER_VIS[r.tier]?.label ?? `tier ${r.tier}`})${eff}.`;
      const head = `US chip stocks ${moves(f.SOX, true)} and big US tech ${moves(f.NDX)} in this scenario`;
      let body = '';
      if (Math.abs(factorLog) >= 0.0005) {
        // direction relative to the US factor moves of this scenario (the sign of the ₹ effect)
        const along = factorLog * (f.x.SOX + f.x.NDX) >= 0;
        body = `; on top of the Nifty, ${who} has tended to move ${along ? 'with' : 'against'} them`;
      } else if (Math.abs(f.x.SOX) >= 0.0005 || Math.abs(f.x.NDX) >= 0.0005) body = `; beyond the Nifty, ${who} has barely moved with them in the past`;
      const trust = hasTrust ? `, plus a knock-on loss of trust from ${rest} restating its profits` : '';
      return `${head}${body}${trust}${eff}.`;
    }
    case 'fx_fpi': {
      let follow = '';
      if (sel) {
        const r10 = expm1Safe(sel.NIFTY * Math.log(0.9));
        follow =
          Math.abs(r10) < 0.0005
            ? `, but ${who} has barely moved with the Nifty in the past`
            : sel.NIFTY > 0
              ? `; ${who} has typically moved ${pctAbs(r10)} for every 10% Nifty move`
              : `; ${who} has tended to move against the Nifty, rising ${pctAbs(r10)} for every 10% fall`;
      }
      return `A US sell-off tends to make foreign funds sell Indian shares, so the Nifty ${moves(f.NIFTY)} here${follow}${effectWords(priceEffect(c, 'fx_fpi', r.market_contrib.fx_fpi))}.`;
    }
    case 'own': {
      const rr = asNum(values.r);
      const dd = asNum(values.d);
      const cut = rr !== null ? ` down ${pctAbs(rr)}` : '';
      const derate = dd !== null && dd > 0 ? ` and loses ${pctAbs(dd)} of its valuation on credibility` : '';
      return `${who} itself restates its profits${cut}${derate}${effectWords(priceEffect(c, 'own', r.market_contrib.own))}.`;
    }
    case 'revenue': {
      const sh = exposureShare(c, 'revenue');
      const lead = sh !== null ? `About ${pctAbs(sh)} of its revenue comes from US tech clients` : 'Part of its revenue comes from US tech clients';
      return `${lead}; with their sales down about ${pctAbs(f.tech_revenue_shock)} here they spend less on IT services, which could cut its earnings by about ${pctAbs(r.ear_contrib.revenue)}.`;
    }
    case 'capex': {
      const sh = exposureShare(c, 'capex');
      const lead = sh !== null ? `About ${pctAbs(sh)} of its business is tied to AI data-centre orders` : 'Part of its business is tied to AI data-centre orders';
      const cut = num(f.capex_cut_usd) && f.capex_cut_usd > 0 ? `with Big Tech cutting AI spending by about $${(f.capex_cut_usd / 1e9).toFixed(0)} billion` : 'with AI data-centre spending cut';
      return `${lead}; ${cut} in this scenario, its earnings could fall by about ${pctAbs(r.ear_contrib.capex)}.`;
    }
    case 'credit': {
      const ds = asNum(values.ds_bps);
      const cost = ds !== null && ds > 0 ? ` facing interest costs ${(ds / 100).toFixed(1)} percentage points higher` : '';
      return `Debt-heavy AI cloud firms${cost} would buy less from it, which could cut its earnings by about ${pctAbs(r.ear_contrib.credit)}.`;
    }
    case 'fx':
      return r.fx_eps >= 0
        ? `A rupee about ${pctAbs(f.inr_depr)} weaker makes its dollar earnings worth more rupees, lifting its earnings by about ${pctAbs(r.fx_eps)}.`
        : `Unlike exporters, its dollar costs outweigh its dollar income, so a rupee about ${pctAbs(f.inr_depr)} weaker cuts its earnings by about ${pctAbs(r.fx_eps)}.`;
    default:
      return '';
  }
}

function headline(c: Ctx): string {
  const { r } = c;
  const name = r.name || r.display || r.ticker;
  const m = r.market_move;
  const verb = !num(m) || Math.abs(m) < 0.0005 ? 'would barely move' : `could ${m < 0 ? 'fall' : 'rise'} about ${pctAbs(m)}`;
  let s = `${name} ${verb} ${OVER[c.H]} in this scenario`;
  const dm = r.mcap_change_inr_cr;
  if (num(dm) && Math.abs(dm) >= 1) s += `, ${dm < 0 ? 'wiping out' : 'adding'} about ${crore(dm)} of market value`;
  const q = r.range;
  if (q && num(q.p5) && num(q.p95)) return `${s} (9 in 10 simulations: ${pctSigned(q.p5)} to ${pctSigned(q.p95)}).`;
  return `${s}; the likely range needs a Monte Carlo run.`;
}

function confidenceText(r: IndiaResult): { grade: 'HIGH' | 'MED' | 'LOW'; text: string } {
  const k = r.confidence;
  const grade = k?.grade === 'HIGH' || k?.grade === 'MED' ? k.grade : 'LOW';
  const cv = CONFIDENCE_VIS[grade];
  const bits: string[] = [];
  if (!k || k.r2 === null || !num(k.r2)) bits.push('there is no fitted factor model for it');
  else bits.push(`historically, US and Indian market moves explained about ${pctAbs(clamp(k.r2, 0, 1))} of its day-to-day price changes`);
  const share = num(k?.assumption_share) ? k.assumption_share : 0;
  bits.push(share > 0.005 ? `${pctAbs(share)} of its business-impact inputs are assumptions` : 'none of its business-impact inputs are assumptions');
  if (num(k?.n) && k.n < 250) bits.push(`it has only ${k.n} trading days of history`);
  const score = num(k?.score) ? k.score : 0;
  return { grade, text: `${cv.label}: ${joinAnd(bits)} (score ${score}/100).` };
}

const SPAN: Record<1 | 5 | 21, { unit: string; moves: string }> = {
  1: { unit: 'trading days', moves: 'next-day' },
  5: { unit: 'weeks', moves: 'one-week' },
  21: { unit: 'months', moves: 'one-month' },
};

function accuracyText(c: Ctx, model: StockModels | null): Explanation['accuracy'] {
  if (!model) return null;
  const want = c.sel?.model === 'ensemble' && c.sel.h !== null ? c.sel.h : ENSEMBLE_H[c.H];
  const hs = model.horizons ?? [];
  const hc = hs.find((x) => x.h === want && num(x.r2_oos)) ?? hs.find((x) => x.h === 1 && num(x.r2_oos)) ?? null;
  const ens = model.oos?.ensemble;
  const h: 1 | 5 | 21 = hc ? hc.h : 1;
  const r2 = hc && num(hc.r2_oos) ? hc.r2_oos : ens && num(ens.r2) ? ens.r2 : null;
  const n = hc && num(hc.n_oos) && hc.n_oos > 0 ? hc.n_oos : ens && num(ens.n) ? ens.n : 0;
  const cov = num(model.coverage90) ? clamp(model.coverage90, 0, 1) : null;
  if (r2 === null) return { text: 'Out-of-sample accuracy is not available for this stock yet.', r2_oos: null, coverage90: cov };
  const sp = SPAN[h] ?? SPAN[1];
  const tested = `Tested on ${n > 0 ? `${n} ` : ''}${sp.unit} it had not seen`;
  const ols = h === 1 ? model.oos?.ols : undefined;
  const vsOls = ols && num(ols.r2) ? ` (the plain 3-year regression: ${ols.r2 > 0 ? pctAbs(ols.r2) : 'no better than that'})` : '';
  const band = cov !== null ? `${h === 1 ? '' : ' on single days'} the actual move landed inside its 90% range ${pctAbs(cov)} of the time` : '';
  const text =
    (r2 > 0
      ? `${tested}, the model explained about ${pctAbs(r2)} of this stock's ${sp.moves} moves${vsOls}${band ? `, and${band}` : ''}.`
      : `${tested}, the model did not beat a no-change forecast for this stock's ${sp.moves} moves${band ? `, though${band}` : ''}; treat the estimate as a rough guide.`) +
    (c.sel?.model === 'ols' ? ' This scenario uses the 3-year regression for this stock instead.' : '');
  return { text, r2_oos: r2, coverage90: cov };
}

/** Plain-language explanation of one stock's result (V2 guided UI). Pure; never returns NaN. */
export function explainStock(bundle: DataBundle, result: ScenarioResult, ticker: string): Explanation {
  const r = (result.india ?? []).find((x) => x.ticker === ticker);
  if (!r)
    return {
      ticker,
      headline: `${ticker} is not part of this scenario's results.`,
      reasons: [],
      confidence: { grade: 'LOW', text: `${CONFIDENCE_VIS.LOW.label}: there is no result for this stock.` },
      accuracy: null,
    };
  const prep = prepare(bundle);
  const ti = prep.indiaIdx.get(ticker);
  const t = ti !== undefined ? prep.india[ti] : null;
  const H = horizonOf(result);
  const c: Ctx = { bundle, prep, result, r, t, sel: t ? t.sel[H] : null, H };

  // ₹-crore contributions as the engine allocates them (market + business channels, the same set the
  // dominant channel is chosen from); without a market cap, fall back to the move fractions
  const byInr = num(r.mcap_inr_cr);
  const frac: Record<Channel, number> = {
    parent: r.market_contrib.parent,
    sentiment: r.market_contrib.sentiment,
    fx_fpi: r.market_contrib.fx_fpi,
    own: r.market_contrib.own,
    revenue: -r.ear_contrib.revenue,
    capex: -r.ear_contrib.capex,
    credit: -r.ear_contrib.credit,
    fx: r.fx_eps,
  };
  const items = KEYS.map((ch) => {
    const inr = r.channel_inr_cr?.[ch];
    const v = byInr ? (num(inr) ? inr : 0) : num(frac[ch]) ? frac[ch] : 0;
    return { ch, inr: byInr && num(inr) ? inr : 0, w: Math.abs(v) };
  });
  const all = items.reduce((a, x) => a + x.w, 0);
  const kept = items.filter((x) => x.w > 1e-9 && x.w >= 5e-3 * all); // drop channels under 0.5% of the story
  const tot = kept.reduce((a, x) => a + x.w, 0);
  const reasons = kept
    .sort((a, b) => b.w - a.w) // stable: ties keep the dominance order
    .map((x) => ({
      channel: x.ch,
      label: CHANNEL_VIS[x.ch].label,
      text: reasonText(x.ch, c),
      inr_cr: x.inr,
      share: tot > 0 ? x.w / tot : 0,
    }));

  return {
    ticker,
    headline: headline(c),
    reasons,
    confidence: confidenceText(r),
    accuracy: accuracyText(c, t?.model ?? (bundle.models ?? []).find((m) => m.ticker === ticker) ?? null),
  };
}

/** One sentence summing up a scenario: SOX / NDX / Nifty moves and the India ₹ total. */
export function scenarioHeadline(bundle: DataBundle, result: ScenarioResult): string {
  const f = result.factors;
  const H = horizonOf(result);
  const n = (result.india ?? []).length;
  let lead = `${result.preset?.label ?? 'This scenario'}, a hypothetical scenario ${OVER[H]}`;
  if (result.params?.preset === 'replay') {
    const id = result.params.values?.window;
    const w = (bundle.history?.replay_windows ?? []).find((x) => x.id === id);
    lead = w?.label ? `Replaying “${w.label}” on today's stocks (hypothetical)` : `Replaying a past sell-off on today's stocks (hypothetical)`;
  }
  const tot = result.totals?.india_mcap_change_inr_cr;
  const value =
    num(tot) && Math.abs(tot) >= 1
      ? `the ${n} Indian stocks tracked ${tot < 0 ? 'lose' : 'gain'} about ${crore(tot)} of market value`
      : `the ${n} Indian stocks tracked barely change in market value`;
  return `${lead}: US chip stocks ${moves(f.SOX, true)} and big US tech ${moves(f.NDX)}, the Nifty ${moves(f.NIFTY)}, and ${value}.`;
}

/** Keys where a higher value means a milder shock (a higher target P/E is less compression). */
const MILDER_WHEN_HIGHER = new Set(['target_pe']);
/** Auto / calibrated-by-default inputs that are not shock sizes. */
const NOT_SHOCK_SIZE = new Set(['f_override', 'contagion']);

/**
 * Mild / Severe / Extreme values for a preset, read from the bundle's own parameter specs: mild = the
 * low end of each published Monte Carlo range, severe = the default, extreme = the high end (horizon
 * overrides applied). Parameters without a sampled range keep their default and are left out.
 */
export function intensityValues(bundle: DataBundle, presetId: PresetId, horizon?: Horizon): IntensityValues {
  const H = horizon ?? defaultParams(bundle, presetId).horizon;
  const out: IntensityValues = { mild: {}, severe: {}, extreme: {} };
  for (const s of paramSpecs(bundle, presetId, H)) {
    if (s.kind !== 'number' || NOT_SHOCK_SIZE.has(s.key) || !num(s.value) || !s.mc) continue;
    if ((s.mc.dist !== 'triangular' && s.mc.dist !== 'uniform') || !num(s.mc.low) || !num(s.mc.high)) continue;
    // the published range around the default, kept inside the slider bounds (never past the default)
    let lo = Math.min(s.mc.low, s.value);
    let hi = Math.max(s.mc.high, s.value);
    if (num(s.min)) lo = Math.min(Math.max(lo, s.min), s.value);
    if (num(s.max)) hi = Math.max(Math.min(hi, s.max), s.value);
    const flip = MILDER_WHEN_HIGHER.has(s.key);
    out.mild[s.key] = flip ? hi : lo;
    out.severe[s.key] = s.value;
    out.extreme[s.key] = flip ? lo : hi;
  }
  return out;
}
