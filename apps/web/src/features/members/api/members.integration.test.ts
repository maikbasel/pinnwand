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

afterAll(async () => {
  await teardownPool();
});

describe("board member roster RLS", () => {
  it("lets a member read the roster joined to profile display names", async () => {
    const owner = await createAuthUser(`roster-owner-${Date.now()}@test.local`);
    const member = await createAuthUser(
      `roster-member-${Date.now()}@test.local`
    );
    const { id: boardId, joinCode } = await createBoard(owner, "Roster Board");
    await joinBoard(member, joinCode);

    const rows = await withRls(
      owner,
      (sql) =>
        sql<
          { user_id: string; role: string; display_name: string }[]
        > /* sql */`
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
    const owner = await createAuthUser(
      `roster-out-owner-${Date.now()}@test.local`
    );
    const outsider = await createAuthUser(
      `roster-outsider-${Date.now()}@test.local`
    );
    const { id: boardId } = await createBoard(owner, "Closed Roster");

    const rows = await withRls(
      outsider,
      (sql) =>
        sql<
          { user_id: string }[]
        > /* sql */`select user_id from public.board_members where board_id = ${boardId}`
    );
    expect(rows).toEqual([]);
  });
});
