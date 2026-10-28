import { describe, expect, it } from 'vitest';
import type { ParamSpec, Preset } from '../../../types/data';
import { caseStartKey, LATER_EVENTS_AFTER, moveRatio } from '../historyUtil';
import { paramDefault } from '../model/AssumptionRegister';

describe('caseStartKey', () => {
  it('parses ISO, day-month-year, month-year, year ranges and decades', () => {
    expect(caseStartKey('2026-10-14')).toBe('2026-10-14');
    expect(caseStartKey('27-Jan-2025')).toBe('2025-01-27');
    expect(caseStartKey('7 January 2009')).toBe('2009-01-07');
    expect(caseStartKey('Jan 2009')).toBe('2009-01-01');
    expect(caseStartKey('Mar-2000 – Oct-2002')).toBe('2000-03-01');
    expect(caseStartKey('Nov-2021 – Dec-2022')).toBe('2021-11-01');
    expect(caseStartKey('2000–2002')).toBe('2000-01-01');
    expect(caseStartKey('1840s')).toBe('1840-01-01');
    expect(caseStartKey('')).toBe('9999-12-31');
    expect(caseStartKey(null)).toBe('9999-12-31');
  });

  it('groups DeepSeek itself as historical and later events after it', () => {
    expect(caseStartKey('27-Jan-2025') > LATER_EVENTS_AFTER).toBe(false);
    expect(caseStartKey('2025-11-20') > LATER_EVENTS_AFTER).toBe(true);
    expect(caseStartKey('Feb 2026') > LATER_EVENTS_AFTER).toBe(true);
  });
});

describe('moveRatio', () => {
  it('divides same-sign moves and guards zero / non-finite inputs', () => {
    expect(moveRatio(-0.3, -0.15)).toBeCloseTo(2, 12);
    expect(moveRatio(-0.3, 0)).toBeNull();
    expect(moveRatio(null, -0.1)).toBeNull();
    expect(moveRatio(Number.NaN, -0.1)).toBeNull();
  });
});

describe('paramDefault', () => {
  const spec = { key: 'c', value: 0.3 } as ParamSpec;
  it('uses the per-horizon override when the preset has one', () => {
    const preset = { horizon_overrides: { '12M': { c: { value: 0.35 } } } } as unknown as Preset;
    expect(paramDefault(preset, spec, '12M')).toBe(0.35);
    expect(paramDefault(preset, spec, '1D')).toBe(0.3);
  });
  it('falls back to the spec value without overrides', () => {
    expect(paramDefault({ horizon_overrides: null } as unknown as Preset, spec, '1M')).toBe(0.3);
    expect(paramDefault(undefined, spec, '1M')).toBe(0.3);
  });
});
