/**
 * Entry point of the standalone build (one HTML page, no server): starts the in-page backend from src/local/,
 * points src/lib/api.ts at it, then renders the normal app - the Shell around the page the router picks.
 */
import { createRoot } from "react-dom/client";
import { Shell } from "@/components/Shell";
import type { ContentJson, Persistence } from "@/local/types";
import { ai, createPersistence, createServer } from "./dev-stub";
import content from "./content.json";
import { RouterView } from "./router";

function BootScreen({ error }: { error?: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      {error ? (
        <div className="max-w-md space-y-3" role="alert">
          <h1 className="font-serif text-2xl font-semibold">The Mathematical Universe could not start</h1>
          <p className="rounded-lg border border-bad/40 bg-bad-soft p-3 text-sm text-bad">{error}</p>
          <p className="text-ink-2">Reload the page to try again.</p>
        </div>
      ) : (
        <p className="animate-pulse font-serif text-lg text-ink-3">Opening The Mathematical Universe&hellip;</p>
      )}
    </div>
  );
}

/** Save anything still queued when the learner leaves or hides the page. */
function flushOnExit(persistence: Persistence) {
  const flush = () => void persistence.flush().catch(() => {});
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && flush());
}

async function start() {
  // The platform supplies <html>/<body>; give them what src/app/layout.tsx would.
  document.documentElement.lang = "en";
  document.documentElement.classList.add("h-full");
  document.body.classList.add("min-h-full");
  const el = document.getElementById("root") ?? document.body.appendChild(document.createElement("div"));
  const root = createRoot(el);
  root.render(<BootScreen />);
  try {
    const persistence = await createPersistence();
    const server = await createServer({ content: content as unknown as ContentJson, persistence, ai });
    Object.assign(globalThis, { __MU_LOCAL__: server, __MU_PERSISTENCE__: persistence });
    flushOnExit(persistence);
    root.render(
      <Shell>
        <RouterView />
      </Shell>,
    );
  } catch (e) {
    console.error(e);
    root.render(<BootScreen error={e instanceof Error ? e.message : String(e)} />);
  }
}

void start();
