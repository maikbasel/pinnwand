import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Database } from "@pinnwand/contracts";
import { DEFAULT_TASK_PRIORITY } from "@pinnwand/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { registerTaskTools } from "./tasks";

type QueryResult = {
  data: unknown;
  error: { code: string; message: string } | null;
};

// Chainable thenable query-builder double, extended from boards.test.ts's
// version with the extra chain methods tasks.ts issues (in/neq/insert) and
// vi.fn() spies on every method so a test can assert exactly what a handler
// sent (the object passed to .insert()/.update(), the ids passed to .in()).
type FakeQueryBuilder = {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  neq: ReturnType<typeof vi.fn>;
  in: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  then: <TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?:
      | ((value: QueryResult) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ) => Promise<TResult1 | TResult2>;
};

function makeQueryBuilder(result: QueryResult): FakeQueryBuilder {
  const builder = {} as FakeQueryBuilder;
  const chainable = vi.fn(() => builder);
  builder.select = chainable;
  builder.eq = chainable;
  builder.neq = chainable;
  builder.in = chainable;
  builder.order = chainable;
  builder.limit = chainable;
  builder.single = chainable;
  builder.insert = chainable;
  builder.update = chainable;
  builder.delete = chainable;
  // biome-ignore lint/suspicious/noThenProperty: intentional thenable, mirrors the real PostgrestFilterBuilder so `await` on an unfinished chain (no .single()) resolves like the real client.
  builder.then = (onfulfilled, onrejected) =>
    Promise.resolve(result).then(
      onfulfilled ?? undefined,
      onrejected ?? undefined
    );
  return builder;
}

// A full structural mock of SupabaseClient<Database> is impractical, so this
// fake implements only the surface tasks.ts calls: `.from()` and `.rpc()`.
// `from` results can be a single canned result (returned on every call to
// that table) or an array (consumed in call order) — tasks.ts issues several
// distinct reads against the same table per handler (e.g. move_task reads
// the current row, then its neighbours, then writes), and each needs its own
// canned response.
function fakeSupabase(opts: {
  from?: Record<string, QueryResult | QueryResult[]>;
  rpc?: QueryResult;
}) {
  const builders: Record<string, FakeQueryBuilder[]> = {};
  const rpcSpy = vi.fn(() =>
    Promise.resolve(opts.rpc ?? { data: null, error: null })
  );
  const client = {
    from: (table: string) => {
      const configured = opts.from?.[table];
      let queue: QueryResult[];
      if (Array.isArray(configured)) {
        queue = configured;
      } else if (configured) {
        queue = [configured];
      } else {
        queue = [];
      }
      const callIndex = builders[table]?.length ?? 0;
      const result = queue[callIndex] ??
        queue.at(-1) ?? { data: null, error: null };
      const builder = makeQueryBuilder(result);
      builders[table] = [...(builders[table] ?? []), builder];
      return builder;
    },
    rpc: rpcSpy,
  };
  return {
    client: client as unknown as SupabaseClient<Database>,
    builders,
    rpcSpy,
  };
}

const TASK_ROW = {
  id: "33333333-3333-4333-8333-333333333333",
  board_id: "11111111-1111-4111-8111-111111111111",
  column: "offen",
  title: "Write report",
  description: "",
  priority: DEFAULT_TASK_PRIORITY,
  due_date: null,
  position: 1024,
  created_by: "22222222-2222-4222-8222-222222222222",
  created_at: "2026-07-10T00:00:00.000Z",
  updated_at: "2026-07-10T00:00:00.000Z",
  task_assignees: [],
};

const USER_A = "22222222-2222-4222-8222-222222222222";
const USER_B = "44444444-4444-4444-8444-444444444444";
const TASK_ID = TASK_ROW.id;
const BOARD_ID = TASK_ROW.board_id;

async function connectedClient(
  supabase: SupabaseClient<Database>,
  userId = USER_A
) {
  const server = new McpServer({ name: "test", version: "1.0.0" });
  registerTaskTools(server, { supabase, userId });
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

describe("create_task", () => {
  it("appends at max(existing positions)+STEP and defaults column/priority", async () => {
    const { client, builders } = fakeSupabase({
      from: {
        // Real Postgres applies .order("position",{ascending:false}).limit(1)
        // server-side, so only the current bottom row comes back.
        tasks: [
          { data: [{ position: 2048 }], error: null },
          { data: TASK_ROW, error: null },
        ],
      },
    });
    const c = await connectedClient(client);
    const result = await c.callTool({
      name: "create_task",
      arguments: { boardId: BOARD_ID, title: "Write report" },
    });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(textOf(result))).toEqual(TASK_ROW);

    const insertBuilder = builders.tasks[1];
    expect(insertBuilder.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        board_id: BOARD_ID,
        column: "offen",
        priority: DEFAULT_TASK_PRIORITY,
        position: 3072,
      })
    );
  });
});

describe("move_task", () => {
  const beforeId = "55555555-5555-4555-8555-555555555555";
  const afterId = "66666666-6666-4666-8666-666666666666";

  function currentTaskResult(position = 1500) {
    return {
      data: { id: TASK_ID, board_id: BOARD_ID, column: "offen", position },
      error: null,
    };
  }

  it("writes the midpoint between the given neighbours, only for the moved row", async () => {
    const { client, builders } = fakeSupabase({
      from: {
        tasks: [
          currentTaskResult(),
          // The ordered target-column set (moved row excluded), position asc.
          {
            data: [
              { id: beforeId, position: 1024 },
              { id: afterId, position: 2048 },
            ],
            error: null,
          },
          { data: { ...TASK_ROW, position: 1536 }, error: null },
        ],
      },
    });
    const c = await connectedClient(client);
    const result = await c.callTool({
      name: "move_task",
      arguments: {
        taskId: TASK_ID,
        beforeTaskId: beforeId,
        afterTaskId: afterId,
      },
    });
    expect(result.isError).toBeFalsy();

    const updateBuilder = builders.tasks[2];
    expect(updateBuilder.update).toHaveBeenCalledWith({
      column: "offen",
      position: 1536,
    });
    expect(updateBuilder.eq).toHaveBeenCalledWith("id", TASK_ID);
  });

  it("before-only: places between the true neighbours, not past the next row (bug 1)", async () => {
    // Column: beforeId(1024), afterId(2048). Old buggy code treated the
    // missing "after" as null -> midpoint(1024, null) = 1024 + 1024 = 2048,
    // colliding with afterId's own position. The true next row is afterId,
    // so the correct slot is midpoint(1024, 2048) = 1536.
    const { client, builders } = fakeSupabase({
      from: {
        tasks: [
          currentTaskResult(),
          {
            data: [
              { id: beforeId, position: 1024 },
              { id: afterId, position: 2048 },
            ],
            error: null,
          },
          { data: { ...TASK_ROW, position: 1536 }, error: null },
        ],
      },
    });
    const c = await connectedClient(client);
    const result = await c.callTool({
      name: "move_task",
      arguments: { taskId: TASK_ID, beforeTaskId: beforeId },
    });
    expect(result.isError).toBeFalsy();

    const updateBuilder = builders.tasks[2];
    expect(updateBuilder.update).toHaveBeenCalledWith(
      expect.objectContaining({ position: 1536 })
    );
  });

  it("after-only: places between the true neighbours, not before the true previous row (bug 1)", async () => {
    // Column: beforeId(1024), afterId(1536). Old buggy code treated the
    // missing "before" as null -> midpoint(null, 1536) = 1536 / 2 = 768,
    // which lands before beforeId's own position (1024). The true previous
    // row is beforeId, so the correct slot is midpoint(1024, 1536) = 1280.
    const { client, builders } = fakeSupabase({
      from: {
        tasks: [
          currentTaskResult(),
          {
            data: [
              { id: beforeId, position: 1024 },
              { id: afterId, position: 1536 },
            ],
            error: null,
          },
          { data: { ...TASK_ROW, position: 1280 }, error: null },
        ],
      },
    });
    const c = await connectedClient(client);
    const result = await c.callTool({
      name: "move_task",
      arguments: { taskId: TASK_ID, afterTaskId: afterId },
    });
    expect(result.isError).toBeFalsy();

    const updateBuilder = builders.tasks[2];
    expect(updateBuilder.update).toHaveBeenCalledWith(
      expect.objectContaining({ position: 1280 })
    );
  });

  it("rejects a beforeTaskId that isn't in the target board/column (bug 2)", async () => {
    const wrongColumnId = "77777777-7777-4777-8777-777777777777";
    const { client, builders } = fakeSupabase({
      from: {
        tasks: [
          currentTaskResult(),
          // The target column's ordered set does NOT contain wrongColumnId
          // (it belongs to a different board/column).
          { data: [{ id: afterId, position: 1024 }], error: null },
        ],
      },
    });
    const c = await connectedClient(client);
    const result = await c.callTool({
      name: "move_task",
      arguments: { taskId: TASK_ID, beforeTaskId: wrongColumnId },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(
      "beforeTaskId is not a task in the target column."
    );
    // Never reaches the update call.
    expect(builders.tasks.length).toBe(2);
  });

  it("appends to the bottom of the target column when no position/neighbours are given", async () => {
    const { client, builders } = fakeSupabase({
      from: {
        tasks: [
          currentTaskResult(1024),
          { data: [{ position: 2048 }], error: null },
          { data: { ...TASK_ROW, position: 3072 }, error: null },
        ],
      },
    });
    const c = await connectedClient(client);
    const result = await c.callTool({
      name: "move_task",
      arguments: { taskId: TASK_ID },
    });
    expect(result.isError).toBeFalsy();

    const updateBuilder = builders.tasks[2];
    expect(updateBuilder.update).toHaveBeenCalledWith(
      expect.objectContaining({ position: 3072 })
    );
  });
});

describe("assign_task", () => {
  it("calls set_task_assignees with the union of current and new assignee", async () => {
    const { client, rpcSpy } = fakeSupabase({
      from: { task_assignees: { data: [{ user_id: USER_A }], error: null } },
    });
    const c = await connectedClient(client);
    const result = await c.callTool({
      name: "assign_task",
      arguments: { taskId: TASK_ID, userId: USER_B },
    });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(textOf(result))).toEqual({
      task_id: TASK_ID,
      assignee_ids: [USER_A, USER_B],
    });
    expect(rpcSpy).toHaveBeenCalledWith("set_task_assignees", {
      p_task: TASK_ID,
      p_user_ids: [USER_A, USER_B],
    });
  });
});

describe("unassign_task", () => {
  it("calls set_task_assignees with the assignee removed", async () => {
    const { client, rpcSpy } = fakeSupabase({
      from: {
        task_assignees: {
          data: [{ user_id: USER_A }, { user_id: USER_B }],
          error: null,
        },
      },
    });
    const c = await connectedClient(client);
    const result = await c.callTool({
      name: "unassign_task",
      arguments: { taskId: TASK_ID, userId: USER_B },
    });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(textOf(result))).toEqual({
      task_id: TASK_ID,
      assignee_ids: [USER_A],
    });
    expect(rpcSpy).toHaveBeenCalledWith("set_task_assignees", {
      p_task: TASK_ID,
      p_user_ids: [USER_A],
    });
  });
});

describe("delete_task", () => {
  it("returns the membership-denial message when RLS silently filters the delete (0 rows, no error)", async () => {
    const { client } = fakeSupabase({
      from: { tasks: { data: [], error: null } },
    });
    const c = await connectedClient(client);
    const result = await c.callTool({
      name: "delete_task",
      arguments: { taskId: TASK_ID },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(
      "You are not a member of that board, or it does not exist."
    );
  });
});

describe("get_task", () => {
  it("returns an isError result, not a crash, when the task is not visible under RLS", async () => {
    const { client } = fakeSupabase({
      from: {
        tasks: { data: null, error: { code: "PGRST116", message: "no rows" } },
      },
    });
    const c = await connectedClient(client);
    const result = await c.callTool({
      name: "get_task",
      arguments: { taskId: TASK_ID },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(
      "You are not a member of that board, or it does not exist."
    );
  });
});
