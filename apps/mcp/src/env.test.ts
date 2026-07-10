import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";

describe("parseEnv", () => {
  it("rejects a missing Supabase URL", () => {
    expect(() => parseEnv({})).toThrow();
  });
  it("parses a valid environment", () => {
    const env = parseEnv({
      SUPABASE_URL: "https://sb.example",
      SUPABASE_ANON_KEY: "anon",
      MCP_PUBLIC_URL: "https://mcp.example",
      PORT: "8787",
    });
    expect(env.SUPABASE_URL).toBe("https://sb.example");
    expect(env.PORT).toBe(8787);
  });
});
