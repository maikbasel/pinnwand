import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Database } from "@pinnwand/contracts";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { createMcpServer } from "./server";

// Real client, never used to make a network call in this test — mirrors how
// supabaseForUser builds one, just pointed at dummy config so ToolContext
// doesn't need an `any`/cast escape hatch.
function fakeSupabase() {
  return createClient<Database>(
    "http://localhost:54321",
    "test-anon-key-not-a-real-secret-0000000000"
  );
}

async function connectedClient(userId: string) {
  const server = createMcpServer({ supabase: fakeSupabase(), userId });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  return client;
}

describe("createMcpServer", () => {
  it("exposes a whoami tool", async () => {
    const client = await connectedClient("user-x");
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain("whoami");
  });

  it("returns the context userId when whoami is called", async () => {
    const client = await connectedClient("user-x");
    const result = await client.callTool({ name: "whoami", arguments: {} });
    expect(result.content).toEqual([{ type: "text", text: "user-x" }]);
  });
});
