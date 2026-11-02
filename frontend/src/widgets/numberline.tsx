"use client";

import { useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { bool, clamp, Controls, Note, num, SmallButton, str, useGoal, type WidgetProps } from "./common";

type Jumps = { start: number; size: number; count: number };
type Pt = { label: string; value: number };

const fmt = (v: number) => {
  const r = Math.round(v * 1000) / 1000;
  return (r < 0 ? "−" : "") + Math.abs(r).toString();
};

export function NumberLine({ props, goal, onComplete, compact }: WidgetProps) {
  const min = num(props, "min", 0);
  const max = num(props, "max", 10);
  const step = num(props, "step", 1);
  const span = max - min;
  const labelEvery = num(props, "labelEvery", span > 24 ? 5 : span > 12 ? 2 : 1);
  const orientation = str(props, "orientation", "horizontal");
  const theme = str(props, "theme", "plain");
  const highlight = str(props, "highlight", "");
  const editable = bool(props, "editable");
  const showDistance = bool(props, "showDistance");
  const fracDen = num(props, "fractionLabels", 0);
  const snap = num(props, "snap", fracDen ? 1 / fracDen : step);
  const jumpsProp = (props.jumps as Jumps | undefined) ?? null;
  const points = (props.points as Pt[] | undefined) ?? null;

  const [jumps, setJumps] = useState<Jumps | null>(jumpsProp);
  const [value, setValueRaw] = useState<number | null>(
    jumpsProp ? jumpsProp.start + jumpsProp.size * jumpsProp.count : typeof props.value === "number" ? (props.value as number) : null,
  );
  const [visited, setVisited] = useState<Set<number>>(new Set(value !== null ? [value] : []));
  const [moved, setMoved] = useState(false);
  const setValue = (v: number) => {
    const s = clamp(Math.round(v / snap) * snap, min, max);
    const r = Math.round(s * 1e6) / 1e6;
    setValueRaw(r);
    setVisited((prev) => new Set([...prev, r]));
    setMoved(true);
  };

  const targets = (goal?.targets as number[] | undefined) ?? null;
  useGoal(
    moved &&
      ((goal?.target !== undefined && value === goal.target) || (targets !== null && targets.every((t) => visited.has(t)))),
    onComplete,
    { value },
  );

  const vertical = orientation === "vertical";
  const W = vertical ? (compact ? 160 : 200) : compact ? 320 : 600;
  const H = vertical ? (compact ? 220 : 340) : compact ? 74 : 108;
  const pad = 24;
  const len = (vertical ? H : W) - pad * 2;
  const toPx = (v: number) => pad + ((v - min) / span) * len;
  const pos = (v: number) => (vertical ? { x: W / 2, y: H - toPx(v) } : { x: toPx(v), y: H * 0.5 });
  const svgRef = useRef<SVGSVGElement>(null);
  const dragging = useRef(false);

  const fromEvent = (e: RPointerEvent) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const t = vertical ? 1 - (e.clientY - rect.top) / rect.height : (e.clientX - rect.left) / rect.width;
    const px = t * (vertical ? H : W);
    const pxFromStart = vertical ? px : px;
    return min + ((pxFromStart - pad) / len) * span;
  };

  const ticks: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  const isLabelled = (v: number) => Math.abs(Math.round(v / labelEvery) * labelEvery - v) < 1e-9 || v === min || v === max;
  const intTicks = ticks.filter((v) => Number.isInteger(v));
  const hl = (v: number) =>
    (highlight === "integers" && Number.isInteger(v)) ||
    (highlight === "whole" && Number.isInteger(v) && v >= 0) ||
    (highlight === "natural" && Number.isInteger(v) && v >= 1);

  const unit = theme === "temperature" ? "°C" : theme === "sea-level" ? " m" : "";
  const label = (v: number) => {
    if (fracDen && !Number.isInteger(v)) {
      const n = Math.round(v * fracDen);
      return `${n}/${fracDen}`;
    }
    return fmt(v);
  };

  const zero = clamp(0, min, max);
  const p0 = pos(zero);
  const pv = value !== null ? pos(value) : null;

  return (
    <div>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className={`${vertical ? "mx-auto h-auto max-w-[220px]" : "w-full"} touch-none select-none rounded-lg bg-surface`}
        role="slider" aria-label={`number line from ${min} to ${max}`} aria-valuemin={min} aria-valuemax={max}
        aria-valuenow={value ?? undefined} tabIndex={editable ? 0 : -1}
        onKeyDown={(e) => {
          if (!editable || value === null) return;
          if (e.key === "ArrowRight" || e.key === "ArrowUp") { e.preventDefault(); setValue(value + snap); }
          if (e.key === "ArrowLeft" || e.key === "ArrowDown") { e.preventDefault(); setValue(value - snap); }
        }}
        onPointerDown={(e) => {
          if (!editable || jumps) return;
          dragging.current = true;
          (e.target as Element).setPointerCapture?.(e.pointerId);
          const v = fromEvent(e);
          if (v !== null) setValue(v);
        }}
        onPointerMove={(e) => {
          if (!dragging.current) return;
          const v = fromEvent(e);
          if (v !== null) setValue(v);
        }}
        onPointerUp={() => (dragging.current = false)}>
        {/* shaded regions */}
        {highlight === "positive" || highlight === "negative" ? (
          vertical ? (
            <rect x={W / 2 - 14} width={28} rx={6}
              y={highlight === "positive" ? pad : p0.y} height={highlight === "positive" ? p0.y - pad : H - pad - p0.y}
              fill={highlight === "positive" ? "var(--good-soft)" : "var(--info-soft)"} />
          ) : (
            <rect y={H * 0.5 - 14} height={28} rx={6}
              x={highlight === "positive" ? p0.x : pad} width={highlight === "positive" ? W - pad - p0.x : p0.x - pad}
              fill={highlight === "positive" ? "var(--good-soft)" : "var(--info-soft)"} />
          )
        ) : null}
        {theme === "temperature" && vertical && pv ? (
          <rect x={W / 2 - 6} y={pv.y} width={12} height={H - pad - pv.y + 4} rx={6} fill={value! < 0 ? "#3b82f6" : "#ef4444"} opacity={0.75} />
        ) : null}
        {theme === "sea-level" && vertical ? (
          <rect x={8} y={p0.y} width={W - 16} height={H - pad - p0.y + 8} fill="#0ea5e9" opacity={0.15} />
        ) : null}
        {/* axis */}
        {vertical ? (
          <line x1={W / 2} y1={pad - 10} x2={W / 2} y2={H - pad + 10} stroke="var(--ink-2)" strokeWidth={2} />
        ) : (
          <line x1={pad - 10} y1={H * 0.5} x2={W - pad + 10} y2={H * 0.5} stroke="var(--ink-2)" strokeWidth={2} />
        )}
        {ticks.map((v) => {
          const p = pos(v);
          const big = isLabelled(v);
          return (
            <g key={v}>
              {vertical ? (
                <line x1={W / 2 - (big ? 8 : 4)} x2={W / 2 + (big ? 8 : 4)} y1={p.y} y2={p.y} stroke="var(--ink-2)" />
              ) : (
                <line x1={p.x} x2={p.x} y1={p.y - (big ? 8 : 4)} y2={p.y + (big ? 8 : 4)} stroke="var(--ink-2)" />
              )}
              {big ? (
                <text x={vertical ? W / 2 - 16 : p.x} y={vertical ? p.y + 4 : p.y + 26} textAnchor={vertical ? "end" : "middle"}
                  fontSize={compact ? 10 : 12} fill={v === 0 ? "var(--ink)" : "var(--ink-2)"} fontWeight={v === 0 ? 700 : 400}>
                  {label(v)}{vertical && unit ? unit.trim() : ""}
                </text>
              ) : null}
            </g>
          );
        })}
        {highlight && highlight !== "positive" && highlight !== "negative"
          ? intTicks.filter(hl).map((v) => {
              const p = pos(v);
              return <circle key={`h${v}`} cx={p.x} cy={p.y} r={4.5} fill="var(--accent)" opacity={0.6} />;
            })
          : null}
        {theme === "sea-level" && vertical ? <text x={W - 12} y={p0.y - 4} textAnchor="end" fontSize={11} fill="#0369a1">sea level</text> : null}
        {/* jumps */}
        {jumps
          ? Array.from({ length: jumps.count }, (_, i) => {
              const a = pos(jumps.start + i * jumps.size);
              const b = pos(jumps.start + (i + 1) * jumps.size);
              return vertical ? null : (
                <path key={i} d={`M${a.x},${a.y - 6} Q${(a.x + b.x) / 2},${a.y - 34} ${b.x},${b.y - 6}`} fill="none" stroke="var(--good)" strokeWidth={2} />
              );
            })
          : null}
        {/* distance from zero */}
        {showDistance && pv && value !== null && !vertical ? (
          <line x1={p0.x} x2={pv.x} y1={H * 0.5 + 34} y2={H * 0.5 + 34} stroke="var(--warn)" strokeWidth={3} />
        ) : null}
        {/* labelled comparison points */}
        {points?.map((pt, i) => {
          const p = pos(pt.value);
          return (
            <g key={i}>
              <circle cx={p.x} cy={p.y} r={7} fill={i ? "var(--warn)" : "var(--info)"} />
              <text x={p.x} y={p.y - 14} textAnchor="middle" fontSize={12} fontWeight={700} fill="var(--ink)">{pt.label}</text>
            </g>
          );
        })}
        {/* the movable point */}
        {pv && value !== null ? (
          <g>
            <circle cx={pv.x} cy={pv.y} r={editable ? 10 : 8} fill="var(--accent)" stroke="var(--surface)" strokeWidth={3}
              style={{ cursor: editable && !jumps ? "grab" : "default" }} />
            <text x={vertical ? pv.x + 18 : pv.x} y={vertical ? pv.y + 5 : pv.y - 16} textAnchor={vertical ? "start" : "middle"}
              fontSize={compact ? 12 : 14} fontWeight={700} fill="var(--accent)">
              {label(value)}{unit}
            </text>
          </g>
        ) : null}
      </svg>
      {!compact ? (
        <>
          {jumps && editable ? (
            <Controls>
              <SmallButton onClick={() => {
                const next = { ...jumps, count: jumps.count + 1 };
                const v = next.start + next.size * next.count;
                if (v > max + 1e-9) return;
                setJumps(next);
                setValue(v);
              }}>Jump {jumps.size >= 0 ? "+" : ""}{fmt(jumps.size)}</SmallButton>
              <SmallButton disabled={jumps.count === 0} onClick={() => {
                const next = { ...jumps, count: jumps.count - 1 };
                setJumps(next);
                setValue(next.start + next.size * next.count);
              }}>Undo jump</SmallButton>
            </Controls>
          ) : editable && value !== null ? (
            <Controls>
              <SmallButton onClick={() => setValue(value - snap)}>{vertical ? "Down" : "Left"} {fmt(snap)}</SmallButton>
              <SmallButton onClick={() => setValue(value + snap)}>{vertical ? "Up" : "Right"} {fmt(snap)}</SmallButton>
              <span className="text-xs text-ink-3">Drag the point, or use the arrow keys.</span>
            </Controls>
          ) : null}
          {value !== null ? (
            <Note>
              The point is at <strong>{label(value)}{unit}</strong>
              {value > 0 ? " - to the right of zero (positive)" : value < 0 ? " - to the left of zero (negative)" : " - exactly at zero"}
              {jumps ? `, after ${jumps.count} ${jumps.count === 1 ? "jump" : "jumps"} of ${fmt(jumps.size)}` : ""}
              {showDistance ? `. It is ${fmt(Math.abs(value))} ${Math.abs(value) === 1 ? "step" : "steps"} from zero.` : "."}
            </Note>
          ) : points ? (
            <Note>
              {points.length === 2
                ? `${points[0].label} is at ${fmt(points[0].value)} and ${points[1].label} is at ${fmt(points[1].value)}: the one further right is bigger.`
                : "Numbers further to the right are bigger."}
            </Note>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
