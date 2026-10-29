// Hash routing for the guided UI. Hashes are plain names only (letters, digits, hyphens), because
// the artifact host passes nothing else through: #home, #impact, #flow, #history, #accuracy,
// #learn, #learn-beta-total, #stock-NETWEB. Terminal panels keep #F1…#F6 / #SEC.
import type { DataBundle } from '../types/data';
import type { GuidedView, PanelId } from '../panels/types';
import { GLOSSARY_IDS, type GlossaryId } from '../learn/ids';

export type Route =
  | { mode: 'guided'; view: GuidedView; ticker: string | null; term: GlossaryId | null }
  | { mode: 'terminal'; panel: PanelId };

const VIEWS: GuidedView[] = ['home', 'impact', 'stock', 'flow', 'history', 'accuracy', 'learn'];

/** Display symbol → hash-safe slug: "GVT&D" → "GVTD". */
export function slugFor(display: string): string {
  return display.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Map slugs back to India tickers (and the bare ticker as a fallback). */
export function slugIndex(bundle: Pick<DataBundle, 'india'>): Map<string, string> {
  const m = new Map<string, string>();
  for (const t of bundle.india) {
    m.set(slugFor(t.display), t.ticker);
    m.set(slugFor(t.ticker), t.ticker);
  }
  return m;
}

export function termToHash(id: GlossaryId): string {
  return id.replace(/_/g, '-');
}

export function hashToTerm(s: string): GlossaryId | null {
  const id = s.toLowerCase().replace(/-/g, '_');
  return (GLOSSARY_IDS as readonly string[]).includes(id) ? (id as GlossaryId) : null;
}

export function parseHash(hash: string, bundle: Pick<DataBundle, 'india'>): Route | null {
  const h = hash.replace(/^#/, '').trim();
  if (!h) return null;
  const up = h.toUpperCase();
  if (/^F[1-6]$/.test(up) || up === 'SEC') return { mode: 'terminal', panel: up as PanelId };
  const lower = h.toLowerCase();
  if (lower.startsWith('stock-')) {
    const ticker = slugIndex(bundle).get(slugFor(h.slice(6))) ?? null;
    return ticker ? { mode: 'guided', view: 'stock', ticker, term: null } : { mode: 'guided', view: 'impact', ticker: null, term: null };
  }
  if (lower.startsWith('learn-')) return { mode: 'guided', view: 'learn', ticker: null, term: hashToTerm(h.slice(6)) };
  if ((VIEWS as string[]).includes(lower) && lower !== 'stock') return { mode: 'guided', view: lower as GuidedView, ticker: null, term: null };
  return null;
}

export function routeToHash(r: Route, bundle: Pick<DataBundle, 'india'>): string {
  if (r.mode === 'terminal') return `#${r.panel}`;
  if (r.view === 'stock' && r.ticker) {
    const t = bundle.india.find((x) => x.ticker === r.ticker);
    return `#stock-${slugFor(t?.display ?? r.ticker)}`;
  }
  if (r.view === 'learn' && r.term) return `#learn-${termToHash(r.term)}`;
  return `#${r.view === 'stock' ? 'impact' : r.view}`;
}

/** Guided view ↔ terminal panel, so switching modes keeps you on the same subject. */
export function panelForView(view: GuidedView, ticker: string | null): PanelId {
  switch (view) {
    case 'home':
      return 'F1';
    case 'impact':
      return 'F2';
    case 'stock':
      return ticker ? 'SEC' : 'F2';
    case 'flow':
      return 'F3';
    case 'history':
      return 'F4';
    case 'accuracy':
      return 'F5';
    case 'learn':
      return 'F6';
  }
}

export function viewForPanel(panel: PanelId, selected: string | null, bundle: Pick<DataBundle, 'india'>): GuidedView {
  switch (panel) {
    case 'F1':
      return 'home';
    case 'F2':
      return 'impact';
    case 'F3':
      return 'flow';
    case 'F4':
      return 'history';
    case 'F5':
      return 'accuracy';
    case 'F6':
      return 'learn';
    case 'SEC':
      return selected && bundle.india.some((t) => t.ticker === selected) ? 'stock' : 'impact';
  }
}

/** The glossary term in the current hash (#learn-beta-total → 'beta_total'), for the Learn page. */
export function currentLearnTerm(): GlossaryId | null {
  try {
    const h = window.location.hash.replace(/^#/, '');
    return h.toLowerCase().startsWith('learn-') ? hashToTerm(h.slice(6)) : null;
  } catch {
    return null;
  }
}
