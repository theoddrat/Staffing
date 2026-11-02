"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, Compass, FlaskConical, GraduationCap, Home, LineChart, Map, MessagesSquare, Menu, Puzzle, Settings, Telescope, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { SWRConfig } from "swr";
import { useAIStatus, useHealth } from "@/lib/api";
import { STANDALONE, usePersistenceStatus } from "@/lib/mode";
import { TermProvider } from "./TermContext";

const NAV = [
  { href: "/", label: "Home", icon: Home },
  { href: "/learn", label: "Curriculum", icon: GraduationCap },
  { href: "/map", label: "Knowledge map", icon: Map },
  { href: "/dictionary", label: "My dictionary", icon: BookOpen },
  { href: "/playground", label: "Playground", icon: Puzzle },
  { href: "/practice", label: "Practice", icon: Compass },
  { href: "/tutor", label: "Tutor", icon: MessagesSquare },
  { href: "/progress", label: "Progress", icon: LineChart },
  { href: "/research", label: "Research", icon: Telescope },
  { href: "/settings", label: "Settings", icon: Settings },
];

function BackendStatus() {
  const { error } = useHealth();
  const ai = useAIStatus();
  if (error)
    return STANDALONE ? (
      <p className="rounded-lg bg-bad-soft p-2 text-xs text-bad">Something went wrong inside the app: {error.message.replace(/\.?$/, ".")} Reload the page to try again.</p>
    ) : (
      <p className="rounded-lg bg-bad-soft p-2 text-xs text-bad">
        Backend not reachable. Start it with <code>uvicorn app.main:app</code> in <code>backend/</code>.
      </p>
    );
  return (
    <>
      <p className="flex items-center gap-1.5 text-xs text-ink-3">
        <span className={`inline-block h-2 w-2 rounded-full ${ai.data?.configured ? "bg-good" : "bg-line"}`} />
        {ai.data?.configured ? `AI tutor: ${STANDALONE ? "Claude (your account)" : ai.data.model}` : "AI tutor off (see Settings)"}
      </p>
      {STANDALONE ? <SavedStatus /> : null}
    </>
  );
}

/** Standalone build only: where progress is being saved (the Claude account, this browser, or nowhere). */
function SavedStatus() {
  const s = usePersistenceStatus();
  if (!s) return null;
  const warn = !!s.error || s.mode === "memory";
  return (
    <p className={`mt-1.5 flex items-start gap-1.5 text-xs ${warn ? "text-warn" : "text-ink-3"}`}>
      <span className={`mt-1 inline-block h-2 w-2 shrink-0 rounded-full ${warn ? "bg-warn" : "bg-good"}`} />
      {s.error ?? (s.mode === "account" ? "Progress saved to your Claude account" : s.mode === "browser" ? "Progress saved in this browser only" : "Progress is not being saved (see Settings)")}
    </p>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  const nav = (
    <nav className="flex flex-col gap-0.5" aria-label="Main">
      {NAV.map(({ href, label, icon: Icon }) => (
        <Link key={href} href={href} onClick={() => setOpen(false)}
          className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition ${
            active(href) ? "bg-accent-soft text-accent" : "text-ink-2 hover:bg-surface-2 hover:text-ink"}`}
          aria-current={active(href) ? "page" : undefined}>
          <Icon size={17} />
          {label}
        </Link>
      ))}
    </nav>
  );
  return (
    <SWRConfig value={{ shouldRetryOnError: false }}>
      <TermProvider>
        <div className="flex min-h-screen">
          <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col gap-6 border-r border-line bg-surface px-3 py-5 lg:flex">
            <Link href="/" className="flex items-center gap-2 px-3">
              <FlaskConical className="text-accent" size={22} />
              <span className="font-serif text-lg leading-tight font-semibold">The Mathematical Universe</span>
            </Link>
            {nav}
            <div className="mt-auto px-3"><BackendStatus /></div>
          </aside>
          <div className="flex min-w-0 flex-1 flex-col">
            <header className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-surface/90 px-4 py-3 backdrop-blur lg:hidden">
              <Link href="/" className="font-serif font-semibold">The Mathematical Universe</Link>
              <button type="button" onClick={() => setOpen(!open)} aria-label="Open menu" className="rounded p-1.5 hover:bg-surface-2">
                {open ? <X size={20} /> : <Menu size={20} />}
              </button>
            </header>
            {open ? <div className="border-b border-line bg-surface p-3 lg:hidden">{nav}<div className="mt-3 px-3"><BackendStatus /></div></div> : null}
            <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6 lg:py-10">{children}</main>
          </div>
        </div>
      </TermProvider>
    </SWRConfig>
  );
}
