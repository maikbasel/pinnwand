import { afterAll, describe, expect, it } from "vitest";
import {
  asService,
  createAuthUser,
  teardownPool,
  withRls,
} from "@/test/with-rls";

const AUTH_REQUIRED_PATTERN = /not authenticated/i;
const NAME_CHECK_PATTERN = /boards_name_check|check constraint/i;
const INVALID_CODE_PATTERN = /invalid join code/i;
// gen_join_code() emits 8 unambiguous upper-case/digit characters.
const JOIN_CODE_PATTERN = /^[A-Z2-9]{8}$/;

type BoardRow = {
  id: string;
  name: string;
  join_code: string;
  created_by: string | null;
};

type MembershipRow = {
  board_id: string;
  user_id: string;
  role: string;
};

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

afterAll(async () => {
  await teardownPool();
});

describe("create_board RPC", () => {
  it("inserts a board with a join code + owner membership in one transaction", async () => {
    const owner = await createAuthUser(`board-owner-${Date.now()}@test.local`);

    const { id, joinCode } = await createBoard(owner, "Team-Board");
    expect(id).not.toBe("");
    expect(joinCode).toMatch(JOIN_CODE_PATTERN);

    const boards = await asService(
      (sql) =>
        sql<BoardRow[]> /* sql */`
        select id, name, join_code, created_by
        from public.boards where id = ${id}
      `
    );
    expect(boards[0]).toMatchObject({
      id,
      name: "Team-Board",
      created_by: owner,
    });

    const memberships = await asService(
      (sql) =>
        sql<MembershipRow[]> /* sql */`
        select board_id, user_id, role
        from public.board_members where board_id = ${id}
      `
    );
    expect(memberships).toHaveLength(1);
    expect(memberships[0]).toMatchObject({
      board_id: id,
      user_id: owner,
      role: "owner",
    });
  });

  it("rejects empty names via the boards check constraint", async () => {
    const owner = await createAuthUser(`board-empty-${Date.now()}@test.local`);
    await expect(createBoard(owner, "")).rejects.toThrowError(
      NAME_CHECK_PATTERN
    );
  });

  it("rejects anonymous callers", async () => {
    // No `set_config('request.jwt.claim.sub', …)`, so auth.uid() is null for
    // the unauthenticated `anon` role and the function raises before inserting.
    await expect(
      asService(async (sql) => {
        await sql.unsafe("set local role anon");
        await sql /* sql */`select public.create_board(${"Wont Happen"})`;
      })
    ).rejects.toThrowError(AUTH_REQUIRED_PATTERN);
  });

  it("hides the new board from non-members via boards RLS", async () => {
    const owner = await createAuthUser(`board-iso-o-${Date.now()}@test.local`);
    const outsider = await createAuthUser(
      `board-iso-x-${Date.now()}@test.local`
    );

    const { id } = await createBoard(owner, "Private Board");

    const outsiderRows = await withRls(
      outsider,
      (sql) =>
        sql<
          { id: string }[]
        > /* sql */`select id from public.boards where id = ${id}`
    );
    expect(outsiderRows).toEqual([]);
  });
});

describe("join_board_by_code RPC", () => {
  it("adds the caller as a member and reveals the board", async () => {
    const owner = await createAuthUser(`join-owner-${Date.now()}@test.local`);
    const joiner = await createAuthUser(`join-member-${Date.now()}@test.local`);

    const { id, joinCode } = await createBoard(owner, "Shared Board");

    // Before joining, RLS hides the board from the joiner.
    const beforeRows = await withRls(
      joiner,
      (sql) =>
        sql<
          { id: string }[]
        > /* sql */`select id from public.boards where id = ${id}`
    );
    expect(beforeRows).toEqual([]);

    await withRls(joiner, async (sql) => {
      await sql /* sql */`select public.join_board_by_code(${joinCode})`;
    });

    const memberships = await asService(
      (sql) =>
        sql<MembershipRow[]> /* sql */`
        select board_id, user_id, role
        from public.board_members
        where board_id = ${id} and user_id = ${joiner}
      `
    );
    expect(memberships).toHaveLength(1);
    expect(memberships[0]?.role).toBe("member");

    // After joining, RLS now reveals the board to the new member.
    const afterRows = await withRls(
      joiner,
      (sql) =>
        sql<
          { id: string }[]
        > /* sql */`select id from public.boards where id = ${id}`
    );
    expect(afterRows).toEqual([{ id }]);
  });

  it("rejects an unknown join code", async () => {
    const joiner = await createAuthUser(`join-bad-${Date.now()}@test.local`);
    await expect(
      withRls(joiner, async (sql) => {
        await sql /* sql */`select public.join_board_by_code(${"ZZZZZZZZ"})`;
      })
    ).rejects.toThrowError(INVALID_CODE_PATTERN);
  });
});
