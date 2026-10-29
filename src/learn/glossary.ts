// The illustrated glossary: one entry per GlossaryId (DESIGN §9.5). Plain words first, the
// technical name second, an illustration, and a live example computed from the data bundle and the
// scenario on screen. Examples return null when the data they need is missing — never NaN.
import { CHANNEL_VIS, CONFIDENCE_VIS, TIER_VIS } from '../guided/visual';
import type { IconName } from '../guided/icons';
import { isNum } from '../lib/format';
import type { Channel } from '../types/engine';
import {
  betaShowcase,
  nameOf,
  extremeBy,
  fmtCrore,
  fmtDate,
  fmtNum,
  hyperscalerCapex,
  isActive,
  type LearnData,
  overlay,
  paramValue,
  pctWord,
  resultFor,
  simple,
  statusCounts,
  target,
  tierCounts,
} from './data';
import type { GlossaryId } from './ids';
import type { IllId } from './illustrations';
import { betaParts } from './illustrations/links';

export type Topic = 'scenario' | 'markets' | 'spread' | 'value' | 'uncertainty' | 'history' | 'data';

export const TOPICS: { id: Topic; label: string; blurb: string; icon: IconName }[] = [
  { id: 'scenario', label: 'The scenario', blurb: 'The what-ifs you can try and the shocks behind them.', icon: 'play' },
  { id: 'spread', label: 'How it spreads', blurb: 'The routes from a US AI shock to an Indian share price.', icon: 'flow' },
  { id: 'value', label: 'Prices & earnings', blurb: 'What a share price is made of, and two ways to size a fall.', icon: 'tag' },
  { id: 'uncertainty', label: 'Uncertainty & accuracy', blurb: 'Ranges, confidence, and how the model is tested on unseen days.', icon: 'target' },
  { id: 'history', label: 'Past crashes', blurb: 'How earlier bubbles and shocks played out.', icon: 'clock' },
  { id: 'markets', label: 'Markets & units', blurb: 'The indexes, listings and Indian number units used on screen.', icon: 'globe' },
  { id: 'data', label: 'Data & sources', blurb: 'Where every number comes from, and how it is labelled.', icon: 'book' },
];

export interface GlossaryEntry {
  id: GlossaryId;
  /** plain-language name, shown first */
  term: string;
  /** technical name, shown second */
  tech: string;
  oneLiner: string;
  body: string[];
  /** plain-text formula (optional) */
  formula?: string;
  /** live sentence from the bundle / scenario on screen; null when the data is missing */
  example: (d: LearnData) => string | null;
  ill: IllId;
  illFocus?: Channel | 'premium';
  illVariant?: string;
  related: GlossaryId[];
  topic: Topic;
  icon: IconName;
}

const HZ_WORDS: Record<string, string> = { '1D': 'the next trading day', '1M': 'one month (≈21 sessions)', '12M': 'twelve months (≈252 sessions)' };
const HZ_SHORT: Record<string, string> = { '1D': 'next day', '1M': '1 month', '12M': '12 months' };
const COMPANY: Record<string, string> = { MSFT: 'Microsoft', GOOGL: 'Alphabet', AMZN: 'Amazon', META: 'Meta', ORCL: 'Oracle', CRWV: 'CoreWeave', NVDA: 'NVIDIA', SMCI: 'Super Micro' };
const bn = (v: number) => `$${Math.round(v / 1e9).toLocaleString('en-US')}bn`;
const on10 = (beta: number) => simple(beta * Math.log(0.9)); // response to a 10% fall in US chips

function indexLine(d: LearnData, t: string, name: string): string | null {
  const s = d.bundle?.securities?.[t];
  if (!s || !isNum(s.last_close)) return null;
  const ph = s.price_history;
  const since = ph && ph.close.length > 1 && isNum(ph.close[0]) ? ` · ${pctWord((s.last_close as number) / (ph.close[0] as number) - 1, 0)} since ${fmtDate(ph.dates[0], true)}` : '';
  return `${name}: ${fmtNum(s.last_close, 0)} at the close on ${fmtDate(s.last_date)}${isNum(s.chg_1d) ? ` (${pctWord(s.chg_1d)} that day)` : ''}${since}.`;
}

/** Company name for sentences: "Netweb Technologies", not "NETWEB.NS". */
function nm(d: LearnData, ticker: string): string {
  return nameOf(d.bundle, ticker).replace(/\s+(Limited|Ltd\.?|Inc\.?|Corporation)$/i, '');
}

function showcase(d: LearnData): string | null {
  return betaShowcase(d.bundle) ?? d.result?.india[0]?.ticker ?? null;
}

const NO_LAB = 'The accuracy lab has not been run for this data build yet, so no out-of-sample results are shown.';

const E: Record<GlossaryId, Omit<GlossaryEntry, 'id'>> = {
  // ───────────── the scenario ─────────────
  scenario: {
    term: 'A what-if scenario',
    tech: 'Scenario (shock preset)',
    oneLiner: 'One hypothetical chain of events, such as “Big Tech cuts AI spending by 30%”, followed all the way to Indian share prices.',
    body: [
      'Nothing here is a forecast. You pick a what-if; the model follows it through links measured in past prices and company data, and shows what it would mean for each Indian company.',
      'There are seven ready-made what-ifs. Their settings are your assumptions and you can change every one.',
    ],
    example: ({ result }) => (result ? `On screen now: “${result.preset.label}”, looking ${HZ_WORDS[result.params.horizon] ?? result.params.horizon} ahead.` : null),
    ill: 'scenario',
    related: ['horizon', 'full_pop', 'user_assumption'],
    topic: 'scenario',
    icon: 'play',
  },
  horizon: {
    term: 'How far ahead',
    tech: 'Horizon (1D · 1M · 12M)',
    oneLiner: 'How long after the shock we look: the next trading day, about a month (21 sessions) or a year (252 sessions).',
    body: [
      'Short horizons rest on how Indian stocks reacted the very next session. Longer horizons give a shock time to reach profits, and the range of possible outcomes widens.',
    ],
    example: ({ result }) => (result ? `On screen: ${HZ_WORDS[result.params.horizon] ?? result.params.horizon}.` : null),
    ill: 'horizon',
    related: ['scenario', 'range', 'monte_carlo'],
    topic: 'scenario',
    icon: 'clock',
  },
  ai_bubble: {
    term: 'An AI bubble',
    tech: 'Asset bubble',
    oneLiner: 'When share prices of AI companies rise much faster than the profits that could justify them, and later deflate.',
    body: [
      'This app does not claim there is a bubble. It asks a narrower question: if AI stocks deflated, which Indian companies would feel it, through which routes, and roughly how much?',
      'A deflation can come from lower profits (spending cuts), lower valuations (investors pay less per unit of profit), or a loss of trust or credit. Each is one of the what-ifs.',
    ],
    example: ({ bundle }) => {
      const p = bundle?.history?.ai_basket_pe;
      if (!p || !isNum(p.now) || !isNum(p.pre_chatgpt_median)) return null;
      return `The US/global AI stocks tracked here trade at ${fmtNum(p.now, 1)}× earnings today, against a median of ${fmtNum(p.pre_chatgpt_median, 1)}× in the three years before ChatGPT.`;
    },
    ill: 'bubble',
    related: ['pe', 'ai_premium', 'multiple_compression', 'full_pop'],
    topic: 'scenario',
    icon: 'warning',
  },
  capex: {
    term: 'Big Tech’s AI spending',
    tech: 'Capex (capital expenditure)',
    oneLiner: 'Money spent on long-lived things such as data centres, servers, chips and power equipment, rather than day-to-day costs.',
    body: [
      'The AI boom is largely a spending boom: cloud giants are building AI data centres. Their spending is someone else’s revenue: chipmakers, server builders, cable, fibre and power-equipment makers, including some Indian companies.',
    ],
    example: ({ bundle }) => {
      const cx = hyperscalerCapex(bundle);
      if (!cx) return null;
      const names = cx.rows.map((r) => COMPANY[r.ticker] ?? r.ticker);
      return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} spent ${bn(cx.total)} on capital projects in their last four reported quarters (cash-flow statements).`;
    },
    ill: 'capex',
    related: ['hyperscaler', 'capex_cut', 'channel'],
    topic: 'scenario',
    icon: 'server',
  },
  capex_cut: {
    term: 'Big Tech cuts AI spending',
    tech: 'Capex-cut shock (preset 1)',
    oneLiner: 'The what-if in which cloud giants spend a set share less on AI data centres, so their suppliers sell less.',
    body: [
      'The cut reaches chip and equipment makers in proportion to how much of their revenue comes from these buyers (sourced where possible), and then Indian suppliers of servers, cables, fibre and power gear.',
      'The size of the cut is your assumption.',
    ],
    example: ({ bundle, result }) => {
      const c = paramValue(bundle, result, ['capex', 'fullpop'], 'c');
      if (!isNum(c)) return null;
      const cut = result?.factors?.capex_cut_usd;
      if (isActive(result, ['capex', 'fullpop']))
        return `Your setting: a ${Math.round(c * 100)}% cut${isNum(cut) && cut > 0 ? `, about ${bn(cut)} less than the last 12 months` : ''}.`;
      return `Default setting: a ${Math.round(c * 100)}% cut (your assumption; change it in the scenario).`;
    },
    ill: 'capex_cut',
    related: ['capex', 'hyperscaler', 'ear', 'channel'],
    topic: 'scenario',
    icon: 'server',
  },
  hyperscaler: {
    term: 'Cloud giants',
    tech: 'Hyperscalers',
    oneLiner: 'The few companies that run giant cloud data centres (Microsoft, Alphabet, Amazon, Meta and Oracle) and buy most AI chips.',
    body: ['Because they are the biggest buyers, a change in their spending plans ripples through the whole AI supply chain.'],
    example: ({ bundle }) => {
      const cx = hyperscalerCapex(bundle);
      const top = cx?.rows[0];
      return top ? `Biggest spender in the data: ${COMPANY[top.ticker] ?? top.ticker}, ${bn(top.value)} in its last four reported quarters.` : null;
    },
    ill: 'hyperscaler',
    related: ['capex', 'capex_cut'],
    topic: 'scenario',
    icon: 'cloud',
  },
  guidance_cut: {
    term: 'A chipmaker warns on sales',
    tech: 'Guidance cut (preset 2)',
    oneLiner: 'A company tells investors its coming sales will be lower than they expected, and similar companies fall in sympathy.',
    body: [
      'Share prices move on expected future profits, so a lower outlook hits the price at once. In this what-if one chip company lowers its outlook by a set percentage; its peers follow by an assumed sympathy factor.',
    ],
    example: ({ bundle, result }) => {
      const g = paramValue(bundle, result, 'guidance', 'g');
      const t = paramValue(bundle, result, 'guidance', 'target');
      if (!isNum(g) || typeof t !== 'string') return null;
      return `${isActive(result, 'guidance') ? 'Your setting' : 'Default setting'}: ${COMPANY[t] ?? t} cuts its sales outlook by ${Math.round(g * 100)}%.`;
    },
    ill: 'guidance',
    related: ['eps', 'contagion', 'scenario'],
    topic: 'scenario',
    icon: 'chip',
  },
  restatement: {
    term: 'An accounting scandal',
    tech: 'Restatement (preset 3)',
    oneLiner: 'A company admits its past profits were overstated. Its own shares fall hard, and trust in similar companies wobbles.',
    body: [
      'The spill-over to peers is sized from two real cases: Super Micro in the US (October 2024) and Satyam in India (January 2009).',
    ],
    example: ({ bundle }) => {
      const v = bundle?.calibration?.contagion_us?.value;
      return isNum(v) ? `In the Super Micro case, US chip peers moved about ${fmtNum(v * 100, 0)}% as much as Super Micro itself that day, beyond what the market explains.` : null;
    },
    ill: 'restatement',
    related: ['contagion', 'car', 'event_study'],
    topic: 'scenario',
    icon: 'warning',
  },
  multiple_compression: {
    term: 'AI stocks get cheaper',
    tech: 'Multiple compression (preset 4)',
    oneLiner: 'Profits stay the same, but investors pay less for each unit of profit, so prices fall.',
    body: [
      'Price = P/E × earnings per share. If the P/E multiple shrinks by a fifth, the price falls by a fifth even if profits do not change.',
      'In the calibrated mode the size of the fall comes from history: across past market peaks, markets that started from higher valuations tended to fall further.',
    ],
    formula: 'new price = old price × (new P/E ÷ old P/E)',
    example: ({ bundle }) => {
      const f = bundle?.history?.pe_fit;
      const p = bundle?.history?.ai_basket_pe;
      if (!f || !isNum(f.slope) || !isNum(f.intercept)) return null;
      const now = p && isNum(p.now) && isNum(p.implied_drawdown) ? ` For today’s AI basket at ${fmtNum(p.now, 1)}× that line gives ${pctWord(p.implied_drawdown, 0)}.` : '';
      return `Fitted on ${f.n} past market peaks: fall ≈ ${pctWord(f.intercept, 0)} ${f.slope < 0 ? '−' : '+'} ${fmtNum(Math.abs(f.slope) * 100, 1)}% per point of P/E (R² ${fmtNum(f.r2, 2)}).${now}`;
    },
    ill: 'multiple',
    related: ['pe', 'ai_premium', 'drawdown'],
    topic: 'scenario',
    icon: 'tag',
  },
  credit_event: {
    term: 'AI borrowers get squeezed',
    tech: 'Credit event (preset 5)',
    oneLiner: 'Debt-heavy AI cloud companies suddenly have to pay much more to borrow, so they buy less equipment and their shares fall.',
    body: [
      'The hit is scaled by how much debt each borrower carries (net debt ÷ yearly operating earnings) and how long that debt lasts. There are few past examples, so this what-if is marked low confidence.',
    ],
    example: ({ bundle }) => {
      const o = (bundle?.origins ?? []).filter((x) => x.credit.stressed && isNum(x.credit.nd_ebitda)).sort((a, c) => (c.credit.nd_ebitda as number) - (a.credit.nd_ebitda as number))[0];
      return o ? `Most indebted borrower in the data: ${COMPANY[o.ticker] ?? o.ticker}, net debt ≈ ${fmtNum(o.credit.nd_ebitda, 1)}× its yearly operating earnings.` : null;
    },
    ill: 'credit',
    related: ['bps', 'confidence', 'capex_cut'],
    topic: 'scenario',
    icon: 'bank',
  },
  replay: {
    term: 'Replay a past crash',
    tech: 'Historical replay (preset 6)',
    oneLiner: 'Take the real moves of the US chip and tech indexes during a past crash and apply them to today’s Indian companies.',
    body: ['No guesses about shock sizes: the moves are measured from index history. What is new is today’s set of links between US and Indian stocks.'],
    example: ({ bundle, result }) => {
      const ws = (bundle?.history?.replay_windows ?? []).filter((w) => isNum(w.moves.SOX));
      if (!ws.length) return null;
      const cur = isActive(result, 'replay') ? ws.find((w) => w.id === result!.params.values.window) : null;
      const w = cur ?? ws.reduce((m, x) => ((x.moves.SOX as number) < (m.moves.SOX as number) ? x : m), ws[0]);
      return `${cur ? 'On screen' : 'Deepest window in the data'}: ${w.label.replace(/->/g, '→')}. US chips (SOX) ${pctWord(simple(w.moves.SOX as number), 0)}.`;
    },
    ill: 'replay',
    related: ['drawdown', 'sox', 'ndx', 'scenario'],
    topic: 'scenario',
    icon: 'clock',
  },
  full_pop: {
    term: 'Full bubble pop',
    tech: 'Combined shock (preset 7)',
    oneLiner: 'Everything at once: Big Tech cuts AI spending, AI stocks get cheaper and AI borrowers get squeezed.',
    body: ['It stacks the spending, valuation and credit legs. Because it combines several assumptions, it is flagged low confidence.'],
    example: ({ result }) => {
      if (!result || !isActive(result, 'fullpop')) return 'Choose “Full bubble pop” to see its numbers here.';
      const f = result.factors;
      return `On screen (${HZ_SHORT[result.params.horizon] ?? result.params.horizon}): US chips ${pctWord(f.SOX)}, Nasdaq-100 ${pctWord(f.NDX)}, Nifty ${pctWord(f.NIFTY)}; Indian AI-linked companies ${fmtCrore(result.totals.india_mcap_change_inr_cr)} in market value.`;
    },
    ill: 'full_pop',
    related: ['scenario', 'capex_cut', 'multiple_compression', 'credit_event', 'confidence'],
    topic: 'scenario',
    icon: 'layers',
  },

  // ───────────── markets & units ─────────────
  sox: {
    term: 'US chip-stock index',
    tech: 'PHLX Semiconductor Index (SOX)',
    oneLiner: 'One number that tracks the share prices of the biggest US-listed chip companies; the model’s main gauge of AI-stock mood.',
    body: ['Most links in this app are measured against it: “if US chips fall 10%…” means the SOX falls 10%.'],
    example: (d) => indexLine(d, '^SOX', 'SOX'),
    ill: 'index',
    illVariant: '^SOX',
    related: ['ndx', 'beta', 'lag'],
    topic: 'markets',
    icon: 'chip',
  },
  ndx: {
    term: 'US big-tech index',
    tech: 'Nasdaq-100 (NDX)',
    oneLiner: 'Tracks the 100 largest non-financial companies on the Nasdaq exchange, dominated by big technology firms.',
    body: ['Chip stocks and big tech usually move together; the model uses both to separate a chip-specific shock from a broad tech sell-off.'],
    example: (d) => indexLine(d, '^NDX', 'Nasdaq-100'),
    ill: 'index',
    illVariant: '^NDX',
    related: ['sox', 'beta_total'],
    topic: 'markets',
    icon: 'laptop',
  },
  nifty: {
    term: 'India’s main index',
    tech: 'Nifty 50',
    oneLiner: 'Tracks 50 large Indian companies listed on the National Stock Exchange (NSE).',
    body: ['When foreign investors sell India in a global sell-off, the whole Nifty falls; that is one of the routes in this model.'],
    example: (d) => {
      const base = indexLine(d, '^NSEI', 'Nifty 50');
      const nm = d.bundle?.nifty_model?.coef;
      const m = d.bundle?.factor_map?.ndx_on_sox?.beta;
      if (!base) return null;
      if (!nm?.SOX || !nm?.NDX || !isNum(m)) return base;
      const resp = nm.SOX.b + nm.NDX.b * m;
      return `${base} Over the last three years a 10% fall in US chips came with about ${pctWord(on10(resp))} for the Nifty the next session.`;
    },
    ill: 'index',
    illVariant: '^NSEI',
    related: ['fpi', 'nifty_it'],
    topic: 'markets',
    icon: 'trendUp',
  },
  nifty_it: {
    term: 'Indian IT index',
    tech: 'Nifty IT',
    oneLiner: 'Tracks the large Indian IT-services companies listed on the NSE.',
    body: ['These companies sell software and engineering services to clients abroad, including US technology firms; they make up most of Tier B.'],
    example: (d) => indexLine(d, '^CNXIT', 'Nifty IT'),
    ill: 'index',
    illVariant: '^CNXIT',
    related: ['tier', 'ear', 'fx_offset'],
    topic: 'markets',
    icon: 'code',
  },
  adr: {
    term: 'Indian shares traded in New York',
    tech: 'ADR (American Depositary Receipt)',
    oneLiner: 'A US-listed certificate standing for shares of a foreign company. Infosys and Wipro, for example, also trade in New York while India is closed.',
    body: ['Because ADRs trade during US hours, they show how US investors re-priced an Indian company overnight, which hints at India’s next open.'],
    example: ({ bundle }) => {
      const s = bundle?.securities?.INFY;
      return s && isNum(s.last_close) ? `Infosys ADR (INFY): $${fmtNum(s.last_close, 2)} at the New York close on ${fmtDate(s.last_date)}${isNum(s.chg_1d) ? ` (${pctWord(s.chg_1d)})` : ''}.` : null;
    },
    ill: 'overnight',
    related: ['etf_india', 'lag', 'nowcast'],
    topic: 'markets',
    icon: 'globe',
  },
  etf_india: {
    term: 'India funds traded in the US',
    tech: 'US-listed India ETFs',
    oneLiner: 'Funds listed in New York that hold Indian shares, so their prices move overnight while Indian markets are closed.',
    body: [
      'The accuracy lab uses them only in nowcast mode: they are known before India opens, but most of the move they hint at happens at the open itself, so they are not a trading edge.',
    ],
    example: ({ bundle }) => {
      const f = (bundle?.factors_aux ?? []).filter((x) => ['INDA', 'EPI', 'SMIN'].includes(x.id));
      return f.length ? `Used in the nowcast: ${f.map((x) => `${x.ticker} (${x.name})`).join(', ')}.` : null;
    },
    ill: 'overnight',
    related: ['adr', 'nowcast', 'lag'],
    topic: 'markets',
    icon: 'globe',
  },
  mcap: {
    term: 'Market value',
    tech: 'Market capitalisation (market cap)',
    oneLiner: 'Share price × number of shares: what the stock market says the whole company is worth.',
    body: ['Rupee amounts on screen (for example “−₹1,200 crore”) are changes in market value: the price move times the company’s market cap.'],
    formula: 'market cap = share price × shares outstanding',
    example: ({ bundle }) => {
      const s = bundle?.securities?.['NETWEB.NS'] ?? null;
      if (!s || !isNum(s.last_close) || !isNum(s.shares) || !isNum(s.mcap_inr)) return null;
      return `${nm({ bundle, result: null }, s.ticker)}: ₹${fmtNum(s.last_close, 0)} × ${fmtNum(s.shares / 1e7, 2)} crore shares ≈ ${fmtCrore(s.mcap_inr / 1e7)}.`;
    },
    ill: 'mcap',
    related: ['crore', 'pe'],
    topic: 'markets',
    icon: 'building',
  },
  crore: {
    term: 'Crore and lakh',
    tech: 'Indian number units',
    oneLiner: '1 lakh = 1,00,000 (one hundred thousand). 1 crore = 1,00,00,000 (ten million). 1 lakh crore = ₹1 trillion.',
    body: ['Indian commas group digits in twos after the first thousand: ₹1,23,45,678 is one crore, twenty-three lakh, forty-five thousand, six hundred and seventy-eight rupees.'],
    example: ({ bundle }) => {
      const fx = bundle?.meta?.usd_inr;
      if (!isNum(fx)) return null;
      return `At ₹${fmtNum(fx, 2)} per dollar: ₹1 crore ≈ $${fmtNum(1e7 / fx / 1e3, 0)} thousand and ₹1 lakh crore ≈ $${fmtNum(1e12 / fx / 1e9, 1)} billion.`;
    },
    ill: 'crore',
    related: ['mcap', 'bps'],
    topic: 'markets',
    icon: 'rupee',
  },
  bps: {
    term: 'Basis points',
    tech: 'bps (basis points)',
    oneLiner: 'One basis point is 0.01%. 100 basis points make one percentage point.',
    body: ['Used for small changes in margins and interest rates, where “0.3 percentage points” is clumsier than “30 bps”.'],
    example: ({ bundle }) => {
      const t = bundle?.india.find((x) => x.fx_margin_sens_bps?.status === 'SOURCED' && isNum(x.fx_margin_sens_bps.value));
      return t ? `${nm({ bundle, result: null }, t.ticker)}: operating margin ≈ +${fmtNum(t.fx_margin_sens_bps.value, 0)} bps for each 1% the rupee weakens (sourced estimate).` : null;
    },
    ill: 'bps',
    related: ['fx_offset', 'credit_event'],
    topic: 'markets',
    icon: 'sliders',
  },

  // ───────────── how it spreads ─────────────
  channel: {
    term: 'The routes a shock travels',
    tech: 'Transmission channels',
    oneLiner: 'How a US AI shock reaches an Indian share price: through a parent company, IT budgets, data-centre orders, investor mood or foreign money.',
    body: [
      'Each company is linked by some of these routes, not all. The model adds up each route’s contribution and names the biggest one, the “dominant channel”.',
      'A weaker rupee works the other way for exporters: it cushions their profits.',
    ],
    example: ({ result }) => {
      if (!result) return null;
      const tot: Partial<Record<Channel, number>> = {};
      for (const r of result.india) for (const [k, v] of Object.entries(r.channel_inr_cr)) if (isNum(v)) tot[k as Channel] = (tot[k as Channel] ?? 0) + Math.abs(v);
      const entries = Object.entries(tot) as [Channel, number][];
      const sum = entries.reduce((s, [, v]) => s + v, 0);
      if (!entries.length || sum <= 0) return null;
      const [ch, v] = entries.sort((a, b) => b[1] - a[1])[0];
      return `Biggest route in the scenario on screen: “${CHANNEL_VIS[ch].label}”, ${fmtNum((v / sum) * 100, 0)}% of the rupee impact across all companies.`;
    },
    ill: 'channels',
    related: ['tier', 'parent_link', 'fpi', 'beta'],
    topic: 'spread',
    icon: 'flow',
  },
  tier: {
    term: 'Four groups of Indian companies',
    tech: 'Tiers A–D',
    oneLiner: 'Indian arms of global companies (A), IT services for US tech (B), the AI and data-centre build-out (C), and the electronics and chip theme (D).',
    body: ['The tier says which routes matter most: a parent link for A, IT budgets for B, data-centre orders for C, and investor mood for D.'],
    example: ({ bundle }) => {
      if (!bundle) return null;
      const c = tierCounts(bundle);
      return `In this data: ${(['A', 'B', 'C', 'D'] as const).map((t) => `${c[t]} in Tier ${t} (${TIER_VIS[t].label})`).join(', ')}.`;
    },
    ill: 'tiers',
    related: ['channel', 'parent_link'],
    topic: 'spread',
    icon: 'layers',
  },
  parent_link: {
    term: 'Parent company link',
    tech: 'Parent link (b_P)',
    oneLiner: 'An Indian company majority-owned by a global firm tends to move when its parent’s shares move.',
    body: ['Measured as the extra move linked to the parent, on top of the general US-chip and Nifty effects.'],
    example: ({ bundle }) => {
      const t = target(bundle, 'GVT&D.NS') ?? bundle?.india.find((x) => x.tier === 'A' && x.reg?.coef?.PARENT) ?? null;
      const b = t?.reg?.coef?.PARENT?.b;
      if (!t || !t.parent || !isNum(b)) return null;
      const stake = t.parent_stake?.value;
      const pn = (bundle?.securities?.[t.parent]?.name ?? t.parent).replace(/,? Inc\.?$| Corporation$| AG$| SE$| Ltd\.?$/i, '');
      return `${t.display}${isNum(stake) ? ` (${Math.round(stake * 100)}% owned by ${pn})` : ''}: when the parent fell 10%, it has tended to move ${pctWord(on10(b))} on top of the US-chip effect.`;
    },
    ill: 'parent',
    related: ['tier', 'beta_total'],
    topic: 'spread',
    icon: 'building',
  },
  beta: {
    term: 'How strongly it follows US chips',
    tech: 'Beta (β)',
    oneLiner: 'How much a stock has tended to move when US chip stocks move. A beta of 0.3 means roughly a 3% move for a 10% move in US chips.',
    body: ['Measured from three years of daily prices. It describes the past on average; individual days scatter widely around the line.'],
    example: ({ bundle }) => {
      const tk = showcase({ bundle, result: null });
      const t = tk ? target(bundle, tk) : null;
      if (!t || !isNum(t.beta_total)) return null;
      return `If US chips fall 10%, ${nm({ bundle, result: null }, t.ticker)} has tended to move about ${pctWord(on10(t.beta_total))} the next Indian session (beta ${fmtNum(t.beta_total, 2)}).`;
    },
    ill: 'beta',
    related: ['beta_total', 'downside_beta', 'lag', 'r2'],
    topic: 'spread',
    icon: 'pulse',
  },
  beta_total: {
    term: 'Total link to US chips',
    tech: 'Total AI beta (β_total)',
    oneLiner: 'The beta after adding every path: direct, via the Nasdaq-100, via a parent company and via the Nifty.',
    body: [
      'A fall in US chips usually comes with falls in the Nasdaq and the Nifty, so the total adds those indirect paths using how these indexes have moved together.',
    ],
    formula: 'β_total = b_SOX + b_NDX·m_NDX + b_P·m_P + b_N·(c_SOX + c_NDX·m_NDX)',
    example: ({ bundle }) => {
      const tk = showcase({ bundle, result: null });
      const bp = tk ? betaParts(bundle, tk) : null;
      if (!bp || !bp.parts.length) return null;
      const terms = bp.parts.map((p, i) => `${i === 0 ? '' : p.v < 0 ? '− ' : '+ '}${fmtNum(i === 0 ? p.v : Math.abs(p.v), 2)} ${p.key === 'direct' ? 'direct' : p.label.replace(/^via the /, 'via ').replace(/ \(.*\)$/, '')}`);
      return `${bp.display}: ${terms.join(' ')} = ${fmtNum(bp.total, 2)}.`;
    },
    ill: 'beta_total',
    related: ['beta', 'parent_link', 'fpi'],
    topic: 'spread',
    icon: 'layers',
  },
  downside_beta: {
    term: 'The link on the worst days',
    tech: 'Downside beta',
    oneLiner: 'The same link measured only on the worst 5% of days for US chips; it is often stronger than on ordinary days.',
    body: ['Crashes are not ordinary days. If a stock follows US chips more closely when they fall hard, the ordinary beta would understate the damage.'],
    example: ({ bundle }) => {
      const tk = showcase({ bundle, result: null });
      const t = tk ? target(bundle, tk) : null;
      if (!t || !isNum(t.beta_total) || !isNum(t.beta_total_down)) return null;
      return `${t.display}: ${fmtNum(t.beta_total, 2)} on all days, ${fmtNum(t.beta_total_down, 2)} on the worst 5% of US-chip days.`;
    },
    ill: 'downside',
    related: ['beta', 'beta_total', 'range'],
    topic: 'spread',
    icon: 'trendDown',
  },
  lag: {
    term: 'The time-zone delay',
    tech: 'Information-set alignment (US t−1 lag)',
    oneLiner: 'New York closes after Mumbai, so a US move shows up in Indian prices the next Indian session; Tokyo closes earlier, so its move counts the same day.',
    body: [
      'Getting this wrong would make the model look smarter than it is. Every foreign price is matched to the first Indian close that could have known about it.',
    ],
    example: ({ bundle }) => {
      const a = bundle?.meta?.alignment;
      if (!a || !isNum(a.us_holiday_zero_days) || !isNum(a.india_holiday_accumulations)) return null;
      return `Data check: ${a.us_holiday_zero_days} Indian sessions had no new US session (treated as no US news) and ${a.india_holiday_accumulations} times US moves piled up over an Indian holiday.`;
    },
    ill: 'lag',
    related: ['beta', 'adr', 'nowcast'],
    topic: 'spread',
    icon: 'clock',
  },
  fpi: {
    term: 'Foreign money pulling out',
    tech: 'FPI flows (foreign portfolio investors)',
    oneLiner: 'Global funds that own Indian shares. In a global sell-off they often sell India too, pulling down the whole Nifty.',
    body: ['The model captures this route through the Nifty: each stock’s link to the Nifty times the Nifty move that has come with US moves.'],
    example: ({ result }) => (result && isNum(result.factors.NIFTY) ? `Scenario on screen: the Nifty moves about ${pctWord(result.factors.NIFTY)} through this route.` : null),
    ill: 'fpi',
    illFocus: 'fx_fpi',
    related: ['nifty', 'inr_depr', 'channel'],
    topic: 'spread',
    icon: 'globe',
  },
  inr_depr: {
    term: 'A weaker rupee',
    tech: 'INR depreciation',
    oneLiner: 'When the rupee falls, each dollar buys more rupees. It often happens when foreign money leaves.',
    body: ['The default size is the median rupee move across past US tech sell-offs; you can override it.'],
    example: ({ bundle, result }) => {
      const eps = (bundle?.fx?.episodes ?? []).filter((e) => isNum(e.inr_depr));
      const f = bundle?.fx?.default_f?.value;
      if (!eps.length || !isNum(f)) return null;
      const cur = result?.factors?.inr_depr;
      const now = isNum(cur) ? `; in the scenario on screen it ${cur >= 0 ? 'weakens' : 'strengthens'} ${fmtNum(Math.abs(cur) * 100, 1)}%` : '';
      return `Across ${eps.length} past US tech sell-offs the rupee weakened by a median ${fmtNum(simple(f) * 100, 1)}%${now}.`;
    },
    ill: 'rupee',
    related: ['fx_offset', 'fpi'],
    topic: 'spread',
    icon: 'rupee',
  },
  fx_offset: {
    term: 'The weak-rupee cushion',
    tech: 'FX margin offset',
    oneLiner: 'Exporters earn dollars but pay most costs in rupees, so a weaker rupee lifts their profit margins and softens the blow.',
    body: ['Applied to profits (the fundamental view) for companies with a sourced or assumed margin sensitivity.'],
    formula: 'profit effect = margin bps per 1% × rupee move ÷ operating margin',
    example: ({ bundle, result }) => {
      const t = bundle?.india.find((x) => x.fx_margin_sens_bps?.status === 'SOURCED' && isNum(x.fx_margin_sens_bps.value));
      if (!t) return null;
      const r = resultFor(result, t.ticker);
      const extra = r && isNum(r.fx_eps) && Math.abs(r.fx_eps) > 0.0005 ? ` In the scenario on screen that adds ${pctWord(r.fx_eps)} to its profit.` : '';
      return `${nm({ bundle, result }, t.ticker)}: about ${fmtNum(t.fx_margin_sens_bps.value, 0)} bps of operating margin per 1% weaker rupee (sourced).${extra}`;
    },
    ill: 'fx',
    illFocus: 'fx',
    related: ['inr_depr', 'bps', 'fundamental'],
    topic: 'spread',
    icon: 'shield',
  },

  // ───────────── prices & earnings ─────────────
  pe: {
    term: 'Price-to-earnings',
    tech: 'P/E ratio',
    oneLiner: 'Share price ÷ yearly profit per share: how many years of today’s profit you pay for one share.',
    body: ['A high P/E means investors expect profits to grow (or are paying up for a story). It is the number that falls in a “multiple compression”.'],
    formula: 'P/E = share price ÷ earnings per share',
    example: ({ bundle }) => {
      const s = bundle?.securities?.['INFY.NS'];
      return s && isNum(s.last_close) && isNum(s.eps_ttm) && isNum(s.pe_ttm) ? `Infosys: ₹${fmtNum(s.last_close, 0)} ÷ ₹${fmtNum(s.eps_ttm, 2)} ≈ ${fmtNum(s.pe_ttm, 1)}×.` : null;
    },
    ill: 'pe',
    related: ['eps', 'ai_premium', 'multiple_compression'],
    topic: 'value',
    icon: 'tag',
  },
  eps: {
    term: 'Profit per share',
    tech: 'EPS (earnings per share)',
    oneLiner: 'A company’s profit over the last year divided by its number of shares.',
    body: ['If profits fall, EPS falls, and at the same P/E so does the price.'],
    example: ({ bundle }) => {
      const s = bundle?.securities?.['INFY.NS'];
      return s && isNum(s.eps_ttm) ? `Infosys: ₹${fmtNum(s.eps_ttm, 2)} of profit per share over the last 12 months.` : null;
    },
    ill: 'eps',
    related: ['pe', 'ear', 'op_leverage'],
    topic: 'value',
    icon: 'rupee',
  },
  ai_premium: {
    term: 'The extra “AI premium”',
    tech: 'AI premium',
    oneLiner: 'How much higher a stock’s P/E is today than its median in the three years before ChatGPT was released (30 Nov 2022).',
    body: [
      'A large premium means the price already counts on AI-driven growth; if that hope fades, part of the premium can disappear. Many stocks have no premium at all.',
      'Stocks listed too recently to have a pre-ChatGPT P/E use their tier’s median, marked as an assumption.',
    ],
    formula: 'AI premium = P/E today ÷ median P/E before ChatGPT − 1',
    example: ({ bundle }) => {
      const rows = (bundle?.india ?? [])
        .map((t) => ({ t, s: bundle!.securities[t.ticker] }))
        .filter((x) => x.s && isNum(x.s.ai_premium) && isNum(x.s.pe_ttm) && isNum(x.s.pe_pre_chatgpt_median))
        .sort((a, c) => (c.s.ai_premium as number) - (a.s.ai_premium as number));
      if (rows.length < 2) return null;
      const hi = rows[0];
      const lo = rows[rows.length - 1];
      const d = { bundle, result: null };
      return `${nm(d, hi.t.ticker)}: ${fmtNum(hi.s.pe_ttm, 1)}× today vs ${fmtNum(hi.s.pe_pre_chatgpt_median, 1)}× before ChatGPT, a ${pctWord(hi.s.ai_premium, 0)} premium. ${nm(d, lo.t.ticker)}: ${fmtNum(lo.s.pe_ttm, 1)}× vs ${fmtNum(lo.s.pe_pre_chatgpt_median, 1)}×, no premium.`;
    },
    ill: 'premium',
    illFocus: 'premium',
    related: ['pe', 'multiple_compression', 'fundamental'],
    topic: 'value',
    icon: 'tag',
  },
  op_leverage: {
    term: 'Profit falls faster than sales',
    tech: 'Operating leverage',
    oneLiner: 'Because many costs are fixed, a 10% drop in sales can cut operating profit by more than 10%.',
    body: ['Measured from each company’s last two annual reports where possible (limited to 1–4×); otherwise a default that is marked as an assumption.'],
    formula: 'profit change ≈ sales change × operating leverage',
    example: ({ bundle }) => {
      const s = bundle?.securities?.['STLTECH.NS'];
      const ol = s?.op_leverage?.value;
      return s && isNum(ol) ? `${nm({ bundle, result: null }, s.ticker)}: about ${fmtNum(ol, 1)}×, so a 10% drop in sales means roughly ${fmtNum(Math.min(95, ol * 10), 0)}% less operating profit.` : null;
    },
    ill: 'op_lev',
    related: ['ear', 'eps'],
    topic: 'value',
    icon: 'factory',
  },
  ear: {
    term: 'Profit at risk',
    tech: 'EaR (earnings at risk)',
    oneLiner: 'The share of a company’s yearly profit this scenario could remove, through lost IT budgets, data-centre orders or credit.',
    body: ['Built from the share of revenue exposed to each route (sourced where possible), the size of the shock, and operating leverage.'],
    formula: 'EaR = Σ (exposed revenue share × cut) × operating leverage',
    example: ({ result }) => {
      const r = extremeBy(result, (x) => x.ear, 'max');
      return r && r.ear > 0 ? `Most exposed in the scenario on screen: ${r.name}, about ${fmtNum(r.ear * 100, 1)}% of its yearly profit.` : null;
    },
    ill: 'ear',
    related: ['op_leverage', 'fundamental', 'channel'],
    topic: 'value',
    icon: 'warning',
  },
  market_implied: {
    term: 'Based on past price moves',
    tech: 'Market-implied move (Layer 2)',
    oneLiner: 'How far the stock would move if it reacted the way it has to US AI stocks in the past.',
    body: ['Uses the links measured in daily prices (betas). It captures mood and money flows, not only business damage.'],
    example: ({ bundle, result }) => {
      const tk = showcase({ bundle, result });
      const r = tk ? resultFor(result, tk) : null;
      return r ? `${r.name}: ${pctWord(r.market_move)} in the scenario on screen.` : null;
    },
    ill: 'market_fund',
    illVariant: 'market',
    related: ['fundamental', 'gap', 'beta_total'],
    topic: 'value',
    icon: 'pulse',
  },
  fundamental: {
    term: 'Based on damage to profits',
    tech: 'Fundamental move (Layer 3)',
    oneLiner: 'How far the stock would fall if its price followed the damage to its profits plus the fading of any AI premium.',
    body: ['Adds the weak-rupee cushion for exporters. It ignores mood, so it can be smaller or larger than the market-implied move.'],
    formula: 'fundamental = (1 − EaR) × (1 − premium fade) × (1 + FX effect) − 1',
    example: ({ bundle, result }) => {
      const tk = showcase({ bundle, result });
      const r = tk ? resultFor(result, tk) : null;
      if (!r || !isNum(r.fundamental_net)) return null;
      return `${r.name}: ${pctWord(r.fundamental_net)} (profit at risk ${fmtNum(r.ear * 100, 1)}%, premium fade ${fmtNum(r.d * 100, 1)}%).`;
    },
    ill: 'market_fund',
    illVariant: 'fundamental',
    related: ['ear', 'ai_premium', 'gap', 'fx_offset'],
    topic: 'value',
    icon: 'factory',
  },
  gap: {
    term: 'Overreaction gap',
    tech: 'Gap (market − fundamental)',
    oneLiner: 'The difference between the two answers. Negative means prices would fall more than the damage to profits, a sign of mood-driven selling.',
    body: ['A large negative gap marks stocks where past price behaviour, rather than business exposure, drives the fall.'],
    formula: 'gap = market-implied move − fundamental move',
    example: ({ result }) => {
      const r = extremeBy(result, (x) => x.gap, 'min');
      return r && isNum(r.gap) ? `Most negative gap in the scenario on screen: ${r.name}, ${pctWord(r.gap)} (prices fall more than profits).` : null;
    },
    ill: 'market_fund',
    illVariant: 'gap',
    related: ['market_implied', 'fundamental'],
    topic: 'value',
    icon: 'target',
  },

  // ───────────── uncertainty & accuracy ─────────────
  monte_carlo: {
    term: 'Thousands of what-ifs',
    tech: 'Monte Carlo simulation',
    oneLiner: 'Re-run the same scenario thousands of times with different luck (shock sizes and day-to-day surprises drawn from history) to see the spread of outcomes.',
    body: ['The surprises are real past days, drawn for all stocks at once, so stocks that tend to fall together still fall together.'],
    example: ({ result }) => {
      const r = result?.india.find((x) => x.range);
      return r?.range ? `${r.name}: 5–95% range ${pctWord(r.range.p5, 0)} to ${pctWord(r.range.p95, 0)}, middle ${pctWord(r.range.p50, 0)}.` : 'Run the simulation to fill in each company’s range.';
    },
    ill: 'mc_fan',
    related: ['range', 'confidence', 'calibration'],
    topic: 'uncertainty',
    icon: 'dice',
  },
  range: {
    term: 'Likely range',
    tech: '5th–95th percentile range',
    oneLiner: '9 in 10 simulated outcomes fall between the bad-case and good-case ends; the dot is the middle (median).',
    body: ['Wide ranges are honest: daily stock moves are noisy, and the shock sizes themselves are assumptions.'],
    example: ({ result }) => {
      const r = extremeBy(result, (x) => (x.range ? x.range.p5 : null), 'min');
      return r?.range ? `Widest bad case in the scenario on screen: ${r.name}, ${pctWord(r.range.p5, 0)} (good case ${pctWord(r.range.p95, 0)}).` : null;
    },
    ill: 'range',
    related: ['monte_carlo', 'calibration'],
    topic: 'uncertainty',
    icon: 'sliders',
  },
  confidence: {
    term: 'How much to trust it',
    tech: 'Confidence grade',
    oneLiner: 'A 0–100 score from how well past data fits, how long the price history is and how much of the answer rests on assumptions.',
    body: ['“Fairly reliable” needs a good fit, a long history and mostly measured inputs. Most stocks here are “rough guide only”: be honest about that.'],
    formula: 'score = 100 × (½·min(R²/0.4, 1) + ½·(1 − assumption share)) × min(1, √(n/250))',
    example: ({ result }) => {
      if (!result) return null;
      const c = { HIGH: 0, MED: 0, LOW: 0 };
      for (const r of result.india) c[r.confidence.grade] += 1;
      return `In the scenario on screen: ${c.HIGH} ${CONFIDENCE_VIS.HIGH.label.toLowerCase()}, ${c.MED} ${CONFIDENCE_VIS.MED.label.toLowerCase()}, ${c.LOW} ${CONFIDENCE_VIS.LOW.label.toLowerCase()}.`;
    },
    ill: 'confidence',
    related: ['r2', 'user_assumption', 'backtest'],
    topic: 'uncertainty',
    icon: 'shield',
  },
  r2: {
    term: 'How much of the wiggle it explains',
    tech: 'R² (R-squared)',
    oneLiner: 'The share of a stock’s day-to-day moves that the model’s line explains: 1 means all of it, 0 means none.',
    body: [
      'Daily stock moves are noisy, so even a real link usually explains only a small share of them. The honest version is out-of-sample R², measured on days the model never saw.',
    ],
    formula: 'R² = 1 − (unexplained variation ÷ total variation)',
    example: ({ bundle }) => {
      const r2s = (bundle?.india ?? []).map((x) => x.reg?.r2).filter(isNum).sort((a, b) => a - b);
      if (!r2s.length) return null;
      return `Across the ${r2s.length} Indian stocks here, the median in-sample R² is ${fmtNum(r2s[Math.floor(r2s.length / 2)], 2)} (range ${fmtNum(r2s[0], 2)}–${fmtNum(r2s[r2s.length - 1], 2)}).`;
    },
    ill: 'r2',
    related: ['oos', 'confidence', 'beta'],
    topic: 'uncertainty',
    icon: 'target',
  },
  oos: {
    term: 'Tested on unseen days',
    tech: 'Out-of-sample (OOS)',
    oneLiner: 'Scoring a model only on days it was not allowed to learn from: the honest test of whether it predicts.',
    body: ['A model can fit the past perfectly and still fail tomorrow. Out-of-sample scores are compared with the simplest rival, “predict no change”.'],
    formula: 'OOS R² = 1 − (squared errors ÷ squared errors of predicting zero)',
    example: ({ bundle }) => {
      const bt = bundle?.backtest;
      return bt ? `Tested from ${fmtDate(bt.start)} to ${fmtDate(bt.end)}, re-learning every ${bt.refit_every} sessions from the previous ${bt.train_years} years.` : NO_LAB;
    },
    ill: 'oos',
    related: ['backtest', 'r2', 'ensemble'],
    topic: 'uncertainty',
    icon: 'target',
  },
  backtest: {
    term: 'Checking against the past',
    tech: 'Backtest (walk-forward)',
    oneLiner: 'Stand at a past date, predict using only what was known then, and compare with what really happened.',
    body: ['Repeated across years and across past AI shocks, this shows whether the model ranks the hardest-hit stocks correctly.'],
    example: ({ bundle }) => {
      const s = bundle?.backtest?.summary.find((x) => x.mode === 'scenario' && x.subset === 'shock' && x.model === 'ensemble');
      if (!bundle?.backtest) return NO_LAB;
      if (!s) return null;
      return `On ${s.n.toLocaleString('en-US')} stock-days with big US-chip moves: out-of-sample R² ${fmtNum(s.r2, 2)}${isNum(s.corr_xs) ? `, ranking match ${fmtNum(s.corr_xs, 2)}` : ''}${isNum(s.hit) ? `, direction right ${fmtNum(s.hit * 100, 0)}% of the time` : ''}.`;
    },
    ill: 'backtest',
    related: ['oos', 'calibration', 'event_study'],
    topic: 'uncertainty',
    icon: 'clock',
  },
  ensemble: {
    term: 'A blend of models',
    tech: 'Ensemble (stacking)',
    oneLiner: 'Several models combined, with more weight on the ones that predicted better on days they had not seen.',
    body: ['The scenario uses the blend because no single model wins everywhere; the weights are learned only from earlier out-of-sample errors.'],
    example: ({ bundle }) => {
      const bt = bundle?.backtest;
      if (!bt) return NO_LAB;
      const w = Object.entries(bt.ensemble.weights).filter(([, v]) => isNum(v) && v > 0).sort((a, b) => b[1] - a[1]).slice(0, 3);
      const lab = (id: string) => bt.models.find((m) => m.id === id)?.label ?? id;
      return w.length ? `Largest weights: ${w.map(([id, v]) => `${lab(id)} ${fmtNum(v * 100, 0)}%`).join(', ')}.` : null;
    },
    ill: 'ensemble',
    related: ['oos', 'backtest'],
    topic: 'uncertainty',
    icon: 'layers',
  },
  calibration: {
    term: 'Do the ranges hold?',
    tech: 'Interval calibration',
    oneLiner: 'A range that claims 90% should contain about 9 in 10 real outcomes. Fewer means the ranges are over-confident.',
    body: ['Checked on unseen days by counting how often the real move landed inside each predicted band.'],
    example: ({ bundle }) => {
      const bt = bundle?.backtest;
      if (!bt) return NO_LAB;
      const c = bt.calibration.find((x) => Math.abs(x.nominal - 0.9) < 1e-6) ?? bt.calibration[bt.calibration.length - 1];
      return c && isNum(c.coverage) ? `${fmtNum(c.nominal * 100, 0)}% ranges caught ${fmtNum(c.coverage * 100, 0)}% of ${c.n.toLocaleString('en-US')} real outcomes.` : null;
    },
    ill: 'calibration',
    related: ['range', 'monte_carlo', 'backtest'],
    topic: 'uncertainty',
    icon: 'check',
  },
  nowcast: {
    term: 'Tomorrow’s model check',
    tech: 'Nowcast',
    oneLiner: 'A next-session estimate from signals seen before the Indian close (India funds and ADRs in New York, Asian chip markets), used to test the model, not to trade.',
    body: ['Most of the move it anticipates happens at the 09:15 open, before anyone could act on yesterday’s close, so it is labelled “not tradeable at the previous close”.'],
    example: ({ bundle }) => {
      const nc = bundle?.nowcast;
      if (!nc) return bundle?.backtest ? null : NO_LAB;
      return nc.nifty && isNum(nc.nifty.pred)
        ? `For ${fmtDate(nc.for_india_date)} (after the US session of ${fmtDate(nc.us_date)}): Nifty ${pctWord(simple(nc.nifty.pred))}${isNum(nc.nifty.lo90) && isNum(nc.nifty.hi90) ? `, 90% band ${pctWord(simple(nc.nifty.lo90))} to ${pctWord(simple(nc.nifty.hi90))}` : ''}.`
        : null;
    },
    ill: 'nowcast',
    related: ['etf_india', 'adr', 'lag', 'oos'],
    topic: 'uncertainty',
    icon: 'clock',
  },

  // ───────────── past crashes ─────────────
  drawdown: {
    term: 'Fall from the peak',
    tech: 'Drawdown',
    oneLiner: 'How far a price fell from its high to its lowest point afterwards, and how long it took to recover.',
    body: ['Two numbers matter: the depth of the fall and the time to get back to the old peak, which can be many years.'],
    example: ({ bundle }) => {
      const o = overlay(bundle, '^NDX', false);
      const dd = bundle?.history?.cases.flatMap((c) => c.drawdowns).find((d) => d.ticker === (o?.ticker ?? '^NDX') && d.peak_date === o?.peak_date) ?? null;
      if (!dd || !isNum(dd.drawdown)) return null;
      return `Dot-com: the Nasdaq-100 fell ${pctWord(dd.drawdown, 0)} from ${fmtDate(dd.peak_date, true)} to ${fmtDate(dd.trough_date, true)}${dd.recovered_date ? ` and regained its peak only in ${fmtDate(dd.recovered_date, true)}` : ''}.`;
    },
    ill: 'drawdown',
    related: ['replay', 'multiple_compression', 'car'],
    topic: 'history',
    icon: 'trendDown',
  },
  car: {
    term: 'Extra fall, added up',
    tech: 'CAR (cumulative abnormal return)',
    oneLiner: 'The part of a stock’s move beyond what the overall market explains, added up day by day after an event.',
    body: ['Measured against the stock’s usual relation to its market index, so a fall that the whole market shared does not count as abnormal.'],
    example: ({ bundle }) => {
      const es = bundle?.history?.event_studies.find((e) => e.id === 'es_deepseek');
      const g = es?.groups.find((x) => /^India AI/i.test(x.name)) ?? es?.groups[1];
      if (!es || !g) return null;
      const last = [...g.mean_car].reverse().find(isNum);
      const days = g.mean_car.length - 1 + es.window[0];
      return isNum(last) ? `DeepSeek (${fmtDate(es.date, true)}): ${g.name.replace(/\s*\(vs[^)]*\)/i, '')} stocks, ${pctWord(last, 0)} beyond the market after ${days} trading days (group average).` : null;
    },
    ill: 'car',
    related: ['event_study', 'contagion', 'drawdown'],
    topic: 'history',
    icon: 'pulse',
  },
  event_study: {
    term: 'Before-and-after comparison',
    tech: 'Event study',
    oneLiner: 'Compare what stocks actually did around an event with what the market alone would have predicted.',
    body: ['The window runs from 5 trading days before to 60 after, so you can see both the first reaction and whether it lasted.'],
    example: ({ bundle }) => {
      const es = bundle?.history?.event_studies ?? [];
      if (!es.length) return null;
      const ds = es.map((e) => e.date).sort();
      return `The data holds ${es.length} event studies, from ${fmtDate(ds[0], true)} to ${fmtDate(ds[ds.length - 1], true)}.`;
    },
    ill: 'event_study',
    related: ['car', 'contagion'],
    topic: 'history',
    icon: 'book',
  },
  contagion: {
    term: 'Trouble spreading to peers',
    tech: 'Contagion',
    oneLiner: 'When one company’s trust collapses, how much similar companies fall with it.',
    body: ['Measured as the peers’ abnormal move divided by the troubled company’s own move on the day.'],
    example: ({ bundle }) => {
      const us = bundle?.calibration?.contagion_us?.value;
      const ind = bundle?.calibration?.contagion_india?.value;
      if (!isNum(us) && !isNum(ind)) return null;
      return [
        isNum(us) ? `Super Micro (Oct 2024): US chip peers moved ${fmtNum(us * 100, 0)}% as much as Super Micro.` : '',
        isNum(ind) ? `Satyam (Jan 2009): Indian IT peers barely moved on average (ratio ${fmtNum(ind, 4)}).` : '',
      ]
        .filter(Boolean)
        .join(' ');
    },
    ill: 'contagion',
    related: ['restatement', 'car'],
    topic: 'history',
    icon: 'people',
  },

  // ───────────── data & sources ─────────────
  sourced: {
    term: 'Sourced',
    tech: 'SOURCED',
    oneLiner: 'Taken from a cited document, such as a company filing, an exchange notice or a reputable publication, with a link you can check.',
    body: ['Hover or tap a source tag to see its title and, where available, the exact quote behind the number.'],
    example: ({ bundle }) => {
      if (!bundle) return null;
      const prim = bundle.sources.filter((s) => s.verification === 'PRIMARY').length;
      return `${bundle.sources.length} sources in this build, ${prim} of them primary documents; ${statusCounts(bundle).SOURCED} labelled inputs are sourced.`;
    },
    ill: 'sources',
    illVariant: 'SOURCED',
    related: ['unverified', 'computed', 'user_assumption'],
    topic: 'data',
    icon: 'check',
  },
  unverified: {
    term: 'Unverified',
    tech: 'UNVERIFIED',
    oneLiner: 'A number found in a secondary source but not confirmed in a primary document. Treat it with care; you can change it.',
    body: ['It stays visible rather than hidden, so you can see exactly which inputs need a better source.'],
    example: ({ bundle }) => {
      if (!bundle) return null;
      const n = bundle.sources.filter((s) => s.verification === 'UNVERIFIED').length;
      return `${statusCounts(bundle).UNVERIFIED} labelled inputs are unverified; ${n} sources are marked unverified.`;
    },
    ill: 'sources',
    illVariant: 'UNVERIFIED',
    related: ['sourced', 'user_assumption'],
    topic: 'data',
    icon: 'warning',
  },
  user_assumption: {
    term: 'Your assumption',
    tech: 'USER ASSUMPTION',
    oneLiner: 'A setting the model needs but no one can measure, such as the size of a spending cut. It appears as a control you can change.',
    body: ['Every scenario setting is an assumption. Confidence scores fall as more of a result rests on them.'],
    example: ({ bundle }) => (bundle ? `${statusCounts(bundle).USER_ASSUMPTION} labelled inputs and settings in this build are assumptions.` : null),
    ill: 'sources',
    illVariant: 'USER_ASSUMPTION',
    related: ['scenario', 'confidence', 'sourced'],
    topic: 'data',
    icon: 'sliders',
  },
  computed: {
    term: 'Computed',
    tech: 'COMPUTED',
    oneLiner: 'Calculated by the app from market prices and company financials, for example betas, P/E ratios and drawdowns.',
    body: ['The formulas are in the model notes; the inputs are public price histories and reported financial statements.'],
    example: ({ bundle }) => {
      if (!bundle) return null;
      const c = statusCounts(bundle);
      return `${c.COMPUTED + c.DERIVED} labelled inputs are computed, besides every beta, P/E ratio, drawdown and event study. Prices run to ${fmtDate(bundle.meta.as_of)} (India) and ${fmtDate(bundle.meta.as_of_us)} (US).`;
    },
    ill: 'sources',
    illVariant: 'COMPUTED',
    related: ['sourced', 'beta', 'pe'],
    topic: 'data',
    icon: 'terminal',
  },
};

export const GLOSSARY: Record<GlossaryId, GlossaryEntry> = Object.fromEntries(
  (Object.entries(E) as [GlossaryId, Omit<GlossaryEntry, 'id'>][]).map(([id, e]) => [id, { id, ...e }]),
) as Record<GlossaryId, GlossaryEntry>;

export function entry(id: GlossaryId): GlossaryEntry {
  return GLOSSARY[id];
}

/** Safe example: any thrown error or non-finite leak becomes null. */
export function exampleFor(id: GlossaryId, d: LearnData): string | null {
  try {
    const s = GLOSSARY[id].example(d);
    if (!s || /NaN|undefined|Infinity|—/.test(s)) return null;
    return s;
  } catch {
    return null;
  }
}

/** Lower-cased text used by the Learn page search. */
export function searchText(e: GlossaryEntry): string {
  return [e.term, e.tech, e.oneLiner, ...e.body, e.formula ?? '', e.id.replace(/_/g, ' ')].join(' ').toLowerCase();
}
