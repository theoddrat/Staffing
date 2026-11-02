"use client";

import Link from "next/link";
import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import { api, useTerm } from "@/lib/api";
import { TermEntry } from "./TermEntry";

/** A side panel showing a dictionary entry without leaving the current page. */
export function TermDrawer({ termId, onClose }: { termId: string | null; onClose: () => void; onOpenTerm: (id: string) => void }) {
  const { data, error } = useTerm(termId);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!termId) return;
    api.termViewed(termId).catch(() => {});
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [termId, onClose]);

  if (!termId) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Dictionary entry">
      <button type="button" aria-label="Close dictionary" className="absolute inset-0 bg-black/25" onClick={onClose} />
      <div ref={panel} tabIndex={-1}
        className="relative h-full w-full max-w-md overflow-y-auto border-l border-line bg-surface p-5 shadow-card outline-none">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-xs font-semibold tracking-wide text-ink-3 uppercase">1. The word · My dictionary</span>
          <button type="button" onClick={onClose} className="rounded p-1 hover:bg-surface-2" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        {error ? <p className="text-bad">{error.message}</p> : null}
        {data ? <TermEntry data={data} compact /> : !error ? <p className="text-ink-3">Loading…</p> : null}
        {data ? (
          <Link href={`/dictionary/${termId}`} onClick={onClose} className="mt-4 inline-block text-sm text-accent hover:underline">
            Open full page →
          </Link>
        ) : null}
      </div>
    </div>
  );
}
