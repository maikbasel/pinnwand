import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // env.ts zod-parses process.env at module load (`export const env = parseEnv(process.env)`).
    // Supply dummy values here (never real secrets) so importing env.ts in tests doesn't throw.
    env: {
      SUPABASE_URL: "http://localhost:54321",
      SUPABASE_ANON_KEY: "test-anon-key-not-a-real-secret-0000000000",
      MCP_PUBLIC_URL: "http://localhost:8787",
    },
    // Integration tests hit a real running Supabase stack and have their own
    // vitest.integration.config.ts; keep them out of the fast unit run.
    exclude: ["**/node_modules/**", "**/dist/**", "**/*.integration.test.ts"],
  },
});
