"use client";

import { useRef, useState } from "react";
import { api, refreshProgress, useAIStatus, useHealth } from "@/lib/api";
import { Button, Card } from "@/components/ui";

export default function Settings() {
  const ai = useAIStatus();
  const health = useHealth();
  const file = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState("");

  const download = async () => {
    const data = await api.exportData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `mathematical-universe-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    setMsg("Backup downloaded.");
  };
  const restore = async (f: File) => {
    try {
      await api.importData(JSON.parse(await f.text()));
      await refreshProgress();
      setMsg("Backup restored.");
    } catch (e) {
      setMsg(`Could not restore: ${(e as Error).message}`);
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="font-serif text-3xl font-semibold">Settings</h1>

      <Card>
        <h2 className="font-semibold">AI tutor</h2>
        {ai.data ? (
          <div className="mt-2 space-y-2 text-sm">
            <p>Status: <strong className={ai.data.configured ? "text-good" : "text-ink-2"}>{ai.data.configured ? "switched on" : "switched off"}</strong>
              {ai.data.model ? <> · provider {ai.data.provider} · model <code>{ai.data.model}</code></> : null}</p>
            {ai.data.reason ? <p className="text-ink-2">{ai.data.reason}</p> : null}
            <div className="rounded-lg bg-surface-2/60 p-3 text-ink-2">
              <p className="font-semibold text-ink">How to switch it on</p>
              <ol className="mt-1 list-decimal space-y-1 pl-5">
                <li>Create the file <code>backend/.env</code> (it is ignored by git, so your key is never committed).</li>
                <li>Add the line <code>ANTHROPIC_API_KEY=your-key-here</code>. Optionally choose a model with <code>MATH_AI_MODEL=…</code> and the reasoning depth with <code>MATH_AI_EFFORT=low|medium|high</code>.</li>
                <li>Restart the backend.</li>
              </ol>
              <p className="mt-2">The key stays on the backend: the browser never sees it. Without a key, every lesson, the dictionary, practice and progress tracking still work; only the tutor, AI-written explanations and AI grading of free-text answers are unavailable.</p>
            </div>
          </div>
        ) : <p className="text-sm text-ink-3">Checking…</p>}
      </Card>

      <Card>
        <h2 className="font-semibold">Your data</h2>
        <p className="mt-1 text-sm text-ink-2">Your progress, history, dictionary and conversations are stored in a local SQLite database on this computer.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={download}>Download a backup</Button>
          <Button onClick={() => file.current?.click()}>Restore from a backup</Button>
          <input ref={file} type="file" accept="application/json" className="hidden" onChange={(e) => e.target.files?.[0] && restore(e.target.files[0])} />
        </div>
        <div className="mt-5 border-t border-line pt-4">
          <p className="text-sm font-semibold text-bad">Start over</p>
          <p className="text-sm text-ink-2">Erase all progress and history. Download a backup first if you might want it back. Type RESET to confirm.</p>
          <div className="mt-2 flex gap-2">
            <input value={confirmReset} onChange={(e) => setConfirmReset(e.target.value)} aria-label="Type RESET to confirm"
              className="w-32 rounded-lg border border-line bg-surface px-3 py-2 text-sm" />
            <Button variant="danger" disabled={confirmReset !== "RESET"}
              onClick={async () => { await api.reset(); await refreshProgress(); setConfirmReset(""); setMsg("All progress erased."); }}>Erase everything</Button>
          </div>
        </div>
        {msg ? <p className="mt-3 text-sm text-ink-2" role="status">{msg}</p> : null}
      </Card>

      <Card>
        <h2 className="font-semibold">About</h2>
        <p className="mt-1 text-sm text-ink-2">
          {health.data ? `${health.data.lessons_available} lessons written, ${health.data.lessons_planned} planned, ${health.data.terms} dictionary words. Version ${health.data.version}.` : ""}
        </p>
      </Card>
    </div>
  );
}
