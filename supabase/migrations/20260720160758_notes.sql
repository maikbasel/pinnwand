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
  v_current_up_to_id bigint;
begin
  select board_id, snapshot_up_to_id into v_board, v_current_up_to_id
  from public.notes where id = p_note_id;
  if v_board is null then
    raise exception 'note not found';
  end if;
  if not public.is_board_member(v_board) then
    raise exception 'not a board member';
  end if;

  -- Two clients can compact concurrently. Never let a lagging caller move
  -- snapshot_up_to_id backward: a later reader would then re-fetch rows a
  -- prior, further-along compaction already deleted, losing data. No-op
  -- rather than raise, since a lagging compaction is not the caller's fault.
  if p_up_to_id <= v_current_up_to_id then
    return;
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

-- notes is subscribed to for create/rename/delete list invalidation, filtered
-- on board_id (a non-primary-key column). It must be in the realtime publication,
-- and needs replica identity full so DELETE events carry board_id in the WAL old
-- row and match the filter (default PK-only replica identity would drop them).
alter publication supabase_realtime add table public.notes;
alter table public.notes replica identity full;
