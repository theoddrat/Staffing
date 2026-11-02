import { describe, expect, it } from "vitest";
import { autoLink, buildLinkIndex, looksLikeMath, parseBlocks, parseInline, plainText } from "./richtext";

describe("parseInline", () => {
  it("parses math, links, bold and italic", () => {
    const n = parseInline("A **[[fraction|fraction]]** like $\\tfrac{3}{8}$ is *useful*; see [[lesson:l1-zero|zero]].");
    expect(n.map((x) => x.type)).toEqual(["text", "bold", "text", "math", "text", "italic", "text", "lesson", "text"]);
    const bold = n[1] as { type: "bold"; children: { type: string; id?: string }[] };
    expect(bold.children[0]).toMatchObject({ type: "term", id: "fraction" });
    expect(n[3]).toMatchObject({ type: "math", tex: "\\tfrac{3}{8}" });
    expect(n[7]).toMatchObject({ type: "lesson", id: "l1-zero", label: "zero" });
  });

  it("keeps escaped and unmatched dollar signs as text", () => {
    expect(plainText(parseInline("It costs \\$5 and \\$6"))).toBe("It costs $5 and $6");
    expect(parseInline("a lone $ sign")).toEqual([{ type: "text", text: "a lone $ sign" }]);
  });

  it("handles inline display math and italics around math", () => {
    const n = parseInline("before $$x^2$$ after");
    expect(n[1]).toMatchObject({ type: "math", tex: "x^2", display: true });
    const it2 = parseInline("*the slash in $\\notin$ means not*");
    expect(it2[0].type).toBe("italic");
  });

  it("does not treat a multiplication-like star as italics", () => {
    expect(parseInline("2 * 3 = 6").every((x) => x.type === "text")).toBe(true);
  });
});

describe("parseBlocks", () => {
  it("splits paragraphs, lists, headings and display math", () => {
    const b = parseBlocks("First para\ncontinues.\n\n- one\n- two\n  wraps\n\n1. a\n2. b\n\n### Head\n\n$$x + 1$$");
    expect(b.map((x) => x.type)).toEqual(["p", "ul", "ol", "h3", "math"]);
    const ul = b[1] as { type: "ul"; items: unknown[][] };
    expect(ul.items).toHaveLength(2);
    expect(plainText(ul.items[1] as never)).toBe("two wraps");
  });

  it("starts a list right after a paragraph line", () => {
    const b = parseBlocks("Rules:\n- a\n- b");
    expect(b.map((x) => x.type)).toEqual(["p", "ul"]);
  });
});

describe("autoLink", () => {
  const index = buildLinkIndex([
    { id: "prime-number", link_forms: ["prime number", "prime numbers", "prime", "primes"] },
    { id: "fraction", link_forms: ["fraction", "fractions"] },
  ]);
  it("links the first occurrence of each term, longest form first", () => {
    const linked = new Set<string>();
    const out = autoLink(parseInline("Prime numbers and primes; a fraction."), index, linked);
    const terms = out.filter((x) => x.type === "term");
    expect(terms).toHaveLength(2);
    expect(terms[0]).toMatchObject({ id: "prime-number", label: "Prime numbers" });
    expect(terms[1]).toMatchObject({ id: "fraction" });
  });
  it("respects word boundaries and skips math", () => {
    const out = autoLink(parseInline("fractional $fraction$"), index, new Set());
    expect(out.some((x) => x.type === "term")).toBe(false);
  });
  it("never links a term twice across one rendering", () => {
    const linked = new Set<string>();
    autoLink(parseInline("a fraction"), index, linked);
    const second = autoLink(parseInline("another fraction"), index, linked);
    expect(second.some((x) => x.type === "term")).toBe(false);
  });
});

describe("looksLikeMath", () => {
  it.each([["b \\neq 0", true], ["x", true], ["a, b", true], ["n + 1", true], ["-a", true], ["collection", false],
    ["some integer k", false], ["only 1 and p", false], ["0, 1, 2, 3, ...", false]])("%s -> %s", (s, v) => {
    expect(looksLikeMath(s as string)).toBe(v);
  });
});
