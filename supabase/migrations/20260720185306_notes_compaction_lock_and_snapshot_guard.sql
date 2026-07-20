-- Two fixes to the notes compaction path from 20260720160758_notes.sql.

-- 1. compact_note read snapshot_up_to_id without a row lock, so two concurrent
-- compactions both saw the pre-update value under READ COMMITTED: the lagging
-- caller passed the monotonicity guard on a stale read, then overwrote the
-- further-along snapshot after the row lock released. Rows the leading caller
-- had already deleted were then absent from both the log and the snapshot.
-- `for update` serialises the read with the write, so the lagging caller sees
-- the committed value and no-ops as intended.
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
  from public.notes where id = p_note_id for update;
  if v_board is null then
    raise exception 'note not found';
  end if;
  if not public.is_board_member(v_board) then
    raise exception 'not a board member';
  end if;

  -- Never let a lagging caller move snapshot_up_to_id backward: a later reader
  -- would then re-fetch rows a prior, further-along compaction already deleted,
  -- losing data. No-op rather than raise, since a lagging compaction is not the
  -- caller's fault.
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

-- 2. notes_update lets any board member write every column, so a client could
-- write the snapshot columns directly and bypass the monotonicity guard above.
-- Membership is still the trust boundary; this makes compact_note the only path
-- to those columns in fact rather than by convention.
--
-- Compares the snapshot columns specifically rather than "everything but title
-- is unchanged": notes_touch_updated_at is also a before-update trigger and
-- fire order is alphabetical by trigger name, so a blanket comparison would
-- reject legitimate title writes whenever it happened to run second.
--
-- compact_note is security definer, so current_user there is the function owner
-- rather than `authenticated`, and the guard passes it through.
create or replace function public.guard_note_snapshot_columns()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user = 'authenticated'
    and (new.snapshot_b64 is distinct from old.snapshot_b64
      or new.snapshot_up_to_id is distinct from old.snapshot_up_to_id) then
    raise exception 'snapshot columns are written by compact_note only';
  end if;
  return new;
end;
$$;

create trigger notes_guard_snapshot_columns
before update on public.notes
for each row execute function public.guard_note_snapshot_columns();
