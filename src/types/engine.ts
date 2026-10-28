// Contract for the scenario engine (src/engine/index.ts). Pure, synchronous, browser + node.
import type { DataBundle, Preset, Status, Tier } from './data';

export type PresetId = Preset['id'];
export type Horizon = '1D' | '1M' | '12M';
export const HORIZON_DAYS: Record<Horizon, number> = { '1D': 1, '1M': 21, '12M': 252 };

export type Channel = 'parent' | 'revenue' | 'capex' | 'credit' | 'sentiment' | 'fx_fpi' | 'fx' | 'own';

export type ParamValue = number | string | boolean | null;

export interface ScenarioParams {
  preset: PresetId;
  horizon: Horizon;
  values: Record<string, ParamValue>; // keyed by ParamSpec.key
  /** User edits of USER_ASSUMPTION / UNVERIFIED quantities, keyed by Quantity.id. */
  overrides: Record<string, number>;
  /** When false, AI-premium unwind may be negative (re-rating up for stocks trading below pre-ChatGPT P/E). */
  premiumFloorZero: boolean;
}

export interface OriginResult {
  ticker: string;
  name: string;
  group: string;
  price0: number | null;
  pe0: number | null;
  eps0: number | null;
  revenue_hit: number; // fraction of revenue lost
  e: number; // EPS cut (fraction)
  d: number; // multiple de-rating (fraction)
  move_direct: number; // (1-e)(1-d)-1
  move_sympathy: number; // simple return from peer/contagion effects
  move: number; // total simple return
  price_after_eps: number | null; // PE0 x EPS0 x (1-e)
  price_new: number | null; // P0 x (1+move)
  pe_new: number | null;
  mcap_usd: number | null;
  mcap_change_usd: number | null; // signed
  mcap_change_inr_cr: number | null; // signed, INR crore
  drivers: string[]; // human-readable math, e.g. "capex: 0.30 x 0.506 x OL 1.00 = 15.2% revenue"
}

export interface FactorMoves {
  chip_basket: number; // simple
  ai_basket: number; // simple
  SOX: number; // simple
  NDX: number; // simple
  NIFTY: number; // simple (implied)
  inr_depr: number; // INR depreciation fraction (+ = weaker INR)
  tech_revenue_shock: number; // R_tech (fraction)
  capex_cut_usd: number | null;
  capex_absorbed_share: number | null;
  x: { SOX: number; NDX: number; NIFTY: number }; // log moves used in Layer 2
}

export interface IndiaResult {
  ticker: string;
  display: string;
  name: string;
  tier: Tier;
  dominant_channel: Channel;
  beta_total: number | null;
  beta_total_down: number | null;
  market_move: number; // simple, Layer 2
  market_contrib: { parent: number; sentiment: number; fx_fpi: number; own: number }; // log
  ear: number; // earnings at risk (positive = loss)
  ear_contrib: { revenue: number; capex: number; credit: number; own: number };
  d: number; // premium-unwind de-rating used
  fx_eps: number; // + = EPS benefit from weaker INR
  fundamental_gross: number | null; // null when not modelled (replay)
  fundamental_net: number | null;
  gap: number | null; // market_move - fundamental_net
  ai_premium: number | null;
  ai_premium_status: Status;
  ret_since_chatgpt_vs_bench: number | null;
  range: { p5: number; p50: number; p95: number } | null; // filled from MC when available
  mcap_inr_cr: number | null;
  mcap_change_inr_cr: number | null; // market_move x mcap (signed)
  channel_inr_cr: Partial<Record<Channel, number>>; // signed INR-crore contributions used for dominance + Sankey
  confidence: { score: number; grade: 'HIGH' | 'MED' | 'LOW'; r2: number | null; assumption_share: number; n: number };
  notes: string[];
}

export interface SankeyNode {
  id: string;
  label: string;
  kind: 'origin' | 'macro' | 'channel' | 'target';
}
export interface SankeyLink {
  source: string;
  target: string;
  value: number; // |INR crore|
  sign: 1 | -1; // -1 = loss, +1 = offset/benefit
}
export interface SankeyGraph {
  nodes: SankeyNode[];
  links: SankeyLink[];
}

export interface ScenarioResult {
  params: ScenarioParams;
  preset: Preset;
  origins: OriginResult[];
  factors: FactorMoves;
  india: IndiaResult[]; // sorted by market_move ascending (most negative first)
  sankey: { market: SankeyGraph; fundamental: SankeyGraph };
  totals: { india_mcap_change_inr_cr: number; origin_mcap_change_usd: number };
  lowConfidence: boolean;
  warnings: string[];
}

export interface Percentiles {
  p5: number;
  p50: number;
  p95: number;
}

export interface MCResult {
  runs: number;
  seed: number;
  horizon: Horizon;
  days: number;
  perStock: Record<string, { market: Percentiles; fundamental: Percentiles | null; mean: number }>;
  factors: { SOX: Percentiles; NDX: Percentiles; NIFTY: Percentiles };
  fan: { ticker: string; days: number[]; p5: number[]; p25: number[]; p50: number[]; p75: number[]; p95: number[] } | null;
}

export interface EngineAPI {
  defaultParams(bundle: DataBundle, preset: PresetId, horizon?: Horizon): ScenarioParams;
  runScenario(bundle: DataBundle, params: ScenarioParams): ScenarioResult;
  runMonteCarlo(
    bundle: DataBundle,
    params: ScenarioParams,
    opts?: { runs?: number; seed?: number; fanTicker?: string },
  ): MCResult;
  /** Merge MC percentiles into a scenario result (fills IndiaResult.range). */
  withRanges(result: ScenarioResult, mc: MCResult): ScenarioResult;
}
