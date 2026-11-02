"use client";

import { useRef, useState } from "react";
import { api, refreshProgress, useAIStatus, useHealth } from "@/lib/api";
import { offerDownload, STANDALONE, usePersistenceStatus } from "@/lib/mode";
import type { PersistenceMode } from "@/local/types";
import { Button, Card } from "@/components/ui";

/** Standalone build: where the learner's data lives (see src/local/persistence.ts). */
const SAVED_IN: Record<PersistenceMode, string> = {
  account: "Your progress, history, dictionary and conversations are saved privately to your Claude account.",
  browser: "Your progress, history, dictionary and conversations are saved in this browser only. Download a backup now and then to keep a copy.",
  memory: "Your progress, history, dictionary and conversations are not saved - they will be lost when you close the page. Download a backup before you leave.",
};

export default function Settings() {
  const ai = useAIStatus();
  const health = useHealth();
  const file = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState("");
  const saved = usePersistenceStatus();
  const [backup, setBackup] = useState<string | null>(null);
  const backupBox = useRef<HTMLTextAreaElement>(null);

  const download = async () => {
    const data = await api.exportData();
    if (STANDALONE) return offerBackup(JSON.stringify(data, null, 2));
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `mathematical-universe-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    setMsg("Backup downloaded.");
  };
  // Standalone build: the page cannot download files itself; the artifact offers the file to the viewer, or,
  // where that is not possible, the backup is shown to copy.
  const offerBackup = async (json: string) => {
    setBackup(null);
    setMsg("Preparing your backup…");
    const result = await offerDownload(`mathematical-universe-backup-${new Date().toISOString().slice(0, 10)}.json`, json);
    if (result === "saved") setMsg("Backup saved.");
    else if (result === "declined") setMsg("The backup was not saved.");
    else if (result === "busy") setMsg("A download is already waiting for your answer - try again in a moment.");
    else {
      setBackup(json);
      setMsg("This page cannot save files here, so your backup is shown below. Copy it and keep it somewhere safe.");
    }
  };
  const copyBackup = async () => {
    try {
      await navigator.clipboard.writeText(backup ?? "");
      setMsg("Backup copied. Paste it into a file or a note to keep it.");
    } catch {
      backupBox.current?.select();
      setMsg(document.execCommand("copy") ? "Backup copied. Paste it into a file or a note to keep it." : "Select the text in the box and copy it.");
    }
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
            {STANDALONE ? (
              <div className="rounded-lg bg-surface-2/60 p-3 text-ink-2">
                <p className="font-semibold text-ink">How it works here</p>
                <p className="mt-1">
                  The tutor uses Claude on your own claude.ai account, so there is no key to set up. The first time you ask it something,
                  claude.ai asks for your permission; its answers count towards your Claude usage.
                </p>
                <p className="mt-2">Without it, every lesson, the dictionary, practice and progress tracking still work; only the tutor, AI-written explanations and AI grading of free-text answers are unavailable.</p>
              </div>
            ) : (
              <div className="rounded-lg bg-surface-2/60 p-3 text-ink-2">
                <p className="font-semibold text-ink">How to switch it on</p>
                <ol className="mt-1 list-decimal space-y-1 pl-5">
                  <li>Create the file <code>backend/.env</code> (it is ignored by git, so your key is never committed).</li>
                  <li>Add the line <code>ANTHROPIC_API_KEY=your-key-here</code>. Optionally choose a model with <code>MATH_AI_MODEL=…</code> and the reasoning depth with <code>MATH_AI_EFFORT=low|medium|high</code>.</li>
                  <li>Restart the backend.</li>
                </ol>
                <p className="mt-2">The key stays on the backend: the browser never sees it. Without a key, every lesson, the dictionary, practice and progress tracking still work; only the tutor, AI-written explanations and AI grading of free-text answers are unavailable.</p>
              </div>
            )}
          </div>
        ) : <p className="text-sm text-ink-3">Checking…</p>}
      </Card>

      <Card>
        <h2 className="font-semibold">Your data</h2>
        {STANDALONE ? (
          <>
            <p className="mt-1 text-sm text-ink-2">{saved ? SAVED_IN[saved.mode] : "Checking where your progress is saved…"}</p>
            {saved?.error ? <p className="mt-1 text-sm text-bad">{saved.error}</p> : null}
          </>
        ) : (
          <p className="mt-1 text-sm text-ink-2">Your progress, history, dictionary and conversations are stored in a local SQLite database on this computer.</p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={download}>Download a backup</Button>
          <Button onClick={() => file.current?.click()}>Restore from a backup</Button>
          <input ref={file} type="file" accept="application/json" className="hidden" onChange={(e) => e.target.files?.[0] && restore(e.target.files[0])} />
        </div>
        {backup !== null ? (
          <div className="mt-3 space-y-2">
            <textarea ref={backupBox} readOnly value={backup} rows={8} aria-label="Your backup" onFocus={(e) => e.currentTarget.select()}
              className="w-full rounded-lg border border-line bg-surface-2/60 p-2 font-mono text-xs" />
            <Button onClick={copyBackup}>Copy</Button>
          </div>
        ) : null}
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
