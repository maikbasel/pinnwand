-- board_members.user_id and profiles.id both reference auth.users(id), so
-- PostgREST cannot embed profiles from board_members: there is no direct
-- foreign key between the two tables, and the request fails with PGRST200
-- ("Could not find a relationship between 'board_members' and 'profiles'").
--
-- Add an explicit FK from board_members.user_id to profiles.id so PostgREST can
-- resolve `board_members.select('..., profiles(display_name)')`. Every member is
-- an authenticated user, and public.profiles is populated for every auth.users
-- row by the on_auth_user_created trigger before any board join, so this FK is
-- always satisfiable. It coexists with the existing FK to auth.users (a column
-- may carry more than one foreign key); the auth.users cascade stays the
-- authoritative account-deletion path.
alter table public.board_members
  add constraint fk_board_members_profiles
  foreign key (user_id) references public.profiles (id) on delete cascade;
