import { afterEach, describe, expect, it, vi } from "vitest";
import { createPersistence, memoryPersistence } from "./persistence";
import type { LearnerData, Persistence, PersistenceStatus } from "./types";

// ---------------------------------------------------------------- fakes of the artifact runtime

type Body = Record<string, unknown>;
type DbError = { code: string; message: string };
type Op = "set" | "delete" | "get" | "list";

const SEGMENT = /^[A-Za-z0-9_\-.~:@+]+$/;
const MAX_DOC_BYTES = 256 * 1024;

function deepFreeze<T>(x: T): T {
  if (x && typeof x === "object") {
    for (const v of Object.values(x)) deepFreeze(v);
    Object.freeze(x);
  }
  return x;
}

/** The `db` capability (db.d.ts): path grammar, object bodies of at most 256 KiB, frozen snapshots. */
class FakeDb {
  readonly docs = new Map<string, string>();
  readonly ops: { op: Op; path: string }[] = [];
  /** Documents a collection read leaves out, as when it cannot read the collection whole. */
  readonly hidden = new Set<string>();
  /** Milliseconds each call takes (0: no timer at all). */
  latency = 1;
  /** The most writes ever in flight at once on one document. */
  maxInFlight = 0;
  fail: ((op: Op, path: string) => DbError | null) | null = null;
  private readonly inFlight = new Map<string, number>();

  private static check(path: string, even: boolean): void {
    const segs = path.split("/");
    if ((segs.length % 2 === 0) !== even) throw new TypeError(`wrong number of segments: ${path}`);
    for (const s of segs) {
      if (!SEGMENT.test(s) || s === "." || s === ".." || Buffer.byteLength(s) > 200) throw new TypeError(`bad segment "${s}"`);
    }
  }

  collection(path: string) {
    FakeDb.check(path, false);
    return { path, get: () => this.list(path), doc: (id: string) => this.doc(`${path}/${id}`) };
  }

  doc(path: string) {
    FakeDb.check(path, true);
    return {
      id: path.slice(path.lastIndexOf("/") + 1),
      path,
      get: () => this.read(path),
      set: (b: Body) => this.write(path, b),
      delete: () => this.remove(path),
    };
  }

  private async pause(op: Op, path: string): Promise<void> {
    this.ops.push({ op, path });
    if (this.latency > 0) await new Promise((r) => setTimeout(r, this.latency));
    else await Promise.resolve();
    const err = this.fail?.(op, path);
    if (err) throw err;
  }

  private snapshot(path: string) {
    const json = this.docs.get(path);
    const body = json === undefined ? undefined : deepFreeze(JSON.parse(json) as Body);
    return Object.freeze({
      id: path.slice(path.lastIndexOf("/") + 1),
      exists: json !== undefined,
      data: () => body,
      metadata: { fromCache: false, hasPendingWrites: false },
    });
  }

  private async read(path: string) {
    await this.pause("get", path);
    return this.snapshot(path);
  }

  private async list(col: string) {
    await this.pause("list", col);
    const docs = [...this.docs.keys()]
      .filter((p) => p.startsWith(`${col}/`) && !p.slice(col.length + 1).includes("/") && !this.hidden.has(p))
      .sort()
      .map((p) => this.snapshot(p));
    return { docs, size: docs.length, empty: docs.length === 0, metadata: { fromCache: false, hasPendingWrites: false } };
  }

  private async write(path: string, body: Body) {
    const n = (this.inFlight.get(path) ?? 0) + 1;
    this.inFlight.set(path, n);
    this.maxInFlight = Math.max(this.maxInFlight, n);
    try {
      await this.pause("set", path);
      if (typeof body !== "object" || body === null || Array.isArray(body)) throw { code: "invalid_argument", message: "not an object" };
      const json = JSON.stringify(body);
      if (Buffer.byteLength(json) > MAX_DOC_BYTES) throw { code: "invalid_argument", message: "document over 256 KiB" };
      this.docs.set(path, json);
    } finally {
      this.inFlight.set(path, (this.inFlight.get(path) ?? 1) - 1);
    }
  }

  private async remove(path: string) {
    await this.pause("delete", path);
    this.docs.delete(path);
  }

  idsIn(col: string): string[] {
    return [...this.docs.keys()].filter((p) => p.startsWith(`${col}/`)).map((p) => p.slice(col.length + 1)).sort();
  }

  body(path: string): Body {
    const json = this.docs.get(path);
    if (json === undefined) throw new Error(`no document ${path}`);
    return JSON.parse(json) as Body;
  }

  calls(op: Op): string[] {
    return this.ops.filter((o) => o.op === op).map((o) => o.path);
  }
}

class FakeStorage {
  readonly map = new Map<string, string>();
  quotaBytes = Infinity;
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    const size = [...this.map].reduce((n, [key, val]) => n + (key === k ? 0 : key.length + val.length), k.length + String(v).length);
    if (size > this.quotaBytes) throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    this.map.set(k, String(v));
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
  clear(): void {
    this.map.clear();
  }
  key(i: number): string | null {
    return [...this.map.keys()][i] ?? null;
  }
  get length(): number {
    return this.map.size;
  }
}

const g = globalThis as unknown as { window?: unknown; localStorage?: unknown };

function installStorage(s: FakeStorage | "throws"): void {
  if (s === "throws") {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("The operation is insecure.", "SecurityError");
      },
    });
  } else {
    Object.defineProperty(globalThis, "localStorage", { configurable: true, writable: true, value: s });
  }
}

function installClaude(caps: Record<string, unknown>): void {
  g.window = { claude: Object.freeze({ use: async (name: string) => caps[name] ?? null }) };
}

const viewer = (id: string | null) => Object.freeze({ id: async () => id, isOwner: async () => true });

afterEach(() => {
  delete g.window;
  delete g.localStorage;
  vi.useRealTimers();
});

// ---------------------------------------------------------------- helpers

const KEY = "test-learner";
const UID = "u_test";
const COL = `data/users/${UID}`;
const COPY = `${KEY}:${UID}`;

function record(extra: Record<string, unknown> = {}): LearnerData {
  return {
    schema: 1,
    concept_states: { "l0-counting": { state: "understood", first_understood_at: "2026-11-01T10:00:00Z" } },
    events: [{ id: 1, type: "lesson_opened", lesson_id: "l0-counting" }],
    attempts: {},
    ...extra,
  } as LearnerData;
}

/** About `bytes` of JSON events, with quotes, backslashes, accents, emoji and CJK to stress the size accounting. */
function events(bytes: number, from = 0): Body[] {
  const out: Body[] = [];
  let size = 0;
  for (let i = from; size < bytes; i++) {
    const e = {
      id: i, type: "question_answered", lesson_id: "l1-fractions", at: `2026-11-02T10:${String(i % 60).padStart(2, "0")}:00Z`,
      data: { note: `naïve “curly” "straight" \\ back\\slash 😀 ∑ 分数 ${"x".repeat(i % 40)}`, correct: i % 3 === 0 },
    };
    size += Buffer.byteLength(JSON.stringify(e)) + 1;
    out.push(e);
  }
  return out;
}

async function account(db: FakeDb, storage = new FakeStorage(), id: string | null = UID): Promise<Persistence> {
  installStorage(storage);
  installClaude({ db, user: viewer(id) });
  return createPersistence({ key: KEY });
}

async function saved(p: Persistence, data: LearnerData): Promise<void> {
  p.save(data);
  await p.flush();
}

// ---------------------------------------------------------------- modes

describe("choosing where to save", () => {
  it("uses the Claude account when db and user are available and the viewer has an id", async () => {
    const p = await account(new FakeDb());
    expect(p.mode).toBe("account");
    expect(p.status()).toEqual({ mode: "account", saving: false, error: null });
  });

  it("uses this browser when the page is opened outside claude.ai", async () => {
    const storage = new FakeStorage();
    installStorage(storage);
    const p = await createPersistence({ key: KEY });
    expect(p.mode).toBe("browser");
    expect(await p.load()).toBeNull();
    await saved(p, record());
    expect(JSON.parse(storage.getItem(KEY) ?? "null")).toEqual(record());
    const again = await createPersistence({ key: KEY });
    expect(again.mode).toBe("browser");
    expect(await again.load()).toEqual(record());
  });

  it("uses this browser when db or user is missing, or the viewer has no id", async () => {
    const db = new FakeDb();
    for (const caps of [{ db }, { user: viewer(UID) }, { db, user: viewer(null) }, {}]) {
      installStorage(new FakeStorage());
      installClaude(caps);
      expect((await createPersistence({ key: KEY })).mode).toBe("browser");
    }
    expect(db.ops).toEqual([]);
  });

  it("keeps the record in memory when localStorage throws, and says progress will be lost", async () => {
    installStorage("throws");
    const p = await createPersistence({ key: KEY });
    expect(p.mode).toBe("memory");
    expect(p.status().error).toMatch(/lost/);
    p.save(record({ attempts: { a1: { score: 1 } } }));
    await p.flush();
    const first = await p.load();
    expect(first).toEqual(record({ attempts: { a1: { score: 1 } } }));
    (first as Body).schema = 99;
    expect((await p.load())?.schema).toBe(1); // load() hands out copies
  });

  it("memoryPersistence starts from a copy of the record it is given", async () => {
    const initial = record();
    const p = memoryPersistence(initial);
    expect(p.mode).toBe("memory");
    const loaded = await p.load();
    expect(loaded).toEqual(initial);
    expect(loaded).not.toBe(initial);
    expect(await memoryPersistence().load()).toBeNull();
    await p.clear();
    expect(await p.load()).toBeNull();
  });
});

// ---------------------------------------------------------------- the account

describe("saving to the Claude account", () => {
  it("returns null for a new learner and round-trips a record, one document per key", async () => {
    const db = new FakeDb();
    const p = await account(db);
    expect(await p.load()).toBeNull();
    await saved(p, record());
    expect(db.idsIn(COL)).toEqual(["attempts", "concept_states", "events", "schema", "~index"]);
    expect(db.body(`${COL}/concept_states`)).toEqual({ key: "concept_states", value: record().concept_states });
    expect(p.status()).toEqual({ mode: "account", saving: false, error: null });

    const loaded = await (await account(db)).load();
    expect(loaded).toEqual(record());
    // snapshots are frozen, the loaded record must not be
    (loaded?.concept_states as Body)["l1-zero"] = { state: "introduced" };
  });

  it("writes only the documents that changed", async () => {
    const db = new FakeDb();
    const p = await account(db);
    await p.load();
    const data = record();
    await saved(p, data);
    const before = db.calls("set").length;

    (data.concept_states as Body)["l1-zero"] = { state: "introduced" };
    await saved(p, data);
    expect(db.calls("set").slice(before)).toEqual([`${COL}/concept_states`]);

    const after = db.calls("set").length;
    await saved(p, data);
    await saved(p, JSON.parse(JSON.stringify(data)) as LearnerData);
    expect(db.calls("set").length).toBe(after);

    // a page that loads the saved record and saves it unchanged writes nothing either
    const q = await account(db);
    const loaded = await q.load();
    await saved(q, loaded as LearnerData);
    expect(db.calls("set").length).toBe(after);
  });

  it("splits a key over 200 KB into chunk documents and puts it back together", async () => {
    const db = new FakeDb();
    const p = await account(db);
    await p.load();
    const data = record({ events: events(600_000) });
    await saved(p, data);
    expect(p.mode).toBe("account");
    expect(p.status().error).toBeNull();

    const manifest = db.body(`${COL}/events`);
    const chunks = manifest.chunks as string[];
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(typeof manifest.tail).toBe("string");
    for (const id of db.idsIn(COL)) expect(Buffer.byteLength(db.docs.get(`${COL}/${id}`) ?? "")).toBeLessThanOrEqual(MAX_DOC_BYTES);
    expect(db.idsIn(COL).filter((id) => id.startsWith("events~")).sort()).toEqual([...chunks].sort());

    expect(await (await account(db)).load()).toEqual(data);

    // appending to the list rewrites only the manifest (its last piece lives there)
    let before = db.calls("set").length;
    (data.events as Body[]).push(...events(2_000, 100_000));
    await saved(p, data);
    expect(db.calls("set").slice(before)).toEqual([`${COL}/events`]);
    expect(await (await account(db)).load()).toEqual(data);

    // a change near the start writes new chunks and deletes the old ones
    before = db.calls("set").length;
    (data.events as Body[])[0] = { id: 0, type: "changed" };
    await saved(p, data);
    const now = db.body(`${COL}/events`).chunks as string[];
    expect(db.calls("set").slice(before)).toContain(`${COL}/${now[0]}`);
    expect(db.calls("set").slice(before).at(-1)).toBe(`${COL}/events`); // the manifest last
    expect(db.idsIn(COL).filter((id) => id.startsWith("events~")).sort()).toEqual([...now].sort());
    expect(await (await account(db)).load()).toEqual(data);

    // shrinking it again goes back to a single document, and no chunk is left behind
    data.events = (data.events as Body[]).slice(0, 10);
    await saved(p, data);
    expect(db.idsIn(COL)).toEqual(["attempts", "concept_states", "events", "schema", "~index"]);
    expect(db.body(`${COL}/events`)).toEqual({ key: "events", value: data.events });
  });

  it("never has two writes to one document in flight, and the last save wins", async () => {
    const db = new FakeDb();
    db.latency = 5;
    const p = await account(db);
    await p.load();
    for (let i = 0; i < 6; i++) {
      p.save(record({ attempts: { n: i } }));
      if (i % 2) void p.flush();
      await new Promise((r) => setTimeout(r, 3));
    }
    await p.flush();
    expect(db.maxInFlight).toBe(1);
    expect(db.body(`${COL}/attempts`)).toEqual({ key: "attempts", value: { n: 5 } });
  });

  it("debounces saves (and still saves a record that keeps changing)", async () => {
    vi.useFakeTimers();
    const db = new FakeDb();
    db.latency = 0;
    const p = await account(db);
    await p.load();
    p.save(record({ attempts: { n: 1 } }));
    await vi.advanceTimersByTimeAsync(400);
    p.save(record({ attempts: { n: 2 } }));
    await vi.advanceTimersByTimeAsync(400);
    p.save(record({ attempts: { n: 3 } }));
    expect(db.calls("set")).toEqual([]);
    expect(p.status().saving).toBe(true);
    await vi.advanceTimersByTimeAsync(900);
    expect(db.calls("set").filter((x) => x.endsWith("/attempts"))).toEqual([`${COL}/attempts`]);
    expect(db.body(`${COL}/attempts`)).toEqual({ key: "attempts", value: { n: 3 } });
    expect(p.status().saving).toBe(false);

    const before = db.calls("set").length;
    for (let i = 0; i < 12; i++) {
      p.save(record({ attempts: { n: 100 + i } }));
      await vi.advanceTimersByTimeAsync(500);
    }
    expect(db.calls("set").length).toBeGreaterThan(before); // at most ~5 s between writes
  });

  it("moves to this browser when the account refuses writes, and prefers that copy next time", async () => {
    const db = new FakeDb();
    db.fail = (op) => (op === "set" || op === "delete" ? { code: "invalid_argument", message: "view-only" } : null);
    const storage = new FakeStorage();
    const p = await account(db, storage);
    await p.load();
    const statuses: PersistenceStatus[] = [];
    p.onStatus((s) => statuses.push(s));
    await saved(p, record());
    expect(p.mode).toBe("browser");
    expect(p.status().mode).toBe("browser");
    expect(p.status().error).toMatch(/browser/);
    expect(p.status().error).toMatch(/Claude account/);
    expect(statuses.at(-1)?.mode).toBe("browser");
    expect(JSON.parse(storage.getItem(COPY) ?? "null")).toEqual(record());
    expect(db.docs.size).toBe(0);

    const writes = db.calls("set").length;
    await saved(p, record({ attempts: { a: 1 } }));
    expect(db.calls("set").length).toBe(writes); // no more account writes this visit
    expect(JSON.parse(storage.getItem(COPY) ?? "null")).toEqual(record({ attempts: { a: 1 } }));

    // next visit: still account mode, and the copy (newer than the account) is what loads
    const q = await account(db, storage);
    expect(q.mode).toBe("account");
    expect(await q.load()).toEqual(record({ attempts: { a: 1 } }));

    // once the account accepts writes again, the copy goes there and is removed
    db.fail = null;
    const r = await account(db, storage);
    const data = await r.load();
    expect(data).toEqual(record({ attempts: { a: 1 } }));
    await saved(r, data as LearnerData);
    expect(r.mode).toBe("account");
    expect(storage.getItem(COPY)).toBeNull();
    expect(await (await account(db, storage)).load()).toEqual(record({ attempts: { a: 1 } }));
  });

  it("says so when the account's storage is full, and does not retry by itself", async () => {
    const db = new FakeDb();
    const p = await account(db);
    await p.load();
    db.fail = (op) => (op === "set" ? { code: "quota_exceeded", message: "documents in the collection" } : null);
    await saved(p, record());
    expect(p.mode).toBe("account");
    expect(p.status().error).toMatch(/full/);
    expect(p.status().saving).toBe(false);
    const attempts = db.calls("set").length;
    await new Promise((r) => setTimeout(r, 50));
    await p.flush();
    expect(db.calls("set").length).toBe(attempts);
  });

  it("retries a passing failure once", async () => {
    const db = new FakeDb();
    const p = await account(db);
    await p.load();
    let failures = 1;
    db.fail = (op) => (op === "set" && failures-- > 0 ? { code: "unavailable", message: "try again" } : null);
    await saved(p, record());
    expect(p.status().error).toBeNull();
    expect(await (await account(db)).load()).toEqual(record());
  });

  it("stops a save that hits a passing problem and tries again once, a few seconds later", async () => {
    vi.useFakeTimers();
    const db = new FakeDb();
    db.latency = 0;
    const p = await account(db);
    await p.load();
    db.fail = (op) => (op === "set" ? { code: "resource_exhausted", message: "too many writes" } : null);
    p.save(record());
    await vi.advanceTimersByTimeAsync(900);
    expect(db.calls("set")).toHaveLength(1); // the rest of the pass waits
    expect(p.status()).toMatchObject({ mode: "account", saving: true, error: expect.stringMatching(/trying again/) });
    await vi.advanceTimersByTimeAsync(8_000);
    expect(db.calls("set")).toHaveLength(2); // the one automatic retry
    expect(p.status()).toMatchObject({ saving: false, error: expect.stringMatching(/next change/) });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(db.calls("set")).toHaveLength(2); // and nothing more by itself

    db.fail = null;
    p.save(record());
    await vi.advanceTimersByTimeAsync(900);
    expect(p.status()).toEqual({ mode: "account", saving: false, error: null });
    expect(db.idsIn(COL)).toEqual(["attempts", "concept_states", "events", "schema", "~index"]);
  });

  it("erases every document on clear()", async () => {
    const db = new FakeDb();
    const storage = new FakeStorage();
    storage.setItem(COPY, JSON.stringify(record()));
    const p = await account(db, storage);
    await p.load();
    await saved(p, record({ events: events(300_000) }));
    expect(db.idsIn(COL).length).toBeGreaterThan(5);
    await p.clear();
    expect(db.idsIn(COL)).toEqual([]);
    expect(storage.getItem(COPY)).toBeNull();
    expect(await p.load()).toBeNull();
    expect(await (await account(db, storage)).load()).toBeNull();
    // and saving afterwards starts a fresh record
    await saved(p, record());
    expect(await (await account(db, storage)).load()).toEqual(record());
  });

  it("reads documents that a collection read left out", async () => {
    const db = new FakeDb();
    const data = record({ events: events(300_000) });
    await saved(await account(db), data);
    db.hidden.add(`${COL}/events`);
    db.hidden.add(`${COL}/${(db.body(`${COL}/events`).chunks as string[])[0]}`);
    expect(await (await account(db)).load()).toEqual(data);
  });

  it("leaves out a key whose chunks are missing, and says so", async () => {
    const db = new FakeDb();
    const data = record({ events: events(300_000) });
    await saved(await account(db), data);
    db.docs.delete(`${COL}/${(db.body(`${COL}/events`).chunks as string[])[0]}`);
    const p = await account(db);
    const loaded = await p.load();
    expect(loaded).toEqual({ schema: 1, concept_states: data.concept_states, attempts: {} });
    expect(p.status().error).toMatch(/couldn't be read/);
    // the next save replaces the broken key and removes its leftovers
    await saved(p, record());
    expect(db.idsIn(COL)).toEqual(["attempts", "concept_states", "events", "schema", "~index"]);
  });

  it("saves nothing this visit when the record cannot be read, so the account's copy is never overwritten", async () => {
    const db = new FakeDb();
    await saved(await account(db), record());
    db.fail = (op) => (op === "list" ? { code: "unavailable", message: "store unreachable" } : null);
    const p = await account(db);
    expect(await p.load()).toBeNull();
    expect(p.mode).toBe("memory");
    expect(p.status().error).toMatch(/couldn't be loaded/);
    const writes = db.calls("set").length;
    await saved(p, record({ attempts: { lost: true } }));
    expect(db.calls("set").length).toBe(writes);
    db.fail = null;
    expect(await (await account(db)).load()).toEqual(record());
  });

  it("tells status listeners when saving starts and ends", async () => {
    const db = new FakeDb();
    const p = await account(db);
    await p.load();
    const seen: PersistenceStatus[] = [];
    const stop = p.onStatus((s) => seen.push(s));
    await saved(p, record());
    expect(seen.map((s) => s.saving)).toEqual([true, false]);
    expect(p.status()).toBe(p.status()); // the same object until something changes
    stop();
    await saved(p, record({ attempts: { x: 1 } }));
    expect(seen.length).toBe(2);
  });
});
