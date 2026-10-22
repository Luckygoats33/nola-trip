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
  select coalesce((select auth.jwt() ->> 'email'), '') = 'will.wiedenmann@gmail.com'
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
