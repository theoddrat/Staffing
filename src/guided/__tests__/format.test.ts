import { describe, expect, it } from 'vitest';
import { dollars, moveWords, pct, pctAbs, rupeesCr } from '../lib/format';

describe('guided number formatting', () => {
  it('signed percentages use a true minus and never show −0', () => {
    expect(pct(0.165)).toBe('+16.5%');
    expect(pct(-0.04, 0)).toBe('−4%');
    expect(pct(-0.0001, 1)).toBe('0.0%');
    expect(pct(NaN)).toBe('—');
    expect(pct(null)).toBe('—');
    expect(pctAbs(-0.293)).toBe('29%');
  });

  it('rupees in crore with lakh-crore shorthand and Indian grouping', () => {
    expect(rupeesCr(-262598)).toBe('−₹2.6 lakh cr');
    expect(rupeesCr(4327)).toBe('₹4,327 cr');
    expect(rupeesCr(123456)).toBe('₹1.2 lakh cr');
    expect(rupeesCr(1474561)).toBe('₹15 lakh cr');
    expect(rupeesCr(25, { sign: true })).toBe('+₹25 cr');
    expect(rupeesCr(3.25)).toBe('₹3.3 cr');
    expect(rupeesCr(undefined)).toBe('—');
  });

  it('dollars', () => {
    expect(dollars(1.74e11)).toBe('$174B');
    expect(dollars(5.2e12)).toBe('$5.2T');
    expect(dollars(-3.4e9)).toBe('−$3.4B');
  });

  it('moves in words', () => {
    expect(moveWords(-0.165)).toBe('falls about 17%');
    expect(moveWords(-0.054)).toBe('falls about 5.4%');
    expect(moveWords(0.02)).toBe('rises about 2%');
    expect(moveWords(0.001)).toBe('barely moves');
  });
});
