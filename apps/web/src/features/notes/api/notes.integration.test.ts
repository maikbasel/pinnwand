import { afterAll, describe, expect, it } from "vitest";
import { createAuthUser, teardownPool, withRls } from "@/test/with-rls";

const NOT_A_BOARD_MEMBER = /not a board member/;

async function createBoard(ownerId: string, name: string): Promise<string> {
  return await withRls(ownerId, async (sql) => {
    const [row] = await sql<{ id: string }[]> /* sql */`
      select id from public.create_board(${name})
    `;
    return row?.id ?? "";
  });
}

async function insertNote(userId: string, boardId: string): Promise<string> {
  return await withRls(userId, async (sql) => {
    const [row] = await sql<{ id: string }[]> /* sql */`
      insert into public.notes (board_id, title, created_by)
      values (${boardId}, 'Notiz', ${userId})
      returning id
    `;
    return row?.id ?? "";
  });
}

afterAll(async () => {
  await teardownPool();
});

describe("notes RLS", () => {
  it("lets a member create, read and delete a note", async () => {
    const owner = await createAuthUser(`note-owner-${Date.now()}@test.local`);
    const boardId = await createBoard(owner, "Board");
    const noteId = await insertNote(owner, boardId);

    const rows = await withRls(owner, async (sql) => {
      return await sql<{ id: string }[]> /* sql */`
        select id from public.notes where board_id = ${boardId}
      `;
    });
    expect(rows).toHaveLength(1);

    await withRls(owner, async (sql) => {
      await sql /* sql */`delete from public.notes where id = ${noteId}`;
    });
  });

  it("hides a note from a non-member", async () => {
    const owner = await createAuthUser(`note-a-${Date.now()}@test.local`);
    const stranger = await createAuthUser(`note-b-${Date.now()}@test.local`);
    const boardId = await createBoard(owner, "Privat");
    await insertNote(owner, boardId);

    const rows = await withRls(stranger, async (sql) => {
      return await sql<{ id: string }[]> /* sql */`
        select id from public.notes where board_id = ${boardId}
      `;
    });
    expect(rows).toHaveLength(0);
  });

  it("rejects a non-member appending to the update log", async () => {
    const owner = await createAuthUser(`log-a-${Date.now()}@test.local`);
    const stranger = await createAuthUser(`log-b-${Date.now()}@test.local`);
    const boardId = await createBoard(owner, "Board");
    const noteId = await insertNote(owner, boardId);

    await expect(
      withRls(stranger, async (sql) => {
        await sql /* sql */`
          insert into public.note_updates (note_id, update_b64)
          values (${noteId}, 'AAA=')
        `;
      })
    ).rejects.toThrow();
  });

  it("denies clients UPDATE and DELETE on the append-only log", async () => {
    const owner = await createAuthUser(`log-c-${Date.now()}@test.local`);
    const boardId = await createBoard(owner, "Board");
    const noteId = await insertNote(owner, boardId);
    await withRls(owner, async (sql) => {
      await sql /* sql */`
        insert into public.note_updates (note_id, update_b64)
        values (${noteId}, 'AAA=')
      `;
    });

    const updated = await withRls(owner, async (sql) => {
      return await sql /* sql */`
        update public.note_updates set update_b64 = 'BBB=' where note_id = ${noteId}
      `;
    });
    expect(updated.count).toBe(0);

    const deleted = await withRls(owner, async (sql) => {
      return await sql /* sql */`
        delete from public.note_updates where note_id = ${noteId}
      `;
    });
    expect(deleted.count).toBe(0);
  });

  it("rejects compact_note from a non-member", async () => {
    const owner = await createAuthUser(`comp-a-${Date.now()}@test.local`);
    const stranger = await createAuthUser(`comp-b-${Date.now()}@test.local`);
    const boardId = await createBoard(owner, "Board");
    const noteId = await insertNote(owner, boardId);

    await expect(
      withRls(stranger, async (sql) => {
        await sql /* sql */`select public.compact_note(${noteId}, 'AAA=', 1)`;
      })
    ).rejects.toThrow(NOT_A_BOARD_MEMBER);
  });

  it("lets a member compact and drops the superseded rows", async () => {
    const owner = await createAuthUser(`comp-c-${Date.now()}@test.local`);
    const boardId = await createBoard(owner, "Board");
    const noteId = await insertNote(owner, boardId);

    const maxId = await withRls(owner, async (sql) => {
      await sql /* sql */`
        insert into public.note_updates (note_id, update_b64)
        values (${noteId}, 'AAA='), (${noteId}, 'BBB=')
      `;
      const [row] = await sql<{ max: string }[]> /* sql */`
        select max(id)::text as max from public.note_updates where note_id = ${noteId}
      `;
      return Number(row?.max ?? 0);
    });

    await withRls(owner, async (sql) => {
      await sql /* sql */`select public.compact_note(${noteId}, 'SNAP=', ${maxId})`;
    });

    const remaining = await withRls(owner, async (sql) => {
      return await sql<{ id: string }[]> /* sql */`
        select id from public.note_updates where note_id = ${noteId}
      `;
    });
    expect(remaining).toHaveLength(0);
  });

  it("never moves snapshot_up_to_id backward on a second, lagging compaction", async () => {
    const owner = await createAuthUser(`comp-d-${Date.now()}@test.local`);
    const boardId = await createBoard(owner, "Board");
    const noteId = await insertNote(owner, boardId);

    const maxId = await withRls(owner, async (sql) => {
      await sql /* sql */`
        insert into public.note_updates (note_id, update_b64)
        values (${noteId}, 'AAA='), (${noteId}, 'BBB=')
      `;
      const [row] = await sql<{ max: string }[]> /* sql */`
        select max(id)::text as max from public.note_updates where note_id = ${noteId}
      `;
      return Number(row?.max ?? 0);
    });

    await withRls(owner, async (sql) => {
      await sql /* sql */`select public.compact_note(${noteId}, 'SNAP=', ${maxId})`;
    });

    // A lagging concurrent compaction passes a lower up_to_id than what is
    // already stored. It must no-op rather than regress the pointer.
    await withRls(owner, async (sql) => {
      await sql /* sql */`select public.compact_note(${noteId}, 'STALE=', ${maxId - 1})`;
    });

    const note = await withRls(owner, async (sql) => {
      const [row] = await sql<
        { snapshot_up_to_id: string; snapshot_b64: string | null }[]
      > /* sql */`
        select snapshot_up_to_id::text, snapshot_b64
        from public.notes where id = ${noteId}
      `;
      return row;
    });
    expect(Number(note?.snapshot_up_to_id)).toBe(maxId);
    expect(note?.snapshot_b64).toBe("SNAP=");
  });
});
