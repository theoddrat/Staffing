// Keeps the URL hash and the store in step. Guided views push history entries (so the browser's
// back button walks back through the story); terminal panels replace the entry, as before.
// Hashes are plain names only — the artifact host passes nothing else through.
import { useEffect, useRef } from 'react';
import type { DataBundle } from '../types/data';
import type { GuidedView, PanelId, UiMode } from '../panels/types';
import type { GlossaryId } from '../learn/ids';
import { parseHash, routeToHash, type Route } from '../guided/router';

export interface RouteState {
  mode: UiMode;
  view: GuidedView;
  selected: string | null;
  learnTerm: GlossaryId | null;
  panel: PanelId;
}

export function hashFor(bundle: Pick<DataBundle, 'india'>, s: RouteState): string {
  return s.mode === 'terminal'
    ? routeToHash({ mode: 'terminal', panel: s.panel }, bundle)
    : routeToHash({ mode: 'guided', view: s.view, ticker: s.selected, term: s.learnTerm }, bundle);
}

export function useRouteSync(bundle: DataBundle, s: RouteState, onRoute: (r: Route) => void): void {
  const desired = hashFor(bundle, s);
  const first = useRef(true);
  useEffect(() => {
    let current = '';
    try {
      current = window.location.hash;
    } catch {
      return;
    }
    const replace = first.current || s.mode === 'terminal';
    first.current = false;
    if (current === desired) return;
    try {
      const url = `${window.location.pathname}${window.location.search}${desired}`;
      if (replace) window.history.replaceState(null, '', url);
      else window.history.pushState(null, '', url);
    } catch {
      try {
        window.location.hash = desired; // sandboxed hosts may refuse the History API
      } catch {
        /* ignore */
      }
    }
  }, [desired, s.mode]);

  useEffect(() => {
    const on = () => {
      try {
        const r = parseHash(window.location.hash, bundle);
        if (r) onRoute(r);
      } catch {
        /* ignore malformed hashes */
      }
    };
    try {
      window.addEventListener('popstate', on);
      window.addEventListener('hashchange', on);
    } catch {
      return;
    }
    return () => {
      window.removeEventListener('popstate', on);
      window.removeEventListener('hashchange', on);
    };
  }, [bundle, onRoute]);
}
