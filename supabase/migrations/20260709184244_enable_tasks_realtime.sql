-- Enable Postgres change events for the board surface.
--
-- The realtime hook (src/features/tasks/hooks/use-board-realtime.ts) subscribes
-- to `tasks` (filtered by board_id) and `task_assignees`. Realtime only streams
-- postgres_changes for tables in the `supabase_realtime` publication; the init
-- migration created the tables but never added them, so no change events ever
-- fired and a second member never saw the first's edits. Realtime is the point
-- of this app, so publish both board-scoped tables.
alter publication supabase_realtime add table public.tasks;
alter publication supabase_realtime add table public.task_assignees;

-- FULL replica identity so a DELETE's WAL record carries the whole old row. The
-- tasks subscription filters `board_id=eq.<id>`; under the default
-- (primary-key) replica identity a delete's old row omits board_id, so the
-- filter can't match and delete events are dropped. task_assignees is
-- subscribed unfiltered, so its default replica identity is sufficient.
alter table public.tasks replica identity full;
