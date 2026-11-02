-- ZolTrack v10.4 - Borrow dates in Philippine time
-- The database clock is UTC, so a borrow made before 8 AM in the Philippines was dated the day before.
-- New and returned borrows only; existing dates are not changed.
begin;

create or replace function public.v104_borrow_dates() returns trigger
language plpgsql set search_path=public as $$
declare v_today date:=(now() at time zone 'Asia/Manila')::date;
begin
  if tg_op='INSERT' then
    new.borrow_date:=v_today;
  elsif new.status='returned' and old.status is distinct from 'returned' then
    new.actual_return_date:=v_today;
  end if;
  return new;
end $$;
revoke all on function public.v104_borrow_dates() from public, anon, authenticated;

drop trigger if exists v104_borrow_dates on public.borrow_transactions;
create trigger v104_borrow_dates before insert or update on public.borrow_transactions for each row execute function public.v104_borrow_dates();

commit;
