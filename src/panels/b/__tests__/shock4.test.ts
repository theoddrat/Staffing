import { describe, expect, it } from 'vitest';
import type { DataBundle } from '../../../types/data';
import { shock4Block } from '../model/Formulas';
import { median } from '../util';

describe('median', () => {
  it('handles odd/even counts and skips non-finite values', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3, null, Number.NaN])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe('shock4Block (calibrated mode)', () => {
  const bundle = {
    history: {
      pe_fit: { slope: -0.00506729, intercept: -0.361872, r2: 0.341085, n: 11 },
      ai_basket_pe: { now: 25.688, pre_chatgpt_median: 32.296, implied_drawdown: -0.492039 },
    },
  } as unknown as DataBundle;

  it('renders the three modes and substitutes the live fit into the calibrated formula', () => {
    const b = shock4Block(bundle);
    expect(b.title).toMatch(/median \/ multiple \/ calibrated/);
    const tex = b.tex.join('\n');
    expect(tex).toContain(String.raw`\text{calibrated: }`);
    // -(a + b*PE_now) = 0.361872 + 0.00506729*25.688 = 0.492039
    expect(tex).toContain(String.raw`=\lambda\cdot0.492`);
    expect(tex).toContain('-0.362');
    expect(tex).toContain('25.69');
  });

  it('omits the live line when the fit is missing', () => {
    const b = shock4Block({ history: { pe_fit: null, ai_basket_pe: { now: 25, pre_chatgpt_median: 30, implied_drawdown: null } } } as unknown as DataBundle);
    expect(b.tex.join('\n')).not.toContain(String.raw`=\lambda\cdot0`);
    expect(b.tex.length).toBe(3);
  });
});
