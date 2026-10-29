// Layer 1: origin impact. move_j = (1-e_j)(1-d_j) - 1, components combined multiplicatively.
import type { Prep } from './prepare';
import type { ResolvedQuantities } from './params';
import type { ResolvedParams } from './types-extra';
import { clamp, expm1Safe, isFiniteNum, log1pSafe, p } from './util';

export interface OriginCore {
  rh: number; // combined revenue hit
  rhCapex: number; // revenue hit from the capex channel only (for capex_absorbed_share)
  e: number;
  d: number;
  moveDirect: number;
  moveSymp: number;
  move: number;
  drivers: string[];
}

export interface BasketPE {
  peNow: number | null;
  pePre: number | null;
  peTarget: number | null;
  dBasket: number;
  source: 'history' | 'aggregate' | 'none';
  /** mode 'calibrated': drawdown implied by the P/E-vs-drawdown fit at today's basket P/E (≤ 0). */
  impliedDrawdown: number | null;
}

const E_CAP = 0.95;
const E_CREDIT_CAP = 0.9;
const D_CAP = 0.99;

/** AI-basket P/E now vs pre-ChatGPT and the implied basket de-rating for the multiple shock. */
export function basketDerating(prep: Prep, rp: ResolvedParams, warn: (m: string) => void): BasketPE {
  const hist = prep.bundle.history?.ai_basket_pe;
  let peNow: number | null = null;
  let pePre: number | null = null;
  let source: BasketPE['source'] = 'none';
  if (hist && isFiniteNum(hist.now) && hist.now > 0 && isFiniteNum(hist.pre_chatgpt_median) && hist.pre_chatgpt_median > 0) {
    peNow = hist.now;
    pePre = hist.pre_chatgpt_median;
    source = 'history';
  } else {
    // aggregate over origins with both P/Es: sum(M) / sum(M / PE)
    let m = 0;
    let eNow = 0;
    let ePre = 0;
    for (const o of prep.origins) {
      if (o.mcapUsd === null || o.pe0 === null || o.pePre === null) continue;
      m += o.mcapUsd;
      eNow += o.mcapUsd / o.pe0;
      ePre += o.mcapUsd / o.pePre;
    }
    if (m > 0 && eNow > 0 && ePre > 0) {
      peNow = m / eNow;
      pePre = m / ePre;
      source = 'aggregate';
    }
  }
  const lambda = rp.v.lambda ?? 0;
  if (peNow === null) {
    if (rp.comp.multiple) warn('AI-basket P/E unavailable: multiple compression not applied');
    return { peNow, pePre, peTarget: null, dBasket: 0, source, impliedDrawdown: null };
  }
  if (rp.comp.multiple && rp.mode === 'median' && pePre !== null && peNow <= pePre) {
    warn(
      `AI-basket trailing P/E (${peNow.toFixed(1)}x) is below its pre-ChatGPT median (${pePre.toFixed(1)}x): reversion implies no de-rating — switch MODE to CALIBRATED (P/E-vs-drawdown fit) or MULTIPLE.`,
    );
  }
  if (rp.mode === 'calibrated') {
    // d_basket = λ · max(0, −(intercept + slope · PE_now)): λ = share of the historically implied
    // peak-to-trough drawdown realised as pure de-rating (DESIGN §4.1 item 4)
    const fit = prep.bundle.history?.pe_fit;
    if (!fit || !isFiniteNum(fit.slope) || !isFiniteNum(fit.intercept) || !(fit.n > 0)) {
      if (rp.comp.multiple) warn('history.pe_fit unavailable: calibrated multiple compression not applied');
      return { peNow, pePre, peTarget: null, dBasket: 0, source, impliedDrawdown: null };
    }
    const implied = fit.intercept + fit.slope * peNow;
    let d = Math.max(0, lambda) * Math.max(0, -implied);
    if (rp.floor_zero) d = Math.max(0, d);
    d = clamp(d, -2, D_CAP);
    return { peNow, pePre, peTarget: peNow * (1 - d), dBasket: d, source, impliedDrawdown: Math.min(implied, 0) };
  }
  let peTarget: number | null = null;
  if (rp.mode === 'multiple') {
    if (rp.target_pe !== null) peTarget = rp.target_pe;
    else warn('multiple mode without target_pe: falling back to median reversion');
  }
  if (peTarget === null) {
    if (pePre === null) {
      if (rp.comp.multiple) warn('pre-ChatGPT basket P/E unavailable: multiple compression not applied');
      return { peNow, pePre, peTarget: null, dBasket: 0, source, impliedDrawdown: null };
    }
    peTarget = peNow + lambda * (pePre - peNow);
  }
  let d = 1 - peTarget / peNow;
  if (rp.floor_zero) d = Math.max(0, d);
  return { peNow, pePre, peTarget, dBasket: clamp(d, -2, D_CAP), source, impliedDrawdown: null };
}

function perNameDerating(o: Prep['origins'][number], rp: ResolvedParams, basket: BasketPE): { d: number; perName: boolean } {
  // calibrated mode is a basket-level calibration: every origin takes the basket de-rating
  if (!rp.per_name || rp.mode === 'calibrated' || o.pe0 === null) return { d: basket.dBasket, perName: false };
  let target: number | null = null;
  if (rp.mode === 'multiple' && rp.target_pe !== null) target = rp.target_pe;
  else if (o.pePre !== null) target = o.pe0 + (rp.v.lambda ?? 0) * (o.pePre - o.pe0);
  if (target === null) return { d: basket.dBasket, perName: false };
  let d = 1 - target / o.pe0;
  if (rp.floor_zero) d = Math.max(0, d);
  return { d: clamp(d, -2, D_CAP), perName: true };
}

export function layer1(
  prep: Prep,
  rq: ResolvedQuantities,
  rp: ResolvedParams,
  detail: boolean,
  warn: (m: string) => void,
): { o: OriginCore[]; basket: BasketPE } {
  const v = rp.v;
  const basket: BasketPE = rp.comp.multiple
    ? basketDerating(prep, rp, warn)
    : { peNow: null, pePre: null, peTarget: null, dBasket: 0, source: 'none', impliedDrawdown: null };
  const out: OriginCore[] = prep.origins.map((o, j) => {
    const es: number[] = [];
    const ds: number[] = [];
    const rhs: number[] = [];
    let rhCapex = 0;
    const drivers: string[] = [];
    const ol = rq.olO[j];

    if (rp.comp.capex && o.group !== 'hyperscalers' && rq.s[j] > 0) {
      const rh = clamp(v.c * v.psi_supplier * rq.s[j], 0, 1);
      const e = Math.min(rh * ol, E_CAP);
      const d = clamp((v.kappa ?? 0) * e, -2, D_CAP);
      rhs.push(rh);
      rhCapex = rh;
      es.push(e);
      if (d !== 0) ds.push(d);
      if (detail)
        drivers.push(
          `capex: c ${p(v.c)} × ψ ${v.psi_supplier.toFixed(2)} × s ${p(rq.s[j])} = revenue −${p(rh)}; × OL ${ol.toFixed(2)} → EPS −${p(e)}` +
            (d !== 0 ? `; κ ${v.kappa.toFixed(2)} → de-rating ${p(d)}` : ''),
        );
    } else if (rp.comp.capex && o.group === 'hyperscalers' && detail) {
      drivers.push('capex: spender (no earnings hit from its own capex cut)');
    }

    if (rp.comp.guidance && j === rp.guidanceTarget) {
      const rh = clamp(v.g, 0, 1);
      const e = Math.min(rh * ol, E_CAP);
      const d = clamp((v.kappa ?? 0) * e, -2, D_CAP);
      rhs.push(rh);
      es.push(e);
      if (d !== 0) ds.push(d);
      if (detail)
        drivers.push(`guidance: revenue −${p(rh)} × OL ${ol.toFixed(2)} → EPS −${p(e)}; κ ${(v.kappa ?? 0).toFixed(2)} → de-rating ${p(d)}`);
    }

    if (rp.comp.restatement && rp.restTarget?.kind === 'origin' && rp.restTarget.idx === j) {
      es.push(clamp(v.r, 0, E_CAP));
      ds.push(clamp(v.d, -2, D_CAP));
      if (detail) drivers.push(`restatement: profit −${p(v.r)}, credibility de-rating ${p(v.d)}`);
    }

    if (rp.comp.multiple) {
      const pn = perNameDerating(o, rp, basket);
      if (pn.d !== 0) ds.push(pn.d);
      if (detail) {
        if (pn.perName) drivers.push(`multiple: own P/E ${o.pe0?.toFixed(1)}x vs pre-ChatGPT ${o.pePre?.toFixed(1) ?? '—'}x → de-rating ${p(pn.d)}`);
        else if (rp.mode === 'calibrated' && basket.peNow !== null && basket.impliedDrawdown !== null)
          drivers.push(
            `multiple (calibrated): basket P/E ${basket.peNow.toFixed(1)}x → P/E-vs-drawdown fit implies ${p(basket.impliedDrawdown)} × λ ${(v.lambda ?? 0).toFixed(2)} → de-rating ${p(pn.d)}`,
          );
        else if (basket.peNow !== null)
          drivers.push(
            `multiple: basket P/E ${basket.peNow.toFixed(1)}x → ${basket.peTarget?.toFixed(1) ?? '—'}x (pre-ChatGPT ${basket.pePre?.toFixed(1) ?? '—'}x) → de-rating ${p(pn.d)}`,
          );
      }
    }

    if (rp.comp.credit) {
      if (o.stressed) {
        let e = 0;
        if (o.netDebtUsd !== null && o.mcapUsd !== null && o.mcapUsd > 0) {
          e = Math.min(((v.ds_bps / 1e4) * v.duration * Math.max(o.netDebtUsd, 0)) / o.mcapUsd, E_CREDIT_CAP);
        } else warn(`${o.ticker}: net debt or market cap missing, credit repricing not applied`);
        const d = clamp(v.d_credit, -2, D_CAP);
        es.push(e);
        ds.push(d);
        if (detail)
          drivers.push(
            `credit: Δs ${v.ds_bps.toFixed(0)}bps × dur ${v.duration.toFixed(1)}y × net debt ${fmtB(o.netDebtUsd)} / mcap ${fmtB(o.mcapUsd)} → equity −${p(e)}; de-rating ${p(d)}`,
          );
      }
      if (rq.neo[j] > 0) {
        const rh = clamp(v.k * v.psi_supplier * rq.neo[j], 0, 1);
        const e = Math.min(rh * ol, E_CAP);
        rhs.push(rh);
        es.push(e);
        if (detail) drivers.push(`credit: stressed capex −${p(v.k)} × ψ ${v.psi_supplier.toFixed(2)} × neocloud ${p(rq.neo[j])} = revenue −${p(rh)} → EPS −${p(e)}`);
      }
    }

    const keepE = es.reduce((a, x) => a * (1 - x), 1);
    const keepD = ds.reduce((a, x) => a * (1 - x), 1);
    const e = 1 - keepE;
    const d = 1 - keepD;
    const moveDirect = keepE * keepD - 1;
    const rh = 1 - rhs.reduce((a, x) => a * (1 - x), 1);
    return { rh, rhCapex, e, d, moveDirect, moveSymp: 0, move: moveDirect, drivers };
  });

  // sympathy (guidance) and contagion (restatement at an origin)
  if (rp.comp.guidance && rp.guidanceTarget >= 0) {
    const tj = prep.origins[rp.guidanceTarget];
    const xT = log1pSafe(out[rp.guidanceTarget].moveDirect);
    prep.origins.forEach((o, k) => {
      if (k === rp.guidanceTarget) return;
      const beta = prep.peerOrigins?.[o.ticker]?.[tj.ticker];
      if (!isFiniteNum(beta)) {
        if (xT !== 0) warn(`peer beta ${o.ticker} on ${tj.ticker} missing: no sympathy move`);
        return;
      }
      const xs = (v.sympathy ?? 1) * beta * xT;
      out[k].moveSymp = expm1Safe(xs);
      if (detail && xs !== 0) out[k].drivers.push(`sympathy: ${(v.sympathy ?? 1).toFixed(2)} × β ${beta.toFixed(2)} × ln(1${pctSigned(out[rp.guidanceTarget].moveDirect)}) → ${pctSigned(out[k].moveSymp)}`);
    });
  }
  if (rp.comp.restatement && rp.restTarget?.kind === 'origin') {
    const t = rp.restTarget.idx;
    const mT = out[t].moveDirect;
    prep.origins.forEach((o, k) => {
      if (k === t || o.group !== prep.origins[t].group) return;
      out[k].moveSymp = clamp(rp.contagion * mT, -0.99, 10);
      if (detail && out[k].moveSymp !== 0)
        out[k].drivers.push(`contagion: ${rp.contagion.toFixed(3)} × ${prep.origins[t].ticker} move ${pctSigned(mT)} → ${pctSigned(out[k].moveSymp)}`);
    });
  }
  for (const oc of out) oc.move = (1 + oc.moveDirect) * (1 + oc.moveSymp) - 1;
  return { o: out, basket };
}

function fmtB(x: number | null): string {
  if (x === null) return '—';
  return `$${(x / 1e9).toFixed(1)}B`;
}

function pctSigned(x: number): string {
  const s = (x * 100).toFixed(1);
  return `${x >= 0 ? '+' : ''}${s}%`;
}
