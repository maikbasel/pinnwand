# Notizen Collaborative Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Board-scoped collaborative notes with a rich-text editor, real-time sync via a Yjs CRDT, live carets, and offline-first writes that merge on reconnect.

**Architecture:** A Yjs `Y.Doc` per note. Document updates are appended as base64 rows to `public.note_updates`, which serves as both the durable store and the sync transport via `postgres_changes`. Cursor positions travel on a separate ephemeral binary broadcast channel carrying the `y-protocols` awareness protocol. RLS routes through the existing `is_board_member` helper, so no new authorization boundary is introduced.

**Tech Stack:** Tiptap 3 (ProseMirror) + StarterKit + TaskList, Yjs, y-protocols, y-indexeddb, `@tiptap/y-tiptap`, TanStack Query, Supabase Realtime, Postgres RLS.

**Spec:** `docs/superpowers/specs/2026-07-19-notes-markdown-editor-design.md`

## Global Constraints

- Node 22, pnpm 10.18. Monorepo: web app in `apps/web`, contracts in `packages/contracts`.
- Strict TypeScript. No `any`, no `as unknown as X`. `verbatimModuleSyntax` and `exactOptionalPropertyTypes` are on, so use `import type`.
- Never hand-edit `packages/contracts/src/database.ts` or `apps/web/src/app/routeTree.gen.ts`. Regenerate with `pnpm db:types`.
- Migrations are append-only. Never edit an applied migration. Create with `pnpm db:migration:new <name>`.
- Every `create table` enables RLS and adds policies in the same migration.
- Layer boundaries: `components/` imports `hooks/`, never `api/` or `@supabase/*`. `api/` imports `shared/lib/supabase.ts`, never React.
- `zod` validation at every API boundary. Generated types are not trust.
- All user-facing copy is German. Notes are "Notizen".
- No `console.log`, no TODO comments, no swallowed exceptions in shipped code.
- Optimistic updates with rollback on every mutation.
- Realtime invalidates queries. Never merge `postgres_changes` payloads into the cache by hand.
- Prose in comments and docs avoids em dashes.
- Local backend is docker-compose (`pnpm dev:up`), never `supabase start`.
- Existing SQL helpers to reuse: `public.is_board_member(uuid)`, `public.touch_updated_at()`.
- Realtime tenant limits stay at defaults. Do not raise them for this feature.

---

## File Structure

**Created:**

| Path | Responsibility |
| --- | --- |
| `supabase/migrations/<ts>_notes.sql` | Tables, RLS, `compact_note`, realtime publication |
| `apps/web/src/features/notes/types.ts` | `Note` domain type |
| `apps/web/src/features/notes/lib/bytes.ts` | base64 and exact-`ArrayBuffer` conversion |
| `apps/web/src/features/notes/lib/bytes.test.ts` | Unit tests for the above |
| `apps/web/src/features/notes/api/notes.ts` | Supabase calls, zod boundaries, query keys |
| `apps/web/src/features/notes/api/notes.integration.test.ts` | RLS by impersonation |
| `apps/web/src/features/notes/lib/note-doc.ts` | `Y.Doc` lifecycle, log apply, resync, compaction |
| `apps/web/src/features/notes/lib/note-doc.test.ts` | Convergence property test and resync tests |
| `apps/web/src/features/notes/lib/awareness-channel.ts` | Broadcast transport for awareness |
| `apps/web/src/features/notes/lib/awareness-channel.test.ts` | Outbound filter, throttle, removals |
| `apps/web/src/features/notes/lib/title.ts` | Derive note title from the document |
| `apps/web/src/features/notes/lib/title.test.ts` | Title derivation cases |
| `apps/web/src/features/notes/mutation-defaults.ts` | Resumable offline mutation registration |
| `apps/web/src/features/notes/hooks/use-board-notes.ts` | Notes list query |
| `apps/web/src/features/notes/hooks/use-create-note.ts` | Create mutation |
| `apps/web/src/features/notes/hooks/use-delete-note.ts` | Delete mutation |
| `apps/web/src/features/notes/hooks/use-notes-realtime.ts` | Invalidate the list on remote writes |
| `apps/web/src/features/notes/hooks/use-note-doc.ts` | Binds `note-doc` + awareness to React |
| `apps/web/src/features/notes/components/notes-list.tsx` | List UI |
| `apps/web/src/features/notes/components/note-editor.tsx` | Tiptap editor |
| `apps/web/src/features/notes/components/format-bar.tsx` | Docked formatting bar |
| `apps/web/src/features/notes/index.ts` | Public surface |
| `apps/web/e2e/notes.spec.ts` | E2E journeys |

**Modified:**

| Path | Change |
| --- | --- |
| `apps/web/package.json` | Add Tiptap, Yjs, y-protocols, y-indexeddb |
| `apps/web/src/shared/lib/query-client.ts` | Add `notes` to both offline allowlists |
| `apps/web/src/app/main.tsx` | Register notes mutation defaults |
| `apps/web/src/app/routes/_authed.boards.$boardId.tsx` | Board / Notizen tab |
| `packages/contracts/src/database.ts` | Regenerated, never hand-edited |

---

## Task 1: Migration, RLS, and compaction

**Files:**
- Create: `supabase/migrations/<timestamp>_notes.sql` (timestamp assigned by the CLI)
- Modify: `packages/contracts/src/database.ts` (regenerated only)

**Interfaces:**
- Consumes: `public.is_board_member(uuid)`, `public.touch_updated_at()` from `20260706120000_init.sql`
- Produces: tables `public.notes`, `public.note_updates`; function `public.compact_note(uuid, text, bigint)`

- [ ] **Step 1: Create the migration file**

```bash
cd /home/maikb/IdeaProjects/pinnwand
pnpm db:migration:new notes
```

Expected: prints the created path under `supabase/migrations/`. Note the filename; the CLI assigns the timestamp prefix and it must not be renamed.

- [ ] **Step 2: Write the migration**

Write this into the file created in Step 1:

```sql
-- ── Notes: board-scoped collaborative documents ──────────────────────────────
create table public.notes (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null,
  title text not null default '',
  snapshot_b64 text,
  snapshot_up_to_id bigint not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fk_notes_board foreign key (board_id)
    references public.boards (id) on delete cascade,
  constraint fk_notes_created_by foreign key (created_by)
    references public.profiles (id) on delete set null
);

create index notes_board_idx on public.notes (board_id, updated_at desc);

-- Append-only log of Yjs document updates. This table is both the durable
-- store and the sync transport: clients subscribe to inserts via
-- postgres_changes rather than using a separate broadcast path.
create table public.note_updates (
  id bigserial primary key,
  note_id uuid not null,
  update_b64 text not null,
  created_at timestamptz not null default now(),
  constraint fk_note_updates_note foreign key (note_id)
    references public.notes (id) on delete cascade
);

create index note_updates_note_idx on public.note_updates (note_id, id);

alter table public.notes enable row level security;
alter table public.note_updates enable row level security;

create policy notes_select on public.notes for select
using (public.is_board_member(board_id));

create policy notes_insert on public.notes for insert
with check (public.is_board_member(board_id) and created_by = auth.uid());

create policy notes_update on public.notes for update
using (public.is_board_member(board_id))
with check (public.is_board_member(board_id));

create policy notes_delete on public.notes for delete
using (public.is_board_member(board_id));

-- note_updates gets SELECT and INSERT only. The log is append-only to clients
-- by construction, not by convention. Deletion happens solely through
-- compact_note below, which is SECURITY DEFINER.
create policy note_updates_select on public.note_updates for select
using (exists (
  select 1 from public.notes n
  where n.id = note_updates.note_id and public.is_board_member(n.board_id)
));

create policy note_updates_insert on public.note_updates for insert
with check (exists (
  select 1 from public.notes n
  where n.id = note_updates.note_id and public.is_board_member(n.board_id)
));

create trigger notes_touch_updated_at
before update on public.notes
for each row execute function public.touch_updated_at();

-- Folds the log into a snapshot and drops the superseded rows. SECURITY
-- DEFINER because clients deliberately have no delete policy on note_updates.
-- Re-checks membership so the definer rights cannot be borrowed by a
-- non-member.
create or replace function public.compact_note(
  p_note_id uuid,
  p_snapshot_b64 text,
  p_up_to_id bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_board uuid;
begin
  select board_id into v_board from public.notes where id = p_note_id;
  if v_board is null then
    raise exception 'note not found';
  end if;
  if not public.is_board_member(v_board) then
    raise exception 'not a board member';
  end if;

  update public.notes
  set snapshot_b64 = p_snapshot_b64,
      snapshot_up_to_id = p_up_to_id
  where id = p_note_id;

  delete from public.note_updates
  where note_id = p_note_id and id <= p_up_to_id;
end;
$$;

-- Realtime: clients subscribe to INSERT events filtered on note_id. Default
-- replica identity is correct here. INSERT WAL records always carry the full
-- new tuple so the filter matches, and compaction DELETEs are intentionally
-- ignored by clients. Setting replica identity full would double every WAL
-- record for no benefit.
alter publication supabase_realtime add table public.note_updates;
```

- [ ] **Step 3: Apply from an empty database**

```bash
pnpm dev:up
pnpm db:reset
```

Expected: every migration re-applies in order with no error. This is the authoritative check that the sequence is self-consistent, not just that it works from current state.

- [ ] **Step 4: Regenerate types**

```bash
pnpm db:types
```

Expected: `packages/contracts/src/database.ts` gains `notes` and `note_updates` entries plus a `compact_note` function signature.

- [ ] **Step 5: Verify the publication took effect**

```bash
pnpm dev:psql -c "select tablename from pg_publication_tables where pubname='supabase_realtime' and tablename in ('tasks','note_updates');"
```

Expected: both `tasks` and `note_updates` listed. If `note_updates` is missing, `postgres_changes` will never fire and the subscription is silently dead.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations packages/contracts/src/database.ts
git commit -m "feat(notes): add notes and note_updates tables with RLS and compaction"
```

---

## Task 2: Byte conversion helpers

**Files:**
- Create: `apps/web/src/features/notes/lib/bytes.ts`
- Test: `apps/web/src/features/notes/lib/bytes.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `toBase64(bytes: Uint8Array): string`, `fromBase64(value: string): Uint8Array`, `toExactArrayBuffer(bytes: Uint8Array): ArrayBuffer`

`toExactArrayBuffer` exists because supabase-js's socket serializer checks `instanceof ArrayBuffer` and does **not** check `ArrayBuffer.isView`. Passing a `Uint8Array` silently falls through to `JSON.stringify`. lib0's encoder also over-allocates, so the raw `.buffer` carries trailing garbage past `byteLength`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/features/notes/lib/bytes.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { fromBase64, toBase64, toExactArrayBuffer } from "./bytes";

describe("bytes", () => {
  it("round-trips a byte array through base64", () => {
    const input = new Uint8Array([0, 1, 127, 128, 255, 42]);
    expect(fromBase64(toBase64(input))).toEqual(input);
  });

  it("round-trips a large array without blowing the call stack", () => {
    const input = new Uint8Array(200_000).map((_, i) => i % 256);
    expect(fromBase64(toBase64(input))).toEqual(input);
  });

  it("produces an ArrayBuffer of exactly byteLength", () => {
    // Mimic lib0's over-allocation: a view onto a larger buffer.
    const backing = new ArrayBuffer(64);
    const view = new Uint8Array(backing, 8, 4);
    view.set([1, 2, 3, 4]);
    const exact = toExactArrayBuffer(view);
    expect(exact.byteLength).toBe(4);
    expect(new Uint8Array(exact)).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it("returns a real ArrayBuffer, not a view", () => {
    const view = new Uint8Array([9, 9]);
    expect(toExactArrayBuffer(view) instanceof ArrayBuffer).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/web && pnpm vitest run src/features/notes/lib/bytes.test.ts
```

Expected: FAIL, cannot resolve `./bytes`.

- [ ] **Step 3: Write the implementation**

Create `apps/web/src/features/notes/lib/bytes.ts`:

```ts
// Chunked so a large update cannot exceed the argument limit of
// String.fromCharCode when spread.
const CHUNK = 0x8000;

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Copies a view into a standalone ArrayBuffer sized exactly to its contents.
 *
 * Two reasons this is not optional. supabase-js's socket serializer tests
 * `instanceof ArrayBuffer` and does not test `ArrayBuffer.isView`, so handing
 * it a Uint8Array falls through to JSON.stringify and inflates the payload
 * roughly fivefold in a shape the receiver cannot decode. And lib0's encoder
 * allocates in chunks, so `.buffer` is usually larger than `.byteLength` and
 * would carry trailing garbage that applyAwarenessUpdate tries to parse.
 */
export function toExactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(out).set(bytes);
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd apps/web && pnpm vitest run src/features/notes/lib/bytes.test.ts
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/notes/lib/bytes.ts apps/web/src/features/notes/lib/bytes.test.ts
git commit -m "feat(notes): add base64 and exact ArrayBuffer helpers"
```

---

## Task 3: Notes API layer

**Files:**
- Create: `apps/web/src/features/notes/types.ts`
- Create: `apps/web/src/features/notes/api/notes.ts`
- Test: `apps/web/src/features/notes/api/notes.integration.test.ts`

**Interfaces:**
- Consumes: `supabase` from `@/shared/lib/supabase`, `toBase64`/`fromBase64` from `../lib/bytes`
- Produces:
  - `type Note = { id, boardId, title, snapshotB64, snapshotUpToId, createdBy, createdAt, updatedAt }`
  - `NOTE_KEYS.byBoard(boardId)`, `NOTE_KEYS.doc(noteId)`
  - `NOTE_MUTATION_KEYS.root`, `NOTE_MUTATION_KEYS.forBoard(boardId)`
  - `listBoardNotes(boardId): Promise<Note[]>`
  - `createNote(input: { boardId: string; title: string }): Promise<Note>`
  - `deleteNote(noteId: string): Promise<void>`
  - `setNoteTitle(input: { noteId: string; title: string }): Promise<void>`
  - `getNote(noteId: string): Promise<Note>`
  - `listNoteUpdates(input: { noteId: string; afterId: number }): Promise<NoteUpdate[]>`
  - `appendNoteUpdate(input: { noteId: string; update: Uint8Array }): Promise<void>`
  - `compactNote(input: { noteId: string; snapshot: Uint8Array; upToId: number }): Promise<void>`
  - `type NoteUpdate = { id: number; update: Uint8Array }`

- [ ] **Step 1: Write the domain type**

Create `apps/web/src/features/notes/types.ts`:

```ts
export type Note = {
  id: string;
  boardId: string;
  title: string;
  snapshotB64: string | null;
  snapshotUpToId: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type NoteUpdate = {
  id: number;
  update: Uint8Array;
};
```

- [ ] **Step 2: Write the failing integration test**

Create `apps/web/src/features/notes/api/notes.integration.test.ts`:

```ts
import { afterAll, describe, expect, it } from "vitest";
import { createAuthUser, teardownPool, withRls } from "@/test/with-rls";

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
    ).rejects.toThrow(/not a board member/);
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
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd apps/web && pnpm test:integration -- src/features/notes/api/notes.integration.test.ts
```

Expected: FAIL. If the migration from Task 1 is applied, the failures will be assertion failures rather than missing-relation errors. Either is acceptable at this step; the point is that the suite runs and does not pass.

- [ ] **Step 4: Write the API module**

Create `apps/web/src/features/notes/api/notes.ts`:

```ts
import { z } from "zod";
import { supabase } from "@/shared/lib/supabase";
import { fromBase64, toBase64 } from "../lib/bytes";
import type { Note, NoteUpdate } from "../types";

export const NOTE_KEYS = {
  all: ["notes"] as const,
  byBoard: (boardId: string) => ["notes", "byBoard", boardId] as const,
  doc: (noteId: string) => ["notes", "doc", noteId] as const,
};

export const NOTE_MUTATION_KEYS = {
  // The generic prefix the offline resumable defaults register under; a paused
  // write's per-board key prefix-matches it on replay.
  root: ["notes", "mutate"] as const,
  forBoard: (boardId: string) => ["notes", "mutate", boardId] as const,
};

export const NOTE_TITLE_MAX = 200;

const NoteRowSchema = z.object({
  id: z.uuid(),
  board_id: z.uuid(),
  title: z.string(),
  snapshot_b64: z.string().nullable(),
  snapshot_up_to_id: z.coerce.number(),
  created_by: z.uuid().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

const NOTE_SELECT =
  "id,board_id,title,snapshot_b64,snapshot_up_to_id,created_by,created_at,updated_at";

function toNote(row: z.infer<typeof NoteRowSchema>): Note {
  return {
    id: row.id,
    boardId: row.board_id,
    title: row.title,
    snapshotB64: row.snapshot_b64,
    snapshotUpToId: row.snapshot_up_to_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listBoardNotes(boardId: string): Promise<Note[]> {
  const { data, error } = await supabase
    .from("notes")
    .select(NOTE_SELECT)
    .eq("board_id", boardId)
    .order("updated_at", { ascending: false })
    .order("id", { ascending: true });
  if (error) {
    throw error;
  }
  return z.array(NoteRowSchema).parse(data).map(toNote);
}

export async function getNote(noteId: string): Promise<Note> {
  const { data, error } = await supabase
    .from("notes")
    .select(NOTE_SELECT)
    .eq("id", noteId)
    .single();
  if (error) {
    throw error;
  }
  return toNote(NoteRowSchema.parse(data));
}

const CreateNoteInput = z.object({
  boardId: z.uuid(),
  title: z.string().trim().max(NOTE_TITLE_MAX),
});

export async function createNote(
  input: z.input<typeof CreateNoteInput>
): Promise<Note> {
  const parsed = CreateNoteInput.parse(input);
  const { data: auth } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("notes")
    .insert({
      board_id: parsed.boardId,
      title: parsed.title,
      created_by: auth.user?.id ?? null,
    })
    .select(NOTE_SELECT)
    .single();
  if (error) {
    throw error;
  }
  return toNote(NoteRowSchema.parse(data));
}

export async function deleteNote(noteId: string): Promise<void> {
  const { error } = await supabase.from("notes").delete().eq("id", noteId);
  if (error) {
    throw error;
  }
}

const SetNoteTitleInput = z.object({
  noteId: z.uuid(),
  title: z.string().trim().max(NOTE_TITLE_MAX),
});

export async function setNoteTitle(
  input: z.input<typeof SetNoteTitleInput>
): Promise<void> {
  const parsed = SetNoteTitleInput.parse(input);
  const { error } = await supabase
    .from("notes")
    .update({ title: parsed.title })
    .eq("id", parsed.noteId);
  if (error) {
    throw error;
  }
}

const NoteUpdateRowSchema = z.object({
  id: z.coerce.number(),
  update_b64: z.string(),
});

const ListNoteUpdatesInput = z.object({
  noteId: z.uuid(),
  afterId: z.number().int().nonnegative(),
});

export async function listNoteUpdates(
  input: z.input<typeof ListNoteUpdatesInput>
): Promise<NoteUpdate[]> {
  const parsed = ListNoteUpdatesInput.parse(input);
  const { data, error } = await supabase
    .from("note_updates")
    .select("id,update_b64")
    .eq("note_id", parsed.noteId)
    .gt("id", parsed.afterId)
    .order("id", { ascending: true });
  if (error) {
    throw error;
  }
  return z
    .array(NoteUpdateRowSchema)
    .parse(data)
    .map((row) => ({ id: row.id, update: fromBase64(row.update_b64) }));
}

const AppendNoteUpdateInput = z.object({
  noteId: z.uuid(),
  update: z.instanceof(Uint8Array),
});

export async function appendNoteUpdate(
  input: z.input<typeof AppendNoteUpdateInput>
): Promise<void> {
  const parsed = AppendNoteUpdateInput.parse(input);
  const { error } = await supabase.from("note_updates").insert({
    note_id: parsed.noteId,
    update_b64: toBase64(parsed.update),
  });
  if (error) {
    throw error;
  }
}

const CompactNoteInput = z.object({
  noteId: z.uuid(),
  snapshot: z.instanceof(Uint8Array),
  upToId: z.number().int().nonnegative(),
});

export async function compactNote(
  input: z.input<typeof CompactNoteInput>
): Promise<void> {
  const parsed = CompactNoteInput.parse(input);
  const { error } = await supabase.rpc("compact_note", {
    p_note_id: parsed.noteId,
    p_snapshot_b64: toBase64(parsed.snapshot),
    p_up_to_id: parsed.upToId,
  });
  if (error) {
    throw error;
  }
}
```

- [ ] **Step 5: Run the integration tests**

```bash
cd apps/web && pnpm test:integration -- src/features/notes/api/notes.integration.test.ts
```

Expected: 6 passed.

- [ ] **Step 6: Lint and typecheck**

```bash
cd /home/maikb/IdeaProjects/pinnwand && pnpm check && cd apps/web && pnpm check-types
```

Expected: both clean.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/notes/types.ts apps/web/src/features/notes/api
git commit -m "feat(notes): add notes API layer with RLS integration tests"
```

---

## Task 4: Install editor and CRDT dependencies

**Files:**
- Modify: `apps/web/package.json`

**Interfaces:**
- Consumes: nothing
- Produces: the `yjs`, `y-protocols`, `y-indexeddb`, and `@tiptap/*` module graph

- [ ] **Step 1: Install**

```bash
cd /home/maikb/IdeaProjects/pinnwand
pnpm --filter @pinnwand/web add yjs y-protocols y-indexeddb \
  @tiptap/react @tiptap/core @tiptap/pm @tiptap/starter-kit \
  @tiptap/extension-list @tiptap/extension-collaboration \
  @tiptap/extension-collaboration-caret @tiptap/markdown
```

All of these are MIT. Tiptap open-sourced its formerly Pro block extensions in June 2025; the remaining paid extensions (Comments, version history, Content AI) are not used here.

- [ ] **Step 2: Verify the Tiptap versions agree**

```bash
cd apps/web && pnpm ls --depth 0 | grep -E '@tiptap|yjs|y-protocols|y-indexeddb'
```

Expected: every `@tiptap/*` package on the same minor version. `@tiptap/extension-collaboration` peer-depends on `@tiptap/y-tiptap`; confirm it resolved:

```bash
cd apps/web && pnpm ls @tiptap/y-tiptap
```

Expected: a single resolved version, no unmet peer warning.

- [ ] **Step 3: Verify the build still passes**

```bash
cd /home/maikb/IdeaProjects/pinnwand && pnpm build
```

Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml
git commit -m "chore(notes): add Tiptap 3, Yjs, and y-protocols dependencies"
```

---

## Task 5: Note document lifecycle

**Files:**
- Create: `apps/web/src/features/notes/lib/note-doc.ts`
- Test: `apps/web/src/features/notes/lib/note-doc.test.ts`

**Interfaces:**
- Consumes: `getNote`, `listNoteUpdates`, `appendNoteUpdate`, `compactNote` from `../api/notes`; `Note`, `NoteUpdate` from `../types`
- Produces:
  - `COMPACT_THRESHOLD = 500`
  - `UPDATE_FLUSH_MS = 400`
  - `applyUpdates(doc: Y.Doc, updates: NoteUpdate[]): number` returns the highest applied id
  - `hydrateDoc(doc: Y.Doc, note: Note, updates: NoteUpdate[]): number`
  - `resyncPlan(input: { lastSeenId: number; snapshotUpToId: number }): { needsSnapshot: boolean; afterId: number }`
  - `class NoteSync` with `start()`, `stop()`, `queueLocalUpdate(update: Uint8Array)`, `applyRemote(update: NoteUpdate)`

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/features/notes/lib/note-doc.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { applyUpdates, hydrateDoc, resyncPlan } from "./note-doc";
import type { Note, NoteUpdate } from "../types";
import { toBase64 } from "./bytes";

function docWithText(value: string): Y.Doc {
  const doc = new Y.Doc();
  doc.getText("t").insert(0, value);
  return doc;
}

function updatesFrom(doc: Y.Doc, startId: number): NoteUpdate[] {
  return [{ id: startId, update: Y.encodeStateAsUpdate(doc) }];
}

function emptyNote(overrides: Partial<Note> = {}): Note {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    boardId: "00000000-0000-0000-0000-000000000002",
    title: "",
    snapshotB64: null,
    snapshotUpToId: 0,
    createdBy: null,
    createdAt: "2026-07-19T00:00:00Z",
    updatedAt: "2026-07-19T00:00:00Z",
    ...overrides,
  };
}

describe("applyUpdates", () => {
  it("applies updates in order and returns the highest id", () => {
    const source = docWithText("hallo");
    const target = new Y.Doc();
    const highest = applyUpdates(target, updatesFrom(source, 7));
    expect(target.getText("t").toString()).toBe("hallo");
    expect(highest).toBe(7);
  });

  it("returns 0 for an empty list", () => {
    expect(applyUpdates(new Y.Doc(), [])).toBe(0);
  });

  it("is idempotent when the same update is applied twice", () => {
    const source = docWithText("abc");
    const target = new Y.Doc();
    const updates = updatesFrom(source, 1);
    applyUpdates(target, updates);
    applyUpdates(target, updates);
    expect(target.getText("t").toString()).toBe("abc");
  });
});

describe("hydrateDoc", () => {
  it("applies the snapshot before the incremental updates", () => {
    const base = docWithText("eins");
    const note = emptyNote({
      snapshotB64: toBase64(Y.encodeStateAsUpdate(base)),
      snapshotUpToId: 5,
    });
    const later = new Y.Doc();
    Y.applyUpdate(later, Y.encodeStateAsUpdate(base));
    later.getText("t").insert(4, " zwei");

    const target = new Y.Doc();
    const highest = hydrateDoc(target, note, [
      { id: 9, update: Y.encodeStateAsUpdate(later) },
    ]);
    expect(target.getText("t").toString()).toBe("eins zwei");
    expect(highest).toBe(9);
  });

  it("falls back to snapshotUpToId when there are no updates", () => {
    const base = docWithText("nur snapshot");
    const note = emptyNote({
      snapshotB64: toBase64(Y.encodeStateAsUpdate(base)),
      snapshotUpToId: 12,
    });
    const target = new Y.Doc();
    expect(hydrateDoc(target, note, [])).toBe(12);
    expect(target.getText("t").toString()).toBe("nur snapshot");
  });
});

describe("resyncPlan", () => {
  it("asks for incremental updates when the client is current", () => {
    expect(resyncPlan({ lastSeenId: 40, snapshotUpToId: 10 })).toEqual({
      needsSnapshot: false,
      afterId: 40,
    });
  });

  it("asks for the snapshot when compaction outran the client", () => {
    // The client was offline while the note was compacted, so its lastSeenId
    // points at rows that have been deleted.
    expect(resyncPlan({ lastSeenId: 3, snapshotUpToId: 20 })).toEqual({
      needsSnapshot: true,
      afterId: 20,
    });
  });

  it("treats a fresh client as needing the snapshot", () => {
    expect(resyncPlan({ lastSeenId: 0, snapshotUpToId: 0 })).toEqual({
      needsSnapshot: true,
      afterId: 0,
    });
  });
});

describe("convergence", () => {
  it("converges regardless of the order updates are applied", () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    a.getText("t").insert(0, "links");
    b.getText("t").insert(0, "rechts");
    const updateA = Y.encodeStateAsUpdate(a);
    const updateB = Y.encodeStateAsUpdate(b);

    const forward = new Y.Doc();
    applyUpdates(forward, [
      { id: 1, update: updateA },
      { id: 2, update: updateB },
    ]);

    const reverse = new Y.Doc();
    applyUpdates(reverse, [
      { id: 2, update: updateB },
      { id: 1, update: updateA },
    ]);

    expect(forward.getText("t").toString()).toBe(
      reverse.getText("t").toString()
    );
  });

  it("converges across many randomised orderings", () => {
    const sources = Array.from({ length: 6 }, (_, i) => {
      const doc = new Y.Doc();
      doc.getText("t").insert(0, `teil-${i} `);
      return { id: i + 1, update: Y.encodeStateAsUpdate(doc) };
    });

    const canonical = new Y.Doc();
    applyUpdates(canonical, sources);
    const expected = canonical.getText("t").toString();

    for (let trial = 0; trial < 25; trial += 1) {
      // Deterministic shuffle so a failure reproduces.
      const shuffled = [...sources].sort(
        (x, y) => ((x.id * 7 + trial) % 5) - ((y.id * 7 + trial) % 5)
      );
      const doc = new Y.Doc();
      applyUpdates(doc, shuffled);
      expect(doc.getText("t").toString()).toBe(expected);
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd apps/web && pnpm vitest run src/features/notes/lib/note-doc.test.ts
```

Expected: FAIL, cannot resolve `./note-doc`.

- [ ] **Step 3: Write the implementation**

Create `apps/web/src/features/notes/lib/note-doc.ts`:

```ts
import * as Y from "yjs";
import {
  appendNoteUpdate,
  compactNote,
  getNote,
  listNoteUpdates,
} from "../api/notes";
import type { Note, NoteUpdate } from "../types";
import { fromBase64 } from "./bytes";

/**
 * Log rows tolerated before a snapshot is written. This is Yjs's own
 * PREFERRED_TRIM_SIZE from y-indexeddb rather than an invented threshold.
 */
export const COMPACT_THRESHOLD = 500;

/** Debounce between local edits and one durable append. */
export const UPDATE_FLUSH_MS = 400;

export function applyUpdates(doc: Y.Doc, updates: NoteUpdate[]): number {
  let highest = 0;
  for (const entry of updates) {
    Y.applyUpdate(doc, entry.update);
    if (entry.id > highest) {
      highest = entry.id;
    }
  }
  return highest;
}

export function hydrateDoc(
  doc: Y.Doc,
  note: Note,
  updates: NoteUpdate[]
): number {
  if (note.snapshotB64) {
    Y.applyUpdate(doc, fromBase64(note.snapshotB64));
  }
  const highest = applyUpdates(doc, updates);
  return Math.max(highest, note.snapshotUpToId);
}

/**
 * Decides what a reconnecting client must fetch.
 *
 * The case that matters: the note was compacted while this client was away, so
 * its lastSeenId points at rows that no longer exist. Re-applying the snapshot
 * is a no-op in Yjs when it has already been seen, so this needs no further
 * cleverness.
 */
export function resyncPlan(input: {
  lastSeenId: number;
  snapshotUpToId: number;
}): { needsSnapshot: boolean; afterId: number } {
  if (input.snapshotUpToId > input.lastSeenId) {
    return { needsSnapshot: true, afterId: input.snapshotUpToId };
  }
  return { needsSnapshot: false, afterId: input.lastSeenId };
}

type NoteSyncOptions = {
  noteId: string;
  doc: Y.Doc;
  onError: (error: Error) => void;
};

/**
 * Owns the durable half of note sync: hydration, the debounced append of local
 * updates, resync after a reconnect, and opportunistic compaction on close.
 *
 * Remote delivery is not this class's job. The caller subscribes to
 * postgres_changes and hands rows to applyRemote.
 */
export class NoteSync {
  private readonly noteId: string;
  private readonly doc: Y.Doc;
  private readonly onError: (error: Error) => void;
  private pending: Uint8Array[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSeenId = 0;
  private appendedSinceSnapshot = 0;
  private stopped = false;

  constructor(options: NoteSyncOptions) {
    this.noteId = options.noteId;
    this.doc = options.doc;
    this.onError = options.onError;
  }

  async start(): Promise<void> {
    const note = await getNote(this.noteId);
    const updates = await listNoteUpdates({
      noteId: this.noteId,
      afterId: note.snapshotUpToId,
    });
    this.lastSeenId = hydrateDoc(this.doc, note, updates);
    this.appendedSinceSnapshot = updates.length;
  }

  /** Re-fetches whatever this client missed while disconnected. */
  async resync(): Promise<void> {
    const note = await getNote(this.noteId);
    const plan = resyncPlan({
      lastSeenId: this.lastSeenId,
      snapshotUpToId: note.snapshotUpToId,
    });
    if (plan.needsSnapshot && note.snapshotB64) {
      Y.applyUpdate(this.doc, fromBase64(note.snapshotB64));
    }
    const updates = await listNoteUpdates({
      noteId: this.noteId,
      afterId: plan.afterId,
    });
    this.lastSeenId = Math.max(
      this.lastSeenId,
      applyUpdates(this.doc, updates),
      note.snapshotUpToId
    );
  }

  applyRemote(entry: NoteUpdate): void {
    if (entry.id <= this.lastSeenId) {
      return;
    }
    Y.applyUpdate(this.doc, entry.update);
    this.lastSeenId = entry.id;
    this.appendedSinceSnapshot += 1;
  }

  queueLocalUpdate(update: Uint8Array): void {
    if (this.stopped) {
      return;
    }
    this.pending.push(update);
    if (this.flushTimer !== null) {
      return;
    }
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, UPDATE_FLUSH_MS);
  }

  async flush(): Promise<void> {
    if (this.pending.length === 0) {
      return;
    }
    // One row per flush window, not one per keystroke.
    const merged = Y.mergeUpdates(this.pending);
    this.pending = [];
    try {
      await appendNoteUpdate({ noteId: this.noteId, update: merged });
      this.appendedSinceSnapshot += 1;
    } catch (error) {
      this.onError(
        error instanceof Error ? error : new Error("Speichern fehlgeschlagen")
      );
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
    if (this.appendedSinceSnapshot > COMPACT_THRESHOLD) {
      try {
        await compactNote({
          noteId: this.noteId,
          snapshot: Y.encodeStateAsUpdate(this.doc),
          upToId: this.lastSeenId,
        });
        this.appendedSinceSnapshot = 0;
      } catch (error) {
        // Compaction is opportunistic. A failure leaves a longer log, which is
        // a performance cost and not a correctness one, so it is reported but
        // does not surface as a user-facing save failure.
        this.onError(
          error instanceof Error ? error : new Error("Aufräumen fehlgeschlagen")
        );
      }
    }
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd apps/web && pnpm vitest run src/features/notes/lib/note-doc.test.ts
```

Expected: 10 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/notes/lib/note-doc.ts apps/web/src/features/notes/lib/note-doc.test.ts
git commit -m "feat(notes): add Y.Doc lifecycle with hydration, resync and compaction"
```

---

## Task 6: Title derivation

**Files:**
- Create: `apps/web/src/features/notes/lib/title.ts`
- Test: `apps/web/src/features/notes/lib/title.test.ts`

**Interfaces:**
- Consumes: `NOTE_TITLE_MAX` from `../api/notes`
- Produces: `deriveTitle(text: string): string`, `UNTITLED_NOTE = "Unbenannte Notiz"`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/features/notes/lib/title.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { deriveTitle, UNTITLED_NOTE } from "./title";

describe("deriveTitle", () => {
  it("uses the first non-empty line", () => {
    expect(deriveTitle("Einkaufsliste\nMilch\nBrot")).toBe("Einkaufsliste");
  });

  it("skips leading blank lines", () => {
    expect(deriveTitle("\n\n  Sprintplanung\nDetails")).toBe("Sprintplanung");
  });

  it("falls back for an empty document", () => {
    expect(deriveTitle("")).toBe(UNTITLED_NOTE);
    expect(deriveTitle("   \n  \n")).toBe(UNTITLED_NOTE);
  });

  it("truncates a very long first line", () => {
    const title = deriveTitle("a".repeat(500));
    expect(title).toHaveLength(200);
  });

  it("collapses internal whitespace", () => {
    expect(deriveTitle("Viele    Leerzeichen  hier")).toBe(
      "Viele Leerzeichen hier"
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/web && pnpm vitest run src/features/notes/lib/title.test.ts
```

Expected: FAIL, cannot resolve `./title`.

- [ ] **Step 3: Write the implementation**

Create `apps/web/src/features/notes/lib/title.ts`:

```ts
import { NOTE_TITLE_MAX } from "../api/notes";

export const UNTITLED_NOTE = "Unbenannte Notiz";

/**
 * Derives the notes-list label from the document's first non-empty line.
 *
 * This is a client-written cache on public.notes rather than something the
 * database computes, because the document is a CRDT blob that Postgres cannot
 * decode without an extension.
 */
export function deriveTitle(text: string): string {
  for (const line of text.split("\n")) {
    const collapsed = line.replace(/\s+/g, " ").trim();
    if (collapsed.length > 0) {
      return collapsed.slice(0, NOTE_TITLE_MAX);
    }
  }
  return UNTITLED_NOTE;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd apps/web && pnpm vitest run src/features/notes/lib/title.test.ts
```

Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/notes/lib/title.ts apps/web/src/features/notes/lib/title.test.ts
git commit -m "feat(notes): derive note titles from the first document line"
```

---

## Task 7: Awareness broadcast channel

**Files:**
- Create: `apps/web/src/features/notes/lib/awareness-channel.ts`
- Test: `apps/web/src/features/notes/lib/awareness-channel.test.ts`

**Interfaces:**
- Consumes: `toExactArrayBuffer` from `./bytes`, `supabase` from `@/shared/lib/supabase`
- Produces:
  - `AWARENESS_THROTTLE_MS = 100`
  - `shouldBroadcast(changed: number[], localClientId: number): boolean`
  - `class AwarenessThrottle` with `push(clients: number[], hasRemoval: boolean)`, `cancel()`
  - `connectAwareness(options): () => void`

The two rules encoded here are the ones both abandoned community providers get wrong. Send only when the changed-client set contains the local id, not when the origin is `'local'`, because a remote that wrongly nulls this client causes `applyAwarenessUpdate` to bump the local clock and re-announce with a *remote* origin. And throttle the send, never the event, because debouncing the handler discards `removed` entries and leaves ghost carets until the 30 second timeout.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/features/notes/lib/awareness-channel.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AwarenessThrottle, shouldBroadcast } from "./awareness-channel";

describe("shouldBroadcast", () => {
  it("sends when the local client changed", () => {
    expect(shouldBroadcast([7, 9], 7)).toBe(true);
  });

  it("does not relay a change that is only about other peers", () => {
    // Relaying third-party state would make fanout quadratic and can
    // resurrect a peer that already died.
    expect(shouldBroadcast([9, 12], 7)).toBe(false);
  });

  it("sends on an empty local id set only when it contains the local id", () => {
    expect(shouldBroadcast([], 7)).toBe(false);
  });
});

describe("AwarenessThrottle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("flushes immediately on the leading edge", () => {
    const flush = vi.fn();
    const throttle = new AwarenessThrottle(flush);
    throttle.push([1], false);
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("coalesces a burst into one trailing flush", () => {
    const flush = vi.fn();
    const throttle = new AwarenessThrottle(flush);
    throttle.push([1], false);
    throttle.push([1], false);
    throttle.push([1], false);
    expect(flush).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(100);
    expect(flush).toHaveBeenCalledTimes(2);
  });

  it("accumulates changed ids across suppressed events", () => {
    const flush = vi.fn();
    const throttle = new AwarenessThrottle(flush);
    throttle.push([1], false);
    throttle.push([2], false);
    throttle.push([3], false);
    vi.advanceTimersByTime(100);
    expect(flush).toHaveBeenLastCalledWith([2, 3]);
  });

  it("bypasses the throttle for a removal", () => {
    // Removals are rare and correctness-critical: a suppressed tombstone
    // leaves a ghost caret until the remote 30s timeout expires it.
    const flush = vi.fn();
    const throttle = new AwarenessThrottle(flush);
    throttle.push([1], false);
    throttle.push([2], true);
    expect(flush).toHaveBeenCalledTimes(2);
  });

  it("stops flushing after cancel", () => {
    const flush = vi.fn();
    const throttle = new AwarenessThrottle(flush);
    throttle.push([1], false);
    throttle.push([2], false);
    throttle.cancel();
    vi.advanceTimersByTime(500);
    expect(flush).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/web && pnpm vitest run src/features/notes/lib/awareness-channel.test.ts
```

Expected: FAIL, cannot resolve `./awareness-channel`.

- [ ] **Step 3: Write the implementation**

Create `apps/web/src/features/notes/lib/awareness-channel.ts`:

```ts
import type { RealtimeChannel } from "@supabase/supabase-js";
import {
  applyAwarenessUpdate,
  type Awareness,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from "y-protocols/awareness";
import { supabase } from "@/shared/lib/supabase";
import { toExactArrayBuffer } from "./bytes";

export const AWARENESS_THROTTLE_MS = 100;
const AWARENESS_EVENT = "awareness";
const AWARENESS_QUERY_EVENT = "awareness:query";
const QUERY_REPLY_MAX_JITTER_MS = 200;

/** Origin tag for updates that arrived over the wire, never the string "local". */
const REMOTE_ORIGIN = Symbol("awareness-remote");

/**
 * Sends only when the local client is in the changed set.
 *
 * Filtering on `origin === 'local'` would be wrong: when a remote incorrectly
 * nulls this client, applyAwarenessUpdate bumps the local clock so the client
 * re-announces itself, and that update carries a remote origin. Filtering on
 * the client set catches it, and also stops this peer relaying third-party
 * state, which would make fanout quadratic.
 */
export function shouldBroadcast(
  changed: number[],
  localClientId: number
): boolean {
  return changed.includes(localClientId);
}

/**
 * Leading-and-trailing-edge throttle over the *send*, not the awareness event.
 *
 * The awareness handler stays unthrottled and accumulates changed ids here.
 * Debouncing the handler instead (as kevinamick/supabaseprovider does) discards
 * the `removed` set from suppressed calls, which leaves ghost carets alive
 * until the remote 30 second timeout, and freezes carets during continuous
 * typing, which is exactly when they should move.
 */
export class AwarenessThrottle {
  private readonly flush: (clients: number[]) => void;
  private pending = new Set<number>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private cancelled = false;

  constructor(flush: (clients: number[]) => void) {
    this.flush = flush;
  }

  push(clients: number[], hasRemoval: boolean): void {
    if (this.cancelled) {
      return;
    }
    for (const id of clients) {
      this.pending.add(id);
    }
    if (hasRemoval) {
      this.emit();
      return;
    }
    if (this.timer !== null) {
      return;
    }
    this.emit();
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.pending.size > 0) {
        this.emit();
      }
    }, AWARENESS_THROTTLE_MS);
  }

  cancel(): void {
    this.cancelled = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pending.clear();
  }

  private emit(): void {
    const clients = [...this.pending];
    this.pending.clear();
    this.flush(clients);
  }
}

type ConnectAwarenessOptions = {
  noteId: string;
  awareness: Awareness;
  onError: (error: Error) => void;
};

/**
 * Binds a y-protocols Awareness instance to a Supabase broadcast channel.
 *
 * Broadcast rather than Presence for two independent reasons. Self-hosted
 * Realtime caps a client at CLIENT_PRESENCE_MAX_CALLS=5 per 30 seconds, which
 * is below even the awareness heartbeat. And Awareness already is a presence
 * protocol with its own clock, 30 second peer expiry, and tombstones, so
 * layering Presence under it means two clocks and two lifecycles that disagree.
 *
 * Returns a teardown function.
 */
export function connectAwareness(options: ConnectAwarenessOptions): () => void {
  const { noteId, awareness, onError } = options;
  const localId = awareness.clientID;
  let channel: RealtimeChannel | null = null;
  let subscribed = false;
  let tombstoneSent = false;

  const sendState = (clients: number[]): void => {
    // send() silently falls back to REST when the channel is not pushable, and
    // the REST path JSON.stringify's the payload, which corrupts binary.
    if (!(channel && subscribed) || clients.length === 0) {
      return;
    }
    const update = encodeAwarenessUpdate(awareness, clients);
    void channel.send({
      type: "broadcast",
      event: AWARENESS_EVENT,
      payload: toExactArrayBuffer(update),
    });
  };

  const throttle = new AwarenessThrottle(sendState);

  const onAwarenessUpdate = (
    change: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown
  ): void => {
    if (origin === REMOTE_ORIGIN) {
      return;
    }
    const changed = [...change.added, ...change.updated, ...change.removed];
    if (!shouldBroadcast(changed, localId)) {
      return;
    }
    throttle.push([localId], change.removed.length > 0);
  };

  awareness.on("update", onAwarenessUpdate);

  const clearRemotes = (): void => {
    const remotes = [...awareness.getStates().keys()].filter(
      (id) => id !== localId
    );
    if (remotes.length > 0) {
      removeAwarenessStates(awareness, remotes, REMOTE_ORIGIN);
    }
  };

  const sendTombstone = (): void => {
    if (tombstoneSent) {
      return;
    }
    tombstoneSent = true;
    removeAwarenessStates(awareness, [localId], REMOTE_ORIGIN);
    sendState([localId]);
  };

  // pagehide plus visibilitychange, never beforeunload: iOS Safari and Android
  // Chrome discard backgrounded tabs without firing beforeunload, which is the
  // mobile defect in both community providers.
  const onPageHide = (): void => sendTombstone();
  const onVisibility = (): void => {
    if (document.visibilityState === "hidden") {
      sendTombstone();
    }
  };
  window.addEventListener("pagehide", onPageHide);
  document.addEventListener("visibilitychange", onVisibility);

  channel = supabase
    .channel(`awareness:${noteId}`, { config: { broadcast: { self: false } } })
    .on("broadcast", { event: AWARENESS_EVENT }, (message) => {
      const payload = message.payload;
      if (!(payload instanceof ArrayBuffer)) {
        return;
      }
      try {
        applyAwarenessUpdate(awareness, new Uint8Array(payload), REMOTE_ORIGIN);
      } catch (error) {
        // A truncated update throws inside applyAwarenessUpdate. An unhandled
        // throw in a channel callback is a swallowed error, so surface it and
        // drop the message: the sender's next heartbeat repairs within 15s.
        onError(
          error instanceof Error ? error : new Error("Awareness-Update ungültig")
        );
      }
    })
    .on("broadcast", { event: AWARENESS_QUERY_EVENT }, () => {
      // Reply with our own state only. Relaying the full states map would
      // resurrect peers that already died.
      const jitter = Math.random() * QUERY_REPLY_MAX_JITTER_MS;
      setTimeout(() => sendState([localId]), jitter);
    })
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        subscribed = true;
        tombstoneSent = false;
        sendState([localId]);
        // Fire-and-forget broadcast retains no state, so a late joiner would
        // otherwise see nobody until each peer next moves. The 15s self-renewal
        // is the safety net, making a lost query a latency bug not a
        // correctness one.
        void channel?.send({
          type: "broadcast",
          event: AWARENESS_QUERY_EVENT,
          payload: {},
        });
        return;
      }
      if (
        status === "CHANNEL_ERROR" ||
        status === "TIMED_OUT" ||
        status === "CLOSED"
      ) {
        subscribed = false;
        clearRemotes();
      }
    });

  return () => {
    // Same function reference that was registered. Passing an unbound method
    // here leaks the listener, which React 19 StrictMode exercises on every
    // dev mount.
    awareness.off("update", onAwarenessUpdate);
    window.removeEventListener("pagehide", onPageHide);
    document.removeEventListener("visibilitychange", onVisibility);
    sendTombstone();
    throttle.cancel();
    if (channel) {
      void supabase.removeChannel(channel);
      channel = null;
    }
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd apps/web && pnpm vitest run src/features/notes/lib/awareness-channel.test.ts
```

Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/notes/lib/awareness-channel.ts apps/web/src/features/notes/lib/awareness-channel.test.ts
git commit -m "feat(notes): add y-protocols awareness over Supabase broadcast"
```

---

## Task 8: Hooks, realtime, and offline registration

**Files:**
- Create: `apps/web/src/features/notes/hooks/use-board-notes.ts`
- Create: `apps/web/src/features/notes/hooks/use-create-note.ts`
- Create: `apps/web/src/features/notes/hooks/use-delete-note.ts`
- Create: `apps/web/src/features/notes/hooks/use-notes-realtime.ts`
- Create: `apps/web/src/features/notes/mutation-defaults.ts`
- Modify: `apps/web/src/shared/lib/query-client.ts`
- Modify: `apps/web/src/app/main.tsx`

**Interfaces:**
- Consumes: everything exported from `../api/notes`
- Produces: `useBoardNotes(boardId)`, `useCreateNote(boardId)`, `useDeleteNote(boardId)`, `useNotesRealtime(boardId)`, `registerNoteMutationDefaults(queryClient)`

- [ ] **Step 1: Add `notes` to both offline allowlists**

In `apps/web/src/shared/lib/query-client.ts`, extend `OFFLINE_QUERY_ROOTS`:

```ts
const OFFLINE_QUERY_ROOTS: ReadonlySet<string> = new Set([
  "boards",
  "tasks",
  "notes",
  "board-members",
  // The viewer's own profile row (display name). Per-user buster, not shared.
  "profile",
]);
```

and `DURABLE_MUTATION_ROOTS`:

```ts
const DURABLE_MUTATION_ROOTS: ReadonlySet<string> = new Set(["tasks", "notes"]);
```

- [ ] **Step 2: Write the notes list hook**

Create `apps/web/src/features/notes/hooks/use-board-notes.ts`:

```ts
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { listBoardNotes, NOTE_KEYS } from "../api/notes";
import type { Note } from "../types";

export function useBoardNotes(boardId: string): {
  notes: Note[];
  isPending: boolean;
  isError: boolean;
  error: Error | null;
} {
  const { data, isPending, isError, error } = useQuery({
    queryKey: NOTE_KEYS.byBoard(boardId),
    queryFn: () => listBoardNotes(boardId),
    enabled: !!boardId,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    refetchOnMount: "always",
    meta: { op: "listBoardNotes", scope: { board: boardId } },
  });
  return { notes: data ?? [], isPending, isError, error };
}
```

- [ ] **Step 3: Write the create and delete hooks**

Create `apps/web/src/features/notes/hooks/use-create-note.ts`:

```ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createNote, NOTE_KEYS, NOTE_MUTATION_KEYS } from "../api/notes";
import { UNTITLED_NOTE } from "../lib/title";
import type { Note } from "../types";

export function useCreateNote(boardId: string): {
  createNote: () => Promise<Note>;
  isPending: boolean;
} {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationKey: NOTE_MUTATION_KEYS.forBoard(boardId),
    mutationFn: () => createNote({ boardId, title: UNTITLED_NOTE }),
    meta: { op: "createNote", scope: { board: boardId } },
    onSuccess: (note) => {
      queryClient.setQueryData<Note[]>(
        NOTE_KEYS.byBoard(boardId),
        (previous) => [note, ...(previous ?? [])]
      );
    },
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: NOTE_KEYS.byBoard(boardId),
      });
    },
  });
  return {
    createNote: () => mutation.mutateAsync(),
    isPending: mutation.isPending,
  };
}
```

Create `apps/web/src/features/notes/hooks/use-delete-note.ts`:

```ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { deleteNote, NOTE_KEYS, NOTE_MUTATION_KEYS } from "../api/notes";
import type { Note } from "../types";

export function useDeleteNote(boardId: string): {
  deleteNote: (noteId: string) => Promise<void>;
  isPending: boolean;
} {
  const queryClient = useQueryClient();
  const mutation = useMutation<void, Error, string, { previous: Note[] }>({
    mutationKey: NOTE_MUTATION_KEYS.forBoard(boardId),
    mutationFn: (noteId) => deleteNote(noteId),
    meta: { op: "deleteNote", scope: { board: boardId } },
    onMutate: async (noteId) => {
      await queryClient.cancelQueries({ queryKey: NOTE_KEYS.byBoard(boardId) });
      const previous =
        queryClient.getQueryData<Note[]>(NOTE_KEYS.byBoard(boardId)) ?? [];
      queryClient.setQueryData<Note[]>(
        NOTE_KEYS.byBoard(boardId),
        previous.filter((note) => note.id !== noteId)
      );
      return { previous };
    },
    onError: (_error, _noteId, context) => {
      if (context) {
        queryClient.setQueryData(NOTE_KEYS.byBoard(boardId), context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: NOTE_KEYS.byBoard(boardId),
      });
    },
  });
  return {
    deleteNote: (noteId) => mutation.mutateAsync(noteId),
    isPending: mutation.isPending,
  };
}
```

- [ ] **Step 4: Write the realtime hook**

Create `apps/web/src/features/notes/hooks/use-notes-realtime.ts`:

```ts
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { noop } from "@/shared/lib/noop";
import { supabase } from "@/shared/lib/supabase";
import { NOTE_KEYS } from "../api/notes";

/**
 * Keeps the notes list fresh when another member creates, renames, or deletes
 * a note. Per tanstack-query.md, realtime only invalidates; it never merges
 * payloads into the cache by hand.
 *
 * Document content is not handled here. That rides note_updates and is applied
 * to the Y.Doc by use-note-doc.
 */
export function useNotesRealtime(boardId: string): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!boardId) {
      return;
    }
    const channel = supabase
      .channel(`board-notes:${boardId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notes",
          filter: `board_id=eq.${boardId}`,
        },
        () => {
          void queryClient.invalidateQueries({
            queryKey: NOTE_KEYS.byBoard(boardId),
          });
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel).then(noop, noop);
    };
  }, [boardId, queryClient]);
}
```

- [ ] **Step 5: Write the resumable mutation defaults**

Create `apps/web/src/features/notes/mutation-defaults.ts`:

```ts
import type { QueryClient } from "@tanstack/react-query";
import { appendNoteUpdate, NOTE_MUTATION_KEYS } from "./api/notes";

/**
 * A note write that was paused offline and rehydrated in a later session. Only
 * the document append is durable: creating and deleting notes needs the server
 * and runs network-only.
 */
export type ResumableNoteMutation = {
  op: "appendUpdate";
  noteId: string;
  update: Uint8Array;
};

async function runResumableNoteMutation(
  vars: ResumableNoteMutation
): Promise<void> {
  switch (vars.op) {
    case "appendUpdate":
      await appendNoteUpdate({ noteId: vars.noteId, update: vars.update });
      return;
    default: {
      const unreachable: never = vars.op;
      throw new Error(
        `Unknown resumable note mutation: ${JSON.stringify(unreachable)}`
      );
    }
  }
}

/**
 * Registers the resumable mutationFn for note document appends under the
 * generic ["notes", "mutate"] prefix. A mutation paused in a prior offline
 * session rehydrates with only its serialized variables, so no React hook
 * survives to supply a mutationFn. Call once from main.tsx before the persister
 * resumes paused mutations.
 */
export function registerNoteMutationDefaults(queryClient: QueryClient): void {
  queryClient.setMutationDefaults<void, Error, ResumableNoteMutation>(
    NOTE_MUTATION_KEYS.root,
    { mutationFn: (variables) => runResumableNoteMutation(variables) }
  );
}
```

- [ ] **Step 6: Register the defaults in main.tsx**

In `apps/web/src/app/main.tsx`, add the import alongside the tasks one and call it directly after `registerTaskMutationDefaults(queryClient);`:

```ts
import { registerNoteMutationDefaults } from "@/features/notes/mutation-defaults";

registerTaskMutationDefaults(queryClient);
registerNoteMutationDefaults(queryClient);
```

The ordering constraint is that both run before `createIdbPersister()` and the `PersistQueryClientProvider` mount, which is already true at this position.

- [ ] **Step 7: Run the full unit suite and typecheck**

```bash
cd apps/web && pnpm test && pnpm check-types
```

Expected: all pass, including the existing `mutation-defaults.test.ts` and `query-client` predicate tests.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/features/notes/hooks apps/web/src/features/notes/mutation-defaults.ts apps/web/src/shared/lib/query-client.ts apps/web/src/app/main.tsx
git commit -m "feat(notes): add notes hooks, realtime invalidation and offline resume"
```

---

## Task 9: Editor component

**Files:**
- Create: `apps/web/src/features/notes/hooks/use-note-doc.ts`
- Create: `apps/web/src/features/notes/components/note-editor.tsx`
- Create: `apps/web/src/features/notes/components/format-bar.tsx`

**Interfaces:**
- Consumes: `NoteSync` from `../lib/note-doc`, `connectAwareness` from `../lib/awareness-channel`, `deriveTitle` from `../lib/title`, `setNoteTitle` and `NOTE_KEYS` from `../api/notes`
- Produces: `useNoteDoc(noteId)` returning `{ doc, awareness, status }`; `NoteEditor({ noteId, userName, userColor })`; `FormatBar({ editor })`

- [ ] **Step 1: Write the document hook**

Create `apps/web/src/features/notes/hooks/use-note-doc.ts`:

```ts
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { IndexeddbPersistence } from "y-indexeddb";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { noop } from "@/shared/lib/noop";
import { supabase } from "@/shared/lib/supabase";
import { fromBase64 } from "../lib/bytes";
import { connectAwareness } from "../lib/awareness-channel";
import { NoteSync } from "../lib/note-doc";

export type NoteDocStatus = "loading" | "ready" | "error";

export type NoteDocHandle = {
  doc: Y.Doc;
  awareness: Awareness;
  status: NoteDocStatus;
};

/**
 * Owns one note's CRDT session: the Y.Doc, its IndexedDB mirror, the durable
 * append log, the postgres_changes subscription, and the awareness channel.
 *
 * Two persistence layers with distinct jobs. The TanStack persister holds the
 * notes list; y-indexeddb holds the document so a cold offline launch has
 * content.
 */
export function useNoteDoc(noteId: string): NoteDocHandle {
  const [handle, setHandle] = useState<NoteDocHandle | null>(null);

  useEffect(() => {
    if (!noteId) {
      return;
    }
    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    const persistence = new IndexeddbPersistence(`note:${noteId}`, doc);
    setHandle({ doc, awareness, status: "loading" });

    const onError = (error: Error): void => {
      toast.error(error.message);
    };

    const sync = new NoteSync({ noteId, doc, onError });
    let disposed = false;

    const onLocalUpdate = (update: Uint8Array, origin: unknown): void => {
      // Remote-applied updates must not be re-appended to the log.
      if (origin === "remote") {
        return;
      }
      sync.queueLocalUpdate(update);
    };

    const channel = supabase
      .channel(`note:${noteId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "note_updates",
          filter: `note_id=eq.${noteId}`,
        },
        (message) => {
          const row = message.new as { id: number; update_b64: string };
          Y.transact(
            doc,
            () => sync.applyRemote({ id: row.id, update: fromBase64(row.update_b64) }),
            "remote"
          );
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED" && !disposed) {
          void sync.resync().catch(onError);
        }
      });

    const disconnectAwareness = connectAwareness({
      noteId,
      awareness,
      onError,
    });

    void sync
      .start()
      .then(() => {
        if (disposed) {
          return;
        }
        doc.on("update", onLocalUpdate);
        setHandle({ doc, awareness, status: "ready" });
      })
      .catch((error: unknown) => {
        if (disposed) {
          return;
        }
        onError(
          error instanceof Error ? error : new Error("Notiz konnte nicht geladen werden")
        );
        setHandle({ doc, awareness, status: "error" });
      });

    return () => {
      disposed = true;
      doc.off("update", onLocalUpdate);
      disconnectAwareness();
      supabase.removeChannel(channel).then(noop, noop);
      void sync.stop().finally(() => {
        awareness.destroy();
        void persistence.destroy();
        doc.destroy();
      });
    };
  }, [noteId]);

  if (handle) {
    return handle;
  }
  // Stable placeholder for the first render before the effect runs.
  const doc = new Y.Doc();
  return { doc, awareness: new Awareness(doc), status: "loading" };
}
```

- [ ] **Step 2: Write the format bar**

Create `apps/web/src/features/notes/components/format-bar.tsx`:

```tsx
import type { Editor } from "@tiptap/react";
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  List,
  ListChecks,
  ListOrdered,
  Pilcrow,
  Quote,
} from "lucide-react";
import { Button } from "@/shared/components/ui/button";

type FormatAction = {
  label: string;
  icon: typeof Bold;
  isActive: (editor: Editor) => boolean;
  run: (editor: Editor) => void;
};

const ACTIONS: FormatAction[] = [
  {
    label: "Absatz",
    icon: Pilcrow,
    isActive: (e) => e.isActive("paragraph"),
    run: (e) => e.chain().focus().setParagraph().run(),
  },
  {
    label: "Überschrift 1",
    icon: Heading1,
    isActive: (e) => e.isActive("heading", { level: 1 }),
    run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run(),
  },
  {
    label: "Überschrift 2",
    icon: Heading2,
    isActive: (e) => e.isActive("heading", { level: 2 }),
    run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    label: "Überschrift 3",
    icon: Heading3,
    isActive: (e) => e.isActive("heading", { level: 3 }),
    run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(),
  },
  {
    label: "Fett",
    icon: Bold,
    isActive: (e) => e.isActive("bold"),
    run: (e) => e.chain().focus().toggleBold().run(),
  },
  {
    label: "Kursiv",
    icon: Italic,
    isActive: (e) => e.isActive("italic"),
    run: (e) => e.chain().focus().toggleItalic().run(),
  },
  {
    label: "Aufzählung",
    icon: List,
    isActive: (e) => e.isActive("bulletList"),
    run: (e) => e.chain().focus().toggleBulletList().run(),
  },
  {
    label: "Nummerierte Liste",
    icon: ListOrdered,
    isActive: (e) => e.isActive("orderedList"),
    run: (e) => e.chain().focus().toggleOrderedList().run(),
  },
  {
    label: "Aufgabenliste",
    icon: ListChecks,
    isActive: (e) => e.isActive("taskList"),
    run: (e) => e.chain().focus().toggleTaskList().run(),
  },
  {
    label: "Zitat",
    icon: Quote,
    isActive: (e) => e.isActive("blockquote"),
    run: (e) => e.chain().focus().toggleBlockquote().run(),
  },
  {
    label: "Codeblock",
    icon: Code,
    isActive: (e) => e.isActive("codeBlock"),
    run: (e) => e.chain().focus().toggleCodeBlock().run(),
  },
];

/**
 * Docked to the bottom of the viewport rather than anchored to the selection.
 *
 * A bubble menu is the wrong primitive on mobile: Tiptap issues 6571 and 1806
 * document the floating toolbar sitting mid-screen when the virtual keyboard
 * opens and iOS Safari dropping the selection on button tap. A docked bar never
 * needs selection-anchored positioning.
 *
 * It also covers the one gap input rules cannot express: no input rule removes
 * a heading, so "Absatz" is the only way back to a paragraph.
 */
export function FormatBar({ editor }: { editor: Editor | null }) {
  if (!editor) {
    return null;
  }
  return (
    <div
      aria-label="Formatierung"
      className="sticky bottom-0 z-10 flex gap-1 overflow-x-auto border-t bg-background px-2 py-1"
      role="toolbar"
    >
      {ACTIONS.map((action) => {
        const Icon = action.icon;
        return (
          <Button
            aria-label={action.label}
            aria-pressed={action.isActive(editor)}
            key={action.label}
            // onMouseDown rather than onClick: preventDefault keeps the editor
            // selection and the virtual keyboard alive through the tap.
            onMouseDown={(event) => {
              event.preventDefault();
              action.run(editor);
            }}
            size="icon"
            type="button"
            variant={action.isActive(editor) ? "secondary" : "ghost"}
          >
            <Icon className="size-4" />
          </Button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: Write the editor component**

Create `apps/web/src/features/notes/components/note-editor.tsx`:

```tsx
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { NOTE_KEYS, setNoteTitle } from "../api/notes";
import { useNoteDoc } from "../hooks/use-note-doc";
import { UPDATE_FLUSH_MS } from "../lib/note-doc";
import { deriveTitle } from "../lib/title";
import { FormatBar } from "./format-bar";

type NoteEditorProps = {
  boardId: string;
  noteId: string;
  userName: string;
  userColor: string;
};

export function NoteEditor({
  boardId,
  noteId,
  userName,
  userColor,
}: NoteEditorProps) {
  const { doc, awareness, status } = useNoteDoc(noteId);
  const queryClient = useQueryClient();
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTitle = useRef<string>("");

  const editor = useEditor(
    {
      extensions: [
        // History is owned by the Yjs UndoManager, so StarterKit's must go.
        StarterKit.configure({ undoRedo: false }),
        TaskList,
        TaskItem.configure({ nested: true }),
        Collaboration.configure({ document: doc }),
        CollaborationCaret.configure({
          provider: { awareness },
          user: { name: userName, color: userColor },
        }),
      ],
      editorProps: {
        attributes: {
          class:
            "prose prose-sm dark:prose-invert max-w-none px-4 py-3 focus:outline-none min-h-[50vh]",
          "aria-label": "Notiz bearbeiten",
        },
      },
      immediatelyRender: false,
    },
    [doc, awareness, userName, userColor]
  );

  useEffect(() => {
    if (!editor) {
      return;
    }
    const onUpdate = (): void => {
      if (titleTimer.current !== null) {
        clearTimeout(titleTimer.current);
      }
      titleTimer.current = setTimeout(() => {
        const next = deriveTitle(editor.getText());
        if (next === lastTitle.current) {
          return;
        }
        lastTitle.current = next;
        void setNoteTitle({ noteId, title: next })
          .then(() =>
            queryClient.invalidateQueries({
              queryKey: NOTE_KEYS.byBoard(boardId),
            })
          )
          .catch(() => {
            // The title is a derived cache. A failed write is corrected on the
            // next edit, so it must not interrupt writing with a toast.
            lastTitle.current = "";
          });
      }, UPDATE_FLUSH_MS);
    };
    editor.on("update", onUpdate);
    return () => {
      editor.off("update", onUpdate);
      if (titleTimer.current !== null) {
        clearTimeout(titleTimer.current);
      }
    };
  }, [editor, noteId, boardId, queryClient]);

  if (status === "error") {
    return (
      <p className="px-4 py-6 text-muted-foreground text-sm">
        Diese Notiz konnte nicht geladen werden. Prüfe deine Verbindung.
      </p>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {status === "loading" ? (
        <p className="px-4 py-6 text-muted-foreground text-sm">Notiz wird geladen…</p>
      ) : null}
      <EditorContent className="min-h-0 flex-1 overflow-y-auto" editor={editor} />
      <FormatBar editor={editor} />
    </div>
  );
}
```

- [ ] **Step 4: Typecheck and lint**

```bash
cd apps/web && pnpm check-types && cd /home/maikb/IdeaProjects/pinnwand && pnpm check
```

Expected: both clean. If `StarterKit.configure({ undoRedo: false })` errors, check the installed StarterKit option name with `pnpm ls @tiptap/starter-kit` and consult its types; Tiptap 3 renamed the v2 `history` option to `undoRedo`.

- [ ] **Step 5: Verify two-tab convergence by hand**

```bash
pnpm dev:up && pnpm dev
```

Sign in as `alice@dev.local` in one browser and `bob@dev.local` in another (magic link at `http://localhost:8025`). Open the same note. Type in both.

Expected: text from each appears in the other within about a second, and both carets are visible with the correct names.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/notes/hooks/use-note-doc.ts apps/web/src/features/notes/components
git commit -m "feat(notes): add collaborative Tiptap editor with carets and format bar"
```

---

## Task 10: Notes list, board tab, and feature surface

**Files:**
- Create: `apps/web/src/features/notes/components/notes-list.tsx`
- Create: `apps/web/src/features/notes/index.ts`
- Modify: `apps/web/src/app/routes/_authed.boards.$boardId.tsx`

**Interfaces:**
- Consumes: `useBoardNotes`, `useCreateNote`, `useDeleteNote`, `useNotesRealtime`, `NoteEditor`
- Produces: `NotesPanel({ boardId, userName, userColor })` exported from `index.ts`

- [ ] **Step 1: Write the notes list and panel**

Create `apps/web/src/features/notes/components/notes-list.tsx`:

```tsx
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/shared/components/ui/button";
import { useBoardNotes } from "../hooks/use-board-notes";
import { useCreateNote } from "../hooks/use-create-note";
import { useDeleteNote } from "../hooks/use-delete-note";
import { useNotesRealtime } from "../hooks/use-notes-realtime";
import { NoteEditor } from "./note-editor";

type NotesPanelProps = {
  boardId: string;
  userName: string;
  userColor: string;
};

export function NotesPanel({ boardId, userName, userColor }: NotesPanelProps) {
  const { notes, isPending, isError } = useBoardNotes(boardId);
  const { createNote, isPending: isCreating } = useCreateNote(boardId);
  const { deleteNote } = useDeleteNote(boardId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useNotesRealtime(boardId);

  const selected = notes.find((note) => note.id === selectedId) ?? null;

  if (isError) {
    return (
      <p className="px-4 py-6 text-muted-foreground text-sm">
        Notizen konnten nicht geladen werden. Prüfe deine Verbindung.
      </p>
    );
  }

  if (isPending) {
    return (
      <p className="px-4 py-6 text-muted-foreground text-sm">
        Notizen werden geladen…
      </p>
    );
  }

  // Mobile: the list is a full screen and selecting a note replaces it.
  // Desktop: both are visible side by side.
  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <aside
        className={`${selected ? "hidden md:flex" : "flex"} min-h-0 w-full flex-col border-r md:w-72`}
      >
        <div className="flex items-center justify-between px-3 py-2">
          <h2 className="font-medium text-sm">Notizen</h2>
          <Button
            aria-label="Notiz erstellen"
            disabled={isCreating}
            onClick={() => {
              void createNote().then((note) => setSelectedId(note.id));
            }}
            size="icon"
            variant="ghost"
          >
            <Plus className="size-4" />
          </Button>
        </div>
        {notes.length === 0 ? (
          <div className="px-3 py-6 text-muted-foreground text-sm">
            <p>Noch keine Notizen.</p>
            <p className="mt-2">
              Tipp: Schreibe <code>## </code> am Zeilenanfang für eine
              Überschrift, <code>- </code> für eine Liste.
            </p>
          </div>
        ) : (
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {notes.map((note) => (
              <li className="flex items-center gap-1 px-1" key={note.id}>
                <Button
                  className="flex-1 justify-start truncate"
                  onClick={() => setSelectedId(note.id)}
                  variant={note.id === selectedId ? "secondary" : "ghost"}
                >
                  {note.title}
                </Button>
                <Button
                  aria-label={`${note.title} löschen`}
                  onClick={() => {
                    if (note.id === selectedId) {
                      setSelectedId(null);
                    }
                    void deleteNote(note.id);
                  }}
                  size="icon"
                  variant="ghost"
                >
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </aside>
      {selected ? (
        <section className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center gap-2 border-b px-3 py-2 md:hidden">
            <Button onClick={() => setSelectedId(null)} size="sm" variant="ghost">
              Zurück
            </Button>
            <span className="truncate font-medium text-sm">{selected.title}</span>
          </div>
          <NoteEditor
            boardId={boardId}
            key={selected.id}
            noteId={selected.id}
            userColor={userColor}
            userName={userName}
          />
        </section>
      ) : (
        <section className="hidden flex-1 items-center justify-center md:flex">
          <p className="text-muted-foreground text-sm">
            Wähle links eine Notiz aus.
          </p>
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Write the feature's public surface**

Create `apps/web/src/features/notes/index.ts`:

```ts
export { NotesPanel } from "./components/notes-list";
export { registerNoteMutationDefaults } from "./mutation-defaults";
export type { Note } from "./types";
```

- [ ] **Step 3: Add the Board / Notizen tab to the route**

Open `apps/web/src/app/routes/_authed.boards.$boardId.tsx`. Wrap the existing board content in a tab switch, keeping every existing prop and hook call unchanged. Add at the top of the component body:

```tsx
const [view, setView] = useState<"board" | "notes">("board");
```

Render above the existing content:

```tsx
<div className="flex gap-1 border-b px-3 py-2" role="tablist">
  <Button
    aria-selected={view === "board"}
    onClick={() => setView("board")}
    role="tab"
    size="sm"
    variant={view === "board" ? "secondary" : "ghost"}
  >
    Board
  </Button>
  <Button
    aria-selected={view === "notes"}
    onClick={() => setView("notes")}
    role="tab"
    size="sm"
    variant={view === "notes" ? "secondary" : "ghost"}
  >
    Notizen
  </Button>
</div>
```

Then render the existing board markup when `view === "board"`, and otherwise:

```tsx
<NotesPanel
  boardId={boardId}
  userColor="#6366f1"
  userName={displayName}
/>
```

Use the existing profile display name already available in this route for `displayName`. If none is in scope, read it through the `profile` feature's public `index.ts` rather than deep-importing.

- [ ] **Step 4: Verify the route builds and the tab works**

```bash
cd apps/web && pnpm check-types && cd /home/maikb/IdeaProjects/pinnwand && pnpm check && pnpm build
```

Expected: all clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/notes apps/web/src/app/routes/_authed.boards.\$boardId.tsx
git commit -m "feat(notes): add notes list and Board/Notizen tab"
```

---

## Task 11: End-to-end coverage

**Files:**
- Create: `apps/web/e2e/notes.spec.ts`

**Interfaces:**
- Consumes: the existing fixtures in `apps/web/e2e/fixtures.ts` and helpers in `apps/web/e2e/helpers/`

- [ ] **Step 1: Read the existing patterns**

```bash
sed -n '1,60p' apps/web/e2e/tasks.spec.ts
sed -n '1,40p' apps/web/e2e/fixtures.ts
ls apps/web/e2e/helpers apps/web/e2e/pages
```

Use whatever sign-in and board-creation helpers already exist. Do not introduce a parallel helper.

- [ ] **Step 2: Write the spec**

Create `apps/web/e2e/notes.spec.ts`, adapting the sign-in helper names to what Step 1 revealed:

```ts
import { expect, test } from "./fixtures";

test.describe("Notizen", () => {
  test("creates a note and types into it", async ({ page, signIn }) => {
    await signIn("alice@dev.local");
    await page.getByRole("tab", { name: "Notizen" }).click();
    await page.getByRole("button", { name: "Notiz erstellen" }).click();

    const editor = page.getByRole("textbox", { name: "Notiz bearbeiten" });
    await editor.click();
    await editor.pressSequentially("Sprintplanung");

    await expect(
      page.getByRole("button", { name: "Sprintplanung" })
    ).toBeVisible();
  });

  test("markdown shortcut converts a block, and the bar converts it back", async ({
    page,
    signIn,
  }) => {
    await signIn("alice@dev.local");
    await page.getByRole("tab", { name: "Notizen" }).click();
    await page.getByRole("button", { name: "Notiz erstellen" }).click();

    const editor = page.getByRole("textbox", { name: "Notiz bearbeiten" });
    await editor.click();
    await editor.pressSequentially("## Überschrift");
    await expect(editor.locator("h2")).toHaveText("Überschrift");

    // No input rule removes a heading, which is why the format bar is not
    // optional.
    await page.getByRole("button", { name: "Absatz" }).click();
    await expect(editor.locator("h2")).toHaveCount(0);
    await expect(editor.locator("p")).toContainText("Überschrift");
  });

  test("two members converge on one note", async ({ browser, signInAs }) => {
    const alice = await browser.newContext();
    const bob = await browser.newContext();
    const alicePage = await alice.newPage();
    const bobPage = await bob.newPage();

    await signInAs(alicePage, "alice@dev.local");
    await signInAs(bobPage, "bob@dev.local");

    await alicePage.getByRole("tab", { name: "Notizen" }).click();
    await alicePage.getByRole("button", { name: "Notiz erstellen" }).click();
    const aliceEditor = alicePage.getByRole("textbox", {
      name: "Notiz bearbeiten",
    });
    await aliceEditor.click();
    await aliceEditor.pressSequentially("Von Alice");

    await bobPage.getByRole("tab", { name: "Notizen" }).click();
    await bobPage.getByRole("button", { name: "Von Alice" }).click();
    const bobEditor = bobPage.getByRole("textbox", { name: "Notiz bearbeiten" });
    await expect(bobEditor).toContainText("Von Alice");

    await bobEditor.click();
    await bobEditor.press("End");
    await bobEditor.pressSequentially(" und Bob");
    await expect(aliceEditor).toContainText("und Bob");

    await alice.close();
    await bob.close();
  });

  test("offline edits from both members merge on reconnect", async ({
    browser,
    signInAs,
  }) => {
    const alice = await browser.newContext();
    const bob = await browser.newContext();
    const alicePage = await alice.newPage();
    const bobPage = await bob.newPage();

    await signInAs(alicePage, "alice@dev.local");
    await signInAs(bobPage, "bob@dev.local");

    await alicePage.getByRole("tab", { name: "Notizen" }).click();
    await alicePage.getByRole("button", { name: "Notiz erstellen" }).click();
    const aliceEditor = alicePage.getByRole("textbox", {
      name: "Notiz bearbeiten",
    });
    await aliceEditor.click();
    await aliceEditor.pressSequentially("Start");

    await bobPage.getByRole("tab", { name: "Notizen" }).click();
    await bobPage.getByRole("button", { name: "Start" }).click();
    const bobEditor = bobPage.getByRole("textbox", { name: "Notiz bearbeiten" });
    await expect(bobEditor).toContainText("Start");

    // Both go offline and edit. This is the case last-write-wins cannot handle
    // and the reason this feature uses a CRDT at all.
    await alice.setOffline(true);
    await bob.setOffline(true);

    await aliceEditor.click();
    await aliceEditor.press("End");
    await aliceEditor.pressSequentially(" A-Zusatz");

    await bobEditor.click();
    await bobEditor.press("End");
    await bobEditor.pressSequentially(" B-Zusatz");

    await alice.setOffline(false);
    await bob.setOffline(false);

    // Neither edit is lost.
    await expect(aliceEditor).toContainText("A-Zusatz");
    await expect(aliceEditor).toContainText("B-Zusatz");
    await expect(bobEditor).toContainText("A-Zusatz");
    await expect(bobEditor).toContainText("B-Zusatz");

    await alice.close();
    await bob.close();
  });
});
```

If `signInAs(page, email)` does not exist in the fixtures, add it there next to the existing `signIn` fixture rather than inlining sign-in steps in this spec.

- [ ] **Step 3: Run the e2e suite**

```bash
cd /home/maikb/IdeaProjects/pinnwand && pnpm e2e -- notes.spec.ts
```

Expected: 4 passed. The offline test is the slowest; if it flakes, raise the expect timeout on the post-reconnect assertions rather than adding a fixed sleep.

- [ ] **Step 4: Run everything**

```bash
cd /home/maikb/IdeaProjects/pinnwand && pnpm check && pnpm test && pnpm e2e
cd apps/web && pnpm check-types && pnpm test:integration
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/e2e/notes.spec.ts apps/web/e2e/fixtures.ts
git commit -m "test(notes): add e2e coverage for convergence and offline merge"
```

---

## Task 12: Documentation

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: nothing
- Produces: nothing

Per `.claude/rules/documentation.md`, `CLAUDE.md` is updated when the top-level architecture changes. This feature adds a slice and two tables.

- [ ] **Step 1: Update the feature slice list**

In `CLAUDE.md`, find the line listing feature slices:

```
│   ├── features/<name>/ ← Vertical slice (auth, boards, members, tasks, appearance, navigation, profile)
```

Change it to include `notes`:

```
│   ├── features/<name>/ ← Vertical slice (auth, boards, members, notes, tasks, appearance, navigation, profile)
```

- [ ] **Step 2: Add notes to the domain model section**

Under "Domain model", after the `task_assignees` entry, add:

```markdown
- **note** (Notiz): `id, board_id, title, snapshot_b64, snapshot_up_to_id, created_by, created_at, updated_at`. Board-scoped collaborative document backed by a Yjs CRDT. Editor is Tiptap 3 on a `Y.XmlFragment`; markdown is an input shortcut and an export format, never the stored form.
- **note_updates**: append-only log of Yjs updates, `(id bigserial, note_id, update_b64, created_at)`. Both the durable store and the sync transport: clients subscribe to inserts via `postgres_changes` rather than a separate broadcast path. Compacted into `notes.snapshot_b64` by the SECURITY DEFINER `compact_note` RPC past 500 rows.
```

- [ ] **Step 3: Add the invariant**

Under "Key invariants", add:

```markdown
- **Note carets ride broadcast, never Presence.** Self-hosted Realtime caps a client at 5 presence calls per 30 seconds, and `y-protocols` awareness is already a presence protocol with its own clock and peer expiry. Awareness updates go out as binary broadcast, throttled at 100ms on the send, and a removal always bypasses the throttle.
```

- [ ] **Step 4: Check the length budget**

```bash
wc -l CLAUDE.md
```

Expected: still under 200 lines. If it went over, move the notes detail into a new path-scoped rule file and leave a one-line pointer.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document the notes slice and its realtime invariant"
```

---

## Self-Review

**Spec coverage.** Walked each spec section against the tasks: schema and RLS (Task 1), compaction (Tasks 1, 5), sync architecture and client lifecycle (Task 5), realtime publication (Task 1), editing model and format bar (Task 9), awareness in full including the outbound rule, throttle, late joiner, binary encoding, teardown and mobile (Task 7), UI (Tasks 9, 10), offline (Task 8), feature slice (all), testing (Tasks 2, 3, 5, 6, 7, 11), operational notes (no code, documented in Task 12).

Two spec items are deliberately not implemented and are called out here rather than left silently missing:

- **Markdown export.** The spec lists it as a goal and Task 4 installs `@tiptap/markdown`, but no task wires an export button. It is a one-call addition (`editor.storage.markdown.getMarkdown()`) with no dependency on anything else, so it belongs in a follow-up rather than padding this plan.
- **The `notes.doc` query key** is declared in Task 3 and never consumed, since document state lives in the `Y.Doc` rather than the query cache. Remove it during Task 3 if `pnpm knip` flags it.

**Placeholder scan.** No TBD, TODO, or "add appropriate error handling". Every code step carries the actual code.

**Type consistency.** `Note` and `NoteUpdate` are defined once in Task 3 and used unchanged in Tasks 5 and 8. `NOTE_KEYS` / `NOTE_MUTATION_KEYS` names match across Tasks 3, 8, and 9. `NoteSync` methods (`start`, `resync`, `applyRemote`, `queueLocalUpdate`, `flush`, `stop`) match their call sites in Task 9. `connectAwareness` returns a teardown function in Task 7 and is called that way in Task 9. `deriveTitle` and `UNTITLED_NOTE` from Task 6 are used in Tasks 8 and 9. `toExactArrayBuffer` from Task 2 is used in Task 7.

**Known risk carried into execution.** Task 9's `use-note-doc.ts` is the largest single file and the one with the most lifecycle ordering to get right, particularly the interaction between the `doc.on("update")` handler, the `"remote"` transaction origin, and StrictMode double-mounting. If it proves unwieldy during execution, split the postgres_changes subscription into its own `use-note-updates-channel.ts` rather than letting the file grow.
