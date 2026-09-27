-- ZolTrack v8.0.1 - Atomic server-generated maintenance request IDs
-- Safe to run after V8_0_MAINTENANCE_MIGRATION.sql. Existing requests are preserved.

create sequence if not exists public.maintenance_request_number_seq;

do $$
declare
  v_max bigint;
begin
  select max((regexp_match(request_id, '^REQ-([0-9]+)$'))[1]::bigint)
    into v_max
  from public.maintenance_requests
  where request_id ~ '^REQ-[0-9]+$';

  if v_max is null then
    perform setval('public.maintenance_request_number_seq', 1, false);
  else
    perform setval('public.maintenance_request_number_seq', v_max, true);
  end if;
end $$;

create or replace function public.submit_maintenance_request_v801(
  p_classroom text,
  p_issue_type text,
  p_description text,
  p_priority text,
  p_date_submitted date,
  p_photo_url text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_ok boolean;
  v_request_id text;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  select approved into v_ok from public.profiles where id = v_uid;
  if coalesce(v_ok,false) is not true then raise exception 'Approved account required'; end if;

  v_request_id := 'REQ-' || lpad(nextval('public.maintenance_request_number_seq')::text, 4, '0');

  insert into public.maintenance_requests (
    request_id, classroom, issue_type, description, priority,
    submitted_by, submitted_by_auth, date_submitted, status,
    assigned_to, assigned_to_auth, date_completed, notes, photo_url
  ) values (
    v_request_id, p_classroom, p_issue_type, p_description, p_priority,
    null, v_uid, coalesce(p_date_submitted,current_date), 'pending',
    null, null, null, null, p_photo_url
  );

  return v_request_id;
end;
$$;

revoke all on function public.submit_maintenance_request_v801(text,text,text,text,date,text) from public;
grant execute on function public.submit_maintenance_request_v801(text,text,text,text,date,text) to authenticated;
