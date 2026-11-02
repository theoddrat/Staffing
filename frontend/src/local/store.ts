/**
 * The learner model as plain JSON tables - a port of backend/app/models.py.
 *
 * Every SQL table becomes one top-level key of `LearnerData` holding an array of rows (in the order
 * SQLite would return them: insertion order, which for integer keys is id order). Rows have exactly
 * the models' column names; datetimes are ISO-8601 UTC strings ("2026-11-02T09:53:00.123Z"); JSON
 * columns hold plain JSON. String ids are 32-hex-digit uuid4 strings like `uuid.uuid4().hex`;
 * integer ids are assigned like SQLite's INTEGER PRIMARY KEY (largest id + 1).
 *
 * Rows are treated as immutable: an update replaces the row object, and a table is copied before
 * its first change in a transaction. So a transaction that throws is rolled back by restoring the
 * table references, and a record handed to `onChange` is never modified afterwards.
 */
import type { LearnerData, Q } from "./types";
import type { Random } from "./rng";

export const SCHEMA_VERSION = 1;

type Json = Record<string, unknown>;

export type ConceptStateRow = {
  lesson_id: string;
  /** not_started | introduced | understood | mastered | needs_revision */
  state: string;
  first_seen_at: string | null;
  updated_at: string;
  last_passed_at: string | null;
  pass_count: number;
  attempt_count: number;
  best_score: number | null;
  last_score: number | null;
  revision_reason: string | null;
  tested_out: boolean;
};

export type LearningEventRow = {
  id: number;
  created_at: string;
  type: string;
  lesson_id: string | null;
  term_id: string | null;
  data: Json;
};

export type AttemptRow = {
  id: string;
  lesson_id: string;
  /** lesson | test_out | review */
  mode: string;
  started_at: string;
  finished_at: string | null;
  /** materialised questions, including the answers */
  questions: Q[];
  score: number | null;
  passed: boolean | null;
};

export type QuestionResponseRow = {
  id: number;
  attempt_id: string;
  lesson_id: string;
  question_id: string;
  try_number: number;
  answer: Json;
  correct: boolean;
  credit: number;
  diagnosis: string | null;
  revisit: string | null;
  /** rule | ai | self */
  graded_by: string;
  created_at: string;
};

export type TermStateRow = {
  term_id: string;
  first_seen_at: string;
  first_seen_lesson: string | null;
  lookups: number;
  last_lookup_at: string | null;
  learned: boolean;
};

export type ExerciseCompletionRow = {
  id: number;
  lesson_id: string;
  /** "experiment" or a practice generator */
  exercise: string;
  completed_at: string;
  data: Json;
};

export type PracticeItemRow = {
  id: string;
  generator: string;
  lesson_id: string | null;
  question: Q;
  created_at: string;
  answered_correctly: boolean | null;
};

export type ChatThreadRow = {
  id: string;
  title: string;
  /** teaching | research */
  mode: string;
  lesson_id: string | null;
  created_at: string;
  updated_at: string;
};

export type ChatMessageRow = {
  id: number;
  thread_id: string;
  /** user | assistant */
  role: string;
  content: string;
  structured: Json | null;
  context: Json | null;
  created_at: string;
};

export type GeneratedTermRow = {
  id: string;
  word: string;
  entry: Json;
  created_at: string;
  model: string | null;
};

export type WonderingRow = {
  id: number;
  text: string;
  lesson_id: string | null;
  /** open | exploring | answered */
  status: string;
  note: string | null;
  created_at: string;
  updated_at: string;
};

export type Tables = {
  concept_states: ConceptStateRow[];
  learning_events: LearningEventRow[];
  assessment_attempts: AttemptRow[];
  question_responses: QuestionResponseRow[];
  term_states: TermStateRow[];
  exercise_completions: ExerciseCompletionRow[];
  practice_items: PracticeItemRow[];
  chat_threads: ChatThreadRow[];
  chat_messages: ChatMessageRow[];
  generated_terms: GeneratedTermRow[];
  wonderings: WonderingRow[];
};

export type TableName = keyof Tables;
export type Row<T extends TableName> = Tables[T][number];

/** Tables with an autoincrement integer id (the store assigns it). */
type AutoTable = "learning_events" | "question_responses" | "exercise_completions" | "chat_messages" | "wonderings";

/** A row to insert: integer ids may be left out. */
export type NewRow<T extends TableName> = T extends AutoTable ? Omit<Row<T>, "id"> & { id?: number } : Row<T>;

/** The learner record as the store keeps it (a `LearnerData`). */
export type LearnerRecord = Tables & { schema: number };

// ---------------------------------------------------------------- the schema (models.py)

type ColumnKind = "str" | "int" | "float" | "bool" | "datetime" | "json";

export type Column = {
  name: string;
  kind: ColumnKind;
  nullable: boolean;
  /** Python-side column default (applied when the column is missing on insert). */
  default?: "now" | "uuid" | "dict" | string | number | boolean;
  /** A foreign key: the table whose `id` this column refers to. */
  references?: TableName;
};

const c = (name: string, kind: ColumnKind, nullable: boolean, extra: Partial<Column> = {}): Column => ({ name, kind, nullable, ...extra });

/** Every table, in the backend's EXPORT_TABLES order, with its columns in models.py order. */
export const SCHEMA: { [T in TableName]: { primaryKey: string; autoincrement: boolean; columns: Column[] } } = {
  concept_states: {
    primaryKey: "lesson_id",
    autoincrement: false,
    columns: [
      c("lesson_id", "str", false),
      c("state", "str", false, { default: "not_started" }),
      c("first_seen_at", "datetime", true),
      c("updated_at", "datetime", false, { default: "now" }),
      c("last_passed_at", "datetime", true),
      c("pass_count", "int", false, { default: 0 }),
      c("attempt_count", "int", false, { default: 0 }),
      c("best_score", "float", true),
      c("last_score", "float", true),
      c("revision_reason", "str", true),
      c("tested_out", "bool", false, { default: false }),
    ],
  },
  learning_events: {
    primaryKey: "id",
    autoincrement: true,
    columns: [
      c("id", "int", false),
      c("created_at", "datetime", false, { default: "now" }),
      c("type", "str", false),
      c("lesson_id", "str", true),
      c("term_id", "str", true),
      c("data", "json", false, { default: "dict" }),
    ],
  },
  assessment_attempts: {
    primaryKey: "id",
    autoincrement: false,
    columns: [
      c("id", "str", false, { default: "uuid" }),
      c("lesson_id", "str", false),
      c("mode", "str", false, { default: "lesson" }),
      c("started_at", "datetime", false, { default: "now" }),
      c("finished_at", "datetime", true),
      c("questions", "json", false),
      c("score", "float", true),
      c("passed", "bool", true),
    ],
  },
  question_responses: {
    primaryKey: "id",
    autoincrement: true,
    columns: [
      c("id", "int", false),
      c("attempt_id", "str", false, { references: "assessment_attempts" }),
      c("lesson_id", "str", false),
      c("question_id", "str", false),
      c("try_number", "int", false, { default: 1 }),
      c("answer", "json", false),
      c("correct", "bool", false),
      c("credit", "float", false, { default: 0 }),
      c("diagnosis", "str", true),
      c("revisit", "str", true),
      c("graded_by", "str", false, { default: "rule" }),
      c("created_at", "datetime", false, { default: "now" }),
    ],
  },
  term_states: {
    primaryKey: "term_id",
    autoincrement: false,
    columns: [
      c("term_id", "str", false),
      c("first_seen_at", "datetime", false, { default: "now" }),
      c("first_seen_lesson", "str", true),
      c("lookups", "int", false, { default: 0 }),
      c("last_lookup_at", "datetime", true),
      c("learned", "bool", false, { default: false }),
    ],
  },
  exercise_completions: {
    primaryKey: "id",
    autoincrement: true,
    columns: [
      c("id", "int", false),
      c("lesson_id", "str", false),
      c("exercise", "str", false),
      c("completed_at", "datetime", false, { default: "now" }),
      c("data", "json", false, { default: "dict" }),
    ],
  },
  practice_items: {
    primaryKey: "id",
    autoincrement: false,
    columns: [
      c("id", "str", false, { default: "uuid" }),
      c("generator", "str", false),
      c("lesson_id", "str", true),
      c("question", "json", false),
      c("created_at", "datetime", false, { default: "now" }),
      c("answered_correctly", "bool", true),
    ],
  },
  chat_threads: {
    primaryKey: "id",
    autoincrement: false,
    columns: [
      c("id", "str", false, { default: "uuid" }),
      c("title", "str", false, { default: "New conversation" }),
      c("mode", "str", false, { default: "teaching" }),
      c("lesson_id", "str", true),
      c("created_at", "datetime", false, { default: "now" }),
      c("updated_at", "datetime", false, { default: "now" }),
    ],
  },
  chat_messages: {
    primaryKey: "id",
    autoincrement: true,
    columns: [
      c("id", "int", false),
      c("thread_id", "str", false, { references: "chat_threads" }),
      c("role", "str", false),
      c("content", "str", false),
      c("structured", "json", true),
      c("context", "json", true),
      c("created_at", "datetime", false, { default: "now" }),
    ],
  },
  generated_terms: {
    primaryKey: "id",
    autoincrement: false,
    columns: [
      c("id", "str", false),
      c("word", "str", false),
      c("entry", "json", false),
      c("created_at", "datetime", false, { default: "now" }),
      c("model", "str", true),
    ],
  },
  wonderings: {
    primaryKey: "id",
    autoincrement: true,
    columns: [
      c("id", "int", false),
      c("text", "str", false),
      c("lesson_id", "str", true),
      c("status", "str", false, { default: "open" }),
      c("note", "str", true),
      c("created_at", "datetime", false, { default: "now" }),
      c("updated_at", "datetime", false, { default: "now" }),
    ],
  },
};

/** Table names in the backend's EXPORT_TABLES order. */
export const TABLES = Object.keys(SCHEMA) as TableName[];

/** A new, empty learner record. */
export function emptyLearnerData(): LearnerRecord {
  return { schema: SCHEMA_VERSION, ...emptyTables() };
}

/** Every table, empty. */
export function emptyTables(): Tables {
  return {
    concept_states: [],
    learning_events: [],
    assessment_attempts: [],
    question_responses: [],
    term_states: [],
    exercise_completions: [],
    practice_items: [],
    chat_threads: [],
    chat_messages: [],
    generated_terms: [],
    wonderings: [],
  };
}

const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Bring a loaded record into the current shape: every table present as an array of row objects,
 * integer-keyed tables in id order. Unknown top-level keys are kept as they are.
 */
export function normaliseLearnerData(raw: LearnerData | null | undefined): LearnerRecord {
  const out = { ...(isObject(raw) ? raw : {}), schema: SCHEMA_VERSION } as Record<string, unknown>;
  for (const t of TABLES) {
    const v = out[t];
    const rows = Array.isArray(v) ? v.filter(isObject) : [];
    if (SCHEMA[t].autoincrement) rows.sort((a, b) => Number(a.id) - Number(b.id));
    out[t] = rows;
  }
  return out as LearnerRecord;
}

// ---------------------------------------------------------------- ids and times

/** `uuid.uuid4().hex` (32 lowercase hex digits, version 4), from `random` when given. */
export function uuidHex(random?: Random): string {
  const bytes = new Uint8Array(16);
  if (random) {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(random.random() * 256);
  } else if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * An ISO-8601 datetime from a backup (Python's `datetime.fromisoformat`), as a UTC ISO string.
 * A time without a zone is UTC, as the backend treats SQLite's naive datetimes. Null on bad input.
 */
export function parseDateTime(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/i.exec(v.trim());
  if (!m) return null;
  const [, y, mo, d, h = "00", mi = "00", s = "00", frac = "", zone = "Z"] = m;
  const ms = (frac + "000").slice(0, 3);
  let tz = zone.toUpperCase();
  if (tz !== "Z") {
    const digits = tz.slice(1).replace(":", "");
    tz = `${tz[0]}${digits.slice(0, 2)}:${(digits.slice(2) || "00").padEnd(2, "0")}`;
  }
  const date = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}.${ms}${tz}`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// ---------------------------------------------------------------- the store

export type StoreOptions = {
  /** The clock (defaults to the real time). */
  now?: () => Date;
  /** Source of randomness for new ids (defaults to crypto). */
  random?: Random;
};

export class Store {
  data: LearnerRecord;
  private readonly onChange: (d: LearnerData) => void;
  private readonly clock: () => Date;
  private readonly random?: Random;
  /** Tables as they were before the running transaction first changed them. */
  private before: Partial<Record<TableName, unknown[]>> | null = null;
  private depth = 0;

  constructor(data: LearnerData, onChange: (d: LearnerData) => void, opts: StoreOptions = {}) {
    this.data = normaliseLearnerData(data);
    this.onChange = onChange;
    this.clock = opts.now ?? (() => new Date());
    this.random = opts.random;
  }

  /** The current time (`utcnow()`). */
  now(): Date {
    return this.clock();
  }

  /** The current time as stored: an ISO-8601 UTC string. */
  isoNow(): string {
    return this.clock().toISOString();
  }

  /** A new string id (`uuid.uuid4().hex`). */
  newId(): string {
    return uuidHex(this.random);
  }

  // -- reading ----------------------------------------------------------------------------

  rows<T extends TableName>(table: T): readonly Row<T>[] {
    return this.data[table] as Row<T>[];
  }

  /** The row with this primary key (`db.get(Model, pk)`). */
  get<T extends TableName>(table: T, pk: string | number): Row<T> | undefined {
    const key = SCHEMA[table].primaryKey;
    return (this.data[table] as Json[]).find((r) => r[key] === pk) as Row<T> | undefined;
  }

  // -- writing ------------------------------------------------------------------------------

  /**
   * Run `fn` as one transaction: changes are committed together (one `onChange`) when it returns,
   * and rolled back if it throws. Nested calls join the outer transaction. `fn` must be synchronous.
   */
  transaction<R>(fn: () => R): R {
    if (this.depth > 0) return fn();
    this.depth++;
    this.before = {};
    try {
      const out = fn();
      if (out instanceof Promise) throw new Error("Store.transaction() needs a synchronous function");
      const changed = Object.keys(this.before).length > 0;
      this.before = null;
      if (changed) this.onChange({ ...this.data });
      return out;
    } catch (e) {
      for (const [t, rows] of Object.entries(this.before ?? {})) (this.data as Record<string, unknown>)[t] = rows;
      this.before = null;
      throw e;
    } finally {
      this.depth--;
    }
  }

  /** The table, copied the first time it changes in this transaction. */
  private writable<T extends TableName>(table: T): Row<T>[] {
    if (!this.before) throw new Error("Store: write outside a transaction");
    if (!(table in this.before)) {
      this.before[table] = this.data[table];
      (this.data as Record<string, unknown>)[table] = this.data[table].slice();
    }
    return this.data[table] as Row<T>[];
  }

  /** Add a row. Integer ids are assigned like SQLite's (largest + 1) when the row has none. */
  insert<T extends TableName>(table: T, row: NewRow<T>): Row<T> {
    return this.transaction(() => {
      const rows = this.writable(table) as Json[];
      const r = { ...row } as Json;
      if (SCHEMA[table].autoincrement) {
        const last = rows.length ? Number(rows[rows.length - 1].id) : 0;
        if (r.id === undefined || r.id === null) r.id = last + 1;
        rows.push(r);
        if (Number(r.id) < last) rows.sort((a, b) => Number(a.id) - Number(b.id));
      } else {
        rows.push(r);
      }
      return Object.freeze(r) as Row<T>;
    });
  }

  /** Change some columns of the row with this primary key. Returns the new row. */
  update<T extends TableName>(table: T, pk: string | number, patch: Partial<Row<T>>): Row<T> {
    return this.transaction(() => {
      const key = SCHEMA[table].primaryKey;
      const rows = this.writable(table);
      const i = rows.findIndex((r) => (r as Json)[key] === pk);
      if (i < 0) throw new Error(`Store.update: no ${table} row ${String(pk)}`);
      const next = Object.freeze({ ...rows[i], ...patch }) as Row<T>;
      rows[i] = next;
      return next;
    });
  }

  /** Delete the rows matching `pred`. Returns how many were deleted. */
  delete<T extends TableName>(table: T, pred: (r: Row<T>) => boolean): number {
    return this.transaction(() => {
      const current = this.data[table] as Row<T>[];
      if (!current.some(pred)) return 0;
      const rows = this.writable(table);
      const kept = rows.filter((r) => !pred(r));
      const n = rows.length - kept.length;
      (this.data as Record<string, unknown>)[table] = kept;
      return n;
    });
  }

  /** Replace every table (import / reset). */
  replaceAll(tables: Tables): void {
    this.transaction(() => {
      for (const t of TABLES) {
        this.writable(t);
        (this.data as Record<string, unknown>)[t] = tables[t];
      }
    });
  }
}
