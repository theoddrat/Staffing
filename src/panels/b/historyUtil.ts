// Pure helpers for the HISTORY panel (unit-tested).

/** Events strictly after this date are grouped as "later AI drawdowns" (the DeepSeek shock day). */
export const LATER_EVENTS_AFTER = '2025-01-27';

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

/**
 * Best-effort sortable start key (YYYY-MM-DD) from a free-text period such as
 * "2026-10-14", "Jan 2009", "27-Jan-2025", "2000–2002" or "1840s".
 * Returns '9999-12-31' when no year is present (sorts last).
 */
export function caseStartKey(period: string | null | undefined): string {
  if (!period) return '9999-12-31';
  const iso = period.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dMonY = period.match(/(\d{1,2})[\s-]+([A-Za-z]{3})[A-Za-z]*[\s-]+(\d{4})/);
  if (dMonY && MONTHS[dMonY[2].toLowerCase()]) {
    return `${dMonY[3]}-${MONTHS[dMonY[2].toLowerCase()]}-${dMonY[1].padStart(2, '0')}`;
  }
  const monY = period.match(/([A-Za-z]{3})[A-Za-z]*\.?[\s-]+(\d{4})/);
  if (monY && MONTHS[monY[1].toLowerCase()]) return `${monY[2]}-${MONTHS[monY[1].toLowerCase()]}-01`;
  const y = period.match(/(\d{4})/);
  if (y) return `${y[1]}-01-01`;
  return '9999-12-31';
}

/** Ratio of a scenario move to a historical reference move (both simple returns, same sign expected). */
export function moveRatio(scenario: number | null | undefined, reference: number | null | undefined): number | null {
  if (typeof scenario !== 'number' || typeof reference !== 'number') return null;
  if (!Number.isFinite(scenario) || !Number.isFinite(reference) || Math.abs(reference) < 1e-12) return null;
  return scenario / reference;
}
