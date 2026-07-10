import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Database } from "@pinnwand/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { registerMemberTools } from "./members";

type QueryResult = {
  data: unknown;
  error: { code: string; message: string } | null;
};

// Minimal thenable query-builder double, same shape as boards.test.ts's,
// extended with `.order()` for the select("...").eq().order() chain
// list_board_members issues.
type FakeQueryBuilder = {
  select: (..._args: unknown[]) => FakeQueryBuilder;
  eq: (..._args: unknown[]) => FakeQueryBuilder;
  order: (..._args: unknown[]) => FakeQueryBuilder;
  then: <TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?:
      | ((value: QueryResult) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ) => Promise<TResult1 | TResult2>;
};

function makeQueryBuilder(result: QueryResult): FakeQueryBuilder {
  const builder: FakeQueryBuilder = {
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    // biome-ignore lint/suspicious/noThenProperty: intentional thenable, mirrors the real PostgrestFilterBuilder so `await` on an unfinished chain resolves like the real client.
    then: (onfulfilled, onrejected) =>
      Promise.resolve(result).then(
        onfulfilled ?? undefined,
        onrejected ?? undefined
      ),
  };
  return builder;
}

// A full structural mock of SupabaseClient<Database> is impractical, so this
// fake implements only the surface members.ts calls: `.from()`.
function fakeSupabase(opts: {
  from?: Record<string, QueryResult>;
}): SupabaseClient<Database> {
  const fake = {
    from: (table: string) =>
      makeQueryBuilder(opts.from?.[table] ?? { data: null, error: null }),
  };
  return fake as unknown as SupabaseClient<Database>;
}

const BOARD_ID = "11111111-1111-4111-8111-111111111111";
const OWNER_ID = "22222222-2222-4222-8222-222222222222";
const MEMBER_ID = "33333333-3333-4333-8333-333333333333";

async function connectedClient(
  supabase: SupabaseClient<Database>,
  userId = "user-a"
) {
  const server = new McpServer({ name: "test", version: "1.0.0" });
  registerMemberTools(server, { supabase, userId });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  return client;
}

function textOf(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const content = result.content;
  if (!Array.isArray(content) || content.length === 0) {
    throw new Error("expected tool content");
  }
  const [first] = content;
  if (typeof first !== "object" || first === null || first.type !== "text") {
    throw new Error("expected text content");
  }
  return first.text as string;
}

describe("list_board_members", () => {
  it("returns members, mapping display_name to '' when profiles is null", async () => {
    const rows = [
      {
        user_id: OWNER_ID,
        role: "owner",
        profiles: { display_name: "Alice" },
      },
      { user_id: MEMBER_ID, role: "member", profiles: null },
    ];
    const client = await connectedClient(
      fakeSupabase({ from: { board_members: { data: rows, error: null } } })
    );
    const result = await client.callTool({
      name: "list_board_members",
      arguments: { boardId: BOARD_ID },
    });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(textOf(result))).toEqual([
      { userId: OWNER_ID, role: "owner", displayName: "Alice" },
      { userId: MEMBER_ID, role: "member", displayName: "" },
    ]);
  });

  it("returns an empty list, not an error, when RLS filters every row (not a member)", async () => {
    const client = await connectedClient(
      fakeSupabase({ from: { board_members: { data: [], error: null } } })
    );
    const result = await client.callTool({
      name: "list_board_members",
      arguments: { boardId: BOARD_ID },
    });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(textOf(result))).toEqual([]);
  });

  it("returns an isError result on a real Supabase error", async () => {
    const client = await connectedClient(
      fakeSupabase({
        from: {
          board_members: {
            data: null,
            error: { code: "42501", message: "insufficient_privilege" },
          },
        },
      })
    );
    const result = await client.callTool({
      name: "list_board_members",
      arguments: { boardId: BOARD_ID },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(
      "You are not a member of that board, or it does not exist."
    );
  });
});
