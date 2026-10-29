// One visual vocabulary for the guided UI (and any terminal panel that wants it): every channel,
// tier and origin group has a plain-language label, a short explanation, an icon and a colour.
// Colours are CSS variables defined in src/styles/guided-tokens.css (dark, single-theme).
import type { OriginGroup, Tier } from '../types/data';
import type { Channel } from '../types/engine';
import type { IconName } from './icons';

export interface VisualDef {
  label: string; // plain words, shown first
  tech: string; // the technical name, shown second / in tooltips
  blurb: string; // one sentence a first-time user understands
  icon: IconName;
  color: string; // CSS var(...)
}

export const CHANNEL_VIS: Record<Channel | 'premium', VisualDef> = {
  parent: {
    label: 'Parent company falls',
    tech: 'Parent link (b_P · x_P)',
    blurb: 'The Indian company is majority-owned by a global firm; when the parent’s shares drop, investors re-price the Indian arm too.',
    icon: 'building',
    color: 'var(--ch-parent)',
  },
  revenue: {
    label: 'US tech clients cut IT budgets',
    tech: 'Revenue channel (EaR from hi-tech vertical)',
    blurb: 'Part of its revenue comes from US technology companies; if their sales fall, they spend less on Indian IT services.',
    icon: 'laptop',
    color: 'var(--ch-revenue)',
  },
  capex: {
    label: 'Fewer data-centre orders',
    tech: 'Capex-order channel',
    blurb: 'It sells equipment or services for AI data centres; when Big Tech cuts AI spending, those orders shrink.',
    icon: 'server',
    color: 'var(--ch-capex)',
  },
  sentiment: {
    label: 'Investor mood follows US AI stocks',
    tech: 'Sentiment (b_SOX · x_SOX + b_NDX · x_NDX)',
    blurb: 'Even without a business link, the share price has tended to move with US chip and tech stocks the next day.',
    icon: 'pulse',
    color: 'var(--ch-sentiment)',
  },
  fx_fpi: {
    label: 'Foreign investors pull money out of India',
    tech: 'FX / FPI (b_N · x_Nifty)',
    blurb: 'A US sell-off makes global funds sell Indian shares, which drags the whole Nifty — and this stock with it.',
    icon: 'globe',
    color: 'var(--ch-fpi)',
  },
  fx: {
    label: 'A weaker rupee helps exporters',
    tech: 'FX offset (margin bps per 1% INR)',
    blurb: 'When the rupee falls, dollar revenue is worth more rupees, which cushions IT exporters’ profits.',
    icon: 'rupee',
    color: 'var(--ch-fx)',
  },
  credit: {
    label: 'AI borrowers get squeezed',
    tech: 'Credit channel (spreads × duration × net debt)',
    blurb: 'Heavily indebted AI cloud firms face higher borrowing costs and buy less equipment.',
    icon: 'bank',
    color: 'var(--ch-credit)',
  },
  own: {
    label: 'Its own accounting shock',
    tech: 'Own shock (restatement)',
    blurb: 'The company itself restates profits, so its own price takes the direct hit.',
    icon: 'warning',
    color: 'var(--ch-own)',
  },
  premium: {
    label: 'The extra “AI premium” in its price fades',
    tech: 'AI-premium unwind d_i',
    blurb: 'If it trades at a much higher price-to-earnings ratio than before ChatGPT, part of that extra could disappear.',
    icon: 'tag',
    color: 'var(--ch-premium)',
  },
};

export const TIER_VIS: Record<Tier, VisualDef> = {
  A: {
    label: 'Indian arm of a global company',
    tech: 'Tier A — parent link',
    blurb: 'Listed in India but controlled by a global parent (Oracle, GE Vernova, Hitachi, Siemens Energy, ABB, Schneider).',
    icon: 'building',
    color: 'var(--tier-a)',
  },
  B: {
    label: 'IT services for US tech',
    tech: 'Tier B — revenue link',
    blurb: 'Software and engineering services firms that earn part of their revenue from US technology clients.',
    icon: 'laptop',
    color: 'var(--tier-b)',
  },
  C: {
    label: 'AI & data-centre build-out',
    tech: 'Tier C — capex chain',
    blurb: 'Makers of AI servers, cables, fibre, power gear and data centres that benefit when AI spending rises.',
    icon: 'server',
    color: 'var(--tier-c)',
  },
  D: {
    label: 'Electronics & chip theme',
    tech: 'Tier D — semiconductor theme',
    blurb: 'Electronics manufacturers and chip-design firms whose shares trade on the India semiconductor story.',
    icon: 'chip',
    color: 'var(--tier-d)',
  },
};

export const GROUP_VIS: Record<OriginGroup, VisualDef> = {
  chips: { label: 'Chipmakers', tech: 'chips', blurb: 'Companies that design or make AI chips and memory (NVIDIA, TSMC, Micron…).', icon: 'chip', color: 'var(--g-accent)' },
  hyperscalers: { label: 'Big Tech AI spenders', tech: 'hyperscalers', blurb: 'The cloud giants that buy most AI chips (Microsoft, Alphabet, Amazon, Meta, Oracle).', icon: 'cloud', color: 'var(--ch-parent)' },
  infra: { label: 'Power & data-centre gear', tech: 'AI infrastructure', blurb: 'Power, cooling and grid suppliers plus AI cloud renters (Vertiv, GE Vernova, CoreWeave…).', icon: 'bolt', color: 'var(--ch-capex)' },
  software: { label: 'AI software', tech: 'software', blurb: 'Software companies priced on AI growth (Palantir, ServiceNow, Salesforce, Adobe).', icon: 'code', color: 'var(--ch-revenue)' },
};

/** Confidence grade → plain words + colour. */
export const CONFIDENCE_VIS: Record<'HIGH' | 'MED' | 'LOW', { label: string; blurb: string; color: string; dots: number }> = {
  HIGH: { label: 'Fairly reliable', blurb: 'Past data fits well and few inputs are guesses.', color: 'var(--g-up)', dots: 3 },
  MED: { label: 'Use with care', blurb: 'Some inputs are assumptions or the fit is loose.', color: 'var(--g-accent)', dots: 2 },
  LOW: { label: 'Rough guide only', blurb: 'Short history, weak fit or mostly assumed inputs.', color: 'var(--g-down)', dots: 1 },
};
