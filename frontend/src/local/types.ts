/**
 * Shared types for the standalone (in-browser) build. The standalone app replaces the Python backend
 * with TypeScript modules under src/local/. These types are the contracts between those modules;
 * see src/local/SPEC.md for which module implements what.
 */
import type { components } from "@/lib/api-schema";

type S = components["schemas"];

// ---------------------------------------------------------------- content (frontend/standalone/content.json)

/** An authored or materialised question: the same plain-object shape the Python backend uses. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Q = Record<string, any> & { id: string; type: string };

export type Assessment = { pass_score: number; questions: Q[] };

/** A full lesson as authored (unlike LessonPublic, its assessment includes the questions). */
export type Lesson = Omit<S["LessonPublic"], "assessment"> & { assessment: Assessment };

/** A dictionary entry plus the surface forms that auto-link to it. */
export type Term = S["Term"] & { link_forms: string[] };

export type Goal = "pnp" | "rh";

export type LessonNode = {
  id: string;
  stage: string;
  module: string | null;
  title: string;
  summary: string;
  pre: string[];
  goals: Goal[];
};

export type Module = { id: string; title: string; why: string; goals: Goal[] };

export type Stage = {
  id: string;
  kind: "level" | "path";
  number: number | null;
  title: string;
  summary: string;
  why: string;
  goals: Goal[];
  modules: Module[];
  target: string | null;
};

export type WidgetSpec = { id: string; title: string; description: string; props: string[]; goals: string[] };

export type GeneratorMeta = { id: string; title: string; lesson: string };

/** The exact shape of frontend/standalone/content.json (written by backend/scripts/export_content.py). */
export type ContentJson = {
  version: 1;
  curriculum: { stages: Stage[]; lessons: LessonNode[] };
  lessons: Record<string, Lesson>;
  terms: Record<string, Term>;
  widgets: Record<string, WidgetSpec>;
  order: string[];
  children: Record<string, string[]>;
  feeds: Record<string, Goal[]>;
  generators: GeneratorMeta[];
  autolink_stopwords: string[];
  /** The tutor's system prompts (backend/app/ai/prompts/*.md). */
  prompts: { teaching: string; research: string };
};

/** Mirrors backend/app/content/loader.py ContentBundle (implemented in src/local/content.ts). */
export interface ContentBundle {
  json: ContentJson;
  stages: Record<string, Stage>;
  nodes: Record<string, LessonNode>;
  lessons: Record<string, Lesson>;
  terms: Record<string, Term>;
  widgets: Record<string, WidgetSpec>;
  order: string[];
  children: Record<string, string[]>;
  feeds: Record<string, Goal[]>;
  /** All prerequisites (direct and indirect), in teaching order. */
  ancestors(lessonId: string): string[];
  descendants(lessonId: string): string[];
  isAvailable(lessonId: string): boolean;
  /** (surface form, term id) pairs, longest form first. */
  termIndex(): [string, string][];
  /** Dictionary terms mentioned in prose (maths and explicit [[links]] excluded), in order of first mention. */
  findTerms(text: string): string[];
}

// ---------------------------------------------------------------- persistence (src/local/persistence.ts)

/**
 * The learner's whole record, as plain JSON. Designed by src/local/store.ts (it mirrors the SQL tables
 * in backend/app/models.py). Persistence treats it generically: every top-level key holds either an
 * array or an object of rows.
 */
export type LearnerData = Record<string, unknown> & { schema: number };

export type PersistenceMode =
  | "account" // saved privately to the viewer's Claude account (artifact `db` capability)
  | "browser" // saved in this browser only (localStorage) - db unavailable
  | "memory"; // not saved at all (storage blocked)

export type PersistenceStatus = {
  mode: PersistenceMode;
  /** true while a save is queued or in flight */
  saving: boolean;
  /** last save error, in plain words for the learner, or null */
  error: string | null;
};

export interface Persistence {
  readonly mode: PersistenceMode;
  /** The saved record, or null for a new learner. */
  load(): Promise<LearnerData | null>;
  /** Queue a save of the whole record (debounced; only changed parts are written). Never throws. */
  save(data: LearnerData): void;
  /** Resolve once every queued save has been attempted. */
  flush(): Promise<void>;
  /** Erase everything saved for this learner. */
  clear(): Promise<void>;
  status(): PersistenceStatus;
  onStatus(cb: (s: PersistenceStatus) => void): () => void;
}
