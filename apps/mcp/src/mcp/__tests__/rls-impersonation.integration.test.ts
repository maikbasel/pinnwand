import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { supabaseForUser } from "../../auth/supabase-for-user";
import { env } from "../../env";
import { BoardRowSchema, TaskRowSchema } from "../../schemas";
import { createMcpServer } from "../server";

// SECURITY ACCEPTANCE GATE (Task 9b): proves one user's MCP tool calls can
// never read or write another user's board, against a REAL running Supabase
// stack (not mocks) — the anon-key REST path (PostgREST + RLS) is the actual
// authorization boundary the deployed mcp relies on.

// TEST-ONLY provisioning secret: creates/looks up the two fixture users via
// GoTrue's admin API. Never imported into mcp runtime source — only the anon
// key (via supabaseForUser) reaches the tool handlers under test.
const SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.kcyKZAiwnnBG9t6IVGO17bcVw574pVynTHYVdF4q-p0";

const ADMIN_USERS_URL = `${env.SUPABASE_URL}/auth/v1/admin/users`;
const ADMIN_HEADERS = {
  apikey: SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
};

const AdminUserSchema = z.object({ id: z.uuid(), email: z.string().nullish() });
const AdminUsersListSchema = z.object({ users: z.array(AdminUserSchema) });

const MembershipListSchema = z.array(
  z.object({ role: z.enum(["owner", "member"]), boards: BoardRowSchema })
);
const TaskGroupSchema = z.record(z.string(), z.array(TaskRowSchema));

/** Idempotent: looks the fixture user up by email, creates it only if absent. */
async function findOrCreateUser(email: string): Promise<string> {
  const listRes = await fetch(ADMIN_USERS_URL, { headers: ADMIN_HEADERS });
  if (!listRes.ok) {
    throw new Error(
      `admin/users list failed: ${listRes.status} ${await listRes.text()}`
    );
  }
  const { users } = AdminUsersListSchema.parse(await listRes.json());
  const existing = users.find((u) => u.email === email);
  if (existing) {
    return existing.id;
  }

  const createRes = await fetch(ADMIN_USERS_URL, {
    method: "POST",
    headers: { ...ADMIN_HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      email_confirm: true,
      password: randomUUID(),
    }),
  });
  if (!createRes.ok) {
    throw new Error(
      `admin/users create failed: ${createRes.status} ${await createRes.text()}`
    );
  }
  return AdminUserSchema.parse(await createRes.json()).id;
}

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
      findOrCreateUser("alice@dev.local"),
      findOrCreateUser("charlie@dev.local"),
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
});
