// Every concept a first-time user meets gets one glossary id (DESIGN §9.5). Owned by the
// orchestrator; UX-LEARN provides an illustrated entry for every id in src/learn/glossary.ts.
export const GLOSSARY_IDS = [
  // the scenario
  'scenario', 'horizon', 'ai_bubble', 'capex', 'capex_cut', 'hyperscaler', 'guidance_cut', 'restatement',
  'multiple_compression', 'credit_event', 'replay', 'full_pop',
  // markets & indices
  'sox', 'ndx', 'nifty', 'nifty_it', 'adr', 'etf_india', 'mcap', 'crore', 'bps',
  // how it spreads
  'channel', 'tier', 'parent_link', 'beta', 'beta_total', 'downside_beta', 'lag', 'fpi', 'inr_depr', 'fx_offset',
  // valuation & earnings
  'pe', 'eps', 'ai_premium', 'op_leverage', 'ear', 'market_implied', 'fundamental', 'gap',
  // uncertainty & accuracy
  'monte_carlo', 'range', 'confidence', 'r2', 'oos', 'backtest', 'ensemble', 'calibration', 'nowcast',
  // history
  'drawdown', 'car', 'event_study', 'contagion',
  // data & sources
  'sourced', 'unverified', 'user_assumption', 'computed',
] as const;

export type GlossaryId = (typeof GLOSSARY_IDS)[number];
