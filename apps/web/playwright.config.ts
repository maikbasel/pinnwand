// Load `.env` so ad-hoc local runs (`pnpm exec playwright test`) pick up
// SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, MAILPIT_URL, and
// PLAYWRIGHT_BASE_URL without manual env-var exports. CI and the containerized
// `pnpm e2e` flow get these from docker-compose.e2e.yml so the missing-file
// path is a no-op there.
import "dotenv/config";
import { defineConfig, devices } from "@playwright/test";

const isCI = !!process.env.CI;
// Default targets `pnpm preview` (4173). The containerized e2e stack overrides
// this to http://localhost:8080 (the web/caddy container) via PLAYWRIGHT_BASE_URL.
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:4173";

export default defineConfig({
  testDir: "./e2e",
  globalTeardown: "./e2e/global-teardown.ts",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  // Bail after 10 failures in CI: stops a systemically-broken suite from
  // grinding through every test × 3 attempts before exiting.
  maxFailures: isCI ? 10 : undefined,
  reporter: isCI
    ? [["dot"], ["github"]]
    : [
        ["html", { outputFolder: "playwright-report", open: "never" }],
        ["list"],
      ],
  outputDir: "test-results",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"] },
    },
    {
      name: "mobile-webkit",
      use: { ...devices["iPhone 14"] },
    },
  ],
  // No `webServer` block: e2e is fully containerized via `pnpm e2e`
  // (docker-compose.e2e.yml). For ad-hoc local runs, bring up the stack
  // yourself (`pnpm dev:up && pnpm preview`) and invoke `pnpm exec playwright
  // test`; env vars come from `.env` via dotenv above.
});
