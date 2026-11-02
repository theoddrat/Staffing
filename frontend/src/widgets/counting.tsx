"use client";

import { useMemo, useState } from "react";
import { Tex } from "@/components/Tex";
import { toWords } from "@/lib/numbers";
import { bool, clamp, Controls, Glyph, Note, num, seeded, SmallButton, Stepper, str, useGoal, type WidgetProps } from "./common";

// ================================================================== counting objects

type Layout = "scatter" | "bunch" | "row";

function positions(n: number, layout: Layout, seed: number, w: number, h: number, r: number) {
  const rnd = seeded(seed);
  if (layout === "row") {
    const per = Math.max(1, Math.floor((w - r) / (r * 2.4)));
    return Array.from({ length: n }, (_, i) => ({ x: r * 1.4 + (i % per) * r * 2.4, y: r * 1.6 + Math.floor(i / per) * r * 2.6 }));
  }
  const cols = Math.ceil(Math.sqrt(n * (w / h))) || 1;
  const cw = layout === "bunch" ? r * 2.3 : (w - r * 2) / cols;
  const rows = Math.ceil(n / cols) || 1;
  const ch = layout === "bunch" ? r * 2.3 : (h - r * 2) / rows;
  const ox = layout === "bunch" ? (w - cw * cols) / 2 : r;
  const oy = layout === "bunch" ? (h - ch * rows) / 2 : r;
  return Array.from({ length: n }, (_, i) => {
    const jx = layout === "bunch" ? 0 : (rnd() - 0.5) * Math.max(0, cw - r * 2.2);
    const jy = layout === "bunch" ? 0 : (rnd() - 0.5) * Math.max(0, ch - r * 2.2);
    return { x: ox + (i % cols) * cw + cw / 2 + jx, y: oy + Math.floor(i / cols) * ch + ch / 2 + jy };
  });
}

export function CountingObjects({ props, goal, onComplete, compact }: WidgetProps) {
  const max = num(props, "max", 40);
  const [n, setN] = useState(clamp(num(props, "count", 5), 0, max));
  const object = str(props, "object", "apple");
  const tagging = bool(props, "tagging");
  const editable = bool(props, "editable");
  const rearrange = bool(props, "rearrange");
  const bundleMode = bool(props, "bundle");
  const [layout, setLayout] = useState<Layout>("scatter");
  const [seed, setSeed] = useState(7);
  const [tags, setTags] = useState<number[]>([]); // object indexes in tapping order
  const [bundled, setBundled] = useState(false);

  const W = compact ? 300 : 560;
  const H = compact ? 140 : 230;
  const r = n > 30 ? 9 : compact ? 11 : 15;
  const pos = useMemo(() => positions(n, layout, seed, W, H, r), [n, layout, seed, W, H, r]);
  const allTagged = tagging && n > 0 && tags.length === n;

  useGoal(
    (goal?.count !== undefined && n === goal.count && (!tagging || allTagged)) || (goal?.tagAll === true && allTagged),
    onComplete,
    { count: n },
  );

  const tap = (i: number) => {
    if (!tagging || tags.includes(i)) return;
    setTags([...tags, i]);
  };
  const changeN = (v: number) => {
    setN(v);
    setTags([]);
  };

  const tens = Math.floor(n / 10);
  const ones = n % 10;

  return (
    <div>
      {bundled && bundleMode ? (
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-lg bg-surface" role="img"
          aria-label={`${tens} bundles of ten and ${ones} loose objects`}>
          {Array.from({ length: tens }, (_, b) => {
            const bx = 10 + (b % 4) * (W / 4.2);
            const by = 10 + Math.floor(b / 4) * 64;
            return (
              <g key={b}>
                <rect x={bx} y={by} width={W / 4.6} height={56} rx={8} fill="none" stroke="var(--accent)" strokeWidth={2} />
                {Array.from({ length: 10 }, (_, k) => (
                  <Glyph key={k} kind={object} x={bx + 12 + (k % 5) * (W / 4.6 - 20) / 4.5} y={by + 16 + Math.floor(k / 5) * 24} r={8} />
                ))}
              </g>
            );
          })}
          {Array.from({ length: ones }, (_, k) => (
            <Glyph key={`o${k}`} kind={object} x={20 + k * 26} y={H - 22} r={10} />
          ))}
        </svg>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-lg bg-surface" role="img"
          aria-label={tagging ? `${n} objects to count by tapping` : `${n} objects`}>
          {pos.map((p, i) => {
            const t = tags.indexOf(i);
            return (
              <g key={i} onClick={() => tap(i)} style={{ cursor: tagging && t < 0 ? "pointer" : "default" }}
                role={tagging ? "button" : undefined} aria-label={tagging ? (t < 0 ? "count this object" : `object number ${t + 1}`) : undefined}
                tabIndex={tagging && t < 0 ? 0 : undefined} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && tap(i)}>
                <Glyph kind={object} x={p.x} y={p.y} r={r} muted={tagging && t >= 0} />
                {t >= 0 ? (
                  <text x={p.x} y={p.y + r * 0.4} textAnchor="middle" fontSize={r * 1.15} fontWeight={700} fill="var(--ink)">{t + 1}</text>
                ) : null}
              </g>
            );
          })}
        </svg>
      )}
      {!compact ? (
        <>
          <Controls>
            {editable ? <Stepper label="Objects" value={n} min={0} max={max} onChange={changeN} /> : null}
            {rearrange ? (
              <>
                <SmallButton onClick={() => { setLayout("scatter"); setSeed(seed + 1); }}>Shuffle</SmallButton>
                <SmallButton onClick={() => setLayout("scatter")} active={layout === "scatter"}>Spread out</SmallButton>
                <SmallButton onClick={() => setLayout("bunch")} active={layout === "bunch"}>Bunch up</SmallButton>
                <SmallButton onClick={() => setLayout("row")} active={layout === "row"}>In a row</SmallButton>
              </>
            ) : null}
            {bundleMode ? <SmallButton onClick={() => setBundled(!bundled)} active={bundled}>{bundled ? "Unbundle" : "Bundle tens"}</SmallButton> : null}
            {tagging && tags.length ? <SmallButton onClick={() => setTags([])}>Start again</SmallButton> : null}
          </Controls>
          {tagging ? (
            <Note tone={allTagged ? "good" : "neutral"}>
              {allTagged
                ? `Every object has exactly one number. The last number you said was ${n}, so there are ${n} (${toWords(n)}).`
                : tags.length
                  ? `You have counted ${tags.length} so far. Keep tapping the objects without a number.`
                  : "Tap each object once. Each tap says the next counting number."}
            </Note>
          ) : bundleMode && bundled ? (
            <Note>{tens} {tens === 1 ? "ten" : "tens"} and {ones} {ones === 1 ? "one" : "ones"} = {n}</Note>
          ) : (
            <Note>There {n === 1 ? "is" : "are"} {n} {n === 1 ? "object" : "objects"} on the tray, however they are arranged.</Note>
          )}
        </>
      ) : null}
    </div>
  );
}

// ================================================================== shepherd

export function Shepherd({ props, onComplete, compact }: WidgetProps) {
  const total = num(props, "sheep", 6);
  const missing = clamp(num(props, "missing", 0), 0, total);
  const [phase, setPhase] = useState<"morning" | "evening" | "done">("morning");
  const [out, setOut] = useState(0);
  const [back, setBack] = useState(0);
  const pebbles = out - back;
  const inPen = total - out + back;
  useGoal(phase === "done", onComplete, { missing });

  const W = compact ? 300 : 560;
  const H = compact ? 130 : 190;
  const penW = W * 0.42;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-lg" style={{ background: "color-mix(in srgb, #16a34a 12%, var(--surface))" }}
        role="img" aria-label={`${inPen} sheep in the pen, ${pebbles} pebbles in the bag`}>
        <rect x={8} y={18} width={penW} height={H - 36} rx={6} fill="none" stroke="#92400e" strokeWidth={3} strokeDasharray="10 4" />
        <text x={14} y={14} fontSize={11} fill="var(--ink-2)">Pen</text>
        {Array.from({ length: inPen }, (_, i) => (
          <Glyph key={`p${i}`} kind="sheep" x={36 + (i % 4) * (penW / 4.3)} y={44 + Math.floor(i / 4) * 34} r={compact ? 10 : 13} />
        ))}
        {Array.from({ length: total - inPen }, (_, i) => (
          <Glyph key={`f${i}`} kind="sheep" x={penW + 50 + (i % 5) * 30} y={40 + Math.floor(i / 5) * 32} r={compact ? 10 : 12} />
        ))}
        <text x={penW + 30} y={14} fontSize={11} fill="var(--ink-2)">Field</text>
        <path d={`M${W - 120},${H - 70} q50,-20 100,0 l-6,58 q-44,10 -88,0 z`} fill="#a16207" opacity={0.85} />
        <text x={W - 70} y={H - 76} textAnchor="middle" fontSize={11} fill="var(--ink-2)">Bag of pebbles</text>
        {Array.from({ length: pebbles }, (_, i) => (
          <circle key={i} cx={W - 102 + (i % 6) * 14} cy={H - 50 + Math.floor(i / 6) * 13} r={5} fill="#e7e5e4" stroke="#57534e" />
        ))}
      </svg>
      {!compact ? (
        <>
          <Controls>
            {phase === "morning" ? (
              <>
                <SmallButton onClick={() => setOut(out + 1)} disabled={out >= total}>Morning: let a sheep out (+1 pebble)</SmallButton>
                {out >= total ? <SmallButton onClick={() => setPhase("evening")} active>It is evening now</SmallButton> : null}
              </>
            ) : phase === "evening" ? (
              <>
                <SmallButton onClick={() => setBack(back + 1)} disabled={back >= total - missing}>A sheep comes home (-1 pebble)</SmallButton>
                {back >= total - missing ? <SmallButton onClick={() => setPhase("done")} active>No more sheep are coming</SmallButton> : null}
              </>
            ) : (
              <SmallButton onClick={() => { setPhase("morning"); setOut(0); setBack(0); }}>Start a new day</SmallButton>
            )}
          </Controls>
          <Note tone={phase === "done" ? (pebbles ? "warn" : "good") : "neutral"}>
            {phase === "morning" && "Each sheep that leaves the pen puts one pebble in the bag."}
            {phase === "evening" && "Each sheep that comes home takes one pebble out of the bag."}
            {phase === "done" &&
              (pebbles
                ? `${pebbles} ${pebbles === 1 ? "pebble is" : "pebbles are"} left, so ${pebbles} ${pebbles === 1 ? "sheep is" : "sheep are"} missing - and the shepherd never had to count the flock.`
                : "No pebbles are left - every sheep came home.")}
          </Note>
        </>
      ) : null}
    </div>
  );
}

// ================================================================== mathematical lenses

const LENSES = [
  { id: "quantity", label: "Quantity", text: (s: number, tot: number) => `How many? Step by step: ${Array.from({ length: s }, (_, i) => i + 1).join(", ")} blocks - ${tot} blocks altogether.` },
  { id: "pattern", label: "Pattern", text: () => "What comes next? Every step has exactly one more block than the step before it." },
  { id: "structure", label: "Shape", text: (s: number) => `How is it built? Two copies of the staircase fit together into a perfect rectangle ${s} blocks wide and ${s + 1} blocks tall.` },
  { id: "reasoning", label: "Reasoning", text: (s: number) => `What must be true? Without building it, we know step ${s + 3} will have ${s + 3} blocks - because each step adds exactly one.` },
];

export function MathLenses({ props, goal, onComplete, compact }: WidgetProps) {
  const [steps, setSteps] = useState(clamp(num(props, "steps", 4), 1, 10));
  const [lens, setLens] = useState<string | null>(compact ? "quantity" : null);
  const [seen, setSeen] = useState<Set<string>>(new Set());
  const total = (steps * (steps + 1)) / 2;
  useGoal(goal?.lensesViewed !== undefined && seen.size >= Number(goal.lensesViewed), onComplete, { steps });
  const W = compact ? 300 : 560;
  const cell = Math.min(compact ? 16 : 28, (W - 40) / (steps + 2), 150 / (steps + 0.5));
  const H = cell * (steps + 1) + 20;
  const pick = (id: string) => {
    setLens(id);
    setSeen(new Set([...seen, id]));
  };
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-lg bg-surface" role="img" aria-label={`a staircase of ${steps} steps`}>
        {Array.from({ length: steps }, (_, c) =>
          Array.from({ length: c + 1 }, (_, k) => (
            <rect key={`${c}-${k}`} x={20 + c * cell} y={H - 10 - (k + 1) * cell} width={cell - 2} height={cell - 2} rx={3}
              fill="var(--accent)" opacity={0.8} />
          )),
        )}
        {lens === "structure"
          ? Array.from({ length: steps }, (_, c) =>
              Array.from({ length: steps - c }, (_, k) => (
                <rect key={`m${c}-${k}`} x={20 + c * cell} y={H - 10 - (c + k + 2) * cell} width={cell - 2} height={cell - 2}
                  rx={3} fill="var(--warn)" opacity={0.35} />
              )),
            )
          : null}
        {lens === "quantity"
          ? Array.from({ length: steps }, (_, c) => (
              <text key={c} x={20 + c * cell + cell / 2} y={H - 14 - (c + 1) * cell} textAnchor="middle" fontSize={cell * 0.45} fill="var(--ink)">
                {c + 1}
              </text>
            ))
          : null}
        {lens === "pattern"
          ? Array.from({ length: steps - 1 }, (_, c) => (
              <text key={c} x={20 + (c + 1) * cell + cell / 2} y={H - 14 - (c + 2) * cell} textAnchor="middle" fontSize={cell * 0.42} fill="var(--good)">
                +1
              </text>
            ))
          : null}
      </svg>
      {!compact ? (
        <>
          <Controls>
            {LENSES.map((l) => (
              <SmallButton key={l.id} onClick={() => pick(l.id)} active={lens === l.id}>
                {seen.has(l.id) ? "✓ " : ""}{l.label} lens
              </SmallButton>
            ))}
            <Stepper label="Steps" value={steps} min={1} max={10} onChange={setSteps} />
          </Controls>
          <Note>{lens ? LENSES.find((l) => l.id === lens)!.text(steps, total) : "Choose a lens to look at the staircase in a mathematical way."}</Note>
        </>
      ) : null}
    </div>
  );
}

// ================================================================== compare groups

function relation(a: number, b: number) {
  return a < b ? "<" : a > b ? ">" : "=";
}

export function CompareGroups({ props, goal, onComplete, compact }: WidgetProps) {
  const [left, setLeft] = useState(num(props, "left", 5));
  const [right, setRight] = useState(num(props, "right", 3));
  const [initial] = useState([left, right]);
  const editable = bool(props, "editable");
  const showSymbol = bool(props, "showSymbol");
  const matching = props.matching === undefined ? true : bool(props, "matching");
  const obj = props.object;
  const [objL, objR] = Array.isArray(obj) ? [String(obj[0]), String(obj[1] ?? obj[0])] : [str(props, "object", "apple"), str(props, "object", "star")];
  const rel = relation(left, right);
  const changed = left !== initial[0] || right !== initial[1];
  useGoal(goal?.relation !== undefined && rel === goal.relation && changed, onComplete, { left, right });

  const W = compact ? 300 : 560;
  const maxN = Math.max(left, right, 1);
  const gap = Math.min(compact ? 26 : 40, (W - 40) / maxN);
  const H = compact ? 110 : 150;
  const r = Math.min(compact ? 10 : 14, gap * 0.4);
  const word = { "<": "is less than", ">": "is greater than", "=": "is equal to" }[rel];
  const diff = Math.abs(left - right);
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-lg bg-surface" role="img"
        aria-label={`top group ${left}, bottom group ${right}`}>
        {matching
          ? Array.from({ length: Math.min(left, right) }, (_, i) => (
              <line key={i} x1={24 + i * gap} y1={34} x2={24 + i * gap} y2={H - 34} stroke="var(--ink-3)" strokeDasharray="3 3" />
            ))
          : null}
        {Array.from({ length: left }, (_, i) => (
          <g key={`l${i}`}>
            {i >= right ? <circle cx={24 + i * gap} cy={22} r={r + 4} fill="var(--warn-soft)" /> : null}
            <Glyph kind={objL} x={24 + i * gap} y={22} r={r} />
          </g>
        ))}
        {Array.from({ length: right }, (_, i) => (
          <g key={`r${i}`}>
            {i >= left ? <circle cx={24 + i * gap} cy={H - 22} r={r + 4} fill="var(--warn-soft)" /> : null}
            <Glyph kind={objR} x={24 + i * gap} y={H - 22} r={r} />
          </g>
        ))}
      </svg>
      {!compact ? (
        <>
          <Controls>
            {editable ? (
              <>
                <Stepper label="Top group" value={left} min={0} max={15} onChange={setLeft} />
                <Stepper label="Bottom group" value={right} min={0} max={15} onChange={setRight} />
              </>
            ) : null}
          </Controls>
          <Note tone={rel === "=" ? "good" : "neutral"}>
            {showSymbol ? (
              <>
                <span className="mr-2 text-lg"><Tex tex={`${left} ${rel} ${right}`} /></span>
                {left} {word} {right}.
              </>
            ) : rel === "=" ? (
              "Every object has exactly one partner - the two groups are the same size."
            ) : (
              `The ${rel === ">" ? "top" : "bottom"} group has ${diff} ${diff === 1 ? "object" : "objects"} left without a partner, so it is bigger by ${diff}.`
            )}
          </Note>
        </>
      ) : null}
    </div>
  );
}

// ================================================================== balance

export function Balance({ props, goal, onComplete, compact }: WidgetProps) {
  const [left, setLeft] = useState(num(props, "left", 4));
  const [right, setRight] = useState(num(props, "right", 4));
  const [initial] = useState([left, right]);
  const editable = bool(props, "editable");
  const showNumbers = props.showNumbers === undefined ? true : bool(props, "showNumbers");
  const angle = clamp((right - left) * 4, -16, 16); // positive: right side down
  const changed = left !== initial[0] || right !== initial[1];
  useGoal(
    (goal?.balanced === true && left === right && (changed || initial[0] !== initial[1])) ||
      (goal?.heavier === "left" && left > right) || (goal?.heavier === "right" && right > left),
    onComplete,
    { left, right },
  );
  const W = compact ? 300 : 480;
  const H = compact ? 150 : 210;
  const cx = W / 2;
  const beamY = H * 0.35;
  const arm = W * 0.36;
  const rad = (angle * Math.PI) / 180;
  const lx = cx - arm * Math.cos(rad);
  const ly = beamY - arm * Math.sin(rad);
  const rx = cx + arm * Math.cos(rad);
  const ry = beamY + arm * Math.sin(rad);
  const pan = (x: number, y: number, n: number, key: string) => (
    <g key={key}>
      <line x1={x} y1={y} x2={x - 34} y2={y + 40} stroke="var(--ink-3)" />
      <line x1={x} y1={y} x2={x + 34} y2={y + 40} stroke="var(--ink-3)" />
      <path d={`M${x - 44},${y + 40} q44,24 88,0 z`} fill="var(--surface-2)" stroke="var(--ink-3)" />
      {Array.from({ length: n }, (_, i) => (
        <rect key={i} x={x - 36 + (i % 6) * 12.5} y={y + 30 - Math.floor(i / 6) * 12} width={11} height={11} rx={2} fill="var(--accent)" />
      ))}
    </g>
  );
  const rel = relation(left, right);
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-lg bg-surface" role="img"
        aria-label={`balance with ${left} on the left and ${right} on the right`}>
        <polygon points={`${cx},${beamY} ${cx - 26},${H - 12} ${cx + 26},${H - 12}`} fill="var(--line)" />
        <line x1={lx} y1={ly} x2={rx} y2={ry} stroke="var(--ink-2)" strokeWidth={5} strokeLinecap="round" />
        <circle cx={cx} cy={beamY} r={6} fill="var(--ink-2)" />
        {pan(lx, ly, left, "L")}
        {pan(rx, ry, right, "R")}
        {showNumbers ? (
          <>
            <text x={lx} y={ly + 78} textAnchor="middle" fontSize={16} fontWeight={700} fill="var(--ink)">{left}</text>
            <text x={rx} y={ry + 78} textAnchor="middle" fontSize={16} fontWeight={700} fill="var(--ink)">{right}</text>
          </>
        ) : null}
      </svg>
      {!compact ? (
        <>
          {editable ? (
            <Controls>
              <Stepper label="Left pan" value={left} min={0} max={18} onChange={setLeft} />
              <Stepper label="Right pan" value={right} min={0} max={18} onChange={setRight} />
            </Controls>
          ) : null}
          <Note tone={rel === "=" ? "good" : "neutral"}>
            <span className="mr-2 text-lg"><Tex tex={`${left} ${rel} ${right}`} /></span>
            {rel === "=" ? "The beam is level: both sides hold the same amount." : `The ${rel === ">" ? "left" : "right"} side is heavier, so the beam tips toward it.`}
          </Note>
        </>
      ) : null}
    </div>
  );
}

// ================================================================== weighing puzzle

type Fact = { heavier: number; lighter: number; weighed: boolean };

function closure(n: number, direct: [number, number][]): boolean[][] {
  const g = Array.from({ length: n }, () => Array(n).fill(false) as boolean[]);
  for (const [a, b] of direct) g[a][b] = true;
  for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (g[i][k] && g[k][j]) g[i][j] = true;
  return g;
}

export function WeighingPuzzle({ props, onComplete, compact }: WidgetProps) {
  const n = clamp(num(props, "bags", 3), 2, 5);
  const [seed, setSeed] = useState(num(props, "seed", 1));
  const weights = useMemo(() => {
    const rnd = seeded(seed * 97 + n);
    const w = Array.from({ length: n }, (_, i) => i + 1);
    for (let i = w.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [w[i], w[j]] = [w[j], w[i]];
    }
    return w;
  }, [seed, n]);
  const [sel, setSel] = useState<number[]>([]);
  const [direct, setDirect] = useState<[number, number][]>([]);
  const name = (i: number) => String.fromCharCode(65 + i);
  const g = closure(n, direct);
  const facts: Fact[] = [];
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) if (g[i][j]) facts.push({ heavier: i, lighter: j, weighed: direct.some(([a, b]) => a === i && b === j) });
  const solved = facts.length === (n * (n - 1)) / 2;
  const order = solved ? [...Array(n).keys()].sort((a, b) => facts.filter((f) => f.heavier === b).length - facts.filter((f) => f.heavier === a).length) : [];
  useGoal(solved, onComplete, { weighings: direct.length });

  const weigh = () => {
    if (sel.length !== 2) return;
    const [a, b] = sel;
    setDirect([...direct, weights[a] > weights[b] ? [a, b] : [b, a]]);
    setSel([]);
  };
  const toggle = (i: number) => setSel(sel.includes(i) ? sel.filter((x) => x !== i) : sel.length < 2 ? [...sel, i] : [sel[1], i]);

  return (
    <div className={compact ? "text-sm" : ""}>
      <div className="flex flex-wrap gap-3">
        {Array.from({ length: n }, (_, i) => (
          <button key={i} type="button" onClick={() => toggle(i)} disabled={compact}
            className={`flex h-16 w-16 items-center justify-center rounded-2xl border-2 text-xl font-bold transition ${
              sel.includes(i) ? "border-accent bg-accent-soft" : "border-line bg-surface hover:border-accent"}`}
            aria-pressed={sel.includes(i)} aria-label={`bag ${name(i)}`}>
            {name(i)}
          </button>
        ))}
      </div>
      {!compact ? (
        <>
          <Controls>
            <SmallButton onClick={weigh} disabled={sel.length !== 2}>
              {sel.length === 2 ? `Weigh ${name(sel[0])} against ${name(sel[1])}` : "Pick two bags to weigh"}
            </SmallButton>
            <SmallButton onClick={() => { setSeed(seed + 1); setDirect([]); setSel([]); }}>New puzzle</SmallButton>
            <span className="text-sm text-ink-3">Weighings used: {direct.length}</span>
          </Controls>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <div className="rounded-lg bg-surface-2 p-3 text-sm">
              <p className="mb-1 font-semibold">Weighed</p>
              {direct.length ? direct.map(([a, b], i) => <p key={i}>{name(a)} is heavier than {name(b)}</p>) : <p className="text-ink-3">Nothing yet.</p>}
            </div>
            <div className="rounded-lg bg-accent-soft p-3 text-sm">
              <p className="mb-1 font-semibold">Concluded by reasoning (never weighed)</p>
              {facts.filter((f) => !f.weighed).length ? (
                facts.filter((f) => !f.weighed).map((f, i) => <p key={i}>∴ {name(f.heavier)} is heavier than {name(f.lighter)}</p>)
              ) : (
                <p className="text-ink-3">Nothing yet.</p>
              )}
            </div>
          </div>
          {solved ? (
            <Note tone="good">
              Order from heaviest to lightest: {order.map(name).join(", ")}. You used {direct.length} weighings for {(n * (n - 1)) / 2} comparisons - reasoning supplied the rest.
            </Note>
          ) : null}
        </>
      ) : (
        <p className="mt-2 text-ink-2">If A is heavier than B and B is heavier than C, then A is heavier than C.</p>
      )}
    </div>
  );
}
