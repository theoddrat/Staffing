import { describe, expect, it } from "vitest";
import content from "../../standalone/content.json";
import { AUTOLINK_STOPWORDS, iterStrings, linkForms, loadBundle } from "./content";
import { lessonTerms } from "./service";
import type { ContentJson } from "./types";

const CONTENT = content as unknown as ContentJson;
const bundle = loadBundle(CONTENT);
const MILESTONE_STAGES = ["L0", "L1"];

describe("loadBundle (backend/app/content/loader.py ContentBundle)", () => {
  it("holds the whole course", () => {
    expect(Object.keys(bundle.nodes).length).toBeGreaterThan(300);
    expect(Object.keys(bundle.terms).length).toBeGreaterThanOrEqual(60);
    expect(Object.keys(bundle.lessons).length).toBeGreaterThanOrEqual(41);
    expect(Object.keys(bundle.stages)).toEqual(CONTENT.curriculum.stages.map((s) => s.id));
    expect(bundle.order).toHaveLength(Object.keys(bundle.nodes).length);
    expect(bundle.json).toBe(CONTENT);
  });

  it("knows which lessons are written", () => {
    expect(bundle.isAvailable("l0-counting")).toBe(true);
    expect(bundle.isAvailable("pb-critical-line")).toBe(false);
    expect(bundle.isAvailable("no-such-lesson")).toBe(false);
  });

  it("never finds Object.prototype members by id", () => {
    for (const key of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
      expect(key in bundle.nodes).toBe(false);
      expect(bundle.lessons[key]).toBeUndefined();
      expect(bundle.terms[key]).toBeUndefined();
      expect(bundle.children[key]).toBeUndefined();
      expect(bundle.isAvailable(key)).toBe(false);
      expect(bundle.ancestors(key)).toEqual([]);
      expect(bundle.descendants(key)).toEqual([]);
    }
  });

  it("orders the graph so prerequisites come first", () => {
    const pos = new Map(bundle.order.map((id, i) => [id, i]));
    for (const n of Object.values(bundle.nodes)) for (const p of n.pre) expect(pos.get(p)!).toBeLessThan(pos.get(n.id)!);
  });

  it("lists ancestors in teaching order (as the Python does)", () => {
    expect(bundle.ancestors("l1-fractions")).toEqual([
      "l0-what-is-mathematics", "l0-why-mathematics", "l0-counting", "l0-quantity", "l0-comparison", "l0-patterns", "l0-rules",
      "l0-symbols", "l1-what-is-a-number", "l1-counting-meaning", "l1-zero", "l1-one-two-three", "l1-counting-objects",
      "l1-comparing-numbers", "l1-bigger-smaller", "l1-equal-quantities", "l1-number-symbols", "l1-number-lines",
    ]);
    expect(bundle.ancestors("l0-what-is-mathematics")).toEqual([]);
    for (const target of ["pa-research", "pb-research"]) {
      const anc = bundle.ancestors(target);
      expect(anc).toContain("l0-what-is-mathematics");
      expect(anc).toContain("l1-what-is-a-number");
    }
  });

  it("lists descendants in teaching order, the inverse of ancestors", () => {
    expect(bundle.descendants("l1-fractions").slice(0, 8)).toEqual([
      "l1-numerators-denominators", "l1-decimals", "l1-percentages", "l1-ratios", "l2-fraction-arithmetic", "l2-estimation",
      "l2-mental-arithmetic", "l3-fraction-bar",
    ]);
    const pos = new Map(bundle.order.map((id, i) => [id, i]));
    for (const lid of ["l0-counting", "l1-fractions", "l1-prime-numbers"]) {
      const desc = bundle.descendants(lid);
      expect(desc.map((d) => pos.get(d)!)).toEqual([...desc.map((d) => pos.get(d)!)].sort((a, b) => a - b));
      for (const d of desc) expect(bundle.ancestors(d)).toContain(lid);
    }
  });

  it("has every prerequisite of a written L0/L1 lesson written (no missing rung)", () => {
    for (const lid of Object.keys(bundle.lessons)) {
      if (MILESTONE_STAGES.includes(bundle.nodes[lid].stage)) {
        expect(bundle.ancestors(lid).filter((a) => !bundle.isAvailable(a)), lid).toEqual([]);
      }
    }
  });
});

describe("linkForms and termIndex", () => {
  it("computes the same link forms as the backend exported", () => {
    expect([...AUTOLINK_STOPWORDS].sort()).toEqual([...CONTENT.autolink_stopwords].sort());
    for (const t of Object.values(CONTENT.terms)) expect(linkForms(t), t.id).toEqual(t.link_forms);
  });

  it("skips stopwords, short forms and duplicates", () => {
    expect(linkForms({ word: "set (collection)", aliases: ["sets", "ab", "Collection", "collection", "collection"] })).toEqual(["Collection", "collection"]);
    expect(linkForms({ word: "number", aliases: [] })).toEqual([]);
    expect(linkForms({ word: "odd", aliases: ["odd numbers"] }, [])).toEqual(["odd", "odd numbers"]);
  });

  it("indexes every form, longest first, keeping dictionary order among equals", () => {
    const index = bundle.termIndex();
    expect(index.slice(0, 3)).toEqual([
      ["one-to-one correspondences", "one-to-one-correspondence"],
      ["one-to-one correspondence", "one-to-one-correspondence"],
      ["greatest common divisors", "greatest-common-divisor"],
    ]);
    const all = Object.values(CONTENT.terms).flatMap((t) => t.link_forms.map((f) => [f, t.id]));
    expect(index).toHaveLength(all.length);
    expect([...index].sort()).toEqual([...all].sort());
    for (let i = 1; i < index.length; i++) {
      const [a, b] = [[...index[i - 1][0]].length, [...index[i][0]].length];
      expect(a).toBeGreaterThanOrEqual(b);
      if (a === b) expect(all.findIndex((p) => p[0] === index[i - 1][0])).toBeLessThan(all.findIndex((p) => p[0] === index[i][0]));
    }
    index.pop(); // a copy: changing it does not change the bundle
    expect(bundle.termIndex()).toHaveLength(all.length);
  });
});

describe("findTerms (loader.py find_terms)", () => {
  it("finds dictionary words in prose (test_term_discovery_finds_words_in_prose)", () => {
    const found = bundle.findTerms("A fraction has a numerator and a denominator, and $\\tfrac{1}{2}$ is not a link.");
    expect(found).toEqual(["fraction", "numerator", "denominator"]);
    expect(bundle.findTerms("I counted a set of numbers")).toEqual([]); // everyday words are not auto-linked
  });

  it("ignores maths and explicit links, matches any case, reports each term once in first-mention order", () => {
    const text = "Primes, PRIME NUMBERS and a non-prime; [[prime-number|prime]] and $prime$ and $$fraction$$ then fractions, Fraction.";
    expect(bundle.findTerms(text)).toEqual(["prime-number", "fraction"]);
    expect(bundle.findTerms("$$a\nfraction\n$$ and $numerator$")).toEqual([]);
    expect(bundle.findTerms("denominators before a numerator")).toEqual(["denominator", "numerator"]);
  });

  it("matches whole forms only: no letters, digits, '_' or '-' on either side", () => {
    expect(bundle.findTerms("non-prime prime_x xprime prime2 éprime primeé")).toEqual([]);
    expect(bundle.findTerms("(prime)")).toEqual(["prime-number"]);
    expect(bundle.findTerms("prime.")).toEqual(["prime-number"]);
    expect(bundle.findTerms("a one-to-one correspondence")).toEqual(["one-to-one-correspondence"]);
  });

  it("gives the backend's lesson terms (service.lesson_terms)", () => {
    expect(lessonTerms(bundle, "l0-counting")).toEqual(["counting", "symbol", "definition", "one-to-one-correspondence", "quantity", "cardinality"]);
    expect(lessonTerms(bundle, "l1-fractions")).toEqual([
      "fraction", "rational-number", "number-line", "quantity", "whole-number", "integer", "infinite", "less-than", "ratio",
      "definition", "zero", "equal", "numerator", "denominator", "place-value",
    ]);
    expect(lessonTerms(bundle, "pb-critical-line")).toEqual([]);
  });

  it("walks a lesson's strings in field order", () => {
    const lesson = bundle.lessons["l0-counting"];
    const strings = [...iterStrings(lesson)];
    expect(strings[0]).toEqual(["id", "l0-counting"]);
    expect(strings[1]).toEqual(["goal", lesson.goal]);
    expect(strings.some(([loc]) => loc.startsWith("assessment.questions[0]"))).toBe(true);
  });
});
