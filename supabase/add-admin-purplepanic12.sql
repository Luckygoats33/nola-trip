-- Add purplepanic12@gmail.com as an admin alongside will.wiedenmann@gmail.com.
-- Run this in the Supabase SQL editor for project vfawvxxlnnmztkwrgvrr.
-- It replaces public.is_admin(), which the existing RLS policies already call.
-- Not applied by the app deploy. Apply it once so the new admin can read
-- everyone else's profiles, lists, list items, and likes.

create or replace function public.is_admin() returns boolean
language sql stable set search_path = '' as $$
  select coalesce((select auth.jwt() ->> 'email'), '') in (
    'will.wiedenmann@gmail.com',
    'purplepanic12@gmail.com'
  )
$$;
