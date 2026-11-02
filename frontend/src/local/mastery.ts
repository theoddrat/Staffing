/**
 * The learner model: how each concept moves between knowledge states - a port of
 * backend/app/learning/mastery.py.
 *
 * States
 * ------
 * `not_started`    never opened.
 * `introduced`     the lesson has been opened (or attempted) but not yet passed.
 * `understood`     the assessment was passed once.
 * `mastered`       passed again, with a high score, on a later day - knowledge that survives a gap
 *                  is far more reliable than knowledge shown once.
 * `needs_revision` previously understood or mastered, but a later failed assessment or a diagnosed
 *                  mistake suggests it has slipped.
 *
 * The rules are deliberately simple and transparent so the learner can see exactly why a concept is
 * in a given state. Durations are in milliseconds (Python uses timedelta); times are JS Dates.
 */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export const KNOWN: ReadonlySet<string> = new Set(["understood", "mastered"]);
/** The score a second pass needs (on a later day) to count as mastery. */
export const MASTERY_SCORE = 0.9;
/** How long after the last pass a second pass counts as "a later day": 20 hours, in ms. */
export const MASTERY_GAP = 20 * HOUR;
/** Review schedule (spaced repetition) indexed by number of passes so far: 1, 3, 7, 16, 35 days, in ms. */
export const REVIEW_INTERVALS: readonly number[] = [1, 3, 7, 16, 35].map((d) => d * DAY);
/** An assessment's pass score when the lesson does not set one (backend/app/content/schema.py). */
export const DEFAULT_PASS_SCORE = 0.7;

/** Python dataclass `StateView`. */
export type StateView = {
  state: string;
  passCount: number;
  lastPassedAt: Date | null;
  bestScore: number | null;
};

/** Python `StateView(state="not_started", pass_count=0, last_passed_at=None, best_score=None)`. */
export function makeStateView(init: Partial<StateView> = {}): StateView {
  return {
    state: init.state ?? "not_started",
    passCount: init.passCount ?? 0,
    lastPassedAt: init.lastPassedAt ?? null,
    bestScore: init.bestScore ?? null,
  };
}

export function onOpen(s: StateView): string {
  return s.state === "not_started" ? "introduced" : s.state;
}

/** Return [newState, reason] after an assessment with the given score. */
export function onAssessment(s: StateView, score: number, passScore: number, now: Date): [string, string | null] {
  const passed = score >= passScore;
  if (passed) {
    if (s.state === "mastered") return ["mastered", null];
    if (
      (s.state === "understood" || s.state === "needs_revision") &&
      s.lastPassedAt != null &&
      now.getTime() - s.lastPassedAt.getTime() >= MASTERY_GAP &&
      score >= MASTERY_SCORE
    ) {
      return ["mastered", "Passed again with a high score on a later day."];
    }
    return ["understood", null];
  }
  if (KNOWN.has(s.state)) return ["needs_revision", `A later assessment scored ${pyRound(score * 100)}%.`];
  return [s.state === "not_started" ? "introduced" : s.state, null];
}

/** A mistake elsewhere points back at this concept. */
export function onDiagnosedGap(s: StateView, reason: string): [string, string | null] {
  if (KNOWN.has(s.state)) return ["needs_revision", reason];
  return [s.state, null];
}

export function reviewDue(s: StateView, now: Date): boolean {
  if (!KNOWN.has(s.state) || s.lastPassedAt == null) return false;
  let idx = Math.min(Math.max(s.passCount - 1, 0), REVIEW_INTERVALS.length - 1);
  if (s.state === "mastered") idx = REVIEW_INTERVALS.length - 1;
  return now.getTime() - s.lastPassedAt.getTime() >= REVIEW_INTERVALS[idx];
}

/** Python `round(x)`: to the nearest integer, halves to even (round(12.5) == 12). */
function pyRound(x: number): number {
  if (Math.abs(x % 1) === 0.5) return 2 * Math.round(x / 2);
  return Math.round(x);
}
