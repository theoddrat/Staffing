// Numeric core: Layer 1 → factors → Layer 2 + Layer 3 for every India target.
// `detail=false` is the Monte Carlo fast path (no driver strings).
import { factors, type FactorCore } from './factors';
import { layer1, type BasketPE, type OriginCore } from './layer1';
import { layer2, type MarketCore } from './layer2';
import { layer3, type FundCore } from './layer3';
import type { ResolvedQuantities } from './params';
import type { Prep } from './prepare';
import type { ResolvedParams } from './types-extra';
import { clamp } from './util';

export interface CoreOut {
  o: OriginCore[];
  basket: BasketPE;
  f: FactorCore;
  india: { m: MarketCore; fund: FundCore }[];
  restMoveIndia: number | null;
  warnings: string[];
}

export function evaluate(prep: Prep, rq: ResolvedQuantities, rp: ResolvedParams, detail: boolean): CoreOut {
  const warnings: string[] = [];
  const warn = detail ? (m: string) => warnings.push(m) : () => {};
  const { o, basket } = layer1(prep, rq, rp, detail, warn);
  const f = factors(prep, rq, rp, o, warn);
  let restMoveIndia: number | null = null;
  if (rp.comp.restatement && rp.restTarget?.kind === 'india') {
    restMoveIndia = (1 - clamp(rp.v.r, 0, 0.95)) * (1 - clamp(rp.v.d, -2, 0.99)) - 1;
  }
  const india = prep.india.map((t) => ({
    m: layer2(prep, t, rp, o, f, restMoveIndia),
    fund: layer3(prep, t, rq, rp, f),
  }));
  return { o, basket, f, india, restMoveIndia, warnings };
}
