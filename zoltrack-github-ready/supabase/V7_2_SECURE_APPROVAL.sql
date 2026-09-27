alter table public.profiles
  add column if not exists verification_document text,
  add column if not exists verification_document_name text,
  add column if not exists rejection_reason text;

create or replace function public.submit_verification_document(p_document text, p_document_name text default null)
returns void language plpgsql security definer set search_path=public as $$
begin
  update public.profiles set verification_document=p_document,
    verification_document_name=p_document_name, rejection_reason=null, approved=false
  where id=auth.uid();
  if not found then raise exception 'Authenticated profile not found'; end if;
end $$;

create or replace function public.current_user_role()
returns text language sql stable security definer set search_path=public as $$
  select role from public.profiles where id=auth.uid()
$$;

create or replace function public.get_pending_approval_applications()
returns table(id uuid, full_name text, email text, username text, role text,
 verification_document text, verification_document_name text, approved boolean, created_at timestamptz)
language sql stable security definer set search_path=public,auth as $$
 select p.id,p.full_name,u.email::text,p.username,p.role,p.verification_document,
        p.verification_document_name,p.approved,p.created_at
 from public.profiles p join auth.users u on u.id=p.id
 where public.current_user_role()='superadmin' and p.role='user'
   and p.approved=false and p.rejection_reason is null
 order by p.created_at
$$;

create or replace function public.approve_profile(p_profile_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
 if public.current_user_role()<>'superadmin' then raise exception 'Not authorized'; end if;
 update public.profiles set approved=true,rejection_reason=null
 where id=p_profile_id and role='user';
 if not found then raise exception 'Profile not found'; end if;
end $$;

create or replace function public.reject_profile(p_profile_id uuid,p_reason text)
returns void language plpgsql security definer set search_path=public as $$
begin
 if public.current_user_role()<>'superadmin' then raise exception 'Not authorized'; end if;
 if nullif(trim(p_reason),'') is null then raise exception 'Rejection reason is required'; end if;
 update public.profiles set approved=false,rejection_reason=trim(p_reason)
 where id=p_profile_id and role='user';
 if not found then raise exception 'Profile not found'; end if;
end $$;

revoke all on function public.submit_verification_document(text,text) from public;
revoke all on function public.current_user_role() from public;
revoke all on function public.get_pending_approval_applications() from public;
revoke all on function public.approve_profile(uuid) from public;
revoke all on function public.reject_profile(uuid,text) from public;
grant execute on function public.submit_verification_document(text,text) to authenticated;
grant execute on function public.current_user_role() to authenticated;
grant execute on function public.get_pending_approval_applications() to authenticated;
grant execute on function public.approve_profile(uuid) to authenticated;
grant execute on function public.reject_profile(uuid,text) to authenticated;
drop policy if exists "Users can update own basic profile" on public.profiles;
