/** Use the prerequisite graph to decide what to teach next - a port of backend/app/learning/recommend.py. */
import { KNOWN } from "./mastery";
import type { ContentBundle, LessonNode } from "./types";

export { KNOWN };

/** Python dataclass `Readiness` (snake_case: these names reach the API's JSON). */
export type Readiness = {
  lesson_id: string;
  ready: boolean;
  /** prerequisites (direct or indirect) not yet understood, in teaching order */
  missing: string[];
  direct_missing: string[];
};

/** lesson id -> knowledge state (`not_started`, `introduced`, `understood`, ...). */
export type States = Readonly<Record<string, string>>;

function has(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function isKnown(states: States, lessonId: string): boolean {
  return has(states, lessonId) && KNOWN.has(states[lessonId]);
}

function node(bundle: ContentBundle, lessonId: string): LessonNode {
  if (!has(bundle.nodes, lessonId)) throw new Error(`unknown lesson ${lessonId}`); // Python: KeyError
  return bundle.nodes[lessonId];
}

/**
 * Which earlier concepts does this lesson need that are not yet understood?
 *
 * We walk back through the prerequisite graph but stop at concepts that are already understood: a
 * known concept vouches for its own prerequisites, so the learner is never sent back to repeat
 * material they have shown they know.
 */
export function readiness(bundle: ContentBundle, lessonId: string, states: States): Readiness {
  const direct = node(bundle, lessonId).pre.filter((p) => !isKnown(states, p));
  const missing = new Set<string>();
  const stack = [...direct];
  while (stack.length) {
    const cur = stack.pop() as string;
    if (missing.has(cur)) continue;
    missing.add(cur);
    for (const p of node(bundle, cur).pre) if (!isKnown(states, p)) stack.push(p);
  }
  const ordered = bundle.order.filter((i) => missing.has(i));
  return { lesson_id: lessonId, ready: !direct.length, missing: ordered, direct_missing: direct };
}

/** Available lessons whose prerequisites are all understood, in teaching order. */
export function nextLessons(bundle: ContentBundle, states: States, limit = 3): string[] {
  const out: string[] = [];
  for (const lid of bundle.order) {
    if (!has(bundle.lessons, lid)) continue;
    if (isKnown(states, lid)) continue;
    if (node(bundle, lid).pre.every((p) => isKnown(states, p))) {
      out.push(lid);
      if (out.length >= limit) break;
    }
  }
  return out;
}

/** Planned (not yet written) lessons whose prerequisites are understood. */
export function frontierPlanned(bundle: ContentBundle, states: States, limit = 5): string[] {
  const out: string[] = [];
  for (const lid of bundle.order) {
    if (has(bundle.lessons, lid) || isKnown(states, lid)) continue;
    if (node(bundle, lid).pre.every((p) => isKnown(states, p))) {
      out.push(lid);
      if (out.length >= limit) break;
    }
  }
  return out;
}

export function pathProgress(
  bundle: ContentBundle,
  target: string,
  states: States,
): { total: number; known: number; mastered: number } {
  const chain = [...bundle.ancestors(target), target];
  const known = chain.filter((i) => isKnown(states, i)).length;
  const mastered = chain.filter((i) => has(states, i) && states[i] === "mastered").length;
  return { total: chain.length, known, mastered };
}
