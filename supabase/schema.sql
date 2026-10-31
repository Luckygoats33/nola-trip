-- nola-trip accounts schema. Run in Supabase SQL editor (already applied as migration "accounts_schema").
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  name text,
  trip jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.lists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('itinerary','checklist','ink','custom','search')),
  title text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists lists_user_idx on public.lists(user_id);
create unique index if not exists lists_user_singleton on public.lists(user_id, kind) where kind in ('itinerary','checklist','ink');
create table if not exists public.list_items (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.lists(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  item_ref text not null,
  note text,
  position int not null default 0,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists list_items_list_idx on public.list_items(list_id);
create index if not exists list_items_user_idx on public.list_items(user_id);
create table if not exists public.likes (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  item_ref text not null,
  kind text not null default 'like' check (kind in ('like','vote','visited')),
  value jsonb,
  created_at timestamptz not null default now(),
  primary key (user_id, item_ref, kind)
);

-- admin check: email claim in the verified JWT
create or replace function public.is_admin() returns boolean
language sql stable set search_path = '' as $$
  select coalesce((select auth.jwt() ->> 'email'), '') in (
    'will.wiedenmann@gmail.com',
    'purplepanic12@gmail.com'
  )
$$;

-- profile on signup (name from magic-link metadata)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.lists enable row level security;
alter table public.list_items enable row level security;
alter table public.likes enable row level security;

-- profiles
create policy profiles_select on public.profiles for select to authenticated
  using ((select auth.uid()) = id or (select public.is_admin()));
create policy profiles_update on public.profiles for update to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
-- lists / list_items / likes: own rows CRUD, admin read-all
create policy lists_select on public.lists for select to authenticated
  using ((select auth.uid()) = user_id or (select public.is_admin()));
create policy lists_insert on public.lists for insert to authenticated with check ((select auth.uid()) = user_id);
create policy lists_update on public.lists for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy lists_delete on public.lists for delete to authenticated using ((select auth.uid()) = user_id);

create policy list_items_select on public.list_items for select to authenticated
  using ((select auth.uid()) = user_id or (select public.is_admin()));
create policy list_items_insert on public.list_items for insert to authenticated
  with check ((select auth.uid()) = user_id and exists (select 1 from public.lists l where l.id = list_id and l.user_id = (select auth.uid())));
create policy list_items_update on public.list_items for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy list_items_delete on public.list_items for delete to authenticated using ((select auth.uid()) = user_id);

create policy likes_select on public.likes for select to authenticated
  using ((select auth.uid()) = user_id or (select public.is_admin()));
create policy likes_insert on public.likes for insert to authenticated with check ((select auth.uid()) = user_id);
create policy likes_update on public.likes for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy likes_delete on public.likes for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.profiles, public.lists, public.list_items, public.likes from anon;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.lists, public.list_items, public.likes to authenticated;

-- 2026-10-21: first-run welcome flag
alter table public.profiles add column if not exists welcomed_at timestamptz;

-- 2026-10-31: public read-only itinerary links. See add-itinerary-shares.sql for the runnable migration.
-- The function body is kept identical to that file.

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
