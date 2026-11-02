"use client";

import type { ComponentType } from "react";
import type { WidgetProps } from "./common";
import { Balance, CompareGroups, CountingObjects, MathLenses, Shepherd, WeighingPuzzle } from "./counting";
import { CommonFactors, MultiplesJumps, Pairs, RectangleArranger, Sharing, Sieve } from "./divisibility";
import { FractionWidget, HundredGrid, RatioMixer } from "./fractions";
import { NumberLine } from "./numberline";
import { NumeralSystems, PlaceValue } from "./placevalue";
import { Measure, Model, NumberSets, Pattern, PairProof, RuleMachine, SymbolTranslator } from "./reasoning";

export type WidgetInfo = {
  component: ComponentType<WidgetProps>;
  title: string;
  /** what the learner is looking at, in plain words (shown in the playground) */
  explain: string;
  /** a good starting configuration for free exploration */
  playground: Record<string, unknown>;
  lesson: string;
};

// Every widget referenced by content/widgets.yaml must appear here (checked by a unit test).
export const WIDGETS: Record<string, WidgetInfo> = {
  "counting-objects": { component: CountingObjects, title: "Counting tray", lesson: "l0-counting",
    explain: "A tray of objects. Tap each one to give it the next counting number - the last number said is how many there are. Add or remove objects, rearrange them, or bundle them into tens.",
    playground: { count: 12, max: 40, tagging: true, editable: true, rearrange: true, bundle: true, object: "star" } },
  "number-line": { component: NumberLine, title: "Number line", lesson: "l1-number-lines",
    explain: "Numbers placed in order along a line, equally spaced, bigger to the right. Drag the point (or use the arrow keys) to any number, including negative numbers left of zero.",
    playground: { min: -10, max: 10, value: 0, editable: true, showDistance: true } },
  "compare-groups": { component: CompareGroups, title: "Compare two groups", lesson: "l1-comparing-numbers",
    explain: "Two groups of objects, paired one-to-one by dashed lines. Objects without a partner show how much bigger one group is. The symbol shows the comparison.",
    playground: { left: 6, right: 4, editable: true, showSymbol: true, matching: true } },
  "balance": { component: Balance, title: "Balance scale", lesson: "l1-equal-quantities",
    explain: "A two-pan balance. It tips toward the heavier side and is level only when both sides hold the same amount - the picture behind the equals sign.",
    playground: { left: 5, right: 3, editable: true } },
  "weighing-puzzle": { component: WeighingPuzzle, title: "Weighing puzzle", lesson: "l0-reasoning",
    explain: "Bags whose weights are hidden. Weigh two at a time; reasoning then tells you comparisons you never made directly.",
    playground: { bags: 4, seed: 5 } },
  "fraction": { component: FractionWidget, title: "Fraction pizza", lesson: "l1-fractions",
    explain: "A whole cut into equal parts (the denominator), some of them shaded (the numerator). Try fractions bigger than one whole too.",
    playground: { numerator: 3, denominator: 8, shape: "circle", editable: true, showDecimal: true, showPercent: true } },
  "place-value": { component: PlaceValue, title: "Place-value blocks", lesson: "l1-number-symbols",
    explain: "A number drawn as thousands, hundreds, tens and ones. Each digit says how many blocks of its place there are. Ten of one place regroup into one of the next.",
    playground: { value: 352, editable: true, showExpanded: true } },
  "numeral-systems": { component: NumeralSystems, title: "Many ways to write a number", lesson: "l1-what-is-a-number",
    explain: "One quantity written as dots, tally marks, Roman numerals, our digits and English words. Many names - one number.",
    playground: { value: 12, editable: true } },
  "hundred-grid": { component: HundredGrid, title: "Hundred grid", lesson: "l1-percentages",
    explain: "One whole cut into 100 equal squares. Shading shows the same amount as a fraction out of 100, a decimal and a percentage at once.",
    playground: { shaded: 35, editable: true, mode: "percent" } },
  "ratio-mixer": { component: RatioMixer, title: "Ratio mixer", lesson: "l1-ratios",
    explain: "A recipe of two ingredients in a fixed ratio. Adding whole batches keeps the ratio; adding one of each changes it.",
    playground: { a: 2, b: 3, labelA: "cups of flour", labelB: "eggs", editable: true } },
  "sieve": { component: Sieve, title: "Sieve of Eratosthenes", lesson: "l1-prime-numbers",
    explain: "The numbers 2 to 100. Choose the smallest number not yet crossed out - it is prime - and its multiples are crossed out. What survives is exactly the primes.",
    playground: { max: 100, guided: true } },
  "rectangle-arranger": { component: RectangleArranger, title: "Rectangle arranger", lesson: "l1-factors",
    explain: "Square tiles arranged in equal rows. A perfect rectangle means the number of rows is a factor. Prime numbers only make a single row.",
    playground: { n: 12, rows: 1, editable: true, maxN: 48 } },
  "sharing": { component: Sharing, title: "Fair sharing", lesson: "l1-divisibility",
    explain: "Items dealt out equally into groups. Each group gets the same number; what is left over is the remainder.",
    playground: { items: 17, groups: 5, editable: true } },
  "pairs": { component: Pairs, title: "Pairs: even and odd", lesson: "l1-even-odd",
    explain: "Dots arranged in pairs. Even numbers pair up exactly; odd numbers always leave one dot without a partner.",
    playground: { n: 9, editable: true } },
  "multiples-jumps": { component: MultiplesJumps, title: "Frogs and multiples", lesson: "l1-least-common-multiple",
    explain: "Two frogs jumping along a number line with different jump sizes. Where both land is a common multiple; the first such place is the least common multiple.",
    playground: { a: 4, b: 6, max: 36, editable: true } },
  "common-factors": { component: CommonFactors, title: "Common factors", lesson: "l1-greatest-common-divisor",
    explain: "The factors of two numbers in two overlapping circles. The overlap holds the common factors; the biggest is the greatest common divisor.",
    playground: { a: 24, b: 36, editable: true } },
  "number-sets": { component: NumberSets, title: "Families of numbers", lesson: "l1-integers",
    explain: "Nested regions: natural numbers inside whole numbers inside integers inside fractions. Place each number in the smallest family it belongs to.",
    playground: { numbers: ["7", "0", "-4", "1/2", "-2/3", "15", "0.25"] } },
  "measure": { component: Measure, title: "Measuring with units", lesson: "l0-measurement",
    explain: "An object measured by laying copies of a unit end to end. The number depends on the unit you choose; the object does not change.",
    playground: { length: 8, units: ["paperclip", "finger", "cm"], object: "rope" } },
  "pattern": { component: Pattern, title: "Pattern explorer", lesson: "l0-patterns",
    explain: "Growing patterns of dots. Predict the next stage before revealing it, and read the rule that produces it.",
    playground: { kind: "triangles", terms: 3, editable: true } },
  "rule-machine": { component: RuleMachine, title: "Rule machine", lesson: "l0-rules",
    explain: "A machine following a hidden rule. Feed it numbers, watch what comes out, and work out the rule.",
    playground: { rule: "double-plus-one", hidden: true } },
  "pair-proof": { component: PairProof, title: "Why even + even is even", lesson: "l0-proof",
    explain: "Two even numbers drawn as pairs. However you change them, the total is made of pairs - a reason that covers every case: a proof.",
    playground: { a: 4, b: 6 } },
  "shepherd": { component: Shepherd, title: "The shepherd's pebbles", lesson: "l0-why-mathematics",
    explain: "Matching sheep with pebbles, one each. Leftover pebbles reveal missing sheep - without counting.",
    playground: { sheep: 8, missing: 3 } },
  "math-lenses": { component: MathLenses, title: "Mathematical lenses", lesson: "l0-what-is-mathematics",
    explain: "One staircase of blocks seen through four lenses - quantity, pattern, shape and reasoning.",
    playground: { steps: 5 } },
  "symbol-translator": { component: SymbolTranslator, title: "Words and symbols", lesson: "l0-symbols",
    explain: "Sentences in ordinary words and in mathematical symbols. Tap to switch between them.",
    playground: {} },
  "model": { component: Model, title: "Mathematical model", lesson: "l0-real-world",
    explain: "A real situation described by a starting amount and a repeated amount. Predict, then check with the model.",
    playground: { scenario: "savings" } },
};

export function Widget({ widget, props, goal, onComplete, compact }: {
  widget: string; props?: Record<string, unknown>; goal?: Record<string, unknown> | null;
  onComplete?: (data?: Record<string, unknown>) => void; compact?: boolean;
}) {
  const info = WIDGETS[widget];
  if (!info) return <p className="text-sm text-bad">Unknown visual: {widget}</p>;
  const C = info.component;
  return <C props={props ?? {}} goal={goal} onComplete={onComplete} compact={compact} />;
}

// Keep the plain id list (used by tests) in sync with the registry above.
import { WIDGET_IDS } from "./ids";
if (process.env.NODE_ENV !== "production") {
  const a = [...WIDGET_IDS].sort().join(",");
  const b = Object.keys(WIDGETS).sort().join(",");
  if (a !== b) console.error("widgets/ids.ts and widgets/registry.tsx disagree", { a, b });
}
