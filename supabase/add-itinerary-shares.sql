-- Public read-only itinerary links.
-- Run in the Supabase SQL editor for project vfawvxxlnnmztkwrgvrr.
-- Not applied by the app deploy.
--
-- Owners manage their own rows in public.shares (authenticated RLS).
-- Anonymous visitors cannot read that table. They call
-- public.get_shared_itinerary(token), which returns only the schedule:
-- day titles, start/end, stop text, place ids, trip dates/hotel, and
-- public fields of custom map places. It does not return emails, account
-- names, saves, votes, or searches.

create table if not exists public.shares (
  token text primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create unique index if not exists shares_one_live
  on public.shares (user_id)
  where revoked_at is null;

alter table public.shares enable row level security;

drop policy if exists shares_owner_select on public.shares;
create policy shares_owner_select on public.shares
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists shares_owner_insert on public.shares;
create policy shares_owner_insert on public.shares
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists shares_owner_update on public.shares;
create policy shares_owner_update on public.shares
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists shares_owner_delete on public.shares;
create policy shares_owner_delete on public.shares
  for delete to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.shares from anon;
grant select, insert, update, delete on public.shares to authenticated;

create or replace function public.get_shared_itinerary(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  owner uuid;
  plan jsonb;
  trip jsonb;
  raw_places jsonb;
  days jsonb;
  places jsonb;
begin
  if p_token is null or length(p_token) < 16 or length(p_token) > 80 then
    return null;
  end if;

  select s.user_id into owner
  from public.shares s
  where s.token = p_token and s.revoked_at is null;

  if owner is null then
    return null;
  end if;

  select l.data into plan
  from public.lists l
  where l.user_id = owner and l.kind = 'itinerary'
  order by l.updated_at desc nulls last
  limit 1;

  select jsonb_build_object(
    'arrive', coalesce(p.trip->>'arrive', ''),
    'depart', coalesce(p.trip->>'depart', ''),
    'hotel', coalesce(p.trip->>'hotel', ''),
    'addr', coalesce(p.trip->>'addr', ''),
    'lat', p.trip->'lat',
    'lon', p.trip->'lon'
  ) into trip
  from public.profiles p
  where p.id = owner;

  select l.data into raw_places
  from public.lists l
  where l.user_id = owner and l.kind = 'custom' and l.title = 'Places from the map'
  order by l.updated_at desc nulls last
  limit 1;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'n', d.value->'n',
      'h', d.value->'h',
      'items', (
        select coalesce(jsonb_agg(
          jsonb_build_object(
            'k', it.value->'k',
            't', it.value->'t',
            'end', it.value->'end',
            'h', it.value->'h',
            'd', it.value->'d',
            'p', coalesce(it.value->'p', '[]'::jsonb)
          )
          order by it.ordinality
        ), '[]'::jsonb)
        from jsonb_array_elements(coalesce(d.value->'items', '[]'::jsonb)) with ordinality as it(value, ordinality)
      )
    )
    order by d.ordinality
  ), '[]'::jsonb) into days
  from jsonb_array_elements(coalesce(plan->'days', '[]'::jsonb)) with ordinality as d(value, ordinality);

  select coalesce(jsonb_object_agg(e.key, jsonb_build_object(
    'n', e.value->>'n',
    'ad', coalesce(e.value->>'ad', ''),
    'lat', e.value->'lat',
    'lon', e.value->'lon',
    'note', coalesce(e.value->>'note', ''),
    'ph', coalesce(e.value->>'ph', ''),
    'url', coalesce(e.value->>'url', ''),
    'hours', coalesce(e.value #>> '{hrs,hoursText}', '')
  )), '{}'::jsonb) into places
  from jsonb_each(coalesce(raw_places, '{}'::jsonb)) as e
  where jsonb_typeof(e.value) = 'object';

  return jsonb_build_object(
    'days', days,
    'trip', coalesce(trip, '{}'::jsonb),
    'places', places
  );
end $$;

revoke all on function public.get_shared_itinerary(text) from public;
grant execute on function public.get_shared_itinerary(text) to anon, authenticated;
