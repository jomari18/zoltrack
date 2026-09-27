-- ZolTrack v8.6 - Atomic Maintenance Completion + Inventory Deduction
-- Run once after v8.5. Preserves existing maintenance and inventory data.
-- Completion and optional stock deduction now happen in one PostgreSQL transaction/RPC.

begin;

-- Explicit completion audit fields. IF NOT EXISTS keeps this safe if an older DB
-- already introduced deduct_inventory manually.
alter table public.maintenance_requests
  add column if not exists deduct_inventory boolean not null default false,
  add column if not exists deducted_inventory_item_id bigint,
  add column if not exists deducted_inventory_quantity integer,
  add column if not exists inventory_deducted_at timestamptz;

-- Do not invent historical truth. Existing rows remain false unless a prior value
-- already existed. New completions are recorded atomically by the RPC below.

create or replace function public.complete_maintenance_request_v86(
  p_request_id text,
  p_deduct_inventory boolean,
  p_inventory_item_id bigint default null,
  p_quantity integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_approved boolean;
  v_request public.maintenance_requests%rowtype;
  v_stock integer;
  v_item_name text;
  v_item_unit text;
  v_qty integer;
  v_notes text;
begin
  if v_uid is null then
    raise exception 'Authentication required';
  end if;

  select role, approved
    into v_role, v_approved
  from public.profiles
  where id = v_uid;

  if coalesce(v_approved, false) is not true
     or v_role not in ('admin', 'superadmin') then
    raise exception 'Admin access required';
  end if;

  -- Serialize completion attempts for this request. This prevents double deduction.
  select *
    into v_request
  from public.maintenance_requests
  where request_id::text = p_request_id
  for update;

  if not found then
    raise exception 'Maintenance request not found';
  end if;

  if lower(coalesce(v_request.status, '')) = 'completed' then
    raise exception 'Maintenance request is already completed';
  end if;

  if coalesce(p_deduct_inventory, false) then
    if p_inventory_item_id is null then
      raise exception 'Inventory item is required';
    end if;

    v_qty := coalesce(p_quantity, 0);
    if v_qty < 1 then
      raise exception 'Quantity must be at least 1';
    end if;

    -- Lock stock row before validating/updating it.
    select quantity, item_name, coalesce(unit, 'pcs')
      into v_stock, v_item_name, v_item_unit
    from public.inventory
    where id = p_inventory_item_id
    for update;

    if not found then
      raise exception 'Inventory item not found';
    end if;

    if coalesce(v_stock, 0) < v_qty then
      raise exception 'Insufficient inventory. Available: % %', coalesce(v_stock,0), v_item_unit;
    end if;

    update public.inventory
       set quantity = v_stock - v_qty,
           last_updated = current_date
     where id = p_inventory_item_id;

    v_notes := format(
      'INVENTORY DEDUCTION: %s %s of %s removed.',
      v_qty, v_item_unit, v_item_name
    );

    update public.maintenance_requests
       set status = 'completed',
           date_completed = current_date,
           notes = v_notes,
           deduct_inventory = true,
           deducted_inventory_item_id = p_inventory_item_id,
           deducted_inventory_quantity = v_qty,
           inventory_deducted_at = now()
     where request_id::text = p_request_id;

    return jsonb_build_object(
      'request_id', p_request_id,
      'status', 'completed',
      'deduct_inventory', true,
      'item_id', p_inventory_item_id,
      'item_name', v_item_name,
      'unit', v_item_unit,
      'quantity_deducted', v_qty,
      'remaining_quantity', v_stock - v_qty
    );
  end if;

  update public.maintenance_requests
     set status = 'completed',
         date_completed = current_date,
         notes = 'Item was repaired. No inventory deduction.',
         deduct_inventory = false,
         deducted_inventory_item_id = null,
         deducted_inventory_quantity = null,
         inventory_deducted_at = null
   where request_id::text = p_request_id;

  return jsonb_build_object(
    'request_id', p_request_id,
    'status', 'completed',
    'deduct_inventory', false
  );
end;
$$;

revoke all on function public.complete_maintenance_request_v86(text,boolean,bigint,integer) from public;
grant execute on function public.complete_maintenance_request_v86(text,boolean,bigint,integer) to authenticated;

commit;

-- Post-flight checks (read-only)
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema='public'
  and table_name='maintenance_requests'
  and column_name in (
    'deduct_inventory',
    'deducted_inventory_item_id',
    'deducted_inventory_quantity',
    'inventory_deducted_at'
  )
order by column_name;

select p.proname as function_name
from pg_proc p
join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and p.proname='complete_maintenance_request_v86';
