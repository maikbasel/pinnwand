import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// Separate config from the unit-test vite.config.ts so the existing fast jsdom
// suite doesn't pay for a Postgres container boot. Integration tests live
// alongside their unit under src/features/<feature>/ with the
// `.integration.test.ts` suffix.
export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "src"),
    },
  },
  test: {
    include: ["src/**/*.integration.test.ts"],
    environment: "node",
    globalSetup: ["./src/test/integration-setup.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 180_000,
  },
});
