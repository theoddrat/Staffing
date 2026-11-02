// Checks the repository's content files from the frontend's point of view:
// every widget exists, and every piece of LaTeX renders in KaTeX.
import fs from "node:fs";
import path from "node:path";
import katex from "katex";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { WIDGET_IDS } from "../widgets/ids";
import { looksLikeMath, parseBlocks, type Block, type Inline } from "./richtext";

const ROOT = path.resolve(__dirname, "../../../content");

function yamlFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? yamlFiles(path.join(dir, e.name)) : e.name.endsWith(".yaml") ? [path.join(dir, e.name)] : [],
  );
}

function mathIn(nodes: Inline[]): string[] {
  return nodes.flatMap((n) => (n.type === "math" ? [n.tex] : n.type === "bold" || n.type === "italic" ? mathIn(n.children) : []));
}
function mathInBlocks(blocks: Block[]): string[] {
  return blocks.flatMap((b) => (b.type === "math" ? [b.tex] : b.type === "ul" || b.type === "ol" ? b.items.flatMap(mathIn) : mathIn(b.children)));
}

// Fields whose value is raw LaTeX rather than rich text
const RAW_TEX_KEYS = new Set(["symbol", "expression", "symbols"]);

function collect(obj: unknown, key: string | null, out: { tex: string; where: string }[], where: string) {
  if (typeof obj === "string") {
    if (key && RAW_TEX_KEYS.has(key)) out.push({ tex: obj, where });
    else if (key === "word" && looksLikeMath(obj)) out.push({ tex: obj, where });
    else for (const tex of mathInBlocks(parseBlocks(obj))) out.push({ tex, where });
  } else if (Array.isArray(obj)) obj.forEach((v, i) => collect(v, key, out, `${where}[${i}]`));
  else if (obj && typeof obj === "object") for (const [k, v] of Object.entries(obj)) collect(v, k, out, `${where}.${k}`);
}

describe("content", () => {
  const files = yamlFiles(path.join(ROOT, "lessons")).concat(yamlFiles(path.join(ROOT, "dictionary")));

  it("finds the content files", () => {
    expect(files.length).toBeGreaterThan(40);
  });

  it("the frontend implements every widget in the registry", () => {
    const reg = parse(fs.readFileSync(path.join(ROOT, "widgets.yaml"), "utf8")) as { widgets: { id: string }[] };
    expect([...WIDGET_IDS].sort()).toEqual(reg.widgets.map((w) => w.id).sort());
  });

  it("every piece of LaTeX renders in KaTeX", () => {
    const failures: string[] = [];
    let count = 0;
    for (const f of files) {
      const out: { tex: string; where: string }[] = [];
      collect(parse(fs.readFileSync(f, "utf8")), null, out, path.basename(f));
      for (const { tex, where } of out) {
        count++;
        try {
          katex.renderToString(tex, { throwOnError: true, strict: "error" });
        } catch (e) {
          failures.push(`${where}: ${tex} -> ${(e as Error).message}`);
        }
      }
    }
    expect(count).toBeGreaterThan(200);
    expect(failures).toEqual([]);
  });
});
