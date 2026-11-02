// TEMPORARY stand-in for src/local/{server,persistence,ai}.ts while they are being written (deleted before the
// final build). Answers just enough for the shell, the curriculum and the map to render.
import type { ContentJson, LearnerData, Persistence, PersistenceStatus } from "@/local/types";

export const ai = {};

export async function createPersistence(): Promise<Persistence> {
  const status: PersistenceStatus = { mode: "memory", saving: false, error: null };
  return {
    mode: "memory",
    load: async () => null,
    save: (d: LearnerData) => void d,
    flush: async () => {},
    clear: async () => {},
    status: () => status,
    onStatus: () => () => {},
  };
}

class StubError extends Error {
  constructor(
    public status: number,
    public detail: string,
  ) {
    super(detail);
  }
}

export async function createServer({ content }: { content: ContentJson; persistence: Persistence; ai: unknown }) {
  return {
    async handle(method: string, path: string) {
      if (method === "GET" && path === "/health")
        return { status: "ok", version: "dev-stub", lessons_available: Object.keys(content.lessons).length, lessons_planned: 0, terms: 0 };
      if (method === "GET" && path === "/ai/status") return { configured: false, provider: "claude", model: null, reason: "Dev stub." };
      if (method === "GET" && path === "/dictionary") return [];
      if (method === "GET" && path === "/curriculum")
        return {
          stages: content.curriculum.stages,
          lessons: content.curriculum.lessons.map((l) => ({ ...l, available: l.id in content.lessons, feeds: content.feeds[l.id] ?? [] })),
        };
      throw new StubError(404, `The dev stub does not answer ${method} ${path}`);
    },
  };
}
