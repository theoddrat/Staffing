import { defineConfig, devices } from "@playwright/test";

// End-to-end tests of the standalone single-file build (npm run build:standalone first): standalone/dist/ is
// served as static files and the page runs with no backend at all, as it does in a claude.ai artifact.
//
//   cd frontend && npm run build:standalone && npx playwright test -c standalone/playwright.config.ts
const PORT = 4317;

export default defineConfig({
  testDir: "./e2e",
  outputDir: "../test-results/standalone",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `python3 -m http.server ${PORT} --bind 127.0.0.1 --directory dist`,
    cwd: __dirname,
    url: `http://127.0.0.1:${PORT}/preview.html`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
