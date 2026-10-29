// STUB (orchestrator) — UX-LEARN replaces the implementation but must keep these exports and props:
//   <LearnProvider value={{ bundle, result, openLearn }}>…</LearnProvider>
//   <Term id="beta">how strongly it follows US chips</Term>   → label + "?" explainer
//   <HelpChip id="beta" />                                     → just the "?" explainer
import { createContext, useContext, type ReactNode } from 'react';
import type { DataBundle } from '../types/data';
import type { ScenarioResult } from '../types/engine';
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

export function HelpChip({ id }: { id: GlossaryId }) {
  const { openLearn } = useLearn();
  return (
    <button type="button" className="help-chip" aria-label={`Explain: ${id}`} title={id} onClick={() => openLearn?.(id)}>
      ?
    </button>
  );
}

export function Term({ id, children }: { id: GlossaryId; children?: ReactNode }) {
  return (
    <span className="term" data-term={id}>
      {children}
      <HelpChip id={id} />
    </span>
  );
}
