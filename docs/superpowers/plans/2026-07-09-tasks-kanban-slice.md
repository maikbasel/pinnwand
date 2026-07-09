# Tasks / Kanban Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the board detail page into a working Kanban surface where members create, edit, reorder, move, assign, and delete Aufgaben across the four fixed columns, live over realtime and durable offline.

**Architecture:** A vertical `tasks` feature slice (`api/` calls Supabase, `hooks/` orchestrate optimistic TanStack Query mutations, `components/` render the board). No new migration: `tasks` and `task_assignees` with full RLS already exist in `init.sql`. Ordering is a client-computed `double precision` fractional index. Deletion is a deferred hard delete with a client-side Undo window.

**Tech Stack:** React 19, TypeScript (strict, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `exactOptionalPropertyTypes`), TanStack Query + Router, dnd-kit, vaul, sonner, zod, Base UI (`@base-ui/react`) primitives, self-hosted Supabase, Vitest + Playwright.

## Global Constraints

- No new SQL migration and no RPC. The client writes through the existing `tasks` / `task_assignees` RLS policies.
- Layer boundaries: `components/` never import `api/` or `@supabase/*`; `hooks/` never import React DOM components; `api/` never import React. Cross-feature use goes through `index.ts`.
- Every mutation is optimistic with rollback on error and invalidate on settled. Never manually merge `postgres_changes` payloads into the cache; invalidate and refetch.
- Validate every Supabase response at the `api/` boundary with `zod`, including realtime-triggered refetch shapes.
- Task mutation keys are `["tasks", "mutate", boardId]` so they match `DURABLE_MUTATION_ROOTS` and survive an offline restart. Board writes stay online-only and are out of scope.
- No `any`, no `as unknown as X`, no hand-editing generated files (`database.ts`, `routeTree.gen.ts`).
- Extract magic strings and numbers into named constants. German UI copy lives in `src/features/tasks/lib/copy.ts`; column and priority labels come from `src/features/tasks/columns.ts`.
- Maximize shadcn reuse. Only three new primitives are authored, all on Base UI (`@base-ui/react`), never Radix: `textarea`, `toggle-group` (with `toggle`), `checkbox`.
- Mobile-first: base classes are mobile, `md:` and up scale up. Touch targets at least 44x44px. Detail surface is a `vaul` Drawer on mobile, a side `Sheet` on desktop, swapped at `(min-width: 768px)` via `useMediaQuery`.
- Assertions test behavior through roles and copy constants, not hardcoded strings or pixels.
- Do not commit until the human explicitly says so. The commit step in each task is written for the eventual executor; the human has asked to hold, so pause after the final task instead of pushing.

## Canonical interfaces (defined once, reused by every task)

`src/features/tasks/types.ts`:

```ts
import type { TaskColumnId, TaskPriorityId } from "./columns";

export type Task = {
  id: string;
  boardId: string;
  column: TaskColumnId;
  title: string;
  description: string;
  priority: TaskPriorityId;
  dueDate: string | null; // ISO date "YYYY-MM-DD"
  position: number;
  assigneeIds: string[];
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};
```

`src/features/tasks/api/tasks.ts` exports (signatures every hook depends on):

```ts
TASK_KEYS.byBoard(boardId: string): readonly ["tasks", "byBoard", string]
TASK_MUTATION_KEYS.forBoard(boardId: string): readonly ["tasks", "mutate", string]

listBoardTasks(boardId: string): Promise<Task[]>
createTask(input: {
  boardId: string; column: TaskColumnId; title: string;
  description: string; priority: TaskPriorityId; dueDate: string | null; position: number;
}): Promise<Task>
updateTask(input: {
  taskId: string; title: string; description: string;
  priority: TaskPriorityId; dueDate: string | null;
}): Promise<Task>
moveTask(input: { taskId: string; column: TaskColumnId; position: number }): Promise<Task>
reorderTask(input: { taskId: string; position: number }): Promise<Task>
deleteTask(input: { taskId: string }): Promise<void>
setTaskAssignees(input: { taskId: string; userIds: string[] }): Promise<void>
```

`src/features/tasks/lib/position.ts` exports:

```ts
POSITION_STEP: 1024
bottomPosition(items: readonly { position: number }[]): number
midpoint(prev: number | null, next: number | null): number
hasRepresentableGap(prev: number | null, next: number | null): boolean
positionForMove(ordered: readonly { position: number }[], index: number): number
renormalize(ordered: readonly { id: string }[]): { id: string; position: number }[]
```

`src/features/members/index.ts` exports:

```ts
type BoardMember = { userId: string; role: "owner" | "member"; displayName: string }
useBoardMembers(boardId: string): {
  members: BoardMember[]; isPending: boolean; isError: boolean; error: Error | null;
}
```

---

## Task 1: Fractional-index position math

Pure, framework-free ordering helpers. First because every reorder, move, and create depends on them, and they unit-test in isolation.

**Files:**
- Create: `src/features/tasks/lib/position.ts`
- Test: `src/features/tasks/lib/position.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `POSITION_STEP`, `bottomPosition`, `midpoint`, `hasRepresentableGap`, `positionForMove`, `renormalize` (signatures above).

- [ ] **Step 1: Write the failing test**

```ts
// src/features/tasks/lib/position.test.ts
import { describe, expect, it } from "vitest";
import {
  bottomPosition,
  hasRepresentableGap,
  midpoint,
  POSITION_STEP,
  positionForMove,
  renormalize,
} from "./position";

describe("bottomPosition", () => {
  it("returns one step for an empty column", () => {
    expect(bottomPosition([])).toBe(POSITION_STEP);
  });
  it("returns one step past the current max", () => {
    expect(bottomPosition([{ position: 10 }, { position: 40 }])).toBe(40 + POSITION_STEP);
  });
});

describe("midpoint", () => {
  it("is the step when the column is empty (both neighbours null)", () => {
    expect(midpoint(null, null)).toBe(POSITION_STEP);
  });
  it("halves the first position when inserting at the top", () => {
    expect(midpoint(null, 100)).toBe(50);
  });
  it("adds a step past the last when inserting at the bottom", () => {
    expect(midpoint(200, null)).toBe(200 + POSITION_STEP);
  });
  it("is the average between two neighbours", () => {
    expect(midpoint(100, 200)).toBe(150);
  });
});

describe("hasRepresentableGap", () => {
  it("is true when a distinct midpoint exists", () => {
    expect(hasRepresentableGap(100, 200)).toBe(true);
  });
  it("is false when two neighbours are adjacent doubles", () => {
    const a = 1;
    const b = a + Number.EPSILON;
    expect(hasRepresentableGap(a, b)).toBe(false);
  });
});

describe("positionForMove", () => {
  const ordered = [{ position: 1024 }, { position: 2048 }, { position: 3072 }];
  it("drops to the top half when index 0", () => {
    expect(positionForMove(ordered, 0)).toBe(512);
  });
  it("averages the surrounding neighbours in the middle", () => {
    expect(positionForMove(ordered, 1)).toBe((1024 + 2048) / 2);
  });
  it("appends past the last when index equals length", () => {
    expect(positionForMove(ordered, ordered.length)).toBe(3072 + POSITION_STEP);
  });
});

describe("renormalize", () => {
  it("rewrites ids to evenly spaced positions in order", () => {
    expect(renormalize([{ id: "a" }, { id: "b" }, { id: "c" }])).toEqual([
      { id: "a", position: 1024 },
      { id: "b", position: 2048 },
      { id: "c", position: 3072 },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS=--no-experimental-webstorage pnpm test -- src/features/tasks/lib/position.test.ts`
Expected: FAIL, "Cannot find module './position'".

- [ ] **Step 3: Write the implementation**

```ts
// src/features/tasks/lib/position.ts
// Fractional-index ordering for tasks within a column. Positions are
// `double precision` in Postgres; a reorder writes the midpoint between the two
// neighbours so sibling rows are never touched.
export const POSITION_STEP = 1024;

export function bottomPosition(items: readonly { position: number }[]): number {
  if (items.length === 0) {
    return POSITION_STEP;
  }
  return Math.max(...items.map((item) => item.position)) + POSITION_STEP;
}

export function midpoint(prev: number | null, next: number | null): number {
  if (prev === null && next === null) {
    return POSITION_STEP;
  }
  if (prev === null) {
    return (next as number) / 2;
  }
  if (next === null) {
    return prev + POSITION_STEP;
  }
  return (prev + next) / 2;
}

export function hasRepresentableGap(
  prev: number | null,
  next: number | null
): boolean {
  const mid = midpoint(prev, next);
  return mid !== prev && mid !== next;
}

export function positionForMove(
  ordered: readonly { position: number }[],
  index: number
): number {
  const prevItem = index > 0 ? ordered[index - 1] : undefined;
  const nextItem = index < ordered.length ? ordered[index] : undefined;
  return midpoint(prevItem?.position ?? null, nextItem?.position ?? null);
}

export function renormalize(
  ordered: readonly { id: string }[]
): { id: string; position: number }[] {
  return ordered.map((item, i) => ({ id: item.id, position: (i + 1) * POSITION_STEP }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NODE_OPTIONS=--no-experimental-webstorage pnpm test -- src/features/tasks/lib/position.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 5: Typecheck and commit**

```bash
pnpm exec tsc -b
git add src/features/tasks/lib/position.ts src/features/tasks/lib/position.test.ts
git commit -m "feat(tasks): fractional-index position helpers"
```

---

## Task 2: Task types and the data layer

The `api/` module: query/mutation keys, zod row schemas, and the seven Supabase functions. Tested by integration tests against the running dev DB, including RLS by impersonation.

**Files:**
- Create: `src/features/tasks/types.ts`
- Create: `src/features/tasks/api/tasks.ts`
- Test: `src/features/tasks/api/tasks.integration.test.ts`

**Interfaces:**
- Consumes: `TASK_COLUMNS`, `TASK_PRIORITIES`, `TaskColumnId`, `TaskPriorityId` from `../columns`; `bottomPosition` from `../lib/position`; the `supabase` singleton.
- Produces: the `Task` type and all `api/tasks.ts` exports listed in the canonical interfaces.

- [ ] **Step 1: Write the failing integration test**

The integration harness is SQL-transaction based, NOT Supabase-client based. `src/test/with-rls.ts` exposes `createAuthUser(email?)` (inserts a synthetic `auth.users` row, returns its uuid), `withRls(userId, sql => ...)` (runs raw SQL impersonating that user via the `authenticated` role and `request.jwt.claim.sub`), and `asService(sql => ...)` (bypasses RLS for seeding). The DB is an ephemeral testcontainer booted in `globalSetup` with every migration applied; there are no seeded demo users and the `api/tasks.ts` client functions are NOT exercised here (they go through kong at runtime and are covered by the hook tests and Playwright e2e). This test targets the `tasks` and `task_assignees` RLS policies directly, matching `src/features/boards/api/board-mutations.integration.test.ts`. Read that file first to match the harness exactly.

```ts
// src/features/tasks/api/tasks.integration.test.ts
import { afterAll, describe, expect, it } from "vitest";
import {
  asService,
  createAuthUser,
  teardownPool,
  withRls,
} from "@/test/with-rls";

async function createBoard(ownerId: string, name: string): Promise<{ id: string; joinCode: string }> {
  return await withRls(ownerId, async (sql) => {
    const [row] = await sql<{ id: string; join_code: string }[]>/* sql */`
      select id, join_code from public.create_board(${name})
    `;
    return { id: row?.id ?? "", joinCode: row?.join_code ?? "" };
  });
}

async function joinBoard(userId: string, joinCode: string): Promise<void> {
  await withRls(userId, async (sql) => {
    await sql/* sql */`select public.join_board_by_code(${joinCode})`;
  });
}

async function insertTask(userId: string, boardId: string, creatorId: string): Promise<string> {
  return await withRls(userId, async (sql) => {
    const [row] = await sql<{ id: string }[]>/* sql */`
      insert into public.tasks (board_id, "column", title, priority, position, created_by)
      values (${boardId}, 'offen', 'Aufgabe', 'mittel', 1024, ${creatorId})
      returning id
    `;
    return row?.id ?? "";
  });
}

afterAll(async () => {
  await teardownPool();
});

describe("tasks RLS", () => {
  it("lets a board member create, read, move and delete a task", async () => {
    const owner = await createAuthUser(`task-owner-${Date.now()}@test.local`);
    const { id: boardId } = await createBoard(owner, "Board");

    const taskId = await insertTask(owner, boardId, owner);
    expect(taskId).not.toBe("");

    const listed = await withRls(owner, (sql) =>
      sql<{ id: string }[]>/* sql */`select id from public.tasks where board_id = ${boardId}`
    );
    expect(listed.map((t) => t.id)).toContain(taskId);

    const moved = await withRls(owner, (sql) =>
      sql<{ id: string }[]>/* sql */`
        update public.tasks set "column" = 'erledigt', position = 2048 where id = ${taskId} returning id
      `
    );
    expect(moved).toHaveLength(1);

    const deleted = await withRls(owner, (sql) =>
      sql<{ id: string }[]>/* sql */`delete from public.tasks where id = ${taskId} returning id`
    );
    expect(deleted).toHaveLength(1);
  });

  it("lets a joined member be assigned as Verantwortliche and see the assignment", async () => {
    const owner = await createAuthUser(`assign-owner-${Date.now()}@test.local`);
    const member = await createAuthUser(`assign-member-${Date.now()}@test.local`);
    const { id: boardId, joinCode } = await createBoard(owner, "Shared");
    await joinBoard(member, joinCode);

    const taskId = await insertTask(owner, boardId, owner);
    const assigned = await withRls(owner, (sql) =>
      sql<{ user_id: string }[]>/* sql */`
        insert into public.task_assignees (task_id, user_id) values (${taskId}, ${member}) returning user_id
      `
    );
    expect(assigned).toHaveLength(1);

    const seenByMember = await withRls(member, (sql) =>
      sql<{ user_id: string }[]>/* sql */`
        select user_id from public.task_assignees where task_id = ${taskId}
      `
    );
    expect(seenByMember.map((a) => a.user_id)).toContain(member);
  });

  it("denies a non-member reading another board's tasks (0 rows via RLS)", async () => {
    const owner = await createAuthUser(`rls-owner-${Date.now()}@test.local`);
    const outsider = await createAuthUser(`rls-outsider-${Date.now()}@test.local`);
    const { id: boardId } = await createBoard(owner, "Private");
    await insertTask(owner, boardId, owner);

    const seen = await withRls(outsider, (sql) =>
      sql<{ id: string }[]>/* sql */`select id from public.tasks where board_id = ${boardId}`
    );
    expect(seen).toEqual([]);
  });

  it("blocks a non-member from inserting a task into a board (RLS violation)", async () => {
    const owner = await createAuthUser(`ins-owner-${Date.now()}@test.local`);
    const outsider = await createAuthUser(`ins-outsider-${Date.now()}@test.local`);
    const { id: boardId } = await createBoard(owner, "Locked");

    await expect(insertTask(outsider, boardId, outsider)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run the integration test**

No `pnpm dev:up` needed: the integration config boots its own ephemeral Postgres testcontainer with every migration applied (`vitest.integration.config.ts` globalSetup). This test exercises the `tasks`/`task_assignees` RLS policies that already exist in `init.sql`, so it should PASS once written. It is a regression guard, not a red-green driver: the new TypeScript from Step 3 is driven red-green by the hook tests in later tasks and verified here only by `tsc`. Write Step 3 first, then this test, if you prefer a compile-clean tree throughout.

Run: `pnpm exec vitest run --config vitest.integration.config.ts src/features/tasks/api/tasks.integration.test.ts`
Expected: PASS (4 tests). If it errors that `DATABASE_URL` is unset, the testcontainers `globalSetup` failed to boot; confirm Docker is available.

- [ ] **Step 3: Write the data layer**

```ts
// src/features/tasks/types.ts
import type { TaskColumnId, TaskPriorityId } from "./columns";

export type Task = {
  id: string;
  boardId: string;
  column: TaskColumnId;
  title: string;
  description: string;
  priority: TaskPriorityId;
  dueDate: string | null;
  position: number;
  assigneeIds: string[];
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};
```

```ts
// src/features/tasks/api/tasks.ts
import { z } from "zod";
import { supabase } from "@/shared/lib/supabase";
import { TASK_COLUMNS, TASK_PRIORITIES } from "../columns";
import type { Task } from "../types";

export const TASK_KEYS = {
  all: ["tasks"] as const,
  byBoard: (boardId: string) => ["tasks", "byBoard", boardId] as const,
};

export const TASK_MUTATION_KEYS = {
  forBoard: (boardId: string) => ["tasks", "mutate", boardId] as const,
};

const COLUMN_IDS = TASK_COLUMNS.map((c) => c.id) as [TaskColumnLiteral, ...TaskColumnLiteral[]];
type TaskColumnLiteral = (typeof TASK_COLUMNS)[number]["id"];
const PRIORITY_IDS = TASK_PRIORITIES.map((p) => p.id) as [TaskPriorityLiteral, ...TaskPriorityLiteral[]];
type TaskPriorityLiteral = (typeof TASK_PRIORITIES)[number]["id"];

const TaskColumnSchema = z.enum(COLUMN_IDS);
const TaskPrioritySchema = z.enum(PRIORITY_IDS);

const AssigneeRowSchema = z.object({ user_id: z.uuid() });

const TaskRowSchema = z.object({
  id: z.uuid(),
  board_id: z.uuid(),
  column: TaskColumnSchema,
  title: z.string(),
  description: z.string(),
  priority: TaskPrioritySchema,
  due_date: z.string().nullable(),
  position: z.number(),
  created_by: z.uuid().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  task_assignees: z.array(AssigneeRowSchema).default([]),
});

const TASK_SELECT =
  'id,board_id,"column",title,description,priority,due_date,position,created_by,created_at,updated_at,task_assignees(user_id)';

function toTask(row: z.infer<typeof TaskRowSchema>): Task {
  return {
    id: row.id,
    boardId: row.board_id,
    column: row.column,
    title: row.title,
    description: row.description,
    priority: row.priority,
    dueDate: row.due_date,
    position: row.position,
    assigneeIds: row.task_assignees.map((a) => a.user_id),
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listBoardTasks(boardId: string): Promise<Task[]> {
  const { data, error } = await supabase
    .from("tasks")
    .select(TASK_SELECT)
    .eq("board_id", boardId)
    .order("column", { ascending: true })
    .order("position", { ascending: true })
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (error) {
    throw error;
  }
  return z.array(TaskRowSchema).parse(data).map(toTask);
}

const CreateTaskInput = z.object({
  boardId: z.uuid(),
  column: TaskColumnSchema,
  title: z.string().trim().min(1).max(200),
  description: z.string().max(5000),
  priority: TaskPrioritySchema,
  dueDate: z.string().nullable(),
  position: z.number(),
});

export async function createTask(input: z.input<typeof CreateTaskInput>): Promise<Task> {
  const parsed = CreateTaskInput.parse(input);
  const { data: auth } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("tasks")
    .insert({
      board_id: parsed.boardId,
      column: parsed.column,
      title: parsed.title,
      description: parsed.description,
      priority: parsed.priority,
      due_date: parsed.dueDate,
      position: parsed.position,
      created_by: auth.user?.id ?? null,
    })
    .select(TASK_SELECT)
    .single();
  if (error) {
    throw error;
  }
  return toTask(TaskRowSchema.parse(data));
}

const UpdateTaskInput = z.object({
  taskId: z.uuid(),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(5000),
  priority: TaskPrioritySchema,
  dueDate: z.string().nullable(),
});

export async function updateTask(input: z.input<typeof UpdateTaskInput>): Promise<Task> {
  const parsed = UpdateTaskInput.parse(input);
  const { data, error } = await supabase
    .from("tasks")
    .update({
      title: parsed.title,
      description: parsed.description,
      priority: parsed.priority,
      due_date: parsed.dueDate,
    })
    .eq("id", parsed.taskId)
    .select(TASK_SELECT)
    .single();
  if (error) {
    throw error;
  }
  return toTask(TaskRowSchema.parse(data));
}

const MoveTaskInput = z.object({
  taskId: z.uuid(),
  column: TaskColumnSchema,
  position: z.number(),
});

export async function moveTask(input: z.input<typeof MoveTaskInput>): Promise<Task> {
  const parsed = MoveTaskInput.parse(input);
  const { data, error } = await supabase
    .from("tasks")
    .update({ column: parsed.column, position: parsed.position })
    .eq("id", parsed.taskId)
    .select(TASK_SELECT)
    .single();
  if (error) {
    throw error;
  }
  return toTask(TaskRowSchema.parse(data));
}

const ReorderTaskInput = z.object({ taskId: z.uuid(), position: z.number() });

export async function reorderTask(input: z.input<typeof ReorderTaskInput>): Promise<Task> {
  const parsed = ReorderTaskInput.parse(input);
  const { data, error } = await supabase
    .from("tasks")
    .update({ position: parsed.position })
    .eq("id", parsed.taskId)
    .select(TASK_SELECT)
    .single();
  if (error) {
    throw error;
  }
  return toTask(TaskRowSchema.parse(data));
}

const DeleteTaskInput = z.object({ taskId: z.uuid() });

export async function deleteTask(input: z.input<typeof DeleteTaskInput>): Promise<void> {
  const parsed = DeleteTaskInput.parse(input);
  const { error } = await supabase.from("tasks").delete().eq("id", parsed.taskId);
  if (error) {
    throw error;
  }
}

const SetAssigneesInput = z.object({
  taskId: z.uuid(),
  userIds: z.array(z.uuid()),
});

export async function setTaskAssignees(
  input: z.input<typeof SetAssigneesInput>
): Promise<void> {
  const parsed = SetAssigneesInput.parse(input);
  const { data: current, error: readError } = await supabase
    .from("task_assignees")
    .select("user_id")
    .eq("task_id", parsed.taskId);
  if (readError) {
    throw readError;
  }
  const existing = new Set(z.array(AssigneeRowSchema).parse(current).map((r) => r.user_id));
  const next = new Set(parsed.userIds);
  const toInsert = parsed.userIds.filter((id) => !existing.has(id));
  const toDelete = [...existing].filter((id) => !next.has(id));
  if (toInsert.length > 0) {
    const { error } = await supabase
      .from("task_assignees")
      .insert(toInsert.map((userId) => ({ task_id: parsed.taskId, user_id: userId })));
    if (error) {
      throw error;
    }
  }
  if (toDelete.length > 0) {
    const { error } = await supabase
      .from("task_assignees")
      .delete()
      .eq("task_id", parsed.taskId)
      .in("user_id", toDelete);
    if (error) {
      throw error;
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run --config vitest.integration.config.ts src/features/tasks/api/tasks.integration.test.ts`
Expected: PASS (4 tests). The third test proves a non-member sees an empty task list for another board; the fourth proves a non-member insert is blocked by RLS.

- [ ] **Step 5: Typecheck and commit**

```bash
pnpm exec tsc -b
git add src/features/tasks/types.ts src/features/tasks/api/tasks.ts src/features/tasks/api/tasks.integration.test.ts
git commit -m "feat(tasks): data layer with zod boundary and RLS integration tests"
```

---

## Task 3: Board member roster (members feature)

The assignee picker needs board members with display names. This lands in the `members` feature (currently an empty stub) and is consumed by tasks via `@/features/members`.

**Files:**
- Create: `src/features/members/types.ts`
- Create: `src/features/members/api/members.ts`
- Create: `src/features/members/hooks/use-board-members.ts`
- Modify: `src/features/members/index.ts`
- Test: `src/features/members/api/members.integration.test.ts`

**Interfaces:**
- Consumes: `supabase` singleton.
- Produces: `BoardMember` type, `MEMBER_KEYS`, `listBoardMembers(boardId)`, `useBoardMembers(boardId)`.

- [ ] **Step 1: Write the failing integration test**

SQL-based, matching the `with-rls` harness (see Task 2's note). This verifies the RLS the picker depends on: a member can read the roster joined to profile display names (`profiles_select` lets co-members see each other), and a non-member cannot. Profiles exist for synthetic users because `createAuthUser` inserts into `auth.users`, which fires the `on_auth_user_created` trigger that seeds `public.profiles` with `display_name = split_part(email,'@',1)`.

```ts
// src/features/members/api/members.integration.test.ts
import { afterAll, describe, expect, it } from "vitest";
import { createAuthUser, teardownPool, withRls } from "@/test/with-rls";

async function createBoard(ownerId: string, name: string): Promise<{ id: string; joinCode: string }> {
  return await withRls(ownerId, async (sql) => {
    const [row] = await sql<{ id: string; join_code: string }[]>/* sql */`
      select id, join_code from public.create_board(${name})
    `;
    return { id: row?.id ?? "", joinCode: row?.join_code ?? "" };
  });
}

async function joinBoard(userId: string, joinCode: string): Promise<void> {
  await withRls(userId, async (sql) => {
    await sql/* sql */`select public.join_board_by_code(${joinCode})`;
  });
}

afterAll(async () => {
  await teardownPool();
});

describe("board member roster RLS", () => {
  it("lets a member read the roster joined to profile display names", async () => {
    const owner = await createAuthUser(`roster-owner-${Date.now()}@test.local`);
    const member = await createAuthUser(`roster-member-${Date.now()}@test.local`);
    const { id: boardId, joinCode } = await createBoard(owner, "Roster Board");
    await joinBoard(member, joinCode);

    const rows = await withRls(owner, (sql) =>
      sql<{ user_id: string; role: string; display_name: string }[]>/* sql */`
        select m.user_id, m.role, p.display_name
        from public.board_members m
        join public.profiles p on p.id = m.user_id
        where m.board_id = ${boardId}
        order by m.role asc
      `
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.display_name.length > 0)).toBe(true);
    expect(rows.map((r) => r.role).sort()).toEqual(["member", "owner"]);
  });

  it("denies a non-member reading a board's roster (0 rows via RLS)", async () => {
    const owner = await createAuthUser(`roster-out-owner-${Date.now()}@test.local`);
    const outsider = await createAuthUser(`roster-outsider-${Date.now()}@test.local`);
    const { id: boardId } = await createBoard(owner, "Closed Roster");

    const rows = await withRls(outsider, (sql) =>
      sql<{ user_id: string }[]>/* sql */`select user_id from public.board_members where board_id = ${boardId}`
    );
    expect(rows).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the integration test**

No `pnpm dev:up` needed (testcontainers boots the DB). This verifies existing RLS, so it PASSES once written; the new `listBoardMembers`/`useBoardMembers` client code is verified by `tsc` and consumed by the assignee picker in Task 10.

Run: `pnpm exec vitest run --config vitest.integration.config.ts src/features/members/api/members.integration.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 3: Implement the roster read**

```ts
// src/features/members/types.ts
export type BoardMember = {
  userId: string;
  role: "owner" | "member";
  displayName: string;
};
```

```ts
// src/features/members/api/members.ts
import { z } from "zod";
import { supabase } from "@/shared/lib/supabase";
import type { BoardMember } from "../types";

export const MEMBER_KEYS = {
  all: ["board-members"] as const,
  byBoard: (boardId: string) => ["board-members", "byBoard", boardId] as const,
};

const MemberRowSchema = z.object({
  user_id: z.uuid(),
  role: z.enum(["owner", "member"]),
  profiles: z.object({ display_name: z.string() }).nullable(),
});

export async function listBoardMembers(boardId: string): Promise<BoardMember[]> {
  const { data, error } = await supabase
    .from("board_members")
    .select("user_id, role, profiles(display_name)")
    .eq("board_id", boardId)
    .order("role", { ascending: true });
  if (error) {
    throw error;
  }
  return z.array(MemberRowSchema).parse(data).map((row) => ({
    userId: row.user_id,
    role: row.role,
    displayName: row.profiles?.display_name ?? "",
  }));
}
```

```ts
// src/features/members/hooks/use-board-members.ts
import { useQuery } from "@tanstack/react-query";
import { listBoardMembers, MEMBER_KEYS } from "../api/members";
import type { BoardMember } from "../types";

export function useBoardMembers(boardId: string): {
  members: BoardMember[];
  isPending: boolean;
  isError: boolean;
  error: Error | null;
} {
  const { data, isPending, isError, error } = useQuery({
    queryKey: MEMBER_KEYS.byBoard(boardId),
    queryFn: () => listBoardMembers(boardId),
    enabled: !!boardId,
    staleTime: 60_000,
    meta: { op: "listBoardMembers", scope: { board: boardId } },
  });
  return { members: data ?? [], isPending, isError, error };
}
```

```ts
// src/features/members/index.ts
export type { BoardMember } from "./types";
export { MEMBER_KEYS } from "./api/members";
export { useBoardMembers } from "./hooks/use-board-members";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run --config vitest.integration.config.ts src/features/members/api/members.integration.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck and commit**

```bash
pnpm exec tsc -b
git add src/features/members/
git commit -m "feat(members): board member roster read for the assignee picker"
```

---

## Task 4: useBoardTasks read hook

The query hook that groups tasks by column. Tested with `@testing-library/react` + a Query wrapper, mocking the `api/` boundary (per `testing.md`).

**Files:**
- Create: `src/features/tasks/hooks/use-board-tasks.ts`
- Create: `src/features/tasks/lib/group.ts`
- Test: `src/features/tasks/lib/group.test.ts`
- Test: `src/features/tasks/hooks/__tests__/use-board-tasks.test.tsx`

**Interfaces:**
- Consumes: `listBoardTasks`, `TASK_KEYS` from `../api/tasks`; `Task` type; `TASK_COLUMNS`.
- Produces: `groupByColumn(tasks)`, `useBoardTasks(boardId)` returning `{ tasksByColumn, tasks, isPending, isError, error }` where `tasksByColumn` is a `Record<TaskColumnId, Task[]>`.

- [ ] **Step 1: Write the failing grouping test**

```ts
// src/features/tasks/lib/group.test.ts
import { describe, expect, it } from "vitest";
import type { Task } from "../types";
import { groupByColumn } from "./group";

function task(partial: Partial<Task> & { id: string; column: Task["column"]; position: number }): Task {
  return {
    boardId: "b", title: "t", description: "", priority: "mittel", dueDate: null,
    assigneeIds: [], createdBy: null, createdAt: "", updatedAt: "", ...partial,
  } as Task;
}

describe("groupByColumn", () => {
  it("buckets tasks into all four columns, empty arrays included", () => {
    const grouped = groupByColumn([task({ id: "1", column: "offen", position: 10 })]);
    expect(Object.keys(grouped)).toEqual(["offen", "zu_erledigen", "in_bearbeitung", "erledigt"]);
    expect(grouped.zu_erledigen).toEqual([]);
  });
  it("sorts within a column by position ascending", () => {
    const grouped = groupByColumn([
      task({ id: "b", column: "offen", position: 20 }),
      task({ id: "a", column: "offen", position: 10 }),
    ]);
    expect(grouped.offen.map((t) => t.id)).toEqual(["a", "b"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS=--no-experimental-webstorage pnpm test -- src/features/tasks/lib/group.test.ts`
Expected: FAIL, "Cannot find module './group'".

- [ ] **Step 3: Implement grouping**

```ts
// src/features/tasks/lib/group.ts
import { TASK_COLUMNS, type TaskColumnId } from "../columns";
import type { Task } from "../types";

export type TasksByColumn = Record<TaskColumnId, Task[]>;

export function groupByColumn(tasks: readonly Task[]): TasksByColumn {
  const grouped = Object.fromEntries(
    TASK_COLUMNS.map((column) => [column.id, [] as Task[]])
  ) as TasksByColumn;
  for (const task of tasks) {
    grouped[task.column].push(task);
  }
  for (const column of TASK_COLUMNS) {
    grouped[column.id].sort((a, b) => a.position - b.position);
  }
  return grouped;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NODE_OPTIONS=--no-experimental-webstorage pnpm test -- src/features/tasks/lib/group.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing hook test**

```tsx
// src/features/tasks/hooks/__tests__/use-board-tasks.test.tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Task } from "../../types";

vi.mock("../../api/tasks", async () => {
  const actual = await vi.importActual<typeof import("../../api/tasks")>("../../api/tasks");
  return { ...actual, listBoardTasks: vi.fn() };
});

import { listBoardTasks } from "../../api/tasks";
import { useBoardTasks } from "../use-board-tasks";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const sample: Task = {
  id: "1", boardId: "b", column: "offen", title: "A", description: "",
  priority: "mittel", dueDate: null, position: 10, assigneeIds: [],
  createdBy: null, createdAt: "", updatedAt: "",
};

afterEach(() => vi.clearAllMocks());

describe("useBoardTasks", () => {
  it("returns tasks grouped by column once loaded", async () => {
    vi.mocked(listBoardTasks).mockResolvedValue([sample]);
    const { result } = renderHook(() => useBoardTasks("b"), { wrapper });
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.tasksByColumn.offen.map((t) => t.id)).toEqual(["1"]);
    expect(result.current.tasksByColumn.erledigt).toEqual([]);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `NODE_OPTIONS=--no-experimental-webstorage pnpm test -- src/features/tasks/hooks/__tests__/use-board-tasks.test.tsx`
Expected: FAIL, "Cannot find module '../use-board-tasks'".

- [ ] **Step 7: Implement the hook**

```ts
// src/features/tasks/hooks/use-board-tasks.ts
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { listBoardTasks, TASK_KEYS } from "../api/tasks";
import { groupByColumn, type TasksByColumn } from "../lib/group";
import type { Task } from "../types";

export function useBoardTasks(boardId: string): {
  tasks: Task[];
  tasksByColumn: TasksByColumn;
  isPending: boolean;
  isError: boolean;
  error: Error | null;
} {
  const { data, isPending, isError, error } = useQuery({
    queryKey: TASK_KEYS.byBoard(boardId),
    queryFn: () => listBoardTasks(boardId),
    enabled: !!boardId,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    refetchOnMount: "always",
    meta: { op: "listBoardTasks", scope: { board: boardId } },
  });
  const tasks = data ?? [];
  return { tasks, tasksByColumn: groupByColumn(tasks), isPending, isError, error };
}
```

- [ ] **Step 8: Run tests, typecheck, commit**

```bash
NODE_OPTIONS=--no-experimental-webstorage pnpm test -- src/features/tasks/hooks/__tests__/use-board-tasks.test.tsx
pnpm exec tsc -b
git add src/features/tasks/hooks/use-board-tasks.ts src/features/tasks/lib/group.ts src/features/tasks/lib/group.test.ts src/features/tasks/hooks/__tests__/use-board-tasks.test.tsx
git commit -m "feat(tasks): useBoardTasks read hook grouped by column"
```

---

## Task 5: Copy constants and read-only board surface

Render the four columns and their cards (no interaction yet), replacing the `TASKS_PLACEHOLDER` card. Board chrome is restructured board-first in Task 12; here the surface renders below the existing chrome so the acceptance test can see cards.

**Files:**
- Create: `src/features/tasks/lib/copy.ts`
- Create: `src/features/tasks/components/priority-badge.tsx`
- Create: `src/features/tasks/components/assignee-avatars.tsx`
- Create: `src/features/tasks/components/task-card.tsx`
- Create: `src/features/tasks/components/task-column.tsx`
- Create: `src/features/tasks/components/board-surface.tsx`
- Modify: `src/features/tasks/index.ts`
- Modify: `src/features/boards/components/board-detail-page.tsx` (swap placeholder for `<BoardSurface boardId={board.id} />`)
- Test: `src/features/tasks/components/__tests__/board-surface.test.tsx`

**Interfaces:**
- Consumes: `useBoardTasks`; `useBoardMembers`; `TASK_COLUMNS`, `TASK_PRIORITIES`; `Task`.
- Produces: `BoardSurface` (exported from the feature index); `TaskCard`, `TaskColumn`, `PriorityBadge`, `AssigneeAvatars`; the `tasks/lib/copy.ts` constants.

- [ ] **Step 1: Write the failing component test**

```tsx
// src/features/tasks/components/__tests__/board-surface.test.tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Task } from "../../types";
import { EMPTY_BOARD_CTA } from "../../lib/copy";

vi.mock("../../api/tasks", async () => {
  const actual = await vi.importActual<typeof import("../../api/tasks")>("../../api/tasks");
  return { ...actual, listBoardTasks: vi.fn() };
});
vi.mock("@/features/members", () => ({ useBoardMembers: () => ({ members: [], isPending: false, isError: false, error: null }) }));

import { listBoardTasks } from "../../api/tasks";
import { BoardSurface } from "../board-surface";

function renderSurface() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<BoardSurface boardId="b" />, { wrapper });
}

const sample: Task = {
  id: "1", boardId: "b", column: "offen", title: "Sichtbare Aufgabe", description: "",
  priority: "hoch", dueDate: null, position: 10, assigneeIds: [],
  createdBy: null, createdAt: "", updatedAt: "",
};

afterEach(() => vi.clearAllMocks());

describe("BoardSurface", () => {
  it("renders a task card once loaded", async () => {
    vi.mocked(listBoardTasks).mockResolvedValue([sample]);
    renderSurface();
    expect(await screen.findByText("Sichtbare Aufgabe")).toBeInTheDocument();
  });
  it("shows the empty-board CTA when there are no tasks", async () => {
    vi.mocked(listBoardTasks).mockResolvedValue([]);
    renderSurface();
    await waitFor(() => expect(screen.getByText(EMPTY_BOARD_CTA)).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS=--no-experimental-webstorage pnpm test -- src/features/tasks/components/__tests__/board-surface.test.tsx`
Expected: FAIL, "Cannot find module '../../lib/copy'".

- [ ] **Step 3: Write copy constants**

```ts
// src/features/tasks/lib/copy.ts
export const ADD_TASK_LABEL = "Aufgabe hinzufügen";
export const EMPTY_BOARD_CTA = "Erste Aufgabe erstellen";
export const EMPTY_COLUMN_HINT = "Keine Aufgaben";
export const TASKS_LOAD_ERROR = "Aufgaben konnten nicht geladen werden.";
export const RETRY_LABEL = "Erneut versuchen";

export const TASK_TITLE_LABEL = "Titel";
export const TASK_TITLE_PLACEHOLDER = "Was ist zu tun?";
export const TASK_DESCRIPTION_LABEL = "Beschreibung";
export const TASK_COLUMN_LABEL = "Spalte";
export const TASK_PRIORITY_LABEL = "Priorität";
export const TASK_DUE_LABEL = "Fällig am";
export const TASK_ASSIGNEES_LABEL = "Verantwortliche";
export const SAVE_TASK_LABEL = "Speichern";
export const CREATE_TASK_TITLE = "Neue Aufgabe";
export const CLOSE_LABEL = "Schließen";

export const DELETE_TASK_LABEL = "Löschen";
export const DELETE_ZONE_LABEL = "Zum Löschen hierher ziehen";
export const TASK_DELETED_TOAST = "Aufgabe gelöscht";
export const UNDO_LABEL = "Rückgängig";

export const REORDER_HANDLE_LABEL = "Aufgabe verschieben";
```

- [ ] **Step 4: Write the presentational components**

```tsx
// src/features/tasks/components/priority-badge.tsx
import { Badge } from "@/shared/components/ui/badge";
import { TASK_PRIORITIES, type TaskPriorityId } from "../columns";

const TONE_CLASS: Record<TaskPriorityId, string> = {
  niedrig: "bg-muted text-muted-foreground",
  mittel: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  hoch: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
};

export function PriorityBadge({ priority }: { priority: TaskPriorityId }) {
  const label = TASK_PRIORITIES.find((p) => p.id === priority)?.label ?? priority;
  return (
    <Badge className={TONE_CLASS[priority]} variant="secondary">
      {label}
    </Badge>
  );
}
```

```tsx
// src/features/tasks/components/assignee-avatars.tsx
import { Avatar, AvatarFallback } from "@/shared/components/ui/avatar";
import { useBoardMembers } from "@/features/members";

const MAX_SHOWN = 3;

function initials(name: string): string {
  const trimmed = name.trim();
  return trimmed ? trimmed.slice(0, 2).toUpperCase() : "?";
}

export function AssigneeAvatars({
  boardId,
  assigneeIds,
}: {
  boardId: string;
  assigneeIds: string[];
}) {
  const { members } = useBoardMembers(boardId);
  if (assigneeIds.length === 0) {
    return null;
  }
  const shown = assigneeIds.slice(0, MAX_SHOWN);
  const overflow = assigneeIds.length - shown.length;
  return (
    <div className="flex items-center -space-x-2">
      {shown.map((id) => {
        const name = members.find((m) => m.userId === id)?.displayName ?? "";
        return (
          <Avatar className="size-6 ring-2 ring-card" key={id}>
            <AvatarFallback className="bg-primary text-[10px] text-primary-foreground">
              {initials(name)}
            </AvatarFallback>
          </Avatar>
        );
      })}
      {overflow > 0 ? (
        <span className="ml-3 text-muted-foreground text-xs">+{overflow}</span>
      ) : null}
    </div>
  );
}
```

```tsx
// src/features/tasks/components/task-card.tsx
import { Card } from "@/shared/components/ui/card";
import type { Task } from "../types";
import { AssigneeAvatars } from "./assignee-avatars";
import { PriorityBadge } from "./priority-badge";

export function TaskCard({ task, onOpen }: { task: Task; onOpen: (task: Task) => void }) {
  return (
    <Card
      className="flex cursor-pointer flex-col gap-2 p-3 text-left"
      data-testid="task-card"
      onClick={() => onOpen(task)}
    >
      <p className="line-clamp-3 font-medium text-sm">{task.title}</p>
      <div className="flex items-center justify-between gap-2">
        <PriorityBadge priority={task.priority} />
        <AssigneeAvatars assigneeIds={task.assigneeIds} boardId={task.boardId} />
      </div>
    </Card>
  );
}
```

```tsx
// src/features/tasks/components/task-column.tsx
import { Plus } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import type { TaskColumnId } from "../columns";
import { ADD_TASK_LABEL, EMPTY_COLUMN_HINT } from "../lib/copy";
import type { Task } from "../types";
import { TaskCard } from "./task-card";

export function TaskColumn({
  columnId,
  label,
  tasks,
  onOpen,
  onAdd,
}: {
  columnId: TaskColumnId;
  label: string;
  tasks: Task[];
  onOpen: (task: Task) => void;
  onAdd: (columnId: TaskColumnId) => void;
}) {
  return (
    <section
      aria-label={label}
      className="flex w-[85vw] shrink-0 snap-start flex-col gap-3 rounded-xl bg-muted/40 p-3 md:w-auto"
    >
      <header className="flex items-center justify-between">
        <h2 className="font-semibold text-sm">
          {label} <span className="text-muted-foreground">({tasks.length})</span>
        </h2>
        <Button
          aria-label={`${ADD_TASK_LABEL}: ${label}`}
          onClick={() => onAdd(columnId)}
          size="icon"
          type="button"
          variant="ghost"
        >
          <Plus className="size-4" />
        </Button>
      </header>
      <div className="flex flex-col gap-2">
        {tasks.length === 0 ? (
          <p className="px-1 py-6 text-center text-muted-foreground text-xs">
            {EMPTY_COLUMN_HINT}
          </p>
        ) : (
          tasks.map((task) => <TaskCard key={task.id} onOpen={onOpen} task={task} />)
        )}
      </div>
    </section>
  );
}
```

```tsx
// src/features/tasks/components/board-surface.tsx
import { useIsRestoring } from "@tanstack/react-query";
import { useState } from "react";
import { Alert, AlertDescription } from "@/shared/components/ui/alert";
import { Button } from "@/shared/components/ui/button";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { TASK_COLUMNS, type TaskColumnId } from "../columns";
import { useBoardTasks } from "../hooks/use-board-tasks";
import { EMPTY_BOARD_CTA, TASKS_LOAD_ERROR } from "../lib/copy";
import type { Task } from "../types";
import { TaskColumn } from "./task-column";

export function BoardSurface({ boardId }: { boardId: string }) {
  const isRestoring = useIsRestoring();
  const { tasks, tasksByColumn, isPending, isError } = useBoardTasks(boardId);
  const [openTask, setOpenTask] = useState<Task | null>(null);
  const [createColumn, setCreateColumn] = useState<TaskColumnId | null>(null);

  if ((isPending || isRestoring) && tasks.length === 0) {
    return (
      <div className="flex gap-3 overflow-x-auto md:grid md:grid-cols-4">
        {TASK_COLUMNS.map((column) => (
          <Skeleton className="h-40 w-[85vw] shrink-0 rounded-xl md:w-auto" key={column.id} />
        ))}
      </div>
    );
  }

  if (isError && tasks.length === 0) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{TASKS_LOAD_ERROR}</AlertDescription>
      </Alert>
    );
  }

  const isEmpty = tasks.length === 0;

  return (
    <div className="flex flex-col gap-4">
      {isEmpty ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed py-10">
          <Button onClick={() => setCreateColumn("offen")} type="button">
            {EMPTY_BOARD_CTA}
          </Button>
        </div>
      ) : null}
      <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 md:grid md:grid-cols-4 md:overflow-visible">
        {TASK_COLUMNS.map((column) => (
          <TaskColumn
            columnId={column.id}
            key={column.id}
            label={column.label}
            onAdd={setCreateColumn}
            onOpen={setOpenTask}
            tasks={tasksByColumn[column.id]}
          />
        ))}
      </div>
      {/* TaskDetailSheet is wired in Task 7; openTask / createColumn drive it. */}
      {openTask || createColumn ? null : null}
    </div>
  );
}
```

Note: `openTask` and `createColumn` state is unused until Task 7 wires the sheet. To keep this task lint-clean without dead state, temporarily read them into a `data-` attribute:
Replace the trailing comment line with:

```tsx
      <span className="hidden" data-open={openTask?.id} data-create={createColumn} />
```

- [ ] **Step 5: Wire into the feature index and the board page**

```ts
// src/features/tasks/index.ts  (append to the existing exports)
export { BoardSurface } from "./components/board-surface";
```

In `src/features/boards/components/board-detail-page.tsx`, replace the placeholder `Card` (the block importing and rendering `TASKS_PLACEHOLDER`) with:

```tsx
import { BoardSurface } from "@/features/tasks";
// ...
<BoardSurface boardId={board.id} />
```

Remove the now-unused `TASKS_PLACEHOLDER` import from `../lib/copy` and, if nothing else uses it, the constant itself.

- [ ] **Step 6: Run tests, lint, typecheck, commit**

```bash
NODE_OPTIONS=--no-experimental-webstorage pnpm test -- src/features/tasks/components/__tests__/board-surface.test.tsx
pnpm check
pnpm exec tsc -b
git add src/features/tasks/ src/features/boards/components/board-detail-page.tsx src/features/boards/lib/copy.ts
git commit -m "feat(tasks): read-only board surface with columns, cards, empty and error states"
```

---

## Task 6: New Base UI primitives (textarea, toggle-group, checkbox)

Author the three missing shadcn-style primitives on Base UI, matching the existing `button`/`input` files. Reference the shadcn class strings but wire to `@base-ui/react`, never Radix (`.claude/rules/frontend/components.md`).

**Files:**
- Create: `src/shared/components/ui/textarea.tsx`
- Create: `src/shared/components/ui/toggle-group.tsx`
- Create: `src/shared/components/ui/checkbox.tsx`
- Test: `src/shared/components/ui/__tests__/toggle-group.test.tsx`
- Test: `src/shared/components/ui/__tests__/checkbox.test.tsx`

**Interfaces:**
- Consumes: `@base-ui/react/toggle-group`, `@base-ui/react/toggle`, `@base-ui/react/checkbox`; `cn`.
- Produces: `Textarea`; `ToggleGroup`, `ToggleGroupItem`; `Checkbox`.

- [ ] **Step 1: Write the failing primitive tests**

```tsx
// src/shared/components/ui/__tests__/toggle-group.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { ToggleGroup, ToggleGroupItem } from "../toggle-group";

function Controlled() {
  const [value, setValue] = useState<string>("a");
  return (
    <ToggleGroup onValueChange={setValue} value={value}>
      <ToggleGroupItem value="a">A</ToggleGroupItem>
      <ToggleGroupItem value="b">B</ToggleGroupItem>
    </ToggleGroup>
  );
}

describe("ToggleGroup", () => {
  it("selects a single value and reflects pressed state", async () => {
    render(<Controlled />);
    const b = screen.getByRole("radio", { name: "B" });
    await userEvent.click(b);
    expect(b).toHaveAttribute("aria-checked", "true");
  });
});
```

```tsx
// src/shared/components/ui/__tests__/checkbox.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { Checkbox } from "../checkbox";

function Controlled() {
  const [checked, setChecked] = useState(false);
  return <Checkbox aria-label="Alice" checked={checked} onCheckedChange={setChecked} />;
}

describe("Checkbox", () => {
  it("toggles checked state on click", async () => {
    render(<Controlled />);
    const box = screen.getByRole("checkbox", { name: "Alice" });
    expect(box).toHaveAttribute("aria-checked", "false");
    await userEvent.click(box);
    expect(box).toHaveAttribute("aria-checked", "true");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `NODE_OPTIONS=--no-experimental-webstorage pnpm test -- src/shared/components/ui/__tests__/toggle-group.test.tsx src/shared/components/ui/__tests__/checkbox.test.tsx`
Expected: FAIL, "Cannot find module '../toggle-group'".

- [ ] **Step 3: Implement the primitives**

Confirm the Base UI export paths first: `node -e "require('@base-ui/react/toggle-group'); require('@base-ui/react/toggle'); require('@base-ui/react/checkbox')"` should not throw. If a subpath differs, check `node_modules/@base-ui/react/**/*.d.ts` and adjust the import.

```tsx
// src/shared/components/ui/textarea.tsx
import type { ComponentProps } from "react";
import { cn } from "@/shared/lib/utils";

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "flex min-h-20 w-full rounded-lg border border-input bg-transparent px-3 py-2 text-base shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30",
        className
      )}
      data-slot="textarea"
      {...props}
    />
  );
}
```

```tsx
// src/shared/components/ui/toggle-group.tsx
import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";
import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group";
import { cn } from "@/shared/lib/utils";

function ToggleGroup({ className, ...props }: ToggleGroupPrimitive.Props) {
  return (
    <ToggleGroupPrimitive
      className={cn("inline-flex gap-1 rounded-lg bg-muted p-1", className)}
      data-slot="toggle-group"
      {...props}
    />
  );
}

function ToggleGroupItem({ className, ...props }: TogglePrimitive.Props) {
  return (
    <TogglePrimitive
      className={cn(
        "inline-flex min-h-9 flex-1 items-center justify-center rounded-md px-2 text-sm outline-none transition-colors data-pressed:bg-background data-pressed:font-medium data-pressed:shadow-sm focus-visible:ring-[3px] focus-visible:ring-ring/50",
        className
      )}
      data-slot="toggle-group-item"
      {...props}
    />
  );
}

export { ToggleGroup, ToggleGroupItem };
```

Note on the API: `@base-ui/react` `ToggleGroup` is single- or multi-selectable via its `value`/`onValueChange` (array) or `toggleMultiple` prop. For single-select (Spalte, Priorität), pass a one-element value array and read `value[0]`, OR use `toggleMultiple={false}`. If the installed version exposes a boolean single-select differently, verify against its `.d.ts` and adjust; the test asserts `role="radio"` + `aria-checked`, which single-select mode provides. If single-select is only array-shaped, change the test to assert `aria-pressed` on `role="button"` and adjust `TaskDetailSheet` (Task 7) to map `value[0]`.

```tsx
// src/shared/components/ui/checkbox.tsx
import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { Check } from "lucide-react";
import { cn } from "@/shared/lib/utils";

export function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded border border-input outline-none transition-colors data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50",
        className
      )}
      data-slot="checkbox"
      {...props}
    >
      <CheckboxPrimitive.Indicator>
        <Check className="size-3.5" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `NODE_OPTIONS=--no-experimental-webstorage pnpm test -- src/shared/components/ui/__tests__/toggle-group.test.tsx src/shared/components/ui/__tests__/checkbox.test.tsx`
Expected: PASS. If the ToggleGroup role assertion fails, apply the `.d.ts`-driven adjustment noted in Step 3 before moving on.

- [ ] **Step 5: Lint, typecheck, commit**

```bash
pnpm check
pnpm exec tsc -b
git add src/shared/components/ui/textarea.tsx src/shared/components/ui/toggle-group.tsx src/shared/components/ui/checkbox.tsx src/shared/components/ui/__tests__/
git commit -m "feat(ui): textarea, toggle-group and checkbox primitives on Base UI"
```

---

## Task 7: Task detail sheet (create and edit)

The responsive view/edit surface (Drawer on mobile, Sheet on desktop), driven by `useCreateTask` and `useUpdateTask`. Wires the `openTask` / `createColumn` state left in `BoardSurface`.

**Files:**
- Create: `src/features/tasks/hooks/use-create-task.ts`
- Create: `src/features/tasks/hooks/use-update-task.ts`
- Create: `src/features/tasks/components/task-detail-sheet.tsx`
- Modify: `src/features/tasks/components/board-surface.tsx` (render the sheet)
- Test: `src/features/tasks/hooks/__tests__/use-create-task.test.tsx`
- Test: `src/features/tasks/components/__tests__/task-detail-sheet.test.tsx`

**Interfaces:**
- Consumes: `createTask`, `updateTask`, `TASK_KEYS`, `TASK_MUTATION_KEYS`; `bottomPosition`; `useBoardTasks`; `TASK_COLUMNS`, `TASK_PRIORITIES`; the `Textarea`, `ToggleGroup`, `ToggleGroupItem`, `Input`, `Label`, `Drawer*`, `Sheet*`, `Button` primitives; `useMediaQuery`.
- Produces: `useCreateTask(boardId)`, `useUpdateTask(boardId)`, `TaskDetailSheet`.

- [ ] **Step 1: Write the failing create-hook test (optimistic add + rollback)**

```tsx
// src/features/tasks/hooks/__tests__/use-create-task.test.tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TASK_KEYS } from "../../api/tasks";
import type { Task } from "../../types";

vi.mock("../../api/tasks", async () => {
  const actual = await vi.importActual<typeof import("../../api/tasks")>("../../api/tasks");
  return { ...actual, createTask: vi.fn() };
});
import { createTask } from "../../api/tasks";
import { useCreateTask } from "../use-create-task";

function makeWrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}
const server: Task = {
  id: "real", boardId: "b", column: "offen", title: "Neu", description: "",
  priority: "mittel", dueDate: null, position: 1024, assigneeIds: [],
  createdBy: null, createdAt: "", updatedAt: "",
};
afterEach(() => vi.clearAllMocks());

describe("useCreateTask", () => {
  it("optimistically adds a temp card, then reconciles", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    client.setQueryData(TASK_KEYS.byBoard("b"), []);
    vi.mocked(createTask).mockResolvedValue(server);
    const { result } = renderHook(() => useCreateTask("b"), { wrapper: makeWrapper(client) });
    act(() => {
      result.current.mutate({ column: "offen", title: "Neu", description: "", priority: "mittel", dueDate: null });
    });
    await waitFor(() => {
      const cache = client.getQueryData<Task[]>(TASK_KEYS.byBoard("b"));
      expect(cache?.some((t) => t.title === "Neu")).toBe(true);
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it("rolls back the optimistic card on error", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    client.setQueryData(TASK_KEYS.byBoard("b"), []);
    vi.mocked(createTask).mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useCreateTask("b"), { wrapper: makeWrapper(client) });
    act(() => {
      result.current.mutate({ column: "offen", title: "Neu", description: "", priority: "mittel", dueDate: null });
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(client.getQueryData<Task[]>(TASK_KEYS.byBoard("b"))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS=--no-experimental-webstorage pnpm test -- src/features/tasks/hooks/__tests__/use-create-task.test.tsx`
Expected: FAIL, "Cannot find module '../use-create-task'".

- [ ] **Step 3: Implement the create and update hooks**

```ts
// src/features/tasks/hooks/use-create-task.ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createTask, TASK_KEYS, TASK_MUTATION_KEYS } from "../api/tasks";
import type { TaskColumnId } from "../columns";
import { bottomPosition } from "../lib/position";
import type { Task } from "../types";
import type { TaskPriorityId } from "../columns";

const TEMP_PREFIX = "temp-";
let tempCounter = 0;

export type CreateTaskVars = {
  column: TaskColumnId;
  title: string;
  description: string;
  priority: TaskPriorityId;
  dueDate: string | null;
};

type Ctx = { previous: Task[] | undefined; tempId: string };

export function useCreateTask(boardId: string) {
  const queryClient = useQueryClient();
  const key = TASK_KEYS.byBoard(boardId);

  return useMutation<Task, Error, CreateTaskVars, Ctx>({
    mutationKey: TASK_MUTATION_KEYS.forBoard(boardId),
    meta: { op: "createTask", scope: { board: boardId } },
    mutationFn: (vars) => {
      const current = queryClient.getQueryData<Task[]>(key) ?? [];
      const inColumn = current.filter((t) => t.column === vars.column);
      return createTask({
        boardId,
        column: vars.column,
        title: vars.title,
        description: vars.description,
        priority: vars.priority,
        dueDate: vars.dueDate,
        position: bottomPosition(inColumn),
      });
    },
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Task[]>(key);
      const inColumn = (previous ?? []).filter((t) => t.column === vars.column);
      tempCounter += 1;
      const tempId = `${TEMP_PREFIX}${tempCounter}`;
      const optimistic: Task = {
        id: tempId, boardId, column: vars.column, title: vars.title,
        description: vars.description, priority: vars.priority, dueDate: vars.dueDate,
        position: bottomPosition(inColumn), assigneeIds: [], createdBy: null,
        createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
      };
      queryClient.setQueryData<Task[]>(key, (cur) => [...(cur ?? []), optimistic]);
      return { previous, tempId };
    },
    onSuccess: (created, _vars, ctx) => {
      queryClient.setQueryData<Task[]>(key, (cur) =>
        (cur ?? []).map((t) => (t.id === ctx.tempId ? created : t))
      );
    },
    onError: (_e, _vars, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(key, ctx.previous);
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
}
```

```ts
// src/features/tasks/hooks/use-update-task.ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { TASK_KEYS, TASK_MUTATION_KEYS, updateTask } from "../api/tasks";
import type { TaskColumnId, TaskPriorityId } from "../columns";
import type { Task } from "../types";

export type UpdateTaskVars = {
  taskId: string;
  title: string;
  description: string;
  priority: TaskPriorityId;
  dueDate: string | null;
};

type Ctx = { previous: Task[] | undefined };

export function useUpdateTask(boardId: string) {
  const queryClient = useQueryClient();
  const key = TASK_KEYS.byBoard(boardId);

  return useMutation<Task, Error, UpdateTaskVars, Ctx>({
    mutationKey: TASK_MUTATION_KEYS.forBoard(boardId),
    meta: { op: "updateTask", scope: { board: boardId } },
    mutationFn: (vars) => updateTask(vars),
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Task[]>(key);
      queryClient.setQueryData<Task[]>(key, (cur) =>
        (cur ?? []).map((t) =>
          t.id === vars.taskId
            ? { ...t, title: vars.title, description: vars.description, priority: vars.priority, dueDate: vars.dueDate }
            : t
        )
      );
      return { previous };
    },
    onError: (_e, _vars, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(key, ctx.previous);
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
}
```

Unused `TaskColumnId` import guard: `use-update-task.ts` imports only `TaskPriorityId`; drop `TaskColumnId` if the linter flags it.

- [ ] **Step 4: Run the create-hook test to green**

Run: `NODE_OPTIONS=--no-experimental-webstorage pnpm test -- src/features/tasks/hooks/__tests__/use-create-task.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Write the failing detail-sheet test**

```tsx
// src/features/tasks/components/__tests__/task-detail-sheet.test.tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CREATE_TASK_TITLE, SAVE_TASK_LABEL, TASK_TITLE_LABEL } from "../../lib/copy";

vi.mock("../../api/tasks", async () => {
  const actual = await vi.importActual<typeof import("../../api/tasks")>("../../api/tasks");
  return { ...actual, createTask: vi.fn().mockResolvedValue({
    id: "r", boardId: "b", column: "offen", title: "X", description: "",
    priority: "mittel", dueDate: null, position: 1024, assigneeIds: [],
    createdBy: null, createdAt: "", updatedAt: "" }) };
});
vi.mock("@/features/members", () => ({ useBoardMembers: () => ({ members: [], isPending: false, isError: false, error: null }) }));

import { createTask } from "../../api/tasks";
import { TaskDetailSheet } from "../task-detail-sheet";

function renderSheet() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(
    <TaskDetailSheet boardId="b" mode={{ kind: "create", column: "offen" }} onOpenChange={() => undefined} open />,
    { wrapper }
  );
}
afterEach(() => vi.clearAllMocks());

describe("TaskDetailSheet (create)", () => {
  it("creates a task from the title field", async () => {
    renderSheet();
    expect(screen.getByText(CREATE_TASK_TITLE)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(TASK_TITLE_LABEL), "Neue Sache");
    await userEvent.click(screen.getByRole("button", { name: SAVE_TASK_LABEL }));
    expect(createTask).toHaveBeenCalledWith(expect.objectContaining({ title: "Neue Sache", column: "offen" }));
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `NODE_OPTIONS=--no-experimental-webstorage pnpm test -- src/features/tasks/components/__tests__/task-detail-sheet.test.tsx`
Expected: FAIL, "Cannot find module '../task-detail-sheet'".

- [ ] **Step 7: Implement the detail sheet**

First read `src/shared/components/ui/sheet.tsx` to confirm the exported part names (`Sheet`, `SheetContent`, `SheetHeader`, `SheetTitle`, `SheetClose`). Then:

```tsx
// src/features/tasks/components/task-detail-sheet.tsx
import { type ReactNode, useState } from "react";
import { Button } from "@/shared/components/ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/shared/components/ui/drawer";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/shared/components/ui/sheet";
import { Textarea } from "@/shared/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/shared/components/ui/toggle-group";
import { useMediaQuery } from "@/shared/hooks/use-media-query";
import { TASK_COLUMNS, TASK_PRIORITIES, type TaskColumnId, type TaskPriorityId } from "../columns";
import { useCreateTask } from "../hooks/use-create-task";
import { useUpdateTask } from "../hooks/use-update-task";
import {
  CLOSE_LABEL,
  CREATE_TASK_TITLE,
  SAVE_TASK_LABEL,
  TASK_COLUMN_LABEL,
  TASK_DESCRIPTION_LABEL,
  TASK_DUE_LABEL,
  TASK_PRIORITY_LABEL,
  TASK_TITLE_LABEL,
  TASK_TITLE_PLACEHOLDER,
} from "../lib/copy";
import type { Task } from "../types";

const DESKTOP_QUERY = "(min-width: 768px)";

export type TaskDetailMode =
  | { kind: "create"; column: TaskColumnId }
  | { kind: "edit"; task: Task };

type FormState = {
  title: string;
  description: string;
  column: TaskColumnId;
  priority: TaskPriorityId;
  dueDate: string;
};

function initialForm(mode: TaskDetailMode): FormState {
  if (mode.kind === "create") {
    return { title: "", description: "", column: mode.column, priority: "mittel", dueDate: "" };
  }
  const t = mode.task;
  return { title: t.title, description: t.description, column: t.column, priority: t.priority, dueDate: t.dueDate ?? "" };
}

export function TaskDetailSheet({
  boardId,
  mode,
  open,
  onOpenChange,
}: {
  boardId: string;
  mode: TaskDetailMode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const createTask = useCreateTask(boardId);
  const updateTask = useUpdateTask(boardId);
  const [form, setForm] = useState<FormState>(() => initialForm(mode));

  const busy = createTask.isPending || updateTask.isPending;

  async function save(): Promise<void> {
    if (busy || form.title.trim() === "") {
      return;
    }
    const dueDate = form.dueDate === "" ? null : form.dueDate;
    try {
      if (mode.kind === "create") {
        await createTask.mutateAsync({
          column: form.column, title: form.title.trim(), description: form.description,
          priority: form.priority, dueDate,
        });
      } else {
        await updateTask.mutateAsync({
          taskId: mode.task.id, title: form.title.trim(), description: form.description,
          priority: form.priority, dueDate,
        });
      }
      onOpenChange(false);
    } catch {
      // Optimistic update rolled back; the global toast surfaces the error.
    }
  }

  const body = (
    <div className="flex flex-col gap-4 px-4 pb-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="task-title">{TASK_TITLE_LABEL}</Label>
        <Input
          autoFocus
          id="task-title"
          onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          placeholder={TASK_TITLE_PLACEHOLDER}
          value={form.title}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="task-desc">{TASK_DESCRIPTION_LABEL}</Label>
        <Textarea
          id="task-desc"
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          value={form.description}
        />
      </div>
      <div className="flex flex-col gap-2">
        <span className="font-medium text-sm">{TASK_COLUMN_LABEL}</span>
        <ToggleGroup
          className="flex-col md:flex-row"
          onValueChange={(value: string) => setForm((f) => ({ ...f, column: value as TaskColumnId }))}
          value={form.column}
        >
          {TASK_COLUMNS.map((column) => (
            <ToggleGroupItem key={column.id} value={column.id}>
              {column.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <div className="flex flex-col gap-2">
        <span className="font-medium text-sm">{TASK_PRIORITY_LABEL}</span>
        <ToggleGroup
          onValueChange={(value: string) => setForm((f) => ({ ...f, priority: value as TaskPriorityId }))}
          value={form.priority}
        >
          {TASK_PRIORITIES.map((priority) => (
            <ToggleGroupItem key={priority.id} value={priority.id}>
              {priority.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="task-due">{TASK_DUE_LABEL}</Label>
        <Input
          id="task-due"
          onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
          type="date"
          value={form.dueDate}
        />
      </div>
      {/* AssigneePicker slots in here in Task 10 (edit mode only). */}
      <Button disabled={busy || form.title.trim() === ""} onClick={save} type="button">
        {SAVE_TASK_LABEL}
      </Button>
    </div>
  );

  const title = mode.kind === "create" ? CREATE_TASK_TITLE : mode.task.title;

  if (isDesktop) {
    return (
      <Sheet onOpenChange={onOpenChange} open={open}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md" side="right">
          <SheetHeader>
            <SheetTitle>{title}</SheetTitle>
          </SheetHeader>
          {body}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Drawer onOpenChange={onOpenChange} open={open}>
      <DrawerContent className="max-h-[90vh] overflow-y-auto">
        <DrawerHeader>
          <DrawerTitle>{title}</DrawerTitle>
        </DrawerHeader>
        {body}
        <DrawerClose className="sr-only">{CLOSE_LABEL}</DrawerClose>
      </DrawerContent>
    </Drawer>
  );
}
```

If the ToggleGroup single-select API turned out array-shaped in Task 6, wrap `value` as `[form.column]` and read `value[0]` in `onValueChange` here (the only two call sites).

The unused `ReactNode` import: remove it if the linter flags it.

- [ ] **Step 8: Wire the sheet into `BoardSurface`**

Replace the `<span className="hidden" ...>` placeholder in `board-surface.tsx` with:

```tsx
      {openTask ? (
        <TaskDetailSheet
          boardId={boardId}
          mode={{ kind: "edit", task: openTask }}
          onOpenChange={(next) => { if (!next) { setOpenTask(null); } }}
          open
        />
      ) : null}
      {createColumn ? (
        <TaskDetailSheet
          boardId={boardId}
          mode={{ kind: "create", column: createColumn }}
          onOpenChange={(next) => { if (!next) { setCreateColumn(null); } }}
          open
        />
      ) : null}
```

Add `import { TaskDetailSheet } from "./task-detail-sheet";` to `board-surface.tsx`.

- [ ] **Step 9: Run tests, lint, typecheck, commit**

```bash
NODE_OPTIONS=--no-experimental-webstorage pnpm test -- src/features/tasks/components/__tests__/task-detail-sheet.test.tsx src/features/tasks/hooks/__tests__/use-create-task.test.tsx
pnpm check
pnpm exec tsc -b
git add src/features/tasks/
git commit -m "feat(tasks): create/edit task detail sheet with optimistic writes"
```

---

## Task 8: Drag-to-reorder within a column

Add the `DndContext` with split sensors and `SortableContext` per column, plus `useReorderTask`. Whole-card long-press (touch) or immediate (mouse) drag; tap still opens the sheet.

**Files:**
- Create: `src/features/tasks/hooks/use-reorder-task.ts`
- Create: `src/features/tasks/components/sortable-task-card.tsx`
- Modify: `src/features/tasks/components/task-column.tsx` (wrap cards in `SortableContext`)
- Modify: `src/features/tasks/components/board-surface.tsx` (add `DndContext`, sensors, `onDragEnd`)
- Test: `src/features/tasks/hooks/__tests__/use-reorder-task.test.tsx`

**Interfaces:**
- Consumes: `reorderTask`, `TASK_KEYS`, `TASK_MUTATION_KEYS`; `positionForMove`, `hasRepresentableGap`, `renormalize`; `@dnd-kit/core`, `@dnd-kit/sortable`.
- Produces: `useReorderTask(boardId)` with vars `{ taskId: string; column: TaskColumnId; toIndex: number }`; `SortableTaskCard`.

- [ ] **Step 1: Write the failing reorder-hook test**

```tsx
// src/features/tasks/hooks/__tests__/use-reorder-task.test.tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TASK_KEYS } from "../../api/tasks";
import type { Task } from "../../types";

vi.mock("../../api/tasks", async () => {
  const actual = await vi.importActual<typeof import("../../api/tasks")>("../../api/tasks");
  return { ...actual, reorderTask: vi.fn() };
});
import { reorderTask } from "../../api/tasks";
import { useReorderTask } from "../use-reorder-task";

function task(id: string, position: number): Task {
  return { id, boardId: "b", column: "offen", title: id, description: "", priority: "mittel",
    dueDate: null, position, assigneeIds: [], createdBy: null, createdAt: "", updatedAt: "" };
}
function wrapperFor(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}
afterEach(() => vi.clearAllMocks());

describe("useReorderTask", () => {
  it("writes the midpoint position for the target index", async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    client.setQueryData(TASK_KEYS.byBoard("b"), [task("a", 1024), task("b", 2048), task("c", 3072)]);
    vi.mocked(reorderTask).mockImplementation(async (i) => task("c", i.position));
    const { result } = renderHook(() => useReorderTask("b"), { wrapper: wrapperFor(client) });
    act(() => { result.current.mutate({ taskId: "c", column: "offen", toIndex: 0 }); });
    await waitFor(() => expect(reorderTask).toHaveBeenCalledWith({ taskId: "c", position: 512 }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS=--no-experimental-webstorage pnpm test -- src/features/tasks/hooks/__tests__/use-reorder-task.test.tsx`
Expected: FAIL, "Cannot find module '../use-reorder-task'".

- [ ] **Step 3: Implement the reorder hook**

```ts
// src/features/tasks/hooks/use-reorder-task.ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { reorderTask, TASK_KEYS, TASK_MUTATION_KEYS } from "../api/tasks";
import type { TaskColumnId } from "../columns";
import { hasRepresentableGap, positionForMove, renormalize } from "../lib/position";
import type { Task } from "../types";

export type ReorderTaskVars = { taskId: string; column: TaskColumnId; toIndex: number };
type Ctx = { previous: Task[] | undefined };

function orderedColumn(tasks: Task[], column: TaskColumnId, exceptId: string): Task[] {
  return tasks
    .filter((t) => t.column === column && t.id !== exceptId)
    .sort((a, b) => a.position - b.position);
}

export function useReorderTask(boardId: string) {
  const queryClient = useQueryClient();
  const key = TASK_KEYS.byBoard(boardId);

  return useMutation<Task, Error, ReorderTaskVars, Ctx>({
    mutationKey: TASK_MUTATION_KEYS.forBoard(boardId),
    meta: { op: "reorderTask", scope: { board: boardId } },
    mutationFn: (vars) => {
      const tasks = queryClient.getQueryData<Task[]>(key) ?? [];
      const siblings = orderedColumn(tasks, vars.column, vars.taskId);
      const prev = vars.toIndex > 0 ? siblings[vars.toIndex - 1] ?? null : null;
      const next = vars.toIndex < siblings.length ? siblings[vars.toIndex] ?? null : null;
      if (!hasRepresentableGap(prev?.position ?? null, next?.position ?? null)) {
        // Precision exhausted between these neighbours: renormalize the column,
        // then place the moved task at its target index in one write.
        const normalized = renormalize(siblings);
        const position = positionForMove(normalized, vars.toIndex);
        return reorderTask({ taskId: vars.taskId, position });
      }
      const position = positionForMove(siblings, vars.toIndex);
      return reorderTask({ taskId: vars.taskId, position });
    },
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Task[]>(key);
      const tasks = previous ?? [];
      const siblings = orderedColumn(tasks, vars.column, vars.taskId);
      const position = positionForMove(siblings, vars.toIndex);
      queryClient.setQueryData<Task[]>(key, (cur) =>
        (cur ?? []).map((t) => (t.id === vars.taskId ? { ...t, position } : t))
      );
      return { previous };
    },
    onError: (_e, _vars, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(key, ctx.previous);
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
}
```

- [ ] **Step 4: Run the reorder-hook test to green**

Run: `NODE_OPTIONS=--no-experimental-webstorage pnpm test -- src/features/tasks/hooks/__tests__/use-reorder-task.test.tsx`
Expected: PASS.

- [ ] **Step 5: Implement the sortable card and wire dnd-kit**

```tsx
// src/features/tasks/components/sortable-task-card.tsx
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Task } from "../types";
import { TaskCard } from "./task-card";

export function SortableTaskCard({ task, onOpen }: { task: Task; onOpen: (task: Task) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { column: task.column },
  });
  return (
    <div
      className={isDragging ? "opacity-50" : undefined}
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
    >
      <TaskCard onOpen={onOpen} task={task} />
    </div>
  );
}
```

In `task-column.tsx`, wrap the card list in a `SortableContext` and render `SortableTaskCard`:

```tsx
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useDroppable } from "@dnd-kit/core";
import { SortableTaskCard } from "./sortable-task-card";
// ...
// Inside the component, wrap the column body:
const { setNodeRef } = useDroppable({ id: `column:${columnId}`, data: { column: columnId } });
// ...
<div className="flex flex-col gap-2" ref={setNodeRef}>
  <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
    {tasks.length === 0 ? (
      <p className="px-1 py-6 text-center text-muted-foreground text-xs">{EMPTY_COLUMN_HINT}</p>
    ) : (
      tasks.map((task) => <SortableTaskCard key={task.id} onOpen={onOpen} task={task} />)
    )}
  </SortableContext>
</div>
```

In `board-surface.tsx`, wrap the columns in a `DndContext` with the three sensors and an `onDragEnd` that reorders within a column (cross-column drop is Task 9):

```tsx
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { useReorderTask } from "../hooks/use-reorder-task";
// ...
const reorderTask = useReorderTask(boardId);
const sensors = useSensors(
  useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
  useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
  useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
);

function onDragEnd(event: DragEndEvent): void {
  const { active, over } = event;
  if (!over || active.id === over.id) {
    return;
  }
  const activeColumn = active.data.current?.column as TaskColumnId | undefined;
  const overColumn = (over.data.current?.column ?? activeColumn) as TaskColumnId | undefined;
  if (!activeColumn || !overColumn || activeColumn !== overColumn) {
    return; // cross-column drag handled in Task 9
  }
  const columnTasks = tasksByColumn[activeColumn];
  const toIndex = columnTasks.findIndex((t) => t.id === over.id);
  if (toIndex === -1) {
    return;
  }
  reorderTask.mutate({ taskId: String(active.id), column: activeColumn, toIndex });
}
// Wrap the columns div:
<DndContext onDragEnd={onDragEnd} sensors={sensors}>
  {/* existing columns grid */}
</DndContext>
```

- [ ] **Step 6: Lint, typecheck, run the tasks suite, commit**

```bash
pnpm check
pnpm exec tsc -b
NODE_OPTIONS=--no-experimental-webstorage pnpm test -- src/features/tasks
git add src/features/tasks/
git commit -m "feat(tasks): drag-to-reorder within a column with split sensors"
```

---

## Task 9: Cross-column move (sheet control and desktop drag)

The detail-sheet column control already sets `column` on save via `updateTask`, but a column change must also reposition to the target column's bottom. Add `useMoveTask` and route both the sheet's column change and a desktop cross-column drop through it.

**Files:**
- Create: `src/features/tasks/hooks/use-move-task.ts`
- Modify: `src/features/tasks/components/task-detail-sheet.tsx` (on save, if the column changed, call `moveTask`)
- Modify: `src/features/tasks/components/board-surface.tsx` (`onDragEnd`: cross-column drop calls `moveTask`)
- Test: `src/features/tasks/hooks/__tests__/use-move-task.test.tsx`

**Interfaces:**
- Consumes: `moveTask`, `TASK_KEYS`, `TASK_MUTATION_KEYS`; `bottomPosition`.
- Produces: `useMoveTask(boardId)` with vars `{ taskId: string; toColumn: TaskColumnId }` (position computed to the target bottom).

- [ ] **Step 1: Write the failing move-hook test**

```tsx
// src/features/tasks/hooks/__tests__/use-move-task.test.tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TASK_KEYS } from "../../api/tasks";
import { POSITION_STEP } from "../../lib/position";
import type { Task } from "../../types";

vi.mock("../../api/tasks", async () => {
  const actual = await vi.importActual<typeof import("../../api/tasks")>("../../api/tasks");
  return { ...actual, moveTask: vi.fn() };
});
import { moveTask } from "../../api/tasks";
import { useMoveTask } from "../use-move-task";

function task(id: string, column: Task["column"], position: number): Task {
  return { id, boardId: "b", column, title: id, description: "", priority: "mittel",
    dueDate: null, position, assigneeIds: [], createdBy: null, createdAt: "", updatedAt: "" };
}
function wrapperFor(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}
afterEach(() => vi.clearAllMocks());

describe("useMoveTask", () => {
  it("moves to the bottom of the target column and updates the cache column", async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    client.setQueryData(TASK_KEYS.byBoard("b"), [
      task("x", "offen", 1024),
      task("y", "erledigt", 5000),
    ]);
    vi.mocked(moveTask).mockImplementation(async (i) => task("x", i.column, i.position));
    const { result } = renderHook(() => useMoveTask("b"), { wrapper: wrapperFor(client) });
    act(() => { result.current.mutate({ taskId: "x", toColumn: "erledigt" }); });
    await waitFor(() =>
      expect(moveTask).toHaveBeenCalledWith({ taskId: "x", column: "erledigt", position: 5000 + POSITION_STEP })
    );
    const cache = client.getQueryData<Task[]>(TASK_KEYS.byBoard("b"));
    expect(cache?.find((t) => t.id === "x")?.column).toBe("erledigt");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS=--no-experimental-webstorage pnpm test -- src/features/tasks/hooks/__tests__/use-move-task.test.tsx`
Expected: FAIL, "Cannot find module '../use-move-task'".

- [ ] **Step 3: Implement the move hook**

```ts
// src/features/tasks/hooks/use-move-task.ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { moveTask, TASK_KEYS, TASK_MUTATION_KEYS } from "../api/tasks";
import type { TaskColumnId } from "../columns";
import { bottomPosition } from "../lib/position";
import type { Task } from "../types";

export type MoveTaskVars = { taskId: string; toColumn: TaskColumnId };
type Ctx = { previous: Task[] | undefined };

export function useMoveTask(boardId: string) {
  const queryClient = useQueryClient();
  const key = TASK_KEYS.byBoard(boardId);

  function targetPosition(tasks: Task[], toColumn: TaskColumnId, taskId: string): number {
    const inColumn = tasks.filter((t) => t.column === toColumn && t.id !== taskId);
    return bottomPosition(inColumn);
  }

  return useMutation<Task, Error, MoveTaskVars, Ctx>({
    mutationKey: TASK_MUTATION_KEYS.forBoard(boardId),
    meta: { op: "moveTask", scope: { board: boardId } },
    mutationFn: (vars) => {
      const tasks = queryClient.getQueryData<Task[]>(key) ?? [];
      return moveTask({
        taskId: vars.taskId,
        column: vars.toColumn,
        position: targetPosition(tasks, vars.toColumn, vars.taskId),
      });
    },
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Task[]>(key);
      const tasks = previous ?? [];
      const position = targetPosition(tasks, vars.toColumn, vars.taskId);
      queryClient.setQueryData<Task[]>(key, (cur) =>
        (cur ?? []).map((t) => (t.id === vars.taskId ? { ...t, column: vars.toColumn, position } : t))
      );
      return { previous };
    },
    onError: (_e, _vars, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(key, ctx.previous);
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
}
```

- [ ] **Step 4: Route the sheet and desktop drag through moveTask**

In `task-detail-sheet.tsx`, add `const moveTask = useMoveTask(boardId);` and, in `save()` edit branch, after the `updateTask.mutateAsync`, move if the column changed:

```tsx
      } else {
        await updateTask.mutateAsync({
          taskId: mode.task.id, title: form.title.trim(), description: form.description,
          priority: form.priority, dueDate,
        });
        if (form.column !== mode.task.column) {
          await moveTask.mutateAsync({ taskId: mode.task.id, toColumn: form.column });
        }
      }
```

In `board-surface.tsx` `onDragEnd`, replace the `return; // cross-column drag handled in Task 9` branch with:

```tsx
  if (activeColumn !== overColumn) {
    moveTask.mutate({ taskId: String(active.id), toColumn: overColumn });
    return;
  }
```

and add `const moveTask = useMoveTask(boardId);`.

- [ ] **Step 5: Run tests, lint, typecheck, commit**

```bash
NODE_OPTIONS=--no-experimental-webstorage pnpm test -- src/features/tasks/hooks/__tests__/use-move-task.test.tsx
pnpm check
pnpm exec tsc -b
git add src/features/tasks/
git commit -m "feat(tasks): cross-column move via sheet control and desktop drag"
```

---

## Task 10: Assignees (Verantwortliche)

The `AssigneePicker` (checkbox list from `useBoardMembers`) inside the detail sheet, backed by `useSetAssignees` (edit mode only, since a task id is required).

**Files:**
- Create: `src/features/tasks/hooks/use-set-assignees.ts`
- Create: `src/features/tasks/components/assignee-picker.tsx`
- Modify: `src/features/tasks/components/task-detail-sheet.tsx` (render the picker in edit mode)
- Test: `src/features/tasks/hooks/__tests__/use-set-assignees.test.tsx`

**Interfaces:**
- Consumes: `setTaskAssignees`, `TASK_KEYS`, `TASK_MUTATION_KEYS`; `useBoardMembers`; `Checkbox`; `TASK_ASSIGNEES_LABEL`.
- Produces: `useSetAssignees(boardId)` with vars `{ taskId: string; userIds: string[] }`; `AssigneePicker`.

- [ ] **Step 1: Write the failing set-assignees test**

```tsx
// src/features/tasks/hooks/__tests__/use-set-assignees.test.tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TASK_KEYS } from "../../api/tasks";
import type { Task } from "../../types";

vi.mock("../../api/tasks", async () => {
  const actual = await vi.importActual<typeof import("../../api/tasks")>("../../api/tasks");
  return { ...actual, setTaskAssignees: vi.fn().mockResolvedValue(undefined) };
});
import { setTaskAssignees } from "../../api/tasks";
import { useSetAssignees } from "../use-set-assignees";

function task(id: string, assigneeIds: string[]): Task {
  return { id, boardId: "b", column: "offen", title: id, description: "", priority: "mittel",
    dueDate: null, position: 1024, assigneeIds, createdBy: null, createdAt: "", updatedAt: "" };
}
function wrapperFor(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}
afterEach(() => vi.clearAllMocks());

describe("useSetAssignees", () => {
  it("optimistically sets the assignee ids on the task", async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    client.setQueryData(TASK_KEYS.byBoard("b"), [task("t", [])]);
    const { result } = renderHook(() => useSetAssignees("b"), { wrapper: wrapperFor(client) });
    act(() => { result.current.mutate({ taskId: "t", userIds: ["u1", "u2"] }); });
    await waitFor(() => {
      const cache = client.getQueryData<Task[]>(TASK_KEYS.byBoard("b"));
      expect(cache?.find((t) => t.id === "t")?.assigneeIds).toEqual(["u1", "u2"]);
    });
    expect(setTaskAssignees).toHaveBeenCalledWith({ taskId: "t", userIds: ["u1", "u2"] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS=--no-experimental-webstorage pnpm test -- src/features/tasks/hooks/__tests__/use-set-assignees.test.tsx`
Expected: FAIL, "Cannot find module '../use-set-assignees'".

- [ ] **Step 3: Implement the hook and picker**

```ts
// src/features/tasks/hooks/use-set-assignees.ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { setTaskAssignees, TASK_KEYS, TASK_MUTATION_KEYS } from "../api/tasks";
import type { Task } from "../types";

export type SetAssigneesVars = { taskId: string; userIds: string[] };
type Ctx = { previous: Task[] | undefined };

export function useSetAssignees(boardId: string) {
  const queryClient = useQueryClient();
  const key = TASK_KEYS.byBoard(boardId);

  return useMutation<void, Error, SetAssigneesVars, Ctx>({
    mutationKey: TASK_MUTATION_KEYS.forBoard(boardId),
    meta: { op: "setTaskAssignees", scope: { board: boardId } },
    mutationFn: (vars) => setTaskAssignees(vars),
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Task[]>(key);
      queryClient.setQueryData<Task[]>(key, (cur) =>
        (cur ?? []).map((t) => (t.id === vars.taskId ? { ...t, assigneeIds: vars.userIds } : t))
      );
      return { previous };
    },
    onError: (_e, _vars, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(key, ctx.previous);
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
}
```

```tsx
// src/features/tasks/components/assignee-picker.tsx
import { useBoardMembers } from "@/features/members";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { TASK_ASSIGNEES_LABEL } from "../lib/copy";

export function AssigneePicker({
  boardId,
  value,
  onChange,
}: {
  boardId: string;
  value: string[];
  onChange: (userIds: string[]) => void;
}) {
  const { members, isPending } = useBoardMembers(boardId);

  function toggle(userId: string, checked: boolean): void {
    onChange(checked ? [...value, userId] : value.filter((id) => id !== userId));
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="font-medium text-sm">{TASK_ASSIGNEES_LABEL}</span>
      {isPending ? (
        <Skeleton className="h-9 w-full" />
      ) : (
        <ul className="flex flex-col gap-1">
          {members.map((member) => {
            const checked = value.includes(member.userId);
            return (
              <li className="flex items-center gap-3" key={member.userId}>
                <Checkbox
                  aria-label={member.displayName}
                  checked={checked}
                  onCheckedChange={(next: boolean) => toggle(member.userId, next)}
                />
                <span className="text-sm">{member.displayName}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Wire the picker into the sheet (edit mode)**

In `task-detail-sheet.tsx`, add assignee state seeded from the task, and render the picker where the Task 7 comment marks it. Because assignees write immediately (they need a task id), call `useSetAssignees` on change in edit mode:

```tsx
import { AssigneePicker } from "./assignee-picker";
import { useSetAssignees } from "../hooks/use-set-assignees";
// inside the component:
const setAssignees = useSetAssignees(boardId);
const [assigneeIds, setAssigneeIds] = useState<string[]>(
  mode.kind === "edit" ? mode.task.assigneeIds : []
);
// replace the AssigneePicker comment with:
{mode.kind === "edit" ? (
  <AssigneePicker
    boardId={boardId}
    onChange={(next) => {
      setAssigneeIds(next);
      setAssignees.mutate({ taskId: mode.task.id, userIds: next });
    }}
    value={assigneeIds}
  />
) : null}
```

- [ ] **Step 5: Run tests, lint, typecheck, commit**

```bash
NODE_OPTIONS=--no-experimental-webstorage pnpm test -- src/features/tasks/hooks/__tests__/use-set-assignees.test.tsx
pnpm check
pnpm exec tsc -b
git add src/features/tasks/
git commit -m "feat(tasks): assignee picker with optimistic set-assignees"
```

---

## Task 11: Board-level deferred delete plus Undo

Drag a card onto a red Löschen zone (shown during a drag) or use the sheet's Löschen button. Both route through a deferred-delete provider: optimistic removal, a ~5s Undo snackbar, real DELETE on snackbar dismiss.

**Files:**
- Create: `src/features/tasks/hooks/use-delete-task.ts`
- Create: `src/features/tasks/components/deferred-delete.tsx` (context provider + hook)
- Create: `src/features/tasks/components/delete-drop-zone.tsx`
- Modify: `src/features/tasks/components/board-surface.tsx` (provider, zone, drag-onto-zone in `onDragEnd`, filter `pendingDeleteIds`)
- Modify: `src/features/tasks/components/task-detail-sheet.tsx` (Löschen button in edit mode)
- Test: `src/features/tasks/components/__tests__/deferred-delete.test.tsx`

**Interfaces:**
- Consumes: `deleteTask`, `TASK_KEYS`, `TASK_MUTATION_KEYS`; `sonner` `toast`; `useDroppable`.
- Produces: `useDeleteTask(boardId)`; `DeferredDeleteProvider`, `useDeferredDelete()` returning `{ requestDelete(task), pendingDeleteIds }`; `DeleteDropZone`.

- [ ] **Step 1: Write the failing deferred-delete test (fake timers)**

```tsx
// src/features/tasks/components/__tests__/deferred-delete.test.tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Toaster } from "@/shared/components/ui/sonner";
import { TASK_DELETED_TOAST, UNDO_LABEL } from "../../lib/copy";
import type { Task } from "../../types";

vi.mock("../../api/tasks", async () => {
  const actual = await vi.importActual<typeof import("../../api/tasks")>("../../api/tasks");
  return { ...actual, deleteTask: vi.fn().mockResolvedValue(undefined) };
});
import { deleteTask } from "../../api/tasks";
import { DeferredDeleteProvider, useDeferredDelete } from "../deferred-delete";

const sample: Task = {
  id: "t", boardId: "b", column: "offen", title: "Weg", description: "", priority: "mittel",
  dueDate: null, position: 1024, assigneeIds: [], createdBy: null, createdAt: "", updatedAt: "" };

function Harness() {
  const { requestDelete } = useDeferredDelete();
  return <button onClick={() => requestDelete(sample)} type="button">go</button>;
}
function renderHarness() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <DeferredDeleteProvider boardId="b">{children}</DeferredDeleteProvider>
      <Toaster />
    </QueryClientProvider>
  );
  return render(<Harness />, { wrapper });
}

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => { vi.runOnlyPendingTimers(); vi.useRealTimers(); vi.clearAllMocks(); });

describe("deferred delete", () => {
  it("fires DELETE only after the undo window elapses", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderHarness();
    await user.click(screen.getByRole("button", { name: "go" }));
    expect(screen.getByText(TASK_DELETED_TOAST)).toBeInTheDocument();
    expect(deleteTask).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(5100); });
    expect(deleteTask).toHaveBeenCalledWith({ taskId: "t" });
  });

  it("does not fire DELETE when Undo is clicked in the window", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderHarness();
    await user.click(screen.getByRole("button", { name: "go" }));
    await user.click(screen.getByRole("button", { name: UNDO_LABEL }));
    act(() => { vi.advanceTimersByTime(5100); });
    expect(deleteTask).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS=--no-experimental-webstorage pnpm test -- src/features/tasks/components/__tests__/deferred-delete.test.tsx`
Expected: FAIL, "Cannot find module '../deferred-delete'".

- [ ] **Step 3: Implement the delete hook, provider, and zone**

```ts
// src/features/tasks/hooks/use-delete-task.ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { deleteTask, TASK_KEYS, TASK_MUTATION_KEYS } from "../api/tasks";
import type { Task } from "../types";

type Ctx = { previous: Task[] | undefined };

export function useDeleteTask(boardId: string) {
  const queryClient = useQueryClient();
  const key = TASK_KEYS.byBoard(boardId);

  return useMutation<void, Error, { taskId: string }, Ctx>({
    mutationKey: TASK_MUTATION_KEYS.forBoard(boardId),
    meta: { op: "deleteTask", scope: { board: boardId } },
    mutationFn: (vars) => deleteTask(vars),
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Task[]>(key);
      queryClient.setQueryData<Task[]>(key, (cur) =>
        (cur ?? []).filter((t) => t.id !== vars.taskId)
      );
      return { previous };
    },
    onError: (_e, _vars, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(key, ctx.previous);
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
}
```

```tsx
// src/features/tasks/components/deferred-delete.tsx
import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useDeleteTask } from "../hooks/use-delete-task";
import { TASK_DELETED_TOAST, UNDO_LABEL } from "../lib/copy";
import type { Task } from "../types";

const UNDO_WINDOW_MS = 5000;

type DeferredDeleteApi = {
  requestDelete: (task: Task) => void;
  pendingDeleteIds: ReadonlySet<string>;
};

const DeferredDeleteContext = createContext<DeferredDeleteApi | null>(null);

export function DeferredDeleteProvider({ boardId, children }: { boardId: string; children: ReactNode }) {
  const deleteTask = useDeleteTask(boardId);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const clear = useCallback((taskId: string) => {
    const timer = timers.current.get(taskId);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(taskId);
    }
  }, []);

  const drop = useCallback((taskId: string) => {
    setPending((cur) => {
      const next = new Set(cur);
      next.delete(taskId);
      return next;
    });
  }, []);

  const requestDelete = useCallback(
    (task: Task) => {
      setPending((cur) => new Set(cur).add(task.id));
      const timer = setTimeout(() => {
        timers.current.delete(task.id);
        deleteTask.mutate({ taskId: task.id }, { onSettled: () => drop(task.id) });
      }, UNDO_WINDOW_MS);
      timers.current.set(task.id, timer);
      toast(TASK_DELETED_TOAST, {
        duration: UNDO_WINDOW_MS,
        action: {
          label: UNDO_LABEL,
          onClick: () => {
            clear(task.id);
            drop(task.id);
          },
        },
      });
    },
    [deleteTask, drop, clear]
  );

  useEffect(() => {
    const active = timers.current;
    return () => {
      for (const timer of active.values()) {
        clearTimeout(timer);
      }
      active.clear();
    };
  }, []);

  return (
    <DeferredDeleteContext.Provider value={{ requestDelete, pendingDeleteIds: pending }}>
      {children}
    </DeferredDeleteContext.Provider>
  );
}

export function useDeferredDelete(): DeferredDeleteApi {
  const ctx = useContext(DeferredDeleteContext);
  if (!ctx) {
    throw new Error("useDeferredDelete must be used within DeferredDeleteProvider");
  }
  return ctx;
}
```

```tsx
// src/features/tasks/components/delete-drop-zone.tsx
import { useDroppable } from "@dnd-kit/core";
import { Trash2 } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { DELETE_ZONE_LABEL } from "../lib/copy";

export const DELETE_ZONE_ID = "delete-zone";

export function DeleteDropZone({ active }: { active: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: DELETE_ZONE_ID });
  if (!active) {
    return null;
  }
  return (
    <div
      aria-label={DELETE_ZONE_LABEL}
      className={cn(
        "sticky top-0 z-10 mb-2 flex items-center justify-center gap-2 rounded-lg border border-destructive border-dashed py-3 text-destructive text-sm transition-colors",
        isOver && "bg-destructive text-destructive-foreground"
      )}
      ref={setNodeRef}
    >
      <Trash2 className="size-4" />
      {DELETE_ZONE_LABEL}
    </div>
  );
}
```

- [ ] **Step 4: Wire the provider, zone, drag-onto-zone, and pending filter into `BoardSurface`**

In `board-surface.tsx`:
- Wrap the returned tree in `<DeferredDeleteProvider boardId={boardId}>`.
- Add `const [isDragging, setIsDragging] = useState(false);` and set it via `DndContext` `onDragStart` (`() => setIsDragging(true)`) and clear it at the end of `onDragEnd` and on `onDragCancel`.
- Render `<DeleteDropZone active={isDragging} />` just inside the `DndContext`, above the columns.
- In `onDragEnd`, before the reorder/move logic, handle the delete zone:

```tsx
  if (over?.id === DELETE_ZONE_ID) {
    const task = tasks.find((t) => t.id === active.id);
    if (task) {
      requestDelete(task);
    }
    return;
  }
```

- Read `const { requestDelete, pendingDeleteIds } = useDeferredDelete();` inside a child component, because the provider must wrap the consumer. Extract the columns + DndContext into an inner `BoardBoard` component rendered inside the provider, so `useDeferredDelete()` resolves. Filter the rendered tasks:

```tsx
const visibleByColumn = useMemo(() => {
  const filtered = tasks.filter((t) => !pendingDeleteIds.has(t.id));
  return groupByColumn(filtered);
}, [tasks, pendingDeleteIds]);
```

and render `visibleByColumn[column.id]` instead of `tasksByColumn[column.id]`.

- [ ] **Step 5: Add the Löschen button to the sheet (edit mode)**

In `task-detail-sheet.tsx`, in edit mode, add a destructive button that calls `useDeferredDelete().requestDelete(mode.task)` then `onOpenChange(false)`:

```tsx
import { useDeferredDelete } from "./deferred-delete";
import { DELETE_TASK_LABEL } from "../lib/copy";
// inside the component (edit mode only):
const deferredDelete = useDeferredDelete();
// after the Save button, edit mode only:
{mode.kind === "edit" ? (
  <Button
    onClick={() => { deferredDelete.requestDelete(mode.task); onOpenChange(false); }}
    type="button"
    variant="destructive"
  >
    {DELETE_TASK_LABEL}
  </Button>
) : null}
```

Because the sheet renders inside `BoardSurface`, which is inside the provider, `useDeferredDelete()` resolves. The delete-sheet test in Task 7 mounts the sheet without the provider; guard by only calling `useDeferredDelete` in edit mode is not enough (hooks run unconditionally). Instead, in the Task 7 detail-sheet test, wrap the render in `DeferredDeleteProvider`. Update that test's wrapper accordingly when this task lands.

- [ ] **Step 6: Run tests, lint, typecheck, commit**

```bash
NODE_OPTIONS=--no-experimental-webstorage pnpm test -- src/features/tasks
pnpm check
pnpm exec tsc -b
git add src/features/tasks/
git commit -m "feat(tasks): board-level deferred delete with undo snackbar and drop zone"
```

---

## Task 12: Board-first header restructure

Move rename, share, and delete/leave into a slim board-first header so the columns dominate, matching the approved layout.

**Files:**
- Modify: `src/features/boards/components/board-detail-page.tsx`
- Modify: `src/features/boards/lib/copy.ts` (add header labels if missing)
- Test: `src/features/boards/components/__tests__/board-detail-page.test.tsx` (create if absent)

**Interfaces:**
- Consumes: existing `useMyBoards`, `useRenameBoard`, `useDeleteBoard`, `useLeaveBoard`, `BoardSharePanel`, `ConfirmSheet`, `DropdownMenu`, `BoardSurface`.
- Produces: no new exports; a restructured page.

- [ ] **Step 1: Write the failing header test**

```tsx
// src/features/boards/components/__tests__/board-detail-page.test.tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../hooks/use-my-boards", () => ({
  useMyBoards: () => ({
    memberships: [{ board: { id: "b", name: "Team-Board", joinCode: "AB12CD34", createdBy: null, createdAt: "" }, role: "owner" }],
    isPending: false, isError: false, error: null,
  }),
}));
vi.mock("@/features/tasks", () => ({ BoardSurface: () => <div data-testid="board-surface" /> }));

import { BoardDetailPage } from "../board-detail-page";

function renderPage() {
  const client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<BoardDetailPage boardId="b" />, { wrapper });
}

describe("BoardDetailPage board-first header", () => {
  it("shows the board name and renders the board surface", () => {
    renderPage();
    expect(screen.getByRole("heading", { name: "Team-Board" })).toBeInTheDocument();
    expect(screen.getByTestId("board-surface")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS=--no-experimental-webstorage pnpm test -- src/features/boards/components/__tests__/board-detail-page.test.tsx`
Expected: FAIL (either the heading query or the surface testid), for the right reason once the header is restructured.

- [ ] **Step 3: Restructure the page**

Rework `BoardDetailPage`'s returned layout so the container is full-width (`max-w-5xl`), the header row holds the inline-editable name plus a Teilen button and a `⋯` `DropdownMenu` (Umbenennen; Löschen for owners or Verlassen for members), and `<BoardSurface boardId={board.id} />` fills the body. Reuse the existing `BoardHeading`, `BoardSharePanel` (opened from Teilen via a Drawer/Sheet or inline toggle), `DeleteBoardControl`, `LeaveBoardControl`. Keep the existing loading, error, and not-found branches. Do not change the board hooks.

Concretely, replace the final `return (...)` block's wrapper `className="mx-auto ... max-w-md ..."` with `max-w-5xl`, and place `BoardSurface` where the placeholder `Card` was. Route the destructive controls through the `⋯` menu instead of full-width buttons at the bottom.

- [ ] **Step 4: Run the test to green, lint, typecheck, commit**

```bash
NODE_OPTIONS=--no-experimental-webstorage pnpm test -- src/features/boards/components/__tests__/board-detail-page.test.tsx
pnpm check
pnpm exec tsc -b
git add src/features/boards/
git commit -m "feat(boards): board-first header for the Kanban surface"
```

---

## Task 13: Realtime invalidation

One channel per board on `tasks` and `task_assignees`; any change invalidates the board's task query.

**Files:**
- Create: `src/features/tasks/hooks/use-board-realtime.ts`
- Modify: `src/features/tasks/components/board-surface.tsx` (mount the hook)
- Test: none automated here (realtime is exercised in the Playwright two-context test, Task 15, per `testing.md`). Verify manually across two tabs.

**Interfaces:**
- Consumes: `supabase`; `TASK_KEYS`; `useQueryClient`.
- Produces: `useBoardRealtime(boardId)`.

- [ ] **Step 1: Implement the realtime hook**

```ts
// src/features/tasks/hooks/use-board-realtime.ts
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/shared/lib/supabase";
import { TASK_KEYS } from "../api/tasks";

export function useBoardRealtime(boardId: string): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!boardId) {
      return;
    }
    const invalidate = () =>
      queryClient.invalidateQueries({ queryKey: TASK_KEYS.byBoard(boardId) });
    const channel = supabase
      .channel(`board:${boardId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tasks", filter: `board_id=eq.${boardId}` },
        invalidate
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "task_assignees" },
        invalidate
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [boardId, queryClient]);
}
```

- [ ] **Step 2: Mount it in `BoardSurface`**

Add `useBoardRealtime(boardId);` near the top of `BoardSurface` (alongside `useBoardTasks`).

- [ ] **Step 3: Manual two-tab verification, typecheck, commit**

Run `pnpm dev:up` and `pnpm dev`; sign in as alice in one tab and bob in another on the shared board. Create/move/delete in one; confirm the other updates within a second. Then:

```bash
pnpm exec tsc -b
git add src/features/tasks/hooks/use-board-realtime.ts src/features/tasks/components/board-surface.tsx
git commit -m "feat(tasks): realtime invalidation for the board surface"
```

---

## Task 14: Offline resumable mutation defaults

Register the task mutation defaults so a write queued while offline replays with no React scope on restart.

**Files:**
- Create: `src/features/tasks/mutation-defaults.ts`
- Modify: `src/features/tasks/index.ts` (export `registerTaskMutationDefaults`)
- Modify: `src/app/main.tsx` (call it at the documented slot)
- Test: `src/features/tasks/mutation-defaults.test.ts`

**Interfaces:**
- Consumes: `QueryClient`; the `api/tasks` functions; `TASK_MUTATION_KEYS`.
- Produces: `registerTaskMutationDefaults(queryClient: QueryClient): void`.

Note: resumable mutations replay with a single `variables` argument and no cache access, so the default `mutationFn` must be self-contained. The interactive hooks compute positions from the cache and pass a fully-resolved `variables` object into `mutate`; the persisted variables therefore already carry the final `position`/`column`. To make the default `mutationFn` self-contained, the resumable path uses variables shaped exactly like the `api/` inputs. Add a discriminated `op` field to the persisted variables so one default can dispatch.

- [ ] **Step 1: Write the failing test**

```ts
// src/features/tasks/mutation-defaults.test.ts
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { TASK_MUTATION_KEYS } from "./api/tasks";
import { registerTaskMutationDefaults } from "./mutation-defaults";

describe("registerTaskMutationDefaults", () => {
  it("registers a resumable mutationFn for the task mutation key", () => {
    const client = new QueryClient();
    registerTaskMutationDefaults(client);
    const defaults = client.getMutationDefaults(TASK_MUTATION_KEYS.forBoard("b"));
    expect(typeof defaults.mutationFn).toBe("function");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS=--no-experimental-webstorage pnpm test -- src/features/tasks/mutation-defaults.test.ts`
Expected: FAIL, "Cannot find module './mutation-defaults'".

- [ ] **Step 3: Implement the defaults dispatcher**

This requires the interactive hooks to pass an `op`-tagged, fully-resolved variables object into `mutate`. Refactor each hook's `mutationFn` to accept the resolved shape (it already computes positions in `mutationFn`); move the computation into the caller is not required, but the persisted `variables` must be self-contained. The simplest correct approach: each hook's `mutate` receives its existing vars, and its `mutationFn` resolves positions from the cache. Since a resumed mutation cannot read a hydrated cache reliably at replay time, restrict durable replay to the writes whose server effect does not depend on live neighbours: `updateTask`, `deleteTask`, and `setTaskAssignees` (absolute writes). `createTask`, `moveTask`, and `reorderTask` carry a resolved numeric `position` in their variables at `mutate` time, so persist that resolved value. Implement the default dispatcher over a tagged union:

```ts
// src/features/tasks/mutation-defaults.ts
import type { QueryClient } from "@tanstack/react-query";
import {
  createTask,
  deleteTask,
  moveTask,
  reorderTask,
  setTaskAssignees,
  TASK_MUTATION_KEYS,
  updateTask,
} from "./api/tasks";
import type { TaskColumnId, TaskPriorityId } from "./columns";

export type ResumableTaskMutation =
  | { op: "create"; boardId: string; column: TaskColumnId; title: string; description: string; priority: TaskPriorityId; dueDate: string | null; position: number }
  | { op: "update"; taskId: string; title: string; description: string; priority: TaskPriorityId; dueDate: string | null }
  | { op: "move"; taskId: string; column: TaskColumnId; position: number }
  | { op: "reorder"; taskId: string; position: number }
  | { op: "delete"; taskId: string }
  | { op: "setAssignees"; taskId: string; userIds: string[] };

async function runResumableTaskMutation(vars: ResumableTaskMutation): Promise<unknown> {
  switch (vars.op) {
    case "create":
      return createTask(vars);
    case "update":
      return updateTask(vars);
    case "move":
      return moveTask(vars);
    case "reorder":
      return reorderTask(vars);
    case "delete":
      return deleteTask(vars);
    case "setAssignees":
      return setTaskAssignees(vars);
    default: {
      const never: never = vars;
      throw new Error(`Unknown task mutation: ${JSON.stringify(never)}`);
    }
  }
}

export function registerTaskMutationDefaults(queryClient: QueryClient): void {
  // The board id in the key does not change the function; the persisted
  // variables are self-contained. Register the default under the generic
  // ["tasks","mutate"] prefix so any board's paused mutation resolves it.
  queryClient.setMutationDefaults(["tasks", "mutate"], {
    mutationFn: (vars) => runResumableTaskMutation(vars as ResumableTaskMutation),
  });
  // Touch the key helper so its shape stays in sync with the persister allowlist.
  void TASK_MUTATION_KEYS;
}
```

This changes the hook contract: each interactive hook must call `mutate` with the `op`-tagged variables and set its `mutationFn` accordingly, so the paused shape matches. Update the six hooks to pass the tagged variables (their `onMutate` optimistic logic stays; only the variables shape and `mutationFn` call change). For example `use-reorder-task.ts` `mutationFn` becomes:

```ts
    mutationFn: (vars) => runResumableTaskMutation({ op: "reorder", taskId: vars.taskId, position: computedPosition }),
```

where `computedPosition` is resolved before the `reorderTask` call as it already is. Keep each hook's public `mutate(vars)` signature stable for its callers; convert to the tagged shape inside the hook. Re-run every hook test after this refactor; the assertions target the `api/` function calls, which are unchanged.

- [ ] **Step 4: Run the test to green**

Run: `NODE_OPTIONS=--no-experimental-webstorage pnpm test -- src/features/tasks/mutation-defaults.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire into `main.tsx`**

Add the export to `src/features/tasks/index.ts`:

```ts
export { registerTaskMutationDefaults } from "./mutation-defaults";
```

In `src/app/main.tsx`, replace the `NOTE:` comment block about the tasks slice with the real call, before the persister resumes:

```ts
import { registerTaskMutationDefaults } from "@/features/tasks";
// ...
registerTaskMutationDefaults(queryClient);
```

- [ ] **Step 6: Run the full tasks suite, lint, typecheck, commit**

```bash
NODE_OPTIONS=--no-experimental-webstorage pnpm test -- src/features/tasks
pnpm check
pnpm exec tsc -b
git add src/features/tasks/ src/app/main.tsx
git commit -m "feat(tasks): resumable offline mutation defaults"
```

---

## Task 15: Playwright acceptance journeys

End-to-end coverage against the sealed Dockerized stack: the core journeys plus realtime across two contexts.

**Files:**
- Create: `e2e/tasks.spec.ts`
- Reference: read `e2e/app-shell.spec.ts` for the sign-in helper, the seeded users, and the `data-testid` conventions.

**Interfaces:**
- Consumes: the running e2e stack (`pnpm e2e` boots it); seeded alice/bob on "Team-Board".
- Produces: acceptance coverage.

- [ ] **Step 1: Write the acceptance spec**

```ts
// e2e/tasks.spec.ts
import { expect, test } from "@playwright/test";
import { ADD_TASK_LABEL, SAVE_TASK_LABEL, TASK_TITLE_LABEL } from "../src/features/tasks/lib/copy";

// Reuse the project's sign-in helper from app-shell.spec.ts; import or inline it.
// The helper signs a seeded user in via the Mailpit OTP, then lands on the board.

test.describe("tasks board", () => {
  test("create, edit, move and delete a task", async ({ page }) => {
    // signInAsAlice(page); openTeamBoard(page);  // per app-shell helper
    await page.getByRole("button", { name: new RegExp(ADD_TASK_LABEL) }).first().click();
    await page.getByLabel(TASK_TITLE_LABEL).fill("E2E Aufgabe");
    await page.getByRole("button", { name: SAVE_TASK_LABEL }).click();
    await expect(page.getByText("E2E Aufgabe")).toBeVisible();

    await page.getByText("E2E Aufgabe").click();
    await page.getByLabel(TASK_TITLE_LABEL).fill("E2E Aufgabe bearbeitet");
    await page.getByRole("button", { name: SAVE_TASK_LABEL }).click();
    await expect(page.getByText("E2E Aufgabe bearbeitet")).toBeVisible();
  });

  test("realtime: a task created by alice appears for bob", async ({ browser }) => {
    const alice = await browser.newContext();
    const bob = await browser.newContext();
    const alicePage = await alice.newPage();
    const bobPage = await bob.newPage();
    // signInAsAlice(alicePage); signInAsBob(bobPage); open the shared board in both.
    // alice creates a task; assert it becomes visible on bobPage within the realtime window.
    await alice.close();
    await bob.close();
  });
});
```

Fill in the sign-in/open-board steps from the existing helper rather than duplicating them; the assertions above are the contract.

- [ ] **Step 2: Run the e2e suite**

Run: `pnpm e2e -- tasks.spec.ts`
Expected: PASS. If the realtime test is flaky on the sealed stack, gate it behind an explicit wait on the created card's text with a generous timeout rather than a fixed sleep.

- [ ] **Step 3: Commit**

```bash
git add e2e/tasks.spec.ts
git commit -m "test(tasks): playwright acceptance for create/edit/move/delete and realtime"
```

---

## Task 16: Documentation and rule updates

Record the resolved deviations and remove the stale placeholder note, per `.claude/rules/documentation.md`.

**Files:**
- Modify: `.claude/rules/dnd-kit.md`
- Modify: `CLAUDE.md` (drop the `TASKS_PLACEHOLDER` mention if present; confirm the stack description still holds)
- Modify: `docs/deployment.md` only if a command changed (it did not; likely no change)

**Interfaces:** none.

- [ ] **Step 1: Update `dnd-kit.md`**

Add a "Resolved deviation" note: the tasks board makes the whole card draggable (no grip handle) because the tap-versus-long-press split disambiguates open-detail from drag, and it uses split `MouseSensor` (distance 8) plus `TouchSensor` (delay 250) rather than a single `PointerSensor`, because a `PointerSensor` captures touch and its distance constraint would pre-empt the touch long-press. Keyboard sensor still required.

- [ ] **Step 2: Confirm `CLAUDE.md` accuracy**

Verify the Domain model and structure still match. The tasks slice now ships; if any line implied it was unbuilt, correct it. Keep under 200 lines.

- [ ] **Step 3: Lint and commit**

```bash
pnpm check
git add .claude/rules/dnd-kit.md CLAUDE.md
git commit -m "docs: record dnd-kit whole-card-drag deviation; tasks slice shipped"
```

---

## Final verification (run before handing back)

```bash
pnpm check
pnpm exec tsc -b
NODE_OPTIONS=--no-experimental-webstorage pnpm test
pnpm build
```

Expected: lint clean, types clean, all unit tests green, build succeeds. Then, with `pnpm dev:up` running, `pnpm exec vitest run --config vitest.integration.config.ts` for the RLS integration tests, and `pnpm e2e` for the acceptance journeys. Do not commit a final merge or push; hand back to the human for review per the standing instruction.
