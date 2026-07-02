-- Fix task deletion for existing Supabase projects.
-- Run this in the Supabase SQL Editor.

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

drop policy if exists "Members can update tasks" on public.tasks;
create policy "Members can update tasks"
on public.tasks
for update
to authenticated
using (public.is_space_member(space_id))
with check (
  public.is_space_member(space_id)
  and (
    public.is_user_space_member(space_id, owner_id)
    or deleted_at is not null
  )
);

drop policy if exists "Members can soft delete tasks" on public.tasks;
drop policy if exists "Members can delete tasks" on public.tasks;
create policy "Members can delete tasks"
on public.tasks
for delete
to authenticated
using (public.is_space_member(space_id));

create or replace function public.delete_task(target_task_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_space_id uuid;
begin
  select space_id
  into target_space_id
  from public.tasks
  where id = target_task_id;

  if target_space_id is null then
    return;
  end if;

  if not public.is_space_member(target_space_id) then
    raise exception 'not allowed to delete this task';
  end if;

  delete from public.tasks
  where id = target_task_id;
end;
$$;

revoke all on function public.delete_task(uuid) from public;
grant execute on function public.delete_task(uuid) to authenticated;
