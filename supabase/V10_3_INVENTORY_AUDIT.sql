-- ZolTrack v10.3 - Inventory changes in the Audit Log
-- Run once AFTER v8.8. Records new events only; does not change inventory or existing audit rows.
begin;

create or replace function public.v103_inventory_events() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if tg_op='INSERT' then
    perform public.v88_audit('created','inventory',new.id::text,'Inventory item added: '||coalesce(new.item_name,'—')||' (quantity '||coalesce(new.quantity::text,'—')||')',jsonb_build_object('item_number',new.item_number,'quantity',new.quantity));
    return new;
  elsif tg_op='DELETE' then
    perform public.v88_audit('deleted','inventory',old.id::text,'Inventory item deleted: '||coalesce(old.item_name,'—')||' (quantity '||coalesce(old.quantity::text,'—')||')',jsonb_build_object('item_number',old.item_number,'quantity',old.quantity));
    return old;
  elsif new.quantity is distinct from old.quantity then
    perform public.v88_audit('quantity_changed','inventory',new.id::text,coalesce(new.item_name,'Item')||' quantity changed from '||coalesce(old.quantity::text,'—')||' to '||coalesce(new.quantity::text,'—'),jsonb_build_object('old_quantity',old.quantity,'new_quantity',new.quantity));
  end if;
  return new;
end $$;
revoke all on function public.v103_inventory_events() from public, anon, authenticated;

drop trigger if exists v103_inventory_events on public.inventory;
create trigger v103_inventory_events after insert or update or delete on public.inventory for each row execute function public.v103_inventory_events();

commit;
