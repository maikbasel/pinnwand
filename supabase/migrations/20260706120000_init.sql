-- Pinnwand core schema: boards, membership (join-code sharing), tasks and
-- assignees. RLS is enabled on every table in this same migration; access is
-- gated by board membership. SECURITY DEFINER helpers break the membership
-- recursion (a board_members policy that itself reads board_members).

create extension if not exists pgcrypto with schema extensions;

-- ── Enums ────────────────────────────────────────────────────────────────────
create type public.board_role as enum ('owner', 'member');
create type public.task_column as enum ('offen', 'zu_erledigen', 'in_bearbeitung', 'erledigt');
create type public.task_priority as enum ('niedrig', 'mittel', 'hoch');

-- ── profiles ─────────────────────────────────────────────────────────────────
-- One row per auth user, holding the display name shown for assignees/members.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  created_at timestamptz not null default now()
);

-- ── boards ───────────────────────────────────────────────────────────────────
create table public.boards (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  join_code text not null unique,
  created_by uuid not null references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

-- ── board_members ────────────────────────────────────────────────────────────
create table public.board_members (
  board_id uuid not null references public.boards (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.board_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (board_id, user_id)
);

create index board_members_user_idx on public.board_members (user_id);

-- ── tasks ────────────────────────────────────────────────────────────────────
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards (id) on delete cascade,
  "column" public.task_column not null default 'offen',
  title text not null check (char_length(title) between 1 and 200),
  description text not null default '',
  priority public.task_priority not null default 'mittel',
  due_date date,
  -- Fractional index for ordering within a column; drag-reorder writes the
  -- midpoint between neighbours without touching sibling rows.
  position double precision not null default 0,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index tasks_board_column_idx on public.tasks (board_id, "column", position);

-- ── task_assignees ───────────────────────────────────────────────────────────
-- Verantwortliche: many-to-many between a task and board members.
create table public.task_assignees (
  task_id uuid not null references public.tasks (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (task_id, user_id)
);

create index task_assignees_user_idx on public.task_assignees (user_id);

-- ── Helpers (SECURITY DEFINER: bypass RLS to avoid policy recursion) ──────────
create or replace function public.is_board_member(p_board uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1 from public.board_members m
    where m.board_id = p_board and m.user_id = auth.uid()
  );
$$;

create or replace function public.is_board_owner(p_board uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1 from public.board_members m
    where m.board_id = p_board and m.user_id = auth.uid() and m.role = 'owner'
  );
$$;

create or replace function public.gen_join_code()
returns text
language sql
volatile
as $$
  -- 8 unambiguous upper-case/digit characters (no 0/O/1/I).
  select string_agg(
    substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
           1 + floor(random() * 32)::int, 1), '')
  from generate_series(1, 8);
$$;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger tasks_touch_updated_at
before update on public.tasks
for each row execute function public.touch_updated_at();

-- Seed a profile row whenever a new auth user is created.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- ── RPCs ─────────────────────────────────────────────────────────────────────
-- Create a board and make the caller its owner in one transaction.
create or replace function public.create_board(p_name text)
returns public.boards
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_board public.boards;
  v_code text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  -- Retry until we land a unique code (collisions are astronomically rare).
  loop
    v_code := public.gen_join_code();
    begin
      insert into public.boards (name, join_code, created_by)
      values (p_name, v_code, auth.uid())
      returning * into v_board;
      exit;
    exception when unique_violation then
      -- try another code
    end;
  end loop;

  insert into public.board_members (board_id, user_id, role)
  values (v_board.id, auth.uid(), 'owner');

  return v_board;
end;
$$;

-- Join a board by its share code; idempotent for members already in.
create or replace function public.join_board_by_code(p_code text)
returns public.boards
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_board public.boards;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select * into v_board from public.boards
  where join_code = upper(trim(p_code));

  if v_board.id is null then
    raise exception 'invalid join code';
  end if;

  insert into public.board_members (board_id, user_id, role)
  values (v_board.id, auth.uid(), 'member')
  on conflict (board_id, user_id) do nothing;

  return v_board;
end;
$$;

-- Rotate a board's share code (owner only), invalidating the old one.
create or replace function public.regenerate_join_code(p_board uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text;
begin
  if not public.is_board_owner(p_board) then
    raise exception 'only the owner can rotate the join code';
  end if;

  loop
    v_code := public.gen_join_code();
    begin
      update public.boards set join_code = v_code where id = p_board;
      exit;
    exception when unique_violation then
      -- try another code
    end;
  end loop;

  return v_code;
end;
$$;

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.profiles enable row level security;
alter table public.boards enable row level security;
alter table public.board_members enable row level security;
alter table public.tasks enable row level security;
alter table public.task_assignees enable row level security;

-- profiles: see your own and anyone who shares a board with you.
create policy profiles_select on public.profiles for select
using (
  id = auth.uid()
  or exists (
    select 1 from public.board_members me
    join public.board_members them on them.board_id = me.board_id
    where me.user_id = auth.uid() and them.user_id = profiles.id
  )
);
create policy profiles_update_own on public.profiles for update
using (id = auth.uid()) with check (id = auth.uid());

-- boards: members read; owners rename/delete. Inserts go through create_board.
create policy boards_select on public.boards for select
using (public.is_board_member(id));
create policy boards_update on public.boards for update
using (public.is_board_owner(id)) with check (public.is_board_owner(id));
create policy boards_delete on public.boards for delete
using (public.is_board_owner(id));

-- board_members: members read the roster. Joining is via join_board_by_code;
-- a member may remove themselves (leave); an owner may remove anyone.
create policy board_members_select on public.board_members for select
using (public.is_board_member(board_id));
create policy board_members_delete on public.board_members for delete
using (user_id = auth.uid() or public.is_board_owner(board_id));

-- tasks: any board member has full CRUD within their board.
create policy tasks_select on public.tasks for select
using (public.is_board_member(board_id));
create policy tasks_insert on public.tasks for insert
with check (public.is_board_member(board_id) and created_by = auth.uid());
create policy tasks_update on public.tasks for update
using (public.is_board_member(board_id)) with check (public.is_board_member(board_id));
create policy tasks_delete on public.tasks for delete
using (public.is_board_member(board_id));

-- task_assignees: gated by membership of the parent task's board.
create policy task_assignees_select on public.task_assignees for select
using (exists (
  select 1 from public.tasks t
  where t.id = task_assignees.task_id and public.is_board_member(t.board_id)
));
create policy task_assignees_insert on public.task_assignees for insert
with check (exists (
  select 1 from public.tasks t
  where t.id = task_assignees.task_id and public.is_board_member(t.board_id)
));
create policy task_assignees_delete on public.task_assignees for delete
using (exists (
  select 1 from public.tasks t
  where t.id = task_assignees.task_id and public.is_board_member(t.board_id)
));
