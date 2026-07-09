-- Atomic replace of a task's Verantwortliche (assignees) in one transaction.
--
-- The client sends the full desired assignee id set. The previous api did this
-- as a read-then-diff followed by a separate INSERT and DELETE from the browser:
-- three round trips with no transaction, so a failure between the writes left a
-- partial assignee set until the next refetch reconciled it, and two clients
-- editing the same task's assignees could interleave. This function performs the
-- diff (delete rows no longer wanted, insert the missing ones) in a single
-- statement pair inside one transaction instead.
--
-- SECURITY DEFINER (like create_board / join_board_by_code / renormalize_column_
-- positions) so the whole diff runs as one unit; membership of the parent task's
-- board is the authz boundary, mirroring the task_assignees RLS policies exactly
-- (a caller who is not a member of the board cannot touch its assignees). Only
-- the given task's rows are ever read or written.
create or replace function public.set_task_assignees(
  p_task uuid,
  p_user_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_board uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select board_id into v_board from public.tasks where id = p_task;
  if v_board is null then
    raise exception 'task not found';
  end if;
  if not public.is_board_member(v_board) then
    raise exception 'not a board member';
  end if;

  -- Drop anyone no longer in the desired set. An empty p_user_ids clears all
  -- assignees (x <> all('{}') is true for every row).
  delete from public.task_assignees a
  where a.task_id = p_task
    and a.user_id <> all (p_user_ids);

  -- Add the missing ones; rows already present are skipped by the PK conflict.
  insert into public.task_assignees (task_id, user_id)
  select p_task, u.id
  from unnest(p_user_ids) as u(id)
  on conflict (task_id, user_id) do nothing;
end;
$$;
