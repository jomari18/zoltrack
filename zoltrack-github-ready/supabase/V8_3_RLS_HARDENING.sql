-- ZolTrack v8.3 - Operational RLS hardening
-- Scope: maintenance_requests, inventory, borrow_transactions.
-- Legacy public.users and pending_registrations are intentionally NOT dropped here.
-- Existing SECURITY DEFINER RPC workflows remain the write path for maintenance/borrowing.

-- Helper predicates. These are SECURITY DEFINER so RLS policies can safely check
-- the authenticated user's approved/active profile without exposing profiles broadly.
create or replace function public.is_approved_active_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.approved = true
      and coalesce(p.active, true) = true
  );
$$;

create or replace function public.is_staff_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.approved = true
      and coalesce(p.active, true) = true
      and p.role in ('admin','superadmin')
  );
$$;

revoke all on function public.is_approved_active_user() from public;
revoke all on function public.is_staff_user() from public;
grant execute on function public.is_approved_active_user() to authenticated;
grant execute on function public.is_staff_user() to authenticated;

-- =========================
-- MAINTENANCE REQUESTS
-- =========================
alter table public.maintenance_requests enable row level security;

drop policy if exists "maintenance_select_own_or_staff" on public.maintenance_requests;
create policy "maintenance_select_own_or_staff"
on public.maintenance_requests
for select
to authenticated
using (
  public.is_approved_active_user()
  and (
    submitted_by_auth = auth.uid()
    or public.is_staff_user()
  )
);

-- No direct INSERT/UPDATE/DELETE policies on purpose.
-- Writes go through submit_maintenance_request_v801 / update_maintenance_request_v8.

-- =========================
-- INVENTORY
-- =========================
alter table public.inventory enable row level security;

drop policy if exists "inventory_select_approved" on public.inventory;
create policy "inventory_select_approved"
on public.inventory
for select
to authenticated
using (public.is_approved_active_user());

drop policy if exists "inventory_insert_staff" on public.inventory;
create policy "inventory_insert_staff"
on public.inventory
for insert
to authenticated
with check (public.is_staff_user());

drop policy if exists "inventory_update_staff" on public.inventory;
create policy "inventory_update_staff"
on public.inventory
for update
to authenticated
using (public.is_staff_user())
with check (public.is_staff_user());

drop policy if exists "inventory_delete_staff" on public.inventory;
create policy "inventory_delete_staff"
on public.inventory
for delete
to authenticated
using (public.is_staff_user());

-- =========================
-- BORROW TRANSACTIONS
-- =========================
alter table public.borrow_transactions enable row level security;

drop policy if exists "borrow_select_own_or_staff" on public.borrow_transactions;
create policy "borrow_select_own_or_staff"
on public.borrow_transactions
for select
to authenticated
using (
  public.is_approved_active_user()
  and (
    borrower_auth = auth.uid()
    or public.is_staff_user()
  )
);

-- No direct INSERT/UPDATE/DELETE policies on purpose.
-- Writes go through v8.1 atomic RPCs.

-- Remove anonymous table access. Authenticated access is still constrained by RLS.
revoke all on table public.maintenance_requests from anon;
revoke all on table public.inventory from anon;
revoke all on table public.borrow_transactions from anon;

grant select on table public.maintenance_requests to authenticated;
grant select, insert, update, delete on table public.inventory to authenticated;
grant select on table public.borrow_transactions to authenticated;

-- Sanity report (returns enabled RLS state after migration).
select c.relname as table_name, c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname='public'
  and c.relname in ('maintenance_requests','inventory','borrow_transactions')
order by c.relname;
