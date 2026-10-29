// Pure helpers for the past-crashes timeline: ordering, eras with gaps, crash-type visuals and
// the links from a case to its event study and to a replayable window.
import type { CrashType, DataBundle, EventStudy, HistoryCase, ReplayWindow } from '../../types/data';
import type { GlossaryId } from '../../learn/ids';
import type { IconName } from '../icons';

export const CRASH_VIS: Record<CrashType, { label: string; blurb: string; icon: IconName; color: string; term: GlossaryId }> = {
  capex_overbuild: { label: 'Overbuilding', blurb: 'Too much was built on hopes of demand that came later or never.', icon: 'factory', color: 'var(--ch-capex)', term: 'capex' },
  multiple_compression: { label: 'Valuations shrink', blurb: 'Investors suddenly paid much less for the same profits.', icon: 'tag', color: 'var(--ch-premium)', term: 'multiple_compression' },
  earnings_collapse: { label: 'Profits collapse', blurb: 'Sales and profits fell, so prices followed.', icon: 'trendDown', color: 'var(--ch-revenue)', term: 'eps' },
  fraud_trust: { label: 'Fraud & trust', blurb: 'Numbers turned out to be wrong, and trust broke.', icon: 'warning', color: 'var(--g-down)', term: 'restatement' },
  credit_liquidity: { label: 'Credit squeeze', blurb: 'Borrowing got hard or expensive for the companies at the centre.', icon: 'bank', color: 'var(--ch-credit)', term: 'credit_event' },
};

const MON: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const p2 = (n: number) => String(n).padStart(2, '0');

/** First date written in a period string: "7-Jan-2009", "Mar-2000 – Oct-2002", "2000 – 2002" (year only → mid-year). */
export function periodStart(period: string): string | null {
  const m = /(?:(\d{1,2})-)?([A-Za-z]{3})-(\d{4})|(\d{4})/.exec(period);
  if (!m) return null;
  if (m[4]) return `${m[4]}-07-01`;
  const mon = MON[m[2].toLowerCase()];
  if (!mon) return null;
  return `${m[3]}-${p2(mon)}-${p2(m[1] ? Number(m[1]) : 1)}`;
}

/** Sortable start date of a case: the first date in its period, else its earliest drawdown peak. */
export function caseStart(c: HistoryCase): string {
  const p = periodStart(c.period);
  if (p) return p;
  const peaks = c.drawdowns.map((d) => d.peak_date).filter((d): d is string => !!d && /^\d{4}-\d{2}-\d{2}/.test(d)).sort();
  return peaks[0] ?? '9999-01-01';
}

export const yearOf = (iso: string) => Number(iso.slice(0, 4));
const years = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / (365.25 * 864e5);

export interface Era {
  key: string;
  label: string;
  cases: HistoryCase[];
  /** gap in years from the previous era's last case to this era's first case (null for the first era) */
  gapBefore: number | null;
  cluster: boolean;
}

/** Group cases into eras separated by gaps longer than `gapYears`. */
export function eras(cases: HistoryCase[], gapYears = 1.5): Era[] {
  const sorted = [...cases].sort((a, b) => caseStart(a).localeCompare(caseStart(b)));
  const out: Era[] = [];
  let prevStart: string | null = null;
  for (const c of sorted) {
    const s = caseStart(c);
    const gap = prevStart ? years(prevStart, s) : null;
    if (!out.length || (gap !== null && gap > gapYears)) out.push({ key: c.id, label: '', cases: [c], gapBefore: out.length ? gap : null, cluster: false });
    else out[out.length - 1].cases.push(c);
    prevStart = s;
  }
  for (const e of out) {
    const y0 = yearOf(caseStart(e.cases[0]));
    const y1 = yearOf(caseStart(e.cases[e.cases.length - 1]));
    e.cluster = e.cases.length >= 4;
    e.label = y0 < 1900 ? `${Math.floor(y0 / 10) * 10}s` : y0 === y1 ? String(y0) : `${y0}–${String(y1).slice(2)}`;
  }
  return out;
}

/** Months spanned by an era (first to last case). */
export function eraMonths(e: Era): number {
  return Math.max(1, Math.round(years(caseStart(e.cases[0]), caseStart(e.cases[e.cases.length - 1])) * 12));
}

const ES_OVERRIDE: Record<string, string> = { smci2024: 'es_smci_ey', bear2022: 'es_2022', telecom: 'es_worldcom' };

/** The event study that belongs to a case (explicit links, then id match, then date inside the case). */
export function caseStudy(c: HistoryCase, studies: EventStudy[]): EventStudy | null {
  const byId = new Map(studies.map((e) => [e.id, e]));
  const o = ES_OVERRIDE[c.id];
  if (o && byId.has(o)) return byId.get(o)!;
  if (byId.has(`es_${c.id}`)) return byId.get(`es_${c.id}`)!;
  const head = c.id.split(/_|\d/)[0];
  const pre = studies.find((e) => e.id.startsWith(`es_${head}`) && Math.abs(yearOf(e.date) - yearOf(caseStart(c))) <= 1);
  if (pre) return pre;
  const s = caseStart(c);
  const end = c.drawdowns.map((d) => d.trough_date).filter((d): d is string => !!d).sort().pop() ?? s;
  return studies.find((e) => e.date >= s && e.date <= end) ?? null;
}

const REPLAY_OVERRIDE: Record<string, string> = {
  dotcom: 'DOTCOM',
  telecom: 'TELECOM',
  bear2022: 'Y2022',
  smci2024: 'SMCI24',
  deepseek: 'DEEPSEEK',
  nvda_nov2025: 'NOV2025',
  openai_oct2026: 'OCT2026',
  coreweave_oct2026: 'OCT2026',
  lam_oct2026: 'OCT2026',
};

/** A replayable window for a case, if the data has one. */
export function caseReplay(c: HistoryCase, windows: ReplayWindow[]): ReplayWindow | null {
  const id = REPLAY_OVERRIDE[c.id];
  return (id ? windows.find((w) => w.id === id) : null) ?? null;
}

/** Case id for a `historyFocus` string that names a case or one of the event studies. */
export function focusCase(b: DataBundle, focus: string | null | undefined, matched: { caseId: string | null; eventId: string | null }): string | null {
  if (!focus) return null;
  if (matched.caseId) return matched.caseId;
  if (matched.eventId) {
    const es = b.history.event_studies.find((e) => e.id === matched.eventId);
    if (es) {
      const c = b.history.cases.find((x) => caseStudy(x, b.history.event_studies)?.id === es.id);
      if (c) return c.id;
    }
  }
  return null;
}
