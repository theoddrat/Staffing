/**
 * Operations on the learner model and learning history - a port of backend/app/learning/service.py
 * on top of the JSON tables in store.ts. Every function that writes must run inside
 * `store.transaction()` (the API routes do), exactly as the Python functions run inside a session
 * that the route commits.
 */
import { LINK_RE, iterStrings } from "./content";
import * as mastery from "./mastery";
import type { ConceptStateRow, LearningEventRow, Store } from "./store";
import type { ContentBundle } from "./types";

/** A stored datetime as a Date (`_aware`: stored times are already UTC). */
function aware(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function getState(store: Store, lessonId: string): ConceptStateRow {
  return (
    store.get("concept_states", lessonId) ??
    store.insert("concept_states", {
      lesson_id: lessonId, state: "not_started", first_seen_at: null, updated_at: store.isoNow(), last_passed_at: null,
      pass_count: 0, attempt_count: 0, best_score: null, last_score: null, revision_reason: null, tested_out: false,
    })
  );
}

export function statesMap(store: Store): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of store.rows("concept_states")) out[s.lesson_id] = s.state;
  return out;
}

export function recordEvent(
  store: Store,
  type: string,
  opts: { lessonId?: string | null; termId?: string | null; data?: Record<string, unknown> | null } = {},
): LearningEventRow {
  const data = opts.data && Object.keys(opts.data).length ? opts.data : {};
  return store.insert("learning_events", {
    created_at: store.isoNow(), type, lesson_id: opts.lessonId ?? null, term_id: opts.termId ?? null, data,
  });
}

/** What mastery.ts needs to know about a concept (`_view`). */
export function view(st: ConceptStateRow): mastery.StateView {
  return {
    state: st.state,
    passCount: st.pass_count,
    lastPassedAt: aware(st.last_passed_at),
    bestScore: st.best_score,
  } as mastery.StateView;
}

function setState(store: Store, st: ConceptStateRow, next: string, reason: string | null, cause: string): ConceptStateRow {
  const patch: Partial<ConceptStateRow> = {};
  if (next !== st.state) {
    recordEvent(store, "state_changed", { lessonId: st.lesson_id, data: { from: st.state, to: next, reason, cause } });
    patch.state = next;
    if (next === "needs_revision") patch.revision_reason = reason;
    else if (next === "understood" || next === "mastered") patch.revision_reason = null;
  }
  patch.updated_at = store.isoNow();
  return store.update("concept_states", st.lesson_id, patch);
}

/** Every dictionary term a lesson introduces or links to. */
export function lessonTerms(bundle: ContentBundle, lessonId: string): string[] {
  const lesson = bundle.lessons[lessonId];
  if (!lesson) return [];
  const found: string[] = [...lesson.word.terms];
  for (const [, text] of iterStrings(lesson)) {
    for (const m of text.matchAll(LINK_RE)) {
      const t = m[1].trim();
      if (!t.startsWith("lesson:") && t in bundle.terms && !found.includes(t)) found.push(t);
    }
    for (const t of bundle.findTerms(text)) if (!found.includes(t)) found.push(t);
  }
  return found;
}

/** Add words to the personal dictionary. Returns the ids that are new. */
export function touchTerms(store: Store, termIds: string[], lessonId: string | null): string[] {
  const fresh: string[] = [];
  for (const tid of termIds) {
    if (!store.get("term_states", tid)) {
      store.insert("term_states", {
        term_id: tid, first_seen_at: store.isoNow(), first_seen_lesson: lessonId, lookups: 0, last_lookup_at: null, learned: false,
      });
      fresh.push(tid);
    }
  }
  if (fresh.length) recordEvent(store, "terms_added", { lessonId, data: { terms: fresh } });
  return fresh;
}

export function openLesson(store: Store, bundle: ContentBundle, lessonId: string): [ConceptStateRow, string[]] {
  let st = getState(store, lessonId);
  if (st.first_seen_at === null) st = store.update("concept_states", lessonId, { first_seen_at: store.isoNow() });
  st = setState(store, st, mastery.onOpen(view(st)), null, "lesson_opened");
  recordEvent(store, "lesson_opened", { lessonId });
  const newTerms = touchTerms(store, lessonTerms(bundle, lessonId), lessonId);
  return [st, newTerms];
}

export function applyAssessment(
  store: Store, bundle: ContentBundle, lessonId: string, score: number, passScore: number, mode: string,
): [string, string] {
  let st = getState(store, lessonId);
  const before = st.state;
  const now = store.now();
  const nowIso = now.toISOString();
  const [next, reason] = mastery.onAssessment(view(st), score, passScore, now);
  const patch: Partial<ConceptStateRow> = {
    attempt_count: st.attempt_count + 1,
    last_score: score,
    best_score: st.best_score === null ? score : Math.max(st.best_score, score),
  };
  if (score >= passScore) {
    patch.pass_count = st.pass_count + 1;
    patch.last_passed_at = nowIso;
    if (mode === "test_out") patch.tested_out = true;
    // words introduced by this lesson are now "learned"
    const lesson = bundle.lessons[lessonId];
    if (lesson) {
      for (const tid of lesson.word.terms) {
        if (store.get("term_states", tid)) {
          store.update("term_states", tid, { learned: true });
        } else {
          store.insert("term_states", {
            term_id: tid, first_seen_at: nowIso, first_seen_lesson: lessonId, lookups: 0, last_lookup_at: null, learned: true,
          });
        }
      }
    }
  }
  if (st.first_seen_at === null) patch.first_seen_at = nowIso;
  st = store.update("concept_states", lessonId, patch);
  st = setState(store, st, next, reason, `assessment:${mode}`);
  return [before, st.state];
}

/** A mistake points back to lessonId. Returns true if it was flagged for revision. */
export function applyDiagnosedGap(store: Store, lessonId: string, reason: string): boolean {
  const st = store.get("concept_states", lessonId);
  if (!st) return false;
  const [next, why] = mastery.onDiagnosedGap(view(st), reason);
  if (next !== st.state) {
    setState(store, st, next, why, "diagnosed_gap");
    return true;
  }
  return false;
}

export function reviewDue(store: Store): string[] {
  const now = store.now();
  return store.rows("concept_states").filter((s) => mastery.reviewDue(view(s), now)).map((s) => s.lesson_id);
}

export function recentMistakes(store: Store, limit = 8): string[] {
  const out: string[] = [];
  const rows = store.rows("question_responses");
  for (let i = rows.length - 1; i >= 0 && out.length < limit; i--) {
    const r = rows[i];
    if (r.correct === false && r.diagnosis !== null && r.diagnosis !== undefined) out.push(`${r.lesson_id}: ${r.diagnosis}`);
  }
  return out;
}

export function knownTerms(store: Store, bundle: ContentBundle): string[] {
  return store.rows("term_states").filter((t) => t.term_id in bundle.terms).map((t) => bundle.terms[t.term_id].word);
}
