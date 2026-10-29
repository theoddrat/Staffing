import { describe, expect, it } from 'vitest';
import type { ParamSpec } from '../../types/data';
import { detectIntensity, intensityCaption, intensityValues, levelOf, SHOCK_KEYS } from '../lib/intensity';

function spec(key: string, value: number | string | null, mc: ParamSpec['mc'] = null): ParamSpec {
  return { key, label: key, kind: typeof value === 'string' ? 'enum' : 'number', value, min: 0, max: 1, step: 0.01, unit: 'frac', options: null, status: 'USER_ASSUMPTION', src: [], note: null, mc };
}

const capex = [spec('c', 0.3, { dist: 'triangular', low: 0.15, high: 0.5 }), spec('phi_it', 1, { dist: 'triangular', low: 0.5, high: 1.5 }), spec('kappa', 0, { dist: 'fixed', low: null, high: null })];

describe('intensity chips', () => {
  it('Mild / Severe / Extreme = MC low / default / MC high of the shock-size keys only', () => {
    expect(intensityValues('capex', capex, 'mild')).toEqual({ c: 0.15 });
    expect(intensityValues('capex', capex, 'severe')).toEqual({ c: 0.3 });
    expect(intensityValues('capex', capex, 'extreme')).toEqual({ c: 0.5 });
  });

  it('keys without a usable range keep their default', () => {
    const specs = [spec('ds_bps', 400, { dist: 'fixed', low: null, high: null }), spec('k', 0.3, { dist: 'uniform', low: 0.15, high: 0.5 }), spec('d_credit', 0.15)];
    expect(intensityValues('credit', specs, 'extreme')).toEqual({ ds_bps: 400, k: 0.5, d_credit: 0.15 });
  });

  it('replay has no intensity', () => {
    expect(SHOCK_KEYS.replay).toEqual([]);
    expect(intensityValues('replay', [spec('window', 'DOTCOM')], 'extreme')).toEqual({});
    expect(detectIntensity('replay', [spec('window', 'DOTCOM')], { window: 'DOTCOM' })).toBeNull();
  });

  it('detects the level the current values sit at (or none when customised)', () => {
    expect(detectIntensity('capex', capex, { c: 0.3 })).toBe('severe');
    expect(detectIntensity('capex', capex, { c: 0.15, phi_it: 0.7 })).toBe('mild');
    expect(detectIntensity('capex', capex, { c: 0.5 })).toBe('extreme');
    expect(detectIntensity('capex', capex, { c: 0.42 })).toBeNull();
    expect(detectIntensity('capex', capex, {})).toBe('severe'); // missing → spec default
  });

  it('captions read the values themselves', () => {
    expect(intensityCaption('capex', { c: 0.3 })).toBe('30% cut');
    expect(intensityCaption('guidance', { g: 0.2 })).toBe('sales −20%');
    expect(intensityCaption('credit', { ds_bps: 400 })).toBe('+4.0 pts');
    expect(intensityCaption('replay', {})).toBeNull();
  });
});

describe('levels from the engine', () => {
  it('levelOf finds the level whose values all match, else null', () => {
    const levels = { mild: { c: 0.15, phi_it: 0.5 }, severe: { c: 0.3, phi_it: 1 }, extreme: { c: 0.5, phi_it: 1.5 } };
    expect(levelOf(levels, { c: 0.3, phi_it: 1 }, capex)).toBe('severe');
    expect(levelOf(levels, { c: 0.5, phi_it: 1.5 }, capex)).toBe('extreme');
    expect(levelOf(levels, { c: 0.5, phi_it: 1 }, capex)).toBeNull();
    expect(levelOf({ mild: {}, severe: {}, extreme: {} }, {}, capex)).toBeNull();
  });
});
