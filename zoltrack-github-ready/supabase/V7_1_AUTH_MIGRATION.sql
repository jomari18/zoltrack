-- ZolTrack v7.1 Auth migration
-- Run after the profiles table + handle_new_user trigger already created.

alter table public.profiles
add column if not exists approved boolean not null default false;

-- Users can read their own profile.
drop policy if exists "Users can view own profile" on public.profiles;
create policy "Users can view own profile"
on public.profiles for select to authenticated
using (auth.uid() = id);

-- Do NOT allow direct client updates to profiles yet.
drop policy if exists "Users can update own basic profile" on public.profiles;

-- New signups remain ordinary users and unapproved.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, username, role, approved)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    nullif(new.raw_user_meta_data->>'username', ''),
    'user',
    false
  );
  return new;
end;
$$;
