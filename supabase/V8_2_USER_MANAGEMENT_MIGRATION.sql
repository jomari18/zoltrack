-- ZolTrack v8.2 - Auth/Profile User Management
-- Keeps legacy public.users untouched. User Management now uses auth.users + public.profiles.

alter table public.profiles
  add column if not exists active boolean not null default true;

create or replace function public.get_managed_users()
returns table(
  id uuid,
  full_name text,
  email text,
  username text,
  role text,
  active boolean,
  approved boolean,
  created_at timestamptz
)
language sql stable security definer
set search_path=public,auth
as $$
  select p.id, p.full_name, u.email::text, p.username, p.role,
         coalesce(p.active,true), p.approved, p.created_at
  from public.profiles p
  join auth.users u on u.id=p.id
  where public.current_user_role()='superadmin'
    and p.approved=true
  order by case p.role when 'superadmin' then 0 when 'admin' then 1 else 2 end,
           p.created_at;
$$;

create or replace function public.set_managed_user_role(p_profile_id uuid, p_role text)
returns void
language plpgsql security definer set search_path=public
as $$
declare v_target_role text;
begin
  if public.current_user_role()<>'superadmin' then raise exception 'Not authorized'; end if;
  if p_profile_id=auth.uid() then raise exception 'You cannot change your own role'; end if;
  if p_role not in ('user','admin') then raise exception 'Only User or Admin roles can be assigned here'; end if;
  select role into v_target_role from public.profiles where id=p_profile_id;
  if v_target_role is null then raise exception 'Profile not found'; end if;
  if v_target_role='superadmin' then raise exception 'Super Admin accounts are protected'; end if;
  update public.profiles set role=p_role where id=p_profile_id;
end $$;

create or replace function public.set_managed_user_active(p_profile_id uuid, p_active boolean)
returns void
language plpgsql security definer set search_path=public
as $$
declare v_target_role text;
begin
  if public.current_user_role()<>'superadmin' then raise exception 'Not authorized'; end if;
  if p_profile_id=auth.uid() then raise exception 'You cannot deactivate your own account'; end if;
  select role into v_target_role from public.profiles where id=p_profile_id;
  if v_target_role is null then raise exception 'Profile not found'; end if;
  if v_target_role='superadmin' then raise exception 'Super Admin accounts are protected'; end if;
  update public.profiles set active=p_active where id=p_profile_id;
end $$;

revoke all on function public.get_managed_users() from public;
revoke all on function public.set_managed_user_role(uuid,text) from public;
revoke all on function public.set_managed_user_active(uuid,boolean) from public;
grant execute on function public.get_managed_users() to authenticated;
grant execute on function public.set_managed_user_role(uuid,text) to authenticated;
grant execute on function public.set_managed_user_active(uuid,boolean) to authenticated;
