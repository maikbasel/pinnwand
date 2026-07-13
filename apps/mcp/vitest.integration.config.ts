import { defineConfig } from "vitest/config";

// Separate config from vitest.config.ts so the fast unit suite never boots
// containers. globalSetup stands up the real REST + RLS stack (Postgres +
// PostgREST + kong) in testcontainers and exports its URL/keys via
// process.env, which env.ts zod-parses when the worker imports it. See
// src/test/integration-setup.ts.
export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.integration.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    globalSetup: ["./src/test/integration-setup.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 240_000,
  },
});
