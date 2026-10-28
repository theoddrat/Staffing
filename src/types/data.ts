// Contract for public/data.json (written by build_data.py, read by the engine and UI).
// Python emits snake_case keys exactly as below. Unknown values are `null` (never NaN/Infinity).
// See docs/DESIGN.md for the math behind every field.

export type Status = 'SOURCED' | 'UNVERIFIED' | 'USER_ASSUMPTION' | 'COMPUTED' | 'DERIVED';
export type Tier = 'A' | 'B' | 'C' | 'D';
export type OriginGroup = 'chips' | 'hyperscalers' | 'infra' | 'software';
export type Market = 'US' | 'IN' | 'JP' | 'DE' | 'CH' | 'FR' | 'TW' | 'NL' | 'FX' | 'OTHER';
export type CrashType =
  | 'earnings_collapse'
  | 'multiple_compression'
  | 'fraud_trust'
  | 'credit_liquidity'
  | 'capex_overbuild';

/** A citation. Every SOURCED / UNVERIFIED number points at one or more of these by id. */
export interface Source {
  id: string;
  title: string;
  publisher: string | null;
  url: string;
  date: string | null; // publication or as-of date of the document
  quote: string | null; // verbatim excerpt supporting the figure
  verification: 'PRIMARY' | 'SECONDARY' | 'UNVERIFIED';
  accessed: string; // ISO date the source was read
  note: string | null;
}

/** One multiplicative component of a Quantity. */
export interface Part {
  label: string;
  value: number;
  status: Exclude<Status, 'DERIVED'>;
  src: string[]; // source ids ([] for USER_ASSUMPTION / COMPUTED)
  note: string | null;
}

/** A number with provenance. value = product of parts when parts are present. */
export interface Quantity {
  id: string; // stable, e.g. "NVDA.hyperscaler_share"
  label: string;
  value: number | null;
  unit: string; // 'frac' | 'x' | 'bps' | 'usd' | 'inr' | 'days' | 'yrs' | ...
  status: Status; // effective status (worst part)
  parts: Part[];
  src: string[];
  note: string | null;
  editable: boolean; // UI may expose as a slider (USER_ASSUMPTION / UNVERIFIED)
  min: number | null;
  max: number | null;
  step: number | null;
}

export interface Coef {
  b: number;
  se: number; // OLS standard error
  t: number; // HAC (Newey-West, 5 lags) t-stat
  p: number; // HAC p-value
}

export interface RegressionResult {
  spec: string; // human-readable formula
  n: number;
  start: string;
  end: string;
  coef: Record<string, Coef>; // keys: 'const', 'SOX', 'NDX', 'PARENT', 'NIFTY'
  r2: number;
  adj_r2: number;
  resid_sd: number;
}

export interface TickerLogEntry {
  requested: string;
  resolved: string | null;
  action: 'ok' | 'fixed' | 'dropped' | 'warning';
  note: string;
}

export interface Security {
  ticker: string;
  name: string;
  role: 'origin' | 'india' | 'parent' | 'factor' | 'benchmark' | 'adr' | 'history' | 'fx';
  market: Market;
  currency: string;
  last_close: number | null;
  last_date: string | null;
  chg_1d: number | null; // simple return of the last session
  first_date: string | null;
  shares: number | null;
  mcap_local: number | null;
  mcap_usd: number | null;
  mcap_inr: number | null;
  pe_ttm: number | null;
  eps_ttm: number | null;
  pe_basis: 'calendar_reported' | 'yahoo_trailing' | null;
  pe_pre_chatgpt_median: number | null;
  pe_pre_chatgpt_n: number | null; // valid daily observations in the pre-ChatGPT window
  ai_premium: number | null;
  ret_since_chatgpt: number | null;
  ret_since_chatgpt_vs_bench: number | null;
  bench: string | null; // benchmark ticker used for the line above
  revenue_ttm: number | null; // local currency
  ebit_margin: number | null;
  gross_margin: number | null;
  op_leverage: Quantity;
  data_ok: boolean;
  notes: string[];
}

export interface OriginInfo {
  ticker: string;
  group: OriginGroup;
  in_chip_basket: boolean;
  in_ai_basket: boolean;
  weight_chip_basket: number; // latest-mcap weight within chips (0 if not a chip)
  weight_ai_basket: number; // latest-mcap weight within all origins
  hyperscaler_share: Quantity; // share of revenue tied to hyperscaler capex (capex channel)
  neocloud_share: Quantity; // share tied to AI-cloud / neocloud capex (credit channel)
  capex_ttm_usd: number | null; // hyperscalers: TTM capex (abs), USD
  capex_quarters: { period: string; value_usd: number }[];
  credit: {
    stressed: boolean; // participates as a stressed borrower in shock 5
    net_debt_usd: number | null;
    ebitda_ttm_usd: number | null;
    nd_ebitda: number | null;
  };
  concentration: { text: string; status: Status; src: string[] }[]; // 10-K style disclosures
}

export interface Exposure {
  channel: 'revenue' | 'capex' | 'credit';
  share: Quantity; // exposed revenue share (fraction)
  driver: string | null; // e.g. 'US tech client IT budgets', 'hyperscaler data-centre orders'
}

export interface Rolling {
  dates: string[];
  SOX: (number | null)[];
  NDX: (number | null)[];
  PARENT: (number | null)[] | null;
  NIFTY: (number | null)[];
  r2: (number | null)[];
}

export interface IndiaTarget {
  ticker: string; // ticker used for prices/regressions (e.g. MOSCHIP.BO)
  display: string; // short display symbol, e.g. "MOSCHIP"
  name: string;
  tier: Tier;
  parent: string | null;
  parent_secondary: string | null;
  parent_stake: Quantity | null;
  adr: string | null;
  exposures: Exposure[];
  fx_margin_sens_bps: Quantity; // EBIT-margin bps per 1% INR depreciation (+ = benefit)
  reg: RegressionResult | null;
  reg_down: RegressionResult | null;
  slopes: {
    ndx_on_sox: number | null;
    parent_on_sox: number | null;
    ndx_on_sox_down: number | null;
    parent_on_sox_down: number | null;
  };
  beta_total: number | null;
  beta_total_down: number | null;
  rolling: Rolling | null;
  resid: (number | null)[]; // aligned to bundle.resid_dates
  short_history: boolean; // < 3y of data in the window
  notes: string[];
}

export interface HeatCell {
  beta: number | null;
  t: number | null;
  corr: number | null;
}

export interface FxEpisode {
  id: string;
  label: string;
  start: string;
  end: string;
  inr_depr: number | null; // + = INR weaker (log change of USDINR)
  ndx: number | null; // log move
  sox: number | null;
  nifty: number | null;
}

export interface ParamSpec {
  key: string;
  label: string;
  kind: 'number' | 'ticker' | 'enum' | 'bool' | 'window';
  value: number | string | boolean | null;
  min: number | null;
  max: number | null;
  step: number | null;
  unit: string | null; // 'frac' | 'bps' | 'yrs' | 'x' ...
  options: string[] | null; // enum / ticker / window choices
  status: Status;
  src: string[];
  note: string | null;
  mc: { dist: 'triangular' | 'uniform' | 'fixed'; low: number | null; high: number | null } | null;
}

export interface Preset {
  id: 'capex' | 'guidance' | 'restatement' | 'multiple' | 'credit' | 'replay' | 'fullpop';
  num: number; // 1..7
  label: string;
  description: string;
  low_confidence: boolean;
  params: ParamSpec[];
  /** fullpop only: per-horizon overrides of param values (key -> value) and MC bounds. */
  horizon_overrides: Partial<Record<'1D' | '1M' | '12M', Record<string, { value: number | string | boolean | null; low?: number | null; high?: number | null }>>> | null;
}

export interface ReplayWindow {
  id: string;
  label: string;
  start: string; // close-to-close from this date's close...
  end: string; // ...to this date's close
  moves: Record<string, number | null>; // log moves: SOX, NDX, SPX, IXIC, NIFTY, SENSEX, NIFTYIT
  status: Status;
  src: string[];
  note: string | null;
}

export interface Drawdown {
  label: string; // ticker or series label
  ticker: string | null;
  peak_date: string | null;
  peak: number | null;
  trough_date: string | null;
  trough: number | null;
  drawdown: number | null; // simple, negative
  days_to_bottom: number | null; // trading days
  days_to_recover: number | null; // trading days from trough to regain peak (null = not recovered)
  recovered_date: string | null;
  status: Status;
  src: string[];
  note: string | null;
}

export interface HistoryCase {
  id: string;
  name: string;
  period: string;
  what_broke: string;
  crash_types: CrashType[];
  drawdowns: Drawdown[];
  linked: string;
  india: string;
  src: string[];
  notes: string[];
}

export interface EventMember {
  ticker: string;
  label: string;
  tier: Tier | null;
  car: (number | null)[]; // index 0 = day -5 ... index 65 = day +60
  ar0: number | null; // abnormal return on day 0
  ar1: number | null; // abnormal return on day +1
  car_end: number | null; // CAR at the last available day
  method: 'market_model' | 'market_adjusted';
}

export interface EventStudy {
  id: string;
  label: string;
  date: string;
  crash_types: CrashType[];
  window: [number, number]; // [-5, 60]
  groups: { name: string; index: string; members: EventMember[]; mean_car: (number | null)[] }[];
  src: string[];
  note: string | null;
}

export interface UsVsIndiaPoint {
  date: string; // India date t
  us_date: string | null;
  event: string | null; // named event id, or null for worst-5% day
  x_sox: number; // aligned SOX log return
  ticker: string;
  tier: Tier;
  r: number; // India stock log return on t
}

export interface PeDrawdownPoint {
  id: string;
  label: string;
  market: string;
  peak_date: string | null;
  pe: number;
  pe_kind: 'CAPE' | 'trailing';
  pe_status: Status;
  drawdown: number; // negative
  drawdown_status: Status;
  src: string[];
  note: string | null;
}

export interface OverlaySeries {
  label: string;
  ticker: string;
  peak_date: string;
  t: number[]; // trading days relative to peak
  v: number[]; // indexed to 100 at peak
}

export interface DataBundle {
  meta: {
    app: string; // 'AI CRASH MONITOR'
    schema_version: number;
    built_at: string; // ISO datetime
    as_of: string; // last India trading date used
    as_of_us: string; // last US trading date used
    usd_inr: number;
    fx_rates_usd: Record<string, number>; // currency -> USD per 1 unit
    regression_window: { start: string; end: string; years: number; n_india_days: number };
    pre_chatgpt: { date: string; window_start: string; window_end: string; src: string[] };
    data_sources: { name: string; url: string; note: string }[];
    ticker_log: TickerLogEntry[];
    warnings: string[];
    alignment: { rule: string; us_holiday_zero_days: number; india_holiday_accumulations: number };
  };
  settings: Record<string, number | string | boolean>;
  sources: Source[];
  securities: Record<string, Security>; // every ticker with price data (keyed by ticker)
  tape: string[]; // ticker order for the ticker tape
  origins: OriginInfo[];
  india: IndiaTarget[];
  benchmarks: { nifty: string; nifty_it: string; adrs: string[] };
  nifty_model: RegressionResult;
  nifty_resid: (number | null)[]; // aligned to resid_dates
  resid_dates: string[];
  factor_map: {
    sox_on_chip_basket: { beta: number; r2: number; n: number };
    ndx_on_ai_basket: { beta: number; r2: number; n: number };
    ndx_on_sox: { beta: number; r2: number; n: number }; // aligned-window slope used for beta_total
  };
  parent_maps: Record<string, { SOX: number; NDX: number; r2: number; n: number; method: string }>;
  peer_beta: {
    origins: Record<string, Record<string, number>>; // peer_beta.origins[k][j] = beta of k on j
    india: Record<string, Record<string, number>>;
  };
  heatmap: { targets: string[]; origins: string[]; cells: HeatCell[][] }; // cells[targetIdx][originIdx]
  fx: {
    spot: number;
    spot_date: string;
    beta_inr_on_ndx: number; // log USDINR change per unit log NDX move (Dimson 0+1); negative expected
    beta_inr_on_ndx_down: number | null;
    r2: number;
    n: number;
    episodes: FxEpisode[];
    default_f: Quantity; // median episode depreciation (COMPUTED)
  };
  calibration: {
    contagion_us: Quantity; // SMCI 2024-10-30
    contagion_india: Quantity; // Satyam 2009-01-07
    tier_median_premium: Record<Tier, number | null>;
  };
  assumptions: Quantity[]; // global model assumptions (psi, phi, kappa defaults, tier FX sens ...)
  presets: Preset[];
  history: {
    cases: HistoryCase[];
    event_studies: EventStudy[];
    us_vs_india: UsVsIndiaPoint[];
    pe_vs_drawdown: PeDrawdownPoint[];
    pe_fit: { slope: number; intercept: number; r2: number; n: number };
    ai_basket_pe: { now: number | null; pre_chatgpt_median: number | null; implied_drawdown: number | null };
    overlay: OverlaySeries[];
    worst_windows: Record<'SOX' | 'NDX', { d1: number; d1_date: string; d21: number; d21_end: string; d252: number; d252_end: string }>;
    replay_windows: ReplayWindow[];
    deepseek_next_day: { ticker: string; tier: Tier | null; r_jan27: number | null; r_jan28: number | null; ar_jan28: number | null }[];
  };
}
