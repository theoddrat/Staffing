// Monte Carlo (DESIGN §4.5): shock sizes sampled from triangular/uniform specs (never normal),
// residuals from a joint block bootstrap of India dates shared by every stock and the Nifty.
import type { DataBundle, ParamSpec } from '../types/data';
import type { MCResult, Percentiles, ScenarioParams, ScenarioResult } from '../types/engine';
import { HORIZON_DAYS } from '../types/engine';
import { evaluate } from './core';
import { clampValues, resolveParams, resolveQuantities } from './params';
import { prepare } from './prepare';
import { paramSpecs } from './presets';
import { Rng } from './rng';
import type { ResolvedParams } from './types-extra';
import { expm1Safe, isFiniteNum, percentiles } from './util';

export const DEFAULT_MC_RUNS = 5000;
export const DEFAULT_MC_SEED = 20221130;
const FAN_POINTS = 64;

interface SampleSpec {
  key: string;
  dist: 'triangular' | 'uniform';
  low: number;
  high: number;
}

/** Numeric params of the active preset that carry an MC distribution. */
export function sampleSpecs(bundle: DataBundle, params: ScenarioParams): SampleSpec[] {
  return paramSpecs(bundle, params.preset, params.horizon)
    .filter((s: ParamSpec) => s.kind === 'number' && s.mc && (s.mc.dist === 'triangular' || s.mc.dist === 'uniform'))
    .filter((s) => isFiniteNum(s.mc!.low) && isFiniteNum(s.mc!.high))
    .map((s) => ({ key: s.key, dist: s.mc!.dist as 'triangular' | 'uniform', low: s.mc!.low as number, high: s.mc!.high as number }));
}

function sample(rp0: ResolvedParams, specs: SampleSpec[], rng: Rng): ResolvedParams {
  const v = { ...rp0.v };
  let target_pe = rp0.target_pe;
  let f_override = rp0.f_override;
  let contagion = rp0.contagion;
  for (const s of specs) {
    let base: number | null = isFiniteNum(v[s.key]) ? v[s.key] : null;
    if (s.key === 'target_pe') base = rp0.target_pe;
    if (s.key === 'f_override') base = rp0.f_override;
    if (s.key === 'contagion') base = rp0.contagion;
    if (base === null) continue; // e.g. f_override = auto: keep auto
    const lo = Math.min(s.low, base);
    const hi = Math.max(s.high, base);
    const x = s.dist === 'uniform' ? rng.uniform(lo, hi) : rng.triangular(lo, base, hi);
    if (s.key === 'target_pe') target_pe = x > 0 ? x : target_pe;
    else if (s.key === 'f_override') f_override = x;
    else if (s.key === 'contagion') contagion = x;
    else v[s.key] = x;
  }
  clampValues(v);
  return { ...rp0, v, target_pe, f_override, contagion };
}

function pct(a: Float64Array): Percentiles {
  const q = percentiles(a);
  return { p5: q.p5, p50: q.p50, p95: q.p95 };
}

export function runMonteCarlo(
  bundle: DataBundle,
  params: ScenarioParams,
  opts: { runs?: number; seed?: number; fanTicker?: string } = {},
): MCResult {
  const runs = Math.max(1, Math.floor(opts.runs ?? DEFAULT_MC_RUNS));
  const seed = (opts.seed ?? DEFAULT_MC_SEED) >>> 0;
  const prep = prepare(bundle);
  const rp0 = resolveParams(prep, params);
  const rq = resolveQuantities(prep, params.overrides);
  const h = HORIZON_DAYS[params.horizon] ?? 21;
  const specs = sampleSpecs(bundle, params);
  const rng = new Rng(seed);

  const nI = prep.india.length;
  const R = prep.residLen;
  const B = h >= 5 ? 5 : 1;
  const idx = new Int32Array(h);
  const mkt = Array.from({ length: nI }, () => new Float64Array(runs));
  const fundOn = !rp0.comp.replay;
  const fund = fundOn ? Array.from({ length: nI }, () => new Float64Array(runs)) : null;
  const sox = new Float64Array(runs);
  const ndx = new Float64Array(runs);
  const nifty = new Float64Array(runs);

  // fan chart set-up
  const fanIdx = opts.fanTicker !== undefined ? prep.indiaIdx.get(opts.fanTicker) ?? -1 : -1;
  const cps: number[] = [];
  if (fanIdx >= 0) {
    if (h <= FAN_POINTS) for (let t = 0; t <= h; t++) cps.push(t);
    else for (let k = 0; k <= FAN_POINTS; k++) cps.push(Math.round((k * h) / FAN_POINTS));
  }
  const fanVals = cps.map(() => new Float64Array(runs));
  const cpPos = new Int32Array(h + 1).fill(-1);
  cps.forEach((d, k) => {
    cpPos[d] = k;
  });

  const niftyRes = prep.niftyResid;
  const niftyNN = prep.niftyNonNull;

  for (let r = 0; r < runs; r++) {
    const rp = specs.length ? sample(rp0, specs, rng) : rp0;
    const core = evaluate(prep, rq, rp, false);

    // joint circular block bootstrap of residual dates (shared by every stock and the Nifty);
    // circular blocks give every date the same inclusion probability, so the sum stays centred
    if (R > 0) {
      let filled = 0;
      while (filled < h) {
        const start = rng.int(R);
        for (let q = 0; q < B && filled < h; q++) idx[filled++] = (start + q) % R;
      }
    }

    let sN = 0;
    if (R > 0 && niftyNN.length > 0) {
      for (let t = 0; t < h; t++) {
        let x = niftyRes[idx[t]];
        if (x !== x) x = niftyRes[niftyNN[rng.int(niftyNN.length)]];
        sN += x;
      }
    }

    for (let i = 0; i < nI; i++) {
      const t = prep.india[i];
      const res = t.resid;
      const nn = t.nonNull;
      const det = core.india[i].m.logMove;
      let s = 0;
      if (R > 0 && nn.length > 0) {
        if (i === fanIdx) {
          fanVals[0][r] = 0;
          for (let d = 0; d < h; d++) {
            let x = res[idx[d]];
            if (x !== x) x = res[nn[rng.int(nn.length)]];
            s += x;
            const k = cpPos[d + 1];
            if (k >= 0) fanVals[k][r] = expm1Safe(((d + 1) / h) * det + s);
          }
        } else {
          for (let d = 0; d < h; d++) {
            let x = res[idx[d]];
            if (x !== x) x = res[nn[rng.int(nn.length)]];
            s += x;
          }
        }
      } else if (i === fanIdx) {
        for (let k = 0; k < cps.length; k++) fanVals[k][r] = expm1Safe((cps[k] / h) * det);
      }
      mkt[i][r] = expm1Safe(det + s);
      if (fund) fund[i][r] = core.india[i].fund.net ?? 0;
    }
    sox[r] = expm1Safe(core.f.xSOX);
    ndx[r] = expm1Safe(core.f.xNDX);
    nifty[r] = expm1Safe(core.f.xN + sN);
  }

  const perStock: MCResult['perStock'] = {};
  prep.india.forEach((t, i) => {
    const q = percentiles(mkt[i]);
    perStock[t.ticker] = {
      market: { p5: q.p5, p50: q.p50, p95: q.p95 },
      fundamental: fund ? pct(fund[i]) : null,
      mean: q.mean,
    };
  });

  let fan: MCResult['fan'] = null;
  if (fanIdx >= 0) {
    const p5: number[] = [];
    const p25: number[] = [];
    const p50: number[] = [];
    const p75: number[] = [];
    const p95: number[] = [];
    fanVals.forEach((a) => {
      const q = percentiles(a);
      p5.push(q.p5);
      p25.push(q.p25);
      p50.push(q.p50);
      p75.push(q.p75);
      p95.push(q.p95);
    });
    fan = { ticker: prep.india[fanIdx].ticker, days: cps, p5, p25, p50, p75, p95 };
  }

  return {
    runs,
    seed,
    horizon: params.horizon,
    days: h,
    perStock,
    factors: { SOX: pct(sox), NDX: pct(ndx), NIFTY: pct(nifty) },
    fan,
  };
}

/** Merge MC percentiles into a scenario result (fills IndiaResult.range). Pure. */
export function withRanges(result: ScenarioResult, mc: MCResult): ScenarioResult {
  return {
    ...result,
    india: result.india.map((r) => {
      const s = mc.perStock[r.ticker];
      return s ? { ...r, range: { ...s.market } } : r;
    }),
  };
}
