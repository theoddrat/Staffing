"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useDictionary } from "@/lib/api";
import { buildLinkIndex, type LinkIndex } from "@/lib/richtext";
import type { TermSummary } from "@/lib/types";
import { TermDrawer } from "./TermDrawer";

type Ctx = {
  openTerm: (id: string) => void;
  index: LinkIndex;
  terms: Map<string, TermSummary>;
};

const TermCtx = createContext<Ctx | null>(null);

export function TermProvider({ children }: { children: ReactNode }) {
  const { data } = useDictionary();
  const [open, setOpen] = useState<string | null>(null);
  const index = useMemo(() => buildLinkIndex(data ?? []), [data]);
  const terms = useMemo(() => new Map((data ?? []).map((t) => [t.id, t])), [data]);
  const openTerm = useCallback((id: string) => setOpen(id), []);
  const value = useMemo(() => ({ openTerm, index, terms }), [openTerm, index, terms]);
  return (
    <TermCtx.Provider value={value}>
      {children}
      <TermDrawer termId={open} onClose={() => setOpen(null)} onOpenTerm={setOpen} />
    </TermCtx.Provider>
  );
}

export function useTerms(): Ctx {
  const c = useContext(TermCtx);
  if (!c) return { openTerm: () => {}, index: { regex: null, lookup: new Map() }, terms: new Map() };
  return c;
}
