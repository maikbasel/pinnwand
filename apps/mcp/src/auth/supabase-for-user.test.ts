import { describe, expect, it, vi } from "vitest";

const SERVICE_ROLE_PATTERN = /SERVICE_ROLE/;

const createClient = vi.fn();
vi.mock("@supabase/supabase-js", () => ({ createClient }));

describe("supabaseForUser", () => {
  it("configures the client with the bearer token and no session persistence", async () => {
    const { supabaseForUser } = await import("./supabase-for-user");
    supabaseForUser("token-abc");

    expect(createClient).toHaveBeenCalledTimes(1);
    const [url, key, options] = createClient.mock.calls[0];
    expect(url).toBe("http://localhost:54321");
    expect(key).toBe("test-anon-key-not-a-real-secret-0000000000");
    expect(options).toMatchObject({
      global: { headers: { Authorization: "Bearer token-abc" } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
  });

  it("never references a service-role key", async () => {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("./supabase-for-user.ts", import.meta.url), "utf8")
    );
    expect(source).not.toMatch(SERVICE_ROLE_PATTERN);
    expect(source).toContain("env.SUPABASE_ANON_KEY");
  });
});
