import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { supabaseForUser } from "../../auth/supabase-for-user";
import { env } from "../../env";
import { BoardRowSchema, TaskRowSchema } from "../../schemas";
import { createAuthUser, teardownPool } from "../../test/db";
import { createMcpServer } from "../server";

// SECURITY ACCEPTANCE GATE (Task 9b): proves one user's MCP tool calls can
// never read or write another user's board. It runs against a REAL stack
// booted in testcontainers (see src/test/integration-setup.ts): the tool
// calls travel supabase-js -> kong (/rest/v1/*) -> PostgREST (validates the
// user JWT -> role) -> Postgres RLS — the exact anon-key REST + RLS boundary
// the deployed mcp relies on, not a mock.

const MembershipListSchema = z.array(
  z.object({ role: z.enum(["owner", "member"]), boards: BoardRowSchema })
);
const TaskGroupSchema = z.record(z.string(), z.array(TaskRowSchema));

/** Mints a real user-scoped JWT the stack accepts (HS256, GOTRUE_JWT_SECRET). */
async function mintUserToken(userId: string): Promise<string> {
  const secret = env.SUPABASE_JWT_SECRET;
  if (!secret) {
    throw new Error("SUPABASE_JWT_SECRET must be set for integration tests.");
  }
  return await new SignJWT({
    sub: userId,
    aud: "authenticated",
    role: "authenticated",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(secret));
}

/** Links an in-memory MCP client to a server built with a real, user-scoped
 * Supabase client — the same wiring the HTTP transport uses in production. */
async function connectedClient(
  supabase: ReturnType<typeof supabaseForUser>,
  userId: string
): Promise<Client> {
  const server = createMcpServer({ supabase, userId });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({
    name: "rls-impersonation-test",
    version: "1.0.0",
  });
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  return client;
}

// client.callTool()'s default resultSchema resolves to a union that also
// carries a legacy `toolResult` shape without `content`, which TS can't
// narrow cleanly. Validate the envelope through zod instead of trusting the
// SDK's inferred return type — the same "zod at every boundary" rule the
// tool handlers themselves follow.
const ToolContentItemSchema = z
  .object({ type: z.string(), text: z.string().optional() })
  .loose();
const ToolEnvelopeSchema = z
  .object({
    isError: z.boolean().optional(),
    content: z.array(ToolContentItemSchema).default([]),
  })
  .loose();
type ToolEnvelope = z.infer<typeof ToolEnvelopeSchema>;

async function callTool(
  client: Client,
  name: string,
  toolArguments: Record<string, unknown>
): Promise<ToolEnvelope> {
  const raw = await client.callTool({ name, arguments: toolArguments });
  return ToolEnvelopeSchema.parse(raw);
}

function parseToolJson<T>(envelope: ToolEnvelope, schema: z.ZodType<T>): T {
  const first = envelope.content[0];
  if (!first || first.type !== "text" || first.text === undefined) {
    throw new Error("Expected text content from tool call.");
  }
  return schema.parse(JSON.parse(first.text));
}

describe("RLS impersonation via MCP tools (live Supabase stack)", () => {
  const runId = randomUUID().slice(0, 8);
  let aliceClient: Client;
  let charlieClient: Client;

  beforeAll(async () => {
    const [aliceId, charlieId] = await Promise.all([
      createAuthUser(`alice-${runId}@dev.local`),
      createAuthUser(`charlie-${runId}@dev.local`),
    ]);
    const [aliceToken, charlieToken] = await Promise.all([
      mintUserToken(aliceId),
      mintUserToken(charlieId),
    ]);
    [aliceClient, charlieClient] = await Promise.all([
      connectedClient(supabaseForUser(aliceToken), aliceId),
      connectedClient(supabaseForUser(charlieToken), charlieId),
    ]);
  });

  afterAll(async () => {
    await teardownPool();
  });

  it("keeps alice's board and tasks unreachable to charlie through every MCP tool", async () => {
    const aliceBoardName = `Alice Board ${runId}`;
    const charlieBoardName = `Charlie Board ${runId}`;

    // 1. Alice creates her board.
    const aliceCreateBoard = await callTool(aliceClient, "create_board", {
      name: aliceBoardName,
    });
    expect(aliceCreateBoard.isError).toBeFalsy();
    const aliceBoard = parseToolJson(aliceCreateBoard, BoardRowSchema);
    expect(aliceBoard.name).toBe(aliceBoardName);
    const aliceBoardId = aliceBoard.id;

    // 2. Charlie creates his own board.
    const charlieCreateBoard = await callTool(charlieClient, "create_board", {
      name: charlieBoardName,
    });
    expect(charlieCreateBoard.isError).toBeFalsy();
    const charlieBoard = parseToolJson(charlieCreateBoard, BoardRowSchema);
    expect(charlieBoard.name).toBe(charlieBoardName);
    const charlieBoardId = charlieBoard.id;

    // 3. list_boards includes only the caller's own boards.
    const aliceBoards = parseToolJson(
      await callTool(aliceClient, "list_boards", {}),
      MembershipListSchema
    );
    expect(aliceBoards.map((m) => m.boards.id)).toContain(aliceBoardId);

    const charlieBoards = parseToolJson(
      await callTool(charlieClient, "list_boards", {}),
      MembershipListSchema
    );
    const charlieBoardIds = charlieBoards.map((m) => m.boards.id);
    expect(charlieBoardIds).not.toContain(aliceBoardId);
    expect(charlieBoardIds).toContain(charlieBoardId);

    // 4. Charlie cannot read alice's board through get_board.
    const charlieGetAliceBoard = await callTool(charlieClient, "get_board", {
      boardId: aliceBoardId,
    });
    expect(charlieGetAliceBoard.isError).toBe(true);

    // 5. Charlie cannot write a task onto alice's board.
    const charlieCreateTaskOnAliceBoard = await callTool(
      charlieClient,
      "create_task",
      { boardId: aliceBoardId, title: "x" }
    );
    expect(charlieCreateTaskOnAliceBoard.isError).toBe(true);

    // 6. Alice creates a task; she sees it, charlie does not.
    const aliceTaskTitle = `Alice task ${runId}`;
    const aliceCreateTask = await callTool(aliceClient, "create_task", {
      boardId: aliceBoardId,
      title: aliceTaskTitle,
    });
    expect(aliceCreateTask.isError).toBeFalsy();
    const aliceTask = parseToolJson(aliceCreateTask, TaskRowSchema);
    expect(aliceTask.title).toBe(aliceTaskTitle);

    const aliceTasks = parseToolJson(
      await callTool(aliceClient, "list_tasks", { boardId: aliceBoardId }),
      TaskGroupSchema
    );
    const aliceTaskTitles = Object.values(aliceTasks)
      .flat()
      .map((t) => t.title);
    expect(aliceTaskTitles).toContain(aliceTaskTitle);

    const charlieListTasksOnAliceBoard = await callTool(
      charlieClient,
      "list_tasks",
      { boardId: aliceBoardId }
    );
    // RLS makes "denied" and "absent" indistinguishable by design (see
    // mcp/errors.ts) — either an explicit denial or a silently empty result
    // proves charlie cannot see alice's task.
    if (charlieListTasksOnAliceBoard.isError) {
      expect(charlieListTasksOnAliceBoard.isError).toBe(true);
    } else {
      const charlieTasks = parseToolJson(
        charlieListTasksOnAliceBoard,
        TaskGroupSchema
      );
      const charlieTaskTitles = Object.values(charlieTasks)
        .flat()
        .map((t) => t.title);
      expect(charlieTaskTitles).not.toContain(aliceTaskTitle);
    }
  });

  it("denies charlie every mutating MCP tool aimed at alice's board and task", async () => {
    // Alice provisions a board + task for charlie to attack. The read/create
    // test above covers get_board/create_task; this one covers the mutating
    // tools — including assign_task/unassign_task, which reach the data through
    // the set_task_assignees SECURITY DEFINER RPC rather than table RLS, so
    // their membership check has to be proven independently.
    const aliceBoard = parseToolJson(
      await callTool(aliceClient, "create_board", {
        name: `Alice MutBoard ${runId}`,
      }),
      BoardRowSchema
    );
    const editedTitle = `Alice MutTask ${runId} edited`;
    const aliceTask = parseToolJson(
      await callTool(aliceClient, "create_task", {
        boardId: aliceBoard.id,
        title: `Alice MutTask ${runId}`,
      }),
      TaskRowSchema
    );

    // Positive control: alice can update her own task, so a charlie denial
    // below is real RLS enforcement, not a tool that errors for everyone.
    const aliceUpdate = await callTool(aliceClient, "update_task", {
      taskId: aliceTask.id,
      title: editedTitle,
    });
    expect(aliceUpdate.isError).toBeFalsy();

    // Every mutating tool charlie points at alice's board/task is denied.
    const denials = await Promise.all([
      callTool(charlieClient, "update_task", {
        taskId: aliceTask.id,
        title: "charlie was here",
      }),
      callTool(charlieClient, "move_task", {
        taskId: aliceTask.id,
        column: "erledigt",
      }),
      callTool(charlieClient, "assign_task", {
        taskId: aliceTask.id,
        userId: randomUUID(),
      }),
      callTool(charlieClient, "unassign_task", {
        taskId: aliceTask.id,
        userId: randomUUID(),
      }),
      callTool(charlieClient, "delete_task", { taskId: aliceTask.id }),
      callTool(charlieClient, "rename_board", {
        boardId: aliceBoard.id,
        name: "charlie's board now",
      }),
      callTool(charlieClient, "regenerate_join_code", {
        boardId: aliceBoard.id,
      }),
      callTool(charlieClient, "delete_board", { boardId: aliceBoard.id }),
    ]);
    for (const denial of denials) {
      expect(denial.isError).toBe(true);
    }

    // None of it landed: alice's task keeps her own edit and original column,
    // and her board keeps its name.
    const afterTask = parseToolJson(
      await callTool(aliceClient, "get_task", { taskId: aliceTask.id }),
      TaskRowSchema
    );
    expect(afterTask.title).toBe(editedTitle);
    expect(afterTask.column).toBe("offen");

    const afterBoard = parseToolJson(
      await callTool(aliceClient, "get_board", { boardId: aliceBoard.id }),
      z.object({ board: BoardRowSchema })
    );
    expect(afterBoard.board.name).toBe(`Alice MutBoard ${runId}`);
  });
});
