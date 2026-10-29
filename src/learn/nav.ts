// Navigation to a Learn term that works whether or not the app shell passes the term through its
// router: the requested term is remembered here and announced with a DOM event, and the hash
// (#learn-beta-total) is parsed as well.
import { GLOSSARY_IDS, type GlossaryId } from './ids';

let pending: GlossaryId | null = null;
const EVT = 'lv-learn-term';

export function learnHash(id: GlossaryId): string {
  return `#learn-${id.replace(/_/g, '-')}`;
}

/** "#learn-beta-total" → "beta_total" (null for anything else). */
export function termFromHash(hash: string): GlossaryId | null {
  const m = /^#?learn-([a-z0-9-]+)$/i.exec(hash.trim());
  if (!m) return null;
  const id = m[1].toLowerCase().replace(/-/g, '_');
  return (GLOSSARY_IDS as readonly string[]).includes(id) ? (id as GlossaryId) : null;
}

export function requestTerm(id: GlossaryId): void {
  pending = id;
  try {
    window.dispatchEvent(new CustomEvent(EVT, { detail: id }));
  } catch {
    /* no window (tests) */
  }
}

export function consumeTerm(): GlossaryId | null {
  const id = pending;
  pending = null;
  return id;
}

export function onTermRequest(fn: (id: GlossaryId) => void): () => void {
  const h = (e: Event) => {
    const id = (e as CustomEvent<GlossaryId>).detail;
    pending = null;
    fn(id);
  };
  try {
    window.addEventListener(EVT, h);
    return () => window.removeEventListener(EVT, h);
  } catch {
    return () => undefined;
  }
}
