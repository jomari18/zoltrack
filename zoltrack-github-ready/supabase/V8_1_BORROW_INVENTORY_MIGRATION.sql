-- ZolTrack v8.1 - Borrowing + Inventory migration
-- Preserves legacy data. New borrow ownership uses auth.users UUID.

alter table public.borrow_transactions
  add column if not exists borrower_auth uuid references auth.users(id) on delete set null;

-- Legacy borrower_id belongs to public.users and must not block Auth users.
alter table public.borrow_transactions alter column borrower_id drop not null;

create or replace function public.get_borrow_transactions_v81()
returns setof public.borrow_transactions
language plpgsql security definer set search_path=public as $$
declare v_uid uuid:=auth.uid(); v_role text; v_ok boolean;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  select role,approved into v_role,v_ok from public.profiles where id=v_uid;
  if coalesce(v_ok,false) is not true then raise exception 'Approved account required'; end if;
  return query select b.* from public.borrow_transactions b
    where v_role in ('admin','superadmin') or b.borrower_auth=v_uid
    order by b.borrow_date desc nulls last, b.id desc;
end $$;

create or replace function public.submit_borrow_request_v81(p_item_id bigint,p_quantity integer,p_purpose text,p_expected_return_date date)
returns public.borrow_transactions
language plpgsql security definer set search_path=public as $$
declare v_uid uuid:=auth.uid(); v_ok boolean; v_name text; v_item public.inventory%rowtype; v_row public.borrow_transactions%rowtype;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  select approved,full_name into v_ok,v_name from public.profiles where id=v_uid;
  if coalesce(v_ok,false) is not true then raise exception 'Approved account required'; end if;
  if p_quantity is null or p_quantity < 1 then raise exception 'Quantity must be at least 1'; end if;
  if nullif(trim(p_purpose),'') is null then raise exception 'Purpose is required'; end if;
  if p_expected_return_date < current_date then raise exception 'Return date cannot be in the past'; end if;
  select * into v_item from public.inventory where id=p_item_id;
  if not found then raise exception 'Inventory item not found'; end if;
  if coalesce(v_item.quantity,0) < p_quantity then raise exception 'Requested quantity exceeds current stock'; end if;
  insert into public.borrow_transactions(item_id,item_name,borrower_name,borrower_id,borrower_auth,quantity,purpose,borrow_date,expected_return_date,status)
  values(p_item_id,v_item.item_name,coalesce(v_name,'User'),null,v_uid,p_quantity,trim(p_purpose),current_date,p_expected_return_date,'pending')
  returning * into v_row;
  return v_row;
end $$;

create or replace function public.approve_borrow_request_v81(p_transaction_id bigint)
returns public.borrow_transactions
language plpgsql security definer set search_path=public as $$
declare v_uid uuid:=auth.uid(); v_role text; v_ok boolean; v_b public.borrow_transactions%rowtype; v_stock integer;
begin
  select role,approved into v_role,v_ok from public.profiles where id=v_uid;
  if v_uid is null or coalesce(v_ok,false) is not true or v_role not in ('admin','superadmin') then raise exception 'Staff access required'; end if;
  select * into v_b from public.borrow_transactions where id=p_transaction_id for update;
  if not found then raise exception 'Borrow request not found'; end if;
  if v_b.status <> 'pending' then raise exception 'Borrow request is no longer pending'; end if;
  select quantity into v_stock from public.inventory where id=v_b.item_id for update;
  if not found then raise exception 'Inventory item not found'; end if;
  if coalesce(v_stock,0) < v_b.quantity then raise exception 'Insufficient inventory'; end if;
  update public.inventory set quantity=v_stock-v_b.quantity,last_updated=current_date where id=v_b.item_id;
  update public.borrow_transactions set status='borrowed' where id=p_transaction_id returning * into v_b;
  return v_b;
end $$;

create or replace function public.reject_borrow_request_v81(p_transaction_id bigint)
returns public.borrow_transactions
language plpgsql security definer set search_path=public as $$
declare v_uid uuid:=auth.uid(); v_role text; v_ok boolean; v_b public.borrow_transactions%rowtype;
begin
  select role,approved into v_role,v_ok from public.profiles where id=v_uid;
  if v_uid is null or coalesce(v_ok,false) is not true or v_role not in ('admin','superadmin') then raise exception 'Staff access required'; end if;
  update public.borrow_transactions set status='rejected' where id=p_transaction_id and status='pending' returning * into v_b;
  if not found then raise exception 'Borrow request is no longer pending'; end if;
  return v_b;
end $$;

create or replace function public.return_borrow_item_v81(p_transaction_id bigint)
returns public.borrow_transactions
language plpgsql security definer set search_path=public as $$
declare v_uid uuid:=auth.uid(); v_role text; v_ok boolean; v_b public.borrow_transactions%rowtype; v_stock integer;
begin
  select role,approved into v_role,v_ok from public.profiles where id=v_uid;
  if v_uid is null or coalesce(v_ok,false) is not true or v_role not in ('admin','superadmin') then raise exception 'Staff access required'; end if;
  select * into v_b from public.borrow_transactions where id=p_transaction_id for update;
  if not found then raise exception 'Borrow transaction not found'; end if;
  if v_b.status <> 'borrowed' then raise exception 'Only borrowed items can be returned'; end if;
  select quantity into v_stock from public.inventory where id=v_b.item_id for update;
  if not found then raise exception 'Inventory item not found'; end if;
  update public.inventory set quantity=coalesce(v_stock,0)+v_b.quantity,last_updated=current_date where id=v_b.item_id;
  update public.borrow_transactions set status='returned',actual_return_date=current_date where id=p_transaction_id returning * into v_b;
  return v_b;
end $$;

revoke all on function public.get_borrow_transactions_v81() from public;
revoke all on function public.submit_borrow_request_v81(bigint,integer,text,date) from public;
revoke all on function public.approve_borrow_request_v81(bigint) from public;
revoke all on function public.reject_borrow_request_v81(bigint) from public;
revoke all on function public.return_borrow_item_v81(bigint) from public;
grant execute on function public.get_borrow_transactions_v81() to authenticated;
grant execute on function public.submit_borrow_request_v81(bigint,integer,text,date) to authenticated;
grant execute on function public.approve_borrow_request_v81(bigint) to authenticated;
grant execute on function public.reject_borrow_request_v81(bigint) to authenticated;
grant execute on function public.return_borrow_item_v81(bigint) to authenticated;
