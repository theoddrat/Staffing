"use client";

import Link from "next/link";
import { Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { mutate } from "swr";
import { api, useAIStatus, useThread } from "@/lib/api";
import { STANDALONE } from "@/lib/mode";
import type { MessageOut } from "@/lib/types";
import { RichText } from "./RichText";
import { KindBadge } from "./Statements";
import { Button } from "./ui";

export function AIOffNotice({ reason }: { reason?: string | null }) {
  return (
    <div className="rounded-lg border border-line bg-surface-2/60 p-4 text-sm">
      <p className="font-semibold">The AI tutor is not switched on.</p>
      <p className="mt-1 text-ink-2">{reason ?? "No AI provider is configured."}</p>
      {STANDALONE ? (
        <p className="mt-2 text-ink-2">
          Everything else - lessons, the dictionary, practice, assessments and progress - works without it. The tutor uses Claude on your own
          claude.ai account: open this page in claude.ai and it will ask your permission the first time you send it a message
          (see <Link href="/settings" className="text-accent hover:underline">Settings</Link>).
        </p>
      ) : (
        <p className="mt-2 text-ink-2">
          Everything else - lessons, the dictionary, practice, assessments and progress - works without it. To enable the tutor, add an
          Anthropic API key to <code>backend/.env</code> (see <Link href="/settings" className="text-accent hover:underline">Settings</Link>).
        </p>
      )}
    </div>
  );
}

function Message({ m }: { m: MessageOut }) {
  if (m.role === "user")
    return (
      <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-accent px-4 py-2.5 text-accent-ink">
        <p className="whitespace-pre-wrap">{m.content}</p>
      </div>
    );
  return (
    <div className="max-w-[92%] space-y-2 rounded-2xl rounded-bl-sm border border-line bg-surface px-4 py-3">
      {m.strategy ? <p className="text-xs text-ink-3">Explaining with: {m.strategy.replace(/-/g, " ")}</p> : null}
      <RichText text={m.content} />
      {m.check_question ? (
        <p className="rounded-lg bg-accent-soft px-3 py-2 text-sm"><strong>Check yourself: </strong><RichText text={m.check_question} inline /></p>
      ) : null}
      {m.missing_prerequisites.length ? (
        <div className="text-sm">
          <p className="text-ink-2">This builds on ideas you may want to look at first:</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {m.missing_prerequisites.map((n) => (
              <Link key={n.id} href={`/learn/${n.id}`} className="rounded-full border border-line px-3 py-1 hover:border-accent">
                {n.title}{n.available ? "" : " (planned)"}
              </Link>
            ))}
          </div>
        </div>
      ) : null}
      {m.statements.length ? (
        <ul className="space-y-1 text-sm">
          {m.statements.map((s, i) => <li key={i} className="flex flex-wrap items-start gap-2"><KindBadge kind={s.kind} /><RichText text={s.text} inline /></li>)}
        </ul>
      ) : null}
      {m.tool_calls.length ? (
        <details className="text-xs text-ink-3">
          <summary className="cursor-pointer">Calculations checked by the exact calculator ({m.tool_calls.length})</summary>
          <ul className="mt-1 font-mono">{m.tool_calls.map((t, i) => <li key={i}>{String((t.input as { expression?: string } | undefined)?.expression ?? "")} = {String(t.output)}</li>)}</ul>
        </details>
      ) : null}
    </div>
  );
}

const QUICK = ["I don't understand - can you explain it differently?", "Can you explain that like I'm five?", "Show me visually.", "Give me another example.", "Why is this important?", "Where will I use this?"];

export function TutorChat({ threadId, onThread, lessonId, section, mode = "teaching", compact = false }: {
  threadId: string | null; onThread?: (id: string) => void; lessonId?: string | null; section?: string | null;
  mode?: "teaching" | "research"; compact?: boolean;
}) {
  const ai = useAIStatus();
  const { data: thread } = useThread(threadId);
  const [text, setText] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [thread?.messages.length, pending]);

  if (ai.data && !ai.data.configured) return <AIOffNotice reason={ai.data.reason} />;

  const send = async (content: string) => {
    if (!content.trim()) return;
    setErr(null);
    setPending(content);
    setText("");
    try {
      let id = threadId;
      if (!id) {
        const t = await api.createThread({ lesson_id: lessonId ?? null, mode });
        id = t.id;
        onThread?.(id);
      }
      await api.sendMessage(id, content, lessonId, section);
      await mutate(`/tutor/threads/${id}`);
      await mutate("/tutor/threads");
    } catch (e) {
      setErr((e as Error).message);
      setText(content);
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="flex h-full flex-col gap-3">
      <div className={`flex-1 space-y-3 overflow-y-auto ${compact ? "max-h-[55vh]" : "min-h-[40vh]"}`}>
        {!thread?.messages.length && !pending ? (
          <p className="text-sm text-ink-3">
            {mode === "research"
              ? "Bring an idea, a conjecture or a question. Your research partner will help formalise it, test small cases, look for counterexamples and say clearly what is proved and what is not."
              : "Ask anything - \"What does this symbol mean?\", \"Why does this work?\", \"Can I try something?\". The tutor knows which lessons you have done and will not use words you have not learned without explaining them."}
          </p>
        ) : null}
        {thread?.messages.map((m) => <Message key={m.id} m={m} />)}
        {pending ? (
          <>
            <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-accent/80 px-4 py-2.5 text-accent-ink">{pending}</div>
            <p className="animate-pulse text-sm text-ink-3">Thinking…</p>
          </>
        ) : null}
        <div ref={end} />
      </div>
      {err ? <p className="text-sm text-bad">{err}</p> : null}
      <div className="flex flex-wrap gap-1.5">
        {QUICK.slice(0, compact ? 4 : 6).map((q) => (
          <button key={q} type="button" onClick={() => send(q)} disabled={!!pending}
            className="rounded-full border border-line bg-surface px-3 py-1 text-xs hover:border-accent disabled:opacity-50">{q}</button>
        ))}
      </div>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void send(text); }}>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} aria-label="Message to the tutor"
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(text); } }}
          placeholder={mode === "research" ? "Describe your idea…" : "Ask the tutor, or paste a formula to have it translated into plain English…"}
          className="flex-1 resize-none rounded-lg border border-line bg-surface px-3 py-2" />
        <Button variant="primary" type="submit" disabled={!text.trim() || !!pending} aria-label="Send"><Send size={16} /></Button>
      </form>
    </div>
  );
}
