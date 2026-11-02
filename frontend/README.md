# The Mathematical Universe: frontend

Next.js (App Router) + React + TypeScript + Tailwind v4, with KaTeX for mathematics. See the
[root README](../README.md) for the whole project and [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) for how
the pieces fit together.

```bash
npm install
npm run dev          # http://localhost:3000; expects the backend on http://127.0.0.1:8000 (override with BACKEND_URL)
npm run build && npm start
```

| Command | What it does |
|---|---|
| `npm run typecheck` | TypeScript, no emit |
| `npm run lint` | ESLint |
| `npm test` | Vitest unit tests: rich-text parser, number utilities, and a content test that renders every formula in `content/` with KaTeX |
| `npm run e2e` | Playwright: starts a throwaway backend (AI off) on :8010 and `next dev` on :3010, then drives the real UI |
| `npm run gen:api` | Regenerates `src/lib/api-schema.ts` from the backend's OpenAPI schema |

All `/api/*` requests are rewritten to the backend (`next.config.ts`), so the browser talks to one origin and no
API key ever reaches it.
