/**
 * A stand-in for the claude.ai artifact runtime (`window.claude`) with the capabilities the standalone app uses:
 * `db` (an in-memory document store), `user`, `sample` (always answers with a scripted reply) and `downloads`.
 *
 * Injected with `page.addInitScript(installFakeClaude, options)`, which sends the function's source to the page,
 * so it must not refer to anything outside its own body. What the app did is recorded on `window.__fakeClaude`.
 * The stored documents survive a reload of the tab (they are kept in sessionStorage), like the real store.
 */
export type FakeClaudeOptions = { reply: Record<string, unknown>; userId: string };

export type FakeClaudeRecord = {
  docs: Record<string, Record<string, unknown>>;
  prompts: string[];
  downloads: { filename: string; data: string }[];
};

export function installFakeClaude({ reply, userId }: FakeClaudeOptions) {
  type Data = Record<string, unknown>;
  type Meta = { fromCache: boolean; hasPendingWrites: boolean };
  type Snap = { id: string; exists: boolean; data(): Data | undefined; metadata: Meta };
  type QuerySnap = { docs: Snap[]; size: number; empty: boolean; metadata: Meta; docChanges(): { type: string; doc: Snap; oldIndex: number; newIndex: number }[] };
  type DocRef = {
    id: string;
    path: string;
    get(): Promise<Snap>;
    set(data: Data): Promise<void>;
    update(data: Data): Promise<void>;
    delete(): Promise<void>;
    onSnapshot(next: (s: Snap) => void): () => void;
    collection(path: string): CollectionRef;
    acquire(): Promise<{ acquired: boolean }>;
  };
  type CollectionRef = {
    path: string;
    doc(id?: string): DocRef;
    add(data: Data): Promise<DocRef>;
    where(field: string, op: string, value: unknown): CollectionRef;
    orderBy(field: string, dir?: string): CollectionRef;
    limit(n: number): CollectionRef;
    get(): Promise<QuerySnap>;
    onSnapshot(next: (s: QuerySnap) => void): () => void;
  };

  const KEY = "__fakeClaudeDocs";
  const docs = new Map<string, Data>(Object.entries(JSON.parse(sessionStorage.getItem(KEY) ?? "{}") as Record<string, Data>));
  const record: FakeClaudeRecord = { docs: Object.fromEntries(docs), prompts: [], downloads: [] };
  const listeners = new Set<() => void>();
  const meta: Meta = { fromCache: false, hasPendingWrites: false };
  const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
  const dbError = (message: string) => Object.assign(new Error(message), { code: "invalid_argument" });
  const changed = () => {
    record.docs = Object.fromEntries(docs);
    sessionStorage.setItem(KEY, JSON.stringify(record.docs));
    for (const l of [...listeners]) setTimeout(l, 0);
  };
  const checkPath = (path: string, isDoc: boolean) => {
    const segs = path.split("/");
    if (segs.some((s) => !/^[A-Za-z0-9_\-.~:@+]+$/.test(s)) || (segs.length % 2 === 0) !== isDoc)
      throw new TypeError(`fake db: bad ${isDoc ? "document" : "collection"} path "${path}" (${segs.length} segments)`);
  };
  const snap = (path: string): Snap => {
    const body = docs.get(path);
    return { id: path.split("/").pop() ?? "", exists: body !== undefined, data: () => (body === undefined ? undefined : clone(body)), metadata: meta };
  };
  const listen = (fire: () => void) => {
    listeners.add(fire);
    setTimeout(fire, 0);
    return () => void listeners.delete(fire);
  };
  let nextId = 0;

  const docRef = (path: string): DocRef => {
    checkPath(path, true);
    return {
      id: path.split("/").pop() ?? "",
      path,
      get: async () => snap(path),
      set: async (data) => {
        if (JSON.stringify(data).length > 256 * 1024) throw dbError("document over 256 KiB");
        docs.set(path, clone(data));
        changed();
      },
      update: async (data) => {
        const body = docs.get(path);
        if (!body) throw dbError("update of a missing document");
        docs.set(path, { ...body, ...clone(data) });
        changed();
      },
      delete: async () => {
        docs.delete(path);
        changed();
      },
      onSnapshot: (next) => listen(() => next(snap(path))),
      collection: (sub) => collectionRef(`${path}/${sub}`),
      acquire: async () => ({ acquired: true }),
    };
  };

  const collectionRef = (path: string, max = Infinity): CollectionRef => {
    checkPath(path, false);
    const query = (): QuerySnap => {
      const found = [...docs.keys()]
        .filter((k) => k.slice(0, k.lastIndexOf("/")) === path)
        .sort()
        .slice(0, max)
        .map(snap);
      return {
        docs: found,
        size: found.length,
        empty: !found.length,
        metadata: meta,
        docChanges: () => found.map((doc, i) => ({ type: "added", doc, oldIndex: -1, newIndex: i })),
      };
    };
    return {
      path,
      doc: (id) => docRef(`${path}/${id ?? `doc${++nextId}`}`),
      add: async (data) => {
        const ref = docRef(`${path}/doc${++nextId}`);
        await ref.set(data);
        return ref;
      },
      where: () => collectionRef(path, max),
      orderBy: () => collectionRef(path, max),
      limit: (n) => collectionRef(path, n),
      get: async () => query(),
      onSnapshot: (next) => listen(() => next(query())),
    };
  };

  const text = JSON.stringify(reply);
  type SampleOptions = { onText?: (u: { text: string; delta: string }) => void };
  const sample = Object.assign(
    async (input: unknown, options?: SampleOptions) => {
      record.prompts.push(JSON.stringify(input));
      options?.onText?.({ text, delta: text });
      return { text, truncated: false, modelTierApplied: "default" };
    },
    {
      json: async (input: unknown, options?: SampleOptions) => {
        record.prompts.push(JSON.stringify(input));
        options?.onText?.({ text, delta: text });
        return clone(reply);
      },
      limits: async () => ({ maxPromptBytes: 262144 }),
    },
  );

  const capabilities: Record<string, unknown> = {
    db: Object.freeze({ doc: docRef, collection: (path: string) => collectionRef(path) }),
    user: Object.freeze({
      id: async () => userId,
      me: async () => ({ id: userId, name: "Test Learner" }),
      name: async () => "Test Learner",
      email: async () => null,
      avatarUrl: async () => null,
      isOwner: async () => true,
      canEdit: async () => true,
      can: async () => true,
      profiles: async () => [],
      search: async () => [],
    }),
    sample: Object.freeze(sample),
    downloads: Object.freeze({
      save: async ({ filename, data }: { filename: string; data: unknown }) => {
        record.downloads.push({ filename, data: String(data) });
        return { status: "saved" };
      },
    }),
  };
  Object.assign(window, {
    claude: Object.freeze({ use: async (name: string) => capabilities[name] ?? null }),
    __fakeClaude: record,
  });
}
