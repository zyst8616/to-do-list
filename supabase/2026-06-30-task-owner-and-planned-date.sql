-- Add real task ownership and planned dates.
-- Run this in Supabase SQL Editor before implementing the next UI round.

create or replace function public.is_user_space_member(target_space_id uuid, target_user_id uuid)
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
      and user_id = target_user_id
  );
$$;

alter table public.tasks
  add column if not exists owner_id uuid references auth.users(id);

alter table public.tasks
  add column if not exists planned_date date;

update public.tasks
set owner_id = created_by
where owner_id is null;

update public.tasks
set planned_date = (created_at at time zone 'Asia/Shanghai')::date
where planned_date is null;

alter table public.tasks
  alter column owner_id set not null;

alter table public.tasks
  alter column owner_id set default auth.uid();

alter table public.tasks
  alter column planned_date set not null;

alter table public.tasks
  alter column planned_date set default ((now() at time zone 'Asia/Shanghai')::date);

create index if not exists tasks_space_owner_planned_date_idx
on public.tasks(space_id, owner_id, planned_date);

drop policy if exists "Members can create tasks" on public.tasks;
create policy "Members can create tasks"
on public.tasks
for insert
to authenticated
with check (
  public.is_space_member(space_id)
  and created_by = auth.uid()
  and public.is_user_space_member(space_id, owner_id)
);

drop policy if exists "Members can update tasks" on public.tasks;
create policy "Members can update tasks"
on public.tasks
for update
to authenticated
using (public.is_space_member(space_id))
with check (
  public.is_space_member(space_id)
  and public.is_user_space_member(space_id, owner_id)
);
