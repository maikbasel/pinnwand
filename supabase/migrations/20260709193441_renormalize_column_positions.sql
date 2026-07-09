-- Atomic whole-column position renumbering for drag-reorder.
--
-- Ordering within a column is a client-computed `double precision` fractional
-- index: a normal reorder writes the midpoint between two neighbours and touches
-- one row. After enough reorders into the same gap the midpoint is no longer
-- representable (two neighbours become adjacent doubles), and no single-row
-- write can place a card between them. This function renumbers the whole column
-- to clean 1024-spacing in one transaction, so the exhausted-gap branch of
-- `useReorderTask` has a correct write instead of a single-row miscompute.
--
-- SECURITY DEFINER (like create_board / join_board_by_code) so it can update the
-- sibling rows in one statement; membership is the authz boundary — a caller who
-- is not a member of the board cannot renumber its tasks. Only tasks that belong
-- to the given board AND column are touched, so a stale or forged id list cannot
-- reach another board's rows. 1024 mirrors POSITION_STEP in
-- src/features/tasks/lib/position.ts.
create or replace function public.renormalize_column_positions(
  p_board uuid,
  p_column public.task_column,
  p_ordered_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if not public.is_board_member(p_board) then
    raise exception 'not a board member';
  end if;

  update public.tasks t
  set position = u.ord * 1024
  from unnest(p_ordered_ids) with ordinality as u(id, ord)
  where t.id = u.id
    and t.board_id = p_board
    and t."column" = p_column;
end;
$$;
