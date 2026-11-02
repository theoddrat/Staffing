"use client";

import Link from "next/link";
import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, useAIStatus } from "@/lib/api";
import type { AlternativeOut, NodeOut } from "@/lib/types";
import { Widget } from "@/widgets/registry";
import { RichText } from "../RichText";
import { Button } from "../ui";

const STRATEGY_LABEL: Record<string, string> = {
  "story": "a story", "everyday-objects": "everyday objects", "visual": "a picture", "smaller-steps": "smaller steps",
  "eli5": "like you're five", "contrast": "what it is not", "history": "where it came from", "physical-activity": "something to do with your hands",
  "question-led": "questions to think through",
};

/**
 * The "I don't understand" panel. Each press brings a genuinely different teaching strategy:
 * first the lesson's prepared alternatives, then (if enabled) a new explanation from the AI tutor.
 */
export function DontUnderstand({ lessonId, section, prerequisites, initialSeen, onSeen, onClose, onAskTutor }: {
  lessonId: string; section: string | null; prerequisites: NodeOut[]; initialSeen: string[];
  onSeen: (strategies: string[]) => void; onClose: () => void; onAskTutor: () => void;
}) {
  const ai = useAIStatus();
  const [seen, setSeen] = useState<string[]>(initialSeen);
  const [alt, setAlt] = useState<AlternativeOut | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = async (useAi = false) => {
    setBusy(true);
    setErr(null);
    try {
      const a = await api.explainDifferently(lessonId, section, seen, useAi);
      setAlt(a);
      if (a.strategy) {
        const next = [...seen, a.strategy];
        setSeen(next);
        onSeen(next);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const loaded = useRef(false);
  useEffect(() => {
    if (!loaded.current) {
      loaded.current = true;
      void load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label="A different explanation">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-surface p-5 shadow-card sm:rounded-2xl">
        <div className="mb-2 flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold tracking-wide text-accent uppercase">Let&apos;s try a different way</p>
            {alt?.strategy ? <p className="text-sm text-ink-3">This time, using {STRATEGY_LABEL[alt.strategy] ?? alt.strategy.replace(/-/g, " ")}.</p> : null}
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 hover:bg-surface-2" aria-label="Close"><X size={18} /></button>
        </div>
        {busy ? <p className="animate-pulse text-ink-3">Finding another way to explain it…</p> : null}
        {err ? <p className="text-sm text-bad">{err}</p> : null}
        {alt && !busy ? (
          alt.source === "none" ? (
            <div className="space-y-3">
              <p className="text-ink-2">{alt.message}</p>
            </div>
          ) : (
            <div className="space-y-3">
              <h3 className="text-lg font-semibold">{alt.title}</h3>
              {alt.text ? <RichText text={alt.text} /> : null}
              {alt.visual ? (
                <div className="rounded-lg border border-line p-3">
                  <Widget widget={alt.visual.widget} props={alt.visual.props} />
                  <p className="mt-2 text-sm text-ink-2"><RichText text={alt.visual.caption} inline /></p>
                </div>
              ) : null}
              {alt.check_question ? <p className="rounded-lg bg-accent-soft px-3 py-2 text-sm"><strong>Think about: </strong>{alt.check_question}</p> : null}
              {alt.source === "ai" ? <p className="text-xs text-ink-3">Written just now by the AI tutor for you.</p> : null}
            </div>
          )
        ) : null}
        {prerequisites.length ? (
          <div className="mt-4 border-t border-line pt-3 text-sm">
            <p className="text-ink-2">Sometimes the difficulty is an earlier idea. This lesson builds on:</p>
            <div className="mt-1 flex flex-wrap gap-2">
              {prerequisites.map((p) => <Link key={p.id} href={`/learn/${p.id}`} className="rounded-full border border-line px-3 py-1 hover:border-accent">{p.title}</Link>)}
            </div>
          </div>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-3">
          {alt && (alt.remaining_authored ?? 0) > 0 ? <Button onClick={() => load(false)} disabled={busy}>Still confused - another way</Button> : null}
          {ai.data?.configured && alt && (alt.remaining_authored ?? 0) === 0 ? (
            <Button onClick={() => load(true)} disabled={busy}>Ask the AI for a new explanation</Button>
          ) : null}
          {ai.data?.configured ? <Button onClick={onAskTutor}>Talk it through with the tutor</Button> : null}
          <Button variant="primary" onClick={onClose}>That helps - back to the lesson</Button>
        </div>
      </div>
    </div>
  );
}
