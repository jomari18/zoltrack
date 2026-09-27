-- ZolTrack v8.5 - Legacy authentication retirement
-- Purpose: preserve historical display data, detach obsolete public.users FKs,
--          then remove the old plaintext-password authentication tables.
-- IMPORTANT: Run only after v8.4 is deployed and tested.
-- Safety: no CASCADE is used. If an unexpected dependency exists, PostgreSQL
--         will stop the migration instead of silently deleting that dependency.

begin;

-- 1) Preserve readable names for historical maintenance records before users is removed.
alter table public.maintenance_requests
  add column if not exists submitted_by_legacy_name text,
  add column if not exists assigned_to_legacy_name text;

update public.maintenance_requests m
set submitted_by_legacy_name = coalesce(m.submitted_by_legacy_name, u.full_name)
from public.users u
where m.submitted_by = u.id
  and m.submitted_by is not null;

update public.maintenance_requests m
set assigned_to_legacy_name = coalesce(m.assigned_to_legacy_name, u.full_name)
from public.users u
where m.assigned_to = u.id
  and m.assigned_to is not null;

-- Borrow history already snapshots borrower_name, so no additional name column is needed.

-- 2) Remove only the three confirmed obsolete FKs to public.users.
alter table public.borrow_transactions
  drop constraint if exists borrow_transactions_borrower_id_fkey;

alter table public.maintenance_requests
  drop constraint if exists maintenance_requests_submitted_by_fkey,
  drop constraint if exists maintenance_requests_assigned_to_fkey;

-- 3) Keep the legacy integer columns as inert historical IDs.
--    New/current ownership continues through borrower_auth / submitted_by_auth / assigned_to_auth.
comment on column public.borrow_transactions.borrower_id is
  'Retired legacy public.users integer ID; historical reference only. Current ownership uses borrower_auth.';
comment on column public.maintenance_requests.submitted_by is
  'Retired legacy public.users integer ID; historical reference only. Current ownership uses submitted_by_auth.';
comment on column public.maintenance_requests.assigned_to is
  'Retired legacy public.users integer ID; historical reference only. Current assignment uses assigned_to_auth.';

-- 4) Refresh maintenance read RPC so old records retain a readable submitter/assignee name.
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
    m.submitted_by::text, m.submitted_by_auth,
    coalesce(sp.full_name::text, m.submitted_by_legacy_name::text),
    m.date_submitted::date, m.status::text,
    m.assigned_to::text, m.assigned_to_auth,
    coalesce(ap.full_name::text, m.assigned_to_legacy_name::text),
    m.date_completed::date, m.notes::text, m.photo_url::text
  from public.maintenance_requests m
  left join public.profiles sp on sp.id=m.submitted_by_auth
  left join public.profiles ap on ap.id=m.assigned_to_auth
  where v_role in ('admin','superadmin') or m.submitted_by_auth=v_uid
  order by m.date_submitted desc nulls last, m.request_id desc;
end;
$$;

revoke all on function public.get_maintenance_requests_v8() from public;
grant execute on function public.get_maintenance_requests_v8() to authenticated;

-- 5) Retire the old registration/authentication tables.
-- No CASCADE: an unexpected DB dependency makes this fail safely.
drop table public.pending_registrations;
drop table public.users;

commit;

-- 6) Post-migration verification.
select
  to_regclass('public.users') as legacy_users_table,
  to_regclass('public.pending_registrations') as legacy_pending_table;

select
  con.conname as constraint_name,
  con.conrelid::regclass as dependent_table,
  pg_get_constraintdef(con.oid) as definition
from pg_constraint con
where con.contype = 'f'
  and con.conrelid in (
    'public.borrow_transactions'::regclass,
    'public.maintenance_requests'::regclass
  )
  and pg_get_constraintdef(con.oid) ilike '%public.users%';

select
  count(*) filter (where borrower_auth is null and borrower_id is not null) as preserved_legacy_borrow_rows
from public.borrow_transactions;

select
  count(*) filter (where submitted_by_auth is null and submitted_by is not null) as preserved_legacy_maintenance_rows,
  count(*) filter (where submitted_by_auth is null and submitted_by is not null and submitted_by_legacy_name is not null) as legacy_maintenance_rows_with_name
from public.maintenance_requests;
