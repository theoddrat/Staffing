import { describe, expect, it } from 'vitest';
import type { IndiaResult } from '../../types/engine';
import { filterTier, searchCompanies, sortCompanies } from '../lib/sort';

const row = (display: string, name: string, tier: 'A' | 'B' | 'C' | 'D', move: number, gap: number | null, money: number | null) =>
  ({ ticker: `${display}.NS`, display, name, tier, market_move: move, gap, mcap_change_inr_cr: money }) as unknown as IndiaResult;

const rows = [
  row('INFY', 'Infosys', 'B', -0.054, -0.061, -24765),
  row('NETWEB', 'Netweb Technologies India', 'C', -0.165, 0.009, -4327),
  row('TCS', 'Tata Consultancy Services', 'B', -0.026, null, -23133),
  row('GVT&D', 'GE Vernova T&D India', 'A', -0.157, -0.064, -16335),
];

describe('company sorting & filtering', () => {
  it('biggest fall first', () => {
    expect(sortCompanies(rows, 'fall').map((r) => r.display)).toEqual(['NETWEB', 'GVT&D', 'INFY', 'TCS']);
  });
  it('biggest overreaction (most negative gap) first, unknown gaps last', () => {
    expect(sortCompanies(rows, 'gap').map((r) => r.display)).toEqual(['GVT&D', 'INFY', 'NETWEB', 'TCS']);
  });
  it('most money at risk first', () => {
    expect(sortCompanies(rows, 'money').map((r) => r.display)).toEqual(['INFY', 'TCS', 'GVT&D', 'NETWEB']);
  });
  it('A to Z by name, and sorting never mutates the input', () => {
    const before = rows.map((r) => r.display);
    expect(sortCompanies(rows, 'name').map((r) => r.display)).toEqual(['GVT&D', 'INFY', 'NETWEB', 'TCS']);
    expect(rows.map((r) => r.display)).toEqual(before);
  });
  it('tier filter', () => {
    expect(filterTier(rows, 'B').map((r) => r.display)).toEqual(['INFY', 'TCS']);
    expect(filterTier(rows, 'ALL')).toHaveLength(4);
  });
  it('search ranks exact symbols, then prefixes, then words in the name', () => {
    expect(searchCompanies(rows, 'tcs')[0].display).toBe('TCS');
    expect(searchCompanies(rows, 'net').map((r) => r.display)).toEqual(['NETWEB']);
    expect(searchCompanies(rows, 'vernova').map((r) => r.display)).toEqual(['GVT&D']);
    expect(searchCompanies(rows, 'tata').map((r) => r.display)).toEqual(['TCS']);
    expect(searchCompanies(rows, '  ')).toEqual([]);
  });
});
