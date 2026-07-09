import { afterAll, describe, expect, it } from "vitest";
import { createAuthUser, teardownPool, withRls } from "@/test/with-rls";

async function createBoard(
  ownerId: string,
  name: string
): Promise<{ id: string; joinCode: string }> {
  return await withRls(ownerId, async (sql) => {
    const [row] = await sql<{ id: string; join_code: string }[]> /* sql */`
      select id, join_code from public.create_board(${name})
    `;
    return { id: row?.id ?? "", joinCode: row?.join_code ?? "" };
  });
}

async function joinBoard(userId: string, joinCode: string): Promise<void> {
  await withRls(userId, async (sql) => {
    await sql /* sql */`select public.join_board_by_code(${joinCode})`;
  });
}

async function insertTask(
  userId: string,
  boardId: string,
  creatorId: string
): Promise<string> {
  return await withRls(userId, async (sql) => {
    const [row] = await sql<{ id: string }[]> /* sql */`
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

    const listed = await withRls(
      owner,
      (sql) =>
        sql<
          { id: string }[]
        > /* sql */`select id from public.tasks where board_id = ${boardId}`
    );
    expect(listed.map((t) => t.id)).toContain(taskId);

    const moved = await withRls(
      owner,
      (sql) =>
        sql<{ id: string }[]> /* sql */`
        update public.tasks set "column" = 'erledigt', position = 2048 where id = ${taskId} returning id
      `
    );
    expect(moved).toHaveLength(1);

    const deleted = await withRls(
      owner,
      (sql) =>
        sql<
          { id: string }[]
        > /* sql */`delete from public.tasks where id = ${taskId} returning id`
    );
    expect(deleted).toHaveLength(1);
  });

  it("lets a joined member be assigned as Verantwortliche and see the assignment", async () => {
    const owner = await createAuthUser(`assign-owner-${Date.now()}@test.local`);
    const member = await createAuthUser(
      `assign-member-${Date.now()}@test.local`
    );
    const { id: boardId, joinCode } = await createBoard(owner, "Shared");
    await joinBoard(member, joinCode);

    const taskId = await insertTask(owner, boardId, owner);
    const assigned = await withRls(
      owner,
      (sql) =>
        sql<{ user_id: string }[]> /* sql */`
        insert into public.task_assignees (task_id, user_id) values (${taskId}, ${member}) returning user_id
      `
    );
    expect(assigned).toHaveLength(1);

    const seenByMember = await withRls(
      member,
      (sql) =>
        sql<{ user_id: string }[]> /* sql */`
        select user_id from public.task_assignees where task_id = ${taskId}
      `
    );
    expect(seenByMember.map((a) => a.user_id)).toContain(member);
  });

  it("denies a non-member reading another board's tasks (0 rows via RLS)", async () => {
    const owner = await createAuthUser(`rls-owner-${Date.now()}@test.local`);
    const outsider = await createAuthUser(
      `rls-outsider-${Date.now()}@test.local`
    );
    const { id: boardId } = await createBoard(owner, "Private");
    await insertTask(owner, boardId, owner);

    const seen = await withRls(
      outsider,
      (sql) =>
        sql<
          { id: string }[]
        > /* sql */`select id from public.tasks where board_id = ${boardId}`
    );
    expect(seen).toEqual([]);
  });

  it("blocks a non-member from inserting a task into a board (RLS violation)", async () => {
    const owner = await createAuthUser(`ins-owner-${Date.now()}@test.local`);
    const outsider = await createAuthUser(
      `ins-outsider-${Date.now()}@test.local`
    );
    const { id: boardId } = await createBoard(owner, "Locked");

    await expect(insertTask(outsider, boardId, outsider)).rejects.toThrow();
  });
});
