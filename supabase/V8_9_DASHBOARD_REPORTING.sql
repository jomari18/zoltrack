-- ZolTrack v8.9 - Dashboard Stats + Reporting
-- Safe aggregate-only public stats plus authenticated staff reporting metrics.

begin;

create or replace function public.get_public_stats_v89()
returns jsonb
language sql
stable
security definer
set search_path=public
as $$
  select jsonb_build_object(
    'requests_processed', (select count(*) from public.maintenance_requests where status='completed'),
    'active_users', (select count(*) from public.profiles where approved=true and coalesce(active,true)=true),
    'inventory_items', (select count(*) from public.inventory)
  );
$$;

create or replace function public.get_report_metrics_v89()
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  v_role text;
  v_result jsonb;
begin
  v_role := public.current_user_role();
  if v_role not in ('admin','superadmin') then
    raise exception 'Staff access required';
  end if;

  select jsonb_build_object(
    'maintenance', jsonb_build_object(
      'total', count(*),
      'pending', count(*) filter (where status='pending'),
      'in_progress', count(*) filter (where status='in-progress'),
      'completed', count(*) filter (where status='completed')
    )
  ) into v_result
  from public.maintenance_requests;

  v_result := v_result || jsonb_build_object(
    'inventory', (select jsonb_build_object(
      'items', count(*),
      'total_units', coalesce(sum(quantity),0),
      'low_stock', count(*) filter (where quantity <= coalesce(min_stock,0))
    ) from public.inventory),
    'borrowing', (select jsonb_build_object(
      'pending', count(*) filter (where status='pending'),
      'borrowed', count(*) filter (where status='borrowed'),
      'returned', count(*) filter (where status='returned'),
      'overdue', count(*) filter (where status='borrowed' and expected_return_date is not null and expected_return_date < current_date)
    ) from public.borrow_transactions),
    'users', (select jsonb_build_object(
      'active', count(*) filter (where approved=true and coalesce(active,true)=true),
      'pending_approval', count(*) filter (where coalesce(approved,false)=false)
    ) from public.profiles)
  );

  return v_result;
end;
$$;

revoke all on function public.get_public_stats_v89() from public;
revoke all on function public.get_report_metrics_v89() from public;
grant execute on function public.get_public_stats_v89() to anon, authenticated;
grant execute on function public.get_report_metrics_v89() to authenticated;

commit;

-- Verification
select p.proname as function_name,
       pg_get_function_result(p.oid) as returns
from pg_proc p
join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and p.proname in ('get_public_stats_v89','get_report_metrics_v89')
order by p.proname;
