-- Run this after:
-- 1. supabase/schema.sql has been executed.
-- 2. Both allowed users have logged in once.
--
-- Replace the two emails below, then run the file in Supabase SQL Editor.

insert into public.shared_spaces (name)
values ('我们的待办')
returning id;

-- After the statement above returns an id:
-- 1. Copy that id.
-- 2. Replace PASTE_SHARED_SPACE_ID_HERE below.
-- 3. Replace the two emails below.
-- 4. Run the insert below.

insert into public.space_members (space_id, user_id)
select 'PASTE_SHARED_SPACE_ID_HERE'::uuid, id
from auth.users
where email in ('YOUR_EMAIL@example.com', 'PARTNER_EMAIL@example.com');
