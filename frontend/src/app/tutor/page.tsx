"use client";

import { Trash2 } from "lucide-react";
import { useState } from "react";
import { mutate } from "swr";
import { api, useAIStatus, useThreads } from "@/lib/api";
import { AIOffNotice, TutorChat } from "@/components/TutorChat";
import { Button, Card } from "@/components/ui";

export default function Tutor() {
  const ai = useAIStatus();
  const { data: threads } = useThreads();
  const [threadId, setThreadId] = useState<string | null>(null);
  const [mode, setMode] = useState<"teaching" | "research">("teaching");
  const current = threads?.find((t) => t.id === threadId);
  const activeMode = (current?.mode as "teaching" | "research" | undefined) ?? mode;
  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-serif text-3xl font-semibold">Your tutor</h1>
        <p className="mt-2 max-w-2xl text-ink-2">
          A personal tutor who knows what you have learned, never uses a word you have not met without explaining it, and changes strategy when
          an explanation does not land. In research mode it becomes a careful collaborator that labels every claim as proved, conjectured or
          merely observed.
        </p>
      </header>
      {ai.data && !ai.data.configured ? <AIOffNotice reason={ai.data.reason} /> : (
        <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
          <aside className="space-y-3">
            <div className="flex gap-1" role="group" aria-label="Mode">
              <Button variant={mode === "teaching" ? "primary" : "secondary"} onClick={() => { setMode("teaching"); setThreadId(null); }}>Learn</Button>
              <Button variant={mode === "research" ? "primary" : "secondary"} onClick={() => { setMode("research"); setThreadId(null); }}>Research</Button>
            </div>
            <Button className="w-full" onClick={() => setThreadId(null)}>New conversation</Button>
            <ul className="space-y-1">
              {(threads ?? []).map((t) => (
                <li key={t.id} className="flex items-center gap-1">
                  <button type="button" onClick={() => { setThreadId(t.id); setMode(t.mode as "teaching" | "research"); }}
                    className={`flex-1 truncate rounded-lg px-3 py-1.5 text-left text-sm ${threadId === t.id ? "bg-accent-soft text-accent" : "hover:bg-surface-2"}`}>
                    {t.mode === "research" ? "🔬 " : ""}{t.title}
                  </button>
                  <button type="button" aria-label={`Delete ${t.title}`} className="rounded p-1 text-ink-3 hover:text-bad"
                    onClick={async () => { await api.deleteThread(t.id); if (threadId === t.id) setThreadId(null); await mutate("/tutor/threads"); }}>
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
            </ul>
          </aside>
          <Card>
            <TutorChat key={`${threadId ?? "new"}-${activeMode}`} threadId={threadId} onThread={setThreadId} mode={activeMode} />
          </Card>
        </div>
      )}
    </div>
  );
}
