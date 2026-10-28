// Engine-side helper types (additive; the contract types live in src/types/*.ts).
import type { ParamSpec, Quantity, Status } from '../types/data';

/** Effective value of a Quantity after user overrides. */
export interface EffectiveQuantity {
  id: string;
  quantity: Quantity | null;
  value: number | null;
  status: Status; // 'USER_ASSUMPTION' when the user overrode it
  overridden: boolean;
  /** True when the value rests on USER_ASSUMPTION / UNVERIFIED inputs (own status or any part). */
  assumption: boolean;
}

/** One step of a price waterfall (security page). */
export interface WaterfallStep {
  label: string;
  price: number | null;
  change: number; // simple change vs the previous step
  note: string;
}

export interface Waterfall {
  ticker: string;
  kind: 'origin' | 'india';
  currency: string;
  steps: WaterfallStep[];
  pe0: number | null;
  pe_new: number | null;
  eps0: number | null;
  eps_new: number | null;
  move: number;
  mcap_change_usd: number | null;
  mcap_change_inr_cr: number | null;
  drivers: string[];
}

/** A ParamSpec after horizon overrides, with resolved MC bounds. */
export type ResolvedParamSpec = ParamSpec;

/** Numeric + categorical parameters resolved for one evaluation (internal). */
export interface ResolvedParams {
  preset: string;
  horizon: '1D' | '1M' | '12M';
  /** Numeric parameters keyed by ParamSpec.key (fallbacks applied). */
  v: Record<string, number>;
  mode: 'median' | 'multiple';
  per_name: boolean;
  floor_zero: boolean;
  target_pe: number | null;
  f_override: number | null;
  guidanceTarget: number; // origin index or -1
  restTarget: { kind: 'origin' | 'india'; idx: number } | null;
  contagion: number;
  windowId: string | null;
  premiumFloorZero: boolean;
  comp: {
    capex: boolean;
    guidance: boolean;
    restatement: boolean;
    multiple: boolean;
    credit: boolean;
    replay: boolean;
  };
  warnings: string[];
}
