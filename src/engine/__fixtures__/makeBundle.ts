// SYNTHETIC DataBundle for engine unit tests ONLY. Every number here is made up for testing the
// math; nothing in this file is market data, and the UI must never import it.
import type {
  DataBundle,
  IndiaTarget,
  OriginInfo,
  ParamSpec,
  Preset,
  Quantity,
  RegressionResult,
  Security,
  Status,
  Tier,
} from '../../types/data';
import { Rng } from '../rng';

export function q(id: string, value: number | null, status: Status = 'SOURCED', unit = 'frac', parts: Quantity['parts'] = []): Quantity {
  return {
    id,
    label: id,
    value,
    unit,
    status,
    parts,
    src: status === 'SOURCED' || status === 'UNVERIFIED' ? ['fixture_src'] : [],
    note: 'synthetic fixture',
    editable: status === 'USER_ASSUMPTION' || status === 'UNVERIFIED',
    min: 0,
    max: unit === 'bps' ? 100 : unit === 'x' ? 10 : 1,
    step: unit === 'bps' ? 1 : 0.01,
  };
}

function sec(ticker: string, o: Partial<Security> & { name?: string }): Security {
  return {
    ticker,
    name: o.name ?? ticker,
    role: o.role ?? 'origin',
    market: o.market ?? 'US',
    currency: o.currency ?? 'USD',
    last_close: o.last_close ?? 100,
    last_date: '2026-10-27',
    chg_1d: 0.01,
    first_date: '2015-01-02',
    shares: null,
    mcap_local: o.mcap_local ?? o.mcap_usd ?? null,
    mcap_usd: o.mcap_usd ?? null,
    mcap_inr: o.mcap_inr ?? null,
    pe_ttm: o.pe_ttm ?? null,
    eps_ttm: o.eps_ttm ?? null,
    pe_basis: o.pe_ttm ? 'calendar_reported' : null,
    pe_pre_chatgpt_median: o.pe_pre_chatgpt_median ?? null,
    pe_pre_chatgpt_n: o.pe_pre_chatgpt_median ? 700 : null,
    ai_premium: o.ai_premium ?? null,
    ret_since_chatgpt: 0.5,
    ret_since_chatgpt_vs_bench: o.ret_since_chatgpt_vs_bench ?? 0.1,
    bench: null,
    revenue_ttm: o.revenue_ttm ?? null,
    financial_currency: o.financial_currency ?? o.currency ?? 'USD',
    ...(o.revenue_ttm_usd !== undefined ? { revenue_ttm_usd: o.revenue_ttm_usd } : {}),
    ebit_margin: o.ebit_margin ?? null,
    gross_margin: null,
    op_leverage: o.op_leverage ?? q(`${ticker}.op_leverage`, 1.5, 'COMPUTED', 'x'),
    data_ok: true,
    notes: [],
  };
}

function reg(coef: Record<string, number>, r2: number, n = 740): RegressionResult {
  const c: RegressionResult['coef'] = { const: { b: 0, se: 0.001, t: 0, p: 1 } };
  for (const [k, b] of Object.entries(coef)) c[k] = { b, se: 0.02, t: b / 0.02, p: 0.05 };
  return { spec: 'synthetic', n, start: '2023-10-27', end: '2026-10-27', coef: c, r2, adj_r2: r2, resid_sd: 0.015 };
}

interface OriginSpec {
  ticker: string;
  group: OriginInfo['group'];
  price: number;
  pe: number | null;
  pePre: number | null;
  mcap: number;
  rev: number;
  ol: number;
  s: Quantity;
  neo: Quantity;
  capex?: number;
  stressed?: boolean;
  netDebt?: number;
}

const ORIGINS: OriginSpec[] = [
  { ticker: 'NVDA', group: 'chips', price: 200, pe: 40, pePre: 50, mcap: 5e12, rev: 300e9, ol: 1.2, s: q('NVDA.hyperscaler_share', 0.5), neo: q('NVDA.neocloud_share', 0.2, 'USER_ASSUMPTION') },
  {
    ticker: 'AMD',
    group: 'chips',
    price: 500,
    pe: 80,
    pePre: 40,
    mcap: 0.9e12,
    rev: 40e9,
    ol: 2.0,
    s: q('AMD.hyperscaler_share', 0.29, 'USER_ASSUMPTION', 'frac', [
      { label: 'DC share', value: 0.58, status: 'SOURCED', src: ['fixture_src'], note: null },
      { label: 'hyperscaler fraction', value: 0.5, status: 'USER_ASSUMPTION', src: [], note: null },
    ]),
    neo: q('AMD.neocloud_share', 0.1, 'USER_ASSUMPTION'),
  },
  { ticker: 'MSFT', group: 'hyperscalers', price: 500, pe: 35, pePre: 30, mcap: 4e12, rev: 300e9, ol: 1.3, s: q('MSFT.hyperscaler_share', 0), neo: q('MSFT.neocloud_share', 0), capex: 300e9 },
  { ticker: 'ORCL', group: 'hyperscalers', price: 130, pe: 25, pePre: 18, mcap: 0.37e12, rev: 60e9, ol: 1.5, s: q('ORCL.hyperscaler_share', 0), neo: q('ORCL.neocloud_share', 0), capex: 100e9, stressed: true, netDebt: 130e9 },
  { ticker: 'CRWV', group: 'infra', price: 60, pe: null, pePre: null, mcap: 30e9, rev: 6e9, ol: 3.0, s: q('CRWV.hyperscaler_share', 0.67), neo: q('CRWV.neocloud_share', 0), stressed: true, netDebt: 46e9 },
  { ticker: 'VRT', group: 'infra', price: 200, pe: 45, pePre: 25, mcap: 80e9, rev: 10e9, ol: 1.6, s: q('VRT.hyperscaler_share', 0.75, 'UNVERIFIED'), neo: q('VRT.neocloud_share', 0.1, 'USER_ASSUMPTION') },
  { ticker: 'ADBE', group: 'software', price: 250, pe: 20, pePre: 40, mcap: 0.1e12, rev: 24e9, ol: 1.2, s: q('ADBE.hyperscaler_share', 0), neo: q('ADBE.neocloud_share', 0) },
];

interface IndiaSpec {
  ticker: string;
  tier: Tier;
  parent?: string;
  coef: Record<string, number>;
  r2: number;
  n?: number;
  exposures: IndiaTarget['exposures'];
  fx: Quantity;
  ebit: number | null;
  prem: number | null;
  mcapInr: number;
  price: number;
  pe: number | null;
  load: number; // loading on the common residual factor
  leadingNulls?: number;
  short?: boolean;
}

const INDIA: IndiaSpec[] = [
  {
    ticker: 'OFSS.NS', tier: 'A', parent: 'ORCL', coef: { SOX: 0.05, NDX: 0.05, PARENT: 0.2, NIFTY: 0.8 }, r2: 0.3,
    exposures: [], fx: q('OFSS.NS.fx_margin_sens_bps', 30, 'USER_ASSUMPTION', 'bps'), ebit: 0.45, prem: 0.3, mcapInr: 8.7e11, price: 9986, pe: 30, load: 1,
  },
  {
    ticker: 'POWERINDIA.NS', tier: 'A', parent: '6501.T', coef: { SOX: 0.1, NDX: 0.05, PARENT: 0.15, NIFTY: 1.1 }, r2: 0.35,
    exposures: [{ channel: 'capex', share: q('POWERINDIA.NS.exposure.capex', 0.1, 'USER_ASSUMPTION'), driver: 'data-centre orders' }],
    fx: q('POWERINDIA.NS.fx_margin_sens_bps', 0, 'USER_ASSUMPTION', 'bps'), ebit: 0.15, prem: 1.5, mcapInr: 1.27e12, price: 28435, pe: 150, load: 1,
  },
  {
    ticker: 'INFY.NS', tier: 'B', coef: { SOX: 0.05, NDX: 0.15, NIFTY: 0.9 }, r2: 0.4,
    exposures: [{ channel: 'revenue', share: q('INFY.NS.exposure.revenue', 0.068), driver: 'US tech client IT budgets' }],
    fx: q('INFY.NS.fx_margin_sens_bps', 30, 'SOURCED', 'bps'), ebit: 0.21, prem: -0.3, mcapInr: 4.66e12, price: 1123, pe: 17, load: 1,
  },
  {
    ticker: 'TCS.NS', tier: 'B', coef: { SOX: 0.04, NDX: 0.12, NIFTY: 0.85 }, r2: 0.38,
    exposures: [{ channel: 'revenue', share: q('TCS.NS.exposure.revenue', 0.086, 'UNVERIFIED'), driver: 'US tech client IT budgets' }],
    fx: q('TCS.NS.fx_margin_sens_bps', 30, 'SOURCED', 'bps'), ebit: 0.24, prem: -0.2, mcapInr: 8.9e12, price: 2460, pe: 18, load: 1,
  },
  {
    ticker: 'NETWEB.NS', tier: 'C', coef: { SOX: 0.3, NDX: 0.1, NIFTY: 1.2 }, r2: 0.25, n: 700,
    exposures: [{ channel: 'capex', share: q('NETWEB.NS.exposure.capex', 0.584), driver: 'AI systems' }],
    fx: q('NETWEB.NS.fx_margin_sens_bps', 0, 'USER_ASSUMPTION', 'bps'), ebit: 0.12, prem: null, mcapInr: 2.5e11, price: 4403, pe: 60, load: 0.5, leadingNulls: 40,
  },
  {
    ticker: 'STLTECH.NS', tier: 'C', coef: { SOX: 0.25, NDX: 0.1, NIFTY: 1.3 }, r2: 0.3,
    exposures: [{ channel: 'capex', share: q('STLTECH.NS.exposure.capex', 0.21), driver: 'hyperscaler optical orders' }],
    fx: q('STLTECH.NS.fx_margin_sens_bps', 0, 'USER_ASSUMPTION', 'bps'), ebit: 0.08, prem: 2.0, mcapInr: 4.3e11, price: 879, pe: 90, load: 0.5,
  },
  {
    ticker: 'KAYNES.NS', tier: 'D', coef: { SOX: 0.2, NDX: 0.15, NIFTY: 1.4 }, r2: 0.3, n: 120, short: true,
    exposures: [], fx: q('KAYNES.NS.fx_margin_sens_bps', 0, 'USER_ASSUMPTION', 'bps'), ebit: 0.13, prem: null, mcapInr: 2.1e11, price: 3140, pe: 110, load: 0, leadingNulls: 180,
  },
];

function num(key: string, value: number, low: number | null, high: number | null, status: Status = 'USER_ASSUMPTION', dist: 'triangular' | 'uniform' | 'fixed' = 'triangular'): ParamSpec {
  return {
    key,
    label: key,
    kind: 'number',
    value,
    min: -1,
    max: key === 'ds_bps' ? 2000 : key === 'duration' ? 15 : key === 'target_pe' ? 100 : 1,
    step: 0.01,
    unit: key === 'ds_bps' ? 'bps' : key === 'duration' ? 'yrs' : 'frac',
    options: null,
    status,
    src: [],
    note: null,
    mc: low !== null && high !== null ? { dist, low, high } : null,
  };
}

function other(key: string, kind: ParamSpec['kind'], value: ParamSpec['value'], options: string[] | null = null): ParamSpec {
  return { key, label: key, kind, value, min: null, max: null, step: null, unit: null, options, status: 'USER_ASSUMPTION', src: [], note: null, mc: null };
}

const common = () => [
  num('lambda_india', 0, 0, 0.2),
  num('phi_it', 1, 0.5, 1.5),
  num('psi_india_dc', 0.5, 0.25, 1),
  other('f_override', 'number', null),
];

export function fixturePresets(): Preset[] {
  return [
    { id: 'capex', num: 1, label: 'Hyperscaler capex cut', description: 'synthetic', low_confidence: false, horizon_overrides: null,
      params: [num('c', 0.3, 0.15, 0.5), num('psi_supplier', 1, 0.8, 1), num('kappa', 0, 0, 0.5), ...common()] },
    { id: 'guidance', num: 2, label: 'Chip guidance cut', description: 'synthetic', low_confidence: false, horizon_overrides: null,
      params: [other('target', 'ticker', 'AMD'), num('g', 0.2, 0.1, 0.35), num('kappa', 0.5, 0.25, 0.75), num('sympathy', 1, 0.5, 1.2), ...common()] },
    { id: 'restatement', num: 3, label: 'Accounting restatement', description: 'synthetic', low_confidence: false, horizon_overrides: null,
      params: [other('target', 'ticker', 'CRWV'), num('r', 0.3, 0.1, 0.5), num('d', 0.25, 0.1, 0.4), other('contagion', 'number', null), num('lambda_india', 0, null, null)] },
    { id: 'multiple', num: 4, label: 'Multiple compression', description: 'synthetic', low_confidence: false, horizon_overrides: null,
      params: [other('mode', 'enum', 'median', ['median', 'multiple', 'calibrated']), num('lambda', 0.5, 0.25, 0.8), num('target_pe', 25, null, null), other('per_name', 'bool', false), other('floor_zero', 'bool', true), num('lambda_india', 0.5, 0.25, 0.8), other('f_override', 'number', null)] },
    { id: 'credit', num: 5, label: 'AI credit event', description: 'synthetic', low_confidence: true, horizon_overrides: null,
      params: [num('ds_bps', 400, 200, 800), num('duration', 5, 3, 7), num('k', 0.3, 0.1, 0.5), num('d_credit', 0.15, 0.05, 0.3), num('psi_supplier', 1, 0.8, 1), ...common()] },
    { id: 'replay', num: 6, label: 'Historical replay', description: 'synthetic', low_confidence: false, horizon_overrides: null,
      params: [other('window', 'window', 'DEEPSEEK', ['DOTCOM', 'DEEPSEEK']), other('f_override', 'number', null)] },
    { id: 'fullpop', num: 7, label: 'Full bubble pop', description: 'synthetic', low_confidence: true,
      params: [
        num('c', 0.35, 0.2, 0.5), num('psi_supplier', 1, 0.8, 1), num('psi_india_dc', 0.5, 0.25, 1), num('phi_it', 1, 0.5, 1.5),
        other('mode', 'enum', 'median', ['median', 'multiple', 'calibrated']), num('lambda', 0.6, 0.4, 0.8), num('target_pe', 25, null, null), other('per_name', 'bool', false), other('floor_zero', 'bool', true),
        num('ds_bps', 500, 300, 800), num('duration', 5, 3, 7), num('k', 0.35, 0.2, 0.5), num('d_credit', 0.2, 0.1, 0.3),
        num('lambda_india', 0.5, 0.3, 0.7), other('f_override', 'number', null),
      ],
      horizon_overrides: {
        '1D': { c: { value: 0.1, low: 0.05, high: 0.15 }, lambda: { value: 0.1, low: 0.05, high: 0.2 }, ds_bps: { value: 150 }, k: { value: 0.1 }, d_credit: { value: 0.05 }, lambda_india: { value: 0.05 } },
        '1M': { c: { value: 0.2 }, lambda: { value: 0.3 }, ds_bps: { value: 300 }, k: { value: 0.2 }, d_credit: { value: 0.1 }, lambda_india: { value: 0.25 } },
        '12M': { c: { value: 0.35 }, lambda: { value: 0.6 }, ds_bps: { value: 500 }, k: { value: 0.35 }, d_credit: { value: 0.2 }, lambda_india: { value: 0.5 } },
      },
    },
  ];
}

/** Box–Muller normal from the engine RNG (fixture data generation only). */
function normal(rng: Rng): number {
  const u = Math.max(rng.next(), 1e-12);
  const v = rng.next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export interface FixtureOpts {
  residDays?: number;
  seed?: number;
  /** Extra synthetic India targets (for performance tests). */
  extraIndia?: number;
  /** Extra synthetic origins (for performance tests). */
  extraOrigins?: number;
  usdInr?: number;
  aiBasketFromHistory?: boolean;
  /** Explicit history.ai_basket_pe now / pre-ChatGPT median (overrides aiBasketFromHistory). */
  aiBasket?: { now: number; pre: number };
  /** history.pe_fit (drawdown = intercept + slope·P/E); default intercept 0.1, slope −0.01. */
  peFit?: { slope: number; intercept: number; n?: number };
}

export function makeBundle(opts: FixtureOpts = {}): DataBundle {
  const R = opts.residDays ?? 300;
  const rng = new Rng(opts.seed ?? 7);
  const usdInr = opts.usdInr ?? 95;
  const securities: Record<string, Security> = {};
  const originSpecs = [...ORIGINS];
  for (let k = 0; k < (opts.extraOrigins ?? 0); k++) {
    originSpecs.push({ ticker: `XCHIP${k}`, group: 'chips', price: 50, pe: 30, pePre: 25, mcap: 20e9, rev: 5e9, ol: 1.5, s: q(`XCHIP${k}.hyperscaler_share`, 0.3), neo: q(`XCHIP${k}.neocloud_share`, 0.1) });
  }
  const mcapAll = originSpecs.reduce((a, o) => a + o.mcap, 0);
  const mcapChips = originSpecs.filter((o) => o.group === 'chips').reduce((a, o) => a + o.mcap, 0);
  const origins: OriginInfo[] = originSpecs.map((o) => {
    securities[o.ticker] = sec(o.ticker, {
      last_close: o.price,
      pe_ttm: o.pe,
      pe_pre_chatgpt_median: o.pePre,
      mcap_usd: o.mcap,
      mcap_inr: o.mcap * usdInr,
      revenue_ttm: o.rev,
      ebit_margin: 0.3,
      ai_premium: o.pe && o.pePre ? o.pe / o.pePre - 1 : null,
      op_leverage: q(`${o.ticker}.op_leverage`, o.ol, 'COMPUTED', 'x'),
    });
    return {
      ticker: o.ticker,
      group: o.group,
      in_chip_basket: o.group === 'chips',
      in_ai_basket: true,
      weight_chip_basket: o.group === 'chips' ? o.mcap / mcapChips : 0,
      weight_ai_basket: o.mcap / mcapAll,
      hyperscaler_share: o.s,
      neocloud_share: o.neo,
      capex_ttm_usd: o.capex ?? null,
      capex_quarters: [],
      credit: { stressed: !!o.stressed, net_debt_usd: o.netDebt ?? null, ebitda_ttm_usd: null, nd_ebitda: null },
      concentration: [],
    };
  });

  const resid_dates = Array.from({ length: R }, (_, t) => {
    const d = new Date(Date.UTC(2023, 9, 30) + t * 86400000 * 1.4);
    return d.toISOString().slice(0, 10);
  });
  const common = Array.from({ length: R }, () => normal(rng));
  const nifty_resid = Array.from({ length: R }, () => 0.008 * normal(rng));

  const indiaSpecs = [...INDIA];
  for (let k = 0; k < (opts.extraIndia ?? 0); k++) {
    indiaSpecs.push({
      ticker: `XIND${k}.NS`, tier: (['A', 'B', 'C', 'D'] as Tier[])[k % 4], coef: { SOX: 0.1, NDX: 0.1, NIFTY: 1 }, r2: 0.3,
      exposures: [{ channel: 'capex', share: q(`XIND${k}.NS.exposure.capex`, 0.1, 'USER_ASSUMPTION'), driver: null }],
      fx: q(`XIND${k}.NS.fx_margin_sens_bps`, 0, 'USER_ASSUMPTION', 'bps'), ebit: 0.15, prem: 0.5, mcapInr: 1e11, price: 100, pe: 30, load: 0.7,
    });
  }
  const india: IndiaTarget[] = indiaSpecs.map((t) => {
    securities[t.ticker] = sec(t.ticker, {
      role: 'india',
      market: 'IN',
      currency: 'INR',
      financial_currency: 'INR',
      last_close: t.price,
      pe_ttm: t.pe,
      mcap_inr: t.mcapInr,
      mcap_usd: t.mcapInr / usdInr,
      ebit_margin: t.ebit,
      ai_premium: t.prem,
      op_leverage: q(`${t.ticker}.op_leverage`, 1.4, 'COMPUTED', 'x'),
    });
    const resid = Array.from({ length: R }, (_, i) =>
      i < (t.leadingNulls ?? 0) ? null : 0.012 * (t.load * common[i] + Math.sqrt(Math.max(0, 1 - t.load * t.load)) * normal(rng)),
    );
    return {
      ticker: t.ticker,
      display: t.ticker.replace(/\.(NS|BO)$/, ''),
      name: t.ticker,
      tier: t.tier,
      parent: t.parent ?? null,
      parent_secondary: null,
      parent_stake: t.parent ? q(`${t.ticker}.parent_stake`, 0.72) : null,
      adr: null,
      exposures: t.exposures,
      fx_margin_sens_bps: t.fx,
      reg: reg(t.coef, t.r2, t.n),
      reg_down: null,
      slopes: { ndx_on_sox: 0.6, parent_on_sox: t.parent ? 0.5 : null, ndx_on_sox_down: null, parent_on_sox_down: null },
      beta_total: (t.coef.SOX ?? 0) + (t.coef.NDX ?? 0) * 0.6,
      beta_total_down: null,
      rolling: null,
      resid,
      short_history: !!t.short,
      notes: [],
    };
  });

  const assumptions: Quantity[] = [
    q('assump.psi_supplier', 1, 'USER_ASSUMPTION', 'x'),
    q('assump.psi_india_dc', 0.5, 'USER_ASSUMPTION', 'x'),
    q('assump.phi_it', 1, 'USER_ASSUMPTION', 'x'),
    q('assump.kappa', 0, 'USER_ASSUMPTION', 'x'),
    q('assump.sympathy', 1, 'USER_ASSUMPTION', 'x'),
  ];

  const bundle: DataBundle = {
    meta: {
      app: 'AI CRASH MONITOR (SYNTHETIC TEST FIXTURE)',
      schema_version: 1,
      built_at: '2026-10-28T00:00:00Z',
      as_of: '2026-10-28',
      as_of_us: '2026-10-27',
      usd_inr: usdInr,
      fx_rates_usd: { USD: 1, INR: 1 / usdInr, JPY: 0.0065 },
      regression_window: { start: '2023-10-27', end: '2026-10-27', years: 3, n_india_days: R },
      pre_chatgpt: { date: '2022-11-30', window_start: '2019-11-30', window_end: '2022-11-29', src: [] },
      data_sources: [],
      ticker_log: [],
      warnings: [],
      alignment: { rule: 'synthetic', us_holiday_zero_days: 0, india_holiday_accumulations: 0 },
    },
    settings: {},
    sources: [{ id: 'fixture_src', title: 'Synthetic fixture', publisher: null, url: 'https://example.invalid', date: null, quote: null, verification: 'UNVERIFIED', accessed: '2026-10-28', note: 'test only' }],
    securities,
    tape: Object.keys(securities),
    origins,
    india,
    benchmarks: { nifty: '^NSEI', nifty_it: '^CNXIT', adrs: [] },
    nifty_model: reg({ SOX: 0.1, NDX: 0.15 }, 0.1, 740),
    nifty_resid,
    resid_dates,
    factor_map: {
      sox_on_chip_basket: { beta: 1.05, r2: 0.9, n: 740 },
      ndx_on_ai_basket: { beta: 0.85, r2: 0.85, n: 740 },
      ndx_on_sox: { beta: 0.6, r2: 0.7, n: 740 },
    },
    parent_maps: { '6501.T': { SOX: 0.3, NDX: 0.2, r2: 0.2, n: 740, method: 'dimson_0_1' } },
    peer_beta: {
      origins: {
        NVDA: { AMD: 0.6, CRWV: 0.3 },
        AMD: { NVDA: 1.2 },
        MSFT: { NVDA: 0.4, AMD: 0.3 },
        ORCL: { NVDA: 0.6, AMD: 0.4 },
        CRWV: { NVDA: 1.5, AMD: 1.1 },
        VRT: { NVDA: 1.1, AMD: 0.9 },
        ADBE: { NVDA: 0.3, AMD: 0.2 },
      },
      india: {},
    },
    heatmap: { targets: [], origins: [], cells: [] },
    fx: {
      spot: usdInr,
      spot_date: '2026-10-28',
      beta_inr_on_ndx: -0.08,
      beta_inr_on_ndx_down: -0.1,
      r2: 0.1,
      n: 740,
      episodes: [],
      default_f: q('fx.default_f', 0.03, 'COMPUTED'),
    },
    calibration: {
      contagion_us: q('calib.contagion_us', 0.15, 'COMPUTED'),
      contagion_india: q('calib.contagion_india', 0.05, 'DERIVED'),
      tier_median_premium: { A: null, B: null, C: null, D: null },
    },
    assumptions,
    presets: fixturePresets(),
    history: {
      cases: [],
      event_studies: [],
      us_vs_india: [],
      pe_vs_drawdown: [],
      pe_fit: { slope: opts.peFit?.slope ?? -0.01, intercept: opts.peFit?.intercept ?? 0.1, r2: 0.3, n: opts.peFit?.n ?? 11 },
      ai_basket_pe: opts.aiBasket
        ? { now: opts.aiBasket.now, pre_chatgpt_median: opts.aiBasket.pre, implied_drawdown: null }
        : opts.aiBasketFromHistory
          ? { now: 40, pre_chatgpt_median: 30, implied_drawdown: null }
          : { now: null, pre_chatgpt_median: null, implied_drawdown: null },
      overlay: [],
      worst_windows: {
        SOX: { d1: -0.1, d1_date: '2000-04-14', d21: -0.3, d21_end: '2000-04-14', d252: -1.2, d252_end: '2001-04-04' },
        NDX: { d1: -0.1, d1_date: '2000-04-14', d21: -0.3, d21_end: '2000-04-14', d252: -1.1, d252_end: '2001-04-04' },
      },
      replay_windows: [
        { id: 'DOTCOM', label: 'Dot-com (synthetic)', start: '2000-03-10', end: '2002-10-09', moves: { SOX: -1.5, NDX: -1.4 }, status: 'COMPUTED', src: [], note: null },
        { id: 'DEEPSEEK', label: 'DeepSeek day (synthetic)', start: '2025-01-24', end: '2025-01-27', moves: { SOX: -0.098, NDX: -0.031 }, status: 'COMPUTED', src: [], note: null },
      ],
      deepseek_next_day: [],
    },
  };
  return bundle;
}
