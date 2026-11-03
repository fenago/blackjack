-- Player profiles for Blackjack.
-- Run once in Supabase → SQL Editor (safe to re-run).

create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  username     text not null unique
               check (username ~ '^[a-z0-9_]{3,20}$'),
  display_name text not null
               check (char_length(btrim(display_name)) between 1 and 50),
  bio          text check (bio is null or char_length(bio) <= 280),
  location     text check (location is null or char_length(location) <= 60),
  play_style   text check (play_style is null or play_style in ('cautious', 'balanced', 'high_roller')),
  avatar_url   text check (avatar_url is null or avatar_url ~ '^https://'),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.profiles is 'One profile per signed-in player; id matches auth.users.id.';

-- Keep updated_at current.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Row level security: any signed-in player can view profiles,
-- but only you can create or edit your own.
alter table public.profiles enable row level security;

drop policy if exists "Profiles are viewable by signed-in players" on public.profiles;
create policy "Profiles are viewable by signed-in players"
  on public.profiles for select
  to authenticated
  using (true);

drop policy if exists "Players can create their own profile" on public.profiles;
create policy "Players can create their own profile"
  on public.profiles for insert
  to authenticated
  with check ((select auth.uid()) = id);

drop policy if exists "Players can update their own profile" on public.profiles;
create policy "Players can update their own profile"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

grant select, insert, update on public.profiles to authenticated;
