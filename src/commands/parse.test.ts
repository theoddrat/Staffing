import { describe, expect, it } from 'vitest';
import { normalize, parseCommand, parseMagnitude, resolveTicker, suggest, type ParseContext } from './parse';

const ctx: ParseContext = {
  securities: ['NVDA', 'AMD', 'SMCI', 'ORCL', 'INFY', 'WIT', 'INFY.NS', 'LTM.NS', 'MOSCHIP.BO', 'GVT&D.NS', '^SOX', '6501.T'],
  indiaDisplay: { INFY: 'INFY.NS', LTM: 'LTM.NS', MOSCHIP: 'MOSCHIP.BO', 'GVT&D': 'GVT&D.NS' },
  indiaTickers: ['INFY.NS', 'LTM.NS', 'MOSCHIP.BO', 'GVT&D.NS'],
  origins: ['NVDA', 'AMD', 'SMCI', 'ORCL'],
  chips: ['NVDA', 'AMD', 'SMCI'],
  replayWindows: ['DOTCOM', 'DOTCOM1Y', 'Y2022', 'DEEPSEEK', 'OCT2026'],
  historyIds: ['railway', 'dotcom', 'telecom', 'satyam', 'deepseek', 'smci2024', 'ev_deepseek'],
};

describe('normalize', () => {
  it('upper-cases, collapses spaces, strips <GO>', () => {
    expect(normalize('  capex   -30   <go> ')).toEqual(['CAPEX', '-30']);
    expect(normalize('nvda go')).toEqual(['NVDA']);
    expect(normalize('<GO>')).toEqual([]);
  });
});

describe('parseMagnitude', () => {
  it('parses signed numbers and percents as absolute values', () => {
    expect(parseMagnitude('-30')).toBe(30);
    expect(parseMagnitude('30%')).toBe(30);
    expect(parseMagnitude('+12.5')).toBe(12.5);
    expect(parseMagnitude('abc')).toBeNull();
    expect(parseMagnitude(undefined)).toBeNull();
  });
});

describe('parseCommand', () => {
  it('function keys and help', () => {
    expect(parseCommand('F3', ctx)).toEqual({ kind: 'panel', panel: 'F3' });
    expect(parseCommand('help <GO>', ctx)).toEqual({ kind: 'help' });
    expect(parseCommand('MC', ctx)).toEqual({ kind: 'mc' });
    expect(parseCommand('reset', ctx)).toEqual({ kind: 'reset' });
  });

  it('CAPEX -30 <GO> -> capex preset with c = 0.30', () => {
    const c = parseCommand('CAPEX -30 <GO>', ctx);
    expect(c.kind).toBe('scenario');
    if (c.kind === 'scenario') {
      expect(c.preset).toBe('capex');
      expect(c.values.c).toBeCloseTo(0.3, 12);
    }
    expect(parseCommand('CAPEX', ctx).kind).toBe('error');
  });

  it('GUIDE <CHIP> -20 requires a chip origin', () => {
    const c = parseCommand('guide amd -20', ctx);
    expect(c).toMatchObject({ kind: 'scenario', preset: 'guidance', values: { target: 'AMD' } });
    if (c.kind === 'scenario') expect(c.values.g).toBeCloseTo(0.2, 12);
    expect(parseCommand('GUIDE ORCL -20', ctx).kind).toBe('error');
    expect(parseCommand('GUIDE NVDA', ctx).kind).toBe('error');
  });

  it('RESTATE accepts origins and India display symbols, optional de-rating', () => {
    const a = parseCommand('RESTATE SMCI -30 25 <GO>', ctx);
    expect(a).toMatchObject({ kind: 'scenario', preset: 'restatement', values: { target: 'SMCI' } });
    if (a.kind === 'scenario') {
      expect(a.values.r).toBeCloseTo(0.3, 12);
      expect(a.values.d).toBeCloseTo(0.25, 12);
    }
    const b = parseCommand('RESTATE INFY -40', ctx);
    expect(b).toMatchObject({ kind: 'scenario', values: { target: 'INFY.NS' } });
    if (b.kind === 'scenario') expect('d' in b.values).toBe(false);
    expect(parseCommand('RESTATE ^SOX -10', ctx).kind).toBe('error');
  });

  it('MULT 50 and MULT PE 25', () => {
    const a = parseCommand('MULT 50', ctx);
    expect(a).toMatchObject({ kind: 'scenario', preset: 'multiple', values: { mode: 'median' } });
    if (a.kind === 'scenario') expect(a.values.lambda).toBeCloseTo(0.5, 12);
    expect(parseCommand('MULT PE 25', ctx)).toMatchObject({ values: { mode: 'multiple', target_pe: 25 } });
    expect(parseCommand('MULT 150', ctx).kind).toBe('error');
  });

  it('CREDIT 400 and REPLAY DOTCOM', () => {
    expect(parseCommand('CREDIT 400', ctx)).toMatchObject({ preset: 'credit', values: { ds_bps: 400 } });
    expect(parseCommand('REPLAY DOTCOM <GO>', ctx)).toMatchObject({ preset: 'replay', values: { window: 'DOTCOM' } });
    expect(parseCommand('replay deep', ctx)).toMatchObject({ values: { window: 'DEEPSEEK' } });
    expect(parseCommand('REPLAY NOPE', ctx).kind).toBe('error');
  });

  it('POP horizons', () => {
    expect(parseCommand('POP 12M', ctx)).toMatchObject({ preset: 'fullpop', horizon: '12M' });
    expect(parseCommand('POP', ctx)).toMatchObject({ preset: 'fullpop', horizon: null });
    expect(parseCommand('POP 2Y', ctx).kind).toBe('error');
  });

  it('INDIA TIER C and HIST DEEPSEEK', () => {
    expect(parseCommand('INDIA TIER C <GO>', ctx)).toEqual({ kind: 'tier', tier: 'C' });
    expect(parseCommand('INDIA B', ctx)).toEqual({ kind: 'tier', tier: 'B' });
    expect(parseCommand('TIER ALL', ctx)).toEqual({ kind: 'tier', tier: 'ALL' });
    expect(parseCommand('INDIA TIER Z', ctx).kind).toBe('error');
    expect(parseCommand('HIST DEEPSEEK', ctx)).toEqual({ kind: 'hist', id: 'deepseek' });
    expect(parseCommand('HIST', ctx)).toEqual({ kind: 'hist', id: null });
    expect(parseCommand('HIST SAT', ctx)).toEqual({ kind: 'hist', id: 'satyam' });
  });

  it('securities: India display symbols resolve first, US suffix picks the ADR', () => {
    expect(parseCommand('NVDA <GO>', ctx)).toMatchObject({ kind: 'security', ticker: 'NVDA' });
    const infy = parseCommand('INFY', ctx);
    expect(infy).toMatchObject({ kind: 'security', ticker: 'INFY.NS' });
    if (infy.kind === 'security') expect(infy.note).toContain('INFY US');
    expect(parseCommand('INFY US <GO>', ctx)).toMatchObject({ kind: 'security', ticker: 'INFY' });
    expect(parseCommand('moschip', ctx)).toMatchObject({ ticker: 'MOSCHIP.BO' });
    expect(parseCommand('gvt&d', ctx)).toMatchObject({ ticker: 'GVT&D.NS' });
    expect(parseCommand('^sox', ctx)).toMatchObject({ ticker: '^SOX' });
    expect(parseCommand('6501.t', ctx)).toMatchObject({ ticker: '6501.T' });
    expect(parseCommand('NVDA US EQUITY <GO>', ctx)).toMatchObject({ ticker: 'NVDA' });
    expect(parseCommand('FOO', ctx).kind).toBe('error');
    expect(parseCommand('', ctx).kind).toBe('error');
  });

  it('resolveTicker preference order', () => {
    expect(resolveTicker('INFY', ctx, 'foreign')).toBe('INFY');
    expect(resolveTicker('INFY', ctx, 'india')).toBe('INFY.NS');
    expect(resolveTicker('LTM', ctx)).toBe('LTM.NS');
  });
});

describe('suggest', () => {
  it('suggests commands and tickers by prefix', () => {
    expect(suggest('CA', ctx)).toContain('CAPEX');
    expect(suggest('REPLAY DO', ctx)).toEqual(['REPLAY DOTCOM', 'REPLAY DOTCOM1Y']);
    expect(suggest('NV', ctx)).toContain('NVDA');
    expect(suggest('', ctx)).toEqual([]);
  });
});
