import { afterAll, describe, expect, it } from "vitest";
import {
  asService,
  createAuthUser,
  teardownPool,
  withRls,
} from "@/test/with-rls";

// gen_join_code() emits 8 unambiguous upper-case/digit characters.
const JOIN_CODE_PATTERN = /^[A-Z2-9]{8}$/;
const OWNER_ONLY_PATTERN = /only the owner/i;

type BoardRow = {
  id: string;
  name: string;
  join_code: string;
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

async function joinBoard(userId: string, joinCode: string): Promise<void> {
  await withRls(userId, async (sql) => {
    await sql /* sql */`select public.join_board_by_code(${joinCode})`;
  });
}

async function fetchBoard(id: string): Promise<BoardRow | undefined> {
  const rows = await asService(
    (sql) =>
      sql<BoardRow[]> /* sql */`
        select id, name, join_code from public.boards where id = ${id}
      `
  );
  return rows[0];
}

afterAll(async () => {
  await teardownPool();
});

describe("boards_update RLS (rename)", () => {
  it("lets the owner rename their board", async () => {
    const owner = await createAuthUser(`rename-owner-${Date.now()}@test.local`);
    const { id } = await createBoard(owner, "Original Name");

    const updated = await withRls(
      owner,
      (sql) =>
        sql<
          { id: string }[]
        > /* sql */`update public.boards set name = ${"Renamed"} where id = ${id} returning id`
    );
    expect(updated).toHaveLength(1);

    const board = await fetchBoard(id);
    expect(board?.name).toBe("Renamed");
  });

  it("blocks a plain member from renaming the board (0 rows affected)", async () => {
    const owner = await createAuthUser(
      `rename-member-owner-${Date.now()}@test.local`
    );
    const member = await createAuthUser(
      `rename-member-${Date.now()}@test.local`
    );
    const { id, joinCode } = await createBoard(owner, "Team Board");
    await joinBoard(member, joinCode);

    const updated = await withRls(
      member,
      (sql) =>
        sql<
          { id: string }[]
        > /* sql */`update public.boards set name = ${"Hijacked"} where id = ${id} returning id`
    );
    expect(updated).toEqual([]);

    const board = await fetchBoard(id);
    expect(board?.name).toBe("Team Board");
  });

  it("blocks a non-member from renaming the board (0 rows affected)", async () => {
    const owner = await createAuthUser(
      `rename-outsider-owner-${Date.now()}@test.local`
    );
    const outsider = await createAuthUser(
      `rename-outsider-${Date.now()}@test.local`
    );
    const { id } = await createBoard(owner, "Private Board");

    const updated = await withRls(
      outsider,
      (sql) =>
        sql<
          { id: string }[]
        > /* sql */`update public.boards set name = ${"Hijacked"} where id = ${id} returning id`
    );
    expect(updated).toEqual([]);

    const board = await fetchBoard(id);
    expect(board?.name).toBe("Private Board");
  });
});

describe("boards_delete RLS", () => {
  it("lets the owner delete the board", async () => {
    const owner = await createAuthUser(`delete-owner-${Date.now()}@test.local`);
    const { id } = await createBoard(owner, "Doomed Board");

    const deleted = await withRls(
      owner,
      (sql) =>
        sql<
          { id: string }[]
        > /* sql */`delete from public.boards where id = ${id} returning id`
    );
    expect(deleted).toHaveLength(1);

    const board = await fetchBoard(id);
    expect(board).toBeUndefined();
  });

  it("blocks a member from deleting the board (0 rows affected)", async () => {
    const owner = await createAuthUser(
      `delete-member-owner-${Date.now()}@test.local`
    );
    const member = await createAuthUser(
      `delete-member-${Date.now()}@test.local`
    );
    const { id, joinCode } = await createBoard(owner, "Shared Board");
    await joinBoard(member, joinCode);

    const deleted = await withRls(
      member,
      (sql) =>
        sql<
          { id: string }[]
        > /* sql */`delete from public.boards where id = ${id} returning id`
    );
    expect(deleted).toEqual([]);

    const board = await fetchBoard(id);
    expect(board?.id).toBe(id);
  });
});

describe("regenerate_join_code RPC", () => {
  it("lets the owner rotate the code to a new value", async () => {
    const owner = await createAuthUser(`rotate-owner-${Date.now()}@test.local`);
    const { id, joinCode } = await createBoard(owner, "Rotating Board");

    const newCode = await withRls(owner, async (sql) => {
      const [row] = await sql<{ code: string }[]> /* sql */`
        select public.regenerate_join_code(${id}) as code
      `;
      return row?.code ?? "";
    });

    expect(newCode).toMatch(JOIN_CODE_PATTERN);
    expect(newCode).not.toBe(joinCode);

    const board = await fetchBoard(id);
    expect(board?.join_code).toBe(newCode);
  });

  it("rejects a non-owner member calling regenerate_join_code", async () => {
    const owner = await createAuthUser(
      `rotate-member-owner-${Date.now()}@test.local`
    );
    const member = await createAuthUser(
      `rotate-member-${Date.now()}@test.local`
    );
    const { id, joinCode } = await createBoard(owner, "Guarded Board");
    await joinBoard(member, joinCode);

    await expect(
      withRls(member, async (sql) => {
        await sql /* sql */`select public.regenerate_join_code(${id})`;
      })
    ).rejects.toThrowError(OWNER_ONLY_PATTERN);

    const board = await fetchBoard(id);
    expect(board?.join_code).toBe(joinCode);
  });
});

describe("board_members_delete RLS (leave / remove)", () => {
  it("lets a member remove their own membership row and lose board visibility", async () => {
    const owner = await createAuthUser(`leave-owner-${Date.now()}@test.local`);
    const member = await createAuthUser(
      `leave-member-${Date.now()}@test.local`
    );
    const { id, joinCode } = await createBoard(owner, "Leavable Board");
    await joinBoard(member, joinCode);

    const removed = await withRls(
      member,
      (sql) =>
        sql<{ user_id: string }[]> /* sql */`
          delete from public.board_members
          where board_id = ${id} and user_id = ${member}
          returning user_id
        `
    );
    expect(removed).toHaveLength(1);

    const afterLeave = await withRls(
      member,
      (sql) =>
        sql<
          { id: string }[]
        > /* sql */`select id from public.boards where id = ${id}`
    );
    expect(afterLeave).toEqual([]);
  });

  it("blocks a member from removing a different member's row (0 rows affected)", async () => {
    const owner = await createAuthUser(
      `remove-other-owner-${Date.now()}@test.local`
    );
    const memberA = await createAuthUser(
      `remove-other-a-${Date.now()}@test.local`
    );
    const memberB = await createAuthUser(
      `remove-other-b-${Date.now()}@test.local`
    );
    const { id, joinCode } = await createBoard(owner, "Multi Member Board");
    await joinBoard(memberA, joinCode);
    await joinBoard(memberB, joinCode);

    const removed = await withRls(
      memberA,
      (sql) =>
        sql<{ user_id: string }[]> /* sql */`
          delete from public.board_members
          where board_id = ${id} and user_id = ${memberB}
          returning user_id
        `
    );
    expect(removed).toEqual([]);

    const stillMember = await asService(
      (sql) =>
        sql<{ user_id: string }[]> /* sql */`
          select user_id from public.board_members
          where board_id = ${id} and user_id = ${memberB}
        `
    );
    expect(stillMember).toHaveLength(1);
  });

  it("lets the owner remove a member", async () => {
    const owner = await createAuthUser(
      `owner-removes-${Date.now()}@test.local`
    );
    const member = await createAuthUser(
      `owner-removes-member-${Date.now()}@test.local`
    );
    const { id, joinCode } = await createBoard(owner, "Owner Managed Board");
    await joinBoard(member, joinCode);

    const removed = await withRls(
      owner,
      (sql) =>
        sql<{ user_id: string }[]> /* sql */`
          delete from public.board_members
          where board_id = ${id} and user_id = ${member}
          returning user_id
        `
    );
    expect(removed).toHaveLength(1);

    const stillMember = await asService(
      (sql) =>
        sql<{ user_id: string }[]> /* sql */`
          select user_id from public.board_members
          where board_id = ${id} and user_id = ${member}
        `
    );
    expect(stillMember).toEqual([]);
  });
});
