// Sorting / filtering for the "Who gets hit" company cards.
import type { Tier } from '../../types/data';
import type { IndiaResult } from '../../types/engine';

export type SortKey = 'fall' | 'gap' | 'money' | 'name';

export const SORT_LABEL: Record<SortKey, string> = {
  fall: 'Biggest fall first',
  gap: 'Biggest overreaction first',
  money: 'Most money at risk first',
  name: 'A to Z',
};

const nz = (x: number | null | undefined, fallback: number) => (typeof x === 'number' && Number.isFinite(x) ? x : fallback);

export function sortCompanies(rows: IndiaResult[], key: SortKey): IndiaResult[] {
  const out = [...rows];
  switch (key) {
    case 'fall':
      return out.sort((a, b) => nz(a.market_move, 0) - nz(b.market_move, 0) || a.display.localeCompare(b.display));
    case 'gap':
      return out.sort((a, b) => nz(a.gap, Infinity) - nz(b.gap, Infinity) || a.display.localeCompare(b.display));
    case 'money':
      return out.sort((a, b) => nz(a.mcap_change_inr_cr, 0) - nz(b.mcap_change_inr_cr, 0) || a.display.localeCompare(b.display));
    case 'name':
      return out.sort((a, b) => a.name.localeCompare(b.name));
  }
}

export function filterTier(rows: IndiaResult[], tier: Tier | 'ALL'): IndiaResult[] {
  return tier === 'ALL' ? rows : rows.filter((r) => r.tier === tier);
}

export function searchCompanies<T extends { ticker: string; display: string; name: string }>(rows: T[], q: string, limit = 8): T[] {
  const s = q.trim().toLowerCase();
  if (!s) return [];
  const scored = rows
    .map((r) => {
      const d = r.display.toLowerCase();
      const n = r.name.toLowerCase();
      const t = r.ticker.toLowerCase();
      let score = -1;
      if (d === s || t === s) score = 100;
      else if (d.startsWith(s) || t.startsWith(s)) score = 80;
      else if (n.startsWith(s)) score = 70;
      else if (n.split(/[\s()&.-]+/).some((w) => w.startsWith(s))) score = 60;
      else if (n.includes(s) || d.includes(s)) score = 40;
      return { r, score };
    })
    .filter((x) => x.score >= 0)
    .sort((a, b) => b.score - a.score || a.r.name.localeCompare(b.r.name));
  return scored.slice(0, limit).map((x) => x.r);
}
