/** Port of the mastery tests in backend/tests/test_learning.py, plus boundaries of every rule. */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PASS_SCORE,
  KNOWN,
  makeStateView,
  MASTERY_GAP,
  MASTERY_SCORE,
  onAssessment,
  onDiagnosedGap,
  onOpen,
  REVIEW_INTERVALS,
  reviewDue,
  type StateView,
} from "./mastery";

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const NOW = new Date(Date.UTC(2026, 10, 2, 12));
const later = (ms: number) => new Date(NOW.getTime() + ms);
const view = (state: string, passCount = 0, lastPassedAt: Date | null = null): StateView =>
  makeStateView({ state, passCount, lastPassedAt });

describe("constants", () => {
  it("match backend/app/learning/mastery.py", () => {
    expect([...KNOWN]).toEqual(["understood", "mastered"]);
    expect(MASTERY_SCORE).toBe(0.9);
    expect(MASTERY_GAP).toBe(20 * HOUR);
    expect(REVIEW_INTERVALS.map((ms) => ms / DAY)).toEqual([1, 3, 7, 16, 35]);
    expect(DEFAULT_PASS_SCORE).toBe(0.7);
  });

  it("a StateView defaults like the dataclass", () => {
    expect(makeStateView()).toEqual({ state: "not_started", passCount: 0, lastPassedAt: null, bestScore: null });
    expect(makeStateView({ state: "understood", bestScore: 0.8 })).toEqual({
      state: "understood",
      passCount: 0,
      lastPassedAt: null,
      bestScore: 0.8,
    });
  });
});

describe("transitions (test_mastery_transitions)", () => {
  it("follows the Python test exactly", () => {
    const s = makeStateView();
    expect(onOpen(s)).toBe("introduced");
    expect(onAssessment(s, 0.5, 0.7, NOW)[0]).toBe("introduced");
    expect(onAssessment(s, 0.8, 0.7, NOW)[0]).toBe("understood");
    const u = view("understood", 1, NOW);
    // a second pass the same day is not mastery
    expect(onAssessment(u, 1.0, 0.7, later(2 * HOUR))[0]).toBe("understood");
    // a high score on a later day is
    expect(onAssessment(u, 0.95, 0.7, later(DAY))[0]).toBe("mastered");
    // failing something you understood flags it for revision
    const [state, reason] = onAssessment(u, 0.3, 0.7, NOW);
    expect(state).toBe("needs_revision");
    expect(reason).toContain("30%");
    // passing again restores understanding
    const r = view("needs_revision", 1, new Date(NOW.getTime() - 3 * DAY));
    expect(onAssessment(r, 0.95, 0.7, NOW)[0]).toBe("mastered");
    expect(onDiagnosedGap(u, "why")[0]).toBe("needs_revision");
    expect(onDiagnosedGap(view("introduced"), "why")[0]).toBe("introduced");
  });

  it("opening a lesson only moves not_started", () => {
    for (const st of ["introduced", "understood", "mastered", "needs_revision"]) expect(onOpen(view(st))).toBe(st);
  });

  it("gives the same reasons, word for word", () => {
    expect(onAssessment(view("understood", 1, NOW), 0.95, 0.7, later(DAY))).toEqual([
      "mastered",
      "Passed again with a high score on a later day.",
    ]);
    expect(onAssessment(view("mastered", 2, NOW), 0.3, 0.7, NOW)).toEqual([
      "needs_revision",
      "A later assessment scored 30%.",
    ]);
    expect(onAssessment(view("understood", 1, NOW), 0.95, 0.7, NOW)).toEqual(["understood", null]);
    expect(onAssessment(view("mastered", 3, NOW), 0.7, 0.7, NOW)).toEqual(["mastered", null]);
  });

  it("rounds the percentage like Python's round() (halves to even)", () => {
    const u = view("understood", 1, NOW);
    const cases: [number, string][] = [
      [0.125, "12%"],
      [0.675, "68%"],
      [0.285, "28%"],
      [0.0, "0%"],
      [0.005, "0%"],
      [0.015, "2%"],
      [0.025, "2%"],
      [0.345, "34%"],
      [0.5, "50%"],
      [0.6949999, "69%"],
      [1 / 3, "33%"],
      [2 / 3, "67%"],
      [0.555, "56%"],
    ];
    for (const [score, pct] of cases) expect(onAssessment(u, score, 0.7, NOW)[1]).toBe(`A later assessment scored ${pct}.`);
  });

  it("needs a gap of at least 20 hours and a score of at least 0.9 for mastery", () => {
    const u = view("understood", 1, NOW);
    expect(onAssessment(u, 0.9, 0.7, later(MASTERY_GAP))[0]).toBe("mastered");
    expect(onAssessment(u, 0.9, 0.7, later(MASTERY_GAP - 1))[0]).toBe("understood");
    expect(onAssessment(u, 0.89, 0.7, later(DAY))[0]).toBe("understood");
    // never passed before: a high score is understanding, not mastery
    expect(onAssessment(view("needs_revision"), 0.95, 0.7, NOW)).toEqual(["understood", null]);
    expect(onAssessment(view("introduced", 0, null), 1.0, 0.7, later(DAY))).toEqual(["understood", null]);
  });

  it("passes at exactly the pass score and keeps unknown states when failing", () => {
    expect(onAssessment(view("introduced"), 0.7, 0.7, NOW)[0]).toBe("understood");
    expect(onAssessment(view("introduced"), 0.69, 0.7, NOW)).toEqual(["introduced", null]);
    expect(onAssessment(view("not_started"), 0.0, 0.7, NOW)).toEqual(["introduced", null]);
    expect(onAssessment(view("needs_revision", 1, NOW), 0.5, 0.7, NOW)).toEqual(["needs_revision", null]);
    expect(onAssessment(view("mastered", 3, NOW), 0.69, 0.7, NOW)).toEqual(["needs_revision", "A later assessment scored 69%."]);
  });

  it("flags only known concepts when a mistake points back at them", () => {
    expect(onDiagnosedGap(view("mastered", 2, NOW), "Mistakes pointed back here.")).toEqual([
      "needs_revision",
      "Mistakes pointed back here.",
    ]);
    for (const st of ["not_started", "introduced", "needs_revision"]) expect(onDiagnosedGap(view(st), "x")).toEqual([st, null]);
  });
});

describe("reviews (test_review_schedule)", () => {
  it("follows the Python test exactly", () => {
    const u = view("understood", 1, NOW);
    expect(reviewDue(u, later(12 * HOUR))).toBe(false);
    expect(reviewDue(u, later(2 * DAY))).toBe(true);
    expect(reviewDue(view("introduced"), later(100 * DAY))).toBe(false);
  });

  it("spaces reviews out by the number of passes", () => {
    const firstDue = (s: StateView) => {
      for (const days of [1, 3, 7, 16, 35]) {
        if (reviewDue(s, later(days * DAY)) && !reviewDue(s, later(days * DAY - 1))) return days;
      }
      return null;
    };
    const expected = [1, 1, 3, 7, 16, 35, 35, 35]; // pass counts 0..7 (as computed by the Python)
    expected.forEach((days, passCount) => expect(firstDue(view("understood", passCount, NOW))).toBe(days));
    // mastered concepts always wait the longest interval
    expect(firstDue(view("mastered", 1, NOW))).toBe(35);
  });

  it("is never due without a known state and a pass time", () => {
    expect(reviewDue(view("understood", 1, null), later(100 * DAY))).toBe(false);
    expect(reviewDue(view("needs_revision", 3, NOW), later(100 * DAY))).toBe(false);
    expect(reviewDue(view("not_started", 0, NOW), later(100 * DAY))).toBe(false);
  });
});
