import { describe, expect, it } from 'vitest';
import { isProblem } from '../sources/SourcesViews';

describe('isProblem (build-log classification)', () => {
  it('flags data problems and leaves informational lines alone', () => {
    expect(isProblem('fundamentals: SMCI earnings calendar missing')).toBe(true);
    expect(isProblem('ticker LTIM.NS dropped; using LTM.NS')).toBe(true);
    expect(isProblem('ENRIN.NS: short history (335 sessions)')).toBe(true);
    expect(isProblem('config: overlay: added source tcs_q2fy27_multibagg')).toBe(false);
  });
});
