// Confidence score per India stock (DESIGN §4.6).
//   score = 100·(0.5·min(R²/0.4, 1) + 0.5·(1 − assumption_share))·min(1, sqrt(n/250))
// assumption_share = |fundamental contributions resting on USER_ASSUMPTION/UNVERIFIED inputs| / total.
// Scenario/transmission parameters (shock sizes, ψ, φ, λ) are common to every stock and are not
// counted per stock; the restatement target's own shock is scenario input, also not counted.
import type { FundCore } from './layer3';
import type { PrepIndia } from './prepare';
import type { ResolvedQuantities } from './params';

export interface Confidence {
  score: number;
  grade: 'HIGH' | 'MED' | 'LOW';
  r2: number | null;
  assumption_share: number;
  n: number;
}

export function assumptionShare(t: PrepIndia, rq: ResolvedQuantities, fund: FundCore): number {
  const q = rq.india[t.idx];
  let tot = 0;
  let ass = 0;
  if (fund.modelled) {
    t.exposures.forEach((_, k) => {
      const m = Math.abs(fund.expContrib[k] ?? 0);
      tot += m;
      if (q.shareAssump[k] || q.olAssump) ass += m;
    });
    const mp = Math.abs(fund.dUnwind);
    tot += mp;
    if (fund.premFallback || fund.prem === null) ass += mp;
    const mf = Math.abs(fund.fxEps);
    tot += mf;
    if (q.fxAssump) ass += mf;
  }
  if (tot > 1e-9) return ass / tot;
  // count-based: share of this stock's provenance-bearing inputs that are assumptions
  const flags: boolean[] = [...q.shareAssump];
  if (t.exposures.length) flags.push(q.olAssump);
  if (t.qFx) flags.push(q.fxAssump);
  if (fund.prem !== null || fund.premFallback) flags.push(fund.premFallback);
  if (!flags.length) return 0;
  return flags.filter(Boolean).length / flags.length;
}

export function confidence(t: PrepIndia, share: number): Confidence {
  const r2 = t.hasReg ? t.r2 : null;
  const rPart = r2 !== null ? Math.min(Math.max(r2, 0) / 0.4, 1) : 0;
  const nPart = Math.min(1, Math.sqrt(Math.max(t.n, 0) / 250));
  const score = Math.round(100 * (0.5 * rPart + 0.5 * (1 - share)) * nPart);
  const grade: Confidence['grade'] = score >= 70 ? 'HIGH' : score >= 40 ? 'MED' : 'LOW';
  return { score, grade, r2, assumption_share: share, n: t.n };
}
