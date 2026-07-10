import { defineConfig } from "vitest/config";

// Separate config from vitest.config.ts so the fast unit suite never touches
// the network. Points at a REAL, already-running Supabase stack (see
// rls-impersonation.integration.test.ts) rather than mocks or a testcontainer.
export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.integration.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    // env.ts zod-parses process.env at module load; these point the mcp at
    // the already-running local Supabase stack (never real prod secrets).
    env: {
      SUPABASE_URL: "http://localhost:58000",
      SUPABASE_ANON_KEY:
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.b_lMH2mc5km7S9Lw_sRGGqE9IeiahYu-caevDcacKiY",
      SUPABASE_JWT_SECRET:
        "your-super-secret-jwt-token-with-at-least-32-characters-long",
      MCP_PUBLIC_URL: "http://localhost:8787",
    },
    testTimeout: 30_000,
  },
});
