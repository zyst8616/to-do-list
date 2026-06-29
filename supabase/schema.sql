-- Supabase SQL draft for the two-person shared todo list.
-- Run this after creating the Supabase project and enabling email auth.

create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  display_name text not null,
  avatar_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.shared_spaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.space_members (
  space_id uuid not null references public.shared_spaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('member')),
  created_at timestamptz not null default now(),
  primary key (space_id, user_id)
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.shared_spaces(id) on delete cascade,
  title text not null check (char_length(trim(title)) > 0),
  notes text,
  status text not null default 'active' check (status in ('active', 'completed')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_by uuid references auth.users(id),
  completed_at timestamptz,
  deleted_at timestamptz
);

create index if not exists tasks_space_id_status_idx on public.tasks(space_id, status);
create index if not exists tasks_updated_at_idx on public.tasks(updated_at desc);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do update
    set email = excluded.email,
        display_name = excluded.display_name;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert or update of email, raw_user_meta_data on auth.users
for each row
execute function public.handle_new_user();

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_tasks_updated_at on public.tasks;
create trigger set_tasks_updated_at
before update on public.tasks
for each row
execute function public.set_updated_at();

create or replace function public.is_space_member(target_space_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.space_members
    where space_id = target_space_id
      and user_id = auth.uid()
  );
$$;

alter table public.profiles enable row level security;
alter table public.shared_spaces enable row level security;
alter table public.space_members enable row level security;
alter table public.tasks enable row level security;

drop policy if exists "Profiles are visible to members" on public.profiles;
create policy "Profiles are visible to members"
on public.profiles
for select
to authenticated
using (
  id = auth.uid()
  or exists (
    select 1
    from public.space_members own_membership
    join public.space_members other_membership
      on other_membership.space_id = own_membership.space_id
    where own_membership.user_id = auth.uid()
      and other_membership.user_id = profiles.id
  )
);

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
on public.profiles
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists "Users can insert own profile" on public.profiles;
create policy "Users can insert own profile"
on public.profiles
for insert
to authenticated
with check (id = auth.uid());

drop policy if exists "Members can read their spaces" on public.shared_spaces;
create policy "Members can read their spaces"
on public.shared_spaces
for select
to authenticated
using (public.is_space_member(id));

drop policy if exists "Members can read memberships" on public.space_members;
create policy "Members can read memberships"
on public.space_members
for select
to authenticated
using (public.is_space_member(space_id));

drop policy if exists "Members can read tasks" on public.tasks;
create policy "Members can read tasks"
on public.tasks
for select
to authenticated
using (deleted_at is null and public.is_space_member(space_id));

drop policy if exists "Members can create tasks" on public.tasks;
create policy "Members can create tasks"
on public.tasks
for insert
to authenticated
with check (
  public.is_space_member(space_id)
  and created_by = auth.uid()
);

drop policy if exists "Members can update tasks" on public.tasks;
create policy "Members can update tasks"
on public.tasks
for update
to authenticated
using (public.is_space_member(space_id))
with check (public.is_space_member(space_id));

drop policy if exists "Members can soft delete tasks" on public.tasks;
create policy "Members can soft delete tasks"
on public.tasks
for delete
to authenticated
using (public.is_space_member(space_id));

do $$
begin
  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  )
  and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'tasks'
  ) then
    alter publication supabase_realtime add table public.tasks;
  end if;
end;
$$;

-- Seed after both users have logged in at least once.
-- Replace the emails below, run the first insert, copy the returned id,
-- then use that id as VITE_SHARED_SPACE_ID in .env.local.
--
-- insert into public.shared_spaces (name)
-- values ('我们的待办')
-- returning id;
--
-- insert into public.space_members (space_id, user_id)
-- select 'PASTE_SHARED_SPACE_ID_HERE'::uuid, id
-- from auth.users
-- where email in ('first@example.com', 'second@example.com');
