// Learn layer entry points used across the app (contract from the orchestrator stub):
//   <LearnProvider value={{ bundle, result, openLearn }}>…</LearnProvider>
//   <Term id="beta">how strongly it follows US chips</Term>   → dotted label + "?" explainer
//   <HelpChip id="beta" />                                     → just the "?" explainer
// The explainer is a popover anchored to the chip on desktop and a bottom sheet below 640px.
// It is portalled to <body>, traps focus, closes on Esc / outside click, and stops event
// propagation so it never triggers a sortable table header or a clickable row around it.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type SyntheticEvent,
} from 'react';
import { createPortal } from 'react-dom';
import '../styles/guided-tokens.css';
import '../styles/learn.css';
import type { DataBundle } from '../types/data';
import type { ScenarioResult } from '../types/engine';
import { Icon } from '../guided/icons';
import { ExplainerCard } from './ExplainerCard';
import { entry } from './glossary';
import type { GlossaryId } from './ids';

export interface LearnCtx {
  bundle: DataBundle | null;
  result: ScenarioResult | null;
  openLearn?: (id: GlossaryId) => void; // navigate to the Learn page at this term
}

export const LearnContext = createContext<LearnCtx>({ bundle: null, result: null });

export function LearnProvider({ value, children }: { value: LearnCtx; children: ReactNode }) {
  return <LearnContext.Provider value={value}>{children}</LearnContext.Provider>;
}

export function useLearn(): LearnCtx {
  return useContext(LearnContext);
}

/** Hash used by the router for a term: beta_total → #learn-beta-total. */
export function learnHash(id: GlossaryId): string {
  return `#learn-${id.replace(/_/g, '-')}`;
}

/** Navigate to the Learn page at a term (falls back to the hash route when no handler is wired). */
export function goLearn(ctx: LearnCtx, id: GlossaryId) {
  if (ctx.openLearn) return ctx.openLearn(id);
  try {
    window.location.hash = learnHash(id);
  } catch {
    /* no window (tests) */
  }
}

// Only one explainer is open at a time.
let closeCurrent: (() => void) | null = null;

const stop = (e: SyntheticEvent) => e.stopPropagation();

const FOCUSABLE = 'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

function useNarrow(): boolean {
  const q = '(max-width: 639px)';
  const get = () => {
    try {
      return window.matchMedia(q).matches;
    } catch {
      return false;
    }
  };
  const [narrow, setNarrow] = useState(get);
  useEffect(() => {
    let mq: MediaQueryList | null = null;
    try {
      mq = window.matchMedia(q);
    } catch {
      return;
    }
    const on = () => setNarrow(mq!.matches);
    mq.addEventListener?.('change', on);
    return () => mq?.removeEventListener?.('change', on);
  }, []);
  return narrow;
}

function Popover({ id, domId, anchor, onClose, onSwitch }: { id: GlossaryId; domId: string; anchor: HTMLElement; onClose: (refocus: boolean) => void; onSwitch: (id: GlossaryId) => void }) {
  const ctx = useLearn();
  const narrow = useNarrow();
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);

  const place = useCallback(() => {
    if (narrow || !ref.current) return;
    const r = anchor.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(380, vw - 24);
    const h = ref.current.offsetHeight;
    let left = r.left + r.width / 2 - width / 2;
    left = Math.max(12, Math.min(left, vw - width - 12));
    let top = r.bottom + 8;
    if (top + h > vh - 12 && r.top - 8 - h >= 12) top = r.top - 8 - h;
    top = Math.max(12, Math.min(top, vh - h - 12));
    setPos({ top, left, width });
  }, [anchor, narrow]);

  useLayoutEffect(() => {
    place();
  }, [place, id]);

  useEffect(() => {
    if (narrow) return;
    const on = () => place();
    window.addEventListener('resize', on);
    window.addEventListener('scroll', on, true);
    return () => {
      window.removeEventListener('resize', on);
      window.removeEventListener('scroll', on, true);
    };
  }, [place, narrow]);

  // focus the dialog on open / when the term changes
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('.lv-pop-close')?.focus({ preventScroll: true });
    ref.current?.scrollTo?.({ top: 0 });
  }, [id]);

  // outside click closes (desktop; the sheet has its own backdrop)
  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor.contains(t)) return;
      onClose(false);
    };
    document.addEventListener('pointerdown', down, true);
    return () => document.removeEventListener('pointerdown', down, true);
  }, [anchor, onClose]);

  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose(true);
      return;
    }
    if (e.key !== 'Tab' || !ref.current) return;
    const els = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (!els.length) return;
    const first = els[0];
    const last = els[els.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const style = narrow ? undefined : pos ? { top: pos.top, left: pos.left, width: pos.width } : { top: -9999, left: 0, width: Math.min(380, window.innerWidth - 24) };
  const body = (
    <div className="lv-pop-layer" onClick={stop} onPointerDown={stop} onMouseDown={stop} onKeyDown={onKey}>
      {narrow && <div className="lv-sheet-backdrop" onClick={() => onClose(true)} />}
      <div
        ref={ref}
        id={domId}
        className={narrow ? 'lv-pop lv-sheet' : 'lv-pop'}
        style={style}
        role="dialog"
        aria-modal={narrow ? true : undefined}
        aria-labelledby={titleId}
      >
        <button type="button" className="lv-pop-close" aria-label="Close explainer" onClick={() => onClose(true)}>
          <Icon name="close" size={16} />
        </button>
        <ExplainerCard
          id={id}
          data={{ bundle: ctx.bundle, result: ctx.result }}
          compact
          titleId={titleId}
          onRelated={onSwitch}
          onMore={() => {
            onClose(false);
            goLearn(ctx, id);
          }}
        />
      </div>
    </div>
  );
  return createPortal(body, document.body);
}

function Explainer({ id, label }: { id: GlossaryId; label?: ReactNode }) {
  const [shown, setShown] = useState<GlossaryId | null>(null);
  const chip = useRef<HTMLButtonElement>(null);
  const popId = useId();
  const e = entry(id);

  const close = useCallback((refocus: boolean) => {
    setShown(null);
    if (closeCurrent === closeSelf.current) closeCurrent = null;
    if (refocus) chip.current?.focus({ preventScroll: true });
  }, []);
  const closeSelf = useRef<() => void>(() => close(false));

  useEffect(() => () => {
    if (closeCurrent === closeSelf.current) closeCurrent = null;
  }, []);

  const toggle = (ev: SyntheticEvent) => {
    ev.stopPropagation();
    ev.preventDefault();
    if (shown) return close(false);
    if (closeCurrent && closeCurrent !== closeSelf.current) closeCurrent();
    closeCurrent = closeSelf.current;
    setShown(id);
  };

  return (
    <>
      {label !== undefined && (
        <span className="lv-term-label" onClick={toggle}>
          {label}
        </span>
      )}
      <button
        ref={chip}
        type="button"
        className="help-chip lv-chip"
        aria-label={`What is “${e?.term ?? id}”?`}
        aria-haspopup="dialog"
        aria-expanded={!!shown}
        aria-controls={shown ? popId : undefined}
        title={e ? `${e.term} — ${e.tech}` : id}
        onClick={toggle}
        onKeyDown={(ev) => ev.key === 'Enter' || ev.key === ' ' ? ev.stopPropagation() : undefined}
      >
        ?
      </button>
      {shown && chip.current && <Popover id={shown} domId={popId} anchor={chip.current} onClose={close} onSwitch={setShown} />}
    </>
  );
}

export function HelpChip({ id }: { id: GlossaryId }) {
  return (
    <span className="lv-help" data-term={id}>
      <Explainer id={id} />
    </span>
  );
}

export function Term({ id, children }: { id: GlossaryId; children?: ReactNode }) {
  return (
    <span className="term lv-term" data-term={id}>
      <Explainer id={id} label={children ?? entry(id)?.term ?? id} />
    </span>
  );
}
