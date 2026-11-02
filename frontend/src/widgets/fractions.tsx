"use client";

import { useState } from "react";
import { Tex } from "@/components/Tex";
import { frac, fracCmp, fracEq, fracTex, gcd, parseFrac } from "@/lib/numbers";
import { bool, clamp, Controls, Note, num, SmallButton, Stepper, str, useGoal, type WidgetProps } from "./common";

// ================================================================== fraction pizza / bar

function Pie({ n, d, cx, cy, r }: { n: number; d: number; cx: number; cy: number; r: number }) {
  if (d === 1) return <circle cx={cx} cy={cy} r={r} fill={n ? "var(--accent)" : "var(--surface-2)"} stroke="var(--ink-2)" strokeWidth={2} />;
  return (
    <g>
      {Array.from({ length: d }, (_, i) => {
        const a0 = (i / d) * Math.PI * 2 - Math.PI / 2;
        const a1 = ((i + 1) / d) * Math.PI * 2 - Math.PI / 2;
        const large = a1 - a0 > Math.PI ? 1 : 0;
        const path = `M${cx},${cy} L${cx + r * Math.cos(a0)},${cy + r * Math.sin(a0)} A${r},${r} 0 ${large} 1 ${cx + r * Math.cos(a1)},${cy + r * Math.sin(a1)} Z`;
        return <path key={i} d={path} fill={i < n ? "var(--accent)" : "var(--surface-2)"} stroke="var(--ink-2)" strokeWidth={1.5} />;
      })}
    </g>
  );
}

function Bar({ n, d, x, y, w, h, tone = "var(--accent)" }: { n: number; d: number; x: number; y: number; w: number; h: number; tone?: string }) {
  return (
    <g>
      {Array.from({ length: d }, (_, i) => (
        <rect key={i} x={x + (i * w) / d} y={y} width={w / d} height={h} fill={i < n ? tone : "var(--surface-2)"} stroke="var(--ink-2)" strokeWidth={1.2} />
      ))}
    </g>
  );
}

export function FractionWidget({ props, goal, onComplete, compact }: WidgetProps) {
  const maxD = num(props, "maxDenominator", 12);
  const [d, setD] = useState(clamp(num(props, "denominator", 4), 1, Math.max(maxD, num(props, "denominator", 4))));
  const [n, setN] = useState(num(props, "numerator", 1));
  const [initial] = useState([n, d]);
  const shape = str(props, "shape", "circle");
  const editable = bool(props, "editable");
  const showDecimal = bool(props, "showDecimal");
  const showPercent = bool(props, "showPercent");
  const cmp = Array.isArray(props.compare) ? (props.compare as number[]) : null;
  const wholes = Math.max(1, Math.ceil(n / d), num(props, "wholes", 1));

  const gv = typeof goal?.value === "string" ? parseFrac(goal.value) : null;
  const met =
    (gv === null || (d > 0 && fracEq(frac(n, d), gv))) &&
    (goal?.numerator === undefined || n === goal.numerator) &&
    (goal?.denominator === undefined || d === goal.denominator) &&
    (n !== initial[0] || d !== initial[1]);
  useGoal(!!goal && met, onComplete, { numerator: n, denominator: d });

  const W = compact ? 300 : 560;
  const H = shape === "circle" ? (compact ? 120 : 170) : cmp ? (compact ? 96 : 130) : compact ? 60 : 80;
  const value = frac(n, d);
  const dec = n / d;
  const g = gcd(n, d);

  let compareNote: string | null = null;
  if (cmp) {
    const other = frac(cmp[0], cmp[1]);
    const c = fracCmp(value, other);
    compareNote = c === 0 ? "The shaded lengths line up exactly - the two fractions are equal." : `The top shaded length is ${c > 0 ? "longer" : "shorter"}, so ${n}/${d} is ${c > 0 ? "bigger" : "smaller"} than ${cmp[0]}/${cmp[1]}.`;
  }

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-lg bg-surface" role="img" aria-label={`${n} out of ${d} equal parts shaded`}>
        {shape === "circle"
          ? Array.from({ length: wholes }, (_, k) => {
              const r = H / 2 - 8;
              const shaded = clamp(n - k * d, 0, d);
              return <Pie key={k} n={shaded} d={d} cx={r + 12 + k * (2 * r + 16)} cy={H / 2} r={r} />;
            })
          : Array.from({ length: wholes }, (_, k) => {
              const w = (W - 20 - (wholes - 1) * 10) / wholes;
              const shaded = clamp(n - k * d, 0, d);
              return <Bar key={k} n={shaded} d={d} x={10 + k * (w + 10)} y={8} w={w} h={cmp ? H / 2 - 14 : H - 16} />;
            })}
        {cmp && shape !== "circle" ? <Bar n={cmp[0]} d={cmp[1]} x={10} y={H / 2 + 4} w={(W - 20 - (wholes - 1) * 10) / wholes} h={H / 2 - 14} tone="var(--warn)" /> : null}
      </svg>
      {!compact ? (
        <>
          <Controls>
            {editable ? (
              <>
                <Stepper label="Shaded parts (numerator)" value={n} min={0} max={d * 3} onChange={setN} />
                <Stepper label="Equal parts (denominator)" value={d} min={1} max={maxD} onChange={(v) => { setD(v); setN(Math.min(n, v * 3)); }} />
              </>
            ) : null}
          </Controls>
          <Note tone={goal && met ? "good" : "neutral"}>
            <span className="mr-2 text-xl"><Tex tex={`\\frac{${n}}{${d}}`} /></span>
            {n} of the {d} equal parts {n === 1 ? "is" : "are"} shaded
            {g > 1 && n ? <> - the same amount as <Tex tex={fracTex(value)} /></> : null}
            {showDecimal ? <> = {Number.isInteger(dec * 1000) ? dec : dec.toFixed(3)}</> : null}
            {showPercent ? <> = {Math.round(dec * 1000) / 10}%</> : null}
            {n > d ? " - more than one whole." : n === d ? " - exactly one whole." : "."}
          </Note>
          {compareNote ? <Note>{compareNote}</Note> : null}
        </>
      ) : null}
    </div>
  );
}

// ================================================================== hundred grid

export function HundredGrid({ props, goal, onComplete, compact }: WidgetProps) {
  const [shaded, setShaded] = useState(clamp(num(props, "shaded", 25), 0, 100));
  const [initial] = useState(shaded);
  const mode = str(props, "mode", "decimal");
  const editable = bool(props, "editable");
  useGoal(goal?.shaded !== undefined && shaded === goal.shaded && shaded !== initial, onComplete, { shaded });
  const size = compact ? 150 : 250;
  const c = size / 10;
  const dec = (shaded / 100).toFixed(2).replace(/0$/, "").replace(/\.$/, "");
  const f = frac(shaded, 100);
  return (
    <div className="flex flex-wrap items-start gap-4">
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className="rounded bg-surface" role="img"
        aria-label={`${shaded} of 100 squares shaded`}>
        {Array.from({ length: 100 }, (_, i) => (
          <rect key={i} x={(i % 10) * c} y={Math.floor(i / 10) * c} width={c - 1} height={c - 1}
            fill={i < shaded ? "var(--accent)" : "var(--surface-2)"} style={{ cursor: editable ? "pointer" : "default" }}
            onClick={() => editable && setShaded(i + 1 === shaded ? i : i + 1)} />
        ))}
      </svg>
      {!compact ? (
        <div className="min-w-[200px] flex-1">
          <div className="space-y-1 text-lg">
            <p className={mode === "fraction" ? "font-bold" : ""}><Tex tex={`\\frac{${shaded}}{100}${f.d !== 100 && shaded ? ` = ${fracTex(f)}` : ""}`} /></p>
            <p className={mode === "decimal" ? "font-bold" : ""}>{dec === "" ? "0" : dec} <span className="text-sm text-ink-3">(decimal)</span></p>
            <p className={mode === "percent" ? "font-bold" : ""}>{shaded}% <span className="text-sm text-ink-3">(percent: out of 100)</span></p>
          </div>
          {editable ? (
            <Controls>
              <Stepper label="Squares" value={shaded} min={0} max={100} onChange={setShaded} />
              <SmallButton onClick={() => setShaded(clamp(shaded + 10, 0, 100))}>+ a row (0.1)</SmallButton>
              <SmallButton onClick={() => setShaded(clamp(shaded - 10, 0, 100))}>- a row</SmallButton>
            </Controls>
          ) : null}
          <Note>
            Each small square is one hundredth (0.01, or 1%). Each full row of ten is one tenth (0.1, or 10%). {Math.floor(shaded / 10)} full{" "}
            {Math.floor(shaded / 10) === 1 ? "row" : "rows"} and {shaded % 10} more {shaded % 10 === 1 ? "square" : "squares"}.
          </Note>
        </div>
      ) : null}
    </div>
  );
}

// ================================================================== ratio mixer

export function RatioMixer({ props, goal, onComplete, compact }: WidgetProps) {
  const a = num(props, "a", 2);
  const b = num(props, "b", 3);
  const la = str(props, "labelA", "first");
  const lb = str(props, "labelB", "second");
  const [scale, setScale] = useState(num(props, "scale", 1));
  const [extra, setExtra] = useState(0);
  const editable = bool(props, "editable");
  const A = a * scale + extra;
  const B = b * scale + extra;
  const g = gcd(A, B) || 1;
  const same = A * b === B * a;
  useGoal(goal?.a !== undefined && A === goal.a && B === goal.b && same, onComplete, { a: A, b: B });
  const W = compact ? 300 : 560;
  const bw = Math.min(compact ? 64 : 92, (W - 20) / Math.max(scale, 1) - 8);
  const s = Math.min(14, bw / Math.max(a, b, 1) - 2);
  const H = compact ? 70 : 100;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-lg bg-surface" role="img" aria-label={`${A} ${la} and ${B} ${lb}`}>
        {Array.from({ length: scale }, (_, k) => (
          <g key={k}>
            <rect x={8 + k * (bw + 8)} y={6} width={bw} height={H - 12} rx={8} fill="none" stroke="var(--line)" strokeWidth={2} />
            {Array.from({ length: a }, (_, i) => (
              <rect key={i} x={14 + k * (bw + 8) + i * (s + 2)} y={14} width={s} height={s} rx={2} fill="var(--accent)" />
            ))}
            {Array.from({ length: b }, (_, i) => (
              <circle key={i} cx={14 + s / 2 + k * (bw + 8) + i * (s + 2)} cy={H - 20} r={s / 2} fill="var(--warn)" />
            ))}
          </g>
        ))}
      </svg>
      {!compact ? (
        <>
          <Controls>
            {editable ? <Stepper label="Batches" value={scale} min={1} max={8} onChange={setScale} /> : null}
            {editable ? (
              <SmallButton onClick={() => setExtra(extra ? 0 : 1)} active={extra > 0}>
                {extra ? "Remove the extra one of each" : "Try adding one of each instead"}
              </SmallButton>
            ) : null}
          </Controls>
          <Note tone={same ? "neutral" : "warn"}>
            <span className="text-accent font-semibold">{A} {la}</span> : <span className="text-warn font-semibold">{B} {lb}</span>
            {g > 1 ? <> - which simplifies to {A / g} : {B / g}</> : null}.{" "}
            {same ? `Still the ratio ${a} : ${b} - every batch has the same mix.` : `Adding one of each gives ${A} : ${B}, which is NOT the ratio ${a} : ${b}. The mix has changed.`}
          </Note>
        </>
      ) : null}
    </div>
  );
}
