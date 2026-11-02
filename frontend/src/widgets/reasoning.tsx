"use client";

import { useMemo, useState } from "react";
import { Tex } from "@/components/Tex";
import { FAMILY_LABEL, FAMILY_ORDER, families, parseFrac, smallestFamily, whyNot, type Family } from "@/lib/numbers";
import { bool, clamp, Controls, Note, num, SmallButton, Stepper, str, useGoal, type WidgetProps } from "./common";

// ================================================================== families of numbers

export function NumberSets({ props, goal, onComplete, compact }: WidgetProps) {
  const numbers = (Array.isArray(props.numbers) ? (props.numbers as string[]) : ["3", "0", "-2", "1/2"]).filter((s) => parseFrac(s));
  const shown = (Array.isArray(props.sets) ? (props.sets as Family[]) : FAMILY_ORDER).filter((f) => FAMILY_ORDER.includes(f));
  const ordered = FAMILY_ORDER.filter((f) => shown.includes(f));
  const [placed, setPlaced] = useState<Record<string, Family | "outside">>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const correctFor = (s: string) => smallestFamily(parseFrac(s)!, ordered) ?? "outside";
  const allDone = numbers.length > 0 && numbers.every((s) => placed[s] === correctFor(s));
  useGoal(goal?.sortAll === true && allDone, onComplete, {});

  const drop = (region: Family | "outside") => {
    if (!selected) return setMsg("First tap a number card, then tap the family it belongs to.");
    const f = parseFrac(selected)!;
    const right = correctFor(selected);
    if (region === right) {
      setPlaced({ ...placed, [selected]: region });
      const fams = families(f).filter((x) => ordered.includes(x));
      setMsg(region === "outside"
        ? `Right: ${selected} is in none of these families.`
        : `Right: ${selected} belongs to ${fams.map((x) => FAMILY_LABEL[x].split(" ℕ")[0].split(" ℤ")[0].split(" ℚ")[0].toLowerCase()).join(", ")}${fams.length > 1 ? " - the families are nested" : ""}.`);
      setSelected(null);
    } else if (region !== "outside" && families(f).includes(region)) {
      setMsg(`${selected} is in ${FAMILY_LABEL[region]}, but it also fits in a smaller family inside it. Place it in the smallest one.`);
    } else {
      setMsg(region === "outside" ? `${selected} does belong to one of the families.` : `Not quite: ${whyNot(f, region)}`);
    }
  };

  // nested rectangles, outermost first
  const levels = [...ordered].reverse();
  const W = compact ? 300 : 560;
  const H = compact ? 170 : 260;
  const inset = compact ? 22 : 34;
  const placedIn = (r: Family | "outside") => numbers.filter((s) => placed[s] === r);
  return (
    <div>
      {!compact ? (
        <div className="mb-2 flex flex-wrap gap-2">
          {numbers.filter((s) => !placed[s]).map((s) => (
            <button key={s} type="button" onClick={() => setSelected(s)}
              className={`rounded-lg border-2 px-3 py-1.5 font-semibold tabular-nums ${selected === s ? "border-accent bg-accent-soft" : "border-line bg-surface"}`}>
              {s.includes("/") ? <Tex tex={`${s.startsWith("-") ? "-" : ""}\\tfrac{${s.replace("-", "").split("/")[0]}}{${s.split("/")[1]}}`} /> : s.replace("-", "−")}
            </button>
          ))}
          {numbers.every((s) => placed[s]) ? <span className="text-sm text-good">All placed!</span> : null}
        </div>
      ) : null}
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-lg bg-surface" role="img" aria-label="nested families of numbers">
        <rect x={2} y={2} width={W - 4} height={H - 4} rx={10} fill="var(--surface-2)" onClick={() => drop("outside")} style={{ cursor: "pointer" }} />
        <text x={10} y={H - 10} fontSize={11} fill="var(--ink-3)">outside these families</text>
        {placedIn("outside").map((s, i) => <text key={s} x={W - 30 - i * 34} y={H - 10} fontSize={13} fontWeight={700} fill="var(--ink)">{s}</text>)}
        {levels.map((fam, depth) => {
          const x = 10 + depth * inset;
          const y = 8 + depth * (inset * 0.8);
          const w = W - 20 - depth * inset * 2;
          const h = H - 34 - depth * (inset * 1.6);
          const tone = ["var(--info)", "var(--good)", "var(--warn)", "var(--accent)"][FAMILY_ORDER.indexOf(fam)];
          return (
            <g key={fam} onClick={(e) => { e.stopPropagation(); drop(fam); }} style={{ cursor: "pointer" }}>
              <rect x={x} y={y} width={w} height={h} rx={10} fill="var(--surface)" stroke={tone} strokeWidth={2} />
              <text x={x + 8} y={y + 15} fontSize={compact ? 10 : 12} fontWeight={700} fill={tone}>{FAMILY_LABEL[fam]}</text>
              {placedIn(fam).map((s, i) => (
                <text key={s} x={x + w - 26 - i * 36} y={y + 16} textAnchor="middle" fontSize={13} fontWeight={700} fill="var(--ink)">{s}</text>
              ))}
            </g>
          );
        })}
      </svg>
      {!compact ? <Note tone={allDone ? "good" : "neutral"}>{allDone ? "Every number is in the smallest family it belongs to. Each family sits inside the next one." : msg ?? "Tap a number card, then tap the smallest family it belongs to."}</Note> : null}
    </div>
  );
}

// ================================================================== measuring with units

const UNITS: Record<string, { mm: number; label: string; plural: string; color: string }> = {
  cm: { mm: 10, label: "centimetre", plural: "centimetres", color: "#64748b" },
  paperclip: { mm: 30, label: "paperclip", plural: "paperclips", color: "#0ea5e9" },
  finger: { mm: 18, label: "finger-width", plural: "finger-widths", color: "#f97316" },
  pencil: { mm: 180, label: "pencil", plural: "pencils", color: "#eab308" },
};

export function Measure({ props, goal, onComplete, compact }: WidgetProps) {
  const units = (Array.isArray(props.units) ? (props.units as string[]) : ["paperclip", "cm"]).filter((u) => UNITS[u]);
  const lengthMm = num(props, "length", 6) * UNITS[units[0] ?? "paperclip"].mm;
  const object = str(props, "object", "pencil");
  const [unit, setUnit] = useState(units[0] ?? "paperclip");
  const [laid, setLaid] = useState(0);
  const [measuredWith, setMeasuredWith] = useState<Set<string>>(new Set());
  const u = UNITS[unit];
  const fits = Math.floor(lengthMm / u.mm + 1e-9);
  const leftover = lengthMm - fits * u.mm;
  const done = laid >= fits;
  useGoal(goal?.measured === true && measuredWith.size >= Math.min(2, units.length), onComplete, { units: [...measuredWith] });

  const W = compact ? 300 : 560;
  const scale = (W - 40) / Math.max(lengthMm, ...units.map((x) => UNITS[x].mm)) * 0.95;
  const objH = 22;
  const lay = (all: boolean) => {
    const next = all ? fits : Math.min(fits, laid + 1);
    setLaid(next);
    if (next >= fits) setMeasuredWith(new Set([...measuredWith, unit]));
  };
  return (
    <div>
      <svg viewBox={`0 0 ${W} 100`} className="w-full rounded-lg bg-surface" role="img" aria-label={`a ${object} measured in ${u.plural}`}>
        <rect x={20} y={14} width={lengthMm * scale} height={objH} rx={object === "rope" ? 11 : 4}
          fill={object === "rope" ? "#a16207" : object === "table" ? "#92400e" : "#facc15"} stroke="var(--ink-2)" />
        {object === "pencil" ? <polygon points={`${20 + lengthMm * scale},14 ${20 + lengthMm * scale + 14},25 ${20 + lengthMm * scale},36`} fill="#fde68a" stroke="var(--ink-2)" /> : null}
        {Array.from({ length: compact ? fits : laid }, (_, i) => (
          <g key={i}>
            <rect x={20 + i * u.mm * scale} y={50} width={u.mm * scale - 2} height={16} rx={4} fill={u.color} opacity={0.85} />
            {u.mm * scale > 14 ? <text x={20 + i * u.mm * scale + (u.mm * scale) / 2} y={62} textAnchor="middle" fontSize={10} fill="#fff">{i + 1}</text> : null}
          </g>
        ))}
        <line x1={20} x2={20} y1={8} y2={74} stroke="var(--ink-3)" strokeDasharray="3 3" />
        <line x1={20 + lengthMm * scale} x2={20 + lengthMm * scale} y1={8} y2={74} stroke="var(--ink-3)" strokeDasharray="3 3" />
      </svg>
      {!compact ? (
        <>
          <Controls>
            {units.map((x) => (
              <SmallButton key={x} active={x === unit} onClick={() => { setUnit(x); setLaid(0); }}>
                {measuredWith.has(x) ? "✓ " : ""}{UNITS[x].plural}
              </SmallButton>
            ))}
            <SmallButton onClick={() => lay(false)} disabled={done}>Lay one more</SmallButton>
            <SmallButton onClick={() => lay(true)} disabled={done}>Fill to the end</SmallButton>
          </Controls>
          <Note tone={done ? "good" : "neutral"}>
            {done
              ? `${fits} ${fits === 1 ? u.label : u.plural} fit along the ${object}${leftover > 0.5 ? `, with a gap smaller than one ${u.label} left over - a fraction of a unit` : " exactly"}. So the ${object} is ${leftover > 0.5 ? "a little more than " : ""}${fits} ${u.plural} long.`
              : `Units laid so far: ${laid}. Lay them end to end with no gaps and no overlaps.`}
          </Note>
        </>
      ) : null}
    </div>
  );
}

// ================================================================== pattern explorer

const PATTERNS: Record<string, { name: string; term: (k: number) => number; rule: string; dots: "square" | "triangle" | "row" }> = {
  squares: { name: "Square numbers", term: (k) => k * k, rule: "Stage k is a square of k rows of k dots. Each stage adds an odd number of dots: 3, 5, 7, ...", dots: "square" },
  triangles: { name: "Triangle numbers", term: (k) => (k * (k + 1)) / 2, rule: "Each stage adds a new bottom row, one dot longer than the last: +2, +3, +4, ...", dots: "triangle" },
  staircase: { name: "Staircase", term: (k) => (k * (k + 1)) / 2, rule: "Each new step adds a column one block taller than the last.", dots: "triangle" },
  evens: { name: "Even numbers", term: (k) => 2 * k, rule: "Each stage adds 2 more dots.", dots: "row" },
  odds: { name: "Odd numbers", term: (k) => 2 * k - 1, rule: "Start at 1 and add 2 each time.", dots: "row" },
  "plus-3": { name: "Add three", term: (k) => 1 + 3 * (k - 1), rule: "Start at 1 and add 3 each time.", dots: "row" },
  doubling: { name: "Doubling", term: (k) => 2 ** (k - 1), rule: "Each stage has twice as many dots as the one before.", dots: "row" },
};

function Dots({ kind, k, value, size }: { kind: "square" | "triangle" | "row"; k: number; value: number; size: number }) {
  const r = size;
  const pts: [number, number][] = [];
  if (kind === "square") for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) pts.push([j, i]);
  else if (kind === "triangle") for (let i = 0; i < k; i++) for (let j = 0; j <= i; j++) pts.push([j, i]);
  else for (let i = 0; i < value; i++) pts.push([i % 8, Math.floor(i / 8)]);
  const w = (Math.max(...pts.map((p) => p[0]), 0) + 1) * r * 2.4;
  const h = (Math.max(...pts.map((p) => p[1]), 0) + 1) * r * 2.4;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label={`${value} dots`}>
      {pts.map(([x, y], i) => <circle key={i} cx={x * r * 2.4 + r * 1.2} cy={y * r * 2.4 + r * 1.2} r={r} fill="var(--accent)" />)}
    </svg>
  );
}

export function Pattern({ props, goal, onComplete, compact }: WidgetProps) {
  const [kind, setKind] = useState(PATTERNS[str(props, "kind", "squares")] ? str(props, "kind", "squares") : "squares");
  const editable = bool(props, "editable");
  const [shownN, setShownN] = useState(clamp(num(props, "terms", 4), 1, 8));
  const [guess, setGuess] = useState("");
  const [result, setResult] = useState<{ ok: boolean; value: number } | null>(null);
  const [score, setScore] = useState(0);
  const p = PATTERNS[kind];
  useGoal(goal?.predict === true && score >= 3, onComplete, { correct: score });
  const next = p.term(shownN + 1);
  const check = () => {
    const g = Number(guess);
    if (!guess.trim() || Number.isNaN(g)) return;
    const ok = g === next;
    setResult({ ok, value: next });
    if (ok) setScore(score + 1);
  };
  const advance = () => {
    setShownN(Math.min(shownN + 1, 9));
    setGuess("");
    setResult(null);
  };
  const size = compact ? 3 : 4.5;
  return (
    <div>
      <div className="flex flex-wrap items-end gap-4 rounded-lg bg-surface p-3">
        {Array.from({ length: shownN }, (_, i) => (
          <figure key={i} className="flex flex-col items-center gap-1">
            {p.dots !== "row" || p.term(i + 1) <= 40 ? <Dots kind={p.dots} k={i + 1} value={p.term(i + 1)} size={size} /> : null}
            <figcaption className="text-sm font-semibold tabular-nums">{p.term(i + 1)}</figcaption>
          </figure>
        ))}
        {!compact ? (
          <figure className="flex flex-col items-center gap-1 rounded-lg border-2 border-dashed border-line p-2">
            {result ? <Dots kind={p.dots} k={shownN + 1} value={next} size={size} /> : <span className="px-3 py-4 text-2xl text-ink-3">?</span>}
            <figcaption className="text-sm font-semibold">{result ? next : "next"}</figcaption>
          </figure>
        ) : null}
      </div>
      {!compact ? (
        <>
          <Controls>
            {editable ? (
              <select value={kind} onChange={(e) => { setKind(e.target.value); setShownN(3); setResult(null); setGuess(""); }}
                className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm" aria-label="choose a pattern">
                {Object.entries(PATTERNS).map(([id, v]) => <option key={id} value={id}>{v.name}</option>)}
              </select>
            ) : null}
            {!result ? (
              <form onSubmit={(e) => { e.preventDefault(); check(); }} className="flex items-center gap-2">
                <label className="text-sm text-ink-2" htmlFor="pattern-guess">Your prediction:</label>
                <input id="pattern-guess" inputMode="numeric" value={guess} onChange={(e) => setGuess(e.target.value)}
                  className="w-20 rounded-lg border border-line bg-surface px-2 py-1.5" />
                <SmallButton onClick={check} disabled={!guess.trim()}>Reveal</SmallButton>
              </form>
            ) : (
              <SmallButton onClick={advance}>Show the next stage</SmallButton>
            )}
            {goal?.predict ? <span className="text-sm text-ink-3">Correct predictions: {score} / 3</span> : null}
          </Controls>
          <Note tone={result ? (result.ok ? "good" : "warn") : "neutral"}>
            {result ? (result.ok ? `Right - the next stage has ${next}. ${p.rule}` : `The next stage has ${next}, not ${guess}. ${p.rule}`) : "Look at how each stage becomes the next, then predict."}
          </Note>
        </>
      ) : null}
    </div>
  );
}

// ================================================================== rule machine

const RULES: Record<string, { label: string; tex: string; f: (x: number) => number }> = {
  "add-one": { label: "add 1", tex: "x \\mapsto x + 1", f: (x) => x + 1 },
  "add-3": { label: "add 3", tex: "x \\mapsto x + 3", f: (x) => x + 3 },
  double: { label: "double it", tex: "x \\mapsto 2 \\times x", f: (x) => 2 * x },
  triple: { label: "triple it", tex: "x \\mapsto 3 \\times x", f: (x) => 3 * x },
  "minus-2": { label: "take away 2", tex: "x \\mapsto x - 2", f: (x) => x - 2 },
  "times-10": { label: "times ten", tex: "x \\mapsto 10 \\times x", f: (x) => 10 * x },
  square: { label: "multiply it by itself", tex: "x \\mapsto x \\times x", f: (x) => x * x },
  "double-plus-one": { label: "double it, then add 1", tex: "x \\mapsto 2 \\times x + 1", f: (x) => 2 * x + 1 },
};

export function RuleMachine({ props, goal, onComplete, compact }: WidgetProps) {
  const ruleId = RULES[str(props, "rule", "double")] ? str(props, "rule", "double") : "double";
  const hidden = bool(props, "hidden");
  const suggestions = Array.isArray(props.inputs) ? (props.inputs as number[]) : [1, 2, 3, 5, 10];
  const rule = RULES[ruleId];
  const [input, setInput] = useState("");
  const [log, setLog] = useState<[number, number][]>(compact ? suggestions.slice(0, 3).map((x): [number, number] => [x, rule.f(x)]) : []);
  const [guessed, setGuessed] = useState<string | null>(null);
  const solved = !hidden || guessed === ruleId;
  useGoal(goal?.guessRule === true && hidden && guessed === ruleId, onComplete, { rule: ruleId });
  const options = useMemo(() => {
    const others = Object.keys(RULES).filter((k) => k !== ruleId);
    const pick = [ruleId, ...others.slice(0, 5)];
    return pick.sort((a, b) => RULES[a].label.localeCompare(RULES[b].label));
  }, [ruleId]);
  const feed = (x: number) => setLog([[x, rule.f(x)] as [number, number], ...log].slice(0, 12));
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 rounded-lg bg-surface p-3">
        <div className="rounded-lg border border-line px-3 py-2 text-center">
          <p className="text-xs text-ink-3">in</p>
          <p className="text-xl font-bold tabular-nums">{log[0]?.[0] ?? "?"}</p>
        </div>
        <div className="rounded-xl bg-accent px-4 py-3 text-center text-accent-ink">
          <p className="text-xs opacity-80">rule</p>
          <p className="font-semibold">{solved ? rule.label : "hidden"}</p>
        </div>
        <div className="rounded-lg border border-line px-3 py-2 text-center">
          <p className="text-xs text-ink-3">out</p>
          <p className="text-xl font-bold tabular-nums">{log[0]?.[1] ?? "?"}</p>
        </div>
        {log.length ? (
          <ul className="ml-2 flex flex-wrap gap-2 text-sm">
            {log.map(([a, b], i) => <li key={i} className="rounded bg-surface-2 px-2 py-0.5"><Tex tex={`${a} \\mapsto ${b}`} /></li>)}
          </ul>
        ) : null}
      </div>
      {!compact ? (
        <>
          <Controls>
            <form onSubmit={(e) => { e.preventDefault(); if (input.trim() !== "" && !Number.isNaN(Number(input))) { feed(Number(input)); setInput(""); } }} className="flex items-center gap-2">
              <label htmlFor="rule-in" className="text-sm text-ink-2">Put in a number:</label>
              <input id="rule-in" inputMode="numeric" value={input} onChange={(e) => setInput(e.target.value)} className="w-20 rounded-lg border border-line bg-surface px-2 py-1.5" />
              <SmallButton onClick={() => { if (input.trim() !== "" && !Number.isNaN(Number(input))) { feed(Number(input)); setInput(""); } }}>Go</SmallButton>
            </form>
            {suggestions.map((x) => <SmallButton key={x} onClick={() => feed(x)}>{x}</SmallButton>)}
          </Controls>
          {hidden ? (
            <div className="mt-3">
              <p className="text-sm text-ink-2">{log.length >= 2 ? "What is the rule?" : "Try at least two numbers, then guess the rule."}</p>
              <div className="mt-1 flex flex-wrap gap-2">
                {options.map((o) => (
                  <SmallButton key={o} disabled={log.length < 2 || solved} active={guessed === o} onClick={() => setGuessed(o)}>{RULES[o].label}</SmallButton>
                ))}
              </div>
            </div>
          ) : null}
          <Note tone={hidden && guessed ? (guessed === ruleId ? "good" : "warn") : "neutral"}>
            {hidden && guessed
              ? guessed === ruleId
                ? <>Right! The rule is &ldquo;{rule.label}&rdquo; - written <Tex tex={rule.tex} />, where <Tex tex="x" /> stands for whatever number goes in.</>
                : `"${RULES[guessed].label}" does not fit every result in the table - check it against each one.`
              : "The same number in always gives the same number out. That is what makes it a rule."}
          </Note>
        </>
      ) : null}
    </div>
  );
}

// ================================================================== even + even is even

export function PairProof({ props, goal, onComplete, compact }: WidgetProps) {
  const [a, setA] = useState(num(props, "a", 4));
  const [b, setB] = useState(num(props, "b", 6));
  const [tries, setTries] = useState<Set<string>>(new Set([`${num(props, "a", 4)}+${num(props, "b", 6)}`]));
  useGoal(goal?.tries !== undefined && tries.size > Number(goal.tries), onComplete, { tries: tries.size });
  const record = (x: number, y: number) => setTries(new Set([...tries, `${x}+${y}`]));
  const W = compact ? 300 : 560;
  const gap = Math.min(22, (W - 60) / ((a + b) / 2 + 2));
  const col = (i: number, tone: string, offset: number) => (
    <g key={`${tone}${i}`}>
      <circle cx={20 + (offset + i) * gap} cy={22} r={7} fill={tone} />
      <circle cx={20 + (offset + i) * gap} cy={48} r={7} fill={tone} />
    </g>
  );
  return (
    <div>
      <svg viewBox={`0 0 ${W} 70`} className="w-full rounded-lg bg-surface" role="img" aria-label={`${a} plus ${b} drawn as pairs`}>
        {Array.from({ length: a / 2 }, (_, i) => col(i, "var(--accent)", 0))}
        {Array.from({ length: b / 2 }, (_, i) => col(i, "var(--warn)", a / 2 + 0.6))}
      </svg>
      {!compact ? (
        <>
          <Controls>
            <Stepper label="First even number" value={a} min={0} max={20} step={2} onChange={(v) => { setA(v); record(v, b); }} />
            <Stepper label="Second even number" value={b} min={0} max={20} step={2} onChange={(v) => { setB(v); record(a, v); }} />
          </Controls>
          <Note tone="good">
            <Tex tex={`${a} + ${b} = ${a + b}`} /> - two full rows, every dot paired: even. Examples tried: {tries.size}.
          </Note>
          <div className="mt-3 rounded-lg border border-line bg-surface p-3 text-sm leading-relaxed">
            <p className="font-semibold">Why it works for every even number - not just these</p>
            <p className="mt-1 text-ink-2">
              An even number is one that can be drawn as two equal rows, every dot with a partner. Put two such drawings side by side and
              the rows simply get longer: every dot still has its partner, so nothing is left over. That reasoning never used the actual
              numbers, so it covers every possible pair of even numbers at once. That is a proof. ∎
            </p>
          </div>
        </>
      ) : null}
    </div>
  );
}

// ================================================================== words and symbols

type Statement = { words: string; symbols: string };
const DEFAULT_STATEMENTS: Statement[] = [
  { words: "three added to four is the same amount as seven", symbols: "3 + 4 = 7" },
  { words: "ten is the same amount as five added to five", symbols: "10 = 5 + 5" },
];

export function SymbolTranslator({ props, goal, onComplete, compact }: WidgetProps) {
  const statements = Array.isArray(props.statements) && props.statements.length ? (props.statements as Statement[]) : DEFAULT_STATEMENTS;
  const [flipped, setFlipped] = useState<Set<number>>(new Set());
  const [seen, setSeen] = useState<Set<number>>(new Set());
  useGoal(goal?.revealAll === true && seen.size === statements.length, onComplete, {});
  const flip = (i: number) => {
    const f = new Set(flipped);
    if (f.has(i)) f.delete(i);
    else f.add(i);
    setFlipped(f);
    setSeen(new Set([...seen, i]));
  };
  return (
    <div>
      <ul className="space-y-2">
        {statements.map((s, i) => (
          <li key={i}>
            <button type="button" onClick={() => flip(i)} disabled={compact}
              className="flex w-full items-center justify-between gap-3 rounded-lg border border-line bg-surface px-4 py-3 text-left hover:border-accent">
              {flipped.has(i) || compact ? (
                <span className="text-xl"><Tex tex={s.symbols} /></span>
              ) : (
                <span className="font-serif text-ink">{s.words}</span>
              )}
              {!compact ? <span className="shrink-0 text-xs text-ink-3">{flipped.has(i) ? "show words" : "show symbols"}</span> : null}
            </button>
          </li>
        ))}
      </ul>
      {!compact ? (
        <Note>
          Revealed {seen.size} of {statements.length}. The symbols say exactly the same as the words - in a fraction of the space, and in a form every
          country reads the same way.
        </Note>
      ) : null}
    </div>
  );
}

// ================================================================== mathematical model

const SCENARIOS = {
  savings: { title: "Savings jar", start: 10, rate: 5, unit: "coins", step: "week", steps: "weeks", ask: 4, max: 12, startLabel: "Coins at the start", rateLabel: "Coins added each week" },
  journey: { title: "A walk", start: 0, rate: 3, unit: "km", step: "hour", steps: "hours", ask: 5, max: 10, startLabel: "Distance at the start", rateLabel: "km walked each hour" },
  tiles: { title: "Tiling a floor", start: 0, rate: 6, unit: "tiles", step: "row", steps: "rows", ask: 4, max: 10, startLabel: "Tiles at the start", rateLabel: "Tiles in each row" },
} as const;

export function Model({ props, goal, onComplete, compact }: WidgetProps) {
  const sc = SCENARIOS[str(props, "scenario", "savings") as keyof typeof SCENARIOS] ?? SCENARIOS.savings;
  const [start, setStart] = useState<number>(sc.start);
  const [rate, setRate] = useState<number>(sc.rate);
  const [t, setT] = useState(0);
  const [prediction, setPrediction] = useState("");
  const [checked, setChecked] = useState<boolean | null>(null);
  const value = start + rate * t;
  const target = start + rate * sc.ask;
  useGoal(goal?.predict === true && checked !== null, onComplete, { correct: checked });
  return (
    <div>
      <div className="rounded-lg bg-surface p-3">
        <p className="text-sm font-semibold">{sc.title}: the model</p>
        <p className="mt-1 text-sm text-ink-2">
          Start with <strong>{start}</strong> {sc.unit}. Each {sc.step}, add <strong>{rate}</strong>. After <strong>{t}</strong> {t === 1 ? sc.step : sc.steps}:{" "}
          <Tex tex={`${start}${Array.from({ length: Math.min(t, 6) }, () => ` + ${rate}`).join("")}${t > 6 ? " + \\cdots" : ""} = ${value}`} /> {sc.unit}.
        </p>
        <div className="mt-2 h-3 w-full overflow-hidden rounded-full bg-surface-2">
          <div className="h-full bg-accent" style={{ width: `${Math.min(100, (value / (sc.start + sc.rate * sc.max || 1)) * 100)}%` }} />
        </div>
      </div>
      {!compact ? (
        <>
          <Controls>
            <Stepper label={sc.startLabel} value={start} min={0} max={50} onChange={setStart} />
            <Stepper label={sc.rateLabel} value={rate} min={0} max={20} onChange={setRate} />
          </Controls>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <label htmlFor="model-pred">Predict the total after {sc.ask} {sc.steps}:</label>
            <input id="model-pred" inputMode="numeric" value={prediction} onChange={(e) => { setPrediction(e.target.value); setChecked(null); }}
              className="w-20 rounded-lg border border-line bg-surface px-2 py-1.5" />
            <SmallButton disabled={!prediction.trim()} onClick={() => { setT(sc.ask); setChecked(Number(prediction) === target); }}>Check with the model</SmallButton>
          </div>
          <label className="mt-3 flex items-center gap-3 text-sm">
            <span className="w-28 text-ink-2">{sc.steps} passed: {t}</span>
            <input type="range" min={0} max={sc.max} value={t} disabled={checked === null && goal?.predict === true}
              onChange={(e) => setT(Number(e.target.value))} className="flex-1" aria-label={`${sc.steps} passed`} />
          </label>
          <Note tone={checked === null ? "neutral" : checked ? "good" : "warn"}>
            {checked === null
              ? goal?.predict ? "Make your prediction first - then the slider unlocks." : "Move the slider to see what the model predicts."
              : checked
                ? `Your prediction matches the model: ${target} ${sc.unit}. Remember a real ${sc.title.toLowerCase()} might not follow the model exactly - models leave details out.`
                : `The model says ${target} ${sc.unit}: ${start} plus ${sc.ask} lots of ${rate}. Check how you combined the start and the repeated amount.`}
          </Note>
        </>
      ) : null}
    </div>
  );
}
