-- ZolTrack v8.4 - Legacy retirement readiness audit (READ ONLY)
-- Run this after deploying/testing the v8.4 frontend cleanup.
-- It does NOT drop or modify any table/data.

-- 1) Foreign keys that still reference legacy tables.
select
  con.conname as constraint_name,
  con.conrelid::regclass as dependent_table,
  con.confrelid::regclass as referenced_table,
  pg_get_constraintdef(con.oid) as definition
from pg_constraint con
where con.contype = 'f'
  and con.confrelid in ('public.users'::regclass, 'public.pending_registrations'::regclass)
order by referenced_table::text, dependent_table::text;

-- 2) Views/materialized views whose definitions mention either legacy table.
select schemaname, viewname as object_name, definition
from pg_views
where schemaname not in ('pg_catalog','information_schema')
  and (definition ilike '%public.users%' or definition ilike '%pending_registrations%')
union all
select schemaname, matviewname as object_name, definition
from pg_matviews
where schemaname not in ('pg_catalog','information_schema')
  and (definition ilike '%public.users%' or definition ilike '%pending_registrations%');

-- 3) Functions whose stored definition still mentions either legacy table.
select n.nspname as schema_name, p.proname as function_name,
       pg_get_function_identity_arguments(p.oid) as arguments
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname not in ('pg_catalog','information_schema')
  and (pg_get_functiondef(p.oid) ilike '%public.users%'
       or pg_get_functiondef(p.oid) ilike '%pending_registrations%')
order by 1,2;

-- 4) Legacy row counts. These are informational only.
select 'public.users' as table_name, count(*) as row_count from public.users
union all
select 'public.pending_registrations', count(*) from public.pending_registrations;
