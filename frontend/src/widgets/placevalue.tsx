"use client";

import { useState } from "react";
import { toRoman, toWords } from "@/lib/numbers";
import { bool, clamp, Controls, Note, num, SmallButton, Stepper, useGoal, type WidgetProps } from "./common";

// ================================================================== place-value blocks

const PLACES = [
  { name: "thousands", one: "thousand", value: 1000 },
  { name: "hundreds", one: "hundred", value: 100 },
  { name: "tens", one: "ten", value: 10 },
  { name: "ones", one: "one", value: 1 },
];
const DEC = [
  { name: "tenths", one: "tenth", value: 0.1 },
  { name: "hundredths", one: "hundredth", value: 0.01 },
];

function Blocks({ place, count, x, y, w }: { place: string; count: number; x: number; y: number; w: number }) {
  const items = [];
  for (let i = 0; i < count; i++) {
    if (place === "thousands") items.push(<rect key={i} x={x + 4 + (i % 3) * 22} y={y + Math.floor(i / 3) * 22} width={18} height={18} fill="var(--warn)" stroke="var(--ink-2)" />);
    else if (place === "hundreds") items.push(<rect key={i} x={x + 4 + (i % 3) * 20} y={y + Math.floor(i / 3) * 20} width={17} height={17} fill="var(--accent)" opacity={0.85} stroke="var(--ink-2)" />);
    else if (place === "tens") items.push(<rect key={i} x={x + 4 + i * 8} y={y} width={6} height={50} fill="var(--good)" opacity={0.85} />);
    else items.push(<rect key={i} x={x + 4 + (i % 5) * 11} y={y + Math.floor(i / 5) * 11} width={8} height={8} fill="var(--info)" />);
  }
  return <g>{items}<rect x={x} y={y - 6} width={w - 6} height={80} fill="none" /></g>;
}

export function PlaceValue({ props, goal, onComplete, compact }: WidgetProps) {
  const decimals = clamp(num(props, "decimals", 0), 0, 2);
  const scale = 10 ** decimals;
  const max = num(props, "max", 9999);
  const [units, setUnits] = useState(Math.round(num(props, "value", 0) * scale)); // value in smallest units
  const [initial] = useState(units);
  const [msg, setMsg] = useState<string | null>(null);
  const editable = bool(props, "editable");
  const showExpanded = props.showExpanded === undefined ? true : bool(props, "showExpanded");
  const value = units / scale;
  useGoal(goal?.value !== undefined && Math.abs(value - Number(goal.value)) < 1e-9 && units !== initial, onComplete, { value });

  const whole = Math.floor(units / scale);
  // Static pictures show only the places the number needs; editable ones show up to the maximum.
  const topValue = editable ? 10 ** (String(Math.floor(max)).length - 1) : 10 ** Math.max(0, String(whole).length - 1);
  const shown = [...PLACES.filter((p) => p.value <= topValue), ...DEC.slice(0, decimals)];
  const digitOf = (pv: number) => Math.floor(Math.round((units / scale / pv) * 1e6) / 1e6) % 10;

  const change = (pv: number, delta: number) => {
    const step = Math.round(pv * scale);
    const next = units + delta * step;
    if (next < 0 || next / scale > max) return;
    const before = digitOf(pv);
    setUnits(next);
    const after = Math.floor(Math.round((next / scale / pv) * 1e6) / 1e6) % 10;
    if (delta > 0 && before === 9 && after === 0) {
      const p = [...PLACES, ...DEC].find((q) => q.value === pv)!;
      const up = [...PLACES, ...DEC].find((q) => Math.abs(q.value - pv * 10) < 1e-9);
      setMsg(`Ten ${p.name} make one ${up?.one ?? "more"} - so they were regrouped into the next place.`);
    } else if (delta < 0 && before === 0) {
      setMsg("There were none in this place, so one block from the place to the left was broken into ten.");
    } else setMsg(null);
  };

  const colW = compact ? 70 : 110;
  const W = colW * shown.length + 10;
  const parts = shown.map((p) => ({ ...p, digit: digitOf(p.value) }));
  const text = whole.toString() + (decimals ? "." + String(units % scale).padStart(decimals, "0") : "");
  return (
    <div>
      <svg viewBox={`0 0 ${W} 130`} className="w-full max-w-[560px] rounded-lg bg-surface" role="img" aria-label={`the number ${text} in place-value blocks`}>
        {parts.map((p, i) => (
          <g key={p.name}>
            <text x={10 + i * colW + colW / 2} y={14} textAnchor="middle" fontSize={11} fill="var(--ink-3)">{p.name}</text>
            {p.value >= 1 ? <Blocks place={p.name} count={p.digit} x={10 + i * colW} y={26} w={colW} /> : (
              Array.from({ length: p.digit }, (_, k) => (
                <rect key={k} x={14 + i * colW + (k % 5) * 12} y={30 + Math.floor(k / 5) * 12} width={p.name === "tenths" ? 9 : 5} height={9} fill="var(--bad)" opacity={0.7} />
              ))
            )}
            <text x={10 + i * colW + colW / 2} y={124} textAnchor="middle" fontSize={22} fontWeight={700} fill="var(--ink)">{p.digit}</text>
            {p.name === "tenths" ? <text x={10 + i * colW - 4} y={124} fontSize={22} fontWeight={700} fill="var(--ink)">.</text> : null}
          </g>
        ))}
      </svg>
      {!compact ? (
        <>
          {editable ? (
            <Controls>
              {parts.map((p) => (
                <div key={p.name} className="flex items-center gap-1 text-sm">
                  <span className="text-ink-2">{p.name}</span>
                  <SmallButton onClick={() => change(p.value, -1)}>-</SmallButton>
                  <SmallButton onClick={() => change(p.value, 1)}>+</SmallButton>
                </div>
              ))}
            </Controls>
          ) : null}
          {showExpanded ? (
            <Note>
              <strong>{text}</strong> = {parts.map((p) => `${p.digit} ${p.digit === 1 ? p.one : p.name}`).join(" + ")}
              {decimals === 0 && whole <= 999_999 ? ` (${toWords(whole)})` : ""}
            </Note>
          ) : null}
          {msg ? <Note tone="good">{msg}</Note> : null}
        </>
      ) : null}
    </div>
  );
}

// ================================================================== numeral systems

const SYSTEMS = ["dots", "tally", "roman", "digits", "words"] as const;

function Tally({ n }: { n: number }) {
  const groups = Math.floor(n / 5);
  const rest = n % 5;
  const out = [];
  let x = 0;
  for (let g = 0; g < groups; g++) {
    out.push(
      <g key={`g${g}`}>
        {[0, 1, 2, 3].map((k) => <line key={k} x1={x + k * 7} x2={x + k * 7} y1={4} y2={30} stroke="var(--ink)" strokeWidth={2.2} />)}
        <line x1={x - 4} x2={x + 25} y1={26} y2={8} stroke="var(--ink)" strokeWidth={2.2} />
      </g>,
    );
    x += 40;
  }
  for (let k = 0; k < rest; k++) out.push(<line key={`r${k}`} x1={x + k * 7} x2={x + k * 7} y1={4} y2={30} stroke="var(--ink)" strokeWidth={2.2} />);
  return <svg viewBox={`-6 0 ${Math.max(x + rest * 7 + 10, 20)} 34`} height={34} role="img" aria-label={`${n} tally marks`}>{out}</svg>;
}

export function NumeralSystems({ props, goal, onComplete, compact }: WidgetProps) {
  const [value, setValue] = useState(clamp(num(props, "value", 7), 0, 3999));
  const [initial] = useState(value);
  const editable = bool(props, "editable");
  const systems = (Array.isArray(props.systems) ? (props.systems as string[]) : [...SYSTEMS]).filter((s) => (SYSTEMS as readonly string[]).includes(s));
  useGoal(goal?.value !== undefined && value === goal.value && value !== initial, onComplete, { value });
  const roman = toRoman(value);
  const rows: { name: string; node: React.ReactNode }[] = [];
  for (const s of systems) {
    if (s === "dots" && value <= 40)
      rows.push({
        name: "Dots (the quantity itself)",
        node: (
          <svg viewBox={`0 0 ${Math.min(value, 10) * 16 + 4} ${Math.ceil(value / 10) * 16 + 4}`} height={Math.ceil(value / 10) * 16 + 4} role="img" aria-label={`${value} dots`}>
            {Array.from({ length: value }, (_, i) => <circle key={i} cx={10 + (i % 10) * 16} cy={10 + Math.floor(i / 10) * 16} r={5.5} fill="var(--accent)" />)}
          </svg>
        ),
      });
    if (s === "tally" && value <= 60) rows.push({ name: "Tally marks", node: value ? <Tally n={value} /> : <span className="text-ink-3">(no marks at all)</span> });
    if (s === "roman") rows.push({ name: "Roman numerals", node: <span className="font-serif text-2xl tracking-wider">{roman ?? "(the Romans had no numeral for zero)"}</span> });
    if (s === "digits") rows.push({ name: "Our digits (Hindu-Arabic numerals)", node: <span className="text-3xl font-bold tabular-nums">{value}</span> });
    if (s === "words") rows.push({ name: "English words", node: <span className="text-xl">{toWords(value)}</span> });
  }
  return (
    <div>
      <dl className={`grid gap-2 ${compact ? "text-sm" : ""}`}>
        {rows.map((r) => (
          <div key={r.name} className="flex flex-wrap items-center gap-3 rounded-lg bg-surface px-3 py-2">
            <dt className="w-44 shrink-0 text-xs font-semibold tracking-wide text-ink-3 uppercase">{r.name}</dt>
            <dd className="min-h-[34px] flex-1">{r.node}</dd>
          </div>
        ))}
      </dl>
      {!compact ? (
        <>
          {editable ? <Controls><Stepper label="Quantity" value={value} min={0} max={100} onChange={setValue} /></Controls> : null}
          <Note>Every row names the same number. The number is the idea; each row is just a different way to write it down.</Note>
        </>
      ) : null}
    </div>
  );
}
