-- ZolTrack v8.0 - Maintenance Requests Auth migration
-- Keeps legacy columns/data intact while attaching new requests to auth.users UUIDs.

alter table public.maintenance_requests
  add column if not exists submitted_by_auth uuid references auth.users(id) on delete set null,
  add column if not exists assigned_to_auth uuid references auth.users(id) on delete set null;

-- Legacy submitted_by belongs to the old public.users architecture.
-- New Auth users may not have a legacy public.users row, so it cannot remain mandatory.
alter table public.maintenance_requests alter column submitted_by drop not null;

create or replace function public.submit_maintenance_request(
  p_request_id text,
  p_classroom text,
  p_issue_type text,
  p_description text,
  p_priority text,
  p_date_submitted date,
  p_photo_url text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_ok boolean;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  select approved into v_ok from public.profiles where id = v_uid;
  if coalesce(v_ok,false) is not true then raise exception 'Approved account required'; end if;

  insert into public.maintenance_requests (
    request_id, classroom, issue_type, description, priority,
    submitted_by, submitted_by_auth, date_submitted, status,
    assigned_to, assigned_to_auth, date_completed, notes, photo_url
  ) values (
    p_request_id, p_classroom, p_issue_type, p_description, p_priority,
    null, v_uid, coalesce(p_date_submitted,current_date), 'pending',
    null, null, null, null, p_photo_url
  );
end;
$$;

create or replace function public.get_maintenance_requests_v8()
returns table (
  request_id text, classroom text, issue_type text, description text, priority text,
  submitted_by_legacy text, submitted_by_auth uuid, submitted_by_name text,
  date_submitted date, status text,
  assigned_to_legacy text, assigned_to_auth uuid, assigned_to_name text,
  date_completed date, notes text, photo_url text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_approved boolean;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  select role, approved into v_role, v_approved from public.profiles where id=v_uid;
  if coalesce(v_approved,false) is not true then raise exception 'Approved account required'; end if;

  return query
  select
    m.request_id::text, m.classroom::text, m.issue_type::text, m.description::text, m.priority::text,
    m.submitted_by::text, m.submitted_by_auth, sp.full_name::text,
    m.date_submitted::date, m.status::text,
    m.assigned_to::text, m.assigned_to_auth, ap.full_name::text,
    m.date_completed::date, m.notes::text, m.photo_url::text
  from public.maintenance_requests m
  left join public.profiles sp on sp.id=m.submitted_by_auth
  left join public.profiles ap on ap.id=m.assigned_to_auth
  where v_role in ('admin','superadmin') or m.submitted_by_auth=v_uid
  order by m.date_submitted desc nulls last, m.request_id desc;
end;
$$;

create or replace function public.update_maintenance_request_v8(
  p_request_id text,
  p_status text default null,
  p_notes text default null,
  p_assigned_to uuid default null,
  p_date_completed date default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_approved boolean;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  select role, approved into v_role, v_approved from public.profiles where id=v_uid;
  if coalesce(v_approved,false) is not true or v_role not in ('admin','superadmin') then
    raise exception 'Admin access required';
  end if;

  update public.maintenance_requests
  set status = coalesce(p_status,status),
      notes = coalesce(p_notes,notes),
      assigned_to_auth = coalesce(p_assigned_to,assigned_to_auth),
      date_completed = coalesce(p_date_completed,date_completed)
  where request_id::text=p_request_id;
end;
$$;

revoke all on function public.submit_maintenance_request(text,text,text,text,text,date,text) from public;
revoke all on function public.get_maintenance_requests_v8() from public;
revoke all on function public.update_maintenance_request_v8(text,text,text,uuid,date) from public;
grant execute on function public.submit_maintenance_request(text,text,text,text,text,date,text) to authenticated;
grant execute on function public.get_maintenance_requests_v8() to authenticated;
grant execute on function public.update_maintenance_request_v8(text,text,text,uuid,date) to authenticated;
