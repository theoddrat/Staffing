import { describe, expect, it } from 'vitest';
import { hashToTerm, panelForView, parseHash, routeToHash, slugFor, termToHash, viewForPanel } from '../router';
import { hashFor } from '../../state/routeSync';

const bundle = {
  india: [
    { ticker: 'NETWEB.NS', display: 'NETWEB' },
    { ticker: 'GVT&D.NS', display: 'GVT&D' },
    { ticker: 'MOSCHIP.BO', display: 'MOSCHIP' },
    { ticker: 'SIFY', display: 'SIFY' },
  ],
} as never;

describe('guided hash routing', () => {
  it('terminal panels keep their F-key hashes', () => {
    expect(parseHash('#F2', bundle)).toEqual({ mode: 'terminal', panel: 'F2' });
    expect(parseHash('#f5', bundle)).toEqual({ mode: 'terminal', panel: 'F5' });
    expect(parseHash('#SEC', bundle)).toEqual({ mode: 'terminal', panel: 'SEC' });
  });

  it('plain view names map to guided views', () => {
    for (const v of ['home', 'impact', 'flow', 'history', 'accuracy', 'learn'] as const)
      expect(parseHash(`#${v}`, bundle)).toEqual({ mode: 'guided', view: v, ticker: null, term: null });
    expect(parseHash('#IMPACT', bundle)).toMatchObject({ view: 'impact' });
  });

  it('stock slugs strip symbols and resolve display or ticker', () => {
    expect(slugFor('GVT&D')).toBe('GVTD');
    expect(parseHash('#stock-NETWEB', bundle)).toEqual({ mode: 'guided', view: 'stock', ticker: 'NETWEB.NS', term: null });
    expect(parseHash('#stock-gvtd', bundle)).toMatchObject({ view: 'stock', ticker: 'GVT&D.NS' });
    expect(parseHash('#stock-MOSCHIPBO', bundle)).toMatchObject({ ticker: 'MOSCHIP.BO' });
    // unknown company → the list, never a blank page
    expect(parseHash('#stock-NOPE', bundle)).toEqual({ mode: 'guided', view: 'impact', ticker: null, term: null });
  });

  it('learn terms use hyphens in the hash', () => {
    expect(termToHash('beta_total')).toBe('beta-total');
    expect(hashToTerm('beta-total')).toBe('beta_total');
    expect(hashToTerm('not-a-term')).toBeNull();
    expect(parseHash('#learn-user-assumption', bundle)).toEqual({ mode: 'guided', view: 'learn', ticker: null, term: 'user_assumption' });
  });

  it('empty or unknown hashes are not routes', () => {
    expect(parseHash('', bundle)).toBeNull();
    expect(parseHash('#', bundle)).toBeNull();
    expect(parseHash('#whatever', bundle)).toBeNull();
    expect(parseHash('#stock', bundle)).toBeNull();
  });

  it('round-trips every route through its hash', () => {
    const routes = [
      { mode: 'guided', view: 'home', ticker: null, term: null },
      { mode: 'guided', view: 'stock', ticker: 'GVT&D.NS', term: null },
      { mode: 'guided', view: 'learn', ticker: null, term: 'ai_premium' },
      { mode: 'terminal', panel: 'F3' },
    ] as const;
    for (const r of routes) expect(parseHash(routeToHash(r, bundle), bundle)).toEqual(r);
    // hashes are plain names only (letters, digits, hyphens)
    for (const r of routes) expect(routeToHash(r, bundle)).toMatch(/^#[A-Za-z0-9-]+$/);
    expect(routeToHash({ mode: 'guided', view: 'stock', ticker: null, term: null }, bundle)).toBe('#impact');
  });

  it('maps views and panels so a mode switch stays on the same subject', () => {
    expect(panelForView('impact', null)).toBe('F2');
    expect(panelForView('stock', 'NETWEB.NS')).toBe('SEC');
    expect(panelForView('stock', null)).toBe('F2');
    expect(viewForPanel('F3', null, bundle)).toBe('flow');
    expect(viewForPanel('SEC', 'NETWEB.NS', bundle)).toBe('stock');
    expect(viewForPanel('SEC', 'NVDA', bundle)).toBe('impact'); // US security pages have no guided story
  });

  it('hashFor follows the active mode', () => {
    const s = { mode: 'guided', view: 'stock', selected: 'NETWEB.NS', learnTerm: null, panel: 'F2' } as const;
    expect(hashFor(bundle, s)).toBe('#stock-NETWEB');
    expect(hashFor(bundle, { ...s, mode: 'terminal' })).toBe('#F2');
    expect(hashFor(bundle, { ...s, view: 'learn', learnTerm: 'r2' })).toBe('#learn-r2');
  });
});
