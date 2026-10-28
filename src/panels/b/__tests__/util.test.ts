import { describe, expect, it } from 'vitest';
import type { DataBundle, Quantity } from '../../../types/data';
import {
  collectRegister,
  effectiveValue,
  logToSimple,
  matchFocus,
  mean,
  needsAttention,
  olsLine,
  prePostAverages,
  robustRange,
  sliderBounds,
  sourceUsage,
  symmetricBound,
  windowDays,
  worstStatus,
} from '../util';

const q = (over: Partial<Quantity>): Quantity => ({
  id: 'X.q',
  label: 'q',
  value: 0.5,
  unit: 'frac',
  status: 'SOURCED',
  parts: [],
  src: [],
  note: null,
  editable: false,
  min: null,
  max: null,
  step: null,
  ...over,
});

describe('numeric helpers', () => {
  it('logToSimple converts and is null-safe', () => {
    expect(logToSimple(Math.log(0.5))).toBeCloseTo(-0.5, 12);
    expect(logToSimple(null)).toBeNull();
    expect(logToSimple(Number.NaN)).toBeNull();
  });

  it('mean skips non-finite values', () => {
    expect(mean([1, null, 3, Number.NaN, undefined])).toBe(2);
    expect(mean([])).toBeNull();
  });

  it('olsLine recovers an exact line and reports r2 = 1', () => {
    const xs = [-2, -1, 0, 1, 2, 3];
    const ys = xs.map((x) => 0.5 + 2 * x);
    const fit = olsLine(xs, ys)!;
    expect(fit.a).toBeCloseTo(0.5, 12);
    expect(fit.b).toBeCloseTo(2, 12);
    expect(fit.r2).toBeCloseTo(1, 12);
    expect(fit.n).toBe(6);
    expect([fit.xmin, fit.xmax]).toEqual([-2, 3]);
  });

  it('olsLine returns null with < 3 points or zero x-variance', () => {
    expect(olsLine([1, 2], [1, 2])).toBeNull();
    expect(olsLine([1, 1, 1], [1, 2, 3])).toBeNull();
  });

  it('symmetricBound is robust to a single outlier', () => {
    const vals = [...Array.from({ length: 99 }, (_, i) => (i % 2 ? 0.1 : -0.1)), 50];
    expect(symmetricBound(vals, 0.95)).toBeCloseTo(0.1, 12);
    expect(symmetricBound([], 0.95)).toBe(1);
  });

  it('windowDays builds day offsets from the window start', () => {
    expect(windowDays([-5, 60], 66)[0]).toBe(-5);
    expect(windowDays([-5, 60], 66)[65]).toBe(60);
    expect(windowDays(null, 3)).toEqual([-5, -4, -3]);
  });
});

describe('rolling pre/post split', () => {
  it('averages windows ending before vs on/after the pivot', () => {
    const rolling = {
      dates: ['2022-01-01', '2022-06-01', '2022-11-30', '2023-06-01'],
      SOX: [0.1, 0.3, 0.5, 0.7],
      NDX: [null, 0.2, 0.2, null],
      PARENT: null,
      NIFTY: [1, 1, 1, 1],
      r2: [0.2, 0.2, 0.4, 0.4],
    };
    const rows = Object.fromEntries(prePostAverages(rolling, '2022-11-30').map((r) => [r.key, r]));
    expect(rows.SOX.pre).toBeCloseTo(0.2, 12);
    expect(rows.SOX.post).toBeCloseTo(0.6, 12);
    expect(rows.NDX.pre).toBeCloseTo(0.2, 12);
    expect(rows.PARENT).toBeUndefined();
    expect(rows.r2.post).toBeCloseTo(0.4, 12);
  });
});

describe('provenance helpers', () => {
  it('needsAttention / worstStatus look inside parts', () => {
    const derived = q({
      status: 'DERIVED',
      parts: [
        { label: 'share', value: 0.58, status: 'SOURCED', src: ['s1'], note: null },
        { label: 'fraction', value: 0.5, status: 'USER_ASSUMPTION', src: [], note: null },
      ],
    });
    expect(needsAttention(derived)).toBe(true);
    expect(worstStatus(derived)).toBe('USER_ASSUMPTION');
    expect(needsAttention(q({ status: 'SOURCED' }))).toBe(false);
    expect(needsAttention(q({ status: 'UNVERIFIED' }))).toBe(true);
  });

  it('effectiveValue applies finite overrides only', () => {
    const quantity = q({ id: 'NVDA.hyperscaler_share', value: 0.506 });
    const params = { preset: 'capex', horizon: '1D', values: {}, overrides: { 'NVDA.hyperscaler_share': 0.4 }, premiumFloorZero: true } as const;
    expect(effectiveValue(quantity, params as any)).toBe(0.4);
    expect(effectiveValue(quantity, { ...params, overrides: {} } as any)).toBe(0.506);
  });

  it('sliderBounds falls back by unit', () => {
    expect(sliderBounds({ min: null, max: null, step: null, unit: 'frac', value: 0.3 })).toEqual({ min: 0, max: 1, step: 0.01 });
    const b = sliderBounds({ min: null, max: null, step: null, unit: 'bps', value: 30 });
    expect(b.min).toBe(0);
    expect(b.max).toBe(100);
    expect(sliderBounds({ min: 2, max: 1, step: 0.5, unit: 'x', value: 1.5 })).toEqual({ min: 1, max: 2, step: 0.5 });
  });

  const bundle = {
    sources: [
      { id: 's1', title: 't', publisher: null, url: 'https://x.org/a', date: null, quote: null, verification: 'PRIMARY', accessed: '2026-10-28', note: null },
      { id: 'unused', title: 'u', publisher: null, url: 'https://y.org', date: null, quote: null, verification: 'SECONDARY', accessed: '2026-10-28', note: null },
    ],
    assumptions: [q({ id: 'assump.phi_it', status: 'USER_ASSUMPTION' })],
    origins: [
      {
        ticker: 'AMD',
        hyperscaler_share: q({
          id: 'AMD.hyperscaler_share',
          status: 'DERIVED',
          parts: [
            { label: 'dc', value: 0.58, status: 'SOURCED', src: ['s1'], note: null },
            { label: 'frac', value: 0.5, status: 'USER_ASSUMPTION', src: [], note: null },
          ],
        }),
        neocloud_share: q({ id: 'AMD.neocloud_share', status: 'SOURCED', src: ['ghost'] }),
        concentration: [{ text: 'c', status: 'SOURCED', src: ['s1'] }],
      },
    ],
    india: [],
    securities: {},
    presets: [
      {
        id: 'capex',
        label: 'Hyperscaler capex cut',
        params: [
          { key: 'c', label: 'cut', kind: 'number', value: 0.3, status: 'USER_ASSUMPTION', src: [] },
          { key: 'psi_supplier', label: 'psi', kind: 'number', value: 1, status: 'SOURCED', src: ['s1'] },
        ],
      },
    ],
    meta: { pre_chatgpt: { src: ['s1'] } },
    fx: { default_f: q({ id: 'fx.default_f', status: 'COMPUTED' }) },
    calibration: { contagion_us: q({ id: 'calib.contagion_us', status: 'COMPUTED' }), contagion_india: q({ id: 'calib.contagion_india', status: 'COMPUTED' }) },
    history: { cases: [{ id: 'dotcom', src: ['s1'], drawdowns: [{ label: 'NDX', src: [] }] }], event_studies: [], pe_vs_drawdown: [], replay_windows: [] },
  } as unknown as DataBundle;

  it('collectRegister returns assumption quantities and assumption params of the active preset', () => {
    const ids = collectRegister(bundle, 'capex').map((r) => r.id);
    expect(ids).toContain('assump.phi_it');
    expect(ids).toContain('AMD.hyperscaler_share');
    expect(ids).toContain('capex.c');
    expect(ids).not.toContain('capex.psi_supplier');
    expect(ids).not.toContain('AMD.neocloud_share');
    expect(ids).not.toContain('fx.default_f');
  });

  it('sourceUsage counts citations and reports ids missing from bundle.sources', () => {
    const { usage, missing } = sourceUsage(bundle);
    expect(usage.get('s1')).toEqual(
      expect.arrayContaining(['AMD.hyperscaler_share', 'AMD.concentration', 'preset.capex.psi_supplier', 'meta.pre_chatgpt', 'case.dotcom']),
    );
    expect(usage.has('unused')).toBe(false);
    expect(missing.get('ghost')).toEqual(['AMD.neocloud_share']);
  });
});

describe('matchFocus', () => {
  const cases = [
    { id: 'dotcom', name: 'Dot-com bust' },
    { id: 'satyam', name: 'Satyam Computer Services fraud' },
  ];
  const events = [
    { id: 'deepseek', label: 'DeepSeek shock' },
    { id: 'satyam_2009', label: 'Satyam confession' },
  ];
  it('matches ids, prefixes and names case-insensitively', () => {
    expect(matchFocus('DEEPSEEK', cases, events)).toEqual({ caseId: null, eventId: 'deepseek' });
    expect(matchFocus('dot com', cases, events)).toEqual({ caseId: 'dotcom', eventId: null });
    expect(matchFocus('SATYAM', cases, events)).toEqual({ caseId: 'satyam', eventId: 'satyam_2009' });
    expect(matchFocus(null, cases, events)).toEqual({ caseId: null, eventId: null });
  });
});

describe('robustRange', () => {
  it('ignores a single extreme value, pads, includes zero, and counts outliers', () => {
    const vals = [...Array.from({ length: 199 }, (_, i) => -0.1 + (0.2 * i) / 198), 0.69];
    const r = robustRange(vals, 0.005, 0.995, 0.15)!;
    expect(r.max).toBeLessThan(0.69);
    expect(r.min).toBeLessThan(-0.1);
    expect(r.outside).toBe(1);
    expect(robustRange([], 0.005, 0.995)).toBeNull();
    const pos = robustRange([0.1, 0.2, 0.3])!;
    expect(pos.min).toBeLessThanOrEqual(0);
  });
});
