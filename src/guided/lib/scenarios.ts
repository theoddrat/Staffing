// Plain-language copy for the guided scenario picker and the "Customize" drawer.
// Every sentence that quotes a number derives it from the data bundle or the current slider value.
import type { DataBundle } from '../../types/data';
import type { ParamValue, PresetId } from '../../types/engine';
import type { GlossaryId } from '../../learn/ids';
import { dollars, pctAbs } from './format';

export interface ScenarioCopy {
  id: PresetId;
  title: string;
  blurb: string; // one line, no jargon
  art: 'capex' | 'guidance' | 'restatement' | 'multiple' | 'credit' | 'replay' | 'fullpop';
  term: GlossaryId;
  lowConfidenceNote?: string;
}

export const SCENARIOS: ScenarioCopy[] = [
  {
    id: 'fullpop',
    title: 'Full AI bubble pop',
    blurb: 'Big Tech cuts AI spending, AI stocks get cheaper and AI borrowers get squeezed, all at once.',
    art: 'fullpop',
    term: 'full_pop',
    lowConfidenceNote: 'Includes the AI-debt leg, which rests on thin data.',
  },
  {
    id: 'capex',
    title: 'Big Tech cuts AI spending',
    blurb: 'Microsoft, Alphabet, Amazon, Meta and Oracle spend less on AI data centres, so their suppliers sell less.',
    art: 'capex',
    term: 'capex_cut',
  },
  {
    id: 'guidance',
    title: 'A chipmaker warns on sales',
    blurb: 'One AI chip company tells investors its sales will be lower than expected; its peers fall in sympathy.',
    art: 'guidance',
    term: 'guidance_cut',
  },
  {
    id: 'restatement',
    title: 'An accounting scandal',
    blurb: 'A company admits its profits were overstated, and investors stop trusting its numbers.',
    art: 'restatement',
    term: 'restatement',
  },
  {
    id: 'multiple',
    title: 'AI stocks get cheaper (lower P/E)',
    blurb: 'Profits stay the same, but investors pay less for every rupee or dollar of AI earnings.',
    art: 'multiple',
    term: 'multiple_compression',
  },
  {
    id: 'credit',
    title: 'AI borrowers get squeezed',
    blurb: 'Debt-heavy AI cloud firms face much higher interest costs and stop buying as much equipment.',
    art: 'credit',
    term: 'credit_event',
    lowConfidenceNote: 'Low confidence: few past examples to learn from.',
  },
  {
    id: 'replay',
    title: 'Replay a past crash',
    blurb: 'Take the real fall in US chip and tech stocks from a past crash and apply it to today’s Indian companies.',
    art: 'replay',
    term: 'replay',
  },
];

export function scenarioCopy(id: PresetId): ScenarioCopy {
  return SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0];
}

/** Short, friendly names for replay windows (fall back to the bundle label). */
export const WINDOW_SHORT: Record<string, string> = {
  DOTCOM: 'Dot-com bust 2000–02',
  DOTCOM12M: 'Dot-com, first year',
  TELECOM: 'Telecom bust 2002',
  GFC: '2008 financial crisis',
  COVID: 'COVID crash 2020',
  Y2022: '2022 rate shock',
  SMCI24: 'Super Micro scare 2024',
  DEEPSEEK: 'DeepSeek day 2025',
  NOV2025: 'Nvidia reversal Nov-2025',
  OCT2026: 'Oct-2026 AI funding scare',
};

export interface ParamCopy {
  label: string;
  term?: GlossaryId;
  /** Live sentence for the current value (null when nothing useful can be said). */
  sentence?: (v: ParamValue, ctx: ParamContext) => string | null;
}

export interface ParamContext {
  bundle: DataBundle;
  preset: PresetId;
  values: Record<string, ParamValue>;
}

function num(v: ParamValue): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function hyperscalerCapexUsd(bundle: DataBundle): number | null {
  const xs = bundle.origins.map((o) => o.capex_ttm_usd).filter((x): x is number => typeof x === 'number' && x > 0);
  return xs.length ? xs.reduce((a, b) => a + b, 0) : null;
}

function nameOf(bundle: DataBundle, ticker: string | null): string {
  if (!ticker) return 'the company';
  const t = bundle.india.find((x) => x.ticker === ticker);
  return t?.name ?? bundle.securities[ticker]?.name ?? ticker;
}

export const PARAM_COPY: Record<string, ParamCopy> = {
  c: {
    label: 'How much Big Tech cuts AI spending',
    term: 'capex',
    sentence: (v, { bundle }) => {
      const c = num(v);
      const tot = hyperscalerCapexUsd(bundle);
      if (c === null) return null;
      return tot
        ? `A ${pctAbs(c)} cut means about ${dollars(c * tot)} less spent per year (out of ${dollars(tot)} last year).`
        : `Big Tech spends ${pctAbs(c)} less on AI data centres.`;
    },
  },
  psi_supplier: {
    label: 'How much of the cut hits suppliers’ sales',
    sentence: (v) => (num(v) === null ? null : `Suppliers lose ${num(v)!.toFixed(1)}× the spending cut in sales (1.0 = one for one).`),
  },
  kappa: {
    label: 'Extra price drop when profits disappoint',
    term: 'multiple_compression',
    sentence: (v) => {
      const k = num(v);
      if (k === null) return null;
      return k === 0
        ? 'Investors pay the same price per dollar of profit; only profits fall.'
        : `For every 10% fall in profit, investors also pay about ${(k * 10).toFixed(0)}% less per dollar of profit.`;
    },
  },
  phi_it: {
    label: 'How sharply US tech clients cut IT budgets',
    term: 'ear',
    sentence: (v) => (num(v) === null ? null : `If US tech clients’ sales fall 10%, they cut spending on Indian IT services by about ${(num(v)! * 10).toFixed(0)}%.`),
  },
  psi_india_dc: {
    label: 'How much Indian data-centre orders follow',
    term: 'capex',
    sentence: (v) =>
      num(v) === null ? null : `Indian data-centre and AI-equipment orders fall ${num(v)!.toFixed(2)}× as much as Big Tech’s spending cut.`,
  },
  lambda_india: {
    label: 'How much Indian AI-theme stocks lose their extra premium',
    term: 'ai_premium',
    sentence: (v) =>
      num(v) === null ? null : `Indian stocks give back ${pctAbs(num(v)!)} of the extra price-to-earnings they gained since ChatGPT launched.`,
  },
  f_override: {
    label: 'How much the rupee weakens',
    term: 'inr_depr',
    sentence: (v) => (num(v) === null ? 'Automatic: estimated from how the rupee moved in past US sell-offs.' : `The rupee loses ${pctAbs(num(v)!, 1)} against the dollar.`),
  },
  g: {
    label: 'How much the chipmaker cuts its sales forecast',
    term: 'guidance_cut',
    sentence: (v, { bundle, values }) => {
      const g = num(v);
      if (g === null) return null;
      const t = typeof values.target === 'string' ? values.target : null;
      const ol = t ? bundle.securities[t]?.op_leverage?.value ?? null : null;
      const name = nameOf(bundle, t);
      return ol
        ? `${name} expects ${pctAbs(g)} lower sales, which cuts its profit by about ${pctAbs(Math.min(g * ol, 0.95))} (fixed costs amplify it ${ol.toFixed(1)}×).`
        : `${name} expects ${pctAbs(g)} lower sales.`;
    },
  },
  sympathy: {
    label: 'How much other chip stocks fall in sympathy',
    term: 'beta',
    sentence: (v) => (num(v) === null ? null : `Other chip stocks move ${num(v)!.toFixed(2)}× their usual co-movement with the warning company.`),
  },
  target: { label: 'Which company', sentence: (v, { bundle }) => (typeof v === 'string' ? nameOf(bundle, v) : null) },
  r: {
    label: 'How much profit is restated down',
    term: 'restatement',
    sentence: (v, { bundle, values }) =>
      num(v) === null ? null : `${nameOf(bundle, typeof values.target === 'string' ? values.target : null)} admits profits were about ${pctAbs(num(v)!)} lower than reported.`,
  },
  d: {
    label: 'Lost trust: how much less investors pay',
    term: 'pe',
    sentence: (v) => (num(v) === null ? null : `Investors pay ${pctAbs(num(v)!)} less for each rupee of its remaining profit.`),
  },
  contagion: {
    label: 'How much similar companies fall with it',
    term: 'contagion',
    sentence: (v) =>
      num(v) === null
        ? 'Automatic: measured from Super Micro (2024) for US names and Satyam (2009) for Indian names.'
        : `Similar companies fall ${num(v)!.toFixed(2)}× as much as the company itself.`,
  },
  mode: {
    label: 'How far AI price-to-earnings falls',
    term: 'multiple_compression',
    sentence: (v, { bundle }) => {
      const ai = bundle.history.ai_basket_pe;
      if (v === 'calibrated')
        return typeof ai.implied_drawdown === 'number'
          ? `Uses history: at today’s P/E (${ai.now?.toFixed(1)}x), past bubbles fell about ${pctAbs(ai.implied_drawdown)} peak to trough.`
          : 'Uses the historical link between starting P/E and the size of the crash.';
      if (v === 'median')
        return ai.now !== null && ai.pre_chatgpt_median !== null
          ? `Back toward the pre-ChatGPT level (${ai.pre_chatgpt_median.toFixed(1)}x vs ${ai.now.toFixed(1)}x today).`
          : 'Back toward the pre-ChatGPT level.';
      if (v === 'multiple') return 'Toward a P/E you choose below.';
      return null;
    },
  },
  lambda: {
    label: 'How much of that fall happens',
    term: 'multiple_compression',
    sentence: (v, { bundle, values }) => {
      const l = num(v);
      if (l === null) return null;
      const ai = bundle.history.ai_basket_pe;
      if (values.mode === 'calibrated' && typeof ai.implied_drawdown === 'number')
        return `AI stocks lose about ${pctAbs(l * Math.abs(ai.implied_drawdown))} of their price from a lower P/E (${pctAbs(l)} of the historical ${pctAbs(ai.implied_drawdown)}).`;
      return `${pctAbs(l)} of the way to the target P/E.`;
    },
  },
  target_pe: { label: 'Your target P/E', term: 'pe', sentence: (v) => (num(v) === null ? null : `AI stocks priced at ${num(v)!.toFixed(0)}× earnings.`) },
  per_name: { label: 'Use each company’s own history', sentence: (v) => (v ? 'Each company reverts to its own pre-ChatGPT P/E.' : 'All AI stocks move together.') },
  floor_zero: { label: 'Only allow P/E to fall', sentence: (v) => (v ? 'Prices can only get cheaper, never dearer.' : 'Cheap stocks may also re-rate upward.') },
  ds_bps: {
    label: 'How much AI borrowers’ interest rates jump',
    term: 'credit_event',
    sentence: (v) => (num(v) === null ? null : `Borrowing costs rise by ${(num(v)! / 100).toFixed(1)} percentage points (${num(v)!.toFixed(0)} basis points).`),
  },
  duration: { label: 'How long their debt lasts', sentence: (v) => (num(v) === null ? null : `About ${num(v)!.toFixed(0)} years of higher interest, priced in today.`) },
  k: {
    label: 'How much indebted AI clouds cut buying',
    term: 'credit_event',
    sentence: (v) => (num(v) === null ? null : `Debt-stressed AI cloud firms buy ${pctAbs(num(v)!)} less equipment.`),
  },
  d_credit: { label: 'Extra price drop for the stressed borrowers', sentence: (v) => (num(v) === null ? null : `Their shares lose a further ${pctAbs(num(v)!)} as investors demand more safety.`) },
  window: {
    label: 'Which past crash',
    term: 'replay',
    sentence: (v, { bundle }) => {
      const w = bundle.history.replay_windows.find((x) => x.id === v);
      if (!w) return null;
      const sox = w.moves.SOX;
      const ndx = w.moves.NDX;
      const fmt = (x: number | null | undefined) => (typeof x === 'number' ? `${x < 0 ? '−' : '+'}${Math.abs((Math.exp(x) - 1) * 100).toFixed(0)}%` : '—');
      return `${w.label}: US chip stocks ${fmt(sox)}, Nasdaq-100 ${fmt(ndx)}.`;
    },
  },
};

export function paramCopy(key: string, fallbackLabel: string): ParamCopy {
  return PARAM_COPY[key] ?? { label: fallbackLabel };
}
