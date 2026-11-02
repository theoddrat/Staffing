/**
 * Where the learner's record is saved in the standalone (artifact) build - see SPEC.md.
 *
 * Modes, best first, chosen by createPersistence():
 * - `account`: the artifact `db` capability, privately, in the viewer's own collection `data/users/<user id>`
 *   (needs `claude.use("db")`, `claude.use("user")` and a non-null `user.id()`);
 * - `browser`: localStorage, in this browser only (also where saving goes when the account refuses writes);
 * - `memory`: nothing is saved.
 * The mode can drop during the visit (a refused write, storage blocked); `status()` / `onStatus()` report it.
 *
 * Account layout - documents in `data/users/<user id>`:
 * - `<key>` for each top-level key of LearnerData (the key made path-safe): `{key, value}`, or, when the key's
 *   JSON is over ~200 KB, a manifest `{key, chunks, tail}`: the JSON text is cut into ~200 KB pieces, the full
 *   pieces go into chunk documents and the last (growing) piece stays in the manifest - so appending to a long
 *   list rewrites only the manifest;
 * - `<key>~<n>~<hash>` chunk documents `{key, i, part, at}`, named by their content and never rewritten: a save
 *   cut short leaves the previous manifest pointing at intact chunks;
 * - `~index` `{v, keys}`: the record's keys, so load can tell a missing document from a removed key.
 * A save writes the index (only when the keys change), then each changed key's new chunks and main document,
 * then deletes what nothing uses any more. Saves are debounced and every write runs one at a time.
 */
import type { LearnerData, Persistence, PersistenceMode, PersistenceStatus } from "./types";

// ------------------------------------------------------------------ the capabilities, as far as used here

type Body = Record<string, unknown>;
type DocSnapshot = { id: string; exists: boolean; data(): Body | undefined };
type QuerySnapshot = { docs: DocSnapshot[] };
type DocumentRef = { get(): Promise<DocSnapshot>; set(data: Body): Promise<void>; delete(): Promise<void> };
type CollectionRef = { get(): Promise<QuerySnapshot>; doc(id: string): DocumentRef };
type DbNamespace = { collection(path: string): CollectionRef };
type UserNamespace = { id(): Promise<string | null> };
type ClaudeGlobal = { use(name: string): Promise<unknown> };

const DEFAULT_KEY = "mathematical-universe:learner";
const INDEX_ID = "~index";
const DEBOUNCE_MS = 800;
/** A record that keeps changing is still saved at least this often. */
const MAX_WAIT_MS = 5_000;
/** `use()` resolves null by itself after about 10 s when the host never answers. */
const USE_TIMEOUT_MS = 10_000;
const ID_TIMEOUT_MS = 5_000;
const READ_TIMEOUT_MS = 15_000;
/** One automatic retry of a save that failed for a passing reason. */
const RETRY_AFTER_MS = 5_000;
/** Largest JSON (UTF-8 bytes) kept in one `{key, value}` document; documents hold at most 256 KiB. */
const VALUE_MAX_BYTES = 200_000;
/** Largest chunk, measured as the escaped JSON string it is stored as. */
const CHUNK_MAX_BYTES = 200_000;
/** Unused chunk documents younger than this may belong to a save still running in another tab. */
const ORPHAN_AGE_MS = 10 * 60_000;
/** Marks a tracked document whose stored body must not be trusted: it is rewritten or deleted next save. */
const UNTRUSTED = "\u0000untrusted";
/** Owner of documents that a failed clear() left behind: no LearnerData key, so the next save deletes them. */
const CLEARED = "\u0000cleared";

const MSG = {
  memory: "Not saved: this browser blocks storage, so your progress will be lost when you close or reload the page.",
  notSaved: "Not saved: your progress will be lost when you close or reload the page.",
  readOnly: "Saved in this browser only: this view can't save to your Claude account (for example, with view-only access).",
  readOnlyNoStorage: "Not saved: this view can't save to your Claude account and this browser blocks storage.",
  accountGone: "Saved in this browser only: saving to your Claude account stopped working in this view.",
  accountGoneNoStorage: "Not saved: saving to your Claude account stopped working and this browser blocks storage.",
  unreachable: "Not saved this visit: your saved progress couldn't be loaded from your Claude account. Reload the page to try again.",
  unreachableCopy: "Saved in this browser for now: your Claude account couldn't be reached.",
  quota: "Your latest progress wasn't saved: this page's storage in your Claude account is full. Download a backup to keep a copy.",
  transient: "Your latest progress couldn't be saved just now - trying again shortly.",
  transientFinal: "Your latest progress couldn't be saved just now. It will be saved with your next change.",
  partial: "Part of your saved progress couldn't be read and was left out.",
  browserFull: "Your latest progress wasn't saved: this browser's storage is full. Download a backup to keep a copy.",
  browserBlocked: "Not saved: this browser stopped allowing storage, so your progress will be lost when you reload the page.",
  browserCorrupt: "Your saved progress in this browser couldn't be read, so you are starting afresh.",
  unstorable: "Your latest progress couldn't be saved: it contains something that can't be stored.",
  clearFailed: "Your saved progress couldn't be fully erased. Please try again.",
} as const;

// ------------------------------------------------------------------ small helpers

const has = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);
const isRecord = (x: unknown): x is Body => typeof x === "object" && x !== null && !Array.isArray(x);
const isString = (x: unknown): x is string => typeof x === "string";
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function codeOf(e: unknown): string {
  return isRecord(e) && typeof e.code === "string" ? e.code : "unknown";
}

const KNOWN_CODES = new Set([
  "invalid_argument", "resource_exhausted", "quota_exceeded", "unavailable", "revoked", "not_granted",
  "capability_disabled", "capability_removed", "transform_error", "timeout",
]);

type Failure = "readonly" | "gone" | "quota" | "transient";

/** What a rejected db call means for saving (db.d.ts). */
function classify(code: string): Failure {
  if (code === "invalid_argument" || code === "transform_error") return "readonly"; // e.g. a view-only member
  if (code === "revoked" || code === "not_granted" || code === "capability_disabled" || code === "capability_removed") return "gone";
  if (code === "quota_exceeded") return "quota";
  return "transient"; // unavailable, resource_exhausted, timeout, anything unknown
}

/** db.d.ts: retry `unavailable` (and unknown codes, which count as `unavailable`) once after a short random delay. */
async function retryOnce<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const code = codeOf(e);
    if (code !== "unavailable" && KNOWN_CODES.has(code)) throw e;
    await sleep(250 + Math.random() * 750);
    return await fn();
  }
}

/** Rejects with `{code: "timeout"}` when `p` has not settled within `ms`. */
function within<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject({ code: "timeout", message: `no answer within ${ms} ms` }), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

function claudeGlobal(): ClaudeGlobal | null {
  try {
    const c = (globalThis as { window?: { claude?: unknown } }).window?.claude;
    return c && typeof (c as ClaudeGlobal).use === "function" ? (c as ClaudeGlobal) : null;
  } catch {
    return null;
  }
}

/** localStorage, or null when this page may not touch it (even reading the property can throw). */
function storage(): Storage | null {
  try {
    const s = (globalThis as { localStorage?: Storage }).localStorage;
    return s && typeof s.getItem === "function" ? s : null;
  } catch {
    return null;
  }
}

function removeItem(key: string): void {
  try {
    storage()?.removeItem(key);
  } catch {
    /* nothing to do */
  }
}

function isQuotaError(e: unknown): boolean {
  if (!isRecord(e)) return false;
  return e.name === "QuotaExceededError" || e.name === "NS_ERROR_DOM_QUOTA_REACHED" || e.code === 22 || e.code === 1014;
}

// ------------------------------------------------------------------ document layout

/** cyrb53: a fast 53-bit string hash, in base 36. */
function hash(s: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/**
 * The document id of a LearnerData key: the key itself when it is path-safe, otherwise each other character as
 * `+XXXX` (hex). `~` is never left in, so `~index` and the chunk ids `<id>~<n>~<hash>` cannot collide with a key.
 */
function docId(key: string): string {
  let out = "";
  for (let i = 0; i < key.length; i++) {
    const ch = key[i];
    out += /[A-Za-z0-9_.:@-]/.test(ch) ? ch : "+" + key.charCodeAt(i).toString(16).toUpperCase().padStart(4, "0");
  }
  if (out === "") return "+";
  if (out === "." || out === "..") return out.replace(/\./g, "+002E");
  return out.length > 120 ? `${out.slice(0, 100)}~h${hash(key)}` : out; // segments hold at most 200 bytes
}

function utf8Length(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

/**
 * Cut JSON text into pieces that each take at most `max` bytes once stored as a JSON string (quotes and
 * backslashes are escaped there), never between the two halves of a surrogate pair. Greedy from the start, so
 * text that only grows at its end keeps every earlier piece unchanged.
 */
function splitText(text: string, max: number): string[] {
  const parts: string[] = [];
  let start = 0;
  let size = 0;
  for (let i = 0; i < text.length; ) {
    const c = text.charCodeAt(i);
    let width = 1;
    let cost: number;
    if (c >= 0xd800 && c <= 0xdbff && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      width = 2;
      cost = 4;
    } else if (c >= 0xd800 && c <= 0xdfff) cost = 6; // a lone surrogate is written as \uXXXX
    else if (c === 0x22 || c === 0x5c) cost = 2;
    else if (c < 0x20) cost = c === 8 || c === 9 || c === 10 || c === 12 || c === 13 ? 2 : 6;
    else if (c < 0x80) cost = 1;
    else if (c < 0x800) cost = 2;
    else cost = 3;
    if (size + cost > max && i > start) {
      parts.push(text.slice(start, i));
      start = i;
      size = 0;
    }
    size += cost;
    i += width;
  }
  parts.push(text.slice(start));
  return parts;
}

const valueJson = (key: string, text: string) => `{"key":${JSON.stringify(key)},"value":${text}}`;
const manifestJson = (key: string, chunks: string[], tail: string) => JSON.stringify({ key, chunks, tail });
const indexJson = (keys: string[]) => JSON.stringify({ v: 1, keys });
const isMain = (b: Body): boolean => isString(b.key) && (has(b, "value") || (Array.isArray(b.chunks) && isString(b.tail)));

type KeyPlan = {
  key: string;
  mainId: string;
  /** The main document (value or manifest) serialised: what is compared with the stored one. */
  mainJson: string;
  mainBody: () => Body;
  chunks: { id: string; i: number; part: string }[];
  /** Every document this key uses. */
  ids: Set<string>;
};

/** The documents that hold one key's value; null when the value is not JSON (undefined, a function). */
function planKey(key: string, value: unknown): KeyPlan | null {
  const text = JSON.stringify(value) as string | undefined;
  if (text === undefined) return null;
  const mainId = docId(key);
  if (utf8Length(text) <= VALUE_MAX_BYTES) {
    const mainBody = () => ({ key, value: JSON.parse(text) as unknown });
    return { key, mainId, mainJson: valueJson(key, text), mainBody, chunks: [], ids: new Set([mainId]) };
  }
  const parts = splitText(text, CHUNK_MAX_BYTES);
  const tail = parts.pop() ?? "";
  const chunks = parts.map((part, i) => ({ id: `${mainId}~${i}~${hash(part)}`, i, part }));
  const chunkIds = chunks.map((c) => c.id);
  return {
    key, mainId, mainJson: manifestJson(key, chunkIds, tail), mainBody: () => ({ key, chunks: chunkIds, tail }), chunks,
    ids: new Set([mainId, ...chunkIds]),
  };
}

// ------------------------------------------------------------------ the persistence object

type Init = {
  mode: PersistenceMode;
  /** localStorage key of the browser-only record. */
  storageKey: string;
  col?: CollectionRef;
  /**
   * Account mode: the localStorage key of the copy kept when the account refuses writes. It is newer than the
   * account record while it exists (load prefers it) and is removed once the account has accepted a full save.
   */
  copyKey?: string;
  memory?: LearnerData | null;
  /** Standing explanation of the mode, shown as `status().error`. */
  note?: string | null;
};

class LearnerPersistence implements Persistence {
  private mode_: PersistenceMode;
  private storageKey: string;
  private readonly col: CollectionRef | null;
  private readonly copyKey: string | null;
  private memory: LearnerData | null;
  private modeNote: string | null;
  private loadNote: string | null = null;
  private saveError: string | null = null;
  private readonly listeners = new Set<(s: PersistenceStatus) => void>();
  /** The last status handed out (returned again while nothing changes) and the last one listeners heard. */
  private shown: PersistenceStatus | null = null;
  private emitted: PersistenceStatus;

  private latest: LearnerData | null = null;
  private dirty = false;
  private firstDirtyAt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryAllowed = true;
  private queued = false;
  private busy = 0;
  /** Every save pass, load and clear runs on this chain, one after another. */
  private chain: Promise<void> = Promise.resolve();

  /** Account: document id -> its serialised body as stored ("" for chunks, whose id names their content). */
  private readonly written = new Map<string, string>();
  /** Account: document id -> the LearnerData key it belongs to. */
  private readonly owner = new Map<string, string>();
  private usingCopy = false;
  /** Browser: the JSON localStorage holds under storageKey, as last read or written. */
  private stored: string | null = null;

  constructor(init: Init) {
    this.mode_ = init.mode;
    this.storageKey = init.storageKey;
    this.col = init.col ?? null;
    this.copyKey = init.copyKey ?? null;
    this.memory = init.memory ?? null;
    this.modeNote = init.note ?? null;
    this.emitted = this.status();
  }

  get mode(): PersistenceMode {
    return this.mode_;
  }

  status(): PersistenceStatus {
    const s = {
      mode: this.mode_,
      saving: this.timer !== null || this.retryTimer !== null || this.busy > 0,
      error: this.saveError ?? this.loadNote ?? this.modeNote,
    };
    const last = this.shown;
    if (last && last.mode === s.mode && last.saving === s.saving && last.error === s.error) return last;
    this.shown = Object.freeze(s);
    return this.shown;
  }

  onStatus(cb: (s: PersistenceStatus) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private emit(): void {
    const now = this.status();
    const prev = this.emitted;
    if (prev.mode === now.mode && prev.saving === now.saving && prev.error === now.error) return;
    this.emitted = now;
    for (const cb of [...this.listeners]) {
      try {
        cb(now);
      } catch {
        /* a listener's own problem */
      }
    }
  }

  // -------------------------------------------------------------- save / flush

  save(data: LearnerData): void {
    try {
      this.latest = data;
      if (this.mode_ === "memory") {
        this.saveToMemory(data);
      } else {
        this.dirty = true;
        this.retryAllowed = true;
        if (this.retryTimer) {
          clearTimeout(this.retryTimer);
          this.retryTimer = null;
        }
        const now = Date.now();
        if (!this.firstDirtyAt) this.firstDirtyAt = now;
        if (this.timer) clearTimeout(this.timer);
        const wait = Math.max(0, Math.min(DEBOUNCE_MS, this.firstDirtyAt + MAX_WAIT_MS - now));
        this.timer = setTimeout(() => {
          this.timer = null;
          void this.kick();
        }, wait);
      }
    } catch {
      /* save() never throws */
    }
    this.emit();
  }

  async flush(): Promise<void> {
    for (let round = 0; round < 8; round++) {
      if (this.retryTimer) {
        clearTimeout(this.retryTimer);
        this.retryTimer = null;
        this.dirty = true;
      }
      const pending = this.kick();
      await pending;
      if (pending === this.chain && !this.timer && !this.dirty && !this.retryTimer) return;
    }
  }

  /** Queue a save pass for the latest data now (unless one is already waiting to start: it will read the latest). */
  private kick(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.dirty) {
      this.dirty = false;
      this.firstDirtyAt = 0;
      if (!this.queued) {
        this.queued = true;
        this.busy++;
        this.chain = this.chain
          .then(() => {
            this.queued = false;
            return this.pass();
          })
          .catch(() => undefined)
          .then(() => {
            this.busy--;
            this.emit();
          });
      }
    }
    this.emit();
    return this.chain;
  }

  private async pass(): Promise<void> {
    const data = this.latest;
    if (!data) return;
    if (this.mode_ === "account") await this.saveToAccount(data);
    else if (this.mode_ === "browser") this.saveToBrowser(data);
    else this.saveToMemory(data);
  }

  private saveToMemory(data: LearnerData): void {
    try {
      this.memory = clone(data);
      this.saveError = null;
    } catch {
      this.saveError = MSG.unstorable;
    }
  }

  /** False when this browser no longer allows storage (the mode is then `memory`). */
  private saveToBrowser(data: LearnerData): boolean {
    let json: string;
    try {
      json = JSON.stringify(data);
    } catch {
      this.saveError = MSG.unstorable;
      return true;
    }
    if (json === this.stored) {
      this.saveError = null;
      return true;
    }
    try {
      const s = storage();
      if (!s) throw new Error("localStorage is not available");
      s.setItem(this.storageKey, json);
      this.stored = json;
      this.saveError = null;
    } catch (e) {
      if (isQuotaError(e)) {
        this.saveError = MSG.browserFull;
      } else {
        this.toMemory(data, MSG.browserBlocked);
        return false;
      }
    }
    return true;
  }

  private toMemory(data: LearnerData | null, note: string): void {
    this.mode_ = "memory";
    this.modeNote = note;
    this.saveError = null;
    try {
      this.memory = data ? clone(data) : null;
    } catch {
      this.memory = null;
    }
  }

  /** The account refused a write: keep saving in this browser (the copy load() prefers next time). */
  private toBrowserCopy(data: LearnerData, kind: "readonly" | "gone"): void {
    this.mode_ = "browser";
    this.storageKey = this.copyKey ?? this.storageKey;
    this.stored = null;
    this.saveError = null;
    this.usingCopy = false;
    this.modeNote = kind === "readonly" ? MSG.readOnly : MSG.accountGone;
    if (!this.saveToBrowser(data)) this.modeNote = kind === "readonly" ? MSG.readOnlyNoStorage : MSG.accountGoneNoStorage;
  }

  private async saveToAccount(data: LearnerData): Promise<void> {
    const col = this.col as CollectionRef;
    let plans: KeyPlan[];
    try {
      plans = Object.keys(data)
        .map((k) => planKey(k, data[k]))
        .filter((p): p is KeyPlan => p !== null);
    } catch {
      this.saveError = MSG.unstorable;
      return;
    }
    const byKey = new Map(plans.map((p) => [p.key, p] as const));
    const outcome: { failure: "quota" | "transient" | null } = { failure: null };
    /**
     * Note a failed call; true when this pass must stop: the account refuses writes (saving moves to the
     * browser), or a passing problem (the rest waits for the one retry). A full account goes on: writes to
     * existing documents may still succeed.
     */
    const failed = (e: unknown): boolean => {
      const kind = classify(codeOf(e));
      if (kind === "readonly" || kind === "gone") {
        this.toBrowserCopy(data, kind);
        return true;
      }
      if (kind === "quota") {
        outcome.failure = "quota";
        return false;
      }
      this.settle("transient");
      return true;
    };
    const put = async (id: string, key: string | null, body: Body, json: string) => {
      await retryOnce(() => col.doc(id).set(body));
      this.written.set(id, json);
      if (key !== null) this.owner.set(id, key);
    };

    // 1. The index, when the keys changed: it lists a key before that key's documents exist.
    const index = indexJson(plans.map((p) => p.key));
    if (this.written.get(INDEX_ID) !== index) {
      try {
        await put(INDEX_ID, null, JSON.parse(index) as Body, index);
      } catch (e) {
        if (!failed(e)) this.settle(outcome.failure);
        return;
      }
    }
    // 2. Each changed key: its new chunks first, its main document last.
    const complete = new Set<string>();
    for (const p of plans) {
      try {
        for (const c of p.chunks) {
          if (!this.written.has(c.id)) await put(c.id, p.key, { key: p.key, i: c.i, part: c.part, at: Date.now() }, "");
        }
        if (this.written.get(p.mainId) !== p.mainJson) await put(p.mainId, p.key, p.mainBody(), p.mainJson);
        complete.add(p.key);
      } catch (e) {
        if (failed(e)) return;
      }
    }
    // 3. What nothing uses any more: removed keys, and old chunks of keys that were saved in full.
    for (const id of [...this.written.keys()]) {
      const key = this.owner.get(id);
      if (id === INDEX_ID || key === undefined) continue;
      const p = byKey.get(key);
      if (p && (!complete.has(key) || p.ids.has(id))) continue;
      try {
        await retryOnce(() => col.doc(id).delete());
        this.written.delete(id);
        this.owner.delete(id);
      } catch (e) {
        if (failed(e)) return;
      }
    }
    this.settle(outcome.failure);
  }

  private settle(failure: "quota" | "transient" | null): void {
    if (failure === "quota") {
      this.saveError = MSG.quota; // retrying cannot help: wait for the learner's next change
    } else if (failure === "transient") {
      this.saveError = this.retryAllowed ? MSG.transient : MSG.transientFinal;
      this.scheduleRetry();
    } else {
      this.saveError = null;
      if (this.usingCopy && this.copyKey) {
        this.usingCopy = false;
        removeItem(this.copyKey); // the account has everything now
      }
    }
  }

  private scheduleRetry(): void {
    if (!this.retryAllowed || this.retryTimer || this.dirty || this.timer) return;
    this.retryAllowed = false;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.dirty = true;
      void this.kick();
    }, RETRY_AFTER_MS + Math.random() * 2_000);
  }

  // -------------------------------------------------------------- load

  async load(): Promise<LearnerData | null> {
    await this.flush();
    const run = this.chain.then(() => this.loadNow());
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    try {
      return await run;
    } catch {
      return null;
    } finally {
      this.emit();
    }
  }

  private async loadNow(): Promise<LearnerData | null> {
    if (this.mode_ === "memory") return this.memory ? clone(this.memory) : null;
    if (this.mode_ === "browser") return this.loadFromBrowser();
    return this.loadFromAccount();
  }

  private loadFromBrowser(): LearnerData | null {
    let raw: string | null;
    try {
      const s = storage();
      if (!s) throw new Error("localStorage is not available");
      raw = s.getItem(this.storageKey);
    } catch {
      this.toMemory(null, MSG.memory);
      return null;
    }
    if (raw === null) {
      this.stored = null;
      return null;
    }
    try {
      const data: unknown = JSON.parse(raw);
      if (isRecord(data)) {
        this.stored = raw;
        return data as LearnerData;
      }
    } catch {
      /* unreadable */
    }
    this.loadNote = MSG.browserCorrupt;
    return null;
  }

  private readCopy(): { raw: string; data: LearnerData } | null {
    if (!this.copyKey) return null;
    try {
      const raw = storage()?.getItem(this.copyKey);
      if (!isString(raw)) return null;
      const data: unknown = JSON.parse(raw);
      return isRecord(data) ? { raw, data: data as LearnerData } : null;
    } catch {
      return null;
    }
  }

  private track(id: string, key: string, json: string): void {
    this.written.set(id, json);
    this.owner.set(id, key);
  }

  private async loadFromAccount(): Promise<LearnerData | null> {
    const col = this.col as CollectionRef;
    this.written.clear();
    this.owner.clear();
    this.usingCopy = false;
    this.loadNote = null;
    const bodies = new Map<string, Body>();
    /** A document's body: from the collection read, else read on its own (a collection read may be partial). */
    const fetchBody = async (id: string): Promise<Body | null> => {
      const known = bodies.get(id);
      if (known) return known;
      const snap = await retryOnce(() => within(col.doc(id).get(), READ_TIMEOUT_MS));
      const body = snap && snap.exists !== false ? snap.data() : undefined;
      if (!isRecord(body)) return null;
      bodies.set(id, body);
      return body;
    };
    const data: Record<string, unknown> = {};
    let found = 0;
    let damaged = false;
    try {
      const snap = await retryOnce(() => within(col.get(), READ_TIMEOUT_MS));
      for (const d of snap?.docs ?? []) {
        if (!d || d.exists === false) continue;
        const body = d.data();
        if (isRecord(body)) bodies.set(d.id, body);
      }
      const index = bodies.size > 0 ? await fetchBody(INDEX_ID) : null;
      const listed = index && Array.isArray(index.keys) ? index.keys.filter(isString) : null;
      if (listed) this.written.set(INDEX_ID, indexJson(listed));
      const keys = listed ?? [...new Set([...bodies.values()].filter(isMain).map((b) => b.key as string))];
      for (const key of keys) {
        const id = docId(key);
        const body = await fetchBody(id);
        if (!body || body.key !== key || !isMain(body)) continue; // listed, but its first save never landed
        const read = await this.readKey(key, id, body, fetchBody, bodies);
        if (read) {
          data[key] = read.value;
          found++;
        } else damaged = true;
      }
      // Tidy up on the next save: documents of keys the index no longer lists, and old chunks nothing uses.
      const now = Date.now();
      for (const [id, b] of bodies) {
        if (id === INDEX_ID || this.written.has(id) || !isString(b.key)) continue;
        if (isMain(b)) {
          if (!keys.includes(b.key)) this.track(id, b.key, UNTRUSTED);
        } else if (isString(b.part) && now - (typeof b.at === "number" ? b.at : 0) > ORPHAN_AGE_MS) {
          this.track(id, b.key, "");
        }
      }
    } catch (e) {
      return this.accountUnreadable(e);
    }
    if (damaged) this.loadNote = MSG.partial;
    const copy = this.readCopy();
    if (copy) {
      this.usingCopy = true; // saved here when the account refused writes: newer than the account record
      return copy.data;
    }
    return found > 0 ? (data as LearnerData) : null;
  }

  /** One key's value from its main document (and chunks); null when it cannot be put back together. */
  private async readKey(
    key: string,
    id: string,
    body: Body,
    fetchBody: (id: string) => Promise<Body | null>,
    bodies: Map<string, Body>,
  ): Promise<{ value: unknown } | null> {
    if (has(body, "value")) {
      const text = JSON.stringify(body.value) as string | undefined;
      if (text === undefined) {
        this.track(id, key, UNTRUSTED);
        return null;
      }
      this.track(id, key, valueJson(key, text));
      return { value: JSON.parse(text) as unknown }; // a fresh copy: delivered snapshots are frozen
    }
    const chunkIds = body.chunks as unknown[];
    const tail = body.tail as string;
    const parts: string[] = [];
    let complete = chunkIds.every(isString);
    for (const cid of complete ? (chunkIds as string[]) : []) {
      const chunk = await fetchBody(cid);
      if (!chunk || !isString(chunk.part)) {
        complete = false;
        break;
      }
      parts.push(chunk.part);
    }
    let value: unknown;
    if (complete) {
      try {
        value = JSON.parse(parts.join("") + tail);
      } catch {
        complete = false;
      }
    }
    if (!complete) {
      this.track(id, key, UNTRUSTED);
      for (const cid of chunkIds) if (isString(cid) && bodies.has(cid)) this.track(cid, key, "");
      return null;
    }
    this.track(id, key, manifestJson(key, chunkIds as string[], tail));
    for (const cid of chunkIds as string[]) this.track(cid, key, "");
    return { value };
  }

  private accountUnreadable(e: unknown): LearnerData | null {
    this.written.clear();
    this.owner.clear();
    const kind = classify(codeOf(e));
    if (kind === "readonly" || kind === "gone") {
      this.mode_ = "browser"; // this view cannot use the account at all: as if there were none
      this.modeNote = null;
      return this.loadFromBrowser();
    }
    const copy = this.readCopy();
    if (copy && this.copyKey) {
      this.mode_ = "browser";
      this.storageKey = this.copyKey;
      this.stored = copy.raw;
      this.modeNote = MSG.unreachableCopy;
      return copy.data;
    }
    // Starting afresh in the account (or in a browser copy that load() would prefer) could overwrite the
    // real record, so nothing from this visit is saved.
    this.toMemory(null, MSG.unreachable);
    return null;
  }

  // -------------------------------------------------------------- clear

  async clear(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.dirty = false;
    this.firstDirtyAt = 0;
    this.latest = null;
    this.busy++;
    this.emit();
    this.chain = this.chain
      .then(() => this.clearNow())
      .catch(() => undefined)
      .then(() => {
        this.busy--;
        this.emit();
      });
    await this.chain;
  }

  private async clearNow(): Promise<void> {
    this.loadNote = null;
    this.saveError = null;
    if (this.mode_ === "memory") {
      this.memory = null;
      return;
    }
    if (this.mode_ === "browser") removeItem(this.storageKey);
    if (this.copyKey) removeItem(this.copyKey);
    this.stored = null;
    this.usingCopy = false;
    if (this.mode_ !== "account" || !this.col) return;
    const col = this.col;
    let ids: string[] = [];
    try {
      const snap = await within(col.get(), READ_TIMEOUT_MS);
      ids = (snap?.docs ?? []).filter((d) => d && d.exists !== false).map((d) => d.id);
    } catch {
      /* delete what this page knows about */
    }
    for (const id of this.written.keys()) if (!ids.includes(id)) ids.push(id);
    ids.sort((a, b) => Number(b === INDEX_ID) - Number(a === INDEX_ID)); // the index first
    let failedAny = false;
    for (const id of ids) {
      try {
        await retryOnce(() => col.doc(id).delete());
        this.written.delete(id);
        this.owner.delete(id);
      } catch {
        failedAny = true; // the next save rewrites or deletes it
        this.written.set(id, UNTRUSTED);
        if (!this.owner.has(id)) this.owner.set(id, CLEARED);
      }
    }
    if (failedAny) this.saveError = MSG.clearFailed;
  }
}

// ------------------------------------------------------------------ factories

const isDb = (x: unknown): x is DbNamespace => !!x && typeof (x as { collection?: unknown }).collection === "function";
const isUser = (x: unknown): x is UserNamespace => !!x && typeof (x as { id?: unknown }).id === "function";

/** The viewer's private collection, when this view can use `db` and knows who the viewer is. */
async function connectAccount(claude: ClaudeGlobal): Promise<{ col: CollectionRef; userId: string } | null> {
  const capability = (name: string): Promise<unknown> =>
    Promise.resolve()
      .then(() => claude.use(name))
      .catch(() => null);
  const [db, user] = await within(Promise.all([capability("db"), capability("user")]), USE_TIMEOUT_MS).catch(() => [null, null]);
  if (!isDb(db) || !isUser(user)) return null;
  const id = await within(
    Promise.resolve().then(() => user.id()),
    ID_TIMEOUT_MS,
  ).catch(() => null);
  if (!isString(id) || id === "") return null;
  try {
    return { col: db.collection(`data/users/${id}`), userId: id };
  } catch {
    return null; // an id that is not a valid path segment
  }
}

function browserOrMemory(key: string): Persistence {
  const s = storage();
  let existing: LearnerData | null = null;
  let readable = false;
  let writable = false;
  if (s) {
    try {
      const raw = s.getItem(key);
      readable = true;
      const parsed: unknown = raw === null ? null : JSON.parse(raw);
      if (isRecord(parsed)) existing = parsed as LearnerData;
    } catch {
      /* blocked, or an unreadable record */
    }
    try {
      const probe = `${key}:probe`;
      s.setItem(probe, "1");
      s.removeItem(probe);
      writable = true;
    } catch (e) {
      writable = isQuotaError(e); // full is still usable: saves report it
    }
  }
  if (readable && writable) return new LearnerPersistence({ mode: "browser", storageKey: key });
  return new LearnerPersistence({ mode: "memory", storageKey: key, memory: existing, note: MSG.memory });
}

/**
 * The best persistence this view allows: the viewer's Claude account, else this browser, else memory. Resolves
 * within about 15 s even when the host never answers. Read `mode` / `status()` after `load()`: a record that
 * cannot be read, or a write the account refuses, moves to a lower mode.
 */
export async function createPersistence(opts?: { key?: string }): Promise<Persistence> {
  const key = opts?.key || DEFAULT_KEY;
  const claude = claudeGlobal();
  const account = claude ? await connectAccount(claude) : null;
  if (account) {
    return new LearnerPersistence({ mode: "account", storageKey: key, col: account.col, copyKey: `${key}:${account.userId}` });
  }
  return browserOrMemory(key);
}

/** Keeps the record in memory only (tests, and the last resort): load() returns a copy of what was last saved. */
export function memoryPersistence(initial?: LearnerData | null): Persistence {
  let memory: LearnerData | null = null;
  try {
    memory = initial ? clone(initial) : null;
  } catch {
    memory = null;
  }
  return new LearnerPersistence({ mode: "memory", storageKey: DEFAULT_KEY, memory, note: MSG.notSaved });
}
