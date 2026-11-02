"use client";

import Link from "next/link";
import { Search, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { mutate } from "swr";
import { api, useAIStatus, useDictionary, useDrafts } from "@/lib/api";
import { Tex } from "@/components/Tex";
import { Button, Card, ErrorNote, Loading } from "@/components/ui";
import { useTerms } from "@/components/TermContext";

export default function Dictionary() {
  const { data, error } = useDictionary();
  const { data: drafts } = useDrafts();
  const ai = useAIStatus();
  const { openTerm } = useTerms();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"mine" | "all" | "learned">("all");
  const [drafting, setDrafting] = useState(false);
  const [draftErr, setDraftErr] = useState<string | null>(null);
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data ?? [])
      .filter((t) => (filter === "mine" ? t.seen : filter === "learned" ? t.learned : true))
      .filter((t) => !needle || t.word.toLowerCase().includes(needle) || t.aliases.some((a) => a.toLowerCase().includes(needle)) || t.plain.toLowerCase().includes(needle));
  }, [data, q, filter]);
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Loading />;
  const groups = new Map<string, typeof list>();
  for (const t of list) {
    const k = t.word[0].toUpperCase();
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  const draft = async () => {
    setDrafting(true);
    setDraftErr(null);
    try {
      await api.draftTerm(q.trim());
      await mutate("/dictionary/drafts");
    } catch (e) {
      setDraftErr((e as Error).message);
    } finally {
      setDrafting(false);
    }
  };
  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-serif text-3xl font-semibold">My mathematical dictionary</h1>
        <p className="mt-2 max-w-2xl text-ink-2">
          Every word is added here automatically the moment you meet it in a lesson. Each entry has ten parts: the word, how to say it, its
          plain meaning, an everyday analogy, a picture, the precise definition, an example, a non-example, related words, and where you will
          use it later. Underlined words anywhere in the app open their entry.
        </p>
      </header>
      <div className="flex flex-wrap items-center gap-3">
        <label className="relative flex-1">
          <Search size={16} className="absolute top-1/2 left-3 -translate-y-1/2 text-ink-3" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search for a word…" aria-label="Search the dictionary"
            className="w-full rounded-lg border border-line bg-surface py-2 pr-3 pl-9" />
        </label>
        <div className="flex gap-1" role="group" aria-label="Filter">
          {(["all", "mine", "learned"] as const).map((f) => (
            <Button key={f} variant={filter === f ? "primary" : "secondary"} onClick={() => setFilter(f)}>
              {f === "all" ? `All (${data.length})` : f === "mine" ? `Met (${data.filter((t) => t.seen).length})` : `Learned (${data.filter((t) => t.learned).length})`}
            </Button>
          ))}
        </div>
      </div>
      {!list.length ? (
        <Card>
          <p>No word matches &ldquo;{q}&rdquo;{filter !== "all" ? " in this filter" : ""}.</p>
          {q.trim() && ai.data?.configured ? (
            <div className="mt-3">
              <p className="text-sm text-ink-2">Ask the AI tutor to draft an entry for it (marked as AI-written until reviewed):</p>
              <Button className="mt-2" onClick={draft} disabled={drafting}><Sparkles size={15} /> {drafting ? "Drafting…" : `Draft an entry for "${q.trim()}"`}</Button>
              {draftErr ? <p className="mt-2 text-sm text-bad">{draftErr}</p> : null}
            </div>
          ) : q.trim() ? (
            <p className="mt-2 text-sm text-ink-3">It may belong to a later level that is not written yet. With the AI tutor switched on, you could ask for a draft entry.</p>
          ) : null}
        </Card>
      ) : null}
      {[...groups.entries()].sort().map(([letter, terms]) => (
        <section key={letter}>
          <h2 className="mb-2 font-serif text-xl font-semibold text-ink-3">{letter}</h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {terms.map((t) => (
              <li key={t.id}>
                <button type="button" onClick={() => openTerm(t.id)}
                  className="w-full rounded-lg border border-line bg-surface p-3 text-left hover:border-accent">
                  <span className="flex items-center gap-2">
                    <span className="font-semibold">{t.word}</span>
                    {t.symbol ? <span className="text-ink-2"><Tex tex={t.symbol} /></span> : null}
                    {t.learned ? <span className="ml-auto text-xs text-good">learned</span> : t.seen ? <span className="ml-auto text-xs text-info">met</span> : null}
                  </span>
                  <span className="mt-0.5 block text-sm text-ink-2">{t.plain}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {drafts?.length ? (
        <section>
          <h2 className="mb-2 text-lg font-semibold">AI-drafted entries (not yet reviewed)</h2>
          <ul className="space-y-2">
            {drafts.map((d) => (
              <li key={d.id}>
                <Card>
                  <p className="font-semibold">{String(d.entry.word ?? d.word)} <span className="ml-2 text-xs font-normal text-warn">AI-written · {d.model}</span></p>
                  <p className="mt-1 text-sm"><strong>Plain meaning: </strong>{String(d.entry.plain ?? "")}</p>
                  <p className="mt-1 text-sm"><strong>Definition: </strong>{String(d.entry.formal ?? "")}</p>
                  <details className="mt-1 text-sm text-ink-2"><summary className="cursor-pointer">All ten parts</summary>
                    <dl className="mt-1 space-y-1">{Object.entries(d.entry).filter(([k]) => k !== "is_mathematical_term").map(([k, v]) => (
                      <div key={k}><dt className="inline font-semibold">{k.replace(/_/g, " ")}: </dt><dd className="inline">{Array.isArray(v) ? v.join(", ") : String(v)}</dd></div>
                    ))}</dl>
                  </details>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <p className="text-sm text-ink-3">Looking for a lesson instead? <Link href="/learn" className="text-accent hover:underline">Browse the curriculum</Link>.</p>
    </div>
  );
}
