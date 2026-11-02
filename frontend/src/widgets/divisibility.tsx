"use client";

import { useMemo, useState } from "react";
import { Tex } from "@/components/Tex";
import { divisors, gcd, isPrime, lcm } from "@/lib/numbers";
import { bool, clamp, Controls, Glyph, Note, num, SmallButton, Stepper, str, useGoal, type WidgetProps } from "./common";

// ================================================================== sieve of Eratosthenes

export function Sieve({ props, goal, onComplete, compact }: WidgetProps) {
  const max = clamp(num(props, "max", 100), 10, 200);
  const guided = bool(props, "guided", true);
  const [sieved, setSieved] = useState<number[]>([]); // primes whose multiples were crossed out
  const [msg, setMsg] = useState<string | null>(null);
  const crossedBy = useMemo(() => {
    const m = new Map<number, number>();
    for (const p of sieved) for (let k = 2 * p; k <= max; k += p) if (!m.has(k)) m.set(k, p);
    return m;
  }, [sieved, max]);
  const nextToSieve = (() => {
    for (let k = 2; k <= max; k++) if (!crossedBy.has(k) && !sieved.includes(k)) return k;
    return null;
  })();
  const complete = nextToSieve === null || nextToSieve * nextToSieve > max;
  useGoal(goal?.complete === true && complete, onComplete, { primes: [...Array(max + 1).keys()].filter(isPrime).length });

  const click = (k: number) => {
    if (compact) return;
    if (crossedBy.has(k)) return setMsg(`${k} is already crossed out - it is a multiple of ${crossedBy.get(k)}: ${crossedBy.get(k)} × ${k / crossedBy.get(k)!}.`);
    if (sieved.includes(k)) return setMsg(`${k} is prime, and its multiples are already crossed out.`);
    if (complete) return setMsg(`${k} is prime. Every number left uncrossed is prime now.`);
    if (guided && k !== nextToSieve) return setMsg(`Start with the smallest number that is not yet circled or crossed out: ${nextToSieve}.`);
    setSieved([...sieved, k]);
    setMsg(`${k} is prime - nothing smaller crossed it out. Now every multiple of ${k} (${2 * k}, ${3 * k}, ${4 * k}, ...) is crossed out.`);
  };

  const cols = 10;
  const cell = compact ? 26 : 44;
  const nums = Array.from({ length: max - 1 }, (_, i) => i + 2);
  const remaining = complete;
  return (
    <div>
      <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, ${cell}px))` }}>
        {nums.map((k) => {
          const crossed = crossedBy.has(k);
          const prime = sieved.includes(k) || (remaining && !crossed);
          return (
            <button key={k} type="button" onClick={() => click(k)} disabled={compact}
              aria-label={`${k}${crossed ? ", crossed out" : prime ? ", prime" : ""}`}
              className={`relative flex aspect-square items-center justify-center rounded-md border text-xs font-semibold tabular-nums sm:text-sm ${
                crossed ? "border-line bg-surface-2 text-ink-3 line-through" : prime ? "border-accent bg-accent-soft text-accent" : "border-line bg-surface"}`}>
              {k}
            </button>
          );
        })}
      </div>
      {!compact ? (
        <>
          <Controls>
            <SmallButton onClick={() => { setSieved([]); setMsg(null); }}>Start again</SmallButton>
            {!complete && nextToSieve ? <span className="text-sm text-ink-3">Next to choose: {nextToSieve}</span> : null}
          </Controls>
          <Note tone={complete ? "good" : "neutral"}>
            {complete
              ? `Done! The ${nums.filter((k) => !crossedBy.has(k)).length} numbers left are exactly the primes up to ${max}. You only needed to sieve with primes up to ${Math.floor(Math.sqrt(max))}: any composite number up to ${max} has a factor that small.`
              : msg ?? "Click the smallest number that is not crossed out. It is prime; its multiples will be crossed out."}
          </Note>
        </>
      ) : null}
    </div>
  );
}

// ================================================================== rectangle arranger

export function RectangleArranger({ props, goal, onComplete, compact }: WidgetProps) {
  const maxN = num(props, "maxN", Math.max(36, num(props, "n", 12)));
  const editable = bool(props, "editable");
  const [n, setN] = useState(clamp(num(props, "n", 12), 1, maxN));
  const [rows, setRows] = useState(clamp(num(props, "rows", 1), 1, n));
  const [initialRows] = useState(rows);
  const [found, setFound] = useState<Set<number>>(new Set(n % rows === 0 ? [rows] : []));
  const perRow = Math.floor(n / rows);
  const left = n % rows;
  const perfect = left === 0;
  const all = divisors(n);
  const allFound = all.every((d) => found.has(d));
  useGoal(
    (goal?.rows !== undefined && rows === goal.rows && perfect && rows !== initialRows) || (goal?.findAllFactors === true && allFound),
    onComplete,
    { n, factors: all },
  );
  const setR = (r: number) => {
    setRows(r);
    if (n % r === 0) setFound(new Set([...found, r, n / r]));
  };
  const changeN = (v: number) => {
    setN(v);
    setRows(1);
    setFound(new Set([1, v]));
  };
  const W = compact ? 300 : 560;
  const cell = Math.min(compact ? 20 : 30, (W - 20) / Math.max(perRow + (left ? 1 : 0), 1), 220 / (rows + (left ? 1 : 0)));
  const H = (rows + (left ? 1 : 0)) * (cell + 2) + 14;
  const prime = n > 1 && all.length === 2;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-lg bg-surface" role="img"
        aria-label={`${n} tiles in ${rows} rows of ${perRow}${left ? `, with ${left} left over` : ""}`}>
        {perfect ? <rect x={6} y={6} width={perRow * (cell + 2) + 4} height={rows * (cell + 2) + 2} rx={6} fill="none" stroke="var(--good)" strokeWidth={2.5} /> : null}
        {Array.from({ length: rows }, (_, r) =>
          Array.from({ length: perRow }, (_, c) => (
            <rect key={`${r}-${c}`} x={8 + c * (cell + 2)} y={8 + r * (cell + 2)} width={cell} height={cell} rx={3} fill="var(--accent)" opacity={0.85} />
          )),
        )}
        {Array.from({ length: left }, (_, i) => (
          <rect key={`l${i}`} x={8 + i * (cell + 2)} y={8 + rows * (cell + 2) + 4} width={cell} height={cell} rx={3} fill="var(--bad)" opacity={0.8} />
        ))}
      </svg>
      {!compact ? (
        <>
          <Controls>
            {editable ? <Stepper label="Rows" value={rows} min={1} max={n} onChange={setR} /> : null}
            {editable && props.maxN !== undefined ? <Stepper label="Tiles" value={n} min={1} max={maxN} onChange={changeN} /> : null}
          </Controls>
          <Note tone={perfect ? "good" : "warn"}>
            {perfect ? (
              <>A perfect rectangle: <Tex tex={`${n} = ${rows} \\times ${perRow}`} /> ({rows} rows of {perRow}).</>
            ) : (
              <>{rows} rows of {perRow} uses {rows * perRow} tiles, leaving {left} over - so {rows} is not a factor of {n}.</>
            )}
          </Note>
          {editable ? (
            <Note tone={allFound ? "good" : "neutral"}>
              Factors found so far: {[...found].sort((a, b) => a - b).join(", ")}
              {allFound ? ` - that is all of them. ${prime ? `${n} is prime: only 1 row or ${n} rows work.` : n === 1 ? "" : `${n} is composite.`}` : ""}
            </Note>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

// ================================================================== fair sharing

export function Sharing({ props, goal, onComplete, compact }: WidgetProps) {
  const editable = bool(props, "editable");
  const [items, setItems] = useState(num(props, "items", 13));
  const [groups, setGroups] = useState(clamp(num(props, "groups", 4), 1, 12));
  const [initial] = useState([items, groups]);
  const object = str(props, "object", "cookie");
  const each = Math.floor(items / groups);
  const rem = items % groups;
  const changed = items !== initial[0] || groups !== initial[1];
  useGoal(
    changed &&
      ((goal?.remainder !== undefined && rem === goal.remainder && groups > 1 && groups < items) ||
        (goal?.groups !== undefined && groups === goal.groups)),
    onComplete,
    { items, groups, each, remainder: rem },
  );
  const W = compact ? 300 : 560;
  const per = Math.min(groups, compact ? 4 : 6);
  const pw = (W - 20) / per - 8;
  const plateRows = Math.ceil(groups / per);
  const g = Math.min(12, pw / 6);
  const plateH = Math.ceil(each / 5) * (g * 2 + 2) + 18;
  const H = plateRows * (plateH + 8) + (rem ? 40 : 10);
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-lg bg-surface" role="img"
        aria-label={`${items} shared among ${groups}: ${each} each with ${rem} left over`}>
        {Array.from({ length: groups }, (_, k) => {
          const px = 10 + (k % per) * (pw + 8);
          const py = 6 + Math.floor(k / per) * (plateH + 8);
          return (
            <g key={k}>
              <rect x={px} y={py} width={pw} height={plateH} rx={10} fill="var(--surface-2)" stroke="var(--line)" />
              {Array.from({ length: each }, (_, i) => (
                <Glyph key={i} kind={object} x={px + g + 4 + (i % 5) * (g * 2 + 1)} y={py + g + 6 + Math.floor(i / 5) * (g * 2 + 2)} r={g} />
              ))}
            </g>
          );
        })}
        {rem ? (
          <g>
            <text x={10} y={H - 14} fontSize={12} fill="var(--warn)">left over:</text>
            {Array.from({ length: rem }, (_, i) => <Glyph key={i} kind={object} x={84 + i * (g * 2 + 4)} y={H - 18} r={g} />)}
          </g>
        ) : null}
      </svg>
      {!compact ? (
        <>
          {editable ? (
            <Controls>
              <Stepper label="Items" value={items} min={1} max={60} onChange={setItems} />
              <Stepper label="Groups" value={groups} min={1} max={12} onChange={setGroups} />
            </Controls>
          ) : null}
          <Note tone={rem === 0 ? "good" : "neutral"}>
            {items} shared among {groups}: {each} each, {rem} left over. <Tex tex={`${items} = ${groups} \\times ${each} + ${rem}`} />
            {rem === 0 ? ` - so ${groups} divides ${items} exactly.` : ` - so ${groups} does not divide ${items}.`}
          </Note>
        </>
      ) : null}
    </div>
  );
}

// ================================================================== pairs (even and odd)

export function Pairs({ props, goal, onComplete, compact }: WidgetProps) {
  const [n, setN] = useState(clamp(num(props, "n", 7), 0, 40));
  const [initial] = useState(n);
  const editable = bool(props, "editable");
  const even = n % 2 === 0;
  useGoal(goal?.parity !== undefined && (goal.parity === "even") === even && n !== initial, onComplete, { n });
  const pairs = Math.floor(n / 2);
  const W = compact ? 300 : 560;
  const gap = Math.min(compact ? 22 : 30, (W - 20) / Math.max(pairs + 1, 1));
  return (
    <div>
      <svg viewBox={`0 0 ${W} 80`} className="w-full rounded-lg bg-surface" role="img" aria-label={`${n} dots: ${pairs} pairs${even ? "" : " and one left over"}`}>
        {Array.from({ length: pairs }, (_, i) => (
          <g key={i}>
            <rect x={14 + i * gap - 9} y={8} width={18} height={62} rx={9} fill="var(--accent-soft)" />
            <circle cx={14 + i * gap} cy={22} r={7} fill="var(--accent)" />
            <circle cx={14 + i * gap} cy={56} r={7} fill="var(--accent)" />
          </g>
        ))}
        {!even ? (
          <g>
            <circle cx={14 + pairs * gap} cy={22} r={11} fill="var(--warn-soft)" />
            <circle cx={14 + pairs * gap} cy={22} r={7} fill="var(--warn)" />
          </g>
        ) : null}
      </svg>
      {!compact ? (
        <>
          {editable ? <Controls><Stepper label="Dots" value={n} min={0} max={40} onChange={setN} /></Controls> : null}
          <Note tone={even ? "good" : "warn"}>
            {n} = <Tex tex={even ? `2 \\times ${pairs}` : `2 \\times ${pairs} + 1`} />: {pairs} {pairs === 1 ? "pair" : "pairs"}
            {even ? " and nothing left over, so " + n + " is even." : " and one dot left without a partner, so " + n + " is odd."}
          </Note>
        </>
      ) : null}
    </div>
  );
}

// ================================================================== multiples as jumps

export function MultiplesJumps({ props, goal, onComplete, compact }: WidgetProps) {
  const editable = bool(props, "editable");
  const [a, setA] = useState(num(props, "a", 3));
  const [b, setB] = useState(num(props, "b", 4));
  const max = num(props, "max", 30);
  const [ja, setJa] = useState(0);
  const [jb, setJb] = useState(0);
  const [claim, setClaim] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const L = b ? lcm(a, b) : 0;
  const posA = a * ja;
  const posB = b * jb;
  useGoal(
    (goal?.findLcm === true && claim === L) || (goal?.findMultiple !== undefined && posA === goal.findMultiple && ja > 0),
    onComplete,
    { a, b, lcm: L },
  );
  const W = compact ? 320 : 600;
  const pad = 18;
  const x = (v: number) => pad + (v / max) * (W - pad * 2);
  const marksA = Array.from({ length: Math.floor(max / a) }, (_, i) => (i + 1) * a).filter((v) => v <= (compact ? max : posA));
  const marksB = b ? Array.from({ length: Math.floor(max / b) }, (_, i) => (i + 1) * b).filter((v) => v <= (compact ? max : posB)) : [];
  const tap = (v: number) => {
    if (!b) return;
    setClaim(v);
    const mA = v % a === 0, mB = v % b === 0;
    if (mA && mB && v === L) setMsg(`Yes! ${v} is the first number both frogs land on: lcm(${a}, ${b}) = ${v}.`);
    else if (mA && mB) setMsg(`Both frogs land on ${v} - it is a common multiple. But is it the first one they share?`);
    else if (mA) setMsg(`Only the ${a}-frog lands on ${v}.`);
    else if (mB) setMsg(`Only the ${b}-frog lands on ${v}.`);
    else setMsg(`Neither frog lands on ${v}.`);
  };
  return (
    <div>
      <svg viewBox={`0 0 ${W} 96`} className="w-full rounded-lg bg-surface" role="img"
        aria-label={`number line to ${max}; jumps of ${a}${b ? ` and ${b}` : ""}`}>
        <line x1={pad} x2={W - pad} y1={48} y2={48} stroke="var(--ink-2)" strokeWidth={2} />
        {Array.from({ length: max + 1 }, (_, v) => (
          <g key={v} onClick={() => !compact && tap(v)} style={{ cursor: b && !compact ? "pointer" : "default" }}>
            <rect x={x(v) - 8} y={36} width={16} height={24} fill="transparent" />
            <line x1={x(v)} x2={x(v)} y1={44} y2={52} stroke="var(--ink-3)" />
            {v % (max > 40 ? 5 : max > 20 ? 2 : 1) === 0 ? (
              <text x={x(v)} y={66} textAnchor="middle" fontSize={10} fill={claim === v ? "var(--accent)" : "var(--ink-3)"} fontWeight={claim === v ? 700 : 400}>{v}</text>
            ) : null}
          </g>
        ))}
        {marksA.map((v, i) => (
          <path key={`a${v}`} d={`M${x(v - a)},46 Q${(x(v - a) + x(v)) / 2},${16 - (i % 2) * 2} ${x(v)},46`} fill="none" stroke="var(--accent)" strokeWidth={2} />
        ))}
        {marksB.map((v) => (
          <path key={`b${v}`} d={`M${x(v - b)},50 Q${(x(v - b) + x(v)) / 2},86 ${x(v)},50`} fill="none" stroke="var(--warn)" strokeWidth={2} />
        ))}
        {marksA.filter((v) => marksB.includes(v)).map((v) => <circle key={`c${v}`} cx={x(v)} cy={48} r={6} fill="var(--good)" />)}
        {!compact ? (
          <>
            <circle cx={x(posA)} cy={30} r={6} fill="var(--accent)" />
            {b ? <circle cx={x(posB)} cy={66} r={6} fill="var(--warn)" /> : null}
          </>
        ) : null}
      </svg>
      {!compact ? (
        <>
          <Controls>
            <SmallButton onClick={() => posA + a <= max && setJa(ja + 1)}>Jump the {a}-frog</SmallButton>
            {b ? <SmallButton onClick={() => posB + b <= max && setJb(jb + 1)}>Jump the {b}-frog</SmallButton> : null}
            <SmallButton onClick={() => { setJa(0); setJb(0); setClaim(null); setMsg(null); }}>Back to 0</SmallButton>
            {editable ? <Stepper label="Jump A" value={a} min={1} max={12} onChange={(v) => { setA(v); setJa(0); }} /> : null}
            {editable && b ? <Stepper label="Jump B" value={b} min={1} max={12} onChange={(v) => { setB(v); setJb(0); }} /> : null}
          </Controls>
          <Note tone={claim === L && b ? "good" : "neutral"}>
            {msg ?? (b
              ? `The ${a}-frog is on ${posA} (${ja} jumps); the ${b}-frog is on ${posB} (${jb} jumps). Green dots mark numbers both frogs have landed on. Tap the number you think is the first place they meet.`
              : `The frog is on ${posA} after ${ja} ${ja === 1 ? "jump" : "jumps"}: every landing spot is a multiple of ${a}.`)}
          </Note>
        </>
      ) : null}
    </div>
  );
}

// ================================================================== common factors (GCD)

export function CommonFactors({ props, goal, onComplete, compact }: WidgetProps) {
  const editable = bool(props, "editable");
  const [a, setA] = useState(num(props, "a", 12));
  const [b, setB] = useState(num(props, "b", 18));
  const [claim, setClaim] = useState<number | null>(null);
  const fa = divisors(a);
  const fb = divisors(b);
  const common = fa.filter((d) => fb.includes(d));
  const onlyA = fa.filter((d) => !common.includes(d));
  const onlyB = fb.filter((d) => !common.includes(d));
  const G = gcd(a, b);
  useGoal(goal?.findGcd === true && claim === G, onComplete, { a, b, gcd: G });
  const W = compact ? 300 : 520;
  const H = compact ? 150 : 210;
  const rCircle = H * 0.45;
  const place = (list: number[], cx: number, width: number) =>
    list.map((d, i) => {
      const per = Math.max(2, Math.floor(width / 30));
      return { d, x: cx - ((Math.min(list.length, per) - 1) * 30) / 2 + (i % per) * 30, y: H / 2 - ((Math.ceil(list.length / per) - 1) * 24) / 2 + Math.floor(i / per) * 24 };
    });
  const cxA = W * 0.36;
  const cxB = W * 0.64;
  const items = [
    ...place(onlyA, W * 0.2, W * 0.16).map((p) => ({ ...p, kind: "a" })),
    ...place(common, W / 2, W * 0.16).map((p) => ({ ...p, kind: "c" })),
    ...place(onlyB, W * 0.8, W * 0.16).map((p) => ({ ...p, kind: "b" })),
  ];
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-lg bg-surface" role="img"
        aria-label={`factors of ${a} and ${b}; common factors ${common.join(", ")}`}>
        <circle cx={cxA} cy={H / 2} r={rCircle} fill="var(--accent)" opacity={0.1} stroke="var(--accent)" />
        <circle cx={cxB} cy={H / 2} r={rCircle} fill="var(--warn)" opacity={0.1} stroke="var(--warn)" />
        <text x={cxA - rCircle * 0.6} y={18} fontSize={12} fill="var(--accent)" fontWeight={700}>factors of {a}</text>
        <text x={cxB + rCircle * 0.6} y={18} textAnchor="end" fontSize={12} fill="var(--warn)" fontWeight={700}>factors of {b}</text>
        {items.map((it) => (
          <g key={`${it.kind}${it.d}`} onClick={() => !compact && setClaim(it.d)} style={{ cursor: compact ? "default" : "pointer" }}>
            <circle cx={it.x} cy={it.y} r={12} fill={claim === it.d ? (it.d === G ? "var(--good)" : "var(--bad)") : "var(--surface)"} stroke="var(--line)" />
            <text x={it.x} y={it.y + 4} textAnchor="middle" fontSize={11} fontWeight={600} fill={claim === it.d ? "#fff" : "var(--ink)"}>{it.d}</text>
          </g>
        ))}
      </svg>
      {!compact ? (
        <>
          {editable ? (
            <Controls>
              <Stepper label="First number" value={a} min={1} max={60} onChange={(v) => { setA(v); setClaim(null); }} />
              <Stepper label="Second number" value={b} min={1} max={60} onChange={(v) => { setB(v); setClaim(null); }} />
            </Controls>
          ) : null}
          <Note tone={claim === G ? "good" : "neutral"}>
            {claim === null
              ? `Common factors (in the overlap): ${common.join(", ")}. Tap the one you think is the greatest common divisor.`
              : claim === G
                ? `Yes: gcd(${a}, ${b}) = ${G}. ${G === 1 ? `${a} and ${b} share no factor except 1 - they are coprime.` : ""}`
                : common.includes(claim)
                  ? `${claim} divides both ${a} and ${b}, but there is a greater common factor.`
                  : `${claim} is not a factor of both numbers - it is outside the overlap.`}
          </Note>
        </>
      ) : null}
    </div>
  );
}
