/**
 * The course content as a `ContentBundle`: a port of the bundle helpers in
 * backend/app/content/loader.py. The content itself was validated by the backend's loader before
 * it was exported to frontend/standalone/content.json, so nothing is re-validated here.
 */
import type { ContentBundle, ContentJson, LessonNode, Stage, Term } from "./types";

/** `LINK_RE` from loader.py: `[[target]]` or `[[target|shown words]]`. Use with matchAll / replace. */
export const LINK_RE = /\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g;

/**
 * Everyday words that are also dictionary terms (loader.py AUTOLINK_STOPWORDS). They are linked
 * only when the author writes an explicit [[term]] link, never automatically. content.json carries
 * the backend's list as `autolink_stopwords`; this copy is the default for `linkForms`.
 */
export const AUTOLINK_STOPWORDS: ReadonlySet<string> = new Set([
  "number", "numbers", "count", "counts", "counted", "counting", "add", "adding", "added", "plus", "times", "set",
  "sets", "model", "models", "even", "odd", "unit", "units", "equal", "equals", "equal to", "equality", "measure",
  "measuring", "measured", "compare", "comparing", "compared", "reason", "rule", "rules", "element", "elements",
  "divide", "divides", "product", "multiply", "multiplied", "positive", "negative", "negatives", "math", "maths",
  "amount", "amounts", "conclude", "define", "defined", "prove", "proved", "proving", "belongs to", "nought",
  "divisor", "divisors",
]);

/** Length in code points, like Python's `len(str)`. */
function pyLen(s: string): number {
  return [...s].length;
}

/**
 * Surface forms of a term that may be linked automatically in prose (loader.py `link_forms`).
 * content.json already holds the result as `term.link_forms`; this is kept for parity and tests.
 */
export function linkForms(term: Pick<Term, "word" | "aliases">, stopwords: Iterable<string> = AUTOLINK_STOPWORDS): string[] {
  const stop = stopwords instanceof Set ? (stopwords as Set<string>) : new Set(stopwords);
  const forms = [term.word.split(" (")[0], ...(term.aliases ?? [])];
  const out: string[] = [];
  for (const f of forms) {
    if (stop.has(f.toLowerCase()) || pyLen(f) < 3) continue;
    if (!out.includes(f)) out.push(f);
  }
  return out;
}

/** Python's `re.escape` for a form placed in a `u`-mode JavaScript pattern. */
function escapeForm(s: string): string {
  return s.replace(/[\\^$.*+?()[\]{}|/]/g, "\\$&");
}

/** Python's Unicode `\w` (str.isalnum() or "_"), plus "-": the characters a term may not touch. */
const WORDISH = "[\\p{L}\\p{N}_-]";

/** Maths ($$..$$, $..$) and explicit [[links]] are not prose (loader.py `find_terms`). */
const NOT_PROSE = /\$\$[\s\S]*?\$\$|\$[^$]*\$|\[\[[^\]]*\]\]/g;

/**
 * A dictionary without a prototype, so that looking up an id that came from a URL ("constructor",
 * "__proto__", ...) finds nothing instead of an Object.prototype member - like a Python dict.
 */
function dict<V>(entries: Iterable<[string, V]>): Record<string, V> {
  const out = Object.create(null) as Record<string, V>;
  for (const [k, v] of entries) out[k] = v;
  return out;
}

export function loadBundle(json: ContentJson): ContentBundle {
  const stages = dict(json.curriculum.stages.map((s): [string, Stage] => [s.id, s]));
  const nodes = dict(json.curriculum.lessons.map((n): [string, LessonNode] => [n.id, n]));
  const lessons = dict(Object.entries(json.lessons));
  const terms = dict(Object.entries(json.terms));
  const children = dict(Object.entries(json.children));
  const order = json.order;

  let index: [string, string][] | null = null;
  let finder: { rx: RegExp; lookup: Map<string, string> } | null = null;

  const inOrder = (seen: Set<string>) => order.filter((i) => seen.has(i));

  const bundle: ContentBundle = {
    json,
    stages,
    nodes,
    lessons,
    terms,
    widgets: dict(Object.entries(json.widgets)),
    order,
    children,
    feeds: dict(Object.entries(json.feeds)),

    ancestors(lessonId: string): string[] {
      const seen = new Set<string>();
      const stack = [...(nodes[lessonId]?.pre ?? [])];
      while (stack.length) {
        const cur = stack.pop()!;
        if (seen.has(cur)) continue;
        seen.add(cur);
        stack.push(...(nodes[cur]?.pre ?? []));
      }
      return inOrder(seen);
    },

    descendants(lessonId: string): string[] {
      const seen = new Set<string>();
      const stack = [...(children[lessonId] ?? [])];
      while (stack.length) {
        const cur = stack.pop()!;
        if (seen.has(cur)) continue;
        seen.add(cur);
        stack.push(...(children[cur] ?? []));
      }
      return inOrder(seen);
    },

    isAvailable(lessonId: string): boolean {
      return lessonId in lessons;
    },

    termIndex(): [string, string][] {
      if (!index) {
        const pairs: [string, string][] = [];
        for (const t of Object.values(terms)) for (const f of t.link_forms ?? linkForms(t)) pairs.push([f, t.id]);
        // Array.prototype.sort is stable, like Python's list.sort.
        pairs.sort((a, b) => pyLen(b[0]) - pyLen(a[0]));
        index = pairs;
      }
      return index.map((p) => [p[0], p[1]] as [string, string]);
    },

    findTerms(text: string): string[] {
      if (!finder) {
        const forms = bundle.termIndex();
        const lookup = new Map<string, string>();
        for (const [f, tid] of forms) lookup.set(f.toLowerCase(), tid);
        const alternatives = forms.map(([f]) => escapeForm(f)).join("|");
        const rx = new RegExp(`(?<!${WORDISH})(${alternatives})(?!${WORDISH})`, "giu");
        finder = { rx, lookup };
      }
      if (!finder.lookup.size) return [];
      const prose = text.replace(NOT_PROSE, " ");
      const found: string[] = [];
      for (const m of prose.matchAll(finder.rx)) {
        const tid = finder.lookup.get(m[1].toLowerCase());
        if (tid && !found.includes(tid)) found.push(tid);
      }
      return found;
    },
  };
  return bundle;
}

/**
 * Every string inside a content object, in field order, with its location - loader.py
 * `iter_strings`. content.json was written with pydantic's `model_dump`, so the key order of each
 * object is the model's field order, exactly what the Python walks.
 */
export function* iterStrings(obj: unknown, prefix = ""): Generator<[string, string]> {
  if (typeof obj === "string") {
    yield [prefix, obj];
  } else if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) yield* iterStrings(obj[i], `${prefix}[${i}]`);
  } else if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) yield* iterStrings(v, prefix ? `${prefix}.${k}` : k);
  }
}
