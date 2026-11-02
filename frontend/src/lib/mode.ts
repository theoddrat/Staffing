"use client";

import { useSyncExternalStore } from "react";
import type { Persistence, PersistenceStatus } from "@/local/types";

/**
 * True in the single-file build (frontend/standalone): the app runs as a claude.ai artifact with no server, and
 * src/local/ answers every /api call in the page. Always false in the normal Next.js app.
 */
export const STANDALONE = process.env.NEXT_PUBLIC_MU_STANDALONE === "1";

function persistence(): Persistence | undefined {
  return (globalThis as { __MU_PERSISTENCE__?: Persistence }).__MU_PERSISTENCE__;
}

let last: PersistenceStatus | null = null;

/** status() may build a new object on every call; hand React the same object until something changes. */
function snapshot(): PersistenceStatus | null {
  const s = persistence()?.status() ?? null;
  if (!s || !last || s.mode !== last.mode || s.saving !== last.saving || s.error !== last.error) last = s;
  return last;
}

function subscribe(onChange: () => void) {
  return persistence()?.onStatus(() => onChange()) ?? (() => {});
}

/** Where (and whether) the learner's progress is being saved, live. Null in the normal app. */
export function usePersistenceStatus(): PersistenceStatus | null {
  return useSyncExternalStore(subscribe, snapshot, () => null);
}

type Downloads = { save(request: { filename: string; data: string }): Promise<unknown> };
type ClaudeRuntime = { use?: (name: string) => Promise<unknown> };

/**
 * Offer a file to the viewer through the artifact `downloads` capability (a page cannot download files itself).
 * "unavailable" means this view cannot save files: show the contents instead.
 */
export async function offerDownload(filename: string, data: string): Promise<"saved" | "declined" | "busy" | "unavailable"> {
  const claude = (globalThis as { claude?: ClaudeRuntime }).claude;
  let downloads: Downloads | null = null;
  try {
    downloads = ((await claude?.use?.("downloads")) as Downloads | null | undefined) ?? null;
  } catch {
    downloads = null;
  }
  if (!downloads) return "unavailable";
  try {
    await downloads.save({ filename, data });
    return "saved";
  } catch (e) {
    const code = (e as { code?: string } | null)?.code;
    if (code === "declined") return "declined";
    if (code === "rate_limited") return "busy";
    return "unavailable";
  }
}
