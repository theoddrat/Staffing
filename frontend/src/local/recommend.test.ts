/** Port of the recommendation tests in backend/tests/test_learning.py, plus checks of every rule. */
import { describe, expect, it } from "vitest";
import content from "../../standalone/content.json";
import { KNOWN as MASTERY_KNOWN } from "./mastery";
import { frontierPlanned, KNOWN, nextLessons, pathProgress, readiness } from "./recommend";
import { Random } from "./rng";
import type { ContentBundle, ContentJson, LessonNode } from "./types";

const course = content as unknown as ContentJson;

/** Just enough of a ContentBundle (src/local/content.ts builds the real one), with loader.py's graph walks. */
function testBundle(json: ContentJson): ContentBundle {
  const nodes: Record<string, LessonNode> = Object.fromEntries(json.curriculum.lessons.map((n) => [n.id, n]));
  const walk = (start: string[], next: (id: string) => string[]) => {
    const seen = new Set<string>();
    const stack = [...start];
    while (stack.length) {
      const cur = stack.pop() as string;
      if (seen.has(cur)) continue;
      seen.add(cur);
      stack.push(...next(cur));
    }
    return json.order.filter((i) => seen.has(i));
  };
  const unused = () => {
    throw new Error("not needed by these tests");
  };
  return {
    json,
    stages: Object.fromEntries(json.curriculum.stages.map((s) => [s.id, s])),
    nodes,
    lessons: json.lessons,
    terms: json.terms,
    widgets: json.widgets,
    order: json.order,
    children: json.children,
    feeds: json.feeds,
    ancestors: (id) => walk(nodes[id].pre, (c) => nodes[c].pre),
    descendants: (id) => walk(json.children[id] ?? [], (c) => json.children[c] ?? []),
    isAvailable: (id) => id in json.lessons,
    termIndex: unused,
    findTerms: unused,
  };
}

const bundle = testBundle(course);
const allIds = course.order;
const written = (id: string) => id in course.lessons;

describe("recommendations (test_learning.py)", () => {
  it("first recommendation is what is mathematics", () => {
    expect(nextLessons(bundle, {}, 1)).toEqual(["l0-what-is-mathematics"]);
  });

  it("recommendations follow prerequisites", () => {
    const states = { "l0-what-is-mathematics": "understood" };
    expect(nextLessons(bundle, states, 1)).toEqual(["l0-why-mathematics"]);
  });

  it("readiness stops at known concepts", () => {
    let r = readiness(bundle, "l1-fractions", {});
    expect(r.ready).toBe(false);
    expect(r.missing[0]).toBe("l0-what-is-mathematics");
    const known = Object.fromEntries(bundle.ancestors("l1-fractions").map((lid) => [lid, "understood"]));
    expect(readiness(bundle, "l1-fractions", known).ready).toBe(true);
    // if a direct prerequisite is known, we never send the learner further back through it
    const states = { "l1-equal-quantities": "mastered", "l1-number-lines": "understood" };
    r = readiness(bundle, "l1-fractions", states);
    expect(r.ready).toBe(true);
    expect(r.missing).toEqual([]);
  });

  it("path progress", () => {
    const pp = pathProgress(bundle, "pb-research", { "l0-what-is-mathematics": "mastered" });
    expect(pp.known).toBe(1);
    expect(pp.mastered).toBe(1);
    expect(pp.total).toBeGreaterThan(200);
  });
});

describe("readiness", () => {
  it("has the Python dataclass's fields, in order", () => {
    const r = readiness(bundle, "l1-fractions", {});
    expect(Object.keys(r)).toEqual(["lesson_id", "ready", "missing", "direct_missing"]);
    expect(r.lesson_id).toBe("l1-fractions");
    expect(r.direct_missing).toEqual(bundle.nodes["l1-fractions"].pre);
    // with nothing known, everything before the lesson is missing, in teaching order
    expect(r.missing).toEqual(bundle.ancestors("l1-fractions"));
  });

  it("is ready at once for a lesson without prerequisites", () => {
    const first = allIds.find((id) => !bundle.nodes[id].pre.length) as string;
    expect(readiness(bundle, first, {})).toEqual({ lesson_id: first, ready: true, missing: [], direct_missing: [] });
  });

  it("counts only understood and mastered as known", () => {
    const pre = bundle.nodes["l0-why-mathematics"].pre;
    expect(pre.length).toBeGreaterThan(0);
    for (const st of ["not_started", "introduced", "needs_revision", "something-else"]) {
      const states = Object.fromEntries(pre.map((p) => [p, st]));
      expect(readiness(bundle, "l0-why-mathematics", states).direct_missing).toEqual(pre);
    }
    for (const st of ["understood", "mastered"]) {
      const states = Object.fromEntries(pre.map((p) => [p, st]));
      expect(readiness(bundle, "l0-why-mathematics", states).ready).toBe(true);
    }
  });

  it("throws for an unknown lesson (Python: KeyError)", () => {
    expect(() => readiness(bundle, "no-such-lesson", {})).toThrow("no-such-lesson");
  });

  it("agrees with a naive reference on random learners", () => {
    const rng = new Random(7);
    const pick = ["understood", "mastered", "introduced", "needs_revision"];
    for (let trial = 0; trial < 60; trial++) {
      const p = rng.random();
      const states: Record<string, string> = {};
      for (const id of allIds) if (rng.random() < p) states[id] = rng.choice(pick);
      const known = (id: string) => KNOWN.has(states[id]);
      for (const lid of rng.sample(allIds, 15)) {
        // reference: everything reachable backwards through concepts that are not known
        const reach = new Set<string>();
        const visit = (id: string) => {
          for (const q of bundle.nodes[id].pre) {
            if (!known(q) && !reach.has(q)) {
              reach.add(q);
              visit(q);
            }
          }
        };
        visit(lid);
        const r = readiness(bundle, lid, states);
        expect(r.direct_missing).toEqual(bundle.nodes[lid].pre.filter((q) => !known(q)));
        expect(r.ready).toBe(r.direct_missing.length === 0);
        expect(r.missing).toEqual(allIds.filter((id) => reach.has(id)));
      }
      const ready = allIds.filter((id) => !known(id) && bundle.nodes[id].pre.every(known));
      expect(nextLessons(bundle, states, 4)).toEqual(ready.filter(written).slice(0, 4));
      expect(frontierPlanned(bundle, states, 6)).toEqual(ready.filter((id) => !written(id)).slice(0, 6));
    }
  });
});

describe("next lessons and the planned frontier", () => {
  it("offers only written lessons, in teaching order, up to the limit (default 3)", () => {
    const out = nextLessons(bundle, {});
    expect(out.length).toBeLessThanOrEqual(3);
    expect(out.every(written)).toBe(true);
    const all = nextLessons(bundle, {}, 1000);
    expect(out).toEqual(all.slice(0, 3));
    expect(all.map((id) => allIds.indexOf(id))).toEqual([...all.map((id) => allIds.indexOf(id))].sort((a, b) => a - b));
  });

  it("skips lessons already known", () => {
    const states = { "l0-what-is-mathematics": "mastered" };
    expect(nextLessons(bundle, states, 1000)).not.toContain("l0-what-is-mathematics");
  });

  it("stops after the first lesson found when the limit is 0, like the Python loop", () => {
    expect(nextLessons(bundle, {}, 0)).toEqual(["l0-what-is-mathematics"]);
  });

  it("lists planned lessons once everything written is understood (default limit 5)", () => {
    const states = Object.fromEntries(Object.keys(course.lessons).map((id) => [id, "understood"]));
    expect(nextLessons(bundle, states)).toEqual([]);
    const planned = frontierPlanned(bundle, states);
    expect(planned.length).toBeGreaterThan(0);
    expect(planned.length).toBeLessThanOrEqual(5);
    for (const id of planned) {
      expect(written(id)).toBe(false);
      expect(bundle.nodes[id].pre.every((p) => written(p))).toBe(true);
    }
    expect(frontierPlanned(bundle, states, 1000).slice(0, 5)).toEqual(planned);
  });

  it("does not list planned lessons that are already marked known", () => {
    const states = Object.fromEntries(Object.keys(course.lessons).map((id) => [id, "understood"]));
    const [first] = frontierPlanned(bundle, states, 1);
    expect(frontierPlanned(bundle, { ...states, [first]: "mastered" }, 1000)).not.toContain(first);
  });
});

describe("path progress", () => {
  it("counts the whole chain to the target and what is known and mastered", () => {
    for (const target of ["pa-research", "pb-research"]) {
      const chain = [...bundle.ancestors(target), target];
      expect(pathProgress(bundle, target, {})).toEqual({ total: chain.length, known: 0, mastered: 0 });
      const states = { [chain[0]]: "understood", [chain[1]]: "mastered", [chain[2]]: "introduced", [target]: "mastered" };
      expect(pathProgress(bundle, target, states)).toEqual({ total: chain.length, known: 3, mastered: 2 });
    }
  });

  it("re-exports KNOWN from mastery", () => {
    expect(KNOWN).toBe(MASTERY_KNOWN);
  });
});
