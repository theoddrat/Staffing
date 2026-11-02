// A small, dependency-free parser for the markup used in lesson content and
// tutor replies:
//   $inline math$   $$display math$$   **bold**   *italic*
//   [[term-id]]  [[term-id|shown words]]  [[lesson:lesson-id|shown words]]
//   blank-line paragraphs, "- " bullet lists, "1. " numbered lists, "### " headings
//   \$ for a literal dollar sign

export type Inline =
  | { type: "text"; text: string }
  | { type: "math"; tex: string; display?: boolean }
  | { type: "bold"; children: Inline[] }
  | { type: "italic"; children: Inline[] }
  | { type: "term"; id: string; label: string; auto?: boolean }
  | { type: "lesson"; id: string; label: string };

export type Block =
  | { type: "p"; children: Inline[] }
  | { type: "h3"; children: Inline[] }
  | { type: "ul"; items: Inline[][] }
  | { type: "ol"; items: Inline[][] }
  | { type: "math"; tex: string };

const BULLET = /^\s*[-*]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;

export function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: { kind: "ul" | "ol"; items: string[] } | null = null;

  const flushPara = () => {
    if (para.length) {
      const text = para.join(" ").trim();
      if (text.startsWith("$$") && text.endsWith("$$") && text.length > 4 && !text.slice(2, -2).includes("$$")) {
        blocks.push({ type: "math", tex: text.slice(2, -2).trim() });
      } else if (text) {
        blocks.push({ type: "p", children: parseInline(text) });
      }
      para = [];
    }
  };
  const flushList = () => {
    if (list) {
      blocks.push({ type: list.kind, items: list.items.map((i) => parseInline(i.trim())) });
      list = null;
    }
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }
    const b = BULLET.exec(line);
    const n = b ? null : NUMBERED.exec(line);
    if (b || n) {
      flushPara();
      const kind = b ? "ul" : "ol";
      if (!list || list.kind !== kind) {
        flushList();
        list = { kind, items: [] };
      }
      list.items.push((b ?? n)![1]);
      continue;
    }
    if (list && /^\s{2,}\S/.test(raw)) {
      // continuation of the previous list item
      list.items[list.items.length - 1] += " " + line.trim();
      continue;
    }
    flushList();
    if (line.startsWith("### ")) {
      flushPara();
      blocks.push({ type: "h3", children: parseInline(line.slice(4)) });
      continue;
    }
    para.push(line.trim());
  }
  flushPara();
  flushList();
  return blocks;
}

/** Parse inline markup. Unmatched markers are kept as plain text. */
export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let buf = "";
  const pushText = () => {
    if (buf) {
      out.push({ type: "text", text: buf });
      buf = "";
    }
  };
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "\\" && src[i + 1] === "$") {
      buf += "$";
      i += 2;
      continue;
    }
    if (c === "$") {
      const display = src[i + 1] === "$";
      const open = display ? 2 : 1;
      const close = findClosingDollar(src, i + open, display);
      if (close !== -1) {
        pushText();
        out.push({ type: "math", tex: src.slice(i + open, close).trim(), display });
        i = close + open;
        continue;
      }
    }
    if (c === "[" && src[i + 1] === "[") {
      const end = src.indexOf("]]", i + 2);
      if (end !== -1) {
        const inner = src.slice(i + 2, end);
        const bar = inner.indexOf("|");
        const target = (bar === -1 ? inner : inner.slice(0, bar)).trim();
        const label = bar === -1 ? "" : inner.slice(bar + 1);
        pushText();
        if (target.startsWith("lesson:")) {
          out.push({ type: "lesson", id: target.slice(7), label: label || target.slice(7) });
        } else {
          out.push({ type: "term", id: target, label: label || target.replace(/-/g, " ") });
        }
        i = end + 2;
        continue;
      }
    }
    if (c === "*" && src[i + 1] === "*") {
      const end = src.indexOf("**", i + 2);
      if (end > i + 2) {
        pushText();
        out.push({ type: "bold", children: parseInline(src.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }
    if (c === "*" && src[i + 1] !== "*" && src[i + 1] !== " ") {
      const end = findClosingStar(src, i + 1);
      if (end !== -1) {
        pushText();
        out.push({ type: "italic", children: parseInline(src.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }
    buf += c;
    i++;
  }
  pushText();
  return out;
}

function findClosingDollar(src: string, from: number, display: boolean): number {
  for (let j = from; j < src.length; j++) {
    if (src[j] === "\\") {
      j++;
      continue;
    }
    if (src[j] === "$") {
      if (display) return src[j + 1] === "$" ? j : -1;
      return j > from ? j : -1;
    }
  }
  return -1;
}

function findClosingStar(src: string, from: number): number {
  for (let j = from; j < src.length; j++) {
    if (src[j] === "*" && src[j + 1] !== "*" && src[j - 1] !== " " && src[j - 1] !== "*") return j;
    if (src[j] === "$") {
      const close = findClosingDollar(src, j + 1, false);
      if (close !== -1) j = close;
    }
  }
  return -1;
}

// ------------------------------------------------------------------ automatic term linking

export type LinkIndex = { regex: RegExp | null; lookup: Map<string, string> };

export function buildLinkIndex(terms: { id: string; link_forms: string[] }[]): LinkIndex {
  const pairs: [string, string][] = [];
  for (const t of terms) for (const f of t.link_forms) pairs.push([f, t.id]);
  pairs.sort((a, b) => b[0].length - a[0].length);
  if (!pairs.length) return { regex: null, lookup: new Map() };
  const escaped = pairs.map(([f]) => f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return {
    regex: new RegExp(`(?<![\\w-])(${escaped.join("|")})(?![\\w-])`, "gi"),
    lookup: new Map(pairs.map(([f, id]) => [f.toLowerCase(), id])),
  };
}

/**
 * Link the first occurrence of each dictionary term in plain text nodes.
 * `linked` is shared across a whole rendering so each term is linked once.
 */
export function autoLink(nodes: Inline[], index: LinkIndex, linked: Set<string>, exclude?: Set<string>): Inline[] {
  if (!index.regex) return nodes;
  const out: Inline[] = [];
  for (const node of nodes) {
    if (node.type === "term") {
      linked.add(node.id);
      out.push(node);
    } else if (node.type === "bold" || node.type === "italic") {
      out.push({ ...node, children: autoLink(node.children, index, linked, exclude) });
    } else if (node.type === "text") {
      const text = node.text;
      let last = 0;
      index.regex.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = index.regex.exec(text))) {
        const id = index.lookup.get(m[1].toLowerCase());
        if (!id || linked.has(id) || exclude?.has(id)) continue;
        linked.add(id);
        if (m.index > last) out.push({ type: "text", text: text.slice(last, m.index) });
        out.push({ type: "term", id, label: m[1], auto: true });
        last = m.index + m[1].length;
      }
      if (last < text.length) out.push({ type: "text", text: text.slice(last) });
    } else {
      out.push(node);
    }
  }
  return out;
}

/** Plain text of inline nodes (for aria labels and tests). */
export function plainText(nodes: Inline[]): string {
  return nodes
    .map((n) => {
      switch (n.type) {
        case "text":
          return n.text;
        case "math":
          return n.tex;
        case "bold":
        case "italic":
          return plainText(n.children);
        default:
          return n.label;
      }
    })
    .join("");
}

/** Glossary entries mix plain words ("collection") with bits of notation ("b \neq 0"). */
export function looksLikeMath(s: string): boolean {
  const t = s.trim();
  if (t.includes("$")) return false;
  if (t.includes("\\")) return true;
  if (/^-?[a-zA-Z](\s*,\s*-?[a-zA-Z])*$/.test(t)) return true; // "x", "a, b", "-a"
  const longWords = t.match(/[a-zA-Z]{3,}/g) ?? [];
  return /[=<>+^]/.test(t) && longWords.length === 0;
}
