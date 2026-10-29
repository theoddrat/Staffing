// One-line scenario headline: "US chips −44% · Nifty −4% · India −₹2.6 lakh cr".
import type { ScenarioResult } from '../../types/engine';
import { isNum } from '../../lib/format';
import { pct, rupeesCr } from './format';

export interface HeadlineItem {
  id: 'chips' | 'nifty' | 'india';
  label: string;
  value: string;
  x: number | null; // the raw number behind the value (fraction or ₹ crore)
}

export function headlineItems(result: ScenarioResult): HeadlineItem[] {
  const f = result.factors;
  const tot = result.totals.india_mcap_change_inr_cr;
  return [
    { id: 'chips', label: 'US chips', value: pct(f.SOX, 0), x: isNum(f.SOX) ? f.SOX : null },
    { id: 'nifty', label: 'Nifty', value: pct(f.NIFTY, 0), x: isNum(f.NIFTY) ? f.NIFTY : null },
    {
      id: 'india',
      label: 'India',
      value: isNum(tot) && Math.abs(tot) >= 1 ? rupeesCr(tot, { sign: true }) : 'no change',
      x: isNum(tot) ? tot : null,
    },
  ];
}

export function headlineText(result: ScenarioResult): string {
  return headlineItems(result)
    .map((i) => `${i.label} ${i.value}`)
    .join(' · ');
}

/** True when the scenario moves (almost) nothing — worth explaining to the user. */
export function isFlat(result: ScenarioResult): boolean {
  const tot = result.totals.india_mcap_change_inr_cr;
  return Math.abs(result.factors.SOX) < 0.0005 && (!isNum(tot) || Math.abs(tot) < 1);
}

/** Sum of the Indian companies' market value (₹ crore) — the base for "share of value lost". */
export function indiaMcapTotal(result: ScenarioResult): number | null {
  const xs = result.india.map((r) => r.mcap_inr_cr).filter(isNum);
  return xs.length ? xs.reduce((a, b) => a + b, 0) : null;
}
