import { defineConfig, devices } from "@playwright/test";

// End-to-end tests run the real backend (with a throwaway database and AI switched off)
// and the Next.js dev server on spare ports.
const BACKEND_PORT = 8010;
const FRONTEND_PORT = 3010;

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  // The Next.js dev server only serves its scripts to localhost by default (see allowedDevOrigins).
  use: { baseURL: `http://localhost:${FRONTEND_PORT}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: `cd ../backend && rm -f data/e2e.db* && MATH_DATABASE_URL=sqlite:///data/e2e.db MATH_AI_PROVIDER=none .venv/bin/uvicorn app.main:app --port ${BACKEND_PORT}`,
      url: `http://127.0.0.1:${BACKEND_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `BACKEND_URL=http://127.0.0.1:${BACKEND_PORT} npx next dev -p ${FRONTEND_PORT}`,
      url: `http://localhost:${FRONTEND_PORT}`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
