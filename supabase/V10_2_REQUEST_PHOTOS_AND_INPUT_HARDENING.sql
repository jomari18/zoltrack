-- ZolTrack v10.2: stop sending every request photo with the request list,
-- and validate request input on the server.
--
-- Why: get_maintenance_requests_v8 returns photo_url (base64 images stored in
-- the row) for every request. With 11 photos the list was ~12.5 MB per
-- dashboard load, which exceeded the Free Plan egress quota.
--
-- Additive and safe to run on the live project:
--   * get_maintenance_requests_v8 is kept unchanged for older clients.
--   * No rows are modified or deleted.
--   * The new CHECK constraints are NOT VALID: they apply to new and updated
--     rows only, so existing data can never make this migration fail.

begin;

-- 1) Request list without photos: returns has_photo instead of the image.
create or replace function public.get_maintenance_requests_v102()
returns table (
  request_id text, classroom text, issue_type text, description text, priority text,
  submitted_by_legacy text, submitted_by_auth uuid, submitted_by_name text,
  date_submitted date, status text,
  assigned_to_legacy text, assigned_to_auth uuid, assigned_to_name text,
  date_completed date, notes text, has_photo boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_approved boolean;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  select role, approved into v_role, v_approved from public.profiles where id = v_uid;
  if coalesce(v_approved, false) is not true then raise exception 'Approved account required'; end if;

  return query
  select
    m.request_id::text, m.classroom::text, m.issue_type::text, m.description::text, m.priority::text,
    m.submitted_by::text, m.submitted_by_auth,
    coalesce(sp.full_name::text, m.submitted_by_legacy_name::text),
    m.date_submitted::date, m.status::text,
    m.assigned_to::text, m.assigned_to_auth,
    coalesce(ap.full_name::text, m.assigned_to_legacy_name::text),
    m.date_completed::date, m.notes::text,
    (m.photo_url is not null and m.photo_url <> '')
  from public.maintenance_requests m
  left join public.profiles sp on sp.id = m.submitted_by_auth
  left join public.profiles ap on ap.id = m.assigned_to_auth
  where v_role in ('admin', 'superadmin') or m.submitted_by_auth = v_uid
  order by m.date_submitted desc nulls last, m.request_id desc;
end;
$$;

revoke all on function public.get_maintenance_requests_v102() from public;
grant execute on function public.get_maintenance_requests_v102() to authenticated;

-- 2) One request's photo, loaded only when its details are opened.
--    Same visibility rule as the list: admins, super admins, or the submitter.
create or replace function public.get_maintenance_request_photo_v102(p_request_id text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_approved boolean;
  v_photo text;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  select role, approved into v_role, v_approved from public.profiles where id = v_uid;
  if coalesce(v_approved, false) is not true then raise exception 'Approved account required'; end if;

  select m.photo_url into v_photo
  from public.maintenance_requests m
  where m.request_id = p_request_id
    and (v_role in ('admin', 'superadmin') or m.submitted_by_auth = v_uid);

  return v_photo;
end;
$$;

revoke all on function public.get_maintenance_request_photo_v102(text) from public;
grant execute on function public.get_maintenance_request_photo_v102(text) to authenticated;

-- 3) Server-side input rules for new requests (same signature as before).
--    * priority must be low, medium, high or urgent
--    * attachments must be inline PNG/JPEG/GIF/WebP images or PDFs, max ~3 MB of base64
--    * the submission date is set by the server, not the browser
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
  v_priority text := lower(trim(coalesce(p_priority, '')));
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  select approved into v_ok from public.profiles where id = v_uid;
  if coalesce(v_ok, false) is not true then raise exception 'Approved account required'; end if;

  if v_priority not in ('low', 'medium', 'high', 'urgent') then
    raise exception 'Priority must be low, medium, high or urgent';
  end if;
  if p_photo_url is not null and p_photo_url <> '' then
    if p_photo_url !~* '^data:(image/(png|jpe?g|gif|webp)|application/pdf);base64,[a-z0-9+/=]+$' then
      raise exception 'Attachment must be a PNG, JPEG, GIF, WebP image or a PDF';
    end if;
    if length(p_photo_url) > 4000000 then
      raise exception 'Attachment is too large';
    end if;
  end if;

  v_request_id := 'REQ-' || lpad(nextval('public.maintenance_request_number_seq')::text, 4, '0');

  insert into public.maintenance_requests (
    request_id, classroom, issue_type, description, priority,
    submitted_by, submitted_by_auth, date_submitted, status,
    assigned_to, assigned_to_auth, date_completed, notes, photo_url
  ) values (
    v_request_id, p_classroom, p_issue_type, p_description, v_priority,
    null, v_uid, (now() at time zone 'Asia/Manila')::date, 'pending',
    null, null, null, null, nullif(p_photo_url, '')
  );

  return v_request_id;
end;
$$;

revoke all on function public.submit_maintenance_request_v801(text, text, text, text, date, text) from public;
grant execute on function public.submit_maintenance_request_v801(text, text, text, text, date, text) to authenticated;

-- 4) Table-level guard for any other write path. NOT VALID = existing rows are not checked.
alter table public.maintenance_requests
  drop constraint if exists maintenance_requests_priority_allowed;
alter table public.maintenance_requests
  add constraint maintenance_requests_priority_allowed
  check (priority in ('low', 'medium', 'high', 'urgent')) not valid;

commit;

-- 5) Verification (read-only).
select
  to_regprocedure('public.get_maintenance_requests_v102()') is not null as list_without_photos,
  to_regprocedure('public.get_maintenance_request_photo_v102(text)') is not null as single_photo,
  (select count(*) from public.maintenance_requests
    where priority not in ('low', 'medium', 'high', 'urgent')) as existing_rows_with_other_priority;
