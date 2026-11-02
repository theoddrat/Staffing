"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Maximize2, Minus, Plus } from "lucide-react";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { useCurriculum, useProgress } from "@/lib/api";
import type { NodeOut } from "@/lib/types";
import { Button, Card, ErrorNote, Loading, STATE_INFO, StateBadge } from "@/components/ui";

const COL_W = 210;
const NODE_W = 182;
const NODE_H = 24;
const ROW_H = 32;
const MAX_PER_COL = 26;

type Pos = { x: number; y: number };

function useLayout(lessons: NodeOut[] | undefined, stageOrder: string[]) {
  return useMemo(() => {
    const pos = new Map<string, Pos>();
    const headers: { label: string; x: number }[] = [];
    if (!lessons) return { pos, headers, width: 0, height: 0 };
    let col = 0;
    let maxRows = 0;
    for (const sid of stageOrder) {
      const items = lessons.filter((l) => l.stage === sid);
      const cols = Math.max(1, Math.ceil(items.length / MAX_PER_COL));
      headers.push({ label: sid, x: col * COL_W });
      items.forEach((l, i) => {
        const c = Math.floor(i / MAX_PER_COL);
        const r = i % MAX_PER_COL;
        pos.set(l.id, { x: (col + c) * COL_W, y: 40 + r * ROW_H });
        maxRows = Math.max(maxRows, r + 1);
      });
      col += cols;
    }
    return { pos, headers, width: col * COL_W, height: 40 + maxRows * ROW_H };
  }, [lessons, stageOrder]);
}

function closure(start: string, next: (id: string) => string[]): Set<string> {
  const seen = new Set<string>();
  const stack = [...next(start)];
  while (stack.length) {
    const c = stack.pop()!;
    if (seen.has(c)) continue;
    seen.add(c);
    stack.push(...next(c));
  }
  return seen;
}

function MapView() {
  const { data: cur, error } = useCurriculum();
  const { data: prog } = useProgress();
  const params = useSearchParams();
  const router = useRouter();
  const [target, setTarget] = useState<string | null>(params.get("target"));
  const [selected, setSelected] = useState<string | null>(params.get("focus"));
  const [query, setQuery] = useState("");
  const stageOrder = useMemo(() => cur?.stages.map((s) => s.id) ?? [], [cur]);
  const { pos, headers, width, height } = useLayout(cur?.lessons, stageOrder);
  const byId = useMemo(() => new Map((cur?.lessons ?? []).map((l) => [l.id, l])), [cur]);
  const children = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const l of cur?.lessons ?? []) for (const p of l.pre) m.set(p, [...(m.get(p) ?? []), l.id]);
    return m;
  }, [cur]);
  const ancestors = useCallback((id: string) => closure(id, (x) => byId.get(x)?.pre ?? []), [byId]);
  const descendants = useCallback((id: string) => closure(id, (x) => children.get(x) ?? []), [children]);

  const pathSet = useMemo(() => (target && byId.has(target) ? new Set([...ancestors(target), target]) : null), [target, ancestors, byId]);
  const selAnc = useMemo(() => (selected ? ancestors(selected) : new Set<string>()), [selected, ancestors]);
  const selDesc = useMemo(() => (selected ? descendants(selected) : new Set<string>()), [selected, descendants]);

  // ---------------------------------------------------------------- pan & zoom
  const box = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 0.5 });
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const fit = useCallback(() => {
    const el = box.current;
    if (!el || !width) return;
    const k = Math.min(el.clientWidth / (width + 40), el.clientHeight / (height + 40), 1);
    setView({ x: 20, y: 10, k });
  }, [width, height]);
  // Start at a readable zoom on Level 0; "fit" shows the whole journey.
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !width) return;
    started.current = true;
    setView({ x: 20, y: 10, k: 0.85 });
  }, [width]);
  const zoomAt = (factor: number, cx?: number, cy?: number) => {
    const el = box.current;
    if (!el) return;
    const px = cx ?? el.clientWidth / 2;
    const py = cy ?? el.clientHeight / 2;
    setView((v) => {
      const k = Math.min(2.5, Math.max(0.15, v.k * factor));
      return { k, x: px - ((px - v.x) * k) / v.k, y: py - ((py - v.y) * k) / v.k };
    });
  };
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);
  const centerOn = (id: string) => {
    const p = pos.get(id);
    const el = box.current;
    if (!p || !el) return;
    const k = Math.max(view.k, 0.9);
    setView({ k, x: el.clientWidth / 2 - (p.x + NODE_W / 2) * k, y: el.clientHeight / 2 - (p.y + NODE_H / 2) * k });
  };

  if (error) return <ErrorNote error={error} />;
  if (!cur) return <Loading />;
  const stateOf = (id: string) => prog?.states[id]?.state ?? "not_started";
  const sel = selected ? byId.get(selected) : null;
  const searchHits = query.trim().length > 1 ? cur.lessons.filter((l) => l.title.toLowerCase().includes(query.toLowerCase())).slice(0, 8) : [];
  const setTargetUrl = (t: string | null) => {
    setTarget(t);
    router.replace(t ? `/map?target=${t}` : "/map", { scroll: false });
  };

  const dimmed = (id: string) => (pathSet ? !pathSet.has(id) : selected ? id !== selected && !selAnc.has(id) && !selDesc.has(id) : false);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-serif text-3xl font-semibold">Knowledge map</h1>
        <p className="mt-2 max-w-3xl text-ink-2">
          Every lesson in the journey, in columns from Level 0 on the left to the two research paths on the right. A line from one lesson to
          another means the first is needed before the second. Colours show where you are. Click a lesson to see what it needs and what it
          opens up.
        </p>
      </header>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-ink-2">Show the whole path to:</span>
        <Button variant={target === "pa-research" ? "primary" : "secondary"} onClick={() => setTargetUrl(target === "pa-research" ? null : "pa-research")}>P versus NP</Button>
        <Button variant={target === "pb-research" ? "primary" : "secondary"} onClick={() => setTargetUrl(target === "pb-research" ? null : "pb-research")}>Riemann Hypothesis</Button>
        {target ? <Button variant="ghost" onClick={() => setTargetUrl(null)}>Clear</Button> : null}
        <div className="relative ml-auto">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a lesson…" aria-label="Find a lesson on the map"
            className="w-56 rounded-lg border border-line bg-surface px-3 py-2 text-sm" />
          {searchHits.length ? (
            <ul className="absolute right-0 z-10 mt-1 w-72 rounded-lg border border-line bg-surface p-1 shadow-card">
              {searchHits.map((h) => (
                <li key={h.id}>
                  <button type="button" className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-surface-2"
                    onClick={() => { setSelected(h.id); centerOn(h.id); setQuery(""); }}>{h.title} <span className="text-xs text-ink-3">{h.stage}</span></button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap gap-3 text-xs text-ink-2">
        {Object.entries(STATE_INFO).map(([k, v]) => (
          <span key={k} className="flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded" style={{ background: v.dot }} />{v.label}</span>
        ))}
        <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-5 rounded border border-dashed border-ink-3" />planned (not written yet)</span>
      </div>

      <div className="relative">
        <div ref={box} className="h-[68vh] cursor-grab touch-none overflow-hidden rounded-xl border border-line bg-surface active:cursor-grabbing"
          onPointerDown={(e: RPointerEvent) => { drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }; }}
          onPointerMove={(e: RPointerEvent) => { const d = drag.current; if (d) setView((v) => ({ ...v, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y })); }}
          onPointerUp={() => (drag.current = null)} onPointerLeave={() => (drag.current = null)}>
          <svg width="100%" height="100%" role="img" aria-label="Knowledge map of all lessons and their prerequisites">
            <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
              {headers.map((h) => {
                const st = cur.stages.find((s) => s.id === h.label);
                return (
                  <text key={h.label} x={h.x + 4} y={20} fontSize={13} fontWeight={700} fill={h.label === "PA" ? "var(--pnp)" : h.label === "PB" ? "var(--rh)" : "var(--ink-2)"}>
                    {st?.kind === "path" ? (h.label === "PA" ? "P vs NP" : "Riemann") : `Level ${st?.number}`} · {st?.title.slice(0, 22)}
                  </text>
                );
              })}
              {cur.lessons.map((l) =>
                l.pre.map((p) => {
                  const a = pos.get(p);
                  const b = pos.get(l.id);
                  if (!a || !b) return null;
                  const hot = (selected && ((selAnc.has(p) && (selAnc.has(l.id) || l.id === selected)) || ((p === selected || selDesc.has(p)) && selDesc.has(l.id))))
                    || (pathSet && pathSet.has(p) && pathSet.has(l.id));
                  const x1 = a.x + NODE_W, y1 = a.y + NODE_H / 2, x2 = b.x, y2 = b.y + NODE_H / 2;
                  const sameCol = Math.abs(x1 - NODE_W - x2) < 1;
                  const d = sameCol
                    ? `M${a.x + 4},${y1} C${a.x - 30},${y1} ${b.x - 30},${y2} ${b.x + 4},${y2}`
                    : `M${x1},${y1} C${x1 + 40},${y1} ${x2 - 40},${y2} ${x2},${y2}`;
                  return (
                    <path key={`${p}>${l.id}`} d={d} fill="none"
                      stroke={hot ? (selDesc.has(l.id) && !pathSet ? "var(--good)" : "var(--accent)") : "var(--ink-3)"}
                      strokeOpacity={hot ? 0.75 : 0.07} strokeWidth={hot ? 1.6 : 1} />
                  );
                }),
              )}
              {cur.lessons.map((l) => {
                const p = pos.get(l.id)!;
                const st = stateOf(l.id);
                const info = STATE_INFO[st as keyof typeof STATE_INFO];
                const isSel = selected === l.id;
                return (
                  <g key={l.id} transform={`translate(${p.x},${p.y})`} opacity={dimmed(l.id) ? 0.22 : 1}
                    onPointerDown={(e) => e.stopPropagation()} onClick={() => setSelected(isSel ? null : l.id)}
                    style={{ cursor: "pointer" }} role="button" aria-label={`${l.title}, ${info.label}${l.available ? "" : ", planned"}`}>
                    <rect width={NODE_W} height={NODE_H} rx={6}
                      fill={st === "not_started" ? "var(--surface)" : info.dot} fillOpacity={st === "not_started" ? 1 : 0.22}
                      stroke={isSel ? "var(--accent)" : st === "not_started" ? "var(--line)" : info.dot} strokeWidth={isSel ? 2.5 : 1.2}
                      strokeDasharray={l.available ? undefined : "4 3"} />
                    <circle cx={10} cy={NODE_H / 2} r={4} fill={info.dot} />
                    <text x={20} y={NODE_H / 2 + 4} fontSize={11} fill={l.available ? "var(--ink)" : "var(--ink-3)"}>
                      {l.title.length > 27 ? l.title.slice(0, 26) + "…" : l.title}
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>
        </div>
        <div className="absolute top-3 right-3 flex flex-col gap-1">
          <button type="button" className="rounded-lg border border-line bg-surface p-1.5 shadow-card" onClick={() => zoomAt(1.25)} aria-label="Zoom in"><Plus size={16} /></button>
          <button type="button" className="rounded-lg border border-line bg-surface p-1.5 shadow-card" onClick={() => zoomAt(0.8)} aria-label="Zoom out"><Minus size={16} /></button>
          <button type="button" className="rounded-lg border border-line bg-surface p-1.5 shadow-card" onClick={fit} aria-label="Fit to screen"><Maximize2 size={16} /></button>
        </div>
        {sel ? (
          <Card className="absolute bottom-3 left-3 max-w-sm">
            <p className="text-xs text-ink-3">{cur.stages.find((s) => s.id === sel.stage)?.title}</p>
            <p className="mt-0.5 font-semibold">{sel.title}</p>
            <div className="mt-1"><StateBadge state={stateOf(sel.id) as never} /> {!sel.available ? <span className="text-xs text-ink-3">planned</span> : null}</div>
            <p className="mt-2 text-sm text-ink-2">{sel.summary}</p>
            <p className="mt-2 text-xs text-ink-3">Needs {selAnc.size} earlier lessons · opens the way to {selDesc.size} later ones.</p>
            <div className="mt-3 flex gap-2">
              <Link href={`/learn/${sel.id}`} className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink">{sel.available ? "Open lesson" : "See details"}</Link>
              <Button variant="ghost" onClick={() => setSelected(null)}>Close</Button>
            </div>
          </Card>
        ) : null}
      </div>

      {pathSet && target ? (
        <Card>
          <h2 className="font-semibold">The path to {byId.get(target)?.title}, as a list</h2>
          <p className="mt-1 text-sm text-ink-2">{pathSet.size} lessons, grouped by level. Each one needs only lessons that come before it.</p>
          <div className="mt-3 space-y-3">
            {cur.stages.map((s) => {
              const items = cur.lessons.filter((l) => l.stage === s.id && pathSet.has(l.id));
              if (!items.length) return null;
              return (
                <div key={s.id}>
                  <p className="text-sm font-semibold">{s.kind === "path" ? s.title : `Level ${s.number}: ${s.title}`} <span className="font-normal text-ink-3">({items.length})</span></p>
                  <p className="text-sm text-ink-2">
                    {items.map((l, i) => (
                      <span key={l.id}>{i ? " → " : ""}<Link href={`/learn/${l.id}`} className={l.available ? "text-accent hover:underline" : "text-ink-3 hover:underline"}>{l.title}</Link></span>
                    ))}
                  </p>
                </div>
              );
            })}
          </div>
        </Card>
      ) : null}
    </div>
  );
}

export default function MapPage() {
  return (
    <Suspense fallback={<Loading />}>
      <MapView />
    </Suspense>
  );
}
