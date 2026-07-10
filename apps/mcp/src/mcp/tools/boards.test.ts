import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Database } from "@pinnwand/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { registerBoardTools } from "./boards";

type QueryResult = {
  data: unknown;
  error: { code: string; message: string } | null;
};

// Minimal thenable query-builder double: chain calls (select/eq/single/...)
// all return itself, and `await`ing it resolves to the canned result. Covers
// the from().select().eq()... shapes boards.ts actually issues.
type FakeQueryBuilder = {
  select: (..._args: unknown[]) => FakeQueryBuilder;
  eq: (..._args: unknown[]) => FakeQueryBuilder;
  single: () => FakeQueryBuilder;
  update: (..._args: unknown[]) => FakeQueryBuilder;
  delete: () => FakeQueryBuilder;
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
    single: () => builder,
    update: () => builder,
    delete: () => builder,
    // biome-ignore lint/suspicious/noThenProperty: intentional thenable, mirrors the real PostgrestFilterBuilder so `await` on an unfinished chain (no .single()) resolves like the real client.
    then: (onfulfilled, onrejected) =>
      Promise.resolve(result).then(
        onfulfilled ?? undefined,
        onrejected ?? undefined
      ),
  };
  return builder;
}

type FakeSupabase = {
  from: (table: string) => FakeQueryBuilder;
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<QueryResult>;
};

// A full structural mock of SupabaseClient<Database> is impractical (it has
// dozens of unrelated members: auth, storage, realtime, functions, ...).
// boards.ts only ever calls `.from()` and `.rpc()`, so the fake implements
// just that surface; the cast is confined to this test file.
function fakeSupabase(opts: {
  from?: Record<string, QueryResult>;
  rpc?: QueryResult;
}): SupabaseClient<Database> {
  const fake: FakeSupabase = {
    from: (table) =>
      makeQueryBuilder(opts.from?.[table] ?? { data: null, error: null }),
    rpc: () => Promise.resolve(opts.rpc ?? { data: null, error: null }),
  };
  return fake as unknown as SupabaseClient<Database>;
}

const BOARD_ROW = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Team Board",
  join_code: "ABCDEFGH",
  created_by: "22222222-2222-4222-8222-222222222222",
  created_at: "2026-07-10T00:00:00.000Z",
};

async function connectedClient(
  supabase: SupabaseClient<Database>,
  userId = "user-a"
) {
  const server = new McpServer({ name: "test", version: "1.0.0" });
  registerBoardTools(server, { supabase, userId });
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

describe("create_board", () => {
  it("returns the parsed board on success", async () => {
    const client = await connectedClient(
      fakeSupabase({ rpc: { data: BOARD_ROW, error: null } })
    );
    const result = await client.callTool({
      name: "create_board",
      arguments: { name: "Team Board" },
    });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(textOf(result))).toEqual(BOARD_ROW);
  });

  it("surfaces a P0001 RPC exception message verbatim as an isError result", async () => {
    const client = await connectedClient(
      fakeSupabase({
        rpc: {
          data: null,
          error: { code: "P0001", message: "invalid join code" },
        },
      })
    );
    const result = await client.callTool({
      name: "create_board",
      arguments: { name: "Team Board" },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe("invalid join code");
  });
});

describe("list_boards", () => {
  it("returns the caller's board memberships", async () => {
    const membership = { role: "owner", boards: BOARD_ROW };
    const client = await connectedClient(
      fakeSupabase({
        from: { board_members: { data: [membership], error: null } },
      })
    );
    const result = await client.callTool({
      name: "list_boards",
      arguments: {},
    });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(textOf(result))).toEqual([membership]);
  });
});

describe("get_board", () => {
  it("returns an isError result, not a crash, when the board is not visible under RLS", async () => {
    const client = await connectedClient(
      fakeSupabase({
        from: {
          boards: {
            data: null,
            error: { code: "PGRST116", message: "no rows" },
          },
        },
      })
    );
    const result = await client.callTool({
      name: "get_board",
      arguments: { boardId: BOARD_ROW.id },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(
      "You are not a member of that board, or it does not exist."
    );
  });
});

describe("rename_board", () => {
  it("returns an isError result when RLS denies the rename (not owner)", async () => {
    const client = await connectedClient(
      fakeSupabase({
        from: {
          boards: {
            data: null,
            error: { code: "PGRST116", message: "no rows" },
          },
        },
      })
    );
    const result = await client.callTool({
      name: "rename_board",
      arguments: { boardId: BOARD_ROW.id, name: "New Name" },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(
      "You are not a member of that board, or it does not exist."
    );
  });
});

describe("delete_board", () => {
  it("returns deleted:true when the delete removes a row", async () => {
    const client = await connectedClient(
      fakeSupabase({
        from: {
          boards: { data: [{ id: BOARD_ROW.id }], error: null },
        },
      })
    );
    const result = await client.callTool({
      name: "delete_board",
      arguments: { boardId: BOARD_ROW.id },
    });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(textOf(result))).toEqual({ deleted: true });
  });

  it("returns the membership-denial message when RLS silently filters the delete (0 rows, no error)", async () => {
    const client = await connectedClient(
      fakeSupabase({
        from: {
          boards: { data: [], error: null },
        },
      })
    );
    const result = await client.callTool({
      name: "delete_board",
      arguments: { boardId: BOARD_ROW.id },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(
      "You are not a member of that board, or it does not exist."
    );
  });
});

describe("join_board_by_code", () => {
  it("returns the parsed board on success", async () => {
    const client = await connectedClient(
      fakeSupabase({ rpc: { data: BOARD_ROW, error: null } })
    );
    const result = await client.callTool({
      name: "join_board_by_code",
      arguments: { code: "ABCDEFGH" },
    });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(textOf(result))).toEqual(BOARD_ROW);
  });

  it("surfaces a P0001 RPC exception message verbatim as an isError result", async () => {
    const client = await connectedClient(
      fakeSupabase({
        rpc: {
          data: null,
          error: { code: "P0001", message: "invalid join code" },
        },
      })
    );
    const result = await client.callTool({
      name: "join_board_by_code",
      arguments: { code: "BADCODE1" },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe("invalid join code");
  });
});

describe("regenerate_join_code", () => {
  it("returns the parsed join code string on success", async () => {
    const client = await connectedClient(
      fakeSupabase({ rpc: { data: "NEWCODE1", error: null } })
    );
    const result = await client.callTool({
      name: "regenerate_join_code",
      arguments: { boardId: BOARD_ROW.id },
    });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(textOf(result))).toEqual({ join_code: "NEWCODE1" });
  });
});
